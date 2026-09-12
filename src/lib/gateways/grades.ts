"use client";

import { requestWebApi } from "@/lib/client/api-client";
import { isDesktopRuntime } from "@/lib/runtime/app-runtime";
import { invokeDesktop } from "@/lib/runtime/desktop-commands";
import type {
  PenilaianDetail,
  PenilaianDraft,
  PenilaianFilter,
  PenilaianItem,
  SimpanNilaiDraft,
} from "@/types/grades";

export type {
  JenisPenilaian,
  NilaiSiswaItem,
  PenilaianDetail,
  PenilaianDraft,
  PenilaianFilter,
  PenilaianItem,
  Semester,
  SimpanNilaiDraft,
} from "@/types/grades";

/**
 * Gateway modul nilai.
 *
 * Berbeda dari gateway PMB: TIDAK ada `assertTersediaDiMobile` di sini. Kedua
 * tabelnya ikut sinkronisasi dan command Rust-nya menulis ke SQLite lokal,
 * sehingga fitur ini bekerja penuh tanpa jaringan — di Desktop maupun Mobile.
 * Guru menilai di kelas, dan kelas tidak selalu punya sinyal.
 *
 * Command-nya sampai ke Mobile lewat `commands.rs` dan `grades.rs` yang ikut
 * `sync-rust-modules.ts`; yang tersisa untuk Mobile hanyalah tiga berkas
 * pendaftaran dan halamannya (Fase 6.2).
 */

export async function daftarPenilaian(
  filter: PenilaianFilter,
): Promise<{ items: PenilaianItem[] }> {
  if (isDesktopRuntime()) {
    return invokeDesktop<{ items: PenilaianItem[] }>(
      "desktop_list_assessments",
      {
        idTahunAjaran: filter.id_tahun_ajaran,
        semester: filter.semester,
        idRombel: filter.id_rombel,
        idMapel: filter.id_mapel ?? null,
      },
    );
  }
  return requestWebApi<{ items: PenilaianItem[] }>(
    "/api/academic/grades/query",
    "POST",
    filter,
  );
}

export async function getPenilaian(
  idPenilaian: string,
): Promise<PenilaianDetail> {
  if (isDesktopRuntime()) {
    return invokeDesktop<PenilaianDetail>("desktop_get_assessment", {
      idPenilaian,
    });
  }
  return requestWebApi<PenilaianDetail>("/api/academic/grades/get", "POST", {
    idPenilaian,
  });
}

export async function simpanPenilaian(
  draft: PenilaianDraft,
): Promise<{ id_penilaian?: string; idPenilaian?: string }> {
  if (isDesktopRuntime()) {
    return invokeDesktop<{ id_penilaian: string }>("desktop_save_assessment", {
      draft,
    });
  }
  return requestWebApi<{ idPenilaian: string }>(
    "/api/academic/grades/save",
    "POST",
    draft,
  );
}

/**
 * Simpan skor satu kelas sekaligus.
 *
 * `skor: null` berarti BELUM DINILAI dan disimpan apa adanya — bukan dilewati,
 * bukan diubah menjadi nol. Guru yang mengosongkan kembali sebuah nilai berhak
 * mengembalikan anak itu ke keadaan belum dinilai.
 */
export async function simpanNilai(
  draft: SimpanNilaiDraft,
): Promise<{ tersimpan: number }> {
  if (isDesktopRuntime()) {
    return invokeDesktop<{ tersimpan: number }>("desktop_save_scores", {
      draft,
    });
  }
  return requestWebApi<{ tersimpan: number }>(
    "/api/academic/grades/scores",
    "POST",
    draft,
  );
}

export async function hapusPenilaian(idPenilaian: string): Promise<void> {
  if (isDesktopRuntime()) {
    await invokeDesktop("desktop_delete_assessment", { idPenilaian });
    return;
  }
  await requestWebApi("/api/academic/grades/delete", "POST", { idPenilaian });
}
