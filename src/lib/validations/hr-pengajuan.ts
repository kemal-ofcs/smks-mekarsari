/**
 * HRIS Fase 2 (`prd-hris.md` §20): pengajuan cuti, izin, sakit, dan dinas
 * luar beserta keputusannya.
 *
 * Cermin `desktop/hr_pengajuan.rs`: fungsi bernama sama dalam snake_case,
 * vektor `hr-pengajuan.vektor.json` diuji kedua bahasa, konstanta SQL disalin
 * harfiah (diperiksa `hr-pengajuan.test.ts`), dan pesan galatnya identik.
 * Status pengajuan TIDAK disimpan: diturunkan `statusPengajuan` dan
 * `PENGAJUAN_BERLAKU_SQL`.
 */

import { z } from "zod";
import { rentangJamKe } from "./class-attendance";
import {
  hariIso,
  parseHariKerja,
  tanggalValid,
  wajibMasuk,
} from "./hari-kerja";
import {
  evaluateHolidayScan,
  type HolidayWhitelistEntry,
} from "./holiday-whitelist";
import jenisBawaan from "./hr-jenis-bawaan.json";
import { tambahBulan, validasiNamaMaster } from "./hris";

export const KELOMPOK = ["Cuti", "Izin", "Sakit", "Dinas Luar"] as const;
export const DAMPAK_GAJI = [
  "Dibayar",
  "Potong Gaji",
  "Tidak Berpengaruh",
] as const;
export const SATUAN_MAKS = ["Hari Kerja", "Hari Kalender"] as const;
export const IZIN_PEMUTUS = [
  "hr.request.decide",
  "hr.request.decide_major",
] as const;
export const KEPUTUSAN_FINAL = ["Setujui", "Tolak", "Setujui Urgent"] as const;
export const AKSI_KEPUTUSAN = [
  "Setujui",
  "Tolak",
  "Diketahui",
  "Batal",
] as const;
export const MAKS_ALASAN = 500;
export const MAKS_RENTANG_HARI = 366;
export const MAKS_HARI_JENIS = 366;
export const MAKS_JAM_KE = 20;

export type StatusPengajuan =
  | "Menunggu"
  | "Disetujui"
  | "Disetujui (urgent)"
  | "Ditolak"
  | "Dibatalkan";

const PESAN_IZIN_PUTUS = "Kamu tidak punya izin memutus jenis pengajuan ini.";
const PESAN_DIRI_SENDIRI =
  "Pengajuan untuk dirimu sendiri harus diputus orang lain.";
const PESAN_CAKUPAN = "Pegawai ini di luar unit yang kamu pegang.";

// SQL kembar (teks identik dengan Rust)

export const PENGAJUAN_BERLAKU_SQL =
  "NOT EXISTS (SELECT 1 FROM hr_pengajuan_keputusan b WHERE b.id_pengajuan = p.id_pengajuan AND b.jenis = 'Batal') AND (SELECT k.jenis FROM hr_pengajuan_keputusan k WHERE k.id_pengajuan = p.id_pengajuan AND k.sidik = p.sidik AND k.jenis IN ('Setujui', 'Tolak', 'Setujui Urgent') ORDER BY k.diterima_cloud IS NULL, k.diterima_cloud, k.waktu_perangkat, k.id_keputusan LIMIT 1) IN ('Setujui', 'Setujui Urgent')";
export const PENGAJUAN_RENTANG_SQL = `SELECT p.id_pengajuan, p.id_karyawan, p.tanggal_mulai, p.tanggal_selesai, p.kelompok, p.dampak_gaji, p.potong_jatah, p.jam_mulai_ke, p.jam_sampai_ke, p.setengah_hari FROM hr_pengajuan p WHERE p.tanggal_mulai <= ?2 AND p.tanggal_selesai >= ?1 AND ${PENGAJUAN_BERLAKU_SQL} ORDER BY p.id_karyawan, p.tanggal_mulai, p.id_pengajuan;`;
export const PERIODE_DIBAYAR_SQL =
  "SELECT period_start, period_end FROM payroll_runs WHERE status = 'PAID' AND period_start <= ?2 AND period_end >= ?1 ORDER BY period_start LIMIT 1;";
export const PERIODE_PERLU_ULANG_SQL =
  "SELECT period_start, period_end FROM payroll_runs WHERE status NOT IN ('PAID', 'REJECTED') AND period_start <= ?2 AND period_end >= ?1 ORDER BY period_start LIMIT 1;";
export const PENGAJUAN_AKTIF_ORANG_SQL =
  "SELECT p.id_pengajuan, p.id_karyawan, p.tanggal_mulai, p.tanggal_selesai, p.jam_mulai_ke, p.jam_sampai_ke FROM hr_pengajuan p WHERE p.id_karyawan = ?1 AND p.id_pengajuan <> ?2 AND p.tanggal_mulai <= ?4 AND p.tanggal_selesai >= ?3 AND NOT EXISTS (SELECT 1 FROM hr_pengajuan_keputusan b WHERE b.id_pengajuan = p.id_pengajuan AND b.jenis = 'Batal') AND COALESCE((SELECT k.jenis FROM hr_pengajuan_keputusan k WHERE k.id_pengajuan = p.id_pengajuan AND k.sidik = p.sidik AND k.jenis IN ('Setujui', 'Tolak', 'Setujui Urgent') ORDER BY k.diterima_cloud IS NULL, k.diterima_cloud, k.waktu_perangkat, k.id_keputusan LIMIT 1), '') <> 'Tolak' ORDER BY p.tanggal_mulai, p.id_pengajuan;";
export const SEED_JENIS_SQL =
  "INSERT OR IGNORE INTO hr_jenis_pengajuan (id_jenis, nama, kelompok, izin_pemutus, boleh_urgent, potong_jatah, wajib_dokumen, dampak_gaji, maks_hari, satuan_maks, is_aktif) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, 1);";
export const SIMPAN_JENIS_SQL =
  "INSERT INTO hr_jenis_pengajuan (id_jenis, nama, kelompok, izin_pemutus, boleh_urgent, potong_jatah, wajib_dokumen, dampak_gaji, maks_hari, satuan_maks, is_aktif, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, datetime('now'), datetime('now')) ON CONFLICT(id_jenis) DO UPDATE SET nama = excluded.nama, kelompok = excluded.kelompok, izin_pemutus = excluded.izin_pemutus, boleh_urgent = excluded.boleh_urgent, potong_jatah = excluded.potong_jatah, wajib_dokumen = excluded.wajib_dokumen, dampak_gaji = excluded.dampak_gaji, maks_hari = excluded.maks_hari, satuan_maks = excluded.satuan_maks, is_aktif = excluded.is_aktif, updated_at = excluded.updated_at;";
export const BENTROK_JENIS_SQL =
  "SELECT 1 FROM hr_jenis_pengajuan WHERE lower(nama) = lower(?1) AND id_jenis <> ?2 LIMIT 1;";
export const JENIS_SQL =
  "SELECT id_jenis, nama, kelompok, izin_pemutus, boleh_urgent, potong_jatah, wajib_dokumen, dampak_gaji, maks_hari, satuan_maks, is_aktif FROM hr_jenis_pengajuan ORDER BY is_aktif DESC, kelompok, nama, id_jenis\n-- batas: daftar jenis pengajuan sekolah, tidak tumbuh per hari\n;";
export const SIMPAN_PENGAJUAN_SQL =
  "INSERT INTO hr_pengajuan (id_pengajuan, id_karyawan, id_jenis, kelompok, potong_jatah, dampak_gaji, izin_pemutus, tanggal_mulai, tanggal_selesai, jam_mulai_ke, jam_sampai_ke, setengah_hari, alasan, sidik, diajukan_oleh, waktu_perangkat, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, datetime('now'), datetime('now')) ON CONFLICT(id_pengajuan) DO UPDATE SET id_karyawan = excluded.id_karyawan, id_jenis = excluded.id_jenis, kelompok = excluded.kelompok, potong_jatah = excluded.potong_jatah, dampak_gaji = excluded.dampak_gaji, izin_pemutus = excluded.izin_pemutus, tanggal_mulai = excluded.tanggal_mulai, tanggal_selesai = excluded.tanggal_selesai, jam_mulai_ke = excluded.jam_mulai_ke, jam_sampai_ke = excluded.jam_sampai_ke, setengah_hari = excluded.setengah_hari, alasan = excluded.alasan, sidik = excluded.sidik, waktu_perangkat = excluded.waktu_perangkat, updated_at = excluded.updated_at;";
export const CLOUD_KEPUTUSAN_SQL =
  "INSERT INTO hr_pengajuan_keputusan (id_keputusan, id_pengajuan, jenis, sidik, alasan, oleh, id_karyawan_oleh, waktu_perangkat, diterima_cloud, created_at) VALUES (?1, ?2, ?3, ?4, NULLIF(?5, ''), ?6, NULLIF(?7, ''), ?8, datetime('now'), datetime('now')) ON CONFLICT(id_keputusan) DO NOTHING;";
export const DAFTAR_PENGAJUAN_SQL =
  "SELECT p.id_pengajuan, p.id_karyawan, COALESCE(m.nama, p.id_karyawan) AS nama, COALESCE(m.unit, '') AS unit, CASE WHEN EXISTS (SELECT 1 FROM guru_data g WHERE g.id_guru = p.id_karyawan) THEN 1 ELSE 0 END AS guru, p.id_jenis, COALESCE(j.nama, p.id_jenis) AS nama_jenis, p.kelompok, p.potong_jatah, p.dampak_gaji, p.izin_pemutus, p.tanggal_mulai, p.tanggal_selesai, p.jam_mulai_ke, p.jam_sampai_ke, p.setengah_hari, p.alasan, p.sidik, p.diajukan_oleh, p.waktu_perangkat FROM hr_pengajuan p LEFT JOIN master_data m ON m.id_unik = p.id_karyawan LEFT JOIN hr_jenis_pengajuan j ON j.id_jenis = p.id_jenis WHERE (p.tanggal_mulai <= ?2 AND p.tanggal_selesai >= ?1) OR NOT EXISTS (SELECT 1 FROM hr_pengajuan_keputusan k WHERE k.id_pengajuan = p.id_pengajuan) ORDER BY p.tanggal_mulai DESC, p.id_pengajuan LIMIT 1000;";
