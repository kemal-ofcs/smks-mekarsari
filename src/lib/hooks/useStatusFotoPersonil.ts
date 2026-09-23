"use client";

import { useCallback, useEffect, useState } from "react";
import { statusFotoPersonil } from "@/lib/gateways/personnel-photo";

/**
 * Kumpulan ID personil yang punya foto, untuk kolom Foto di daftar personil.
 *
 * Status diambil per 500 ID (batas command dan route-nya). Kegagalan membaca
 * status TIDAK menyembunyikan daftar: kolomnya jatuh ke singkatan nama, dan
 * foto tetap bisa dibuka lewat Detail. `muatUlang` dipanggil setelah foto
 * disimpan atau dihapus supaya tombol "Lihat Foto" ikut berubah.
 */
export function useStatusFotoPersonil(ids: readonly string[]) {
  const [punyaFoto, setPunyaFoto] = useState<ReadonlySet<string>>(new Set());
  const kunci = ids.join("\u0000");

  const muatUlang = useCallback(async () => {
    const daftar = kunci ? kunci.split("\u0000") : [];
    const hasil = new Set<string>();
    try {
      for (let i = 0; i < daftar.length; i += 500) {
        for (const id of await statusFotoPersonil(daftar.slice(i, i + 500))) {
          hasil.add(id);
        }
      }
      setPunyaFoto(hasil);
    } catch {
      // Sengaja diam: tanpa status, kolom Foto menampilkan singkatan nama dan
      // tidak ada data yang hilang. Galat foto sendiri tampil saat dibuka.
      setPunyaFoto(new Set());
    }
  }, [kunci]);

  useEffect(() => {
    void muatUlang();
  }, [muatUlang]);

  return { punyaFoto, muatUlang };
}
