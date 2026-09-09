"use client";

import { requestWebApi } from "@/lib/client/api-client";
import { isDesktopRuntime } from "@/lib/runtime/app-runtime";
import { invokeDesktop } from "@/lib/runtime/desktop-commands";
import type {
  CounselingCaseDetail,
  CounselingCaseDraft,
  CounselingCaseFilter,
  CounselingCaseItem,
  CounselingSessionDraft,
} from "@/types/counseling";

export type {
  CounselingCaseDetail,
  CounselingCaseDraft,
  CounselingCaseFilter,
  CounselingCaseItem,
  CounselingCategory,
  CounselingSessionDraft,
  CounselingSessionItem,
  CounselingStatus,
} from "@/types/counseling";

export async function listCounselingCasesGateway(
  filter?: CounselingCaseFilter,
): Promise<{ items: CounselingCaseItem[] }> {
  if (isDesktopRuntime()) {
    return invokeDesktop<{ items: CounselingCaseItem[] }>(
      "desktop_list_counseling_cases",
      {
        idTahunAjaran: filter?.id_tahun_ajaran ?? null,
        status: filter?.status ?? null,
        kategori: filter?.kategori ?? null,
        idSiswa: filter?.id_siswa ?? null,
        search: filter?.search ?? null,
        limit: filter?.limit ?? null,
      },
    );
  }

  return requestWebApi<{ items: CounselingCaseItem[] }>(
    "/api/academic/counseling/cases/query",
    "POST",
    filter ?? {},
  );
}

export async function getCounselingCaseGateway(
  idKasus: string,
): Promise<CounselingCaseDetail> {
  if (isDesktopRuntime()) {
    return invokeDesktop<CounselingCaseDetail>("desktop_get_counseling_case", {
      idKasus,
    });
  }

  const res = await requestWebApi<{ case: CounselingCaseDetail }>(
    "/api/academic/counseling/cases/get",
    "POST",
    { idKasus },
  );
  return res.case;
}

export async function createCounselingCaseGateway(
  draft: CounselingCaseDraft,
): Promise<{ sukses: boolean; id_kasus: string }> {
  if (isDesktopRuntime()) {
    return invokeDesktop<{ sukses: boolean; id_kasus: string }>(
      "desktop_create_counseling_case",
      { draft },
    );
  }

  return requestWebApi<{ sukses: boolean; id_kasus: string }>(
    "/api/academic/counseling/cases/create",
    "POST",
    draft,
  );
}

export async function updateCounselingCaseGateway(
  idKasus: string,
  draft: Partial<CounselingCaseDraft>,
): Promise<{ sukses: boolean }> {
  if (isDesktopRuntime()) {
    return invokeDesktop<{ sukses: boolean }>(
      "desktop_update_counseling_case",
      { idKasus, draft },
    );
  }

  return requestWebApi<{ sukses: boolean }>(
    "/api/academic/counseling/cases/update",
    "POST",
    { idKasus, draft },
  );
}

export async function deleteCounselingCaseGateway(
  idKasus: string,
): Promise<{ sukses: boolean }> {
  if (isDesktopRuntime()) {
    return invokeDesktop<{ sukses: boolean }>(
      "desktop_delete_counseling_case",
      { idKasus },
    );
  }

  return requestWebApi<{ sukses: boolean }>(
    "/api/academic/counseling/cases/delete",
    "POST",
    { idKasus },
  );
}

export async function addCounselingSessionGateway(
  draft: CounselingSessionDraft,
): Promise<{ sukses: boolean; id_sesi: string }> {
  if (isDesktopRuntime()) {
    return invokeDesktop<{ sukses: boolean; id_sesi: string }>(
      "desktop_add_counseling_session",
      { draft },
    );
  }

  return requestWebApi<{ sukses: boolean; id_sesi: string }>(
    "/api/academic/counseling/sessions/create",
    "POST",
    draft,
  );
}

export async function deleteCounselingSessionGateway(
  idSesi: string,
): Promise<{ sukses: boolean }> {
  if (isDesktopRuntime()) {
    return invokeDesktop<{ sukses: boolean }>(
      "desktop_delete_counseling_session",
      { idSesi },
    );
  }

  return requestWebApi<{ sukses: boolean }>(
    "/api/academic/counseling/sessions/delete",
    "POST",
    { idSesi },
  );
}
