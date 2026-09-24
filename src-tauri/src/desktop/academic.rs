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

/// Shift (jam scan) pilihan draft guru/siswa, bila draft mengirimnya.
///
/// Shift menentukan jendela scan masuk/pulang seorang personil. `None` berarti
/// draft tidak memilih: baris baru jatuh ke shift 1 seperti sebelumnya, baris
/// lama MEMPERTAHANKAN shift-nya — impor atau formulir lama yang tidak mengenal
/// kolom ini tidak boleh diam-diam memindahkan semua orang ke shift 1. Shift
/// yang dipilih wajib ada: `id_shift` yatim membuat setiap scan orang itu
/// ditolak tanpa petunjuk apa pun di layar.
fn chosen_shift(
    transaction: &rusqlite::Transaction<'_>,
    draft: &Value,
) -> Result<Option<i64>, CommandError> {
    let Some(id_shift) = draft.get("id_shift").and_then(Value::as_i64) else {
        return Ok(None);
    };
    let ada = transaction
        .prepare("SELECT 1 FROM tbl_shift WHERE id_shift = ?1 LIMIT 1;")
        .map_err(|_| CommandError::internal())?
        .exists(params![id_shift])
        .map_err(|_| CommandError::internal())?;
    if !ada {
        return Err(CommandError::new(
            "VALIDATION_ERROR",
            "Shift yang dipilih tidak ditemukan. Muat ulang halaman lalu pilih shift lagi.",
        ));
    }
    Ok(Some(id_shift))
}

/// Id entitas akademik dibuat KLIEN, bukan AUTOINCREMENT.
///
/// Alasannya sama persis dengan `new_whitelist_id` di `operational.rs`: dua
/// perangkat yang sedang offline sama-sama boleh menambah rombel atau siswa,
/// dan kunci berupa nomor urut membuat keduanya memakai angka yang sama lalu
/// saling menimpa begitu tersinkronisasi. 128 bit acak membuat keduanya hidup
/// berdampingan. `rand_core::OsRng` dipakai karena sudah menjadi dependensi
/// proyek — jangan menambah crate baru hanya untuk membuat id.
fn new_academic_id(prefix: &str) -> String {
    let mut bytes = [0u8; 16];
    rand_core::RngCore::fill_bytes(&mut rand_core::OsRng, &mut bytes);
    let mut id = String::with_capacity(prefix.len() + 32);
    id.push_str(prefix);
    for byte in bytes {
        id.push_str(&format!("{byte:02x}"));
    }
    id
}

/// Stempel waktu akademik SELALU dihitung SQLite, tidak pernah jam proses.
///
/// Satu baris yang sama bisa ditulis Rust di aplikasi Tauri lalu dibaca
/// TypeScript di Web, dan sebaliknya. `datetime('now')` membuat kedua jalur
/// menghasilkan bentuk yang identik (`YYYY-MM-DD HH:MM:SS` UTC), sehingga
/// pengurutan dan perbandingan `updated_at` tetap benar lintas jalur.
fn sqlite_now(transaction: &rusqlite::Transaction<'_>) -> String {
    transaction
        .query_row("SELECT datetime('now');", [], |row| row.get(0))
        .unwrap_or_default()
}

/// Enam karakter pertama sesudah awalan id, untuk kode personil cadangan.
///
/// Mengiris `&id[4..10]` langsung akan PANIC pada id yang lebih pendek atau
/// yang batas karakternya bukan di byte ke-10 — dan id pada jalur sunting
/// datang dari luar, bukan selalu dari `new_academic_id`.
/// Pastikan personil punya `token_absensi`, dan kembalikan `(token, qr, baru)`.
///
/// Terminal pemindai membandingkan `token_absensi` apa adanya dan menuntut isi
/// QR berbentuk `id|token`; tanpa token, setiap kartu guru dan siswa ditolak
/// dengan "Format QR tidak valid". Token yang sudah ada TIDAK PERNAH ditimpa —
/// kartu yang terlanjur dicetak dan dibagikan harus tetap sah.
fn ensure_scan_token(
    transaction: &rusqlite::Transaction<'_>,
    client_id: &str,
    id: &str,
) -> Result<(String, String, bool), CommandError> {
    use rusqlite::OptionalExtension;

    let existing: Option<String> = transaction
        .query_row(
            "SELECT token_absensi FROM master_data WHERE id_unik = ?1;",
            params![id],
            |row| row.get::<_, Option<String>>(0),
        )
        .optional()
        .map_err(|_| CommandError::internal())?
        .flatten()
        .filter(|token| !token.trim().is_empty());

    let is_new = existing.is_none();
    let token = existing.unwrap_or_else(|| {
        super::operational::token_from_event(&sync::new_event_id(client_id, "employee", "token"))
    });
    let qr_code = format!("{id}|{token}");
    Ok((token, qr_code, is_new))
}

/// Batas foto profil personil dalam karakter base64 (±500 KB).
///
/// Angkanya WAJIB sama dengan `MAX_PERSONNEL_PHOTO_SIZE` di `sync-schema.ts`.
/// Alasannya sama dengan `MAX_SCAN_PHOTO_BASE64`: foto yang lolos di perangkat
/// tetapi ditolak validator di batas sinkronisasi akan macet selamanya di outbox
/// tanpa pernah bisa berhasil. Diberi nama supaya kedua sisi tidak bisa bergeser
/// diam-diam.
pub const MAX_PERSONNEL_PHOTO_BASE64: usize = 512_000;

/// Tolak nilai yang seharusnya unik, di lapisan aplikasi — bukan lewat UNIQUE.
///
/// Tabel akademik ikut sinkronisasi, dan UNIQUE di sana membuat push gagal
/// PERMANEN begitu dua perangkat offline mendaftarkan nilai yang sama: cloud
/// menolak, event berhenti di `failed` dengan `next_retry_at = NULL`, dan
/// operatornya tidak punya jalan pulih dari UI. Pola ini sama dengan
/// `assert_whitelist_unique` di `operational.rs`: cegah di titik masuk dengan
/// pesan yang bisa ditindaklanjuti, dan biarkan tabrakan offline yang langka
/// hidup sebagai dua baris yang bisa digabung admin.
///
/// Perbandingannya case-insensitive dan mengabaikan spasi tepi, karena "RPL"
/// dan "rpl " adalah kode yang sama bagi manusia yang mengetikkannya.
fn assert_unique_value(
    transaction: &rusqlite::Transaction<'_>,
    table: &str,
    column: &str,
    id_column: &str,
    value: &str,
    except_id: &str,
    message: &str,
) -> Result<(), CommandError> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Ok(());
    }
    let sql = format!(
        "SELECT 1 FROM {table} WHERE LOWER(TRIM({column})) = LOWER(TRIM(?1)) AND {id_column} <> ?2 LIMIT 1;"
    );
    let bentrok = transaction
        .prepare(&sql)
        .map_err(|_| CommandError::internal())?
        .exists(params![trimmed, except_id])
        .map_err(|_| CommandError::internal())?;
    if bentrok {
        return Err(CommandError::new("VALIDATION_ERROR", message.to_owned()));
    }
    Ok(())
}

/// Daftarkan perubahan `master_data` milik guru/siswa ke outbox.
///
/// `master_data` ikut disinkronkan, jadi baris yang ditulis di sini WAJIB punya
/// event sendiri — tanpa itu perubahannya berhenti di perangkat ini dan baris
/// cloud yang lama akan mengembalikannya pada tarikan berikutnya. Dipecah dua
/// karena handler cloud `employee/update` sengaja tidak menyentuh kolom token;
/// itu tugas `employee/token`.
fn enqueue_personnel_events(
    transaction: &rusqlite::Transaction<'_>,
    client_id: &str,
    id: &str,
    token: &str,
    qr_code: &str,
    token_is_new: bool,
) -> Result<(), CommandError> {
    sync::enqueue_employee_snapshot(transaction, client_id, id)?;
    if token_is_new {
        sync::enqueue(
            transaction,
            client_id,
            "employee",
            "token",
            id,
            &json!({
                "id_unik": id,
                "token_absensi": token,
                "qr_code": qr_code,
                "status_qr": "Generated",
            }),
            None,
        )?;
    }
    Ok(())
}

// ── 1. Tahun Ajaran ─────────────────────────────────────────────────────────

pub fn list_academic_years(state: &DesktopState) -> Result<Value, CommandError> {
    let conn = storage::database(&state.data_dir)?;
    let mut stmt = conn
        .prepare(
            r#"
            SELECT id_tahun_ajaran, nama_tahun, semester, tanggal_mulai, tanggal_selesai,
                   is_aktif, created_at, updated_at
            FROM akademik_tahun_ajaran
            ORDER BY tanggal_mulai DESC;
            "#,
        )
        .map_err(|_| CommandError::internal())?;

    let rows = stmt
        .query_map([], |row| {
            Ok(json!({
                "id_tahun_ajaran": row.get::<_, String>(0)?,
                "nama_tahun": row.get::<_, String>(1)?,
                "semester": row.get::<_, String>(2)?,
                "tanggal_mulai": row.get::<_, String>(3)?,
                "tanggal_selesai": row.get::<_, String>(4)?,
                "is_aktif": row.get::<_, i64>(5)?,
                "created_at": row.get::<_, String>(6)?,
                "updated_at": row.get::<_, String>(7)?,
            }))
        })
        .map_err(|_| CommandError::internal())?
        .filter_map(Result::ok)
        .collect::<Vec<_>>();

    Ok(json!(rows))
}

