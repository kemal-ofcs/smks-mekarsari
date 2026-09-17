import type { Client, Transaction } from "@libsql/client";
import type { OperatorUser } from "@/lib/auth/operator-user";
import { assertActorPermission } from "@/lib/auth/permission-assertion";
import { isTransientDatabaseError } from "@/lib/server/database-retry";
import {
  type OperationalSyncEvent,
  safeParseOperationalSyncEvent,
} from "@/lib/server/operational/sync-schema";
import type { OperationalSyncResult } from "./shared";

export type { OperationalSyncEvent } from "@/lib/server/operational/sync-schema";

import {
  applyAttendance,
  applyBackup,
  applyCorrection,
  applyLogScan,
  applyOfflineImport,
} from "./apply-attendance";
import {
  applyCompanyProfile,
  applyIdCard,
  applyIdCardTemplate,
  applySetting,
} from "./apply-identity";
import {
  applyEmployee,
  applyHoliday,
  applyHolidayWhitelist,
  applyShift,
} from "./apply-master";
import { applyPayroll } from "./apply-payroll";
import {
  currentEntityRevision,
  existingReceipt,
  payloadHash,
  permissionForEvent,
  recordResult,
} from "./shared";

/**
 * Titik masuk publik mesin push sinkronisasi: dispatcher domain dan pemroses satu event.
 *
 * Dipecah dari `server/operational/sync-push.ts` (2.309 baris). Jalur impornya
 * TIDAK berubah: `@/lib/server/operational/sync-push` kini direktori dengan
 * `index.ts` yang memegang `processOperationalSyncEvent` dan dispatcher-nya.
 */

async function applyEvent(
  transaction: Transaction,
  actor: OperatorUser,
  event: OperationalSyncEvent,
) {
  if (event.domain === "employee") {
    return applyEmployee(transaction, actor, event);
  }
  if (event.domain === "shift") return applyShift(transaction, actor, event);
  if (event.domain === "holiday")
    return applyHoliday(transaction, actor, event);
  if (event.domain === "holiday-whitelist") {
    return applyHolidayWhitelist(transaction, actor, event);
  }
  if (event.domain === "setting")
    return applySetting(transaction, actor, event);
  if (event.domain === "company-profile") {
    return applyCompanyProfile(transaction, actor, event);
  }
  if (event.domain === "id-card-template") {
    return applyIdCardTemplate(transaction, actor, event);
  }
  if (event.domain === "attendance") {
    return applyAttendance(transaction, actor, event);
  }
  if (event.domain === "correction") {
    return applyCorrection(transaction, actor, event);
  }
  if (event.domain === "backup") {
    return applyBackup(transaction, actor, event);
  }
  if (event.domain === "offline-import") {
    return applyOfflineImport(transaction, actor, event);
  }
  if (event.domain === "log-scan") {
    return applyLogScan(transaction, actor, event);
  }
  if (event.domain === "id-card") return applyIdCard(transaction, actor, event);
  if (event.domain === "payroll") {
    return applyPayroll(transaction, actor, event);
  }
  throw new Error(
    `Domain '${event.domain}' belum didukung oleh endpoint sync.`,
  );
}

/**
 * Revisi server yang dihasilkan event-event SEBELUMNYA dalam satu batch push,
 * berkunci `domain` + `entityKey`.
 *
 * `baseRevision` sebuah event dibekukan saat event DIBUAT di perangkat, bukan
 * saat dikirim. Dua event yang menyentuh entitas sama dan lahir sebelum siklus
 * push berikutnya — misalnya hapus scan Masuk (`attendance/update`) lalu hapus
 * scan Pulang (`attendance/delete`) pada sesi absensi yang sama — membuat event
 * kedua tiba membawa revisi yang sudah usang begitu event pertama diterapkan,
 * lalu ditolak sebagai konflik yang TIDAK pernah bisa selesai: perangkat asal
 * sudah menerapkan perubahannya secara lokal, sementara server dan setiap
 * perangkat lain menahan barisnya selamanya. Basis yang benar untuk event kedua
 * adalah hasil event pertama, bukan angka beku saat enqueue.
 *
 * Aturan yang sama dieja pada jalur Turso 2-tier (`push_events` di `turso.rs`)
 * dan WAJIB tetap sama: keduanya melayani antrean outbox yang identik.
 */
