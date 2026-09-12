use rusqlite::{params, OptionalExtension};
use serde_json::{json, Value};

use super::{config::DesktopState, models::CommandError, storage, sync};

fn text<'a>(value: &'a Value, key: &str) -> &'a str {
    value.get(key).and_then(Value::as_str).unwrap_or("").trim()
}

fn optional_text(value: &Value, key: &str) -> Option<String> {
    value
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|t| !t.is_empty())
        .map(str::to_owned)
}

fn integer(value: &Value, key: &str, fallback: i64) -> i64 {
    value.get(key).and_then(Value::as_i64).unwrap_or(fallback)
}

fn new_attendance_id(prefix: &str) -> String {
    let mut bytes = [0u8; 16];
    rand_core::RngCore::fill_bytes(&mut rand_core::OsRng, &mut bytes);
    let mut id = String::with_capacity(prefix.len() + 32);
    id.push_str(prefix);
    for byte in bytes {
        id.push_str(&format!("{byte:02x}"));
    }
    id
}

fn sqlite_now(transaction: &rusqlite::Transaction<'_>) -> String {
    transaction
        .query_row("SELECT datetime('now');", [], |row| row.get(0))
        .unwrap_or_default()
}

/// Status awal roster SELALU `Hadir` — TIDAK PERNAH diturunkan dari scan gerbang.
///
/// Mengisi `Alfa` untuk siswa tanpa scan gerbang berarti menghukum kegagalan
/// infrastruktur: kartu tertinggal, antrean panjang, atau scanner mati. Kedua
/// jenis kesalahan di sini tidak setara — Alfa yang keliru ikut mengalir ke
/// notifikasi wali, catatan BK, dan laporan `BOLOS_DI_SEKOLAH`, sedangkan Hadir
/// yang keliru dikoreksi guru yang sedang menatap kelasnya sendiri. Jadi sistem
/// sengaja gagal ke arah yang bisa dipulihkan.
///
/// Data gerbang tetap dikirim (`jam_masuk`, `gate_status`) sebagai badge visual
/// pemandu, dan anomali `TANPA_SCAN_GERBANG` yang menjaring sisi sebaliknya —
/// siswa yang ditandai Hadir tetapi tidak pernah scan gerbang.
///
/// Nilainya dulu ditulis sebagai percabangan `if jam_masuk.is_some() { "Hadir" }
/// else { "Hadir" }`. Bentuk itu tidak menyampaikan apa pun kepada pembaca dan
/// justru MEMANCING orang berikutnya mengisi cabang kosongnya dengan `Alfa` —
/// persis keputusan yang ingin dihindari.
const DEFAULT_ROSTER_STATUS: &str = "Hadir";

/// Gerbang nilai `presensi_mapel_detail.status`.
///
/// Kosong berarti "belum ditandai" dan sengaja jatuh ke `Hadir` — itu bawaan
/// yang sama dengan `COALESCE(d.status, 'Hadir')` pada query roster dan dengan
/// tombol "Tandai Semua Hadir".
///
/// Nilai tak dikenal DITOLAK. Versi sebelumnya mengubahnya menjadi `Hadir`
/// secara diam-diam, sehingga bug klien atau nilai status baru akan menandai
/// siswa yang justru tidak hadir sebagai HADIR tanpa satu pun tanda — gagal ke
/// arah yang paling merugikan. CHECK constraint SQLite dan validator Zod
/// sama-sama mengeja kelima nilai ini; menolak di sini membuat ketiganya
/// sepakat dan memberi pesan yang bisa ditindaklanjuti operator.
fn class_status(raw: &str) -> Result<&str, CommandError> {
    match raw {
        "" => Ok("Hadir"),
        "Hadir" | "Izin" | "Sakit" | "Alfa" | "Dispensasi" => Ok(raw),
        other => Err(CommandError::new(
            "VALIDATION_ERROR",
            format!(
                "Status kehadiran '{other}' tidak dikenal. Gunakan Hadir, Izin, Sakit, Alfa, atau Dispensasi."
            ),
        )),
    }
}

/// Batas STRUKTURAL jam pelajaran — pagar terluar, bukan kebijakan sekolah.
///
/// Angka ini hanya menjaga agar teks asing tidak masuk ke kolom yang ikut
/// disinkronkan; jumlah jam pelajaran yang benar-benar dipakai sebuah sekolah
/// diatur terpisah lewat `jp_max_per_hari` di `setting_gex_system`. Keduanya
/// dipisah karena sifatnya berbeda: yang ini melindungi database dan karena itu
/// dieja di kode, yang satu lagi keputusan sekolah dan bisa diubah tanpa
/// memasang ulang aplikasi.
///
/// Dinaikkan dari 12 ke 20: pesantren dan sekolah berasrama benar-benar punya
/// jam pelajaran sampai belasan, dan batas lama menguncinya tanpa alasan
/// teknis apa pun. Cerminan `MAX_JAM_KE` di `class-attendance.ts`.
const MAX_JAM_KE: u32 = 20;

/// Jenis baris pada jadwal bel sekolah. Cerminan `JENIS_JAM_PELAJARAN` di
/// `class-attendance.ts`, dan WAJIB sama dengan CHECK constraint tabelnya.
const JENIS_JAM_PELAJARAN: &[&str] = &["KBM", "Istirahat", "Upacara", "Ekstrakurikuler"];

/// Normalisasi jam dinding `HH:MM` pada jadwal bel.
///
/// Menerima `7:5` dan mengembalikan `07:05`, karena orang mengetik jam seperti
/// itu; menolak apa pun yang bukan jam. Kolomnya TEKS dan ikut disinkronkan,
/// jadi satu ejaan bebas akan membuat pengurutan bel berantakan di perangkat
/// lain tanpa pesan apa pun.
///
/// Cerminan `normalizeJamBel` di `class-attendance.ts`; keduanya diuji dengan
/// vektor yang sama.
pub fn normalize_jam_bel(raw: &str) -> Option<String> {
    let compact: String = raw.chars().filter(|c| !c.is_whitespace()).collect();
    let (jam_text, menit_text) = compact.split_once(':')?;

    let angka = |bagian: &str| -> Option<u32> {
        if bagian.is_empty()
            || bagian.len() > 2
            || !bagian.chars().all(|c| c.is_ascii_digit())
        {
            return None;
        }
        bagian.parse::<u32>().ok()
    };

    let jam = angka(jam_text)?;
    let menit = angka(menit_text)?;
    if jam > 23 || menit > 59 {
        return None;
    }
    Some(format!("{jam:02}:{menit:02}"))
}

/// Kunci `setting_gex_system` untuk jumlah jam pelajaran per hari.
pub const JP_MAX_PER_DAY_SETTING_KEY: &str = "jp_max_per_hari";

/// Kunci `setting_gex_system` untuk lama satu jam pelajaran (menit).
pub const JP_DURATION_SETTING_KEY: &str = "jp_durasi_menit";

/// Jumlah jam pelajaran per hari bila sekolah belum mengaturnya.
pub const DEFAULT_JP_MAX_PER_DAY: u32 = 12;

/// Lama satu jam pelajaran bila sekolah belum mengaturnya (menit).
pub const DEFAULT_JP_DURATION_MINUTES: u32 = 45;

/// Membaca `jp_max_per_hari` dari nilai mentah `setting_gex_system`.
///
/// Nilai yang hilang, bukan angka, atau di luar `1..MAX_JAM_KE` jatuh ke bawaan
/// — BUKAN ke nol dan bukan ke batas struktural. Nol akan membuat setiap
/// presensi ditolak, dan batas struktural akan diam-diam melonggarkan kebijakan
/// sekolah yang justru sedang salah tulis.
///
/// Cerminan `parseJpMaxPerDay` di `class-attendance.ts`; keduanya diuji dengan
/// vektor yang sama.
pub fn jp_max_per_day(raw: Option<&str>) -> u32 {
    raw.and_then(|value| value.trim().parse::<u32>().ok())
        .filter(|value| (1..=MAX_JAM_KE).contains(value))
        .unwrap_or(DEFAULT_JP_MAX_PER_DAY)
}

/// Membaca `jp_durasi_menit`. Angka ini TIDAK mengubah nominal gaji: honor guru
/// dibayar per jam pelajaran, bukan per menit.
///
/// Cerminan `parseJpDuration` di `class-attendance.ts`.
pub fn jp_duration_minutes(raw: Option<&str>) -> u32 {
    raw.and_then(|value| value.trim().parse::<u32>().ok())
        .filter(|value| (1..=240).contains(value))
        .unwrap_or(DEFAULT_JP_DURATION_MINUTES)
}

/// Jadwal bel sekolah, urut menurut jam pelajaran lalu jam mulai.
///
/// Tanpa LIMIT: satu baris per jam pelajaran per hari sekolah — dibatasi
/// `jp_max_per_hari` ditambah beberapa baris istirahat, bukan oleh waktu.
pub fn list_lesson_periods(state: &DesktopState) -> Result<Value, CommandError> {
    let conn = storage::database(&state.data_dir)?;
    let mut stmt = conn
        .prepare(
            r#"
            SELECT id_jam_pelajaran, jam_ke, jam_mulai, jam_selesai, jenis,
                   COALESCE(keterangan, ''), is_aktif, created_at, updated_at
            FROM akademik_jam_pelajaran
            ORDER BY jam_ke, jam_mulai;
            "#,
        )
        .map_err(|_| CommandError::internal())?;

    let rows = stmt
        .query_map([], |row| {
            Ok(json!({
                "id_jam_pelajaran": row.get::<_, String>(0)?,
                "jam_ke": row.get::<_, i64>(1)?,
                "jam_mulai": row.get::<_, String>(2)?,
                "jam_selesai": row.get::<_, String>(3)?,
                "jenis": row.get::<_, String>(4)?,
                "keterangan": row.get::<_, String>(5)?,
                "is_aktif": row.get::<_, i64>(6)?,
                "created_at": row.get::<_, String>(7)?,
                "updated_at": row.get::<_, String>(8)?,
            }))
        })
        .map_err(|_| CommandError::internal())?;

    Ok(Value::Array(rows.flatten().collect()))
}

