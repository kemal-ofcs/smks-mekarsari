"use client";

import type { FormEvent } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { Modal } from "@/components/ui/Modal";
import {
  deleteLessonPeriod,
  getJpSettings,
  getLessonPeriods,
  type LessonPeriodRow,
  saveJpSettings,
  saveLessonPeriod,
} from "@/lib/gateways/class-attendance";
import {
  DEFAULT_JP_DURATION_MINUTES,
  DEFAULT_JP_MAX_PER_DAY,
  JENIS_JAM_PELAJARAN,
  MAX_JAM_KE,
} from "@/lib/validations/class-attendance";

/**
 * Jumlah jam pelajaran per hari dan lama satu jam pelajaran.
 *
 * Keduanya kebijakan sekolah, bukan setelan perangkat: nilainya hidup di
 * `setting_gex_system` yang ikut sinkronisasi, sehingga satu kali diubah di
 * mana pun akan berlaku di seluruh perangkat sekolah itu.
 *
 * Batas struktural di kode jauh lebih longgar daripada angka di kartu ini, dan
 * itu disengaja: yang di kode menjaga database dari teks asing, yang di sini
 * menjawab "sekolah ini sebenarnya punya berapa jam pelajaran".
 */
export function JamPelajaranCard() {
  // Penjaga anti klik ganda (Aturan 5): `useState` baru berlaku pada render
  // berikutnya, sehingga dua klik dalam satu tick sama-sama lolos.
  const isSubmittingRef = useRef(false);

  const [maxPerHari, setMaxPerHari] = useState<number>(DEFAULT_JP_MAX_PER_DAY);
  const [durasiMenit, setDurasiMenit] = useState<number>(
    DEFAULT_JP_DURATION_MINUTES,
  );
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{
    tone: "success" | "error";
    text: string;
  } | null>(null);

  const [periods, setPeriods] = useState<LessonPeriodRow[]>([]);
  const [modalBel, setModalBel] = useState(false);
  const [draftBel, setDraftBel] = useState<Partial<LessonPeriodRow>>({});

  const muat = useCallback(async () => {
    try {
      const [settings, daftarBel] = await Promise.all([
        getJpSettings(),
        getLessonPeriods(),
      ]);
      setMaxPerHari(settings.maxPerHari);
      setDurasiMenit(settings.durasiMenit);
      setPeriods(daftarBel);
    } catch (error: unknown) {
      setFeedback({
        tone: "error",
        text:
          error instanceof Error
            ? error.message
            : "Gagal memuat pengaturan jam pelajaran.",
      });
    }
  }, []);

  useEffect(() => {
    void muat();
  }, [muat]);

  const simpanBel = async (event: FormEvent) => {
    event.preventDefault();
    if (isSubmittingRef.current) return;
    isSubmittingRef.current = true;
    try {
      await saveLessonPeriod(draftBel);
      setModalBel(false);
      setFeedback({ tone: "success", text: "Jam bel tersimpan." });
      await muat();
    } catch (error: unknown) {
      setFeedback({
        tone: "error",
        text:
          error instanceof Error ? error.message : "Gagal menyimpan jam bel.",
      });
    } finally {
      isSubmittingRef.current = false;
    }
  };

  const hapusBel = async (row: LessonPeriodRow) => {
    if (isSubmittingRef.current) return;
    if (!confirm(`Hapus jam bel ke-${row.jam_ke}?`)) return;
    isSubmittingRef.current = true;
    try {
      await deleteLessonPeriod(row.id_jam_pelajaran);
      setFeedback({ tone: "success", text: "Jam bel dihapus." });
      await muat();
    } catch (error: unknown) {
      setFeedback({
        tone: "error",
        text:
          error instanceof Error ? error.message : "Gagal menghapus jam bel.",
      });
    } finally {
      isSubmittingRef.current = false;
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (isSubmittingRef.current) return;
    isSubmittingRef.current = true;
    setBusy(true);
    try {
      await saveJpSettings(maxPerHari, durasiMenit);
      setFeedback({
        tone: "success",
        text: "Pengaturan jam pelajaran tersimpan dan akan ikut tersinkronisasi.",
      });
      await muat();
    } catch (error: unknown) {
      setFeedback({
        tone: "error",
        text:
          error instanceof Error
            ? error.message
            : "Gagal menyimpan pengaturan jam pelajaran.",
      });
    } finally {
      isSubmittingRef.current = false;
      setBusy(false);
    }
  };

  return (
    <section className="app-panel rounded-3xl p-5 sm:p-7">
      <div className="flex items-start gap-4">
        <span className="grid size-11 shrink-0 place-items-center rounded-2xl border border-sky-300/20 bg-sky-300/10 text-sky-200">
          <Icon name="tools" className="size-5" />
        </span>
        <div>
          <h2 className="text-base font-black text-white">Jam Pelajaran</h2>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-400">
            Menentukan sampai jam ke berapa presensi kelas boleh dicatat, dan
            berapa menit satu jam pelajaran. Honor mengajar dibayar per jam
            pelajaran, jadi lama menit di sini tidak mengubah nominal gaji —
            hanya menerangkan durasinya di layar presensi.
          </p>
        </div>
      </div>

      {feedback ? (
        <p
          className={`mt-4 rounded-xl border p-3 text-sm ${
            feedback.tone === "success"
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
              : "border-rose-500/30 bg-rose-500/10 text-rose-200"
          }`}
        >
          {feedback.text}
        </p>
      ) : null}

      <form className="mt-5 grid gap-4 sm:grid-cols-2" onSubmit={submit}>
        <label className="grid gap-1.5 text-xs font-bold text-slate-300">
          Jumlah jam pelajaran per hari
          <input
            type="number"
            min={1}
            max={MAX_JAM_KE}
            value={maxPerHari}
            onChange={(event) => setMaxPerHari(Number(event.target.value))}
            className="app-input font-mono"
          />
          <span className="font-normal leading-5 text-slate-500">
            Maksimal {MAX_JAM_KE}. Sesi presensi di atas angka ini ditolak,
            termasuk dari perangkat lain.
          </span>
        </label>

        <label className="grid gap-1.5 text-xs font-bold text-slate-300">
          Lama satu jam pelajaran (menit)
          <input
            type="number"
            min={1}
            max={240}
            value={durasiMenit}
            onChange={(event) => setDurasiMenit(Number(event.target.value))}
            className="app-input font-mono"
          />
          <span className="font-normal leading-5 text-slate-500">
            Umumnya 35 menit di SD, 40 di SMP, dan 45 di SMA/SMK.
          </span>
        </label>

        <div className="sm:col-span-2 flex justify-end">
          <button
            type="submit"
            disabled={busy}
            className="rounded-xl bg-sky-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-sky-500 disabled:opacity-50"
          >
            {busy ? "Menyimpan..." : "Simpan Pengaturan"}
          </button>
        </div>
      </form>

      <div className="mt-6 border-t border-white/10 pt-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-black text-white">Jadwal Bel</h3>
            <p className="mt-1 max-w-2xl text-xs leading-5 text-slate-400">
              Pukul berapa setiap jam pelajaran berlangsung. Ini keterangan:
              presensi tetap menyimpan jam ke berapa, jadi jadwal yang belum
              lengkap tidak pernah menghalangi guru mencatat presensi.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              setDraftBel({
                jam_ke: periods.length + 1,
                jam_mulai: "07:00",
                jam_selesai: "07:45",
                jenis: "KBM",
                keterangan: "",
                is_aktif: 1,
              });
              setModalBel(true);
            }}
            className="rounded-xl border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-200 transition hover:bg-slate-700"
          >
            Tambah Jam Bel
          </button>
        </div>

        <div className="mt-4 overflow-x-auto rounded-xl border border-slate-800">
          <table className="w-full text-left text-sm text-slate-300">
            <thead className="bg-slate-800/80 text-xs font-semibold uppercase text-slate-400">
              <tr>
                <th className="px-3 py-2">Jam Ke</th>
                <th className="px-3 py-2">Pukul</th>
                <th className="px-3 py-2">Jenis</th>
                <th className="px-3 py-2">Keterangan</th>
                <th className="px-3 py-2 text-center">Status</th>
                <th className="px-3 py-2 text-center">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {periods.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    className="px-3 py-6 text-center text-slate-500"
                  >
                    Belum ada jadwal bel. Layar presensi tetap berjalan tanpa
                    ini — pukulnya saja yang belum ditampilkan.
                  </td>
                </tr>
              ) : (
                periods.map((row) => (
                  <tr key={row.id_jam_pelajaran}>
                    <td className="px-3 py-2 font-semibold text-slate-200">
                      {row.jam_ke}
                    </td>
                    <td className="px-3 py-2 font-mono text-slate-300">
                      {row.jam_mulai}–{row.jam_selesai}
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-400">
                      {row.jenis}
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-500">
                      {row.keterangan || "—"}
                    </td>
                    <td className="px-3 py-2 text-center">
                      <span
                        className={`rounded px-2 py-0.5 text-[11px] font-semibold ${
                          row.is_aktif === 1
                            ? "bg-emerald-500/10 text-emerald-400"
                            : "bg-slate-700/40 text-slate-400"
                        }`}
                      >
                        {row.is_aktif === 1 ? "Aktif" : "Nonaktif"}
                      </span>
                    </td>
                    <td className="space-x-2 px-3 py-2 text-center">
                      <button
                        type="button"
                        onClick={() => {
                          setDraftBel(row);
                          setModalBel(true);
                        }}
                        className="rounded border border-slate-700 bg-slate-800 px-2 py-1 text-xs text-sky-400"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => void hapusBel(row)}
                        className="rounded border border-slate-700 bg-slate-800 px-2 py-1 text-xs text-rose-400"
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
      </div>

      {modalBel ? (
        <Modal
          title="Jam Bel Sekolah"
          titleId="modal-jam-bel"
          onClose={() => setModalBel(false)}
        >
          <form onSubmit={simpanBel} className="space-y-4 text-sm">
            <div className="grid grid-cols-2 gap-4">
              <label className="grid gap-1.5 text-xs font-bold text-slate-300">
                Jam pelajaran ke
                <input
                  type="number"
                  min={1}
                  max={maxPerHari}
                  value={draftBel.jam_ke ?? 1}
                  onChange={(event) =>
                    setDraftBel((prev) => ({
                      ...prev,
                      jam_ke: Number(event.target.value),
                    }))
                  }
                  required
                  className="app-input font-mono"
                />
              </label>
              <label className="grid gap-1.5 text-xs font-bold text-slate-300">
                Jenis
                <select
                  value={draftBel.jenis ?? "KBM"}
                  onChange={(event) =>
                    setDraftBel((prev) => ({
                      ...prev,
                      jenis: event.target.value as LessonPeriodRow["jenis"],
                    }))
                  }
                  className="app-input"
                >
                  {JENIS_JAM_PELAJARAN.map((jenis) => (
                    <option key={jenis} value={jenis}>
                      {jenis}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1.5 text-xs font-bold text-slate-300">
                Jam mulai
                <input
                  type="time"
                  value={draftBel.jam_mulai ?? "07:00"}
                  onChange={(event) =>
                    setDraftBel((prev) => ({
                      ...prev,
                      jam_mulai: event.target.value,
                    }))
                  }
                  required
                  className="app-input font-mono"
                />
              </label>
              <label className="grid gap-1.5 text-xs font-bold text-slate-300">
                Jam selesai
                <input
                  type="time"
                  value={draftBel.jam_selesai ?? "07:45"}
                  onChange={(event) =>
                    setDraftBel((prev) => ({
                      ...prev,
                      jam_selesai: event.target.value,
                    }))
                  }
                  required
                  className="app-input font-mono"
                />
              </label>
            </div>

            <label className="grid gap-1.5 text-xs font-bold text-slate-300">
              Keterangan (opsional)
              <input
                value={draftBel.keterangan ?? ""}
                onChange={(event) =>
                  setDraftBel((prev) => ({
                    ...prev,
                    keterangan: event.target.value,
                  }))
                }
                className="app-input"
              />
            </label>

            <label className="flex items-center gap-3 text-xs font-semibold text-slate-300">
              <input
                type="checkbox"
                checked={(draftBel.is_aktif ?? 1) === 1}
                onChange={(event) =>
                  setDraftBel((prev) => ({
                    ...prev,
                    is_aktif: event.target.checked ? 1 : 0,
                  }))
                }
                className="size-4 rounded border-slate-600 bg-slate-800 accent-sky-500"
              />
              Jam bel aktif
            </label>

            <div className="flex justify-end gap-3 border-t border-slate-700 pt-4">
              <button
                type="button"
                onClick={() => setModalBel(false)}
                className="rounded-lg bg-slate-800 px-4 py-2 text-sm text-slate-300"
              >
                Batal
              </button>
              <button
                type="submit"
                className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white"
              >
                Simpan Jam Bel
              </button>
            </div>
          </form>
        </Modal>
      ) : null}
    </section>
  );
}
