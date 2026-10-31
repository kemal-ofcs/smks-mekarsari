"use client";

import { useId, useRef, useState } from "react";
import {
  batalBayarPmb,
  konfirmasiBayarPmb,
  perpanjangBatasBayarPmb,
} from "@/lib/gateways/pmb";
import {
  METODE_BAYAR_PMB,
  type MetodeBayarPmb,
  rupiahPmb,
} from "@/lib/validations/pmb-pembayaran";
import type { PmbRegistrantDetail } from "@/types/pmb";

/**
 * Blok pembayaran biaya pendaftaran di detail pendaftar PMB (Web/Desktop dan
 * Mobile, disalin lewat `filesToCopy`). Keadaannya dihitung server; tombol
 * hanya muncul bila aksinya mungkin, dan backend tetap menolak sisanya.
 */

const LABEL_METODE: Record<MetodeBayarPmb, string> = {
  tunai: "Tunai",
  transfer: "Transfer bank",
  qris: "QRIS",
};

const KELAS_ISIAN =
  "mt-1 w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white";

export function PembayaranPmb({
  pendaftar,
  bolehKelola,
  onBerubah,
}: {
  pendaftar: PmbRegistrantDetail["pendaftar"];
  bolehKelola: boolean;
  onBerubah: (kabar: string) => Promise<void> | void;
}) {
  const id = useId();
  const [galat, setGalat] = useState<string | null>(null);
  const [sibuk, setSibuk] = useState(false);
  const isSubmittingRef = useRef(false);

  const keadaan = pendaftar.keadaan_bayar;
  if (keadaan === "Tanpa biaya") return null;

  const belumLunas =
    keadaan === "Menunggu Pembayaran" || keadaan === "Kedaluwarsa";
  const statusTerbuka = !["Ditolak", "Dibatalkan", "Terdaftar"].includes(
    pendaftar.status,
  );

  async function jalankan(aksi: () => Promise<void>, kabar: string) {
    if (isSubmittingRef.current) return;
    isSubmittingRef.current = true;
    setSibuk(true);
    setGalat(null);
    try {
      await aksi();
      await onBerubah(kabar);
    } catch (error) {
      setGalat(error instanceof Error ? error.message : "Aksi gagal disimpan.");
    } finally {
      isSubmittingRef.current = false;
      setSibuk(false);
    }
  }

  function catatBayar(peristiwa: React.FormEvent<HTMLFormElement>) {
    peristiwa.preventDefault();
    const data = new FormData(peristiwa.currentTarget);
    void jalankan(
      () =>
        konfirmasiBayarPmb({
          idPendaftar: pendaftar.id_pendaftar,
          jumlah: pendaftar.biaya_tagihan,
          tanggal: String(data.get("tanggal") ?? ""),
          metode: String(data.get("metode") ?? "") as MetodeBayarPmb,
        }),
      "Pembayaran dicatat.",
    );
  }

  function perpanjang(peristiwa: React.FormEvent<HTMLFormElement>) {
    peristiwa.preventDefault();
    const data = new FormData(peristiwa.currentTarget);
    void jalankan(
      () =>
        perpanjangBatasBayarPmb({
          idPendaftar: pendaftar.id_pendaftar,
          batasBayar: String(data.get("batasBayar") ?? ""),
        }),
      "Batas bayar diperpanjang.",
    );
  }

  function batalkan(peristiwa: React.FormEvent<HTMLFormElement>) {
    peristiwa.preventDefault();
    const data = new FormData(peristiwa.currentTarget);
    void jalankan(
      () =>
        batalBayarPmb({
          idPendaftar: pendaftar.id_pendaftar,
          alasan: String(data.get("alasan") ?? ""),
        }),
      "Pembayaran dibatalkan.",
    );
  }

  return (
    <div className="space-y-3">
      <h3 className="font-semibold text-white text-xs uppercase">
        Biaya pendaftaran
      </h3>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-slate-300">
        <dt className="text-slate-500">Keadaan</dt>
        <dd>{keadaan}</dd>
        <dt className="text-slate-500">Biaya</dt>
        <dd>Rp{rupiahPmb(pendaftar.biaya_tagihan)}</dd>
        {keadaan === "Lunas" ? (
          <>
            <dt className="text-slate-500">Tanggal bayar</dt>
            <dd>{pendaftar.dibayar_tanggal ?? "-"}</dd>
            <dt className="text-slate-500">Metode</dt>
            <dd>
              {LABEL_METODE[pendaftar.dibayar_metode as MetodeBayarPmb] ??
                pendaftar.dibayar_metode ??
                "-"}
            </dd>
            <dt className="text-slate-500">Dicatat oleh</dt>
            <dd>{pendaftar.dibayar_dicatat_oleh ?? "-"}</dd>
          </>
        ) : (
          <>
            <dt className="text-slate-500">Batas bayar</dt>
            <dd>{pendaftar.batas_bayar ?? "-"}</dd>
          </>
        )}
      </dl>
      {pendaftar.pembayaran_batal_catatan ? (
        <p className="text-slate-400 text-xs">
          Pembatalan terakhir: {pendaftar.pembayaran_batal_catatan}
        </p>
      ) : null}

      {galat ? (
        <p className="text-rose-300 text-xs" role="alert">
          {galat}
        </p>
      ) : null}

      {bolehKelola && statusTerbuka && keadaan === "Menunggu Pembayaran" ? (
        <form className="space-y-2" onSubmit={catatBayar}>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label
                className="block text-slate-400 text-xs"
                htmlFor={`${id}-tanggal`}
              >
                Tanggal bayar
              </label>
              <input
                className={KELAS_ISIAN}
                id={`${id}-tanggal`}
                name="tanggal"
                required
                type="date"
              />
            </div>
            <div>
              <label
                className="block text-slate-400 text-xs"
                htmlFor={`${id}-metode`}
              >
                Metode
              </label>
              <select
                className={KELAS_ISIAN}
                defaultValue="tunai"
                id={`${id}-metode`}
                name="metode"
              >
                {METODE_BAYAR_PMB.map((metode) => (
                  <option key={metode} value={metode}>
                    {LABEL_METODE[metode]}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <button
            className="w-full rounded-lg bg-emerald-500 px-3 py-2 font-semibold text-slate-950 text-xs disabled:opacity-60"
            disabled={sibuk}
            type="submit"
          >
            Catat lunas Rp{rupiahPmb(pendaftar.biaya_tagihan)}
          </button>
        </form>
      ) : null}

      {bolehKelola && statusTerbuka && belumLunas ? (
        <form className="space-y-2" onSubmit={perpanjang}>
          <label
            className="block text-slate-400 text-xs"
            htmlFor={`${id}-batas`}
          >
            Batas bayar baru
          </label>
          <div className="flex gap-2">
            <input
              className={KELAS_ISIAN}
              id={`${id}-batas`}
              name="batasBayar"
              required
              type="date"
            />
            <button
              className="mt-1 shrink-0 rounded-lg border border-white/15 px-3 py-2 text-white text-xs disabled:opacity-60"
              disabled={sibuk}
              type="submit"
            >
              Perpanjang
            </button>
          </div>
        </form>
      ) : null}

      {bolehKelola && keadaan === "Lunas" && pendaftar.status === "Baru" ? (
        <form data-tanpa-konfirmasi className="space-y-2" onSubmit={batalkan}>
          <label
            className="block text-slate-400 text-xs"
            htmlFor={`${id}-alasan`}
          >
            Alasan membatalkan pembayaran
          </label>
          <input
            className={KELAS_ISIAN}
            id={`${id}-alasan`}
            maxLength={255}
            minLength={5}
            name="alasan"
            required
            type="text"
          />
          <button
            className="w-full rounded-lg border border-rose-500/40 px-3 py-2 text-rose-300 text-xs disabled:opacity-60"
            disabled={sibuk}
            type="submit"
          >
            Batalkan pembayaran
          </button>
        </form>
      ) : null}
    </div>
  );
}
