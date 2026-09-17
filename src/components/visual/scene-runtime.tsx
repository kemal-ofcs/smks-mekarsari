"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import { useVisualStore } from "@/lib/stores/visual-store";

/**
 * Dua komponen tak-berwujud yang WAJIB ada di setiap `<Canvas>` aplikasi ini.
 *
 * Keduanya dulu disalin ke tiap berkas scene, sehingga perbaikan pada salah
 * satu salinan tidak pernah sampai ke scene lain — padahal justru scene yang
 * jarang dibuka yang paling butuh pembersihan konteksnya.
 */

/**
 * Lepaskan konteks WebGL saat scene di-unmount.
 *
 * Browser hanya mengizinkan segelintir konteks WebGL hidup bersamaan, dan
 * konteks yang ditinggalkan tidak selalu dibersihkan garbage collector tepat
 * waktu. Tanpa ini, berpindah halaman beberapa kali membuat canvas berikutnya
 * gagal dibuat tanpa pesan apa pun.
 */
export function ContextCleanup() {
  const gl = useThree((state) => state.gl);

  useEffect(() => {
    return () => {
      try {
        gl.dispose();
        gl.forceContextLoss();
      } catch {
        // Konteks bisa saja sudah hilang lebih dulu; tidak ada yang perlu dibersihkan.
      }
    };
  }, [gl]);

  return null;
}

/**
 * Menurunkan tier perangkat bila frame rate tertinggal cukup lama.
 * Ambangnya sengaja longgar agar lonjakan sesaat tidak memicu penurunan.
 */
export function AdaptiveQuality() {
  const degrade = useVisualStore((state) => state.degrade);
  const slowSeconds = useRef(0);

  useFrame((_, delta) => {
    if (delta > 1) return; // lompatan besar: tab baru aktif kembali
    if (delta > 1 / 30) {
      slowSeconds.current += delta;
      if (slowSeconds.current > 3) {
        slowSeconds.current = 0;
        degrade();
      }
      return;
    }
    slowSeconds.current = Math.max(slowSeconds.current - delta, 0);
  });

  return null;
}