export const DAFTAR_KEPUTUSAN_SQL =
  "SELECT k.id_keputusan, k.id_pengajuan, k.jenis, k.sidik, COALESCE(k.alasan, '') AS alasan, k.oleh, COALESCE(k.id_karyawan_oleh, '') AS id_karyawan_oleh, COALESCE(mo.unit, '') AS unit_oleh, k.waktu_perangkat, k.diterima_cloud FROM hr_pengajuan_keputusan k LEFT JOIN master_data mo ON mo.id_unik = k.id_karyawan_oleh WHERE k.id_pengajuan IN (SELECT value FROM json_each(?1)) ORDER BY k.id_pengajuan, k.created_at, k.id_keputusan;";
export const PEGAWAI_PENGAJUAN_SQL =
  "SELECT m.id_unik, m.nama, COALESCE(m.unit, '') AS unit, CASE WHEN EXISTS (SELECT 1 FROM guru_data g WHERE g.id_guru = m.id_unik) THEN 1 ELSE 0 END AS guru FROM master_data m WHERE COALESCE(m.status_aktif, 'Aktif') = 'Aktif' AND LOWER(TRIM(COALESCE(m.jenis_personil, ''))) <> 'siswa' AND NOT EXISTS (SELECT 1 FROM siswa_data sd WHERE sd.id_siswa = m.id_unik) ORDER BY m.nama, m.id_unik\n-- batas: pegawai aktif, dibatasi jumlah pegawai sekolah\n;";
export const PEGAWAI_SATU_SQL =
  "SELECT COALESCE(m.unit, '') AS unit, CASE WHEN EXISTS (SELECT 1 FROM guru_data g WHERE g.id_guru = m.id_unik) THEN 1 ELSE 0 END AS guru, COALESCE(m.divisi, '') AS divisi, s.hari_kerja, s.kode_shift FROM master_data m LEFT JOIN tbl_shift s ON s.id_shift = m.id_shift WHERE m.id_unik = ?1 AND LOWER(TRIM(COALESCE(m.jenis_personil, ''))) <> 'siswa' AND NOT EXISTS (SELECT 1 FROM siswa_data sd WHERE sd.id_siswa = m.id_unik);";
export const UNIT_PERSONIL_SQL =
  "SELECT COALESCE(unit, '') AS unit FROM master_data WHERE id_unik = ?1;";
export const JP_MAX_SQL =
  "SELECT (SELECT s.value FROM akademik_unit u JOIN setting_gex_system s ON s.key = 'jp_max_per_hari:' || u.id_unit WHERE lower(trim(u.nama_unit)) = lower(trim(?1)) ORDER BY u.status_aktif DESC, u.id_unit LIMIT 1) AS unit, (SELECT value FROM setting_gex_system WHERE key = 'jp_max_per_hari') AS sekolah;";
export const LIBUR_SQL =
  "SELECT tanggal FROM tbl_hari_libur WHERE status_aktif = 1 AND tanggal >= ?1 AND tanggal <= ?2;";
export const WHITELIST_SQL =
  "SELECT id, scope_type, scope_value, tanggal_libur, status_aktif FROM hari_libur_whitelist WHERE status_aktif = 1\n-- batas: daftar pengecualian libur, tidak tumbuh per hari\n;";
export const PENGAJUAN_SATU_SQL =
  "SELECT id_pengajuan, id_karyawan, id_jenis, kelompok, potong_jatah, dampak_gaji, izin_pemutus, tanggal_mulai, tanggal_selesai, jam_mulai_ke, jam_sampai_ke, setengah_hari, alasan, sidik, diajukan_oleh, waktu_perangkat FROM hr_pengajuan WHERE id_pengajuan = ?1;";
export const KEPUTUSAN_SATU_SQL =
  "SELECT id_keputusan, jenis, sidik, oleh, waktu_perangkat, diterima_cloud FROM hr_pengajuan_keputusan WHERE id_pengajuan = ?1 ORDER BY created_at, id_keputusan\n-- batas: satu sampai tiga keputusan per pengajuan\n;";
export const WAKTU_SQL =
  "SELECT datetime('now', '+7 hours') AS waktu, date('now', '+7 hours') AS hari_ini;";

// Jenis bawaan

export interface JenisBawaan {
  id_jenis: string;
  nama: string;
  kelompok: string;
  izin_pemutus: string;
  boleh_urgent: boolean;
  potong_jatah: boolean;
  dampak_gaji: string;
  maks_hari: number | null;
  satuan_maks: string;
  wajib_dokumen: boolean;
}

/** Jenis bawaan §20.2.2, berkas yang sama dengan seed Rust. */
export const JENIS_BAWAAN = jenisBawaan as readonly JenisBawaan[];

/** Cermin `seed_jenis_args`. */
export function seedJenisArgs(j: JenisBawaan) {
  return [
    j.id_jenis,
    j.nama,
    j.kelompok,
    j.izin_pemutus,
    j.boleh_urgent ? 1 : 0,
    j.potong_jatah ? 1 : 0,
    j.wajib_dokumen ? 1 : 0,
    j.dampak_gaji,
    j.maks_hari,
    j.satuan_maks,
  ];
}

// Pembantu isian

export type Hasil<T> = { ok: true; nilai: T } | { ok: false; pesan: string };
const ok = <T>(nilai: T): Hasil<T> => ({ ok: true, nilai });
const gagal = <T = never>(pesan: string): Hasil<T> => ({ ok: false, pesan });
const panjang = (s: string) => [...s].length;

type Draft = Record<string, unknown>;

/** Cermin `teks`. */
function teks(draft: Draft, kunci: string): string {
  const nilai = draft[kunci];
  if (typeof nilai === "string") return nilai.trim();
  if (typeof nilai === "number") return String(nilai);
  return "";
}

/** Cermin `bendera`. */
function bendera(draft: Draft, kunci: string): boolean {
  const nilai = draft[kunci];
  return nilai === true || nilai === 1;
}

/** Cermin `angka_opsional`: kosong = `null`, sah = angka, lainnya `undefined`. */
function angkaOpsional(
  draft: Draft,
  kunci: string,
  min: number,
  maks: number,
): number | null | undefined {
  const nilai = draft[kunci];
  if (
    nilai === undefined ||
    nilai === null ||
    (typeof nilai === "string" && nilai.trim() === "")
  ) {
    return null;
  }
  return typeof nilai === "number" &&
    Number.isInteger(nilai) &&
    nilai >= min &&
    nilai <= maks
    ? nilai
    : undefined;
}

const HARI_MS = 86_400_000;

/** Cermin `add_days` (`time_policy.rs`). */
export function tambahHari(tanggal: string, n: number): string {
  return new Date(Date.parse(`${tanggal}T00:00:00Z`) + n * HARI_MS)
    .toISOString()
    .slice(0, 10);
}

/** Cermin `days_between`. */
export function selisihHari(dari: string, ke: string): number {
  return Math.round(
    (Date.parse(`${ke}T00:00:00Z`) - Date.parse(`${dari}T00:00:00Z`)) / HARI_MS,
  );
}

/** Cermin `tanggal_rentang`: inklusif, paling banyak 400. */
export function tanggalRentang(mulai: string, selesai: string): string[] {
  const hasil: string[] = [];
  let t = mulai;
  while (t <= selesai && hasil.length < 400) {
    hasil.push(t);
    t = tambahHari(t, 1);
  }
  return hasil;
}

// Jenis pengajuan

export interface JenisPengajuan {
  nama: string;
  kelompok: string;
  izin_pemutus: string;
  boleh_urgent: boolean;
  potong_jatah: boolean;
  dampak_gaji: string;
  maks_hari: number | null;
  satuan_maks: string;
  wajib_dokumen: boolean;
  is_aktif: boolean;
}

const termasuk = (daftar: readonly string[], nilai: string) =>
  daftar.includes(nilai);

/** Cermin `validasi_jenis`. Id diurus pemanggil. */
export function validasiJenis(draft: Draft): Hasil<JenisPengajuan> {
  const nama = validasiNamaMaster(teks(draft, "nama"), "jenis pengajuan");
  if (!nama.ok) return gagal(nama.galat);
  const kelompok = teks(draft, "kelompok");
  if (!termasuk(KELOMPOK, kelompok)) {
    return gagal("Kelompok harus Cuti, Izin, Sakit, atau Dinas Luar.");
  }
  const izinPemutus = teks(draft, "izin_pemutus") || IZIN_PEMUTUS[0];
  if (!termasuk(IZIN_PEMUTUS, izinPemutus)) {
    return gagal("Pemutus pengajuan tidak dikenal.");
  }
  const dampak = teks(draft, "dampak_gaji");
  if (!termasuk(DAMPAK_GAJI, dampak))
    return gagal("Dampak gaji tidak dikenal.");
  const satuan = teks(draft, "satuan_maks") || SATUAN_MAKS[0];
  if (!termasuk(SATUAN_MAKS, satuan)) {
    return gagal("Satuan batas hari tidak dikenal.");
  }
  const potongJatah = bendera(draft, "potong_jatah");
  if (potongJatah && kelompok !== "Cuti") {
    return gagal("Hanya kelompok Cuti yang bisa memotong jatah cuti.");
  }
  const maksHari = angkaOpsional(draft, "maks_hari", 1, MAKS_HARI_JENIS);
  if (maksHari === undefined) {
    return gagal(`Batas hari harus 1 sampai ${MAKS_HARI_JENIS}.`);
  }
  return ok({
    nama: nama.nama,
    kelompok,
    izin_pemutus: izinPemutus,
    boleh_urgent: bendera(draft, "boleh_urgent"),
    potong_jatah: potongJatah,
    dampak_gaji: dampak,
    maks_hari: maksHari,
    satuan_maks: satuan,
    wajib_dokumen: bendera(draft, "wajib_dokumen"),
    is_aktif: draft.is_aktif === undefined || bendera(draft, "is_aktif"),
  });
}

// Isian pengajuan

