"use client";

import type { FormEvent } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { BelPerangkatPanel } from "@/components/BelPerangkatPanel";
import { Icon } from "@/components/ui/Icon";
import { Modal } from "@/components/ui/Modal";
import { PilihCari } from "@/components/ui/PilihCari";
import { getDaftarUnit } from "@/lib/gateways/academic";
import {
  deleteLessonPeriod,
  getJpSettings,
  getLessonPeriods,
  type LessonPeriodRow,
  saveJpSettings,
  saveLessonPeriod,
} from "@/lib/gateways/class-attendance";
import { useConfirmDialog } from "@/lib/hooks/useConfirmDialog";
import {
  DEFAULT_JP_DURATION_MINUTES,
  DEFAULT_JP_MAX_PER_DAY,
  JENIS_JAM_PELAJARAN,
  jamKbmAktif,
  LABEL_SUARA_BEL,
  MAX_JAM_KE,
  nomorJamKbmKosong,
  SUARA_BEL,
  SUARA_BEL_BAWAAN,
} from "@/lib/validations/class-attendance";

const HARI = [
  { nilai: 1, label: "Senin" },
  { nilai: 2, label: "Selasa" },
  { nilai: 3, label: "Rabu" },
  { nilai: 4, label: "Kamis" },
  { nilai: 5, label: "Jumat" },
  { nilai: 6, label: "Sabtu" },
  { nilai: 7, label: "Minggu" },
] as const;

const labelHari = (hari: number | null) =>
  hari === null
    ? "Setiap hari"
    : (HARI.find((h) => h.nilai === hari)?.label ?? String(hari));

/**
 * Jumlah jam pelajaran per hari, lama satu jam pelajaran, dan jadwal bel.
 *
 * Ketiganya kebijakan sekolah, bukan setelan perangkat: nilainya hidup di
 * `setting_gex_system` dan `akademik_jam_pelajaran` yang ikut sinkronisasi,
 * sehingga satu kali diubah di mana pun akan berlaku di seluruh perangkat.
 * Sejak v60 ketiganya bisa diatur per unit; "Semua unit" adalah nilai sekolah
 * yang dipakai unit yang belum punya nilainya sendiri.
 *
 * Batas struktural di kode jauh lebih longgar daripada angka di kartu ini, dan
 * itu disengaja: yang di kode menjaga database dari teks asing, yang di sini
 * menjawab "sekolah ini sebenarnya punya berapa jam pelajaran".
 */