/// Menyimpan satu baris jadwal bel.
pub fn save_lesson_period(state: &DesktopState, draft: &Value) -> Result<Value, CommandError> {
    let id_masuk = text(draft, "id_jam_pelajaran").to_owned();
    let is_new = id_masuk.is_empty();
    let id = if is_new {
        new_attendance_id("jp_")
    } else {
        id_masuk
    };

    let jam_ke = integer(draft, "jam_ke", 0);
    let jam_mulai = normalize_jam_bel(text(draft, "jam_mulai")).ok_or_else(|| {
        CommandError::new(
            "VALIDATION_ERROR",
            "Jam mulai harus berbentuk jam, misalnya 07:00.",
        )
    })?;
    let jam_selesai = normalize_jam_bel(text(draft, "jam_selesai")).ok_or_else(|| {
        CommandError::new(
            "VALIDATION_ERROR",
            "Jam selesai harus berbentuk jam, misalnya 07:45.",
        )
    })?;
    let jenis = {
        let value = text(draft, "jenis");
        let value = if value.is_empty() { "KBM" } else { value };
        if !JENIS_JAM_PELAJARAN.contains(&value) {
            return Err(CommandError::new(
                "VALIDATION_ERROR",
                "Jenis jam pelajaran tidak dikenal.",
            ));
        }
        value.to_owned()
    };
    let keterangan = optional_text(draft, "keterangan");
    let is_aktif = if integer(draft, "is_aktif", 1) == 0 { 0 } else { 1 };

    let mut conn = storage::database(&state.data_dir)?;
    let batas = configured_jp_max(&conn)?;
    if jam_ke < 1 || jam_ke > i64::from(batas) {
        return Err(CommandError::new(
            "VALIDATION_ERROR",
            format!("Jam pelajaran harus di antara 1 dan {batas}, sesuai Pengaturan."),
        ));
    }
    // Jam selesai yang lebih awal daripada jam mulai bukan sekadar salah ketik:
    // ia membuat durasi negatif di layar dan pengurutan bel yang tidak masuk
    // akal. Bel yang melewati tengah malam tidak didukung — sekolah tidak
    // punya jam pelajaran seperti itu, dan menebaknya akan memaksa setiap
    // pembaca menebak hal yang sama.
    if jam_selesai <= jam_mulai {
        return Err(CommandError::new(
            "VALIDATION_ERROR",
            "Jam selesai harus lebih lambat daripada jam mulai.",
        ));
    }

    let tx = conn.transaction().map_err(|_| CommandError::internal())?;

    // Keunikan jam pelajaran ditegakkan di APLIKASI, bukan skema: tabelnya
    // sengaja tanpa UNIQUE supaya push dari perangkat offline tidak macet.
    let bentrok: bool = tx
        .prepare(
            "SELECT 1 FROM akademik_jam_pelajaran
             WHERE jam_ke = ?1 AND id_jam_pelajaran <> ?2 AND is_aktif = 1
             LIMIT 1;",
        )
        .map_err(|_| CommandError::internal())?
        .exists(params![jam_ke, id])
        .map_err(|_| CommandError::internal())?;
    if bentrok && is_aktif == 1 {
        return Err(CommandError::new(
            "DUPLICATE_PERIOD",
            format!("Jam pelajaran ke-{jam_ke} sudah terdaftar pada jadwal bel."),
        ));
    }

    let now = sqlite_now(&tx);
    let created_at = tx
        .query_row(
            "SELECT created_at FROM akademik_jam_pelajaran WHERE id_jam_pelajaran = ?1;",
            params![id],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|_| CommandError::internal())?
        .unwrap_or_else(|| now.clone());

    tx.execute(
        r#"
        INSERT INTO akademik_jam_pelajaran (
            id_jam_pelajaran, jam_ke, jam_mulai, jam_selesai, jenis,
            keterangan, is_aktif, created_at, updated_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
        ON CONFLICT(id_jam_pelajaran) DO UPDATE SET
            jam_ke = excluded.jam_ke,
            jam_mulai = excluded.jam_mulai,
            jam_selesai = excluded.jam_selesai,
            jenis = excluded.jenis,
            keterangan = excluded.keterangan,
            is_aktif = excluded.is_aktif,
            updated_at = excluded.updated_at;
        "#,
        params![
            id,
            jam_ke,
            jam_mulai,
            jam_selesai,
            jenis,
            keterangan,
            is_aktif,
            created_at,
            now
        ],
    )
    .map_err(|_| CommandError::new("SAVE_FAILED", "Gagal menyimpan jadwal jam pelajaran."))?;

    let client_id = sync::ensure_client_id(state)?;
    let op = if is_new { "create" } else { "update" };
    sync::enqueue(
        &tx,
        &client_id,
        "academic-period",
        op,
        &id,
        &json!({
            "id_jam_pelajaran": id,
            "jam_ke": jam_ke,
            "jam_mulai": jam_mulai,
            "jam_selesai": jam_selesai,
            "jenis": jenis,
            "keterangan": keterangan,
            "is_aktif": is_aktif,
            "created_at": created_at,
            "updated_at": now,
        }),
        None,
    )?;

    tx.commit().map_err(|_| CommandError::internal())?;
    Ok(json!({ "sukses": true, "id_jam_pelajaran": id }))
}

/// Menghapus satu baris jadwal bel.
///
/// Tidak ada pemeriksaan "sedang dipakai": jadwal bel hanya KETERANGAN, dan
/// presensi yang sudah tersimpan memegang `jam_ke`-nya sendiri. Menghapus
/// barisnya membuat pukulnya berhenti ditampilkan, bukan merusak presensi.
pub fn delete_lesson_period(state: &DesktopState, id: &str) -> Result<Value, CommandError> {
    let mut conn = storage::database(&state.data_dir)?;
    let tx = conn.transaction().map_err(|_| CommandError::internal())?;

    tx.execute(
        "DELETE FROM akademik_jam_pelajaran WHERE id_jam_pelajaran = ?1;",
        params![id],
    )
    .map_err(|_| CommandError::new("DELETE_FAILED", "Gagal menghapus jadwal jam pelajaran."))?;

    let client_id = sync::ensure_client_id(state)?;
    sync::enqueue(
        &tx,
        &client_id,
        "academic-period",
        "delete",
        id,
        &json!({ "id_jam_pelajaran": id }),
        None,
    )?;

    tx.commit().map_err(|_| CommandError::internal())?;
    Ok(json!({ "sukses": true }))
}

/// Pengaturan jam pelajaran sekolah: jumlah per hari dan lama satu jam.
///
/// Dibaca bersama supaya layar presensi hanya melakukan satu panggilan.
pub fn get_jp_settings(state: &DesktopState) -> Result<Value, CommandError> {
    let conn = storage::database(&state.data_dir)?;
    let baca = |key: &str| -> Result<Option<String>, CommandError> {
        conn.query_row(
            "SELECT value FROM setting_gex_system WHERE key = ?1 LIMIT 1;",
            params![key],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|_| CommandError::internal())
    };

    Ok(json!({
        "maxPerHari": jp_max_per_day(baca(JP_MAX_PER_DAY_SETTING_KEY)?.as_deref()),
        "durasiMenit": jp_duration_minutes(baca(JP_DURATION_SETTING_KEY)?.as_deref()),
        "batasStruktural": MAX_JAM_KE,
    }))
}

/// Menyimpan kedua pengaturan jam pelajaran.
///
/// Keduanya hidup di `setting_gex_system` yang ikut sinkronisasi: ini kebijakan
/// sekolah, bukan setelan perangkat, sehingga TIDAK boleh masuk
/// `sync::DEVICE_LOCAL_SETTING_KEYS`.
pub fn save_jp_settings(
    state: &DesktopState,
    max_per_hari: i64,
    durasi_menit: i64,
) -> Result<Value, CommandError> {
    if !(1..=i64::from(MAX_JAM_KE)).contains(&max_per_hari) {
        return Err(CommandError::new(
            "VALIDATION_ERROR",
            format!("Jumlah jam pelajaran per hari harus di antara 1 dan {MAX_JAM_KE}."),
        ));
    }
    if !(1..=240).contains(&durasi_menit) {
        return Err(CommandError::new(
            "VALIDATION_ERROR",
            "Lama satu jam pelajaran harus di antara 1 dan 240 menit.",
        ));
    }

    let client_id = sync::ensure_client_id(state)?;
    let mut conn = storage::database(&state.data_dir)?;
    let tx = conn.transaction().map_err(|_| CommandError::internal())?;

    for (key, value) in [
        (JP_MAX_PER_DAY_SETTING_KEY, max_per_hari.to_string()),
        (JP_DURATION_SETTING_KEY, durasi_menit.to_string()),
    ] {
        tx.execute(
            "INSERT INTO setting_gex_system (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value;",
            params![key, value],
        )
        .map_err(|_| {
            CommandError::new("SAVE_FAILED", "Gagal menyimpan pengaturan jam pelajaran.")
        })?;

        // Antrean lama untuk kunci yang sama dibuang lebih dulu, sama seperti
        // `save_alfa_settings`: tanpa itu nilai lama yang gagal terkirim bisa
        // menyusul nilai baru dan mengembalikannya.
        let _ = tx.execute(
            "DELETE FROM desktop_sync_conflict WHERE domain = 'setting' AND entity_key = ?1;",
            params![key],
        );
        let _ = tx.execute(
            "DELETE FROM desktop_sync_outbox WHERE domain = 'setting' AND entity_key = ?1
             AND status IN ('pending', 'failed', 'conflict');",
            params![key],
        );

        sync::enqueue(
            &tx,
            &client_id,
            "setting",
            "update",
            key,
            &json!({ "key": key, "value": value }),
            None,
        )?;
    }

    tx.commit().map_err(|_| CommandError::internal())?;
    Ok(json!({
        "sukses": true,
        "maxPerHari": max_per_hari,
        "durasiMenit": durasi_menit,
    }))
}

/// Batas jam pelajaran yang berlaku pada pemasangan ini, dibaca dari database.
fn configured_jp_max(conn: &rusqlite::Connection) -> Result<u32, CommandError> {
    let value: Option<String> = conn
        .query_row(
            "SELECT value FROM setting_gex_system WHERE key = ?1 LIMIT 1;",
            params![JP_MAX_PER_DAY_SETTING_KEY],
            |row| row.get(0),
        )
        .optional()
        .map_err(|_| CommandError::internal())?;
    Ok(jp_max_per_day(value.as_deref()))
}

/// Normalisasi dan validasi `presensi_mapel.jam_ke`.
///
/// Kolomnya TEKS, dan itu memang benar — nilainya bukan sekadar angka melainkan
/// juga RENTANG untuk blok dua jam pelajaran (`1-2`, `3-4`). Mengubahnya menjadi
/// INTEGER akan memusnahkan bagian setelah tanda hubung.
///
/// Yang kurang selama ini hanyalah gerbang isinya: sebelumnya kolom ini hanya
/// diperiksa "tidak kosong", sehingga teks apa pun bisa masuk ke tabel yang ikut
/// disinkronkan. `CAST(jam_ke AS INTEGER)` pada pengurutan akan menilai teks
/// asing sebagai 0 dan menempatkannya di urutan paling depan.
///
/// Cerminan `normalizeJamKe` di `src/lib/validations/class-attendance.ts`;
/// keduanya diuji dengan vektor yang sama.
fn normalize_jam_ke(raw: &str) -> Result<String, CommandError> {
    let compact: String = raw.chars().filter(|c| !c.is_whitespace()).collect();
    let tolak = || {
        CommandError::new(
            "VALIDATION_ERROR",
            format!(
                "Jam pelajaran '{raw}' tidak valid. Gunakan angka 1-{MAX_JAM_KE} atau rentang seperti 1-2."
            ),
        )
    };

    let angka = |bagian: &str| -> Option<u32> {
        if bagian.is_empty() || !bagian.chars().all(|c| c.is_ascii_digit()) {
            return None;
        }
        bagian
            .parse::<u32>()
            .ok()
            .filter(|value| (1..=MAX_JAM_KE).contains(value))
    };

    match compact.split_once('-') {
        None => angka(&compact).map(|v| v.to_string()).ok_or_else(tolak),
        Some((awal, akhir)) => {
            let awal = angka(awal).ok_or_else(tolak)?;
            let akhir = angka(akhir).ok_or_else(tolak)?;
            if awal >= akhir {
                return Err(tolak());
            }
            Ok(format!("{awal}-{akhir}"))
        }
    }
}

/// Rentang `(awal, akhir)` dari sebuah `jam_ke`; angka tunggal `3` menjadi `(3, 3)`.
///
/// `None` untuk nilai yang tidak lolos `normalize_jam_ke` — termasuk baris lama
/// yang tersimpan sebelum gerbang itu ada. Pemanggil yang membandingkan dengan
/// baris tersimpan WAJIB memperlakukan `None` sebagai "tidak diketahui", bukan
/// sebagai bentrok: teks asing di satu baris lama tidak boleh mengunci seluruh
/// jadwal rombel itu dari presensi baru.
///
/// Cerminan `rentangJamKe` di `src/lib/validations/class-attendance.ts`;
/// keduanya diuji dengan vektor yang sama.
/// Gerbang `jam_ke` untuk modul lain (jadwal mengajar).
///
/// Dibuka lewat pembungkus, bukan dengan mengubah `normalize_jam_ke` menjadi
/// publik: aturannya tetap hidup di modul presensi, tempat ia dipakai pertama
/// kali dan diuji.
pub(crate) fn normalize_jam_ke_public(raw: &str) -> Result<String, CommandError> {
    normalize_jam_ke(raw)
}

/// Irisan `jam_ke` untuk modul lain (jadwal mengajar).
pub(crate) fn jam_ke_overlaps_public(a: &str, b: &str) -> bool {
    jam_ke_overlaps(a, b)
}

pub(crate) fn jam_ke_range(raw: &str) -> Option<(u32, u32)> {
    let normal = normalize_jam_ke(raw).ok()?;
    match normal.split_once('-') {
        None => normal.parse::<u32>().ok().map(|v| (v, v)),
        Some((awal, akhir)) => Some((awal.parse().ok()?, akhir.parse().ok()?)),
    }
}

/// Apakah dua `jam_ke` memakai setidaknya satu jam pelajaran yang sama?
///
/// Membandingkan IRISAN, bukan teks: `1-2` dan `2` sama-sama memakai jam ke-2.
/// Pemeriksaan duplikat lama mencocokkan teks persis, sehingga pasangan itu
/// lolos sebagai dua sesi dan jam ke-2 tercatat dua kali — begitu JP menjadi
/// dasar honor guru, itu berarti membayar satu jam dua kali.
///
/// Cerminan `jamKeBeririsan` di `src/lib/validations/class-attendance.ts`.
fn jam_ke_overlaps(a: &str, b: &str) -> bool {
    match (jam_ke_range(a), jam_ke_range(b)) {
        (Some((a_awal, a_akhir)), Some((b_awal, b_akhir))) => {
            a_awal <= b_akhir && b_awal <= a_akhir
        }
        _ => false,
    }
}

/// `jam_ke` sesi lain yang beririsan dengan sesi yang sedang disimpan.
///
/// Cakupannya sengaja (rombel, mapel, tanggal) — BUKAN seluruh rombel dan BUKAN
/// seluruh sesi guru:
/// - Dua MAPEL berbeda pada rombel dan jam yang sama itu sah: pelajaran Agama
///   memecah satu rombel menjadi PAI dan PAK yang berjalan bersamaan.
/// - Satu GURU pada dua rombel di jam yang sama juga sah: kelas gabungan
///   (Agama lintas rombel, PJOK) tetap butuh presensi per rombel.
///
/// Menolak keduanya akan memblokir presensi yang benar. Pembayaran ganda pada
/// kasus kedua dicegah di rekap honor, yang menghitung GABUNGAN jam per guru
/// per hari, bukan di sini.
///
/// Tidak ada `LIMIT`: dipatok `tanggal = ?` pada satu rombel dan satu mapel,
/// jadi hasilnya paling banyak beberapa sesi dalam sehari.
fn find_overlapping_session(
    conn: &rusqlite::Connection,
    id_tahun_ajaran: &str,
    id_rombel: &str,
    id_mapel: &str,
    tanggal: &str,
    jam_ke: &str,
    id_presensi: &str,
) -> Result<Option<String>, CommandError> {
    let mut stmt = conn
        .prepare(
            r#"
            SELECT jam_ke FROM presensi_mapel
            WHERE id_tahun_ajaran = ?1
              AND id_rombel = ?2
              AND id_mapel = ?3
              AND tanggal = ?4
              AND id_presensi_mapel <> ?5;
            "#,
        )
        .map_err(|_| CommandError::internal())?;
    let lain = stmt
        .query_map(
            params![id_tahun_ajaran, id_rombel, id_mapel, tanggal, id_presensi],
            |row| row.get::<_, String>(0),
        )
        .map_err(|_| CommandError::internal())?
        .filter_map(Result::ok)
        .find(|tersimpan| jam_ke_overlaps(jam_ke, tersimpan));
    Ok(lain)
}

/// Ringkasan scan gerbang: SATU baris per (siswa, tanggal).
///
/// `absensi_harian` ber-PK `id_absensi AUTOINCREMENT` dengan `id_sesi` UNIQUE,
/// sehingga shift ber-`izinkan_multi_sesi` menghasilkan BEBERAPA baris untuk
/// satu orang pada satu tanggal. Menjoin tabel itu secara langsung menggandakan
/// setiap baris roster dan setiap baris anomali sebanyak jumlah sesinya — guru
/// akan melihat siswa yang sama dua kali di daftar presensi.
///
/// `hadir_gerbang` dihitung di sini supaya aturannya tidak perlu diulang di
/// setiap klausa WHERE, dan `NULLIF(TRIM(...))` menutup kasus `jam_masuk`
/// berisi string kosong yang lolos dari pemeriksaan `IS NOT NULL`.
///
/// `status_kehadiran` memakai MAX agar hasilnya deterministik; pada hari dengan
/// beberapa sesi, status yang "lebih berat" secara leksikografis (mis.
/// `Terlambat` di atas `Hadir`) yang ditampilkan.
const GATE_SUMMARY_SUBQUERY: &str = r#"(
            SELECT
                id_karyawan,
                tanggal,
                MIN(NULLIF(TRIM(jam_masuk), '')) AS jam_masuk,
                MAX(CASE
                      WHEN COALESCE(TRIM(jam_masuk), '') <> ''
                       AND COALESCE(status_kehadiran, '') <> 'Alfa'
                      THEN 1 ELSE 0
                    END) AS hadir_gerbang,
                MAX(COALESCE(status_kehadiran, '')) AS status_kehadiran
            FROM absensi_harian
            GROUP BY id_karyawan, tanggal
        )"#;

