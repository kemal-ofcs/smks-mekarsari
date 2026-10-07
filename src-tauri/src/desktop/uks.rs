//! Buku Kunjungan UKS (Fase 4a).
//!
//! `uks_kunjungan` memakai pola `absensi_foto`: ditulis ke SQLite lokal,
//! didorong ke cloud lewat outbox, dan TIDAK PERNAH ditarik ke perangkat lain.
//! Isinya data kesehatan anak, jadi tidak boleh ikut snapshot yang tersalin ke
//! terminal pemindai di lobi. Obat yang diberikan tidak disimpan di sini,
//! melainkan sebagai mutasi inventaris berpenerima Unit "UKS" dengan
//! `id_ref` = nomor kunjungan, sehingga stok dan catatan kunjungan tidak bisa
//! saling bertentangan.
//!
//! Aturan validasi dieja kembar dengan `src/lib/validations/uks.ts`.

use std::collections::HashMap;

use rusqlite::{params, Connection, OptionalExtension, Transaction};
use serde::Deserialize;
use serde_json::{json, Value};

use super::{
    config::DesktopState,
    inventory::{self, MutasiDraft},
    models::CommandError,
    storage, sync,
};

pub const MAKS_BARIS_RIWAYAT: usize = 500;
pub const MAKS_SEDANG_DI_UKS: usize = 200;
pub const MAKS_OBAT_PER_SIMPAN: usize = 20;
/// Kunjungan yang sudah ditutup dan sudah terkirim dihapus dari perangkat
/// setelah sekian hari (keputusan User): data kesehatan tidak menumpuk di HP.
pub const HARI_SIMPAN_LOKAL: i64 = 30;
pub const UNIT_UKS: &str = "UKS";
pub const KEPERLUAN_OBAT: &str = "Kunjungan UKS";

const KOLOM: &str = "id_kunjungan, id_personil, nama_personil, kelas, tanggal, jam_masuk, jam_keluar, keluhan, tindakan, tindak_lanjut, catatan, dicatat_oleh, ditutup_oleh, created_at, updated_at";

/// Cermin `isValidJam`: "HH:MM" 24 jam.
pub fn is_valid_jam(value: &str) -> bool {
    let bytes = value.as_bytes();
    if bytes.len() != 5 || bytes[2] != b':' {
        return false;
    }
    let angka = |a: u8, b: u8| -> Option<u32> {
        (a.is_ascii_digit() && b.is_ascii_digit())
            .then(|| u32::from(a - b'0') * 10 + u32::from(b - b'0'))
    };
    matches!(
        (angka(bytes[0], bytes[1]), angka(bytes[3], bytes[4])),
        (Some(jam), Some(menit)) if jam < 24 && menit < 60
    )
}

fn clean(value: &Option<String>) -> Option<String> {
    value
        .as_deref()
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .map(str::to_owned)
}

fn too_long(value: &Option<String>, max: usize) -> bool {
    value
        .as_deref()
        .is_some_and(|text| text.chars().count() > max)
}

#[derive(Debug, Default, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ObatDraft {
    #[serde(default)]
    pub id_barang: String,
    #[serde(default)]
    pub tempat: String,
    #[serde(default)]
    pub kondisi: Option<String>,
    #[serde(default)]
    pub id_batch: Option<String>,
    #[serde(default)]
    pub jumlah: i64,
}

#[derive(Debug, Default, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BukaDraft {
    #[serde(default)]
    pub id_personil: String,
    #[serde(default)]
    pub tanggal: Option<String>,
    #[serde(default)]
    pub jam_masuk: Option<String>,
    #[serde(default)]
    pub keluhan: String,
    #[serde(default)]
    pub catatan: Option<String>,
    #[serde(default)]
    pub obat: Vec<ObatDraft>,
}

#[derive(Debug, PartialEq)]
pub struct BukaValid {
    pub id_personil: String,
    pub tanggal: Option<String>,
    pub jam_masuk: Option<String>,
    pub keluhan: String,
    pub catatan: Option<String>,
}

/// Cermin `validateBuka`. Tanggal dan jam kosong diisi jam database WIB.
pub fn validate_buka(draft: &BukaDraft, hari_ini: &str) -> Result<BukaValid, String> {
    let id_personil = draft.id_personil.trim().to_owned();
    if id_personil.is_empty() {
        return Err("Pilih personil yang berkunjung.".into());
    }
    let keluhan = draft.keluhan.trim().to_owned();
    if keluhan.is_empty() {
        return Err("Keluhan wajib diisi.".into());
    }
    if keluhan.chars().count() > 500 {
        return Err("Keluhan maksimal 500 karakter.".into());
    }
    let tanggal = clean(&draft.tanggal);
    if let Some(tanggal) = tanggal.as_deref() {
        if !inventory::is_valid_date(tanggal) {
            return Err("Tanggal tidak valid.".into());
        }
        if tanggal > hari_ini {
            return Err("Tanggal tidak boleh melewati hari ini.".into());
        }
    }
    let jam_masuk = clean(&draft.jam_masuk);
    if jam_masuk.as_deref().is_some_and(|jam| !is_valid_jam(jam)) {
        return Err("Jam masuk tidak valid.".into());
    }
    let catatan = clean(&draft.catatan);
    if too_long(&catatan, 500) {
        return Err("Catatan maksimal 500 karakter.".into());
    }
    if draft.obat.len() > MAKS_OBAT_PER_SIMPAN {
        return Err("Sekali simpan maksimal 20 jenis obat.".into());
    }
    Ok(BukaValid {
        id_personil,
        tanggal,
        jam_masuk,
        keluhan,
        catatan,
    })
}

#[derive(Debug, Default, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SimpanDraft {
    #[serde(default)]
    pub jam_keluar: Option<String>,
    #[serde(default)]
    pub tindakan: Option<String>,
    #[serde(default)]
    pub tindak_lanjut: Option<String>,
    #[serde(default)]
    pub catatan: Option<String>,
    #[serde(default)]
    pub obat: Vec<ObatDraft>,
    /// Kotak centang "Kabari wali lewat WhatsApp" (Fase 4b). Hanya berlaku
    /// saat kunjungan ditutup, dan hanya bila sakelar `wa_notify_uks` menyala.
    #[serde(default)]
    pub kabari_wali: bool,
}

