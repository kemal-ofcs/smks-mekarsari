"use client";

import { requestWebApi } from "@/lib/client/api-client";
import { isDesktopRuntime } from "@/lib/runtime/app-runtime";
import { invokeDesktop } from "@/lib/runtime/desktop-commands";

function kickDesktopSync() {
  void invokeDesktop("desktop_sync_now").catch(() => undefined);
}

// ── 1. Tahun Ajaran ─────────────────────────────────────────────────────────

export interface TahunAjaranInput {
  id_tahun_ajaran?: string;
  nama_tahun: string;
  semester: "Ganjil" | "Genap";
  tanggal_mulai: string;
  tanggal_selesai: string;
  is_aktif?: number;
}

export async function getDaftarTahunAjaran() {
  if (isDesktopRuntime()) {
    return invokeDesktop<Record<string, unknown>[]>(
      "desktop_get_academic_years",
    );
  }
  const response = await requestWebApi<{
    years: Record<string, unknown>[];
  }>("/api/academic/years/query", "POST");
  return response.years;
}

export async function simpanTahunAjaran(draft: TahunAjaranInput) {
  if (isDesktopRuntime()) {
    const result = await invokeDesktop<{
      sukses: boolean;
      id_tahun_ajaran: string;
    }>("desktop_save_academic_year", { draft });
    kickDesktopSync();
    return result;
  }
  return requestWebApi<{ sukses: boolean; id_tahun_ajaran: string }>(
    "/api/academic/years",
    "POST",
    { draft },
  );
}

export async function hapusTahunAjaran(id: string) {
  if (isDesktopRuntime()) {
    const result = await invokeDesktop<{ sukses: boolean }>(
      "desktop_delete_academic_year",
      { id },
    );
    kickDesktopSync();
    return result;
  }
  return requestWebApi<{ sukses: boolean }>("/api/academic/years", "POST", {
    action: "delete",
    id,
  });
}

export async function aktifkanTahunAjaran(id: string) {
  if (isDesktopRuntime()) {
    const result = await invokeDesktop<{ sukses: boolean }>(
      "desktop_set_active_academic_year",
      { id },
    );
    kickDesktopSync();
    return result;
  }
  return requestWebApi<{ sukses: boolean }>("/api/academic/years", "POST", {
    action: "set-active",
    id,
  });
}

// ── 2. Jurusan ──────────────────────────────────────────────────────────────

export interface JurusanInput {
  id_jurusan?: string;
  kode_jurusan: string;
  nama_jurusan: string;
  deskripsi?: string | null;
  is_aktif?: number;
}

export async function getDaftarJurusan() {
  if (isDesktopRuntime()) {
    return invokeDesktop<Record<string, unknown>[]>(
      "desktop_get_academic_departments",
    );
  }
  const response = await requestWebApi<{
    departments: Record<string, unknown>[];
  }>("/api/academic/departments/query", "POST");
  return response.departments;
}

export async function simpanJurusan(draft: JurusanInput) {
  if (isDesktopRuntime()) {
    const result = await invokeDesktop<{ sukses: boolean; id_jurusan: string }>(
      "desktop_save_academic_department",
      { draft },
    );
    kickDesktopSync();
    return result;
  }
  return requestWebApi<{ sukses: boolean; id_jurusan: string }>(
    "/api/academic/departments",
    "POST",
    { draft },
  );
}

export async function hapusJurusan(id: string) {
  if (isDesktopRuntime()) {
    const result = await invokeDesktop<{ sukses: boolean }>(
      "desktop_delete_academic_department",
      { id },
    );
    kickDesktopSync();
    return result;
  }
  return requestWebApi<{ sukses: boolean }>(
    "/api/academic/departments",
    "POST",
    {
      action: "delete",
      id,
    },
  );
}

// ── 3. Rombel (Kelas) ───────────────────────────────────────────────────────

export interface RombelInput {
  id_rombel?: string;
  id_tahun_ajaran: string;
  tingkat: number;
  id_jurusan?: string | null;
  nama_rombel: string;
  id_wali_kelas?: string | null;
  kapasitas?: number;
  ruang_kelas?: string | null;
  is_aktif?: number;
}

