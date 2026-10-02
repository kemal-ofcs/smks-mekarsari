"use client";

import { useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { optimizeImageFile } from "@/lib/client/image-optimizer";

interface HeroImageUploaderProps {
  value: string | undefined | null;
  onChange: (value: string) => void;
  disabled?: boolean;
}

export function HeroImageUploader({
  value,
  onChange,
  disabled = false,
}: HeroImageUploaderProps) {
  const [error, setError] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  const hasImage = Boolean(value && value.trim().length > 0);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setError("Format file harus berupa gambar JPEG, PNG, atau WebP.");
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      setError("Ukuran file gambar maksimal 5 MB sebelum kompresi.");
      return;
    }

    setIsProcessing(true);
    setError(null);

    try {
      const { dataUrl } = await optimizeImageFile(file, {
        maxWidth: 1920,
        maxHeight: 1080,
        quality: 0.82,
        mimeType: "image/jpeg",
        fit: "contain",
      });

      if (dataUrl.length > 2_000_000) {
        setError(
          "Gambar masih terlalu besar setelah dikompres. Silakan pilih foto dengan resolusi lebih rendah.",
        );
        return;
      }

      onChange(dataUrl);
      setError(null);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Gagal memproses gambar latar hero.",
      );
    } finally {
      setIsProcessing(false);
    }
  };

  const handleRemove = () => {
    setError(null);
    onChange("");
  };

  return (
    <div className="space-y-3 rounded-2xl border border-white/10 bg-slate-850 p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <div>
          <label
            htmlFor="input-hero-image-file"
            className="block text-xs font-bold text-slate-200"
          >
            Foto Latar Belakang Hero
          </label>
          <p className="text-[11px] text-slate-400 mt-0.5">
            Foto gedung atau kampus sekolah (format landscape 16:9 disarankan).
          </p>
        </div>
        {hasImage ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-[10px] font-bold text-emerald-400 border border-emerald-500/20">
            <Icon name="check" className="size-3" />
            <span>Foto Terpasang</span>
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 rounded-full bg-slate-700/60 px-2.5 py-0.5 text-[10px] font-bold text-slate-400 border border-white/5">
            <span>Gradien Standar</span>
          </span>
        )}
      </div>

      {/* Pratinjau Gambar atau Banner Status Kosong */}
      {hasImage ? (
        <div className="space-y-2">
          <div className="relative aspect-video w-full max-w-md overflow-hidden rounded-xl border border-white/15 shadow-md">
            {/* biome-ignore lint/performance/noImgElement: user uploaded data url preview */}
            <img
              src={value || ""}
              alt="Pratinjau Foto Latar Hero"
              className="h-full w-full object-cover"
            />
            {/* Gradien Pelindung Kontras Simulasi Hero */}
            <div className="absolute inset-0 bg-gradient-to-r from-slate-950/75 via-slate-950/40 to-transparent flex items-end p-3">
              <div className="space-y-0.5">
                <span className="inline-block rounded-md bg-sky-500/80 px-1.5 py-0.5 text-[9px] font-bold text-slate-950">
                  Pratinjau Hero
                </span>
                <p className="text-xs font-bold text-white drop-shadow-sm">
                  Gradien transparan melindungi kontras teks
                </p>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 rounded-xl bg-sky-500/10 p-2.5 text-xs text-sky-300 border border-sky-500/20 max-w-md">
            <Icon name="check" className="size-4 shrink-0 text-sky-400" />
            <span>
              Foto siap disimpan. Jangan lupa klik tombol{" "}
              <strong>&quot;Simpan Perubahan Bagian Ini&quot;</strong> di bawah
              form!
            </span>
          </div>
        </div>
      ) : (
        <div className="flex aspect-video w-full max-w-md flex-col items-center justify-center rounded-xl border border-dashed border-white/15 bg-slate-900/60 p-4 text-center">
          <Icon name="upload" className="size-8 text-slate-500 mb-2" />
          <p className="text-xs font-semibold text-slate-300">
            Belum ada foto latar khusus
          </p>
          <p className="text-[10px] text-slate-500 mt-0.5">
            Halaman publik saat ini memakai animasi gradien dinamis sekolah.
          </p>
        </div>
      )}

      {/* Pesan Kesalahan */}
      {error ? (
        <div className="flex items-center gap-2 rounded-xl bg-rose-500/10 p-2.5 text-xs font-medium text-rose-300 border border-rose-500/20">
          <Icon name="alert" className="size-4 shrink-0" />
          <span>{error}</span>
        </div>
      ) : null}

      {/* Tombol Aksi Kontrol */}
      <div className="flex flex-wrap items-center gap-2 pt-1">
        <label
          htmlFor="input-hero-image-file"
          className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-bold shadow-md cursor-pointer transition ${
            disabled || isProcessing
              ? "bg-slate-700 text-slate-400 cursor-not-allowed opacity-60"
              : "bg-sky-500 text-slate-950 hover:bg-sky-400 active:scale-95"
          }`}
        >
          <Icon name="upload" className="size-3.5" />
          <span>
            {isProcessing
              ? "Memproses Foto..."
              : hasImage
                ? "Ganti Foto Sekolah"
                : "Pilih Foto Sekolah"}
          </span>
          <input
            id="input-hero-image-file"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={handleFileChange}
            disabled={disabled || isProcessing}
            className="sr-only"
          />
        </label>

        {hasImage && !disabled ? (
          <button
            type="button"
            onClick={handleRemove}
            className="inline-flex items-center gap-1.5 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs font-bold text-rose-300 hover:bg-rose-500/20 transition active:scale-95"
          >
            <Icon name="trash" className="size-3.5" />
            <span>Hapus Foto (Kembali ke Gradien)</span>
          </button>
        ) : null}
      </div>
    </div>
  );
}