#[derive(Debug, PartialEq)]
pub struct SimpanValid {
    pub jam_keluar: Option<String>,
    pub tindakan: Option<String>,
    pub tindak_lanjut: Option<String>,
    pub catatan: Option<String>,
}

/// Cermin `validateSimpan`. Mengisi jam keluar berarti menutup kunjungan, dan
/// menutup kunjungan menuntut tindak lanjut.
pub fn validate_simpan(draft: &SimpanDraft, jam_masuk: &str) -> Result<SimpanValid, String> {
    let jam_keluar = clean(&draft.jam_keluar);
    if let Some(jam) = jam_keluar.as_deref() {
        if !is_valid_jam(jam) {
            return Err("Jam keluar tidak valid.".into());
        }
        if jam < jam_masuk {
            return Err("Jam keluar tidak boleh lebih awal dari jam masuk.".into());
        }
    }
    let tindak_lanjut = clean(&draft.tindak_lanjut);
    if jam_keluar.is_some() && tindak_lanjut.is_none() {
        return Err("Tindak lanjut wajib diisi saat menutup kunjungan.".into());
    }
    if too_long(&tindak_lanjut, 200) {
        return Err("Tindak lanjut maksimal 200 karakter.".into());
    }
    let tindakan = clean(&draft.tindakan);
    if too_long(&tindakan, 500) {
        return Err("Tindakan maksimal 500 karakter.".into());
    }
    let catatan = clean(&draft.catatan);
    if too_long(&catatan, 500) {
        return Err("Catatan maksimal 500 karakter.".into());
    }
    if draft.obat.len() > MAKS_OBAT_PER_SIMPAN {
        return Err("Sekali simpan maksimal 20 jenis obat.".into());
    }
    Ok(SimpanValid {
        jam_keluar,
        tindakan,
        tindak_lanjut,
        catatan,
    })
}

/// Obat yang diberikan menjadi mutasi Keluar Pemakaian berpenerima Unit "UKS".
/// Nama siswa SENGAJA tidak masuk ke mutasi: tabel itu tersalin ke semua
/// perangkat, sedangkan siapa menerima obat apa adalah data kesehatan.
pub fn obat_ke_mutasi(obat: &ObatDraft) -> MutasiDraft {
    MutasiDraft {
        id_barang: obat.id_barang.clone(),
        jenis: "Keluar".into(),
        alasan: "Pemakaian".into(),
        jumlah: obat.jumlah,
        tempat_asal: Some(obat.tempat.clone()),
        kondisi_asal: obat.kondisi.clone(),
        id_batch: obat.id_batch.clone(),
        penerima_tipe: Some("Unit".into()),
        penerima_nama: Some(UNIT_UKS.into()),
        keperluan: Some(KEPERLUAN_OBAT.into()),
        ..MutasiDraft::default()
    }
}

// ── I/O ─────────────────────────────────────────────────────────────────────

fn invalid(message: impl Into<String>) -> CommandError {
    CommandError::new("VALIDATION_ERROR", message)
}

/// Kode khusus supaya UI bisa memberi tahu bahwa kunjungan ini harus diambil
/// dulu dari database, dan berapa lama perangkat belum tersinkron.
fn butuh_salinan() -> CommandError {
    CommandError::new(
        "UKS_BUTUH_SALINAN",
        "Kunjungan ini dicatat di perangkat lain. Hubungkan perangkat ke database untuk mengambil salinannya.",
    )
}

fn butuh_koneksi() -> CommandError {
    CommandError::new(
        "UKS_BUTUH_KONEKSI",
        "Perangkat ini tidak terhubung ke database. Kunjungan dari perangkat lain baru bisa dibuka setelah terhubung.",
    )
}

fn new_id() -> String {
    let mut bytes = [0u8; 16];
    rand_core::RngCore::fill_bytes(&mut rand_core::OsRng, &mut bytes);
    let mut id = String::from("uks-");
    for byte in bytes {
        id.push_str(&format!("{byte:02x}"));
    }
    id
}

fn wib_today(connection: &Connection) -> String {
    connection
        .query_row("SELECT date('now', '+7 hours');", [], |row| row.get(0))
        .unwrap_or_default()
}

fn row_to_json(row: &rusqlite::Row<'_>) -> rusqlite::Result<Value> {
    Ok(json!({
        "id_kunjungan": row.get::<_, String>(0)?,
        "id_personil": row.get::<_, String>(1)?,
        "nama_personil": row.get::<_, String>(2)?,
        "kelas": row.get::<_, Option<String>>(3)?,
        "tanggal": row.get::<_, String>(4)?,
        "jam_masuk": row.get::<_, String>(5)?,
        "jam_keluar": row.get::<_, Option<String>>(6)?,
        "keluhan": row.get::<_, String>(7)?,
        "tindakan": row.get::<_, Option<String>>(8)?,
        "tindak_lanjut": row.get::<_, Option<String>>(9)?,
        "catatan": row.get::<_, Option<String>>(10)?,
        "dicatat_oleh": row.get::<_, String>(11)?,
        "ditutup_oleh": row.get::<_, Option<String>>(12)?,
        "created_at": row.get::<_, String>(13)?,
        "updated_at": row.get::<_, String>(14)?,
    }))
}

fn visit_json(connection: &Connection, id: &str) -> Result<Option<Value>, CommandError> {
    connection
        .query_row(
            &format!("SELECT {KOLOM} FROM uks_kunjungan WHERE id_kunjungan = ?;"),
            params![id],
            row_to_json,
        )
        .optional()
        .map_err(|_| CommandError::internal())
}

fn enqueue_save(
    transaction: &Transaction<'_>,
    client_id: &str,
    id: &str,
) -> Result<(), CommandError> {
    let payload = visit_json(transaction, id)?.ok_or_else(CommandError::internal)?;
    sync::enqueue(
        transaction,
        client_id,
        "uks-visit",
        "save",
        id,
        &payload,
        None,
    )?;
    Ok(())
}

fn give_medicines(
    transaction: &Transaction<'_>,
    client_id: &str,
    dicatat_oleh: &str,
    id_kunjungan: &str,
    obat: &[ObatDraft],
) -> Result<(), CommandError> {
    for item in obat {
        inventory::record_mutation_tx(
            transaction,
            client_id,
            dicatat_oleh,
            &obat_ke_mutasi(item),
            Some(id_kunjungan),
        )?;
    }
    Ok(())
}

