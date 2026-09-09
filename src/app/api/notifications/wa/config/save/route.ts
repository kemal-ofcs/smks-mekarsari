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
import { saveWaConfig } from "@/lib/services/wa-notification";
import type { WaConfigDraft } from "@/types/wa-notification";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    assertSameOriginMutation(request);
    await requireWebPermission(request, "notification.manage");
    await ensureServerDatabaseInitialized();

    const body = await readJsonBody<WaConfigDraft>(request);
    const client = getServerDatabase();
    const result = await saveWaConfig(client, body);
    return noStoreJson(result);
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