pub fn save_academic_year(state: &DesktopState, draft: &Value) -> Result<Value, CommandError> {
    let mut conn = storage::database(&state.data_dir)?;
    let tx = conn.transaction().map_err(|_| CommandError::internal())?;

    let now = sqlite_now(&tx);
    let is_new = text(draft, "id_tahun_ajaran").is_empty();
    let id = if is_new {
        new_academic_id("ta_")
    } else {
        text(draft, "id_tahun_ajaran").to_owned()
    };

    let nama_tahun = text(draft, "nama_tahun");
    let semester = text(draft, "semester");
    let tanggal_mulai = text(draft, "tanggal_mulai");
    let tanggal_selesai = text(draft, "tanggal_selesai");
    let is_aktif = integer(draft, "is_aktif", 0);

    if nama_tahun.is_empty() || tanggal_mulai.is_empty() || tanggal_selesai.is_empty() {
        return Err(CommandError::new(
            "VALIDATION_ERROR",
            "Nama tahun ajaran dan rentang tanggal wajib diisi.",
        ));
    }

    if is_aktif == 1 {
        tx.execute("UPDATE akademik_tahun_ajaran SET is_aktif = 0;", [])
            .map_err(|_| CommandError::internal())?;
    }

    tx.execute(
        r#"
        INSERT INTO akademik_tahun_ajaran (
            id_tahun_ajaran, nama_tahun, semester, tanggal_mulai, tanggal_selesai,
            is_aktif, created_at, updated_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
        ON CONFLICT(id_tahun_ajaran) DO UPDATE SET
            nama_tahun = excluded.nama_tahun,
            semester = excluded.semester,
            tanggal_mulai = excluded.tanggal_mulai,
            tanggal_selesai = excluded.tanggal_selesai,
            is_aktif = excluded.is_aktif,
            updated_at = excluded.updated_at;
        "#,
        params![
            id,
            nama_tahun,
            semester,
            tanggal_mulai,
            tanggal_selesai,
            is_aktif,
            now,
            now
        ],
    )
    .map_err(|e| CommandError::new("DB_ERROR", format!("Gagal menyimpan tahun ajaran: {e}")))?;

    let client_id = sync::ensure_client_id(state)?;
    let op = if is_new { "create" } else { "update" };
    let payload = json!({
        "id_tahun_ajaran": id,
        "nama_tahun": nama_tahun,
        "semester": semester,
        "tanggal_mulai": tanggal_mulai,
        "tanggal_selesai": tanggal_selesai,
        "is_aktif": is_aktif,
        "created_at": now,
        "updated_at": now,
    });

    sync::enqueue(&tx, &client_id, "academic-year", op, &id, &payload, None)?;
    tx.commit().map_err(|_| CommandError::internal())?;

    Ok(json!({ "sukses": true, "id_tahun_ajaran": id }))
}

// ── Penjaga penghapusan master ────────────────────────────────────────────
//
// Tabel `akademik_*` TIDAK punya FOREIGN KEY, jadi SQLite menerima penghapusan
// rombel yang masih berisi siswa, mapel yang masih punya penugasan, atau tahun
// ajaran yang masih punya rombel — lalu meninggalkan baris yatim yang lenyap
// dari setiap daftar yang memakai JOIN. Pemeriksaan ini menggantikan FK yang
// tidak ada. Daftarnya dieja DUA KALI dan wajib sama: di sini dan di
// `ACADEMIC_USAGE` pada `lib/services/academic.ts` (jalur Web).
//
// Hanya penghapusan yang BERASAL dari perangkat ini yang dijaga; penghapusan
// yang datang lewat sinkronisasi sudah diputuskan di perangkat asalnya.

const YEAR_USAGE: &[(&str, &str)] = &[
    ("SELECT COUNT(*) FROM akademik_rombel WHERE id_tahun_ajaran = ?1;", "rombel"),
    ("SELECT COUNT(*) FROM presensi_mapel WHERE id_tahun_ajaran = ?1;", "sesi presensi kelas"),
];
const DEPARTMENT_USAGE: &[(&str, &str)] = &[
    ("SELECT COUNT(*) FROM akademik_rombel WHERE id_jurusan = ?1;", "rombel"),
];
// Dicocokkan dengan NAMA unit, bukan id: `master_data.unit` menyimpan nama
// supaya nilainya berarti sama di setiap perangkat. Pemanggilnya menukar id
// menjadi nama lebih dulu.
const UNIT_USAGE: &[(&str, &str)] = &[
    ("SELECT COUNT(*) FROM master_data WHERE unit = ?1;", "personil"),
];
const CLASS_USAGE: &[(&str, &str)] = &[
    ("SELECT COUNT(*) FROM siswa_data WHERE id_rombel = ?1;", "siswa"),
    ("SELECT COUNT(*) FROM akademik_guru_mapel WHERE id_rombel = ?1;", "penugasan guru"),
    ("SELECT COUNT(*) FROM presensi_mapel WHERE id_rombel = ?1;", "sesi presensi kelas"),
];
const SUBJECT_USAGE: &[(&str, &str)] = &[
    ("SELECT COUNT(*) FROM akademik_guru_mapel WHERE id_mapel = ?1;", "penugasan guru"),
    ("SELECT COUNT(*) FROM presensi_mapel WHERE id_mapel = ?1;", "sesi presensi kelas"),
];

fn ensure_academic_unused(
    tx: &rusqlite::Transaction<'_>,
    label: &str,
    checks: &[(&str, &str)],
    id: &str,
    hint: &str,
) -> Result<(), CommandError> {
    let mut reasons = Vec::new();
    for (sql, noun) in checks {
        let count: i64 = tx
            .query_row(sql, params![id], |row| row.get(0))
            .map_err(|_| CommandError::internal())?;
        if count > 0 {
            reasons.push(format!("{count} {noun}"));
        }
    }
    if reasons.is_empty() {
        return Ok(());
    }
    Err(CommandError::new(
        "ACADEMIC_IN_USE",
        format!(
            "{label} tidak dapat dihapus karena masih dipakai: {}. {hint}",
            reasons.join(", ")
        ),
    ))
}

pub fn delete_academic_year(state: &DesktopState, id: &str) -> Result<Value, CommandError> {
    let mut conn = storage::database(&state.data_dir)?;
    let tx = conn.transaction().map_err(|_| CommandError::internal())?;

    let aktif: i64 = tx
        .query_row(
            "SELECT COUNT(*) FROM akademik_tahun_ajaran WHERE id_tahun_ajaran = ?1 AND is_aktif = 1;",
            params![id],
            |row| row.get(0),
        )
        .map_err(|_| CommandError::internal())?;
    if aktif > 0 {
        return Err(CommandError::new(
            "ACADEMIC_IN_USE",
            "Tahun ajaran aktif tidak dapat dihapus. Aktifkan tahun ajaran lain lebih dulu.",
        ));
    }
    ensure_academic_unused(
        &tx,
        "Tahun ajaran",
        YEAR_USAGE,
        id,
        "Hapus atau pindahkan data yang memakainya lebih dulu.",
    )?;

    tx.execute(
        "DELETE FROM akademik_tahun_ajaran WHERE id_tahun_ajaran = ?1;",
        params![id],
    )
    .map_err(|e| CommandError::new("DB_ERROR", format!("Gagal menghapus tahun ajaran: {e}")))?;

    let client_id = sync::ensure_client_id(state)?;
    sync::enqueue(
        &tx,
        &client_id,
        "academic-year",
        "delete",
        id,
        &json!({ "id_tahun_ajaran": id }),
        None,
    )?;
    tx.commit().map_err(|_| CommandError::internal())?;

    Ok(json!({ "sukses": true }))
}

pub fn set_active_academic_year(state: &DesktopState, id: &str) -> Result<Value, CommandError> {
    let mut conn = storage::database(&state.data_dir)?;
    let tx = conn.transaction().map_err(|_| CommandError::internal())?;
    let now = sqlite_now(&tx);

    tx.execute("UPDATE akademik_tahun_ajaran SET is_aktif = 0;", [])
        .map_err(|_| CommandError::internal())?;

    tx.execute(
        "UPDATE akademik_tahun_ajaran SET is_aktif = 1, updated_at = ?2 WHERE id_tahun_ajaran = ?1;",
        params![id, now],
    )
    .map_err(|e| CommandError::new("DB_ERROR", format!("Gagal mengaktifkan tahun ajaran: {e}")))?;

    let row = tx
        .query_row(
            r#"
            SELECT nama_tahun, semester, tanggal_mulai, tanggal_selesai, created_at, updated_at
            FROM akademik_tahun_ajaran WHERE id_tahun_ajaran = ?1;
            "#,
            params![id],
            |r| {
                Ok(json!({
                    "id_tahun_ajaran": id,
                    "nama_tahun": r.get::<_, String>(0)?,
                    "semester": r.get::<_, String>(1)?,
                    "tanggal_mulai": r.get::<_, String>(2)?,
                    "tanggal_selesai": r.get::<_, String>(3)?,
                    "is_aktif": 1,
                    "created_at": r.get::<_, String>(4)?,
                    "updated_at": r.get::<_, String>(5)?,
                }))
            },
        )
        .map_err(|_| CommandError::new("NOT_FOUND", "Tahun ajaran tidak ditemukan."))?;

    let client_id = sync::ensure_client_id(state)?;
    sync::enqueue(&tx, &client_id, "academic-year", "update", id, &row, None)?;
    tx.commit().map_err(|_| CommandError::internal())?;

    Ok(json!({ "sukses": true }))
}

// ── 2. Jurusan ──────────────────────────────────────────────────────────────

// ── 1b. Unit satuan pendidikan ──────────────────────────────────────────────
//
// Dipakai sebagai dropdown di formulir peserta didik, guru/PTK, dan karyawan.
// `master_data.unit` menyimpan NAMA unit, bukan `id_unit`: id dibuat per
// perangkat, sedangkan nama itulah yang berarti sama di semua perangkat.

pub fn list_academic_units(state: &DesktopState) -> Result<Value, CommandError> {
    let conn = storage::database(&state.data_dir)?;
    let mut stmt = conn
        .prepare(
            r#"
            SELECT id_unit, nama_unit, keterangan, urutan, status_aktif
            FROM akademik_unit
            ORDER BY urutan ASC, nama_unit ASC;
            "#,
        )
        .map_err(|_| CommandError::internal())?;

    let rows = stmt
        .query_map([], |row| {
            Ok(json!({
                "id_unit": row.get::<_, String>(0)?,
                "nama_unit": row.get::<_, String>(1)?,
                "keterangan": row.get::<_, Option<String>>(2)?,
                "urutan": row.get::<_, i64>(3)?,
                "status_aktif": row.get::<_, i64>(4)?,
            }))
        })
        .map_err(|_| CommandError::internal())?
        .filter_map(Result::ok)
        .collect::<Vec<_>>();

    Ok(json!(rows))
}

pub fn save_academic_unit(state: &DesktopState, draft: &Value) -> Result<Value, CommandError> {
    let mut conn = storage::database(&state.data_dir)?;
    let tx = conn.transaction().map_err(|_| CommandError::internal())?;

    let is_new = text(draft, "id_unit").is_empty();
    let id = if is_new {
        new_academic_id("unt_")
    } else {
        text(draft, "id_unit").to_owned()
    };

    let nama = text(draft, "nama_unit");
    let keterangan = optional_text(draft, "keterangan");
    let urutan = integer(draft, "urutan", 0);
    let status_aktif = integer(draft, "status_aktif", 1);

    if nama.is_empty() {
        return Err(CommandError::new(
            "VALIDATION_ERROR",
            "Nama unit wajib diisi.",
        ));
    }

    assert_unique_value(
        &tx,
        "akademik_unit",
        "nama_unit",
        "id_unit",
        nama,
        &id,
        "Nama unit ini sudah terdaftar.",
    )?;

    // Nama lama dibaca SEBELUM ditimpa. Bila berubah, personil yang memakainya
    // ikut dipindahkan dalam transaksi yang sama — tanpa itu, mengganti "SMP"
    // menjadi "SMP Islam" meninggalkan setiap siswa menunjuk unit yang sudah
    // tidak ada, dan dropdown-nya tampil kosong tanpa satu pun pesan.
    let nama_lama: Option<String> = tx
        .query_row(
            "SELECT nama_unit FROM akademik_unit WHERE id_unit = ?1;",
            params![id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|_| CommandError::internal())?;

    tx.execute(
        r#"
        INSERT INTO akademik_unit (
            id_unit, nama_unit, keterangan, urutan, status_aktif, created_at, updated_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, datetime('now'), datetime('now'))
        ON CONFLICT(id_unit) DO UPDATE SET
            nama_unit = excluded.nama_unit,
            keterangan = excluded.keterangan,
            urutan = excluded.urutan,
            status_aktif = excluded.status_aktif,
            updated_at = datetime('now');
        "#,
        params![id, nama, keterangan, urutan, status_aktif],
    )
    .map_err(|e| CommandError::new("DB_ERROR", format!("Gagal menyimpan unit: {e}")))?;

    let client_id = sync::ensure_client_id(state)?;

    if let Some(lama) = nama_lama.filter(|lama| lama != nama) {
        let terdampak: Vec<String> = {
            let mut stmt = tx
                .prepare("SELECT id_unik FROM master_data WHERE unit = ?1;")
                .map_err(|_| CommandError::internal())?;
            let ids = stmt
                .query_map(params![lama], |row| row.get::<_, String>(0))
                .map_err(|_| CommandError::internal())?
                .filter_map(Result::ok)
                .collect::<Vec<_>>();
            ids
        };
        tx.execute(
            "UPDATE master_data SET unit = ?1 WHERE unit = ?2;",
            params![nama, lama],
        )
        .map_err(|e| CommandError::new("DB_ERROR", format!("Gagal memindahkan unit: {e}")))?;

        // Setiap baris yang berubah butuh event outbox-nya sendiri: cloud
        // menerapkan perubahan per entitas, jadi rename yang hanya mengirim
        // event unit akan benar di perangkat ini dan salah di semua yang lain.
        //
        // Dikirim sebagai SNAPSHOT baris utuh, bukan `{id_unik, unit}` saja:
        // `employeeUpdatePayload` di `sync-schema.ts` menuntut `kode_karyawan`,
        // `nama`, dan `divisi` sebagai field WAJIB. Payload sebagian akan
        // ditolak validatornya di cloud, dan penolakan itu mengunci outbox
        // secara PERMANEN (`next_retry_at = NULL`) — satu rename unit akan
        // menghentikan seluruh sinkronisasi perangkat ini.
        for id_unik in terdampak {
            sync::enqueue_employee_snapshot(&tx, &client_id, &id_unik)?;
        }
    }

    let op = if is_new { "create" } else { "update" };
    let payload = json!({
        "id_unit": id,
        "nama_unit": nama,
        "keterangan": keterangan,
        "urutan": urutan,
        "status_aktif": status_aktif,
    });

    sync::enqueue(&tx, &client_id, "academic-unit", op, &id, &payload, None)?;
    tx.commit().map_err(|_| CommandError::internal())?;

    Ok(json!({ "sukses": true, "id_unit": id }))
}

pub fn delete_academic_unit(state: &DesktopState, id: &str) -> Result<Value, CommandError> {
    let mut conn = storage::database(&state.data_dir)?;
    let tx = conn.transaction().map_err(|_| CommandError::internal())?;

    let nama: Option<String> = tx
        .query_row(
            "SELECT nama_unit FROM akademik_unit WHERE id_unit = ?1;",
            params![id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|_| CommandError::internal())?;

    if let Some(nama) = nama.as_deref() {
        ensure_academic_unused(
            &tx,
            "Unit",
            UNIT_USAGE,
            nama,
            "Pindahkan personilnya ke unit lain, atau nonaktifkan unit ini saja.",
        )?;
    }

    tx.execute("DELETE FROM akademik_unit WHERE id_unit = ?1;", params![id])
        .map_err(|e| CommandError::new("DB_ERROR", format!("Gagal menghapus unit: {e}")))?;

    let client_id = sync::ensure_client_id(state)?;
    sync::enqueue(
        &tx,
        &client_id,
        "academic-unit",
        "delete",
        id,
        &json!({ "id_unit": id }),
        None,
    )?;
    tx.commit().map_err(|_| CommandError::internal())?;

    Ok(json!({ "sukses": true }))
}

pub fn list_academic_departments(state: &DesktopState) -> Result<Value, CommandError> {
    let conn = storage::database(&state.data_dir)?;
    let mut stmt = conn
        .prepare(
            r#"
            SELECT id_jurusan, kode_jurusan, nama_jurusan, deskripsi, is_aktif
            FROM akademik_jurusan
            ORDER BY kode_jurusan ASC;
            "#,
        )
        .map_err(|_| CommandError::internal())?;

    let rows = stmt
        .query_map([], |row| {
            Ok(json!({
                "id_jurusan": row.get::<_, String>(0)?,
                "kode_jurusan": row.get::<_, String>(1)?,
                "nama_jurusan": row.get::<_, String>(2)?,
                "deskripsi": row.get::<_, Option<String>>(3)?,
                "is_aktif": row.get::<_, i64>(4)?,
            }))
        })
        .map_err(|_| CommandError::internal())?
        .filter_map(Result::ok)
        .collect::<Vec<_>>();

    Ok(json!(rows))
}

pub fn save_academic_department(
    state: &DesktopState,
    draft: &Value,
) -> Result<Value, CommandError> {
    let mut conn = storage::database(&state.data_dir)?;
    let tx = conn.transaction().map_err(|_| CommandError::internal())?;

    let is_new = text(draft, "id_jurusan").is_empty();
    let id = if is_new {
        new_academic_id("jur_")
    } else {
        text(draft, "id_jurusan").to_owned()
    };

    let kode = text(draft, "kode_jurusan");
    let nama = text(draft, "nama_jurusan");
    let deskripsi = optional_text(draft, "deskripsi");
    let is_aktif = integer(draft, "is_aktif", 1);

    if kode.is_empty() || nama.is_empty() {
        return Err(CommandError::new(
            "VALIDATION_ERROR",
            "Kode jurusan dan nama jurusan wajib diisi.",
        ));
    }

    assert_unique_value(
        &tx,
        "akademik_jurusan",
        "kode_jurusan",
        "id_jurusan",
        kode,
        &id,
        "Kode jurusan sudah dipakai program keahlian lain.",
    )?;

    tx.execute(
        r#"
        INSERT INTO akademik_jurusan (id_jurusan, kode_jurusan, nama_jurusan, deskripsi, is_aktif)
        VALUES (?1, ?2, ?3, ?4, ?5)
        ON CONFLICT(id_jurusan) DO UPDATE SET
            kode_jurusan = excluded.kode_jurusan,
            nama_jurusan = excluded.nama_jurusan,
            deskripsi = excluded.deskripsi,
            is_aktif = excluded.is_aktif;
        "#,
        params![id, kode, nama, deskripsi, is_aktif],
    )
    .map_err(|e| CommandError::new("DB_ERROR", format!("Gagal menyimpan jurusan: {e}")))?;

    let client_id = sync::ensure_client_id(state)?;
    let op = if is_new { "create" } else { "update" };
    let payload = json!({
        "id_jurusan": id,
        "kode_jurusan": kode,
        "nama_jurusan": nama,
        "deskripsi": deskripsi,
        "is_aktif": is_aktif,
    });

    sync::enqueue(
        &tx,
        &client_id,
        "academic-department",
        op,
        &id,
        &payload,
        None,
    )?;
    tx.commit().map_err(|_| CommandError::internal())?;

    Ok(json!({ "sukses": true, "id_jurusan": id }))
}

pub fn delete_academic_department(state: &DesktopState, id: &str) -> Result<Value, CommandError> {
    let mut conn = storage::database(&state.data_dir)?;
    let tx = conn.transaction().map_err(|_| CommandError::internal())?;
    ensure_academic_unused(
        &tx,
        "Jurusan",
        DEPARTMENT_USAGE,
        id,
        "Nonaktifkan jurusan ini saja.",
    )?;

    tx.execute(
        "DELETE FROM akademik_jurusan WHERE id_jurusan = ?1;",
        params![id],
    )
    .map_err(|e| CommandError::new("DB_ERROR", format!("Gagal menghapus jurusan: {e}")))?;

    let client_id = sync::ensure_client_id(state)?;
    sync::enqueue(
        &tx,
        &client_id,
        "academic-department",
        "delete",
        id,
        &json!({ "id_jurusan": id }),
        None,
    )?;
    tx.commit().map_err(|_| CommandError::internal())?;

    Ok(json!({ "sukses": true }))
}

// ── 3. Rombel (Kelas) ───────────────────────────────────────────────────────

pub fn list_academic_classes(
    state: &DesktopState,
    id_tahun_ajaran: Option<&str>,
) -> Result<Value, CommandError> {
    let conn = storage::database(&state.data_dir)?;
    let sql = r#"
        SELECT r.id_rombel, r.id_tahun_ajaran, r.tingkat, r.id_jurusan, r.nama_rombel,
               r.id_wali_kelas, r.kapasitas, r.ruang_kelas, r.is_aktif,
               j.nama_jurusan, j.kode_jurusan,
               w.nama AS nama_wali_kelas,
               (SELECT COUNT(*) FROM siswa_data s WHERE s.id_rombel = r.id_rombel AND s.status = 'Aktif') AS jumlah_siswa
        FROM akademik_rombel r
        LEFT JOIN akademik_jurusan j ON j.id_jurusan = r.id_jurusan
        LEFT JOIN master_data w ON w.id_unik = r.id_wali_kelas
        WHERE (?1 IS NULL OR r.id_tahun_ajaran = ?1)
        ORDER BY r.tingkat ASC, r.nama_rombel ASC;
    "#;

    let mut stmt = conn.prepare(sql).map_err(|_| CommandError::internal())?;
    let rows = stmt
        .query_map(params![id_tahun_ajaran], |row| {
            Ok(json!({
                "id_rombel": row.get::<_, String>(0)?,
                "id_tahun_ajaran": row.get::<_, String>(1)?,
                "tingkat": row.get::<_, i64>(2)?,
                "id_jurusan": row.get::<_, Option<String>>(3)?,
                "nama_rombel": row.get::<_, String>(4)?,
                "id_wali_kelas": row.get::<_, Option<String>>(5)?,
                "kapasitas": row.get::<_, i64>(6)?,
                "ruang_kelas": row.get::<_, Option<String>>(7)?,
                "is_aktif": row.get::<_, i64>(8)?,
                "nama_jurusan": row.get::<_, Option<String>>(9)?,
                "kode_jurusan": row.get::<_, Option<String>>(10)?,
                "nama_wali_kelas": row.get::<_, Option<String>>(11)?,
                "jumlah_siswa": row.get::<_, i64>(12)?,
            }))
        })
        .map_err(|_| CommandError::internal())?
        .filter_map(Result::ok)
        .collect::<Vec<_>>();

    Ok(json!(rows))
}

pub fn save_academic_class(state: &DesktopState, draft: &Value) -> Result<Value, CommandError> {
    let mut conn = storage::database(&state.data_dir)?;
    let tx = conn.transaction().map_err(|_| CommandError::internal())?;

    let is_new = text(draft, "id_rombel").is_empty();
    let id = if is_new {
        new_academic_id("rom_")
    } else {
        text(draft, "id_rombel").to_owned()
    };

    let id_ta = text(draft, "id_tahun_ajaran");
    let tingkat = integer(draft, "tingkat", 10);
    let id_jurusan = optional_text(draft, "id_jurusan");
    let nama_rombel = text(draft, "nama_rombel");
    let id_wali_kelas = optional_text(draft, "id_wali_kelas");
    let kapasitas = integer(draft, "kapasitas", 36);
    let ruang_kelas = optional_text(draft, "ruang_kelas");
    let is_aktif = integer(draft, "is_aktif", 1);

    if id_ta.is_empty() || nama_rombel.is_empty() {
        return Err(CommandError::new(
            "VALIDATION_ERROR",
            "Tahun ajaran dan nama rombel wajib diisi.",
        ));
    }

    tx.execute(
        r#"
        INSERT INTO akademik_rombel (
            id_rombel, id_tahun_ajaran, tingkat, id_jurusan, nama_rombel,
            id_wali_kelas, kapasitas, ruang_kelas, is_aktif
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
        ON CONFLICT(id_rombel) DO UPDATE SET
            id_tahun_ajaran = excluded.id_tahun_ajaran,
            tingkat = excluded.tingkat,
            id_jurusan = excluded.id_jurusan,
            nama_rombel = excluded.nama_rombel,
            id_wali_kelas = excluded.id_wali_kelas,
            kapasitas = excluded.kapasitas,
            ruang_kelas = excluded.ruang_kelas,
            is_aktif = excluded.is_aktif;
        "#,
        params![
            id,
            id_ta,
            tingkat,
            id_jurusan,
            nama_rombel,
            id_wali_kelas,
            kapasitas,
            ruang_kelas,
            is_aktif
        ],
    )
    .map_err(|e| CommandError::new("DB_ERROR", format!("Gagal menyimpan rombel: {e}")))?;

    let client_id = sync::ensure_client_id(state)?;
    let op = if is_new { "create" } else { "update" };
    let payload = json!({
        "id_rombel": id,
        "id_tahun_ajaran": id_ta,
        "tingkat": tingkat,
        "id_jurusan": id_jurusan,
        "nama_rombel": nama_rombel,
        "id_wali_kelas": id_wali_kelas,
        "kapasitas": kapasitas,
        "ruang_kelas": ruang_kelas,
        "is_aktif": is_aktif,
    });

    sync::enqueue(&tx, &client_id, "academic-class", op, &id, &payload, None)?;
    tx.commit().map_err(|_| CommandError::internal())?;

    Ok(json!({ "sukses": true, "id_rombel": id }))
}

pub fn delete_academic_class(state: &DesktopState, id: &str) -> Result<Value, CommandError> {
    let mut conn = storage::database(&state.data_dir)?;
    let tx = conn.transaction().map_err(|_| CommandError::internal())?;
    ensure_academic_unused(
        &tx,
        "Rombel",
        CLASS_USAGE,
        id,
        "Nonaktifkan rombel ini saja.",
    )?;

    tx.execute(
        "DELETE FROM akademik_rombel WHERE id_rombel = ?1;",
        params![id],
    )
    .map_err(|e| CommandError::new("DB_ERROR", format!("Gagal menghapus rombel: {e}")))?;

    let client_id = sync::ensure_client_id(state)?;
    sync::enqueue(
        &tx,
        &client_id,
        "academic-class",
        "delete",
        id,
        &json!({ "id_rombel": id }),
        None,
    )?;
    tx.commit().map_err(|_| CommandError::internal())?;

    Ok(json!({ "sukses": true }))
}

// ── 4. Mata Pelajaran (Mapel) ───────────────────────────────────────────────

pub fn list_academic_subjects(state: &DesktopState) -> Result<Value, CommandError> {
    let conn = storage::database(&state.data_dir)?;
    let mut stmt = conn
        .prepare(
            r#"
            SELECT id_mapel, kode_mapel, nama_mapel, tingkat, kelompok, beban_jam, kkm, is_aktif
            FROM akademik_mapel
            ORDER BY kode_mapel ASC;
            "#,
        )
        .map_err(|_| CommandError::internal())?;

    let rows = stmt
        .query_map([], |row| {
            Ok(json!({
                "id_mapel": row.get::<_, String>(0)?,
                "kode_mapel": row.get::<_, String>(1)?,
                "nama_mapel": row.get::<_, String>(2)?,
                "tingkat": row.get::<_, Option<i64>>(3)?,
                "kelompok": row.get::<_, String>(4)?,
                "beban_jam": row.get::<_, i64>(5)?,
                "kkm": row.get::<_, i64>(6)?,
                "is_aktif": row.get::<_, i64>(7)?,
            }))
        })
        .map_err(|_| CommandError::internal())?
        .filter_map(Result::ok)
        .collect::<Vec<_>>();

    Ok(json!(rows))
}

pub fn save_academic_subject(state: &DesktopState, draft: &Value) -> Result<Value, CommandError> {
    let mut conn = storage::database(&state.data_dir)?;
    let tx = conn.transaction().map_err(|_| CommandError::internal())?;

    let is_new = text(draft, "id_mapel").is_empty();
    let id = if is_new {
        new_academic_id("map_")
    } else {
        text(draft, "id_mapel").to_owned()
    };

    let kode = text(draft, "kode_mapel");
    let nama = text(draft, "nama_mapel");
    let tingkat = draft.get("tingkat").and_then(Value::as_i64);
    let kelompok = text(draft, "kelompok");
    let kelompok = if kelompok.is_empty() {
        "Wajib"
    } else {
        kelompok
    };
    let beban = integer(draft, "beban_jam", 2);
    let kkm = integer(draft, "kkm", 75);
    let is_aktif = integer(draft, "is_aktif", 1);

    if kode.is_empty() || nama.is_empty() {
        return Err(CommandError::new(
            "VALIDATION_ERROR",
            "Kode mapel dan nama mapel wajib diisi.",
        ));
    }

    assert_unique_value(
        &tx,
        "akademik_mapel",
        "kode_mapel",
        "id_mapel",
        kode,
        &id,
        "Kode mata pelajaran sudah dipakai mapel lain.",
    )?;

    tx.execute(
        r#"
        INSERT INTO akademik_mapel (
            id_mapel, kode_mapel, nama_mapel, tingkat, kelompok, beban_jam, kkm, is_aktif
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
        ON CONFLICT(id_mapel) DO UPDATE SET
            kode_mapel = excluded.kode_mapel,
            nama_mapel = excluded.nama_mapel,
            tingkat = excluded.tingkat,
            kelompok = excluded.kelompok,
            beban_jam = excluded.beban_jam,
            kkm = excluded.kkm,
            is_aktif = excluded.is_aktif;
        "#,
        params![id, kode, nama, tingkat, kelompok, beban, kkm, is_aktif],
    )
    .map_err(|e| CommandError::new("DB_ERROR", format!("Gagal menyimpan mapel: {e}")))?;

    let client_id = sync::ensure_client_id(state)?;
    let op = if is_new { "create" } else { "update" };
    let payload = json!({
        "id_mapel": id,
        "kode_mapel": kode,
        "nama_mapel": nama,
        "tingkat": tingkat,
        "kelompok": kelompok,
        "beban_jam": beban,
        "kkm": kkm,
        "is_aktif": is_aktif,
    });

    sync::enqueue(&tx, &client_id, "academic-subject", op, &id, &payload, None)?;
    tx.commit().map_err(|_| CommandError::internal())?;

    Ok(json!({ "sukses": true, "id_mapel": id }))
}

pub fn delete_academic_subject(state: &DesktopState, id: &str) -> Result<Value, CommandError> {
    let mut conn = storage::database(&state.data_dir)?;
    let tx = conn.transaction().map_err(|_| CommandError::internal())?;
    ensure_academic_unused(
        &tx,
        "Mata pelajaran",
        SUBJECT_USAGE,
        id,
        "Nonaktifkan mata pelajaran ini saja.",
    )?;

    tx.execute(
        "DELETE FROM akademik_mapel WHERE id_mapel = ?1;",
        params![id],
    )
    .map_err(|e| CommandError::new("DB_ERROR", format!("Gagal menghapus mapel: {e}")))?;

    let client_id = sync::ensure_client_id(state)?;
    sync::enqueue(
        &tx,
        &client_id,
        "academic-subject",
        "delete",
        id,
        &json!({ "id_mapel": id }),
        None,
    )?;
    tx.commit().map_err(|_| CommandError::internal())?;

    Ok(json!({ "sukses": true }))
}

// ── 5. Penugasan Guru Mapel (Akademik Guru Mapel) ───────────────────────────

pub fn list_academic_assignments(
    state: &DesktopState,
    id_rombel: Option<&str>,
) -> Result<Value, CommandError> {
    let conn = storage::database(&state.data_dir)?;
    let sql = r#"
        SELECT gm.id_penugasan, gm.id_tahun_ajaran, gm.id_rombel, gm.id_mapel, gm.id_guru,
               m.nama_mapel, m.kode_mapel, m.kelompok, m.beban_jam,
               r.nama_rombel, r.tingkat,
               g.nip, g.gelar,
               p.nama AS nama_guru
        FROM akademik_guru_mapel gm
        JOIN akademik_mapel m ON m.id_mapel = gm.id_mapel
        JOIN akademik_rombel r ON r.id_rombel = gm.id_rombel
        JOIN guru_data g ON g.id_guru = gm.id_guru
        LEFT JOIN master_data p ON p.id_unik = gm.id_guru
        WHERE (?1 IS NULL OR gm.id_rombel = ?1)
        ORDER BY r.nama_rombel ASC, m.nama_mapel ASC;
    "#;

    let mut stmt = conn.prepare(sql).map_err(|_| CommandError::internal())?;
    let rows = stmt
        .query_map(params![id_rombel], |row| {
            Ok(json!({
                "id_penugasan": row.get::<_, String>(0)?,
                "id_tahun_ajaran": row.get::<_, String>(1)?,
                "id_rombel": row.get::<_, String>(2)?,
                "id_mapel": row.get::<_, String>(3)?,
                "id_guru": row.get::<_, String>(4)?,
                "nama_mapel": row.get::<_, String>(5)?,
                "kode_mapel": row.get::<_, String>(6)?,
                "kelompok": row.get::<_, String>(7)?,
                "beban_jam": row.get::<_, i64>(8)?,
                "nama_rombel": row.get::<_, String>(9)?,
                "tingkat": row.get::<_, i64>(10)?,
                "nip": row.get::<_, Option<String>>(11)?,
                "gelar": row.get::<_, Option<String>>(12)?,
                "nama_guru": row.get::<_, Option<String>>(13)?,
            }))
        })
        .map_err(|_| CommandError::internal())?
        .filter_map(Result::ok)
        .collect::<Vec<_>>();

    Ok(json!(rows))
}

pub fn save_academic_assignment(
    state: &DesktopState,
    draft: &Value,
) -> Result<Value, CommandError> {
    let mut conn = storage::database(&state.data_dir)?;
    let tx = conn.transaction().map_err(|_| CommandError::internal())?;

    let is_new = text(draft, "id_penugasan").is_empty();
    let id = if is_new {
        new_academic_id("gm_")
    } else {
        text(draft, "id_penugasan").to_owned()
    };

    let id_ta = text(draft, "id_tahun_ajaran");
    let id_rombel = text(draft, "id_rombel");
    let id_mapel = text(draft, "id_mapel");
    let id_guru = text(draft, "id_guru");

    if id_ta.is_empty() || id_rombel.is_empty() || id_mapel.is_empty() || id_guru.is_empty() {
        return Err(CommandError::new(
            "VALIDATION_ERROR",
            "Tahun ajaran, rombel, mapel, dan guru wajib dipilih.",
        ));
    }

    // Dulu dijaga `UNIQUE (id_tahun_ajaran, id_rombel, id_mapel)`; lihat
    // `assert_unique_value` untuk alasan pemindahannya ke lapisan aplikasi.
    let sudah_ada = tx
        .prepare(
            "SELECT 1 FROM akademik_guru_mapel
             WHERE id_tahun_ajaran = ?1 AND id_rombel = ?2 AND id_mapel = ?3
               AND id_penugasan <> ?4 LIMIT 1;",
        )
        .map_err(|_| CommandError::internal())?
        .exists(params![id_ta, id_rombel, id_mapel, id])
        .map_err(|_| CommandError::internal())?;
    if sudah_ada {
        return Err(CommandError::new(
            "VALIDATION_ERROR",
            "Mata pelajaran ini sudah punya pengampu di rombel tersebut pada tahun ajaran yang sama.",
        ));
    }

    tx.execute(
        r#"
        INSERT INTO akademik_guru_mapel (id_penugasan, id_tahun_ajaran, id_rombel, id_mapel, id_guru)
        VALUES (?1, ?2, ?3, ?4, ?5)
        ON CONFLICT(id_penugasan) DO UPDATE SET
            id_tahun_ajaran = excluded.id_tahun_ajaran,
            id_rombel = excluded.id_rombel,
            id_mapel = excluded.id_mapel,
            id_guru = excluded.id_guru;
        "#,
        params![id, id_ta, id_rombel, id_mapel, id_guru],
    )
    .map_err(|e| CommandError::new("DB_ERROR", format!("Gagal menyimpan penugasan guru: {e}")))?;

    let client_id = sync::ensure_client_id(state)?;
    let payload = json!({
        "id_penugasan": id,
        "id_tahun_ajaran": id_ta,
        "id_rombel": id_rombel,
        "id_mapel": id_mapel,
        "id_guru": id_guru,
    });

    sync::enqueue(
        &tx,
        &client_id,
        "academic-assignment",
        "create",
        &id,
        &payload,
        None,
    )?;
    tx.commit().map_err(|_| CommandError::internal())?;

    Ok(json!({ "sukses": true, "id_penugasan": id }))
}

pub fn delete_academic_assignment(state: &DesktopState, id: &str) -> Result<Value, CommandError> {
    let mut conn = storage::database(&state.data_dir)?;
    let tx = conn.transaction().map_err(|_| CommandError::internal())?;

    tx.execute(
        "DELETE FROM akademik_guru_mapel WHERE id_penugasan = ?1;",
        params![id],
    )
    .map_err(|e| CommandError::new("DB_ERROR", format!("Gagal menghapus penugasan guru: {e}")))?;

    let client_id = sync::ensure_client_id(state)?;
    sync::enqueue(
        &tx,
        &client_id,
        "academic-assignment",
        "delete",
        id,
        &json!({ "id_penugasan": id }),
        None,
    )?;
    tx.commit().map_err(|_| CommandError::internal())?;

    Ok(json!({ "sukses": true }))
}

// ── 5b. Jadwal Mengajar Mingguan ────────────────────────────────────────────
//
// Tabel KETERANGAN: presensi kelas tetap bisa dicatat tanpa jadwal. Gunanya
// memberi tombol isi-cepat di layar presensi, sehingga guru tidak memilih
// ulang rombel, mapel, dan jam setiap hari.

/// Hari dari sebuah tanggal, 1=Senin sampai 7=Minggu.
///
/// Dihitung SQLite (`strftime('%w')`, 0=Minggu), bukan di Rust maupun
/// TypeScript: aritmetika tanggal yang dieja dua kali adalah cara paling mudah
/// membuat dua platform tidak sepakat tentang hari apa sebuah tanggal itu.
/// Tanggalnya selalu dikirim eksplisit oleh pemanggil, jadi tidak ada `now`
/// yang bisa terjebak selisih UTC.
const WEEKDAY_SQL: &str =
    "CASE WHEN strftime('%w', ?1) = '0' THEN 7 ELSE CAST(strftime('%w', ?1) AS INTEGER) END";

pub fn list_teaching_schedules(
    state: &DesktopState,
    filter: &Value,
) -> Result<Value, CommandError> {
    let conn = storage::database(&state.data_dir)?;

    let id_rombel = optional_text(filter, "id_rombel");
    let id_tahun_ajaran = optional_text(filter, "id_tahun_ajaran");
    let id_guru = optional_text(filter, "id_guru");
    // `tanggal` dan `hari` sama-sama opsional: layar presensi mengirim tanggal
    // (harinya diturunkan di SQL), layar penyusunan mengirim harinya langsung.
    let tanggal = optional_text(filter, "tanggal");
    let hari = filter.get("hari").and_then(Value::as_i64);

    // Tanpa LIMIT: jadwal mingguan sebesar jumlah rombel dikali jam pelajaran,
    // bukan tabel yang tumbuh setiap hari operasional.
    let sql = format!(
        r#"
        SELECT j.id_jadwal, j.id_tahun_ajaran, j.id_rombel, j.id_mapel, j.id_guru,
               j.hari, j.jam_ke, j.is_aktif, j.created_at, j.updated_at,
               COALESCE(r.nama_rombel, ''), COALESCE(m.nama_mapel, ''),
               COALESCE(p.nama, '')
        FROM jadwal_mengajar j
        LEFT JOIN akademik_rombel r ON r.id_rombel = j.id_rombel
        LEFT JOIN akademik_mapel m ON m.id_mapel = j.id_mapel
        LEFT JOIN master_data p ON p.id_unik = j.id_guru
        WHERE (?1 IS NULL OR j.id_rombel = ?1)
          AND (?2 IS NULL OR j.id_tahun_ajaran = ?2)
          AND (?3 IS NULL OR j.id_guru = ?3)
          AND (?4 IS NULL OR j.hari = ?4)
        ORDER BY j.hari, CAST(j.jam_ke AS INTEGER), j.jam_ke;
        "#
    );

    // Hari diturunkan lebih dulu supaya query utamanya tetap satu bentuk.
    let hari_terpakai = match (hari, tanggal.as_deref()) {
        (Some(nilai), _) => Some(nilai),
        (None, Some(tanggal)) => conn
            .query_row(
                &format!("SELECT {WEEKDAY_SQL};"),
                params![tanggal],
                |row| row.get::<_, i64>(0),
            )
            .optional()
            .map_err(|_| CommandError::internal())?,
        _ => None,
    };

    let mut stmt = conn.prepare(&sql).map_err(|_| CommandError::internal())?;
    let rows = stmt
        .query_map(
            params![id_rombel, id_tahun_ajaran, id_guru, hari_terpakai],
            |row| {
                Ok(json!({
                    "id_jadwal": row.get::<_, String>(0)?,
                    "id_tahun_ajaran": row.get::<_, String>(1)?,
                    "id_rombel": row.get::<_, String>(2)?,
                    "id_mapel": row.get::<_, String>(3)?,
                    "id_guru": row.get::<_, String>(4)?,
                    "hari": row.get::<_, i64>(5)?,
                    "jam_ke": row.get::<_, String>(6)?,
                    "is_aktif": row.get::<_, i64>(7)?,
                    "created_at": row.get::<_, String>(8)?,
                    "updated_at": row.get::<_, String>(9)?,
                    "nama_rombel": row.get::<_, String>(10)?,
                    "nama_mapel": row.get::<_, String>(11)?,
                    "nama_guru": row.get::<_, String>(12)?,
                }))
            },
        )
        .map_err(|_| CommandError::internal())?
        .filter_map(Result::ok)
        .collect::<Vec<_>>();

    Ok(json!(rows))
}

pub fn save_teaching_schedule(
    state: &DesktopState,
    draft: &Value,
) -> Result<Value, CommandError> {
    let id_masuk = text(draft, "id_jadwal").to_owned();
    let is_new = id_masuk.is_empty();
    let id = if is_new {
        new_academic_id("jdw")
    } else {
        id_masuk
    };

    let id_tahun_ajaran = text(draft, "id_tahun_ajaran").to_owned();
    let id_rombel = text(draft, "id_rombel").to_owned();
    let id_mapel = text(draft, "id_mapel").to_owned();
    let id_guru = text(draft, "id_guru").to_owned();
    let hari = draft.get("hari").and_then(Value::as_i64).unwrap_or(0);
    let is_aktif = if draft.get("is_aktif").and_then(Value::as_i64) == Some(0) {
        0
    } else {
        1
    };

    if id_tahun_ajaran.is_empty()
        || id_rombel.is_empty()
        || id_mapel.is_empty()
        || id_guru.is_empty()
    {
        return Err(CommandError::new(
            "VALIDATION_ERROR",
            "Tahun ajaran, rombel, mata pelajaran, dan guru wajib diisi.",
        ));
    }
    if !(1..=7).contains(&hari) {
        return Err(CommandError::new(
            "VALIDATION_ERROR",
            "Hari harus di antara 1 (Senin) dan 7 (Minggu).",
        ));
    }

    // `jam_ke` memakai validator yang SAMA dengan presensi kelas, termasuk
    // batas sekolah — jadwal yang menunjuk jam ke-9 pada sekolah berjam
    // pelajaran 8 hanya akan menghasilkan tombol isi-cepat yang ditolak saat
    // presensi disimpan.
    let jam_ke = crate::desktop::class_attendance::normalize_jam_ke_public(text(draft, "jam_ke"))?;

    let mut conn = storage::database(&state.data_dir)?;
    let tx = conn.transaction().map_err(|_| CommandError::internal())?;

    // Bentrok dinilai dengan cakupan yang SAMA seperti presensi: rombel +
    // mapel + hari, bukan seluruh rombel. Pelajaran Agama memang memecah satu
    // rombel pada jam yang sama, dan kelas gabungan memakai satu guru di dua
    // rombel sekaligus.
    let tersimpan: Vec<String> = {
        let mut stmt = tx
            .prepare(
                "SELECT jam_ke FROM jadwal_mengajar
                 WHERE id_tahun_ajaran = ?1 AND id_rombel = ?2 AND id_mapel = ?3
                   AND hari = ?4 AND is_aktif = 1 AND id_jadwal <> ?5;",
            )
            .map_err(|_| CommandError::internal())?;
        let rows = stmt
            .query_map(
                params![id_tahun_ajaran, id_rombel, id_mapel, hari, id],
                |row| row.get::<_, String>(0),
            )
            .map_err(|_| CommandError::internal())?;
        rows.filter_map(Result::ok).collect()
    };
    if is_aktif == 1 {
        if let Some(bentrok) = tersimpan
            .iter()
            .find(|lain| crate::desktop::class_attendance::jam_ke_overlaps_public(&jam_ke, lain))
        {
            return Err(CommandError::new(
                "DUPLICATE_SCHEDULE",
                format!(
                    "Jadwal mapel ini pada hari tersebut sudah memakai jam ke-{bentrok}, yang beririsan dengan jam ke-{jam_ke}."
                ),
            ));
        }
    }

    let now = sqlite_now(&tx);
    let created_at = tx
        .query_row(
            "SELECT created_at FROM jadwal_mengajar WHERE id_jadwal = ?1;",
            params![id],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|_| CommandError::internal())?
        .unwrap_or_else(|| now.clone());

    tx.execute(
        r#"
        INSERT INTO jadwal_mengajar (
            id_jadwal, id_tahun_ajaran, id_rombel, id_mapel, id_guru,
            hari, jam_ke, is_aktif, created_at, updated_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
        ON CONFLICT(id_jadwal) DO UPDATE SET
            id_tahun_ajaran = excluded.id_tahun_ajaran,
            id_rombel = excluded.id_rombel,
            id_mapel = excluded.id_mapel,
            id_guru = excluded.id_guru,
            hari = excluded.hari,
            jam_ke = excluded.jam_ke,
            is_aktif = excluded.is_aktif,
            updated_at = excluded.updated_at;
        "#,
        params![
            id,
            id_tahun_ajaran,
            id_rombel,
            id_mapel,
            id_guru,
            hari,
            jam_ke,
            is_aktif,
            created_at,
            now
        ],
    )
    .map_err(|_| CommandError::new("SAVE_FAILED", "Gagal menyimpan jadwal mengajar."))?;

    let client_id = sync::ensure_client_id(state)?;
    let op = if is_new { "create" } else { "update" };
    sync::enqueue(
        &tx,
        &client_id,
        "teaching-schedule",
        op,
        &id,
        &json!({
            "id_jadwal": id,
            "id_tahun_ajaran": id_tahun_ajaran,
            "id_rombel": id_rombel,
            "id_mapel": id_mapel,
            "id_guru": id_guru,
            "hari": hari,
            "jam_ke": jam_ke,
            "is_aktif": is_aktif,
            "created_at": created_at,
            "updated_at": now,
        }),
        None,
    )?;

    tx.commit().map_err(|_| CommandError::internal())?;
    Ok(json!({ "sukses": true, "id_jadwal": id }))
}

/// Menghapus satu baris jadwal.
///
/// Tanpa pemeriksaan "sedang dipakai": presensi yang sudah tersimpan memegang
/// rombel, mapel, guru, dan jamnya sendiri. Menghapus jadwalnya hanya
/// menghilangkan tombol isi-cepat.
pub fn delete_teaching_schedule(state: &DesktopState, id: &str) -> Result<Value, CommandError> {
    let mut conn = storage::database(&state.data_dir)?;
    let tx = conn.transaction().map_err(|_| CommandError::internal())?;

    tx.execute(
        "DELETE FROM jadwal_mengajar WHERE id_jadwal = ?1;",
        params![id],
    )
    .map_err(|_| CommandError::new("DELETE_FAILED", "Gagal menghapus jadwal mengajar."))?;

    let client_id = sync::ensure_client_id(state)?;
    sync::enqueue(
        &tx,
        &client_id,
        "teaching-schedule",
        "delete",
        id,
        &json!({ "id_jadwal": id }),
        None,
    )?;

    tx.commit().map_err(|_| CommandError::internal())?;
    Ok(json!({ "sukses": true }))
}

// ── 6. Guru (PTK) ───────────────────────────────────────────────────────────

pub fn list_teachers(state: &DesktopState) -> Result<Value, CommandError> {
    let conn = storage::database(&state.data_dir)?;
    let sql = r#"
        SELECT g.id_guru, g.nip, g.nuptk, g.gelar, g.spesialisasi_mapel, g.status_kepegawaian,
               g.created_at, g.updated_at,
               m.kode_karyawan, m.nama, m.divisi, m.jabatan_status, m.no_hp, m.lp,
               m.status_aktif, m.id_shift, m.token_absensi, m.qr_code, m.status_qr, m.unit
        FROM guru_data g
        JOIN master_data m ON m.id_unik = g.id_guru
        ORDER BY m.nama ASC;
    "#;

    let mut stmt = conn.prepare(sql).map_err(|_| CommandError::internal())?;
    let rows = stmt
        .query_map([], |row| {
            Ok(json!({
                "id_guru": row.get::<_, String>(0)?,
                "nip": row.get::<_, Option<String>>(1)?,
                "nuptk": row.get::<_, Option<String>>(2)?,
                "gelar": row.get::<_, Option<String>>(3)?,
                "spesialisasi_mapel": row.get::<_, Option<String>>(4)?,
                "status_kepegawaian": row.get::<_, Option<String>>(5)?,
                "created_at": row.get::<_, String>(6)?,
                "updated_at": row.get::<_, String>(7)?,
                "kode_karyawan": row.get::<_, Option<String>>(8)?,
                "nama": row.get::<_, String>(9)?,
                "divisi": row.get::<_, String>(10)?,
                "jabatan_status": row.get::<_, Option<String>>(11)?,
                "no_hp": row.get::<_, Option<String>>(12)?,
                "lp": row.get::<_, Option<String>>(13)?,
                "status_aktif": row.get::<_, Option<String>>(14)?,
                "id_shift": row.get::<_, i64>(15)?,
                "token_absensi": row.get::<_, Option<String>>(16)?,
                "qr_code": row.get::<_, Option<String>>(17)?,
                "status_qr": row.get::<_, Option<String>>(18)?,
                "unit": row.get::<_, Option<String>>(19)?,
            }))
        })
        .map_err(|_| CommandError::internal())?
        .filter_map(Result::ok)
        .collect::<Vec<_>>();

    Ok(json!(rows))
}

pub fn save_teacher(state: &DesktopState, draft: &Value) -> Result<Value, CommandError> {
    let mut conn = storage::database(&state.data_dir)?;
    let tx = conn.transaction().map_err(|_| CommandError::internal())?;

    let now = sqlite_now(&tx);
    let is_new = text(draft, "id_guru").is_empty();
    let id = if is_new {
        new_academic_id("ptk_")
    } else {
        text(draft, "id_guru").to_owned()
    };

    let nama = text(draft, "nama");
    let kode = text(draft, "kode_karyawan");
    let unit = text(draft, "unit");
    let nip = optional_text(draft, "nip");
    let nuptk = optional_text(draft, "nuptk");
    let gelar = optional_text(draft, "gelar");
    let spesialisasi = optional_text(draft, "spesialisasi_mapel");
    let status_peg =
        optional_text(draft, "status_kepegawaian").unwrap_or_else(|| "Honorer".to_owned());
    let no_hp = optional_text(draft, "no_hp");
    let lp = optional_text(draft, "lp").unwrap_or_else(|| "L".to_owned());
    let id_shift = chosen_shift(&tx, draft)?;
    let status_aktif = optional_text(draft, "status_aktif").unwrap_or_else(|| "Aktif".to_owned());

    if nama.is_empty() {
        return Err(CommandError::new(
            "VALIDATION_ERROR",
            "Nama guru wajib diisi.",
        ));
    }

    // Cadangannya ID UTUH, bukan irisannya. `short_suffix` dulu membuang empat
    // karakter pertama dan mengambil enam berikutnya, mengasumsikan setiap ID
    // berawalan `ptk_` buatan sistem. Begitu operator mengetik ID sendiri lewat
    // formulir atau impor Excel, irisan itu mencomot karakter acak dari tengah
    // ID-nya — itulah "kode berubah jadi gabungan angka dan huruf" yang
    // dilaporkan. `kode_karyawan` UNIQUE dan ID sudah primary key, jadi memakai
    // ID utuh sekaligus menjamin keunikan yang tidak pernah dijamin irisan.
    let kode_karyawan = if kode.is_empty() {
        nip.clone().unwrap_or_else(|| id.clone())
    } else {
        kode.to_owned()
    };

    // NIP diperiksa sendiri: bila kode personil diisi terpisah, pemeriksaan
    // kode di bawah tidak lagi menyentuh NIP, dan dua guru bisa memegang NIP
    // yang sama. Cerminan `saveTeacher` di `personnel.ts`.
    if let Some(nip) = nip.as_deref() {
        assert_unique_value(
            &tx,
            "guru_data",
            "nip",
            "id_guru",
            nip,
            &id,
            "NIP sudah dipakai guru lain.",
        )?;
    }

    // `master_data.kode_karyawan` masih UNIQUE (skema lama, tidak diubah).
    // Diperiksa lebih dulu supaya NIP yang bentrok memberi pesan yang jelas,
    // bukan galat constraint mentah dari SQLite.
    assert_unique_value(
        &tx,
        "master_data",
        "kode_karyawan",
        "id_unik",
        &kode_karyawan,
        &id,
        "Kode personil/NIP ini sudah dipakai orang lain di data induk.",
    )?;

    let client_id = sync::ensure_client_id(state)?;
    let (token, qr_code, token_is_new) = ensure_scan_token(&tx, &client_id, &id)?;

    // 1. Simpan ke master_data untuk terminal scan dan kartu nama
    tx.execute(
        r#"
        INSERT INTO master_data (
            id_unik, kode_karyawan, nama, divisi, jabatan_status, no_hp, lp,
            id_shift, status_aktif, tanggal_daftar, catatan, token_absensi, qr_code,
            status_qr, jenis_personil, unit, status_backup
        ) VALUES (?1, ?2, ?3, 'Tenaga Pengajar', 'Guru', ?4, ?5, COALESCE(?6, 1), ?7, date('now','+7 hours'), 'Data PTK Sekolah', ?8, ?9, 'Generated', 'GURU', NULLIF(?10, ''), 'NORMAL')
        ON CONFLICT(id_unik) DO UPDATE SET
            kode_karyawan = excluded.kode_karyawan,
            nama = excluded.nama,
            no_hp = excluded.no_hp,
            lp = excluded.lp,
            id_shift = COALESCE(?6, master_data.id_shift),
            status_aktif = excluded.status_aktif,
            token_absensi = excluded.token_absensi,
            qr_code = excluded.qr_code,
            status_qr = excluded.status_qr,
            jenis_personil = 'GURU',
            -- Draft tanpa `unit` (formulir lama, impor tanpa kolom unit) tidak
            -- boleh mengosongkan unit yang sudah dipilih; pola yang sama dengan
            -- `id_shift` di baris atas.
            unit = COALESCE(NULLIF(?10, ''), master_data.unit);
        "#,
        params![id, kode_karyawan, nama, no_hp, lp, id_shift, status_aktif, token, qr_code, unit],
    )
    .map_err(|e| CommandError::new("DB_ERROR", format!("Gagal menyimpan identitas personil guru: {e}")))?;

    // 2. Simpan ke guru_data
    tx.execute(
        r#"
        INSERT INTO guru_data (
            id_guru, nip, nuptk, gelar, spesialisasi_mapel, status_kepegawaian, created_at, updated_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
        ON CONFLICT(id_guru) DO UPDATE SET
            nip = excluded.nip,
            nuptk = excluded.nuptk,
            gelar = excluded.gelar,
            spesialisasi_mapel = excluded.spesialisasi_mapel,
            status_kepegawaian = excluded.status_kepegawaian,
            updated_at = excluded.updated_at;
        "#,
        params![id, nip, nuptk, gelar, spesialisasi, status_peg, now, now],
    )
    .map_err(|e| CommandError::new("DB_ERROR", format!("Gagal menyimpan profil guru: {e}")))?;

    // 3. Pastikan baris id_card ada supaya guru muncul di modul kartu identitas
    tx.execute(
        r#"
        INSERT INTO id_card (id_unik, nama, divisi, idcard_status, tanggal_generate)
        SELECT ?1, ?2, 'Tenaga Pengajar', 'Belum', date('now','+7 hours')
        WHERE NOT EXISTS (SELECT 1 FROM id_card WHERE id_unik = ?1);
        "#,
        params![id, nama],
    )
    .map_err(|e| {
        CommandError::new(
            "DB_ERROR",
            format!("Gagal memastikan baris id_card guru: {e}"),
        )
    })?;
    tx.execute(
        "UPDATE id_card SET nama = ?1, divisi = 'Tenaga Pengajar' WHERE id_unik = ?2;",
        params![nama, id],
    )
    .map_err(|e| {
        CommandError::new(
            "DB_ERROR",
            format!("Gagal memperbarui nama di id_card guru: {e}"),
        )
    })?;

    let op = if is_new { "create" } else { "update" };
    let payload = json!({
        "id_guru": id,
        "nip": nip,
        "nuptk": nuptk,
        "gelar": gelar,
        "spesialisasi_mapel": spesialisasi,
        "status_kepegawaian": status_peg,
        "created_at": now,
        "updated_at": now,
    });

    sync::enqueue(&tx, &client_id, "teacher", op, &id, &payload, None)?;
    enqueue_personnel_events(&tx, &client_id, &id, &token, &qr_code, token_is_new)?;
    tx.commit().map_err(|_| CommandError::internal())?;

    Ok(json!({ "sukses": true, "id_guru": id }))
}

pub fn delete_teacher(state: &DesktopState, id: &str) -> Result<Value, CommandError> {
    let mut conn = storage::database(&state.data_dir)?;
    let tx = conn.transaction().map_err(|_| CommandError::internal())?;

    tx.execute("DELETE FROM guru_data WHERE id_guru = ?1;", params![id])
        .map_err(|e| CommandError::new("DB_ERROR", format!("Gagal menghapus profil guru: {e}")))?;

    tx.execute(
        "UPDATE master_data SET status_aktif = 'Nonaktif' WHERE id_unik = ?1;",
        params![id],
    )
    .map_err(|_| CommandError::internal())?;

    let client_id = sync::ensure_client_id(state)?;
    // `master_data` ikut disinkronkan: tanpa event tersendiri, penonaktifan ini
    // hanya hidup di perangkat ini dan baris cloud yang masih `Aktif` akan
    // mengembalikannya pada tarikan berikutnya — orang yang sudah dihapus bisa
    // kembali diterima terminal pemindai.
    sync::enqueue_employee_snapshot(&tx, &client_id, id)?;
    sync::enqueue(
        &tx,
        &client_id,
        "teacher",
        "delete",
        id,
        &json!({ "id_guru": id }),
        None,
    )?;
    tx.commit().map_err(|_| CommandError::internal())?;

    Ok(json!({ "sukses": true }))
}

// ── 7. Siswa ────────────────────────────────────────────────────────────────

pub fn list_students(state: &DesktopState, id_rombel: Option<&str>) -> Result<Value, CommandError> {
    let conn = storage::database(&state.data_dir)?;
    let sql = r#"
        SELECT s.id_siswa, s.nis, s.nisn, s.nama_lengkap, s.jenis_kelamin, s.id_rombel,
               s.nama_wali, s.no_whatsapp_wali, s.alamat, s.angkatan, s.status,
               s.created_at, s.updated_at,
               r.nama_rombel, r.tingkat,
               m.token_absensi, m.qr_code, m.status_qr, m.id_shift, m.unit,
               m.kode_karyawan
        FROM siswa_data s
        JOIN akademik_rombel r ON r.id_rombel = s.id_rombel
        LEFT JOIN master_data m ON m.id_unik = s.id_siswa
        WHERE (?1 IS NULL OR s.id_rombel = ?1)
        ORDER BY s.nama_lengkap ASC;
    "#;

    let mut stmt = conn.prepare(sql).map_err(|_| CommandError::internal())?;
    let rows = stmt
        .query_map(params![id_rombel], |row| {
            Ok(json!({
                "id_siswa": row.get::<_, String>(0)?,
                "nis": row.get::<_, Option<String>>(1)?,
                "nisn": row.get::<_, Option<String>>(2)?,
                "nama_lengkap": row.get::<_, String>(3)?,
                "jenis_kelamin": row.get::<_, Option<String>>(4)?,
                "id_rombel": row.get::<_, String>(5)?,
                "nama_wali": row.get::<_, Option<String>>(6)?,
                "no_whatsapp_wali": row.get::<_, Option<String>>(7)?,
                "alamat": row.get::<_, Option<String>>(8)?,
                "angkatan": row.get::<_, i64>(9)?,
                "status": row.get::<_, String>(10)?,
                "created_at": row.get::<_, String>(11)?,
                "updated_at": row.get::<_, String>(12)?,
                "nama_rombel": row.get::<_, String>(13)?,
                "tingkat": row.get::<_, i64>(14)?,
                "token_absensi": row.get::<_, Option<String>>(15)?,
                "qr_code": row.get::<_, Option<String>>(16)?,
                "status_qr": row.get::<_, Option<String>>(17)?,
                "id_shift": row.get::<_, Option<i64>>(18)?,
                "unit": row.get::<_, Option<String>>(19)?,
                "kode_karyawan": row.get::<_, Option<String>>(20)?,
            }))
        })
        .map_err(|_| CommandError::internal())?
        .filter_map(Result::ok)
        .collect::<Vec<_>>();

    Ok(json!(rows))
}

pub fn save_student(state: &DesktopState, draft: &Value) -> Result<Value, CommandError> {
    let mut conn = storage::database(&state.data_dir)?;
    let tx = conn.transaction().map_err(|_| CommandError::internal())?;

    let now = sqlite_now(&tx);
    let is_new = text(draft, "id_siswa").is_empty();
    let id = if is_new {
        new_academic_id("sis_")
    } else {
        text(draft, "id_siswa").to_owned()
    };

    let nama = text(draft, "nama_lengkap");
    let unit = text(draft, "unit");
    let nis = optional_text(draft, "nis");
    let nisn = optional_text(draft, "nisn");
    let jk = optional_text(draft, "jenis_kelamin").unwrap_or_else(|| "L".to_owned());
    let id_rombel = text(draft, "id_rombel");
    let nama_wali = optional_text(draft, "nama_wali");
    // Nomor wali disimpan kanonik `+62…` lewat normalizer yang SAMA dengan
    // kontak operator — jangan menulis ulang aturannya di sini. Tanpa itu satu
    // nomor bisa tersimpan sebagai `0812…`, `62812…`, dan `+62 812-…`
    // sekaligus, dan tautan WhatsApp-nya tidak selalu terbuka.
    let wa_wali = match optional_text(draft, "no_whatsapp_wali") {
        None => None,
        Some(raw) => {
            let normalized = super::turso::normalize_operator_phone(&raw);
            if normalized.is_empty() {
                return Err(CommandError::new(
                    "VALIDATION_ERROR",
                    "Nomor WhatsApp wali tidak valid. Gunakan format 08xxxxxxxxxx atau +62xxxxxxxxxx.",
                ));
            }
            Some(normalized)
        }
    };
    let alamat = optional_text(draft, "alamat");
    let id_shift = chosen_shift(&tx, draft)?;
    let angkatan = integer(draft, "angkatan", 2026);
    let status = optional_text(draft, "status").unwrap_or_else(|| "Aktif".to_owned());

    if nama.is_empty() || id_rombel.is_empty() {
        return Err(CommandError::new(
            "VALIDATION_ERROR",
            "Nama lengkap siswa dan rombel wajib diisi.",
        ));
    }

    // Dulu dijaga `nis TEXT UNIQUE` / `nisn TEXT UNIQUE`.
    if let Some(value) = nis.as_deref() {
        assert_unique_value(
            &tx,
            "siswa_data",
            "nis",
            "id_siswa",
            value,
            &id,
            "NIS sudah dipakai siswa lain.",
        )?;
    }
    if let Some(value) = nisn.as_deref() {
        assert_unique_value(
            &tx,
            "siswa_data",
            "nisn",
            "id_siswa",
            value,
            &id,
            "NISN sudah dipakai siswa lain.",
        )?;
    }

    // Sama seperti guru: ID utuh, bukan irisannya. Lihat catatan di
    // `save_teacher`. Kode eksplisit dari formulir/impor menang lebih dulu,
    // supaya sekolah yang memakai penomoran sendiri tidak dipaksa memakai NIS.
    let kode_karyawan = optional_text(draft, "kode_karyawan")
        .or_else(|| nis.clone())
        .unwrap_or_else(|| id.clone());

    // `master_data.kode_karyawan` MASIH UNIQUE — itu skema lama yang stabil dan
    // tidak diubah di sini. Diperiksa lebih dulu supaya bentroknya muncul
    // sebagai pesan yang bisa ditindaklanjuti, bukan galat constraint mentah.
    assert_unique_value(
        &tx,
        "master_data",
        "kode_karyawan",
        "id_unik",
        &kode_karyawan,
        &id,
        "NIS ini sudah dipakai sebagai kode personil lain di data induk.",
    )?;

    let client_id = sync::ensure_client_id(state)?;
    let (token, qr_code, token_is_new) = ensure_scan_token(&tx, &client_id, &id)?;

    // 1. Simpan ke master_data untuk terminal scan dan kartu nama
    tx.execute(
        r#"
        INSERT INTO master_data (
            id_unik, kode_karyawan, nama, divisi, jabatan_status, lp,
            id_shift, status_aktif, tanggal_daftar, catatan, token_absensi, qr_code,
            status_qr, jenis_personil, unit, status_backup
        ) VALUES (?1, ?2, ?3, 'Peserta Didik', 'Siswa', ?4, COALESCE(?8, 1), ?5, date('now','+7 hours'), 'Data Siswa Sekolah', ?6, ?7, 'Generated', 'SISWA', NULLIF(?9, ''), 'NORMAL')
        ON CONFLICT(id_unik) DO UPDATE SET
            kode_karyawan = excluded.kode_karyawan,
            nama = excluded.nama,
            lp = excluded.lp,
            id_shift = COALESCE(?8, master_data.id_shift),
            status_aktif = excluded.status_aktif,
            token_absensi = excluded.token_absensi,
            qr_code = excluded.qr_code,
            status_qr = excluded.status_qr,
            jenis_personil = 'SISWA',
            -- Lihat catatan di `save_teacher`: draft tanpa `unit` tidak boleh
            -- mengosongkan unit yang sudah dipilih.
            unit = COALESCE(NULLIF(?9, ''), master_data.unit);
        "#,
        params![
            id,
            kode_karyawan,
            nama,
            jk,
            if status == "Aktif" { "Aktif" } else { "Nonaktif" },
            token,
            qr_code,
            id_shift,
            unit
        ],
    )
    .map_err(|e| CommandError::new("DB_ERROR", format!("Gagal menyimpan identitas personil siswa: {e}")))?;

    // 2. Simpan ke siswa_data
    tx.execute(
        r#"
        INSERT INTO siswa_data (
            id_siswa, nis, nisn, nama_lengkap, jenis_kelamin, id_rombel,
            nama_wali, no_whatsapp_wali, alamat, angkatan, status, created_at, updated_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)
        ON CONFLICT(id_siswa) DO UPDATE SET
            nis = excluded.nis,
            nisn = excluded.nisn,
            nama_lengkap = excluded.nama_lengkap,
            jenis_kelamin = excluded.jenis_kelamin,
            id_rombel = excluded.id_rombel,
            nama_wali = excluded.nama_wali,
            no_whatsapp_wali = excluded.no_whatsapp_wali,
            alamat = excluded.alamat,
            angkatan = excluded.angkatan,
            status = excluded.status,
            updated_at = excluded.updated_at;
        "#,
        params![
            id, nis, nisn, nama, jk, id_rombel, nama_wali, wa_wali, alamat, angkatan, status, now,
            now
        ],
    )
    .map_err(|e| CommandError::new("DB_ERROR", format!("Gagal menyimpan profil siswa: {e}")))?;

    // 3. Pastikan baris id_card ada supaya siswa muncul di modul kartu identitas
    tx.execute(
        r#"
        INSERT INTO id_card (id_unik, nama, divisi, idcard_status, tanggal_generate)
        SELECT ?1, ?2, 'Peserta Didik', 'Belum', date('now','+7 hours')
        WHERE NOT EXISTS (SELECT 1 FROM id_card WHERE id_unik = ?1);
        "#,
        params![id, nama],
    )
    .map_err(|e| {
        CommandError::new(
            "DB_ERROR",
            format!("Gagal memastikan baris id_card siswa: {e}"),
        )
    })?;
    tx.execute(
        "UPDATE id_card SET nama = ?1, divisi = 'Peserta Didik' WHERE id_unik = ?2;",
        params![nama, id],
    )
    .map_err(|e| {
        CommandError::new(
            "DB_ERROR",
            format!("Gagal memperbarui nama di id_card siswa: {e}"),
        )
    })?;

    let op = if is_new { "create" } else { "update" };
    let payload = json!({
        "id_siswa": id,
        "nis": nis,
        "nisn": nisn,
        "nama_lengkap": nama,
        "jenis_kelamin": jk,
        "id_rombel": id_rombel,
        "nama_wali": nama_wali,
        "no_whatsapp_wali": wa_wali,
        "alamat": alamat,
        "angkatan": angkatan,
        "status": status,
        "created_at": now,
        "updated_at": now,
    });

    sync::enqueue(&tx, &client_id, "student", op, &id, &payload, None)?;
    enqueue_personnel_events(&tx, &client_id, &id, &token, &qr_code, token_is_new)?;
    tx.commit().map_err(|_| CommandError::internal())?;

    Ok(json!({ "sukses": true, "id_siswa": id }))
}

pub fn delete_student(state: &DesktopState, id: &str) -> Result<Value, CommandError> {
    let mut conn = storage::database(&state.data_dir)?;
    let tx = conn.transaction().map_err(|_| CommandError::internal())?;

    tx.execute("DELETE FROM siswa_data WHERE id_siswa = ?1;", params![id])
        .map_err(|e| CommandError::new("DB_ERROR", format!("Gagal menghapus siswa: {e}")))?;

    tx.execute(
        "UPDATE master_data SET status_aktif = 'Nonaktif' WHERE id_unik = ?1;",
        params![id],
    )
    .map_err(|_| CommandError::internal())?;

    let client_id = sync::ensure_client_id(state)?;
    // `master_data` ikut disinkronkan: tanpa event tersendiri, penonaktifan ini
    // hanya hidup di perangkat ini dan baris cloud yang masih `Aktif` akan
    // mengembalikannya pada tarikan berikutnya — orang yang sudah dihapus bisa
    // kembali diterima terminal pemindai.
    sync::enqueue_employee_snapshot(&tx, &client_id, id)?;
    sync::enqueue(
        &tx,
        &client_id,
        "student",
        "delete",
        id,
        &json!({ "id_siswa": id }),
        None,
    )?;
    tx.commit().map_err(|_| CommandError::internal())?;

    Ok(json!({ "sukses": true }))
}

// ── 8. Backfill Kartu & Foto Siswa ─────────────────────────────────────────

pub fn backfill_missing_id_cards(state: &DesktopState) -> Result<Value, CommandError> {
    let mut conn = storage::database(&state.data_dir)?;
    let tx = conn.transaction().map_err(|_| CommandError::internal())?;
    let inserted = tx
        .execute(
            r#"
        INSERT INTO id_card (id_unik, nama, divisi, idcard_status, tanggal_generate)
        SELECT m.id_unik, m.nama, m.divisi, 'Belum', date('now','+7 hours')
        FROM master_data m
        WHERE m.status_aktif = 'Aktif'
          AND NOT EXISTS (SELECT 1 FROM id_card c WHERE c.id_unik = m.id_unik);
        "#,
            [],
        )
        .map_err(|e| {
            CommandError::new("DB_ERROR", format!("Gagal melakukan backfill id_card: {e}"))
        })?;
    tx.commit().map_err(|_| CommandError::internal())?;
    Ok(json!({ "sukses": true, "total_inserted": inserted }))
}

// ── Kredensial portal wali murid ────────────────────────────────────────────
//
// Seluruhnya membaca dan menulis SQLite LOKAL, lalu mendorong perubahannya
// lewat outbox — bukan memanggil cloud langsung. Itu yang membuat penerbitan
// dan reset password wali tetap bisa dilakukan tanpa jaringan pada pemasangan
// Turso maupun server sendiri, bukan hanya pada Mode Database Lokal.
//
// Pencabutan sesi wali TIDAK dikerjakan di sini. `wali_session` hidup di cloud
// saja — terminal yang sedang offline tidak memilikinya, sehingga menulisnya
// di lokal hanya akan mengenai nol baris lalu melapor sukses. Gantinya,
// handler `wali-credential/save` di `turso.rs` yang mencabut sesi begitu
// perubahan kredensialnya sampai. Hasilnya sama untuk terminal online, dan
// benar untuk yang offline: sesinya dicabut saat sinkronisasi menyusul.

/// Alfabet password sementara wali, tanpa karakter kembar-rupa (0/O, 1/I/L)
/// karena password ini dibacakan atau diketik ulang dari slip cetak. Cerminan
/// `WALI_PASSWORD_ALPHABET` di `src/lib/auth/wali-password.ts`.
const WALI_PASSWORD_ALPHABET: &[u8] = b"ABCDEFGHJKMNPQRSTUVWXYZ23456789";
/// Cerminan `WALI_PASSWORD_LENGTH` di `src/lib/auth/wali-password.ts`.
const WALI_PASSWORD_LENGTH: usize = 10;

/// Password awal/sementara wali yang acak.
///
/// Menggantikan formula lama `NISN + UNIT`, yang bisa dihitung siapa pun yang
/// memegang kartu pelajar seorang anak: wali yang belum pernah masuk bisa
/// diambil alih, dan justru penyerang yang menetapkan password barunya.
/// Database hanya memegang hash-nya, jadi nilai ini dikembalikan SEKALI.
fn password_wali_acak() -> String {
    use rand_core::{OsRng, RngCore};
    let n = WALI_PASSWORD_ALPHABET.len();
    // Byte di atas kelipatan terakhir dibuang supaya tiap karakter berpeluang sama.
    let batas = 256 - (256 % n);
    let mut hasil = String::with_capacity(WALI_PASSWORD_LENGTH);
    while hasil.len() < WALI_PASSWORD_LENGTH {
        let mut bytes = [0u8; 16];
        OsRng.fill_bytes(&mut bytes);
        for byte in bytes {
            if (byte as usize) < batas && hasil.len() < WALI_PASSWORD_LENGTH {
                hasil.push(WALI_PASSWORD_ALPHABET[byte as usize % n] as char);
            }
        }
    }
    hasil
}

/// `belum_ada` (tidak pernah diterbitkan), `bawaan` (masih password sistem),
/// atau `diubah`. Nilai yang sama dipakai UI Desktop, Mobile, dan Web.
fn wali_credential_status(has_hash: bool, changed_at: Option<&str>) -> &'static str {
    if !has_hash {
        "belum_ada"
    } else if changed_at.is_none() {
        "bawaan"
    } else {
        "diubah"
    }
}

/// Status kredensial wali satu siswa: `(ada_hash, changed_at)`.
fn baca_wali_kredensial(
    conn: &rusqlite::Connection,
    id_siswa: &str,
) -> Result<(bool, Option<String>), CommandError> {
    conn.query_row(
        r#"SELECT k.password_hash, k.changed_at
             FROM siswa_data s
             LEFT JOIN wali_kredensial k ON k.id_siswa = s.id_siswa
            WHERE s.id_siswa = ?1 LIMIT 1;"#,
        params![id_siswa],
        |row| {
            let hash: Option<String> = row.get(0)?;
            Ok((hash.is_some(), row.get(1)?))
        },
    )
    .optional()
    .map_err(|_| CommandError::internal())?
    .ok_or_else(|| CommandError::new("NOT_FOUND", "Siswa tidak ditemukan."))
}

pub fn get_wali_credential_status(
    state: &DesktopState,
    id_siswa: &str,
) -> Result<Value, CommandError> {
    let conn = storage::database(&state.data_dir)?;
    let (has_hash, changed_at) = baca_wali_kredensial(&conn, id_siswa)?;

    Ok(json!({
        "idSiswa": id_siswa,
        "status": wali_credential_status(has_hash, changed_at.as_deref()),
        "changedAt": changed_at,
    }))
}

/// Tulis kredensial sementara untuk satu siswa, di dalam transaksi pemanggil.
fn terbitkan_kredensial_wali(
    tx: &rusqlite::Transaction<'_>,
    client_id: &str,
    id_siswa: &str,
    password_hash: &str,
) -> Result<(), CommandError> {
    tx.execute(
        r#"INSERT INTO wali_kredensial (
               id_siswa, password_hash, changed_at, created_at, updated_at
           ) VALUES (?1, ?2, NULL, datetime('now'), datetime('now'))
           ON CONFLICT(id_siswa) DO UPDATE SET
               password_hash = excluded.password_hash,
               changed_at = NULL,
               updated_at = datetime('now');"#,
        params![id_siswa, password_hash],
    )
    .map_err(|e| CommandError::new("DB_ERROR", format!("Gagal menyimpan kredensial: {e}")))?;

    // `changed_at` dikirim eksplisit sebagai null: itu penanda "masih password
    // sementara" yang menahan wali di layar ganti password, dan menghilangkannya
    // dari payload akan membuat cloud mempertahankan nilai lamanya.
    sync::enqueue(
        tx,
        client_id,
        "wali-credential",
        "save",
        id_siswa,
        &json!({
            "id_siswa": id_siswa,
            "password_hash": password_hash,
            "changed_at": Value::Null,
        }),
        None,
    )?;
    Ok(())
}

pub fn reset_wali_password(
    state: &DesktopState,
    id_siswa: &str,
) -> Result<Value, CommandError> {
    let mut conn = storage::database(&state.data_dir)?;
    let tx = conn.transaction().map_err(|_| CommandError::internal())?;
    baca_wali_kredensial(&tx, id_siswa)?;

    let password = password_wali_acak();
    let password_hash = super::turso::hash_password_pbkdf2(&password);

    let client_id = sync::ensure_client_id(state)?;
    terbitkan_kredensial_wali(&tx, &client_id, id_siswa, &password_hash)?;
    tx.commit().map_err(|_| CommandError::internal())?;

    Ok(json!({ "sukses": true, "password": password }))
}

/// Daftar siswa aktif beserta identitas dan status kredensialnya.
///
/// `password` selalu `null` di sini: database hanya memegang hash-nya, jadi
/// password hanya bisa dibaca pada balasan yang baru saja menerbitkannya.
fn daftar_wali_kredensial(
    conn: &rusqlite::Connection,
    id_siswa_list: Option<&[String]>,
) -> Result<Vec<Value>, CommandError> {
    let dasar = r#"SELECT s.id_siswa, COALESCE(s.nis, ''), COALESCE(s.nisn, ''),
                          s.nama_lengkap, r.nama_rombel, COALESCE(m.unit, ''),
                          k.password_hash, k.changed_at
                     FROM siswa_data s
                     JOIN akademik_rombel r ON r.id_rombel = s.id_rombel
                     LEFT JOIN master_data m ON m.id_unik = s.id_siswa
                     LEFT JOIN wali_kredensial k ON k.id_siswa = s.id_siswa
                    WHERE s.status = 'Aktif'"#;

    let (sql, args): (String, Vec<String>) = match id_siswa_list {
        Some(list) if !list.is_empty() => {
            let placeholders = vec!["?"; list.len()].join(", ");
            (
                format!(
                    "{dasar} AND s.id_siswa IN ({placeholders}) ORDER BY r.nama_rombel, s.nama_lengkap;"
                ),
                list.to_vec(),
            )
        }
        Some(_) => return Ok(Vec::new()),
        // -- batas: dibatasi siswa berstatus Aktif di satu sekolah, bukan tabel
        // yang tumbuh tiap hari operasional; keluarannya dipakai mencetak slip
        // akun untuk seluruh siswa sekaligus sehingga memotongnya akan membuat
        // sebagian wali tidak pernah menerima kredensialnya.
        None => (
            format!("{dasar} ORDER BY r.nama_rombel, s.nama_lengkap;"),
            Vec::new(),
        ),
    };

    let mut stmt = conn.prepare(&sql).map_err(|_| CommandError::internal())?;
    let rows = stmt
        .query_map(rusqlite::params_from_iter(args.iter()), |row| {
            let nis: String = row.get(1)?;
            let nisn: String = row.get(2)?;
            let unit: String = row.get(5)?;
            let hash: Option<String> = row.get(6)?;
            let changed_at: Option<String> = row.get(7)?;
            Ok(json!({
                "idSiswa": row.get::<_, String>(0)?,
                "namaSiswa": row.get::<_, String>(3)?,
                "nis": if nis.is_empty() { Value::Null } else { json!(nis) },
                "nisn": if nisn.is_empty() { Value::Null } else { json!(nisn) },
                "rombel": row.get::<_, String>(4)?,
                "unit": if unit.trim().is_empty() {
                    Value::Null
                } else {
                    json!(unit.trim().to_uppercase())
                },
                "password": Value::Null,
                "status": wali_credential_status(hash.is_some(), changed_at.as_deref()),
            }))
        })
        .map_err(|_| CommandError::internal())?
        .filter_map(Result::ok)
        .collect::<Vec<_>>();

    Ok(rows)
}

/// Terbitkan password sementara massal.
///
/// Wali yang sudah mengganti password sendiri (`diubah`) TIDAK ikut
/// diterbitkan ulang: dialog penerbitan menjanjikan itu, dan menimpanya
/// diam-diam mengunci wali yang sudah aktif keluar dari portal. Yang
/// dikembalikan hanya baris yang baru saja diterbitkan, lengkap dengan
/// password-nya, karena setelah balasan ini password itu tidak bisa dibaca
/// lagi.
pub fn bulk_issue_wali_passwords(
    state: &DesktopState,
    id_siswa_list: Option<Vec<String>>,
) -> Result<Value, CommandError> {
    let mut conn = storage::database(&state.data_dir)?;
    let tx = conn.transaction().map_err(|_| CommandError::internal())?;
    let mut terbit: Vec<Value> = daftar_wali_kredensial(&tx, id_siswa_list.as_deref())?
        .into_iter()
        .filter(|baris| baris.get("status").and_then(Value::as_str) != Some("diubah"))
        .collect();

    if terbit.is_empty() {
        return Ok(json!({ "sukses": true, "count": 0, "credentials": [] }));
    }

    let client_id = sync::ensure_client_id(state)?;
    for baris in &mut terbit {
        let id_siswa = baris
            .get("idSiswa")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_owned();
        if id_siswa.is_empty() {
            continue;
        }
        let password = password_wali_acak();
        let hash = super::turso::hash_password_pbkdf2(&password);
        terbitkan_kredensial_wali(&tx, &client_id, &id_siswa, &hash)?;
        baris["password"] = json!(password);
        baris["status"] = json!("bawaan");
    }
    tx.commit().map_err(|_| CommandError::internal())?;

    Ok(json!({
        "sukses": true,
        "count": terbit.len(),
        "credentials": terbit,
    }))
}

pub fn get_wali_credentials_for_printing(
    state: &DesktopState,
    id_siswa_list: Option<Vec<String>>,
) -> Result<Value, CommandError> {
    let conn = storage::database(&state.data_dir)?;
    Ok(json!(daftar_wali_kredensial(
        &conn,
        id_siswa_list.as_deref()
    )?))
}

/// Validasi muatan foto personil sebelum satu byte pun menyentuh SQLite.
///
/// Dipisahkan supaya simpan dan seluruh pemanggilnya memakai aturan yang sama.
/// Nilai MIME-nya WAJIB tetap identik dengan enum di `sync-schema.ts`: baris
/// yang lolos di perangkat tetapi ditolak validator di batas sinkronisasi akan
/// macet permanen di outbox, tanpa jalan pulih dari UI.
fn validasi_foto_personil<'a>(
    foto_base64: &'a str,
    foto_mime: Option<&'a str>,
) -> Result<(&'a str, &'a str), CommandError> {
    let clean_foto = foto_base64.trim();
    if clean_foto.is_empty() {
        return Err(CommandError::new(
            "VALIDATION_ERROR",
            "Foto base64 tidak boleh kosong.",
        ));
    }
    if clean_foto.len() > MAX_PERSONNEL_PHOTO_BASE64 {
        return Err(CommandError::new(
            "VALIDATION_ERROR",
            "Ukuran foto personil melebihi batas 500 KB.",
        ));
    }
    let mime = match foto_mime.unwrap_or("image/jpeg").trim() {
        "" => "image/jpeg",
        valid @ ("image/jpeg" | "image/png" | "image/webp") => valid,
        other => {
            return Err(CommandError::new(
                "VALIDATION_ERROR",
                format!("Format foto '{other}' tidak didukung. Gunakan JPEG, PNG, atau WebP."),
            ));
        }
    };
    Ok((clean_foto, mime))
}

/// Simpan foto profil satu personil (guru, siswa, atau karyawan).
///
/// Berkunci `master_data.id_unik`, sehingga satu jalur ini melayani ketiga
/// jenis personil sekaligus dan kartu identitas — yang dirender dari baris
/// `master_data` — langsung menemukan fotonya tanpa join tambahan.
pub fn save_personnel_photo(
    state: &DesktopState,
    id_unik: &str,
    foto_base64: &str,
    foto_mime: Option<&str>,
) -> Result<Value, CommandError> {
    let clean_id = id_unik.trim();
    if clean_id.is_empty() {
        return Err(CommandError::new(
            "VALIDATION_ERROR",
            "ID personil tidak boleh kosong.",
        ));
    }
    let (clean_foto, mime) = validasi_foto_personil(foto_base64, foto_mime)?;

    let mut conn = storage::database(&state.data_dir)?;
    let tx = conn.transaction().map_err(|_| CommandError::internal())?;
    let now = sqlite_now(&tx);

    tx.execute(
        r#"
        INSERT INTO personil_foto (id_unik, foto_mime, foto_base64, updated_at)
        VALUES (?1, ?2, ?3, ?4)
        ON CONFLICT(id_unik) DO UPDATE SET
            foto_mime = excluded.foto_mime,
            foto_base64 = excluded.foto_base64,
            updated_at = excluded.updated_at;
        "#,
        params![clean_id, mime, clean_foto, now],
    )
    .map_err(|e| CommandError::new("DB_ERROR", format!("Gagal menyimpan foto personil: {e}")))?;

    // `personil_foto` di luar `SNAPSHOT_TABLES`, jadi ia tidak pernah DITARIK —
    // tetapi tetap WAJIB DIDORONG. Tanpa event ini foto berhenti di perangkat
    // yang mengunggahnya, dan kartu yang dicetak di mesin lain kosong fotonya.
    let client_id = sync::ensure_client_id(state)?;
    sync::enqueue(
        &tx,
        &client_id,
        "personnel-photo",
        "save",
        clean_id,
        &json!({
            "id_unik": clean_id,
            "foto_mime": mime,
            "foto_base64": clean_foto,
            "updated_at": now,
        }),
        None,
    )?;

    tx.commit().map_err(|_| CommandError::internal())?;
    Ok(json!({ "sukses": true, "id_unik": clean_id }))
}

/// Foto profil satu personil dari SQLite lokal.
///
/// Mengembalikan `null` bila belum ada — personil tanpa foto adalah keadaan
/// wajar, bukan kegagalan. Pemanggil yang tidak menemukannya di sini boleh
/// mencoba cloud lewat `TursoClient::get_personnel_photo`.
pub fn get_personnel_photo(state: &DesktopState, id_unik: &str) -> Result<Value, CommandError> {
    use rusqlite::OptionalExtension;
    let conn = storage::database(&state.data_dir)?;
    let mut stmt = conn
        .prepare("SELECT id_unik, foto_mime, foto_base64, updated_at FROM personil_foto WHERE id_unik = ?1 LIMIT 1;")
        .map_err(|_| CommandError::internal())?;

    let row = stmt
        .query_row(params![id_unik.trim()], |row| {
            Ok(json!({
                "id_unik": row.get::<_, String>(0)?,
                "foto_mime": row.get::<_, String>(1)?,
                "foto_base64": row.get::<_, String>(2)?,
                "updated_at": row.get::<_, String>(3)?,
            }))
        })
        .optional()
        .map_err(|_| CommandError::internal())?;

    Ok(json!(row))
}

/// Simpan foto profil personil dari cloud langsung ke SQLite lokal tanpa antrean outbox.
///
/// Dipakai saat perangkat menarik foto on-demand dari Turso Cloud: datanya sudah
/// ada di cloud, jadi mendaftarkannya ke outbox justru akan menciptakan loop
/// push mutasi yang berulang. Menyimpannya ke SQLite lokal membuat pembacaan
/// berikutnya instan (0ms) dan berfungsi offline.
pub fn cache_personnel_photo_local(state: &DesktopState, photo: &Value) -> Result<(), CommandError> {
    let id_unik = text(photo, "id_unik");
    let foto_base64 = text(photo, "foto_base64");
    if id_unik.is_empty() || foto_base64.is_empty() {
        return Ok(());
    }
    let mime = optional_text(photo, "foto_mime").unwrap_or_else(|| "image/jpeg".to_string());
    let updated_at = optional_text(photo, "updated_at").unwrap_or_default();

    let conn = storage::database(&state.data_dir)?;
    conn.execute(
        r#"
        INSERT INTO personil_foto (id_unik, foto_mime, foto_base64, updated_at)
        VALUES (?1, ?2, ?3, COALESCE(NULLIF(?4, ''), datetime('now','+7 hours')))
        ON CONFLICT(id_unik) DO UPDATE SET
            foto_mime = excluded.foto_mime,
            foto_base64 = excluded.foto_base64,
            updated_at = excluded.updated_at;
        "#,
        params![id_unik, mime, foto_base64, updated_at],
    )
    .map_err(|e| CommandError::new("DB_ERROR", format!("Gagal mencache foto personil lokal: {e}")))?;

    Ok(())
}

/// Hapus foto profil satu personil, lokal dan cloud.
///
/// Menghapus baris yang tidak ada BUKAN error: dua perangkat boleh menghapus
/// foto yang sama saat offline, dan menolak yang kedua akan memacetkan
/// outbox-nya secara permanen.
pub fn delete_personnel_photo(state: &DesktopState, id_unik: &str) -> Result<Value, CommandError> {
    let clean_id = id_unik.trim();
    if clean_id.is_empty() {
        return Err(CommandError::new(
            "VALIDATION_ERROR",
            "ID personil tidak boleh kosong.",
        ));
    }

    let mut conn = storage::database(&state.data_dir)?;
    let tx = conn.transaction().map_err(|_| CommandError::internal())?;

    tx.execute(
        "DELETE FROM personil_foto WHERE id_unik = ?1;",
        params![clean_id],
    )
    .map_err(|e| CommandError::new("DB_ERROR", format!("Gagal menghapus foto personil: {e}")))?;

    let client_id = sync::ensure_client_id(state)?;
    sync::enqueue(
        &tx,
        &client_id,
        "personnel-photo",
        "delete",
        clean_id,
        &json!({ "id_unik": clean_id }),
        None,
    )?;

    tx.commit().map_err(|_| CommandError::internal())?;
    Ok(json!({ "sukses": true, "id_unik": clean_id }))
}

/// Jenis personil sebuah foto, penentu izin yang berlaku atasnya.
///
/// Dulu setiap command foto menerima `employees.*` ATAU `students.*` ATAU
/// `teachers.*` untuk personil mana pun, sehingga admin siswa bisa mengganti
/// foto karyawan. Kini izinnya mengikuti jenis personil pemilik foto.
/// Cerminan `jenisDariLabel`/`izinKelolaFoto`/`izinLihatFoto` di
/// `src/lib/validations/personnel-photo.ts`, diuji dengan vektor yang sama.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PersonnelKind {
    Karyawan,
    Guru,
    Siswa,
}

impl PersonnelKind {
    /// `jenis_personil` tersimpan dengan ejaan berbeda-beda (`'SISWA'`,
    /// `'Siswa'`, `'Pegawai'`), jadi WAJIB dibandingkan setelah dinormalkan.
    pub fn from_label(label: &str) -> Self {
        match label.trim().to_lowercase().as_str() {
            "siswa" => Self::Siswa,
            "guru" => Self::Guru,
            _ => Self::Karyawan,
        }
    }

    /// Izin untuk menyimpan atau menghapus foto.
    pub fn manage_permission(self) -> &'static str {
        match self {
            Self::Karyawan => "employees.manage",
            Self::Guru => "teachers.manage",
            Self::Siswa => "students.manage",
        }
    }

    /// Salah satu izin ini cukup untuk MELIHAT foto. `employees.manage` ikut
    /// karena halaman kartu identitas mencetak kartu seluruh personil.
    pub fn view_permissions(self) -> [&'static str; 3] {
        match self {
            Self::Karyawan => ["employees.view", "employees.manage", "employees.manage"],
            Self::Guru => ["teachers.view", "teachers.manage", "employees.manage"],
            Self::Siswa => ["students.view", "students.manage", "employees.manage"],
        }
    }
}

/// Izin yang cukup untuk membaca STATUS "punya foto" pada daftar personil.
pub const PHOTO_STATUS_PERMISSIONS: [&str; 6] = [
    "employees.view",
    "teachers.view",
    "students.view",
    "employees.manage",
    "teachers.manage",
    "students.manage",
];

/// Jenis personil pemilik `id_unik` menurut data lokal. Baris `siswa_data` /
/// `guru_data` menjadi cadangan untuk personil lama yang `jenis_personil`-nya
/// kosong. ID yang tidak dikenal diperlakukan sebagai karyawan.
pub fn personnel_kind(state: &DesktopState, id_unik: &str) -> Result<PersonnelKind, CommandError> {
    let conn = storage::database(&state.data_dir)?;
    let label: String = conn
        .query_row(
            "SELECT CASE
                WHEN LOWER(TRIM(COALESCE(m.jenis_personil, ''))) = 'siswa'
                  OR EXISTS(SELECT 1 FROM siswa_data s WHERE s.id_siswa = ?1) THEN 'siswa'
                WHEN LOWER(TRIM(COALESCE(m.jenis_personil, ''))) = 'guru'
                  OR EXISTS(SELECT 1 FROM guru_data g WHERE g.id_guru = ?1) THEN 'guru'
                ELSE 'karyawan' END
             FROM (SELECT ?1 AS id) x LEFT JOIN master_data m ON m.id_unik = x.id;",
            params![id_unik.trim()],
            |row| row.get(0),
        )
        .map_err(|_| CommandError::internal())?;
    Ok(PersonnelKind::from_label(&label))
}

/// Sumber foto yang dipakai `desktop_get_personnel_photo`.
#[derive(Debug, PartialEq, Eq)]
pub enum PhotoSource {
    /// Salinan lokal masih sama dengan cloud, atau cloud tak terjangkau.
    Local,
    /// Cloud punya versi yang berbeda atau lokal belum punya: ambil ulang.
    Cloud,
    /// Tidak ada foto di mana pun.
    Missing,
    /// Cloud sudah tidak punya foto ini: buang salinan lokal yang basi.
    DropLocal,
}

/// Menentukan sumber foto personil.
///
/// `personil_foto` sengaja tidak ikut snapshot, jadi salinan lokal hasil cache
/// dulu tidak pernah diperiksa ulang: foto yang dihapus atau diganti dari
/// perangkat lain tetap tampil di sini selamanya. `cloud`: `None` berarti cloud
/// tak terjangkau, `Some(None)` berarti cloud tidak punya fotonya, dan
/// `Some(Some(stamp))` adalah `updated_at` foto di cloud.
///
/// Perubahan lokal yang belum terkirim selalu menang — ia yang terbaru, dan
/// membuangnya berarti menghapus kerja operator sebelum sempat didorong.
pub fn decide_photo_source(
    local_updated_at: Option<&str>,
    pending_local_change: bool,
    cloud: Option<Option<&str>>,
) -> PhotoSource {
    if pending_local_change {
        return if local_updated_at.is_some() {
            PhotoSource::Local
        } else {
            PhotoSource::Missing
        };
    }
    match cloud {
        None if local_updated_at.is_some() => PhotoSource::Local,
        None => PhotoSource::Missing,
        Some(None) if local_updated_at.is_some() => PhotoSource::DropLocal,
        Some(None) => PhotoSource::Missing,
        Some(Some(remote)) if local_updated_at == Some(remote) => PhotoSource::Local,
        Some(Some(_)) => PhotoSource::Cloud,
    }
}

/// Apakah perangkat ini punya perubahan foto yang belum terkirim untuk `id_unik`.
pub fn has_pending_photo_change(state: &DesktopState, id_unik: &str) -> Result<bool, CommandError> {
    let conn = storage::database(&state.data_dir)?;
    conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM desktop_sync_outbox WHERE domain = 'personnel-photo' AND entity_key = ?1 AND status IN ('pending', 'failed', 'conflict'));",
        params![id_unik.trim()],
        |row| row.get(0),
    )
    .map_err(|_| CommandError::internal())
}

