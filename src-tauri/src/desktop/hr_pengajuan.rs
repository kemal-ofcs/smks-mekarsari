//! HRIS Fase 2 (`prd-hris.md` §20): pengajuan cuti, izin, sakit, dan dinas
//! luar beserta keputusannya.
//!
//! Isi pengajuan diikat sidik (`sidik_pengajuan`); keputusan append-only
//! membawa sidik yang dilihat pemutus, jadi suntingan sesudah diputus
//! menggugurkan keputusan itu tanpa ada event yang ditolak. Status TIDAK
//! disimpan: diturunkan `status_pengajuan` dan, di SQL, `PENGAJUAN_BERLAKU_SQL`.
//! Cloud tidak pernah menolak keputusan (`ON CONFLICT DO NOTHING`).
//!
//! Aturan murni, pesan, dan SQL di berkas ini dicerminkan
//! `src/lib/validations/hr-pengajuan.ts`; vektornya
//! `validations/hr-pengajuan.vektor.json`, teks SQL dibandingkan harfiah oleh
//! `hr-pengajuan.test.ts`.

use std::collections::{BTreeMap, HashMap, HashSet};

use rusqlite::{params, OptionalExtension, Transaction};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use super::class_attendance::jam_ke_range;
use super::hari_kerja::{hari_iso, parse_hari_kerja, tanggal_valid, wajib_masuk};
use super::hris::{self, rows_json_with};
use super::scanner::{evaluate_holiday_scan, HolidayWhitelistEntry};
use super::time_policy::{add_days, days_between};
use super::{config::DesktopState, models::CommandError, models::OperatorUser, storage, sync};

pub const KELOMPOK: [&str; 4] = ["Cuti", "Izin", "Sakit", "Dinas Luar"];
pub const DAMPAK_GAJI: [&str; 3] = ["Dibayar", "Potong Gaji", "Tidak Berpengaruh"];
pub const SATUAN_MAKS: [&str; 2] = ["Hari Kerja", "Hari Kalender"];
pub const IZIN_PEMUTUS: [&str; 2] = ["hr.request.decide", "hr.request.decide_major"];
pub const KEPUTUSAN_FINAL: [&str; 3] = ["Setujui", "Tolak", "Setujui Urgent"];
pub const AKSI_KEPUTUSAN: [&str; 4] = ["Setujui", "Tolak", "Diketahui", "Batal"];
pub const MAKS_ALASAN: usize = 500;
pub const MAKS_RENTANG_HARI: i64 = 366;
pub const MAKS_HARI_JENIS: i64 = 366;
pub const MAKS_JAM_KE: i64 = 20;

const PESAN_IZIN_PUTUS: &str = "Kamu tidak punya izin memutus jenis pengajuan ini.";
const PESAN_DIRI_SENDIRI: &str = "Pengajuan untuk dirimu sendiri harus diputus orang lain.";
const PESAN_CAKUPAN: &str = "Pegawai ini di luar unit yang kamu pegang.";

// SQL kembar (teks identik dengan TS)

/// Predikat "pengajuan berlaku" (Disetujui / Disetujui (urgent)) atas alias
/// `p`. Dipakai SEMUA pembaca (Alfa, audit, laporan, gaji, jatah); tidak ada
/// kueri status lain. Disalin harfiah ke setiap kueri turunannya.
#[cfg_attr(not(test), allow(dead_code))]
pub const PENGAJUAN_BERLAKU_SQL: &str = "NOT EXISTS (SELECT 1 FROM hr_pengajuan_keputusan b WHERE b.id_pengajuan = p.id_pengajuan AND b.jenis = 'Batal') AND (SELECT k.jenis FROM hr_pengajuan_keputusan k WHERE k.id_pengajuan = p.id_pengajuan AND k.sidik = p.sidik AND k.jenis IN ('Setujui', 'Tolak', 'Setujui Urgent') ORDER BY k.diterima_cloud IS NULL, k.diterima_cloud, k.waktu_perangkat, k.id_keputusan LIMIT 1) IN ('Setujui', 'Setujui Urgent')";
/// Pengajuan berlaku yang bertumpuk dengan `?1`..`?2`.
pub const PENGAJUAN_RENTANG_SQL: &str = "SELECT p.id_pengajuan, p.id_karyawan, p.tanggal_mulai, p.tanggal_selesai, p.kelompok, p.dampak_gaji, p.potong_jatah, p.jam_mulai_ke, p.jam_sampai_ke, p.setengah_hari FROM hr_pengajuan p WHERE p.tanggal_mulai <= ?2 AND p.tanggal_selesai >= ?1 AND NOT EXISTS (SELECT 1 FROM hr_pengajuan_keputusan b WHERE b.id_pengajuan = p.id_pengajuan AND b.jenis = 'Batal') AND (SELECT k.jenis FROM hr_pengajuan_keputusan k WHERE k.id_pengajuan = p.id_pengajuan AND k.sidik = p.sidik AND k.jenis IN ('Setujui', 'Tolak', 'Setujui Urgent') ORDER BY k.diterima_cloud IS NULL, k.diterima_cloud, k.waktu_perangkat, k.id_keputusan LIMIT 1) IN ('Setujui', 'Setujui Urgent') ORDER BY p.id_karyawan, p.tanggal_mulai, p.id_pengajuan;";
/// Proses gaji `PAID` yang periodenya menyentuh `?1`..`?2` (Q-52).
pub const PERIODE_DIBAYAR_SQL: &str = "SELECT period_start, period_end FROM payroll_runs WHERE status = 'PAID' AND period_start <= ?2 AND period_end >= ?1 ORDER BY period_start LIMIT 1;";
/// Proses gaji yang belum dibayar dan tidak ditolak: hanya peringatan.
pub const PERIODE_PERLU_ULANG_SQL: &str = "SELECT period_start, period_end FROM payroll_runs WHERE status NOT IN ('PAID', 'REJECTED') AND period_start <= ?2 AND period_end >= ?1 ORDER BY period_start LIMIT 1;";
/// Pengajuan Menunggu atau berlaku lain milik `?1` (bukan `?2`) yang
/// bertumpuk dengan `?3`..`?4`. Irisan jam dinilai `bentrok_pengajuan`.
pub const PENGAJUAN_AKTIF_ORANG_SQL: &str = "SELECT p.id_pengajuan, p.id_karyawan, p.tanggal_mulai, p.tanggal_selesai, p.jam_mulai_ke, p.jam_sampai_ke FROM hr_pengajuan p WHERE p.id_karyawan = ?1 AND p.id_pengajuan <> ?2 AND p.tanggal_mulai <= ?4 AND p.tanggal_selesai >= ?3 AND NOT EXISTS (SELECT 1 FROM hr_pengajuan_keputusan b WHERE b.id_pengajuan = p.id_pengajuan AND b.jenis = 'Batal') AND COALESCE((SELECT k.jenis FROM hr_pengajuan_keputusan k WHERE k.id_pengajuan = p.id_pengajuan AND k.sidik = p.sidik AND k.jenis IN ('Setujui', 'Tolak', 'Setujui Urgent') ORDER BY k.diterima_cloud IS NULL, k.diterima_cloud, k.waktu_perangkat, k.id_keputusan LIMIT 1), '') <> 'Tolak' ORDER BY p.tanggal_mulai, p.id_pengajuan;";
/// Jenis bawaan: `INSERT OR IGNORE`, jenis yang sudah disunting tidak ditimpa.
pub const SEED_JENIS_SQL: &str = "INSERT OR IGNORE INTO hr_jenis_pengajuan (id_jenis, nama, kelompok, izin_pemutus, boleh_urgent, potong_jatah, wajib_dokumen, dampak_gaji, maks_hari, satuan_maks, is_aktif) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, 1);";
pub const SIMPAN_JENIS_SQL: &str = "INSERT INTO hr_jenis_pengajuan (id_jenis, nama, kelompok, izin_pemutus, boleh_urgent, potong_jatah, wajib_dokumen, dampak_gaji, maks_hari, satuan_maks, is_aktif, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, datetime('now'), datetime('now')) ON CONFLICT(id_jenis) DO UPDATE SET nama = excluded.nama, kelompok = excluded.kelompok, izin_pemutus = excluded.izin_pemutus, boleh_urgent = excluded.boleh_urgent, potong_jatah = excluded.potong_jatah, wajib_dokumen = excluded.wajib_dokumen, dampak_gaji = excluded.dampak_gaji, maks_hari = excluded.maks_hari, satuan_maks = excluded.satuan_maks, is_aktif = excluded.is_aktif, updated_at = excluded.updated_at;";
/// ?1 = nama ternormalisasi, ?2 = id jenis yang disimpan.
pub const BENTROK_JENIS_SQL: &str =
    "SELECT 1 FROM hr_jenis_pengajuan WHERE lower(nama) = lower(?1) AND id_jenis <> ?2 LIMIT 1;";
pub const JENIS_SQL: &str = "SELECT id_jenis, nama, kelompok, izin_pemutus, boleh_urgent, potong_jatah, wajib_dokumen, dampak_gaji, maks_hari, satuan_maks, is_aktif FROM hr_jenis_pengajuan ORDER BY is_aktif DESC, kelompok, nama, id_jenis\n-- batas: daftar jenis pengajuan sekolah, tidak tumbuh per hari\n;";
/// Upsert penuh; `diajukan_oleh` tidak berubah saat disunting.
pub const SIMPAN_PENGAJUAN_SQL: &str = "INSERT INTO hr_pengajuan (id_pengajuan, id_karyawan, id_jenis, kelompok, potong_jatah, dampak_gaji, izin_pemutus, tanggal_mulai, tanggal_selesai, jam_mulai_ke, jam_sampai_ke, setengah_hari, alasan, sidik, diajukan_oleh, waktu_perangkat, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, datetime('now'), datetime('now')) ON CONFLICT(id_pengajuan) DO UPDATE SET id_karyawan = excluded.id_karyawan, id_jenis = excluded.id_jenis, kelompok = excluded.kelompok, potong_jatah = excluded.potong_jatah, dampak_gaji = excluded.dampak_gaji, izin_pemutus = excluded.izin_pemutus, tanggal_mulai = excluded.tanggal_mulai, tanggal_selesai = excluded.tanggal_selesai, jam_mulai_ke = excluded.jam_mulai_ke, jam_sampai_ke = excluded.jam_sampai_ke, setengah_hari = excluded.setengah_hari, alasan = excluded.alasan, sidik = excluded.sidik, waktu_perangkat = excluded.waktu_perangkat, updated_at = excluded.updated_at;";
/// Keputusan di perangkat: `diterima_cloud` kosong sampai tertarik lagi.
pub const SIMPAN_KEPUTUSAN_SQL: &str = "INSERT OR IGNORE INTO hr_pengajuan_keputusan (id_keputusan, id_pengajuan, jenis, sidik, alasan, oleh, id_karyawan_oleh, waktu_perangkat, diterima_cloud, created_at) VALUES (?1, ?2, ?3, ?4, NULLIF(?5, ''), ?6, NULLIF(?7, ''), ?8, NULL, datetime('now'));";
/// Keputusan di cloud (handler dan Web): yang pertama sampai berlaku.
pub const CLOUD_KEPUTUSAN_SQL: &str = "INSERT INTO hr_pengajuan_keputusan (id_keputusan, id_pengajuan, jenis, sidik, alasan, oleh, id_karyawan_oleh, waktu_perangkat, diterima_cloud, created_at) VALUES (?1, ?2, ?3, ?4, NULLIF(?5, ''), ?6, NULLIF(?7, ''), ?8, datetime('now'), datetime('now')) ON CONFLICT(id_keputusan) DO NOTHING;";
/// ?1 = dari, ?2 = sampai. Pengajuan tanpa keputusan apa pun selalu ikut,
/// supaya yang menunggu lama tidak hilang dari daftar.
pub const DAFTAR_PENGAJUAN_SQL: &str = "SELECT p.id_pengajuan, p.id_karyawan, COALESCE(m.nama, p.id_karyawan) AS nama, COALESCE(m.unit, '') AS unit, CASE WHEN EXISTS (SELECT 1 FROM guru_data g WHERE g.id_guru = p.id_karyawan) THEN 1 ELSE 0 END AS guru, p.id_jenis, COALESCE(j.nama, p.id_jenis) AS nama_jenis, p.kelompok, p.potong_jatah, p.dampak_gaji, p.izin_pemutus, p.tanggal_mulai, p.tanggal_selesai, p.jam_mulai_ke, p.jam_sampai_ke, p.setengah_hari, p.alasan, p.sidik, p.diajukan_oleh, p.waktu_perangkat FROM hr_pengajuan p LEFT JOIN master_data m ON m.id_unik = p.id_karyawan LEFT JOIN hr_jenis_pengajuan j ON j.id_jenis = p.id_jenis WHERE (p.tanggal_mulai <= ?2 AND p.tanggal_selesai >= ?1) OR NOT EXISTS (SELECT 1 FROM hr_pengajuan_keputusan k WHERE k.id_pengajuan = p.id_pengajuan) ORDER BY p.tanggal_mulai DESC, p.id_pengajuan LIMIT 1000;";
/// ?1 = larik JSON id pengajuan.
pub const DAFTAR_KEPUTUSAN_SQL: &str = "SELECT k.id_keputusan, k.id_pengajuan, k.jenis, k.sidik, COALESCE(k.alasan, '') AS alasan, k.oleh, COALESCE(k.id_karyawan_oleh, '') AS id_karyawan_oleh, COALESCE(mo.unit, '') AS unit_oleh, k.waktu_perangkat, k.diterima_cloud FROM hr_pengajuan_keputusan k LEFT JOIN master_data mo ON mo.id_unik = k.id_karyawan_oleh WHERE k.id_pengajuan IN (SELECT value FROM json_each(?1)) ORDER BY k.id_pengajuan, k.created_at, k.id_keputusan;";
/// Pegawai aktif untuk form ajukan.
pub const PEGAWAI_PENGAJUAN_SQL: &str = "SELECT m.id_unik, m.nama, COALESCE(m.unit, '') AS unit, CASE WHEN EXISTS (SELECT 1 FROM guru_data g WHERE g.id_guru = m.id_unik) THEN 1 ELSE 0 END AS guru FROM master_data m WHERE COALESCE(m.status_aktif, 'Aktif') = 'Aktif' AND LOWER(TRIM(COALESCE(m.jenis_personil, ''))) <> 'siswa' AND NOT EXISTS (SELECT 1 FROM siswa_data sd WHERE sd.id_siswa = m.id_unik) ORDER BY m.nama, m.id_unik\n-- batas: pegawai aktif, dibatasi jumlah pegawai sekolah\n;";
/// Satu pegawai (bukan siswa) + jadwal shift kininya.
pub const PEGAWAI_SATU_SQL: &str = "SELECT COALESCE(m.unit, '') AS unit, CASE WHEN EXISTS (SELECT 1 FROM guru_data g WHERE g.id_guru = m.id_unik) THEN 1 ELSE 0 END AS guru, COALESCE(m.divisi, '') AS divisi, s.hari_kerja, s.kode_shift FROM master_data m LEFT JOIN tbl_shift s ON s.id_shift = m.id_shift WHERE m.id_unik = ?1 AND LOWER(TRIM(COALESCE(m.jenis_personil, ''))) <> 'siswa' AND NOT EXISTS (SELECT 1 FROM siswa_data sd WHERE sd.id_siswa = m.id_unik);";
/// Unit personil yang tertaut ke sesi (A-5).
pub const UNIT_PERSONIL_SQL: &str =
    "SELECT COALESCE(unit, '') AS unit FROM master_data WHERE id_unik = ?1;";
/// Batas JP unit bernama ?1 dan batas sekolah (`jp_max_for_unit`).
pub const JP_MAX_SQL: &str = "SELECT (SELECT s.value FROM akademik_unit u JOIN setting_gex_system s ON s.key = 'jp_max_per_hari:' || u.id_unit WHERE lower(trim(u.nama_unit)) = lower(trim(?1)) ORDER BY u.status_aktif DESC, u.id_unit LIMIT 1) AS unit, (SELECT value FROM setting_gex_system WHERE key = 'jp_max_per_hari') AS sekolah;";
pub const LIBUR_SQL: &str = "SELECT tanggal FROM tbl_hari_libur WHERE status_aktif = 1 AND tanggal >= ?1 AND tanggal <= ?2;";
pub const WHITELIST_SQL: &str = "SELECT id, scope_type, scope_value, tanggal_libur, status_aktif FROM hari_libur_whitelist WHERE status_aktif = 1\n-- batas: daftar pengecualian libur, tidak tumbuh per hari\n;";
pub const PENGAJUAN_SATU_SQL: &str = "SELECT id_pengajuan, id_karyawan, id_jenis, kelompok, potong_jatah, dampak_gaji, izin_pemutus, tanggal_mulai, tanggal_selesai, jam_mulai_ke, jam_sampai_ke, setengah_hari, alasan, sidik, diajukan_oleh, waktu_perangkat FROM hr_pengajuan WHERE id_pengajuan = ?1;";
pub const KEPUTUSAN_SATU_SQL: &str = "SELECT id_keputusan, jenis, sidik, oleh, waktu_perangkat, diterima_cloud FROM hr_pengajuan_keputusan WHERE id_pengajuan = ?1 ORDER BY created_at, id_keputusan\n-- batas: satu sampai tiga keputusan per pengajuan\n;";
pub const WAKTU_SQL: &str =
    "SELECT datetime('now', '+7 hours') AS waktu, date('now', '+7 hours') AS hari_ini;";

// Rute 2b/2c, didaftarkan sejak v69 karena tabelnya lahir bersama. TS
// mendapat kembarannya bersama layar yang menulisnya.
pub const CLOUD_PENYESUAIAN_SQL: &str = "INSERT INTO hr_cuti_penyesuaian (id_penyesuaian, id_karyawan, periode, jenis, id_ref, hari, alasan, dicatat_oleh, created_at) VALUES (?1, ?2, ?3, ?4, NULLIF(?5, ''), ?6, ?7, ?8, datetime('now')) ON CONFLICT(id_penyesuaian) DO NOTHING;";
pub const CLOUD_PENANGANAN_SQL: &str = "INSERT INTO hr_jp_penanganan (id_penanganan, id_pengajuan, tanggal, id_jadwal, id_rombel, id_mapel, jam_ke, status, id_guru_pengganti, catatan, dicatat_oleh, waktu_perangkat, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, NULLIF(?5, ''), NULLIF(?6, ''), NULLIF(?7, ''), ?8, NULLIF(?9, ''), NULLIF(?10, ''), ?11, ?12, datetime('now'), datetime('now')) ON CONFLICT(id_penanganan) DO UPDATE SET id_rombel = excluded.id_rombel, id_mapel = excluded.id_mapel, jam_ke = excluded.jam_ke, status = excluded.status, id_guru_pengganti = excluded.id_guru_pengganti, catatan = excluded.catatan, dicatat_oleh = excluded.dicatat_oleh, waktu_perangkat = excluded.waktu_perangkat, updated_at = excluded.updated_at;";

// Jenis bawaan

const JENIS_BAWAAN_JSON: &str = include_str!("../../../src/lib/validations/hr-jenis-bawaan.json");

#[derive(Debug, Clone, Deserialize)]
pub struct JenisBawaan {
    pub id_jenis: String,
    pub nama: String,
    pub kelompok: String,
    pub izin_pemutus: String,
    pub boleh_urgent: bool,
    pub potong_jatah: bool,
    pub dampak_gaji: String,
    pub maks_hari: Option<i64>,
    pub satuan_maks: String,
    pub wajib_dokumen: bool,
}

/// Jenis bawaan §20.2.2, berkas yang sama dengan seed Web.
pub fn jenis_bawaan() -> Vec<JenisBawaan> {
    serde_json::from_str(JENIS_BAWAAN_JSON).expect("hr-jenis-bawaan.json sah")
}

/// Argumen `SEED_JENIS_SQL`. Cermin `seedJenisArgs`.
pub fn seed_jenis_args(j: &JenisBawaan) -> Vec<Value> {
    vec![
        json!(j.id_jenis),
        json!(j.nama),
        json!(j.kelompok),
        json!(j.izin_pemutus),
        json!(i64::from(j.boleh_urgent)),
        json!(i64::from(j.potong_jatah)),
        json!(i64::from(j.wajib_dokumen)),
        json!(j.dampak_gaji),
        json!(j.maks_hari),
        json!(j.satuan_maks),
    ]
}

/// Seed lokal tanpa outbox: jenis bawaan berid tetap juga ada di cloud.
pub fn seed_jenis_lokal(connection: &rusqlite::Connection) -> rusqlite::Result<()> {
    for jenis in jenis_bawaan() {
        connection.execute(
            SEED_JENIS_SQL,
            params![
                jenis.id_jenis,
                jenis.nama,
                jenis.kelompok,
                jenis.izin_pemutus,
                i64::from(jenis.boleh_urgent),
                i64::from(jenis.potong_jatah),
                i64::from(jenis.wajib_dokumen),
                jenis.dampak_gaji,
                jenis.maks_hari,
                jenis.satuan_maks,
            ],
        )?;
    }
    Ok(())
}

