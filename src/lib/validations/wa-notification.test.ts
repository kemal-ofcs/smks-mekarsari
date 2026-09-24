import { describe, expect, test } from "bun:test";
import {
  composeWaMessage,
  DEFAULT_AMBANG_ALFA_DAYS,
  DEFAULT_AMBANG_ALFA_LIMIT,
  DEFAULT_WA_TEMPLATES,
  isValidWaNotificationStatus,
  parseAmbangAlfaDays,
  parseAmbangAlfaLimit,
  renderWaTemplate,
  validateWaTemplate,
  WA_NOTIFICATION_KINDS,
  WA_NOTIFY_AMBANG_ALFA_DAYS_KEY,
  WA_NOTIFY_AMBANG_ALFA_KEY,
  WA_NOTIFY_AMBANG_ALFA_LIMIT_KEY,
  WA_NOTIFY_BOLOS_KEY,
  WA_NOTIFY_SCAN_MASUK_KEY,
  WA_NOTIFY_SCAN_PULANG_KEY,
  WA_QUEUE_RETENTION_DAYS,
  waNotifyEnabled,
  waNotifySettingKey,
} from "./wa-notification";

/**
 * Vektor kembar dengan `kunci_sakelar_notifikasi_sesuai_vektor` dan
 * `sakelar_notifikasi_bawaannya_mati` di `wa_notification.rs`.
 *
 * Satu database dilayani Web dan Desktop bergantian. Bila kedua sisi memetakan
 * jenis ke kunci yang berbeda, sakelar yang dimatikan di satu layar tidak akan
 * berlaku di terminal lain — dan tidak ada pesan kesalahan yang menunjukkannya.
 * Perlakukan kedua berkas tes ini sebagai satu berkas.
 */
describe("sakelar induk notifikasi WhatsApp", () => {
  test("pemetaan jenis ke kunci setting", () => {
    const vektor: Array<[string, string | null]> = [
      ["scan_masuk", "wa_notify_scan_masuk"],
      ["scan_pulang", "wa_notify_scan_pulang"],
      ["bolos", "wa_notify_bolos"],
      ["ambang_alfa", "wa_notify_ambang_alfa"],
      ["", null],
      ["Scan_Masuk", null],
      ["broadcast", null],
    ];
    for (const [jenis, harapan] of vektor) {
      expect(waNotifySettingKey(jenis)).toBe(harapan);
    }
  });

  test("kunci yang belum pernah ditulis berarti mati", () => {
    const settings: Record<string, string> = {};
    for (const jenis of ["scan_masuk", "scan_pulang", "bolos", "ambang_alfa"]) {
      expect(waNotifyEnabled(settings, jenis)).toBe(false);
    }
  });

  test("menyalakan satu jenis tidak menyalakan jenis lain", () => {
    const settings: Record<string, string> = {
      [WA_NOTIFY_SCAN_MASUK_KEY]: "true",
    };
    // Scan masuk dan scan pulang adalah dua keputusan terpisah. Sekolah sering
    // memberi tahu kepulangan tetapi tidak setiap kedatangan, jadi keduanya
    // tidak boleh saling membawa.
    expect(settings[WA_NOTIFY_SCAN_PULANG_KEY]).toBeUndefined();
    expect(waNotifyEnabled(settings, "scan_masuk")).toBe(true);
    expect(waNotifyEnabled(settings, "scan_pulang")).toBe(false);
    expect(waNotifyEnabled(settings, "bolos")).toBe(false);
    expect(waNotifyEnabled(settings, "ambang_alfa")).toBe(false);
  });

  test("hanya nilai 'true' yang menyalakan, jenis asing selalu mati", () => {
    const settings: Record<string, string> = { [WA_NOTIFY_BOLOS_KEY]: "1" };
    expect(waNotifyEnabled(settings, "bolos")).toBe(false);

    settings[WA_NOTIFY_BOLOS_KEY] = "TRUE";
    expect(waNotifyEnabled(settings, "bolos")).toBe(true);

    expect(waNotifyEnabled(settings, "jenis_yang_tidak_ada")).toBe(false);
  });

  test("Map dan objek biasa dinilai sama", () => {
    const peta = new Map([[WA_NOTIFY_AMBANG_ALFA_KEY, "true"]]);
    expect(waNotifyEnabled(peta, "ambang_alfa")).toBe(true);
    expect(waNotifyEnabled(peta, "bolos")).toBe(false);
  });

  /**
   * Vektor kembar dengan `status_notifikasi_asing_ditolak_bukan_dinormalkan`
   * di `wa_notification.rs`.
   *
   * `Menunggu` adalah satu-satunya status yang benar-benar dikirim, jadi
   * menormalkan nilai asing menjadi `Menunggu` mengubah bug klien menjadi pesan
   * WhatsApp ke nomor wali seorang siswa — dan pesan yang sudah terkirim tidak
   * bisa ditarik kembali.
   */
  test("hanya empat status kanonik yang diterima", () => {
    for (const status of ["Menunggu", "Terkirim", "Gagal", "Dibatalkan"]) {
      expect(isValidWaNotificationStatus(status)).toBe(true);
    }
    for (const status of [
      "Terkirim Sebagian",
      "menunggu",
      "MENUNGGU",
      "Pending",
      "",
      " Menunggu",
    ]) {
      expect(isValidWaNotificationStatus(status)).toBe(false);
    }
  });

  /**
   * Kedua sisi memangkas tabel yang sama. Ambang yang berbeda membuat satu
   * sisi menghidupkan kembali baris yang baru saja dihapus sisi lain lewat
   * sinkronisasi, dan tabelnya tidak pernah benar-benar mengecil.
   */
  test("ambang retensi sama dengan WA_QUEUE_RETENTION_DAYS di Rust", () => {
    expect(WA_QUEUE_RETENTION_DAYS).toBe(90);
  });
});

