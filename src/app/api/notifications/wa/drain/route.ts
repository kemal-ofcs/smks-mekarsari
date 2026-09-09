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
import { drainWaQueue } from "@/lib/services/wa-sender";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    assertSameOriginMutation(request);
    await requireWebPermission(request, "notification.send");
    await ensureServerDatabaseInitialized();

    const client = getServerDatabase();
    const result = await drainWaQueue(client, 25);
    return noStoreJson(result);
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
