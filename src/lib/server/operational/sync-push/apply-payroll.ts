import type { Transaction } from "@libsql/client";
import type { OperatorUser } from "@/lib/auth/operator-user";
import type { OperationalSyncEvent } from "@/lib/server/operational/sync-schema";

import { appendChange, number, text } from "./shared";

/**
 * Penerapan event sinkronisasi penggajian: konfigurasi gaji, komponen, aturan, batch, dan itemnya.
 *
 * Dipecah dari `server/operational/sync-push.ts` (2.309 baris). Jalur impornya
 * TIDAK berubah: `@/lib/server/operational/sync-push` kini direktori dengan
 * `index.ts` yang memegang `processOperationalSyncEvent` dan dispatcher-nya.
 */

export async function applyPayroll(
  transaction: Transaction,
  actor: OperatorUser,
  event: OperationalSyncEvent,
) {
  const payload = event.payload;
  const operation = event.operation;

  if (operation === "salary-config") {
    const row = (payload.salaryConfig ?? payload) as Record<string, unknown>;
    const id = text(row, "id") || event.entityKey;
    if (id) {
      await transaction.execute({
        sql: `
          INSERT INTO salary_configs (
            id, id_karyawan, rate_per_hour, rate_per_jp, ptkp_status, effective_date, created_by, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id_karyawan, effective_date) DO UPDATE SET
            rate_per_hour = excluded.rate_per_hour,
            rate_per_jp = excluded.rate_per_jp,
            ptkp_status = excluded.ptkp_status,
            created_by = excluded.created_by;
        `,
        args: [
          id,
          text(row, "id_karyawan"),
          number(row, "rate_per_hour"),
          number(row, "rate_per_jp", 0),
          text(row, "ptkp_status") || "TK/0",
          text(row, "effective_date"),
          text(row, "created_by") || actor.username,
          text(row, "created_at") || new Date().toISOString(),
        ],
      });
    }
  } else if (operation === "overtime-rule") {
    const row = (payload.overtimeRule ?? payload) as Record<string, unknown>;
    const id = text(row, "id") || event.entityKey;
    if (id) {
      await transaction.execute({
        sql: `
          INSERT INTO overtime_tier_rules (
            id, rule_type, tier_order, hour_start, hour_end, multiplier, is_active
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(rule_type, tier_order) DO UPDATE SET
            hour_start = excluded.hour_start,
            hour_end = excluded.hour_end,
            multiplier = excluded.multiplier,
            is_active = excluded.is_active;
        `,
        args: [
          id,
          text(row, "rule_type"),
          number(row, "tier_order"),
          number(row, "hour_start"),
          row.hour_end !== null && row.hour_end !== undefined
            ? Number(row.hour_end)
            : null,
          number(row, "multiplier", 1.0),
          number(row, "is_active", 1),
        ],
      });
    }
  } else if (operation === "jp-rate") {
    // Tarif honor per jam pelajaran. `id_guru` NULL berarti tarif umum mapel
    // itu; tabelnya tanpa UNIQUE selain PK, jadi konflik offline tidak pernah
    // membuat push macet — pemilihan tarifnya yang deterministik.
    const row = (payload.jpRate ?? payload) as Record<string, unknown>;
    const id = text(row, "id") || event.entityKey;
    if (id) {
      await transaction.execute({
        sql: `
          INSERT INTO tarif_jp (
            id, id_mapel, id_guru, rate_per_jp, effective_date, status_aktif, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            id_mapel = excluded.id_mapel,
            id_guru = excluded.id_guru,
            rate_per_jp = excluded.rate_per_jp,
            effective_date = excluded.effective_date,
            status_aktif = excluded.status_aktif,
            updated_at = excluded.updated_at;
        `,
        args: [
          id,
          text(row, "id_mapel"),
          text(row, "id_guru") || null,
          number(row, "rate_per_jp"),
          text(row, "effective_date"),
          number(row, "status_aktif", 1),
          text(row, "created_at") || new Date().toISOString(),
          text(row, "updated_at") || new Date().toISOString(),
        ],
      });
    }
  } else if (operation === "payroll-component") {
    const row = (payload.component ?? payload) as Record<string, unknown>;
    const id = text(row, "id") || event.entityKey;
    if (id) {
      await transaction.execute({
        sql: `
          INSERT INTO payroll_components (
            id, name, category, calc_type, default_value, applies_to, is_active
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            name = excluded.name,
            category = excluded.category,
            calc_type = excluded.calc_type,
            default_value = excluded.default_value,
            applies_to = excluded.applies_to,
            is_active = excluded.is_active;
        `,
        args: [
          id,
          text(row, "name"),
          text(row, "category"),
          text(row, "calc_type"),
          number(row, "default_value"),
          text(row, "applies_to") || "ALL",
          number(row, "is_active", 1),
        ],
      });
    }
  } else if (operation === "tax-rule") {
    const row = (payload.taxRule ?? payload) as Record<string, unknown>;
    const id = text(row, "id") || event.entityKey;
    if (id) {
      await transaction.execute({
        sql: `
          INSERT INTO tax_rules (
            id, category, bracket_min, bracket_max, rate_percentage, effective_date
          ) VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            category = excluded.category,
            bracket_min = excluded.bracket_min,
            bracket_max = excluded.bracket_max,
            rate_percentage = excluded.rate_percentage,
            effective_date = excluded.effective_date;
        `,
        args: [
          id,
          text(row, "category"),
          number(row, "bracket_min"),
          row.bracket_max !== null && row.bracket_max !== undefined
            ? Number(row.bracket_max)
            : null,
          number(row, "rate_percentage"),
          text(row, "effective_date"),
        ],
      });
    }
  } else if (operation === "bpjs-rule") {
    const row = (payload.bpjsRule ?? payload) as Record<string, unknown>;
    const id = text(row, "id") || event.entityKey;
    if (id) {
      await transaction.execute({
        sql: `
          INSERT INTO bpjs_rules (
            id, component_code, component_name, rate_percentage, wage_cap, effective_date
          ) VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(component_code) DO UPDATE SET
            component_name = excluded.component_name,
            rate_percentage = excluded.rate_percentage,
            wage_cap = excluded.wage_cap,
            effective_date = excluded.effective_date;
        `,
        args: [
          id,
          text(row, "component_code"),
          text(row, "component_name"),
          number(row, "rate_percentage"),
          row.wage_cap !== null && row.wage_cap !== undefined
            ? Number(row.wage_cap)
            : null,
          text(row, "effective_date"),
        ],
      });
    }
  } else if (operation === "delete") {
    const table = text(payload, "table");
    const id = text(payload, "id") || event.entityKey;
    const deletable = [
      "salary_configs",
      "overtime_tier_rules",
      "payroll_components",
      "tax_rules",
      "bpjs_rules",
      "tarif_jp",
    ];
    if (id && deletable.includes(table)) {
      await transaction.execute({
        sql: `DELETE FROM ${table} WHERE id = ?;`,
        args: [id],
      });
    }
  } else if (operation === "create-run") {
    const run = (payload.run ?? payload) as Record<string, unknown>;
    const runId = text(run, "id") || event.entityKey;
    if (runId) {
      await transaction.execute({
        sql: `
          INSERT INTO payroll_runs (
            id, idempotency_key, period_start, period_end, status,
            total_gross_payout, total_net_payout, total_employees,
            created_by, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO NOTHING;
        `,
        args: [
          runId,
          text(run, "idempotency_key"),
          text(run, "period_start"),
          text(run, "period_end"),
          text(run, "status") || "DRAFT",
          number(run, "total_gross_payout"),
          number(run, "total_net_payout"),
          number(run, "total_employees"),
          text(run, "created_by") || actor.username,
          text(run, "created_at") || new Date().toISOString(),
          text(run, "updated_at") || new Date().toISOString(),
        ],
      });

      if (Array.isArray(payload.items)) {
        for (const item of payload.items as Record<string, unknown>[]) {
          const itemId = text(item, "id");
          if (!itemId) continue;
          await transaction.execute({
            sql: `
              INSERT INTO payroll_items (
                id, payroll_run_id, id_karyawan, nama_karyawan, divisi, ptkp_status,
                total_regular_hours, total_overtime_hours, total_overtime_index,
                total_holiday_hours, total_holiday_overtime_index,
                total_teaching_jp, teaching_salary,
                rate_per_hour, basic_salary, overtime_salary, gross_salary,
                total_allowances, total_deductions, bpjs_employee_total, bpjs_company_total,
                pph21_amount, net_salary, breakdown_snapshot, created_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(id) DO NOTHING;
            `,
            args: [
              itemId,
              runId,
              text(item, "id_karyawan"),
              text(item, "nama_karyawan"),
              text(item, "divisi"),
              text(item, "ptkp_status") || "TK/0",
              number(item, "total_regular_hours"),
              number(item, "total_overtime_hours"),
              number(item, "total_overtime_index"),
              // Klien versi lama tidak mengirim dua kunci ini; `number` sudah
              // mengembalikan 0 untuk kunci yang hilang, dan 0 memang arti yang
              // benar: mereka belum pernah memisahkan jam hari libur.
              number(item, "total_holiday_hours"),
              number(item, "total_holiday_overtime_index"),
              // Alasan yang sama untuk honor mengajar (v22): klien lama tidak
              // mengirimnya, dan 0 memang arti yang benar bagi mereka.
              number(item, "total_teaching_jp"),
              number(item, "teaching_salary"),
              number(item, "rate_per_hour"),
              number(item, "basic_salary"),
              number(item, "overtime_salary"),
              number(item, "gross_salary"),
              number(item, "total_allowances"),
              number(item, "total_deductions"),
              number(item, "bpjs_employee_total"),
              number(item, "bpjs_company_total"),
              number(item, "pph21_amount"),
              number(item, "net_salary"),
              typeof item.breakdown_snapshot === "string"
                ? item.breakdown_snapshot
                : JSON.stringify(item.breakdown_snapshot ?? {}),
              text(item, "created_at") || new Date().toISOString(),
            ],
          });
        }
      }

      if (payload.audit && typeof payload.audit === "object") {
        const audit = payload.audit as Record<string, unknown>;
        const auditId = text(audit, "id");
        if (auditId) {
          await transaction.execute({
            sql: `
              INSERT INTO payroll_audit_logs (
                id, payroll_run_id, action, old_status, new_status, performed_by, notes, created_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(id) DO NOTHING;
            `,
            args: [
              auditId,
              runId,
              text(audit, "action"),
              text(audit, "old_status") || null,
              text(audit, "new_status"),
              text(audit, "performed_by") || actor.username,
              text(audit, "notes") || null,
              text(audit, "created_at") || new Date().toISOString(),
            ],
          });
        }
      }
    }
  } else if (operation === "transition-status") {
    const runId = text(payload, "id") || event.entityKey;
    const status = text(payload, "status");
    const updatedAt = text(payload, "updated_at") || new Date().toISOString();
    if (runId && status) {
      await transaction.execute({
        sql: "UPDATE payroll_runs SET status = ?, updated_at = ? WHERE id = ?;",
        args: [status, updatedAt, runId],
      });
    }
    if (payload.audit && typeof payload.audit === "object") {
      const audit = payload.audit as Record<string, unknown>;
      const auditId = text(audit, "id");
      if (auditId && runId) {
        await transaction.execute({
          sql: `
            INSERT INTO payroll_audit_logs (
              id, payroll_run_id, action, old_status, new_status, performed_by, notes, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO NOTHING;
          `,
          args: [
            auditId,
            runId,
            text(audit, "action"),
            text(audit, "old_status") || null,
            text(audit, "new_status"),
            text(audit, "performed_by") || actor.username,
            text(audit, "notes") || null,
            text(audit, "created_at") || new Date().toISOString(),
          ],
        });
      }
    }
  }

  const revision = await appendChange(transaction, actor, event, payload);
  return { revision, payload: { id: event.entityKey } };
}
