//! HRIS Fase 1a (`prd-hris.md` §19.2.1): bagian dan jabatan sebagai master.
//!
//! Teks `master_data.divisi`/`jabatan_status` tetap ada dan selalu diisi nama
//! sekarang (A-1), supaya scanner, kartu ID, payroll, dan kueri lama tidak
//! berubah. Ganti nama dan gabung bagian menulis ulang riwayat anggotanya dan
//! konfigurasi kini (Q-17 (a)), lokal dan di handler cloud dengan SQL yang
//! sama.
//!
//! Aturan murni dan SQL di berkas ini dicerminkan
//! `src/lib/validations/hris.ts`; vektornya `validations/hris.vektor.json`,
//! teks SQL dibandingkan harfiah oleh `hris.test.ts`.

use std::collections::{BTreeMap, BTreeSet, HashMap};

use rusqlite::{params, OptionalExtension, Transaction};
use serde::Deserialize;
use serde_json::{json, Value};

use super::hari_kerja::tanggal_valid;
use super::{config::DesktopState, models::CommandError, storage, sync};

pub const NAMA_MAKS: usize = 60;

/// Pegawai = personil yang bukan siswa (alias `m` = `master_data`).
pub const PEGAWAI_SQL: &str = "LOWER(TRIM(COALESCE(m.jenis_personil, ''))) <> 'siswa' AND NOT EXISTS (SELECT 1 FROM siswa_data sd WHERE sd.id_siswa = m.id_unik)";

/// Migrasi v68, sekali per database cloud (`ensure_hris_organisasi_v68`).
/// Id bagian/jabatan hasil migrasi deterministik dari teksnya, sehingga Web
/// dan Rust menghasilkan id yang sama.
pub const MIGRASI_ORGANISASI_SQL: [&str; 7] = [
    "INSERT OR IGNORE INTO hr_bagian (id_bagian, nama) SELECT 'bag-' || lower(hex(lower(trim(m.divisi)))), trim(m.divisi) FROM master_data m WHERE LOWER(TRIM(COALESCE(m.jenis_personil, ''))) <> 'siswa' AND NOT EXISTS (SELECT 1 FROM siswa_data sd WHERE sd.id_siswa = m.id_unik) AND trim(COALESCE(m.divisi, '')) <> '' GROUP BY lower(trim(m.divisi)), trim(m.divisi) ORDER BY lower(trim(m.divisi)), COUNT(*) DESC, trim(m.divisi);",
    "INSERT OR IGNORE INTO hr_bagian_nama (id_nama, id_bagian, nama) SELECT b.id_bagian || ':' || lower(hex(lower(b.nama))), b.id_bagian, b.nama FROM hr_bagian b;",
    "INSERT OR IGNORE INTO hr_jabatan (id_jabatan, nama) SELECT 'jab-' || lower(hex(lower(trim(m.jabatan_status)))), trim(m.jabatan_status) FROM master_data m WHERE LOWER(TRIM(COALESCE(m.jenis_personil, ''))) <> 'siswa' AND NOT EXISTS (SELECT 1 FROM siswa_data sd WHERE sd.id_siswa = m.id_unik) AND trim(COALESCE(m.jabatan_status, '')) NOT IN ('', '-') GROUP BY lower(trim(m.jabatan_status)), trim(m.jabatan_status) ORDER BY lower(trim(m.jabatan_status)), COUNT(*) DESC, trim(m.jabatan_status);",
    "UPDATE master_data SET id_bagian = 'bag-' || lower(hex(lower(trim(divisi)))) WHERE id_bagian IS NULL AND trim(COALESCE(divisi, '')) <> '' AND id_unik IN (SELECT m.id_unik FROM master_data m WHERE LOWER(TRIM(COALESCE(m.jenis_personil, ''))) <> 'siswa' AND NOT EXISTS (SELECT 1 FROM siswa_data sd WHERE sd.id_siswa = m.id_unik));",
    "UPDATE master_data SET id_jabatan = 'jab-' || lower(hex(lower(trim(jabatan_status)))) WHERE id_jabatan IS NULL AND trim(COALESCE(jabatan_status, '')) NOT IN ('', '-') AND id_unik IN (SELECT m.id_unik FROM master_data m WHERE LOWER(TRIM(COALESCE(m.jenis_personil, ''))) <> 'siswa' AND NOT EXISTS (SELECT 1 FROM siswa_data sd WHERE sd.id_siswa = m.id_unik));",
    "INSERT OR IGNORE INTO hr_tugas_jenis (id_jenis, nama, ekuivalen_jp) VALUES ('tgs-kepsek', 'Kepala Sekolah', 24), ('tgs-wakasek', 'Wakil Kepala Sekolah', 12), ('tgs-kaprog', 'Kepala Program Keahlian', 12), ('tgs-kaperpus', 'Kepala Perpustakaan', 12), ('tgs-kalab', 'Kepala Laboratorium/Bengkel', 12), ('tgs-wali-kelas', 'Wali Kelas', 2), ('tgs-pembina-osis', 'Pembina OSIS', 2), ('tgs-pembina-ekskul', 'Pembina Ekstrakurikuler', 2), ('tgs-piket', 'Guru Piket', 1), ('tgs-bendahara-bos', 'Bendahara BOS', 0);",
    "INSERT OR IGNORE INTO hr_dokumen_jenis (id_jenis, nama) VALUES ('dok-ktp', 'KTP'), ('dok-kk', 'Kartu Keluarga'), ('dok-npwp', 'NPWP'), ('dok-ijazah', 'Ijazah'), ('dok-transkrip', 'Transkrip Nilai'), ('dok-serdik', 'Sertifikat Pendidik'), ('dok-sk-yayasan', 'SK Yayasan'), ('dok-sk-tugas', 'SK Tugas'), ('dok-kontrak', 'Kontrak Kerja'), ('dok-skck', 'SKCK'), ('dok-sehat', 'Surat Keterangan Sehat'), ('dok-pelatihan', 'Sertifikat Pelatihan'), ('dok-lainnya', 'Lainnya');",
];

/// ?1 = id_bagian, ?2 = nama, ?3 = is_aktif.
pub const SIMPAN_BAGIAN_SQL: &str = "INSERT INTO hr_bagian (id_bagian, nama, is_aktif, created_at, updated_at) VALUES (?1, ?2, ?3, datetime('now'), datetime('now')) ON CONFLICT(id_bagian) DO UPDATE SET nama = excluded.nama, is_aktif = excluded.is_aktif, updated_at = excluded.updated_at;";
/// ?1 = id_nama (`id_nama_bagian`), ?2 = id_bagian, ?3 = nama.
pub const CATAT_NAMA_BAGIAN_SQL: &str = "INSERT OR IGNORE INTO hr_bagian_nama (id_nama, id_bagian, nama, created_at) VALUES (?1, ?2, ?3, datetime('now'));";
/// ?1 = id_jabatan, ?2 = nama, ?3 = is_aktif.
pub const SIMPAN_JABATAN_SQL: &str = "INSERT INTO hr_jabatan (id_jabatan, nama, is_aktif, created_at, updated_at) VALUES (?1, ?2, ?3, datetime('now'), datetime('now')) ON CONFLICT(id_jabatan) DO UPDATE SET nama = excluded.nama, is_aktif = excluded.is_aktif, updated_at = excluded.updated_at;";

/// Nama sekarang bagian ?1 ke semua anggotanya dan ke riwayat yang hari ini
/// ditulis ulang saat identitas satu orang berubah, plus sasaran `DIVISI:`
/// komponen gaji dan whitelist libur yang memakai nama mana pun milik bagian
/// itu. Slip beku (`payroll_items`) tidak disentuh. Aman diulang. Statement
/// pertama menautkan pegawai tanpa bagian yang teks divisinya cocok dengan
/// nama bagian ini ("Jadikan bagian" di tab Organisasi).
pub const TULIS_ULANG_BAGIAN_SQL: [&str; 10] = [
    "UPDATE master_data SET id_bagian = ?1 WHERE COALESCE(id_bagian, '') = '' AND EXISTS (SELECT 1 FROM hr_bagian WHERE id_bagian = ?1 AND is_aktif = 1) AND lower(trim(divisi)) IN (SELECT lower(trim(nama)) FROM hr_bagian_nama WHERE id_bagian = ?1) AND LOWER(TRIM(COALESCE(jenis_personil, ''))) <> 'siswa' AND NOT EXISTS (SELECT 1 FROM siswa_data sd WHERE sd.id_siswa = master_data.id_unik);",
    "UPDATE master_data SET divisi = (SELECT nama FROM hr_bagian WHERE id_bagian = ?1) WHERE id_bagian = ?1 AND EXISTS (SELECT 1 FROM hr_bagian WHERE id_bagian = ?1) AND divisi IS NOT (SELECT nama FROM hr_bagian WHERE id_bagian = ?1);",
    "UPDATE id_card SET divisi = (SELECT nama FROM hr_bagian WHERE id_bagian = ?1) WHERE id_unik IN (SELECT id_unik FROM master_data WHERE id_bagian = ?1) AND EXISTS (SELECT 1 FROM hr_bagian WHERE id_bagian = ?1) AND divisi IS NOT (SELECT nama FROM hr_bagian WHERE id_bagian = ?1);",
    "UPDATE absensi_harian SET kelas_divisi = (SELECT nama FROM hr_bagian WHERE id_bagian = ?1) WHERE id_karyawan IN (SELECT id_unik FROM master_data WHERE id_bagian = ?1) AND EXISTS (SELECT 1 FROM hr_bagian WHERE id_bagian = ?1) AND kelas_divisi IS NOT (SELECT nama FROM hr_bagian WHERE id_bagian = ?1);",
    "UPDATE log_scan SET divisi = (SELECT nama FROM hr_bagian WHERE id_bagian = ?1) WHERE id_karyawan IN (SELECT id_unik FROM master_data WHERE id_bagian = ?1) AND EXISTS (SELECT 1 FROM hr_bagian WHERE id_bagian = ?1) AND divisi IS NOT (SELECT nama FROM hr_bagian WHERE id_bagian = ?1);",
    "UPDATE backup_karyawan SET divisi_pengganti = (SELECT nama FROM hr_bagian WHERE id_bagian = ?1) WHERE id_karyawan_pengganti IN (SELECT id_unik FROM master_data WHERE id_bagian = ?1) AND EXISTS (SELECT 1 FROM hr_bagian WHERE id_bagian = ?1) AND divisi_pengganti IS NOT (SELECT nama FROM hr_bagian WHERE id_bagian = ?1);",
    "UPDATE backup_karyawan SET divisi_asal = (SELECT nama FROM hr_bagian WHERE id_bagian = ?1) WHERE id_karyawan_asal IN (SELECT id_unik FROM master_data WHERE id_bagian = ?1) AND EXISTS (SELECT 1 FROM hr_bagian WHERE id_bagian = ?1) AND divisi_asal IS NOT (SELECT nama FROM hr_bagian WHERE id_bagian = ?1);",
    "UPDATE koreksi_admin SET divisi = (SELECT nama FROM hr_bagian WHERE id_bagian = ?1) WHERE id_karyawan IN (SELECT id_unik FROM master_data WHERE id_bagian = ?1) AND EXISTS (SELECT 1 FROM hr_bagian WHERE id_bagian = ?1) AND divisi IS NOT (SELECT nama FROM hr_bagian WHERE id_bagian = ?1);",
    "UPDATE payroll_components SET applies_to = 'DIVISI:' || (SELECT nama FROM hr_bagian WHERE id_bagian = ?1) WHERE EXISTS (SELECT 1 FROM hr_bagian WHERE id_bagian = ?1) AND upper(substr(trim(applies_to), 1, 7)) = 'DIVISI:' AND lower(trim(substr(trim(applies_to), 8))) IN (SELECT lower(trim(nama)) FROM hr_bagian_nama WHERE id_bagian = ?1) AND applies_to IS NOT ('DIVISI:' || (SELECT nama FROM hr_bagian WHERE id_bagian = ?1));",
    "UPDATE hari_libur_whitelist SET scope_value = (SELECT nama FROM hr_bagian WHERE id_bagian = ?1), updated_at = datetime('now') WHERE scope_type = 'DIVISI' AND EXISTS (SELECT 1 FROM hr_bagian WHERE id_bagian = ?1) AND lower(trim(scope_value)) IN (SELECT lower(trim(nama)) FROM hr_bagian_nama WHERE id_bagian = ?1) AND scope_value IS NOT (SELECT nama FROM hr_bagian WHERE id_bagian = ?1);",
];

/// Nama jabatan ?1 ke semua pemegangnya. Kartu ID membaca `jabatan_status`
/// dari `master_data`, jadi satu tabel cukup.
pub const TULIS_ULANG_JABATAN_SQL: &str = "UPDATE master_data SET jabatan_status = (SELECT nama FROM hr_jabatan WHERE id_jabatan = ?1) WHERE id_jabatan = ?1 AND EXISTS (SELECT 1 FROM hr_jabatan WHERE id_jabatan = ?1) AND jabatan_status IS NOT (SELECT nama FROM hr_jabatan WHERE id_jabatan = ?1);";

/// Gabungkan bagian ?1 ke ?2 (Q-38): nama-nama ?1 menjadi nama lama ?2,
/// anggotanya pindah, ?1 dinonaktifkan. Sesudahnya `TULIS_ULANG_BAGIAN_SQL`
/// dijalankan untuk ?2. Tujuan yang tidak ada = tidak terjadi apa-apa.
pub const GABUNG_BAGIAN_SQL: [&str; 3] = [
    "INSERT OR IGNORE INTO hr_bagian_nama (id_nama, id_bagian, nama, created_at) SELECT ?2 || substr(id_nama, length(?1) + 1), ?2, nama, created_at FROM hr_bagian_nama WHERE id_bagian = ?1 AND ?1 <> ?2 AND EXISTS (SELECT 1 FROM hr_bagian WHERE id_bagian = ?2);",
    "UPDATE master_data SET id_bagian = ?2 WHERE id_bagian = ?1 AND ?1 <> ?2 AND EXISTS (SELECT 1 FROM hr_bagian WHERE id_bagian = ?2);",
    "UPDATE hr_bagian SET is_aktif = 0, updated_at = datetime('now') WHERE id_bagian = ?1 AND ?1 <> ?2 AND EXISTS (SELECT 1 FROM hr_bagian WHERE id_bagian = ?2);",
];

/// Teks divisi → bagian, termasuk nama lama; bagian aktif didahulukan.
/// ?1 = teks yang sudah `normalisasi_nama`.
pub const PETA_BAGIAN_SQL: &str = "SELECT n.id_bagian, b.nama FROM hr_bagian_nama n JOIN hr_bagian b ON b.id_bagian = n.id_bagian WHERE lower(trim(n.nama)) = lower(trim(?1)) ORDER BY b.is_aktif DESC, n.created_at DESC, n.id_nama LIMIT 1;";
/// Teks jabatan → jabatan; jabatan tidak punya riwayat nama (pola Q-39 perusahaan).
pub const PETA_JABATAN_SQL: &str = "SELECT id_jabatan, nama FROM hr_jabatan WHERE lower(trim(nama)) = lower(trim(?1)) ORDER BY is_aktif DESC, id_jabatan LIMIT 1;";

/// ?1 = nama, ?2 = id bagian yang disimpan (kosong untuk bagian baru).
/// Bentrok dengan nama sekarang ATAU nama lama bagian aktif lain.
pub const BENTROK_BAGIAN_SQL: &str = "SELECT 1 FROM hr_bagian b WHERE b.id_bagian <> ?2 AND b.is_aktif = 1 AND lower(trim(b.nama)) = lower(trim(?1)) UNION ALL SELECT 1 FROM hr_bagian_nama n JOIN hr_bagian b ON b.id_bagian = n.id_bagian WHERE n.id_bagian <> ?2 AND b.is_aktif = 1 AND lower(trim(n.nama)) = lower(trim(?1)) LIMIT 1;";
/// ?1 = nama, ?2 = id jabatan yang disimpan.
pub const BENTROK_JABATAN_SQL: &str = "SELECT 1 FROM hr_jabatan WHERE id_jabatan <> ?2 AND is_aktif = 1 AND lower(trim(nama)) = lower(trim(?1)) LIMIT 1;";

