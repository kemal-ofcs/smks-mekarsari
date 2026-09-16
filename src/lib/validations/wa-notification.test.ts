import { describe, expect, test } from "bun:test";
import {
  DEFAULT_AMBANG_ALFA_DAYS,
  DEFAULT_AMBANG_ALFA_LIMIT,
  isValidWaNotificationStatus,
  parseAmbangAlfaDays,
  parseAmbangAlfaLimit,
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
