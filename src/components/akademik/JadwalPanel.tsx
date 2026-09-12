"use client";

import type { FormEvent } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { Modal } from "@/components/ui/Modal";
import {
  getJadwalMengajar,
  hapusJadwalMengajar,
  simpanJadwalMengajar,
  type TeachingScheduleRow,
} from "@/lib/gateways/academic";
import { susunJamKe } from "@/lib/validations/class-attendance";

/**
 * Jadwal mengajar mingguan per rombel.
 *
 * Berbeda dari panel akademik lainnya, panel ini memegang datanya SENDIRI.
 * Halaman induk sudah menyalurkan sebelas prop untuk lima tab; menambahkan
 * state, modal, dan form tab keenam ke sana akan membuat berkas itu lebih sulit
 * dibaca daripada yang dihemat. Daftar master tetap diterima sebagai prop supaya
 * tidak ada permintaan kedua untuk data yang sudah ada di halaman.
 *
 * Jadwal ini KETERANGAN: presensi kelas tetap bisa dicatat tanpa jadwal, dan
 * gunanya memberi tombol isi-cepat di layar presensi.
 */

const HARI = [
  { nilai: 1, label: "Senin" },
  { nilai: 2, label: "Selasa" },
  { nilai: 3, label: "Rabu" },
  { nilai: 4, label: "Kamis" },
  { nilai: 5, label: "Jumat" },
  { nilai: 6, label: "Sabtu" },
  { nilai: 7, label: "Minggu" },
] as const;

export interface JadwalPanelProps {
  tahunAjaranList: Record<string, unknown>[];
  rombelList: Record<string, unknown>[];
  mapelList: Record<string, unknown>[];
  guruList: Record<string, unknown>[];
  canManage: boolean;
  onFeedback: (tone: "success" | "error", message: string) => void;
}

interface JadwalDraft {
  id_jadwal?: string;
  id_tahun_ajaran: string;
  id_rombel: string;
  id_mapel: string;
  id_guru: string;
  hari: number;
  jamDari: number;
  jamSampai: number;
  is_aktif: number;
}

