//! HRIS sub-fase 1c (`prd-hris.md` §19.2.3, §19.2.5, §19.2.7): data pribadi,
//! keuangan, pendidik, dokumen, dan Laporan PTK.
//!
//! Semua tabelnya cloud-only (Q-31): dibaca dan ditulis langsung lewat
//! `TursoClient`, tidak pernah masuk SQLite perangkat, snapshot, atau outbox.
//! Tanpa koneksi, command mengembalikan `PESAN_LURING`, bukan daftar kosong.
//!
//! Kembaran TS: aturan dan SQL di `src/lib/validations/hris.ts`, penulisan di
//! `src/lib/services/hris.ts`. Vektornya `validations/hris.vektor.json`; teks
//! SQL dibandingkan harfiah oleh `hris.test.ts`.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use super::berkas_sekolah::{tanda_tangan_cocok, ukuran_base64, MIME_BERKAS};
use super::hari_kerja::tanggal_valid;
use super::hris::{new_id, validasi_nama_master, CATATAN_MAKS, HARI_INI_SQL, NOMOR_MAKS, STATUS_KINI_SQL};
use super::models::{CommandError, OperatorUser};
use super::turso::{QueryResult, Statement, TursoClient};
use super::wa_notification::normalize_phone_canonical;

pub const AGAMA: [&str; 7] = ["Islam", "Kristen", "Katolik", "Hindu", "Buddha", "Konghucu", "Lainnya"];
pub const STATUS_NIKAH: [&str; 4] = ["Belum Kawin", "Kawin", "Cerai Hidup", "Cerai Mati"];
pub const JENJANG: [&str; 10] = ["SD", "SMP", "SMA/SMK", "D1", "D2", "D3", "D4", "S1", "S2", "S3"];
pub const TEKS_MAKS: usize = 100;
pub const ALAMAT_MAKS: usize = 500;
pub const NAMA_BERKAS_MAKS: usize = 180;
pub const MAKS_BYTE_DOKUMEN: usize = 1024 * 1024;
/// Batas berkas per dokumen; ditegakkan slot 1–5 di `TAMBAH_BERKAS_SQL`.
#[cfg(test)]
pub const MAKS_BERKAS_DOKUMEN: usize = 5;

pub const PESAN_LURING: &str = "Data ini butuh koneksi ke database. Periksa jaringan, lalu coba lagi.";
pub const PESAN_PEGAWAI_BELUM_DI_CLOUD: &str =
    "Pegawai ini belum ada di database pusat. Sinkronkan perangkat, lalu coba lagi.";
pub const PESAN_DOKUMEN_DITOLAK: &str =
    "Pegawai belum ada di database pusat, atau jenis dokumennya tidak dikenal.";
pub const PESAN_BERKAS_PENUH: &str = "Dokumen tidak ditemukan, atau sudah berisi 5 berkas.";

// ── SQL, dieja harfiah sama di `validations/hris.ts` ──

pub const PROFIL_PRIBADI_SQL: &str = "SELECT COALESCE(nik, '') AS nik, COALESCE(no_kk, '') AS no_kk, COALESCE(tempat_lahir, '') AS tempat_lahir, COALESCE(tanggal_lahir, '') AS tanggal_lahir, COALESCE(agama, '') AS agama, COALESCE(status_nikah, '') AS status_nikah, COALESCE(nama_ibu_kandung, '') AS nama_ibu_kandung, COALESCE(alamat_ktp, '') AS alamat_ktp, COALESCE(alamat_domisili, '') AS alamat_domisili, COALESCE(darurat_nama, '') AS darurat_nama, COALESCE(darurat_hubungan, '') AS darurat_hubungan, COALESCE(darurat_hp, '') AS darurat_hp, COALESCE(pribadi_diubah_oleh, '') AS diubah_oleh, COALESCE(pribadi_diubah_pada, '') AS diubah_pada FROM hr_profil WHERE id_karyawan = ?1 LIMIT 1;";
pub const PROFIL_KEUANGAN_SQL: &str = "SELECT COALESCE(bank, '') AS bank, COALESCE(no_rekening, '') AS no_rekening, COALESCE(nama_rekening, '') AS nama_rekening, COALESCE(npwp, '') AS npwp, COALESCE(bpjs_kesehatan, '') AS bpjs_kesehatan, COALESCE(bpjs_ketenagakerjaan, '') AS bpjs_ketenagakerjaan, COALESCE(keuangan_diubah_oleh, '') AS diubah_oleh, COALESCE(keuangan_diubah_pada, '') AS diubah_pada FROM hr_profil WHERE id_karyawan = ?1 LIMIT 1;";
/// ?1 pegawai, ?2–?13 isian, ?14 pengubah. Hanya pegawai yang sudah ada di cloud.
pub const SIMPAN_PRIBADI_SQL: &str = "INSERT INTO hr_profil (id_karyawan, nik, no_kk, tempat_lahir, tanggal_lahir, agama, status_nikah, nama_ibu_kandung, alamat_ktp, alamat_domisili, darurat_nama, darurat_hubungan, darurat_hp, pribadi_diubah_oleh, pribadi_diubah_pada) SELECT ?1, NULLIF(?2, ''), NULLIF(?3, ''), NULLIF(?4, ''), NULLIF(?5, ''), NULLIF(?6, ''), NULLIF(?7, ''), NULLIF(?8, ''), NULLIF(?9, ''), NULLIF(?10, ''), NULLIF(?11, ''), NULLIF(?12, ''), NULLIF(?13, ''), ?14, datetime('now') FROM master_data m WHERE m.id_unik = ?1 AND LOWER(TRIM(COALESCE(m.jenis_personil, ''))) <> 'siswa' AND NOT EXISTS (SELECT 1 FROM siswa_data sd WHERE sd.id_siswa = m.id_unik) ON CONFLICT(id_karyawan) DO UPDATE SET nik = excluded.nik, no_kk = excluded.no_kk, tempat_lahir = excluded.tempat_lahir, tanggal_lahir = excluded.tanggal_lahir, agama = excluded.agama, status_nikah = excluded.status_nikah, nama_ibu_kandung = excluded.nama_ibu_kandung, alamat_ktp = excluded.alamat_ktp, alamat_domisili = excluded.alamat_domisili, darurat_nama = excluded.darurat_nama, darurat_hubungan = excluded.darurat_hubungan, darurat_hp = excluded.darurat_hp, pribadi_diubah_oleh = excluded.pribadi_diubah_oleh, pribadi_diubah_pada = excluded.pribadi_diubah_pada;";
/// ?1 pegawai, ?2–?7 isian, ?8 pengubah.
pub const SIMPAN_KEUANGAN_SQL: &str = "INSERT INTO hr_profil (id_karyawan, bank, no_rekening, nama_rekening, npwp, bpjs_kesehatan, bpjs_ketenagakerjaan, keuangan_diubah_oleh, keuangan_diubah_pada) SELECT ?1, NULLIF(?2, ''), NULLIF(?3, ''), NULLIF(?4, ''), NULLIF(?5, ''), NULLIF(?6, ''), NULLIF(?7, ''), ?8, datetime('now') FROM master_data m WHERE m.id_unik = ?1 AND LOWER(TRIM(COALESCE(m.jenis_personil, ''))) <> 'siswa' AND NOT EXISTS (SELECT 1 FROM siswa_data sd WHERE sd.id_siswa = m.id_unik) ON CONFLICT(id_karyawan) DO UPDATE SET bank = excluded.bank, no_rekening = excluded.no_rekening, nama_rekening = excluded.nama_rekening, npwp = excluded.npwp, bpjs_kesehatan = excluded.bpjs_kesehatan, bpjs_ketenagakerjaan = excluded.bpjs_ketenagakerjaan, keuangan_diubah_oleh = excluded.keuangan_diubah_oleh, keuangan_diubah_pada = excluded.keuangan_diubah_pada;";

