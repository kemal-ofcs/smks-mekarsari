use std::collections::HashMap;

use rusqlite::{params, Connection, OptionalExtension, Transaction};
use serde_json::{json, Value};

use super::{config::DesktopState, models::CommandError, storage, sync};

/// Sakelar induk per jenis notifikasi, disimpan di `setting_gex_system`.
///
/// Keempatnya BAWAANNYA MATI — kunci yang belum ada berarti mati, pola yang
/// sama dengan `scan_photo_enabled`. Alasannya konkret: sekolah 800 siswa
/// menghasilkan ±1.600 baris antrean per hari sejak hari pertama. Menyalakan
/// notifikasi secara bawaan berarti setiap pemasangan diam-diam menimbun
/// tumpukan pesan yang akan terkirim sekaligus begitu seseorang mengaktifkan
/// gateway — biaya nyata, dan banjir pesan ke wali.
///
/// Sakelar ini hidup di `setting_gex_system` yang IKUT SINKRONISASI, bukan di
/// `app_wa_config`. Bedanya menentukan: `app_wa_config` cloud-only, sehingga
/// scanner yang sedang menulis di dalam transaksi SQLite lokal — mungkin tanpa
/// jaringan sama sekali — tidak akan pernah bisa membacanya. Kolom
/// `*_enabled` di sana tetap ada dan tetap dihormati saat PENGIRIMAN; yang di
/// sini memutuskan lebih awal, saat MENGANTRE.
///
/// Cerminan TypeScript-nya di `src/lib/validations/wa-notification.ts`.
pub const WA_NOTIFY_SCAN_MASUK_KEY: &str = "wa_notify_scan_masuk";
pub const WA_NOTIFY_SCAN_PULANG_KEY: &str = "wa_notify_scan_pulang";
pub const WA_NOTIFY_BOLOS_KEY: &str = "wa_notify_bolos";
pub const WA_NOTIFY_AMBANG_ALFA_KEY: &str = "wa_notify_ambang_alfa";
pub const WA_NOTIFY_KOREKSI_ADMIN_KEY: &str = "wa_notify_koreksi_admin";
pub const WA_NOTIFY_IMPORT_MANUAL_KEY: &str = "wa_notify_import_manual";

/// Kunci setting dinamis untuk ambang jumlah alfa dan rentang hari evaluasi.
pub const WA_NOTIFY_AMBANG_ALFA_LIMIT_KEY: &str = "wa_notify_ambang_alfa_limit";
pub const WA_NOTIFY_AMBANG_ALFA_DAYS_KEY: &str = "wa_notify_ambang_alfa_days";
pub const DEFAULT_AMBANG_ALFA_LIMIT: i64 = 3;
pub const DEFAULT_AMBANG_ALFA_DAYS: i64 = 30;

/// Batas atas kedua parameter ambang alfa.
///
/// Dieja SAMA PERSIS dengan `parseAmbangAlfaLimit`/`parseAmbangAlfaDays` di
/// `src/lib/validations/wa-notification.ts`, dan diuji dengan vektor yang sama
/// — pola paritas yang dipakai `ip-allowlist`, `totp`, dan `holiday-whitelist`.
///
/// Tanpa batas atas ini kedua sisi pernah berselisih: nilai `500` yang
/// tersimpan dihormati apa adanya oleh Rust (praktis tidak ada wali yang
/// diberi tahu) sementara TypeScript menolaknya dan jatuh ke 3 (banyak yang
/// diberi tahu). Satu sekolah, dua arti untuk "3 alfa dalam 30 hari", tanpa
/// satu pun pesan kesalahan yang menunjukkannya.
pub const MAX_AMBANG_ALFA_LIMIT: i64 = 100;
pub const MAX_AMBANG_ALFA_DAYS: i64 = 365;

/// Nilai ambang yang sah, atau bawaannya. Di luar rentang = BAWAAN, bukan
/// dipotong ke tepi rentang — sengaja, karena itulah yang dilakukan sisi
/// TypeScript, dan menebak "maksudnya 100" dari ketikan 500 sama menyesatkannya
/// di kedua sisi.
pub fn clamp_ambang_alfa_limit(value: i64) -> i64 {
    if value > 0 && value <= MAX_AMBANG_ALFA_LIMIT {
        value
    } else {
        DEFAULT_AMBANG_ALFA_LIMIT
    }
}

pub fn clamp_ambang_alfa_days(value: i64) -> i64 {
    if value > 0 && value <= MAX_AMBANG_ALFA_DAYS {
        value
    } else {
        DEFAULT_AMBANG_ALFA_DAYS
    }
}

/// Urai nilai batas alfa dan rentang hari dari tabel settings.
pub fn parse_ambang_alfa_settings(settings: &HashMap<String, String>) -> (i64, i64) {
    let limit = settings
        .get(WA_NOTIFY_AMBANG_ALFA_LIMIT_KEY)
        .and_then(|v| v.trim().parse::<i64>().ok())
        .map(clamp_ambang_alfa_limit)
        .unwrap_or(DEFAULT_AMBANG_ALFA_LIMIT);
    let days = settings
        .get(WA_NOTIFY_AMBANG_ALFA_DAYS_KEY)
        .and_then(|v| v.trim().parse::<i64>().ok())
        .map(clamp_ambang_alfa_days)
        .unwrap_or(DEFAULT_AMBANG_ALFA_DAYS);
    (limit, days)
}

/// Umur maksimal baris antrean yang sudah selesai, dalam hari.
///
/// Hanya baris berstatus akhir (`Terkirim`/`Dibatalkan`) yang dipangkas.
/// `Menunggu` dan `Gagal` sengaja dibiarkan: yang pertama belum dikerjakan,
/// yang kedua masih bisa dicoba ulang manusia dan merupakan bukti kegagalan
/// pengiriman yang perlu terlihat.
pub const WA_QUEUE_RETENTION_DAYS: i64 = 90;

/// Sakelar notifikasi WA sebagaimana dikirim formulir Pengaturan.
pub struct WaSwitches {
    pub scan_masuk: i64,
    pub scan_pulang: i64,
    pub bolos: i64,
    pub ambang_alfa: i64,
    pub koreksi_admin: i64,
    pub import_manual: i64,
    pub ambang_limit: i64,
    pub ambang_days: i64,
}

