"use client";

import type { Dispatch, FormEvent, SetStateAction } from "react";
import { Icon } from "@/components/ui/Icon";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { calculateDistanceMeters } from "@/lib/client/geolocation";
import type { GeofenceSettings } from "@/lib/gateways/geofence";

/**
 * Geofencing pada halaman Pengaturan.
 *
 * Dipisahkan dari halaman Pengaturan demi keterbacaan. Berbeda dengan panel ID
 * Card, seksi ini SELALU dirender bersama seksi lainnya, sehingga pemisahannya
 * TIDAK memperkecil apa pun yang diunduh — yang berubah hanyalah panjang berkas
 * yang harus dibaca orang berikutnya.
 *
 * Nama propsnya sengaja identik dengan nama variabel di halaman induk supaya
 * badan JSX-nya berpindah tanpa satu pun suntingan.
 */
export interface GeofencingCardProps {
  geofence: GeofenceSettings;
  setGeofence: Dispatch<SetStateAction<GeofenceSettings>>;
  geofenceBusy: boolean;
  currentDeviceCoords: { lat: number; lng: number } | null;
  isOnline: boolean;
  useCurrentLocation: () => Promise<void>;
  handleGeofenceSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>;
}

export function GeofencingCard({
  geofence,
  setGeofence,
  geofenceBusy,
  currentDeviceCoords,
  isOnline,
  useCurrentLocation,
  handleGeofenceSubmit,
}: GeofencingCardProps) {
  return (
    <section className="app-panel rounded-3xl p-5 sm:p-7">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-4">
          <span className="grid size-11 shrink-0 place-items-center rounded-2xl border border-emerald-300/20 bg-emerald-300/10 text-emerald-200">
            <Icon name="scanner" className="size-5" />
          </span>
          <div>
            <h2 className="text-base font-black text-white">
              Lokasi kantor & geofencing
            </h2>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-400">
              Saat aktif, setiap scan wajib mengirim GPS dan berada di dalam
              radius kantor. Scan tanpa lokasi atau di luar area akan ditolak
              dan tetap dicatat pada Riwayat.
            </p>
          </div>
        </div>
        <StatusBadge tone={geofence.enabled ? "info" : "neutral"}>
          {geofence.enabled ? "Geofencing aktif" : "Geofencing nonaktif"}
        </StatusBadge>
      </div>

      <form
        onSubmit={handleGeofenceSubmit}
        className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4"
      >
        <label className="space-y-1.5 text-xs font-bold text-slate-300">
          Latitude kantor
          <input
            type="number"
            step="any"
            min={-90}
            max={90}
            value={geofence.latitude}
            onChange={(event) =>
              setGeofence((current) => ({
                ...current,
                latitude: Number(event.target.value),
              }))
            }
            className="min-h-11 w-full rounded-xl border border-white/10 bg-slate-950 px-3 font-mono text-white outline-none focus:border-sky-400"
          />
        </label>
        <label className="space-y-1.5 text-xs font-bold text-slate-300">
          Longitude kantor
          <input
            type="number"
            step="any"
            min={-180}
            max={180}
            value={geofence.longitude}
            onChange={(event) =>
              setGeofence((current) => ({
                ...current,
                longitude: Number(event.target.value),
              }))
            }
            className="min-h-11 w-full rounded-xl border border-white/10 bg-slate-950 px-3 font-mono text-white outline-none focus:border-sky-400"
          />
        </label>
        <div className="space-y-1.5 text-xs font-bold text-slate-300">
          <span>Radius maksimal (meter)</span>
          <input
            aria-label="Radius maksimal geofence dalam meter"
            type="number"
            min={10}
            max={10_000}
            step={1}
            value={geofence.radiusMeter}
            onChange={(event) =>
              setGeofence((current) => ({
                ...current,
                radiusMeter: Number(event.target.value),
              }))
            }
            className="min-h-11 w-full rounded-xl border border-white/10 bg-slate-950 px-3 font-mono text-white outline-none focus:border-sky-400"
          />
          <div className="flex flex-wrap items-center gap-1.5 pt-1">
            {[25, 50, 100, 250, 500].map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() =>
                  setGeofence((current) => ({
                    ...current,
                    radiusMeter: preset,
                  }))
                }
                className={`rounded-lg px-2 py-0.5 text-[11px] font-bold transition-all ${
                  geofence.radiusMeter === preset
                    ? "bg-sky-400 text-slate-950 shadow-sm"
                    : "border border-white/10 bg-white/[0.04] text-slate-300 hover:bg-white/[0.08]"
                }`}
              >
                {preset}m
              </button>
            ))}
          </div>
        </div>
        <label className="flex min-h-11 items-center gap-3 self-start rounded-xl border border-white/10 bg-slate-950 px-4 py-3 text-xs font-bold text-white mt-5">
          <input
            type="checkbox"
            checked={geofence.enabled}
            onChange={(event) =>
              setGeofence((current) => ({
                ...current,
                enabled: event.target.checked,
              }))
            }
            className="size-4 accent-sky-400"
          />
          Wajibkan lokasi saat scan
        </label>

        {currentDeviceCoords ? (
          <div className="flex flex-col items-start justify-between gap-3 rounded-2xl border border-white/10 bg-slate-950/60 p-4 sm:col-span-2 sm:flex-row sm:items-center lg:col-span-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-xs font-bold text-slate-300">
                <span>Posisi Perangkat Saat Ini:</span>
                <span className="font-mono text-sky-300">
                  {currentDeviceCoords.lat.toFixed(6)},{" "}
                  {currentDeviceCoords.lng.toFixed(6)}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
                <span>Jarak ke Titik Kantor:</span>
                <span className="font-mono font-black text-white">
                  {calculateDistanceMeters(
                    currentDeviceCoords.lat,
                    currentDeviceCoords.lng,
                    geofence.latitude,
                    geofence.longitude,
                  )}{" "}
                  meter
                </span>
                <span>(Radius Diizinkan: {geofence.radiusMeter}m)</span>
              </div>
            </div>
            <StatusBadge
              tone={
                calculateDistanceMeters(
                  currentDeviceCoords.lat,
                  currentDeviceCoords.lng,
                  geofence.latitude,
                  geofence.longitude,
                ) <= geofence.radiusMeter
                  ? "success"
                  : "warning"
              }
            >
              {calculateDistanceMeters(
                currentDeviceCoords.lat,
                currentDeviceCoords.lng,
                geofence.latitude,
                geofence.longitude,
              ) <= geofence.radiusMeter
                ? "Di Dalam Radius Kantor"
                : "Di Luar Radius Kantor"}
            </StatusBadge>
          </div>
        ) : null}

        <div className="flex flex-col gap-2 sm:col-span-2 sm:flex-row lg:col-span-4">
          <button
            type="button"
            disabled={geofenceBusy}
            onClick={useCurrentLocation}
            className="min-h-11 rounded-xl border border-white/10 bg-white/[0.05] px-4 text-xs font-bold text-slate-200 hover:bg-white/10 disabled:opacity-50"
          >
            Ambil & Uji Lokasi Perangkat Ini
          </button>
          <button
            type="submit"
            disabled={geofenceBusy}
            className="min-h-11 rounded-xl bg-sky-400 px-5 text-xs font-black text-slate-950 hover:bg-sky-300 disabled:opacity-50"
          >
            {geofenceBusy ? "Menyimpan..." : "Simpan & Sinkronkan ke Cloud"}
          </button>
        </div>
        {!isOnline ? (
          <p className="text-xs text-amber-200 sm:col-span-2 lg:col-span-4">
            Perubahan lokasi global memerlukan koneksi online agar konsisten di
            seluruh perangkat.
          </p>
        ) : null}
      </form>
    </section>
  );
}
