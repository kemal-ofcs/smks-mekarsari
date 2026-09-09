"use client";

import { type ReactNode, useCallback, useRef, useState } from "react";
import { Modal } from "@/components/ui/Modal";

/**
 * Konfirmasi aksi merusak, memakai dialog aplikasi alih-alih `window.confirm`.
 *
 * `window.confirm` punya empat masalah yang semuanya terasa justru pada aksi
 * yang paling perlu dipahami sebelum dijalankan:
 *
 * - Tidak bisa ditata dan tidak mengikuti tema, sehingga muncul sebagai kotak
 *   sistem yang asing di tengah antarmuka gelap aplikasi.
 * - Pada WebView Android tampilannya berbeda dari yang dilihat pengembang di
 *   desktop, jadi kalimat yang muat di satu tempat bisa terpotong di tempat lain.
 * - Hanya menerima teks datar: tidak ada tempat untuk memisahkan apa yang HILANG
 *   dari apa yang TETAP ADA — padahal justru bagian kedua yang paling
 *   menenangkan orang yang jarinya menggantung di atas tombol hapus.
 * - Memblokir seluruh thread render selama dialognya terbuka.
 *
 * Bentuknya sengaja berbasis Promise supaya penggantiannya nyaris satu lawan
 * satu di pemanggil: `if (!window.confirm(...)) return;` menjadi
 * `if (!(await konfirmasi({...}))) return;`. Merestrukturisasi belasan handler
 * menjadi alur dua-fase akan jauh lebih berisiko daripada nilai yang didapat.
 *
 * Modul ini hidup di `lib/hooks` yang IKUT SINKRONISASI, dan mengimpor
 * `@/components/ui/Modal` — jalur yang sama namun berujung pada komponen milik
 * masing-masing workspace. Satu sumber, dua tampilan yang benar.
 */
export interface PermintaanKonfirmasi {
  title: string;
  /** Apa yang akan terjadi bila dilanjutkan. */
  description: ReactNode;
  /**
   * Apa yang TIDAK ikut terhapus.
   *
   * Sering lebih berguna daripada peringatannya sendiri: orang berhenti bukan
   * karena tidak tahu ini berbahaya, melainkan karena tidak tahu seberapa jauh
   * bahayanya.
   */
  preserved?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "danger" | "warning";
}

interface Hasil {
  konfirmasi: (permintaan: PermintaanKonfirmasi) => Promise<boolean>;
  dialogKonfirmasi: ReactNode;
}

export function useConfirmDialog(): Hasil {
  const [permintaan, setPermintaan] = useState<PermintaanKonfirmasi | null>(
    null,
  );
  const penjawab = useRef<((setuju: boolean) => void) | null>(null);

  const konfirmasi = useCallback((baru: PermintaanKonfirmasi) => {
    return new Promise<boolean>((resolve) => {
      // Permintaan yang belum terjawab dijawab "tidak" lebih dulu, supaya
      // tidak ada Promise yang menggantung selamanya bila dua konfirmasi
      // sempat dibuka beruntun.
      penjawab.current?.(false);
      penjawab.current = resolve;
      setPermintaan(baru);
    });
  }, []);

  const jawab = useCallback((setuju: boolean) => {
    const resolve = penjawab.current;
    penjawab.current = null;
    setPermintaan(null);
    resolve?.(setuju);
  }, []);

  const merah = permintaan?.tone !== "warning";

  const dialogKonfirmasi = permintaan ? (
    <Modal
      isOpen
      onClose={() => jawab(false)}
      title={permintaan.title}
      maxWidth="max-w-md"
      footer={
        <div className="flex w-full justify-end gap-2">
          <button
            type="button"
            onClick={() => jawab(false)}
            className="min-h-10 rounded-xl border border-white/15 bg-slate-800 px-4 text-xs font-bold text-slate-300 transition hover:bg-slate-700 active:scale-95"
          >
            {permintaan.cancelLabel ?? "Batal"}
          </button>
          <button
            type="button"
            onClick={() => jawab(true)}
            className={`min-h-10 rounded-xl px-4 text-xs font-black transition active:scale-95 ${
              merah
                ? "bg-rose-500 text-white hover:bg-rose-400"
                : "bg-amber-400 text-slate-950 hover:bg-amber-300"
            }`}
          >
            {permintaan.confirmLabel ?? "Ya, lanjutkan"}
          </button>
        </div>
      }
    >
      <div className="space-y-3 text-xs leading-relaxed">
        <div
          className={`rounded-2xl border p-3 ${
            merah
              ? "border-rose-400/25 bg-rose-400/10 text-rose-100"
              : "border-amber-300/25 bg-amber-300/10 text-amber-100"
          }`}
        >
          {permintaan.description}
        </div>
        {permintaan.preserved ? (
          <div className="rounded-2xl border border-white/10 bg-slate-950/60 p-3 text-slate-300">
            {permintaan.preserved}
          </div>
        ) : null}
      </div>
    </Modal>
  ) : null;

  return { konfirmasi, dialogKonfirmasi };
}