// ── 1. Daftar Sesi Presensi Mapel ──────────────────────────────────────────

pub fn list_class_attendance_sessions(
    state: &DesktopState,
    params: &Value,
) -> Result<Value, CommandError> {
    let conn = storage::database(&state.data_dir)?;

    let id_tahun_ajaran = optional_text(params, "id_tahun_ajaran");
    let id_rombel = optional_text(params, "id_rombel");
    let id_mapel = optional_text(params, "id_mapel");
    let id_guru = optional_text(params, "id_guru");
    let tanggal = optional_text(params, "tanggal");
    let start_date = optional_text(params, "start_date");
    let end_date = optional_text(params, "end_date");
    let limit = integer(params, "limit", 100);

    let sql = r#"
        SELECT
            p.id_presensi_mapel,
            p.id_tahun_ajaran,
            COALESCE(ta.nama_tahun, '') AS nama_tahun,
            COALESCE(ta.semester, '') AS semester,
            p.id_rombel,
            COALESCE(r.nama_rombel, '') AS nama_rombel,
            COALESCE(r.tingkat, 0) AS tingkat,
            p.id_mapel,
            COALESCE(m.nama_mapel, '') AS nama_mapel,
            COALESCE(m.kode_mapel, '') AS kode_mapel,
            p.id_guru,
            COALESCE(g.nama, '') AS nama_guru,
            p.tanggal,
            p.jam_ke,
            p.materi_pokok,
            p.catatan,
            p.total_hadir,
            p.total_izin,
            p.total_sakit,
            p.total_alfa,
            p.total_dispensasi,
            p.created_at,
            p.updated_at
        FROM presensi_mapel p
        LEFT JOIN akademik_tahun_ajaran ta ON ta.id_tahun_ajaran = p.id_tahun_ajaran
        LEFT JOIN akademik_rombel r ON r.id_rombel = p.id_rombel
        LEFT JOIN akademik_mapel m ON m.id_mapel = p.id_mapel
        LEFT JOIN master_data g ON g.id_unik = p.id_guru
        WHERE (?1 IS NULL OR p.id_tahun_ajaran = ?1)
          AND (?2 IS NULL OR p.id_rombel = ?2)
          AND (?3 IS NULL OR p.id_mapel = ?3)
          AND (?4 IS NULL OR p.id_guru = ?4)
          AND (?5 IS NULL OR p.tanggal = ?5)
          AND (?6 IS NULL OR p.tanggal >= ?6)
          AND (?7 IS NULL OR p.tanggal <= ?7)
        ORDER BY p.tanggal DESC, CAST(p.jam_ke AS INTEGER) ASC, p.jam_ke ASC, p.created_at DESC
        LIMIT ?8;
    "#;

    let mut stmt = conn.prepare(sql).map_err(|_| CommandError::internal())?;
    let rows = stmt
        .query_map(
            params![
                id_tahun_ajaran,
                id_rombel,
                id_mapel,
                id_guru,
                tanggal,
                start_date,
                end_date,
                limit
            ],
            |row| {
                Ok(json!({
                    "id_presensi_mapel": row.get::<_, String>(0)?,
                    "id_tahun_ajaran": row.get::<_, String>(1)?,
                    "nama_tahun": row.get::<_, String>(2)?,
                    "semester": row.get::<_, String>(3)?,
                    "id_rombel": row.get::<_, String>(4)?,
                    "nama_rombel": row.get::<_, String>(5)?,
                    "tingkat": row.get::<_, i64>(6)?,
                    "id_mapel": row.get::<_, String>(7)?,
                    "nama_mapel": row.get::<_, String>(8)?,
                    "kode_mapel": row.get::<_, String>(9)?,
                    "id_guru": row.get::<_, String>(10)?,
                    "nama_guru": row.get::<_, String>(11)?,
                    "tanggal": row.get::<_, String>(12)?,
                    "jam_ke": row.get::<_, String>(13)?,
                    "materi_pokok": row.get::<_, Option<String>>(14)?,
                    "catatan": row.get::<_, Option<String>>(15)?,
                    "total_hadir": row.get::<_, i64>(16)?,
                    "total_izin": row.get::<_, i64>(17)?,
                    "total_sakit": row.get::<_, i64>(18)?,
                    "total_alfa": row.get::<_, i64>(19)?,
                    "total_dispensasi": row.get::<_, i64>(20)?,
                    "created_at": row.get::<_, String>(21)?,
                    "updated_at": row.get::<_, String>(22)?,
                }))
            },
        )
        .map_err(|_| CommandError::internal())?
        .filter_map(Result::ok)
        .collect::<Vec<_>>();

    Ok(json!(rows))
}

