"use client";

import { useSyncExternalStore } from "react";
import { getCompanyProfile } from "@/lib/gateways/company-profile";
import { SYNC_COMPLETED_EVENT } from "@/lib/gateways/sync-status";
import { createBrandingMirror } from "./branding-mirror";

/**
 * Cermin lokal agar logo langsung tampil saat aplikasi dibuka, sebelum profil
 * perusahaan selesai dibaca.
 *
 * SUMBER KEBENARAN logo adalah `company_profile.logo_url` yang ikut snapshot
 * sinkronisasi. Versi lama menyimpan logo HANYA di `localStorage` dan
 * memprioritaskannya di atas nilai dari database, sehingga logo tidak pernah
 * sampai ke cloud maupun perangkat lain — dan perangkat yang pernah mengunggah
 * logo tidak akan pernah melihat perubahan dari perangkat lain.
 */
const mirror = createBrandingMirror<string | null>({
  cacheKey: "manajemen_sekolah_custom_logo",
  changeEvent: "manajemen-sekolah:logo-change",
  syncCompletedEvent: SYNC_COMPLETED_EVENT,
  fallback: null,
  decode: (raw) => raw,
  encode: (logo) => logo,
  normalize: (logo) => logo,
  fetchRemote: async () => {
    const profile = await getCompanyProfile();
    return profile.logo_url?.trim() ? profile.logo_url : null;
  },
});

export function useAppLogo(): string | null {
  return useSyncExternalStore(
    mirror.subscribe,
    mirror.getSnapshot,
    mirror.getServerSnapshot,
  );
}

/**
 * Perbarui cermin lokal setelah logo berhasil disimpan ke `company_profile`.
 *
 * Ini BUKAN jalur penyimpanan — pemanggil wajib sudah memanggil
 * `updateCompanyProfile` supaya logo masuk outbox dan terkirim ke cloud.
 */
export function syncAppLogoCache(logoUrl: string | null) {
  mirror.sync(logoUrl);
}