pub fn open_visit(
    state: &DesktopState,
    dicatat_oleh: &str,
    draft: Value,
) -> Result<Value, CommandError> {
    let draft: BukaDraft =
        serde_json::from_value(draft).map_err(|_| invalid("Data kunjungan tidak valid."))?;
    let client_id = sync::ensure_client_id(state)?;
    let mut connection = storage::database(&state.data_dir)?;
    let transaction = connection
        .transaction()
        .map_err(|_| CommandError::internal())?;
    let hari_ini = wib_today(&transaction);
    let valid = validate_buka(&draft, &hari_ini).map_err(invalid)?;

    // Kelas disimpan sebagai SALINAN: rombel berganti tiap tahun ajaran,
    // sedangkan riwayat harus tetap menunjukkan kelas saat kejadian.
    let (nama, kelas): (String, Option<String>) = transaction
        .query_row(
            "SELECT m.nama, r.nama_rombel
             FROM master_data m
             LEFT JOIN siswa_data s ON s.id_siswa = m.id_unik
             LEFT JOIN akademik_rombel r ON r.id_rombel = s.id_rombel
             WHERE m.id_unik = ?;",
            params![valid.id_personil],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .map_err(|_| CommandError::internal())?
        .ok_or_else(|| invalid("Personil tidak ditemukan."))?;

    let id = new_id();
    transaction
        .execute(
            "INSERT INTO uks_kunjungan (
                id_kunjungan, id_personil, nama_personil, kelas, tanggal, jam_masuk, keluhan,
                catatan, dicatat_oleh, created_at, updated_at
             ) VALUES (?1, ?2, ?3, ?4, COALESCE(?5, date('now', '+7 hours')),
                       COALESCE(?6, strftime('%H:%M', 'now', '+7 hours')), ?7, ?8, ?9,
                       datetime('now'), datetime('now'));",
            params![
                id,
                valid.id_personil,
                nama,
                kelas,
                valid.tanggal,
                valid.jam_masuk,
                valid.keluhan,
                valid.catatan,
                dicatat_oleh,
            ],
        )
        .map_err(|_| CommandError::internal())?;
    give_medicines(&transaction, &client_id, dicatat_oleh, &id, &draft.obat)?;
    enqueue_save(&transaction, &client_id, &id)?;
    transaction.commit().map_err(|_| CommandError::internal())?;
    Ok(json!({ "sukses": true, "id_kunjungan": id }))
}

/// Menyimpan tindakan, tindak lanjut, obat, dan (bila jam keluar diisi)
/// menutup kunjungan. Hanya untuk kunjungan yang salinannya ada di perangkat
/// ini; UI mengambil salinannya lebih dulu lewat `adopt_visit`.
pub fn save_visit(
    state: &DesktopState,
    operator: &str,
    id_kunjungan: &str,
    draft: Value,
) -> Result<Value, CommandError> {
    let draft: SimpanDraft =
        serde_json::from_value(draft).map_err(|_| invalid("Data kunjungan tidak valid."))?;
    let client_id = sync::ensure_client_id(state)?;
    let mut connection = storage::database(&state.data_dir)?;
    let transaction = connection
        .transaction()
        .map_err(|_| CommandError::internal())?;
    let id = id_kunjungan.trim();
    let (jam_masuk, id_personil, tanggal, keluhan, sudah_ditutup): (
        String,
        String,
        String,
        String,
        bool,
    ) = transaction
        .query_row(
            "SELECT jam_masuk, id_personil, tanggal, keluhan, jam_keluar IS NOT NULL
                 FROM uks_kunjungan WHERE id_kunjungan = ?;",
            params![id],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                ))
            },
        )
        .optional()
        .map_err(|_| CommandError::internal())?
        .ok_or_else(butuh_salinan)?;
    let valid = validate_simpan(&draft, &jam_masuk).map_err(invalid)?;

    transaction
        .execute(
            "UPDATE uks_kunjungan SET
                tindakan = ?2,
                tindak_lanjut = ?3,
                catatan = ?4,
                jam_keluar = COALESCE(?5, jam_keluar),
                ditutup_oleh = CASE WHEN ?5 IS NOT NULL THEN COALESCE(ditutup_oleh, ?6) ELSE ditutup_oleh END,
                updated_at = datetime('now')
             WHERE id_kunjungan = ?1;",
            params![
                id,
                valid.tindakan,
                valid.tindak_lanjut,
                valid.catatan,
                valid.jam_keluar,
                operator,
            ],
        )
        .map_err(|_| CommandError::internal())?;
    give_medicines(&transaction, &client_id, operator, id, &draft.obat)?;

    // Pesan ke wali diantrekan di transaksi penutupan yang SAMA. Helper yang
    // sama dengan jenis lain memeriksa sakelar, membatasi ke siswa, menolak
    // nomor tidak sah, dan memakai dedupe `uks:<id>` sehingga satu kunjungan
    // paling banyak menghasilkan satu pesan meski disimpan berulang.
    let wa_diantre = match (&valid.jam_keluar, draft.kabari_wali && !sudah_ditutup) {
        (Some(jam_keluar), true) => Some(super::wa_notification::queue_wali_notification_tx(
            &transaction,
            &client_id,
            "uks",
            &id_personil,
            &format!("uks:{id}"),
            |wali| {
                wali.isian(vec![
                    ("tanggal", tanggal.clone()),
                    ("jam_masuk", jam_masuk.clone()),
                    ("jam_keluar", jam_keluar.clone()),
                    (
                        "tindak_lanjut",
                        valid.tindak_lanjut.clone().unwrap_or_default(),
                    ),
                    ("keluhan", keluhan.clone()),
                ])
            },
        )?),
        _ => None,
    };

    enqueue_save(&transaction, &client_id, id)?;
    transaction.commit().map_err(|_| CommandError::internal())?;
    Ok(json!({
        "sukses": true,
        "ditutup": valid.jam_keluar.is_some(),
        "wa_diantre": wa_diantre,
    }))
}

