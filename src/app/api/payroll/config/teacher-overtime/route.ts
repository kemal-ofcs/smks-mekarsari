import type { NextRequest } from "next/server";
import { requireWebPermission } from "@/lib/server/auth/authorize";
import {
  ensureServerDatabaseInitialized,
  getServerDatabase,
} from "@/lib/server/db";
import {
  noStoreJson,
  readJsonBody,
  toApiErrorResponse,
} from "@/lib/server/http/api-response";
import { assertSameOriginMutation } from "@/lib/server/http/request-security";
import { recordOperationalChange } from "@/lib/server/operational/change-log";
import {
  parseTeacherOvertimeSetting,
  TEACHER_OVERTIME_SETTING_KEY,
} from "@/lib/validations/payroll-policy";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    assertSameOriginMutation(request);
    await requireWebPermission(request, "payroll.view");
    await ensureServerDatabaseInitialized();
    const client = getServerDatabase();

    const result = await client.execute({
      sql: "SELECT value FROM setting_gex_system WHERE key = ? LIMIT 1;",
      args: [TEACHER_OVERTIME_SETTING_KEY],
    });
    const row = result.rows[0];
    return noStoreJson({
      enabled: parseTeacherOvertimeSetting(
        row ? String(row.value ?? "") : null,
      ),
    });
  } catch (error) {
    return toApiErrorResponse(error);
  }
}

export async function PUT(request: NextRequest) {
  try {
    const actor = await requireWebPermission(request, "payroll.config.manage");
    assertSameOriginMutation(request);
    await ensureServerDatabaseInitialized();
    const client = getServerDatabase();

    const body = await readJsonBody<{ enabled?: unknown }>(request);
    const enabled = Boolean(body.enabled);

    await client.execute({
      sql: `INSERT INTO setting_gex_system (key, value) VALUES (?, ?)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value;`,
      args: [TEACHER_OVERTIME_SETTING_KEY, enabled ? "true" : "false"],
    });

    await recordOperationalChange(client, {
      domain: "setting",
      entityKey: TEACHER_OVERTIME_SETTING_KEY,
      operation: "update",
      payload: { enabled },
      actorOperatorId: actor.id,
    });

    return noStoreJson({ sukses: true, enabled });
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
