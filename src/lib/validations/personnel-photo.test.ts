import { describe, expect, test } from "bun:test";
import {
  izinKelolaFoto,
  izinLihatFoto,
  jenisDariLabel,
} from "@/lib/validations/personnel-photo";

// Vektor yang sama diuji di `academic.rs`
// (`izin_foto_mengikuti_jenis_personil`).
describe("izin foto mengikuti jenis personil", () => {
  test("jenis_personil dinormalkan sebelum dibandingkan", () => {
    expect(jenisDariLabel(" SISWA ")).toBe("siswa");
    expect(jenisDariLabel("Guru")).toBe("guru");
    expect(jenisDariLabel("Pegawai")).toBe("karyawan");
    expect(jenisDariLabel("")).toBe("karyawan");
    expect(jenisDariLabel(null)).toBe("karyawan");
  });

  test("mengelola foto butuh izin kelola jenisnya sendiri", () => {
    expect(izinKelolaFoto("siswa")).toBe("students.manage");
    expect(izinKelolaFoto("guru")).toBe("teachers.manage");
    expect(izinKelolaFoto("karyawan")).toBe("employees.manage");
  });

  test("melihat foto tidak meminjam izin jenis lain, kecuali pencetak kartu", () => {
    expect(izinLihatFoto("siswa")).toContain("students.view");
    expect(izinLihatFoto("siswa")).not.toContain("teachers.view");
    expect(izinLihatFoto("guru")).toContain("employees.manage");
  });
});
