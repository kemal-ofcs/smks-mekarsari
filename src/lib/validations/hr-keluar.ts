/**
 * HRIS Fase 4 (`prd-hris.md` §22): surat peringatan dan pegawai keluar.
 *
 * Cermin `desktop/hr_keluar.rs`, diuji dengan vektor yang sama
 * (`hr-keluar.vektor.json`); teks SQL dibandingkan harfiah oleh
 * `hr-keluar.test.ts`. `hr_sp`, `hr_keluar`, `hr_keluar_rincian`, dan
 * `hr_keluar_alasan` KHUSUS CLOUD (Q-73); yang tersinkron hanya
 * `master_data.id_keluar`.
 */
import { z } from "zod";
import { tanggalValid } from "./hari-kerja";
import alasanBawaan from "./hr-keluar-alasan-bawaan.json";
import { tambahHari } from "./hr-pengajuan";
import {
  ATURAN_SP_MASA,
  angkaPengaturan,
  NOMOR_MAKS,
  tambahBulan,
} from "./hris";

export interface AlasanBawaan {
  id_alasan: string;
  nama: string;
  pengali_up: number;
  pengali_upmk: number;
  uph: boolean;
  kompensasi_pkwt: boolean;
  uang_pisah: boolean;
  dasar_hukum: string | null;
}

/** Angkanya wajib dicek ulang yayasan/konsultan; bisa disunting pemutus. */
export const ALASAN_BAWAAN: readonly AlasanBawaan[] = alasanBawaan;

/** Cermin `SEED_ALASAN_SQL`. Alasan yang sudah disunting tidak ditimpa. */
export const SEED_ALASAN_SQL =
  "INSERT OR IGNORE INTO hr_keluar_alasan (id_alasan, nama, pengali_up, pengali_upmk, uph, kompensasi_pkwt, uang_pisah, dasar_hukum) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8);";

/** Cermin `seed_alasan_args`. */
export function seedAlasanArgs(a: AlasanBawaan) {
  return [
    a.id_alasan,
    a.nama,
    a.pengali_up,
    a.pengali_upmk,
    a.uph ? 1 : 0,
    a.kompensasi_pkwt ? 1 : 0,
    a.uang_pisah ? 1 : 0,
    a.dasar_hukum,
  ];
}

// ── Surat peringatan: aturan murni (§22.2.1) ──

/** WAJIB sama dengan CHECK `hr_sp.tingkat`. */
export const TINGKAT_SP = ["SP1", "SP2", "SP3"] as const;
export type TingkatSp = (typeof TINGKAT_SP)[number];
export const MAKS_PELANGGARAN = 2000;
export const MAKS_TEKS_SP = 1000;
export const MAKS_PENANDA = 120;
export const MAKS_NIP_PENANDA = 30;

export const PESAN_DIRI_SENDIRI =
  "Tindakan ini tidak bisa dilakukan untuk diri sendiri.";
export const PESAN_DI_LUAR_CAKUPAN = "Pegawai ini di luar unit Anda.";
export const PESAN_BUTUH_SP3 =
  "SP3 hanya bisa dibuat atau diubah pemegang izin Terbitkan SP3.";
export const PESAN_SP_DICABUT = "SP ini sudah dicabut.";

type Hasil<T> = { ok: true; nilai: T } | { ok: false; galat: string };
const ok = <T>(nilai: T): Hasil<T> => ({ ok: true, nilai });
const gagal = <T = never>(galat: string): Hasil<T> => ({ ok: false, galat });
type Draft = Record<string, unknown>;

const panjang = (teks: string) => [...teks].length;

/** Cermin `payload_text`: teks dirapikan, kosong = `null`. */
function isian(draft: Draft, kunci: string): string | null {
  const nilai = draft[kunci];
  if (typeof nilai !== "string") return null;
  return nilai.trim() || null;
}

function teksOpsional(
  draft: Draft,
  kunci: string,
  label: string,
  maks: number,
): Hasil<string | null> {
  const t = isian(draft, kunci);
  if (t && panjang(t) > maks)
    return gagal(`${label} maksimal ${maks} karakter.`);
  return ok(t);
}