pub const PENDIDIKAN_SQL: &str = "SELECT id_pendidikan, jenjang, COALESCE(prodi, '') AS prodi, COALESCE(perguruan_tinggi, '') AS perguruan_tinggi, tahun_lulus, linier, COALESCE(catatan, '') AS catatan, COALESCE(dicatat_oleh, '') AS dicatat_oleh, updated_at FROM hr_pendidikan WHERE id_karyawan = ?1 ORDER BY COALESCE(tahun_lulus, 0) DESC, id_pendidikan\n-- batas: riwayat pendidikan satu pegawai\n;";
pub const SERTIFIKASI_SQL: &str = "SELECT id_sertifikasi, COALESCE(nomor_sertifikat, '') AS nomor_sertifikat, COALESCE(nrg, '') AS nrg, tahun, COALESCE(bidang_studi, '') AS bidang_studi, COALESCE(catatan, '') AS catatan, COALESCE(dicatat_oleh, '') AS dicatat_oleh, updated_at FROM hr_sertifikasi WHERE id_karyawan = ?1 ORDER BY COALESCE(tahun, 0) DESC, id_sertifikasi\n-- batas: sertifikat pendidik satu pegawai\n;";
/// ?1 id, ?2 pegawai, ?3 jenjang, ?4 prodi, ?5 perguruan tinggi, ?6 tahun, ?7 linier, ?8 catatan, ?9 pencatat.
/// Baris milik pegawai lain tidak bisa dipindah lewat id yang sama.
pub const SIMPAN_PENDIDIKAN_SQL: &str = "INSERT INTO hr_pendidikan (id_pendidikan, id_karyawan, jenjang, prodi, perguruan_tinggi, tahun_lulus, linier, catatan, dicatat_oleh, created_at, updated_at) SELECT ?1, ?2, ?3, NULLIF(?4, ''), NULLIF(?5, ''), ?6, ?7, NULLIF(?8, ''), ?9, datetime('now'), datetime('now') FROM master_data m WHERE m.id_unik = ?2 AND LOWER(TRIM(COALESCE(m.jenis_personil, ''))) <> 'siswa' AND NOT EXISTS (SELECT 1 FROM siswa_data sd WHERE sd.id_siswa = m.id_unik) ON CONFLICT(id_pendidikan) DO UPDATE SET jenjang = excluded.jenjang, prodi = excluded.prodi, perguruan_tinggi = excluded.perguruan_tinggi, tahun_lulus = excluded.tahun_lulus, linier = excluded.linier, catatan = excluded.catatan, updated_at = excluded.updated_at WHERE hr_pendidikan.id_karyawan = excluded.id_karyawan;";
pub const HAPUS_PENDIDIKAN_SQL: &str = "DELETE FROM hr_pendidikan WHERE id_pendidikan = ?1;";
/// ?1 id, ?2 pegawai, ?3 nomor, ?4 NRG, ?5 tahun, ?6 bidang studi, ?7 catatan, ?8 pencatat.
pub const SIMPAN_SERTIFIKASI_SQL: &str = "INSERT INTO hr_sertifikasi (id_sertifikasi, id_karyawan, nomor_sertifikat, nrg, tahun, bidang_studi, catatan, dicatat_oleh, created_at, updated_at) SELECT ?1, ?2, NULLIF(?3, ''), NULLIF(?4, ''), ?5, ?6, NULLIF(?7, ''), ?8, datetime('now'), datetime('now') FROM master_data m WHERE m.id_unik = ?2 AND LOWER(TRIM(COALESCE(m.jenis_personil, ''))) <> 'siswa' AND NOT EXISTS (SELECT 1 FROM siswa_data sd WHERE sd.id_siswa = m.id_unik) ON CONFLICT(id_sertifikasi) DO UPDATE SET nomor_sertifikat = excluded.nomor_sertifikat, nrg = excluded.nrg, tahun = excluded.tahun, bidang_studi = excluded.bidang_studi, catatan = excluded.catatan, updated_at = excluded.updated_at WHERE hr_sertifikasi.id_karyawan = excluded.id_karyawan;";
pub const HAPUS_SERTIFIKASI_SQL: &str = "DELETE FROM hr_sertifikasi WHERE id_sertifikasi = ?1;";

pub const JENIS_DOKUMEN_SQL: &str = "SELECT id_jenis, nama, is_aktif FROM hr_dokumen_jenis ORDER BY nama, id_jenis\n-- batas: jenis dokumen kepegawaian, tidak tumbuh per hari\n;";
/// ?1 id, ?2 nama, ?3 aktif.
pub const SIMPAN_JENIS_DOKUMEN_SQL: &str = "INSERT INTO hr_dokumen_jenis (id_jenis, nama, is_aktif, created_at, updated_at) VALUES (?1, ?2, ?3, datetime('now'), datetime('now')) ON CONFLICT(id_jenis) DO UPDATE SET nama = excluded.nama, is_aktif = excluded.is_aktif, updated_at = excluded.updated_at;";
pub const BENTROK_JENIS_DOKUMEN_SQL: &str = "SELECT 1 FROM hr_dokumen_jenis WHERE id_jenis <> ?2 AND is_aktif = 1 AND lower(trim(nama)) = lower(trim(?1)) LIMIT 1;";
pub const DOKUMEN_SQL: &str = "SELECT d.id_dokumen, d.id_jenis, COALESCE(j.nama, d.id_jenis) AS jenis, COALESCE(d.nomor, '') AS nomor, COALESCE(d.tanggal_terbit, '') AS tanggal_terbit, COALESCE(d.tanggal_kedaluwarsa, '') AS tanggal_kedaluwarsa, COALESCE(d.catatan, '') AS catatan, COALESCE(d.dicatat_oleh, '') AS dicatat_oleh, d.updated_at FROM hr_dokumen d LEFT JOIN hr_dokumen_jenis j ON j.id_jenis = d.id_jenis WHERE d.id_karyawan = ?1 ORDER BY d.tanggal_terbit DESC, d.id_dokumen\n-- batas: dokumen satu pegawai\n;";
/// Daftar berkas tanpa isinya; ukuran dihitung dari panjang base64.
pub const BERKAS_DOKUMEN_SQL: &str = "SELECT b.id_berkas, b.id_dokumen, b.urutan, COALESCE(b.nama_berkas, '') AS nama_berkas, b.mime_type, (length(b.data_base64) / 4) * 3 - (CASE WHEN b.data_base64 LIKE '%==' THEN 2 WHEN b.data_base64 LIKE '%=' THEN 1 ELSE 0 END) AS ukuran_byte FROM hr_dokumen_berkas b JOIN hr_dokumen d ON d.id_dokumen = b.id_dokumen WHERE d.id_karyawan = ?1 ORDER BY b.id_dokumen, b.urutan\n-- batas: berkas dokumen satu pegawai, maksimal 5 per dokumen\n;";
pub const AMBIL_BERKAS_SQL: &str = "SELECT id_berkas, id_dokumen, COALESCE(nama_berkas, '') AS nama_berkas, mime_type, data_base64 FROM hr_dokumen_berkas WHERE id_berkas = ?1 LIMIT 1;";
/// ?1 id, ?2 pegawai, ?3 jenis, ?4 nomor, ?5 terbit, ?6 kedaluwarsa, ?7 catatan, ?8 pencatat.
pub const SIMPAN_DOKUMEN_SQL: &str = "INSERT INTO hr_dokumen (id_dokumen, id_karyawan, id_jenis, nomor, tanggal_terbit, tanggal_kedaluwarsa, catatan, dicatat_oleh, created_at, updated_at) SELECT ?1, ?2, ?3, NULLIF(?4, ''), ?5, NULLIF(?6, ''), NULLIF(?7, ''), ?8, datetime('now'), datetime('now') FROM master_data m WHERE m.id_unik = ?2 AND LOWER(TRIM(COALESCE(m.jenis_personil, ''))) <> 'siswa' AND NOT EXISTS (SELECT 1 FROM siswa_data sd WHERE sd.id_siswa = m.id_unik) AND EXISTS (SELECT 1 FROM hr_dokumen_jenis WHERE id_jenis = ?3) ON CONFLICT(id_dokumen) DO UPDATE SET id_jenis = excluded.id_jenis, nomor = excluded.nomor, tanggal_terbit = excluded.tanggal_terbit, tanggal_kedaluwarsa = excluded.tanggal_kedaluwarsa, catatan = excluded.catatan, updated_at = excluded.updated_at WHERE hr_dokumen.id_karyawan = excluded.id_karyawan;";
/// Satu transaksi: dokumen dihapus sungguhan bersama berkasnya (§19.2.5).
pub const HAPUS_DOKUMEN_SQL: [&str; 2] = [
    "DELETE FROM hr_dokumen_berkas WHERE id_dokumen = ?1;",
    "DELETE FROM hr_dokumen WHERE id_dokumen = ?1;",
];
/// ?1 id, ?2 dokumen, ?3 nama, ?4 MIME, ?5 isi. Urutan = slot kosong terkecil
/// 1–5; tanpa slot kosong atau tanpa dokumen, tidak ada baris yang ditulis.
pub const TAMBAH_BERKAS_SQL: &str = "WITH slot(n) AS (VALUES (1), (2), (3), (4), (5)) INSERT INTO hr_dokumen_berkas (id_berkas, id_dokumen, urutan, nama_berkas, mime_type, data_base64, created_at) SELECT ?1, ?2, MIN(slot.n), ?3, ?4, ?5, datetime('now') FROM slot WHERE slot.n NOT IN (SELECT urutan FROM hr_dokumen_berkas WHERE id_dokumen = ?2) AND EXISTS (SELECT 1 FROM hr_dokumen WHERE id_dokumen = ?2) HAVING MIN(slot.n) IS NOT NULL;";
pub const HAPUS_BERKAS_SQL: &str = "DELETE FROM hr_dokumen_berkas WHERE id_berkas = ?1;";

