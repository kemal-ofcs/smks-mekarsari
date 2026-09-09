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
import { deleteFrozenLedger } from "@/lib/services/attendance-ledger";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    assertSameOriginMutation(request);
    await requireWebPermission(request, "attendance_ledger.delete");
    await ensureServerDatabaseInitialized();
    const body = await readJsonBody<{
      id_tahun_ajaran?: string;
      semester?: string;
      id_rombel?: string;
    }>(request);

    if (!body?.id_tahun_ajaran || !body?.semester || !body?.id_rombel) {
      throw new ApiRequestError(
        "Tahun ajaran, semester, dan rombel wajib ditentukan untuk menghapus leger.",
        400,
      );
    }

    const result = await deleteFrozenLedger(
      body.id_tahun_ajaran,
      body.semester,
      body.id_rombel,
    );
    return noStoreJson(result);
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
