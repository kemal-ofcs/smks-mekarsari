"use client";

import { Icon } from "@/components/ui/Icon";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import { DeviceProfileCard } from "@/components/visual/DeviceProfileCard";
import { VisualTierControl } from "@/components/visual/VisualTierControl";
import { BRANDING } from "@/lib/constants/branding";

/**
 * Tema Visual pada halaman Pengaturan.
 *
 * Dipisahkan dari halaman Pengaturan demi keterbacaan. Berbeda dengan panel ID
 * Card, seksi ini SELALU dirender bersama seksi lainnya, sehingga pemisahannya
 * TIDAK memperkecil apa pun yang diunduh — yang berubah hanyalah panjang berkas
 * yang harus dibaca orang berikutnya.
 *
 * Nama propsnya sengaja identik dengan nama variabel di halaman induk supaya
 * badan JSX-nya berpindah tanpa satu pun suntingan.
 */
export interface TemaVisualCardProps {
  isOnline: boolean;
}

export function TemaVisualCard({ isOnline }: TemaVisualCardProps) {
  return (
    <section className="app-panel rounded-3xl p-5 sm:p-7">
      <div className="flex items-start gap-4">
        <span className="grid size-11 shrink-0 place-items-center rounded-2xl border border-sky-300/20 bg-sky-300/10 text-sky-200">
          <Icon name="palette" className="size-5" />
        </span>
        <div>
          <h2 className="text-base font-black text-white">Tema & visual</h2>
          <p className="mt-1 text-sm leading-6 text-slate-400">
            Pilih tema tampilan aplikasi dan palet warna visual.
          </p>
        </div>
      </div>

      <div className="mt-5 rounded-2xl border border-white/10 bg-slate-950/40 p-4">
        <p className="text-xs font-bold text-slate-300 mb-2">
          Mode Tema Tampilan:
        </p>
        <ThemeToggle variant="segmented" className="w-full justify-between" />
      </div>

      <div className="mt-4">
        <DeviceProfileCard />
      </div>

      <div className="mt-4">
        <VisualTierControl />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-2 sm:grid-cols-3">
        {[
          ["Putih", "bg-white", "#F8FAFC"],
          ["Biru muda", "bg-sky-400", "#38BDF8"],
          ["Gold", "bg-amber-300", "#F6C453"],
        ].map(([label, color, value]) => (
          <div
            key={label}
            className="rounded-2xl border border-white/10 bg-white/[0.04] p-3"
          >
            <span className={`block h-14 rounded-xl ${color}`} />
            <p className="mt-3 text-xs font-bold text-white">{label}</p>
            <p className="mt-0.5 text-[10px] text-slate-500">{value}</p>
          </div>
        ))}
      </div>

      <dl className="mt-6 divide-y divide-white/10 rounded-2xl border border-white/10 bg-slate-950/50 px-4">
        <div className="flex items-center justify-between gap-4 py-3 text-xs">
          <dt className="text-slate-400">Aplikasi</dt>
          <dd className="font-bold text-white">
            {BRANDING.appDisplayName} v0.1.0
          </dd>
        </div>
        <div className="flex items-center justify-between gap-4 py-3 text-xs">
          <dt className="text-slate-400">Frontend</dt>
          <dd className="font-bold text-sky-200">Next.js 16 · React 19</dd>
        </div>
        <div className="flex items-center justify-between gap-4 py-3 text-xs">
          <dt className="text-slate-400">Desktop</dt>
          <dd className="font-bold text-sky-200">Tauri 2</dd>
        </div>
        <div className="flex items-center justify-between gap-4 py-3 text-xs">
          <dt className="text-slate-400">Jaringan</dt>
          <dd
            className={
              isOnline ? "font-bold text-sky-200" : "font-bold text-amber-200"
            }
          >
            {isOnline ? "Tersedia" : "Tidak tersedia"}
          </dd>
        </div>
      </dl>
    </section>
  );
}
