import { describe, expect, test } from "bun:test";
import {
  buildParentNotificationText,
  buildPresentWithoutGateScanWarning,
  findPresentWithoutGateScan,
  hasUnsavedAttendanceMarks,
  normalizeJamKe,
} from "@/lib/validations/class-attendance";

/**
 * Vektor `jam_ke` — WAJIB identik dengan `normalisasi_jam_ke_menerima_angka_dan_rentang`
 * di `class_attendance.rs`. Inilah cara paritas kedua implementasi dijaga tanpa
 * bisa menjalankan Rust dari sini, pola yang sama dengan `ip-allowlist` dan `totp`.
 */
const JAM_KE_DITERIMA: [string, string][] = [
  ["1", "1"],
  ["8", "8"],
  ["12", "12"],
  ["  3  ", "3"],
  ["1-2", "1-2"],
  ["7-8", "7-8"],
  ["1 - 2", "1-2"],
  ["11-12", "11-12"],
];

const JAM_KE_DITOLAK = [
  "", // kosong
  "0", // di bawah batas
  "13", // di atas batas
  "abc", // bukan angka
  "2-1", // terbalik
  "3-3", // rentang nol
  "1-", // tidak lengkap
  "-2", // tidak lengkap
  "1-2-3", // rentang bertingkat
  "1,2", // pemisah salah
  "０", // digit non-ASCII
];

describe("normalizeJamKe", () => {
  for (const [masukan, harapan] of JAM_KE_DITERIMA) {
    test(`menerima "${masukan}" menjadi "${harapan}"`, () => {
      expect(normalizeJamKe(masukan)).toBe(harapan);
    });
  }

  for (const masukan of JAM_KE_DITOLAK) {
    test(`menolak "${masukan}"`, () => {
      expect(normalizeJamKe(masukan)).toBeNull();
    });
  }

  test("bentuk kanonik membuat dua ejaan sesi yang sama tidak lolos sebagai duplikat", () => {
    // Tanpa normalisasi sebelum pemeriksaan duplikat, "1-2" dan "1 - 2" akan
    // tersimpan sebagai dua sesi berbeda untuk jam pelajaran yang sama.
    expect(normalizeJamKe("1 - 2")).toBe(normalizeJamKe("1-2"));
  });
});

describe("peringatan Hadir tanpa scan gerbang", () => {
  const roster = [
    { nama_lengkap: "Budi", status: "Hadir", jam_masuk: "07:01" },
    { nama_lengkap: "Siti", status: "Hadir", jam_masuk: null },
    { nama_lengkap: "Andi", status: "Hadir", jam_masuk: "   " },
    { nama_lengkap: "Rina", status: "Alfa", jam_masuk: null },
    { nama_lengkap: "Doni", status: "Izin", jam_masuk: null },
  ];

  test("hanya menandai yang berstatus Hadir tanpa jam masuk", () => {
    // Rina (Alfa) dan Doni (Izin) sudah ditandai sadar oleh guru, jadi bukan
    // urusan peringatan ini. Andi berisi spasi — itu tetap berarti belum scan.
    expect(findPresentWithoutGateScan(roster)).toEqual(["Siti", "Andi"]);
  });

  test("tidak bertanya apa pun ketika semuanya wajar", () => {
    expect(
      buildPresentWithoutGateScanWarning([
        { nama_lengkap: "Budi", status: "Hadir", jam_masuk: "07:01" },
        { nama_lengkap: "Rina", status: "Alfa", jam_masuk: null },
      ]),
    ).toBeNull();
  });

  test("meringkas sisanya ketika namanya lebih dari lima", () => {
    const banyak = Array.from({ length: 8 }, (_, i) => ({
      nama_lengkap: `Siswa ${i + 1}`,
      status: "Hadir",
      jam_masuk: null,
    }));
    const pesan = buildPresentWithoutGateScanWarning(banyak) ?? "";
    expect(pesan).toContain("8 siswa");
    expect(pesan).toContain("dan 3 lainnya");
  });
});