// Pembantu isian

/// Cermin `teks`: string dirapikan, angka ditulis ulang, lainnya kosong.
fn teks(draft: &Value, kunci: &str) -> String {
    match draft.get(kunci) {
        Some(Value::String(s)) => s.trim().to_owned(),
        Some(Value::Number(n)) => n.to_string(),
        _ => String::new(),
    }
}

/// Cermin `bendera`: hanya `true` atau `1`.
fn bendera(draft: &Value, kunci: &str) -> bool {
    match draft.get(kunci) {
        Some(Value::Bool(b)) => *b,
        Some(v) => v.as_i64() == Some(1),
        None => false,
    }
}

/// Cermin `angkaOpsional`: kosong = `Ok(None)`, bilangan bulat dalam
/// `min..=maks` = `Ok(Some)`, selain itu `Err`.
fn angka_opsional(draft: &Value, kunci: &str, min: i64, maks: i64) -> Result<Option<i64>, ()> {
    match draft.get(kunci) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(s)) if s.trim().is_empty() => Ok(None),
        Some(v) => v
            .as_i64()
            .filter(|n| (min..=maks).contains(n))
            .map(Some)
            .ok_or(()),
    }
}

fn panjang(teks: &str) -> usize {
    teks.chars().count()
}

/// Cermin `tanggalRentang`: inklusif, paling banyak 400 tanggal.
pub fn tanggal_rentang(mulai: &str, selesai: &str) -> Vec<String> {
    let mut hasil = Vec::new();
    let mut t = mulai.to_owned();
    while t.as_str() <= selesai && hasil.len() < 400 {
        hasil.push(t.clone());
        match add_days(&t, 1) {
            Ok(berikut) => t = berikut,
            Err(_) => break,
        }
    }
    hasil
}

// Jenis pengajuan

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct JenisPengajuan {
    pub nama: String,
    pub kelompok: String,
    pub izin_pemutus: String,
    pub boleh_urgent: bool,
    pub potong_jatah: bool,
    pub dampak_gaji: String,
    pub maks_hari: Option<i64>,
    pub satuan_maks: String,
    pub wajib_dokumen: bool,
    pub is_aktif: bool,
}

/// Cermin `validasiJenis`. Id diurus pemanggil.
pub fn validasi_jenis(draft: &Value) -> Result<JenisPengajuan, String> {
    let nama = hris::validasi_nama_master(&teks(draft, "nama"), "jenis pengajuan")?;
    let kelompok = teks(draft, "kelompok");
    if !KELOMPOK.contains(&kelompok.as_str()) {
        return Err("Kelompok harus Cuti, Izin, Sakit, atau Dinas Luar.".into());
    }
    let mut izin_pemutus = teks(draft, "izin_pemutus");
    if izin_pemutus.is_empty() {
        izin_pemutus = IZIN_PEMUTUS[0].to_owned();
    }
    if !IZIN_PEMUTUS.contains(&izin_pemutus.as_str()) {
        return Err("Pemutus pengajuan tidak dikenal.".into());
    }
    let dampak_gaji = teks(draft, "dampak_gaji");
    if !DAMPAK_GAJI.contains(&dampak_gaji.as_str()) {
        return Err("Dampak gaji tidak dikenal.".into());
    }
    let mut satuan_maks = teks(draft, "satuan_maks");
    if satuan_maks.is_empty() {
        satuan_maks = SATUAN_MAKS[0].to_owned();
    }
    if !SATUAN_MAKS.contains(&satuan_maks.as_str()) {
        return Err("Satuan batas hari tidak dikenal.".into());
    }
    let potong_jatah = bendera(draft, "potong_jatah");
    if potong_jatah && kelompok != "Cuti" {
        return Err("Hanya kelompok Cuti yang bisa memotong jatah cuti.".into());
    }
    let maks_hari = angka_opsional(draft, "maks_hari", 1, MAKS_HARI_JENIS)
        .map_err(|_| format!("Batas hari harus 1 sampai {MAKS_HARI_JENIS}."))?;
    Ok(JenisPengajuan {
        nama,
        kelompok,
        izin_pemutus,
        boleh_urgent: bendera(draft, "boleh_urgent"),
        potong_jatah,
        dampak_gaji,
        maks_hari,
        satuan_maks,
        wajib_dokumen: bendera(draft, "wajib_dokumen"),
        is_aktif: draft.get("is_aktif").is_none() || bendera(draft, "is_aktif"),
    })
}

// Isian pengajuan

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PengajuanSah {
    pub id_karyawan: String,
    pub id_jenis: String,
    pub tanggal_mulai: String,
    pub tanggal_selesai: String,
    pub jam_mulai_ke: Option<i64>,
    pub jam_sampai_ke: Option<i64>,
    pub setengah_hari: bool,
    pub alasan: String,
    pub urgent: bool,
}

/// Cermin `validasiPengajuan`: kelengkapan isian, tanpa data jenis.
pub fn validasi_pengajuan(draft: &Value) -> Result<PengajuanSah, String> {
    let id_karyawan = teks(draft, "id_karyawan");
    if id_karyawan.is_empty() {
        return Err("Pilih pegawai.".into());
    }
    let id_jenis = teks(draft, "id_jenis");
    if id_jenis.is_empty() {
        return Err("Pilih jenis pengajuan.".into());
    }
    let mulai = teks(draft, "tanggal_mulai");
    let selesai = teks(draft, "tanggal_selesai");
    if !tanggal_valid(&mulai) || !tanggal_valid(&selesai) {
        return Err("Tanggal pengajuan tidak valid.".into());
    }
    if selesai < mulai {
        return Err("Tanggal selesai tidak boleh sebelum tanggal mulai.".into());
    }
    if days_between(&mulai, &selesai).unwrap_or(i64::MAX) >= MAKS_RENTANG_HARI {
        return Err(format!(
            "Rentang pengajuan paling panjang {MAKS_RENTANG_HARI} hari."
        ));
    }
    let pesan_jam = || format!("Jam ke-N harus angka 1 sampai {MAKS_JAM_KE}.");
    let jam_mulai_ke =
        angka_opsional(draft, "jam_mulai_ke", 1, MAKS_JAM_KE).map_err(|_| pesan_jam())?;
    let jam_sampai_ke =
        angka_opsional(draft, "jam_sampai_ke", 1, MAKS_JAM_KE).map_err(|_| pesan_jam())?;
    let setengah_hari = bendera(draft, "setengah_hari");
    if setengah_hari && mulai != selesai {
        return Err("Setengah hari hanya untuk satu tanggal.".into());
    }
    if setengah_hari && (jam_mulai_ke.is_some() || jam_sampai_ke.is_some()) {
        return Err("Pilih setengah hari atau jam ke-N, tidak keduanya.".into());
    }
    if let (Some(a), Some(b)) = (jam_mulai_ke, jam_sampai_ke) {
        if mulai == selesai && b < a {
            return Err("Jam selesai tidak boleh sebelum jam mulai.".into());
        }
    }
    let alasan = teks(draft, "alasan");
    if alasan.is_empty() {
        return Err("Alasan wajib diisi.".into());
    }
    if panjang(&alasan) > MAKS_ALASAN {
        return Err(format!("Alasan maksimal {MAKS_ALASAN} karakter."));
    }
    Ok(PengajuanSah {
        id_karyawan,
        id_jenis,
        tanggal_mulai: mulai,
        tanggal_selesai: selesai,
        jam_mulai_ke,
        jam_sampai_ke,
        setengah_hari,
        alasan,
        urgent: bendera(draft, "urgent"),
    })
}

/// Cermin `periksaJenis`. `guru` = punya `guru_data` (Q-24); `jp_max` =
/// batas JP unit pegawai (`jp_max_for_unit`).
pub fn periksa_jenis(
    p: &PengajuanSah,
    jenis: &JenisPengajuan,
    guru: bool,
    jp_max: i64,
) -> Result<(), String> {
    if !jenis.is_aktif {
        return Err("Jenis pengajuan ini sudah nonaktif.".into());
    }
    if p.urgent && !jenis.boleh_urgent {
        return Err("Jenis pengajuan ini tidak boleh urgent.".into());
    }
    if p.setengah_hari {
        if jenis.kelompok != "Izin" {
            return Err("Setengah hari hanya untuk kelompok Izin.".into());
        }
        if guru {
            return Err("Guru memakai jam ke-N, bukan setengah hari.".into());
        }
    }
    let jam = [p.jam_mulai_ke, p.jam_sampai_ke];
    if jam.iter().any(Option::is_some) {
        if !guru {
            return Err("Jam ke-N hanya untuk guru.".into());
        }
        if jenis.kelompok == "Cuti" {
            return Err("Cuti selalu hari penuh.".into());
        }
        if jam.iter().flatten().any(|n| *n > jp_max) {
            return Err(format!("Jam ke-N paling besar {jp_max}."));
        }
    }
    Ok(())
}

/// Cermin `periksaMaks`.
pub fn periksa_maks(
    jenis: &JenisPengajuan,
    hari_kerja: i64,
    hari_kalender: i64,
) -> Result<(), String> {
    let Some(maks) = jenis.maks_hari else {
        return Ok(());
    };
    let kalender = jenis.satuan_maks == "Hari Kalender";
    let jumlah = if kalender { hari_kalender } else { hari_kerja };
    if jumlah > maks {
        let satuan = if kalender {
            "hari kalender"
        } else {
            "hari kerja"
        };
        return Err(format!("{} paling lama {maks} {satuan}.", jenis.nama));
    }
    Ok(())
}

// Sidik

/// Isi yang ikut sidik: salinan jenis saat diajukan + isian.
#[derive(Debug, Clone, Deserialize)]
pub struct IsiPengajuan {
    pub id_karyawan: String,
    pub id_jenis: String,
    pub kelompok: String,
    pub potong_jatah: bool,
    pub dampak_gaji: String,
    pub izin_pemutus: String,
    pub tanggal_mulai: String,
    pub tanggal_selesai: String,
    pub jam_mulai_ke: Option<i64>,
    pub jam_sampai_ke: Option<i64>,
    pub setengah_hari: bool,
    pub alasan: String,
}

/// Cermin `kanonikPengajuan`: bagian dipisah `\u{1f}`, karakter yang tidak
/// bisa diketik di isian mana pun.
pub fn kanonik_pengajuan(isi: &IsiPengajuan) -> String {
    let angka = |n: Option<i64>| n.map(|n| n.to_string()).unwrap_or_default();
    [
        isi.id_karyawan.clone(),
        isi.id_jenis.clone(),
        isi.kelompok.clone(),
        if isi.potong_jatah { "1" } else { "0" }.to_owned(),
        isi.dampak_gaji.clone(),
        isi.izin_pemutus.clone(),
        isi.tanggal_mulai.clone(),
        isi.tanggal_selesai.clone(),
        angka(isi.jam_mulai_ke),
        angka(isi.jam_sampai_ke),
        if isi.setengah_hari { "1" } else { "0" }.to_owned(),
        isi.alasan.clone(),
    ]
    .join("\u{1f}")
}

/// Cermin `sidikPengajuan` (`services/hr-pengajuan.ts`): SHA-256 heks.
pub fn sidik_pengajuan(isi: &IsiPengajuan) -> String {
    hex::encode(Sha256::digest(kanonik_pengajuan(isi).as_bytes()))
}

// Status dan tanda

#[derive(Debug, Clone, Deserialize)]
pub struct Keputusan {
    pub id_keputusan: String,
    pub jenis: String,
    pub sidik: String,
    pub oleh: String,
    pub waktu_perangkat: String,
    #[serde(default)]
    pub diterima_cloud: Option<String>,
}

/// Cermin `urutKeputusan`, sama dengan ORDER BY `PENGAJUAN_BERLAKU_SQL`.
pub fn urut_keputusan(a: &Keputusan, b: &Keputusan) -> std::cmp::Ordering {
    a.diterima_cloud
        .is_none()
        .cmp(&b.diterima_cloud.is_none())
        .then_with(|| a.diterima_cloud.cmp(&b.diterima_cloud))
        .then_with(|| a.waktu_perangkat.cmp(&b.waktu_perangkat))
        .then_with(|| a.id_keputusan.cmp(&b.id_keputusan))
}

fn final_(k: &Keputusan) -> bool {
    KEPUTUSAN_FINAL.contains(&k.jenis.as_str())
}

/// Cermin `keputusanBerlaku`: keputusan final pertama bersidik sama.
pub fn keputusan_berlaku<'a>(sidik: &str, keputusan: &'a [Keputusan]) -> Option<&'a Keputusan> {
    keputusan
        .iter()
        .filter(|k| final_(k) && k.sidik == sidik)
        .min_by(|a, b| urut_keputusan(a, b))
}

/// Cermin `statusPengajuan`.
pub fn status_pengajuan(sidik: &str, keputusan: &[Keputusan]) -> &'static str {
    if keputusan.iter().any(|k| k.jenis == "Batal") {
        return "Dibatalkan";
    }
    match keputusan_berlaku(sidik, keputusan).map(|k| k.jenis.as_str()) {
        Some("Tolak") => "Ditolak",
        Some("Setujui") => "Disetujui",
        Some("Setujui Urgent") => "Disetujui (urgent)",
        _ => "Menunggu",
    }
}

pub fn status_berlaku(status: &str) -> bool {
    status == "Disetujui" || status == "Disetujui (urgent)"
}

pub(crate) fn sama_orang(a: &str, b: &str) -> bool {
    a.trim().to_lowercase() == b.trim().to_lowercase()
}

/// Cermin `tandaKeputusan`. `cakupan_berlaku` = keputusan yang berlaku
/// dibuat pemutus yang (kini) dalam cakupan unit pegawai; `None` = tidak
/// diketahui (pemutus tanpa tautan personil).
pub fn tanda_keputusan(
    sidik: &str,
    diajukan_oleh: &str,
    keputusan: &[Keputusan],
    cakupan_berlaku: Option<bool>,
) -> Vec<&'static str> {
    let status = status_pengajuan(sidik, keputusan);
    let mut tanda = Vec::new();
    if status == "Disetujui (urgent)" && !keputusan.iter().any(|k| k.jenis == "Diketahui") {
        tanda.push("perlu_diketahui");
    }
    let finals: Vec<&Keputusan> = keputusan.iter().filter(|k| final_(k)).collect();
    let sah: Vec<&&Keputusan> = finals.iter().filter(|k| k.sidik == sidik).collect();
    if sah.iter().any(|k| k.jenis == "Tolak") && sah.iter().any(|k| k.jenis != "Tolak") {
        tanda.push("keputusan_ganda");
    }
    if status != "Dibatalkan" && !finals.is_empty() && sah.is_empty() {
        tanda.push("keputusan_gugur");
    }
    if status != "Dibatalkan" && status != "Menunggu" {
        if let Some(berlaku) = keputusan_berlaku(sidik, keputusan) {
            // Urgent memang diputus pengajunya; Q-57 hanya Setujui/Tolak.
            if berlaku.jenis != "Setujui Urgent" && sama_orang(&berlaku.oleh, diajukan_oleh) {
                tanda.push("diputus_sendiri");
            }
        }
        if cakupan_berlaku == Some(false) {
            tanda.push("di_luar_cakupan");
        }
    }
    tanda
}

// Bertumpuk, hari wajib, cakupan

#[derive(Debug, Clone, Deserialize)]
pub struct Ringkas {
    pub id_karyawan: String,
    pub tanggal_mulai: String,
    pub tanggal_selesai: String,
    #[serde(default)]
    pub jam_mulai_ke: Option<i64>,
    #[serde(default)]
    pub jam_sampai_ke: Option<i64>,
}

/// Jam ke-N yang ditutup pengajuan pada tanggal `t` (inklusif).
fn jam_pada(r: &Ringkas, t: &str) -> (i64, i64) {
    let awal = if t == r.tanggal_mulai {
        r.jam_mulai_ke.unwrap_or(1)
    } else {
        1
    };
    let akhir = if t == r.tanggal_selesai {
        r.jam_sampai_ke.unwrap_or(i64::MAX)
    } else {
        i64::MAX
    };
    (awal, akhir)
}

/// Cermin `bentrokPengajuan`: orang sama, tanggal beririsan, dan jam ke-N
/// beririsan di salah satu tanggal irisannya. Setengah hari = hari penuh.
pub fn bentrok_pengajuan(a: &Ringkas, b: &Ringkas) -> bool {
    if a.id_karyawan.trim() != b.id_karyawan.trim() {
        return false;
    }
    let mulai = a.tanggal_mulai.as_str().max(b.tanggal_mulai.as_str());
    let selesai = a.tanggal_selesai.as_str().min(b.tanggal_selesai.as_str());
    if mulai > selesai {
        return false;
    }
    // Tanggal di tengah irisan adalah hari tengah keduanya: penuh.
    if days_between(mulai, selesai).unwrap_or(i64::MAX) >= 2 {
        return true;
    }
    [mulai, selesai].iter().any(|t| {
        let (a0, a1) = jam_pada(a, t);
        let (b0, b1) = jam_pada(b, t);
        a0 <= b1 && b0 <= a1
    })
}

pub struct Jadwal {
    pub hari_masuk: Vec<i64>,
    pub divisi: String,
    pub kode_shift: Option<i64>,
}

/// Cermin `tanggalWajib`: tanggal dalam rentang yang wajib masuk bagi orang
/// itu (shift kini, libur aktif, whitelist libur).
pub fn tanggal_wajib(
    jadwal: &Jadwal,
    libur: &HashSet<String>,
    whitelist: &[HolidayWhitelistEntry],
    mulai: &str,
    selesai: &str,
) -> Vec<String> {
    tanggal_rentang(mulai, selesai)
        .into_iter()
        .filter(|t| {
            let hari_libur = libur.contains(t);
            let masuk_saat_libur = hari_libur
                && evaluate_holiday_scan(whitelist, t, &jadwal.divisi, jadwal.kode_shift).is_some();
            wajib_masuk(t, &jadwal.hari_masuk, hari_libur, masuk_saat_libur)
        })
        .collect()
}

fn unit_normal(unit: &str) -> String {
    unit.trim().to_lowercase()
}

/// Cermin `dalamCakupan` (A-5): `hr.scope.all`, atau unit akun tidak kosong
/// dan sama dengan unit sasaran.
pub fn dalam_cakupan(lingkup_semua: bool, unit_akun: &str, unit_sasaran: &str) -> bool {
    lingkup_semua
        || (!unit_normal(unit_akun).is_empty()
            && unit_normal(unit_akun) == unit_normal(unit_sasaran))
}

// Aturan aksi

#[derive(Debug, Clone, Deserialize)]
pub struct KeadaanAksi {
    pub status: String,
    pub sudah_diketahui: bool,
    pub pengaju_sendiri: bool,
    pub superadmin: bool,
    /// Pegawai pengajuan = personil yang tertaut ke sesi.
    pub karyawan_sendiri: bool,
    /// Sesi memegang `izin_pemutus` jenisnya.
    pub boleh_putus: bool,
    pub dalam_cakupan: bool,
}

fn boleh_memutus(k: &KeadaanAksi) -> Result<(), String> {
    if !k.boleh_putus {
        return Err(PESAN_IZIN_PUTUS.into());
    }
    if k.karyawan_sendiri {
        return Err(PESAN_DIRI_SENDIRI.into());
    }
    if !k.dalam_cakupan {
        return Err(PESAN_CAKUPAN.into());
    }
    Ok(())
}

/// Cermin `periksaAksi`.
pub fn periksa_aksi(aksi: &str, alasan: &str, k: &KeadaanAksi) -> Result<(), String> {
    if !AKSI_KEPUTUSAN.contains(&aksi) {
        return Err("Keputusan tidak dikenal.".into());
    }
    if panjang(alasan.trim()) > MAKS_ALASAN {
        return Err(format!("Alasan maksimal {MAKS_ALASAN} karakter."));
    }
    let tanpa_alasan = alasan.trim().is_empty();
    match aksi {
        "Setujui" | "Tolak" => {
            if k.status != "Menunggu" {
                return Err("Pengajuan ini tidak lagi menunggu keputusan.".into());
            }
            boleh_memutus(k)?;
            if aksi == "Tolak" && tanpa_alasan {
                return Err("Alasan penolakan wajib diisi.".into());
            }
        }
        "Diketahui" => {
            if k.status != "Disetujui (urgent)" || k.sudah_diketahui {
                return Err(
                    "Hanya pengajuan urgent yang belum diketahui yang bisa ditandai.".into(),
                );
            }
            boleh_memutus(k)?;
        }
        _ => {
            if tanpa_alasan {
                return Err("Alasan pembatalan wajib diisi.".into());
            }
            if k.status == "Menunggu" {
                if !k.pengaju_sendiri && !k.superadmin {
                    return Err(
                        "Hanya pengaju yang bisa membatalkan pengajuan yang masih menunggu.".into(),
                    );
                }
            } else if status_berlaku(&k.status) {
                boleh_memutus(k)?;
            } else {
                return Err(
                    "Pengajuan yang ditolak atau dibatalkan tidak bisa dibatalkan lagi.".into(),
                );
            }
        }
    }
    Ok(())
}

