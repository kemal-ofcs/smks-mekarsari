"use client";

import type { KaryawanInput } from "@/lib/gateways/employee";
import { workbookColumns } from "@/lib/validations/personnel-import";
import {
  firstValidationMessage,
  validateEmployeeDraft,
} from "@/lib/validations/stabilization";
import { readWorkbookRows, saveWorkbook } from "./xlsx";

const HEADERS = [
  "id_unik",
  "kode_karyawan",
  "nama",
  "divisi",
  "jabatan_status",
  "no_hp",
  "lp",
  "id_shift",
  "status_aktif",
  "tanggal_daftar",
  "catatan",
  "jenis_personil",
  "tanggal_mulai_aktif",
  "tanggal_selesai_aktif",
] as const;

export async function readEmployeeWorkbook(
  file: File,
): Promise<KaryawanInput[]> {
  const rows = await readWorkbookRows(file);

  if (rows.length < 2) {
    throw new Error("Tidak ada data karyawan yang ditemukan di file.");
  }

  const val = workbookColumns(rows[0] || [], [
    "id_unik",
    "kode_karyawan",
    "nama",
    "divisi",
    "id_shift",
  ]);

  const drafts: KaryawanInput[] = [];
  const ids = new Set<string>();
  const codes = new Set<string>();

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];

    if (!val(row, "id_unik") && !val(row, "nama")) continue;

    const draft: KaryawanInput = {
      id_unik: val(row, "id_unik"),
      kode_karyawan: val(row, "kode_karyawan"),
      nama: val(row, "nama"),
      divisi: val(row, "divisi"),
      jabatan_status: val(row, "jabatan_status") || "Staff",
      no_hp: val(row, "no_hp"),
      lp: val(row, "lp").toUpperCase() === "P" ? "P" : "L",
      id_shift: Number(val(row, "id_shift")) || 1,
      status_aktif:
        val(row, "status_aktif") === "Nonaktif" ? "Nonaktif" : "Aktif",
      tanggal_daftar: val(row, "tanggal_daftar") || undefined,
      catatan: val(row, "catatan"),
      jenis_personil: val(row, "jenis_personil") || "Pegawai",
      tanggal_mulai_aktif: val(row, "tanggal_mulai_aktif") || undefined,
      tanggal_selesai_aktif: val(row, "tanggal_selesai_aktif") || undefined,
    };

    const message = firstValidationMessage(validateEmployeeDraft(draft));
    if (message) throw new Error(`Baris ${i + 1}: ${message}`);
    if (ids.has(draft.id_unik) || codes.has(draft.kode_karyawan)) {
      throw new Error(
        `Baris ${i + 1}: ID (${draft.id_unik}) atau kode karyawan (${draft.kode_karyawan}) duplikat di file.`,
      );
    }
    ids.add(draft.id_unik);
    codes.add(draft.kode_karyawan);
    drafts.push(draft);
    if (drafts.length > 500) throw new Error("Maksimal 500 karyawan per file.");
  }

  if (drafts.length === 0) {
    throw new Error("Tidak ada data karyawan untuk diimpor.");
  }

  return drafts;
}

export function exportEmployees(rows: Record<string, unknown>[]) {
  return saveWorkbook({
    headers: HEADERS,
    rows,
    filename: `karyawan-${new Date().toLocaleDateString("en-CA")}.xlsx`,
    sheetName: "Karyawan",
  });
}

export function downloadEmployeeTemplate() {
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
        id_shift: 1,
        status_aktif: "Aktif",
        tanggal_daftar: new Date().toLocaleDateString("en-CA"),
        jenis_personil: "Pegawai",
      },
    ],
    filename: "template-import-karyawan.xlsx",
    sheetName: "Karyawan",
  });
}
