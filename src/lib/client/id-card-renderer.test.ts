import { describe, expect, test } from "bun:test";
import {
  escapeAttr,
  ID_CARD_LINE_HEIGHT,
  ID_CARD_MIN_FONT_RATIO,
  tataTeksDalamKotak,
} from "./id-card-renderer";

describe("escapeAttr", () => {
  test("nama personil tidak bisa keluar dari atribut alt", () => {
    const nama = `"><img src=x onerror="alert(1)">`;
    const html = `<img alt="${escapeAttr(nama)}" />`;
    expect(html).not.toContain("<img src=x");
    expect(html).toBe(
      '<img alt="&quot;&gt;&lt;img src=x onerror=&quot;alert(1)&quot;&gt;" />',
    );
  });

  test("nama biasa tidak berubah", () => {
    expect(escapeAttr("Siti Aisyah")).toBe("Siti Aisyah");
  });
});

describe("tataTeksDalamKotak", () => {
  // Pengukur palsu: tiap huruf selebar setengah ukuran font.
  const ukur = (teks: string, px: number) => teks.length * px * 0.5;

  test("teks yang sudah muat tidak berubah", () => {
    expect(tataTeksDalamKotak(ukur, "Budi", 100, 40, 20)).toEqual({
      fontPx: 20,
      baris: ["Budi"],
    });
  });

  test("teks panjang dibungkus lalu dikecilkan sampai muat di kotak", () => {
    const hasil = tataTeksDalamKotak(
      ukur,
      "Siti Aisyah Rahmawati",
      100,
      40,
      20,
    );
    expect(hasil.fontPx).toBeLessThan(20);
    for (const baris of hasil.baris) {
      expect(ukur(baris, hasil.fontPx)).toBeLessThanOrEqual(100);
    }
    expect(
      hasil.baris.length * hasil.fontPx * ID_CARD_LINE_HEIGHT,
    ).toBeLessThanOrEqual(40);
  });

  test("kata tanpa spasi dipecah per huruf, tidak keluar ke samping", () => {
    const hasil = tataTeksDalamKotak(ukur, "SPPG-2026-000123", 60, 0, 10);
    for (const baris of hasil.baris) {
      expect(ukur(baris, hasil.fontPx)).toBeLessThanOrEqual(60);
    }
    expect(hasil.baris.join("")).toBe("SPPG-2026-000123");
  });

  test("di ukuran minimum yang tidak muat dipotong dengan …", () => {
    const hasil = tataTeksDalamKotak(ukur, "a ".repeat(80).trim(), 40, 14, 20);
    expect(hasil.fontPx).toBe(20 * ID_CARD_MIN_FONT_RATIO);
    expect(hasil.baris.at(-1)?.endsWith("…")).toBe(true);
    expect(
      hasil.baris.length * hasil.fontPx * ID_CARD_LINE_HEIGHT,
    ).toBeLessThanOrEqual(14);
  });
});
