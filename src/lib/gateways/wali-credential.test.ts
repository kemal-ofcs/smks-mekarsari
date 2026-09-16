import { describe, expect, test } from "bun:test";
import { hashPasswordValue, verifyPassword } from "@/lib/auth/password";
import {
  PERMISSION_CATALOG,
  SENSITIVE_MUTATION_PERMISSIONS,
} from "@/lib/rbac/catalog";
import type {
  WaliCredentialStatus,
  WaliSlipCredential,
} from "./wali-credential";

describe("Tahap B: Kredensial & Password Portal Wali", () => {
  test("Permission 'students.reset_wali_password' terdaftar dalam katalog RBAC dan masuk SENSITIVE_MUTATION_PERMISSIONS", () => {
    const perm = PERMISSION_CATALOG.find(
      (p) => p.key === "students.reset_wali_password",
    );
    expect(perm).toBeDefined();
    expect(perm?.group).toBe("Akademik");

    expect(
      SENSITIVE_MUTATION_PERMISSIONS.has("students.reset_wali_password"),
    ).toBe(true);
  });

  test("Formula kata sandi default wali: NISN/NIS + UNIT (uppercase)", () => {
    function computeDefaultPassword(
      nis: string | null,
      nisn: string | null,
      unit: string | null,
    ): string {
      const base = (nisn || nis || "").trim();
      const u = (unit || "").trim().toUpperCase();
      return `${base}${u}`;
    }

    // Kasus 1: Ada NISN dan Unit
    expect(computeDefaultPassword("12345", "0012345678", "smk")).toBe(
      "0012345678SMK",
    );

    // Kasus 2: Hanya NIS dan Unit
    expect(computeDefaultPassword("12345", "", "sma")).toBe("12345SMA");

    // Kasus 3: Ada NISN tanpa Unit
    expect(computeDefaultPassword("12345", "0012345678", null)).toBe(
      "0012345678",
    );

    // Kasus 4: Unit dengan spasi atau huruf kecil
    expect(computeDefaultPassword("54321", null, " smk ")).toBe("54321SMK");
  });

  test("Paritas hashing PBKDF2 600k iterasi kompatibel antara helper TS dan verifikasi", async () => {
    const rawPassword = "0012345678SMK";
    const hashed = await hashPasswordValue(rawPassword);

    expect(hashed.startsWith("pbkdf2-sha256$600000$")).toBe(true);

    const isValid = await verifyPassword(rawPassword, hashed);
    expect(isValid.valid).toBe(true);

    const isWrong = await verifyPassword("salah_password", hashed);
    expect(isWrong.valid).toBe(false);
  });

  test("Kontrak tipe WaliCredentialStatus dan WaliSlipCredential terstruktur dengan baik", () => {
    const mockStatus: WaliCredentialStatus = {
      idSiswa: "sis-001",
      status: "bawaan",
      changedAt: null,
      defaultPassword: "0012345678SMK",
    };

    expect(mockStatus.status).toBe("bawaan");
    expect(mockStatus.changedAt).toBeNull();

    const mockSlip: WaliSlipCredential = {
      idSiswa: "sis-001",
      namaSiswa: "Ahmad Siswa",
      nis: "12345",
      nisn: "0012345678",
      rombel: "X RPL 1",
      unit: "SMK",
      defaultPassword: "0012345678SMK",
      status: "bawaan",
    };

    expect(mockSlip.namaSiswa).toBe("Ahmad Siswa");
    expect(mockSlip.unit).toBe("SMK");
  });
});
