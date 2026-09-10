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
import { getDaftarTahunAjaran } from "@/lib/gateways/academic";
import {
  type CompanyProfile,
  getCompanyProfile,
} from "@/lib/gateways/company-profile";
import {
  addCounselingSessionGateway,
  type CounselingCaseDetail,
  type CounselingCaseItem,
  type CounselingCategory,
  type CounselingStatus,
  createCounselingCaseGateway,
  deleteCounselingCaseGateway,
  deleteCounselingSessionGateway,
  getCounselingCaseGateway,
  listCounselingCasesGateway,
  updateCounselingCaseGateway,
} from "@/lib/gateways/counseling";
import { getDaftarSiswa } from "@/lib/gateways/student";
import { syncNow } from "@/lib/gateways/sync-status";
import { useConfirmDialog } from "@/lib/hooks/useConfirmDialog";

export default function BimbinganKonselingPage() {
  const { user, isAuthenticated, isLoading: authLoading } = useAuth();

  const [loading, setLoading] = useState(false);
  const [cases, setCases] = useState<CounselingCaseItem[]>([]);
  const [academicYears, setAcademicYears] = useState<Record<string, unknown>[]>(
    [],
  );
  const [students, setStudents] = useState<Record<string, unknown>[]>([]);
  const [companyProfile, setCompanyProfile] = useState<CompanyProfile | null>(
    null,
  );

  // Filters
  const [selectedYearId, setSelectedYearId] = useState<string>("");
  const [selectedStatus, setSelectedStatus] = useState<string>("Semua");
  const [selectedKategori, setSelectedKategori] = useState<string>("Semua");
  const [searchQuery, setSearchQuery] = useState<string>("");

  // Modals
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [detailModalOpen, setDetailModalOpen] = useState(false);
  const [sessionModalOpen, setSessionModalOpen] = useState(false);
  const [letterModalOpen, setLetterModalOpen] = useState(false);

  // Active Detail State
  const [activeCase, setActiveCase] = useState<CounselingCaseDetail | null>(
    null,
  );

  // Create Case Form Draft
  const [newCaseDraft, setNewCaseDraft] = useState<{
    id_siswa: string;
    id_tahun_ajaran: string;
    kategori: CounselingCategory;
    ringkasan: string;
    kronologi: string;
    status: CounselingStatus;
  }>({
    id_siswa: "",
    id_tahun_ajaran: "",
    kategori: "kedisiplinan",
    ringkasan: "",
    kronologi: "",
    status: "Terbuka",
  });

  // New Session Form Draft
  const [newSessionDraft, setNewSessionDraft] = useState<{
    tanggal: string;
    catatan_konseling: string;
    tindak_lanjut: string;
  }>({
    tanggal: new Date().toISOString().split("T")[0],
    catatan_konseling: "",
    tindak_lanjut: "",
  });

  // Letter Options
  const [letterMeetingDate, setLetterMeetingDate] = useState<string>(
    () => new Date(Date.now() + 86400000 * 2).toISOString().split("T")[0],
  );
  const [letterMeetingTime, setLetterMeetingTime] = useState<string>("09:00");
  const [letterMeetingRoom, setLetterMeetingRoom] = useState<string>(
    "Ruang Bimbingan & Konseling (BK)",
  );

  // Feedback State
  const [feedback, setFeedback] = useState<{
    tone: "success" | "error" | "warning";
    message: string;
  } | null>(null);

  // Penjaga anti klik ganda. Sebuah `useState` tidak cukup: pembaruannya
  // dijadwalkan, sehingga dua klik dalam satu tick React sama-sama membaca
  // nilai lama dan keduanya lolos. `useRef` berubah seketika.
  //
  // Di halaman ini taruhannya lebih tinggi daripada sekadar baris ganda: klik
  // ganda pada "Catat Kasus" menghasilkan DUA rekam jejak kedisiplinan untuk
  // satu peristiwa yang sama pada seorang anak.
  //
  // Wajib berada di ATAS, sebelum setiap early return: hook yang dilewati pada
  // sebagian render mengubah urutan hook dan menjatuhkan seluruh halaman.
  const isSubmittingRef = useRef(false);
  const { konfirmasi, dialogKonfirmasi } = useConfirmDialog();

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [casesRes, yearsRes, studentsRes, companyRes] = await Promise.all([
        listCounselingCasesGateway({
          id_tahun_ajaran: selectedYearId || undefined,
          status: selectedStatus === "Semua" ? undefined : selectedStatus,
          kategori: selectedKategori === "Semua" ? undefined : selectedKategori,
          search: searchQuery.trim() || undefined,
          limit: 200,
        }),
        getDaftarTahunAjaran().catch(() => []),
        getDaftarSiswa().catch(() => []),
        getCompanyProfile().catch(() => null),
      ]);

      setCases(casesRes.items);
      setAcademicYears(yearsRes);
      setStudents(studentsRes);
      if (companyRes) setCompanyProfile(companyRes);

      // Auto-select active academic year if not selected
      if (!selectedYearId && yearsRes.length > 0) {
        const activeTa = yearsRes.find(
          (y: Record<string, unknown>) => Number(y.is_aktif) === 1,
        );
        if (activeTa?.id_tahun_ajaran) {
          setSelectedYearId(String(activeTa.id_tahun_ajaran));
          setNewCaseDraft((prev) => ({
            ...prev,
            id_tahun_ajaran: String(activeTa.id_tahun_ajaran),
          }));
        }
      }
    } catch (err) {
      // `bk_kasus`/`bk_sesi` sengaja TIDAK pernah ada di SQLite lokal — catatan
      // kedisiplinan seorang anak tidak boleh tersimpan di terminal pemindai di
      // lobi sekolah. Konsekuensinya halaman ini menuntut jaringan, dan itu
      // harus dikatakan: daftar kosong yang sebenarnya kegagalan tidak bisa
      // dibedakan dari "belum ada kasus".
      setFeedback({
        tone: "error",
        message:
          err instanceof Error
            ? `${err.message} — data Bimbingan Konseling dibaca dari cloud, jadi halaman ini membutuhkan koneksi.`
            : "Gagal memuat data Bimbingan Konseling. Halaman ini membutuhkan koneksi jaringan.",
      });
    } finally {
      setLoading(false);
    }
  }, [selectedYearId, selectedStatus, selectedKategori, searchQuery]);

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
              Memeriksa hak akses...
            </p>
          </div>
        </div>
      </AppShell>
    );
  }

  if (!isAuthenticated || !canAccessArea(user, "bimbingan_konseling")) {
    redirect("/forbidden");
  }

  const canManage = hasPermission(user, "counseling.manage");
  const canDelete = hasPermission(user, "counseling.delete");

  const handleRefresh = async () => {
    setLoading(true);
    try {
      await syncNow();
      await loadData();
      setFeedback({
        tone: "success",
        message: "Data kasus Bimbingan Konseling berhasil dimuat ulang.",
      });
    } catch (err) {
      setFeedback({
        tone: "error",
        message:
          err instanceof Error ? err.message : "Gagal memuat ulang data BK.",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleCreateCase = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmittingRef.current || !canManage) return;
    if (!newCaseDraft.id_siswa || !newCaseDraft.ringkasan.trim()) {
      setFeedback({
        tone: "warning",
        message: "Siswa dan ringkasan kasus wajib diisi.",
      });
      return;
    }

    isSubmittingRef.current = true;
    try {
      await createCounselingCaseGateway({
        id_siswa: newCaseDraft.id_siswa,
        id_tahun_ajaran: newCaseDraft.id_tahun_ajaran || selectedYearId,
        kategori: newCaseDraft.kategori,
        ringkasan: newCaseDraft.ringkasan.trim(),
        kronologi: newCaseDraft.kronologi.trim() || null,
        status: newCaseDraft.status,
      });

      setFeedback({
        tone: "success",
        message: "Kasus Bimbingan Konseling berhasil dicatat.",
      });
      setCreateModalOpen(false);
      setNewCaseDraft({
        id_siswa: "",
        id_tahun_ajaran: selectedYearId,
        kategori: "kedisiplinan",
        ringkasan: "",
        kronologi: "",
        status: "Terbuka",
      });
      void loadData();
    } catch (err) {
      setFeedback({
        tone: "error",
        message:
          err instanceof Error ? err.message : "Gagal mencatat kasus baru.",
      });
    } finally {
      isSubmittingRef.current = false;
    }
  };

  const handleOpenDetail = async (idKasus: string) => {
    try {
      const detail = await getCounselingCaseGateway(idKasus);
      setActiveCase(detail);
      setDetailModalOpen(true);
    } catch (err) {
      setFeedback({
        tone: "error",
        message:
          err instanceof Error ? err.message : "Gagal memuat detail kasus BK.",
      });
    }
  };

  const handleOpenLetter = async (c: CounselingCaseItem) => {
    try {
      const detail = await getCounselingCaseGateway(c.id_kasus);
      setActiveCase(detail);
      setLetterModalOpen(true);
    } catch (err) {
      setFeedback({
        tone: "error",
        message:
          err instanceof Error
            ? err.message
            : "Gagal memuat data surat panggilan.",
      });
    }
  };

  const handleUpdateStatus = async (
    idKasus: string,
    nextStatus: CounselingStatus,
  ) => {
    if (isSubmittingRef.current || !canManage) return;
    isSubmittingRef.current = true;
    try {
      await updateCounselingCaseGateway(idKasus, { status: nextStatus });
      setFeedback({
        tone: "success",
        message: `Status kasus berhasil diperbarui menjadi ${nextStatus}.`,
      });
      if (activeCase && activeCase.id_kasus === idKasus) {
        setActiveCase({ ...activeCase, status: nextStatus });
      }
      void loadData();
    } catch (err) {
      setFeedback({
        tone: "error",
        message:
          err instanceof Error
            ? err.message
            : "Gagal memperbarui status kasus.",
      });
    } finally {
      isSubmittingRef.current = false;
    }
  };

  const handleDeleteCase = async (idKasus: string, studentName: string) => {
    if (isSubmittingRef.current || !canDelete) return;
    const confirmed = await konfirmasi({
      title: `Hapus rekam jejak BK ${studentName}?`,
      description:
        "Seluruh catatan kasus beserta semua sesi konselingnya dihapus permanen dan tidak dapat dipulihkan.",
      preserved: "Data absensi dan presensi kelas siswa tidak ikut terhapus.",
      confirmLabel: "Ya, hapus rekam jejak",
    });
    if (!confirmed) return;

    isSubmittingRef.current = true;
    try {
      await deleteCounselingCaseGateway(idKasus);
      setFeedback({
        tone: "success",
        message: "Kasus Bimbingan Konseling berhasil dihapus.",
      });
      setDetailModalOpen(false);
      void loadData();
    } catch (err) {
      setFeedback({
        tone: "error",
        message:
          err instanceof Error ? err.message : "Gagal menghapus kasus BK.",
      });
    } finally {
      isSubmittingRef.current = false;
    }
  };

  const handleAddSession = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmittingRef.current || !canManage || !activeCase) return;
    if (!newSessionDraft.tanggal || !newSessionDraft.catatan_konseling.trim()) {
      setFeedback({
        tone: "warning",
        message: "Tanggal dan catatan konseling wajib diisi.",
      });
      return;
    }

    isSubmittingRef.current = true;
    try {
      await addCounselingSessionGateway({
        id_kasus: activeCase.id_kasus,
        tanggal: newSessionDraft.tanggal,
        catatan_konseling: newSessionDraft.catatan_konseling.trim(),
        tindak_lanjut: newSessionDraft.tindak_lanjut.trim() || null,
      });

      setFeedback({
        tone: "success",
        message: "Sesi konseling berhasil ditambahkan ke riwayat.",
      });
      setSessionModalOpen(false);
      setNewSessionDraft({
        tanggal: new Date().toISOString().split("T")[0],
        catatan_konseling: "",
        tindak_lanjut: "",
      });

      // Reload active case details
      const updatedDetail = await getCounselingCaseGateway(activeCase.id_kasus);
      setActiveCase(updatedDetail);
      void loadData();
    } catch (err) {
      setFeedback({
        tone: "error",
        message:
          err instanceof Error
            ? err.message
            : "Gagal menambahkan sesi konseling.",
      });
    } finally {
      isSubmittingRef.current = false;
    }
  };

  const handleDeleteSession = async (idSesi: string) => {
    if (isSubmittingRef.current || !canDelete || !activeCase) return;
    const confirmed = await konfirmasi({
      title: "Hapus catatan sesi konseling ini?",
      description:
        "Catatan sesi beserta tindak lanjutnya dihapus permanen dari rekam jejak kasus.",
      preserved: "Kasus induknya dan sesi lainnya tetap tersimpan.",
      confirmLabel: "Ya, hapus sesi",
    });
    if (!confirmed) return;

    isSubmittingRef.current = true;
    try {
      await deleteCounselingSessionGateway(idSesi);
      setFeedback({
        tone: "success",
        message: "Sesi konseling berhasil dihapus.",
      });
      const updatedDetail = await getCounselingCaseGateway(activeCase.id_kasus);
      setActiveCase(updatedDetail);
      void loadData();
    } catch (err) {
      setFeedback({
        tone: "error",
        message:
          err instanceof Error
            ? err.message
            : "Gagal menghapus sesi konseling.",
      });
    } finally {
      isSubmittingRef.current = false;
    }
  };

  // Metrics summary
  const totalKasus = cases.length;
  const totalTerbuka = cases.filter((c) => c.status === "Terbuka").length;
  const totalDalamBimbingan = cases.filter(
    (c) => c.status === "Dalam Bimbingan",
  ).length;
  const totalSelesai = cases.filter((c) => c.status === "Selesai").length;

  const getKategoriBadge = (kategori: CounselingCategory) => {
    switch (kategori) {
      case "kedisiplinan":
        return (
          <span className="inline-flex items-center rounded-md bg-rose-500/10 px-2 py-0.5 text-xs font-semibold text-rose-400 ring-1 ring-inset ring-rose-500/20">
            Kedisiplinan
          </span>
        );
      case "akademik":
        return (
          <span className="inline-flex items-center rounded-md bg-sky-500/10 px-2 py-0.5 text-xs font-semibold text-sky-400 ring-1 ring-inset ring-sky-500/20">
            Akademik
          </span>
        );
      case "kehadiran":
        return (
          <span className="inline-flex items-center rounded-md bg-amber-500/10 px-2 py-0.5 text-xs font-semibold text-amber-400 ring-1 ring-inset ring-amber-500/20">
            Kehadiran / Bolos
          </span>
        );
      case "sosial":
        return (
          <span className="inline-flex items-center rounded-md bg-purple-500/10 px-2 py-0.5 text-xs font-semibold text-purple-400 ring-1 ring-inset ring-purple-500/20">
            Sosial / Perilaku
          </span>
        );
    }
  };

  const getStatusBadge = (status: CounselingStatus) => {
    switch (status) {
      case "Terbuka":
        return (
          <span className="inline-flex items-center rounded-md bg-rose-500/10 px-2 py-0.5 text-xs font-medium text-rose-400 ring-1 ring-inset ring-rose-500/20">
            Terbuka
          </span>
        );
      case "Dalam Bimbingan":
        return (
          <span className="inline-flex items-center rounded-md bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-400 ring-1 ring-inset ring-amber-500/20">
            Dalam Bimbingan
          </span>
        );
      case "Selesai":
        return (
          <span className="inline-flex items-center rounded-md bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-400 ring-1 ring-inset ring-emerald-500/20">
            Selesai
          </span>
        );
    }
  };

  return (
    <AppShell>
      <div className="space-y-6">
        <PageHeader
          eyebrow="BIMBINGAN KONSELING"
          title="Bimbingan & Konseling (BK)"
          description="Pencatatan kasus kedisiplinan, pemanggilan wali murid, dan riwayat sesi konseling (Kerahasiaan Cloud-Only)"
          actions={
            <div className="flex flex-wrap items-center gap-3">
              {canManage && (
                <button
                  type="button"
                  onClick={() => setCreateModalOpen(true)}
                  className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-3.5 py-2 text-xs font-medium text-white shadow-sm transition hover:bg-indigo-500"
                >
                  <Icon name="plus" className="h-4 w-4" />
                  Catat Kasus Baru
                </button>
              )}
              <button
                type="button"
                onClick={handleRefresh}
                disabled={loading}
                className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-800 px-3.5 py-2 text-xs font-medium text-slate-200 shadow-sm transition hover:bg-slate-700 hover:text-white disabled:opacity-50"
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

        {/* Ringkasan Statistik */}
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 backdrop-blur">
            <p className="text-xs font-medium text-slate-400">Total Kasus</p>
            <p className="mt-1.5 text-2xl font-bold tracking-tight text-slate-200">
              {totalKasus}
            </p>
            <p className="mt-1 text-xs text-slate-500">Tahun ajaran aktif</p>
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 backdrop-blur">
            <p className="text-xs font-medium text-slate-400">Kasus Terbuka</p>
            <p className="mt-1.5 text-2xl font-bold tracking-tight text-rose-400">
              {totalTerbuka}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Perlu penanganan konselor
            </p>
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 backdrop-blur">
            <p className="text-xs font-medium text-slate-400">
              Dalam Bimbingan
            </p>
            <p className="mt-1.5 text-2xl font-bold tracking-tight text-amber-400">
              {totalDalamBimbingan}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Sesi konseling berjalan
            </p>
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 backdrop-blur">
            <p className="text-xs font-medium text-slate-400">Kasus Selesai</p>
            <p className="mt-1.5 text-2xl font-bold tracking-tight text-emerald-400">
              {totalSelesai}
            </p>
            <p className="mt-1 text-xs text-slate-500">Tuntas terbimbing</p>
          </div>
        </div>

        {/* Filter Panel */}
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 backdrop-blur">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <label
                htmlFor="filter-ta"
                className="mb-1.5 block text-xs font-medium text-slate-300"
              >
                Tahun Ajaran
              </label>
              <select
                id="filter-ta"
                value={selectedYearId}
                onChange={(e) => setSelectedYearId(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs text-slate-200 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              >
                <option value="">Semua Tahun Ajaran</option>
                {academicYears.map((y) => (
                  <option
                    key={String(y.id_tahun_ajaran)}
                    value={String(y.id_tahun_ajaran)}
                  >
                    {String(y.nama_tahun)} ({String(y.semester)})
                    {Number(y.is_aktif) === 1 ? " [Aktif]" : ""}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label
                htmlFor="filter-status"
                className="mb-1.5 block text-xs font-medium text-slate-300"
              >
                Status Kasus
              </label>
              <select
                id="filter-status"
                value={selectedStatus}
                onChange={(e) => setSelectedStatus(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs text-slate-200 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              >
                <option value="Semua">Semua Status</option>
                <option value="Terbuka">Terbuka</option>
                <option value="Dalam Bimbingan">Dalam Bimbingan</option>
                <option value="Selesai">Selesai</option>
              </select>
            </div>

            <div>
              <label
                htmlFor="filter-kategori"
                className="mb-1.5 block text-xs font-medium text-slate-300"
              >
                Kategori Masalah
              </label>
              <select
                id="filter-kategori"
                value={selectedKategori}
                onChange={(e) => setSelectedKategori(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs text-slate-200 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              >
                <option value="Semua">Semua Kategori</option>
                <option value="kedisiplinan">Kedisiplinan</option>
                <option value="akademik">Akademik</option>
                <option value="kehadiran">Kehadiran / Bolos</option>
                <option value="sosial">Sosial / Perilaku</option>
              </select>
            </div>

            <div>
              <label
                htmlFor="filter-search"
                className="mb-1.5 block text-xs font-medium text-slate-300"
              >
                Pencarian Siswa / Kasus
              </label>
              <input
                id="filter-search"
                type="text"
                placeholder="Nama, NIS, atau ringkasan..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs text-slate-200 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>
          </div>
        </div>

        {/* Tabel Kasus BK */}
        <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900/60 shadow backdrop-blur">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-800 text-left text-xs">
              <thead className="bg-slate-800/60 text-slate-400">
                <tr>
                  <th scope="col" className="px-4 py-3 font-semibold">
                    Siswa & Kelas
                  </th>
                  <th scope="col" className="px-4 py-3 font-semibold">
                    Kategori
                  </th>
                  <th scope="col" className="px-4 py-3 font-semibold">
                    Ringkasan Kasus
                  </th>
                  <th scope="col" className="px-4 py-3 font-semibold">
                    Status
                  </th>
                  <th scope="col" className="px-4 py-3 font-semibold">
                    Sesi Konseling
                  </th>
                  <th scope="col" className="px-4 py-3 font-semibold">
                    Dibuat Oleh
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
                {cases.length === 0 ? (
                  <tr>
                    <td
                      colSpan={7}
                      className="px-4 py-12 text-center text-sm text-slate-500"
                    >
                      Tidak ada catatan kasus Bimbingan Konseling yang
                      ditemukan.
                    </td>
                  </tr>
                ) : (
                  cases.map((c) => (
                    <tr
                      key={c.id_kasus}
                      className="transition hover:bg-slate-800/40"
                    >
                      <td className="px-4 py-3">
                        <p className="font-semibold text-slate-200">
                          {c.nama_siswa}
                        </p>
                        <p className="text-[11px] text-slate-400">
                          NIS: {c.nis || "-"} | {c.nama_rombel || "-"}
                        </p>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        {getKategoriBadge(c.kategori)}
                      </td>
                      <td className="max-w-xs truncate px-4 py-3">
                        <button
                          type="button"
                          title={c.ringkasan}
                          className="block max-w-full truncate cursor-pointer text-left font-medium text-slate-200 hover:text-indigo-400"
                          onClick={() => handleOpenDetail(c.id_kasus)}
                        >
                          {c.ringkasan}
                        </button>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        {getStatusBadge(c.status)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <span className="inline-flex items-center gap-1 font-mono text-slate-300">
                          <Icon
                            name="document"
                            className="h-3.5 w-3.5 text-slate-500"
                          />
                          {c.total_sesi} sesi
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-[11px] text-slate-400">
                        <p className="text-slate-300">{c.dibuat_oleh}</p>
                        <p>{c.created_at?.split(" ")[0] || "-"}</p>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => handleOpenDetail(c.id_kasus)}
                            className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1 text-xs text-slate-200 transition hover:bg-slate-700"
                            title="Buka detail kronologi dan sesi"
                          >
                            <Icon name="eye" className="h-3.5 w-3.5" />
                            Detail & Sesi
                          </button>

                          <button
                            type="button"
                            onClick={() => handleOpenLetter(c)}
                            className="inline-flex items-center gap-1 rounded-lg border border-indigo-500/30 bg-indigo-500/10 px-2.5 py-1 text-xs font-medium text-indigo-300 transition hover:bg-indigo-500 hover:text-white"
                            title="Cetak Surat Panggilan Wali Murid"
                          >
                            <Icon name="document" className="h-3.5 w-3.5" />
                            Surat Panggilan
                          </button>

                          {canDelete && (
                            <button
                              type="button"
                              onClick={() =>
                                handleDeleteCase(c.id_kasus, c.nama_siswa)
                              }
                              className="inline-flex items-center rounded-lg border border-rose-500/30 bg-rose-500/10 p-1 text-xs text-rose-400 transition hover:bg-rose-500 hover:text-white"
                              title="Hapus Kasus"
                            >
                              <Icon name="trash" className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Modal Catat Kasus Baru */}
        {createModalOpen && (
          <Modal
            isOpen
            onClose={() => setCreateModalOpen(false)}
            title="Catat Kasus Bimbingan Konseling"
            maxWidth="max-w-lg"
          >
            <form onSubmit={handleCreateCase} className="space-y-4">
              <div>
                <label
                  htmlFor="create-id-siswa"
                  className="mb-1.5 block text-xs font-medium text-slate-300"
                >
                  Pilih Siswa
                </label>
                <select
                  id="create-id-siswa"
                  value={newCaseDraft.id_siswa}
                  onChange={(e) =>
                    setNewCaseDraft({
                      ...newCaseDraft,
                      id_siswa: e.target.value,
                    })
                  }
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs text-slate-200 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  required
                >
                  <option value="">-- Pilih Siswa --</option>
                  {students.map((s) => (
                    <option key={String(s.id_siswa)} value={String(s.id_siswa)}>
                      {String(s.nama_lengkap)} ({String(s.nama_rombel || "-")})
                      - NIS: {String(s.nis || "-")}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label
                    htmlFor="create-kategori"
                    className="mb-1.5 block text-xs font-medium text-slate-300"
                  >
                    Kategori Kasus
                  </label>
                  <select
                    id="create-kategori"
                    value={newCaseDraft.kategori}
                    onChange={(e) =>
                      setNewCaseDraft({
                        ...newCaseDraft,
                        kategori: e.target.value as CounselingCategory,
                      })
                    }
                    className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs text-slate-200 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  >
                    <option value="kedisiplinan">Kedisiplinan</option>
                    <option value="akademik">Akademik</option>
                    <option value="kehadiran">Kehadiran / Bolos</option>
                    <option value="sosial">Sosial / Perilaku</option>
                  </select>
                </div>

                <div>
                  <label
                    htmlFor="create-status"
                    className="mb-1.5 block text-xs font-medium text-slate-300"
                  >
                    Status Awal
                  </label>
                  <select
                    id="create-status"
                    value={newCaseDraft.status}
                    onChange={(e) =>
                      setNewCaseDraft({
                        ...newCaseDraft,
                        status: e.target.value as CounselingStatus,
                      })
                    }
                    className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs text-slate-200 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  >
                    <option value="Terbuka">Terbuka</option>
                    <option value="Dalam Bimbingan">Dalam Bimbingan</option>
                  </select>
                </div>
              </div>

              <div>
                <label
                  htmlFor="create-ringkasan"
                  className="mb-1.5 block text-xs font-medium text-slate-300"
                >
                  Ringkasan Kasus (Judul Masalah)
                </label>
                <input
                  id="create-ringkasan"
                  type="text"
                  placeholder="Contoh: Sering tidak masuk tanpa keterangan pada jam ke-3 dan 4..."
                  value={newCaseDraft.ringkasan}
                  onChange={(e) =>
                    setNewCaseDraft({
                      ...newCaseDraft,
                      ringkasan: e.target.value,
                    })
                  }
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs text-slate-200 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  required
                />
              </div>

              <div>
                <label
                  htmlFor="create-kronologi"
                  className="mb-1.5 block text-xs font-medium text-slate-300"
                >
                  Kronologi Kejadian / Keterangan Lengkap
                </label>
                <textarea
                  id="create-kronologi"
                  rows={4}
                  placeholder="Tuliskan kronologi, saksi, waktu kejadian, dan data pendukung..."
                  value={newCaseDraft.kronologi}
                  onChange={(e) =>
                    setNewCaseDraft({
                      ...newCaseDraft,
                      kronologi: e.target.value,
                    })
                  }
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs text-slate-200 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>

              <div className="mt-6 flex justify-end gap-3 border-t border-slate-800 pt-4">
                <button
                  type="button"
                  onClick={() => setCreateModalOpen(false)}
                  className="rounded-lg border border-slate-700 bg-slate-800 px-4 py-2 text-xs font-medium text-slate-300 transition hover:bg-slate-700"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="rounded-lg bg-indigo-600 px-4 py-2 text-xs font-semibold text-white shadow transition hover:bg-indigo-500"
                >
                  Simpan Kasus
                </button>
              </div>
            </form>
          </Modal>
        )}

        {/* Modal Detail Kasus & Timeline Sesi */}
        {detailModalOpen && activeCase && (
          <Modal
            isOpen
            onClose={() => setDetailModalOpen(false)}
            title={activeCase.ringkasan}
            subtitle={`Siswa: ${activeCase.nama_siswa} (${activeCase.nama_rombel}) | NIS: ${activeCase.nis || "-"}`}
            maxWidth="max-w-3xl"
            footer={
              <div className="flex w-full justify-between">
                <button
                  type="button"
                  onClick={() => handleOpenLetter(activeCase)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-500/30 bg-indigo-500/10 px-3.5 py-2 text-xs font-semibold text-indigo-300 hover:bg-indigo-500 hover:text-white transition"
                >
                  <Icon name="document" className="h-4 w-4" />
                  Cetak Surat Panggilan
                </button>
                <button
                  type="button"
                  onClick={() => setDetailModalOpen(false)}
                  className="rounded-lg border border-slate-700 bg-slate-800 px-4 py-2 text-xs font-medium text-slate-300 transition hover:bg-slate-700"
                >
                  Tutup
                </button>
              </div>
            }
          >
            <div className="flex items-center gap-2.5">
              {getStatusBadge(activeCase.status)}
              {getKategoriBadge(activeCase.kategori)}
            </div>
            <div className="space-y-6">
              {/* Informasi Siswa & Wali */}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 rounded-xl border border-slate-800 bg-slate-950/60 p-4 text-xs">
                <div>
                  <span className="text-slate-400">Nama Wali Murid:</span>{" "}
                  <span className="font-semibold text-slate-200">
                    {activeCase.nama_wali || "Belum dicatat"}
                  </span>
                </div>
                <div>
                  <span className="text-slate-400">Nomor WhatsApp Wali:</span>{" "}
                  <span className="font-mono font-medium text-slate-200">
                    {activeCase.no_whatsapp_wali || "-"}
                  </span>
                </div>
                <div>
                  <span className="text-slate-400">Dicatat Oleh:</span>{" "}
                  <span className="text-slate-300">
                    {activeCase.dibuat_oleh} ({activeCase.created_at})
                  </span>
                </div>
                <div>
                  <span className="text-slate-400">Tahun Ajaran:</span>{" "}
                  <span className="text-slate-300">
                    {activeCase.nama_tahun}
                  </span>
                </div>
              </div>

              {/* Kronologi */}
              <div>
                <h4 className="text-xs font-semibold text-slate-300 mb-1.5">
                  Kronologi / Catatan Kejadian
                </h4>
                <div className="whitespace-pre-wrap rounded-lg border border-slate-800 bg-slate-950 p-4 text-xs leading-relaxed text-slate-300">
                  {activeCase.kronologi ||
                    "Tidak ada catatan kronologi terperinci."}
                </div>
              </div>

              {/* Ubah Status Cepat */}
              {canManage && (
                <div className="flex items-center gap-3 rounded-lg border border-slate-800 bg-slate-800/40 p-3 text-xs">
                  <span className="text-slate-400 font-medium">
                    Ubah Status Kasus:
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        handleUpdateStatus(activeCase.id_kasus, "Terbuka")
                      }
                      className={`rounded-md px-2.5 py-1 font-medium transition ${
                        activeCase.status === "Terbuka"
                          ? "bg-rose-500/20 text-rose-300 ring-1 ring-rose-500/30"
                          : "text-slate-400 hover:bg-slate-800"
                      }`}
                    >
                      Terbuka
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        handleUpdateStatus(
                          activeCase.id_kasus,
                          "Dalam Bimbingan",
                        )
                      }
                      className={`rounded-md px-2.5 py-1 font-medium transition ${
                        activeCase.status === "Dalam Bimbingan"
                          ? "bg-amber-500/20 text-amber-300 ring-1 ring-amber-500/30"
                          : "text-slate-400 hover:bg-slate-800"
                      }`}
                    >
                      Dalam Bimbingan
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        handleUpdateStatus(activeCase.id_kasus, "Selesai")
                      }
                      className={`rounded-md px-2.5 py-1 font-medium transition ${
                        activeCase.status === "Selesai"
                          ? "bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-500/30"
                          : "text-slate-400 hover:bg-slate-800"
                      }`}
                    >
                      Selesai
                    </button>
                  </div>
                </div>
              )}

              {/* Timeline Sesi Konseling */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-xs font-semibold text-slate-200">
                    Riwayat Sesi Konseling ({activeCase.sesi?.length || 0} Sesi)
                  </h4>
                  {canManage && (
                    <button
                      type="button"
                      onClick={() => setSessionModalOpen(true)}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white shadow transition hover:bg-indigo-500"
                    >
                      <Icon name="plus" className="h-3.5 w-3.5" />
                      Tambah Sesi Konseling
                    </button>
                  )}
                </div>

                {activeCase.sesi?.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-slate-800 p-6 text-center text-xs text-slate-500">
                    Belum ada sesi konseling yang dicatat untuk kasus ini. Klik
                    "Tambah Sesi Konseling" untuk memulai bimbingan.
                  </div>
                ) : (
                  <div className="relative border-l-2 border-slate-800 pl-4 space-y-4 ml-2">
                    {activeCase.sesi.map((ses, idx) => (
                      <div
                        key={ses.id_sesi}
                        className="relative rounded-lg border border-slate-800 bg-slate-950 p-4 text-xs"
                      >
                        <span className="absolute -left-[23px] top-4.5 h-3 w-3 rounded-full border-2 border-slate-900 bg-indigo-500" />
                        <div className="flex items-center justify-between border-b border-slate-800 pb-2 mb-2">
                          <div>
                            <span className="font-semibold text-slate-200">
                              Sesi #{idx + 1} ({ses.tanggal})
                            </span>
                            <span className="text-slate-500 ml-2 font-mono">
                              Konselor: {ses.konselor}
                            </span>
                          </div>
                          {canDelete && (
                            <button
                              type="button"
                              onClick={() => handleDeleteSession(ses.id_sesi)}
                              className="text-slate-500 hover:text-rose-400"
                              title="Hapus sesi"
                            >
                              <Icon name="trash" className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>

                        <div className="space-y-2">
                          <div>
                            <p className="text-slate-400 font-medium">
                              Catatan Konseling:
                            </p>
                            <p className="text-slate-200 whitespace-pre-wrap mt-0.5">
                              {ses.catatan_konseling}
                            </p>
                          </div>
                          {ses.tindak_lanjut && (
                            <div className="rounded bg-indigo-500/10 p-2.5 text-indigo-300 ring-1 ring-indigo-500/20">
                              <span className="font-semibold">
                                Tindak Lanjut:
                              </span>{" "}
                              {ses.tindak_lanjut}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </Modal>
        )}

        {/* Modal Tambah Sesi Konseling */}
        {sessionModalOpen && (
          <Modal
            isOpen
            onClose={() => setSessionModalOpen(false)}
            title="Tambah Sesi Konseling"
            maxWidth="max-w-md"
          >
            <form onSubmit={handleAddSession} className="space-y-4 text-xs">
              <div>
                <label
                  htmlFor="session-tanggal"
                  className="mb-1.5 block font-medium text-slate-300"
                >
                  Tanggal Pertemuan Sesi
                </label>
                <input
                  id="session-tanggal"
                  type="date"
                  value={newSessionDraft.tanggal}
                  onChange={(e) =>
                    setNewSessionDraft({
                      ...newSessionDraft,
                      tanggal: e.target.value,
                    })
                  }
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-slate-200 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  required
                />
              </div>

              <div>
                <label
                  htmlFor="session-catatan"
                  className="mb-1.5 block font-medium text-slate-300"
                >
                  Catatan Pembahasan / Hasil Konseling
                </label>
                <textarea
                  id="session-catatan"
                  rows={4}
                  placeholder="Tuliskan hasil diskusi dengan siswa, pengakuan, dan komitmen..."
                  value={newSessionDraft.catatan_konseling}
                  onChange={(e) =>
                    setNewSessionDraft({
                      ...newSessionDraft,
                      catatan_konseling: e.target.value,
                    })
                  }
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-slate-200 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  required
                />
              </div>

              <div>
                <label
                  htmlFor="session-tindak-lanjut"
                  className="mb-1.5 block font-medium text-slate-300"
                >
                  Rencana Tindak Lanjut (Opsional)
                </label>
                <input
                  id="session-tindak-lanjut"
                  type="text"
                  placeholder="Contoh: Pemanggilan orang tua, pemantauan presensi harian..."
                  value={newSessionDraft.tindak_lanjut}
                  onChange={(e) =>
                    setNewSessionDraft({
                      ...newSessionDraft,
                      tindak_lanjut: e.target.value,
                    })
                  }
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-slate-200 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>

              <div className="mt-6 flex justify-end gap-3 border-t border-slate-800 pt-4">
                <button
                  type="button"
                  onClick={() => setSessionModalOpen(false)}
                  className="rounded-lg border border-slate-700 bg-slate-800 px-4 py-2 font-medium text-slate-300 transition hover:bg-slate-700"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="rounded-lg bg-indigo-600 px-4 py-2 font-semibold text-white shadow transition hover:bg-indigo-500"
                >
                  Simpan Sesi
                </button>
              </div>
            </form>
          </Modal>
        )}

        {/* Modal Surat Panggilan Wali Murid (Printable View) */}
        {letterModalOpen && activeCase && (
          <Modal
            isOpen
            onClose={() => setLetterModalOpen(false)}
            title="Pratinjau Surat Panggilan Wali Murid"
            maxWidth="max-w-2xl"
            footer={
              <div className="flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-xs font-semibold text-white shadow transition hover:bg-indigo-500"
                >
                  <Icon name="document" className="h-4 w-4" />
                  Cetak Dokumen Surat
                </button>
                <button
                  type="button"
                  onClick={() => setLetterModalOpen(false)}
                  className="rounded-lg border border-slate-700 bg-slate-800 px-4 py-2 text-xs font-medium text-slate-300 transition hover:bg-slate-700"
                >
                  Tutup
                </button>
              </div>
            }
          >
            {/* Form Konfigurasi Jadwal Pertemuan */}
            <div className="border-b border-slate-800 bg-slate-950/60 p-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 text-xs">
                <div>
                  <label
                    htmlFor="letter-date"
                    className="mb-1 block font-medium text-slate-300"
                  >
                    Hari / Tanggal Pertemuan
                  </label>
                  <input
                    id="letter-date"
                    type="date"
                    value={letterMeetingDate}
                    onChange={(e) => setLetterMeetingDate(e.target.value)}
                    className="w-full rounded border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-slate-200 focus:outline-none"
                  />
                </div>
                <div>
                  <label
                    htmlFor="letter-time"
                    className="mb-1 block font-medium text-slate-300"
                  >
                    Waktu Pertemuan (WIB)
                  </label>
                  <input
                    id="letter-time"
                    type="time"
                    value={letterMeetingTime}
                    onChange={(e) => setLetterMeetingTime(e.target.value)}
                    className="w-full rounded border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-slate-200 focus:outline-none"
                  />
                </div>
                <div>
                  <label
                    htmlFor="letter-room"
                    className="mb-1 block font-medium text-slate-300"
                  >
                    Tempat Pertemuan
                  </label>
                  <input
                    id="letter-room"
                    type="text"
                    value={letterMeetingRoom}
                    onChange={(e) => setLetterMeetingRoom(e.target.value)}
                    className="w-full rounded border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-slate-200 focus:outline-none"
                  />
                </div>
              </div>
            </div>

            {/* Halaman Cetak Surat Resmi (Kop Sekolah) */}
            <div className="flex-1 overflow-y-auto p-6">
              <div
                id="printable-counseling-letter"
                className="mx-auto max-w-xl rounded border border-slate-300 bg-white p-8 text-black shadow-lg"
                style={{ fontFamily: "'Times New Roman', Times, serif" }}
              >
                {/* Kop Surat */}
                <div className="border-b-2 border-black pb-3 text-center">
                  <h2 className="text-lg font-bold uppercase tracking-wider">
                    {String(
                      companyProfile?.company_name ||
                        "SEKOLAH PUSAT PRESTASI & GENERASI",
                    )}
                  </h2>
                  {companyProfile?.branch_name ? (
                    <p className="text-xs font-semibold uppercase">
                      {String(companyProfile?.branch_name)}
                    </p>
                  ) : null}
                  <p className="text-xs">
                    {String(
                      companyProfile?.address ||
                        "Jl. Pendidikan No. 123, Komplek Edukasi",
                    )}
                  </p>
                  <p className="text-xs">
                    Telepon: {String(companyProfile?.phone || "(021) 555-1234")}{" "}
                    | Email:{" "}
                    {String(companyProfile?.email || "info@sekolah.sch.id")}
                  </p>
                </div>

                {/* Info Nomor & Tanggal */}
                <div className="mt-4 flex justify-between text-xs">
                  <div>
                    <p>Nomor: 421.3 / BK / SPPG / {new Date().getFullYear()}</p>
                    <p>Lampiran: -</p>
                    <p>
                      Perihal:{" "}
                      <span className="font-bold underline">
                        Surat Panggilan Orang Tua / Wali
                      </span>
                    </p>
                  </div>
                  <div className="text-right">
                    <p>
                      {String(companyProfile?.branch_name || "Kota")},{" "}
                      {new Date().toLocaleDateString("id-ID", {
                        day: "numeric",
                        month: "long",
                        year: "numeric",
                      })}
                    </p>
                  </div>
                </div>

                {/* Tujuan */}
                <div className="mt-4 text-xs">
                  <p>Kepada Yth.</p>
                  <p className="font-bold">
                    Bapak / Ibu Orang Tua / Wali Murid dari:
                  </p>
                  <table className="mt-1 ml-4 text-xs">
                    <tbody>
                      <tr>
                        <td className="w-28 py-0.5">Nama Siswa</td>
                        <td className="w-4">:</td>
                        <td className="font-bold">{activeCase.nama_siswa}</td>
                      </tr>
                      <tr>
                        <td className="py-0.5">Kelas / Rombel</td>
                        <td>:</td>
                        <td>{activeCase.nama_rombel}</td>
                      </tr>
                      <tr>
                        <td className="py-0.5">NIS / NISN</td>
                        <td>:</td>
                        <td>{activeCase.nis || "-"}</td>
                      </tr>
                    </tbody>
                  </table>
                  <p className="mt-1">di Tempat</p>
                </div>

                {/* Isi Surat */}
                <div className="mt-4 text-xs leading-relaxed text-justify space-y-2">
                  <p>Dengan hormat,</p>
                  <p>
                    Sehubungan dengan pentingnya pembinaan dan pendampingan
                    putra/putri Bapak/Ibu di sekolah, khususnya terkait
                    perkembangan <strong>{activeCase.kategori}</strong> siswa,
                    dengan ini kami mengharapkan kehadiran Bapak/Ibu ke sekolah
                    pada:
                  </p>

                  <table className="ml-6 text-xs font-semibold">
                    <tbody>
                      <tr>
                        <td className="w-28 py-0.5">Hari / Tanggal</td>
                        <td className="w-4">:</td>
                        <td>
                          {new Date(letterMeetingDate).toLocaleDateString(
                            "id-ID",
                            {
                              weekday: "long",
                              day: "numeric",
                              month: "long",
                              year: "numeric",
                            },
                          )}
                        </td>
                      </tr>
                      <tr>
                        <td className="py-0.5">Waktu</td>
                        <td>:</td>
                        <td>Pukul {letterMeetingTime} WIB s.d. Selesai</td>
                      </tr>
                      <tr>
                        <td className="py-0.5">Tempat</td>
                        <td>:</td>
                        <td>{letterMeetingRoom}</td>
                      </tr>
                      <tr>
                        <td className="py-0.5">Keperluan</td>
                        <td>:</td>
                        <td>
                          Konsultasi perkembangan siswa mengenai:{" "}
                          {activeCase.ringkasan}
                        </td>
                      </tr>
                    </tbody>
                  </table>

                  <p>
                    Mengingat pentingnya hal tersebut demi kebaikan masa depan
                    ananda, kami sangat mengharapkan kehadiran Bapak/Ibu tepat
                    pada waktu yang telah ditentukan.
                  </p>
                  <p>
                    Demikian surat undangan pemanggilan ini kami sampaikan. Atas
                    perhatian dan kerjasamanya, kami ucapkan terima kasih.
                  </p>
                </div>

                {/* Tanda Tangan */}
                <div className="mt-8 grid grid-cols-2 text-center text-xs">
                  <div>
                    <p>Mengetahui,</p>
                    <p>Kepala Sekolah</p>
                    <div className="h-16" />
                    <p className="font-bold underline">
                      {String(
                        companyProfile?.leader_name || "Drs. H. Mulyono, M.Pd.",
                      )}
                    </p>
                    <p>
                      NIP.{" "}
                      {String(
                        companyProfile?.leader_nip || "19680512 199403 1 002",
                      )}
                    </p>
                  </div>

                  <div>
                    <p>Guru Pembimbing / Konselor BK,</p>
                    <div className="h-16" />
                    <p className="font-bold underline">
                      {String(
                        activeCase.dibuat_oleh ||
                          user?.nama_operator ||
                          user?.username ||
                          "Konselor BK",
                      )}
                    </p>
                    <p>NIP. -</p>
                  </div>
                </div>
              </div>
            </div>
          </Modal>
        )}
      </div>
      {dialogKonfirmasi}
    </AppShell>
  );
}
