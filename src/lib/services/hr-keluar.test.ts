import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Client, createClient } from "@libsql/client";
import type { OperatorUser } from "@/lib/auth/operator-user";
import { runDatabaseMigrations } from "@/lib/db-migrations";
import { initDatabaseSchema } from "@/lib/db-schema";
import type { PermissionKey } from "@/lib/rbac/catalog";
import {
  PESAN_BUTUH_SP3,
  PESAN_DI_LUAR_CAKUPAN,
  PESAN_DIRI_SENDIRI,
  PESAN_SP_DICABUT,
  type SpDraft,
} from "@/lib/validations/hr-keluar";

mock.module("server-only", () => ({}));

const S = await import("./hr-keluar");

// Jalur Web SP (HRIS Fase 4a) pada skema Web sungguhan. Pasangan Rust:
// `hr_keluar_sp_cloud` di `hr_keluar.rs`, dengan data yang sama. Satu klien
// per berkas.
let client: Client;
let testDirectory: string;

const operator = (
  username: string,
  idKaryawan: string | null,
  permissions: string[],
): OperatorUser => ({
  id: 1,
  kode_operator: username.toUpperCase(),
  nama_operator: username,
  username,
  role: "Uji",
  roleId: 9,
  roleKey: "uji",
  isSuperadmin: false,
  permissions: permissions as PermissionKey[],
  permissionRevision: 1,
  idKaryawan,
});

const kepsek = operator("kepsek", "KS", [
  "hr.warning.view",
  "hr.warning.manage",
]);
const yayasan = operator("yayasan", null, [
  "hr.warning.cancel",
  "hr.scope.all",
]);

const draft = (id: string, tingkat: SpDraft["tingkat"]): SpDraft => ({
  id_karyawan: id,
  tingkat,
  tanggal: "2026-01-10",
  pelanggaran: "Terlambat berulang",
  penanda_nama: "Kepala SMP",
  penanda_jabatan: "Kepala SMP",
  alasan_tingkat: "Pelanggaran berat",
});

const galat = async (janji: Promise<unknown>) => {
  try {
    await janji;
    return null;
  } catch (error) {
    return (error as Error).message;
  }
};

beforeAll(async () => {
  testDirectory = mkdtempSync(join(tmpdir(), "kos-keluar-"));
  client = createClient({ url: `file:${join(testDirectory, "test.db")}` });
  await initDatabaseSchema(client);
  await client.execute(
    "INSERT INTO master_data (id_unik, kode_karyawan, nama, divisi, id_shift, jenis_personil, unit, tanggal_daftar, status_aktif) VALUES ('P1', 'K1', 'Ani', 'Guru', 999, 'GURU', 'SMP', '2020-01-01', 'Aktif'), ('P2', 'K2', 'Budi', 'Guru', 999, 'GURU', 'SMA', '2020-01-01', 'Aktif'), ('KS', 'K3', 'Kepala SMP', 'Guru', 999, 'GURU', 'SMP', '2020-01-01', 'Aktif');",
  );
  // Migrasi diulang: alasan bawaan tetap sembilan.
  await runDatabaseMigrations(client);
}, 60_000);

afterAll(async () => {
  client.close();
  await Bun.sleep(50);
  try {
    rmSync(testDirectory, { recursive: true, force: true, maxRetries: 10 });
  } catch {
    // Berkas sementara Windows kadang masih terkunci; dibersihkan OS nanti.
  }
});

describe("hr-keluar: SP di database Web", () => {
  test("skema v70: alasan bawaan dan kolom id_keluar", async () => {
    const alasan = await client.execute(
      "SELECT COUNT(*) AS n FROM hr_keluar_alasan;",
    );
    expect(Number(alasan.rows[0]?.n)).toBe(9);
    const kolom = await client.execute("PRAGMA table_info(master_data);");
    expect(kolom.rows.map((r) => String(r.name))).toContain("id_keluar");
  });

  test("wewenang dari sesi, eskalasi, ubah, dan cabut sekali", async () => {
    expect(await galat(S.simpanSp(client, kepsek, draft("P2", "SP1")))).toBe(
      PESAN_DI_LUAR_CAKUPAN,
    );
    expect(await galat(S.simpanSp(client, kepsek, draft("KS", "SP1")))).toBe(
      PESAN_DIRI_SENDIRI,
    );
    expect(await galat(S.simpanSp(client, kepsek, draft("P1", "SP3")))).toBe(
      PESAN_BUTUH_SP3,
    );
    expect(
      await galat(
        S.simpanSp(client, kepsek, {
          ...draft("P1", "SP2"),
          alasan_tingkat: "",
        }),
      ),
    ).toBe("Tingkat berbeda dari usulan (SP1); alasannya wajib diisi.");

    const baru = await S.simpanSp(client, kepsek, draft("P1", "SP1"));
    const baris = (
      await client.execute({
        sql: "SELECT unit, masa_bulan, berlaku_sampai, alasan_tingkat FROM hr_sp WHERE id_sp = ?;",
        args: [baru.id_sp],
      })
    ).rows[0];
    expect([
      baris?.unit,
      Number(baris?.masa_bulan),
      baris?.berlaku_sampai,
      baris?.alasan_tingkat,
    ]).toEqual(["SMP", 6, "2026-07-09", null]);

    expect(
      await galat(
        S.simpanSp(client, kepsek, {
          ...draft("P1", "SP2"),
          id_sp: baru.id_sp,
        }),
      ),
    ).toStartWith("Tingkat dan tanggal SP");
    const ubah: SpDraft = {
      ...draft("P1", "SP1"),
      id_sp: baru.id_sp,
      nomor: "001/SP/SMP/I/2026",
    };
    expect((await S.simpanSp(client, kepsek, ubah)).nomor_kembar).toBe(false);

    const daftar = await S.daftarSp(client, "P1");
    expect(daftar.sp).toHaveLength(1);
    expect(daftar.sp[0]?.nomor).toBe("001/SP/SMP/I/2026");
    expect(daftar.masa_bulan).toBe(6);

    expect(await galat(S.cabutSp(client, yayasan, baru.id_sp, " "))).toBe(
      "Alasan pencabutan wajib diisi.",
    );
    await S.cabutSp(client, yayasan, baru.id_sp, "Salah orang");
    expect(await galat(S.cabutSp(client, yayasan, baru.id_sp, "Lagi"))).toBe(
      PESAN_SP_DICABUT,
    );
    expect(await galat(S.simpanSp(client, kepsek, ubah))).toBe(
      PESAN_SP_DICABUT,
    );
    const sesudah = await S.daftarSp(client, "P1");
    expect(sesudah.sp[0]?.status).toBe("Dicabut");
    expect(sesudah.usulan.tingkat).toBe("SP1");
  });
});