/// Menghapus kunjungan. Mutasi obatnya tidak ikut terhapus: stok yang sudah
/// keluar tetap keluar.
pub fn delete_visit(state: &DesktopState, id_kunjungan: &str) -> Result<Value, CommandError> {
    let client_id = sync::ensure_client_id(state)?;
    let mut connection = storage::database(&state.data_dir)?;
    let transaction = connection
        .transaction()
        .map_err(|_| CommandError::internal())?;
    let id = id_kunjungan.trim();
    let terhapus = transaction
        .execute(
            "DELETE FROM uks_kunjungan WHERE id_kunjungan = ?;",
            params![id],
        )
        .map_err(|_| CommandError::internal())?;
    if terhapus == 0 {
        return Err(butuh_salinan());
    }
    sync::enqueue(
        &transaction,
        &client_id,
        "uks-visit",
        "delete",
        id,
        &json!({ "id_kunjungan": id }),
        None,
    )?;
    transaction.commit().map_err(|_| CommandError::internal())?;
    Ok(json!({ "sukses": true }))
}

/// Mengambil salinan satu kunjungan dari cloud supaya perangkat ini bisa
/// mengubahnya lewat outbox seperti biasa (keputusan User). Butuh koneksi.
pub async fn adopt_visit(state: &DesktopState, id_kunjungan: &str) -> Result<Value, CommandError> {
    let id = id_kunjungan.trim().to_owned();
    {
        let connection = storage::database(&state.data_dir)?;
        if visit_json(&connection, &id)?.is_some() {
            return Ok(json!({ "sukses": true, "sudah_ada": true }));
        }
    }
    let turso = state.get_turso_client().map_err(|_| butuh_koneksi())?;
    let hasil = turso
        .query_one(
            format!("SELECT {KOLOM} FROM uks_kunjungan WHERE id_kunjungan = ?;"),
            vec![json!(id)],
        )
        .await
        .map_err(|_| butuh_koneksi())?;
    let row = hasil
        .to_objects()
        .into_iter()
        .next()
        .ok_or_else(|| invalid("Kunjungan tidak ditemukan di database."))?;
    let values = cloud_visit_values(&Value::Object(row.into_iter().collect()), &id)
        .ok_or_else(|| invalid("Data kunjungan di database tidak valid."))?;
    let connection = storage::database(&state.data_dir)?;
    // Salinan yang diambil tidak didaftarkan ke outbox: isinya sama dengan
    // cloud. Event baru baru lahir saat perangkat ini mengubahnya.
    let params: Vec<rusqlite::types::Value> = values.iter().map(json_ke_sql).collect();
    connection
        .execute(
            &format!(
                "INSERT OR IGNORE INTO uks_kunjungan ({KOLOM}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')), COALESCE(?, datetime('now')));"
            ),
            rusqlite::params_from_iter(params),
        )
        .map_err(|_| CommandError::internal())?;
    Ok(json!({ "sukses": true, "sudah_ada": false }))
}

fn json_ke_sql(value: &Value) -> rusqlite::types::Value {
    match value {
        Value::String(text) => rusqlite::types::Value::Text(text.clone()),
        Value::Number(angka) => angka
            .as_i64()
            .map(rusqlite::types::Value::Integer)
            .unwrap_or(rusqlite::types::Value::Null),
        _ => rusqlite::types::Value::Null,
    }
}

fn detik_sejak_sync(connection: &Connection) -> Option<i64> {
    let terakhir: Option<i64> = connection
        .query_row(
            "SELECT updated_at FROM desktop_sync_cursor WHERE domain = 'operational';",
            [],
            |row| row.get(0),
        )
        .optional()
        .ok()
        .flatten();
    terakhir.map(|detik| (storage::now_epoch_seconds() - detik).max(0))
}

/// Salinan lokal yang sudah ditutup, sudah terkirim, dan lebih tua dari
/// `HARI_SIMPAN_LOKAL` hari dihapus. Event yang masih menggantung dilindungi.
fn prune_local(connection: &Connection) -> Result<(), CommandError> {
    connection
        .execute(
            "DELETE FROM uks_kunjungan
             WHERE jam_keluar IS NOT NULL
               AND updated_at < datetime('now', ?1)
               AND NOT EXISTS (
                   SELECT 1 FROM desktop_sync_outbox o
                   WHERE o.domain = 'uks-visit' AND o.entity_key = uks_kunjungan.id_kunjungan
                     AND o.status IN ('pending', 'failed', 'conflict')
               );",
            params![format!("-{HARI_SIMPAN_LOKAL} days")],
        )
        .map_err(|_| CommandError::internal())?;
    Ok(())
}

fn cocok_cari(row: &Value, cari: &str) -> bool {
    if cari.is_empty() {
        return true;
    }
    ["nama_personil", "kelas", "keluhan", "tindak_lanjut"]
        .iter()
        .any(|key| {
            row[*key]
                .as_str()
                .is_some_and(|text| text.to_lowercase().contains(cari))
        })
}

