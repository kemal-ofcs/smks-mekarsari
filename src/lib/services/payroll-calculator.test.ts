import { describe, expect, mock, test } from "bun:test";

// `payroll-calculator.ts` menarik `server-only`; tes ini murni aritmetika.
mock.module("server-only", () => ({}));

/**
 * Vektor yang SAMA dieja di `payroll/engine.rs` (`mod tests`).
 *
 * Uang dihitung dua kali di repo ini — Rust untuk Desktop/Mobile, TypeScript
 * untuk Web — dan keduanya menulis ke `payroll_items` yang sama. Yang menjaga
 * keduanya tetap sepakat bukan komentar, melainkan vektor ini. Menambah kasus
 * di satu sisi tanpa sisi lain akan membuat salah satunya diam-diam menyimpang,
 * dan bentuk penyimpangannya adalah selisih rupiah di slip gaji orang.
 *
 * Empat kasus pertama adalah titik tengah sejati: `menit x tarif` habis dibagi
 * 30 tetapi tidak habis dibagi 60, sehingga nilainya tepat setengah rupiah. Di
 * sanalah kebijakan pembulatan benar-benar diuji, dan di sanalah urutan
 * bagi-lalu-kali yang lama selalu membulatkan ke BAWAH.
 */
const VEKTOR: Array<[menit: number, tarif: number, upah: number]> = [
  [11, 18750, 3438],
  [9, 18750, 2813],
  [7, 18750, 2188],
  [13, 18750, 4063],
  [60, 25000, 25000],
  [30, 25000, 12500],
  [0, 25000, 0],
  [480, 18750, 150000],
  [10080, 21875, 3675000],
];

/** Cerminan `PayrollCalculator::wage_from_minutes` di `payroll/engine.rs`. */
async function upahDariMenit(
  menit: number,
  tarifPerJam: number,
): Promise<number> {
  const { roundMoney } = await import("./payroll-calculator");
  return roundMoney((menit * tarifPerJam) / 60);
}

describe("upah dari menit", () => {
  test("membulatkan titik tengah menjauhi nol", async () => {
    for (const [menit, tarif, upah] of VEKTOR) {
      expect(await upahDariMenit(menit, tarif)).toBe(upah);
    }
  });

  /**
   * Menahan bentuk lama supaya tidak diam-diam kembali.
   *
   * `(menit / 60) * tarif` menempuh dua operasi pecahan dan galat pembagiannya
   * membuat nilai yang seharusnya jatuh tepat di titik tengah mendarat sedikit
   * di bawahnya. Tes ini menuntut perbedaan itu benar-benar ada, sehingga siapa
   * pun yang "menyederhanakan" perhitungannya kembali akan melihat tes gagal —
   * bukan menemukannya berbulan kemudian di slip gaji.
   */
  test("membagi lebih dulu kehilangan titik tengahnya", async () => {
    const { roundMoney } = await import("./payroll-calculator");
    expect(roundMoney((11 / 60) * 18750)).toBe(3437);
    expect(await upahDariMenit(11, 18750)).toBe(3438);
  });
});

/**
 * Vektor sakelar lembur — WAJIB identik dengan
 * `sakelar_lembur_memindahkan_jam_hari_libur_bukan_membuangnya` di
 * `payroll/engine.rs`.
 *
 * `[reguler, lembur, total hari libur, jam kerja hari libur, diizinkan]`
 * menghasilkan `[reguler, lembur, hari libur]`.
 */
const VEKTOR_LEMBUR: Array<
  [number, number, number, number, boolean, number, number, number]
> = [
  [9600, 240, 480, 360, true, 9600, 240, 480],
  [9600, 0, 0, 0, true, 9600, 0, 0],
  [9600, 240, 480, 360, false, 9960, 0, 0],
  [9600, 240, 0, 0, false, 9600, 0, 0],
  [0, 0, 480, 360, false, 360, 0, 0],
];

