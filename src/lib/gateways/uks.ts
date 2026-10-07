"use client";

import { requestWebApi } from "@/lib/client/api-client";
import { isDesktopRuntime } from "@/lib/runtime/app-runtime";
import { invokeDesktop, kickDesktopSync } from "@/lib/runtime/desktop-commands";
import type {
  BarangInventaris,
  PenerimaInventaris,
} from "@/lib/validations/inventory";
import type {
  BukaDraft,
  DaftarKunjunganUks,
  KunjunganUks,
  ObatKunjungan,
  SimpanDraft,
} from "@/lib/validations/uks";

export type {
  BukaDraft,
  DaftarKunjunganUks,
  KunjunganUks,
  ObatDraft,
  ObatKunjungan,
  SimpanDraft,
} from "@/lib/validations/uks";

export interface FormDataUks {
  personil: PenerimaInventaris["personil"];
  barang: BarangInventaris[];
  tindak_lanjut: string[];
  hari_ini: string;
  /** Sakelar `wa_notify_uks`: kotak centang "Kabari wali" hanya tampil bila menyala. */
  wa_uks_aktif: boolean;
}

/**
 * `wa_diantre`: `null` bila tidak diminta (atau kunjungan sudah pernah ditutup),
 * `false` bila diminta tetapi tidak diantre (sakelar mati, bukan siswa, atau
 * nomor wali kosong/tidak sah), `true` bila satu pesan masuk antrean.
 */
export interface HasilSimpanUks {
  sukses: boolean;
  ditutup: boolean;
  wa_diantre: boolean | null;
}

// Command `desktop_uks_*` terdaftar di biner Desktop DAN Mobile (`uks.rs`
// disalin oleh sync-rust-modules.ts).

export async function getKunjunganUks(
  dari: string,
  sampai: string,
  cari: string | null,
): Promise<DaftarKunjunganUks> {
  if (isDesktopRuntime()) {
    return invokeDesktop<DaftarKunjunganUks>("desktop_uks_list", {
      dari,
      sampai,
      cari,
    });
  }
  return requestWebApi<DaftarKunjunganUks>("/api/uks/query", "POST", {
    dari,
    sampai,
    cari,
  });
}

export async function getFormDataUks(): Promise<FormDataUks> {
  if (isDesktopRuntime()) {
    return invokeDesktop<FormDataUks>("desktop_uks_form_data");
  }
  return requestWebApi<FormDataUks>("/api/uks/form-data", "POST", {});
}

export async function bukaKunjunganUks(
  draft: BukaDraft,
): Promise<{ sukses: boolean; id_kunjungan: string }> {
  if (isDesktopRuntime()) {
    const result = await invokeDesktop<{
      sukses: boolean;
      id_kunjungan: string;
    }>("desktop_uks_open", { draft });
    kickDesktopSync();
    return result;
  }
  return requestWebApi("/api/uks/open", "POST", { draft });
}

/**
 * Kunjungan yang dicatat perangkat lain diambil dulu salinannya dari database
 * (keputusan User), lalu diubah lewat outbox seperti biasa. Di Web semua
 * baris sudah berstatus `lokal`, jadi langkah ini tidak pernah terjadi.
 */
async function pastikanSalinan(kunjungan: KunjunganUks) {
  if (isDesktopRuntime() && !kunjungan.lokal) {
    await invokeDesktop("desktop_uks_adopt", {
      idKunjungan: kunjungan.id_kunjungan,
    });
  }
}

export async function simpanKunjunganUks(
  kunjungan: KunjunganUks,
  draft: SimpanDraft,
): Promise<HasilSimpanUks> {
  if (isDesktopRuntime()) {
    await pastikanSalinan(kunjungan);
    const result = await invokeDesktop<HasilSimpanUks>("desktop_uks_save", {
      idKunjungan: kunjungan.id_kunjungan,
      draft,
    });
    kickDesktopSync();
    return result;
  }
  return requestWebApi("/api/uks/save", "POST", {
    idKunjungan: kunjungan.id_kunjungan,
    draft,
  });
}

export async function hapusKunjunganUks(
  kunjungan: KunjunganUks,
): Promise<{ sukses: boolean }> {
  if (isDesktopRuntime()) {
    await pastikanSalinan(kunjungan);
    const result = await invokeDesktop<{ sukses: boolean }>(
      "desktop_uks_delete",
      {
        idKunjungan: kunjungan.id_kunjungan,
      },
    );
    kickDesktopSync();
    return result;
  }
  return requestWebApi("/api/uks/delete", "POST", {
    idKunjungan: kunjungan.id_kunjungan,
  });
}

export async function getObatKunjunganUks(
  idKunjungan: string,
): Promise<{ obat: ObatKunjungan[] }> {
  if (isDesktopRuntime()) {
    return invokeDesktop<{ obat: ObatKunjungan[] }>("desktop_uks_medicines", {
      idKunjungan,
    });
  }
  return requestWebApi("/api/uks/medicines", "POST", { idKunjungan });
}
