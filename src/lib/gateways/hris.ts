"use client";

import { requestWebApi } from "@/lib/client/api-client";
import { isDesktopRuntime } from "@/lib/runtime/app-runtime";
import { invokeDesktop, kickDesktopSync } from "@/lib/runtime/desktop-commands";
import type { DataBeban, SetupSurat } from "@/lib/validations/hr-beban";
import type {
  BerkasDokumenDraft,
  DaftarDokumen,
  DaftarKontrak,
  DaftarTugas,
  DokumenDraft,
  IsiBerkasDokumen,
  JenisDokumenDraft,
  JenisTugasDraft,
  KeuanganDraft,
  KontrakDraft,
  LaporanPtk,
  MasterDraft,
  OrgKepegawaian,
  PendidikanDraft,
  PengaturanKontrak,
  PengaturanKontrakDraft,
  PribadiDraft,
  ProfilPegawai,
  SertifikasiDraft,
  TugasDraft,
} from "@/lib/validations/hris";

export type {
  BagianOrg,
  BarisPtk,
  BerkasDokumenBaris,
  BerkasDokumenDraft,
  DaftarDokumen,
  DaftarKontrak,
  DaftarTugas,
  DokumenBaris,
  DokumenDraft,
  IsiBerkasDokumen,
  JabatanOrg,
  JenisDokumen,
  JenisDokumenDraft,
  JenisTugas,
  JenisTugasDraft,
  KeuanganDraft,
  KontrakBaris,
  KontrakDraft,
  LaporanPtk,
  MasterDraft,
  OrgKepegawaian,
  PegawaiKepegawaian,
  PendidikanBaris,
  PendidikanDraft,
  PengaturanKontrak,
  PribadiDraft,
  ProfilPegawai,
  RingkasKontrak,
  SertifikasiBaris,
  SertifikasiDraft,
  TugasBaris,
  TugasDraft,
} from "@/lib/validations/hris";

// Command `desktop_hr_*` terdaftar di biner Desktop DAN Mobile (`hris.rs` dan
// `commands.rs` disalin sync-rust-modules.ts), jadi satu cabang
// `isDesktopRuntime()` mencakup keduanya.

export async function muatOrgKepegawaian(): Promise<OrgKepegawaian> {
  if (isDesktopRuntime()) return invokeDesktop("desktop_hr_org");
  return requestWebApi("/api/kepegawaian/org/query", "POST", {});
}

export async function simpanBagian(draft: MasterDraft) {
  if (isDesktopRuntime()) {
    const hasil = await invokeDesktop<{ id_bagian: string }>(
      "desktop_hr_section_save",
      { draft },
    );
    kickDesktopSync();
    return hasil;
  }
  return requestWebApi<{ id_bagian: string }>(
    "/api/kepegawaian/section",
    "POST",
    draft,
  );
}

export async function gabungBagian(idAsal: string, idTujuan: string) {
  if (isDesktopRuntime()) {
    const hasil = await invokeDesktop("desktop_hr_section_merge", {
      idAsal,
      idTujuan,
    });
    kickDesktopSync();
    return hasil;
  }
  return requestWebApi("/api/kepegawaian/section/merge", "POST", {
    id_asal: idAsal,
    id_tujuan: idTujuan,
  });
}

export async function simpanJabatan(draft: MasterDraft) {
  if (isDesktopRuntime()) {
    const hasil = await invokeDesktop<{ id_jabatan: string }>(
      "desktop_hr_position_save",
      { draft },
    );
    kickDesktopSync();
    return hasil;
  }
  return requestWebApi<{ id_jabatan: string }>(
    "/api/kepegawaian/position",
    "POST",
    draft,
  );
}

// Fase 1b: kontrak, tugas tambahan, pengaturan, status pajak

async function mutasi<T>(
  command: string,
  args: Record<string, unknown>,
  url: string,
  body: unknown,
): Promise<T> {
  if (isDesktopRuntime()) {
    const hasil = await invokeDesktop<T>(command, args);
    kickDesktopSync();
    return hasil;
  }
  return requestWebApi<T>(url, "POST", body);
}

