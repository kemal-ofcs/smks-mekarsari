use std::collections::HashMap;

use rusqlite::{params, Connection, Transaction};
use serde_json::{json, Value};

use super::{config::DesktopState, models::CommandError, storage, sync};

/// Sakelar induk per jenis notifikasi, disimpan di `setting_gex_system`.
///
/// Keempatnya BAWAANNYA MATI — kunci yang belum ada berarti mati, pola yang
/// sama dengan `scan_photo_enabled`. Alasannya konkret: sekolah 800 siswa
/// menghasilkan ±1.600 baris antrean per hari sejak hari pertama. Menyalakan
/// notifikasi secara bawaan berarti setiap pemasangan diam-diam menimbun
/// tumpukan pesan yang akan terkirim sekaligus begitu seseorang mengaktifkan
/// gateway — biaya nyata, dan banjir pesan ke wali.
///
/// Sakelar ini hidup di `setting_gex_system` yang IKUT SINKRONISASI, bukan di
/// `app_wa_config`. Bedanya menentukan: `app_wa_config` cloud-only, sehingga
/// scanner yang sedang menulis di dalam transaksi SQLite lokal — mungkin tanpa
/// jaringan sama sekali — tidak akan pernah bisa membacanya. Kolom
/// `*_enabled` di sana tetap ada dan tetap dihormati saat PENGIRIMAN; yang di
/// sini memutuskan lebih awal, saat MENGANTRE.
///
/// Cerminan TypeScript-nya di `src/lib/validations/wa-notification.ts`.
pub const WA_NOTIFY_SCAN_MASUK_KEY: &str = "wa_notify_scan_masuk";
pub const WA_NOTIFY_SCAN_PULANG_KEY: &str = "wa_notify_scan_pulang";
pub const WA_NOTIFY_BOLOS_KEY: &str = "wa_notify_bolos";
pub const WA_NOTIFY_AMBANG_ALFA_KEY: &str = "wa_notify_ambang_alfa";

/// Umur maksimal baris antrean yang sudah selesai, dalam hari.
///
/// Hanya baris berstatus akhir (`Terkirim`/`Dibatalkan`) yang dipangkas.
/// `Menunggu` dan `Gagal` sengaja dibiarkan: yang pertama belum dikerjakan,
/// yang kedua masih bisa dicoba ulang manusia dan merupakan bukti kegagalan
/// pengiriman yang perlu terlihat.
pub const WA_QUEUE_RETENTION_DAYS: i64 = 90;

/// Kunci sakelar untuk sebuah jenis notifikasi.
pub fn wa_notify_setting_key(jenis: &str) -> Option<&'static str> {
    match jenis {
        "scan_masuk" => Some(WA_NOTIFY_SCAN_MASUK_KEY),
        "scan_pulang" => Some(WA_NOTIFY_SCAN_PULANG_KEY),
        "bolos" => Some(WA_NOTIFY_BOLOS_KEY),
        "ambang_alfa" => Some(WA_NOTIFY_AMBANG_ALFA_KEY),
        _ => None,
    }
}

/// Bolehkah jenis notifikasi ini diantrekan secara otomatis?
///
/// Jenis yang tidak dikenal menjawab `false`. Nilai asing di sini hanya bisa
/// datang dari kode yang salah, dan bawaan yang aman untuk pengiriman pesan ke
/// luar adalah tidak mengirim.
pub fn wa_notify_enabled(settings: &HashMap<String, String>, jenis: &str) -> bool {
    wa_notify_setting_key(jenis)
        .map(|key| super::scanner::setting_enabled(settings, key))
        .unwrap_or(false)
}

