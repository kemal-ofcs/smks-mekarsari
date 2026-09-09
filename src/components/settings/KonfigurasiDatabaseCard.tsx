"use client";

import type { Dispatch, FormEvent, SetStateAction } from "react";
import { Icon } from "@/components/ui/Icon";
import { StatusBadge } from "@/components/ui/StatusBadge";
import type { TursoConnectionStatus } from "@/lib/gateways/turso-config";
import {
  DATABASE_PROVIDER_OPTIONS,
  type DatabaseProvider,
  type describeProvider,
  providerNeedsEndpoint,
  type reviewDatabaseEndpoint,
} from "@/lib/validations/database-endpoint";

/**
 * Konfigurasi Database pada halaman Pengaturan.
 *
 * Dipisahkan dari halaman Pengaturan demi keterbacaan. Berbeda dengan panel ID
 * Card, seksi ini SELALU dirender bersama seksi lainnya, sehingga pemisahannya
 * TIDAK memperkecil apa pun yang diunduh — yang berubah hanyalah panjang berkas
 * yang harus dibaca orang berikutnya.
 *
 * Nama propsnya sengaja identik dengan nama variabel di halaman induk supaya
 * badan JSX-nya berpindah tanpa satu pun suntingan.
 */
export interface KonfigurasiDatabaseCardProps {
  tursoUrl: string;
  setTursoUrl: Dispatch<SetStateAction<string>>;
  tursoProvider: DatabaseProvider;
  setTursoProvider: Dispatch<SetStateAction<DatabaseProvider>>;
  tursoAllowInsecure: boolean;
  setTursoAllowInsecure: Dispatch<SetStateAction<boolean>>;
  tursoToken: string;
  setTursoToken: Dispatch<SetStateAction<string>>;
  showTursoToken: boolean;
  setShowTursoToken: Dispatch<SetStateAction<boolean>>;
  tursoTestStatus: TursoConnectionStatus | null;
  setTursoTestStatus: Dispatch<SetStateAction<TursoConnectionStatus | null>>;
  tursoBusy: boolean;
  tursoTesting: boolean;
  tursoEndpoint: ReturnType<typeof reviewDatabaseEndpoint>;
  tursoProviderInfo: ReturnType<typeof describeProvider>;
  handleTursoSave: (e: FormEvent) => Promise<void>;
  handleTursoTest: () => Promise<void>;
  handleTursoClear: () => Promise<void>;
}

