"use client";

import { requestWebApi } from "@/lib/client/api-client";
import { isDesktopRuntime, isMobileRuntime } from "@/lib/runtime/app-runtime";
import { invokeDesktop } from "@/lib/runtime/desktop-commands";
import { assertTersediaDiMobile } from "@/lib/runtime/mobile-unsupported";
import type {
  WaConfig,
  WaConfigDraft,
  WaNotificationDraft,
  WaNotificationFilter,
  WaNotificationItem,
} from "@/types/wa-notification";

export type {
  WaConfig,
  WaConfigDraft,
  WaConfigProvider,
  WaNotificationDraft,
  WaNotificationFilter,
  WaNotificationItem,
  WaNotificationJenis,
  WaNotificationStatus,
} from "@/types/wa-notification";

export async function listWaNotificationsGateway(
  filter?: WaNotificationFilter,
): Promise<{ items: WaNotificationItem[] }> {
  // Mobile membaca CLOUD, bukan `notifikasi_wa` lokal. Tabel itu di luar
  // `SNAPSHOT_TABLES`, sehingga perangkat yang bukan terminal pemindai selalu
  // melihat tabel lokal kosong — dan kosong tidak bisa dibedakan dari "tidak
  // ada notifikasi". Guard POSITIF, satu-satunya bentuk yang dikenali
  // `splitMobileBranch` di audit kontrak.
  if (isMobileRuntime()) {
    return invokeDesktop<{ items: WaNotificationItem[] }>(
      "mobile_list_wa_notifications",
      {
        status: filter?.status ?? null,
        jenis: filter?.jenis ?? null,
        idSiswa: filter?.idSiswa ?? filter?.id_siswa ?? null,
        tanggal: filter?.tanggal ?? null,
        limit: filter?.limit ?? null,
      },
    );
  }
  if (isDesktopRuntime()) {
    return invokeDesktop<{ items: WaNotificationItem[] }>(
      "desktop_list_wa_notifications",
      {
        status: filter?.status ?? null,
        jenis: filter?.jenis ?? null,
        idSiswa: filter?.idSiswa ?? filter?.id_siswa ?? null,
        tanggal: filter?.tanggal ?? null,
        limit: filter?.limit ?? null,
      },
    );
  }

  return requestWebApi<{ items: WaNotificationItem[] }>(
    "/api/notifications/wa/query",
    "POST",
    filter ?? {},
  );
}

export async function queueWaNotificationGateway(
  draft: WaNotificationDraft,
): Promise<{ sukses: boolean; id_notifikasi: string }> {
  assertTersediaDiMobile("Tinjauan notifikasi WhatsApp");
  if (isDesktopRuntime()) {
    return invokeDesktop<{ sukses: boolean; id_notifikasi: string }>(
      "desktop_queue_wa_notification",
      { draft },
    );
  }

  return requestWebApi<{ sukses: boolean; id_notifikasi: string }>(
    "/api/notifications/wa/queue",
    "POST",
    draft,
  );
}

export async function cancelWaNotificationGateway(
  idNotifikasi: string,
  alasan?: string,
): Promise<{ sukses: boolean }> {
  assertTersediaDiMobile("Tinjauan notifikasi WhatsApp");
  if (isDesktopRuntime()) {
    return invokeDesktop<{ sukses: boolean }>(
      "desktop_cancel_wa_notification",
      { idNotifikasi, alasan },
    );
  }

  return requestWebApi<{ sukses: boolean }>(
    "/api/notifications/wa/cancel",
    "POST",
    { idNotifikasi, alasan },
  );
}

export async function getWaConfigGateway(): Promise<WaConfig> {
  assertTersediaDiMobile("Tinjauan notifikasi WhatsApp");
  if (isDesktopRuntime()) {
    return invokeDesktop<WaConfig>("desktop_get_wa_config");
  }

  const res = await requestWebApi<{ config: WaConfig }>(
    "/api/notifications/wa/config/query",
    "POST",
    {},
  );
  return res.config;
}

export async function saveWaConfigGateway(
  draft: WaConfigDraft,
): Promise<{ sukses: boolean }> {
  assertTersediaDiMobile("Tinjauan notifikasi WhatsApp");
  if (isDesktopRuntime()) {
    return invokeDesktop<{ sukses: boolean }>("desktop_save_wa_config", {
      draft,
    });
  }

  return requestWebApi<{ sukses: boolean }>(
    "/api/notifications/wa/config/save",
    "POST",
    draft,
  );
}
