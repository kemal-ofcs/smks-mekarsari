"use client";

import { requestWebApi } from "@/lib/client/api-client";
import { isDesktopRuntime } from "@/lib/runtime/app-runtime";
import { invokeDesktop } from "@/lib/runtime/desktop-commands";

export type WaliCredentialStatusKind = "bawaan" | "diubah" | "belum_ada";

export interface WaliCredentialStatus {
  idSiswa: string;
  status: WaliCredentialStatusKind;
  changedAt: string | null;
}

export interface WaliSlipCredential {
  idSiswa: string;
  namaSiswa: string;
  nis: string | null;
  nisn: string | null;
  rombel: string | null;
  unit: string | null;
  /** Hanya terisi pada balasan penerbitan; database memegang hash-nya saja. */
  password: string | null;
  status: WaliCredentialStatusKind;
}

export async function getWaliCredentialStatus(
  idSiswa: string,
): Promise<WaliCredentialStatus> {
  if (isDesktopRuntime()) {
    return invokeDesktop<WaliCredentialStatus>(
      "desktop_get_wali_credential_status",
      { idSiswa },
    );
  }
  return requestWebApi<WaliCredentialStatus>(
    "/api/academic/wali-credentials",
    "POST",
    {
      action: "status",
      id_siswa: idSiswa,
    },
  );
}

export async function resetWaliPassword(
  idSiswa: string,
): Promise<{ sukses: boolean; password: string }> {
  if (isDesktopRuntime()) {
    return invokeDesktop<{ sukses: boolean; password: string }>(
      "desktop_reset_wali_password",
      { idSiswa },
    );
  }
  return requestWebApi<{ sukses: boolean; password: string }>(
    "/api/academic/wali-credentials",
    "POST",
    {
      action: "reset",
      id_siswa: idSiswa,
    },
  );
}

export async function bulkIssueWaliPasswords(idSiswaList?: string[]): Promise<{
  sukses: boolean;
  count: number;
  credentials: WaliSlipCredential[];
}> {
  if (isDesktopRuntime()) {
    return invokeDesktop<{
      sukses: boolean;
      count: number;
      credentials: WaliSlipCredential[];
    }>("desktop_bulk_issue_wali_passwords", {
      idSiswaList: idSiswaList ?? null,
    });
  }
  return requestWebApi<{
    sukses: boolean;
    count: number;
    credentials: WaliSlipCredential[];
  }>("/api/academic/wali-credentials", "POST", {
    action: "bulk_issue",
    id_siswa_list: idSiswaList ?? null,
  });
}

export async function getWaliCredentialsForPrinting(
  idSiswaList?: string[],
): Promise<WaliSlipCredential[]> {
  if (isDesktopRuntime()) {
    return invokeDesktop<WaliSlipCredential[]>(
      "desktop_get_wali_credentials_for_printing",
      { idSiswaList: idSiswaList ?? null },
    );
  }
  const res = await requestWebApi<{ credentials: WaliSlipCredential[] }>(
    "/api/academic/wali-credentials",
    "POST",
    {
      action: "print_slips",
      id_siswa_list: idSiswaList ?? null,
    },
  );
  return res.credentials;
}
