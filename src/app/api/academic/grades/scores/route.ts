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
import { saveScores } from "@/lib/services/grades";
import type { SimpanNilaiDraft } from "@/types/grades";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    assertSameOriginMutation(request);
    await requireWebPermission(request, "grades.manage");
    await ensureServerDatabaseInitialized();

    const draft = await readJsonBody<SimpanNilaiDraft>(request);
    const hasil = await saveScores(getServerDatabase(), draft);
    return noStoreJson({ sukses: true, ...hasil });
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
