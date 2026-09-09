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
import {
  freezeAttendanceLedger,
  type LedgerStudentItem,
} from "@/lib/services/attendance-ledger";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    assertSameOriginMutation(request);
    const actor = await requireWebPermission(
      request,
      "attendance_ledger.manage",
    );
    await ensureServerDatabaseInitialized();
    const body = await readJsonBody<{
      id_tahun_ajaran?: string;
      semester?: string;
      id_rombel?: string;
      items?: Array<Partial<LedgerStudentItem> & { id_leger?: string }>;
    }>(request);

    if (!body?.id_tahun_ajaran || !body?.semester || !body?.id_rombel) {
      throw new ApiRequestError(
        "Tahun ajaran, semester, dan rombel wajib ditentukan untuk pembekuan leger.",
        400,
      );
    }

    const result = await freezeAttendanceLedger(actor.username, {
      id_tahun_ajaran: body.id_tahun_ajaran,
      semester: body.semester,
      id_rombel: body.id_rombel,
      items: body.items,
    });
    return noStoreJson(result);
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
