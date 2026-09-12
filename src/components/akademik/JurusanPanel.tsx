"use client";

import type { Dispatch, SetStateAction } from "react";
import { Icon } from "@/components/ui/Icon";
import type { JurusanInput } from "@/lib/gateways/academic";

type TabKey =
  | "tahun_ajaran"
  | "jurusan"
  | "rombel"
  | "mapel"
  | "penugasan"
  | "jadwal";

/**
 * Jurusan pada menu Akademik
 *
 * Panel ini hanya dirender ketika tabnya aktif, sehingga selama ia berada di
 * berkas halaman ia tetap ikut diunduh oleh setiap orang yang membuka menu
 * Akademik untuk keperluan lain. Halaman induknya memuatnya lewat `dynamic()`,
 * pola yang sama dengan panel ID Card.
 *
 * Nama propsnya sengaja identik dengan nama variabel di halaman induk supaya
 * badan JSX-nya berpindah tanpa satu pun suntingan.
 */
export interface JurusanPanelProps {
  jurusanList: Record<string, unknown>[];
  loading: boolean;
  canManage: boolean;
  setFormJurusan: Dispatch<SetStateAction<JurusanInput>>;
  setModalType: Dispatch<SetStateAction<TabKey | null>>;
  handleDeleteItem: (type: TabKey, id: string) => Promise<void>;
}

export function JurusanPanel({
  jurusanList,
  loading,
  canManage,
  setFormJurusan,
  setModalType,
  handleDeleteItem,
}: JurusanPanelProps) {
  return (
    <div className="overflow-hidden rounded-2xl border border-white/10 bg-slate-900/60 shadow-xl backdrop-blur-xl">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm text-slate-200">
          <thead className="border-b border-white/10 bg-white/[0.03] text-xs uppercase tracking-wider text-slate-400">
            <tr>
              <th className="px-6 py-4">Kode</th>
              <th className="px-6 py-4">Nama Jurusan</th>
              <th className="px-6 py-4">Deskripsi</th>
              <th className="px-6 py-4">Status</th>
              <th className="px-6 py-4 text-right">Aksi</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {loading ? (
              <tr>
                <td
                  colSpan={5}
                  className="px-6 py-8 text-center text-slate-400"
                >
                  Memuat data jurusan...
                </td>
              </tr>
            ) : jurusanList.length === 0 ? (
              <tr>
                <td
                  colSpan={5}
                  className="px-6 py-8 text-center text-slate-400"
                >
                  Belum ada data program keahlian/jurusan.
                </td>
              </tr>
            ) : (
              jurusanList.map((item) => {
                const id = String(item.id_jurusan);
                return (
                  <tr key={id} className="transition hover:bg-white/[0.02]">
                    <td className="px-6 py-4 font-mono font-bold text-sky-400">
                      {String(item.kode_jurusan)}
                    </td>
                    <td className="px-6 py-4 font-bold text-white">
                      {String(item.nama_jurusan)}
                    </td>
                    <td className="px-6 py-4 text-xs text-slate-400 max-w-xs truncate">
                      {String(item.deskripsi || "-")}
                    </td>
                    <td className="px-6 py-4">
                      {Number(item.is_aktif) === 1 ? (
                        <span className="rounded-full bg-emerald-400/10 px-2.5 py-0.5 text-xs font-semibold text-emerald-400">
                          Aktif
                        </span>
                      ) : (
                        <span className="rounded-full bg-slate-800 px-2.5 py-0.5 text-xs font-semibold text-slate-400">
                          Nonaktif
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-right">
                      {canManage ? (
                        <div className="flex items-center justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              setFormJurusan({
                                id_jurusan: id,
                                kode_jurusan: String(item.kode_jurusan),
                                nama_jurusan: String(item.nama_jurusan),
                                deskripsi: item.deskripsi
                                  ? String(item.deskripsi)
                                  : "",
                                is_aktif: Number(item.is_aktif),
                              });
                              setModalType("jurusan");
                            }}
                            className="rounded-lg bg-white/5 p-1.5 text-slate-300 hover:bg-white/10 hover:text-white"
                          >
                            <Icon name="tools" className="size-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleDeleteItem("jurusan", id)}
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
