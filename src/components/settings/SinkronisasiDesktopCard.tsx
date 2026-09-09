"use client";

import { hasPermission } from "@/lib/auth/access";
import type { useAuth } from "@/lib/context/AuthContext";
import type { SyncConflict, SyncStatus } from "@/lib/gateways/sync-status";

const SYNC_TABLE_LABELS = [
  ["employees", "Karyawan"],
  ["idCards", "ID Card"],
  ["shifts", "Shift"],
  ["holidays", "Hari Libur"],
  ["settings", "Pengaturan"],
  ["companyProfiles", "Profil Instansi"],
  ["idCardTemplates", "Template ID Card"],
  ["backups", "Penugasan backup"],
  ["corrections", "Koreksi"],
  ["imports", "Import offline"],
  ["attendance", "Absensi harian"],
  ["scanLogs", "Riwayat scan"],
  ["payrollRuns", "Batch Payroll"],
  ["payrollItems", "Slip Gaji"],
  ["salaryConfigs", "Rate Gaji"],
] as const;

function formatSyncTime(timestamp: number | null | undefined) {
  if (!timestamp) return "Belum pernah berhasil";
  return new Intl.DateTimeFormat("id-ID", {
    dateStyle: "medium",
    timeStyle: "medium",
  }).format(new Date(timestamp * 1000));
}

/**
 * Sinkronisasi Desktop pada halaman Pengaturan.
 *
 * Dipisahkan dari halaman Pengaturan demi keterbacaan. Berbeda dengan panel ID
 * Card, seksi ini SELALU dirender bersama seksi lainnya, sehingga pemisahannya
 * TIDAK memperkecil apa pun yang diunduh — yang berubah hanyalah panjang berkas
 * yang harus dibaca orang berikutnya.
 *
 * Nama propsnya sengaja identik dengan nama variabel di halaman induk supaya
 * badan JSX-nya berpindah tanpa satu pun suntingan.
 */
export interface SinkronisasiDesktopCardProps {
  user: ReturnType<typeof useAuth>["user"];
  syncStatus: SyncStatus | null;
  conflicts: SyncConflict[];
  syncBusy: boolean;
  autoSyncError: string | null;
  isOnline: boolean;
  refreshSync: (synchronize?: boolean) => Promise<void>;
  retryFailed: () => Promise<void>;
  clearFailed: () => Promise<void>;
  resolveConflicts: (eventId?: string) => Promise<void>;
  resolveConflictsLocal: (eventId?: string) => Promise<void>;
  resyncSettings: () => Promise<void>;
}

