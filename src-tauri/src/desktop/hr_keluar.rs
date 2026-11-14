//! HRIS Fase 4 (`prd-hris.md` §22): surat peringatan dan pegawai keluar.
//!
//! `hr_sp`, `hr_keluar`, `hr_keluar_rincian`, dan `hr_keluar_alasan` KHUSUS
//! CLOUD (Q-73): dibaca dan ditulis lewat `TursoClient`, tidak pernah masuk
//! SQLite perangkat, snapshot, atau outbox. Yang tersinkron hanya
//! `master_data.id_keluar`, ditulis transaksi cloud Berlakukan/Batalkan (4b).
//! Tanpa koneksi, command mengembalikan `hris_cloud::PESAN_LURING`.
//!
//! Kembaran TS: aturan dan SQL di `src/lib/validations/hr-keluar.ts`, penulisan
//! di `src/lib/services/hr-keluar.ts`. Vektornya
//! `validations/hr-keluar.vektor.json`; teks SQL dibandingkan harfiah oleh
//! `hr-keluar.test.ts`.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use super::hari_kerja::tanggal_valid;
use super::hr_pengajuan::{dalam_cakupan, UNIT_PERSONIL_SQL};
use super::hris::{new_id, HARI_INI_SQL, NOMOR_MAKS};
use super::inventory::payload_text;
use super::models::{CommandError, OperatorUser};
use super::time_policy::add_days;
use super::turso::{Statement, TursoClient};

// ── Alasan keluar bawaan (seed cloud v70) ──

const ALASAN_BAWAAN_JSON: &str = include_str!("../../../src/lib/validations/hr-keluar-alasan-bawaan.json");

/// Satu alasan keluar bawaan. Pengali dalam persen dari kelipatan UP/UPMK.
#[derive(Debug, Clone, Deserialize)]
pub struct AlasanBawaan {
    pub id_alasan: String,
    pub nama: String,
    pub pengali_up: i64,
    pub pengali_upmk: i64,
    pub uph: bool,
    pub kompensasi_pkwt: bool,
    pub uang_pisah: bool,
    pub dasar_hukum: Option<String>,
}

pub fn alasan_bawaan() -> Vec<AlasanBawaan> {
    serde_json::from_str(ALASAN_BAWAAN_JSON).expect("hr-keluar-alasan-bawaan.json sah")
}

/// Alasan yang sudah disunting tidak ditimpa. Cermin `SEED_ALASAN_SQL`.
pub const SEED_ALASAN_SQL: &str = "INSERT OR IGNORE INTO hr_keluar_alasan (id_alasan, nama, pengali_up, pengali_upmk, uph, kompensasi_pkwt, uang_pisah, dasar_hukum) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8);";

/// Argumen `SEED_ALASAN_SQL`. Cermin `seedAlasanArgs`.
pub fn seed_alasan_args(a: &AlasanBawaan) -> Vec<Value> {
    vec![
        json!(a.id_alasan),
        json!(a.nama),
        json!(a.pengali_up),
        json!(a.pengali_upmk),
        json!(i64::from(a.uph)),
        json!(i64::from(a.kompensasi_pkwt)),
        json!(i64::from(a.uang_pisah)),
        json!(a.dasar_hukum),
    ]
}

// ── Surat peringatan: aturan murni (§22.2.1) ──

/// WAJIB sama dengan CHECK `hr_sp.tingkat`.
pub const TINGKAT_SP: [&str; 3] = ["SP1", "SP2", "SP3"];
pub const MAKS_PELANGGARAN: usize = 2000;
pub const MAKS_TEKS_SP: usize = 1000;
pub const MAKS_PENANDA: usize = 120;
pub const MAKS_NIP_PENANDA: usize = 30;

pub const PESAN_DIRI_SENDIRI: &str = "Tindakan ini tidak bisa dilakukan untuk diri sendiri.";
pub const PESAN_DI_LUAR_CAKUPAN: &str = "Pegawai ini di luar unit Anda.";
pub const PESAN_BUTUH_SP3: &str = "SP3 hanya bisa dibuat atau diubah pemegang izin Terbitkan SP3.";

fn panjang(teks: &str) -> usize {
    teks.chars().count()
}

fn teks_opsional(draft: &Value, kunci: &str, label: &str, maks: usize) -> Result<Option<String>, String> {
    match payload_text(draft, kunci) {
        Some(t) if panjang(&t) > maks => Err(format!("{label} maksimal {maks} karakter.")),
        lain => Ok(lain),
    }
}

