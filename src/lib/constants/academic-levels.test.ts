import { describe, expect, it } from "bun:test";
import {
  formatTingkatDisplay,
  PRESET_TINGKAT_TEMPLATES,
  parseUnitKeterangan,
  resolveTingkatOptions,
  serializeUnitKeterangan,
} from "./academic-levels";

describe("academic-levels", () => {
  it("harus menangani keterangan kosong atau null secara aman", () => {
    expect(parseUnitKeterangan("")).toEqual({
      deskripsi: "",
      daftar_tingkat: [],
    });
    expect(parseUnitKeterangan(null)).toEqual({
      deskripsi: "",
      daftar_tingkat: [],
    });
    expect(parseUnitKeterangan(undefined)).toEqual({
      deskripsi: "",
      daftar_tingkat: [],
    });
  });

  it("harus mengenali keterangan legacy berupa teks biasa tanpa merusaknya", () => {
    const raw = "Satuan pendidikan kejuruan teknik";
    const parsed = parseUnitKeterangan(raw);
    expect(parsed.deskripsi).toBe(raw);
    expect(parsed.daftar_tingkat).toEqual([]);
    expect(
      serializeUnitKeterangan(parsed.deskripsi, parsed.daftar_tingkat),
    ).toBe(raw);
  });

  it("harus berhasil melakukan serialisasi dan parsing JSON daftar tingkat", () => {
    const tingkat = [
      { tingkat: 10, nama: "Kelas 10" },
      { tingkat: 11, nama: "Kelas 11" },
      { tingkat: 12, nama: "Kelas 12" },
    ];
    const serialized = serializeUnitKeterangan("SMK Pusat Keunggulan", tingkat);
    const parsed = parseUnitKeterangan(serialized);

    expect(parsed.deskripsi).toBe("SMK Pusat Keunggulan");
    expect(parsed.daftar_tingkat).toHaveLength(3);
    expect(parsed.daftar_tingkat[0]).toEqual({ tingkat: 10, nama: "Kelas 10" });
    expect(parsed.daftar_tingkat[2]).toEqual({ tingkat: 12, nama: "Kelas 12" });
  });

  it("harus memvalidasi duplikasi dan angka negatif saat serialisasi", () => {
    const duplicateList = [
      { tingkat: 10, nama: "X A" },
      { tingkat: 10, nama: "X B" },
      { tingkat: -1, nama: "Negatif" },
      { tingkat: 11, nama: "XI" },
    ];
    const serialized = serializeUnitKeterangan("Test", duplicateList);
    const parsed = parseUnitKeterangan(serialized);

    expect(parsed.daftar_tingkat).toHaveLength(2);
    expect(parsed.daftar_tingkat[0].tingkat).toBe(10);
    expect(parsed.daftar_tingkat[1].tingkat).toBe(11);
  });

  it("harus me-resolve opsi tingkat dari banyak unit dengan filter", () => {
    const unitList = [
      {
        id_unit: "u-tk",
        nama_unit: "TK",
        keterangan: serializeUnitKeterangan(
          "TK",
          PRESET_TINGKAT_TEMPLATES.tk.tingkat,
        ),
      },
      {
        id_unit: "u-smk",
        nama_unit: "SMK",
        keterangan: serializeUnitKeterangan(
          "SMK",
          PRESET_TINGKAT_TEMPLATES.smk_sma.tingkat,
        ),
      },
    ];

    // Filter khusus TK
    const tkOptions = resolveTingkatOptions(unitList, "u-tk");
    expect(tkOptions).toHaveLength(2);
    expect(tkOptions[0].label).toBe("TK A");
    expect(tkOptions[1].label).toBe("TK B");

    // Filter khusus SMK
    const smkOptions = resolveTingkatOptions(unitList, "u-smk");
    expect(smkOptions).toHaveLength(3);
    expect(smkOptions[0].label).toBe("Kelas 10");

    // Tanpa filter (semua unit aktif)
    const allOptions = resolveTingkatOptions(unitList);
    expect(allOptions).toHaveLength(5);
  });

  it("harus mempertahankan currentTingkat jika nilainya belum ada di unit", () => {
    const unitList = [
      {
        id_unit: "u-tk",
        nama_unit: "TK",
        keterangan: serializeUnitKeterangan("TK", [
          { tingkat: 0, nama: "TK A" },
        ]),
      },
    ];
    // Rombel legacy punya tingkat 10
    const options = resolveTingkatOptions(unitList, undefined, 10);
    expect(options.some((o) => o.tingkat === 10)).toBe(true);
  });

  it("harus memformat label tampilan tingkat dengan benar", () => {
    const unitList = [
      {
        id_unit: "u-tk",
        nama_unit: "TK",
        keterangan: serializeUnitKeterangan("TK", [
          { tingkat: 0, nama: "TK A (Nol Besar)" },
        ]),
      },
    ];

    expect(formatTingkatDisplay(0, unitList)).toBe("TK A (Nol Besar)");
    // Fallback jika tidak ditemukan
    expect(formatTingkatDisplay(10, unitList)).toBe("Kelas 10");
    expect(formatTingkatDisplay(null, unitList)).toBe("-");
  });
});