/// Pegawai untuk halaman Kepegawaian dan pemilih atasan.
pub const ORG_PEGAWAI_SQL: &str = "SELECT m.id_unik, COALESCE(m.kode_karyawan, '') AS kode_karyawan, m.nama, COALESCE(m.unit, '') AS unit, COALESCE(m.divisi, '') AS divisi, COALESCE(m.jabatan_status, '') AS jabatan_status, COALESCE(m.id_bagian, '') AS id_bagian, COALESCE(m.id_jabatan, '') AS id_jabatan, COALESCE(m.id_atasan, '') AS id_atasan, COALESCE(m.status_aktif, 'Aktif') AS status_aktif, COALESCE(m.tanggal_mulai_aktif, '') AS tmt, CASE WHEN g.id_guru IS NOT NULL OR LOWER(TRIM(COALESCE(m.jenis_personil, ''))) = 'guru' THEN 'Guru' ELSE 'Tendik' END AS kelompok, COALESCE(g.status_kepegawaian, '') AS status_kepegawaian FROM master_data m LEFT JOIN guru_data g ON g.id_guru = m.id_unik WHERE LOWER(TRIM(COALESCE(m.jenis_personil, ''))) <> 'siswa' AND NOT EXISTS (SELECT 1 FROM siswa_data sd WHERE sd.id_siswa = m.id_unik) ORDER BY m.nama, m.id_unik\n-- batas: pegawai sekolah (guru dan tendik), dibatasi jumlah personil lembaga\n;";
pub const ORG_BAGIAN_SQL: &str = "SELECT id_bagian, nama, is_aktif FROM hr_bagian ORDER BY nama, id_bagian\n-- batas: daftar bagian sekolah, tidak tumbuh per hari\n;";
pub const ORG_BAGIAN_NAMA_SQL: &str = "SELECT id_bagian, nama FROM hr_bagian_nama ORDER BY created_at, id_nama\n-- batas: nama yang pernah dipakai bagian sekolah\n;";
pub const ORG_JABATAN_SQL: &str = "SELECT id_jabatan, nama, is_aktif FROM hr_jabatan ORDER BY nama, id_jabatan\n-- batas: daftar jabatan sekolah, tidak tumbuh per hari\n;";

// Aturan murni

/// Spasi beruntun menjadi satu, spasi tepi dibuang.
pub fn normalisasi_nama(nama: &str) -> String {
    nama.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Kunci pembanding nama: tanpa beda huruf besar-kecil dan spasi ganda.
pub fn kunci_nama(nama: &str) -> String {
    normalisasi_nama(nama).to_lowercase()
}

pub fn validasi_nama_master(nama: &str, jenis: &str) -> Result<String, String> {
    let nama = normalisasi_nama(nama);
    let panjang = nama.chars().count();
    if panjang < 2 {
        return Err(format!("Nama {jenis} minimal 2 karakter."));
    }
    if panjang > NAMA_MAKS {
        return Err(format!("Nama {jenis} maksimal {NAMA_MAKS} karakter."));
    }
    Ok(nama)
}

/// Id `hr_bagian_nama`: dua perangkat yang mencatat nama yang sama untuk satu
/// bagian menghasilkan satu baris. Sama dengan bentuk SQL migrasi
/// (`lower(hex(lower(nama)))`, `lower` SQLite hanya ASCII).
pub fn id_nama_bagian(id_bagian: &str, nama: &str) -> String {
    format!("{id_bagian}:{}", hex::encode(nama.to_ascii_lowercase().as_bytes()))
}

/// Atasan ?id_atasan untuk ?id_karyawan: bukan dirinya, tanpa siklus.
/// `atasan` = peta pegawai → atasannya sekarang. Keberadaan dan "bukan
/// siswa" diperiksa pemanggil.
pub fn periksa_atasan(
    id_karyawan: &str,
    id_atasan: &str,
    atasan: &HashMap<String, String>,
) -> Result<(), String> {
    if id_atasan.is_empty() {
        return Ok(());
    }
    if id_atasan == id_karyawan {
        return Err("Atasan tidak boleh dirinya sendiri.".to_owned());
    }
    let mut dilalui = BTreeSet::new();
    let mut kini = id_atasan.to_owned();
    while let Some(berikut) = atasan.get(&kini).filter(|id| !id.is_empty()) {
        if berikut == id_karyawan {
            return Err("Atasan ini membuat rantai atasan yang berputar.".to_owned());
        }
        if !dilalui.insert(kini.clone()) {
            break;
        }
        kini = berikut.clone();
    }
    Ok(())
}

/// Pegawai yang berada di dalam siklus atasan (dua perangkat luring), terurut.
pub fn dalam_siklus_atasan(atasan: &HashMap<String, String>) -> Vec<String> {
    let mut hasil = BTreeSet::new();
    for awal in atasan.keys() {
        let mut dilalui = BTreeSet::new();
        let mut kini = awal.clone();
        while let Some(berikut) = atasan.get(&kini).filter(|id| !id.is_empty()) {
            if berikut == awal {
                hasil.insert(awal.clone());
                break;
            }
            if !dilalui.insert(kini.clone()) {
                break;
            }
            kini = berikut.clone();
        }
    }
    hasil.into_iter().collect()
}

#[derive(Debug, Deserialize)]
pub struct PegawaiOrg {
    pub id_unik: String,
    pub divisi: String,
    pub id_bagian: String,
    pub id_jabatan: String,
    pub id_atasan: String,
}

#[derive(Debug, Deserialize)]
pub struct MasterOrg {
    pub id: String,
    pub nama: String,
    pub is_aktif: i64,
}

#[derive(Debug, Deserialize)]
pub struct NamaLama {
    pub id_bagian: String,
    pub nama: String,
}

/// Turunan halaman Organisasi: jumlah anggota, nama lama, tanda nama ganda
/// (dua master AKTIF berkunci sama), siklus atasan, dan teks divisi pegawai
/// tanpa master yang tidak cocok nama mana pun.
pub fn susun_org(
    pegawai: &[PegawaiOrg],
    bagian: &[MasterOrg],
    nama_lama: &[NamaLama],
    jabatan: &[MasterOrg],
) -> Value {
    let ganda = |daftar: &[MasterOrg]| {
        let mut hitung: HashMap<String, usize> = HashMap::new();
        for m in daftar.iter().filter(|m| m.is_aktif == 1) {
            *hitung.entry(kunci_nama(&m.nama)).or_default() += 1;
        }
        hitung
    };
    let ganda_bagian = ganda(bagian);
    let ganda_jabatan = ganda(jabatan);
    let anggota = |id: &str, pilih: fn(&PegawaiOrg) -> &str| {
        pegawai.iter().filter(|p| pilih(p) == id).count()
    };
    let bagian_json: Vec<Value> = bagian
        .iter()
        .map(|b| {
            let lama: Vec<&str> = nama_lama
                .iter()
                .filter(|n| n.id_bagian == b.id && kunci_nama(&n.nama) != kunci_nama(&b.nama))
                .map(|n| n.nama.as_str())
                .collect();
            json!({
                "id_bagian": b.id,
                "nama": b.nama,
                "is_aktif": b.is_aktif,
                "anggota": anggota(&b.id, |p| p.id_bagian.as_str()),
                "nama_lama": lama,
                "nama_ganda": b.is_aktif == 1 && ganda_bagian.get(&kunci_nama(&b.nama)).copied().unwrap_or(0) > 1,
            })
        })
        .collect();
    let jabatan_json: Vec<Value> = jabatan
        .iter()
        .map(|j| {
            json!({
                "id_jabatan": j.id,
                "nama": j.nama,
                "is_aktif": j.is_aktif,
                "anggota": anggota(&j.id, |p| p.id_jabatan.as_str()),
                "nama_ganda": j.is_aktif == 1 && ganda_jabatan.get(&kunci_nama(&j.nama)).copied().unwrap_or(0) > 1,
            })
        })
        .collect();
    let dikenal: BTreeSet<String> = nama_lama
        .iter()
        .map(|n| kunci_nama(&n.nama))
        .chain(bagian.iter().map(|b| kunci_nama(&b.nama)))
        .collect();
    let mut tanpa: BTreeMap<String, (String, usize)> = BTreeMap::new();
    for p in pegawai.iter().filter(|p| p.id_bagian.is_empty()) {
        let kunci = kunci_nama(&p.divisi);
        if kunci.is_empty() || dikenal.contains(&kunci) {
            continue;
        }
        let entri = tanpa
            .entry(kunci)
            .or_insert_with(|| (normalisasi_nama(&p.divisi), 0));
        entri.1 += 1;
    }
    let atasan: HashMap<String, String> = pegawai
        .iter()
        .map(|p| (p.id_unik.clone(), p.id_atasan.clone()))
        .collect();
    json!({
        "bagian": bagian_json,
        "jabatan": jabatan_json,
        "tanpa_master": tanpa
            .into_values()
            .map(|(divisi, jumlah)| json!({ "divisi": divisi, "jumlah": jumlah }))
            .collect::<Vec<_>>(),
        "atasan_siklus": dalam_siklus_atasan(&atasan),
    })
}

// Fase 1b: kontrak dan status kepegawaian (§19.2.4)

/// K-1, Q-24. Cermin `STATUS_KONTRAK` di `validations/hris.ts` dan CHECK
/// `hr_kontrak.status`.
pub const STATUS_KONTRAK: [&str; 7] = ["GTY", "PTY", "GTT", "PTT", "Honorer", "PNS", "PPPK"];
pub const STATUS_PEMBATALAN: &str = "Pembatalan";
pub const NOMOR_MAKS: usize = 80;
pub const CATATAN_MAKS: usize = 500;

/// Angka hukum kontrak sebagai pengaturan sekolah (Q-28); kosong = bawaan.
pub const KUNCI_PERCOBAAN_MAKS: &str = "hr_percobaan_maks_bulan";
pub const KUNCI_PKWT_MAKS: &str = "hr_pkwt_maks_bulan";
/// Batas beban mengajar per minggu (HRIS Fase 3a, §21.2.1); kosong = bawaan.
pub const KUNCI_BEBAN_MIN_JP: &str = "hr_beban_min_jp";
pub const KUNCI_BEBAN_MAKS_JP: &str = "hr_beban_maks_jp";

#[derive(Debug, Clone, Copy)]
pub struct Aturan {
    pub bawaan: i64,
    pub min: i64,
    pub maks: i64,
    pub satuan: &'static str,
}

pub const ATURAN_PERCOBAAN: Aturan = Aturan { bawaan: 3, min: 1, maks: 12, satuan: "bulan" };
pub const ATURAN_PKWT: Aturan = Aturan { bawaan: 60, min: 12, maks: 120, satuan: "bulan" };
pub const ATURAN_BEBAN_MIN: Aturan = Aturan { bawaan: 24, min: 0, maks: 60, satuan: "JP" };
pub const ATURAN_BEBAN_MAKS: Aturan = Aturan { bawaan: 40, min: 1, maks: 60, satuan: "JP" };

/// Status kepegawaian per pegawai pada ?1 (Q-25): kontrak tidak dibatalkan
/// terakhir yang sudah mulai, lalu `guru_data`, lalu kosong.
pub const STATUS_KINI_SQL: &str = "SELECT m.id_unik, COALESCE((SELECT k.status FROM hr_kontrak k WHERE k.id_karyawan = m.id_unik AND k.status <> 'Pembatalan' AND k.tanggal_mulai <= ?1 AND NOT EXISTS (SELECT 1 FROM hr_kontrak b WHERE b.status = 'Pembatalan' AND b.id_ref = k.id_kontrak) ORDER BY k.tanggal_mulai DESC, k.id_kontrak DESC LIMIT 1), g.status_kepegawaian, '') AS status FROM master_data m LEFT JOIN guru_data g ON g.id_guru = m.id_unik WHERE LOWER(TRIM(COALESCE(m.jenis_personil, ''))) <> 'siswa' AND NOT EXISTS (SELECT 1 FROM siswa_data sd WHERE sd.id_siswa = m.id_unik)\n-- batas: pegawai sekolah (guru dan tendik), dibatasi jumlah personil lembaga\n;";
/// Cermin status kontrak terakhir ke `guru_data` (tanggal 9999-12-31). Tanpa
/// kontrak sah tersisa, `guru_data` tidak diubah. ?1 = id pegawai.
pub const CERMIN_STATUS_SQL: &str = "UPDATE guru_data SET status_kepegawaian = (SELECT k.status FROM hr_kontrak k WHERE k.id_karyawan = ?1 AND k.status <> 'Pembatalan' AND NOT EXISTS (SELECT 1 FROM hr_kontrak b WHERE b.status = 'Pembatalan' AND b.id_ref = k.id_kontrak) ORDER BY k.tanggal_mulai DESC, k.id_kontrak DESC LIMIT 1) WHERE id_guru = ?1 AND EXISTS (SELECT 1 FROM hr_kontrak k WHERE k.id_karyawan = ?1 AND k.status <> 'Pembatalan' AND NOT EXISTS (SELECT 1 FROM hr_kontrak b WHERE b.status = 'Pembatalan' AND b.id_ref = k.id_kontrak)) AND status_kepegawaian IS NOT (SELECT k.status FROM hr_kontrak k WHERE k.id_karyawan = ?1 AND k.status <> 'Pembatalan' AND NOT EXISTS (SELECT 1 FROM hr_kontrak b WHERE b.status = 'Pembatalan' AND b.id_ref = k.id_kontrak) ORDER BY k.tanggal_mulai DESC, k.id_kontrak DESC LIMIT 1);";
/// Guru (alias `g`) yang punya kontrak sah: isian status di form terkunci.
pub const BERKONTRAK_SQL: &str = "EXISTS (SELECT 1 FROM hr_kontrak k WHERE k.id_karyawan = g.id_guru AND k.status <> 'Pembatalan' AND NOT EXISTS (SELECT 1 FROM hr_kontrak b WHERE b.status = 'Pembatalan' AND b.id_ref = k.id_kontrak))";
/// ?1 id, ?2 pegawai, ?3 status, ?4 id_ref, ?5 nomor, ?6 mulai, ?7 selesai,
/// ?8 percobaan, ?9 catatan, ?10 pencatat.
pub const SIMPAN_KONTRAK_SQL: &str = "INSERT OR IGNORE INTO hr_kontrak (id_kontrak, id_karyawan, status, id_ref, nomor, tanggal_mulai, tanggal_selesai, percobaan_selesai, catatan, dicatat_oleh, created_at) VALUES (?1, ?2, ?3, NULLIF(?4, ''), NULLIF(?5, ''), ?6, NULLIF(?7, ''), NULLIF(?8, ''), NULLIF(?9, ''), NULLIF(?10, ''), datetime('now'));";
pub const KONTRAK_SQL: &str = "SELECT id_kontrak, id_karyawan, status, COALESCE(id_ref, '') AS id_ref, COALESCE(nomor, '') AS nomor, tanggal_mulai, COALESCE(tanggal_selesai, '') AS tanggal_selesai, COALESCE(percobaan_selesai, '') AS percobaan_selesai, COALESCE(catatan, '') AS catatan, COALESCE(dicatat_oleh, '') AS dicatat_oleh, created_at FROM hr_kontrak ORDER BY id_karyawan, tanggal_mulai, id_kontrak\n-- batas: kontrak pegawai sekolah, beberapa baris per orang sepanjang masa kerja\n;";
pub const PENGATURAN_KONTRAK_SQL: &str = "SELECT key, value FROM setting_gex_system WHERE key IN ('hr_percobaan_maks_bulan', 'hr_pkwt_maks_bulan', 'hr_beban_min_jp', 'hr_beban_maks_jp')\n-- batas: empat kunci pengaturan\n;";
pub const HARI_INI_SQL: &str = "SELECT date('now', '+7 hours') AS hari_ini;";

// Fase 1b: tugas tambahan (§19.2.2)

/// Satu-satunya id jenis yang dikenal kode: wali kelas dibaca dari rombel.
pub const ID_WALI_KELAS: &str = "tgs-wali-kelas";
pub const EKUIVALEN_MAKS: i64 = 40;

/// ?1 id, ?2 nama, ?3 ekuivalen JP, ?4 aktif.
pub const SIMPAN_JENIS_TUGAS_SQL: &str = "INSERT INTO hr_tugas_jenis (id_jenis, nama, ekuivalen_jp, is_aktif, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, datetime('now'), datetime('now')) ON CONFLICT(id_jenis) DO UPDATE SET nama = excluded.nama, ekuivalen_jp = excluded.ekuivalen_jp, is_aktif = excluded.is_aktif, updated_at = excluded.updated_at;";
pub const BENTROK_JENIS_TUGAS_SQL: &str = "SELECT 1 FROM hr_tugas_jenis WHERE id_jenis <> ?2 AND is_aktif = 1 AND lower(trim(nama)) = lower(trim(?1)) LIMIT 1;";
pub const JENIS_TUGAS_SQL: &str = "SELECT id_jenis, nama, ekuivalen_jp, is_aktif FROM hr_tugas_jenis ORDER BY nama, id_jenis\n-- batas: jenis tugas tambahan sekolah, tidak tumbuh per hari\n;";
/// Upsert penuh; baris yang sudah dibatalkan tidak berubah lagi. Urutan
/// parameter di `SIMPAN_TUGAS_SQL` (TS).
pub const SIMPAN_TUGAS_SQL: &str = "INSERT INTO hr_tugas_tambahan (id_tugas, id_karyawan, id_jenis, unit, tahun_ajaran, id_rombel, nomor_sk, tanggal_sk, ekuivalen_jp, tanggal_mulai, tanggal_selesai, dicatat_oleh, created_at, updated_at) VALUES (?1, ?2, ?3, NULLIF(?4, ''), ?5, NULLIF(?6, ''), NULLIF(?7, ''), NULLIF(?8, ''), ?9, ?10, NULLIF(?11, ''), NULLIF(?12, ''), datetime('now'), datetime('now')) ON CONFLICT(id_tugas) DO UPDATE SET id_karyawan = excluded.id_karyawan, id_jenis = excluded.id_jenis, unit = excluded.unit, tahun_ajaran = excluded.tahun_ajaran, id_rombel = excluded.id_rombel, nomor_sk = excluded.nomor_sk, tanggal_sk = excluded.tanggal_sk, ekuivalen_jp = excluded.ekuivalen_jp, tanggal_mulai = excluded.tanggal_mulai, tanggal_selesai = excluded.tanggal_selesai, updated_at = excluded.updated_at WHERE hr_tugas_tambahan.dibatalkan_pada IS NULL;";
/// ?1 id, ?2 pembatal, ?3 alasan; hanya bila belum dibatalkan.
pub const BATAL_TUGAS_SQL: &str = "UPDATE hr_tugas_tambahan SET dibatalkan_pada = datetime('now'), dibatalkan_oleh = ?2, alasan_batal = ?3, updated_at = datetime('now') WHERE id_tugas = ?1 AND dibatalkan_pada IS NULL;";
/// Jenis tugas yang dipegang tiap pegawai pada [?1, ?2] (Q-29); wali kelas
/// dari rombel aktif yang semesternya beririsan.
pub const TUGAS_BERLAKU_SQL: &str = "SELECT t.id_karyawan, t.id_jenis FROM hr_tugas_tambahan t WHERE t.dibatalkan_pada IS NULL AND t.id_jenis <> 'tgs-wali-kelas' AND t.tanggal_mulai <= ?2 AND (COALESCE(t.tanggal_selesai, '') = '' OR t.tanggal_selesai >= ?1) UNION SELECT r.id_wali_kelas, 'tgs-wali-kelas' FROM akademik_rombel r JOIN akademik_tahun_ajaran ta ON ta.id_tahun_ajaran = r.id_tahun_ajaran WHERE r.is_aktif = 1 AND COALESCE(r.id_wali_kelas, '') <> '' AND ta.tanggal_mulai <= ?2 AND ta.tanggal_selesai >= ?1 ORDER BY 1, 2\n-- batas: tugas tambahan pegawai sekolah pada satu periode gaji\n;";
pub const TUGAS_SQL: &str = "SELECT id_tugas, id_karyawan, id_jenis, COALESCE(unit, '') AS unit, tahun_ajaran, COALESCE(id_rombel, '') AS id_rombel, COALESCE(nomor_sk, '') AS nomor_sk, COALESCE(tanggal_sk, '') AS tanggal_sk, ekuivalen_jp, tanggal_mulai, COALESCE(tanggal_selesai, '') AS tanggal_selesai, COALESCE(dicatat_oleh, '') AS dicatat_oleh, COALESCE(dibatalkan_pada, '') AS dibatalkan_pada, COALESCE(dibatalkan_oleh, '') AS dibatalkan_oleh, COALESCE(alasan_batal, '') AS alasan_batal FROM hr_tugas_tambahan ORDER BY tahun_ajaran DESC, tanggal_mulai, id_tugas\n-- batas: tugas tambahan sekolah, beberapa per pegawai per tahun ajaran\n;";
pub const WALI_KELAS_SQL: &str = "SELECT r.id_rombel, r.nama_rombel, r.id_wali_kelas, ta.nama_tahun, ta.semester, ta.tanggal_mulai, ta.tanggal_selesai FROM akademik_rombel r JOIN akademik_tahun_ajaran ta ON ta.id_tahun_ajaran = r.id_tahun_ajaran WHERE r.is_aktif = 1 AND COALESCE(r.id_wali_kelas, '') <> '' ORDER BY ta.nama_tahun DESC, ta.semester, r.nama_rombel, r.id_rombel\n-- batas: rombel aktif sekolah, satu wali per rombel\n;";
pub const TAHUN_AJARAN_SQL: &str = "SELECT nama_tahun, MIN(tanggal_mulai) AS tanggal_mulai, MAX(tanggal_selesai) AS tanggal_selesai FROM akademik_tahun_ajaran GROUP BY nama_tahun ORDER BY nama_tahun DESC\n-- batas: tahun ajaran sekolah, satu per tahun\n;";

fn panjang(teks: &str) -> usize {
    teks.chars().count()
}

/// Isian kontrak (form, payload outbox); kosong = tidak diisi.
#[derive(Debug, Clone, Default, Deserialize, serde::Serialize, PartialEq)]
pub struct KontrakIsian {
    #[serde(default)]
    pub status: String,
    #[serde(default)]
    pub nomor: String,
    #[serde(default)]
    pub tanggal_mulai: String,
    #[serde(default)]
    pub tanggal_selesai: String,
    #[serde(default)]
    pub percobaan_selesai: String,
    #[serde(default)]
    pub catatan: String,
}

/// Kelengkapan kontrak, bukan angka hukum. Cermin `validasiKontrak`.
pub fn validasi_kontrak(isian: &KontrakIsian, guru: bool) -> Result<KontrakIsian, String> {
    let k = KontrakIsian {
        status: isian.status.trim().to_owned(),
        nomor: isian.nomor.trim().to_owned(),
        tanggal_mulai: isian.tanggal_mulai.trim().to_owned(),
        tanggal_selesai: isian.tanggal_selesai.trim().to_owned(),
        percobaan_selesai: isian.percobaan_selesai.trim().to_owned(),
        catatan: isian.catatan.trim().to_owned(),
    };
    let salah = |galat: &str| Err(galat.to_owned());
    let status = k.status.as_str();
    if !STATUS_KONTRAK.contains(&status) {
        return salah("Status kontrak tidak dikenal.");
    }
    if !tanggal_valid(&k.tanggal_mulai) {
        return salah("Tanggal mulai kontrak tidak valid.");
    }
    if !k.tanggal_selesai.is_empty() && !tanggal_valid(&k.tanggal_selesai) {
        return salah("Tanggal selesai kontrak tidak valid.");
    }
    if !k.percobaan_selesai.is_empty() && !tanggal_valid(&k.percobaan_selesai) {
        return salah("Tanggal akhir masa percobaan tidak valid.");
    }
    if matches!(status, "GTY" | "GTT") && !guru {
        return salah("Status GTY dan GTT hanya untuk guru.");
    }
    if matches!(status, "PTY" | "PTT") && guru {
        return salah("Status PTY dan PTT hanya untuk tenaga kependidikan.");
    }
    if matches!(status, "GTT" | "PTT") && k.tanggal_selesai.is_empty() {
        return salah("Kontrak GTT dan PTT wajib punya tanggal selesai.");
    }
    if !k.tanggal_selesai.is_empty() && k.tanggal_selesai < k.tanggal_mulai {
        return salah("Tanggal selesai tidak boleh sebelum tanggal mulai.");
    }
    if !k.percobaan_selesai.is_empty() {
        if !matches!(status, "GTY" | "PTY") {
            return salah("Masa percobaan hanya untuk GTY dan PTY.");
        }
        if k.percobaan_selesai < k.tanggal_mulai {
            return salah("Akhir masa percobaan tidak boleh sebelum tanggal mulai.");
        }
        if !k.tanggal_selesai.is_empty() && k.percobaan_selesai > k.tanggal_selesai {
            return salah("Akhir masa percobaan melewati tanggal selesai kontrak.");
        }
    }
    if panjang(&k.nomor) > NOMOR_MAKS {
        return Err(format!("Nomor SK/kontrak maksimal {NOMOR_MAKS} karakter."));
    }
    if panjang(&k.catatan) > CATATAN_MAKS {
        return Err(format!("Catatan maksimal {CATATAN_MAKS} karakter."));
    }
    Ok(k)
}

/// Alasan pembatalan kontrak atau tugas.
pub fn validasi_alasan(alasan: &str) -> Result<String, String> {
    let teks = alasan.trim();
    if teks.is_empty() {
        return Err("Alasan pembatalan wajib diisi.".to_owned());
    }
    if panjang(teks) > CATATAN_MAKS {
        return Err(format!("Alasan maksimal {CATATAN_MAKS} karakter."));
    }
    Ok(teks.to_owned())
}

fn hari_dalam_bulan(tahun: i64, bulan: i64) -> i64 {
    match bulan {
        2 if (tahun % 4 == 0 && tahun % 100 != 0) || tahun % 400 == 0 => 29,
        2 => 28,
        4 | 6 | 9 | 11 => 30,
        _ => 31,
    }
}

/// Tanggal + n bulan; tanggal di luar bulan tujuan menjadi akhir bulan.
pub fn tambah_bulan(tanggal: &str, bulan: i64) -> Option<String> {
    if !tanggal_valid(tanggal) {
        return None;
    }
    let mut bagian = tanggal.split('-').map(|b| b.parse::<i64>().ok());
    let (y, m, d) = (bagian.next()??, bagian.next()??, bagian.next()??);
    let total = y * 12 + (m - 1) + bulan;
    let (ty, tm) = (total.div_euclid(12), total.rem_euclid(12) + 1);
    let td = d.min(hari_dalam_bulan(ty, tm));
    Some(format!("{ty:04}-{tm:02}-{td:02}"))
}

/// Baris `hr_kontrak` (`KONTRAK_SQL`); kolom kosong = `""`.
#[derive(Debug, Clone, Default, Deserialize, serde::Serialize)]
pub struct KontrakBaris {
    pub id_kontrak: String,
    pub id_karyawan: String,
    pub status: String,
    #[serde(default)]
    pub id_ref: String,
    #[serde(default)]
    pub nomor: String,
    pub tanggal_mulai: String,
    #[serde(default)]
    pub tanggal_selesai: String,
    #[serde(default)]
    pub percobaan_selesai: String,
    #[serde(default)]
    pub catatan: String,
    #[serde(default)]
    pub dicatat_oleh: String,
    #[serde(default)]
    pub created_at: String,
}

/// Kontrak tidak dibatalkan, urut (tanggal mulai, id) seperti `STATUS_KINI_SQL`.
pub fn kontrak_sah(kontrak: &[KontrakBaris]) -> Vec<&KontrakBaris> {
    let batal: BTreeSet<&str> = kontrak
        .iter()
        .filter(|k| k.status == STATUS_PEMBATALAN)
        .map(|k| k.id_ref.as_str())
        .collect();
    let mut sah: Vec<&KontrakBaris> = kontrak
        .iter()
        .filter(|k| k.status != STATUS_PEMBATALAN && !batal.contains(k.id_kontrak.as_str()))
        .collect();
    sah.sort_by(|a, b| {
        a.tanggal_mulai
            .cmp(&b.tanggal_mulai)
            .then_with(|| a.id_kontrak.cmp(&b.id_kontrak))
    });
    sah
}

/// Keadaan kontrak satu orang pada `tanggal`; cermin `statusKerja`.
pub fn status_kerja(kontrak: &[KontrakBaris], tanggal: &str) -> Value {
    let sah = kontrak_sah(kontrak);
    let bentuk = |keadaan: &str, k: Option<&KontrakBaris>, percobaan: &str| {
        json!({
            "keadaan": keadaan,
            "status": k.map(|k| k.status.as_str()).unwrap_or(""),
            "id_kontrak": k.map(|k| k.id_kontrak.as_str()).unwrap_or(""),
            "sampai": k.map(|k| k.tanggal_selesai.as_str()).unwrap_or(""),
            "percobaan_sampai": percobaan,
        })
    };
    let Some(k) = sah.iter().rev().find(|k| k.tanggal_mulai.as_str() <= tanggal) else {
        return match sah.first() {
            Some(nanti) => bentuk("Akan berlaku", Some(nanti), &nanti.percobaan_selesai),
            None => bentuk("Tanpa kontrak", None, ""),
        };
    };
    let keadaan = if !k.tanggal_selesai.is_empty() && k.tanggal_selesai.as_str() < tanggal {
        "Berakhir"
    } else {
        "Berlaku"
    };
    let percobaan = if !k.percobaan_selesai.is_empty() && k.percobaan_selesai.as_str() >= tanggal {
        k.percobaan_selesai.as_str()
    } else {
        ""
    };
    bentuk(keadaan, Some(k), percobaan)
}

#[derive(Debug, Clone, Copy, Deserialize)]
pub struct AturanKontrak {
    pub percobaan_maks_bulan: i64,
    pub pkwt_maks_bulan: i64,
}

/// Tanda, bukan penolakan (Q-28); cermin `tandaKontrak`.
pub fn tanda_kontrak(kontrak: &[KontrakBaris], aturan: AturanKontrak) -> Vec<&'static str> {
    let sah = kontrak_sah(kontrak);
    let mut tanda = Vec::new();
    let percobaan_lewat = sah.iter().any(|k| {
        !k.percobaan_selesai.is_empty()
            && tambah_bulan(&k.tanggal_mulai, aturan.percobaan_maks_bulan)
                .is_some_and(|batas| k.percobaan_selesai > batas)
    });
    if percobaan_lewat {
        tanda.push("percobaan_lewat");
    }
    let mut awal = sah.len();
    while awal > 0 && matches!(sah[awal - 1].status.as_str(), "GTT" | "PTT") {
        awal -= 1;
    }
    let rangkaian = &sah[awal..];
    if let Some(pertama) = rangkaian.first() {
        let akhir = rangkaian
            .iter()
            .map(|k| k.tanggal_selesai.as_str())
            .max()
            .unwrap_or("");
        if tambah_bulan(&pertama.tanggal_mulai, aturan.pkwt_maks_bulan)
            .is_some_and(|batas| akhir > batas.as_str())
        {
            tanda.push("pkwt_lewat");
        }
    }
    tanda
}

