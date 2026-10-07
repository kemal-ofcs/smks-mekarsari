/**
 * Aturan Buku Kunjungan UKS (Fase 4a), cermin `desktop/uks.rs`. Fungsi di sini
 * diuji dengan vektor yang sama di kedua bahasa (`uks.test.ts` ↔ `mod tests`
 * di `uks.rs`), dan pesan galatnya wajib identik.
 */

import { z } from "zod";
import type { MutasiDraft } from "./inventory";
import { isValidDate } from "./inventory";

export const MAKS_BARIS_RIWAYAT = 500;
export const MAKS_SEDANG_DI_UKS = 200;
export const MAKS_OBAT_PER_SIMPAN = 20;
export const HARI_SIMPAN_LOKAL = 30;
export const UNIT_UKS = "UKS";
export const KEPERLUAN_OBAT = "Kunjungan UKS";

/** Cermin `is_valid_jam`: "HH:MM" 24 jam. */
export function isValidJam(value: string): boolean {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  return match !== null && Number(match[1]) < 24 && Number(match[2]) < 60;
}

function bersih(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed ? trimmed : null;
}

function panjang(value: string | null): number {
  return value === null ? 0 : Array.from(value).length;
}

export type Hasil<T> = { ok: true; value: T } | { ok: false; error: string };

export const obatDraftSchema = z
  .object({
    id_barang: z.string().default(""),
    tempat: z.string().default(""),
    kondisi: z.string().nullish(),
    id_batch: z.string().nullish(),
    jumlah: z.number().int().default(0),
  })
  .strict();

export const bukaDraftSchema = z
  .object({
    id_personil: z.string().default(""),
    tanggal: z.string().nullish(),
    jam_masuk: z.string().nullish(),
    keluhan: z.string().default(""),
    catatan: z.string().nullish(),
    obat: z.array(obatDraftSchema).default([]),
  })
  .strict();

export const simpanDraftSchema = z
  .object({
    jam_keluar: z.string().nullish(),
    tindakan: z.string().nullish(),
    tindak_lanjut: z.string().nullish(),
    catatan: z.string().nullish(),
    obat: z.array(obatDraftSchema).default([]),
    /** Cermin `SimpanDraft.kabari_wali`: berlaku hanya saat kunjungan ditutup. */
    kabari_wali: z.boolean().default(false),
  })
  .strict();

export type ObatDraft = z.input<typeof obatDraftSchema>;
export type BukaDraft = z.input<typeof bukaDraftSchema>;
export type SimpanDraft = z.input<typeof simpanDraftSchema>;
type ObatParsed = z.output<typeof obatDraftSchema>;

export interface BukaValid {
  id_personil: string;
  tanggal: string | null;
  jam_masuk: string | null;
  keluhan: string;
  catatan: string | null;
}

/** Cermin `validate_buka`. Tanggal dan jam kosong diisi jam database WIB. */
export function validateBuka(
  draft: z.output<typeof bukaDraftSchema>,
  hariIni: string,
): Hasil<BukaValid> {
  const id_personil = draft.id_personil.trim();
  if (!id_personil)
    return { ok: false, error: "Pilih personil yang berkunjung." };
  const keluhan = draft.keluhan.trim();
  if (!keluhan) return { ok: false, error: "Keluhan wajib diisi." };
  if (panjang(keluhan) > 500) {
    return { ok: false, error: "Keluhan maksimal 500 karakter." };
  }
  const tanggal = bersih(draft.tanggal);
  if (tanggal !== null) {
    if (!isValidDate(tanggal))
      return { ok: false, error: "Tanggal tidak valid." };
    if (tanggal > hariIni) {
      return { ok: false, error: "Tanggal tidak boleh melewati hari ini." };
    }
  }
  const jam_masuk = bersih(draft.jam_masuk);
  if (jam_masuk !== null && !isValidJam(jam_masuk)) {
    return { ok: false, error: "Jam masuk tidak valid." };
  }
  const catatan = bersih(draft.catatan);
  if (panjang(catatan) > 500) {
    return { ok: false, error: "Catatan maksimal 500 karakter." };
  }
  if (draft.obat.length > MAKS_OBAT_PER_SIMPAN) {
    return { ok: false, error: "Sekali simpan maksimal 20 jenis obat." };
  }
  return {
    ok: true,
    value: { id_personil, tanggal, jam_masuk, keluhan, catatan },
  };
}

