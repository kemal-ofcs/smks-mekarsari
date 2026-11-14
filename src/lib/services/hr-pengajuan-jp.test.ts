import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Client, createClient } from "@libsql/client";
import type { OperatorUser } from "@/lib/auth/operator-user";
import { initDatabaseSchema } from "@/lib/db-schema";
import { hariIso } from "@/lib/validations/hari-kerja";
import {
  PESAN_BENTROK_PENGGANTI,
  PESAN_CAKUPAN_JP,
  PESAN_JP_SENDIRI,
  tambahHari,
} from "@/lib/validations/hr-pengajuan";

mock.module("server-only", () => ({}));

const S = await import("./hr-pengajuan");

// HRIS 2c pada skema Web sungguhan: JP terdampak, penanganan (cakupan unit JP,
// bukan JP sendiri, upsert atas id deterministik), dan JP yang digantikan.
// Tanggalnya hari ini WIB karena Jam Kosong dan "JP saya" memakai hari ini.
let client: Client;
let testDirectory: string;
let hariIni: string;

const operator = (
  idKaryawan: string | null,
  permissions: string[],
): OperatorUser => ({
  id: 1,
  kode_operator: "OP",
  nama_operator: "uji",
  username: `uji-${idKaryawan ?? "x"}`,
  role: "Uji",
  roleId: 9,
  roleKey: "uji",
  isSuperadmin: false,
  permissions: permissions as OperatorUser["permissions"],
  permissionRevision: 1,
  idKaryawan,
});
const KELOLA = ["hr.substitute.manage", "hr.request.view"];

const galat = async (janji: Promise<unknown>) => {
  try {
    await janji;
    return null;
  } catch (error) {
    return (error as Error).message;
  }
};

