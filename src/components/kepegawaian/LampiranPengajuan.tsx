"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { saveFileWithPicker } from "@/lib/client/download";
import { siapkanBerkas } from "@/lib/client/siapkan-berkas";
import {
  bukaLampiran,
  type DaftarLampiran,
  hapusLampiran,
  muatLampiran,
  tambahLampiran,
} from "@/lib/gateways/hr-pengajuan";
import { useConfirmDialog } from "@/lib/hooks/useConfirmDialog";
import { MIME_BERKAS_SEKOLAH } from "@/lib/validations/berkas-sekolah";
import {
  type IsiBerkasDokumen,
  MAKS_BERKAS_DOKUMEN,
  MAKS_BYTE_DOKUMEN,
} from "@/lib/validations/hris";
import { PERINGATAN, pesanGalat, TOMBOL } from "./gaya";

const kb = (byte: number) => Math.ceil(byte / 1024);

/**
 * Lampiran pengajuan (cloud-only, §20.3, Q-51): JPG/PNG/WEBP/PDF maks 1 MB,
 * 5 per pengajuan; hanya saat terhubung. Jenis yang perlu dokumen tetapi belum
 * berlampiran diberi tanda, tidak ditolak.
 */
export function LampiranPengajuan({ idPengajuan }: { idPengajuan: string }) {
  const { konfirmasi, dialogKonfirmasi } = useConfirmDialog();
  const [data, setData] = useState<DaftarLampiran | null>(null);
  const [galatMuat, setGalatMuat] = useState<string | null>(null);
  const [dibuka, setDibuka] = useState<IsiBerkasDokumen | null>(null);
  const [kabar, setKabar] = useState<string | null>(null);
  const [galat, setGalat] = useState<string | null>(null);
  const [proses, setProses] = useState<string | null>(null);
  const isSubmittingRef = useRef(false);

  const muat = useCallback(async () => {
    try {
      setData(await muatLampiran(idPengajuan));
      setGalatMuat(null);
    } catch (error) {
      setGalatMuat(pesanGalat(error));
    }
  }, [idPengajuan]);

  useEffect(() => {
    void muat();
  }, [muat]);

  const jalankan = async (
    kunci: string,
    aksi: () => Promise<string | null>,
  ) => {
    if (isSubmittingRef.current) return;
    isSubmittingRef.current = true;
    setProses(kunci);
    setKabar(null);
    setGalat(null);
    try {
      const pesan = await aksi();
      if (pesan) setKabar(pesan);
    } catch (error) {
      setGalat(pesanGalat(error));
    } finally {
      isSubmittingRef.current = false;
      setProses(null);
    }
  };

  const unggah = (masukan: HTMLInputElement) => {
    const file = masukan.files?.[0];
    // Dikosongkan supaya memilih berkas yang sama lagi tetap memicu onChange.
    masukan.value = "";
    if (!file) return;
    void jalankan("unggah", async () => {
      const siap = await siapkanBerkas(file, MAKS_BYTE_DOKUMEN);
      if (!siap.ok) throw new Error(siap.pesan);
      await tambahLampiran({
        id_pengajuan: idPengajuan,
        nama_berkas: siap.berkas.namaFile,
        mime_type: siap.berkas.mime,
        data_base64: siap.berkas.kontenBase64,
      });
      await muat();
      return `${siap.berkas.namaFile} tersimpan (${kb(siap.berkas.ukuranByte)} KB).`;
    });
  };

  const buang = async (idBerkas: string, nama: string) => {
    const setuju = await konfirmasi({
      title: "Hapus lampiran?",
      description: `${nama} dihapus dari pengajuan ini.`,
      confirmLabel: "Hapus",
      tone: "danger",
    });
    if (!setuju) return;
    await jalankan(`hapus-${idBerkas}`, async () => {
      await hapusLampiran(idBerkas);
      setDibuka(null);
      await muat();
      return "Lampiran dihapus.";
    });
  };

  const berkas = data?.berkas ?? [];
  const penuh = berkas.length >= MAKS_BERKAS_DOKUMEN;

  return (
    <section aria-labelledby="lampiran-pengajuan" className="space-y-2">
      {dialogKonfirmasi}
      <h3 id="lampiran-pengajuan" className="text-sm font-semibold text-white">
        Lampiran
      </h3>
      {galatMuat ? <p className="text-slate-400">{galatMuat}</p> : null}
      {data && !data.ada ? (
        <p className="text-slate-400">
          Pengajuan ini belum sampai di database pusat. Lampiran bisa ditambah
          sesudah sinkronisasi.
        </p>
      ) : null}
      {data?.tanda.includes("tanpa_dokumen") ? (
        <p className={PERINGATAN}>
          Jenis ini perlu dokumen pendukung, tetapi belum ada lampiran.
        </p>
      ) : null}
      {kabar ? <p className="text-emerald-300">{kabar}</p> : null}
      {galat ? (
        <p className="text-rose-300" role="alert">
          {galat}
        </p>
      ) : null}
      {data?.ada ? (
        <ul className="space-y-1">
          {berkas.map((b) => (
            <li
              key={b.id_berkas}
              className="flex flex-wrap items-center justify-between gap-2"
            >
              <span className="min-w-0 break-all text-slate-300">
                {b.nama_berkas} · {kb(b.ukuran_byte)} KB
              </span>
              <span className="flex gap-2">
                <button
                  type="button"
                  className={TOMBOL}
                  disabled={proses !== null}
                  onClick={() =>
                    void jalankan(`buka-${b.id_berkas}`, async () => {
                      setDibuka(await bukaLampiran(b.id_berkas));
                      return null;
                    })
                  }
                >
                  Buka
                </button>
                {data.boleh_ubah ? (
                  <button
                    type="button"
                    className={TOMBOL}
                    disabled={proses !== null}
                    onClick={() => void buang(b.id_berkas, b.nama_berkas)}
                  >
                    Hapus
                  </button>
                ) : null}
              </span>
            </li>
          ))}
          {berkas.length === 0 ? (
            <li className="text-slate-400">Belum ada lampiran.</li>
          ) : null}
        </ul>
      ) : null}
      {data?.ada && data.boleh_ubah && !penuh ? (
        <label
          className={`${TOMBOL} relative inline-flex cursor-pointer items-center focus-within:ring-2 focus-within:ring-sky-500 ${proses !== null ? "pointer-events-none opacity-60" : ""}`}
        >
          {proses === "unggah" ? "Mengunggah..." : "Tambah lampiran"}
          <input
            type="file"
            accept={MIME_BERKAS_SEKOLAH.join(",")}
            className="sr-only"
            disabled={proses !== null}
            onChange={(e) => unggah(e.currentTarget)}
          />
        </label>
      ) : null}
      {dibuka ? (
        <div className="space-y-2 rounded-xl border border-white/10 p-2">
          <p className="break-all text-xs text-slate-300">
            {dibuka.nama_berkas}
          </p>
          {dibuka.mime_type === "application/pdf" ? (
            <p className="text-xs text-slate-400">
              Pratinjau PDF tidak tersedia di sini. Simpan ke perangkat untuk
              membukanya.
            </p>
          ) : (
            // biome-ignore lint/performance/noImgElement: sumbernya data URI dari cloud, bukan aset statis yang bisa dioptimalkan
            <img
              alt={`Lampiran ${dibuka.nama_berkas}`}
              className="max-h-[50vh] w-full rounded-lg object-contain"
              src={`data:${dibuka.mime_type};base64,${dibuka.data_base64}`}
            />
          )}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={TOMBOL}
              disabled={proses !== null}
              onClick={() =>
                void jalankan(`unduh-${dibuka.id_berkas}`, async () => {
                  await saveFileWithPicker(
                    `data:${dibuka.mime_type};base64,${dibuka.data_base64}`,
                    dibuka.nama_berkas,
                  );
                  return null;
                })
              }
            >
              Simpan ke perangkat
            </button>
            <button
              type="button"
              className={TOMBOL}
              onClick={() => setDibuka(null)}
            >
              Tutup pratinjau
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