describe("pengaturan parameter ambang batas akumulasi alfa", () => {
  test("konstanta bawaan ambang alfa", () => {
    expect(DEFAULT_AMBANG_ALFA_LIMIT).toBe(3);
    expect(DEFAULT_AMBANG_ALFA_DAYS).toBe(30);
    expect(WA_NOTIFY_AMBANG_ALFA_LIMIT_KEY).toBe("wa_notify_ambang_alfa_limit");
    expect(WA_NOTIFY_AMBANG_ALFA_DAYS_KEY).toBe("wa_notify_ambang_alfa_days");
  });

  test("parsing limit ambang alfa dengan boundary", () => {
    expect(
      parseAmbangAlfaLimit({ [WA_NOTIFY_AMBANG_ALFA_LIMIT_KEY]: "5" }),
    ).toBe(5);
    expect(
      parseAmbangAlfaLimit({ [WA_NOTIFY_AMBANG_ALFA_LIMIT_KEY]: "1" }),
    ).toBe(1);
    expect(
      parseAmbangAlfaLimit({ [WA_NOTIFY_AMBANG_ALFA_LIMIT_KEY]: "100" }),
    ).toBe(100);
    // Di luar batas (0 atau >100) atau string tidak valid fallback ke DEFAULT (3)
    expect(
      parseAmbangAlfaLimit({ [WA_NOTIFY_AMBANG_ALFA_LIMIT_KEY]: "0" }),
    ).toBe(3);
    expect(
      parseAmbangAlfaLimit({ [WA_NOTIFY_AMBANG_ALFA_LIMIT_KEY]: "101" }),
    ).toBe(3);
    expect(
      parseAmbangAlfaLimit({
        [WA_NOTIFY_AMBANG_ALFA_LIMIT_KEY]: "bukan_angka",
      }),
    ).toBe(3);
    expect(parseAmbangAlfaLimit({})).toBe(3);
  });

  test("parsing days ambang alfa dengan boundary", () => {
    expect(
      parseAmbangAlfaDays({ [WA_NOTIFY_AMBANG_ALFA_DAYS_KEY]: "60" }),
    ).toBe(60);
    expect(parseAmbangAlfaDays({ [WA_NOTIFY_AMBANG_ALFA_DAYS_KEY]: "1" })).toBe(
      1,
    );
    expect(
      parseAmbangAlfaDays({ [WA_NOTIFY_AMBANG_ALFA_DAYS_KEY]: "365" }),
    ).toBe(365);
    // Di luar batas (0 atau >365) atau string tidak valid fallback ke DEFAULT (30)
    expect(parseAmbangAlfaDays({ [WA_NOTIFY_AMBANG_ALFA_DAYS_KEY]: "0" })).toBe(
      30,
    );
    expect(
      parseAmbangAlfaDays({ [WA_NOTIFY_AMBANG_ALFA_DAYS_KEY]: "366" }),
    ).toBe(30);
    expect(
      parseAmbangAlfaDays({ [WA_NOTIFY_AMBANG_ALFA_DAYS_KEY]: "xyz" }),
    ).toBe(30);
    expect(parseAmbangAlfaDays({})).toBe(30);
  });

  test("mendukung format Map maupun Record", () => {
    const map = new Map<string, string>([
      [WA_NOTIFY_AMBANG_ALFA_LIMIT_KEY, "7"],
      [WA_NOTIFY_AMBANG_ALFA_DAYS_KEY, "45"],
    ]);
    expect(parseAmbangAlfaLimit(map)).toBe(7);
    expect(parseAmbangAlfaDays(map)).toBe(45);
  });
});

