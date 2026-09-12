import { describe, expect, test } from "bun:test";
import {
  buildParentNotificationText,
  buildPresentWithoutGateScanWarning,
  findPresentWithoutGateScan,
  hasUnsavedAttendanceMarks,
  hitungJp,
  jamKeBeririsan,
  normalizeJamBel,
  normalizeJamKe,
  parseJpDuration,
  parseJpMaxPerDay,
  rentangJamKe,
  susunJamKe,
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
  // Batas struktural naik ke 20: pesantren dan sekolah berasrama benar-benar
  // punya jam pelajaran sampai belasan. Jumlah yang dipakai sebuah sekolah
  // dibatasi terpisah lewat `jp_max_per_hari`.
  ["20", "20"],
  ["13-20", "13-20"],
];

const JAM_KE_DITOLAK = [
  "", // kosong
  "0", // di bawah batas
  "21", // di atas batas struktural
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

/**
 * Vektor rentang & irisan — WAJIB identik dengan
 * `rentang_jam_ke_membaca_angka_tunggal_dan_rentang` dan
 * `irisan_jam_ke_dinilai_dari_rentang_bukan_teks` di `class_attendance.rs`.
 */
const RENTANG: Array<[string, { awal: number; akhir: number } | null]> = [
  ["1", { awal: 1, akhir: 1 }],
  ["12", { awal: 12, akhir: 12 }],
  ["1-2", { awal: 1, akhir: 2 }],
  ["3 - 5", { awal: 3, akhir: 5 }],
  ["20", { awal: 20, akhir: 20 }],
  ["abc", null],
  ["2-1", null],
  ["21", null],
];

const BERIRISAN: Array<[string, string]> = [
  ["1", "1"],
  ["1-2", "2"],
  ["2", "1-2"],
  ["1-2", "2-3"],
  ["1-4", "2-3"],
  ["2-3", "1-4"],
  ["1 - 2", "1-2"],
];

const TIDAK_BERIRISAN: Array<[string, string]> = [
  ["1", "2"],
  ["1-2", "3-4"],
  ["3-4", "1-2"],
  ["1-2", "3"],
  // Nilai tidak valid tidak pernah dianggap bentrok: baris lama dengan teks
  // asing tidak boleh mengunci jadwal rombelnya.
  ["1-2", "abc"],
  ["abc", "1-2"],
  ["", "1"],
];

describe("rentangJamKe", () => {
  for (const [masukan, harapan] of RENTANG) {
    test(`membaca "${masukan}"`, () => {
      expect(rentangJamKe(masukan)).toEqual(harapan);
    });
  }
});

describe("jamKeBeririsan", () => {
  for (const [a, b] of BERIRISAN) {
    test(`"${a}" beririsan dengan "${b}"`, () => {
      expect(jamKeBeririsan(a, b)).toBe(true);
    });
  }

  for (const [a, b] of TIDAK_BERIRISAN) {
    test(`"${a}" tidak beririsan dengan "${b}"`, () => {
      expect(jamKeBeririsan(a, b)).toBe(false);
    });
  }
});

describe("hitungJp", () => {
  test("angka tunggal bernilai satu JP", () => {
    expect(hitungJp("4")).toBe(1);
  });

  test("rentang dihitung inklusif di kedua ujungnya", () => {
    // 3-5 adalah jam ke-3, ke-4, dan ke-5 — tiga JP, bukan dua. Selisih satu
    // di sini adalah selisih satu jam pelajaran pada honor guru.
    expect(hitungJp("3-5")).toBe(3);
    expect(hitungJp("1-2")).toBe(2);
  });

  test("nilai tidak valid tidak menghasilkan angka", () => {
    expect(hitungJp("abc")).toBeNull();
  });
});

describe("susunJamKe", () => {
  test("dua angka sama menjadi angka tunggal", () => {
    expect(susunJamKe(3, 3)).toBe("3");
  });

  test("dua angka berbeda menjadi rentang kanonik", () => {
    expect(susunJamKe(1, 2)).toBe("1-2");
  });

  test("urutan terbalik dan angka di luar batas ditolak", () => {
    expect(susunJamKe(2, 1)).toBeNull();
    expect(susunJamKe(0, 2)).toBeNull();
    expect(susunJamKe(1, 21)).toBeNull();
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

/**
 * Vektor pengaturan jam pelajaran — WAJIB identik dengan
 * `pengaturan_jp_jatuh_ke_bawaan_bukan_ke_nol` di `class_attendance.rs`.
 *
 * `[nilai mentah di setting_gex_system, hasil bacaan]`
 */
const VEKTOR_JP_MAX: Array<[string | null, number]> = [
  [null, 12],
  ["", 12],
  ["   ", 12],
  ["bukan angka", 12],
  ["0", 12],
  ["-3", 12],
  ["21", 12], // di atas batas struktural
  ["1", 1],
  ["8", 8],
  ["12", 12],
  ["20", 20],
  [" 10 ", 10],
];

const VEKTOR_JP_DURASI: Array<[string | null, number]> = [
  [null, 45],
  ["", 45],
  ["abc", 45],
  ["0", 45],
  ["241", 45],
  ["35", 35],
  ["40", 40],
  ["45", 45],
  ["240", 240],
];

describe("pengaturan jam pelajaran", () => {
  for (const [mentah, harapan] of VEKTOR_JP_MAX) {
    test(`jumlah per hari "${mentah}" dibaca ${harapan}`, () => {
      // Nilai cacat jatuh ke BAWAAN, bukan ke nol (setiap presensi ditolak)
      // dan bukan ke batas struktural (diam-diam melonggarkan kebijakan).
      expect(parseJpMaxPerDay(mentah)).toBe(harapan);
    });
  }

  for (const [mentah, harapan] of VEKTOR_JP_DURASI) {
    test(`durasi "${mentah}" dibaca ${harapan}`, () => {
      expect(parseJpDuration(mentah)).toBe(harapan);
    });
  }
});

/**
 * Vektor jam bel — WAJIB identik dengan `normalisasi_jam_bel_menerima_bentuk_manusia`
 * di `class_attendance.rs`.
 */
const JAM_BEL_DITERIMA: Array<[string, string]> = [
  ["07:00", "07:00"],
  ["7:0", "07:00"],
  ["7:5", "07:05"],
  ["23:59", "23:59"],
  ["00:00", "00:00"],
  [" 08 : 30 ", "08:30"],
];

const JAM_BEL_DITOLAK = [
  "",
  "0700", // tanpa titik dua
  "24:00", // jam di luar hari
  "07:60", // menit di luar jam
  "7", // tidak lengkap
  ":30",
  "07:",
  "abc:00",
  "007:00", // lebih dari dua digit
  "０7:00", // digit non-ASCII
];

describe("normalizeJamBel", () => {
  for (const [masukan, harapan] of JAM_BEL_DITERIMA) {
    test(`menerima "${masukan}" menjadi "${harapan}"`, () => {
      expect(normalizeJamBel(masukan)).toBe(harapan);
    });
  }

  for (const masukan of JAM_BEL_DITOLAK) {
    test(`menolak "${masukan}"`, () => {
      expect(normalizeJamBel(masukan)).toBeNull();
    });
  }
});
