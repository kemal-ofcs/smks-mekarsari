"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { FeedbackBanner } from "@/components/ui/FeedbackBanner";
import { Icon } from "@/components/ui/Icon";
import { Modal } from "@/components/ui/Modal";
import { PageHeader } from "@/components/ui/PageHeader";
import { hasPermission } from "@/lib/auth/access";
import { useAuth } from "@/lib/context/AuthContext";
import { getDaftarMapel } from "@/lib/gateways/academic";
import { getDaftarKaryawan } from "@/lib/gateways/employee";
import {
  deleteJpRate,
  getJpRates,
  type JpRateRow,
  saveJpRate,
} from "@/lib/gateways/payroll";
import { syncNow } from "@/lib/gateways/sync-status";
import { useConfirmDialog } from "@/lib/hooks/useConfirmDialog";
import { useHydrated } from "@/lib/hooks/useHydrated";
import { isTeacherPersonnel } from "@/lib/validations/payroll-policy";

const IDR = new Intl.NumberFormat("id-ID", {
  style: "currency",
  currency: "IDR",
  maximumFractionDigits: 0,
});

/**
 * Tarif honor per jam pelajaran.
 *
 * Tarif khusus (guru + mapel) menang atas tarif umum mapel, dan keduanya menang
 * atas tarif bawaan orang itu di Konfigurasi Penggajian. Urutan itu dieja sekali
 * di `resolveJpRate` / `resolve_jp_rate`, bukan di layar ini.
 */