export interface PengajuanSah {
  id_karyawan: string;
  id_jenis: string;
  tanggal_mulai: string;
  tanggal_selesai: string;
  jam_mulai_ke: number | null;
  jam_sampai_ke: number | null;
  setengah_hari: boolean;
  alasan: string;
  urgent: boolean;
}

/** Cermin `validasi_pengajuan`: kelengkapan isian, tanpa data jenis. */
export function validasiPengajuan(draft: Draft): Hasil<PengajuanSah> {
  const idKaryawan = teks(draft, "id_karyawan");
  if (idKaryawan === "") return gagal("Pilih pegawai.");
  const idJenis = teks(draft, "id_jenis");
  if (idJenis === "") return gagal("Pilih jenis pengajuan.");
  const mulai = teks(draft, "tanggal_mulai");
  const selesai = teks(draft, "tanggal_selesai");
  if (!tanggalValid(mulai) || !tanggalValid(selesai)) {
    return gagal("Tanggal pengajuan tidak valid.");
  }
  if (selesai < mulai) {
    return gagal("Tanggal selesai tidak boleh sebelum tanggal mulai.");
  }
  if (selisihHari(mulai, selesai) >= MAKS_RENTANG_HARI) {
    return gagal(`Rentang pengajuan paling panjang ${MAKS_RENTANG_HARI} hari.`);
  }
  const pesanJam = `Jam ke-N harus angka 1 sampai ${MAKS_JAM_KE}.`;
  const jamMulai = angkaOpsional(draft, "jam_mulai_ke", 1, MAKS_JAM_KE);
  if (jamMulai === undefined) return gagal(pesanJam);
  const jamSampai = angkaOpsional(draft, "jam_sampai_ke", 1, MAKS_JAM_KE);
  if (jamSampai === undefined) return gagal(pesanJam);
  const setengah = bendera(draft, "setengah_hari");
  if (setengah && mulai !== selesai) {
    return gagal("Setengah hari hanya untuk satu tanggal.");
  }
  if (setengah && (jamMulai !== null || jamSampai !== null)) {
    return gagal("Pilih setengah hari atau jam ke-N, tidak keduanya.");
  }
  if (
    jamMulai !== null &&
    jamSampai !== null &&
    mulai === selesai &&
    jamSampai < jamMulai
  ) {
    return gagal("Jam selesai tidak boleh sebelum jam mulai.");
  }
  const alasan = teks(draft, "alasan");
  if (alasan === "") return gagal("Alasan wajib diisi.");
  if (panjang(alasan) > MAKS_ALASAN) {
    return gagal(`Alasan maksimal ${MAKS_ALASAN} karakter.`);
  }
  return ok({
    id_karyawan: idKaryawan,
    id_jenis: idJenis,
    tanggal_mulai: mulai,
    tanggal_selesai: selesai,
    jam_mulai_ke: jamMulai,
    jam_sampai_ke: jamSampai,
    setengah_hari: setengah,
    alasan,
    urgent: bendera(draft, "urgent"),
  });
}

/** Cermin `periksa_jenis`. */
export function periksaJenis(
  p: PengajuanSah,
  jenis: JenisPengajuan,
  guru: boolean,
  jpMax: number,
): Hasil<null> {
  if (!jenis.is_aktif) return gagal("Jenis pengajuan ini sudah nonaktif.");
  if (p.urgent && !jenis.boleh_urgent) {
    return gagal("Jenis pengajuan ini tidak boleh urgent.");
  }
  if (p.setengah_hari) {
    if (jenis.kelompok !== "Izin") {
      return gagal("Setengah hari hanya untuk kelompok Izin.");
    }
    if (guru) return gagal("Guru memakai jam ke-N, bukan setengah hari.");
  }
  const jam = [p.jam_mulai_ke, p.jam_sampai_ke].filter(
    (n): n is number => n !== null,
  );
  if (jam.length > 0) {
    if (!guru) return gagal("Jam ke-N hanya untuk guru.");
    if (jenis.kelompok === "Cuti") return gagal("Cuti selalu hari penuh.");
    if (jam.some((n) => n > jpMax)) {
      return gagal(`Jam ke-N paling besar ${jpMax}.`);
    }
  }
  return ok(null);
}

/** Cermin `periksa_maks`. */
export function periksaMaks(
  jenis: JenisPengajuan,
  hariKerja: number,
  hariKalender: number,
): Hasil<null> {
  if (jenis.maks_hari === null) return ok(null);
  const kalender = jenis.satuan_maks === "Hari Kalender";
  const jumlah = kalender ? hariKalender : hariKerja;
  if (jumlah > jenis.maks_hari) {
    const satuan = kalender ? "hari kalender" : "hari kerja";
    return gagal(`${jenis.nama} paling lama ${jenis.maks_hari} ${satuan}.`);
  }
  return ok(null);
}

// Sidik

export interface IsiPengajuan {
  id_karyawan: string;
  id_jenis: string;
  kelompok: string;
  potong_jatah: boolean;
  dampak_gaji: string;
  izin_pemutus: string;
  tanggal_mulai: string;
  tanggal_selesai: string;
  jam_mulai_ke: number | null;
  jam_sampai_ke: number | null;
  setengah_hari: boolean;
  alasan: string;
}

/** Cermin `kanonik_pengajuan`; SHA-256-nya dihitung `sidikPengajuan` di service. */
export function kanonikPengajuan(isi: IsiPengajuan): string {
  const angka = (n: number | null) => (n === null ? "" : String(n));
  return [
    isi.id_karyawan,
    isi.id_jenis,
    isi.kelompok,
    isi.potong_jatah ? "1" : "0",
    isi.dampak_gaji,
    isi.izin_pemutus,
    isi.tanggal_mulai,
    isi.tanggal_selesai,
    angka(isi.jam_mulai_ke),
    angka(isi.jam_sampai_ke),
    isi.setengah_hari ? "1" : "0",
    isi.alasan,
  ].join("\u001f");
}

// Status dan tanda

export interface Keputusan {
  id_keputusan: string;
  jenis: string;
  sidik: string;
  oleh: string;
  waktu_perangkat: string;
  diterima_cloud: string | null;
}

const bandingTeks = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Cermin `urut_keputusan`. */
export function urutKeputusan(a: Keputusan, b: Keputusan): number {
  const tundaA = a.diterima_cloud === null ? 1 : 0;
  const tundaB = b.diterima_cloud === null ? 1 : 0;
  return (
    tundaA - tundaB ||
    bandingTeks(a.diterima_cloud ?? "", b.diterima_cloud ?? "") ||
    bandingTeks(a.waktu_perangkat, b.waktu_perangkat) ||
    bandingTeks(a.id_keputusan, b.id_keputusan)
  );
}

const isFinal = (k: Keputusan) => termasuk(KEPUTUSAN_FINAL, k.jenis);

/** Cermin `keputusan_berlaku`. */
export function keputusanBerlaku(
  sidik: string,
  keputusan: readonly Keputusan[],
): Keputusan | null {
  return (
    keputusan
      .filter((k) => isFinal(k) && k.sidik === sidik)
      .sort(urutKeputusan)[0] ?? null
  );
}

/** Cermin `status_pengajuan`. */
export function statusPengajuan(
  sidik: string,
  keputusan: readonly Keputusan[],
): StatusPengajuan {
  if (keputusan.some((k) => k.jenis === "Batal")) return "Dibatalkan";
  switch (keputusanBerlaku(sidik, keputusan)?.jenis) {
    case "Tolak":
      return "Ditolak";
    case "Setujui":
      return "Disetujui";
    case "Setujui Urgent":
      return "Disetujui (urgent)";
    default:
      return "Menunggu";
  }
}

export function statusBerlaku(status: string): boolean {
  return status === "Disetujui" || status === "Disetujui (urgent)";
}

export const samaOrang = (a: string, b: string) =>
  a.trim().toLowerCase() === b.trim().toLowerCase();

/** Cermin `tanda_keputusan`. */
export function tandaKeputusan(
  sidik: string,
  diajukanOleh: string,
  keputusan: readonly Keputusan[],
  cakupanBerlaku: boolean | null,
): string[] {
  const status = statusPengajuan(sidik, keputusan);
  const tanda: string[] = [];
  if (
    status === "Disetujui (urgent)" &&
    !keputusan.some((k) => k.jenis === "Diketahui")
  ) {
    tanda.push("perlu_diketahui");
  }
  const finals = keputusan.filter(isFinal);
  const sah = finals.filter((k) => k.sidik === sidik);
  if (
    sah.some((k) => k.jenis === "Tolak") &&
    sah.some((k) => k.jenis !== "Tolak")
  ) {
    tanda.push("keputusan_ganda");
  }
  if (status !== "Dibatalkan" && finals.length > 0 && sah.length === 0) {
    tanda.push("keputusan_gugur");
  }
  if (status !== "Dibatalkan" && status !== "Menunggu") {
    const berlaku = keputusanBerlaku(sidik, keputusan);
    if (
      berlaku &&
      berlaku.jenis !== "Setujui Urgent" &&
      samaOrang(berlaku.oleh, diajukanOleh)
    ) {
      tanda.push("diputus_sendiri");
    }
    if (cakupanBerlaku === false) tanda.push("di_luar_cakupan");
  }
  return tanda;
}

export const LABEL_TANDA: Record<string, string> = {
  perlu_diketahui: "Urgent, belum diketahui pemutus",
  keputusan_ganda: "Diputus berbeda oleh dua pemutus",
  keputusan_gugur: "Isinya diubah setelah diputus",
  diputus_sendiri: "Diajukan dan diputus orang yang sama",
  bertumpuk: "Bertumpuk dengan pengajuan lain",
  di_luar_cakupan: "Pemutus kini di luar unit pegawai",
  hadir_saat_cuti: "Ada scan Hadir di hari cuti (jatah tidak terpotong)",
};

// Bertumpuk, hari wajib, cakupan

export interface Ringkas {
  id_karyawan: string;
  tanggal_mulai: string;
  tanggal_selesai: string;
  jam_mulai_ke: number | null;
  jam_sampai_ke: number | null;
}

