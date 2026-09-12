"use client";

/**
 * Impor & ekspor Excel untuk halaman Guru dan Peserta Didik.
 *
 * Setiap baris disimpan lewat `simpanSiswa`/`simpanGuru` yang SAMA dengan
 * formulir — tidak ada jalur tulis massal kedua. Karena itu validasi backend,
 * token QR, baris `master_data`, dan event outbox-nya identik dengan data yang
 * diketik satu per satu, dan tidak ada route sinkronisasi baru yang harus
 * dijaga tetap sepadan di empat lapis.
 */

import type { SiswaInput } from "@/lib/gateways/student";
import type { GuruInput } from "@/lib/gateways/teacher";
import {
  type ImportLookups,
  type ImportRow,
  parseStudentRows,
  parseTeacherRows,
  STUDENT_WORKBOOK_HEADERS,
  shiftCodeOf,
  TEACHER_WORKBOOK_HEADERS,
} from "@/lib/validations/personnel-import";
import { readWorkbookRows, saveWorkbook } from "./xlsx";

export interface PersonnelImportReport {
  berhasil: number;
  gagal: { baris: number; pesan: string }[];
}

export async function readStudentWorkbook(
  file: File,
  lookups: ImportLookups,
): Promise<ImportRow<SiswaInput>[]> {
  return parseStudentRows(await readWorkbookRows(file), lookups);
}

export async function readTeacherWorkbook(
  file: File,
  lookups: Pick<ImportLookups, "shifts">,
): Promise<ImportRow<GuruInput>[]> {
  return parseTeacherRows(await readWorkbookRows(file), lookups);
}

/**
 * Simpan baris demi baris. Penolakan backend (misalnya NIS yang sudah dipakai
 * siswa lain di database) dicatat per baris dan impor berlanjut: berkasnya
 * sendiri sudah lolos validasi, jadi yang tersisa hanya tabrakan dengan data
 * yang sudah ada — dan operator perlu tahu SEMUA baris yang bentrok sekaligus.
 */
export async function runPersonnelImport<T>(
  items: ImportRow<T>[],
  simpan: (draft: T) => Promise<unknown>,
): Promise<PersonnelImportReport> {
  const report: PersonnelImportReport = { berhasil: 0, gagal: [] };
  for (const item of items) {
    try {
      await simpan(item.draft);
      report.berhasil += 1;
    } catch (error) {
      report.gagal.push({
        baris: item.baris,
        pesan: error instanceof Error ? error.message : "Gagal disimpan.",
      });
    }
  }
  return report;
}

/** Ringkasan untuk banner: jumlah, lalu lima kegagalan pertama. */
export function describeImportReport(
  report: PersonnelImportReport,
  kind: string,
): string {
  const ringkas = `Impor ${kind} selesai: ${report.berhasil} tersimpan, ${report.gagal.length} gagal.`;
  if (report.gagal.length === 0) return ringkas;
  const contoh = report.gagal
    .slice(0, 5)
    .map((item) => `Baris ${item.baris}: ${item.pesan}`)
    .join(" · ");
  const sisa =
    report.gagal.length > 5 ? ` (+${report.gagal.length - 5} lainnya)` : "";
  return `${ringkas} ${contoh}${sisa}`;
}

const tanggal = () => new Date().toLocaleDateString("en-CA");

export function exportStudents(
  rows: Record<string, unknown>[],
  shifts: ImportLookups["shifts"],
) {
  return saveWorkbook({
    headers: STUDENT_WORKBOOK_HEADERS,
    rows: rows.map((row) => ({
      ...row,
      kode_shift: shiftCodeOf(row.id_shift, shifts),
    })),
    filename: `peserta-didik-${tanggal()}.xlsx`,
    sheetName: "Peserta Didik",
  });
}

export function downloadStudentTemplate(lookups: ImportLookups) {
  const rombel = lookups.rombel[0];
  const shift = lookups.shifts[0];
  return saveWorkbook({
    headers: STUDENT_WORKBOOK_HEADERS,
    rows: [
      {
        nis: "2026001",
        nisn: "0012345678",
        nama_lengkap: "Nama Siswa",
        jenis_kelamin: "L",
        nama_rombel: rombel ? String(rombel.nama_rombel) : "X-A",
        kode_shift: shift ? String(shift.kode_shift ?? "") : "1",
        nama_wali: "Nama Orang Tua",
        no_whatsapp_wali: "08123456789",
        alamat: "",
        angkatan: new Date().getFullYear(),
        status: "Aktif",
      },
    ],
    filename: "template-import-peserta-didik.xlsx",
    sheetName: "Peserta Didik",
  });
}

export function exportTeachers(
  rows: Record<string, unknown>[],
  shifts: ImportLookups["shifts"],
) {
  return saveWorkbook({
    headers: TEACHER_WORKBOOK_HEADERS,
    rows: rows.map((row) => ({
      ...row,
      kode_shift: shiftCodeOf(row.id_shift, shifts),
    })),
    filename: `guru-ptk-${tanggal()}.xlsx`,
    sheetName: "Guru PTK",
  });
}

export function downloadTeacherTemplate(shifts: ImportLookups["shifts"]) {
  const shift = shifts[0];
  return saveWorkbook({
    headers: TEACHER_WORKBOOK_HEADERS,
    rows: [
      {
        nama: "Nama Guru",
        gelar: "S.Pd.",
        nip: "198701012010011001",
        nuptk: "",
        spesialisasi_mapel: "Matematika",
        status_kepegawaian: "Honorer",
        lp: "L",
        no_hp: "08123456789",
        kode_shift: shift ? String(shift.kode_shift ?? "") : "1",
        status_aktif: "Aktif",
      },
    ],
    filename: "template-import-guru.xlsx",
    sheetName: "Guru PTK",
  });
}
