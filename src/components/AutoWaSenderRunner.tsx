"use client";

import { useEffect, useRef } from "react";
import { hasPermission } from "@/lib/auth/access";
import { useAuth } from "@/lib/context/AuthContext";
import { drainWaQueueGateway } from "@/lib/gateways/wa-notification";

const AUTO_WA_INTERVAL_MS = 60 * 1000;

/** Ukuran satu batch pengirim: route Web dan `WA_DRAIN_BATCH` di Rust. */
const WA_DRAIN_BATCH = 25;

/**
 * Batas batch beruntun dalam satu siklus (±1.000 pesan). Kuota harian tetap
 * dijaga pengirimnya; ini hanya supaya satu siklus tidak berjalan tanpa ujung.
 */
const MAX_BATCH_PER_SIKLUS = 40;

/**
 * Menguras antrean WhatsApp secara otomatis selama aplikasi terbuka.
 *
 * Hanya berjalan untuk operator yang punya `notification.send`. Apakah pesan
 * benar-benar dikirim diputuskan PENGIRIMNYA (sakelar "Kirim otomatis" di
 * konfigurasi gateway, bawaannya mati), bukan komponen ini — jadi aturannya
 * tidak tersalin ke tiga build. Beberapa sesi boleh berjalan bersamaan: setiap
 * baris diklaim atomik sebelum dikirim (schema v34).
 */
export function AutoWaSenderRunner() {
  const { isAuthenticated, user } = useAuth();
  const bolehKirim =
    isAuthenticated && hasPermission(user, "notification.send");
  const isRunningRef = useRef(false);
  const pesanTerakhirRef = useRef("");

  useEffect(() => {
    if (!bolehKirim) return;

    const kuras = async () => {
      if (isRunningRef.current) return;
      isRunningRef.current = true;
      try {
        // Batch penuh berarti antrean masih tersisa: langsung susul, jangan
        // menunggu satu menit per 25 pesan.
        for (let i = 0; i < MAX_BATCH_PER_SIKLUS; i++) {
          const hasil = await drainWaQueueGateway(true);
          if (
            !hasil.sukses ||
            hasil.skipped_quota ||
            hasil.processed < WA_DRAIN_BATCH
          ) {
            break;
          }
        }
        pesanTerakhirRef.current = "";
      } catch (error) {
        // Tidak mengganggu layar, tetapi tetap terlihat saat didiagnosis.
        // Dicatat sekali per pesan berbeda supaya kegagalan yang sama (mis.
        // database belum diatur) tidak memenuhi konsol setiap menit.
        const pesan = error instanceof Error ? error.message : String(error);
        if (pesan !== pesanTerakhirRef.current) {
          pesanTerakhirRef.current = pesan;
          console.warn("[AutoWaSenderRunner] Kirim otomatis gagal:", pesan);
        }
      } finally {
        isRunningRef.current = false;
      }
    };

    const initialTimer = setTimeout(() => void kuras(), 15_000);
    const intervalTimer = setInterval(() => void kuras(), AUTO_WA_INTERVAL_MS);

    return () => {
      clearTimeout(initialTimer);
      clearInterval(intervalTimer);
    };
  }, [bolehKirim]);

  return null;
}
