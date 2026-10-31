"use client";

import { useCallback, useEffect, useState } from "react";
import {
  hariIniWib,
  INPUT,
  LABEL,
  pesanGalat,
  TOMBOL_KEDUA,
} from "@/components/inventory/gaya";
import {
  eksporLebarExcel,
  type TabelLebar,
  tabelPenerimaan,
  tabelRekapRombel,
  teksSel,
  unduhLebarPdf,
} from "@/components/keuangan/eksporKeuangan";
import { BarisEkspor } from "@/components/keuangan/LaporanKeuangan";
import { PilihCari } from "@/components/ui/PilihCari";
import {
  getRekapPenerimaan,
  getRekapRombel,
  type MasterTagihan,
} from "@/lib/gateways/billing";
import { subscribeSyncCompleted } from "@/lib/gateways/sync-status";

/**
 * Tab Rekap halaman Tagihan: rekap per rombel untuk satu periode dan
 * penerimaan per jenis per bulan. Layar, Excel, dan PDF memakai baris yang
 * sama dari `tabelRekapRombel`/`tabelPenerimaan`. Dipakai Web/Desktop dan
 * Mobile (disalin lewat `filesToCopy`).
 */

type Laporan = "rombel" | "penerimaan";
type Basis = "ajaran" | "kalender";

