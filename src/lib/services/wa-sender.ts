import "server-only";

import type { Client } from "@libsql/client";
import {
  readFullWaConfig,
  type StoredWaConfig,
  sendViaProvider,
} from "@/lib/services/wa-provider";
import {
  settingEnabled,
  WA_AUTO_SEND_KEY,
  WA_QUEUE_RETENTION_DAYS,
} from "@/lib/validations/wa-notification";

// Dipakai ulang oleh pemanggil lama yang mengimpornya dari modul ini.
export { readFullWaConfig };
export type { StoredWaConfig };

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

/** Percobaan kirim sebelum baris menjadi `Gagal`. Sama dengan
 * `WA_SEND_ATTEMPTS_MAX` di `wa_sender.rs`. */
export const WA_BATAS_PERCOBAAN = 3;

/** Syarat "tidak sedang diklaim pengirim lain" (schema v34). */
const KLAIM_BEBAS = "(klaim_sampai IS NULL OR klaim_sampai < datetime('now'))";

export type AksiBarisAntrean = "kirim" | "batal_nonaktif" | "batal_duplikat";

/**
 * Keputusan untuk satu baris antrean. Cerminan `row_action` di `wa_sender.rs`,
 * diuji dengan vektor yang sama.
 *
 * Jenis yang dimatikan DIBATALKAN, bukan dilewati: baris yang dilewati tetap
 * `Menunggu` selamanya, terambil lagi setiap siklus, memakan jatah `LIMIT`
 * sehingga pesan yang sah ikut tertunda, dan tidak pernah memenuhi syarat
 * pemangkasan retensi. Sakelarnya peta, bukan rantai OR — jenis baru yang
 * tidak ada di peta jatuh ke batal, tidak pernah ke kirim.
 */
export function aksiBarisAntrean(
  jenis: string,
  sakelar: Record<string, boolean>,
  sudahDilihat: Set<string>,
  dedupeKey: string,
): AksiBarisAntrean {
  if (sakelar[jenis] !== true) return "batal_nonaktif";
  if (sudahDilihat.has(dedupeKey)) return "batal_duplikat";
  sudahDilihat.add(dedupeKey);
  return "kirim";
}

/** Status dan jumlah percobaan setelah gagal. Cerminan `status_after_failure`. */
export function statusSetelahGagal(percobaanSebelumnya: number): {
  status: "Menunggu" | "Gagal";
  percobaan: number;
} {
  const percobaan = percobaanSebelumnya + 1;
  return {
    status: percobaan >= WA_BATAS_PERCOBAAN ? "Gagal" : "Menunggu",
    percobaan,
  };
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
 * Menguras antrean notifikasi WhatsApp di LibSQL Cloud dengan deduplikasi di
 * titik kirim. Cerminan `drain` di `wa_sender.rs`.
 *
 * Web dan Desktop/Mobile kini sama-sama bisa menguras antrean yang sama, jadi
 * setiap baris DIKLAIM atomik sebelum dikirim (`klaim_oleh`/`klaim_sampai`).
 * Tanpa klaim, dua pengirim yang membaca baris `Menunggu` yang sama sama-sama
 * mengirim pesan ke nomor wali — dan pesan itu tidak bisa ditarik.
 */
export async function drainWaQueue(
  client: Client,
  batchSize: number = 20,
  {
    pengirim = "web",
    otomatis = false,
  }: {
    pengirim?: string;
    /** Dipanggil runner: hanya mengirim bila sakelar "Kirim otomatis" menyala. */
    otomatis?: boolean;
  } = {},
): Promise<DrainResult> {
  if (otomatis) {
    const sakelar = await client.execute({
      sql: "SELECT value FROM setting_gex_system WHERE key = ? LIMIT 1;",
      args: [WA_AUTO_SEND_KEY],
    });
    if (!settingEnabled(String(sakelar.rows[0]?.value ?? ""))) {
      return {
        sukses: true,
        processed: 0,
        sent: 0,
        cancelled_dedupe: 0,
        cancelled_disabled: 0,
        failed: 0,
        purged: 0,
        skipped_quota: false,
        message: "Kirim otomatis dimatikan.",
      };
    }
  }

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
      WHERE status = 'Menunggu' AND ${KLAIM_BEBAS}
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
    const jenis = String(row.jenis);
    const aksi = aksiBarisAntrean(
      jenis,
      {
        scan_masuk: config.scanMasukEnabled,
        scan_pulang: config.scanPulangEnabled,
        bolos: config.bolosEnabled,
        ambang_alfa: config.ambangAlfaEnabled,
        koreksi_admin: config.koreksiAdminEnabled,
        import_manual: config.importManualEnabled,
      },
      seenDedupeKeys,
      String(row.dedupe_key),
    );

    if (aksi !== "kirim") {
      // Baris yang sedang diklaim pengirim lain tidak disentuh: pengirim itu
      // yang menutupnya.
      const batal = await client.execute({
        sql: `UPDATE notifikasi_wa SET status = 'Dibatalkan', last_error = ?, updated_at = datetime('now') WHERE id_notifikasi = ? AND status = 'Menunggu' AND ${KLAIM_BEBAS};`,
        args: [
          aksi === "batal_nonaktif"
            ? `Jenis notifikasi '${jenis}' sedang dimatikan`
            : "Deduplikasi di titik kirim",
          id,
        ],
      });
      if (Number(batal.rowsAffected ?? 0) > 0) {
        if (aksi === "batal_nonaktif") cancelledDisabledCount++;
        else cancelledDedupeCount++;
      }
      continue;
    }

    // Klaim atomik: hanya pengirim yang berhasil mengubah baris ini yang boleh
    // mengirimnya. Klaim kedaluwarsa sendiri setelah 5 menit, jadi pengirim
    // yang mati di tengah jalan tidak menyumbat antrean.
    const klaim = await client.execute({
      sql: `UPDATE notifikasi_wa SET klaim_oleh = ?, klaim_sampai = datetime('now', '+5 minutes') WHERE id_notifikasi = ? AND status = 'Menunggu' AND ${KLAIM_BEBAS};`,
      args: [pengirim, id],
    });
    if (Number(klaim.rowsAffected ?? 0) === 0) continue;

    try {
      await sendViaProvider(
        config,
        String(row.tujuan_nomor),
        String(row.isi_pesan),
      );
      await client.execute({
        sql: "UPDATE notifikasi_wa SET status = 'Terkirim', sent_at = datetime('now','+7 hours'), updated_at = datetime('now'), klaim_oleh = NULL, klaim_sampai = NULL WHERE id_notifikasi = ? AND klaim_oleh = ?;",
        args: [id, pengirim],
      });
      sentCount++;
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      const { status, percobaan } = statusSetelahGagal(
        Number(row.attempt_count ?? 0),
      );
      await client.execute({
        sql: "UPDATE notifikasi_wa SET status = ?, attempt_count = ?, last_error = ?, updated_at = datetime('now'), klaim_oleh = NULL, klaim_sampai = NULL WHERE id_notifikasi = ? AND klaim_oleh = ?;",
        args: [status, percobaan, errMsg.slice(0, 500), id, pengirim],
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
