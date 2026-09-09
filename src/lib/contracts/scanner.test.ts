import { describe, expect, test } from "bun:test";
import {
  ATTENDANCE_SOURCE_VALUES,
  normalizePersonnelRole,
  PERSONNEL_ROLES,
} from "@/lib/contracts/scanner";

describe("normalizePersonnelRole", () => {
  /**
   * Regresi Fase 2: terminal pemindai membandingkan `jenisPersonil` langsung
   * dengan `"Siswa"`/`"Guru"`, padahal `academic.rs` menulis `SISWA`/`GURU`
   * huruf besar. Perbandingannya tidak pernah cocok, sehingga setiap siswa dan
   * guru jatuh ke cabang pegawai — tanpa lonceng, sapaan sekolah, atau lencana.
   */
  test("mengenali ejaan huruf besar yang benar-benar tersimpan database", () => {
    expect(normalizePersonnelRole("SISWA")).toBe("Siswa");
    expect(normalizePersonnelRole("GURU")).toBe("Guru");
  });

  test("tetap mengenali ejaan kapital awal", () => {
    expect(normalizePersonnelRole("Siswa")).toBe("Siswa");
    expect(normalizePersonnelRole("Guru")).toBe("Guru");
    expect(normalizePersonnelRole("Pegawai")).toBe("Pegawai");
  });

  test("toleran terhadap spasi tepi dan ejaan campur", () => {
    expect(normalizePersonnelRole("  siswa  ")).toBe("Siswa");
    expect(normalizePersonnelRole("gUrU")).toBe("Guru");
  });

  test("nilai lain jatuh ke Pegawai, termasuk kosong", () => {
    // Baris karyawan lama boleh saja belum punya `jenis_personil`; ia tetap
    // harus dilayani terminal seperti pegawai biasa, bukan gagal.
    expect(normalizePersonnelRole(null)).toBe("Pegawai");
    expect(normalizePersonnelRole(undefined)).toBe("Pegawai");
    expect(normalizePersonnelRole("")).toBe("Pegawai");
    expect(normalizePersonnelRole("Tenaga Pengajar")).toBe("Pegawai");
    expect(normalizePersonnelRole("Kepala Sekolah")).toBe("Pegawai");
  });

  test("hasilnya selalu salah satu peran yang dikenal", () => {
    for (const masukan of ["SISWA", "GURU", "Pegawai", "apa pun", ""]) {
      expect(PERSONNEL_ROLES).toContain(normalizePersonnelRole(masukan));
    }
  });
});

describe("ATTENDANCE_SOURCE_VALUES", () => {
  test("memuat Import Manual yang sempat hilang dari dua salinannya", () => {
    expect(ATTENDANCE_SOURCE_VALUES).toContain("Import Manual");
  });
});
