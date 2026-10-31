"use client";

import { redirect } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { PengaturanNilai } from "@/components/nilai/PengaturanNilai";
import { RekapNilai } from "@/components/nilai/RekapNilai";
import { FeedbackBanner } from "@/components/ui/FeedbackBanner";
import { Modal } from "@/components/ui/Modal";
import { PageHeader } from "@/components/ui/PageHeader";
import { PilihCari } from "@/components/ui/PilihCari";
import { formatTanggalOperasional } from "@/lib/attendance/time-policy";
import { canAccessArea, hasPermission } from "@/lib/auth/access";
import { useAuth } from "@/lib/context/AuthContext";
import {
  getDaftarMapel,
  getDaftarRombel,
  getDaftarTahunAjaran,
} from "@/lib/gateways/academic";
import {
  daftarPenilaian,
  getKonfigurasiNilai,
  getPenilaian,
  hapusPenilaian,
  type JenisNilaiItem,
  type PenilaianDetail,
  type PenilaianItem,
  simpanNilai,
  simpanPenilaian,
} from "@/lib/gateways/grades";
import { useConfirmDialog } from "@/lib/hooks/useConfirmDialog";
import {
  BATAS_DAFTAR_PENILAIAN,
  SEMESTER_LIST,
  type Semester,
} from "@/types/grades";

interface Opsi {
  id: string;
  nama: string;
}

const DRAFT_KOSONG = {
  id_jenis: "",
  nama_penilaian: "",
  tanggal: formatTanggalOperasional(Date.now()),
  bobot: 1,
  nilai_maks: 100,
};

