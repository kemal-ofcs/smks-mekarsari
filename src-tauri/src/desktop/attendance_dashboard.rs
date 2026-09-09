use rusqlite::params;
use serde_json::{json, Value};

use super::{config::DesktopState, models::CommandError, storage};

const GATE_SUMMARY_SUBQUERY: &str = r#"(
    SELECT
        id_karyawan,
        tanggal,
        MIN(NULLIF(TRIM(jam_masuk), '')) AS jam_masuk,
        MAX(NULLIF(TRIM(jam_pulang), '')) AS jam_pulang,
        MAX(CASE
            WHEN COALESCE(TRIM(jam_masuk), '') <> ''
             AND COALESCE(status_kehadiran, '') <> 'Alfa'
            THEN 1 ELSE 0
        END) AS hadir_gerbang,
        MAX(COALESCE(status_kehadiran, '')) AS status_kehadiran,
        MAX(COALESCE(menit_terlambat, 0)) AS menit_terlambat
    FROM absensi_harian
    GROUP BY id_karyawan, tanggal
)"#;

/// Siswa dikenali lewat DUA kolom karena keduanya dipakai di lapangan:
/// `jenis_personil` diisi oleh alur akademik, sedangkan baris lama yang
/// diimpor dari sistem sebelumnya hanya menandainya di `jabatan_status`.
const PREDIKAT_SISWA: &str = "(LOWER(TRIM(COALESCE(m.jenis_personil, ''))) = 'siswa'
               OR LOWER(TRIM(COALESCE(m.jabatan_status, ''))) = 'siswa')";

/// Guru/PTK adalah komplemen dari predikat siswa, jadi keduanya wajib menyebut
/// pasangan kolom yang sama persis — kalau tidak, seseorang bisa terhitung dua
/// kali atau justru hilang dari kedua kelompok.
const PREDIKAT_GURU_PTK: &str = "LOWER(TRIM(COALESCE(m.jenis_personil, ''))) <> 'siswa'
          AND LOWER(TRIM(COALESCE(m.jabatan_status, ''))) <> 'siswa'";

/// Kelompok personil yang dihitung. Kedua cabangnya memakai SELECT yang sama
/// dan hanya berbeda pada predikat WHERE-nya.
#[derive(Clone, Copy)]
enum KelompokPersonil {
    Siswa,
    GuruPtk,
}

impl KelompokPersonil {
    fn predikat(self) -> &'static str {
        match self {
            Self::Siswa => PREDIKAT_SISWA,
            Self::GuruPtk => PREDIKAT_GURU_PTK,
        }
    }
}

fn db_error(error: rusqlite::Error) -> CommandError {
    CommandError::new("DB_ERROR", error.to_string())
}

fn sql_total_personil(kelompok: KelompokPersonil) -> String {
    let predikat = kelompok.predikat();
    format!(
        r#"
        SELECT COUNT(*)
        FROM master_data m
        WHERE m.status_aktif = 'Aktif'
          AND {predikat};
        "#
    )
}

fn sql_statistik_personil(kelompok: KelompokPersonil) -> String {
    let predikat = kelompok.predikat();
    format!(
        r#"
        SELECT
            COUNT(CASE WHEN ah.hadir_gerbang = 1 OR ah.status_kehadiran = 'Hadir' THEN 1 END) AS hadir,
            COUNT(CASE WHEN ah.menit_terlambat > 0 THEN 1 END) AS terlambat,
            COUNT(CASE WHEN ah.status_kehadiran = 'Sakit' THEN 1 END) AS sakit,
            COUNT(CASE WHEN ah.status_kehadiran = 'Izin' THEN 1 END) AS izin,
            COUNT(CASE WHEN ah.status_kehadiran = 'Dispen' THEN 1 END) AS dispen,
            COUNT(CASE WHEN ah.status_kehadiran = 'Alfa' THEN 1 END) AS alfa
        FROM master_data m
        LEFT JOIN {GATE_SUMMARY_SUBQUERY} ah
            ON ah.id_karyawan = m.id_unik AND ah.tanggal = ?1
        WHERE m.status_aktif = 'Aktif'
          AND {predikat};
        "#
    )
}

