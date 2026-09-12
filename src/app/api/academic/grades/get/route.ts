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
import { getAssessment } from "@/lib/services/grades";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    assertSameOriginMutation(request);
    await requireWebPermission(request, "grades.view");
    await ensureServerDatabaseInitialized();

    const { idPenilaian } = await readJsonBody<{ idPenilaian: string }>(
      request,
    );
    const detail = await getAssessment(getServerDatabase(), idPenilaian);
    return noStoreJson({ sukses: true, ...detail });
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
