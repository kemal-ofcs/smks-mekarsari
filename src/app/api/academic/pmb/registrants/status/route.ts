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
import { updatePmbStatus } from "@/lib/services/pmb-admin";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    assertSameOriginMutation(request);
    const operator = await requireWebPermission(request, "pmb.manage");
    await ensureServerDatabaseInitialized();

    const body = await readJsonBody<{
      idPendaftar: string;
      status: string;
      catatan?: string | null;
    }>(request);

    await updatePmbStatus(
      getServerDatabase(),
      body.idPendaftar,
      body.status,
      body.catatan ?? null,
      operator.username,
    );
    return noStoreJson({ sukses: true });
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