function jamPada(r: Ringkas, t: string): [number, number] {
  const awal = t === r.tanggal_mulai ? (r.jam_mulai_ke ?? 1) : 1;
  const akhir =
    t === r.tanggal_selesai
      ? (r.jam_sampai_ke ?? Number.MAX_SAFE_INTEGER)
      : Number.MAX_SAFE_INTEGER;
  return [awal, akhir];
}

/** Cermin `bentrok_pengajuan`. */
export function bentrokPengajuan(a: Ringkas, b: Ringkas): boolean {
  if (a.id_karyawan.trim() !== b.id_karyawan.trim()) return false;
  const mulai =
    a.tanggal_mulai > b.tanggal_mulai ? a.tanggal_mulai : b.tanggal_mulai;
  const selesai =
    a.tanggal_selesai < b.tanggal_selesai
      ? a.tanggal_selesai
      : b.tanggal_selesai;
  if (mulai > selesai) return false;
  if (selisihHari(mulai, selesai) >= 2) return true;
  return [mulai, selesai].some((t) => {
    const [a0, a1] = jamPada(a, t);
    const [b0, b1] = jamPada(b, t);
    return a0 <= b1 && b0 <= a1;
  });
}

export interface Jadwal {
  hari_masuk: number[];
  divisi: string;
  kode_shift: number | null;
}

/** Cermin `tanggal_wajib`. */
export function tanggalWajib(
  jadwal: Jadwal,
  libur: ReadonlySet<string>,
  whitelist: HolidayWhitelistEntry[],
  mulai: string,
  selesai: string,
): string[] {
  return tanggalRentang(mulai, selesai).filter((t) => {
    const hariLibur = libur.has(t);
    const masukSaatLibur =
      hariLibur &&
      evaluateHolidayScan(whitelist, {
        tanggal: t,
        divisi: jadwal.divisi,
        kodeShift: jadwal.kode_shift,
      }).allowed;
    return wajibMasuk({
      tanggal: t,
      hariMasuk: jadwal.hari_masuk,
      libur: hariLibur,
      masukSaatLibur,
    });
  });
}

/** Jadwal dari baris `PEGAWAI_SATU_SQL`. */
export function jadwalDariBaris(baris: {
  divisi: unknown;
  hari_kerja: unknown;
  kode_shift: unknown;
}): Jadwal {
  const kode = baris.kode_shift;
  return {
    divisi: String(baris.divisi ?? ""),
    hari_masuk: parseHariKerja(
      typeof baris.hari_kerja === "string" ? baris.hari_kerja : null,
    ),
    kode_shift:
      kode === null || kode === undefined || kode === "" ? null : Number(kode),
  };
}

const unitNormal = (unit: string) => unit.trim().toLowerCase();

/** Cermin `dalam_cakupan` (A-5). */
export function dalamCakupan(
  lingkupSemua: boolean,
  unitAkun: string,
  unitSasaran: string,
): boolean {
  return (
    lingkupSemua ||
    (unitNormal(unitAkun) !== "" &&
      unitNormal(unitAkun) === unitNormal(unitSasaran))
  );
}

// Aturan aksi

export interface KeadaanAksi {
  status: string;
  sudah_diketahui: boolean;
  pengaju_sendiri: boolean;
  superadmin: boolean;
  karyawan_sendiri: boolean;
  boleh_putus: boolean;
  dalam_cakupan: boolean;
}

function bolehMemutus(k: KeadaanAksi): Hasil<null> {
  if (!k.boleh_putus) return gagal(PESAN_IZIN_PUTUS);
  if (k.karyawan_sendiri) return gagal(PESAN_DIRI_SENDIRI);
  if (!k.dalam_cakupan) return gagal(PESAN_CAKUPAN);
  return ok(null);
}

/** Cermin `periksa_aksi`. */
export function periksaAksi(
  aksi: string,
  alasan: string,
  k: KeadaanAksi,
): Hasil<null> {
  if (!termasuk(AKSI_KEPUTUSAN, aksi)) return gagal("Keputusan tidak dikenal.");
  if (panjang(alasan.trim()) > MAKS_ALASAN) {
    return gagal(`Alasan maksimal ${MAKS_ALASAN} karakter.`);
  }
  const tanpaAlasan = alasan.trim() === "";
  if (aksi === "Setujui" || aksi === "Tolak") {
    if (k.status !== "Menunggu") {
      return gagal("Pengajuan ini tidak lagi menunggu keputusan.");
    }
    const izin = bolehMemutus(k);
    if (!izin.ok) return izin;
    if (aksi === "Tolak" && tanpaAlasan) {
      return gagal("Alasan penolakan wajib diisi.");
    }
  } else if (aksi === "Diketahui") {
    if (k.status !== "Disetujui (urgent)" || k.sudah_diketahui) {
      return gagal(
        "Hanya pengajuan urgent yang belum diketahui yang bisa ditandai.",
      );
    }
    const izin = bolehMemutus(k);
    if (!izin.ok) return izin;
  } else {
    if (tanpaAlasan) return gagal("Alasan pembatalan wajib diisi.");
    if (k.status === "Menunggu") {
      if (!k.pengaju_sendiri && !k.superadmin) {
        return gagal(
          "Hanya pengaju yang bisa membatalkan pengajuan yang masih menunggu.",
        );
      }
    } else if (statusBerlaku(k.status)) {
      const izin = bolehMemutus(k);
      if (!izin.ok) return izin;
    } else {
      return gagal(
        "Pengajuan yang ditolak atau dibatalkan tidak bisa dibatalkan lagi.",
      );
    }
  }
  return ok(null);
}

/** Cermin `periksa_sunting`. */
export function periksaSunting(
  status: string,
  pengajuSendiri: boolean,
  superadmin: boolean,
): Hasil<null> {
  if (status !== "Menunggu") {
    return gagal("Pengajuan yang sudah diputus tidak bisa disunting.");
  }
  if (!pengajuSendiri && !superadmin) {
    return gagal("Hanya pengaju yang bisa menyunting pengajuan ini.");
  }
  return ok(null);
}

/** Cermin `periksa_urgent`. */
export function periksaUrgent(
  karyawanSendiri: boolean,
  cakupan: boolean,
): Hasil<null> {
  if (karyawanSendiri) {
    return gagal(
      "Pengajuan urgent untuk dirimu sendiri tidak bisa disetujui sendiri.",
    );
  }
  if (!cakupan) return gagal(PESAN_CAKUPAN);
  return ok(null);
}

export const pesanPeriodeDibayar = (mulai: string, selesai: string) =>
  `Gaji periode ${mulai} s.d. ${selesai} sudah dibayar; pengajuan di tanggal itu tidak bisa diubah.`;
export const pesanBertumpuk = (mulai: string, selesai: string) =>
  `Tanggal itu bertumpuk dengan pengajuan lain pegawai ini (${mulai} s.d. ${selesai}).`;
export const pesanRunUlang = (mulai: string, selesai: string) =>
  `Proses gaji periode ${mulai} s.d. ${selesai} sudah dibuat; buat ulang supaya pengajuan ini ikut dihitung.`;

// Sub-fase 2b: absensi, gaji, dan jatah cuti (§20.2.4, §20.2.6, §20.2.7)

export const LAPORAN_PENGAJUAN_SQL = `SELECT json_object('id', p.id_karyawan, 'mulai', p.tanggal_mulai, 'selesai', p.tanggal_selesai, 'kelompok', p.kelompok) FROM hr_pengajuan p WHERE p.tanggal_mulai <= ?2 AND p.tanggal_selesai >= ?1 AND ${PENGAJUAN_BERLAKU_SQL} ORDER BY p.id_karyawan, p.tanggal_mulai, p.id_pengajuan;`;
export const HARI_ABSEN_SQL =
  "SELECT id_karyawan, tanggal, MAX(CASE WHEN status_kehadiran IN ('Hadir', 'PRESENT') THEN 1 ELSE 0 END) AS hadir, COALESCE(SUM(jam_kerja), 0) AS jam_kerja FROM absensi_harian WHERE tanggal >= ?1 AND tanggal <= ?2 GROUP BY id_karyawan, tanggal;";
export const JADWAL_PEGAWAI_SQL =
  "SELECT m.id_unik, COALESCE(m.divisi, '') AS divisi, s.hari_kerja, s.kode_shift, COALESCE(s.jam_kerja_normal_menit, 0) AS jam_normal FROM master_data m LEFT JOIN tbl_shift s ON s.id_shift = m.id_shift WHERE m.id_unik IN (SELECT value FROM json_each(?1));";
export const JATAH_PEGAWAI_SQL =
  "SELECT m.id_unik, m.nama, COALESCE(m.unit, '') AS unit, COALESCE(m.tanggal_mulai_aktif, '') AS tmt, CASE WHEN EXISTS (SELECT 1 FROM guru_data g WHERE g.id_guru = m.id_unik) THEN 1 ELSE 0 END AS guru, COALESCE(m.divisi, '') AS divisi, s.hari_kerja, s.kode_shift FROM master_data m LEFT JOIN tbl_shift s ON s.id_shift = m.id_shift WHERE m.id_unik = ?1 AND LOWER(TRIM(COALESCE(m.jenis_personil, ''))) <> 'siswa' AND NOT EXISTS (SELECT 1 FROM siswa_data sd WHERE sd.id_siswa = m.id_unik);";
export const JATAH_TERPAKAI_SQL = `SELECT p.tanggal_mulai, p.tanggal_selesai FROM hr_pengajuan p WHERE p.id_karyawan = ?1 AND p.potong_jatah = 1 AND ${PENGAJUAN_BERLAKU_SQL} ORDER BY p.tanggal_mulai, p.id_pengajuan;`;
export const HADIR_ORANG_SQL =
  "SELECT tanggal FROM absensi_harian WHERE id_karyawan = ?1 AND tanggal >= ?2 AND tanggal <= ?3 AND status_kehadiran IN ('Hadir', 'PRESENT') GROUP BY tanggal;";
