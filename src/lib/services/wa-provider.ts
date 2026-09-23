import "server-only";

import type { Client } from "@libsql/client";

/**
 * Kontrak gateway WhatsApp: cara membaca konfigurasinya, dan cara memanggilnya.
 *
 * Dipisahkan dari `wa-sender.ts` supaya `web-public` bisa memakainya untuk
 * mengirim OTP wali TANPA ikut membawa mesin antreannya — `drainWaQueue`,
 * pemangkasan retensi, dan tabel `notifikasi_wa` tidak punya satu pun pemanggil
 * di situs publik. Satu implementasi, dua pemakai: kalau aturan pemanggilan
 * provider ditulis dua kali, salah satunya akan salah, dan yang membayar
 * tagihan pesan yang gagal adalah sekolah.
 *
 * Berkas ini IKUT disalin ke `web-public` oleh `scripts/sync-shared-lib.ts`.
 * Sunting di sini, bukan di salinannya.
 */
export interface StoredWaConfig {
  id: string;
  provider: "fonnte" | "wablas" | "custom";
  apiKey: string;
  apiUrl: string | null;
  senderNumber: string | null;
  isActive: boolean;
  dailyLimit: number;
  scanMasukEnabled: boolean;
  scanPulangEnabled: boolean;
  bolosEnabled: boolean;
  ambangAlfaEnabled: boolean;
  koreksiAdminEnabled: boolean;
  importManualEnabled: boolean;
}

export async function readFullWaConfig(
  client: Client,
): Promise<StoredWaConfig | null> {
  const result = await client.execute({
    sql: `
      SELECT id, provider, api_key, api_url, sender_number, is_active, daily_limit,
             scan_masuk_enabled, scan_pulang_enabled, bolos_enabled, ambang_alfa_enabled,
      koreksi_admin_enabled, import_manual_enabled
      FROM app_wa_config
      WHERE id = 'default'
      LIMIT 1;
    `,
  });

  const row = result.rows[0];
  if (!row) return null;

  return {
    id: "default",
    provider:
      (String(row.provider ?? "fonnte") as StoredWaConfig["provider"]) ||
      "fonnte",
    apiKey: row.api_key == null ? "" : String(row.api_key).trim(),
    apiUrl: row.api_url != null ? String(row.api_url).trim() : null,
    senderNumber:
      row.sender_number != null ? String(row.sender_number).trim() : null,
    isActive: Number(row.is_active ?? 0) === 1,
    dailyLimit: Number(row.daily_limit ?? 1000),
    scanMasukEnabled: Number(row.scan_masuk_enabled ?? 0) === 1,
    scanPulangEnabled: Number(row.scan_pulang_enabled ?? 0) === 1,
    bolosEnabled: Number(row.bolos_enabled ?? 1) === 1,
    ambangAlfaEnabled: Number(row.ambang_alfa_enabled ?? 1) === 1,
    koreksiAdminEnabled: Number(row.koreksi_admin_enabled ?? 0) === 1,
    importManualEnabled: Number(row.import_manual_enabled ?? 0) === 1,
  };
}

/** Satu permintaan HTTP ke gateway, tanpa efek samping. */
export interface PermintaanProvider {
  url: string;
  authorization: string;
  body: Record<string, unknown>;
  label: "Fonnte" | "Wablas" | "Custom Gateway";
}

/**
 * Bentuk permintaan per provider. Cerminan `provider_request` di
 * `wa_sender.rs` dan diuji dengan vektor yang sama: provider yang tidak
 * dikenal diperlakukan sebagai custom.
 */
export function buatPermintaanProvider(
  config: Pick<
    StoredWaConfig,
    "provider" | "apiKey" | "apiUrl" | "senderNumber"
  >,
  targetPhone: string,
  message: string,
): PermintaanProvider {
  // Format nomor kanonik: buang tanda '+' untuk kompatibilitas sebagian API lokal
  const barePhone = targetPhone.replace(/[^\d]/g, "");
  const customUrl = config.apiUrl?.trim() || null;

  if (config.provider === "fonnte") {
    return {
      url: customUrl ?? "https://api.fonnte.com/send",
      authorization: config.apiKey,
      body: { target: barePhone, message, countryCode: "62" },
      label: "Fonnte",
    };
  }
  if (config.provider === "wablas") {
    return {
      url: customUrl ?? "https://tegal.wablas.com/api/send-message",
      authorization: config.apiKey,
      body: { phone: barePhone, message },
      label: "Wablas",
    };
  }
  if (!customUrl) {
    throw new Error("URL custom endpoint belum diisi.");
  }
  return {
    url: customUrl,
    authorization: `Bearer ${config.apiKey}`,
    body: {
      target: barePhone,
      phone: barePhone,
      message,
      device: config.senderNumber,
    },
    label: "Custom Gateway",
  };
}

/**
 * Kirim satu pesan lewat provider yang terkonfigurasi.
 *
 * Melempar bila providernya menolak. Pemanggil yang MENGANTRE (`drainWaQueue`)
 * mencatat kegagalannya pada baris antrean dan mencoba lagi nanti; pemanggil
 * yang mengirim LANGSUNG (OTP wali) menandai barisnya `Dibatalkan` — sebuah OTP
 * yang tidak sampai tidak boleh tetap menunggu, karena pemiliknya tidak akan
 * pernah memasukkannya dan barisnya hanya menahan jatah percobaan berikutnya.
 */
export async function sendViaProvider(
  config: StoredWaConfig,
  targetPhone: string,
  message: string,
): Promise<void> {
  const permintaan = buatPermintaanProvider(config, targetPhone, message);
  const res = await fetch(permintaan.url, {
    method: "POST",
    headers: {
      Authorization: permintaan.authorization,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(permintaan.body),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `${permintaan.label} HTTP ${res.status}: ${body.slice(0, 200)}`,
    );
  }

  // Fonnte menjawab HTTP 200 dengan `status: false` saat menolak pesan.
  if (permintaan.label === "Fonnte") {
    const data = (await res.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    if (data.status === false) {
      throw new Error(
        String(data.reason || data.detail || "Penolakan dari server Fonnte"),
      );
    }
  }
}
