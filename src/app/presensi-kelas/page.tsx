"use client";

import { redirect } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { FeedbackBanner } from "@/components/ui/FeedbackBanner";
import { Icon } from "@/components/ui/Icon";
import { Modal } from "@/components/ui/Modal";
import { PageHeader } from "@/components/ui/PageHeader";
import { formatTanggalOperasional } from "@/lib/attendance/time-policy";
import { canAccessArea, hasPermission } from "@/lib/auth/access";
import { useAuth } from "@/lib/context/AuthContext";
import {
  getDaftarMapel,
  getDaftarRombel,
  getDaftarTahunAjaran,
} from "@/lib/gateways/academic";
import {
  type AttendanceAnomalyItem,
  type ClassAttendanceSession,
  deleteClassAttendance,
  getDaftarSesiPresensi,
  getDetailSesiPresensi,
  getRekonsiliasiPresensi,
  getRosterUntukPresensi,
  type StudentAttendanceDetailItem,
  saveClassAttendance,
} from "@/lib/gateways/class-attendance";
import { syncNow } from "@/lib/gateways/sync-status";
import { getDaftarGuru } from "@/lib/gateways/teacher";
import { useConfirmDialog } from "@/lib/hooks/useConfirmDialog";
import { normalizeOperatorPhone } from "@/lib/operators/contact";
import {
  buildParentNotificationText,
  buildPresentWithoutGateScanWarning,
  hasUnsavedAttendanceMarks,
} from "@/lib/validations/class-attendance";

type TabKey = "input" | "reconciliation" | "history";

