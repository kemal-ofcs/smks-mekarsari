import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import * as K from "./hr-keluar";
import vektor from "./hr-keluar.vektor.json";
import { UNIT_PERSONIL_SQL } from "./hr-pengajuan";

// Vektor yang sama dengan `mod tests` di `desktop/hr_keluar.rs`.

describe("hr-keluar: SQL kembar", () => {
  test("SQL disalin harfiah ke hr_keluar.rs (Desktop dan Mobile)", () => {
    const sql = [
      K.SEED_ALASAN_SQL,
      K.SP_PEGAWAI_SQL,
      K.SP_SATU_SQL,
      K.PEGAWAI_SP_SQL,
      K.MASA_SP_SQL,
      K.NOMOR_KEMBAR_SQL,
      K.SIMPAN_SP_SQL,
      K.UBAH_SP_SQL,
      K.CABUT_SP_SQL,
      K.PESAN_DIRI_SENDIRI,
      K.PESAN_DI_LUAR_CAKUPAN,
      K.PESAN_BUTUH_SP3,
      K.PESAN_SP_DICABUT,
    ];
    let diperiksa = 0;
    for (const dir of ["desktop", "mobile"]) {
      const lokasi = [
        join(import.meta.dir, `../../../src-tauri/src/${dir}/hr_keluar.rs`),
        join(
          import.meta.dir,
          `../../../../mobile/src-tauri/src/${dir}/hr_keluar.rs`,
        ),
      ].find(existsSync);
      if (!lokasi) continue;
      diperiksa++;
      const rust = readFileSync(lokasi, "utf8").replace(/\s+/g, "");
      for (const teks of sql) {
        expect(rust).toContain(JSON.stringify(teks).replace(/\s+/g, ""));
      }
      // Unit akun sesi memakai SQL yang sama dengan cakupan pengajuan.
      expect(rust).toContain("hr_pengajuan::{dalam_cakupan,UNIT_PERSONIL_SQL}");
    }
    expect(diperiksa).toBeGreaterThan(0);
    expect(UNIT_PERSONIL_SQL).toContain("FROM master_data WHERE id_unik = ?1");
  });

  test("sembilan alasan bawaan, pengali 0–1000", () => {
    expect(K.ALASAN_BAWAAN).toHaveLength(9);
    for (const a of K.ALASAN_BAWAAN) {
      expect(a.pengali_up).toBeGreaterThanOrEqual(0);
      expect(a.pengali_upmk).toBeLessThanOrEqual(1000);
      expect(K.seedAlasanArgs(a)).toHaveLength(8);
    }
  });
});

describe("hr-keluar: vektor SP", () => {
  test("masa, status, dan masa bawaan", () => {
    for (const k of vektor.akhir_masa) {
      expect(K.akhirMasaSp(k.tanggal, k.masa_bulan)).toBe(k.hasil);
    }
    for (const k of vektor.status) {
      expect(
        K.statusSp(k.tanggal, k.berlaku_sampai, k.dicabut, k.hari_ini),
      ).toBe(k.hasil as K.StatusSp);
    }
    for (const k of vektor.masa_setting) {
      expect(K.masaSpBerlaku(k.nilai)).toBe(k.hasil);
    }
  });

  test("usulan tingkat", () => {
    for (const k of vektor.usulan) {
      expect({ nama: k.nama, ...K.usulanTingkat(k.sp, k.tanggal) }).toEqual({
        nama: k.nama,
        tingkat: k.tingkat as K.TingkatSp,
        sp3_berlaku: k.sp3_berlaku,
      });
    }
  });

  test("validasi, tingkat, dan wewenang", () => {
    for (const k of vektor.validasi) {
      const hasil = K.validasiSp(k.draft, k.hari_ini);
      expect({
        nama: k.nama,
        hasil: hasil.ok ? (hasil.nilai as unknown) : null,
        galat: hasil.ok ? null : hasil.galat,
      }).toEqual({ nama: k.nama, hasil: k.hasil, galat: k.galat });
    }
    for (const k of vektor.tingkat) {
      const hasil = K.periksaTingkat(k.tingkat, k.usulan, k.alasan);
      expect(hasil.ok ? null : hasil.galat).toBe(k.galat);
    }
    for (const k of vektor.wewenang) {
      const hasil = K.periksaWewenangSp(
        k.tingkat,
        k.sendiri,
        k.dalam_cakupan,
        k.boleh_sp3,
      );
      expect({ nama: k.nama, galat: hasil.ok ? null : hasil.galat }).toEqual({
        nama: k.nama,
        galat: k.galat,
      });
    }
  });
});
