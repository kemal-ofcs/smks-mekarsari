"use client";

import { useEffect, useMemo, useState } from "react";
import { PilihCari } from "@/components/ui/PilihCari";
import { getDaftarRombel } from "@/lib/gateways/academic";
import { getDaftarSiswa } from "@/lib/gateways/student";
import {
  jenisPersonil,
  LABEL_JENIS,
  type SaringanJenis,
  saringPersonil,
  tambahTerpilih,
} from "./aturanPilihPersonil";

// Satu komponen untuk Web/Desktop dan Mobile (`filesToCopy`). Kelasnya sama
// dengan isian halaman Operasional di kedua build.
const INPUT =
  "min-h-11 w-full rounded-xl border border-white/10 bg-slate-950 px-3 text-sm text-white outline-none focus:border-sky-400";
const CHIP =
  "min-h-9 rounded-xl border px-3 text-xs font-semibold transition disabled:opacity-50";
const TAMPIL_MAKS = 30;

const SARINGAN: { value: SaringanJenis; label: string }[] = [
  { value: "semua", label: "Semua" },
  { value: "siswa", label: "Siswa" },
  { value: "guru", label: "Guru" },
  { value: "pegawai", label: "Pegawai" },
];

interface PilihPersonilProps {
  id: string;
  label: string;
  personil: Record<string, unknown>[];
  terpilih: string[];
  onChange: (ids: string[]) => void;
  /** Diisi = boleh memilih banyak orang sampai jumlah ini. Kosong = satu orang. */
  batas?: number;
  /** Pemanggil memastikan izin `academic.view` dan `students.view`. */
  bolehPilihKelas?: boolean;
  /** Sembunyikan tombol saring jenis, misalnya bila daftarnya sudah tanpa siswa. */
  tanpaSaringanJenis?: boolean;
  disabled?: boolean;
}

