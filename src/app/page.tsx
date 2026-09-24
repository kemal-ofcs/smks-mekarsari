"use client";

import Link from "next/link";
import { redirect } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { LicenseHolderLabel } from "@/components/license/LicenseNotice";
import { FeedbackBanner } from "@/components/ui/FeedbackBanner";
import { Icon } from "@/components/ui/Icon";
import { QuickActionGrid } from "@/components/ui/QuickActionGrid";
import { StatusBadgePill } from "@/components/ui/StatusBadgePill";
import { StatusHeroCard } from "@/components/ui/StatusHeroCard";
import { canAccessArea, hasPermission } from "@/lib/auth/access";
import { BRANDING } from "@/lib/constants/branding";
import { useAuth } from "@/lib/context/AuthContext";
import {
  type DashboardMetrics,
  getDashboardMetrics,
  getRiwayatScan,
} from "@/lib/gateways/report";
import { subscribeSyncCompleted } from "@/lib/gateways/sync-status";
import { useCompanyName } from "@/lib/hooks/useCompanyName";
import { useHydrated } from "@/lib/hooks/useHydrated";

interface RecentScanItem {
  id_karyawan?: string;
  nama_karyawan?: string;
  waktu_scan?: string;
  jam?: string;
  status_kehadiran?: string;
  tipe_scan?: string;
  divisi?: string;
}

function getLocalGreeting(hours: number): string {
  if (hours >= 4 && hours < 11) return "Selamat Pagi";
  if (hours >= 11 && hours < 15) return "Selamat Siang";
  if (hours >= 15 && hours < 18) return "Selamat Sore";
  return "Selamat Malam";
}

