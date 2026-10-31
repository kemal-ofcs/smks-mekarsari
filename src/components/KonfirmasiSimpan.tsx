"use client";

import { useEffect } from "react";
import {
  PERTANYAAN_SIMPAN,
  useConfirmDialog,
} from "@/lib/hooks/useConfirmDialog";

/**
 * Penjaga tunggal "apakah data sudah benar?" untuk setiap formulir di dalam
 * shell, dipasang di `AppShell` dan `MobileAppShell`. Formulir baru otomatis
 * ikut tanpa menulis apa pun.
 *
 * Submit dan klik ditangkap di fase capture pada `document`, sebelum sampai ke
 * React, lalu dikirim ulang setelah dijawab "Lanjut". `submit` baru terpicu
 * setelah validasi bawaan lolos, jadi formulir yang belum lengkap tidak ditanya.
 *
 * - `data-tanpa-konfirmasi` pada `<form>`: pencarian, filter, atau formulir yang
 *   sudah punya dialog konfirmasi sendiri.
 * - `data-konfirmasi` pada tombol: tombol simpan yang berada di luar `<form>`.
 */
export function KonfirmasiSimpan() {
  const { konfirmasi, dialogKonfirmasi } = useConfirmDialog();

  useEffect(() => {
    let lolos: Element | null = null;

    const tanya = async (elemen: Element, ulangi: () => void) => {
      const setuju = await konfirmasi({
        ...PERTANYAAN_SIMPAN,
        description: "Apakah data yang dicatat sudah benar?",
      });
      if (!setuju || !elemen.isConnected) return;
      // Pengiriman ulang berjalan serempak, jadi `lolos` hanya berlaku untuknya.
      lolos = elemen;
      ulangi();
      lolos = null;
    };

    const padaSubmit = (event: SubmitEvent) => {
      const form = event.target;
      if (!(form instanceof HTMLFormElement) || form === lolos) return;
      if (form.hasAttribute("data-tanpa-konfirmasi")) return;
      event.preventDefault();
      event.stopPropagation();
      const pengirim = event.submitter;
      void tanya(form, () => form.requestSubmit(pengirim));
    };

    const padaKlik = (event: MouseEvent) => {
      const tombol =
        event.target instanceof Element
          ? event.target.closest<HTMLElement>("[data-konfirmasi]")
          : null;
      if (!tombol || tombol === lolos) return;
      event.preventDefault();
      event.stopPropagation();
      void tanya(tombol, () => tombol.click());
    };

    document.addEventListener("submit", padaSubmit, true);
    document.addEventListener("click", padaKlik, true);
    return () => {
      document.removeEventListener("submit", padaSubmit, true);
      document.removeEventListener("click", padaKlik, true);
    };
  }, [konfirmasi]);

  return dialogKonfirmasi;
}
