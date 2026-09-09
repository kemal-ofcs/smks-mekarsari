"use client";

import { requestWebApi } from "@/lib/client/api-client";
import { isDesktopRuntime } from "@/lib/runtime/app-runtime";
import { invokeDesktop } from "@/lib/runtime/desktop-commands";

function kickDesktopSync() {
  void invokeDesktop("desktop_sync_now").catch(() => undefined);
}

export interface TeachingJournal {
  id_jurnal: string;
  id_presensi_mapel: string;
  materi_disampaikan: string | null;
  kendala: string | null;
  tindak_lanjut: string | null;
  paraf_nama: string | null;
  paraf_operator: string;
  paraf_at: string;
  created_at: string;
  updated_at: string;
  tanggal?: string;
  jam_ke?: string;
  materi_pokok?: string;
  nama_mapel?: string;
  nama_rombel?: string;
  nama_guru?: string;
}

export interface TeachingJournalFilter {
  id_rombel?: string;
  id_mapel?: string;
  id_guru?: string;
  tanggal_mulai?: string;
  tanggal_selesai?: string;
  limit?: number;
}

export interface SaveTeachingJournalDraft {
  id_jurnal?: string;
  id_presensi_mapel: string;
  materi_disampaikan?: string | null;
  kendala?: string | null;
  tindak_lanjut?: string | null;
  paraf_nama?: string | null;
}

export async function getTeachingJournal(
  idPresensiMapel: string,
): Promise<TeachingJournal | null> {
  if (isDesktopRuntime()) {
    return invokeDesktop<TeachingJournal | null>(
      "desktop_get_teaching_journal",
      {
        idPresensiMapel,
      },
    );
  }
  return requestWebApi<TeachingJournal | null>(
    "/api/academic/journal/query",
    "POST",
    { id_presensi_mapel: idPresensiMapel },
  );
}

export async function listTeachingJournals(
  filter?: TeachingJournalFilter,
): Promise<TeachingJournal[]> {
  if (isDesktopRuntime()) {
    return invokeDesktop<TeachingJournal[]>("desktop_list_teaching_journals", {
      idRombel: filter?.id_rombel || null,
      idMapel: filter?.id_mapel || null,
      idGuru: filter?.id_guru || null,
      tanggalMulai: filter?.tanggal_mulai || null,
      tanggalSelesai: filter?.tanggal_selesai || null,
      limit: filter?.limit ?? null,
    });
  }
  return requestWebApi<TeachingJournal[]>(
    "/api/academic/journal/query",
    "POST",
    filter || {},
  );
}

export async function saveTeachingJournal(draft: SaveTeachingJournalDraft) {
  if (isDesktopRuntime()) {
    const result = await invokeDesktop<{ sukses: boolean; id_jurnal: string }>(
      "desktop_save_teaching_journal",
      { draft },
    );
    kickDesktopSync();
    return result;
  }
  return requestWebApi<{ sukses: boolean; id_jurnal: string }>(
    "/api/academic/journal/save",
    "POST",
    { draft },
  );
}

export async function deleteTeachingJournal(idJurnal: string) {
  if (isDesktopRuntime()) {
    const result = await invokeDesktop<{ sukses: boolean }>(
      "desktop_delete_teaching_journal",
      { idJurnal },
    );
    kickDesktopSync();
    return result;
  }
  return requestWebApi<{ sukses: boolean }>(
    "/api/academic/journal/delete",
    "POST",
    { id_jurnal: idJurnal },
  );
}
