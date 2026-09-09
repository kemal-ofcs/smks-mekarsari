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
import { listCounselingCases } from "@/lib/services/counseling";
import type { CounselingCaseFilter } from "@/types/counseling";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    assertSameOriginMutation(request);
    await requireWebPermission(request, "counseling.view");
    await ensureServerDatabaseInitialized();

    const body = await readJsonBody<CounselingCaseFilter>(request).catch(
      (): CounselingCaseFilter => ({}),
    );

    const client = getServerDatabase();
    const result = await listCounselingCases(client, body);
    return noStoreJson({ sukses: true, items: result.items });
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
