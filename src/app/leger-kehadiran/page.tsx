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
import { getDaftarRombel, getDaftarTahunAjaran } from "@/lib/gateways/academic";
import {
  deleteFrozenLedger,
  type FrozenLedgerItem,
  freezeAttendanceLedger,
  getFrozenLedger,
  getLedgerPreview,
  type LedgerStudentItem,
} from "@/lib/gateways/attendance-ledger";
import { syncNow } from "@/lib/gateways/sync-status";

type ModeTab = "preview" | "frozen";

export default function LegerKehadiranPage() {
  const { user, isAuthenticated, isLoading: authLoading } = useAuth();
  const canManage = hasPermission(user, "attendance_ledger.manage");
  const canDelete = hasPermission(user, "attendance_ledger.delete");

  const [activeTab, setActiveTab] = useState<ModeTab>("preview");
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState<{
    tone: "success" | "error" | "warning";
    message: string;
  } | null>(null);

  // Filters
  const [tahunAjaranList, setTahunAjaranList] = useState<
    Record<string, unknown>[]
  >([]);
  const [rombelList, setRombelList] = useState<Record<string, unknown>[]>([]);

  const [selectedTa, setSelectedTa] = useState<string>("");
  const [selectedSemester, setSelectedSemester] = useState<string>("Ganjil");
  const [selectedRombel, setSelectedRombel] = useState<string>("");

  // Data
  const [previewStudents, setPreviewStudents] = useState<LedgerStudentItem[]>(
    [],
  );
  const [totalHariEfektif, setTotalHariEfektif] = useState(0);
  const [frozenStudents, setFrozenStudents] = useState<FrozenLedgerItem[]>([]);

  // Modals
  const [showFreezeConfirm, setShowFreezeConfirm] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const isSubmittingRef = useRef(false);

  // Guard area level
  if (
    !authLoading &&
    isAuthenticated &&
    !canAccessArea(user, "leger_kehadiran")
  ) {
    redirect("/forbidden");
  }

  // Load masters
  const loadMasterData = useCallback(async () => {
    try {
      const [taData, rData] = await Promise.all([
        getDaftarTahunAjaran(),
        getDaftarRombel(),
      ]);
      setTahunAjaranList(taData || []);
      setRombelList(rData || []);

      // Auto-pilih tahun ajaran aktif jika ada
      const activeTa = taData?.find((ta) => ta.is_aktif === 1);
      if (activeTa) {
        setSelectedTa(String(activeTa.id_tahun_ajaran));
        if (activeTa.semester) {
          setSelectedSemester(String(activeTa.semester));
        }
      } else if (taData && taData.length > 0) {
        setSelectedTa(String(taData[0].id_tahun_ajaran));
      }

      if (rData && rData.length > 0) {
        setSelectedRombel(String(rData[0].id_rombel));
      }
    } catch {
      // Abaikan galat master
    }
  }, []);

  useEffect(() => {
    if (isAuthenticated) {
      void loadMasterData();
    }
  }, [isAuthenticated, loadMasterData]);

  // Load ledger data
  const loadLedger = useCallback(async () => {
    if (!selectedTa) return;
    setLoading(true);
    try {
      if (activeTab === "preview") {
        const res = await getLedgerPreview(
          selectedTa,
          selectedSemester,
          selectedRombel || undefined,
        );
        setPreviewStudents(res.students || []);
        setTotalHariEfektif(res.total_hari_efektif || 0);
      } else {
        const res = await getFrozenLedger(
          selectedTa,
          selectedSemester,
          selectedRombel || undefined,
        );
        setFrozenStudents(res || []);
      }
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : "Gagal memuat data leger.";
      setFeedback({ tone: "error", message: msg });
    } finally {
      setLoading(false);
    }
  }, [selectedTa, selectedSemester, selectedRombel, activeTab]);

  useEffect(() => {
    if (isAuthenticated && selectedTa) {
      void loadLedger();
    }
  }, [isAuthenticated, selectedTa, loadLedger]);

  // Background sync listener
  useEffect(() => {
    const onSyncCompleted = () => {
      void loadLedger();
    };
    window.addEventListener("sppg:sync-completed", onSyncCompleted);
    return () => {
      window.removeEventListener("sppg:sync-completed", onSyncCompleted);
    };
  }, [loadLedger]);

  const handleRefresh = async () => {
    try {
      await syncNow();
    } catch {
      // Abaikan galat sinkronisasi sementara
    }
    await loadLedger();
    setFeedback({
      tone: "success",
      message: "Data leger berhasil disinkronkan.",
    });
  };

  const handleFreeze = async () => {
    if (isSubmittingRef.current || !selectedTa || !selectedRombel) return;
    isSubmittingRef.current = true;
    try {
      const res = await freezeAttendanceLedger({
        id_tahun_ajaran: selectedTa,
        semester: selectedSemester,
        id_rombel: selectedRombel,
        items: previewStudents,
      });
      setShowFreezeConfirm(false);
      setFeedback({
        tone: "success",
        message: `Berhasil membekukan data leger untuk ${res.total_dibekukan} siswa. Angka kehadiran rapor sekarang terkunci.`,
      });
      setActiveTab("frozen");
      await loadLedger();
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : "Gagal membekukan data leger.";
      setFeedback({ tone: "error", message: msg });
    } finally {
      isSubmittingRef.current = false;
    }
  };

  const handleDeleteFrozen = async () => {
    if (isSubmittingRef.current || !selectedTa || !selectedRombel) return;
    isSubmittingRef.current = true;
    try {
      await deleteFrozenLedger(selectedTa, selectedSemester, selectedRombel);
      setShowDeleteConfirm(false);
      setFeedback({
        tone: "success",
        message:
          "Pembekuan leger berhasil dibatalkan. Anda dapat meninjau pratinjau langsung kembali.",
      });
      await loadLedger();
    } catch (err: unknown) {
      const msg =
        err instanceof Error
          ? err.message
          : "Gagal membatalkan pembekuan leger.";
      setFeedback({ tone: "error", message: msg });
    } finally {
      isSubmittingRef.current = false;
    }
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <AppShell>
      <div className="space-y-6 print:p-0">
        <div className="print:hidden">
          <PageHeader
            eyebrow="AKADEMIK & RAPOR"
            title="Leger Kehadiran Siswa"
            description="Rekapitulasi kehadiran semesteran untuk buku rapor. Pratinjau langsung dihitung on-the-fly, dan dapat dibekukan saat penutupan semester."
            actions={
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handlePrint}
                  className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-lg border border-slate-700 hover:bg-slate-800 transition-colors"
                >
                  <Icon name="download" className="w-4 h-4" />
                  Cetak / PDF
                </button>
                <button
                  type="button"
                  onClick={() => void handleRefresh()}
                  className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-lg border border-slate-700 hover:bg-slate-800 transition-colors"
                >
                  <Icon name="refresh" className="w-4 h-4" />
                  Muat Ulang
                </button>
              </div>
            }
          />
        </div>

        {feedback && (
          <div className="print:hidden">
            <FeedbackBanner
              tone={feedback.tone}
              onDismiss={() => setFeedback(null)}
            >
              {feedback.message}
            </FeedbackBanner>
          </div>
        )}

        {/* Tab Selector & Filter Bar */}
        <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/60 backdrop-blur-sm space-y-4 print:hidden">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-3">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setActiveTab("preview")}
                className={`px-4 py-2 text-sm font-semibold rounded-lg transition-colors ${
                  activeTab === "preview"
                    ? "bg-sky-600 text-white"
                    : "text-slate-400 hover:text-slate-200 hover:bg-slate-800"
                }`}
              >
                Pratinjau Langsung (Kalkulasi Otomatis)
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("frozen")}
                className={`px-4 py-2 text-sm font-semibold rounded-lg transition-colors ${
                  activeTab === "frozen"
                    ? "bg-sky-600 text-white"
                    : "text-slate-400 hover:text-slate-200 hover:bg-slate-800"
                }`}
              >
                Leger Beku (Terkunci untuk Rapor)
              </button>
            </div>

            {activeTab === "preview" &&
              canManage &&
              previewStudents.length > 0 && (
                <button
                  type="button"
                  onClick={() => setShowFreezeConfirm(true)}
                  className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white transition-colors"
                >
                  <Icon name="lock" className="w-4 h-4" />
                  Bekukan Leger Semester Ini
                </button>
              )}

            {activeTab === "frozen" &&
              canDelete &&
              frozenStudents.length > 0 && (
                <button
                  type="button"
                  onClick={() => setShowDeleteConfirm(true)}
                  className="inline-flex items-center gap-2 px-3 py-1.5 text-xs font-semibold rounded-lg border border-rose-800/80 text-rose-400 hover:bg-rose-500/20 transition-colors"
                >
                  <Icon name="trash" className="w-3.5 h-3.5" />
                  Batalkan Pembekuan Leger
                </button>
              )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <span className="block text-xs font-medium text-slate-400 mb-1">
                Tahun Ajaran
              </span>
              <select
                aria-label="Tahun ajaran"
                value={selectedTa}
                onChange={(e) => setSelectedTa(e.target.value)}
                className="w-full text-sm rounded-lg px-3 py-2 bg-slate-900 border border-slate-700 text-slate-100 focus:outline-none focus:ring-1 focus:ring-sky-500"
              >
                {tahunAjaranList.map((ta) => (
                  <option
                    key={String(ta.id_tahun_ajaran)}
                    value={String(ta.id_tahun_ajaran)}
                  >
                    {String(ta.tahun_ajaran)} ({String(ta.semester)})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <span className="block text-xs font-medium text-slate-400 mb-1">
                Semester
              </span>
              <select
                aria-label="Semester"
                value={selectedSemester}
                onChange={(e) => setSelectedSemester(e.target.value)}
                className="w-full text-sm rounded-lg px-3 py-2 bg-slate-900 border border-slate-700 text-slate-100 focus:outline-none focus:ring-1 focus:ring-sky-500"
              >
                <option value="Ganjil">Semester Ganjil</option>
                <option value="Genap">Semester Genap</option>
              </select>
            </div>

            <div>
              <span className="block text-xs font-medium text-slate-400 mb-1">
                Rombongan Belajar (Kelas)
              </span>
              <select
                aria-label="Rombongan belajar"
                value={selectedRombel}
                onChange={(e) => setSelectedRombel(e.target.value)}
                className="w-full text-sm rounded-lg px-3 py-2 bg-slate-900 border border-slate-700 text-slate-100 focus:outline-none focus:ring-1 focus:ring-sky-500"
              >
                <option value="">Semua Rombel</option>
                {rombelList.map((r) => (
                  <option key={String(r.id_rombel)} value={String(r.id_rombel)}>
                    {String(r.nama_rombel)}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Print Header */}
        <div className="hidden print:block mb-4 text-center border-b pb-3">
          <h2 className="text-xl font-bold text-slate-900">
            LEGER KEHADIRAN SISWA
          </h2>
          <p className="text-sm text-slate-600">
            Tahun Ajaran:{" "}
            {
              tahunAjaranList.find((t) => t.id_tahun_ajaran === selectedTa)
                ?.tahun_ajaran as string
            }{" "}
            · Semester: {selectedSemester} · Rombel:{" "}
            {(rombelList.find((r) => r.id_rombel === selectedRombel)
              ?.nama_rombel as string) || "Semua Rombel"}
          </p>
          {activeTab === "frozen" && frozenStudents.length > 0 && (
            <p className="text-xs text-slate-500 mt-0.5">
              Status: TERKUNCI / DIBEKUKAN oleh{" "}
              {frozenStudents[0].dibekukan_oleh} pada{" "}
              {frozenStudents[0].dibekukan_at}
            </p>
          )}
        </div>

        {/* Table Display */}
        {loading ? (
          <div className="p-12 text-center text-slate-400">
            <Icon
              name="refresh"
              className="w-8 h-8 mx-auto animate-spin mb-2"
            />
            Mengkalkulasi data leger kehadiran...
          </div>
        ) : activeTab === "preview" ? (
          previewStudents.length === 0 ? (
            <div className="p-12 text-center rounded-xl border border-dashed border-slate-800 bg-slate-900/30 text-slate-400">
              <Icon
                name="calendar"
                className="w-10 h-10 mx-auto mb-2 opacity-50"
              />
              <p className="font-medium">
                Tidak ada data kehadiran siswa pada rentang semester ini.
              </p>
            </div>
          ) : (
            <div className="rounded-xl border border-slate-800 bg-slate-900/60 overflow-x-auto shadow-sm">
              <div className="p-3 bg-slate-800/40 border-b border-slate-800 text-xs text-slate-300 flex justify-between items-center print:hidden">
                <span>
                  Hari Efektif Semester Terdeteksi:{" "}
                  <strong>{totalHariEfektif} hari</strong>
                </span>
                <span className="text-slate-400">
                  Total Siswa: {previewStudents.length} orang
                </span>
              </div>
              <table className="w-full text-left text-sm text-slate-200">
                <thead className="text-xs uppercase bg-slate-950/70 text-slate-400 border-b border-slate-800">
                  <tr>
                    <th className="px-3 py-3 w-12 text-center">No</th>
                    <th className="px-3 py-3">NIS</th>
                    <th className="px-3 py-3">Nama Lengkap</th>
                    <th className="px-3 py-3">Kelas</th>
                    <th className="px-3 py-3 text-center">Hadir</th>
                    <th className="px-3 py-3 text-center">Izin</th>
                    <th className="px-3 py-3 text-center">Sakit</th>
                    <th className="px-3 py-3 text-center">Alfa</th>
                    <th className="px-3 py-3 text-center">Dispen</th>
                    <th className="px-3 py-3 text-center">Hari Efektif</th>
                    <th className="px-3 py-3 text-right">% Hadir</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {previewStudents.map((s, idx) => (
                    <tr key={s.id_siswa} className="hover:bg-slate-800/40">
                      <td className="px-3 py-2.5 text-center text-slate-500 text-xs">
                        {idx + 1}
                      </td>
                      <td className="px-3 py-2.5 text-slate-400 text-xs font-mono">
                        {s.nis || "-"}
                      </td>
                      <td className="px-3 py-2.5 font-medium text-slate-100">
                        {s.nama_lengkap}
                      </td>
                      <td className="px-3 py-2.5 text-slate-400 text-xs">
                        {s.nama_rombel}
                      </td>
                      <td className="px-3 py-2.5 text-center font-semibold text-emerald-400">
                        {s.hadir}
                      </td>
                      <td className="px-3 py-2.5 text-center text-sky-400">
                        {s.izin}
                      </td>
                      <td className="px-3 py-2.5 text-center text-amber-400">
                        {s.sakit}
                      </td>
                      <td className="px-3 py-2.5 text-center text-rose-400 font-semibold">
                        {s.alfa}
                      </td>
                      <td className="px-3 py-2.5 text-center text-purple-400">
                        {s.dispensasi}
                      </td>
                      <td className="px-3 py-2.5 text-center text-slate-400">
                        {s.total_hari_efektif}
                      </td>
                      <td className="px-3 py-2.5 text-right font-bold">
                        <span
                          className={`px-2 py-0.5 rounded text-xs ${
                            s.persen_kehadiran >= 85
                              ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                              : s.persen_kehadiran >= 75
                                ? "bg-amber-500/20 text-amber-400 border border-amber-500/30"
                                : "bg-rose-500/20 text-rose-400 border border-rose-500/30"
                          }`}
                        >
                          {s.persen_kehadiran}%
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : frozenStudents.length === 0 ? (
          <div className="p-12 text-center rounded-xl border border-dashed border-slate-800 bg-slate-900/30 text-slate-400">
            <Icon name="lock" className="w-10 h-10 mx-auto mb-2 opacity-50" />
            <p className="font-medium">
              Belum ada leger beku untuk rombel dan semester ini.
            </p>
            <p className="text-xs text-slate-500 mt-1">
              Buka tab Pratinjau Langsung dan tekan &ldquo;Bekukan Leger
              Semester Ini&rdquo; untuk mengunci nilai rapor.
            </p>
          </div>
        ) : (
          <div className="rounded-xl border border-slate-800 bg-slate-900/60 overflow-x-auto shadow-sm">
            <div className="p-3 bg-emerald-950/30 border-b border-slate-800 text-xs text-emerald-300 flex justify-between items-center print:hidden">
              <span className="flex items-center gap-1.5 font-medium">
                <Icon name="lock" className="w-3.5 h-3.5" />
                Leger ini telah dibekukan oleh{" "}
                <strong>{frozenStudents[0].dibekukan_oleh}</strong> pada{" "}
                {frozenStudents[0].dibekukan_at}
              </span>
              <span className="text-slate-400">
                {frozenStudents.length} siswa terkunci
              </span>
            </div>
            <table className="w-full text-left text-sm text-slate-200">
              <thead className="text-xs uppercase bg-slate-950/70 text-slate-400 border-b border-slate-800">
                <tr>
                  <th className="px-3 py-3 w-12 text-center">No</th>
                  <th className="px-3 py-3">NIS</th>
                  <th className="px-3 py-3">Nama Lengkap</th>
                  <th className="px-3 py-3">Kelas</th>
                  <th className="px-3 py-3 text-center">Hadir</th>
                  <th className="px-3 py-3 text-center">Izin</th>
                  <th className="px-3 py-3 text-center">Sakit</th>
                  <th className="px-3 py-3 text-center">Alfa</th>
                  <th className="px-3 py-3 text-center">Dispen</th>
                  <th className="px-3 py-3 text-center">Hari Efektif</th>
                  <th className="px-3 py-3 text-right">% Hadir</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {frozenStudents.map((s, idx) => (
                  <tr key={s.id_leger} className="hover:bg-slate-800/40">
                    <td className="px-3 py-2.5 text-center text-slate-500 text-xs">
                      {idx + 1}
                    </td>
                    <td className="px-3 py-2.5 text-slate-400 text-xs font-mono">
                      {s.nis || "-"}
                    </td>
                    <td className="px-3 py-2.5 font-medium text-slate-100">
                      {s.nama_lengkap}
                    </td>
                    <td className="px-3 py-2.5 text-slate-400 text-xs">
                      {s.nama_rombel}
                    </td>
                    <td className="px-3 py-2.5 text-center font-semibold text-emerald-400">
                      {s.hadir}
                    </td>
                    <td className="px-3 py-2.5 text-center text-sky-400">
                      {s.izin}
                    </td>
                    <td className="px-3 py-2.5 text-center text-amber-400">
                      {s.sakit}
                    </td>
                    <td className="px-3 py-2.5 text-center text-rose-400 font-semibold">
                      {s.alfa}
                    </td>
                    <td className="px-3 py-2.5 text-center text-purple-400">
                      {s.dispensasi}
                    </td>
                    <td className="px-3 py-2.5 text-center text-slate-400">
                      {s.total_hari_efektif}
                    </td>
                    <td className="px-3 py-2.5 text-right font-bold">
                      <span
                        className={`px-2 py-0.5 rounded text-xs ${
                          s.persen_kehadiran >= 85
                            ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                            : s.persen_kehadiran >= 75
                              ? "bg-amber-500/20 text-amber-400 border border-amber-500/30"
                              : "bg-rose-500/20 text-rose-400 border border-rose-500/30"
                        }`}
                      >
                        {s.persen_kehadiran}%
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Modal Konfirmasi Pembekuan Leger */}
        {showFreezeConfirm && (
          <Modal
            isOpen={true}
            onClose={() => setShowFreezeConfirm(false)}
            title="Konfirmasi Pembekuan Leger Kehadiran"
          >
            <div className="space-y-4">
              <p className="text-sm text-slate-300">
                Membekukan leger kehadiran akan mengunci angka kehadiran seluruh
                siswa di rombel ini ke dalam tabel permanen. Koreksi absensi
                masa lalu di masa mendatang tidak akan lagi mengubah nilai pada
                rapor yang sudah dibagikan.
              </p>
              <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-xs text-amber-300">
                Tindakan ini akan mengunci {previewStudents.length} catatan
                kehadiran siswa dengan stempel waktu dan akun login Anda.
              </div>
              <div className="flex justify-end gap-2 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowFreezeConfirm(false)}
                  className="px-4 py-2 text-sm font-medium rounded-lg border border-slate-700 hover:bg-slate-800 transition-colors"
                >
                  Batal
                </button>
                <button
                  type="button"
                  onClick={() => void handleFreeze()}
                  className="px-4 py-2 text-sm font-medium rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white transition-colors"
                >
                  Ya, Bekukan Sekarang
                </button>
              </div>
            </div>
          </Modal>
        )}

        {/* Modal Konfirmasi Batal Bekukan Leger */}
        {showDeleteConfirm && (
          <Modal
            isOpen={true}
            onClose={() => setShowDeleteConfirm(false)}
            title="Batalkan Pembekuan Leger Kehadiran"
          >
            <div className="space-y-4">
              <p className="text-sm text-slate-300">
                Apakah Anda yakin ingin membatalkan pembekuan leger ini?
                Tindakan ini akan menghapus catatan angka terkunci untuk rombel
                dan semester ini.
              </p>
              <div className="flex justify-end gap-2 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowDeleteConfirm(false)}
                  className="px-4 py-2 text-sm font-medium rounded-lg border border-slate-700 hover:bg-slate-800 transition-colors"
                >
                  Batal
                </button>
                <button
                  type="button"
                  onClick={() => void handleDeleteFrozen()}
                  className="px-4 py-2 text-sm font-medium rounded-lg bg-rose-600 hover:bg-rose-500 text-white transition-colors"
                >
                  Hapus & Batalkan
                </button>
              </div>
            </div>
          </Modal>
        )}
      </div>
    </AppShell>
  );
}
