/**
 * Aturan Modul Inventaris (Fase 1), cermin `desktop/inventory.rs`.
 *
 * Setiap fungsi di sini punya pasangan Rust dengan nama yang menyebut berkas
 * ini, dan keduanya diuji dengan vektor yang sama (`inventory.test.ts` ↔
 * `mod tests` di `inventory.rs`). Pesan galatnya pun wajib identik.
 */

import { z } from "zod";

export const TIPE_BARANG = ["Aset", "Habis Pakai"] as const;
export const JENIS_MUTASI = ["Masuk", "Keluar", "Pindah"] as const;
/** WAJIB sama dengan CHECK `inventory_mutasi.alasan` di ketiga DDL. */
export const ALASAN_MUTASI = [
  "Saldo Awal",
  "Pengadaan",
  "Hibah",
  "Pengembalian",
  "Pemakaian",
  "Peminjaman",
  "Rusak/Afkir",
  "Hilang",
  "Kedaluwarsa",
  "Distribusi",
  "Perubahan Kondisi",
  "Selisih Opname",
  "Pembatalan",
] as const;
export const KONDISI_BARANG = ["Baik", "Rusak Ringan", "Rusak Berat"] as const;
export const PENERIMA_TIPE = ["Personil", "Rombel", "Unit", "Umum"] as const;
/** Alasan yang bisa dicatat dari formulir umum di Fase 1. */
/**
 * Alasan yang bisa dicatat lewat `recordMutation`. Selisih Opname hanya lewat
 * `recordOpname`, dan Pembatalan hanya lewat `cancelMutation`.
 */
export const ALASAN_FORMULIR = [
  "Saldo Awal",
  "Pengadaan",
  "Hibah",
  "Pemakaian",
  "Peminjaman",
  "Pengembalian",
  "Rusak/Afkir",
  "Hilang",
  "Kedaluwarsa",
  "Distribusi",
  "Perubahan Kondisi",
] as const;
export const MAKS_JUMLAH = 1_000_000;
export const MAKS_HARGA_SATUAN = 1_000_000_000_000;
export const MAKS_PANJANG_TEMPAT = 80;
export const MAKS_BARIS_KARTU_STOK = 1000;
export const MAKS_BARIS_OPNAME = 500;
export const MAKS_BARIS_PINJAMAN = 500;
export const MAKS_BARIS_DOKUMEN = 500;
export const MAKS_BARIS_PENGADAAN = 5000;
/** Cermin `INVENTORY_EXPIRY_WARNING_DAYS` (keputusan User, PRD §4.7). */
export const INVENTORY_EXPIRY_WARNING_DAYS = 30;

export type IzinInventaris = "inventory.record" | "inventory.adjust";
export type StatusKedaluwarsa = "Aman" | "Waspada" | "Kedaluwarsa";

/**
 * Cermin `izin_untuk_alasan`. Pembatalan, opname, dan penghapusan stok
 * mengurangi stok tanpa barangnya diterima siapa pun, jadi butuh izin sensitif.
 */
export function izinUntukAlasan(alasan: string): IzinInventaris {
  return [
    "Rusak/Afkir",
    "Hilang",
    "Kedaluwarsa",
    "Selisih Opname",
    "Pembatalan",
  ].includes(alasan)
    ? "inventory.adjust"
    : "inventory.record";
}

/** Cermin `status_kedaluwarsa`. Hari H tanggal kedaluwarsa masih Waspada. */
export function statusKedaluwarsa(sisaHari: number): StatusKedaluwarsa {
  if (sisaHari < 0) return "Kedaluwarsa";
  return sisaHari <= INVENTORY_EXPIRY_WARNING_DAYS ? "Waspada" : "Aman";
}

export type JenisBeritaAcara = "Serah Terima" | "Pemusnahan" | "Opname";

/** Cermin `jenis_berita_acara`. `null` = alasan ini tidak punya berita acara. */
export function jenisBeritaAcara(alasan: string): JenisBeritaAcara | null {
  if (["Pemakaian", "Peminjaman", "Distribusi"].includes(alasan))
    return "Serah Terima";
  if (["Kedaluwarsa", "Rusak/Afkir", "Hilang"].includes(alasan))
    return "Pemusnahan";
  return alasan === "Selisih Opname" ? "Opname" : null;
}

export const SUMBER_DANA_KOSONG = "Tanpa sumber dana";

export interface RekapSumberDana {
  sumber_dana: string;
  baris: number;
  nilai: number;
  tanpa_harga: number;
}

/**
 * Cermin `rekap_sumber_dana`. Baris tanpa harga dihitung terpisah supaya total
 * nilai tidak terlihat lengkap padahal tidak.
 */
