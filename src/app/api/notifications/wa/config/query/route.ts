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
import { getWaConfig } from "@/lib/services/wa-notification";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    assertSameOriginMutation(request);
    await requireWebPermission(request, "notification.view");
    await ensureServerDatabaseInitialized();

    const client = getServerDatabase();
    const config = await getWaConfig(client);
    return noStoreJson({ sukses: true, config });
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