// ── 2. Detail Sesi Presensi Mapel Beserta Roster Siswa ───────────────────────

pub fn get_class_attendance_detail(
    state: &DesktopState,
    id_presensi_mapel: &str,
) -> Result<Value, CommandError> {
    let conn = storage::database(&state.data_dir)?;

    let session_sql = r#"
        SELECT
            p.id_presensi_mapel,
            p.id_tahun_ajaran,
            COALESCE(ta.nama_tahun, '') AS nama_tahun,
            COALESCE(ta.semester, '') AS semester,
            p.id_rombel,
            COALESCE(r.nama_rombel, '') AS nama_rombel,
            COALESCE(r.tingkat, 0) AS tingkat,
            p.id_mapel,
            COALESCE(m.nama_mapel, '') AS nama_mapel,
            COALESCE(m.kode_mapel, '') AS kode_mapel,
            p.id_guru,
            COALESCE(g.nama, '') AS nama_guru,
            p.tanggal,
            p.jam_ke,
            p.materi_pokok,
            p.catatan,
            p.total_hadir,
            p.total_izin,
            p.total_sakit,
            p.total_alfa,
            p.total_dispensasi,
            p.created_at,
            p.updated_at
        FROM presensi_mapel p
        LEFT JOIN akademik_tahun_ajaran ta ON ta.id_tahun_ajaran = p.id_tahun_ajaran
        LEFT JOIN akademik_rombel r ON r.id_rombel = p.id_rombel
        LEFT JOIN akademik_mapel m ON m.id_mapel = p.id_mapel
        LEFT JOIN master_data g ON g.id_unik = p.id_guru
        WHERE p.id_presensi_mapel = ?1
        LIMIT 1;
    "#;

    let session = conn
        .query_row(session_sql, params![id_presensi_mapel], |row| {
            Ok(json!({
                "id_presensi_mapel": row.get::<_, String>(0)?,
                "id_tahun_ajaran": row.get::<_, String>(1)?,
                "nama_tahun": row.get::<_, String>(2)?,
                "semester": row.get::<_, String>(3)?,
                "id_rombel": row.get::<_, String>(4)?,
                "nama_rombel": row.get::<_, String>(5)?,
                "tingkat": row.get::<_, i64>(6)?,
                "id_mapel": row.get::<_, String>(7)?,
                "nama_mapel": row.get::<_, String>(8)?,
                "kode_mapel": row.get::<_, String>(9)?,
                "id_guru": row.get::<_, String>(10)?,
                "nama_guru": row.get::<_, String>(11)?,
                "tanggal": row.get::<_, String>(12)?,
                "jam_ke": row.get::<_, String>(13)?,
                "materi_pokok": row.get::<_, Option<String>>(14)?,
                "catatan": row.get::<_, Option<String>>(15)?,
                "total_hadir": row.get::<_, i64>(16)?,
                "total_izin": row.get::<_, i64>(17)?,
                "total_sakit": row.get::<_, i64>(18)?,
                "total_alfa": row.get::<_, i64>(19)?,
                "total_dispensasi": row.get::<_, i64>(20)?,
                "created_at": row.get::<_, String>(21)?,
                "updated_at": row.get::<_, String>(22)?,
            }))
        })
        .map_err(|_| CommandError::new("NOT_FOUND", "Sesi presensi tidak ditemukan."))?;

    let id_rombel = session["id_rombel"].as_str().unwrap_or_default();
    let tanggal = session["tanggal"].as_str().unwrap_or_default();

    let details_sql = format!(
        r#"
        SELECT
            s.id_siswa,
            s.nis,
            s.nisn,
            s.nama_lengkap,
            s.jenis_kelamin,
            s.no_whatsapp_wali,
            s.nama_wali,
            d.id_detail,
            COALESCE(d.status, 'Hadir') AS status,
            COALESCE(d.catatan, '') AS catatan,
            ah.jam_masuk,
            ah.status_kehadiran AS gate_status
        FROM siswa_data s
        JOIN master_data md ON md.id_unik = s.id_siswa
        LEFT JOIN presensi_mapel_detail d
            ON d.id_presensi_mapel = ?1 AND d.id_siswa = s.id_siswa
        LEFT JOIN {gate} ah
            ON ah.id_karyawan = s.id_siswa AND ah.tanggal = ?2
        WHERE s.id_rombel = ?3 AND s.status = 'Aktif'
        ORDER BY s.nama_lengkap ASC;
    "#,
        gate = GATE_SUMMARY_SUBQUERY
    );

    let mut stmt = conn
        .prepare(&details_sql)
        .map_err(|_| CommandError::internal())?;
    let details = stmt
        .query_map(params![id_presensi_mapel, tanggal, id_rombel], |row| {
            Ok(json!({
                "id_siswa": row.get::<_, String>(0)?,
                "nis": row.get::<_, Option<String>>(1)?,
                "nisn": row.get::<_, Option<String>>(2)?,
                "nama_lengkap": row.get::<_, String>(3)?,
                "jenis_kelamin": row.get::<_, Option<String>>(4)?,
                "no_whatsapp_wali": row.get::<_, Option<String>>(5)?,
                "nama_wali": row.get::<_, Option<String>>(6)?,
                "id_detail": row.get::<_, Option<String>>(7)?,
                "status": row.get::<_, String>(8)?,
                "catatan": row.get::<_, String>(9)?,
                "jam_masuk": row.get::<_, Option<String>>(10)?,
                "gate_status": row.get::<_, Option<String>>(11)?,
            }))
        })
        .map_err(|_| CommandError::internal())?
        .filter_map(Result::ok)
        .collect::<Vec<_>>();

    Ok(json!({
        "session": session,
        "details": details,
    }))
}

// ── 3. Roster Siswa Kelas untuk Pembukaan Sesi Baru ──────────────────────────

