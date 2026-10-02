import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  cocokFilterUnit,
  normalizeStatusSiswa,
  opsiFilterKelas,
  STATUS_SISWA,
  shiftLabel,
  TANPA_UNIT,
} from "./personnel";

describe("STATUS_SISWA", () => {
  test("sama persis dengan CHECK constraint siswa_data.status", () => {
    const ddl = readFileSync(
      join(import.meta.dir, "../db-migrations.ts"),
      "utf8",
    );
    const check =
      /status TEXT NOT NULL DEFAULT 'Aktif' CHECK \(status IN \(([^)]*)\)\)/.exec(
        ddl,
      );
    expect(check).not.toBeNull();
    const nilai = (check?.[1] ?? "")
      .split(",")
      .map((item) => item.trim().replace(/^'|'$/g, ""));
    expect(nilai).toEqual([...STATUS_SISWA]);
  });

  test("normalisasi mengabaikan huruf besar/kecil dan menolak nilai asing", () => {
    expect(normalizeStatusSiswa(" drop out ")).toBe("Drop Out");
    expect(normalizeStatusSiswa("Mutasi")).toBeNull();
  });
});

describe("shiftLabel", () => {
  test("menyebut jam masuk dan pulang", () => {
    expect(
      shiftLabel({
        id_shift: 2,
        nama_shift: "Siang",
        jam_masuk: "12:00",
        jam_pulang: "17:00",
      }),
    ).toBe("Siang (12:00–17:00)");
  });

  test("jatuh ke nama saja bila jamnya kosong", () => {
    expect(shiftLabel({ id_shift: 3 })).toBe("Shift #3");
  });
});

describe("filter unit lalu kelas", () => {
  const baris = [
    { unit: "SMA", id_rombel: "r-11", nama_rombel: "XI IPA 1", tingkat: "11" },
    { unit: "SMA", id_rombel: "r-10b", nama_rombel: "X IPA 2", tingkat: "10" },
    { unit: "SMA", id_rombel: "r-10a", nama_rombel: "X IPA 1", tingkat: "10" },
    { unit: "SMA", id_rombel: "r-10a", nama_rombel: "X IPA 1", tingkat: "10" },
    { unit: "SMP", id_rombel: "r-7", nama_rombel: "VII A", tingkat: "7" },
    { unit: " ", id_rombel: "r-x", nama_rombel: "Titipan", tingkat: null },
    { unit: "SMA", id_rombel: null, nama_rombel: null, tingkat: null },
  ];

  test("unit: kosong berarti semua, sentinel berarti unit yang belum diisi", () => {
    expect(baris.filter((b) => cocokFilterUnit(b, "")).length).toBe(7);
    expect(baris.filter((b) => cocokFilterUnit(b, "SMA")).length).toBe(5);
    expect(baris.filter((b) => cocokFilterUnit(b, TANPA_UNIT)).length).toBe(1);
  });

  test("kelas: satu pilihan per rombel, urut tingkat lalu nama", () => {
    expect(opsiFilterKelas(baris, "")).toEqual([
      { id: "r-x", label: "Titipan" },
      { id: "r-7", label: "Kelas 7 - VII A" },
      { id: "r-10a", label: "Kelas 10 - X IPA 1" },
      { id: "r-10b", label: "Kelas 10 - X IPA 2" },
      { id: "r-11", label: "Kelas 11 - XI IPA 1" },
    ]);
  });

  test("kelas: menyempit mengikuti unit yang dipilih", () => {
    expect(opsiFilterKelas(baris, "SMP").map((k) => k.id)).toEqual(["r-7"]);
    expect(opsiFilterKelas(baris, TANPA_UNIT).map((k) => k.id)).toEqual([
      "r-x",
    ]);
    expect(opsiFilterKelas(baris, "SD")).toEqual([]);
  });
});
