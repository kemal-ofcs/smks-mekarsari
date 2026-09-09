import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { type Client, createClient } from "@libsql/client";
import { initDatabaseSchema } from "@/lib/db-schema";

// Modul ini ditandai `server-only`, penanda build Next.js yang tidak dapat
// di-resolve runner test. Pola yang sama dipakai `password-reset-audit.test.ts`.
mock.module("server-only", () => ({}));

const client: Client = createClient({ url: "file::memory:" });

// Layanan dasbor memakai klien tingkat modul, bukan parameter. Mock ini
// mengarahkannya ke database sementara supaya query-nya benar-benar DIJALANKAN
// terhadap skema cloud asli yang dibangun `initDatabaseSchema`.
mock.module("@/lib/db", () => ({
  db: client,
  ensureDbInitialized: async () => {},
}));

const { getAttendanceDashboardMetrics } = await import(
  "@/lib/services/attendance-dashboard"
);

const TANGGAL_UJI = "2026-09-07";

/**
 * Vektor data ini IDENTIK dengan `metrik_dasbor_dihitung_dari_data_nyata` di
 * `src-tauri/src/desktop/attendance_dashboard.rs`, dan angka yang diharapkan
 * juga sama persis.
 *
 * Dasbor punya DUA implementasi terpisah: Rust membaca SQLite lokal untuk
 * Desktop/Mobile, TypeScript membaca Turso untuk Web. Keduanya menjawab
 * pertanyaan yang sama, jadi satu-satunya cara menjaga keduanya tidak menyimpang
 * adalah menguji dengan data yang sama dan menuntut jawaban yang sama — pola
 * yang sudah dipakai `totp`, `ip-allowlist`, dan `holiday-whitelist`.
 *
 * `audit:sql` sudah memastikan query-nya sah terhadap skema; yang ini
 * memastikan ARITMETIKANYA benar. Keduanya diperlukan: sebuah query yang sah
 * tetap bisa menghitung orang yang sama dua kali.
 */
async function seedDataUji() {
  await client.batch(
    [
      `INSERT INTO akademik_tahun_ajaran (
         id_tahun_ajaran, nama_tahun, semester, tanggal_mulai, tanggal_selesai,
         is_aktif, created_at, updated_at
       ) VALUES ('ta_2026', '2026/2027', 'Ganjil', '2026-07-01', '2026-12-31', 1,
                 '2026-07-01', '2026-07-01');`,

      `INSERT INTO akademik_rombel (
         id_rombel, id_tahun_ajaran, tingkat, nama_rombel, kapasitas, is_aktif
       ) VALUES ('rombel_10a', 'ta_2026', 10, 'X-A', 36, 1);`,

      // sis_01 ditandai lewat `jenis_personil`, sis_02 hanya lewat
      // `jabatan_status` — baris kedua membuktikan cabang OR predikat siswa
      // benar-benar terpakai, sama seperti di tes Rust.
      `INSERT INTO master_data (
         id_unik, kode_karyawan, nama, divisi, jabatan_status, jenis_personil,
         id_shift, status_aktif, tanggal_daftar
       ) VALUES
         ('sis_01', 'S-01', 'Siti Rahma', 'Peserta Didik', NULL, 'Siswa',
          1, 'Aktif', '2026-07-01'),
         ('sis_02', 'S-02', 'Ahmad Fadil', 'Peserta Didik', 'Siswa', NULL,
          1, 'Aktif', '2026-07-01'),
         ('gur_01', 'G-01', 'Budi Santoso', 'Kurikulum', 'Guru Mapel', 'Guru',
          1, 'Aktif', '2026-07-01'),
         ('gur_02', 'G-02', 'Rina Lestari', 'Kurikulum', 'Guru Mapel', 'Guru',
          1, 'Nonaktif', '2026-07-01');`,

      `INSERT INTO siswa_data (
         id_siswa, nis, nisn, nama_lengkap, jenis_kelamin, id_rombel, angkatan,
         status, created_at, updated_at
       ) VALUES
         ('sis_01', '1001', '00123', 'Siti Rahma', 'P', 'rombel_10a', 2026,
          'Aktif', '2026-07-01', '2026-07-01'),
         ('sis_02', '1002', '00124', 'Ahmad Fadil', 'L', 'rombel_10a', 2026,
          'Aktif', '2026-07-01', '2026-07-01');`,

      // sis_01 punya DUA sesi pada hari yang sama. Tanpa agregasi
      // `GATE_SUMMARY_SUBQUERY`, satu orang itu terhitung hadir dua kali.
      `INSERT INTO absensi_harian (
         tanggal, id_karyawan, nama, kelas_divisi, jam_masuk, jam_pulang,
         status_kehadiran, status_absen, sumber, update_terakhir,
         menit_terlambat, id_shift, bulan, tahun, id_sesi
       ) VALUES
         ('2026-09-07', 'sis_01', 'Siti Rahma', 'X-A', '07:05', '',
          'Hadir', 'Masuk', 'Scanner', '2026-09-07 07:05:00',
          5, 1, '09', 2026, 'sesi_sis01_a'),
         ('2026-09-07', 'sis_01', 'Siti Rahma', 'X-A', '', '15:00',
          'Hadir', 'Pulang', 'Scanner', '2026-09-07 15:00:00',
          0, 1, '09', 2026, 'sesi_sis01_b'),
         ('2026-09-07', 'gur_01', 'Budi Santoso', 'Kurikulum', '06:50', '16:00',
          'Hadir', 'Masuk', 'Scanner', '2026-09-07 06:50:00',
          0, 1, '09', 2026, 'sesi_gur01_a');`,

      `INSERT INTO presensi_mapel (
         id_presensi_mapel, id_tahun_ajaran, id_rombel, id_mapel, id_guru,
         tanggal, jam_ke, total_hadir, total_alfa, created_at, updated_at
       ) VALUES ('pm_01', 'ta_2026', 'rombel_10a', 'mapel_mtk', 'gur_01',
                 '2026-09-07', '3', 0, 1, '2026-09-07', '2026-09-07');`,

      `INSERT INTO presensi_mapel_detail (
         id_detail, id_presensi_mapel, id_siswa, status, created_at, updated_at
       ) VALUES ('pmd_01', 'pm_01', 'sis_01', 'Alfa', '2026-09-07', '2026-09-07');`,
    ],
    "write",
  );
}

