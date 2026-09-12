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
import { listPmbRegistrants } from "@/lib/services/pmb-admin";
import type { PmbRegistrantFilter } from "@/types/pmb";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    assertSameOriginMutation(request);
    await requireWebPermission(request, "pmb.view");
    await ensureServerDatabaseInitialized();

    const filter = await readJsonBody<PmbRegistrantFilter>(request).catch(
      (): PmbRegistrantFilter => ({}),
    );
    const hasil = await listPmbRegistrants(getServerDatabase(), filter);
    return noStoreJson({ sukses: true, items: hasil.items });
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
