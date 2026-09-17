"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { hasPermission } from "@/lib/auth/access";
import type { useAuth } from "@/lib/context/AuthContext";
import {
  DEFAULT_AMBANG_ALFA_DAYS,
  DEFAULT_AMBANG_ALFA_LIMIT,
} from "@/lib/validations/wa-notification";
import type { WaConfig, WaConfigDraft } from "@/types/wa-notification";

export interface NotifikasiWaCardProps {
  user: ReturnType<typeof useAuth>["user"];
  config: WaConfig | null;
  busy: boolean;
  onSave: (draft: WaConfigDraft) => Promise<void>;
}

export function NotifikasiWaCard({
  user,
  config,
  busy,
  onSave,
}: NotifikasiWaCardProps) {
  const [scanMasuk, setScanMasuk] = useState(false);
  const [scanPulang, setScanPulang] = useState(false);
  // MATI, sama dengan yang dibaca mesin untuk kunci `wa_notify_*` yang belum
  // ada. Nilai awal `true` di sini membuat kartu menampilkan dua sakelar hidup
  // sebelum `config` datang — dan pada pemasangan yang belum pernah menyimpan,
  // itulah satu-satunya yang pernah dilihat pengguna.
  const [bolos, setBolos] = useState(false);
  const [ambangAlfa, setAmbangAlfa] = useState(false);
  const [koreksiAdmin, setKoreksiAdmin] = useState(false);
  const [importManual, setImportManual] = useState(false);
  const [ambangLimit, setAmbangLimit] = useState(DEFAULT_AMBANG_ALFA_LIMIT);
  const [ambangDays, setAmbangDays] = useState(DEFAULT_AMBANG_ALFA_DAYS);
  const [isDirty, setIsDirty] = useState(false);

  useEffect(() => {
    if (config) {
      setScanMasuk(config.scanMasukEnabled);
      setScanPulang(config.scanPulangEnabled);
      setBolos(config.bolosEnabled);
      setAmbangAlfa(config.ambangAlfaEnabled);
      setKoreksiAdmin(config.koreksiAdminEnabled);
      setImportManual(config.importManualEnabled);
      setAmbangLimit(config.ambangAlfaLimit ?? DEFAULT_AMBANG_ALFA_LIMIT);
      setAmbangDays(config.ambangAlfaDays ?? DEFAULT_AMBANG_ALFA_DAYS);
      setIsDirty(false);
    }
  }, [config]);

  const handleSave = async () => {
    if (!config) return;
    const draft: WaConfigDraft = {
      provider: config.provider,
      apiKey: "", // Pertahankan api key lama di server
      apiUrl: config.apiUrl,
      senderNumber: config.senderNumber,
      isActive: config.isActive,
      dailyLimit: config.dailyLimit,
      scanMasukEnabled: scanMasuk,
      scanPulangEnabled: scanPulang,
      bolosEnabled: bolos,
      ambangAlfaEnabled: ambangAlfa,
      koreksiAdminEnabled: koreksiAdmin,
      importManualEnabled: importManual,
      ambangAlfaLimit: ambangLimit,
      ambangAlfaDays: ambangDays,
    };
    await onSave(draft);
    setIsDirty(false);
  };

  const canManage = hasPermission(user, "settings.manage");

  return (
    <section
      className="app-panel rounded-3xl p-5 sm:p-7"
      id="panel-notifikasi-wa-settings"
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-4">
          <span className="grid size-11 shrink-0 place-items-center rounded-2xl border border-emerald-300/20 bg-emerald-300/10 text-emerald-200">
            <Icon name="whatsapp" className="size-5" />
          </span>
          <div>
            <h2 className="text-base font-black text-white">
              Notifikasi WhatsApp & Peringatan Kehadiran
            </h2>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-400">
              Kelola pengantrean otomatis notifikasi WhatsApp ke wali murid
              untuk scan gerbang, deteksi bolos KBM, dan peringatan akumulasi
              Alfa kritis. Pengaturan ini dicerminkan ke seluruh terminal
              pemindai.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2.5">
          <StatusBadge tone={config?.isActive ? "success" : "neutral"}>
            {config?.isActive ? "Gateway Aktif" : "Manual (wa.me)"}
          </StatusBadge>
          <Link
            href="/notifikasi-wa"
            className="inline-flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-slate-200 transition hover:bg-white/10"
            title="Buka Halaman Antrean Notifikasi WA"
          >
            <Icon name="document" className="size-3.5" />
            Tinjau Antrean
          </Link>
        </div>
      </div>

      <div className="mt-6 space-y-3">
        {/* Sakelar 1: Scan Masuk */}
        <div className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-slate-950/60 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <span className="text-sm font-bold text-white">
              Notifikasi Scan Masuk Sekolah
            </span>
            <p className="text-xs text-slate-400">
              Kirim pesan konfirmasi kehadiran ke wali saat siswa berhasil scan
              kartu masuk di gerbang.
            </p>
          </div>
          {canManage ? (
            <label className="relative inline-flex cursor-pointer items-center">
              <input
                type="checkbox"
                checked={scanMasuk}
                disabled={busy}
                onChange={(e) => {
                  setScanMasuk(e.target.checked);
                  setIsDirty(true);
                }}
                className="sr-only peer"
                id="toggle-wa-scan-masuk"
              />
              <div className="h-6 w-11 rounded-full bg-slate-800 peer peer-checked:bg-emerald-500 peer-focus:outline-none after:absolute after:top-0.5 after:left-[2px] after:h-5 after:w-5 after:rounded-full after:border after:border-slate-300 after:bg-white after:transition-all after:content-[''] peer-checked:after:translate-x-full peer-checked:after:border-white disabled:opacity-50" />
            </label>
          ) : (
            <span className="text-xs font-semibold text-slate-400">
              {scanMasuk ? "Aktif" : "Nonaktif"}
            </span>
          )}
        </div>

        {/* Sakelar 2: Scan Pulang */}
        <div className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-slate-950/60 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <span className="text-sm font-bold text-white">
              Notifikasi Scan Pulang Sekolah
            </span>
            <p className="text-xs text-slate-400">
              Kirim pesan informasi jam kepulangan ke wali saat siswa melakukan
              scan keluar sekolah.
            </p>
          </div>
          {canManage ? (
            <label className="relative inline-flex cursor-pointer items-center">
              <input
                type="checkbox"
                checked={scanPulang}
                disabled={busy}
                onChange={(e) => {
                  setScanPulang(e.target.checked);
                  setIsDirty(true);
                }}
                className="sr-only peer"
                id="toggle-wa-scan-pulang"
              />
              <div className="h-6 w-11 rounded-full bg-slate-800 peer peer-checked:bg-emerald-500 peer-focus:outline-none after:absolute after:top-0.5 after:left-[2px] after:h-5 after:w-5 after:rounded-full after:border after:border-slate-300 after:bg-white after:transition-all after:content-[''] peer-checked:after:translate-x-full peer-checked:after:border-white disabled:opacity-50" />
            </label>
          ) : (
            <span className="text-xs font-semibold text-slate-400">
              {scanPulang ? "Aktif" : "Nonaktif"}
            </span>
          )}
        </div>

        {/* Sakelar 3: Bolos Mapel KBM */}
        <div className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-slate-950/60 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <span className="text-sm font-bold text-white">
              Notifikasi Anomali Bolos Mapel KBM
            </span>
            <p className="text-xs text-slate-400">
              Otomatis antrekan pesan jika siswa tercatat masuk gerbang sekolah
              tetapi ditandai Alfa oleh guru di kelas.
            </p>
          </div>
          {canManage ? (
            <label className="relative inline-flex cursor-pointer items-center">
              <input
                type="checkbox"
                checked={bolos}
                disabled={busy}
                onChange={(e) => {
                  setBolos(e.target.checked);
                  setIsDirty(true);
                }}
                className="sr-only peer"
                id="toggle-wa-bolos"
              />
              <div className="h-6 w-11 rounded-full bg-slate-800 peer peer-checked:bg-emerald-500 peer-focus:outline-none after:absolute after:top-0.5 after:left-[2px] after:h-5 after:w-5 after:rounded-full after:border after:border-slate-300 after:bg-white after:transition-all after:content-[''] peer-checked:after:translate-x-full peer-checked:after:border-white disabled:opacity-50" />
            </label>
          ) : (
            <span className="text-xs font-semibold text-slate-400">
              {bolos ? "Aktif" : "Nonaktif"}
            </span>
          )}
        </div>

        {/* Sakelar 4: Ambang Alfa Kritis */}
        <div className="rounded-2xl border border-white/10 bg-slate-950/60 p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <span className="text-sm font-bold text-white">
                Notifikasi Ambang Batas Alfa Kritis
              </span>
              <p className="text-xs text-slate-400">
                Kirim peringatan ke wali saat akumulasi Alfa siswa mencapai
                batas toleransi dalam periode berjalan.
              </p>
            </div>
            {canManage ? (
              <label className="relative inline-flex cursor-pointer items-center">
                <input
                  type="checkbox"
                  checked={ambangAlfa}
                  disabled={busy}
                  onChange={(e) => {
                    setAmbangAlfa(e.target.checked);
                    setIsDirty(true);
                  }}
                  className="sr-only peer"
                  id="toggle-wa-ambang-alfa"
                />
                <div className="h-6 w-11 rounded-full bg-slate-800 peer peer-checked:bg-emerald-500 peer-focus:outline-none after:absolute after:top-0.5 after:left-[2px] after:h-5 after:w-5 after:rounded-full after:border after:border-slate-300 after:bg-white after:transition-all after:content-[''] peer-checked:after:translate-x-full peer-checked:after:border-white disabled:opacity-50" />
              </label>
            ) : (
              <span className="text-xs font-semibold text-slate-400">
                {ambangAlfa ? "Aktif" : "Nonaktif"}
              </span>
            )}
          </div>

          {ambangAlfa && canManage ? (
            <div className="mt-4 grid grid-cols-1 gap-3 border-t border-white/5 pt-4 sm:grid-cols-2">
              <div>
                <label
                  htmlFor="input-ambang-limit"
                  className="block text-xs font-semibold text-slate-300"
                >
                  Ambang Jumlah Alfa (Kali)
                </label>
                <div className="mt-1 flex items-center gap-2">
                  <input
                    id="input-ambang-limit"
                    type="number"
                    min={1}
                    max={30}
                    value={ambangLimit}
                    disabled={busy}
                    onChange={(e) => {
                      setAmbangLimit(Math.max(1, Number(e.target.value || 1)));
                      setIsDirty(true);
                    }}
                    className="w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none"
                  />
                  <span className="text-xs text-slate-400">kali</span>
                </div>
              </div>

              <div>
                <label
                  htmlFor="input-ambang-days"
                  className="block text-xs font-semibold text-slate-300"
                >
                  Rentang Evaluasi (Hari Terakhir)
                </label>
                <div className="mt-1 flex items-center gap-2">
                  <input
                    id="input-ambang-days"
                    type="number"
                    min={7}
                    max={365}
                    value={ambangDays}
                    disabled={busy}
                    onChange={(e) => {
                      setAmbangDays(Math.max(1, Number(e.target.value || 1)));
                      setIsDirty(true);
                    }}
                    className="w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none"
                  />
                  <span className="text-xs text-slate-400">hari</span>
                </div>
              </div>
            </div>
          ) : null}
        </div>

        {/* Sakelar 5: Notifikasi Koreksi Admin */}
        <div className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-slate-950/60 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <span className="text-sm font-bold text-white">
              Notifikasi Koreksi Admin
            </span>
            <p className="text-xs text-slate-400">
              Beri tahu wali saat catatan kehadiran seorang siswa dikoreksi
              admin. Hanya siswa — koreksi untuk guru dan pegawai tidak pernah
              memberi notifikasi.
            </p>
          </div>
          {canManage ? (
            <label className="relative inline-flex cursor-pointer items-center">
              <input
                type="checkbox"
                checked={koreksiAdmin}
                disabled={busy}
                onChange={(e) => {
                  setKoreksiAdmin(e.target.checked);
                  setIsDirty(true);
                }}
                className="sr-only peer"
                id="toggle-wa-koreksi-admin"
              />
              <div className="h-6 w-11 rounded-full bg-slate-800 peer peer-checked:bg-emerald-500 peer-focus:outline-none after:absolute after:top-0.5 after:left-[2px] after:h-5 after:w-5 after:rounded-full after:border after:border-slate-300 after:bg-white after:transition-all after:content-[''] peer-checked:after:translate-x-full peer-checked:after:border-white disabled:opacity-50" />
            </label>
          ) : (
            <span className="text-xs font-semibold text-slate-400">
              {koreksiAdmin ? "Aktif" : "Nonaktif"}
            </span>
          )}
        </div>

        {/* Sakelar 6: Notifikasi Import Manual */}
        <div className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-slate-950/60 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <span className="text-sm font-bold text-white">
              Notifikasi Import Manual
            </span>
            <p className="text-xs text-slate-400">
              Beri tahu wali saat kehadiran seorang siswa dimasukkan manual.
              Dibatasi 25 siswa per satu aksi import agar backfill massal tidak
              membanjiri wali; importnya sendiri tetap berjalan penuh.
            </p>
          </div>
          {canManage ? (
            <label className="relative inline-flex cursor-pointer items-center">
              <input
                type="checkbox"
                checked={importManual}
                disabled={busy}
                onChange={(e) => {
                  setImportManual(e.target.checked);
                  setIsDirty(true);
                }}
                className="sr-only peer"
                id="toggle-wa-import-manual"
              />
              <div className="h-6 w-11 rounded-full bg-slate-800 peer peer-checked:bg-emerald-500 peer-focus:outline-none after:absolute after:top-0.5 after:left-[2px] after:h-5 after:w-5 after:rounded-full after:border after:border-slate-300 after:bg-white after:transition-all after:content-[''] peer-checked:after:translate-x-full peer-checked:after:border-white disabled:opacity-50" />
            </label>
          ) : (
            <span className="text-xs font-semibold text-slate-400">
              {importManual ? "Aktif" : "Nonaktif"}
            </span>
          )}
        </div>
      </div>

      {canManage && isDirty ? (
        <div className="mt-5 flex items-center justify-end gap-3 border-t border-white/10 pt-4">
          <button
            type="button"
            disabled={busy}
            onClick={handleSave}
            className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-5 py-2.5 text-xs font-bold text-white shadow-lg shadow-emerald-600/20 transition hover:bg-emerald-500 disabled:opacity-50"
            id="btn-save-wa-notification-settings"
          >
            <Icon name="check" className="size-4" />
            {busy ? "Menyimpan..." : "Simpan Pengaturan Notifikasi"}
          </button>
        </div>
      ) : null}
    </section>
  );
}