/// Cermin `periksaSunting`.
pub fn periksa_sunting(
    status: &str,
    pengaju_sendiri: bool,
    superadmin: bool,
) -> Result<(), String> {
    if status != "Menunggu" {
        return Err("Pengajuan yang sudah diputus tidak bisa disunting.".into());
    }
    if !pengaju_sendiri && !superadmin {
        return Err("Hanya pengaju yang bisa menyunting pengajuan ini.".into());
    }
    Ok(())
}

/// Cermin `periksaUrgent`: urgent = menyetujui sekaligus.
pub fn periksa_urgent(karyawan_sendiri: bool, dalam_cakupan: bool) -> Result<(), String> {
    if karyawan_sendiri {
        return Err("Pengajuan urgent untuk dirimu sendiri tidak bisa disetujui sendiri.".into());
    }
    if !dalam_cakupan {
        return Err(PESAN_CAKUPAN.into());
    }
    Ok(())
}

pub fn pesan_periode_dibayar(mulai: &str, selesai: &str) -> String {
    format!("Gaji periode {mulai} s.d. {selesai} sudah dibayar; pengajuan di tanggal itu tidak bisa diubah.")
}

pub fn pesan_bertumpuk(mulai: &str, selesai: &str) -> String {
    format!("Tanggal itu bertumpuk dengan pengajuan lain pegawai ini ({mulai} s.d. {selesai}).")
}

pub fn pesan_run_ulang(mulai: &str, selesai: &str) -> String {
    format!("Proses gaji periode {mulai} s.d. {selesai} sudah dibuat; buat ulang supaya pengajuan ini ikut dihitung.")
}

// Sub-fase 2b: absensi, gaji, dan jatah cuti (§20.2.4, §20.2.6, §20.2.7)

/// Pengajuan berlaku untuk laporan kehadiran (kunci data `pengajuan`).
pub const LAPORAN_PENGAJUAN_SQL: &str = "SELECT json_object('id', p.id_karyawan, 'mulai', p.tanggal_mulai, 'selesai', p.tanggal_selesai, 'kelompok', p.kelompok) FROM hr_pengajuan p WHERE p.tanggal_mulai <= ?2 AND p.tanggal_selesai >= ?1 AND NOT EXISTS (SELECT 1 FROM hr_pengajuan_keputusan b WHERE b.id_pengajuan = p.id_pengajuan AND b.jenis = 'Batal') AND (SELECT k.jenis FROM hr_pengajuan_keputusan k WHERE k.id_pengajuan = p.id_pengajuan AND k.sidik = p.sidik AND k.jenis IN ('Setujui', 'Tolak', 'Setujui Urgent') ORDER BY k.diterima_cloud IS NULL, k.diterima_cloud, k.waktu_perangkat, k.id_keputusan LIMIT 1) IN ('Setujui', 'Setujui Urgent') ORDER BY p.id_karyawan, p.tanggal_mulai, p.id_pengajuan;";
/// Per orang per tanggal `?1`..`?2`: ada scan Hadir (definisi `total_hadir`
/// rekap gaji) dan jam kerja tercatat.
pub const HARI_ABSEN_SQL: &str = "SELECT id_karyawan, tanggal, MAX(CASE WHEN status_kehadiran IN ('Hadir', 'PRESENT') THEN 1 ELSE 0 END) AS hadir, COALESCE(SUM(jam_kerja), 0) AS jam_kerja FROM absensi_harian WHERE tanggal >= ?1 AND tanggal <= ?2 GROUP BY id_karyawan, tanggal;";
/// Jadwal kini pegawai di larik JSON `?1` (shift `master_data.id_shift`).
pub const JADWAL_PEGAWAI_SQL: &str = "SELECT m.id_unik, COALESCE(m.divisi, '') AS divisi, s.hari_kerja, s.kode_shift, COALESCE(s.jam_kerja_normal_menit, 0) AS jam_normal FROM master_data m LEFT JOIN tbl_shift s ON s.id_shift = m.id_shift WHERE m.id_unik IN (SELECT value FROM json_each(?1));";
/// Satu pegawai untuk jatah cuti: TMT, kelompok guru/tendik, dan jadwal.
pub const JATAH_PEGAWAI_SQL: &str = "SELECT m.id_unik, m.nama, COALESCE(m.unit, '') AS unit, COALESCE(m.tanggal_mulai_aktif, '') AS tmt, CASE WHEN EXISTS (SELECT 1 FROM guru_data g WHERE g.id_guru = m.id_unik) THEN 1 ELSE 0 END AS guru, COALESCE(m.divisi, '') AS divisi, s.hari_kerja, s.kode_shift FROM master_data m LEFT JOIN tbl_shift s ON s.id_shift = m.id_shift WHERE m.id_unik = ?1 AND LOWER(TRIM(COALESCE(m.jenis_personil, ''))) <> 'siswa' AND NOT EXISTS (SELECT 1 FROM siswa_data sd WHERE sd.id_siswa = m.id_unik);";
/// Rentang pengajuan Cuti ber-`potong_jatah` yang berlaku milik `?1`.
pub const JATAH_TERPAKAI_SQL: &str = "SELECT p.tanggal_mulai, p.tanggal_selesai FROM hr_pengajuan p WHERE p.id_karyawan = ?1 AND p.potong_jatah = 1 AND NOT EXISTS (SELECT 1 FROM hr_pengajuan_keputusan b WHERE b.id_pengajuan = p.id_pengajuan AND b.jenis = 'Batal') AND (SELECT k.jenis FROM hr_pengajuan_keputusan k WHERE k.id_pengajuan = p.id_pengajuan AND k.sidik = p.sidik AND k.jenis IN ('Setujui', 'Tolak', 'Setujui Urgent') ORDER BY k.diterima_cloud IS NULL, k.diterima_cloud, k.waktu_perangkat, k.id_keputusan LIMIT 1) IN ('Setujui', 'Setujui Urgent') ORDER BY p.tanggal_mulai, p.id_pengajuan;";
/// Tanggal scan Hadir milik `?1` dalam `?2`..`?3`.
pub const HADIR_ORANG_SQL: &str = "SELECT tanggal FROM absensi_harian WHERE id_karyawan = ?1 AND tanggal >= ?2 AND tanggal <= ?3 AND status_kehadiran IN ('Hadir', 'PRESENT') GROUP BY tanggal;";
/// Penyesuaian jatah satu pegawai, beserta penanda sudah dibatalkan.
pub const PENYESUAIAN_ORANG_SQL: &str = "SELECT u.id_penyesuaian, u.periode, u.jenis, COALESCE(u.id_ref, '') AS id_ref, u.hari, u.alasan, u.dicatat_oleh, u.created_at, CASE WHEN EXISTS (SELECT 1 FROM hr_cuti_penyesuaian b WHERE b.jenis = 'Pembatalan' AND b.id_ref = u.id_penyesuaian) THEN 1 ELSE 0 END AS dibatalkan FROM hr_cuti_penyesuaian u WHERE u.id_karyawan = ?1 ORDER BY u.periode, u.created_at, u.id_penyesuaian;";
pub const PENYESUAIAN_SATU_SQL: &str = "SELECT u.id_penyesuaian, u.id_karyawan, u.periode, u.jenis, CASE WHEN EXISTS (SELECT 1 FROM hr_cuti_penyesuaian b WHERE b.jenis = 'Pembatalan' AND b.id_ref = u.id_penyesuaian) THEN 1 ELSE 0 END AS dibatalkan FROM hr_cuti_penyesuaian u WHERE u.id_penyesuaian = ?1;";
/// Riwayat pengajuan satu pegawai (kolom sama dengan `DAFTAR_PENGAJUAN_SQL`).
pub const RIWAYAT_PENGAJUAN_SQL: &str = "SELECT p.id_pengajuan, p.id_karyawan, COALESCE(m.nama, p.id_karyawan) AS nama, COALESCE(m.unit, '') AS unit, CASE WHEN EXISTS (SELECT 1 FROM guru_data g WHERE g.id_guru = p.id_karyawan) THEN 1 ELSE 0 END AS guru, p.id_jenis, COALESCE(j.nama, p.id_jenis) AS nama_jenis, p.kelompok, p.potong_jatah, p.dampak_gaji, p.izin_pemutus, p.tanggal_mulai, p.tanggal_selesai, p.jam_mulai_ke, p.jam_sampai_ke, p.setengah_hari, p.alasan, p.sidik, p.diajukan_oleh, p.waktu_perangkat FROM hr_pengajuan p LEFT JOIN master_data m ON m.id_unik = p.id_karyawan LEFT JOIN hr_jenis_pengajuan j ON j.id_jenis = p.id_jenis WHERE p.id_karyawan = ?1 ORDER BY p.tanggal_mulai DESC, p.id_pengajuan LIMIT 200;";
pub const ATURAN_CUTI_SQL: &str =
    "SELECT key, value FROM setting_gex_system WHERE key LIKE 'hr_cuti_%';";

/// Pengajuan berlaku hasil `PENGAJUAN_RENTANG_SQL`.
#[derive(Debug, Clone, Deserialize)]
pub struct Berlaku {
    pub id_karyawan: String,
    pub tanggal_mulai: String,
    pub tanggal_selesai: String,
    pub kelompok: String,
    pub dampak_gaji: String,
    #[serde(default)]
    pub jam_mulai_ke: Option<i64>,
    #[serde(default)]
    pub jam_sampai_ke: Option<i64>,
    pub setengah_hari: bool,
}

/// Cermin `penuhPada`: pengajuan menutup `t` sehari penuh. Hari sebagian
/// (Q-46) = setengah hari, hari pertama yang mulai sesudah jam ke-1, atau
/// hari terakhir yang berhenti di jam tertentu.
pub fn penuh_pada(p: &Berlaku, t: &str) -> bool {
    let awal_sebagian = t == p.tanggal_mulai && p.jam_mulai_ke.is_some_and(|n| n > 1);
    let akhir_sebagian = t == p.tanggal_selesai && p.jam_sampai_ke.is_some();
    !(p.setengah_hari || awal_sebagian || akhir_sebagian)
}

/// Cermin `menitCutiDibayar` (tabel §20.2.7, Q-46): `(hari, menit)` satu
/// tanggal wajib. Hari penuh dengan scan Hadir = Hadir menang; selain itu
/// menit dibayar = max(tercatat, jam normal) dikurangi yang tercatat, dan
/// hari dihitung bila tidak ada scan Hadir (TER harian, Q-41).
pub fn menit_cuti_dibayar(penuh: bool, hadir: bool, jam_kerja: i64, normal: i64) -> (i64, i64) {
    if penuh && hadir {
        return (0, 0);
    }
    (i64::from(!hadir), (normal.max(0) - jam_kerja.max(0)).max(0))
}

#[derive(Debug, Clone, Default, PartialEq, Serialize)]
pub struct CutiDibayar {
    pub hari: i64,
    pub menit: i64,
    /// Ada tanggal cuti dibayar tetapi jam normal shift-nya 0.
    pub jam_normal_nol: bool,
}

/// Cermin `hitungCutiDibayar`: `tanggal` = (tanggal wajib, penuh) dari
/// pengajuan Dibayar satu orang; satu tanggal dihitung sekali, penuh menang.
/// `absen` = tanggal → (ada scan Hadir, jam kerja tercatat).
pub fn hitung_cuti_dibayar(
    tanggal: &[(String, bool)],
    absen: &HashMap<String, (bool, i64)>,
    normal: i64,
) -> CutiDibayar {
    let mut per: std::collections::BTreeMap<&str, bool> = std::collections::BTreeMap::new();
    for (t, penuh) in tanggal {
        per.entry(t.as_str())
            .and_modify(|p| *p = *p || *penuh)
            .or_insert(*penuh);
    }
    let mut hasil = CutiDibayar {
        jam_normal_nol: !per.is_empty() && normal <= 0,
        ..CutiDibayar::default()
    };
    for (t, penuh) in per {
        let (hadir, jam) = absen.get(t).copied().unwrap_or((false, 0));
        let (h, m) = menit_cuti_dibayar(penuh, hadir, jam, normal);
        hasil.hari += h;
        hasil.menit += m;
    }
    hasil
}

/// Cermin `hadirSaatCuti`: pengajuan Cuti yang berlaku punya tanggal hari
/// penuh dengan scan Hadir (`hadir` berisi `id|tanggal`). Hadir menang dan
/// jatah tidak terpotong; tanda ini hanya untuk ditinjau.
pub fn hadir_saat_cuti(p: &Berlaku, hadir: &HashSet<String>) -> bool {
    p.kelompok == "Cuti"
        && tanggal_rentang(&p.tanggal_mulai, &p.tanggal_selesai)
            .iter()
            .any(|t| penuh_pada(p, t) && hadir.contains(&format!("{}|{t}", p.id_karyawan)))
}

// Aturan dan jatah cuti per kelompok (§20.2.4)

pub const KELOMPOK_CUTI: [&str; 2] = ["guru", "tendik"];
pub const PERIODE_CUTI: [&str; 2] = ["tahunan", "ulang_tahun_kerja"];
pub const SISA_CUTI: [&str; 2] = ["hangus", "dibawa"];
pub const JENIS_PENYESUAIAN: [&str; 2] = ["Saldo Awal", "Koreksi"];
pub const MAKS_HARI_PENYESUAIAN: i64 = 366;

/// Isian angka aturan cuti: (isian, label, min, maks, bawaan guru, bawaan
/// tendik). Kunci setting = `hr_cuti_<isian>:<kelompok>`.
pub const BATAS_CUTI: [(&str, &str, i64, i64, i64, i64); 5] = [
    ("hak", "Hak cuti", 0, 60, 12, 12),
    ("bulan_awal", "Bulan awal periode", 1, 12, 7, 1),
    ("syarat_bulan", "Masa kerja minimum", 0, 24, 12, 12),
    ("bawa_maks", "Sisa maksimal dibawa", 0, 60, 6, 6),
    ("bawa_bulan", "Batas pakai sisa dibawa", 1, 12, 3, 3),
];

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AturanCuti {
    pub periode: String,
    pub hak: i64,
    pub bulan_awal: i64,
    pub syarat_bulan: i64,
    pub sisa: String,
    pub bawa_maks: i64,
    pub bawa_bulan: i64,
}

pub fn kunci_cuti(isian: &str, kelompok: &str) -> String {
    format!("hr_cuti_{isian}:{kelompok}")
}

/// Cermin `aturanCuti`. Kosong atau di luar batas = bawaan kelompok.
pub fn aturan_cuti(peta: &HashMap<String, String>, kelompok: &str) -> AturanCuti {
    let guru = kelompok == "guru";
    let nilai = |isian: &str| peta.get(&kunci_cuti(isian, kelompok)).map(|v| v.trim());
    let angka = |i: usize| {
        let (isian, _, min, maks, bawaan_guru, bawaan_tendik) = BATAS_CUTI[i];
        nilai(isian)
            .and_then(|v| v.parse::<i64>().ok())
            .filter(|n| (min..=maks).contains(n))
            .unwrap_or(if guru { bawaan_guru } else { bawaan_tendik })
    };
    let pilih = |isian: &str, daftar: &[&str]| {
        nilai(isian)
            .filter(|v| daftar.contains(v))
            .unwrap_or(daftar[0])
            .to_owned()
    };
    AturanCuti {
        periode: pilih("periode", &PERIODE_CUTI),
        hak: angka(0),
        bulan_awal: angka(1),
        syarat_bulan: angka(2),
        sisa: pilih("sisa", &SISA_CUTI),
        bawa_maks: angka(3),
        bawa_bulan: angka(4),
    }
}