function teksWajib(
  draft: Draft,
  kunci: string,
  label: string,
  maks: number,
): Hasil<string> {
  const t = teksOpsional(draft, kunci, label, maks);
  if (!t.ok) return t;
  return t.nilai ? ok(t.nilai) : gagal(`${label} wajib diisi.`);
}

/** Cermin `akhir_masa_sp`: hari terakhir SP berlaku (inklusif). */
export function akhirMasaSp(tanggal: string, masaBulan: number): string | null {
  const akhir = tambahBulan(tanggal, masaBulan);
  return akhir ? tambahHari(akhir, -1) : null;
}

export type StatusSp = "Dicabut" | "Berlaku" | "Berakhir";

/** Cermin `status_sp`. Tidak disimpan. */
export function statusSp(
  tanggal: string,
  berlakuSampai: string,
  dicabut: boolean,
  hariIni: string,
): StatusSp {
  if (dicabut) return "Dicabut";
  return tanggal <= hariIni && hariIni <= berlakuSampai
    ? "Berlaku"
    : "Berakhir";
}

export interface SpRingkas {
  tingkat: string;
  tanggal: string;
  berlaku_sampai: string;
  dicabut: boolean;
}

/**
 * Cermin `usulan_tingkat`: SP Berlaku tertinggi pada `tanggal` + 1, maksimal
 * SP3. `sp3_berlaku` benar bila SP3 masih Berlaku (saatnya proses keluar).
 */
export function usulanTingkat(
  sp: readonly SpRingkas[],
  tanggal: string,
): { tingkat: TingkatSp; sp3_berlaku: boolean } {
  let tertinggi = -1;
  for (const s of sp) {
    if (statusSp(s.tanggal, s.berlaku_sampai, s.dicabut, tanggal) !== "Berlaku")
      continue;
    tertinggi = Math.max(
      tertinggi,
      (TINGKAT_SP as readonly string[]).indexOf(s.tingkat),
    );
  }
  if (tertinggi < 0) return { tingkat: "SP1", sp3_berlaku: false };
  if (tertinggi === 0) return { tingkat: "SP2", sp3_berlaku: false };
  return { tingkat: "SP3", sp3_berlaku: tertinggi >= 2 };
}

export interface SpSah {
  id_sp: string | null;
  id_karyawan: string;
  tingkat: TingkatSp;
  tanggal: string;
  nomor: string | null;
  pelanggaran: string;
  harapan: string | null;
  alasan_tingkat: string | null;
  penanda_nama: string;
  penanda_jabatan: string;
  penanda_nip: string | null;
}

/**
 * Cermin `validasi_sp`. Usulan tingkat, tanggal masuk, dan wewenang diperiksa
 * pemanggil.
 */
export function validasiSp(draft: Draft, hariIni: string): Hasil<SpSah> {
  const id_karyawan = isian(draft, "id_karyawan");
  if (!id_karyawan) return gagal("Pegawai wajib dipilih.");
  const tingkat = isian(draft, "tingkat");
  if (!tingkat || !(TINGKAT_SP as readonly string[]).includes(tingkat))
    return gagal("Tingkat SP tidak dikenal.");
  const tanggal = isian(draft, "tanggal");
  if (!tanggal || !tanggalValid(tanggal))
    return gagal("Tanggal SP tidak valid.");
  if (tanggal > hariIni) return gagal("Tanggal SP tidak boleh di masa depan.");
  const nomor = teksOpsional(draft, "nomor", "Nomor surat", NOMOR_MAKS);
  if (!nomor.ok) return nomor;
  const pelanggaran = teksWajib(
    draft,
    "pelanggaran",
    "Pelanggaran",
    MAKS_PELANGGARAN,
  );
  if (!pelanggaran.ok) return pelanggaran;
  const harapan = teksOpsional(
    draft,
    "harapan",
    "Perbaikan yang diminta",
    MAKS_TEKS_SP,
  );
  if (!harapan.ok) return harapan;
  const alasan_tingkat = teksOpsional(
    draft,
    "alasan_tingkat",
    "Alasan tingkat",
    MAKS_TEKS_SP,
  );
  if (!alasan_tingkat.ok) return alasan_tingkat;
  const penanda_nama = teksWajib(
    draft,
    "penanda_nama",
    "Nama penanda tangan",
    MAKS_PENANDA,
  );
  if (!penanda_nama.ok) return penanda_nama;
  const penanda_jabatan = teksWajib(
    draft,
    "penanda_jabatan",
    "Jabatan penanda tangan",
    MAKS_PENANDA,
  );
  if (!penanda_jabatan.ok) return penanda_jabatan;
  const penanda_nip = teksOpsional(
    draft,
    "penanda_nip",
    "NIP penanda tangan",
    MAKS_NIP_PENANDA,
  );
  if (!penanda_nip.ok) return penanda_nip;
  return ok({
    id_sp: isian(draft, "id_sp"),
    id_karyawan,
    tingkat: tingkat as TingkatSp,
    tanggal,
    nomor: nomor.nilai,
    pelanggaran: pelanggaran.nilai,
    harapan: harapan.nilai,
    alasan_tingkat: alasan_tingkat.nilai,
    penanda_nama: penanda_nama.nilai,
    penanda_jabatan: penanda_jabatan.nilai,
    penanda_nip: penanda_nip.nilai,
  });
}