describe("sakelar lembur", () => {
  test("memindahkan jam hari libur, bukan membuangnya", async () => {
    const { applyOvertimePolicy } = await import("./payroll-calculator");
    for (const [
      reguler,
      lembur,
      liburTotal,
      liburKerja,
      diizinkan,
      r,
      l,
      h,
    ] of VEKTOR_LEMBUR) {
      expect(
        applyOvertimePolicy(reguler, lembur, liburTotal, liburKerja, diizinkan),
      ).toEqual({ regular: r, overtime: l, holiday: h });
    }
  });
});

describe("sakelar lembur guru di setting_gex_system", () => {
  test("kunci yang belum ada berarti menyala", async () => {
    const { parseTeacherOvertimeSetting } = await import(
      "@/lib/validations/payroll-policy"
    );
    // Lembur guru sudah terhitung sebelum sakelar ini ada. Pemasangan berjalan
    // tidak boleh kehilangan komponen gaji hanya karena aplikasinya diperbarui.
    expect(parseTeacherOvertimeSetting(null)).toBe(true);
    expect(parseTeacherOvertimeSetting(undefined)).toBe(true);
    expect(parseTeacherOvertimeSetting("true")).toBe(true);
    expect(parseTeacherOvertimeSetting("TRUE")).toBe(true);
    expect(parseTeacherOvertimeSetting(" true ")).toBe(true);
    expect(parseTeacherOvertimeSetting("false")).toBe(false);
    expect(parseTeacherOvertimeSetting("")).toBe(false);
  });
});

/**
 * Tarif JP & gabungan jam — WAJIB identik dengan `mod tests` di
 * `payroll/engine.rs` (`tarif_khusus_guru_menang_atas_tarif_umum_mapel`,
 * `tarif_yang_berlaku_mengikuti_tanggal_sesi_bukan_akhir_periode`,
 * `baris_tarif_kembar_dipilih_secara_deterministik`,
 * `jam_yang_sama_pada_satu_tanggal_dihitung_sekali`, dan
 * `jp_tanpa_tarif_dihitung_terpisah_dan_tidak_menggagalkan_apa_pun`).
 */
function tarif(
  id: string,
  mapel: string,
  guru: string | null,
  rate: number,
  berlaku: string,
  updated: string,
) {
  return {
    id,
    id_mapel: mapel,
    id_guru: guru,
    rate_per_jp: rate,
    effective_date: berlaku,
    status_aktif: 1,
    updated_at: updated,
  };
}

function sesi(
  id: string,
  mapel: string,
  tanggal: string,
  awal: number,
  akhir: number,
) {
  return {
    id_presensi_mapel: id,
    id_mapel: mapel,
    tanggal,
    jam_awal: awal,
    jam_akhir: akhir,
  };
}

describe("tarif honor per jam pelajaran", () => {
  test("tarif khusus guru menang atas tarif umum mapel", async () => {
    const { resolveJpRate } = await import("./payroll-calculator");
    const rates = [
      tarif("t1", "mtk", null, 100000, "2026-01-01", "2026-01-01"),
      tarif("t2", "mtk", "g1", 120000, "2026-01-01", "2026-01-01"),
      tarif("t3", "ind", null, 50000, "2026-01-01", "2026-01-01"),
    ];
    expect(resolveJpRate(rates, "mtk", "g1", "2026-09-10", 0)).toBe(120000);
    expect(resolveJpRate(rates, "mtk", "g2", "2026-09-10", 0)).toBe(100000);
    expect(resolveJpRate(rates, "ind", "g1", "2026-09-10", 0)).toBe(50000);
    expect(resolveJpRate(rates, "seni", "g1", "2026-09-10", 40000)).toBe(40000);
  });

  test("tarif yang berlaku mengikuti tanggal sesi, bukan akhir periode", async () => {
    const { resolveJpRate } = await import("./payroll-calculator");
    const rates = [
      tarif("t1", "mtk", null, 100000, "2026-01-01", "2026-01-01"),
      tarif("t2", "mtk", null, 150000, "2026-09-15", "2026-09-15"),
    ];
    expect(resolveJpRate(rates, "mtk", "g1", "2026-09-14", 0)).toBe(100000);
    expect(resolveJpRate(rates, "mtk", "g1", "2026-09-15", 0)).toBe(150000);
  });

  test("baris tarif kembar dipilih secara deterministik", async () => {
    const { resolveJpRate } = await import("./payroll-calculator");
    const rates = [
      tarif("aaa", "mtk", null, 90000, "2026-01-01", "2026-01-02"),
      tarif("zzz", "mtk", null, 110000, "2026-01-01", "2026-01-02"),
    ];
    expect(resolveJpRate(rates, "mtk", "g1", "2026-09-10", 0)).toBe(110000);

    const nonaktif = [
      {
        ...tarif("t1", "mtk", null, 90000, "2026-01-01", "2026-01-01"),
        status_aktif: 0,
      },
    ];
    expect(resolveJpRate(nonaktif, "mtk", "g1", "2026-09-10", 7000)).toBe(7000);
  });
});

