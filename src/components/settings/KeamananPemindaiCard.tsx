"use client";

import type { Dispatch, FormEvent, SetStateAction } from "react";
import { Icon } from "@/components/ui/Icon";
import { StatusBadge } from "@/components/ui/StatusBadge";
import type { ScannerSafetySettings } from "@/lib/gateways/scanner-settings";

/**
 * Keamanan Pemindai pada halaman Pengaturan.
 *
 * Dipisahkan dari halaman Pengaturan demi keterbacaan. Berbeda dengan panel ID
 * Card, seksi ini SELALU dirender bersama seksi lainnya, sehingga pemisahannya
 * TIDAK memperkecil apa pun yang diunduh — yang berubah hanyalah panjang berkas
 * yang harus dibaca orang berikutnya.
 *
 * Nama propsnya sengaja identik dengan nama variabel di halaman induk supaya
 * badan JSX-nya berpindah tanpa satu pun suntingan.
 */
export interface KeamananPemindaiCardProps {
  scannerSafety: ScannerSafetySettings;
  setScannerSafety: Dispatch<SetStateAction<ScannerSafetySettings>>;
  scannerSafetyBusy: boolean;
  handleScannerSafetySubmit: (
    event: FormEvent<HTMLFormElement>,
  ) => Promise<void>;
}

export function KeamananPemindaiCard({
  scannerSafety,
  setScannerSafety,
  scannerSafetyBusy,
  handleScannerSafetySubmit,
}: KeamananPemindaiCardProps) {
  return (
    <section className="app-panel rounded-3xl p-5 sm:p-7">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-4">
          <span className="grid size-11 shrink-0 place-items-center rounded-2xl border border-sky-300/20 bg-sky-300/10 text-sky-200">
            <Icon name="tools" className="size-5" />
          </span>
          <div>
            <h2 className="text-base font-black text-white">
              Keamanan Pemindai & Anti Double-Scan
            </h2>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-400">
              Konfigurasikan durasi perlindungan multi-scan dan jeda cooldown
              pemindaian untuk mencegah scan ganda atau salah deteksi shift
              secara otomatis.
            </p>
          </div>
        </div>
        <StatusBadge tone="info">
          {scannerSafety.batasMultiScanMenit > 0
            ? `Multi-Scan: ${scannerSafety.batasMultiScanMenit} mnt`
            : "Multi-Scan nonaktif"}
        </StatusBadge>
      </div>

      <form
        onSubmit={handleScannerSafetySubmit}
        className="mt-6 grid gap-6 sm:grid-cols-2"
      >
        <div className="space-y-2 rounded-2xl border border-white/10 bg-slate-950/60 p-4">
          <label
            htmlFor="batas-multi-scan-input"
            className="block text-xs font-bold text-slate-300"
          >
            Batas Multi-Scan Masuk (Menit)
          </label>
          <p className="text-[11px] leading-5 text-slate-500">
            Scan masuk ulang dalam kurun waktu ini akan ditolak agar tidak
            dianggap sebagai scan pulang atau duplikat (Default: 5 menit).
          </p>
          <div className="flex items-center gap-3 pt-1">
            <input
              id="batas-multi-scan-input"
              type="number"
              min={0}
              max={120}
              step={1}
              value={scannerSafety.batasMultiScanMenit}
              onChange={(event) =>
                setScannerSafety((current) => ({
                  ...current,
                  batasMultiScanMenit: Math.max(0, Number(event.target.value)),
                }))
              }
              className="min-h-11 w-32 rounded-xl border border-white/10 bg-slate-950 px-3 font-mono text-white outline-none focus:border-sky-400"
            />
            <span className="text-xs font-medium text-slate-400">Menit</span>
          </div>
          <div className="flex flex-wrap gap-1.5 pt-1">
            {[1, 3, 5, 10, 15].map((val) => (
              <button
                key={val}
                type="button"
                onClick={() =>
                  setScannerSafety((c) => ({
                    ...c,
                    batasMultiScanMenit: val,
                  }))
                }
                className={`rounded-lg border px-2.5 py-1 font-mono text-xs font-semibold transition ${
                  scannerSafety.batasMultiScanMenit === val
                    ? "border-sky-400 bg-sky-400/20 text-sky-200"
                    : "border-white/10 bg-white/[0.04] text-slate-400 hover:text-white"
                }`}
              >
                {val} mnt
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-2 rounded-2xl border border-white/10 bg-slate-950/60 p-4">
          <label
            htmlFor="cooldown-anti-double-input"
            className="block text-xs font-bold text-slate-300"
          >
            Cooldown Anti Double-Scan (Detik)
          </label>
          <p className="text-[11px] leading-5 text-slate-500">
            Jeda waktu minimal sebelum scanner membaca kembali QR/kartu yang
            sama guna mencegah scan instan berturut-turut (Default: 60 detik).
          </p>
          <div className="flex items-center gap-3 pt-1">
            <input
              id="cooldown-anti-double-input"
              type="number"
              min={0}
              max={600}
              step={5}
              value={scannerSafety.antiDoubleScanSeconds}
              onChange={(event) =>
                setScannerSafety((current) => ({
                  ...current,
                  antiDoubleScanSeconds: Math.max(
                    0,
                    Number(event.target.value),
                  ),
                }))
              }
              className="min-h-11 w-32 rounded-xl border border-white/10 bg-slate-950 px-3 font-mono text-white outline-none focus:border-sky-400"
            />
            <span className="text-xs font-medium text-slate-400">
              Detik (
              {Math.round((scannerSafety.antiDoubleScanSeconds / 60) * 10) / 10}{" "}
              mnt)
            </span>
          </div>
          <div className="flex flex-wrap gap-1.5 pt-1">
            {[10, 30, 60, 120, 300].map((val) => (
              <button
                key={val}
                type="button"
                onClick={() =>
                  setScannerSafety((c) => ({
                    ...c,
                    antiDoubleScanSeconds: val,
                  }))
                }
                className={`rounded-lg border px-2.5 py-1 font-mono text-xs font-semibold transition ${
                  scannerSafety.antiDoubleScanSeconds === val
                    ? "border-sky-400 bg-sky-400/20 text-sky-200"
                    : "border-white/10 bg-white/[0.04] text-slate-400 hover:text-white"
                }`}
              >
                {val >= 60 ? `${val / 60} mnt` : `${val} dtk`}
              </button>
            ))}
          </div>
        </div>

        <div className="sm:col-span-2">
          <button
            type="submit"
            disabled={scannerSafetyBusy}
            className="min-h-11 rounded-xl bg-sky-400 px-5 text-xs font-black text-slate-950 shadow-lg shadow-sky-950/20 transition hover:bg-sky-300 disabled:opacity-50"
          >
            {scannerSafetyBusy ? "Menyimpan..." : "Simpan Pengaturan Scanner"}
          </button>
        </div>
      </form>
    </section>
  );
}