/** Cermin `periksa_tingkat`: tingkat lain dari usulan wajib beralasan. */
export function periksaTingkat(
  tingkat: string,
  usulan: string,
  alasan: string | null,
): Hasil<null> {
  if (tingkat !== usulan && !alasan) {
    return gagal(
      `Tingkat berbeda dari usulan (${usulan}); alasannya wajib diisi.`,
    );
  }
  return ok(null);
}

/**
 * Cermin `periksa_wewenang_sp`: wewenang dari SESI (§22.4). `bolehSp3` hanya
 * dinilai untuk tingkat SP3; cabut memanggilnya dengan tingkat kosong.
 */
export function periksaWewenangSp(
  tingkat: string,
  sendiri: boolean,
  dalamCakupan: boolean,
  bolehSp3: boolean,
): Hasil<null> {
  if (sendiri) return gagal(PESAN_DIRI_SENDIRI);
  if (!dalamCakupan) return gagal(PESAN_DI_LUAR_CAKUPAN);
  if (tingkat === "SP3" && !bolehSp3) return gagal(PESAN_BUTUH_SP3);
  return ok(null);
}

/** Cermin `masa_sp_berlaku`: kunci `hr_sp_masa_bulan`; kosong/rusak = bawaan. */
export function masaSpBerlaku(nilai: string | null | undefined): number {
  return angkaPengaturan(nilai ?? "", ATURAN_SP_MASA);
}

// ── SQL, dieja harfiah sama di `desktop/hr_keluar.rs` ──

export const SP_PEGAWAI_SQL =
  "SELECT id_sp, id_karyawan, tingkat, usulan_tingkat, COALESCE(alasan_tingkat, '') AS alasan_tingkat, tanggal, masa_bulan, berlaku_sampai, COALESCE(nomor, '') AS nomor, pelanggaran, COALESCE(harapan, '') AS harapan, penanda_nama, penanda_jabatan, COALESCE(penanda_nip, '') AS penanda_nip, COALESCE(unit, '') AS unit, dicatat_oleh, created_at, COALESCE(diubah_oleh, '') AS diubah_oleh, COALESCE(diubah_pada, '') AS diubah_pada, COALESCE(dicabut_oleh, '') AS dicabut_oleh, COALESCE(dicabut_pada, '') AS dicabut_pada, COALESCE(alasan_cabut, '') AS alasan_cabut FROM hr_sp WHERE id_karyawan = ?1 ORDER BY tanggal DESC, created_at DESC, id_sp DESC\n-- batas: surat peringatan satu pegawai\n;";
export const SP_SATU_SQL =
  "SELECT id_sp, id_karyawan, tingkat, tanggal, COALESCE(unit, '') AS unit, COALESCE(dicabut_pada, '') AS dicabut_pada FROM hr_sp WHERE id_sp = ?1 LIMIT 1;";