describe("gabungan jam pelajaran", () => {
  test("jam yang sama pada satu tanggal dihitung sekali", async () => {
    const { summarizeTeaching } = await import("./payroll-calculator");
    const rates = [
      tarif("t1", "agama", null, 50000, "2026-01-01", "2026-01-01"),
    ];

    // Guru Agama mengajar tiga rombel pada jam 1-2 yang sama: tetap dua JP.
    const sessions = [
      sesi("pm1", "agama", "2026-09-10", 1, 2),
      sesi("pm2", "agama", "2026-09-10", 1, 2),
      sesi("pm3", "agama", "2026-09-10", 1, 2),
    ];
    expect(summarizeTeaching(sessions, rates, "g1", 0)).toEqual({
      total_jp: 2,
      honor: 100000,
      unrated_jp: 0,
    });

    const irisan = [
      sesi("pm1", "agama", "2026-09-10", 1, 2),
      sesi("pm2", "agama", "2026-09-10", 2, 3),
    ];
    expect(summarizeTeaching(irisan, rates, "g1", 0).total_jp).toBe(3);

    const duaHari = [
      sesi("pm1", "agama", "2026-09-10", 1, 2),
      sesi("pm2", "agama", "2026-09-11", 1, 2),
    ];
    expect(summarizeTeaching(duaHari, rates, "g1", 0).total_jp).toBe(4);
  });

  test("JP tanpa tarif dihitung terpisah dan tidak menggagalkan apa pun", async () => {
    const { summarizeTeaching } = await import("./payroll-calculator");
    const sessions = [sesi("pm1", "seni", "2026-09-10", 1, 3)];
    expect(summarizeTeaching(sessions, [], "g1", 0)).toEqual({
      total_jp: 3,
      honor: 0,
      unrated_jp: 3,
    });
  });
});

/**
 * Vektor sasaran komponen — WAJIB identik dengan `VEKTOR_SASARAN` di
 * `payroll/engine.rs`.
 *
 * `[applies_to, cocok untuk guru honorer Divisi Kurikulum?]`
 */
const VEKTOR_SASARAN: Array<[string, boolean]> = [
  ["ALL", true],
  ["", true],
  ["all", true],
  ["emp-1", true],
  ["emp-2", false],
  ["PERSONIL:Guru", true],
  ["personil:guru", true],
  ["PERSONIL:GURU", true],
  ["PERSONIL:Pegawai", false],
  ["STATUS:Honorer", true],
  ["STATUS:honorer", true],
  ["STATUS:PNS", false],
  ["DIVISI:Kurikulum", true],
  ["DIVISI:kurikulum", true],
  ["DIVISI:Tata Usaha", false],
  // Awalan yang TIDAK dikenal diperlakukan sebagai id, bukan "semua".
  ["KELOMPOK:Guru", false],
  ["PERSONIL:", false],
];

