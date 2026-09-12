"use client";

import { requestWebApi } from "@/lib/client/api-client";
import { isDesktopRuntime } from "@/lib/runtime/app-runtime";
import { invokeDesktop } from "@/lib/runtime/desktop-commands";

function kickDesktopSync() {
  void invokeDesktop("desktop_sync_now").catch(() => undefined);
}

export interface SiswaInput {
  id_siswa?: string;
  nama_lengkap: string;
  nis?: string | null;
  nisn?: string | null;
  jenis_kelamin?: "L" | "P";
  id_rombel: string;
  nama_wali?: string | null;
  no_whatsapp_wali?: string | null;
  alamat?: string | null;
  angkatan?: number;
  status?: string;
  /** Shift yang menentukan jendela jam scan. Kosong = pertahankan yang ada. */
  id_shift?: number;
}

export async function getDaftarSiswa(id_rombel?: string) {
  if (isDesktopRuntime()) {
    // Nama argumennya WAJIB camelCase. Tauri v2 memetakan argumen command
    // snake_case (`id_rombel`) ke camelCase di sisi JS; mengirim `id_rombel`
    // membuat argumennya tidak dikenali dan — karena tipenya `Option<String>` —
    // diam-diam bernilai `None`, sehingga filter rombel tidak pernah berlaku
    // tanpa satu pun pesan galat.
    return invokeDesktop<Record<string, unknown>[]>("desktop_get_students", {
      idRombel: id_rombel || null,
    });
  }
  const response = await requestWebApi<{
    students: Record<string, unknown>[];
  }>("/api/students/query", "POST", {
    id_rombel: id_rombel || undefined,
  });
  return response.students;
}

/**
 * `tundaSinkronisasi` dipakai impor massal: tanpa itu, 800 baris memicu 800
 * siklus sinkronisasi. Pemanggilnya WAJIB memicu `syncNow()` sekali di akhir.
 */
export async function simpanSiswa(
  draft: SiswaInput,
  options: { tundaSinkronisasi?: boolean } = {},
) {
  if (isDesktopRuntime()) {
    const result = await invokeDesktop<{ sukses: boolean; id_siswa: string }>(
      "desktop_save_student",
      { draft },
    );
    if (!options.tundaSinkronisasi) kickDesktopSync();
    return result;
  }
  return requestWebApi<{ sukses: boolean; id_siswa: string }>(
    "/api/students",
    "POST",
    { draft },
  );
}

export async function hapusSiswa(id: string) {
  if (isDesktopRuntime()) {
    const result = await invokeDesktop<{ sukses: boolean }>(
      "desktop_delete_student",
      { id },
    );
    kickDesktopSync();
    return result;
  }
  return requestWebApi<{ sukses: boolean }>("/api/students", "POST", {
    action: "delete",
    id,
  });
}

export async function simpanFotoSiswa(
  idSiswa: string,
  fotoBase64: string,
  fotoMime = "image/jpeg",
) {
  if (isDesktopRuntime()) {
    return invokeDesktop<{ sukses: boolean; id_siswa: string }>(
      "desktop_save_student_photo",
      { idSiswa, fotoBase64, fotoMime },
    );
  }
  return requestWebApi<{ sukses: boolean; id_siswa: string }>(
    "/api/academic/students/photo/upload",
    "POST",
    { id_siswa: idSiswa, foto_base64: fotoBase64, foto_mime: fotoMime },
  );
}

export async function getFotoSiswa(idSiswa: string) {
  if (isDesktopRuntime()) {
    return invokeDesktop<{
      id_siswa: string;
      foto_mime: string;
      foto_base64: string;
      updated_at: string;
    } | null>("desktop_get_student_photo", { idSiswa });
  }
  return requestWebApi<{
    id_siswa: string;
    foto_mime: string;
    foto_base64: string;
    updated_at: string;
  } | null>("/api/academic/students/photo/query", "POST", {
    id_siswa: idSiswa,
  });
}

export async function backfillKartuPelajar() {
  if (isDesktopRuntime()) {
    const res = await invokeDesktop<{
      sukses: boolean;
      total_inserted: number;
    }>("desktop_backfill_id_cards");
    kickDesktopSync();
    return res;
  }
  return requestWebApi<{ sukses: boolean; total_inserted: number }>(
    "/api/academic/id-cards/backfill",
    "POST",
  );
}
