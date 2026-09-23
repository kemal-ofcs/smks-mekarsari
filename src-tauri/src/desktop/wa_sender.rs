//! Pengirim antrean notifikasi WhatsApp dari Desktop/Mobile.
//!
//! Dulu pengirimnya hanya ada di TypeScript (`drainWaQueue` di server Next.js),
//! sehingga pada mode server database sendiri dan database lokal tidak satu
//! pesan pun pernah terkirim. Modul ini cerminan `drainWaQueue`
//! (`wa-sender.ts`) dan `sendViaProvider` (`wa-provider.ts`); aturan murninya —
//! keputusan per baris, status setelah gagal, dan bentuk permintaan provider —
//! diuji dengan vektor yang sama di kedua bahasa.
//!
//! Web dan perangkat kini bisa menguras antrean bersamaan, jadi setiap baris
//! DIKLAIM secara atomik sebelum dikirim (`klaim_oleh`/`klaim_sampai`, schema
//! v34). Tanpa klaim, dua pengirim yang membaca baris `Menunggu` yang sama
//! sama-sama mengirim pesan ke nomor wali — dan pesan itu tidak bisa ditarik.

use std::collections::{HashMap, HashSet};
use std::time::Duration;

use reqwest::header::AUTHORIZATION;
use serde_json::{json, Value};

use super::{
    models::CommandError,
    turso::TursoClient,
    wa_notification::{WA_AUTO_SEND_KEY, WA_QUEUE_RETENTION_DAYS},
};

/// Percobaan kirim sebelum baris menjadi `Gagal`. Sama dengan
/// `WA_BATAS_PERCOBAAN` di `wa-sender.ts`.
pub const WA_SEND_ATTEMPTS_MAX: i64 = 3;

/// Baris per siklus kuras. Sama dengan batas route Web.
const WA_DRAIN_BATCH: i64 = 25;

/// Satu permintaan kirim ke gateway boleh menunggu selama ini. Klien HTTP
/// bawaan menunggu hingga 60 detik; satu provider yang lambat tidak boleh
/// membekukan seluruh antrean selama itu.
const WA_SEND_TIMEOUT: Duration = Duration::from_secs(15);

/// Jeda antar-pesan supaya nomor pengirim tidak diblokir provider.
const WA_SEND_THROTTLE: Duration = Duration::from_millis(500);

/// Konfigurasi gateway. API key-nya hanya dipakai di sini dan tidak pernah
/// dikembalikan ke frontend (`get_wa_config` menyamarkannya).
pub struct WaConfig {
    pub provider: String,
    pub api_key: String,
    pub api_url: Option<String>,
    pub sender_number: Option<String>,
    pub is_active: bool,
    pub daily_limit: i64,
    /// Sakelar per jenis notifikasi, berkunci nilai `notifikasi_wa.jenis`.
    pub enabled: HashMap<String, bool>,
}

/// Keputusan untuk satu baris antrean.
#[derive(Debug, PartialEq, Eq)]
pub enum RowAction {
    Send,
    /// Jenisnya sedang dimatikan: DIBATALKAN, bukan dilewati. Baris yang
    /// dilewati tetap `Menunggu` selamanya dan memakan jatah `LIMIT` tiap siklus.
    CancelDisabled,
    /// `dedupe_key` yang sama sudah dikirim di siklus ini.
    CancelDuplicate,
}

/// Cerminan `aksiBarisAntrean` di `wa-sender.ts`.
pub fn row_action(
    jenis: &str,
    enabled: &HashMap<String, bool>,
    seen: &mut HashSet<String>,
    dedupe_key: &str,
) -> RowAction {
    if !enabled.get(jenis).copied().unwrap_or(false) {
        return RowAction::CancelDisabled;
    }
    if !seen.insert(dedupe_key.to_owned()) {
        return RowAction::CancelDuplicate;
    }
    RowAction::Send
}

/// Status dan jumlah percobaan setelah pengiriman gagal. Cerminan
/// `statusSetelahGagal` di `wa-sender.ts`.
pub fn status_after_failure(attempts_before: i64) -> (&'static str, i64) {
    let attempts = attempts_before + 1;
    let status = if attempts >= WA_SEND_ATTEMPTS_MAX {
        "Gagal"
    } else {
        "Menunggu"
    };
    (status, attempts)
}