export async function getDaftarRombel(id_tahun_ajaran?: string) {
  if (isDesktopRuntime()) {
    return invokeDesktop<Record<string, unknown>[]>(
      "desktop_get_academic_classes",
      {
        idTahunAjaran: id_tahun_ajaran,
      },
    );
  }
  const response = await requestWebApi<{
    classes: Record<string, unknown>[];
  }>("/api/academic/classes/query", "POST", { id_tahun_ajaran });
  return response.classes;
}

export async function simpanRombel(draft: RombelInput) {
  if (isDesktopRuntime()) {
    const result = await invokeDesktop<{ sukses: boolean; id_rombel: string }>(
      "desktop_save_academic_class",
      { draft },
    );
    kickDesktopSync();
    return result;
  }
  return requestWebApi<{ sukses: boolean; id_rombel: string }>(
    "/api/academic/classes",
    "POST",
    { draft },
  );
}

export async function hapusRombel(id: string) {
  if (isDesktopRuntime()) {
    const result = await invokeDesktop<{ sukses: boolean }>(
      "desktop_delete_academic_class",
      { id },
    );
    kickDesktopSync();
    return result;
  }
  return requestWebApi<{ sukses: boolean }>("/api/academic/classes", "POST", {
    action: "delete",
    id,
  });
}

// ── 4. Mata Pelajaran (Mapel) ───────────────────────────────────────────────

export interface MapelInput {
  id_mapel?: string;
  kode_mapel: string;
  nama_mapel: string;
  tingkat?: number | null;
  kelompok?: "Wajib" | "Peminatan" | "Muatan Lokal" | "Kejuruan";
  beban_jam?: number;
  kkm?: number;
  is_aktif?: number;
}

export async function getDaftarMapel() {
  if (isDesktopRuntime()) {
    return invokeDesktop<Record<string, unknown>[]>(
      "desktop_get_academic_subjects",
    );
  }
  const response = await requestWebApi<{
    subjects: Record<string, unknown>[];
  }>("/api/academic/subjects/query", "POST");
  return response.subjects;
}

export async function simpanMapel(draft: MapelInput) {
  if (isDesktopRuntime()) {
    const result = await invokeDesktop<{ sukses: boolean; id_mapel: string }>(
      "desktop_save_academic_subject",
      { draft },
    );
    kickDesktopSync();
    return result;
  }
  return requestWebApi<{ sukses: boolean; id_mapel: string }>(
    "/api/academic/subjects",
    "POST",
    { draft },
  );
}

export async function hapusMapel(id: string) {
  if (isDesktopRuntime()) {
    const result = await invokeDesktop<{ sukses: boolean }>(
      "desktop_delete_academic_subject",
      { id },
    );
    kickDesktopSync();
    return result;
  }
  return requestWebApi<{ sukses: boolean }>("/api/academic/subjects", "POST", {
    action: "delete",
    id,
  });
}

// ── 5. Penugasan Guru Mapel (Guru Mapel) ───────────────────────────────────

export interface GuruMapelInput {
  id_penugasan?: string;
  id_tahun_ajaran: string;
  id_rombel: string;
  id_mapel: string;
  id_guru: string;
}

export async function getDaftarPenugasanGuru(id_rombel?: string) {
  if (isDesktopRuntime()) {
    return invokeDesktop<Record<string, unknown>[]>(
      "desktop_get_academic_assignments",
      { idRombel: id_rombel },
    );
  }
  const response = await requestWebApi<{
    assignments: Record<string, unknown>[];
  }>("/api/academic/assignments/query", "POST", { id_rombel });
  return response.assignments;
}

export async function simpanPenugasanGuru(draft: GuruMapelInput) {
  if (isDesktopRuntime()) {
    const result = await invokeDesktop<{
      sukses: boolean;
      id_penugasan: string;
    }>("desktop_save_academic_assignment", { draft });
    kickDesktopSync();
    return result;
  }
  return requestWebApi<{ sukses: boolean; id_penugasan: string }>(
    "/api/academic/assignments",
    "POST",
    { draft },
  );
}

export async function hapusPenugasanGuru(id: string) {
  if (isDesktopRuntime()) {
    const result = await invokeDesktop<{ sukses: boolean }>(
      "desktop_delete_academic_assignment",
      { id },
    );
    kickDesktopSync();
    return result;
  }
  return requestWebApi<{ sukses: boolean }>(
    "/api/academic/assignments",
    "POST",
    {
      action: "delete",
      id,
    },
  );
}
