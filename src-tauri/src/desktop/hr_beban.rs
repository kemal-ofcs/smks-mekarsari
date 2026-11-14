//! HRIS Fase 3a (`prd-hris.md` §21.2.1): rekap beban mengajar per semester.
//!
//! Backend hanya mengirim data mentah; rekap (JP tatap muka, JP tugas, tanda)
//! disusun SEKALI di TS `susunBebanMengajar` (Q-65), dipakai Web dan Desktop.
//! Yang kembar adalah SQL-nya: teks di berkas ini dibandingkan harfiah dengan
//! `src/lib/validations/hr-beban.ts` oleh `hr-beban.test.ts`. Predikat
//! "berlaku" di `BEBAN_TUGAS_SQL` salinan harfiah `hris::TUGAS_BERLAKU_SQL`
//! (jalur gaji tidak disentuh). Tanpa tulisan, tanpa outbox; jalan luring.

use rusqlite::params;
use serde_json::{json, Value};

use super::hris::{self, rows_json_with};
use super::{config::DesktopState, models::CommandError, storage};

pub const SEMESTER_SQL: &str = "SELECT id_tahun_ajaran, nama_tahun, semester, tanggal_mulai, tanggal_selesai, is_aktif FROM akademik_tahun_ajaran ORDER BY tanggal_mulai DESC, id_tahun_ajaran\n-- batas: dua semester per tahun ajaran sekolah\n;";
/// Guru aktif (punya `guru_data`) ∪ siapa pun yang punya jadwal aktif di
/// semester ?1 (termasuk yang sudah nonaktif, untuk tanda `nonaktif`).
pub const BEBAN_GURU_SQL: &str = "SELECT m.id_unik, m.nama, COALESCE(g.gelar, '') AS gelar, COALESCE(g.nip, '') AS nip, COALESCE(g.nuptk, '') AS nuptk, COALESCE(m.unit, '') AS unit, CASE WHEN COALESCE(m.status_aktif, 'Aktif') = 'Aktif' THEN 1 ELSE 0 END AS aktif FROM master_data m LEFT JOIN guru_data g ON g.id_guru = m.id_unik WHERE (g.id_guru IS NOT NULL AND COALESCE(m.status_aktif, 'Aktif') = 'Aktif') OR EXISTS (SELECT 1 FROM jadwal_mengajar j WHERE j.id_guru = m.id_unik AND j.is_aktif = 1 AND j.id_tahun_ajaran = ?1) ORDER BY m.nama, m.id_unik\n-- batas: guru sekolah, dibatasi jumlah personil lembaga\n;";
/// Jadwal aktif semester ?1; unit = nama unit rombel (nama, bukan id, sama di
/// semua perangkat).
pub const BEBAN_JADWAL_SQL: &str = "SELECT j.id_jadwal, j.id_guru, j.hari, j.jam_ke, j.id_rombel, COALESCE(r.nama_rombel, j.id_rombel) AS nama_rombel, j.id_mapel, COALESCE(mp.nama_mapel, j.id_mapel) AS nama_mapel, COALESCE(u.nama_unit, '') AS unit FROM jadwal_mengajar j LEFT JOIN akademik_rombel r ON r.id_rombel = j.id_rombel LEFT JOIN akademik_mapel mp ON mp.id_mapel = j.id_mapel LEFT JOIN akademik_unit u ON u.id_unit = r.id_unit WHERE j.is_aktif = 1 AND j.id_tahun_ajaran = ?1 ORDER BY j.id_guru, j.hari, CAST(j.jam_ke AS INTEGER), j.jam_ke, j.id_jadwal\n-- batas: jadwal mingguan satu semester, sebesar rombel kali jam pelajaran\n;";
/// Tugas berlaku dan beririsan [?1, ?2] PER BARIS (Q-63): dua ekskul = dua
/// baris, wali dua rombel = dua baris. Ekuivalen baris, kosong = jenis; wali
/// kelas memakai ekuivalen baris SK walinya bila ada.
pub const BEBAN_TUGAS_SQL: &str = "SELECT t.id_tugas, t.id_karyawan, t.id_jenis, COALESCE(j.nama, t.id_jenis) AS nama_jenis, COALESCE(t.ekuivalen_jp, j.ekuivalen_jp, 0) AS ekuivalen_jp, COALESCE(t.unit, '') AS unit, '' AS nama_rombel, COALESCE(t.nomor_sk, '') AS nomor_sk, COALESCE(t.tanggal_sk, '') AS tanggal_sk FROM hr_tugas_tambahan t LEFT JOIN hr_tugas_jenis j ON j.id_jenis = t.id_jenis WHERE t.dibatalkan_pada IS NULL AND t.id_jenis <> 'tgs-wali-kelas' AND t.tanggal_mulai <= ?2 AND (COALESCE(t.tanggal_selesai, '') = '' OR t.tanggal_selesai >= ?1) UNION ALL SELECT 'wali:' || r.id_rombel, r.id_wali_kelas, 'tgs-wali-kelas', COALESCE(j.nama, 'Wali Kelas'), COALESCE((SELECT w.ekuivalen_jp FROM hr_tugas_tambahan w WHERE w.id_jenis = 'tgs-wali-kelas' AND w.id_rombel = r.id_rombel AND w.id_karyawan = r.id_wali_kelas AND w.dibatalkan_pada IS NULL AND w.ekuivalen_jp IS NOT NULL ORDER BY w.tanggal_mulai DESC, w.id_tugas DESC LIMIT 1), j.ekuivalen_jp, 0), COALESCE(u.nama_unit, ''), r.nama_rombel, '', '' FROM akademik_rombel r JOIN akademik_tahun_ajaran ta ON ta.id_tahun_ajaran = r.id_tahun_ajaran LEFT JOIN hr_tugas_jenis j ON j.id_jenis = 'tgs-wali-kelas' LEFT JOIN akademik_unit u ON u.id_unit = r.id_unit WHERE r.is_aktif = 1 AND COALESCE(r.id_wali_kelas, '') <> '' AND ta.tanggal_mulai <= ?2 AND ta.tanggal_selesai >= ?1 ORDER BY 2, 3, 1\n-- batas: tugas tambahan pegawai sekolah pada satu semester\n;";
/// Penugasan mapel semester ?1 dengan `beban_jam`: pembanding saja (Q-61).
pub const BEBAN_PENUGASAN_SQL: &str = "SELECT p.id_guru, p.id_rombel, COALESCE(r.nama_rombel, p.id_rombel) AS nama_rombel, p.id_mapel, COALESCE(mp.nama_mapel, p.id_mapel) AS nama_mapel, COALESCE(mp.beban_jam, 0) AS beban_jam FROM akademik_guru_mapel p LEFT JOIN akademik_rombel r ON r.id_rombel = p.id_rombel LEFT JOIN akademik_mapel mp ON mp.id_mapel = p.id_mapel WHERE p.id_tahun_ajaran = ?1 ORDER BY p.id_guru, p.id_rombel, p.id_mapel, p.id_penugasan\n-- batas: penugasan satu semester, sebesar rombel kali mapel\n;";

