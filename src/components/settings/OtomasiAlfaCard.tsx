"use client";

import { Icon } from "@/components/ui/Icon";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { hasPermission } from "@/lib/auth/access";
import type { useAuth } from "@/lib/context/AuthContext";

/**
 * Otomasi Alfa pada halaman Pengaturan.
 *
 * Dipisahkan dari halaman Pengaturan demi keterbacaan. Berbeda dengan panel ID
 * Card, seksi ini SELALU dirender bersama seksi lainnya, sehingga pemisahannya
 * TIDAK memperkecil apa pun yang diunduh — yang berubah hanyalah panjang berkas
 * yang harus dibaca orang berikutnya.
 *
 * Nama propsnya sengaja identik dengan nama variabel di halaman induk supaya
 * badan JSX-nya berpindah tanpa satu pun suntingan.
 */
export interface OtomasiAlfaCardProps {
  user: ReturnType<typeof useAuth>["user"];
  autoAlfaEnabled: boolean;
  autoAlfaBusy: boolean;
  alfaTriggerBusy: boolean;
  handleAutoAlfaToggle: (enabled: boolean) => Promise<void>;
  handleTriggerAlfaNow: () => Promise<void>;
}

export function OtomasiAlfaCard({
  user,
  autoAlfaEnabled,
  autoAlfaBusy,
  alfaTriggerBusy,
  handleAutoAlfaToggle,
  handleTriggerAlfaNow,
}: OtomasiAlfaCardProps) {
  return (
    <section className="app-panel rounded-3xl p-5 sm:p-7">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-4">
          <span className="grid size-11 shrink-0 place-items-center rounded-2xl border border-amber-300/20 bg-amber-300/10 text-amber-200">
            <Icon name="clock" className="size-5" />
          </span>
          <div>
            <h2 className="text-base font-black text-white">
              Otomasi Generate Alfa Harian
            </h2>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-400">
              Secara otomatis membuat entri status Alfa untuk karyawan aktif
              sesi NORMAL yang belum hadir atau tidak memiliki koreksi
              Sakit/Izin/Dispen setelah batas cutoff shift (jam pulang dikurangi
              offset). Pada hari libur aktif, Generate Alfa otomatis
              dinonaktifkan.
            </p>
          </div>
        </div>
        <StatusBadge tone={autoAlfaEnabled ? "success" : "neutral"}>
          {autoAlfaEnabled ? "Auto-Alfa Aktif" : "Auto-Alfa Nonaktif"}
        </StatusBadge>
      </div>

      <div className="mt-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between rounded-2xl border border-white/10 bg-slate-950/60 p-5">
        <div className="space-y-1">
          <span className="text-sm font-bold text-white">
            Status Otomasi Generate Alfa
          </span>
          <p className="text-xs text-slate-400">
            Matikan tombol ini jika Anda ingin menangguhkan penandaan Alfa
            otomatis di seluruh sistem.
          </p>
        </div>
        <div className="flex items-center gap-4">
          {hasPermission(user, "settings.manage") ? (
            <label className="relative inline-flex cursor-pointer items-center">
              <input
                type="checkbox"
                checked={autoAlfaEnabled}
                disabled={autoAlfaBusy}
                onChange={(e) => handleAutoAlfaToggle(e.target.checked)}
                className="sr-only peer"
              />
              <div className="h-6 w-11 rounded-full bg-slate-800 peer peer-checked:bg-amber-400 peer-focus:outline-none after:absolute after:top-0.5 after:left-[2px] after:h-5 after:w-5 after:rounded-full after:border after:border-slate-300 after:bg-white after:transition-all after:content-[''] peer-checked:after:translate-x-full peer-checked:after:border-white disabled:opacity-50" />
            </label>
          ) : null}
        </div>
      </div>

      {hasPermission(user, "alfa.trigger") ? (
        <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between rounded-2xl border border-white/10 bg-white/[0.02] p-5">
          <div>
            <span className="text-sm font-bold text-white">
              Jalankan Generate Alfa Sekarang
            </span>
            <p className="text-xs text-slate-400">
              Evaluasi kehadiran seluruh karyawan aktif saat ini dan tandai Alfa
              bagi yang telah melewati batas waktu cutoff.
            </p>
          </div>
          <button
            type="button"
            disabled={alfaTriggerBusy}
            onClick={handleTriggerAlfaNow}
            className="flex items-center gap-2 rounded-xl bg-amber-400 px-5 py-2.5 text-xs font-bold text-slate-950 shadow-lg shadow-amber-400/20 transition hover:bg-amber-300 disabled:opacity-50 active:scale-95 shrink-0"
          >
            {alfaTriggerBusy ? (
              <Icon name="clock" className="size-4 animate-spin" />
            ) : (
              <Icon name="check" className="size-4" />
            )}
            <span>
              {alfaTriggerBusy ? "Memproses..." : "Eksekusi Sekarang"}
            </span>
          </button>
        </div>
      ) : null}
    </section>
  );
}
