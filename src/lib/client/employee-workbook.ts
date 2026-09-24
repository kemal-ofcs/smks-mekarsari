"use client";

import type { KaryawanInput } from "@/lib/gateways/employee";
import { normalizeOperatorPhone } from "@/lib/operators/contact";
import {
  type ImportLookups,
  type ImportRow,
  jenisKelamin,
  resolveShift,
  shiftCodeOf,
  tanggalExcel,
  teksIdentitas,
  workbookColumns,
} from "@/lib/validations/personnel-import";
import {
  firstValidationMessage,
  validateEmployeeDraft,
} from "@/lib/validations/stabilization";
import { readWorkbookRows, saveWorkbook } from "./xlsx";

/**
 * Shift ditulis sebagai `kode_shift`, bukan `id_shift`: id itu AUTOINCREMENT
 * yang bisa berbeda di tiap perangkat, sehingga berkas ekspor dari satu
 * Desktop menunjuk shift lain begitu diimpor di perangkat lain. Berkas lama
 * yang masih punya kolom `id_shift` tetap diterima.
 */
const HEADERS = [
  "id_unik",
  "kode_karyawan",
  "nama",
  "divisi",
  "jabatan_status",
  "no_hp",
  "lp",
  "kode_shift",
  "status_aktif",
  "tanggal_daftar",
  "catatan",
  "jenis_personil",
  "tanggal_mulai_aktif",
  "tanggal_selesai_aktif",
  "unit",
] as const;

export async function readEmployeeWorkbook(
  file: File,
  shifts: ImportLookups["shifts"],
): Promise<ImportRow<KaryawanInput>[]> {
  const rows = await readWorkbookRows(file);

  if (rows.length < 2) {
    throw new Error("Tidak ada data karyawan yang ditemukan di file.");
  }

  const val = workbookColumns(rows[0] || [], [
    "id_unik",
    "kode_karyawan",
    "nama",
    "divisi",
  ]);

  const hasil: ImportRow<KaryawanInput>[] = [];
  const ids = new Set<string>();
  const codes = new Set<string>();

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    // Baris 1 Excel adalah judul, jadi indeks i = baris Excel i + 1.
    const baris = i + 1;

    if (!val(row, "id_unik") && !val(row, "nama")) continue;

    // Siswa dan guru dikelola di halamannya sendiri: baris data induk yang
    // lahir dari sini tidak punya `siswa_data`/`guru_data`, sehingga tidak
    // pernah muncul di halaman Peserta Didik maupun Guru.
    const jenis = val(row, "jenis_personil") || "Pegawai";
    if (["siswa", "guru"].includes(jenis.trim().toLowerCase())) {
      throw new Error(
        `Baris ${baris}: jenis_personil '${jenis}' diimpor lewat halaman ${jenis.trim().toLowerCase() === "siswa" ? "Peserta Didik" : "Guru / PTK"}, bukan Karyawan.`,
      );
    }

    const kodeShift = val(row, "kode_shift");
    const idShiftLama = val(row, "id_shift");
    let idShift = resolveShift(kodeShift, shifts, baris);
    if (idShift === undefined && idShiftLama) {
      idShift = Number(idShiftLama);
      if (!shifts.some((s) => Number(s.id_shift) === idShift)) {
        throw new Error(
          `Baris ${baris}: id_shift '${idShiftLama}' tidak ada. Pakai kolom kode_shift (lihat menu Shift).`,
        );
      }
    }

    const hpMentah = teksIdentitas(val(row, "no_hp"), "no_hp", baris);
    const hp = hpMentah ? normalizeOperatorPhone(hpMentah) : "";
    if (hpMentah && !hp) {
      throw new Error(
        `Baris ${baris}: no_hp '${hpMentah}' tidak valid. Gunakan 08xxxxxxxxxx atau +62xxxxxxxxxx.`,
      );
    }

    const statusMentah = val(row, "status_aktif").toLowerCase();
    if (statusMentah && !["aktif", "nonaktif"].includes(statusMentah)) {
      throw new Error(
        `Baris ${baris}: status_aktif '${val(row, "status_aktif")}' harus Aktif atau Nonaktif.`,
      );
    }

    const draft: KaryawanInput = {
      id_unik: teksIdentitas(val(row, "id_unik"), "id_unik", baris),
      kode_karyawan: teksIdentitas(
        val(row, "kode_karyawan"),
        "kode_karyawan",
        baris,
      ),
      nama: val(row, "nama"),
      divisi: val(row, "divisi"),
      jabatan_status: val(row, "jabatan_status") || "Staff",
      no_hp: hp,
      lp: jenisKelamin(val(row, "lp"), baris),
      id_shift: idShift ?? 1,
      status_aktif: statusMentah === "nonaktif" ? "Nonaktif" : "Aktif",
      tanggal_daftar: tanggalExcel(
        val(row, "tanggal_daftar"),
        "tanggal_daftar",
        baris,
      ),
      catatan: val(row, "catatan"),
      jenis_personil: jenis,
      tanggal_mulai_aktif: tanggalExcel(
        val(row, "tanggal_mulai_aktif"),
        "tanggal_mulai_aktif",
        baris,
      ),
      tanggal_selesai_aktif: tanggalExcel(
        val(row, "tanggal_selesai_aktif"),
        "tanggal_selesai_aktif",
        baris,
      ),
      unit: val(row, "unit") || undefined,
    };

    const message = firstValidationMessage(validateEmployeeDraft(draft));
    if (message) throw new Error(`Baris ${baris}: ${message}`);
    if (ids.has(draft.id_unik) || codes.has(draft.kode_karyawan)) {
      throw new Error(
        `Baris ${baris}: ID (${draft.id_unik}) atau kode karyawan (${draft.kode_karyawan}) duplikat di file.`,
      );
    }
    ids.add(draft.id_unik);
    codes.add(draft.kode_karyawan);
    hasil.push({ baris, draft });
    if (hasil.length > 500) throw new Error("Maksimal 500 karyawan per file.");
  }

  if (hasil.length === 0) {
    throw new Error("Tidak ada data karyawan untuk diimpor.");
  }

  return hasil;
}

export function exportEmployees(
  rows: Record<string, unknown>[],
  shifts: ImportLookups["shifts"],
) {
  return saveWorkbook({
    headers: HEADERS,
    rows: rows.map((row) => ({
      ...row,
      kode_shift: shiftCodeOf(row.id_shift, shifts),
    })),
    filename: `karyawan-${new Date().toLocaleDateString("en-CA")}.xlsx`,
    sheetName: "Karyawan",
  });
}

export function downloadEmployeeTemplate(shifts: ImportLookups["shifts"]) {
  const shift = shifts[0];
  return saveWorkbook({
    headers: HEADERS,
    rows: [
      {
        id_unik: "EMP_0001",
        kode_karyawan: "K0001",
        nama: "Nama Karyawan",
        divisi: "Operational",
        jabatan_status: "Staff",
        no_hp: "08123456789",
        lp: "L",
        kode_shift: shift ? String(shift.kode_shift ?? "") : "1",
        status_aktif: "Aktif",
        tanggal_daftar: new Date().toLocaleDateString("en-CA"),
        jenis_personil: "Pegawai",
      },
    ],
    filename: "template-import-karyawan.xlsx",
    sheetName: "Karyawan",
  });
}