beforeAll(async () => {
  await initDatabaseSchema(client);
  await seedDataUji();
});

afterAll(() => client.close());

describe("Dasbor Audit Kehadiran (jalur Web)", () => {
  test("metrik dihitung sama persis dengan implementasi Rust", async () => {
    const hasil = await getAttendanceDashboardMetrics({
      tanggal: TANGGAL_UJI,
    });

    expect(hasil.tanggal).toBe(TANGGAL_UJI);

    // sis_01 (lewat `jenis_personil`) + sis_02 (lewat `jabatan_status`) = 2.
    expect(hasil.siswa.total).toBe(2);
    // sis_01 punya dua baris absensi hari itu, tetapi tetap satu orang hadir.
    expect(hasil.siswa.hadir).toBe(1);
    expect(hasil.siswa.terlambat).toBe(1);
    expect(hasil.siswa.persentase).toBe(50);

    // gur_02 berstatus Nonaktif sehingga tidak ikut terhitung.
    expect(hasil.guru.total).toBe(1);
    expect(hasil.guru.hadir).toBe(1);
    expect(hasil.guru.persentase).toBe(100);

    expect(hasil.rekapRombel).toHaveLength(1);
    expect(hasil.rekapRombel[0]?.nama_rombel).toBe("X-A");
    expect(hasil.rekapRombel[0]?.total_siswa).toBe(2);
    expect(hasil.rekapRombel[0]?.hadir).toBe(1);

    expect(hasil.rekapGuru).toHaveLength(1);
    // Namanya dibaca dari `master_data.nama`; alias `nama_lengkap` adalah
    // kontrak JSON ke UI dan wajib tetap terisi.
    expect(hasil.rekapGuru[0]?.nama_lengkap).toBe("Budi Santoso");
    expect(hasil.rekapGuru[0]?.jabatan).toBe("Guru Mapel");
    expect(hasil.rekapGuru[0]?.jam_masuk).toBe("06:50");

    // sis_01 tercatat masuk gerbang tetapi ditandai Alfa di presensi mapel.
    expect(hasil.anomaliBolos).toBe(1);
  });

  test("tanggal tanpa data menghasilkan nol, bukan error", async () => {
    const hasil = await getAttendanceDashboardMetrics({
      tanggal: "2026-09-06",
    });
    expect(hasil.siswa.hadir).toBe(0);
    expect(hasil.siswa.persentase).toBe(0);
    expect(hasil.anomaliBolos).toBe(0);
    // Total personil tidak bergantung tanggal, jadi tetap terisi.
    expect(hasil.siswa.total).toBe(2);
    expect(hasil.guru.total).toBe(1);
  });
});