export type SyncBatchRevisions = Map<string, number>;

function batchRevisionKey(domain: string, entityKey: string) {
  // JSON, bukan gabungan string berpemisah: `entityKey` boleh memuat karakter
  // apa pun, jadi dua pasangan berbeda tidak bisa menghasilkan kunci yang sama.
  return JSON.stringify([domain, entityKey]);
}

export async function processOperationalSyncEvent(
  client: Client,
  actor: OperatorUser,
  eventInput: unknown,
  batchRevisions?: SyncBatchRevisions,
): Promise<OperationalSyncResult> {
  const parsedEvent = safeParseOperationalSyncEvent(eventInput);
  if (!parsedEvent.success) {
    const candidate =
      eventInput && typeof eventInput === "object" && "eventId" in eventInput
        ? Reflect.get(eventInput, "eventId")
        : null;
    return {
      eventId: typeof candidate === "string" ? candidate : "invalid",
      status: "rejected",
      message: "Format event sinkronisasi tidak valid.",
    };
  }
  const event = parsedEvent.data as OperationalSyncEvent;
  const permission = permissionForEvent(event);
  if (!permission) {
    return {
      eventId: event.eventId,
      status: "rejected",
      message: "Domain sinkronisasi tidak dikenali.",
    };
  }
  assertActorPermission(actor, permission);
  const hash = payloadHash(event);
  const transaction = await client.transaction("write");
  try {
    const receipt = await existingReceipt(transaction, event, hash);
    if (receipt) {
      await transaction.rollback();
      if (receipt.status === "applied" && receipt.serverRevision) {
        batchRevisions?.set(
          batchRevisionKey(event.domain, event.entityKey),
          receipt.serverRevision,
        );
      }
      return receipt;
    }
    const currentRevision = await currentEntityRevision(
      transaction,
      event.domain,
      event.entityKey,
    );
    // Basis optimistic-concurrency dimajukan bila entitas yang sama sudah
    // ditulis oleh event sebelumnya di batch ini.
    const appliedInBatch = batchRevisions?.get(
      batchRevisionKey(event.domain, event.entityKey),
    );
    const baseRevision =
      event.baseRevision === null || event.baseRevision === undefined
        ? event.baseRevision
        : Math.max(event.baseRevision, appliedInBatch ?? event.baseRevision);
    if (
      baseRevision !== null &&
      baseRevision !== undefined &&
      currentRevision > baseRevision
    ) {
      const result: OperationalSyncResult = {
        eventId: event.eventId,
        status: "conflict",
        message: "Data server berubah setelah snapshot lokal dibuat.",
        serverRevision: currentRevision,
      };
      await recordResult(transaction, actor, event, hash, result);
      await transaction.commit();
      return result;
    }
    try {
      const applied = await applyEvent(transaction, actor, event);
      const result: OperationalSyncResult = {
        eventId: event.eventId,
        status: "applied",
        message: "Event operasional berhasil disinkronkan.",
        serverRevision: applied.revision,
        serverPayload: applied.payload,
      };
      await recordResult(transaction, actor, event, hash, result);
      await transaction.commit();
      batchRevisions?.set(
        batchRevisionKey(event.domain, event.entityKey),
        applied.revision,
      );
      return result;
    } catch (error) {
      if (isTransientDatabaseError(error)) throw error;
      const result: OperationalSyncResult = {
        eventId: event.eventId,
        status: "conflict",
        message:
          error instanceof Error
            ? error.message
            : "Event bertentangan dengan data server.",
        serverRevision: currentRevision,
      };
      await transaction.rollback();
      const conflictTransaction = await client.transaction("write");
      try {
        const receipt = await existingReceipt(conflictTransaction, event, hash);
        if (receipt) {
          await conflictTransaction.rollback();
          return receipt;
        }
        await recordResult(conflictTransaction, actor, event, hash, result);
        await conflictTransaction.commit();
      } finally {
        conflictTransaction.close();
      }
      return result;
    }
  } finally {
    transaction.close();
  }
}