/// Pangkas baris antrean lokal yang sudah selesai dan melewati masa retensi.
///
/// Dijalankan di akhir siklus sinkronisasi. Baris yang masih punya event outbox
/// belum terkirim TIDAK ikut dihapus — menghapusnya lebih dulu akan membuat
/// event yang sudah antre menunjuk baris yang tidak ada lagi.
pub fn purge_expired_notifications(connection: &Connection) -> Result<usize, CommandError> {
    let batas = format!("-{WA_QUEUE_RETENTION_DAYS} days");
    connection
        .execute(
            r#"
            DELETE FROM notifikasi_wa
            WHERE status IN ('Terkirim', 'Dibatalkan')
              AND created_at < datetime('now', ?1)
              AND NOT EXISTS (
                    SELECT 1 FROM desktop_sync_outbox o
                    WHERE o.domain = 'wa-notification'
                      AND o.entity_key = notifikasi_wa.id_notifikasi
                      AND o.status IN ('pending', 'failed', 'conflict')
              );
            "#,
            params![batas],
        )
        .map(|jumlah| jumlah as usize)
        .map_err(|e| {
            CommandError::new(
                "DB_ERROR",
                format!("Gagal memangkas antrean notifikasi: {e}"),
            )
        })
}

/// Normalisasi nomor WhatsApp ke format kanonik `+62...`.
/// Meniru logika `src/lib/operators/contact.ts` (Rule 40).
pub fn normalize_phone_canonical(raw: &str) -> String {
    let digits: String = raw
        .chars()
        .filter(|c| c.is_ascii_digit() || *c == '+')
        .collect();
    if digits.is_empty() {
        return String::new();
    }
    let bare = if let Some(stripped) = digits.strip_prefix('+') {
        stripped
    } else {
        &digits
    };
    if !bare.chars().all(|c| c.is_ascii_digit()) {
        return String::new();
    }
    if bare.starts_with("62") {
        format!("+{bare}")
    } else if let Some(rest) = bare.strip_prefix('0') {
        format!("+62{rest}")
    } else if bare.starts_with('8') {
        format!("+62{bare}")
    } else if digits.starts_with('+') {
        format!("+{bare}")
    } else {
        String::new()
    }
}

pub fn is_valid_phone(phone: &str) -> bool {
    let canon = normalize_phone_canonical(phone);
    if !canon.starts_with('+') {
        return false;
    }
    let digits_count = canon.len().saturating_sub(1);
    digits_count >= 9 && digits_count <= 15
}

/// Buat ID unik notifikasi `wa_` + 128 bit (32 karakter hex).
pub fn new_wa_notification_id() -> String {
    let mut bytes = [0u8; 16];
    rand_core::RngCore::fill_bytes(&mut rand_core::OsRng, &mut bytes);
    let mut id = String::with_capacity(3 + 32);
    id.push_str("wa_");
    for byte in bytes {
        id.push_str(&format!("{byte:02x}"));
    }
    id
}

