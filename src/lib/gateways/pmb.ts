"use client";

import { requestWebApi } from "@/lib/client/api-client";
import { isDesktopRuntime } from "@/lib/runtime/app-runtime";
import { invokeDesktop } from "@/lib/runtime/desktop-commands";
import type {
  PmbFileContent,
  PmbPromotionInput,
  PmbRegistrantDetail,
  PmbRegistrantFilter,
  PmbRegistrantItem,
  PmbWave,
  PmbWaveDraft,
} from "@/types/pmb";

export type {
  PmbFileContent,
  PmbFileMeta,
  PmbPromotionInput,
  PmbRegistrantDetail,
  PmbRegistrantFilter,
  PmbRegistrantItem,
  PmbStatus,
  PmbWave,
  PmbWaveDraft,
} from "@/types/pmb";

/**
 * Gateway PMB sisi sekolah.
 *
 * Setiap fungsi di sini menuntut JARINGAN: ketiga tabelnya cloud-only, sama
 * seperti Bimbingan Konseling. Pada Desktop, `invokeDesktop` sampai ke command
 * Rust yang memanggil `get_turso_client()` langsung — tanpa outbox, tanpa
 * SQLite lokal, dan karenanya tanpa mode offline.
 *
 * Mobile IKUT, dengan command yang sama. Versi pertama gateway ini menutup
 * Mobile lewat `assertTersediaDiMobile` dengan alasan "pekerjaan layar besar" —
 * dan itu keliru sebagai aturan: panitia PMB sering bertugas di meja
 * pendaftaran dengan ponsel, bukan laptop, dan fitur yang hanya ada di Desktop
 * sama saja dengan fitur yang tidak ada bagi mereka. Yang membedakan Mobile
 * bukan kewenangannya, melainkan tata letaknya.
 *
 * Yang tetap benar dari kekhawatiran lama: berkas identitas berukuran ratusan
 * kilobyte. Karena itu `getBerkasPendaftarPmb` tetap endpoint TERPISAH yang
 * hanya dipanggil saat satu berkas benar-benar dibuka — daftar dan detailnya
 * tidak pernah membawa `konten_base64`.
 */

export async function daftarGelombangPmb(): Promise<{ items: PmbWave[] }> {
  if (isDesktopRuntime()) {
    return invokeDesktop<{ items: PmbWave[] }>("desktop_list_pmb_waves");
  }
  return requestWebApi<{ items: PmbWave[] }>(
    "/api/academic/pmb/waves/query",
    "POST",
    {},
  );
}

export async function simpanGelombangPmb(
  draft: PmbWaveDraft,
): Promise<{ idGelombang: string }> {
  if (isDesktopRuntime()) {
    return invokeDesktop<{ idGelombang: string }>("desktop_save_pmb_wave", {
      draft,
    });
  }
  return requestWebApi<{ idGelombang: string }>(
    "/api/academic/pmb/waves/save",
    "POST",
    draft,
  );
}

export async function hapusGelombangPmb(idGelombang: string): Promise<void> {
  if (isDesktopRuntime()) {
    await invokeDesktop("desktop_delete_pmb_wave", { idGelombang });
    return;
  }
  await requestWebApi("/api/academic/pmb/waves/delete", "POST", {
    idGelombang,
  });
}

export async function daftarPendaftarPmb(
  filter?: PmbRegistrantFilter,
): Promise<{ items: PmbRegistrantItem[] }> {
  if (isDesktopRuntime()) {
    return invokeDesktop<{ items: PmbRegistrantItem[] }>(
      "desktop_list_pmb_registrants",
      {
        idGelombang: filter?.id_gelombang ?? null,
        status: filter?.status ?? null,
        search: filter?.search ?? null,
        limit: filter?.limit ?? null,
      },
    );
  }
  return requestWebApi<{ items: PmbRegistrantItem[] }>(
    "/api/academic/pmb/registrants/query",
    "POST",
    filter ?? {},
  );
}

export async function getDetailPendaftarPmb(
  idPendaftar: string,
): Promise<PmbRegistrantDetail> {
  if (isDesktopRuntime()) {
    return invokeDesktop<PmbRegistrantDetail>("desktop_get_pmb_registrant", {
      idPendaftar,
    });
  }
  return requestWebApi<PmbRegistrantDetail>(
    "/api/academic/pmb/registrants/get",
    "POST",
    { idPendaftar },
  );
}

/** Satu berkas beserta isinya — dipanggil hanya saat panitia membukanya. */
export async function getBerkasPendaftarPmb(
  idBerkas: string,
): Promise<PmbFileContent> {
  if (isDesktopRuntime()) {
    return invokeDesktop<PmbFileContent>("desktop_get_pmb_file", { idBerkas });
  }
  const res = await requestWebApi<{ berkas: PmbFileContent }>(
    "/api/academic/pmb/files/get",
    "POST",
    { idBerkas },
  );
  return res.berkas;
}

export async function ubahStatusPendaftarPmb(input: {
  idPendaftar: string;
  status: string;
  catatan?: string | null;
}): Promise<void> {
  if (isDesktopRuntime()) {
    await invokeDesktop("desktop_update_pmb_status", {
      idPendaftar: input.idPendaftar,
      status: input.status,
      catatan: input.catatan ?? null,
    });
    return;
  }
  await requestWebApi("/api/academic/pmb/registrants/status", "POST", input);
}

export async function hapusPendaftarPmb(idPendaftar: string): Promise<void> {
  if (isDesktopRuntime()) {
    await invokeDesktop("desktop_delete_pmb_registrant", { idPendaftar });
    return;
  }
  await requestWebApi("/api/academic/pmb/registrants/delete", "POST", {
    idPendaftar,
  });
}

/**
 * Angkat pendaftar yang diterima menjadi siswa aktif.
 *
 * Baris siswanya dibuat oleh jalur yang sudah ada (`academic::save_student` di
 * Rust, `saveStudent` di Web), bukan oleh kode PMB — itu satu-satunya cara
 * memastikan `master_data`, `siswa_data`, baris `id_card`, dan token QR-nya
 * lahir bersamaan seperti siswa mana pun.
 */
export async function jadikanSiswaDariPmb(
  input: PmbPromotionInput,
): Promise<{ idSiswa: string }> {
  if (isDesktopRuntime()) {
    return invokeDesktop<{ idSiswa: string }>(
      "desktop_promote_pmb_registrant",
      {
        idPendaftar: input.idPendaftar,
        idRombel: input.idRombel,
        idShift: input.idShift ?? null,
        angkatan: input.angkatan ?? null,
      },
    );
  }
  return requestWebApi<{ idSiswa: string }>(
    "/api/academic/pmb/registrants/promote",
    "POST",
    input,
  );
}
