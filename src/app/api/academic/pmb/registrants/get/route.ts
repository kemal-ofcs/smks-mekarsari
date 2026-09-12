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
import { getPmbRegistrant } from "@/lib/services/pmb-admin";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    assertSameOriginMutation(request);
    await requireWebPermission(request, "pmb.view");
    await ensureServerDatabaseInitialized();

    const { idPendaftar } = await readJsonBody<{ idPendaftar: string }>(
      request,
    );
    const detail = await getPmbRegistrant(getServerDatabase(), idPendaftar);
    return noStoreJson({ sukses: true, ...detail });
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