export function SinkronisasiDesktopCard({
  user,
  syncStatus,
  conflicts,
  syncBusy,
  autoSyncError,
  isOnline,
  refreshSync,
  retryFailed,
  clearFailed,
  resolveConflicts,
  resolveConflictsLocal,
  resyncSettings,
}: SinkronisasiDesktopCardProps) {
  return (
    <section className="app-panel rounded-3xl p-5 sm:p-7">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-base font-black text-white">
            Sinkronisasi Desktop
          </h2>
          <p className="mt-1 text-sm text-slate-400">
            Perubahan lokal dikirim ke server, kemudian snapshot operasional
            server diterapkan kembali ke database Desktop.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={syncBusy}
            onClick={() => refreshSync(false)}
            className="min-h-10 rounded-xl border border-white/10 px-4 text-xs font-bold text-slate-200 disabled:opacity-50"
          >
            Periksa status
          </button>
          <button
            type="button"
            disabled={syncBusy || !isOnline}
            onClick={() => refreshSync(true)}
            className="min-h-10 rounded-xl bg-sky-400 px-4 text-xs font-black text-slate-950 disabled:opacity-50"
          >
            Sinkronkan sekarang
          </button>
          <button
            type="button"
            disabled={syncBusy || !isOnline}
            onClick={resyncSettings}
            className="min-h-10 rounded-xl border border-sky-400/40 bg-sky-400/10 px-4 text-xs font-bold text-sky-200 hover:bg-sky-400/20 disabled:opacity-50"
            title="Kirim ulang data Profil Perusahaan & Template ID Card lokal ke server"
          >
            Kirim ulang pengaturan lokal
          </button>
          {hasPermission(user, "sync.retry") &&
          (syncStatus?.failed ?? 0) > 0 ? (
            <>
              <button
                type="button"
                disabled={syncBusy || !isOnline}
                onClick={retryFailed}
                className="min-h-10 rounded-xl bg-amber-300 px-4 text-xs font-black text-slate-950 disabled:opacity-50"
              >
                Coba ulang gagal
              </button>
              <button
                type="button"
                disabled={syncBusy}
                onClick={clearFailed}
                className="min-h-10 rounded-xl border border-rose-400/40 bg-rose-400/10 px-4 text-xs font-bold text-rose-200 hover:bg-rose-400/20 disabled:opacity-50"
              >
                Bersihkan antrean gagal
              </button>
            </>
          ) : null}
        </div>
      </div>

      {autoSyncError ? (
        <div className="mt-4 rounded-2xl border border-rose-400/40 bg-rose-400/10 p-4">
          <p className="text-xs font-black text-rose-200">
            Sinkronisasi otomatis terakhir gagal
          </p>
          <p className="mt-1 break-words text-xs text-rose-100/80">
            {autoSyncError}
          </p>
        </div>
      ) : null}

      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ["Menunggu", syncStatus?.pending ?? 0],
          ["Event terkirim (total)", syncStatus?.synced ?? 0],
          ["Gagal", syncStatus?.failed ?? 0],
          ["Konflik", syncStatus?.conflict ?? 0],
        ].map(([label, value]) => (
          <div
            key={label}
            className="rounded-2xl border border-white/10 bg-slate-950/50 p-4"
          >
            <p className="text-xs text-slate-400">{label}</p>
            <p className="mt-1 text-2xl font-black text-white">{value}</p>
          </div>
        ))}
      </div>
      <div className="mt-4 rounded-2xl border border-white/10 bg-slate-950/50 p-4">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm font-black text-white">
            Snapshot operasional lokal
          </p>
          <p className="text-xs text-slate-400">
            Terakhir berhasil: {formatSyncTime(syncStatus?.lastSyncAt)} · Revisi{" "}
            {syncStatus?.lastRevision ?? 0}
          </p>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          {SYNC_TABLE_LABELS.map(([key, label]) => (
            <div
              key={key}
              className="rounded-xl border border-white/5 bg-white/[0.03] px-3 py-2"
            >
              <p className="text-[11px] text-slate-400">{label}</p>
              <p className="mt-0.5 text-lg font-black text-white">
                {syncStatus?.tableCounts?.[key] ?? 0}
              </p>
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs leading-5 text-slate-400">
          Snapshot mencakup sembilan tabel operasional di atas. Riwayat absensi,
          koreksi, backup, dan import dibatasi 31 hari terakhir; riwayat scan
          maksimal 5.000 baris. Operator, role, session, dan audit keamanan
          tetap dikelola server dan tidak disalin ke database operasional
          offline.
        </p>
      </div>
      {conflicts.length > 0 ? (
        <div className="mt-5 rounded-2xl border border-rose-400/20 bg-rose-400/5 p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-black text-rose-100">
                Konflik perlu ditinjau ({conflicts.length})
              </p>
              <p className="mt-0.5 text-xs text-slate-400">
                Konflik terjadi saat data lokal berbeda versi dengan master
                cloud.
              </p>
            </div>
            {hasPermission(user, "sync.retry") ? (
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={syncBusy}
                  onClick={() => resolveConflictsLocal()}
                  className="min-h-9 rounded-xl bg-sky-400/20 px-3.5 text-xs font-black text-sky-200 hover:bg-sky-400/30 disabled:opacity-50"
                >
                  Pakai Semua Data Lokal (Timpa Cloud)
                </button>
                <button
                  type="button"
                  disabled={syncBusy}
                  onClick={() => resolveConflicts()}
                  className="min-h-9 rounded-xl bg-rose-400/20 px-3.5 text-xs font-black text-rose-100 hover:bg-rose-400/30 disabled:opacity-50"
                >
                  Selesaikan Semua (Ikuti Cloud)
                </button>
              </div>
            ) : null}
          </div>
          <ul className="mt-3 space-y-2 text-xs text-rose-100/80">
            {conflicts.slice(0, 15).map((item) => (
              <li
                key={item.eventId}
                className="flex flex-col gap-2 rounded-xl border border-rose-400/10 bg-slate-950/60 p-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0 flex-1">
                  <span className="font-bold text-white">
                    {item.domain} · {item.entityKey}
                  </span>{" "}
                  <span className="text-rose-200/80">— {item.reason}</span>
                </div>
                {hasPermission(user, "sync.retry") ? (
                  <div className="flex shrink-0 items-center gap-2 self-end sm:self-auto">
                    <button
                      type="button"
                      disabled={syncBusy}
                      onClick={() => resolveConflictsLocal(item.eventId)}
                      className="rounded-lg border border-sky-400/30 bg-sky-400/10 px-2.5 py-1 text-[11px] font-bold text-sky-200 hover:bg-sky-400/20 disabled:opacity-50"
                    >
                      Gunakan Versi Lokal
                    </button>
                    <button
                      type="button"
                      disabled={syncBusy}
                      onClick={() => resolveConflicts(item.eventId)}
                      className="rounded-lg border border-white/10 bg-white/[0.05] px-2.5 py-1 text-[11px] font-bold text-slate-200 hover:bg-white/10 disabled:opacity-50"
                    >
                      Ikuti Cloud
                    </button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-slate-400">
            Pilih <strong>Gunakan Versi Lokal</strong> untuk memaksa data
            perubahan di perangkat ini terkirim ke server Cloud, atau{" "}
            <strong>Ikuti Cloud</strong> untuk membuang perubahan lokal dan
            mengikuti snapshot master server.
          </p>
        </div>
      ) : null}
    </section>
  );
}
