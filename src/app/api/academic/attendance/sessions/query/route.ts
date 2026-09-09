import type { NextRequest } from "next/server";
import { requireWebPermission } from "@/lib/server/auth/authorize";
import { ensureServerDatabaseInitialized } from "@/lib/server/db";
import {
  noStoreJson,
  readJsonBody,
  toApiErrorResponse,
} from "@/lib/server/http/api-response";
import { assertSameOriginMutation } from "@/lib/server/http/request-security";
import {
  type ClassAttendanceSessionFilter,
  getClassAttendanceSessions,
} from "@/lib/services/class-attendance";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    assertSameOriginMutation(request);
    await requireWebPermission(request, "class_attendance.view");
    await ensureServerDatabaseInitialized();
    const body = await readJsonBody<Record<string, unknown>>(request).catch(
      () => ({}),
    );
    const sessions = await getClassAttendanceSessions(
      body as unknown as ClassAttendanceSessionFilter,
    );
    return noStoreJson({ sukses: true, sessions });
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