export default function Home() {
  const isHydrated = useHydrated();
  const { user, isAuthenticated, isLoading: authLoading } = useAuth();
  const companyName = useCompanyName();
  const canViewDashboard = hasPermission(user, "dashboard.view");

  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [metricsLoading, setMetricsLoading] = useState<boolean>(true);
  const [metricsError, setMetricsError] = useState<string | null>(null);
  const [recentScans, setRecentScans] = useState<RecentScanItem[]>([]);
  const [currentTimeStr, setCurrentTimeStr] = useState<string>("");
  const [currentDateStr, setCurrentDateStr] = useState<string>("");
  const [greeting, setGreeting] = useState<string>("Selamat datang");

  // Real-time digital clock
  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setGreeting(getLocalGreeting(now.getHours()));
      setCurrentTimeStr(
        now.toLocaleTimeString("id-ID", {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          hour12: false,
        }),
      );
      setCurrentDateStr(
        now.toLocaleDateString("id-ID", {
          weekday: "long",
          day: "numeric",
          month: "long",
          year: "numeric",
        }),
      );
    };

    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  // Fetch Dashboard summary metrics & recent scans
  const loadData = useCallback(async () => {
    if (!isAuthenticated || !canViewDashboard) return;

    setMetricsLoading(true);
    setMetricsError(null);
    try {
      const [metricsData, scansData] = await Promise.all([
        getDashboardMetrics(),
        getRiwayatScan({ limit: 5 }).catch(() => []),
      ]);
      setMetrics(metricsData);
      setRecentScans((scansData as unknown as RecentScanItem[]) || []);
    } catch (error: unknown) {
      setMetricsError(
        error instanceof Error
          ? error.message
          : "Ringkasan kehadiran belum dapat dimuat.",
      );
    } finally {
      setMetricsLoading(false);
    }
  }, [isAuthenticated, canViewDashboard]);

  useEffect(() => {
    if (!isHydrated) return;
    loadData();

    // Auto reload when sync completes
    const unsubscribe = subscribeSyncCompleted(() => {
      loadData();
    });
    return () => unsubscribe();
  }, [isHydrated, loadData]);

  if (!isHydrated || authLoading) {
    return (
      <div className="grid min-h-dvh place-items-center bg-slate-950 p-6 text-slate-100">
        <output className="flex flex-col items-center gap-3">
          <div className="size-10 animate-spin rounded-full border-4 border-blue-500 border-t-transparent" />
          <p className="text-xs font-medium text-slate-400">
            Memuat Pusat Operasional {BRANDING.appDisplayName}...
          </p>
        </output>
      </div>
    );
  }

  if (!isAuthenticated) redirect("/login");
  if (!canAccessArea(user, "home")) redirect("/forbidden");

  return (
    <AppShell contentClassName="mx-auto w-full max-w-5xl space-y-6 px-4 py-5 sm:px-6 md:py-7">
      {/* 1. Header Ringkas Pengguna */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-1">
        <div>
          <h1 className="text-xl sm:text-2xl font-black tracking-tight text-slate-900 dark:text-slate-100">
            {greeting},{" "}
            <span className="text-[#003399] dark:text-sky-400">
              {user?.nama_operator}
            </span>
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 font-medium mt-0.5">
            {companyName} • {user?.role || "Operator"}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {currentDateStr ? (
            <div className="hidden sm:flex items-center gap-1.5 px-3 py-1 rounded-xl bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-300 font-mono-data">
              <Icon
                name="clock"
                className="size-3.5 text-[#003399] dark:text-sky-400"
              />
              <span>{currentTimeStr || "00:00:00"} WIB</span>
            </div>
          ) : null}
        </div>
      </div>

      {/* 2. Hero Balance Card ala m-BCA */}
      {canViewDashboard ? (
        <StatusHeroCard
          hadir={metrics?.hadirHariIni ?? 0}
          total={metrics?.totalKaryawan ?? 0}
          terlambat={metrics?.terlambatHariIni ?? 0}
          persentase={metrics?.persentaseKehadiran ?? 0}
          isLoading={metricsLoading}
          onRefresh={loadData}
          companyName={companyName}
        />
      ) : null}

      {/* Metrics Error Feedback Banner */}
      {canViewDashboard && metricsError ? (
        <FeedbackBanner tone="error" onDismiss={() => setMetricsError(null)}>
          <p className="font-bold">Gagal memuat rekap kehadiran</p>
          <p className="mt-1 text-xs opacity-80">{metricsError}</p>
        </FeedbackBanner>
      ) : null}

      {/* 3. Quick Action Hub (Grid 4x2 m-BCA) */}
      <QuickActionGrid />

      {/* 4. Umpan Anomali Kehadiran Segera (Jika Ada) */}
      {(metrics?.alfaHariIni ?? 0) > 0 ||
      (metrics?.terlambatHariIni ?? 0) > 0 ? (
        <section
          aria-label="Perhatian Operasional"
          className="rounded-2xl border border-amber-300/40 dark:border-amber-500/30 bg-amber-50/70 dark:bg-amber-950/20 p-4 sm:p-5 text-amber-950 dark:text-amber-100 shadow-sm"
        >
          <div className="flex items-start gap-3">
            <div className="size-8 rounded-xl bg-amber-500/20 text-amber-700 dark:text-amber-300 flex items-center justify-center shrink-0 mt-0.5">
              <Icon name="alert" className="size-5" />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-sm font-bold tracking-tight text-amber-900 dark:text-amber-200">
                Perhatian Operasional Hari Ini
              </h3>
              <p className="text-xs text-amber-800/80 dark:text-amber-300/80 mt-0.5">
                Terdapat <strong>{metrics?.terlambatHariIni ?? 0} orang</strong>{" "}
                terlambat dan <strong>{metrics?.alfaHariIni ?? 0} orang</strong>{" "}
                belum hadir tanpa keterangan.
              </p>
              <div className="flex flex-wrap items-center gap-2 mt-3">
                <Link
                  href="/dasbor-kehadiran"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 active:scale-95 text-white font-bold text-xs transition-all shadow-sm"
                >
                  <Icon name="dashboard" className="size-3.5" />
                  <span>Pantau Anomali</span>
                </Link>
                {canAccessArea(user, "notifikasi_wa") && (
                  <Link
                    href="/notifikasi-wa"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 active:scale-95 text-amber-900 dark:text-amber-200 font-bold text-xs border border-amber-300/60 dark:border-amber-500/40 transition-all"
                  >
                    <Icon
                      name="whatsapp"
                      className="size-3.5 text-emerald-600"
                    />
                    <span>Kirim WA Peringatan</span>
                  </Link>
                )}
              </div>
            </div>
          </div>
        </section>
      ) : null}

      {/* 5. Aktivitas Presensi Terakhir (Live Stream List) */}
      <section
        aria-label="Aktivitas Presensi Terkini"
        className="rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900/80 p-4 sm:p-5 shadow-sm"
      >
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className="size-7 rounded-lg bg-blue-50 dark:bg-blue-950/60 text-[#003399] dark:text-sky-400 flex items-center justify-center">
              <Icon name="clock" className="size-4" />
            </div>
            <h2 className="text-sm font-extrabold text-slate-900 dark:text-slate-100 tracking-tight">
              Aktivitas Presensi Terakhir
            </h2>
          </div>
          <Link
            href="/history"
            className="text-xs font-bold text-[#003399] dark:text-sky-400 hover:underline inline-flex items-center gap-1"
          >
            <span>Semua Riwayat</span>
            <Icon name="arrow-right" className="size-3" />
          </Link>
        </div>

        {recentScans.length === 0 ? (
          <div className="py-6 text-center text-xs text-slate-500 dark:text-slate-400">
            <p>Belum ada rekaman scan presensi untuk hari ini.</p>
            {canAccessArea(user, "scanner") && (
              <Link
                href="/scanner"
                className="mt-2.5 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 dark:bg-[#003399] dark:hover:bg-[#002266] text-white font-bold text-xs shadow-sm shadow-sky-600/20 dark:shadow-blue-950/30 transition-all"
              >
                <Icon name="scanner" className="size-3.5" />
                <span>Mulai Pindai QR</span>
              </Link>
            )}
          </div>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {recentScans.map((scan, idx) => (
              <div
                key={scan.id_karyawan || idx}
                className="py-2.5 first:pt-0 last:pb-0 flex items-center justify-between gap-3"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="size-8 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center font-bold text-xs text-slate-700 dark:text-slate-300 shrink-0">
                    {(scan.nama_karyawan || "S").slice(0, 2).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-slate-900 dark:text-slate-100 truncate">
                      {scan.nama_karyawan || "Personil"}
                    </p>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                      {scan.divisi || "Umum"}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-xs font-mono-data text-slate-500 dark:text-slate-400">
                    {scan.waktu_scan || scan.jam || "--:--"}
                  </span>
                  <StatusBadgePill
                    status={scan.status_kehadiran || "Hadir"}
                    showIcon={false}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* 6. Footer Sistem & Versi */}
      <footer className="pt-2 text-center text-xs text-slate-600 dark:text-slate-400">
        <p>{BRANDING.appDisplayName} • Sistem Presensi & Operasional Sekolah</p>
        <LicenseHolderLabel className="mt-0.5 block text-[10px] text-slate-500 dark:text-slate-400" />
      </footer>
    </AppShell>
  );
}
