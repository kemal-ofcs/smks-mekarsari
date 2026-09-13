/**
 * Konstanta data test untuk Playwright E2E — Absensi SPPG
 *
 * Seluruh nilai enum WAJIB cocok dengan CHECK constraint database
 * dan Zod validator di sync-schema.ts.
 * Jangan ubah nilai ini tanpa menyesuaikan database migration.
 */

// Status siswa yang valid — sesuai STATUS_SISWA di personnel.ts dan CHECK constraint siswa_data
export const STATUS_SISWA_VALID = [
  "Aktif",
  "Lulus",
  "Pindah",
  "Keluar",
  "Drop Out",
] as const;

// Status kepegawaian guru yang valid
export const STATUS_GURU_VALID = [
  "PNS",
  "PPPK",
  "GTY",
  "GTT",
  "Honorer",
  "Kontrak",
] as const;

// Jenis kelamin valid
export const JENIS_KELAMIN_VALID = ["L", "P"] as const;

/**
 * Data siswa contoh untuk test CRUD.
 * NIS dan NISN harus unik di database — gunakan timestamp atau random suffix
 * untuk menghindari konflik antar test run.
 */
export function makeSiswaTestData(suffix: string) {
  return {
    nama_lengkap: `Siswa Test ${suffix}`,
    nis: `NIS-TEST-${suffix}`,
    nisn: `NISN${suffix.padStart(10, "0")}`,
    jenis_kelamin: "L" as const,
    nama_wali: `Wali Test ${suffix}`,
    // Format kanonik +62 sesuai normalizeOperatorPhone
    no_whatsapp_wali: `+6281200000${suffix.slice(-3)}`,
    alamat: `Jl. Test No. ${suffix}`,
    angkatan: new Date().getFullYear(),
    status: "Aktif" as const,
  };
}

/**
 * Data guru contoh untuk test CRUD.
 */
export function makeGuruTestData(suffix: string) {
  return {
    nama_lengkap: `Guru Test ${suffix}`,
    nip: `NIP${suffix.padStart(18, "0")}`,
    jenis_kelamin: "P" as const,
    no_hp: `+6281300000${suffix.slice(-3)}`,
    alamat: `Jl. Guru Test No. ${suffix}`,
    status_kepegawaian: "GTT" as const,
  };
}

/**
 * Route yang dilindungi oleh area guard (canAccessArea).
 * Digunakan di test RBAC untuk memvalidasi redirect ke /forbidden.
 */
export const PROTECTED_ROUTES = [
  { route: "/siswa", area: "siswa", requiredPermission: "students.view" },
  { route: "/guru", area: "guru", requiredPermission: "teachers.view" },
  {
    route: "/karyawan",
    area: "karyawan",
    requiredPermission: "employees.view",
  },
  { route: "/shift", area: "shift", requiredPermission: "shifts.view" },
  {
    route: "/settings",
    area: "settings",
    requiredPermission: "branding.manage",
  },
  {
    route: "/dashboard",
    area: "dashboard",
    requiredPermission: "dashboard.view",
  },
  { route: "/holidays", area: "holidays", requiredPermission: "holidays.view" },
  {
    route: "/operators",
    area: "operators",
    requiredPermission: "operators.view",
  },
  { route: "/payroll", area: "payroll", requiredPermission: "payroll.view" },
] as const;

/**
 * Timeout standar untuk operasi yang melibatkan API call ke database cloud.
 * Lebih panjang dari default Playwright karena Turso Cloud bisa latency tinggi.
 */
export const API_TIMEOUT = 15_000;