/// Ringkasan tab Kontrak per pegawai (urut id); cermin `susunKontrak`.
pub fn susun_kontrak(kontrak: &[KontrakBaris], hari_ini: &str, aturan: AturanKontrak) -> Value {
    let mut per: BTreeMap<&str, Vec<KontrakBaris>> = BTreeMap::new();
    for k in kontrak {
        per.entry(k.id_karyawan.as_str()).or_default().push(k.clone());
    }
    let ringkas: Vec<Value> = per
        .iter()
        .map(|(id, daftar)| {
            let mut baris = status_kerja(daftar, hari_ini);
            baris["id_karyawan"] = json!(id);
            baris["tanda"] = json!(tanda_kontrak(daftar, aturan));
            baris
        })
        .collect();
    let dibatalkan: BTreeSet<&str> = kontrak
        .iter()
        .filter(|k| k.status == STATUS_PEMBATALAN && !k.id_ref.is_empty())
        .map(|k| k.id_ref.as_str())
        .collect();
    json!({ "ringkas": ringkas, "dibatalkan": dibatalkan })
}

fn angka_pendek(teks: &str) -> Option<i64> {
    if (1..=4).contains(&teks.len()) && teks.bytes().all(|b| b.is_ascii_digit()) {
        teks.parse().ok()
    } else {
        None
    }
}

/// Nilai kunci angka kontrak; kosong, rusak, atau di luar rentang = bawaan.
pub fn angka_pengaturan(nilai: Option<&str>, aturan: Aturan) -> i64 {
    angka_pendek(nilai.unwrap_or("").trim())
        .filter(|n| (aturan.min..=aturan.maks).contains(n))
        .unwrap_or(aturan.bawaan)
}

/// Isian pengaturan dari layar; `""` = kembali ke bawaan.
pub fn validasi_angka_pengaturan(teks: &str, aturan: Aturan, label: &str) -> Result<String, String> {
    let isi = teks.trim();
    if isi.is_empty() {
        return Ok(String::new());
    }
    match angka_pendek(isi).filter(|n| (aturan.min..=aturan.maks).contains(n)) {
        Some(n) => Ok(n.to_string()),
        None => Err(format!(
            "{label} harus {} sampai {} {}, atau kosong untuk bawaan {}.",
            aturan.min, aturan.maks, aturan.satuan, aturan.bawaan
        )),
    }
}