fn flag(draft: &Value, key: &str) -> i64 {
    draft
        .get(key)
        .and_then(|v| {
            v.as_i64()
                .or_else(|| v.as_bool().map(|b| if b { 1 } else { 0 }))
        })
        // BAWAANNYA MATI untuk KEEMPATNYA.
        //
        // Sebelumnya `bolos` dan `ambang_alfa` berbawaan 1 di sini, di cabang
        // "belum ada baris" milik `get_wa_config`, dan di state awal
        // `NotifikasiWaCard`. Akibatnya kartu Pengaturan menampilkan dua sakelar
        // itu HIDUP sementara mesinnya membaca MATI — `wa_notify_enabled`
        // menjawab false untuk kunci yang belum ada, dan baris cerminnya baru
        // lahir saat seseorang menekan Simpan. Pemasangan yang tidak pernah
        // membuka kartu itu melihat sakelar menyala dan tidak menerima satu pun
        // notifikasi, tanpa apa pun yang menjelaskan kenapa.
        //
        // Yang disamakan adalah TAMPILANNYA ke mesin, bukan sebaliknya:
        // menyalakan bawaannya akan membuat setiap pemasangan lama mulai
        // mengirim pesan ke nomor wali begitu gateway-nya aktif.
        .unwrap_or(0)
}

/// Baca sakelar dari draft formulir.
///
/// SATU pembaca untuk dua penulis — baris `app_wa_config` di cloud dan cerminan
/// `setting_gex_system`. Saat keduanya mengurai draft sendiri-sendiri, satu
/// sisi bisa menyimpan nilai yang tidak sama dengan sisi lain, dan hasilnya
/// terminal yang mengantre sementara pengirimnya menolak.
pub fn parse_wa_switches(draft: &Value) -> WaSwitches {
    WaSwitches {
        scan_masuk: flag(draft, "scan_masuk_enabled"),
        scan_pulang: flag(draft, "scan_pulang_enabled"),
        bolos: flag(draft, "bolos_enabled"),
        ambang_alfa: flag(draft, "ambang_alfa_enabled"),
        koreksi_admin: flag(draft, "koreksi_admin_enabled"),
        import_manual: flag(draft, "import_manual_enabled"),
        ambang_limit: clamp_ambang_alfa_limit(
            draft
                .get("ambangAlfaLimit")
                .and_then(Value::as_i64)
                .unwrap_or(DEFAULT_AMBANG_ALFA_LIMIT),
        ),
        ambang_days: clamp_ambang_alfa_days(
            draft
                .get("ambangAlfaDays")
                .and_then(Value::as_i64)
                .unwrap_or(DEFAULT_AMBANG_ALFA_DAYS),
        ),
    }
}

/// Pasangan kunci/nilai `setting_gex_system` yang mencerminkan sakelar di atas.
pub fn wa_setting_mirror(switches: &WaSwitches) -> [(&'static str, String); 8] {
    let boolean = |v: i64| (if v != 0 { "true" } else { "false" }).to_owned();
    [
        (WA_NOTIFY_SCAN_MASUK_KEY, boolean(switches.scan_masuk)),
        (WA_NOTIFY_SCAN_PULANG_KEY, boolean(switches.scan_pulang)),
        (WA_NOTIFY_BOLOS_KEY, boolean(switches.bolos)),
        (WA_NOTIFY_AMBANG_ALFA_KEY, boolean(switches.ambang_alfa)),
        (
            WA_NOTIFY_KOREKSI_ADMIN_KEY,
            boolean(switches.koreksi_admin),
        ),
        (
            WA_NOTIFY_IMPORT_MANUAL_KEY,
            boolean(switches.import_manual),
        ),
        (
            WA_NOTIFY_AMBANG_ALFA_LIMIT_KEY,
            switches.ambang_limit.to_string(),
        ),
        (
            WA_NOTIFY_AMBANG_ALFA_DAYS_KEY,
            switches.ambang_days.to_string(),
        ),
    ]
}

/// Tulis cerminan sakelar ke `setting_gex_system` LOKAL.
///
/// Cloud tetap sumber kebenarannya dan sudah ditulis lebih dulu; ini hanya
/// membuat salinan baca milik perangkat ini mutakhir SEKARANG alih-alih setelah
/// pull berikutnya. Tanpa ini, menyalakan sakelar lalu langsung memindai tidak
/// menghasilkan apa-apa — scanner membaca `setting_gex_system` lokal di dalam
/// transaksinya, dan di sana nilainya belum berubah.
///
/// SENGAJA tanpa event outbox: barisnya sudah ada di cloud lewat penulisan
/// atomik `save_wa_config`, dan mengantrekannya lagi hanya menambah jalur tulis
/// kedua untuk nilai yang sama.
pub fn mirror_wa_switches_local(
    state: &DesktopState,
    switches: &WaSwitches,
) -> Result<(), CommandError> {
    let connection = storage::database(&state.data_dir)?;
    for (key, value) in wa_setting_mirror(switches) {
        connection
            .execute(
                "INSERT INTO setting_gex_system (key, value) VALUES (?1, ?2)
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value;",
                params![key, value],
            )
            .map_err(|_| CommandError::internal())?;
    }
    Ok(())
}

/// Kunci sakelar untuk sebuah jenis notifikasi.
pub fn wa_notify_setting_key(jenis: &str) -> Option<&'static str> {
    match jenis {
        "scan_masuk" => Some(WA_NOTIFY_SCAN_MASUK_KEY),
        "scan_pulang" => Some(WA_NOTIFY_SCAN_PULANG_KEY),
        "bolos" => Some(WA_NOTIFY_BOLOS_KEY),
        "ambang_alfa" => Some(WA_NOTIFY_AMBANG_ALFA_KEY),
        "koreksi_admin" => Some(WA_NOTIFY_KOREKSI_ADMIN_KEY),
        "import_manual" => Some(WA_NOTIFY_IMPORT_MANUAL_KEY),
        _ => None,
    }
}

/// Bolehkah jenis notifikasi ini diantrekan secara otomatis?
///
/// Jenis yang tidak dikenal menjawab `false`. Nilai asing di sini hanya bisa
/// datang dari kode yang salah, dan bawaan yang aman untuk pengiriman pesan ke
/// luar adalah tidak mengirim.
pub fn wa_notify_enabled(settings: &HashMap<String, String>, jenis: &str) -> bool {
    wa_notify_setting_key(jenis)
        .map(|key| super::scanner::setting_enabled(settings, key))
        .unwrap_or(false)
}

