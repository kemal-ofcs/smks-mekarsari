/**
 * Validasi impor Excel guru & siswa — murni, tanpa DOM, supaya bisa diuji.
 *
 * Membaca berkas dan menyimpannya ada di `lib/client/personnel-workbook.ts`;
 * modul ini hanya mengubah baris teks menjadi draft yang siap dikirim ke
 * `simpanSiswa`/`simpanGuru`, dan menolak SELURUH berkas bila satu baris saja
 * cacat — lebih baik operator memperbaiki satu sel lalu mengulang daripada
 * separuh kelas terimpor dan separuhnya tidak.
 *
 * Rombel dan shift dicari lewat NAMA rombel dan KODE shift, bukan id: operator
 * mengetik "X-A" dan "1", bukan `rom_0f34…`. Kolom `id_rombel` tetap diterima
 * (dan ikut diekspor) supaya ekspor → sunting → impor ulang tidak pernah
 * ambigu ketika dua tahun ajaran punya rombel bernama sama.
 */

import type { SiswaInput } from "@/lib/gateways/student";
import type { GuruInput } from "@/lib/gateways/teacher";
import { normalizeOperatorPhone } from "@/lib/operators/contact";
import { normalizeStatusSiswa, STATUS_KEPEGAWAIAN_GURU } from "./personnel";

/** Batas baris per berkas: satu angkatan besar, bukan seluruh sekolah sekaligus. */
export const MAX_PERSONNEL_IMPORT_ROWS = 1000;

export const STUDENT_WORKBOOK_HEADERS = [
  "id_siswa",
  // Kode personil di data induk; kosong = memakai NIS. Berkas lama yang masih
  // berjudul `kode_karyawan` tetap diterima saat impor.
  "kode_personil",
  "nis",
  "nisn",
  "nama_lengkap",
  "jenis_kelamin",
  "nama_rombel",
  "id_rombel",
  "kode_shift",
  "nama_wali",
  "no_whatsapp_wali",
  "alamat",
  "angkatan",
  "status",
  "unit",
] as const;

export const TEACHER_WORKBOOK_HEADERS = [
  "id_guru",
  "kode_karyawan",
  "nama",
  "gelar",
  "nip",
  "nuptk",
  "spesialisasi_mapel",
  "status_kepegawaian",
  "lp",
  "no_hp",
  "kode_shift",
  "status_aktif",
  "unit",
] as const;

export interface ImportRow<T> {
  /** Nomor baris di Excel (judul = baris 1), untuk pesan ke operator. */
  baris: number;
  draft: T;
}

export interface ImportLookups {
  rombel: Record<string, unknown>[];
  shifts: Record<string, unknown>[];
}

type Cell = (row: readonly string[], header: string) => string;

/**
 * Pembaca sel per nama kolom (tidak peka huruf besar/kecil) untuk baris data.
 * Melempar bila salah satu kolom wajib tidak ada di baris judul.
 */
export function workbookColumns(
  headerRow: readonly string[],
  required: readonly string[],
): Cell {
  const headings = new Map<string, number>();
  headerRow.forEach((h, idx) => {
    headings.set(h.toLowerCase().trim(), idx);
  });
  for (const column of required) {
    if (!headings.has(column)) {
      throw new Error(
        `Kolom wajib '${column}' tidak ditemukan di baris judul Excel.`,
      );
    }
  }
  return (row, header) => {
    const colIdx = headings.get(header);
    return colIdx !== undefined && colIdx < row.length
      ? (row[colIdx] ?? "").trim()
      : "";
  };
}