export const PENYESUAIAN_ORANG_SQL =
  "SELECT u.id_penyesuaian, u.periode, u.jenis, COALESCE(u.id_ref, '') AS id_ref, u.hari, u.alasan, u.dicatat_oleh, u.created_at, CASE WHEN EXISTS (SELECT 1 FROM hr_cuti_penyesuaian b WHERE b.jenis = 'Pembatalan' AND b.id_ref = u.id_penyesuaian) THEN 1 ELSE 0 END AS dibatalkan FROM hr_cuti_penyesuaian u WHERE u.id_karyawan = ?1 ORDER BY u.periode, u.created_at, u.id_penyesuaian;";
export const PENYESUAIAN_SATU_SQL =
  "SELECT u.id_penyesuaian, u.id_karyawan, u.periode, u.jenis, CASE WHEN EXISTS (SELECT 1 FROM hr_cuti_penyesuaian b WHERE b.jenis = 'Pembatalan' AND b.id_ref = u.id_penyesuaian) THEN 1 ELSE 0 END AS dibatalkan FROM hr_cuti_penyesuaian u WHERE u.id_penyesuaian = ?1;";
export const RIWAYAT_PENGAJUAN_SQL =
  "SELECT p.id_pengajuan, p.id_karyawan, COALESCE(m.nama, p.id_karyawan) AS nama, COALESCE(m.unit, '') AS unit, CASE WHEN EXISTS (SELECT 1 FROM guru_data g WHERE g.id_guru = p.id_karyawan) THEN 1 ELSE 0 END AS guru, p.id_jenis, COALESCE(j.nama, p.id_jenis) AS nama_jenis, p.kelompok, p.potong_jatah, p.dampak_gaji, p.izin_pemutus, p.tanggal_mulai, p.tanggal_selesai, p.jam_mulai_ke, p.jam_sampai_ke, p.setengah_hari, p.alasan, p.sidik, p.diajukan_oleh, p.waktu_perangkat FROM hr_pengajuan p LEFT JOIN master_data m ON m.id_unik = p.id_karyawan LEFT JOIN hr_jenis_pengajuan j ON j.id_jenis = p.id_jenis WHERE p.id_karyawan = ?1 ORDER BY p.tanggal_mulai DESC, p.id_pengajuan LIMIT 200;";
export const ATURAN_CUTI_SQL =
  "SELECT key, value FROM setting_gex_system WHERE key LIKE 'hr_cuti_%';";
export const CLOUD_PENYESUAIAN_SQL =
  "INSERT INTO hr_cuti_penyesuaian (id_penyesuaian, id_karyawan, periode, jenis, id_ref, hari, alasan, dicatat_oleh, created_at) VALUES (?1, ?2, ?3, ?4, NULLIF(?5, ''), ?6, ?7, ?8, datetime('now')) ON CONFLICT(id_penyesuaian) DO NOTHING;";

/** Pengajuan berlaku hasil `PENGAJUAN_RENTANG_SQL`. Cermin `Berlaku`. */
export interface Berlaku {
  id_karyawan: string;
  tanggal_mulai: string;
  tanggal_selesai: string;
  kelompok: string;
  dampak_gaji: string;
  jam_mulai_ke: number | null;
  jam_sampai_ke: number | null;
  setengah_hari: boolean;
}

/** Cermin `penuh_pada`: pengajuan menutup `t` sehari penuh (Q-46). */
export function penuhPada(p: Berlaku, t: string): boolean {
  const awalSebagian =
    t === p.tanggal_mulai && p.jam_mulai_ke !== null && p.jam_mulai_ke > 1;
  const akhirSebagian = t === p.tanggal_selesai && p.jam_sampai_ke !== null;
  return !(p.setengah_hari || awalSebagian || akhirSebagian);
}

/** Cermin `menit_cuti_dibayar` (tabel §20.2.7): `[hari, menit]`. */
export function menitCutiDibayar(
  penuh: boolean,
  hadir: boolean,
  jamKerja: number,
  normal: number,
): [number, number] {
  if (penuh && hadir) return [0, 0];
  return [
    hadir ? 0 : 1,
    Math.max(0, Math.max(0, normal) - Math.max(0, jamKerja)),
  ];
}

export interface CutiDibayar {
  hari: number;
  menit: number;
  jam_normal_nol: boolean;
}

/** Cermin `hitung_cuti_dibayar`: satu tanggal sekali, penuh menang. */
export function hitungCutiDibayar(
  tanggal: readonly (readonly [string, boolean])[],
  absen: ReadonlyMap<string, readonly [boolean, number]>,
  normal: number,
): CutiDibayar {
  const per = new Map<string, boolean>();
  for (const [t, penuh] of tanggal) per.set(t, (per.get(t) ?? false) || penuh);
  const hasil: CutiDibayar = {
    hari: 0,
    menit: 0,
    jam_normal_nol: per.size > 0 && normal <= 0,
  };
  for (const [t, penuh] of per) {
    const [hadir, jam] = absen.get(t) ?? [false, 0];
    const [h, m] = menitCutiDibayar(penuh, hadir, jam, normal);
    hasil.hari += h;
    hasil.menit += m;
  }
  return hasil;
}

/** Cermin `hadir_saat_cuti`; `hadir` berisi `id|tanggal`. */
export function hadirSaatCuti(p: Berlaku, hadir: ReadonlySet<string>): boolean {
  return (
    p.kelompok === "Cuti" &&
    tanggalRentang(p.tanggal_mulai, p.tanggal_selesai).some(
      (t) => penuhPada(p, t) && hadir.has(`${p.id_karyawan}|${t}`),
    )
  );
}

/** Baris SQL berkolom pengajuan (daftar, riwayat, `PENGAJUAN_RENTANG_SQL`). */
export function berlakuDari(r: Record<string, unknown>): Berlaku {
  const opsional = (v: unknown) =>
    v === null || v === undefined || v === "" ? null : Number(v);
  return {
    id_karyawan: String(r.id_karyawan ?? ""),
    tanggal_mulai: String(r.tanggal_mulai ?? ""),
    tanggal_selesai: String(r.tanggal_selesai ?? ""),
    kelompok: String(r.kelompok ?? ""),
    dampak_gaji: String(r.dampak_gaji ?? ""),
    jam_mulai_ke: opsional(r.jam_mulai_ke),
    jam_sampai_ke: opsional(r.jam_sampai_ke),
    setengah_hari: Number(r.setengah_hari ?? 0) === 1,
  };
}

// Aturan dan jatah cuti per kelompok (§20.2.4)

export const KELOMPOK_CUTI = ["guru", "tendik"] as const;
export type KelompokCuti = (typeof KELOMPOK_CUTI)[number];
export const PERIODE_CUTI = ["tahunan", "ulang_tahun_kerja"] as const;
export const SISA_CUTI = ["hangus", "dibawa"] as const;
export const JENIS_PENYESUAIAN = ["Saldo Awal", "Koreksi"] as const;
export const MAKS_HARI_PENYESUAIAN = 366;

/** Cermin `BATAS_CUTI`: isian, label, min, maks, bawaan guru, bawaan tendik. */
export const BATAS_CUTI = [
  ["hak", "Hak cuti", 0, 60, 12, 12],
  ["bulan_awal", "Bulan awal periode", 1, 12, 7, 1],
  ["syarat_bulan", "Masa kerja minimum", 0, 24, 12, 12],
  ["bawa_maks", "Sisa maksimal dibawa", 0, 60, 6, 6],
  ["bawa_bulan", "Batas pakai sisa dibawa", 1, 12, 3, 3],
] as const;

export interface AturanCuti {
  periode: string;
  hak: number;
  bulan_awal: number;
  syarat_bulan: number;
  sisa: string;
  bawa_maks: number;
  bawa_bulan: number;
}

export const kunciCuti = (isian: string, kelompok: string) =>
  `hr_cuti_${isian}:${kelompok}`;

/** Cermin `aturan_cuti`. Kosong atau di luar batas = bawaan kelompok. */
export function aturanCuti(
  peta: ReadonlyMap<string, string>,
  kelompok: string,
): AturanCuti {
  const guru = kelompok === "guru";
  const nilai = (isian: string) => peta.get(kunciCuti(isian, kelompok))?.trim();
  const angka = (i: number) => {
    const [isian, , min, maks, bawaanGuru, bawaanTendik] = BATAS_CUTI[i];
    const teksNilai = nilai(isian);
    const n =
      teksNilai !== undefined && /^[+-]?\d+$/.test(teksNilai)
        ? Number(teksNilai)
        : Number.NaN;
    return n >= min && n <= maks ? n : guru ? bawaanGuru : bawaanTendik;
  };
  const pilih = (isian: string, daftar: readonly string[]) => {
    const v = nilai(isian);
    return v !== undefined && daftar.includes(v) ? v : daftar[0];
  };
  return {
    periode: pilih("periode", PERIODE_CUTI),
    hak: angka(0),
    bulan_awal: angka(1),
    syarat_bulan: angka(2),
    sisa: pilih("sisa", SISA_CUTI),
    bawa_maks: angka(3),
    bawa_bulan: angka(4),
  };
}

/** Cermin `validasi_aturan_cuti`: pasangan kunci-nilai, urutan tetap. */
export function validasiAturanCuti(draft: Draft): Hasil<[string, string][]> {
  const hasil: [string, string][] = [];
  for (const k of KELOMPOK_CUTI) {
    const a = draft[k];
    if (typeof a !== "object" || a === null || Array.isArray(a)) {
      return gagal(`Aturan cuti ${k} tidak lengkap.`);
    }
    const isian = a as Draft;
    const periode = teks(isian, "periode");
    if (!termasuk(PERIODE_CUTI, periode)) {
      return gagal(`Periode cuti ${k} harus tahunan atau ulang tahun kerja.`);
    }
    const sisa = teks(isian, "sisa");
    if (!termasuk(SISA_CUTI, sisa)) {
      return gagal(`Sisa cuti ${k} harus hangus atau dibawa.`);
    }
    hasil.push([kunciCuti("periode", k), periode]);
    for (const [nama, label, min, maks] of BATAS_CUTI) {
      const n = isian[nama];
      if (
        typeof n !== "number" ||
        !Number.isInteger(n) ||
        n < min ||
        n > maks
      ) {
        return gagal(`${label} ${k} harus ${min} sampai ${maks}.`);
      }
      hasil.push([kunciCuti(nama, k), String(n)]);
      if (nama === "syarat_bulan") hasil.push([kunciCuti("sisa", k), sisa]);
    }
  }
  return ok(hasil);
}