// Lampiran pengajuan (HRIS Fase 2 §20.3, Q-51): `hr_pengajuan_berkas`, aturan
// berkas yang sama dengan dokumen pegawai.
pub const PENGAJUAN_LAMPIRAN_SQL: &str = "SELECT p.diajukan_oleh, p.izin_pemutus, COALESCE(j.wajib_dokumen, 0) AS wajib_dokumen FROM hr_pengajuan p LEFT JOIN hr_jenis_pengajuan j ON j.id_jenis = p.id_jenis WHERE p.id_pengajuan = ?1 LIMIT 1;";
pub const LAMPIRAN_SQL: &str = "SELECT id_berkas, urutan, COALESCE(nama_berkas, '') AS nama_berkas, mime_type, (length(data_base64) / 4) * 3 - (CASE WHEN data_base64 LIKE '%==' THEN 2 WHEN data_base64 LIKE '%=' THEN 1 ELSE 0 END) AS ukuran_byte, COALESCE(diunggah_oleh, '') AS diunggah_oleh, created_at FROM hr_pengajuan_berkas WHERE id_pengajuan = ?1 ORDER BY urutan\n-- batas: lampiran satu pengajuan, maksimal 5\n;";
pub const AMBIL_LAMPIRAN_SQL: &str = "SELECT id_berkas, id_pengajuan, COALESCE(nama_berkas, '') AS nama_berkas, mime_type, data_base64 FROM hr_pengajuan_berkas WHERE id_berkas = ?1 LIMIT 1;";
/// Pengajuan pemilik satu lampiran, untuk menilai siapa yang boleh menghapus.
pub const PEMILIK_LAMPIRAN_SQL: &str = "SELECT p.diajukan_oleh, p.izin_pemutus FROM hr_pengajuan_berkas b JOIN hr_pengajuan p ON p.id_pengajuan = b.id_pengajuan WHERE b.id_berkas = ?1 LIMIT 1;";
/// ?1 id, ?2 pengajuan, ?3 nama, ?4 MIME, ?5 isi, ?6 pengunggah. Slot 1–5
/// seperti `TAMBAH_BERKAS_SQL`.
pub const TAMBAH_LAMPIRAN_SQL: &str = "WITH slot(n) AS (VALUES (1), (2), (3), (4), (5)) INSERT INTO hr_pengajuan_berkas (id_berkas, id_pengajuan, urutan, nama_berkas, mime_type, data_base64, diunggah_oleh, created_at) SELECT ?1, ?2, MIN(slot.n), ?3, ?4, ?5, ?6, datetime('now') FROM slot WHERE slot.n NOT IN (SELECT urutan FROM hr_pengajuan_berkas WHERE id_pengajuan = ?2) AND EXISTS (SELECT 1 FROM hr_pengajuan WHERE id_pengajuan = ?2) HAVING MIN(slot.n) IS NOT NULL;";
pub const HAPUS_LAMPIRAN_SQL: &str = "DELETE FROM hr_pengajuan_berkas WHERE id_berkas = ?1;";

pub const PESAN_PENGAJUAN_BELUM_DI_CLOUD: &str =
    "Pengajuan ini belum sampai di database pusat. Sinkronkan perangkat, lalu coba lagi.";
pub const PESAN_LAMPIRAN_PENUH: &str = "Pengajuan ini sudah berisi 5 lampiran.";
pub const PESAN_LAMPIRAN_DITOLAK: &str =
    "Hanya pengaju atau pemutus jenis pengajuan ini yang bisa mengubah lampirannya.";

/// Baris Laporan PTK (§19.2.7): pegawai aktif dengan pendidikan tertinggi,
/// sertifikat terakhir, dan mapel yang diajar pada tahun ajaran aktif. Status
/// kini digabung dari `STATUS_KINI_SQL`.
pub const PTK_SQL: &str = "SELECT m.id_unik, m.nama, COALESCE(g.nip, '') AS nip, COALESCE(g.nuptk, '') AS nuptk, COALESCE(m.unit, '') AS unit, COALESCE(m.divisi, '') AS bagian, COALESCE(m.jabatan_status, '') AS jabatan, COALESCE(m.tanggal_mulai_aktif, '') AS tmt, CASE WHEN g.id_guru IS NOT NULL OR LOWER(TRIM(COALESCE(m.jenis_personil, ''))) = 'guru' THEN 'Guru' ELSE 'Tendik' END AS kelompok, COALESCE(p.jenjang, '') AS jenjang, COALESCE(p.prodi, '') AS prodi, COALESCE(p.perguruan_tinggi, '') AS perguruan_tinggi, COALESCE(p.linier, 0) AS linier, COALESCE(s.bidang_studi, '') AS sertifikat_bidang, s.tahun AS sertifikat_tahun, COALESCE(s.nrg, '') AS nrg, COALESCE((SELECT group_concat(nama_mapel, ', ') FROM (SELECT DISTINCT mp.nama_mapel FROM jadwal_mengajar j JOIN akademik_mapel mp ON mp.id_mapel = j.id_mapel JOIN akademik_tahun_ajaran ta ON ta.id_tahun_ajaran = j.id_tahun_ajaran WHERE j.id_guru = m.id_unik AND j.is_aktif = 1 AND ta.is_aktif = 1 ORDER BY mp.nama_mapel)), '') AS mapel FROM master_data m LEFT JOIN guru_data g ON g.id_guru = m.id_unik LEFT JOIN hr_pendidikan p ON p.id_pendidikan = (SELECT x.id_pendidikan FROM hr_pendidikan x WHERE x.id_karyawan = m.id_unik ORDER BY CASE x.jenjang WHEN 'S3' THEN 10 WHEN 'S2' THEN 9 WHEN 'S1' THEN 8 WHEN 'D4' THEN 7 WHEN 'D3' THEN 6 WHEN 'D2' THEN 5 WHEN 'D1' THEN 4 WHEN 'SMA/SMK' THEN 3 WHEN 'SMP' THEN 2 ELSE 1 END DESC, COALESCE(x.tahun_lulus, 0) DESC, x.id_pendidikan DESC LIMIT 1) LEFT JOIN hr_sertifikasi s ON s.id_sertifikasi = (SELECT y.id_sertifikasi FROM hr_sertifikasi y WHERE y.id_karyawan = m.id_unik ORDER BY COALESCE(y.tahun, 0) DESC, y.id_sertifikasi DESC LIMIT 1) WHERE LOWER(TRIM(COALESCE(m.jenis_personil, ''))) <> 'siswa' AND NOT EXISTS (SELECT 1 FROM siswa_data sd WHERE sd.id_siswa = m.id_unik) AND COALESCE(m.status_aktif, 'Aktif') = 'Aktif' ORDER BY unit, m.nama, m.id_unik\n-- batas: pegawai aktif sekolah, dibatasi jumlah personil lembaga\n;";

// ── Aturan murni ──

fn teks_pendek(nilai: &str, label: &str, maks: usize) -> Result<String, String> {
    let teks = nilai.trim().to_owned();
    if teks.chars().count() > maks {
        return Err(format!("{label} maksimal {maks} karakter."));
    }
    Ok(teks)
}

/// Nomor pengenal tanpa tanda baca dan spasi (§19.2.3); kosong = tidak diisi.
/// Cermin `nomorIdentitas`.
pub fn nomor_identitas(jenis: &str, teks: &str) -> Result<String, String> {
    let (label, min, maks) = match jenis {
        "nik" => ("NIK", 16, 16),
        "no_kk" => ("Nomor KK", 16, 16),
        "npwp" => ("NPWP", 15, 16),
        "nuptk" => ("NUPTK", 16, 16),
        "nrg" => ("NRG", 12, 12),
        "bpjs_kesehatan" => ("Nomor BPJS Kesehatan", 5, 20),
        "bpjs_ketenagakerjaan" => ("Nomor BPJS Ketenagakerjaan", 5, 20),
        "no_rekening" => ("Nomor rekening", 5, 20),
        _ => return Err("Jenis nomor tidak dikenal.".into()),
    };
    let angka: String = teks
        .chars()
        .filter(|c| !(c.is_ascii_punctuation() || c.is_whitespace()))
        .collect();
    if angka.is_empty() {
        return Ok(angka);
    }
    if !angka.chars().all(|c| c.is_ascii_digit()) {
        return Err(format!("{label} hanya boleh berisi angka."));
    }
    if (min..=maks).contains(&angka.len()) {
        return Ok(angka);
    }
    Err(if min == maks {
        format!("{label} harus {min} digit.")
    } else if maks == min + 1 {
        format!("{label} harus {min} atau {maks} digit.")
    } else {
        format!("{label} harus {min} sampai {maks} digit.")
    })
}