/// Batas JP berlaku (min, maks); maks yang kurang dari min (dua perangkat
/// menyimpan berbeda) dinaikkan ke min. Cermin `batasBeban`.
pub fn batas_beban(min: Option<&str>, maks: Option<&str>) -> (i64, i64) {
    let min = angka_pengaturan(min, ATURAN_BEBAN_MIN);
    (min, angka_pengaturan(maks, ATURAN_BEBAN_MAKS).max(min))
}

/// Isian batas JP dari layar; cermin `validasiBatasBeban`.
pub fn validasi_batas_beban(min: &str, maks: &str) -> Result<(String, String), String> {
    let min = validasi_angka_pengaturan(min, ATURAN_BEBAN_MIN, "Batas minimal beban mengajar")?;
    let maks = validasi_angka_pengaturan(maks, ATURAN_BEBAN_MAKS, "Batas maksimal beban mengajar")?;
    let berlaku_min = angka_pengaturan(Some(&min), ATURAN_BEBAN_MIN);
    if angka_pengaturan(Some(&maks), ATURAN_BEBAN_MAKS) < berlaku_min {
        return Err(format!(
            "Batas maksimal beban mengajar tidak boleh kurang dari batas minimal ({berlaku_min} JP)."
        ));
    }
    Ok((min, maks))
}

/// Isian tugas tambahan; kosong = tidak diisi.
#[derive(Debug, Clone, Default, Deserialize, serde::Serialize, PartialEq)]
pub struct TugasIsian {
    #[serde(default)]
    pub id_karyawan: String,
    #[serde(default)]
    pub id_jenis: String,
    #[serde(default)]
    pub unit: String,
    #[serde(default)]
    pub tahun_ajaran: String,
    #[serde(default)]
    pub id_rombel: String,
    #[serde(default)]
    pub nomor_sk: String,
    #[serde(default)]
    pub tanggal_sk: String,
    #[serde(default)]
    pub ekuivalen_jp: Option<i64>,
    #[serde(default)]
    pub tanggal_mulai: String,
    #[serde(default)]
    pub tanggal_selesai: String,
}

fn ekuivalen_sah(n: i64) -> bool {
    (0..=EKUIVALEN_MAKS).contains(&n)
}

/// Kelengkapan tugas tambahan; cermin `validasiTugas`.
pub fn validasi_tugas(isian: &TugasIsian) -> Result<TugasIsian, String> {
    let mut t = TugasIsian {
        id_karyawan: isian.id_karyawan.trim().to_owned(),
        id_jenis: isian.id_jenis.trim().to_owned(),
        unit: normalisasi_nama(&isian.unit),
        tahun_ajaran: isian.tahun_ajaran.trim().to_owned(),
        id_rombel: isian.id_rombel.trim().to_owned(),
        nomor_sk: isian.nomor_sk.trim().to_owned(),
        tanggal_sk: isian.tanggal_sk.trim().to_owned(),
        ekuivalen_jp: isian.ekuivalen_jp,
        tanggal_mulai: isian.tanggal_mulai.trim().to_owned(),
        tanggal_selesai: isian.tanggal_selesai.trim().to_owned(),
    };
    let salah = |galat: &str| Err(galat.to_owned());
    if t.id_karyawan.is_empty() {
        return salah("Pilih pegawai.");
    }
    if t.id_jenis.is_empty() {
        return salah("Pilih jenis tugas.");
    }
    if t.tahun_ajaran.is_empty() {
        return salah("Tahun ajaran wajib dipilih.");
    }
    if panjang(&t.tahun_ajaran) > 20 {
        return salah("Tahun ajaran tidak valid.");
    }
    if !tanggal_valid(&t.tanggal_mulai) {
        return salah("Tanggal mulai tugas tidak valid.");
    }
    if !t.tanggal_selesai.is_empty() && !tanggal_valid(&t.tanggal_selesai) {
        return salah("Tanggal selesai tugas tidak valid.");
    }
    if !t.tanggal_selesai.is_empty() && t.tanggal_selesai < t.tanggal_mulai {
        return salah("Tanggal selesai tidak boleh sebelum tanggal mulai.");
    }
    if !t.tanggal_sk.is_empty() && !tanggal_valid(&t.tanggal_sk) {
        return salah("Tanggal SK tidak valid.");
    }
    if t.ekuivalen_jp.is_some_and(|n| !ekuivalen_sah(n)) {
        return Err(format!("Ekuivalen JP harus 0 sampai {EKUIVALEN_MAKS}."));
    }
    if panjang(&t.nomor_sk) > NOMOR_MAKS {
        return Err(format!("Nomor SK maksimal {NOMOR_MAKS} karakter."));
    }
    if panjang(&t.unit) > NOMOR_MAKS {
        return Err(format!("Unit maksimal {NOMOR_MAKS} karakter."));
    }
    if t.id_jenis == ID_WALI_KELAS {
        if t.id_rombel.is_empty() {
            return salah("Tugas wali kelas wajib memilih rombel.");
        }
    } else {
        t.id_rombel.clear();
    }
    Ok(t)
}

/// Jenis tugas dari layar Organisasi; mengembalikan nama ternormalkan.
pub fn validasi_jenis_tugas(nama: &str, ekuivalen_jp: i64) -> Result<String, String> {
    let nama = validasi_nama_master(nama, "jenis tugas")?;
    if !ekuivalen_sah(ekuivalen_jp) {
        return Err(format!("Ekuivalen JP harus 0 sampai {EKUIVALEN_MAKS}."));
    }
    Ok(nama)
}

/// Status tugas diturunkan, tidak disimpan; cermin `statusTugas`.
pub fn status_tugas(tanggal_mulai: &str, tanggal_selesai: &str, dibatalkan_pada: &str, hari_ini: &str) -> &'static str {
    if !dibatalkan_pada.is_empty() {
        "Dibatalkan"
    } else if !tanggal_selesai.is_empty() && tanggal_selesai < hari_ini {
        "Selesai"
    } else if tanggal_mulai > hari_ini {
        "Akan berlaku"
    } else {
        "Berlaku"
    }
}

// Handler cloud (statement murni, tanpa membaca)

fn teks(row: &Value, kunci: &str) -> String {
    row.get(kunci)
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim()
        .to_owned()
}

fn aktif(row: &Value) -> i64 {
    match row.get("is_aktif") {
        Some(Value::Bool(false)) => 0,
        Some(v) if v.as_i64() == Some(0) => 0,
        _ => 1,
    }
}

/// `hr-section/save`: upsert, catat nama, tulis ulang anggota. Payload
/// cacat = tidak ada statement (cloud tidak menolak karena master).
pub fn cloud_bagian_statements(payload: &Value, entity_key: &str) -> Vec<(String, Vec<Value>)> {
    let id = Some(teks(payload, "id_bagian"))
        .filter(|id| !id.is_empty())
        .unwrap_or_else(|| entity_key.trim().to_owned());
    let nama = normalisasi_nama(&teks(payload, "nama"));
    if id.is_empty() || nama.is_empty() {
        return Vec::new();
    }
    let mut hasil = vec![
        (SIMPAN_BAGIAN_SQL.to_owned(), vec![json!(id), json!(nama), json!(aktif(payload))]),
        (
            CATAT_NAMA_BAGIAN_SQL.to_owned(),
            vec![json!(id_nama_bagian(&id, &nama)), json!(id), json!(nama)],
        ),
    ];
    hasil.extend(
        TULIS_ULANG_BAGIAN_SQL
            .iter()
            .map(|sql| ((*sql).to_owned(), vec![json!(id)])),
    );
    hasil
}

/// `hr-section/merge`: `{ id_asal, id_tujuan }`.
pub fn cloud_gabung_statements(payload: &Value) -> Vec<(String, Vec<Value>)> {
    let asal = teks(payload, "id_asal");
    let tujuan = teks(payload, "id_tujuan");
    if asal.is_empty() || tujuan.is_empty() || asal == tujuan {
        return Vec::new();
    }
    let mut hasil: Vec<(String, Vec<Value>)> = GABUNG_BAGIAN_SQL
        .iter()
        .map(|sql| ((*sql).to_owned(), vec![json!(asal), json!(tujuan)]))
        .collect();
    hasil.extend(
        TULIS_ULANG_BAGIAN_SQL
            .iter()
            .map(|sql| ((*sql).to_owned(), vec![json!(tujuan)])),
    );
    hasil
}

/// `hr-position/save`.
pub fn cloud_jabatan_statements(payload: &Value, entity_key: &str) -> Vec<(String, Vec<Value>)> {
    let id = Some(teks(payload, "id_jabatan"))
        .filter(|id| !id.is_empty())
        .unwrap_or_else(|| entity_key.trim().to_owned());
    let nama = normalisasi_nama(&teks(payload, "nama"));
    if id.is_empty() || nama.is_empty() {
        return Vec::new();
    }
    vec![
        (SIMPAN_JABATAN_SQL.to_owned(), vec![json!(id), json!(nama), json!(aktif(payload))]),
        (TULIS_ULANG_JABATAN_SQL.to_owned(), vec![json!(id)]),
    ]
}

/// `hr-contract/create` (kontrak dan pembatalan): insert append-only lalu
/// cermin status guru. Status di luar CHECK atau kolom wajib kosong = tidak
/// ada statement (event tetap diterima, outbox tidak macet).
pub fn cloud_kontrak_statements(payload: &Value, entity_key: &str) -> Vec<(String, Vec<Value>)> {
    let id = Some(teks(payload, "id_kontrak"))
        .filter(|id| !id.is_empty())
        .unwrap_or_else(|| entity_key.trim().to_owned());
    let id_karyawan = teks(payload, "id_karyawan");
    let status = teks(payload, "status");
    let mulai = teks(payload, "tanggal_mulai");
    let status_sah = STATUS_KONTRAK.contains(&status.as_str()) || status == STATUS_PEMBATALAN;
    if id.is_empty() || id_karyawan.is_empty() || mulai.is_empty() || !status_sah {
        return Vec::new();
    }
    let kolom = ["id_ref", "nomor", "tanggal_mulai", "tanggal_selesai", "percobaan_selesai", "catatan", "dicatat_oleh"];
    let mut args = vec![json!(id), json!(id_karyawan), json!(status)];
    args.extend(kolom.iter().map(|k| json!(teks(payload, k))));
    vec![
        (SIMPAN_KONTRAK_SQL.to_owned(), args),
        (CERMIN_STATUS_SQL.to_owned(), vec![json!(id_karyawan)]),
    ]
}

/// `teacher/create|update`: sesudah upsert `guru_data`, status dari kontrak
/// menang atas isian form atau perangkat lama (temuan 5).
pub fn cloud_cermin_guru(id_guru: &str) -> (String, Vec<Value>) {
    (CERMIN_STATUS_SQL.to_owned(), vec![json!(id_guru)])
}

/// `hr-duty-type/save`.
pub fn cloud_jenis_tugas_statements(payload: &Value, entity_key: &str) -> Vec<(String, Vec<Value>)> {
    let id = Some(teks(payload, "id_jenis"))
        .filter(|id| !id.is_empty())
        .unwrap_or_else(|| entity_key.trim().to_owned());
    let nama = normalisasi_nama(&teks(payload, "nama"));
    let ekuivalen = payload.get("ekuivalen_jp").and_then(Value::as_i64).unwrap_or(0);
    if id.is_empty() || nama.is_empty() || !ekuivalen_sah(ekuivalen) {
        return Vec::new();
    }
    vec![(
        SIMPAN_JENIS_TUGAS_SQL.to_owned(),
        vec![json!(id), json!(nama), json!(ekuivalen), json!(aktif(payload))],
    )]
}

/// `hr-duty/save`: upsert penuh dari payload form.
pub fn cloud_tugas_statements(payload: &Value, entity_key: &str) -> Vec<(String, Vec<Value>)> {
    let mut p = payload.clone();
    if teks(&p, "id_tugas").is_empty() {
        p["id_tugas"] = json!(entity_key.trim());
    }
    let wajib = ["id_tugas", "id_karyawan", "id_jenis", "tahun_ajaran", "tanggal_mulai"];
    let ekuivalen = p.get("ekuivalen_jp").filter(|v| !v.is_null());
    let ekuivalen_ok = ekuivalen.map_or(true, |v| v.as_i64().is_some_and(ekuivalen_sah));
    if wajib.iter().any(|k| teks(&p, k).is_empty()) || !ekuivalen_ok {
        return Vec::new();
    }
    let args = simpan_tugas_args(&p)
        .into_iter()
        .map(|v| match v {
            rusqlite::types::Value::Text(s) => json!(s),
            rusqlite::types::Value::Integer(n) => json!(n),
            _ => Value::Null,
        })
        .collect();
    vec![(SIMPAN_TUGAS_SQL.to_owned(), args)]
}

/// `hr-duty/cancel`: hanya mengisi kolom batal yang masih kosong.
pub fn cloud_batal_tugas_statements(payload: &Value, entity_key: &str) -> Vec<(String, Vec<Value>)> {
    let id = Some(teks(payload, "id_tugas"))
        .filter(|id| !id.is_empty())
        .unwrap_or_else(|| entity_key.trim().to_owned());
    if id.is_empty() {
        return Vec::new();
    }
    vec![(
        BATAL_TUGAS_SQL.to_owned(),
        vec![json!(id), json!(teks(payload, "dibatalkan_oleh")), json!(teks(payload, "alasan_batal"))],
    )]
}

/// Penjaga "pegawai" untuk statement per orang; ?1 = id_unik.
const PEGAWAI_ID_SQL: &str = "LOWER(TRIM(COALESCE(jenis_personil, ''))) <> 'siswa' AND NOT EXISTS (SELECT 1 FROM siswa_data sd WHERE sd.id_siswa = ?1)";

/// Kolom organisasi dari event `employee/*`, dijalankan SESUDAH upsert baris.
/// Kunci absen atau `null` = tidak dibawa (perangkat lama): teks dipetakan
/// lewat nama master; `""` = dikosongkan. Dengan master yang dikenal, teks
/// `divisi`/`jabatan_status` diambil dari master, sehingga event telat tidak
/// mengembalikan nama lama. Siswa dilewati.
pub fn cloud_organisasi_pegawai(id_unik: &str, row: &Value) -> Vec<(String, Vec<Value>)> {
    let mut hasil = Vec::new();
    let id = json!(id_unik);
    match row.get("id_bagian").and_then(Value::as_str) {
        Some(nilai) => hasil.push((
            format!("UPDATE master_data SET id_bagian = NULLIF(TRIM(?2), '') WHERE id_unik = ?1 AND {PEGAWAI_ID_SQL};"),
            vec![id.clone(), json!(nilai)],
        )),
        None => hasil.push((
            format!("UPDATE master_data SET id_bagian = (SELECT n.id_bagian FROM hr_bagian_nama n JOIN hr_bagian b ON b.id_bagian = n.id_bagian WHERE lower(trim(n.nama)) = lower(trim(master_data.divisi)) ORDER BY b.is_aktif DESC, n.created_at DESC, n.id_nama LIMIT 1) WHERE id_unik = ?1 AND {PEGAWAI_ID_SQL};"),
            vec![id.clone()],
        )),
    }
    match row.get("id_jabatan").and_then(Value::as_str) {
        Some(nilai) => hasil.push((
            format!("UPDATE master_data SET id_jabatan = NULLIF(TRIM(?2), '') WHERE id_unik = ?1 AND {PEGAWAI_ID_SQL};"),
            vec![id.clone(), json!(nilai)],
        )),
        None => hasil.push((
            format!("UPDATE master_data SET id_jabatan = (SELECT j.id_jabatan FROM hr_jabatan j WHERE lower(trim(j.nama)) = lower(trim(master_data.jabatan_status)) ORDER BY j.is_aktif DESC, j.id_jabatan LIMIT 1) WHERE id_unik = ?1 AND {PEGAWAI_ID_SQL};"),
            vec![id.clone()],
        )),
    }
    if let Some(nilai) = row.get("id_atasan").and_then(Value::as_str) {
        hasil.push((
            format!("UPDATE master_data SET id_atasan = NULLIF(TRIM(?2), '') WHERE id_unik = ?1 AND {PEGAWAI_ID_SQL};"),
            vec![id.clone(), json!(nilai)],
        ));
    }
    hasil.push((
        "UPDATE master_data SET divisi = (SELECT nama FROM hr_bagian WHERE id_bagian = master_data.id_bagian) WHERE id_unik = ?1 AND EXISTS (SELECT 1 FROM hr_bagian WHERE id_bagian = master_data.id_bagian) AND divisi IS NOT (SELECT nama FROM hr_bagian WHERE id_bagian = master_data.id_bagian);".to_owned(),
        vec![id.clone()],
    ));
    hasil.push((
        "UPDATE master_data SET jabatan_status = (SELECT nama FROM hr_jabatan WHERE id_jabatan = master_data.id_jabatan) WHERE id_unik = ?1 AND EXISTS (SELECT 1 FROM hr_jabatan WHERE id_jabatan = master_data.id_jabatan) AND jabatan_status IS NOT (SELECT nama FROM hr_jabatan WHERE id_jabatan = master_data.id_jabatan);".to_owned(),
        vec![id],
    ));
    hasil
}

