import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { type Client, createClient } from "@libsql/client";
import {
  hashPassword,
  hashVerifiedPasswordForUpgrade,
  verifyPassword,
} from "@/lib/auth/password";
import { runDatabaseMigrations } from "@/lib/db-migrations";
import { initDatabaseSchema, isDatabaseSchemaReady } from "@/lib/db-schema";
import {
  DEFAULT_ROLE_PERMISSIONS,
  PERMISSION_CATALOG,
  SENSITIVE_MUTATION_PERMISSIONS,
  SUPERADMIN_ONLY_PERMISSIONS,
} from "@/lib/rbac/catalog";
import {
  editRole,
  insertRole,
  listRoles,
  parseRoleDraft,
} from "@/lib/rbac/role-admin";

let client: Client;

beforeAll(async () => {
  client = createClient({ url: "file::memory:" });
  await client.execute(`
    CREATE TABLE master_operator (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kode_operator TEXT UNIQUE NOT NULL,
      nama_operator TEXT NOT NULL,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('Admin', 'Operator', 'Scanner')),
      status TEXT DEFAULT 'Aktif'
    );
  `);
  await client.execute(`
    CREATE TABLE setting_gex_system (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
  await client.execute(`
    INSERT INTO master_operator (
      kode_operator, nama_operator, username, password_hash, role, status
    ) VALUES ('OP001', 'Admin Lama', 'admin', 'legacy-password', 'Admin', 'Aktif');
  `);
});

afterAll(() => client.close());

describe("dynamic RBAC migration", () => {
  test("mendeteksi skema siap agar request berikutnya melewati migrasi", async () => {
    await initDatabaseSchema(client);
    expect(await isDatabaseSchemaReady(client)).toBe(true);
    await initDatabaseSchema(client);
  });

  test("migrasi idempotent dan mempertahankan operator lama", async () => {
    await runDatabaseMigrations(client);
    await runDatabaseMigrations(client);

    const roles = await client.execute(
      "SELECT role_key FROM app_role ORDER BY role_key;",
    );
    expect(roles.rows.map((row) => String(row.role_key))).toEqual([
      "admin",
      "operator",
      "scanner",
      "superadmin",
    ]);

    const operator = await client.execute(`
      SELECT m.kode_operator, r.role_key
      FROM master_operator m
      JOIN app_role r ON r.id = m.role_id
      WHERE m.kode_operator = 'OP001';
    `);
    expect(operator.rows[0]).toMatchObject({
      kode_operator: "OP001",
      role_key: "admin",
    });

    const permissionCount = await client.execute(`
      SELECT COUNT(*) AS total
      FROM role_permission rp
      JOIN app_role r ON r.id = rp.role_id
      WHERE r.role_key = 'scanner' AND rp.is_allowed = 1;
    `);
    expect(Number(permissionCount.rows[0]?.total)).toBe(3);

    const migrations = await client.execute(
      "SELECT version FROM schema_migration ORDER BY version;",
    );
    expect(migrations.rows.map((row) => Number(row.version))).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21,
      22, 23, 24, 25,
      // v26 — tabel PMB, dipakai situs publik `web-public`.
      26,
      // v27 — portal wali murid, dipakai situs publik `web-public`.
      27,
      // v28 — modul nilai akademik (tabel TERSINKRONISASI pertama sejak Fase 4).
      28,
      // v29 — unit satuan pendidikan: tabel `akademik_unit` dan kolom
      // `master_data.unit`, sumber dropdown Unit di formulir peserta didik,
      // guru/PTK, dan karyawan.
      29,
      // v30 — kredensial portal wali murid: tabel `wali_kredensial` (cloud-only)
      // untuk autentikasi kata sandi dan manajemen akun wali di panel admin.
      30,
      // v31 — CMS landing page: tabel `berita` dan `konten_publik` (cloud-only)
      // untuk pengelolaan konten dan artikel sekolah di situs publik.
      31,
      // v32 — foto profil personil: tabel `personil_foto` berkunci
      // `master_data.id_unik`, melayani guru, siswa, dan karyawan sekaligus
      // serta mengisi elemen foto pada kartu identitas.
      32,
      // v33 — riwayat penggantian identitas karyawan (khusus cloud).
      33,
      // v34 — klaim pengiriman WhatsApp antar-pengirim.
      34,
      // v35 — inventaris: `inventory_barang`, `inventory_mutasi`, view saldo.
      35,
      // v36 — Buku Kunjungan UKS (`uks_kunjungan`, di luar snapshot).
      36,
      // v37 — registri aset per unit (`inventory_unit`).
      37,
    ]);

    const sessionColumns = await client.execute(
      "PRAGMA table_info(app_session);",
    );
    expect(sessionColumns.rows.map((row) => String(row.name))).toEqual(
      expect.arrayContaining([
        "session_id",
        "token_hash",
        "operator_id",
        "expires_at",
        "revoked_at",
      ]),
    );
  });

  test("permission khusus Superadmin tidak masuk default role lain", () => {
    for (const permissions of Object.values(DEFAULT_ROLE_PERMISSIONS)) {
      expect(
        permissions.some((permission) =>
          SUPERADMIN_ONLY_PERMISSIONS.has(permission),
        ),
      ).toBe(false);
    }
  });

  // Seed Admin di `turso.rs` dulu memberi semua izin kecuali dua, termasuk
  // seluruh izin sensitif, pada database yang diprovisioning Desktop/Mobile.
  test("pengecualian seed Admin di Rust sama dengan paket bawaan TS", async () => {
    const workspace = fileURLToPath(new URL("../../../", import.meta.url));
    const kandidat = [
      `${workspace}src-tauri/src/desktop/turso.rs`,
      `${workspace}src-tauri/src/mobile/turso.rs`,
    ];
    let sumber = "";
    for (const path of kandidat) {
      const file = Bun.file(path);
      if (await file.exists()) sumber = await file.text();
    }
    const blok = sumber.match(
      /ADMIN_DEFAULT_EXCLUDED_PERMISSIONS: &\[&str\] = &\[([\s\S]*?)\];/,
    )?.[1];
    expect(blok).toBeDefined();
    const rust = [...(blok ?? "").matchAll(/"([^"]+)"/g)]
      .map((m) => m[1])
      .sort();
    const admin = new Set<string>(DEFAULT_ROLE_PERMISSIONS.admin);
    const ts = PERMISSION_CATALOG.map(({ key }) => key)
      .filter((key) => !admin.has(key))
      .sort();
    expect(rust).toEqual(ts);
    expect(rust).toEqual(
      [
        ...SUPERADMIN_ONLY_PERMISSIONS,
        "diagnostics.view",
        ...SENSITIVE_MUTATION_PERMISSIONS,
      ].sort(),
    );
  });

  test("sakelar keamanan absensi role bertahan saat dibuat dan disunting", async () => {
    // Body persis seperti kiriman dialog Role di halaman Operator. Dulu parser
    // route membuang kedua sakelar absensi, jadi setiap simpan menulis 0.
    const actor = await client.execute(
      "SELECT id FROM master_operator WHERE kode_operator = 'OP001';",
    );
    const actorId = Number(actor.rows[0]?.id);
    const { id } = await insertRole(
      client,
      actorId,
      parseRoleDraft({
        name: "Piket Gerbang",
        status: "Aktif",
        requireTotp: true,
        requireScanPhoto: true,
        requireScanIpAllowlist: true,
      }),
    );
    const flags = async (roleId: number) => {
      const role = (await listRoles(client)).find((item) => item.id === roleId);
      return [
        role?.requireTotp,
        role?.requireScanPhoto,
        role?.requireScanIpAllowlist,
      ];
    };
    expect(await flags(id)).toEqual([true, true, true]);

    await editRole(
      client,
      id,
      parseRoleDraft({
        name: "Piket Gerbang",
        status: "Aktif",
        requireTotp: false,
        requireScanPhoto: true,
        requireScanIpAllowlist: false,
      }),
    );
    expect(await flags(id)).toEqual([false, true, false]);

    const superadmin = (await listRoles(client)).find(
      (role) => role.isSuperadmin,
    );
    if (!superadmin) throw new Error("Role Superadmin tidak ada.");
    await editRole(
      client,
      superadmin.id,
      parseRoleDraft({ requireScanPhoto: true, requireScanIpAllowlist: true }),
    );
    expect((await flags(superadmin.id)).slice(1)).toEqual([true, true]);
  });
});

describe("password hashing", () => {
  test("memverifikasi PBKDF2 dan mengenali password legacy", async () => {
    const password = "PasswordAman2026";
    const stored = await hashPassword(password);

    expect(await verifyPassword(password, stored)).toEqual({
      valid: true,
      needsUpgrade: false,
    });
    expect((await verifyPassword("PasswordSalah1", stored)).valid).toBe(false);
    expect(await verifyPassword("legacy-password", "legacy-password")).toEqual({
      valid: true,
      needsUpgrade: true,
    });
    const upgraded = await hashVerifiedPasswordForUpgrade("legacy-password");
    expect(await verifyPassword("legacy-password", upgraded)).toEqual({
      valid: true,
      needsUpgrade: false,
    });
  }, 45000);
});

describe("provisioning silang Web dan Desktop/Mobile", () => {
  test("migrasi menambal kolom yang hanya dibuat jalur Rust", async () => {
    // Database yang lahir dari jalur Web versi lama: tabel tarif tanpa
    // `created_at`, padahal seed dan bootstrap dari Desktop/Mobile memakainya.
    const legacyClient = createClient({ url: "file::memory:" });
    try {
      await legacyClient.execute(`
        CREATE TABLE tax_rules (
          id TEXT PRIMARY KEY,
          category TEXT NOT NULL,
          bracket_min INTEGER NOT NULL,
          bracket_max INTEGER,
          rate_percentage REAL NOT NULL,
          effective_date TEXT NOT NULL
        );
      `);
      await initDatabaseSchema(legacyClient);

      const info = await legacyClient.execute("PRAGMA table_info(tax_rules);");
      const columns = info.rows.map((row) => String(row.name));
      expect(columns).toContain("created_at");
    } finally {
      legacyClient.close();
    }
  }, 20000);

  test("semua ALTER ADD COLUMN memakai default konstan", async () => {
    // SQLite menolak `ADD COLUMN ... DEFAULT (datetime('now'))`; hanya
    // `CREATE TABLE` yang boleh memakai default non-konstan. Aturan ini pernah
    // membuat seluruh migrasi Web gagal di tengah jalan.
    const source = await Bun.file(
      fileURLToPath(new URL("../db-migrations.ts", import.meta.url)),
    ).text();
    const offenders = [
      ...source.matchAll(/ADD COLUMN[^"']*DEFAULT\s*\(([^)]*)\)/gi),
    ].map((match) => match[0]);
    expect(offenders).toEqual([]);
  });
});

describe("production schema initialization", () => {
  test("tidak membuat operator default legacy", async () => {
    const productionClient = createClient({ url: "file::memory:" });
    try {
      await initDatabaseSchema(productionClient);
      const operators = await productionClient.execute(
        "SELECT COUNT(*) AS total FROM master_operator;",
      );
      expect(Number(operators.rows[0]?.total)).toBe(0);
    } finally {
      productionClient.close();
    }
  });
});