/// Satu permintaan HTTP ke gateway, tanpa efek samping.
#[derive(Debug, PartialEq)]
pub struct ProviderRequest {
    pub url: String,
    pub authorization: String,
    pub body: Value,
    pub label: &'static str,
}

/// Bentuk permintaan per provider. Cerminan `buatPermintaanProvider` di
/// `wa-provider.ts`: provider yang tidak dikenal diperlakukan sebagai custom.
pub fn provider_request(
    config: &WaConfig,
    target_phone: &str,
    message: &str,
) -> Result<ProviderRequest, String> {
    let bare: String = target_phone.chars().filter(char::is_ascii_digit).collect();
    let custom_url = config
        .api_url
        .as_deref()
        .map(str::trim)
        .filter(|url| !url.is_empty());
    match config.provider.as_str() {
        "fonnte" => Ok(ProviderRequest {
            url: custom_url
                .unwrap_or("https://api.fonnte.com/send")
                .to_owned(),
            authorization: config.api_key.clone(),
            body: json!({ "target": bare, "message": message, "countryCode": "62" }),
            label: "Fonnte",
        }),
        "wablas" => Ok(ProviderRequest {
            url: custom_url
                .unwrap_or("https://tegal.wablas.com/api/send-message")
                .to_owned(),
            authorization: config.api_key.clone(),
            body: json!({ "phone": bare, "message": message }),
            label: "Wablas",
        }),
        _ => {
            let url = custom_url.ok_or_else(|| "URL custom endpoint belum diisi.".to_owned())?;
            Ok(ProviderRequest {
                url: url.to_owned(),
                authorization: format!("Bearer {}", config.api_key),
                body: json!({
                    "target": bare,
                    "phone": bare,
                    "message": message,
                    "device": config.sender_number,
                }),
                label: "Custom Gateway",
            })
        }
    }
}

/// Fonnte menjawab HTTP 200 dengan `status: false` saat menolak pesan.
fn fonnte_rejection(body: &str) -> Option<String> {
    let data: Value = serde_json::from_str(body).ok()?;
    if data.get("status") != Some(&Value::Bool(false)) {
        return None;
    }
    Some(
        ["reason", "detail"]
            .iter()
            .find_map(|key| {
                data.get(*key)
                    .and_then(Value::as_str)
                    .filter(|reason| !reason.is_empty())
            })
            .unwrap_or("Penolakan dari server Fonnte")
            .to_owned(),
    )
}

async fn send(http: &reqwest::Client, request: &ProviderRequest) -> Result<(), String> {
    let response = http
        .post(&request.url)
        .header(AUTHORIZATION, &request.authorization)
        .json(&request.body)
        .timeout(WA_SEND_TIMEOUT)
        .send()
        .await
        .map_err(|error| format!("{} tidak dapat dihubungi: {error}", request.label))?;
    let status = response.status();
    let body = response.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(format!(
            "{} HTTP {}: {}",
            request.label,
            status.as_u16(),
            body.chars().take(200).collect::<String>()
        ));
    }
    if request.label == "Fonnte" {
        if let Some(reason) = fonnte_rejection(&body) {
            return Err(reason);
        }
    }
    Ok(())
}

fn text(row: &HashMap<String, Value>, key: &str) -> String {
    match row.get(key) {
        Some(Value::String(value)) => value.trim().to_owned(),
        Some(Value::Null) | None => String::new(),
        Some(other) => other.to_string(),
    }
}

fn int(row: &HashMap<String, Value>, key: &str, fallback: i64) -> i64 {
    match row.get(key) {
        Some(Value::Number(value)) => value.as_i64().unwrap_or(fallback),
        Some(Value::String(value)) => value.trim().parse().unwrap_or(fallback),
        _ => fallback,
    }
}