export function rekapSumberDana(
  rows: readonly { sumber_dana: string; nilai: number; tanpa_harga: boolean }[],
): RekapSumberDana[] {
  const hasil: RekapSumberDana[] = [];
  for (const row of rows) {
    const nama = row.sumber_dana.trim() || SUMBER_DANA_KOSONG;
    let rekap = hasil.find((item) => item.sumber_dana === nama);
    if (!rekap) {
      rekap = { sumber_dana: nama, baris: 0, nilai: 0, tanpa_harga: 0 };
      hasil.push(rekap);
    }
    rekap.baris += 1;
    rekap.nilai += row.nilai;
    if (row.tanpa_harga) rekap.tanpa_harga += 1;
  }
  return hasil;
}

/** Cermin `stok_menipis`. Stok minimum 0 berarti barang ini tidak dipantau. */
export function stokMenipis(stokBaik: number, stokMinimum: number): boolean {
  return stokMinimum > 0 && stokBaik < stokMinimum;
}
/** Daftar awalan kode barang di `setting_gex_system`, ikut sync. */
export const KODE_PREFIX_SETTING_KEY = "inventory_kode_prefix";
export const KODE_PREFIX_BAWAAN = "BRG";
export const MAKS_KODE_PREFIX = 20;

/** Cermin `normalize_kode_prefix`: 1 sampai 6 huruf atau angka, huruf besar. */
export function normalizeKodePrefix(raw: string): string | null {
  const value = asciiUpper(raw.trim());
  return /^[A-Z0-9]{1,6}$/.test(value) ? value : null;
}

/** Huruf besar ASCII saja, cermin `to_ascii_uppercase` di Rust. */
function asciiUpper(value: string): string {
  return value.replace(/[a-z]/g, (char) => char.toUpperCase());
}

/**
 * Cermin `parse_kode_prefixes`. Nilai tersimpan yang rusak tidak boleh
 * mematikan penambahan barang: entri rusak dibuang, kosong kembali ke bawaan.
 */
export function parseKodePrefixes(stored: string | null | undefined): string[] {
  const list: string[] = [];
  let parsed: unknown = null;
  try {
    parsed = stored ? JSON.parse(stored) : null;
  } catch {
    parsed = null;
  }
  if (Array.isArray(parsed)) {
    for (const item of parsed) {
      const prefix =
        typeof item === "string" ? normalizeKodePrefix(item) : null;
      if (prefix && !list.includes(prefix) && list.length < MAKS_KODE_PREFIX) {
        list.push(prefix);
      }
    }
  }
  return list.length > 0 ? list : [KODE_PREFIX_BAWAAN];
}

/** Cermin `validate_kode_prefixes`. */
export function validateKodePrefixes(raw: readonly string[]): Hasil<string[]> {
  if (raw.length === 0) {
    return { ok: false, error: "Daftarkan minimal satu awalan kode." };
  }
  if (raw.length > MAKS_KODE_PREFIX) {
    return { ok: false, error: "Awalan kode maksimal 20." };
  }
  const list: string[] = [];
  for (const item of raw) {
    const prefix = normalizeKodePrefix(item);
    if (prefix === null) {
      return {
        ok: false,
        error: `Awalan "${item.trim()}" tidak valid. Gunakan 1 sampai 6 huruf atau angka.`,
      };
    }
    if (list.includes(prefix)) {
      return { ok: false, error: `Awalan "${prefix}" terdaftar dua kali.` };
    }
    list.push(prefix);
  }
  return { ok: true, value: list };
}

/**
 * Cermin `next_kode_number`: nomor terbesar + 1. Hanya kode berbentuk
 * `AWALAN-angka` yang dihitung, jadi `UKS-LEMARI` tidak mengganggu urutan.
 */
export function nomorKodeBerikutnya(
  prefix: string,
  existing: readonly string[],
): number {
  const head = `${prefix}-`;
  let max = 0;
  for (const kode of existing) {
    const upper = asciiUpper(kode.trim());
    if (!upper.startsWith(head)) continue;
    const nomor = upper.slice(head.length);
    if (/^[0-9]{1,9}$/.test(nomor)) max = Math.max(max, Number(nomor));
  }
  return max + 1;
}

/** Cermin `format_kode_barang`: `UKS-0001`. */
export function formatKodeBarang(prefix: string, nomor: number): string {
  return `${prefix}-${String(nomor).padStart(4, "0")}`;
}

export type TipeBarang = (typeof TIPE_BARANG)[number];
export type JenisMutasi = (typeof JENIS_MUTASI)[number];
export type KondisiBarang = (typeof KONDISI_BARANG)[number];
export type PenerimaTipe = (typeof PENERIMA_TIPE)[number];