export function KonfigurasiDatabaseCard({
  tursoUrl,
  setTursoUrl,
  tursoProvider,
  setTursoProvider,
  tursoAllowInsecure,
  setTursoAllowInsecure,
  tursoToken,
  setTursoToken,
  showTursoToken,
  setShowTursoToken,
  tursoTestStatus,
  setTursoTestStatus,
  tursoBusy,
  tursoTesting,
  tursoEndpoint,
  tursoProviderInfo,
  handleTursoSave,
  handleTursoTest,
  handleTursoClear,
}: KonfigurasiDatabaseCardProps) {
  return (
    <section className="app-panel rounded-3xl p-5 sm:p-7">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-4">
          <span className="grid size-11 shrink-0 place-items-center rounded-2xl border border-cyan-400/20 bg-cyan-400/10 text-cyan-200">
            <Icon name="database" className="size-5" />
          </span>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-black text-white">
                Konfigurasi Database (LibSQL)
              </h2>
              <span className="rounded-md bg-cyan-400/10 px-2 py-0.5 text-[10px] font-black uppercase tracking-wider text-cyan-300 border border-cyan-400/20">
                Superadmin Only
              </span>
            </div>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-400">
              Aplikasi Desktop dan Mobile terhubung langsung ke database LibSQL
              lewat HTTP Pipeline — baik Turso Cloud maupun server libSQL milik
              Anda sendiri di kantor, rumah, atau VPS. Kredensial disimpan aman
              di dalam Vault terenkripsi AES-256-GCM pada perangkat ini.
            </p>
          </div>
        </div>
        <StatusBadge
          tone={
            tursoTestStatus?.connected
              ? "success"
              : tursoUrl
                ? "info"
                : "neutral"
          }
        >
          {tursoTestStatus?.connected
            ? `Terhubung (${tursoTestStatus.latency_ms ?? 0} ms)`
            : tursoUrl
              ? tursoProviderInfo.label
              : "Database Lokal"}
        </StatusBadge>
      </div>

      <form onSubmit={handleTursoSave} className="mt-6 space-y-4">
        <fieldset className="space-y-2">
          <legend className="text-xs font-bold text-slate-300">
            Jenis Database
          </legend>
          <div className="grid gap-3 sm:grid-cols-2">
            {DATABASE_PROVIDER_OPTIONS.map((option) => (
              <label
                key={option.value}
                className={`grid min-w-0 cursor-pointer gap-1 rounded-xl border p-3 text-xs leading-4 transition ${
                  tursoProvider === option.value
                    ? "border-cyan-400/60 bg-cyan-400/10 text-cyan-100"
                    : "border-white/10 bg-slate-950/60 text-slate-400 hover:border-white/25"
                }`}
              >
                <span className="flex items-center gap-2 font-black">
                  <input
                    type="radio"
                    name="settings-database-provider"
                    value={option.value}
                    checked={tursoProvider === option.value}
                    onChange={() => {
                      setTursoProvider(option.value);
                      setTursoAllowInsecure(false);
                      setTursoTestStatus(null);
                    }}
                    className="size-4 shrink-0 accent-cyan-400"
                  />
                  <span className="min-w-0 truncate">{option.label}</span>
                </span>
                <span className="font-normal opacity-80">
                  {option.description}
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        {providerNeedsEndpoint(tursoProvider) ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="space-y-1.5 text-xs font-bold text-slate-300 sm:col-span-2">
              {tursoProvider === "turso"
                ? "URL Database Cloud Turso"
                : "Alamat Server Database Anda"}
              <div className="relative">
                <input
                  type="text"
                  inputMode="url"
                  value={tursoUrl}
                  onChange={(e) => {
                    setTursoUrl(e.target.value);
                    setTursoTestStatus(null);
                  }}
                  placeholder={tursoProviderInfo.urlPlaceholder}
                  className="min-h-11 w-full rounded-xl border border-white/10 bg-slate-950 px-3 font-mono text-xs text-white outline-none focus:border-cyan-400"
                />
              </div>
              {tursoUrl.trim().length > 0 && tursoEndpoint.issue ? (
                <span className="block text-[11px] font-normal text-amber-300">
                  {tursoEndpoint.issue.message}
                </span>
              ) : (
                <span className="text-[11px] font-normal text-slate-500">
                  {tursoProvider === "turso" ? (
                    <>
                      Contoh format:{" "}
                      <code className="text-slate-400">
                        libsql://nama-db-org.turso.io
                      </code>{" "}
                      atau{" "}
                      <code className="text-slate-400">
                        https://nama-db-org.turso.io
                      </code>
                    </>
                  ) : (
                    <>
                      Contoh format:{" "}
                      <code className="text-slate-400">
                        http://192.168.1.10:8080
                      </code>{" "}
                      (LAN) atau{" "}
                      <code className="text-slate-400">
                        https://db.kantor-anda.com
                      </code>{" "}
                      (VPS ber-TLS)
                    </>
                  )}
                </span>
              )}
            </label>

            <label className="space-y-1.5 text-xs font-bold text-slate-300 sm:col-span-2">
              {tursoEndpoint.tokenRequired
                ? "Auth Token Database (Bearer Token)"
                : "Auth Token Database (opsional untuk server tanpa autentikasi)"}
              <div className="relative">
                <input
                  type={showTursoToken ? "text" : "password"}
                  value={tursoToken}
                  onChange={(e) => setTursoToken(e.target.value)}
                  placeholder={
                    tursoUrl
                      ? "•••••••••••••••• (Tersimpan aman di vault - kosongkan jika tidak ingin diubah)"
                      : "eyJhbGciOiJFZERTQ..."
                  }
                  className="min-h-11 w-full rounded-xl border border-white/10 bg-slate-950 px-3 pr-24 font-mono text-xs text-white outline-none focus:border-cyan-400"
                />
                <button
                  type="button"
                  onClick={() => setShowTursoToken((prev) => !prev)}
                  className="absolute right-2 top-2 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] font-bold text-slate-300 hover:text-white"
                >
                  {showTursoToken ? "Sembunyikan" : "Tampilkan"}
                </button>
              </div>
              <span className="text-[11px] font-normal text-slate-500">
                {tursoUrl ? (
                  <span className="text-cyan-400">
                    Token otentikasi tersimpan aman di vault lokal. Biarkan
                    kosong jika tidak ingin mengganti token.
                  </span>
                ) : (
                  <>
                    Token otentikasi Turso dari command CLI{" "}
                    <code className="text-slate-400">
                      turso db tokens create &lt;db-name&gt;
                    </code>
                  </>
                )}
              </span>
            </label>
          </div>
        ) : (
          <div className="rounded-2xl border border-cyan-400/30 bg-cyan-400/5 p-4 text-[11px] font-bold leading-4 text-cyan-100">
            Seluruh data disimpan pada berkas SQLite di perangkat ini. Tidak ada
            alamat server maupun Auth Token yang perlu diisi, dan aplikasi tetap
            berjalan penuh tanpa internet. Lokasi berkasnya ditentukan otomatis
            di folder data aplikasi — gunakan menu Cadangan untuk menyalinnya
            keluar.
          </div>
        )}

        {tursoProvider === "self_hosted" &&
        (tursoEndpoint.issue?.code === "INSECURE_PUBLIC" ||
          tursoAllowInsecure) ? (
          <label className="flex items-start gap-2 rounded-2xl border border-rose-500/30 bg-rose-500/10 p-4 text-[11px] font-bold leading-4 text-rose-200">
            <input
              type="checkbox"
              checked={tursoAllowInsecure}
              onChange={(e) => {
                setTursoAllowInsecure(e.target.checked);
                setTursoTestStatus(null);
              }}
              className="mt-0.5 size-4 shrink-0 accent-rose-400"
            />
            <span>
              Izinkan koneksi tanpa enkripsi ke alamat publik. Auth Token dan
              seluruh data absensi akan dikirim sebagai teks biasa dan dapat
              dibaca siapa pun di jalur jaringan. Pakai ini hanya bila Anda
              benar-benar memercayai jaringannya; jalur yang aman adalah
              memasang HTTPS di server atau memakai alamat LAN/VPN.
            </span>
          </label>
        ) : null}

        {tursoTestStatus ? (
          <div
            className={`rounded-2xl border p-4 ${
              tursoTestStatus.connected
                ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-300"
                : "border-rose-500/20 bg-rose-500/10 text-rose-300"
            }`}
          >
            <div className="flex items-center gap-2 font-bold text-xs">
              <Icon
                name={tursoTestStatus.connected ? "check" : "alert"}
                className="size-4"
              />
              <span>
                {tursoTestStatus.connected
                  ? `Koneksi Database Cloud Berhasil (Latensi: ${tursoTestStatus.latency_ms ?? 0} ms)`
                  : `Gagal Terhubung ke Database Cloud: ${tursoTestStatus.error_message || "Periksa URL dan Token"}`}
              </span>
            </div>
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-3 pt-2">
          <button
            type="submit"
            disabled={tursoBusy || tursoTesting}
            className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-cyan-400 px-5 text-xs font-black text-slate-950 shadow-lg shadow-cyan-950/20 transition hover:bg-cyan-300 disabled:opacity-50"
          >
            <Icon name="check" className="size-4" />
            <span>
              {tursoBusy
                ? "Menyimpan ke Vault..."
                : "Simpan Konfigurasi Database"}
            </span>
          </button>

          <button
            type="button"
            onClick={handleTursoTest}
            disabled={tursoBusy || tursoTesting}
            className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-cyan-400/40 bg-cyan-400/10 px-4 text-xs font-bold text-cyan-200 hover:bg-cyan-400/20 disabled:opacity-50"
          >
            <Icon
              name={tursoTesting ? "clock" : "sync"}
              className={`size-4 ${tursoTesting ? "animate-spin" : ""}`}
            />
            <span>
              {tursoTesting ? "Menguji Koneksi..." : "Uji Koneksi Database"}
            </span>
          </button>

          {tursoUrl ? (
            <button
              type="button"
              onClick={handleTursoClear}
              disabled={tursoBusy || tursoTesting}
              className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 text-xs font-bold text-rose-300 hover:bg-rose-500/20 disabled:opacity-50"
            >
              <Icon name="trash" className="size-4" />
              <span>Reset Konfigurasi</span>
            </button>
          ) : null}
        </div>
      </form>
    </section>
  );
}
