"use client";

import { redirect } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { FeedbackBanner } from "@/components/ui/FeedbackBanner";
import { Modal } from "@/components/ui/Modal";
import { PageHeader } from "@/components/ui/PageHeader";
import { canAccessArea, hasPermission } from "@/lib/auth/access";
import { useAuth } from "@/lib/context/AuthContext";
import {
  getDaftarMapel,
  getDaftarRombel,
  getDaftarTahunAjaran,
} from "@/lib/gateways/academic";
import {
  daftarPenilaian,
  getPenilaian,
  hapusPenilaian,
  type PenilaianDetail,
  type PenilaianItem,
  simpanNilai,
  simpanPenilaian,
} from "@/lib/gateways/grades";
import { useConfirmDialog } from "@/lib/hooks/useConfirmDialog";
import { JENIS_PENILAIAN, SEMESTER_LIST, type Semester } from "@/types/grades";

interface Opsi {
  id: string;
  nama: string;
}

const DRAFT_KOSONG = {
  jenis: "Ulangan Harian" as (typeof JENIS_PENILAIAN)[number],
  nama_penilaian: "",
  tanggal: new Date().toISOString().slice(0, 10),
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

  const [penilaian, setPenilaian] = useState<PenilaianItem[]>([]);
  const [detail, setDetail] = useState<PenilaianDetail | null>(null);
  const [skor, setSkor] = useState<Record<string, string>>({});
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

  const muatPenilaian = useCallback(async () => {
    if (!idTahunAjaran || !idRombel) {
      setPenilaian([]);
      return;
    }
    setMemuat(true);
    setGalat(null);
    try {
      const hasil = await daftarPenilaian({
        id_tahun_ajaran: idTahunAjaran,
        semester,
        id_rombel: idRombel,
        id_mapel: idMapel || null,
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
  }, [idTahunAjaran, semester, idRombel, idMapel]);

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
        jenis: draft.jenis,
        nama_penilaian: draft.nama_penilaian,
        tanggal: draft.tanggal,
        bobot: draft.bobot,
        nilai_maks: draft.nilai_maks,
      });
      setKabar("Penilaian dibuat.");
      setModalBaru(false);
      setDraft(DRAFT_KOSONG);
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

  return (
    <AppShell>
      <div className="space-y-6">
        <PageHeader
          actions={
            bolehKelola && idRombel && idMapel ? (
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

        <section className="grid gap-3 rounded-xl border border-white/10 bg-slate-900/95 p-4 sm:grid-cols-4">
          <div>
            <label
              className="block text-slate-400 text-xs"
              htmlFor={`${id}-ta`}
            >
              Tahun ajaran
            </label>
            <select
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
            </select>
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
            <select
              className="mt-1 w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white"
              id={`${id}-rombel`}
              onChange={(e) => setIdRombel(e.target.value)}
              value={idRombel}
            >
              <option value="">Pilih rombel</option>
              {rombel.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.nama}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label
              className="block text-slate-400 text-xs"
              htmlFor={`${id}-mapel`}
            >
              Mata pelajaran
            </label>
            <select
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
            </select>
          </div>
        </section>

        <section className="rounded-xl border border-white/10 bg-slate-900/95 p-4">
          {memuat ? (
            <p className="text-slate-400 text-sm">Memuat penilaian…</p>
          ) : !idRombel ? (
            <p className="text-slate-400 text-sm">
              Pilih rombel untuk melihat daftar penilaian.
            </p>
          ) : penilaian.length === 0 ? (
            <p className="text-slate-400 text-sm">
              Belum ada penilaian pada rombel dan semester ini.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-slate-400 text-xs uppercase">
                  <tr>
                    <th className="py-2">Tanggal</th>
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
                      <td className="py-2 text-slate-400">{item.tanggal}</td>
                      <td className="py-2 text-white">{item.nama_penilaian}</td>
                      <td className="py-2 text-slate-400">{item.jenis}</td>
                      <td className="py-2 text-slate-400">{item.nama_mapel}</td>
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
                            onClick={() => void bukaDetail(item.id_penilaian)}
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
            </div>
          )}
        </section>
      </div>

      <Modal
        isOpen={detail !== null}
        onClose={() => setDetail(null)}
        title={detail?.penilaian.nama_penilaian ?? "Input Nilai"}
      >
        {detail ? (
          <div className="space-y-4 text-sm">
            <p className="text-slate-400">
              {detail.penilaian.nama_rombel} · {detail.penilaian.nama_mapel} ·
              KKM {detail.penilaian.kkm} · nilai maksimum{" "}
              {detail.penilaian.nilai_maks}
            </p>
            <p className="text-slate-500 text-xs leading-relaxed">
              Kolom yang dikosongkan berarti belum dinilai — bukan nol. Nilai
              yang sudah diisi dapat dikosongkan kembali bila keliru.
            </p>

            <div className="max-h-80 overflow-y-auto">
              <table className="w-full text-left">
                <thead className="text-slate-400 text-xs uppercase">
                  <tr>
                    <th className="py-1">Nama</th>
                    <th className="py-1">Nilai</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.items.map((item) => (
                    <tr className="border-white/5 border-t" key={item.id_siswa}>
                      <td className="py-1 text-white">
                        {item.nama_lengkap}
                        {item.nis ? (
                          <span className="ml-2 text-slate-500 text-xs">
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
              <select
                className="mt-1 w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-white"
                id={`${id}-jenis`}
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    jenis: e.target.value as (typeof JENIS_PENILAIAN)[number],
                  }))
                }
                value={draft.jenis}
              >
                {JENIS_PENILAIAN.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
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
          <p className="text-slate-500 text-xs leading-relaxed">
            KKM diambil dari mata pelajaran dan dibekukan saat penilaian dibuat,
            sehingga perubahan KKM di kemudian hari tidak mengubah penilaian
            ini.
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