/// Pangkas baris antrean lokal yang sudah selesai dan melewati masa retensi.
///
/// Dijalankan di akhir siklus sinkronisasi. Baris yang masih punya event outbox
/// belum terkirim TIDAK ikut dihapus — menghapusnya lebih dulu akan membuat
/// event yang sudah antre menunjuk baris yang tidak ada lagi.
pub fn purge_expired_notifications(connection: &Connection) -> Result<usize, CommandError> {
    let batas = format!("-{WA_QUEUE_RETENTION_DAYS} days");
    connection
        .execute(
            r#"
            DELETE FROM notifikasi_wa
            WHERE status IN ('Terkirim', 'Dibatalkan')
              AND created_at < datetime('now', ?1)
              AND NOT EXISTS (
                    SELECT 1 FROM desktop_sync_outbox o
                    WHERE o.domain = 'wa-notification'
                      AND o.entity_key = notifikasi_wa.id_notifikasi
                      AND o.status IN ('pending', 'failed', 'conflict')
              );
            "#,
            params![batas],
        )
        .map(|jumlah| jumlah as usize)
        .map_err(|e| {
            CommandError::new(
                "DB_ERROR",
                format!("Gagal memangkas antrean notifikasi: {e}"),
            )
        })
}

/// Normalisasi nomor WhatsApp ke format kanonik `+62...`.
/// Meniru logika `src/lib/operators/contact.ts` (Rule 40).
pub fn normalize_phone_canonical(raw: &str) -> String {
    let digits: String = raw
        .chars()
        .filter(|c| c.is_ascii_digit() || *c == '+')
        .collect();
    if digits.is_empty() {
        return String::new();
    }
    let bare = if let Some(stripped) = digits.strip_prefix('+') {
        stripped
    } else {
        &digits
    };
    if !bare.chars().all(|c| c.is_ascii_digit()) {
        return String::new();
    }
    if bare.starts_with("62") {
        format!("+{bare}")
    } else if let Some(rest) = bare.strip_prefix('0') {
        format!("+62{rest}")
    } else if bare.starts_with('8') {
        format!("+62{bare}")
    } else if digits.starts_with('+') {
        format!("+{bare}")
    } else {
        String::new()
    }
}

pub fn is_valid_phone(phone: &str) -> bool {
    let canon = normalize_phone_canonical(phone);
    if !canon.starts_with('+') {
        return false;
    }
    let digits_count = canon.len().saturating_sub(1);
    digits_count >= 9 && digits_count <= 15
}

/// Buat ID unik notifikasi `wa_` + 128 bit (32 karakter hex).
pub fn new_wa_notification_id() -> String {
    let mut bytes = [0u8; 16];
    rand_core::RngCore::fill_bytes(&mut rand_core::OsRng, &mut bytes);
    let mut id = String::with_capacity(3 + 32);
    id.push_str("wa_");
    for byte in bytes {
        id.push_str(&format!("{byte:02x}"));
    }
    id
}



/// Batas jumlah wali yang diberi tahu dalam SATU aksi import.
///
/// `import_offline` menerima sampai 500 baris sekali panggil, dan upload CSV
/// massal memang dipakai untuk membackfill data setelah gangguan. Tanpa batas,
/// satu klik pemulihan data akan mengirim ratusan pesan ke ratusan nomor wali
/// tentang catatan rutin — tidak bisa ditarik kembali, dan berbiaya nyata.
///
/// Import-nya sendiri TIDAK pernah dibatasi: seluruh barisnya tetap diproses.
/// Yang dibatasi hanya notifikasinya, dan operator diberi tahu saat batas ini
/// tercapai supaya kesenyapannya tidak disalahartikan sebagai kegagalan.
pub const MAX_WALI_NOTIFICATIONS_PER_IMPORT: usize = 25;

/// Data wali seorang siswa untuk menyusun pesan.
pub struct WaliSiswa {
    pub nama: String,
    pub rombel: String,
}