/// Antrekan notifikasi WA ke tabel lokal `notifikasi_wa` dan daftarkan ke outbox
/// dalam SATU transaksi SQLite atomik (Rule 3).
pub fn queue_wa_notification_tx(
    tx: &Transaction<'_>,
    client_id: &str,
    draft: &Value,
) -> Result<String, CommandError> {
    let raw_id = draft
        .get("id_notifikasi")
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim();
    let id = if raw_id.is_empty() {
        new_wa_notification_id()
    } else {
        raw_id.to_owned()
    };

    let dedupe_key = draft
        .get("dedupe_key")
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim();
    if dedupe_key.is_empty() {
        return Err(CommandError::new(
            "VALIDATION_ERROR",
            "Kunci deduplikasi (dedupe_key) wajib diisi.",
        ));
    }

    let jenis = draft
        .get("jenis")
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim();
    if !matches!(
        jenis,
        "scan_masuk" | "scan_pulang" | "bolos" | "ambang_alfa"
    ) {
        return Err(CommandError::new(
            "VALIDATION_ERROR",
            "Jenis notifikasi tidak valid. Pilihan: scan_masuk, scan_pulang, bolos, ambang_alfa.",
        ));
    }

    let id_siswa = draft
        .get("id_siswa")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty());

    let raw_phone = draft
        .get("tujuan_nomor")
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim();
    let tujuan_nomor = normalize_phone_canonical(raw_phone);
    if !is_valid_phone(&tujuan_nomor) {
        return Err(CommandError::new(
            "VALIDATION_ERROR",
            "Nomor telepon tujuan WhatsApp tidak valid (format: 08... atau +62...).",
        ));
    }

    let isi_pesan = draft
        .get("isi_pesan")
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim();
    if isi_pesan.is_empty() {
        return Err(CommandError::new(
            "VALIDATION_ERROR",
            "Isi pesan notifikasi WhatsApp tidak boleh kosong.",
        ));
    }
    if isi_pesan.len() > 5000 {
        return Err(CommandError::new(
            "VALIDATION_ERROR",
            "Isi pesan WhatsApp terlalu panjang (maksimal 5000 karakter).",
        ));
    }

    // Status asing DITOLAK, tidak dinormalkan menjadi `Menunggu`.
    //
    // Versi sebelumnya menjadikan nilai apa pun yang tidak dikenal sebagai
    // `Menunggu`, dan `Menunggu` adalah satu-satunya status yang benar-benar
    // dikirim: pada siklus pengurasan berikutnya baris itu menjadi pesan
    // WhatsApp ke nomor wali seorang siswa. Sebuah bug klien pun berubah
    // menjadi pesan yang tidak bisa ditarik kembali, tanpa meninggalkan jejak
    // bahwa ada yang salah. Pola `class_status` Fase 2, dengan taruhan lebih
    // tinggi. Daftar ini sama persis dengan CHECK constraint `notifikasi_wa`,
    // enum Zod `sync-schema.ts`, dan `WA_NOTIFICATION_STATUSES` di TypeScript.
    let status = draft
        .get("status")
        .and_then(Value::as_str)
        .unwrap_or("Menunggu")
        .trim();
    if !matches!(status, "Menunggu" | "Terkirim" | "Gagal" | "Dibatalkan") {
        return Err(CommandError::new(
            "VALIDATION_ERROR",
            "Status notifikasi tidak valid. Pilihan: Menunggu, Terkirim, Gagal, Dibatalkan.",
        ));
    }
    let valid_status = status;

    let now: String = tx
        .query_row("SELECT datetime('now');", [], |row| row.get(0))
        .map_err(|_| CommandError::internal())?;

    tx.execute(
        r#"INSERT INTO notifikasi_wa (
            id_notifikasi, dedupe_key, jenis, id_siswa, tujuan_nomor,
            isi_pesan, status, attempt_count, created_at, updated_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 0, ?8, ?8)
        ON CONFLICT(id_notifikasi) DO UPDATE SET
            dedupe_key = excluded.dedupe_key,
            jenis = excluded.jenis,
            id_siswa = excluded.id_siswa,
            tujuan_nomor = excluded.tujuan_nomor,
            isi_pesan = excluded.isi_pesan,
            status = excluded.status,
            updated_at = excluded.updated_at;"#,
        params![
            id,
            dedupe_key,
            jenis,
            id_siswa,
            tujuan_nomor,
            isi_pesan,
            valid_status,
            now
        ],
    )
    .map_err(|e| {
        CommandError::new(
            "DB_ERROR",
            format!("Gagal menyimpan antrean notifikasi: {e}"),
        )
    })?;

    let payload = json!({
        "id_notifikasi": id,
        "dedupe_key": dedupe_key,
        "jenis": jenis,
        "id_siswa": id_siswa,
        "tujuan_nomor": tujuan_nomor,
        "isi_pesan": isi_pesan,
        "status": valid_status,
        "created_at": now,
        "updated_at": now,
    });

    sync::enqueue(
        tx,
        client_id,
        "wa-notification",
        "queue",
        &id,
        &payload,
        None,
    )?;

    Ok(id)
}

