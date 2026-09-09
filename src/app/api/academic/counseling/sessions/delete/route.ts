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
import { deleteCounselingSession } from "@/lib/services/counseling";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    assertSameOriginMutation(request);
    await requireWebPermission(request, "counseling.delete");
    await ensureServerDatabaseInitialized();

    interface DeleteSessionBody {
      idSesi?: string;
      id_sesi?: string;
    }
    const body = await readJsonBody<DeleteSessionBody>(request);
    const idSesi = (body.idSesi ?? body.id_sesi)?.trim();
    if (!idSesi) {
      throw new Error("ID sesi konseling wajib disertakan.");
    }

    const client = getServerDatabase();
    const result = await deleteCounselingSession(client, idSesi);
    return noStoreJson(result);
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