export default function JpRatesPage() {
  // Penjaga anti klik ganda (Aturan 5). Dideklarasikan di ATAS, sebelum setiap
  // early return, supaya urutan hook tidak pernah berubah antar-render.
  // Konfirmasi aksi merusak memakai dialog APLIKASI, bukan dialog bawaan peramban.
  const { konfirmasi, dialogKonfirmasi } = useConfirmDialog();
  const isSubmittingRef = useRef(false);

  const isHydrated = useHydrated();
  const router = useRouter();
  const { user, isAuthenticated, isLoading: authLoading } = useAuth();

  const [rates, setRates] = useState<JpRateRow[]>([]);
  const [mapelList, setMapelList] = useState<Record<string, unknown>[]>([]);
  const [guruList, setGuruList] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [draft, setDraft] = useState<Partial<JpRateRow>>({});

  const [feedback, setFeedback] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [rateRows, mapelRows, personnel] = await Promise.all([
        getJpRates(),
        getDaftarMapel(),
        getDaftarKaryawan(),
      ]);
      setRates(rateRows);
      setMapelList(mapelRows as Record<string, unknown>[]);
      setGuruList(
        (personnel as Record<string, unknown>[]).filter((row) =>
          isTeacherPersonnel(row.jenis_personil),
        ),
      );
    } catch (err: unknown) {
      setFeedback({
        type: "error",
        message:
          err instanceof Error
            ? err.message
            : "Gagal memuat tarif jam pelajaran.",
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isHydrated || authLoading) return;
    if (!isAuthenticated) {
      router.push("/login");
      return;
    }
    if (!hasPermission(user, "payroll.config.manage")) {
      router.push("/payroll");
      return;
    }
    void loadData();
  }, [isHydrated, authLoading, isAuthenticated, user, router, loadData]);

  useEffect(() => {
    const handleSync = () => {
      void loadData();
    };
    window.addEventListener("sppg:sync-completed", handleSync);
    return () => window.removeEventListener("sppg:sync-completed", handleSync);
  }, [loadData]);

  const handleReload = async () => {
    setIsSyncing(true);
    try {
      await syncNow();
    } catch {
      // Sengaja diam: kegagalan sinkronisasi TIDAK boleh menghalangi pemuatan
      // data lokal di blok finally. Aplikasi ini offline-first.
    } finally {
      await loadData();
      setIsSyncing(false);
    }
  };

  const openAdd = () => {
    setDraft({
      id_mapel: "",
      id_guru: null,
      rate_per_jp: 0,
      effective_date: new Date().toISOString().slice(0, 10),
      status_aktif: 1,
    });
    setModalOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmittingRef.current) return;
    isSubmittingRef.current = true;
    try {
      await saveJpRate(draft);
      setModalOpen(false);
      setFeedback({
        type: "success",
        message: "Tarif jam pelajaran berhasil disimpan.",
      });
      await loadData();
    } catch (err: unknown) {
      setFeedback({
        type: "error",
        message:
          err instanceof Error ? err.message : "Gagal menyimpan tarif JP.",
      });
    } finally {
      isSubmittingRef.current = false;
    }
  };

  const handleDelete = async (row: JpRateRow) => {
    if (isSubmittingRef.current) return;
    if (
      !(await konfirmasi({
        title: "Hapus tarif per JP ini?",
        description: `Tarif ${IDR.format(row.rate_per_jp)} per JP untuk ${
          row.nama_mapel || row.id_mapel
        } dihapus permanen.`,
        preserved:
          "Slip gaji yang sudah terbit tetap memakai tarif yang tersimpan di dalamnya.",
        confirmLabel: "Ya, hapus",
      }))
    ) {
      return;
    }
    isSubmittingRef.current = true;
    try {
      await deleteJpRate(row.id);
      setFeedback({ type: "success", message: "Tarif JP berhasil dihapus." });
      await loadData();
    } catch (err: unknown) {
      setFeedback({
        type: "error",
        message:
          err instanceof Error ? err.message : "Gagal menghapus tarif JP.",
      });
    } finally {
      isSubmittingRef.current = false;
    }
  };

  if (!isHydrated || authLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-950 text-slate-400">
        Memuat otorisasi...
      </div>
    );
  }

  return (
    <AppShell contentClassName="mx-auto w-full max-w-7xl space-y-6 px-4 py-6 sm:px-6 md:py-8 lg:px-8">
      <div className="space-y-6">
        <PageHeader
          eyebrow="Konfigurasi Penggajian"
          title="Tarif Honor per Jam Pelajaran"
          description="Honor mengajar dihitung dari jam pelajaran yang jurnalnya sudah diparaf, dengan tarif per mata pelajaran."
          actions={
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void handleReload()}
                disabled={isSyncing || loading}
                className="px-4 py-2 text-sm font-semibold rounded-lg bg-slate-800 text-slate-200 hover:bg-slate-700 transition flex items-center gap-2 border border-slate-700 disabled:opacity-50"
              >
                <Icon
                  name="refresh"
                  className={`w-4 h-4 ${isSyncing ? "animate-spin" : ""}`}
                />
                {isSyncing ? "Menyinkronkan..." : "Muat Ulang"}
              </button>
              <Link
                href="/payroll/config"
                className="px-4 py-2 text-sm font-semibold rounded-lg bg-slate-800 text-slate-200 hover:bg-slate-700 transition flex items-center gap-2 border border-slate-700"
              >
                <Icon name="arrow-left" className="w-4 h-4" />
                Kembali
              </Link>
            </div>
          }
        />

        {feedback ? (
          <FeedbackBanner
            tone={feedback.type}
            onDismiss={() => setFeedback(null)}
          >
            {feedback.message}
          </FeedbackBanner>
        ) : null}

        <div className="p-4 bg-slate-900 border border-slate-800 rounded-xl text-xs text-slate-400 leading-relaxed">
          Tarif khusus untuk seorang guru menang atas tarif umum mata
          pelajarannya, dan keduanya menang atas tarif bawaan di Konfigurasi
          Penggajian. Tarif mengikuti <strong>tanggal sesi</strong>, jadi
          kenaikan di tengah bulan tidak berlaku surut. Jam yang sama pada satu
          tanggal dihitung sekali meskipun tercatat pada beberapa rombel — kelas
          gabungan tidak menghasilkan honor ganda.
        </div>

        <div className="flex justify-between items-center">
          <div className="text-xs text-slate-500">
            {rates.length} tarif tersimpan.
          </div>
          <button
            type="button"
            onClick={openAdd}
            className="px-3 py-1.5 bg-sky-600 hover:bg-sky-500 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5"
          >
            <Icon name="plus" className="w-3.5 h-3.5" />
            Tambah Tarif
          </button>
        </div>

        <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-900/60">
          <table className="w-full text-left text-sm text-slate-300">
            <thead className="bg-slate-800/80 text-xs font-semibold uppercase text-slate-400 border-b border-slate-700/60">
              <tr>
                <th className="py-3 px-4">Mata Pelajaran</th>
                <th className="py-3 px-4">Berlaku Untuk</th>
                <th className="py-3 px-4 text-right">Tarif / JP</th>
                <th className="py-3 px-4">Berlaku Sejak</th>
                <th className="py-3 px-4 text-center">Status</th>
                <th className="py-3 px-4 text-center">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {loading ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-slate-500">
                    Memuat tarif jam pelajaran...
                  </td>
                </tr>
              ) : rates.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-slate-500">
                    Belum ada tarif. Tanpa tarif apa pun, honor mengajar
                    dihitung dari tarif bawaan tiap orang di Konfigurasi
                    Penggajian.
                  </td>
                </tr>
              ) : (
                rates.map((row) => (
                  <tr key={row.id} className="hover:bg-slate-800/40 transition">
                    <td className="py-3 px-4 font-semibold text-slate-200">
                      {row.nama_mapel || row.id_mapel}
                    </td>
                    <td className="py-3 px-4 text-xs text-slate-400">
                      {row.id_guru
                        ? row.nama_guru || row.id_guru
                        : "Semua guru mapel ini"}
                    </td>
                    <td className="py-3 px-4 text-right font-mono font-bold text-slate-200">
                      {IDR.format(row.rate_per_jp)}
                    </td>
                    <td className="py-3 px-4 text-xs font-mono text-slate-400">
                      {row.effective_date}
                    </td>
                    <td className="py-3 px-4 text-center">
                      <span
                        className={`px-2 py-0.5 rounded text-[11px] font-semibold border ${
                          row.status_aktif === 1
                            ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
                            : "bg-slate-700/40 text-slate-400 border-slate-600/40"
                        }`}
                      >
                        {row.status_aktif === 1 ? "Aktif" : "Nonaktif"}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-center space-x-2">
                      <button
                        type="button"
                        onClick={() => {
                          setDraft(row);
                          setModalOpen(true);
                        }}
                        className="px-2 py-1 text-xs bg-slate-800 hover:bg-slate-700 text-sky-400 rounded border border-slate-700"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleDelete(row)}
                        className="px-2 py-1 text-xs bg-slate-800 hover:bg-slate-700 text-rose-400 rounded border border-slate-700"
                      >
                        Hapus
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {modalOpen ? (
          <Modal
            title="Tarif Honor per Jam Pelajaran"
            titleId="modal-jp-rate"
            onClose={() => setModalOpen(false)}
          >
            <form
              onSubmit={handleSave}
              className="space-y-4 text-sm text-slate-300"
            >
              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase mb-1">
                  <span>Mata Pelajaran</span>
                  <select
                    value={draft.id_mapel ?? ""}
                    onChange={(e) =>
                      setDraft((prev) => ({
                        ...prev,
                        id_mapel: e.target.value,
                      }))
                    }
                    required
                    className="w-full mt-1 px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-slate-200 focus:outline-none focus:border-sky-500 font-normal"
                  >
                    <option value="">-- Pilih Mata Pelajaran --</option>
                    {mapelList.map((mapel) => (
                      <option
                        key={String(mapel.id_mapel)}
                        value={String(mapel.id_mapel)}
                      >
                        {String(mapel.nama_mapel)}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase mb-1">
                  <span>Berlaku Untuk</span>
                  <select
                    value={draft.id_guru ?? ""}
                    onChange={(e) =>
                      setDraft((prev) => ({
                        ...prev,
                        id_guru: e.target.value || null,
                      }))
                    }
                    className="w-full mt-1 px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-slate-200 focus:outline-none focus:border-sky-500 font-normal"
                  >
                    <option value="">Semua guru mapel ini</option>
                    {guruList.map((guru) => (
                      <option
                        key={String(guru.id_unik)}
                        value={String(guru.id_unik)}
                      >
                        {String(guru.nama)}
                      </option>
                    ))}
                  </select>
                </label>
                <p className="mt-1 text-xs text-slate-500">
                  Pilih seorang guru untuk tarif khusus, misalnya guru senior
                  dengan honor lebih tinggi pada mapel yang sama.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-400 uppercase mb-1">
                    <span>Tarif (Rp / JP)</span>
                    <input
                      type="number"
                      min={0}
                      value={draft.rate_per_jp ?? 0}
                      onChange={(e) =>
                        setDraft((prev) => ({
                          ...prev,
                          rate_per_jp: Number(e.target.value),
                        }))
                      }
                      required
                      className="w-full mt-1 px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-slate-200 focus:outline-none focus:border-sky-500 font-mono font-normal"
                    />
                  </label>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-400 uppercase mb-1">
                    <span>Berlaku Sejak</span>
                    <input
                      type="date"
                      value={draft.effective_date ?? ""}
                      onChange={(e) =>
                        setDraft((prev) => ({
                          ...prev,
                          effective_date: e.target.value,
                        }))
                      }
                      required
                      className="w-full mt-1 px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-slate-200 focus:outline-none focus:border-sky-500 font-normal"
                    />
                  </label>
                </div>
              </div>

              <div>
                <label className="flex items-center gap-3 text-xs font-semibold text-slate-300">
                  <input
                    type="checkbox"
                    checked={(draft.status_aktif ?? 1) === 1}
                    onChange={(e) =>
                      setDraft((prev) => ({
                        ...prev,
                        status_aktif: e.target.checked ? 1 : 0,
                      }))
                    }
                    className="h-4 w-4 rounded border-slate-600 bg-slate-800 accent-sky-500"
                  />
                  <span>Tarif aktif</span>
                </label>
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-slate-700">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-sm font-semibold"
                >
                  Simpan Tarif
                </button>
              </div>
            </form>
          </Modal>
        ) : null}
      </div>

      {dialogKonfirmasi}
    </AppShell>
  );
}
