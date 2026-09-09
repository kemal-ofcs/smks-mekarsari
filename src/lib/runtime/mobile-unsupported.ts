"use client";

import { isMobileRuntime } from "@/lib/runtime/app-runtime";

/**
 * Hentikan sebuah fitur yang memang TIDAK tersedia di build Mobile.
 *
 * Modul di `src/lib` disalin apa adanya ke workspace `mobile`, jadi setiap
 * gateway ikut hadir di sana meskipun command Rust-nya tidak pernah didaftarkan
 * di `mobile/src-tauri/src/lib.rs`. Gateway yang hadir tanpa command dan tanpa
 * halaman adalah ranjau: begitu seseorang membuat halaman Mobile yang
 * memakainya, yang muncul adalah kegagalan IPC yang membingungkan, bukan
 * penjelasan.
 *
 * Fungsi ini membuat batasnya berbicara. Ia sengaja memakai guard POSITIF
 * `isMobileRuntime()` — bentuk yang sama yang dikenali `audit:contract`.
 *
 * Kini dipakai HANYA oleh tinjauan antrean WhatsApp. Alasannya bukan kelalaian,
 * melainkan bentuk datanya: halaman itu membaca `notifikasi_wa` LOKAL, dan tabel
 * itu tidak pernah ditarik snapshot. Sebuah ponsel hanya akan melihat antrean
 * yang ia buat sendiri — pada perangkat yang bukan terminal pemindai berarti
 * kosong, dan kosong itu tidak bisa dibedakan dari "tidak ada notifikasi".
 * Layar yang tampak sehat sambil berbohong lebih buruk daripada layar yang
 * berkata tidak tersedia. Penjaga ini dilepas setelah command Mobile-nya
 * membaca CLOUD, bukan sekadar setelah command-nya didaftarkan.
 *
 * **Bimbingan Konseling sudah TIDAK memakai penjaga ini lagi.** Ia murni cloud
 * (`bk_kasus`/`bk_sesi` tidak pernah ada di SQLite lokal), sehingga di Mobile ia
 * berperilaku persis seperti di Desktop: bekerja saat ada jaringan, dan menuntut
 * jaringan saat tidak. Keberatan lamanya — "layar yang gagal justru saat guru BK
 * di lapangan" — adalah penilaian UX, bukan halangan teknis, dan dijawab dengan
 * pesan yang menjelaskan alih-alih daftar kosong. Konsekuensinya tetap berlaku
 * dan tidak berubah: catatan kedisiplinan seorang anak sengaja TIDAK direplikasi
 * ke SQLite setiap perangkat, karena terminal pemindai di lobi sekolah tidak
 * boleh menyimpannya.
 *
 * Yang IKUT ke Mobile sejak awal adalah Dasbor Audit Kehadiran, karena ia
 * benar-benar offline: seluruh tabel yang dibacanya ada di `SNAPSHOT_TABLES`.
 */
export function assertTersediaDiMobile(namaFitur: string): void {
  if (isMobileRuntime()) {
    throw new Error(
      `${namaFitur} tidak tersedia di aplikasi Mobile. Gunakan versi Web atau Desktop.`,
    );
  }
}
