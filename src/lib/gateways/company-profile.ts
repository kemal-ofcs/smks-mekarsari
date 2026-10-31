"use client";

import { requestWebApi } from "@/lib/client/api-client";
import { isDesktopRuntime } from "@/lib/runtime/app-runtime";
import { invokeDesktop } from "@/lib/runtime/desktop-commands";
import type {
  CompanyProfile,
  CompanyProfileInput,
} from "@/types/company-profile";

export type {
  CompanyProfile,
  CompanyProfileInput,
} from "@/types/company-profile";

/** Bisa dibaca tanpa login, untuk layar login dan semua role. */
export async function getPublicBranding(): Promise<{
  company_name: string | null;
  logo_url: string | null;
}> {
  if (isDesktopRuntime()) {
    return invokeDesktop("desktop_get_public_branding");
  }
  const response = await requestWebApi<{
    data: { company_name: string | null; logo_url: string | null };
  }>("/api/settings/branding/query", "POST", {});
  return response.data;
}

export async function getCompanyProfile(): Promise<CompanyProfile> {
  if (isDesktopRuntime()) {
    return invokeDesktop<CompanyProfile>("desktop_get_company_profile");
  }
  const response = await requestWebApi<{ data: CompanyProfile }>(
    "/api/settings/company-profile/query",
    "POST",
    {},
  );
  return response.data;
}

export async function updateCompanyProfile(
  input: CompanyProfileInput,
): Promise<CompanyProfile> {
  if (isDesktopRuntime()) {
    const result = await invokeDesktop<CompanyProfile>(
      "desktop_update_company_profile",
      { profile: input },
    );
    void invokeDesktop("desktop_sync_now").catch(() => undefined);
    return result;
  }
  const response = await requestWebApi<{ data: CompanyProfile }>(
    "/api/settings/company-profile",
    "PUT",
    input,
  );
  return response.data;
}