pub fn get_roster_for_attendance(
    state: &DesktopState,
    id_rombel: &str,
    tanggal: &str,
) -> Result<Value, CommandError> {
    let conn = storage::database(&state.data_dir)?;

    let roster_sql = format!(
        r#"
        SELECT
            s.id_siswa,
            s.nis,
            s.nisn,
            s.nama_lengkap,
            s.jenis_kelamin,
            s.no_whatsapp_wali,
            s.nama_wali,
            ah.jam_masuk,
            ah.status_kehadiran AS gate_status
        FROM siswa_data s
        JOIN master_data md ON md.id_unik = s.id_siswa
        LEFT JOIN {gate} ah
            ON ah.id_karyawan = s.id_siswa AND ah.tanggal = ?1
        WHERE s.id_rombel = ?2 AND s.status = 'Aktif'
        ORDER BY s.nama_lengkap ASC;
    "#,
        gate = GATE_SUMMARY_SUBQUERY
    );

    let mut stmt = conn
        .prepare(&roster_sql)
        .map_err(|_| CommandError::internal())?;
    let roster = stmt
        .query_map(params![tanggal, id_rombel], |row| {
            let jam_masuk = row.get::<_, Option<String>>(7)?;
            let gate_status = row.get::<_, Option<String>>(8)?;

            Ok(json!({
                "id_siswa": row.get::<_, String>(0)?,
                "nis": row.get::<_, Option<String>>(1)?,
                "nisn": row.get::<_, Option<String>>(2)?,
                "nama_lengkap": row.get::<_, String>(3)?,
                "jenis_kelamin": row.get::<_, Option<String>>(4)?,
                "no_whatsapp_wali": row.get::<_, Option<String>>(5)?,
                "nama_wali": row.get::<_, Option<String>>(6)?,
                "status": DEFAULT_ROSTER_STATUS,
                "catatan": "",
                "jam_masuk": jam_masuk,
                "gate_status": gate_status,
            }))
        })
        .map_err(|_| CommandError::internal())?
        .filter_map(Result::ok)
        .collect::<Vec<_>>();

    Ok(json!(roster))
}

// ── 4. Simpan Sesi Presensi & Detail Roster (Atomic Transaksi + Outbox) ──────

pub fn save_class_attendance(state: &DesktopState, draft: &Value) -> Result<Value, CommandError> {
    let mut conn = storage::database(&state.data_dir)?;
    let tx = conn.transaction().map_err(|_| CommandError::internal())?;

    let now = sqlite_now(&tx);
    let is_new = text(draft, "id_presensi_mapel").is_empty();
    let id_presensi = if is_new {
        new_attendance_id("pm_")
    } else {
        text(draft, "id_presensi_mapel").to_owned()
    };

    let id_tahun_ajaran = text(draft, "id_tahun_ajaran");
    let id_rombel = text(draft, "id_rombel");
    let id_mapel = text(draft, "id_mapel");
    let id_guru = text(draft, "id_guru");
    let tanggal = text(draft, "tanggal");
    let jam_ke = text(draft, "jam_ke");
    let materi_pokok = optional_text(draft, "materi_pokok");
    let catatan = optional_text(draft, "catatan");

    if id_tahun_ajaran.is_empty()
        || id_rombel.is_empty()
        || id_mapel.is_empty()
        || id_guru.is_empty()
        || tanggal.is_empty()
        || jam_ke.is_empty()
    {
        return Err(CommandError::new(
            "VALIDATION_ERROR",
            "Tahun ajaran, rombel, mata pelajaran, guru, tanggal, dan jam ke wajib diisi.",
        ));
    }

    // Dinormalkan SEBELUM pemeriksaan duplikat: tanpa itu "1-2" dan "1 - 2"
    // terbaca sebagai dua sesi berbeda untuk jam pelajaran yang sama.
    let jam_ke = normalize_jam_ke(jam_ke)?;
    let jam_ke = jam_ke.as_str();

    // Batas sekolah ditegakkan SETELAH batas struktural: yang pertama menjaga
    // databasenya, yang kedua kebijakan sekolahnya. Pesan errornya menyebut
    // angka yang benar-benar dipakai sekolah itu, bukan pagar terluarnya.
    let batas_sekolah = configured_jp_max(&tx)?;
    if let Some((_, akhir)) = jam_ke_range(jam_ke) {
        if akhir > batas_sekolah {
            return Err(CommandError::new(
                "VALIDATION_ERROR",
                format!(
                    "Sekolah ini memakai {batas_sekolah} jam pelajaran per hari, sehingga jam ke-{akhir} tidak tersedia. Ubah di Pengaturan bila jumlahnya bertambah."
                ),
            ));
        }
    }

    // Aturan 32: Tegakkan keunikan sesi di aplikasi, bukan skema DB. Yang
    // diperiksa adalah IRISAN jamnya, bukan teksnya: `1-2` dan `2` adalah dua
    // baris berbeda bagi `=`, padahal keduanya memakai jam ke-2 yang sama.
    if let Some(bentrok) = find_overlapping_session(
        &tx,
        id_tahun_ajaran,
        id_rombel,
        id_mapel,
        tanggal,
        jam_ke,
        &id_presensi,
    )? {
        return Err(CommandError::new(
            "DUPLICATE_SESSION",
            format!(
                "Sesi mata pelajaran ini pada rombel dan tanggal tersebut sudah tercatat di jam ke-{bentrok}, yang beririsan dengan jam ke-{jam_ke}."
            ),
        ));
    }

    let items = draft
        .get("items")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();

    let mut total_hadir: i64 = 0;
    let mut total_izin: i64 = 0;
    let mut total_sakit: i64 = 0;
    let mut total_alfa: i64 = 0;
    let mut total_dispensasi: i64 = 0;

    for item in &items {
        match class_status(text(item, "status"))? {
            "Izin" => total_izin += 1,
            "Sakit" => total_sakit += 1,
            "Alfa" => total_alfa += 1,
            "Dispensasi" => total_dispensasi += 1,
            "Hadir" => total_hadir += 1,
            other => {
                return Err(CommandError::new(
                    "VALIDATION_ERROR",
                    format!("Status kehadiran '{other}' tidak dikenal. Gunakan Hadir, Izin, Sakit, Alfa, atau Dispensasi."),
                ));
            }
        }
    }

    // 1. Simpan baris header ke presensi_mapel
    tx.execute(
        r#"
        INSERT INTO presensi_mapel (
            id_presensi_mapel, id_tahun_ajaran, id_rombel, id_mapel, id_guru,
            tanggal, jam_ke, materi_pokok, catatan,
            total_hadir, total_izin, total_sakit, total_alfa, total_dispensasi,
            created_at, updated_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)
        ON CONFLICT(id_presensi_mapel) DO UPDATE SET
            id_tahun_ajaran = excluded.id_tahun_ajaran,
            id_rombel = excluded.id_rombel,
            id_mapel = excluded.id_mapel,
            id_guru = excluded.id_guru,
            tanggal = excluded.tanggal,
            jam_ke = excluded.jam_ke,
            materi_pokok = excluded.materi_pokok,
            catatan = excluded.catatan,
            total_hadir = excluded.total_hadir,
            total_izin = excluded.total_izin,
            total_sakit = excluded.total_sakit,
            total_alfa = excluded.total_alfa,
            total_dispensasi = excluded.total_dispensasi,
            updated_at = excluded.updated_at;
        "#,
        params![
            id_presensi,
            id_tahun_ajaran,
            id_rombel,
            id_mapel,
            id_guru,
            tanggal,
            jam_ke,
            materi_pokok,
            catatan,
            total_hadir,
            total_izin,
            total_sakit,
            total_alfa,
            total_dispensasi,
            now,
            now,
        ],
    )
    .map_err(|e| CommandError::new("DB_ERROR", format!("Gagal menyimpan sesi presensi: {e}")))?;

    let client_id = sync::ensure_client_id(state)?;

    // 2. Simpan setiap baris detail ke presensi_mapel_detail & daftarkan ke outbox
    let mut siswa_terkirim: Vec<String> = Vec::with_capacity(items.len());
    for item in items {
        let id_siswa = text(&item, "id_siswa");
        if id_siswa.is_empty() {
            continue;
        }
        siswa_terkirim.push(id_siswa.to_owned());

        let status = class_status(text(&item, "status"))?;
        let catatan_item = optional_text(&item, "catatan");

        let existing_detail: Option<(String, String)> = tx
            .query_row(
                "SELECT id_detail, created_at FROM presensi_mapel_detail WHERE id_presensi_mapel = ?1 AND id_siswa = ?2 LIMIT 1;",
                params![id_presensi, id_siswa],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
            )
            .ok();

        let (id_detail, created_at) = match existing_detail {
            Some((existing_id, existing_created)) => (existing_id, existing_created),
            None => (new_attendance_id("pmd_"), now.clone()),
        };

        tx.execute(
            r#"
            INSERT INTO presensi_mapel_detail (
                id_detail, id_presensi_mapel, id_siswa, status, catatan, created_at, updated_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
            ON CONFLICT(id_detail) DO UPDATE SET
                status = excluded.status,
                catatan = excluded.catatan,
                updated_at = excluded.updated_at;
            "#,
            params![
                id_detail,
                id_presensi,
                id_siswa,
                status,
                catatan_item,
                created_at,
                now,
            ],
        )
        .map_err(|e| {
            CommandError::new("DB_ERROR", format!("Gagal menyimpan detail presensi: {e}"))
        })?;

        let detail_payload = json!({
            "id_detail": id_detail,
            "id_presensi_mapel": id_presensi,
            "id_siswa": id_siswa,
            "status": status,
            "catatan": catatan_item,
            "created_at": created_at,
            "updated_at": now,
        });

        sync::enqueue(
            &tx,
            &client_id,
            "class-attendance-detail",
            "save",
            &id_detail,
            &detail_payload,
            None,
        )?;
    }

    // 2b. Buang baris detail yang sudah tidak ada di roster yang dikirim.
    //
    // Roster yang dikirim adalah kebenaran terakhir untuk sesi ini. Tanpa
    // langkah ini, siswa yang pindah rombel akan meninggalkan baris detail lama
    // dengan status lamanya: `total_*` di header — yang dihitung ulang HANYA
    // dari item yang dikirim — tidak lagi cocok dengan isi tabel detailnya, dan
    // rekonsiliasi terus melaporkan siswa itu Alfa di kelas yang sudah ia
    // tinggalkan. Penghapusannya WAJIB punya event outbox sendiri, sebab
    // `presensi_mapel_detail` ikut disinkronkan dengan `delete_missing: false`.
    let stale: Vec<(String, String)> = {
        let mut stmt = tx
            .prepare(
                "SELECT id_detail, id_siswa FROM presensi_mapel_detail WHERE id_presensi_mapel = ?1;",
            )
            .map_err(|_| CommandError::internal())?;
        let rows = stmt
            .query_map(params![id_presensi], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })
            .map_err(|_| CommandError::internal())?
            .filter_map(Result::ok)
            .filter(|(_, id_siswa)| !siswa_terkirim.iter().any(|kirim| kirim == id_siswa))
            .collect();
        rows
    };

    for (id_detail, id_siswa) in stale {
        tx.execute(
            "DELETE FROM presensi_mapel_detail WHERE id_detail = ?1;",
            params![id_detail],
        )
        .map_err(|_| CommandError::internal())?;

        sync::enqueue(
            &tx,
            &client_id,
            "class-attendance-detail",
            "delete",
            &id_detail,
            &json!({
                "id_detail": id_detail,
                "id_presensi_mapel": id_presensi,
                "id_siswa": id_siswa,
            }),
            None,
        )?;
    }

    // 3. Daftarkan header sesi ke outbox
    let op = if is_new { "create" } else { "update" };
    let session_payload = json!({
        "id_presensi_mapel": id_presensi,
        "id_tahun_ajaran": id_tahun_ajaran,
        "id_rombel": id_rombel,
        "id_mapel": id_mapel,
        "id_guru": id_guru,
        "tanggal": tanggal,
        "jam_ke": jam_ke,
        "materi_pokok": materi_pokok,
        "catatan": catatan,
        "total_hadir": total_hadir,
        "total_izin": total_izin,
        "total_sakit": total_sakit,
        "total_alfa": total_alfa,
        "total_dispensasi": total_dispensasi,
        "created_at": now,
        "updated_at": now,
    });

    sync::enqueue(
        &tx,
        &client_id,
        "class-attendance",
        op,
        &id_presensi,
        &session_payload,
        None,
    )?;

    tx.commit().map_err(|_| CommandError::internal())?;

    Ok(json!({
        "sukses": true,
        "id_presensi_mapel": id_presensi,
    }))
}

