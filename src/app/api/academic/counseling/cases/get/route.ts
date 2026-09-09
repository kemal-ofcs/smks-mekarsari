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
import { getCounselingCase } from "@/lib/services/counseling";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    assertSameOriginMutation(request);
    await requireWebPermission(request, "counseling.view");
    await ensureServerDatabaseInitialized();

    interface GetCaseBody {
      idKasus?: string;
      id_kasus?: string;
    }
    const body = await readJsonBody<GetCaseBody>(request);
    const idKasus = (body.idKasus ?? body.id_kasus)?.trim();
    if (!idKasus) {
      throw new Error("ID kasus BK wajib disertakan.");
    }

    const client = getServerDatabase();
    const result = await getCounselingCase(client, idKasus);
    return noStoreJson({ sukses: true, case: result });
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
