"use client";

import type { Dispatch, SetStateAction } from "react";
import { Icon } from "@/components/ui/Icon";
import { parseUnitKeterangan } from "@/lib/constants/academic-levels";
import type { UnitInput } from "@/lib/gateways/academic";

type TabKey =
  | "tahun_ajaran"
  | "unit"
  | "jurusan"
  | "rombel"
  | "mapel"
  | "penugasan"
  | "jadwal";

/**
 * Unit satuan pendidikan pada menu Akademik.
 *
 * Daftar ini jadi sumber dropdown "Unit" di formulir peserta didik, guru/PTK,
 * dan karyawan. Karena `master_data.unit` menyimpan NAMA unit dan bukan
 * `id_unit`, mengganti nama di sini ikut memindahkan personil yang memakainya —
 * dikerjakan backend dalam satu transaksi, bukan oleh panel ini.
 *
 * Nama propsnya sengaja identik dengan nama variabel di halaman induk supaya
 * badan JSX-nya berpindah tanpa satu pun suntingan.
 */
export interface UnitPanelProps {
  unitList: Record<string, unknown>[];
  loading: boolean;
  canManage: boolean;
  setFormUnit: Dispatch<SetStateAction<UnitInput>>;
  setModalType: Dispatch<SetStateAction<TabKey | null>>;
  handleDeleteItem: (type: TabKey, id: string) => Promise<void>;
}

export function UnitPanel({
  unitList,
  loading,
  canManage,
  setFormUnit,
  setModalType,
  handleDeleteItem,
}: UnitPanelProps) {
  return (
    <div className="overflow-hidden rounded-2xl border border-white/10 bg-slate-900/60 shadow-xl backdrop-blur-xl">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm text-slate-200">
          <thead className="border-b border-white/10 bg-white/[0.03] text-xs uppercase tracking-wider text-slate-400">
            <tr>
              <th className="px-6 py-4">Urutan</th>
              <th className="px-6 py-4">Nama Unit</th>
              <th className="px-6 py-4">Keterangan</th>
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
                  Memuat data unit...
                </td>
              </tr>
            ) : unitList.length === 0 ? (
              <tr>
                <td
                  colSpan={5}
                  className="px-6 py-8 text-center text-slate-400"
                >
                  Belum ada unit. Tambahkan TK, SD, SMP, atau satuan lain yang
                  dipakai sekolah ini.
                </td>
              </tr>
            ) : (
              unitList.map((item) => {
                const id = String(item.id_unit);
                return (
                  <tr key={id} className="transition hover:bg-white/[0.02]">
                    <td className="px-6 py-4 font-mono font-bold text-sky-400">
                      {String(item.urutan ?? 0)}
                    </td>
                    <td className="px-6 py-4 font-bold text-white">
                      {String(item.nama_unit)}
                    </td>
                    <td className="max-w-md px-6 py-4 text-xs">
                      {(() => {
                        const parsed = parseUnitKeterangan(item.keterangan);
                        return (
                          <div className="flex flex-col gap-1.5">
                            {parsed.deskripsi ? (
                              <span className="text-slate-300 line-clamp-1">
                                {parsed.deskripsi}
                              </span>
                            ) : null}
                            {parsed.daftar_tingkat.length > 0 ? (
                              <div className="flex flex-wrap items-center gap-1">
                                {parsed.daftar_tingkat.map((t) => (
                                  <span
                                    key={t.tingkat}
                                    className="inline-flex items-center rounded-md border border-sky-500/20 bg-sky-500/10 px-2 py-0.5 text-[11px] font-medium text-sky-300"
                                    title={`Tingkat ${t.tingkat}`}
                                  >
                                    {t.nama}
                                  </span>
                                ))}
                              </div>
                            ) : (
                              <span className="text-slate-500 italic">
                                Belum ada tingkat kelas
                              </span>
                            )}
                          </div>
                        );
                      })()}
                    </td>
                    <td className="px-6 py-4">
                      {Number(item.status_aktif) === 1 ? (
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
                            aria-label={`Ubah unit ${String(item.nama_unit)}`}
                            onClick={() => {
                              setFormUnit({
                                id_unit: id,
                                nama_unit: String(item.nama_unit),
                                keterangan: item.keterangan
                                  ? String(item.keterangan)
                                  : "",
                                urutan: Number(item.urutan ?? 0),
                                status_aktif: Number(item.status_aktif),
                              });
                              setModalType("unit");
                            }}
                            className="rounded-lg bg-white/5 p-1.5 text-slate-300 hover:bg-white/10 hover:text-white"
                          >
                            <Icon name="tools" className="size-4" />
                          </button>
                          <button
                            type="button"
                            aria-label={`Hapus unit ${String(item.nama_unit)}`}
                            onClick={() => void handleDeleteItem("unit", id)}
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