const ALASAN_PER_JENIS: Record<JenisMutasi, readonly string[]> = {
  Masuk: [
    "Saldo Awal",
    "Pengadaan",
    "Hibah",
    "Pengembalian",
    "Selisih Opname",
    "Pembatalan",
  ],
  Keluar: [
    "Pemakaian",
    "Peminjaman",
    "Rusak/Afkir",
    "Hilang",
    "Kedaluwarsa",
    "Selisih Opname",
    "Pembatalan",
  ],
  Pindah: ["Distribusi", "Perubahan Kondisi", "Pembatalan"],
};

export function alasanSahUntuk(jenis: string): readonly string[] {
  return (JENIS_MUTASI as readonly string[]).includes(jenis)
    ? ALASAN_PER_JENIS[jenis as JenisMutasi]
    : [];
}

/** Cermin `normalize_tempat`. */
export function normalizeTempat(raw: string): string {
  return raw.split(/\s+/).filter(Boolean).join(" ");
}

/** Huruf kecil ASCII saja, sama dengan `LOWER()` SQLite dan `ascii_lower`. */
export function asciiLower(value: string): string {
  return value.replace(/[A-Z]/g, (char) => char.toLowerCase());
}

/** Cermin `is_valid_date`. */
export function isValidDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1900 || month < 1 || month > 12) return false;
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const maxDay =
    month === 2 ? (leap ? 29 : 28) : [4, 6, 9, 11].includes(month) ? 30 : 31;
  return day >= 1 && day <= maxDay;
}

function panjang(value: string): number {
  return Array.from(value).length;
}

function bersih(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed ? trimmed : null;
}

function bersihTempat(value: string | null | undefined): string | null {
  const normalized = normalizeTempat(value ?? "");
  return normalized ? normalized : null;
}

function terlaluPanjang(value: string | null, max: number): boolean {
  return value !== null && panjang(value) > max;
}

// ── Barang ──────────────────────────────────────────────────────────────────

export const barangDraftSchema = z
  .object({
    id_barang: z.string().nullish(),
    kode_barang: z.string().nullish(),
    kode_prefix: z.string().nullish(),
    nama_barang: z.string().default(""),
    kategori: z.string().nullish(),
    tipe: z.string().default(""),
    satuan: z.string().default(""),
    bisa_expired: z.boolean().default(false),
    stok_minimum: z.number().int().default(0),
    tempat_utama: z.string().nullish(),
    catatan: z.string().nullish(),
    status_aktif: z.boolean().default(true),
  })
  .strict();

export type BarangDraft = z.input<typeof barangDraftSchema>;
type BarangDraftParsed = z.output<typeof barangDraftSchema>;

export interface BarangValid {
  kode_barang: string | null;
  nama_barang: string;
  kategori: string | null;
  tipe: TipeBarang;
  satuan: string;
  bisa_expired: boolean;
  stok_minimum: number;
  tempat_utama: string | null;
  catatan: string | null;
  status_aktif: boolean;
}

export type Hasil<T> = { ok: true; value: T } | { ok: false; error: string };

/** Cermin `validate_barang`. */
export function validateBarang(draft: BarangDraftParsed): Hasil<BarangValid> {
  const kode_barang = bersih(draft.kode_barang);
  if (terlaluPanjang(kode_barang, 30)) {
    return { ok: false, error: "Kode barang maksimal 30 karakter." };
  }
  const nama_barang = draft.nama_barang.trim();
  if (!nama_barang) return { ok: false, error: "Nama barang wajib diisi." };
  if (panjang(nama_barang) > 120) {
    return { ok: false, error: "Nama barang maksimal 120 karakter." };
  }
  const kategori = bersihTempat(draft.kategori);
  if (terlaluPanjang(kategori, 60)) {
    return { ok: false, error: "Kategori maksimal 60 karakter." };
  }
  if (!(TIPE_BARANG as readonly string[]).includes(draft.tipe)) {
    return { ok: false, error: "Tipe barang tidak dikenal." };
  }
  const satuan = draft.satuan.trim();
  if (!satuan) return { ok: false, error: "Satuan wajib diisi." };
  if (panjang(satuan) > 20) {
    return { ok: false, error: "Satuan maksimal 20 karakter." };
  }
  if (draft.stok_minimum < 0 || draft.stok_minimum > MAKS_JUMLAH) {
    return { ok: false, error: "Stok minimum tidak valid." };
  }
  const tempat_utama = bersihTempat(draft.tempat_utama);
  if (terlaluPanjang(tempat_utama, MAKS_PANJANG_TEMPAT)) {
    return { ok: false, error: "Nama tempat maksimal 80 karakter." };
  }
  const catatan = bersih(draft.catatan);
  if (terlaluPanjang(catatan, 500)) {
    return { ok: false, error: "Catatan maksimal 500 karakter." };
  }
  return {
    ok: true,
    value: {
      kode_barang,
      nama_barang,
      kategori,
      tipe: draft.tipe as TipeBarang,
      satuan,
      bisa_expired: draft.bisa_expired,
      stok_minimum: draft.stok_minimum,
      tempat_utama,
      catatan,
      status_aktif: draft.status_aktif,
    },
  };
}

