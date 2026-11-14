"use client";

import { type FormEvent, useEffect, useRef, useState } from "react";
import { muatSetupSurat, simpanPengaturanSurat } from "@/lib/gateways/hris";
import {
  JENIS_SK,
  JENIS_SURAT,
  KUNCI_SURAT_KOTA,
  KUNCI_YAYASAN_JABATAN,
  KUNCI_YAYASAN_KETUA,
  KUNCI_YAYASAN_NAMA,
  kunciPengaturanSurat,
} from "@/lib/validations/hr-beban";
import bawaan from "@/lib/validations/hr-surat-bawaan.json";
import { INPUT, LABEL, pesanGalat, TOMBOL, TOMBOL_UTAMA } from "./gaya";
import { KODE_SURAT, NAMA_SURAT, POLA_BAWAAN } from "./suratKepegawaian";

const isi = (dari: Record<string, string>) =>
  Object.fromEntries(kunciPengaturanSurat().map((k) => [k, dari[k] ?? ""]));

/**
 * Bagian "Pengaturan surat" tab Organisasi (§21.3): kota, yayasan, pola nomor
 * per jenis, Menimbang/Mengingat per SK. Dibaca lewat bahan cetak
 * (`hr.duty.manage`), disimpan dengan `hr.org.manage`; kosong = bawaan.
 */
export function PengaturanSurat({
  bolehUbah,
  onPesan,
  onGalat,
}: {
  bolehUbah: boolean;
  onPesan: (pesan: string) => void;
  onGalat: (pesan: string) => void;
}) {
  const [nilai, setNilai] = useState<Record<string, string> | null>(null);
  const isSubmittingRef = useRef(false);
  const [menyimpan, setMenyimpan] = useState(false);

  useEffect(() => {
    let berlaku = true;
    muatSetupSurat("")
      .then((s) => {
        if (berlaku) setNilai(isi(s.pengaturan));
      })
      .catch((error: unknown) => {
        if (berlaku) onGalat(pesanGalat(error));
      });
    return () => {
      berlaku = false;
    };
  }, [onGalat]);

  if (!nilai) return null;

  const ubah = (kunci: string, teks: string) =>
    setNilai((lama) => (lama ? { ...lama, [kunci]: teks } : lama));

  const simpan = async (event: FormEvent) => {
    event.preventDefault();
    if (isSubmittingRef.current) return;
    isSubmittingRef.current = true;
    setMenyimpan(true);
    try {
      setNilai(isi(await simpanPengaturanSurat(nilai)));
      onPesan("Pengaturan surat disimpan.");
    } catch (error) {
      onGalat(pesanGalat(error));
    } finally {
      isSubmittingRef.current = false;
      setMenyimpan(false);
    }
  };

  const teks = (kunci: string, label: string, maks: number, contoh = "") => (
    <div key={kunci}>
      <label htmlFor={`surat-${kunci}`} className={LABEL}>
        {label}
      </label>
      <input
        id={`surat-${kunci}`}
        value={nilai[kunci]}
        maxLength={maks}
        placeholder={contoh}
        disabled={!bolehUbah}
        onChange={(e) => ubah(kunci, e.target.value)}
        className={INPUT}
      />
    </div>
  );

  return (
    <section aria-labelledby="judul-pengaturan-surat" className="space-y-3">
      <h2
        id="judul-pengaturan-surat"
        className="text-base font-semibold text-white"
      >
        Pengaturan surat
      </h2>
      <p className="text-sm text-slate-400">
        Dipakai saat mencetak SK dan surat dari tab Surat. Kosongkan untuk
        memakai bawaan. Nomor urut diketik dari buku agenda surat keluar saat
        mencetak; token pola: {"{urut}"} {"{kode}"} {"{unit}"} {"{romawi}"}{" "}
        {"{tahun}"}. Teks Menimbang dan Mengingat bawaan perlu diperiksa ulang
        sekolah atau konsultan.
      </p>
      <form onSubmit={simpan} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          {teks(KUNCI_SURAT_KOTA, "Tempat penetapan (kota)", 60)}
          {teks(KUNCI_YAYASAN_NAMA, "Nama yayasan", 120)}
          {teks(KUNCI_YAYASAN_KETUA, "Nama ketua yayasan", 120)}
          {teks(
            KUNCI_YAYASAN_JABATAN,
            "Jabatan ketua yayasan",
            120,
            "Ketua Yayasan",
          )}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {JENIS_SURAT.map((j) =>
            teks(
              `hr_surat_pola:${j}`,
              `Pola nomor ${NAMA_SURAT[j]} ({kode} = ${KODE_SURAT[j]})`,
              80,
              POLA_BAWAAN,
            ),
          )}
        </div>
        {JENIS_SK.map((j) => {
          const kunci = `hr_surat_dasar:${j}`;
          return (
            <div key={j}>
              <label htmlFor={`surat-${kunci}`} className={LABEL}>
                Menimbang dan Mengingat {NAMA_SURAT[j]}
              </label>
              <textarea
                id={`surat-${kunci}`}
                rows={6}
                value={nilai[kunci]}
                maxLength={4000}
                placeholder={bawaan[j]}
                disabled={!bolehUbah}
                aria-describedby="surat-dasar-catatan"
                onChange={(e) => ubah(kunci, e.target.value)}
                className={`${INPUT} py-2`}
              />
              {bolehUbah && nilai[kunci] === "" ? (
                <button
                  type="button"
                  className={`${TOMBOL} mt-2`}
                  onClick={() => ubah(kunci, bawaan[j])}
                >
                  Sunting dari teks bawaan
                </button>
              ) : null}
            </div>
          );
        })}
        <p id="surat-dasar-catatan" className="text-xs text-slate-400">
          Satu butir per baris; Menimbang di atas, lalu baris berisi tiga tanda
          hubung (---), lalu Mengingat. Huruf dan nomor butir ditambahkan saat
          dicetak.
        </p>
        {bolehUbah ? (
          <button type="submit" className={TOMBOL_UTAMA} disabled={menyimpan}>
            {menyimpan ? "Menyimpan…" : "Simpan pengaturan surat"}
          </button>
        ) : null}
      </form>
    </section>
  );
}
