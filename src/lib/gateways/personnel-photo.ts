"use client";

import { requestWebApi } from "@/lib/client/api-client";
import { isDesktopRuntime } from "@/lib/runtime/app-runtime";
import { invokeDesktop } from "@/lib/runtime/desktop-commands";

/**
 * Gateway foto profil personil — guru, siswa, dan karyawan sekaligus.
 *
 * Berkunci `master_data.id_unik`, bukan `siswa_data.id_siswa`: kartu identitas
 * dirender dari baris `master_data`, sehingga kunci itulah yang membuat foto
 * langsung terpasang di kartu tanpa satu pun join tambahan — dan satu jalur ini
 * melayani ketiga jenis personil alih-alih tiga jalur yang harus dijaga sama.
 *
 * Barisnya hidup di `personil_foto`, SENGAJA di luar `SNAPSHOT_TABLES`: satu
 * foto ratusan kilobyte, dan menariknya lewat snapshot akan membuat tiap siklus
 * pull membengkak di setiap perangkat. Ia tetap DIDORONG lewat outbox, lalu
 * dibaca satu per satu saat dibutuhkan.
 */

export interface PersonnelPhoto {
  id_unik: string;
  foto_mime: string;
  foto_base64: string;
  updated_at: string;
}

export async function simpanFotoPersonil(
  idUnik: string,
  fotoBase64: string,
  fotoMime = "image/jpeg",
) {
  if (isDesktopRuntime()) {
    return invokeDesktop<{ sukses: boolean; id_unik: string }>(
      "desktop_save_personnel_photo",
      { idUnik, fotoBase64, fotoMime },
    );
  }
  return requestWebApi<{ sukses: boolean; id_unik: string }>(
    "/api/personnel/photo/upload",
    "POST",
    { id_unik: idUnik, foto_base64: fotoBase64, foto_mime: fotoMime },
  );
}

export async function ambilFotoPersonil(idUnik: string) {
  if (isDesktopRuntime()) {
    return invokeDesktop<PersonnelPhoto | null>("desktop_get_personnel_photo", {
      idUnik,
    });
  }
  return requestWebApi<PersonnelPhoto | null>(
    "/api/personnel/photo/query",
    "POST",
    { id_unik: idUnik },
  );
}

export async function hapusFotoPersonil(idUnik: string) {
  if (isDesktopRuntime()) {
    return invokeDesktop<{ sukses: boolean; id_unik: string }>(
      "desktop_delete_personnel_photo",
      { idUnik },
    );
  }
  return requestWebApi<{ sukses: boolean; id_unik: string }>(
    "/api/personnel/photo/delete",
    "POST",
    { id_unik: idUnik },
  );
}