/// Riwayat dan daftar "Sedang di UKS". Sumber utamanya cloud; baris lokal yang
/// event outbox-nya belum terkirim menimpa atau melengkapi hasil cloud. Tanpa
/// koneksi, yang dikembalikan hanya salinan di perangkat ini dan `offline`
/// menyala supaya UI mengatakannya, bukan menampilkan daftar yang tampak
/// lengkap.
pub async fn list_visits(
    state: &DesktopState,
    dari: &str,
    sampai: &str,
    cari: Option<String>,
) -> Result<Value, CommandError> {
    if !inventory::is_valid_date(dari) || !inventory::is_valid_date(sampai) {
        return Err(invalid("Rentang tanggal tidak valid."));
    }
    if dari > sampai {
        return Err(invalid("Tanggal awal tidak boleh setelah tanggal akhir."));
    }
    let cari = cari.unwrap_or_default().trim().to_lowercase();

    let (lokal, tertunda, detik_sync) = {
        let connection = storage::database(&state.data_dir)?;
        prune_local(&connection)?;
        let mut statement = connection
            .prepare(&format!(
                "SELECT {KOLOM} FROM uks_kunjungan
                 WHERE (tanggal >= ?1 AND tanggal <= ?2) OR jam_keluar IS NULL
                 ORDER BY tanggal DESC, jam_masuk DESC
                 LIMIT 701;"
            ))
            .map_err(|_| CommandError::internal())?;
        let lokal: Vec<Value> = statement
            .query_map(params![dari, sampai], row_to_json)
            .map_err(|_| CommandError::internal())?
            .collect::<Result<_, _>>()
            .map_err(|_| CommandError::internal())?;
        let mut tertunda_statement = connection
            .prepare(
                "SELECT DISTINCT entity_key FROM desktop_sync_outbox
                 WHERE domain = 'uks-visit' AND status IN ('pending', 'failed', 'conflict')
                 LIMIT 1000;",
            )
            .map_err(|_| CommandError::internal())?;
        let tertunda: Vec<String> = tertunda_statement
            .query_map([], |row| row.get(0))
            .map_err(|_| CommandError::internal())?
            .collect::<Result<_, _>>()
            .map_err(|_| CommandError::internal())?;
        (lokal, tertunda, detik_sejak_sync(&connection))
    };

    let cloud = match state.get_turso_client() {
        Ok(turso) => {
            let riwayat = turso
                .query_one(
                    format!(
                        "SELECT {KOLOM} FROM uks_kunjungan WHERE tanggal >= ? AND tanggal <= ?
                         ORDER BY tanggal DESC, jam_masuk DESC LIMIT 501;"
                    ),
                    vec![json!(dari), json!(sampai)],
                )
                .await;
            let sedang = turso
                .query_one(
                    format!(
                        "SELECT {KOLOM} FROM uks_kunjungan WHERE jam_keluar IS NULL
                         ORDER BY tanggal DESC, jam_masuk DESC LIMIT 200;"
                    ),
                    vec![],
                )
                .await;
            match (riwayat, sedang) {
                (Ok(riwayat), Ok(sedang)) => Some((riwayat.to_objects(), sedang.to_objects())),
                _ => None,
            }
        }
        Err(_) => None,
    };
    let offline = cloud.is_none();
    let id_lokal: Vec<String> = lokal
        .iter()
        .filter_map(|row| row["id_kunjungan"].as_str().map(str::to_owned))
        .collect();

    let mut gabung: HashMap<String, Value> = HashMap::new();
    let mut terpotong = false;
    if let Some((riwayat, sedang)) = &cloud {
        terpotong = riwayat.len() > MAKS_BARIS_RIWAYAT;
        for row in riwayat.iter().take(MAKS_BARIS_RIWAYAT).chain(sedang.iter()) {
            let value = Value::Object(row.clone().into_iter().collect());
            if let Some(id) = value["id_kunjungan"].as_str() {
                gabung.insert(id.to_owned(), value);
            }
        }
    }
    for row in &lokal {
        let Some(id) = row["id_kunjungan"].as_str() else {
            continue;
        };
        // Baris lokal menang bila event-nya belum terkirim, atau bila cloud
        // belum (atau tidak bisa) memuatnya.
        if tertunda.iter().any(|t| t == id) || !gabung.contains_key(id) {
            gabung.insert(id.to_owned(), row.clone());
        }
    }

    let mut semua: Vec<Value> = gabung
        .into_values()
        .filter(|row| cocok_cari(row, &cari))
        .map(|mut row| {
            let id = row["id_kunjungan"].as_str().unwrap_or_default().to_owned();
            row["lokal"] = json!(id_lokal.contains(&id));
            row["belum_terkirim"] = json!(tertunda.contains(&id));
            row
        })
        .collect();
    semua.sort_by(|a, b| {
        (b["tanggal"].as_str(), b["jam_masuk"].as_str())
            .cmp(&(a["tanggal"].as_str(), a["jam_masuk"].as_str()))
    });
    let sedang: Vec<Value> = semua
        .iter()
        .filter(|row| row["jam_keluar"].is_null())
        .take(MAKS_SEDANG_DI_UKS)
        .cloned()
        .collect();
    let baris: Vec<Value> = semua
        .into_iter()
        .filter(|row| {
            let tanggal = row["tanggal"].as_str().unwrap_or_default();
            tanggal >= dari && tanggal <= sampai
        })
        .take(MAKS_BARIS_RIWAYAT)
        .collect();

    Ok(json!({
        "baris": baris,
        "sedang": sedang,
        "offline": offline,
        "detik_sejak_sync": detik_sync,
        "terpotong": terpotong,
    }))
}

/// Obat yang diberikan dalam satu kunjungan, dari mutasi inventaris lokal
/// (tabel snapshot, jadi tersedia juga untuk kunjungan perangkat lain).
pub fn visit_medicines(state: &DesktopState, id_kunjungan: &str) -> Result<Value, CommandError> {
    let connection = storage::database(&state.data_dir)?;
    let mut statement = connection
        .prepare(
            "SELECT m.id_mutasi, b.nama_barang, m.jumlah, b.satuan, m.tanggal,
                    EXISTS(SELECT 1 FROM inventory_mutasi x WHERE x.id_mutasi = 'batal-' || m.id_mutasi) AS dibatalkan
             FROM inventory_mutasi m
             JOIN inventory_barang b ON b.id_barang = m.id_barang
             WHERE m.id_ref = ? AND m.alasan = 'Pemakaian'
             ORDER BY m.created_at
             LIMIT 100;",
        )
        .map_err(|_| CommandError::internal())?;
    let obat: Vec<Value> = statement
        .query_map(params![id_kunjungan.trim()], |row| {
            Ok(json!({
                "id_mutasi": row.get::<_, String>(0)?,
                "nama_barang": row.get::<_, String>(1)?,
                "jumlah": row.get::<_, i64>(2)?,
                "satuan": row.get::<_, String>(3)?,
                "tanggal": row.get::<_, String>(4)?,
                "dibatalkan": row.get::<_, i64>(5)? == 1,
            }))
        })
        .map_err(|_| CommandError::internal())?
        .collect::<Result<_, _>>()
        .map_err(|_| CommandError::internal())?;
    Ok(json!({ "obat": obat }))
}