export interface PeriodeCuti {
  mulai: string;
  selesai: string;
  sebelum_berhak: boolean;
  hak: number;
  bawaan: number;
  bawaan_hangus: number;
  bawaan_sampai: string | null;
  penyesuaian: number;
  terpakai: number;
  sisa: number;
}

/** Cermin `jatah_cuti`. */
export function jatahCuti(
  tmt: string | null,
  a: AturanCuti,
  terpakai: readonly string[],
  penyesuaian: readonly (readonly [string, number])[],
  hariIni: string,
): PeriodeCuti[] {
  if (tmt === null || !tanggalValid(tmt)) return [];
  const berhak = tambahBulan(tmt, a.syarat_bulan);
  if (berhak === null) return [];
  let akhir = hariIni;
  for (const t of [...terpakai, ...penyesuaian.map(([p]) => p)]) {
    if (t > akhir) akhir = t;
  }

  const batas: [string, string, number, boolean][] = [];
  if (tmt < berhak || terpakai.some((t) => t < berhak)) {
    const awalan = terpakai.filter((t) => t < tmt).sort()[0] ?? tmt;
    const selesai = tambahHari(berhak, -1);
    if (awalan <= selesai) batas.push([awalan, selesai, 0, true]);
  }
  if (a.periode === "tahunan") {
    const tahun = Number(berhak.slice(0, 4));
    const bulan = Number(berhak.slice(5, 7));
    const awal = (y: number) =>
      `${String(y).padStart(4, "0")}-${String(a.bulan_awal).padStart(2, "0")}-01`;
    let y = (bulan >= a.bulan_awal ? tahun : tahun - 1) + 1;
    batas.push([berhak, tambahHari(awal(y), -1), a.hak, false]);
    while (awal(y) <= akhir && batas.length < 200) {
      batas.push([awal(y), tambahHari(awal(y + 1), -1), a.hak, false]);
      y += 1;
    }
  } else {
    for (let k = 0; batas.length < 200; k++) {
      const mulai = tambahBulan(berhak, 12 * k);
      const berikut = tambahBulan(berhak, 12 * (k + 1));
      if (mulai === null || berikut === null || mulai > akhir) break;
      batas.push([mulai, tambahHari(berikut, -1), a.hak, false]);
    }
  }

  const hasil: PeriodeCuti[] = [];
  for (const [mulai, selesai, hak, sebelumBerhak] of batas) {
    const pakai = terpakai.filter((t) => t >= mulai && t <= selesai).length;
    const adj = penyesuaian
      .filter(([p]) => p === mulai)
      .reduce((n, [, h]) => n + h, 0);
    const sebelumnya = hasil.at(-1);
    const bawaan =
      sebelumnya && !sebelumnya.sebelum_berhak && a.sisa === "dibawa"
        ? Math.min(Math.max(sebelumnya.sisa, 0), a.bawa_maks)
        : 0;
    let hangus = 0;
    let sampai: string | null = null;
    if (bawaan > 0) {
      const batasBawa = tambahBulan(mulai, a.bawa_bulan);
      if (batasBawa !== null) {
        const awal = terpakai.filter((t) => t >= mulai && t < batasBawa).length;
        if (hariIni >= batasBawa) hangus = bawaan - Math.min(bawaan, awal);
        sampai = tambahHari(batasBawa, -1);
      }
    }
    hasil.push({
      mulai,
      selesai,
      sebelum_berhak: sebelumBerhak,
      hak,
      bawaan,
      bawaan_hangus: hangus,
      bawaan_sampai: sampai,
      penyesuaian: adj,
      terpakai: pakai,
      sisa: hak + adj + bawaan - hangus - pakai,
    });
  }
  return hasil.filter(
    (p) => !p.sebelum_berhak || p.terpakai !== 0 || p.penyesuaian !== 0,
  );
}

export interface PenyesuaianSah {
  batal: string;
  id_karyawan: string;
  periode: string;
  jenis: string;
  hari: number;
  alasan: string;
}

/** Cermin `validasi_penyesuaian`. */
export function validasiPenyesuaian(draft: Draft): Hasil<PenyesuaianSah> {
  const alasan = teks(draft, "alasan");
  const cekAlasan = (): string | null => {
    if (alasan === "") return "Alasan wajib diisi.";
    if (panjang(alasan) > MAKS_ALASAN) {
      return `Alasan maksimal ${MAKS_ALASAN} karakter.`;
    }
    return null;
  };
  const batal = teks(draft, "batal");
  if (batal !== "") {
    const salah = cekAlasan();
    if (salah) return gagal(salah);
    return ok({
      batal,
      id_karyawan: "",
      periode: "",
      jenis: "Pembatalan",
      hari: 0,
      alasan,
    });
  }
  const idKaryawan = teks(draft, "id_karyawan");
  if (idKaryawan === "") return gagal("Pilih pegawai.");
  const periode = teks(draft, "periode");
  if (!tanggalValid(periode)) return gagal("Periode jatah tidak valid.");
  const jenis = teks(draft, "jenis");
  if (!termasuk(JENIS_PENYESUAIAN, jenis)) {
    return gagal("Jenis penyesuaian harus Saldo Awal atau Koreksi.");
  }
  const hari = draft.hari;
  if (
    typeof hari !== "number" ||
    !Number.isInteger(hari) ||
    hari === 0 ||
    Math.abs(hari) > MAKS_HARI_PENYESUAIAN
  ) {
    return gagal(
      `Jumlah hari harus -${MAKS_HARI_PENYESUAIAN} sampai ${MAKS_HARI_PENYESUAIAN} dan bukan 0.`,
    );
  }
  const salah = cekAlasan();
  if (salah) return gagal(salah);
  return ok({
    batal: "",
    id_karyawan: idKaryawan,
    periode,
    jenis,
    hari,
    alasan,
  });
}

export const LABEL_TANDA_CUTI: Record<string, string> = {
  tanpa_tmt: "TMT kosong: belum punya jatah cuti",
  jatah_minus: "Sisa jatah periode ini minus",
};

export const aturanCutiDraftSchema = z
  .object({
    guru: z.record(z.string(), z.unknown()),
    tendik: z.record(z.string(), z.unknown()),
  })
  .strict();
export type AturanCutiDraft = { guru: AturanCuti; tendik: AturanCuti };

export const penyesuaianDraftSchema = z
  .object({
    batal: z.string().max(80).optional(),
    id_karyawan: z.string().max(80).optional(),
    periode: z.string().max(10).optional(),
    jenis: z.string().max(20).optional(),
    hari: z.number().optional(),
    alasan: z.string().max(2000),
  })
  .strict();
export type PenyesuaianDraft = z.infer<typeof penyesuaianDraftSchema>;

export const saldoQuerySchema = z
  .object({
    id_karyawan: z.string().max(80).nullable().optional(),
    mulai: z.string().max(10).nullable().optional(),
    selesai: z.string().max(10).nullable().optional(),
  })
  .strict();

export interface BarisPenyesuaian {
  id_penyesuaian: string;
  periode: string;
  jenis: string;
  id_ref: string;
  hari: number;
  alasan: string;
  dicatat_oleh: string;
  created_at: string;
  dibatalkan: number;
}

/** Bentuk jawaban `desktop_hr_leave_balance` / `POST /api/pengajuan/leave/query`. */
export interface SaldoCuti {
  aturan: { guru: AturanCuti; tendik: AturanCuti };
  hari_ini: string;
  pegawai: {
    id_karyawan: string;
    nama: string;
    unit: string;
    kelompok: KelompokCuti;
    tmt: string;
    tanda: string[];
    berjalan: PeriodeCuti | null;
    penyesuaian: BarisPenyesuaian[];
    periode: PeriodeCuti[];
    riwayat: PengajuanTersusun[];
    hari_wajib?: number;
  } | null;
}

// Daftar (dipakai service Web; Rust susun_daftar)

export interface BarisKeputusan extends Keputusan {
  id_pengajuan: string;
  alasan: string;
  id_karyawan_oleh: string;
  unit_oleh: string;
}

export interface BarisPengajuan {
  id_pengajuan: string;
  id_karyawan: string;
  nama: string;
  unit: string;
  guru: number;
  id_jenis: string;
  nama_jenis: string;
  kelompok: string;
  potong_jatah: number;
  dampak_gaji: string;
  izin_pemutus: string;
  tanggal_mulai: string;
  tanggal_selesai: string;
  jam_mulai_ke: number | null;
  jam_sampai_ke: number | null;
  setengah_hari: number;
  alasan: string;
  sidik: string;
  diajukan_oleh: string;
  waktu_perangkat: string;
}

export interface PengajuanTersusun extends BarisPengajuan {
  status: StatusPengajuan;
  tanda: string[];
  keputusan: BarisKeputusan[];
}

/** Cermin `susun_daftar`: status, tanda, dan keputusan per pengajuan. */
export function susunDaftar(
  pengajuan: readonly BarisPengajuan[],
  keputusan: readonly BarisKeputusan[],
): PengajuanTersusun[] {
  const per = new Map<string, BarisKeputusan[]>();
  for (const k of keputusan) {
    per.set(k.id_pengajuan, [...(per.get(k.id_pengajuan) ?? []), k]);
  }
  const hasil = pengajuan.map((p): PengajuanTersusun => {
    const rows = per.get(p.id_pengajuan) ?? [];
    const berlaku = keputusanBerlaku(p.sidik, rows);
    const baris = berlaku
      ? rows.find((r) => r.id_keputusan === berlaku.id_keputusan)
      : undefined;
    const cakupan =
      baris && baris.id_karyawan_oleh !== ""
        ? dalamCakupan(false, baris.unit_oleh, p.unit)
        : null;
    return {
      ...p,
      status: statusPengajuan(p.sidik, rows),
      tanda: tandaKeputusan(p.sidik, p.diajukan_oleh, rows, cakupan),
      keputusan: rows,
    };
  });
  const aktif = hasil
    .map((p, i) => [i, p] as const)
    .filter(([, p]) => p.status === "Menunggu" || statusBerlaku(p.status));
  for (const [i, a] of aktif) {
    if (aktif.some(([j, b]) => i !== j && bentrokPengajuan(a, b))) {
      hasil[i].tanda.push("bertumpuk");
    }
  }
  return hasil;
}

