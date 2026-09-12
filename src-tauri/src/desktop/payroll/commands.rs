use rusqlite::{params, Connection, OptionalExtension};
use rust_decimal::prelude::*;
use rust_decimal::Decimal;
use serde_json::{json, Value};
use tauri::State;

use super::engine::PayrollCalculator;
use std::collections::HashMap;

use super::models::{
    BpjsRule, ComponentSubject, JpRate, OvertimeTierRule, PayrollAuditLog, PayrollComponent,
    PayrollItem, PayrollRecapRow, PayrollRun, PayrollStatus, SalaryConfig, TaughtSession, TaxRule,
};
use crate::desktop::config::DesktopState;
use crate::desktop::models::CommandError;
use crate::desktop::storage;
use crate::desktop::sync;

fn require_permission(
    state: &DesktopState,
    permission: &str,
) -> Result<crate::desktop::models::OperatorUser, CommandError> {
    let session = state.session.lock().map_err(|_| CommandError::internal())?;
    let session = session.as_ref().ok_or_else(|| {
        CommandError::new(
            "DESKTOP_SESSION_MISSING",
            "Session Desktop tidak tersedia. Silakan login kembali.",
        )
    })?;
    if !session.operator.is_superadmin
        && !session
            .operator
            .permissions
            .iter()
            .any(|key| key == permission)
    {
        return Err(CommandError::new(
            "DESKTOP_ACCESS_DENIED",
            "Akses ditolak untuk tindakan ini.",
        ));
    }
    Ok(session.operator.clone())
}

fn iso_now_tx(tx: &rusqlite::Transaction<'_>) -> String {
    tx.query_row("SELECT strftime('%Y-%m-%dT%H:%M:%SZ', 'now');", [], |r| {
        r.get(0)
    })
    .unwrap_or_else(|_| format!("epoch-{}", storage::now_epoch_seconds()))
}

/// Id baris BPJS yang sudah memakai `component_code` ini, atau id baru.
///
/// `bpjs_rules` unik per kode dan INSERT-nya menimpa lewat kode itu dengan id
/// LAMA; tanpa ini outbox mengantrekan id yang tidak dimiliki baris mana pun.
fn bpjs_rule_id(
    tx: &rusqlite::Transaction<'_>,
    requested_id: &str,
    component_code: &str,
) -> Result<String, CommandError> {
    if !requested_id.trim().is_empty() {
        return Ok(requested_id.to_string());
    }
    let existing = tx
        .query_row(
            "SELECT id FROM bpjs_rules WHERE component_code = ?1;",
            params![component_code],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|_| CommandError::internal())?;
    Ok(existing.unwrap_or_else(|| {
        new_payroll_id(&format!("bpjs-{}", component_code.to_lowercase()))
    }))
}

/// Id baris payroll dibuat KLIEN: `<awalan>-<detik epoch>-<48 bit acak>`.
///
/// Dulu hanya `<awalan>-<detik epoch>`, dan itu bertabrakan di tiga tempat:
/// (1) fungsi simpan MASSAL (`save_*_rules`) memberi id yang SAMA ke setiap
/// baris baru dalam satu loop, sehingga baris berikutnya menimpa yang pertama
/// lewat `ON CONFLICT(id)`; (2) dua perangkat yang menyimpan pada detik yang
/// sama menghasilkan id sama, dan cloud menolak push kedua dengan pelanggaran
/// PK — outbox-nya macet permanen; (3) dua transisi status batch dalam satu
/// detik menabrakkan id `payroll_audit_logs`. Detiknya dipertahankan supaya id
/// tetap terbaca dan terurut kira-kira menurut waktu.
fn new_payroll_id(prefix: &str) -> String {
    let mut bytes = [0u8; 6];
    rand_core::RngCore::fill_bytes(&mut rand_core::OsRng, &mut bytes);
    format!(
        "{prefix}-{}-{}",
        storage::now_epoch_seconds(),
        hex::encode(bytes)
    )
}

/// Kunci sakelar lembur guru di `setting_gex_system`.
///
/// Ikut sinkronisasi: ini kebijakan sekolah, bukan setelan perangkat, sehingga
/// TIDAK boleh masuk `sync::DEVICE_LOCAL_SETTING_KEYS`. Cerminan
/// `TEACHER_OVERTIME_SETTING_KEY` di `src/lib/validations/payroll-policy.ts`.
pub const TEACHER_OVERTIME_SETTING_KEY: &str = "payroll_lembur_guru_aktif";

/// Apakah lembur guru dihitung pada pemasangan ini?
///
/// Kunci yang BELUM ADA berarti MENYALA, bentuk yang sama dengan
/// `auto_alfa_aktif`: lembur guru sudah terhitung sejak sebelum sakelar ini
/// ada, dan pemasangan yang sedang berjalan tidak boleh diam-diam kehilangan
/// komponen gaji hanya karena aplikasinya diperbarui. Mematikannya harus
/// menjadi keputusan sadar sekolahnya.
///
/// Cerminan `parseTeacherOvertimeSetting` di `payroll-policy.ts`.
fn teacher_overtime_enabled(conn: &Connection) -> Result<bool, CommandError> {
    let value: Option<String> = conn
        .query_row(
            "SELECT value FROM setting_gex_system WHERE key = ?1 LIMIT 1;",
            params![TEACHER_OVERTIME_SETTING_KEY],
            |row| row.get(0),
        )
        .optional()
        .map_err(|_| CommandError::internal())?;
    Ok(value
        .map(|raw| raw.trim().eq_ignore_ascii_case("true"))
        .unwrap_or(true))
}

/// Nilai `payroll_components.applies_to` untuk komponen yang berlaku umum.
pub const APPLIES_TO_ALL: &str = "ALL";

/// Bentuk kanonik `payroll_components.applies_to`.
///
/// Kosong berarti berlaku untuk semua, dan itu HARUS menjadi "ALL" yang
/// literal: `calculate_components` membandingkan kolom ini dengan "ALL" persis,
/// sehingga string kosong membuat komponennya tidak pernah berlaku untuk siapa
/// pun — dan itu tidak terlihat salah di layar mana pun.
///
/// Cerminan `normalizeAppliesTo` di `src/lib/validations/payroll-policy.ts`.
fn normalize_applies_to(raw: &str) -> String {
    let value = raw.trim();
    if value.is_empty() || value.eq_ignore_ascii_case(APPLIES_TO_ALL) {
        return APPLIES_TO_ALL.to_string();
    }
    if let Some((prefix, isi)) = value.split_once(':') {
        let prefix = prefix.trim().to_ascii_uppercase();
        let isi = isi.trim();
        if APPLIES_TO_GROUP_PREFIXES.contains(&prefix.as_str()) {
            // Isi kelompok TIDAK diseragamkan huruf besar-kecilnya: nama divisi
            // ditulis manusia ("Tata Usaha"), dan menampilkannya kembali
            // sebagai "TATA USAHA" membuat layar terasa bukan miliknya.
            // Perbandingannya yang mengabaikan huruf besar-kecil.
            return if isi.is_empty() {
                APPLIES_TO_ALL.to_string()
            } else {
                format!("{prefix}:{isi}")
            };
        }
    }
    value.to_string()
}

/// Awalan kelompok yang dikenali `applies_to`. Cerminan
/// `APPLIES_TO_GROUP_PREFIXES` di `src/lib/validations/payroll-policy.ts`.
const APPLIES_TO_GROUP_PREFIXES: &[&str] = &["PERSONIL", "STATUS", "DIVISI"];

/// Jenis perhitungan komponen. WAJIB sama dengan CHECK constraint di ketiga
/// jalur provisioning, enum Zod `sync-schema.ts`, dan `PAYROLL_CALC_TYPES` di
/// `payroll-policy.ts`.
const PAYROLL_CALC_TYPES: &[&str] = &["FIXED", "PERCENTAGE", "PER_JP", "PER_HADIR"];

/// Apakah `master_data.jenis_personil` ini seorang guru?
///
/// Kolomnya tersimpan dengan ejaan berbeda-beda ('GURU' dari alur akademik,
/// 'Guru' dari normalisasi), jadi ia tidak pernah boleh dibandingkan mentah.
/// Cerminan `isTeacherPersonnel` di `payroll-policy.ts`.
fn is_teacher_personnel(jenis_personil: &str) -> bool {
    jenis_personil.trim().eq_ignore_ascii_case("guru")
}

#[tauri::command]
pub async fn desktop_get_salary_configs(
    state: State<'_, DesktopState>,
    search: Option<String>,
) -> Result<Vec<SalaryConfig>, CommandError> {
    require_permission(&state, "payroll.view")?;
    let conn = storage::database(&state.data_dir)?;

    let search_pattern = search
        .as_deref()
        .map(|s| format!("%{}%", s.trim()))
        .unwrap_or_else(|| "%".to_string());

    let mut stmt = conn
        .prepare(
            r#"
            SELECT sc.id, sc.id_karyawan, sc.rate_per_hour, sc.rate_per_jp, sc.ptkp_status,
                   sc.effective_date, sc.created_by, sc.created_at
            FROM salary_configs sc
            LEFT JOIN master_data md ON md.id_unik = sc.id_karyawan
            WHERE (?1 = '%' OR COALESCE(md.nama, '') LIKE ?1 OR COALESCE(md.kode_karyawan, '') LIKE ?1 OR sc.id_karyawan LIKE ?1)
            ORDER BY sc.effective_date DESC;
            "#,
        )
        .map_err(|_| CommandError::internal())?;

    let rows = stmt
        .query_map(params![search_pattern], |row| {
            Ok(SalaryConfig {
                id: row.get(0)?,
                id_karyawan: row.get(1)?,
                rate_per_hour: row.get(2)?,
                rate_per_jp: row.get(3)?,
                ptkp_status: row.get(4)?,
                effective_date: row.get(5)?,
                created_by: row.get(6)?,
                created_at: row.get(7)?,
            })
        })
        .map_err(|_| CommandError::internal())?;

    let mut list = Vec::new();
    for item in rows {
        if let Ok(config) = item {
            list.push(config);
        }
    }
    Ok(list)
}