// ── 5. Hapus Sesi Presensi & Detail (Atomic + Outbox Delete) ─────────────────

pub fn delete_class_attendance(
    state: &DesktopState,
    id_presensi_mapel: &str,
) -> Result<Value, CommandError> {
    let mut conn = storage::database(&state.data_dir)?;
    let tx = conn.transaction().map_err(|_| CommandError::internal())?;

    // Daftar jurnal memakai JOIN ke `presensi_mapel`, jadi menghapus sesinya
    // membuat jurnal itu lenyap dari tampilan tanpa pernah dihapus. Tidak ada
    // FOREIGN KEY yang menolaknya, maka penolakannya di sini — pesannya SAMA
    // dengan `deleteClassAttendance` di `lib/services/class-attendance.ts`.
    let jurnal: i64 = tx
        .query_row(
            "SELECT COUNT(*) FROM jurnal_mengajar WHERE id_presensi_mapel = ?1;",
            params![id_presensi_mapel],
            |row| row.get(0),
        )
        .map_err(|_| CommandError::internal())?;
    if jurnal > 0 {
        return Err(CommandError::new(
            "CLASS_ATTENDANCE_HAS_JOURNAL",
            "Sesi presensi ini sudah punya jurnal mengajar. Hapus jurnalnya lebih dulu lewat menu Jurnal Mengajar.",
        ));
    }

    tx.execute(
        "DELETE FROM presensi_mapel_detail WHERE id_presensi_mapel = ?1;",
        params![id_presensi_mapel],
    )
    .map_err(|_| CommandError::internal())?;

    tx.execute(
        "DELETE FROM presensi_mapel WHERE id_presensi_mapel = ?1;",
        params![id_presensi_mapel],
    )
    .map_err(|_| CommandError::internal())?;

    let client_id = sync::ensure_client_id(state)?;
    let payload = json!({
        "id_presensi_mapel": id_presensi_mapel,
    });

    sync::enqueue(
        &tx,
        &client_id,
        "class-attendance",
        "delete",
        id_presensi_mapel,
        &payload,
        None,
    )?;

    tx.commit().map_err(|_| CommandError::internal())?;

    Ok(json!({ "sukses": true }))
}

// ── 6. Rekonsiliasi & Deteksi Bolos di Sekolah ───────────────────────────────

