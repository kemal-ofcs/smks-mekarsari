"use client";

import { isDesktopRuntime, isMobileRuntime } from "@/lib/runtime/app-runtime";
import { invokeDesktop } from "@/lib/runtime/desktop-commands";

/**
 * Membuka URL eksternal (termasuk wa.me dan whatsapp://) di aplikasi target:
 * - Desktop (Tauri Windows/Mac/Linux): Meluncurkan browser Chrome / browser default sistem via OS.
 * - Mobile (Tauri Android): Meluncurkan APK WhatsApp langsung via deep link intent atau AndroidBridge.
 * - Web Browser: Membuka tab baru via window.open.
 */
export async function openExternalUrl(url: string): Promise<boolean> {
  const target = url.trim();
  if (!target) return false;

  // 1. Mobile Android APK
  if (
    isMobileRuntime() ||
    (typeof window !== "undefined" && window.AndroidBridge?.openExternal)
  ) {
    if (typeof window !== "undefined" && window.AndroidBridge?.openExternal) {
      try {
        const raw = window.AndroidBridge.openExternal(target);
        const parsed = JSON.parse(raw) as { sukses?: boolean };
        if (parsed?.sukses) return true;
      } catch (e) {
        console.warn("AndroidBridge openExternal error:", e);
      }
    }
    try {
      window.location.href = target;
      return true;
    } catch {
      // Skema URI tidak dapat dibuka di lingkungan WebView saat ini; kembalikan false secara aman.
      return false;
    }
  }

  // 2. Desktop Tauri Native (buka Google Chrome / browser default OS)
  if (isDesktopRuntime()) {
    try {
      await invokeDesktop("desktop_open_external_url", { url: target });
      return true;
    } catch (e) {
      console.warn("desktop_open_external_url error:", e);
    }
  }

  // 3. Web Browser
  try {
    const win = window.open(target, "_blank", "noopener,noreferrer");
    if (win) return true;
  } catch {
    // Popup diblokir oleh kebijakan browser atau lingkungan tidak mengizinkan window.open; lanjutkan ke navigasi langsung.
  }

  try {
    window.location.href = target;
    return true;
  } catch {
    // Tidak ada aplikasi atau penangan skema yang tersedia untuk membuka tautan ini.
    return false;
  }
}

/**
 * Helper khusus format WhatsApp sesuai target platform:
 * - Mobile: Mengutamakan skema deep-link `whatsapp://send` agar langsung membuka aplikasi WhatsApp APK.
 * - Desktop/Web: Menggunakan `https://wa.me/...` agar membuka WhatsApp Web / Desktop di browser Chrome.
 */
export async function openWhatsAppChat(
  phoneNumber: string,
  message: string,
): Promise<boolean> {
  const cleanPhone = phoneNumber.replace(/[^\d]/g, "");
  const encodedText = encodeURIComponent(message);

  if (isMobileRuntime()) {
    const directApkUrl = `whatsapp://send?phone=${cleanPhone}&text=${encodedText}`;
    return openExternalUrl(directApkUrl);
  }

  const webUrl = `https://wa.me/${cleanPhone}?text=${encodedText}`;
  return openExternalUrl(webUrl);
}
