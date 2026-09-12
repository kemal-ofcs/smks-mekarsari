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
import { savePmbWave } from "@/lib/services/pmb-admin";
import type { PmbWaveDraft } from "@/types/pmb";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    assertSameOriginMutation(request);
    await requireWebPermission(request, "pmb.manage");
    await ensureServerDatabaseInitialized();

    const draft = await readJsonBody<PmbWaveDraft>(request);
    const hasil = await savePmbWave(getServerDatabase(), draft);
    return noStoreJson({ sukses: true, ...hasil });
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