// ── Mutasi ──────────────────────────────────────────────────────────────────

export const mutasiDraftSchema = z
  .object({
    id_barang: z.string().default(""),
    jenis: z.string().default(""),
    alasan: z.string().default(""),
    tanggal: z.string().nullish(),
    jumlah: z.number().int().default(0),
    tempat_asal: z.string().nullish(),
    kondisi_asal: z.string().nullish(),
    tempat_tujuan: z.string().nullish(),
    kondisi_tujuan: z.string().nullish(),
    id_batch: z.string().nullish(),
    tanggal_expired: z.string().nullish(),
    id_ref: z.string().nullish(),
    penerima_tipe: z.string().nullish(),
    penerima_id: z.string().nullish(),
    penerima_nama: z.string().nullish(),
    keperluan: z.string().nullish(),
    sumber_dana: z.string().nullish(),
    nomor_dokumen: z.string().nullish(),
    harga_satuan: z.number().int().nullish(),
    catatan: z.string().nullish(),
  })
  .strict();

export type MutasiDraft = z.input<typeof mutasiDraftSchema>;
export type MutasiDraftParsed = z.output<typeof mutasiDraftSchema>;

export interface BarangInfo {
  tipe: string;
  bisa_expired: boolean;
}

export interface MutasiValid {
  jenis: JenisMutasi;
  alasan: string;
  tanggal: string;
  jumlah: number;
  tempat_asal: string | null;
  kondisi_asal: string | null;
  tempat_tujuan: string | null;
  kondisi_tujuan: string | null;
  id_batch: string | null;
  tanggal_expired: string | null;
  id_ref: string | null;
  penerima_tipe: PenerimaTipe | null;
  penerima_id: string | null;
  penerima_nama: string | null;
  keperluan: string | null;
  sumber_dana: string | null;
  nomor_dokumen: string | null;
  harga_satuan: number | null;
  catatan: string | null;
}

class GalatValidasi extends Error {}

function kondisiUntuk(
  barang: BarangInfo,
  raw: string | null | undefined,
): string {
  if (barang.tipe === "Habis Pakai") return "Baik";
  const value = bersih(raw);
  if (value === null) return "Baik";
  if ((KONDISI_BARANG as readonly string[]).includes(value)) return value;
  throw new GalatValidasi("Kondisi barang tidak dikenal.");
}

function tempatWajib(raw: string | null | undefined, pesan: string): string {
  const tempat = bersihTempat(raw);
  if (tempat === null) throw new GalatValidasi(pesan);
  if (panjang(tempat) > MAKS_PANJANG_TEMPAT) {
    throw new GalatValidasi("Nama tempat maksimal 80 karakter.");
  }
  return tempat;
}

/**
 * Cermin `validate_mutation`. Murni: saldo, batch, dan nama penerima
 * diperiksa di service karena butuh database.
 */
export function validateMutasi(
  draft: MutasiDraftParsed,
  barang: BarangInfo,
  hariIni: string,
): Hasil<MutasiValid> {
  try {
    return { ok: true, value: susunMutasi(draft, barang, hariIni) };
  } catch (error) {
    if (error instanceof GalatValidasi)
      return { ok: false, error: error.message };
    throw error;
  }
}