export function JadwalPanel({
  tahunAjaranList,
  rombelList,
  mapelList,
  guruList,
  canManage,
  onFeedback,
}: JadwalPanelProps) {
  // Penjaga anti klik ganda (Aturan 5), dideklarasikan sebelum early return.
  const isSubmittingRef = useRef(false);

  const [rows, setRows] = useState<TeachingScheduleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterRombel, setFilterRombel] = useState("");
  const [draft, setDraft] = useState<JadwalDraft | null>(null);

  const muat = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await getJadwalMengajar({ id_rombel: filterRombel || null }));
    } catch (error: unknown) {
      onFeedback(
        "error",
        error instanceof Error
          ? error.message
          : "Gagal memuat jadwal mengajar.",
      );
    } finally {
      setLoading(false);
    }
  }, [filterRombel, onFeedback]);

  useEffect(() => {
    void muat();
  }, [muat]);

  const tahunAktif = String(
    tahunAjaranList.find((ta) => ta.is_aktif === 1 || ta.is_aktif === "1")
      ?.id_tahun_ajaran ??
      tahunAjaranList[0]?.id_tahun_ajaran ??
      "",
  );

  const bukaTambah = () => {
    setDraft({
      id_tahun_ajaran: tahunAktif,
      id_rombel: filterRombel || String(rombelList[0]?.id_rombel ?? ""),
      id_mapel: String(mapelList[0]?.id_mapel ?? ""),
      id_guru: String(guruList[0]?.id_guru ?? ""),
      hari: 1,
      jamDari: 1,
      jamSampai: 2,
      is_aktif: 1,
    });
  };

  const simpan = async (event: FormEvent) => {
    event.preventDefault();
    if (!draft || isSubmittingRef.current) return;

    const jamKe = susunJamKe(draft.jamDari, draft.jamSampai);
    if (jamKe === null) {
      onFeedback(
        "error",
        'Jam pelajaran tidak valid. Jam "sampai" tidak boleh lebih kecil daripada jam "dari".',
      );
      return;
    }

    isSubmittingRef.current = true;
    try {
      await simpanJadwalMengajar({
        id_jadwal: draft.id_jadwal,
        id_tahun_ajaran: draft.id_tahun_ajaran,
        id_rombel: draft.id_rombel,
        id_mapel: draft.id_mapel,
        id_guru: draft.id_guru,
        hari: draft.hari,
        jam_ke: jamKe,
        is_aktif: draft.is_aktif,
      });
      setDraft(null);
      onFeedback("success", "Jadwal mengajar tersimpan.");
      await muat();
    } catch (error: unknown) {
      onFeedback(
        "error",
        error instanceof Error ? error.message : "Gagal menyimpan jadwal.",
      );
    } finally {
      isSubmittingRef.current = false;
    }
  };

  const hapus = async (row: TeachingScheduleRow) => {
    if (isSubmittingRef.current) return;
    if (
      !confirm(
        `Hapus jadwal ${row.nama_mapel || row.id_mapel} hari ${
          HARI.find((h) => h.nilai === row.hari)?.label ?? row.hari
        } jam ${row.jam_ke}?`,
      )
    ) {
      return;
    }
    isSubmittingRef.current = true;
    try {
      await hapusJadwalMengajar(row.id_jadwal);
      onFeedback("success", "Jadwal mengajar dihapus.");
      await muat();
    } catch (error: unknown) {
      onFeedback(
        "error",
        error instanceof Error ? error.message : "Gagal menghapus jadwal.",
      );
    } finally {
      isSubmittingRef.current = false;
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <p className="rounded-xl border border-white/10 bg-slate-900/60 p-3 text-xs leading-5 text-slate-400">
        Jadwal ini memberi tombol isi-cepat di layar Presensi Kelas: guru
        mengetuk satu baris, lalu mapel, pengajar, dan jam pelajarannya terisi
        sendiri. Presensi tetap bisa dicatat tanpa jadwal — jadwal yang belum
        lengkap tidak pernah menghalangi siapa pun.
      </p>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <label
            htmlFor="filter-rombel-jadwal"
            className="text-xs font-semibold text-slate-400"
          >
            Filter Rombel:
          </label>
          <select
            id="filter-rombel-jadwal"
            value={filterRombel}
            onChange={(event) => setFilterRombel(event.target.value)}
            className="rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-sm text-slate-100 shadow-inner focus:border-sky-500 focus:outline-none"
          >
            <option value="">Semua rombel</option>
            {rombelList.map((rom) => (
              <option key={String(rom.id_rombel)} value={String(rom.id_rombel)}>
                Kelas {String(rom.tingkat)} - {String(rom.nama_rombel)}
              </option>
            ))}
          </select>
        </div>

        {canManage ? (
          <button
            type="button"
            onClick={bukaTambah}
            className="flex items-center gap-1.5 rounded-xl bg-sky-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-sky-500"
          >
            <Icon name="plus" className="size-3.5" />
            Tambah Jadwal
          </button>
        ) : null}
      </div>

      <div className="overflow-x-auto rounded-xl border border-white/10">
        <table className="w-full text-left text-sm text-slate-300">
          <thead className="bg-slate-800/80 text-xs font-semibold uppercase text-slate-400">
            <tr>
              <th className="px-3 py-2">Hari</th>
              <th className="px-3 py-2">Jam Ke</th>
              <th className="px-3 py-2">Rombel</th>
              <th className="px-3 py-2">Mata Pelajaran</th>
              <th className="px-3 py-2">Pengajar</th>
              <th className="px-3 py-2 text-center">Status</th>
              {canManage ? (
                <th className="px-3 py-2 text-center">Aksi</th>
              ) : null}
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {loading ? (
              <tr>
                <td
                  colSpan={canManage ? 7 : 6}
                  className="px-3 py-6 text-center text-slate-500"
                >
                  Memuat jadwal mengajar...
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td
                  colSpan={canManage ? 7 : 6}
                  className="px-3 py-6 text-center text-slate-500"
                >
                  Belum ada jadwal. Presensi kelas tetap berjalan tanpa ini.
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.id_jadwal} className="hover:bg-white/[0.02]">
                  <td className="px-3 py-2 font-semibold text-slate-200">
                    {HARI.find((h) => h.nilai === row.hari)?.label ?? row.hari}
                  </td>
                  <td className="px-3 py-2 font-mono text-slate-300">
                    {row.jam_ke}
                  </td>
                  <td className="px-3 py-2 text-xs text-slate-400">
                    {row.nama_rombel || row.id_rombel}
                  </td>
                  <td className="px-3 py-2 text-slate-200">
                    {row.nama_mapel || row.id_mapel}
                  </td>
                  <td className="px-3 py-2 text-xs text-slate-400">
                    {row.nama_guru || row.id_guru}
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
                  {canManage ? (
                    <td className="space-x-2 px-3 py-2 text-center">
                      <button
                        type="button"
                        onClick={() => {
                          const [awal, akhir] = row.jam_ke.includes("-")
                            ? row.jam_ke.split("-").map(Number)
                            : [Number(row.jam_ke), Number(row.jam_ke)];
                          setDraft({
                            id_jadwal: row.id_jadwal,
                            id_tahun_ajaran: row.id_tahun_ajaran,
                            id_rombel: row.id_rombel,
                            id_mapel: row.id_mapel,
                            id_guru: row.id_guru,
                            hari: row.hari,
                            jamDari: awal ?? 1,
                            jamSampai: akhir ?? 1,
                            is_aktif: row.is_aktif,
                          });
                        }}
                        className="rounded border border-white/10 bg-slate-800 px-2 py-1 text-xs text-sky-400"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => void hapus(row)}
                        className="rounded border border-white/10 bg-slate-800 px-2 py-1 text-xs text-rose-400"
                      >
                        Hapus
                      </button>
                    </td>
                  ) : null}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {draft ? (
        <Modal
          title={
            draft.id_jadwal ? "Ubah Jadwal Mengajar" : "Tambah Jadwal Mengajar"
          }
          titleId="modal-jadwal-mengajar"
          onClose={() => setDraft(null)}
        >
          <form onSubmit={simpan} className="space-y-4 text-sm text-slate-300">
            <div className="grid grid-cols-2 gap-4">
              <label className="grid gap-1.5 text-xs font-bold text-slate-400">
                Rombel
                <select
                  value={draft.id_rombel}
                  onChange={(event) =>
                    setDraft({ ...draft, id_rombel: event.target.value })
                  }
                  required
                  className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 font-normal text-slate-200 focus:border-sky-500 focus:outline-none"
                >
                  {rombelList.map((rom) => (
                    <option
                      key={String(rom.id_rombel)}
                      value={String(rom.id_rombel)}
                    >
                      Kelas {String(rom.tingkat)} - {String(rom.nama_rombel)}
                    </option>
                  ))}
                </select>
              </label>

              <label className="grid gap-1.5 text-xs font-bold text-slate-400">
                Hari
                <select
                  value={draft.hari}
                  onChange={(event) =>
                    setDraft({ ...draft, hari: Number(event.target.value) })
                  }
                  className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 font-normal text-slate-200 focus:border-sky-500 focus:outline-none"
                >
                  {HARI.map((hari) => (
                    <option key={hari.nilai} value={hari.nilai}>
                      {hari.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="grid gap-1.5 text-xs font-bold text-slate-400">
                Mata pelajaran
                <select
                  value={draft.id_mapel}
                  onChange={(event) =>
                    setDraft({ ...draft, id_mapel: event.target.value })
                  }
                  required
                  className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 font-normal text-slate-200 focus:border-sky-500 focus:outline-none"
                >
                  {mapelList.map((mapel) => (
                    <option
                      key={String(mapel.id_mapel)}
                      value={String(mapel.id_mapel)}
                    >
                      {String(mapel.nama_mapel)}
                    </option>
                  ))}
                </select>
              </label>

              <label className="grid gap-1.5 text-xs font-bold text-slate-400">
                Pengajar
                <select
                  value={draft.id_guru}
                  onChange={(event) =>
                    setDraft({ ...draft, id_guru: event.target.value })
                  }
                  required
                  className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 font-normal text-slate-200 focus:border-sky-500 focus:outline-none"
                >
                  {guruList.map((guru) => (
                    <option
                      key={String(guru.id_guru)}
                      value={String(guru.id_guru)}
                    >
                      {String(guru.nama ?? guru.nama_lengkap ?? guru.id_guru)}
                    </option>
                  ))}
                </select>
              </label>

              <label className="grid gap-1.5 text-xs font-bold text-slate-400">
                Jam pelajaran dari
                <input
                  type="number"
                  min={1}
                  value={draft.jamDari}
                  onChange={(event) =>
                    setDraft({ ...draft, jamDari: Number(event.target.value) })
                  }
                  required
                  className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 font-mono font-normal text-slate-200 focus:border-sky-500 focus:outline-none"
                />
              </label>

              <label className="grid gap-1.5 text-xs font-bold text-slate-400">
                Sampai jam ke
                <input
                  type="number"
                  min={1}
                  value={draft.jamSampai}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      jamSampai: Number(event.target.value),
                    })
                  }
                  required
                  className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 font-mono font-normal text-slate-200 focus:border-sky-500 focus:outline-none"
                />
              </label>
            </div>

            <label className="flex items-center gap-3 text-xs font-semibold text-slate-300">
              <input
                type="checkbox"
                checked={draft.is_aktif === 1}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    is_aktif: event.target.checked ? 1 : 0,
                  })
                }
                className="size-4 rounded border-slate-600 bg-slate-800 accent-sky-500"
              />
              Jadwal aktif
            </label>

            <div className="flex justify-end gap-3 border-t border-slate-700 pt-4">
              <button
                type="button"
                onClick={() => setDraft(null)}
                className="rounded-lg bg-slate-800 px-4 py-2 text-sm text-slate-300"
              >
                Batal
              </button>
              <button
                type="submit"
                className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white"
              >
                Simpan Jadwal
              </button>
            </div>
          </form>
        </Modal>
      ) : null}
    </div>
  );
}
