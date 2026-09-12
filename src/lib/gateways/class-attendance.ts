"use client";

import { requestWebApi } from "@/lib/client/api-client";
import { isDesktopRuntime } from "@/lib/runtime/app-runtime";
import { invokeDesktop } from "@/lib/runtime/desktop-commands";

function kickDesktopSync() {
  void invokeDesktop("desktop_sync_now").catch(() => undefined);
}

export interface ClassAttendanceSession {
  id_presensi_mapel: string;
  id_tahun_ajaran: string;
  nama_tahun: string;
  semester: string;
  id_rombel: string;
  nama_rombel: string;
  tingkat: number;
  id_mapel: string;
  nama_mapel: string;
  kode_mapel: string;
  id_guru: string;
  nama_guru: string;
  tanggal: string;
  jam_ke: string;
  materi_pokok?: string | null;
  catatan?: string | null;
  total_hadir: number;
  total_izin: number;
  total_sakit: number;
  total_alfa: number;
  total_dispensasi: number;
  created_at: string;
  updated_at: string;
}

export interface StudentAttendanceDetailItem {
  id_siswa: string;
  nis?: string | null;
  nisn?: string | null;
  nama_lengkap: string;
  jenis_kelamin?: string | null;
  no_whatsapp_wali?: string | null;
  nama_wali?: string | null;
  id_detail?: string | null;
  status: "Hadir" | "Izin" | "Sakit" | "Alfa" | "Dispensasi";
  catatan?: string;
  jam_masuk?: string | null;
  gate_status?: string | null;
}

export interface AttendanceAnomalyItem {
  id_siswa: string;
  nis: string;
  nama_siswa: string;
  id_rombel: string;
  nama_rombel: string;
  tanggal: string;
  jam_masuk_gerbang?: string | null;
  status_gerbang?: string | null;
  id_presensi_mapel: string;
  nama_mapel: string;
  jam_ke: string;
  nama_guru: string;
  status_mapel: string;
  catatan_mapel?: string | null;
  no_whatsapp_wali?: string | null;
  nama_wali?: string | null;
  anomaly_type: "BOLOS_DI_SEKOLAH" | "HADIR_TANPA_SCAN_GERBANG";
  anomaly_label: string;
}

export interface ClassAttendanceFilter {
  id_tahun_ajaran?: string;
  id_rombel?: string;
  id_mapel?: string;
  id_guru?: string;
  tanggal?: string;
  start_date?: string;
  end_date?: string;
  limit?: number;
}

export interface SaveClassAttendanceDraft {
  id_presensi_mapel?: string;
  id_tahun_ajaran: string;
  id_rombel: string;
  id_mapel: string;
  id_guru: string;
  tanggal: string;
  jam_ke: string;
  materi_pokok?: string | null;
  catatan?: string | null;
  items: Array<{
    id_siswa: string;
    status: "Hadir" | "Izin" | "Sakit" | "Alfa" | "Dispensasi";
    catatan?: string | null;
  }>;
}

export async function getDaftarSesiPresensi(filter?: ClassAttendanceFilter) {
  if (isDesktopRuntime()) {
    return invokeDesktop<ClassAttendanceSession[]>(
      "desktop_get_class_attendance_sessions",
      { params: filter || null },
    );
  }
  const response = await requestWebApi<{
    sessions: ClassAttendanceSession[];
  }>("/api/academic/attendance/sessions/query", "POST", filter || {});
  return response.sessions;
}

export async function getDetailSesiPresensi(idPresensiMapel: string) {
  if (isDesktopRuntime()) {
    return invokeDesktop<{
      session: ClassAttendanceSession;
      details: StudentAttendanceDetailItem[];
    }>("desktop_get_class_attendance_detail", { idPresensiMapel });
  }
  return requestWebApi<{
    session: ClassAttendanceSession;
    details: StudentAttendanceDetailItem[];
  }>("/api/academic/attendance/detail/query", "POST", { idPresensiMapel });
}

export async function getRosterUntukPresensi(
  idRombel: string,
  tanggal: string,
) {
  if (isDesktopRuntime()) {
    return invokeDesktop<StudentAttendanceDetailItem[]>(
      "desktop_get_roster_for_attendance",
      { idRombel, tanggal },
    );
  }
  const response = await requestWebApi<{
    roster: StudentAttendanceDetailItem[];
  }>("/api/academic/attendance/roster/query", "POST", { idRombel, tanggal });
  return response.roster;
}