async fn read_config(turso: &TursoClient) -> Result<Option<WaConfig>, CommandError> {
    let Some(row) = turso
        .query_one(
            "SELECT provider, api_key, api_url, sender_number, is_active, daily_limit, scan_masuk_enabled, scan_pulang_enabled, bolos_enabled, ambang_alfa_enabled, koreksi_admin_enabled, import_manual_enabled FROM app_wa_config WHERE id = 'default' LIMIT 1;",
            vec![],
        )
        .await?
        .to_objects()
        .into_iter()
        .next()
    else {
        return Ok(None);
    };
    let flag = |key: &str, fallback: i64| int(&row, key, fallback) == 1;
    let enabled = [
        ("scan_masuk", flag("scan_masuk_enabled", 0)),
        ("scan_pulang", flag("scan_pulang_enabled", 0)),
        ("bolos", flag("bolos_enabled", 1)),
        ("ambang_alfa", flag("ambang_alfa_enabled", 1)),
        ("koreksi_admin", flag("koreksi_admin_enabled", 0)),
        ("import_manual", flag("import_manual_enabled", 0)),
    ]
    .into_iter()
    .map(|(jenis, on)| (jenis.to_owned(), on))
    .collect();
    let provider = text(&row, "provider");
    let optional = |key: &str| Some(text(&row, key)).filter(|value| !value.is_empty());
    Ok(Some(WaConfig {
        provider: if provider.is_empty() {
            "fonnte".to_owned()
        } else {
            provider
        },
        api_key: text(&row, "api_key"),
        api_url: optional("api_url"),
        sender_number: optional("sender_number"),
        is_active: flag("is_active", 0),
        daily_limit: int(&row, "daily_limit", 1000),
        enabled,
    }))
}

fn result(
    sukses: bool,
    counts: [i64; 5],
    purged: u64,
    skipped_quota: bool,
    message: String,
) -> Value {
    let [processed, sent, cancelled_dedupe, cancelled_disabled, failed] = counts;
    json!({
        "sukses": sukses,
        "processed": processed,
        "sent": sent,
        "cancelled_dedupe": cancelled_dedupe,
        "cancelled_disabled": cancelled_disabled,
        "failed": failed,
        "purged": purged,
        "skipped_quota": skipped_quota,
        "message": message,
    })
}