describe("buildParentNotificationText", () => {
  const dasar = {
    nama_siswa: "Budi Santoso",
    nama_mapel: "Matematika",
    jam_ke: "1-2",
    nama_guru: "Bu Rina",
    jam_masuk_gerbang: "07:01",
  };

  test("BOLOS_DI_SEKOLAH: hadir di gerbang, Alfa di kelas", () => {
    const pesan = buildParentNotificationText({
      ...dasar,
      anomaly_type: "BOLOS_DI_SEKOLAH",
    });
    expect(pesan).toContain("hadir di gerbang sekolah (pukul 07:01)");
    expect(pesan).toContain("TIDAK HADIR (Alfa) pada Matematika jam ke-1-2");
  });

  /**
   * Regresi: kedua anomali sempat memakai kalimat yang sama, sehingga wali dari
   * siswa HADIR_TANPA_SCAN_GERBANG menerima fakta yang setiap klausanya
   * terbalik dari kejadian sebenarnya.
   */
  test("HADIR_TANPA_SCAN_GERBANG: kebalikannya, dan tidak menuduh", () => {
    const pesan = buildParentNotificationText({
      ...dasar,
      anomaly_type: "HADIR_TANPA_SCAN_GERBANG",
      jam_masuk_gerbang: null,
    });
    expect(pesan).toContain("tercatat HADIR pada Matematika jam ke-1-2");
    expect(pesan).toContain("tidak ditemukan catatan scan di gerbang");
    // Klausa milik anomali lain TIDAK BOLEH bocor ke sini.
    expect(pesan).not.toContain("TIDAK HADIR (Alfa)");
    expect(pesan).not.toContain("hadir di gerbang sekolah");
  });

  test("dua anomali menghasilkan pesan yang berbeda", () => {
    expect(
      buildParentNotificationText({
        ...dasar,
        anomaly_type: "BOLOS_DI_SEKOLAH",
      }),
    ).not.toBe(
      buildParentNotificationText({
        ...dasar,
        anomaly_type: "HADIR_TANPA_SCAN_GERBANG",
      }),
    );
  });

  test("bertahan ketika kolom pelengkapnya kosong", () => {
    const pesan = buildParentNotificationText({
      anomaly_type: "BOLOS_DI_SEKOLAH",
    });
    expect(pesan).toContain("ananda");
    expect(pesan).not.toContain("undefined");
    expect(pesan).not.toContain("null");
    expect(pesan).not.toContain("jam ke-,");
  });
});

describe("hasUnsavedAttendanceMarks", () => {
  test("roster yang belum disentuh tidak perlu ditanyakan", () => {
    // Semuanya masih di status bawaan: memuat ulang tidak kehilangan apa pun.
    expect(
      hasUnsavedAttendanceMarks([
        { nama_lengkap: "Budi", status: "Hadir" },
        { nama_lengkap: "Siti", status: "Hadir" },
      ]),
    ).toBe(false);
    expect(hasUnsavedAttendanceMarks([])).toBe(false);
  });

  test("status yang menyimpang dari bawaan dihitung sebagai pekerjaan", () => {
    for (const status of ["Izin", "Sakit", "Alfa", "Dispensasi"]) {
      expect(
        hasUnsavedAttendanceMarks([
          { nama_lengkap: "Budi", status: "Hadir" },
          { nama_lengkap: "Siti", status },
        ]),
      ).toBe(true);
    }
  });

  test("catatan yang diketik guru juga dihitung", () => {
    expect(
      hasUnsavedAttendanceMarks([
        { nama_lengkap: "Budi", status: "Hadir", catatan: "Izin ke UKS" },
      ]),
    ).toBe(true);
    // Catatan kosong atau berisi spasi bukan pekerjaan.
    expect(
      hasUnsavedAttendanceMarks([
        { nama_lengkap: "Budi", status: "Hadir", catatan: "   " },
      ]),
    ).toBe(false);
  });

  test("status kosong berarti belum ditandai, bukan penyimpangan", () => {
    expect(
      hasUnsavedAttendanceMarks([{ nama_lengkap: "Budi", status: "" }]),
    ).toBe(false);
  });
});