fn sql_rekap_rombel() -> String {
    format!(
        r#"
        SELECT
            r.id_rombel,
            r.nama_rombel,
            COUNT(s.id_siswa) AS total_siswa,
            COUNT(CASE WHEN ah.hadir_gerbang = 1 OR ah.status_kehadiran = 'Hadir' THEN 1 END) AS hadir,
            COUNT(CASE WHEN ah.status_kehadiran IN ('Sakit', 'Izin', 'Dispen') THEN 1 END) AS sakit_izin,
            COUNT(CASE WHEN ah.status_kehadiran = 'Alfa' THEN 1 END) AS alfa
        FROM akademik_rombel r
        LEFT JOIN siswa_data s ON s.id_rombel = r.id_rombel
        LEFT JOIN master_data m ON m.id_unik = s.id_siswa AND m.status_aktif = 'Aktif'
        LEFT JOIN {GATE_SUMMARY_SUBQUERY} ah ON ah.id_karyawan = s.id_siswa AND ah.tanggal = ?1
        GROUP BY r.id_rombel, r.nama_rombel
        ORDER BY r.nama_rombel ASC;
        "#
    )
}

fn sql_daftar_guru() -> String {
    let predikat = PREDIKAT_GURU_PTK;
    format!(
        r#"
        SELECT
            m.id_unik,
            m.nama AS nama_lengkap,
            COALESCE(m.jabatan_status, 'Guru / PTK') AS jabatan,
            COALESCE(ah.jam_masuk, '') AS jam_masuk,
            COALESCE(ah.jam_pulang, '') AS jam_pulang,
            COALESCE(ah.status_kehadiran, 'Belum Hadir') AS status_kehadiran,
            COALESCE(ah.menit_terlambat, 0) AS menit_terlambat
        FROM master_data m
        LEFT JOIN {GATE_SUMMARY_SUBQUERY} ah ON ah.id_karyawan = m.id_unik AND ah.tanggal = ?1
        WHERE m.status_aktif = 'Aktif'
          AND {predikat}
        ORDER BY m.nama ASC;
        "#
    )
}

/// Siswa yang tercatat masuk gerbang tetapi ditandai Alfa di presensi mapel.
///
/// `presensi_mapel_detail.status` dibatasi CHECK constraint pada lima nilai
/// kanonik (`Hadir`, `Izin`, `Sakit`, `Alfa`, `Dispensasi`), sehingga hanya
/// `Alfa` yang mungkin cocok di sini.
fn sql_anomali_bolos() -> String {
    format!(
        r#"
        SELECT COUNT(DISTINCT ah.id_karyawan)
        FROM {GATE_SUMMARY_SUBQUERY} ah
        JOIN presensi_mapel pm ON pm.tanggal = ah.tanggal
        JOIN presensi_mapel_detail pmd ON pmd.id_presensi_mapel = pm.id_presensi_mapel
             AND pmd.id_siswa = ah.id_karyawan
        WHERE ah.tanggal = ?1
          AND ah.hadir_gerbang = 1
          AND pmd.status = 'Alfa';
        "#
    )
}

/// Seluruh query dasbor beserta jumlah parameternya, untuk diuji satu per satu.
///
/// Daftar ini WAJIB memuat setiap query yang dijalankan
/// `get_attendance_dashboard_metrics`. Query yang dibangun tetapi tidak
/// terdaftar di sini tidak pernah diperiksa terhadap skema asli, dan celah
/// itulah yang membuat rujukan kolom salah bisa lolos ke rilis.
#[cfg(test)]
fn semua_query_dasbor() -> Vec<(&'static str, String, usize)> {
    vec![
        (
            "total_siswa",
            sql_total_personil(KelompokPersonil::Siswa),
            0,
        ),
        (
            "total_guru",
            sql_total_personil(KelompokPersonil::GuruPtk),
            0,
        ),
        (
            "statistik_siswa",
            sql_statistik_personil(KelompokPersonil::Siswa),
            1,
        ),
        (
            "statistik_guru",
            sql_statistik_personil(KelompokPersonil::GuruPtk),
            1,
        ),
        ("rekap_rombel", sql_rekap_rombel(), 1),
        ("daftar_guru", sql_daftar_guru(), 1),
        ("anomali_bolos", sql_anomali_bolos(), 1),
    ]
}

type StatistikPersonil = (i64, i64, i64, i64, i64, i64);

fn baca_statistik(
    connection: &rusqlite::Connection,
    kelompok: KelompokPersonil,
    tanggal: &str,
) -> Result<StatistikPersonil, CommandError> {
    connection
        .query_row(&sql_statistik_personil(kelompok), params![tanggal], |r| {
            Ok((
                r.get(0)?,
                r.get(1)?,
                r.get(2)?,
                r.get(3)?,
                r.get(4)?,
                r.get(5)?,
            ))
        })
        .map_err(db_error)
}

fn persentase(hadir: i64, total: i64) -> i64 {
    if total > 0 {
        ((hadir as f64 / total as f64) * 100.0).round() as i64
    } else {
        0
    }
}

