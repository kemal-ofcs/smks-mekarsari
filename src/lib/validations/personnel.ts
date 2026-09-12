/**
 * Nilai kanonik data guru & siswa yang dipakai formulir Web/Desktop, Mobile,
 * dan impor Excel sekaligus.
 *
 * `STATUS_SISWA` WAJIB sama dengan CHECK constraint `siswa_data.status` di
 * `db-migrations.ts`/`storage.rs` dan enum `sync-schema.ts`. Formulir Web dulu
 * mengeja daftarnya sendiri dan menawarkan "Mutasi" serta "Nonaktif" — dua
 * nilai yang ditolak database, sehingga memilihnya selalu gagal disimpan.
 */
export const STATUS_SISWA = [
  "Aktif",
  "Lulus",
  "Pindah",
  "Keluar",
  "Drop Out",
] as const;

export type StatusSiswa = (typeof STATUS_SISWA)[number];

/**
 * Nilai yang ditawarkan formulir guru; kolomnya sendiri tanpa CHECK.
 *
 * Gabungan dua daftar yang dulu dieja terpisah — Web/Desktop menawarkan GTT,
 * Mobile menawarkan Kontrak — supaya data yang sudah tersimpan dari kedua
 * build tetap sah ketika diekspor lalu diimpor ulang.
 */
export const STATUS_KEPEGAWAIAN_GURU = [
  "PNS",
  "PPPK",
  "GTY",
  "GTT",
  "Honorer",
  "Kontrak",
] as const;

/** Cocokkan tanpa peduli huruf besar/kecil; `null` bila tidak dikenal. */
export function normalizeStatusSiswa(raw: string): StatusSiswa | null {
  const value = raw.trim().toLowerCase();
  return STATUS_SISWA.find((status) => status.toLowerCase() === value) ?? null;
}

/**
 * Label shift yang menyebut jamnya. Shift menentukan jendela scan masuk dan
 * pulang seseorang, jadi nama saja ("Shift 1") tidak memberi tahu operator
 * kapan orang itu boleh scan — padahal itu yang sedang ia cari.
 */
export function shiftLabel(shift: Record<string, unknown>): string {
  const nama = String(shift.nama_shift || `Shift #${String(shift.id_shift)}`);
  const masuk = String(shift.jam_masuk ?? "").trim();
  const pulang = String(shift.jam_pulang ?? "").trim();
  return masuk && pulang ? `${nama} (${masuk}–${pulang})` : nama;
}
