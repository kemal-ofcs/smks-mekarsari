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
  downloadTeacherTemplate,
  exportTeachers,
  readTeacherWorkbook,
  runPersonnelImport,
} from "@/lib/client/personnel-workbook";
import { createQrPng, employeeQrPayload } from "@/lib/client/qr-code";
import { useAuth } from "@/lib/context/AuthContext";
import { getDaftarShift } from "@/lib/gateways/shift";
import { syncNow } from "@/lib/gateways/sync-status";
import {
  type GuruInput,
  getDaftarGuru,
  hapusGuru,
  simpanGuru,
} from "@/lib/gateways/teacher";
import { useConfirmDialog } from "@/lib/hooks/useConfirmDialog";
import { shiftLabel } from "@/lib/validations/personnel";

export default function GuruPage() {
  const { konfirmasi, dialogKonfirmasi } = useConfirmDialog();
  const { user, isAuthenticated, isLoading: authLoading } = useAuth();
  const canManage = hasPermission(user, "teachers.manage");

  const [guruList, setGuruList] = useState<Record<string, unknown>[]>([]);
  const [shiftList, setShiftList] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);
  const [bulkWorking, setBulkWorking] = useState(false);
  const importInputRef = useRef<HTMLInputElement>(null);
  const isSubmittingRef = useRef(false);
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [filterKepegawaian, setFilterKepegawaian] = useState("");

  const [feedback, setFeedback] = useState<{
    tone: "success" | "error" | "warning";
    message: string;
  } | null>(null);

  // Modal State
  const [showModal, setShowModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formData, setFormData] = useState<GuruInput>({
    id_guru: "",
    nama: "",
    nip: "",
    nuptk: "",
    gelar: "",
    spesialisasi_mapel: "",
    status_kepegawaian: "Honorer",
    no_hp: "",
    lp: "L",
    id_shift: 1,
    status_aktif: "Aktif",
  });

  // QR Modal State
  const [qrModalData, setQrModalData] = useState<{
    nama: string;
    nip: string;
    qrPng: string;
  } | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [gData, sData] = await Promise.all([
        getDaftarGuru(),
        getDaftarShift(),
      ]);
      setGuruList(gData);
      setShiftList(sData);
    } catch (err) {
      setFeedback({
        tone: "error",
        message: err instanceof Error ? err.message : "Gagal memuat data guru.",
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    const handleSync = () => {
      void loadData();
    };
    window.addEventListener("sppg:sync-completed", handleSync);
    return () => window.removeEventListener("sppg:sync-completed", handleSync);
  }, [loadData]);

  const filteredTeachers = useMemo(() => {
    return guruList.filter((item) => {
      const nama = String(item.nama || "").toLowerCase();
      const nip = String(item.nip || "").toLowerCase();
      const nuptk = String(item.nuptk || "").toLowerCase();
      const mapel = String(item.spesialisasi_mapel || "").toLowerCase();
      const q = search.toLowerCase().trim();

      if (
        q &&
        !nama.includes(q) &&
        !nip.includes(q) &&
        !nuptk.includes(q) &&
        !mapel.includes(q)
      ) {
        return false;
      }
      if (filterStatus && String(item.status_aktif) !== filterStatus) {
        return false;
      }
      if (
        filterKepegawaian &&
        String(item.status_kepegawaian) !== filterKepegawaian
      ) {
        return false;
      }
      return true;
    });
  }, [guruList, search, filterStatus, filterKepegawaian]);

  const handleOpenAdd = () => {
    setFormData({
      id_guru: "",
      nama: "",
      nip: "",
      nuptk: "",
      gelar: "",
      spesialisasi_mapel: "",
      status_kepegawaian: "Honorer",
      no_hp: "",
      lp: "L",
      id_shift: shiftList[0] ? Number(shiftList[0].id_shift) : 1,
      status_aktif: "Aktif",
    });
    setShowModal(true);
  };

  const handleOpenEdit = (item: Record<string, unknown>) => {
    setFormData({
      id_guru: String(item.id_guru),
      nama: String(item.nama),
      nip: item.nip ? String(item.nip) : "",
      nuptk: item.nuptk ? String(item.nuptk) : "",
      gelar: item.gelar ? String(item.gelar) : "",
      spesialisasi_mapel: item.spesialisasi_mapel
        ? String(item.spesialisasi_mapel)
        : "",
      status_kepegawaian: item.status_kepegawaian
        ? String(item.status_kepegawaian)
        : "Honorer",
      no_hp: item.no_hp ? String(item.no_hp) : "",
      lp: item.lp ? String(item.lp) : "L",
      id_shift: Number(item.id_shift || 1),
      status_aktif: item.status_aktif ? String(item.status_aktif) : "Aktif",
    });
    setShowModal(true);
  };

  const handleDelete = async (id: string) => {
    if (!canManage) return;
    const ok = await konfirmasi({
      title: "Hapus profil guru ini?",
      description:
        "Profil guru dinonaktifkan dan hilang dari daftar. Penghapusannya ikut tersinkronisasi ke seluruh perangkat.",
      preserved:
        "Riwayat absensi, jurnal mengajar, dan presensi kelas yang pernah ia catat tetap tersimpan.",
      confirmLabel: "Ya, hapus",
    });
    if (!ok) return;

    // Penjaga klik ganda dipasang SETELAH konfirmasi: dialognya sendiri sudah
    // menahan klik kedua, dan mengunci sebelum itu membuat pembatalan
    // meninggalkan penjaga yang tidak pernah dilepas.
    if (isSubmittingRef.current) return;
    isSubmittingRef.current = true;

    try {
      await hapusGuru(id);
      setFeedback({
        tone: "success",
        message: "Profil guru berhasil dihapus.",
      });
      void loadData();
    } catch (err) {
      setFeedback({
        tone: "error",
        message:
          err instanceof Error ? err.message : "Gagal menghapus profil guru.",
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
    const payload = employeeQrPayload({ ...item, id_unik: item.id_guru });

    try {
      const png = await createQrPng(payload, 400);
      setQrModalData({
        nama: String(item.nama) + (item.gelar ? `, ${String(item.gelar)}` : ""),
        nip: String(item.nip || item.nuptk || item.kode_karyawan || "-"),
        qrPng: png,
      });
    } catch {
      setFeedback({
        tone: "error",
        message: "Gagal membuat barcode QR absensi guru.",
      });
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManage || isSubmittingRef.current) return;
    isSubmittingRef.current = true;
    setSaving(true);
    try {
      await simpanGuru(formData);
      setFeedback({ tone: "success", message: "Data guru berhasil disimpan." });
      setShowModal(false);
      void loadData();
    } catch (err) {
      setFeedback({
        tone: "error",
        message:
          err instanceof Error ? err.message : "Gagal menyimpan data guru.",
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
      const baris = await readTeacherWorkbook(file, { shifts: shiftList });
      const report = await runPersonnelImport(baris, (draft) =>
        simpanGuru(draft, { tundaSinkronisasi: true }),
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
        message: describeImportReport(report, "guru") + catatanSinkron,
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
        await exportTeachers(filteredTeachers, shiftList),
        "Data guru",
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
      reportSaved(await downloadTeacherTemplate(shiftList), "Template impor");
    } catch (err) {
      setFeedback({
        tone: "error",
        message:
          err instanceof Error ? err.message : "Gagal mengunduh template.",
      });
    }
  };

  // Gerbang area: setiap halaman lain melakukan hal yang sama. Backend sudah
  // menegakkan izinnya lewat require_permission/requireWebPermission, tetapi
  // tanpa ini halaman data guru tetap terbuka lewat URL bagi role yang tidak
  // berhak dan hanya menampilkan banner error.
  if (authLoading) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-6 text-slate-100 font-sans">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 border-4 border-sky-500 border-t-transparent rounded-full animate-spin"></div>
          <p className="text-xs text-slate-400 font-mono animate-pulse">
            Memuat Data Guru & PTK...
          </p>
        </div>
      </div>
    );
  }
  if (!isAuthenticated) redirect("/login");
  if (!canAccessArea(user, "guru")) redirect("/forbidden");

  return (
    <AppShell>
      <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6 px-4 py-6 sm:px-6">
        <PageHeader
          eyebrow="PTK"
          title="Master Data Guru & PTK"
          description="Direktori pendidik dan tenaga kependidikan sekolah serta identitas kartu barcode."
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
                    aria-label="Berkas Excel untuk impor guru"
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
              {canManage ? (
                <button
                  type="button"
                  onClick={handleOpenAdd}
                  className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-sky-500 px-4 py-2 text-sm font-bold text-slate-950 shadow-lg shadow-sky-500/20 transition hover:bg-sky-400"
                >
                  <Icon name="add" className="size-4" />
                  <span>Tambah Guru</span>
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
              aria-label="Cari guru"
              type="text"
              placeholder="Cari guru berdasarkan nama, NIP, NUPTK, atau bidang mapel..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-xl border border-white/10 bg-slate-950/60 px-4 py-2.5 pl-10 text-sm text-slate-100 placeholder-slate-500 shadow-inner focus:border-sky-500 focus:outline-none"
            />
            <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5 text-slate-400">
              <Icon name="user" className="size-4" />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={filterKepegawaian}
              onChange={(e) => setFilterKepegawaian(e.target.value)}
              aria-label="Filter status kepegawaian"
              className="rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-sky-500 focus:outline-none"
            >
              <option value="" className="bg-slate-900 text-slate-100">
                Semua Kepegawaian
              </option>
              <option value="PNS" className="bg-slate-900 text-slate-100">
                PNS
              </option>
              <option value="PPPK" className="bg-slate-900 text-slate-100">
                PPPK
              </option>
              <option value="GTY" className="bg-slate-900 text-slate-100">
                GTY (Tetap Yayasan)
              </option>
              <option value="GTT" className="bg-slate-900 text-slate-100">
                GTT (Tidak Tetap)
              </option>
              <option value="Honorer" className="bg-slate-900 text-slate-100">
                Honorer
              </option>
              <option value="Kontrak" className="bg-slate-900 text-slate-100">
                Kontrak
              </option>
            </select>
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              aria-label="Filter status keaktifan"
              className="rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-sky-500 focus:outline-none"
            >
              <option value="" className="bg-slate-900 text-slate-100">
                Semua Status
              </option>
              <option value="Aktif" className="bg-slate-900 text-slate-100">
                Aktif
              </option>
              <option value="Nonaktif" className="bg-slate-900 text-slate-100">
                Nonaktif
              </option>
            </select>
          </div>
        </div>

        {/* Directory Table */}
        <div className="overflow-hidden rounded-2xl border border-white/10 bg-slate-900/60 shadow-xl backdrop-blur-xl">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-slate-200">
              <thead className="border-b border-white/10 bg-white/[0.03] text-xs uppercase tracking-wider text-slate-400">
                <tr>
                  <th className="px-6 py-4">Guru / Tenaga Pengajar</th>
                  <th className="px-6 py-4">NIP / NUPTK</th>
                  <th className="px-6 py-4">Spesialisasi Mapel</th>
                  <th className="px-6 py-4">Kepegawaian</th>
                  <th className="px-6 py-4">Kontak & Shift</th>
                  <th className="px-6 py-4 text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {loading ? (
                  <tr>
                    <td
                      colSpan={6}
                      className="px-6 py-8 text-center text-slate-400"
                    >
                      Memuat direktori guru...
                    </td>
                  </tr>
                ) : filteredTeachers.length === 0 ? (
                  <tr>
                    <td
                      colSpan={6}
                      className="px-6 py-8 text-center text-slate-400"
                    >
                      Tidak ada data guru yang cocok dengan filter pencarian.
                    </td>
                  </tr>
                ) : (
                  filteredTeachers.map((item) => {
                    const id = String(item.id_guru);
                    const gelar = item.gelar ? `, ${String(item.gelar)}` : "";
                    const isAktif = String(item.status_aktif) === "Aktif";
                    return (
                      <tr key={id} className="transition hover:bg-white/[0.02]">
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-3">
                            <div className="flex size-10 items-center justify-center rounded-xl bg-sky-500/10 text-sky-400 font-bold border border-sky-500/20">
                              {String(item.nama || "")
                                .charAt(0)
                                .toUpperCase()}
                            </div>
                            <div>
                              <div className="font-bold text-white">
                                {String(item.nama)}
                                {gelar}
                              </div>
                              <div className="text-xs text-slate-400">
                                {item.lp === "P" ? "Perempuan" : "Laki-laki"}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4 font-mono text-xs text-slate-300">
                          <div>NIP: {String(item.nip || "-")}</div>
                          <div className="text-slate-400">
                            NUPTK: {String(item.nuptk || "-")}
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <span className="inline-flex items-center rounded-lg bg-sky-500/10 px-2.5 py-1 text-xs font-semibold text-sky-400 border border-sky-500/20">
                            {String(item.spesialisasi_mapel || "Umum")}
                          </span>
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex flex-col gap-1">
                            <span className="text-xs font-bold text-slate-200">
                              {String(item.status_kepegawaian || "Honorer")}
                            </span>
                            {isAktif ? (
                              <span className="inline-flex items-center gap-1 text-[11px] text-emerald-400">
                                <span className="size-1.5 rounded-full bg-emerald-400" />
                                Aktif
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-[11px] text-slate-400">
                                <span className="size-1.5 rounded-full bg-slate-500" />
                                Nonaktif
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-6 py-4 text-xs text-slate-300">
                          <div>{String(item.no_hp || "-")}</div>
                          <div className="text-slate-400">
                            Jam scan: {(() => {
                              const shift = shiftList.find(
                                (s) =>
                                  Number(s.id_shift) === Number(item.id_shift),
                              );
                              return shift
                                ? shiftLabel(shift)
                                : `Shift #${String(item.id_shift || 1)}`;
                            })()}
                          </div>
                        </td>
                        <td className="px-6 py-4 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => void handleShowQr(item)}
                              className="rounded-lg bg-white/5 p-2 text-sky-400 hover:bg-white/10"
                              title="Tampilkan Barcode QR"
                            >
                              <Icon name="scanner" className="size-4" />
                            </button>
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
                                  title="Hapus Guru"
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

        {/* Modal Form Tambah/Edit Guru */}
        {showModal ? (
          <Modal
            isOpen={true}
            onClose={() => setShowModal(false)}
            title={
              formData.id_guru
                ? "Edit Data Guru / PTK"
                : "Tambah Guru / PTK Baru"
            }
            maxWidth="max-w-xl"
          >
            <form
              onSubmit={(e) => void handleSave(e)}
              className="flex flex-col gap-4 py-2"
            >
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2">
                  <label
                    htmlFor="guru-nama"
                    className="block text-xs font-semibold text-slate-300"
                  >
                    Nama Lengkap (tanpa gelar)
                  </label>
                  <input
                    id="guru-nama"
                    type="text"
                    required
                    value={formData.nama}
                    onChange={(e) =>
                      setFormData({ ...formData, nama: e.target.value })
                    }
                    className="mt-1 w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-sky-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label
                    htmlFor="guru-gelar"
                    className="block text-xs font-semibold text-slate-300"
                  >
                    Gelar (cth: S.Pd.)
                  </label>
                  <input
                    id="guru-gelar"
                    type="text"
                    value={formData.gelar || ""}
                    onChange={(e) =>
                      setFormData({ ...formData, gelar: e.target.value })
                    }
                    className="mt-1 w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-sky-500 focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label
                    htmlFor="guru-nip"
                    className="block text-xs font-semibold text-slate-300"
                  >
                    NIP (Nomor Induk Pegawai)
                  </label>
                  <input
                    id="guru-nip"
                    type="text"
                    value={formData.nip || ""}
                    onChange={(e) =>
                      setFormData({ ...formData, nip: e.target.value })
                    }
                    className="mt-1 w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-sky-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label
                    htmlFor="guru-nuptk"
                    className="block text-xs font-semibold text-slate-300"
                  >
                    NUPTK
                  </label>
                  <input
                    id="guru-nuptk"
                    type="text"
                    value={formData.nuptk || ""}
                    onChange={(e) =>
                      setFormData({ ...formData, nuptk: e.target.value })
                    }
                    className="mt-1 w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-sky-500 focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label
                    htmlFor="guru-mapel"
                    className="block text-xs font-semibold text-slate-300"
                  >
                    Spesialisasi Mata Pelajaran
                  </label>
                  <input
                    id="guru-mapel"
                    type="text"
                    placeholder="cth: Pemrograman Web"
                    value={formData.spesialisasi_mapel || ""}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        spesialisasi_mapel: e.target.value,
                      })
                    }
                    className="mt-1 w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-sky-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label
                    htmlFor="guru-status-peg"
                    className="block text-xs font-semibold text-slate-300"
                  >
                    Status Kepegawaian
                  </label>
                  <select
                    id="guru-status-peg"
                    value={formData.status_kepegawaian || "Honorer"}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        status_kepegawaian: e.target.value,
                      })
                    }
                    className="mt-1 w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-sky-500 focus:outline-none"
                  >
                    <option value="PNS" className="bg-slate-900 text-slate-100">
                      PNS
                    </option>
                    <option
                      value="PPPK"
                      className="bg-slate-900 text-slate-100"
                    >
                      PPPK
                    </option>
                    <option value="GTY" className="bg-slate-900 text-slate-100">
                      GTY (Tetap Yayasan)
                    </option>
                    <option value="GTT" className="bg-slate-900 text-slate-100">
                      GTT (Tidak Tetap)
                    </option>
                    <option
                      value="Honorer"
                      className="bg-slate-900 text-slate-100"
                    >
                      Honorer
                    </option>
                    <option
                      value="Kontrak"
                      className="bg-slate-900 text-slate-100"
                    >
                      Kontrak
                    </option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label
                    htmlFor="guru-lp"
                    className="block text-xs font-semibold text-slate-300"
                  >
                    Jenis Kelamin
                  </label>
                  <select
                    id="guru-lp"
                    value={formData.lp || "L"}
                    onChange={(e) =>
                      setFormData({ ...formData, lp: e.target.value })
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
                <div>
                  <label
                    htmlFor="guru-shift"
                    className="block text-xs font-semibold text-slate-300"
                  >
                    Shift / Jam Scan
                  </label>
                  <select
                    id="guru-shift"
                    value={formData.id_shift || 1}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        id_shift: Number(e.target.value),
                      })
                    }
                    className="mt-1 w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-sky-500 focus:outline-none"
                  >
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
                </div>
                <div>
                  <label
                    htmlFor="guru-status-aktif"
                    className="block text-xs font-semibold text-slate-300"
                  >
                    Status Keaktifan
                  </label>
                  <select
                    id="guru-status-aktif"
                    value={formData.status_aktif || "Aktif"}
                    onChange={(e) =>
                      setFormData({ ...formData, status_aktif: e.target.value })
                    }
                    className="mt-1 w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-sky-500 focus:outline-none"
                  >
                    <option
                      value="Aktif"
                      className="bg-slate-900 text-slate-100"
                    >
                      Aktif
                    </option>
                    <option
                      value="Nonaktif"
                      className="bg-slate-900 text-slate-100"
                    >
                      Nonaktif
                    </option>
                  </select>
                </div>
              </div>

              <div>
                <label
                  htmlFor="guru-wa"
                  className="block text-xs font-semibold text-slate-300"
                >
                  No. WhatsApp / HP
                </label>
                <input
                  id="guru-wa"
                  type="text"
                  placeholder="08123456789"
                  value={formData.no_hp || ""}
                  onChange={(e) =>
                    setFormData({ ...formData, no_hp: e.target.value })
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
                  {saving ? "Menyimpan..." : "Simpan Profil"}
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
            title="Kartu Barcode QR Guru"
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
                  ID: {qrModalData.nip}
                </p>
              </div>
              <p className="text-xs text-slate-400">
                Arahkan barcode ini ke kamera terminal pemindai saat tiba atau
                pulang sekolah.
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
      </div>
      {dialogKonfirmasi}
    </AppShell>
  );
}