// Kiriman layar (Zod .strict(), isi dinilai aturan di atas)

const jamKe = z.number().int().nullable().optional();

export const pengajuanDraftSchema = z
  .object({
    id_pengajuan: z.string().max(80).optional(),
    id_karyawan: z.string().max(80),
    id_jenis: z.string().max(80),
    tanggal_mulai: z.string().max(10),
    tanggal_selesai: z.string().max(10),
    jam_mulai_ke: jamKe,
    jam_sampai_ke: jamKe,
    setengah_hari: z.boolean().optional(),
    alasan: z.string().max(2000),
    urgent: z.boolean().optional(),
  })
  .strict();
export type PengajuanDraft = z.infer<typeof pengajuanDraftSchema>;

export const keputusanDraftSchema = z
  .object({
    id_pengajuan: z.string().min(1).max(80),
    aksi: z.enum(AKSI_KEPUTUSAN),
    alasan: z.string().max(2000),
  })
  .strict();

export const jenisDraftSchema = z
  .object({
    id_jenis: z.string().max(80).optional(),
    nama: z.string().max(200),
    kelompok: z.enum(KELOMPOK),
    izin_pemutus: z.enum(IZIN_PEMUTUS),
    boleh_urgent: z.boolean(),
    potong_jatah: z.boolean(),
    dampak_gaji: z.enum(DAMPAK_GAJI),
    maks_hari: z.number().int().nullable(),
    satuan_maks: z.enum(SATUAN_MAKS),
    wajib_dokumen: z.boolean(),
    is_aktif: z.boolean(),
  })
  .strict();
export type JenisDraft = z.infer<typeof jenisDraftSchema>;

export const daftarQuerySchema = z
  .object({ dari: z.string().max(10), sampai: z.string().max(10) })
  .strict();

/** Baris `JENIS_SQL` apa adanya (0/1). */
export interface BarisJenis {
  id_jenis: string;
  nama: string;
  kelompok: string;
  izin_pemutus: string;
  boleh_urgent: number;
  potong_jatah: number;
  wajib_dokumen: number;
  dampak_gaji: string;
  maks_hari: number | null;
  satuan_maks: string;
  is_aktif: number;
}

export interface PegawaiPengajuan {
  id_unik: string;
  nama: string;
  unit: string;
  guru: number;
}

/** Bentuk jawaban `desktop_hr_requests` / `POST /api/pengajuan/query`. */
export interface DaftarPengajuan {
  pengajuan: PengajuanTersusun[];
  /** JP terdampak dan yang belum ditangani per pengajuan guru (2c). */
  jp: Record<string, HitungJp>;
  jenis: BarisJenis[];
  pegawai: PegawaiPengajuan[];
  sesi: { id_karyawan: string; unit: string; lingkup_semua: boolean };
  dari: string;
  sampai: string;
}

export interface HasilSimpanPengajuan {
  pengajuan: Record<string, unknown>;
  peringatan: string | null;
}

// Sub-fase 2c: JP terdampak dan penanganannya (§20.2.5, §20.2.8, §20.2.9)

export const STATUS_PENANGANAN = [
  "Diganti",
  "Tugas Mandiri",
  "Digabung",
] as const;

export const JP_TERDAMPAK_SQL =
  "SELECT p.id_pengajuan, p.id_karyawan, COALESCE(m.nama, p.id_karyawan) AS nama_guru, p.tanggal_mulai, p.tanggal_selesai, p.jam_mulai_ke, p.jam_sampai_ke FROM hr_pengajuan p LEFT JOIN master_data m ON m.id_unik = p.id_karyawan WHERE p.tanggal_mulai <= ?2 AND p.tanggal_selesai >= ?1 AND (?3 = '' OR p.id_pengajuan = ?3) AND EXISTS (SELECT 1 FROM jadwal_mengajar j WHERE j.id_guru = p.id_karyawan AND j.is_aktif = 1) AND NOT EXISTS (SELECT 1 FROM hr_pengajuan_keputusan b WHERE b.id_pengajuan = p.id_pengajuan AND b.jenis = 'Batal') AND COALESCE((SELECT k.jenis FROM hr_pengajuan_keputusan k WHERE k.id_pengajuan = p.id_pengajuan AND k.sidik = p.sidik AND k.jenis IN ('Setujui', 'Tolak', 'Setujui Urgent') ORDER BY k.diterima_cloud IS NULL, k.diterima_cloud, k.waktu_perangkat, k.id_keputusan LIMIT 1), '') <> 'Tolak' ORDER BY p.tanggal_mulai, p.id_pengajuan\n-- batas: pengajuan guru yang bertumpuk rentang, sebesar jumlah guru kali pengajuan\n;";
export const JADWAL_JP_SQL =
  "SELECT j.id_jadwal, j.id_guru, j.hari, j.jam_ke, j.id_rombel, COALESCE(r.nama_rombel, j.id_rombel) AS nama_rombel, j.id_mapel, COALESCE(mp.nama_mapel, j.id_mapel) AS nama_mapel, COALESCE(u.nama_unit, '') AS unit, t.tanggal_mulai AS ta_mulai, t.tanggal_selesai AS ta_selesai FROM jadwal_mengajar j JOIN akademik_tahun_ajaran t ON t.id_tahun_ajaran = j.id_tahun_ajaran LEFT JOIN akademik_rombel r ON r.id_rombel = j.id_rombel LEFT JOIN akademik_mapel mp ON mp.id_mapel = j.id_mapel LEFT JOIN akademik_unit u ON u.id_unit = r.id_unit WHERE j.is_aktif = 1 AND t.tanggal_mulai <= ?2 AND t.tanggal_selesai >= ?1 ORDER BY j.id_guru, j.hari, CAST(j.jam_ke AS INTEGER), j.jam_ke, j.id_jadwal\n-- batas: jadwal mingguan semester yang bertumpuk rentang, sebesar rombel kali jam pelajaran\n;";
export const PENANGANAN_SQL =
  "SELECT h.id_penanganan, h.id_pengajuan, h.tanggal, h.id_jadwal, COALESCE(h.jam_ke, '') AS jam_ke, h.status, COALESCE(h.id_guru_pengganti, '') AS id_guru_pengganti, COALESCE(mg.nama, h.id_guru_pengganti, '') AS nama_pengganti, COALESCE(h.catatan, '') AS catatan, h.dicatat_oleh, h.waktu_perangkat FROM hr_jp_penanganan h JOIN hr_pengajuan p ON p.id_pengajuan = h.id_pengajuan LEFT JOIN master_data mg ON mg.id_unik = h.id_guru_pengganti WHERE h.tanggal >= ?1 AND h.tanggal <= ?2 AND NOT EXISTS (SELECT 1 FROM hr_pengajuan_keputusan b WHERE b.id_pengajuan = p.id_pengajuan AND b.jenis = 'Batal') AND COALESCE((SELECT k.jenis FROM hr_pengajuan_keputusan k WHERE k.id_pengajuan = p.id_pengajuan AND k.sidik = p.sidik AND k.jenis IN ('Setujui', 'Tolak', 'Setujui Urgent') ORDER BY k.diterima_cloud IS NULL, k.diterima_cloud, k.waktu_perangkat, k.id_keputusan LIMIT 1), '') <> 'Tolak' ORDER BY h.tanggal, h.id_penanganan\n-- batas: satu baris per JP terdampak dalam rentang\n;";
export const PRESENSI_JP_SQL =
  "SELECT id_rombel, tanggal, jam_ke, id_guru FROM presensi_mapel WHERE tanggal >= ?1 AND tanggal <= ?2 ORDER BY tanggal, id_rombel\n-- batas: sesi presensi kelas dalam rentang pengajuan\n;";
export const GURU_AKTIF_SQL =
  "SELECT 1 FROM master_data m JOIN guru_data g ON g.id_guru = m.id_unik WHERE m.id_unik = ?1 AND COALESCE(m.status_aktif, 'Aktif') = 'Aktif' LIMIT 1;";
export const CLOUD_PENANGANAN_SQL =
  "INSERT INTO hr_jp_penanganan (id_penanganan, id_pengajuan, tanggal, id_jadwal, id_rombel, id_mapel, jam_ke, status, id_guru_pengganti, catatan, dicatat_oleh, waktu_perangkat, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, NULLIF(?5, ''), NULLIF(?6, ''), NULLIF(?7, ''), ?8, NULLIF(?9, ''), NULLIF(?10, ''), ?11, ?12, datetime('now'), datetime('now')) ON CONFLICT(id_penanganan) DO UPDATE SET id_rombel = excluded.id_rombel, id_mapel = excluded.id_mapel, jam_ke = excluded.jam_ke, status = excluded.status, id_guru_pengganti = excluded.id_guru_pengganti, catatan = excluded.catatan, dicatat_oleh = excluded.dicatat_oleh, waktu_perangkat = excluded.waktu_perangkat, updated_at = excluded.updated_at;";

export const PESAN_JP_SENDIRI =
  "Jam pelajaranmu sendiri harus ditangani orang lain.";
export const PESAN_CAKUPAN_JP = "Rombel ini di luar unit yang kamu pegang.";
export const PESAN_BENTROK_PENGGANTI =
  "Guru pengganti sudah punya jadwal atau tugas pengganti lain di jam itu.";

export interface PengajuanJp {
  id_pengajuan: string;
  id_karyawan: string;
  nama_guru: string;
  tanggal_mulai: string;
  tanggal_selesai: string;
  jam_mulai_ke: number | null;
  jam_sampai_ke: number | null;
}

export interface JadwalJp {
  id_jadwal: string;
  id_guru: string;
  hari: number;
  jam_ke: string;
  id_rombel: string;
  nama_rombel: string;
  id_mapel: string;
  nama_mapel: string;
  unit: string;
  ta_mulai: string;
  ta_selesai: string;
}