export interface SimpanValid {
  jam_keluar: string | null;
  tindakan: string | null;
  tindak_lanjut: string | null;
  catatan: string | null;
}

/** Cermin `validate_simpan`. Mengisi jam keluar berarti menutup kunjungan. */
export function validateSimpan(
  draft: z.output<typeof simpanDraftSchema>,
  jamMasuk: string,
): Hasil<SimpanValid> {
  const jam_keluar = bersih(draft.jam_keluar);
  if (jam_keluar !== null) {
    if (!isValidJam(jam_keluar))
      return { ok: false, error: "Jam keluar tidak valid." };
    if (jam_keluar < jamMasuk) {
      return {
        ok: false,
        error: "Jam keluar tidak boleh lebih awal dari jam masuk.",
      };
    }
  }
  const tindak_lanjut = bersih(draft.tindak_lanjut);
  if (jam_keluar !== null && tindak_lanjut === null) {
    return {
      ok: false,
      error: "Tindak lanjut wajib diisi saat menutup kunjungan.",
    };
  }
  if (panjang(tindak_lanjut) > 200) {
    return { ok: false, error: "Tindak lanjut maksimal 200 karakter." };
  }
  const tindakan = bersih(draft.tindakan);
  if (panjang(tindakan) > 500) {
    return { ok: false, error: "Tindakan maksimal 500 karakter." };
  }
  const catatan = bersih(draft.catatan);
  if (panjang(catatan) > 500) {
    return { ok: false, error: "Catatan maksimal 500 karakter." };
  }
  if (draft.obat.length > MAKS_OBAT_PER_SIMPAN) {
    return { ok: false, error: "Sekali simpan maksimal 20 jenis obat." };
  }
  return { ok: true, value: { jam_keluar, tindakan, tindak_lanjut, catatan } };
}

/**
 * Cermin `obat_ke_mutasi`. Nama siswa SENGAJA tidak masuk mutasi: tabel itu
 * tersalin ke semua perangkat, sedangkan siapa menerima obat apa adalah data
 * kesehatan.
 */
export function obatKeMutasi(obat: ObatParsed): MutasiDraft {
  return {
    id_barang: obat.id_barang,
    jenis: "Keluar",
    alasan: "Pemakaian",
    jumlah: obat.jumlah,
    tempat_asal: obat.tempat,
    kondisi_asal: obat.kondisi ?? null,
    id_batch: obat.id_batch ?? null,
    penerima_tipe: "Unit",
    penerima_nama: UNIT_UKS,
    keperluan: KEPERLUAN_OBAT,
  };
}

/**
 * Teks "sudah berapa lama tidak tersinkron" untuk pemberitahuan offline
 * (permintaan User). `null` berarti perangkat belum pernah tersinkron.
 */
export function formatSejakSync(detik: number | null): string {
  if (detik === null) return "belum pernah tersinkron";
  if (detik < 60) return "baru saja";
  const menit = Math.floor(detik / 60);
  if (menit < 60) return `${menit} menit lalu`;
  const jam = Math.floor(menit / 60);
  if (jam < 48) return `${jam} jam lalu`;
  return `${Math.floor(jam / 24)} hari lalu`;
}

// ── Bentuk data dari backend ────────────────────────────────────────────────

export interface KunjunganUks {
  id_kunjungan: string;
  id_personil: string;
  nama_personil: string;
  kelas: string | null;
  tanggal: string;
  jam_masuk: string;
  jam_keluar: string | null;
  keluhan: string;
  tindakan: string | null;
  tindak_lanjut: string | null;
  catatan: string | null;
  dicatat_oleh: string;
  ditutup_oleh: string | null;
  created_at: string;
  updated_at: string;
  /** Salinannya ada di perangkat ini (selalu benar di Web). */
  lokal: boolean;
  /** Perubahannya belum sampai ke cloud. */
  belum_terkirim: boolean;
}

export interface DaftarKunjunganUks {
  baris: KunjunganUks[];
  sedang: KunjunganUks[];
  /** Cloud tidak terjangkau: hanya salinan di perangkat ini yang tampil. */
  offline: boolean;
  detik_sejak_sync: number | null;
  terpotong: boolean;
}

export interface ObatKunjungan {
  id_mutasi: string;
  nama_barang: string;
  jumlah: number;
  satuan: string;
  tanggal: string;
  dibatalkan: boolean;
}
