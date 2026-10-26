import type { Client } from "@libsql/client";
import { BRANDING } from "@/lib/constants/branding";
import {
  DEFAULT_ROLE_PERMISSIONS,
  PERMISSION_CATALOG,
} from "@/lib/rbac/catalog";
import { AKUN_BAWAAN, SEED_AKUN_SQL } from "@/lib/validations/accounting";
import {
  SQL_BUANG_BERKAS_PMB_TERPINDAH,
  SQL_PINDAH_BERKAS_PMB,
} from "@/lib/validations/berkas-sekolah";
import {
  JENIS_NILAI_BAWAAN,
  SEED_JENIS_SQL,
} from "@/lib/validations/nilai-akhir";
import { SQL_SALIN_DAPODIK_PMB } from "@/lib/validations/siswa-dapodik";
import TARIF_PAYROLL_BAWAAN from "@/lib/validations/tarif-payroll-bawaan.json";

const RBAC_MIGRATION_VERSION = 1;
const WEB_SESSION_MIGRATION_VERSION = 2;
const LOGIN_RATE_LIMIT_MIGRATION_VERSION = 3;
const OPERATIONAL_SYNC_MIGRATION_VERSION = 4;
const OFFLINE_IMPORT_MIGRATION_VERSION = 5;
const OPERATIONAL_COLUMNS_MIGRATION_VERSION = 6;
const HOLIDAY_MIGRATION_VERSION = 7;
const COMPANY_PROFILE_AND_TEMPLATE_MIGRATION_VERSION = 8;
const TWO_TIER_SECURITY_MIGRATION_VERSION = 9;
const PAYROLL_MIGRATION_VERSION = 10;
const OPERATOR_CONTACT_AND_RESET_MIGRATION_VERSION = 11;
const TWO_FACTOR_MIGRATION_VERSION = 12;
const SCAN_SECURITY_MIGRATION_VERSION = 13;
const HOLIDAY_WHITELIST_MIGRATION_VERSION = 14;
const PASSWORD_RECOVERY_MIGRATION_VERSION = 15;
const ACADEMIC_FOUNDATION_MIGRATION_VERSION = 16;
const ACADEMIC_UNIQUE_RELAXATION_MIGRATION_VERSION = 17;
const CLASS_ATTENDANCE_MIGRATION_VERSION = 18;
const TEACHING_JOURNAL_AND_LEDGER_MIGRATION_VERSION = 19;
const PHASE_4_MIGRATION_VERSION = 20;
const SHIFT_TIME_RULES_MIGRATION_VERSION = 21;
const TEACHING_JP_RATE_MIGRATION_VERSION = 22;
const LESSON_PERIOD_MIGRATION_VERSION = 23;
const TEACHING_SCHEDULE_MIGRATION_VERSION = 24;
const PER_JP_ALLOWANCE_MIGRATION_VERSION = 25;
const PMB_MIGRATION_VERSION = 26;
const WALI_PORTAL_MIGRATION_VERSION = 27;
const GRADES_MIGRATION_VERSION = 28;
const ACADEMIC_UNIT_MIGRATION_VERSION = 29;
const WALI_KREDENSIAL_MIGRATION_VERSION = 30;
const CMS_LANDING_PAGE_MIGRATION_VERSION = 31;
const PERSONNEL_PHOTO_MIGRATION_VERSION = 32;
const EMPLOYEE_IDENTITY_HISTORY_MIGRATION_VERSION = 33;
const WA_SEND_CLAIM_MIGRATION_VERSION = 34;
const INVENTORY_MIGRATION_VERSION = 35;
const UKS_MIGRATION_VERSION = 36;
const INVENTORY_UNIT_MIGRATION_VERSION = 37;
const FACE_VERIFICATION_MIGRATION_VERSION = 38;
const ACCOUNTING_MIGRATION_VERSION = 39;
const EMPLOYEE_LOAN_MIGRATION_VERSION = 40;
const STUDENT_BILLING_MIGRATION_VERSION = 41;
const STUDENT_PAYMENT_MIGRATION_VERSION = 42;
const GRADE_TYPE_MIGRATION_VERSION = 43;
const WA_BILLING_REMINDER_MIGRATION_VERSION = 44;
const BOOK_CLOSING_MIGRATION_VERSION = 45;
const BOOK_CLOSING_DECISION_MIGRATION_VERSION = 46;
const WA_BOOK_CLOSING_MIGRATION_VERSION = 47;
const CONTENT_IMAGE_MIGRATION_VERSION = 48;
const PMB_DAPODIK_MIGRATION_VERSION = 49;
const SHIFT_WORK_DAYS_MIGRATION_VERSION = 50;
const PAYROLL_RAPEL_MIGRATION_VERSION = 51;
const PMB_PAYMENT_MIGRATION_VERSION = 52;
const INVENTORY_COLUMN_MIGRATION_VERSION = 53;
const INVENTORY_COLUMN_DELETE_MIGRATION_VERSION = 54;
const INVENTORY_DECIMAL_MIGRATION_VERSION = 55;
const PERSONNEL_EMAIL_MIGRATION_VERSION = 56;
const STUDENT_DAPODIK_MIGRATION_VERSION = 57;
const PMB_UNIT_MIGRATION_VERSION = 58;
const STUDENT_FILES_MIGRATION_VERSION = 59;
const UNIT_JP_BELL_MIGRATION_VERSION = 60;
const INVENTORY_ITEM_DELETE_MIGRATION_VERSION = 61;
const JOURNAL_SOURCE_INVENTORY_MIGRATION_VERSION = 62;
const INVENTORY_SERVICE_MIGRATION_VERSION = 63;

/**
 * Bentuk `akademik_jam_pelajaran` sejak v60: jenis `Pulang`, cakupan unit +
 * hari, dan bunyi/suara bel. Dipakai `CREATE` dan rebuild supaya keduanya
 * tidak bisa berbeda. Cerminan DDL di `storage.rs` dan `turso.rs`.
 */
const LESSON_PERIOD_TABLE_SQL = `CREATE TABLE IF NOT EXISTS akademik_jam_pelajaran (
      id_jam_pelajaran TEXT PRIMARY KEY,
      jam_ke INTEGER NOT NULL CHECK (jam_ke >= 1),
      jam_mulai TEXT NOT NULL,
      jam_selesai TEXT NOT NULL,
      jenis TEXT NOT NULL DEFAULT 'KBM'
        CHECK (jenis IN ('KBM', 'Istirahat', 'Upacara', 'Ekstrakurikuler', 'Pulang')),
      keterangan TEXT,
      is_aktif INTEGER NOT NULL DEFAULT 1 CHECK (is_aktif IN (0, 1)),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      id_unit TEXT,
      hari INTEGER CHECK (hari IS NULL OR hari BETWEEN 1 AND 7),
      bunyi INTEGER NOT NULL DEFAULT 1 CHECK (bunyi IN (0, 1)),
      suara TEXT
    )`;

/**
 * v21 — aturan jam scan baru: Jam Kerja Normal = (Jam Pulang − Jam Masuk) −
 * Istirahat, tanpa "+ Batas Masuk" lama. Nilai tersimpan dihitung ulang SEKALI.
 *
 * Shift fleksibel (jam kerja normal 0, jam masuk = jam pulang, atau
 * 00:00–23:59) sengaja dilewati: nilainya adalah penanda fleksibel, dan
 * menghitung ulangnya akan diam-diam mengubah shift itu menjadi reguler.
 * Hasil ≤ 0 juga dilewati karena alasan yang sama. Teks SQL ini WAJIB identik
 * dengan `RECALCULATE_NORMAL_WORK_SQL` di `turso.rs`.
 */
export const RECALCULATE_NORMAL_WORK_SQL = `UPDATE tbl_shift
SET jam_kerja_normal_menit =
  (CAST(substr(jam_pulang, 1, 2) AS INTEGER) * 60 + CAST(substr(jam_pulang, 4, 2) AS INTEGER))
  - (CAST(substr(jam_masuk, 1, 2) AS INTEGER) * 60 + CAST(substr(jam_masuk, 4, 2) AS INTEGER))
  + (CASE WHEN substr(jam_pulang, 1, 5) < substr(jam_masuk, 1, 5) THEN 1440 ELSE 0 END)
  - COALESCE(istirahat_menit, 0)
WHERE COALESCE(jam_kerja_normal_menit, 0) > 0
  AND jam_masuk GLOB '[0-2][0-9]:[0-5][0-9]*'
  AND jam_pulang GLOB '[0-2][0-9]:[0-5][0-9]*'
  AND substr(jam_masuk, 1, 5) <> substr(jam_pulang, 1, 5)
  AND NOT (substr(jam_masuk, 1, 5) = '00:00' AND substr(jam_pulang, 1, 5) = '23:59')
  AND (CAST(substr(jam_pulang, 1, 2) AS INTEGER) * 60 + CAST(substr(jam_pulang, 4, 2) AS INTEGER))
    - (CAST(substr(jam_masuk, 1, 2) AS INTEGER) * 60 + CAST(substr(jam_masuk, 4, 2) AS INTEGER))
    + (CASE WHEN substr(jam_pulang, 1, 5) < substr(jam_masuk, 1, 5) THEN 1440 ELSE 0 END)
    - COALESCE(istirahat_menit, 0) > 0;`;

/**
 * Bangun ulang sebuah tabel untuk melepas UNIQUE yang terlanjur ikut terbuat.
 *
 * Cerminan `rebuild_without_unique` di `turso.rs` dan `storage.rs`; ketiganya
 * WAJIB menghasilkan bentuk tabel yang sama, karena satu database yang sama
 * bisa dibangun oleh jalur mana pun.
 */
async function rebuildWithoutUnique(
  client: Client,
  spec: {
    table: string;
    createSql: string;
    columns: string;
    indexes: string[];
  },
) {
  const current = await client.execute({
    sql: "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?;",
    args: [spec.table],
  });
  const ddl = String(current.rows[0]?.sql ?? "");
  if (!ddl || !ddl.toUpperCase().includes("UNIQUE")) return;

  const staging = `${spec.table}__rebuild`;
  // Menghapus tabel ikut menghapus index dan trigger `sync_pulse` miliknya;
  // index dipasang ulang di sini, trigger oleh `ensure_sync_pulse` di `turso.rs`.
  await client.batch(
    [
      `DROP TABLE IF EXISTS ${staging};`,
      spec.createSql.replaceAll(spec.table, staging),
      `INSERT INTO ${staging} (${spec.columns}) SELECT ${spec.columns} FROM ${spec.table};`,
      `DROP TABLE ${spec.table};`,
      `ALTER TABLE ${staging} RENAME TO ${spec.table};`,
      ...spec.indexes,
    ],
    "write",
  );
}

const SYSTEM_ROLES = [
  {
    key: "superadmin",
    name: "Superadmin",
    description: "Pemilik akses penuh dan pengelola role aplikasi.",
    isSuperadmin: 1,
  },
  {
    key: "admin",
    name: "Admin",
    description: "Administrator operasional sesuai matriks permission.",
    isSuperadmin: 0,
  },
  {
    key: "operator",
    name: "Operator",
    description: "Operator harian sesuai matriks permission.",
    isSuperadmin: 0,
  },
  {
    key: "scanner",
    name: "Scanner",
    description: "Petugas terminal QR sesuai matriks permission.",
    isSuperadmin: 0,
  },
] as const;

async function hasTable(client: Client, table: string) {
  const result = await client.execute({
    sql: "SELECT COUNT(*) as cnt FROM sqlite_master WHERE type = 'table' AND name = ?;",
    args: [table],
  });
  return Number(result.rows[0]?.cnt ?? 0) > 0;
}

async function hasColumn(client: Client, table: string, column: string) {
  if (!(await hasTable(client, table))) return true; // table will be created with all columns
  const result = await client.execute(`PRAGMA table_info(${table});`);
  return result.rows.some((row) => String(row.name) === column);
}

