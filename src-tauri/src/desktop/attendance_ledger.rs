use rusqlite::{params, OptionalExtension};
use serde_json::{json, Value};

use super::{config::DesktopState, models::CommandError, storage, sync};

fn text<'a>(value: &'a Value, key: &str) -> &'a str {
    value.get(key).and_then(Value::as_str).unwrap_or("").trim()
}

fn _optional_text(value: &Value, key: &str) -> Option<String> {
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

fn float(value: &Value, key: &str, fallback: f64) -> f64 {
    value.get(key).and_then(Value::as_f64).unwrap_or(fallback)
}

fn new_ledger_id() -> String {
    let mut bytes = [0u8; 16];
    rand_core::RngCore::fill_bytes(&mut rand_core::OsRng, &mut bytes);
    let mut id = String::with_capacity(4 + 32);
    id.push_str("lgr_");
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

/// Pratinjau langsung dihitung on-the-fly dari absensi_harian dan presensi_mapel_detail.
///
/// Multi-sesi dicegah berganda lewat subquery agregasi GATE_SUMMARY_SUBQUERY,
/// persis aturan wajib nomor 31 pada GEMINI.md / CLAUDE.md.
pub fn get_ledger_preview(
    state: &DesktopState,
    id_tahun_ajaran: &str,
    semester: &str,
    id_rombel: Option<&str>,
) -> Result<Value, CommandError> {
    let conn = storage::database(&state.data_dir)?;

    let ta_info: Option<(String, String)> = conn
        .query_row(
            "SELECT tanggal_mulai, tanggal_selesai FROM akademik_tahun_ajaran WHERE id_tahun_ajaran = ?1 LIMIT 1;",
            params![id_tahun_ajaran],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .map_err(|_| CommandError::internal())?;

    let (start_date, end_date) = match ta_info {
        Some((s, e)) => (s, e),
        None => {
            return Err(CommandError::new(
                "NOT_FOUND",
                "Tahun ajaran tidak ditemukan.",
            ))
        }
    };

    let total_hari_efektif: i64 = conn
        .query_row(
            "SELECT COUNT(DISTINCT tanggal) FROM absensi_harian WHERE tanggal >= ?1 AND tanggal <= ?2;",
            params![start_date, end_date],
            |row| row.get(0),
        )
        .unwrap_or(0);

    let sql = r#"
        SELECT
            s.id_siswa,
            s.nis,
            s.nisn,
            s.nama_lengkap,
            s.id_rombel,
            r.nama_rombel,
            COALESCE(att.hadir, 0) AS hadir,
            COALESCE(att.izin, 0) AS izin,
            COALESCE(att.sakit, 0) AS sakit,
            COALESCE(att.alfa, 0) AS alfa,
            COALESCE(att.dispensasi, 0) AS dispensasi
        FROM siswa_data s
        JOIN akademik_rombel r ON r.id_rombel = s.id_rombel
        LEFT JOIN (
            SELECT
                g.id_karyawan,
                SUM(CASE WHEN g.hadir_gerbang = 1 OR g.status_kehadiran IN ('Hadir', 'Terlambat') THEN 1 ELSE 0 END) AS hadir,
                SUM(CASE WHEN g.status_kehadiran = 'Izin' THEN 1 ELSE 0 END) AS izin,
                SUM(CASE WHEN g.status_kehadiran = 'Sakit' THEN 1 ELSE 0 END) AS sakit,
                SUM(CASE WHEN g.status_kehadiran = 'Alfa' THEN 1 ELSE 0 END) AS alfa,
                SUM(CASE WHEN g.status_kehadiran = 'Dispensasi' THEN 1 ELSE 0 END) AS dispensasi
            FROM (
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
                WHERE tanggal >= ?1 AND tanggal <= ?2
                GROUP BY id_karyawan, tanggal
            ) g
            GROUP BY g.id_karyawan
        ) att ON att.id_karyawan = s.id_siswa
        WHERE s.status = 'Aktif'
          AND (?3 IS NULL OR s.id_rombel = ?3)
        ORDER BY s.nama_lengkap ASC;
    "#;

    let mut stmt = conn.prepare(sql).map_err(|_| CommandError::internal())?;
    let rows = stmt
        .query_map(params![start_date, end_date, id_rombel], |row| {
            let id_siswa: String = row.get(0)?;
            let nis: Option<String> = row.get(1)?;
            let nisn: Option<String> = row.get(2)?;
            let nama_lengkap: String = row.get(3)?;
            let rombel_id: String = row.get(4)?;
            let nama_rombel: String = row.get(5)?;
            let hadir: i64 = row.get(6)?;
            let izin: i64 = row.get(7)?;
            let sakit: i64 = row.get(8)?;
            let alfa: i64 = row.get(9)?;
            let dispensasi: i64 = row.get(10)?;

            let penyebut = if total_hari_efektif > 0 {
                total_hari_efektif
            } else {
                (hadir + izin + sakit + alfa + dispensasi).max(1)
            };

            let persen = ((hadir as f64) * 100.0 / (penyebut as f64) * 10.0).round() / 10.0;
            let persen_clamped = persen.clamp(0.0, 100.0);

            Ok(json!({
                "id_siswa": id_siswa,
                "nis": nis,
                "nisn": nisn,
                "nama_lengkap": nama_lengkap,
                "id_rombel": rombel_id,
                "nama_rombel": nama_rombel,
                "id_tahun_ajaran": id_tahun_ajaran,
                "semester": semester,
                "total_hari_efektif": penyebut,
                "hadir": hadir,
                "izin": izin,
                "sakit": sakit,
                "alfa": alfa,
                "dispensasi": dispensasi,
                "persen_kehadiran": persen_clamped,
            }))
        })
        .map_err(|_| CommandError::internal())?
        .filter_map(Result::ok)
        .collect::<Vec<_>>();

    Ok(json!({
        "id_tahun_ajaran": id_tahun_ajaran,
        "semester": semester,
        "id_rombel": id_rombel,
        "total_hari_efektif": total_hari_efektif,
        "students": rows,
    }))
}

/// Membekukan angka leger untuk rapor semesteran.
///
/// Sekali dibekukan, angka kehadiran tidak akan berubah saat ada koreksi absensi
/// masa lalu. Pola ini identik dengan pembekuan payroll_items.
pub fn freeze_attendance_ledger(
    state: &DesktopState,
    session_operator: &str,
    payload: &Value,
) -> Result<Value, CommandError> {
    let id_ta = text(payload, "id_tahun_ajaran");
    let semester = text(payload, "semester");
    let id_rombel = text(payload, "id_rombel");

    if id_ta.is_empty() || semester.is_empty() || id_rombel.is_empty() {
        return Err(CommandError::new(
            "VALIDATION_ERROR",
            "Tahun ajaran, semester, dan rombel wajib ditentukan untuk pembekuan leger.",
        ));
    }

    let operator = session_operator.trim();
    if operator.is_empty() {
        return Err(CommandError::new(
            "UNAUTHORIZED",
            "Sesi operator tidak valid untuk membekukan leger kehadiran.",
        ));
    }

    let raw_items = if let Some(arr) = payload.get("items").and_then(Value::as_array) {
        arr.clone()
    } else {
        let preview = get_ledger_preview(state, id_ta, semester, Some(id_rombel))?;
        preview
            .get("students")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default()
    };

    if raw_items.is_empty() {
        return Err(CommandError::new(
            "VALIDATION_ERROR",
            "Tidak ada siswa dalam rombel ini untuk dibekukan.",
        ));
    }

    let client_id = sync::ensure_client_id(state)?;
    let mut conn = storage::database(&state.data_dir)?;
    let tx = conn.transaction().map_err(|_| CommandError::internal())?;
    let now = sqlite_now(&tx);

    let mut frozen_records = Vec::with_capacity(raw_items.len());

    for item in &raw_items {
        let id_siswa = text(item, "id_siswa");
        if id_siswa.is_empty() {
            continue;
        }

        let existing_id: Option<String> = tx
            .query_row(
                r#"
                SELECT id_leger FROM leger_kehadiran
                WHERE id_tahun_ajaran = ?1 AND semester = ?2 AND id_rombel = ?3 AND id_siswa = ?4
                LIMIT 1;
                "#,
                params![id_ta, semester, id_rombel, id_siswa],
                |row| row.get(0),
            )
            .optional()
            .map_err(|_| CommandError::internal())?;

        let explicit_id = text(item, "id_leger");
        let id_leger = match (explicit_id.is_empty(), existing_id) {
            (false, _) => explicit_id.to_owned(),
            (true, Some(existing)) => existing,
            (true, None) => new_ledger_id(),
        };

        let total_hari_efektif = integer(item, "total_hari_efektif", 1).max(0);
        let hadir = integer(item, "hadir", 0).max(0);
        let izin = integer(item, "izin", 0).max(0);
        let sakit = integer(item, "sakit", 0).max(0);
        let alfa = integer(item, "alfa", 0).max(0);
        let dispensasi = integer(item, "dispensasi", 0).max(0);
        let persen = float(item, "persen_kehadiran", 0.0).clamp(0.0, 100.0);

        tx.execute(
            r#"
            INSERT INTO leger_kehadiran (
                id_leger, id_tahun_ajaran, semester, id_siswa, id_rombel,
                total_hari_efektif, hadir, izin, sakit, alfa, dispensasi,
                persen_kehadiran, dibekukan_at, dibekukan_oleh, created_at, updated_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)
            ON CONFLICT(id_leger) DO UPDATE SET
                id_tahun_ajaran = excluded.id_tahun_ajaran,
                semester = excluded.semester,
                id_siswa = excluded.id_siswa,
                id_rombel = excluded.id_rombel,
                total_hari_efektif = excluded.total_hari_efektif,
                hadir = excluded.hadir,
                izin = excluded.izin,
                sakit = excluded.sakit,
                alfa = excluded.alfa,
                dispensasi = excluded.dispensasi,
                persen_kehadiran = excluded.persen_kehadiran,
                dibekukan_at = excluded.dibekukan_at,
                dibekukan_oleh = excluded.dibekukan_oleh,
                updated_at = excluded.updated_at;
            "#,
            params![
                id_leger,
                id_ta,
                semester,
                id_siswa,
                id_rombel,
                total_hari_efektif,
                hadir,
                izin,
                sakit,
                alfa,
                dispensasi,
                persen,
                now,
                operator,
                now,
                now
            ],
        )
        .map_err(|e| CommandError::new("DB_ERROR", format!("Gagal membekukan data leger: {e}")))?;

        let outbox_payload = json!({
            "id_leger": id_leger,
            "id_tahun_ajaran": id_ta,
            "semester": semester,
            "id_siswa": id_siswa,
            "id_rombel": id_rombel,
            "total_hari_efektif": total_hari_efektif,
            "hadir": hadir,
            "izin": izin,
            "sakit": sakit,
            "alfa": alfa,
            "dispensasi": dispensasi,
            "persen_kehadiran": persen,
            "dibekukan_at": now,
            "dibekukan_oleh": operator,
            "created_at": now,
            "updated_at": now,
        });

        sync::enqueue(
            &tx,
            &client_id,
            "attendance-ledger",
            "freeze",
            &id_leger,
            &outbox_payload,
            None,
        )?;

        frozen_records.push(outbox_payload);
    }

    tx.commit().map_err(|_| CommandError::internal())?;

    Ok(json!({
        "sukses": true,
        "total_dibekukan": frozen_records.len(),
        "items": frozen_records,
    }))
}

pub fn get_frozen_ledger(
    state: &DesktopState,
    id_tahun_ajaran: &str,
    semester: &str,
    id_rombel: Option<&str>,
) -> Result<Value, CommandError> {
    let conn = storage::database(&state.data_dir)?;
    let sql = r#"
        SELECT l.id_leger, l.id_tahun_ajaran, l.semester, l.id_siswa, l.id_rombel,
               l.total_hari_efektif, l.hadir, l.izin, l.sakit, l.alfa, l.dispensasi,
               l.persen_kehadiran, l.dibekukan_at, l.dibekukan_oleh,
               l.created_at, l.updated_at,
               s.nis, s.nisn, s.nama_lengkap, r.nama_rombel
        FROM leger_kehadiran l
        JOIN siswa_data s ON s.id_siswa = l.id_siswa
        JOIN akademik_rombel r ON r.id_rombel = l.id_rombel
        WHERE l.id_tahun_ajaran = ?1 AND l.semester = ?2
          AND (?3 IS NULL OR l.id_rombel = ?3)
        ORDER BY s.nama_lengkap ASC;
    "#;

    let mut stmt = conn.prepare(sql).map_err(|_| CommandError::internal())?;
    let rows = stmt
        .query_map(params![id_tahun_ajaran, semester, id_rombel], |row| {
            Ok(json!({
                "id_leger": row.get::<_, String>(0)?,
                "id_tahun_ajaran": row.get::<_, String>(1)?,
                "semester": row.get::<_, String>(2)?,
                "id_siswa": row.get::<_, String>(3)?,
                "id_rombel": row.get::<_, String>(4)?,
                "total_hari_efektif": row.get::<_, i64>(5)?,
                "hadir": row.get::<_, i64>(6)?,
                "izin": row.get::<_, i64>(7)?,
                "sakit": row.get::<_, i64>(8)?,
                "alfa": row.get::<_, i64>(9)?,
                "dispensasi": row.get::<_, i64>(10)?,
                "persen_kehadiran": row.get::<_, f64>(11)?,
                "dibekukan_at": row.get::<_, String>(12)?,
                "dibekukan_oleh": row.get::<_, String>(13)?,
                "created_at": row.get::<_, String>(14)?,
                "updated_at": row.get::<_, String>(15)?,
                "nis": row.get::<_, Option<String>>(16)?,
                "nisn": row.get::<_, Option<String>>(17)?,
                "nama_lengkap": row.get::<_, String>(18)?,
                "nama_rombel": row.get::<_, String>(19)?,
            }))
        })
        .map_err(|_| CommandError::internal())?
        .filter_map(Result::ok)
        .collect::<Vec<_>>();

    Ok(json!(rows))
}

pub fn delete_frozen_ledger(
    state: &DesktopState,
    id_tahun_ajaran: &str,
    semester: &str,
    id_rombel: &str,
) -> Result<Value, CommandError> {
    let client_id = sync::ensure_client_id(state)?;
    let mut conn = storage::database(&state.data_dir)?;
    let tx = conn.transaction().map_err(|_| CommandError::internal())?;

    let count: i64 = tx
        .query_row(
            "SELECT COUNT(*) FROM leger_kehadiran WHERE id_tahun_ajaran = ?1 AND semester = ?2 AND id_rombel = ?3;",
            params![id_tahun_ajaran, semester, id_rombel],
            |row| row.get(0),
        )
        .unwrap_or(0);

    if count == 0 {
        return Err(CommandError::new(
            "NOT_FOUND",
            "Tidak ada catatan leger beku untuk rombel dan semester tersebut.",
        ));
    }

    tx.execute(
        "DELETE FROM leger_kehadiran WHERE id_tahun_ajaran = ?1 AND semester = ?2 AND id_rombel = ?3;",
        params![id_tahun_ajaran, semester, id_rombel],
    )
    .map_err(|e| CommandError::new("DB_ERROR", format!("Gagal menghapus leger beku: {e}")))?;

    let scope_key = format!("{id_tahun_ajaran}_{semester}_{id_rombel}");
    sync::enqueue(
        &tx,
        &client_id,
        "attendance-ledger",
        "delete",
        &scope_key,
        &json!({
            "id_tahun_ajaran": id_tahun_ajaran,
            "semester": semester,
            "id_rombel": id_rombel,
        }),
        None,
    )?;

    tx.commit().map_err(|_| CommandError::internal())?;

    Ok(json!({ "sukses": true, "deleted_count": count }))
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

            INSERT INTO master_data (
                id_unik, kode_karyawan, nama, divisi, status_aktif, tanggal_daftar, id_shift
            ) VALUES
                ('sis_01', 'S-01', 'Siti Rahma', 'Peserta Didik', 'Aktif', '2026-07-01', 1),
                ('sis_02', 'S-02', 'Ahmad Fadil', 'Peserta Didik', 'Aktif', '2026-07-01', 1);

            INSERT INTO siswa_data (
                id_siswa, nis, nisn, nama_lengkap, jenis_kelamin, id_rombel, angkatan,
                status, created_at, updated_at
            ) VALUES
                ('sis_01', '1001', '00123', 'Siti Rahma', 'P', 'rombel_10a', 2026, 'Aktif', '2026-07-01', '2026-07-01'),
                ('sis_02', '1002', '00124', 'Ahmad Fadil', 'L', 'rombel_10a', 2026, 'Aktif', '2026-07-01', '2026-07-01');

            INSERT INTO absensi_harian (
                id_absensi, tanggal, id_karyawan, nama, kelas_divisi, jam_masuk,
                status_kehadiran, status_absen, sumber, update_terakhir,
                id_shift, bulan, tahun, id_sesi
            ) VALUES
                (1, '2026-09-01', 'sis_01', 'Siti Rahma', 'Peserta Didik', '07:05:00', 'Hadir', 'Tepat Waktu', 'Scanner', '2026-09-01 07:05:00', 1, 'September', 2026, 'NORMAL-20260901-sis_01-1'),
                (2, '2026-09-02', 'sis_01', 'Siti Rahma', 'Peserta Didik', '07:10:00', 'Hadir', 'Tepat Waktu', 'Scanner', '2026-09-02 07:10:00', 1, 'September', 2026, 'NORMAL-20260902-sis_01-1'),
                (3, '2026-09-01', 'sis_02', 'Ahmad Fadil', 'Peserta Didik', '07:08:00', 'Hadir', 'Tepat Waktu', 'Scanner', '2026-09-01 07:08:00', 1, 'September', 2026, 'NORMAL-20260901-sis_02-1'),
                (4, '2026-09-02', 'sis_02', 'Ahmad Fadil', 'Peserta Didik', NULL, 'Sakit', 'Sakit', 'Import Manual', '2026-09-02 07:00:00', 1, 'September', 2026, 'NORMAL-20260902-sis_02-1');
            "#,
        )
        .expect("seed test data");

        (dir, state)
    }

    #[test]
    fn test_attendance_ledger_preview_and_freeze_lifecycle() {
        let (_dir, state) = setup_test_state();

        let preview = get_ledger_preview(&state, "ta_2026_ganjil", "Ganjil", Some("rombel_10a"))
            .expect("get preview");
        let students = preview["students"].as_array().expect("students array");
        assert_eq!(students.len(), 2);

        let freeze_payload = json!({
            "id_tahun_ajaran": "ta_2026_ganjil",
            "semester": "Ganjil",
            "id_rombel": "rombel_10a",
        });

        let freeze_res = freeze_attendance_ledger(&state, "wali_kelas_10a", &freeze_payload)
            .expect("freeze ledger");
        assert_eq!(freeze_res["sukses"], true);
        assert_eq!(freeze_res["total_dibekukan"], 2);

        let frozen = get_frozen_ledger(&state, "ta_2026_ganjil", "Ganjil", Some("rombel_10a"))
            .expect("get frozen ledger");
        let frozen_arr = frozen.as_array().expect("frozen array");
        assert_eq!(frozen_arr.len(), 2);
        assert_eq!(frozen_arr[0]["dibekukan_oleh"], "wali_kelas_10a");

        let del_res = delete_frozen_ledger(&state, "ta_2026_ganjil", "Ganjil", "rombel_10a")
            .expect("delete frozen ledger");
        assert_eq!(del_res["sukses"], true);

        let frozen_after =
            get_frozen_ledger(&state, "ta_2026_ganjil", "Ganjil", Some("rombel_10a"))
                .expect("get frozen ledger after delete");
        assert_eq!(frozen_after.as_array().expect("empty array").len(), 0);
    }
}
