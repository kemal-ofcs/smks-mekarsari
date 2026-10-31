"use client";

import { redirect } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppShell } from "@/components/AppShell";
import {
  BATAS_IMPORT_MASSAL,
  BATAS_KOREKSI_MASSAL,
  jalankanBerurutan,
  jenisPersonil,
  ringkasHasil,
} from "@/components/operational/aturanPilihPersonil";
import {
  HEADER_CSV_IMPORT,
  uraiCsvImport,
} from "@/components/operational/csvImportManual";
import { PilihPersonil } from "@/components/operational/PilihPersonil";
import { FeedbackBanner } from "@/components/ui/FeedbackBanner";
import { Modal } from "@/components/ui/Modal";
import { PageHeader } from "@/components/ui/PageHeader";
import { formatTanggalOperasional } from "@/lib/attendance/time-policy";
import { canAccessArea, hasPermission } from "@/lib/auth/access";
import { useAuth } from "@/lib/context/AuthContext";
import {
  batalkanPenugasanBackup,
  buatPenugasanBackup,
  getDaftarBackup,
  hapusPenugasanBackup,
} from "@/lib/gateways/backup";
import {
  getDaftarKoreksi,
  hapusKoreksiAdmin,
  prosesKoreksiAdmin,
} from "@/lib/gateways/correction";
import { getDaftarKaryawan } from "@/lib/gateways/employee";
import {
  getDaftarImport,
  hapusImportOffline,
  type OfflineImportRow,
  prosesImportOffline,
} from "@/lib/gateways/offline-import";
import { getDaftarShift } from "@/lib/gateways/shift";
import { subscribeSyncCompleted, syncNow } from "@/lib/gateways/sync-status";
import { useHydrated } from "@/lib/hooks/useHydrated";

type Tab = "correction" | "backup" | "import";

const inputClass =
  "min-h-11 w-full rounded-xl border border-white/10 bg-slate-950 px-3 text-sm text-white outline-none focus:border-sky-400";

