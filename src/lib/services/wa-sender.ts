import "server-only";

import type { Client } from "@libsql/client";

import { WA_QUEUE_RETENTION_DAYS } from "@/lib/validations/wa-notification";

interface StoredWaConfig {
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
}

export async function readFullWaConfig(
  client: Client,
): Promise<StoredWaConfig | null> {
  const result = await client.execute({
    sql: `
      SELECT id, provider, api_key, api_url, sender_number, is_active, daily_limit,
             scan_masuk_enabled, scan_pulang_enabled, bolos_enabled, ambang_alfa_enabled
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
  };
}

/**
 * Hapus baris antrean cloud yang sudah selesai dan melewati masa retensi.
 *
 * Cerminan `purge_expired_notifications` di `wa_notification.rs`, dan
 * ambang harinya dibaca dari konstanta yang sama supaya kedua sisi tidak saling
 * menghidupkan kembali baris yang baru saja dihapus.
 *
 * Hanya status akhir yang dipangkas. `Menunggu` belum dikerjakan, dan `Gagal`
 * adalah bukti kegagalan pengiriman yang perlu tetap terlihat manusia.
 */
export async function purgeExpiredNotifications(
  client: Client,
): Promise<number> {
  const result = await client.execute({
    sql: `
      DELETE FROM notifikasi_wa
      WHERE status IN ('Terkirim', 'Dibatalkan')
        AND created_at < datetime('now', ?);
    `,
    args: [`-${WA_QUEUE_RETENTION_DAYS} days`],
  });
  return Number(result.rowsAffected ?? 0);
}

export interface DrainResult {
  sukses: boolean;
  processed: number;
  sent: number;
  cancelled_dedupe: number;
  cancelled_disabled: number;
  failed: number;
  purged: number;
  skipped_quota: boolean;
  message: string;
}

/**
 * Menguras antrean notifikasi WhatsApp di LibSQL Cloud dengan deduplikasi di titik kirim.
 * (Rule 32, Rule 1, dan Fase 4 Architecture).
 */
export async function drainWaQueue(
  client: Client,
  batchSize: number = 20,
): Promise<DrainResult> {
  // Pemangkasan retensi dijalankan LEBIH DULU, sebelum setiap cabang keluar
  // awal di bawah. Menaruhnya di akhir berarti ia tidak pernah berjalan pada
  // pemasangan yang gateway-nya belum aktif — justru pemasangan yang antreannya
  // paling menumpuk, karena tidak ada satu pun baris yang pernah terkirim.
  const purged = await purgeExpiredNotifications(client);

  const config = await readFullWaConfig(client);
  if (!config || !config.isActive) {
    return {
      sukses: false,
      processed: 0,
      sent: 0,
      cancelled_dedupe: 0,
      cancelled_disabled: 0,
      failed: 0,
      purged,
      skipped_quota: false,
      message: "Gateway WhatsApp belum diaktifkan (isActive = 0).",
    };
  }

  if (!config.apiKey) {
    return {
      sukses: false,
      processed: 0,
      sent: 0,
      cancelled_dedupe: 0,
      cancelled_disabled: 0,
      failed: 0,
      purged,
      skipped_quota: false,
      message: "API Key WhatsApp Gateway belum dikonfigurasi.",
    };
  }

  // Hitung jumlah pengiriman sukses hari ini (WIB date)
  const todayRow = await client.execute(
    "SELECT date('now','+7 hours') AS today;",
  );
  const today = String(todayRow.rows[0]?.today ?? "");

  const countTodayRes = await client.execute({
    sql: "SELECT COUNT(*) AS total FROM notifikasi_wa WHERE status = 'Terkirim' AND sent_at LIKE ?;",
    args: [`${today}%`],
  });
  const sentToday = Number(countTodayRes.rows[0]?.total ?? 0);
  if (sentToday >= config.dailyLimit) {
    return {
      sukses: true,
      processed: 0,
      sent: 0,
      cancelled_dedupe: 0,
      cancelled_disabled: 0,
      failed: 0,
      purged,
      skipped_quota: true,
      message: `Batas kuota harian tercapai (${sentToday}/${config.dailyLimit} pesan hari ini).`,
    };
  }

  const remainingQuota = config.dailyLimit - sentToday;
  const fetchLimit = Math.min(batchSize, remainingQuota);

  // Ambil antrean berstatus Menunggu, prioritaskan yang terlama
  const queueRes = await client.execute({
    sql: `
      SELECT id_notifikasi, dedupe_key, jenis, id_siswa, tujuan_nomor, isi_pesan, attempt_count
      FROM notifikasi_wa
      WHERE status = 'Menunggu'
      ORDER BY created_at ASC
      LIMIT ?;
    `,
    args: [fetchLimit],
  });

  if (queueRes.rows.length === 0) {
    return {
      sukses: true,
      processed: 0,
      sent: 0,
      cancelled_dedupe: 0,
      cancelled_disabled: 0,
      failed: 0,
      purged,
      skipped_quota: false,
      message: "Tidak ada pesan dalam antrean menunggu.",
    };
  }

  let sentCount = 0;
  let cancelledDedupeCount = 0;
  let cancelledDisabledCount = 0;
  let failedCount = 0;

  const seenDedupeKeys = new Set<string>();

  for (const row of queueRes.rows) {
    const id = String(row.id_notifikasi);
    const dedupeKey = String(row.dedupe_key);
    const jenis = String(row.jenis);
    const phone = String(row.tujuan_nomor);
    const message = String(row.isi_pesan);
    const attempts = Number(row.attempt_count ?? 0);

    // Periksa sakelar per jenis.
    //
    // Barisnya DIBATALKAN, bukan dilewati. Melewatinya membiarkan statusnya
    // tetap `Menunggu` selamanya: ia akan terambil lagi di setiap siklus, tidak
    // pernah terkirim, dan tidak pernah memenuhi syarat pemangkasan retensi
    // yang hanya menyentuh baris berstatus akhir. Sebuah jenis yang dimatikan
    // lalu akan menyumbat antrean secara permanen — dan lebih buruk, memakan
    // jatah `LIMIT` setiap siklus sehingga pesan yang sah ikut tertunda.
    const jenisAktif =
      (jenis === "scan_masuk" && config.scanMasukEnabled) ||
      (jenis === "scan_pulang" && config.scanPulangEnabled) ||
      (jenis === "bolos" && config.bolosEnabled) ||
      (jenis === "ambang_alfa" && config.ambangAlfaEnabled);
    if (!jenisAktif) {
      await client.execute({
        sql: "UPDATE notifikasi_wa SET status = 'Dibatalkan', last_error = ?, updated_at = datetime('now') WHERE id_notifikasi = ?;",
        args: [`Jenis notifikasi '${jenis}' sedang dimatikan`, id],
      });
      cancelledDisabledCount++;
      continue;
    }

    // Deduplikasi di titik kirim (Web adalah single writer)
    if (seenDedupeKeys.has(dedupeKey)) {
      await client.execute({
        sql: "UPDATE notifikasi_wa SET status = 'Dibatalkan', last_error = 'Deduplikasi di titik kirim', updated_at = datetime('now') WHERE id_notifikasi = ?;",
        args: [id],
      });
      cancelledDedupeCount++;
      continue;
    }
    seenDedupeKeys.add(dedupeKey);

    // Kirim pesan ke provider pihak ketiga
    try {
      await sendViaProvider(config, phone, message);

      await client.execute({
        sql: "UPDATE notifikasi_wa SET status = 'Terkirim', sent_at = datetime('now','+7 hours'), updated_at = datetime('now') WHERE id_notifikasi = ?;",
        args: [id],
      });
      sentCount++;
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      const nextAttempts = attempts + 1;
      const finalStatus = nextAttempts >= 3 ? "Gagal" : "Menunggu";

      await client.execute({
        sql: "UPDATE notifikasi_wa SET status = ?, attempt_count = ?, last_error = ?, updated_at = datetime('now') WHERE id_notifikasi = ?;",
        args: [finalStatus, nextAttempts, errMsg.slice(0, 500), id],
      });
      failedCount++;
    }

    // Throttle kecil 500ms untuk mencegah ban IP / rate limit provider
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  return {
    sukses: true,
    processed: queueRes.rows.length,
    sent: sentCount,
    cancelled_dedupe: cancelledDedupeCount,
    cancelled_disabled: cancelledDisabledCount,
    failed: failedCount,
    purged,
    skipped_quota: false,
    message: `Pengurasan antrean selesai: ${sentCount} terkirim, ${cancelledDedupeCount} dibatalkan (dedupe), ${cancelledDisabledCount} dibatalkan (jenis nonaktif), ${failedCount} gagal, ${purged} dipangkas.`,
  };
}

async function sendViaProvider(
  config: StoredWaConfig,
  targetPhone: string,
  message: string,
): Promise<void> {
  // Format nomor kanonik: buang tanda '+' untuk kompatibilitas sebagian API lokal
  const barePhone = targetPhone.replace(/[^\d]/g, "");

  if (config.provider === "fonnte") {
    const url = config.apiUrl?.trim() || "https://api.fonnte.com/send";
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: config.apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        target: barePhone,
        message: message,
        countryCode: "62",
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Fonnte HTTP ${res.status}: ${body.slice(0, 200)}`);
    }

    const data = (await res.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    if (data.status === false) {
      throw new Error(
        String(data.reason || data.detail || "Penolakan dari server Fonnte"),
      );
    }
  } else if (config.provider === "wablas") {
    const url =
      config.apiUrl?.trim() || "https://tegal.wablas.com/api/send-message";
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: config.apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        phone: barePhone,
        message: message,
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Wablas HTTP ${res.status}: ${body.slice(0, 200)}`);
    }
  } else {
    // Custom HTTP API
    const url = config.apiUrl?.trim();
    if (!url) {
      throw new Error("URL custom endpoint belum diisi.");
    }
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        target: barePhone,
        phone: barePhone,
        message: message,
        device: config.senderNumber,
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(
        `Custom Gateway HTTP ${res.status}: ${body.slice(0, 200)}`,
      );
    }
  }
}
