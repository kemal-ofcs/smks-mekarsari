"use client";

import { Icon } from "@/components/ui/Icon";
import type { WaConfig } from "@/types/wa-notification";

interface WaQueueEmptyDiagnosticProps {
  config: WaConfig | null;
  hasActiveFilter: boolean;
  onResetFilter?: () => void;
  onOpenConfig?: () => void;
  canManage?: boolean;
}

export function WaQueueEmptyDiagnostic({
  config,
  hasActiveFilter,
  onResetFilter,
  onOpenConfig,
  canManage,
}: WaQueueEmptyDiagnosticProps) {
  const allTriggersOff =
    config !== null &&
    !config.scanMasukEnabled &&
    !config.scanPulangEnabled &&
    !config.bolosEnabled &&
    !config.ambangAlfaEnabled;

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6 backdrop-blur">
      {hasActiveFilter ? (
        <div className="flex flex-col items-center justify-center py-4 text-center">
          <div className="grid size-12 place-items-center rounded-2xl bg-amber-500/10 text-amber-400 ring-1 ring-inset ring-amber-500/20 mb-3">
            <Icon name="alert" className="size-6" />
          </div>
          <h4 className="text-sm font-bold text-slate-200">
            Tidak Ada Pesan Sesuai Kriteria Filter
          </h4>
          <p className="mt-1 max-w-md text-xs text-slate-400">
            Antrean tidak ditemukan pada kombinasi filter status, jenis,
            tanggal, atau kata kunci pencarian yang dipilih saat ini.
          </p>
          {onResetFilter && (
            <button
              type="button"
              onClick={onResetFilter}
              className="mt-4 inline-flex items-center gap-2 rounded-xl bg-slate-800 px-4 py-2 text-xs font-semibold text-slate-200 ring-1 ring-slate-700 transition hover:bg-slate-700 hover:text-white active:scale-95"
            >
              <Icon name="refresh" className="size-3.5" />
              Reset Semua Filter
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800 pb-4">
            <div>
              <div className="flex items-center gap-2">
                <span className="grid size-6 place-items-center rounded-lg bg-indigo-500/20 text-indigo-400">
                  <Icon name="alert" className="size-3.5" />
                </span>
                <h4 className="text-sm font-bold text-slate-200">
                  Diagnostik Cerdas Antrean Notifikasi
                </h4>
              </div>
              <p className="mt-1 text-xs text-slate-400">
                Antrean saat ini kosong. Sistem menjalankan verifikasi otomatis
                terhadap status gateway, sakelar pemicu, dan kondisi
                operasional.
              </p>
            </div>
            {canManage && onOpenConfig && (
              <button
                type="button"
                onClick={onOpenConfig}
                className="shrink-0 inline-flex items-center gap-1.5 rounded-xl border border-indigo-500/30 bg-indigo-500/10 px-3 py-1.5 text-xs font-semibold text-indigo-300 transition hover:bg-indigo-500/20"
              >
                <Icon name="settings" className="size-3.5" />
                Konfigurasi Notifikasi
              </button>
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {/* Kartu 1: Status Gateway */}
            <div className="rounded-xl border border-slate-800/80 bg-slate-950/40 p-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-400">
                  Jalur Pengiriman
                </span>
                <span
                  className={`inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-bold ${
                    config?.isActive
                      ? "bg-emerald-500/10 text-emerald-400 ring-1 ring-emerald-500/20"
                      : "bg-sky-500/10 text-sky-400 ring-1 ring-sky-500/20"
                  }`}
                >
                  {config?.isActive ? "API Otomatis" : "Manual (wa.me)"}
                </span>
              </div>
              <p className="mt-2 text-xs font-medium text-slate-200">
                {config?.isActive
                  ? `Pesan dikirim langsung via API ${config?.provider?.toUpperCase() || "FONNTE"}.`
                  : "Gateway API nonaktif. Notifikasi tetap dapat dikirim mandiri 1-klik via WhatsApp Web gratis tanpa biaya kuota."}
              </p>
            </div>

            {/* Kartu 2: Status Pemicu Otomatis */}
            <div className="rounded-xl border border-slate-800/80 bg-slate-950/40 p-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-400">
                  Sakelar Peristiwa
                </span>
                <span
                  className={`inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-bold ${
                    allTriggersOff
                      ? "bg-amber-500/10 text-amber-400 ring-1 ring-amber-500/20"
                      : "bg-emerald-500/10 text-emerald-400 ring-1 ring-emerald-500/20"
                  }`}
                >
                  {allTriggersOff ? "Semua Mati" : "Sebagian / Semua Aktif"}
                </span>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-1.5 text-[11px]">
                <div className="flex items-center gap-1.5 text-slate-300">
                  <span
                    className={`size-1.5 rounded-full ${
                      config?.scanMasukEnabled
                        ? "bg-emerald-400"
                        : "bg-slate-600"
                    }`}
                  />
                  <span>Scan Masuk</span>
                </div>
                <div className="flex items-center gap-1.5 text-slate-300">
                  <span
                    className={`size-1.5 rounded-full ${
                      config?.scanPulangEnabled
                        ? "bg-emerald-400"
                        : "bg-slate-600"
                    }`}
                  />
                  <span>Scan Pulang</span>
                </div>
                <div className="flex items-center gap-1.5 text-slate-300">
                  <span
                    className={`size-1.5 rounded-full ${
                      config?.bolosEnabled ? "bg-emerald-400" : "bg-slate-600"
                    }`}
                  />
                  <span>Bolos KBM</span>
                </div>
                <div className="flex items-center gap-1.5 text-slate-300">
                  <span
                    className={`size-1.5 rounded-full ${
                      config?.ambangAlfaEnabled
                        ? "bg-emerald-400"
                        : "bg-slate-600"
                    }`}
                  />
                  <span>Ambang Alfa</span>
                </div>
              </div>
              {config?.ambangAlfaEnabled && (
                <p className="mt-2 text-[10px] text-slate-500">
                  Batas kritis: &gt;= {config.ambangAlfaLimit ?? 3} Alfa dalam{" "}
                  {config.ambangAlfaDays ?? 30} hari
                </p>
              )}
            </div>

            {/* Kartu 3: Persyaratan Kelayakan Data */}
            <div className="rounded-xl border border-slate-800/80 bg-slate-950/40 p-4 sm:col-span-2 lg:col-span-1">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-400">
                  Syarat Pembuatan Draf
                </span>
                <span className="inline-flex items-center rounded-md bg-slate-800 px-2 py-0.5 text-[10px] font-bold text-slate-300">
                  Nomor Kontak
                </span>
              </div>
              <p className="mt-2 text-xs text-slate-300">
                Pesan hanya masuk antrean bila data profil siswa memiliki nomor
                telepon wali/orang tua yang terisi dalam format kanonik (+62).
              </p>
            </div>
          </div>

          {/* Kesimpulan Operasional */}
          <div
            className={`rounded-xl border p-4 ${
              allTriggersOff
                ? "border-amber-500/20 bg-amber-500/5 text-amber-200"
                : "border-emerald-500/20 bg-emerald-500/5 text-emerald-200"
            }`}
          >
            <div className="flex items-start gap-3">
              <div
                className={`mt-0.5 grid size-5 shrink-0 place-items-center rounded-full ${
                  allTriggersOff
                    ? "bg-amber-500/20 text-amber-400"
                    : "bg-emerald-500/20 text-emerald-400"
                }`}
              >
                <Icon
                  name={allTriggersOff ? "alert" : "check"}
                  className="size-3.5"
                />
              </div>
              <div className="text-xs">
                <p className="font-bold">
                  {allTriggersOff
                    ? "Perhatian: Pemicu Notifikasi Nonaktif"
                    : "Kesimpulan Diagnostik: Kondisi Operasional Tertib"}
                </p>
                <p className="mt-1 text-slate-400">
                  {allTriggersOff
                    ? "Keempat sakelar peristiwa pemicu (Scan Masuk, Scan Pulang, Bolos KBM, Ambang Alfa) dalam keadaan nonaktif. Notifikasi otomatis tidak akan dibangkitkan sebelum salah satu sakelar diaktifkan di menu Pengaturan."
                    : "Tidak ditemukan anomali bolos KBM (siswa tercatat hadir gerbang namun diberi status Alfa di kelas), belum ada siswa yang melampaui ambang batas akumulasi Alfa, dan semua kegiatan presensi berjalan tertib."}
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
