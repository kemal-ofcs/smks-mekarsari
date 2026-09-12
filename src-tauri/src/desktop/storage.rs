use std::{path::Path, time::SystemTime};

use rusqlite::{params, Connection, OptionalExtension};
use sha2::{Digest, Sha256};
use zeroize::Zeroize;

use super::models::{CommandError, OfflineCredential};
use super::payroll_seed;

const DATABASE_NAME: &str = "desktop-security.db";

pub(crate) fn database(path: &Path) -> Result<Connection, CommandError> {
    let connection =
        Connection::open(path.join(DATABASE_NAME)).map_err(|_| CommandError::internal())?;
    connection
        .execute_batch(
            "PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000; PRAGMA temp_store = MEMORY; PRAGMA cache_size = -64000;",
        )
        .map_err(|_| CommandError::internal())?;
    Ok(connection)
}

pub fn now_epoch_seconds() -> i64 {
    SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .map(|duration| duration.as_secs() as i64)
        .unwrap_or_default()
}

pub fn normalize_identifier(value: &str) -> String {
    value.trim().to_lowercase()
}

pub fn get_or_create_device_id(path: &Path) -> Result<String, CommandError> {
    let connection = database(path)?;
    if let Some(existing) = connection
        .query_row(
            "SELECT device_id FROM desktop_device_identity WHERE singleton_id = 1;",
            [],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|_| CommandError::internal())?
    {
        let valid = existing.len() == 71
            && existing.starts_with("device-")
            && existing[7..].bytes().all(|byte| byte.is_ascii_hexdigit());
        if valid {
            return Ok(existing);
        }
    }
    let mut random = [0_u8; 32];
    rand_core::RngCore::fill_bytes(&mut rand_core::OsRng, &mut random);
    let generated = format!("device-{}", hex::encode(random));
    random.zeroize();
    connection
        .execute(
            "INSERT INTO desktop_device_identity (singleton_id, device_id, created_at) VALUES (1, ?, ?) ON CONFLICT(singleton_id) DO UPDATE SET device_id = excluded.device_id, created_at = excluded.created_at;",
            params![generated, now_epoch_seconds()],
        )
        .map_err(|_| CommandError::internal())?;
    Ok(generated)
}

fn ensure_column(
    connection: &Connection,
    table: &str,
    column: &str,
    alter_sql: &str,
) -> Result<(), String> {
    let exists = connection
        .query_row(
            &format!("SELECT EXISTS(SELECT 1 FROM pragma_table_info('{table}') WHERE name = ?);"),
            [column],
            |row| row.get::<_, bool>(0),
        )
        .map_err(|_| format!("Skema tabel {table} tidak dapat diperiksa."))?;
    if !exists {
        connection
            .execute(alter_sql, [])
            .map_err(|_| format!("Kolom {table}.{column} tidak dapat dimigrasikan."))?;
    }
    Ok(())
}

/// Bangun ulang tabel untuk melepas UNIQUE yang terlanjur ikut terbuat.
///
/// SQLite tidak punya `DROP CONSTRAINT`, dan `CREATE TABLE IF NOT EXISTS` tidak
/// pernah memperbaiki tabel yang sudah ada. Hanya berjalan bila DDL tersimpan
/// masih memuat `UNIQUE`, jadi aman dipanggil di setiap `initialize`.
///
/// Cerminan `TursoClient::rebuild_without_unique`; keduanya WAJIB menghasilkan
/// bentuk tabel yang sama, karena satu database bisa dibangun jalur mana pun.
fn rebuild_without_unique(
    connection: &Connection,
    table: &str,
    create_sql: &str,
    columns: &str,
    indexes: &[&str],
) -> Result<(), String> {
    let existing: Option<String> = connection
        .query_row(
            "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?;",
            [table],
            |row| row.get(0),
        )
        .optional()
        .map_err(|_| format!("Skema tabel {table} tidak dapat diperiksa."))?;
    let Some(existing) = existing else {
        return Ok(());
    };
    if !existing.to_ascii_uppercase().contains("UNIQUE") {
        return Ok(());
    }

    let staging = format!("{table}__rebuild");
    let mut script = String::new();
    script.push_str(&format!("DROP TABLE IF EXISTS {staging};\n"));
    script.push_str(&create_sql.replace(table, &staging));
    script.push('\n');
    script.push_str(&format!(
        "INSERT INTO {staging} ({columns}) SELECT {columns} FROM {table};\n"
    ));
    script.push_str(&format!("DROP TABLE {table};\n"));
    script.push_str(&format!("ALTER TABLE {staging} RENAME TO {table};\n"));
    for index in indexes {
        script.push_str(index);
        script.push('\n');
    }
    connection
        .execute_batch(&format!("BEGIN;\n{script}COMMIT;"))
        .map_err(|_| format!("Tabel {table} tidak dapat dibangun ulang tanpa UNIQUE."))?;
    Ok(())
}

/// Nilai `absensi_harian.sumber` yang diterima database.
///
/// Sama persis dengan CHECK constraint cloud dan `ATTENDANCE_SOURCE_VALUES` di
/// `src/lib/contracts/scanner.ts`.
const ATTENDANCE_SOURCE_VALUES: &[&str] = &[
    "Scanner",
    "Koreksi Admin",
    "Import Offline",
    "Import Manual",
    "Generate Sistem",
];

/// Pasang CHECK constraint `sumber` pada `absensi_harian` yang sudah terlanjur
/// lahir tanpa constraint itu.
///
/// `CREATE TABLE IF NOT EXISTS` tidak pernah memperbaiki tabel yang sudah ada,
/// sehingga tanpa migrasi ini hanya pemasangan BARU yang terlindungi —
/// sementara justru pemasangan lama yang sudah menampung bertahun-tahun data.
///
/// Baris dengan nilai di luar daftar dinormalkan lebih dulu menjadi
/// `Generate Sistem`. Dua alasan: tanpa itu penyalinan ke tabel staging akan
/// ditolak dan seluruh migrasi membatalkan diri diam-diam (constraint-nya tidak
/// pernah terpasang, dan tidak ada yang tahu); dan baris seperti itu memang
/// SUDAH tidak bisa didorong ke cloud, jadi menormalkannya justru
/// membebaskannya. `Generate Sistem` dipilih karena prioritas TERENDAH — ia
/// tidak akan menimpa catatan yang lebih tinggi saat rekonsiliasi.
/// Jenis perhitungan komponen payroll yang diterima database.
///
/// Sama persis dengan CHECK constraint cloud, enum Zod di `sync-schema.ts`, dan
/// `PAYROLL_CALC_TYPES` di `src/lib/validations/payroll-policy.ts`.
const PAYROLL_CALC_TYPES: &[&str] = &["FIXED", "PERCENTAGE", "PER_JP", "PER_HADIR"];

