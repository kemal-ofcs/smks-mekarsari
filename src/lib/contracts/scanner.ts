/**
 * Nilai sah kolom `absensi_harian.sumber` dan `log_scan.sumber_data`.
 *
 * Ini satu-satunya tempat daftar itu dieja. Daftarnya WAJIB identik dengan CHECK
 * constraint di DDL cloud (`turso.rs`); SQLite lokal tidak memilikinya, jadi
 * nilai di luar daftar akan tersimpan mulus di perangkat lalu ditolak permanen
 * saat push — event-nya macet di outbox tanpa pernah bisa berhasil.
 *
 * Sebelumnya daftar ini dieja ulang di tiga berkas dan ketiganya sudah berbeda:
 * dua di antaranya kehilangan `"Import Manual"` yang justru diizinkan database.
 */
export const ATTENDANCE_SOURCE_VALUES = [
  "Scanner",
  "Koreksi Admin",
  "Import Offline",
  "Import Manual",
  "Generate Sistem",
] as const;

export type AttendanceSource = (typeof ATTENDANCE_SOURCE_VALUES)[number];

/**
 * Nilai bawaan ketika sebuah baris absensi tiba tanpa `sumber` yang dinyatakan.
 *
 * Dua alasan memilih `Generate Sistem`: ia jujur (memang tidak ada yang
 * menyatakan sumbernya), dan ia PRIORITAS TERENDAH dalam hierarki rekonsiliasi
 * — sehingga baris tanpa sumber tidak akan pernah menimpa `Koreksi Admin` atau
 * catatan scanner yang sah.
 *
 * Bawaannya WAJIB salah satu anggota `ATTENDANCE_SOURCE_VALUES`. Nilai di luar
 * daftar itu ditolak CHECK constraint cloud, dan penolakan pada push outbox
 * membekukan seluruh antrean sinkronisasi perangkat secara permanen.
 */
export const DEFAULT_ATTENDANCE_SOURCE: AttendanceSource = "Generate Sistem";

/** Peran personil sebagaimana ditampilkan terminal pemindai. */
export const PERSONNEL_ROLES = ["Siswa", "Guru", "Pegawai"] as const;

export type PersonnelRole = (typeof PERSONNEL_ROLES)[number];

/**
 * Normalisasi `master_data.jenis_personil` menjadi peran untuk tampilan.
 *
 * Kolom itu menyimpan DUA ejaan yang berbeda dan keduanya sah secara historis:
 * `academic.rs` menulis `GURU`/`SISWA` (huruf besar) sesuai kontrak Fase 1,
 * sedangkan jalur karyawan lama menulis `Pegawai` (kapital awal). Terminal
 * pemindai sempat membandingkannya langsung dengan `"Siswa"`/`"Guru"`, sehingga
 * TIDAK PERNAH cocok: setiap siswa dan guru jatuh ke cabang pegawai — tanpa
 * lonceng, tanpa sapaan sekolah, dan tanpa lencana peran.
 *
 * Perbandingan dilakukan case-insensitive di satu tempat ini supaya kedua ejaan
 * tetap dikenali tanpa perlu memigrasi data yang sudah tersimpan.
 */
export function normalizePersonnelRole(
  raw: string | null | undefined,
): PersonnelRole {
  switch (
    String(raw ?? "")
      .trim()
      .toUpperCase()
  ) {
    case "SISWA":
      return "Siswa";
    case "GURU":
      return "Guru";
    default:
      return "Pegawai";
  }
}

export interface ScanTerminalInput {
  qrContent: string;
  lat?: number;
  lng?: number;
  kodeOperator?: string;
  sumberData?: AttendanceSource;
  /**
   * Foto bukti absensi, base64 murni tanpa awalan data URL.
   *
   * Wajib ketika role operator terminal menyalakan sakelar "Wajib foto bukti"
   * di halaman Master Operator. Alamat IP TIDAK ada di sini dengan sengaja:
   * pada Web ia dibaca server dari header proxy, dan pada Desktop/Mobile dari
   * perangkat itu sendiri — nilai kiriman klien bisa dikarang.
   */
  fotoBase64?: string;
  fotoMime?: "image/jpeg" | "image/png" | "image/webp";
}

export interface ScanResult {
  sukses: boolean;
  status: "Berhasil" | "Ditolak" | "Perlu Verifikasi" | "Error";
  jenisScan: string;
  idKaryawan: string;
  nama: string;
  divisi: string;
  jenisPersonil?: string;
  pesan: string;
  catatanSistem?: string;
  keterangan?: string;
  menitTerlambat?: number;
  menitDatangAwal?: number;
  jamKerja?: number;
  lembur?: number;
  jamKerjaKurang?: number;
  shiftEfektif?: number;
  modeTugas?: "NORMAL" | "PENGGANTI";
  idSesi?: string;
  revision?: number;
}
