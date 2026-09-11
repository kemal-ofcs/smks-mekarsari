"use client";

import dynamic from "next/dynamic";
import { redirect } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { FeedbackBanner } from "@/components/ui/FeedbackBanner";
import { Icon } from "@/components/ui/Icon";
import { Modal } from "@/components/ui/Modal";
import { PageHeader } from "@/components/ui/PageHeader";
import { canAccessArea, hasPermission } from "@/lib/auth/access";
import { useAuth } from "@/lib/context/AuthContext";
import {
  aktifkanTahunAjaran,
  type GuruMapelInput,
  getDaftarJurusan,
  getDaftarMapel,
  getDaftarPenugasanGuru,
  getDaftarRombel,
  getDaftarTahunAjaran,
  hapusJurusan,
  hapusMapel,
  hapusPenugasanGuru,
  hapusRombel,
  hapusTahunAjaran,
  type JurusanInput,
  type MapelInput,
  type RombelInput,
  simpanJurusan,
  simpanMapel,
  simpanPenugasanGuru,
  simpanRombel,
  simpanTahunAjaran,
  type TahunAjaranInput,
} from "@/lib/gateways/academic";
import { getDaftarGuru } from "@/lib/gateways/teacher";
import { useConfirmDialog } from "@/lib/hooks/useConfirmDialog";

type TabKey = "tahun_ajaran" | "jurusan" | "rombel" | "mapel" | "penugasan";

/**
 * Kelima panel tab dimuat terpisah.
 *
 * Hanya satu yang dirender pada satu waktu, sehingga menaruh semuanya di bundel
 * halaman berarti empat panel yang tidak dilihat ikut diunduh. `ssr: false`
 * wajib: Desktop dan Mobile memakai `output: "export"`.
 */
const TahunAjaranPanel = dynamic(
  () =>
    import("@/components/akademik/TahunAjaranPanel").then((mod) => ({
      default: mod.TahunAjaranPanel,
    })),
  { ssr: false },
);

const JurusanPanel = dynamic(
  () =>
    import("@/components/akademik/JurusanPanel").then((mod) => ({
      default: mod.JurusanPanel,
    })),
  { ssr: false },
);

const RombelPanel = dynamic(
  () =>
    import("@/components/akademik/RombelPanel").then((mod) => ({
      default: mod.RombelPanel,
    })),
  { ssr: false },
);

const MapelPanel = dynamic(
  () =>
    import("@/components/akademik/MapelPanel").then((mod) => ({
      default: mod.MapelPanel,
    })),
  { ssr: false },
);

const PenugasanPanel = dynamic(
  () =>
    import("@/components/akademik/PenugasanPanel").then((mod) => ({
      default: mod.PenugasanPanel,
    })),
  { ssr: false },
);