#[tauri::command]
pub async fn desktop_save_salary_config(
    state: State<'_, DesktopState>,
    draft: SalaryConfig,
) -> Result<bool, CommandError> {
    let operator = require_permission(&state, "payroll.config.manage")?;
    let mut conn = storage::database(&state.data_dir)?;

    let tx = conn.transaction().map_err(|_| CommandError::internal())?;
    // Rate unik per (karyawan, tanggal berlaku) dan INSERT di bawah menimpa
    // baris lama lewat kunci alami itu — dengan id LAMA. Tanpa pencarian ini,
    // outbox mengantrekan id baru yang tidak dimiliki baris mana pun.
    let config_id = if draft.id.trim().is_empty() {
        tx.query_row(
            "SELECT id FROM salary_configs WHERE id_karyawan = ?1 AND effective_date = ?2;",
            params![draft.id_karyawan, draft.effective_date],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|_| CommandError::internal())?
        .unwrap_or_else(|| new_payroll_id("sc"))
    } else {
        draft.id.clone()
    };
    let now = iso_now_tx(&tx);

    tx.execute(
        r#"
        INSERT INTO salary_configs (
            id, id_karyawan, rate_per_hour, rate_per_jp, ptkp_status, effective_date, created_by, created_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
        ON CONFLICT(id_karyawan, effective_date) DO UPDATE SET
            rate_per_hour = excluded.rate_per_hour,
            rate_per_jp = excluded.rate_per_jp,
            ptkp_status = excluded.ptkp_status,
            created_by = excluded.created_by;
        "#,
        params![
            config_id,
            draft.id_karyawan,
            draft.rate_per_hour,
            draft.rate_per_jp.max(0),
            draft.ptkp_status,
            draft.effective_date,
            operator.username,
            now
        ],
    )
    .map_err(|_| CommandError::new("SAVE_FAILED", "Gagal menyimpan konfigurasi gaji karyawan."))?;

    let client_id = sync::ensure_client_id(&state)?;
    sync::enqueue(
        &tx,
        &client_id,
        "payroll",
        "salary-config",
        &config_id,
        &json!({
            "id": config_id,
            "id_karyawan": draft.id_karyawan.clone(),
            "rate_per_hour": draft.rate_per_hour,
            "rate_per_jp": draft.rate_per_jp.max(0),
            "ptkp_status": draft.ptkp_status.clone(),
            "effective_date": draft.effective_date.clone(),
            "created_by": operator.username.clone(),
            "created_at": now.clone(),
        }),
        None,
    )?;

    tx.commit().map_err(|_| CommandError::internal())?;
    Ok(true)
}

#[tauri::command]
pub async fn desktop_delete_salary_config(
    state: State<'_, DesktopState>,
    id: String,
) -> Result<bool, CommandError> {
    require_permission(&state, "payroll.config.manage")?;
    let mut conn = storage::database(&state.data_dir)?;
    let tx = conn.transaction().map_err(|_| CommandError::internal())?;

    tx.execute("DELETE FROM salary_configs WHERE id = ?1;", params![id])
        .map_err(|_| {
            CommandError::new(
                "DELETE_FAILED",
                "Gagal menghapus konfigurasi gaji karyawan.",
            )
        })?;

    let client_id = sync::ensure_client_id(&state)?;
    sync::enqueue(
        &tx,
        &client_id,
        "payroll",
        "delete",
        &format!("salary_configs:{id}"),
        &json!({ "table": "salary_configs", "id": id }),
        None,
    )?;

    tx.commit().map_err(|_| CommandError::internal())?;
    Ok(true)
}

#[tauri::command]
pub async fn desktop_get_overtime_rules(
    state: State<'_, DesktopState>,
) -> Result<Vec<OvertimeTierRule>, CommandError> {
    require_permission(&state, "payroll.view")?;
    let conn = storage::database(&state.data_dir)?;

    let mut stmt = conn
        .prepare(
            r#"
            SELECT id, rule_type, tier_order, hour_start, hour_end, multiplier, is_active
            FROM overtime_tier_rules
            ORDER BY rule_type, tier_order ASC;
            "#,
        )
        .map_err(|_| CommandError::internal())?;

    let rows = stmt
        .query_map([], |row| {
            Ok(OvertimeTierRule {
                id: row.get(0)?,
                rule_type: row.get(1)?,
                tier_order: row.get(2)?,
                hour_start: row.get(3)?,
                hour_end: row.get(4)?,
                multiplier: row.get(5)?,
                is_active: row.get(6)?,
            })
        })
        .map_err(|_| CommandError::internal())?;

    let mut list = Vec::new();
    for item in rows {
        if let Ok(rule) = item {
            list.push(rule);
        }
    }
    Ok(list)
}

#[tauri::command]
pub async fn desktop_save_overtime_rule(
    state: State<'_, DesktopState>,
    draft: OvertimeTierRule,
) -> Result<bool, CommandError> {
    require_permission(&state, "payroll.config.manage")?;
    let mut conn = storage::database(&state.data_dir)?;
    let tx = conn.transaction().map_err(|_| CommandError::internal())?;

    let rule_id = if draft.id.trim().is_empty() {
        new_payroll_id(&format!("ot-{}", draft.rule_type.to_lowercase()))
    } else {
        draft.id.clone()
    };

    tx.execute(
        r#"
        INSERT INTO overtime_tier_rules (
            id, rule_type, tier_order, hour_start, hour_end, multiplier, is_active
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
        ON CONFLICT(id) DO UPDATE SET
            rule_type = excluded.rule_type,
            tier_order = excluded.tier_order,
            hour_start = excluded.hour_start,
            hour_end = excluded.hour_end,
            multiplier = excluded.multiplier,
            is_active = excluded.is_active;
        "#,
        params![
            rule_id,
            draft.rule_type,
            draft.tier_order,
            draft.hour_start,
            draft.hour_end,
            draft.multiplier,
            draft.is_active
        ],
    )
    .map_err(|_| CommandError::new("SAVE_FAILED", "Gagal menyimpan jenjang lembur."))?;

    let client_id = sync::ensure_client_id(&state)?;
    sync::enqueue(
        &tx,
        &client_id,
        "payroll",
        "overtime-rule",
        &rule_id,
        &json!({
            "id": rule_id,
            "rule_type": draft.rule_type.clone(),
            "tier_order": draft.tier_order,
            "hour_start": draft.hour_start,
            "hour_end": draft.hour_end,
            "multiplier": draft.multiplier,
            "is_active": draft.is_active,
        }),
        None,
    )?;

    tx.commit().map_err(|_| CommandError::internal())?;
    Ok(true)
}

#[tauri::command]
pub async fn desktop_delete_overtime_rule(
    state: State<'_, DesktopState>,
    id: String,
) -> Result<bool, CommandError> {
    require_permission(&state, "payroll.config.manage")?;
    let mut conn = storage::database(&state.data_dir)?;
    let tx = conn.transaction().map_err(|_| CommandError::internal())?;

    tx.execute(
        "DELETE FROM overtime_tier_rules WHERE id = ?1;",
        params![id],
    )
    .map_err(|_| CommandError::new("DELETE_FAILED", "Gagal menghapus jenjang lembur."))?;

    let client_id = sync::ensure_client_id(&state)?;
    sync::enqueue(
        &tx,
        &client_id,
        "payroll",
        "delete",
        &format!("overtime_tier_rules:{id}"),
        &json!({ "table": "overtime_tier_rules", "id": id }),
        None,
    )?;

    tx.commit().map_err(|_| CommandError::internal())?;
    Ok(true)
}

#[tauri::command]
pub async fn desktop_save_overtime_rules(
    state: State<'_, DesktopState>,
    rules: Vec<OvertimeTierRule>,
) -> Result<bool, CommandError> {
    require_permission(&state, "payroll.config.manage")?;
    let mut conn = storage::database(&state.data_dir)?;
    let tx = conn.transaction().map_err(|_| CommandError::internal())?;
    let client_id = sync::ensure_client_id(&state)?;

    for rule in rules {
        let rule_id = if rule.id.trim().is_empty() {
            new_payroll_id(&format!("ot-{}", rule.rule_type.to_lowercase()))
        } else {
            rule.id.clone()
        };

        tx.execute(
            r#"
            INSERT INTO overtime_tier_rules (
                id, rule_type, tier_order, hour_start, hour_end, multiplier, is_active
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
            ON CONFLICT(id) DO UPDATE SET
                rule_type = excluded.rule_type,
                tier_order = excluded.tier_order,
                hour_start = excluded.hour_start,
                hour_end = excluded.hour_end,
                multiplier = excluded.multiplier,
                is_active = excluded.is_active;
            "#,
            params![
                rule_id,
                rule.rule_type,
                rule.tier_order,
                rule.hour_start,
                rule.hour_end,
                rule.multiplier,
                rule.is_active
            ],
        )
        .map_err(|_| CommandError::new("SAVE_FAILED", "Gagal memperbarui jenjang lembur."))?;

        sync::enqueue(
            &tx,
            &client_id,
            "payroll",
            "overtime-rule",
            &rule_id,
            &json!({
                "id": rule_id,
                "rule_type": rule.rule_type.clone(),
                "tier_order": rule.tier_order,
                "hour_start": rule.hour_start,
                "hour_end": rule.hour_end,
                "multiplier": rule.multiplier,
                "is_active": rule.is_active,
            }),
            None,
        )?;
    }

    tx.commit().map_err(|_| CommandError::internal())?;
    Ok(true)
}

/// Seluruh sesi mengajar yang JP-nya dihitung pada satu periode, per guru.
///
/// Syaratnya satu: jurnal mengajarnya SUDAH DIPARAF. Paraf itu bukti bahwa
/// pelajarannya benar berlangsung, dan sesi yang dibuat lalu ditinggalkan tanpa
/// jurnal tidak pernah menghasilkan honor.
///
/// Dipakai `EXISTS`, bukan JOIN: `jurnal_mengajar` tidak punya UNIQUE pada
/// `id_presensi_mapel`, sehingga dua perangkat offline bisa menulis dua jurnal
/// untuk sesi yang sama — dan JOIN akan menggandakan sesinya menjadi dua kali
/// honor.
///
/// Tanpa LIMIT: dipatok jendela tanggal periode payroll di kedua ujungnya.
fn load_taught_sessions(
    conn: &Connection,
    period_start: &str,
    period_end: &str,
) -> Result<HashMap<String, Vec<TaughtSession>>, CommandError> {
    let mut stmt = conn
        .prepare(
            r#"
            -- batas: dijepit satu periode payroll (sebulan) di kedua ujung tanggal, dan di dalamnya jumlah baris dibatasi jumlah rombel dikali jam pelajaran per hari — bukan oleh waktu. LIMIT justru berbahaya di sini: memotong sesi berarti memotong honor guru tanpa satu pun tanda.
            SELECT pm.id_presensi_mapel, pm.id_guru, pm.id_mapel, pm.tanggal, pm.jam_ke
            FROM presensi_mapel pm
            WHERE pm.tanggal >= ?1 AND pm.tanggal <= ?2
              AND EXISTS (
                SELECT 1 FROM jurnal_mengajar j
                WHERE j.id_presensi_mapel = pm.id_presensi_mapel
                  AND j.paraf_at IS NOT NULL AND TRIM(j.paraf_at) <> ''
              )
            ORDER BY pm.tanggal, pm.jam_ke;
            "#,
        )
        .map_err(|_| CommandError::internal())?;

    let rows = stmt
        .query_map(params![period_start, period_end], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
            ))
        })
        .map_err(|_| CommandError::internal())?;

    let mut per_guru: HashMap<String, Vec<TaughtSession>> = HashMap::new();
    for item in rows.flatten() {
        let (id_presensi_mapel, id_guru, id_mapel, tanggal, jam_ke) = item;
        // `jam_ke` yang tidak terbaca dilewati, bukan dianggap satu JP: baris
        // lama bisa memuat teks apa pun, dan menebaknya berarti menebak uang.
        let Some((awal, akhir)) = crate::desktop::class_attendance::jam_ke_range(&jam_ke) else {
            continue;
        };
        per_guru
            .entry(id_guru)
            .or_default()
            .push(TaughtSession {
                id_presensi_mapel,
                id_mapel,
                tanggal,
                jam_awal: awal,
                jam_akhir: akhir,
            });
    }
    Ok(per_guru)
}

/// Seluruh tarif JP yang pernah berlaku. Tabelnya sekecil daftar mata
/// pelajaran, jadi dibaca utuh sekali per rekap alih-alih per sesi.
fn load_jp_rates(conn: &Connection) -> Result<Vec<JpRate>, CommandError> {
    let mut stmt = conn
        .prepare(
            r#"
            SELECT id, id_mapel, id_guru, rate_per_jp, effective_date, status_aktif, updated_at
            FROM tarif_jp
            ORDER BY id_mapel, effective_date DESC;
            "#,
        )
        .map_err(|_| CommandError::internal())?;

    let rows = stmt
        .query_map([], |row| {
            Ok(JpRate {
                id: row.get(0)?,
                id_mapel: row.get(1)?,
                id_guru: row.get(2)?,
                rate_per_jp: row.get(3)?,
                effective_date: row.get(4)?,
                status_aktif: row.get(5)?,
                updated_at: row.get(6)?,
            })
        })
        .map_err(|_| CommandError::internal())?;

    Ok(rows.flatten().collect())
}

#[tauri::command]
pub async fn desktop_get_teacher_overtime_policy(
    state: State<'_, DesktopState>,
) -> Result<Value, CommandError> {
    require_permission(&state, "payroll.view")?;
    let conn = storage::database(&state.data_dir)?;
    Ok(json!({ "enabled": teacher_overtime_enabled(&conn)? }))
}

