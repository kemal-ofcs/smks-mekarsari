"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { optimizeImageFile } from "@/lib/client/image-optimizer";
import {
  ambilFotoPersonil,
  hapusFotoPersonil,
  simpanFotoPersonil,
} from "@/lib/gateways/personnel-photo";

/**
 * Kendali foto profil satu personil — dipakai halaman Guru, Siswa, dan Karyawan.
 *
 * Satu komponen untuk ketiganya karena `personil_foto` berkunci
 * `master_data.id_unik`, dan `academic.rs` menulis `id_unik` dengan nilai yang
 * sama dengan `id_guru`/`id_siswa`. Jadi ketiga halaman menyerahkan kunci yang
 * bentuknya sama, dan tidak ada tiga jalur yang harus dijaga tetap identik.
 *
 * Kompresi memakai `optimizeImageFile`, bukan rantai FileReader→Image→canvas
 * yang dirakit sendiri: helper itu me-`reject` kedua jalur gagalnya, sehingga
 * kegagalan memilih berkas tidak pernah berakhir sebagai state yang diam-diam
 * kosong lalu tersimpan sebagai personil tanpa foto.
 */

const MAKS_BASE64 = 512_000;
const MIME_DITERIMA = ["image/jpeg", "image/png", "image/webp"];

interface Props {
  idUnik: string;
  /** Nama personil, untuk teks alternatif yang bisa dibacakan pembaca layar. */
  nama: string;
  disabled?: boolean;
  /** Dipanggil setelah foto tersimpan atau terhapus. */
  onChanged?: () => void;
}

export function PersonnelPhotoField({
  idUnik,
  nama,
  disabled = false,
  onChanged,
}: Props) {
  const [foto, setFoto] = useState<string | null>(null);
  const [memuat, setMemuat] = useState(false);
  const [galat, setGalat] = useState<string | null>(null);
  const isSubmittingRef = useRef(false);

  // Callback distabilkan lewat ref supaya handler inline milik induk tidak
  // memicu ulang efek pemuatan di setiap render.
  const onChangedRef = useRef(onChanged);
  onChangedRef.current = onChanged;

  const muat = useCallback(async () => {
    if (!idUnik) {
      setFoto(null);
      return;
    }
    setMemuat(true);
    setGalat(null);
    try {
      const hasil = await ambilFotoPersonil(idUnik);
      setFoto(
        hasil?.foto_base64
          ? `data:${hasil.foto_mime || "image/jpeg"};base64,${hasil.foto_base64.replace(/^data:[^,]+,/, "")}`
          : null,
      );
    } catch (err) {
      setGalat(err instanceof Error ? err.message : "Gagal memuat foto.");
    } finally {
      setMemuat(false);
    }
  }, [idUnik]);

  useEffect(() => {
    void muat();
  }, [muat]);

  const handlePilih = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Dikosongkan supaya memilih berkas yang sama dua kali tetap memicu change.
    e.target.value = "";
    if (!file || isSubmittingRef.current) return;

    if (!MIME_DITERIMA.includes(file.type)) {
      setGalat("Format foto harus JPEG, PNG, atau WebP.");
      return;
    }

    isSubmittingRef.current = true;
    setGalat(null);
    try {
      const { dataUrl } = await optimizeImageFile(file, {
        maxWidth: 600,
        maxHeight: 800,
        quality: 0.82,
        mimeType: "image/jpeg",
        fit: "contain",
      });
      // Yang disimpan hanya muatan base64-nya, tanpa awalan `data:`; bentuk itu
      // yang diharapkan `personil_foto.foto_base64` di kedua sisi.
      const base64 = dataUrl.replace(/^data:[^,]+,/, "");
      if (base64.length > MAKS_BASE64) {
        setGalat(
          "Foto masih terlalu besar setelah dikompres (maksimal 500 KB). Pilih gambar beresolusi lebih rendah.",
        );
        return;
      }
      await simpanFotoPersonil(idUnik, base64, "image/jpeg");
      setFoto(dataUrl);
      onChangedRef.current?.();
    } catch (err) {
      setGalat(err instanceof Error ? err.message : "Gagal menyimpan foto.");
    } finally {
      isSubmittingRef.current = false;
    }
  };

  const handleHapus = async () => {
    if (isSubmittingRef.current) return;
    isSubmittingRef.current = true;
    setGalat(null);
    try {
      await hapusFotoPersonil(idUnik);
      setFoto(null);
      onChangedRef.current?.();
    } catch (err) {
      setGalat(err instanceof Error ? err.message : "Gagal menghapus foto.");
    } finally {
      isSubmittingRef.current = false;
    }
  };

  const inputId = `input-foto-personil-${idUnik || "baru"}`;

  if (!idUnik) {
    return (
      <p className="text-[11px] text-slate-500">
        Simpan data terlebih dahulu, lalu foto bisa diunggah dari tombol Edit.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <label
        htmlFor={inputId}
        className="block text-xs font-bold text-slate-300"
      >
        Foto Profil
      </label>

      <div className="flex items-start gap-3">
        <div className="h-28 w-24 shrink-0 overflow-hidden rounded-xl border border-white/10 bg-slate-950">
          {memuat ? (
            <div className="flex h-full w-full items-center justify-center text-[10px] text-slate-500">
              Memuat...
            </div>
          ) : foto ? (
            // biome-ignore lint/performance/noImgElement: data URI dari database, bukan aset build
            <img
              src={foto}
              alt={`Foto profil ${nama}`}
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-center text-[10px] text-slate-500">
              Belum ada foto
            </div>
          )}
        </div>

        <div className="flex-1 space-y-2">
          <input
            id={inputId}
            aria-label={`Pilih foto profil untuk ${nama}`}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={handlePilih}
            disabled={disabled}
            className="w-full text-[11px] text-slate-400 file:mr-3 file:rounded-xl file:border-0 file:bg-slate-800 file:px-3 file:py-2 file:text-[11px] file:font-bold file:text-sky-300 hover:file:bg-slate-700 disabled:opacity-50"
          />
          {foto && !disabled ? (
            <button
              type="button"
              onClick={handleHapus}
              className="rounded-lg bg-rose-500/15 px-3 py-1.5 text-[11px] font-semibold text-rose-300 transition hover:bg-rose-500/25"
            >
              Hapus foto
            </button>
          ) : null}
          <p className="text-[10px] text-slate-500">
            Maksimal 500 KB setelah kompresi. Dipakai juga pada kartu identitas.
          </p>
        </div>
      </div>

      {galat ? (
        <p className="text-[11px] text-rose-300" role="alert">
          {galat}
        </p>
      ) : null}
    </div>
  );
}
