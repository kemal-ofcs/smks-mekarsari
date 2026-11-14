import type { NextRequest } from "next/server";
import { requireWebPermission } from "@/lib/server/auth/authorize";
import {
  ensureServerDatabaseInitialized,
  getServerDatabase,
} from "@/lib/server/db";
import {
  noStoreJson,
  toApiErrorResponse,
} from "@/lib/server/http/api-response";
import { assertSameOriginMutation } from "@/lib/server/http/request-security";
import { gantiSaya } from "@/lib/services/hr-pengajuan";

export const runtime = "nodejs";

/** JP hari ini yang digantikan personil sesi; cermin `desktop_hr_my_substitutions`. */
export async function POST(request: NextRequest) {
  try {
    assertSameOriginMutation(request);
    const actor = await requireWebPermission(request, "class_attendance.view");
    await ensureServerDatabaseInitialized();
    return noStoreJson(await gantiSaya(getServerDatabase(), actor));
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