fn pilihan(nilai: &str, daftar: &[&str], galat: &str) -> Result<String, String> {
    let teks = nilai.trim();
    if teks.is_empty() || daftar.contains(&teks) {
        Ok(teks.to_owned())
    } else {
        Err(galat.to_owned())
    }
}

fn tanggal_opsional(nilai: &str, galat: &str) -> Result<String, String> {
    let teks = nilai.trim();
    if teks.is_empty() || tanggal_valid(teks) {
        Ok(teks.to_owned())
    } else {
        Err(galat.to_owned())
    }
}

fn tahun_opsional(tahun: Option<i64>, galat: &str) -> Result<Option<i64>, String> {
    match tahun {
        Some(t) if !(1950..=2100).contains(&t) => Err(galat.to_owned()),
        lain => Ok(lain),
    }
}

#[derive(Debug, Default, Clone, Deserialize, Serialize, PartialEq)]
#[serde(default)]
pub struct Pribadi {
    pub nik: String,
    pub no_kk: String,
    pub tempat_lahir: String,
    pub tanggal_lahir: String,
    pub agama: String,
    pub status_nikah: String,
    pub nama_ibu_kandung: String,
    pub alamat_ktp: String,
    pub alamat_domisili: String,
    pub darurat_nama: String,
    pub darurat_hubungan: String,
    pub darurat_hp: String,
}

pub fn validasi_pribadi(p: &Pribadi) -> Result<Pribadi, String> {
    let hp = p.darurat_hp.trim();
    let darurat_hp = if hp.is_empty() {
        String::new()
    } else {
        // Bentuk kanonik `+62…` seperti kontak operator (`normalizeOperatorPhone`).
        let nomor = normalize_phone_canonical(hp);
        if !nomor.starts_with('+') || !(9..=15).contains(&(nomor.len() - 1)) {
            return Err("Nomor HP darurat tidak valid.".into());
        }
        nomor
    };
    Ok(Pribadi {
        nik: nomor_identitas("nik", &p.nik)?,
        no_kk: nomor_identitas("no_kk", &p.no_kk)?,
        tempat_lahir: teks_pendek(&p.tempat_lahir, "Tempat lahir", TEKS_MAKS)?,
        tanggal_lahir: tanggal_opsional(&p.tanggal_lahir, "Tanggal lahir tidak valid.")?,
        agama: pilihan(&p.agama, &AGAMA, "Agama tidak dikenal.")?,
        status_nikah: pilihan(&p.status_nikah, &STATUS_NIKAH, "Status pernikahan tidak dikenal.")?,
        nama_ibu_kandung: teks_pendek(&p.nama_ibu_kandung, "Nama ibu kandung", TEKS_MAKS)?,
        alamat_ktp: teks_pendek(&p.alamat_ktp, "Alamat KTP", ALAMAT_MAKS)?,
        alamat_domisili: teks_pendek(&p.alamat_domisili, "Alamat domisili", ALAMAT_MAKS)?,
        darurat_nama: teks_pendek(&p.darurat_nama, "Nama kontak darurat", TEKS_MAKS)?,
        darurat_hubungan: teks_pendek(&p.darurat_hubungan, "Hubungan kontak darurat", TEKS_MAKS)?,
        darurat_hp,
    })
}

#[derive(Debug, Default, Clone, Deserialize, Serialize, PartialEq)]
#[serde(default)]
pub struct Keuangan {
    pub bank: String,
    pub no_rekening: String,
    pub nama_rekening: String,
    pub npwp: String,
    pub bpjs_kesehatan: String,
    pub bpjs_ketenagakerjaan: String,
}

pub fn validasi_keuangan(k: &Keuangan) -> Result<Keuangan, String> {
    Ok(Keuangan {
        bank: teks_pendek(&k.bank, "Nama bank", TEKS_MAKS)?,
        no_rekening: nomor_identitas("no_rekening", &k.no_rekening)?,
        nama_rekening: teks_pendek(&k.nama_rekening, "Nama pemilik rekening", TEKS_MAKS)?,
        npwp: nomor_identitas("npwp", &k.npwp)?,
        bpjs_kesehatan: nomor_identitas("bpjs_kesehatan", &k.bpjs_kesehatan)?,
        bpjs_ketenagakerjaan: nomor_identitas("bpjs_ketenagakerjaan", &k.bpjs_ketenagakerjaan)?,
    })
}

#[derive(Debug, Default, Clone, Deserialize, Serialize, PartialEq)]
#[serde(default)]
pub struct Pendidikan {
    pub jenjang: String,
    pub prodi: String,
    pub perguruan_tinggi: String,
    pub tahun_lulus: Option<i64>,
    pub linier: i64,
    pub catatan: String,
}

pub fn validasi_pendidikan(p: &Pendidikan) -> Result<Pendidikan, String> {
    let jenjang = p.jenjang.trim();
    if !JENJANG.contains(&jenjang) {
        return Err("Jenjang pendidikan tidak dikenal.".into());
    }
    if p.linier != 0 && p.linier != 1 {
        return Err("Tanda linier tidak valid.".into());
    }
    Ok(Pendidikan {
        jenjang: jenjang.to_owned(),
        prodi: teks_pendek(&p.prodi, "Program studi", 150)?,
        perguruan_tinggi: teks_pendek(&p.perguruan_tinggi, "Nama sekolah/perguruan tinggi", 150)?,
        tahun_lulus: tahun_opsional(p.tahun_lulus, "Tahun lulus tidak valid.")?,
        linier: p.linier,
        catatan: teks_pendek(&p.catatan, "Catatan", CATATAN_MAKS)?,
    })
}

#[derive(Debug, Default, Clone, Deserialize, Serialize, PartialEq)]
#[serde(default)]
pub struct Sertifikasi {
    pub nomor_sertifikat: String,
    pub nrg: String,
    pub tahun: Option<i64>,
    pub bidang_studi: String,
    pub catatan: String,
}

pub fn validasi_sertifikasi(s: &Sertifikasi) -> Result<Sertifikasi, String> {
    let hasil = Sertifikasi {
        nomor_sertifikat: teks_pendek(&s.nomor_sertifikat, "Nomor sertifikat", NOMOR_MAKS)?,
        nrg: nomor_identitas("nrg", &s.nrg)?,
        tahun: tahun_opsional(s.tahun, "Tahun sertifikat tidak valid.")?,
        bidang_studi: teks_pendek(&s.bidang_studi, "Bidang studi", 150)?,
        catatan: teks_pendek(&s.catatan, "Catatan", CATATAN_MAKS)?,
    };
    if hasil.nomor_sertifikat.is_empty() && hasil.nrg.is_empty() {
        return Err("Isi nomor sertifikat atau NRG.".into());
    }
    if hasil.bidang_studi.is_empty() {
        return Err("Bidang studi sertifikat wajib diisi.".into());
    }
    Ok(hasil)
}

#[derive(Debug, Default, Clone, Deserialize, Serialize, PartialEq)]
#[serde(default)]
pub struct Dokumen {
    pub id_jenis: String,
    pub nomor: String,
    pub tanggal_terbit: String,
    pub tanggal_kedaluwarsa: String,
    pub catatan: String,
}

/// Keputusan 1c B: jenis dan tanggal terbit wajib, nomor opsional.
pub fn validasi_dokumen(d: &Dokumen) -> Result<Dokumen, String> {
    let id_jenis = d.id_jenis.trim();
    if id_jenis.is_empty() {
        return Err("Jenis dokumen wajib dipilih.".into());
    }
    let tanggal_terbit = d.tanggal_terbit.trim();
    if !tanggal_valid(tanggal_terbit) {
        return Err("Tanggal terbit tidak valid.".into());
    }
    let tanggal_kedaluwarsa = tanggal_opsional(&d.tanggal_kedaluwarsa, "Tanggal kedaluwarsa tidak valid.")?;
    if !tanggal_kedaluwarsa.is_empty() && tanggal_kedaluwarsa.as_str() < tanggal_terbit {
        return Err("Tanggal kedaluwarsa tidak boleh sebelum tanggal terbit.".into());
    }
    Ok(Dokumen {
        id_jenis: id_jenis.to_owned(),
        nomor: teks_pendek(&d.nomor, "Nomor dokumen", NOMOR_MAKS)?,
        tanggal_terbit: tanggal_terbit.to_owned(),
        tanggal_kedaluwarsa,
        catatan: teks_pendek(&d.catatan, "Catatan", CATATAN_MAKS)?,
    })
}

#[derive(Debug, Default, Clone, Deserialize, Serialize, PartialEq)]
#[serde(default)]
pub struct BerkasDokumen {
    pub nama_berkas: String,
    pub mime_type: String,
    pub data_base64: String,
    pub ukuran_byte: usize,
}