export function RekapTagihan({ master }: { master: MasterTagihan }) {
  const hariIni = hariIniWib();
  const tahunIni = Number(hariIni.slice(0, 4));
  const bulanIni = Number(hariIni.slice(5, 7));
  const [laporan, setLaporan] = useState<Laporan>("rombel");
  const [periode, setPeriode] = useState(hariIni.slice(0, 7));
  const [idJenis, setIdJenis] = useState("");
  const [basis, setBasis] = useState<Basis>("ajaran");
  // Tahun ajaran berjalan dimulai Juli tahun lalu bila sekarang Januari-Juni.
  const [tahun, setTahun] = useState(
    String(bulanIni >= 7 ? tahunIni : tahunIni - 1),
  );
  const [tabel, setTabel] = useState<TabelLebar | null>(null);
  const [galatMuat, setGalatMuat] = useState<string | null>(null);

  const tahunSah = /^\d{4}$/.test(tahun) ? tahun : "";
  const namaJenis =
    master.jenis.find((j) => j.id_jenis_tagihan === idJenis)?.nama ?? null;

  const muat = useCallback(async () => {
    setTabel(null);
    setGalatMuat(null);
    try {
      if (laporan === "rombel") {
        if (!periode.trim()) return;
        setTabel(
          tabelRekapRombel(
            await getRekapRombel(periode.trim(), idJenis || null),
            namaJenis,
          ),
        );
      } else if (tahunSah) {
        setTabel(
          tabelPenerimaan(
            await getRekapPenerimaan(
              `${tahunSah}-${basis === "ajaran" ? "07" : "01"}`,
            ),
          ),
        );
      }
    } catch (error) {
      setGalatMuat(pesanGalat(error, "Rekap tidak bisa dimuat."));
    }
  }, [laporan, periode, idJenis, namaJenis, basis, tahunSah]);

  useEffect(() => {
    void muat();
  }, [muat]);
  useEffect(() => subscribeSyncCompleted(() => void muat()), [muat]);

  const belumLengkap = laporan === "rombel" ? !periode.trim() : tahunSah === "";

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <label className={LABEL} htmlFor="rekap-laporan">
            Rekap
          </label>
          <select
            id="rekap-laporan"
            className={INPUT}
            value={laporan}
            onChange={(e) => setLaporan(e.target.value as Laporan)}
          >
            <option value="rombel">Tagihan per rombel</option>
            <option value="penerimaan">Penerimaan per bulan</option>
          </select>
        </div>
        {laporan === "rombel" ? (
          <>
            <div>
              <label className={LABEL} htmlFor="rekap-periode">
                Periode tagihan
              </label>
              <input
                id="rekap-periode"
                className={INPUT}
                placeholder="2026-07, 2026/2027, atau SEKALI"
                value={periode}
                onChange={(e) => setPeriode(e.target.value)}
              />
            </div>
            <div>
              <label className={LABEL} htmlFor="rekap-jenis">
                Jenis tagihan
              </label>
              <PilihCari
                id="rekap-jenis"
                className={INPUT}
                value={idJenis}
                onChange={(e) => setIdJenis(e.target.value)}
              >
                <option value="">Semua jenis</option>
                {master.jenis.map((item) => (
                  <option
                    key={item.id_jenis_tagihan}
                    value={item.id_jenis_tagihan}
                  >
                    {item.nama}
                  </option>
                ))}
              </PilihCari>
            </div>
          </>
        ) : (
          <>
            <div>
              <label className={LABEL} htmlFor="rekap-basis">
                Rentang 12 bulan
              </label>
              <select
                id="rekap-basis"
                className={INPUT}
                value={basis}
                onChange={(e) => setBasis(e.target.value as Basis)}
              >
                <option value="ajaran">Tahun ajaran (Juli-Juni)</option>
                <option value="kalender">
                  Tahun kalender (Januari-Desember)
                </option>
              </select>
            </div>
            <div>
              <label className={LABEL} htmlFor="rekap-tahun">
                {basis === "ajaran" ? "Tahun ajaran mulai Juli" : "Tahun"}
              </label>
              <input
                id="rekap-tahun"
                className={INPUT}
                inputMode="numeric"
                maxLength={4}
                value={tahun}
                onChange={(e) => setTahun(e.target.value.replace(/\D/g, ""))}
              />
            </div>
          </>
        )}
      </div>

      {belumLengkap ? (
        <p className="p-6 text-center text-sm text-slate-400">
          {laporan === "rombel"
            ? "Isi periode tagihan untuk melihat rekapnya."
            : "Isi tahun dengan empat angka."}
        </p>
      ) : galatMuat ? (
        <div className="p-4 rounded-xl border border-rose-500/30 bg-rose-500/20 text-sm text-rose-100 space-y-3">
          <p>{galatMuat}</p>
          <button
            type="button"
            className={TOMBOL_KEDUA}
            onClick={() => void muat()}
          >
            Coba muat lagi
          </button>
        </div>
      ) : !tabel ? (
        <p className="p-6 text-center text-sm text-slate-400">
          Menyusun rekap...
        </p>
      ) : tabel.baris.length <= 1 ? (
        <p className="p-6 text-center text-sm text-slate-400 rounded-xl border border-dashed border-slate-700">
          {laporan === "rombel"
            ? "Tidak ada tagihan pada periode ini."
            : "Belum ada pembayaran pada rentang ini."}
        </p>
      ) : (
        <div className="space-y-3">
          <div className="rounded-xl border border-slate-800 bg-slate-900/60">
            <div className="px-3 py-3 border-b border-slate-800">
              <h2 className="text-base font-semibold text-slate-100">
                {tabel.judul}
              </h2>
              <p className="text-xs text-slate-400">{tabel.periode}</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-xs text-slate-400">
                  <tr>
                    {tabel.kolom.map((kolom, i) => (
                      <th
                        key={kolom}
                        scope="col"
                        className={`px-3 py-2 font-medium whitespace-nowrap ${i > 0 ? "text-right" : "sticky left-0 bg-slate-900"}`}
                      >
                        {kolom}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {tabel.baris.map((baris, indeks) => (
                    <tr
                      // biome-ignore lint/suspicious/noArrayIndexKey: baris tabel statis tanpa id, urutannya tidak pernah berubah di tempat.
                      key={indeks}
                      className={`border-t ${baris.tebal ? "border-slate-700 font-semibold text-slate-100" : "border-slate-800 text-slate-200"}`}
                    >
                      {baris.sel.map((sel, i) => (
                        <td
                          // biome-ignore lint/suspicious/noArrayIndexKey: posisi kolom adalah identitas selnya.
                          key={i}
                          colSpan={
                            baris.sel.length === 1
                              ? tabel.kolom.length
                              : undefined
                          }
                          className={`px-3 py-1.5 whitespace-nowrap ${i > 0 ? "text-right tabular-nums" : "sticky left-0 bg-slate-900"}`}
                        >
                          {teksSel(sel)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          {tabel.catatan.map((catatan) => (
            <p key={catatan} className="text-xs text-slate-400">
              {catatan}
            </p>
          ))}
          <BarisEkspor
            aksi={[
              {
                label: "Ekspor Excel",
                jenis: "Excel",
                kerja: () => eksporLebarExcel(tabel),
              },
              {
                label: "Unduh PDF",
                jenis: "PDF",
                kerja: () => unduhLebarPdf(tabel),
              },
            ]}
          />
        </div>
      )}
    </div>
  );
}