fn teks_wajib(draft: &Value, kunci: &str, label: &str, maks: usize) -> Result<String, String> {
    teks_opsional(draft, kunci, label, maks)?.ok_or_else(|| format!("{label} wajib diisi."))
}

/// Cermin `akhirMasaSp`: hari terakhir SP berlaku (inklusif).
pub fn akhir_masa_sp(tanggal: &str, masa_bulan: i64) -> Option<String> {
    let akhir = super::hris::tambah_bulan(tanggal, masa_bulan)?;
    add_days(&akhir, -1).ok()
}

/// Cermin `statusSp`. Tidak disimpan.
pub fn status_sp(tanggal: &str, berlaku_sampai: &str, dicabut: bool, hari_ini: &str) -> &'static str {
    if dicabut {
        "Dicabut"
    } else if tanggal <= hari_ini && hari_ini <= berlaku_sampai {
        "Berlaku"
    } else {
        "Berakhir"
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct SpRingkas {
    pub tingkat: String,
    pub tanggal: String,
    pub berlaku_sampai: String,
    pub dicabut: bool,
}

/// Cermin `usulanTingkat`: SP Berlaku tertinggi pada `tanggal` + 1, maksimal
/// SP3. Nilai kedua benar bila SP3 masih Berlaku (saatnya proses keluar).
pub fn usulan_tingkat(sp: &[SpRingkas], tanggal: &str) -> (&'static str, bool) {
    let tertinggi = sp
        .iter()
        .filter(|s| status_sp(&s.tanggal, &s.berlaku_sampai, s.dicabut, tanggal) == "Berlaku")
        .filter_map(|s| TINGKAT_SP.iter().position(|t| *t == s.tingkat))
        .max();
    match tertinggi {
        None => ("SP1", false),
        Some(0) => ("SP2", false),
        Some(1) => ("SP3", false),
        Some(_) => ("SP3", true),
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct SpSah {
    pub id_sp: Option<String>,
    pub id_karyawan: String,
    pub tingkat: String,
    pub tanggal: String,
    pub nomor: Option<String>,
    pub pelanggaran: String,
    pub harapan: Option<String>,
    pub alasan_tingkat: Option<String>,
    pub penanda_nama: String,
    pub penanda_jabatan: String,
    pub penanda_nip: Option<String>,
}

/// Cermin `validasiSp`. Usulan tingkat, tanggal masuk, dan wewenang diperiksa
/// pemanggil.
pub fn validasi_sp(draft: &Value, hari_ini: &str) -> Result<SpSah, String> {
    let id_karyawan = payload_text(draft, "id_karyawan").ok_or("Pegawai wajib dipilih.")?;
    let tingkat = payload_text(draft, "tingkat")
        .filter(|t| TINGKAT_SP.contains(&t.as_str()))
        .ok_or("Tingkat SP tidak dikenal.")?;
    let tanggal = payload_text(draft, "tanggal")
        .filter(|t| tanggal_valid(t))
        .ok_or("Tanggal SP tidak valid.")?;
    if tanggal.as_str() > hari_ini {
        return Err("Tanggal SP tidak boleh di masa depan.".into());
    }
    Ok(SpSah {
        id_sp: payload_text(draft, "id_sp"),
        id_karyawan,
        tingkat,
        tanggal,
        nomor: teks_opsional(draft, "nomor", "Nomor surat", NOMOR_MAKS)?,
        pelanggaran: teks_wajib(draft, "pelanggaran", "Pelanggaran", MAKS_PELANGGARAN)?,
        harapan: teks_opsional(draft, "harapan", "Perbaikan yang diminta", MAKS_TEKS_SP)?,
        alasan_tingkat: teks_opsional(draft, "alasan_tingkat", "Alasan tingkat", MAKS_TEKS_SP)?,
        penanda_nama: teks_wajib(draft, "penanda_nama", "Nama penanda tangan", MAKS_PENANDA)?,
        penanda_jabatan: teks_wajib(draft, "penanda_jabatan", "Jabatan penanda tangan", MAKS_PENANDA)?,
        penanda_nip: teks_opsional(draft, "penanda_nip", "NIP penanda tangan", MAKS_NIP_PENANDA)?,
    })
}

/// Cermin `periksaTingkat`: tingkat lain dari usulan wajib beralasan.
pub fn periksa_tingkat(tingkat: &str, usulan: &str, alasan: Option<&str>) -> Result<(), String> {
    if tingkat != usulan && alasan.is_none() {
        return Err(format!("Tingkat berbeda dari usulan ({usulan}); alasannya wajib diisi."));
    }
    Ok(())
}

/// Wewenang dari SESI (§22.4), cermin `periksaWewenangSp`. `boleh_sp3` hanya
/// dinilai untuk tingkat SP3; cabut memanggilnya dengan tingkat kosong.
pub fn periksa_wewenang_sp(tingkat: &str, sendiri: bool, dalam_cakupan: bool, boleh_sp3: bool) -> Result<(), String> {
    if sendiri {
        return Err(PESAN_DIRI_SENDIRI.into());
    }
    if !dalam_cakupan {
        return Err(PESAN_DI_LUAR_CAKUPAN.into());
    }
    if tingkat == "SP3" && !boleh_sp3 {
        return Err(PESAN_BUTUH_SP3.into());
    }
    Ok(())
}

/// Cermin `masaSpBerlaku`: nilai kunci `hr_sp_masa_bulan`; kosong atau rusak = bawaan.
pub fn masa_sp_berlaku(nilai: Option<&str>) -> i64 {
    super::hris::angka_pengaturan(nilai, super::hris::ATURAN_SP_MASA)
}

// ── SQL, dieja harfiah sama di `validations/hr-keluar.ts` ──

pub const SP_PEGAWAI_SQL: &str = "SELECT id_sp, id_karyawan, tingkat, usulan_tingkat, COALESCE(alasan_tingkat, '') AS alasan_tingkat, tanggal, masa_bulan, berlaku_sampai, COALESCE(nomor, '') AS nomor, pelanggaran, COALESCE(harapan, '') AS harapan, penanda_nama, penanda_jabatan, COALESCE(penanda_nip, '') AS penanda_nip, COALESCE(unit, '') AS unit, dicatat_oleh, created_at, COALESCE(diubah_oleh, '') AS diubah_oleh, COALESCE(diubah_pada, '') AS diubah_pada, COALESCE(dicabut_oleh, '') AS dicabut_oleh, COALESCE(dicabut_pada, '') AS dicabut_pada, COALESCE(alasan_cabut, '') AS alasan_cabut FROM hr_sp WHERE id_karyawan = ?1 ORDER BY tanggal DESC, created_at DESC, id_sp DESC\n-- batas: surat peringatan satu pegawai\n;";
pub const SP_SATU_SQL: &str = "SELECT id_sp, id_karyawan, tingkat, tanggal, COALESCE(unit, '') AS unit, COALESCE(dicabut_pada, '') AS dicabut_pada FROM hr_sp WHERE id_sp = ?1 LIMIT 1;";
/// Pegawai (bukan siswa) sasaran SP, dari cloud.
pub const PEGAWAI_SP_SQL: &str = "SELECT m.id_unik, COALESCE(m.status_aktif, 'Aktif') AS status_aktif, COALESCE(m.tanggal_daftar, '') AS tanggal_daftar, COALESCE(m.unit, '') AS unit FROM master_data m WHERE m.id_unik = ?1 AND LOWER(TRIM(COALESCE(m.jenis_personil, ''))) <> 'siswa' AND NOT EXISTS (SELECT 1 FROM siswa_data sd WHERE sd.id_siswa = m.id_unik) LIMIT 1;";
pub const MASA_SP_SQL: &str = "SELECT value FROM setting_gex_system WHERE key = 'hr_sp_masa_bulan' LIMIT 1;";
/// Nomor sama dipakai SP lain: ditandai, tidak ditolak (Q-74).
pub const NOMOR_KEMBAR_SQL: &str = "SELECT COUNT(*) AS jumlah FROM hr_sp WHERE nomor = ?1 AND id_sp <> ?2;";
pub const SIMPAN_SP_SQL: &str = "INSERT INTO hr_sp (id_sp, id_karyawan, tingkat, usulan_tingkat, alasan_tingkat, tanggal, masa_bulan, berlaku_sampai, nomor, pelanggaran, harapan, penanda_nama, penanda_jabatan, penanda_nip, unit, dicatat_oleh, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, datetime('now'));";
/// Ubah teks selama belum dicabut; tingkat dan tanggal terkunci.
pub const UBAH_SP_SQL: &str = "UPDATE hr_sp SET nomor = ?2, pelanggaran = ?3, harapan = ?4, penanda_nama = ?5, penanda_jabatan = ?6, penanda_nip = ?7, diubah_oleh = ?8, diubah_pada = datetime('now') WHERE id_sp = ?1 AND dicabut_pada IS NULL;";
/// Sekali: baris yang sudah dicabut tidak tersentuh lagi.
pub const CABUT_SP_SQL: &str = "UPDATE hr_sp SET dicabut_oleh = ?2, dicabut_pada = datetime('now'), alasan_cabut = ?3 WHERE id_sp = ?1 AND dicabut_pada IS NULL;";

pub const PESAN_SP_DICABUT: &str = "SP ini sudah dicabut.";

// ── Akses cloud ──

fn galat(pesan: impl Into<String>) -> CommandError {
    CommandError::new("VALIDATION_ERROR", pesan)
}

fn teks(baris: &Value, kunci: &str) -> String {
    match baris.get(kunci) {
        Some(Value::String(s)) => s.clone(),
        Some(Value::Number(n)) => n.to_string(),
        _ => String::new(),
    }
}

fn angka(baris: &Value, kunci: &str) -> i64 {
    match baris.get(kunci) {
        Some(Value::Number(n)) => n.as_i64().unwrap_or(0),
        Some(Value::String(s)) => s.parse().unwrap_or(0),
        _ => 0,
    }
}

async fn baris(client: &TursoClient, sql: &str, args: Vec<Value>) -> Result<Vec<Value>, CommandError> {
    Ok(client
        .query_one(sql, args)
        .await?
        .to_objects()
        .into_iter()
        .map(|b| json!(b))
        .collect())
}

async fn satu(client: &TursoClient, sql: &str, args: Vec<Value>) -> Result<Option<Value>, CommandError> {
    Ok(baris(client, sql, args).await?.into_iter().next())
}

async fn hari_ini(client: &TursoClient) -> Result<String, CommandError> {
    satu(client, HARI_INI_SQL, vec![])
        .await?
        .map(|b| teks(&b, "hari_ini"))
        .filter(|t| !t.is_empty())
        .ok_or_else(CommandError::internal)
}

async fn masa_sp(client: &TursoClient) -> Result<i64, CommandError> {
    let nilai = satu(client, MASA_SP_SQL, vec![]).await?.map(|b| teks(&b, "value"));
    Ok(masa_sp_berlaku(nilai.as_deref()))
}

fn punya(operator: &OperatorUser, izin: &str) -> bool {
    operator.is_superadmin || operator.permissions.iter().any(|p| p == izin)
}

fn tautan(operator: &OperatorUser) -> String {
    operator.id_karyawan.as_deref().unwrap_or("").trim().to_owned()
}

/// "Diri sendiri" dan cakupan unit dari SESI: `id_karyawan` tertaut sesi dan
/// unitnya di cloud (`UNIT_PERSONIL_SQL`), bukan dari payload.
async fn wewenang(
    client: &TursoClient,
    operator: &OperatorUser,
    id_karyawan: &str,
    unit_sasaran: &str,
    tingkat: &str,
) -> Result<(), CommandError> {
    let sesi = tautan(operator);
    let unit_akun = if sesi.is_empty() {
        String::new()
    } else {
        satu(client, UNIT_PERSONIL_SQL, vec![json!(sesi)])
            .await?
            .map(|b| teks(&b, "unit"))
            .unwrap_or_default()
    };
    periksa_wewenang_sp(
        tingkat,
        !sesi.is_empty() && sesi == id_karyawan,
        dalam_cakupan(punya(operator, "hr.scope.all"), &unit_akun, unit_sasaran),
        punya(operator, "hr.warning.sp3"),
    )
    .map_err(galat)
}

fn ringkas(daftar: &[Value]) -> Vec<SpRingkas> {
    daftar
        .iter()
        .map(|b| SpRingkas {
            tingkat: teks(b, "tingkat"),
            tanggal: teks(b, "tanggal"),
            berlaku_sampai: teks(b, "berlaku_sampai"),
            dicabut: !teks(b, "dicabut_pada").is_empty(),
        })
        .collect()
}

/// `desktop_hr_warnings`: riwayat SP satu pegawai dengan status turunan,
/// usulan tingkat pada hari ini, dan masa SP yang berlaku.
pub async fn daftar_sp(client: &TursoClient, id_karyawan: &str) -> Result<Value, CommandError> {
    client.ensure_schema_current().await?;
    let id = id_karyawan.trim();
    if id.is_empty() {
        return Err(galat("Pegawai wajib dipilih."));
    }
    let hari_ini = hari_ini(client).await?;
    let mut daftar = baris(client, SP_PEGAWAI_SQL, vec![json!(id)]).await?;
    let (tingkat, sp3_berlaku) = usulan_tingkat(&ringkas(&daftar), &hari_ini);
    for b in &mut daftar {
        let status = status_sp(
            &teks(b, "tanggal"),
            &teks(b, "berlaku_sampai"),
            !teks(b, "dicabut_pada").is_empty(),
            &hari_ini,
        );
        b["status"] = json!(status);
        b["masa_bulan"] = json!(angka(b, "masa_bulan"));
    }
    Ok(json!({
        "sp": daftar,
        "usulan": { "tingkat": tingkat, "sp3_berlaku": sp3_berlaku },
        "masa_bulan": masa_sp(client).await?,
        "hari_ini": hari_ini,
    }))
}

async fn nomor_kembar(client: &TursoClient, nomor: Option<&str>, id_sp: &str) -> Result<bool, CommandError> {
    let Some(nomor) = nomor else {
        return Ok(false);
    };
    Ok(satu(client, NOMOR_KEMBAR_SQL, vec![json!(nomor), json!(id_sp)])
        .await?
        .is_some_and(|b| angka(&b, "jumlah") > 0))
}

/// `desktop_hr_warning_save`: SP baru, atau ubah teks SP yang belum dicabut.
pub async fn simpan_sp(client: &TursoClient, operator: &OperatorUser, draft: &Value) -> Result<Value, CommandError> {
    client.ensure_schema_current().await?;
    let hari_ini = hari_ini(client).await?;
    let sah = validasi_sp(draft, &hari_ini).map_err(galat)?;
    if let Some(id_sp) = &sah.id_sp {
        let lama = satu(client, SP_SATU_SQL, vec![json!(id_sp)])
            .await?
            .ok_or_else(|| galat("SP tidak ditemukan."))?;
        if !teks(&lama, "dicabut_pada").is_empty() {
            return Err(galat(PESAN_SP_DICABUT));
        }
        if teks(&lama, "id_karyawan") != sah.id_karyawan
            || teks(&lama, "tingkat") != sah.tingkat
            || teks(&lama, "tanggal") != sah.tanggal
        {
            return Err(galat("Tingkat dan tanggal SP tidak bisa diubah. Cabut SP ini lalu buat yang baru."));
        }
        wewenang(client, operator, &sah.id_karyawan, &teks(&lama, "unit"), &sah.tingkat).await?;
        let hasil = client
            .execute_pipeline(vec![Statement::new(
                UBAH_SP_SQL,
                vec![
                    json!(id_sp),
                    json!(sah.nomor),
                    json!(sah.pelanggaran),
                    json!(sah.harapan),
                    json!(sah.penanda_nama),
                    json!(sah.penanda_jabatan),
                    json!(sah.penanda_nip),
                    json!(operator.username),
                ],
            )])
            .await?;
        if hasil.first().map_or(0, |h| h.rows_affected) == 0 {
            return Err(galat(PESAN_SP_DICABUT));
        }
        let kembar = nomor_kembar(client, sah.nomor.as_deref(), id_sp).await?;
        return Ok(json!({ "sukses": true, "id_sp": id_sp, "nomor_kembar": kembar }));
    }
    let pegawai = satu(client, PEGAWAI_SP_SQL, vec![json!(sah.id_karyawan)])
        .await?
        .ok_or_else(|| galat(super::hris_cloud::PESAN_PEGAWAI_BELUM_DI_CLOUD))?;
    let unit = teks(&pegawai, "unit");
    wewenang(client, operator, &sah.id_karyawan, &unit, &sah.tingkat).await?;
    if teks(&pegawai, "status_aktif") != "Aktif" {
        return Err(galat("SP hanya untuk pegawai aktif."));
    }
    let masuk = teks(&pegawai, "tanggal_daftar");
    if !masuk.is_empty() && sah.tanggal < masuk {
        return Err(galat("Tanggal SP tidak boleh sebelum tanggal masuk pegawai."));
    }
    let riwayat = baris(client, SP_PEGAWAI_SQL, vec![json!(sah.id_karyawan)]).await?;
    let (usulan, _) = usulan_tingkat(&ringkas(&riwayat), &sah.tanggal);
    periksa_tingkat(&sah.tingkat, usulan, sah.alasan_tingkat.as_deref()).map_err(galat)?;
    let masa_bulan = masa_sp(client).await?;
    let berlaku_sampai = akhir_masa_sp(&sah.tanggal, masa_bulan).ok_or_else(|| galat("Tanggal SP tidak valid."))?;
    let id_sp = new_id("sp-");
    client
        .execute_pipeline(vec![Statement::new(
            SIMPAN_SP_SQL,
            vec![
                json!(id_sp),
                json!(sah.id_karyawan),
                json!(sah.tingkat),
                json!(usulan),
                json!(sah.alasan_tingkat.as_ref().filter(|_| sah.tingkat != usulan)),
                json!(sah.tanggal),
                json!(masa_bulan),
                json!(berlaku_sampai),
                json!(sah.nomor),
                json!(sah.pelanggaran),
                json!(sah.harapan),
                json!(sah.penanda_nama),
                json!(sah.penanda_jabatan),
                json!(sah.penanda_nip),
                json!(unit),
                json!(operator.username),
            ],
        )])
        .await?;
    let kembar = nomor_kembar(client, sah.nomor.as_deref(), &id_sp).await?;
    Ok(json!({ "sukses": true, "id_sp": id_sp, "nomor_kembar": kembar }))
}

/// `desktop_hr_warning_revoke`: cabut dengan alasan, sekali.
pub async fn cabut_sp(client: &TursoClient, operator: &OperatorUser, id_sp: &str, alasan: &str) -> Result<Value, CommandError> {
    let id_sp = id_sp.trim();
    let alasan = teks_wajib(&json!({ "alasan": alasan }), "alasan", "Alasan pencabutan", MAKS_TEKS_SP).map_err(galat)?;
    client.ensure_schema_current().await?;
    let lama = satu(client, SP_SATU_SQL, vec![json!(id_sp)])
        .await?
        .ok_or_else(|| galat("SP tidak ditemukan."))?;
    if !teks(&lama, "dicabut_pada").is_empty() {
        return Err(galat(PESAN_SP_DICABUT));
    }
    wewenang(client, operator, &teks(&lama, "id_karyawan"), &teks(&lama, "unit"), "").await?;
    let hasil = client
        .execute_pipeline(vec![Statement::new(
            CABUT_SP_SQL,
            vec![json!(id_sp), json!(operator.username), json!(alasan)],
        )])
        .await?;
    if hasil.first().map_or(0, |h| h.rows_affected) == 0 {
        return Err(galat(PESAN_SP_DICABUT));
    }
    Ok(json!({ "sukses": true }))
}

#[cfg(test)]
mod tests {
    //! Vektor sama dengan `validations/hr-keluar.test.ts`.
    use super::*;

    const VEKTOR: &str = include_str!("../../../src/lib/validations/hr-keluar.vektor.json");

    fn vektor() -> Value {
        serde_json::from_str(VEKTOR).expect("hr-keluar.vektor.json sah")
    }

    #[test]
    fn hr_keluar_vektor_masa_dan_status() {
        let v = vektor();
        for k in v["akhir_masa"].as_array().expect("akhir_masa") {
            let hasil = akhir_masa_sp(k["tanggal"].as_str().unwrap(), k["masa_bulan"].as_i64().unwrap());
            assert_eq!(json!(hasil), k["hasil"], "{k}");
        }
        for k in v["status"].as_array().expect("status") {
            let hasil = status_sp(
                k["tanggal"].as_str().unwrap(),
                k["berlaku_sampai"].as_str().unwrap(),
                k["dicabut"].as_bool().unwrap(),
                k["hari_ini"].as_str().unwrap(),
            );
            assert_eq!(hasil, k["hasil"].as_str().unwrap(), "{k}");
        }
        for k in v["masa_setting"].as_array().expect("masa_setting") {
            assert_eq!(json!(masa_sp_berlaku(k["nilai"].as_str())), k["hasil"], "{k}");
        }
    }

    #[test]
    fn hr_keluar_vektor_usulan_tingkat() {
        for k in vektor()["usulan"].as_array().expect("usulan") {
            let sp: Vec<SpRingkas> = serde_json::from_value(k["sp"].clone()).expect("sp");
            let (tingkat, sp3) = usulan_tingkat(&sp, k["tanggal"].as_str().unwrap());
            assert_eq!(tingkat, k["tingkat"].as_str().unwrap(), "{}", k["nama"]);
            assert_eq!(sp3, k["sp3_berlaku"].as_bool().unwrap(), "{}", k["nama"]);
        }
    }

    #[test]
    fn hr_keluar_vektor_validasi_dan_wewenang() {
        let v = vektor();
        for k in v["validasi"].as_array().expect("validasi") {
            let hasil = validasi_sp(&k["draft"], k["hari_ini"].as_str().unwrap());
            match k["galat"].as_str() {
                Some(pesan) => assert_eq!(hasil.err().as_deref(), Some(pesan), "{}", k["nama"]),
                None => assert_eq!(json!(hasil.expect("sah")), k["hasil"], "{}", k["nama"]),
            }
        }
        for k in v["tingkat"].as_array().expect("tingkat") {
            let hasil = periksa_tingkat(
                k["tingkat"].as_str().unwrap(),
                k["usulan"].as_str().unwrap(),
                k["alasan"].as_str(),
            );
            assert_eq!(hasil.err().as_deref(), k["galat"].as_str(), "{k}");
        }
        for k in v["wewenang"].as_array().expect("wewenang") {
            let hasil = periksa_wewenang_sp(
                k["tingkat"].as_str().unwrap(),
                k["sendiri"].as_bool().unwrap(),
                k["dalam_cakupan"].as_bool().unwrap(),
                k["boleh_sp3"].as_bool().unwrap(),
            );
            assert_eq!(hasil.err().as_deref(), k["galat"].as_str(), "{}", k["nama"]);
        }
    }

    #[test]
    fn hr_keluar_alasan_bawaan_sah() {
        let alasan = alasan_bawaan();
        assert_eq!(alasan.len(), 9);
        assert!(alasan.iter().all(|a| (0..=1000).contains(&a.pengali_up) && (0..=1000).contains(&a.pengali_upmk)));
        assert_eq!(seed_alasan_args(&alasan[0]).len(), 8);
    }

    fn operator(id_karyawan: Option<&str>, izin: &[&str]) -> OperatorUser {
        OperatorUser {
            id: 2,
            kode_operator: "OP2".into(),
            nama_operator: "Uji".into(),
            username: "uji".into(),
            role: "Admin".into(),
            role_id: 2,
            role_key: "uji".into(),
            is_superadmin: false,
            permissions: izin.iter().map(|i| (*i).to_owned()).collect(),
            permission_revision: 1,
            require_scan_photo: false,
            totp_enabled: false,
            require_scan_ip_allowlist: false,
            id_karyawan: id_karyawan.map(str::to_owned),
            login_at: None,
        }
    }

    /// Cloud lewat `TursoClient::local_file` di atas `ensure_schema`: SP3
    /// tanpa izin ditolak, unit lain ditolak, diri sendiri ditolak, tingkat
    /// terkunci saat diubah, dan cabut hanya sekali.
    #[test]
    fn hr_keluar_sp_cloud() {
        let runtime = tokio::runtime::Builder::new_current_thread().build().expect("runtime uji");
        runtime.block_on(async {
            let dir = tempfile::tempdir().expect("direktori sementara");
            let hub = dir.path().join("sppg-hub.db");
            let client = TursoClient::local_file(
                url::Url::parse("https://hr-keluar.sppg.invalid").expect("origin uji"),
                &hub,
                reqwest::Client::new(),
            );
            client.ensure_schema().await.expect("provisioning lokal");
            let c = rusqlite::Connection::open(&hub).expect("buka hub");
            c.execute_batch(
                "INSERT INTO master_data (id_unik, kode_karyawan, nama, divisi, id_shift, jenis_personil, unit, tanggal_daftar, status_aktif) VALUES
                   ('P1', 'K1', 'Ani', 'Guru', 1, 'GURU', 'SMP', '2020-01-01', 'Aktif'),
                   ('P2', 'K2', 'Budi', 'Guru', 1, 'GURU', 'SMA', '2020-01-01', 'Aktif'),
                   ('KS', 'K3', 'Kepala SMP', 'Guru', 1, 'GURU', 'SMP', '2020-01-01', 'Aktif');",
            )
            .expect("pegawai");
            assert_eq!(
                c.query_row("SELECT COUNT(*) FROM hr_keluar_alasan;", [], |r| r.get::<_, i64>(0)).expect("alasan"),
                9
            );
            let kepsek = operator(Some("KS"), &["hr.warning.view", "hr.warning.manage"]);
            let draft = |id: &str, tingkat: &str| {
                json!({
                    "id_karyawan": id, "tingkat": tingkat, "tanggal": "2026-01-10",
                    "pelanggaran": "Terlambat berulang", "penanda_nama": "Kepala SMP",
                    "penanda_jabatan": "Kepala SMP", "alasan_tingkat": "Pelanggaran berat",
                })
            };
            let galat_dari = |h: Result<Value, CommandError>| h.err().map(|e| e.message).unwrap_or_default();

            assert_eq!(galat_dari(simpan_sp(&client, &kepsek, &draft("P2", "SP1")).await), PESAN_DI_LUAR_CAKUPAN);
            assert_eq!(galat_dari(simpan_sp(&client, &kepsek, &draft("KS", "SP1")).await), PESAN_DIRI_SENDIRI);
            assert_eq!(galat_dari(simpan_sp(&client, &kepsek, &draft("P1", "SP3")).await), PESAN_BUTUH_SP3);
            let mut tanpa_alasan = draft("P1", "SP2");
            tanpa_alasan["alasan_tingkat"] = json!("");
            assert_eq!(
                galat_dari(simpan_sp(&client, &kepsek, &tanpa_alasan).await),
                "Tingkat berbeda dari usulan (SP1); alasannya wajib diisi."
            );

            let baru = simpan_sp(&client, &kepsek, &draft("P1", "SP1")).await.expect("SP1");
            let id_sp = baru["id_sp"].as_str().expect("id").to_owned();
            let (unit, masa, sampai, alasan_tingkat): (String, i64, String, Option<String>) = c
                .query_row(
                    "SELECT unit, masa_bulan, berlaku_sampai, alasan_tingkat FROM hr_sp WHERE id_sp = ?1;",
                    [&id_sp],
                    |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
                )
                .expect("baris SP");
            assert_eq!((unit.as_str(), masa, sampai.as_str()), ("SMP", 6, "2026-07-09"));
            assert_eq!(alasan_tingkat, None, "alasan hanya disimpan bila tingkat beda dari usulan");

            let mut ubah = draft("P1", "SP2");
            ubah["id_sp"] = json!(id_sp);
            assert!(galat_dari(simpan_sp(&client, &kepsek, &ubah).await).starts_with("Tingkat dan tanggal SP"));
            let mut ubah = draft("P1", "SP1");
            ubah["id_sp"] = json!(id_sp);
            ubah["nomor"] = json!("001/SP/SMP/I/2026");
            let hasil = simpan_sp(&client, &kepsek, &ubah).await.expect("ubah teks");
            assert_eq!(hasil["nomor_kembar"], json!(false));

            let daftar = daftar_sp(&client, "P1").await.expect("daftar");
            assert_eq!(daftar["sp"].as_array().map(Vec::len), Some(1));
            assert_eq!(daftar["sp"][0]["nomor"], json!("001/SP/SMP/I/2026"));
            assert_eq!(daftar["masa_bulan"], json!(6));

            let yayasan = operator(None, &["hr.warning.cancel", "hr.scope.all"]);
            assert_eq!(galat_dari(cabut_sp(&client, &yayasan, &id_sp, " ").await), "Alasan pencabutan wajib diisi.");
            cabut_sp(&client, &yayasan, &id_sp, "Salah orang").await.expect("cabut");
            assert_eq!(galat_dari(cabut_sp(&client, &yayasan, &id_sp, "Lagi").await), PESAN_SP_DICABUT);
            assert_eq!(galat_dari(simpan_sp(&client, &kepsek, &ubah).await), PESAN_SP_DICABUT);
            let daftar = daftar_sp(&client, "P1").await.expect("daftar");
            assert_eq!(daftar["sp"][0]["status"], json!("Dicabut"));
            assert_eq!(daftar["usulan"]["tingkat"], json!("SP1"));
        });
    }
}