export function JamPelajaranCard() {
  // Konfirmasi aksi merusak memakai dialog APLIKASI, bukan dialog bawaan peramban.
  const { konfirmasi, dialogKonfirmasi } = useConfirmDialog();

  // Penjaga anti klik ganda (Aturan 5): `useState` baru berlaku pada render
  // berikutnya, sehingga dua klik dalam satu tick sama-sama lolos.
  const isSubmittingRef = useRef(false);

  const [unitList, setUnitList] = useState<Record<string, unknown>[]>([]);
  // "" = Semua unit (nilai sekolah).
  const [unit, setUnit] = useState("");
  const [maxPerHari, setMaxPerHari] = useState<number>(DEFAULT_JP_MAX_PER_DAY);
  const [durasiMenit, setDurasiMenit] = useState<number>(
    DEFAULT_JP_DURATION_MINUTES,
  );
  const [khususUnit, setKhususUnit] = useState(false);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{
    tone: "success" | "error";
    text: string;
  } | null>(null);

  const [semuaBel, setSemuaBel] = useState<LessonPeriodRow[]>([]);
  const [modalBel, setModalBel] = useState(false);
  const [draftBel, setDraftBel] = useState<Partial<LessonPeriodRow>>({});

  // Tabel menampilkan baris milik unit terpilih saja, persis cakupannya.
  const periods = semuaBel.filter((row) => (row.id_unit ?? "") === unit);
  const nomorKosong = nomorJamKbmKosong(
    periods.filter((row) => row.hari === null),
  );
  const namaUnit = (id: string) =>
    String(
      unitList.find((u) => String(u.id_unit) === id)?.nama_unit ?? "Semua unit",
    );

  const muat = useCallback(async (idUnit: string) => {
    try {
      const [settings, daftarBel, units] = await Promise.all([
        getJpSettings(idUnit || null),
        getLessonPeriods(),
        getDaftarUnit().catch(() => [] as Record<string, unknown>[]),
      ]);
      setMaxPerHari(settings.maxPerHari);
      setDurasiMenit(settings.durasiMenit);
      setKhususUnit(settings.khususUnit);
      setSemuaBel(daftarBel);
      setUnitList(units);
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
    void muat(unit);
  }, [muat, unit]);

  const simpanBel = async (event: FormEvent) => {
    event.preventDefault();
    if (isSubmittingRef.current) return;
    isSubmittingRef.current = true;
    try {
      await saveLessonPeriod(draftBel);
      setModalBel(false);
      setFeedback({ tone: "success", text: "Jam bel tersimpan." });
      await muat(unit);
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
    if (
      !(await konfirmasi({
        title: "Hapus jam bel ini?",
        description:
          row.jenis === "KBM"
            ? `Jam pelajaran ke-${row.jam_ke} (${labelHari(row.hari)}) dihapus dari jadwal bel.`
            : `${row.jenis} pukul ${row.jam_mulai} (${labelHari(row.hari)}) dihapus dari jadwal bel.`,
        preserved:
          "Presensi mapel yang sudah tercatat pada jam itu tidak ikut terhapus.",
        confirmLabel: "Ya, hapus",
      }))
    )
      return;
    isSubmittingRef.current = true;
    try {
      await deleteLessonPeriod(row.id_jam_pelajaran);
      setFeedback({ tone: "success", text: "Jam bel dihapus." });
      await muat(unit);
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
      await saveJpSettings(maxPerHari, durasiMenit, unit || null);
      setFeedback({
        tone: "success",
        text: `Pengaturan jam pelajaran ${namaUnit(unit)} tersimpan dan akan ikut tersinkronisasi.`,
      });
      await muat(unit);
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

  const jenisDraft = draftBel.jenis ?? "KBM";

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
            pelajaran, jadi lama menit di sini tidak mengubah nominal gaji.
            Angka ini hanya menerangkan durasinya di layar presensi.
          </p>
        </div>
      </div>

      {unitList.length > 0 ? (
        <label className="mt-5 grid max-w-xs gap-1.5 text-xs font-bold text-slate-300">
          Unit
          <PilihCari
            value={unit}
            onChange={(event) => setUnit(event.target.value)}
            className="app-input"
          >
            <option value="">Semua unit (nilai sekolah)</option>
            {unitList.map((u) => (
              <option key={String(u.id_unit)} value={String(u.id_unit)}>
                {String(u.nama_unit)}
              </option>
            ))}
          </PilihCari>
          <span className="font-normal leading-5 text-slate-500">
            {unit
              ? khususUnit
                ? "Unit ini memakai pengaturan dan jadwal belnya sendiri."
                : "Unit ini belum punya pengaturan sendiri, jadi angka di bawah adalah nilai sekolah."
              : "Berlaku untuk unit yang belum punya pengaturan sendiri."}
          </span>
        </label>
      ) : null}

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
            className="rounded-xl bg-sky-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-sky-800 disabled:opacity-50"
          >
            {busy ? "Menyimpan..." : "Simpan Pengaturan"}
          </button>
        </div>
      </form>

      <div className="mt-6 border-t border-white/10 pt-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-black text-white">
              Jadwal Bel {unitList.length > 0 ? `· ${namaUnit(unit)}` : ""}
            </h3>
            <p className="mt-1 max-w-2xl text-xs leading-5 text-slate-400">
              Pukul berapa setiap jam pelajaran berlangsung. Jadwal Mengajar
              memilih jam dari daftar ini, dan Presensi KBM memakainya untuk
              mengusulkan sesi yang sedang berjalan. Istirahat, Upacara, dan
              Pulang tidak memakai nomor jam pelajaran. Bila sebuah hari punya
              baris sendiri (misalnya Jumat), hanya baris hari itu yang dipakai
              pada hari tersebut; begitu juga unit yang punya jadwal sendiri.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              const kbm = jamKbmAktif(periods);
              const terakhir = periods.at(-1);
              setDraftBel({
                jam_ke: (kbm.at(-1)?.jam_ke ?? 0) + 1,
                jam_mulai: terakhir?.jam_selesai ?? "07:00",
                jam_selesai: "",
                jenis: "KBM",
                keterangan: "",
                is_aktif: 1,
                id_unit: unit || null,
                hari: null,
                bunyi: 1,
                suara: SUARA_BEL_BAWAAN,
              });
              setModalBel(true);
            }}
            className="rounded-xl border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-200 transition hover:bg-slate-700"
          >
            Tambah Jam Bel
          </button>
        </div>

        {nomorKosong.length > 0 ? (
          <p className="mt-4 rounded-xl border border-amber-300/25 bg-amber-300/10 p-3 text-xs leading-5 text-amber-100">
            Nomor jam pelajaran ke-{nomorKosong.join(", ")} belum terisi. Bila
            nomor itu dulu dipakai untuk Istirahat atau Upacara, ubah nomor jam
            KBM sesudahnya supaya berurutan. Jadwal Mengajar yang memakai nomor
            lama perlu disesuaikan juga.
          </p>
        ) : null}

        <div className="mt-4 overflow-x-auto rounded-xl border border-slate-800">
          <table className="w-full text-left text-sm text-slate-300">
            <thead className="bg-slate-800/80 text-xs font-semibold uppercase text-slate-400">
              <tr>
                <th className="px-3 py-2">Hari</th>
                <th className="px-3 py-2">Jam Ke</th>
                <th className="px-3 py-2">Pukul</th>
                <th className="px-3 py-2">Jenis</th>
                <th className="px-3 py-2">Bel</th>
                <th className="px-3 py-2">Keterangan</th>
                <th className="px-3 py-2 text-center">Status</th>
                <th className="px-3 py-2 text-center">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {periods.length === 0 ? (
                <tr>
                  <td
                    colSpan={8}
                    className="px-3 py-6 text-center text-slate-500"
                  >
                    {unit
                      ? "Unit ini belum punya jadwal bel sendiri, jadi memakai jadwal Semua unit."
                      : "Belum ada jadwal bel. Layar presensi tetap berjalan tanpa ini, hanya pukulnya yang belum ditampilkan."}
                  </td>
                </tr>
              ) : (
                periods.map((row) => (
                  <tr key={row.id_jam_pelajaran}>
                    <td className="px-3 py-2 text-xs text-slate-400">
                      {labelHari(row.hari)}
                    </td>
                    <td className="px-3 py-2 font-semibold text-slate-200">
                      {row.jenis === "KBM" ? row.jam_ke : "-"}
                    </td>
                    <td className="px-3 py-2 font-mono text-slate-300">
                      {row.jenis === "Pulang"
                        ? row.jam_mulai
                        : `${row.jam_mulai}–${row.jam_selesai}`}
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-400">
                      {row.jenis}
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-400">
                      {row.bunyi === 1
                        ? (LABEL_SUARA_BEL[row.suara] ?? row.suara)
                        : "Senyap"}
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-500">
                      {row.keterangan || "-"}
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

      <BelPerangkatPanel unitList={unitList} />

      {modalBel ? (
        <Modal
          title="Jam Bel Sekolah"
          titleId="modal-jam-bel"
          onClose={() => setModalBel(false)}
        >
          <form onSubmit={simpanBel} className="space-y-4 text-sm">
            <div className="grid grid-cols-2 gap-4">
              {jenisDraft === "KBM" ? (
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
              ) : (
                <p className="self-end text-xs leading-5 text-slate-400">
                  {jenisDraft} tidak memakai nomor jam pelajaran.
                </p>
              )}
              <label className="grid gap-1.5 text-xs font-bold text-slate-300">
                Jenis
                <select
                  value={jenisDraft}
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
                {jenisDraft === "Pulang" ? "Pukul pulang" : "Jam mulai"}
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
              {jenisDraft === "Pulang" ? null : (
                <label className="grid gap-1.5 text-xs font-bold text-slate-300">
                  Jam selesai
                  <input
                    type="time"
                    value={draftBel.jam_selesai ?? ""}
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
              )}
              <label className="grid gap-1.5 text-xs font-bold text-slate-300">
                Unit
                <PilihCari
                  value={draftBel.id_unit ?? ""}
                  onChange={(event) =>
                    setDraftBel((prev) => ({
                      ...prev,
                      id_unit: event.target.value || null,
                    }))
                  }
                  className="app-input"
                >
                  <option value="">Semua unit</option>
                  {unitList.map((u) => (
                    <option key={String(u.id_unit)} value={String(u.id_unit)}>
                      {String(u.nama_unit)}
                    </option>
                  ))}
                </PilihCari>
              </label>
              <label className="grid gap-1.5 text-xs font-bold text-slate-300">
                Hari
                <select
                  value={draftBel.hari ?? ""}
                  onChange={(event) =>
                    setDraftBel((prev) => ({
                      ...prev,
                      hari: event.target.value
                        ? Number(event.target.value)
                        : null,
                    }))
                  }
                  className="app-input"
                >
                  <option value="">Setiap hari</option>
                  {HARI.map((hari) => (
                    <option key={hari.nilai} value={hari.nilai}>
                      {hari.label}
                    </option>
                  ))}
                </select>
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

            <div className="grid grid-cols-2 gap-4">
              <label className="flex items-center gap-3 self-end text-xs font-semibold text-slate-300">
                <input
                  type="checkbox"
                  checked={(draftBel.bunyi ?? 1) === 1}
                  onChange={(event) =>
                    setDraftBel((prev) => ({
                      ...prev,
                      bunyi: event.target.checked ? 1 : 0,
                    }))
                  }
                  className="size-4 rounded border-slate-600 bg-slate-800 accent-sky-500"
                />
                Bunyikan bel
              </label>
              <label className="grid gap-1.5 text-xs font-bold text-slate-300">
                Suara
                <select
                  value={draftBel.suara ?? SUARA_BEL_BAWAAN}
                  disabled={(draftBel.bunyi ?? 1) !== 1}
                  onChange={(event) =>
                    setDraftBel((prev) => ({
                      ...prev,
                      suara: event.target.value as LessonPeriodRow["suara"],
                    }))
                  }
                  className="app-input disabled:opacity-50"
                >
                  {SUARA_BEL.map((suara) => (
                    <option key={suara} value={suara}>
                      {LABEL_SUARA_BEL[suara]}
                    </option>
                  ))}
                </select>
              </label>
            </div>

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
              Jam bel aktif (dipakai Jadwal Mengajar dan Presensi KBM)
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
                className="rounded-lg bg-sky-700 px-4 py-2 text-sm font-semibold text-white"
              >
                Simpan Jam Bel
              </button>
            </div>
          </form>
        </Modal>
      ) : null}

      {dialogKonfirmasi}
    </section>
  );
}
