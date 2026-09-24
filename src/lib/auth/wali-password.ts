/**
 * Password awal/sementara akun wali murid.
 *
 * Menggantikan formula lama `NISN + UNIT`, yang bisa dihitung siapa pun yang
 * memegang kartu pelajar seorang anak: wali yang belum pernah masuk bisa
 * diambil alih, dan justru penyerang yang menetapkan password barunya di layar
 * "wajib ganti password".
 *
 * Alfabetnya tanpa karakter kembar-rupa (0/O, 1/I/L) karena password ini
 * dibacakan atau diketik ulang dari slip cetak. Cerminan
 * `WALI_PASSWORD_ALPHABET`/`WALI_PASSWORD_LENGTH` di `academic.rs`.
 */
export const WALI_PASSWORD_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const WALI_PASSWORD_LENGTH = 10;

export function buatPasswordWaliAcak(): string {
  const n = WALI_PASSWORD_ALPHABET.length;
  // Byte di atas kelipatan terakhir dibuang supaya tiap karakter berpeluang sama.
  const batas = 256 - (256 % n);
  let hasil = "";
  while (hasil.length < WALI_PASSWORD_LENGTH) {
    for (const byte of crypto.getRandomValues(new Uint8Array(16))) {
      if (byte < batas && hasil.length < WALI_PASSWORD_LENGTH) {
        hasil += WALI_PASSWORD_ALPHABET[byte % n];
      }
    }
  }
  return hasil;
}