/// Data formulir: personil, saran tindak lanjut di perangkat ini, dan stok
/// inventaris untuk memilih obat. Dibaca dengan izin `uks.record` supaya
/// petugas UKS tidak perlu izin data siswa maupun inventaris.
pub fn form_data(state: &DesktopState) -> Result<Value, CommandError> {
    let penerima = inventory::list_recipients(state)?;
    let stok = inventory::list_inventory(state)?;
    let connection = storage::database(&state.data_dir)?;
    let mut statement = connection
        .prepare(
            "SELECT tindak_lanjut FROM uks_kunjungan
             WHERE tindak_lanjut IS NOT NULL
             GROUP BY tindak_lanjut
             ORDER BY MAX(updated_at) DESC
             LIMIT 20;",
        )
        .map_err(|_| CommandError::internal())?;
    let saran: Vec<String> = statement
        .query_map([], |row| row.get(0))
        .map_err(|_| CommandError::internal())?
        .collect::<Result<_, _>>()
        .map_err(|_| CommandError::internal())?;
    // Kotak centang WA hanya ditampilkan bila sakelarnya menyala; nilai yang
    // belum pernah ditulis berarti MATI.
    let wa_uks_aktif = connection
        .query_row(
            "SELECT value FROM setting_gex_system WHERE key = ?;",
            params![super::wa_notification::WA_NOTIFY_UKS_KEY],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|_| CommandError::internal())?
        .is_some_and(|value| value.trim().eq_ignore_ascii_case("true"));
    Ok(json!({
        "personil": penerima["personil"],
        "barang": stok["barang"],
        "tindak_lanjut": saran,
        "hari_ini": stok["hari_ini"],
        "wa_uks_aktif": wa_uks_aktif,
    }))
}

// ── Cloud ───────────────────────────────────────────────────────────────────

fn payload_text(row: &Value, key: &str) -> Option<String> {
    row.get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .map(str::to_owned)
}

/// Nilai kolom `uks_kunjungan` dari payload event, urut sesuai `KOLOM`. `None`
/// bila payload tidak memenuhi bentuk tabel cloud; handler mengabaikannya.
pub fn cloud_visit_values(row: &Value, entity_key: &str) -> Option<Vec<Value>> {
    let id = payload_text(row, "id_kunjungan").unwrap_or_else(|| entity_key.trim().to_owned());
    let id_personil = payload_text(row, "id_personil")?;
    let nama = payload_text(row, "nama_personil")?;
    let tanggal = payload_text(row, "tanggal").filter(|t| inventory::is_valid_date(t))?;
    let jam_masuk = payload_text(row, "jam_masuk").filter(|j| is_valid_jam(j))?;
    let jam_keluar = match payload_text(row, "jam_keluar") {
        None => None,
        Some(jam) if is_valid_jam(&jam) => Some(jam),
        Some(_) => return None,
    };
    let keluhan = payload_text(row, "keluhan")?;
    let dicatat_oleh = payload_text(row, "dicatat_oleh")?;
    if id.is_empty() {
        return None;
    }
    Some(vec![
        json!(id),
        json!(id_personil),
        json!(nama),
        json!(payload_text(row, "kelas")),
        json!(tanggal),
        json!(jam_masuk),
        json!(jam_keluar),
        json!(keluhan),
        json!(payload_text(row, "tindakan")),
        json!(payload_text(row, "tindak_lanjut")),
        json!(payload_text(row, "catatan")),
        json!(dicatat_oleh),
        json!(payload_text(row, "ditutup_oleh")),
        json!(payload_text(row, "created_at")),
        json!(payload_text(row, "updated_at")),
    ])
}

