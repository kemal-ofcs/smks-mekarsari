"use client";

import { useState } from "react";
import { PersonnelPhotoDialog } from "@/components/personnel/PersonnelPhotoDialog";
import { inisialNama, ronaAvatar } from "@/lib/utils/personnel-initials";

/**
 * Isi kolom Foto di daftar personil: tombol "Lihat Foto" bila personil punya
 * foto, singkatan nama berwarna bila tidak.
 *
 * Daftar personil tidak berhalaman, jadi fotonya sengaja TIDAK dimuat di sini:
 * ratusan foto penuh untuk satu tabel akan berukuran puluhan MB. Status "punya
 * foto" datang dari `useStatusFotoPersonil`, dan foto baru dimuat saat tombol
 * ditekan. Disalin apa adanya ke Mobile (`filesToCopy`).
 */
export function PersonnelAvatar({
  idUnik,
  nama,
  punyaFoto,
}: {
  idUnik: string;
  nama: string;
  punyaFoto: boolean;
}) {
  const [buka, setBuka] = useState(false);

  if (!punyaFoto) {
    const rona = ronaAvatar(nama);
    return (
      <span
        role="img"
        aria-label={`Belum ada foto ${nama}`}
        className="inline-grid size-9 shrink-0 place-items-center rounded-xl border border-white/15 text-xs font-black text-white"
        style={{
          background: `linear-gradient(135deg, hsl(${rona},70%,35%) 0%, hsl(${rona},50%,22%) 100%)`,
        }}
      >
        {inisialNama(nama)}
      </span>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={(event) => {
          // Kartu Mobile membuka detail saat diketuk; tombol ini tidak boleh
          // ikut memicunya.
          event.stopPropagation();
          setBuka(true);
        }}
        aria-label={`Lihat foto ${nama}`}
        className="shrink-0 whitespace-nowrap rounded-lg border border-sky-500/30 bg-sky-500/10 px-2.5 py-1.5 text-[11px] font-bold text-sky-300 transition hover:bg-sky-500/20 active:scale-95"
      >
        Lihat Foto
      </button>
      {buka ? (
        <PersonnelPhotoDialog
          idUnik={idUnik}
          nama={nama}
          onClose={() => setBuka(false)}
        />
      ) : null}
    </>
  );
}
