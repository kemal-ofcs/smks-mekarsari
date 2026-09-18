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

/**
 * Nilai filter "personil yang unitnya belum diisi".
 *
 * Sengaja sebuah sentinel, bukan string kosong: string kosong sudah dipakai
 * pilihan "Semua Unit", dan tanpa pilihan tersendiri baris yang unitnya kosong
 * tidak punya satu pun filter yang menampilkannya — padahal justru baris itu
 * yang perlu ditemukan untuk dilengkapi. Diawali `__` supaya tidak mungkin
 * bertabrakan dengan nama unit yang diketik manusia.
 */
export const TANPA_UNIT = "__tanpa_unit__";

/**
 * Pilihan dropdown filter unit: gabungan unit AKTIF dan unit yang benar-benar
 * dipakai baris yang sedang ditampilkan.
 *
 * Gabungan, bukan hanya unit aktif: unit yang sudah dinonaktifkan tetap
 * menempel pada personil lama, dan kalau ia hilang dari dropdown baris-baris
 * itu tidak bisa disaring sama sekali — tepat ketika seseorang perlu
 * memindahkannya ke unit pengganti.
 */
export function opsiFilterUnit(
  unitAktif: Record<string, unknown>[],
  baris: Record<string, unknown>[],
): string[] {
  const kumpulan = new Set<string>();
  for (const unit of unitAktif) {
    const nama = String(unit.nama_unit ?? "").trim();
    if (nama) kumpulan.add(nama);
  }
  for (const item of baris) {
    const nama = String(item.unit ?? "").trim();
    if (nama) kumpulan.add(nama);
  }
  return [...kumpulan].sort((a, b) => a.localeCompare(b, "id"));
}