function susunMutasi(
  draft: MutasiDraftParsed,
  barang: BarangInfo,
  hariIni: string,
): MutasiValid {
  const jenis = draft.jenis;
  if (!(JENIS_MUTASI as readonly string[]).includes(jenis)) {
    throw new GalatValidasi("Jenis mutasi tidak dikenal.");
  }
  if (!alasanSahUntuk(jenis).includes(draft.alasan)) {
    throw new GalatValidasi("Alasan tidak berlaku untuk jenis mutasi ini.");
  }
  if (draft.jumlah < 1 || draft.jumlah > MAKS_JUMLAH) {
    throw new GalatValidasi("Jumlah harus bilangan bulat 1 sampai 1.000.000.");
  }
  const tanggal = bersih(draft.tanggal) ?? hariIni;
  if (!isValidDate(tanggal)) throw new GalatValidasi("Tanggal tidak valid.");
  if (tanggal > hariIni) {
    throw new GalatValidasi("Tanggal tidak boleh melewati hari ini.");
  }

  const valid: MutasiValid = {
    jenis: jenis as JenisMutasi,
    alasan: draft.alasan,
    tanggal,
    jumlah: draft.jumlah,
    tempat_asal: null,
    kondisi_asal: null,
    tempat_tujuan: null,
    kondisi_tujuan: null,
    id_batch: null,
    tanggal_expired: null,
    id_ref: null,
    penerima_tipe: null,
    penerima_id: null,
    penerima_nama: null,
    keperluan: null,
    sumber_dana: null,
    nomor_dokumen: null,
    harga_satuan: null,
    catatan: null,
  };

  if (jenis === "Keluar" || jenis === "Pindah") {
    valid.tempat_asal = tempatWajib(
      draft.tempat_asal,
      "Tempat asal wajib diisi.",
    );
    valid.kondisi_asal = kondisiUntuk(barang, draft.kondisi_asal);
  }
  if (jenis === "Masuk" || jenis === "Pindah") {
    valid.tempat_tujuan = tempatWajib(
      draft.tempat_tujuan,
      "Tempat tujuan wajib diisi.",
    );
    valid.kondisi_tujuan = kondisiUntuk(barang, draft.kondisi_tujuan);
  }
  if (
    jenis === "Pindah" &&
    asciiLower(valid.tempat_asal ?? "") ===
      asciiLower(valid.tempat_tujuan ?? "") &&
    valid.kondisi_asal === valid.kondisi_tujuan
  ) {
    throw new GalatValidasi(
      "Tempat atau kondisi tujuan harus berbeda dari asal.",
    );
  }

  if (valid.alasan === "Pengembalian") {
    const ref = bersih(draft.id_ref);
    if (ref === null) {
      throw new GalatValidasi("Pilih peminjaman yang dikembalikan.");
    }
    valid.id_ref = ref;
  }

  if (barang.bisa_expired) {
    if (jenis === "Masuk" && valid.alasan === "Pengembalian") {
      // Batch asal diambil dari mutasi Peminjaman di service, bukan payload.
    } else if (jenis === "Masuk" && valid.alasan === "Selisih Opname") {
      const batch = bersih(draft.id_batch);
      if (batch === null) {
        throw new GalatValidasi("Pilih batch tujuan barang ini.");
      }
      valid.id_batch = batch;
    } else if (jenis === "Masuk") {
      const expired = bersih(draft.tanggal_expired);
      if (expired === null) {
        throw new GalatValidasi(
          "Tanggal kedaluwarsa wajib diisi untuk barang ini.",
        );
      }
      if (!isValidDate(expired)) {
        throw new GalatValidasi("Tanggal kedaluwarsa tidak valid.");
      }
      valid.tanggal_expired = expired;
    } else {
      const batch = bersih(draft.id_batch);
      if (batch === null) {
        throw new GalatValidasi("Pilih batch barang yang dikeluarkan.");
      }
      valid.id_batch = batch;
    }
  }

  if (valid.alasan === "Pemakaian" || valid.alasan === "Peminjaman") {
    const tipe = bersih(draft.penerima_tipe);
    if (tipe === null) throw new GalatValidasi("Pilih tipe penerima.");
    if (!(PENERIMA_TIPE as readonly string[]).includes(tipe)) {
      throw new GalatValidasi("Tipe penerima tidak dikenal.");
    }
    if (tipe === "Personil" || tipe === "Rombel") {
      const id = bersih(draft.penerima_id);
      if (id === null) throw new GalatValidasi("Pilih penerima.");
      valid.penerima_id = id;
    } else if (tipe === "Unit") {
      const nama = bersihTempat(draft.penerima_nama);
      if (nama === null) {
        throw new GalatValidasi("Nama unit penerima wajib diisi.");
      }
      if (panjang(nama) > MAKS_PANJANG_TEMPAT) {
        throw new GalatValidasi("Nama unit penerima maksimal 80 karakter.");
      }
      valid.penerima_nama = nama;
    } else {
      valid.penerima_nama = "Umum";
    }
    valid.penerima_tipe = tipe as PenerimaTipe;
    if (bersih(draft.keperluan) === null) {
      throw new GalatValidasi("Keperluan wajib diisi.");
    }
  }
  valid.keperluan = bersih(draft.keperluan);
  if (terlaluPanjang(valid.keperluan, 200)) {
    throw new GalatValidasi("Keperluan maksimal 200 karakter.");
  }

  if (jenis === "Masuk") {
    if (draft.harga_satuan !== null && draft.harga_satuan !== undefined) {
      if (draft.harga_satuan < 0 || draft.harga_satuan > MAKS_HARGA_SATUAN) {
        throw new GalatValidasi("Harga satuan tidak valid.");
      }
      valid.harga_satuan = draft.harga_satuan;
    }
    valid.sumber_dana = bersih(draft.sumber_dana);
    if (terlaluPanjang(valid.sumber_dana, 60)) {
      throw new GalatValidasi("Sumber dana maksimal 60 karakter.");
    }
  }
  valid.nomor_dokumen = bersih(draft.nomor_dokumen);
  if (terlaluPanjang(valid.nomor_dokumen, 60)) {
    throw new GalatValidasi("Nomor dokumen maksimal 60 karakter.");
  }
  valid.catatan = bersih(draft.catatan);
  if (terlaluPanjang(valid.catatan, 500)) {
    throw new GalatValidasi("Catatan maksimal 500 karakter.");
  }
  return valid;
}

