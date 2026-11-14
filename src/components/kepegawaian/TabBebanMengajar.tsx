"use client";

import { useCallback, useEffect, useState } from "react";
import { exportToExcel } from "@/lib/client/excel-export";
import { muatBebanMengajar, muatLaporanPtk } from "@/lib/gateways/hris";
import {
  type DataBeban,
  daftarUnitBeban,
  dalamUnitBeban,
  kalimatTandaBeban,
  type RekapBeban,
  susunBebanMengajar,
} from "@/lib/validations/hr-beban";
import { INPUT, LABEL, pesanGalat, TOMBOL, TOMBOL_UTAMA } from "./gaya";

const KOLOM = [
  "No",
  "Nama",
  "NIP",
  "NUPTK",
  "Status",
  "Unit",
  "Mapel (rombel: JP)",
  "JP tatap muka",
  "Tugas tambahan (ekuivalen)",
  "JP tugas",
  "Total JP",
  "Batas",
  "Keterangan",
  "Bidang sertifikat",
];

const namaLengkap = (r: RekapBeban) =>
  r.gelar.trim() ? `${r.nama}, ${r.gelar.trim()}` : r.nama;

/** `Matematika (7A: 2, 7B: 4); IPA (8A: 3)`. */
function teksMapel(r: RekapBeban): string {
  const per = new Map<string, string[]>();
  for (const m of r.mapel) {
    per.set(m.nama_mapel, [
      ...(per.get(m.nama_mapel) ?? []),
      `${m.nama_rombel}: ${m.jp}`,
    ]);
  }
  return [...per.entries()]
    .map(([mapel, rombel]) => `${mapel} (${rombel.join(", ")})`)
    .join("; ");
}

const teksTugas = (r: RekapBeban) =>
  r.tugas
    .map(
      (t) =>
        `${t.nama_jenis}${t.nama_rombel ? ` ${t.nama_rombel}` : ""} (${t.ekuivalen_jp})`,
    )
    .join("; ");

/**
 * Rekap beban mengajar per semester (§21.2.1): JP tatap muka dari jadwal,
 * ekuivalen tugas tambahan, dan tandanya. Data dari SQLite lokal di Desktop
 * (jalan luring); bidang sertifikat dari Laporan PTK (cloud), jadi tanda
 * linier hanya ada saat terhubung (Q-64).
 */