/// Kuras satu batch antrean di database yang dikonfigurasi (Turso, `sqld`,
/// atau hub lokal). `sender_id` menandai klaim pengirim ini — `client_id`
/// perangkat — supaya hanya ia yang boleh menutup baris yang diklaimnya.
///
/// `otomatis` = dipanggil runner, bukan tombol. Runner hanya boleh mengirim
/// bila sakelar "Kirim otomatis" menyala; tombol manual tidak terpengaruh.
pub async fn drain(
    turso: &TursoClient,
    http: &reqwest::Client,
    sender_id: &str,
    otomatis: bool,
) -> Result<Value, CommandError> {
    turso.ensure_schema_current().await?;

    if otomatis {
        let auto_on = turso
            .query_one(
                "SELECT value FROM setting_gex_system WHERE key = ? LIMIT 1;",
                vec![json!(WA_AUTO_SEND_KEY)],
            )
            .await?
            .to_objects()
            .first()
            .is_some_and(|row| text(row, "value").eq_ignore_ascii_case("true"));
        if !auto_on {
            return Ok(result(
                true,
                [0; 5],
                0,
                false,
                "Kirim otomatis dimatikan.".into(),
            ));
        }
    }

    // Pemangkasan retensi LEBIH DULU, sebelum setiap cabang keluar awal:
    // pemasangan yang gateway-nya belum aktif justru yang antreannya menumpuk.
    let purged = turso
        .query_one(
            "DELETE FROM notifikasi_wa WHERE status IN ('Terkirim', 'Dibatalkan') AND created_at < datetime('now', ?);",
            vec![json!(format!("-{WA_QUEUE_RETENTION_DAYS} days"))],
        )
        .await?
        .rows_affected;

    let Some(config) = read_config(turso).await?.filter(|config| config.is_active) else {
        return Ok(result(
            false,
            [0; 5],
            purged,
            false,
            "Gateway WhatsApp belum diaktifkan (isActive = 0).".into(),
        ));
    };
    if config.api_key.is_empty() {
        return Ok(result(
            false,
            [0; 5],
            purged,
            false,
            "API Key WhatsApp Gateway belum dikonfigurasi.".into(),
        ));
    }

    // Kuota dihitung per tanggal WIB, dari jam database — bukan jam perangkat.
    let sent_today = turso
        .query_one(
            "SELECT COUNT(*) AS total FROM notifikasi_wa WHERE status = 'Terkirim' AND sent_at LIKE date('now', '+7 hours') || '%';",
            vec![],
        )
        .await?
        .to_objects()
        .first()
        .map(|row| int(row, "total", 0))
        .unwrap_or(0);
    if sent_today >= config.daily_limit {
        return Ok(result(
            true,
            [0; 5],
            purged,
            true,
            format!(
                "Batas kuota harian tercapai ({sent_today}/{} pesan hari ini).",
                config.daily_limit
            ),
        ));
    }

    let rows = turso
        .query_one(
            "SELECT id_notifikasi, dedupe_key, jenis, tujuan_nomor, isi_pesan, attempt_count FROM notifikasi_wa WHERE status = 'Menunggu' AND (klaim_sampai IS NULL OR klaim_sampai < datetime('now')) ORDER BY created_at ASC LIMIT ?;",
            vec![json!(WA_DRAIN_BATCH.min(config.daily_limit - sent_today))],
        )
        .await?
        .to_objects();
    if rows.is_empty() {
        return Ok(result(
            true,
            [0; 5],
            purged,
            false,
            "Tidak ada pesan dalam antrean menunggu.".into(),
        ));
    }

    let (mut sent, mut cancelled_dedupe, mut cancelled_disabled, mut failed) = (0, 0, 0, 0);
    let mut seen = HashSet::new();
    for row in &rows {
        let id = text(row, "id_notifikasi");
        let jenis = text(row, "jenis");
        let action = row_action(&jenis, &config.enabled, &mut seen, &text(row, "dedupe_key"));
        if action != RowAction::Send {
            let disabled = action == RowAction::CancelDisabled;
            let reason = if disabled {
                format!("Jenis notifikasi '{jenis}' sedang dimatikan")
            } else {
                "Deduplikasi di titik kirim".to_owned()
            };
            // Baris yang sedang diklaim pengirim lain tidak disentuh: pengirim
            // itu yang menutupnya.
            let changed = turso
                .query_one(
                    "UPDATE notifikasi_wa SET status = 'Dibatalkan', last_error = ?, updated_at = datetime('now') WHERE id_notifikasi = ? AND status = 'Menunggu' AND (klaim_sampai IS NULL OR klaim_sampai < datetime('now'));",
                    vec![json!(reason), json!(id)],
                )
                .await?
                .rows_affected;
            if changed > 0 {
                if disabled {
                    cancelled_disabled += 1;
                } else {
                    cancelled_dedupe += 1;
                }
            }
            continue;
        }

        // Klaim atomik: hanya pengirim yang berhasil mengubah baris ini yang
        // boleh mengirimnya. Klaim kedaluwarsa sendiri setelah 5 menit, jadi
        // pengirim yang mati di tengah jalan tidak menyumbat antrean.
        let claimed = turso
            .query_one(
                "UPDATE notifikasi_wa SET klaim_oleh = ?, klaim_sampai = datetime('now', '+5 minutes') WHERE id_notifikasi = ? AND status = 'Menunggu' AND (klaim_sampai IS NULL OR klaim_sampai < datetime('now'));",
                vec![json!(sender_id), json!(id)],
            )
            .await?
            .rows_affected;
        if claimed == 0 {
            continue;
        }

        let outcome =
            match provider_request(&config, &text(row, "tujuan_nomor"), &text(row, "isi_pesan")) {
                Ok(request) => send(http, &request).await,
                Err(error) => Err(error),
            };
        match outcome {
            Ok(()) => {
                turso
                    .query_one(
                        "UPDATE notifikasi_wa SET status = 'Terkirim', sent_at = datetime('now', '+7 hours'), updated_at = datetime('now'), klaim_oleh = NULL, klaim_sampai = NULL WHERE id_notifikasi = ? AND klaim_oleh = ?;",
                        vec![json!(id), json!(sender_id)],
                    )
                    .await?;
                sent += 1;
            }
            Err(error) => {
                let (status, attempts) = status_after_failure(int(row, "attempt_count", 0));
                turso
                    .query_one(
                        "UPDATE notifikasi_wa SET status = ?, attempt_count = ?, last_error = ?, updated_at = datetime('now'), klaim_oleh = NULL, klaim_sampai = NULL WHERE id_notifikasi = ? AND klaim_oleh = ?;",
                        vec![
                            json!(status),
                            json!(attempts),
                            json!(error.chars().take(500).collect::<String>()),
                            json!(id),
                            json!(sender_id),
                        ],
                    )
                    .await?;
                failed += 1;
            }
        }
        tokio::time::sleep(WA_SEND_THROTTLE).await;
    }

    Ok(result(
        true,
        [
            i64::try_from(rows.len()).unwrap_or(i64::MAX),
            sent,
            cancelled_dedupe,
            cancelled_disabled,
            failed,
        ],
        purged,
        false,
        format!(
            "Pengurasan antrean selesai: {sent} terkirim, {cancelled_dedupe} dibatalkan (dedupe), {cancelled_disabled} dibatalkan (jenis nonaktif), {failed} gagal, {purged} dipangkas."
        ),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn config(provider: &str, api_url: Option<&str>) -> WaConfig {
        WaConfig {
            provider: provider.to_owned(),
            api_key: "KUNCI".to_owned(),
            api_url: api_url.map(str::to_owned),
            sender_number: Some("628111".to_owned()),
            is_active: true,
            daily_limit: 1000,
            enabled: [("scan_masuk", true), ("bolos", false)]
                .into_iter()
                .map(|(jenis, on)| (jenis.to_owned(), on))
                .collect(),
        }
    }

    // Vektor yang sama diuji di `wa-sender.test.ts`.
    #[test]
    fn keputusan_baris_antrean() {
        let enabled = config("fonnte", None).enabled;
        let mut seen = HashSet::new();
        assert_eq!(
            row_action("scan_masuk", &enabled, &mut seen, "d1"),
            RowAction::Send
        );
        assert_eq!(
            row_action("scan_masuk", &enabled, &mut seen, "d1"),
            RowAction::CancelDuplicate
        );
        assert_eq!(
            row_action("bolos", &enabled, &mut seen, "d2"),
            RowAction::CancelDisabled
        );
        // Jenis yang tidak dikenal peta sakelar: dibatalkan, tidak pernah dikirim.
        assert_eq!(
            row_action("jenis_baru", &enabled, &mut seen, "d3"),
            RowAction::CancelDisabled
        );
    }

    #[test]
    fn status_setelah_gagal() {
        assert_eq!(status_after_failure(0), ("Menunggu", 1));
        assert_eq!(status_after_failure(1), ("Menunggu", 2));
        assert_eq!(status_after_failure(2), ("Gagal", 3));
    }

    // Vektor yang sama diuji di `wa-provider.test.ts`.
    #[test]
    fn permintaan_per_provider() {
        let fonnte = provider_request(&config("fonnte", None), "+62 812-3456", "Halo").unwrap();
        assert_eq!(fonnte.url, "https://api.fonnte.com/send");
        assert_eq!(fonnte.authorization, "KUNCI");
        assert_eq!(
            fonnte.body,
            json!({ "target": "628123456", "message": "Halo", "countryCode": "62" })
        );

        let wablas = provider_request(
            &config("wablas", Some(" https://x.test/kirim ")),
            "0812",
            "Hai",
        )
        .unwrap();
        assert_eq!(wablas.url, "https://x.test/kirim");
        assert_eq!(wablas.body, json!({ "phone": "0812", "message": "Hai" }));

        let custom =
            provider_request(&config("custom", Some("https://gw.test")), "62812", "Yo").unwrap();
        assert_eq!(custom.authorization, "Bearer KUNCI");
        assert_eq!(
            custom.body,
            json!({ "target": "62812", "phone": "62812", "message": "Yo", "device": "628111" })
        );

        assert_eq!(
            provider_request(&config("custom", Some("  ")), "62812", "Yo").unwrap_err(),
            "URL custom endpoint belum diisi."
        );
    }

    #[test]
    fn penolakan_fonnte_dibaca_dari_badan_respons() {
        assert_eq!(
            fonnte_rejection(r#"{"status":false,"reason":"nomor tidak valid"}"#),
            Some("nomor tidak valid".to_owned())
        );
        assert_eq!(fonnte_rejection(r#"{"status":true}"#), None);
        assert_eq!(fonnte_rejection("bukan json"), None);
    }
}
