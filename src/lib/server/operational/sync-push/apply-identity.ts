import type { Transaction } from "@libsql/client";
import type { OperatorUser } from "@/lib/auth/operator-user";
import { BRANDING } from "@/lib/constants/branding";
import type { OperationalSyncEvent } from "@/lib/server/operational/sync-schema";

import { appendChange, number, text } from "./shared";

/**
 * Penerapan event sinkronisasi identitas dan pengaturan: kartu identitas, templatenya, setting sistem, dan profil perusahaan.
 *
 * Dipecah dari `server/operational/sync-push.ts` (2.309 baris). Jalur impornya
 * TIDAK berubah: `@/lib/server/operational/sync-push` kini direktori dengan
 * `index.ts` yang memegang `processOperationalSyncEvent` dan dispatcher-nya.
 */

export async function applyIdCard(
  transaction: Transaction,
  actor: OperatorUser,
  event: OperationalSyncEvent,
) {
  if (event.operation !== "update")
    throw new Error("Operasi ID Card tidak dikenali.");
  const status = text(event.payload, "idcard_status");
  if (!event.entityKey || !["Belum", "Berhasil", "Gagal"].includes(status)) {
    throw new Error("Data ID Card tidak valid.");
  }
  const changed = await transaction.execute({
    sql: `UPDATE id_card SET idcard_status = ?, tanggal_generate = ?,
      idcard_last_generate = ?, idcard_pdf_url = ?, link_qr_png = ?,
      idcard_catatan = ? WHERE id_unik = ?;`,
    args: [
      status,
      text(event.payload, "tanggal_generate"),
      text(event.payload, "idcard_last_generate"),
      text(event.payload, "idcard_pdf_url"),
      text(event.payload, "link_qr_png"),
      text(event.payload, "idcard_catatan"),
      event.entityKey,
    ],
  });
  if (changed.rowsAffected === 0)
    throw new Error("ID Card karyawan tidak ditemukan.");
  const revision = await appendChange(transaction, actor, event, event.payload);
  return { revision, payload: { id_unik: event.entityKey } };
}

export async function applySetting(
  transaction: Transaction,
  actor: OperatorUser,
  event: OperationalSyncEvent,
) {
  const payload = event.payload;
  const key = text(payload, "key") || event.entityKey;
  const value =
    typeof payload.value === "string"
      ? payload.value
      : String(payload.value ?? "");
  await transaction.execute({
    sql: `INSERT INTO setting_gex_system (key, value) VALUES (?, ?)
          ON CONFLICT(key) DO UPDATE SET value = excluded.value;`,
    args: [key, value],
  });
  const revision = await appendChange(transaction, actor, event, payload);
  return { revision, payload: { key, value } };
}

export async function applyCompanyProfile(
  transaction: Transaction,
  actor: OperatorUser,
  event: OperationalSyncEvent,
) {
  const payload = event.payload;
  const id = text(payload, "id") || "default_company";
  const now = new Date().toISOString();
  await transaction.execute({
    sql: `
      INSERT INTO company_profile (
        id, company_name, branch_name, logo_url, signature_url,
        address, phone, email, website,
        leader_name, leader_title, leader_nip,
        card_terms, timezone, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        company_name = excluded.company_name,
        branch_name = excluded.branch_name,
        logo_url = excluded.logo_url,
        signature_url = excluded.signature_url,
        address = excluded.address,
        phone = excluded.phone,
        email = excluded.email,
        website = excluded.website,
        leader_name = excluded.leader_name,
        leader_title = excluded.leader_title,
        leader_nip = excluded.leader_nip,
        card_terms = excluded.card_terms,
        timezone = excluded.timezone,
        updated_at = excluded.updated_at;
    `,
    args: [
      id,
      text(payload, "company_name") || BRANDING.defaultCompanyName,
      text(payload, "branch_name") || null,
      text(payload, "logo_url") || null,
      text(payload, "signature_url") || null,
      text(payload, "address") || null,
      text(payload, "phone") || null,
      text(payload, "email") || null,
      text(payload, "website") || null,
      text(payload, "leader_name") || null,
      text(payload, "leader_title") || null,
      text(payload, "leader_nip") || null,
      text(payload, "card_terms") || null,
      text(payload, "timezone") || "Asia/Jakarta",
      now,
    ],
  });
  const revision = await appendChange(transaction, actor, event, payload);
  return {
    revision,
    payload: { id, company_name: text(payload, "company_name") },
  };
}

export async function applyIdCardTemplate(
  transaction: Transaction,
  actor: OperatorUser,
  event: OperationalSyncEvent,
) {
  const payload = event.payload;
  const id = text(payload, "id") || "default_template";
  const now = new Date().toISOString();
  const elementsJson =
    typeof payload.elements_json === "string"
      ? payload.elements_json
      : JSON.stringify(payload.elements_json ?? []);
  await transaction.execute({
    sql: `
      INSERT INTO id_card_template (
        id, name, orientation, front_bg_url, back_bg_url, elements_json, is_active, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        orientation = excluded.orientation,
        front_bg_url = excluded.front_bg_url,
        back_bg_url = excluded.back_bg_url,
        elements_json = excluded.elements_json,
        is_active = excluded.is_active,
        updated_at = excluded.updated_at;
    `,
    args: [
      id,
      text(payload, "name") || BRANDING.defaultTemplateName,
      text(payload, "orientation") || "landscape",
      text(payload, "front_bg_url") || null,
      text(payload, "back_bg_url") || null,
      elementsJson,
      number(payload, "is_active", 1),
      now,
      now,
    ],
  });
  const revision = await appendChange(transaction, actor, event, payload);
  return { revision, payload: { id, name: text(payload, "name") } };
}
