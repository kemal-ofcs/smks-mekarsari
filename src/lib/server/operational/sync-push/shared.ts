import { createHash } from "node:crypto";
import type { Transaction } from "@libsql/client";
import type { OperatorUser } from "@/lib/auth/operator-user";
import type { PermissionKey } from "@/lib/rbac/catalog";
import type { OperationalSyncEvent } from "@/lib/server/operational/sync-schema";

export interface OperationalSyncResult {
  eventId: string;
  status: "applied" | "rejected" | "conflict";
  message: string;
  serverRevision?: number;
  serverPayload?: unknown;
}

/**
 * Inti sinkronisasi: peta izin per domain, pembaca payload, tanda terima, dan pencatat revisi.
 *
 * Dipecah dari `server/operational/sync-push.ts` (2.309 baris). Jalur impornya
 * TIDAK berubah: `@/lib/server/operational/sync-push` kini direktori dengan
 * `index.ts` yang memegang `processOperationalSyncEvent` dan dispatcher-nya.
 */

export const DOMAIN_PERMISSION: Record<string, PermissionKey> = {
  employee: "employees.manage",
  shift: "shifts.manage",
  holiday: "holidays.manage",
  // Whitelist libur adalah kebijakan hari libur, jadi ia memakai izin yang
  // sama dengan pengelolaan hari liburnya sendiri.
  "holiday-whitelist": "holidays.manage",
  attendance: "scanner.use",
  correction: "corrections.manage",
  backup: "backups.manage",
  "offline-import": "corrections.manage",
  "id-card": "employees.manage",
  "log-scan": "history.delete",
  setting: "settings.manage",
  "company-profile": "settings.manage",
  "id-card-template": "settings.manage",
  payroll: "payroll.config.manage",
};

export function permissionForEvent(
  event: OperationalSyncEvent,
): PermissionKey | null {
  if (event.domain === "attendance") {
    if (event.operation === "update") return "history.edit";
    if (event.operation === "delete") return "history.delete";
    return "scanner.use";
  }
  if (event.domain === "correction") {
    if (event.operation === "delete") return "operational.delete";
    return "corrections.manage";
  }
  if (event.domain === "offline-import") {
    if (event.operation === "delete") return "operational.delete";
    return "corrections.manage";
  }
  if (event.domain === "log-scan") {
    return "history.delete";
  }
  if (event.domain === "payroll") {
    if (
      event.operation === "create-run" ||
      event.operation === "transition-status"
    ) {
      return "payroll.run.create";
    }
    return "payroll.config.manage";
  }
  return DOMAIN_PERMISSION[event.domain] ?? null;
}

export function text(payload: Record<string, unknown>, key: string) {
  return typeof payload[key] === "string" ? payload[key].trim() : "";
}

export function number(
  payload: Record<string, unknown>,
  key: string,
  fallback = 0,
) {
  const parsed = Number(payload[key]);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export const MONTH_NAMES = [
  "Januari",
  "Februari",
  "Maret",
  "April",
  "Mei",
  "Juni",
  "Juli",
  "Agustus",
  "September",
  "Oktober",
  "November",
  "Desember",
] as const;

export function resolveYear(
  payload: Record<string, unknown>,
  dateField = "tanggal",
): number {
  const explicit = number(payload, "tahun");
  if (explicit > 0) return explicit;
  const dateVal = text(payload, dateField);
  if (dateVal.includes("-")) {
    const parsed = Number(dateVal.split("-")[0]);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return new Date().getFullYear();
}

export function resolveMonth(
  payload: Record<string, unknown>,
  dateField = "tanggal",
): string {
  const explicit = text(payload, "bulan");
  if (explicit.length > 0) return explicit;
  const dateVal = text(payload, dateField);
  if (dateVal.includes("-")) {
    const monthNum = Number(dateVal.split("-")[1]);
    if (Number.isFinite(monthNum) && monthNum >= 1 && monthNum <= 12) {
      return MONTH_NAMES[monthNum - 1] ?? "Januari";
    }
  }
  const currentMonth = new Date().getMonth();
  return MONTH_NAMES[currentMonth] ?? "Januari";
}

export function payloadHash(event: OperationalSyncEvent) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        clientId: event.clientId,
        domain: event.domain,
        operation: event.operation,
        entityKey: event.entityKey,
        payload: event.payload,
        baseRevision: event.baseRevision ?? null,
        createdAt: event.createdAt,
      }),
    )
    .digest("hex");
}