/// Memperluas CHECK `payroll_components.calc_type` pada database yang sudah ada.
///
/// SQLite tidak bisa mengubah CHECK lewat ALTER, jadi satu-satunya jalan adalah
/// membangun ulang tabelnya. Tanpa ini hanya pemasangan BARU yang bisa memakai
/// tunjangan per JP dan per hari hadir, sementara pemasangan lama — yang justru
/// sudah memakai payroll setiap bulan — akan menolak nilainya di titik simpan,
/// dan pada jalur sinkronisasi penolakan itu mengunci outbox secara permanen.
///
/// Idempoten lewat pemeriksaan teks DDL-nya sendiri, pola yang sama dengan
/// `ensure_attendance_source_check`. Tidak ada baris yang perlu diperbaiki
/// lebih dulu: nilai lama ('FIXED', 'PERCENTAGE') tetap sah pada CHECK baru.
fn ensure_payroll_calc_type_values(connection: &Connection) -> Result<(), String> {
    let existing: Option<String> = connection
        .query_row(
            "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'payroll_components';",
            [],
            |row| row.get(0),
        )
        .optional()
        .map_err(|_| "Skema payroll_components tidak dapat diperiksa.".to_string())?;
    let Some(existing) = existing else {
        return Ok(());
    };
    if existing.contains("'PER_JP'") {
        return Ok(());
    }

    let daftar = PAYROLL_CALC_TYPES
        .iter()
        .map(|nilai| format!("'{nilai}'"))
        .collect::<Vec<_>>()
        .join(", ");

    const KOLOM: &str =
        "id, name, category, calc_type, default_value, applies_to, is_active, created_at";

    let script = format!(
        "BEGIN;
        DROP TABLE IF EXISTS payroll_components__rebuild;
        CREATE TABLE payroll_components__rebuild (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          category TEXT NOT NULL CHECK (category IN ('ALLOWANCE', 'DEDUCTION')),
          calc_type TEXT NOT NULL CHECK (calc_type IN ({daftar})),
          default_value REAL NOT NULL DEFAULT 0 CHECK (default_value >= 0),
          applies_to TEXT NOT NULL DEFAULT 'ALL',
          is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        INSERT INTO payroll_components__rebuild ({KOLOM})
          SELECT {KOLOM} FROM payroll_components;
        DROP TABLE payroll_components;
        ALTER TABLE payroll_components__rebuild RENAME TO payroll_components;
        COMMIT;"
    );

    connection
        .execute_batch(&script)
        .map_err(|_| "Tabel payroll_components tidak dapat dibangun ulang.".to_string())?;
    Ok(())
}

fn ensure_attendance_source_check(connection: &Connection) -> Result<(), String> {
    let existing: Option<String> = connection
        .query_row(
            "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'absensi_harian';",
            [],
            |row| row.get(0),
        )
        .optional()
        .map_err(|_| "Skema absensi_harian tidak dapat diperiksa.".to_string())?;
    let Some(existing) = existing else {
        return Ok(());
    };
    if existing.contains("CHECK (sumber IN (") {
        return Ok(());
    }

    let daftar = ATTENDANCE_SOURCE_VALUES
        .iter()
        .map(|nilai| format!("'{nilai}'"))
        .collect::<Vec<_>>()
        .join(", ");

    const KOLOM: &str = "id_absensi, tanggal, id_karyawan, nama, kelas_divisi, \
        jam_masuk, jam_pulang, status_kehadiran, status_absen, keterangan, sumber, \
        update_terakhir, menit_terlambat, menit_datang_awal, jam_kerja, lembur, \
        jam_kerja_kurang, id_shift, bulan, tahun, id_sesi, mode_tugas, id_backup, \
        id_karyawan_asal, tanggal_tugas";

    let script = format!(
        "BEGIN;
        UPDATE absensi_harian SET sumber = 'Generate Sistem'
          WHERE sumber IS NULL OR sumber NOT IN ({daftar});
        DROP TABLE IF EXISTS absensi_harian__rebuild;
        CREATE TABLE absensi_harian__rebuild (
          id_absensi INTEGER PRIMARY KEY AUTOINCREMENT,
          tanggal TEXT NOT NULL,
          id_karyawan TEXT NOT NULL,
          nama TEXT NOT NULL,
          kelas_divisi TEXT NOT NULL,
          jam_masuk TEXT,
          jam_pulang TEXT,
          status_kehadiran TEXT NOT NULL,
          status_absen TEXT NOT NULL,
          keterangan TEXT,
          sumber TEXT NOT NULL CHECK (sumber IN ({daftar})),
          update_terakhir TEXT NOT NULL,
          menit_terlambat INTEGER DEFAULT 0,
          menit_datang_awal INTEGER DEFAULT 0,
          jam_kerja INTEGER DEFAULT 0,
          lembur INTEGER DEFAULT 0,
          jam_kerja_kurang INTEGER DEFAULT 0,
          id_shift INTEGER NOT NULL,
          bulan TEXT NOT NULL,
          tahun INTEGER NOT NULL,
          id_sesi TEXT UNIQUE NOT NULL,
          mode_tugas TEXT DEFAULT 'NORMAL',
          id_backup TEXT,
          id_karyawan_asal TEXT,
          tanggal_tugas TEXT
        );
        INSERT INTO absensi_harian__rebuild ({KOLOM}) SELECT {KOLOM} FROM absensi_harian;
        DROP TABLE absensi_harian;
        ALTER TABLE absensi_harian__rebuild RENAME TO absensi_harian;
        CREATE INDEX IF NOT EXISTS idx_local_attendance_employee_date
          ON absensi_harian(id_karyawan, tanggal);
        CREATE INDEX IF NOT EXISTS idx_local_absensi_tanggal
          ON absensi_harian(tanggal);
        COMMIT;"
    );

    connection.execute_batch(&script).map_err(|error| {
        format!("Tabel absensi_harian tidak dapat dibangun ulang dengan CHECK sumber: {error}")
    })
}

/// Menanam tarif default payroll dan membersihkan sisa seed versi lama.
///
/// Seed lokal dan seed cloud dulu ditulis terpisah dengan id, kode komponen,
/// dan tarif yang berbeda. Baris lokal ikut terdorong ke cloud lewat backfill
/// outbox sehingga bracket PASAL_17 menjadi dobel, sementara push BPJS selalu
/// gagal karena `component_code` UNIQUE sudah dipakai baris cloud ber-id lain.
/// Sekarang keduanya membaca `payroll_seed`, dan baris lama dihapus sekali.
fn seed_payroll_rate_tables(connection: &Connection) -> Result<(), String> {
    let legacy_ids = payroll_seed::LEGACY_RATE_IDS
        .iter()
        .map(|id| format!("'{id}'"))
        .collect::<Vec<_>>()
        .join(", ");
    connection
        .execute_batch(&format!(
            r#"
      DELETE FROM tax_rules WHERE id IN ({legacy_ids});
      DELETE FROM bpjs_rules WHERE id IN ({legacy_ids});
      DELETE FROM overtime_tier_rules WHERE id IN ({legacy_ids});
      DELETE FROM desktop_entity_revision
        WHERE domain = 'payroll' AND entity_key IN ({legacy_ids});
      DELETE FROM desktop_sync_outbox
        WHERE domain = 'payroll' AND entity_key IN ({legacy_ids});
      "#
        ))
        .map_err(|_| "Seed tarif payroll lama tidak dapat dibersihkan.".to_owned())?;

    for statement in [
        payroll_seed::OVERTIME_TIER_RULES_SEED_SQL,
        payroll_seed::TAX_RULES_SEED_SQL,
        payroll_seed::BPJS_RULES_SEED_SQL,
    ] {
        connection
            .execute_batch(statement)
            .map_err(|_| "Tarif default payroll tidak dapat disiapkan.".to_owned())?;
    }
    Ok(())
}

pub fn initialize(path: &Path) -> Result<(), String> {
    let connection = database(path).map_err(|error| error.message)?;
    connection
        .execute_batch(
            r#"
      CREATE TABLE IF NOT EXISTS desktop_schema_migration (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS desktop_credential_index (
        identity_key TEXT PRIMARY KEY,
        operator_id INTEGER NOT NULL,
        username TEXT NOT NULL,
        kode_operator TEXT NOT NULL,
        role_key TEXT NOT NULL,
        permission_revision INTEGER NOT NULL,
        provisioned_at INTEGER NOT NULL,
        offline_valid_until INTEGER NOT NULL,
        server_origin TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS desktop_credential_alias (
        alias TEXT NOT NULL,
        server_origin TEXT NOT NULL,
        identity_key TEXT NOT NULL,
        PRIMARY KEY (alias, server_origin),
        FOREIGN KEY (identity_key) REFERENCES desktop_credential_index(identity_key)
          ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS desktop_security_audit (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        operator_id INTEGER,
        event_type TEXT NOT NULL,
        event_at INTEGER NOT NULL,
        detail TEXT
      );
      CREATE TABLE IF NOT EXISTS desktop_login_rate_limit (
        identifier_hash TEXT PRIMARY KEY,
        failed_attempts INTEGER NOT NULL DEFAULT 0,
        locked_until INTEGER,
        last_attempt_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS desktop_device_identity (
        singleton_id INTEGER PRIMARY KEY CHECK(singleton_id = 1),
        device_id TEXT UNIQUE NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS master_data (
        id_unik TEXT PRIMARY KEY,
        kode_karyawan TEXT UNIQUE,
        nama TEXT NOT NULL,
        divisi TEXT NOT NULL,
        jabatan_status TEXT,
        no_hp TEXT,
        lp TEXT,
        id_shift INTEGER NOT NULL,
        status_aktif TEXT DEFAULT 'Aktif',
        tanggal_daftar TEXT,
        catatan TEXT,
        token_absensi TEXT UNIQUE,
        qr_code TEXT,
        status_qr TEXT DEFAULT 'Belum',
        jenis_personil TEXT,
        tanggal_mulai_aktif TEXT,
        tanggal_selesai_aktif TEXT,
        status_backup TEXT DEFAULT 'NORMAL'
      );
      CREATE TABLE IF NOT EXISTS id_card (
        id_card_id INTEGER PRIMARY KEY AUTOINCREMENT,
        id_unik TEXT UNIQUE NOT NULL,
        nama TEXT NOT NULL,
        divisi TEXT NOT NULL,
        idcard_status TEXT DEFAULT 'Belum',
        idcard_pdf_url TEXT,
        idcard_last_generate TEXT,
        idcard_catatan TEXT,
        tanggal_generate TEXT,
        link_qr_png TEXT,
        FOREIGN KEY (id_unik) REFERENCES master_data(id_unik) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS tbl_shift (
        id_shift INTEGER PRIMARY KEY,
        kode_shift INTEGER UNIQUE NOT NULL,
        nama_shift TEXT NOT NULL,
        jam_masuk TEXT NOT NULL,
        jam_pulang TEXT NOT NULL,
        awal_absen_menit INTEGER DEFAULT 120,
        batas_masuk_menit INTEGER DEFAULT 60,
        toleransi_masuk_menit INTEGER DEFAULT 0,
        jam_kerja_normal_menit INTEGER NOT NULL,
        istirahat_menit INTEGER DEFAULT 60,
        batas_pulang_menit INTEGER DEFAULT 240,
        offset_istirahat_mulai INTEGER DEFAULT 240,
        offset_generate_alfa INTEGER DEFAULT 180,
        buffer_shift_malam_menit INTEGER DEFAULT 120,
        izinkan_multi_sesi INTEGER DEFAULT 0,
        shift_lanjutan_id INTEGER DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS setting_gex_system (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS log_scan (
        id_log INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp_scan TEXT NOT NULL,
        tanggal_kerja TEXT NOT NULL,
        jam_scan TEXT NOT NULL,
        id_karyawan TEXT NOT NULL,
        nama TEXT NOT NULL,
        divisi TEXT NOT NULL,
        jenis_scan TEXT NOT NULL,
        status_proses TEXT NOT NULL,
        sumber_data TEXT NOT NULL,
        catatan_sistem TEXT,
        keterangan TEXT,
        menit_terlambat INTEGER DEFAULT 0,
        menit_datang_awal INTEGER DEFAULT 0,
        id_referensi TEXT,
        kode_operator TEXT
      );
      CREATE TABLE IF NOT EXISTS absensi_harian (
        id_absensi INTEGER PRIMARY KEY AUTOINCREMENT,
        tanggal TEXT NOT NULL,
        id_karyawan TEXT NOT NULL,
        nama TEXT NOT NULL,
        kelas_divisi TEXT NOT NULL,
        jam_masuk TEXT,
        jam_pulang TEXT,
        status_kehadiran TEXT NOT NULL,
        status_absen TEXT NOT NULL,
        keterangan TEXT,
        -- Daftar yang sama persis dengan CHECK constraint cloud
        -- (`db-schema.ts` dan `turso.rs`) serta `ATTENDANCE_SOURCE_VALUES`.
        -- Tanpa CHECK di sini, nilai keliru diterima mulus di perangkat lalu
        -- DITOLAK saat push, dan penolakan itu membekukan seluruh antrean
        -- outbox secara permanen (`next_retry_at = NULL`). Lebih baik gagal
        -- di titik tulis, tempat pemanggilnya masih bisa diberi tahu.
        sumber TEXT NOT NULL CHECK (sumber IN (
          'Scanner', 'Koreksi Admin', 'Import Offline', 'Import Manual', 'Generate Sistem'
        )),
        update_terakhir TEXT NOT NULL,
        menit_terlambat INTEGER DEFAULT 0,
        menit_datang_awal INTEGER DEFAULT 0,
        jam_kerja INTEGER DEFAULT 0,
        lembur INTEGER DEFAULT 0,
        jam_kerja_kurang INTEGER DEFAULT 0,
        id_shift INTEGER NOT NULL,
        bulan TEXT NOT NULL,
        tahun INTEGER NOT NULL,
        id_sesi TEXT UNIQUE NOT NULL,
        mode_tugas TEXT DEFAULT 'NORMAL',
        id_backup TEXT,
        id_karyawan_asal TEXT,
        tanggal_tugas TEXT
      );
      CREATE TABLE IF NOT EXISTS backup_karyawan (
        id_backup TEXT PRIMARY KEY,
        tanggal_tugas TEXT NOT NULL,
        id_karyawan_asal TEXT NOT NULL,
        nama_karyawan_asal TEXT NOT NULL,
        divisi_asal TEXT NOT NULL,
        id_shift_asal INTEGER NOT NULL,
        id_karyawan_pengganti TEXT NOT NULL,
        nama_karyawan_pengganti TEXT NOT NULL,
        divisi_pengganti TEXT NOT NULL,
        id_shift_normal_pengganti INTEGER NOT NULL,
        id_shift_backup INTEGER NOT NULL,
        alasan_backup TEXT,
        status_tugas TEXT DEFAULT 'Aktif',
        kode_operator TEXT NOT NULL,
        waktu_input TEXT NOT NULL,
        catatan TEXT,
        waktu_dibatalkan TEXT,
        operator_pembatalan TEXT
      );
      CREATE TABLE IF NOT EXISTS koreksi_admin (
        id_koreksi INTEGER PRIMARY KEY AUTOINCREMENT,
        id_referensi TEXT UNIQUE NOT NULL,
        tanggal TEXT NOT NULL,
        id_karyawan TEXT NOT NULL,
        nama TEXT NOT NULL,
        divisi TEXT NOT NULL,
        jenis_koreksi TEXT NOT NULL,
        jam_koreksi TEXT,
        keterangan_admin TEXT,
        status_proses TEXT DEFAULT 'Sudah Diproses',
        timestamp TEXT NOT NULL,
        kode_operator TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS audit_absensi (
        id_audit INTEGER PRIMARY KEY AUTOINCREMENT,
        waktu TEXT NOT NULL,
        jenis TEXT NOT NULL,
        tanggal TEXT NOT NULL,
        id_karyawan TEXT NOT NULL,
        nama TEXT NOT NULL,
        baris_referensi TEXT,
        detail TEXT NOT NULL,
        status TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS tbl_hari_libur (
        id_libur INTEGER PRIMARY KEY AUTOINCREMENT,
        tanggal TEXT UNIQUE NOT NULL,
        nama_libur TEXT NOT NULL,
        jenis_libur TEXT DEFAULT 'Libur Nasional',
        keterangan TEXT,
        status_aktif INTEGER DEFAULT 1
      );
      CREATE INDEX IF NOT EXISTS idx_local_hari_libur_tanggal
        ON tbl_hari_libur(tanggal, status_aktif);
      -- Whitelist Shift/Divisi yang tetap boleh scan pada hari libur.
      -- Cakupan memakai `kode_shift` (UNIQUE, ikut sync) dan NAMA divisi,
      -- BUKAN `id_shift` yang AUTOINCREMENT-nya berbeda tiap perangkat.
      -- PK TEXT dibuat klien; tidak ada UNIQUE pada (scope_type, scope_value)
      -- supaya dua perangkat offline yang mendaftarkan cakupan sama tidak
      -- membuat push sync gagal permanen — duplikat harmless karena
      -- penilaiannya OR, dan dicegah di lapisan aplikasi dengan pesan ramah.
      CREATE TABLE IF NOT EXISTS hari_libur_whitelist (
        id TEXT PRIMARY KEY,
        scope_type TEXT NOT NULL CHECK (scope_type IN ('SHIFT', 'DIVISI')),
        scope_value TEXT NOT NULL,
        tanggal_libur TEXT,
        keterangan TEXT,
        status_aktif INTEGER NOT NULL DEFAULT 1 CHECK (status_aktif IN (0, 1)),
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_local_hari_libur_whitelist_scope
        ON hari_libur_whitelist(scope_type, scope_value, status_aktif);
      CREATE INDEX IF NOT EXISTS idx_local_hari_libur_whitelist_tanggal
        ON hari_libur_whitelist(tanggal_libur, status_aktif);
      CREATE TABLE IF NOT EXISTS absensi_foto (
        id_foto TEXT PRIMARY KEY,
        id_sesi TEXT,
        tanggal_kerja TEXT NOT NULL,
        id_karyawan TEXT NOT NULL,
        nama TEXT NOT NULL,
        divisi TEXT,
        jenis_scan TEXT NOT NULL,
        timestamp_scan TEXT NOT NULL,
        sumber_data TEXT NOT NULL DEFAULT 'Scanner',
        kode_operator TEXT,
        ip_perangkat TEXT,
        client_id TEXT,
        foto_mime TEXT NOT NULL DEFAULT 'image/jpeg',
        foto_base64 TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_local_absensi_foto_tanggal
        ON absensi_foto(tanggal_kerja, timestamp_scan DESC);
      CREATE INDEX IF NOT EXISTS idx_local_absensi_foto_sesi
        ON absensi_foto(id_sesi);
      CREATE TABLE IF NOT EXISTS desktop_client_identity (
        server_origin TEXT PRIMARY KEY,
        client_id TEXT UNIQUE NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS desktop_sync_outbox (
        event_id TEXT PRIMARY KEY,
        client_id TEXT NOT NULL,
        domain TEXT NOT NULL,
        operation TEXT NOT NULL,
        entity_key TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        base_revision INTEGER,
        status TEXT NOT NULL DEFAULT 'pending'
          CHECK(status IN ('pending', 'synced', 'failed', 'conflict')),
        attempt_count INTEGER NOT NULL DEFAULT 0,
        next_retry_at INTEGER,
        last_error TEXT,
        server_revision INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS desktop_sync_cursor (
        domain TEXT PRIMARY KEY,
        last_revision INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL
      );
      -- Nilai `sync_pulse` cloud per tabel yang terakhir berhasil diterapkan.
      -- Dipakai pull inkremental untuk hanya menarik tabel yang benar-benar basi.
      CREATE TABLE IF NOT EXISTS desktop_sync_table_cursor (
        table_name TEXT PRIMARY KEY,
        remote_revision INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS desktop_sync_conflict (
        event_id TEXT PRIMARY KEY,
        domain TEXT NOT NULL,
        entity_key TEXT NOT NULL,
        local_payload_json TEXT NOT NULL,
        server_payload_json TEXT,
        reason TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        resolved_at INTEGER,
        FOREIGN KEY (event_id) REFERENCES desktop_sync_outbox(event_id)
      );
      CREATE TABLE IF NOT EXISTS desktop_entity_revision (
        domain TEXT NOT NULL,
        entity_key TEXT NOT NULL,
        server_revision INTEGER NOT NULL,
        payload_hash TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (domain, entity_key)
      );
      CREATE TABLE IF NOT EXISTS import_offline (
        id_import INTEGER PRIMARY KEY,
        event_key TEXT UNIQUE NOT NULL,
        timestamp_input TEXT NOT NULL,
        tanggal TEXT NOT NULL,
        id_unik TEXT NOT NULL,
        nama TEXT,
        divisi TEXT,
        jam_masuk TEXT,
        jam_pulang TEXT,
        status_kehadiran TEXT,
        status_absen TEXT,
        keterangan TEXT,
        status_proses TEXT NOT NULL DEFAULT 'Belum Diproses',
        diproses_pada TEXT,
        pesan_error TEXT,
        kode_operator TEXT
      );
      CREATE TABLE IF NOT EXISTS company_profile (
        id TEXT PRIMARY KEY DEFAULT 'default_company',
        company_name TEXT NOT NULL DEFAULT 'YOUR COMPANY',
        branch_name TEXT,
        logo_url TEXT,
        signature_url TEXT,
        address TEXT,
        phone TEXT,
        email TEXT,
        website TEXT,
        leader_name TEXT,
        leader_title TEXT,
        leader_nip TEXT,
        card_terms TEXT,
        timezone TEXT DEFAULT 'Asia/Jakarta',
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS id_card_template (
        id TEXT PRIMARY KEY DEFAULT 'default_template',
        name TEXT NOT NULL DEFAULT 'Default ID Card Template',
        orientation TEXT NOT NULL DEFAULT 'landscape',
        front_bg_url TEXT,
        back_bg_url TEXT,
        elements_json TEXT NOT NULL,
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_local_log_scan_employee_date
        ON log_scan(id_karyawan, tanggal_kerja);
      CREATE INDEX IF NOT EXISTS idx_local_log_scan_tanggal
        ON log_scan(tanggal_kerja);
      CREATE INDEX IF NOT EXISTS idx_local_attendance_employee_date
        ON absensi_harian(id_karyawan, tanggal);
      CREATE INDEX IF NOT EXISTS idx_local_absensi_tanggal
        ON absensi_harian(tanggal);
      CREATE INDEX IF NOT EXISTS idx_local_backup_tanggal_status
        ON backup_karyawan(tanggal_tugas, status_tugas);
      CREATE INDEX IF NOT EXISTS idx_local_master_data_shift_aktif
        ON master_data(id_shift, status_aktif);
      CREATE INDEX IF NOT EXISTS idx_local_outbox_status_retry
        ON desktop_sync_outbox(status, next_retry_at, created_at);
      CREATE INDEX IF NOT EXISTS idx_local_outbox_domain_entity
        ON desktop_sync_outbox(domain, entity_key, status);
      CREATE INDEX IF NOT EXISTS idx_local_import_status
        ON import_offline(status_proses, timestamp_input);
      CREATE TABLE IF NOT EXISTS salary_configs (
        id TEXT PRIMARY KEY,
        id_karyawan TEXT NOT NULL,
        rate_per_hour INTEGER NOT NULL CHECK (rate_per_hour >= 0),
        -- Tarif bawaan per jam pelajaran, dipakai ketika mapel yang diajar
        -- belum punya tarif sendiri di `tarif_jp`. Nol berarti orang ini
        -- memang tidak dibayar per JP — itu keadaan normal bagi karyawan
        -- non-guru, jadi ketiadaan tarif TIDAK PERNAH menggagalkan payroll.
        rate_per_jp INTEGER NOT NULL DEFAULT 0 CHECK (rate_per_jp >= 0),
        ptkp_status TEXT NOT NULL DEFAULT 'TK/0'
          CHECK (ptkp_status IN ('TK/0','TK/1','TK/2','TK/3','K/0','K/1','K/2','K/3')),
        effective_date TEXT NOT NULL,
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(id_karyawan, effective_date)
      );
      CREATE TABLE IF NOT EXISTS overtime_tier_rules (
        id TEXT PRIMARY KEY,
        rule_type TEXT NOT NULL CHECK (rule_type IN ('HARI_KERJA', 'HARI_LIBUR')),
        tier_order INTEGER NOT NULL,
        hour_start REAL NOT NULL CHECK (hour_start >= 0),
        hour_end REAL,
        multiplier REAL NOT NULL CHECK (multiplier >= 1.0),
        is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
        UNIQUE(rule_type, tier_order)
      );
      CREATE TABLE IF NOT EXISTS payroll_components (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        category TEXT NOT NULL CHECK (category IN ('ALLOWANCE', 'DEDUCTION')),
        -- PER_JP dan PER_HADIR ditambahkan pada schema versi 25. Database yang
        -- sudah ada TIDAK diperbaiki oleh CREATE TABLE IF NOT EXISTS ini —
        -- `ensure_payroll_calc_type_values` yang membangunnya ulang.
        calc_type TEXT NOT NULL
          CHECK (calc_type IN ('FIXED', 'PERCENTAGE', 'PER_JP', 'PER_HADIR')),
        default_value REAL NOT NULL DEFAULT 0 CHECK (default_value >= 0),
        applies_to TEXT NOT NULL DEFAULT 'ALL',
        is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS tax_rules (
        id TEXT PRIMARY KEY,
        category TEXT NOT NULL CHECK (category IN ('TER_A','TER_B','TER_C','PASAL_17')),
        bracket_min INTEGER NOT NULL,
        bracket_max INTEGER,
        rate_percentage REAL NOT NULL CHECK (rate_percentage >= 0),
        effective_date TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS bpjs_rules (
        id TEXT PRIMARY KEY,
        component_code TEXT NOT NULL UNIQUE,
        component_name TEXT NOT NULL,
        rate_percentage REAL NOT NULL CHECK (rate_percentage >= 0),
        wage_cap INTEGER,
        effective_date TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS payroll_runs (
        id TEXT PRIMARY KEY,
        idempotency_key TEXT NOT NULL UNIQUE,
        period_start TEXT NOT NULL,
        period_end TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'DRAFT'
          CHECK (status IN ('DRAFT','SUBMITTED','REVIEWED','APPROVED','PAID','REJECTED')),
        total_gross_payout INTEGER NOT NULL DEFAULT 0,
        total_net_payout INTEGER NOT NULL DEFAULT 0,
        total_employees INTEGER NOT NULL DEFAULT 0,
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS payroll_items (
        id TEXT PRIMARY KEY,
        payroll_run_id TEXT NOT NULL REFERENCES payroll_runs(id) ON DELETE CASCADE,
        id_karyawan TEXT NOT NULL,
        nama_karyawan TEXT NOT NULL,
        divisi TEXT NOT NULL,
        ptkp_status TEXT NOT NULL DEFAULT 'TK/0',
        total_regular_hours REAL NOT NULL,
        total_overtime_hours REAL NOT NULL,
        total_overtime_index REAL NOT NULL,
        total_holiday_hours REAL NOT NULL DEFAULT 0,
        total_holiday_overtime_index REAL NOT NULL DEFAULT 0,
        -- Honor mengajar yang DIBEKUKAN (schema versi 22). Jumlah jam
        -- pelajaran dan uangnya disimpan di sini, bukan dihitung ulang dari
        -- `presensi_mapel`, supaya slip yang sudah terbit tidak berubah ketika
        -- presensi kelas atau tarifnya disunting kemudian.
        total_teaching_jp INTEGER NOT NULL DEFAULT 0,
        teaching_salary INTEGER NOT NULL DEFAULT 0 CHECK (teaching_salary >= 0),
        rate_per_hour INTEGER NOT NULL,
        basic_salary INTEGER NOT NULL CHECK (basic_salary >= 0),
        overtime_salary INTEGER NOT NULL CHECK (overtime_salary >= 0),
        gross_salary INTEGER NOT NULL CHECK (gross_salary >= 0),
        total_allowances INTEGER NOT NULL DEFAULT 0,
        total_deductions INTEGER NOT NULL DEFAULT 0,
        bpjs_employee_total INTEGER NOT NULL DEFAULT 0,
        bpjs_company_total INTEGER NOT NULL DEFAULT 0,
        pph21_amount INTEGER NOT NULL DEFAULT 0,
        net_salary INTEGER NOT NULL CHECK (net_salary >= 0),
        breakdown_snapshot TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE (payroll_run_id, id_karyawan)
      );
      CREATE TABLE IF NOT EXISTS payroll_audit_logs (
        id TEXT PRIMARY KEY,
        payroll_run_id TEXT NOT NULL REFERENCES payroll_runs(id) ON DELETE CASCADE,
        action TEXT NOT NULL,
        old_status TEXT,
        new_status TEXT NOT NULL,
        performed_by TEXT NOT NULL,
        notes TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_local_payroll_items_run ON payroll_items(payroll_run_id);
      CREATE INDEX IF NOT EXISTS idx_local_payroll_items_karyawan ON payroll_items(id_karyawan);
      CREATE INDEX IF NOT EXISTS idx_local_payroll_runs_status ON payroll_runs(status, period_start);
      CREATE INDEX IF NOT EXISTS idx_local_salary_configs_karyawan ON salary_configs(id_karyawan, effective_date DESC);
      CREATE TABLE IF NOT EXISTS akademik_tahun_ajaran (
        id_tahun_ajaran TEXT PRIMARY KEY,
        nama_tahun TEXT NOT NULL,
        semester TEXT NOT NULL CHECK (semester IN ('Ganjil', 'Genap')),
        tanggal_mulai TEXT NOT NULL,
        tanggal_selesai TEXT NOT NULL,
        is_aktif INTEGER NOT NULL DEFAULT 0 CHECK (is_aktif IN (0, 1)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS akademik_jurusan (
        id_jurusan TEXT PRIMARY KEY,
        kode_jurusan TEXT NOT NULL,
        nama_jurusan TEXT NOT NULL,
        deskripsi TEXT,
        is_aktif INTEGER NOT NULL DEFAULT 1 CHECK (is_aktif IN (0, 1))
      );
      CREATE TABLE IF NOT EXISTS akademik_rombel (
        id_rombel TEXT PRIMARY KEY,
        id_tahun_ajaran TEXT NOT NULL,
        tingkat INTEGER NOT NULL,
        id_jurusan TEXT,
        nama_rombel TEXT NOT NULL,
        id_wali_kelas TEXT,
        kapasitas INTEGER NOT NULL DEFAULT 36,
        ruang_kelas TEXT,
        is_aktif INTEGER NOT NULL DEFAULT 1 CHECK (is_aktif IN (0, 1))
      );
      CREATE TABLE IF NOT EXISTS akademik_mapel (
        id_mapel TEXT PRIMARY KEY,
        kode_mapel TEXT NOT NULL,
        nama_mapel TEXT NOT NULL,
        tingkat INTEGER,
        kelompok TEXT NOT NULL DEFAULT 'Wajib' CHECK (kelompok IN ('Wajib', 'Peminatan', 'Muatan Lokal', 'Kejuruan')),
        beban_jam INTEGER NOT NULL DEFAULT 2 CHECK (beban_jam > 0),
        kkm INTEGER NOT NULL DEFAULT 75,
        is_aktif INTEGER NOT NULL DEFAULT 1 CHECK (is_aktif IN (0, 1))
      );
      CREATE TABLE IF NOT EXISTS akademik_guru_mapel (
        id_penugasan TEXT PRIMARY KEY,
        id_tahun_ajaran TEXT NOT NULL,
        id_rombel TEXT NOT NULL,
        id_mapel TEXT NOT NULL,
        id_guru TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS guru_data (
        id_guru TEXT PRIMARY KEY,
        nip TEXT,
        nuptk TEXT,
        gelar TEXT,
        spesialisasi_mapel TEXT,
        status_kepegawaian TEXT DEFAULT 'Honorer',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS siswa_data (
        id_siswa TEXT PRIMARY KEY,
        nis TEXT,
        nisn TEXT,
        nama_lengkap TEXT NOT NULL,
        jenis_kelamin TEXT CHECK (jenis_kelamin IN ('L', 'P')),
        id_rombel TEXT NOT NULL,
        nama_wali TEXT,
        no_whatsapp_wali TEXT,
        alamat TEXT,
        angkatan INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'Aktif' CHECK (status IN ('Aktif', 'Lulus', 'Pindah', 'Keluar', 'Drop Out')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_local_rombel_ta ON akademik_rombel(id_tahun_ajaran);
      CREATE INDEX IF NOT EXISTS idx_local_siswa_rombel ON siswa_data(id_rombel, status);
      CREATE INDEX IF NOT EXISTS idx_local_guru_mapel_lookup ON akademik_guru_mapel(id_rombel, id_mapel);
      -- Tarif default payroll di-seed terpisah dari `super::payroll_seed`, satu
      -- sumber bersama dengan seed cloud di `turso.rs`. Jangan tulis ulang di sini.
      INSERT OR IGNORE INTO desktop_schema_migration (version, name, applied_at)
      VALUES (1, 'desktop-security-foundation', unixepoch());
      INSERT OR IGNORE INTO desktop_schema_migration (version, name, applied_at)
      VALUES (2, 'desktop-operational-sync-foundation', unixepoch());
      INSERT OR IGNORE INTO desktop_schema_migration (version, name, applied_at)
      VALUES (3, 'desktop-offline-import-foundation', unixepoch());
      INSERT OR IGNORE INTO desktop_schema_migration (version, name, applied_at)
      VALUES (4, 'desktop-payroll-foundation', unixepoch());
      INSERT OR IGNORE INTO desktop_schema_migration (version, name, applied_at)
      VALUES (5, 'desktop-academic-foundation', unixepoch());
      INSERT OR IGNORE INTO desktop_schema_migration (version, name, applied_at)
      VALUES (6, 'desktop-academic-unique-relaxation', unixepoch());
      CREATE TABLE IF NOT EXISTS presensi_mapel (
        id_presensi_mapel TEXT PRIMARY KEY,
        id_tahun_ajaran TEXT NOT NULL,
        id_rombel TEXT NOT NULL,
        id_mapel TEXT NOT NULL,
        id_guru TEXT NOT NULL,
        tanggal TEXT NOT NULL,
        jam_ke TEXT NOT NULL,
        materi_pokok TEXT,
        catatan TEXT,
        total_hadir INTEGER NOT NULL DEFAULT 0,
        total_izin INTEGER NOT NULL DEFAULT 0,
        total_sakit INTEGER NOT NULL DEFAULT 0,
        total_alfa INTEGER NOT NULL DEFAULT 0,
        total_dispensasi INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS presensi_mapel_detail (
        id_detail TEXT PRIMARY KEY,
        id_presensi_mapel TEXT NOT NULL,
        id_siswa TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('Hadir', 'Izin', 'Sakit', 'Alfa', 'Dispensasi')),
        catatan TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_local_presensi_mapel_lookup
        ON presensi_mapel(id_tahun_ajaran, id_rombel, id_mapel, tanggal);
      CREATE INDEX IF NOT EXISTS idx_local_presensi_mapel_detail_parent
        ON presensi_mapel_detail(id_presensi_mapel);
      CREATE INDEX IF NOT EXISTS idx_local_presensi_mapel_detail_siswa
        ON presensi_mapel_detail(id_siswa, created_at);

      -- ── v28: Modul nilai akademik ──
      --
      -- Kolomnya WAJIB sama persis dengan sisi cloud (`turso.rs` dan
      -- `db-migrations.ts`) dan dengan daftar di `SNAPSHOT_TABLES`. Kolom yang
      -- hanya ada di satu sisi membuat push gagal "no such column" pada
      -- perangkat yang tidak memilikinya — `audit:schema` bagian 4 yang
      -- memeriksanya.
      --
      -- Tanpa UNIQUE dan tanpa FOREIGN KEY: keduanya tabel tersinkronisasi.
      CREATE TABLE IF NOT EXISTS nilai_penilaian (
        id_penilaian TEXT PRIMARY KEY,
        id_tahun_ajaran TEXT NOT NULL,
        semester TEXT NOT NULL CHECK (semester IN ('Ganjil', 'Genap')),
        id_rombel TEXT NOT NULL,
        id_mapel TEXT NOT NULL,
        id_guru TEXT NOT NULL,
        jenis TEXT NOT NULL
          CHECK (jenis IN ('Tugas', 'Ulangan Harian', 'Praktik', 'UTS', 'UAS')),
        nama_penilaian TEXT NOT NULL,
        tanggal TEXT NOT NULL,
        bobot INTEGER NOT NULL DEFAULT 1,
        kkm INTEGER NOT NULL DEFAULT 75,
        nilai_maks INTEGER NOT NULL DEFAULT 100,
        catatan TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      -- `skor` NULL berarti BELUM DINILAI, bukan nol.
      CREATE TABLE IF NOT EXISTS nilai_siswa (
        id_nilai TEXT PRIMARY KEY,
        id_penilaian TEXT NOT NULL,
        id_siswa TEXT NOT NULL,
        skor REAL,
        keterangan TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_local_nilai_penilaian_kelas
        ON nilai_penilaian(id_tahun_ajaran, semester, id_rombel, id_mapel);
      CREATE INDEX IF NOT EXISTS idx_local_nilai_siswa_penilaian
        ON nilai_siswa(id_penilaian);
      CREATE INDEX IF NOT EXISTS idx_local_nilai_siswa_siswa
        ON nilai_siswa(id_siswa, created_at);
      INSERT OR IGNORE INTO desktop_schema_migration (version, name, applied_at)
      VALUES (7, 'desktop-class-attendance-foundation', unixepoch());
      CREATE TABLE IF NOT EXISTS jurnal_mengajar (
        id_jurnal TEXT PRIMARY KEY,
        id_presensi_mapel TEXT NOT NULL,
        materi_disampaikan TEXT,
        kendala TEXT,
        tindak_lanjut TEXT,
        paraf_nama TEXT,
        paraf_operator TEXT,
        paraf_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_local_jurnal_presensi
        ON jurnal_mengajar(id_presensi_mapel);
      CREATE TABLE IF NOT EXISTS leger_kehadiran (
        id_leger TEXT PRIMARY KEY,
        id_tahun_ajaran TEXT NOT NULL,
        semester TEXT NOT NULL CHECK (semester IN ('Ganjil', 'Genap')),
        id_siswa TEXT NOT NULL,
        id_rombel TEXT NOT NULL,
        total_hari_efektif INTEGER NOT NULL DEFAULT 0,
        hadir INTEGER NOT NULL DEFAULT 0,
        izin INTEGER NOT NULL DEFAULT 0,
        sakit INTEGER NOT NULL DEFAULT 0,
        alfa INTEGER NOT NULL DEFAULT 0,
        dispensasi INTEGER NOT NULL DEFAULT 0,
        persen_kehadiran REAL NOT NULL DEFAULT 0,
        dibekukan_at TEXT NOT NULL,
        dibekukan_oleh TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_local_leger_scope
        ON leger_kehadiran(id_tahun_ajaran, semester, id_rombel, id_siswa);
      CREATE TABLE IF NOT EXISTS siswa_foto (
        id_siswa TEXT PRIMARY KEY,
        foto_mime TEXT NOT NULL DEFAULT 'image/jpeg',
        foto_base64 TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      INSERT OR IGNORE INTO desktop_schema_migration (version, name, applied_at)
      VALUES (8, 'desktop-teaching-journal-and-attendance-ledger', unixepoch());
      CREATE TABLE IF NOT EXISTS notifikasi_wa (
        id_notifikasi TEXT PRIMARY KEY,
        dedupe_key TEXT NOT NULL,
        jenis TEXT NOT NULL CHECK (jenis IN ('scan_masuk', 'scan_pulang', 'bolos', 'ambang_alfa')),
        id_siswa TEXT,
        tujuan_nomor TEXT NOT NULL,
        isi_pesan TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'Menunggu' CHECK (status IN ('Menunggu', 'Terkirim', 'Gagal', 'Dibatalkan')),
        attempt_count INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        sent_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_local_notifikasi_wa_status ON notifikasi_wa(status, created_at);
      CREATE INDEX IF NOT EXISTS idx_local_notifikasi_wa_dedupe ON notifikasi_wa(dedupe_key);
      INSERT OR IGNORE INTO desktop_schema_migration (version, name, applied_at)
      VALUES (9, 'desktop-whatsapp-notification-queue', unixepoch());
      -- Tarif honor per jam pelajaran (schema versi 22).
      --
      -- `id_guru` NULL berarti tarif itu berlaku untuk SIAPA PUN yang mengajar
      -- mapel tersebut; diisi berarti tarif khusus guru itu dan menang atas
      -- tarif umum. `id_mapel` dipakai sebagai kunci karena `akademik_mapel`
      -- ber-PK TEXT acak yang sama di semua perangkat — berbeda dari `id_shift`
      -- yang AUTOINCREMENT dan berbeda per perangkat.
      --
      -- SENGAJA tanpa UNIQUE selain PK: dua perangkat offline boleh membuat
      -- tarif untuk mapel yang sama, dan sebuah UNIQUE akan membuat push-nya
      -- gagal permanen. Duplikatnya tidak berbahaya karena pemilihan tarif
      -- selalu deterministik (lihat `resolve_jp_rate`), dan pencegahannya
      -- dilakukan di lapisan aplikasi.
      CREATE TABLE IF NOT EXISTS tarif_jp (
        id TEXT PRIMARY KEY,
        id_mapel TEXT NOT NULL,
        id_guru TEXT,
        rate_per_jp INTEGER NOT NULL CHECK (rate_per_jp >= 0),
        effective_date TEXT NOT NULL,
        status_aktif INTEGER NOT NULL DEFAULT 1 CHECK (status_aktif IN (0, 1)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_local_tarif_jp_lookup
        ON tarif_jp(id_mapel, effective_date DESC);
      INSERT OR IGNORE INTO desktop_schema_migration (version, name, applied_at)
      VALUES (10, 'desktop-teaching-jp-rate', unixepoch());
      -- Jadwal bel sekolah: jam pelajaran ke berapa berlangsung pukul berapa
      -- (schema versi 23).
      --
      -- Tabel ini KETERANGAN, bukan penentu: presensi kelas tetap menyimpan
      -- `jam_ke` dan honor tetap dihitung per jam pelajaran. Karena itu baris
      -- yang belum lengkap tidak pernah menghalangi presensi — layar hanya
      -- berhenti menampilkan pukulnya.
      --
      -- SENGAJA tanpa UNIQUE pada `jam_ke`: dua perangkat offline boleh
      -- mendaftarkan jam yang sama, dan UNIQUE akan membuat push-nya gagal
      -- permanen. Pencegahannya di lapisan aplikasi, yang bisa memberi pesan
      -- ramah.
      CREATE TABLE IF NOT EXISTS akademik_jam_pelajaran (
        id_jam_pelajaran TEXT PRIMARY KEY,
        jam_ke INTEGER NOT NULL CHECK (jam_ke >= 1),
        jam_mulai TEXT NOT NULL,
        jam_selesai TEXT NOT NULL,
        jenis TEXT NOT NULL DEFAULT 'KBM'
          CHECK (jenis IN ('KBM', 'Istirahat', 'Upacara', 'Ekstrakurikuler')),
        keterangan TEXT,
        is_aktif INTEGER NOT NULL DEFAULT 1 CHECK (is_aktif IN (0, 1)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_local_jam_pelajaran_urut
        ON akademik_jam_pelajaran(jam_ke, jam_mulai);
      INSERT OR IGNORE INTO desktop_schema_migration (version, name, applied_at)
      VALUES (11, 'desktop-lesson-period-schedule', unixepoch());
      -- Jadwal mengajar mingguan per rombel (schema versi 24).
      --
      -- Seperti jadwal bel, tabel ini KETERANGAN: presensi kelas tetap bisa
      -- dicatat tanpa jadwal, dan jadwal hanya memberi tombol isi-cepat.
      -- `hari` disimpan 1=Senin sampai 7=Minggu, dan diturunkan dari tanggal
      -- lewat SQL (`strftime('%w')`) supaya tidak ada aritmetika tanggal yang
      -- dieja dua kali di Rust dan TypeScript.
      --
      -- SENGAJA tanpa UNIQUE: dua perangkat offline boleh menyusun jadwal yang
      -- sama, dan UNIQUE akan membuat push-nya gagal permanen. Bentroknya
      -- dicegah di lapisan aplikasi, dengan cakupan yang sama seperti presensi
      -- (rombel + mapel + hari), bukan seluruh rombel — pelajaran Agama memang
      -- memecah satu rombel pada jam yang sama.
      CREATE TABLE IF NOT EXISTS jadwal_mengajar (
        id_jadwal TEXT PRIMARY KEY,
        id_tahun_ajaran TEXT NOT NULL,
        id_rombel TEXT NOT NULL,
        id_mapel TEXT NOT NULL,
        id_guru TEXT NOT NULL,
        hari INTEGER NOT NULL CHECK (hari BETWEEN 1 AND 7),
        jam_ke TEXT NOT NULL,
        is_aktif INTEGER NOT NULL DEFAULT 1 CHECK (is_aktif IN (0, 1)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_local_jadwal_mengajar_lookup
        ON jadwal_mengajar(id_tahun_ajaran, id_rombel, hari);
      INSERT OR IGNORE INTO desktop_schema_migration (version, name, applied_at)
      VALUES (12, 'desktop-teaching-schedule', unixepoch());
      "#,
        )
        .map_err(|_| "Schema keamanan Desktop tidak dapat diinisialisasi.".to_owned())?;

    seed_payroll_rate_tables(&connection)?;

    ensure_attendance_source_check(&connection)?;

    // v25: memperluas CHECK `calc_type` untuk tunjangan per JP dan per hadir.
    ensure_payroll_calc_type_values(&connection)?;

    // v17: melepas UNIQUE dari tabel akademik yang ikut sinkronisasi. Cerminan
    // `TursoClient::rebuild_without_unique` — lihat alasan lengkapnya di sana.
    rebuild_without_unique(
        &connection,
        "akademik_jurusan",
        "CREATE TABLE akademik_jurusan (
            id_jurusan TEXT PRIMARY KEY,
            kode_jurusan TEXT NOT NULL,
            nama_jurusan TEXT NOT NULL,
            deskripsi TEXT,
            is_aktif INTEGER NOT NULL DEFAULT 1 CHECK (is_aktif IN (0, 1))
        );",
        "id_jurusan, kode_jurusan, nama_jurusan, deskripsi, is_aktif",
        &[],
    )?;
    rebuild_without_unique(
        &connection,
        "akademik_mapel",
        "CREATE TABLE akademik_mapel (
            id_mapel TEXT PRIMARY KEY,
            kode_mapel TEXT NOT NULL,
            nama_mapel TEXT NOT NULL,
            tingkat INTEGER,
            kelompok TEXT NOT NULL DEFAULT 'Wajib' CHECK (kelompok IN ('Wajib', 'Peminatan', 'Muatan Lokal', 'Kejuruan')),
            beban_jam INTEGER NOT NULL DEFAULT 2 CHECK (beban_jam > 0),
            kkm INTEGER NOT NULL DEFAULT 75,
            is_aktif INTEGER NOT NULL DEFAULT 1 CHECK (is_aktif IN (0, 1))
        );",
        "id_mapel, kode_mapel, nama_mapel, tingkat, kelompok, beban_jam, kkm, is_aktif",
        &[],
    )?;
    rebuild_without_unique(
        &connection,
        "akademik_guru_mapel",
        "CREATE TABLE akademik_guru_mapel (
            id_penugasan TEXT PRIMARY KEY,
            id_tahun_ajaran TEXT NOT NULL,
            id_rombel TEXT NOT NULL,
            id_mapel TEXT NOT NULL,
            id_guru TEXT NOT NULL
        );",
        "id_penugasan, id_tahun_ajaran, id_rombel, id_mapel, id_guru",
        &["CREATE INDEX IF NOT EXISTS idx_local_guru_mapel_lookup ON akademik_guru_mapel(id_rombel, id_mapel);"],
    )?;
    rebuild_without_unique(
        &connection,
        "siswa_data",
        "CREATE TABLE siswa_data (
            id_siswa TEXT PRIMARY KEY,
            nis TEXT,
            nisn TEXT,
            nama_lengkap TEXT NOT NULL,
            jenis_kelamin TEXT CHECK (jenis_kelamin IN ('L', 'P')),
            id_rombel TEXT NOT NULL,
            nama_wali TEXT,
            no_whatsapp_wali TEXT,
            alamat TEXT,
            angkatan INTEGER NOT NULL,
            status TEXT NOT NULL DEFAULT 'Aktif' CHECK (status IN ('Aktif', 'Lulus', 'Pindah', 'Keluar', 'Drop Out')),
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );",
        "id_siswa, nis, nisn, nama_lengkap, jenis_kelamin, id_rombel, nama_wali, no_whatsapp_wali, alamat, angkatan, status, created_at, updated_at",
        &["CREATE INDEX IF NOT EXISTS idx_local_siswa_rombel ON siswa_data(id_rombel, status);"],
    )?;

    ensure_column(
        &connection,
        "tbl_shift",
        "izinkan_multi_sesi",
        "ALTER TABLE tbl_shift ADD COLUMN izinkan_multi_sesi INTEGER DEFAULT 0;",
    )?;

    // Pemisahan jam kerja hari libur (v14). Database lokal yang dibuat sebelum
    // versi ini sudah memiliki payroll_items, sehingga CREATE TABLE IF NOT
    // EXISTS di atas tidak akan menambahkan kolomnya — hanya ALTER yang bisa.
    ensure_column(
        &connection,
        "payroll_items",
        "total_holiday_hours",
        "ALTER TABLE payroll_items ADD COLUMN total_holiday_hours REAL NOT NULL DEFAULT 0;",
    )?;
    ensure_column(
        &connection,
        "payroll_items",
        "total_holiday_overtime_index",
        "ALTER TABLE payroll_items ADD COLUMN total_holiday_overtime_index REAL NOT NULL DEFAULT 0;",
    )?;

    // Honor mengajar per jam pelajaran (v22). Alasan yang sama dengan blok di
    // atas: `payroll_items` dan `salary_configs` sudah ada di database lama.
    ensure_column(
        &connection,
        "payroll_items",
        "total_teaching_jp",
        "ALTER TABLE payroll_items ADD COLUMN total_teaching_jp INTEGER NOT NULL DEFAULT 0;",
    )?;
    ensure_column(
        &connection,
        "payroll_items",
        "teaching_salary",
        "ALTER TABLE payroll_items ADD COLUMN teaching_salary INTEGER NOT NULL DEFAULT 0;",
    )?;
    ensure_column(
        &connection,
        "salary_configs",
        "rate_per_jp",
        "ALTER TABLE salary_configs ADD COLUMN rate_per_jp INTEGER NOT NULL DEFAULT 0;",
    )?;

    // Stempel waktu pembuatan tarif payroll. `turso.rs` sudah memilikinya di
    // CREATE TABLE maupun di daftar ensure_column-nya, sehingga tanpa blok ini
    // tabel yang sama punya bentuk berbeda di perangkat dan di cloud. Nullable
    // karena SQLite menolak ADD COLUMN dengan default non-konstan seperti
    // `datetime('now')` — hanya CREATE TABLE yang mengizinkannya.
    for (table, column, sql) in [
        (
            "tax_rules",
            "created_at",
            "ALTER TABLE tax_rules ADD COLUMN created_at TEXT;",
        ),
        (
            "bpjs_rules",
            "created_at",
            "ALTER TABLE bpjs_rules ADD COLUMN created_at TEXT;",
        ),
        (
            "payroll_components",
            "created_at",
            "ALTER TABLE payroll_components ADD COLUMN created_at TEXT;",
        ),
    ] {
        ensure_column(&connection, table, column, sql)?;
    }

    // Shift tujuan sesi lanjutan. 0 = belum ditentukan, sehingga pemasangan
    // lama yang hanya menyalakan izinkan_multi_sesi tetap memakai pencocokan
    // jendela otomatis seperti sebelumnya.
    ensure_column(
        &connection,
        "tbl_shift",
        "shift_lanjutan_id",
        "ALTER TABLE tbl_shift ADD COLUMN shift_lanjutan_id INTEGER DEFAULT 0;",
    )?;

    let has_holiday_table: bool = connection
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'tbl_hari_libur';",
            [],
            |row| row.get::<_, i64>(0),
        )
        .map(|count| count > 0)
        .unwrap_or(false);
    if !has_holiday_table {
        connection
            .execute_batch(
                r#"
            CREATE TABLE IF NOT EXISTS tbl_hari_libur (
                id_libur INTEGER PRIMARY KEY AUTOINCREMENT,
                tanggal TEXT UNIQUE NOT NULL,
                nama_libur TEXT NOT NULL,
                jenis_libur TEXT DEFAULT 'Libur Nasional',
                keterangan TEXT,
                status_aktif INTEGER DEFAULT 1
            );
            CREATE INDEX IF NOT EXISTS idx_local_hari_libur_tanggal
                ON tbl_hari_libur(tanggal, status_aktif);
            "#,
            )
            .map_err(|_| "Tabel hari libur lokal tidak dapat dimigrasikan.".to_owned())?;
    }

    let has_company_profile: bool = connection
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'company_profile';",
            [],
            |row| row.get::<_, i64>(0),
        )
        .map(|count| count > 0)
        .unwrap_or(false);
    if !has_company_profile {
        connection
            .execute_batch(
                r#"
            CREATE TABLE IF NOT EXISTS company_profile (
                id TEXT PRIMARY KEY DEFAULT 'default_company',
                company_name TEXT NOT NULL DEFAULT 'SPPG',
                branch_name TEXT,
                logo_url TEXT,
                signature_url TEXT,
                address TEXT,
                phone TEXT,
                email TEXT,
                website TEXT,
                leader_name TEXT,
                leader_title TEXT,
                leader_nip TEXT,
                card_terms TEXT,
                timezone TEXT DEFAULT 'Asia/Jakarta',
                updated_at TEXT NOT NULL
            );
            "#,
            )
            .map_err(|_| "Tabel profil perusahaan lokal tidak dapat dimigrasikan.".to_owned())?;
    }

    let has_id_card_template: bool = connection
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'id_card_template';",
            [],
            |row| row.get::<_, i64>(0),
        )
        .map(|count| count > 0)
        .unwrap_or(false);
    if !has_id_card_template {
        connection
            .execute_batch(
                r#"
            CREATE TABLE IF NOT EXISTS id_card_template (
                id TEXT PRIMARY KEY DEFAULT 'default_template',
                name TEXT NOT NULL DEFAULT 'Template Default SPPG',
                orientation TEXT NOT NULL DEFAULT 'landscape',
                front_bg_url TEXT,
                back_bg_url TEXT,
                elements_json TEXT NOT NULL,
                is_active INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            "#,
            )
            .map_err(|_| "Tabel template ID card lokal tidak dapat dimigrasikan.".to_owned())?;
    }

    // Idempotent column migrations for legacy operational databases.
    for (column, sql) in [
        (
            "timestamp_input",
            "ALTER TABLE import_offline ADD COLUMN timestamp_input TEXT;",
        ),
        (
            "id_unik",
            "ALTER TABLE import_offline ADD COLUMN id_unik TEXT;",
        ),
        (
            "status_absen",
            "ALTER TABLE import_offline ADD COLUMN status_absen TEXT;",
        ),
        (
            "status_proses",
            "ALTER TABLE import_offline ADD COLUMN status_proses TEXT DEFAULT 'Belum Diproses';",
        ),
        (
            "diproses_pada",
            "ALTER TABLE import_offline ADD COLUMN diproses_pada TEXT;",
        ),
        (
            "pesan_error",
            "ALTER TABLE import_offline ADD COLUMN pesan_error TEXT;",
        ),
    ] {
        ensure_column(&connection, "import_offline", column, sql)?;
    }

    connection
        .execute_batch(
            r#"
            UPDATE desktop_sync_outbox
            SET domain = 'log-scan'
            WHERE domain IN ('scan-log', 'scan_log', 'log_scan');
            DELETE FROM desktop_entity_revision AS legacy
            WHERE legacy.domain IN ('scan-log', 'scan_log', 'log_scan')
              AND EXISTS (
                SELECT 1 FROM desktop_entity_revision AS canonical
                WHERE canonical.domain = 'log-scan'
                  AND canonical.entity_key = legacy.entity_key
              );
            UPDATE desktop_entity_revision
            SET domain = 'log-scan'
            WHERE domain IN ('scan-log', 'scan_log', 'log_scan');
            "#,
        )
        .map_err(|_| "Domain sinkronisasi log scan lokal tidak dapat dinormalisasi.".to_owned())?;

    Ok(())
}

/// Tabel operasional lokal yang isinya 100% milik satu database cloud.
///
/// Semuanya adalah cache dari Turso: tidak ada satu pun baris di sini yang
/// bermakna tanpa database asalnya. Ketika perangkat dipindahkan ke database
/// Turso lain, isi tabel-tabel inilah yang harus hilang.
///
/// Daftar ini dulu berhenti di tabel era payroll, sehingga seluruh tabel sekolah
/// Fase 2–4 selamat dari pembersihan. Akibatnya nyata: perangkat yang pindah
/// dari Mode Database Lokal ke Turso tetap MENAMPILKAN tahun ajaran, rombel,
/// mapel, dan siswa milik database lama — padahal outbox-nya sudah dibuang di
/// bawah dan `delete_missing` mati, jadi baris itu tidak pernah sampai ke cloud
/// dan tidak pernah terlihat di perangkat lain. Dua test menjaganya sekarang:
/// `every_local_table_is_classified_for_database_switch` di sini, dan
/// `every_snapshot_table_is_purged_on_database_switch` di `sync.rs`.
pub(crate) const CLOUD_MIRRORED_TABLES: &[&str] = &[
    "absensi_harian",
    "log_scan",
    "koreksi_admin",
    "import_offline",
    "audit_absensi",
    "backup_karyawan",
    "id_card",
    "id_card_template",
    "master_data",
    "tbl_shift",
    "tbl_hari_libur",
    "hari_libur_whitelist",
    "company_profile",
    "payroll_audit_logs",
    "payroll_items",
    "payroll_runs",
    "payroll_components",
    "salary_configs",
    "overtime_tier_rules",
    "tarif_jp",
    "tax_rules",
    "bpjs_rules",
    "akademik_tahun_ajaran",
    "akademik_jurusan",
    "akademik_rombel",
    "akademik_mapel",
    "akademik_guru_mapel",
    "akademik_jam_pelajaran",
    "jadwal_mengajar",
    "guru_data",
    "siswa_data",
    "presensi_mapel",
    "presensi_mapel_detail",
    "jurnal_mengajar",
    "leger_kehadiran",
    // v28 — nilai akademik. Ikut dibuang saat pindah database: skor seorang
    // anak milik sekolah tempat ia bersekolah, dan membiarkannya tertinggal
    // membuat nilai dari database lama muncul di kelas database baru.
    "nilai_penilaian",
    "nilai_siswa",
    // Di luar snapshot tetapi tetap milik database asalnya: foto didorong ke
    // cloud lewat outbox dan antrean WA berisi nomor wali siswa database lama.
    "absensi_foto",
    "siswa_foto",
    "notifikasi_wa",
];

/// Tabel lokal yang SENGAJA tidak ikut `CLOUD_MIRRORED_TABLES`.
///
/// `setting_gex_system` dibersihkan per kunci (kunci koneksi perangkat
/// dipertahankan); tabel `desktop_*` adalah identitas, vault, dan state
/// sinkronisasi perangkat — yang terakhir dikosongkan tersendiri di
/// `reset_cloud_linked_data`.
#[cfg(test)]
const DEVICE_OWNED_TABLES: &[&str] = &[
    "setting_gex_system",
    "desktop_schema_migration",
    "desktop_credential_index",
    "desktop_credential_alias",
    "desktop_security_audit",
    "desktop_login_rate_limit",
    "desktop_device_identity",
    "desktop_client_identity",
    "desktop_sync_outbox",
    "desktop_sync_cursor",
    "desktop_sync_table_cursor",
    "desktop_sync_conflict",
    "desktop_entity_revision",
];

/// Membuang seluruh jejak database cloud lama ketika perangkat dipindahkan ke
/// database Turso yang berbeda.
///
/// Tanpa ini, memindah aplikasi ke database baru hanya mengganti kredensial:
/// karyawan, absensi, log scan, dan payroll dari database lama tetap tersimpan
/// di SQLite lokal, tetap tampil di layar, dan outbox lama tetap terdorong ke
/// database baru. Snapshot pull tidak bisa membereskannya karena `delete_missing`
/// sengaja dimatikan untuk hampir semua tabel — cloud kosong memang tidak boleh
/// menghapus data lokal yang belum pernah dilacak server. Jadi pembersihan wajib
/// dilakukan tepat di titik perpindahan database.
///
/// Yang sengaja DIPERTAHANKAN: `desktop_schema_migration`, `desktop_device_identity`,
/// dan `desktop_client_identity` (identitas perangkat dipakai untuk membuka vault
/// kredensial yang baru saja ditulis), serta setting koneksi milik perangkat ini
/// (`device_local_setting_keys`) yang justru menentukan database tujuan baru.
pub fn reset_cloud_linked_data(
    path: &Path,
    device_local_setting_keys: &[&str],
) -> Result<(), CommandError> {
    let mut connection = database(path)?;
    let transaction = connection
        .transaction()
        .map_err(|_| CommandError::internal())?;

    // Foreign key antar tabel cache tidak relevan saat seluruh cache dibuang.
    transaction
        .execute_batch("PRAGMA defer_foreign_keys = ON;")
        .map_err(|_| CommandError::internal())?;

    for table in CLOUD_MIRRORED_TABLES {
        transaction
            .execute(&format!("DELETE FROM {table};"), [])
            .map_err(|_| {
                CommandError::new(
                    "LOCAL_RESET_FAILED",
                    "Data lokal database lama tidak dapat dibersihkan.",
                )
            })?;
    }

    // Setting operasional ikut dibuang, kecuali kunci koneksi perangkat ini.
    let placeholders = vec!["?"; device_local_setting_keys.len()].join(", ");
    transaction
        .execute(
            &format!("DELETE FROM setting_gex_system WHERE key NOT IN ({placeholders});"),
            rusqlite::params_from_iter(device_local_setting_keys.iter()),
        )
        .map_err(|_| {
            CommandError::new(
                "LOCAL_RESET_FAILED",
                "Pengaturan lokal database lama tidak dapat dibersihkan.",
            )
        })?;

    // Seluruh state sinkronisasi milik database lama: outbox yang belum terkirim
    // ke database lama TIDAK boleh dikirim ke database baru.
    transaction
        .execute_batch(
            r#"
            DELETE FROM desktop_sync_outbox;
            DELETE FROM desktop_sync_conflict;
            DELETE FROM desktop_entity_revision;
            DELETE FROM desktop_sync_cursor;
            DELETE FROM desktop_sync_table_cursor;
            DELETE FROM desktop_credential_alias;
            DELETE FROM desktop_credential_index;
            DELETE FROM desktop_login_rate_limit;
            "#,
        )
        .map_err(|_| {
            CommandError::new(
                "LOCAL_RESET_FAILED",
                "Status sinkronisasi database lama tidak dapat dibersihkan.",
            )
        })?;

    // Tarif default payroll bukan data cloud, melainkan seed bawaan aplikasi.
    // Tabelnya baru saja dikosongkan, jadi tanam ulang di transaksi yang sama.
    seed_payroll_rate_tables(&transaction)
        .map_err(|message| CommandError::new("LOCAL_RESET_FAILED", message))?;

    transaction.commit().map_err(|_| CommandError::internal())?;

    // Snapshot login offline terikat ke origin database lama, jadi sudah tidak
    // pernah bisa dipakai lagi. Buang berkasnya supaya kredensial operator
    // database lama tidak tertinggal di perangkat. Vault koneksi Turso
    // (`turso_config.*`) justru baru saja ditulis untuk database baru — jangan
    // disentuh.
    let credentials_dir = path.join("credentials");
    if let Ok(entries) = std::fs::read_dir(&credentials_dir) {
        for entry in entries.flatten() {
            let name = entry.file_name();
            let name = name.to_string_lossy();
            if name.starts_with("turso_config.") {
                continue;
            }
            let _ = std::fs::remove_file(entry.path());
        }
    }

    Ok(())
}

pub fn save_credential_index(
    path: &Path,
    credential: &OfflineCredential,
) -> Result<(), CommandError> {
    let mut connection = database(path)?;
    let transaction = connection
        .transaction()
        .map_err(|_| CommandError::internal())?;

    transaction
        .execute(
            r#"
      INSERT INTO desktop_credential_index (
        identity_key, operator_id, username, kode_operator, role_key,
        permission_revision, provisioned_at, offline_valid_until, server_origin
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(identity_key) DO UPDATE SET
        operator_id = excluded.operator_id,
        username = excluded.username,
        kode_operator = excluded.kode_operator,
        role_key = excluded.role_key,
        permission_revision = excluded.permission_revision,
        provisioned_at = excluded.provisioned_at,
        offline_valid_until = excluded.offline_valid_until,
        server_origin = excluded.server_origin;
      "#,
            params![
                credential.identity_key,
                credential.operator.id,
                credential.operator.username,
                credential.operator.kode_operator,
                credential.operator.role_key,
                credential.operator.permission_revision,
                credential.provisioned_at,
                credential.offline_valid_until,
                credential.server_origin,
            ],
        )
        .map_err(|_| CommandError::internal())?;

    transaction
        .execute(
            "DELETE FROM desktop_credential_alias WHERE identity_key = ?;",
            params![credential.identity_key],
        )
        .map_err(|_| CommandError::internal())?;

    for alias in [
        normalize_identifier(&credential.operator.username),
        normalize_identifier(&credential.operator.kode_operator),
    ] {
        transaction
            .execute(
                r#"
        INSERT INTO desktop_credential_alias (alias, server_origin, identity_key)
        VALUES (?, ?, ?)
        ON CONFLICT(alias, server_origin) DO UPDATE SET
          identity_key = excluded.identity_key;
        "#,
                params![alias, credential.server_origin, credential.identity_key],
            )
            .map_err(|_| CommandError::internal())?;
    }
    transaction.commit().map_err(|_| CommandError::internal())?;
    Ok(())
}

pub fn find_identity_key(
    path: &Path,
    server_origin: &str,
    identifier: &str,
) -> Result<Option<String>, CommandError> {
    database(path)?
        .query_row(
            r#"
      SELECT identity_key FROM desktop_credential_alias
      WHERE alias = ? AND server_origin = ? LIMIT 1;
      "#,
            params![normalize_identifier(identifier), server_origin],
            |row| row.get(0),
        )
        .optional()
        .map_err(|_| CommandError::internal())
}

pub fn audit(path: &Path, operator_id: Option<i64>, event_type: &str, detail: Option<&str>) {
    if let Ok(connection) = database(path) {
        let _ = connection.execute(
            r#"
      INSERT INTO desktop_security_audit (operator_id, event_type, event_at, detail)
      VALUES (?, ?, ?, ?);
      "#,
            params![operator_id, event_type, now_epoch_seconds(), detail],
        );
    }
}

pub fn get_system_setting(path: &Path, key: &str) -> Result<Option<String>, CommandError> {
    database(path)?
        .query_row(
            "SELECT value FROM setting_gex_system WHERE key = ? LIMIT 1;",
            params![key],
            |row| row.get(0),
        )
        .optional()
        .map_err(|_| CommandError::internal())
}

pub fn set_system_setting(path: &Path, key: &str, value: &str) -> Result<(), CommandError> {
    database(path)?
        .execute(
            "INSERT INTO setting_gex_system (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value;",
            params![key, value],
        )
        .map_err(|_| CommandError::internal())?;
    Ok(())
}

fn login_identifier_hash(identifier: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(normalize_identifier(identifier).as_bytes());
    hex::encode(hasher.finalize())
}

pub fn login_lock_remaining(path: &Path, identifier: &str) -> Result<Option<i64>, CommandError> {
    let connection = database(path)?;
    let identifier_hash = login_identifier_hash(identifier);
    let now = now_epoch_seconds();
    let locked_until: Option<i64> = connection
        .query_row(
            "SELECT locked_until FROM desktop_login_rate_limit WHERE identifier_hash = ?;",
            [&identifier_hash],
            |row| row.get(0),
        )
        .optional()
        .map_err(|_| CommandError::internal())?
        .flatten();
    if let Some(until) = locked_until.filter(|until| *until > now) {
        return Ok(Some(until.saturating_sub(now)));
    }
    if locked_until.is_some() {
        connection
            .execute(
                "DELETE FROM desktop_login_rate_limit WHERE identifier_hash = ?;",
                [&identifier_hash],
            )
            .map_err(|_| CommandError::internal())?;
    }
    Ok(None)
}

pub fn record_failed_login(path: &Path, identifier: &str) -> Result<Option<i64>, CommandError> {
    let connection = database(path)?;
    let identifier_hash = login_identifier_hash(identifier);
    let now = now_epoch_seconds();
    connection
        .execute(
            r#"INSERT INTO desktop_login_rate_limit (
                identifier_hash, failed_attempts, locked_until, last_attempt_at
            ) VALUES (?, 1, NULL, ?)
            ON CONFLICT(identifier_hash) DO UPDATE SET
                failed_attempts = desktop_login_rate_limit.failed_attempts + 1,
                locked_until = CASE
                    WHEN desktop_login_rate_limit.failed_attempts + 1 >= 5 THEN ? + 120
                    ELSE desktop_login_rate_limit.locked_until
                END,
                last_attempt_at = excluded.last_attempt_at;"#,
            params![identifier_hash, now, now],
        )
        .map_err(|_| CommandError::internal())?;
    login_lock_remaining(path, identifier)
}

pub fn clear_login_failures(path: &Path, identifier: &str) -> Result<(), CommandError> {
    database(path)?
        .execute(
            "DELETE FROM desktop_login_rate_limit WHERE identifier_hash = ?;",
            [login_identifier_hash(identifier)],
        )
        .map_err(|_| CommandError::internal())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use tempfile::tempdir;

    use super::payroll_seed;
    use super::{
        clear_login_failures, database, get_or_create_device_id, initialize, login_lock_remaining,
        record_failed_login, reset_cloud_linked_data, set_system_setting, CLOUD_MIRRORED_TABLES,
        DEVICE_OWNED_TABLES,
    };

    #[test]
    fn initializes_operational_schema_idempotently() {
        let directory = tempdir().expect("temporary directory");
        initialize(directory.path()).expect("first initialization");
        initialize(directory.path()).expect("second initialization");

        let connection = database(directory.path()).expect("database connection");
        for table in [
            "master_data",
            "tbl_shift",
            "log_scan",
            "absensi_harian",
            "desktop_sync_outbox",
            "desktop_sync_cursor",
            "desktop_sync_conflict",
            "desktop_login_rate_limit",
            "desktop_device_identity",
        ] {
            let total: i64 = connection
                .query_row(
                    "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?;",
                    [table],
                    |row| row.get(0),
                )
                .expect("schema query");
            assert_eq!(total, 1, "missing table {table}");
        }

        let migrations: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM desktop_schema_migration;",
                [],
                |row| row.get(0),
            )
            .expect("migration count");
        // Dua belas sejak v24 menambahkan `jadwal_mengajar` (jadwal mingguan).
        assert_eq!(migrations, 12);
    }

    /// Pindah database cloud harus membuang seluruh cache database lama, tetapi
    /// tidak boleh menyentuh identitas perangkat, kunci koneksi perangkat, atau
    /// seed tarif payroll bawaan aplikasi.
    #[test]
    fn switching_cloud_database_purges_old_local_data() {
        let directory = tempdir().expect("temporary directory");
        initialize(directory.path()).expect("initialize schema");
        let device_id = get_or_create_device_id(directory.path()).expect("device id");

        let connection = database(directory.path()).expect("database connection");
        connection
            .execute(
                "INSERT INTO master_data (id_unik, kode_karyawan, nama, divisi, id_shift) VALUES ('E1', 'K1', 'Karyawan Lama', 'Dapur', 1);",
                [],
            )
            .expect("seed employee");
        // Data sekolah dari database lama: kasus nyata yang dulu lolos — rombel
        // dan siswa tetap tampil setelah pindah dari Mode Lokal ke Turso.
        connection
            .execute_batch(
                "INSERT INTO akademik_rombel (id_rombel, id_tahun_ajaran, tingkat, nama_rombel) VALUES ('rom-lama', 'ta-lama', 10, 'X AP 1');
                 INSERT INTO siswa_data (id_siswa, nama_lengkap, id_rombel, angkatan, created_at, updated_at) VALUES ('S1', 'Siswa Lama', 'rom-lama', 2026, '2026-09-09', '2026-09-09');",
            )
            .expect("seed data sekolah");
        connection
            .execute(
                "INSERT INTO desktop_sync_outbox (event_id, client_id, domain, operation, entity_key, payload_json, status, created_at, updated_at) VALUES ('EV1', 'C1', 'employee', 'update', 'E1', '{}', 'pending', 0, 0);",
                [],
            )
            .expect("seed outbox");
        drop(connection);

        set_system_setting(directory.path(), "geofence_radius", "250").expect("seed setting");
        set_system_setting(
            directory.path(),
            "turso_database_url",
            "libsql://lama.turso.io",
        )
        .expect("seed device-local setting");

        let credentials = directory.path().join("credentials");
        std::fs::create_dir_all(&credentials).expect("credentials directory");
        std::fs::write(credentials.join("operator-lama.stronghold"), b"x").expect("write snapshot");
        std::fs::write(credentials.join("turso_config.vault"), b"y").expect("write vault");

        reset_cloud_linked_data(
            directory.path(),
            &["turso_database_url", "turso_auth_token"],
        )
        .expect("reset local workspace");

        let connection = database(directory.path()).expect("database connection");
        for table in [
            "master_data",
            "akademik_rombel",
            "siswa_data",
            "desktop_sync_outbox",
            "desktop_entity_revision",
        ] {
            let total: i64 = connection
                .query_row(&format!("SELECT COUNT(*) FROM {table};"), [], |row| {
                    row.get(0)
                })
                .expect("count rows");
            assert_eq!(total, 0, "{table} masih menyimpan data database lama");
        }

        let leftover_settings: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM setting_gex_system WHERE key = 'geofence_radius';",
                [],
                |row| row.get(0),
            )
            .expect("count settings");
        assert_eq!(leftover_settings, 0, "setting database lama harus terbuang");

        let kept_url: String = connection
            .query_row(
                "SELECT value FROM setting_gex_system WHERE key = 'turso_database_url';",
                [],
                |row| row.get(0),
            )
            .expect("device-local setting harus dipertahankan");
        assert_eq!(kept_url, "libsql://lama.turso.io");

        // Tarif default payroll ditanam ulang, bukan ikut terbuang.
        let tax_rules: i64 = connection
            .query_row("SELECT COUNT(*) FROM tax_rules;", [], |row| row.get(0))
            .expect("count tax rules");
        assert!(tax_rules > 0, "seed tarif pajak harus ditanam ulang");
        drop(connection);

        // Identitas perangkat dipakai membuka vault koneksi yang baru ditulis.
        assert_eq!(
            get_or_create_device_id(directory.path()).expect("device id"),
            device_id
        );
        assert!(!credentials.join("operator-lama.stronghold").is_file());
        assert!(credentials.join("turso_config.vault").is_file());
    }

    /// Setiap tabel lokal wajib diputuskan nasibnya saat pindah database:
    /// dibuang bersama database lama, atau milik perangkat. Tabel baru yang
    /// belum masuk salah satu daftar menggagalkan test ini — persis celah yang
    /// dulu membuat seluruh tabel sekolah tertinggal di perangkat.
    #[test]
    fn every_local_table_is_classified_for_database_switch() {
        let directory = tempdir().expect("temporary directory");
        initialize(directory.path()).expect("initialize schema");
        let connection = database(directory.path()).expect("database connection");
        let mut statement = connection
            .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name;")
            .expect("prepare");
        let tables = statement
            .query_map([], |row| row.get::<_, String>(0))
            .expect("query")
            .collect::<Result<Vec<_>, _>>()
            .expect("rows");

        let unclassified = tables
            .iter()
            .filter(|table| {
                !CLOUD_MIRRORED_TABLES.contains(&table.as_str())
                    && !DEVICE_OWNED_TABLES.contains(&table.as_str())
            })
            .collect::<Vec<_>>();
        assert!(
            unclassified.is_empty(),
            "tabel belum diklasifikasikan untuk pindah database: {unclassified:?}"
        );

        for table in CLOUD_MIRRORED_TABLES.iter().chain(DEVICE_OWNED_TABLES) {
            assert!(
                tables.iter().any(|name| name == table),
                "daftar pindah database menyebut tabel yang tidak ada: {table}"
            );
        }
    }

    #[test]
    fn login_is_temporarily_locked_after_five_failures() {
        let directory = tempdir().expect("temporary directory");
        initialize(directory.path()).expect("initialize schema");
        for _ in 0..4 {
            assert_eq!(
                record_failed_login(directory.path(), " Operator.Test ").expect("record failure"),
                None
            );
        }
        assert!(record_failed_login(directory.path(), "operator.test")
            .expect("record fifth failure")
            .is_some());
        assert!(login_lock_remaining(directory.path(), "OPERATOR.TEST")
            .expect("read lock")
            .is_some());
        clear_login_failures(directory.path(), "operator.test").expect("clear failures");
        assert_eq!(
            login_lock_remaining(directory.path(), "operator.test").expect("read cleared lock"),
            None
        );
    }

    #[test]
    fn device_identity_is_local_and_stable() {
        let directory = tempdir().expect("temporary directory");
        initialize(directory.path()).expect("initialize schema");
        let first = get_or_create_device_id(directory.path()).expect("first device id");
        let second = get_or_create_device_id(directory.path()).expect("second device id");
        assert_eq!(first, second);
        assert!(first.starts_with("device-"));
        assert_eq!(first.len(), 71);
    }

    #[test]
    fn tarif_default_lokal_memakai_id_yang_sama_dengan_cloud() {
        let directory = tempdir().expect("temporary directory");
        initialize(directory.path()).expect("local schema");
        let connection = database(directory.path()).expect("local database");

        // Id seed lokal harus identik dengan seed cloud. Dulu lokal memakai
        // `tax-p17-1` sementara cloud `tax_p17_1`, sehingga baris lokal ikut
        // terdorong ke cloud dan bracket PASAL_17 menjadi dobel.
        for table in ["tax_rules", "bpjs_rules", "overtime_tier_rules"] {
            let mut statement = connection
                .prepare(&format!("SELECT id FROM {table};"))
                .expect("rate query");
            let ids = statement
                .query_map([], |row| row.get::<_, String>(0))
                .expect("rate rows")
                .collect::<Result<Vec<_>, _>>()
                .expect("rate ids");
            assert!(!ids.is_empty(), "{table} harus punya tarif default");
            for id in &ids {
                assert!(
                    payroll_seed::DEFAULT_RATE_IDS.contains(&id.as_str()),
                    "{table} memuat id tak terdaftar di payroll_seed: {id}"
                );
                assert!(
                    !payroll_seed::LEGACY_RATE_IDS.contains(&id.as_str()),
                    "{table} masih memuat id seed lama: {id}"
                );
            }
        }

        // PPh 21 butuh Pasal 17 dan TER; lokal dulu hanya punya Pasal 17.
        for category in ["PASAL_17", "TER_A", "TER_B", "TER_C"] {
            let total: i64 = connection
                .query_row(
                    "SELECT COUNT(*) FROM tax_rules WHERE category = ?;",
                    [category],
                    |row| row.get(0),
                )
                .expect("tax category count");
            assert!(
                total > 0,
                "kategori tarif {category} tidak ter-seed di lokal"
            );
        }
    }

    #[test]
    fn seed_tarif_lama_dibersihkan_saat_inisialisasi_ulang() {
        let directory = tempdir().expect("temporary directory");
        initialize(directory.path()).expect("local schema");
        let connection = database(directory.path()).expect("local database");
        connection
            .execute(
                "INSERT INTO tax_rules (id, category, bracket_min, bracket_max, rate_percentage, effective_date)
                 VALUES ('tax-p17-1', 'PASAL_17', 0, 60000000, 5.0, '2024-01-01');",
                [],
            )
            .expect("legacy row");
        drop(connection);

        initialize(directory.path()).expect("re-initialize");
        let connection = database(directory.path()).expect("local database");
        let leftover: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM tax_rules WHERE id = 'tax-p17-1';",
                [],
                |row| row.get(0),
            )
            .expect("legacy count");
        assert_eq!(leftover, 0, "baris seed lama harus dibersihkan");
    }

    /// Database yang sudah terlanjur punya `absensi_harian` TANPA CHECK harus
    /// disembuhkan, bukan sekadar dibiarkan.
    ///
    /// `CREATE TABLE IF NOT EXISTS` tidak pernah memperbaiki tabel yang sudah
    /// lahir, jadi tanpa migrasi ini hanya pemasangan baru yang terlindungi —
    /// padahal justru pemasangan lama yang sudah menampung bertahun-tahun data.
    #[test]
    fn migrasi_memasang_check_sumber_pada_tabel_lama() {
        let directory = tempdir().expect("temporary directory");

        // Bangun tabel versi lama: persis tanpa CHECK pada `sumber`.
        {
            let connection = database(directory.path()).expect("database lokal");
            connection
                .execute_batch(
                    r#"
                CREATE TABLE absensi_harian (
                  id_absensi INTEGER PRIMARY KEY AUTOINCREMENT,
                  tanggal TEXT NOT NULL,
                  id_karyawan TEXT NOT NULL,
                  nama TEXT NOT NULL,
                  kelas_divisi TEXT NOT NULL,
                  jam_masuk TEXT,
                  jam_pulang TEXT,
                  status_kehadiran TEXT NOT NULL,
                  status_absen TEXT NOT NULL,
                  keterangan TEXT,
                  sumber TEXT NOT NULL,
                  update_terakhir TEXT NOT NULL,
                  menit_terlambat INTEGER DEFAULT 0,
                  menit_datang_awal INTEGER DEFAULT 0,
                  jam_kerja INTEGER DEFAULT 0,
                  lembur INTEGER DEFAULT 0,
                  jam_kerja_kurang INTEGER DEFAULT 0,
                  id_shift INTEGER NOT NULL,
                  bulan TEXT NOT NULL,
                  tahun INTEGER NOT NULL,
                  id_sesi TEXT UNIQUE NOT NULL,
                  mode_tugas TEXT DEFAULT 'NORMAL',
                  id_backup TEXT,
                  id_karyawan_asal TEXT,
                  tanggal_tugas TEXT
                );
                INSERT INTO absensi_harian (
                  tanggal, id_karyawan, nama, kelas_divisi, status_kehadiran,
                  status_absen, sumber, update_terakhir, id_shift, bulan, tahun, id_sesi
                ) VALUES
                  ('2026-09-07', 'K001', 'Sah', 'Dapur', 'Hadir', 'Masuk',
                   'Scanner', '2026-09-07 07:00:00', 1, '09', 2026, 'sesi_sah'),
                  ('2026-09-07', 'K002', 'Cacat', 'Dapur', 'Hadir', 'Masuk',
                   'Scanner Terminal', '2026-09-07 07:00:00', 1, '09', 2026, 'sesi_cacat');
                "#,
                )
                .expect("skema versi lama");
        }

        initialize(directory.path()).expect("migrasi berjalan");

        let connection = database(directory.path()).expect("database lokal");

        // 1. Constraint-nya benar-benar terpasang sekarang.
        let sql: String = connection
            .query_row(
                "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'absensi_harian';",
                [],
                |row| row.get(0),
            )
            .expect("baca skema");
        assert!(
            sql.contains("CHECK (sumber IN ("),
            "CHECK sumber wajib terpasang setelah migrasi",
        );

        // 2. Baris yang sah dipertahankan apa adanya; yang cacat dinormalkan.
        //    Baris cacat itu SUDAH tidak bisa didorong ke cloud, jadi
        //    menormalkannya membebaskannya, bukan merusaknya.
        let mut statement = connection
            .prepare("SELECT id_sesi, sumber FROM absensi_harian ORDER BY id_sesi;")
            .expect("prepare");
        let baris: Vec<(String, String)> = statement
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
            .expect("query")
            .filter_map(Result::ok)
            .collect();
        assert_eq!(
            baris,
            vec![
                ("sesi_cacat".to_string(), "Generate Sistem".to_string()),
                ("sesi_sah".to_string(), "Scanner".to_string()),
            ],
        );

        // 3. Indeksnya ikut dibangun ulang — tanpa itu setiap query kehadiran
        //    berubah menjadi pemindaian tabel penuh.
        let indeks: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'index'
                   AND tbl_name = 'absensi_harian'
                   AND name IN ('idx_local_attendance_employee_date', 'idx_local_absensi_tanggal');",
                [],
                |row| row.get(0),
            )
            .expect("hitung indeks");
        assert_eq!(indeks, 2, "kedua indeks wajib ada kembali");

        // 4. Nilai asing kini ditolak di titik tulis, bukan saat push.
        let ditolak = connection.execute(
            "INSERT INTO absensi_harian (
               tanggal, id_karyawan, nama, kelas_divisi, status_kehadiran,
               status_absen, sumber, update_terakhir, id_shift, bulan, tahun, id_sesi
             ) VALUES ('2026-09-08', 'K003', 'Baru', 'Dapur', 'Hadir', 'Masuk',
                       'Scanner Terminal', '2026-09-08 07:00:00', 1, '09', 2026, 'sesi_baru');",
            [],
        );
        assert!(
            ditolak.is_err(),
            "sumber di luar daftar wajib ditolak database lokal",
        );

        // 5. Idempoten: menjalankan ulang tidak membangun ulang apa pun.
        initialize(directory.path()).expect("migrasi kedua");
    }
}
