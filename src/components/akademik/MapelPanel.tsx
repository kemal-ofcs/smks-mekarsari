"use client";

import type { Dispatch, SetStateAction } from "react";
import { Icon } from "@/components/ui/Icon";
import type { MapelInput } from "@/lib/gateways/academic";

type TabKey =
  | "tahun_ajaran"
  | "jurusan"
  | "rombel"
  | "mapel"
  | "penugasan"
  | "jadwal";

/**
 * Mapel pada menu Akademik
 *
 * Panel ini hanya dirender ketika tabnya aktif, sehingga selama ia berada di
 * berkas halaman ia tetap ikut diunduh oleh setiap orang yang membuka menu
 * Akademik untuk keperluan lain. Halaman induknya memuatnya lewat `dynamic()`,
 * pola yang sama dengan panel ID Card.
 *
 * Nama propsnya sengaja identik dengan nama variabel di halaman induk supaya
 * badan JSX-nya berpindah tanpa satu pun suntingan.
 */
export interface MapelPanelProps {
  mapelList: Record<string, unknown>[];
  loading: boolean;
  canManage: boolean;
  setFormMapel: Dispatch<SetStateAction<MapelInput>>;
  setModalType: Dispatch<SetStateAction<TabKey | null>>;
  handleDeleteItem: (type: TabKey, id: string) => Promise<void>;
}

export function MapelPanel({
  mapelList,
  loading,
  canManage,
  setFormMapel,
  setModalType,
  handleDeleteItem,
}: MapelPanelProps) {
  return (
    <div className="overflow-hidden rounded-2xl border border-white/10 bg-slate-900/60 shadow-xl backdrop-blur-xl">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm text-slate-200">
          <thead className="border-b border-white/10 bg-white/[0.03] text-xs uppercase tracking-wider text-slate-400">
            <tr>
              <th className="px-6 py-4">Kode</th>
              <th className="px-6 py-4">Mata Pelajaran</th>
              <th className="px-6 py-4">Kelompok</th>
              <th className="px-6 py-4">Beban Jam</th>
              <th className="px-6 py-4">KKM</th>
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
                  Memuat data mata pelajaran...
                </td>
              </tr>
            ) : mapelList.length === 0 ? (
              <tr>
                <td
                  colSpan={6}
                  className="px-6 py-8 text-center text-slate-400"
                >
                  Belum ada kurikulum mata pelajaran.
                </td>
              </tr>
            ) : (
              mapelList.map((item) => {
                const id = String(item.id_mapel);
                return (
                  <tr key={id} className="transition hover:bg-white/[0.02]">
                    <td className="px-6 py-4 font-mono font-bold text-sky-400">
                      {String(item.kode_mapel)}
                    </td>
                    <td className="px-6 py-4 font-bold text-white">
                      {String(item.nama_mapel)}
                    </td>
                    <td className="px-6 py-4">
                      <span className="rounded-full bg-slate-800 px-2.5 py-0.5 text-xs font-semibold text-slate-300">
                        {String(item.kelompok)}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm text-slate-300">
                      {String(item.beban_jam)} JP/Minggu
                    </td>
                    <td className="px-6 py-4 font-semibold text-amber-400">
                      {String(item.kkm)}
                    </td>
                    <td className="px-6 py-4 text-right">
                      {canManage ? (
                        <div className="flex items-center justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              const rawKelompok = String(item.kelompok);
                              const kelompokVal = (
                                rawKelompok === "Peminatan" ||
                                rawKelompok === "Muatan Lokal" ||
                                rawKelompok === "Kejuruan"
                                  ? rawKelompok
                                  : "Wajib"
                              ) as
                                | "Wajib"
                                | "Peminatan"
                                | "Muatan Lokal"
                                | "Kejuruan";

                              setFormMapel({
                                id_mapel: id,
                                kode_mapel: String(item.kode_mapel),
                                nama_mapel: String(item.nama_mapel),
                                tingkat: item.tingkat
                                  ? Number(item.tingkat)
                                  : undefined,
                                kelompok: kelompokVal,
                                beban_jam: Number(item.beban_jam),
                                kkm: Number(item.kkm),
                                is_aktif: Number(item.is_aktif),
                              });
                              setModalType("mapel");
                            }}
                            className="rounded-lg bg-white/5 p-1.5 text-slate-300 hover:bg-white/10 hover:text-white"
                          >
                            <Icon name="tools" className="size-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleDeleteItem("mapel", id)}
                            className="rounded-lg bg-rose-500/10 p-1.5 text-rose-400 hover:bg-rose-500/20"
                          >
                            <Icon name="trash" className="size-4" />
                          </button>
                        </div>
                      ) : null}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
