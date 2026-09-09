"use client";

import type { ChangeEvent } from "react";
import { BrandLogo } from "@/components/ui/BrandLogo";
import { Icon } from "@/components/ui/Icon";
import type { useAppLogo } from "@/lib/hooks/useAppLogo";

/**
 * Logo Aplikasi pada halaman Pengaturan.
 *
 * Dipisahkan dari halaman Pengaturan demi keterbacaan. Berbeda dengan panel ID
 * Card, seksi ini SELALU dirender bersama seksi lainnya, sehingga pemisahannya
 * TIDAK memperkecil apa pun yang diunduh — yang berubah hanyalah panjang berkas
 * yang harus dibaca orang berikutnya.
 *
 * Nama propsnya sengaja identik dengan nama variabel di halaman induk supaya
 * badan JSX-nya berpindah tanpa satu pun suntingan.
 */
export interface LogoAplikasiCardProps {
  logoUrl: ReturnType<typeof useAppLogo>;
  logoBusy: boolean;
  handleLogoUpload: (event: ChangeEvent<HTMLInputElement>) => Promise<void>;
  handleResetLogo: () => Promise<void>;
}

export function LogoAplikasiCard({
  logoUrl,
  logoBusy,
  handleLogoUpload,
  handleResetLogo,
}: LogoAplikasiCardProps) {
  return (
    <section className="app-panel rounded-3xl p-5 sm:p-7">
      <div className="flex items-start gap-4">
        <span className="grid size-11 shrink-0 place-items-center rounded-2xl border border-sky-300/20 bg-sky-300/10 text-sky-200">
          <Icon name="upload" className="size-5" />
        </span>
        <div>
          <h2 className="text-base font-black text-white">Logo aplikasi</h2>
          <p className="mt-1 text-sm leading-6 text-slate-400">
            Gunakan logo persegi atau horizontal dengan latar transparan agar
            tampil konsisten pada header dan laporan.
          </p>
        </div>
      </div>

      <div className="mt-6 grid min-h-56 place-items-center rounded-2xl border border-dashed border-white/15 bg-slate-950/60 p-6 text-center">
        <div className="flex flex-col items-center gap-3">
          <BrandLogo size={96} />
          <div>
            <p className="text-sm font-bold text-white">
              {logoUrl ? "Logo khusus terpasang" : "Logo default"}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              PNG, JPG, atau WebP · Maksimal 1 MB
            </p>
          </div>
        </div>
      </div>

      <div className="mt-5 flex flex-col gap-3 sm:flex-row">
        <label
          htmlFor="logo-upload-input"
          className="inline-flex min-h-11 flex-1 cursor-pointer items-center justify-center gap-2 rounded-xl bg-sky-400 px-4 text-sm font-black text-slate-950 shadow-lg shadow-sky-950/20 transition hover:bg-sky-300 focus-within:ring-2 focus-within:ring-sky-200"
        >
          <Icon name="upload" className="size-4" />
          {logoBusy ? "Menyimpan logo…" : "Pilih logo baru"}
          <input
            id="logo-upload-input"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            disabled={logoBusy}
            onChange={handleLogoUpload}
            className="sr-only"
          />
        </label>
        {logoUrl ? (
          <button
            type="button"
            disabled={logoBusy}
            onClick={handleResetLogo}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.05] px-4 text-sm font-bold text-slate-200 transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300"
          >
            <Icon name="reset" className="size-4" />
            Gunakan default
          </button>
        ) : null}
      </div>

      <p className="mt-4 text-xs leading-5 text-slate-400">
        Logo disimpan pada profil instansi dan ikut antrean sinkronisasi,
        sehingga otomatis diterapkan di Desktop lain maupun Mobile setelah sync
        berikutnya.
      </p>
    </section>
  );
}
