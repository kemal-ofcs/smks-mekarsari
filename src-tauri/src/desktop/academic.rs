use rusqlite::params;
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
fn short_suffix(id: &str) -> String {
    id.chars().skip(4).take(6).collect()
}

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

/// Batas foto profil siswa dalam karakter base64 (±500 KB).
///
/// Angkanya WAJIB sama dengan `MAX_STUDENT_PHOTO_SIZE` di `sync-schema.ts`.
/// Alasannya sama dengan `MAX_SCAN_PHOTO_BASE64`: foto yang lolos di perangkat
/// tetapi ditolak validator di batas sinkronisasi akan macet selamanya di outbox
/// tanpa pernah bisa berhasil. Diberi nama supaya kedua sisi tidak bisa bergeser
/// diam-diam.
pub const MAX_STUDENT_PHOTO_BASE64: usize = 512_000;

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

pub fn delete_academic_year(state: &DesktopState, id: &str) -> Result<Value, CommandError> {
    let mut conn = storage::database(&state.data_dir)?;
    let tx = conn.transaction().map_err(|_| CommandError::internal())?;

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

// ── 6. Guru (PTK) ───────────────────────────────────────────────────────────

pub fn list_teachers(state: &DesktopState) -> Result<Value, CommandError> {
    let conn = storage::database(&state.data_dir)?;
    let sql = r#"
        SELECT g.id_guru, g.nip, g.nuptk, g.gelar, g.spesialisasi_mapel, g.status_kepegawaian,
               g.created_at, g.updated_at,
               m.kode_karyawan, m.nama, m.divisi, m.jabatan_status, m.no_hp, m.lp,
               m.status_aktif, m.id_shift, m.token_absensi, m.qr_code, m.status_qr
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
    let nip = optional_text(draft, "nip");
    let nuptk = optional_text(draft, "nuptk");
    let gelar = optional_text(draft, "gelar");
    let spesialisasi = optional_text(draft, "spesialisasi_mapel");
    let status_peg =
        optional_text(draft, "status_kepegawaian").unwrap_or_else(|| "Honorer".to_owned());
    let no_hp = optional_text(draft, "no_hp");
    let lp = optional_text(draft, "lp").unwrap_or_else(|| "L".to_owned());
    let id_shift = integer(draft, "id_shift", 1);
    let status_aktif = optional_text(draft, "status_aktif").unwrap_or_else(|| "Aktif".to_owned());

    if nama.is_empty() {
        return Err(CommandError::new(
            "VALIDATION_ERROR",
            "Nama guru wajib diisi.",
        ));
    }

    let kode_karyawan = if kode.is_empty() {
        nip.clone()
            .unwrap_or_else(|| format!("G-{}", short_suffix(&id)))
    } else {
        kode.to_owned()
    };

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
            status_qr, jenis_personil, status_backup
        ) VALUES (?1, ?2, ?3, 'Tenaga Pengajar', 'Guru', ?4, ?5, ?6, ?7, date('now','+7 hours'), 'Data PTK Sekolah', ?8, ?9, 'Generated', 'GURU', 'NORMAL')
        ON CONFLICT(id_unik) DO UPDATE SET
            kode_karyawan = excluded.kode_karyawan,
            nama = excluded.nama,
            no_hp = excluded.no_hp,
            lp = excluded.lp,
            id_shift = excluded.id_shift,
            status_aktif = excluded.status_aktif,
            token_absensi = excluded.token_absensi,
            qr_code = excluded.qr_code,
            status_qr = excluded.status_qr,
            jenis_personil = 'GURU';
        "#,
        params![id, kode_karyawan, nama, no_hp, lp, id_shift, status_aktif, token, qr_code],
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
               m.token_absensi, m.qr_code, m.status_qr
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

    let kode_karyawan = nis
        .clone()
        .unwrap_or_else(|| format!("S-{}", short_suffix(&id)));

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
            status_qr, jenis_personil, status_backup
        ) VALUES (?1, ?2, ?3, 'Peserta Didik', 'Siswa', ?4, 1, ?5, date('now','+7 hours'), 'Data Siswa Sekolah', ?6, ?7, 'Generated', 'SISWA', 'NORMAL')
        ON CONFLICT(id_unik) DO UPDATE SET
            kode_karyawan = excluded.kode_karyawan,
            nama = excluded.nama,
            lp = excluded.lp,
            status_aktif = excluded.status_aktif,
            token_absensi = excluded.token_absensi,
            qr_code = excluded.qr_code,
            status_qr = excluded.status_qr,
            jenis_personil = 'SISWA';
        "#,
        params![
            id,
            kode_karyawan,
            nama,
            jk,
            if status == "Aktif" { "Aktif" } else { "Nonaktif" },
            token,
            qr_code
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

pub fn save_student_photo(
    state: &DesktopState,
    id_siswa: &str,
    foto_base64: &str,
    foto_mime: Option<&str>,
) -> Result<Value, CommandError> {
    let clean_id = id_siswa.trim();
    if clean_id.is_empty() {
        return Err(CommandError::new(
            "VALIDATION_ERROR",
            "ID Siswa tidak boleh kosong.",
        ));
    }
    let clean_foto = foto_base64.trim();
    if clean_foto.is_empty() {
        return Err(CommandError::new(
            "VALIDATION_ERROR",
            "Foto base64 tidak boleh kosong.",
        ));
    }
    if clean_foto.len() > MAX_STUDENT_PHOTO_BASE64 {
        return Err(CommandError::new(
            "VALIDATION_ERROR",
            "Ukuran foto siswa melebihi batas 500 KB.",
        ));
    }
    // Ketiga nilai ini WAJIB sama dengan enum `foto_mime` di `sync-schema.ts`.
    // Menerima mime lain di sini berarti barisnya tersimpan mulus di perangkat
    // lalu ditolak validator di batas sinkronisasi — event-nya macet permanen
    // di outbox tanpa pernah bisa berhasil.
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

    let mut conn = storage::database(&state.data_dir)?;
    let tx = conn.transaction().map_err(|_| CommandError::internal())?;
    let now = sqlite_now(&tx);

    tx.execute(
        r#"
        INSERT INTO siswa_foto (id_siswa, foto_mime, foto_base64, updated_at)
        VALUES (?1, ?2, ?3, ?4)
        ON CONFLICT(id_siswa) DO UPDATE SET
            foto_mime = excluded.foto_mime,
            foto_base64 = excluded.foto_base64,
            updated_at = excluded.updated_at;
        "#,
        params![clean_id, mime, clean_foto, now],
    )
    .map_err(|e| CommandError::new("DB_ERROR", format!("Gagal menyimpan foto siswa: {e}")))?;

    // Salinan lokal saja TIDAK CUKUP. `siswa_foto` berada di luar
    // `SNAPSHOT_TABLES` — itu benar, karena foto tidak boleh membengkakkan tiap
    // siklus pull — tetapi "di luar snapshot" hanya berarti tidak ikut DITARIK.
    // Tanpa event outbox ini, foto berhenti di perangkat yang memotretnya:
    // cloud tidak pernah menerimanya, perangkat lain tidak pernah melihatnya,
    // dan kartu pelajar yang dicetak di tempat lain kehilangan fotonya. Sama
    // seperti `absensi_foto` yang menumpang event `attendance/scan`.
    let client_id = sync::ensure_client_id(state)?;
    sync::enqueue(
        &tx,
        &client_id,
        "student-photo",
        "save",
        clean_id,
        &json!({
            "id_siswa": clean_id,
            "foto_mime": mime,
            "foto_base64": clean_foto,
            "updated_at": now,
        }),
        None,
    )?;

    tx.commit().map_err(|_| CommandError::internal())?;
    Ok(json!({ "sukses": true, "id_siswa": clean_id }))
}

pub fn get_student_photo(state: &DesktopState, id_siswa: &str) -> Result<Value, CommandError> {
    use rusqlite::OptionalExtension;
    let conn = storage::database(&state.data_dir)?;
    let mut stmt = conn
        .prepare("SELECT id_siswa, foto_mime, foto_base64, updated_at FROM siswa_foto WHERE id_siswa = ?1 LIMIT 1;")
        .map_err(|_| CommandError::internal())?;

    let row = stmt
        .query_row(params![id_siswa], |row| {
            Ok(json!({
                "id_siswa": row.get::<_, String>(0)?,
                "foto_mime": row.get::<_, String>(1)?,
                "foto_base64": row.get::<_, String>(2)?,
                "updated_at": row.get::<_, String>(3)?,
            }))
        })
        .optional()
        .map_err(|_| CommandError::internal())?;

    Ok(json!(row))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Batas foto siswa WAJIB sama dengan `MAX_STUDENT_PHOTO_SIZE` di
    /// `sync-schema.ts`. Foto yang lolos di perangkat tetapi ditolak validator
    /// di batas sinkronisasi akan macet selamanya di outbox.
    #[test]
    fn batas_foto_siswa_sepadan_dengan_validator_sync() {
        assert_eq!(
            MAX_STUDENT_PHOTO_BASE64, 512_000,
            "ubah bersamaan dengan MAX_STUDENT_PHOTO_SIZE di sync-schema.ts"
        );
    }
}