/// Buang salinan foto hasil cache yang sudah tidak ada di cloud. Tanpa outbox:
/// cloud memang sudah tidak punya fotonya, tidak ada yang perlu didorong.
pub fn drop_personnel_photo_cache(state: &DesktopState, id_unik: &str) -> Result<(), CommandError> {
    let conn = storage::database(&state.data_dir)?;
    conn.execute(
        "DELETE FROM personil_foto WHERE id_unik = ?1;",
        params![id_unik.trim()],
    )
    .map_err(|_| CommandError::internal())?;
    Ok(())
}

/// Dari `ids`, mana yang punya foto lokal, dan mana yang punya perubahan foto
/// belum terkirim. Dibatasi `ids` yang dikirim pemanggil (maksimal 500).
pub fn local_photo_status(
    state: &DesktopState,
    ids: &[String],
) -> Result<(Vec<String>, std::collections::HashSet<String>), CommandError> {
    let conn = storage::database(&state.data_dir)?;
    let ids_json = json!(ids).to_string();
    let collect = |sql: &str| -> Result<Vec<String>, CommandError> {
        let mut statement = conn.prepare(sql).map_err(|_| CommandError::internal())?;
        let rows = statement
            .query_map(params![ids_json], |row| row.get::<_, String>(0))
            .map_err(|_| CommandError::internal())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|_| CommandError::internal())
    };
    let local = collect(
        "SELECT id_unik FROM personil_foto WHERE id_unik IN (SELECT value FROM json_each(?1)) AND TRIM(foto_base64) <> '' ORDER BY id_unik LIMIT 500;",
    )?;
    let pending = collect(
        "SELECT DISTINCT entity_key FROM desktop_sync_outbox WHERE domain = 'personnel-photo' AND status IN ('pending', 'failed', 'conflict') AND entity_key IN (SELECT value FROM json_each(?1)) ORDER BY entity_key LIMIT 500;",
    )?;
    Ok((local, pending.into_iter().collect()))
}