// ── Opname ──────────────────────────────────────────────────────────────────

export const opnameDraftSchema = z
  .object({
    tempat: z.string().default(""),
    baris: z
      .array(
        z
          .object({
            id_barang: z.string().default(""),
            kondisi: z.string().nullish(),
            id_batch: z.string().nullish(),
            fisik: z.number().int().default(0),
          })
          .strict(),
      )
      .default([]),
    catatan: z.string().nullish(),
  })
  .strict();

export type OpnameDraft = z.input<typeof opnameDraftSchema>;
type OpnameDraftParsed = z.output<typeof opnameDraftSchema>;

export interface OpnameBaris {
  id_barang: string;
  kondisi: string;
  id_batch: string | null;
  fisik: number;
}

export interface OpnameValid {
  tempat: string;
  baris: OpnameBaris[];
  catatan: string | null;
}

/** Cermin `validate_opname`. Saldo sistem dihitung ulang saat menyimpan. */
export function validateOpname(draft: OpnameDraftParsed): Hasil<OpnameValid> {
  const tempat = bersihTempat(draft.tempat);
  if (tempat === null)
    return { ok: false, error: "Pilih tempat yang diopname." };
  if (panjang(tempat) > MAKS_PANJANG_TEMPAT) {
    return { ok: false, error: "Nama tempat maksimal 80 karakter." };
  }
  if (draft.baris.length === 0) {
    return { ok: false, error: "Belum ada barang yang dihitung." };
  }
  if (draft.baris.length > MAKS_BARIS_OPNAME) {
    return { ok: false, error: "Satu opname maksimal 500 baris." };
  }
  const baris: OpnameBaris[] = [];
  for (const item of draft.baris) {
    const id_barang = item.id_barang.trim();
    if (!id_barang) {
      return { ok: false, error: "Barang pada baris opname tidak valid." };
    }
    const kondisi = bersih(item.kondisi) ?? "Baik";
    if (!(KONDISI_BARANG as readonly string[]).includes(kondisi)) {
      return { ok: false, error: "Kondisi barang tidak dikenal." };
    }
    if (item.fisik < 0 || item.fisik > MAKS_JUMLAH) {
      return { ok: false, error: "Jumlah fisik harus 0 sampai 1.000.000." };
    }
    const id_batch = bersih(item.id_batch);
    if (
      baris.some(
        (known) =>
          known.id_barang === id_barang &&
          known.kondisi === kondisi &&
          known.id_batch === id_batch,
      )
    ) {
      return {
        ok: false,
        error: "Barang yang sama tercatat dua kali dalam opname ini.",
      };
    }
    baris.push({ id_barang, kondisi, id_batch, fisik: item.fisik });
  }
  const catatan = bersih(draft.catatan);
  if (terlaluPanjang(catatan, 500)) {
    return { ok: false, error: "Catatan maksimal 500 karakter." };
  }
  return { ok: true, value: { tempat, baris, catatan } };
}

export interface MutasiAsal {
  id_mutasi: string;
  jenis: string;
  alasan: string;
  jumlah: number;
  tempat_asal: string | null;
  kondisi_asal: string | null;
  tempat_tujuan: string | null;
  kondisi_tujuan: string | null;
  id_batch: string | null;
}

export function idPembatalan(idMutasi: string): string {
  return `batal-${idMutasi}`;
}

