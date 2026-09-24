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
import { saveWaTemplates } from "@/lib/services/wa-notification";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    assertSameOriginMutation(request);
    await requireWebPermission(request, "notification.template");
    await ensureServerDatabaseInitialized();

    const body = await readJsonBody<unknown>(request);
    const templates = await saveWaTemplates(getServerDatabase(), body);
    return noStoreJson(templates);
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
