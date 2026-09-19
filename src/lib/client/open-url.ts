"use client";

import { isDesktopRuntime, isMobileRuntime } from "@/lib/runtime/app-runtime";
import { invokeDesktop } from "@/lib/runtime/desktop-commands";

/**
 * Menyerahkan tautan ke aplikasi lain (WhatsApp, aplikasi telepon, browser).
 *
 * Di Android tautan TIDAK boleh dibuka dengan `window.location.href` maupun
 * `window.open`. WebView yang dipakai Tauri tidak meneruskan skema non-http
 * (`tel:`, `whatsapp:`) ke Intent sistem, dan `https://wa.me/...` hanya dimuat
 * sebagai WhatsApp Web DI DALAM aplikasi lalu gagal. Satu-satunya jalan yang
 * benar adalah command Rust `desktop_open_external_url`, yang di Android
 * menjalankan Intent.ACTION_VIEW.
 *
 * Urutan sengaja menempatkan jalur Tauri lebih dulu untuk Mobile DAN Desktop;
 * `window.open` hanya dipakai pada build Web di browser biasa.
 */
export async function openExternalUrl(url: string): Promise<boolean> {
  const target = url.trim();
  if (!target) return false;

  // 1. Aplikasi Tauri (Android/iOS maupun Desktop) — serahkan ke sistem operasi.
  if (isMobileRuntime() || isDesktopRuntime()) {
    try {
      await invokeDesktop("desktop_open_external_url", { url: target });
      return true;
    } catch (e) {
      console.warn("desktop_open_external_url gagal:", e);
      // Jangan jatuh ke window.location.href di sini: pada WebView Android itu
      // justru memunculkan layar error ERR_UNKNOWN_URL_SCHEME di dalam aplikasi.
      if (isMobileRuntime()) return false;
    }
  }

  // 2. Browser biasa (build Web).
  try {
    const win = window.open(target, "_blank", "noopener,noreferrer");
    if (win) return true;
  } catch {
    // Popup diblokir kebijakan browser; lanjut ke navigasi langsung.
  }

  try {
    window.location.href = target;
    return true;
  } catch {
    return false;
  }
}

/**
 * Normalisasi nomor Indonesia ke bentuk internasional tanpa tanda plus,
 * satu-satunya bentuk yang diterima WhatsApp (`08…` dan `8…` → `628…`).
 */
export function normalizeWhatsAppNumber(phoneNumber: string): string {
  let digits = phoneNumber.replace(/\D/g, "");
  if (digits.startsWith("0")) {
    digits = `62${digits.slice(1)}`;
  } else if (digits.startsWith("8")) {
    digits = `62${digits}`;
  }
  return digits;
}

/**
 * Membuka percakapan WhatsApp dengan satu nomor.
 *
 * - Mobile: skema `whatsapp://send` supaya aplikasi WhatsApp yang terpasang
 *   langsung terbuka pada chat nomor tersebut, bukan WhatsApp Web.
 * - Desktop/Web: `https://wa.me/...` supaya terbuka di WhatsApp Desktop/Web.
 */
export async function openWhatsAppChat(
  phoneNumber: string,
  message = "",
): Promise<boolean> {
  const cleanPhone = normalizeWhatsAppNumber(phoneNumber);
  if (cleanPhone.length < 8) return false;
  const encodedText = encodeURIComponent(message);

  if (isMobileRuntime()) {
    const berhasil = await openExternalUrl(
      `whatsapp://send?phone=${cleanPhone}&text=${encodedText}`,
    );
    if (berhasil) return true;
    // WhatsApp tidak terpasang: biarkan sistem memilih penangan lain daripada
    // membiarkan tombolnya diam tanpa penjelasan.
    return openExternalUrl(`https://wa.me/${cleanPhone}?text=${encodedText}`);
  }

  return openExternalUrl(`https://wa.me/${cleanPhone}?text=${encodedText}`);
}

/**
 * Membuka aplikasi telepon dengan nomor sudah tercantum.
 */
export async function openPhoneDialer(phoneNumber: string): Promise<boolean> {
  const raw = phoneNumber.trim();
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 5) return false;
  return openExternalUrl(`tel:${raw.startsWith("+") ? `+${digits}` : digits}`);
}
