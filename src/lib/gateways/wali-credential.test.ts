import { describe, expect, test } from "bun:test";
import { hashPasswordValue, verifyPassword } from "@/lib/auth/password";
import {
  buatPasswordWaliAcak,
  WALI_PASSWORD_ALPHABET,
  WALI_PASSWORD_LENGTH,
} from "@/lib/auth/wali-password";
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

  // Alfabet dan panjang yang sama diuji
  // `password_wali_acak_memakai_alfabet_yang_sama_dengan_web` di `academic.rs`.
  test("Password sementara wali acak dari alfabet tanpa karakter kembar-rupa", () => {
    expect(WALI_PASSWORD_ALPHABET).toBe("ABCDEFGHJKMNPQRSTUVWXYZ23456789");
    expect(WALI_PASSWORD_LENGTH).toBe(10);
    const pertama = buatPasswordWaliAcak();
    expect(pertama).toHaveLength(WALI_PASSWORD_LENGTH);
    expect([...pertama].every((c) => WALI_PASSWORD_ALPHABET.includes(c))).toBe(
      true,
    );
    expect(buatPasswordWaliAcak()).not.toBe(pertama);
  });

  test("Paritas hashing PBKDF2 600k iterasi kompatibel antara helper TS dan verifikasi", async () => {
    const rawPassword = "K7PQ2MXH9A";
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
      password: null,
      status: "bawaan",
    };

    expect(mockSlip.namaSiswa).toBe("Ahmad Siswa");
    expect(mockSlip.unit).toBe("SMK");
  });
});
