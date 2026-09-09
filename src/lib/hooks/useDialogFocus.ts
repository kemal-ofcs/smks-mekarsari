"use client";

import { type RefObject, useEffect } from "react";

/**
 * Elemen yang bisa menerima fokus keyboard di dalam sebuah dialog.
 *
 * `[tabindex="-1"]` sengaja dikecualikan: panel dialognya sendiri memakai nilai
 * itu supaya bisa difokuskan secara program tanpa ikut masuk urutan Tab.
 */
const FOKUSABEL = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(", ");

/**
 * Kelola fokus, kunci gulir, dan jebakan Tab untuk sebuah dialog.
 *
 * Tiga hal yang dikerjakan, dan ketiganya pernah hilang di salah satu build:
 *
 * 1. **Fokus masuk saat dibuka.** Tanpa ini fokus tertinggal pada tombol yang
 *    membuka dialog — di belakang backdrop — sehingga pengguna keyboard dan
 *    pembaca layar tidak pernah benar-benar berada di dalam dialognya. Modal
 *    Mobile sebelumnya tidak melakukan ini sama sekali.
 * 2. **Fokus kembali saat ditutup.** Fokus dipulangkan ke elemen yang tadi
 *    membukanya, bukan dilempar ke awal halaman.
 * 3. **Tab tidak keluar.** Sebelum ini Tab bisa berjalan ke tautan dan tombol
 *    di belakang backdrop, yang berarti `aria-modal="true"` berbohong: elemen
 *    di belakangnya diumumkan tersembunyi, tetapi tetap bisa dicapai.
 *
 * Fokus TIDAK pernah dicuri bila sudah berada di dalam dialog — itulah yang
 * mencegah bug "kehilangan fokus setiap satu ketukan" yang diperingatkan
 * aturan 5, ketika sebuah efek berjalan ulang saat pengguna sedang mengetik.
 *
 * Hook ini hidup di `lib/hooks` yang IKUT SINKRONISASI, sehingga Modal
 * web-desktop dan Mobile tidak bisa lagi menyimpang dalam perkara ini —
 * sebelumnya keduanya berbeda dan hanya satu yang mengelola fokus.
 */
export function useDialogFocus(
  dialogRef: RefObject<HTMLElement | null>,
  isOpen: boolean,
): void {
  useEffect(() => {
    if (!isOpen) return;
    const dialog = dialogRef.current;
    if (!dialog) return;

    const fokusSebelumnya = document.activeElement as HTMLElement | null;
    if (!dialog.contains(document.activeElement)) {
      dialog.focus({ preventScroll: true });
    }

    const gulirSebelumnya = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const tangkapTab = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;

      // `getClientRects()` dipakai, bukan `offsetParent`, karena yang kedua
      // selalu null untuk elemen `position: fixed` — dan panel dialog ini
      // memang fixed.
      const dapatDifokus = Array.from(
        dialog.querySelectorAll<HTMLElement>(FOKUSABEL),
      ).filter((elemen) => elemen.getClientRects().length > 0);

      if (dapatDifokus.length === 0) {
        event.preventDefault();
        dialog.focus({ preventScroll: true });
        return;
      }

      const pertama = dapatDifokus[0] as HTMLElement;
      const terakhir = dapatDifokus[dapatDifokus.length - 1] as HTMLElement;
      const aktif = document.activeElement;

      if (event.shiftKey && (aktif === pertama || aktif === dialog)) {
        event.preventDefault();
        terakhir.focus();
        return;
      }
      if (!event.shiftKey && aktif === terakhir) {
        event.preventDefault();
        pertama.focus();
      }
    };

    document.addEventListener("keydown", tangkapTab, true);

    return () => {
      document.removeEventListener("keydown", tangkapTab, true);
      document.body.style.overflow = gulirSebelumnya;
      fokusSebelumnya?.focus?.();
    };
  }, [dialogRef, isOpen]);
}