export default function PresensiKelasPage() {
  const { user, isAuthenticated, isLoading: authLoading } = useAuth();
  const canManage = hasPermission(user, "class_attendance.manage");
  const canDelete = hasPermission(user, "class_attendance.delete");

  const [activeTab, setActiveTab] = useState<TabKey>("input");
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState<{
    tone: "success" | "error" | "warning";
    message: string;
  } | null>(null);

  // Master options
  const [tahunAjaranList, setTahunAjaranList] = useState<
    Record<string, unknown>[]
  >([]);
  const [rombelList, setRombelList] = useState<Record<string, unknown>[]>([]);
  const [mapelList, setMapelList] = useState<Record<string, unknown>[]>([]);
  const [guruList, setGuruList] = useState<Record<string, unknown>[]>([]);

  // Input Form States
  const [selectedTa, setSelectedTa] = useState<string>("");
  const [selectedRombel, setSelectedRombel] = useState<string>("");
  const [selectedMapel, setSelectedMapel] = useState<string>("");
  const [selectedGuru, setSelectedGuru] = useState<string>("");
  const [selectedDate, setSelectedDate] = useState<string>(
    formatTanggalOperasional(new Date()),
  );
  const [selectedJamKe, setSelectedJamKe] = useState<string>("1-2");
  const [materiPokok, setMateriPokok] = useState<string>("");
  const [catatanSesi, setCatatanSesi] = useState<string>("");
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);

  // Roster items for active input session
  const [rosterItems, setRosterItems] = useState<StudentAttendanceDetailItem[]>(
    [],
  );
  const [savingAttendance, setSavingAttendance] = useState(false);
  // Penjaga balapan wajib (AGENTS.md aturan 5). `savingAttendance` adalah
  // state React yang baru berlaku setelah render berikutnya, sehingga ketukan
  // ganda — sangat mudah terjadi di layar sentuh — bisa memicu dua penyimpanan
  // sebelum tombolnya sempat nonaktif. Pada jalur Web kedua permintaan itu bisa
  // sama-sama lolos pemeriksaan duplikat dan membuat DUA sesi.
  const isSubmittingRef = useRef(false);
  const { konfirmasi, dialogKonfirmasi } = useConfirmDialog();

  // Pilihan filter dibaca `loadMasterData` lewat REF, bukan lewat dependency.
  // Menjadikannya dependency membuat callback-nya lahir ulang setiap kali
  // dropdown diubah, dan efek pemuatan di bawah ikut menarik ULANG keempat
  // daftar master hanya untuk mengganti satu filter — empat perjalanan bolak-
  // balik yang datanya tidak berubah sama sekali. Pada pemuatan pertama pun
  // callback ini menulis ketiga state itu, sehingga efeknya berjalan berkali-
  // kali sebelum akhirnya tenang.
  const selectedRombelRef = useRef(selectedRombel);
  const selectedMapelRef = useRef(selectedMapel);
  const selectedGuruRef = useRef(selectedGuru);
  useEffect(() => {
    selectedRombelRef.current = selectedRombel;
    selectedMapelRef.current = selectedMapel;
    selectedGuruRef.current = selectedGuru;
  });

  // Reconciliation states
  const [reconDate, setReconDate] = useState<string>(
    formatTanggalOperasional(new Date()),
  );
  const [reconRombel, setReconRombel] = useState<string>("");
  const [anomalies, setAnomalies] = useState<AttendanceAnomalyItem[]>([]);
  const [loadingRecon, setLoadingRecon] = useState(false);

  // History states
  const [historyList, setHistoryList] = useState<ClassAttendanceSession[]>([]);
  const [historyFilterDate, setHistoryFilterDate] = useState<string>("");
  const [historyFilterRombel, setHistoryFilterRombel] = useState<string>("");
  const [loadingHistory, setLoadingHistory] = useState(false);

  // Modal delete state
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Load master dropdown options
  const loadMasterData = useCallback(async () => {
    try {
      const [taData, rombelData, mapelData, guruData] = await Promise.all([
        getDaftarTahunAjaran(),
        getDaftarRombel(),
        getDaftarMapel(),
        getDaftarGuru(),
      ]);

      setTahunAjaranList(taData);
      setRombelList(rombelData);
      setMapelList(mapelData);
      setGuruList(guruData);

      // Default active tahun ajaran
      const activeTa = taData.find(
        (ta) => ta.is_aktif === 1 || ta.is_aktif === "1",
      );
      if (activeTa) {
        setSelectedTa(String(activeTa.id_tahun_ajaran));
      } else if (taData.length > 0) {
        setSelectedTa(String(taData[0]?.id_tahun_ajaran));
      }

      if (rombelData.length > 0 && !selectedRombelRef.current) {
        setSelectedRombel(String(rombelData[0]?.id_rombel));
      }
      if (mapelData.length > 0 && !selectedMapelRef.current) {
        setSelectedMapel(String(mapelData[0]?.id_mapel));
      }

      // Default guru to current user if matches
      if (user?.id) {
        const matchingGuru = guruData.find(
          (g) => g.id_guru === user.id || g.id_guru === user.kode_operator,
        );
        if (matchingGuru) {
          setSelectedGuru(String(matchingGuru.id_guru));
        } else if (guruData.length > 0 && !selectedGuruRef.current) {
          setSelectedGuru(String(guruData[0]?.id_guru));
        }
      } else if (guruData.length > 0 && !selectedGuruRef.current) {
        setSelectedGuru(String(guruData[0]?.id_guru));
      }
    } catch {
      setFeedback({
        tone: "error",
        message: "Gagal memuat data master akademik.",
      });
    }
  }, [user]);

  useEffect(() => {
    if (!isAuthenticated) return;
    void loadMasterData();
  }, [isAuthenticated, loadMasterData]);

  // Load roster students for input session
  const handleLoadRoster = useCallback(async () => {
    if (!selectedRombel || !selectedDate) {
      setFeedback({
        tone: "warning",
        message: "Pilih rombel dan tanggal terlebih dahulu.",
      });
      return;
    }

    // Memuat ulang mengembalikan SELURUH siswa ke status bawaan dan menghapus
    // sesi yang sedang disunting. Hanya ditanyakan bila memang ada yang hilang.
    if (
      hasUnsavedAttendanceMarks(rosterItems) &&
      !(await konfirmasi({
        title: "Muat ulang roster?",
        description:
          "Tanda kehadiran yang belum disimpan akan hilang dan seluruh siswa kembali ke status bawaan.",
        preserved: "Presensi yang sudah tersimpan sebelumnya tidak berubah.",
        confirmLabel: "Ya, muat ulang",
        tone: "warning",
      }))
    ) {
      return;
    }

    setLoading(true);
    setFeedback(null);
    try {
      const roster = await getRosterUntukPresensi(selectedRombel, selectedDate);
      setRosterItems(roster);
      setEditingSessionId(null);
      if (roster.length === 0) {
        setFeedback({
          tone: "warning",
          message: "Belum ada siswa aktif terdaftar di rombel ini.",
        });
      }
    } catch (err: unknown) {
      setFeedback({
        tone: "error",
        message:
          err instanceof Error ? err.message : "Gagal memuat roster siswa.",
      });
    } finally {
      setLoading(false);
    }
  }, [selectedRombel, selectedDate, rosterItems, konfirmasi]);

  // Load reconciliation anomalies
  const handleLoadReconciliation = useCallback(async () => {
    setLoadingRecon(true);
    setFeedback(null);
    try {
      const res = await getRekonsiliasiPresensi({
        tanggal: reconDate || undefined,
        id_rombel: reconRombel || undefined,
      });
      setAnomalies(res.anomalies);
    } catch (err: unknown) {
      setFeedback({
        tone: "error",
        message:
          err instanceof Error
            ? err.message
            : "Gagal memuat rekonsiliasi presensi.",
      });
    } finally {
      setLoadingRecon(false);
    }
  }, [reconDate, reconRombel]);

  // Load session history
  const handleLoadHistory = useCallback(async () => {
    setLoadingHistory(true);
    setFeedback(null);
    try {
      const sessions = await getDaftarSesiPresensi({
        tanggal: historyFilterDate || undefined,
        id_rombel: historyFilterRombel || undefined,
        limit: 100,
      });
      setHistoryList(sessions);
    } catch (err: unknown) {
      setFeedback({
        tone: "error",
        message:
          err instanceof Error ? err.message : "Gagal memuat riwayat presensi.",
      });
    } finally {
      setLoadingHistory(false);
    }
  }, [historyFilterDate, historyFilterRombel]);

  // Trigger loads on tab switch
  useEffect(() => {
    if (activeTab === "reconciliation") {
      void handleLoadReconciliation();
    } else if (activeTab === "history") {
      void handleLoadHistory();
    }
  }, [activeTab, handleLoadReconciliation, handleLoadHistory]);

  // Sync listener to refresh data in background
  useEffect(() => {
    const handleSync = () => {
      if (activeTab === "reconciliation") void handleLoadReconciliation();
      else if (activeTab === "history") void handleLoadHistory();
    };
    window.addEventListener("sppg:sync-completed", handleSync);
    return () => window.removeEventListener("sppg:sync-completed", handleSync);
  }, [activeTab, handleLoadReconciliation, handleLoadHistory]);

  // Summary counts for current roster
  const metrics = useMemo(() => {
    let hadir = 0;
    let izin = 0;
    let sakit = 0;
    let alfa = 0;
    let dispensasi = 0;

    for (const item of rosterItems) {
      if (item.status === "Hadir") hadir++;
      else if (item.status === "Izin") izin++;
      else if (item.status === "Sakit") sakit++;
      else if (item.status === "Alfa") alfa++;
      else if (item.status === "Dispensasi") dispensasi++;
    }

    return {
      total: rosterItems.length,
      hadir,
      izin,
      sakit,
      alfa,
      dispensasi,
    };
  }, [rosterItems]);

  // Update single student status in roster
  const updateStudentStatus = (
    idSiswa: string,
    status: "Hadir" | "Izin" | "Sakit" | "Alfa" | "Dispensasi",
  ) => {
    setRosterItems((prev) =>
      prev.map((item) =>
        item.id_siswa === idSiswa ? { ...item, status } : item,
      ),
    );
  };

  // Update single student notes in roster
  const updateStudentCatatan = (idSiswa: string, catatan: string) => {
    setRosterItems((prev) =>
      prev.map((item) =>
        item.id_siswa === idSiswa ? { ...item, catatan } : item,
      ),
    );
  };

  // Mark all students present
  const handleMarkAllHadir = () => {
    setRosterItems((prev) =>
      prev.map((item) => ({ ...item, status: "Hadir" })),
    );
  };

  // Save class attendance session
  const handleSaveAttendance = async () => {
    if (
      !selectedTa ||
      !selectedRombel ||
      !selectedMapel ||
      !selectedGuru ||
      !selectedDate ||
      !selectedJamKe
    ) {
      setFeedback({
        tone: "warning",
        message: "Lengkapi seluruh informasi header sesi KBM.",
      });
      return;
    }

    if (rosterItems.length === 0) {
      setFeedback({
        tone: "warning",
        message:
          "Roster siswa belum dimuat. Tekan 'Muat Roster' terlebih dahulu.",
      });
      return;
    }

    // Seluruh roster berstatus Hadir secara bawaan, jadi menyimpan tanpa
    // memeriksa akan menandai hadir siswa yang benar-benar tidak masuk.
    // Peringatan ini tidak pernah mengubah status siapa pun — gurunya yang
    // memutuskan.
    const peringatan = buildPresentWithoutGateScanWarning(rosterItems);
    if (
      peringatan &&
      !(await konfirmasi({
        title: "Simpan presensi ini?",
        description: peringatan,
        preserved:
          "Peringatan ini tidak mengubah status siapa pun — keputusannya tetap di tangan guru.",
        confirmLabel: "Ya, simpan",
        tone: "warning",
      }))
    ) {
      return;
    }

    if (isSubmittingRef.current) return;
    isSubmittingRef.current = true;
    setSavingAttendance(true);
    setFeedback(null);

    try {
      const draft = {
        id_presensi_mapel: editingSessionId || undefined,
        id_tahun_ajaran: selectedTa,
        id_rombel: selectedRombel,
        id_mapel: selectedMapel,
        id_guru: selectedGuru,
        tanggal: selectedDate,
        jam_ke: selectedJamKe,
        materi_pokok: materiPokok || null,
        catatan: catatanSesi || null,
        items: rosterItems.map((item) => ({
          id_siswa: item.id_siswa,
          status: item.status,
          catatan: item.catatan || null,
        })),
      };

      await saveClassAttendance(draft);
      setFeedback({
        tone: "success",
        message: "Presensi kelas KBM berhasil disimpan dan disinkronkan.",
      });
      setEditingSessionId(null);
    } catch (err: unknown) {
      setFeedback({
        tone: "error",
        message:
          err instanceof Error
            ? err.message
            : "Gagal menyimpan presensi kelas.",
      });
    } finally {
      isSubmittingRef.current = false;
      setSavingAttendance(false);
    }
  };

  // Edit existing session from history
  const handleEditSession = async (session: ClassAttendanceSession) => {
    setLoading(true);
    setFeedback(null);
    try {
      const data = await getDetailSesiPresensi(session.id_presensi_mapel);
      setSelectedTa(data.session.id_tahun_ajaran);
      setSelectedRombel(data.session.id_rombel);
      setSelectedMapel(data.session.id_mapel);
      setSelectedGuru(data.session.id_guru);
      setSelectedDate(data.session.tanggal);
      setSelectedJamKe(data.session.jam_ke);
      setMateriPokok(data.session.materi_pokok || "");
      setCatatanSesi(data.session.catatan || "");
      setEditingSessionId(data.session.id_presensi_mapel);
      setRosterItems(data.details);
      setActiveTab("input");
      setFeedback({
        tone: "success",
        message: `Memuat sesi presensi ${data.session.nama_rombel} - ${data.session.nama_mapel} untuk disunting.`,
      });
    } catch (err: unknown) {
      setFeedback({
        tone: "error",
        message:
          err instanceof Error
            ? err.message
            : "Gagal memuat detail sesi presensi.",
      });
    } finally {
      setLoading(false);
    }
  };

  // Confirm delete session
  const handleDeleteSession = async () => {
    if (!canDelete || !deleteTargetId || isSubmittingRef.current) return;
    isSubmittingRef.current = true;
    setDeleting(true);
    try {
      await deleteClassAttendance(deleteTargetId);
      setDeleteTargetId(null);
      setFeedback({
        tone: "success",
        message: "Sesi presensi berhasil dihapus.",
      });
      void handleLoadHistory();
    } catch (err: unknown) {
      setFeedback({
        tone: "error",
        message:
          err instanceof Error ? err.message : "Gagal menghapus sesi presensi.",
      });
    } finally {
      isSubmittingRef.current = false;
      setDeleting(false);
    }
  };

  // Compose WhatsApp direct message link for parent notification
  const getWhatsAppLink = (item: AttendanceAnomalyItem) => {
    if (!item.no_whatsapp_wali) return null;
    const normalized = normalizeOperatorPhone(item.no_whatsapp_wali);
    if (!normalized) return null;

    const cleanNumber = normalized.replace("+", "");
    // Teks dibedakan per jenis anomali di satu tempat bersama; dua anomali
    // rekonsiliasi artinya berlawanan dan tidak boleh memakai kalimat sama.
    const text = encodeURIComponent(buildParentNotificationText(item));

    return `https://wa.me/${cleanNumber}?text=${text}`;
  };

  if (!isAuthenticated && !authLoading) redirect("/login");
  if (user && !canAccessArea(user, "presensi_kelas")) redirect("/forbidden");

  return (
    <AppShell>
      <div className="space-y-6 pb-12">
        <PageHeader
          eyebrow="Akademik & Presensi"
          title="Presensi Kelas KBM &amp; Deteksi Bolos"
          description="Pencatatan kehadiran siswa per mata pelajaran dengan rekonsiliasi otomatis deteksi bolos di sekolah."
          actions={
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={async () => {
                  setFeedback(null);
                  await syncNow().catch(() => undefined);
                  if (activeTab === "reconciliation")
                    void handleLoadReconciliation();
                  else if (activeTab === "history") void handleLoadHistory();
                  else void handleLoadRoster();
                }}
                className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-slate-800/80 px-3.5 py-2 text-xs font-semibold text-slate-200 transition hover:bg-slate-700"
              >
                <Icon name="refresh" className="size-3.5" />
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

        {/* Tab Navigation */}
        <div className="flex border-b border-white/10 gap-2">
          <button
            type="button"
            onClick={() => setActiveTab("input")}
            className={`flex items-center gap-2 border-b-2 px-4 py-3 text-xs font-bold transition ${
              activeTab === "input"
                ? "border-sky-500 text-sky-400"
                : "border-transparent text-slate-400 hover:text-slate-200"
            }`}
          >
            <Icon name="document" className="size-4" />
            <span>Input Presensi KBM</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("reconciliation")}
            className={`flex items-center gap-2 border-b-2 px-4 py-3 text-xs font-bold transition ${
              activeTab === "reconciliation"
                ? "border-rose-500 text-rose-400"
                : "border-transparent text-slate-400 hover:text-slate-200"
            }`}
          >
            <Icon name="alert" className="size-4" />
            <span>Rekonsiliasi &amp; Deteksi Bolos</span>
            {anomalies.length > 0 ? (
              <span className="rounded-full bg-rose-500/20 px-2 py-0.5 text-[10px] font-black text-rose-300">
                {anomalies.length}
              </span>
            ) : null}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("history")}
            className={`flex items-center gap-2 border-b-2 px-4 py-3 text-xs font-bold transition ${
              activeTab === "history"
                ? "border-emerald-500 text-emerald-400"
                : "border-transparent text-slate-400 hover:text-slate-200"
            }`}
          >
            <Icon name="history" className="size-4" />
            <span>Riwayat Sesi</span>
          </button>
        </div>

        {/* TAB 1: INPUT PRESENSI KBM */}
        {activeTab === "input" ? (
          <div className="space-y-6">
            {/* Header Configuration Panel */}
            <div className="rounded-2xl border border-white/10 bg-slate-900/60 p-5 backdrop-blur-xl space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-2">
                  <span className="size-2 rounded-full bg-sky-400"></span>
                  <span>Header Sesi Pembelajaran</span>
                  {editingSessionId ? (
                    <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-[10px] font-bold text-amber-300">
                      Mode Sunting ({editingSessionId})
                    </span>
                  ) : null}
                </h3>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {/* Tahun Ajaran */}
                <div>
                  <label
                    htmlFor="input-ta"
                    className="block text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-1.5"
                  >
                    Tahun Ajaran
                  </label>
                  <select
                    id="input-ta"
                    value={selectedTa}
                    onChange={(e) => setSelectedTa(e.target.value)}
                    className="w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-xs font-semibold text-white outline-none focus:border-sky-500"
                  >
                    {tahunAjaranList.map((ta) => (
                      <option
                        key={String(ta.id_tahun_ajaran)}
                        value={String(ta.id_tahun_ajaran)}
                        className="bg-slate-900 text-white"
                      >
                        {String(ta.nama_tahun)} - {String(ta.semester)}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Rombel */}
                <div>
                  <label
                    htmlFor="input-rombel"
                    className="block text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-1.5"
                  >
                    Rombel / Kelas
                  </label>
                  <select
                    id="input-rombel"
                    value={selectedRombel}
                    onChange={(e) => setSelectedRombel(e.target.value)}
                    className="w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-xs font-semibold text-white outline-none focus:border-sky-500"
                  >
                    {rombelList.map((r) => (
                      <option
                        key={String(r.id_rombel)}
                        value={String(r.id_rombel)}
                        className="bg-slate-900 text-white"
                      >
                        {String(r.nama_rombel)} (Tingkat {String(r.tingkat)})
                      </option>
                    ))}
                  </select>
                </div>

                {/* Mata Pelajaran */}
                <div>
                  <label
                    htmlFor="input-mapel"
                    className="block text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-1.5"
                  >
                    Mata Pelajaran
                  </label>
                  <select
                    id="input-mapel"
                    value={selectedMapel}
                    onChange={(e) => setSelectedMapel(e.target.value)}
                    className="w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-xs font-semibold text-white outline-none focus:border-sky-500"
                  >
                    {mapelList.map((m) => (
                      <option
                        key={String(m.id_mapel)}
                        value={String(m.id_mapel)}
                        className="bg-slate-900 text-white"
                      >
                        {String(m.kode_mapel)} - {String(m.nama_mapel)}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Guru Pengajar */}
                <div>
                  <label
                    htmlFor="input-guru"
                    className="block text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-1.5"
                  >
                    Guru Pengajar
                  </label>
                  <select
                    id="input-guru"
                    value={selectedGuru}
                    onChange={(e) => setSelectedGuru(e.target.value)}
                    className="w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-xs font-semibold text-white outline-none focus:border-sky-500"
                  >
                    {guruList.map((g) => (
                      <option
                        key={String(g.id_guru)}
                        value={String(g.id_guru)}
                        className="bg-slate-900 text-white"
                      >
                        {String(g.nama || g.nama_lengkap || g.id_guru)}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Tanggal */}
                <div>
                  <label
                    htmlFor="input-kbm-date"
                    className="block text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-1.5"
                  >
                    Tanggal KBM
                  </label>
                  <input
                    id="input-kbm-date"
                    type="date"
                    value={selectedDate}
                    onChange={(e) => setSelectedDate(e.target.value)}
                    className="w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-xs font-semibold text-white outline-none focus:border-sky-500"
                  />
                </div>

                {/* Jam Ke */}
                <div>
                  <label
                    htmlFor="input-jam-ke"
                    className="block text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-1.5"
                  >
                    Jam Pelajaran Ke
                  </label>
                  <select
                    id="input-jam-ke"
                    value={selectedJamKe}
                    onChange={(e) => setSelectedJamKe(e.target.value)}
                    className="w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-xs font-semibold text-white outline-none focus:border-sky-500"
                  >
                    <option value="1">Jam ke-1</option>
                    <option value="2">Jam ke-2</option>
                    <option value="3">Jam ke-3</option>
                    <option value="4">Jam ke-4</option>
                    <option value="5">Jam ke-5</option>
                    <option value="6">Jam ke-6</option>
                    <option value="7">Jam ke-7</option>
                    <option value="8">Jam ke-8</option>
                    <option value="1-2">Jam ke 1 - 2</option>
                    <option value="3-4">Jam ke 3 - 4</option>
                    <option value="5-6">Jam ke 5 - 6</option>
                    <option value="7-8">Jam ke 7 - 8</option>
                  </select>
                </div>

                {/* Materi Pokok */}
                <div className="lg:col-span-2">
                  <label
                    htmlFor="input-materi-pokok"
                    className="block text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-1.5"
                  >
                    Materi Pokok / Bahasan
                  </label>
                  <input
                    id="input-materi-pokok"
                    type="text"
                    value={materiPokok}
                    onChange={(e) => setMateriPokok(e.target.value)}
                    placeholder="Contoh: Bab 2 - Reaksi Redoks dan Elektrokimia"
                    className="w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-xs text-white placeholder-slate-500 outline-none focus:border-sky-500"
                  />
                </div>
              </div>

              <div className="flex items-center justify-between pt-2 border-t border-white/5">
                <div className="flex-1 max-w-lg">
                  <input
                    aria-label="Catatan umum sesi KBM"
                    type="text"
                    value={catatanSesi}
                    onChange={(e) => setCatatanSesi(e.target.value)}
                    placeholder="Catatan umum sesi KBM (opsional)..."
                    className="w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-1.5 text-xs text-white placeholder-slate-500 outline-none focus:border-sky-500"
                  />
                </div>

                <div className="flex items-center gap-2">
                  {editingSessionId ? (
                    <button
                      type="button"
                      onClick={() => {
                        setEditingSessionId(null);
                        setRosterItems([]);
                      }}
                      className="rounded-xl border border-white/10 bg-slate-800 px-3 py-2 text-xs font-bold text-slate-300 hover:bg-slate-700"
                    >
                      Batal Sunting
                    </button>
                  ) : null}

                  <button
                    type="button"
                    onClick={handleLoadRoster}
                    disabled={loading}
                    className="inline-flex items-center gap-2 rounded-xl bg-sky-500 px-4 py-2 text-xs font-bold text-slate-950 transition hover:bg-sky-400 disabled:opacity-50"
                  >
                    <Icon name="users" className="size-3.5" />
                    <span>{loading ? "Memuat..." : "Muat Roster Siswa"}</span>
                  </button>
                </div>
              </div>
            </div>

            {/* Roster & Quick Presensi Panel */}
            {rosterItems.length > 0 ? (
              <div className="space-y-4">
                {/* Metric Summary Bar */}
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-slate-900/80 p-4 backdrop-blur-xl">
                  <div className="flex flex-wrap items-center gap-4 text-xs font-semibold">
                    <span className="text-slate-400 font-mono">
                      Total:{" "}
                      <strong className="text-white">{metrics.total}</strong>
                    </span>
                    <span className="flex items-center gap-1.5 text-emerald-400 font-mono">
                      <span className="size-2 rounded-full bg-emerald-400"></span>
                      Hadir: <strong>{metrics.hadir}</strong>
                    </span>
                    <span className="flex items-center gap-1.5 text-sky-400 font-mono">
                      <span className="size-2 rounded-full bg-sky-400"></span>
                      Izin: <strong>{metrics.izin}</strong>
                    </span>
                    <span className="flex items-center gap-1.5 text-amber-400 font-mono">
                      <span className="size-2 rounded-full bg-amber-400"></span>
                      Sakit: <strong>{metrics.sakit}</strong>
                    </span>
                    <span className="flex items-center gap-1.5 text-rose-400 font-mono">
                      <span className="size-2 rounded-full bg-rose-400"></span>
                      Alfa: <strong>{metrics.alfa}</strong>
                    </span>
                    <span className="flex items-center gap-1.5 text-purple-400 font-mono">
                      <span className="size-2 rounded-full bg-purple-400"></span>
                      Dispensasi: <strong>{metrics.dispensasi}</strong>
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleMarkAllHadir}
                      className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs font-bold text-emerald-300 transition hover:bg-emerald-500/20"
                    >
                      Tandai Semua Hadir
                    </button>
                    {canManage ? (
                      <button
                        type="button"
                        onClick={handleSaveAttendance}
                        disabled={savingAttendance}
                        className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 px-4 py-1.5 text-xs font-black text-slate-950 shadow-md shadow-emerald-950 transition hover:from-emerald-400 hover:to-teal-400 disabled:opacity-50"
                      >
                        <Icon name="check" className="size-3.5" />
                        <span>
                          {savingAttendance
                            ? "Menyimpan..."
                            : "Simpan Presensi"}
                        </span>
                      </button>
                    ) : null}
                  </div>
                </div>

                {/* Students Table */}
                <div className="overflow-x-auto rounded-2xl border border-white/10 bg-slate-900/60 shadow-xl">
                  <table className="w-full text-left text-xs text-slate-300">
                    <thead className="border-b border-white/10 bg-slate-950/80 font-mono text-[11px] uppercase tracking-wider text-slate-400">
                      <tr>
                        <th className="px-4 py-3">No</th>
                        <th className="px-4 py-3">NIS</th>
                        <th className="px-4 py-3">Nama Siswa</th>
                        <th className="px-4 py-3">L/P</th>
                        <th className="px-4 py-3">Scan Gerbang</th>
                        <th className="px-4 py-3 text-center">
                          Status Kehadiran
                        </th>
                        <th className="px-4 py-3">Catatan Siswa</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5 font-sans">
                      {rosterItems.map((item, idx) => (
                        <tr
                          key={item.id_siswa}
                          className="transition hover:bg-white/[0.02]"
                        >
                          <td className="px-4 py-2.5 font-mono text-slate-500">
                            {idx + 1}
                          </td>
                          <td className="px-4 py-2.5 font-mono text-slate-400">
                            {item.nis || "-"}
                          </td>
                          <td className="px-4 py-2.5">
                            <span className="font-bold text-white block">
                              {item.nama_lengkap}
                            </span>
                            {item.nama_wali ? (
                              <span className="text-[10px] text-slate-500 font-mono">
                                Wali: {item.nama_wali}
                              </span>
                            ) : null}
                          </td>
                          <td className="px-4 py-2.5 font-mono text-slate-400">
                            {item.jenis_kelamin || "-"}
                          </td>
                          <td className="px-4 py-2.5 font-mono">
                            {item.jam_masuk ? (
                              <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-emerald-300">
                                <span>{item.jam_masuk}</span>
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 rounded-full border border-slate-700 bg-slate-800/80 px-2 py-0.5 text-[10px] font-medium text-slate-400">
                                Belum Scan
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-2.5 text-center">
                            <div className="inline-flex rounded-xl border border-white/10 bg-slate-950 p-0.5">
                              {(
                                [
                                  { key: "Hadir", label: "H", tone: "emerald" },
                                  { key: "Izin", label: "I", tone: "sky" },
                                  { key: "Sakit", label: "S", tone: "amber" },
                                  { key: "Alfa", label: "A", tone: "rose" },
                                  {
                                    key: "Dispensasi",
                                    label: "D",
                                    tone: "purple",
                                  },
                                ] as const
                              ).map((opt) => {
                                const isActive = item.status === opt.key;
                                return (
                                  <button
                                    key={opt.key}
                                    type="button"
                                    onClick={() =>
                                      updateStudentStatus(
                                        item.id_siswa,
                                        opt.key,
                                      )
                                    }
                                    className={`size-7 rounded-lg text-xs font-black transition ${
                                      isActive
                                        ? opt.tone === "emerald"
                                          ? "bg-emerald-500 text-slate-950 shadow"
                                          : opt.tone === "sky"
                                            ? "bg-sky-500 text-slate-950 shadow"
                                            : opt.tone === "amber"
                                              ? "bg-amber-500 text-slate-950 shadow"
                                              : opt.tone === "rose"
                                                ? "bg-rose-500 text-white shadow"
                                                : "bg-purple-500 text-white shadow"
                                        : "text-slate-400 hover:text-white"
                                    }`}
                                  >
                                    {opt.label}
                                  </button>
                                );
                              })}
                            </div>
                          </td>
                          <td className="px-4 py-2.5">
                            <input
                              aria-label="Keterangan kehadiran siswa"
                              type="text"
                              value={item.catatan || ""}
                              onChange={(e) =>
                                updateStudentCatatan(
                                  item.id_siswa,
                                  e.target.value,
                                )
                              }
                              placeholder="Keterangan..."
                              className="w-full rounded-lg border border-white/5 bg-slate-950 px-2.5 py-1 text-[11px] text-white placeholder-slate-600 outline-none focus:border-sky-500"
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Bottom Save Bar */}
                {canManage ? (
                  <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-slate-900/80 p-4">
                    <p className="text-xs text-slate-400">
                      Pastikan seluruh kehadiran siswa terisi dengan akurat
                      sebelum menyimpan.
                    </p>
                    <button
                      type="button"
                      onClick={handleSaveAttendance}
                      disabled={savingAttendance}
                      className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 px-6 py-2.5 text-xs font-black text-slate-950 shadow-lg shadow-emerald-950 transition hover:from-emerald-400 hover:to-teal-400 disabled:opacity-50"
                    >
                      <Icon name="check" className="size-4" />
                      <span>
                        {savingAttendance
                          ? "Menyimpan..."
                          : "Simpan Sesi Presensi"}
                      </span>
                    </button>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}

        {/* TAB 2: REKONSILIASI & DETEKSI BOLOS */}
        {activeTab === "reconciliation" ? (
          <div className="space-y-6">
            {/* Filter Bar */}
            <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-white/10 bg-slate-900/60 p-5 backdrop-blur-xl">
              <div className="flex flex-wrap items-center gap-4">
                <div>
                  <label
                    htmlFor="recon-date"
                    className="block text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-1"
                  >
                    Tanggal Pengecekan
                  </label>
                  <input
                    id="recon-date"
                    type="date"
                    value={reconDate}
                    onChange={(e) => setReconDate(e.target.value)}
                    className="rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-xs font-semibold text-white outline-none focus:border-sky-500"
                  />
                </div>

                <div>
                  <label
                    htmlFor="recon-rombel"
                    className="block text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-1"
                  >
                    Filter Rombel (Opsional)
                  </label>
                  <select
                    id="recon-rombel"
                    value={reconRombel}
                    onChange={(e) => setReconRombel(e.target.value)}
                    className="rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-xs font-semibold text-white outline-none focus:border-sky-500"
                  >
                    <option value="">Semua Rombel</option>
                    {rombelList.map((r) => (
                      <option
                        key={String(r.id_rombel)}
                        value={String(r.id_rombel)}
                        className="bg-slate-900 text-white"
                      >
                        {String(r.nama_rombel)}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="pt-4">
                  <button
                    type="button"
                    onClick={handleLoadReconciliation}
                    disabled={loadingRecon}
                    className="inline-flex items-center gap-2 rounded-xl bg-rose-500 px-4 py-2 text-xs font-bold text-white transition hover:bg-rose-400 disabled:opacity-50"
                  >
                    <Icon name="alert" className="size-3.5" />
                    <span>
                      {loadingRecon
                        ? "Menganalisis..."
                        : "Periksa Rekonsiliasi"}
                    </span>
                  </button>
                </div>
              </div>

              {/* Anomaly Counter Badges */}
              <div className="flex items-center gap-3">
                <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3.5 py-2 text-center">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-rose-300 block">
                    Siswa Bolos di Sekolah
                  </span>
                  <span className="text-lg font-black text-rose-200">
                    {
                      anomalies.filter(
                        (a) => a.anomaly_type === "BOLOS_DI_SEKOLAH",
                      ).length
                    }
                  </span>
                </div>
                <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3.5 py-2 text-center">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-amber-300 block">
                    Tanpa Scan Gerbang
                  </span>
                  <span className="text-lg font-black text-amber-200">
                    {
                      anomalies.filter(
                        (a) => a.anomaly_type === "HADIR_TANPA_SCAN_GERBANG",
                      ).length
                    }
                  </span>
                </div>
              </div>
            </div>

            {/* Anomaly Table */}
            {anomalies.length === 0 ? (
              <div className="rounded-2xl border border-white/10 bg-slate-900/40 p-12 text-center text-slate-400">
                <Icon
                  name="check"
                  className="size-10 mx-auto text-emerald-400 mb-2"
                />
                <h4 className="text-sm font-bold text-white">
                  Tidak Ditemukan Anomali Presensi
                </h4>
                <p className="text-xs text-slate-500 mt-1">
                  Seluruh data presensi gerbang dan jam mapel pada tanggal ini
                  sinkron dan tertib.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto rounded-2xl border border-white/10 bg-slate-900/60 shadow-xl">
                <table className="w-full text-left text-xs text-slate-300">
                  <thead className="border-b border-white/10 bg-slate-950/80 font-mono text-[11px] uppercase tracking-wider text-slate-400">
                    <tr>
                      <th className="px-4 py-3">Tipe Anomali</th>
                      <th className="px-4 py-3">Siswa</th>
                      <th className="px-4 py-3">Rombel</th>
                      <th className="px-4 py-3">Gerbang Masuk</th>
                      <th className="px-4 py-3">Sesi Mapel</th>
                      <th className="px-4 py-3">Kontak Wali</th>
                      <th className="px-4 py-3 text-right">Tindakan Cepat</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5 font-sans">
                    {anomalies.map((item, idx) => {
                      const waLink = getWhatsAppLink(item);
                      return (
                        <tr
                          key={`${item.id_presensi_mapel}-${item.id_siswa}-${idx}`}
                          className="transition hover:bg-white/[0.02]"
                        >
                          <td className="px-4 py-3">
                            {item.anomaly_type === "BOLOS_DI_SEKOLAH" ? (
                              <span className="inline-flex items-center gap-1.5 rounded-full border border-rose-500/40 bg-rose-500/10 px-2.5 py-1 text-[10px] font-black uppercase text-rose-300">
                                <span className="size-1.5 rounded-full bg-rose-400"></span>
                                Siswa Bolos
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/40 bg-amber-500/10 px-2.5 py-1 text-[10px] font-black uppercase text-amber-300">
                                <span className="size-1.5 rounded-full bg-amber-400"></span>
                                Tanpa Scan Gerbang
                              </span>
                            )}
                            <p className="mt-1 text-[10px] text-slate-500 leading-tight">
                              {item.anomaly_label}
                            </p>
                          </td>
                          <td className="px-4 py-3">
                            <span className="font-bold text-white block">
                              {item.nama_siswa}
                            </span>
                            <span className="font-mono text-[10px] text-slate-400">
                              NIS: {item.nis}
                            </span>
                          </td>
                          <td className="px-4 py-3 font-semibold text-slate-300">
                            {item.nama_rombel}
                          </td>
                          <td className="px-4 py-3 font-mono">
                            {item.jam_masuk_gerbang ? (
                              <span className="text-emerald-400 font-bold">
                                {item.jam_masuk_gerbang} WIB
                              </span>
                            ) : (
                              <span className="text-slate-500 italic">
                                Tidak scan
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <span className="font-bold text-white block">
                              {item.nama_mapel} (Jam {item.jam_ke})
                            </span>
                            <span className="text-[11px] text-slate-400">
                              Guru: {item.nama_guru} · Status:{" "}
                              <strong
                                className={
                                  item.status_mapel === "Alfa"
                                    ? "text-rose-400"
                                    : "text-emerald-400"
                                }
                              >
                                {item.status_mapel}
                              </strong>
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <span className="text-slate-300 block font-medium">
                              {item.nama_wali || "Orang Tua / Wali"}
                            </span>
                            <span className="font-mono text-[11px] text-sky-400">
                              {item.no_whatsapp_wali || "-"}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right">
                            {waLink ? (
                              <a
                                href={waLink}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-500/40 bg-emerald-500/20 px-3 py-1.5 text-xs font-bold text-emerald-200 transition hover:bg-emerald-500/30 shadow"
                              >
                                <Icon name="whatsapp" className="size-3.5" />
                                <span>Hubungi Wali</span>
                              </a>
                            ) : (
                              <span className="text-[11px] text-slate-500 italic">
                                No WA belum diisi
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ) : null}

        {/* TAB 3: RIWAYAT SESI */}
        {activeTab === "history" ? (
          <div className="space-y-6">
            {/* History Filter Bar */}
            <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-white/10 bg-slate-900/60 p-5 backdrop-blur-xl">
              <div className="flex flex-wrap items-center gap-4">
                <div>
                  <label
                    htmlFor="history-date"
                    className="block text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-1"
                  >
                    Tanggal Sesi
                  </label>
                  <input
                    id="history-date"
                    type="date"
                    value={historyFilterDate}
                    onChange={(e) => setHistoryFilterDate(e.target.value)}
                    className="rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-xs font-semibold text-white outline-none focus:border-sky-500"
                  />
                </div>

                <div>
                  <label
                    htmlFor="history-rombel"
                    className="block text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-1"
                  >
                    Rombel
                  </label>
                  <select
                    id="history-rombel"
                    value={historyFilterRombel}
                    onChange={(e) => setHistoryFilterRombel(e.target.value)}
                    className="rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-xs font-semibold text-white outline-none focus:border-sky-500"
                  >
                    <option value="">Semua Rombel</option>
                    {rombelList.map((r) => (
                      <option
                        key={String(r.id_rombel)}
                        value={String(r.id_rombel)}
                        className="bg-slate-900 text-white"
                      >
                        {String(r.nama_rombel)}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="pt-4">
                  <button
                    type="button"
                    onClick={handleLoadHistory}
                    disabled={loadingHistory}
                    className="inline-flex items-center gap-2 rounded-xl bg-sky-500 px-4 py-2 text-xs font-bold text-slate-950 transition hover:bg-sky-400 disabled:opacity-50"
                  >
                    <Icon name="history" className="size-3.5" />
                    <span>
                      {loadingHistory ? "Memuat..." : "Terapkan Filter"}
                    </span>
                  </button>
                </div>
              </div>

              <span className="font-mono text-xs text-slate-400">
                Total: <strong>{historyList.length}</strong> sesi tersimpan
              </span>
            </div>

            {/* History Table */}
            {historyList.length === 0 ? (
              <div className="rounded-2xl border border-white/10 bg-slate-900/40 p-12 text-center text-slate-400">
                <Icon
                  name="history"
                  className="size-10 mx-auto text-slate-600 mb-2"
                />
                <h4 className="text-sm font-bold text-white">
                  Belum Ada Sesi Presensi KBM
                </h4>
                <p className="text-xs text-slate-500 mt-1">
                  Sesi presensi yang Anda rekam akan tampil di tabel riwayat
                  ini.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto rounded-2xl border border-white/10 bg-slate-900/60 shadow-xl">
                <table className="w-full text-left text-xs text-slate-300">
                  <thead className="border-b border-white/10 bg-slate-950/80 font-mono text-[11px] uppercase tracking-wider text-slate-400">
                    <tr>
                      <th className="px-4 py-3">Tanggal / Jam</th>
                      <th className="px-4 py-3">Rombel</th>
                      <th className="px-4 py-3">Mata Pelajaran</th>
                      <th className="px-4 py-3">Guru Pengajar</th>
                      <th className="px-4 py-3">Materi Pokok</th>
                      <th className="px-4 py-3 text-center">Rekap Kehadiran</th>
                      <th className="px-4 py-3 text-right">Aksi</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5 font-sans">
                    {historyList.map((session) => (
                      <tr
                        key={session.id_presensi_mapel}
                        className="transition hover:bg-white/[0.02]"
                      >
                        <td className="px-4 py-3 font-mono">
                          <span className="text-white font-bold block">
                            {session.tanggal}
                          </span>
                          <span className="text-[10px] text-slate-500">
                            Jam ke-{session.jam_ke}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span className="font-bold text-white block">
                            {session.nama_rombel}
                          </span>
                          <span className="text-[10px] text-slate-500 font-mono">
                            Tingkat {session.tingkat}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span className="font-bold text-white block">
                            {session.nama_mapel}
                          </span>
                          <span className="text-[10px] text-slate-500 font-mono">
                            {session.kode_mapel}
                          </span>
                        </td>
                        <td className="px-4 py-3 font-medium text-slate-300">
                          {session.nama_guru}
                        </td>
                        <td className="px-4 py-3 text-slate-300 max-w-xs truncate">
                          {session.materi_pokok || "-"}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <div className="inline-flex items-center gap-1.5 font-mono text-[11px]">
                            <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 font-bold text-emerald-300">
                              H:{session.total_hadir}
                            </span>
                            <span className="rounded bg-sky-500/20 px-1.5 py-0.5 font-bold text-sky-300">
                              I:{session.total_izin}
                            </span>
                            <span className="rounded bg-amber-500/20 px-1.5 py-0.5 font-bold text-amber-300">
                              S:{session.total_sakit}
                            </span>
                            <span className="rounded bg-rose-500/20 px-1.5 py-0.5 font-bold text-rose-300">
                              A:{session.total_alfa}
                            </span>
                            {session.total_dispensasi > 0 ? (
                              <span className="rounded bg-purple-500/20 px-1.5 py-0.5 font-bold text-purple-300">
                                D:{session.total_dispensasi}
                              </span>
                            ) : null}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="inline-flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => void handleEditSession(session)}
                              className="rounded-lg border border-white/10 bg-slate-800 px-2.5 py-1 text-xs font-bold text-slate-200 transition hover:bg-slate-700"
                            >
                              Sunting
                            </button>
                            {canDelete ? (
                              <button
                                type="button"
                                onClick={() =>
                                  setDeleteTargetId(session.id_presensi_mapel)
                                }
                                className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-2.5 py-1 text-xs font-bold text-rose-300 transition hover:bg-rose-500/20"
                              >
                                Hapus
                              </button>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ) : null}

        {/* Modal Konfirmasi Hapus */}
        {deleteTargetId ? (
          <Modal
            isOpen={true}
            onClose={() => setDeleteTargetId(null)}
            title="Konfirmasi Hapus Sesi Presensi"
          >
            <div className="space-y-4">
              <p className="text-xs text-slate-300 leading-relaxed">
                Apakah Anda yakin ingin menghapus sesi presensi kelas ini
                beserta seluruh catatan kehadiran siswa di dalamnya? Data yang
                dihapus akan disinkronkan ke seluruh perangkat.
              </p>
              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setDeleteTargetId(null)}
                  className="rounded-xl border border-white/10 bg-slate-800 px-4 py-2 text-xs font-bold text-slate-300 hover:bg-slate-700"
                >
                  Batal
                </button>
                <button
                  type="button"
                  onClick={handleDeleteSession}
                  disabled={deleting}
                  className="rounded-xl bg-rose-600 px-4 py-2 text-xs font-bold text-white hover:bg-rose-500 disabled:opacity-50"
                >
                  {deleting ? "Menghapus..." : "Hapus Permanen"}
                </button>
              </div>
            </div>
          </Modal>
        ) : null}
      </div>
      {dialogKonfirmasi}
    </AppShell>
  );
}