export async function muatKontrak(): Promise<DaftarKontrak> {
  if (isDesktopRuntime()) return invokeDesktop("desktop_hr_contracts");
  return requestWebApi("/api/kepegawaian/contracts/query", "POST", {});
}

export function simpanKontrak(draft: KontrakDraft) {
  return mutasi(
    "desktop_hr_contract_create",
    { draft },
    "/api/kepegawaian/contracts",
    draft,
  );
}

export function batalKontrak(idKontrak: string, alasan: string) {
  return mutasi(
    "desktop_hr_contract_cancel",
    { idKontrak, alasan },
    "/api/kepegawaian/contracts/cancel",
    { id: idKontrak, alasan },
  );
}

export function simpanPengaturanKontrak(
  draft: PengaturanKontrakDraft,
): Promise<PengaturanKontrak> {
  return mutasi(
    "desktop_hr_settings_save",
    { draft },
    "/api/kepegawaian/settings",
    draft,
  );
}

export function simpanJenisTugas(draft: JenisTugasDraft) {
  return mutasi(
    "desktop_hr_duty_types_save",
    { draft },
    "/api/kepegawaian/duty-type",
    draft,
  );
}

export async function muatTugas(): Promise<DaftarTugas> {
  if (isDesktopRuntime()) return invokeDesktop("desktop_hr_duties");
  return requestWebApi("/api/kepegawaian/duties/query", "POST", {});
}

export function simpanTugas(draft: TugasDraft) {
  return mutasi(
    "desktop_hr_duty_save",
    { draft },
    "/api/kepegawaian/duties",
    draft,
  );
}

export function batalTugas(idTugas: string, alasan: string) {
  return mutasi(
    "desktop_hr_duty_cancel",
    { idTugas, alasan },
    "/api/kepegawaian/duties/cancel",
    { id: idTugas, alasan },
  );
}

export interface StatusTidakTetap {
  /** `false` = kunci belum pernah disimpan, daftar = bawaan. */
  tersimpan: boolean;
  daftar: string[];
  pilihan: string[];
}

export async function muatStatusTidakTetap(): Promise<StatusTidakTetap> {
  if (isDesktopRuntime())
    return invokeDesktop("desktop_get_pajak_status_tidak_tetap");
  return requestWebApi("/api/payroll/config/pajak-status/query", "POST", {});
}

export function simpanStatusTidakTetap(
  daftar: string[],
): Promise<StatusTidakTetap> {
  return mutasi(
    "desktop_save_pajak_status_tidak_tetap",
    { daftar },
    "/api/payroll/config/pajak-status",
    { daftar },
  );
}

// HRIS 1c: data cloud-only. Desktop membaca dan menulis langsung ke database
// cloud lewat command `desktop_hr_*` (tanpa outbox, jadi tanpa kickDesktopSync);
// tanpa koneksi, command melempar `PESAN_LURING`.

function cloud<T>(
  command: string,
  args: Record<string, unknown>,
  url: string,
  body: unknown,
  method: "POST" | "DELETE" = "POST",
): Promise<T> {
  if (isDesktopRuntime()) return invokeDesktop<T>(command, args);
  return requestWebApi<T>(url, method, body);
}

export function muatProfilPegawai(idKaryawan: string): Promise<ProfilPegawai> {
  return cloud(
    "desktop_hr_profile",
    { idKaryawan },
    "/api/kepegawaian/profile/query",
    { id_karyawan: idKaryawan },
  );
}

export function simpanDataPribadi(draft: PribadiDraft) {
  return cloud(
    "desktop_hr_profile_save_personal",
    { idKaryawan: draft.id_karyawan, draft },
    "/api/kepegawaian/profile/personal",
    draft,
  );
}

export function simpanDataKeuangan(draft: KeuanganDraft) {
  return cloud(
    "desktop_hr_profile_save_finance",
    { idKaryawan: draft.id_karyawan, draft },
    "/api/kepegawaian/profile/finance",
    draft,
  );
}

export function simpanPendidikan(draft: PendidikanDraft) {
  return cloud<{ id_pendidikan: string }>(
    "desktop_hr_education_save",
    { draft },
    "/api/kepegawaian/education",
    draft,
  );
}

