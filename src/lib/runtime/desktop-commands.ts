"use client";

import { invoke } from "@tauri-apps/api/core";

interface DesktopCommandError {
  code?: unknown;
  message?: unknown;
}

function commandErrorMessage(error: unknown) {
  if (typeof error === "string" && error.trim()) return error;
  if (error && typeof error === "object") {
    const value = error as DesktopCommandError;
    if (typeof value.message === "string" && value.message.trim()) {
      return value.message;
    }
  }
  return "Perintah keamanan Desktop tidak dapat diproses.";
}

export async function invokeDesktop<T>(
  command: string,
  args?: Record<string, unknown>,
) {
  try {
    return await invoke<T>(command, args);
  } catch (error) {
    throw new Error(commandErrorMessage(error));
  }
}

/**
 * Dorong satu siklus sinkronisasi Desktop setelah mutasi lokal, tanpa menunggu.
 *
 * Dulu badan tiga baris ini disalin ke 13 berkas gateway dengan dua nama —
 * `kickDesktopSync` dan `kickSync` — sehingga perubahan pada salah satunya
 * hanya mendarat di sebagian pemanggil. Kegagalan sengaja ditelan: pemanggilnya
 * sudah menyimpan datanya ke SQLite lokal dan outbox akan mencoba lagi sendiri.
 *
 * BUKAN pengganti `requestSyncNow()` di `gateways/sync-status.ts`. Yang ini
 * memanggil command Rust langsung; `requestSyncNow` menyiarkan event yang
 * dibangunkan `AutoSyncRunner`. Keduanya dipakai di tempat berbeda dengan
 * sengaja.
 */
export function kickDesktopSync() {
  void invokeDesktop("desktop_sync_now").catch(() => undefined);
}