export async function simpanPresensiKelas(draft: SaveClassAttendanceDraft) {
  if (isDesktopRuntime()) {
    const result = await invokeDesktop<{
      sukses: boolean;
      id_presensi_mapel: string;
    }>("desktop_save_class_attendance", { draft });
    kickDesktopSync();
    return result;
  }
  return requestWebApi<{
    sukses: boolean;
    id_presensi_mapel: string;
  }>("/api/academic/attendance/save", "POST", { draft });
}

export async function hapusPresensiKelas(idPresensiMapel: string) {
  if (isDesktopRuntime()) {
    const result = await invokeDesktop<{ sukses: boolean }>(
      "desktop_delete_class_attendance",
      { idPresensiMapel },
    );
    kickDesktopSync();
    return result;
  }
  return requestWebApi<{ sukses: boolean }>(
    "/api/academic/attendance/delete",
    "POST",
    { idPresensiMapel },
  );
}

export const saveClassAttendance = simpanPresensiKelas;
export const deleteClassAttendance = hapusPresensiKelas;

export async function getRekonsiliasiPresensi(filter?: {
  tanggal?: string;
  id_rombel?: string;
}) {
  if (isDesktopRuntime()) {
    return invokeDesktop<{
      tanggal: string;
      anomalies: AttendanceAnomalyItem[];
    }>("desktop_get_attendance_reconciliation", { params: filter || null });
  }
  return requestWebApi<{
    tanggal: string;
    anomalies: AttendanceAnomalyItem[];
  }>("/api/academic/attendance/reconciliation/query", "POST", filter || {});
}

/** Pengaturan jam pelajaran sekolah: jumlah per hari dan lama satu jam. */
export interface JpSettings {
  maxPerHari: number;
  durasiMenit: number;
  /** Pagar terluar yang dieja di kode; batas sekolah tidak boleh melampauinya. */
  batasStruktural: number;
}

export async function getJpSettings(): Promise<JpSettings> {
  if (isDesktopRuntime()) {
    return invokeDesktop<JpSettings>("desktop_get_jp_settings");
  }
  return requestWebApi<JpSettings>("/api/settings/jp", "POST", {});
}

export async function saveJpSettings(
  maxPerHari: number,
  durasiMenit: number,
): Promise<boolean> {
  if (isDesktopRuntime()) {
    const result = await invokeDesktop<{ sukses: boolean }>(
      "desktop_save_jp_settings",
      { maxPerHari, durasiMenit },
    );
    return result.sukses;
  }
  const response = await requestWebApi<{ sukses: boolean }>(
    "/api/settings/jp",
    "PUT",
    { maxPerHari, durasiMenit },
  );
  return response.sukses;
}

/** Satu baris jadwal bel sekolah. */
export interface LessonPeriodRow {
  id_jam_pelajaran: string;
  jam_ke: number;
  jam_mulai: string;
  jam_selesai: string;
  jenis: "KBM" | "Istirahat" | "Upacara" | "Ekstrakurikuler";
  keterangan: string;
  is_aktif: number;
  created_at: string;
  updated_at: string;
}

export async function getLessonPeriods(): Promise<LessonPeriodRow[]> {
  if (isDesktopRuntime()) {
    return invokeDesktop<LessonPeriodRow[]>("desktop_get_lesson_periods");
  }
  const response = await requestWebApi<{ data: LessonPeriodRow[] }>(
    "/api/academic/periods",
    "POST",
    {},
  );
  return response.data;
}

export async function saveLessonPeriod(
  draft: Partial<LessonPeriodRow>,
): Promise<{ sukses: boolean; id_jam_pelajaran?: string }> {
  if (isDesktopRuntime()) {
    return invokeDesktop<{ sukses: boolean; id_jam_pelajaran: string }>(
      "desktop_save_lesson_period",
      { draft },
    );
  }
  return requestWebApi<{ sukses: boolean; id_jam_pelajaran?: string }>(
    "/api/academic/periods",
    "POST",
    { action: "save", draft },
  );
}

export async function deleteLessonPeriod(
  idJamPelajaran: string,
): Promise<{ sukses: boolean }> {
  if (isDesktopRuntime()) {
    return invokeDesktop<{ sukses: boolean }>("desktop_delete_lesson_period", {
      idJamPelajaran,
    });
  }
  return requestWebApi<{ sukses: boolean }>("/api/academic/periods", "POST", {
    action: "delete",
    id: idJamPelajaran,
  });
}
