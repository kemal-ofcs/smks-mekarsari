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
import { getWaTemplates } from "@/lib/services/wa-notification";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    assertSameOriginMutation(request);
    await requireWebPermission(request, "notification.view");
    await ensureServerDatabaseInitialized();

    const templates = await getWaTemplates(getServerDatabase());
    return noStoreJson(templates);
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
