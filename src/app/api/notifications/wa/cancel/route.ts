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
import { cancelWaNotification } from "@/lib/services/wa-notification";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    assertSameOriginMutation(request);
    await requireWebPermission(request, "notification.delete");
    await ensureServerDatabaseInitialized();

    interface CancelWaBody {
      idNotifikasi?: string;
      id_notifikasi?: string;
    }
    const body = await readJsonBody<CancelWaBody>(request);
    const idNotifikasi = (body.idNotifikasi ?? body.id_notifikasi)?.trim();
    if (!idNotifikasi) {
      throw new Error("ID notifikasi wajib disertakan.");
    }

    const client = getServerDatabase();
    const result = await cancelWaNotification(client, idNotifikasi);
    return noStoreJson(result);
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