/** Cermin `build_cancellation`. */
export function susunPembatalan(asal: MutasiAsal): Hasil<MutasiAsal> {
  if (asal.alasan === "Pembatalan") {
    return { ok: false, error: "Pembatalan tidak bisa dibatalkan lagi." };
  }
  const jenis =
    asal.jenis === "Masuk"
      ? "Keluar"
      : asal.jenis === "Keluar"
        ? "Masuk"
        : asal.jenis === "Pindah"
          ? "Pindah"
          : null;
  if (jenis === null)
    return { ok: false, error: "Jenis mutasi tidak dikenal." };
  return {
    ok: true,
    value: {
      id_mutasi: idPembatalan(asal.id_mutasi),
      jenis,
      alasan: "Pembatalan",
      jumlah: asal.jumlah,
      tempat_asal: asal.tempat_tujuan,
      kondisi_asal: asal.kondisi_tujuan,
      tempat_tujuan: asal.tempat_asal,
      kondisi_tujuan: asal.kondisi_asal,
      id_batch: asal.id_batch,
    },
  };
}

// ── Bentuk data yang dikirim backend ke UI ──────────────────────────────────

export interface PosisiStok {
  tempat: string;
  kondisi: KondisiBarang;
  id_batch: string | null;
  saldo: number;
  tanggal_expired: string | null;
  sisa_hari: number | null;
  status_kedaluwarsa: StatusKedaluwarsa | null;
}

export interface BarangInventaris {
  id_barang: string;
  kode_barang: string;
  nama_barang: string;
  kategori: string | null;
  tipe: TipeBarang;
  satuan: string;
  bisa_expired: boolean;
  stok_minimum: number;
  tempat_utama: string | null;
  catatan: string | null;
  status_aktif: boolean;
  /** Kode yang sama dipakai barang lain, biasanya dari dua perangkat offline. */
  kode_ganda: boolean;
  stok_total: number;
  stok_baik: number;
  stok_menipis: boolean;
  posisi: PosisiStok[];
}

export interface DaftarInventaris {
  barang: BarangInventaris[];
  tempat: string[];
  kategori: string[];
  kode_prefix: string[];
  /** Tanggal operasional WIB menurut database, bukan jam perangkat. */
  hari_ini: string;
  /** Dicetak di label QR. */
  nama_sekolah: string | null;
}

export interface PenerimaInventaris {
  personil: {
    id: string;
    nama: string;
    jenis: string | null;
    kelas: string | null;
  }[];
  rombel: { id: string; nama: string }[];
}

export interface BarisKartuStok {
  id_mutasi: string;
  tanggal: string;
  jenis: JenisMutasi;
  alasan: string;
  jumlah: number;
  tempat_asal: string | null;
  kondisi_asal: string | null;
  tempat_tujuan: string | null;
  kondisi_tujuan: string | null;
  id_batch: string | null;
  tanggal_expired: string | null;
  id_ref: string | null;
  penerima_tipe: string | null;
  penerima_nama: string | null;
  keperluan: string | null;
  sumber_dana: string | null;
  nomor_dokumen: string | null;
  harga_satuan: number | null;
  catatan: string | null;
  dicatat_oleh: string;
  created_at: string;
  dibatalkan: boolean;
  masuk: number;
  keluar: number;
  saldo: number;
}

export interface PinjamanAktif {
  id_mutasi: string;
  id_barang: string;
  nama_barang: string;
  kode_barang: string;
  satuan: string;
  tipe: TipeBarang;
  tanggal: string;
  jumlah: number;
  tempat_asal: string | null;
  kondisi_asal: string | null;
  id_batch: string | null;
  penerima_tipe: string | null;
  penerima_nama: string | null;
  keperluan: string | null;
  kembali: number;
  sisa: number;
  lama_hari: number;
}

export interface DaftarPinjaman {
  baris: PinjamanAktif[];
  terpotong: boolean;
}

export interface KopSekolah {
  nama?: string | null;
  cabang?: string | null;
  logo_url?: string | null;
  alamat?: string | null;
  telepon?: string | null;
  email?: string | null;
  website?: string | null;
  kepala_nama?: string | null;
  kepala_jabatan?: string | null;
  kepala_nip?: string | null;
}

export interface BarisDokumen {
  id_mutasi: string;
  tanggal: string;
  alasan: string;
  jumlah: number;
  tempat_asal: string | null;
  kondisi_asal: string | null;
  tempat_tujuan: string | null;
  kondisi_tujuan: string | null;
  tanggal_expired: string | null;
  penerima_nama: string | null;
  keperluan: string | null;
  catatan: string | null;
  dicatat_oleh: string;
  nama_barang: string;
  kode_barang: string;
  satuan: string;
}

export interface DokumenInventaris {
  jenis: JenisBeritaAcara;
  nomor_dokumen: string | null;
  tanggal: string | null;
  dicatat_oleh: string | null;
  penerima_nama: string | null;
  kop: KopSekolah;
  baris: BarisDokumen[];
  terpotong: boolean;
}