export function isRetryableLegacyDuplicate(
  event: OperationalSyncEvent,
  result: OperationalSyncResult,
) {
  if (event.operation !== "create" || result.status !== "conflict") {
    return false;
  }
  return (
    (event.domain === "shift" &&
      result.message.includes(
        "UNIQUE constraint failed: tbl_shift.kode_shift",
      )) ||
    (event.domain === "employee" &&
      result.message.includes("UNIQUE constraint failed: master_data.id_unik"))
  );
}

export async function existingReceipt(
  transaction: Transaction,
  event: OperationalSyncEvent,
  hash: string,
): Promise<OperationalSyncResult | null> {
  const receipt = await transaction.execute({
    sql: `
      SELECT payload_hash, result_json FROM sync_operation_receipt
      WHERE event_id = ? LIMIT 1;
    `,
    args: [event.eventId],
  });
  if (receipt.rows.length === 0) return null;
  if (String(receipt.rows[0]?.payload_hash) !== hash) {
    return {
      eventId: event.eventId,
      status: "conflict",
      message: "Event ID sudah digunakan dengan payload yang berbeda.",
    };
  }
  try {
    const result = JSON.parse(
      String(receipt.rows[0]?.result_json),
    ) as OperationalSyncResult;
    if (isRetryableLegacyDuplicate(event, result)) {
      await transaction.execute({
        sql: "DELETE FROM sync_operation_receipt WHERE event_id = ?;",
        args: [event.eventId],
      });
      return null;
    }
    return result;
  } catch {
    return {
      eventId: event.eventId,
      status: "rejected",
      message: "Receipt sinkronisasi server tidak valid.",
    };
  }
}

export async function currentEntityRevision(
  transaction: Transaction,
  domain: string,
  entityKey: string,
) {
  const result = await transaction.execute({
    sql: `
      SELECT COALESCE(MAX(revision), 0) AS revision
      FROM sync_change_log WHERE domain = ? AND entity_key = ?;
    `,
    args: [domain, entityKey],
  });
  return Number(result.rows[0]?.revision ?? 0);
}

export async function recordResult(
  transaction: Transaction,
  actor: OperatorUser,
  event: OperationalSyncEvent,
  hash: string,
  result: OperationalSyncResult,
) {
  const now = new Date().toISOString();
  await transaction.execute({
    sql: `
      INSERT INTO sync_operation_receipt (
        event_id, client_id, domain, operation, entity_key, payload_hash,
        status, result_json, base_revision, server_revision,
        actor_operator_id, created_at, processed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
    `,
    args: [
      event.eventId,
      event.clientId,
      event.domain,
      event.operation,
      event.entityKey,
      hash,
      result.status,
      JSON.stringify(result),
      event.baseRevision ?? null,
      result.serverRevision ?? null,
      actor.id,
      new Date(event.createdAt * 1000).toISOString(),
      now,
    ],
  });
}

export async function appendChange(
  transaction: Transaction,
  actor: OperatorUser,
  event: OperationalSyncEvent,
  payload: unknown,
) {
  const result = await transaction.execute({
    sql: `
      INSERT INTO sync_change_log (
        domain, entity_key, operation, payload_json, changed_at,
        actor_operator_id
      ) VALUES (?, ?, ?, ?, ?, ?);
    `,
    args: [
      event.domain,
      event.entityKey,
      event.operation,
      JSON.stringify(payload),
      new Date().toISOString(),
      actor.id,
    ],
  });
  return Number(result.lastInsertRowid);
}