pub fn get_attendance_reconciliation(
    state: &DesktopState,
    params: &Value,
) -> Result<Value, CommandError> {
    let conn = storage::database(&state.data_dir)?;

    // "Hari ini" WAJIB dihitung dalam WIB, bukan UTC.
    //
    // `date('now')` mengembalikan tanggal UTC, sehingga antara pukul 00:00 dan
    // 07:00 WIB ia menunjuk KEMARIN — persis jam ketika wali kelas menyiapkan
    // presensi pagi. Formulanya disamakan dengan `current_jakarta_moment` di
    // `scanner.rs` dan seluruh query di `administration.rs`.
    let tanggal = match optional_text(params, "tanggal") {
        Some(value) => value,
        None => conn
            .query_row("SELECT date('now','+7 hours');", [], |row| {
                row.get::<_, String>(0)
            })
            // Tanggal cadangan yang dipaku akan mengarang hari yang salah tanpa
            // satu pun tanda; lebih baik gagal dengan jelas.
            .map_err(|_| CommandError::internal())?,
    };
    let id_rombel = optional_text(params, "id_rombel");

    // Anomali 1: "BOLOS_DI_SEKOLAH"
    // Siswa tercatat hadir di gerbang sekolah (ada jam_masuk di absensi_harian),
    // tetapi berstatus Alfa pada sesi mata pelajaran tertentu di kelas.
    let bolos_sql = format!(
        r#"
        SELECT
            s.id_siswa,
            COALESCE(s.nis, '') AS nis,
            s.nama_lengkap AS nama_siswa,
            r.id_rombel,
            r.nama_rombel,
            p.tanggal,
            ah.jam_masuk AS jam_masuk_gerbang,
            ah.status_kehadiran AS status_gerbang,
            p.id_presensi_mapel,
            m.nama_mapel,
            p.jam_ke,
            COALESCE(g.nama, '') AS nama_guru,
            d.status AS status_mapel,
            COALESCE(d.catatan, '') AS catatan_mapel,
            s.no_whatsapp_wali,
            s.nama_wali,
            'BOLOS_DI_SEKOLAH' AS anomaly_type,
            'Tercatat masuk gerbang pagi hari, tetapi Alfa pada jam pelajaran' AS anomaly_label
        FROM presensi_mapel_detail d
        JOIN presensi_mapel p ON p.id_presensi_mapel = d.id_presensi_mapel
        JOIN siswa_data s ON s.id_siswa = d.id_siswa
        JOIN akademik_rombel r ON r.id_rombel = p.id_rombel
        JOIN akademik_mapel m ON m.id_mapel = p.id_mapel
        LEFT JOIN master_data g ON g.id_unik = p.id_guru
        JOIN {gate} ah ON ah.id_karyawan = s.id_siswa AND ah.tanggal = p.tanggal
        WHERE p.tanggal = ?1
          AND (?2 IS NULL OR p.id_rombel = ?2)
          AND d.status = 'Alfa'
          AND ah.hadir_gerbang = 1
        ORDER BY r.nama_rombel ASC, s.nama_lengkap ASC, CAST(p.jam_ke AS INTEGER) ASC, p.jam_ke ASC;
    "#,
        gate = GATE_SUMMARY_SUBQUERY
    );

    let mut stmt = conn
        .prepare(&bolos_sql)
        .map_err(|_| CommandError::internal())?;
    let mut anomalies = stmt
        .query_map(params![tanggal, id_rombel], |row| {
            Ok(json!({
                "id_siswa": row.get::<_, String>(0)?,
                "nis": row.get::<_, String>(1)?,
                "nama_siswa": row.get::<_, String>(2)?,
                "id_rombel": row.get::<_, String>(3)?,
                "nama_rombel": row.get::<_, String>(4)?,
                "tanggal": row.get::<_, String>(5)?,
                "jam_masuk_gerbang": row.get::<_, Option<String>>(6)?,
                "status_gerbang": row.get::<_, Option<String>>(7)?,
                "id_presensi_mapel": row.get::<_, String>(8)?,
                "nama_mapel": row.get::<_, String>(9)?,
                "jam_ke": row.get::<_, String>(10)?,
                "nama_guru": row.get::<_, String>(11)?,
                "status_mapel": row.get::<_, String>(12)?,
                "catatan_mapel": row.get::<_, String>(13)?,
                "no_whatsapp_wali": row.get::<_, Option<String>>(14)?,
                "nama_wali": row.get::<_, Option<String>>(15)?,
                "anomaly_type": row.get::<_, String>(16)?,
                "anomaly_label": row.get::<_, String>(17)?,
            }))
        })
        .map_err(|_| CommandError::internal())?
        .filter_map(Result::ok)
        .collect::<Vec<_>>();

    // Anomali 2: "HADIR_TANPA_SCAN_GERBANG"
    // Siswa berstatus Hadir di sesi mapel, namun tidak memiliki rekaman jam_masuk gerbang sekolah.
    let tanpa_scan_sql = format!(
        r#"
        SELECT
            s.id_siswa,
            COALESCE(s.nis, '') AS nis,
            s.nama_lengkap AS nama_siswa,
            r.id_rombel,
            r.nama_rombel,
            p.tanggal,
            ah.jam_masuk AS jam_masuk_gerbang,
            COALESCE(ah.status_kehadiran, 'Tidak Ada Scan') AS status_gerbang,
            p.id_presensi_mapel,
            m.nama_mapel,
            p.jam_ke,
            COALESCE(g.nama, '') AS nama_guru,
            d.status AS status_mapel,
            COALESCE(d.catatan, '') AS catatan_mapel,
            s.no_whatsapp_wali,
            s.nama_wali,
            'HADIR_TANPA_SCAN_GERBANG' AS anomaly_type,
            'Hadir di kelas, tetapi belum/tidak melakukan scan di gerbang sekolah' AS anomaly_label
        FROM presensi_mapel_detail d
        JOIN presensi_mapel p ON p.id_presensi_mapel = d.id_presensi_mapel
        JOIN siswa_data s ON s.id_siswa = d.id_siswa
        JOIN akademik_rombel r ON r.id_rombel = p.id_rombel
        JOIN akademik_mapel m ON m.id_mapel = p.id_mapel
        LEFT JOIN master_data g ON g.id_unik = p.id_guru
        LEFT JOIN {gate} ah ON ah.id_karyawan = s.id_siswa AND ah.tanggal = p.tanggal
        WHERE p.tanggal = ?1
          AND (?2 IS NULL OR p.id_rombel = ?2)
          AND d.status = 'Hadir'
          AND COALESCE(ah.hadir_gerbang, 0) = 0
        ORDER BY r.nama_rombel ASC, s.nama_lengkap ASC, CAST(p.jam_ke AS INTEGER) ASC, p.jam_ke ASC;
    "#,
        gate = GATE_SUMMARY_SUBQUERY
    );

    let mut stmt2 = conn
        .prepare(&tanpa_scan_sql)
        .map_err(|_| CommandError::internal())?;
    let mut anomalies2 = stmt2
        .query_map(params![tanggal, id_rombel], |row| {
            Ok(json!({
                "id_siswa": row.get::<_, String>(0)?,
                "nis": row.get::<_, String>(1)?,
                "nama_siswa": row.get::<_, String>(2)?,
                "id_rombel": row.get::<_, String>(3)?,
                "nama_rombel": row.get::<_, String>(4)?,
                "tanggal": row.get::<_, String>(5)?,
                "jam_masuk_gerbang": row.get::<_, Option<String>>(6)?,
                "status_gerbang": row.get::<_, Option<String>>(7)?,
                "id_presensi_mapel": row.get::<_, String>(8)?,
                "nama_mapel": row.get::<_, String>(9)?,
                "jam_ke": row.get::<_, String>(10)?,
                "nama_guru": row.get::<_, String>(11)?,
                "status_mapel": row.get::<_, String>(12)?,
                "catatan_mapel": row.get::<_, String>(13)?,
                "no_whatsapp_wali": row.get::<_, Option<String>>(14)?,
                "nama_wali": row.get::<_, Option<String>>(15)?,
                "anomaly_type": row.get::<_, String>(16)?,
                "anomaly_label": row.get::<_, String>(17)?,
            }))
        })
        .map_err(|_| CommandError::internal())?
        .filter_map(Result::ok)
        .collect::<Vec<_>>();

    anomalies.append(&mut anomalies2);

    Ok(json!({
        "tanggal": tanggal,
        "anomalies": anomalies,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_class_status_validation() {
        // Kosong default ke Hadir
        assert_eq!(class_status("").unwrap(), "Hadir");

        // 5 status kanonik diterima
        assert_eq!(class_status("Hadir").unwrap(), "Hadir");
        assert_eq!(class_status("Izin").unwrap(), "Izin");
        assert_eq!(class_status("Sakit").unwrap(), "Sakit");
        assert_eq!(class_status("Alfa").unwrap(), "Alfa");
        assert_eq!(class_status("Dispensasi").unwrap(), "Dispensasi");

        // Status asing/salah ketik WAJIB ditolak
        assert!(class_status("hadir").is_err());
        assert!(class_status("Bolos").is_err());
        assert!(class_status("Terlambat").is_err());
        assert!(class_status("Unknown").is_err());
    }

    #[test]
    fn test_total_calculation_and_classification() {
        let items = vec![
            json!({ "id_siswa": "s1", "status": "Hadir" }),
            json!({ "id_siswa": "s2", "status": "" }), // Kosong -> Hadir
            json!({ "id_siswa": "s3", "status": "Izin" }),
            json!({ "id_siswa": "s4", "status": "Sakit" }),
            json!({ "id_siswa": "s5", "status": "Alfa" }),
            json!({ "id_siswa": "s6", "status": "Dispensasi" }),
        ];

        let mut total_hadir = 0;
        let mut total_izin = 0;
        let mut total_sakit = 0;
        let mut total_alfa = 0;
        let mut total_dispensasi = 0;

        for item in &items {
            match class_status(text(item, "status")).unwrap() {
                "Izin" => total_izin += 1,
                "Sakit" => total_sakit += 1,
                "Alfa" => total_alfa += 1,
                "Dispensasi" => total_dispensasi += 1,
                "Hadir" => total_hadir += 1,
                _ => unreachable!(),
            }
        }

        assert_eq!(total_hadir, 2);
        assert_eq!(total_izin, 1);
        assert_eq!(total_sakit, 1);
        assert_eq!(total_alfa, 1);
        assert_eq!(total_dispensasi, 1);
    }

    #[test]
    fn test_numeric_jam_ke_sorting() {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        conn.execute(
            "CREATE TABLE test_jam (id TEXT PRIMARY KEY, jam_ke TEXT NOT NULL);",
            [],
        )
        .unwrap();

        let samples = ["10", "1", "2", "11", "3", "12", "4"];
        for (i, jam) in samples.iter().enumerate() {
            conn.execute(
                "INSERT INTO test_jam (id, jam_ke) VALUES (?1, ?2);",
                params![format!("id_{i}"), jam],
            )
            .unwrap();
        }

        let mut stmt = conn
            .prepare(
                "SELECT jam_ke FROM test_jam ORDER BY CAST(jam_ke AS INTEGER) ASC, jam_ke ASC;",
            )
            .unwrap();
        let sorted: Vec<String> = stmt
            .query_map([], |row| row.get(0))
            .unwrap()
            .filter_map(Result::ok)
            .collect();

        assert_eq!(sorted, vec!["1", "2", "3", "4", "10", "11", "12"]);
    }

    #[test]
    fn test_duplicate_session_prevention() {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        conn.execute(
            r#"
            CREATE TABLE presensi_mapel (
                id_presensi_mapel TEXT PRIMARY KEY,
                id_tahun_ajaran TEXT NOT NULL,
                id_rombel TEXT NOT NULL,
                id_mapel TEXT NOT NULL,
                id_guru TEXT NOT NULL,
                tanggal TEXT NOT NULL,
                jam_ke TEXT NOT NULL
            );
            "#,
            [],
        )
        .unwrap();

        conn.execute(
            r#"
            INSERT INTO presensi_mapel (
                id_presensi_mapel, id_tahun_ajaran, id_rombel, id_mapel, id_guru, tanggal, jam_ke
            ) VALUES ('pm_1', 'ta_1', 'rom_1', 'map_1', 'guru_1', '2026-09-07', '1-2');
            "#,
            [],
        )
        .unwrap();

        let cari = |jam_ke: &str, id_presensi: &str| {
            find_overlapping_session(
                &conn,
                "ta_1",
                "rom_1",
                "map_1",
                "2026-09-07",
                jam_ke,
                id_presensi,
            )
            .unwrap()
        };

        // Sesi yang sama persis untuk id_presensi_mapel baru: bentrok.
        assert_eq!(cari("1-2", "pm_2"), Some("1-2".to_string()));

        // Irisan sebagian — inilah yang lolos dari pencocokan teks persis, dan
        // inilah bentuk hitung-dobelnya: jam ke-2 tercatat pada dua sesi.
        assert_eq!(cari("2", "pm_2"), Some("1-2".to_string()));
        assert_eq!(cari("2-3", "pm_2"), Some("1-2".to_string()));

        // Bersebelahan tanpa berbagi jam: bukan bentrok.
        assert_eq!(cari("3", "pm_2"), None);
        assert_eq!(cari("3-4", "pm_2"), None);

        // Mengedit sesi yang sama (id_presensi_mapel sama) TIDAK dianggap bentrok.
        assert_eq!(cari("1-2", "pm_1"), None);

        // Rombel dan tanggal yang sama tetapi MAPEL berbeda tidak diperiksa di
        // sini: Agama memecah satu rombel menjadi dua kelas yang berjalan
        // bersamaan, dan keduanya butuh presensinya masing-masing.
        assert_eq!(
            find_overlapping_session(
                &conn,
                "ta_1",
                "rom_1",
                "map_agama_2",
                "2026-09-07",
                "1-2",
                "pm_2"
            )
            .unwrap(),
            None
        );
    }

    /// Vektor irisan `jam_ke` — WAJIB identik dengan `jamKeBeririsan` di
    /// `src/lib/validations/class-attendance.ts`.
    #[test]
    fn irisan_jam_ke_dinilai_dari_rentang_bukan_teks() {
        for (a, b) in [
            ("1", "1"),
            ("1-2", "2"),
            ("2", "1-2"),
            ("1-2", "2-3"),
            ("1-4", "2-3"),
            ("2-3", "1-4"),
            ("1 - 2", "1-2"),
        ] {
            assert!(jam_ke_overlaps(a, b), "{a} seharusnya beririsan dengan {b}");
        }

        for (a, b) in [
            ("1", "2"),
            ("1-2", "3-4"),
            ("3-4", "1-2"),
            ("1-2", "3"),
            // Nilai tidak valid tidak pernah dianggap bentrok: baris lama
            // dengan teks asing tidak boleh mengunci jadwal rombelnya.
            ("1-2", "abc"),
            ("abc", "1-2"),
            ("", "1"),
        ] {
            assert!(
                !jam_ke_overlaps(a, b),
                "{a} seharusnya TIDAK beririsan dengan {b}"
            );
        }
    }

    /// Rentang yang dibaca dari `jam_ke`, vektor yang sama dengan `rentangJamKe`.
    #[test]
    fn rentang_jam_ke_membaca_angka_tunggal_dan_rentang() {
        for (masukan, harapan) in [
            ("1", Some((1, 1))),
            ("12", Some((12, 12))),
            ("1-2", Some((1, 2))),
            ("3 - 5", Some((3, 5))),
            ("20", Some((20, 20))),
            ("abc", None),
            ("2-1", None),
            ("21", None),
        ] {
            assert_eq!(jam_ke_range(masukan), harapan, "masukan: {masukan}");
        }
    }

    /// Regresi: shift multi-sesi TIDAK BOLEH menggandakan baris roster.
    ///
    /// `absensi_harian` ber-PK AUTOINCREMENT dengan `id_sesi` UNIQUE, sehingga
    /// satu siswa bisa punya beberapa baris pada satu tanggal. Sebelum
    /// `GATE_SUMMARY_SUBQUERY`, join langsung ke tabel itu membuat guru melihat
    /// siswa yang sama dua kali di daftar presensi.
    #[test]
    fn ringkasan_gerbang_meruntuhkan_sesi_ganda_menjadi_satu_baris() {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        conn.execute_batch(
            r#"
            CREATE TABLE absensi_harian (
                id_absensi INTEGER PRIMARY KEY AUTOINCREMENT,
                tanggal TEXT NOT NULL,
                id_karyawan TEXT NOT NULL,
                jam_masuk TEXT,
                status_kehadiran TEXT,
                id_sesi TEXT UNIQUE NOT NULL
            );
            INSERT INTO absensi_harian (tanggal, id_karyawan, jam_masuk, status_kehadiran, id_sesi)
            VALUES ('2026-09-07', 'sis_1', '07:01', 'Hadir', 'ses-a'),
                   ('2026-09-07', 'sis_1', '10:30', 'Terlambat', 'ses-b');
            "#,
        )
        .unwrap();

        let sql = format!(
            "SELECT jam_masuk, hadir_gerbang, status_kehadiran FROM {gate} \
             WHERE id_karyawan = 'sis_1' AND tanggal = '2026-09-07';",
            gate = GATE_SUMMARY_SUBQUERY
        );
        let mut stmt = conn.prepare(&sql).unwrap();
        let rows: Vec<(Option<String>, i64, String)> = stmt
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))
            .unwrap()
            .filter_map(Result::ok)
            .collect();

        assert_eq!(rows.len(), 1, "dua sesi harus meringkas jadi satu baris");
        assert_eq!(
            rows[0].0.as_deref(),
            Some("07:01"),
            "ambil scan paling awal"
        );
        assert_eq!(rows[0].1, 1, "siswa ini hadir di gerbang");
        assert_eq!(rows[0].2, "Terlambat", "MAX dipakai agar deterministik");
    }

    /// `jam_masuk` berisi string kosong BUKAN berarti hadir di gerbang.
    ///
    /// Pemeriksaan lama `jam_masuk IS NOT NULL` meloloskan `''`, sehingga siswa
    /// yang tidak pernah scan bisa lolos dari anomali TANPA_SCAN_GERBANG.
    #[test]
    fn jam_masuk_kosong_tidak_dihitung_hadir_di_gerbang() {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        conn.execute_batch(
            r#"
            CREATE TABLE absensi_harian (
                id_absensi INTEGER PRIMARY KEY AUTOINCREMENT,
                tanggal TEXT NOT NULL,
                id_karyawan TEXT NOT NULL,
                jam_masuk TEXT,
                status_kehadiran TEXT,
                id_sesi TEXT UNIQUE NOT NULL
            );
            INSERT INTO absensi_harian (tanggal, id_karyawan, jam_masuk, status_kehadiran, id_sesi)
            VALUES ('2026-09-07', 'kosong', '   ', 'Hadir', 'ses-c'),
                   ('2026-09-07', 'alfa',   '08:00', 'Alfa', 'ses-d');
            "#,
        )
        .unwrap();

        let sql = format!(
            "SELECT id_karyawan, hadir_gerbang FROM {gate} ORDER BY id_karyawan;",
            gate = GATE_SUMMARY_SUBQUERY
        );
        let mut stmt = conn.prepare(&sql).unwrap();
        let rows: Vec<(String, i64)> = stmt
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
            .unwrap()
            .filter_map(Result::ok)
            .collect();

        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0], ("alfa".to_owned(), 0), "status Alfa bukan hadir");
        assert_eq!(
            rows[1],
            ("kosong".to_owned(), 0),
            "jam_masuk spasi bukan hadir"
        );
    }

    /// Regresi: siswa yang keluar dari roster harus dibuang, bukan ditinggalkan.
    ///
    /// Tanpa langkah ini `total_*` di header — yang dihitung ulang HANYA dari
    /// item yang dikirim — tidak lagi cocok dengan isi tabel detailnya, dan
    /// rekonsiliasi terus melaporkan siswa itu Alfa di kelas yang ia tinggalkan.
    #[test]
    fn baris_detail_di_luar_roster_terdeteksi_untuk_dibuang() {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        conn.execute_batch(
            r#"
            CREATE TABLE presensi_mapel_detail (
                id_detail TEXT PRIMARY KEY,
                id_presensi_mapel TEXT NOT NULL,
                id_siswa TEXT NOT NULL
            );
            INSERT INTO presensi_mapel_detail (id_detail, id_presensi_mapel, id_siswa)
            VALUES ('pmd_1', 'pm_1', 'sis_1'),
                   ('pmd_2', 'pm_1', 'sis_2'),
                   ('pmd_3', 'pm_1', 'sis_pindah'),
                   ('pmd_9', 'pm_lain', 'sis_1');
            "#,
        )
        .unwrap();

        // Roster yang dikirim kini hanya berisi dua siswa.
        let siswa_terkirim = vec!["sis_1".to_owned(), "sis_2".to_owned()];

        let mut stmt = conn
            .prepare("SELECT id_detail, id_siswa FROM presensi_mapel_detail WHERE id_presensi_mapel = ?1;")
            .unwrap();
        let stale: Vec<(String, String)> = stmt
            .query_map(params!["pm_1"], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })
            .unwrap()
            .filter_map(Result::ok)
            .filter(|(_, id_siswa)| !siswa_terkirim.iter().any(|kirim| kirim == id_siswa))
            .collect();

        assert_eq!(
            stale.len(),
            1,
            "hanya siswa yang keluar roster yang dibuang"
        );
        assert_eq!(stale[0].0, "pmd_3");
        assert_eq!(stale[0].1, "sis_pindah");
    }

    /// Vektor jam bel — WAJIB identik dengan `normalizeJamBel` di
    /// `class-attendance.test.ts`.
    #[test]
    fn normalisasi_jam_bel_menerima_bentuk_manusia() {
        for (masukan, harapan) in [
            ("07:00", "07:00"),
            ("7:0", "07:00"),
            ("7:5", "07:05"),
            ("23:59", "23:59"),
            ("00:00", "00:00"),
            (" 08 : 30 ", "08:30"),
        ] {
            assert_eq!(
                normalize_jam_bel(masukan).as_deref(),
                Some(harapan),
                "masukan: {masukan}"
            );
        }

        for masukan in [
            "",
            "0700",   // tanpa titik dua
            "24:00",  // jam di luar hari
            "07:60",  // menit di luar jam
            "7",      // tidak lengkap
            ":30",
            "07:",
            "abc:00",
            "007:00", // lebih dari dua digit
            "０7:00", // digit non-ASCII
        ] {
            assert!(
                normalize_jam_bel(masukan).is_none(),
                "seharusnya ditolak: {masukan}"
            );
        }
    }

    /// Vektor pengaturan jam pelajaran — WAJIB identik dengan blok
    /// "pengaturan jam pelajaran" di `class-attendance.test.ts`.
    #[test]
    fn pengaturan_jp_jatuh_ke_bawaan_bukan_ke_nol() {
        // Nilai cacat jatuh ke BAWAAN, bukan ke nol (setiap presensi akan
        // ditolak) dan bukan ke batas struktural (diam-diam melonggarkan
        // kebijakan sekolah yang justru sedang salah tulis).
        for (mentah, harapan) in [
            (None, 12),
            (Some(""), 12),
            (Some("   "), 12),
            (Some("bukan angka"), 12),
            (Some("0"), 12),
            (Some("-3"), 12),
            (Some("21"), 12),
            (Some("1"), 1),
            (Some("8"), 8),
            (Some("12"), 12),
            (Some("20"), 20),
            (Some(" 10 "), 10),
        ] {
            assert_eq!(jp_max_per_day(mentah), harapan, "maks: {mentah:?}");
        }

        for (mentah, harapan) in [
            (None, 45),
            (Some(""), 45),
            (Some("abc"), 45),
            (Some("0"), 45),
            (Some("241"), 45),
            (Some("35"), 35),
            (Some("40"), 40),
            (Some("45"), 45),
            (Some("240"), 240),
        ] {
            assert_eq!(
                jp_duration_minutes(mentah),
                harapan,
                "durasi: {mentah:?}"
            );
        }
    }

    /// Vektor uji `jam_ke` — WAJIB identik dengan `normalizeJamKe` di
    /// `src/lib/validations/class-attendance.ts`. Pola paritas yang sama dengan
    /// `ip-allowlist` dan `totp`.
    #[test]
    fn normalisasi_jam_ke_menerima_angka_dan_rentang() {
        // Diterima, beserta bentuk kanoniknya.
        for (masukan, harapan) in [
            ("1", "1"),
            ("8", "8"),
            ("12", "12"),
            ("  3  ", "3"),
            ("1-2", "1-2"),
            ("7-8", "7-8"),
            ("1 - 2", "1-2"),
            ("11-12", "11-12"),
            // Batas struktural naik ke 20; jumlah yang dipakai sebuah sekolah
            // dibatasi terpisah lewat `jp_max_per_hari`.
            ("20", "20"),
            ("13-20", "13-20"),
        ] {
            assert_eq!(
                normalize_jam_ke(masukan).unwrap(),
                harapan,
                "masukan: {masukan}"
            );
        }

        // Ditolak.
        for masukan in [
            "",      // kosong
            "0",     // di bawah batas
            "21",    // di atas batas struktural
            "abc",   // bukan angka
            "2-1",   // terbalik
            "3-3",   // rentang nol
            "1-",    // tidak lengkap
            "-2",    // tidak lengkap
            "1-2-3", // rentang bertingkat
            "1,2",   // pemisah salah
            "０",    // digit non-ASCII
        ] {
            assert!(
                normalize_jam_ke(masukan).is_err(),
                "seharusnya ditolak: {masukan}"
            );
        }
    }
}