beforeAll(async () => {
  testDirectory = mkdtempSync(join(tmpdir(), "kos-pengajuan-2c-"));
  client = createClient({ url: `file:${join(testDirectory, "test.db")}` });
  await initDatabaseSchema(client);
  hariIni = String(
    (await client.execute("SELECT date('now', '+7 hours') AS t")).rows[0].t,
  );
  const hari = hariIso(hariIni);
  const ta = [tambahHari(hariIni, -30), tambahHari(hariIni, 30)];
  const lama = [tambahHari(hariIni, -300), tambahHari(hariIni, -200)];
  await client.batch(
    [
      "INSERT INTO akademik_unit (id_unit, nama_unit, created_at, updated_at) VALUES ('u-smp', 'SMP', 'x', 'x'), ('u-sd', 'SD', 'x', 'x');",
      `INSERT INTO akademik_tahun_ajaran (id_tahun_ajaran, nama_tahun, semester, tanggal_mulai, tanggal_selesai, is_aktif, created_at, updated_at) VALUES ('ta-kini', 'kini', 'Ganjil', '${ta[0]}', '${ta[1]}', 1, 'x', 'x'), ('ta-lama', 'lama', 'Genap', '${lama[0]}', '${lama[1]}', 0, 'x', 'x');`,
      "INSERT INTO akademik_rombel (id_rombel, id_tahun_ajaran, tingkat, nama_rombel, id_unit) VALUES ('R7A', 'ta-kini', 7, 'VII A', 'u-smp');",
      "INSERT INTO tbl_shift (id_shift, kode_shift, nama_shift, jam_masuk, jam_pulang, jam_kerja_normal_menit, hari_kerja) VALUES (91, 91, 'Uji', '07:00', '15:00', 420, '1,2,3,4,5,6,7');",
      "INSERT INTO master_data (id_unik, kode_karyawan, nama, divisi, jabatan_status, id_shift, status_aktif, jenis_personil, unit) VALUES ('G1', 'G1', 'Guru Satu', 'Guru', 'Guru', 91, 'Aktif', 'GURU', 'SMP'), ('G2', 'G2', 'Guru Dua', 'Guru', 'Guru', 91, 'Aktif', 'GURU', 'SMP'), ('G3', 'G3', 'Guru Piket', 'Guru', 'Guru', 91, 'Aktif', 'GURU', 'SMP'), ('G4', 'G4', 'Piket SD', 'Guru', 'Guru', 91, 'Aktif', 'GURU', 'SD');",
      "INSERT INTO guru_data (id_guru, created_at, updated_at) VALUES ('G1', 'x', 'x'), ('G2', 'x', 'x'), ('G3', 'x', 'x'), ('G4', 'x', 'x');",
      `INSERT INTO jadwal_mengajar (id_jadwal, id_tahun_ajaran, id_rombel, id_mapel, id_guru, hari, jam_ke, is_aktif, created_at, updated_at) VALUES
        ('J1', 'ta-kini', 'R7A', 'MTK', 'G1', ${hari}, '3-4', 1, 'x', 'x'),
        ('J9', 'ta-lama', 'R7A', 'MTK', 'G1', ${hari}, '5', 1, 'x', 'x'),
        ('J2', 'ta-kini', 'R7A', 'IPA', 'G2', ${hari}, '4', 1, 'x', 'x');`,
      `INSERT INTO hr_pengajuan (id_pengajuan, id_karyawan, id_jenis, kelompok, potong_jatah, dampak_gaji, izin_pemutus, tanggal_mulai, tanggal_selesai, jam_mulai_ke, setengah_hari, alasan, sidik, diajukan_oleh, waktu_perangkat) VALUES
        ('pgn-1', 'G1', 'jns-sakit', 'Sakit', 0, 'Dibayar', 'hr.request.decide', '${hariIni}', '${hariIni}', 4, 0, 'demam', 's1', 'tu', 'x'),
        ('pgn-2', 'G2', 'jns-sakit', 'Sakit', 0, 'Dibayar', 'hr.request.decide', '${hariIni}', '${hariIni}', NULL, 0, 'demam', 's2', 'tu', 'x');`,
      "INSERT INTO hr_pengajuan_keputusan (id_keputusan, id_pengajuan, jenis, sidik, oleh, waktu_perangkat, diterima_cloud) VALUES ('k2', 'pgn-2', 'Tolak', 's2', 'kepsek', 'x', 'x');",
    ],
    "write",
  );
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

describe("hr-pengajuan 2c: JP terdampak dan pengganti", () => {
  test("Menunggu ikut, Ditolak dan semester lama tidak; hitungan di daftar", async () => {
    const jp = await S.jpTerdampakBaca(
      client,
      operator("G3", KELOLA),
      null,
      null,
      null,
    );
    expect(jp.jp.map((j) => j.id_penanganan)).toEqual([
      `jp:pgn-1:${hariIni}:J1`,
    ]);
    expect(jp.jp[0].unit).toBe("SMP");
    expect(jp.jp[0].penanganan).toBeNull();
    const daftar = await S.daftarPengajuan(
      client,
      operator("G3", KELOLA),
      tambahHari(hariIni, -1),
      tambahHari(hariIni, 1),
    );
    expect(daftar.jp["pgn-1"]).toEqual({ total: 1, belum: 1 });
  });

  test("cakupan unit JP, bukan JP sendiri, pengganti bukan guru asli", async () => {
    const draft = {
      id_pengajuan: "pgn-1",
      tanggal: hariIni,
      id_jadwal: "J1",
      status: "Diganti" as const,
      id_guru_pengganti: "G2",
    };
    expect(
      await galat(S.simpanPenanganan(client, operator("G4", KELOLA), draft)),
    ).toBe(PESAN_CAKUPAN_JP);
    expect(
      await galat(S.simpanPenanganan(client, operator(null, KELOLA), draft)),
    ).toBe(PESAN_CAKUPAN_JP);
    expect(
      await galat(S.simpanPenanganan(client, operator("G1", KELOLA), draft)),
    ).toBe(PESAN_JP_SENDIRI);
    expect(
      await galat(
        S.simpanPenanganan(client, operator("G3", KELOLA), {
          ...draft,
          id_guru_pengganti: "G1",
        }),
      ),
    ).toBe("Guru pengganti tidak boleh guru yang berhalangan.");
    expect(
      await galat(
        S.simpanPenanganan(client, operator("G3", KELOLA), {
          ...draft,
          id_jadwal: "J9",
        }),
      ),
    ).toBe("Jam pelajaran itu tidak (lagi) terdampak pengajuan ini.");
  });

  test("upsert atas id deterministik, bentrok jadi peringatan, JP saya", async () => {
    const piket = operator("G3", KELOLA);
    const dasar = { id_pengajuan: "pgn-1", tanggal: hariIni, id_jadwal: "J1" };
    const mandiri = await S.simpanPenanganan(client, piket, {
      ...dasar,
      status: "Tugas Mandiri",
      id_guru_pengganti: "G2",
    });
    expect(mandiri.penanganan.id_guru_pengganti).toBe("");
    expect(mandiri.peringatan).toBeNull();
    // G2 sendiri mengajar jam ke-4 hari ini: tetap tersimpan, dengan peringatan.
    const diganti = await S.simpanPenanganan(client, piket, {
      ...dasar,
      status: "Diganti",
      id_guru_pengganti: "G2",
    });
    expect(diganti.peringatan).toBe(PESAN_BENTROK_PENGGANTI);
    const baris = await client.execute(
      "SELECT status, id_guru_pengganti FROM hr_jp_penanganan",
    );
    expect(baris.rows.map((r) => [r.status, r.id_guru_pengganti])).toEqual([
      ["Diganti", "G2"],
    ]);
    const jp = await S.jpTerdampakBaca(client, piket, "pgn-1", null, null);
    expect(jp.jp[0].penanganan?.nama_pengganti).toBe("Guru Dua");
    expect(jp.jp[0].tanda).toEqual(["pengganti_bentrok"]);

    const saya = await S.gantiSaya(
      client,
      operator("G2", ["class_attendance.view"]),
    );
    expect(saya.jp.map((j) => [j.id_rombel, j.jam_ke, j.nama_guru])).toEqual([
      ["R7A", "3-4", "Guru Satu"],
    ]);
    expect(
      (await S.gantiSaya(client, operator(null, ["class_attendance.view"]))).jp,
    ).toEqual([]);
  });
});