function key(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

/**
 * Tolak angka yang sudah dirusak Excel. Sel yang diketik tanpa format Teks
 * disimpan sebagai angka: NIP 18 digit menjadi `1.98701012010011E+17`, dan
 * digit di luar presisi 15 digit itu hilang permanen, jadi tidak bisa
 * dipulihkan, hanya ditolak.
 */
export function teksIdentitas(
  value: string,
  kolom: string,
  baris: number,
): string {
  if (/^[\d.]+e[+-]?\d+$/i.test(value)) {
    throw new Error(
      `Baris ${baris}: ${kolom} '${value}' sudah diubah Excel menjadi angka. Format kolom ${kolom} sebagai Teks, ketik ulang, lalu impor lagi.`,
    );
  }
  return value;
}

/**
 * Tanggal dari sel Excel: `YYYY-MM-DD` apa adanya, atau nomor seri tanggal
 * Excel (hari sejak 1899-12-30) yang muncul bila sel diformat Tanggal.
 */
export function tanggalExcel(
  value: string,
  kolom: string,
  baris: number,
): string | undefined {
  if (!value) return undefined;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  if (/^\d{4,6}(\.\d+)?$/.test(value)) {
    const ms = Date.UTC(1899, 11, 30) + Math.floor(Number(value)) * 86_400_000;
    return new Date(ms).toISOString().slice(0, 10);
  }
  throw new Error(
    `Baris ${baris}: ${kolom} '${value}' harus berformat YYYY-MM-DD, misalnya 2026-07-15.`,
  );
}

/** `kode_shift` → `id_shift` perangkat ini. Kosong = biarkan backend memilih. */
export function resolveShift(
  kode: string,
  shifts: ImportLookups["shifts"],
  baris: number,
): number | undefined {
  if (!kode) return undefined;
  const cocok = shifts.find((s) => key(s.kode_shift) === key(kode));
  if (!cocok) {
    throw new Error(
      `Baris ${baris}: kode_shift '${kode}' tidak ada. Lihat kode shift di menu Shift.`,
    );
  }
  return Number(cocok.id_shift);
}

function resolveRombel(
  idRombel: string,
  namaRombel: string,
  rombel: ImportLookups["rombel"],
  baris: number,
): string {
  if (idRombel) {
    if (rombel.some((r) => String(r.id_rombel) === idRombel)) return idRombel;
    throw new Error(`Baris ${baris}: id_rombel '${idRombel}' tidak ditemukan.`);
  }
  if (!namaRombel) {
    throw new Error(`Baris ${baris}: nama_rombel wajib diisi.`);
  }
  const cocok = rombel.filter((r) => key(r.nama_rombel) === key(namaRombel));
  if (cocok.length === 0) {
    throw new Error(
      `Baris ${baris}: rombel '${namaRombel}' belum ada. Buat dulu di Struktur Akademik.`,
    );
  }
  if (cocok.length > 1) {
    throw new Error(
      `Baris ${baris}: ada ${cocok.length} rombel bernama '${namaRombel}' (beda tahun ajaran). Isi kolom id_rombel — salin dari hasil Ekspor.`,
    );
  }
  return String(cocok[0].id_rombel);
}

export function jenisKelamin(raw: string, baris: number): "L" | "P" {
  const value = key(raw);
  if (!value || value === "l" || value === "laki-laki") return "L";
  if (value === "p" || value === "perempuan") return "P";
  throw new Error(`Baris ${baris}: jenis kelamin '${raw}' harus L atau P.`);
}

function assertUniqueInFile(
  seen: Set<string>,
  value: string,
  label: string,
  baris: number,
) {
  if (!value) return;
  const k = key(value);
  if (seen.has(k)) {
    throw new Error(
      `Baris ${baris}: ${label} '${value}' muncul dua kali di file.`,
    );
  }
  seen.add(k);
}

function dataRows(rows: string[][], kind: string) {
  if (rows.length < 2) {
    throw new Error(`Tidak ada data ${kind} yang ditemukan di file.`);
  }
  if (rows.length - 1 > MAX_PERSONNEL_IMPORT_ROWS) {
    throw new Error(
      `Maksimal ${MAX_PERSONNEL_IMPORT_ROWS} ${kind} per file. Pecah berkasnya per rombel atau per angkatan.`,
    );
  }
  return rows.slice(1).map((row, index) => ({ row, baris: index + 2 }));
}

export function parseStudentRows(
  rows: string[][],
  lookups: ImportLookups,
  tahunSekarang = new Date().getFullYear(),
): ImportRow<SiswaInput>[] {
  const val = workbookColumns(rows[0] || [], ["nama_lengkap"]);
  const nisTerpakai = new Set<string>();
  const nisnTerpakai = new Set<string>();
  const hasil: ImportRow<SiswaInput>[] = [];

  for (const { row, baris } of dataRows(rows, "siswa")) {
    const nama = val(row, "nama_lengkap");
    if (!nama && !val(row, "nis") && !val(row, "id_siswa")) continue;
    if (!nama) throw new Error(`Baris ${baris}: nama_lengkap wajib diisi.`);

    const nis = teksIdentitas(val(row, "nis"), "nis", baris);
    const nisn = teksIdentitas(val(row, "nisn"), "nisn", baris);
    const kodePersonil = teksIdentitas(
      val(row, "kode_personil") || val(row, "kode_karyawan"),
      "kode_personil",
      baris,
    );
    assertUniqueInFile(nisTerpakai, nis, "NIS", baris);
    assertUniqueInFile(nisnTerpakai, nisn, "NISN", baris);

    const statusMentah = val(row, "status");
    const status = statusMentah ? normalizeStatusSiswa(statusMentah) : "Aktif";
    if (!status) {
      throw new Error(
        `Baris ${baris}: status '${statusMentah}' tidak dikenal. Pakai Aktif, Lulus, Pindah, Keluar, atau Drop Out.`,
      );
    }

    const angkatanMentah = val(row, "angkatan");
    const angkatan = angkatanMentah ? Number(angkatanMentah) : tahunSekarang;
    if (!Number.isInteger(angkatan) || angkatan < 2000 || angkatan > 2100) {
      throw new Error(
        `Baris ${baris}: angkatan '${angkatanMentah}' harus tahun, misalnya ${tahunSekarang}.`,
      );
    }

    const waMentah = teksIdentitas(
      val(row, "no_whatsapp_wali"),
      "no_whatsapp_wali",
      baris,
    );
    if (waMentah && !normalizeOperatorPhone(waMentah)) {
      throw new Error(
        `Baris ${baris}: nomor WhatsApp wali '${waMentah}' tidak valid. Gunakan 08xxxxxxxxxx atau +62xxxxxxxxxx.`,
      );
    }

    hasil.push({
      baris,
      draft: {
        id_siswa: val(row, "id_siswa") || undefined,
        kode_karyawan: kodePersonil || undefined,
        nama_lengkap: nama,
        nis: nis || null,
        nisn: nisn || null,
        jenis_kelamin: jenisKelamin(val(row, "jenis_kelamin"), baris),
        id_rombel: resolveRombel(
          val(row, "id_rombel"),
          val(row, "nama_rombel"),
          lookups.rombel,
          baris,
        ),
        nama_wali: val(row, "nama_wali") || null,
        no_whatsapp_wali: waMentah || null,
        alamat: val(row, "alamat") || null,
        angkatan,
        status,
        id_shift: resolveShift(val(row, "kode_shift"), lookups.shifts, baris),
        // Nama unit apa adanya. Sengaja TIDAK divalidasi terhadap daftar
        // `akademik_unit`: berkas impor sering disiapkan sebelum unitnya
        // didaftarkan, dan menolak seluruh berkas karena itu jauh lebih mahal
        // daripada satu dropdown yang perlu diperbaiki belakangan.
        unit: val(row, "unit") || undefined,
      },
    });
  }

  if (hasil.length === 0) {
    throw new Error("Tidak ada data siswa untuk diimpor.");
  }
  return hasil;
}

export function parseTeacherRows(
  rows: string[][],
  lookups: Pick<ImportLookups, "shifts">,
): ImportRow<GuruInput>[] {
  const val = workbookColumns(rows[0] || [], ["nama"]);
  const nipTerpakai = new Set<string>();
  const kodeTerpakai = new Set<string>();
  const hasil: ImportRow<GuruInput>[] = [];

  for (const { row, baris } of dataRows(rows, "guru")) {
    const nama = val(row, "nama");
    if (!nama && !val(row, "nip") && !val(row, "id_guru")) continue;
    if (!nama) throw new Error(`Baris ${baris}: nama wajib diisi.`);

    const nip = teksIdentitas(val(row, "nip"), "nip", baris);
    const kode = teksIdentitas(
      val(row, "kode_karyawan"),
      "kode_karyawan",
      baris,
    );
    assertUniqueInFile(nipTerpakai, nip, "NIP", baris);
    assertUniqueInFile(kodeTerpakai, kode, "kode_karyawan", baris);

    const statusPegMentah = val(row, "status_kepegawaian");
    const statusPeg = statusPegMentah
      ? STATUS_KEPEGAWAIAN_GURU.find((s) => key(s) === key(statusPegMentah))
      : "Honorer";
    if (!statusPeg) {
      throw new Error(
        `Baris ${baris}: status_kepegawaian '${statusPegMentah}' tidak dikenal. Pakai ${STATUS_KEPEGAWAIAN_GURU.join(", ")}.`,
      );
    }

    const statusAktifMentah = key(val(row, "status_aktif"));
    if (
      statusAktifMentah &&
      !["aktif", "nonaktif"].includes(statusAktifMentah)
    ) {
      throw new Error(
        `Baris ${baris}: status_aktif '${val(row, "status_aktif")}' harus Aktif atau Nonaktif.`,
      );
    }

    hasil.push({
      baris,
      draft: {
        id_guru: val(row, "id_guru") || undefined,
        nama,
        kode_karyawan: kode || undefined,
        gelar: val(row, "gelar") || null,
        nip: nip || null,
        nuptk: teksIdentitas(val(row, "nuptk"), "nuptk", baris) || null,
        spesialisasi_mapel: val(row, "spesialisasi_mapel") || null,
        status_kepegawaian: statusPeg,
        lp: jenisKelamin(val(row, "lp"), baris),
        no_hp: teksIdentitas(val(row, "no_hp"), "no_hp", baris) || null,
        id_shift: resolveShift(val(row, "kode_shift"), lookups.shifts, baris),
        status_aktif: statusAktifMentah === "nonaktif" ? "Nonaktif" : "Aktif",
        // Kolom `unit` sudah ikut diekspor; tanpa ini unit guru hilang pada
        // setiap siklus ekspor → sunting → impor ulang.
        unit: val(row, "unit") || undefined,
      },
    });
  }

  if (hasil.length === 0) {
    throw new Error("Tidak ada data guru untuk diimpor.");
  }
  return hasil;
}

/** `id_shift` perangkat ini → `kode_shift` yang stabil untuk berkas ekspor. */
export function shiftCodeOf(
  idShift: unknown,
  shifts: ImportLookups["shifts"],
): string {
  const cocok = shifts.find((s) => Number(s.id_shift) === Number(idShift));
  return cocok ? String(cocok.kode_shift ?? "") : "";
}