/// Batalkan notifikasi WA di antrean lokal dan daftarkan event outbox `cancel`
/// dalam SATU transaksi atomik.
pub fn cancel_wa_notification_tx(
    tx: &Transaction<'_>,
    client_id: &str,
    id_notifikasi: &str,
    alasan: Option<&str>,
) -> Result<(), CommandError> {
    let now: String = tx
        .query_row("SELECT datetime('now');", [], |row| row.get(0))
        .map_err(|_| CommandError::internal())?;

    let updated = tx
        .execute(
            "UPDATE notifikasi_wa SET status = 'Dibatalkan', updated_at = ?1 WHERE id_notifikasi = ?2 AND status = 'Menunggu';",
            params![now, id_notifikasi],
        )
        .map_err(|e| CommandError::new("DB_ERROR", format!("Gagal membatalkan notifikasi: {e}")))?;

    if updated > 0 {
        let payload = json!({
            "id_notifikasi": id_notifikasi,
            "alasan": alasan,
        });
        sync::enqueue(
            tx,
            client_id,
            "wa-notification",
            "cancel",
            id_notifikasi,
            &payload,
            None,
        )?;
    }

    Ok(())
}

pub fn queue_wa_notification(state: &DesktopState, draft: &Value) -> Result<Value, CommandError> {
    let client_id = sync::ensure_client_id(state)?;
    let mut conn = storage::database(&state.data_dir)?;
    let tx = conn.transaction().map_err(|_| CommandError::internal())?;

    let id = queue_wa_notification_tx(&tx, &client_id, draft)?;
    tx.commit().map_err(|_| CommandError::internal())?;

    Ok(json!({ "sukses": true, "id_notifikasi": id }))
}

pub fn cancel_wa_notification(
    state: &DesktopState,
    id_notifikasi: &str,
    alasan: Option<&str>,
) -> Result<Value, CommandError> {
    let client_id = sync::ensure_client_id(state)?;
    let mut conn = storage::database(&state.data_dir)?;
    let tx = conn.transaction().map_err(|_| CommandError::internal())?;

    cancel_wa_notification_tx(&tx, &client_id, id_notifikasi, alasan)?;
    tx.commit().map_err(|_| CommandError::internal())?;

    Ok(json!({ "sukses": true }))
}