// Vektor kembar dengan `render_template_sesuai_vektor`,
// `validasi_template_sesuai_vektor`, dan
// `susun_pesan_memakai_template_tersimpan` di `wa_notification.rs`.
describe("template teks pesan WhatsApp", () => {
  test("isian diisi dalam satu lintasan", () => {
    const vektor: [string, Record<string, string>, string][] = [
      [
        "Halo {nama} ({rombel})",
        { nama: "Budi", rombel: "7A" },
        "Halo Budi (7A)",
      ],
      ["{nama} {tidak_ada}", { nama: "Ani" }, "Ani {tidak_ada}"],
      ["{nama}", { nama: "{rombel}", rombel: "X" }, "{rombel}"],
      ["Kurung {nama", { nama: "A" }, "Kurung {nama"],
      ["Émoji 🎉 {nama}!", { nama: "Çağ" }, "Émoji 🎉 Çağ!"],
    ];
    for (const [template, vars, harapan] of vektor) {
      expect(renderWaTemplate(template, vars)).toBe(harapan);
    }
  });

  test("validasi menolak isian asing dan mewajibkan {nama}", () => {
    const panjang = `{nama}${"a".repeat(995)}`;
    const vektor: [string, string, string | { pesan: string }][] = [
      ["scan_masuk", "", ""],
      ["scan_masuk", "   ", ""],
      ["scan_masuk", "  Halo {nama}  ", "Halo {nama}"],
      [
        "scan_masuk",
        "Halo {rombel}",
        { pesan: "Teks pesan wajib memuat isian {nama}." },
      ],
      [
        "scan_masuk",
        "Halo {nama} {mapel}",
        { pesan: "Isian {mapel} tidak dikenal untuk pesan ini." },
      ],
      [
        "scan_masuk",
        "Halo {nama",
        { pesan: "Ada tanda { yang tidak ditutup dengan }." },
      ],
      ["scan_masuk", panjang, { pesan: "Teks pesan maksimal 1000 karakter." }],
      ["asing", "Halo {nama}", { pesan: "Jenis notifikasi tidak dikenal." }],
    ];
    for (const [jenis, teks, harapan] of vektor) {
      const hasil = validateWaTemplate(jenis, teks);
      expect(hasil).toEqual(
        typeof harapan === "string"
          ? { ok: true, value: harapan }
          : { ok: false, pesan: harapan.pesan },
      );
    }
    for (const jenis of WA_NOTIFICATION_KINDS) {
      const bawaan = DEFAULT_WA_TEMPLATES[jenis];
      expect(validateWaTemplate(jenis, bawaan)).toEqual({
        ok: true,
        value: bawaan,
      });
    }
  });

  test("tanpa template tersimpan, teksnya sama dengan sebelum fitur ini", () => {
    const vars = {
      nama: "Budi",
      rombel: "7A",
      jam: "07:05",
      tanggal: "2026-09-24",
      status: "Tepat Waktu",
    };
    expect(composeWaMessage("scan_masuk", null, vars)).toBe(
      "Yth. Wali Murid dari Budi (7A). Kami informasikan bahwa ananda telah hadir dan melakukan scan masuk di sekolah pada pukul 07:05 WIB (2026-09-24). Status: Tepat Waktu.",
    );
    expect(
      composeWaMessage("scan_masuk", "{nama} tiba pukul {jam}.", vars),
    ).toBe("Budi tiba pukul 07:05.");
    expect(composeWaMessage("scan_masuk", "{nmaa} tiba.", vars)).toStartWith(
      "Yth. Wali Murid dari Budi",
    );
  });
});
