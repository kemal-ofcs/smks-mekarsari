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
import { deleteCounselingCase } from "@/lib/services/counseling";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    assertSameOriginMutation(request);
    await requireWebPermission(request, "counseling.delete");
    await ensureServerDatabaseInitialized();

    interface DeleteCaseBody {
      idKasus?: string;
      id_kasus?: string;
    }
    const body = await readJsonBody<DeleteCaseBody>(request);
    const idKasus = (body.idKasus ?? body.id_kasus)?.trim();
    if (!idKasus) {
      throw new Error("ID kasus BK wajib disertakan.");
    }

    const client = getServerDatabase();
    const result = await deleteCounselingCase(client, idKasus);
    return noStoreJson(result);
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