export const PEGAWAI_SP_SQL =
  "SELECT m.id_unik, COALESCE(m.status_aktif, 'Aktif') AS status_aktif, COALESCE(m.tanggal_daftar, '') AS tanggal_daftar, COALESCE(m.unit, '') AS unit FROM master_data m WHERE m.id_unik = ?1 AND LOWER(TRIM(COALESCE(m.jenis_personil, ''))) <> 'siswa' AND NOT EXISTS (SELECT 1 FROM siswa_data sd WHERE sd.id_siswa = m.id_unik) LIMIT 1;";
export const MASA_SP_SQL =
  "SELECT value FROM setting_gex_system WHERE key = 'hr_sp_masa_bulan' LIMIT 1;";
export const NOMOR_KEMBAR_SQL =
  "SELECT COUNT(*) AS jumlah FROM hr_sp WHERE nomor = ?1 AND id_sp <> ?2;";
export const SIMPAN_SP_SQL =
  "INSERT INTO hr_sp (id_sp, id_karyawan, tingkat, usulan_tingkat, alasan_tingkat, tanggal, masa_bulan, berlaku_sampai, nomor, pelanggaran, harapan, penanda_nama, penanda_jabatan, penanda_nip, unit, dicatat_oleh, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, datetime('now'));";
export const UBAH_SP_SQL =
  "UPDATE hr_sp SET nomor = ?2, pelanggaran = ?3, harapan = ?4, penanda_nama = ?5, penanda_jabatan = ?6, penanda_nip = ?7, diubah_oleh = ?8, diubah_pada = datetime('now') WHERE id_sp = ?1 AND dicabut_pada IS NULL;";
export const CABUT_SP_SQL =
  "UPDATE hr_sp SET dicabut_oleh = ?2, dicabut_pada = datetime('now'), alasan_cabut = ?3 WHERE id_sp = ?1 AND dicabut_pada IS NULL;";

// ── Bentuk rute dan command ──

const teksBebas = (maks: number) => z.string().max(maks).default("");

/** Body `warnings/save`, cermin `draft` `desktop_hr_warning_save`. */
export const spDraftSchema = z
  .object({
    id_sp: teksBebas(40),
    id_karyawan: z.string().min(1).max(80),
    tingkat: z.enum(TINGKAT_SP),
    tanggal: z.string().max(20),
    nomor: teksBebas(NOMOR_MAKS + 20),
    pelanggaran: z.string().max(MAKS_PELANGGARAN + 100),
    harapan: teksBebas(MAKS_TEKS_SP + 100),
    alasan_tingkat: teksBebas(MAKS_TEKS_SP + 100),
    penanda_nama: z.string().max(MAKS_PENANDA + 20),
    penanda_jabatan: z.string().max(MAKS_PENANDA + 20),
    penanda_nip: teksBebas(MAKS_NIP_PENANDA + 20),
  })
  .strict();
export type SpDraft = z.input<typeof spDraftSchema>;

export const spQuerySchema = z
  .object({ id_karyawan: z.string().min(1).max(80) })
  .strict();

export const spCabutSchema = z
  .object({
    id_sp: z.string().min(1).max(40),
    alasan: z.string().max(MAKS_TEKS_SP + 100),
  })
  .strict();

export interface SpBaris {
  id_sp: string;
  id_karyawan: string;
  tingkat: TingkatSp;
  usulan_tingkat: TingkatSp;
  alasan_tingkat: string;
  tanggal: string;
  masa_bulan: number;
  berlaku_sampai: string;
  nomor: string;
  pelanggaran: string;
  harapan: string;
  penanda_nama: string;
  penanda_jabatan: string;
  penanda_nip: string;
  unit: string;
  dicatat_oleh: string;
  created_at: string;
  diubah_oleh: string;
  diubah_pada: string;
  dicabut_oleh: string;
  dicabut_pada: string;
  alasan_cabut: string;
  status: StatusSp;
}

export interface DaftarSp {
  sp: SpBaris[];
  usulan: { tingkat: TingkatSp; sp3_berlaku: boolean };
  masa_bulan: number;
  hari_ini: string;
}

export interface HasilSimpanSp {
  sukses: true;
  id_sp: string;
  nomor_kembar: boolean;
}
