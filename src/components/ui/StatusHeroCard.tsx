"use client";

import { useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { requestSyncNow } from "@/lib/gateways/sync-status";
import { useOnlineStatus } from "@/lib/hooks/useOnlineStatus";

interface StatusHeroCardProps {
  hadir: number;
  total: number;
  terlambat: number;
  persentase: number;
  isLoading?: boolean;
  onRefresh?: () => void;
  shiftName?: string;
  companyName?: string;
}

export function StatusHeroCard({
  hadir,
  total,
  terlambat,
  persentase,
  isLoading = false,
  onRefresh,
  shiftName = "Shift Pagi",
  companyName = "Sistem Sekolah",
}: StatusHeroCardProps) {
  const isOnline = useOnlineStatus();
  const [isSyncing, setIsSyncing] = useState(false);

  const belumAbsen = Math.max(0, total - hadir);
  const tepatWaktu = Math.max(0, hadir - terlambat);

  const todayDateFormatted = new Intl.DateTimeFormat("id-ID", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date());

  const handleSyncClick = async () => {
    if (isSyncing) return;
    setIsSyncing(true);
    try {
      await requestSyncNow();
      if (onRefresh) onRefresh();
    } catch {
      // Kegagalan pemicu sinkronisasi manual di latar belakang tidak boleh merusak tampilan metrik lokal.
    } finally {
      setTimeout(() => setIsSyncing(false), 800);
    }
  };

  if (isLoading) {
    return (
      <div className="w-full rounded-2xl border border-slate-700/60 bg-slate-900/90 p-5 md:p-6 shadow-card-bca animate-pulse">
        <div className="flex items-center justify-between pb-4 border-b border-slate-800">
          <div className="h-4 w-40 bg-slate-800 rounded-md" />
          <div className="h-6 w-24 bg-slate-800 rounded-full" />
        </div>
        <div className="mt-6 flex flex-col md:flex-row md:items-end justify-between gap-4">
          <div className="space-y-2">
            <div className="h-4 w-28 bg-slate-800 rounded" />
            <div className="h-10 w-36 bg-slate-800 rounded-lg" />
          </div>
          <div className="h-8 w-48 bg-slate-800 rounded" />
        </div>
        <div className="mt-6 grid grid-cols-3 gap-3">
          <div className="h-16 bg-slate-800 rounded-xl" />
          <div className="h-16 bg-slate-800 rounded-xl" />
          <div className="h-16 bg-slate-800 rounded-xl" />
        </div>
      </div>
    );
  }

  return (
    <section
      aria-label="Rangkuman Operasional Presensi Hari Ini"
      className="relative overflow-hidden w-full rounded-2xl border border-blue-200/90 dark:border-blue-900/40 bg-gradient-to-br from-blue-50 via-sky-100/70 to-indigo-50/80 dark:from-[#003399] dark:via-[#002266] dark:to-[#0a183d] text-slate-900 dark:text-white p-5 md:p-6 shadow-sm dark:shadow-card-bca transition-colors duration-200"
    >
      {/* Decorative accent geometry */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-16 -top-16 size-64 rounded-full bg-blue-400/20 dark:bg-sky-500/10 blur-3xl"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -left-16 -bottom-16 size-64 rounded-full bg-sky-400/20 dark:bg-blue-600/15 blur-2xl"
      />

      {/* Header bar of the card */}
      <div className="relative z-10 flex flex-wrap items-center justify-between gap-2 pb-4 border-b border-blue-200/80 dark:border-white/10">
        <div className="flex items-center gap-2">
          <div className="flex size-7 items-center justify-center rounded-lg bg-blue-600/10 dark:bg-white/10 text-blue-700 dark:text-sky-300">
            <Icon name="calendar" className="size-4" />
          </div>
          <div>
            <p className="text-xs font-bold text-blue-950 dark:text-sky-200 capitalize">
              {todayDateFormatted}
            </p>
            <p className="text-[11px] text-blue-800/80 dark:text-sky-300/70 font-medium">
              {companyName} • {shiftName}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Online/Offline Badge */}
          <div
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold backdrop-blur-md ${
              isOnline
                ? "bg-emerald-100 text-emerald-800 border border-emerald-300 dark:bg-emerald-500/20 dark:text-emerald-200 dark:border-emerald-400/30"
                : "bg-amber-100 text-amber-800 border border-amber-300 dark:bg-amber-500/20 dark:text-amber-200 dark:border-amber-400/30"
            }`}
          >
            <span
              className={`size-2 rounded-full ${
                isOnline
                  ? "bg-emerald-500 dark:bg-emerald-400 animate-pulse"
                  : "bg-amber-500 dark:bg-amber-400"
              }`}
            />
            <span>{isOnline ? "Cloud Sinkron" : "Mode Offline"}</span>
          </div>

          {/* Sync action button */}
          <button
            type="button"
            onClick={handleSyncClick}
            disabled={isSyncing}
            aria-label="Sinkronkan data sekarang"
            className="flex size-8 items-center justify-center rounded-lg bg-blue-600/10 hover:bg-blue-600/20 dark:bg-white/10 dark:hover:bg-white/20 active:scale-95 text-blue-800 dark:text-white transition-all disabled:opacity-50"
          >
            <Icon
              name="sync"
              className={`size-4 ${isSyncing ? "animate-spin text-blue-600 dark:text-sky-300" : ""}`}
            />
          </button>
        </div>
      </div>

      {/* Main KPI: The m-BCA Balance Equivalent */}
      <div className="relative z-10 mt-5 flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <span className="text-xs font-bold uppercase tracking-wider text-blue-900/70 dark:text-sky-200/80">
            Tingkat Kehadiran Hari Ini
          </span>
          <div className="flex items-baseline gap-2 mt-1">
            <span className="text-4xl md:text-5xl font-extrabold tracking-tight font-mono-data text-blue-950 dark:text-white">
              {persentase.toFixed(1)}%
            </span>
            <span className="text-sm font-semibold text-blue-900/80 dark:text-sky-200">
              dari target 100%
            </span>
          </div>
        </div>

        {/* Progress bar and counter */}
        <div className="w-full md:w-56 space-y-1.5">
          <div className="flex justify-between text-xs font-semibold">
            <span className="text-blue-950 dark:text-sky-200">Total Masuk</span>
            <span className="font-mono-data text-blue-950 dark:text-white">
              {hadir} / {total} Orang
            </span>
          </div>
          <div className="h-2.5 w-full overflow-hidden rounded-full bg-blue-200/70 dark:bg-black/30 border border-blue-300/50 dark:border-white/10">
            <div
              className="h-full bg-gradient-to-r from-emerald-500 via-teal-400 to-sky-400 dark:from-emerald-400 dark:via-teal-300 dark:to-sky-300 transition-all duration-700 ease-out"
              style={{
                width: `${Math.min(100, Math.max(0, total > 0 ? (hadir / total) * 100 : 0))}%`,
              }}
            />
          </div>
        </div>
      </div>

      {/* 3 Status Counters */}
      <div className="relative z-10 mt-5 grid grid-cols-3 gap-2.5">
        <div className="flex flex-col rounded-xl bg-white/80 dark:bg-white/10 backdrop-blur-md p-3 border border-blue-200/70 dark:border-white/10 shadow-xs dark:shadow-none">
          <span className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-300 flex items-center gap-1">
            <Icon name="check" className="size-3" /> Tepat Waktu
          </span>
          <span className="text-xl md:text-2xl font-bold font-mono-data text-slate-900 dark:text-white mt-0.5">
            {tepatWaktu}
          </span>
        </div>

        <div className="flex flex-col rounded-xl bg-white/80 dark:bg-white/10 backdrop-blur-md p-3 border border-blue-200/70 dark:border-white/10 shadow-xs dark:shadow-none">
          <span className="text-[11px] font-semibold text-amber-700 dark:text-amber-300 flex items-center gap-1">
            <Icon name="clock" className="size-3" /> Terlambat
          </span>
          <span className="text-xl md:text-2xl font-bold font-mono-data text-slate-900 dark:text-white mt-0.5">
            {terlambat}
          </span>
        </div>

        <div className="flex flex-col rounded-xl bg-white/80 dark:bg-white/10 backdrop-blur-md p-3 border border-blue-200/70 dark:border-white/10 shadow-xs dark:shadow-none">
          <span className="text-[11px] font-semibold text-rose-700 dark:text-rose-300 flex items-center gap-1">
            <Icon name="alert" className="size-3" /> Belum Absen
          </span>
          <span className="text-xl md:text-2xl font-bold font-mono-data text-slate-900 dark:text-white mt-0.5">
            {belumAbsen}
          </span>
        </div>
      </div>
    </section>
  );
}
