"use client";

import { requestWebApi } from "@/lib/client/api-client";
import { isDesktopRuntime } from "@/lib/runtime/app-runtime";
import { invokeDesktop, kickDesktopSync } from "@/lib/runtime/desktop-commands";
import type {
  AturanCuti,
  AturanCutiDraft,
  DaftarJp,
  DaftarPengajuan,
  DraftJp,
  GantiSaya,
  HasilSimpanPenanganan,
  HasilSimpanPengajuan,
  JenisDraft,
  PenangananDraft,
  PengajuanDraft,
  PenyesuaianDraft,
  SaldoCuti,
} from "@/lib/validations/hr-pengajuan";
import type {
  DaftarLampiran,
  IsiBerkasDokumen,
  LampiranDraft,
} from "@/lib/validations/hris";

export type {
  AturanCuti,
  AturanCutiDraft,
  BarisJenis,
  BarisKeputusan,
  BarisPenyesuaian,
  DaftarJp,
  DaftarPengajuan,
  GantiSaya,
  HasilSimpanPengajuan,
  JadwalJp,
  JenisDraft,
  JpTersusun,
  PegawaiPengajuan,
  Penanganan,
  PenangananDraft,
  PengajuanDraft,
  PengajuanTersusun,
  PenyesuaianDraft,
  PeriodeCuti,
  SaldoCuti,
} from "@/lib/validations/hr-pengajuan";
export type { BarisLampiran, DaftarLampiran } from "@/lib/validations/hris";

// Command `desktop_hr_request*` terdaftar di biner Desktop DAN Mobile
// (`hr_pengajuan.rs` disalin sync-rust-modules.ts); layarnya hanya Web/Desktop
// (Q-50).

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

export async function muatPengajuan(
  dari: string,
  sampai: string,
): Promise<DaftarPengajuan> {
  if (isDesktopRuntime()) {
    return invokeDesktop("desktop_hr_requests", { dari, sampai });
  }
  return requestWebApi("/api/pengajuan/query", "POST", { dari, sampai });
}

export function simpanPengajuan(draft: PengajuanDraft) {
  return mutasi<HasilSimpanPengajuan>(
    "desktop_hr_request_save",
    { draft },
    "/api/pengajuan/save",
    draft,
  );
}

export function putuskanPengajuan(
  idPengajuan: string,
  aksi: string,
  alasan: string,
) {
  return mutasi(
    "desktop_hr_request_decide",
    { idPengajuan, aksi, alasan },
    "/api/pengajuan/decide",
    { id_pengajuan: idPengajuan, aksi, alasan },
  );
}

export function simpanJenisPengajuan(draft: JenisDraft) {
  return mutasi(
    "desktop_hr_request_types_save",
    { draft },
    "/api/pengajuan/types",
    draft,
  );
}

/** Aturan cuti; dengan pegawai juga jatah, penyesuaian, dan riwayatnya. */
export async function muatSaldoCuti(
  idKaryawan: string | null,
  mulai: string | null = null,
  selesai: string | null = null,
): Promise<SaldoCuti> {
  if (isDesktopRuntime()) {
    return invokeDesktop("desktop_hr_leave_balance", {
      idKaryawan,
      mulai,
      selesai,
    });
  }
  return requestWebApi("/api/pengajuan/leave/query", "POST", {
    id_karyawan: idKaryawan,
    mulai,
    selesai,
  });
}

export function simpanAturanCuti(draft: AturanCutiDraft) {
  return mutasi<{ guru: AturanCuti; tendik: AturanCuti }>(
    "desktop_hr_leave_settings_save",
    { draft },
    "/api/pengajuan/leave/settings",
    draft,
  );
}

/**
 * JP terdampak (2c): satu pengajuan, satu tanggal (Jam Kosong; kosong = hari
 * ini WIB), atau isian form Ajukan yang belum disimpan.
 */
export async function muatJpTerdampak(arg: {
  idPengajuan?: string;
  tanggal?: string;
  draft?: DraftJp;
}): Promise<DaftarJp> {
  const idPengajuan = arg.idPengajuan ?? null;
  const tanggal = arg.tanggal ?? null;
  const draft = arg.draft ?? null;
  if (isDesktopRuntime()) {
    return invokeDesktop("desktop_hr_affected_jp", {
      idPengajuan,
      tanggal,
      draft,
    });
  }
  return requestWebApi("/api/pengajuan/jp/query", "POST", {
    id_pengajuan: idPengajuan,
    tanggal,
    draft,
  });
}

export function simpanPenanganan(draft: PenangananDraft) {
  return mutasi<HasilSimpanPenanganan>(
    "desktop_hr_substitute_save",
    { draft },
    "/api/pengajuan/jp/substitute",
    draft,
  );
}

/** JP hari ini yang digantikan akun ini (isi otomatis presensi kelas). */
export async function muatGantiSaya(): Promise<GantiSaya> {
  if (isDesktopRuntime()) return invokeDesktop("desktop_hr_my_substitutions");
  return requestWebApi("/api/pengajuan/jp/mine/query", "POST", {});
}

// Lampiran cloud-only: Desktop/Mobile membaca dan menulis langsung ke database
// cloud (tanpa outbox); tanpa koneksi command melempar `PESAN_LURING`.

export async function muatLampiran(
  idPengajuan: string,
): Promise<DaftarLampiran> {
  if (isDesktopRuntime()) {
    return invokeDesktop("desktop_hr_request_files", { idPengajuan });
  }
  return requestWebApi("/api/pengajuan/files/query", "POST", {
    id_pengajuan: idPengajuan,
  });
}

export async function bukaLampiran(
  idBerkas: string,
): Promise<IsiBerkasDokumen> {
  if (isDesktopRuntime()) {
    return invokeDesktop("desktop_hr_request_file", { idBerkas });
  }
  return requestWebApi("/api/pengajuan/file/query", "POST", { id: idBerkas });
}

export async function tambahLampiran(
  draft: LampiranDraft,
): Promise<{ id_berkas: string }> {
  if (isDesktopRuntime()) {
    return invokeDesktop("desktop_hr_request_file_add", {
      idPengajuan: draft.id_pengajuan,
      namaBerkas: draft.nama_berkas,
      mimeType: draft.mime_type,
      dataBase64: draft.data_base64,
    });
  }
  return requestWebApi("/api/pengajuan/file", "POST", draft);
}

export async function hapusLampiran(idBerkas: string) {
  if (isDesktopRuntime()) {
    return invokeDesktop("desktop_hr_request_file_delete", { idBerkas });
  }
  return requestWebApi("/api/pengajuan/file", "DELETE", { id: idBerkas });
}

export function sesuaikanJatahCuti(draft: PenyesuaianDraft) {
  return mutasi(
    "desktop_hr_leave_adjust",
    { draft },
    "/api/pengajuan/leave/adjust",
    draft,
  );
}