export default function NilaiPage() {
  const { user, isAuthenticated, isLoading: authLoading } = useAuth();
  const { konfirmasi, dialogKonfirmasi } = useConfirmDialog();
  const id = useId();

  const [galat, setGalat] = useState<string | null>(null);
  const [kabar, setKabar] = useState<string | null>(null);
  const [memuat, setMemuat] = useState(false);

  const [tahunAjaran, setTahunAjaran] = useState<Opsi[]>([]);
  const [rombel, setRombel] = useState<Opsi[]>([]);
  const [mapel, setMapel] = useState<Opsi[]>([]);

  const [idTahunAjaran, setIdTahunAjaran] = useState("");
  const [semester, setSemester] = useState<Semester>("Ganjil");
  const [idRombel, setIdRombel] = useState("");
  const [idMapel, setIdMapel] = useState("");
  const [jenis, setJenis] = useState("");
  const [daftarJenis, setDaftarJenis] = useState<JenisNilaiItem[]>([]);
  const [tab, setTab] = useState<"penilaian" | "rekap" | "pengaturan">(
    "penilaian",
  );

  const [penilaian, setPenilaian] = useState<PenilaianItem[]>([]);
  const [detail, setDetail] = useState<PenilaianDetail | null>(null);
  const [skor, setSkor] = useState<Record<string, string>>({});
  const [cari, setCari] = useState("");
  const [modalBaru, setModalBaru] = useState(false);
  const [draft, setDraft] = useState(DRAFT_KOSONG);

  /**
   * Penjaga klik ganda (aturan 5, ditegakkan `audit:ui-guard`).
   *
   * `useRef`, bukan state: state baru terlihat setelah render berikutnya,
   * sehingga dua klik cepat sama-sama membaca `false`. Pada tombol "Simpan
   * nilai" akibatnya dua batch outbox untuk kelas yang sama — dan keduanya
   * benar-benar terkirim, karena outbox tidak tahu keduanya duplikat.
   */
  const isSubmittingRef = useRef(false);

  useEffect(() => {
    if (authLoading || !isAuthenticated) return;
    Promise.all([getDaftarTahunAjaran(), getDaftarRombel(), getDaftarMapel()])
      .then(([ta, rb, mp]) => {
        const petakan = (rows: unknown[], idKey: string, namaKey: string) =>
          (rows as Record<string, unknown>[]).map((row) => ({
            id: String(row[idKey] ?? ""),
            nama: String(row[namaKey] ?? ""),
          }));
        const daftarTa = petakan(
          ta as unknown[],
          "id_tahun_ajaran",
          "nama_tahun",
        );
        setTahunAjaran(daftarTa);
        setRombel(petakan(rb as unknown[], "id_rombel", "nama_rombel"));
        setMapel(petakan(mp as unknown[], "id_mapel", "nama_mapel"));
        if (daftarTa[0]) setIdTahunAjaran(daftarTa[0].id);
      })
      .catch((error) => {
        // Tanpa daftar ini halaman tidak bisa dipakai sama sekali, jadi
        // kegagalannya ditampilkan — bukan disimpan diam-diam ke konsol.
        setGalat(
          error instanceof Error
            ? error.message
            : "Gagal memuat daftar akademik.",
        );
      });
  }, [authLoading, isAuthenticated]);

  const muatJenis = useCallback(async () => {
    try {
      const hasil = await getKonfigurasiNilai();
      setDaftarJenis(hasil.jenis);
      const aktif = hasil.jenis.filter((j) => j.is_aktif === 1);
      setDraft((d) =>
        aktif.some((j) => j.id_jenis === d.id_jenis)
          ? d
          : {
              ...d,
              id_jenis:
                (aktif.find((j) => j.id_jenis === "jns-uh") ?? aktif[0])
                  ?.id_jenis ?? "",
            },
      );
    } catch (error) {
      setGalat(
        error instanceof Error
          ? error.message
          : "Gagal memuat jenis penilaian.",
      );
    }
  }, []);

  useEffect(() => {
    if (!authLoading && isAuthenticated) void muatJenis();
  }, [authLoading, isAuthenticated, muatJenis]);

  const muatPenilaian = useCallback(async () => {
    if (!idTahunAjaran) {
      setPenilaian([]);
      return;
    }
    setMemuat(true);
    setGalat(null);
    try {
      const hasil = await daftarPenilaian({
        id_tahun_ajaran: idTahunAjaran,
        semester,
        id_rombel: idRombel || null,
        id_mapel: idMapel || null,
        jenis: jenis || null,
      });
      setPenilaian(hasil.items);
    } catch (error) {
      setGalat(
        error instanceof Error
          ? error.message
          : "Gagal memuat daftar penilaian.",
      );
      setPenilaian([]);
    } finally {
      setMemuat(false);
    }
  }, [idTahunAjaran, semester, idRombel, idMapel, jenis]);

  useEffect(() => {
    void muatPenilaian();
  }, [muatPenilaian]);

  async function bukaDetail(idPenilaian: string) {
    setGalat(null);
    try {
      const hasil = await getPenilaian(idPenilaian);
      setDetail(hasil);
      // String, bukan number: kolom kosong harus bisa dibedakan dari nol.
      setSkor(
        Object.fromEntries(
          hasil.items.map((item) => [
            item.id_siswa,
            item.skor === null ? "" : String(item.skor),
          ]),
        ),
      );
    } catch (error) {
      setGalat(error instanceof Error ? error.message : "Detail gagal dimuat.");
    }
  }

  async function simpanSemuaNilai() {
    if (!detail) return;
    if (isSubmittingRef.current) return;
    isSubmittingRef.current = true;
    setGalat(null);

    try {
      await simpanNilai({
        id_penilaian: detail.penilaian.id_penilaian,
        items: detail.items.map((item) => {
          const mentah = (skor[item.id_siswa] ?? "").trim();
          return {
            id_siswa: item.id_siswa,
            // Kolom kosong dikirim sebagai `null` — BELUM DINILAI, bukan nol.
            skor: mentah === "" ? null : Number(mentah),
          };
        }),
      });
      setKabar("Nilai tersimpan.");
      await muatPenilaian();
      await bukaDetail(detail.penilaian.id_penilaian);
    } catch (error) {
      setGalat(
        error instanceof Error ? error.message : "Nilai gagal disimpan.",
      );
    } finally {
      isSubmittingRef.current = false;
    }
  }

  async function buatPenilaian(peristiwa: React.FormEvent<HTMLFormElement>) {
    peristiwa.preventDefault();
    if (isSubmittingRef.current) return;
    isSubmittingRef.current = true;
    setGalat(null);

    try {
      await simpanPenilaian({
        id_tahun_ajaran: idTahunAjaran,
        semester,
        id_rombel: idRombel,
        id_mapel: idMapel,
        id_guru: String(user?.username ?? ""),
        id_jenis: draft.id_jenis,
        nama_penilaian: draft.nama_penilaian,
        tanggal: draft.tanggal,
        bobot: draft.bobot,
        nilai_maks: draft.nilai_maks,
      });
      setKabar("Penilaian dibuat.");
      setModalBaru(false);
      setDraft((d) => ({ ...DRAFT_KOSONG, id_jenis: d.id_jenis }));
      await muatPenilaian();
    } catch (error) {
      setGalat(
        error instanceof Error ? error.message : "Penilaian gagal dibuat.",
      );
    } finally {
      isSubmittingRef.current = false;
    }
  }

  async function hapus(item: PenilaianItem) {
    const setuju = await konfirmasi({
      title: "Hapus penilaian ini?",
      description: (
        <>
          Skor <strong>seluruh kelas</strong> untuk penilaian{" "}
          <strong>{item.nama_penilaian}</strong> ikut terhapus permanen. Tidak
          ada jalan memulihkannya selain menilai ulang satu per satu.
        </>
      ),
      preserved: "Penilaian lain pada mata pelajaran ini tidak terpengaruh.",
      confirmLabel: "Hapus permanen",
      tone: "danger",
    });
    if (!setuju) return;

    if (isSubmittingRef.current) return;
    isSubmittingRef.current = true;
    setGalat(null);
    try {
      await hapusPenilaian(item.id_penilaian);
      setKabar("Penilaian dihapus.");
      setDetail(null);
      await muatPenilaian();
    } catch (error) {
      setGalat(
        error instanceof Error ? error.message : "Penilaian gagal dihapus.",
      );
    } finally {
      isSubmittingRef.current = false;
    }
  }

  if (authLoading) {
    return (
      <AppShell>
        <p className="text-slate-400 text-sm">Memuat…</p>
      </AppShell>
    );
  }

  if (!isAuthenticated) {
    redirect("/login");
  }

  if (!canAccessArea(user, "nilai")) {
    redirect("/forbidden");
  }

  const bolehKelola = hasPermission(user, "grades.manage");
  const bolehHapus = hasPermission(user, "grades.delete");
  const semuaRombel = !idRombel;

  // Pencarian hanya menyaring TAMPILAN. "Simpan nilai" tetap mengirim seluruh
  // roster dari `detail.items`; mengirim baris yang tampil saja akan
  // mengosongkan skor anak yang sedang tersaring keluar.
  const kataCari = cari.trim().toLowerCase();
  const barisSkor = (detail?.items ?? []).filter(
    (item) =>
      !kataCari ||
      item.nama_lengkap.toLowerCase().includes(kataCari) ||
      item.nis.toLowerCase().includes(kataCari),
  );

  return (
    <AppShell>
      <div className="space-y-6">
        <PageHeader
          actions={
            tab === "penilaian" && bolehKelola && idRombel && idMapel ? (
              <button
                className="rounded-lg bg-amber-500 px-4 py-2 font-semibold text-slate-950 text-sm"
                onClick={() => setModalBaru(true)}
                type="button"
              >
                Penilaian Baru
              </button>
            ) : null
          }
          description="Mencatat penilaian dan menginput nilai siswa per mata pelajaran. Data nilai ikut sinkronisasi, sehingga halaman ini bekerja penuh tanpa jaringan."
          eyebrow="Akademik"
          title="Nilai Akademik"
        />

        {galat ? (
          <FeedbackBanner onDismiss={() => setGalat(null)} tone="error">
            {galat}
          </FeedbackBanner>
        ) : null}
        {kabar ? (
          <FeedbackBanner onDismiss={() => setKabar(null)} tone="success">
            {kabar}
          </FeedbackBanner>
        ) : null}

        <section className="grid gap-3 rounded-xl border border-white/10 bg-slate-900/95 p-4 sm:grid-cols-3 lg:grid-cols-5">
          <div>
            <label
              className="block text-slate-400 text-xs"
              htmlFor={`${id}-ta`}
            >
              Tahun ajaran
            </label>
            <PilihCari
              className="mt-1 w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white"
              id={`${id}-ta`}
              onChange={(e) => setIdTahunAjaran(e.target.value)}
              value={idTahunAjaran}
            >
              <option value="">Pilih tahun ajaran</option>
              {tahunAjaran.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.nama}
                </option>
              ))}
            </PilihCari>
          </div>
          <div>
            <label
              className="block text-slate-400 text-xs"
              htmlFor={`${id}-semester`}
            >
              Semester
            </label>
            <select
              className="mt-1 w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white"
              id={`${id}-semester`}
              onChange={(e) => setSemester(e.target.value as Semester)}
              value={semester}
            >
              {SEMESTER_LIST.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label
              className="block text-slate-400 text-xs"
              htmlFor={`${id}-rombel`}
            >
              Rombel
            </label>
            <PilihCari
              className="mt-1 w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white"
              id={`${id}-rombel`}
              onChange={(e) => setIdRombel(e.target.value)}
              value={idRombel}
            >
              <option value="">Semua rombel</option>
              {rombel.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.nama}
                </option>
              ))}
            </PilihCari>
          </div>
          <div>
            <label
              className="block text-slate-400 text-xs"
              htmlFor={`${id}-mapel`}
            >
              Mata pelajaran
            </label>
            <PilihCari
              className="mt-1 w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white"
              id={`${id}-mapel`}
              onChange={(e) => setIdMapel(e.target.value)}
              value={idMapel}
            >
              <option value="">Semua mata pelajaran</option>
              {mapel.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.nama}
                </option>
              ))}
            </PilihCari>
          </div>
          <div>
            <label
              className="block text-slate-400 text-xs"
              htmlFor={`${id}-filter-jenis`}
            >
              Jenis penilaian
            </label>
            <PilihCari
              className="mt-1 w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white"
              id={`${id}-filter-jenis`}
              onChange={(e) => setJenis(e.target.value)}
              value={jenis}
            >
              <option value="">Semua jenis</option>
              {daftarJenis.map((item) => (
                <option key={item.id_jenis} value={item.id_jenis}>
                  {item.nama}
                  {item.is_aktif === 1 ? "" : " (nonaktif)"}
                </option>
              ))}
            </PilihCari>
          </div>
        </section>

        <div
          aria-label="Bagian nilai"
          className="flex gap-1 overflow-x-auto rounded-xl border border-white/10 bg-slate-900/60 p-1"
          role="tablist"
        >
          {(
            [
              ["penilaian", "Penilaian"],
              ["rekap", "Rekap Nilai Akhir"],
              ["pengaturan", "Pengaturan Nilai"],
            ] as const
          ).map(([kunci, label]) => (
            <button
              aria-selected={tab === kunci}
              className={`min-h-11 flex-1 whitespace-nowrap rounded-lg px-4 py-2 font-medium text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 ${
                tab === kunci
                  ? "bg-amber-500 text-slate-950"
                  : "text-slate-300 hover:bg-slate-800"
              }`}
              key={kunci}
              aria-controls="panel-nilai"
              id={`tab-nilai-${kunci}`}
              onClick={() => setTab(kunci)}
              role="tab"
              type="button"
            >
              {label}
            </button>
          ))}
        </div>

        <div
          aria-labelledby={`tab-nilai-${tab}`}
          id="panel-nilai"
          role="tabpanel"
        >
          {tab === "rekap" ? (
            <RekapNilai
              idMapel={idMapel}
              idRombel={idRombel}
              namaRombel={rombel.find((r) => r.id === idRombel)?.nama ?? ""}
              namaTahun={
                tahunAjaran.find((t) => t.id === idTahunAjaran)?.nama ?? ""
              }
              idTahunAjaran={idTahunAjaran}
              semester={semester}
            />
          ) : tab === "pengaturan" ? (
            <PengaturanNilai
              bolehAtur={hasPermission(user, "grades.configure")}
              onBerubah={(pesan) => {
                setKabar(pesan);
                void muatJenis();
              }}
            />
          ) : (
            <section className="rounded-xl border border-white/10 bg-slate-900/95 p-4">
              {memuat ? (
                <p className="text-slate-400 text-sm">Memuat penilaian…</p>
              ) : penilaian.length === 0 ? (
                <p className="text-slate-400 text-sm">
                  Belum ada penilaian yang cocok dengan filter ini.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="text-slate-400 text-xs uppercase">
                      <tr>
                        <th className="py-2">Tanggal</th>
                        {semuaRombel ? <th className="py-2">Kelas</th> : null}
                        <th className="py-2">Penilaian</th>
                        <th className="py-2">Jenis</th>
                        <th className="py-2">Mapel</th>
                        <th className="py-2">Dinilai</th>
                        <th className="py-2">Rata-rata</th>
                        <th className="py-2">Aksi</th>
                      </tr>
                    </thead>
                    <tbody>
                      {penilaian.map((item) => (
                        <tr
                          className="border-white/5 border-t"
                          key={item.id_penilaian}
                        >
                          <td className="py-2 text-slate-400">
                            {item.tanggal}
                          </td>
                          {semuaRombel ? (
                            <td className="py-2 text-slate-300">
                              {item.nama_rombel}
                            </td>
                          ) : null}
                          <td className="py-2 text-white">
                            {item.nama_penilaian}
                          </td>
                          <td className="py-2 text-slate-400">
                            {item.nama_jenis}
                          </td>
                          <td className="py-2 text-slate-400">
                            {item.nama_mapel}
                          </td>
                          <td className="py-2 text-slate-300">
                            {item.jumlah_dinilai} / {item.jumlah_siswa}
                          </td>
                          <td className="py-2 text-slate-300">
                            {/* `null` = belum ada satu pun skor. Menampilkan "0"
                            di sini akan membuat kelas yang belum dinilai
                            tampak gagal total. */}
                            {item.rata_rata === null
                              ? "—"
                              : item.rata_rata.toFixed(1)}
                          </td>
                          <td className="py-2">
                            <div className="flex gap-2">
                              <button
                                className="rounded-md border border-white/15 px-2 py-1 text-white text-xs"
                                onClick={() =>
                                  void bukaDetail(item.id_penilaian)
                                }
                                type="button"
                              >
                                Input Nilai
                              </button>
                              {bolehHapus ? (
                                <button
                                  className="rounded-md border border-rose-500/40 px-2 py-1 text-rose-300 text-xs"
                                  onClick={() => void hapus(item)}
                                  type="button"
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
                  {penilaian.length >= BATAS_DAFTAR_PENILAIAN ? (
                    <p className="mt-3 text-slate-400 text-xs">
                      Hanya {BATAS_DAFTAR_PENILAIAN} penilaian terbaru yang
                      ditampilkan. Pilih rombel, mata pelajaran, atau jenis
                      untuk mempersempit daftar.
                    </p>
                  ) : null}
                </div>
              )}
            </section>
          )}
        </div>
      </div>

      <Modal
        isOpen={detail !== null}
        onClose={() => {
          setDetail(null);
          setCari("");
        }}
        title={detail?.penilaian.nama_penilaian ?? "Input Nilai"}
      >
        {detail ? (
          <div className="space-y-4 text-sm">
            <p className="text-slate-400">
              {detail.penilaian.nama_rombel} · {detail.penilaian.nama_mapel} ·
              KKTP {detail.penilaian.kkm} · nilai maksimum{" "}
              {detail.penilaian.nilai_maks}
            </p>
            <p className="text-slate-400 text-xs leading-relaxed">
              Kolom yang dikosongkan berarti belum dinilai, bukan nol. Nilai
              yang sudah diisi dapat dikosongkan kembali bila keliru.
            </p>

            <div>
              <label
                className="block text-slate-400 text-xs"
                htmlFor={`${id}-cari-siswa`}
              >
                Cari peserta didik
              </label>
              <input
                className="mt-1 w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-white"
                id={`${id}-cari-siswa`}
                onChange={(e) => setCari(e.target.value)}
                placeholder="Nama atau NIS"
                type="search"
                value={cari}
              />
              <p aria-live="polite" className="mt-1 text-slate-400 text-xs">
                {!kataCari
                  ? null
                  : barisSkor.length === 0
                    ? `Tidak ada peserta didik yang cocok dengan "${cari.trim()}".`
                    : `${barisSkor.length} dari ${detail.items.length} peserta didik`}
              </p>
            </div>

            <div className="max-h-80 overflow-y-auto">
              <table className="w-full text-left">
                <thead className="text-slate-400 text-xs uppercase">
                  <tr>
                    <th className="py-1">Nama</th>
                    <th className="py-1">Nilai</th>
                  </tr>
                </thead>
                <tbody>
                  {barisSkor.map((item) => (
                    <tr className="border-white/5 border-t" key={item.id_siswa}>
                      <td className="py-1 text-white">
                        {item.nama_lengkap}
                        {item.nis ? (
                          <span className="ml-2 text-slate-400 text-xs">
                            {item.nis}
                          </span>
                        ) : null}
                      </td>
                      <td className="py-1">
                        <label
                          className="sr-only"
                          htmlFor={`${id}-skor-${item.id_siswa}`}
                        >
                          Nilai {item.nama_lengkap}
                        </label>
                        <input
                          className="w-24 rounded-md border border-white/10 bg-slate-950 px-2 py-1 text-right text-white"
                          id={`${id}-skor-${item.id_siswa}`}
                          inputMode="decimal"
                          max={detail.penilaian.nilai_maks}
                          min={0}
                          onChange={(e) =>
                            setSkor((sebelumnya) => ({
                              ...sebelumnya,
                              [item.id_siswa]: e.target.value,
                            }))
                          }
                          placeholder="—"
                          type="number"
                          value={skor[item.id_siswa] ?? ""}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {bolehKelola ? (
              <button
                className="w-full rounded-lg bg-emerald-500 px-4 py-2 font-semibold text-slate-950"
                data-konfirmasi
                onClick={() => void simpanSemuaNilai()}
                type="button"
              >
                Simpan nilai
              </button>
            ) : null}
          </div>
        ) : null}
      </Modal>

      <Modal
        isOpen={modalBaru}
        onClose={() => setModalBaru(false)}
        title="Penilaian Baru"
      >
        <form className="space-y-3 text-sm" onSubmit={buatPenilaian}>
          <div>
            <label
              className="block text-slate-400 text-xs"
              htmlFor={`${id}-nama-penilaian`}
            >
              Nama penilaian
            </label>
            <input
              className="mt-1 w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-white"
              id={`${id}-nama-penilaian`}
              onChange={(e) =>
                setDraft((d) => ({ ...d, nama_penilaian: e.target.value }))
              }
              placeholder="Ulangan Harian 1"
              required
              type="text"
              value={draft.nama_penilaian}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label
                className="block text-slate-400 text-xs"
                htmlFor={`${id}-jenis`}
              >
                Jenis
              </label>
              <PilihCari
                className="mt-1 w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-white"
                id={`${id}-jenis`}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, id_jenis: e.target.value }))
                }
                required
                value={draft.id_jenis}
              >
                {daftarJenis
                  .filter((item) => item.is_aktif === 1)
                  .map((item) => (
                    <option key={item.id_jenis} value={item.id_jenis}>
                      {item.nama}
                    </option>
                  ))}
              </PilihCari>
            </div>
            <div>
              <label
                className="block text-slate-400 text-xs"
                htmlFor={`${id}-tanggal`}
              >
                Tanggal
              </label>
              <input
                className="mt-1 w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-white"
                id={`${id}-tanggal`}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, tanggal: e.target.value }))
                }
                required
                type="date"
                value={draft.tanggal}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label
                className="block text-slate-400 text-xs"
                htmlFor={`${id}-bobot`}
              >
                Bobot
              </label>
              <input
                className="mt-1 w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-white"
                id={`${id}-bobot`}
                max={100}
                min={1}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, bobot: Number(e.target.value) }))
                }
                type="number"
                value={draft.bobot}
              />
            </div>
            <div>
              <label
                className="block text-slate-400 text-xs"
                htmlFor={`${id}-nilai-maks`}
              >
                Nilai maksimum
              </label>
              <input
                className="mt-1 w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-white"
                id={`${id}-nilai-maks`}
                max={1000}
                min={1}
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    nilai_maks: Number(e.target.value),
                  }))
                }
                type="number"
                value={draft.nilai_maks}
              />
            </div>
          </div>
          <p className="text-slate-400 text-xs leading-relaxed">
            KKTP diambil dari mata pelajaran dan dibekukan saat penilaian
            dibuat, sehingga perubahan KKTP di kemudian hari tidak mengubah
            penilaian ini.
          </p>
          <button
            className="w-full rounded-lg bg-amber-500 px-4 py-2 font-semibold text-slate-950"
            type="submit"
          >
            Buat penilaian
          </button>
        </form>
      </Modal>

      {dialogKonfirmasi}
    </AppShell>
  );
}
