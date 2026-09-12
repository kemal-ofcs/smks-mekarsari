"use client";

import { Icon } from "@/components/ui/Icon";

type TabKey =
  | "tahun_ajaran"
  | "jurusan"
  | "rombel"
  | "mapel"
  | "penugasan"
  | "jadwal";

/**
 * Penugasan pada menu Akademik
 *
 * Panel ini hanya dirender ketika tabnya aktif, sehingga selama ia berada di
 * berkas halaman ia tetap ikut diunduh oleh setiap orang yang membuka menu
 * Akademik untuk keperluan lain. Halaman induknya memuatnya lewat `dynamic()`,
 * pola yang sama dengan panel ID Card.
 *
 * Nama propsnya sengaja identik dengan nama variabel di halaman induk supaya
 * badan JSX-nya berpindah tanpa satu pun suntingan.
 */
export interface PenugasanPanelProps {
  penugasanList: Record<string, unknown>[];
  rombelList: Record<string, unknown>[];
  selectedRombelForPenugasan: string;
  loading: boolean;
  canManage: boolean;
  handleRombelFilterChange: (rombelId: string) => Promise<void>;
  handleDeleteItem: (type: TabKey, id: string) => Promise<void>;
}

export function PenugasanPanel({
  penugasanList,
  rombelList,
  selectedRombelForPenugasan,
  loading,
  canManage,
  handleRombelFilterChange,
  handleDeleteItem,
}: PenugasanPanelProps) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <label
          htmlFor="rombel-filter-penugasan"
          className="text-xs font-semibold text-slate-400"
        >
          Filter Rombel:
        </label>
        <select
          id="rombel-filter-penugasan"
          value={selectedRombelForPenugasan}
          onChange={(e) => void handleRombelFilterChange(e.target.value)}
          className="rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-sm text-slate-100 shadow-inner focus:border-sky-500 focus:outline-none"
        >
          {rombelList.map((rom) => (
            <option
              key={String(rom.id_rombel)}
              value={String(rom.id_rombel)}
              className="bg-slate-900 text-slate-100"
            >
              Kelas {String(rom.tingkat)} - {String(rom.nama_rombel)}
            </option>
          ))}
        </select>
      </div>

      <div className="overflow-hidden rounded-2xl border border-white/10 bg-slate-900/60 shadow-xl backdrop-blur-xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-slate-200">
            <thead className="border-b border-white/10 bg-white/[0.03] text-xs uppercase tracking-wider text-slate-400">
              <tr>
                <th className="px-6 py-4">Rombel</th>
                <th className="px-6 py-4">Mata Pelajaran</th>
                <th className="px-6 py-4">Guru Pengampu</th>
                <th className="px-6 py-4">NIP / Gelar</th>
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
                    Memuat data penugasan guru...
                  </td>
                </tr>
              ) : penugasanList.length === 0 ? (
                <tr>
                  <td
                    colSpan={5}
                    className="px-6 py-8 text-center text-slate-400"
                  >
                    Belum ada penugasan guru pengajar untuk rombel ini.
                  </td>
                </tr>
              ) : (
                penugasanList.map((item) => {
                  const id = String(item.id_penugasan);
                  return (
                    <tr key={id} className="transition hover:bg-white/[0.02]">
                      <td className="px-6 py-4 font-bold text-white">
                        {String(item.nama_rombel)}
                      </td>
                      <td className="px-6 py-4 font-semibold text-sky-400">
                        {String(item.nama_mapel)} ({String(item.beban_jam)} JP)
                      </td>
                      <td className="px-6 py-4 text-slate-100 font-medium">
                        {String(item.nama_guru || "-")}
                      </td>
                      <td className="px-6 py-4 text-xs text-slate-400">
                        {String(item.nip || "-")}{" "}
                        {item.gelar ? `(${String(item.gelar)})` : ""}
                      </td>
                      <td className="px-6 py-4 text-right">
                        {canManage ? (
                          <button
                            type="button"
                            onClick={() =>
                              void handleDeleteItem("penugasan", id)
                            }
                            className="rounded-lg bg-rose-500/10 p-1.5 text-rose-400 hover:bg-rose-500/20"
                          >
                            <Icon name="trash" className="size-4" />
                          </button>
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
