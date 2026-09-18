"use client";

import Image from "next/image";
import { redirect } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { FeedbackBanner } from "@/components/ui/FeedbackBanner";
import { Icon } from "@/components/ui/Icon";
import { Modal } from "@/components/ui/Modal";
import { PageHeader } from "@/components/ui/PageHeader";
import { canAccessArea, hasPermission } from "@/lib/auth/access";
import {
  describeImportReport,
  downloadStudentTemplate,
  exportStudents,
  readStudentWorkbook,
  runPersonnelImport,
} from "@/lib/client/personnel-workbook";
import { createQrPng, employeeQrPayload } from "@/lib/client/qr-code";
import { useAuth } from "@/lib/context/AuthContext";
import { getDaftarRombel, getDaftarUnit } from "@/lib/gateways/academic";
import { getDaftarShift } from "@/lib/gateways/shift";
import {
  getDaftarSiswa,
  hapusSiswa,
  type SiswaInput,
  simpanSiswa,
} from "@/lib/gateways/student";
import { subscribeSyncCompleted, syncNow } from "@/lib/gateways/sync-status";
import {
  bulkIssueWaliPasswords,
  getWaliCredentialStatus,
  getWaliCredentialsForPrinting,
  resetWaliPassword,
  type WaliCredentialStatus,
  type WaliSlipCredential,
} from "@/lib/gateways/wali-credential";
import { useConfirmDialog } from "@/lib/hooks/useConfirmDialog";
import { normalizeOperatorPhone } from "@/lib/operators/contact";
import {
  opsiFilterUnit,
  STATUS_SISWA,
  shiftLabel,
  TANPA_UNIT,
} from "@/lib/validations/personnel";