export default function AkademikPage() {
  const { konfirmasi, dialogKonfirmasi } = useConfirmDialog();
  const { user, isAuthenticated, isLoading: authLoading } = useAuth();
  const canManage = hasPermission(user, "academic.manage");

  const [activeTab, setActiveTab] = useState<TabKey>("tahun_ajaran");
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState<{
    tone: "success" | "error" | "warning";
    message: string;
  } | null>(null);

  // Data states
  const [tahunAjaranList, setTahunAjaranList] = useState<
    Record<string, unknown>[]
  >([]);
  const [jurusanList, setJurusanList] = useState<Record<string, unknown>[]>([]);
  const [rombelList, setRombelList] = useState<Record<string, unknown>[]>([]);
  const [mapelList, setMapelList] = useState<Record<string, unknown>[]>([]);
  const [penugasanList, setPenugasanList] = useState<Record<string, unknown>[]>(
    [],
  );
  const [guruList, setGuruList] = useState<Record<string, unknown>[]>([]);

  // Filter states
  const [selectedTaForRombel, setSelectedTaForRombel] = useState<string>("");
  const [selectedRombelForPenugasan, setSelectedRombelForPenugasan] =
    useState<string>("");

  // Pilihan filter dibaca `loadAllData` lewat ref, bukan lewat dependency.
  // Menjadikannya dependency akan membuat `useCallback` lahir ulang setiap kali
  // filter berubah, dan efek `sppg:sync-completed` ikut terpasang ulang di
  // setiap perubahan itu.
  const selectedTaRef = useRef(selectedTaForRombel);
  const selectedRombelRef = useRef(selectedRombelForPenugasan);
  useEffect(() => {
    selectedTaRef.current = selectedTaForRombel;
    selectedRombelRef.current = selectedRombelForPenugasan;
  });

  // Modal states
  const [modalType, setModalType] = useState<TabKey | null>(null);
  const [saving, setSaving] = useState(false);

  // Form states
  const [formTA, setFormTA] = useState<TahunAjaranInput>({
    nama_tahun: "2026/2027",
    semester: "Ganjil",
    tanggal_mulai: new Date().toLocaleDateString("en-CA"),
    tanggal_selesai: new Date(Date.now() + 180 * 86400000).toLocaleDateString(
      "en-CA",
    ),
    is_aktif: 0,
  });

  const [formJurusan, setFormJurusan] = useState<JurusanInput>({
    kode_jurusan: "",
    nama_jurusan: "",
    deskripsi: "",
    is_aktif: 1,
  });

  const [formRombel, setFormRombel] = useState<RombelInput>({
    id_tahun_ajaran: "",
    tingkat: 10,
    id_jurusan: "",
    nama_rombel: "",
    id_wali_kelas: "",
    kapasitas: 36,
    ruang_kelas: "",
    is_aktif: 1,
  });

  const [formMapel, setFormMapel] = useState<MapelInput>({
    kode_mapel: "",
    nama_mapel: "",
    tingkat: 10,
    kelompok: "Wajib",
    beban_jam: 2,
    kkm: 75,
    is_aktif: 1,
  });

  const [formPenugasan, setFormPenugasan] = useState<GuruMapelInput>({
    id_tahun_ajaran: "",
    id_rombel: "",
    id_mapel: "",
    id_guru: "",
  });

  const loadAllData = useCallback(async () => {
    setLoading(true);
    try {
      const [taData, jurData, mapData, gData] = await Promise.all([
        getDaftarTahunAjaran(),
        getDaftarJurusan(),
        getDaftarMapel(),
        getDaftarGuru(),
      ]);
      setTahunAjaranList(taData);
      setJurusanList(jurData);
      setMapelList(mapData);
      setGuruList(gData);

      // Pilihan filter yang sedang dipakai operator WAJIB dipertahankan.
      // `loadAllData` juga berjalan pada setiap `sppg:sync-completed`, dan versi
      // sebelumnya selalu memuat ulang rombel untuk tahun ajaran AKTIF —
      // dropdown-nya tetap menampilkan pilihan lama sementara tabelnya sudah
      // berganti isi. Pilihan lama hanya dilepas bila barisnya memang hilang.
      const activeTa = taData.find((t) => Number(t.is_aktif) === 1);
      const fallbackTa = activeTa
        ? String(activeTa.id_tahun_ajaran)
        : taData[0]
          ? String(taData[0].id_tahun_ajaran)
          : "";
      const chosenTa = selectedTaRef.current;
      const taId =
        chosenTa && taData.some((t) => String(t.id_tahun_ajaran) === chosenTa)
          ? chosenTa
          : fallbackTa;
      setSelectedTaForRombel(taId);

      const romData = await getDaftarRombel(taId || undefined);
      setRombelList(romData);

      const chosenRombel = selectedRombelRef.current;
      const rId =
        chosenRombel &&
        romData.some((r) => String(r.id_rombel) === chosenRombel)
          ? chosenRombel
          : romData[0]
            ? String(romData[0].id_rombel)
            : "";
      setSelectedRombelForPenugasan(rId);

      const penData = await getDaftarPenugasanGuru(rId || undefined);
      setPenugasanList(penData);
    } catch (err) {
      setFeedback({
        tone: "error",
        message:
          err instanceof Error ? err.message : "Gagal memuat data akademik.",
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAllData();
  }, [loadAllData]);

  // Handle reload on sync
  useEffect(() => {
    const handleSync = () => {
      void loadAllData();
    };
    window.addEventListener("sppg:sync-completed", handleSync);
    return () => window.removeEventListener("sppg:sync-completed", handleSync);
  }, [loadAllData]);

  // Filter Rombel change
  const handleTaFilterChange = async (taId: string) => {
    setSelectedTaForRombel(taId);
    try {
      const res = await getDaftarRombel(taId || undefined);
      setRombelList(res);
    } catch (err) {
      // Diam di sini berarti daftar LAMA tetap tampil untuk tahun ajaran yang
      // BARU dipilih — pengguna mengira sedang melihat rombel tahun itu.
      setRombelList([]);
      setFeedback({
        tone: "error",
        message:
          err instanceof Error
            ? err.message
            : "Daftar rombel untuk tahun ajaran ini gagal dimuat.",
      });
    }
  };

  // Filter Penugasan change
  const handleRombelFilterChange = async (rombelId: string) => {
    setSelectedRombelForPenugasan(rombelId);
    try {
      const res = await getDaftarPenugasanGuru(rombelId || undefined);
      setPenugasanList(res);
    } catch (err) {
      // Alasan yang sama dengan filter rombel di atas: daftar basi yang
      // dibiarkan tampil lebih menyesatkan daripada daftar kosong.
      setPenugasanList([]);
      setFeedback({
        tone: "error",
        message:
          err instanceof Error
            ? err.message
            : "Daftar penugasan guru gagal dimuat.",
      });
    }
  };

  // Actions
  const handleSetActiveTA = async (id: string) => {
    if (!canManage) return;
    try {
      await aktifkanTahunAjaran(id);
      setFeedback({
        tone: "success",
        message: "Tahun ajaran aktif berhasil diperbarui.",
      });
      void loadAllData();
    } catch (err) {
      setFeedback({
        tone: "error",
        message:
          err instanceof Error
            ? err.message
            : "Gagal mengaktifkan tahun ajaran.",
      });
    }
  };

  const handleDeleteItem = async (type: TabKey, id: string) => {
    if (!canManage) return;
    const ok = await konfirmasi({
      title: "Hapus data akademik ini?",
      description:
        "Baris ini dihapus permanen dan penghapusannya ikut tersinkronisasi ke seluruh perangkat.",
      preserved:
        "Data absensi dan presensi yang sudah tercatat tidak ikut terhapus.",
      confirmLabel: "Ya, hapus",
    });
    if (!ok) return;

    try {
      if (type === "tahun_ajaran") await hapusTahunAjaran(id);
      else if (type === "jurusan") await hapusJurusan(id);
      else if (type === "rombel") await hapusRombel(id);
      else if (type === "mapel") await hapusMapel(id);
      else if (type === "penugasan") await hapusPenugasanGuru(id);

      setFeedback({ tone: "success", message: "Data berhasil dihapus." });
      void loadAllData();
    } catch (err) {
      setFeedback({
        tone: "error",
        message: err instanceof Error ? err.message : "Gagal menghapus data.",
      });
    }
  };

  const handleSaveForm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManage) return;
    setSaving(true);
    try {
      if (modalType === "tahun_ajaran") {
        await simpanTahunAjaran(formTA);
      } else if (modalType === "jurusan") {
        await simpanJurusan(formJurusan);
      } else if (modalType === "rombel") {
        await simpanRombel(formRombel);
      } else if (modalType === "mapel") {
        await simpanMapel(formMapel);
      } else if (modalType === "penugasan") {
        await simpanPenugasanGuru(formPenugasan);
      }
      setFeedback({ tone: "success", message: "Data berhasil disimpan." });
      setModalType(null);
      void loadAllData();
    } catch (err) {
      setFeedback({
        tone: "error",
        message: err instanceof Error ? err.message : "Gagal menyimpan data.",
      });
    } finally {
      setSaving(false);
    }
  };

  // Gerbang area: setiap halaman lain melakukan hal yang sama. Backend sudah
  // menegakkan izinnya lewat require_permission/requireWebPermission, tetapi
  // tanpa ini halaman struktur akademik tetap terbuka lewat URL bagi role yang tidak
  // berhak dan hanya menampilkan banner error.
  if (authLoading) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-6 text-slate-100 font-sans">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 border-4 border-sky-500 border-t-transparent rounded-full animate-spin"></div>
          <p className="text-xs text-slate-400 font-mono animate-pulse">
            Memuat Struktur Akademik...
          </p>
        </div>
      </div>
    );
  }
  if (!isAuthenticated) redirect("/login");
  if (!canAccessArea(user, "akademik")) redirect("/forbidden");

  return (
    <AppShell>
      <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6 px-4 py-6 sm:px-6">
        <PageHeader
          eyebrow="Akademik"
          title="Struktur Akademik"
          description="Manajemen tahun ajaran, jurusan, rombel, mata pelajaran, dan penugasan pengajar."
          actions={
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void loadAllData()}
                className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:bg-white/10"
              >
                <Icon name="refresh" className="size-4" />
                <span>Muat Ulang</span>
              </button>
              {canManage ? (
                <button
                  type="button"
                  onClick={() => {
                    if (activeTab === "tahun_ajaran") {
                      setFormTA({
                        nama_tahun: "2026/2027",
                        semester: "Ganjil",
                        tanggal_mulai: new Date().toLocaleDateString("en-CA"),
                        tanggal_selesai: new Date(
                          Date.now() + 180 * 86400000,
                        ).toLocaleDateString("en-CA"),
                        // Menyimpan `is_aktif = 1` menonaktifkan tahun ajaran
                        // lain di SELURUH sekolah. Dulu itu bawaan "Tambah",
                        // sehingga menyiapkan tahun depan diam-diam mengganti
                        // tahun berjalan. Kini wajib dicentang secara sadar.
                        is_aktif: 0,
                      });
                    } else if (activeTab === "jurusan") {
                      setFormJurusan({
                        kode_jurusan: "",
                        nama_jurusan: "",
                        deskripsi: "",
                        is_aktif: 1,
                      });
                    } else if (activeTab === "rombel") {
                      setFormRombel({
                        id_tahun_ajaran:
                          selectedTaForRombel ||
                          (tahunAjaranList[0]
                            ? String(tahunAjaranList[0].id_tahun_ajaran)
                            : ""),
                        tingkat: 10,
                        id_jurusan: jurusanList[0]
                          ? String(jurusanList[0].id_jurusan)
                          : "",
                        nama_rombel: "",
                        id_wali_kelas: "",
                        kapasitas: 36,
                        ruang_kelas: "",
                        is_aktif: 1,
                      });
                    } else if (activeTab === "mapel") {
                      setFormMapel({
                        kode_mapel: "",
                        nama_mapel: "",
                        tingkat: 10,
                        kelompok: "Wajib",
                        beban_jam: 2,
                        kkm: 75,
                        is_aktif: 1,
                      });
                    } else if (activeTab === "penugasan") {
                      setFormPenugasan({
                        id_tahun_ajaran:
                          selectedTaForRombel ||
                          (tahunAjaranList[0]
                            ? String(tahunAjaranList[0].id_tahun_ajaran)
                            : ""),
                        id_rombel:
                          selectedRombelForPenugasan ||
                          (rombelList[0]
                            ? String(rombelList[0].id_rombel)
                            : ""),
                        id_mapel: mapelList[0]
                          ? String(mapelList[0].id_mapel)
                          : "",
                        id_guru: guruList[0] ? String(guruList[0].id_guru) : "",
                      });
                    }
                    setModalType(activeTab);
                  }}
                  className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-sky-500 px-4 py-2 text-sm font-bold text-slate-950 shadow-lg shadow-sky-500/20 transition hover:bg-sky-400"
                >
                  <Icon name="add" className="size-4" />
                  <span>Tambah Data</span>
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

        {/* Tab Navigation */}
        <div className="flex flex-wrap items-center gap-1 rounded-2xl border border-white/10 bg-slate-900/60 p-1.5 backdrop-blur-xl">
          <button
            type="button"
            onClick={() => setActiveTab("tahun_ajaran")}
            className={`flex min-h-10 items-center gap-2 rounded-xl px-4 text-xs font-bold transition sm:text-sm ${
              activeTab === "tahun_ajaran"
                ? "bg-sky-500 text-slate-950 shadow-md shadow-sky-500/20"
                : "text-slate-300 hover:bg-white/5 hover:text-white"
            }`}
          >
            <Icon name="calendar" className="size-4" />
            <span>Tahun Ajaran</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("jurusan")}
            className={`flex min-h-10 items-center gap-2 rounded-xl px-4 text-xs font-bold transition sm:text-sm ${
              activeTab === "jurusan"
                ? "bg-sky-500 text-slate-950 shadow-md shadow-sky-500/20"
                : "text-slate-300 hover:bg-white/5 hover:text-white"
            }`}
          >
            <Icon name="tools" className="size-4" />
            <span>Jurusan</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("rombel")}
            className={`flex min-h-10 items-center gap-2 rounded-xl px-4 text-xs font-bold transition sm:text-sm ${
              activeTab === "rombel"
                ? "bg-sky-500 text-slate-950 shadow-md shadow-sky-500/20"
                : "text-slate-300 hover:bg-white/5 hover:text-white"
            }`}
          >
            <Icon name="users" className="size-4" />
            <span>Rombel / Kelas</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("mapel")}
            className={`flex min-h-10 items-center gap-2 rounded-xl px-4 text-xs font-bold transition sm:text-sm ${
              activeTab === "mapel"
                ? "bg-sky-500 text-slate-950 shadow-md shadow-sky-500/20"
                : "text-slate-300 hover:bg-white/5 hover:text-white"
            }`}
          >
            <Icon name="document" className="size-4" />
            <span>Mata Pelajaran</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("penugasan")}
            className={`flex min-h-10 items-center gap-2 rounded-xl px-4 text-xs font-bold transition sm:text-sm ${
              activeTab === "penugasan"
                ? "bg-sky-500 text-slate-950 shadow-md shadow-sky-500/20"
                : "text-slate-300 hover:bg-white/5 hover:text-white"
            }`}
          >
            <Icon name="user" className="size-4" />
            <span>Penugasan Guru</span>
          </button>
        </div>

        {/* Tab 1: Tahun Ajaran */}
        {activeTab === "tahun_ajaran" ? (
          <TahunAjaranPanel
            tahunAjaranList={tahunAjaranList}
            loading={loading}
            canManage={canManage}
            setFormTA={setFormTA}
            setModalType={setModalType}
            handleSetActiveTA={handleSetActiveTA}
            handleDeleteItem={handleDeleteItem}
          />
        ) : null}

        {/* Tab 2: Jurusan */}
        {activeTab === "jurusan" ? (
          <JurusanPanel
            jurusanList={jurusanList}
            loading={loading}
            canManage={canManage}
            setFormJurusan={setFormJurusan}
            setModalType={setModalType}
            handleDeleteItem={handleDeleteItem}
          />
        ) : null}

        {/* Tab 3: Rombel */}
        {activeTab === "rombel" ? (
          <RombelPanel
            rombelList={rombelList}
            tahunAjaranList={tahunAjaranList}
            selectedTaForRombel={selectedTaForRombel}
            loading={loading}
            canManage={canManage}
            setFormRombel={setFormRombel}
            setModalType={setModalType}
            handleTaFilterChange={handleTaFilterChange}
            handleDeleteItem={handleDeleteItem}
          />
        ) : null}

        {/* Tab 4: Mapel */}
        {activeTab === "mapel" ? (
          <MapelPanel
            mapelList={mapelList}
            loading={loading}
            canManage={canManage}
            setFormMapel={setFormMapel}
            setModalType={setModalType}
            handleDeleteItem={handleDeleteItem}
          />
        ) : null}

        {/* Tab 5: Penugasan Guru */}
        {activeTab === "penugasan" ? (
          <PenugasanPanel
            penugasanList={penugasanList}
            rombelList={rombelList}
            selectedRombelForPenugasan={selectedRombelForPenugasan}
            loading={loading}
            canManage={canManage}
            handleRombelFilterChange={handleRombelFilterChange}
            handleDeleteItem={handleDeleteItem}
          />
        ) : null}

        {/* Modal Form */}
        {modalType ? (
          <Modal
            isOpen={true}
            onClose={() => setModalType(null)}
            title={
              modalType === "tahun_ajaran"
                ? "Kelola Tahun Ajaran"
                : modalType === "jurusan"
                  ? "Kelola Program Keahlian / Jurusan"
                  : modalType === "rombel"
                    ? "Kelola Rombel / Kelas"
                    : modalType === "mapel"
                      ? "Kelola Mata Pelajaran"
                      : "Kelola Penugasan Guru"
            }
            maxWidth="max-w-xl"
          >
            <form
              onSubmit={(e) => void handleSaveForm(e)}
              className="flex flex-col gap-4 py-2"
            >
              {modalType === "tahun_ajaran" ? (
                <>
                  <div>
                    <label
                      htmlFor="ta-nama"
                      className="block text-xs font-semibold text-slate-300"
                    >
                      Nama Tahun Ajaran (cth: 2026/2027)
                    </label>
                    <input
                      id="ta-nama"
                      type="text"
                      required
                      value={formTA.nama_tahun}
                      onChange={(e) =>
                        setFormTA({ ...formTA, nama_tahun: e.target.value })
                      }
                      className="mt-1 w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-sky-500 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="ta-semester"
                      className="block text-xs font-semibold text-slate-300"
                    >
                      Semester
                    </label>
                    <select
                      id="ta-semester"
                      value={formTA.semester}
                      onChange={(e) =>
                        setFormTA({
                          ...formTA,
                          semester:
                            e.target.value === "Genap" ? "Genap" : "Ganjil",
                        })
                      }
                      className="mt-1 w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-sky-500 focus:outline-none"
                    >
                      <option
                        value="Ganjil"
                        className="bg-slate-900 text-slate-100"
                      >
                        Ganjil
                      </option>
                      <option
                        value="Genap"
                        className="bg-slate-900 text-slate-100"
                      >
                        Genap
                      </option>
                    </select>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label
                        htmlFor="ta-mulai"
                        className="block text-xs font-semibold text-slate-300"
                      >
                        Tanggal Mulai
                      </label>
                      <input
                        id="ta-mulai"
                        type="date"
                        required
                        value={formTA.tanggal_mulai}
                        onChange={(e) =>
                          setFormTA({
                            ...formTA,
                            tanggal_mulai: e.target.value,
                          })
                        }
                        className="mt-1 w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-sky-500 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label
                        htmlFor="ta-selesai"
                        className="block text-xs font-semibold text-slate-300"
                      >
                        Tanggal Selesai
                      </label>
                      <input
                        id="ta-selesai"
                        type="date"
                        required
                        value={formTA.tanggal_selesai}
                        onChange={(e) =>
                          setFormTA({
                            ...formTA,
                            tanggal_selesai: e.target.value,
                          })
                        }
                        className="mt-1 w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-sky-500 focus:outline-none"
                      />
                    </div>
                  </div>
                  {formTA.id_tahun_ajaran ? null : (
                    <label
                      htmlFor="ta-aktif"
                      className="flex items-start gap-3 rounded-xl border border-white/10 bg-slate-900/60 p-3"
                    >
                      <input
                        id="ta-aktif"
                        type="checkbox"
                        checked={formTA.is_aktif === 1}
                        onChange={(e) =>
                          setFormTA({
                            ...formTA,
                            is_aktif: e.target.checked ? 1 : 0,
                          })
                        }
                        className="mt-0.5 size-4 accent-sky-500"
                      />
                      <span>
                        <span className="block text-xs font-semibold text-slate-200">
                          Langsung jadikan tahun ajaran aktif
                        </span>
                        <span className="block text-[11px] text-slate-400">
                          Tahun ajaran aktif yang lama otomatis dinonaktifkan di
                          semua perangkat. Biarkan mati bila Anda hanya
                          menyiapkan tahun depan.
                        </span>
                      </span>
                    </label>
                  )}
                </>
              ) : null}

              {modalType === "jurusan" ? (
                <>
                  <div>
                    <label
                      htmlFor="jur-kode"
                      className="block text-xs font-semibold text-slate-300"
                    >
                      Kode Jurusan (cth: RPL, TKJ, AKL)
                    </label>
                    <input
                      id="jur-kode"
                      type="text"
                      required
                      value={formJurusan.kode_jurusan}
                      onChange={(e) =>
                        setFormJurusan({
                          ...formJurusan,
                          kode_jurusan: e.target.value,
                        })
                      }
                      className="mt-1 w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-sky-500 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="jur-nama"
                      className="block text-xs font-semibold text-slate-300"
                    >
                      Nama Lengkap Jurusan
                    </label>
                    <input
                      id="jur-nama"
                      type="text"
                      required
                      value={formJurusan.nama_jurusan}
                      onChange={(e) =>
                        setFormJurusan({
                          ...formJurusan,
                          nama_jurusan: e.target.value,
                        })
                      }
                      className="mt-1 w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-sky-500 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="jur-deskripsi"
                      className="block text-xs font-semibold text-slate-300"
                    >
                      Deskripsi / Kompetensi
                    </label>
                    <textarea
                      id="jur-deskripsi"
                      rows={3}
                      value={formJurusan.deskripsi || ""}
                      onChange={(e) =>
                        setFormJurusan({
                          ...formJurusan,
                          deskripsi: e.target.value,
                        })
                      }
                      className="mt-1 w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-sky-500 focus:outline-none"
                    />
                  </div>
                </>
              ) : null}

              {modalType === "rombel" ? (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label
                        htmlFor="rom-ta"
                        className="block text-xs font-semibold text-slate-300"
                      >
                        Tahun Ajaran
                      </label>
                      <select
                        id="rom-ta"
                        value={formRombel.id_tahun_ajaran}
                        onChange={(e) =>
                          setFormRombel({
                            ...formRombel,
                            id_tahun_ajaran: e.target.value,
                          })
                        }
                        className="mt-1 w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-sky-500 focus:outline-none"
                      >
                        {tahunAjaranList.map((ta) => (
                          <option
                            key={String(ta.id_tahun_ajaran)}
                            value={String(ta.id_tahun_ajaran)}
                            className="bg-slate-900 text-slate-100"
                          >
                            {String(ta.nama_tahun)} ({String(ta.semester)})
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label
                        htmlFor="rom-tingkat"
                        className="block text-xs font-semibold text-slate-300"
                      >
                        Tingkat
                      </label>
                      <select
                        id="rom-tingkat"
                        value={formRombel.tingkat}
                        onChange={(e) =>
                          setFormRombel({
                            ...formRombel,
                            tingkat: Number(e.target.value),
                          })
                        }
                        className="mt-1 w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-sky-500 focus:outline-none"
                      >
                        <option
                          value={10}
                          className="bg-slate-900 text-slate-100"
                        >
                          Kelas 10
                        </option>
                        <option
                          value={11}
                          className="bg-slate-900 text-slate-100"
                        >
                          Kelas 11
                        </option>
                        <option
                          value={12}
                          className="bg-slate-900 text-slate-100"
                        >
                          Kelas 12
                        </option>
                      </select>
                    </div>
                  </div>
                  <div>
                    <label
                      htmlFor="rom-jur"
                      className="block text-xs font-semibold text-slate-300"
                    >
                      Jurusan
                    </label>
                    <select
                      id="rom-jur"
                      value={formRombel.id_jurusan || ""}
                      onChange={(e) =>
                        setFormRombel({
                          ...formRombel,
                          id_jurusan: e.target.value,
                        })
                      }
                      className="mt-1 w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-sky-500 focus:outline-none"
                    >
                      <option value="" className="bg-slate-900 text-slate-100">
                        Umum / Tidak Berjurusan
                      </option>
                      {jurusanList.map((j) => (
                        <option
                          key={String(j.id_jurusan)}
                          value={String(j.id_jurusan)}
                          className="bg-slate-900 text-slate-100"
                        >
                          {String(j.kode_jurusan)} - {String(j.nama_jurusan)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label
                      htmlFor="rom-nama"
                      className="block text-xs font-semibold text-slate-300"
                    >
                      Nama Rombel (cth: X RPL 1)
                    </label>
                    <input
                      id="rom-nama"
                      type="text"
                      required
                      value={formRombel.nama_rombel}
                      onChange={(e) =>
                        setFormRombel({
                          ...formRombel,
                          nama_rombel: e.target.value,
                        })
                      }
                      className="mt-1 w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-sky-500 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="rom-wali"
                      className="block text-xs font-semibold text-slate-300"
                    >
                      Wali Kelas
                    </label>
                    <select
                      id="rom-wali"
                      value={formRombel.id_wali_kelas || ""}
                      onChange={(e) =>
                        setFormRombel({
                          ...formRombel,
                          id_wali_kelas: e.target.value,
                        })
                      }
                      className="mt-1 w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-sky-500 focus:outline-none"
                    >
                      <option value="" className="bg-slate-900 text-slate-100">
                        Belum Ditentukan
                      </option>
                      {guruList.map((g) => (
                        <option
                          key={String(g.id_guru)}
                          value={String(g.id_guru)}
                          className="bg-slate-900 text-slate-100"
                        >
                          {String(g.nama)} {g.nip ? `(${String(g.nip)})` : ""}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label
                        htmlFor="rom-ruang"
                        className="block text-xs font-semibold text-slate-300"
                      >
                        Ruang Kelas
                      </label>
                      <input
                        id="rom-ruang"
                        type="text"
                        value={formRombel.ruang_kelas || ""}
                        onChange={(e) =>
                          setFormRombel({
                            ...formRombel,
                            ruang_kelas: e.target.value,
                          })
                        }
                        className="mt-1 w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-sky-500 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label
                        htmlFor="rom-kapasitas"
                        className="block text-xs font-semibold text-slate-300"
                      >
                        Kapasitas Siswa
                      </label>
                      <input
                        id="rom-kapasitas"
                        type="number"
                        min={1}
                        max={60}
                        value={formRombel.kapasitas}
                        onChange={(e) =>
                          setFormRombel({
                            ...formRombel,
                            kapasitas: Number(e.target.value),
                          })
                        }
                        className="mt-1 w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-sky-500 focus:outline-none"
                      />
                    </div>
                  </div>
                </>
              ) : null}

              {modalType === "mapel" ? (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label
                        htmlFor="map-kode"
                        className="block text-xs font-semibold text-slate-300"
                      >
                        Kode Mapel (cth: MAT, IND, PBO)
                      </label>
                      <input
                        id="map-kode"
                        type="text"
                        required
                        value={formMapel.kode_mapel}
                        onChange={(e) =>
                          setFormMapel({
                            ...formMapel,
                            kode_mapel: e.target.value,
                          })
                        }
                        className="mt-1 w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-sky-500 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label
                        htmlFor="map-kelompok"
                        className="block text-xs font-semibold text-slate-300"
                      >
                        Kelompok
                      </label>
                      <select
                        id="map-kelompok"
                        value={formMapel.kelompok}
                        onChange={(e) => {
                          const val = (
                            e.target.value === "Peminatan" ||
                            e.target.value === "Muatan Lokal" ||
                            e.target.value === "Kejuruan"
                              ? e.target.value
                              : "Wajib"
                          ) as
                            | "Wajib"
                            | "Peminatan"
                            | "Muatan Lokal"
                            | "Kejuruan";
                          setFormMapel({ ...formMapel, kelompok: val });
                        }}
                        className="mt-1 w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-sky-500 focus:outline-none"
                      >
                        <option
                          value="Wajib"
                          className="bg-slate-900 text-slate-100"
                        >
                          Wajib (Umum)
                        </option>
                        <option
                          value="Peminatan"
                          className="bg-slate-900 text-slate-100"
                        >
                          Peminatan Kejuruan
                        </option>
                        <option
                          value="Muatan Lokal"
                          className="bg-slate-900 text-slate-100"
                        >
                          Muatan Lokal
                        </option>
                        <option
                          value="Kejuruan"
                          className="bg-slate-900 text-slate-100"
                        >
                          Kejuruan
                        </option>
                      </select>
                    </div>
                  </div>
                  <div>
                    <label
                      htmlFor="map-nama"
                      className="block text-xs font-semibold text-slate-300"
                    >
                      Nama Mata Pelajaran
                    </label>
                    <input
                      id="map-nama"
                      type="text"
                      required
                      value={formMapel.nama_mapel}
                      onChange={(e) =>
                        setFormMapel({
                          ...formMapel,
                          nama_mapel: e.target.value,
                        })
                      }
                      className="mt-1 w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-sky-500 focus:outline-none"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label
                        htmlFor="map-beban"
                        className="block text-xs font-semibold text-slate-300"
                      >
                        Beban Jam (JP / Minggu)
                      </label>
                      <input
                        id="map-beban"
                        type="number"
                        min={1}
                        max={10}
                        value={formMapel.beban_jam}
                        onChange={(e) =>
                          setFormMapel({
                            ...formMapel,
                            beban_jam: Number(e.target.value),
                          })
                        }
                        className="mt-1 w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-sky-500 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label
                        htmlFor="map-kkm"
                        className="block text-xs font-semibold text-slate-300"
                      >
                        KKM (Ketuntasan Minimal)
                      </label>
                      <input
                        id="map-kkm"
                        type="number"
                        min={50}
                        max={100}
                        value={formMapel.kkm}
                        onChange={(e) =>
                          setFormMapel({
                            ...formMapel,
                            kkm: Number(e.target.value),
                          })
                        }
                        className="mt-1 w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-sky-500 focus:outline-none"
                      />
                    </div>
                  </div>
                </>
              ) : null}

              {modalType === "penugasan" ? (
                <>
                  <div>
                    <label
                      htmlFor="pen-ta"
                      className="block text-xs font-semibold text-slate-300"
                    >
                      Tahun Ajaran
                    </label>
                    <select
                      id="pen-ta"
                      value={formPenugasan.id_tahun_ajaran}
                      onChange={(e) =>
                        setFormPenugasan({
                          ...formPenugasan,
                          id_tahun_ajaran: e.target.value,
                        })
                      }
                      className="mt-1 w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-sky-500 focus:outline-none"
                    >
                      {tahunAjaranList.map((ta) => (
                        <option
                          key={String(ta.id_tahun_ajaran)}
                          value={String(ta.id_tahun_ajaran)}
                          className="bg-slate-900 text-slate-100"
                        >
                          {String(ta.nama_tahun)} ({String(ta.semester)})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label
                      htmlFor="pen-rombel"
                      className="block text-xs font-semibold text-slate-300"
                    >
                      Rombel / Kelas
                    </label>
                    <select
                      id="pen-rombel"
                      value={formPenugasan.id_rombel}
                      onChange={(e) =>
                        setFormPenugasan({
                          ...formPenugasan,
                          id_rombel: e.target.value,
                        })
                      }
                      className="mt-1 w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-sky-500 focus:outline-none"
                    >
                      {rombelList.map((rom) => (
                        <option
                          key={String(rom.id_rombel)}
                          value={String(rom.id_rombel)}
                          className="bg-slate-900 text-slate-100"
                        >
                          Kelas {String(rom.tingkat)} -{" "}
                          {String(rom.nama_rombel)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label
                      htmlFor="pen-mapel"
                      className="block text-xs font-semibold text-slate-300"
                    >
                      Mata Pelajaran
                    </label>
                    <select
                      id="pen-mapel"
                      value={formPenugasan.id_mapel}
                      onChange={(e) =>
                        setFormPenugasan({
                          ...formPenugasan,
                          id_mapel: e.target.value,
                        })
                      }
                      className="mt-1 w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-sky-500 focus:outline-none"
                    >
                      {mapelList.map((m) => (
                        <option
                          key={String(m.id_mapel)}
                          value={String(m.id_mapel)}
                          className="bg-slate-900 text-slate-100"
                        >
                          {String(m.kode_mapel)} - {String(m.nama_mapel)} (
                          {String(m.beban_jam)} JP)
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label
                      htmlFor="pen-guru"
                      className="block text-xs font-semibold text-slate-300"
                    >
                      Guru Pengampu
                    </label>
                    <select
                      id="pen-guru"
                      value={formPenugasan.id_guru}
                      onChange={(e) =>
                        setFormPenugasan({
                          ...formPenugasan,
                          id_guru: e.target.value,
                        })
                      }
                      className="mt-1 w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-sky-500 focus:outline-none"
                    >
                      {guruList.map((g) => (
                        <option
                          key={String(g.id_guru)}
                          value={String(g.id_guru)}
                          className="bg-slate-900 text-slate-100"
                        >
                          {String(g.nama)} {g.nip ? `(${String(g.nip)})` : ""}
                        </option>
                      ))}
                    </select>
                  </div>
                </>
              ) : null}

              <div className="mt-4 flex items-center justify-end gap-2 border-t border-white/10 pt-4">
                <button
                  type="button"
                  onClick={() => setModalType(null)}
                  className="rounded-xl border border-white/10 px-4 py-2 text-sm font-semibold text-slate-300 hover:bg-white/5"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-xl bg-sky-500 px-5 py-2 text-sm font-bold text-slate-950 shadow-lg shadow-sky-500/20 hover:bg-sky-400 disabled:opacity-50"
                >
                  {saving ? "Menyimpan..." : "Simpan"}
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
