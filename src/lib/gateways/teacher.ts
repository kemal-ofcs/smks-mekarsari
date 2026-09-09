"use client";

import { requestWebApi } from "@/lib/client/api-client";
import { isDesktopRuntime } from "@/lib/runtime/app-runtime";
import { invokeDesktop } from "@/lib/runtime/desktop-commands";

function kickDesktopSync() {
  void invokeDesktop("desktop_sync_now").catch(() => undefined);
}

export interface GuruInput {
  id_guru?: string;
  nama: string;
  kode_karyawan?: string;
  nip?: string | null;
  nuptk?: string | null;
  gelar?: string | null;
  spesialisasi_mapel?: string | null;
  status_kepegawaian?: string | null;
  no_hp?: string | null;
  lp?: string | null;
  id_shift?: number;
  status_aktif?: string;
}

export async function getDaftarGuru() {
  if (isDesktopRuntime()) {
    return invokeDesktop<Record<string, unknown>[]>("desktop_get_teachers");
  }
  const response = await requestWebApi<{
    teachers: Record<string, unknown>[];
  }>("/api/teachers/query", "POST");
  return response.teachers;
}

export async function simpanGuru(draft: GuruInput) {
  if (isDesktopRuntime()) {
    const result = await invokeDesktop<{ sukses: boolean; id_guru: string }>(
      "desktop_save_teacher",
      { draft },
    );
    kickDesktopSync();
    return result;
  }
  return requestWebApi<{ sukses: boolean; id_guru: string }>(
    "/api/teachers",
    "POST",
    { draft },
  );
}

export async function hapusGuru(id: string) {
  if (isDesktopRuntime()) {
    const result = await invokeDesktop<{ sukses: boolean }>(
      "desktop_delete_teacher",
      { id },
    );
    kickDesktopSync();
    return result;
  }
  return requestWebApi<{ sukses: boolean }>("/api/teachers", "POST", {
    action: "delete",
    id,
  });
}