export default function SiswaPage() {
  const { konfirmasi, dialogKonfirmasi } = useConfirmDialog();
  const { user, isAuthenticated, isLoading: authLoading } = useAuth();
  const canManage = hasPermission(user, "students.manage");
  const canResetWali = hasPermission(user, "students.reset_wali_password");

  const [siswaList, setSiswaList] = useState<Record<string, unknown>[]>([]);
  const [rombelList, setRombelList] = useState<Record<string, unknown>[]>([]);
  const [shiftList, setShiftList] = useState<Record<string, unknown>[]>([]);
  // Daftar shift menuntut `shifts.view`; tanpa izin itu halaman siswa tetap
  // jalan, tetapi pemilih jam scan WAJIB menjelaskan kenapa ia kosong.
  const [shiftError, setShiftError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [bulkWorking, setBulkWorking] = useState(false);
  const importInputRef = useRef<HTMLInputElement>(null);
  const isSubmittingRef = useRef(false);

  // Filters
  const [search, setSearch] = useState("");
  const [filterRombel, setFilterRombel] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [filterUnit, setFilterUnit] = useState("");

  const [feedback, setFeedback] = useState<{
    tone: "success" | "error" | "warning";
    message: string;
  } | null>(null);

  // Modal State
  const [showModal, setShowModal] = useState(false);
  const [saving, setSaving] = useState(false);
  // Penanda mode edit BERDIRI SENDIRI, tidak diturunkan dari `formData.id_siswa`.
  // Sejak ID bisa diketik saat menambah, `id_siswa` yang terisi tidak lagi
  // berarti "sedang mengedit" — judul modal dan penguncian field ikut salah
  // begitu operator mengetik karakter pertama ID-nya.
  const [isEditing, setIsEditing] = useState(false);
  const [unitList, setUnitList] = useState<Record<string, unknown>[]>([]);
  const [formData, setFormData] = useState<SiswaInput>({
    id_siswa: "",
    nama_lengkap: "",
    nis: "",
    nisn: "",
    jenis_kelamin: "L",
    id_rombel: "",
    nama_wali: "",
    no_whatsapp_wali: "",
    alamat: "",
    angkatan: new Date().getFullYear(),
    status: "Aktif",
  });

  // QR Modal State
  const [qrModalData, setQrModalData] = useState<{
    nama: string;
    nis: string;
    rombel: string;
    qrPng: string;
  } | null>(null);

  // Wali Credential Modal State
  const [waliModalData, setWaliModalData] = useState<{
    student: Record<string, unknown>;
    statusInfo: WaliCredentialStatus | null;
    loading: boolean;
    resetting: boolean;
  } | null>(null);

  // Bulk Slips Modal State
  const [showBulkSlipModal, setShowBulkSlipModal] = useState(false);
  const [bulkSlips, setBulkSlips] = useState<WaliSlipCredential[]>([]);
  const [bulkSlipLoading, setBulkSlipLoading] = useState(false);
  const [bulkIssuing, setBulkIssuing] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [sData, rData, uData] = await Promise.all([
        getDaftarSiswa(filterRombel || undefined),
        getDaftarRombel(),
        getDaftarUnit(),
      ]);
      setSiswaList(sData);
      setRombelList(rData);
      // Hanya unit aktif yang masuk dropdown; unit nonaktif tetap tersimpan
      // pada personil lama supaya datanya tidak hilang saat unit dipensiunkan.
      setUnitList(uData.filter((u) => Number(u.status_aktif) === 1));
    } catch (err) {
      setFeedback({
        tone: "error",
        message:
          err instanceof Error ? err.message : "Gagal memuat data siswa.",
      });
    } finally {
      setLoading(false);
    }
    try {
      setShiftList(await getDaftarShift());
      setShiftError(null);
    } catch (err) {
      setShiftList([]);
      setShiftError(
        err instanceof Error
          ? `Daftar shift tidak bisa dimuat: ${err.message}`
          : "Daftar shift tidak bisa dimuat.",
      );
    }
  }, [filterRombel]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    return subscribeSyncCompleted(() => {
      void loadData();
    });
  }, [loadData]);

  const filteredStudents = useMemo(() => {
    return siswaList.filter((item) => {
      const nama = String(item.nama_lengkap || "").toLowerCase();
      const nis = String(item.nis || "").toLowerCase();
      const nisn = String(item.nisn || "").toLowerCase();
      const wali = String(item.nama_wali || "").toLowerCase();
      const q = search.toLowerCase().trim();

      if (
        q &&
        !nama.includes(q) &&
        !nis.includes(q) &&
        !nisn.includes(q) &&
        !wali.includes(q)
      ) {
        return false;
      }
      if (filterStatus && String(item.status) !== filterStatus) {
        return false;
      }
      // "(Tanpa unit)" memang perlu bisa dipilih: tanpa itu baris yang unitnya
      // belum diisi tidak punya satu pun filter yang menampilkannya, dan justru
      // baris itulah yang perlu ditemukan untuk dilengkapi.
      if (filterUnit) {
        const unitBaris = String(item.unit || "").trim();
        if (
          filterUnit === TANPA_UNIT
            ? unitBaris !== ""
            : unitBaris !== filterUnit
        ) {
          return false;
        }
      }
      return true;
    });
  }, [siswaList, search, filterStatus, filterUnit]);

  const unitOptions = useMemo(
    () => opsiFilterUnit(unitList, siswaList),
    [unitList, siswaList],
  );

  const handleOpenAdd = () => {
    setFormData({
      id_siswa: "",
      nama_lengkap: "",
      nis: "",
      nisn: "",
      jenis_kelamin: "L",
      id_rombel: rombelList[0] ? String(rombelList[0].id_rombel) : "",
      nama_wali: "",
      no_whatsapp_wali: "",
      alamat: "",
      angkatan: new Date().getFullYear(),
      status: "Aktif",
      id_shift: shiftList[0] ? Number(shiftList[0].id_shift) : undefined,
      unit: "",
    });
    setIsEditing(false);
    setShowModal(true);
  };

  const handleOpenEdit = (item: Record<string, unknown>) => {
    setIsEditing(true);
    setFormData({
      id_siswa: String(item.id_siswa),
      nama_lengkap: String(item.nama_lengkap),
      nis: item.nis ? String(item.nis) : "",
      nisn: item.nisn ? String(item.nisn) : "",
      jenis_kelamin: item.jenis_kelamin === "P" ? "P" : "L",
      id_rombel: String(item.id_rombel),
      nama_wali: item.nama_wali ? String(item.nama_wali) : "",
      no_whatsapp_wali: item.no_whatsapp_wali
        ? String(item.no_whatsapp_wali)
        : "",
      alamat: item.alamat ? String(item.alamat) : "",
      angkatan: Number(item.angkatan || new Date().getFullYear()),
      status: item.status ? String(item.status) : "Aktif",
      id_shift: item.id_shift ? Number(item.id_shift) : undefined,
      unit: item.unit ? String(item.unit) : "",
    });
    setShowModal(true);
  };

  const handleDelete = async (id: string) => {
    if (!canManage) return;
    const ok = await konfirmasi({
      title: "Hapus profil siswa ini?",
      description:
        "Profil siswa dinonaktifkan dan hilang dari daftar rombel. Penghapusannya ikut tersinkronisasi ke seluruh perangkat.",
      preserved:
        "Riwayat absensi gerbang, presensi kelas, dan leger kehadirannya tetap tersimpan.",
      confirmLabel: "Ya, hapus",
    });
    if (!ok) return;

    // Penjaga klik ganda: state penanda proses baru terlihat setelah
    // render berikutnya, sehingga dua klik cepat sama-sama melewatinya.
    if (isSubmittingRef.current) return;
    isSubmittingRef.current = true;

    try {
      await hapusSiswa(id);
      setFeedback({
        tone: "success",
        message: "Profil siswa berhasil dihapus.",
      });
      void loadData();
    } catch (err) {
      setFeedback({
        tone: "error",
        message: err instanceof Error ? err.message : "Gagal menghapus siswa.",
      });
    } finally {
      isSubmittingRef.current = false;
    }
  };

  const handleShowQr = async (item: Record<string, unknown>) => {
    // Isi QR dibangun helper kanonik yang sama dengan kartu karyawan dan
    // Mobile — jangan menyusunnya sendiri. Ia mengembalikan "" ketika token
    // belum ada, sehingga `createQrPng` melempar pesan jelas alih-alih
    // menghasilkan QR berisi id telanjang yang PASTI ditolak scanner (formatnya
    // wajib `id|token`).
    const payload = employeeQrPayload({ ...item, id_unik: item.id_siswa });

    try {
      const png = await createQrPng(payload, 400);
      setQrModalData({
        nama: String(item.nama_lengkap),
        nis: String(item.nis || item.nisn || "-"),
        rombel: String(item.nama_rombel || `Kelas ${item.tingkat}`),
        qrPng: png,
      });
    } catch {
      setFeedback({
        tone: "error",
        message: "Gagal membuat barcode QR absensi siswa.",
      });
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManage || isSubmittingRef.current) return;
    isSubmittingRef.current = true;
    setSaving(true);
    try {
      await simpanSiswa(formData);
      setFeedback({
        tone: "success",
        message: "Data profil siswa berhasil disimpan.",
      });
      setShowModal(false);
      void loadData();
    } catch (err) {
      setFeedback({
        tone: "error",
        message:
          err instanceof Error ? err.message : "Gagal menyimpan data siswa.",
      });
    } finally {
      isSubmittingRef.current = false;
      setSaving(false);
    }
  };

  const handleImport = async (file: File) => {
    if (!canManage || isSubmittingRef.current) return;
    isSubmittingRef.current = true;
    setBulkWorking(true);
    try {
      const baris = await readStudentWorkbook(file, {
        rombel: rombelList,
        shifts: shiftList,
      });
      const report = await runPersonnelImport(baris, (draft) =>
        simpanSiswa(draft, { tundaSinkronisasi: true }),
      );
      let catatanSinkron = "";
      if (report.berhasil > 0) {
        try {
          await syncNow();
        } catch (err) {
          catatanSinkron = ` Data sudah tersimpan di perangkat ini; sinkronisasi akan dicoba otomatis (${
            err instanceof Error ? err.message : "gagal menghubungi database"
          }).`;
        }
      }
      setFeedback({
        tone: report.gagal.length > 0 || catatanSinkron ? "warning" : "success",
        message: describeImportReport(report, "peserta didik") + catatanSinkron,
      });
      await loadData();
    } catch (err) {
      setFeedback({
        tone: "error",
        message: err instanceof Error ? err.message : "Impor Excel gagal.",
      });
    } finally {
      isSubmittingRef.current = false;
      setBulkWorking(false);
      if (importInputRef.current) importInputRef.current.value = "";
    }
  };

  const reportSaved = (
    result: { cancelled?: boolean; path?: string | null },
    label: string,
  ) => {
    if (result.cancelled) return;
    setFeedback({
      tone: "success",
      message: result.path
        ? `${label} berhasil disimpan di: ${result.path}`
        : `${label} berhasil diunduh.`,
    });
  };

  const handleExport = async () => {
    try {
      reportSaved(
        await exportStudents(filteredStudents, shiftList),
        "Data peserta didik",
      );
    } catch (err) {
      setFeedback({
        tone: "error",
        message: err instanceof Error ? err.message : "Gagal mengekspor data.",
      });
    }
  };

  const handleDownloadTemplate = async () => {
    try {
      reportSaved(
        await downloadStudentTemplate({
          rombel: rombelList,
          shifts: shiftList,
        }),
        "Template impor",
      );
    } catch (err) {
      setFeedback({
        tone: "error",
        message:
          err instanceof Error ? err.message : "Gagal mengunduh template.",
      });
    }
  };

  const shiftById = (idShift: unknown) =>
    shiftList.find((s) => Number(s.id_shift) === Number(idShift));

  const handleCopyPassword = async (text: string, id: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      // Abaikan jika clipboard API tidak tersedia
    }
  };

  const handleOpenWaliCredential = async (student: Record<string, unknown>) => {
    const idSiswa = String(student.id_siswa);
    setWaliModalData({
      student,
      statusInfo: null,
      loading: true,
      resetting: false,
    });
    try {
      const status = await getWaliCredentialStatus(idSiswa);
      setWaliModalData((prev) =>
        prev && String(prev.student.id_siswa) === idSiswa
          ? { ...prev, statusInfo: status, loading: false }
          : prev,
      );
    } catch (err) {
      setFeedback({
        tone: "error",
        message:
          err instanceof Error
            ? err.message
            : "Gagal memeriksa status akun wali.",
      });
      setWaliModalData(null);
    }
  };

  const handleResetSingleWali = async () => {
    if (!waliModalData || !canResetWali || isSubmittingRef.current) return;
    const idSiswa = String(waliModalData.student.id_siswa);
    const nama = String(waliModalData.student.nama_lengkap || "siswa ini");
    const ok = await konfirmasi({
      title: `Reset kata sandi akun wali untuk ${nama}?`,
      description:
        "Kata sandi wali akan dikembalikan ke formula bawaan (NISN/NIS + Unit), dan seluruh sesi login wali murid yang sedang aktif akan seketika dicabut/dikeluarkan.",
      preserved:
        "Data riwayat kehadiran, rekap, dan nilai siswa tidak terpengaruh.",
      confirmLabel: "Ya, reset kata sandi",
    });
    if (!ok) return;

    if (isSubmittingRef.current) return;
    isSubmittingRef.current = true;
    setWaliModalData((prev) => (prev ? { ...prev, resetting: true } : null));

    try {
      const res = await resetWaliPassword(idSiswa);
      setFeedback({
        tone: "success",
        message: `Kata sandi akun wali untuk ${nama} berhasil direset ke sandi bawaan: ${res.defaultPassword}`,
      });
      const updatedStatus = await getWaliCredentialStatus(idSiswa);
      setWaliModalData((prev) =>
        prev && String(prev.student.id_siswa) === idSiswa
          ? { ...prev, statusInfo: updatedStatus, resetting: false }
          : prev,
      );
    } catch (err) {
      setFeedback({
        tone: "error",
        message:
          err instanceof Error
            ? err.message
            : "Gagal mereset kata sandi akun wali.",
      });
      setWaliModalData((prev) => (prev ? { ...prev, resetting: false } : null));
    } finally {
      isSubmittingRef.current = false;
    }
  };

  const handleOpenBulkSlips = async () => {
    setShowBulkSlipModal(true);
    setBulkSlipLoading(true);
    try {
      const ids = filteredStudents.map((s) => String(s.id_siswa));
      const slips = await getWaliCredentialsForPrinting(
        ids.length > 0 ? ids : undefined,
      );
      setBulkSlips(slips);
    } catch (err) {
      setFeedback({
        tone: "error",
        message:
          err instanceof Error
            ? err.message
            : "Gagal memuat slip kredensial akun wali.",
      });
      setShowBulkSlipModal(false);
    } finally {
      setBulkSlipLoading(false);
    }
  };

  const handleExecuteBulkIssue = async () => {
    if (!canResetWali || isSubmittingRef.current) return;
    const ok = await konfirmasi({
      title: "Terbitkan Kredensial Wali Massal?",
      description:
        "Sistem akan menginisialisasi kata sandi bawaan bagi semua siswa terpilih yang belum memiliki catatan kredensial. Akun wali yang sudah pernah mengganti kata sandi tidak akan diubah.",
      confirmLabel: "Ya, terbitkan massal",
    });
    if (!ok) return;

    if (isSubmittingRef.current) return;
    isSubmittingRef.current = true;
    setBulkIssuing(true);

    try {
      const ids = filteredStudents.map((s) => String(s.id_siswa));
      const res = await bulkIssueWaliPasswords(
        ids.length > 0 ? ids : undefined,
      );
      setFeedback({
        tone: "success",
        message: `Berhasil menerbitkan kredensial untuk ${res.count} akun wali murid.`,
      });
      const slips = await getWaliCredentialsForPrinting(
        ids.length > 0 ? ids : undefined,
      );
      setBulkSlips(slips);
    } catch (err) {
      setFeedback({
        tone: "error",
        message:
          err instanceof Error
            ? err.message
            : "Gagal menerbitkan kredensial massal.",
      });
    } finally {
      isSubmittingRef.current = false;
      setBulkIssuing(false);
    }
  };

  // Gerbang area: setiap halaman lain melakukan hal yang sama. Backend sudah
  // menegakkan izinnya lewat require_permission/requireWebPermission, tetapi
  // tanpa ini halaman data siswa tetap terbuka lewat URL bagi role yang tidak
  // berhak dan hanya menampilkan banner error.
  if (authLoading) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-6 text-slate-100 font-sans">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 border-4 border-sky-500 border-t-transparent rounded-full animate-spin"></div>
          <p className="text-xs text-slate-400 font-mono animate-pulse">
            Memuat Data Siswa...
          </p>
        </div>
      </div>
    );
  }
  if (!isAuthenticated) redirect("/login");
  if (!canAccessArea(user, "siswa")) redirect("/forbidden");

  return (
    <AppShell>
      <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6 px-4 py-6 sm:px-6">
        <PageHeader
          eyebrow="Kesiswaan"
          title="Master Data Peserta Didik"
          description="Direktori siswa, pembagian rombel belajar, dan integrasi notifikasi wali murid."
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void loadData()}
                className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:bg-white/10"
              >
                <Icon name="refresh" className="size-4" />
                <span>Muat Ulang</span>
              </button>
              <button
                type="button"
                onClick={() => void handleExport()}
                className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-sky-500/40 bg-slate-800 px-4 py-2 text-sm font-semibold text-sky-300 transition hover:bg-slate-700"
              >
                <Icon name="download" className="size-4" />
                <span>Export Excel</span>
              </button>
              {canManage ? (
                <>
                  <input
                    aria-label="Berkas Excel untuk impor peserta didik"
                    ref={importInputRef}
                    type="file"
                    accept=".xlsx,.csv"
                    className="hidden"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) void handleImport(file);
                    }}
                  />
                  <button
                    type="button"
                    disabled={bulkWorking}
                    onClick={() => importInputRef.current?.click()}
                    className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-emerald-500/40 bg-slate-800 px-4 py-2 text-sm font-semibold text-emerald-300 transition hover:bg-slate-700 disabled:opacity-50"
                  >
                    <Icon name="upload" className="size-4" />
                    <span>{bulkWorking ? "Memproses…" : "Import Excel"}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDownloadTemplate()}
                    className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-white/10 bg-slate-800 px-4 py-2 text-sm font-semibold text-slate-300 transition hover:bg-slate-700"
                  >
                    <Icon name="document" className="size-4" />
                    <span>Template</span>
                  </button>
                </>
              ) : null}
              {canResetWali ? (
                <button
                  type="button"
                  onClick={() => void handleOpenBulkSlips()}
                  className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-sky-500/40 bg-slate-800 px-4 py-2 text-sm font-semibold text-sky-300 transition hover:bg-slate-700"
                  title="Lihat status dan cetak slip kata sandi portal wali murid"
                >
                  <Icon name="lock" className="size-4" />
                  <span>Akun Wali & Cetak Slip</span>
                </button>
              ) : null}
              {canManage ? (
                <button
                  type="button"
                  onClick={handleOpenAdd}
                  className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-sky-500 px-4 py-2 text-sm font-bold text-slate-950 shadow-lg shadow-sky-500/20 transition hover:bg-sky-400"
                >
                  <Icon name="add" className="size-4" />
                  <span>Tambah Siswa</span>
                </button>
              ) : null}
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

        {/* Filter Toolbar */}
        <div className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-slate-900/60 p-4 shadow-xl backdrop-blur-xl sm:flex-row sm:items-center sm:justify-between">
          <div className="relative flex-1">
            <input
              aria-label="Cari siswa"
              type="text"
              placeholder="Cari siswa berdasarkan nama, NIS, NISN, atau nama orang tua/wali..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-xl border border-white/10 bg-slate-950/60 px-4 py-2.5 pl-10 text-sm text-slate-100 placeholder-slate-500 shadow-inner focus:border-sky-500 focus:outline-none"
            />
            <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5 text-slate-400">
              <Icon name="users" className="size-4" />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={filterRombel}
              onChange={(e) => setFilterRombel(e.target.value)}
              aria-label="Filter berdasarkan rombel"
              className="rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-sky-500 focus:outline-none"
            >
              <option value="" className="bg-slate-900 text-slate-100">
                Semua Rombel
              </option>
              {rombelList.map((r) => (
                <option
                  key={String(r.id_rombel)}
                  value={String(r.id_rombel)}
                  className="bg-slate-900 text-slate-100"
                >
                  Kelas {String(r.tingkat)} - {String(r.nama_rombel)}
                </option>
              ))}
            </select>
            <select
              value={filterUnit}
              onChange={(e) => setFilterUnit(e.target.value)}
              aria-label="Filter berdasarkan unit"
              className="rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-sky-500 focus:outline-none"
            >
              <option value="" className="bg-slate-900 text-slate-100">
                Semua Unit
              </option>
              <option
                value={TANPA_UNIT}
                className="bg-slate-900 text-slate-100"
              >
                (Tanpa unit)
              </option>
              {unitOptions.map((nama) => (
                <option
                  key={nama}
                  value={nama}
                  className="bg-slate-900 text-slate-100"
                >
                  {nama}
                </option>
              ))}
            </select>
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              aria-label="Filter status siswa"
              className="rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-sky-500 focus:outline-none"
            >
              <option value="" className="bg-slate-900 text-slate-100">
                Semua Status
              </option>
              {STATUS_SISWA.map((status) => (
                <option
                  key={status}
                  value={status}
                  className="bg-slate-900 text-slate-100"
                >
                  {status}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Directory Table */}
        <div className="overflow-hidden rounded-2xl border border-white/10 bg-slate-900/60 shadow-xl backdrop-blur-xl">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-slate-200">
              <thead className="border-b border-white/10 bg-white/[0.03] text-xs uppercase tracking-wider text-slate-400">
                <tr>
                  <th className="px-6 py-4">Peserta Didik</th>
                  <th className="px-6 py-4">NIS / NISN</th>
                  <th className="px-6 py-4">Rombel / Kelas</th>
                  <th className="px-6 py-4">Unit</th>
                  <th className="px-6 py-4">Orang Tua / Wali</th>
                  <th className="px-6 py-4">Status</th>
                  <th className="px-6 py-4 text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {loading ? (
                  <tr>
                    <td
                      colSpan={7}
                      className="px-6 py-8 text-center text-slate-400"
                    >
                      Memuat direktori siswa...
                    </td>
                  </tr>
                ) : filteredStudents.length === 0 ? (
                  <tr>
                    <td
                      colSpan={7}
                      className="px-6 py-8 text-center text-slate-400"
                    >
                      Tidak ada data siswa yang cocok dengan filter pencarian.
                    </td>
                  </tr>
                ) : (
                  filteredStudents.map((item) => {
                    const id = String(item.id_siswa);
                    const isAktif = String(item.status) === "Aktif";
                    // Nomor sudah tersimpan kanonik `+62…` oleh backend lewat
                    // `normalizeOperatorPhone`; jangan menulis ulang aturannya
                    // di sini. `wa.me` hanya menerima digit, jadi `+`-nya
                    // dilepas. Baris lama yang belum ternormalisasi tetap
                    // dinormalkan sekali di sini agar tautannya tidak rusak.
                    const waNumber = normalizeOperatorPhone(
                      String(item.no_whatsapp_wali || ""),
                    ).replace(/^\+/, "");

                    return (
                      <tr key={id} className="transition hover:bg-white/[0.02]">
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-3">
                            <div className="flex size-10 items-center justify-center rounded-xl bg-sky-500/10 text-sky-400 font-bold border border-sky-500/20">
                              {String(item.nama_lengkap || "")
                                .charAt(0)
                                .toUpperCase()}
                            </div>
                            <div>
                              <div className="font-bold text-white">
                                {String(item.nama_lengkap)}
                              </div>
                              <div className="text-xs text-slate-400">
                                {item.jenis_kelamin === "P"
                                  ? "Perempuan"
                                  : "Laki-laki"}{" "}
                                | Angkatan {String(item.angkatan || "-")}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4 font-mono text-xs text-slate-300">
                          <div>NIS: {String(item.nis || "-")}</div>
                          <div className="text-slate-400">
                            NISN: {String(item.nisn || "-")}
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <span className="inline-flex items-center rounded-lg bg-sky-500/10 px-2.5 py-1 text-xs font-semibold text-sky-400 border border-sky-500/20">
                            Kelas {String(item.tingkat || 10)} -{" "}
                            {String(item.nama_rombel || "-")}
                          </span>
                          <div className="mt-1 text-[11px] text-slate-400">
                            Jam scan: {(() => {
                              const shift = shiftById(item.id_shift);
                              return shift
                                ? shiftLabel(shift)
                                : `Shift #${String(item.id_shift ?? "-")}`;
                            })()}
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          {item.unit ? (
                            <span className="inline-flex items-center rounded-lg bg-violet-500/10 px-2.5 py-1 text-xs font-semibold text-violet-300 border border-violet-500/20">
                              {String(item.unit)}
                            </span>
                          ) : (
                            <span className="text-xs text-slate-500">—</span>
                          )}
                        </td>
                        <td className="px-6 py-4 text-xs text-slate-300">
                          <div className="font-semibold text-slate-200">
                            {String(item.nama_wali || "Belum dicatat")}
                          </div>
                          {item.no_whatsapp_wali ? (
                            <a
                              href={`https://wa.me/${waNumber}`}
                              target="_blank"
                              rel="noreferrer"
                              className="mt-0.5 inline-flex items-center gap-1 text-[11px] text-emerald-400 hover:underline"
                            >
                              <Icon name="whatsapp" className="size-3" />
                              <span>{String(item.no_whatsapp_wali)}</span>
                            </a>
                          ) : (
                            <span className="text-[11px] text-slate-400">
                              No WA belum ada
                            </span>
                          )}
                        </td>
                        <td className="px-6 py-4">
                          {isAktif ? (
                            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-400/10 px-2.5 py-0.5 text-xs font-semibold text-emerald-400">
                              <span className="size-1.5 rounded-full bg-emerald-400" />
                              Aktif
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-800 px-2.5 py-0.5 text-xs font-semibold text-slate-400">
                              <span className="size-1.5 rounded-full bg-slate-500" />
                              {String(item.status)}
                            </span>
                          )}
                        </td>
                        <td className="px-6 py-4 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => void handleShowQr(item)}
                              className="rounded-lg bg-white/5 p-2 text-sky-400 hover:bg-white/10"
                              title="Tampilkan Barcode QR Absensi"
                            >
                              <Icon name="scanner" className="size-4" />
                            </button>
                            {canResetWali ? (
                              <button
                                type="button"
                                onClick={() =>
                                  void handleOpenWaliCredential(item)
                                }
                                className="rounded-lg bg-amber-500/10 p-2 text-amber-400 hover:bg-amber-500/20"
                                title="Kelola & Reset Sandi Akun Wali"
                              >
                                <Icon name="lock" className="size-4" />
                              </button>
                            ) : null}
                            {canManage ? (
                              <>
                                <button
                                  type="button"
                                  onClick={() => handleOpenEdit(item)}
                                  className="rounded-lg bg-white/5 p-2 text-slate-300 hover:bg-white/10 hover:text-white"
                                  title="Edit Profil"
                                >
                                  <Icon name="tools" className="size-4" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => void handleDelete(id)}
                                  className="rounded-lg bg-rose-500/10 p-2 text-rose-400 hover:bg-rose-500/20"
                                  title="Hapus Siswa"
                                >
                                  <Icon name="trash" className="size-4" />
                                </button>
                              </>
                            ) : null}
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

        {/* Modal Form Tambah/Edit Siswa */}
        {showModal ? (
          <Modal
            isOpen={true}
            onClose={() => setShowModal(false)}
            title={isEditing ? "Edit Data Peserta Didik" : "Tambah Siswa Baru"}
            maxWidth="max-w-xl"
          >
            <form
              onSubmit={(e) => void handleSave(e)}
              className="flex flex-col gap-4 py-2"
            >
              <div>
                <label
                  htmlFor="siswa-id"
                  className="block text-xs font-semibold text-slate-300"
                >
                  ID Unik
                </label>
                <input
                  id="siswa-id"
                  type="text"
                  value={formData.id_siswa || ""}
                  readOnly={isEditing}
                  disabled={isEditing}
                  placeholder="Kosongkan untuk dibuatkan otomatis"
                  onChange={(e) =>
                    setFormData({ ...formData, id_siswa: e.target.value })
                  }
                  className="mt-1 w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-2 font-mono text-sm text-slate-100 focus:border-sky-500 focus:outline-none disabled:cursor-not-allowed disabled:text-slate-400"
                />
                <p className="mt-1 text-xs text-slate-500">
                  {isEditing
                    ? "ID tidak dapat diubah. Ia menjadi kunci absensi, kartu, nilai, dan QR yang sudah tercetak."
                    : "Boleh diisi sendiri. Dikosongkan berarti sistem yang membuatkannya."}
                </p>
              </div>
              <div>
                <label
                  htmlFor="siswa-unit"
                  className="block text-xs font-semibold text-slate-300"
                >
                  Unit
                </label>
                <select
                  id="siswa-unit"
                  value={formData.unit || ""}
                  onChange={(e) =>
                    setFormData({ ...formData, unit: e.target.value })
                  }
                  className="mt-1 w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-sky-500 focus:outline-none"
                >
                  <option value="">Tidak ditentukan</option>
                  {unitList.map((u) => (
                    <option
                      key={String(u.id_unit)}
                      value={String(u.nama_unit)}
                      className="bg-slate-900"
                    >
                      {String(u.nama_unit)}
                    </option>
                  ))}
                </select>
                {unitList.length === 0 ? (
                  <p className="mt-1 text-xs text-slate-500">
                    Belum ada unit. Tambahkan lewat menu Akademik → Unit.
                  </p>
                ) : null}
              </div>
              <div>
                <label
                  htmlFor="siswa-nama"
                  className="block text-xs font-semibold text-slate-300"
                >
                  Nama Lengkap Siswa
                </label>
                <input
                  id="siswa-nama"
                  type="text"
                  required
                  value={formData.nama_lengkap}
                  onChange={(e) =>
                    setFormData({ ...formData, nama_lengkap: e.target.value })
                  }
                  className="mt-1 w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-sky-500 focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label
                    htmlFor="siswa-nis"
                    className="block text-xs font-semibold text-slate-300"
                  >
                    NIS (Nomor Induk Siswa)
                  </label>
                  <input
                    id="siswa-nis"
                    type="text"
                    value={formData.nis || ""}
                    onChange={(e) =>
                      setFormData({ ...formData, nis: e.target.value })
                    }
                    className="mt-1 w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-sky-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label
                    htmlFor="siswa-nisn"
                    className="block text-xs font-semibold text-slate-300"
                  >
                    NISN (Nomor Induk Siswa Nasional)
                  </label>
                  <input
                    id="siswa-nisn"
                    type="text"
                    value={formData.nisn || ""}
                    onChange={(e) =>
                      setFormData({ ...formData, nisn: e.target.value })
                    }
                    className="mt-1 w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-sky-500 focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label
                    htmlFor="siswa-jk"
                    className="block text-xs font-semibold text-slate-300"
                  >
                    Jenis Kelamin
                  </label>
                  <select
                    id="siswa-jk"
                    value={formData.jenis_kelamin || "L"}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        jenis_kelamin: e.target.value as "L" | "P",
                      })
                    }
                    className="mt-1 w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-sky-500 focus:outline-none"
                  >
                    <option value="L" className="bg-slate-900 text-slate-100">
                      Laki-laki
                    </option>
                    <option value="P" className="bg-slate-900 text-slate-100">
                      Perempuan
                    </option>
                  </select>
                </div>
                <div className="col-span-2">
                  <label
                    htmlFor="siswa-rombel"
                    className="block text-xs font-semibold text-slate-300"
                  >
                    Rombel / Kelas
                  </label>
                  <select
                    id="siswa-rombel"
                    required
                    value={formData.id_rombel}
                    onChange={(e) =>
                      setFormData({ ...formData, id_rombel: e.target.value })
                    }
                    className="mt-1 w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-sky-500 focus:outline-none"
                  >
                    {rombelList.map((r) => (
                      <option
                        key={String(r.id_rombel)}
                        value={String(r.id_rombel)}
                        className="bg-slate-900 text-slate-100"
                      >
                        Kelas {String(r.tingkat)} - {String(r.nama_rombel)}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label
                    htmlFor="siswa-wali"
                    className="block text-xs font-semibold text-slate-300"
                  >
                    Nama Orang Tua / Wali
                  </label>
                  <input
                    id="siswa-wali"
                    type="text"
                    value={formData.nama_wali || ""}
                    onChange={(e) =>
                      setFormData({ ...formData, nama_wali: e.target.value })
                    }
                    className="mt-1 w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-sky-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label
                    htmlFor="siswa-wa-wali"
                    className="block text-xs font-semibold text-slate-300"
                  >
                    No. WhatsApp Wali Murid
                  </label>
                  <input
                    id="siswa-wa-wali"
                    type="text"
                    placeholder="08123456789"
                    value={formData.no_whatsapp_wali || ""}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        no_whatsapp_wali: e.target.value,
                      })
                    }
                    className="mt-1 w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-sky-500 focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label
                    htmlFor="siswa-angkatan"
                    className="block text-xs font-semibold text-slate-300"
                  >
                    Tahun Angkatan Masuk
                  </label>
                  <input
                    id="siswa-angkatan"
                    type="number"
                    min={2000}
                    max={2100}
                    value={formData.angkatan || 2026}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        angkatan: Number(e.target.value),
                      })
                    }
                    className="mt-1 w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-sky-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label
                    htmlFor="siswa-status"
                    className="block text-xs font-semibold text-slate-300"
                  >
                    Status Siswa
                  </label>
                  <select
                    id="siswa-status"
                    value={formData.status || "Aktif"}
                    onChange={(e) =>
                      setFormData({ ...formData, status: e.target.value })
                    }
                    className="mt-1 w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-sky-500 focus:outline-none"
                  >
                    {STATUS_SISWA.map((status) => (
                      <option
                        key={status}
                        value={status}
                        className="bg-slate-900 text-slate-100"
                      >
                        {status}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label
                  htmlFor="siswa-shift"
                  className="block text-xs font-semibold text-slate-300"
                >
                  Shift / Jam Scan
                </label>
                <select
                  id="siswa-shift"
                  value={formData.id_shift ?? ""}
                  disabled={shiftList.length === 0}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      id_shift: e.target.value
                        ? Number(e.target.value)
                        : undefined,
                    })
                  }
                  className="mt-1 w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-sky-500 focus:outline-none disabled:opacity-60"
                >
                  {formData.id_shift === undefined ? (
                    <option value="" className="bg-slate-900 text-slate-100">
                      {formData.id_siswa
                        ? "Pertahankan shift saat ini"
                        : "Shift bawaan (shift 1)"}
                    </option>
                  ) : null}
                  {shiftList.map((s) => (
                    <option
                      key={Number(s.id_shift)}
                      value={Number(s.id_shift)}
                      className="bg-slate-900 text-slate-100"
                    >
                      {shiftLabel(s)}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-[11px] text-slate-400">
                  {shiftError ??
                    (shiftList.length === 0
                      ? "Belum ada shift. Buat shift khusus siswa di menu Shift agar jam scan-nya sesuai jadwal sekolah."
                      : "Scan masuk hanya diterima di sekitar jam masuk shift ini. Jam dan toleransinya diatur di menu Shift.")}
                </p>
              </div>

              <div>
                <label
                  htmlFor="siswa-alamat"
                  className="block text-xs font-semibold text-slate-300"
                >
                  Alamat Tempat Tinggal
                </label>
                <textarea
                  id="siswa-alamat"
                  rows={2}
                  value={formData.alamat || ""}
                  onChange={(e) =>
                    setFormData({ ...formData, alamat: e.target.value })
                  }
                  className="mt-1 w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-sky-500 focus:outline-none"
                />
              </div>

              <div className="mt-4 flex items-center justify-end gap-2 border-t border-white/10 pt-4">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="rounded-xl border border-white/10 px-4 py-2 text-sm font-semibold text-slate-300 hover:bg-white/5"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-xl bg-sky-500 px-5 py-2 text-sm font-bold text-slate-950 shadow-lg shadow-sky-500/20 hover:bg-sky-400 disabled:opacity-50"
                >
                  {saving ? "Menyimpan..." : "Simpan Siswa"}
                </button>
              </div>
            </form>
          </Modal>
        ) : null}

        {/* QR Code Preview Modal */}
        {qrModalData ? (
          <Modal
            isOpen={true}
            onClose={() => setQrModalData(null)}
            title="Kartu Barcode QR Siswa"
            maxWidth="max-w-sm"
          >
            <div className="flex flex-col items-center gap-4 py-4 text-center">
              <div className="relative size-64 overflow-hidden rounded-2xl bg-white p-3 shadow-2xl">
                <Image
                  src={qrModalData.qrPng}
                  alt={`QR Absensi ${qrModalData.nama}`}
                  fill
                  unoptimized
                  className="object-contain p-2"
                />
              </div>
              <div>
                <h4 className="text-base font-black text-white">
                  {qrModalData.nama}
                </h4>
                <p className="font-mono text-xs text-sky-400">
                  NIS: {qrModalData.nis}
                </p>
                <p className="text-xs text-slate-400">{qrModalData.rombel}</p>
              </div>
              <p className="text-xs text-slate-400">
                Pindai barcode ini di scanner gerbang saat masuk dan pulang
                sekolah.
              </p>
              <button
                type="button"
                onClick={() => setQrModalData(null)}
                className="mt-2 w-full rounded-xl bg-slate-800 py-2 text-sm font-semibold text-slate-200 hover:bg-slate-700"
              >
                Tutup
              </button>
            </div>
          </Modal>
        ) : null}
        {/* Modal Status & Reset Kredensial Wali */}
        {waliModalData ? (
          <Modal
            isOpen={true}
            onClose={() => setWaliModalData(null)}
            title="Kelola Akun Portal Wali Murid"
            subtitle={String(waliModalData.student.nama_lengkap || "")}
            maxWidth="max-w-md"
          >
            <div className="flex flex-col gap-4 py-2 text-sm">
              {waliModalData.loading ? (
                <div className="flex flex-col items-center justify-center py-8 text-slate-400">
                  <div className="size-8 animate-spin rounded-full border-2 border-sky-500 border-t-transparent" />
                  <p className="mt-2 text-xs">Memeriksa status akun wali...</p>
                </div>
              ) : waliModalData.statusInfo ? (
                <>
                  <div className="rounded-2xl border border-white/10 bg-slate-950/60 p-4">
                    <div className="text-xs text-slate-400">
                      Status Akun Portal
                    </div>
                    <div className="mt-1.5 flex items-center gap-2">
                      {waliModalData.statusInfo.status === "diubah" ? (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-400/10 px-2.5 py-1 text-xs font-semibold text-emerald-400">
                          <span className="size-1.5 rounded-full bg-emerald-400" />
                          Kata Sandi Sudah Diubah Wali
                        </span>
                      ) : waliModalData.statusInfo.status === "bawaan" ? (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-400/10 px-2.5 py-1 text-xs font-semibold text-amber-400">
                          <span className="size-1.5 rounded-full bg-amber-400" />
                          Masih Menggunakan Sandi Bawaan
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-sky-400/10 px-2.5 py-1 text-xs font-semibold text-sky-400">
                          <span className="size-1.5 rounded-full bg-sky-400" />
                          Belum Ada Kredensial (Otomatis Bawaan)
                        </span>
                      )}
                    </div>
                    {waliModalData.statusInfo.changedAt ? (
                      <p className="mt-2 text-[11px] text-slate-400">
                        Terakhir diubah: {waliModalData.statusInfo.changedAt}
                      </p>
                    ) : null}
                  </div>

                  <div className="rounded-2xl border border-white/10 bg-slate-950/60 p-4">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-slate-400">
                        Kata Sandi Bawaan
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          void handleCopyPassword(
                            waliModalData.statusInfo?.defaultPassword || "",
                            "single",
                          )
                        }
                        className="text-xs font-medium text-sky-400 hover:underline"
                      >
                        {copiedId === "single" ? "Tersalin!" : "Salin"}
                      </button>
                    </div>
                    <div className="mt-2 rounded-xl border border-white/5 bg-slate-900 px-3 py-2 font-mono text-base font-bold text-sky-300 select-all">
                      {waliModalData.statusInfo.defaultPassword}
                    </div>
                    <p className="mt-2 text-[11px] text-slate-400">
                      Formula bawaan:{" "}
                      <code className="text-slate-300">NISN/NIS + UNIT</code>{" "}
                      (huruf besar). Wali wajib mengganti kata sandi saat
                      pertama kali masuk portal jika masih berstatus bawaan.
                    </p>
                  </div>

                  <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4 text-xs text-amber-200/90">
                    <div className="flex items-start gap-2">
                      <Icon
                        name="alert"
                        className="mt-0.5 size-4 shrink-0 text-amber-400"
                      />
                      <div>
                        <span className="font-bold text-amber-300">
                          Peringatan Reset:
                        </span>{" "}
                        Mereset kata sandi akan mengembalikan sandi ke nilai
                        bawaan di atas dan{" "}
                        <strong>
                          seketika mengeluarkan (revoke) semua sesi login wali
                          murid
                        </strong>{" "}
                        yang sedang aktif di perangkat lain.
                      </div>
                    </div>
                  </div>

                  <div className="mt-2 flex items-center justify-end gap-2 border-t border-white/10 pt-4">
                    <button
                      type="button"
                      onClick={() => setWaliModalData(null)}
                      className="rounded-xl border border-white/10 px-4 py-2 text-sm font-semibold text-slate-300 hover:bg-white/5"
                    >
                      Tutup
                    </button>
                    <button
                      type="button"
                      disabled={waliModalData.resetting}
                      onClick={() => void handleResetSingleWali()}
                      className="inline-flex items-center gap-2 rounded-xl bg-amber-500 px-4 py-2 text-sm font-bold text-slate-950 shadow-lg shadow-amber-500/20 transition hover:bg-amber-400 disabled:opacity-50"
                    >
                      <Icon name="reset" className="size-4" />
                      <span>
                        {waliModalData.resetting
                          ? "Mereset..."
                          : "Reset ke Sandi Bawaan"}
                      </span>
                    </button>
                  </div>
                </>
              ) : null}
            </div>
          </Modal>
        ) : null}

        {/* Modal Cetak Slip Kredensial Wali */}
        {showBulkSlipModal ? (
          <Modal
            isOpen={true}
            onClose={() => setShowBulkSlipModal(false)}
            title="Slip Kredensial Portal Wali Murid"
            subtitle={`${bulkSlips.length} siswa siap dicetak`}
            maxWidth="max-w-4xl"
          >
            <div className="flex flex-col gap-4 py-2">
              {/* Toolbar Aksi Atas */}
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-slate-950/60 p-4 print:hidden">
                <div className="text-xs text-slate-300">
                  Menampilkan{" "}
                  <strong className="text-white">{bulkSlips.length}</strong>{" "}
                  siswa sesuai filter yang aktif.
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={bulkIssuing || bulkSlipLoading}
                    onClick={() => void handleExecuteBulkIssue()}
                    className="inline-flex items-center gap-2 rounded-xl border border-emerald-500/40 bg-emerald-950/40 px-3 py-1.5 text-xs font-semibold text-emerald-300 transition hover:bg-emerald-900/50 disabled:opacity-50"
                    title="Buatkan baris kredensial awal bagi siswa yang belum punya"
                  >
                    <Icon name="add" className="size-3.5" />
                    <span>
                      {bulkIssuing ? "Menerbitkan..." : "Terbitkan Massal"}
                    </span>
                  </button>
                  <button
                    type="button"
                    disabled={bulkSlips.length === 0 || bulkSlipLoading}
                    onClick={() => window.print()}
                    className="inline-flex items-center gap-2 rounded-xl bg-sky-500 px-3.5 py-1.5 text-xs font-bold text-slate-950 shadow-md shadow-sky-500/20 transition hover:bg-sky-400 disabled:opacity-50"
                  >
                    <Icon name="document" className="size-3.5" />
                    <span>Cetak Slip (PDF / Printer)</span>
                  </button>
                </div>
              </div>

              {/* Status Loading */}
              {bulkSlipLoading ? (
                <div className="flex flex-col items-center justify-center py-12 text-slate-400">
                  <div className="size-8 animate-spin rounded-full border-2 border-sky-500 border-t-transparent" />
                  <p className="mt-2 text-xs">
                    Memuat daftar kredensial siswa...
                  </p>
                </div>
              ) : bulkSlips.length === 0 ? (
                <div className="rounded-2xl border border-white/10 bg-slate-950/40 p-8 text-center text-sm text-slate-400">
                  Tidak ada data siswa untuk dicetak. Sesuaikan filter rombel
                  atau pencarian.
                </div>
              ) : (
                <>
                  {/* Container Cetak */}
                  <div
                    id="printable-wali-slips"
                    className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-h-[60vh] overflow-y-auto p-1"
                  >
                    {bulkSlips.map((slip) => {
                      const id = slip.idSiswa;
                      return (
                        <div
                          key={id}
                          className="slip-card flex flex-col justify-between rounded-2xl border border-dashed border-white/20 bg-slate-950/80 p-4 transition"
                        >
                          <div>
                            <div className="flex items-start justify-between border-b border-white/10 pb-2.5">
                              <div>
                                <span className="text-[10px] font-bold uppercase tracking-wider text-sky-400">
                                  Kredensial Portal Wali Murid
                                </span>
                                <h5 className="font-bold text-white text-sm">
                                  {slip.namaSiswa}
                                </h5>
                              </div>
                              <span className="rounded-md bg-white/5 px-2 py-0.5 text-[10px] font-semibold text-slate-400">
                                {slip.unit || "Umum"}
                              </span>
                            </div>

                            <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                              <div>
                                <span className="text-slate-400 text-[11px]">
                                  NIS / NISN:
                                </span>
                                <p className="font-mono font-medium text-slate-200">
                                  {slip.nis || "-"}
                                  {slip.nisn ? ` / ${slip.nisn}` : ""}
                                </p>
                              </div>
                              <div>
                                <span className="text-slate-400 text-[11px]">
                                  Kelas / Rombel:
                                </span>
                                <p className="font-medium text-slate-200">
                                  {slip.rombel || "-"}
                                </p>
                              </div>
                            </div>

                            <div className="mt-3">
                              <span className="text-slate-400 text-[11px]">
                                Alamat Portal:
                              </span>
                              <p className="font-mono text-xs text-sky-300">
                                /wali{" "}
                                <span className="text-[10px] text-slate-400">
                                  (Menu Masuk dengan Sandi)
                                </span>
                              </p>
                            </div>

                            <div className="slip-password-box mt-3 rounded-xl border border-white/10 bg-slate-900/90 p-2.5">
                              <div className="flex items-center justify-between">
                                <span className="text-[11px] font-semibold text-slate-400">
                                  Kata Sandi Awal:
                                </span>
                                <span className="text-[10px] text-amber-400">
                                  {slip.status === "diubah"
                                    ? "(Pernah diubah)"
                                    : "(Sandi Bawaan)"}
                                </span>
                              </div>
                              <div className="mt-1 font-mono text-sm font-black text-amber-300 select-all tracking-wider">
                                {slip.defaultPassword}
                              </div>
                            </div>
                          </div>

                          <div className="mt-3 border-t border-dashed border-white/10 pt-2 text-[10px] text-slate-400">
                            * Wali murid wajib mengganti kata sandi saat pertama
                            kali masuk ke portal. Harap jaga kerahasiaan slip
                            ini.
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <style>{`
                    @media print {
                      body * {
                        visibility: hidden !important;
                      }
                      #printable-wali-slips, #printable-wali-slips * {
                        visibility: visible !important;
                      }
                      #printable-wali-slips {
                        position: absolute !important;
                        left: 0 !important;
                        top: 0 !important;
                        width: 100% !important;
                        max-height: none !important;
                        overflow: visible !important;
                        margin: 0 !important;
                        padding: 16px !important;
                        background: #ffffff !important;
                        color: #000000 !important;
                        display: grid !important;
                        grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
                        gap: 16px !important;
                        page-break-inside: avoid !important;
                      }
                      .slip-card {
                        border: 1.5px dashed #475569 !important;
                        background: #f8fafc !important;
                        color: #0f172a !important;
                        page-break-inside: avoid !important;
                        break-inside: avoid !important;
                        box-shadow: none !important;
                        padding: 14px !important;
                      }
                      .slip-card h5 {
                        color: #0f172a !important;
                      }
                      .slip-card p, .slip-card span, .slip-card div {
                        color: #334155 !important;
                      }
                      .slip-password-box {
                        background: #e2e8f0 !important;
                        border: 1px solid #cbd5e1 !important;
                      }
                      .slip-password-box div {
                        color: #0f172a !important;
                      }
                    }
                  `}</style>
                </>
              )}

              <div className="mt-2 flex items-center justify-end border-t border-white/10 pt-4 print:hidden">
                <button
                  type="button"
                  onClick={() => setShowBulkSlipModal(false)}
                  className="rounded-xl border border-white/10 px-5 py-2 text-sm font-semibold text-slate-300 hover:bg-white/5"
                >
                  Tutup
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
