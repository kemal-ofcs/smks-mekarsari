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

/** `kode_shift` → `id_shift` perangkat ini. Kosong = biarkan backend memilih. */
function resolveShift(
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

function jenisKelamin(raw: string, baris: number): "L" | "P" {
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

    const nis = val(row, "nis");
    const nisn = val(row, "nisn");
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

    const waMentah = val(row, "no_whatsapp_wali");
    if (waMentah && !normalizeOperatorPhone(waMentah)) {
      throw new Error(
        `Baris ${baris}: nomor WhatsApp wali '${waMentah}' tidak valid. Gunakan 08xxxxxxxxxx atau +62xxxxxxxxxx.`,
      );
    }

    hasil.push({
      baris,
      draft: {
        id_siswa: val(row, "id_siswa") || undefined,
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

    const nip = val(row, "nip");
    const kode = val(row, "kode_karyawan");
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
        nuptk: val(row, "nuptk") || null,
        spesialisasi_mapel: val(row, "spesialisasi_mapel") || null,
        status_kepegawaian: statusPeg,
        lp: jenisKelamin(val(row, "lp"), baris),
        no_hp: val(row, "no_hp") || null,
        id_shift: resolveShift(val(row, "kode_shift"), lookups.shifts, baris),
        status_aktif: statusAktifMentah === "nonaktif" ? "Nonaktif" : "Aktif",
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
