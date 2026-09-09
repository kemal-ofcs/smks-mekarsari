"use client";

import type { Dispatch, SetStateAction } from "react";
import { Icon } from "@/components/ui/Icon";
import type { TahunAjaranInput } from "@/lib/gateways/academic";

type TabKey = "tahun_ajaran" | "jurusan" | "rombel" | "mapel" | "penugasan";

/**
 * TahunAjaran pada menu Akademik
 *
 * Panel ini hanya dirender ketika tabnya aktif, sehingga selama ia berada di
 * berkas halaman ia tetap ikut diunduh oleh setiap orang yang membuka menu
 * Akademik untuk keperluan lain. Halaman induknya memuatnya lewat `dynamic()`,
 * pola yang sama dengan panel ID Card.
 *
 * Nama propsnya sengaja identik dengan nama variabel di halaman induk supaya
 * badan JSX-nya berpindah tanpa satu pun suntingan.
 */
export interface TahunAjaranPanelProps {
  tahunAjaranList: Record<string, unknown>[];
  loading: boolean;
  canManage: boolean;
  setFormTA: Dispatch<SetStateAction<TahunAjaranInput>>;
  setModalType: Dispatch<SetStateAction<TabKey | null>>;
  handleSetActiveTA: (id: string) => Promise<void>;
  handleDeleteItem: (type: TabKey, id: string) => Promise<void>;
}

export function TahunAjaranPanel({
  tahunAjaranList,
  loading,
  canManage,
  setFormTA,
  setModalType,
  handleSetActiveTA,
  handleDeleteItem,
}: TahunAjaranPanelProps) {
  return (
    <div className="overflow-hidden rounded-2xl border border-white/10 bg-slate-900/60 shadow-xl backdrop-blur-xl">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm text-slate-200">
          <thead className="border-b border-white/10 bg-white/[0.03] text-xs uppercase tracking-wider text-slate-400">
            <tr>
              <th className="px-6 py-4">Tahun Ajaran</th>
              <th className="px-6 py-4">Semester</th>
              <th className="px-6 py-4">Periode</th>
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
                  Memuat data tahun ajaran...
                </td>
              </tr>
            ) : tahunAjaranList.length === 0 ? (
              <tr>
                <td
                  colSpan={5}
                  className="px-6 py-8 text-center text-slate-400"
                >
                  Belum ada data tahun ajaran. Silakan tambahkan data baru.
                </td>
              </tr>
            ) : (
              tahunAjaranList.map((item) => {
                const id = String(item.id_tahun_ajaran);
                const isAktif = Number(item.is_aktif) === 1;
                return (
                  <tr key={id} className="transition hover:bg-white/[0.02]">
                    <td className="px-6 py-4 font-bold text-white">
                      {String(item.nama_tahun)}
                    </td>
                    <td className="px-6 py-4">{String(item.semester)}</td>
                    <td className="px-6 py-4 text-xs text-slate-400">
                      {String(item.tanggal_mulai)} s/d{" "}
                      {String(item.tanggal_selesai)}
                    </td>
                    <td className="px-6 py-4">
                      {isAktif ? (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-400/10 px-3 py-1 text-xs font-semibold text-emerald-400 border border-emerald-400/20">
                          <span className="size-1.5 rounded-full bg-emerald-400" />
                          Aktif Berjalan
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-800 px-3 py-1 text-xs font-semibold text-slate-400 border border-white/5">
                          Nonaktif
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        {!isAktif && canManage ? (
                          <button
                            type="button"
                            onClick={() => void handleSetActiveTA(id)}
                            className="rounded-lg bg-sky-500/10 px-2.5 py-1 text-xs font-bold text-sky-400 border border-sky-500/20 hover:bg-sky-500/20"
                          >
                            Jadikan Aktif
                          </button>
                        ) : null}
                        {canManage ? (
                          <>
                            <button
                              type="button"
                              onClick={() => {
                                setFormTA({
                                  id_tahun_ajaran: id,
                                  nama_tahun: String(item.nama_tahun),
                                  semester:
                                    String(item.semester) === "Genap"
                                      ? "Genap"
                                      : "Ganjil",
                                  tanggal_mulai: String(item.tanggal_mulai),
                                  tanggal_selesai: String(item.tanggal_selesai),
                                  is_aktif: Number(item.is_aktif),
                                });
                                setModalType("tahun_ajaran");
                              }}
                              className="rounded-lg bg-white/5 p-1.5 text-slate-300 hover:bg-white/10 hover:text-white"
                              title="Edit"
                            >
                              <Icon name="tools" className="size-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                void handleDeleteItem("tahun_ajaran", id)
                              }
                              className="rounded-lg bg-rose-500/10 p-1.5 text-rose-400 hover:bg-rose-500/20"
                              title="Hapus"
                            >
                              <Icon name="trash" className="size-4" />
                            </button>
                          </>
                        ) : null}
                      </div>
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