// Penulisan lokal (Desktop/Mobile)

fn invalid(message: impl Into<String>) -> CommandError {
    CommandError::new("VALIDATION_ERROR", message)
}

fn db_error(_: rusqlite::Error) -> CommandError {
    CommandError::internal()
}

pub(crate) fn new_id(prefix: &str) -> String {
    let mut bytes = [0u8; 12];
    rand_core::RngCore::fill_bytes(&mut rand_core::OsRng, &mut bytes);
    format!("{prefix}{}", hex::encode(bytes))
}

fn rows_json(transaction: &Transaction<'_>, sql: &str) -> Result<Vec<Value>, CommandError> {
    rows_json_with(transaction, sql, [])
}

pub(crate) fn rows_json_with(
    connection: &rusqlite::Connection,
    sql: &str,
    args: impl rusqlite::Params,
) -> Result<Vec<Value>, CommandError> {
    let mut statement = connection.prepare(sql).map_err(db_error)?;
    let names: Vec<String> = statement.column_names().iter().map(|n| (*n).to_owned()).collect();
    let rows = statement
        .query_map(args, |row| {
            let mut obj = serde_json::Map::new();
            for (i, name) in names.iter().enumerate() {
                let value = match row.get_ref(i)? {
                    rusqlite::types::ValueRef::Null => Value::Null,
                    rusqlite::types::ValueRef::Integer(n) => json!(n),
                    rusqlite::types::ValueRef::Real(f) => json!(f),
                    rusqlite::types::ValueRef::Text(t) => json!(String::from_utf8_lossy(t)),
                    rusqlite::types::ValueRef::Blob(_) => Value::Null,
                };
                obj.insert(name.clone(), value);
            }
            Ok(Value::Object(obj))
        })
        .map_err(db_error)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(db_error)?;
    Ok(rows)
}

fn master_org(rows: &[Value], kunci_id: &str) -> Vec<MasterOrg> {
    rows.iter()
        .map(|r| MasterOrg {
            id: teks(r, kunci_id),
            nama: r.get("nama").and_then(Value::as_str).unwrap_or("").to_owned(),
            is_aktif: r.get("is_aktif").and_then(Value::as_i64).unwrap_or(1),
        })
        .collect()
}

/// `desktop_hr_org`: pegawai + master + turunan (`susun_org`).
pub fn org(state: &DesktopState) -> Result<Value, CommandError> {
    let mut connection = storage::database(&state.data_dir)?;
    let transaction = connection.transaction().map_err(db_error)?;
    let pegawai = rows_json(&transaction, ORG_PEGAWAI_SQL)?;
    let bagian = rows_json(&transaction, ORG_BAGIAN_SQL)?;
    let nama = rows_json(&transaction, ORG_BAGIAN_NAMA_SQL)?;
    let jabatan = rows_json(&transaction, ORG_JABATAN_SQL)?;
    let pegawai_org: Vec<PegawaiOrg> = pegawai
        .iter()
        .filter_map(|p| serde_json::from_value(p.clone()).ok())
        .collect();
    let nama_lama: Vec<NamaLama> = nama
        .iter()
        .filter_map(|n| serde_json::from_value(n.clone()).ok())
        .collect();
    let mut hasil = susun_org(
        &pegawai_org,
        &master_org(&bagian, "id_bagian"),
        &nama_lama,
        &master_org(&jabatan, "id_jabatan"),
    );
    let kini = status_kini(&transaction, &hari_ini(&transaction)?)?;
    let pegawai: Vec<Value> = pegawai
        .into_iter()
        .map(|mut p| {
            if let Some(status) = kini.get(&teks(&p, "id_unik")) {
                p["status_kepegawaian"] = json!(status);
            }
            p
        })
        .collect();
    hasil["pegawai"] = Value::Array(pegawai);
    hasil["jenis_tugas"] = Value::Array(rows_json(&transaction, JENIS_TUGAS_SQL)?);
    // Jenis pengajuan (HRIS Fase 2) disunting di tab Organisasi.
    hasil["jenis_pengajuan"] = Value::Array(rows_json(&transaction, super::hr_pengajuan::JENIS_SQL)?);
    hasil["pengaturan"] = pengaturan_kontrak(&transaction)?;
    Ok(hasil)
}

/// `hari ini` WIB menurut jam SQLite (`HARI_INI_SQL`).
pub fn hari_ini(connection: &rusqlite::Connection) -> Result<String, CommandError> {
    connection
        .query_row(HARI_INI_SQL, [], |row| row.get(0))
        .map_err(db_error)
}

/// `STATUS_KINI_SQL` pada `tanggal`: id pegawai → status kepegawaian.
pub fn status_kini(
    connection: &rusqlite::Connection,
    tanggal: &str,
) -> Result<HashMap<String, String>, CommandError> {
    Ok(rows_json_with(connection, STATUS_KINI_SQL, params![tanggal])?
        .iter()
        .map(|r| (teks(r, "id_unik"), r.get("status").and_then(Value::as_str).unwrap_or("").to_owned()))
        .collect())
}

/// `TUGAS_BERLAKU_SQL` pada [awal, akhir]: id pegawai → id jenis tugas.
pub fn tugas_berlaku(
    connection: &rusqlite::Connection,
    awal: &str,
    akhir: &str,
) -> Result<HashMap<String, Vec<String>>, CommandError> {
    let mut hasil: HashMap<String, Vec<String>> = HashMap::new();
    for r in rows_json_with(connection, TUGAS_BERLAKU_SQL, params![awal, akhir])? {
        let id = r.get("id_karyawan").and_then(Value::as_str).unwrap_or("").to_owned();
        hasil.entry(id).or_default().push(teks(&r, "id_jenis"));
    }
    Ok(hasil)
}

/// Angka kontrak dan batas JP (`PENGATURAN_KONTRAK_SQL`): isi kunci apa adanya
/// dan `berlaku` sesudah bawaan.
pub(crate) fn pengaturan_kontrak(connection: &rusqlite::Connection) -> Result<Value, CommandError> {
    let nilai: HashMap<String, String> = rows_json_with(connection, PENGATURAN_KONTRAK_SQL, [])?
        .iter()
        .map(|r| (teks(r, "key"), r.get("value").and_then(Value::as_str).unwrap_or("").to_owned()))
        .collect();
    let percobaan = nilai.get(KUNCI_PERCOBAAN_MAKS).cloned().unwrap_or_default();
    let pkwt = nilai.get(KUNCI_PKWT_MAKS).cloned().unwrap_or_default();
    let beban_min = nilai.get(KUNCI_BEBAN_MIN_JP).cloned().unwrap_or_default();
    let beban_maks = nilai.get(KUNCI_BEBAN_MAKS_JP).cloned().unwrap_or_default();
    let (min, maks) = batas_beban(Some(&beban_min), Some(&beban_maks));
    Ok(json!({
        "percobaan_maks_bulan": percobaan,
        "pkwt_maks_bulan": pkwt,
        "beban_min_jp": beban_min,
        "beban_maks_jp": beban_maks,
        "berlaku": {
            "percobaan_maks_bulan": angka_pengaturan(Some(&percobaan), ATURAN_PERCOBAAN),
            "pkwt_maks_bulan": angka_pengaturan(Some(&pkwt), ATURAN_PKWT),
            "beban_min_jp": min,
            "beban_maks_jp": maks,
        },
    }))
}

/// Satu kunci `setting_gex_system` + event outbox `setting` (pola JP): antrean
/// lama kunci yang sama dibuang dulu supaya nilai lama tidak menyusul.
pub fn tulis_setting(
    transaction: &Transaction<'_>,
    client_id: &str,
    key: &str,
    value: &str,
) -> Result<(), CommandError> {
    transaction
        .execute(
            "INSERT INTO setting_gex_system (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value;",
            params![key, value],
        )
        .map_err(db_error)?;
    transaction
        .execute(
            "DELETE FROM desktop_sync_conflict WHERE domain = 'setting' AND entity_key = ?1;",
            params![key],
        )
        .map_err(db_error)?;
    transaction
        .execute(
            "DELETE FROM desktop_sync_outbox WHERE domain = 'setting' AND entity_key = ?1 AND status IN ('pending', 'failed', 'conflict');",
            params![key],
        )
        .map_err(db_error)?;
    sync::enqueue(
        transaction,
        client_id,
        "setting",
        "update",
        key,
        &json!({ "key": key, "value": value }),
        None,
    )?;
    Ok(())
}

/// Pegawai (bukan siswa) yang ada; `Some(true)` bila punya `guru_data`.
fn pegawai_guru(transaction: &Transaction<'_>, id: &str) -> Result<Option<bool>, CommandError> {
    transaction
        .query_row(
            &format!("SELECT EXISTS (SELECT 1 FROM guru_data WHERE id_guru = m.id_unik) FROM master_data m WHERE m.id_unik = ?1 AND {PEGAWAI_SQL};"),
            params![id],
            |row| row.get::<_, i64>(0),
        )
        .optional()
        .map(|r| r.map(|g| g == 1))
        .map_err(db_error)
}

fn kontrak_baris(rows: Vec<Value>) -> Vec<KontrakBaris> {
    rows.into_iter()
        .filter_map(|r| serde_json::from_value(r).ok())
        .collect()
}

/// `desktop_hr_contracts`: semua kontrak + ringkasan per pegawai.
pub fn contracts(state: &DesktopState) -> Result<Value, CommandError> {
    let mut connection = storage::database(&state.data_dir)?;
    let transaction = connection.transaction().map_err(db_error)?;
    let rows = rows_json(&transaction, KONTRAK_SQL)?;
    let hari = hari_ini(&transaction)?;
    let pengaturan = pengaturan_kontrak(&transaction)?;
    let aturan: AturanKontrak =
        serde_json::from_value(pengaturan["berlaku"].clone()).map_err(|_| CommandError::internal())?;
    let mut hasil = susun_kontrak(&kontrak_baris(rows.clone()), &hari, aturan);
    hasil["kontrak"] = Value::Array(rows);
    hasil["hari_ini"] = json!(hari);
    hasil["pengaturan"] = pengaturan;
    Ok(hasil)
}

fn kontrak_payload(id: &str, id_karyawan: &str, id_ref: &str, k: &KontrakIsian, oleh: &str) -> Value {
    json!({
        "id_kontrak": id,
        "id_karyawan": id_karyawan,
        "status": k.status,
        "id_ref": id_ref,
        "nomor": k.nomor,
        "tanggal_mulai": k.tanggal_mulai,
        "tanggal_selesai": k.tanggal_selesai,
        "percobaan_selesai": k.percobaan_selesai,
        "catatan": k.catatan,
        "dicatat_oleh": oleh,
    })
}

fn tulis_kontrak(transaction: &Transaction<'_>, p: &Value) -> Result<(), CommandError> {
    transaction
        .execute(
            SIMPAN_KONTRAK_SQL,
            params![
                teks(p, "id_kontrak"),
                teks(p, "id_karyawan"),
                teks(p, "status"),
                teks(p, "id_ref"),
                teks(p, "nomor"),
                teks(p, "tanggal_mulai"),
                teks(p, "tanggal_selesai"),
                teks(p, "percobaan_selesai"),
                teks(p, "catatan"),
                teks(p, "dicatat_oleh"),
            ],
        )
        .map_err(db_error)?;
    transaction
        .execute(CERMIN_STATUS_SQL, params![teks(p, "id_karyawan")])
        .map_err(db_error)?;
    Ok(())
}

/// `desktop_hr_contract_create`.
pub fn simpan_kontrak(state: &DesktopState, oleh: &str, draft: Value) -> Result<Value, CommandError> {
    let id_karyawan = teks(&draft, "id_karyawan");
    let isian: KontrakIsian =
        serde_json::from_value(draft).map_err(|_| invalid("Data kontrak tidak valid."))?;
    let client_id = sync::ensure_client_id(state)?;
    let mut connection = storage::database(&state.data_dir)?;
    let transaction = connection.transaction().map_err(db_error)?;
    let guru = pegawai_guru(&transaction, &id_karyawan)?
        .ok_or_else(|| invalid("Kontrak hanya untuk pegawai (guru dan tendik)."))?;
    let k = validasi_kontrak(&isian, guru).map_err(invalid)?;
    let id = new_id("kon-");
    let payload = kontrak_payload(&id, &id_karyawan, "", &k, oleh);
    tulis_kontrak(&transaction, &payload)?;
    sync::enqueue(&transaction, &client_id, "hr-contract", "create", &id, &payload, None)?;
    transaction.commit().map_err(db_error)?;
    Ok(payload)
}

