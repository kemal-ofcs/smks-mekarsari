"use client";

import type { Dispatch, FormEvent, SetStateAction } from "react";
import { Icon } from "@/components/ui/Icon";
import { StatusBadge } from "@/components/ui/StatusBadge";

/**
 * Keamanan Absensi pada halaman Pengaturan.
 *
 * Dipisahkan dari halaman Pengaturan demi keterbacaan. Berbeda dengan panel ID
 * Card, seksi ini SELALU dirender bersama seksi lainnya, sehingga pemisahannya
 * TIDAK memperkecil apa pun yang diunduh — yang berubah hanyalah panjang berkas
 * yang harus dibaca orang berikutnya.
 *
 * Nama propsnya sengaja identik dengan nama variabel di halaman induk supaya
 * badan JSX-nya berpindah tanpa satu pun suntingan.
 */
export interface KeamananAbsensiCardProps {
  scanPhotoEnabled: boolean;
  setScanPhotoEnabled: Dispatch<SetStateAction<boolean>>;
  scanIpEnabled: boolean;
  setScanIpEnabled: Dispatch<SetStateAction<boolean>>;
  ipAllowlist: string[];
  ipAllowlistDraft: string;
  setIpAllowlistDraft: Dispatch<SetStateAction<string>>;
  ipDeviceAddresses: string[];
  ipAllowlistBusy: boolean;
  handleScanSecuritySubmit: (
    event: FormEvent<HTMLFormElement>,
  ) => Promise<void>;
}

export function KeamananAbsensiCard({
  scanPhotoEnabled,
  setScanPhotoEnabled,
  scanIpEnabled,
  setScanIpEnabled,
  ipAllowlist,
  ipAllowlistDraft,
  setIpAllowlistDraft,
  ipDeviceAddresses,
  ipAllowlistBusy,
  handleScanSecuritySubmit,
}: KeamananAbsensiCardProps) {
  return (
    <section className="app-panel rounded-3xl p-5 sm:p-7">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-4">
          <span className="grid size-11 shrink-0 place-items-center rounded-2xl border border-sky-300/20 bg-sky-300/10 text-sky-200">
            <Icon name="scanner" className="size-5" />
          </span>
          <div>
            <h2 className="text-base font-black text-white">
              Keamanan absensi
            </h2>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-400">
              Dua fitur opsional: memaksa setiap scan menyertakan foto wajah,
              dan membatasi absensi ke jaringan tertentu. Matikan keduanya bila
              perusahaan tidak memerlukannya — selama mati, sakelar per role di
              halaman Master Operator tidak berpengaruh apa pun.
            </p>
          </div>
        </div>
      </div>

      <form onSubmit={handleScanSecuritySubmit} className="mt-6 space-y-4">
        <label className="flex items-start gap-3 rounded-2xl border border-white/10 bg-slate-950/50 p-4">
          <input
            type="checkbox"
            checked={scanPhotoEnabled}
            onChange={(event) => setScanPhotoEnabled(event.target.checked)}
            className="mt-0.5 size-4 shrink-0"
          />
          <span className="text-xs leading-5 text-slate-300">
            <strong className="text-white">Aktifkan foto bukti absensi</strong>
            <br />
            Terminal menahan scan sesaat setelah QR terbaca, membuka kamera
            hadap-depan, lalu memotret wajah dan latar orang yang absen sebelum
            data dikirim. Role mana yang diwajibkan diatur di halaman Master
            Operator.
          </span>
        </label>

        <label className="flex items-start gap-3 rounded-2xl border border-white/10 bg-slate-950/50 p-4">
          <input
            type="checkbox"
            checked={scanIpEnabled}
            onChange={(event) => setScanIpEnabled(event.target.checked)}
            className="mt-0.5 size-4 shrink-0"
          />
          <span className="text-xs leading-5 text-slate-300">
            <strong className="text-white">
              Aktifkan pembatasan alamat IP
            </strong>
            <br />
            Absensi hanya diterima dari alamat yang terdaftar di bawah. Role
            mana yang dibatasi diatur di halaman Master Operator.
          </span>
        </label>

        {scanIpEnabled ? (
          <div className="space-y-3 rounded-2xl border border-white/10 bg-slate-950/40 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-black text-white">
                Alamat IP yang diizinkan
              </p>
              <StatusBadge tone={ipAllowlist.length > 0 ? "info" : "warning"}>
                {ipAllowlist.length > 0
                  ? `${ipAllowlist.length} entri aktif`
                  : "Kosong — belum membatasi"}
              </StatusBadge>
            </div>
            <textarea
              aria-label="Daftar alamat IP yang diizinkan"
              value={ipAllowlistDraft}
              onChange={(event) => setIpAllowlistDraft(event.target.value)}
              rows={5}
              spellCheck={false}
              placeholder={"192.168.1.0/24\n10.10.0.7"}
              className="w-full rounded-xl border border-white/10 bg-slate-950 p-3 font-mono text-sm text-white outline-none focus:border-sky-400"
            />
            <p className="text-[11px] leading-5 text-slate-500">
              Satu baris satu alamat, boleh berupa blok CIDR seperti
              <span className="font-mono"> 192.168.1.0/24</span>. Selama daftar
              ini kosong, pembatasan belum berlaku dan role tersebut masih bisa
              absen dari jaringan mana pun.
            </p>

            {ipDeviceAddresses.length > 0 ? (
              <div className="rounded-2xl border border-white/10 bg-slate-950/60 p-3">
                <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                  Alamat perangkat ini
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {ipDeviceAddresses.map((address) => (
                    <button
                      key={address}
                      type="button"
                      onClick={() =>
                        setIpAllowlistDraft((current) =>
                          current
                            .split(/[\n,;]/)
                            .map((item) => item.trim())
                            .filter(Boolean)
                            .includes(address)
                            ? current
                            : `${current.trim()}${current.trim() ? "\n" : ""}${address}`,
                        )
                      }
                      className="min-h-9 rounded-xl border border-sky-400/30 bg-sky-400/10 px-3 font-mono text-xs font-bold text-sky-200"
                    >
                      + {address}
                    </button>
                  ))}
                </div>
                <p className="mt-2 text-[11px] leading-5 text-slate-500">
                  Ini alamat yang benar-benar terlihat oleh aplikasi saat ini.
                  Menebak alamat sendiri adalah cara tercepat mengunci seluruh
                  terminal di luar.
                </p>
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={ipAllowlistBusy}
            className="min-h-11 rounded-xl bg-sky-400 px-5 text-sm font-black text-slate-950 disabled:opacity-60"
          >
            {ipAllowlistBusy ? "Menyimpan..." : "Simpan keamanan absensi"}
          </button>
          <p className="text-xs text-slate-400">
            {scanPhotoEnabled || scanIpEnabled
              ? "Berlaku untuk role yang menyalakannya di Master Operator."
              : "Kedua fitur mati — absensi berjalan seperti biasa."}
          </p>
        </div>
      </form>
    </section>
  );
}
