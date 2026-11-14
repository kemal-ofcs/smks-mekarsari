import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Client, createClient } from "@libsql/client";
import { initDatabaseSchema } from "@/lib/db-schema";

mock.module("server-only", () => ({}));

const S = await import("./hr-beban");

// Jalur Web rekap beban mengajar (HRIS Fase 3a) pada skema Web sungguhan.
// Pasangan Rust: `hr_beban_teaching_load_semester_dan_tugas` di
// `hr_beban.rs`, dengan data yang sama. Satu klien per berkas.
let client: Client;
let testDirectory: string;

beforeAll(async () => {
  testDirectory = mkdtempSync(join(tmpdir(), "kos-beban-"));
  client = createClient({ url: `file:${join(testDirectory, "test.db")}` });
  await initDatabaseSchema(client);
  await client.batch(
    [
      "INSERT INTO akademik_tahun_ajaran (id_tahun_ajaran, nama_tahun, semester, tanggal_mulai, tanggal_selesai, is_aktif, created_at, updated_at) VALUES ('ta-lama', '2025/2026', 'Genap', '2026-01-05', '2026-06-20', 0, 'x', 'x'), ('ta-kini', '2026/2027', 'Ganjil', '2026-07-13', '2026-12-19', 1, 'x', 'x');",
      "INSERT INTO akademik_unit (id_unit, nama_unit, created_at, updated_at) VALUES ('u-smp', 'SMP', 'x', 'x');",
      "INSERT INTO akademik_rombel (id_rombel, id_tahun_ajaran, tingkat, nama_rombel, id_wali_kelas, id_unit) VALUES ('R7A', 'ta-kini', 7, '7A', 'G1', 'u-smp'), ('R7B', 'ta-kini', 7, '7B', 'G1', 'u-smp'), ('R6A', 'ta-lama', 6, '6A', 'G2', NULL);",
      "INSERT INTO akademik_mapel (id_mapel, kode_mapel, nama_mapel, beban_jam) VALUES ('MTK', 'MTK', 'Matematika', 4);",
      "INSERT INTO master_data (id_unik, kode_karyawan, nama, divisi, id_shift, status_aktif, jenis_personil) VALUES ('G1', 'G1', 'Ani', 'Guru', 999, 'Aktif', 'GURU'), ('G2', 'G2', 'Budi', 'Guru', 999, 'Nonaktif', 'GURU'), ('G3', 'G3', 'Cici', 'Guru', 999, 'Nonaktif', 'GURU');",
      "INSERT INTO guru_data (id_guru, nip, created_at, updated_at) VALUES ('G1', '1985', 'x', 'x'), ('G2', '', 'x', 'x'), ('G3', '', 'x', 'x');",
      "INSERT INTO jadwal_mengajar (id_jadwal, id_tahun_ajaran, id_rombel, id_mapel, id_guru, hari, jam_ke, is_aktif, created_at, updated_at) VALUES ('J10', 'ta-kini', 'R7A', 'MTK', 'G1', 1, '10', 1, 'x', 'x'), ('J2', 'ta-kini', 'R7A', 'MTK', 'G1', 1, '2', 1, 'x', 'x'), ('J9', 'ta-lama', 'R7A', 'MTK', 'G1', 1, '3', 1, 'x', 'x'), ('JN', 'ta-kini', 'R7B', 'MTK', 'G2', 2, '1', 1, 'x', 'x'), ('JX', 'ta-kini', 'R7B', 'MTK', 'G1', 2, '5', 0, 'x', 'x');",
      "INSERT INTO akademik_guru_mapel (id_penugasan, id_tahun_ajaran, id_rombel, id_mapel, id_guru) VALUES ('P1', 'ta-kini', 'R7A', 'MTK', 'G1'), ('P9', 'ta-lama', 'R7A', 'MTK', 'G1');",
      "INSERT OR REPLACE INTO hr_tugas_jenis (id_jenis, nama, ekuivalen_jp) VALUES ('tgs-pembina-ekskul', 'Pembina Ekstrakurikuler', 2), ('tgs-wali-kelas', 'Wali Kelas', 2), ('tgs-kalab', 'Kepala Laboratorium', 12), ('tgs-piket', 'Guru Piket', 1);",
      "INSERT INTO hr_tugas_tambahan (id_tugas, id_karyawan, id_jenis, tahun_ajaran, id_rombel, ekuivalen_jp, tanggal_mulai, tanggal_selesai, dibatalkan_pada) VALUES ('t-ekskul-1', 'G1', 'tgs-pembina-ekskul', '2026/2027', NULL, NULL, '2026-07-13', NULL, NULL), ('t-ekskul-2', 'G1', 'tgs-pembina-ekskul', '2026/2027', NULL, 3, '2026-09-01', '2026-12-19', NULL), ('t-batal', 'G1', 'tgs-piket', '2026/2027', NULL, NULL, '2026-07-13', NULL, '2026-08-01 00:00:00'), ('t-lalu', 'G1', 'tgs-kalab', '2025/2026', NULL, NULL, '2026-01-05', '2026-06-20', NULL), ('t-wali', 'G1', 'tgs-wali-kelas', '2026/2027', NULL, 3, '2026-07-13', NULL, NULL), ('t-wali-7a', 'G1', 'tgs-wali-kelas', '2026/2027', 'R7A', 3, '2026-07-13', NULL, NULL);",
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

describe("hr-beban: getBebanMengajar (database Web)", () => {
  test("semester aktif, tugas berlaku per baris, batas bawaan", async () => {
    const v = await S.getBebanMengajar(client, "");
    expect(v.id_tahun_ajaran).toBe("ta-kini");
    expect(v.guru.map((g) => g.id_unik)).toEqual(["G1", "G2"]);
    expect(v.guru.map((g) => g.aktif)).toEqual([1, 0]);
    expect(v.jadwal.map((j) => j.id_jadwal)).toEqual(["J2", "J10", "JN"]);
    expect(v.jadwal[0].unit).toBe("SMP");
    expect(v.penugasan.map((p) => [p.id_guru, p.beban_jam])).toEqual([
      ["G1", 4],
    ]);
    expect(v.tugas.map((t) => [t.id_tugas, t.ekuivalen_jp])).toEqual([
      ["t-ekskul-1", 2],
      ["t-ekskul-2", 3],
      ["wali:R7A", 3],
      ["wali:R7B", 2],
    ]);
    expect(v.batas).toEqual({ min: 24, maks: 40 });
    expect(v.semester.map((s) => s.id_tahun_ajaran)).toEqual([
      "ta-kini",
      "ta-lama",
    ]);
  });

  test("semester lain dan semester tak dikenal", async () => {
    const lama = await S.getBebanMengajar(client, "ta-lama");
    expect(lama.jadwal.map((j) => j.id_jadwal)).toEqual(["J9"]);
    expect(lama.tugas.map((t) => t.id_tugas)).toEqual(["t-lalu", "wali:R6A"]);
    await expect(S.getBebanMengajar(client, "ta-hilang")).rejects.toThrow(
      "Semester tidak ditemukan.",
    );
  });
});