/// Cermin `uraiBerkasDokumen`: 1 MB, empat MIME, tanda tangan bita (§19.2.5).
pub fn urai_berkas_dokumen(nama_berkas: &str, mime_type: &str, data_base64: &str) -> Result<BerkasDokumen, String> {
    let nama = nama_berkas.trim();
    if nama.is_empty() {
        return Err("Nama berkas wajib diisi.".into());
    }
    if nama.chars().count() > NAMA_BERKAS_MAKS {
        return Err(format!("Nama berkas maksimal {NAMA_BERKAS_MAKS} karakter."));
    }
    let Some(mime) = MIME_BERKAS.iter().copied().find(|m| *m == mime_type) else {
        return Err("Berkas harus berupa JPG, PNG, WEBP, atau PDF.".into());
    };
    let isi = data_base64.trim();
    let Some(ukuran_byte) = ukuran_base64(isi) else {
        return Err("Berkas tidak terbaca.".into());
    };
    if ukuran_byte > MAKS_BYTE_DOKUMEN {
        return Err("Berkas lebih dari 1 MB.".into());
    }
    if !tanda_tangan_cocok(mime, isi) {
        return Err("Isi berkas tidak sesuai formatnya.".into());
    }
    Ok(BerkasDokumen {
        nama_berkas: nama.to_owned(),
        mime_type: mime.to_owned(),
        data_base64: isi.to_owned(),
        ukuran_byte,
    })
}

/// Kelompok profil yang boleh dibaca, dari izin SESI (bukan payload).
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
pub struct Kelompok {
    pub pribadi: bool,
    pub keuangan: bool,
    pub pendidik: bool,
}

fn punya(operator: &OperatorUser, izin: &str) -> bool {
    operator.is_superadmin || operator.permissions.iter().any(|p| p == izin)
}

pub fn kelompok_profil(operator: &OperatorUser) -> Kelompok {
    Kelompok {
        pribadi: punya(operator, "hr.personal.view"),
        keuangan: punya(operator, "hr.finance.view"),
        pendidik: punya(operator, "teachers.view"),
    }
}

/// Jenis dokumen saja (tanpa pegawai) boleh dibaca pengelola organisasi
/// (keputusan 1c A); dokumen seorang pegawai tetap butuh `hr.document.view`.
pub fn boleh_baca_dokumen(operator: &OperatorUser, id_karyawan: &str) -> bool {
    punya(operator, "hr.document.view") || (id_karyawan.trim().is_empty() && punya(operator, "hr.org.manage"))
}

/// Cermin `tandaLampiran` (Q-51): jenis wajib dokumen tanpa lampiran = tanda,
/// bukan penolakan.
pub fn tanda_lampiran(wajib_dokumen: bool, jumlah: usize) -> Vec<&'static str> {
    if wajib_dokumen && jumlah == 0 {
        vec!["tanpa_dokumen"]
    } else {
        Vec::new()
    }
}

/// Cermin `bolehUbahLampiran`: pengaju (atau Superadmin) atau pemegang izin
/// pemutus jenisnya, dari sesi.
pub fn boleh_ubah_lampiran(operator: &OperatorUser, diajukan_oleh: &str, izin_pemutus: &str) -> bool {
    super::hr_pengajuan::sama_orang(diajukan_oleh, &operator.username) || punya(operator, izin_pemutus)
}

// ── Akses cloud ──

/// Belum ada database atau jaringan gagal → pesan yang bisa dibaca pengguna.
pub fn luring(galat: CommandError) -> CommandError {
    if matches!(galat.code, "TURSO_NOT_CONFIGURED" | "TURSO_NETWORK_ERROR") {
        CommandError::new("CLOUD_REQUIRED", PESAN_LURING)
    } else {
        galat
    }
}

fn galat_validasi(pesan: impl Into<String>) -> CommandError {
    CommandError::new("VALIDATION_ERROR", pesan)
}

fn baris_pertama(hasil: &QueryResult) -> Value {
    hasil.to_objects().into_iter().next().map_or(Value::Null, |baris| json!(baris))
}

fn semua(hasil: &QueryResult) -> Value {
    json!(hasil.to_objects())
}

fn terpengaruh(hasil: &[QueryResult]) -> u64 {
    hasil.first().map_or(0, |baris| baris.rows_affected)
}

fn id_atau_baru(id: Option<&str>, awalan: &str) -> String {
    match id.map(str::trim) {
        Some(id) if !id.is_empty() => id.to_owned(),
        _ => new_id(awalan),
    }
}

pub async fn profil(client: &TursoClient, id_karyawan: &str, kelompok: Kelompok) -> Result<Value, CommandError> {
    client.ensure_schema_current().await?;
    let id = id_karyawan.trim();
    let mut statement = Vec::new();
    if kelompok.pribadi {
        statement.push(Statement::new(PROFIL_PRIBADI_SQL, vec![json!(id)]));
    }
    if kelompok.keuangan {
        statement.push(Statement::new(PROFIL_KEUANGAN_SQL, vec![json!(id)]));
    }
    if kelompok.pendidik {
        statement.push(Statement::new(PENDIDIKAN_SQL, vec![json!(id)]));
        statement.push(Statement::new(SERTIFIKASI_SQL, vec![json!(id)]));
    }
    let hasil = client.execute_pipeline(statement).await?;
    let mut urut = hasil.iter();
    let mut keluaran = json!({ "id_karyawan": id });
    if kelompok.pribadi {
        keluaran["pribadi"] = urut.next().map_or(Value::Null, baris_pertama);
    }
    if kelompok.keuangan {
        keluaran["keuangan"] = urut.next().map_or(Value::Null, baris_pertama);
    }
    if kelompok.pendidik {
        keluaran["pendidik"] = json!({
            "pendidikan": urut.next().map_or(json!([]), semua),
            "sertifikasi": urut.next().map_or(json!([]), semua),
        });
    }
    Ok(keluaran)
}

async fn tulis_pegawai(client: &TursoClient, sql: &str, args: Vec<Value>) -> Result<(), CommandError> {
    client.ensure_schema_current().await?;
    let hasil = client.execute_pipeline(vec![Statement::new(sql, args)]).await?;
    if terpengaruh(&hasil) == 0 {
        return Err(galat_validasi(PESAN_PEGAWAI_BELUM_DI_CLOUD));
    }
    Ok(())
}

pub async fn simpan_pribadi(client: &TursoClient, id_karyawan: &str, draft: Value, operator: &str) -> Result<Value, CommandError> {
    let isian: Pribadi = serde_json::from_value(draft).map_err(|_| galat_validasi("Data pribadi tidak valid."))?;
    let p = validasi_pribadi(&isian).map_err(galat_validasi)?;
    let args = vec![
        json!(id_karyawan.trim()),
        json!(p.nik),
        json!(p.no_kk),
        json!(p.tempat_lahir),
        json!(p.tanggal_lahir),
        json!(p.agama),
        json!(p.status_nikah),
        json!(p.nama_ibu_kandung),
        json!(p.alamat_ktp),
        json!(p.alamat_domisili),
        json!(p.darurat_nama),
        json!(p.darurat_hubungan),
        json!(p.darurat_hp),
        json!(operator),
    ];
    tulis_pegawai(client, SIMPAN_PRIBADI_SQL, args).await?;
    Ok(json!({ "sukses": true }))
}

pub async fn simpan_keuangan(client: &TursoClient, id_karyawan: &str, draft: Value, operator: &str) -> Result<Value, CommandError> {
    let isian: Keuangan = serde_json::from_value(draft).map_err(|_| galat_validasi("Data keuangan tidak valid."))?;
    let k = validasi_keuangan(&isian).map_err(galat_validasi)?;
    let args = vec![
        json!(id_karyawan.trim()),
        json!(k.bank),
        json!(k.no_rekening),
        json!(k.nama_rekening),
        json!(k.npwp),
        json!(k.bpjs_kesehatan),
        json!(k.bpjs_ketenagakerjaan),
        json!(operator),
    ];
    tulis_pegawai(client, SIMPAN_KEUANGAN_SQL, args).await?;
    Ok(json!({ "sukses": true }))
}

#[derive(Deserialize)]
struct Pemilik {
    #[serde(default)]
    id: Option<String>,
    #[serde(default)]
    id_karyawan: String,
}

fn pemilik(draft: &Value) -> Result<Pemilik, CommandError> {
    let p: Pemilik = serde_json::from_value(draft.clone()).map_err(|_| galat_validasi("Data tidak valid."))?;
    if p.id_karyawan.trim().is_empty() {
        return Err(galat_validasi("Pegawai wajib dipilih."));
    }
    Ok(p)
}

