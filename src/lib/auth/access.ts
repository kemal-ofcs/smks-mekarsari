import type { PermissionKey } from "@/lib/rbac/catalog";

export type AppArea =
  | "home"
  | "scanner"
  | "dashboard"
  | "history"
  | "akademik"
  | "siswa"
  | "guru"
  | "presensi_kelas"
  | "jurnal_mengajar"
  | "leger_kehadiran"
  | "karyawan"
  | "idcards"
  | "shift"
  | "holidays"
  | "operational"
  | "payroll"
  | "audit"
  | "settings"
  | "operators"
  | "password_reset"
  | "attendance_photo"
  | "diagnostics"
  | "sync"
  | "dasbor_kehadiran"
  | "notifikasi_wa"
  | "bimbingan_konseling"
  | "pmb"
  | "nilai";

export interface AccessSubject {
  isSuperadmin: boolean;
  permissions: readonly PermissionKey[];
}

const AREA_PERMISSION: Record<
  Exclude<AppArea, "operational">,
  PermissionKey
> = {
  home: "home.view",
  scanner: "scanner.use",
  dashboard: "dashboard.view",
  history: "dashboard.view",
  akademik: "academic.view",
  siswa: "students.view",
  guru: "teachers.view",
  presensi_kelas: "class_attendance.view",
  jurnal_mengajar: "teaching_journal.view",
  leger_kehadiran: "attendance_ledger.view",
  dasbor_kehadiran: "attendance_dashboard.view",
  notifikasi_wa: "notification.view",
  bimbingan_konseling: "counseling.view",
  pmb: "pmb.view",
  nilai: "grades.view",
  karyawan: "employees.view",
  idcards: "employees.manage",
  shift: "shifts.view",
  holidays: "holidays.view",
  payroll: "payroll.view",
  audit: "attendance_audit.view",
  settings: "branding.manage",
  operators: "operators.view",
  password_reset: "password_reset.view",
  attendance_photo: "attendance_photo.view",
  diagnostics: "diagnostics.view",
  // Halaman status sinkronisasi menampilkan konflik, yang memuat payload lintas
  // domain. `sync.view` sudah ada di paket bawaan peran operator DAN scanner,
  // jadi memasang penjaganya tidak mencabut akses siapa pun.
  sync: "sync.view",
};

export function hasPermission(
  subject: AccessSubject | null | undefined,
  permission: PermissionKey,
) {
  if (!subject) return false;
  return subject.isSuperadmin || subject.permissions.includes(permission);
}

export function canAccessArea(
  subject: AccessSubject | null | undefined,
  area: AppArea,
) {
  if (area === "operational") {
    return (
      hasPermission(subject, "corrections.view") ||
      hasPermission(subject, "backups.view")
    );
  }
  return hasPermission(subject, AREA_PERMISSION[area]);
}