/// Antrekan notifikasi ke wali BILA personilnya siswa dan jenisnya dinyalakan.
///
/// Mengembalikan `true` hanya bila sebuah baris benar-benar diantrekan. Semua
/// syaratnya diperiksa di sini supaya tidak tersebar di tiap pemanggil:
///
///   1. sakelar `wa_notify_<jenis>` menyala di `setting_gex_system` LOKAL,
///   2. personilnya siswa, dinilai dengan predikat yang SAMA dengan scanner —
///      `jenis_personil` tersimpan dengan ejaan berbeda-beda, dan perbandingan
///      mentah `= 'Siswa'` tidak pernah cocok untuk siswa yang dibuat alur
///      akademik,
///   3. nomor walinya ada dan valid,
///   4. `dedupe_key`-nya belum pernah diantrekan.
///
/// Guru dan pegawai TIDAK pernah lolos syarat kedua. Itu disengaja: pesan ini
/// ditujukan kepada wali murid, dan seorang pegawai tidak punya wali.
pub fn queue_wali_notification_tx(
    tx: &Transaction<'_>,
    client_id: &str,
    jenis: &str,
    id_personil: &str,
    dedupe_key: &str,
    pesan: impl FnOnce(&WaliSiswa) -> String,
) -> Result<bool, CommandError> {
    let Some(key) = wa_notify_setting_key(jenis) else {
        return Ok(false);
    };
    let aktif: Option<String> = tx
        .query_row(
            "SELECT value FROM setting_gex_system WHERE key = ?1 LIMIT 1;",
            params![key],
            |row| row.get(0),
        )
        .optional()
        .map_err(|_| CommandError::internal())?;
    if !aktif
        .map(|value| value.trim().eq_ignore_ascii_case("true"))
        .unwrap_or(false)
    {
        return Ok(false);
    }

    let sudah: bool = tx
        .query_row(
            "SELECT 1 FROM notifikasi_wa WHERE dedupe_key = ?1 LIMIT 1;",
            params![dedupe_key],
            |_| Ok(true),
        )
        .optional()
        .map_err(|_| CommandError::internal())?
        .unwrap_or(false);
    if sudah {
        return Ok(false);
    }

    let info: Option<(String, String, String)> = tx
        .query_row(
            r#"
            SELECT COALESCE(s.no_whatsapp_wali, m.no_hp, ''),
                   COALESCE(s.nama_lengkap, m.nama, ''),
                   COALESCE(r.nama_rombel, m.divisi, '')
            FROM master_data m
            LEFT JOIN siswa_data s ON s.id_siswa = m.id_unik
            LEFT JOIN akademik_rombel r ON r.id_rombel = s.id_rombel
            WHERE m.id_unik = ?1
              AND (LOWER(TRIM(COALESCE(m.jenis_personil, ''))) = 'siswa'
                   OR s.id_siswa IS NOT NULL)
            LIMIT 1;
            "#,
            params![id_personil],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .optional()
        .map_err(|_| CommandError::internal())?;

    let Some((phone, nama, rombel)) = info else {
        return Ok(false);
    };
    let canon = normalize_phone_canonical(&phone);
    if !is_valid_phone(&canon) {
        return Ok(false);
    }

    let wali = WaliSiswa {
        nama: if nama.is_empty() { "Siswa".to_owned() } else { nama },
        rombel: if rombel.is_empty() { "-".to_owned() } else { rombel },
    };

    queue_wa_notification_tx(
        tx,
        client_id,
        &json!({
            "dedupe_key": dedupe_key,
            "jenis": jenis,
            "id_siswa": id_personil,
            "tujuan_nomor": canon,
            "isi_pesan": pesan(&wali),
        }),
    )?;
    Ok(true)
}

/// Antrekan notifikasi WA ke tabel lokal `notifikasi_wa` dan daftarkan ke outbox
/// dalam SATU transaksi SQLite atomik (Rule 3).
pub fn queue_wa_notification_tx(
    tx: &Transaction<'_>,
    client_id: &str,
    draft: &Value,
) -> Result<String, CommandError> {
    let raw_id = draft
        .get("id_notifikasi")
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim();
    let id = if raw_id.is_empty() {
        new_wa_notification_id()
    } else {
        raw_id.to_owned()
    };

    let dedupe_key = draft
        .get("dedupe_key")
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim();
    if dedupe_key.is_empty() {
        return Err(CommandError::new(
            "VALIDATION_ERROR",
            "Kunci deduplikasi (dedupe_key) wajib diisi.",
        ));
    }

    let jenis = draft
        .get("jenis")
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim();
    if !matches!(
        jenis,
        "scan_masuk"
            | "scan_pulang"
            | "bolos"
            | "ambang_alfa"
            | "koreksi_admin"
            | "import_manual"
    ) {
        return Err(CommandError::new(
            "VALIDATION_ERROR",
            "Jenis notifikasi tidak valid. Pilihan: scan_masuk, scan_pulang, bolos, ambang_alfa, koreksi_admin, import_manual.",
        ));
    }

    let id_siswa = draft
        .get("id_siswa")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty());

    let raw_phone = draft
        .get("tujuan_nomor")
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim();
    let tujuan_nomor = normalize_phone_canonical(raw_phone);
    if !is_valid_phone(&tujuan_nomor) {
        return Err(CommandError::new(
            "VALIDATION_ERROR",
            "Nomor telepon tujuan WhatsApp tidak valid (format: 08... atau +62...).",
        ));
    }

    let isi_pesan = draft
        .get("isi_pesan")
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim();
    if isi_pesan.is_empty() {
        return Err(CommandError::new(
            "VALIDATION_ERROR",
            "Isi pesan notifikasi WhatsApp tidak boleh kosong.",
        ));
    }
    if isi_pesan.len() > 5000 {
        return Err(CommandError::new(
            "VALIDATION_ERROR",
            "Isi pesan WhatsApp terlalu panjang (maksimal 5000 karakter).",
        ));
    }

    // Status asing DITOLAK, tidak dinormalkan menjadi `Menunggu`.
    //
    // Versi sebelumnya menjadikan nilai apa pun yang tidak dikenal sebagai
    // `Menunggu`, dan `Menunggu` adalah satu-satunya status yang benar-benar
    // dikirim: pada siklus pengurasan berikutnya baris itu menjadi pesan
    // WhatsApp ke nomor wali seorang siswa. Sebuah bug klien pun berubah
    // menjadi pesan yang tidak bisa ditarik kembali, tanpa meninggalkan jejak
    // bahwa ada yang salah. Pola `class_status` Fase 2, dengan taruhan lebih
    // tinggi. Daftar ini sama persis dengan CHECK constraint `notifikasi_wa`,
    // enum Zod `sync-schema.ts`, dan `WA_NOTIFICATION_STATUSES` di TypeScript.
    let status = draft
        .get("status")
        .and_then(Value::as_str)
        .unwrap_or("Menunggu")
        .trim();
    if !matches!(status, "Menunggu" | "Terkirim" | "Gagal" | "Dibatalkan") {
        return Err(CommandError::new(
            "VALIDATION_ERROR",
            "Status notifikasi tidak valid. Pilihan: Menunggu, Terkirim, Gagal, Dibatalkan.",
        ));
    }
    let valid_status = status;

    let now: String = tx
        .query_row("SELECT datetime('now');", [], |row| row.get(0))
        .map_err(|_| CommandError::internal())?;

    tx.execute(
        r#"INSERT INTO notifikasi_wa (
            id_notifikasi, dedupe_key, jenis, id_siswa, tujuan_nomor,
            isi_pesan, status, attempt_count, created_at, updated_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 0, ?8, ?8)
        ON CONFLICT(id_notifikasi) DO UPDATE SET
            dedupe_key = excluded.dedupe_key,
            jenis = excluded.jenis,
            id_siswa = excluded.id_siswa,
            tujuan_nomor = excluded.tujuan_nomor,
            isi_pesan = excluded.isi_pesan,
            status = excluded.status,
            updated_at = excluded.updated_at;"#,
        params![
            id,
            dedupe_key,
            jenis,
            id_siswa,
            tujuan_nomor,
            isi_pesan,
            valid_status,
            now
        ],
    )
    .map_err(|e| {
        CommandError::new(
            "DB_ERROR",
            format!("Gagal menyimpan antrean notifikasi: {e}"),
        )
    })?;

    let payload = json!({
        "id_notifikasi": id,
        "dedupe_key": dedupe_key,
        "jenis": jenis,
        "id_siswa": id_siswa,
        "tujuan_nomor": tujuan_nomor,
        "isi_pesan": isi_pesan,
        "status": valid_status,
        "created_at": now,
        "updated_at": now,
    });

    sync::enqueue(
        tx,
        client_id,
        "wa-notification",
        "queue",
        &id,
        &payload,
        None,
    )?;

    Ok(id)
}

/// Batalkan notifikasi WA di antrean lokal dan daftarkan event outbox `cancel`
/// dalam SATU transaksi atomik.
pub fn cancel_wa_notification_tx(
    tx: &Transaction<'_>,
    client_id: &str,
    id_notifikasi: &str,
    alasan: Option<&str>,
) -> Result<(), CommandError> {
    let now: String = tx
        .query_row("SELECT datetime('now');", [], |row| row.get(0))
        .map_err(|_| CommandError::internal())?;

    let updated = tx
        .execute(
            "UPDATE notifikasi_wa SET status = 'Dibatalkan', updated_at = ?1 WHERE id_notifikasi = ?2 AND status = 'Menunggu';",
            params![now, id_notifikasi],
        )
        .map_err(|e| CommandError::new("DB_ERROR", format!("Gagal membatalkan notifikasi: {e}")))?;

    if updated > 0 {
        let payload = json!({
            "id_notifikasi": id_notifikasi,
            "alasan": alasan,
        });
        sync::enqueue(
            tx,
            client_id,
            "wa-notification",
            "cancel",
            id_notifikasi,
            &payload,
            None,
        )?;
    }

    Ok(())
}

