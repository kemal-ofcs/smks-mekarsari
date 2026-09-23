"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { ambilFotoPersonil } from "@/lib/gateways/personnel-photo";

/**
 * Foto penuh satu personil, dimuat saat dialog dibuka.
 *
 * Disalin apa adanya ke Mobile (`filesToCopy` di `sync-frontend-lib.ts`):
 * kedua `Modal` berbagi kontrak `isOpen`/`onClose`/`title`/`titleId`.
 */
export function PersonnelPhotoDialog({
  idUnik,
  nama,
  onClose,
}: {
  idUnik: string;
  nama: string;
  onClose: () => void;
}) {
  const [foto, setFoto] = useState<string | null>(null);
  const [status, setStatus] = useState<"memuat" | "ada" | "kosong" | "galat">(
    "memuat",
  );
  const [galat, setGalat] = useState("");

  useEffect(() => {
    let aktif = true;
    setStatus("memuat");
    ambilFotoPersonil(idUnik)
      .then((hasil) => {
        if (!aktif) return;
        if (hasil?.foto_base64) {
          setFoto(
            `data:${hasil.foto_mime || "image/jpeg"};base64,${hasil.foto_base64.replace(/^data:[^,]+,/, "")}`,
          );
          setStatus("ada");
        } else {
          setStatus("kosong");
        }
      })
      .catch((error: unknown) => {
        if (!aktif) return;
        setGalat(
          error instanceof Error ? error.message : "Foto tidak dapat dimuat.",
        );
        setStatus("galat");
      });
    return () => {
      aktif = false;
    };
  }, [idUnik]);

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={`Foto ${nama}`}
      titleId={`judul-foto-personil-${idUnik}`}
      maxWidth="max-w-sm"
    >
      <div className="grid min-h-64 place-items-center">
        {status === "memuat" ? (
          <p className="text-xs text-slate-400">Memuat foto...</p>
        ) : status === "ada" && foto ? (
          // biome-ignore lint/performance/noImgElement: data URI dari database, bukan aset build
          <img
            src={foto}
            alt={`Foto profil ${nama}`}
            className="max-h-[70vh] w-full rounded-xl object-contain"
          />
        ) : status === "galat" ? (
          <p role="alert" className="text-center text-xs text-rose-300">
            {galat}
          </p>
        ) : (
          <p className="text-center text-xs text-slate-400">
            Foto sudah tidak tersedia. Mungkin baru saja dihapus dari perangkat
            lain.
          </p>
        )}
      </div>
    </Modal>
  );
}