/// Cermin `validasiAturanCuti`: `{ guru: {…}, tendik: {…} }` → pasangan
/// kunci-nilai siap disimpan, urutan tetap.
pub fn validasi_aturan_cuti(draft: &Value) -> Result<Vec<(String, String)>, String> {
    let mut hasil = Vec::new();
    for k in KELOMPOK_CUTI {
        let a = draft
            .get(k)
            .filter(|a| a.is_object())
            .ok_or_else(|| format!("Aturan cuti {k} tidak lengkap."))?;
        let periode = teks(a, "periode");
        if !PERIODE_CUTI.contains(&periode.as_str()) {
            return Err(format!(
                "Periode cuti {k} harus tahunan atau ulang tahun kerja."
            ));
        }
        let sisa = teks(a, "sisa");
        if !SISA_CUTI.contains(&sisa.as_str()) {
            return Err(format!("Sisa cuti {k} harus hangus atau dibawa."));
        }
        hasil.push((kunci_cuti("periode", k), periode));
        for (isian, label, min, maks, _, _) in BATAS_CUTI {
            match a.get(isian).and_then(Value::as_i64) {
                Some(n) if (min..=maks).contains(&n) => {
                    hasil.push((kunci_cuti(isian, k), n.to_string()))
                }
                _ => return Err(format!("{label} {k} harus {min} sampai {maks}.")),
            }
            if isian == "syarat_bulan" {
                hasil.push((kunci_cuti("sisa", k), sisa.clone()));
            }
        }
    }
    Ok(hasil)
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct PeriodeCuti {
    /// Kunci periode (`hr_cuti_penyesuaian.periode`).
    pub mulai: String,
    /// Inklusif.
    pub selesai: String,
    /// Periode sebelum tanggal berhak: hak 0, tidak membawa sisa.
    pub sebelum_berhak: bool,
    pub hak: i64,
    pub bawaan: i64,
    pub bawaan_hangus: i64,
    pub bawaan_sampai: Option<String>,
    pub penyesuaian: i64,
    pub terpakai: i64,
    pub sisa: i64,
}

fn kurang_sehari(tanggal: &str) -> Option<String> {
    add_days(tanggal, -1).ok()
}

/// Cermin `jatahCuti` (pola perusahaan §17.7, periode tahunan berbulan awal).
/// `terpakai` = tanggal wajib dari Cuti ber-`potong_jatah` yang berlaku,
/// sudah dikurangi tanggal Hadir; `penyesuaian` = (periode, hari) yang tidak
/// dibatalkan. TMT kosong = tanpa periode (tanda `tanpa_tmt`).
pub fn jatah_cuti(
    tmt: Option<&str>,
    a: &AturanCuti,
    terpakai: &[String],
    penyesuaian: &[(String, i64)],
    hari_ini: &str,
) -> Vec<PeriodeCuti> {
    let Some(masuk) = tmt.filter(|t| tanggal_valid(t)) else {
        return Vec::new();
    };
    let Some(berhak) = hris::tambah_bulan(masuk, a.syarat_bulan) else {
        return Vec::new();
    };
    let mut akhir = hari_ini.to_owned();
    for t in terpakai.iter().chain(penyesuaian.iter().map(|(p, _)| p)) {
        if *t > akhir {
            akhir = t.clone();
        }
    }

    // (mulai, selesai, hak, sebelum_berhak)
    let mut batas: Vec<(String, String, i64, bool)> = Vec::new();
    if masuk < berhak.as_str() || terpakai.iter().any(|t| *t < berhak) {
        let mulai = terpakai
            .iter()
            .filter(|t| t.as_str() < masuk)
            .min()
            .cloned()
            .unwrap_or_else(|| masuk.to_owned());
        if let Some(selesai) = kurang_sehari(&berhak) {
            if mulai <= selesai {
                batas.push((mulai, selesai, 0, true));
            }
        }
    }
    if a.periode == "tahunan" {
        let tahun: i64 = berhak.get(0..4).and_then(|y| y.parse().ok()).unwrap_or(0);
        let bulan: i64 = berhak.get(5..7).and_then(|m| m.parse().ok()).unwrap_or(1);
        let awal = |y: i64| format!("{y:04}-{:02}-01", a.bulan_awal);
        let mut y = if bulan >= a.bulan_awal {
            tahun
        } else {
            tahun - 1
        } + 1;
        let selesai = kurang_sehari(&awal(y)).unwrap_or_else(|| awal(y));
        batas.push((berhak.clone(), selesai, a.hak, false));
        while awal(y) <= akhir && batas.len() < 200 {
            let selesai = kurang_sehari(&awal(y + 1)).unwrap_or_else(|| awal(y + 1));
            batas.push((awal(y), selesai, a.hak, false));
            y += 1;
        }
    } else {
        let mut k = 0;
        while batas.len() < 200 {
            let (Some(mulai), Some(berikut)) = (
                hris::tambah_bulan(&berhak, 12 * k),
                hris::tambah_bulan(&berhak, 12 * (k + 1)),
            ) else {
                break;
            };
            if mulai > akhir {
                break;
            }
            let selesai = kurang_sehari(&berikut).unwrap_or(berikut);
            batas.push((mulai, selesai, a.hak, false));
            k += 1;
        }
    }

    let mut hasil: Vec<PeriodeCuti> = Vec::with_capacity(batas.len());
    for (mulai, selesai, hak, sebelum_berhak) in batas {
        let dalam = |t: &str| t >= mulai.as_str() && t <= selesai.as_str();
        let pakai = terpakai.iter().filter(|t| dalam(t)).count() as i64;
        let adj: i64 = penyesuaian
            .iter()
            .filter(|(p, _)| *p == mulai)
            .map(|(_, h)| h)
            .sum();
        let bawaan = match hasil.last().filter(|p| !p.sebelum_berhak) {
            Some(p) if a.sisa == "dibawa" => p.sisa.max(0).min(a.bawa_maks),
            _ => 0,
        };
        let (mut hangus, mut sampai) = (0, None);
        if bawaan > 0 {
            if let Some(batas_bawa) = hris::tambah_bulan(&mulai, a.bawa_bulan) {
                let awal = terpakai
                    .iter()
                    .filter(|t| t.as_str() >= mulai.as_str() && t.as_str() < batas_bawa.as_str())
                    .count() as i64;
                if hari_ini >= batas_bawa.as_str() {
                    hangus = bawaan - bawaan.min(awal);
                }
                sampai = kurang_sehari(&batas_bawa);
            }
        }
        hasil.push(PeriodeCuti {
            sisa: hak + adj + bawaan - hangus - pakai,
            mulai,
            selesai,
            sebelum_berhak,
            hak,
            bawaan,
            bawaan_hangus: hangus,
            bawaan_sampai: sampai,
            penyesuaian: adj,
            terpakai: pakai,
        });
    }
    // Periode sebelum berhak hanya tampil bila ada isinya.
    hasil.retain(|p| !p.sebelum_berhak || p.terpakai != 0 || p.penyesuaian != 0);
    hasil
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct PenyesuaianSah {
    /// Id penyesuaian yang dibatalkan; kosong = penyesuaian baru.
    pub batal: String,
    pub id_karyawan: String,
    pub periode: String,
    pub jenis: String,
    pub hari: i64,
    pub alasan: String,
}

/// Cermin `validasiPenyesuaian`.
pub fn validasi_penyesuaian(draft: &Value) -> Result<PenyesuaianSah, String> {
    let alasan = teks(draft, "alasan");
    let cek_alasan = || -> Result<(), String> {
        if alasan.is_empty() {
            return Err("Alasan wajib diisi.".into());
        }
        if panjang(&alasan) > MAKS_ALASAN {
            return Err(format!("Alasan maksimal {MAKS_ALASAN} karakter."));
        }
        Ok(())
    };
    let batal = teks(draft, "batal");
    if !batal.is_empty() {
        cek_alasan()?;
        return Ok(PenyesuaianSah {
            batal,
            id_karyawan: String::new(),
            periode: String::new(),
            jenis: "Pembatalan".into(),
            hari: 0,
            alasan,
        });
    }
    let id_karyawan = teks(draft, "id_karyawan");
    if id_karyawan.is_empty() {
        return Err("Pilih pegawai.".into());
    }
    let periode = teks(draft, "periode");
    if !tanggal_valid(&periode) {
        return Err("Periode jatah tidak valid.".into());
    }
    let jenis = teks(draft, "jenis");
    if !JENIS_PENYESUAIAN.contains(&jenis.as_str()) {
        return Err("Jenis penyesuaian harus Saldo Awal atau Koreksi.".into());
    }
    let hari = draft
        .get("hari")
        .and_then(Value::as_i64)
        .filter(|n| *n != 0 && n.abs() <= MAKS_HARI_PENYESUAIAN)
        .ok_or_else(|| {
            format!("Jumlah hari harus -{MAKS_HARI_PENYESUAIAN} sampai {MAKS_HARI_PENYESUAIAN} dan bukan 0.")
        })?;
    cek_alasan()?;
    Ok(PenyesuaianSah {
        batal: String::new(),
        id_karyawan,
        periode,
        jenis,
        hari,
        alasan,
    })
}

// Handler cloud (tidak pernah menolak)

fn id_dari(payload: &Value, kunci: &str, entity_key: &str) -> String {
    Some(teks(payload, kunci))
        .filter(|id| !id.is_empty())
        .unwrap_or_else(|| entity_key.trim().to_owned())
}

fn nilai_opsional(payload: &Value, kunci: &str) -> Value {
    payload
        .get(kunci)
        .and_then(Value::as_i64)
        .map_or(Value::Null, |n| json!(n))
}

/// `hr-request-type/save`: upsert penuh. Payload cacat = tanpa statement.
pub fn cloud_jenis_statements(payload: &Value, entity_key: &str) -> Vec<(String, Vec<Value>)> {
    let id = id_dari(payload, "id_jenis", entity_key);
    let Ok(j) = validasi_jenis(payload) else {
        return Vec::new();
    };
    if id.is_empty() {
        return Vec::new();
    }
    vec![(SIMPAN_JENIS_SQL.to_owned(), jenis_args(&id, &j))]
}

fn jenis_args(id: &str, j: &JenisPengajuan) -> Vec<Value> {
    vec![
        json!(id),
        json!(j.nama),
        json!(j.kelompok),
        json!(j.izin_pemutus),
        json!(i64::from(j.boleh_urgent)),
        json!(i64::from(j.potong_jatah)),
        json!(i64::from(j.wajib_dokumen)),
        json!(j.dampak_gaji),
        json!(j.maks_hari),
        json!(j.satuan_maks),
        json!(i64::from(j.is_aktif)),
    ]
}

/// Argumen `SIMPAN_PENGAJUAN_SQL` dari payload `hr-request/save`.
fn pengajuan_args(p: &Value) -> Vec<Value> {
    vec![
        json!(teks(p, "id_pengajuan")),
        json!(teks(p, "id_karyawan")),
        json!(teks(p, "id_jenis")),
        json!(teks(p, "kelompok")),
        json!(i64::from(bendera(p, "potong_jatah"))),
        json!(teks(p, "dampak_gaji")),
        json!(teks(p, "izin_pemutus")),
        json!(teks(p, "tanggal_mulai")),
        json!(teks(p, "tanggal_selesai")),
        nilai_opsional(p, "jam_mulai_ke"),
        nilai_opsional(p, "jam_sampai_ke"),
        json!(i64::from(bendera(p, "setengah_hari"))),
        json!(teks(p, "alasan")),
        json!(teks(p, "sidik")),
        json!(teks(p, "diajukan_oleh")),
        json!(teks(p, "waktu_perangkat")),
    ]
}

/// `hr-request/save`: upsert penuh. Suntingan yang telat menggugurkan
/// keputusan lewat sidik, bukan lewat penolakan.
pub fn cloud_pengajuan_statements(payload: &Value, entity_key: &str) -> Vec<(String, Vec<Value>)> {
    let mut p = payload.clone();
    p["id_pengajuan"] = json!(id_dari(payload, "id_pengajuan", entity_key));
    let wajib = [
        "id_pengajuan",
        "id_karyawan",
        "id_jenis",
        "kelompok",
        "dampak_gaji",
        "izin_pemutus",
        "alasan",
        "sidik",
        "diajukan_oleh",
        "waktu_perangkat",
    ];
    let mulai = teks(&p, "tanggal_mulai");
    let selesai = teks(&p, "tanggal_selesai");
    let jam_sah = ["jam_mulai_ke", "jam_sampai_ke"]
        .iter()
        .all(|k| angka_opsional(&p, k, 1, MAKS_JAM_KE).is_ok());
    if wajib.iter().any(|k| teks(&p, k).is_empty())
        || !tanggal_valid(&mulai)
        || !tanggal_valid(&selesai)
        || selesai < mulai
        || !jam_sah
    {
        return Vec::new();
    }
    vec![(SIMPAN_PENGAJUAN_SQL.to_owned(), pengajuan_args(&p))]
}

fn keputusan_args(p: &Value) -> Vec<Value> {
    [
        "id_keputusan",
        "id_pengajuan",
        "jenis",
        "sidik",
        "alasan",
        "oleh",
        "id_karyawan_oleh",
        "waktu_perangkat",
    ]
    .iter()
    .map(|k| json!(teks(p, k)))
    .collect()
}

/// `hr-request-decision/create`: `ON CONFLICT DO NOTHING`, jam cloud di
/// `diterima_cloud`. Keputusan ganda dari dua perangkat menjadi tanda.
pub fn cloud_keputusan_statements(payload: &Value, entity_key: &str) -> Vec<(String, Vec<Value>)> {
    let mut p = payload.clone();
    p["id_keputusan"] = json!(id_dari(payload, "id_keputusan", entity_key));
    let jenis = teks(&p, "jenis");
    let sah = KEPUTUSAN_FINAL.contains(&jenis.as_str()) || jenis == "Diketahui" || jenis == "Batal";
    let wajib = [
        "id_keputusan",
        "id_pengajuan",
        "sidik",
        "oleh",
        "waktu_perangkat",
    ];
    if !sah || wajib.iter().any(|k| teks(&p, k).is_empty()) {
        return Vec::new();
    }
    vec![(CLOUD_KEPUTUSAN_SQL.to_owned(), keputusan_args(&p))]
}

/// `hr-leave-adjustment/create` (2b): append-only.
pub fn cloud_penyesuaian_statements(
    payload: &Value,
    entity_key: &str,
) -> Vec<(String, Vec<Value>)> {
    let id = id_dari(payload, "id_penyesuaian", entity_key);
    let jenis = teks(payload, "jenis");
    let hari = payload.get("hari").and_then(Value::as_i64);
    let wajib = ["id_karyawan", "periode", "alasan", "dicatat_oleh"];
    if id.is_empty()
        || !["Saldo Awal", "Koreksi", "Pembatalan"].contains(&jenis.as_str())
        || hari.is_none()
        || wajib.iter().any(|k| teks(payload, k).is_empty())
    {
        return Vec::new();
    }
    vec![(
        CLOUD_PENYESUAIAN_SQL.to_owned(),
        vec![
            json!(id),
            json!(teks(payload, "id_karyawan")),
            json!(teks(payload, "periode")),
            json!(jenis),
            json!(teks(payload, "id_ref")),
            json!(hari),
            json!(teks(payload, "alasan")),
            json!(teks(payload, "dicatat_oleh")),
        ],
    )]
}

/// `hr-substitute/save` (2c): upsert atas id deterministik (Q-48).
pub fn cloud_penanganan_statements(payload: &Value, entity_key: &str) -> Vec<(String, Vec<Value>)> {
    let id = id_dari(payload, "id_penanganan", entity_key);
    let status = teks(payload, "status");
    let wajib = [
        "id_pengajuan",
        "tanggal",
        "id_jadwal",
        "dicatat_oleh",
        "waktu_perangkat",
    ];
    if id.is_empty()
        || !["Diganti", "Tugas Mandiri", "Digabung"].contains(&status.as_str())
        || wajib.iter().any(|k| teks(payload, k).is_empty())
    {
        return Vec::new();
    }
    let kolom = [
        "id_pengajuan",
        "tanggal",
        "id_jadwal",
        "id_rombel",
        "id_mapel",
        "jam_ke",
        "status",
        "id_guru_pengganti",
        "catatan",
        "dicatat_oleh",
        "waktu_perangkat",
    ];
    let mut args = vec![json!(id)];
    args.extend(kolom.iter().map(|k| json!(teks(payload, k))));
    vec![(CLOUD_PENANGANAN_SQL.to_owned(), args)]
}

// Penulisan dan baca lokal (Desktop/Mobile)

fn invalid(message: impl Into<String>) -> CommandError {
    CommandError::new("VALIDATION_ERROR", message)
}

fn db_error(_: rusqlite::Error) -> CommandError {
    CommandError::internal()
}

fn punya(operator: &OperatorUser, izin: &str) -> bool {
    operator.is_superadmin || operator.permissions.iter().any(|p| p == izin)
}

fn tautan(operator: &OperatorUser) -> String {
    operator
        .id_karyawan
        .as_deref()
        .unwrap_or("")
        .trim()
        .to_owned()
}

fn satu_teks(
    connection: &rusqlite::Connection,
    sql: &str,
    arg: &str,
) -> Result<String, CommandError> {
    Ok(connection
        .query_row(sql, params![arg], |row| row.get::<_, Option<String>>(0))
        .optional()
        .map_err(db_error)?
        .flatten()
        .unwrap_or_default())
}

/// Unit personil sesi; akun tanpa tautan = `""` (hanya `hr.scope.all`).
fn unit_akun(
    connection: &rusqlite::Connection,
    operator: &OperatorUser,
) -> Result<String, CommandError> {
    let id = tautan(operator);
    if id.is_empty() {
        return Ok(String::new());
    }
    satu_teks(connection, UNIT_PERSONIL_SQL, &id)
}

fn waktu(connection: &rusqlite::Connection) -> Result<(String, String), CommandError> {
    connection
        .query_row(WAKTU_SQL, [], |row| Ok((row.get(0)?, row.get(1)?)))
        .map_err(db_error)
}

fn keputusan_dari(rows: &[Value]) -> Vec<Keputusan> {
    rows.iter()
        .filter_map(|r| serde_json::from_value(r.clone()).ok())
        .collect()
}

fn periode(
    connection: &rusqlite::Connection,
    sql: &str,
    mulai: &str,
    selesai: &str,
) -> Result<Option<(String, String)>, CommandError> {
    connection
        .query_row(sql, params![mulai, selesai], |row| {
            Ok((row.get(0)?, row.get(1)?))
        })
        .optional()
        .map_err(db_error)
}

/// `desktop_hr_requests`: daftar + status + tanda, jenis, pegawai, dan sesi.
pub fn requests(
    state: &DesktopState,
    operator: &OperatorUser,
    dari: &str,
    sampai: &str,
) -> Result<Value, CommandError> {
    if !tanggal_valid(dari) || !tanggal_valid(sampai) || sampai < dari {
        return Err(invalid("Rentang tanggal tidak valid."));
    }
    let connection = storage::database(&state.data_dir)?;
    let mut pengajuan = rows_json_with(&connection, DAFTAR_PENGAJUAN_SQL, params![dari, sampai])?;
    let ids: Vec<String> = pengajuan.iter().map(|p| teks(p, "id_pengajuan")).collect();
    let keputusan = rows_json_with(
        &connection,
        DAFTAR_KEPUTUSAN_SQL,
        params![json!(ids).to_string()],
    )?;
    susun_daftar(&mut pengajuan, &keputusan);
    tandai_hadir_saat_cuti(&connection, &mut pengajuan)?;
    let jp = hitung_jp_daftar(&connection, &pengajuan)?;
    Ok(json!({
        "pengajuan": pengajuan,
        "jp": jp,
        "jenis": rows_json_with(&connection, JENIS_SQL, [])?,
        "pegawai": rows_json_with(&connection, PEGAWAI_PENGAJUAN_SQL, [])?,
        "sesi": {
            "id_karyawan": tautan(operator),
            "unit": unit_akun(&connection, operator)?,
            "lingkup_semua": punya(operator, "hr.scope.all"),
        },
        "dari": dari,
        "sampai": sampai,
    }))
}

/// Cermin `susunDaftar`: status, tanda, dan keputusan per pengajuan.
/// `bertumpuk` = pengajuan Menunggu/berlaku lain orang yang sama di daftar.
pub fn susun_daftar(pengajuan: &mut [Value], keputusan: &[Value]) {
    let mut per: HashMap<String, Vec<Value>> = HashMap::new();
    for k in keputusan {
        per.entry(teks(k, "id_pengajuan"))
            .or_default()
            .push(k.clone());
    }
    for p in pengajuan.iter_mut() {
        let rows = per.remove(&teks(p, "id_pengajuan")).unwrap_or_default();
        let daftar = keputusan_dari(&rows);
        let sidik = teks(p, "sidik");
        let status = status_pengajuan(&sidik, &daftar);
        let cakupan = keputusan_berlaku(&sidik, &daftar).and_then(|b| {
            rows.iter()
                .find(|r| teks(r, "id_keputusan") == b.id_keputusan)
                .filter(|r| !teks(r, "id_karyawan_oleh").is_empty())
                .map(|r| dalam_cakupan(false, &teks(r, "unit_oleh"), &teks(p, "unit")))
        });
        let tanda = tanda_keputusan(&sidik, &teks(p, "diajukan_oleh"), &daftar, cakupan);
        p["status"] = json!(status);
        p["tanda"] = json!(tanda);
        p["keputusan"] = Value::Array(rows);
    }
    let aktif: Vec<(usize, Ringkas)> = pengajuan
        .iter()
        .enumerate()
        .filter(|(_, p)| {
            let s = teks(p, "status");
            s == "Menunggu" || status_berlaku(&s)
        })
        .filter_map(|(i, p)| {
            serde_json::from_value::<Ringkas>(p.clone())
                .ok()
                .map(|r| (i, r))
        })
        .collect();
    for (i, a) in &aktif {
        if aktif.iter().any(|(j, b)| i != j && bentrok_pengajuan(a, b)) {
            if let Some(tanda) = pengajuan[*i]["tanda"].as_array_mut() {
                tanda.push(json!("bertumpuk"));
            }
        }
    }
}

struct Pegawai {
    unit: String,
    guru: bool,
    jadwal: Jadwal,
}

fn pegawai(transaction: &Transaction<'_>, id: &str) -> Result<Option<Pegawai>, CommandError> {
    transaction
        .query_row(PEGAWAI_SATU_SQL, params![id], |row| {
            Ok(Pegawai {
                unit: row.get(0)?,
                guru: row.get::<_, i64>(1)? == 1,
                jadwal: Jadwal {
                    divisi: row.get(2)?,
                    hari_masuk: parse_hari_kerja(row.get::<_, Option<String>>(3)?.as_deref()),
                    kode_shift: row.get(4)?,
                },
            })
        })
        .optional()
        .map_err(db_error)
}

fn jenis_satu(
    transaction: &Transaction<'_>,
    id_jenis: &str,
) -> Result<Option<JenisPengajuan>, CommandError> {
    let baris = rows_json_with(transaction, JENIS_SQL, [])?
        .into_iter()
        .find(|r| teks(r, "id_jenis") == id_jenis);
    Ok(baris.and_then(|r| validasi_jenis(&r).ok()))
}

fn jp_max(transaction: &Transaction<'_>, unit: &str) -> Result<i64, CommandError> {
    let (u, s): (Option<String>, Option<String>) = transaction
        .query_row(JP_MAX_SQL, params![unit], |row| {
            Ok((row.get(0)?, row.get(1)?))
        })
        .map_err(db_error)?;
    Ok(i64::from(super::class_attendance::jp_max_for_unit(
        u.as_deref(),
        s.as_deref(),
    )))
}

fn hari_kerja(
    transaction: &Transaction<'_>,
    jadwal: &Jadwal,
    mulai: &str,
    selesai: &str,
) -> Result<i64, CommandError> {
    let libur: HashSet<String> = rows_json_with(transaction, LIBUR_SQL, params![mulai, selesai])?
        .iter()
        .map(|r| teks(r, "tanggal"))
        .collect();
    let whitelist: Vec<HolidayWhitelistEntry> = rows_json_with(transaction, WHITELIST_SQL, [])?
        .iter()
        .map(|r| HolidayWhitelistEntry {
            id: teks(r, "id"),
            scope_type: teks(r, "scope_type"),
            scope_value: teks(r, "scope_value"),
            tanggal_libur: Some(teks(r, "tanggal_libur")).filter(|t| !t.is_empty()),
            status_aktif: r.get("status_aktif").and_then(Value::as_i64).unwrap_or(0),
        })
        .collect();
    Ok(tanggal_wajib(jadwal, &libur, &whitelist, mulai, selesai).len() as i64)
}

fn tulis_pengajuan(transaction: &Transaction<'_>, payload: &Value) -> Result<(), CommandError> {
    let args = pengajuan_args(payload);
    transaction
        .execute(
            SIMPAN_PENGAJUAN_SQL,
            rusqlite::params_from_iter(args.iter().map(json_ke_sql)),
        )
        .map_err(db_error)?;
    Ok(())
}

fn tulis_keputusan(transaction: &Transaction<'_>, payload: &Value) -> Result<(), CommandError> {
    let args = keputusan_args(payload);
    transaction
        .execute(
            SIMPAN_KEPUTUSAN_SQL,
            rusqlite::params_from_iter(args.iter().map(json_ke_sql)),
        )
        .map_err(db_error)?;
    Ok(())
}

fn json_ke_sql(v: &Value) -> rusqlite::types::Value {
    match v {
        Value::String(s) => rusqlite::types::Value::Text(s.clone()),
        Value::Number(n) => n.as_i64().map_or(
            rusqlite::types::Value::Null,
            rusqlite::types::Value::Integer,
        ),
        _ => rusqlite::types::Value::Null,
    }
}

fn keputusan_payload(
    id: &str,
    id_pengajuan: &str,
    jenis: &str,
    sidik: &str,
    alasan: &str,
    operator: &OperatorUser,
    waktu: &str,
) -> Value {
    json!({
        "id_keputusan": id,
        "id_pengajuan": id_pengajuan,
        "jenis": jenis,
        "sidik": sidik,
        "alasan": alasan,
        "oleh": operator.username,
        "id_karyawan_oleh": tautan(operator),
        "waktu_perangkat": waktu,
    })
}

fn tolak_periode_dibayar(
    transaction: &Transaction<'_>,
    mulai: &str,
    selesai: &str,
) -> Result<(), CommandError> {
    if let Some((a, b)) = periode(transaction, PERIODE_DIBAYAR_SQL, mulai, selesai)? {
        return Err(invalid(pesan_periode_dibayar(&a, &b)));
    }
    Ok(())
}

/// `desktop_hr_request_save`: buat atau sunting (selama Menunggu), urgent
/// sekaligus. Pengajuan dan keputusan urgent ditulis dalam satu transaksi.
pub fn simpan(
    state: &DesktopState,
    operator: &OperatorUser,
    draft: Value,
) -> Result<Value, CommandError> {
    let p = validasi_pengajuan(&draft).map_err(invalid)?;
    let id_lama = teks(&draft, "id_pengajuan");
    let client_id = sync::ensure_client_id(state)?;
    let mut connection = storage::database(&state.data_dir)?;
    let transaction = connection.transaction().map_err(db_error)?;
    let orang = pegawai(&transaction, &p.id_karyawan)?
        .ok_or_else(|| invalid("Pengajuan hanya untuk pegawai (guru dan tendik)."))?;
    let jenis = jenis_satu(&transaction, &p.id_jenis)?
        .ok_or_else(|| invalid("Jenis pengajuan tidak ditemukan."))?;
    periksa_jenis(&p, &jenis, orang.guru, jp_max(&transaction, &orang.unit)?).map_err(invalid)?;
    if jenis.maks_hari.is_some() {
        let kalender = days_between(&p.tanggal_mulai, &p.tanggal_selesai).unwrap_or(0) + 1;
        let kerja = hari_kerja(
            &transaction,
            &orang.jadwal,
            &p.tanggal_mulai,
            &p.tanggal_selesai,
        )?;
        periksa_maks(&jenis, kerja, kalender).map_err(invalid)?;
    }
    let (sekarang, _) = waktu(&transaction)?;
    let (id, diajukan_oleh) = if id_lama.is_empty() {
        (hris::new_id("pgn-"), operator.username.clone())
    } else {
        let lama = rows_json_with(&transaction, PENGAJUAN_SATU_SQL, params![id_lama])?
            .into_iter()
            .next()
            .ok_or_else(|| invalid("Pengajuan tidak ditemukan."))?;
        let rows = rows_json_with(&transaction, KEPUTUSAN_SATU_SQL, params![id_lama])?;
        let status = status_pengajuan(&teks(&lama, "sidik"), &keputusan_dari(&rows));
        let pengaju = teks(&lama, "diajukan_oleh");
        periksa_sunting(
            status,
            sama_orang(&pengaju, &operator.username),
            operator.is_superadmin,
        )
        .map_err(invalid)?;
        tolak_periode_dibayar(
            &transaction,
            &teks(&lama, "tanggal_mulai"),
            &teks(&lama, "tanggal_selesai"),
        )?;
        (id_lama.clone(), pengaju)
    };
    tolak_periode_dibayar(&transaction, &p.tanggal_mulai, &p.tanggal_selesai)?;
    let saya = Ringkas {
        id_karyawan: p.id_karyawan.clone(),
        tanggal_mulai: p.tanggal_mulai.clone(),
        tanggal_selesai: p.tanggal_selesai.clone(),
        jam_mulai_ke: p.jam_mulai_ke,
        jam_sampai_ke: p.jam_sampai_ke,
    };
    let lain = rows_json_with(
        &transaction,
        PENGAJUAN_AKTIF_ORANG_SQL,
        params![p.id_karyawan, id, p.tanggal_mulai, p.tanggal_selesai],
    )?;
    if let Some(b) = lain
        .iter()
        .filter_map(|r| serde_json::from_value::<Ringkas>(r.clone()).ok())
        .find(|b| bentrok_pengajuan(&saya, b))
    {
        return Err(invalid(pesan_bertumpuk(
            &b.tanggal_mulai,
            &b.tanggal_selesai,
        )));
    }
    let isi = IsiPengajuan {
        id_karyawan: p.id_karyawan.clone(),
        id_jenis: p.id_jenis.clone(),
        kelompok: jenis.kelompok.clone(),
        potong_jatah: jenis.potong_jatah,
        dampak_gaji: jenis.dampak_gaji.clone(),
        izin_pemutus: jenis.izin_pemutus.clone(),
        tanggal_mulai: p.tanggal_mulai.clone(),
        tanggal_selesai: p.tanggal_selesai.clone(),
        jam_mulai_ke: p.jam_mulai_ke,
        jam_sampai_ke: p.jam_sampai_ke,
        setengah_hari: p.setengah_hari,
        alasan: p.alasan.clone(),
    };
    let sidik = sidik_pengajuan(&isi);
    let payload = json!({
        "id_pengajuan": id,
        "id_karyawan": isi.id_karyawan,
        "id_jenis": isi.id_jenis,
        "kelompok": isi.kelompok,
        "potong_jatah": i64::from(isi.potong_jatah),
        "dampak_gaji": isi.dampak_gaji,
        "izin_pemutus": isi.izin_pemutus,
        "tanggal_mulai": isi.tanggal_mulai,
        "tanggal_selesai": isi.tanggal_selesai,
        "jam_mulai_ke": isi.jam_mulai_ke,
        "jam_sampai_ke": isi.jam_sampai_ke,
        "setengah_hari": i64::from(isi.setengah_hari),
        "alasan": isi.alasan,
        "sidik": sidik,
        "diajukan_oleh": diajukan_oleh,
        "waktu_perangkat": sekarang,
    });
    let mut urgent = Value::Null;
    if p.urgent {
        if !punya(operator, "hr.request.urgent") {
            return Err(CommandError::new(
                "DESKTOP_ACCESS_DENIED",
                "Kamu tidak punya izin pengajuan urgent.",
            ));
        }
        let lingkup = punya(operator, "hr.scope.all");
        let cakupan = dalam_cakupan(lingkup, &unit_akun(&transaction, operator)?, &orang.unit);
        periksa_urgent(tautan(operator) == p.id_karyawan, cakupan).map_err(invalid)?;
        urgent = keputusan_payload(
            &format!("urgent-{id}"),
            &id,
            "Setujui Urgent",
            &sidik,
            "",
            operator,
            &sekarang,
        );
    }
    tulis_pengajuan(&transaction, &payload)?;
    sync::enqueue(
        &transaction,
        &client_id,
        "hr-request",
        "save",
        &id,
        &payload,
        None,
    )?;
    if !urgent.is_null() {
        tulis_keputusan(&transaction, &urgent)?;
        sync::enqueue(
            &transaction,
            &client_id,
            "hr-request-decision",
            "create",
            &teks(&urgent, "id_keputusan"),
            &urgent,
            None,
        )?;
    }
    let peringatan = periode(
        &transaction,
        PERIODE_PERLU_ULANG_SQL,
        &p.tanggal_mulai,
        &p.tanggal_selesai,
    )?
    .map(|(a, b)| pesan_run_ulang(&a, &b));
    transaction.commit().map_err(db_error)?;
    Ok(json!({ "pengajuan": payload, "peringatan": peringatan }))
}

/// `desktop_hr_request_decide`: Setujui, Tolak, Diketahui, atau Batal.
/// Izin pemutus, cakupan unit, dan "bukan untuk diri sendiri" dari sesi.
pub fn putuskan(
    state: &DesktopState,
    operator: &OperatorUser,
    id_pengajuan: &str,
    aksi: &str,
    alasan: &str,
) -> Result<Value, CommandError> {
    let id_pengajuan = id_pengajuan.trim();
    let client_id = sync::ensure_client_id(state)?;
    let mut connection = storage::database(&state.data_dir)?;
    let transaction = connection.transaction().map_err(db_error)?;
    let p = rows_json_with(&transaction, PENGAJUAN_SATU_SQL, params![id_pengajuan])?
        .into_iter()
        .next()
        .ok_or_else(|| invalid("Pengajuan tidak ditemukan."))?;
    let daftar = keputusan_dari(&rows_json_with(
        &transaction,
        KEPUTUSAN_SATU_SQL,
        params![id_pengajuan],
    )?);
    let sidik = teks(&p, "sidik");
    let status = status_pengajuan(&sidik, &daftar);
    let id_karyawan = teks(&p, "id_karyawan");
    let unit_pegawai = satu_teks(&transaction, UNIT_PERSONIL_SQL, &id_karyawan)?;
    let keadaan = KeadaanAksi {
        status: status.to_owned(),
        sudah_diketahui: daftar.iter().any(|k| k.jenis == "Diketahui"),
        pengaju_sendiri: sama_orang(&teks(&p, "diajukan_oleh"), &operator.username),
        superadmin: operator.is_superadmin,
        karyawan_sendiri: !tautan(operator).is_empty() && tautan(operator) == id_karyawan,
        boleh_putus: punya(operator, &teks(&p, "izin_pemutus")),
        dalam_cakupan: dalam_cakupan(
            punya(operator, "hr.scope.all"),
            &unit_akun(&transaction, operator)?,
            &unit_pegawai,
        ),
    };
    periksa_aksi(aksi, alasan, &keadaan).map_err(invalid)?;
    if aksi == "Setujui" || aksi == "Batal" {
        tolak_periode_dibayar(
            &transaction,
            &teks(&p, "tanggal_mulai"),
            &teks(&p, "tanggal_selesai"),
        )?;
    }
    let id = match aksi {
        "Diketahui" => format!("tahu-{id_pengajuan}"),
        "Batal" => format!("batal-{id_pengajuan}"),
        _ => hris::new_id("kpt-"),
    };
    let (sekarang, _) = waktu(&transaction)?;
    let payload = keputusan_payload(
        &id,
        id_pengajuan,
        aksi,
        &sidik,
        alasan.trim(),
        operator,
        &sekarang,
    );
    tulis_keputusan(&transaction, &payload)?;
    sync::enqueue(
        &transaction,
        &client_id,
        "hr-request-decision",
        "create",
        &id,
        &payload,
        None,
    )?;
    transaction.commit().map_err(db_error)?;
    Ok(payload)
}

/// `desktop_hr_request_types_save`: jenis baru atau sunting.
pub fn simpan_jenis(state: &DesktopState, draft: Value) -> Result<Value, CommandError> {
    let j = validasi_jenis(&draft).map_err(invalid)?;
    let client_id = sync::ensure_client_id(state)?;
    let mut connection = storage::database(&state.data_dir)?;
    let transaction = connection.transaction().map_err(db_error)?;
    let id = match Some(teks(&draft, "id_jenis")).filter(|id| !id.is_empty()) {
        Some(id) => {
            if jenis_satu(&transaction, &id)?.is_none() {
                return Err(invalid("Jenis pengajuan tidak ditemukan."));
            }
            id
        }
        None => hris::new_id("jns-"),
    };
    let bentrok = transaction
        .query_row(BENTROK_JENIS_SQL, params![j.nama, id], |_| Ok(()))
        .optional()
        .map_err(db_error)?;
    if bentrok.is_some() {
        return Err(invalid(format!(
            "Nama \"{}\" sudah dipakai jenis pengajuan lain.",
            j.nama
        )));
    }
    let args = jenis_args(&id, &j);
    transaction
        .execute(
            SIMPAN_JENIS_SQL,
            rusqlite::params_from_iter(args.iter().map(json_ke_sql)),
        )
        .map_err(db_error)?;
    let mut payload = serde_json::to_value(&j).map_err(|_| CommandError::internal())?;
    payload["id_jenis"] = json!(id);
    sync::enqueue(
        &transaction,
        &client_id,
        "hr-request-type",
        "save",
        &id,
        &payload,
        None,
    )?;
    transaction.commit().map_err(db_error)?;
    Ok(payload)
}

// Pembaca 2b (Alfa, audit, gaji, jatah)

fn angka_kolom(r: &Value, kunci: &str) -> i64 {
    r.get(kunci).and_then(Value::as_i64).unwrap_or(0)
}

fn opsional_kolom(r: &Value, kunci: &str) -> Option<i64> {
    r.get(kunci).and_then(Value::as_i64)
}

fn berlaku_dari(r: &Value) -> Berlaku {
    Berlaku {
        id_karyawan: teks(r, "id_karyawan"),
        tanggal_mulai: teks(r, "tanggal_mulai"),
        tanggal_selesai: teks(r, "tanggal_selesai"),
        kelompok: teks(r, "kelompok"),
        dampak_gaji: teks(r, "dampak_gaji"),
        jam_mulai_ke: opsional_kolom(r, "jam_mulai_ke"),
        jam_sampai_ke: opsional_kolom(r, "jam_sampai_ke"),
        setengah_hari: angka_kolom(r, "setengah_hari") == 1,
    }
}

/// Pengajuan berlaku yang bertumpuk dengan `mulai`..`selesai`.
pub fn muat_berlaku(
    connection: &rusqlite::Connection,
    mulai: &str,
    selesai: &str,
) -> Result<Vec<Berlaku>, CommandError> {
    Ok(
        rows_json_with(connection, PENGAJUAN_RENTANG_SQL, params![mulai, selesai])?
            .iter()
            .map(berlaku_dari)
            .collect(),
    )
}

/// Pegawai yang ditutup pengajuan berlaku pada `tanggal`, dengan penanda hari
/// penuh (Generate Alfa melewati keduanya; audit membedakannya, §20.2.6).
pub fn pengajuan_pada(
    connection: &rusqlite::Connection,
    tanggal: &str,
) -> Result<HashMap<String, bool>, CommandError> {
    let mut hasil: HashMap<String, bool> = HashMap::new();
    for p in muat_berlaku(connection, tanggal, tanggal)? {
        let penuh = penuh_pada(&p, tanggal);
        *hasil.entry(p.id_karyawan).or_insert(false) |= penuh;
    }
    Ok(hasil)
}

fn muat_kalender(
    connection: &rusqlite::Connection,
    mulai: &str,
    selesai: &str,
) -> Result<(HashSet<String>, Vec<HolidayWhitelistEntry>), CommandError> {
    let libur = rows_json_with(connection, LIBUR_SQL, params![mulai, selesai])?
        .iter()
        .map(|r| teks(r, "tanggal"))
        .collect();
    let whitelist = rows_json_with(connection, WHITELIST_SQL, [])?
        .iter()
        .map(|r| HolidayWhitelistEntry {
            id: teks(r, "id"),
            scope_type: teks(r, "scope_type"),
            scope_value: teks(r, "scope_value"),
            tanggal_libur: Some(teks(r, "tanggal_libur")).filter(|t| !t.is_empty()),
            status_aktif: angka_kolom(r, "status_aktif"),
        })
        .collect();
    Ok((libur, whitelist))
}

fn jadwal_dari(r: &Value) -> Jadwal {
    Jadwal {
        divisi: teks(r, "divisi"),
        hari_masuk: parse_hari_kerja(r.get("hari_kerja").and_then(Value::as_str)),
        kode_shift: opsional_kolom(r, "kode_shift"),
    }
}

/// Kait rekap gaji (§20.2.7): `CutiDibayar` per pegawai untuk periode, dari
/// pengajuan berlaku ber-`dampak_gaji = 'Dibayar'` atas tanggal wajibnya.
pub fn cuti_dibayar(
    connection: &rusqlite::Connection,
    mulai: &str,
    akhir: &str,
) -> Result<HashMap<String, CutiDibayar>, CommandError> {
    let berlaku: Vec<Berlaku> = muat_berlaku(connection, mulai, akhir)?
        .into_iter()
        .filter(|p| p.dampak_gaji == "Dibayar")
        .collect();
    if berlaku.is_empty() {
        return Ok(HashMap::new());
    }
    let ids: Vec<&str> = berlaku.iter().map(|p| p.id_karyawan.as_str()).collect();
    let jadwal: HashMap<String, (Jadwal, i64)> = rows_json_with(
        connection,
        JADWAL_PEGAWAI_SQL,
        params![json!(ids).to_string()],
    )?
    .iter()
    .map(|r| {
        (
            teks(r, "id_unik"),
            (jadwal_dari(r), angka_kolom(r, "jam_normal")),
        )
    })
    .collect();
    let (libur, whitelist) = muat_kalender(connection, mulai, akhir)?;
    let mut absen: HashMap<String, HashMap<String, (bool, i64)>> = HashMap::new();
    for r in rows_json_with(connection, HARI_ABSEN_SQL, params![mulai, akhir])? {
        absen.entry(teks(&r, "id_karyawan")).or_default().insert(
            teks(&r, "tanggal"),
            (angka_kolom(&r, "hadir") == 1, angka_kolom(&r, "jam_kerja")),
        );
    }
    let mut tanggal: HashMap<&str, Vec<(String, bool)>> = HashMap::new();
    for p in &berlaku {
        let Some((j, _)) = jadwal.get(&p.id_karyawan) else {
            continue;
        };
        let dari = p.tanggal_mulai.as_str().max(mulai);
        let sampai = p.tanggal_selesai.as_str().min(akhir);
        for t in tanggal_wajib(j, &libur, &whitelist, dari, sampai) {
            let penuh = penuh_pada(p, &t);
            tanggal
                .entry(p.id_karyawan.as_str())
                .or_default()
                .push((t, penuh));
        }
    }
    let kosong = HashMap::new();
    Ok(tanggal
        .into_iter()
        .map(|(id, daftar)| {
            let normal = jadwal.get(id).map_or(0, |(_, n)| *n);
            let hasil = hitung_cuti_dibayar(&daftar, absen.get(id).unwrap_or(&kosong), normal);
            (id.to_owned(), hasil)
        })
        .collect())
}

/// Tanda `hadir_saat_cuti` di daftar (dipanggil `requests`). Cermin
/// `tandaiHadirSaatCuti`.
fn tandai_hadir_saat_cuti(
    connection: &rusqlite::Connection,
    pengajuan: &mut [Value],
) -> Result<(), CommandError> {
    let cuti: Vec<usize> = (0..pengajuan.len())
        .filter(|i| {
            teks(&pengajuan[*i], "kelompok") == "Cuti"
                && status_berlaku(&teks(&pengajuan[*i], "status"))
        })
        .collect();
    let (Some(mulai), Some(selesai)) = (
        cuti.iter()
            .map(|i| teks(&pengajuan[*i], "tanggal_mulai"))
            .min(),
        cuti.iter()
            .map(|i| teks(&pengajuan[*i], "tanggal_selesai"))
            .max(),
    ) else {
        return Ok(());
    };
    let hadir: HashSet<String> =
        rows_json_with(connection, HARI_ABSEN_SQL, params![mulai, selesai])?
            .iter()
            .filter(|r| angka_kolom(r, "hadir") == 1)
            .map(|r| format!("{}|{}", teks(r, "id_karyawan"), teks(r, "tanggal")))
            .collect();
    for i in cuti {
        if hadir_saat_cuti(&berlaku_dari(&pengajuan[i]), &hadir) {
            if let Some(tanda) = pengajuan[i]["tanda"].as_array_mut() {
                tanda.push(json!("hadir_saat_cuti"));
            }
        }
    }
    Ok(())
}

fn peta_aturan(connection: &rusqlite::Connection) -> Result<HashMap<String, String>, CommandError> {
    Ok(rows_json_with(connection, ATURAN_CUTI_SQL, [])?
        .iter()
        .map(|r| (teks(r, "key"), teks(r, "value")))
        .collect())
}

fn aturan_json(peta: &HashMap<String, String>) -> Value {
    json!({ "guru": aturan_cuti(peta, "guru"), "tendik": aturan_cuti(peta, "tendik") })
}

/// Tanggal terpakai jatah satu pegawai: tanggal wajib Cuti `potong_jatah`
/// yang berlaku, dikurangi tanggal Hadir (Hadir menang).
fn tanggal_terpakai(
    connection: &rusqlite::Connection,
    id: &str,
    jadwal: &Jadwal,
) -> Result<Vec<String>, CommandError> {
    let rentang: Vec<(String, String)> =
        rows_json_with(connection, JATAH_TERPAKAI_SQL, params![id])?
            .iter()
            .map(|r| (teks(r, "tanggal_mulai"), teks(r, "tanggal_selesai")))
            .collect();
    let (Some(mulai), Some(selesai)) = (
        rentang.iter().map(|r| r.0.clone()).min(),
        rentang.iter().map(|r| r.1.clone()).max(),
    ) else {
        return Ok(Vec::new());
    };
    let (libur, whitelist) = muat_kalender(connection, &mulai, &selesai)?;
    let hadir: HashSet<String> =
        rows_json_with(connection, HADIR_ORANG_SQL, params![id, mulai, selesai])?
            .iter()
            .map(|r| teks(r, "tanggal"))
            .collect();
    let mut tanggal: Vec<String> = rentang
        .iter()
        .flat_map(|(a, b)| tanggal_wajib(jadwal, &libur, &whitelist, a, b))
        .filter(|t| !hadir.contains(t))
        .collect();
    tanggal.sort();
    tanggal.dedup();
    Ok(tanggal)
}

/// Jatah satu pegawai: periode, penyesuaian, riwayat, tanda. Dipakai
/// `saldo_cuti` dan pemeriksa periode penyesuaian.
fn jatah_pegawai(
    connection: &rusqlite::Connection,
    peta: &HashMap<String, String>,
    id: &str,
    hari_ini: &str,
) -> Result<Option<(Value, Jadwal, Vec<PeriodeCuti>)>, CommandError> {
    let Some(p) = rows_json_with(connection, JATAH_PEGAWAI_SQL, params![id])?
        .into_iter()
        .next()
    else {
        return Ok(None);
    };
    let kelompok = if angka_kolom(&p, "guru") == 1 {
        "guru"
    } else {
        "tendik"
    };
    let jadwal = jadwal_dari(&p);
    let penyesuaian = rows_json_with(connection, PENYESUAIAN_ORANG_SQL, params![id])?;
    let aktif: Vec<(String, i64)> = penyesuaian
        .iter()
        .filter(|r| teks(r, "jenis") != "Pembatalan" && angka_kolom(r, "dibatalkan") == 0)
        .map(|r| (teks(r, "periode"), angka_kolom(r, "hari")))
        .collect();
    let tmt = teks(&p, "tmt");
    let terpakai = tanggal_terpakai(connection, id, &jadwal)?;
    let periode = jatah_cuti(
        Some(tmt.as_str()).filter(|t| !t.is_empty()),
        &aturan_cuti(peta, kelompok),
        &terpakai,
        &aktif,
        hari_ini,
    );
    let berjalan = periode
        .iter()
        .find(|x| x.mulai.as_str() <= hari_ini && hari_ini <= x.selesai.as_str());
    let mut tanda = Vec::new();
    if tmt.is_empty() {
        tanda.push("tanpa_tmt");
    }
    if berjalan.is_some_and(|x| x.sisa < 0) {
        tanda.push("jatah_minus");
    }
    let info = json!({
        "id_karyawan": id,
        "nama": teks(&p, "nama"),
        "unit": teks(&p, "unit"),
        "kelompok": kelompok,
        "tmt": tmt,
        "tanda": tanda,
        "berjalan": berjalan,
        "penyesuaian": penyesuaian,
    });
    Ok(Some((info, jadwal, periode)))
}

/// `desktop_hr_leave_balance`: aturan kedua kelompok; dengan `id_karyawan`
/// juga jatah per periode, penyesuaian, riwayat pengajuan, dan (bila rentang
/// dibawa) jumlah tanggal wajibnya untuk form Ajukan.
pub fn saldo_cuti(
    state: &DesktopState,
    id_karyawan: Option<&str>,
    mulai: Option<&str>,
    selesai: Option<&str>,
) -> Result<Value, CommandError> {
    let connection = storage::database(&state.data_dir)?;
    let (_, hari_ini) = waktu(&connection)?;
    let peta = peta_aturan(&connection)?;
    let mut hasil = json!({ "aturan": aturan_json(&peta), "hari_ini": hari_ini, "pegawai": null });
    let Some(id) = id_karyawan.map(str::trim).filter(|id| !id.is_empty()) else {
        return Ok(hasil);
    };
    let (mut info, jadwal, periode) = jatah_pegawai(&connection, &peta, id, &hari_ini)?
        .ok_or_else(|| invalid("Jatah cuti hanya untuk pegawai (guru dan tendik)."))?;
    let mut riwayat = rows_json_with(&connection, RIWAYAT_PENGAJUAN_SQL, params![id])?;
    let ids: Vec<String> = riwayat.iter().map(|p| teks(p, "id_pengajuan")).collect();
    let keputusan = rows_json_with(
        &connection,
        DAFTAR_KEPUTUSAN_SQL,
        params![json!(ids).to_string()],
    )?;
    susun_daftar(&mut riwayat, &keputusan);
    tandai_hadir_saat_cuti(&connection, &mut riwayat)?;
    info["periode"] = json!(periode);
    info["riwayat"] = Value::Array(riwayat);
    if let (Some(a), Some(b)) = (mulai, selesai) {
        if !tanggal_valid(a)
            || !tanggal_valid(b)
            || b < a
            || days_between(a, b).unwrap_or(i64::MAX) >= MAKS_RENTANG_HARI
        {
            return Err(invalid("Rentang tanggal tidak valid."));
        }
        let (libur, whitelist) = muat_kalender(&connection, a, b)?;
        info["hari_wajib"] = json!(tanggal_wajib(&jadwal, &libur, &whitelist, a, b).len());
    }
    hasil["pegawai"] = info;
    Ok(hasil)
}

/// `desktop_hr_leave_settings_save`: aturan cuti guru dan tendik lewat outbox
/// `setting`.
pub fn simpan_aturan_cuti(state: &DesktopState, draft: Value) -> Result<Value, CommandError> {
    let pasangan = validasi_aturan_cuti(&draft).map_err(invalid)?;
    let client_id = sync::ensure_client_id(state)?;
    let mut connection = storage::database(&state.data_dir)?;
    let transaction = connection.transaction().map_err(db_error)?;
    for (kunci, nilai) in &pasangan {
        hris::tulis_setting(&transaction, &client_id, kunci, nilai)?;
    }
    let hasil = aturan_json(&peta_aturan(&transaction)?);
    transaction.commit().map_err(db_error)?;
    Ok(hasil)
}

/// `desktop_hr_leave_adjust`: penyesuaian jatah append-only, atau pembatalan
/// berid `batal-<id>`.
pub fn sesuaikan_cuti(
    state: &DesktopState,
    operator: &OperatorUser,
    draft: Value,
) -> Result<Value, CommandError> {
    let s = validasi_penyesuaian(&draft).map_err(invalid)?;
    let client_id = sync::ensure_client_id(state)?;
    let mut connection = storage::database(&state.data_dir)?;
    let transaction = connection.transaction().map_err(db_error)?;
    let payload = if s.batal.is_empty() {
        let (_, hari_ini) = waktu(&transaction)?;
        let peta = peta_aturan(&transaction)?;
        let (_, _, periode) = jatah_pegawai(&transaction, &peta, &s.id_karyawan, &hari_ini)?
            .ok_or_else(|| invalid("Jatah cuti hanya untuk pegawai (guru dan tendik)."))?;
        if !periode.iter().any(|p| p.mulai == s.periode) {
            return Err(invalid("Periode itu bukan periode jatah pegawai ini."));
        }
        json!({
            "id_penyesuaian": hris::new_id("cpy-"),
            "id_karyawan": s.id_karyawan,
            "periode": s.periode,
            "jenis": s.jenis,
            "id_ref": "",
            "hari": s.hari,
            "alasan": s.alasan,
            "dicatat_oleh": operator.username,
        })
    } else {
        let target = rows_json_with(&transaction, PENYESUAIAN_SATU_SQL, params![s.batal])?
            .into_iter()
            .next()
            .filter(|r| teks(r, "jenis") != "Pembatalan")
            .ok_or_else(|| invalid("Penyesuaian tidak ditemukan."))?;
        if angka_kolom(&target, "dibatalkan") == 1 {
            return Err(invalid("Penyesuaian ini sudah dibatalkan."));
        }
        json!({
            "id_penyesuaian": format!("batal-{}", s.batal),
            "id_karyawan": teks(&target, "id_karyawan"),
            "periode": teks(&target, "periode"),
            "jenis": "Pembatalan",
            "id_ref": s.batal,
            "hari": 0,
            "alasan": s.alasan,
            "dicatat_oleh": operator.username,
        })
    };
    let id = teks(&payload, "id_penyesuaian");
    for (sql, args) in cloud_penyesuaian_statements(&payload, &id) {
        transaction
            .execute(
                &sql,
                rusqlite::params_from_iter(args.iter().map(json_ke_sql)),
            )
            .map_err(db_error)?;
    }
    sync::enqueue(
        &transaction,
        &client_id,
        "hr-leave-adjustment",
        "create",
        &id,
        &payload,
        None,
    )?;
    transaction.commit().map_err(db_error)?;
    Ok(payload)
}

// Sub-fase 2c: JP terdampak dan penanganannya (§20.2.5, §20.2.8, §20.2.9)

pub const STATUS_PENANGANAN: [&str; 3] = ["Diganti", "Tugas Mandiri", "Digabung"];

/// Pengajuan guru yang Menunggu ATAU berlaku (bukan Ditolak/Dibatalkan) dan
/// punya jadwal aktif, bertumpuk `?1..?2`; `?3` satu pengajuan atau `''`.
/// Predikatnya turunan harfiah `PENGAJUAN_AKTIF_ORANG_SQL`.
pub const JP_TERDAMPAK_SQL: &str = "SELECT p.id_pengajuan, p.id_karyawan, COALESCE(m.nama, p.id_karyawan) AS nama_guru, p.tanggal_mulai, p.tanggal_selesai, p.jam_mulai_ke, p.jam_sampai_ke FROM hr_pengajuan p LEFT JOIN master_data m ON m.id_unik = p.id_karyawan WHERE p.tanggal_mulai <= ?2 AND p.tanggal_selesai >= ?1 AND (?3 = '' OR p.id_pengajuan = ?3) AND EXISTS (SELECT 1 FROM jadwal_mengajar j WHERE j.id_guru = p.id_karyawan AND j.is_aktif = 1) AND NOT EXISTS (SELECT 1 FROM hr_pengajuan_keputusan b WHERE b.id_pengajuan = p.id_pengajuan AND b.jenis = 'Batal') AND COALESCE((SELECT k.jenis FROM hr_pengajuan_keputusan k WHERE k.id_pengajuan = p.id_pengajuan AND k.sidik = p.sidik AND k.jenis IN ('Setujui', 'Tolak', 'Setujui Urgent') ORDER BY k.diterima_cloud IS NULL, k.diterima_cloud, k.waktu_perangkat, k.id_keputusan LIMIT 1), '') <> 'Tolak' ORDER BY p.tanggal_mulai, p.id_pengajuan\n-- batas: pengajuan guru yang bertumpuk rentang, sebesar jumlah guru kali pengajuan\n;";
/// Jadwal aktif dari tahun ajaran yang semesternya bertumpuk `?1..?2`, dengan
/// unit rombel (unit JP, Q-42). Dipakai JP terdampak dan cek bentrok pengganti.
pub const JADWAL_JP_SQL: &str = "SELECT j.id_jadwal, j.id_guru, j.hari, j.jam_ke, j.id_rombel, COALESCE(r.nama_rombel, j.id_rombel) AS nama_rombel, j.id_mapel, COALESCE(mp.nama_mapel, j.id_mapel) AS nama_mapel, COALESCE(u.nama_unit, '') AS unit, t.tanggal_mulai AS ta_mulai, t.tanggal_selesai AS ta_selesai FROM jadwal_mengajar j JOIN akademik_tahun_ajaran t ON t.id_tahun_ajaran = j.id_tahun_ajaran LEFT JOIN akademik_rombel r ON r.id_rombel = j.id_rombel LEFT JOIN akademik_mapel mp ON mp.id_mapel = j.id_mapel LEFT JOIN akademik_unit u ON u.id_unit = r.id_unit WHERE j.is_aktif = 1 AND t.tanggal_mulai <= ?2 AND t.tanggal_selesai >= ?1 ORDER BY j.id_guru, j.hari, CAST(j.jam_ke AS INTEGER), j.jam_ke, j.id_jadwal\n-- batas: jadwal mingguan semester yang bertumpuk rentang, sebesar rombel kali jam pelajaran\n;";
/// Penanganan tercatat `?1..?2` milik pengajuan yang masih Menunggu/berlaku.
pub const PENANGANAN_SQL: &str = "SELECT h.id_penanganan, h.id_pengajuan, h.tanggal, h.id_jadwal, COALESCE(h.jam_ke, '') AS jam_ke, h.status, COALESCE(h.id_guru_pengganti, '') AS id_guru_pengganti, COALESCE(mg.nama, h.id_guru_pengganti, '') AS nama_pengganti, COALESCE(h.catatan, '') AS catatan, h.dicatat_oleh, h.waktu_perangkat FROM hr_jp_penanganan h JOIN hr_pengajuan p ON p.id_pengajuan = h.id_pengajuan LEFT JOIN master_data mg ON mg.id_unik = h.id_guru_pengganti WHERE h.tanggal >= ?1 AND h.tanggal <= ?2 AND NOT EXISTS (SELECT 1 FROM hr_pengajuan_keputusan b WHERE b.id_pengajuan = p.id_pengajuan AND b.jenis = 'Batal') AND COALESCE((SELECT k.jenis FROM hr_pengajuan_keputusan k WHERE k.id_pengajuan = p.id_pengajuan AND k.sidik = p.sidik AND k.jenis IN ('Setujui', 'Tolak', 'Setujui Urgent') ORDER BY k.diterima_cloud IS NULL, k.diterima_cloud, k.waktu_perangkat, k.id_keputusan LIMIT 1), '') <> 'Tolak' ORDER BY h.tanggal, h.id_penanganan\n-- batas: satu baris per JP terdampak dalam rentang\n;";
/// Presensi kelas yang tersimpan `?1..?2`, untuk tanda `pengganti_berbeda`.
pub const PRESENSI_JP_SQL: &str = "SELECT id_rombel, tanggal, jam_ke, id_guru FROM presensi_mapel WHERE tanggal >= ?1 AND tanggal <= ?2 ORDER BY tanggal, id_rombel\n-- batas: sesi presensi kelas dalam rentang pengajuan\n;";
pub const GURU_AKTIF_SQL: &str = "SELECT 1 FROM master_data m JOIN guru_data g ON g.id_guru = m.id_unik WHERE m.id_unik = ?1 AND COALESCE(m.status_aktif, 'Aktif') = 'Aktif' LIMIT 1;";

pub const PESAN_JP_SENDIRI: &str = "Jam pelajaranmu sendiri harus ditangani orang lain.";
pub const PESAN_CAKUPAN_JP: &str = "Rombel ini di luar unit yang kamu pegang.";
pub const PESAN_BENTROK_PENGGANTI: &str =
    "Guru pengganti sudah punya jadwal atau tugas pengganti lain di jam itu.";

#[derive(Debug, Clone, Deserialize)]
pub struct PengajuanJp {
    pub id_pengajuan: String,
    pub id_karyawan: String,
    #[serde(default)]
    pub nama_guru: String,
    pub tanggal_mulai: String,
    pub tanggal_selesai: String,
    #[serde(default)]
    pub jam_mulai_ke: Option<i64>,
    #[serde(default)]
    pub jam_sampai_ke: Option<i64>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct JadwalJp {
    pub id_jadwal: String,
    pub id_guru: String,
    pub hari: i64,
    pub jam_ke: String,
    pub id_rombel: String,
    pub nama_rombel: String,
    pub id_mapel: String,
    pub nama_mapel: String,
    pub unit: String,
    pub ta_mulai: String,
    pub ta_selesai: String,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
pub struct Jp {
    pub id_penanganan: String,
    pub id_pengajuan: String,
    pub id_karyawan: String,
    pub nama_guru: String,
    pub tanggal: String,
    pub id_jadwal: String,
    pub jam_ke: String,
    pub id_rombel: String,
    pub nama_rombel: String,
    pub id_mapel: String,
    pub nama_mapel: String,
    pub unit: String,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
pub struct Penanganan {
    pub id_penanganan: String,
    pub id_pengajuan: String,
    pub tanggal: String,
    pub id_jadwal: String,
    pub jam_ke: String,
    pub status: String,
    pub id_guru_pengganti: String,
    #[serde(default)]
    pub nama_pengganti: String,
    #[serde(default)]
    pub catatan: String,
    #[serde(default)]
    pub dicatat_oleh: String,
    #[serde(default)]
    pub waktu_perangkat: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct PresensiJp {
    pub id_rombel: String,
    pub tanggal: String,
    pub jam_ke: String,
    pub id_guru: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct JpTersusun {
    #[serde(flatten)]
    pub jp: Jp,
    pub penanganan: Option<Penanganan>,
    pub tanda: Vec<String>,
}

pub fn id_penanganan(id_pengajuan: &str, tanggal: &str, id_jadwal: &str) -> String {
    format!("jp:{id_pengajuan}:{tanggal}:{id_jadwal}")
}

fn jam_awal(jam_ke: &str) -> i64 {
    jam_ke_range(jam_ke).map_or(0, |(a, _)| i64::from(a))
}

fn beririsan(a: &str, b: &str) -> bool {
    match (jam_ke_range(a), jam_ke_range(b)) {
        (Some((a0, a1)), Some((b0, b1))) => a0 <= b1 && b0 <= a1,
        _ => false,
    }
}

fn ta_memuat(j: &JadwalJp, t: &str) -> bool {
    j.ta_mulai.as_str() <= t && t <= j.ta_selesai.as_str()
}

/// Cermin `jpTerdampak` (§20.2.5): setiap tanggal rentang yang bukan libur,
/// setiap jadwal guru pada hari itu dari tahun ajaran yang memuat tanggalnya,
/// yang `jam_ke`-nya beririsan dengan jam pengajuan (hari pertama dari
/// `jam_mulai_ke`, hari terakhir sampai `jam_sampai_ke`, hari tengah penuh).
/// Baris rentang (`3-4`) yang tersentuh sebagian dihitung utuh (Q-46).
pub fn jp_terdampak(
    pengajuan: &[PengajuanJp],
    jadwal: &[JadwalJp],
    libur: &HashSet<String>,
    dari: &str,
    sampai: &str,
) -> Vec<Jp> {
    let mut hasil = Vec::new();
    for p in pengajuan {
        let r = Ringkas {
            id_karyawan: p.id_karyawan.clone(),
            tanggal_mulai: p.tanggal_mulai.clone(),
            tanggal_selesai: p.tanggal_selesai.clone(),
            jam_mulai_ke: p.jam_mulai_ke,
            jam_sampai_ke: p.jam_sampai_ke,
        };
        let mulai = p.tanggal_mulai.as_str().max(dari);
        let selesai = p.tanggal_selesai.as_str().min(sampai);
        for t in tanggal_rentang(mulai, selesai) {
            if libur.contains(&t) {
                continue;
            }
            let Some(hari) = hari_iso(&t) else {
                continue;
            };
            let (awal, akhir) = jam_pada(&r, &t);
            for j in jadwal.iter().filter(|j| {
                j.id_guru == p.id_karyawan && j.hari == hari && ta_memuat(j, &t)
            }) {
                let Some((j0, j1)) = jam_ke_range(&j.jam_ke) else {
                    continue;
                };
                if i64::from(j0) <= akhir && awal <= i64::from(j1) {
                    hasil.push(Jp {
                        id_penanganan: id_penanganan(&p.id_pengajuan, &t, &j.id_jadwal),
                        id_pengajuan: p.id_pengajuan.clone(),
                        id_karyawan: p.id_karyawan.clone(),
                        nama_guru: p.nama_guru.clone(),
                        tanggal: t.clone(),
                        id_jadwal: j.id_jadwal.clone(),
                        jam_ke: j.jam_ke.clone(),
                        id_rombel: j.id_rombel.clone(),
                        nama_rombel: j.nama_rombel.clone(),
                        id_mapel: j.id_mapel.clone(),
                        nama_mapel: j.nama_mapel.clone(),
                        unit: j.unit.clone(),
                    });
                }
            }
        }
    }
    hasil.sort_by(|a, b| {
        (a.tanggal.as_str(), jam_awal(&a.jam_ke), a.id_penanganan.as_str()).cmp(&(
            b.tanggal.as_str(),
            jam_awal(&b.jam_ke),
            b.id_penanganan.as_str(),
        ))
    });
    hasil
}

/// Cermin `penggantiBentrok`: Diganti bentrok dengan jadwal pengganti sendiri
/// atau penanganan lain atas namanya di jam yang beririsan; Digabung memang
/// mengajar kelasnya sendiri, jadi hanya bentrok dengan tugas Diganti.
pub fn pengganti_bentrok(
    pengganti: &str,
    status: &str,
    tanggal: &str,
    jam_ke: &str,
    id_sendiri: &str,
    jadwal: &[JadwalJp],
    penanganan: &[Penanganan],
) -> bool {
    if pengganti.is_empty() || status == "Tugas Mandiri" {
        return false;
    }
    let hari = hari_iso(tanggal);
    let jadwal_bentrok = status == "Diganti"
        && jadwal.iter().any(|j| {
            j.id_guru == pengganti
                && Some(j.hari) == hari
                && ta_memuat(j, tanggal)
                && beririsan(&j.jam_ke, jam_ke)
        });
    jadwal_bentrok
        || penanganan.iter().any(|h| {
            h.id_penanganan != id_sendiri
                && h.id_guru_pengganti == pengganti
                && h.tanggal == tanggal
                && (status == "Diganti" || h.status == "Diganti")
                && beririsan(&h.jam_ke, jam_ke)
        })
}

/// Cermin `susunJp`: penanganan per JP dan tandanya (tidak pernah menolak).
pub fn susun_jp(
    jp: Vec<Jp>,
    penanganan: &[Penanganan],
    presensi: &[PresensiJp],
    jadwal: &[JadwalJp],
) -> Vec<JpTersusun> {
    jp.into_iter()
        .map(|j| {
            let h = penanganan
                .iter()
                .find(|h| h.id_penanganan == j.id_penanganan)
                .cloned();
            let mut tanda = Vec::new();
            if let Some(h) = &h {
                let pengganti = h.id_guru_pengganti.as_str();
                if !pengganti.is_empty()
                    && presensi.iter().any(|s| {
                        s.id_rombel == j.id_rombel
                            && s.tanggal == j.tanggal
                            && s.id_guru != pengganti
                            && beririsan(&s.jam_ke, &j.jam_ke)
                    })
                {
                    tanda.push("pengganti_berbeda".to_owned());
                }
                if pengganti_bentrok(
                    pengganti,
                    &h.status,
                    &j.tanggal,
                    &j.jam_ke,
                    &j.id_penanganan,
                    jadwal,
                    penanganan,
                ) {
                    tanda.push("pengganti_bentrok".to_owned());
                }
            }
            JpTersusun {
                jp: j,
                penanganan: h,
                tanda,
            }
        })
        .collect()
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
pub struct HitungJp {
    pub total: i64,
    pub belum: i64,
}

/// Cermin `hitungJp`: JP terdampak dan yang belum ditangani per pengajuan.
pub fn hitung_jp(jp: &[Jp], ditangani: &HashSet<String>) -> BTreeMap<String, HitungJp> {
    let mut hasil: BTreeMap<String, HitungJp> = BTreeMap::new();
    for j in jp {
        let h = hasil
            .entry(j.id_pengajuan.clone())
            .or_insert(HitungJp { total: 0, belum: 0 });
        h.total += 1;
        if !ditangani.contains(&j.id_penanganan) {
            h.belum += 1;
        }
    }
    hasil
}

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
pub struct PenangananSah {
    pub id_pengajuan: String,
    pub tanggal: String,
    pub id_jadwal: String,
    pub status: String,
    pub id_guru_pengganti: String,
    pub catatan: String,
}

/// Cermin `validasiPenanganan`. Tugas Mandiri tanpa pengganti.
pub fn validasi_penanganan(draft: &Value) -> Result<PenangananSah, String> {
    let id_pengajuan = teks(draft, "id_pengajuan");
    let id_jadwal = teks(draft, "id_jadwal");
    if id_pengajuan.is_empty() || id_jadwal.is_empty() {
        return Err("Jam pelajaran yang ditangani tidak dikenal.".into());
    }
    let tanggal = teks(draft, "tanggal");
    if !tanggal_valid(&tanggal) {
        return Err("Tanggal tidak valid.".into());
    }
    let status = teks(draft, "status");
    if !STATUS_PENANGANAN.contains(&status.as_str()) {
        return Err("Status penanganan tidak dikenal.".into());
    }
    let id_guru_pengganti = if status == "Tugas Mandiri" {
        String::new()
    } else {
        teks(draft, "id_guru_pengganti")
    };
    if status != "Tugas Mandiri" && id_guru_pengganti.is_empty() {
        return Err("Pilih guru pengganti.".into());
    }
    let catatan = teks(draft, "catatan");
    if panjang(&catatan) > MAKS_ALASAN {
        return Err(format!("Catatan maksimal {MAKS_ALASAN} karakter."));
    }
    Ok(PenangananSah {
        id_pengajuan,
        tanggal,
        id_jadwal,
        status,
        id_guru_pengganti,
        catatan,
    })
}

/// Cermin `periksaPenanganan` (§20.2.8, §20.2.9): bukan JP sendiri, dalam
/// cakupan unit JP, dan pengganti bukan guru yang berhalangan.
pub fn periksa_penanganan(
    guru_jp: &str,
    pengganti: &str,
    sesi_karyawan: &str,
    dalam_cakupan: bool,
) -> Result<(), String> {
    if !sesi_karyawan.is_empty() && sesi_karyawan == guru_jp {
        return Err(PESAN_JP_SENDIRI.into());
    }
    if !dalam_cakupan {
        return Err(PESAN_CAKUPAN_JP.into());
    }
    if !pengganti.is_empty() && pengganti == guru_jp {
        return Err("Guru pengganti tidak boleh guru yang berhalangan.".into());
    }
    Ok(())
}

fn dari_baris<T: serde::de::DeserializeOwned>(rows: Vec<Value>) -> Vec<T> {
    rows.into_iter()
        .filter_map(|r| serde_json::from_value(r).ok())
        .collect()
}

/// JP terdampak `dari..sampai` beserta jadwal yang dipakai menilainya.
fn muat_jp(
    connection: &rusqlite::Connection,
    dari: &str,
    sampai: &str,
    id_pengajuan: &str,
) -> Result<(Vec<Jp>, Vec<JadwalJp>), CommandError> {
    let pengajuan: Vec<PengajuanJp> = dari_baris(rows_json_with(
        connection,
        JP_TERDAMPAK_SQL,
        params![dari, sampai, id_pengajuan],
    )?);
    let jadwal: Vec<JadwalJp> =
        dari_baris(rows_json_with(connection, JADWAL_JP_SQL, params![dari, sampai])?);
    if pengajuan.is_empty() {
        return Ok((Vec::new(), jadwal));
    }
    let (libur, _) = muat_kalender(connection, dari, sampai)?;
    Ok((jp_terdampak(&pengajuan, &jadwal, &libur, dari, sampai), jadwal))
}

fn muat_penanganan(
    connection: &rusqlite::Connection,
    dari: &str,
    sampai: &str,
) -> Result<Vec<Penanganan>, CommandError> {
    Ok(dari_baris(rows_json_with(
        connection,
        PENANGANAN_SQL,
        params![dari, sampai],
    )?))
}

/// Hitungan JP per pengajuan untuk daftar `/pengajuan` (rentang semua
/// pengajuan guru di daftar).
fn hitung_jp_daftar(
    connection: &rusqlite::Connection,
    pengajuan: &[Value],
) -> Result<BTreeMap<String, HitungJp>, CommandError> {
    let guru: Vec<&Value> = pengajuan
        .iter()
        .filter(|p| angka_kolom(p, "guru") == 1)
        .collect();
    let (Some(dari), Some(sampai)) = (
        guru.iter().map(|p| teks(p, "tanggal_mulai")).min(),
        guru.iter().map(|p| teks(p, "tanggal_selesai")).max(),
    ) else {
        return Ok(BTreeMap::new());
    };
    let (jp, _) = muat_jp(connection, &dari, &sampai, "")?;
    let ditangani = muat_penanganan(connection, &dari, &sampai)?
        .into_iter()
        .map(|h| h.id_penanganan)
        .collect();
    Ok(hitung_jp(&jp, &ditangani))
}

/// `desktop_hr_affected_jp`: JP terdampak satu pengajuan, satu tanggal (Jam
/// Kosong, bawaan hari ini WIB), atau isian form Ajukan yang belum disimpan.
pub fn jp_terdampak_baca(
    state: &DesktopState,
    operator: &OperatorUser,
    id_pengajuan: Option<&str>,
    tanggal: Option<&str>,
    draft: Option<&Value>,
) -> Result<Value, CommandError> {
    let connection = storage::database(&state.data_dir)?;
    let sesi = json!({
        "id_karyawan": tautan(operator),
        "unit": unit_akun(&connection, operator)?,
        "lingkup_semua": punya(operator, "hr.scope.all"),
    });
    if let Some(d) = draft {
        let p = PengajuanJp {
            id_pengajuan: String::new(),
            id_karyawan: teks(d, "id_karyawan"),
            nama_guru: String::new(),
            tanggal_mulai: teks(d, "tanggal_mulai"),
            tanggal_selesai: teks(d, "tanggal_selesai"),
            jam_mulai_ke: opsional_kolom(d, "jam_mulai_ke"),
            jam_sampai_ke: opsional_kolom(d, "jam_sampai_ke"),
        };
        if !tanggal_valid(&p.tanggal_mulai)
            || !tanggal_valid(&p.tanggal_selesai)
            || p.tanggal_selesai < p.tanggal_mulai
            || days_between(&p.tanggal_mulai, &p.tanggal_selesai).unwrap_or(i64::MAX)
                >= MAKS_RENTANG_HARI
        {
            return Err(invalid("Rentang tanggal tidak valid."));
        }
        let jadwal: Vec<JadwalJp> = dari_baris(rows_json_with(
            &connection,
            JADWAL_JP_SQL,
            params![p.tanggal_mulai, p.tanggal_selesai],
        )?);
        let (libur, _) = muat_kalender(&connection, &p.tanggal_mulai, &p.tanggal_selesai)?;
        let (dari, sampai) = (p.tanggal_mulai.clone(), p.tanggal_selesai.clone());
        let jp = jp_terdampak(&[p], &jadwal, &libur, &dari, &sampai);
        return Ok(json!({ "jp": susun_jp(jp, &[], &[], &[]), "dari": dari, "sampai": sampai, "sesi": sesi }));
    }
    let (dari, sampai, id) = match id_pengajuan.map(str::trim).filter(|id| !id.is_empty()) {
        Some(id) => {
            let p = rows_json_with(&connection, PENGAJUAN_SATU_SQL, params![id])?
                .into_iter()
                .next()
                .ok_or_else(|| invalid("Pengajuan tidak ditemukan."))?;
            (teks(&p, "tanggal_mulai"), teks(&p, "tanggal_selesai"), id.to_owned())
        }
        None => {
            let t = match tanggal.map(str::trim).filter(|t| !t.is_empty()) {
                Some(t) => t.to_owned(),
                None => waktu(&connection)?.1,
            };
            if !tanggal_valid(&t) {
                return Err(invalid("Tanggal tidak valid."));
            }
            (t.clone(), t, String::new())
        }
    };
    let (jp, jadwal) = muat_jp(&connection, &dari, &sampai, &id)?;
    let penanganan = muat_penanganan(&connection, &dari, &sampai)?;
    let presensi: Vec<PresensiJp> =
        dari_baris(rows_json_with(&connection, PRESENSI_JP_SQL, params![dari, sampai])?);
    let guru: Vec<Value> = rows_json_with(&connection, PEGAWAI_PENGAJUAN_SQL, [])?
        .into_iter()
        .filter(|p| angka_kolom(p, "guru") == 1)
        .collect();
    Ok(json!({
        "jp": susun_jp(jp, &penanganan, &presensi, &jadwal),
        "jadwal": jadwal,
        "penanganan": penanganan,
        "guru": guru,
        "dari": dari,
        "sampai": sampai,
        "sesi": sesi,
    }))
}

/// `desktop_hr_substitute_save`: Diganti, Tugas Mandiri, atau Digabung atas id
/// deterministik (Q-48). JP, unit, dan guru asli dinilai ulang dari database
/// lokal; cakupan dan "bukan JP sendiri" dari sesi.
pub fn simpan_penanganan(
    state: &DesktopState,
    operator: &OperatorUser,
    draft: Value,
) -> Result<Value, CommandError> {
    let s = validasi_penanganan(&draft).map_err(invalid)?;
    let client_id = sync::ensure_client_id(state)?;
    let mut connection = storage::database(&state.data_dir)?;
    let transaction = connection.transaction().map_err(db_error)?;
    let id = id_penanganan(&s.id_pengajuan, &s.tanggal, &s.id_jadwal);
    let (jp, jadwal) = muat_jp(&transaction, &s.tanggal, &s.tanggal, &s.id_pengajuan)?;
    let j = jp
        .into_iter()
        .find(|j| j.id_penanganan == id)
        .ok_or_else(|| invalid("Jam pelajaran itu tidak (lagi) terdampak pengajuan ini."))?;
    let cakupan = dalam_cakupan(
        punya(operator, "hr.scope.all"),
        &unit_akun(&transaction, operator)?,
        &j.unit,
    );
    periksa_penanganan(&j.id_karyawan, &s.id_guru_pengganti, &tautan(operator), cakupan)
        .map_err(invalid)?;
    if !s.id_guru_pengganti.is_empty()
        && transaction
            .query_row(GURU_AKTIF_SQL, params![s.id_guru_pengganti], |_| Ok(()))
            .optional()
            .map_err(db_error)?
            .is_none()
    {
        return Err(invalid("Guru pengganti tidak ditemukan atau tidak aktif."));
    }
    let (sekarang, _) = waktu(&transaction)?;
    let payload = json!({
        "id_penanganan": id,
        "id_pengajuan": s.id_pengajuan,
        "tanggal": s.tanggal,
        "id_jadwal": s.id_jadwal,
        "id_rombel": j.id_rombel,
        "id_mapel": j.id_mapel,
        "jam_ke": j.jam_ke,
        "status": s.status,
        "id_guru_pengganti": s.id_guru_pengganti,
        "catatan": s.catatan,
        "dicatat_oleh": operator.username,
        "waktu_perangkat": sekarang,
    });
    let lain = muat_penanganan(&transaction, &s.tanggal, &s.tanggal)?;
    let bentrok = pengganti_bentrok(
        &s.id_guru_pengganti,
        &s.status,
        &s.tanggal,
        &j.jam_ke,
        &id,
        &jadwal,
        &lain,
    );
    for (sql, args) in cloud_penanganan_statements(&payload, &id) {
        transaction
            .execute(
                &sql,
                rusqlite::params_from_iter(args.iter().map(json_ke_sql)),
            )
            .map_err(db_error)?;
    }
    sync::enqueue(
        &transaction,
        &client_id,
        "hr-substitute",
        "save",
        &id,
        &payload,
        None,
    )?;
    transaction.commit().map_err(db_error)?;
    Ok(json!({
        "penanganan": payload,
        "peringatan": if bentrok { Some(PESAN_BENTROK_PENGGANTI) } else { None },
    }))
}

/// `desktop_hr_my_substitutions`: JP hari ini (WIB) yang Diganti/Digabung atas
/// nama personil sesi, untuk isi otomatis presensi kelas. Akun tak tertaut =
/// daftar kosong.
pub fn ganti_saya(state: &DesktopState, operator: &OperatorUser) -> Result<Value, CommandError> {
    let connection = storage::database(&state.data_dir)?;
    let (_, hari_ini) = waktu(&connection)?;
    let saya = tautan(operator);
    if saya.is_empty() {
        return Ok(json!({ "tanggal": hari_ini, "jp": [] }));
    }
    let (jp, _) = muat_jp(&connection, &hari_ini, &hari_ini, "")?;
    let penanganan: Vec<Penanganan> = muat_penanganan(&connection, &hari_ini, &hari_ini)?
        .into_iter()
        .filter(|h| h.id_guru_pengganti == saya && h.status != "Tugas Mandiri")
        .collect();
    let milik: Vec<Jp> = jp
        .into_iter()
        .filter(|j| penanganan.iter().any(|h| h.id_penanganan == j.id_penanganan))
        .collect();
    Ok(json!({ "tanggal": hari_ini, "jp": susun_jp(milik, &penanganan, &[], &[]) }))
}

#[cfg(test)]
mod tests {
    // Vektor yang sama diuji `validations/hr-pengajuan.test.ts`.
    use super::*;

    const VEKTOR: &str = include_str!("../../../src/lib/validations/hr-pengajuan.vektor.json");

    fn vektor() -> Value {
        serde_json::from_str(VEKTOR).expect("vektor hr-pengajuan")
    }

    fn galat<T>(hasil: Result<T, String>) -> Value {
        hasil.err().map_or(Value::Null, Value::String)
    }

    fn jenis(v: &Value) -> JenisPengajuan {
        serde_json::from_value(v.clone()).expect("jenis")
    }

    #[test]
    fn hr_pengajuan_vektor_jenis() {
        for k in vektor()["jenis"].as_array().expect("jenis") {
            let hasil = validasi_jenis(&k["masuk"]);
            assert_eq!(galat(hasil.clone()), k["galat"], "{}", k["masuk"]);
            if let Ok(j) = hasil {
                assert_eq!(serde_json::to_value(j).expect("json"), k["hasil"]);
            }
        }
    }

    #[test]
    fn hr_pengajuan_vektor_isian() {
        for k in vektor()["pengajuan"].as_array().expect("pengajuan") {
            let hasil = validasi_pengajuan(&k["masuk"]);
            assert_eq!(galat(hasil.clone()), k["galat"], "{}", k["masuk"]);
            if let Ok(p) = hasil {
                assert_eq!(serde_json::to_value(p).expect("json"), k["hasil"]);
            }
        }
        for k in vektor()["periksa_jenis"].as_array().expect("periksa_jenis") {
            let p: PengajuanSah = serde_json::from_value(k["pengajuan"].clone()).expect("isian");
            let hasil = periksa_jenis(
                &p,
                &jenis(&k["jenis"]),
                k["guru"] == true,
                k["jp_max"].as_i64().expect("jp"),
            );
            assert_eq!(galat(hasil), k["galat"], "{k}");
        }
        for k in vektor()["maks"].as_array().expect("maks") {
            let hasil = periksa_maks(
                &jenis(&k["jenis"]),
                k["hari_kerja"].as_i64().expect("kerja"),
                k["hari_kalender"].as_i64().expect("kalender"),
            );
            assert_eq!(galat(hasil), k["galat"], "{k}");
        }
    }

    #[test]
    fn hr_pengajuan_vektor_sidik() {
        for k in vektor()["kanonik"].as_array().expect("kanonik") {
            let isi: IsiPengajuan = serde_json::from_value(k["isi"].clone()).expect("isi");
            assert_eq!(
                kanonik_pengajuan(&isi),
                k["kanonik"].as_str().expect("teks")
            );
            assert_eq!(sidik_pengajuan(&isi), k["sidik"].as_str().expect("sidik"));
        }
    }

    #[test]
    fn hr_pengajuan_vektor_status_dan_tanda() {
        let daftar =
            |v: &Value| -> Vec<Keputusan> { serde_json::from_value(v.clone()).expect("keputusan") };
        for k in vektor()["status"].as_array().expect("status") {
            let kep = daftar(&k["keputusan"]);
            let sidik = k["sidik"].as_str().expect("sidik");
            assert_eq!(
                status_pengajuan(sidik, &kep),
                k["status"].as_str().expect("status"),
                "{k}"
            );
            assert_eq!(
                keputusan_berlaku(sidik, &kep)
                    .map(|b| json!(b.id_keputusan))
                    .unwrap_or(Value::Null),
                k["berlaku"],
                "{k}"
            );
        }
        for k in vektor()["tanda"].as_array().expect("tanda") {
            let hasil = tanda_keputusan(
                k["sidik"].as_str().expect("sidik"),
                k["diajukan_oleh"].as_str().expect("oleh"),
                &daftar(&k["keputusan"]),
                k["cakupan"].as_bool(),
            );
            assert_eq!(json!(hasil), k["hasil"], "{k}");
        }
    }

    #[test]
    fn hr_pengajuan_vektor_bentrok_wajib_cakupan() {
        let v = vektor();
        for k in v["bentrok"].as_array().expect("bentrok") {
            let a: Ringkas = serde_json::from_value(k["a"].clone()).expect("a");
            let b: Ringkas = serde_json::from_value(k["b"].clone()).expect("b");
            assert_eq!(json!(bentrok_pengajuan(&a, &b)), k["hasil"], "{k}");
            assert_eq!(json!(bentrok_pengajuan(&b, &a)), k["hasil"], "simetris {k}");
        }
        for k in v["tanggal_wajib"].as_array().expect("tanggal_wajib") {
            let j = &k["jadwal"];
            let jadwal = Jadwal {
                hari_masuk: serde_json::from_value(j["hari_masuk"].clone()).expect("hari"),
                divisi: j["divisi"].as_str().expect("divisi").to_owned(),
                kode_shift: j["kode_shift"].as_i64(),
            };
            let libur: HashSet<String> = serde_json::from_value(k["libur"].clone()).expect("libur");
            let whitelist: Vec<HolidayWhitelistEntry> = k["whitelist"]
                .as_array()
                .expect("whitelist")
                .iter()
                .map(|w| HolidayWhitelistEntry {
                    id: teks(w, "id"),
                    scope_type: teks(w, "scope_type"),
                    scope_value: teks(w, "scope_value"),
                    tanggal_libur: w["tanggal_libur"].as_str().map(str::to_owned),
                    status_aktif: w["status_aktif"].as_i64().expect("aktif"),
                })
                .collect();
            let hasil = tanggal_wajib(
                &jadwal,
                &libur,
                &whitelist,
                k["mulai"].as_str().expect("mulai"),
                k["selesai"].as_str().expect("selesai"),
            );
            assert_eq!(json!(hasil), k["hasil"], "{k}");
        }
        for k in v["cakupan"].as_array().expect("cakupan") {
            let hasil = dalam_cakupan(
                k["lingkup_semua"] == true,
                k["unit_akun"].as_str().expect("akun"),
                k["unit_sasaran"].as_str().expect("sasaran"),
            );
            assert_eq!(json!(hasil), k["hasil"], "{k}");
        }
    }

    #[test]
    fn hr_pengajuan_vektor_aksi() {
        let v = vektor();
        for k in v["aksi"].as_array().expect("aksi") {
            let keadaan: KeadaanAksi =
                serde_json::from_value(k["keadaan"].clone()).expect("keadaan");
            let hasil = periksa_aksi(
                k["aksi"].as_str().expect("aksi"),
                k["alasan"].as_str().expect("alasan"),
                &keadaan,
            );
            assert_eq!(galat(hasil), k["galat"], "{k}");
        }
        for k in v["sunting"].as_array().expect("sunting") {
            let hasil = periksa_sunting(
                k["status"].as_str().expect("status"),
                k["pengaju_sendiri"] == true,
                k["superadmin"] == true,
            );
            assert_eq!(galat(hasil), k["galat"], "{k}");
        }
        for k in v["urgent"].as_array().expect("urgent") {
            assert_eq!(
                galat(periksa_urgent(
                    k["karyawan_sendiri"] == true,
                    k["dalam_cakupan"] == true
                )),
                k["galat"],
                "{k}"
            );
        }
        let pesan = &v["pesan"];
        let tiga = |kunci: &str| -> (String, String, String) {
            let a = pesan[kunci].as_array().expect("pesan");
            (
                a[0].as_str().expect("0").to_owned(),
                a[1].as_str().expect("1").to_owned(),
                a[2].as_str().expect("2").to_owned(),
            )
        };
        let (a, b, c) = tiga("periode_dibayar");
        assert_eq!(pesan_periode_dibayar(&a, &b), c);
        let (a, b, c) = tiga("bertumpuk");
        assert_eq!(pesan_bertumpuk(&a, &b), c);
        let (a, b, c) = tiga("run_ulang");
        assert_eq!(pesan_run_ulang(&a, &b), c);
    }

    #[test]
    fn hr_pengajuan_sql_turunan_berlaku() {
        assert!(PENGAJUAN_RENTANG_SQL.contains(PENGAJUAN_BERLAKU_SQL));
        let urutan = "ORDER BY k.diterima_cloud IS NULL, k.diterima_cloud, k.waktu_perangkat, k.id_keputusan LIMIT 1";
        assert!(PENGAJUAN_AKTIF_ORANG_SQL.contains(urutan));
        assert!(PENGAJUAN_BERLAKU_SQL.contains(urutan));
        // JP terdampak memakai pengajuan Menunggu ATAU berlaku (§20.2.5).
        let a = PENGAJUAN_AKTIF_ORANG_SQL.find("NOT EXISTS").expect("awal");
        let b = PENGAJUAN_AKTIF_ORANG_SQL
            .find(" ORDER BY p.tanggal_mulai")
            .expect("akhir");
        let aktif = &PENGAJUAN_AKTIF_ORANG_SQL[a..b];
        assert!(JP_TERDAMPAK_SQL.contains(aktif));
        assert!(PENANGANAN_SQL.contains(aktif));
    }

    #[test]
    fn hr_pengajuan_vektor_jp_terdampak() {
        let v = vektor();
        let t = &v["jp_terdampak"];
        let pengajuan: Vec<PengajuanJp> =
            serde_json::from_value(t["pengajuan"].clone()).expect("pengajuan");
        let jadwal: Vec<JadwalJp> = serde_json::from_value(t["jadwal"].clone()).expect("jadwal");
        for k in t["kasus"].as_array().expect("kasus") {
            let libur: HashSet<String> = serde_json::from_value(k["libur"].clone()).expect("libur");
            let hasil = jp_terdampak(
                &pengajuan,
                &jadwal,
                &libur,
                k["dari"].as_str().expect("dari"),
                k["sampai"].as_str().expect("sampai"),
            );
            assert_eq!(json!(hasil), k["hasil"], "{}", k["_"]);
        }
        let b = &v["pengganti_bentrok"];
        let penanganan: Vec<Penanganan> =
            serde_json::from_value(b["penanganan"].clone()).expect("penanganan");
        for k in b["kasus"].as_array().expect("kasus") {
            let m: Vec<String> = serde_json::from_value(k[0].clone()).expect("masuk");
            let hasil = pengganti_bentrok(&m[0], &m[1], &m[2], &m[3], &m[4], &jadwal, &penanganan);
            assert_eq!(json!(hasil), k[1], "{k}");
        }
        let s = &v["susun_jp"];
        let jp: Vec<Jp> = serde_json::from_value(s["jp"].clone()).expect("jp");
        let penanganan: Vec<Penanganan> =
            serde_json::from_value(s["penanganan"].clone()).expect("penanganan");
        let presensi: Vec<PresensiJp> =
            serde_json::from_value(s["presensi"].clone()).expect("presensi");
        assert_eq!(
            json!(susun_jp(jp, &penanganan, &presensi, &jadwal)),
            s["hasil"]
        );
        let h = &v["hitung_jp"];
        let jp: Vec<Jp> = serde_json::from_value(h["jp"].clone()).expect("jp");
        let ditangani: HashSet<String> =
            serde_json::from_value(h["ditangani"].clone()).expect("ditangani");
        assert_eq!(json!(hitung_jp(&jp, &ditangani)), h["hasil"]);
        for k in v["validasi_penanganan"].as_array().expect("validasi") {
            let hasil = validasi_penanganan(&k["masuk"]);
            assert_eq!(galat(hasil.clone()), k["galat"], "{k}");
            assert_eq!(
                hasil.map(|h| json!(h)).unwrap_or(Value::Null),
                k["hasil"],
                "{k}"
            );
        }
        for k in v["periksa_penanganan"].as_array().expect("periksa") {
            let m = &k[0];
            let hasil = periksa_penanganan(
                m[0].as_str().expect("guru"),
                m[1].as_str().expect("pengganti"),
                m[2].as_str().expect("sesi"),
                m[3] == true,
            );
            assert_eq!(galat(hasil), k[1], "{k}");
        }
    }

    /// Jalur baca dan simpan lokal di database sungguhan: Ditolak tidak
    /// menghasilkan JP, penanganan upsert atas id deterministik, JP sendiri
    /// ditolak, dan pengganti melihat JP-nya hari itu.
    #[test]
    fn hr_pengajuan_jp_dari_database() {
        let dir = tempfile::tempdir().expect("tempdir");
        storage::initialize(dir.path()).expect("schema");
        let c = storage::database(dir.path()).expect("db");
        c.execute_batch(
            "INSERT INTO akademik_unit (id_unit, nama_unit) VALUES ('u-smp', 'SMP');
             INSERT INTO akademik_tahun_ajaran (id_tahun_ajaran, nama_tahun, semester, tanggal_mulai, tanggal_selesai, is_aktif, created_at, updated_at) VALUES
               ('ta-lama', '2025/2026', 'Genap', '2026-01-05', '2026-06-20', 0, 'x', 'x'),
               ('ta-kini', '2026/2027', 'Ganjil', '2026-07-13', '2026-12-19', 1, 'x', 'x');
             INSERT INTO akademik_rombel (id_rombel, id_tahun_ajaran, tingkat, nama_rombel, id_unit) VALUES ('R7A', 'ta-kini', 7, 'VII A', 'u-smp');
             INSERT INTO master_data (id_unik, nama, divisi, id_shift, status_aktif, jenis_personil, unit) VALUES ('G1', 'Guru Satu', 'Guru', 1, 'Aktif', 'GURU', 'SMP'), ('G2', 'Guru Dua', 'Guru', 1, 'Aktif', 'GURU', 'SMP');
             INSERT INTO guru_data (id_guru, created_at, updated_at) VALUES ('G1', 'x', 'x'), ('G2', 'x', 'x');
             INSERT INTO jadwal_mengajar (id_jadwal, id_tahun_ajaran, id_rombel, id_mapel, id_guru, hari, jam_ke, is_aktif, created_at, updated_at) VALUES
               ('J1', 'ta-kini', 'R7A', 'MTK', 'G1', 1, '3-4', 1, 'x', 'x'),
               ('J9', 'ta-lama', 'R7A', 'MTK', 'G1', 1, '5', 1, 'x', 'x');
             INSERT INTO hr_pengajuan (id_pengajuan, id_karyawan, id_jenis, kelompok, potong_jatah, dampak_gaji, izin_pemutus, tanggal_mulai, tanggal_selesai, setengah_hari, alasan, sidik, diajukan_oleh, waktu_perangkat) VALUES
               ('pgn-1', 'G1', 'jns-sakit', 'Sakit', 0, 'Dibayar', 'hr.request.decide', '2026-11-09', '2026-11-09', 0, 'a', 's1', 'tu', 'x'),
               ('pgn-2', 'G1', 'jns-sakit', 'Sakit', 0, 'Dibayar', 'hr.request.decide', '2026-11-16', '2026-11-16', 0, 'a', 's2', 'tu', 'x');
             INSERT INTO hr_pengajuan_keputusan (id_keputusan, id_pengajuan, jenis, sidik, oleh, waktu_perangkat) VALUES ('k2', 'pgn-2', 'Tolak', 's2', 'kepsek', 'x');",
        )
        .expect("fixture");
        let (jp, _) = muat_jp(&c, "2026-11-01", "2026-11-30", "").expect("jp");
        let ids: Vec<&str> = jp.iter().map(|j| j.id_penanganan.as_str()).collect();
        assert_eq!(ids, vec!["jp:pgn-1:2026-11-09:J1"], "Menunggu ikut, Ditolak dan semester lama tidak");
        assert_eq!(jp[0].unit, "SMP");
        let hitung = hitung_jp(&jp, &HashSet::new());
        assert_eq!(hitung["pgn-1"], HitungJp { total: 1, belum: 1 });

        let tulis = |status: &str, pengganti: &str| {
            let payload = json!({
                "id_penanganan": jp[0].id_penanganan, "id_pengajuan": "pgn-1", "tanggal": "2026-11-09",
                "id_jadwal": "J1", "id_rombel": "R7A", "id_mapel": "MTK", "jam_ke": "3-4", "status": status,
                "id_guru_pengganti": pengganti, "catatan": "", "dicatat_oleh": "piket", "waktu_perangkat": "x",
            });
            for (sql, args) in cloud_penanganan_statements(&payload, &jp[0].id_penanganan) {
                c.execute(&sql, rusqlite::params_from_iter(args.iter().map(json_ke_sql)))
                    .expect("upsert");
            }
        };
        tulis("Tugas Mandiri", "");
        tulis("Diganti", "G2");
        let h = muat_penanganan(&c, "2026-11-09", "2026-11-09").expect("penanganan");
        assert_eq!(h.len(), 1, "upsert atas id deterministik");
        assert_eq!((h[0].status.as_str(), h[0].nama_pengganti.as_str()), ("Diganti", "Guru Dua"));
        assert_eq!(
            periksa_penanganan(&jp[0].id_karyawan, "G2", "G1", true),
            Err(PESAN_JP_SENDIRI.to_owned())
        );
    }

    #[test]
    fn hr_pengajuan_jadwal_disaring_semester() {
        let dir = tempfile::tempdir().expect("tempdir");
        storage::initialize(dir.path()).expect("schema");
        let c = storage::database(dir.path()).expect("db");
        c.execute_batch(
            "INSERT INTO akademik_tahun_ajaran (id_tahun_ajaran, nama_tahun, semester, tanggal_mulai, tanggal_selesai, is_aktif, created_at, updated_at) VALUES
               ('ta-lama', '2025/2026', 'Genap', '2026-01-05', '2026-06-20', 0, 'x', 'x'),
               ('ta-kini', '2026/2027', 'Ganjil', '2026-07-13', '2026-12-19', 1, 'x', 'x');
             INSERT INTO jadwal_mengajar (id_jadwal, id_tahun_ajaran, id_rombel, id_mapel, id_guru, hari, jam_ke, is_aktif, created_at, updated_at) VALUES
               ('J1', 'ta-kini', 'R7A', 'MTK', 'G1', 1, '1', 1, 'x', 'x'),
               ('J9', 'ta-lama', 'R7A', 'MTK', 'G1', 1, '2', 1, 'x', 'x');",
        )
        .expect("fixture");
        drop(c);
        let state = DesktopState {
            server_origin: std::sync::RwLock::new("http://localhost:3000".to_string()),
            offline_max_age_hours: 24,
            data_dir: dir.path().to_path_buf(),
            http: reqwest::Client::new(),
            turso_config: std::sync::RwLock::new(None),
            session: std::sync::Mutex::new(None),
            vault_lock: std::sync::Mutex::new(()),
        };
        let hasil = super::super::academic::list_teaching_schedules(
            &state,
            &json!({ "id_guru": "G1", "tanggal": "2026-11-09" }),
        )
        .expect("jadwal");
        let ids: Vec<&str> = hasil
            .as_array()
            .expect("array")
            .iter()
            .map(|r| r["id_jadwal"].as_str().unwrap_or_default())
            .collect();
        assert_eq!(ids, vec!["J1"]);
    }

    #[test]
    fn hr_pengajuan_vektor_cuti_dibayar() {
        let v = vektor();
        let berlaku =
            |p: &Value| -> Berlaku { serde_json::from_value(p.clone()).expect("berlaku") };
        for k in v["penuh_pada"].as_array().expect("penuh_pada") {
            let hasil = penuh_pada(&berlaku(&k["p"]), k["t"].as_str().expect("t"));
            assert_eq!(json!(hasil), k["hasil"], "{k}");
        }
        for k in v["menit_cuti_dibayar"].as_array().expect("menit") {
            let m = &k["masuk"];
            let hasil = menit_cuti_dibayar(
                m[0] == true,
                m[1] == true,
                m[2].as_i64().expect("jam"),
                m[3].as_i64().expect("normal"),
            );
            assert_eq!(json!([hasil.0, hasil.1]), k["hasil"], "{k}");
        }
        for k in v["cuti_dibayar"].as_array().expect("cuti_dibayar") {
            let tanggal: Vec<(String, bool)> =
                serde_json::from_value(k["tanggal"].clone()).expect("tanggal");
            let absen: HashMap<String, (bool, i64)> =
                serde_json::from_value(k["absen"].clone()).expect("absen");
            let hasil = hitung_cuti_dibayar(&tanggal, &absen, k["normal"].as_i64().expect("n"));
            assert_eq!(json!(hasil), k["hasil"], "{k}");
        }
        for k in v["hadir_saat_cuti"].as_array().expect("hadir_saat_cuti") {
            let hadir: HashSet<String> = serde_json::from_value(k["hadir"].clone()).expect("hadir");
            assert_eq!(
                json!(hadir_saat_cuti(&berlaku(&k["p"]), &hadir)),
                k["hasil"],
                "{k}"
            );
        }
    }

    #[test]
    fn hr_pengajuan_vektor_jatah_cuti() {
        let v = vektor();
        for k in v["aturan_cuti"].as_array().expect("aturan_cuti") {
            let peta: HashMap<String, String> =
                serde_json::from_value(k["peta"].clone()).expect("peta");
            let hasil = aturan_cuti(&peta, k["kelompok"].as_str().expect("kelompok"));
            assert_eq!(json!(hasil), k["hasil"], "{k}");
        }
        for k in v["validasi_aturan_cuti"].as_array().expect("validasi") {
            let hasil = validasi_aturan_cuti(&k["masuk"]);
            assert_eq!(galat(hasil.clone()), k["galat"], "{k}");
            assert_eq!(
                hasil.map(|h| json!(h)).unwrap_or(Value::Null),
                k["hasil"],
                "{k}"
            );
        }
        for k in v["jatah_cuti"].as_array().expect("jatah_cuti") {
            let aturan: AturanCuti = serde_json::from_value(k["aturan"].clone()).expect("aturan");
            let terpakai: Vec<String> =
                serde_json::from_value(k["terpakai"].clone()).expect("terpakai");
            let penyesuaian: Vec<(String, i64)> =
                serde_json::from_value(k["penyesuaian"].clone()).expect("penyesuaian");
            let hasil = jatah_cuti(
                k["tmt"].as_str(),
                &aturan,
                &terpakai,
                &penyesuaian,
                k["hari_ini"].as_str().expect("hari_ini"),
            );
            assert_eq!(json!(hasil), k["hasil"], "{}", k["_"]);
        }
        for k in v["penyesuaian"].as_array().expect("penyesuaian") {
            let hasil = validasi_penyesuaian(&k["masuk"]);
            assert_eq!(galat(hasil.clone()), k["galat"], "{k}");
            assert_eq!(
                hasil.map(|h| json!(h)).unwrap_or(Value::Null),
                k["hasil"],
                "{k}"
            );
        }
    }

    /// Kait gaji dan Alfa membaca database sungguhan: pengajuan Dibayar yang
    /// disetujui menjadi menit cuti, Ditolak dan Potong Gaji tidak.
    #[test]
    fn hr_pengajuan_cuti_dibayar_dari_database() {
        let dir = tempfile::tempdir().expect("tempdir");
        storage::initialize(dir.path()).expect("schema");
        let c = storage::database(dir.path()).expect("db");
        c.execute_batch(
            "INSERT INTO tbl_shift (id_shift, kode_shift, nama_shift, jam_masuk, jam_pulang, jam_kerja_normal_menit, hari_kerja) VALUES (91, 91, 'Uji', '07:00', '15:00', 420, '1,2,3,4,5');
             INSERT INTO master_data (id_unik, nama, divisi, id_shift, status_aktif, jenis_personil) VALUES ('P1', 'Pegawai Satu', 'TU', 91, 'Aktif', 'Pegawai'), ('P2', 'Pegawai Dua', 'TU', 91, 'Aktif', 'Pegawai');
             INSERT INTO hr_pengajuan (id_pengajuan, id_karyawan, id_jenis, kelompok, potong_jatah, dampak_gaji, izin_pemutus, tanggal_mulai, tanggal_selesai, setengah_hari, alasan, sidik, diajukan_oleh, waktu_perangkat) VALUES
               ('x1', 'P1', 'jns-cuti-tahunan', 'Cuti', 1, 'Dibayar', 'hr.request.decide', '2026-11-06', '2026-11-09', 0, 'a', 's1', 'u', '2026-11-01 08:00:00'),
               ('x2', 'P2', 'jns-izin-tidak-dibayar', 'Izin', 0, 'Potong Gaji', 'hr.request.decide', '2026-11-06', '2026-11-06', 0, 'a', 's2', 'u', '2026-11-01 08:00:00'),
               ('x3', 'P2', 'jns-izin-dibayar', 'Izin', 0, 'Dibayar', 'hr.request.decide', '2026-11-10', '2026-11-10', 0, 'a', 's3', 'u', '2026-11-01 08:00:00');
             INSERT INTO hr_pengajuan_keputusan (id_keputusan, id_pengajuan, jenis, sidik, oleh, waktu_perangkat) VALUES
               ('k1', 'x1', 'Setujui', 's1', 'kepsek', '2026-11-02 08:00:00'),
               ('k2', 'x2', 'Setujui', 's2', 'kepsek', '2026-11-02 08:00:00'),
               ('k3', 'x3', 'Tolak', 's3', 'kepsek', '2026-11-02 08:00:00');
             INSERT INTO absensi_harian (tanggal, id_karyawan, nama, kelas_divisi, status_kehadiran, status_absen, sumber, update_terakhir, jam_kerja, id_shift, bulan, tahun, id_sesi, mode_tugas) VALUES
               ('2026-11-09', 'P1', 'Pegawai Satu', 'TU', 'Hadir', 'Hadir', 'Scanner', '2026-11-09 15:00:00', 400, 91, 'November', 2026, 's-p1', 'NORMAL');",
        )
        .expect("fixture");
        // 6 Nov Jumat, 7-8 libur mingguan, 9 Nov Senin Hadir: satu hari dibayar.
        let hasil = cuti_dibayar(&c, "2026-11-01", "2026-11-30").expect("cuti");
        assert_eq!(hasil.len(), 1, "{hasil:?}");
        assert_eq!(
            hasil["P1"],
            CutiDibayar {
                hari: 1,
                menit: 420,
                jam_normal_nol: false
            }
        );
        let tanggal = pengajuan_pada(&c, "2026-11-06").expect("pada");
        assert_eq!(tanggal.get("P1"), Some(&true));
        assert_eq!(tanggal.get("P2"), Some(&true));
        assert!(pengajuan_pada(&c, "2026-11-10").expect("pada").is_empty());
    }

    #[test]
    fn hr_pengajuan_jenis_bawaan() {
        let bawaan = jenis_bawaan();
        assert_eq!(bawaan.len(), 10);
        for j in &bawaan {
            let draft = json!({
                "nama": j.nama, "kelompok": j.kelompok, "izin_pemutus": j.izin_pemutus,
                "boleh_urgent": j.boleh_urgent, "potong_jatah": j.potong_jatah, "dampak_gaji": j.dampak_gaji,
                "maks_hari": j.maks_hari, "satuan_maks": j.satuan_maks, "wajib_dokumen": j.wajib_dokumen,
            });
            assert!(validasi_jenis(&draft).is_ok(), "{}", j.id_jenis);
        }
    }
}
