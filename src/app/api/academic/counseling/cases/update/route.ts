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
import { updateCounselingCase } from "@/lib/services/counseling";
import type { CounselingCaseDraft } from "@/types/counseling";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    assertSameOriginMutation(request);
    await requireWebPermission(request, "counseling.manage");
    await ensureServerDatabaseInitialized();

    interface UpdateCaseBody {
      idKasus?: string;
      id_kasus?: string;
      draft: Partial<CounselingCaseDraft>;
    }
    const body = await readJsonBody<UpdateCaseBody>(request);
    const idKasus = (body.idKasus ?? body.id_kasus)?.trim();
    if (!idKasus) {
      throw new Error("ID kasus BK wajib disertakan.");
    }

    const client = getServerDatabase();
    const result = await updateCounselingCase(client, idKasus, body.draft);
    return noStoreJson(result);
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