export function PilihPersonil({
  id,
  label,
  personil,
  terpilih,
  onChange,
  batas,
  bolehPilihKelas = false,
  tanpaSaringanJenis = false,
  disabled = false,
}: PilihPersonilProps) {
  const banyak = batas !== undefined;
  const [kata, setKata] = useState("");
  const [jenis, setJenis] = useState<SaringanJenis>("semua");
  const [catatan, setCatatan] = useState<string | null>(null);
  const [rombel, setRombel] = useState<Record<string, unknown>[]>([]);
  const [idRombel, setIdRombel] = useState("");
  const [memuatKelas, setMemuatKelas] = useState(false);

  const peta = useMemo(
    () => new Map(personil.map((row) => [String(row.id_unik ?? ""), row])),
    [personil],
  );

  useEffect(() => {
    if (!bolehPilihKelas) return;
    let batal = false;
    getDaftarRombel()
      .then((data) => {
        if (!batal)
          setRombel(data.filter((row) => Number(row.is_aktif ?? 1) === 1));
      })
      .catch((error: unknown) => {
        if (!batal)
          setCatatan(
            error instanceof Error
              ? error.message
              : "Daftar kelas gagal dimuat.",
          );
      });
    return () => {
      batal = true;
    };
  }, [bolehPilihKelas]);

  const adaSaringan = kata.trim() !== "" || jenis !== "semua";
  const hasil = adaSaringan ? saringPersonil(personil, kata, jenis) : [];
  const idManual = kata.trim();

  const tambah = (ids: string[]) => {
    if (!banyak) {
      onChange(ids.slice(0, 1));
      setKata("");
      return;
    }
    const { hasil: baru, terpotong } = tambahTerpilih(terpilih, ids, batas);
    onChange(baru);
    setCatatan(
      terpotong > 0
        ? `${terpotong} orang tidak masuk karena batas ${batas} orang per simpan.`
        : null,
    );
  };

  const alihkan = (idPersonil: string) => {
    if (terpilih.includes(idPersonil)) {
      onChange(terpilih.filter((item) => item !== idPersonil));
    } else {
      tambah([idPersonil]);
    }
  };

  const tambahSekelas = async () => {
    if (!idRombel || memuatKelas) return;
    setMemuatKelas(true);
    setCatatan(null);
    try {
      const siswa = await getDaftarSiswa(idRombel);
      // Hanya siswa yang ada di daftar personil aktif yang bisa diproses.
      const ids = siswa
        .map((row) => String(row.id_siswa ?? ""))
        .filter((item) => peta.has(item));
      const namaKelas = String(
        rombel.find((row) => row.id_rombel === idRombel)?.nama_rombel ??
          "kelas ini",
      );
      if (ids.length === 0) {
        setCatatan(`Tidak ada siswa aktif di ${namaKelas}.`);
        return;
      }
      const { hasil: baru, terpotong } = tambahTerpilih(
        terpilih,
        ids,
        batas ?? 1,
      );
      onChange(baru);
      setCatatan(
        `${ids.length} siswa ${namaKelas} dipilih.${
          terpotong > 0
            ? ` ${terpotong} tidak masuk karena batas ${batas} orang per simpan.`
            : ""
        }`,
      );
    } catch (error) {
      setCatatan(
        error instanceof Error
          ? error.message
          : "Siswa kelas ini gagal dimuat.",
      );
    } finally {
      setMemuatKelas(false);
    }
  };

  const namaDari = (idPersonil: string) =>
    String(peta.get(idPersonil)?.nama ?? idPersonil);

  const keterangan = (row: Record<string, unknown>) =>
    [
      LABEL_JENIS[jenisPersonil(row)],
      String(row.id_unik ?? ""),
      String(row.divisi ?? ""),
    ]
      .filter(Boolean)
      .join(" · ");

  // Mode satu orang yang sudah terpilih: tampilkan orangnya, bukan kotak cari.
  if (!banyak && terpilih[0]) {
    const row = peta.get(terpilih[0]);
    return (
      <div className="space-y-1">
        <span className="text-slate-400 block mb-1 text-xs font-semibold">
          {label}
        </span>
        <div className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-slate-950 px-3 py-2">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-white">
              {namaDari(terpilih[0])}
            </p>
            <p className="truncate text-xs text-slate-400">
              {row
                ? keterangan(row)
                : `ID ${terpilih[0]} (tidak ada di daftar aktif)`}
            </p>
          </div>
          <button
            type="button"
            disabled={disabled}
            onClick={() => onChange([])}
            className={`${CHIP} shrink-0 border-white/10 text-sky-300 hover:bg-slate-800`}
          >
            Ganti
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <label
        htmlFor={`${id}-cari`}
        className="text-slate-400 block text-xs font-semibold"
      >
        {label}
      </label>
      <input
        id={`${id}-cari`}
        type="search"
        className={INPUT}
        placeholder="Ketik nama, ID, kode, atau divisi"
        value={kata}
        disabled={disabled}
        onChange={(event) => setKata(event.target.value)}
      />

      {tanpaSaringanJenis ? null : (
        <div className="flex flex-wrap gap-1.5">
          {SARINGAN.map((item) => (
            <button
              key={item.value}
              type="button"
              aria-pressed={jenis === item.value}
              disabled={disabled}
              onClick={() => setJenis(item.value)}
              className={`${CHIP} ${
                jenis === item.value
                  ? "border-sky-400 bg-sky-400 text-slate-950"
                  : "border-white/10 text-slate-300 hover:bg-slate-800"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}

      {bolehPilihKelas && banyak && rombel.length > 0 ? (
        <div className="flex gap-2">
          <PilihCari
            aria-label="Pilih kelas"
            className={INPUT}
            value={idRombel}
            disabled={disabled}
            onChange={(event) => setIdRombel(event.target.value)}
          >
            <option value="">Pilih satu kelas...</option>
            {rombel.map((row) => (
              <option key={String(row.id_rombel)} value={String(row.id_rombel)}>
                {String(row.nama_rombel)} ({Number(row.jumlah_siswa ?? 0)}{" "}
                siswa)
              </option>
            ))}
          </PilihCari>
          <button
            type="button"
            disabled={disabled || !idRombel || memuatKelas}
            onClick={() => void tambahSekelas()}
            className={`${CHIP} shrink-0 border-white/10 text-sky-300 hover:bg-slate-800`}
          >
            {memuatKelas ? "Memuat..." : "Pilih sekelas"}
          </button>
        </div>
      ) : null}

      {!adaSaringan ? (
        <p className="text-xs text-slate-400">
          Ketik untuk mencari, atau pilih jenis di atas untuk melihat daftarnya.
        </p>
      ) : hasil.length === 0 ? (
        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
          <span>Tidak ada personil aktif yang cocok.</span>
          {idManual ? (
            <button
              type="button"
              disabled={disabled}
              onClick={() => tambah([idManual])}
              className={`${CHIP} border-white/10 text-sky-300 hover:bg-slate-800`}
            >
              Pakai ID &quot;{idManual}&quot;
            </button>
          ) : null}
        </div>
      ) : (
        <>
          {banyak ? (
            <button
              type="button"
              disabled={disabled}
              onClick={() =>
                tambah(hasil.map((row) => String(row.id_unik ?? "")))
              }
              className={`${CHIP} border-white/10 text-sky-300 hover:bg-slate-800`}
            >
              Pilih semua hasil ({hasil.length})
            </button>
          ) : null}
          <ul
            aria-label={`Hasil pencarian ${label}`}
            className="max-h-64 divide-y divide-slate-800 overflow-y-auto rounded-xl border border-white/10 bg-slate-950"
          >
            {hasil.slice(0, TAMPIL_MAKS).map((row) => {
              const idPersonil = String(row.id_unik ?? "");
              return (
                <li key={idPersonil}>
                  {banyak ? (
                    <label className="flex min-h-11 cursor-pointer items-center gap-3 px-3 py-2 hover:bg-slate-800/60">
                      <input
                        type="checkbox"
                        className="size-4 shrink-0 accent-sky-400"
                        checked={terpilih.includes(idPersonil)}
                        disabled={disabled}
                        onChange={() => alihkan(idPersonil)}
                      />
                      <span className="min-w-0">
                        <span className="block truncate text-sm text-white">
                          {String(row.nama ?? idPersonil)}
                        </span>
                        <span className="block truncate text-xs text-slate-400">
                          {keterangan(row)}
                        </span>
                      </span>
                    </label>
                  ) : (
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => tambah([idPersonil])}
                      className="block min-h-11 w-full px-3 py-2 text-left hover:bg-slate-800/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
                    >
                      <span className="block truncate text-sm text-white">
                        {String(row.nama ?? idPersonil)}
                      </span>
                      <span className="block truncate text-xs text-slate-400">
                        {keterangan(row)}
                      </span>
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
          {hasil.length > TAMPIL_MAKS ? (
            <p className="text-xs text-slate-400">
              {hasil.length - TAMPIL_MAKS} lainnya tidak ditampilkan. Persempit
              pencarian untuk melihatnya.
            </p>
          ) : null}
        </>
      )}

      {catatan ? <p className="text-xs text-amber-300">{catatan}</p> : null}

      {banyak && terpilih.length > 0 ? (
        <div className="space-y-1.5 rounded-xl border border-sky-400/30 bg-slate-950 p-2.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-sky-300">
              {terpilih.length} dipilih (maks. {batas})
            </span>
            <button
              type="button"
              disabled={disabled}
              onClick={() => {
                onChange([]);
                setCatatan(null);
              }}
              className="text-xs font-semibold text-rose-300 hover:text-rose-200 disabled:opacity-50"
            >
              Kosongkan
            </button>
          </div>
          <ul className="flex max-h-40 flex-wrap gap-1.5 overflow-y-auto">
            {terpilih.map((idPersonil) => (
              <li
                key={idPersonil}
                className="flex items-center gap-1 rounded-lg border border-white/10 bg-slate-900 py-0.5 pl-2 pr-0.5 text-xs text-white"
              >
                <span className="max-w-48 truncate">
                  {namaDari(idPersonil)}
                </span>
                <button
                  type="button"
                  aria-label={`Hapus ${namaDari(idPersonil)} dari pilihan`}
                  disabled={disabled}
                  onClick={() => alihkan(idPersonil)}
                  className="grid size-7 place-items-center rounded-md text-slate-400 hover:bg-slate-800 hover:text-white"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
