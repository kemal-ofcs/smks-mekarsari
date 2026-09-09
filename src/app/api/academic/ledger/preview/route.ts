import type { NextRequest } from "next/server";
import { requireWebPermission } from "@/lib/server/auth/authorize";
import { ensureServerDatabaseInitialized } from "@/lib/server/db";
import {
  ApiRequestError,
  noStoreJson,
  readJsonBody,
  toApiErrorResponse,
} from "@/lib/server/http/api-response";
import { assertSameOriginMutation } from "@/lib/server/http/request-security";
import { getLedgerPreview } from "@/lib/services/attendance-ledger";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    assertSameOriginMutation(request);
    await requireWebPermission(request, "attendance_ledger.view");
    await ensureServerDatabaseInitialized();
    const body = await readJsonBody<{
      id_tahun_ajaran?: string;
      semester?: string;
      id_rombel?: string;
    }>(request);

    if (!body?.id_tahun_ajaran || !body?.semester) {
      throw new ApiRequestError("Tahun ajaran dan semester wajib diisi.", 400);
    }

    const preview = await getLedgerPreview(
      body.id_tahun_ajaran,
      body.semester,
      body.id_rombel,
    );
    return noStoreJson(preview);
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