export function hapusPendidikan(id: string) {
  return cloud(
    "desktop_hr_education_delete",
    { idPendidikan: id },
    "/api/kepegawaian/education",
    { id },
    "DELETE",
  );
}

export function simpanSertifikasi(draft: SertifikasiDraft) {
  return cloud<{ id_sertifikasi: string }>(
    "desktop_hr_certification_save",
    { draft },
    "/api/kepegawaian/certification",
    draft,
  );
}

export function hapusSertifikasi(id: string) {
  return cloud(
    "desktop_hr_certification_delete",
    { idSertifikasi: id },
    "/api/kepegawaian/certification",
    { id },
    "DELETE",
  );
}

/** Tanpa `idKaryawan`: hanya jenis dokumen (cukup `hr.org.manage`). */
export function muatDokumen(idKaryawan = ""): Promise<DaftarDokumen> {
  return cloud(
    "desktop_hr_documents",
    { idKaryawan },
    "/api/kepegawaian/documents/query",
    { id_karyawan: idKaryawan },
  );
}

export function ambilBerkasDokumen(id: string): Promise<IsiBerkasDokumen> {
  return cloud(
    "desktop_hr_document_file",
    { idBerkas: id },
    "/api/kepegawaian/documents/file/query",
    { id },
  );
}

export function simpanDokumen(draft: DokumenDraft) {
  return cloud<{ id_dokumen: string }>(
    "desktop_hr_document_save",
    { draft },
    "/api/kepegawaian/documents",
    draft,
  );
}

export function hapusDokumen(id: string) {
  return cloud(
    "desktop_hr_document_delete",
    { idDokumen: id },
    "/api/kepegawaian/documents",
    { id },
    "DELETE",
  );
}

export function tambahBerkasDokumen(draft: BerkasDokumenDraft) {
  return cloud<{ id_berkas: string }>(
    "desktop_hr_document_file_add",
    {
      idDokumen: draft.id_dokumen,
      namaBerkas: draft.nama_berkas,
      mimeType: draft.mime_type,
      dataBase64: draft.data_base64,
    },
    "/api/kepegawaian/documents/file",
    draft,
  );
}

export function hapusBerkasDokumen(id: string) {
  return cloud(
    "desktop_hr_document_file_delete",
    { idBerkas: id },
    "/api/kepegawaian/documents/file",
    { id },
    "DELETE",
  );
}

export function simpanJenisDokumen(draft: JenisDokumenDraft) {
  return cloud<{ id_jenis: string }>(
    "desktop_hr_document_types_save",
    { draft },
    "/api/kepegawaian/document-types",
    draft,
  );
}

export function muatLaporanPtk(): Promise<LaporanPtk> {
  return cloud("desktop_hr_ptk_report", {}, "/api/kepegawaian/ptk/query", {});
}

/** Data mentah rekap beban mengajar; Desktop membaca SQLite lokal (luring). */
export async function muatBebanMengajar(
  idTahunAjaran: string,
): Promise<DataBeban> {
  if (isDesktopRuntime())
    return invokeDesktop("desktop_hr_teaching_load", { idTahunAjaran });
  return requestWebApi("/api/kepegawaian/teaching-load/query", "POST", {
    id_tahun_ajaran: idTahunAjaran,
  });
}

/** Bahan cetak SK dan surat pada `tanggal` (`""` = hari ini WIB). */
export async function muatSetupSurat(tanggal: string): Promise<SetupSurat> {
  if (isDesktopRuntime())
    return invokeDesktop("desktop_hr_letter_setup", { tanggal });
  return requestWebApi("/api/kepegawaian/letters/query", "POST", { tanggal });
}

/** Kedua belas kunci pengaturan surat sekaligus (`kunciPengaturanSurat`). */
export function simpanPengaturanSurat(
  draft: Record<string, string>,
): Promise<Record<string, string>> {
  return mutasi(
    "desktop_hr_letter_settings_save",
    { draft },
    "/api/kepegawaian/letters/settings",
    draft,
  );
}
