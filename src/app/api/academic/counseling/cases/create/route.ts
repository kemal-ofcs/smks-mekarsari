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
import { createCounselingCase } from "@/lib/services/counseling";
import type { CounselingCaseDraft } from "@/types/counseling";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    assertSameOriginMutation(request);
    const session = await requireWebPermission(request, "counseling.manage");
    await ensureServerDatabaseInitialized();

    const body = await readJsonBody<CounselingCaseDraft>(request);
    const client = getServerDatabase();
    const result = await createCounselingCase(
      client,
      body,
      session.nama_operator || session.username,
    );
    return noStoreJson(result);
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