export interface Jp {
  id_penanganan: string;
  id_pengajuan: string;
  id_karyawan: string;
  nama_guru: string;
  tanggal: string;
  id_jadwal: string;
  jam_ke: string;
  id_rombel: string;
  nama_rombel: string;
  id_mapel: string;
  nama_mapel: string;
  unit: string;
}

export interface Penanganan {
  id_penanganan: string;
  id_pengajuan: string;
  tanggal: string;
  id_jadwal: string;
  jam_ke: string;
  status: string;
  id_guru_pengganti: string;
  nama_pengganti: string;
  catatan: string;
  dicatat_oleh: string;
  waktu_perangkat: string;
}

export interface PresensiJp {
  id_rombel: string;
  tanggal: string;
  jam_ke: string;
  id_guru: string;
}

export interface JpTersusun extends Jp {
  penanganan: Penanganan | null;
  tanda: string[];
}

export const LABEL_TANDA_JP: Record<string, string> = {
  pengganti_berbeda: "Presensi kelas ini disimpan guru lain",
  pengganti_bentrok: "Pengganti punya jam lain di waktu yang sama",
};

/** Cermin `id_penanganan`. */
export const idPenanganan = (
  idPengajuan: string,
  tanggal: string,
  idJadwal: string,
) => `jp:${idPengajuan}:${tanggal}:${idJadwal}`;

const jamAwal = (jamKe: string) => rentangJamKe(jamKe)?.awal ?? 0;

function beririsan(a: string, b: string): boolean {
  const x = rentangJamKe(a);
  const y = rentangJamKe(b);
  return x !== null && y !== null && x.awal <= y.akhir && y.awal <= x.akhir;
}

const taMemuat = (j: JadwalJp, t: string) =>
  j.ta_mulai <= t && t <= j.ta_selesai;

/** Cermin `jp_terdampak` (§20.2.5, Q-46). */
export function jpTerdampak(
  pengajuan: readonly PengajuanJp[],
  jadwal: readonly JadwalJp[],
  libur: ReadonlySet<string>,
  dari: string,
  sampai: string,
): Jp[] {
  const hasil: Jp[] = [];
  for (const p of pengajuan) {
    const mulai = p.tanggal_mulai > dari ? p.tanggal_mulai : dari;
    const selesai = p.tanggal_selesai < sampai ? p.tanggal_selesai : sampai;
    for (const t of tanggalRentang(mulai, selesai)) {
      if (libur.has(t)) continue;
      const hari = hariIso(t);
      if (hari === null) continue;
      const [awal, akhir] = jamPada(p, t);
      for (const j of jadwal) {
        if (j.id_guru !== p.id_karyawan || j.hari !== hari || !taMemuat(j, t))
          continue;
        const r = rentangJamKe(j.jam_ke);
        if (r === null || !(r.awal <= akhir && awal <= r.akhir)) continue;
        hasil.push({
          id_penanganan: idPenanganan(p.id_pengajuan, t, j.id_jadwal),
          id_pengajuan: p.id_pengajuan,
          id_karyawan: p.id_karyawan,
          nama_guru: p.nama_guru,
          tanggal: t,
          id_jadwal: j.id_jadwal,
          jam_ke: j.jam_ke,
          id_rombel: j.id_rombel,
          nama_rombel: j.nama_rombel,
          id_mapel: j.id_mapel,
          nama_mapel: j.nama_mapel,
          unit: j.unit,
        });
      }
    }
  }
  return hasil.sort(
    (a, b) =>
      bandingTeks(a.tanggal, b.tanggal) ||
      jamAwal(a.jam_ke) - jamAwal(b.jam_ke) ||
      bandingTeks(a.id_penanganan, b.id_penanganan),
  );
}

/** Cermin `pengganti_bentrok`. */
export function penggantiBentrok(
  pengganti: string,
  status: string,
  tanggal: string,
  jamKe: string,
  idSendiri: string,
  jadwal: readonly JadwalJp[],
  penanganan: readonly Penanganan[],
): boolean {
  if (pengganti === "" || status === "Tugas Mandiri") return false;
  const hari = hariIso(tanggal);
  const jadwalBentrok =
    status === "Diganti" &&
    jadwal.some(
      (j) =>
        j.id_guru === pengganti &&
        j.hari === hari &&
        taMemuat(j, tanggal) &&
        beririsan(j.jam_ke, jamKe),
    );
  return (
    jadwalBentrok ||
    penanganan.some(
      (h) =>
        h.id_penanganan !== idSendiri &&
        h.id_guru_pengganti === pengganti &&
        h.tanggal === tanggal &&
        (status === "Diganti" || h.status === "Diganti") &&
        beririsan(h.jam_ke, jamKe),
    )
  );
}

/** Cermin `susun_jp`. */
export function susunJp(
  jp: readonly Jp[],
  penanganan: readonly Penanganan[],
  presensi: readonly PresensiJp[],
  jadwal: readonly JadwalJp[],
): JpTersusun[] {
  return jp.map((j) => {
    const h = penanganan.find((x) => x.id_penanganan === j.id_penanganan);
    const tanda: string[] = [];
    if (h) {
      const pengganti = h.id_guru_pengganti;
      if (
        pengganti !== "" &&
        presensi.some(
          (s) =>
            s.id_rombel === j.id_rombel &&
            s.tanggal === j.tanggal &&
            s.id_guru !== pengganti &&
            beririsan(s.jam_ke, j.jam_ke),
        )
      ) {
        tanda.push("pengganti_berbeda");
      }
      if (
        penggantiBentrok(
          pengganti,
          h.status,
          j.tanggal,
          j.jam_ke,
          j.id_penanganan,
          jadwal,
          penanganan,
        )
      ) {
        tanda.push("pengganti_bentrok");
      }
    }
    return { ...j, penanganan: h ?? null, tanda };
  });
}

export interface HitungJp {
  total: number;
  belum: number;
}

/** Cermin `hitung_jp`. */
export function hitungJp(
  jp: readonly Jp[],
  ditangani: ReadonlySet<string>,
): Record<string, HitungJp> {
  const hasil: Record<string, HitungJp> = {};
  for (const j of jp) {
    const h = hasil[j.id_pengajuan] ?? { total: 0, belum: 0 };
    hasil[j.id_pengajuan] = h;
    h.total += 1;
    if (!ditangani.has(j.id_penanganan)) h.belum += 1;
  }
  return hasil;
}

export interface PenangananSah {
  id_pengajuan: string;
  tanggal: string;
  id_jadwal: string;
  status: string;
  id_guru_pengganti: string;
  catatan: string;
}

/** Cermin `validasi_penanganan`. */
export function validasiPenanganan(draft: Draft): Hasil<PenangananSah> {
  const id_pengajuan = teks(draft, "id_pengajuan");
  const id_jadwal = teks(draft, "id_jadwal");
  if (id_pengajuan === "" || id_jadwal === "") {
    return gagal("Jam pelajaran yang ditangani tidak dikenal.");
  }
  const tanggal = teks(draft, "tanggal");
  if (!tanggalValid(tanggal)) return gagal("Tanggal tidak valid.");
  const status = teks(draft, "status");
  if (!termasuk(STATUS_PENANGANAN, status)) {
    return gagal("Status penanganan tidak dikenal.");
  }
  const id_guru_pengganti =
    status === "Tugas Mandiri" ? "" : teks(draft, "id_guru_pengganti");
  if (status !== "Tugas Mandiri" && id_guru_pengganti === "") {
    return gagal("Pilih guru pengganti.");
  }
  const catatan = teks(draft, "catatan");
  if (panjang(catatan) > MAKS_ALASAN) {
    return gagal(`Catatan maksimal ${MAKS_ALASAN} karakter.`);
  }
  return ok({
    id_pengajuan,
    tanggal,
    id_jadwal,
    status,
    id_guru_pengganti,
    catatan,
  });
}

/** Cermin `periksa_penanganan`. */
export function periksaPenanganan(
  guruJp: string,
  pengganti: string,
  sesiKaryawan: string,
  cakupan: boolean,
): Hasil<null> {
  if (sesiKaryawan !== "" && sesiKaryawan === guruJp) {
    return gagal(PESAN_JP_SENDIRI);
  }
  if (!cakupan) return gagal(PESAN_CAKUPAN_JP);
  if (pengganti !== "" && pengganti === guruJp) {
    return gagal("Guru pengganti tidak boleh guru yang berhalangan.");
  }
  return ok(null);
}

export const penangananDraftSchema = z
  .object({
    id_pengajuan: z.string().max(80),
    tanggal: z.string().max(10),
    id_jadwal: z.string().max(80),
    status: z.enum(STATUS_PENANGANAN),
    id_guru_pengganti: z.string().max(80).optional(),
    catatan: z.string().max(2000).optional(),
  })
  .strict();
export type PenangananDraft = z.infer<typeof penangananDraftSchema>;

const draftJpSchema = z
  .object({
    id_karyawan: z.string().max(80),
    tanggal_mulai: z.string().max(10),
    tanggal_selesai: z.string().max(10),
    jam_mulai_ke: jamKe,
    jam_sampai_ke: jamKe,
  })
  .strict();

export const jpQuerySchema = z
  .object({
    id_pengajuan: z.string().max(80).nullable().optional(),
    tanggal: z.string().max(10).nullable().optional(),
    draft: draftJpSchema.nullable().optional(),
  })
  .strict();
export type DraftJp = z.infer<typeof draftJpSchema>;

/** Bentuk jawaban `desktop_hr_affected_jp` / `POST /api/pengajuan/jp/query`. */
export interface DaftarJp {
  jp: JpTersusun[];
  jadwal?: JadwalJp[];
  penanganan?: Penanganan[];
  guru?: PegawaiPengajuan[];
  dari: string;
  sampai: string;
  sesi: { id_karyawan: string; unit: string; lingkup_semua: boolean };
}

export interface HasilSimpanPenanganan {
  penanganan: Record<string, unknown>;
  peringatan: string | null;
}

/** Jawaban `desktop_hr_my_substitutions` / `POST /api/pengajuan/jp/mine/query`. */
export interface GantiSaya {
  tanggal: string;
  jp: JpTersusun[];
}