pub async fn simpan_pendidikan(client: &TursoClient, draft: Value, operator: &str) -> Result<Value, CommandError> {
    let pemilik = pemilik(&draft)?;
    let isian: Pendidikan = serde_json::from_value(draft).map_err(|_| galat_validasi("Data pendidikan tidak valid."))?;
    let p = validasi_pendidikan(&isian).map_err(galat_validasi)?;
    let id = id_atau_baru(pemilik.id.as_deref(), "pdk-");
    let args = vec![
        json!(id),
        json!(pemilik.id_karyawan.trim()),
        json!(p.jenjang),
        json!(p.prodi),
        json!(p.perguruan_tinggi),
        json!(p.tahun_lulus),
        json!(p.linier),
        json!(p.catatan),
        json!(operator),
    ];
    tulis_pegawai(client, SIMPAN_PENDIDIKAN_SQL, args).await?;
    Ok(json!({ "id_pendidikan": id }))
}

pub async fn simpan_sertifikasi(client: &TursoClient, draft: Value, operator: &str) -> Result<Value, CommandError> {
    let pemilik = pemilik(&draft)?;
    let isian: Sertifikasi = serde_json::from_value(draft).map_err(|_| galat_validasi("Data sertifikat tidak valid."))?;
    let s = validasi_sertifikasi(&isian).map_err(galat_validasi)?;
    let id = id_atau_baru(pemilik.id.as_deref(), "srt-");
    let args = vec![
        json!(id),
        json!(pemilik.id_karyawan.trim()),
        json!(s.nomor_sertifikat),
        json!(s.nrg),
        json!(s.tahun),
        json!(s.bidang_studi),
        json!(s.catatan),
        json!(operator),
    ];
    tulis_pegawai(client, SIMPAN_SERTIFIKASI_SQL, args).await?;
    Ok(json!({ "id_sertifikasi": id }))
}

/// Hapus satu baris cloud-only berdasarkan id (pendidikan, sertifikat, berkas).
pub async fn hapus(client: &TursoClient, sql: &str, id: &str) -> Result<Value, CommandError> {
    client.ensure_schema_current().await?;
    client.query_one(sql, vec![json!(id.trim())]).await?;
    Ok(json!({ "sukses": true }))
}

pub async fn dokumen(client: &TursoClient, id_karyawan: &str) -> Result<Value, CommandError> {
    client.ensure_schema_current().await?;
    let id = id_karyawan.trim();
    if id.is_empty() {
        let jenis = client.query_one(JENIS_DOKUMEN_SQL, vec![]).await?;
        return Ok(json!({ "jenis": semua(&jenis) }));
    }
    let hasil = client
        .execute_pipeline(vec![
            Statement::new(JENIS_DOKUMEN_SQL, vec![]),
            Statement::new(DOKUMEN_SQL, vec![json!(id)]),
            Statement::new(BERKAS_DOKUMEN_SQL, vec![json!(id)]),
        ])
        .await?;
    Ok(json!({
        "jenis": semua(&hasil[0]),
        "dokumen": semua(&hasil[1]),
        "berkas": semua(&hasil[2]),
    }))
}

pub async fn ambil_berkas(client: &TursoClient, id_berkas: &str) -> Result<Value, CommandError> {
    client.ensure_schema_current().await?;
    let hasil = client.query_one(AMBIL_BERKAS_SQL, vec![json!(id_berkas.trim())]).await?;
    match baris_pertama(&hasil) {
        Value::Null => Err(CommandError::new("NOT_FOUND", "Berkas tidak ditemukan.")),
        baris => Ok(baris),
    }
}

pub async fn simpan_dokumen(client: &TursoClient, draft: Value, operator: &str) -> Result<Value, CommandError> {
    let pemilik = pemilik(&draft)?;
    let isian: Dokumen = serde_json::from_value(draft).map_err(|_| galat_validasi("Data dokumen tidak valid."))?;
    let d = validasi_dokumen(&isian).map_err(galat_validasi)?;
    let id = id_atau_baru(pemilik.id.as_deref(), "dok-");
    client.ensure_schema_current().await?;
    let hasil = client
        .execute_pipeline(vec![Statement::new(
            SIMPAN_DOKUMEN_SQL,
            vec![
                json!(id),
                json!(pemilik.id_karyawan.trim()),
                json!(d.id_jenis),
                json!(d.nomor),
                json!(d.tanggal_terbit),
                json!(d.tanggal_kedaluwarsa),
                json!(d.catatan),
                json!(operator),
            ],
        )])
        .await?;
    if terpengaruh(&hasil) == 0 {
        return Err(galat_validasi(PESAN_DOKUMEN_DITOLAK));
    }
    Ok(json!({ "id_dokumen": id }))
}

pub async fn hapus_dokumen(client: &TursoClient, id_dokumen: &str) -> Result<Value, CommandError> {
    client.ensure_schema_current().await?;
    let id = json!(id_dokumen.trim());
    client
        .execute_atomic(HAPUS_DOKUMEN_SQL.iter().map(|sql| Statement::new(*sql, vec![id.clone()])).collect())
        .await?;
    Ok(json!({ "sukses": true }))
}

pub async fn tambah_berkas(
    client: &TursoClient,
    id_dokumen: &str,
    nama_berkas: &str,
    mime_type: &str,
    data_base64: &str,
) -> Result<Value, CommandError> {
    let berkas = urai_berkas_dokumen(nama_berkas, mime_type, data_base64).map_err(galat_validasi)?;
    client.ensure_schema_current().await?;
    let id = new_id("dkb-");
    let hasil = client
        .execute_pipeline(vec![Statement::new(
            TAMBAH_BERKAS_SQL,
            vec![
                json!(id),
                json!(id_dokumen.trim()),
                json!(berkas.nama_berkas),
                json!(berkas.mime_type),
                json!(berkas.data_base64),
            ],
        )])
        .await?;
    if terpengaruh(&hasil) == 0 {
        return Err(galat_validasi(PESAN_BERKAS_PENUH));
    }
    Ok(json!({ "id_berkas": id }))
}

async fn pengajuan_lampiran(client: &TursoClient, id_pengajuan: &str) -> Result<Value, CommandError> {
    let hasil = client.query_one(PENGAJUAN_LAMPIRAN_SQL, vec![json!(id_pengajuan)]).await?;
    match baris_pertama(&hasil) {
        Value::Null => Err(galat_validasi(PESAN_PENGAJUAN_BELUM_DI_CLOUD)),
        baris => Ok(baris),
    }
}

fn teks_kolom(baris: &Value, kunci: &str) -> String {
    baris.get(kunci).and_then(Value::as_str).unwrap_or_default().to_owned()
}

fn boleh_ubah_baris(operator: &OperatorUser, baris: &Value) -> bool {
    boleh_ubah_lampiran(operator, &teks_kolom(baris, "diajukan_oleh"), &teks_kolom(baris, "izin_pemutus"))
}

pub async fn lampiran_pengajuan(
    client: &TursoClient,
    operator: &OperatorUser,
    id_pengajuan: &str,
) -> Result<Value, CommandError> {
    client.ensure_schema_current().await?;
    let id = id_pengajuan.trim();
    let hasil = client
        .execute_pipeline(vec![
            Statement::new(PENGAJUAN_LAMPIRAN_SQL, vec![json!(id)]),
            Statement::new(LAMPIRAN_SQL, vec![json!(id)]),
        ])
        .await?;
    let pengajuan = baris_pertama(&hasil[0]);
    let berkas = hasil[1].to_objects();
    if pengajuan.is_null() {
        return Ok(json!({ "ada": false, "boleh_ubah": false, "berkas": [], "tanda": [] }));
    }
    let wajib = pengajuan.get("wajib_dokumen").and_then(Value::as_i64) == Some(1);
    Ok(json!({
        "ada": true,
        "boleh_ubah": boleh_ubah_baris(operator, &pengajuan),
        "tanda": tanda_lampiran(wajib, berkas.len()),
        "berkas": berkas,
    }))
}

pub async fn ambil_lampiran(client: &TursoClient, id_berkas: &str) -> Result<Value, CommandError> {
    client.ensure_schema_current().await?;
    let hasil = client.query_one(AMBIL_LAMPIRAN_SQL, vec![json!(id_berkas.trim())]).await?;
    match baris_pertama(&hasil) {
        Value::Null => Err(CommandError::new("NOT_FOUND", "Berkas tidak ditemukan.")),
        baris => Ok(baris),
    }
}

pub async fn tambah_lampiran(
    client: &TursoClient,
    operator: &OperatorUser,
    id_pengajuan: &str,
    nama_berkas: &str,
    mime_type: &str,
    data_base64: &str,
) -> Result<Value, CommandError> {
    let berkas = urai_berkas_dokumen(nama_berkas, mime_type, data_base64).map_err(galat_validasi)?;
    client.ensure_schema_current().await?;
    let id_pengajuan = id_pengajuan.trim();
    if !boleh_ubah_baris(operator, &pengajuan_lampiran(client, id_pengajuan).await?) {
        return Err(CommandError::new("DESKTOP_ACCESS_DENIED", PESAN_LAMPIRAN_DITOLAK));
    }
    let id = new_id("pgb-");
    let hasil = client
        .execute_pipeline(vec![Statement::new(
            TAMBAH_LAMPIRAN_SQL,
            vec![
                json!(id),
                json!(id_pengajuan),
                json!(berkas.nama_berkas),
                json!(berkas.mime_type),
                json!(berkas.data_base64),
                json!(operator.username),
            ],
        )])
        .await?;
    if terpengaruh(&hasil) == 0 {
        return Err(galat_validasi(PESAN_LAMPIRAN_PENUH));
    }
    Ok(json!({ "id_berkas": id }))
}