/// Upsert seluruh baris: biasanya hanya satu perangkat menyentuh satu
/// kunjungan, jadi siapa terakhir menang sudah cukup (PRD §6.8).
pub const CLOUD_UPSERT_VISIT_SQL: &str = "INSERT INTO uks_kunjungan (
        id_kunjungan, id_personil, nama_personil, kelas, tanggal, jam_masuk, jam_keluar,
        keluhan, tindakan, tindak_lanjut, catatan, dicatat_oleh, ditutup_oleh, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')), COALESCE(?, datetime('now')))
    ON CONFLICT(id_kunjungan) DO UPDATE SET
        id_personil = excluded.id_personil,
        nama_personil = excluded.nama_personil,
        kelas = excluded.kelas,
        tanggal = excluded.tanggal,
        jam_masuk = excluded.jam_masuk,
        jam_keluar = excluded.jam_keluar,
        keluhan = excluded.keluhan,
        tindakan = excluded.tindakan,
        tindak_lanjut = excluded.tindak_lanjut,
        catatan = excluded.catatan,
        ditutup_oleh = excluded.ditutup_oleh,
        updated_at = excluded.updated_at;";

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    const HARI_INI: &str = "2026-10-07";

    fn setup_state() -> (tempfile::TempDir, DesktopState) {
        let directory = tempdir().expect("direktori sementara");
        storage::initialize(directory.path()).expect("inisialisasi database");
        let state = DesktopState {
            server_origin: std::sync::RwLock::new("http://localhost:3000".to_string()),
            offline_max_age_hours: 24,
            data_dir: directory.path().to_path_buf(),
            http: reqwest::Client::new(),
            turso_config: std::sync::RwLock::new(None),
            session: std::sync::Mutex::new(None),
            vault_lock: std::sync::Mutex::new(()),
        };
        let connection = storage::database(&state.data_dir).unwrap();
        connection
            .execute_batch(
                "INSERT INTO akademik_tahun_ajaran (id_tahun_ajaran, nama_tahun, semester, tanggal_mulai, tanggal_selesai, is_aktif, created_at, updated_at)
                 VALUES ('ta', '2026/2027', 'Ganjil', '2026-07-01', '2026-12-31', 1, '2026-07-01', '2026-07-01');
                 INSERT INTO akademik_rombel (id_rombel, id_tahun_ajaran, tingkat, nama_rombel, kapasitas, is_aktif)
                 VALUES ('r-10a', 'ta', 10, 'X-A', 36, 1);
                 INSERT INTO master_data (id_unik, kode_karyawan, nama, divisi, status_aktif, id_shift, jenis_personil)
                 VALUES ('sis-1', 'S-1', 'Budi', 'Siswa', 'Aktif', 1, 'SISWA');
                 INSERT INTO siswa_data (id_siswa, nama_lengkap, id_rombel, angkatan, created_at, updated_at)
                 VALUES ('sis-1', 'Budi', 'r-10a', 2026, '2026-07-01', '2026-07-01');",
            )
            .unwrap();
        (directory, state)
    }

    // Vektor kembar dengan `validations/uks.test.ts` (VEKTOR_JAM).
    #[test]
    fn jam_vectors() {
        for (input, expected) in [
            ("07:05", true),
            ("23:59", true),
            ("24:00", false),
            ("7:05", false),
            ("07:60", false),
            ("ab:cd", false),
        ] {
            assert_eq!(is_valid_jam(input), expected, "input {input:?}");
        }
    }

    // Vektor kembar dengan `validations/uks.test.ts` (VEKTOR_BUKA dan VEKTOR_SIMPAN).
    #[test]
    fn validation_vectors() {
        let buka = |value: Value| validate_buka(&serde_json::from_value(value).unwrap(), HARI_INI);
        assert!(buka(json!({"id_personil":"sis-1","keluhan":"Demam"})).is_ok());
        assert_eq!(
            buka(json!({"id_personil":" ","keluhan":"Demam"})).unwrap_err(),
            "Pilih personil yang berkunjung."
        );
        assert_eq!(
            buka(json!({"id_personil":"sis-1","keluhan":"  "})).unwrap_err(),
            "Keluhan wajib diisi."
        );
        assert_eq!(
            buka(json!({"id_personil":"sis-1","keluhan":"Demam","tanggal":"2026-10-08"}))
                .unwrap_err(),
            "Tanggal tidak boleh melewati hari ini."
        );
        assert_eq!(
            buka(json!({"id_personil":"sis-1","keluhan":"Demam","jam_masuk":"25:00"})).unwrap_err(),
            "Jam masuk tidak valid."
        );

        let simpan =
            |value: Value| validate_simpan(&serde_json::from_value(value).unwrap(), "08:30");
        assert!(simpan(json!({"tindakan":"Kompres"})).is_ok());
        assert!(simpan(json!({"jam_keluar":"09:00","tindak_lanjut":"Kembali ke kelas"})).is_ok());
        assert_eq!(
            simpan(json!({"jam_keluar":"08:00","tindak_lanjut":"Pulang"})).unwrap_err(),
            "Jam keluar tidak boleh lebih awal dari jam masuk."
        );
        assert_eq!(
            simpan(json!({"jam_keluar":"09:00"})).unwrap_err(),
            "Tindak lanjut wajib diisi saat menutup kunjungan."
        );
        assert_eq!(
            simpan(json!({"jam_keluar":"9:00","tindak_lanjut":"Pulang"})).unwrap_err(),
            "Jam keluar tidak valid."
        );
    }

    fn obat_uks(state: &DesktopState) -> (String, String) {
        let id_barang = inventory::save_item(
            state,
            json!({"nama_barang":"Paracetamol","tipe":"Habis Pakai","satuan":"tablet","bisa_expired":true,"tempat_utama":"UKS"}),
        )
        .unwrap()["id_barang"]
            .as_str()
            .unwrap()
            .to_owned();
        let batch = inventory::record_mutation(
            state,
            "admin",
            json!({"id_barang": id_barang, "jenis":"Masuk","alasan":"Pengadaan","jumlah":10,
                   "tempat_tujuan":"UKS","tanggal_expired":"2027-06-30"}),
        )
        .unwrap()["id_mutasi"]
            .as_str()
            .unwrap()
            .to_owned();
        (id_barang, batch)
    }

    #[test]
    fn open_give_medicine_and_close_in_one_flow() {
        let (_directory, state) = setup_state();
        let (id_barang, batch) = obat_uks(&state);
        let buka = open_visit(
            &state,
            "petugas-uks",
            json!({"id_personil":"sis-1","keluhan":"Pusing","jam_masuk":"08:30",
                   "obat":[{"id_barang": id_barang, "tempat":"UKS", "id_batch": batch, "jumlah": 2}]}),
        )
        .expect("buka");
        let id = buka["id_kunjungan"].as_str().unwrap().to_owned();
        let connection = storage::database(&state.data_dir).unwrap();
        let kunjungan = visit_json(&connection, &id).unwrap().unwrap();
        assert_eq!(kunjungan["kelas"], "X-A", "kelas disalin saat kejadian");
        assert_eq!(kunjungan["nama_personil"], "Budi");

        // Nama siswa TIDAK masuk mutasi inventaris yang tersalin ke semua perangkat.
        let (penerima, keperluan, id_ref): (String, String, String) = connection
            .query_row(
                "SELECT penerima_nama, keperluan, id_ref FROM inventory_mutasi WHERE alasan = 'Pemakaian';",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        assert_eq!(
            (penerima.as_str(), keperluan.as_str(), id_ref.as_str()),
            ("UKS", "Kunjungan UKS", id.as_str())
        );
        assert_eq!(
            visit_medicines(&state, &id).unwrap()["obat"][0]["jumlah"],
            2
        );

        let tutup = save_visit(
            &state,
            "petugas-uks",
            &id,
            json!({"jam_keluar":"09:10","tindakan":"Istirahat","tindak_lanjut":"Kembali ke kelas"}),
        )
        .expect("tutup");
        assert_eq!(tutup["ditutup"], true);
        let kunjungan = visit_json(&connection, &id).unwrap().unwrap();
        assert_eq!(kunjungan["ditutup_oleh"], "petugas-uks");
        let antre: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM desktop_sync_outbox WHERE domain = 'uks-visit' AND entity_key = ?;",
                params![id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(antre, 2, "buka dan tutup masing-masing satu event");
    }

    #[test]
    fn closing_queues_one_wali_message_only_when_switched_on() {
        let (_directory, state) = setup_state();
        let connection = storage::database(&state.data_dir).unwrap();
        connection
            .execute(
                "UPDATE siswa_data SET no_whatsapp_wali = '081234567890' WHERE id_siswa = 'sis-1';",
                [],
            )
            .unwrap();
        let antrean = |connection: &Connection| -> i64 {
            connection
                .query_row(
                    "SELECT COUNT(*) FROM notifikasi_wa WHERE jenis = 'uks';",
                    [],
                    |row| row.get(0),
                )
                .unwrap()
        };

        // Sakelar mati: dicentang pun tidak mengantre.
        let mati = open_visit(
            &state,
            "admin",
            json!({"id_personil":"sis-1","keluhan":"Demam","jam_masuk":"08:00"}),
        )
        .unwrap();
        let hasil = save_visit(
            &state,
            "admin",
            mati["id_kunjungan"].as_str().unwrap(),
            json!({"jam_keluar":"09:00","tindak_lanjut":"Pulang","kabari_wali":true}),
        )
        .unwrap();
        assert_eq!(hasil["wa_diantre"], false);
        assert_eq!(antrean(&connection), 0);

        connection
            .execute(
                "INSERT INTO setting_gex_system (key, value) VALUES ('wa_notify_uks', 'true')
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value;",
                [],
            )
            .unwrap();
        let hidup = open_visit(
            &state,
            "admin",
            json!({"id_personil":"sis-1","keluhan":"Demam","jam_masuk":"08:00"}),
        )
        .unwrap();
        let id = hidup["id_kunjungan"].as_str().unwrap().to_owned();
        let hasil = save_visit(
            &state,
            "admin",
            &id,
            json!({"jam_keluar":"09:00","tindak_lanjut":"Pulang dijemput ayah","kabari_wali":true}),
        )
        .unwrap();
        assert_eq!(hasil["wa_diantre"], true);
        let (isi, dedupe): (String, String) = connection
            .query_row(
                "SELECT isi_pesan, dedupe_key FROM notifikasi_wa WHERE jenis = 'uks';",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(dedupe, format!("uks:{id}"));
        assert!(isi.contains("Pulang dijemput ayah"), "{isi}");
        assert!(
            !isi.contains("Demam"),
            "template bawaan tidak membawa keluhan: {isi}"
        );

        // Menyimpan ulang kunjungan yang sudah ditutup tidak mengantre lagi.
        save_visit(
            &state,
            "admin",
            &id,
            json!({"jam_keluar":"09:00","tindak_lanjut":"Pulang","kabari_wali":true}),
        )
        .unwrap();
        assert_eq!(antrean(&connection), 1);
    }

    #[test]
    fn medicine_overdraw_rolls_back_the_whole_visit() {
        let (_directory, state) = setup_state();
        let (id_barang, batch) = obat_uks(&state);
        let gagal = open_visit(
            &state,
            "petugas-uks",
            json!({"id_personil":"sis-1","keluhan":"Pusing",
                   "obat":[{"id_barang": id_barang, "tempat":"UKS", "id_batch": batch, "jumlah": 99}]}),
        )
        .unwrap_err();
        assert!(
            gagal.message.starts_with("Stok di UKS"),
            "{}",
            gagal.message
        );
        let connection = storage::database(&state.data_dir).unwrap();
        let jumlah: i64 = connection
            .query_row("SELECT COUNT(*) FROM uks_kunjungan;", [], |row| row.get(0))
            .unwrap();
        assert_eq!(jumlah, 0, "kunjungan tidak boleh tersimpan tanpa obatnya");
    }

    #[test]
    fn foreign_visit_requires_copy_and_list_reports_offline() {
        let (_directory, state) = setup_state();
        let error = save_visit(
            &state,
            "admin",
            "uks-perangkat-lain",
            json!({"tindakan":"x"}),
        )
        .unwrap_err();
        assert_eq!(error.code, "UKS_BUTUH_SALINAN");
        assert_eq!(
            delete_visit(&state, "uks-perangkat-lain").unwrap_err().code,
            "UKS_BUTUH_SALINAN"
        );

        open_visit(
            &state,
            "admin",
            json!({"id_personil":"sis-1","keluhan":"Luka"}),
        )
        .unwrap();
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        let hasil = runtime
            .block_on(list_visits(&state, "2000-01-01", "2999-12-31", None))
            .unwrap();
        // Tanpa database terkonfigurasi: hanya salinan lokal, dan UI diberi tahu.
        assert_eq!(hasil["offline"], true);
        assert_eq!(hasil["sedang"].as_array().unwrap().len(), 1);
        assert_eq!(hasil["sedang"][0]["lokal"], true);
        assert_eq!(hasil["sedang"][0]["belum_terkirim"], true);
        let adopsi = runtime
            .block_on(adopt_visit(&state, "uks-perangkat-lain"))
            .unwrap_err();
        assert_eq!(adopsi.code, "UKS_BUTUH_KONEKSI");
    }

    #[test]
    fn closed_and_synced_copies_are_pruned_after_thirty_days() {
        let (_directory, state) = setup_state();
        let connection = storage::database(&state.data_dir).unwrap();
        connection
            .execute_batch(
                "INSERT INTO uks_kunjungan (id_kunjungan, id_personil, nama_personil, tanggal, jam_masuk, jam_keluar, keluhan, tindak_lanjut, dicatat_oleh, created_at, updated_at)
                 VALUES ('uks-lama', 'sis-1', 'Budi', '2026-01-01', '08:00', '09:00', 'Demam', 'Pulang', 'admin', datetime('now', '-40 days'), datetime('now', '-40 days')),
                        ('uks-terbuka', 'sis-1', 'Budi', '2026-01-01', '08:00', NULL, 'Demam', NULL, 'admin', datetime('now', '-40 days'), datetime('now', '-40 days')),
                        ('uks-baru', 'sis-1', 'Budi', '2026-01-01', '08:00', '09:00', 'Demam', 'Pulang', 'admin', datetime('now'), datetime('now'));",
            )
            .unwrap();
        prune_local(&connection).unwrap();
        let sisa: Vec<String> = connection
            .prepare("SELECT id_kunjungan FROM uks_kunjungan ORDER BY id_kunjungan;")
            .unwrap()
            .query_map([], |row| row.get(0))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        assert_eq!(sisa, vec!["uks-baru", "uks-terbuka"]);
    }

    #[test]
    fn cloud_values_validate_shape() {
        let baik = json!({"id_kunjungan":"uks-1","id_personil":"sis-1","nama_personil":"Budi","tanggal":"2026-10-07",
                          "jam_masuk":"08:00","keluhan":"Demam","dicatat_oleh":"admin"});
        assert_eq!(cloud_visit_values(&baik, "uks-1").unwrap().len(), 15);
        let mut rusak = baik.clone();
        rusak["jam_keluar"] = json!("25:00");
        assert!(cloud_visit_values(&rusak, "uks-1").is_none());
    }
}