/// Menghitung ringkasan metrik audit kehadiran komprehensif untuk Siswa dan Guru/PTK
/// pada tanggal tertentu (bawaan: tanggal operasional hari ini).
///
/// Kegagalan query DIKEMBALIKAN sebagai error, tidak pernah dijadikan angka nol.
/// Dasbor yang menampilkan nol di semua kartu tidak bisa dibedakan dari hari yang
/// memang sepi, sehingga skema yang rusak bisa bertahan lama tanpa ada yang
/// menyadarinya.
pub fn get_attendance_dashboard_metrics(
    state: &DesktopState,
    tanggal: Option<&str>,
) -> Result<Value, CommandError> {
    let connection = storage::database(&state.data_dir)?;
    let date_str = match tanggal.map(str::trim).filter(|s| !s.is_empty()) {
        Some(d) => d.to_string(),
        None => connection
            .query_row("SELECT date('now', '+7 hours');", [], |r| r.get(0))
            .map_err(db_error)?,
    };

    // 1. Siswa metrics
    let total_siswa: i64 = connection
        .query_row(&sql_total_personil(KelompokPersonil::Siswa), [], |r| {
            r.get(0)
        })
        .map_err(db_error)?;

    let (siswa_hadir, siswa_terlambat, siswa_sakit, siswa_izin, siswa_dispen, siswa_alfa) =
        baca_statistik(&connection, KelompokPersonil::Siswa, &date_str)?;

    // 2. Guru / PTK metrics
    let total_guru: i64 = connection
        .query_row(&sql_total_personil(KelompokPersonil::GuruPtk), [], |r| {
            r.get(0)
        })
        .map_err(db_error)?;

    let (guru_hadir, guru_terlambat, guru_sakit, guru_izin, guru_dispen, guru_alfa) =
        baca_statistik(&connection, KelompokPersonil::GuruPtk, &date_str)?;

    // 3. Rekap per Rombel
    let mut stmt_rombel = connection.prepare(&sql_rekap_rombel()).map_err(db_error)?;
    let rombel_rows = stmt_rombel
        .query_map(params![date_str], |r| {
            let total: i64 = r.get(2)?;
            let hadir: i64 = r.get(3)?;
            let sakit_izin: i64 = r.get(4)?;
            let alfa: i64 = r.get(5)?;
            Ok(json!({
                "id_rombel": r.get::<_, String>(0)?,
                "nama_rombel": r.get::<_, String>(1)?,
                "total_siswa": total,
                "hadir": hadir,
                "sakit_izin": sakit_izin,
                "alfa": alfa,
                "persentase": persentase(hadir, total),
            }))
        })
        .map_err(db_error)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(db_error)?;

    // 4. Rekap Guru Hari Ini (Detail Status)
    let mut stmt_guru = connection.prepare(&sql_daftar_guru()).map_err(db_error)?;
    let guru_rows = stmt_guru
        .query_map(params![date_str], |r| {
            Ok(json!({
                "id_karyawan": r.get::<_, String>(0)?,
                "nama_lengkap": r.get::<_, String>(1)?,
                "jabatan": r.get::<_, String>(2)?,
                "jam_masuk": r.get::<_, String>(3)?,
                "jam_pulang": r.get::<_, String>(4)?,
                "status_kehadiran": r.get::<_, String>(5)?,
                "menit_terlambat": r.get::<_, i64>(6)?,
            }))
        })
        .map_err(db_error)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(db_error)?;

    // 5. Deteksi Anomali Bolos Hari Ini
    let anomali_bolos: i64 = connection
        .query_row(&sql_anomali_bolos(), params![date_str], |r| r.get(0))
        .map_err(db_error)?;

    Ok(json!({
        "tanggal": date_str,
        "siswa": {
            "total": total_siswa,
            "hadir": siswa_hadir,
            "terlambat": siswa_terlambat,
            "sakit": siswa_sakit,
            "izin": siswa_izin,
            "dispen": siswa_dispen,
            "alfa": siswa_alfa,
            "persentase": persentase(siswa_hadir, total_siswa),
        },
        "guru": {
            "total": total_guru,
            "hadir": guru_hadir,
            "terlambat": guru_terlambat,
            "sakit": guru_sakit,
            "izin": guru_izin,
            "dispen": guru_dispen,
            "alfa": guru_alfa,
            "persentase": persentase(guru_hadir, total_guru),
        },
        "rekapRombel": rombel_rows,
        "rekapGuru": guru_rows,
        "anomaliBolos": anomali_bolos,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    const TANGGAL_UJI: &str = "2026-09-07";

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

    /// Inti langkah ini: setiap query dasbor di-`prepare` SQLite terhadap skema
    /// yang dibangun `storage::initialize`, bukan terhadap tabel tiruan yang
    /// ditulis ulang di dalam tes.
    ///
    /// Tes yang meniru skemanya akan ikut menyalin kesalahan yang sama dan tetap
    /// lulus. Hanya bentuk inilah yang menangkap rujukan kolom yang tidak ada —
    /// dan seluruh query dasbor memang pernah menyebut `m.jabatan`,
    /// `m.nama_lengkap`, serta `pmd.status_kehadiran` yang tidak pernah ada di
    /// `master_data` maupun `presensi_mapel_detail`.
    #[test]
    fn setiap_query_dasbor_valid_terhadap_skema_asli() {
        let (_dir, state) = setup_test_state();
        let connection = storage::database(&state.data_dir).expect("open db");

        for (nama, sql, jumlah_parameter) in semua_query_dasbor() {
            let statement = connection.prepare(&sql).unwrap_or_else(|error| {
                panic!("query dasbor `{nama}` ditolak SQLite: {error}\n--- SQL ---\n{sql}")
            });
            assert_eq!(
                statement.parameter_count(),
                jumlah_parameter,
                "query dasbor `{nama}` menuntut jumlah parameter yang berbeda dari yang diikat pemanggilnya",
            );
        }
    }

    fn seed_data_uji(state: &DesktopState) {
        let connection = storage::database(&state.data_dir).expect("open db");
        connection
            .execute_batch(
                r#"
            INSERT INTO akademik_tahun_ajaran (
                id_tahun_ajaran, nama_tahun, semester, tanggal_mulai, tanggal_selesai,
                is_aktif, created_at, updated_at
            ) VALUES ('ta_2026', '2026/2027', 'Ganjil', '2026-07-01', '2026-12-31', 1,
                      '2026-07-01', '2026-07-01');

            INSERT INTO akademik_rombel (
                id_rombel, id_tahun_ajaran, tingkat, nama_rombel, kapasitas, is_aktif
            ) VALUES ('rombel_10a', 'ta_2026', 10, 'X-A', 36, 1);

            INSERT INTO master_data (
                id_unik, kode_karyawan, nama, divisi, jabatan_status, jenis_personil,
                id_shift, status_aktif, tanggal_daftar
            ) VALUES
                ('sis_01', 'S-01', 'Siti Rahma', 'Peserta Didik', NULL, 'Siswa',
                 1, 'Aktif', '2026-07-01'),
                ('sis_02', 'S-02', 'Ahmad Fadil', 'Peserta Didik', 'Siswa', NULL,
                 1, 'Aktif', '2026-07-01'),
                ('gur_01', 'G-01', 'Budi Santoso', 'Kurikulum', 'Guru Mapel', 'Guru',
                 1, 'Aktif', '2026-07-01'),
                ('gur_02', 'G-02', 'Rina Lestari', 'Kurikulum', 'Guru Mapel', 'Guru',
                 1, 'Nonaktif', '2026-07-01');

            INSERT INTO siswa_data (
                id_siswa, nis, nisn, nama_lengkap, jenis_kelamin, id_rombel, angkatan,
                status, created_at, updated_at
            ) VALUES
                ('sis_01', '1001', '00123', 'Siti Rahma', 'P', 'rombel_10a', 2026,
                 'Aktif', '2026-07-01', '2026-07-01'),
                ('sis_02', '1002', '00124', 'Ahmad Fadil', 'L', 'rombel_10a', 2026,
                 'Aktif', '2026-07-01', '2026-07-01');
            "#,
            )
            .expect("seed master");

        connection
            .execute_batch(
                r#"
            INSERT INTO absensi_harian (
                tanggal, id_karyawan, nama, kelas_divisi, jam_masuk, jam_pulang,
                status_kehadiran, status_absen, sumber, update_terakhir,
                menit_terlambat, id_shift, bulan, tahun, id_sesi
            ) VALUES
                ('2026-09-07', 'sis_01', 'Siti Rahma', 'X-A', '07:05', '',
                 'Hadir', 'Masuk', 'Scanner', '2026-09-07 07:05:00',
                 5, 1, '09', 2026, 'sesi_sis01_a'),
                ('2026-09-07', 'sis_01', 'Siti Rahma', 'X-A', '', '15:00',
                 'Hadir', 'Pulang', 'Scanner', '2026-09-07 15:00:00',
                 0, 1, '09', 2026, 'sesi_sis01_b'),
                ('2026-09-07', 'gur_01', 'Budi Santoso', 'Kurikulum', '06:50', '16:00',
                 'Hadir', 'Masuk', 'Scanner', '2026-09-07 06:50:00',
                 0, 1, '09', 2026, 'sesi_gur01_a');

            INSERT INTO presensi_mapel (
                id_presensi_mapel, id_tahun_ajaran, id_rombel, id_mapel, id_guru,
                tanggal, jam_ke, total_hadir, total_alfa, created_at, updated_at
            ) VALUES ('pm_01', 'ta_2026', 'rombel_10a', 'mapel_mtk', 'gur_01',
                      '2026-09-07', '3', 0, 1, '2026-09-07', '2026-09-07');

            INSERT INTO presensi_mapel_detail (
                id_detail, id_presensi_mapel, id_siswa, status, created_at, updated_at
            ) VALUES ('pmd_01', 'pm_01', 'sis_01', 'Alfa', '2026-09-07', '2026-09-07');
            "#,
            )
            .expect("seed absensi");
    }

    /// Menjalankan seluruh dasbor di atas data nyata. Melengkapi tes `prepare`
    /// di atas: yang itu membuktikan query-nya sah, yang ini membuktikan
    /// angkanya benar — termasuk pengikatan parameter tanggalnya.
    ///
    /// `sis_01` sengaja punya DUA baris `absensi_harian` pada tanggal yang sama
    /// (masuk dan pulang). Tanpa agregasi `GATE_SUMMARY_SUBQUERY`, satu orang
    /// itu akan terhitung hadir dua kali.
    #[test]
    fn metrik_dasbor_dihitung_dari_data_nyata() {
        let (_dir, state) = setup_test_state();
        seed_data_uji(&state);

        let hasil = get_attendance_dashboard_metrics(&state, Some(TANGGAL_UJI))
            .expect("dasbor wajib berhasil pada skema yang benar");

        assert_eq!(hasil["tanggal"], TANGGAL_UJI);

        // sis_01 (lewat `jenis_personil`) + sis_02 (lewat `jabatan_status`) = 2.
        // Baris kedua itu membuktikan cabang OR pada predikat siswa terpakai.
        assert_eq!(hasil["siswa"]["total"], 2);
        assert_eq!(hasil["siswa"]["hadir"], 1);
        assert_eq!(hasil["siswa"]["terlambat"], 1);
        assert_eq!(hasil["siswa"]["persentase"], 50);

        // gur_02 berstatus Nonaktif sehingga tidak ikut terhitung.
        assert_eq!(hasil["guru"]["total"], 1);
        assert_eq!(hasil["guru"]["hadir"], 1);
        assert_eq!(hasil["guru"]["persentase"], 100);

        let rombel = hasil["rekapRombel"]
            .as_array()
            .expect("rekap rombel berupa array");
        assert_eq!(rombel.len(), 1);
        assert_eq!(rombel[0]["nama_rombel"], "X-A");
        assert_eq!(rombel[0]["total_siswa"], 2);
        assert_eq!(rombel[0]["hadir"], 1);

        let guru = hasil["rekapGuru"]
            .as_array()
            .expect("rekap guru berupa array");
        assert_eq!(guru.len(), 1);
        // Namanya dibaca dari `master_data.nama`; alias `nama_lengkap` adalah
        // kontrak JSON ke UI dan wajib tetap terisi.
        assert_eq!(guru[0]["nama_lengkap"], "Budi Santoso");
        assert_eq!(guru[0]["jabatan"], "Guru Mapel");
        assert_eq!(guru[0]["jam_masuk"], "06:50");

        // sis_01 tercatat masuk gerbang tetapi ditandai Alfa di presensi mapel.
        assert_eq!(hasil["anomaliBolos"], 1);
    }

    /// Tanpa data sama sekali dasbor tetap harus berhasil dengan angka nol —
    /// nol karena memang kosong, bukan karena query-nya gagal diam-diam.
    #[test]
    fn dasbor_kosong_tetap_berhasil() {
        let (_dir, state) = setup_test_state();
        let hasil = get_attendance_dashboard_metrics(&state, Some(TANGGAL_UJI))
            .expect("dasbor kosong bukan error");
        assert_eq!(hasil["siswa"]["total"], 0);
        assert_eq!(hasil["siswa"]["persentase"], 0);
        assert_eq!(hasil["anomaliBolos"], 0);
        assert_eq!(
            hasil["rekapGuru"].as_array().map(Vec::len),
            Some(0),
            "rekap guru wajib berupa array kosong, bukan null",
        );
    }
}