pub async fn hapus_lampiran(client: &TursoClient, operator: &OperatorUser, id_berkas: &str) -> Result<Value, CommandError> {
    client.ensure_schema_current().await?;
    let id = id_berkas.trim();
    let pemilik = baris_pertama(&client.query_one(PEMILIK_LAMPIRAN_SQL, vec![json!(id)]).await?);
    if pemilik.is_null() {
        return Err(CommandError::new("NOT_FOUND", "Berkas tidak ditemukan."));
    }
    if !boleh_ubah_baris(operator, &pemilik) {
        return Err(CommandError::new("DESKTOP_ACCESS_DENIED", PESAN_LAMPIRAN_DITOLAK));
    }
    hapus(client, HAPUS_LAMPIRAN_SQL, id).await
}

#[derive(Deserialize)]
#[serde(default)]
struct JenisDokumenDraft {
    id: Option<String>,
    nama: String,
    is_aktif: i64,
}

impl Default for JenisDokumenDraft {
    fn default() -> Self {
        Self { id: None, nama: String::new(), is_aktif: 1 }
    }
}

pub async fn simpan_jenis_dokumen(client: &TursoClient, draft: Value) -> Result<Value, CommandError> {
    let isian: JenisDokumenDraft =
        serde_json::from_value(draft).map_err(|_| galat_validasi("Data jenis dokumen tidak valid."))?;
    let nama = validasi_nama_master(&isian.nama, "jenis dokumen").map_err(galat_validasi)?;
    let aktif = i64::from(isian.is_aktif != 0);
    let id = id_atau_baru(isian.id.as_deref(), "dok-");
    client.ensure_schema_current().await?;
    if aktif == 1 && !client.query_one(BENTROK_JENIS_DOKUMEN_SQL, vec![json!(nama), json!(id)]).await?.rows.is_empty() {
        return Err(galat_validasi("Jenis dokumen dengan nama itu sudah ada."));
    }
    client.query_one(SIMPAN_JENIS_DOKUMEN_SQL, vec![json!(id), json!(nama), json!(aktif)]).await?;
    Ok(json!({ "id_jenis": id }))
}