fn invalid(message: &str) -> CommandError {
    CommandError::new("VALIDATION_ERROR", message)
}

fn db_error(_: rusqlite::Error) -> CommandError {
    CommandError::internal()
}

/// `desktop_hr_teaching_load`: data mentah rekap semester `id_tahun_ajaran`
/// (kosong = semester aktif, lalu yang terbaru).
pub fn teaching_load(state: &DesktopState, id_tahun_ajaran: &str) -> Result<Value, CommandError> {
    let mut connection = storage::database(&state.data_dir)?;
    let transaction = connection.transaction().map_err(db_error)?;
    let semester = rows_json_with(&transaction, SEMESTER_SQL, [])?;
    let pilihan = id_tahun_ajaran.trim();
    let dipilih = if pilihan.is_empty() {
        semester
            .iter()
            .find(|s| s["is_aktif"] == json!(1))
            .or_else(|| semester.first())
    } else {
        Some(
            semester
                .iter()
                .find(|s| s["id_tahun_ajaran"] == json!(pilihan))
                .ok_or_else(|| invalid("Semester tidak ditemukan."))?,
        )
    }
    .cloned();
    let pengaturan = hris::pengaturan_kontrak(&transaction)?;
    let hari_ini = hris::hari_ini(&transaction)?;
    let batas = json!({
        "min": pengaturan["berlaku"]["beban_min_jp"],
        "maks": pengaturan["berlaku"]["beban_maks_jp"],
    });
    let Some(s) = dipilih else {
        return Ok(json!({
            "semester": semester, "id_tahun_ajaran": "", "guru": [], "jadwal": [],
            "tugas": [], "penugasan": [], "status": [], "batas": batas, "hari_ini": hari_ini,
        }));
    };
    let id = s["id_tahun_ajaran"].as_str().unwrap_or_default().to_owned();
    let awal = s["tanggal_mulai"].as_str().unwrap_or_default().to_owned();
    let akhir = s["tanggal_selesai"].as_str().unwrap_or_default().to_owned();
    let hasil = json!({
        "semester": semester,
        "id_tahun_ajaran": id,
        "guru": rows_json_with(&transaction, BEBAN_GURU_SQL, params![id])?,
        "jadwal": rows_json_with(&transaction, BEBAN_JADWAL_SQL, params![id])?,
        "tugas": rows_json_with(&transaction, BEBAN_TUGAS_SQL, params![awal, akhir])?,
        "penugasan": rows_json_with(&transaction, BEBAN_PENUGASAN_SQL, params![id])?,
        "status": rows_json_with(&transaction, hris::STATUS_KINI_SQL, params![akhir])?,
        "batas": batas,
        "hari_ini": hari_ini,
    });
    Ok(hasil)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Teks predikat `WHERE ... UNION` dan `WHERE ... ORDER BY` di
    /// `TUGAS_BERLAKU_SQL`; cermin pemeriksaan di `hr-beban.test.ts`.
    fn predikat_berlaku() -> (String, String) {
        let sql = hris::TUGAS_BERLAKU_SQL;
        let (tugas, wali) = sql.split_once(" UNION ").expect("union");
        let tugas = tugas
            .split_once(" WHERE ")
            .expect("where tugas")
            .1
            .to_owned();
        let wali = wali.split_once(" WHERE ").expect("where wali").1;
        let wali = wali.split_once(" ORDER BY ").expect("order").0.to_owned();
        (tugas, wali)
    }

    #[test]
    fn hr_beban_predikat_salinan_harfiah() {
        let (tugas, wali) = predikat_berlaku();
        assert!(tugas.starts_with("t.dibatalkan_pada IS NULL"), "{tugas}");
        assert!(wali.starts_with("r.is_aktif = 1"), "{wali}");
        assert!(BEBAN_TUGAS_SQL.contains(&format!(" WHERE {tugas} UNION ALL ")));
        assert!(BEBAN_TUGAS_SQL.contains(&format!(" WHERE {wali} ORDER BY ")));
        for sql in [BEBAN_JADWAL_SQL] {
            assert!(sql.contains("CAST(j.jam_ke AS INTEGER)"));
        }
    }

    fn state(dir: &std::path::Path) -> DesktopState {
        DesktopState {
            server_origin: std::sync::RwLock::new("http://localhost:3000".to_string()),
            offline_max_age_hours: 24,
            data_dir: dir.to_path_buf(),
            http: reqwest::Client::new(),
            turso_config: std::sync::RwLock::new(None),
            session: std::sync::Mutex::new(None),
            vault_lock: std::sync::Mutex::new(()),
        }
    }

    fn ids(v: &Value, kunci: &str, kolom: &str) -> Vec<String> {
        v[kunci]
            .as_array()
            .expect("array")
            .iter()
            .map(|r| r[kolom].as_str().unwrap_or_default().to_owned())
            .collect()
    }

    #[test]
    fn hr_beban_teaching_load_semester_dan_tugas() {
        let dir = tempfile::tempdir().expect("tempdir");
        storage::initialize(dir.path()).expect("schema");
        let c = storage::database(dir.path()).expect("db");
        c.execute_batch(
            "INSERT INTO akademik_tahun_ajaran (id_tahun_ajaran, nama_tahun, semester, tanggal_mulai, tanggal_selesai, is_aktif, created_at, updated_at) VALUES
               ('ta-lama', '2025/2026', 'Genap', '2026-01-05', '2026-06-20', 0, 'x', 'x'),
               ('ta-kini', '2026/2027', 'Ganjil', '2026-07-13', '2026-12-19', 1, 'x', 'x');
             INSERT INTO akademik_unit (id_unit, nama_unit) VALUES ('u-smp', 'SMP');
             INSERT INTO akademik_rombel (id_rombel, id_tahun_ajaran, tingkat, nama_rombel, id_wali_kelas, id_unit) VALUES
               ('R7A', 'ta-kini', 7, '7A', 'G1', 'u-smp'),
               ('R7B', 'ta-kini', 7, '7B', 'G1', 'u-smp'),
               ('R6A', 'ta-lama', 6, '6A', 'G2', NULL);
             INSERT INTO akademik_mapel (id_mapel, kode_mapel, nama_mapel, beban_jam) VALUES ('MTK', 'MTK', 'Matematika', 4);
             INSERT INTO master_data (id_unik, nama, divisi, id_shift, status_aktif) VALUES
               ('G1', 'Ani', 'Guru', 1, 'Aktif'), ('G2', 'Budi', 'Guru', 1, 'Nonaktif'), ('G3', 'Cici', 'Guru', 1, 'Nonaktif');
             INSERT INTO guru_data (id_guru, nip, created_at, updated_at) VALUES ('G1', '1985', 'x', 'x'), ('G2', '', 'x', 'x'), ('G3', '', 'x', 'x');
             INSERT INTO jadwal_mengajar (id_jadwal, id_tahun_ajaran, id_rombel, id_mapel, id_guru, hari, jam_ke, is_aktif, created_at, updated_at) VALUES
               ('J10', 'ta-kini', 'R7A', 'MTK', 'G1', 1, '10', 1, 'x', 'x'),
               ('J2', 'ta-kini', 'R7A', 'MTK', 'G1', 1, '2', 1, 'x', 'x'),
               ('J9', 'ta-lama', 'R7A', 'MTK', 'G1', 1, '3', 1, 'x', 'x'),
               ('JN', 'ta-kini', 'R7B', 'MTK', 'G2', 2, '1', 1, 'x', 'x'),
               ('JX', 'ta-kini', 'R7B', 'MTK', 'G1', 2, '5', 0, 'x', 'x');
             INSERT INTO akademik_guru_mapel (id_penugasan, id_tahun_ajaran, id_rombel, id_mapel, id_guru) VALUES
               ('P1', 'ta-kini', 'R7A', 'MTK', 'G1'), ('P9', 'ta-lama', 'R7A', 'MTK', 'G1');
             INSERT INTO hr_tugas_tambahan (id_tugas, id_karyawan, id_jenis, tahun_ajaran, ekuivalen_jp, tanggal_mulai, tanggal_selesai, dibatalkan_pada) VALUES
               ('t-ekskul-1', 'G1', 'tgs-pembina-ekskul', '2026/2027', NULL, '2026-07-13', NULL, NULL),
               ('t-ekskul-2', 'G1', 'tgs-pembina-ekskul', '2026/2027', 3, '2026-09-01', '2026-12-19', NULL),
               ('t-batal', 'G1', 'tgs-piket', '2026/2027', NULL, '2026-07-13', NULL, '2026-08-01 00:00:00'),
               ('t-lalu', 'G1', 'tgs-kalab', '2025/2026', NULL, '2026-01-05', '2026-06-20', NULL),
               ('t-wali', 'G1', 'tgs-wali-kelas', '2026/2027', 3, '2026-07-13', NULL, NULL);
             INSERT INTO hr_tugas_jenis (id_jenis, nama, ekuivalen_jp) VALUES
               ('tgs-pembina-ekskul', 'Pembina Ekstrakurikuler', 2), ('tgs-wali-kelas', 'Wali Kelas', 2), ('tgs-kalab', 'Kepala Laboratorium', 12), ('tgs-piket', 'Guru Piket', 1);
             INSERT INTO hr_tugas_tambahan (id_tugas, id_karyawan, id_jenis, tahun_ajaran, id_rombel, ekuivalen_jp, tanggal_mulai) VALUES
               ('t-wali-7a', 'G1', 'tgs-wali-kelas', '2026/2027', 'R7A', 3, '2026-07-13');",
        )
        .expect("fixture");
        drop(c);
        let st = state(dir.path());

        let v = teaching_load(&st, "").expect("bawaan semester aktif");
        assert_eq!(v["id_tahun_ajaran"], "ta-kini");
        assert_eq!(
            ids(&v, "guru", "id_unik"),
            vec!["G1", "G2"],
            "G3 nonaktif tanpa jadwal tidak ikut"
        );
        assert_eq!(
            ids(&v, "jadwal", "id_jadwal"),
            vec!["J2", "J10", "JN"],
            "semester lain dan jadwal nonaktif tidak ikut"
        );
        assert_eq!(v["jadwal"][0]["unit"], "SMP");
        assert_eq!(ids(&v, "penugasan", "id_guru"), vec!["G1"]);
        assert_eq!(v["penugasan"][0]["beban_jam"], 4);
        assert_eq!(
            ids(&v, "tugas", "id_tugas"),
            vec!["t-ekskul-1", "t-ekskul-2", "wali:R7A", "wali:R7B"],
            "tugas batal, semester lalu, dan baris SK wali tidak ikut"
        );
        let ekuivalen: Vec<i64> = v["tugas"]
            .as_array()
            .unwrap()
            .iter()
            .map(|t| t["ekuivalen_jp"].as_i64().unwrap())
            .collect();
        assert_eq!(
            ekuivalen,
            vec![2, 3, 3, 2],
            "kosong = jenis; wali 7A memakai baris SK-nya"
        );
        assert_eq!(v["batas"], json!({ "min": 24, "maks": 40 }));

        let lama = teaching_load(&st, "ta-lama").expect("semester lama");
        assert_eq!(ids(&lama, "jadwal", "id_jadwal"), vec!["J9"]);
        assert_eq!(ids(&lama, "tugas", "id_tugas"), vec!["t-lalu", "wali:R6A"]);
        assert!(teaching_load(&st, "ta-hilang").is_err());
    }
}