pub fn queue_wa_notification(state: &DesktopState, draft: &Value) -> Result<Value, CommandError> {
    let client_id = sync::ensure_client_id(state)?;
    let mut conn = storage::database(&state.data_dir)?;
    let tx = conn.transaction().map_err(|_| CommandError::internal())?;

    let id = queue_wa_notification_tx(&tx, &client_id, draft)?;
    tx.commit().map_err(|_| CommandError::internal())?;

    Ok(json!({ "sukses": true, "id_notifikasi": id }))
}

pub fn cancel_wa_notification(
    state: &DesktopState,
    id_notifikasi: &str,
    alasan: Option<&str>,
) -> Result<Value, CommandError> {
    let client_id = sync::ensure_client_id(state)?;
    let mut conn = storage::database(&state.data_dir)?;
    let tx = conn.transaction().map_err(|_| CommandError::internal())?;

    cancel_wa_notification_tx(&tx, &client_id, id_notifikasi, alasan)?;
    tx.commit().map_err(|_| CommandError::internal())?;

    Ok(json!({ "sukses": true }))
}

/// Antrean WhatsApp dari SQLite lokal.
///
/// `only_unsynced` membatasi hasilnya pada baris yang event outbox-nya masih
/// menggantung — yaitu baris yang BELUM ada di cloud. Mode itu dipakai
/// `desktop_list_wa_notifications`, yang membaca cloud sebagai sumber utama
/// lalu menambahkan baris-baris ini di atasnya, supaya terminal pemindai yang
/// sedang offline tetap melihat antrean buatannya sendiri.
///
/// Tanpa penyaring itu, penggabungannya akan menghidupkan kembali baris yang
/// sudah dipangkas retensi di cloud.
pub fn list_wa_notifications(
    state: &DesktopState,
    status_filter: Option<&str>,
    jenis_filter: Option<&str>,
    id_siswa_filter: Option<&str>,
    tanggal_filter: Option<&str>,
    limit: Option<i64>,
    only_unsynced: bool,
) -> Result<Value, CommandError> {
    let conn = storage::database(&state.data_dir)?;
    let mut query = String::from(
        r#"
        SELECT n.id_notifikasi, n.dedupe_key, n.jenis, n.id_siswa, n.tujuan_nomor,
               n.isi_pesan, n.status, n.attempt_count, n.last_error, n.sent_at,
               n.created_at, n.updated_at,
               COALESCE(s.nama_lengkap, m.nama, '') AS nama_siswa,
               COALESCE(r.nama_rombel, m.divisi, '') AS nama_rombel
        FROM notifikasi_wa n
        LEFT JOIN siswa_data s ON s.id_siswa = n.id_siswa
        LEFT JOIN akademik_rombel r ON r.id_rombel = s.id_rombel
        LEFT JOIN master_data m ON m.id_unik = n.id_siswa
        WHERE 1=1
        "#,
    );

    let mut param_values: Vec<String> = Vec::new();

    if let Some(status) = status_filter.filter(|s| !s.trim().is_empty() && *s != "Semua") {
        query.push_str(" AND n.status = ?");
        param_values.push(status.trim().to_string());
    }
    if let Some(jenis) = jenis_filter.filter(|j| !j.trim().is_empty() && *j != "Semua") {
        query.push_str(" AND n.jenis = ?");
        param_values.push(jenis.trim().to_string());
    }
    if let Some(id_siswa) = id_siswa_filter.filter(|id| !id.trim().is_empty()) {
        query.push_str(" AND n.id_siswa = ?");
        param_values.push(id_siswa.trim().to_string());
    }
    if let Some(tanggal) = tanggal_filter.filter(|t| !t.trim().is_empty()) {
        query.push_str(" AND n.created_at LIKE ?");
        param_values.push(format!("{}%", tanggal.trim()));
    }

    if only_unsynced {
        query.push_str(
            r#" AND EXISTS (
                SELECT 1 FROM desktop_sync_outbox o
                WHERE o.domain = 'wa-notification'
                  AND o.entity_key = n.id_notifikasi
                  AND o.status IN ('pending', 'failed', 'conflict')
            )"#,
        );
    }

    query.push_str(" ORDER BY n.created_at DESC");
    let max_rows = limit.unwrap_or(200).clamp(1, 1000);
    query.push_str(&format!(" LIMIT {max_rows};"));

    let mut stmt = conn.prepare(&query).map_err(|_| CommandError::internal())?;
    let rusqlite_params: Vec<&dyn rusqlite::ToSql> = param_values
        .iter()
        .map(|s| s as &dyn rusqlite::ToSql)
        .collect();

    let rows = stmt
        .query_map(rusqlite_params.as_slice(), |row| {
            Ok(json!({
                "id_notifikasi": row.get::<_, String>(0)?,
                "dedupe_key": row.get::<_, String>(1)?,
                "jenis": row.get::<_, String>(2)?,
                "id_siswa": row.get::<_, Option<String>>(3)?,
                "tujuan_nomor": row.get::<_, String>(4)?,
                "isi_pesan": row.get::<_, String>(5)?,
                "status": row.get::<_, String>(6)?,
                "attempt_count": row.get::<_, i64>(7)?,
                "last_error": row.get::<_, Option<String>>(8)?,
                "sent_at": row.get::<_, Option<String>>(9)?,
                "created_at": row.get::<_, String>(10)?,
                "updated_at": row.get::<_, String>(11)?,
                "nama_siswa": row.get::<_, String>(12)?,
                "nama_rombel": row.get::<_, String>(13)?,
            }))
        })
        .map_err(|_| CommandError::internal())?
        .filter_map(Result::ok)
        .collect::<Vec<_>>();

    Ok(json!({ "items": rows }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn setup_test_state() -> (tempfile::TempDir, DesktopState) {
        let dir = tempdir().expect("create tempdir");
        storage::initialize(dir.path()).expect("init db");
        let state = DesktopState {
            server_origin: std::sync::RwLock::new("http://localhost:3000".to_string()),
            offline_max_age_hours: 24,
            data_dir: dir.path().to_path_buf(),
            http: reqwest::Client::new(),
            turso_config: std::sync::RwLock::new(None),
            session: std::sync::Mutex::new(None),
            vault_lock: std::sync::Mutex::new(()),
        };
        (dir, state)
    }

    /// Draft tanpa satu pun sakelar berarti KEEMPATNYA MATI.
    ///
    /// Ini yang dulu tidak berlaku: `bolos` dan `ambang_alfa` berbawaan HIDUP
    /// di sisi konfigurasi sementara `wa_notify_enabled` membaca MATI untuk
    /// kunci yang belum ada. Kartu Pengaturan menampilkan dua sakelar menyala,
    /// tidak ada satu pun notifikasi yang pernah diantrekan, dan tidak ada apa
    /// pun yang menjelaskan selisihnya. Test ini mengunci keduanya pada jawaban
    /// yang sama.
    #[test]
    fn sakelar_wa_bawaannya_mati_semua() {
        let switches = parse_wa_switches(&json!({}));
        assert_eq!(switches.scan_masuk, 0);
        assert_eq!(switches.scan_pulang, 0);
        assert_eq!(switches.bolos, 0);
        assert_eq!(switches.ambang_alfa, 0);

        // Cerminan yang ditulis ke `setting_gex_system` harus dibaca MATI oleh
        // mesin yang sama yang dipakai scanner.
        let mirror = wa_setting_mirror(&switches);
        let settings: HashMap<String, String> = mirror
            .iter()
            .map(|(k, v)| ((*k).to_owned(), v.clone()))
            .collect();
        for jenis in ["scan_masuk", "scan_pulang", "bolos", "ambang_alfa"] {
            assert!(
                !wa_notify_enabled(&settings, jenis),
                "{jenis} seharusnya mati secara bawaan"
            );
        }
    }

    /// Sakelar yang dinyalakan benar-benar sampai ke pembaca mesin.
    #[test]
    fn sakelar_wa_yang_dinyalakan_terbaca_hidup() {
        let switches = parse_wa_switches(&json!({
            "scan_masuk_enabled": true,
            "bolos_enabled": 1,
        }));
        let settings: HashMap<String, String> = wa_setting_mirror(&switches)
            .iter()
            .map(|(k, v)| ((*k).to_owned(), v.clone()))
            .collect();
        assert!(wa_notify_enabled(&settings, "scan_masuk"));
        assert!(wa_notify_enabled(&settings, "bolos"));
        assert!(!wa_notify_enabled(&settings, "scan_pulang"));
        assert!(!wa_notify_enabled(&settings, "ambang_alfa"));
    }

    /// Cerminan lokal membuat sakelar berlaku SEBELUM pull berikutnya.
    #[test]
    fn cerminan_lokal_langsung_terbaca_scanner() {
        let (_dir, state) = setup_test_state();
        let switches = parse_wa_switches(&json!({ "scan_masuk_enabled": true }));
        mirror_wa_switches_local(&state, &switches).expect("tulis cerminan lokal");

        let connection = storage::database(&state.data_dir).expect("buka database lokal");
        let mut statement = connection
            .prepare("SELECT key, value FROM setting_gex_system;")
            .expect("baca setting");
        let settings: HashMap<String, String> = statement
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
            .expect("query setting")
            .filter_map(Result::ok)
            .collect();

        assert!(wa_notify_enabled(&settings, "scan_masuk"));
        assert!(!wa_notify_enabled(&settings, "scan_pulang"));
    }

    /// Seed satu siswa (punya nomor wali) dan satu pegawai.
    fn seed_personil(connection: &Connection) {
        connection
            .execute_batch(
                r#"
        INSERT INTO master_data (id_unik, kode_karyawan, nama, divisi, id_shift, status_aktif, token_absensi, qr_code, jenis_personil)
        VALUES ('S001', 'S001', 'Ananda Siswa', 'X-A', 1, 'Aktif', 'TOK-S', 'S001|TOK-S', 'SISWA');
        INSERT INTO master_data (id_unik, kode_karyawan, nama, divisi, id_shift, status_aktif, token_absensi, qr_code, jenis_personil)
        VALUES ('P001', 'P001', 'Budi Pegawai', 'Dapur', 1, 'Aktif', 'TOK-P', 'P001|TOK-P', 'Pegawai');
        INSERT INTO siswa_data (id_siswa, nama_lengkap, id_rombel, no_whatsapp_wali, angkatan, created_at, updated_at)
        VALUES ('S001', 'Ananda Siswa', 'RB1', '081234567890', 2026, '2026-01-01 00:00:00', '2026-01-01 00:00:00');
        "#,
            )
            .expect("seed personil");
    }

    fn nyalakan(connection: &Connection, key: &str) {
        connection
            .execute(
                "INSERT INTO setting_gex_system (key, value) VALUES (?1, 'true') ON CONFLICT(key) DO UPDATE SET value = 'true';",
                params![key],
            )
            .expect("nyalakan sakelar");
    }

    /// Guru dan pegawai TIDAK pernah diberi notifikasi wali.
    ///
    /// Ini inti aturannya, bukan detail: pesan ini ditujukan kepada wali murid,
    /// dan seorang pegawai tidak punya wali. Predikat siswanya juga sengaja
    /// memakai bentuk `LOWER(TRIM(...))` — `jenis_personil` tersimpan dengan
    /// ejaan berbeda-beda ('SISWA' dari alur akademik, 'Pegawai' dari impor),
    /// dan perbandingan mentah akan melewatkan justru siswa yang dituju.
    #[test]
    fn notifikasi_wali_hanya_untuk_siswa() {
        let (_dir, state) = setup_test_state();
        let mut connection = storage::database(&state.data_dir).expect("database lokal");
        seed_personil(&connection);
        nyalakan(&connection, WA_NOTIFY_KOREKSI_ADMIN_KEY);

        let tx = connection.transaction().expect("transaksi");

        let pegawai = queue_wali_notification_tx(
            &tx,
            "cli_1",
            "koreksi_admin",
            "P001",
            "koreksi_admin:P001:Hadir",
            |_| "tidak boleh terkirim".to_owned(),
        )
        .expect("evaluasi pegawai");
        assert!(!pegawai, "pegawai tidak boleh diberi notifikasi wali");

        let siswa = queue_wali_notification_tx(
            &tx,
            "cli_1",
            "koreksi_admin",
            "S001",
            "koreksi_admin:S001:Hadir",
            |wali| format!("Halo wali dari {}", wali.nama),
        )
        .expect("evaluasi siswa");
        assert!(siswa, "siswa dengan nomor wali valid harus diantrekan");

        let jumlah: i64 = tx
            .query_row("SELECT COUNT(*) FROM notifikasi_wa;", [], |row| row.get(0))
            .expect("hitung antrean");
        assert_eq!(jumlah, 1, "hanya barisan siswa yang boleh lahir");
    }

    /// Sakelar mati berarti tidak ada baris sama sekali.
    #[test]
    fn notifikasi_wali_menghormati_sakelar() {
        let (_dir, state) = setup_test_state();
        let mut connection = storage::database(&state.data_dir).expect("database lokal");
        seed_personil(&connection);
        // Sengaja TIDAK menyalakan sakelarnya.

        let tx = connection.transaction().expect("transaksi");
        let hasil = queue_wali_notification_tx(
            &tx,
            "cli_1",
            "import_manual",
            "S001",
            "import_manual:S001:2026-09-17:Hadir",
            |_| "tidak boleh terkirim".to_owned(),
        )
        .expect("evaluasi");
        assert!(!hasil);

        let jumlah: i64 = tx
            .query_row("SELECT COUNT(*) FROM notifikasi_wa;", [], |row| row.get(0))
            .expect("hitung antrean");
        assert_eq!(jumlah, 0);
    }

    /// Kunci deduplikasi yang sama tidak pernah mengantre dua kali.
    #[test]
    fn notifikasi_wali_dedupe_sekali_saja() {
        let (_dir, state) = setup_test_state();
        let mut connection = storage::database(&state.data_dir).expect("database lokal");
        seed_personil(&connection);
        nyalakan(&connection, WA_NOTIFY_IMPORT_MANUAL_KEY);

        let tx = connection.transaction().expect("transaksi");
        let kunci = "import_manual:S001:2026-09-17:Hadir";
        let pertama =
            queue_wali_notification_tx(&tx, "cli_1", "import_manual", "S001", kunci, |_| {
                "pesan".to_owned()
            })
            .expect("antrean pertama");
        let kedua =
            queue_wali_notification_tx(&tx, "cli_1", "import_manual", "S001", kunci, |_| {
                "pesan".to_owned()
            })
            .expect("antrean kedua");

        assert!(pertama);
        assert!(!kedua, "kunci yang sama tidak boleh mengantre dua kali");
    }

    /// Vektor kembar dengan `wa-notification.test.ts`. Keduanya WAJIB memetakan
    /// jenis ke kunci yang sama persis: satu database dilayani Web dan Desktop
    /// bergantian, dan kunci yang berbeda akan membuat sakelar yang dimatikan di
    /// satu layar tidak berlaku di terminal lain.
    #[test]
    fn kunci_sakelar_notifikasi_sesuai_vektor() {
        let vektor = [
            ("scan_masuk", Some("wa_notify_scan_masuk")),
            ("scan_pulang", Some("wa_notify_scan_pulang")),
            ("bolos", Some("wa_notify_bolos")),
            ("ambang_alfa", Some("wa_notify_ambang_alfa")),
            ("", None),
            ("Scan_Masuk", None),
            ("broadcast", None),
        ];
        for (jenis, harapan) in vektor {
            assert_eq!(
                wa_notify_setting_key(jenis),
                harapan,
                "pemetaan kunci untuk jenis '{jenis}' menyimpang",
            );
        }
    }

    /// Kunci yang belum pernah ditulis berarti MATI.
    ///
    /// Inilah yang membuat pemasangan yang sudah berjalan tidak tiba-tiba
    /// menimbun antrean notifikasi hanya karena aplikasinya diperbarui.
    #[test]
    fn sakelar_notifikasi_bawaannya_mati() {
        let mut settings = HashMap::new();
        for jenis in ["scan_masuk", "scan_pulang", "bolos", "ambang_alfa"] {
            assert!(
                !wa_notify_enabled(&settings, jenis),
                "jenis '{jenis}' menyala padahal kuncinya belum pernah ditulis",
            );
        }

        settings.insert(WA_NOTIFY_SCAN_MASUK_KEY.to_string(), "true".to_string());
        assert!(wa_notify_enabled(&settings, "scan_masuk"));
        // Menyalakan satu jenis tidak boleh menyalakan jenis lain.
        assert!(!wa_notify_enabled(&settings, "scan_pulang"));

        // Nilai selain "true" berarti mati, dan jenis asing selalu mati.
        settings.insert(WA_NOTIFY_BOLOS_KEY.to_string(), "1".to_string());
        assert!(!wa_notify_enabled(&settings, "bolos"));
        settings.insert(WA_NOTIFY_BOLOS_KEY.to_string(), "TRUE".to_string());
        assert!(wa_notify_enabled(&settings, "bolos"));
        assert!(!wa_notify_enabled(&settings, "jenis_yang_tidak_ada"));
    }

    /// Ambang alfa diurai SAMA PERSIS dengan `parseAmbangAlfaLimit` dan
    /// `parseAmbangAlfaDays` di `src/lib/validations/wa-notification.ts`.
    ///
    /// Vektornya disalin dari `wa-notification.test.ts` supaya keduanya
    /// bergerak bersama. Sebelum batas atas ini ada, sisi Rust menerima 101 apa
    /// adanya sementara TypeScript menolaknya dan memakai 3: mesin evaluasi di
    /// Desktop dan di Web lalu memakai ambang yang berbeda untuk sekolah yang
    /// sama, tanpa satu pun pesan kesalahan yang menunjukkannya.
    #[test]
    fn ambang_alfa_diurai_sesuai_vektor_typescript() {
        let urai = |limit: &str, days: &str| {
            let mut settings = HashMap::new();
            settings.insert(
                WA_NOTIFY_AMBANG_ALFA_LIMIT_KEY.to_string(),
                limit.to_string(),
            );
            settings.insert(
                WA_NOTIFY_AMBANG_ALFA_DAYS_KEY.to_string(),
                days.to_string(),
            );
            parse_ambang_alfa_settings(&settings)
        };

        // Dalam rentang: dipakai apa adanya.
        assert_eq!(urai("5", "60"), (5, 60));
        assert_eq!(urai("1", "1"), (1, 1));
        // Tepat di tepi rentang masih sah.
        assert_eq!(urai("100", "365"), (100, 365));
        // Di luar rentang jatuh ke BAWAAN, bukan dipotong ke tepi.
        assert_eq!(urai("101", "366"), (3, 30));
        assert_eq!(urai("0", "0"), (3, 30));
        assert_eq!(urai("-4", "-1"), (3, 30));
        assert_eq!(urai("500", "9999"), (3, 30));
        // Bukan angka, dan pecahan, juga jatuh ke bawaan.
        assert_eq!(urai("bukan_angka", "bukan_angka"), (3, 30));
        assert_eq!(urai("3.5", "30.5"), (3, 30));
        // Spasi di sekelilingnya dibuang lebih dulu.
        assert_eq!(urai(" 7 ", " 14 "), (7, 14));

        // Kunci yang belum pernah ditulis memakai bawaan.
        let kosong: HashMap<String, String> = HashMap::new();
        assert_eq!(
            parse_ambang_alfa_settings(&kosong),
            (DEFAULT_AMBANG_ALFA_LIMIT, DEFAULT_AMBANG_ALFA_DAYS)
        );
    }

    /// Status asing DITOLAK, bukan diam-diam menjadi `Menunggu`.
    ///
    /// `Menunggu` adalah satu-satunya status yang benar-benar dikirim, jadi
    /// menormalkannya mengubah bug klien menjadi pesan WhatsApp ke nomor wali
    /// seorang siswa — dan pesan yang sudah terkirim tidak bisa ditarik.
    #[test]
    fn status_notifikasi_asing_ditolak_bukan_dinormalkan() {
        let (_dir, state) = setup_test_state();
        let mut connection = storage::database(&state.data_dir).expect("open db");
        let tx = connection.transaction().expect("transaction");

        let draft = json!({
            "dedupe_key": "uji:1",
            "jenis": "scan_masuk",
            "id_siswa": "sis_01",
            "tujuan_nomor": "081234567890",
            "isi_pesan": "halo",
            "status": "Terkirim Sebagian",
        });
        let hasil = queue_wa_notification_tx(&tx, "cli_1", &draft);
        let galat = hasil.expect_err("status asing wajib ditolak");
        assert_eq!(galat.code, "VALIDATION_ERROR");

        // Keempat nilai kanonik tetap diterima.
        for status in ["Menunggu", "Terkirim", "Gagal", "Dibatalkan"] {
            let draft = json!({
                "dedupe_key": format!("uji:{status}"),
                "jenis": "scan_masuk",
                "id_siswa": "sis_01",
                "tujuan_nomor": "081234567890",
                "isi_pesan": "halo",
                "status": status,
            });
            queue_wa_notification_tx(&tx, "cli_1", &draft)
                .unwrap_or_else(|e| panic!("status '{status}' seharusnya sah: {e:?}"));
        }
    }

    /// Pemangkasan hanya menyentuh baris berstatus akhir yang sudah tua DAN
    /// tidak lagi punya event outbox yang menunggu.
    #[test]
    fn pemangkasan_hanya_baris_selesai_dan_sudah_terkirim() {
        let (_dir, state) = setup_test_state();
        let connection = storage::database(&state.data_dir).expect("open db");

        let lama = format!("-{} days", WA_QUEUE_RETENTION_DAYS + 5);
        let baru = "-1 days";
        let baris = [
            ("n_lama_terkirim", "Terkirim", lama.as_str()),
            ("n_lama_dibatalkan", "Dibatalkan", lama.as_str()),
            ("n_lama_menunggu", "Menunggu", lama.as_str()),
            ("n_lama_gagal", "Gagal", lama.as_str()),
            ("n_baru_terkirim", "Terkirim", baru),
            ("n_lama_terkirim_outbox", "Terkirim", lama.as_str()),
        ];
        for (id, status, umur) in baris {
            connection
                .execute(
                    r#"INSERT INTO notifikasi_wa (
                        id_notifikasi, dedupe_key, jenis, id_siswa, tujuan_nomor,
                        isi_pesan, status, attempt_count, created_at, updated_at
                    ) VALUES (?1, ?1, 'scan_masuk', 'sis_01', '+628123456789',
                              'pesan', ?2, 0, datetime('now', ?3), datetime('now', ?3));"#,
                    params![id, status, umur],
                )
                .expect("seed notifikasi");
        }

        // Satu baris masih punya event outbox tertunda: menghapusnya lebih dulu
        // akan membuat event yang sudah antre menunjuk baris yang tidak ada.
        connection
            .execute(
                r#"INSERT INTO desktop_sync_outbox (
                    event_id, client_id, domain, operation, entity_key,
                    payload_json, status, attempt_count, created_at, updated_at
                ) VALUES ('ev_1', 'cli_1', 'wa-notification', 'queue',
                          'n_lama_terkirim_outbox', '{}', 'pending', 0, 0, 0);"#,
                [],
            )
            .expect("seed outbox");

        let dihapus = purge_expired_notifications(&connection).expect("purge");
        assert_eq!(dihapus, 2, "hanya dua baris yang memenuhi syarat");

        let tersisa: Vec<String> = connection
            .prepare("SELECT id_notifikasi FROM notifikasi_wa ORDER BY id_notifikasi;")
            .expect("prepare")
            .query_map([], |row| row.get(0))
            .expect("query")
            .filter_map(Result::ok)
            .collect();
        assert_eq!(
            tersisa,
            vec![
                "n_baru_terkirim".to_string(),
                "n_lama_gagal".to_string(),
                "n_lama_menunggu".to_string(),
                "n_lama_terkirim_outbox".to_string(),
            ],
        );
    }

    #[test]
    fn test_phone_normalization() {
        assert_eq!(normalize_phone_canonical("081234567890"), "+6281234567890");
        assert_eq!(normalize_phone_canonical("6281234567890"), "+6281234567890");
        assert_eq!(
            normalize_phone_canonical("+6281234567890"),
            "+6281234567890"
        );
        assert_eq!(
            normalize_phone_canonical("0812-3456-7890"),
            "+6281234567890"
        );
        assert_eq!(
            normalize_phone_canonical("+62 812 3456 7890"),
            "+6281234567890"
        );
        assert!(is_valid_phone("081234567890"));
        assert!(!is_valid_phone("12345"));
    }

    #[test]
    fn test_wa_notification_lifecycle() {
        let (_dir, state) = setup_test_state();

        let draft = json!({
            "dedupe_key": "scan:sesi_001",
            "jenis": "scan_masuk",
            "id_siswa": "siswa_01",
            "tujuan_nomor": "081234567890",
            "isi_pesan": "Ananda telah hadir di sekolah.",
        });

        let res = queue_wa_notification(&state, &draft).expect("queue notification");
        assert_eq!(res["sukses"], true);
        let id = res["id_notifikasi"].as_str().expect("id string");
        assert!(id.starts_with("wa_"));

        let list = list_wa_notifications(&state, None, None, None, None, None, false)
            .expect("list notifications");
        let items = list["items"].as_array().expect("array");
        assert_eq!(items.len(), 1);
        assert_eq!(items[0]["status"], "Menunggu");
        assert_eq!(items[0]["tujuan_nomor"], "+6281234567890");

        let cancel_res = cancel_wa_notification(&state, id, Some("Dibatalkan penguji"))
            .expect("cancel notification");
        assert_eq!(cancel_res["sukses"], true);

        let list_after = list_wa_notifications(&state, None, None, None, None, None, false)
            .expect("list notifications");
        let items_after = list_after["items"].as_array().expect("array");
        assert_eq!(items_after[0]["status"], "Dibatalkan");
    }
}