export function TabBebanMengajar({
  onPesan,
  onGalat,
}: {
  onPesan: (pesan: string) => void;
  onGalat: (pesan: string) => void;
}) {
  const [data, setData] = useState<DataBeban | null>(null);
  const [sertifikat, setSertifikat] = useState<Map<string, string> | null>(
    null,
  );
  const [galat, setGalat] = useState<string | null>(null);
  const [unit, setUnit] = useState("");
  const [mengunduh, setMengunduh] = useState(false);

  const muat = useCallback(async (idTahunAjaran: string) => {
    try {
      setData(await muatBebanMengajar(idTahunAjaran));
      setGalat(null);
    } catch (error) {
      setGalat(pesanGalat(error));
    }
  }, []);

  useEffect(() => {
    void muat("");
    muatLaporanPtk()
      .then((ptk) =>
        setSertifikat(
          new Map(ptk.baris.map((b) => [b.id_unik, b.sertifikat_bidang])),
        ),
      )
      .catch(() => setSertifikat(null));
  }, [muat]);

  if (galat) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-rose-300" role="alert">
          {galat}
        </p>
        <button
          type="button"
          className={TOMBOL}
          onClick={() => void muat(data?.id_tahun_ajaran ?? "")}
        >
          Coba lagi
        </button>
      </div>
    );
  }
  if (!data) {
    return <p className="text-sm text-slate-400">Memuat beban mengajar…</p>;
  }
  if (data.semester.length === 0) {
    return (
      <p className="text-sm text-slate-400">
        Belum ada semester. Buat tahun ajaran di halaman Akademik dulu.
      </p>
    );
  }

  const rekap = susunBebanMengajar(data, sertifikat);
  const daftarUnit = daftarUnitBeban(rekap);
  const baris = rekap.filter((r) => dalamUnitBeban(r, unit));
  const kurang = baris.filter((r) =>
    r.tanda.includes("kurang_dari_batas"),
  ).length;
  const lebih = baris.filter((r) =>
    r.tanda.includes("lebih_dari_batas"),
  ).length;
  const semester = data.semester.find(
    (s) => s.id_tahun_ajaran === data.id_tahun_ajaran,
  );
  const namaSemester = semester
    ? `${semester.nama_tahun} ${semester.semester}`
    : "";
  const batas = `${data.batas.min}-${data.batas.maks}`;
  const keterangan = (r: RekapBeban) =>
    r.tanda.map((t) => kalimatTandaBeban(t, data.batas)).join("; ");
  const bidang = (r: RekapBeban) =>
    sertifikat ? (sertifikat.get(r.id_unik) ?? "") : "Butuh koneksi";

  const unduh = async () => {
    if (mengunduh) return;
    setMengunduh(true);
    try {
      const isi = baris.map((r, i) => [
        i + 1,
        namaLengkap(r),
        r.nip,
        r.nuptk,
        r.status,
        r.unit,
        teksMapel(r),
        r.jp_tatap_muka,
        teksTugas(r),
        r.jp_tugas,
        r.total,
        batas,
        keterangan(r),
        bidang(r),
      ]);
      const hasil = await exportToExcel(
        `beban-mengajar-${namaSemester.replace(/[^\w-]+/g, "-")}-${unit || "semua-unit"}`,
        "Beban Mengajar",
        KOLOM,
        [
          ...isi,
          [],
          ["", `Semester ${namaSemester}, unit ${unit || "semua"}`],
          ["", `Jumlah guru: ${baris.length}`],
          ["", `Di bawah batas ${data.batas.min} JP: ${kurang}`],
          ["", `Di atas batas ${data.batas.maks} JP: ${lebih}`],
        ],
      );
      if (!hasil.cancelled) {
        if (hasil.sukses)
          onPesan(`Rekap beban mengajar (${baris.length} guru) diunduh.`);
        else onGalat("Berkas rekap beban mengajar gagal disimpan.");
      }
    } catch (error) {
      onGalat(pesanGalat(error));
    } finally {
      setMengunduh(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-48">
          <label htmlFor="beban-semester" className={LABEL}>
            Semester
          </label>
          <select
            id="beban-semester"
            value={data.id_tahun_ajaran}
            onChange={(e) => {
              setData(null);
              void muat(e.target.value);
            }}
            className={INPUT}
          >
            {data.semester.map((s) => (
              <option key={s.id_tahun_ajaran} value={s.id_tahun_ajaran}>
                {s.nama_tahun} {s.semester}
                {s.is_aktif === 1 ? " (aktif)" : ""}
              </option>
            ))}
          </select>
        </div>
        <div className="min-w-48">
          <label htmlFor="beban-unit" className={LABEL}>
            Unit
          </label>
          <select
            id="beban-unit"
            value={unit}
            onChange={(e) => setUnit(e.target.value)}
            className={INPUT}
          >
            <option value="">Semua unit</option>
            {daftarUnit.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>
        </div>
        <button
          type="button"
          className={TOMBOL_UTAMA}
          disabled={mengunduh || baris.length === 0}
          onClick={() => void unduh()}
        >
          {mengunduh ? "Menyiapkan…" : "Unduh Excel"}
        </button>
      </div>
      <p className="text-sm text-slate-400">
        JP tatap muka dari jadwal mengajar; jam yang sama di beberapa rombel
        dihitung sekali, seperti honor JP. Batas {batas} JP per minggu diatur di
        tab Organisasi. {baris.length} guru, {kurang} di bawah batas, {lebih} di
        atas batas.
        {sertifikat
          ? ""
          : " Bidang sertifikat butuh koneksi ke database cloud."}
      </p>
      <div className="overflow-x-auto rounded-2xl border border-white/10">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="bg-slate-900 text-xs uppercase text-slate-400">
            <tr>
              <th className="px-3 py-2">Guru</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2 text-right">Tatap muka</th>
              <th className="px-3 py-2 text-right">Tugas</th>
              <th className="px-3 py-2 text-right">Total</th>
              <th className="px-3 py-2">Keterangan</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5 text-slate-200">
            {baris.map((r) => (
              <tr key={r.id_unik} className="align-top">
                <td className="px-3 py-2">
                  <details>
                    <summary className="cursor-pointer font-semibold text-white">
                      {namaLengkap(r)}
                    </summary>
                    <RincianBeban r={r} bidang={bidang(r)} />
                  </details>
                </td>
                <td className="px-3 py-2">{r.status || "-"}</td>
                <td className="px-3 py-2 text-right">{r.jp_tatap_muka}</td>
                <td className="px-3 py-2 text-right">{r.jp_tugas}</td>
                <td className="px-3 py-2 text-right font-semibold">
                  {r.total}
                </td>
                <td className="px-3 py-2 text-amber-100">{keterangan(r)}</td>
              </tr>
            ))}
            {baris.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-4 text-slate-400">
                  Tidak ada guru di pilihan ini.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RincianBeban({ r, bidang }: { r: RekapBeban; bidang: string }) {
  return (
    <div className="mt-2 space-y-2 text-xs text-slate-300">
      <p>
        NIP {r.nip || "-"} · NUPTK {r.nuptk || "-"} · Unit {r.unit || "-"}
        {r.aktif ? "" : " · nonaktif"}
      </p>
      {r.mapel.length > 0 ? (
        <ul className="space-y-0.5">
          {r.mapel.map((m) => (
            <li key={`${m.id_rombel}-${m.id_mapel}`}>
              {m.nama_mapel} · {m.nama_rombel}
              {m.unit ? ` (${m.unit})` : ""}: {m.jp} JP
              {m.jp_penugasan === null
                ? " · tanpa penugasan"
                : m.jp_penugasan === m.jp
                  ? ""
                  : ` · penugasan ${m.jp_penugasan} JP`}
            </li>
          ))}
        </ul>
      ) : null}
      {r.per_unit.length > 1 ? (
        <p>
          Per unit:{" "}
          {r.per_unit
            .map((p) => `${p.unit || "tanpa unit"} ${p.jp} JP`)
            .join(", ")}
        </p>
      ) : null}
      {r.tugas.length > 0 ? <p>Tugas: {teksTugas(r)}</p> : null}
      {r.jam_rusak.length > 0 ? (
        <p>Jam tidak terbaca: {r.jam_rusak.join(", ")}</p>
      ) : null}
      <p>Bidang sertifikat: {bidang || "-"}</p>
    </div>
  );
}
