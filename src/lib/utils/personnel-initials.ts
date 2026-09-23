/** Singkatan nama untuk avatar tanpa foto: "Nama Siswa" menjadi "NS". */
export function inisialNama(nama: string): string {
  const inisial = nama
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((kata) => kata.charAt(0))
    .join("")
    .toUpperCase();
  return inisial || "?";
}

/** Rona warna avatar yang stabil untuk satu nama (0–359). */
export function ronaAvatar(nama: string): number {
  let hash = 0;
  for (let i = 0; i < nama.length; i++) {
    hash = nama.charCodeAt(i) + ((hash << 5) - hash);
    hash |= 0;
  }
  return Math.abs(hash) % 360;
}