pub async fn laporan_ptk(client: &TursoClient) -> Result<Value, CommandError> {
    client.ensure_schema_current().await?;
    let hari = client.query_one(HARI_INI_SQL, vec![]).await?;
    let hari_ini = baris_pertama(&hari)["hari_ini"].as_str().unwrap_or_default().to_owned();
    let hasil = client
        .execute_pipeline(vec![
            Statement::new(STATUS_KINI_SQL, vec![json!(hari_ini)]),
            Statement::new(PTK_SQL, vec![]),
        ])
        .await?;
    let status: HashMap<String, Value> = hasil[0]
        .to_objects()
        .into_iter()
        .map(|mut b| {
            let id = b.remove("id_unik").and_then(|v| v.as_str().map(str::to_owned)).unwrap_or_default();
            (id, b.remove("status").unwrap_or(json!("")))
        })
        .collect();
    let baris: Vec<Value> = hasil[1]
        .to_objects()
        .into_iter()
        .map(|mut b| {
            let id = b.get("id_unik").and_then(Value::as_str).unwrap_or_default();
            let kini = status.get(id).cloned().unwrap_or(json!(""));
            b.insert("status".into(), kini);
            json!(b)
        })
        .collect();
    Ok(json!({ "hari_ini": hari_ini, "baris": baris }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use reqwest::Client;
    use url::Url;

    // Vektor kembar `src/lib/validations/hris.test.ts` (bagian 1c).
    const VEKTOR: &str = include_str!("../../../src/lib/validations/hris.vektor.json");

    fn vektor() -> Value {
        serde_json::from_str(VEKTOR).expect("vektor hris")
    }

    fn hasil<T: Serialize>(h: Result<T, String>) -> Value {
        match h {
            Ok(nilai) => json!({ "hasil": nilai }),
            Err(galat) => json!({ "galat": galat }),
        }
    }

    #[test]
    fn hris_cloud_vektor_pengenal_dan_isian() {
        let v = vektor();
        for k in v["nomor_identitas"].as_array().expect("nomor") {
            let h = nomor_identitas(k[0].as_str().unwrap(), k[1].as_str().unwrap());
            assert_eq!(h.as_ref().ok().map(String::as_str), k[2].as_str(), "{k}");
            assert_eq!(h.err().as_deref(), k[3].as_str(), "{k}");
        }
        let kasus = |kunci: &str, f: &dyn Fn(&Value) -> Value| {
            for k in v[kunci].as_array().expect(kunci) {
                let masuk = gabung(&v[&format!("{kunci}_dasar")], &k["ubah"]);
                let keluar = f(&masuk);
                let harapan = if k["galat"].is_null() { json!({ "hasil": k["hasil"] }) } else { json!({ "galat": k["galat"] }) };
                assert_eq!(keluar, harapan, "{kunci}: {k}");
            }
        };
        kasus("pribadi", &|m| hasil(validasi_pribadi(&serde_json::from_value(m.clone()).unwrap())));
        kasus("keuangan", &|m| hasil(validasi_keuangan(&serde_json::from_value(m.clone()).unwrap())));
        kasus("pendidikan", &|m| hasil(validasi_pendidikan(&serde_json::from_value(m.clone()).unwrap())));
        kasus("sertifikasi", &|m| hasil(validasi_sertifikasi(&serde_json::from_value(m.clone()).unwrap())));
        kasus("dokumen", &|m| hasil(validasi_dokumen(&serde_json::from_value(m.clone()).unwrap())));
        for k in v["berkas_dokumen"].as_array().expect("berkas") {
            let h = urai_berkas_dokumen(
                k["nama_berkas"].as_str().unwrap(),
                k["mime_type"].as_str().unwrap(),
                k["data_base64"].as_str().unwrap(),
            )
            .map(|b| json!({ "nama_berkas": b.nama_berkas, "mime_type": b.mime_type, "ukuran_byte": b.ukuran_byte }));
            let harapan = if k["galat"].is_null() { json!({ "hasil": k["hasil"] }) } else { json!({ "galat": k["galat"] }) };
            assert_eq!(hasil(h), harapan, "{k}");
        }
        for k in v["tanda_lampiran"].as_array().expect("tanda_lampiran") {
            let tanda = tanda_lampiran(k[0] == true, k[1].as_u64().unwrap() as usize);
            assert_eq!(json!(tanda), k[2], "{k}");
        }
    }

    fn gabung(dasar: &Value, ubah: &Value) -> Value {
        let mut hasil = dasar.clone();
        for (k, v) in ubah.as_object().expect("ubah") {
            hasil[k] = v.clone();
        }
        hasil
    }

    #[test]
    fn hris_cloud_batas_berkas_satu_mb() {
        use base64::prelude::*;
        let pdf = |byte: usize| {
            let mut isi = b"%PDF-1.7".to_vec();
            isi.resize(byte, b' ');
            BASE64_STANDARD.encode(isi)
        };
        assert_eq!(urai_berkas_dokumen("a.pdf", "application/pdf", &pdf(MAKS_BYTE_DOKUMEN)).unwrap().ukuran_byte, MAKS_BYTE_DOKUMEN);
        assert_eq!(
            urai_berkas_dokumen("a.pdf", "application/pdf", &pdf(MAKS_BYTE_DOKUMEN + 1)),
            Err("Berkas lebih dari 1 MB.".to_string())
        );
    }

    fn operator(izin: &[&str]) -> OperatorUser {
        let mut op: OperatorUser = serde_json::from_value(json!({
            "id": 1, "kode_operator": "OP", "nama_operator": "Uji", "username": "uji", "role": "Uji",
            "roleId": 9, "roleKey": "uji", "isSuperadmin": false, "permissions": [], "permissionRevision": 1
        }))
        .expect("operator uji");
        op.permissions = izin.iter().map(|s| (*s).to_owned()).collect();
        op
    }

    #[test]
    fn hris_cloud_kelompok_dari_izin_sesi() {
        assert_eq!(
            kelompok_profil(&operator(&["hr.personal.view", "employees.view"])),
            Kelompok { pribadi: true, keuangan: false, pendidik: false }
        );
        assert_eq!(
            kelompok_profil(&operator(&["hr.finance.view", "teachers.view"])),
            Kelompok { pribadi: false, keuangan: true, pendidik: true }
        );
        let org = operator(&["hr.org.manage"]);
        assert!(boleh_baca_dokumen(&org, ""));
        assert!(!boleh_baca_dokumen(&org, "p1"));
        assert!(boleh_baca_dokumen(&operator(&["hr.document.view"]), "p1"));
    }

    /// Jalur cloud nyata lewat `TursoClient::local_file` di atas skema `ensure_schema`.
    #[test]
    fn hris_cloud_profil_dokumen_di_database() {
        let dir = tempfile::tempdir().expect("direktori sementara");
        let hub = dir.path().join("sppg-hub.db");
        let rt = tokio::runtime::Builder::new_current_thread().build().expect("runtime uji");
        let client = TursoClient::local_file(Url::parse(super::super::turso::LOCAL_FILE_ORIGIN).unwrap(), &hub, Client::new());
        rt.block_on(async {
            client.ensure_schema().await.expect("skema");
            client
                .query_one(
                    "INSERT INTO master_data (id_unik, nama, divisi, id_shift, jenis_personil) VALUES ('p1', 'Guru A', 'Tenaga Pengajar', 1, 'GURU'), ('s1', 'Siswa B', 'Peserta Didik', 1, 'SISWA');",
                    vec![],
                )
                .await
                .expect("pegawai");

            let pribadi = json!({ "nik": "3201.0101-0101 0001", "agama": "Islam", "darurat_hp": "0812 3456 7890" });
            simpan_pribadi(&client, "p1", pribadi.clone(), "uji").await.expect("simpan pribadi");
            let siswa = simpan_pribadi(&client, "s1", pribadi, "uji").await.unwrap_err();
            assert_eq!(siswa.message, PESAN_PEGAWAI_BELUM_DI_CLOUD);
            simpan_keuangan(&client, "p1", json!({ "no_rekening": "123-456-789", "npwp": "" }), "uji").await.expect("keuangan");
            simpan_pendidikan(&client, json!({ "id_karyawan": "p1", "jenjang": "S1", "prodi": "PGSD", "tahun_lulus": 2015, "linier": 1 }), "uji")
                .await
                .expect("pendidikan");

            let hanya_pribadi = profil(&client, "p1", Kelompok { pribadi: true, keuangan: false, pendidik: false }).await.unwrap();
            assert_eq!(hanya_pribadi["pribadi"]["nik"], "3201010101010001");
            assert_eq!(hanya_pribadi["pribadi"]["darurat_hp"], "+6281234567890");
            assert!(hanya_pribadi.get("keuangan").is_none() && hanya_pribadi.get("pendidik").is_none());
            let lengkap = profil(&client, "p1", Kelompok { pribadi: false, keuangan: true, pendidik: true }).await.unwrap();
            assert!(lengkap.get("pribadi").is_none());
            assert_eq!(lengkap["keuangan"]["no_rekening"], "123456789");
            assert_eq!(lengkap["pendidik"]["pendidikan"][0]["jenjang"], "S1");

            let dok = simpan_dokumen(&client, json!({ "id_karyawan": "p1", "id_jenis": "dok-ktp", "tanggal_terbit": "2020-01-02" }), "uji")
                .await
                .expect("dokumen");
            let id_dok = dok["id_dokumen"].as_str().unwrap().to_owned();
            let ditolak = simpan_dokumen(&client, json!({ "id_karyawan": "p1", "id_jenis": "dok-tak-ada", "tanggal_terbit": "2020-01-02" }), "uji")
                .await
                .unwrap_err();
            assert_eq!(ditolak.message, PESAN_DOKUMEN_DITOLAK);
            let png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
            for _ in 0..MAKS_BERKAS_DOKUMEN {
                tambah_berkas(&client, &id_dok, "ktp.png", "image/png", png).await.expect("berkas");
            }
            let penuh = tambah_berkas(&client, &id_dok, "ktp.png", "image/png", png).await.unwrap_err();
            assert_eq!(penuh.message, PESAN_BERKAS_PENUH);
            let daftar = dokumen(&client, "p1").await.unwrap();
            let urutan: Vec<i64> = daftar["berkas"].as_array().unwrap().iter().map(|b| b["urutan"].as_i64().unwrap()).collect();
            assert_eq!(urutan, vec![1, 2, 3, 4, 5]);
            assert_eq!(daftar["berkas"][0]["ukuran_byte"], 70);
            assert!(daftar["berkas"][0].get("data_base64").is_none());

            hapus_dokumen(&client, &id_dok).await.expect("hapus dokumen");
            let sisa = client.query_one("SELECT COUNT(*) AS n FROM hr_dokumen_berkas;", vec![]).await.unwrap();
            assert_eq!(baris_pertama(&sisa)["n"], 0);
            assert!(dokumen(&client, "").await.unwrap()["jenis"].as_array().unwrap().len() >= 13);
        });
    }

    /// Lampiran pengajuan (§20.3, Q-51) di database cloud sungguhan: maks 5,
    /// hanya pengaju atau pemutus jenis, wajib dokumen = tanda.
    #[test]
    fn hris_cloud_lampiran_pengajuan() {
        let dir = tempfile::tempdir().expect("direktori sementara");
        let hub = dir.path().join("sppg-hub.db");
        let rt = tokio::runtime::Builder::new_current_thread().build().expect("runtime uji");
        let client = TursoClient::local_file(Url::parse(super::super::turso::LOCAL_FILE_ORIGIN).unwrap(), &hub, Client::new());
        rt.block_on(async {
            client.ensure_schema().await.expect("skema");
            client
                .query_one(
                    "INSERT INTO hr_pengajuan (id_pengajuan, id_karyawan, id_jenis, kelompok, potong_jatah, dampak_gaji, izin_pemutus, tanggal_mulai, tanggal_selesai, setengah_hari, alasan, sidik, diajukan_oleh, waktu_perangkat) VALUES ('pgn-1', 'p1', 'jns-sakit', 'Sakit', 0, 'Dibayar', 'hr.request.decide', '2026-11-10', '2026-11-10', 0, 'demam', 's', 'tu', '2026-11-10 07:00:00');",
                    vec![],
                )
                .await
                .expect("pengajuan");
            let mut tu = operator(&["hr.request.submit"]);
            tu.username = "tu".into();
            let awal = lampiran_pengajuan(&client, &tu, "pgn-1").await.unwrap();
            assert_eq!(awal["tanda"], json!(["tanpa_dokumen"]));
            assert_eq!(awal["boleh_ubah"], true);
            let belum = lampiran_pengajuan(&client, &tu, "pgn-tak-ada").await.unwrap();
            assert_eq!(belum["ada"], false);

            let png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
            let lain = operator(&["hr.request.submit"]);
            let ditolak = tambah_lampiran(&client, &lain, "pgn-1", "a.png", "image/png", png).await.unwrap_err();
            assert_eq!(ditolak.message, PESAN_LAMPIRAN_DITOLAK);
            let pemutus = operator(&["hr.request.decide"]);
            for _ in 0..MAKS_BERKAS_DOKUMEN {
                tambah_lampiran(&client, &pemutus, "pgn-1", "surat.png", "image/png", png).await.expect("lampiran");
            }
            let keenam = tambah_lampiran(&client, &tu, "pgn-1", "surat.png", "image/png", png).await.unwrap_err();
            assert_eq!(keenam.message, PESAN_LAMPIRAN_PENUH);
            let tak_ada = tambah_lampiran(&client, &tu, "pgn-tak-ada", "a.png", "image/png", png).await.unwrap_err();
            assert_eq!(tak_ada.message, PESAN_PENGAJUAN_BELUM_DI_CLOUD);

            let isi = lampiran_pengajuan(&client, &lain, "pgn-1").await.unwrap();
            assert_eq!(isi["boleh_ubah"], false);
            assert_eq!(isi["tanda"], json!([]));
            let berkas = isi["berkas"].as_array().unwrap();
            assert_eq!(berkas.len(), 5);
            assert!(berkas[0].get("data_base64").is_none());
            let id = berkas[0]["id_berkas"].as_str().unwrap().to_owned();
            assert_eq!(ambil_lampiran(&client, &id).await.unwrap()["data_base64"], png);
            assert_eq!(hapus_lampiran(&client, &lain, &id).await.unwrap_err().message, PESAN_LAMPIRAN_DITOLAK);
            hapus_lampiran(&client, &tu, &id).await.expect("hapus");
            assert_eq!(lampiran_pengajuan(&client, &tu, "pgn-1").await.unwrap()["berkas"].as_array().unwrap().len(), 4);
        });
    }

    #[test]
    fn hris_cloud_pesan_luring() {
        let galat = luring(CommandError::new("TURSO_NETWORK_ERROR", "x"));
        assert_eq!((galat.code, galat.message.as_str()), ("CLOUD_REQUIRED", PESAN_LURING));
        assert_eq!(luring(CommandError::new("VALIDATION_ERROR", "y")).message, "y");
    }
}
