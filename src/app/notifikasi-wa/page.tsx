"use client";

import { redirect } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { FeedbackBanner } from "@/components/ui/FeedbackBanner";
import { Icon } from "@/components/ui/Icon";
import { Modal } from "@/components/ui/Modal";
import { PageHeader } from "@/components/ui/PageHeader";
import { canAccessArea, hasPermission } from "@/lib/auth/access";
import { useAuth } from "@/lib/context/AuthContext";
import { syncNow } from "@/lib/gateways/sync-status";
import {
  cancelWaNotificationGateway,
  getWaConfigGateway,
  listWaNotificationsGateway,
  saveWaConfigGateway,
  type WaConfig,
  type WaConfigDraft,
  type WaConfigProvider,
  type WaNotificationItem,
  type WaNotificationJenis,
  type WaNotificationStatus,
} from "@/lib/gateways/wa-notification";
import { useConfirmDialog } from "@/lib/hooks/useConfirmDialog";

export default function NotifikasiWaPage() {
  const { user, isAuthenticated, isLoading: authLoading } = useAuth();

  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<WaNotificationItem[]>([]);
  const [config, setConfig] = useState<WaConfig | null>(null);

  // Filters
  const [statusFilter, setStatusFilter] = useState<string>("Semua");
  const [jenisFilter, setJenisFilter] = useState<string>("Semua");
  const [tanggalFilter, setTanggalFilter] = useState<string>("");
  const [searchFilter, setSearchFilter] = useState<string>("");

  // Modals & Dialogs
  const [configModalOpen, setConfigModalOpen] = useState(false);
  const [configDraft, setConfigDraft] = useState<WaConfigDraft | null>(null);
  const [showApiKey, setShowApiKey] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);

  // Selected message for details preview
  const [selectedItem, setSelectedItem] = useState<WaNotificationItem | null>(
    null,
  );

  // Feedback state
  const [feedback, setFeedback] = useState<{
    tone: "success" | "error" | "warning";
    message: string;
  } | null>(null);

  // Penjaga anti klik ganda. Sebuah `useState` tidak cukup: pembaruannya
  // dijadwalkan, sehingga dua klik dalam satu tick React sama-sama membaca
  // nilai lama dan keduanya lolos. `useRef` berubah seketika.
  //
  // Wajib berada di ATAS, sebelum setiap early return: hook yang dilewati pada
  // sebagian render mengubah urutan hook dan menjatuhkan seluruh halaman.
  const isSubmittingRef = useRef(false);
  const { konfirmasi, dialogKonfirmasi } = useConfirmDialog();

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [listRes, configRes] = await Promise.all([
        listWaNotificationsGateway({
          status: statusFilter === "Semua" ? undefined : statusFilter,
          jenis: jenisFilter === "Semua" ? undefined : jenisFilter,
          tanggal: tanggalFilter || undefined,
          limit: 300,
        }),
        getWaConfigGateway().catch(() => null),
      ]);
      setItems(listRes.items);
      if (configRes) {
        setConfig(configRes);
      }
    } catch (err) {
      setFeedback({
        tone: "error",
        message:
          err instanceof Error
            ? err.message
            : "Gagal memuat antrean notifikasi WhatsApp.",
      });
    } finally {
      setLoading(false);
    }
  }, [statusFilter, jenisFilter, tanggalFilter]);

  useEffect(() => {
    if (!authLoading && isAuthenticated) {
      void loadData();
    }
  }, [authLoading, isAuthenticated, loadData]);

  // Real-time auto-sync listener
  useEffect(() => {
    const handleSync = () => {
      void loadData();
    };
    window.addEventListener("sppg:sync-completed", handleSync);
    return () => window.removeEventListener("sppg:sync-completed", handleSync);
  }, [loadData]);

  if (authLoading) {
    return (
      <AppShell>
        <div className="flex min-h-[400px] items-center justify-center">
          <div className="text-center">
            <div className="mx-auto h-8 w-8 animate-spin rounded-full border-4 border-indigo-500 border-t-transparent" />
            <p className="mt-3 text-sm text-slate-400">
              Memeriksa izin akses...
            </p>
          </div>
        </div>
      </AppShell>
    );
  }

  if (!isAuthenticated || !canAccessArea(user, "notifikasi_wa")) {
    redirect("/forbidden");
  }

  const canManage = hasPermission(user, "notification.manage");
  const canDelete = hasPermission(user, "notification.delete");

  const handleRefresh = async () => {
    setLoading(true);
    try {
      await syncNow();
      await loadData();
      setFeedback({
        tone: "success",
        message:
          "Sinkronisasi selesai dan antrean notifikasi berhasil dimuat ulang.",
      });
    } catch (err) {
      setFeedback({
        tone: "error",
        message:
          err instanceof Error
            ? err.message
            : "Gagal memuat ulang data antrean notifikasi.",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleCancelNotification = async (item: WaNotificationItem) => {
    if (isSubmittingRef.current || !canDelete) return;
    const confirmed = await konfirmasi({
      title: "Batalkan notifikasi ini?",
      description: `Pesan untuk ${item.nama_siswa || item.tujuan_nomor} tidak akan pernah dikirim.`,
      preserved:
        "Barisnya tetap tercatat berstatus Dibatalkan sebagai jejak audit, bukan dihapus.",
      confirmLabel: "Ya, batalkan",
      tone: "warning",
    });
    if (!confirmed) return;

    isSubmittingRef.current = true;
    try {
      await cancelWaNotificationGateway(
        item.id_notifikasi,
        "Dibatalkan oleh operator",
      );
      setFeedback({
        tone: "success",
        message: "Notifikasi berhasil dibatalkan dari antrean.",
      });
      void loadData();
    } catch (err) {
      setFeedback({
        tone: "error",
        message:
          err instanceof Error ? err.message : "Gagal membatalkan notifikasi.",
      });
    } finally {
      isSubmittingRef.current = false;
    }
  };

  const handleOpenConfigModal = () => {
    if (!config) return;
    setConfigDraft({
      provider: config.provider,
      apiKey: "",
      apiUrl: config.apiUrl ?? "",
      senderNumber: config.senderNumber ?? "",
      isActive: config.isActive,
      dailyLimit: config.dailyLimit,
      scanMasukEnabled: config.scanMasukEnabled,
      scanPulangEnabled: config.scanPulangEnabled,
      bolosEnabled: config.bolosEnabled,
      ambangAlfaEnabled: config.ambangAlfaEnabled,
    });
    setShowApiKey(false);
    setConfigModalOpen(true);
  };

  const handleSaveConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmittingRef.current || !configDraft) return;
    isSubmittingRef.current = true;
    setSavingConfig(true);
    try {
      await saveWaConfigGateway(configDraft);
      setFeedback({
        tone: "success",
        message: "Konfigurasi WhatsApp Gateway berhasil disimpan.",
      });
      setConfigModalOpen(false);
      void loadData();
    } catch (err) {
      setFeedback({
        tone: "error",
        message:
          err instanceof Error
            ? err.message
            : "Gagal menyimpan konfigurasi WhatsApp Gateway.",
      });
    } finally {
      setSavingConfig(false);
      isSubmittingRef.current = false;
    }
  };

  // Metrics calculation
  const totalMenunggu = items.filter((i) => i.status === "Menunggu").length;
  const totalTerkirim = items.filter((i) => i.status === "Terkirim").length;
  const totalGagal = items.filter((i) => i.status === "Gagal").length;
  const totalDibatalkan = items.filter((i) => i.status === "Dibatalkan").length;

  // Filtered items
  const displayItems = items.filter((item) => {
    if (searchFilter.trim()) {
      const q = searchFilter.toLowerCase();
      const matchName = item.nama_siswa.toLowerCase().includes(q);
      const matchRombel = item.nama_rombel.toLowerCase().includes(q);
      const matchPhone = item.tujuan_nomor.toLowerCase().includes(q);
      const matchText = item.isi_pesan.toLowerCase().includes(q);
      if (!matchName && !matchRombel && !matchPhone && !matchText) {
        return false;
      }
    }
    return true;
  });

  const getJenisBadge = (jenis: WaNotificationJenis) => {
    switch (jenis) {
      case "scan_masuk":
        return (
          <span className="inline-flex items-center rounded-md bg-emerald-500/10 px-2 py-0.5 text-xs font-semibold text-emerald-400 ring-1 ring-inset ring-emerald-500/20">
            Scan Masuk
          </span>
        );
      case "scan_pulang":
        return (
          <span className="inline-flex items-center rounded-md bg-sky-500/10 px-2 py-0.5 text-xs font-semibold text-sky-400 ring-1 ring-inset ring-sky-500/20">
            Scan Pulang
          </span>
        );
      case "bolos":
        return (
          <span className="inline-flex items-center rounded-md bg-amber-500/10 px-2 py-0.5 text-xs font-semibold text-amber-400 ring-1 ring-inset ring-amber-500/20">
            Deteksi Bolos
          </span>
        );
      case "ambang_alfa":
        return (
          <span className="inline-flex items-center rounded-md bg-rose-500/10 px-2 py-0.5 text-xs font-semibold text-rose-400 ring-1 ring-inset ring-rose-500/20">
            Ambang Alfa
          </span>
        );
    }
  };

  const getStatusBadge = (status: WaNotificationStatus) => {
    switch (status) {
      case "Menunggu":
        return (
          <span className="inline-flex items-center rounded-md bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-400 ring-1 ring-inset ring-amber-500/20">
            Menunggu
          </span>
        );
      case "Terkirim":
        return (
          <span className="inline-flex items-center rounded-md bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-400 ring-1 ring-inset ring-emerald-500/20">
            Terkirim
          </span>
        );
      case "Gagal":
        return (
          <span className="inline-flex items-center rounded-md bg-rose-500/10 px-2 py-0.5 text-xs font-medium text-rose-400 ring-1 ring-inset ring-rose-500/20">
            Gagal
          </span>
        );
      case "Dibatalkan":
        return (
          <span className="inline-flex items-center rounded-md bg-slate-500/10 px-2 py-0.5 text-xs font-medium text-slate-400 ring-1 ring-inset ring-slate-500/20">
            Dibatalkan
          </span>
        );
    }
  };

  return (
    <AppShell>
      <div className="space-y-6">
        <PageHeader
          eyebrow="NOTIFIKASI"
          title="Notifikasi WhatsApp Wali Murid"
          description="Tinjau antrean pengiriman pesan otomatis dan kirim pesan manual via WhatsApp Web"
          actions={
            <div className="flex flex-wrap items-center gap-3">
              {canManage && (
                <button
                  type="button"
                  onClick={handleOpenConfigModal}
                  className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-800 px-3.5 py-2 text-xs font-medium text-slate-200 shadow-sm transition hover:bg-slate-700 hover:text-white"
                >
                  <Icon name="settings" className="h-4 w-4" />
                  Konfigurasi Gateway
                </button>
              )}
              <button
                type="button"
                onClick={handleRefresh}
                disabled={loading}
                className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-3.5 py-2 text-xs font-medium text-white shadow-sm transition hover:bg-indigo-500 disabled:opacity-50"
              >
                <Icon
                  name="refresh"
                  className={`h-4 w-4 ${loading ? "animate-spin" : ""}`}
                />
                Muat Ulang
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

        {/* Metrik Ringkas */}
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 backdrop-blur">
            <p className="text-xs font-medium text-slate-400">
              Antrean Menunggu
            </p>
            <p className="mt-1.5 text-2xl font-bold tracking-tight text-amber-400">
              {totalMenunggu}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Siap dikirim atau kirim manual
            </p>
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 backdrop-blur">
            <p className="text-xs font-medium text-slate-400">
              Berhasil Terkirim
            </p>
            <p className="mt-1.5 text-2xl font-bold tracking-tight text-emerald-400">
              {totalTerkirim}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Pesan diterima nomor tujuan
            </p>
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 backdrop-blur">
            <p className="text-xs font-medium text-slate-400">
              Gagal / Dibatalkan
            </p>
            <p className="mt-1.5 text-2xl font-bold tracking-tight text-slate-300">
              {totalGagal + totalDibatalkan}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              {totalGagal} gagal, {totalDibatalkan} dibatalkan
            </p>
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 backdrop-blur">
            <p className="text-xs font-medium text-slate-400">Status Gateway</p>
            <div className="mt-1.5 flex items-center gap-2">
              <span
                className={`inline-block h-2.5 w-2.5 rounded-full ${
                  config?.isActive ? "bg-emerald-500" : "bg-slate-600"
                }`}
              />
              <p className="text-base font-semibold text-slate-200">
                {config?.isActive ? "Otomatis Aktif" : "Manual / wa.me"}
              </p>
            </div>
            <p className="mt-1 text-xs text-slate-500">
              Provider: {config?.provider?.toUpperCase() || "FONNTE"}
            </p>
          </div>
        </div>

        {/* Filter Panel */}
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 backdrop-blur">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <label
                htmlFor="status-filter"
                className="mb-1.5 block text-xs font-medium text-slate-300"
              >
                Status Antrean
              </label>
              <select
                id="status-filter"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs text-slate-200 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              >
                <option value="Semua">Semua Status</option>
                <option value="Menunggu">Menunggu</option>
                <option value="Terkirim">Terkirim</option>
                <option value="Gagal">Gagal</option>
                <option value="Dibatalkan">Dibatalkan</option>
              </select>
            </div>

            <div>
              <label
                htmlFor="jenis-filter"
                className="mb-1.5 block text-xs font-medium text-slate-300"
              >
                Jenis Notifikasi
              </label>
              <select
                id="jenis-filter"
                value={jenisFilter}
                onChange={(e) => setJenisFilter(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs text-slate-200 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              >
                <option value="Semua">Semua Jenis</option>
                <option value="scan_masuk">Scan Masuk Gerbang</option>
                <option value="scan_pulang">Scan Pulang Gerbang</option>
                <option value="bolos">Deteksi Bolos Kelas</option>
                <option value="ambang_alfa">Peringatan Ambang Alfa</option>
              </select>
            </div>

            <div>
              <label
                htmlFor="tanggal-filter"
                className="mb-1.5 block text-xs font-medium text-slate-300"
              >
                Tanggal Operasional
              </label>
              <input
                id="tanggal-filter"
                type="date"
                value={tanggalFilter}
                onChange={(e) => setTanggalFilter(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs text-slate-200 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>

            <div>
              <label
                htmlFor="search-filter"
                className="mb-1.5 block text-xs font-medium text-slate-300"
              >
                Cari Siswa / Nomor
              </label>
              <input
                id="search-filter"
                type="text"
                placeholder="Nama, rombel, atau nomor..."
                value={searchFilter}
                onChange={(e) => setSearchFilter(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs text-slate-200 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>
          </div>
        </div>

        {/* Tabel Antrean */}
        <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900/60 shadow backdrop-blur">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-800 text-left text-xs">
              <thead className="bg-slate-800/60 text-slate-400">
                <tr>
                  <th scope="col" className="px-4 py-3 font-semibold">
                    Waktu Antre
                  </th>
                  <th scope="col" className="px-4 py-3 font-semibold">
                    Jenis
                  </th>
                  <th scope="col" className="px-4 py-3 font-semibold">
                    Siswa & Rombel
                  </th>
                  <th scope="col" className="px-4 py-3 font-semibold">
                    Tujuan WhatsApp
                  </th>
                  <th scope="col" className="px-4 py-3 font-semibold">
                    Ringkasan Pesan
                  </th>
                  <th scope="col" className="px-4 py-3 font-semibold">
                    Status
                  </th>
                  <th
                    scope="col"
                    className="px-4 py-3 text-right font-semibold"
                  >
                    Tindakan
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 text-slate-300">
                {displayItems.length === 0 ? (
                  <tr>
                    <td
                      colSpan={7}
                      className="px-4 py-12 text-center text-sm text-slate-500"
                    >
                      Tidak ada antrean notifikasi WhatsApp yang sesuai dengan
                      filter.
                    </td>
                  </tr>
                ) : (
                  displayItems.map((item) => {
                    const cleanPhone = item.tujuan_nomor.replace(/[^\d]/g, "");
                    const waMeUrl = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(
                      item.isi_pesan,
                    )}`;

                    return (
                      <tr
                        key={item.id_notifikasi}
                        className="transition hover:bg-slate-800/40"
                      >
                        <td className="whitespace-nowrap px-4 py-3 font-mono text-[11px] text-slate-400">
                          {item.created_at || "-"}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3">
                          {getJenisBadge(item.jenis)}
                        </td>
                        <td className="px-4 py-3">
                          <p className="font-semibold text-slate-200">
                            {item.nama_siswa || "Siswa"}
                          </p>
                          <p className="text-[11px] text-slate-400">
                            {item.nama_rombel || "-"}
                          </p>
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 font-mono text-slate-200">
                          {item.tujuan_nomor}
                        </td>
                        <td className="max-w-xs truncate px-4 py-3">
                          <button
                            type="button"
                            title={item.isi_pesan}
                            className="block max-w-full truncate cursor-pointer text-left text-slate-300 hover:text-indigo-400"
                            onClick={() => setSelectedItem(item)}
                          >
                            {item.isi_pesan}
                          </button>
                        </td>
                        <td className="whitespace-nowrap px-4 py-3">
                          {getStatusBadge(item.status)}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-2">
                            {/* Fallback 1-klik wa.me (Gratis & Mandiri) */}
                            <a
                              href={waMeUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-600/40 bg-emerald-600/10 px-2.5 py-1 text-xs font-semibold text-emerald-400 transition hover:bg-emerald-600 hover:text-white"
                              title="Buka langsung di WhatsApp Web / App"
                            >
                              <Icon name="whatsapp" className="h-3.5 w-3.5" />
                              Kirim Manual
                            </a>

                            {canDelete && item.status === "Menunggu" && (
                              <button
                                type="button"
                                onClick={() => handleCancelNotification(item)}
                                className="inline-flex items-center rounded-lg border border-slate-700 bg-slate-800/80 px-2.5 py-1 text-xs text-rose-400 transition hover:border-rose-600/50 hover:bg-rose-500/10"
                                title="Batalkan antrean"
                              >
                                Batalkan
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Modal Detail Pesan */}
        {selectedItem && (
          <Modal
            isOpen
            onClose={() => setSelectedItem(null)}
            title="Detail Notifikasi WhatsApp"
            maxWidth="max-w-lg"
            footer={
              <div className="flex flex-wrap justify-end gap-3">
                <a
                  href={`https://wa.me/${selectedItem.tujuan_nomor.replace(
                    /[^\d]/g,
                    "",
                  )}?text=${encodeURIComponent(selectedItem.isi_pesan)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white shadow transition hover:bg-emerald-500"
                >
                  <Icon name="whatsapp" className="h-4 w-4" />
                  Buka di WhatsApp
                </a>
                <button
                  type="button"
                  onClick={() => setSelectedItem(null)}
                  className="rounded-lg border border-slate-700 bg-slate-800 px-4 py-2 text-xs font-medium text-slate-300 transition hover:bg-slate-700"
                >
                  Tutup
                </button>
              </div>
            }
          >
            <div className="space-y-3 text-xs">
              <div>
                <span className="text-slate-400">ID Notifikasi:</span>{" "}
                <span className="font-mono text-slate-200">
                  {selectedItem.id_notifikasi}
                </span>
              </div>
              <div>
                <span className="text-slate-400">Dedupe Key:</span>{" "}
                <span className="font-mono text-slate-200">
                  {selectedItem.dedupe_key}
                </span>
              </div>
              <div>
                <span className="text-slate-400">Penerima:</span>{" "}
                <span className="font-medium text-slate-200">
                  {selectedItem.nama_siswa} ({selectedItem.nama_rombel})
                </span>
              </div>
              <div>
                <span className="text-slate-400">Nomor Tujuan:</span>{" "}
                <span className="font-mono text-slate-200">
                  {selectedItem.tujuan_nomor}
                </span>
              </div>
              <div>
                <span className="text-slate-400">Waktu Antre:</span>{" "}
                <span className="font-mono text-slate-200">
                  {selectedItem.created_at}
                </span>
              </div>
              <div>
                <span className="text-slate-400">Status:</span>{" "}
                {getStatusBadge(selectedItem.status)}
              </div>

              {selectedItem.last_error && (
                <div className="rounded-lg bg-rose-500/10 p-2.5 text-rose-400 ring-1 ring-rose-500/20">
                  <p className="font-medium">Pesan Error Terakhir:</p>
                  <p className="mt-1 font-mono text-[11px]">
                    {selectedItem.last_error}
                  </p>
                </div>
              )}

              <div>
                <p className="mb-1 text-slate-400">Isi Pesan Dibekukan:</p>
                <div className="whitespace-pre-wrap rounded-lg border border-slate-800 bg-slate-950 p-3.5 font-sans leading-relaxed text-slate-200">
                  {selectedItem.isi_pesan}
                </div>
              </div>
            </div>
          </Modal>
        )}

        {/* Modal Konfigurasi Gateway */}
        {configModalOpen && configDraft && (
          <Modal
            isOpen
            onClose={() => setConfigModalOpen(false)}
            title="Konfigurasi WhatsApp Gateway"
            subtitle="Pengaturan provider pesan otomatis ke wali (Cloud-Only)"
            maxWidth="max-w-xl"
          >
            <form onSubmit={handleSaveConfig} className="space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label
                    htmlFor="cfg-provider"
                    className="mb-1.5 block text-xs font-medium text-slate-300"
                  >
                    Provider WhatsApp
                  </label>
                  <select
                    id="cfg-provider"
                    value={configDraft.provider}
                    onChange={(e) =>
                      setConfigDraft({
                        ...configDraft,
                        provider: e.target.value as WaConfigProvider,
                      })
                    }
                    className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs text-slate-200 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  >
                    <option value="fonnte">Fonnte (Indonesia)</option>
                    <option value="wablas">Wablas (Indonesia)</option>
                    <option value="custom">Custom HTTP API</option>
                  </select>
                </div>

                <div>
                  <label
                    htmlFor="cfg-daily-limit"
                    className="mb-1.5 block text-xs font-medium text-slate-300"
                  >
                    Batas Harian (Pesan/Hari)
                  </label>
                  <input
                    id="cfg-daily-limit"
                    type="number"
                    min={1}
                    max={50000}
                    value={configDraft.dailyLimit}
                    onChange={(e) =>
                      setConfigDraft({
                        ...configDraft,
                        dailyLimit: parseInt(e.target.value, 10) || 1000,
                      })
                    }
                    className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs text-slate-200 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                </div>
              </div>

              <div>
                <label
                  htmlFor="cfg-api-key"
                  className="mb-1.5 block text-xs font-medium text-slate-300"
                >
                  API Key / Token Gateway
                </label>
                <div className="relative">
                  <input
                    id="cfg-api-key"
                    type={showApiKey ? "text" : "password"}
                    placeholder={
                      config?.hasApiKey
                        ? "(Tersimpan di vault. Biarkan kosong jika tidak diubah)"
                        : "Masukkan API Key dari dashboard provider..."
                    }
                    value={configDraft.apiKey}
                    onChange={(e) =>
                      setConfigDraft({
                        ...configDraft,
                        apiKey: e.target.value,
                      })
                    }
                    className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 pr-10 text-xs font-mono text-slate-200 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                  <button
                    type="button"
                    onClick={() => setShowApiKey(!showApiKey)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200"
                  >
                    <Icon
                      name={showApiKey ? "eye-off" : "eye"}
                      className="h-4 w-4"
                    />
                  </button>
                </div>
              </div>

              {configDraft.provider === "custom" && (
                <div>
                  <label
                    htmlFor="cfg-api-url"
                    className="mb-1.5 block text-xs font-medium text-slate-300"
                  >
                    Endpoint URL Custom API
                  </label>
                  <input
                    id="cfg-api-url"
                    type="url"
                    placeholder="https://api.gateway-anda.com/send"
                    value={configDraft.apiUrl ?? ""}
                    onChange={(e) =>
                      setConfigDraft({
                        ...configDraft,
                        apiUrl: e.target.value,
                      })
                    }
                    className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-mono text-slate-200 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                </div>
              )}

              <div>
                <label
                  htmlFor="cfg-sender-number"
                  className="mb-1.5 block text-xs font-medium text-slate-300"
                >
                  Nomor Pengirim / Device ID (Opsional)
                </label>
                <input
                  id="cfg-sender-number"
                  type="text"
                  placeholder="Contoh: 081234567890 atau device_01"
                  value={configDraft.senderNumber ?? ""}
                  onChange={(e) =>
                    setConfigDraft({
                      ...configDraft,
                      senderNumber: e.target.value,
                    })
                  }
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs text-slate-200 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>

              <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3.5">
                <p className="mb-2 text-xs font-semibold text-slate-300">
                  Pemicu Notifikasi Otomatis
                </p>
                <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 text-xs">
                  <label className="flex items-center gap-2 text-slate-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={configDraft.scanMasukEnabled}
                      onChange={(e) =>
                        setConfigDraft({
                          ...configDraft,
                          scanMasukEnabled: e.target.checked,
                        })
                      }
                      className="rounded border-slate-700 text-indigo-600 focus:ring-indigo-500"
                    />
                    Scan Masuk Gerbang
                  </label>

                  <label className="flex items-center gap-2 text-slate-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={configDraft.scanPulangEnabled}
                      onChange={(e) =>
                        setConfigDraft({
                          ...configDraft,
                          scanPulangEnabled: e.target.checked,
                        })
                      }
                      className="rounded border-slate-700 text-indigo-600 focus:ring-indigo-500"
                    />
                    Scan Pulang Gerbang
                  </label>

                  <label className="flex items-center gap-2 text-slate-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={configDraft.bolosEnabled}
                      onChange={(e) =>
                        setConfigDraft({
                          ...configDraft,
                          bolosEnabled: e.target.checked,
                        })
                      }
                      className="rounded border-slate-700 text-indigo-600 focus:ring-indigo-500"
                    />
                    Deteksi Bolos Kelas
                  </label>

                  <label className="flex items-center gap-2 text-slate-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={configDraft.ambangAlfaEnabled}
                      onChange={(e) =>
                        setConfigDraft({
                          ...configDraft,
                          ambangAlfaEnabled: e.target.checked,
                        })
                      }
                      className="rounded border-slate-700 text-indigo-600 focus:ring-indigo-500"
                    />
                    Peringatan Ambang Alfa
                  </label>
                </div>
                <p className="mt-2.5 text-[11px] leading-relaxed text-slate-400">
                  Pemicu yang dimatikan tidak akan membuat baris antrean sama
                  sekali — bukan sekadar tidak dikirim. Sekolah 800 siswa
                  menghasilkan sekitar 1.600 baris per hari bila Scan Masuk dan
                  Scan Pulang dibiarkan menyala. Keempatnya bawaannya mati, dan
                  perubahan di sini ikut tersinkronisasi ke seluruh terminal
                  pemindai.
                </p>
              </div>

              <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 p-3.5">
                <label className="flex items-center gap-2.5 text-xs font-semibold text-amber-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={configDraft.isActive}
                    onChange={(e) =>
                      setConfigDraft({
                        ...configDraft,
                        isActive: e.target.checked,
                      })
                    }
                    className="h-4 w-4 rounded border-slate-700 text-amber-500 focus:ring-amber-400"
                  />
                  Aktifkan Pengiriman Otomatis WhatsApp Gateway
                </label>
                <p className="mt-1 text-[11px] text-amber-400/80">
                  Bila nonaktif, antrean tetap dicatat dan Anda dapat mengirim
                  pesan satu per satu secara gratis menggunakan tautan WhatsApp
                  Web (wa.me).
                </p>
              </div>

              <div className="mt-6 flex justify-end gap-3 border-t border-slate-800 pt-4">
                <button
                  type="button"
                  onClick={() => setConfigModalOpen(false)}
                  className="rounded-lg border border-slate-700 bg-slate-800 px-4 py-2 text-xs font-medium text-slate-300 transition hover:bg-slate-700"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={savingConfig}
                  className="rounded-lg bg-indigo-600 px-4 py-2 text-xs font-semibold text-white shadow transition hover:bg-indigo-500 disabled:opacity-50"
                >
                  {savingConfig ? "Menyimpan..." : "Simpan Konfigurasi"}
                </button>
              </div>
            </form>
          </Modal>
        )}
      </div>
      {dialogKonfirmasi}
    </AppShell>
  );
}
