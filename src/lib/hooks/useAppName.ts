"use client";

import { useSyncExternalStore } from "react";
import { BRANDING } from "@/lib/constants/branding";
import { getAppDisplayName } from "@/lib/gateways/app-setting";
import { SYNC_COMPLETED_EVENT } from "@/lib/gateways/sync-status";
import { createBrandingMirror } from "./branding-mirror";

/**
 * Cermin lokal nama tampilan aplikasi untuk render UI 0ms tanpa delay.
 *
 * SUMBER KEBENARAN nama aplikasi adalah `setting_gex_system` dengan kunci
 * `app_display_name` yang ikut snapshot sinkronisasi Turso. Cache localStorage
 * hanya cermin display instan saat cold-start.
 */
const mirror = createBrandingMirror<string>({
  cacheKey: "app_branding_display_name",
  changeEvent: "app-attendance:branding-name-change",
  syncCompletedEvent: SYNC_COMPLETED_EVENT,
  fallback: BRANDING.appDisplayName,
  decode: (raw) => raw?.trim() || BRANDING.appDisplayName,
  encode: (name) => name?.trim() || null,
  normalize: (name) => name?.trim() || BRANDING.appDisplayName,
  fetchRemote: async () => {
    const name = await getAppDisplayName();
    return name?.trim() || BRANDING.appDisplayName;
  },
});

/** Hook untuk mendapatkan nama tampilan aplikasi secara reaktif (0ms cold start). */
export function useAppName(): string {
  return useSyncExternalStore(
    mirror.subscribe,
    mirror.getSnapshot,
    mirror.getServerSnapshot,
  );
}

/**
 * Perbarui cermin lokal setelah nama berhasil disimpan ke `setting_gex_system`.
 */
export function syncAppNameCache(name: string | null) {
  mirror.sync(name?.trim() || BRANDING.appDisplayName);
}
