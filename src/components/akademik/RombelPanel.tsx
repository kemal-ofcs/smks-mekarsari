"use client";

import type { Dispatch, SetStateAction } from "react";
import { Icon } from "@/components/ui/Icon";
import type { RombelInput } from "@/lib/gateways/academic";

type TabKey = "tahun_ajaran" | "jurusan" | "rombel" | "mapel" | "penugasan";

/**
 * Rombel pada menu Akademik
 *
 * Panel ini hanya dirender ketika tabnya aktif, sehingga selama ia berada di
 * berkas halaman ia tetap ikut diunduh oleh setiap orang yang membuka menu
 * Akademik untuk keperluan lain. Halaman induknya memuatnya lewat `dynamic()`,
 * pola yang sama dengan panel ID Card.
 *
 * Nama propsnya sengaja identik dengan nama variabel di halaman induk supaya
 * badan JSX-nya berpindah tanpa satu pun suntingan.
 */
export interface RombelPanelProps {
  rombelList: Record<string, unknown>[];
  tahunAjaranList: Record<string, unknown>[];
  selectedTaForRombel: string;
  loading: boolean;
  canManage: boolean;
  setFormRombel: Dispatch<SetStateAction<RombelInput>>;
  setModalType: Dispatch<SetStateAction<TabKey | null>>;
  handleTaFilterChange: (taId: string) => Promise<void>;
  handleDeleteItem: (type: TabKey, id: string) => Promise<void>;
}

export function RombelPanel({
  rombelList,
  tahunAjaranList,
  selectedTaForRombel,
  loading,
  canManage,
  setFormRombel,
  setModalType,
  handleTaFilterChange,
  handleDeleteItem,
}: RombelPanelProps) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <label
          htmlFor="ta-filter-rombel"
          className="text-xs font-semibold text-slate-400"
        >
          Filter Tahun Ajaran:
        </label>
        <select
          id="ta-filter-rombel"
          value={selectedTaForRombel}
          onChange={(e) => void handleTaFilterChange(e.target.value)}
          className="rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-sm text-slate-100 shadow-inner focus:border-sky-500 focus:outline-none"
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

      <div className="overflow-hidden rounded-2xl border border-white/10 bg-slate-900/60 shadow-xl backdrop-blur-xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-slate-200">
            <thead className="border-b border-white/10 bg-white/[0.03] text-xs uppercase tracking-wider text-slate-400">
              <tr>
                <th className="px-6 py-4">Tingkat</th>
                <th className="px-6 py-4">Nama Rombel</th>
                <th className="px-6 py-4">Jurusan</th>
                <th className="px-6 py-4">Wali Kelas</th>
                <th className="px-6 py-4">Ruang & Siswa</th>
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
                    Memuat data rombel...
                  </td>
                </tr>
              ) : rombelList.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    className="px-6 py-8 text-center text-slate-400"
                  >
                    Belum ada rombel pada tahun ajaran ini.
                  </td>
                </tr>
              ) : (
                rombelList.map((item) => {
                  const id = String(item.id_rombel);
                  return (
                    <tr key={id} className="transition hover:bg-white/[0.02]">
                      <td className="px-6 py-4 font-mono font-bold text-sky-400">
                        Kelas {String(item.tingkat)}
                      </td>
                      <td className="px-6 py-4 font-bold text-white">
                        {String(item.nama_rombel)}
                      </td>
                      <td className="px-6 py-4 text-xs text-slate-300">
                        {String(item.nama_jurusan || item.kode_jurusan || "-")}
                      </td>
                      <td className="px-6 py-4 text-sm text-slate-300">
                        {String(item.nama_wali_kelas || "Belum ditentukan")}
                      </td>
                      <td className="px-6 py-4 text-xs text-slate-400">
                        {String(item.ruang_kelas || "-")} |{" "}
                        {String(item.jumlah_siswa || 0)} /{" "}
                        {String(item.kapasitas || 36)} Siswa
                      </td>
                      <td className="px-6 py-4 text-right">
                        {canManage ? (
                          <div className="flex items-center justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                setFormRombel({
                                  id_rombel: id,
                                  id_tahun_ajaran: String(item.id_tahun_ajaran),
                                  tingkat: Number(item.tingkat),
                                  id_jurusan: item.id_jurusan
                                    ? String(item.id_jurusan)
                                    : "",
                                  nama_rombel: String(item.nama_rombel),
                                  id_wali_kelas: item.id_wali_kelas
                                    ? String(item.id_wali_kelas)
                                    : "",
                                  kapasitas: Number(item.kapasitas),
                                  ruang_kelas: item.ruang_kelas
                                    ? String(item.ruang_kelas)
                                    : "",
                                  is_aktif: Number(item.is_aktif),
                                });
                                setModalType("rombel");
                              }}
                              className="rounded-lg bg-white/5 p-1.5 text-slate-300 hover:bg-white/10 hover:text-white"
                            >
                              <Icon name="tools" className="size-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                void handleDeleteItem("rombel", id)
                              }
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
    </div>
  );
}
