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
import { listWaNotifications } from "@/lib/services/wa-notification";
import type { WaNotificationFilter } from "@/types/wa-notification";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    assertSameOriginMutation(request);
    await requireWebPermission(request, "notification.view");
    await ensureServerDatabaseInitialized();

    const body = await readJsonBody<WaNotificationFilter>(request).catch(
      (): WaNotificationFilter => ({}),
    );

    const client = getServerDatabase();
    const result = await listWaNotifications(client, body);
    return noStoreJson({ sukses: true, items: result.items });
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
