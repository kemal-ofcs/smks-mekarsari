"use client";

import { requestWebApi } from "@/lib/client/api-client";
import { isDesktopRuntime } from "@/lib/runtime/app-runtime";
import { invokeDesktop } from "@/lib/runtime/desktop-commands";

function kickDesktopSync() {
  void invokeDesktop("desktop_sync_now").catch(() => undefined);
}

export interface LedgerStudentItem {
  id_siswa: string;
  nis: string | null;
  nisn: string | null;
  nama_lengkap: string;
  id_rombel: string;
  nama_rombel: string;
  id_tahun_ajaran: string;
  semester: string;
  total_hari_efektif: number;
  hadir: number;
  izin: number;
  sakit: number;
  alfa: number;
  dispensasi: number;
  persen_kehadiran: number;
}

export interface FrozenLedgerItem extends LedgerStudentItem {
  id_leger: string;
  dibekukan_at: string;
  dibekukan_oleh: string;
  created_at: string;
  updated_at: string;
}

export interface LedgerPreviewResult {
  id_tahun_ajaran: string;
  semester: string;
  id_rombel: string | null;
  total_hari_efektif: number;
  students: LedgerStudentItem[];
}

export async function getLedgerPreview(
  idTahunAjaran: string,
  semester: string,
  idRombel?: string,
): Promise<LedgerPreviewResult> {
  if (isDesktopRuntime()) {
    return invokeDesktop<LedgerPreviewResult>("desktop_get_ledger_preview", {
      idTahunAjaran,
      semester,
      idRombel: idRombel || null,
    });
  }
  return requestWebApi<LedgerPreviewResult>(
    "/api/academic/ledger/preview",
    "POST",
    {
      id_tahun_ajaran: idTahunAjaran,
      semester,
      id_rombel: idRombel || null,
    },
  );
}

export async function freezeAttendanceLedger(payload: {
  id_tahun_ajaran: string;
  semester: string;
  id_rombel: string;
  items?: Partial<LedgerStudentItem>[];
}) {
  if (isDesktopRuntime()) {
    const result = await invokeDesktop<{
      sukses: boolean;
      total_dibekukan: number;
    }>("desktop_freeze_attendance_ledger", { payload });
    kickDesktopSync();
    return result;
  }
  return requestWebApi<{ sukses: boolean; total_dibekukan: number }>(
    "/api/academic/ledger/freeze",
    "POST",
    payload,
  );
}

export async function getFrozenLedger(
  idTahunAjaran: string,
  semester: string,
  idRombel?: string,
): Promise<FrozenLedgerItem[]> {
  if (isDesktopRuntime()) {
    return invokeDesktop<FrozenLedgerItem[]>("desktop_get_frozen_ledger", {
      idTahunAjaran,
      semester,
      idRombel: idRombel || null,
    });
  }
  return requestWebApi<FrozenLedgerItem[]>(
    "/api/academic/ledger/query",
    "POST",
    {
      id_tahun_ajaran: idTahunAjaran,
      semester,
      id_rombel: idRombel || null,
    },
  );
}

export async function deleteFrozenLedger(
  idTahunAjaran: string,
  semester: string,
  idRombel: string,
) {
  if (isDesktopRuntime()) {
    const result = await invokeDesktop<{
      sukses: boolean;
      deleted_count: number;
    }>("desktop_delete_frozen_ledger", {
      idTahunAjaran,
      semester,
      idRombel,
    });
    kickDesktopSync();
    return result;
  }
  return requestWebApi<{ sukses: boolean; deleted_count: number }>(
    "/api/academic/ledger/delete",
    "POST",
    {
      id_tahun_ajaran: idTahunAjaran,
      semester,
      id_rombel: idRombel,
    },
  );
}