export interface RiwayatOpname {
  nomor_dokumen: string;
  tanggal: string;
  tempat: string | null;
  jumlah_selisih: number;
  dicatat_oleh: string;
  id_mutasi: string;
}

export interface BarisPengadaan {
  tanggal: string;
  kode_barang: string;
  nama_barang: string;
  satuan: string;
  alasan: string;
  jumlah: number;
  harga_satuan: number | null;
  sumber_dana: string;
  nomor_dokumen: string | null;
  tempat_tujuan: string | null;
  nilai: number;
}

export interface RekapPengadaan {
  baris: BarisPengadaan[];
  rekap: RekapSumberDana[];
  total_nilai: number;
  terpotong: boolean;
}

export interface KartuStok {
  saldo_awal: number;
  baris: BarisKartuStok[];
  terpotong: boolean;
}

// ── Label QR ────────────────────────────────────────────────────────────────

/**
 * Isi QR label barang: `INV:<id_barang>`. Id dipakai, bukan kode, karena kode
 * bisa diubah setelah label ditempel dan bisa kembar antara dua perangkat
 * offline. Sengaja tanpa `|`, sehingga terminal absensi menolaknya sebagai
 * format tidak sah SEBELUM menulis `log_scan`.
 */
export const AWALAN_LABEL_INVENTARIS = "INV:";

export function isiLabelInventaris(idBarang: string): string {
  return `${AWALAN_LABEL_INVENTARIS}${idBarang}`;
}

/**
 * Baca hasil pindai label, atau kode barang yang diketik sebagai cadangan
 * (pemindai USB pun mengetik isinya lalu Enter).
 */
export function bacaLabelInventaris<
  B extends { id_barang: string; kode_barang: string },
>(teks: string, barang: readonly B[]): Hasil<B> {
  const bersih = teks.trim();
  if (!bersih) {
    return { ok: false, error: "Pindai label atau ketik kode barang." };
  }
  if (asciiLower(bersih.slice(0, AWALAN_LABEL_INVENTARIS.length)) === "inv:") {
    const id = bersih.slice(AWALAN_LABEL_INVENTARIS.length).trim();
    const cocok = barang.find((b) => b.id_barang === id);
    return cocok
      ? { ok: true, value: cocok }
      : {
          ok: false,
          error:
            "Label ini tidak dikenal. Barangnya mungkin sudah dihapus, atau labelnya milik sekolah lain.",
        };
  }
  if (bersih.includes("|")) {
    return { ok: false, error: "Ini kartu absensi, bukan label inventaris." };
  }
  const kunci = asciiLower(bersih);
  const cocok = barang.filter((b) => asciiLower(b.kode_barang) === kunci);
  if (cocok.length === 1 && cocok[0]) return { ok: true, value: cocok[0] };
  return {
    ok: false,
    error:
      cocok.length > 1
        ? `Kode ${bersih} dipakai lebih dari satu barang. Pindai labelnya atau pilih dari daftar.`
        : `Tidak ada barang berkode ${bersih}.`,
  };
}

/**
 * Apa yang terjadi pada daftar hitung opname saat sebuah label dipindai.
 * - Aset: +1 ke baris kondisi Baik. Pindaian pertama memulai dari 1, bukan
 *   dari saldo sistem, karena yang dihitung adalah unit yang benar-benar ada.
 * - Habis Pakai: hanya melompat ke isian jumlahnya; label obat ditempel di
 *   rak, bukan di tiap bungkus, dan tidak membedakan batch.
 * - Tidak ada barisnya di tempat ini: ditawarkan sebagai barang ditemukan.
 * Baris yang tidak pernah dipindai tidak disentuh, jadi tetap sesuai sistem.
 */
export type AksiPindaiOpname =
  | { jenis: "hitung"; kunci: string; fisik: number }
  | { jenis: "fokus"; kunci: string }
  | { jenis: "baru" };

export function aksiPindaiOpname(
  baris: readonly {
    kunci: string;
    barang: { id_barang: string };
    kondisi: string;
    fisik: string;
    dipindai: boolean;
  }[],
  barang: { id_barang: string; tipe: TipeBarang },
): AksiPindaiOpname {
  const milik = baris.filter((b) => b.barang.id_barang === barang.id_barang);
  if (barang.tipe === "Aset") {
    const baik = milik.find((b) => b.kondisi === "Baik");
    if (!baik) return { jenis: "baru" };
    return {
      jenis: "hitung",
      kunci: baik.kunci,
      fisik: baik.dipindai ? (Number(baik.fisik) || 0) + 1 : 1,
    };
  }
  const pertama = milik[0];
  return pertama ? { jenis: "fokus", kunci: pertama.kunci } : { jenis: "baru" };
}
