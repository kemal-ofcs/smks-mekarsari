import { describe, expect, test } from "bun:test";
import { type Pilihan, pisahKelasWadah, saringPilihan } from "./pilih-cari";

const pilihan = (...label: string[]): Pilihan[] =>
  label.map((isi) => ({ value: isi, label: isi, disabled: false }));

describe("saringPilihan", () => {
  const daftar = pilihan(
    "Laptop Asus (BRG-0001)",
    "Proyektor Epson",
    "Asus Router",
  );

  test("kata kosong mengembalikan semua pilihan", () => {
    expect(saringPilihan(daftar, "   ")).toEqual(daftar);
  });

  test("tidak membedakan huruf besar dan cocok di tengah label", () => {
    expect(saringPilihan(daftar, "EPSON").map((p) => p.value)).toEqual([
      "Proyektor Epson",
    ]);
  });

  test("beberapa kata boleh dalam urutan apa pun, dan semuanya wajib ada", () => {
    expect(saringPilihan(daftar, "asus laptop").map((p) => p.value)).toEqual([
      "Laptop Asus (BRG-0001)",
    ]);
    expect(saringPilihan(daftar, "asus epson")).toEqual([]);
  });
});

describe("pisahKelasWadah", () => {
  test("ukuran dan jarak luar ke pembungkus, sisanya ke kotak", () => {
    expect(
      pisahKelasWadah(
        "mt-1 w-full sm:w-48 shrink-0 rounded-xl min-h-11 px-3 bg-slate-900",
      ),
    ).toEqual({
      wadah: "mt-1 w-full sm:w-48 shrink-0",
      isian: "rounded-xl min-h-11 px-3 bg-slate-900",
    });
  });

  test("kelas kosong tetap aman", () => {
    expect(pisahKelasWadah("")).toEqual({ wadah: "", isian: "" });
  });
});
