/**
 * Pemformat tanggal untuk TAMPILAN, bukan untuk perhitungan.
 *
 * Tanggal dari database berbentuk `YYYY-MM-DD` dan ditulis ulang menjadi
 * `DD/MM/YYYY` secara tekstual — TIDAK pernah lewat `new Date()`, yang akan
 * memparsing `"2026-09-17"` sebagai UTC lalu menggesernya ke zona perangkat
 * dan menampilkan tanggal kemarin bagi pengguna di sebelah barat UTC.
 *
 * Nilai yang sudah `DD/MM/YYYY` dikembalikan apa adanya, dan nilai yang tidak
 * dikenali dikembalikan utuh: halaman riwayat lebih baik menampilkan apa yang
 * benar-benar tersimpan daripada menyembunyikannya di balik tanda hubung.
 */
export function formatDisplayDate(value: unknown): string {
  if (!value || typeof value !== "string") return "-";
  if (/^\d{2}\/\d{2}\/\d{4}/.test(value)) return value;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : value;
}
