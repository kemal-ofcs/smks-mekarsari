"use client";

import { useEffect, useState } from "react";
import { ambilFotoPersonil } from "@/lib/gateways/personnel-photo";
import { inisialNama, ronaAvatar } from "@/lib/utils/personnel-initials";

/**
 * Foto satu personil untuk header Detail, dengan singkatan nama berwarna
 * sebagai cadangan. Ukuran dan sudutnya diatur pemanggil lewat `className`.
 * Disalin apa adanya ke Mobile (`filesToCopy`).
 */
export function PersonnelPortrait({
  idUnik,
  nama,
  className = "size-12 rounded-2xl",
}: {
  idUnik: string;
  nama: string;
  className?: string;
}) {
  const [foto, setFoto] = useState<string | null>(null);

  useEffect(() => {
    let aktif = true;
    setFoto(null);
    if (!idUnik) return;
    ambilFotoPersonil(idUnik)
      .then((hasil) => {
        if (aktif && hasil?.foto_base64) {
          setFoto(
            `data:${hasil.foto_mime || "image/jpeg"};base64,${hasil.foto_base64.replace(/^data:[^,]+,/, "")}`,
          );
        }
      })
      .catch(() => {
        // Sengaja diam: header Detail tetap berguna dengan singkatan nama, dan
        // galat foto ditampilkan di bagian Foto tempat foto dikelola.
      });
    return () => {
      aktif = false;
    };
  }, [idUnik]);

  if (foto) {
    return (
      // biome-ignore lint/performance/noImgElement: data URI dari database, bukan aset build
      <img
        src={foto}
        alt={`Foto profil ${nama}`}
        className={`${className} shrink-0 border border-white/15 object-cover`}
      />
    );
  }

  const rona = ronaAvatar(nama);
  return (
    <span
      role="img"
      aria-label={`Belum ada foto ${nama}`}
      className={`${className} grid shrink-0 place-items-center border border-white/15 text-base font-black text-white`}
      style={{
        background: `linear-gradient(135deg, hsl(${rona},70%,35%) 0%, hsl(${rona},50%,22%) 100%)`,
      }}
    >
      {inisialNama(nama)}
    </span>
  );
}