#[tauri::command]
pub async fn desktop_save_teacher_overtime_policy(
    state: State<'_, DesktopState>,
    enabled: bool,
) -> Result<Value, CommandError> {
    require_permission(&state, "payroll.config.manage")?;
    let client_id = sync::ensure_client_id(&state)?;
    let value = if enabled { "true" } else { "false" };

    let mut conn = storage::database(&state.data_dir)?;
    let tx = conn.transaction().map_err(|_| CommandError::internal())?;

    tx.execute(
        "INSERT INTO setting_gex_system (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value;",
        params![TEACHER_OVERTIME_SETTING_KEY, value],
    )
    .map_err(|_| CommandError::new("SAVE_FAILED", "Gagal menyimpan sakelar lembur guru."))?;

    // Antrean lama untuk kunci yang sama dibuang lebih dulu, sama seperti
    // `save_alfa_settings`: tanpa itu sebuah event "true" yang gagal terkirim
    // bisa menyusul event "false" yang baru dan menghidupkan ulang lemburnya.
    let _ = tx.execute(
        "DELETE FROM desktop_sync_conflict WHERE domain = 'setting' AND entity_key = ?1;",
        params![TEACHER_OVERTIME_SETTING_KEY],
    );
    let _ = tx.execute(
        "DELETE FROM desktop_sync_outbox WHERE domain = 'setting' AND entity_key = ?1
         AND status IN ('pending', 'failed', 'conflict');",
        params![TEACHER_OVERTIME_SETTING_KEY],
    );

    sync::enqueue(
        &tx,
        &client_id,
        "setting",
        "update",
        TEACHER_OVERTIME_SETTING_KEY,
        &json!({ "key": TEACHER_OVERTIME_SETTING_KEY, "value": value }),
        None,
    )?;

    tx.commit().map_err(|_| CommandError::internal())?;
    Ok(json!({ "sukses": true, "enabled": enabled }))
}

#[tauri::command]
pub async fn desktop_get_jp_rates(state: State<'_, DesktopState>) -> Result<Value, CommandError> {
    require_permission(&state, "payroll.view")?;
    let conn = storage::database(&state.data_dir)?;

    // Tanpa LIMIT: `tarif_jp` sebesar daftar mata pelajaran sekolah, bukan
    // tabel yang tumbuh setiap hari operasional.
    let mut stmt = conn
        .prepare(
            r#"
            SELECT t.id, t.id_mapel, t.id_guru, t.rate_per_jp, t.effective_date,
                   t.status_aktif, t.created_at, t.updated_at,
                   COALESCE(m.nama_mapel, ''), COALESCE(md.nama, '')
            FROM tarif_jp t
            LEFT JOIN akademik_mapel m ON m.id_mapel = t.id_mapel
            LEFT JOIN master_data md ON md.id_unik = t.id_guru
            ORDER BY COALESCE(m.nama_mapel, ''), t.effective_date DESC;
            "#,
        )
        .map_err(|_| CommandError::internal())?;

    let rows = stmt
        .query_map([], |row| {
            Ok(json!({
                "id": row.get::<_, String>(0)?,
                "id_mapel": row.get::<_, String>(1)?,
                "id_guru": row.get::<_, Option<String>>(2)?,
                "rate_per_jp": row.get::<_, i64>(3)?,
                "effective_date": row.get::<_, String>(4)?,
                "status_aktif": row.get::<_, i64>(5)?,
                "created_at": row.get::<_, String>(6)?,
                "updated_at": row.get::<_, String>(7)?,
                "nama_mapel": row.get::<_, String>(8)?,
                "nama_guru": row.get::<_, String>(9)?,
            }))
        })
        .map_err(|_| CommandError::internal())?;

    Ok(Value::Array(rows.flatten().collect()))
}