export async function runDatabaseMigrations(client: Client) {
  await client.execute(`
    CREATE TABLE IF NOT EXISTS schema_migration (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS app_role (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      role_key TEXT UNIQUE NOT NULL,
      nama_role TEXT UNIQUE NOT NULL,
      deskripsi TEXT,
      is_system INTEGER NOT NULL DEFAULT 0 CHECK(is_system IN (0, 1)),
      is_superadmin INTEGER NOT NULL DEFAULT 0 CHECK(is_superadmin IN (0, 1)),
      status TEXT NOT NULL DEFAULT 'Aktif' CHECK(status IN ('Aktif', 'Nonaktif')),
      require_totp INTEGER NOT NULL DEFAULT 0,
      require_scan_photo INTEGER NOT NULL DEFAULT 0,
      require_scan_ip_allowlist INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      created_by TEXT
    );
  `);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS app_permission (
      permission_key TEXT PRIMARY KEY,
      nama TEXT NOT NULL,
      grup TEXT NOT NULL,
      deskripsi TEXT,
      is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0, 1)),
      sort_order INTEGER NOT NULL DEFAULT 0
    );
  `);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS role_permission (
      role_id INTEGER NOT NULL,
      permission_key TEXT NOT NULL,
      is_allowed INTEGER NOT NULL DEFAULT 0 CHECK(is_allowed IN (0, 1)),
      updated_at TEXT NOT NULL,
      updated_by TEXT,
      PRIMARY KEY (role_id, permission_key),
      FOREIGN KEY (role_id) REFERENCES app_role(id) ON DELETE CASCADE,
      FOREIGN KEY (permission_key) REFERENCES app_permission(permission_key) ON DELETE CASCADE
    );
  `);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS role_permission_audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      role_id INTEGER NOT NULL,
      permission_key TEXT NOT NULL,
      before_allowed INTEGER NOT NULL,
      after_allowed INTEGER NOT NULL,
      changed_at TEXT NOT NULL,
      changed_by TEXT NOT NULL,
      revision INTEGER NOT NULL
    );
  `);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS app_session (
      session_id TEXT PRIMARY KEY,
      token_hash TEXT UNIQUE NOT NULL,
      operator_id INTEGER NOT NULL,
      permission_revision INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      revoked_at TEXT,
      revoked_reason TEXT,
      user_agent_hash TEXT,
      FOREIGN KEY (operator_id) REFERENCES master_operator(id) ON DELETE CASCADE
    );
  `);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS auth_login_rate_limit (
      rate_key TEXT PRIMARY KEY,
      attempt_count INTEGER NOT NULL,
      window_started_at TEXT NOT NULL,
      blocked_until TEXT,
      updated_at TEXT NOT NULL
    );
  `);

  // Permintaan "Lupa Password". Cloud-only (tidak ikut SNAPSHOT_TABLES):
  // berisi bukti foto liveness dan hash token reset yang tidak boleh
  // direplikasi ke SQLite lokal setiap perangkat.
  await client.execute(`
    CREATE TABLE IF NOT EXISTS password_reset_request (
      id TEXT PRIMARY KEY,
      operator_id INTEGER NOT NULL,
      identifier_used TEXT NOT NULL,
      contact_channel TEXT NOT NULL DEFAULT 'email',
      contact_target TEXT NOT NULL,
      challenge_hash TEXT NOT NULL,
      challenge_sequence TEXT NOT NULL,
      token_hash TEXT,
      status TEXT NOT NULL DEFAULT 'Menunggu Verifikasi'
        CHECK(status IN (
          'Menunggu Verifikasi', 'Terkirim', 'Terpakai', 'Kedaluwarsa', 'Dibatalkan'
        )),
      liveness_score REAL,
      liveness_report TEXT,
      photo_mime TEXT,
      photo_base64 TEXT,
      delivery_status TEXT,
      delivery_error TEXT,
      requested_at TEXT NOT NULL,
      verified_at TEXT,
      sent_at TEXT,
      used_at TEXT,
      -- Siapa yang menyetujui permintaan ini, dan kapan. Jejaknya menempel pada
      -- permintaan yang disetujui, bukan di tabel lain: sebelumnya kedua penulis
      -- meng-INSERT ke role_permission_audit dengan empat kolom yang tidak pernah
      -- ada di sana, errornya dibuang diam-diam, dan catatan persetujuan sebuah
      -- aksi SENSITIVE_MUTATION tidak pernah tertulis sekalipun.
      approved_by INTEGER,
      approved_at TEXT,
      expires_at TEXT NOT NULL,
      request_ip_hash TEXT,
      user_agent_hash TEXT,
      FOREIGN KEY (operator_id) REFERENCES master_operator(id) ON DELETE CASCADE
    );
  `);

  // Konfigurasi pengirim email (HTTP API). Cloud-only dan tidak pernah
  // di-snapshot: kunci API tidak boleh mendarat di SQLite tiap perangkat.
  await client.execute(`
    CREATE TABLE IF NOT EXISTS app_mail_config (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL DEFAULT 'resend'
        CHECK(provider IN ('resend', 'brevo')),
      api_key TEXT,
      sender_email TEXT,
      sender_name TEXT,
      reset_base_url TEXT,
      is_active INTEGER NOT NULL DEFAULT 0 CHECK(is_active IN (0, 1)),
      updated_at TEXT NOT NULL,
      updated_by TEXT
    );
  `);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS sync_operation_receipt (
      event_id TEXT PRIMARY KEY,
      client_id TEXT NOT NULL,
      domain TEXT NOT NULL,
      operation TEXT NOT NULL,
      entity_key TEXT NOT NULL,
      payload_hash TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('applied', 'rejected', 'conflict')),
      result_json TEXT NOT NULL,
      base_revision INTEGER,
      server_revision INTEGER,
      actor_operator_id INTEGER NOT NULL,
      receipt_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      processed_at TEXT NOT NULL
    );
  `);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS sync_changelog (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id TEXT NOT NULL,
      event_id TEXT UNIQUE NOT NULL,
      domain TEXT NOT NULL,
      operation TEXT NOT NULL,
      entity_key TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
  `);
  await client.execute(`
    CREATE TABLE IF NOT EXISTS app_bootstrap_state (
      bootstrap_key TEXT PRIMARY KEY,
      claimed_at TEXT NOT NULL
    );
  `);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS sync_change_log (
      revision INTEGER PRIMARY KEY AUTOINCREMENT,
      domain TEXT NOT NULL,
      entity_key TEXT NOT NULL,
      operation TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      changed_at TEXT NOT NULL,
      actor_operator_id INTEGER NOT NULL
    );
  `);
  await client.execute(`
    CREATE TABLE IF NOT EXISTS import_offline (
      id_import INTEGER PRIMARY KEY AUTOINCREMENT,
      event_key TEXT UNIQUE NOT NULL,
      timestamp_input TEXT NOT NULL,
      tanggal DATE NOT NULL,
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
  `);

  // Kontak operator: wajib diisi lewat validasi aplikasi, tetapi NULL-able di
  // DDL supaya baris operator lama tidak rusak saat migrasi berjalan. Kolom ini
  // dipakai fitur "Lupa Password" untuk mengirim link reset.
  if (!(await hasColumn(client, "master_operator", "role_id"))) {
    await client.execute(
      "ALTER TABLE master_operator ADD COLUMN role_id INTEGER;",
    );
  }

  // Kolom di bawah dibuat oleh jalur provisioning Rust (`turso.rs`) tetapi dulu
  // tidak ada di jalur Web. Database yang di-provisioning dari Web membuat
  // Desktop/Mobile gagal: `authenticate_operator` menulis `updated_at` saat
  // meng-upgrade hash lama, dan seed tarif payroll menulis `created_at`.
  // Keduanya sekarang saling menyusul lewat migrasi idempoten ini.
  for (const [table, column, alterSql] of [
    [
      "master_operator",
      "created_at",
      "ALTER TABLE master_operator ADD COLUMN created_at TEXT;",
    ],
    [
      "master_operator",
      "email",
      "ALTER TABLE master_operator ADD COLUMN email TEXT;",
    ],
    [
      "master_operator",
      "no_hp",
      "ALTER TABLE master_operator ADD COLUMN no_hp TEXT;",
    ],
    // Jejak persetujuan "Lupa Password". Cerminan `ensure_column` di `turso.rs`,
    // sehingga database yang lahir dari jalur mana pun disembuhkan oleh klien
    // mana pun yang menyentuhnya.
    [
      "password_reset_request",
      "approved_by",
      "ALTER TABLE password_reset_request ADD COLUMN approved_by INTEGER;",
    ],
    [
      "password_reset_request",
      "approved_at",
      "ALTER TABLE password_reset_request ADD COLUMN approved_at TEXT;",
    ],
    // Verifikasi dua langkah. `totp_enabled` sengaja tanpa CHECK: SQLite
    // membatasi bentuk constraint pada ALTER TABLE ADD COLUMN, dan menaruh CHECK
    // hanya di CREATE TABLE akan membuat database hasil migrasi berbeda dari
    // database baru — persis drift yang dilarang di sini.
    [
      "master_operator",
      "totp_secret",
      "ALTER TABLE master_operator ADD COLUMN totp_secret TEXT;",
    ],
    [
      "master_operator",
      "totp_enabled",
      "ALTER TABLE master_operator ADD COLUMN totp_enabled INTEGER NOT NULL DEFAULT 0;",
    ],
    [
      "master_operator",
      "totp_confirmed_at",
      "ALTER TABLE master_operator ADD COLUMN totp_confirmed_at TEXT;",
    ],
    [
      "master_operator",
      "totp_recovery_codes",
      "ALTER TABLE master_operator ADD COLUMN totp_recovery_codes TEXT;",
    ],
    [
      "app_role",
      "require_totp",
      "ALTER TABLE app_role ADD COLUMN require_totp INTEGER NOT NULL DEFAULT 0;",
    ],
    // Keamanan absensi per role (schema versi 13). Sengaja tanpa CHECK, sama
    // seperti `require_totp`: SQLite membatasi bentuk constraint pada
    // ALTER TABLE ADD COLUMN, dan menaruh CHECK hanya di CREATE TABLE membuat
    // database hasil migrasi berbeda dari database baru.
    [
      "app_role",
      "require_scan_photo",
      "ALTER TABLE app_role ADD COLUMN require_scan_photo INTEGER NOT NULL DEFAULT 0;",
    ],
    [
      "app_role",
      "require_scan_ip_allowlist",
      "ALTER TABLE app_role ADD COLUMN require_scan_ip_allowlist INTEGER NOT NULL DEFAULT 0;",
    ],
    [
      "master_operator",
      "updated_at",
      "ALTER TABLE master_operator ADD COLUMN updated_at TEXT;",
    ],
    // Kode pemulihan password Superadmin (schema versi 15). Dieja di sini DAN
    // di daftar ensure_column milik `turso.rs`, supaya klien mana pun bisa
    // menyembuhkan database yang dibuat jalur lainnya.
    [
      "master_operator",
      "password_recovery_codes",
      "ALTER TABLE master_operator ADD COLUMN password_recovery_codes TEXT;",
    ],
    [
      "master_operator",
      "password_recovery_created_at",
      "ALTER TABLE master_operator ADD COLUMN password_recovery_created_at TEXT;",
    ],
    [
      "tax_rules",
      "created_at",
      "ALTER TABLE tax_rules ADD COLUMN created_at TEXT;",
    ],
    [
      "bpjs_rules",
      "created_at",
      "ALTER TABLE bpjs_rules ADD COLUMN created_at TEXT;",
    ],
    [
      "payroll_components",
      "created_at",
      "ALTER TABLE payroll_components ADD COLUMN created_at TEXT;",
    ],
    // Unit satuan pendidikan (schema versi 29). Cerminan `ensure_column` di
    // `turso.rs`, sehingga database yang lahir dari jalur mana pun disembuhkan
    // oleh klien mana pun yang menyentuhnya. Nullable: baris personil lama
    // memang belum punya unit, dan NOT NULL akan menolak ALTER pada database
    // yang sudah berisi.
    ["master_data", "unit", "ALTER TABLE master_data ADD COLUMN unit TEXT;"],
    // Sakelar notifikasi WA untuk Koreksi Admin dan Import Manual. Bawaannya 0,
    // sama dengan yang dibaca mesin untuk kunci `wa_notify_*` yang belum ada:
    // pemasangan lama tidak mulai mengirim pesan ke wali hanya karena
    // aplikasinya diperbarui. Cerminan `ensure_column` di `turso.rs`.
    [
      "app_wa_config",
      "koreksi_admin_enabled",
      "ALTER TABLE app_wa_config ADD COLUMN koreksi_admin_enabled INTEGER NOT NULL DEFAULT 0;",
    ],
    [
      "app_wa_config",
      "import_manual_enabled",
      "ALTER TABLE app_wa_config ADD COLUMN import_manual_enabled INTEGER NOT NULL DEFAULT 0;",
    ],
    [
      "app_wa_config",
      "uks_enabled",
      "ALTER TABLE app_wa_config ADD COLUMN uks_enabled INTEGER NOT NULL DEFAULT 0;",
    ],
    [
      "app_wa_config",
      "tagihan_enabled",
      "ALTER TABLE app_wa_config ADD COLUMN tagihan_enabled INTEGER NOT NULL DEFAULT 0;",
    ],
    [
      "app_wa_config",
      "tutup_buku_enabled",
      "ALTER TABLE app_wa_config ADD COLUMN tutup_buku_enabled INTEGER NOT NULL DEFAULT 0;",
    ],
    // Vonis verifikasi wajah pada foto bukti (v38). Cerminan `ensure_column`
    // di `turso.rs` dan `storage.rs`.
    [
      "absensi_foto",
      "wajah_vonis",
      "ALTER TABLE absensi_foto ADD COLUMN wajah_vonis TEXT;",
    ],
    [
      "absensi_foto",
      "wajah_skor",
      "ALTER TABLE absensi_foto ADD COLUMN wajah_skor REAL;",
    ],
    // Jenis penilaian dinamis (v43). Cerminan `ensure_column` di `turso.rs`
    // dan `storage.rs`; CHECK lama `jenis` dibiarkan.
    [
      "nilai_penilaian",
      "id_jenis",
      "ALTER TABLE nilai_penilaian ADD COLUMN id_jenis TEXT;",
    ],
    // Keputusan tutup buku (v46). Cerminan `ensure_column` di `turso.rs` dan
    // `storage.rs`.
    [
      "keu_tutup_buku",
      "diputuskan_oleh",
      "ALTER TABLE keu_tutup_buku ADD COLUMN diputuskan_oleh TEXT;",
    ],
    [
      "keu_tutup_buku",
      "diputuskan_pada",
      "ALTER TABLE keu_tutup_buku ADD COLUMN diputuskan_pada TEXT;",
    ],
    [
      "keu_tutup_buku",
      "catatan_keputusan",
      "ALTER TABLE keu_tutup_buku ADD COLUMN catatan_keputusan TEXT;",
    ],
    // Data DAPODIK pendaftar PMB (v49, JSON berversi). Cerminan
    // `ensure_column` di `turso.rs`; tabelnya cloud-only.
    [
      "pmb_pendaftar",
      "data_dapodik",
      "ALTER TABLE pmb_pendaftar ADD COLUMN data_dapodik TEXT;",
    ],
    // Pembayaran biaya pendaftaran PMB (v52). Cerminan `ensure_column` di
    // `turso.rs`; keadaan bayar diturunkan, lihat `validations/pmb-pembayaran.ts`.
    [
      "pmb_gelombang",
      "lama_bayar_hari",
      "ALTER TABLE pmb_gelombang ADD COLUMN lama_bayar_hari INTEGER NOT NULL DEFAULT 7 CHECK(lama_bayar_hari BETWEEN 1 AND 60);",
    ],
    [
      "pmb_pendaftar",
      "biaya_tagihan",
      "ALTER TABLE pmb_pendaftar ADD COLUMN biaya_tagihan INTEGER NOT NULL DEFAULT 0;",
    ],
    [
      "pmb_pendaftar",
      "batas_bayar",
      "ALTER TABLE pmb_pendaftar ADD COLUMN batas_bayar TEXT;",
    ],
    [
      "pmb_pendaftar",
      "dibayar_jumlah",
      "ALTER TABLE pmb_pendaftar ADD COLUMN dibayar_jumlah INTEGER;",
    ],
    [
      "pmb_pendaftar",
      "dibayar_tanggal",
      "ALTER TABLE pmb_pendaftar ADD COLUMN dibayar_tanggal TEXT;",
    ],
    [
      "pmb_pendaftar",
      "dibayar_metode",
      "ALTER TABLE pmb_pendaftar ADD COLUMN dibayar_metode TEXT CHECK(dibayar_metode IN ('tunai', 'transfer', 'qris', 'gateway'));",
    ],
    [
      "pmb_pendaftar",
      "dibayar_dicatat_oleh",
      "ALTER TABLE pmb_pendaftar ADD COLUMN dibayar_dicatat_oleh TEXT;",
    ],
    [
      "pmb_pendaftar",
      "dibayar_dicatat_at",
      "ALTER TABLE pmb_pendaftar ADD COLUMN dibayar_dicatat_at TEXT;",
    ],
    [
      "pmb_pendaftar",
      "pembayaran_batal_catatan",
      "ALTER TABLE pmb_pendaftar ADD COLUMN pembayaran_batal_catatan TEXT;",
    ],
    // Isi kolom tambahan barang (v53). Cerminan `ensure_column` di `turso.rs`
    // dan `storage.rs`; JSON berkunci id_kolom.
    [
      "inventory_barang",
      "atribut",
      "ALTER TABLE inventory_barang ADD COLUMN atribut TEXT;",
    ],
    // Hapus permanen kolom tambahan (v54). NULL = belum dihapus.
    [
      "inventory_kolom",
      "dihapus_pada",
      "ALTER TABLE inventory_kolom ADD COLUMN dihapus_pada TEXT;",
    ],
    // Jumlah desimal per barang (v55): 1 = setiap jumlah disimpan ×100.
    [
      "inventory_barang",
      "desimal",
      "ALTER TABLE inventory_barang ADD COLUMN desimal INTEGER NOT NULL DEFAULT 0 CHECK (desimal IN (0, 1));",
    ],
    // Email guru dan karyawan (v56). Cerminan `ensure_column` di `turso.rs`.
    ["master_data", "email", "ALTER TABLE master_data ADD COLUMN email TEXT;"],
    // Hapus barang salah input (v61). NULL = belum dihapus.
    [
      "inventory_barang",
      "dihapus_pada",
      "ALTER TABLE inventory_barang ADD COLUMN dihapus_pada TEXT;",
    ],
  ] as const) {
    if (
      (await hasTable(client, table)) &&
      !(await hasColumn(client, table, column))
    ) {
      await client.execute(alterSql);
    }
  }

  const now = new Date().toISOString();

  if (!(await hasColumn(client, "sync_operation_receipt", "receipt_json"))) {
    await client.execute(
      "ALTER TABLE sync_operation_receipt ADD COLUMN receipt_json TEXT NOT NULL DEFAULT '{}';",
    );
  }
  for (const role of SYSTEM_ROLES) {
    await client.execute({
      sql: `
        INSERT OR IGNORE INTO app_role (
          role_key, nama_role, deskripsi, is_system, is_superadmin,
          status, created_at, updated_at, created_by
        ) VALUES (?, ?, ?, 1, ?, 'Aktif', ?, ?, 'migration');
      `,
      args: [
        role.key,
        role.name,
        role.description,
        role.isSuperadmin,
        now,
        now,
      ],
    });
  }

  for (const [index, permission] of PERMISSION_CATALOG.entries()) {
    await client.execute({
      sql: `
        INSERT INTO app_permission (
          permission_key, nama, grup, deskripsi, is_active, sort_order
        ) VALUES (?, ?, ?, ?, 1, ?)
        ON CONFLICT(permission_key) DO UPDATE SET
          nama = excluded.nama,
          grup = excluded.grup,
          deskripsi = excluded.deskripsi,
          sort_order = excluded.sort_order;
      `,
      args: [
        permission.key,
        permission.name,
        permission.group,
        `Akses ${permission.name.toLocaleLowerCase("id-ID")}.`,
        index + 1,
      ],
    });
  }

  await client.execute(`
    UPDATE master_operator
    SET role_id = (
      SELECT id FROM app_role
      WHERE role_key = LOWER(master_operator.role)
    )
    WHERE role_id IS NULL;
  `);

  for (const [roleKey, permissionKeys] of Object.entries(
    DEFAULT_ROLE_PERMISSIONS,
  )) {
    const roleResult = await client.execute({
      sql: "SELECT id FROM app_role WHERE role_key = ? LIMIT 1;",
      args: [roleKey],
    });
    const roleId = Number(roleResult.rows[0]?.id);
    if (!Number.isSafeInteger(roleId)) continue;

    for (const permissionKey of permissionKeys) {
      await client.execute({
        sql: `
          INSERT OR IGNORE INTO role_permission (
            role_id, permission_key, is_allowed, updated_at, updated_by
          ) VALUES (?, ?, 1, ?, 'migration');
        `,
        args: [roleId, permissionKey, now],
      });
    }
  }

  await client.execute(`
    INSERT OR IGNORE INTO setting_gex_system (key, value)
    VALUES ('rbac_revision', '1');
  `);

  await client.execute({
    sql: `
      INSERT OR IGNORE INTO schema_migration (version, name, applied_at)
      VALUES (?, 'dynamic-rbac-foundation', ?);
    `,
    args: [RBAC_MIGRATION_VERSION, now],
  });

  await client.execute({
    sql: `
      INSERT OR IGNORE INTO schema_migration (version, name, applied_at)
      VALUES (?, 'web-session-foundation', ?);
    `,
    args: [WEB_SESSION_MIGRATION_VERSION, now],
  });

  await client.execute({
    sql: `
      INSERT OR IGNORE INTO schema_migration (version, name, applied_at)
      VALUES (?, 'login-rate-limit', ?);
    `,
    args: [LOGIN_RATE_LIMIT_MIGRATION_VERSION, now],
  });

  await client.execute({
    sql: `
      INSERT OR IGNORE INTO schema_migration (version, name, applied_at)
      VALUES (?, 'operational-sync-foundation', ?);
    `,
    args: [OPERATIONAL_SYNC_MIGRATION_VERSION, now],
  });
  // Lebarkan CHECK `notifikasi_wa.jenis` pada database yang sudah ada.
  //
  // `CREATE TABLE IF NOT EXISTS` di atas tidak pernah memperbaiki tabel yang
  // sudah terlanjur dibuat, sehingga tanpa blok ini `koreksi_admin` dan
  // `import_manual` ditolak CHECK lama — dan pada jalur sinkronisasi penolakan
  // itu mengunci outbox secara permanen.
  //
  // Idempoten lewat pemeriksaan teks DDL-nya sendiri; keempat nilai lama tetap
  // sah pada CHECK baru sehingga tidak ada baris yang perlu diperbaiki.
  // Cerminan `ensure_wa_notification_kind_values` di `storage.rs` dan `turso.rs`.
  const notifDdl = await client.execute({
    sql: "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'notifikasi_wa';",
  });
  const ddlNotif = String(notifDdl.rows[0]?.sql ?? "");
  if (ddlNotif && !ddlNotif.includes("'tutup_buku'")) {
    // Irisan kolom, bukan daftar tetap (cermin `storage.rs`/`turso.rs`): tabel
    // lama bisa belum punya `klaim_oleh`/`klaim_sampai`, dan tabel yang sudah
    // punya tidak boleh kehilangan klaim pengiriman yang sedang berjalan.
    const target = [
      "id_notifikasi",
      "dedupe_key",
      "jenis",
      "id_siswa",
      "tujuan_nomor",
      "isi_pesan",
      "status",
      "attempt_count",
      "last_error",
      "sent_at",
      "created_at",
      "updated_at",
      "klaim_oleh",
      "klaim_sampai",
    ];
    const info = await client.execute("PRAGMA table_info(notifikasi_wa);");
    const ada = new Set(info.rows.map((row) => String(row.name)));
    const kolomNotif = target.filter((nama) => ada.has(nama)).join(", ");
    await client.batch(
      [
        "DROP TABLE IF EXISTS notifikasi_wa__rebuild;",
        `CREATE TABLE notifikasi_wa__rebuild (
          id_notifikasi TEXT PRIMARY KEY,
          dedupe_key TEXT NOT NULL,
          jenis TEXT NOT NULL CHECK (jenis IN ('scan_masuk', 'scan_pulang', 'bolos', 'ambang_alfa', 'koreksi_admin', 'import_manual', 'uks', 'tagihan', 'tutup_buku')),
          id_siswa TEXT,
          tujuan_nomor TEXT NOT NULL,
          isi_pesan TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'Menunggu' CHECK (status IN ('Menunggu', 'Terkirim', 'Gagal', 'Dibatalkan')),
          attempt_count INTEGER NOT NULL DEFAULT 0,
          last_error TEXT,
          sent_at TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          klaim_oleh TEXT,
          klaim_sampai TEXT
        );`,
        `INSERT INTO notifikasi_wa__rebuild (${kolomNotif}) SELECT ${kolomNotif} FROM notifikasi_wa;`,
        "DROP TABLE notifikasi_wa;",
        "ALTER TABLE notifikasi_wa__rebuild RENAME TO notifikasi_wa;",
        "CREATE INDEX IF NOT EXISTS idx_notifikasi_wa_status ON notifikasi_wa(status, created_at);",
        "CREATE INDEX IF NOT EXISTS idx_notifikasi_wa_dedupe ON notifikasi_wa(dedupe_key);",
      ],
      "write",
    );
  }

  await client.execute({
    sql: `INSERT OR IGNORE INTO schema_migration (version, name, applied_at)
          VALUES (?, 'offline-import-foundation', ?);`,
    args: [OFFLINE_IMPORT_MIGRATION_VERSION, now],
  });

  if (!(await hasColumn(client, "tbl_shift", "shift_lanjutan_id"))) {
    await client.execute(
      "ALTER TABLE tbl_shift ADD COLUMN shift_lanjutan_id INTEGER DEFAULT 0;",
    );
  }
  // v50 — hari kerja mingguan shift. Cermin `ensure_column` di `turso.rs`.
  if (!(await hasColumn(client, "tbl_shift", "hari_kerja"))) {
    await client.execute(
      "ALTER TABLE tbl_shift ADD COLUMN hari_kerja TEXT DEFAULT '1,2,3,4,5,6,7';",
    );
  }
  if (!(await hasColumn(client, "tbl_shift", "izinkan_multi_sesi"))) {
    await client.execute(
      "ALTER TABLE tbl_shift ADD COLUMN izinkan_multi_sesi INTEGER DEFAULT 0;",
    );
  }

  if (!(await hasColumn(client, "absensi_harian", "mode_tugas"))) {
    await client.execute(
      "ALTER TABLE absensi_harian ADD COLUMN mode_tugas TEXT DEFAULT 'NORMAL';",
    );
  }
  if (!(await hasColumn(client, "absensi_harian", "id_backup"))) {
    await client.execute(
      "ALTER TABLE absensi_harian ADD COLUMN id_backup TEXT;",
    );
  }
  if (!(await hasColumn(client, "absensi_harian", "id_karyawan_asal"))) {
    await client.execute(
      "ALTER TABLE absensi_harian ADD COLUMN id_karyawan_asal TEXT;",
    );
  }
  if (!(await hasColumn(client, "absensi_harian", "tanggal_tugas"))) {
    await client.execute(
      "ALTER TABLE absensi_harian ADD COLUMN tanggal_tugas DATE;",
    );
  }
  if (!(await hasColumn(client, "master_data", "status_backup"))) {
    await client.execute(
      "ALTER TABLE master_data ADD COLUMN status_backup TEXT DEFAULT 'NORMAL';",
    );
  }

  await client.execute({
    sql: `INSERT OR IGNORE INTO schema_migration (version, name, applied_at)
          VALUES (?, 'operational-columns-foundation', ?);`,
    args: [OPERATIONAL_COLUMNS_MIGRATION_VERSION, now],
  });

  await client.execute(`
    CREATE TABLE IF NOT EXISTS tbl_hari_libur (
      id_libur INTEGER PRIMARY KEY AUTOINCREMENT,
      tanggal DATE UNIQUE NOT NULL,
      nama_libur TEXT NOT NULL,
      jenis_libur TEXT DEFAULT 'Libur Nasional',
      keterangan TEXT,
      status_aktif INTEGER DEFAULT 1
    );
  `);
  await client.execute(
    "CREATE INDEX IF NOT EXISTS idx_hari_libur_tanggal ON tbl_hari_libur(tanggal, status_aktif);",
  );

  await client.execute({
    sql: `INSERT OR IGNORE INTO schema_migration (version, name, applied_at)
          VALUES (?, 'holiday-management-foundation', ?);`,
    args: [HOLIDAY_MIGRATION_VERSION, now],
  });

  await client.execute(`
    CREATE TABLE IF NOT EXISTS company_profile (
      id TEXT PRIMARY KEY DEFAULT 'default_company',
      company_name TEXT NOT NULL DEFAULT 'Nama Instansi',
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
  `);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS id_card_template (
      id TEXT PRIMARY KEY DEFAULT 'default_template',
      name TEXT NOT NULL DEFAULT 'Template Standar ID Card',
      orientation TEXT NOT NULL DEFAULT 'landscape',
      front_bg_url TEXT,
      back_bg_url TEXT,
      elements_json TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  // Placeholder dari `BRANDING`, bukan nama orang atau alamat karangan: nilai
  // ini tercetak di kartu dan laporan sekolah baru sampai admin mengisinya.
  await client.execute({
    sql: `
      INSERT OR IGNORE INTO company_profile (
        id, company_name, branch_name, logo_url, signature_url,
        address, phone, email, website,
        leader_name, leader_title, leader_nip,
        card_terms, timezone, updated_at
      ) VALUES (
        'default_company', ?, ?, NULL, NULL,
        ?, ?, ?, ?,
        ?, ?, ?,
        ?, 'Asia/Jakarta', ?
      );
    `,
    args: [
      BRANDING.defaultCompanyName,
      BRANDING.defaultBranchName,
      BRANDING.defaultAddress,
      BRANDING.defaultPhone,
      BRANDING.defaultEmail,
      BRANDING.defaultWebsite,
      BRANDING.defaultLeaderName,
      BRANDING.defaultLeaderTitle,
      BRANDING.defaultLeaderNip,
      BRANDING.defaultCardTerms,
      now,
    ],
  });

  await client.execute({
    sql: `INSERT OR IGNORE INTO schema_migration (version, name, applied_at)
          VALUES (?, 'company-profile-and-id-card-template-foundation', ?);`,
    args: [COMPANY_PROFILE_AND_TEMPLATE_MIGRATION_VERSION, now],
  });
  await client.execute({
    sql: `INSERT OR IGNORE INTO schema_migration (version, name, applied_at)
          VALUES (?, 'two-tier-security-and-atomic-sync', ?);`,
    args: [TWO_TIER_SECURITY_MIGRATION_VERSION, now],
  });

  // Payroll Engine Tables Migration
  await client.execute(`
    CREATE TABLE IF NOT EXISTS salary_configs (
      id TEXT PRIMARY KEY,
      id_karyawan TEXT NOT NULL,
      rate_per_hour INTEGER NOT NULL CHECK (rate_per_hour >= 0),
      rate_per_jp INTEGER NOT NULL DEFAULT 0 CHECK (rate_per_jp >= 0),
      ptkp_status TEXT NOT NULL DEFAULT 'TK/0'
        CHECK (ptkp_status IN ('TK/0','TK/1','TK/2','TK/3','K/0','K/1','K/2','K/3')),
      effective_date TEXT NOT NULL,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(id_karyawan, effective_date)
    );
  `);

  await client.execute(`
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
  `);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS payroll_components (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      category TEXT NOT NULL CHECK (category IN ('ALLOWANCE', 'DEDUCTION')),
      calc_type TEXT NOT NULL
        CHECK (calc_type IN ('FIXED', 'PERCENTAGE', 'PER_JP', 'PER_HADIR')),
      default_value REAL NOT NULL DEFAULT 0 CHECK (default_value >= 0),
      applies_to TEXT NOT NULL DEFAULT 'ALL',
      is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS tax_rules (
      id TEXT PRIMARY KEY,
      category TEXT NOT NULL CHECK (category IN ('TER_A','TER_B','TER_C','PASAL_17')),
      bracket_min INTEGER NOT NULL,
      bracket_max INTEGER,
      rate_percentage REAL NOT NULL CHECK (rate_percentage >= 0),
      effective_date TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS bpjs_rules (
      id TEXT PRIMARY KEY,
      component_code TEXT NOT NULL UNIQUE,
      component_name TEXT NOT NULL,
      rate_percentage REAL NOT NULL CHECK (rate_percentage >= 0),
      wage_cap INTEGER,
      effective_date TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  await client.execute(`
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
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  await client.execute(`
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
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (payroll_run_id, id_karyawan)
    );
  `);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS payroll_audit_logs (
      id TEXT PRIMARY KEY,
      payroll_run_id TEXT NOT NULL REFERENCES payroll_runs(id) ON DELETE CASCADE,
      action TEXT NOT NULL,
      old_status TEXT,
      new_status TEXT NOT NULL,
      performed_by TEXT NOT NULL,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // Tarif default payroll dari `tarif-payroll-bawaan.json`, berkas yang SAMA
  // dengan seed Rust (`payroll_seed.rs`). Versi sebelumnya menulis tarif 2024
  // dengan id lama dan tanpa TER, sehingga PPh 21 di slip Web selalu nol dan
  // Rust terus menghapus baris yang terus ditanam ulang di sini.
  const idLama = TARIF_PAYROLL_BAWAAN.id_lama;
  const tandaIdLama = idLama.map(() => "?").join(", ");
  await client.batch(
    [
      ...["tax_rules", "bpjs_rules", "overtime_tier_rules"].map((tabel) => ({
        sql: `DELETE FROM ${tabel} WHERE id IN (${tandaIdLama});`,
        args: idLama,
      })),
      // Cermin `purge_legacy_rate_rows`: event lama ikut dibuang supaya
      // perangkat yang masih mengantrenya tidak menghidupkannya kembali.
      {
        sql: `DELETE FROM sync_changelog WHERE domain = 'payroll' AND entity_key IN (${tandaIdLama});`,
        args: idLama,
      },
      ...TARIF_PAYROLL_BAWAAN.tabel.flatMap((tabel) =>
        tabel.baris.map((baris) => ({
          sql: `INSERT OR IGNORE INTO ${tabel.nama} (${tabel.kolom.join(", ")}) VALUES (${tabel.kolom.map(() => "?").join(", ")});`,
          args: baris,
        })),
      ),
    ],
    "write",
  );

  await client.execute({
    sql: `INSERT OR IGNORE INTO schema_migration (version, name, applied_at)
          VALUES (?, 'payroll-engine-foundation', ?);`,
    args: [PAYROLL_MIGRATION_VERSION, now],
  });

  await client.execute({
    sql: `INSERT OR IGNORE INTO app_mail_config (
            id, provider, api_key, sender_email, sender_name,
            reset_base_url, is_active, updated_at, updated_by
          ) VALUES ('default', 'resend', NULL, NULL, NULL, NULL, 0, ?, 'migration');`,
    args: [now],
  });

  await client.execute({
    sql: `INSERT OR IGNORE INTO schema_migration (version, name, applied_at)
          VALUES (?, 'operator-contact-and-password-reset', ?);`,
    args: [OPERATOR_CONTACT_AND_RESET_MIGRATION_VERSION, now],
  });

  await client.execute({
    sql: `INSERT OR IGNORE INTO schema_migration (version, name, applied_at)
          VALUES (?, 'two-factor-totp', ?);`,
    args: [TWO_FACTOR_MIGRATION_VERSION, now],
  });

  // Foto bukti absensi. SENGAJA di luar SNAPSHOT_TABLES: satu foto ~40 KB dan
  // ratusan baris per hari akan membuat setiap pull snapshot berukuran puluhan
  // megabyte di tiap perangkat. Foto didorong bersama event 'attendance/scan'
  // lalu dibaca satu per satu dari cloud saat ada yang meninjaunya.
  await client.execute(`
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
      created_at TEXT NOT NULL,
      wajah_vonis TEXT,
      wajah_skor REAL
    );
  `);

  await client.execute({
    sql: `INSERT OR IGNORE INTO schema_migration (version, name, applied_at)
          VALUES (?, 'attendance-scan-security', ?);`,
    args: [SCAN_SECURITY_MIGRATION_VERSION, now],
  });

  // ── v14: Whitelist Shift/Divisi hari libur + pemisahan upah jam hari libur ──
  //
  // Cakupan disimpan sebagai `kode_shift` (bukan `id_shift`) dan NAMA divisi,
  // karena `id_shift` adalah AUTOINCREMENT lokal yang berbeda antar perangkat.
  // PK-nya TEXT yang dibuat klien, bukan AUTOINCREMENT, supaya dua perangkat
  // yang offline tidak pernah menghasilkan id yang sama lalu saling menimpa.
  //
  // SENGAJA TANPA UNIQUE INDEX pada (scope_type, scope_value): dua perangkat
  // offline bisa mendaftarkan cakupan yang sama, dan sebuah unique constraint
  // akan membuat push sync-nya gagal PERMANEN. Duplikat tidak berbahaya di sini
  // (penilaiannya OR), dan pencegahannya dilakukan di lapisan aplikasi yang
  // bisa memberi pesan ramah.
  await client.execute(`
    CREATE TABLE IF NOT EXISTS hari_libur_whitelist (
      id TEXT PRIMARY KEY,
      scope_type TEXT NOT NULL CHECK (scope_type IN ('SHIFT', 'DIVISI')),
      scope_value TEXT NOT NULL,
      tanggal_libur DATE,
      keterangan TEXT,
      status_aktif INTEGER NOT NULL DEFAULT 1 CHECK (status_aktif IN (0, 1)),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // Jam kerja pada tanggal libur dihitung dengan jenjang HARI_LIBUR, terpisah
  // dari lembur hari kerja yang memakai jenjang HARI_KERJA. Dua kolom ini
  // membekukan hasil pemisahan itu pada setiap slip yang sudah dibuat.
  if (!(await hasColumn(client, "payroll_items", "total_holiday_hours"))) {
    await client.execute(
      "ALTER TABLE payroll_items ADD COLUMN total_holiday_hours REAL NOT NULL DEFAULT 0;",
    );
  }
  if (
    !(await hasColumn(client, "payroll_items", "total_holiday_overtime_index"))
  ) {
    await client.execute(
      "ALTER TABLE payroll_items ADD COLUMN total_holiday_overtime_index REAL NOT NULL DEFAULT 0;",
    );
  }

  await client.execute({
    sql: `INSERT OR IGNORE INTO schema_migration (version, name, applied_at)
          VALUES (?, 'holiday-whitelist-and-holiday-overtime', ?);`,
    args: [HOLIDAY_WHITELIST_MIGRATION_VERSION, now],
  });

  // Kode pemulihan password Superadmin. Baris versi ini WAJIB dicatat di sini:
  // `isDatabaseSchemaReady` membandingkan MAX(version) dengan
  // CURRENT_SCHEMA_VERSION, sehingga menaikkan konstanta tanpa mencatat
  // barisnya membuat aplikasi menganggap database selamanya belum siap dan
  // menjalankan ulang seluruh migrasi pada setiap permintaan.
  await client.execute({
    sql: `INSERT OR IGNORE INTO schema_migration (version, name, applied_at)
          VALUES (?, 'superadmin-password-recovery-codes', ?);`,
    args: [PASSWORD_RECOVERY_MIGRATION_VERSION, now],
  });

  // ── v16: Struktur Akademik & Master Data Sekolah (Fase 1) ──
  await client.execute(`
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
  `);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS akademik_jurusan (
      id_jurusan TEXT PRIMARY KEY,
      kode_jurusan TEXT NOT NULL,
      nama_jurusan TEXT NOT NULL,
      deskripsi TEXT,
      is_aktif INTEGER NOT NULL DEFAULT 1 CHECK (is_aktif IN (0, 1)),
      id_unit TEXT
    );
  `);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS akademik_rombel (
      id_rombel TEXT PRIMARY KEY,
      id_tahun_ajaran TEXT NOT NULL,
      tingkat INTEGER NOT NULL,
      id_jurusan TEXT,
      nama_rombel TEXT NOT NULL,
      id_wali_kelas TEXT,
      kapasitas INTEGER NOT NULL DEFAULT 36,
      ruang_kelas TEXT,
      is_aktif INTEGER NOT NULL DEFAULT 1 CHECK (is_aktif IN (0, 1)),
      id_unit TEXT
    );
  `);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS akademik_mapel (
      id_mapel TEXT PRIMARY KEY,
      kode_mapel TEXT NOT NULL,
      nama_mapel TEXT NOT NULL,
      tingkat INTEGER,
      kelompok TEXT NOT NULL DEFAULT 'Wajib' CHECK (kelompok IN ('Wajib', 'Peminatan', 'Muatan Lokal', 'Kejuruan')),
      beban_jam INTEGER NOT NULL DEFAULT 2 CHECK (beban_jam > 0),
      kkm INTEGER NOT NULL DEFAULT 75,
      is_aktif INTEGER NOT NULL DEFAULT 1 CHECK (is_aktif IN (0, 1)),
      id_unit TEXT
    );
  `);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS akademik_guru_mapel (
      id_penugasan TEXT PRIMARY KEY,
      id_tahun_ajaran TEXT NOT NULL,
      id_rombel TEXT NOT NULL,
      id_mapel TEXT NOT NULL,
      id_guru TEXT NOT NULL
    );
  `);

  await client.execute(`
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
  `);

  await client.execute(`
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
  `);

  await client.execute({
    sql: `INSERT OR IGNORE INTO schema_migration (version, name, applied_at)
          VALUES (?, 'academic-foundation-v1', ?);`,
    args: [ACADEMIC_FOUNDATION_MIGRATION_VERSION, now],
  });

  // ── v17: Lepas UNIQUE dari tabel akademik yang ikut sinkronisasi ──
  //
  // UNIQUE pada tabel tersinkronisasi membuat push gagal PERMANEN: dua
  // perangkat offline boleh mendaftarkan NIS atau penugasan yang sama, dan
  // penolakan cloud menghentikan event-nya di `failed` dengan
  // `next_retry_at = NULL` — datanya hilang tanpa jalan pulih dari UI. Pelajaran
  // yang sama sudah dieja untuk `hari_libur_whitelist`; keunikannya kini
  // ditegakkan di lapisan aplikasi agar pesannya ramah dan bisa dikoreksi.
  //
  // SQLite tidak punya `DROP CONSTRAINT` dan `CREATE TABLE IF NOT EXISTS` tidak
  // memperbaiki tabel yang sudah ada, jadi tabelnya dibangun ulang — hanya bila
  // DDL tersimpan masih memuat `UNIQUE`, sehingga aman dijalankan berulang.
  await rebuildWithoutUnique(client, {
    table: "akademik_jurusan",
    createSql: `CREATE TABLE akademik_jurusan (
      id_jurusan TEXT PRIMARY KEY,
      kode_jurusan TEXT NOT NULL,
      nama_jurusan TEXT NOT NULL,
      deskripsi TEXT,
      is_aktif INTEGER NOT NULL DEFAULT 1 CHECK (is_aktif IN (0, 1)),
      id_unit TEXT
    );`,
    columns: "id_jurusan, kode_jurusan, nama_jurusan, deskripsi, is_aktif",
    indexes: [],
  });
  await rebuildWithoutUnique(client, {
    table: "akademik_mapel",
    createSql: `CREATE TABLE akademik_mapel (
      id_mapel TEXT PRIMARY KEY,
      kode_mapel TEXT NOT NULL,
      nama_mapel TEXT NOT NULL,
      tingkat INTEGER,
      kelompok TEXT NOT NULL DEFAULT 'Wajib' CHECK (kelompok IN ('Wajib', 'Peminatan', 'Muatan Lokal', 'Kejuruan')),
      beban_jam INTEGER NOT NULL DEFAULT 2 CHECK (beban_jam > 0),
      kkm INTEGER NOT NULL DEFAULT 75,
      is_aktif INTEGER NOT NULL DEFAULT 1 CHECK (is_aktif IN (0, 1)),
      id_unit TEXT
    );`,
    columns:
      "id_mapel, kode_mapel, nama_mapel, tingkat, kelompok, beban_jam, kkm, is_aktif",
    indexes: [],
  });
  await rebuildWithoutUnique(client, {
    table: "akademik_guru_mapel",
    createSql: `CREATE TABLE akademik_guru_mapel (
      id_penugasan TEXT PRIMARY KEY,
      id_tahun_ajaran TEXT NOT NULL,
      id_rombel TEXT NOT NULL,
      id_mapel TEXT NOT NULL,
      id_guru TEXT NOT NULL
    );`,
    columns: "id_penugasan, id_tahun_ajaran, id_rombel, id_mapel, id_guru",
    indexes: [
      "CREATE INDEX IF NOT EXISTS idx_guru_mapel_lookup ON akademik_guru_mapel(id_rombel, id_mapel);",
    ],
  });
  await rebuildWithoutUnique(client, {
    table: "siswa_data",
    createSql: `CREATE TABLE siswa_data (
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
    );`,
    columns:
      "id_siswa, nis, nisn, nama_lengkap, jenis_kelamin, id_rombel, nama_wali, no_whatsapp_wali, alamat, angkatan, status, created_at, updated_at",
    indexes: [
      "CREATE INDEX IF NOT EXISTS idx_siswa_rombel ON siswa_data(id_rombel, status);",
    ],
  });

  await client.execute({
    sql: `INSERT OR IGNORE INTO schema_migration (version, name, applied_at)
          VALUES (?, 'academic-unique-relaxation', ?);`,
    args: [ACADEMIC_UNIQUE_RELAXATION_MIGRATION_VERSION, now],
  });

  // ── v18: Presensi Jam Mata Pelajaran & Rekonsiliasi Kehadiran Kelas (Fase 2) ──
  await client.execute(`
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
  `);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS presensi_mapel_detail (
      id_detail TEXT PRIMARY KEY,
      id_presensi_mapel TEXT NOT NULL,
      id_siswa TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('Hadir', 'Izin', 'Sakit', 'Alfa', 'Dispensasi')),
      catatan TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  await client.execute({
    sql: `INSERT OR IGNORE INTO schema_migration (version, name, applied_at)
          VALUES (?, 'class-attendance-foundation', ?);`,
    args: [CLASS_ATTENDANCE_MIGRATION_VERSION, now],
  });

  // ── v19: Jurnal Mengajar, Kartu Pelajar & Leger Kehadiran (Fase 3) ──
  await client.execute(`
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
  `);

  await client.execute(`
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
  `);

  // v32 — foto profil seluruh personil, berkunci `master_data.id_unik`.
  // Cerminan DDL Rust di `storage.rs`/`turso.rs`; alasan lengkapnya di sana.
  await client.execute(`
    CREATE TABLE IF NOT EXISTS personil_foto (
      id_unik TEXT PRIMARY KEY,
      foto_mime TEXT NOT NULL DEFAULT 'image/jpeg',
      foto_base64 TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  // Baris versi WAJIB dicatat: `isDatabaseSchemaReady` membandingkan
  // MAX(version) dengan CURRENT_SCHEMA_VERSION.
  await client.execute({
    sql: `INSERT OR IGNORE INTO schema_migration (version, name, applied_at)
          VALUES (?, 'personnel-photo', ?);`,
    args: [PERSONNEL_PHOTO_MIGRATION_VERSION, now],
  });

  // v33 — riwayat penggantian identitas karyawan. Khusus cloud, cerminan DDL
  // `turso.rs`; satu baris lahir setiap kali operator memilih "Gunakan Versi
  // Lokal" pada konflik ID Unik, di transaksi yang sama dengan penimpaannya.
  await client.execute(`
    CREATE TABLE IF NOT EXISTS riwayat_identitas_karyawan (
      id_riwayat INTEGER PRIMARY KEY AUTOINCREMENT,
      waktu TEXT NOT NULL,
      id_unik TEXT NOT NULL,
      data_lama TEXT NOT NULL,
      data_baru TEXT NOT NULL,
      kode_operator TEXT,
      client_id TEXT,
      event_id TEXT
    );
  `);
  await client.execute(
    "CREATE INDEX IF NOT EXISTS idx_riwayat_identitas_id_unik ON riwayat_identitas_karyawan(id_unik);",
  );
  await client.execute({
    sql: `INSERT OR IGNORE INTO schema_migration (version, name, applied_at)
          VALUES (?, 'employee-identity-history', ?);`,
    args: [EMPLOYEE_IDENTITY_HISTORY_MIGRATION_VERSION, now],
  });

  // v34 — klaim pengiriman WhatsApp. Web dan perangkat kini sama-sama bisa
  // menguras antrean; tanpa klaim atomik dua pengirim bisa mengirim baris yang
  // sama ke wali. Dijalankan di sini, SETELAH rebuild `notifikasi_wa` di atas
  // yang menyalin daftar kolom eksplisit. Cerminan `ensure_column` di Rust.
  for (const column of ["klaim_oleh", "klaim_sampai"]) {
    if (!(await hasColumn(client, "notifikasi_wa", column))) {
      await client.execute(
        `ALTER TABLE notifikasi_wa ADD COLUMN ${column} TEXT;`,
      );
    }
  }
  await client.execute({
    sql: `INSERT OR IGNORE INTO schema_migration (version, name, applied_at)
          VALUES (?, 'wa-send-claim', ?);`,
    args: [WA_SEND_CLAIM_MIGRATION_VERSION, now],
  });

  // v35 — inventaris. DDL WAJIB identik dengan `storage.rs` dan `turso.rs`.
  // Tidak ada kolom stok: stok dihitung dari mutasi lewat view
  // `inventory_saldo`, karena kolom stok yang ikut sync ditimpa siapa terakhir
  // menang saat dua perangkat offline.
  await client.execute(`
    CREATE TABLE IF NOT EXISTS inventory_barang (
      id_barang TEXT PRIMARY KEY,
      kode_barang TEXT NOT NULL,
      nama_barang TEXT NOT NULL,
      kategori TEXT,
      tipe TEXT NOT NULL CHECK (tipe IN ('Aset', 'Habis Pakai')),
      satuan TEXT NOT NULL,
      bisa_expired INTEGER NOT NULL DEFAULT 0 CHECK (bisa_expired IN (0, 1)),
      stok_minimum INTEGER NOT NULL DEFAULT 0 CHECK (stok_minimum >= 0),
      tempat_utama TEXT,
      catatan TEXT,
      status_aktif INTEGER NOT NULL DEFAULT 1 CHECK (status_aktif IN (0, 1)),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      atribut TEXT,
      desimal INTEGER NOT NULL DEFAULT 0 CHECK (desimal IN (0, 1)),
      dihapus_pada TEXT
    );
  `);
  await client.execute(`
    CREATE TABLE IF NOT EXISTS inventory_mutasi (
      id_mutasi TEXT PRIMARY KEY,
      id_barang TEXT NOT NULL,
      jenis TEXT NOT NULL CHECK (jenis IN ('Masuk', 'Keluar', 'Pindah')),
      alasan TEXT NOT NULL CHECK (alasan IN (
        'Saldo Awal', 'Pengadaan', 'Hibah', 'Pengembalian',
        'Pemakaian', 'Peminjaman', 'Rusak/Afkir', 'Hilang', 'Kedaluwarsa',
        'Distribusi', 'Perubahan Kondisi',
        'Selisih Opname', 'Pembatalan')),
      tanggal TEXT NOT NULL,
      jumlah INTEGER NOT NULL CHECK (jumlah > 0),
      tempat_asal TEXT,
      kondisi_asal TEXT CHECK (kondisi_asal IN ('Baik', 'Rusak Ringan', 'Rusak Berat')),
      tempat_tujuan TEXT,
      kondisi_tujuan TEXT CHECK (kondisi_tujuan IN ('Baik', 'Rusak Ringan', 'Rusak Berat')),
      id_batch TEXT,
      tanggal_expired TEXT,
      id_ref TEXT,
      penerima_tipe TEXT CHECK (penerima_tipe IN ('Personil', 'Rombel', 'Unit', 'Umum')),
      penerima_id TEXT,
      penerima_nama TEXT,
      keperluan TEXT,
      sumber_dana TEXT,
      nomor_dokumen TEXT,
      harga_satuan INTEGER CHECK (harga_satuan IS NULL OR harga_satuan >= 0),
      catatan TEXT,
      dicatat_oleh TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  await client.execute(
    "CREATE INDEX IF NOT EXISTS idx_inventory_mutasi_barang_tanggal ON inventory_mutasi(id_barang, tanggal);",
  );
  await client.execute(
    "CREATE INDEX IF NOT EXISTS idx_inventory_mutasi_batch ON inventory_mutasi(id_batch);",
  );
  await client.execute(
    "CREATE INDEX IF NOT EXISTS idx_inventory_mutasi_ref ON inventory_mutasi(id_ref);",
  );
  // Satu-satunya rumus stok. `CREATE VIEW IF NOT EXISTS` tidak memperbarui
  // view lama: mengubah rumusnya berarti DROP VIEW di ketiga lapis sekaligus.
  await client.execute(`
    CREATE VIEW IF NOT EXISTS inventory_saldo AS
      SELECT id_barang, MIN(tempat) AS tempat, kondisi, id_batch, SUM(delta) AS saldo
      FROM (
        SELECT id_barang, tempat_tujuan AS tempat, kondisi_tujuan AS kondisi, id_batch, jumlah AS delta
          FROM inventory_mutasi WHERE tempat_tujuan IS NOT NULL
        UNION ALL
        SELECT id_barang, tempat_asal, kondisi_asal, id_batch, -jumlah
          FROM inventory_mutasi WHERE tempat_asal IS NOT NULL
      )
      GROUP BY id_barang, LOWER(tempat), kondisi, id_batch;
  `);
  await client.execute({
    sql: `INSERT OR IGNORE INTO schema_migration (version, name, applied_at)
          VALUES (?, 'inventory-foundation', ?);`,
    args: [INVENTORY_MIGRATION_VERSION, now],
  });

  // v36 — Buku Kunjungan UKS. Di luar snapshot (pola `absensi_foto`): data
  // kesehatan anak tidak boleh tersalin ke setiap perangkat. DDL WAJIB identik
  // dengan `storage.rs` dan `turso.rs`.
  await client.execute(`
    CREATE TABLE IF NOT EXISTS uks_kunjungan (
      id_kunjungan TEXT PRIMARY KEY,
      id_personil TEXT NOT NULL,
      nama_personil TEXT NOT NULL,
      kelas TEXT,
      tanggal TEXT NOT NULL,
      jam_masuk TEXT NOT NULL,
      jam_keluar TEXT,
      keluhan TEXT NOT NULL,
      tindakan TEXT,
      tindak_lanjut TEXT,
      catatan TEXT,
      dicatat_oleh TEXT NOT NULL,
      ditutup_oleh TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  await client.execute(
    "CREATE INDEX IF NOT EXISTS idx_uks_kunjungan_tanggal ON uks_kunjungan(tanggal);",
  );
  await client.execute(
    "CREATE INDEX IF NOT EXISTS idx_uks_kunjungan_personil ON uks_kunjungan(id_personil, tanggal);",
  );
  await client.execute({
    sql: `INSERT OR IGNORE INTO schema_migration (version, name, applied_at)
          VALUES (?, 'uks-visit-book', ?);`,
    args: [UKS_MIGRATION_VERSION, now],
  });

  // v37 — registri aset per unit. Hanya identitas unit; tempat dan kondisinya
  // diturunkan dari mutasi. DDL WAJIB identik dengan `storage.rs` dan `turso.rs`.
  await client.execute(`
    CREATE TABLE IF NOT EXISTS inventory_unit (
      id_unit TEXT PRIMARY KEY,
      id_barang TEXT NOT NULL,
      kode_unit TEXT NOT NULL,
      nomor_seri TEXT,
      catatan TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  await client.execute(
    "CREATE INDEX IF NOT EXISTS idx_inventory_unit_barang ON inventory_unit(id_barang);",
  );
  // v63: servis aset. DDL WAJIB identik dengan `storage.rs` dan `turso.rs`.
  await client.execute(`
    CREATE TABLE IF NOT EXISTS inventory_servis (
      id_servis TEXT PRIMARY KEY,
      id_barang TEXT NOT NULL,
      id_unit TEXT,
      jumlah INTEGER NOT NULL CHECK (jumlah > 0),
      tempat TEXT NOT NULL,
      kondisi_awal TEXT NOT NULL CHECK (kondisi_awal IN ('Baik', 'Rusak Ringan', 'Rusak Berat')),
      tanggal_mulai TEXT NOT NULL,
      penyedia TEXT,
      keluhan TEXT NOT NULL,
      tanggal_selesai TEXT,
      hasil TEXT CHECK (hasil IS NULL OR hasil IN ('Baik', 'Rusak Ringan', 'Rusak Berat', 'Tidak Bisa Diperbaiki')),
      biaya INTEGER CHECK (biaya IS NULL OR biaya >= 0),
      catatan_selesai TEXT,
      dibatalkan_pada TEXT,
      alasan_batal TEXT,
      dibuka_oleh TEXT NOT NULL,
      ditutup_oleh TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  await client.execute(
    "CREATE INDEX IF NOT EXISTS idx_inventory_servis_barang ON inventory_servis(id_barang);",
  );
  await client.execute({
    sql: `INSERT OR IGNORE INTO schema_migration (version, name, applied_at)
          VALUES (?, 'inventory-unit', ?);`,
    args: [INVENTORY_UNIT_MIGRATION_VERSION, now],
  });

  // v38 — vektor wajah terdaftar untuk verifikasi 1:1 saat scan. Ikut snapshot
  // supaya terminal offline bisa memeriksa; isinya int8 base64, bukan foto.
  // DDL WAJIB identik dengan `storage.rs` dan `turso.rs`.
  await client.execute(`
    CREATE TABLE IF NOT EXISTS personil_wajah (
      id_unik TEXT PRIMARY KEY,
      model TEXT NOT NULL,
      vektor TEXT NOT NULL,
      jumlah_sampel INTEGER NOT NULL DEFAULT 1,
      sumber TEXT NOT NULL CHECK (sumber IN ('kamera', 'foto_profil')),
      dibuat_oleh TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  await client.execute({
    sql: `INSERT OR IGNORE INTO schema_migration (version, name, applied_at)
          VALUES (?, 'face-verification', ?);`,
    args: [FACE_VERIFICATION_MIGRATION_VERSION, now],
  });

  // v39 — akuntansi berpasangan. Saldo TIDAK pernah disimpan: dihitung dari
  // baris jurnal. Jurnal append-only; koreksi = jurnal pembalik `batal-<id>`.
  // DDL WAJIB identik dengan `storage.rs` dan `turso.rs`.
  await client.execute(`
    CREATE TABLE IF NOT EXISTS keu_akun (
      id_akun TEXT PRIMARY KEY,
      kode TEXT NOT NULL,
      nama TEXT NOT NULL,
      kelompok TEXT NOT NULL CHECK (kelompok IN ('Aset', 'Kewajiban', 'Aset Neto', 'Pendapatan', 'Beban')),
      saldo_normal TEXT NOT NULL CHECK (saldo_normal IN ('Debit', 'Kredit')),
      is_aktif INTEGER NOT NULL DEFAULT 1 CHECK (is_aktif IN (0, 1)),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  await client.execute(`
    CREATE TABLE IF NOT EXISTS keu_jurnal (
      id_jurnal TEXT PRIMARY KEY,
      tanggal TEXT NOT NULL,
      seri TEXT NOT NULL,
      nomor_urut INTEGER NOT NULL CHECK (nomor_urut > 0),
      nomor TEXT NOT NULL,
      keterangan TEXT NOT NULL,
      sumber TEXT NOT NULL CHECK (sumber IN ('Manual', 'Kasbon', 'Payroll', 'Pembayaran', 'Tagihan', 'Inventaris', 'Pembatalan')),
      id_sumber TEXT,
      id_jurnal_batal TEXT,
      dibuat_oleh TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  await client.execute(
    "CREATE INDEX IF NOT EXISTS idx_keu_jurnal_tanggal ON keu_jurnal(tanggal);",
  );
  await client.execute(
    "CREATE INDEX IF NOT EXISTS idx_keu_jurnal_seri ON keu_jurnal(seri, nomor_urut);",
  );
  await client.execute(`
    CREATE TABLE IF NOT EXISTS keu_jurnal_baris (
      id_baris TEXT PRIMARY KEY,
      id_jurnal TEXT NOT NULL,
      id_akun TEXT NOT NULL,
      debit INTEGER NOT NULL DEFAULT 0 CHECK (debit >= 0),
      kredit INTEGER NOT NULL DEFAULT 0 CHECK (kredit >= 0),
      keterangan TEXT,
      urutan INTEGER NOT NULL DEFAULT 0,
      CHECK ((debit > 0 AND kredit = 0) OR (debit = 0 AND kredit > 0))
    );
  `);
  await client.execute(
    "CREATE INDEX IF NOT EXISTS idx_keu_jurnal_baris_jurnal ON keu_jurnal_baris(id_jurnal);",
  );
  await client.execute(
    "CREATE INDEX IF NOT EXISTS idx_keu_jurnal_baris_akun ON keu_jurnal_baris(id_akun);",
  );
  // Bagan akun bawaan dari berkas JSON yang sama dengan seed Rust.
  await client.batch(
    AKUN_BAWAAN.map((akun) => ({
      sql: SEED_AKUN_SQL,
      args: [
        akun.id_akun,
        akun.kode,
        akun.nama,
        akun.kelompok,
        akun.saldo_normal,
      ],
    })),
    "write",
  );
  await client.execute({
    sql: `INSERT OR IGNORE INTO schema_migration (version, name, applied_at)
          VALUES (?, 'accounting-foundation', ?);`,
    args: [ACCOUNTING_MIGRATION_VERSION, now],
  });

  // v40 — kasbon karyawan. Sisa TIDAK disimpan: pokok dikurangi angsuran gaji
  // dan pelunasan tunai. DDL WAJIB identik dengan `storage.rs` dan `turso.rs`.
  await client.execute(`
    CREATE TABLE IF NOT EXISTS keu_pinjaman (
      id_pinjaman TEXT PRIMARY KEY,
      id_karyawan TEXT NOT NULL,
      nama_karyawan TEXT NOT NULL,
      pokok INTEGER NOT NULL CHECK (pokok > 0),
      cicilan INTEGER NOT NULL CHECK (cicilan > 0),
      mulai_potong TEXT NOT NULL,
      keterangan TEXT,
      status TEXT NOT NULL DEFAULT 'Diajukan' CHECK (status IN ('Diajukan', 'Disetujui', 'Ditolak', 'Dibatalkan')),
      tanggal_pengajuan TEXT NOT NULL,
      diajukan_oleh TEXT NOT NULL,
      diputuskan_oleh TEXT,
      tanggal_cair TEXT,
      id_akun_kas TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  await client.execute(`
    CREATE TABLE IF NOT EXISTS keu_pinjaman_mutasi (
      id_mutasi TEXT PRIMARY KEY,
      id_pinjaman TEXT NOT NULL,
      jenis TEXT NOT NULL CHECK (jenis IN ('Pencairan', 'Angsuran Gaji', 'Pelunasan Tunai', 'Pembatalan')),
      jumlah INTEGER NOT NULL CHECK (jumlah > 0),
      tanggal TEXT NOT NULL,
      id_ref TEXT,
      id_jurnal TEXT,
      dicatat_oleh TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  await client.execute(`
    CREATE TABLE IF NOT EXISTS keu_pinjaman_tunda (
      id_tunda TEXT PRIMARY KEY,
      id_pinjaman TEXT NOT NULL,
      periode TEXT NOT NULL,
      alasan TEXT,
      dibuat_oleh TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  await client.execute(
    "CREATE INDEX IF NOT EXISTS idx_keu_pinjaman_karyawan ON keu_pinjaman(id_karyawan, status);",
  );
  await client.execute(
    "CREATE INDEX IF NOT EXISTS idx_keu_pinjaman_mutasi_pinjaman ON keu_pinjaman_mutasi(id_pinjaman);",
  );
  await client.execute(
    "CREATE INDEX IF NOT EXISTS idx_keu_pinjaman_tunda_pinjaman ON keu_pinjaman_tunda(id_pinjaman, periode);",
  );
  await client.execute({
    sql: `INSERT OR IGNORE INTO schema_migration (version, name, applied_at)
          VALUES (?, 'employee-loan', ?);`,
    args: [EMPLOYEE_LOAN_MIGRATION_VERSION, now],
  });

  // v41 — tagihan siswa. `keu_tagihan` dan `keu_tagihan_batal` append-only;
  // status "Dibatalkan" diturunkan dari baris pembatalan. DDL WAJIB identik
  // dengan `storage.rs` dan `turso.rs`.
  await client.execute(`
    CREATE TABLE IF NOT EXISTS keu_jenis_tagihan (
      id_jenis_tagihan TEXT PRIMARY KEY,
      nama TEXT NOT NULL,
      periodik TEXT NOT NULL CHECK (periodik IN ('Bulanan', 'Tahunan', 'Sekali')),
      nominal_bawaan INTEGER NOT NULL DEFAULT 0 CHECK (nominal_bawaan >= 0),
      id_akun_pendapatan TEXT NOT NULL,
      is_aktif INTEGER NOT NULL DEFAULT 1 CHECK (is_aktif IN (0, 1)),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  await client.execute(`
    CREATE TABLE IF NOT EXISTS keu_tarif_tagihan (
      id_tarif TEXT PRIMARY KEY,
      id_jenis_tagihan TEXT NOT NULL,
      nama_unit TEXT NOT NULL DEFAULT '',
      tingkat INTEGER,
      nominal INTEGER NOT NULL CHECK (nominal >= 0),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  await client.execute(`
    CREATE TABLE IF NOT EXISTS keu_keringanan (
      id_keringanan TEXT PRIMARY KEY,
      id_siswa TEXT NOT NULL,
      id_jenis_tagihan TEXT NOT NULL,
      jenis TEXT NOT NULL CHECK (jenis IN ('Persen', 'Nominal')),
      nilai INTEGER NOT NULL CHECK (nilai > 0),
      periode_mulai TEXT,
      periode_selesai TEXT,
      alasan TEXT,
      is_aktif INTEGER NOT NULL DEFAULT 1 CHECK (is_aktif IN (0, 1)),
      dibuat_oleh TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  await client.execute(`
    CREATE TABLE IF NOT EXISTS keu_tagihan (
      id_tagihan TEXT PRIMARY KEY,
      id_siswa TEXT NOT NULL,
      nama_siswa TEXT NOT NULL,
      id_jenis_tagihan TEXT NOT NULL,
      nama_tagihan TEXT NOT NULL,
      periode TEXT NOT NULL,
      nominal INTEGER NOT NULL CHECK (nominal >= 0),
      potongan INTEGER NOT NULL DEFAULT 0 CHECK (potongan >= 0),
      jatuh_tempo TEXT NOT NULL,
      dibuat_oleh TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      CHECK (potongan <= nominal)
    );
  `);
  await client.execute(`
    CREATE TABLE IF NOT EXISTS keu_tagihan_batal (
      id_tagihan TEXT PRIMARY KEY,
      alasan TEXT NOT NULL,
      dibatalkan_oleh TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  await client.execute(
    "CREATE INDEX IF NOT EXISTS idx_keu_tarif_jenis ON keu_tarif_tagihan(id_jenis_tagihan);",
  );
  await client.execute(
    "CREATE INDEX IF NOT EXISTS idx_keu_keringanan_jenis ON keu_keringanan(id_jenis_tagihan, id_siswa);",
  );
  await client.execute(
    "CREATE INDEX IF NOT EXISTS idx_keu_tagihan_jenis_periode ON keu_tagihan(id_jenis_tagihan, periode);",
  );
  await client.execute(
    "CREATE INDEX IF NOT EXISTS idx_keu_tagihan_siswa ON keu_tagihan(id_siswa);",
  );
  await client.execute({
    sql: `INSERT OR IGNORE INTO schema_migration (version, name, applied_at)
          VALUES (?, 'student-billing', ?);`,
    args: [STUDENT_BILLING_MIGRATION_VERSION, now],
  });

  // v42 — pembayaran tagihan siswa. `keu_pembayaran`, alokasinya, dan
  // pembatalannya append-only; `id_tagihan` alokasi yang NULL = Titipan Wali.
  // DDL WAJIB identik dengan `storage.rs` dan `turso.rs`.
  await client.execute(`
    CREATE TABLE IF NOT EXISTS keu_seri_perangkat (
      device_code TEXT PRIMARY KEY,
      seri TEXT NOT NULL,
      nama_perangkat TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  await client.execute(`
    CREATE TABLE IF NOT EXISTS keu_pembayaran (
      id_pembayaran TEXT PRIMARY KEY,
      id_siswa TEXT NOT NULL,
      nama_siswa TEXT NOT NULL,
      tanggal TEXT NOT NULL,
      seri TEXT NOT NULL,
      nomor_urut INTEGER NOT NULL CHECK (nomor_urut > 0),
      nomor TEXT NOT NULL,
      metode TEXT NOT NULL CHECK (metode IN ('Tunai', 'Transfer', 'Titipan')),
      id_akun_kas TEXT,
      total INTEGER NOT NULL CHECK (total > 0),
      keterangan TEXT,
      dibuat_oleh TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  await client.execute(`
    CREATE TABLE IF NOT EXISTS keu_pembayaran_alokasi (
      id_alokasi TEXT PRIMARY KEY,
      id_pembayaran TEXT NOT NULL,
      id_tagihan TEXT,
      nominal INTEGER NOT NULL CHECK (nominal > 0)
    );
  `);
  await client.execute(`
    CREATE TABLE IF NOT EXISTS keu_pembayaran_batal (
      id_pembayaran TEXT PRIMARY KEY,
      alasan TEXT NOT NULL,
      dibatalkan_oleh TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  await client.execute(
    "CREATE INDEX IF NOT EXISTS idx_keu_pembayaran_siswa ON keu_pembayaran(id_siswa);",
  );
  await client.execute(
    "CREATE INDEX IF NOT EXISTS idx_keu_pembayaran_tanggal ON keu_pembayaran(tanggal);",
  );
  await client.execute(
    "CREATE INDEX IF NOT EXISTS idx_keu_pembayaran_alokasi_pembayaran ON keu_pembayaran_alokasi(id_pembayaran);",
  );
  await client.execute(
    "CREATE INDEX IF NOT EXISTS idx_keu_pembayaran_alokasi_tagihan ON keu_pembayaran_alokasi(id_tagihan);",
  );
  await client.execute({
    sql: `INSERT OR IGNORE INTO schema_migration (version, name, applied_at)
          VALUES (?, 'student-payment', ?);`,
    args: [STUDENT_PAYMENT_MIGRATION_VERSION, now],
  });

  // v43 — jenis penilaian dinamis berbobot. DDL WAJIB identik dengan
  // `storage.rs` dan `turso.rs`; jenis bawaan dari berkas JSON yang sama.
  await client.execute(`
    CREATE TABLE IF NOT EXISTS nilai_jenis (
      id_jenis TEXT PRIMARY KEY,
      nama TEXT NOT NULL,
      bobot INTEGER NOT NULL DEFAULT 0 CHECK (bobot >= 0 AND bobot <= 100),
      urutan INTEGER NOT NULL DEFAULT 0,
      is_aktif INTEGER NOT NULL DEFAULT 1 CHECK (is_aktif IN (0, 1)),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  await client.batch(
    JENIS_NILAI_BAWAAN.map((jenis) => ({
      sql: SEED_JENIS_SQL,
      args: [jenis.id_jenis, jenis.nama, jenis.urutan],
    })),
    "write",
  );
  await client.execute({
    sql: `INSERT OR IGNORE INTO schema_migration (version, name, applied_at)
          VALUES (?, 'grade-type-dynamic', ?);`,
    args: [GRADE_TYPE_MIGRATION_VERSION, now],
  });

  // v44 — pengingat tagihan lewat WhatsApp: jenis `tagihan` di CHECK
  // `notifikasi_wa.jenis` (bangun ulang di atas) dan `app_wa_config.tagihan_enabled`.
  await client.execute({
    sql: `INSERT OR IGNORE INTO schema_migration (version, name, applied_at)
          VALUES (?, 'wa-billing-reminder', ?);`,
    args: [WA_BILLING_REMINDER_MIGRATION_VERSION, now],
  });

  // v45 — tutup buku. DDL WAJIB identik dengan `storage.rs` dan `turso.rs`.
  await client.execute(`
    CREATE TABLE IF NOT EXISTS keu_tutup_buku (
      id_tutup TEXT PRIMARY KEY,
      sampai_tanggal TEXT NOT NULL,
      dibuat_oleh TEXT NOT NULL,
      kode_perangkat TEXT NOT NULL,
      waktu_perangkat TEXT NOT NULL,
      diterima_cloud TEXT,
      saldo_json TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'Aktif' CHECK (status IN ('Aktif', 'Dibuka', 'Digantikan', 'Menunggu')),
      alasan_buka TEXT,
      dibuka_oleh TEXT,
      dibuka_pada TEXT,
      diputuskan_oleh TEXT,
      diputuskan_pada TEXT,
      catatan_keputusan TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  await client.execute({
    sql: `INSERT OR IGNORE INTO schema_migration (version, name, applied_at)
          VALUES (?, 'book-closing', ?);`,
    args: [BOOK_CLOSING_MIGRATION_VERSION, now],
  });
  // v46 — kolom keputusan tutup buku (ALTER-nya ada di daftar kolom di atas).
  await client.execute({
    sql: `INSERT OR IGNORE INTO schema_migration (version, name, applied_at)
          VALUES (?, 'book-closing-decision', ?);`,
    args: [BOOK_CLOSING_DECISION_MIGRATION_VERSION, now],
  });
  // v47 — pemberitahuan WhatsApp tutup buku: jenis `tutup_buku` di CHECK
  // `notifikasi_wa.jenis` (bangun ulang di atas) dan `app_wa_config.tutup_buku_enabled`.
  await client.execute({
    sql: `INSERT OR IGNORE INTO schema_migration (version, name, applied_at)
          VALUES (?, 'wa-book-closing', ?);`,
    args: [WA_BOOK_CLOSING_MIGRATION_VERSION, now],
  });
  // v48 — foto konten situs publik (`konten_gambar`, dibuat di blok CMS).
  await client.execute({
    sql: `INSERT OR IGNORE INTO schema_migration (version, name, applied_at)
          VALUES (?, 'content-image', ?);`,
    args: [CONTENT_IMAGE_MIGRATION_VERSION, now],
  });
  // v49 — data DAPODIK pendaftar PMB (ALTER-nya ada di daftar kolom di atas).
  await client.execute({
    sql: `INSERT OR IGNORE INTO schema_migration (version, name, applied_at)
          VALUES (?, 'pmb-dapodik', ?);`,
    args: [PMB_DAPODIK_MIGRATION_VERSION, now],
  });
  // v50 — hari kerja mingguan shift (ALTER-nya ada di blok tbl_shift).
  await client.execute({
    sql: `INSERT OR IGNORE INTO schema_migration (version, name, applied_at)
          VALUES (?, 'shift-work-days', ?);`,
    args: [SHIFT_WORK_DAYS_MIGRATION_VERSION, now],
  });
  // v51 — rapel gaji. Id deterministik `rpl-<slip>-<tarif baru>`, status
  // diturunkan dari `dibatalkan_pada` dan `breakdown_snapshot.rapel` proses
  // gaji. Tanpa UNIQUE selain PK. DDL WAJIB identik dengan `storage.rs` dan
  // `turso.rs`.
  await client.execute(`
    CREATE TABLE IF NOT EXISTS payroll_rapel (
      id_rapel TEXT PRIMARY KEY,
      id_karyawan TEXT NOT NULL,
      nama_karyawan TEXT NOT NULL,
      id_item_asal TEXT NOT NULL,
      id_run_asal TEXT NOT NULL,
      period_start TEXT NOT NULL,
      period_end TEXT NOT NULL,
      rate_lama INTEGER NOT NULL CHECK (rate_lama >= 0),
      rate_baru INTEGER NOT NULL CHECK (rate_baru >= 0),
      selisih_pokok INTEGER NOT NULL,
      selisih_lembur INTEGER NOT NULL,
      selisih_komponen INTEGER NOT NULL,
      jumlah INTEGER NOT NULL CHECK (jumlah > 0),
      dibuat_oleh TEXT NOT NULL,
      dibatalkan_oleh TEXT,
      dibatalkan_pada TEXT,
      alasan_batal TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  await client.execute(
    "CREATE INDEX IF NOT EXISTS idx_payroll_rapel_karyawan ON payroll_rapel(id_karyawan);",
  );
  await client.execute(
    "CREATE INDEX IF NOT EXISTS idx_payroll_rapel_item ON payroll_rapel(id_item_asal);",
  );
  await client.execute({
    sql: `INSERT OR IGNORE INTO schema_migration (version, name, applied_at)
          VALUES (?, 'payroll-rapel', ?);`,
    args: [PAYROLL_RAPEL_MIGRATION_VERSION, now],
  });
  // v52 — pembayaran biaya pendaftaran PMB (ALTER-nya ada di daftar kolom di atas).
  await client.execute({
    sql: `INSERT OR IGNORE INTO schema_migration (version, name, applied_at)
          VALUES (?, 'pmb-payment', ?);`,
    args: [PMB_PAYMENT_MIGRATION_VERSION, now],
  });
  // v53 — kolom tambahan barang inventaris. Isinya di `inventory_barang.atribut`
  // (ALTER-nya ada di daftar kolom di atas). DDL WAJIB identik dengan
  // `storage.rs` dan `turso.rs`.
  await client.execute(`
    CREATE TABLE IF NOT EXISTS inventory_kolom (
      id_kolom TEXT PRIMARY KEY,
      nama TEXT NOT NULL,
      tipe TEXT NOT NULL CHECK (tipe IN ('Teks', 'Angka')),
      is_aktif INTEGER NOT NULL DEFAULT 1 CHECK (is_aktif IN (0, 1)),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      dihapus_pada TEXT
    );
  `);
  await client.execute({
    sql: `INSERT OR IGNORE INTO schema_migration (version, name, applied_at)
          VALUES (?, 'inventory-column', ?);`,
    args: [INVENTORY_COLUMN_MIGRATION_VERSION, now],
  });
  // v54 — hapus permanen kolom tambahan (ALTER-nya ada di daftar kolom di atas).
  await client.execute({
    sql: `INSERT OR IGNORE INTO schema_migration (version, name, applied_at)
          VALUES (?, 'inventory-column-delete', ?);`,
    args: [INVENTORY_COLUMN_DELETE_MIGRATION_VERSION, now],
  });
  // v55 — jumlah desimal per barang (ALTER-nya ada di daftar kolom di atas).
  await client.execute({
    sql: `INSERT OR IGNORE INTO schema_migration (version, name, applied_at)
          VALUES (?, 'inventory-decimal', ?);`,
    args: [INVENTORY_DECIMAL_MIGRATION_VERSION, now],
  });
  // v56 — email guru dan karyawan (ALTER-nya ada di daftar kolom di atas).
  await client.execute({
    sql: `INSERT OR IGNORE INTO schema_migration (version, name, applied_at)
          VALUES (?, 'personnel-email', ?);`,
    args: [PERSONNEL_EMAIL_MIGRATION_VERSION, now],
  });

  await client.execute(
    "CREATE INDEX IF NOT EXISTS idx_jurnal_presensi ON jurnal_mengajar(id_presensi_mapel);",
  );
  await client.execute(
    "CREATE INDEX IF NOT EXISTS idx_leger_scope ON leger_kehadiran(id_tahun_ajaran, semester, id_rombel, id_siswa);",
  );

  await client.execute({
    sql: `INSERT OR IGNORE INTO schema_migration (version, name, applied_at)
          VALUES (?, 'teaching-journal-and-attendance-ledger', ?);`,
    args: [TEACHING_JOURNAL_AND_LEDGER_MIGRATION_VERSION, now],
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Versi 20: Fase 4 — Notifikasi WhatsApp & Bimbingan Konseling (BK)
  // ──────────────────────────────────────────────────────────────────────────
  await client.execute(`
    CREATE TABLE IF NOT EXISTS notifikasi_wa (
      id_notifikasi TEXT PRIMARY KEY,
      dedupe_key TEXT NOT NULL,
      jenis TEXT NOT NULL CHECK (jenis IN ('scan_masuk', 'scan_pulang', 'bolos', 'ambang_alfa', 'koreksi_admin', 'import_manual', 'uks', 'tagihan', 'tutup_buku')),
      id_siswa TEXT,
      tujuan_nomor TEXT NOT NULL,
      isi_pesan TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'Menunggu' CHECK (status IN ('Menunggu', 'Terkirim', 'Gagal', 'Dibatalkan')),
      attempt_count INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      sent_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      klaim_oleh TEXT,
      klaim_sampai TEXT
    );
  `);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS app_wa_config (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL DEFAULT 'fonnte' CHECK (provider IN ('fonnte', 'wablas', 'custom')),
      api_key TEXT NOT NULL DEFAULT '',
      api_url TEXT,
      sender_number TEXT,
      is_active INTEGER NOT NULL DEFAULT 0,
      daily_limit INTEGER NOT NULL DEFAULT 1000,
      scan_masuk_enabled INTEGER NOT NULL DEFAULT 0,
      scan_pulang_enabled INTEGER NOT NULL DEFAULT 0,
      bolos_enabled INTEGER NOT NULL DEFAULT 1,
      ambang_alfa_enabled INTEGER NOT NULL DEFAULT 1,
      koreksi_admin_enabled INTEGER NOT NULL DEFAULT 0,
      import_manual_enabled INTEGER NOT NULL DEFAULT 0,
      uks_enabled INTEGER NOT NULL DEFAULT 0,
      tagihan_enabled INTEGER NOT NULL DEFAULT 0,
      tutup_buku_enabled INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS bk_kasus (
      id_kasus TEXT PRIMARY KEY,
      id_siswa TEXT NOT NULL,
      id_tahun_ajaran TEXT NOT NULL,
      kategori TEXT NOT NULL CHECK (kategori IN ('kedisiplinan', 'akademik', 'kehadiran', 'sosial')),
      ringkasan TEXT NOT NULL,
      kronologi TEXT,
      status TEXT NOT NULL DEFAULT 'Terbuka' CHECK (status IN ('Terbuka', 'Dalam Bimbingan', 'Selesai')),
      dibuat_oleh TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS bk_sesi (
      id_sesi TEXT PRIMARY KEY,
      id_kasus TEXT NOT NULL,
      tanggal TEXT NOT NULL,
      catatan_konseling TEXT NOT NULL,
      tindak_lanjut TEXT,
      konselor TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  await client.execute(
    "CREATE INDEX IF NOT EXISTS idx_notifikasi_wa_status ON notifikasi_wa(status, created_at);",
  );
  await client.execute(
    "CREATE INDEX IF NOT EXISTS idx_notifikasi_wa_dedupe ON notifikasi_wa(dedupe_key);",
  );
  await client.execute(
    "CREATE INDEX IF NOT EXISTS idx_bk_kasus_siswa ON bk_kasus(id_siswa, id_tahun_ajaran);",
  );
  await client.execute(
    "CREATE INDEX IF NOT EXISTS idx_bk_sesi_kasus ON bk_sesi(id_kasus, tanggal);",
  );

  await client.execute({
    sql: `INSERT OR IGNORE INTO schema_migration (version, name, applied_at)
          VALUES (?, 'phase-4-notification-and-counseling', ?);`,
    args: [PHASE_4_MIGRATION_VERSION, now],
  });

  // ── v21: Aturan jam scan baru (lihat RECALCULATE_NORMAL_WORK_SQL) ──
  //
  // Data migration, bukan DDL: dijalankan hanya sekali, dijaga baris versinya.
  // Setelah itu Jam Kerja Normal selalu ditulis dengan rumus baru oleh form
  // shift, jadi menjalankannya ulang tidak diperlukan.
  const shiftRulesApplied = await client.execute({
    sql: "SELECT COUNT(*) AS total FROM schema_migration WHERE version = ?;",
    args: [SHIFT_TIME_RULES_MIGRATION_VERSION],
  });
  if (
    Number(shiftRulesApplied.rows[0]?.total ?? 0) === 0 &&
    (await hasTable(client, "tbl_shift"))
  ) {
    await client.execute(RECALCULATE_NORMAL_WORK_SQL);
  }
  await client.execute({
    sql: `INSERT OR IGNORE INTO schema_migration (version, name, applied_at)
          VALUES (?, 'shift-time-rules-v2', ?);`,
    args: [SHIFT_TIME_RULES_MIGRATION_VERSION, now],
  });

  // ── v22: Honor mengajar per jam pelajaran ──
  //
  // `id_guru` NULL berarti tarif berlaku untuk siapa pun yang mengajar mapel
  // itu; diisi berarti tarif khusus guru tersebut dan menang atas tarif umum.
  // SENGAJA tanpa UNIQUE selain PK: dua perangkat offline boleh membuat tarif
  // untuk mapel yang sama, dan sebuah UNIQUE akan membuat push-nya gagal
  // permanen. Cerminan DDL di `storage.rs` dan `turso.rs`.
  await client.execute(`
    CREATE TABLE IF NOT EXISTS tarif_jp (
      id TEXT PRIMARY KEY,
      id_mapel TEXT NOT NULL,
      id_guru TEXT,
      rate_per_jp INTEGER NOT NULL CHECK (rate_per_jp >= 0),
      effective_date TEXT NOT NULL,
      status_aktif INTEGER NOT NULL DEFAULT 1 CHECK (status_aktif IN (0, 1)),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // Tarif JP bawaan per orang, dan pembekuan honor mengajar di slip. Ketiganya
  // ditambahkan lewat ALTER karena tabelnya sudah ada di database lama, dan
  // pembuatan tabel yang dilewati begitu saja tidak pernah menambah kolom.
  if (!(await hasColumn(client, "salary_configs", "rate_per_jp"))) {
    await client.execute(
      "ALTER TABLE salary_configs ADD COLUMN rate_per_jp INTEGER NOT NULL DEFAULT 0;",
    );
  }
  if (!(await hasColumn(client, "payroll_items", "total_teaching_jp"))) {
    await client.execute(
      "ALTER TABLE payroll_items ADD COLUMN total_teaching_jp INTEGER NOT NULL DEFAULT 0;",
    );
  }
  if (!(await hasColumn(client, "payroll_items", "teaching_salary"))) {
    await client.execute(
      "ALTER TABLE payroll_items ADD COLUMN teaching_salary INTEGER NOT NULL DEFAULT 0;",
    );
  }

  // Baris versi ini WAJIB dicatat: `isDatabaseSchemaReady` membandingkan
  // MAX(version) dengan CURRENT_SCHEMA_VERSION, sehingga menaikkan konstanta
  // tanpa mencatat barisnya membuat aplikasi menganggap database selamanya
  // belum siap dan menjalankan ulang seluruh migrasi pada setiap permintaan.
  await client.execute({
    sql: `INSERT OR IGNORE INTO schema_migration (version, name, applied_at)
          VALUES (?, 'teaching-jp-rate', ?);`,
    args: [TEACHING_JP_RATE_MIGRATION_VERSION, now],
  });

  await client.execute(
    "CREATE INDEX IF NOT EXISTS idx_tarif_jp_lookup ON tarif_jp(id_mapel, effective_date DESC);",
  );

  // ── v23: Jadwal bel sekolah (jam pelajaran ke berapa, pukul berapa) ──
  //
  // Tabel KETERANGAN: presensi kelas tetap menyimpan `jam_ke` dan honor tetap
  // dihitung per jam pelajaran, jadi baris yang belum lengkap tidak pernah
  // menghalangi presensi. Tanpa UNIQUE pada `jam_ke` — dua perangkat offline
  // boleh mendaftarkan jam yang sama, dan UNIQUE akan membuat push-nya gagal
  // permanen. Cerminan DDL di `storage.rs` dan `turso.rs`.
  await client.execute(`${LESSON_PERIOD_TABLE_SQL};`);

  await client.execute(
    "CREATE INDEX IF NOT EXISTS idx_jam_pelajaran_urut ON akademik_jam_pelajaran(jam_ke, jam_mulai);",
  );

  // ── v24: Jadwal mengajar mingguan per rombel ──
  //
  // Seperti jadwal bel, tabel ini KETERANGAN: presensi kelas tetap bisa
  // dicatat tanpa jadwal, dan jadwal hanya memberi tombol isi-cepat. `hari`
  // 1=Senin sampai 7=Minggu, diturunkan dari tanggal lewat SQL supaya tidak ada
  // aritmetika tanggal yang dieja dua kali. Tanpa UNIQUE — dua perangkat
  // offline boleh menyusun jadwal yang sama.
  await client.execute(`
    CREATE TABLE IF NOT EXISTS jadwal_mengajar (
      id_jadwal TEXT PRIMARY KEY,
      id_tahun_ajaran TEXT NOT NULL,
      id_rombel TEXT NOT NULL,
      id_mapel TEXT NOT NULL,
      id_guru TEXT NOT NULL,
      hari INTEGER NOT NULL CHECK (hari BETWEEN 1 AND 7),
      jam_ke TEXT NOT NULL,
      is_aktif INTEGER NOT NULL DEFAULT 1 CHECK (is_aktif IN (0, 1)),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  await client.execute(
    "CREATE INDEX IF NOT EXISTS idx_jadwal_mengajar_lookup ON jadwal_mengajar(id_tahun_ajaran, id_rombel, hari);",
  );

  await client.execute({
    sql: `INSERT OR IGNORE INTO schema_migration (version, name, applied_at)
          VALUES (?, 'teaching-schedule', ?);`,
    args: [TEACHING_SCHEDULE_MIGRATION_VERSION, now],
  });

  // ── v25: Tunjangan per JP dan per hari hadir ──
  //
  // SQLite tidak bisa mengubah CHECK lewat ALTER, jadi `payroll_components`
  // dibangun ulang. Tanpa ini hanya pemasangan BARU yang bisa memakai kedua
  // jenis itu; pemasangan lama akan menolaknya di titik simpan, dan pada jalur
  // sinkronisasi penolakan itu mengunci outbox secara permanen.
  //
  // Idempoten lewat pemeriksaan teks DDL-nya sendiri. Tidak ada baris yang
  // perlu diperbaiki lebih dulu: nilai lama tetap sah pada CHECK baru.
  // Cerminan `ensure_payroll_calc_type_values` di `storage.rs` dan `turso.rs`.
  const komponenDdl = await client.execute({
    sql: "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'payroll_components';",
  });
  const ddlKomponen = String(komponenDdl.rows[0]?.sql ?? "");
  if (ddlKomponen && !ddlKomponen.includes("'PER_JP'")) {
    const kolom =
      "id, name, category, calc_type, default_value, applies_to, is_active, created_at";
    await client.batch(
      [
        "DROP TABLE IF EXISTS payroll_components__rebuild;",
        `CREATE TABLE payroll_components__rebuild (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          category TEXT NOT NULL CHECK (category IN ('ALLOWANCE', 'DEDUCTION')),
          calc_type TEXT NOT NULL
            CHECK (calc_type IN ('FIXED', 'PERCENTAGE', 'PER_JP', 'PER_HADIR')),
          default_value REAL NOT NULL DEFAULT 0 CHECK (default_value >= 0),
          applies_to TEXT NOT NULL DEFAULT 'ALL',
          is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );`,
        `INSERT INTO payroll_components__rebuild (${kolom}) SELECT ${kolom} FROM payroll_components;`,
        "DROP TABLE payroll_components;",
        "ALTER TABLE payroll_components__rebuild RENAME TO payroll_components;",
      ],
      "write",
    );
  }

  await client.execute({
    sql: `INSERT OR IGNORE INTO schema_migration (version, name, applied_at)
          VALUES (?, 'payroll-per-jp-allowance', ?);`,
    args: [PER_JP_ALLOWANCE_MIGRATION_VERSION, now],
  });

  // Baris versi WAJIB dicatat: `isDatabaseSchemaReady` membandingkan
  // MAX(version) dengan CURRENT_SCHEMA_VERSION.
  await client.execute({
    sql: `INSERT OR IGNORE INTO schema_migration (version, name, applied_at)
          VALUES (?, 'lesson-period-schedule', ?);`,
    args: [LESSON_PERIOD_MIGRATION_VERSION, now],
  });

  // ── v26: Penerimaan Peserta Didik Baru (PMB) ──
  //
  // Ketiganya CLOUD-ONLY: tidak pernah masuk `SNAPSHOT_TABLES`, tidak pernah
  // dibuat `storage.rs`, dan tidak pernah melewati outbox. Presedennya
  // `password_reset_request` dan `app_mail_config`, dengan alasan yang sama
  // persis — berkas identitas seorang calon siswa tidak boleh tersalin ke
  // SQLite setiap terminal pemindai di lobi sekolah.
  //
  // Konsekuensinya PMB MENUNTUT JARINGAN, dan setiap layar yang membacanya
  // wajib mengatakan itu saat offline alih-alih menampilkan daftar kosong.
  await client.execute(`
    CREATE TABLE IF NOT EXISTS pmb_gelombang (
      id_gelombang TEXT PRIMARY KEY,
      nama TEXT NOT NULL,
      tahun_ajaran TEXT NOT NULL,
      tanggal_buka TEXT NOT NULL,
      tanggal_tutup TEXT NOT NULL,
      kuota INTEGER NOT NULL DEFAULT 0,
      biaya_pendaftaran INTEGER NOT NULL DEFAULT 0,
      is_aktif INTEGER NOT NULL DEFAULT 0 CHECK(is_aktif IN (0, 1)),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      lama_bayar_hari INTEGER NOT NULL DEFAULT 7 CHECK(lama_bayar_hari BETWEEN 1 AND 60)
    );
  `);

  // PK TEXT buatan aplikasi (`pmb-<epoch>-<48 bit acak>`), bukan AUTOINCREMENT:
  // pola yang sama dengan `new_payroll_id`, yang lahir karena id epoch-detik
  // telanjang sudah pernah bertabrakan di dalam satu penyimpanan massal.
  //
  // `id_siswa` sengaja TANPA FOREIGN KEY ke `siswa_data`. Tabel itu ikut
  // snapshot, dan `apply_table` boleh menghapus lalu menulis ulang barisnya
  // saat rekonsiliasi — sebuah FK berkaskade akan menghapus jejak pendaftaran
  // diam-diam, dan gejalanya tidak akan pernah tertelusur ke sync.
  await client.execute(`
    CREATE TABLE IF NOT EXISTS pmb_pendaftar (
      id_pendaftar TEXT PRIMARY KEY,
      nomor_pendaftaran TEXT NOT NULL,
      id_gelombang TEXT NOT NULL,
      nama_lengkap TEXT NOT NULL,
      nisn TEXT,
      jenis_kelamin TEXT CHECK(jenis_kelamin IN ('L', 'P')),
      tempat_lahir TEXT,
      tanggal_lahir TEXT,
      asal_sekolah TEXT,
      alamat TEXT,
      nama_wali TEXT NOT NULL,
      no_whatsapp_wali TEXT NOT NULL,
      email_wali TEXT,
      pilihan_jurusan TEXT,
      status TEXT NOT NULL DEFAULT 'Baru'
        CHECK(status IN ('Baru', 'Berkas Lengkap', 'Terverifikasi',
                         'Diterima', 'Ditolak', 'Dibatalkan', 'Terdaftar')),
      catatan_verifikator TEXT,
      diverifikasi_oleh TEXT,
      diverifikasi_at TEXT,
      id_siswa TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      data_dapodik TEXT,
      biaya_tagihan INTEGER NOT NULL DEFAULT 0,
      batas_bayar TEXT,
      dibayar_jumlah INTEGER,
      dibayar_tanggal TEXT,
      dibayar_metode TEXT CHECK(dibayar_metode IN ('tunai', 'transfer', 'qris', 'gateway')),
      dibayar_dicatat_oleh TEXT,
      dibayar_dicatat_at TEXT,
      pembayaran_batal_catatan TEXT,
      pilihan_unit TEXT
    );
  `);

  // `konten_base64` TIDAK boleh ikut query daftar. Satu berkas sampai 500 KB;
  // seratus pendaftar membuat balasannya puluhan megabyte. Aturan yang sama
  // dengan `photo_base64` di riwayat reset password.
  await client.execute(`
    CREATE TABLE IF NOT EXISTS pmb_berkas (
      id_berkas TEXT PRIMARY KEY,
      id_pendaftar TEXT NOT NULL,
      jenis TEXT NOT NULL
        CHECK(jenis IN ('kartu_keluarga', 'akta_lahir', 'ijazah', 'rapor',
                        'foto', 'lainnya')),
      nama_file TEXT NOT NULL,
      mime TEXT NOT NULL
        CHECK(mime IN ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')),
      ukuran_byte INTEGER NOT NULL,
      konten_base64 TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (id_pendaftar) REFERENCES pmb_pendaftar(id_pendaftar)
        ON DELETE CASCADE
    );
  `);

  await client.execute({
    sql: `INSERT OR IGNORE INTO schema_migration (version, name, applied_at)
          VALUES (?, 'pmb-online', ?);`,
    args: [PMB_MIGRATION_VERSION, now],
  });

  // ── v27: Portal wali murid ──
  //
  // Dua tabel cloud-only lagi, alasan yang sama dengan PMB: sesi dan kode
  // sekali-pakai milik orang tua siswa tidak boleh tersalin ke SQLite setiap
  // terminal pemindai.
  //
  // Kode OTP disimpan sebagai hash SHA-256, tidak pernah bentuk aslinya —
  // siapa pun yang bisa membaca database sekolah tidak boleh bisa masuk sebagai
  // wali mana pun. Aturan yang sama dengan `token_hash` pada
  // `password_reset_request` dan kode pemulihan Superadmin.
  await client.execute(`
    CREATE TABLE IF NOT EXISTS wali_otp (
      id TEXT PRIMARY KEY,
      subjek TEXT NOT NULL CHECK(subjek IN ('wali', 'pmb')),
      subjek_id TEXT NOT NULL,
      tujuan_nomor TEXT NOT NULL,
      kode_hash TEXT NOT NULL,
      attempt_count INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'Menunggu'
        CHECK(status IN ('Menunggu', 'Terpakai', 'Kedaluwarsa', 'Dibatalkan')),
      delivery_status TEXT,
      delivery_error TEXT,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      used_at TEXT
    );
  `);

  // `id_siswa` SENGAJA tanpa FOREIGN KEY ke `siswa_data`.
  //
  // Tabel itu ikut snapshot, dan `apply_table` boleh menghapus lalu menulis
  // ulang barisnya saat rekonsiliasi. Sebuah FK berkaskade akan menghapus sesi
  // wali diam-diam di tengah pemakaian, dan gejalanya ("kadang tiba-tiba
  // logout") tidak akan pernah tertelusur kembali ke sinkronisasi.
  //
  // `no_whatsapp_wali` dibekukan saat sesi lahir supaya perubahan nomor di
  // `siswa_data` langsung membuat sesi lama tidak sah pada pemeriksaan
  // berikutnya — nomor berubah berarti walinya mungkin orang yang berbeda.
  await client.execute(`
    CREATE TABLE IF NOT EXISTS wali_session (
      session_id TEXT PRIMARY KEY,
      token_hash TEXT UNIQUE NOT NULL,
      id_siswa TEXT NOT NULL,
      no_whatsapp_wali TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      revoked_at TEXT,
      revoked_reason TEXT,
      user_agent_hash TEXT
    );
  `);

  await client.execute({
    sql: `INSERT OR IGNORE INTO schema_migration (version, name, applied_at)
          VALUES (?, 'wali-portal', ?);`,
    args: [WALI_PORTAL_MIGRATION_VERSION, now],
  });

  // ── v28: Modul nilai akademik ──
  //
  // Berbeda dari seluruh tabel Fase 5: kedua tabel ini IKUT SINKRONISASI dan
  // melewati outbox. Konsekuensinya mengikat:
  //
  //   * TIDAK ADA UNIQUE selain primary key. Dua guru offline boleh menilai
  //     kelas yang sama; penolakan cloud akan menghentikan event-nya di
  //     `failed` dengan `next_retry_at = NULL` dan datanya hilang tanpa jalan
  //     pulih dari UI. Keunikan ditegakkan `assert_unique` di lapisan aplikasi.
  //   * TIDAK ADA FOREIGN KEY. `apply_table` menghapus lalu menulis ulang baris
  //     saat rekonsiliasi, dan urutan penerapan antar-tabel tidak dijamin —
  //     detail bisa tiba sebelum headernya.
  //   * Primary key TEXT buatan klien, bukan AUTOINCREMENT.
  //
  // `kkm` dibekukan dari `akademik_mapel.kkm` saat penilaian dibuat, bukan
  // di-join saat dibaca: KKM yang diubah admin di tengah semester tidak boleh
  // mengubah penilaian yang sudah berlangsung dan sudah dilihat orang tua.
  // Pola yang sama dengan `payroll_runs` yang menyimpan tarif yang dipakainya.
  await client.execute(`
    CREATE TABLE IF NOT EXISTS nilai_penilaian (
      id_penilaian TEXT PRIMARY KEY,
      id_tahun_ajaran TEXT NOT NULL,
      semester TEXT NOT NULL CHECK (semester IN ('Ganjil', 'Genap')),
      id_rombel TEXT NOT NULL,
      id_mapel TEXT NOT NULL,
      id_guru TEXT NOT NULL,
      jenis TEXT NOT NULL
        CHECK (jenis IN ('Tugas', 'Ulangan Harian', 'Praktik', 'UTS', 'UAS')),
      id_jenis TEXT,
      nama_penilaian TEXT NOT NULL,
      tanggal TEXT NOT NULL,
      bobot INTEGER NOT NULL DEFAULT 1,
      kkm INTEGER NOT NULL DEFAULT 75,
      nilai_maks INTEGER NOT NULL DEFAULT 100,
      catatan TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  // `skor` NULL berarti BELUM DINILAI, bukan nol.
  //
  // Ini perbedaan yang paling mudah salah dan paling mahal di modul ini: anak
  // yang belum sempat mengumpulkan tugas bukan anak yang mendapat nol. Setiap
  // agregasi WAJIB memakai `AVG(skor)` yang mengabaikan NULL, tidak pernah
  // `COALESCE(skor, 0)` — yang kedua menurunkan rata-rata seorang anak karena
  // gurunya belum selesai menilai.
  await client.execute(`
    CREATE TABLE IF NOT EXISTS nilai_siswa (
      id_nilai TEXT PRIMARY KEY,
      id_penilaian TEXT NOT NULL,
      id_siswa TEXT NOT NULL,
      skor REAL,
      keterangan TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  await client.execute({
    sql: `INSERT OR IGNORE INTO schema_migration (version, name, applied_at)
          VALUES (?, 'academic-grades', ?);`,
    args: [GRADES_MIGRATION_VERSION, now],
  });

  // ── v29: Unit satuan pendidikan ──
  //
  // Daftar unit (TK, SD, SMP, ...) dikelola user di halaman Akademik, lalu
  // dipakai sebagai dropdown di formulir peserta didik, guru/PTK, dan karyawan.
  // SENGAJA tanpa UNIQUE pada `nama_unit`: tabel ini ikut sinkronisasi, dan dua
  // perangkat offline yang mendaftarkan nama sama akan membuat push-nya gagal
  // PERMANEN (`next_retry_at = NULL`). Duplikatnya dicegah di lapisan aplikasi.
  await client.execute(`
    CREATE TABLE IF NOT EXISTS akademik_unit (
      id_unit TEXT PRIMARY KEY,
      nama_unit TEXT NOT NULL,
      keterangan TEXT,
      urutan INTEGER NOT NULL DEFAULT 0,
      status_aktif INTEGER NOT NULL DEFAULT 1 CHECK (status_aktif IN (0, 1)),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  await client.execute({
    sql: `INSERT OR IGNORE INTO schema_migration (version, name, applied_at)
          VALUES (?, 'academic-unit', ?);`,
    args: [ACADEMIC_UNIT_MIGRATION_VERSION, now],
  });

  await client.execute(`
    CREATE TABLE IF NOT EXISTS wali_kredensial (
      id_siswa TEXT PRIMARY KEY,
      password_hash TEXT NOT NULL,
      changed_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  await client.execute({
    sql: `INSERT OR IGNORE INTO schema_migration (version, name, applied_at)
          VALUES (?, 'wali-kredensial', ?);`,
    args: [WALI_KREDENSIAL_MIGRATION_VERSION, now],
  });

  await client.execute(`
    CREATE TABLE IF NOT EXISTS berita (
      id_berita TEXT PRIMARY KEY,
      judul TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      ringkasan TEXT NOT NULL,
      isi TEXT NOT NULL,
      gambar_sampul TEXT,
      status TEXT NOT NULL DEFAULT 'Draft' CHECK(status IN ('Draft', 'Terbit')),
      tanggal_terbit TEXT,
      penulis TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS konten_publik (
      halaman TEXT NOT NULL,
      kunci TEXT NOT NULL,
      nilai TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (halaman, kunci)
    );
  `);

  // v48 — foto konten situs publik. Cloud-only seperti `konten_publik`:
  // tidak pernah disalin ke perangkat, dirujuk dari konten lewat id hash.
  await client.execute(`
    CREATE TABLE IF NOT EXISTS konten_gambar (
      id_gambar TEXT PRIMARY KEY,
      jenis TEXT NOT NULL CHECK (jenis IN ('image/webp', 'image/jpeg')),
      data_base64 TEXT NOT NULL,
      ukuran_byte INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  await client.execute({
    sql: `INSERT OR IGNORE INTO schema_migration (version, name, applied_at)
          VALUES (?, 'cms-landing-page', ?);`,
    args: [CMS_LANDING_PAGE_MIGRATION_VERSION, now],
  });

  await client.execute(`
    INSERT OR IGNORE INTO konten_publik (halaman, kunci, nilai) VALUES
    ('profil', 'visi', 'Mewujudkan generasi unggul, berakhlak mulia, berwawasan global, dan berdaya saing di era digital.'),
    ('profil', 'misi', '["Menyelenggarakan pendidikan holistik berbasis karakter dan nilai-nilai luhur.","Mengembangkan potensi akademik dan non-akademik siswa melalui kurikulum terintegrasi teknologi.","Menciptakan lingkungan belajar yang adaptif, inovatif, dan berstandar internasional.","Membangun kemitraan strategis dengan dunia industri dan perguruan tinggi terkemuka."]'),
    ('profil', 'sejarah', 'Didirikan dengan dedikasi untuk memajukan kualitas pendidikan, sekolah kami terus bertransformasi menjadi lembaga pendidikan percontohan yang melahirkan lulusan berprestasi di kancah nasional maupun internasional.'),
    ('profil', 'sambutan', 'Selamat datang di portal resmi sekolah kami. Kami berkomitmen memberikan layanan pendidikan terbaik yang menumbuhkan potensi setiap siswa secara optimal dalam lingkungan belajar yang aman, cerdas, dan berkarakter.'),
    ('kontak', 'jam_operasional', 'Senin – Jumat: 07.00 – 15.30 WIB'),
    ('kontak', 'catatan_pelayanan', 'Pelayanan administrasi dan konsultasi orang tua dilayani pada jam kerja operasional sekolah.'),
    ('kontak', 'instagram', ''),
    ('kontak', 'facebook', ''),
    ('kontak', 'youtube', ''),
    ('landing', 'hero_tagline', 'Pendidikan Karakter & Teknologi Menuju Masa Depan'),
    ('landing', 'hero_subtagline', 'Mempersiapkan Generasi Pemimpin Cerdas, Mandiri, dan Berakhlak Mulia di Era Digital'),
    ('landing', 'fasilitas_pengantar', 'Lingkungan kampus hijau dengan sarana prasarana modern untuk mendukung eksplorasi sains, seni, dan teknologi.'),
    ('landing', 'ekskul_pengantar', 'Wadah pembinaan minat dan bakat siswa dalam bidang kepemimpinan, olahraga, seni, dan sains teknologi.');
  `);

  await client.execute(
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_berita_slug ON berita(slug);",
  );
  await client.execute(
    "CREATE INDEX IF NOT EXISTS idx_berita_status_terbit ON berita(status, tanggal_terbit DESC);",
  );
  await client.execute(
    "CREATE INDEX IF NOT EXISTS idx_konten_publik_halaman ON konten_publik(halaman);",
  );

  await client.execute(
    "CREATE INDEX IF NOT EXISTS idx_presensi_mapel_lookup ON presensi_mapel(id_tahun_ajaran, id_rombel, id_mapel, tanggal);",
  );
  await client.execute(
    "CREATE INDEX IF NOT EXISTS idx_presensi_mapel_detail_parent ON presensi_mapel_detail(id_presensi_mapel);",
  );
  await client.execute(
    "CREATE INDEX IF NOT EXISTS idx_presensi_mapel_detail_siswa ON presensi_mapel_detail(id_siswa, created_at);",
  );

  await client.execute(
    "CREATE INDEX IF NOT EXISTS idx_rombel_ta ON akademik_rombel(id_tahun_ajaran);",
  );
  await client.execute(
    "CREATE INDEX IF NOT EXISTS idx_siswa_rombel ON siswa_data(id_rombel, status);",
  );
  await client.execute(
    "CREATE INDEX IF NOT EXISTS idx_guru_mapel_lookup ON akademik_guru_mapel(id_rombel, id_mapel);",
  );

  await client.execute(
    "CREATE INDEX IF NOT EXISTS idx_master_operator_role_id ON master_operator(role_id);",
  );

  // Email operator dipakai sebagai identitas pencarian pada "Lupa Password",
  // jadi ia harus unik. Index parsial: baris operator lama yang email-nya masih
  // NULL tidak saling bentrok dan tetap boleh ada lebih dari satu.
  await client.execute(
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_master_operator_email ON master_operator(LOWER(email)) WHERE email IS NOT NULL AND TRIM(email) <> '';",
  );
  await client.execute(
    "CREATE INDEX IF NOT EXISTS idx_password_reset_operator ON password_reset_request(operator_id, status, requested_at DESC);",
  );
  await client.execute(
    "CREATE INDEX IF NOT EXISTS idx_password_reset_token ON password_reset_request(token_hash);",
  );
  await client.execute(
    "CREATE INDEX IF NOT EXISTS idx_password_reset_challenge ON password_reset_request(challenge_hash);",
  );

  await client.execute(
    "CREATE INDEX IF NOT EXISTS idx_absensi_foto_tanggal ON absensi_foto(tanggal_kerja, timestamp_scan DESC);",
  );
  await client.execute(
    "CREATE INDEX IF NOT EXISTS idx_absensi_foto_karyawan ON absensi_foto(id_karyawan, tanggal_kerja);",
  );
  await client.execute(
    "CREATE INDEX IF NOT EXISTS idx_absensi_foto_sesi ON absensi_foto(id_sesi);",
  );

  await client.execute(
    "CREATE INDEX IF NOT EXISTS idx_role_permission_role ON role_permission(role_id, is_allowed);",
  );
  await client.execute(
    "CREATE INDEX IF NOT EXISTS idx_app_session_operator_active ON app_session(operator_id, revoked_at, expires_at);",
  );
  await client.execute(
    "CREATE INDEX IF NOT EXISTS idx_auth_login_rate_limit_blocked ON auth_login_rate_limit(blocked_until);",
  );
  await client.execute(
    "CREATE INDEX IF NOT EXISTS idx_sync_receipt_client_status ON sync_operation_receipt(client_id, status, processed_at);",
  );
  await client.execute(
    "CREATE INDEX IF NOT EXISTS idx_sync_change_domain_revision ON sync_change_log(domain, revision);",
  );
  await client.execute(
    "CREATE INDEX IF NOT EXISTS idx_import_offline_status ON import_offline(status_proses, timestamp_input);",
  );
  await client.execute(
    "CREATE INDEX IF NOT EXISTS idx_hari_libur_whitelist_scope ON hari_libur_whitelist(scope_type, scope_value, status_aktif);",
  );
  await client.execute(
    "CREATE INDEX IF NOT EXISTS idx_hari_libur_whitelist_tanggal ON hari_libur_whitelist(tanggal_libur, status_aktif);",
  );
  await client.execute(
    "CREATE INDEX IF NOT EXISTS idx_payroll_items_run ON payroll_items(payroll_run_id);",
  );
  await client.execute(
    "CREATE INDEX IF NOT EXISTS idx_payroll_items_karyawan ON payroll_items(id_karyawan);",
  );
  await client.execute(
    "CREATE INDEX IF NOT EXISTS idx_payroll_runs_status ON payroll_runs(status, period_start);",
  );
  await client.execute(
    "CREATE INDEX IF NOT EXISTS idx_salary_configs_karyawan ON salary_configs(id_karyawan, effective_date DESC);",
  );

  await client.execute(
    "CREATE INDEX IF NOT EXISTS idx_pmb_pendaftar_gelombang ON pmb_pendaftar(id_gelombang, status, created_at DESC);",
  );
  // Nomor pendaftaran dihasilkan MESIN dan dipakai pendaftar untuk memeriksa
  // statusnya. Unique aman di sini justru karena tabel ini tidak pernah
  // melewati outbox: ia ditulis langsung dalam keadaan online, sehingga
  // bentroknya muncul saat itu juga sebagai error yang bisa dijawab — bukan
  // sebagai push yang mati permanen dengan `next_retry_at = NULL`.
  await client.execute(
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_pmb_pendaftar_nomor ON pmb_pendaftar(nomor_pendaftaran);",
  );
  await client.execute(
    "CREATE INDEX IF NOT EXISTS idx_pmb_berkas_pendaftar ON pmb_berkas(id_pendaftar);",
  );

  await client.execute(
    "CREATE INDEX IF NOT EXISTS idx_wali_otp_subjek ON wali_otp(subjek, subjek_id, status, created_at DESC);",
  );
  await client.execute(
    "CREATE INDEX IF NOT EXISTS idx_wali_session_siswa ON wali_session(id_siswa, expires_at);",
  );

  await client.execute(
    "CREATE INDEX IF NOT EXISTS idx_nilai_penilaian_kelas ON nilai_penilaian(id_tahun_ajaran, semester, id_rombel, id_mapel);",
  );
  await client.execute(
    "CREATE INDEX IF NOT EXISTS idx_nilai_siswa_penilaian ON nilai_siswa(id_penilaian);",
  );
  await client.execute(
    "CREATE INDEX IF NOT EXISTS idx_nilai_siswa_siswa ON nilai_siswa(id_siswa, created_at);",
  );

  await client.execute(
    "CREATE INDEX IF NOT EXISTS idx_akademik_unit_urut ON akademik_unit(status_aktif, urutan, nama_unit);",
  );

  await client.execute(
    "CREATE INDEX IF NOT EXISTS idx_wali_kredensial_siswa ON wali_kredensial(id_siswa);",
  );

  // ── v57: Data DAPODIK per siswa ──
  //
  // Cloud-only seperti PMB: NIK, No KK, dan penghasilan orang tua tidak boleh
  // tersalin ke SQLite setiap terminal pemindai. Tanpa FOREIGN KEY ke
  // `siswa_data`, alasan yang sama dengan `pmb_pendaftar.id_siswa`. Cerminan
  // `turso.rs`; salinan dari PMB ditaruh paling akhir supaya kolom
  // `pmb_pendaftar.data_dapodik` pasti sudah ada. Lihat `validations/siswa-dapodik.ts`.
  await client.execute(`
    CREATE TABLE IF NOT EXISTS siswa_dapodik (
      id_siswa TEXT PRIMARY KEY,
      tempat_lahir TEXT,
      tanggal_lahir TEXT,
      sekolah_asal TEXT,
      data_dapodik TEXT,
      diubah_oleh TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  await client.execute(`${SQL_SALIN_DAPODIK_PMB};`);
  await client.execute({
    sql: `INSERT OR IGNORE INTO schema_migration (version, name, applied_at)
          VALUES (?, 'student-dapodik', ?);`,
    args: [STUDENT_DAPODIK_MIGRATION_VERSION, now],
  });

  // ── v58: Unit tujuan PMB dan unit pemilik jurusan ──
  //
  // Ditaruh paling akhir, SETELAH `rebuildWithoutUnique` membangun ulang
  // `akademik_jurusan` dengan daftar kolom eksplisit. NULL = jurusan berlaku
  // di semua unit. Cerminan `ensure_column` di `turso.rs` dan `storage.rs`.
  for (const [table, column, sql] of [
    [
      "akademik_jurusan",
      "id_unit",
      "ALTER TABLE akademik_jurusan ADD COLUMN id_unit TEXT;",
    ],
    [
      "pmb_pendaftar",
      "pilihan_unit",
      "ALTER TABLE pmb_pendaftar ADD COLUMN pilihan_unit TEXT;",
    ],
  ] as const) {
    if (!(await hasColumn(client, table, column))) await client.execute(sql);
  }
  await client.execute({
    sql: `INSERT OR IGNORE INTO schema_migration (version, name, applied_at)
          VALUES (?, 'pmb-unit', ?);`,
    args: [PMB_UNIT_MIGRATION_VERSION, now],
  });

  // ── v59: Berkas siswa ──
  //
  // Cloud-only seperti `pmb_berkas`. Berkas pendaftar yang sudah menjadi
  // siswa dipindah ke sini, tidak disalin. Cerminan `turso.rs`; lihat
  // `validations/berkas-sekolah.ts`.
  await client.execute(`
    CREATE TABLE IF NOT EXISTS siswa_berkas (
      id_berkas TEXT PRIMARY KEY,
      id_siswa TEXT NOT NULL,
      jenis TEXT NOT NULL
        CHECK(jenis IN ('kartu_keluarga', 'akta_lahir', 'ijazah', 'rapor',
                        'foto', 'lainnya')),
      nama_file TEXT NOT NULL,
      mime TEXT NOT NULL
        CHECK(mime IN ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')),
      ukuran_byte INTEGER NOT NULL,
      konten_base64 TEXT NOT NULL,
      diunggah_oleh TEXT,
      created_at TEXT NOT NULL
    );
  `);
  await client.execute(
    "CREATE INDEX IF NOT EXISTS idx_siswa_berkas_siswa ON siswa_berkas(id_siswa);",
  );
  await client.batch(
    [`${SQL_PINDAH_BERKAS_PMB};`, `${SQL_BUANG_BERKAS_PMB_TERPINDAH};`],
    "write",
  );
  await client.execute({
    sql: `INSERT OR IGNORE INTO schema_migration (version, name, applied_at)
          VALUES (?, 'student-files', ?);`,
    args: [STUDENT_FILES_MIGRATION_VERSION, now],
  });

  // ── v60: Unit mapel/rombel, jam pelajaran per unit dan hari, bunyi bel ──
  //
  // Kolom unit ditaruh SETELAH `rebuildWithoutUnique`, yang menyalin daftar
  // kolom eksplisit. NULL = mapel semua unit / rombel belum diatur.
  for (const [table, column, sql] of [
    [
      "akademik_mapel",
      "id_unit",
      "ALTER TABLE akademik_mapel ADD COLUMN id_unit TEXT;",
    ],
    [
      "akademik_rombel",
      "id_unit",
      "ALTER TABLE akademik_rombel ADD COLUMN id_unit TEXT;",
    ],
  ] as const) {
    if (!(await hasColumn(client, table, column))) await client.execute(sql);
  }

  // SQLite tidak bisa mengubah CHECK lewat ALTER, jadi jadwal bel dibangun
  // ulang untuk jenis `Pulang`; kolom barunya ikut di DDL yang sama. Baris
  // lama menjadi "semua unit, setiap hari, berbunyi". Idempoten lewat teks
  // DDL-nya. Cerminan `ensure_lesson_period_shape` di `storage.rs`/`turso.rs`.
  const belDdl = await client.execute({
    sql: "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'akademik_jam_pelajaran';",
  });
  const ddlBel = String(belDdl.rows[0]?.sql ?? "");
  if (ddlBel && !ddlBel.includes("'Pulang'")) {
    const kolom =
      "id_jam_pelajaran, jam_ke, jam_mulai, jam_selesai, jenis, keterangan, is_aktif, created_at, updated_at";
    await client.batch(
      [
        "DROP TABLE IF EXISTS akademik_jam_pelajaran__rebuild;",
        `${LESSON_PERIOD_TABLE_SQL.replace(
          "IF NOT EXISTS akademik_jam_pelajaran",
          "akademik_jam_pelajaran__rebuild",
        )};`,
        `INSERT INTO akademik_jam_pelajaran__rebuild (${kolom}) SELECT ${kolom} FROM akademik_jam_pelajaran;`,
        "DROP TABLE akademik_jam_pelajaran;",
        "ALTER TABLE akademik_jam_pelajaran__rebuild RENAME TO akademik_jam_pelajaran;",
        "CREATE INDEX IF NOT EXISTS idx_jam_pelajaran_urut ON akademik_jam_pelajaran(jam_ke, jam_mulai);",
      ],
      "write",
    );
  }
  await client.execute({
    sql: `INSERT OR IGNORE INTO schema_migration (version, name, applied_at)
          VALUES (?, 'unit-jp-bell', ?);`,
    args: [UNIT_JP_BELL_MIGRATION_VERSION, now],
  });
  // v61: hapus barang salah input (ALTER-nya ada di daftar kolom di atas).
  await client.execute({
    sql: `INSERT OR IGNORE INTO schema_migration (version, name, applied_at)
          VALUES (?, 'inventory-item-delete', ?);`,
    args: [INVENTORY_ITEM_DELETE_MIGRATION_VERSION, now],
  });
  // v62: sumber jurnal `Inventaris`. Cermin `ensure_journal_source_values` di
  // `storage.rs`/`turso.rs`. Indeks dan trigger cloud dipasang ulang dari
  // definisinya sendiri SETELAH baris disalin: trigger `trg_sync_append_*`
  // hanya dibuat Rust, dan tanpanya perangkat tidak pernah menerima jurnal
  // baru dari Web.
  const jurnalDdl = await client.execute(
    "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'keu_jurnal';",
  );
  const ddlJurnal = String(jurnalDdl.rows[0]?.sql ?? "");
  if (ddlJurnal && !ddlJurnal.includes("'Inventaris'")) {
    const turunan = await client.execute(
      "SELECT sql FROM sqlite_master WHERE tbl_name = 'keu_jurnal' AND type IN ('index', 'trigger') AND sql IS NOT NULL ORDER BY type, name;",
    );
    const kolom =
      "id_jurnal, tanggal, seri, nomor_urut, nomor, keterangan, sumber, id_sumber, id_jurnal_batal, dibuat_oleh, created_at";
    await client.batch(
      [
        "DROP TABLE IF EXISTS keu_jurnal__rebuild;",
        `CREATE TABLE keu_jurnal__rebuild (
          id_jurnal TEXT PRIMARY KEY,
          tanggal TEXT NOT NULL,
          seri TEXT NOT NULL,
          nomor_urut INTEGER NOT NULL CHECK (nomor_urut > 0),
          nomor TEXT NOT NULL,
          keterangan TEXT NOT NULL,
          sumber TEXT NOT NULL CHECK (sumber IN ('Manual', 'Kasbon', 'Payroll', 'Pembayaran', 'Tagihan', 'Inventaris', 'Pembatalan')),
          id_sumber TEXT,
          id_jurnal_batal TEXT,
          dibuat_oleh TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );`,
        `INSERT INTO keu_jurnal__rebuild (${kolom}) SELECT ${kolom} FROM keu_jurnal;`,
        "DROP TABLE keu_jurnal;",
        "ALTER TABLE keu_jurnal__rebuild RENAME TO keu_jurnal;",
        ...turunan.rows.map((row) => String(row.sql)),
      ],
      "write",
    );
  }
  await client.execute({
    sql: `INSERT OR IGNORE INTO schema_migration (version, name, applied_at)
          VALUES (?, 'journal-source-inventory', ?);`,
    args: [JOURNAL_SOURCE_INVENTORY_MIGRATION_VERSION, now],
  });
  // v63: servis aset (DDL-nya di blok v37 di atas, bersama `inventory_unit`).
  await client.execute({
    sql: `INSERT OR IGNORE INTO schema_migration (version, name, applied_at)
          VALUES (?, 'inventory-service', ?);`,
    args: [INVENTORY_SERVICE_MIGRATION_VERSION, now],
  });
}