export default function OperationalPage() {
  const hydrated = useHydrated();
  const { user, isAuthenticated, isLoading } = useAuth();
  const [tab, setTab] = useState<Tab>("correction");
  const [feedback, setFeedback] = useState<{
    tone: "success" | "error";
    text: string;
  } | null>(null);

  const [employees, setEmployees] = useState<Record<string, unknown>[]>([]);
  const [shifts, setShifts] = useState<Record<string, unknown>[]>([]);
  const [records, setRecords] = useState<Record<string, unknown>[]>([]);
  const [busy, setBusy] = useState(false);
  const isSubmittingRef = useRef(false);

  const [confirmKoreksi, setConfirmKoreksi] = useState<{
    ids: string[];
    sudahAda: string[];
    jumlahSiswa: number;
  } | null>(null);

  const [deleteConfirm, setDeleteConfirm] = useState<{
    type?: "correction" | "import" | "backup" | "cancelBackup";
    idReferensi: string;
    title: string;
    subtitle: string;
  } | null>(null);

  const handleDeleteConfirmed = async () => {
    if (!deleteConfirm || isSubmittingRef.current) return;
    isSubmittingRef.current = true;
    setBusy(true);
    setFeedback(null);
    try {
      if (deleteConfirm.type === "cancelBackup") {
        const result = await batalkanPenugasanBackup(deleteConfirm.idReferensi);
        setFeedback({
          tone: result.sukses ? "success" : "error",
          text: result.pesan,
        });
      } else if (deleteConfirm.type === "import") {
        const result = await hapusImportOffline(deleteConfirm.idReferensi);
        setFeedback({
          tone: result.sukses ? "success" : "error",
          text: result.pesan,
        });
      } else if (deleteConfirm.type === "backup") {
        const result = await hapusPenugasanBackup(deleteConfirm.idReferensi);
        setFeedback({
          tone: result.sukses ? "success" : "error",
          text: result.pesan,
        });
      } else {
        const result = await hapusKoreksiAdmin(deleteConfirm.idReferensi);
        setFeedback({
          tone: result.sukses ? "success" : "error",
          text: result.pesan,
        });
      }
      setDeleteConfirm(null);
      // Hapus dan batal hanya bisa dipicu dari tabel tab yang sedang terbuka.
      await load();
    } catch (err: unknown) {
      setFeedback({
        tone: "error",
        text:
          err instanceof Error ? err.message : "Gagal menghapus data riwayat.",
      });
    } finally {
      setBusy(false);
      isSubmittingRef.current = false;
    }
  };

  // Form State: Koreksi Admin
  const [correction, setCorrection] = useState({
    tanggal: formatTanggalOperasional(Date.now()),
    idPersonil: [] as string[],
    // 0 = backend memakai shift masing-masing personil (atau shift backup-nya).
    id_shift: 0,
    jenis_koreksi: "Izin",
    jam_koreksi: "",
    keterangan_admin: "",
  });

  // Form State: Backup Personil
  const [backup, setBackup] = useState({
    tanggal_tugas: formatTanggalOperasional(Date.now()),
    id_karyawan_asal: "",
    nama_karyawan_asal: "",
    divisi_asal: "",
    id_karyawan_pengganti: "",
    nama_karyawan_pengganti: "",
    divisi_pengganti: "",
    // 0 = belum dipilih; tebakan "Shift 1" bisa menunjuk shift yang tidak ada.
    id_shift_backup: 0,
    alasan_backup: "Penggantian Shift",
    catatan: "",
  });

  // Form State: Import Manual (Per-Kolom)
  const [manualEntry, setManualEntry] = useState({
    tanggal: formatTanggalOperasional(Date.now()),
    idPersonil: [] as string[],
    jam_masuk: "07:00",
    jam_pulang: "15:00",
    status_kehadiran: "Hadir",
    status_absen: "",
    keterangan: "Import Manual",
  });

  // Bulk CSV import state
  const [showBulkUpload, setShowBulkUpload] = useState(false);
  const [csv, setCsv] = useState(`${HEADER_CSV_IMPORT}\n`);
  const [tanggalRiwayat, setTanggalRiwayat] = useState(() =>
    formatTanggalOperasional(Date.now()),
  );
  // Respons pemuatan yang datang terlambat tidak boleh menimpa tab lain.
  const loadSeqRef = useRef(0);
  const bolehLihatKoreksi = hasPermission(user, "corrections.view");
  const bolehLihatBackup = hasPermission(user, "backups.view");
  const tabTersedia = (["correction", "backup", "import"] as Tab[]).filter(
    (value) => (value === "backup" ? bolehLihatBackup : bolehLihatKoreksi),
  );

  const run = useCallback(async (task: () => Promise<void>) => {
    if (isSubmittingRef.current) return;
    isSubmittingRef.current = true;
    setBusy(true);
    setFeedback(null);
    try {
      await task();
    } catch (error) {
      setFeedback({
        tone: "error",
        text: error instanceof Error ? error.message : "Operasi gagal.",
      });
    } finally {
      setBusy(false);
      isSubmittingRef.current = false;
    }
  }, []);

  const load = useCallback(
    async (
      currentTab: Tab = tab,
      synchronize = false,
      showFeedback = false,
    ) => {
      const seq = ++loadSeqRef.current;
      try {
        if (synchronize) {
          await syncNow().catch(() => undefined);
        }
        const filter = { tanggal: tanggalRiwayat };
        const [data, shiftList] = await Promise.all([
          currentTab === "backup"
            ? getDaftarBackup(filter)
            : currentTab === "import"
              ? getDaftarImport(filter)
              : getDaftarKoreksi(filter),
          getDaftarShift().catch(() => []),
        ]);
        if (seq !== loadSeqRef.current) return;
        setRecords(data);
        if (Array.isArray(shiftList) && shiftList.length > 0) {
          setShifts(shiftList);
        }
        if (showFeedback) {
          setFeedback({
            tone: "success",
            text: `${data.length} data berhasil dimuat.`,
          });
        }
      } catch (error) {
        if (showFeedback) {
          setFeedback({
            tone: "error",
            text: error instanceof Error ? error.message : "Gagal memuat data.",
          });
        }
      }
    },
    [tab, tanggalRiwayat],
  );

  useEffect(() => {
    if (hydrated && isAuthenticated) {
      void getDaftarKaryawan({ status_aktif: "Aktif" })
        .then((data) => setEmployees(data))
        .catch(() => undefined);
    }
  }, [hydrated, isAuthenticated]);

  // Satu-satunya pemicu muat ulang saat tab atau tanggal riwayat berganti.
  useEffect(() => {
    if (hydrated && isAuthenticated) void load();
  }, [hydrated, isAuthenticated, load]);

  // Pengguna yang hanya boleh melihat backup tidak dibuka di tab Koreksi.
  useEffect(() => {
    const bolehTabIni = tab === "backup" ? bolehLihatBackup : bolehLihatKoreksi;
    if (!bolehTabIni && (bolehLihatKoreksi || bolehLihatBackup)) {
      setTab(bolehLihatKoreksi ? "correction" : "backup");
    }
  }, [tab, bolehLihatKoreksi, bolehLihatBackup]);

  useEffect(() => {
    return subscribeSyncCompleted(() => {
      void load(tab, false, false);
    });
  }, [tab, load]);

  const cariPersonil = (idPersonil: string) =>
    employees.find((row) => String(row.id_unik) === idPersonil);
  const namaPersonil = (idPersonil: string) =>
    String(cariPersonil(idPersonil)?.nama || idPersonil);
  const bolehPilihKelas =
    hasPermission(user, "academic.view") &&
    hasPermission(user, "students.view");
  // Backup adalah delegasi shift staf; siswa tidak pernah menggantikan siapa pun.
  const personilBackup = employees.filter(
    (row) => jenisPersonil(row) !== "siswa",
  );

  const shiftOptions = shifts.map((s) => (
    <option key={String(s.id_shift)} value={Number(s.id_shift)}>
      {String(s.nama_shift)} ({String(s.jam_masuk)} - {String(s.jam_pulang)})
    </option>
  ));

  const handleSelectBackupAsal = (ids: string[]) => {
    const found = ids[0] ? cariPersonil(ids[0]) : undefined;
    setBackup((prev) => ({
      ...prev,
      id_karyawan_asal: ids[0] ?? "",
      nama_karyawan_asal: String(found?.nama || ""),
      divisi_asal: String(found?.divisi || ""),
      id_shift_backup: Number(found?.id_shift) || prev.id_shift_backup,
    }));
  };

  const handleSelectBackupPengganti = (ids: string[]) => {
    const found = ids[0] ? cariPersonil(ids[0]) : undefined;
    setBackup((prev) => ({
      ...prev,
      id_karyawan_pengganti: ids[0] ?? "",
      nama_karyawan_pengganti: String(found?.nama || ""),
      divisi_pengganti: String(found?.divisi || ""),
    }));
  };

  const prosesKoreksi = async (ids: string[]) => {
    const hasil = await jalankanBerurutan(ids, (idPersonil) =>
      prosesKoreksiAdmin({
        tanggal: correction.tanggal,
        id_karyawan: idPersonil,
        jenis_koreksi: correction.jenis_koreksi as Parameters<
          typeof prosesKoreksiAdmin
        >[0]["jenis_koreksi"],
        jam_koreksi: correction.jam_koreksi || undefined,
        keterangan_admin: correction.keterangan_admin || undefined,
        id_shift: correction.id_shift || undefined,
      }),
    );
    setFeedback({
      tone: hasil.gagal.length > 0 ? "error" : "success",
      text:
        ids.length === 1
          ? (hasil.gagal[0]?.pesan ??
            `Koreksi admin untuk ${namaPersonil(ids[0])} tanggal ${correction.tanggal} tersimpan.`)
          : `Koreksi admin: ${ringkasHasil(hasil, namaPersonil)}`,
    });
    // Yang gagal tetap terpilih supaya bisa langsung dicoba lagi.
    setCorrection((prev) => ({
      ...prev,
      idPersonil: hasil.gagal.map((item) => item.id),
      ...(hasil.gagal.length === 0
        ? { jam_koreksi: "", keterangan_admin: "" }
        : {}),
    }));
    if (hasil.berhasil.length > 0) {
      await load("correction", false, false);
    }
  };

  const executeCorrection = (ids: string[]) => run(() => prosesKoreksi(ids));

  const submitCorrection = () =>
    run(async () => {
      const ids = correction.idPersonil;
      if (ids.length === 0) {
        throw new Error("Pilih minimal satu personil terlebih dahulu.");
      }
      // Ditanyakan ke server untuk tanggal koreksinya, karena tabel riwayat
      // hanya memuat tanggal yang sedang dipilih di sana.
      const koreksiTanggalIni = await getDaftarKoreksi({
        tanggal: correction.tanggal,
      });
      const sudahAda = ids.filter((idPersonil) =>
        koreksiTanggalIni.some((r) => String(r.id_karyawan) === idPersonil),
      );
      const jumlahSiswa = ids.filter((idPersonil) => {
        const row = cariPersonil(idPersonil);
        return row ? jenisPersonil(row) === "siswa" : false;
      }).length;
      if (sudahAda.length > 0 || ids.length > 1) {
        setConfirmKoreksi({
          ids,
          sudahAda: sudahAda.map(namaPersonil),
          jumlahSiswa,
        });
        return;
      }
      await prosesKoreksi(ids);
    });

  const submitBackup = () =>
    run(async () => {
      if (!backup.id_karyawan_asal || !backup.id_karyawan_pengganti) {
        throw new Error("Pilih personil asal dan pengganti terlebih dahulu.");
      }
      if (!backup.id_shift_backup) {
        throw new Error("Pilih shift backup terlebih dahulu.");
      }
      const result = await buatPenugasanBackup({
        tanggal_tugas: backup.tanggal_tugas,
        id_karyawan_asal: backup.id_karyawan_asal,
        id_karyawan_pengganti: backup.id_karyawan_pengganti,
        id_shift_backup: backup.id_shift_backup,
        alasan_backup: backup.alasan_backup,
        catatan: backup.catatan,
      });
      setFeedback({
        tone: result.sukses ? "success" : "error",
        text: result.pesan,
      });
      if (result.sukses) {
        setBackup((prev) => ({
          ...prev,
          id_karyawan_asal: "",
          nama_karyawan_asal: "",
          divisi_asal: "",
          id_karyawan_pengganti: "",
          nama_karyawan_pengganti: "",
          divisi_pengganti: "",
          alasan_backup: "Penggantian Shift",
          catatan: "",
        }));
        await load("backup", false, false);
      }
    });

  const submitManualEntry = () =>
    run(async () => {
      const ids = manualEntry.idPersonil;
      if (ids.length === 0) {
        throw new Error("Pilih minimal satu personil terlebih dahulu.");
      }
      const hadir = manualEntry.status_kehadiran === "Hadir";
      const rows: OfflineImportRow[] = ids.map((idPersonil) => {
        const found = cariPersonil(idPersonil);
        return {
          tanggal: manualEntry.tanggal,
          id_unik: idPersonil,
          nama: found?.nama ? String(found.nama) : undefined,
          divisi: found?.divisi ? String(found.divisi) : undefined,
          jam_masuk: (hadir && manualEntry.jam_masuk) || undefined,
          jam_pulang: (hadir && manualEntry.jam_pulang) || undefined,
          status_kehadiran: manualEntry.status_kehadiran,
          status_absen: (hadir && manualEntry.status_absen) || undefined,
          keterangan: manualEntry.keterangan || undefined,
        };
      });
      const result = await prosesImportOffline(rows);
      // `results` berurutan sama dengan `rows`, di Web maupun Rust.
      const hasil = {
        berhasil: ids.filter((_, index) => result.results[index]?.sukses),
        gagal: ids.flatMap((idPersonil, index) =>
          result.results[index]?.sukses
            ? []
            : [
                {
                  id: idPersonil,
                  pesan: result.results[index]?.pesan || "Terjadi kesalahan",
                },
              ],
        ),
      };
      setFeedback({
        tone: hasil.gagal.length > 0 ? "error" : "success",
        text:
          ids.length === 1
            ? hasil.gagal.length === 0
              ? `Entri absensi manual untuk ${namaPersonil(ids[0])} tanggal ${manualEntry.tanggal} berhasil disimpan.${result.catatanNotifikasi ?? ""}`
              : `Gagal menyimpan entri manual: ${hasil.gagal[0].pesan}`
            : `Entri manual: ${ringkasHasil(hasil, namaPersonil)}${result.catatanNotifikasi ?? ""}`,
      });
      setManualEntry((prev) => ({
        ...prev,
        idPersonil: hasil.gagal.map((item) => item.id),
        ...(hasil.gagal.length === 0 ? { keterangan: "Import Manual" } : {}),
      }));
      if (hasil.berhasil.length > 0) {
        await load("import", false, false);
      }
    });

  const submitBulkCsv = () =>
    run(async () => {
      const rows = uraiCsvImport(csv);
      if (rows.length > BATAS_IMPORT_MASSAL) {
        throw new Error(
          `Import massal maksimal ${BATAS_IMPORT_MASSAL} baris; CSV ini berisi ${rows.length} baris.`,
        );
      }
      const result = await prosesImportOffline(rows);
      const rincianGagal = result.results
        .map((item, index) =>
          item.sukses ? null : `data ke-${index + 1}: ${item.pesan}`,
        )
        .filter(Boolean)
        .slice(0, 5)
        .join("; ");
      setFeedback({
        tone: result.gagal > 0 ? "error" : "success",
        text: `Import massal selesai: ${result.berhasil} berhasil, ${result.gagal} gagal.${rincianGagal ? ` ${rincianGagal}.` : ""}${result.catatanNotifikasi ?? ""}`,
      });
      if (result.berhasil > 0) {
        setShowBulkUpload(false);
        setCsv(`${HEADER_CSV_IMPORT}\n`);
        await load("import", false, false);
      }
    });

  if (isLoading || !hydrated) {
    return (
      <AppShell contentClassName="mx-auto w-full max-w-7xl px-4 py-6">
        <div className="flex items-center justify-center p-12 text-slate-400 font-mono text-sm">
          Memuat modul operasional absensi...
        </div>
      </AppShell>
    );
  }

  if (!isAuthenticated) redirect("/login");
  if (!canAccessArea(user, "operational")) redirect("/forbidden");

  return (
    <AppShell contentClassName="mx-auto w-full max-w-7xl gap-6 px-4 py-6 sm:px-6 lg:px-8 space-y-6">
      <PageHeader
        eyebrow="Operasional Absensi"
        title="Pusat Operasional"
        description="Layanan koreksi admin, penugasan backup staf, dan import data presensi manual."
      />

      {feedback ? (
        <FeedbackBanner
          tone={feedback.tone}
          onDismiss={() => setFeedback(null)}
        >
          {feedback.text}
        </FeedbackBanner>
      ) : null}

      {/* Konfirmasi koreksi: timpa koreksi lama dan/atau banyak personil */}
      {confirmKoreksi ? (
        <Modal
          isOpen
          onClose={() => setConfirmKoreksi(null)}
          title={
            confirmKoreksi.ids.length > 1
              ? `Simpan koreksi untuk ${confirmKoreksi.ids.length} personil?`
              : "Konfirmasi Timpa Koreksi"
          }
          maxWidth="max-w-md"
          footer={
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setConfirmKoreksi(null)}
                className="px-4 py-2 text-xs font-semibold text-slate-300 hover:text-white bg-slate-800 rounded-xl transition"
              >
                Batal
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  const ids = confirmKoreksi.ids;
                  setConfirmKoreksi(null);
                  void executeCorrection(ids);
                }}
                className="px-4 py-2 text-xs font-bold text-slate-950 bg-amber-400 hover:bg-amber-300 rounded-xl transition shadow-lg flex items-center gap-2"
              >
                Ya, Simpan Koreksi
              </button>
            </div>
          }
        >
          <div className="space-y-4">
            <p className="text-sm text-slate-300">
              {correction.jenis_koreksi} pada tanggal{" "}
              <strong className="text-white">{correction.tanggal}</strong> untuk{" "}
              {confirmKoreksi.ids.length} personil.
            </p>
            {confirmKoreksi.sudahAda.length > 0 ? (
              <p className="text-xs text-amber-300/90 bg-amber-950/40 border border-amber-800/40 p-2.5 rounded-xl">
                {confirmKoreksi.sudahAda.length} personil sudah punya koreksi
                pada tanggal ini:{" "}
                {confirmKoreksi.sudahAda.slice(0, 5).join(", ")}
                {confirmKoreksi.sudahAda.length > 5
                  ? `, dan ${confirmKoreksi.sudahAda.length - 5} lainnya`
                  : ""}
                . Koreksi baru memperbarui absensi mereka pada tanggal itu.
              </p>
            ) : null}
            {confirmKoreksi.jumlahSiswa > 0 ? (
              <p className="text-xs text-sky-300 bg-sky-950 border border-sky-800 p-2.5 rounded-xl">
                Bila notifikasi WA koreksi admin aktif, wali dari{" "}
                {confirmKoreksi.jumlahSiswa} siswa akan menerima pesan.
              </p>
            ) : null}
          </div>
        </Modal>
      ) : null}

      {/* Tab Switcher */}
      <div className="flex flex-wrap gap-2 rounded-2xl border border-white/10 bg-slate-900/60 p-2 font-mono text-xs">
        {tabTersedia.map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => {
              setTab(value);
              setRecords([]);
            }}
            className={`rounded-xl px-4 py-2.5 font-bold transition ${
              tab === value
                ? "bg-sky-400 text-slate-950 shadow-md shadow-sky-950"
                : "text-slate-400 hover:text-white"
            }`}
          >
            {value === "correction" && "Koreksi Admin"}
            {value === "backup" && "Penugasan Backup"}
            {value === "import" && "Import Manual"}
          </button>
        ))}
      </div>

      {/* TAB 1: KOREKSI ADMIN */}
      {tab === "correction" && hasPermission(user, "corrections.manage") ? (
        <section className="app-panel rounded-3xl p-5 sm:p-7 space-y-5 bg-slate-900/80 border border-slate-800">
          <div className="border-b border-slate-800 pb-3">
            <h2 className="text-base font-bold text-white">
              Formulir Koreksi Absensi (Otoritas Admin)
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Koreksi absensi memiliki prioritas tertinggi dan langsung
              memperbarui rekaman absensi harian dan log scan.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3 text-xs font-mono">
            {/* Tanggal */}
            <div>
              <span className="text-slate-400 block mb-1">Tanggal Absensi</span>
              <input
                aria-label="Tanggal absensi"
                type="date"
                className={inputClass}
                value={correction.tanggal}
                onChange={(event) =>
                  setCorrection({
                    ...correction,
                    tanggal: event.target.value,
                  })
                }
              />
            </div>

            {/* Personil: satu atau banyak sekaligus */}
            <div className="sm:col-span-2 md:col-span-3">
              <PilihPersonil
                id="koreksi-personil"
                label="Pilih personil (bisa lebih dari satu)"
                personil={employees}
                terpilih={correction.idPersonil}
                onChange={(ids) =>
                  setCorrection((prev) => ({ ...prev, idPersonil: ids }))
                }
                batas={BATAS_KOREKSI_MASSAL}
                bolehPilihKelas={bolehPilihKelas}
                disabled={busy}
              />
            </div>

            {/* Shift Jadwal Kerja Target */}
            <div>
              <span className="text-slate-400 block mb-1">
                Shift / Jadwal Kerja
              </span>
              <select
                aria-label="Pilih shift"
                className={inputClass}
                value={correction.id_shift}
                onChange={(event) =>
                  setCorrection({
                    ...correction,
                    id_shift: Number(event.target.value),
                  })
                }
              >
                <option value={0}>Ikuti shift masing-masing personil</option>
                {shiftOptions}
              </select>
            </div>

            {/* Jenis Koreksi */}
            <div>
              <span className="text-slate-400 block mb-1">Jenis Koreksi</span>
              <select
                aria-label="Jenis koreksi"
                className={inputClass}
                value={correction.jenis_koreksi}
                onChange={(event) =>
                  setCorrection({
                    ...correction,
                    jenis_koreksi: event.target.value,
                  })
                }
              >
                <option value="Sakit">Sakit</option>
                <option value="Izin">Izin</option>
                <option value="Dispen">Dispen</option>
                <option value="Alfa">Alfa</option>
                <option value="Lupa Absen Masuk">Lupa Absen Masuk</option>
                <option value="Lupa Absen Pulang">Lupa Absen Pulang</option>
                <option value="Kendala Sistem - Jam Masuk">
                  Kendala Sistem - Jam Masuk
                </option>
                <option value="Kendala Sistem - Jam Pulang">
                  Kendala Sistem - Jam Pulang
                </option>
                <option value="Terlambat">Terlambat (Disesuaikan)</option>
              </select>
            </div>

            {/* Jam Koreksi */}
            <div>
              <span className="text-slate-400 block mb-1">
                Jam Koreksi (HH:mm)
              </span>
              <input
                aria-label="Jam koreksi"
                type="time"
                className={inputClass}
                value={correction.jam_koreksi}
                onChange={(event) =>
                  setCorrection({
                    ...correction,
                    jam_koreksi: event.target.value,
                  })
                }
              />
            </div>

            {/* Keterangan Admin */}
            <div className="sm:col-span-2 md:col-span-2">
              <span className="text-slate-400 block mb-1">
                Keterangan / Alasan Koreksi
              </span>
              <input
                aria-label="Keterangan koreksi"
                className={inputClass}
                placeholder="Misal: Izin tertulis disetujui pimpinan / Kendala scanner mati"
                value={correction.keterangan_admin}
                onChange={(event) =>
                  setCorrection({
                    ...correction,
                    keterangan_admin: event.target.value,
                  })
                }
              />
            </div>
          </div>

          <button
            type="button"
            disabled={busy}
            data-konfirmasi
            onClick={submitCorrection}
            className="min-h-11 w-full rounded-xl bg-sky-400 font-black text-slate-950 transition hover:bg-sky-300 disabled:opacity-50 disabled:cursor-not-allowed font-mono text-sm shadow-md flex items-center justify-center gap-2"
          >
            {busy ? (
              <>
                <div className="w-4 h-4 border-2 border-slate-950 border-t-transparent rounded-full animate-spin"></div>
                <span>Sedang Memproses Koreksi...</span>
              </>
            ) : (
              <>Simpan Koreksi Admin</>
            )}
          </button>
        </section>
      ) : null}

      {/* TAB 2: BACKUP KARYAWAN */}
      {tab === "backup" && hasPermission(user, "backups.manage") ? (
        <section className="app-panel rounded-3xl p-5 sm:p-7 space-y-5 bg-slate-900/80 border border-slate-800">
          <div className="border-b border-slate-800 pb-3">
            <h2 className="text-base font-bold text-white">
              Penugasan Backup Personil
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Delegasikan jadwal kerja ke guru atau pegawai pengganti. Sistem
              akan mengarahkan scan personil pengganti ke shift backup.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3 text-xs font-mono">
            {/* Tanggal Tugas */}
            <div>
              <span className="text-slate-400 block mb-1">Tanggal Tugas</span>
              <input
                aria-label="Tanggal tugas"
                type="date"
                className={inputClass}
                value={backup.tanggal_tugas}
                onChange={(event) =>
                  setBackup({ ...backup, tanggal_tugas: event.target.value })
                }
              />
            </div>

            {/* Shift Backup */}
            <div>
              <span className="text-slate-400 block mb-1">
                Shift Backup Ditugaskan
              </span>
              <select
                aria-label="Shift backup"
                className={inputClass}
                value={backup.id_shift_backup}
                onChange={(event) =>
                  setBackup({
                    ...backup,
                    id_shift_backup: Number(event.target.value),
                  })
                }
              >
                <option value={0} disabled>
                  {shifts.length > 0
                    ? "Pilih shift"
                    : "Daftar shift belum dimuat"}
                </option>
                {shiftOptions}
              </select>
            </div>

            {/* Alasan Backup */}
            <div>
              <span className="text-slate-400 block mb-1">Alasan Backup</span>
              <input
                aria-label="Alasan backup"
                className={inputClass}
                placeholder="Misal: Menggantikan Cuti"
                value={backup.alasan_backup}
                onChange={(event) =>
                  setBackup({ ...backup, alasan_backup: event.target.value })
                }
              />
            </div>

            {/* Personil Asal (Yang Digantikan) */}
            <div>
              <PilihPersonil
                id="backup-asal"
                label="Personil asal (yang digantikan)"
                personil={personilBackup}
                terpilih={
                  backup.id_karyawan_asal ? [backup.id_karyawan_asal] : []
                }
                onChange={handleSelectBackupAsal}
                tanpaSaringanJenis
                disabled={busy}
              />
            </div>

            {/* Personil Pengganti */}
            <div>
              <PilihPersonil
                id="backup-pengganti"
                label="Personil pengganti"
                personil={personilBackup}
                terpilih={
                  backup.id_karyawan_pengganti
                    ? [backup.id_karyawan_pengganti]
                    : []
                }
                onChange={handleSelectBackupPengganti}
                tanpaSaringanJenis
                disabled={busy}
              />
            </div>

            {/* Catatan Tambahan */}
            <div>
              <span className="text-slate-400 block mb-1">
                Catatan Tambahan
              </span>
              <input
                aria-label="Catatan backup"
                className={inputClass}
                placeholder="Catatan opsional"
                value={backup.catatan}
                onChange={(event) =>
                  setBackup({ ...backup, catatan: event.target.value })
                }
              />
            </div>
          </div>

          <button
            type="button"
            disabled={busy}
            data-konfirmasi
            onClick={submitBackup}
            className="min-h-11 w-full rounded-xl bg-sky-400 font-black text-slate-950 transition hover:bg-sky-300 disabled:opacity-50 disabled:cursor-not-allowed font-mono text-sm shadow-md flex items-center justify-center gap-2"
          >
            {busy ? (
              <>
                <div className="w-4 h-4 border-2 border-slate-950 border-t-transparent rounded-full animate-spin"></div>
                <span>Sedang Menyimpan Backup...</span>
              </>
            ) : (
              <>Buat Penugasan Backup</>
            )}
          </button>
        </section>
      ) : null}

      {/* TAB 3: IMPORT MANUAL */}
      {tab === "import" && hasPermission(user, "corrections.manage") ? (
        <section className="app-panel rounded-3xl p-5 sm:p-7 space-y-6 bg-slate-900/80 border border-slate-800">
          <div className="border-b border-slate-800 pb-3">
            <h2 className="text-base font-bold text-white">
              Input Absensi Manual (Per-Kolom)
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Tambahkan data absensi harian per kolom secara langsung. Pilih
              personil dan tanggal, maka sistem otomatis menghitung seluruh
              metrik shift dan mencatat di Log Scan.
            </p>
          </div>

          {/* Form Input Manual Per-Kolom */}
          <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3 text-xs font-mono bg-slate-950/60 p-4 rounded-2xl border border-slate-800/80">
            {/* Tanggal */}
            <div>
              <span className="text-slate-400 block mb-1 font-semibold">
                Tanggal Absensi
              </span>
              <input
                aria-label="Tanggal absensi"
                type="date"
                className={inputClass}
                value={manualEntry.tanggal}
                onChange={(e) =>
                  setManualEntry({ ...manualEntry, tanggal: e.target.value })
                }
              />
            </div>

            {/* Personil: satu atau banyak sekaligus */}
            <div className="sm:col-span-2 md:col-span-3">
              <PilihPersonil
                id="manual-personil"
                label="Pilih personil (bisa lebih dari satu)"
                personil={employees}
                terpilih={manualEntry.idPersonil}
                onChange={(ids) =>
                  setManualEntry((prev) => ({ ...prev, idPersonil: ids }))
                }
                batas={BATAS_IMPORT_MASSAL}
                bolehPilihKelas={bolehPilihKelas}
                disabled={busy}
              />
            </div>

            {/* Status Kehadiran */}
            <div>
              <span className="text-slate-400 block mb-1 font-semibold">
                Status Kehadiran
              </span>
              <select
                aria-label="Status kehadiran"
                className={inputClass}
                value={manualEntry.status_kehadiran}
                onChange={(e) =>
                  setManualEntry({
                    ...manualEntry,
                    status_kehadiran: e.target.value,
                  })
                }
              >
                <option value="Hadir">Hadir</option>
                <option value="Sakit">Sakit</option>
                <option value="Izin">Izin</option>
                <option value="Dispen">Dispen</option>
                <option value="Alfa">Alfa</option>
              </select>
            </div>

            {/* Jam dan status absen hanya untuk Hadir; status lain disimpan tanpa jam. */}
            {manualEntry.status_kehadiran === "Hadir" ? (
              <>
                <div>
                  <span className="text-emerald-400 block mb-1 font-semibold">
                    Jam Masuk (HH:mm)
                  </span>
                  <input
                    aria-label="Jam Masuk"
                    type="time"
                    className={inputClass}
                    value={manualEntry.jam_masuk}
                    onChange={(e) =>
                      setManualEntry({
                        ...manualEntry,
                        jam_masuk: e.target.value,
                      })
                    }
                  />
                </div>

                <div>
                  <span className="text-sky-400 block mb-1 font-semibold">
                    Jam Pulang (HH:mm)
                  </span>
                  <input
                    aria-label="Jam Pulang"
                    type="time"
                    className={inputClass}
                    value={manualEntry.jam_pulang}
                    onChange={(e) =>
                      setManualEntry({
                        ...manualEntry,
                        jam_pulang: e.target.value,
                      })
                    }
                  />
                </div>

                <div>
                  <span className="text-amber-400 block mb-1 font-semibold">
                    Status Absen
                  </span>
                  <select
                    aria-label="Status Absen"
                    className={inputClass}
                    value={manualEntry.status_absen}
                    onChange={(e) =>
                      setManualEntry({
                        ...manualEntry,
                        status_absen: e.target.value,
                      })
                    }
                  >
                    <option value="">
                      Otomatis (Generate Sistem Sesuai Jam)
                    </option>
                    <option value="Lengkap">Lengkap (Masuk & Pulang)</option>
                    <option value="Belum Pulang">
                      Belum Pulang (Hanya Masuk)
                    </option>
                    <option value="Perlu Verifikasi">
                      Perlu Verifikasi (Hanya Pulang)
                    </option>
                    <option value="Tepat Waktu">Tepat Waktu</option>
                    <option value="Terlambat">Terlambat</option>
                    <option value="Datang Lebih Awal">Datang Lebih Awal</option>
                  </select>
                </div>
              </>
            ) : (
              <p className="sm:col-span-2 text-xs text-slate-400 self-end pb-3">
                {manualEntry.status_kehadiran} disimpan tanpa jam masuk dan
                pulang, sehingga tidak dihitung sebagai jam kerja.
              </p>
            )}

            {/* Keterangan */}
            <div>
              <span className="text-slate-400 block mb-1">Keterangan</span>
              <input
                aria-label="Keterangan"
                className={inputClass}
                placeholder="Misal: Absensi manual"
                value={manualEntry.keterangan}
                onChange={(e) =>
                  setManualEntry({ ...manualEntry, keterangan: e.target.value })
                }
              />
            </div>

            <div className="sm:col-span-2 md:col-span-3 pt-2">
              <button
                type="button"
                disabled={busy}
                data-konfirmasi
                onClick={submitManualEntry}
                className="min-h-11 w-full rounded-xl bg-emerald-400 hover:bg-emerald-300 text-slate-950 font-black transition disabled:opacity-50 disabled:cursor-not-allowed font-mono text-sm shadow-md flex items-center justify-center gap-2"
              >
                {busy ? (
                  <>
                    <div className="w-4 h-4 border-2 border-slate-950 border-t-transparent rounded-full animate-spin"></div>
                    <span>Sedang Menyimpan Entri Manual...</span>
                  </>
                ) : (
                  <>Simpan Entri Manual</>
                )}
              </button>
            </div>
          </div>

          {/* Collapsible Section: Bulk CSV Upload */}
          <div className="border-t border-slate-800/80 pt-4">
            <button
              type="button"
              onClick={() => setShowBulkUpload(!showBulkUpload)}
              className="text-xs font-mono text-sky-400 hover:text-sky-300 font-bold flex items-center gap-2"
            >
              <span>{showBulkUpload ? "▼" : "▶"}</span>
              <span>Opsi Tambahan: Import Massal File CSV (Opsional)</span>
            </button>

            {showBulkUpload ? (
              <div className="mt-3 space-y-3 bg-slate-950/40 p-4 rounded-2xl border border-slate-800">
                <p className="text-xs text-slate-400">
                  Tempel teks CSV dengan format header:{" "}
                  <code className="text-sky-300 font-mono">
                    tanggal,id_unik,jam_masuk,jam_pulang,status_kehadiran,keterangan
                  </code>
                </p>
                <textarea
                  aria-label="Data CSV Import Manual"
                  rows={6}
                  className={`${inputClass} min-h-36 py-3 font-mono text-xs`}
                  value={csv}
                  onChange={(event) => setCsv(event.target.value)}
                />
                <button
                  type="button"
                  disabled={busy}
                  data-konfirmasi
                  onClick={submitBulkCsv}
                  className="min-h-10 w-full rounded-xl bg-amber-400 hover:bg-amber-300 font-bold text-slate-950 disabled:opacity-50 disabled:cursor-not-allowed text-xs font-mono flex items-center justify-center gap-2"
                >
                  {busy ? (
                    <>
                      <div className="w-3.5 h-3.5 border-2 border-slate-950 border-t-transparent rounded-full animate-spin"></div>
                      <span>Sedang Mengimpor Data CSV...</span>
                    </>
                  ) : (
                    <>Proses Import Massal CSV</>
                  )}
                </button>
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

      {/* Riwayat Data Section */}
      <section className="app-panel rounded-3xl p-5 bg-slate-900/80 border border-slate-800 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3">
          <h2 className="font-bold text-white text-sm">
            Log Riwayat{" "}
            {tab === "backup"
              ? "Backup"
              : tab === "import"
                ? "Import Manual"
                : "Koreksi Admin"}
          </h2>
          <div className="flex items-center gap-2">
            <input
              aria-label="Tanggal riwayat"
              type="date"
              className={`${inputClass} w-auto font-mono text-xs`}
              value={tanggalRiwayat}
              onChange={(event) => setTanggalRiwayat(event.target.value)}
            />
            <button
              type="button"
              disabled={busy}
              onClick={() => void load(tab)}
              className="rounded-xl border border-white/10 px-4 py-2 text-xs font-mono font-bold bg-slate-800 hover:bg-slate-700 text-sky-300 transition"
            >
              Muat Data
            </button>
          </div>
        </div>

        {tab === "backup" && records.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs font-mono text-slate-300">
              <thead className="border-b border-slate-800 text-slate-400 bg-slate-950/40">
                <tr>
                  <th className="p-2.5">ID Backup</th>
                  <th className="p-2.5">Tanggal Tugas</th>
                  <th className="p-2.5">Personil Asal</th>
                  <th className="p-2.5">Personil Pengganti</th>
                  <th className="p-2.5">Shift Backup</th>
                  <th className="p-2.5">Status</th>
                  <th className="p-2.5">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {records.map((item) => (
                  <tr key={String(item.id_backup)}>
                    <td className="p-2.5 text-sky-400 font-bold">
                      {String(item.id_backup)}
                    </td>
                    <td className="p-2.5">{String(item.tanggal_tugas)}</td>
                    <td className="p-2.5">
                      {String(item.nama_karyawan_asal)} (
                      {String(item.id_karyawan_asal)})
                    </td>
                    <td className="p-2.5 text-emerald-300 font-bold">
                      {String(item.nama_karyawan_pengganti)} (
                      {String(item.id_karyawan_pengganti)})
                    </td>
                    <td className="p-2.5">
                      Shift {String(item.id_shift_backup)}
                    </td>
                    <td className="p-2.5">
                      <span
                        className={`px-2 py-0.5 rounded text-[11px] font-bold ${
                          item.status_tugas === "Aktif"
                            ? "bg-emerald-950 text-emerald-300 border border-emerald-800"
                            : "bg-rose-950 text-rose-300 border border-rose-800"
                        }`}
                      >
                        {String(item.status_tugas)}
                      </span>
                    </td>
                    <td className="p-2.5">
                      <div className="flex items-center gap-1.5">
                        {item.status_tugas === "Aktif" &&
                        hasPermission(user, "backups.manage") ? (
                          <button
                            type="button"
                            onClick={() =>
                              setDeleteConfirm({
                                type: "cancelBackup",
                                idReferensi: String(item.id_backup || ""),
                                title: `Batalkan Backup: ${item.id_backup}`,
                                subtitle: `${item.nama_karyawan_pengganti} (${item.id_karyawan_pengganti}) menggantikan ${item.nama_karyawan_asal} (${item.id_karyawan_asal}) pada ${item.tanggal_tugas}`,
                              })
                            }
                            className="px-2.5 py-1 rounded bg-amber-950/80 hover:bg-amber-900 border border-amber-800 text-amber-300 text-[11px]"
                          >
                            Batalkan
                          </button>
                        ) : null}
                        {hasPermission(user, "operational.delete") ? (
                          <button
                            type="button"
                            onClick={() =>
                              setDeleteConfirm({
                                type: "backup",
                                idReferensi: String(item.id_backup || ""),
                                title: `Hapus Backup: ${item.id_backup}`,
                                subtitle: `${item.nama_karyawan_pengganti} (${item.id_karyawan_pengganti}) menggantikan ${item.nama_karyawan_asal} (${item.id_karyawan_asal}) pada ${item.tanggal_tugas}`,
                              })
                            }
                            className="px-2.5 py-1 rounded bg-rose-950/80 hover:bg-rose-900 border border-rose-800 text-rose-300 text-[11px] font-bold transition flex items-center gap-1"
                            title="Hapus baris backup ini"
                          >
                            <span>Hapus</span>
                          </button>
                        ) : null}
                        {!hasPermission(user, "operational.delete") &&
                        !(
                          item.status_tugas === "Aktif" &&
                          hasPermission(user, "backups.manage")
                        ) ? (
                          <span>-</span>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : tab === "correction" && records.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs font-mono text-slate-300">
              <thead className="border-b border-slate-800 text-slate-400 bg-slate-950/40">
                <tr>
                  <th className="p-2.5">Referensi</th>
                  <th className="p-2.5">Tanggal</th>
                  <th className="p-2.5">Personil</th>
                  <th className="p-2.5">Jenis Koreksi</th>
                  <th className="p-2.5">Jam Koreksi</th>
                  <th className="p-2.5">Keterangan</th>
                  <th className="p-2.5">Operator</th>
                  {hasPermission(user, "operational.delete") ? (
                    <th className="p-2.5 text-center">Aksi</th>
                  ) : null}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {records.map((item) => (
                  <tr key={String(item.id_referensi || item.id_koreksi)}>
                    <td className="p-2.5 text-sky-400 font-bold">
                      {String(item.id_referensi || "-")}
                    </td>
                    <td className="p-2.5">{String(item.tanggal)}</td>
                    <td className="p-2.5 font-bold text-white">
                      {String(item.nama)} ({String(item.id_karyawan)})
                    </td>
                    <td className="p-2.5">
                      <span className="px-2 py-0.5 rounded bg-sky-950 border border-sky-800 text-sky-300 text-[11px]">
                        {String(item.jenis_koreksi)}
                      </span>
                    </td>
                    <td className="p-2.5">{String(item.jam_koreksi || "-")}</td>
                    <td className="p-2.5 text-slate-400 max-w-xs truncate">
                      {String(item.keterangan_admin || "-")}
                    </td>
                    <td className="p-2.5 text-slate-400">
                      {String(item.kode_operator || "-")}
                    </td>
                    {hasPermission(user, "operational.delete") ? (
                      <td className="p-2.5 text-center">
                        <button
                          type="button"
                          onClick={() =>
                            setDeleteConfirm({
                              type: "correction",
                              idReferensi: String(item.id_referensi || ""),
                              title: `Hapus Koreksi: ${item.id_referensi}`,
                              subtitle: `${item.nama} (${item.id_karyawan}) · ${item.jenis_koreksi} pada ${item.tanggal}`,
                            })
                          }
                          className="px-2.5 py-1 rounded bg-rose-950/80 hover:bg-rose-900 border border-rose-800 text-rose-300 text-[11px] font-bold transition flex items-center gap-1 mx-auto"
                          title="Hapus baris koreksi ini"
                        >
                          <span>Hapus</span>
                        </button>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : tab === "import" && records.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs font-mono text-slate-300">
              <thead className="border-b border-slate-800 text-slate-400 bg-slate-950/40">
                <tr>
                  <th className="p-2.5">Event Key</th>
                  <th className="p-2.5">Tanggal</th>
                  <th className="p-2.5">Personil</th>
                  <th className="p-2.5">Divisi</th>
                  <th className="p-2.5">Jam Masuk</th>
                  <th className="p-2.5">Jam Pulang</th>
                  <th className="p-2.5">Kehadiran</th>
                  <th className="p-2.5">Status</th>
                  <th className="p-2.5">Keterangan</th>
                  <th className="p-2.5">Operator</th>
                  {hasPermission(user, "operational.delete") ? (
                    <th className="p-2.5 text-center">Aksi</th>
                  ) : null}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {records.map((item) => (
                  <tr key={String(item.event_key || item.id_import)}>
                    <td
                      className="p-2.5 text-sky-400 font-bold max-w-[140px] truncate"
                      title={String(item.event_key || "")}
                    >
                      {String(item.event_key || item.id_import || "-")}
                    </td>
                    <td className="p-2.5">{String(item.tanggal)}</td>
                    <td className="p-2.5 font-bold text-white">
                      {String(item.nama)} ({String(item.id_unik)})
                    </td>
                    <td className="p-2.5 text-slate-400">
                      {String(item.divisi || "-")}
                    </td>
                    <td className="p-2.5 text-emerald-300 font-bold">
                      {String(item.jam_masuk || "-")}
                    </td>
                    <td className="p-2.5 text-amber-300 font-bold">
                      {String(item.jam_pulang || "-")}
                    </td>
                    <td className="p-2.5">
                      <span className="px-2 py-0.5 rounded bg-sky-950 border border-sky-800 text-sky-300 text-[11px]">
                        {String(item.status_kehadiran || "Hadir")}
                      </span>
                    </td>
                    <td className="p-2.5">
                      <span
                        className={`px-2 py-0.5 rounded text-[11px] font-bold ${
                          item.status_proses === "Sudah Diproses" ||
                          item.status_proses === "Berhasil"
                            ? "bg-emerald-950 text-emerald-300 border border-emerald-800"
                            : "bg-rose-950 text-rose-300 border border-rose-800"
                        }`}
                      >
                        {String(item.status_proses || item.status_absen || "-")}
                      </span>
                    </td>
                    <td
                      className="p-2.5 text-slate-400 max-w-xs truncate"
                      title={String(item.pesan_error || item.keterangan || "")}
                    >
                      {String(item.pesan_error || item.keterangan || "-")}
                    </td>
                    <td className="p-2.5 text-slate-400">
                      {String(item.kode_operator || "-")}
                    </td>
                    {hasPermission(user, "operational.delete") ? (
                      <td className="p-2.5 text-center">
                        <button
                          type="button"
                          onClick={() =>
                            setDeleteConfirm({
                              type: "import",
                              idReferensi: String(item.event_key || ""),
                              title: `Hapus Import: ${item.event_key || item.id_import}`,
                              subtitle: `${item.nama} (${item.id_unik}) · Masuk: ${item.jam_masuk || "-"}, Pulang: ${item.jam_pulang || "-"} pada ${item.tanggal}`,
                            })
                          }
                          className="px-2.5 py-1 rounded bg-rose-950/80 hover:bg-rose-900 border border-rose-800 text-rose-300 text-[11px] font-bold transition flex items-center gap-1 mx-auto"
                          title="Hapus baris import ini"
                        >
                          <span>Hapus</span>
                        </button>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-xs text-slate-500 font-mono py-4 text-center">
            Tekan &quot;Muat Data&quot; untuk menampilkan riwayat tercatat.
          </p>
        )}
      </section>

      {/* Modal Konfirmasi Hapus Riwayat */}
      {deleteConfirm ? (
        <Modal
          isOpen
          onClose={() => setDeleteConfirm(null)}
          title={
            deleteConfirm.type === "cancelBackup"
              ? "Konfirmasi Batalkan Penugasan Backup"
              : `Konfirmasi Hapus ${deleteConfirm.type === "import" ? "Import Manual" : deleteConfirm.type === "backup" ? "Penugasan Backup" : "Koreksi"}`
          }
          subtitle={deleteConfirm.title}
          maxWidth="max-w-md"
          footer={
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => setDeleteConfirm(null)}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-mono font-bold transition disabled:opacity-50"
              >
                Batal
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={handleDeleteConfirmed}
                className="px-4 py-2 rounded-xl bg-rose-500 hover:bg-rose-400 text-white text-xs font-mono font-bold transition disabled:opacity-50 flex items-center gap-1.5"
              >
                {busy ? (
                  <>
                    <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                    <span>
                      {deleteConfirm.type === "cancelBackup"
                        ? "Membatalkan..."
                        : "Menghapus..."}
                    </span>
                  </>
                ) : deleteConfirm.type === "cancelBackup" ? (
                  <span>Ya, Batalkan Backup</span>
                ) : (
                  <span>
                    Ya, Hapus{" "}
                    {deleteConfirm.type === "import"
                      ? "Import"
                      : deleteConfirm.type === "backup"
                        ? "Backup"
                        : "Koreksi"}
                  </span>
                )}
              </button>
            </div>
          }
        >
          <div className="space-y-4">
            <div className="bg-slate-950/60 p-3.5 rounded-2xl border border-slate-800 text-xs font-mono text-slate-300 space-y-1">
              <p>{deleteConfirm.subtitle}</p>
              <p className="text-amber-400 text-[11px] pt-1">
                {deleteConfirm.type === "cancelBackup"
                  ? "Penugasan yang dibatalkan tidak bisa diaktifkan lagi. Scan personil pengganti kembali memakai shift normalnya."
                  : deleteConfirm.type === "backup"
                    ? "Menghapus data penugasan backup akan menghapus riwayat penugasan ini secara permanen dan menyelaraskan kembali status backup personil jika tidak ada penugasan aktif lainnya."
                    : `Menghapus ${deleteConfirm.type === "import" ? "rekaman import" : "koreksi"} akan membatalkan efeknya pada absensi harian dan mencatat jejak audit operator.`}
              </p>
            </div>
          </div>
        </Modal>
      ) : null}
    </AppShell>
  );
}
