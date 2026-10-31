export interface Pilihan {
  value: string;
  label: string;
  disabled: boolean;
}

/** Setiap kata yang diketik harus ada di label, dalam urutan apa pun. */
export function saringPilihan(pilihan: Pilihan[], kata: string): Pilihan[] {
  const potongan = kata.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (potongan.length === 0) return pilihan;
  return pilihan.filter((item) => {
    const label = item.label.toLowerCase();
    return potongan.every((bagian) => label.includes(bagian));
  });
}

const KELAS_WADAH =
  /^(?:[\w-]+:)*(?:w-|flex-|grow|shrink|basis-|self-|min-w-|max-w-|col-span-|order-|m[trblxy]?-)/;

/**
 * Kelas ukuran dan jarak luar dropdown lama berlaku untuk pembungkus kotak dan
 * tombolnya; sisanya (warna, tepi, tinggi) tetap milik kotak pencarian.
 */
export function pisahKelasWadah(kelas: string): {
  wadah: string;
  isian: string;
} {
  const token = kelas.split(/\s+/).filter(Boolean);
  return {
    wadah: token.filter((item) => KELAS_WADAH.test(item)).join(" "),
    isian: token.filter((item) => !KELAS_WADAH.test(item)).join(" "),
  };
}
