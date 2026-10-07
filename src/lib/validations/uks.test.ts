import { describe, expect, test } from "bun:test";
import {
  bukaDraftSchema,
  formatSejakSync,
  isValidJam,
  obatDraftSchema,
  obatKeMutasi,
  simpanDraftSchema,
  validateBuka,
  validateSimpan,
} from "./uks";

const HARI_INI = "2026-10-07";

describe("aturan UKS (vektor kembar uks.rs)", () => {
  // Vektor kembar dengan `jam_vectors`.
  test("isValidJam", () => {
    const vektor: [string, boolean][] = [
      ["07:05", true],
      ["23:59", true],
      ["24:00", false],
      ["7:05", false],
      ["07:60", false],
      ["ab:cd", false],
    ];
    for (const [input, expected] of vektor)
      expect(isValidJam(input)).toBe(expected);
  });

  // Vektor kembar dengan `validation_vectors`.
  test("validateBuka dan validateSimpan", () => {
    const buka = (raw: Record<string, unknown>) =>
      validateBuka(bukaDraftSchema.parse(raw), HARI_INI);
    expect(buka({ id_personil: "sis-1", keluhan: "Demam" }).ok).toBe(true);
    expect(buka({ id_personil: " ", keluhan: "Demam" })).toEqual({
      ok: false,
      error: "Pilih personil yang berkunjung.",
    });
    expect(buka({ id_personil: "sis-1", keluhan: "  " })).toEqual({
      ok: false,
      error: "Keluhan wajib diisi.",
    });
    expect(
      buka({ id_personil: "sis-1", keluhan: "Demam", tanggal: "2026-10-08" }),
    ).toEqual({
      ok: false,
      error: "Tanggal tidak boleh melewati hari ini.",
    });
    expect(
      buka({ id_personil: "sis-1", keluhan: "Demam", jam_masuk: "25:00" }),
    ).toEqual({
      ok: false,
      error: "Jam masuk tidak valid.",
    });

    const simpan = (raw: Record<string, unknown>) =>
      validateSimpan(simpanDraftSchema.parse(raw), "08:30");
    expect(simpan({ tindakan: "Kompres" }).ok).toBe(true);
    expect(
      simpan({ jam_keluar: "09:00", tindak_lanjut: "Kembali ke kelas" }).ok,
    ).toBe(true);
    expect(simpan({ jam_keluar: "08:00", tindak_lanjut: "Pulang" })).toEqual({
      ok: false,
      error: "Jam keluar tidak boleh lebih awal dari jam masuk.",
    });
    expect(simpan({ jam_keluar: "09:00" })).toEqual({
      ok: false,
      error: "Tindak lanjut wajib diisi saat menutup kunjungan.",
    });
    expect(simpan({ jam_keluar: "9:00", tindak_lanjut: "Pulang" })).toEqual({
      ok: false,
      error: "Jam keluar tidak valid.",
    });
  });

  test("obat menjadi mutasi tanpa nama siswa", () => {
    const mutasi = obatKeMutasi(
      obatDraftSchema.parse({
        id_barang: "b",
        tempat: "UKS",
        id_batch: "mts-1",
        jumlah: 2,
      }),
    );
    expect(mutasi.penerima_tipe).toBe("Unit");
    expect(mutasi.penerima_nama).toBe("UKS");
    expect(mutasi.keperluan).toBe("Kunjungan UKS");
    expect(mutasi.penerima_id).toBeUndefined();
  });

  test("formatSejakSync", () => {
    expect(formatSejakSync(null)).toBe("belum pernah tersinkron");
    expect(formatSejakSync(30)).toBe("baru saja");
    expect(formatSejakSync(5 * 60)).toBe("5 menit lalu");
    expect(formatSejakSync(5 * 3600)).toBe("5 jam lalu");
    expect(formatSejakSync(72 * 3600)).toBe("3 hari lalu");
  });
});
