import type { NextRequest } from "next/server";
import { requireWebPermission } from "@/lib/server/auth/authorize";
import { ensureServerDatabaseInitialized } from "@/lib/server/db";
import {
  noStoreJson,
  toApiErrorResponse,
} from "@/lib/server/http/api-response";
import { assertSameOriginMutation } from "@/lib/server/http/request-security";
import { jalankanAuditKualitasAbsensi } from "@/lib/services/alfa-audit";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    assertSameOriginMutation(request);
    await requireWebPermission(request, "attendance_audit.view");
    await ensureServerDatabaseInitialized();
    const result = await jalankanAuditKualitasAbsensi();
    return noStoreJson(result);
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