describe("sasaran komponen payroll", () => {
  test("dinilai dari kelompok, bukan dari tebakan", async () => {
    const { appliesToSubject } = await import(
      "@/lib/validations/payroll-policy"
    );
    const subject = {
      id_karyawan: "emp-1",
      jenis_personil: "GURU",
      status_kepegawaian: "Honorer",
      divisi: "Kurikulum",
      total_teaching_jp: 0,
      total_hadir: 0,
    };
    for (const [appliesTo, harapan] of VEKTOR_SASARAN) {
      expect(appliesToSubject(appliesTo, subject)).toBe(harapan);
    }
  });

  test("kelompok status tidak pernah cocok untuk yang bukan guru", async () => {
    const { appliesToSubject } = await import(
      "@/lib/validations/payroll-policy"
    );
    // `status_kepegawaian` kosong bagi karyawan non-guru, dan kosong tidak
    // boleh cocok dengan apa pun — kalau tidak, "Guru berstatus Honorer" akan
    // menyebar ke seluruh staf.
    const staf = {
      id_karyawan: "emp-9",
      jenis_personil: "Pegawai",
      status_kepegawaian: "",
      divisi: "Tata Usaha",
      total_teaching_jp: 0,
      total_hadir: 0,
    };
    expect(appliesToSubject("STATUS:Honorer", staf)).toBe(false);
    expect(appliesToSubject("PERSONIL:Pegawai", staf)).toBe(true);
    expect(appliesToSubject("DIVISI:Tata Usaha", staf)).toBe(true);
  });
});

/**
 * Vektor jenis perhitungan komponen — WAJIB identik dengan `VEKTOR_CALC` di
 * `payroll/engine.rs`.
 *
 * `[calc_type, nilai, nominal untuk 20 JP / 24 hari hadir / pokok 2.000.000]`
 */
const VEKTOR_CALC: Array<[string, number, number]> = [
  ["FIXED", 150000, 150000],
  ["PERCENTAGE", 10, 200000],
  ["PER_JP", 5000, 100000],
  ["PER_HADIR", 25000, 600000],
  // Jenis asing membayar nominal yang tertulis — bentuk paling jinak, dan sama
  // seperti sebelum kedua jenis baru ada.
  ["ENTAH_APA", 7000, 7000],
];

describe("jenis perhitungan komponen", () => {
  test("dihitung dari dasar masing-masing", async () => {
    const { calculateComponents } = await import("./payroll-calculator");
    const subject = {
      id_karyawan: "emp-1",
      jenis_personil: "GURU",
      status_kepegawaian: "Honorer",
      divisi: "Kurikulum",
      total_teaching_jp: 20,
      total_hadir: 24,
    };

    for (const [calcType, nilai, harapan] of VEKTOR_CALC) {
      const { allowance } = calculateComponents(
        2000000,
        [
          {
            id: "c1",
            name: "Uji",
            category: "ALLOWANCE",
            calc_type: calcType,
            default_value: nilai,
            applies_to: "ALL",
            is_active: 1,
          },
        ],
        subject,
      );
      expect(allowance).toBe(harapan);
    }
  });

  test("dasar negatif tidak pernah mengurangi tunjangan", async () => {
    const { calculateComponents } = await import("./payroll-calculator");
    // JP dan hari hadir tidak bisa negatif lewat jalur normal, tetapi
    // membiarkannya mengalir apa adanya berarti satu baris data rusak bisa
    // MENGURANGI tunjangan orang lain lewat total yang sama.
    const { allowance } = calculateComponents(
      0,
      [
        {
          id: "c1",
          name: "Uji",
          category: "ALLOWANCE",
          calc_type: "PER_JP",
          default_value: 5000,
          applies_to: "ALL",
          is_active: 1,
        },
      ],
      {
        id_karyawan: "emp-1",
        jenis_personil: "",
        status_kepegawaian: "",
        divisi: "",
        total_teaching_jp: -5,
        total_hadir: -3,
      },
    );
    expect(allowance).toBe(0);
  });
});