/// Antrean WhatsApp dari SQLite lokal.
///
/// `only_unsynced` membatasi hasilnya pada baris yang event outbox-nya masih
/// menggantung — yaitu baris yang BELUM ada di cloud. Mode itu dipakai
/// `desktop_list_wa_notifications`, yang membaca cloud sebagai sumber utama
/// lalu menambahkan baris-baris ini di atasnya, supaya terminal pemindai yang
/// sedang offline tetap melihat antrean buatannya sendiri.
///
/// Tanpa penyaring itu, penggabungannya akan menghidupkan kembali baris yang
/// sudah dipangkas retensi di cloud.
pub fn list_wa_notifications(
    state: &DesktopState,
    status_filter: Option<&str>,
    jenis_filter: Option<&str>,
    id_siswa_filter: Option<&str>,
    tanggal_filter: Option<&str>,
    limit: Option<i64>,
    only_unsynced: bool,
) -> Result<Value, CommandError> {
    let conn = storage::database(&state.data_dir)?;
    let mut query = String::from(
        r#"
        SELECT n.id_notifikasi, n.dedupe_key, n.jenis, n.id_siswa, n.tujuan_nomor,
               n.isi_pesan, n.status, n.attempt_count, n.last_error, n.sent_at,
               n.created_at, n.updated_at,
               COALESCE(s.nama_lengkap, m.nama, '') AS nama_siswa,
               COALESCE(r.nama_rombel, m.divisi, '') AS nama_rombel
        FROM notifikasi_wa n
        LEFT JOIN siswa_data s ON s.id_siswa = n.id_siswa
        LEFT JOIN akademik_rombel r ON r.id_rombel = s.id_rombel
        LEFT JOIN master_data m ON m.id_unik = n.id_siswa
        WHERE 1=1
        "#,
    );

    let mut param_values: Vec<String> = Vec::new();

    if let Some(status) = status_filter.filter(|s| !s.trim().is_empty() && *s != "Semua") {
        query.push_str(" AND n.status = ?");
        param_values.push(status.trim().to_string());
    }
    if let Some(jenis) = jenis_filter.filter(|j| !j.trim().is_empty() && *j != "Semua") {
        query.push_str(" AND n.jenis = ?");
        param_values.push(jenis.trim().to_string());
    }
    if let Some(id_siswa) = id_siswa_filter.filter(|id| !id.trim().is_empty()) {
        query.push_str(" AND n.id_siswa = ?");
        param_values.push(id_siswa.trim().to_string());
    }
    if let Some(tanggal) = tanggal_filter.filter(|t| !t.trim().is_empty()) {
        query.push_str(" AND n.created_at LIKE ?");
        param_values.push(format!("{}%", tanggal.trim()));
    }

    if only_unsynced {
        query.push_str(
            r#" AND EXISTS (
                SELECT 1 FROM desktop_sync_outbox o
                WHERE o.domain = 'wa-notification'
                  AND o.entity_key = n.id_notifikasi
                  AND o.status IN ('pending', 'failed', 'conflict')
            )"#,
        );
    }

    query.push_str(" ORDER BY n.created_at DESC");
    let max_rows = limit.unwrap_or(200).clamp(1, 1000);
    query.push_str(&format!(" LIMIT {max_rows};"));

    let mut stmt = conn.prepare(&query).map_err(|_| CommandError::internal())?;
    let rusqlite_params: Vec<&dyn rusqlite::ToSql> = param_values
        .iter()
        .map(|s| s as &dyn rusqlite::ToSql)
        .collect();

    let rows = stmt
        .query_map(rusqlite_params.as_slice(), |row| {
            Ok(json!({
                "id_notifikasi": row.get::<_, String>(0)?,
                "dedupe_key": row.get::<_, String>(1)?,
                "jenis": row.get::<_, String>(2)?,
                "id_siswa": row.get::<_, Option<String>>(3)?,
                "tujuan_nomor": row.get::<_, String>(4)?,
                "isi_pesan": row.get::<_, String>(5)?,
                "status": row.get::<_, String>(6)?,
                "attempt_count": row.get::<_, i64>(7)?,
                "last_error": row.get::<_, Option<String>>(8)?,
                "sent_at": row.get::<_, Option<String>>(9)?,
                "created_at": row.get::<_, String>(10)?,
                "updated_at": row.get::<_, String>(11)?,
                "nama_siswa": row.get::<_, String>(12)?,
                "nama_rombel": row.get::<_, String>(13)?,
            }))
        })
        .map_err(|_| CommandError::internal())?
        .filter_map(Result::ok)
        .collect::<Vec<_>>();

    Ok(json!({ "items": rows }))
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
        (dir, state)
    }

    /// Vektor kembar dengan `wa-notification.test.ts`. Keduanya WAJIB memetakan
    /// jenis ke kunci yang sama persis: satu database dilayani Web dan Desktop
    /// bergantian, dan kunci yang berbeda akan membuat sakelar yang dimatikan di
    /// satu layar tidak berlaku di terminal lain.
    #[test]
    fn kunci_sakelar_notifikasi_sesuai_vektor() {
        let vektor = [
            ("scan_masuk", Some("wa_notify_scan_masuk")),
            ("scan_pulang", Some("wa_notify_scan_pulang")),
            ("bolos", Some("wa_notify_bolos")),
            ("ambang_alfa", Some("wa_notify_ambang_alfa")),
            ("", None),
            ("Scan_Masuk", None),
            ("broadcast", None),
        ];
        for (jenis, harapan) in vektor {
            assert_eq!(
                wa_notify_setting_key(jenis),
                harapan,
                "pemetaan kunci untuk jenis '{jenis}' menyimpang",
            );
        }
    }

    /// Kunci yang belum pernah ditulis berarti MATI.
    ///
    /// Inilah yang membuat pemasangan yang sudah berjalan tidak tiba-tiba
    /// menimbun antrean notifikasi hanya karena aplikasinya diperbarui.
    #[test]
    fn sakelar_notifikasi_bawaannya_mati() {
        let mut settings = HashMap::new();
        for jenis in ["scan_masuk", "scan_pulang", "bolos", "ambang_alfa"] {
            assert!(
                !wa_notify_enabled(&settings, jenis),
                "jenis '{jenis}' menyala padahal kuncinya belum pernah ditulis",
            );
        }

        settings.insert(WA_NOTIFY_SCAN_MASUK_KEY.to_string(), "true".to_string());
        assert!(wa_notify_enabled(&settings, "scan_masuk"));
        // Menyalakan satu jenis tidak boleh menyalakan jenis lain.
        assert!(!wa_notify_enabled(&settings, "scan_pulang"));

        // Nilai selain "true" berarti mati, dan jenis asing selalu mati.
        settings.insert(WA_NOTIFY_BOLOS_KEY.to_string(), "1".to_string());
        assert!(!wa_notify_enabled(&settings, "bolos"));
        settings.insert(WA_NOTIFY_BOLOS_KEY.to_string(), "TRUE".to_string());
        assert!(wa_notify_enabled(&settings, "bolos"));
        assert!(!wa_notify_enabled(&settings, "jenis_yang_tidak_ada"));
    }

    /// Status asing DITOLAK, bukan diam-diam menjadi `Menunggu`.
    ///
    /// `Menunggu` adalah satu-satunya status yang benar-benar dikirim, jadi
    /// menormalkannya mengubah bug klien menjadi pesan WhatsApp ke nomor wali
    /// seorang siswa — dan pesan yang sudah terkirim tidak bisa ditarik.
    #[test]
    fn status_notifikasi_asing_ditolak_bukan_dinormalkan() {
        let (_dir, state) = setup_test_state();
        let mut connection = storage::database(&state.data_dir).expect("open db");
        let tx = connection.transaction().expect("transaction");

        let draft = json!({
            "dedupe_key": "uji:1",
            "jenis": "scan_masuk",
            "id_siswa": "sis_01",
            "tujuan_nomor": "081234567890",
            "isi_pesan": "halo",
            "status": "Terkirim Sebagian",
        });
        let hasil = queue_wa_notification_tx(&tx, "cli_1", &draft);
        let galat = hasil.expect_err("status asing wajib ditolak");
        assert_eq!(galat.code, "VALIDATION_ERROR");

        // Keempat nilai kanonik tetap diterima.
        for status in ["Menunggu", "Terkirim", "Gagal", "Dibatalkan"] {
            let draft = json!({
                "dedupe_key": format!("uji:{status}"),
                "jenis": "scan_masuk",
                "id_siswa": "sis_01",
                "tujuan_nomor": "081234567890",
                "isi_pesan": "halo",
                "status": status,
            });
            queue_wa_notification_tx(&tx, "cli_1", &draft)
                .unwrap_or_else(|e| panic!("status '{status}' seharusnya sah: {e:?}"));
        }
    }

    /// Pemangkasan hanya menyentuh baris berstatus akhir yang sudah tua DAN
    /// tidak lagi punya event outbox yang menunggu.
    #[test]
    fn pemangkasan_hanya_baris_selesai_dan_sudah_terkirim() {
        let (_dir, state) = setup_test_state();
        let connection = storage::database(&state.data_dir).expect("open db");

        let lama = format!("-{} days", WA_QUEUE_RETENTION_DAYS + 5);
        let baru = "-1 days";
        let baris = [
            ("n_lama_terkirim", "Terkirim", lama.as_str()),
            ("n_lama_dibatalkan", "Dibatalkan", lama.as_str()),
            ("n_lama_menunggu", "Menunggu", lama.as_str()),
            ("n_lama_gagal", "Gagal", lama.as_str()),
            ("n_baru_terkirim", "Terkirim", baru),
            ("n_lama_terkirim_outbox", "Terkirim", lama.as_str()),
        ];
        for (id, status, umur) in baris {
            connection
                .execute(
                    r#"INSERT INTO notifikasi_wa (
                        id_notifikasi, dedupe_key, jenis, id_siswa, tujuan_nomor,
                        isi_pesan, status, attempt_count, created_at, updated_at
                    ) VALUES (?1, ?1, 'scan_masuk', 'sis_01', '+628123456789',
                              'pesan', ?2, 0, datetime('now', ?3), datetime('now', ?3));"#,
                    params![id, status, umur],
                )
                .expect("seed notifikasi");
        }

        // Satu baris masih punya event outbox tertunda: menghapusnya lebih dulu
        // akan membuat event yang sudah antre menunjuk baris yang tidak ada.
        connection
            .execute(
                r#"INSERT INTO desktop_sync_outbox (
                    event_id, client_id, domain, operation, entity_key,
                    payload_json, status, attempt_count, created_at, updated_at
                ) VALUES ('ev_1', 'cli_1', 'wa-notification', 'queue',
                          'n_lama_terkirim_outbox', '{}', 'pending', 0, 0, 0);"#,
                [],
            )
            .expect("seed outbox");

        let dihapus = purge_expired_notifications(&connection).expect("purge");
        assert_eq!(dihapus, 2, "hanya dua baris yang memenuhi syarat");

        let tersisa: Vec<String> = connection
            .prepare("SELECT id_notifikasi FROM notifikasi_wa ORDER BY id_notifikasi;")
            .expect("prepare")
            .query_map([], |row| row.get(0))
            .expect("query")
            .filter_map(Result::ok)
            .collect();
        assert_eq!(
            tersisa,
            vec![
                "n_baru_terkirim".to_string(),
                "n_lama_gagal".to_string(),
                "n_lama_menunggu".to_string(),
                "n_lama_terkirim_outbox".to_string(),
            ],
        );
    }

    #[test]
    fn test_phone_normalization() {
        assert_eq!(normalize_phone_canonical("081234567890"), "+6281234567890");
        assert_eq!(normalize_phone_canonical("6281234567890"), "+6281234567890");
        assert_eq!(
            normalize_phone_canonical("+6281234567890"),
            "+6281234567890"
        );
        assert_eq!(
            normalize_phone_canonical("0812-3456-7890"),
            "+6281234567890"
        );
        assert_eq!(
            normalize_phone_canonical("+62 812 3456 7890"),
            "+6281234567890"
        );
        assert!(is_valid_phone("081234567890"));
        assert!(!is_valid_phone("12345"));
    }

    #[test]
    fn test_wa_notification_lifecycle() {
        let (_dir, state) = setup_test_state();

        let draft = json!({
            "dedupe_key": "scan:sesi_001",
            "jenis": "scan_masuk",
            "id_siswa": "siswa_01",
            "tujuan_nomor": "081234567890",
            "isi_pesan": "Ananda telah hadir di sekolah.",
        });

        let res = queue_wa_notification(&state, &draft).expect("queue notification");
        assert_eq!(res["sukses"], true);
        let id = res["id_notifikasi"].as_str().expect("id string");
        assert!(id.starts_with("wa_"));

        let list = list_wa_notifications(&state, None, None, None, None, None, false)
            .expect("list notifications");
        let items = list["items"].as_array().expect("array");
        assert_eq!(items.len(), 1);
        assert_eq!(items[0]["status"], "Menunggu");
        assert_eq!(items[0]["tujuan_nomor"], "+6281234567890");

        let cancel_res = cancel_wa_notification(&state, id, Some("Dibatalkan penguji"))
            .expect("cancel notification");
        assert_eq!(cancel_res["sukses"], true);

        let list_after = list_wa_notifications(&state, None, None, None, None, None, false)
            .expect("list notifications");
        let items_after = list_after["items"].as_array().expect("array");
        assert_eq!(items_after[0]["status"], "Dibatalkan");
    }
}