#[tauri::command]
pub async fn desktop_save_jp_rate(
    state: State<'_, DesktopState>,
    draft: Value,
) -> Result<bool, CommandError> {
    require_permission(&state, "payroll.config.manage")?;

    let text = |key: &str| -> String {
        draft
            .get(key)
            .and_then(Value::as_str)
            .unwrap_or_default()
            .trim()
            .to_string()
    };

    let id_mapel = text("id_mapel");
    let effective_date = text("effective_date");
    let id_guru = {
        let value = text("id_guru");
        if value.is_empty() {
            None
        } else {
            Some(value)
        }
    };
    let rate_per_jp = draft
        .get("rate_per_jp")
        .and_then(Value::as_i64)
        .unwrap_or(-1);
    let status_aktif = draft
        .get("status_aktif")
        .and_then(Value::as_i64)
        .unwrap_or(1);

    if id_mapel.is_empty() || effective_date.is_empty() {
        return Err(CommandError::new(
            "VALIDATION_ERROR",
            "Mata pelajaran dan tanggal berlaku wajib diisi.",
        ));
    }
    if rate_per_jp < 0 {
        return Err(CommandError::new(
            "VALIDATION_ERROR",
            "Tarif per jam pelajaran tidak boleh kurang dari nol.",
        ));
    }
    if !(0..=1).contains(&status_aktif) {
        return Err(CommandError::new(
            "VALIDATION_ERROR",
            "Status aktif hanya boleh 0 atau 1.",
        ));
    }

    let mut conn = storage::database(&state.data_dir)?;
    let tx = conn.transaction().map_err(|_| CommandError::internal())?;

    // Mapel dan guru diverifikasi ke master datanya, bukan dipercaya dari
    // formulir: tarif yang menunjuk mapel yang sudah dihapus tidak akan pernah
    // terpakai, dan itu hanya terlihat sebagai honor yang diam-diam nol.
    let mapel_ada: bool = tx
        .prepare("SELECT 1 FROM akademik_mapel WHERE id_mapel = ?1 LIMIT 1;")
        .map_err(|_| CommandError::internal())?
        .exists(params![id_mapel])
        .map_err(|_| CommandError::internal())?;
    if !mapel_ada {
        return Err(CommandError::new(
            "VALIDATION_ERROR",
            "Mata pelajaran tidak ditemukan.",
        ));
    }
    if let Some(guru) = id_guru.as_ref() {
        let guru_ada: bool = tx
            .prepare(
                "SELECT 1 FROM master_data
                 WHERE id_unik = ?1
                   AND LOWER(TRIM(COALESCE(jenis_personil, ''))) = 'guru'
                 LIMIT 1;",
            )
            .map_err(|_| CommandError::internal())?
            .exists(params![guru])
            .map_err(|_| CommandError::internal())?;
        if !guru_ada {
            return Err(CommandError::new(
                "VALIDATION_ERROR",
                "Guru tidak ditemukan pada data personil.",
            ));
        }
    }

    let now = iso_now_tx(&tx);
    let id = {
        let value = text("id");
        if value.is_empty() {
            new_payroll_id("tjp")
        } else {
            value
        }
    };
    let created_at = tx
        .query_row(
            "SELECT created_at FROM tarif_jp WHERE id = ?1;",
            params![id],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|_| CommandError::internal())?
        .unwrap_or_else(|| now.clone());

    tx.execute(
        r#"
        INSERT INTO tarif_jp (
            id, id_mapel, id_guru, rate_per_jp, effective_date, status_aktif, created_at, updated_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
        ON CONFLICT(id) DO UPDATE SET
            id_mapel = excluded.id_mapel,
            id_guru = excluded.id_guru,
            rate_per_jp = excluded.rate_per_jp,
            effective_date = excluded.effective_date,
            status_aktif = excluded.status_aktif,
            updated_at = excluded.updated_at;
        "#,
        params![
            id,
            id_mapel,
            id_guru,
            rate_per_jp,
            effective_date,
            status_aktif,
            created_at,
            now
        ],
    )
    .map_err(|_| CommandError::new("SAVE_FAILED", "Gagal menyimpan tarif jam pelajaran."))?;

    let client_id = sync::ensure_client_id(&state)?;
    sync::enqueue(
        &tx,
        &client_id,
        "payroll",
        "jp-rate",
        &id,
        &json!({
            "id": id,
            "id_mapel": id_mapel,
            "id_guru": id_guru,
            "rate_per_jp": rate_per_jp,
            "effective_date": effective_date,
            "status_aktif": status_aktif,
            "created_at": created_at,
            "updated_at": now,
        }),
        None,
    )?;

    tx.commit().map_err(|_| CommandError::internal())?;
    Ok(true)
}

#[tauri::command]
pub async fn desktop_delete_jp_rate(
    state: State<'_, DesktopState>,
    id: String,
) -> Result<bool, CommandError> {
    require_permission(&state, "payroll.config.manage")?;
    let mut conn = storage::database(&state.data_dir)?;
    let tx = conn.transaction().map_err(|_| CommandError::internal())?;

    tx.execute("DELETE FROM tarif_jp WHERE id = ?1;", params![id])
        .map_err(|_| CommandError::new("DELETE_FAILED", "Gagal menghapus tarif jam pelajaran."))?;

    let client_id = sync::ensure_client_id(&state)?;
    sync::enqueue(
        &tx,
        &client_id,
        "payroll",
        "delete",
        &format!("tarif_jp:{id}"),
        &json!({ "table": "tarif_jp", "id": id }),
        None,
    )?;

    tx.commit().map_err(|_| CommandError::internal())?;
    Ok(true)
}

#[tauri::command]
pub async fn desktop_get_payroll_components(
    state: State<'_, DesktopState>,
) -> Result<Vec<PayrollComponent>, CommandError> {
    require_permission(&state, "payroll.view")?;
    let conn = storage::database(&state.data_dir)?;

    let mut stmt = conn
        .prepare(
            r#"
            SELECT id, name, category, calc_type, default_value, applies_to, is_active
            FROM payroll_components
            ORDER BY category, name ASC;
            "#,
        )
        .map_err(|_| CommandError::internal())?;

    let rows = stmt
        .query_map([], |row| {
            Ok(PayrollComponent {
                id: row.get(0)?,
                name: row.get(1)?,
                category: row.get(2)?,
                calc_type: row.get(3)?,
                default_value: row.get(4)?,
                applies_to: row.get(5)?,
                is_active: row.get(6)?,
            })
        })
        .map_err(|_| CommandError::internal())?;

    let mut list = Vec::new();
    for item in rows {
        if let Ok(comp) = item {
            list.push(comp);
        }
    }
    Ok(list)
}

#[tauri::command]
pub async fn desktop_save_payroll_component(
    state: State<'_, DesktopState>,
    draft: PayrollComponent,
) -> Result<bool, CommandError> {
    require_permission(&state, "payroll.config.manage")?;
    let mut conn = storage::database(&state.data_dir)?;
    let tx = conn.transaction().map_err(|_| CommandError::internal())?;

    let comp_id = if draft.id.trim().is_empty() {
        new_payroll_id("comp")
    } else {
        draft.id.clone()
    };

    // Jenis perhitungan divalidasi SEBELUM menyentuh database: nilai asing
    // ditolak CHECK constraint dengan pesan SQLite yang tidak bisa dipahami
    // pengguna, dan pada jalur sinkronisasi penolakan itu mengunci outbox.
    if !PAYROLL_CALC_TYPES.contains(&draft.calc_type.as_str()) {
        return Err(CommandError::new(
            "VALIDATION_ERROR",
            "Jenis perhitungan komponen tidak dikenal.",
        ));
    }

    // Penerima komponen: "ALL" atau satu personil yang benar-benar ada dan
    // bukan siswa. Sebelum ini kolomnya diterima apa adanya, sehingga id yang
    // salah ketik tersimpan sebagai komponen yang tidak pernah berlaku untuk
    // siapa pun — tanpa pesan, dan hanya terlihat sebagai tunjangan yang
    // "hilang" di slip orangnya.
    let applies_to = normalize_applies_to(&draft.applies_to);
    // Bentuk kelompok tidak diverifikasi ke master data: divisi atau status
    // yang hari ini belum dipakai siapa pun boleh saja didaftarkan lebih dulu,
    // dan komponennya tinggal diam sampai ada orangnya. Yang diverifikasi
    // hanyalah bentuk PERORANGAN, karena id yang salah ketik di sana tidak akan
    // pernah cocok dengan siapa pun dan hanya terlihat sebagai tunjangan hilang.
    let bentuk_kelompok = applies_to
        .split_once(':')
        .map(|(prefix, isi)| {
            APPLIES_TO_GROUP_PREFIXES.contains(&prefix.to_ascii_uppercase().as_str())
                && !isi.trim().is_empty()
        })
        .unwrap_or(false);
    if applies_to != APPLIES_TO_ALL && !bentuk_kelompok {
        let jenis: Option<String> = tx
            .query_row(
                "SELECT COALESCE(jenis_personil, '') FROM master_data WHERE id_unik = ?1;",
                params![applies_to],
                |row| row.get(0),
            )
            .optional()
            .map_err(|_| CommandError::internal())?;
        match jenis {
            None => {
                return Err(CommandError::new(
                    "VALIDATION_ERROR",
                    "Penerima komponen tidak ditemukan pada data personil.",
                ));
            }
            Some(jenis) if jenis.trim().eq_ignore_ascii_case("siswa") => {
                return Err(CommandError::new(
                    "VALIDATION_ERROR",
                    "Siswa tidak menerima komponen payroll.",
                ));
            }
            Some(_) => {}
        }
    }

    tx.execute(
        r#"
        INSERT INTO payroll_components (
            id, name, category, calc_type, default_value, applies_to, is_active
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
        ON CONFLICT(id) DO UPDATE SET
            name = excluded.name,
            category = excluded.category,
            calc_type = excluded.calc_type,
            default_value = excluded.default_value,
            applies_to = excluded.applies_to,
            is_active = excluded.is_active;
        "#,
        params![
            comp_id,
            draft.name,
            draft.category,
            draft.calc_type,
            draft.default_value,
            applies_to,
            draft.is_active
        ],
    )
    .map_err(|_| CommandError::new("SAVE_FAILED", "Gagal menyimpan komponen payroll."))?;

    let client_id = sync::ensure_client_id(&state)?;
    sync::enqueue(
        &tx,
        &client_id,
        "payroll",
        "payroll-component",
        &comp_id,
        &json!({
            "id": comp_id,
            "name": draft.name.clone(),
            "category": draft.category.clone(),
            "calc_type": draft.calc_type.clone(),
            "default_value": draft.default_value,
            "applies_to": applies_to.clone(),
            "is_active": draft.is_active,
        }),
        None,
    )?;

    tx.commit().map_err(|_| CommandError::internal())?;
    Ok(true)
}

#[tauri::command]
pub async fn desktop_delete_payroll_component(
    state: State<'_, DesktopState>,
    id: String,
) -> Result<bool, CommandError> {
    require_permission(&state, "payroll.config.manage")?;
    let mut conn = storage::database(&state.data_dir)?;
    let tx = conn.transaction().map_err(|_| CommandError::internal())?;

    tx.execute("DELETE FROM payroll_components WHERE id = ?1;", params![id])
        .map_err(|_| CommandError::new("DELETE_FAILED", "Gagal menghapus komponen."))?;

    let client_id = sync::ensure_client_id(&state)?;
    sync::enqueue(
        &tx,
        &client_id,
        "payroll",
        "delete",
        &format!("payroll_components:{id}"),
        &json!({ "table": "payroll_components", "id": id }),
        None,
    )?;

    tx.commit().map_err(|_| CommandError::internal())?;
    Ok(true)
}

#[tauri::command]
pub async fn desktop_get_tax_rules(
    state: State<'_, DesktopState>,
) -> Result<Vec<TaxRule>, CommandError> {
    require_permission(&state, "payroll.view")?;
    let conn = storage::database(&state.data_dir)?;

    let mut stmt = conn
        .prepare(
            r#"
            SELECT id, category, bracket_min, bracket_max, rate_percentage, effective_date
            FROM tax_rules
            ORDER BY category, bracket_min ASC;
            "#,
        )
        .map_err(|_| CommandError::internal())?;

    let rows = stmt
        .query_map([], |row| {
            Ok(TaxRule {
                id: row.get(0)?,
                category: row.get(1)?,
                bracket_min: row.get(2)?,
                bracket_max: row.get(3)?,
                rate_percentage: row.get(4)?,
                effective_date: row.get(5)?,
            })
        })
        .map_err(|_| CommandError::internal())?;

    let mut list = Vec::new();
    for item in rows {
        if let Ok(rule) = item {
            list.push(rule);
        }
    }
    Ok(list)
}

#[tauri::command]
pub async fn desktop_save_tax_rule(
    state: State<'_, DesktopState>,
    draft: TaxRule,
) -> Result<bool, CommandError> {
    require_permission(&state, "payroll.config.manage")?;
    let mut conn = storage::database(&state.data_dir)?;
    let tx = conn.transaction().map_err(|_| CommandError::internal())?;

    let rule_id = if draft.id.trim().is_empty() {
        new_payroll_id(&format!("tax-{}", draft.category.to_lowercase()))
    } else {
        draft.id.clone()
    };
    let eff_date = if draft.effective_date.trim().is_empty() {
        iso_now_tx(&tx)[..10].to_string()
    } else {
        draft.effective_date
    };

    tx.execute(
        r#"
        INSERT INTO tax_rules (
            id, category, bracket_min, bracket_max, rate_percentage, effective_date
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
        ON CONFLICT(id) DO UPDATE SET
            category = excluded.category,
            bracket_min = excluded.bracket_min,
            bracket_max = excluded.bracket_max,
            rate_percentage = excluded.rate_percentage,
            effective_date = excluded.effective_date;
        "#,
        params![
            rule_id,
            draft.category,
            draft.bracket_min,
            draft.bracket_max,
            draft.rate_percentage,
            eff_date
        ],
    )
    .map_err(|_| CommandError::new("SAVE_FAILED", "Gagal menyimpan aturan pajak."))?;

    let client_id = sync::ensure_client_id(&state)?;
    sync::enqueue(
        &tx,
        &client_id,
        "payroll",
        "tax-rule",
        &rule_id,
        &json!({
            "id": rule_id,
            "category": draft.category.clone(),
            "bracket_min": draft.bracket_min,
            "bracket_max": draft.bracket_max,
            "rate_percentage": draft.rate_percentage,
            "effective_date": eff_date.clone(),
        }),
        None,
    )?;

    tx.commit().map_err(|_| CommandError::internal())?;
    Ok(true)
}

#[tauri::command]
pub async fn desktop_delete_tax_rule(
    state: State<'_, DesktopState>,
    id: String,
) -> Result<bool, CommandError> {
    require_permission(&state, "payroll.config.manage")?;
    let mut conn = storage::database(&state.data_dir)?;
    let tx = conn.transaction().map_err(|_| CommandError::internal())?;

    tx.execute("DELETE FROM tax_rules WHERE id = ?1;", params![id])
        .map_err(|_| CommandError::new("DELETE_FAILED", "Gagal menghapus aturan pajak."))?;

    let client_id = sync::ensure_client_id(&state)?;
    sync::enqueue(
        &tx,
        &client_id,
        "payroll",
        "delete",
        &format!("tax_rules:{id}"),
        &json!({ "table": "tax_rules", "id": id }),
        None,
    )?;

    tx.commit().map_err(|_| CommandError::internal())?;
    Ok(true)
}

#[tauri::command]
pub async fn desktop_save_tax_rules(
    state: State<'_, DesktopState>,
    rules: Vec<TaxRule>,
) -> Result<bool, CommandError> {
    require_permission(&state, "payroll.config.manage")?;
    let mut conn = storage::database(&state.data_dir)?;
    let tx = conn.transaction().map_err(|_| CommandError::internal())?;
    let client_id = sync::ensure_client_id(&state)?;

    for rule in rules {
        let rule_id = if rule.id.trim().is_empty() {
            new_payroll_id(&format!("tax-{}", rule.category.to_lowercase()))
        } else {
            rule.id.clone()
        };
        let eff_date = if rule.effective_date.trim().is_empty() {
            iso_now_tx(&tx)[..10].to_string()
        } else {
            rule.effective_date.clone()
        };

        tx.execute(
            r#"
            INSERT INTO tax_rules (
                id, category, bracket_min, bracket_max, rate_percentage, effective_date
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
            ON CONFLICT(id) DO UPDATE SET
                category = excluded.category,
                bracket_min = excluded.bracket_min,
                bracket_max = excluded.bracket_max,
                rate_percentage = excluded.rate_percentage,
                effective_date = excluded.effective_date;
            "#,
            params![
                rule_id,
                rule.category,
                rule.bracket_min,
                rule.bracket_max,
                rule.rate_percentage,
                eff_date
            ],
        )
        .map_err(|_| CommandError::new("SAVE_FAILED", "Gagal memperbarui aturan pajak."))?;

        sync::enqueue(
            &tx,
            &client_id,
            "payroll",
            "tax-rule",
            &rule_id,
            &json!({
                "id": rule_id,
                "category": rule.category.clone(),
                "bracket_min": rule.bracket_min,
                "bracket_max": rule.bracket_max,
                "rate_percentage": rule.rate_percentage,
                "effective_date": eff_date.clone(),
            }),
            None,
        )?;
    }

    tx.commit().map_err(|_| CommandError::internal())?;
    Ok(true)
}

#[tauri::command]
pub async fn desktop_save_bpjs_rule(
    state: State<'_, DesktopState>,
    draft: BpjsRule,
) -> Result<bool, CommandError> {
    require_permission(&state, "payroll.config.manage")?;
    let mut conn = storage::database(&state.data_dir)?;
    let tx = conn.transaction().map_err(|_| CommandError::internal())?;

    let rule_id = bpjs_rule_id(&tx, &draft.id, &draft.component_code)?;
    let eff_date = if draft.effective_date.trim().is_empty() {
        iso_now_tx(&tx)[..10].to_string()
    } else {
        draft.effective_date
    };

    tx.execute(
        r#"
        INSERT INTO bpjs_rules (
            id, component_code, component_name, rate_percentage, wage_cap, effective_date
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
        ON CONFLICT(component_code) DO UPDATE SET
            component_name = excluded.component_name,
            rate_percentage = excluded.rate_percentage,
            wage_cap = excluded.wage_cap,
            effective_date = excluded.effective_date;
        "#,
        params![
            rule_id,
            draft.component_code,
            draft.component_name,
            draft.rate_percentage,
            draft.wage_cap,
            eff_date
        ],
    )
    .map_err(|_| CommandError::new("SAVE_FAILED", "Gagal menyimpan aturan BPJS."))?;

    let client_id = sync::ensure_client_id(&state)?;
    sync::enqueue(
        &tx,
        &client_id,
        "payroll",
        "bpjs-rule",
        &rule_id,
        &json!({
            "id": rule_id,
            "component_code": draft.component_code.clone(),
            "component_name": draft.component_name.clone(),
            "rate_percentage": draft.rate_percentage,
            "wage_cap": draft.wage_cap,
            "effective_date": eff_date.clone(),
        }),
        None,
    )?;

    tx.commit().map_err(|_| CommandError::internal())?;
    Ok(true)
}

#[tauri::command]
pub async fn desktop_delete_bpjs_rule(
    state: State<'_, DesktopState>,
    id: String,
) -> Result<bool, CommandError> {
    require_permission(&state, "payroll.config.manage")?;
    let mut conn = storage::database(&state.data_dir)?;
    let tx = conn.transaction().map_err(|_| CommandError::internal())?;

    tx.execute(
        "DELETE FROM bpjs_rules WHERE id = ?1 OR component_code = ?1;",
        params![id],
    )
    .map_err(|_| CommandError::new("DELETE_FAILED", "Gagal menghapus aturan BPJS."))?;

    let client_id = sync::ensure_client_id(&state)?;
    sync::enqueue(
        &tx,
        &client_id,
        "payroll",
        "delete",
        &format!("bpjs_rules:{id}"),
        &json!({ "table": "bpjs_rules", "id": id }),
        None,
    )?;

    tx.commit().map_err(|_| CommandError::internal())?;
    Ok(true)
}

#[tauri::command]
pub async fn desktop_get_bpjs_rules(
    state: State<'_, DesktopState>,
) -> Result<Vec<BpjsRule>, CommandError> {
    require_permission(&state, "payroll.view")?;
    let conn = storage::database(&state.data_dir)?;

    let mut stmt = conn
        .prepare(
            r#"
            SELECT id, component_code, component_name, rate_percentage, wage_cap, effective_date
            FROM bpjs_rules
            ORDER BY component_code ASC;
            "#,
        )
        .map_err(|_| CommandError::internal())?;

    let rows = stmt
        .query_map([], |row| {
            Ok(BpjsRule {
                id: row.get(0)?,
                component_code: row.get(1)?,
                component_name: row.get(2)?,
                rate_percentage: row.get(3)?,
                wage_cap: row.get(4)?,
                effective_date: row.get(5)?,
            })
        })
        .map_err(|_| CommandError::internal())?;

    let mut list = Vec::new();
    for item in rows {
        if let Ok(rule) = item {
            list.push(rule);
        }
    }
    Ok(list)
}

#[tauri::command]
pub async fn desktop_save_bpjs_rules(
    state: State<'_, DesktopState>,
    rules: Vec<BpjsRule>,
) -> Result<bool, CommandError> {
    require_permission(&state, "payroll.config.manage")?;
    let mut conn = storage::database(&state.data_dir)?;
    let tx = conn.transaction().map_err(|_| CommandError::internal())?;
    let client_id = sync::ensure_client_id(&state)?;

    for rule in rules {
        let rule_id = bpjs_rule_id(&tx, &rule.id, &rule.component_code)?;
        let eff_date = if rule.effective_date.trim().is_empty() {
            iso_now_tx(&tx)[..10].to_string()
        } else {
            rule.effective_date.clone()
        };

        tx.execute(
            r#"
            INSERT INTO bpjs_rules (
                id, component_code, component_name, rate_percentage, wage_cap, effective_date
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
            ON CONFLICT(component_code) DO UPDATE SET
                component_name = excluded.component_name,
                rate_percentage = excluded.rate_percentage,
                wage_cap = excluded.wage_cap,
                effective_date = excluded.effective_date;
            "#,
            params![
                rule_id,
                rule.component_code,
                rule.component_name,
                rule.rate_percentage,
                rule.wage_cap,
                eff_date
            ],
        )
        .map_err(|_| CommandError::new("SAVE_FAILED", "Gagal memperbarui aturan BPJS."))?;

        sync::enqueue(
            &tx,
            &client_id,
            "payroll",
            "bpjs-rule",
            &rule_id,
            &json!({
                "id": rule_id,
                "component_code": rule.component_code.clone(),
                "component_name": rule.component_name.clone(),
                "rate_percentage": rule.rate_percentage,
                "wage_cap": rule.wage_cap,
                "effective_date": eff_date.clone(),
            }),
            None,
        )?;
    }

    tx.commit().map_err(|_| CommandError::internal())?;
    Ok(true)
}

#[tauri::command]
pub async fn desktop_get_payroll_recap(
    state: State<'_, DesktopState>,
    period_start: String,
    period_end: String,
) -> Result<Vec<PayrollRecapRow>, CommandError> {
    require_permission(&state, "payroll.view")?;
    let conn = storage::database(&state.data_dir)?;

    let overtime_tiers = load_overtime_tiers(&conn, "HARI_KERJA")?;
    // Jenjang lembur hari libur dikonfigurasi terpisah oleh user di menu
    // "Aturan Jenjang Lembur" (rule_type = 'HARI_LIBUR'). Sebelum ini kedua
    // jenjang itu tersimpan dan bisa disunting, tetapi tidak pernah dibaca
    // siapa pun — seluruh lembur selalu dihitung dengan tarif HARI_KERJA.
    let holiday_tiers = load_overtime_tiers(&conn, "HARI_LIBUR")?;
    let components = load_payroll_components(&conn)?;
    let tax_rules = load_tax_rules(&conn, &period_end)?;
    let bpjs_rules = load_bpjs_rules(&conn, &period_end)?;
    let teacher_overtime = teacher_overtime_enabled(&conn)?;
    let taught_sessions = load_taught_sessions(&conn, &period_start, &period_end)?;
    let jp_rates = load_jp_rates(&conn)?;

    let mut stmt = conn
        .prepare(
            r#"
            SELECT
                md.id_unik,
                md.nama,
                md.divisi,
                COALESCE(md.jenis_personil, '') AS jenis_personil,
                -- Status kepegawaian hanya ada pada guru, dan hanya dipakai
                -- komponen bertujuan kelompok (`STATUS:Honorer`). Kosong untuk
                -- yang bukan guru, sehingga kelompok itu tidak pernah cocok.
                COALESCE(g.status_kepegawaian, '') AS status_kepegawaian,
                COALESCE(sc.rate_per_hour, 0) AS rate_per_hour,
                COALESCE(sc.rate_per_jp, 0) AS rate_per_jp,
                COALESCE(sc.ptkp_status, 'TK/0') AS ptkp_status,
                COUNT(CASE WHEN ah.status_kehadiran IN ('Hadir', 'PRESENT') THEN 1 END) AS total_hadir,
                COALESCE(SUM(ah.menit_terlambat), 0) AS total_terlambat_menit,
                COALESCE(SUM(CASE WHEN hl.tanggal IS NULL THEN ah.jam_kerja ELSE 0 END), 0) AS total_jam_kerja_menit,
                COALESCE(SUM(CASE WHEN hl.tanggal IS NULL THEN ah.lembur ELSE 0 END), 0) AS total_lembur_menit,
                COALESCE(SUM(CASE WHEN hl.tanggal IS NOT NULL
                    THEN COALESCE(ah.jam_kerja, 0) + COALESCE(ah.lembur, 0) ELSE 0 END), 0) AS total_libur_menit,
                -- Jam kerja (tanpa lembur) yang jatuh pada tanggal libur. Hanya
                -- dipakai ketika lembur seseorang dimatikan: menit ini pindah ke
                -- jam reguler supaya hari itu tetap dibayar. Lihat
                -- `apply_overtime_policy`.
                COALESCE(SUM(CASE WHEN hl.tanggal IS NOT NULL
                    THEN COALESCE(ah.jam_kerja, 0) ELSE 0 END), 0) AS total_libur_jam_kerja_menit
            FROM master_data md
            LEFT JOIN guru_data g ON g.id_guru = md.id_unik
            LEFT JOIN salary_configs sc ON sc.id_karyawan = md.id_unik
                AND sc.effective_date = (
                    SELECT MAX(effective_date) FROM salary_configs
                    WHERE id_karyawan = md.id_unik AND effective_date <= ?2
                )
            LEFT JOIN absensi_harian ah ON ah.id_karyawan = md.id_unik
                AND ah.tanggal >= ?1 AND ah.tanggal <= ?2
            -- Penanda hari libur diambil dari tanggal kerja barisnya, BUKAN dari
            -- kolom pada absensi_harian. `tbl_hari_libur.tanggal` UNIQUE sehingga
            -- join ini tidak pernah menggandakan baris, dan absensi lama otomatis
            -- ikut terhitung benar begitu admin melengkapi daftar hari liburnya.
            LEFT JOIN tbl_hari_libur hl ON hl.tanggal = ah.tanggal AND hl.status_aktif = 1
            WHERE md.status_aktif = 'Aktif'
              -- Siswa TIDAK digaji. Mereka hidup di `master_data` yang sama
              -- dengan guru dan karyawan, sehingga tanpa baris ini setiap siswa
              -- aktif ikut masuk rekap dan setiap komponen tunjangan yang
              -- berlaku untuk 'ALL' menerbitkan slip untuk mereka.
              -- Dibandingkan dalam bentuk ternormalisasi karena kolomnya
              -- tersimpan dengan ejaan berbeda-beda ('SISWA', 'Siswa').
              AND LOWER(TRIM(COALESCE(md.jenis_personil, ''))) <> 'siswa'
            GROUP BY md.id_unik
            ORDER BY md.nama ASC;
            "#,
        )
        .map_err(|_| CommandError::internal())?;

    struct TempAgg {
        id_unik: String,
        nama: String,
        divisi: String,
        jenis_personil: String,
        status_kepegawaian: String,
        rate_per_hour: i64,
        rate_per_jp: i64,
        ptkp_status: String,
        total_hadir: i64,
        total_terlambat: i64,
        jam_kerja_menit: i64,
        lembur_menit: i64,
        libur_menit: i64,
        libur_jam_kerja_menit: i64,
    }

    let rows = stmt
        .query_map(params![period_start, period_end], |row| {
            Ok(TempAgg {
                id_unik: row.get(0)?,
                nama: row.get(1)?,
                divisi: row.get(2)?,
                jenis_personil: row.get(3)?,
                status_kepegawaian: row.get(4)?,
                rate_per_hour: row.get(5)?,
                rate_per_jp: row.get(6)?,
                ptkp_status: row.get(7)?,
                total_hadir: row.get(8)?,
                total_terlambat: row.get(9)?,
                jam_kerja_menit: row.get(10)?,
                lembur_menit: row.get(11)?,
                libur_menit: row.get(12)?,
                libur_jam_kerja_menit: row.get(13)?,
            })
        })
        .map_err(|_| CommandError::internal())?;

    let mut result = Vec::new();

    for item in rows {
        if let Ok(agg) = item {
            // Sakelar lembur guru: kebijakan sekolah, dibaca sekali per rekap.
            // Untuk selain guru nilainya tidak pernah berlaku.
            let overtime_allowed = teacher_overtime || !is_teacher_personnel(&agg.jenis_personil);
            let (jam_kerja_menit, lembur_menit, libur_menit) =
                PayrollCalculator::apply_overtime_policy(
                    agg.jam_kerja_menit,
                    agg.lembur_menit,
                    agg.libur_menit,
                    agg.libur_jam_kerja_menit,
                    overtime_allowed,
                );

            let reg_hours = Decimal::from(jam_kerja_menit) / Decimal::from(60);
            let ot_hours = Decimal::from(lembur_menit) / Decimal::from(60);
            let holiday_hours = Decimal::from(libur_menit) / Decimal::from(60);
            let rate_dec = Decimal::from(agg.rate_per_hour);

            // Dua indeks, dua jenjang: jam lembur hari biasa memakai HARI_KERJA,
            // seluruh jam pada tanggal libur memakai HARI_LIBUR. Keduanya
            // dijumlahkan lalu dikalikan rate per jam karyawan SEKALI, supaya
            // pembulatannya sama dengan versi satu-indeks sebelumnya.
            let ot_index = PayrollCalculator::calculate_overtime_index(ot_hours, &overtime_tiers);
            let holiday_index =
                PayrollCalculator::calculate_overtime_index(holiday_hours, &holiday_tiers);
            let basic_salary =
                PayrollCalculator::wage_from_minutes(jam_kerja_menit, agg.rate_per_hour);
            let overtime_salary = ((ot_index + holiday_index) * rate_dec)
                .round_dp_with_strategy(0, RoundingStrategy::MidpointAwayFromZero);

            // Honor mengajar berdiri SENDIRI di samping upah kehadiran: gaji
            // pokok berasal dari jam di sekolah lewat scan gerbang, honor ini
            // dari jam pelajaran yang benar-benar diajar dan sudah diparaf.
            // Guru honorer dengan rate pokok 0 karenanya tetap dibayar.
            let teaching = PayrollCalculator::summarize_teaching(
                taught_sessions
                    .get(&agg.id_unik)
                    .map(Vec::as_slice)
                    .unwrap_or(&[]),
                &jp_rates,
                &agg.id_unik,
                agg.rate_per_jp,
            );
            let teaching_salary = Decimal::from(teaching.honor);

            // Tunjangan persentase tetap dihitung dari GAJI POKOK saja, sesuai
            // label di layar konfigurasinya ("% Gaji Pokok"). Memasukkan honor
            // mengajar ke dasarnya akan diam-diam mengubah arti setiap
            // komponen persen yang sudah dibuat sekolah sebelum fitur ini ada.
            let subject = ComponentSubject {
                id_karyawan: agg.id_unik.clone(),
                jenis_personil: agg.jenis_personil.clone(),
                status_kepegawaian: agg.status_kepegawaian.clone(),
                divisi: agg.divisi.clone(),
                total_teaching_jp: teaching.total_jp,
                total_hadir: agg.total_hadir,
            };
            let (allowance, deduction, _) =
                PayrollCalculator::calculate_components(basic_salary, &components, &subject);

            let gross = basic_salary + overtime_salary + teaching_salary + allowance;
            let (bpjs_emp, _, _) = PayrollCalculator::calculate_bpjs(gross, &bpjs_rules);
            let (pph21, _) =
                PayrollCalculator::calculate_pph21_ter(gross, &agg.ptkp_status, &tax_rules);

            let net = (gross - deduction - bpjs_emp - pph21).max(Decimal::ZERO);

            result.push(PayrollRecapRow {
                id_karyawan: agg.id_unik,
                nama_karyawan: agg.nama,
                divisi: agg.divisi,
                jenis_personil: agg.jenis_personil,
                status_kepegawaian: agg.status_kepegawaian,
                rate_per_hour: agg.rate_per_hour,
                ptkp_status: agg.ptkp_status,
                total_hadir: agg.total_hadir,
                total_terlambat_menit: agg.total_terlambat,
                // Menit mentah ikut dibawa supaya pembekuan bisa menurunkan
                // jamnya dengan cara yang sama persis seperti di sini, alih-alih
                // membaca ulang `f64` di bawah yang presisinya sudah hilang.
                // Menit SETELAH kebijakan lembur, bukan menit mentah: nilai
                // inilah yang dibekukan `desktop_create_payroll_run` ke
                // `payroll_items`. Membawa menit mentah ke sini membuat slip
                // yang dibekukan berbeda dari angka yang dilihat dan disetujui
                // admin di layar rekap.
                total_regular_minutes: jam_kerja_menit,
                total_overtime_minutes: lembur_menit,
                total_holiday_minutes: libur_menit,
                total_regular_hours: reg_hours.to_f64().unwrap_or(0.0),
                total_overtime_hours: ot_hours.to_f64().unwrap_or(0.0),
                total_overtime_index: ot_index.to_f64().unwrap_or(0.0),
                total_holiday_hours: holiday_hours.to_f64().unwrap_or(0.0),
                total_holiday_overtime_index: holiday_index.to_f64().unwrap_or(0.0),
                total_teaching_jp: teaching.total_jp,
                teaching_salary: teaching.honor,
                unrated_teaching_jp: teaching.unrated_jp,
                est_basic_salary: basic_salary.to_i64().unwrap_or(0),
                est_overtime_salary: overtime_salary.to_i64().unwrap_or(0),
                est_gross_salary: gross.to_i64().unwrap_or(0),
                est_total_allowance: allowance.to_i64().unwrap_or(0),
                est_total_deduction: deduction.to_i64().unwrap_or(0),
                est_bpjs_employee: bpjs_emp.to_i64().unwrap_or(0),
                est_pph21: pph21.to_i64().unwrap_or(0),
                est_net_salary: net.to_i64().unwrap_or(0),
            });
        }
    }

    Ok(result)
}

#[tauri::command]
pub async fn desktop_create_payroll_run(
    state: State<'_, DesktopState>,
    idempotency_key: String,
    period_start: String,
    period_end: String,
) -> Result<PayrollRun, CommandError> {
    let operator = require_permission(&state, "payroll.run.create")?;
    let mut conn = storage::database(&state.data_dir)?;

    // Idempotency check: jika key sudah ada, kembalikan data existing
    if let Some(existing) = conn
        .query_row(
            r#"
            SELECT id, idempotency_key, period_start, period_end, status,
                   total_gross_payout, total_net_payout, total_employees,
                   created_by, created_at, updated_at
            FROM payroll_runs
            WHERE idempotency_key = ?1;
            "#,
            params![idempotency_key],
            |row| {
                Ok(PayrollRun {
                    id: row.get(0)?,
                    idempotency_key: row.get(1)?,
                    period_start: row.get(2)?,
                    period_end: row.get(3)?,
                    status: row.get(4)?,
                    total_gross_payout: row.get(5)?,
                    total_net_payout: row.get(6)?,
                    total_employees: row.get(7)?,
                    created_by: row.get(8)?,
                    created_at: row.get(9)?,
                    updated_at: row.get(10)?,
                })
            },
        )
        .optional()
        .map_err(|_| CommandError::internal())?
    {
        return Ok(existing);
    }

    // Kalkulasi data payroll
    let recap =
        desktop_get_payroll_recap(state.clone(), period_start.clone(), period_end.clone()).await?;

    let overtime_tiers = load_overtime_tiers(&conn, "HARI_KERJA")?;
    let holiday_tiers = load_overtime_tiers(&conn, "HARI_LIBUR")?;
    let components = load_payroll_components(&conn)?;
    let tax_rules = load_tax_rules(&conn, &period_end)?;
    let bpjs_rules = load_bpjs_rules(&conn, &period_end)?;

    let tx = conn.transaction().map_err(|_| CommandError::internal())?;

    let run_id = new_payroll_id(&format!("PR-{}", period_start.replace('-', "")));
    let now = iso_now_tx(&tx);

    let mut total_gross_sum = 0i64;
    let mut total_net_sum = 0i64;
    let total_emp_count = recap.len() as i64;
    let mut calculated_items = Vec::new();

    for row in &recap {
        let item_id = format!("{}-{}", run_id, row.id_karyawan);
        // Jam diturunkan dari MENIT MENTAH, sama persis seperti di
        // `desktop_get_payroll_recap`. Bentuk sebelumnya membaca ulang
        // `total_regular_hours` yang bertipe `f64`, dan `from_f64_retain` tidak
        // mengembalikan presisi yang sudah hilang saat pembagian: pratinjau
        // menghitung 11/60 secara eksak sehingga 11 menit pada tarif
        // 18.750/jam menjadi 3.437,5 tepat lalu dibulatkan ke 3.438, sementara
        // pembekuan mendapat 3.437,4999… dan membekukan 3.437.
        //
        // Selisihnya satu rupiah per baris, tetapi ia mengalir ke gross,
        // komponen, BPJS, PPh 21, dan net — dan yang lebih buruk, angka yang
        // DISETUJUI admin bukan angka yang DIBAYARKAN.
        // Jam reguler tidak lagi diturunkan di sini: upahnya dihitung langsung
        // dari menit lewat `wage_from_minutes`. Jam lembur masih diperlukan
        // karena jenjangnya memang dinyatakan dalam jam.
        let ot_hours = Decimal::from(row.total_overtime_minutes) / Decimal::from(60);
        let holiday_hours = Decimal::from(row.total_holiday_minutes) / Decimal::from(60);
        let rate_dec = Decimal::from(row.rate_per_hour);

        let ot_index = PayrollCalculator::calculate_overtime_index(ot_hours, &overtime_tiers);
        let holiday_index =
            PayrollCalculator::calculate_overtime_index(holiday_hours, &holiday_tiers);
        let basic_salary =
            PayrollCalculator::wage_from_minutes(row.total_regular_minutes, row.rate_per_hour);
        let overtime_salary = ((ot_index + holiday_index) * rate_dec)
            .round_dp_with_strategy(0, RoundingStrategy::MidpointAwayFromZero);

        // Honor mengajar dibekukan dari angka yang SUDAH dihitung rekap, bukan
        // dihitung ulang di sini: rekap itulah yang dilihat dan disetujui
        // admin, dan menghitung ulang berarti membuka celah bagi dua angka.
        let teaching_salary = Decimal::from(row.teaching_salary);

        let subject = ComponentSubject {
            id_karyawan: row.id_karyawan.clone(),
            jenis_personil: row.jenis_personil.clone(),
            status_kepegawaian: row.status_kepegawaian.clone(),
            divisi: row.divisi.clone(),
            // Dibaca dari baris REKAP, bukan dihitung ulang: pembekuan harus
            // memakai angka yang sama dengan yang dilihat dan disetujui admin.
            total_teaching_jp: row.total_teaching_jp,
            total_hadir: row.total_hadir,
        };
        let (allowance, deduction, comp_breakdown) =
            PayrollCalculator::calculate_components(basic_salary, &components, &subject);

        let gross = basic_salary + overtime_salary + teaching_salary + allowance;
        let (bpjs_emp, bpjs_co, bpjs_breakdown) =
            PayrollCalculator::calculate_bpjs(gross, &bpjs_rules);
        let (pph21, tax_breakdown) =
            PayrollCalculator::calculate_pph21_ter(gross, &row.ptkp_status, &tax_rules);

        let net = (gross - deduction - bpjs_emp - pph21).max(Decimal::ZERO);

        let snapshot = json!({
            "rate_per_hour": row.rate_per_hour,
            "regular_hours": row.total_regular_hours,
            "overtime_hours": row.total_overtime_hours,
            "overtime_index": ot_index.to_f64().unwrap_or(0.0),
            "holiday_hours": row.total_holiday_hours,
            "holiday_overtime_index": holiday_index.to_f64().unwrap_or(0.0),
            "basic_salary": basic_salary.to_i64().unwrap_or(0),
            "overtime_salary": overtime_salary.to_i64().unwrap_or(0),
            "teaching_jp": row.total_teaching_jp,
            "teaching_salary": row.teaching_salary,
            "components": comp_breakdown,
            "bpjs": bpjs_breakdown,
            "tax": tax_breakdown,
            "calculated_at": now.clone()
        });

        let basic_i64 = basic_salary.to_i64().unwrap_or(0);
        let ot_i64 = overtime_salary.to_i64().unwrap_or(0);
        let gross_i64 = gross.to_i64().unwrap_or(0);
        let allow_i64 = allowance.to_i64().unwrap_or(0);
        let deduct_i64 = deduction.to_i64().unwrap_or(0);
        let bpjs_emp_i64 = bpjs_emp.to_i64().unwrap_or(0);
        let bpjs_co_i64 = bpjs_co.to_i64().unwrap_or(0);
        let pph21_i64 = pph21.to_i64().unwrap_or(0);
        let net_i64 = net.to_i64().unwrap_or(0);

        total_gross_sum += gross_i64;
        total_net_sum += net_i64;

        calculated_items.push((
            item_id,
            row.id_karyawan.clone(),
            row.nama_karyawan.clone(),
            row.divisi.clone(),
            row.ptkp_status.clone(),
            row.total_regular_hours,
            row.total_overtime_hours,
            ot_index.to_f64().unwrap_or(0.0),
            row.total_holiday_hours,
            holiday_index.to_f64().unwrap_or(0.0),
            row.rate_per_hour,
            basic_i64,
            ot_i64,
            gross_i64,
            allow_i64,
            deduct_i64,
            bpjs_emp_i64,
            bpjs_co_i64,
            pph21_i64,
            net_i64,
            snapshot.to_string(),
            // Ditambahkan di UJUNG tuple dengan sengaja: menyisipkannya di
            // tengah akan menggeser setiap indeks `it.N` di bawah tanpa satu
            // pun error kompilasi, karena semuanya bertipe angka.
            row.total_teaching_jp,
            row.teaching_salary,
        ));
    }

    let items_json: Vec<Value> = calculated_items
        .iter()
        .map(|it| {
            json!({
                "id": it.0.clone(),
                "payroll_run_id": run_id.clone(),
                "id_karyawan": it.1.clone(),
                "nama_karyawan": it.2.clone(),
                "divisi": it.3.clone(),
                "ptkp_status": it.4.clone(),
                "total_regular_hours": it.5,
                "total_overtime_hours": it.6,
                "total_overtime_index": it.7,
                "total_holiday_hours": it.8,
                "total_holiday_overtime_index": it.9,
                "total_teaching_jp": it.21,
                "teaching_salary": it.22,
                "rate_per_hour": it.10,
                "basic_salary": it.11,
                "overtime_salary": it.12,
                "gross_salary": it.13,
                "total_allowances": it.14,
                "total_deductions": it.15,
                "bpjs_employee_total": it.16,
                "bpjs_company_total": it.17,
                "pph21_amount": it.18,
                "net_salary": it.19,
                "breakdown_snapshot": it.20.clone(),
                "created_at": now.clone(),
            })
        })
        .collect();

    // 1. Insert parent payroll_runs terlebih dahulu agar lolos foreign key constraint
    tx.execute(
        r#"
        INSERT INTO payroll_runs (
            id, idempotency_key, period_start, period_end, status,
            total_gross_payout, total_net_payout, total_employees,
            created_by, created_at, updated_at
        ) VALUES (?1, ?2, ?3, ?4, 'DRAFT', ?5, ?6, ?7, ?8, ?9, ?10);
        "#,
        params![
            run_id,
            idempotency_key,
            period_start,
            period_end,
            total_gross_sum,
            total_net_sum,
            total_emp_count,
            operator.username,
            now,
            now
        ],
    )
    .map_err(|_| CommandError::new("RUN_FAILED", "Gagal membuat batch payroll baru."))?;

    // 2. Insert child payroll_items dengan relasi foreign key ke payroll_runs(id)
    for it in calculated_items {
        tx.execute(
            r#"
            INSERT INTO payroll_items (
                id, payroll_run_id, id_karyawan, nama_karyawan, divisi, ptkp_status,
                total_regular_hours, total_overtime_hours, total_overtime_index,
                total_holiday_hours, total_holiday_overtime_index,
                total_teaching_jp, teaching_salary,
                rate_per_hour, basic_salary, overtime_salary, gross_salary,
                total_allowances, total_deductions, bpjs_employee_total, bpjs_company_total,
                pph21_amount, net_salary, breakdown_snapshot, created_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24, ?25);
            "#,
            params![
                it.0,
                run_id,
                it.1,
                it.2,
                it.3,
                it.4,
                it.5,
                it.6,
                it.7,
                it.8,
                it.9,
                it.21,
                it.22,
                it.10,
                it.11,
                it.12,
                it.13,
                it.14,
                it.15,
                it.16,
                it.17,
                it.18,
                it.19,
                it.20,
                now
            ],
        )
        .map_err(|_| CommandError::new("RUN_FAILED", "Gagal menyimpan rincian slip gaji karyawan."))?;
    }

    let audit_id = new_payroll_id("audit");
    tx.execute(
        r#"
        INSERT INTO payroll_audit_logs (
            id, payroll_run_id, action, old_status, new_status, performed_by, notes, created_at
        ) VALUES (?1, ?2, 'CREATE_RUN', NULL, 'DRAFT', ?3, 'Batch payroll dibuat.', ?4);
        "#,
        params![audit_id, run_id, operator.username, now],
    )
    .map_err(|_| CommandError::internal())?;

    let client_id = sync::ensure_client_id(&state)?;
    sync::enqueue(
        &tx,
        &client_id,
        "payroll",
        "create-run",
        &run_id,
        &json!({
            "run": {
                "id": run_id.clone(),
                "idempotency_key": idempotency_key.clone(),
                "period_start": period_start.clone(),
                "period_end": period_end.clone(),
                "status": "DRAFT",
                "total_gross_payout": total_gross_sum,
                "total_net_payout": total_net_sum,
                "total_employees": total_emp_count,
                "created_by": operator.username.clone(),
                "created_at": now.clone(),
                "updated_at": now.clone(),
            },
            "items": items_json,
            "audit": {
                "id": audit_id,
                "payroll_run_id": run_id.clone(),
                "action": "CREATE_RUN",
                "old_status": Value::Null,
                "new_status": "DRAFT",
                "performed_by": operator.username.clone(),
                "notes": "Batch payroll dibuat.",
                "created_at": now.clone(),
            },
        }),
        None,
    )?;

    tx.commit().map_err(|_| CommandError::internal())?;

    Ok(PayrollRun {
        id: run_id,
        idempotency_key,
        period_start,
        period_end,
        status: "DRAFT".to_string(),
        total_gross_payout: total_gross_sum,
        total_net_payout: total_net_sum,
        total_employees: total_emp_count,
        created_by: operator.username,
        created_at: now.clone(),
        updated_at: now,
    })
}

#[tauri::command]
pub async fn desktop_list_payroll_runs(
    state: State<'_, DesktopState>,
    status: Option<String>,
) -> Result<Vec<PayrollRun>, CommandError> {
    require_permission(&state, "payroll.view")?;
    let conn = storage::database(&state.data_dir)?;

    let status_filter = status.unwrap_or_default();
    let query = if status_filter.is_empty() {
        "SELECT id, idempotency_key, period_start, period_end, status,
                total_gross_payout, total_net_payout, total_employees,
                created_by, created_at, updated_at
         FROM payroll_runs ORDER BY period_start DESC, created_at DESC;"
    } else {
        "SELECT id, idempotency_key, period_start, period_end, status,
                total_gross_payout, total_net_payout, total_employees,
                created_by, created_at, updated_at
         FROM payroll_runs WHERE status = ?1 ORDER BY period_start DESC, created_at DESC;"
    };

    let mut stmt = conn.prepare(query).map_err(|_| CommandError::internal())?;

    let map_fn = |row: &rusqlite::Row| {
        Ok(PayrollRun {
            id: row.get(0)?,
            idempotency_key: row.get(1)?,
            period_start: row.get(2)?,
            period_end: row.get(3)?,
            status: row.get(4)?,
            total_gross_payout: row.get(5)?,
            total_net_payout: row.get(6)?,
            total_employees: row.get(7)?,
            created_by: row.get(8)?,
            created_at: row.get(9)?,
            updated_at: row.get(10)?,
        })
    };

    let rows: Vec<PayrollRun> = if status_filter.is_empty() {
        stmt.query_map([], map_fn)
            .map_err(|_| CommandError::internal())?
            .filter_map(|r| r.ok())
            .collect()
    } else {
        stmt.query_map(params![status_filter], map_fn)
            .map_err(|_| CommandError::internal())?
            .filter_map(|r| r.ok())
            .collect()
    };

    Ok(rows)
}

#[tauri::command]
pub async fn desktop_get_payroll_run_detail(
    state: State<'_, DesktopState>,
    run_id: String,
) -> Result<serde_json::Value, CommandError> {
    require_permission(&state, "payroll.view")?;
    let conn = storage::database(&state.data_dir)?;

    let run: PayrollRun = conn
        .query_row(
            r#"
            SELECT id, idempotency_key, period_start, period_end, status,
                   total_gross_payout, total_net_payout, total_employees,
                   created_by, created_at, updated_at
            FROM payroll_runs
            WHERE id = ?1;
            "#,
            params![run_id],
            |row| {
                Ok(PayrollRun {
                    id: row.get(0)?,
                    idempotency_key: row.get(1)?,
                    period_start: row.get(2)?,
                    period_end: row.get(3)?,
                    status: row.get(4)?,
                    total_gross_payout: row.get(5)?,
                    total_net_payout: row.get(6)?,
                    total_employees: row.get(7)?,
                    created_by: row.get(8)?,
                    created_at: row.get(9)?,
                    updated_at: row.get(10)?,
                })
            },
        )
        .map_err(|_| CommandError::new("NOT_FOUND", "Batch payroll tidak ditemukan."))?;

    let mut items_stmt = conn
        .prepare(
            r#"
            SELECT id, payroll_run_id, id_karyawan, nama_karyawan, divisi, ptkp_status,
                   total_regular_hours, total_overtime_hours, total_overtime_index,
                   COALESCE(total_holiday_hours, 0), COALESCE(total_holiday_overtime_index, 0),
                   COALESCE(total_teaching_jp, 0), COALESCE(teaching_salary, 0),
                   rate_per_hour, basic_salary, overtime_salary, gross_salary,
                   total_allowances, total_deductions, bpjs_employee_total, bpjs_company_total,
                   pph21_amount, net_salary, breakdown_snapshot, created_at
            FROM payroll_items
            WHERE payroll_run_id = ?1
            ORDER BY nama_karyawan ASC;
            "#,
        )
        .map_err(|_| CommandError::internal())?;

    let items: Vec<PayrollItem> = items_stmt
        .query_map(params![run_id], |row| {
            Ok(PayrollItem {
                id: row.get(0)?,
                payroll_run_id: row.get(1)?,
                id_karyawan: row.get(2)?,
                nama_karyawan: row.get(3)?,
                divisi: row.get(4)?,
                ptkp_status: row.get(5)?,
                total_regular_hours: row.get(6)?,
                total_overtime_hours: row.get(7)?,
                total_overtime_index: row.get(8)?,
                total_holiday_hours: row.get(9)?,
                total_holiday_overtime_index: row.get(10)?,
                total_teaching_jp: row.get(11)?,
                teaching_salary: row.get(12)?,
                rate_per_hour: row.get(13)?,
                basic_salary: row.get(14)?,
                overtime_salary: row.get(15)?,
                gross_salary: row.get(16)?,
                total_allowances: row.get(17)?,
                total_deductions: row.get(18)?,
                bpjs_employee_total: row.get(19)?,
                bpjs_company_total: row.get(20)?,
                pph21_amount: row.get(21)?,
                net_salary: row.get(22)?,
                breakdown_snapshot: row.get(23)?,
                created_at: row.get(24)?,
            })
        })
        .map_err(|_| CommandError::internal())?
        .filter_map(|r| r.ok())
        .collect();

    let mut logs_stmt = conn
        .prepare(
            r#"
            SELECT id, payroll_run_id, action, old_status, new_status, performed_by, notes, created_at
            FROM payroll_audit_logs
            WHERE payroll_run_id = ?1
            ORDER BY created_at ASC;
            "#,
        )
        .map_err(|_| CommandError::internal())?;

    let audit_logs: Vec<PayrollAuditLog> = logs_stmt
        .query_map(params![run_id], |row| {
            Ok(PayrollAuditLog {
                id: row.get(0)?,
                payroll_run_id: row.get(1)?,
                action: row.get(2)?,
                old_status: row.get(3)?,
                new_status: row.get(4)?,
                performed_by: row.get(5)?,
                notes: row.get(6)?,
                created_at: row.get(7)?,
            })
        })
        .map_err(|_| CommandError::internal())?
        .filter_map(|r| r.ok())
        .collect();

    Ok(json!({
        "run": run,
        "items": items,
        "audit_logs": audit_logs
    }))
}

#[tauri::command]
pub async fn desktop_transition_payroll_status(
    state: State<'_, DesktopState>,
    run_id: String,
    target_status: String,
    notes: Option<String>,
) -> Result<PayrollRun, CommandError> {
    let target = PayrollStatus::from_str(&target_status)
        .ok_or_else(|| CommandError::new("INVALID_STATUS", "Status target tidak valid."))?;

    // Layer 2 Guard: verifikasi permission per status transition
    let required_permission = match target {
        PayrollStatus::Submitted => "payroll.run.create",
        PayrollStatus::Reviewed => "payroll.run.review",
        PayrollStatus::Approved => "payroll.run.approve",
        PayrollStatus::Paid => "payroll.run.disburse",
        PayrollStatus::Rejected => "payroll.run.review",
        PayrollStatus::Draft => "payroll.run.create",
    };

    let operator = require_permission(&state, required_permission)?;
    let mut conn = storage::database(&state.data_dir)?;

    let (
        current_status_str,
        idempotency_key,
        period_start,
        period_end,
        gross,
        net,
        emp_count,
        created_by,
        created_at,
    ): (
        String,
        String,
        String,
        String,
        i64,
        i64,
        i64,
        String,
        String,
    ) = conn
        .query_row(
            r#"
            SELECT status, idempotency_key, period_start, period_end,
                   total_gross_payout, total_net_payout, total_employees,
                   created_by, created_at
            FROM payroll_runs
            WHERE id = ?1;
            "#,
            params![run_id],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                    row.get(5)?,
                    row.get(6)?,
                    row.get(7)?,
                    row.get(8)?,
                ))
            },
        )
        .map_err(|_| CommandError::new("NOT_FOUND", "Batch payroll tidak ditemukan."))?;

    let current = PayrollStatus::from_str(&current_status_str)
        .ok_or_else(|| CommandError::new("STATE_ERROR", "Status saat ini tidak valid."))?;

    // State Machine Exhaustive Match: cegah jumping status ilegal
    if !current.can_transition_to(&target) {
        return Err(CommandError::new(
            "ILLEGAL_TRANSITION",
            format!(
                "Tidak dapat mengubah status dari {} ke {}.",
                current.as_str(),
                target.as_str()
            ),
        ));
    }

    let tx = conn.transaction().map_err(|_| CommandError::internal())?;
    let now = iso_now_tx(&tx);

    tx.execute(
        "UPDATE payroll_runs SET status = ?1, updated_at = ?2 WHERE id = ?3;",
        params![target.as_str(), now, run_id],
    )
    .map_err(|_| CommandError::new("UPDATE_FAILED", "Gagal memperbarui status payroll."))?;

    let audit_id = new_payroll_id("audit");
    let notes_text = notes.unwrap_or_default();
    tx.execute(
        r#"
        INSERT INTO payroll_audit_logs (
            id, payroll_run_id, action, old_status, new_status, performed_by, notes, created_at
        ) VALUES (?1, ?2, 'TRANSITION_STATUS', ?3, ?4, ?5, ?6, ?7);
        "#,
        params![
            audit_id,
            run_id,
            current.as_str(),
            target.as_str(),
            operator.username,
            notes_text,
            now
        ],
    )
    .map_err(|_| CommandError::internal())?;

    let client_id = sync::ensure_client_id(&state)?;
    sync::enqueue(
        &tx,
        &client_id,
        "payroll",
        "transition-status",
        &run_id,
        &json!({
            "id": run_id.clone(),
            "status": target.as_str(),
            "updated_at": now.clone(),
            "audit": {
                "id": audit_id,
                "payroll_run_id": run_id.clone(),
                "action": "TRANSITION_STATUS",
                "old_status": current.as_str(),
                "new_status": target.as_str(),
                "performed_by": operator.username.clone(),
                "notes": notes_text,
                "created_at": now.clone(),
            },
        }),
        None,
    )?;

    tx.commit().map_err(|_| CommandError::internal())?;

    Ok(PayrollRun {
        id: run_id,
        idempotency_key,
        period_start,
        period_end,
        status: target.as_str().to_string(),
        total_gross_payout: gross,
        total_net_payout: net,
        total_employees: emp_count,
        created_by,
        created_at,
        updated_at: now,
    })
}

// Helper loaders
fn load_overtime_tiers(
    conn: &Connection,
    rule_type: &str,
) -> Result<Vec<OvertimeTierRule>, CommandError> {
    let mut stmt = conn
        .prepare(
            r#"
            SELECT id, rule_type, tier_order, hour_start, hour_end, multiplier, is_active
            FROM overtime_tier_rules
            WHERE rule_type = ?1 AND is_active = 1
            ORDER BY tier_order ASC;
            "#,
        )
        .map_err(|_| CommandError::internal())?;

    let rows = stmt
        .query_map(params![rule_type], |row| {
            Ok(OvertimeTierRule {
                id: row.get(0)?,
                rule_type: row.get(1)?,
                tier_order: row.get(2)?,
                hour_start: row.get(3)?,
                hour_end: row.get(4)?,
                multiplier: row.get(5)?,
                is_active: row.get(6)?,
            })
        })
        .map_err(|_| CommandError::internal())?;

    Ok(rows.filter_map(|r| r.ok()).collect())
}

fn load_payroll_components(conn: &Connection) -> Result<Vec<PayrollComponent>, CommandError> {
    let mut stmt = conn
        .prepare(
            r#"
            SELECT id, name, category, calc_type, default_value, applies_to, is_active
            FROM payroll_components
            WHERE is_active = 1
            ORDER BY category, name ASC;
            "#,
        )
        .map_err(|_| CommandError::internal())?;

    let rows = stmt
        .query_map([], |row| {
            Ok(PayrollComponent {
                id: row.get(0)?,
                name: row.get(1)?,
                category: row.get(2)?,
                calc_type: row.get(3)?,
                default_value: row.get(4)?,
                applies_to: row.get(5)?,
                is_active: row.get(6)?,
            })
        })
        .map_err(|_| CommandError::internal())?;

    Ok(rows.filter_map(|r| r.ok()).collect())
}

/// Tarif yang BERLAKU pada akhir periode, bukan seluruh isi tabelnya.
///
/// `effective_date` sudah ada di skema sejak awal dan didokumentasikan sebagai
/// kunci generasi tarif, tetapi tidak pernah dipakai menyaring: tabelnya dibaca
/// utuh, lalu `calculate_pph21_ter` memakai `.find()` — bracket PERTAMA yang
/// cocok. Begitu admin menambahkan tabel TER tahun depan, periode berjalan
/// memakai bracket yang urutannya tidak ditentukan siapa pun, karena dua baris
/// dengan `bracket_min` sama diurutkan sembarang oleh SQLite.
///
/// Bahkan tanpa generasi ganda ini tetap perlu: tarif yang `effective_date`-nya
/// masih di MASA DEPAN pun ikut terpakai pada periode hari ini.
///
/// Polanya disalin dari `salary_configs` di query rekap — generasi terbaru yang
/// sudah berlaku, per kategori. `COALESCE` ke generasi terawal menjaga periode
/// yang lebih tua daripada seluruh tarif tetap punya tarif, alih-alih diam-diam
/// menghasilkan potongan nol.
fn load_tax_rules(conn: &Connection, period_end: &str) -> Result<Vec<TaxRule>, CommandError> {
    let mut stmt = conn
        .prepare(
            r#"
            SELECT id, category, bracket_min, bracket_max, rate_percentage, effective_date
            FROM tax_rules
            WHERE effective_date = COALESCE(
                (SELECT MAX(t2.effective_date) FROM tax_rules t2
                  WHERE t2.category = tax_rules.category AND t2.effective_date <= ?1),
                (SELECT MIN(t3.effective_date) FROM tax_rules t3
                  WHERE t3.category = tax_rules.category)
            )
            ORDER BY category, bracket_min ASC;
            "#,
        )
        .map_err(|_| CommandError::internal())?;

    let rows = stmt
        .query_map([period_end], |row| {
            Ok(TaxRule {
                id: row.get(0)?,
                category: row.get(1)?,
                bracket_min: row.get(2)?,
                bracket_max: row.get(3)?,
                rate_percentage: row.get(4)?,
                effective_date: row.get(5)?,
            })
        })
        .map_err(|_| CommandError::internal())?;

    Ok(rows.filter_map(|r| r.ok()).collect())
}

/// Iuran BPJS yang BERLAKU pada akhir periode.
///
/// Alasannya sama dengan `load_tax_rules`. `component_code` memang UNIQUE
/// sehingga generasi historis belum mungkin ada hari ini — tetapi tanpa
/// penyaring ini, tarif yang `effective_date`-nya masih di masa depan tetap
/// dipakai pada periode berjalan, dan itu sudah cukup untuk salah potong.
fn load_bpjs_rules(conn: &Connection, period_end: &str) -> Result<Vec<BpjsRule>, CommandError> {
    let mut stmt = conn
        .prepare(
            r#"
            SELECT id, component_code, component_name, rate_percentage, wage_cap, effective_date
            FROM bpjs_rules
            WHERE effective_date = COALESCE(
                (SELECT MAX(b2.effective_date) FROM bpjs_rules b2
                  WHERE b2.component_code = bpjs_rules.component_code AND b2.effective_date <= ?1),
                (SELECT MIN(b3.effective_date) FROM bpjs_rules b3
                  WHERE b3.component_code = bpjs_rules.component_code)
            )
            ORDER BY component_code ASC;
            "#,
        )
        .map_err(|_| CommandError::internal())?;

    let rows = stmt
        .query_map([period_end], |row| {
            Ok(BpjsRule {
                id: row.get(0)?,
                component_code: row.get(1)?,
                component_name: row.get(2)?,
                rate_percentage: row.get(3)?,
                wage_cap: row.get(4)?,
                effective_date: row.get(5)?,
            })
        })
        .map_err(|_| CommandError::internal())?;

    Ok(rows.filter_map(|r| r.ok()).collect())
}

#[cfg(test)]
mod tests {
    use super::{load_jp_rates, load_taught_sessions, new_payroll_id};
    use std::collections::HashSet;

    #[test]
    fn id_payroll_tidak_bertabrakan_dalam_satu_detik() {
        // Fungsi simpan massal memanggilnya berkali-kali dalam loop yang sama —
        // persis keadaan yang dulu memberi setiap baris id identik.
        let ids: HashSet<String> = (0..500).map(|_| new_payroll_id("ot-hari_kerja")).collect();
        assert_eq!(ids.len(), 500);
    }

    #[test]
    fn id_payroll_mempertahankan_awalan_yang_terbaca() {
        let id = new_payroll_id("PR-20260901");
        assert!(id.starts_with("PR-20260901-"));
        let suffix = id.rsplit('-').next().unwrap_or_default();
        assert_eq!(suffix.len(), 12);
        assert!(suffix.chars().all(|c| c.is_ascii_hexdigit()));
    }

    /// Hanya sesi yang jurnalnya SUDAH DIPARAF yang menghasilkan honor, dan
    /// jurnal ganda tidak menggandakan sesinya.
    ///
    /// SQL-nya dijalankan sungguhan di sini, bukan dibaca: satu nama kolom yang
    /// salah ketik hanyalah teks di dalam string bagi lint maupun typecheck.
    #[test]
    fn sesi_mengajar_hanya_terhitung_bila_jurnalnya_diparaf() {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        conn.execute_batch(
            r#"
            CREATE TABLE presensi_mapel (
                id_presensi_mapel TEXT PRIMARY KEY,
                id_tahun_ajaran TEXT NOT NULL,
                id_rombel TEXT NOT NULL,
                id_mapel TEXT NOT NULL,
                id_guru TEXT NOT NULL,
                tanggal TEXT NOT NULL,
                jam_ke TEXT NOT NULL
            );
            CREATE TABLE jurnal_mengajar (
                id_jurnal TEXT PRIMARY KEY,
                id_presensi_mapel TEXT NOT NULL,
                paraf_at TEXT
            );
            INSERT INTO presensi_mapel VALUES
                ('pm1', 'ta', 'r1', 'mtk', 'g1', '2026-09-10', '1-2'),
                ('pm2', 'ta', 'r2', 'mtk', 'g1', '2026-09-10', '3'),
                ('pm3', 'ta', 'r3', 'mtk', 'g1', '2026-09-10', '5'),
                ('pm4', 'ta', 'r1', 'mtk', 'g1', '2026-10-01', '1');
            INSERT INTO jurnal_mengajar VALUES
                -- Dua jurnal untuk SATU sesi: bisa terjadi karena dua perangkat
                -- offline menulisnya, dan JOIN akan menghitungnya dua kali.
                ('j1', 'pm1', '2026-09-10T10:00:00Z'),
                ('j1b', 'pm1', '2026-09-10T10:05:00Z'),
                -- Jurnal tanpa paraf: sesi yang dibuat lalu ditinggalkan.
                ('j2', 'pm2', NULL),
                ('j3', 'pm3', '   '),
                ('j4', 'pm4', '2026-10-01T10:00:00Z');
            "#,
        )
        .unwrap();

        let sessions = load_taught_sessions(&conn, "2026-09-01", "2026-09-30").unwrap();
        let milik_guru = sessions.get("g1").cloned().unwrap_or_default();

        assert_eq!(
            milik_guru.len(),
            1,
            "hanya pm1 yang diparaf, dan jurnal gandanya tidak menggandakannya"
        );
        assert_eq!(milik_guru[0].id_presensi_mapel, "pm1");
        assert_eq!((milik_guru[0].jam_awal, milik_guru[0].jam_akhir), (1, 2));
    }

    /// Tarif JP dibaca utuh, termasuk baris yang `id_guru`-nya NULL.
    #[test]
    fn tarif_jp_dibaca_beserta_baris_tanpa_guru() {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        conn.execute_batch(
            r#"
            CREATE TABLE tarif_jp (
                id TEXT PRIMARY KEY,
                id_mapel TEXT NOT NULL,
                id_guru TEXT,
                rate_per_jp INTEGER NOT NULL CHECK (rate_per_jp >= 0),
                effective_date TEXT NOT NULL,
                status_aktif INTEGER NOT NULL DEFAULT 1 CHECK (status_aktif IN (0, 1)),
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            INSERT INTO tarif_jp VALUES
                ('t1', 'mtk', NULL, 100000, '2026-01-01', 1, '2026-01-01', '2026-01-01'),
                ('t2', 'mtk', 'g1', 120000, '2026-01-01', 1, '2026-01-01', '2026-01-01');
            "#,
        )
        .unwrap();

        let rates = load_jp_rates(&conn).unwrap();
        assert_eq!(rates.len(), 2);
        assert!(rates.iter().any(|r| r.id_guru.is_none()));
        assert!(rates.iter().any(|r| r.id_guru.as_deref() == Some("g1")));
    }
}