/// `desktop_hr_contract_cancel`: baris `Pembatalan` berid `batal-<id>`.
pub fn batal_kontrak(state: &DesktopState, oleh: &str, id_kontrak: &str, alasan: &str) -> Result<Value, CommandError> {
    let alasan = validasi_alasan(alasan).map_err(invalid)?;
    let client_id = sync::ensure_client_id(state)?;
    let mut connection = storage::database(&state.data_dir)?;
    let transaction = connection.transaction().map_err(db_error)?;
    let (id_karyawan, mulai): (String, String) = transaction
        .query_row(
            "SELECT id_karyawan, tanggal_mulai FROM hr_kontrak WHERE id_kontrak = ?1 AND status <> 'Pembatalan';",
            params![id_kontrak.trim()],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .map_err(db_error)?
        .ok_or_else(|| invalid("Kontrak tidak ditemukan."))?;
    if ada(&transaction, "SELECT 1 FROM hr_kontrak WHERE status = 'Pembatalan' AND id_ref = ?1;", params![id_kontrak.trim()])? {
        return Err(invalid("Kontrak ini sudah dibatalkan."));
    }
    let id = format!("batal-{}", id_kontrak.trim());
    let isian = KontrakIsian {
        status: STATUS_PEMBATALAN.to_owned(),
        tanggal_mulai: mulai,
        catatan: alasan,
        ..Default::default()
    };
    let payload = kontrak_payload(&id, &id_karyawan, id_kontrak.trim(), &isian, oleh);
    tulis_kontrak(&transaction, &payload)?;
    sync::enqueue(&transaction, &client_id, "hr-contract", "create", &id, &payload, None)?;
    transaction.commit().map_err(db_error)?;
    Ok(payload)
}

/// `desktop_hr_settings_save`: angka kontrak (Q-28) dan batas JP (§21.2.1);
/// `""` = bawaan. Keempat isian wajib dibawa.
pub fn simpan_pengaturan(state: &DesktopState, draft: Value) -> Result<Value, CommandError> {
    let percobaan = validasi_angka_pengaturan(&teks(&draft, "percobaan_maks_bulan"), ATURAN_PERCOBAAN, "Masa percobaan")
        .map_err(invalid)?;
    let pkwt = validasi_angka_pengaturan(&teks(&draft, "pkwt_maks_bulan"), ATURAN_PKWT, "Batas GTT/PTT")
        .map_err(invalid)?;
    let (beban_min, beban_maks) =
        validasi_batas_beban(&teks(&draft, "beban_min_jp"), &teks(&draft, "beban_maks_jp")).map_err(invalid)?;
    let client_id = sync::ensure_client_id(state)?;
    let mut connection = storage::database(&state.data_dir)?;
    let transaction = connection.transaction().map_err(db_error)?;
    tulis_setting(&transaction, &client_id, KUNCI_PERCOBAAN_MAKS, &percobaan)?;
    tulis_setting(&transaction, &client_id, KUNCI_PKWT_MAKS, &pkwt)?;
    tulis_setting(&transaction, &client_id, KUNCI_BEBAN_MIN_JP, &beban_min)?;
    tulis_setting(&transaction, &client_id, KUNCI_BEBAN_MAKS_JP, &beban_maks)?;
    let hasil = pengaturan_kontrak(&transaction)?;
    transaction.commit().map_err(db_error)?;
    Ok(hasil)
}

#[derive(Debug, Deserialize)]
pub struct JenisTugasDraft {
    #[serde(default)]
    pub id: Option<String>,
    pub nama: String,
    pub ekuivalen_jp: i64,
    #[serde(default = "satu")]
    pub is_aktif: i64,
}

/// `desktop_hr_duty_types_save`: jenis baru atau ubah nama/ekuivalen/aktif.
pub fn simpan_jenis_tugas(state: &DesktopState, draft: Value) -> Result<Value, CommandError> {
    let draft: JenisTugasDraft =
        serde_json::from_value(draft).map_err(|_| invalid("Data jenis tugas tidak valid."))?;
    let nama = validasi_jenis_tugas(&draft.nama, draft.ekuivalen_jp).map_err(invalid)?;
    if !matches!(draft.is_aktif, 0 | 1) {
        return Err(invalid("Status aktif jenis tugas tidak valid."));
    }
    let client_id = sync::ensure_client_id(state)?;
    let mut connection = storage::database(&state.data_dir)?;
    let transaction = connection.transaction().map_err(db_error)?;
    let id = match draft.id.as_deref().map(str::trim).filter(|id| !id.is_empty()) {
        Some(id) => {
            if !ada(&transaction, "SELECT 1 FROM hr_tugas_jenis WHERE id_jenis = ?1;", params![id])? {
                return Err(invalid("Jenis tugas tidak ditemukan."));
            }
            id.to_owned()
        }
        None => new_id("tgs-"),
    };
    if ada(&transaction, BENTROK_JENIS_TUGAS_SQL, params![nama, id])? {
        return Err(invalid(format!("Nama \"{nama}\" sudah dipakai jenis tugas lain.")));
    }
    transaction
        .execute(SIMPAN_JENIS_TUGAS_SQL, params![id, nama, draft.ekuivalen_jp, draft.is_aktif])
        .map_err(db_error)?;
    let payload = json!({ "id_jenis": id, "nama": nama, "ekuivalen_jp": draft.ekuivalen_jp, "is_aktif": draft.is_aktif });
    sync::enqueue(&transaction, &client_id, "hr-duty-type", "save", &id, &payload, None)?;
    transaction.commit().map_err(db_error)?;
    Ok(payload)
}

/// `desktop_hr_duties`: tugas (status diturunkan), wali kelas dari rombel,
/// dan rentang tahun ajaran untuk tanggal bawaan form.
pub fn duties(state: &DesktopState) -> Result<Value, CommandError> {
    let mut connection = storage::database(&state.data_dir)?;
    let transaction = connection.transaction().map_err(db_error)?;
    let hari = hari_ini(&transaction)?;
    let tugas: Vec<Value> = rows_json(&transaction, TUGAS_SQL)?
        .into_iter()
        .map(|mut t| {
            t["status"] = json!(status_tugas(
                &teks(&t, "tanggal_mulai"),
                &teks(&t, "tanggal_selesai"),
                &teks(&t, "dibatalkan_pada"),
                &hari,
            ));
            t
        })
        .collect();
    Ok(json!({
        "jenis": rows_json(&transaction, JENIS_TUGAS_SQL)?,
        "tugas": tugas,
        "wali_kelas": rows_json(&transaction, WALI_KELAS_SQL)?,
        "tahun_ajaran": rows_json(&transaction, TAHUN_AJARAN_SQL)?,
        "hari_ini": hari,
    }))
}

fn tugas_payload(id: &str, t: &TugasIsian, oleh: &str) -> Value {
    json!({
        "id_tugas": id,
        "id_karyawan": t.id_karyawan,
        "id_jenis": t.id_jenis,
        "unit": t.unit,
        "tahun_ajaran": t.tahun_ajaran,
        "id_rombel": t.id_rombel,
        "nomor_sk": t.nomor_sk,
        "tanggal_sk": t.tanggal_sk,
        "ekuivalen_jp": t.ekuivalen_jp,
        "tanggal_mulai": t.tanggal_mulai,
        "tanggal_selesai": t.tanggal_selesai,
        "dicatat_oleh": oleh,
    })
}

fn simpan_tugas_args(p: &Value) -> Vec<rusqlite::types::Value> {
    use rusqlite::types::Value as Sql;
    let s = |k: &str| Sql::Text(teks(p, k));
    vec![
        s("id_tugas"),
        s("id_karyawan"),
        s("id_jenis"),
        s("unit"),
        s("tahun_ajaran"),
        s("id_rombel"),
        s("nomor_sk"),
        s("tanggal_sk"),
        p.get("ekuivalen_jp").and_then(Value::as_i64).map_or(Sql::Null, Sql::Integer),
        s("tanggal_mulai"),
        s("tanggal_selesai"),
        s("dicatat_oleh"),
    ]
}

/// `desktop_hr_duty_save`: tugas baru atau ubah (upsert penuh).
pub fn simpan_tugas(state: &DesktopState, oleh: &str, draft: Value) -> Result<Value, CommandError> {
    let id_lama = teks(&draft, "id");
    let isian: TugasIsian =
        serde_json::from_value(draft).map_err(|_| invalid("Data tugas tidak valid."))?;
    let t = validasi_tugas(&isian).map_err(invalid)?;
    let client_id = sync::ensure_client_id(state)?;
    let mut connection = storage::database(&state.data_dir)?;
    let transaction = connection.transaction().map_err(db_error)?;
    let jenis_lama = if id_lama.is_empty() {
        None
    } else {
        let (jenis, batal): (String, Option<String>) = transaction
            .query_row(
                "SELECT id_jenis, dibatalkan_pada FROM hr_tugas_tambahan WHERE id_tugas = ?1;",
                params![id_lama],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()
            .map_err(db_error)?
            .ok_or_else(|| invalid("Tugas tidak ditemukan."))?;
        if batal.is_some() {
            return Err(invalid("Tugas yang sudah dibatalkan tidak bisa diubah."));
        }
        Some(jenis)
    };
    if pegawai_guru(&transaction, &t.id_karyawan)?.is_none() {
        return Err(invalid("Tugas tambahan hanya untuk pegawai (guru dan tendik)."));
    }
    let (nama_jenis, jenis_aktif): (String, i64) = transaction
        .query_row(
            "SELECT nama, is_aktif FROM hr_tugas_jenis WHERE id_jenis = ?1;",
            params![t.id_jenis],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .map_err(db_error)?
        .ok_or_else(|| invalid("Jenis tugas tidak ditemukan."))?;
    if jenis_aktif != 1 && jenis_lama.as_deref() != Some(t.id_jenis.as_str()) {
        return Err(invalid(format!("Jenis tugas \"{nama_jenis}\" sudah nonaktif.")));
    }
    if t.id_jenis == ID_WALI_KELAS
        && !ada(
            &transaction,
            "SELECT 1 FROM akademik_rombel WHERE id_rombel = ?1 AND id_wali_kelas = ?2;",
            params![t.id_rombel, t.id_karyawan],
        )?
    {
        return Err(invalid("Rombel ini tidak berwali pegawai tersebut."));
    }
    let id = if id_lama.is_empty() { new_id("tgt-") } else { id_lama };
    let payload = tugas_payload(&id, &t, oleh);
    transaction
        .execute(SIMPAN_TUGAS_SQL, rusqlite::params_from_iter(simpan_tugas_args(&payload)))
        .map_err(db_error)?;
    sync::enqueue(&transaction, &client_id, "hr-duty", "save", &id, &payload, None)?;
    transaction.commit().map_err(db_error)?;
    Ok(payload)
}

/// `desktop_hr_duty_cancel`.
pub fn batal_tugas(state: &DesktopState, oleh: &str, id_tugas: &str, alasan: &str) -> Result<Value, CommandError> {
    let alasan = validasi_alasan(alasan).map_err(invalid)?;
    let id = id_tugas.trim();
    let client_id = sync::ensure_client_id(state)?;
    let mut connection = storage::database(&state.data_dir)?;
    let transaction = connection.transaction().map_err(db_error)?;
    let batal: Option<String> = transaction
        .query_row(
            "SELECT dibatalkan_pada FROM hr_tugas_tambahan WHERE id_tugas = ?1;",
            params![id],
            |row| row.get(0),
        )
        .optional()
        .map_err(db_error)?
        .ok_or_else(|| invalid("Tugas tidak ditemukan."))?;
    if batal.is_some() {
        return Err(invalid("Tugas ini sudah dibatalkan."));
    }
    transaction
        .execute(BATAL_TUGAS_SQL, params![id, oleh, alasan])
        .map_err(db_error)?;
    let payload = json!({ "id_tugas": id, "dibatalkan_oleh": oleh, "alasan_batal": alasan });
    sync::enqueue(&transaction, &client_id, "hr-duty", "cancel", id, &payload, None)?;
    transaction.commit().map_err(db_error)?;
    Ok(payload)
}

#[derive(Debug, Deserialize)]
pub struct MasterDraft {
    #[serde(default)]
    pub id: Option<String>,
    pub nama: String,
    #[serde(default = "satu")]
    pub is_aktif: i64,
}

fn satu() -> i64 {
    1
}

fn ada(transaction: &Transaction<'_>, sql: &str, args: impl rusqlite::Params) -> Result<bool, CommandError> {
    transaction
        .query_row(sql, args, |_| Ok(()))
        .optional()
        .map(|r| r.is_some())
        .map_err(db_error)
}

/// `desktop_hr_section_save`: bagian baru atau ganti nama/aktif.
pub fn simpan_bagian(state: &DesktopState, draft: Value) -> Result<Value, CommandError> {
    let draft: MasterDraft =
        serde_json::from_value(draft).map_err(|_| invalid("Data bagian tidak valid."))?;
    let nama = validasi_nama_master(&draft.nama, "bagian").map_err(invalid)?;
    if !matches!(draft.is_aktif, 0 | 1) {
        return Err(invalid("Status aktif bagian tidak valid."));
    }
    let client_id = sync::ensure_client_id(state)?;
    let mut connection = storage::database(&state.data_dir)?;
    let transaction = connection.transaction().map_err(db_error)?;
    let id = match draft.id.as_deref().map(str::trim).filter(|id| !id.is_empty()) {
        Some(id) => {
            if !ada(&transaction, "SELECT 1 FROM hr_bagian WHERE id_bagian = ?1;", params![id])? {
                return Err(invalid("Bagian tidak ditemukan."));
            }
            id.to_owned()
        }
        None => new_id("bag-"),
    };
    if ada(&transaction, BENTROK_BAGIAN_SQL, params![nama, id])? {
        return Err(invalid(format!(
            "Nama \"{nama}\" sudah dipakai bagian lain (nama sekarang atau nama lamanya)."
        )));
    }
    transaction
        .execute(SIMPAN_BAGIAN_SQL, params![id, nama, draft.is_aktif])
        .map_err(db_error)?;
    transaction
        .execute(CATAT_NAMA_BAGIAN_SQL, params![id_nama_bagian(&id, &nama), id, nama])
        .map_err(db_error)?;
    for sql in TULIS_ULANG_BAGIAN_SQL {
        transaction.execute(sql, params![id]).map_err(db_error)?;
    }
    let payload = json!({ "id_bagian": id, "nama": nama, "is_aktif": draft.is_aktif });
    sync::enqueue(&transaction, &client_id, "hr-section", "save", &id, &payload, None)?;
    transaction.commit().map_err(db_error)?;
    Ok(payload)
}

/// `desktop_hr_section_merge`: anggota `id_asal` pindah ke `id_tujuan`.
pub fn gabung_bagian(state: &DesktopState, id_asal: &str, id_tujuan: &str) -> Result<Value, CommandError> {
    let (asal, tujuan) = (id_asal.trim(), id_tujuan.trim());
    if asal.is_empty() || tujuan.is_empty() || asal == tujuan {
        return Err(invalid("Pilih dua bagian yang berbeda."));
    }
    let client_id = sync::ensure_client_id(state)?;
    let mut connection = storage::database(&state.data_dir)?;
    let transaction = connection.transaction().map_err(db_error)?;
    if !ada(&transaction, "SELECT 1 FROM hr_bagian WHERE id_bagian = ?1;", params![asal])? {
        return Err(invalid("Bagian asal tidak ditemukan."));
    }
    if !ada(&transaction, "SELECT 1 FROM hr_bagian WHERE id_bagian = ?1 AND is_aktif = 1;", params![tujuan])? {
        return Err(invalid("Bagian tujuan harus bagian aktif."));
    }
    for sql in GABUNG_BAGIAN_SQL {
        transaction.execute(sql, params![asal, tujuan]).map_err(db_error)?;
    }
    for sql in TULIS_ULANG_BAGIAN_SQL {
        transaction.execute(sql, params![tujuan]).map_err(db_error)?;
    }
    let payload = json!({ "id_asal": asal, "id_tujuan": tujuan });
    sync::enqueue(&transaction, &client_id, "hr-section", "merge", asal, &payload, None)?;
    transaction.commit().map_err(db_error)?;
    Ok(payload)
}

/// `desktop_hr_position_save`.
pub fn simpan_jabatan(state: &DesktopState, draft: Value) -> Result<Value, CommandError> {
    let draft: MasterDraft =
        serde_json::from_value(draft).map_err(|_| invalid("Data jabatan tidak valid."))?;
    let nama = validasi_nama_master(&draft.nama, "jabatan").map_err(invalid)?;
    if !matches!(draft.is_aktif, 0 | 1) {
        return Err(invalid("Status aktif jabatan tidak valid."));
    }
    let client_id = sync::ensure_client_id(state)?;
    let mut connection = storage::database(&state.data_dir)?;
    let transaction = connection.transaction().map_err(db_error)?;
    let id = match draft.id.as_deref().map(str::trim).filter(|id| !id.is_empty()) {
        Some(id) => {
            if !ada(&transaction, "SELECT 1 FROM hr_jabatan WHERE id_jabatan = ?1;", params![id])? {
                return Err(invalid("Jabatan tidak ditemukan."));
            }
            id.to_owned()
        }
        None => new_id("jab-"),
    };
    if ada(&transaction, BENTROK_JABATAN_SQL, params![nama, id])? {
        return Err(invalid(format!("Nama \"{nama}\" sudah dipakai jabatan lain.")));
    }
    transaction
        .execute(SIMPAN_JABATAN_SQL, params![id, nama, draft.is_aktif])
        .map_err(db_error)?;
    transaction.execute(TULIS_ULANG_JABATAN_SQL, params![id]).map_err(db_error)?;
    let payload = json!({ "id_jabatan": id, "nama": nama, "is_aktif": draft.is_aktif });
    sync::enqueue(&transaction, &client_id, "hr-position", "save", &id, &payload, None)?;
    transaction.commit().map_err(db_error)?;
    Ok(payload)
}

/// Isian organisasi satu pegawai yang sudah diperiksa, siap ditulis.
#[derive(Debug, Default, PartialEq)]
pub struct OrganisasiValid {
    pub id_bagian: String,
    pub divisi: String,
    pub id_jabatan: String,
    pub jabatan_status: String,
    pub id_atasan: String,
}

/// Pilihan bagian/jabatan/atasan dari form Karyawan dan Guru (Q-19).
///
/// Bagian dan jabatan baru wajib master aktif; master nonaktif yang SUDAH
/// dipegang orang itu boleh tetap. `bagian_wajib`: pegawai baru dari form.
/// Tanpa `id_bagian` (form lama) teks `divisi` tetap berlaku apa adanya.
pub fn periksa_organisasi(
    transaction: &Transaction<'_>,
    id_karyawan: &str,
    draft: &Value,
    bagian_wajib: bool,
) -> Result<OrganisasiValid, CommandError> {
    let lama: (String, String) = transaction
        .query_row(
            "SELECT COALESCE(id_bagian, ''), COALESCE(id_jabatan, '') FROM master_data WHERE id_unik = ?1;",
            params![id_karyawan],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .map_err(db_error)?
        .unwrap_or_default();
    let mut hasil = OrganisasiValid {
        divisi: normalisasi_nama(&teks(draft, "divisi")),
        jabatan_status: normalisasi_nama(&teks(draft, "jabatan_status")),
        ..Default::default()
    };
    let id_bagian = teks(draft, "id_bagian");
    if id_bagian.is_empty() {
        if bagian_wajib {
            return Err(invalid("Bagian wajib dipilih."));
        }
    } else {
        let (nama, aktif): (String, i64) = transaction
            .query_row(
                "SELECT nama, is_aktif FROM hr_bagian WHERE id_bagian = ?1;",
                params![id_bagian],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()
            .map_err(db_error)?
            .ok_or_else(|| invalid("Bagian tidak ditemukan."))?;
        if aktif != 1 && id_bagian != lama.0 {
            return Err(invalid(format!("Bagian \"{nama}\" sudah nonaktif.")));
        }
        hasil.divisi = nama;
        hasil.id_bagian = id_bagian;
    }
    let id_jabatan = teks(draft, "id_jabatan");
    if !id_jabatan.is_empty() {
        let (nama, aktif): (String, i64) = transaction
            .query_row(
                "SELECT nama, is_aktif FROM hr_jabatan WHERE id_jabatan = ?1;",
                params![id_jabatan],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()
            .map_err(db_error)?
            .ok_or_else(|| invalid("Jabatan tidak ditemukan."))?;
        if aktif != 1 && id_jabatan != lama.1 {
            return Err(invalid(format!("Jabatan \"{nama}\" sudah nonaktif.")));
        }
        hasil.jabatan_status = nama;
        hasil.id_jabatan = id_jabatan;
    }
    let id_atasan = teks(draft, "id_atasan");
    if !id_atasan.is_empty() {
        if !ada(
            transaction,
            &format!("SELECT 1 FROM master_data m WHERE m.id_unik = ?1 AND {PEGAWAI_SQL};"),
            params![id_atasan],
        )? {
            return Err(invalid("Atasan harus pegawai yang terdaftar."));
        }
        let atasan: HashMap<String, String> = rows_json(
            transaction,
            "SELECT id_unik, COALESCE(id_atasan, '') AS id_atasan FROM master_data WHERE COALESCE(id_atasan, '') <> ''\n-- batas: pegawai yang punya atasan, dibatasi jumlah personil lembaga\n;",
        )?
        .iter()
        .map(|r| (teks(r, "id_unik"), teks(r, "id_atasan")))
        .collect();
        periksa_atasan(id_karyawan, &id_atasan, &atasan).map_err(invalid)?;
        hasil.id_atasan = id_atasan;
    }
    Ok(hasil)
}

/// Tulis kolom organisasi satu pegawai. Kosong disimpan `''` (bukan NULL)
/// supaya snapshot outbox membawanya sebagai "dikosongkan"; tarikan berikutnya
/// mengembalikannya menjadi NULL dari cloud.
pub fn tulis_organisasi(
    transaction: &Transaction<'_>,
    id_karyawan: &str,
    org: &OrganisasiValid,
) -> Result<(), CommandError> {
    transaction
        .execute(
            "UPDATE master_data SET id_bagian = ?2, id_jabatan = ?3, id_atasan = ?4 WHERE id_unik = ?1;",
            params![id_karyawan, org.id_bagian, org.id_jabatan, org.id_atasan],
        )
        .map_err(db_error)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    // Vektor kembar `src/lib/validations/hris.test.ts`.
    const VEKTOR: &str = include_str!("../../../src/lib/validations/hris.vektor.json");

    fn vektor() -> Value {
        serde_json::from_str(VEKTOR).expect("vektor hris")
    }

    fn peta(nilai: &Value) -> HashMap<String, String> {
        nilai
            .as_object()
            .expect("peta atasan")
            .iter()
            .map(|(k, v)| (k.clone(), v.as_str().unwrap_or("").to_owned()))
            .collect()
    }

    #[test]
    fn hris_vektor_nama() {
        for kasus in vektor()["nama"].as_array().expect("nama") {
            let masuk = kasus["masuk"].as_str().expect("masuk");
            assert_eq!(normalisasi_nama(masuk), kasus["normal"].as_str().unwrap(), "{masuk}");
            assert_eq!(kunci_nama(masuk), kasus["kunci"].as_str().unwrap(), "{masuk}");
            match kasus["galat"].as_str() {
                Some(galat) => assert_eq!(validasi_nama_master(masuk, "bagian").unwrap_err(), galat),
                None => assert_eq!(validasi_nama_master(masuk, "bagian").unwrap(), kasus["normal"].as_str().unwrap()),
            }
        }
    }

    #[test]
    fn hris_vektor_id_nama() {
        for kasus in vektor()["id_nama"].as_array().expect("id_nama") {
            assert_eq!(
                id_nama_bagian(kasus["id_bagian"].as_str().unwrap(), kasus["nama"].as_str().unwrap()),
                kasus["hasil"].as_str().unwrap()
            );
        }
    }

    #[test]
    fn hris_vektor_atasan() {
        for kasus in vektor()["atasan"].as_array().expect("atasan") {
            let hasil = periksa_atasan(
                kasus["id"].as_str().unwrap(),
                kasus["atasan_baru"].as_str().unwrap(),
                &peta(&kasus["peta"]),
            );
            assert_eq!(hasil.err().as_deref(), kasus["galat"].as_str(), "{kasus}");
        }
        for kasus in vektor()["siklus"].as_array().expect("siklus") {
            let harapan: Vec<String> = serde_json::from_value(kasus["hasil"].clone()).unwrap();
            assert_eq!(dalam_siklus_atasan(&peta(&kasus["peta"])), harapan);
        }
    }

    #[test]
    fn hris_vektor_susun_org() {
        for kasus in vektor()["susun"].as_array().expect("susun") {
            let pegawai: Vec<PegawaiOrg> = serde_json::from_value(kasus["pegawai"].clone()).unwrap();
            let bagian: Vec<MasterOrg> = serde_json::from_value(kasus["bagian"].clone()).unwrap();
            let nama: Vec<NamaLama> = serde_json::from_value(kasus["nama_lama"].clone()).unwrap();
            let jabatan: Vec<MasterOrg> = serde_json::from_value(kasus["jabatan"].clone()).unwrap();
            assert_eq!(susun_org(&pegawai, &bagian, &nama, &jabatan), kasus["hasil"]);
        }
    }

    fn hub() -> rusqlite::Connection {
        let connection = rusqlite::Connection::open_in_memory().expect("memori");
        connection
            .execute_batch(
                "CREATE TABLE master_data (id_unik TEXT PRIMARY KEY, nama TEXT, divisi TEXT NOT NULL, jabatan_status TEXT, jenis_personil TEXT, id_bagian TEXT, id_jabatan TEXT, id_atasan TEXT);
                 CREATE TABLE siswa_data (id_siswa TEXT PRIMARY KEY);
                 CREATE TABLE hr_bagian (id_bagian TEXT PRIMARY KEY, nama TEXT NOT NULL, is_aktif INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')));
                 CREATE TABLE hr_bagian_nama (id_nama TEXT PRIMARY KEY, id_bagian TEXT NOT NULL, nama TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')));
                 CREATE TABLE hr_jabatan (id_jabatan TEXT PRIMARY KEY, nama TEXT NOT NULL, is_aktif INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')));
                 CREATE TABLE hr_tugas_jenis (id_jenis TEXT PRIMARY KEY, nama TEXT NOT NULL, ekuivalen_jp INTEGER NOT NULL DEFAULT 0, is_aktif INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')));
                 CREATE TABLE hr_dokumen_jenis (id_jenis TEXT PRIMARY KEY, nama TEXT NOT NULL, is_aktif INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')));
                 CREATE TABLE id_card (id_unik TEXT PRIMARY KEY, divisi TEXT NOT NULL);
                 CREATE TABLE absensi_harian (id INTEGER PRIMARY KEY, id_karyawan TEXT, kelas_divisi TEXT);
                 CREATE TABLE log_scan (id INTEGER PRIMARY KEY, id_karyawan TEXT, divisi TEXT NOT NULL);
                 CREATE TABLE backup_karyawan (id INTEGER PRIMARY KEY, id_karyawan_asal TEXT, divisi_asal TEXT NOT NULL, id_karyawan_pengganti TEXT, divisi_pengganti TEXT NOT NULL);
                 CREATE TABLE koreksi_admin (id INTEGER PRIMARY KEY, id_karyawan TEXT, divisi TEXT NOT NULL);
                 CREATE TABLE payroll_components (id TEXT PRIMARY KEY, applies_to TEXT NOT NULL);
                 CREATE TABLE hari_libur_whitelist (id TEXT PRIMARY KEY, scope_type TEXT NOT NULL, scope_value TEXT NOT NULL, updated_at TEXT);
                 INSERT INTO master_data VALUES
                   ('p1', 'Ani', 'Tata Usaha', 'Staf TU', 'Pegawai', NULL, NULL, NULL),
                   ('p2', 'Budi', 'tata usaha', 'Staf TU', 'Pegawai', NULL, NULL, NULL),
                   ('p3', 'Cici', 'Tata Usaha', '-', 'Pegawai', NULL, NULL, NULL),
                   ('g1', 'Dedi', 'Tenaga Pengajar', 'Guru', 'GURU', NULL, NULL, NULL),
                   ('s1', 'Eka', 'Peserta Didik', 'Siswa', 'SISWA', NULL, NULL, NULL),
                   ('s2', 'Fani', 'Kelas 7A', 'Siswa', 'Siswa', NULL, NULL, NULL);
                 INSERT INTO siswa_data VALUES ('s1');",
            )
            .expect("hub uji");
        connection
    }

    fn jalankan(connection: &rusqlite::Connection, statements: &[(String, Vec<Value>)]) {
        for (sql, args) in statements {
            let args: Vec<rusqlite::types::Value> = args
                .iter()
                .map(|v| match v {
                    Value::String(s) => rusqlite::types::Value::Text(s.clone()),
                    Value::Number(n) => rusqlite::types::Value::Integer(n.as_i64().unwrap_or(0)),
                    _ => rusqlite::types::Value::Null,
                })
                .collect();
            connection
                .execute(sql, rusqlite::params_from_iter(args))
                .unwrap_or_else(|e| panic!("{sql}: {e}"));
        }
    }

    fn migrasi(connection: &rusqlite::Connection) {
        for sql in MIGRASI_ORGANISASI_SQL {
            connection.execute(sql, []).expect("migrasi");
        }
    }

    #[test]
    fn hris_migrasi_mengecualikan_siswa_dan_aman_diulang() {
        let connection = hub();
        migrasi(&connection);
        let bagian: Vec<(String, String)> = connection
            .prepare("SELECT id_bagian, nama FROM hr_bagian ORDER BY nama;")
            .unwrap()
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        // Id = hex teks huruf kecil, sama dengan Web; ejaan terbanyak menang.
        assert_eq!(
            bagian,
            vec![
                (format!("bag-{}", hex::encode("tata usaha")), "Tata Usaha".to_owned()),
                (format!("bag-{}", hex::encode("tenaga pengajar")), "Tenaga Pengajar".to_owned()),
            ]
        );
        let jabatan: i64 = connection
            .query_row("SELECT COUNT(*) FROM hr_jabatan;", [], |r| r.get(0))
            .unwrap();
        assert_eq!(jabatan, 2, "Staf TU + Guru; '-' dan Siswa tidak");
        let siswa: i64 = connection
            .query_row("SELECT COUNT(*) FROM master_data WHERE id_unik IN ('s1', 's2') AND id_bagian IS NOT NULL;", [], |r| r.get(0))
            .unwrap();
        assert_eq!(siswa, 0);
        let p2: String = connection
            .query_row("SELECT id_bagian FROM master_data WHERE id_unik = 'p2';", [], |r| r.get(0))
            .unwrap();
        assert_eq!(p2, bagian[0].0);
        assert_eq!(
            connection.query_row("SELECT id_nama FROM hr_bagian_nama WHERE id_bagian = ?1;", [&bagian[0].0], |r| r.get::<_, String>(0)).unwrap(),
            id_nama_bagian(&bagian[0].0, "Tata Usaha")
        );
        migrasi(&connection);
        let total: i64 = connection
            .query_row("SELECT (SELECT COUNT(*) FROM hr_bagian) + (SELECT COUNT(*) FROM hr_bagian_nama) + (SELECT COUNT(*) FROM hr_tugas_jenis) + (SELECT COUNT(*) FROM hr_dokumen_jenis);", [], |r| r.get(0))
            .unwrap();
        assert_eq!(total, 2 + 2 + 10 + 13);
    }

    #[test]
    fn hris_ganti_nama_dan_gabung_menulis_ulang_riwayat() {
        let connection = hub();
        migrasi(&connection);
        let tu = format!("bag-{}", hex::encode("tata usaha"));
        let guru = format!("bag-{}", hex::encode("tenaga pengajar"));
        connection
            .execute_batch(&format!(
                "INSERT INTO id_card VALUES ('p1', 'Tata Usaha');
                 INSERT INTO absensi_harian (id_karyawan, kelas_divisi) VALUES ('p1', 'Tata Usaha'), ('s1', 'Tata Usaha');
                 INSERT INTO log_scan (id_karyawan, divisi) VALUES ('p2', 'tata usaha');
                 INSERT INTO backup_karyawan (id_karyawan_asal, divisi_asal, id_karyawan_pengganti, divisi_pengganti) VALUES ('p1', 'Tata Usaha', 'g1', 'Tenaga Pengajar');
                 INSERT INTO koreksi_admin (id_karyawan, divisi) VALUES ('p3', 'Tata Usaha');
                 INSERT INTO payroll_components VALUES ('c1', 'DIVISI:tata usaha'), ('c2', 'DIVISI:Tenaga Pengajar'), ('c3', 'ALL');
                 INSERT INTO hari_libur_whitelist VALUES ('w1', 'DIVISI', 'Tata Usaha', NULL), ('w2', 'SHIFT', 'Tata Usaha', NULL);"
            ))
            .unwrap();
        jalankan(
            &connection,
            &cloud_bagian_statements(&json!({"id_bagian": tu, "nama": "  Tata   Usaha Sekolah ", "is_aktif": 1}), ""),
        );
        let teks1 = |sql: &str| connection.query_row(sql, [], |r| r.get::<_, String>(0)).unwrap();
        assert_eq!(teks1("SELECT divisi FROM master_data WHERE id_unik = 'p2';"), "Tata Usaha Sekolah");
        assert_eq!(teks1("SELECT divisi FROM id_card WHERE id_unik = 'p1';"), "Tata Usaha Sekolah");
        assert_eq!(teks1("SELECT kelas_divisi FROM absensi_harian WHERE id_karyawan = 'p1';"), "Tata Usaha Sekolah");
        assert_eq!(teks1("SELECT kelas_divisi FROM absensi_harian WHERE id_karyawan = 's1';"), "Tata Usaha", "siswa tersentuh");
        assert_eq!(teks1("SELECT divisi FROM log_scan;"), "Tata Usaha Sekolah");
        assert_eq!(teks1("SELECT divisi_asal FROM backup_karyawan;"), "Tata Usaha Sekolah");
        assert_eq!(teks1("SELECT divisi FROM koreksi_admin;"), "Tata Usaha Sekolah");
        assert_eq!(teks1("SELECT applies_to FROM payroll_components WHERE id = 'c1';"), "DIVISI:Tata Usaha Sekolah");
        assert_eq!(teks1("SELECT scope_value FROM hari_libur_whitelist WHERE id = 'w1';"), "Tata Usaha Sekolah");
        assert_eq!(teks1("SELECT scope_value FROM hari_libur_whitelist WHERE id = 'w2';"), "Tata Usaha");

        // Gabung TU ke Tenaga Pengajar: nama lama ikut, asal nonaktif.
        jalankan(&connection, &cloud_gabung_statements(&json!({"id_asal": tu, "id_tujuan": guru})));
        assert_eq!(teks1("SELECT divisi FROM master_data WHERE id_unik = 'p1';"), "Tenaga Pengajar");
        assert_eq!(teks1("SELECT applies_to FROM payroll_components WHERE id = 'c1';"), "DIVISI:Tenaga Pengajar");
        assert_eq!(teks1("SELECT divisi_asal FROM backup_karyawan;"), "Tenaga Pengajar");
        let aktif: i64 = connection
            .query_row("SELECT is_aktif FROM hr_bagian WHERE id_bagian = ?1;", [&tu], |r| r.get(0))
            .unwrap();
        assert_eq!(aktif, 0);
        let peta: String = connection
            .query_row(PETA_BAGIAN_SQL, ["Tata Usaha"], |r| r.get(0))
            .unwrap();
        assert_eq!(peta, guru, "nama lama dipetakan ke bagian aktif");
    }

    #[test]
    fn hris_event_lama_dipetakan_lewat_nama() {
        let connection = hub();
        migrasi(&connection);
        let tu = format!("bag-{}", hex::encode("tata usaha"));
        jalankan(&connection, &cloud_bagian_statements(&json!({"id_bagian": tu, "nama": "TU"}), ""));
        // Perangkat lama: tanpa kunci id_*, teks lama "Tata Usaha".
        connection
            .execute("UPDATE master_data SET divisi = 'tata usaha', id_bagian = NULL WHERE id_unik = 'p3';", [])
            .unwrap();
        jalankan(&connection, &cloud_organisasi_pegawai("p3", &json!({"divisi": "tata usaha"})));
        let (id, divisi, jab): (Option<String>, String, Option<String>) = connection
            .query_row("SELECT id_bagian, divisi, id_jabatan FROM master_data WHERE id_unik = 'p3';", [], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
            .unwrap();
        assert_eq!((id.as_deref(), divisi.as_str(), jab), (Some(tu.as_str()), "TU", None));
        // Perangkat baru mengosongkan atasan dan jabatan.
        connection.execute("UPDATE master_data SET id_atasan = 'p1' WHERE id_unik = 'p2';", []).unwrap();
        jalankan(&connection, &cloud_organisasi_pegawai("p2", &json!({"id_bagian": tu, "id_jabatan": "", "id_atasan": ""})));
        let (atasan, jab): (Option<String>, Option<String>) = connection
            .query_row("SELECT id_atasan, id_jabatan FROM master_data WHERE id_unik = 'p2';", [], |r| Ok((r.get(0)?, r.get(1)?)))
            .unwrap();
        assert_eq!((atasan, jab), (None, None));
        // Siswa dilewati.
        jalankan(&connection, &cloud_organisasi_pegawai("s1", &json!({"id_bagian": tu})));
        let siswa: Option<String> = connection
            .query_row("SELECT id_bagian FROM master_data WHERE id_unik = 's1';", [], |r| r.get(0))
            .unwrap();
        assert_eq!(siswa, None);
    }

    // Fase 1b: vektor kembar `hris.test.ts` "kontrak dan tugas"

    fn gabung(dasar: &Value, ubah: &Value) -> Value {
        let mut hasil = dasar.clone();
        for (k, v) in ubah.as_object().expect("ubah") {
            hasil[k] = v.clone();
        }
        hasil
    }

    /// Baris ringkas vektor: [id, pegawai, status, id_ref, mulai, selesai, percobaan].
    fn kontrak_vektor(nilai: &Value) -> Vec<KontrakBaris> {
        nilai
            .as_array()
            .expect("kontrak")
            .iter()
            .map(|b| {
                let s = |i: usize| b[i].as_str().unwrap_or("").to_owned();
                KontrakBaris {
                    id_kontrak: s(0),
                    id_karyawan: s(1),
                    status: s(2),
                    id_ref: s(3),
                    tanggal_mulai: s(4),
                    tanggal_selesai: s(5),
                    percobaan_selesai: s(6),
                    ..Default::default()
                }
            })
            .collect()
    }

    fn aturan_dari(nama: &str) -> Aturan {
        match nama {
            "percobaan" => ATURAN_PERCOBAAN,
            "beban_min" => ATURAN_BEBAN_MIN,
            "beban_maks" => ATURAN_BEBAN_MAKS,
            _ => ATURAN_PKWT,
        }
    }

    #[test]
    fn hris_vektor_kontrak() {
        let v = vektor();
        for k in v["kontrak"].as_array().expect("kontrak") {
            let isian: KontrakIsian = serde_json::from_value(gabung(&v["kontrak_dasar"], &k["ubah"])).unwrap();
            let hasil = validasi_kontrak(&isian, k["guru"].as_bool().unwrap());
            assert_eq!(hasil.as_ref().err().map(String::as_str), k["galat"].as_str(), "{k}");
            if let Ok(nilai) = hasil {
                assert_eq!(serde_json::to_value(nilai).unwrap(), k["hasil"], "{k}");
            }
        }
        for k in v["alasan"].as_array().expect("alasan") {
            let hasil = validasi_alasan(k[0].as_str().unwrap());
            assert_eq!(hasil.as_ref().ok().map(String::as_str), k[1].as_str(), "{k}");
            assert_eq!(hasil.err().as_deref(), k[2].as_str(), "{k}");
        }
        for k in v["tambah_bulan"].as_array().expect("tambah bulan") {
            assert_eq!(tambah_bulan(k[0].as_str().unwrap(), k[1].as_i64().unwrap()).as_deref(), k[2].as_str(), "{k}");
        }
        for k in v["status_kerja"].as_array().expect("status kerja") {
            assert_eq!(status_kerja(&kontrak_vektor(&k["kontrak"]), k["tanggal"].as_str().unwrap()), k["hasil"], "{k}");
        }
        for k in v["tanda"].as_array().expect("tanda") {
            let aturan: AturanKontrak = serde_json::from_value(k["aturan"].clone()).unwrap();
            assert_eq!(json!(tanda_kontrak(&kontrak_vektor(&k["kontrak"]), aturan)), k["hasil"], "{k}");
        }
        for k in v["susun_kontrak"].as_array().expect("susun kontrak") {
            let aturan: AturanKontrak = serde_json::from_value(k["aturan"].clone()).unwrap();
            assert_eq!(
                susun_kontrak(&kontrak_vektor(&k["kontrak"]), k["hari_ini"].as_str().unwrap(), aturan),
                k["hasil"]
            );
        }
        for k in v["angka"].as_array().expect("angka") {
            assert_eq!(angka_pengaturan(k[0].as_str(), aturan_dari(k[1].as_str().unwrap())), k[2].as_i64().unwrap(), "{k}");
        }
        for k in v["validasi_angka"].as_array().expect("validasi angka") {
            let hasil = validasi_angka_pengaturan(
                k[0].as_str().unwrap(),
                aturan_dari(k[1].as_str().unwrap()),
                k[2].as_str().unwrap(),
            );
            assert_eq!(hasil.as_ref().ok().map(String::as_str), k[3].as_str(), "{k}");
            assert_eq!(hasil.err().as_deref(), k[4].as_str(), "{k}");
        }
        for k in v["batas_beban"].as_array().expect("batas beban") {
            let hasil = batas_beban(k[0].as_str(), k[1].as_str());
            assert_eq!(json!([hasil.0, hasil.1]), json!([k[2], k[3]]), "{k}");
        }
        for k in v["validasi_batas_beban"].as_array().expect("validasi batas beban") {
            let hasil = validasi_batas_beban(k[0].as_str().unwrap(), k[1].as_str().unwrap());
            let (min, maks) = hasil.clone().map_or((None, None), |(a, b)| (Some(a), Some(b)));
            assert_eq!(min.as_deref(), k[2].as_str(), "{k}");
            assert_eq!(maks.as_deref(), k[3].as_str(), "{k}");
            assert_eq!(hasil.err().as_deref(), k[4].as_str(), "{k}");
        }
    }

    #[test]
    fn hris_vektor_tugas() {
        let v = vektor();
        for k in v["tugas"].as_array().expect("tugas") {
            let isian: TugasIsian = serde_json::from_value(gabung(&v["tugas_dasar"], &k["ubah"])).unwrap();
            let hasil = validasi_tugas(&isian);
            assert_eq!(hasil.as_ref().err().map(String::as_str), k["galat"].as_str(), "{k}");
            if let Ok(nilai) = hasil {
                assert_eq!(serde_json::to_value(nilai).unwrap(), k["hasil"], "{k}");
            }
        }
        for k in v["jenis_tugas"].as_array().expect("jenis tugas") {
            let hasil = validasi_jenis_tugas(k[0].as_str().unwrap(), k[1].as_i64().unwrap());
            assert_eq!(hasil.as_ref().ok().map(String::as_str), k[2].as_str(), "{k}");
            assert_eq!(hasil.err().as_deref(), k[3].as_str(), "{k}");
        }
        for k in v["status_tugas"].as_array().expect("status tugas") {
            let s = |i: usize| k[i].as_str().unwrap();
            assert_eq!(status_tugas(s(0), s(1), s(2), s(3)), s(4), "{k}");
        }
    }

    fn hub_kontrak() -> rusqlite::Connection {
        let connection = rusqlite::Connection::open_in_memory().expect("memori");
        connection
            .execute_batch(
                "CREATE TABLE master_data (id_unik TEXT PRIMARY KEY, jenis_personil TEXT);
                 CREATE TABLE siswa_data (id_siswa TEXT PRIMARY KEY);
                 CREATE TABLE guru_data (id_guru TEXT PRIMARY KEY, status_kepegawaian TEXT);
                 CREATE TABLE hr_kontrak (id_kontrak TEXT PRIMARY KEY, id_karyawan TEXT NOT NULL, status TEXT NOT NULL, id_ref TEXT, nomor TEXT, tanggal_mulai TEXT NOT NULL, tanggal_selesai TEXT, percobaan_selesai TEXT, catatan TEXT, dicatat_oleh TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')));
                 CREATE TABLE hr_tugas_tambahan (id_tugas TEXT PRIMARY KEY, id_karyawan TEXT NOT NULL, id_jenis TEXT NOT NULL, unit TEXT, tahun_ajaran TEXT NOT NULL, id_rombel TEXT, nomor_sk TEXT, tanggal_sk TEXT, ekuivalen_jp INTEGER, tanggal_mulai TEXT NOT NULL, tanggal_selesai TEXT, dicatat_oleh TEXT, dibatalkan_pada TEXT, dibatalkan_oleh TEXT, alasan_batal TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')));
                 CREATE TABLE akademik_tahun_ajaran (id_tahun_ajaran TEXT PRIMARY KEY, nama_tahun TEXT NOT NULL, semester TEXT NOT NULL, tanggal_mulai TEXT NOT NULL, tanggal_selesai TEXT NOT NULL);
                 CREATE TABLE akademik_rombel (id_rombel TEXT PRIMARY KEY, id_tahun_ajaran TEXT NOT NULL, nama_rombel TEXT NOT NULL, id_wali_kelas TEXT, is_aktif INTEGER NOT NULL DEFAULT 1);
                 INSERT INTO master_data VALUES ('g1', 'GURU'), ('t1', 'Pegawai'), ('s1', 'SISWA');
                 INSERT INTO guru_data VALUES ('g1', 'Honorer');
                 INSERT INTO akademik_tahun_ajaran VALUES ('ta1', '2026/2027', 'Ganjil', '2026-07-13', '2026-12-19'), ('ta0', '2025/2026', 'Genap', '2026-01-05', '2026-06-20');
                 INSERT INTO akademik_rombel VALUES ('r1', 'ta1', 'VII A', 'g1', 1), ('r0', 'ta0', 'VI A', 't1', 1);",
            )
            .expect("hub kontrak");
        connection
    }

    fn status_guru(connection: &rusqlite::Connection) -> String {
        connection
            .query_row("SELECT status_kepegawaian FROM guru_data WHERE id_guru = 'g1';", [], |r| r.get(0))
            .unwrap()
    }

    fn kontrak_event(id: &str, pegawai: &str, status: &str, id_ref: &str, mulai: &str) -> Value {
        json!({ "id_kontrak": id, "id_karyawan": pegawai, "status": status, "id_ref": id_ref, "tanggal_mulai": mulai, "tanggal_selesai": "", "dicatat_oleh": "tu" })
    }

    /// Keputusan A dan B §19.12: cermin mengikuti kontrak sah terakhir, tidak
    /// bergantung urutan tiba; pembatalan semua kontrak tidak mengubah guru_data.
    #[test]
    fn hris_kontrak_status_kini_dan_cermin() {
        let c = hub_kontrak();
        // Perangkat lama menyimpan guru berstatus form: cermin tanpa kontrak = tidak berubah.
        jalankan(&c, &[cloud_cermin_guru("g1")]);
        assert_eq!(status_guru(&c), "Honorer");
        jalankan(&c, &cloud_kontrak_statements(&kontrak_event("k2", "g1", "GTY", "", "2027-01-01"), ""));
        jalankan(&c, &cloud_kontrak_statements(&kontrak_event("k1", "g1", "GTT", "", "2026-01-01"), ""));
        assert_eq!(status_guru(&c), "GTY", "cermin = kontrak terakhir, apa pun urutan tiba");
        // Simpan guru dari perangkat lama menimpa status, cermin mengembalikannya.
        c.execute("UPDATE guru_data SET status_kepegawaian = 'Honorer' WHERE id_guru = 'g1';", []).unwrap();
        jalankan(&c, &[cloud_cermin_guru("g1")]);
        assert_eq!(status_guru(&c), "GTY");
        // Gaji memakai tanggal periode: sebelum k2 mulai masih GTT.
        let kini = |tanggal: &str| status_kini(&c, tanggal).unwrap();
        assert_eq!(kini("2026-08-31").get("g1").map(String::as_str), Some("GTT"));
        assert_eq!(kini("2027-01-31").get("g1").map(String::as_str), Some("GTY"));
        assert_eq!(kini("2025-12-31").get("g1").map(String::as_str), Some("GTY"), "sebelum kontrak pertama: guru_data (keputusan B)");
        assert!(!kini("2026-08-31").contains_key("s1"), "siswa tidak ikut");
        assert_eq!(kini("2026-08-31").get("t1").map(String::as_str), Some(""));
        // Pembatalan k2: cermin kembali ke k1; event ganda tidak menggandakan baris.
        let batal = kontrak_event("batal-k2", "g1", "Pembatalan", "k2", "2027-01-01");
        jalankan(&c, &cloud_kontrak_statements(&batal, ""));
        jalankan(&c, &cloud_kontrak_statements(&batal, ""));
        assert_eq!(status_guru(&c), "GTT");
        let jumlah: i64 = c.query_row("SELECT COUNT(*) FROM hr_kontrak;", [], |r| r.get(0)).unwrap();
        assert_eq!(jumlah, 3);
        // Semua kontrak dibatalkan: guru_data tetap (keputusan A).
        jalankan(&c, &cloud_kontrak_statements(&kontrak_event("batal-k1", "g1", "Pembatalan", "k1", "2026-01-01"), ""));
        assert_eq!(status_guru(&c), "GTT");
        // Status di luar CHECK tidak menghasilkan statement.
        assert!(cloud_kontrak_statements(&kontrak_event("k9", "g1", "Kontrak", "", "2026-01-01"), "").is_empty());
        // Tendik ber-PTT: status kini dari kontrak, guru_data tidak ada.
        jalankan(&c, &cloud_kontrak_statements(&kontrak_event("k3", "t1", "PTT", "", "2026-01-01"), ""));
        assert_eq!(kini("2026-08-31").get("t1").map(String::as_str), Some("PTT"));
    }

    #[test]
    fn hris_tugas_berlaku_dan_batal() {
        let c = hub_kontrak();
        let tugas = |id: &str, jenis: &str, mulai: &str, selesai: &str| {
            json!({ "id_tugas": id, "id_karyawan": "t1", "id_jenis": jenis, "unit": "", "tahun_ajaran": "2026/2027", "id_rombel": "", "nomor_sk": "", "tanggal_sk": "", "ekuivalen_jp": null, "tanggal_mulai": mulai, "tanggal_selesai": selesai, "dicatat_oleh": "tu" })
        };
        jalankan(&c, &cloud_tugas_statements(&tugas("t-a", "tgs-piket", "2026-07-13", ""), ""));
        jalankan(&c, &cloud_tugas_statements(&tugas("t-b", "tgs-kalab", "2026-07-13", "2026-07-31"), ""));
        // Baris wali kelas hanya pembawa SK, tidak memberi tugas sendiri.
        jalankan(&c, &cloud_tugas_statements(&tugas("t-c", "tgs-wali-kelas", "2026-07-13", ""), ""));
        let agustus = tugas_berlaku(&c, "2026-08-01", "2026-08-31").unwrap();
        assert_eq!(agustus.get("t1"), Some(&vec!["tgs-piket".to_owned()]));
        assert_eq!(agustus.get("g1"), Some(&vec!["tgs-wali-kelas".to_owned()]), "wali kelas dari rombel");
        let juli = tugas_berlaku(&c, "2026-07-01", "2026-07-31").unwrap();
        assert_eq!(juli.get("t1"), Some(&vec!["tgs-kalab".to_owned(), "tgs-piket".to_owned()]));
        let juni = tugas_berlaku(&c, "2026-06-01", "2026-06-30").unwrap();
        assert_eq!(juni.get("t1"), Some(&vec!["tgs-wali-kelas".to_owned()]), "semester Genap r0 beririsan Juni");
        // Batal dua kali: alasan pertama yang bertahan.
        jalankan(&c, &cloud_batal_tugas_statements(&json!({"id_tugas": "t-a", "dibatalkan_oleh": "tu", "alasan_batal": "salah input"}), ""));
        jalankan(&c, &cloud_batal_tugas_statements(&json!({"id_tugas": "t-a", "dibatalkan_oleh": "x", "alasan_batal": "kedua"}), ""));
        let alasan: String = c.query_row("SELECT alasan_batal FROM hr_tugas_tambahan WHERE id_tugas = 't-a';", [], |r| r.get(0)).unwrap();
        assert_eq!(alasan, "salah input");
        // Tugas batal tidak berubah oleh save yang telat.
        jalankan(&c, &cloud_tugas_statements(&tugas("t-a", "tgs-piket", "2026-07-13", "2026-12-31"), ""));
        let selesai: Option<String> = c.query_row("SELECT tanggal_selesai FROM hr_tugas_tambahan WHERE id_tugas = 't-a';", [], |r| r.get(0)).unwrap();
        assert_eq!(selesai, None);
        assert!(!tugas_berlaku(&c, "2026-08-01", "2026-08-31").unwrap().contains_key("t1"));
    }
}