/// Gabungkan status foto cloud dan lokal. Untuk ID yang punya perubahan belum
/// terkirim, lokal yang benar; selebihnya cloud, kecuali cloud tak terjangkau.
pub fn merge_photo_status(
    local: &[String],
    pending: &std::collections::HashSet<String>,
    cloud: Option<&[String]>,
) -> Vec<String> {
    let Some(cloud) = cloud else {
        return local.to_vec();
    };
    let mut merged: Vec<String> = cloud
        .iter()
        .filter(|id| !pending.contains(*id))
        .cloned()
        .collect();
    merged.extend(local.iter().filter(|id| pending.contains(*id)).cloned());
    merged.sort();
    merged.dedup();
    merged
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Mutex, RwLock};

    fn fixture() -> (tempfile::TempDir, DesktopState) {
        let directory = tempfile::tempdir().expect("temporary directory");
        storage::initialize(directory.path()).expect("local schema");
        let state = DesktopState {
            server_origin: RwLock::new("http://localhost:3000".to_string()),
            offline_max_age_hours: 24,
            data_dir: directory.path().to_path_buf(),
            http: reqwest::Client::new(),
            turso_config: RwLock::new(None),
            session: Mutex::new(None),
            vault_lock: Mutex::new(()),
        };
        storage::database(&state.data_dir)
            .expect("database lokal")
            .execute_batch(
                "INSERT INTO tbl_shift (id_shift, kode_shift, nama_shift, jam_masuk, jam_pulang, jam_kerja_normal_menit)
                   VALUES (1, 1, 'Pagi', '07:00', '15:00', 420), (2, 2, 'Siswa Siang', '12:00', '17:00', 240);
                 INSERT INTO akademik_rombel (id_rombel, id_tahun_ajaran, tingkat, nama_rombel)
                   VALUES ('rom-1', 'ta-1', 10, 'X-A');",
            )
            .expect("seed shift & rombel");
        // Aplikasi menyemai identitas klien saat konfigurasi, sebelum ada
        // transaksi terbuka (`seed_client_identity`); test meniru urutan itu.
        sync::ensure_client_id(&state).expect("identitas klien");
        (directory, state)
    }

    fn shift_of(state: &DesktopState, id: &str) -> i64 {
        storage::database(&state.data_dir)
            .expect("database lokal")
            .query_row(
                "SELECT id_shift FROM master_data WHERE id_unik = ?1;",
                params![id],
                |row| row.get(0),
            )
            .expect("baris master_data")
    }

    fn kode_of(state: &DesktopState, id: &str) -> String {
        storage::database(&state.data_dir)
            .expect("database lokal")
            .query_row(
                "SELECT kode_karyawan FROM master_data WHERE id_unik = ?1;",
                params![id],
                |row| row.get(0),
            )
            .expect("baris master_data")
    }

    /// ID yang diketik operator TIDAK BOLEH diiris untuk membuat kode personil.
    /// Cadangan lama `format!("S-{}", short_suffix(&id))` membuang empat karakter
    /// pertama lalu mengambil enam berikutnya — benar hanya bila ID berawalan
    /// `sis_` buatan sistem. Begitu ID diisi sendiri lewat formulir atau impor
    /// Excel, irisan itu mencomot karakter acak dari tengahnya, dan operator
    /// melihat kode berubah menjadi gabungan angka dan huruf yang tidak ia tulis.
    #[test]
    fn kode_personil_memakai_id_utuh_bukan_irisannya() {
        let (_dir, state) = fixture();

        // Tanpa NIS dan tanpa kode: cadangannya ID UTUH.
        save_student(
            &state,
            &json!({
                "id_siswa": "SISWA-2026-0001",
                "nama_lengkap": "Siswa Tanpa NIS",
                "id_rombel": "rom-1"
            }),
        )
        .expect("siswa dengan ID manual");
        assert_eq!(kode_of(&state, "SISWA-2026-0001"), "SISWA-2026-0001");

        // Kode eksplisit menang atas NIS.
        save_student(
            &state,
            &json!({
                "id_siswa": "SISWA-2026-0002",
                "kode_karyawan": "KS-002",
                "nis": "2026002",
                "nama_lengkap": "Siswa Berkode",
                "id_rombel": "rom-1"
            }),
        )
        .expect("siswa dengan kode eksplisit");
        assert_eq!(kode_of(&state, "SISWA-2026-0002"), "KS-002");

        // Guru: NIP kosong, kode kosong -> ID utuh.
        save_teacher(
            &state,
            &json!({ "id_guru": "GURU-2026-0001", "nama": "Guru Tanpa NIP" }),
        )
        .expect("guru dengan ID manual");
        assert_eq!(kode_of(&state, "GURU-2026-0001"), "GURU-2026-0001");
    }

    /// Jam scan siswa ditentukan shift-nya. Dulu siswa SELALU ditulis ke shift 1
    /// dan formulir tidak bisa mengubahnya, sehingga setiap scan di luar jendela
    /// shift 1 ditolak tanpa jalan keluar.
    #[test]
    fn shift_siswa_bisa_dipilih_dan_dipertahankan_saat_edit() {
        let (_dir, state) = fixture();

        let dibuat = save_student(
            &state,
            &json!({ "nama_lengkap": "Siswa Siang", "id_rombel": "rom-1", "id_shift": 2 }),
        )
        .expect("siswa baru");
        let id = dibuat["id_siswa"].as_str().expect("id siswa").to_owned();
        assert_eq!(shift_of(&state, &id), 2);

        // Draft tanpa `id_shift` (formulir lama, impor tanpa kolom shift)
        // tidak boleh memindahkan siswa ke shift 1.
        save_student(
            &state,
            &json!({ "id_siswa": id, "nama_lengkap": "Siswa Siang", "id_rombel": "rom-1" }),
        )
        .expect("edit tanpa shift");
        assert_eq!(shift_of(&state, &id), 2);

        let ditolak = save_student(
            &state,
            &json!({ "nama_lengkap": "Siswa Lain", "id_rombel": "rom-1", "id_shift": 99 }),
        )
        .expect_err("shift yatim harus ditolak");
        assert_eq!(ditolak.code, "VALIDATION_ERROR");
    }

    #[test]
    fn shift_guru_dipertahankan_bila_draft_tidak_memilih() {
        let (_dir, state) = fixture();
        let dibuat = save_teacher(&state, &json!({ "nama": "Guru Siang", "id_shift": 2 }))
            .expect("guru baru");
        let id = dibuat["id_guru"].as_str().expect("id guru").to_owned();

        save_teacher(&state, &json!({ "id_guru": id, "nama": "Guru Siang" }))
            .expect("edit tanpa shift");
        assert_eq!(shift_of(&state, &id), 2);
    }

    /// Batas foto siswa WAJIB sama dengan `MAX_PERSONNEL_PHOTO_SIZE` di
    /// `sync-schema.ts`. Foto yang lolos di perangkat tetapi ditolak validator
    /// di batas sinkronisasi akan macet selamanya di outbox.
    #[test]
    fn batas_foto_siswa_sepadan_dengan_validator_sync() {
        assert_eq!(
            MAX_PERSONNEL_PHOTO_BASE64, 512_000,
            "ubah bersamaan dengan MAX_PERSONNEL_PHOTO_SIZE di sync-schema.ts"
        );
    }

    /// Vektor yang sama diuji di `personnel-photo.test.ts`.
    #[test]
    fn izin_foto_mengikuti_jenis_personil() {
        assert_eq!(PersonnelKind::from_label(" SISWA "), PersonnelKind::Siswa);
        assert_eq!(PersonnelKind::from_label("Guru"), PersonnelKind::Guru);
        assert_eq!(PersonnelKind::from_label("Pegawai"), PersonnelKind::Karyawan);
        assert_eq!(PersonnelKind::from_label(""), PersonnelKind::Karyawan);
        assert_eq!(PersonnelKind::Siswa.manage_permission(), "students.manage");
        assert_eq!(PersonnelKind::Guru.manage_permission(), "teachers.manage");
        assert_eq!(PersonnelKind::Karyawan.manage_permission(), "employees.manage");
        assert!(PersonnelKind::Siswa.view_permissions().contains(&"students.view"));
        assert!(!PersonnelKind::Siswa.view_permissions().contains(&"teachers.view"));
        assert!(PersonnelKind::Guru.view_permissions().contains(&"employees.manage"));
    }

    #[test]
    fn jenis_personil_dibaca_dari_data_lokal_dengan_cadangan_siswa_data() {
        let (_directory, state) = fixture();
        storage::database(&state.data_dir)
            .expect("database lokal")
            .execute_batch(
                "INSERT INTO master_data (id_unik, kode_karyawan, nama, divisi, id_shift, jenis_personil) VALUES
                    ('S-1', 'S-1', 'Siswa Satu', 'X-A', 1, 'SISWA'),
                    ('G-1', 'G-1', 'Guru Satu', 'Guru', 1, 'GURU'),
                    ('K-1', 'K-1', 'Karyawan Satu', 'Dapur', 1, 'Pegawai'),
                    ('S-2', 'S-2', 'Siswa Lama', 'X-A', 1, NULL);
                 INSERT INTO siswa_data (id_siswa, nama_lengkap, id_rombel, angkatan, created_at, updated_at)
                    VALUES ('S-2', 'Siswa Lama', 'rom-1', 2026, '2026-01-01', '2026-01-01');",
            )
            .expect("seed personil");

        assert_eq!(personnel_kind(&state, "S-1").expect("jenis"), PersonnelKind::Siswa);
        assert_eq!(personnel_kind(&state, "G-1").expect("jenis"), PersonnelKind::Guru);
        assert_eq!(personnel_kind(&state, "K-1").expect("jenis"), PersonnelKind::Karyawan);
        assert_eq!(personnel_kind(&state, "S-2").expect("jenis"), PersonnelKind::Siswa);
        assert_eq!(personnel_kind(&state, "TIDAK-ADA").expect("jenis"), PersonnelKind::Karyawan);
    }

    /// Alfabet dan panjangnya WAJIB sama dengan `wali-password.ts`; tes TS
    /// memeriksa string yang sama.
    #[test]
    fn password_wali_acak_memakai_alfabet_yang_sama_dengan_web() {
        assert_eq!(WALI_PASSWORD_ALPHABET, b"ABCDEFGHJKMNPQRSTUVWXYZ23456789");
        assert_eq!(WALI_PASSWORD_LENGTH, 10);
        let pertama = password_wali_acak();
        assert_eq!(pertama.len(), WALI_PASSWORD_LENGTH);
        assert!(pertama.bytes().all(|b| WALI_PASSWORD_ALPHABET.contains(&b)));
        assert_ne!(pertama, password_wali_acak());
    }

    /// Wali yang sudah mengganti password sendiri tidak boleh ikut diterbitkan
    /// ulang oleh penerbitan massal, dan password yang dikembalikan benar-benar
    /// cocok dengan hash yang disimpan.
    #[test]
    fn terbit_massal_melewati_wali_yang_sudah_mengganti_password() {
        let (_directory, state) = fixture();
        storage::database(&state.data_dir)
            .expect("database lokal")
            .execute_batch(
                "INSERT INTO siswa_data (id_siswa, nama_lengkap, id_rombel, angkatan, status, created_at, updated_at) VALUES
                    ('W-1', 'Belum Punya', 'rom-1', 2026, 'Aktif', '2026-01-01', '2026-01-01'),
                    ('W-2', 'Sudah Ganti', 'rom-1', 2026, 'Aktif', '2026-01-01', '2026-01-01');
                 INSERT INTO wali_kredensial (id_siswa, password_hash, changed_at, created_at, updated_at)
                    VALUES ('W-2', 'hash-milik-wali', '2026-09-01 08:00:00', '2026-01-01', '2026-01-01');",
            )
            .expect("seed siswa");

        let hasil = bulk_issue_wali_passwords(&state, None).expect("terbit massal");
        let credentials = hasil["credentials"].as_array().expect("daftar");
        assert_eq!(credentials.len(), 1);
        assert_eq!(credentials[0]["idSiswa"], "W-1");
        let password = credentials[0]["password"].as_str().expect("password");
        assert_eq!(password.len(), WALI_PASSWORD_LENGTH);

        let conn = storage::database(&state.data_dir).expect("database lokal");
        let hash_wali_2: String = conn
            .query_row("SELECT password_hash FROM wali_kredensial WHERE id_siswa = 'W-2';", [], |row| row.get(0))
            .expect("kredensial W-2");
        assert_eq!(hash_wali_2, "hash-milik-wali");
        let hash_wali_1: String = conn
            .query_row("SELECT password_hash FROM wali_kredensial WHERE id_siswa = 'W-1';", [], |row| row.get(0))
            .expect("kredensial W-1");
        assert!(super::super::turso::verify_password(password, &hash_wali_1));
    }

    /// Salinan lokal hasil cache dulu tidak pernah diperiksa ulang: foto yang
    /// dihapus atau diganti dari perangkat lain tetap tampil selamanya.
    #[test]
    fn sumber_foto_mengikuti_cloud_kecuali_ada_perubahan_lokal() {
        let t = "2026-09-23 10:00:00";
        // Dihapus di perangkat lain: salinan lokal dibuang.
        assert_eq!(decide_photo_source(Some(t), false, Some(None)), PhotoSource::DropLocal);
        // Diganti di perangkat lain: ambil ulang.
        assert_eq!(
            decide_photo_source(Some(t), false, Some(Some("2026-09-23 11:00:00"))),
            PhotoSource::Cloud
        );
        assert_eq!(decide_photo_source(Some(t), false, Some(Some(t))), PhotoSource::Local);
        // Diunggah di perangkat lain dan belum ada di sini.
        assert_eq!(decide_photo_source(None, false, Some(Some(t))), PhotoSource::Cloud);
        assert_eq!(decide_photo_source(None, false, Some(None)), PhotoSource::Missing);
        // Offline: salinan lokal tetap dipakai.
        assert_eq!(decide_photo_source(Some(t), false, None), PhotoSource::Local);
        assert_eq!(decide_photo_source(None, false, None), PhotoSource::Missing);
        // Perubahan lokal yang belum terkirim selalu menang.
        assert_eq!(decide_photo_source(Some(t), true, Some(None)), PhotoSource::Local);
        assert_eq!(decide_photo_source(None, true, Some(Some(t))), PhotoSource::Missing);
    }

    #[test]
    fn status_foto_menggabungkan_cloud_dengan_perubahan_lokal_yang_belum_terkirim() {
        let (_directory, state) = fixture();
        save_personnel_photo(&state, "K-1", "AAAA", Some("image/jpeg")).expect("foto lokal");
        storage::database(&state.data_dir)
            .expect("database lokal")
            .execute(
                "INSERT INTO personil_foto (id_unik, foto_mime, foto_base64, updated_at) VALUES ('K-9', 'image/jpeg', 'BBBB', '2026-01-01');",
                [],
            )
            .expect("cache lama");
        let ids = vec!["K-1".to_owned(), "K-2".to_owned(), "K-9".to_owned()];

        let (local, pending) = local_photo_status(&state, &ids).expect("status lokal");
        assert_eq!(local, vec!["K-1".to_owned(), "K-9".to_owned()]);
        assert!(pending.contains("K-1") && !pending.contains("K-9"));

        // Cloud: K-2 punya foto, K-9 sudah dihapus di perangkat lain, K-1 belum terkirim.
        let cloud = vec!["K-2".to_owned()];
        assert_eq!(
            merge_photo_status(&local, &pending, Some(&cloud)),
            vec!["K-1".to_owned(), "K-2".to_owned()]
        );
        // Offline: salinan lokal apa adanya.
        assert_eq!(merge_photo_status(&local, &pending, None), local);
    }
}
