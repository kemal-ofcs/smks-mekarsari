import { describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

const { buatPermintaanProvider } = await import("./wa-provider");

const config = (provider: string, apiUrl: string | null) => ({
  provider: provider as "fonnte" | "wablas" | "custom",
  apiKey: "KUNCI",
  apiUrl,
  senderNumber: "628111",
});

// Vektor yang sama diuji di `wa_sender.rs` (`permintaan_per_provider`).
describe("buatPermintaanProvider", () => {
  test("fonnte memakai URL bawaan dan nomor tanpa tanda baca", () => {
    const fonnte = buatPermintaanProvider(
      config("fonnte", null),
      "+62 812-3456",
      "Halo",
    );
    expect(fonnte.url).toBe("https://api.fonnte.com/send");
    expect(fonnte.authorization).toBe("KUNCI");
    expect(fonnte.body).toEqual({
      target: "628123456",
      message: "Halo",
      countryCode: "62",
    });
  });

  test("wablas memakai URL yang diisi, dipangkas", () => {
    const wablas = buatPermintaanProvider(
      config("wablas", " https://x.test/kirim "),
      "0812",
      "Hai",
    );
    expect(wablas.url).toBe("https://x.test/kirim");
    expect(wablas.body).toEqual({ phone: "0812", message: "Hai" });
  });

  test("custom memakai Bearer dan membawa nomor pengirim", () => {
    const custom = buatPermintaanProvider(
      config("custom", "https://gw.test"),
      "62812",
      "Yo",
    );
    expect(custom.authorization).toBe("Bearer KUNCI");
    expect(custom.body).toEqual({
      target: "62812",
      phone: "62812",
      message: "Yo",
      device: "628111",
    });
  });

  test("custom tanpa URL ditolak", () => {
    expect(() =>
      buatPermintaanProvider(config("custom", "  "), "62812", "Yo"),
    ).toThrow("URL custom endpoint belum diisi.");
  });
});
