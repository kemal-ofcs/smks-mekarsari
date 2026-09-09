"use client";

import Link from "next/link";
import { redirect } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { FeedbackBanner } from "@/components/ui/FeedbackBanner";
import { Icon } from "@/components/ui/Icon";
import { PageHeader } from "@/components/ui/PageHeader";
import { formatTanggalOperasional } from "@/lib/attendance/time-policy";
import { canAccessArea } from "@/lib/auth/access";
import { useAuth } from "@/lib/context/AuthContext";
import {
  type AttendanceDashboardMetrics,
  getAttendanceDashboardMetrics,
} from "@/lib/gateways/attendance-dashboard";
import { syncNow } from "@/lib/gateways/sync-status";

type TabKey = "overview" | "teachers" | "classes" | "anomalies";

export default function DasborKehadiranPage() {
  const { user, isAuthenticated, isLoading: authLoading } = useAuth();

  const [activeTab, setActiveTab] = useState<TabKey>("overview");
  const [selectedDate, setSelectedDate] = useState(() =>
    formatTanggalOperasional(new Date()),
  );
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<AttendanceDashboardMetrics | null>(null);
  const [feedback, setFeedback] = useState<{
    tone: "success" | "error" | "warning";
    message: string;
  } | null>(null);

  const loadMetrics = useCallback(
    async (targetDate?: string) => {
      setLoading(true);
      try {
        const res = await getAttendanceDashboardMetrics({
          tanggal: targetDate || selectedDate,
        });
        setData(res);
      } catch (err) {
        setFeedback({
          tone: "error",
          message:
            err instanceof Error
              ? err.message
              : "Gagal memuat data dasbor audit kehadiran.",
        });
      } finally {
        setLoading(false);
      }
    },
    [selectedDate],
  );

  useEffect(() => {
    if (!authLoading && isAuthenticated) {
      void loadMetrics(selectedDate);
    }
  }, [authLoading, isAuthenticated, selectedDate, loadMetrics]);

  // Listener reaktivitas sinkronisasi latar belakang
  useEffect(() => {
    const handleSyncCompleted = () => {
      void loadMetrics(selectedDate);
    };
    window.addEventListener("sppg:sync-completed", handleSyncCompleted);
    return () => {
      window.removeEventListener("sppg:sync-completed", handleSyncCompleted);
    };
  }, [selectedDate, loadMetrics]);

  const handleRefresh = async () => {
    setLoading(true);
    try {
      await syncNow();
    } catch {
      // Abaikan error sync, tetap muat data lokal
    }
    await loadMetrics(selectedDate);
    setFeedback({
      tone: "success",
      message: "Data dasbor kehadiran berhasil disinkronkan dan dimuat ulang.",
    });
  };

  if (!authLoading && !isAuthenticated) {
    redirect("/login");
  }

  if (
    !authLoading &&
    isAuthenticated &&
    !canAccessArea(user, "dasbor_kehadiran")
  ) {
    redirect("/forbidden");
  }

  const siswa = data?.siswa || {
    total: 0,
    hadir: 0,
    terlambat: 0,
    sakit: 0,
    izin: 0,
    dispen: 0,
    alfa: 0,
    persentase: 0,
  };

  const guru = data?.guru || {
    total: 0,
    hadir: 0,
    terlambat: 0,
    sakit: 0,
    izin: 0,
    dispen: 0,
    alfa: 0,
    persentase: 0,
  };

  return (
    <AppShell>
      <div className="space-y-6">
        <PageHeader
          eyebrow="DASBOR"
          title="Dasbor Audit Kehadiran"
          description="Analitik komprehensif kehadiran Guru, PTK, dan Siswa berbasis data operasional gerbang dan kelas."
          actions={
            <div className="flex items-center gap-3">
              <input
                aria-label="Tanggal dasbor kehadiran"
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="rounded-xl border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm text-slate-100 shadow-inner transition focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
              <button
                type="button"
                onClick={handleRefresh}
                disabled={loading}
                className="inline-flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-800/90 px-4 py-2 text-sm font-medium text-slate-200 transition hover:bg-slate-700 hover:text-white disabled:opacity-50"
              >
                <Icon
                  name="refresh"
                  className={`h-4 w-4 ${loading ? "animate-spin" : ""}`}
                />
                <span>Muat Ulang</span>
              </button>
            </div>
          }
        />

        {feedback ? (
          <FeedbackBanner
            tone={feedback.tone}
            onDismiss={() => setFeedback(null)}
          >
            {feedback.message}
          </FeedbackBanner>
        ) : null}

        {/* Tab Navigasi */}
        <div className="flex border-b border-slate-800">
          <button
            type="button"
            onClick={() => setActiveTab("overview")}
            className={`border-b-2 px-5 py-3 text-sm font-medium transition ${
              activeTab === "overview"
                ? "border-indigo-500 text-indigo-400"
                : "border-transparent text-slate-400 hover:border-slate-700 hover:text-slate-200"
            }`}
          >
            Ringkasan Eksekutif
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("teachers")}
            className={`border-b-2 px-5 py-3 text-sm font-medium transition ${
              activeTab === "teachers"
                ? "border-indigo-500 text-indigo-400"
                : "border-transparent text-slate-400 hover:border-slate-700 hover:text-slate-200"
            }`}
          >
            Kehadiran Guru / PTK ({guru.hadir}/{guru.total})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("classes")}
            className={`border-b-2 px-5 py-3 text-sm font-medium transition ${
              activeTab === "classes"
                ? "border-indigo-500 text-indigo-400"
                : "border-transparent text-slate-400 hover:border-slate-700 hover:text-slate-200"
            }`}
          >
            Kehadiran per Kelas ({data?.rekapRombel?.length || 0} Rombel)
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("anomalies")}
            className={`relative border-b-2 px-5 py-3 text-sm font-medium transition ${
              activeTab === "anomalies"
                ? "border-indigo-500 text-indigo-400"
                : "border-transparent text-slate-400 hover:border-slate-700 hover:text-slate-200"
            }`}
          >
            Deteksi Anomali
            {(data?.anomaliBolos || 0) > 0 ? (
              <span className="ml-2 rounded-full bg-rose-500/20 px-2 py-0.5 text-xs font-semibold text-rose-400">
                {data?.anomaliBolos}
              </span>
            ) : null}
          </button>
        </div>

        {/* Tab 1: Ringkasan Eksekutif */}
        {activeTab === "overview" && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              {/* Kartu Kehadiran Siswa */}
              <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6 backdrop-blur shadow-sm">
                <div className="flex items-center justify-between border-b border-slate-800/80 pb-4">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-500/10 text-blue-400">
                      <Icon name="users" className="h-5 w-5" />
                    </div>
                    <div>
                      <h3 className="text-base font-semibold text-slate-100">
                        Kehadiran Siswa
                      </h3>
                      <p className="text-xs text-slate-400">
                        Total aktif: {siswa.total} siswa terdaftar
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <span className="text-3xl font-bold tracking-tight text-blue-400">
                      {siswa.persentase}%
                    </span>
                    <p className="text-xs text-slate-400">Tingkat Hadir</p>
                  </div>
                </div>

                {/* Progress Bar */}
                <div className="mt-4 h-2.5 w-full overflow-hidden rounded-full bg-slate-800">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-blue-600 to-indigo-500 transition-all duration-500"
                    style={{
                      width: `${Math.min(100, Math.max(0, siswa.persentase))}%`,
                    }}
                  />
                </div>

                <div className="mt-6 grid grid-cols-3 gap-3 text-center sm:grid-cols-6">
                  <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3">
                    <p className="text-xs text-emerald-400 font-medium">
                      Hadir
                    </p>
                    <p className="text-xl font-bold text-slate-100">
                      {siswa.hadir}
                    </p>
                  </div>
                  <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3">
                    <p className="text-xs text-amber-400 font-medium">
                      Terlambat
                    </p>
                    <p className="text-xl font-bold text-slate-100">
                      {siswa.terlambat}
                    </p>
                  </div>
                  <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3">
                    <p className="text-xs text-sky-400 font-medium">Sakit</p>
                    <p className="text-xl font-bold text-slate-100">
                      {siswa.sakit}
                    </p>
                  </div>
                  <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3">
                    <p className="text-xs text-indigo-400 font-medium">Izin</p>
                    <p className="text-xl font-bold text-slate-100">
                      {siswa.izin}
                    </p>
                  </div>
                  <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3">
                    <p className="text-xs text-purple-400 font-medium">
                      Dispen
                    </p>
                    <p className="text-xl font-bold text-slate-100">
                      {siswa.dispen}
                    </p>
                  </div>
                  <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3">
                    <p className="text-xs text-rose-400 font-medium">Alfa</p>
                    <p className="text-xl font-bold text-slate-100">
                      {siswa.alfa}
                    </p>
                  </div>
                </div>
              </div>

              {/* Kartu Kehadiran Guru & Tenaga Kependidikan */}
              <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6 backdrop-blur shadow-sm">
                <div className="flex items-center justify-between border-b border-slate-800/80 pb-4">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-400">
                      <Icon name="user" className="h-5 w-5" />
                    </div>
                    <div>
                      <h3 className="text-base font-semibold text-slate-100">
                        Kehadiran Guru & PTK
                      </h3>
                      <p className="text-xs text-slate-400">
                        Total aktif: {guru.total} personil terdaftar
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <span className="text-3xl font-bold tracking-tight text-emerald-400">
                      {guru.persentase}%
                    </span>
                    <p className="text-xs text-slate-400">Tingkat Hadir</p>
                  </div>
                </div>

                {/* Progress Bar */}
                <div className="mt-4 h-2.5 w-full overflow-hidden rounded-full bg-slate-800">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-emerald-600 to-teal-500 transition-all duration-500"
                    style={{
                      width: `${Math.min(100, Math.max(0, guru.persentase))}%`,
                    }}
                  />
                </div>

                <div className="mt-6 grid grid-cols-3 gap-3 text-center sm:grid-cols-6">
                  <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3">
                    <p className="text-xs text-emerald-400 font-medium">
                      Hadir
                    </p>
                    <p className="text-xl font-bold text-slate-100">
                      {guru.hadir}
                    </p>
                  </div>
                  <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3">
                    <p className="text-xs text-amber-400 font-medium">
                      Terlambat
                    </p>
                    <p className="text-xl font-bold text-slate-100">
                      {guru.terlambat}
                    </p>
                  </div>
                  <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3">
                    <p className="text-xs text-sky-400 font-medium">Sakit</p>
                    <p className="text-xl font-bold text-slate-100">
                      {guru.sakit}
                    </p>
                  </div>
                  <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3">
                    <p className="text-xs text-indigo-400 font-medium">Izin</p>
                    <p className="text-xl font-bold text-slate-100">
                      {guru.izin}
                    </p>
                  </div>
                  <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3">
                    <p className="text-xs text-purple-400 font-medium">
                      Dispen
                    </p>
                    <p className="text-xl font-bold text-slate-100">
                      {guru.dispen}
                    </p>
                  </div>
                  <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3">
                    <p className="text-xs text-rose-400 font-medium">Alfa</p>
                    <p className="text-xl font-bold text-slate-100">
                      {guru.alfa}
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Quick Links & Alert Widget */}
            {(data?.anomaliBolos || 0) > 0 ? (
              <div className="flex items-center justify-between rounded-2xl border border-rose-500/30 bg-rose-500/10 p-5 text-rose-200">
                <div className="flex items-center gap-4">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-rose-500/20 text-rose-400">
                    <Icon name="alert" className="h-5 w-5" />
                  </div>
                  <div>
                    <h4 className="font-semibold text-rose-100">
                      Terdeteksi {data?.anomaliBolos} Siswa Anomali Bolos
                    </h4>
                    <p className="text-xs text-rose-300">
                      Siswa tercatat scan masuk gerbang sekolah, namun tidak
                      hadir pada presensi mata pelajaran kelas.
                    </p>
                  </div>
                </div>
                <Link
                  href="/presensi-kelas"
                  className="rounded-xl bg-rose-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-rose-500"
                >
                  Buka Rekonsiliasi
                </Link>
              </div>
            ) : null}
          </div>
        )}

        {/* Tab 2: Kehadiran Guru / PTK */}
        {activeTab === "teachers" && (
          <div className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/60 shadow-sm">
            <div className="border-b border-slate-800 p-4">
              <h3 className="text-base font-semibold text-slate-100">
                Daftar Presensi Guru & Tenaga Kependidikan
              </h3>
              <p className="text-xs text-slate-400">
                Rekam jejak scan masuk dan pulang untuk tanggal {selectedDate}
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm text-slate-300">
                <thead className="border-b border-slate-800 bg-slate-950/60 text-xs font-medium uppercase text-slate-400">
                  <tr>
                    <th className="px-5 py-3">Nama Lengkap</th>
                    <th className="px-5 py-3">Jabatan / Peran</th>
                    <th className="px-5 py-3">Jam Masuk</th>
                    <th className="px-5 py-3">Jam Pulang</th>
                    <th className="px-5 py-3">Status</th>
                    <th className="px-5 py-3">Terlambat</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {(data?.rekapGuru || []).length === 0 ? (
                    <tr>
                      <td
                        colSpan={6}
                        className="py-8 text-center text-sm text-slate-500"
                      >
                        Tidak ada data guru atau tenaga kependidikan aktif.
                      </td>
                    </tr>
                  ) : (
                    data?.rekapGuru.map((item) => (
                      <tr
                        key={item.id_karyawan}
                        className="hover:bg-slate-800/30 transition"
                      >
                        <td className="px-5 py-3.5 font-medium text-slate-200">
                          {item.nama_lengkap}
                        </td>
                        <td className="px-5 py-3.5 text-xs text-slate-400">
                          {item.jabatan}
                        </td>
                        <td className="px-5 py-3.5 font-mono text-xs">
                          {item.jam_masuk ? item.jam_masuk : "-"}
                        </td>
                        <td className="px-5 py-3.5 font-mono text-xs">
                          {item.jam_pulang ? item.jam_pulang : "-"}
                        </td>
                        <td className="px-5 py-3.5">
                          <span
                            className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                              item.status_kehadiran === "Hadir"
                                ? "bg-emerald-500/10 text-emerald-400"
                                : item.status_kehadiran === "Sakit"
                                  ? "bg-sky-500/10 text-sky-400"
                                  : item.status_kehadiran === "Izin"
                                    ? "bg-indigo-500/10 text-indigo-400"
                                    : item.status_kehadiran === "Dispen"
                                      ? "bg-purple-500/10 text-purple-400"
                                      : item.status_kehadiran === "Alfa"
                                        ? "bg-rose-500/10 text-rose-400"
                                        : "bg-slate-800 text-slate-400"
                            }`}
                          >
                            {item.status_kehadiran}
                          </span>
                        </td>
                        <td className="px-5 py-3.5 text-xs">
                          {item.menit_terlambat > 0 ? (
                            <span className="text-amber-400 font-semibold">
                              {item.menit_terlambat} mnt
                            </span>
                          ) : (
                            <span className="text-slate-500">Tepat Waktu</span>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Tab 3: Kehadiran per Kelas (Rombel) */}
        {activeTab === "classes" && (
          <div className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/60 shadow-sm">
            <div className="border-b border-slate-800 p-4">
              <h3 className="text-base font-semibold text-slate-100">
                Rekapitulasi Kehadiran per Rombongan Belajar
              </h3>
              <p className="text-xs text-slate-400">
                Tingkat kehadiran siswa per kelas untuk tanggal {selectedDate}
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm text-slate-300">
                <thead className="border-b border-slate-800 bg-slate-950/60 text-xs font-medium uppercase text-slate-400">
                  <tr>
                    <th className="px-5 py-3">Nama Kelas / Rombel</th>
                    <th className="px-5 py-3 text-center">Total Siswa</th>
                    <th className="px-5 py-3 text-center">Hadir</th>
                    <th className="px-5 py-3 text-center">Sakit / Izin</th>
                    <th className="px-5 py-3 text-center">Alfa</th>
                    <th className="px-5 py-3">Persentase</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {(data?.rekapRombel || []).length === 0 ? (
                    <tr>
                      <td
                        colSpan={6}
                        className="py-8 text-center text-sm text-slate-500"
                      >
                        Tidak ada rombongan belajar terdaftar.
                      </td>
                    </tr>
                  ) : (
                    data?.rekapRombel.map((item) => (
                      <tr
                        key={item.id_rombel}
                        className="hover:bg-slate-800/30 transition"
                      >
                        <td className="px-5 py-3.5 font-medium text-slate-200">
                          {item.nama_rombel}
                        </td>
                        <td className="px-5 py-3.5 text-center font-semibold text-slate-300">
                          {item.total_siswa}
                        </td>
                        <td className="px-5 py-3.5 text-center text-emerald-400 font-semibold">
                          {item.hadir}
                        </td>
                        <td className="px-5 py-3.5 text-center text-indigo-400">
                          {item.sakit_izin}
                        </td>
                        <td className="px-5 py-3.5 text-center text-rose-400 font-semibold">
                          {item.alfa}
                        </td>
                        <td className="px-5 py-3.5">
                          <div className="flex items-center gap-3">
                            <div className="h-2 w-24 overflow-hidden rounded-full bg-slate-800">
                              <div
                                className="h-full rounded-full bg-indigo-500"
                                style={{
                                  width: `${Math.min(100, Math.max(0, item.persentase))}%`,
                                }}
                              />
                            </div>
                            <span className="text-xs font-bold text-slate-200">
                              {item.persentase}%
                            </span>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Tab 4: Deteksi Anomali */}
        {activeTab === "anomalies" && (
          <div className="space-y-6">
            <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6 shadow-sm">
              <div className="flex items-center justify-between border-b border-slate-800 pb-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-rose-500/10 text-rose-400">
                    <Icon name="alert" className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 className="text-base font-semibold text-slate-100">
                      Audit Anomali & Rekonsiliasi Kehadiran
                    </h3>
                    <p className="text-xs text-slate-400">
                      Perbandingan scan gerbang fisik terhadap presensi jam
                      pelajaran di kelas.
                    </p>
                  </div>
                </div>
                <Link
                  href="/presensi-kelas"
                  className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-indigo-500"
                >
                  <Icon name="chevron-right" className="h-4 w-4" />
                  <span>Buka Modul Rekonsiliasi</span>
                </Link>
              </div>

              <div className="mt-6 grid grid-cols-1 gap-6 sm:grid-cols-2">
                <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-5">
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-semibold text-slate-200">
                      Siswa Bolos (Scan Gerbang Ada, Roster Alfa)
                    </h4>
                    <span className="rounded-full bg-rose-500/20 px-2.5 py-0.5 text-xs font-bold text-rose-400">
                      {data?.anomaliBolos || 0} Kasus
                    </span>
                  </div>
                  <p className="mt-2 text-xs text-slate-400 leading-relaxed">
                    Siswa terdeteksi masuk melalui gerbang sekolah di pagi hari,
                    tetapi ditandai Alfa pada salah satu atau seluruh jam
                    pelajaran kelas.
                  </p>
                </div>

                <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-5">
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-semibold text-slate-200">
                      Audit Disiplin & Notifikasi Wali
                    </h4>
                    <span className="rounded-full bg-indigo-500/20 px-2.5 py-0.5 text-xs font-bold text-indigo-400">
                      Tersedia
                    </span>
                  </div>
                  <p className="mt-2 text-xs text-slate-400 leading-relaxed">
                    Kasus anomali yang telah diverifikasi guru dapat diteruskan
                    menjadi antrean notifikasi WhatsApp wali murid atau dicatat
                    dalam Bimbingan Konseling (BK).
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}
