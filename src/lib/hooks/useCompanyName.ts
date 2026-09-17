"use client";

import { useSyncExternalStore } from "react";
import { BRANDING } from "@/lib/constants/branding";
import { getCompanyProfile } from "@/lib/gateways/company-profile";
import { SYNC_COMPLETED_EVENT } from "@/lib/gateways/sync-status";
import { createBrandingMirror } from "./branding-mirror";

/**
 * Cermin lokal nama perusahaan untuk tampilan UI tanpa delay.
 *
 * SUMBER KEBENARAN nama adalah `company_profile.company_name` yang ikut
 * snapshot sinkronisasi Turso. Cache localStorage hanya cermin display —
 * bukan sumber kebenaran data bisnis.
 */
const mirror = createBrandingMirror<string>({
  cacheKey: "company_branding_name",
  changeEvent: "company-attendance:branding-change",
  syncCompletedEvent: SYNC_COMPLETED_EVENT,
  fallback: BRANDING.defaultCompanyName,
  decode: (raw) => raw?.trim() || BRANDING.defaultCompanyName,
  encode: (name) => name?.trim() || null,
  normalize: (name) => name?.trim() || BRANDING.defaultCompanyName,
  fetchRemote: async () => {
    const profile = await getCompanyProfile();
    return profile.company_name?.trim() || BRANDING.defaultCompanyName;
  },
});

/** Hook untuk mendapatkan nama perusahaan secara reaktif (0ms cold start). */
export function useCompanyName(): string {
  return useSyncExternalStore(
    mirror.subscribe,
    mirror.getSnapshot,
    mirror.getServerSnapshot,
  );
}

/**
 * Perbarui cermin lokal setelah nama berhasil disimpan ke `company_profile`.
 *
 * Ini BUKAN jalur penyimpanan — pemanggil wajib sudah memanggil
 * `updateCompanyProfile` supaya nama masuk outbox dan terkirim ke cloud.
 * Dipanggil berdampingan dengan `syncAppLogoCache` di handleCompanyProfileSubmit.
 */
export function syncCompanyNameCache(name: string | null) {
  mirror.sync(name?.trim() || BRANDING.defaultCompanyName);
}
