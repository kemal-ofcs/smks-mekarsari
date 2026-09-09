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

fn new_journal_id() -> String {
    let mut bytes = [0u8; 16];
    rand_core::RngCore::fill_bytes(&mut rand_core::OsRng, &mut bytes);
    let mut id = String::with_capacity(4 + 32);
    id.push_str("jrn_");
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

pub fn get_teaching_journal(
    state: &DesktopState,
    id_presensi_mapel: &str,
) -> Result<Value, CommandError> {
    let conn = storage::database(&state.data_dir)?;
    let mut stmt = conn
        .prepare(
            r#"
            SELECT j.id_jurnal, j.id_presensi_mapel, j.materi_disampaikan, j.kendala,
                   j.tindak_lanjut, j.paraf_nama, j.paraf_operator, j.paraf_at,
                   j.created_at, j.updated_at,
                   p.tanggal, p.jam_ke, p.materi_pokok,
                   m.nama_mapel, r.nama_rombel, g.nama as nama_guru
            FROM jurnal_mengajar j
            JOIN presensi_mapel p ON p.id_presensi_mapel = j.id_presensi_mapel
            LEFT JOIN akademik_mapel m ON m.id_mapel = p.id_mapel
            LEFT JOIN akademik_rombel r ON r.id_rombel = p.id_rombel
            LEFT JOIN master_data g ON g.id_unik = p.id_guru
            WHERE j.id_presensi_mapel = ?1
            LIMIT 1;
            "#,
        )
        .map_err(|_| CommandError::internal())?;

    let row = stmt
        .query_row(params![id_presensi_mapel], |row| {
            Ok(json!({
                "id_jurnal": row.get::<_, String>(0)?,
                "id_presensi_mapel": row.get::<_, String>(1)?,
                "materi_disampaikan": row.get::<_, Option<String>>(2)?,
                "kendala": row.get::<_, Option<String>>(3)?,
                "tindak_lanjut": row.get::<_, Option<String>>(4)?,
                "paraf_nama": row.get::<_, Option<String>>(5)?,
                "paraf_operator": row.get::<_, String>(6)?,
                "paraf_at": row.get::<_, String>(7)?,
                "created_at": row.get::<_, String>(8)?,
                "updated_at": row.get::<_, String>(9)?,
                "tanggal": row.get::<_, Option<String>>(10)?,
                "jam_ke": row.get::<_, Option<String>>(11)?,
                "materi_pokok": row.get::<_, Option<String>>(12)?,
                "nama_mapel": row.get::<_, Option<String>>(13)?,
                "nama_rombel": row.get::<_, Option<String>>(14)?,
                "nama_guru": row.get::<_, Option<String>>(15)?,
            }))
        })
        .optional()
        .map_err(|_| CommandError::internal())?;

    Ok(json!(row))
}

pub fn list_teaching_journals(
    state: &DesktopState,
    id_rombel: Option<&str>,
    id_mapel: Option<&str>,
    id_guru: Option<&str>,
    tanggal_mulai: Option<&str>,
    tanggal_selesai: Option<&str>,
    limit: Option<i64>,
) -> Result<Value, CommandError> {
    let conn = storage::database(&state.data_dir)?;
    // Setiap filter opsional, sehingga pemanggilan tanpa filter berarti seluruh
    // jurnal mengajar yang pernah dicatat. Batasnya dijepit sama seperti di
    // `teaching-journal.ts`, supaya Web dan Desktop menjawab hal yang sama.
    let max_rows = limit.unwrap_or(1000).clamp(1, 1000);
    let sql = r#"
        SELECT j.id_jurnal, j.id_presensi_mapel, j.materi_disampaikan, j.kendala,
               j.tindak_lanjut, j.paraf_nama, j.paraf_operator, j.paraf_at,
               j.created_at, j.updated_at,
               p.tanggal, p.jam_ke, p.materi_pokok, p.id_rombel, p.id_mapel, p.id_guru,
               m.nama_mapel, r.nama_rombel, g.nama as nama_guru
        FROM jurnal_mengajar j
        JOIN presensi_mapel p ON p.id_presensi_mapel = j.id_presensi_mapel
        LEFT JOIN akademik_mapel m ON m.id_mapel = p.id_mapel
        LEFT JOIN akademik_rombel r ON r.id_rombel = p.id_rombel
        LEFT JOIN master_data g ON g.id_unik = p.id_guru
        WHERE (?1 IS NULL OR p.id_rombel = ?1)
          AND (?2 IS NULL OR p.id_mapel = ?2)
          AND (?3 IS NULL OR p.id_guru = ?3)
          AND (?4 IS NULL OR p.tanggal >= ?4)
          AND (?5 IS NULL OR p.tanggal <= ?5)
        ORDER BY p.tanggal DESC, CAST(p.jam_ke AS INTEGER) DESC
        LIMIT ?6;
    "#;

    let mut stmt = conn.prepare(sql).map_err(|_| CommandError::internal())?;
    let rows = stmt
        .query_map(
            params![
                id_rombel,
                id_mapel,
                id_guru,
                tanggal_mulai,
                tanggal_selesai,
                max_rows
            ],
            |row| {
                Ok(json!({
                    "id_jurnal": row.get::<_, String>(0)?,
                    "id_presensi_mapel": row.get::<_, String>(1)?,
                    "materi_disampaikan": row.get::<_, Option<String>>(2)?,
                    "kendala": row.get::<_, Option<String>>(3)?,
                    "tindak_lanjut": row.get::<_, Option<String>>(4)?,
                    "paraf_nama": row.get::<_, Option<String>>(5)?,
                    "paraf_operator": row.get::<_, String>(6)?,
                    "paraf_at": row.get::<_, String>(7)?,
                    "created_at": row.get::<_, String>(8)?,
                    "updated_at": row.get::<_, String>(9)?,
                    "tanggal": row.get::<_, Option<String>>(10)?,
                    "jam_ke": row.get::<_, Option<String>>(11)?,
                    "materi_pokok": row.get::<_, Option<String>>(12)?,
                    "id_rombel": row.get::<_, Option<String>>(13)?,
                    "id_mapel": row.get::<_, Option<String>>(14)?,
                    "id_guru": row.get::<_, Option<String>>(15)?,
                    "nama_mapel": row.get::<_, Option<String>>(16)?,
                    "nama_rombel": row.get::<_, Option<String>>(17)?,
                    "nama_guru": row.get::<_, Option<String>>(18)?,
                }))
            },
        )
        .map_err(|_| CommandError::internal())?
        .filter_map(Result::ok)
        .collect::<Vec<_>>();

    Ok(json!(rows))
}

pub fn save_teaching_journal(
    state: &DesktopState,
    session_operator: &str,
    draft: &Value,
) -> Result<Value, CommandError> {
    let client_id = sync::ensure_client_id(state)?;
    let mut conn = storage::database(&state.data_dir)?;
    let tx = conn.transaction().map_err(|_| CommandError::internal())?;

    let now = sqlite_now(&tx);
    let id_presensi_mapel = text(draft, "id_presensi_mapel");
    if id_presensi_mapel.is_empty() {
        return Err(CommandError::new(
            "VALIDATION_ERROR",
            "Tautan sesi presensi mapel (id_presensi_mapel) wajib diisi.",
        ));
    }

    let session_exists = tx
        .prepare("SELECT 1 FROM presensi_mapel WHERE id_presensi_mapel = ?1 LIMIT 1;")
        .map_err(|_| CommandError::internal())?
        .exists(params![id_presensi_mapel])
        .map_err(|_| CommandError::internal())?;

    if !session_exists {
        return Err(CommandError::new(
            "NOT_FOUND",
            "Sesi presensi pelajaran tidak ditemukan.",
        ));
    }

    let existing_id: Option<String> = tx
        .query_row(
            "SELECT id_jurnal FROM jurnal_mengajar WHERE id_presensi_mapel = ?1 LIMIT 1;",
            params![id_presensi_mapel],
            |row| row.get(0),
        )
        .optional()
        .map_err(|_| CommandError::internal())?;

    let draft_id = text(draft, "id_jurnal");
    let id = match (draft_id.is_empty(), existing_id) {
        (false, _) => draft_id.to_owned(),
        (true, Some(existing)) => existing,
        (true, None) => new_journal_id(),
    };

    let materi = optional_text(draft, "materi_disampaikan");
    let kendala = optional_text(draft, "kendala");
    let tindak_lanjut = optional_text(draft, "tindak_lanjut");
    let paraf_nama = optional_text(draft, "paraf_nama");
    let paraf_operator = session_operator.trim();
    if paraf_operator.is_empty() {
        return Err(CommandError::new(
            "UNAUTHORIZED",
            "Sesi operator tidak valid untuk memaraf jurnal.",
        ));
    }
    let paraf_at = now.clone();

    tx.execute(
        r#"
        INSERT INTO jurnal_mengajar (
            id_jurnal, id_presensi_mapel, materi_disampaikan, kendala, tindak_lanjut,
            paraf_nama, paraf_operator, paraf_at, created_at, updated_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
        ON CONFLICT(id_jurnal) DO UPDATE SET
            id_presensi_mapel = excluded.id_presensi_mapel,
            materi_disampaikan = excluded.materi_disampaikan,
            kendala = excluded.kendala,
            tindak_lanjut = excluded.tindak_lanjut,
            paraf_nama = excluded.paraf_nama,
            paraf_operator = excluded.paraf_operator,
            paraf_at = excluded.paraf_at,
            updated_at = excluded.updated_at;
        "#,
        params![
            id,
            id_presensi_mapel,
            materi,
            kendala,
            tindak_lanjut,
            paraf_nama,
            paraf_operator,
            paraf_at,
            now,
            now
        ],
    )
    .map_err(|e| CommandError::new("DB_ERROR", format!("Gagal menyimpan jurnal mengajar: {e}")))?;

    let payload = json!({
        "id_jurnal": id,
        "id_presensi_mapel": id_presensi_mapel,
        "materi_disampaikan": materi,
        "kendala": kendala,
        "tindak_lanjut": tindak_lanjut,
        "paraf_nama": paraf_nama,
        "paraf_operator": paraf_operator,
        "paraf_at": paraf_at,
        "created_at": now,
        "updated_at": now,
    });

    sync::enqueue(
        &tx,
        &client_id,
        "teaching-journal",
        "save",
        &id,
        &payload,
        None,
    )?;
    tx.commit().map_err(|_| CommandError::internal())?;

    Ok(json!({ "sukses": true, "id_jurnal": id }))
}

pub fn delete_teaching_journal(
    state: &DesktopState,
    id_jurnal: &str,
) -> Result<Value, CommandError> {
    let client_id = sync::ensure_client_id(state)?;
    let mut conn = storage::database(&state.data_dir)?;
    let tx = conn.transaction().map_err(|_| CommandError::internal())?;

    let exists = tx
        .prepare("SELECT 1 FROM jurnal_mengajar WHERE id_jurnal = ?1 LIMIT 1;")
        .map_err(|_| CommandError::internal())?
        .exists(params![id_jurnal])
        .map_err(|_| CommandError::internal())?;

    if !exists {
        return Err(CommandError::new(
            "NOT_FOUND",
            "Jurnal mengajar tidak ditemukan.",
        ));
    }

    tx.execute(
        "DELETE FROM jurnal_mengajar WHERE id_jurnal = ?1;",
        params![id_jurnal],
    )
    .map_err(|e| CommandError::new("DB_ERROR", format!("Gagal menghapus jurnal mengajar: {e}")))?;

    sync::enqueue(
        &tx,
        &client_id,
        "teaching-journal",
        "delete",
        id_jurnal,
        &json!({ "id_jurnal": id_jurnal }),
        None,
    )?;
    tx.commit().map_err(|_| CommandError::internal())?;

    Ok(json!({ "sukses": true }))
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
        let conn = storage::database(&state.data_dir).expect("init db");

        conn.execute_batch(
            r#"
            INSERT INTO akademik_tahun_ajaran (
                id_tahun_ajaran, nama_tahun, semester, tanggal_mulai, tanggal_selesai, is_aktif, created_at, updated_at
            ) VALUES ('ta_2026_ganjil', '2026/2027', 'Ganjil', '2026-07-01', '2026-12-31', 1, '2026-07-01', '2026-07-01');

            INSERT INTO akademik_rombel (
                id_rombel, id_tahun_ajaran, tingkat, nama_rombel, kapasitas, is_aktif
            ) VALUES ('rombel_10a', 'ta_2026_ganjil', 10, 'X-A', 36, 1);

            INSERT INTO akademik_mapel (
                id_mapel, kode_mapel, nama_mapel, beban_jam, kkm, is_aktif
            ) VALUES ('mapel_mtk', 'MTK', 'Matematika', 4, 75, 1);

            INSERT INTO master_data (
                id_unik, kode_karyawan, nama, divisi, status_aktif, tanggal_daftar, id_shift
            ) VALUES ('guru_01', 'G-01', 'Budi Santoso', 'Tenaga Pengajar', 'Aktif', '2026-01-01', 1);

            INSERT INTO presensi_mapel (
                id_presensi_mapel, id_tahun_ajaran, id_rombel, id_mapel, id_guru,
                tanggal, jam_ke, materi_pokok, total_hadir, total_izin,
                total_sakit, total_alfa, total_dispensasi, created_at, updated_at
            ) VALUES (
                'sesi_01', 'ta_2026_ganjil', 'rombel_10a', 'mapel_mtk', 'guru_01',
                '2026-09-07', '1-2', 'Aljabar Linear', 35, 1, 0, 0, 0, '2026-09-07 08:00:00', '2026-09-07 09:30:00'
            );
            "#,
        )
        .expect("seed test data");

        (dir, state)
    }

    #[test]
    fn test_teaching_journal_lifecycle() {
        let (_dir, state) = setup_test_state();

        let initial = get_teaching_journal(&state, "sesi_01").expect("get journal");
        assert!(initial.is_null());

        let draft = json!({
            "id_presensi_mapel": "sesi_01",
            "materi_disampaikan": "Membahas eliminasi Gauss",
            "kendala": "Proyektor mati di 15 menit pertama",
            "tindak_lanjut": "Latihan mandiri halaman 45",
            "paraf_nama": "Budi Santoso",
        });

        let save_res = save_teaching_journal(&state, "guru_budi", &draft).expect("save journal");
        assert_eq!(save_res["sukses"], true);
        let id_jurnal = save_res["id_jurnal"].as_str().expect("id_jurnal string");

        let saved = get_teaching_journal(&state, "sesi_01").expect("get saved journal");
        assert_eq!(saved["id_jurnal"], id_jurnal);
        assert_eq!(saved["paraf_operator"], "guru_budi");
        assert_eq!(saved["materi_disampaikan"], "Membahas eliminasi Gauss");
        assert_eq!(saved["nama_mapel"], "Matematika");
        assert_eq!(saved["nama_rombel"], "X-A");

        let list = list_teaching_journals(&state, Some("rombel_10a"), None, None, None, None, None)
            .expect("list journals");
        assert_eq!(list.as_array().expect("array").len(), 1);

        let del_res = delete_teaching_journal(&state, id_jurnal).expect("delete journal");
        assert_eq!(del_res["sukses"], true);

        let after_del = get_teaching_journal(&state, "sesi_01").expect("get journal after delete");
        assert!(after_del.is_null());
    }
}
