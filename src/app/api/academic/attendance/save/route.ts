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
  type SaveClassAttendanceDraft,
  saveClassAttendance,
} from "@/lib/services/class-attendance";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    assertSameOriginMutation(request);
    await requireWebPermission(request, "class_attendance.manage");
    await ensureServerDatabaseInitialized();
    const body = await readJsonBody<
      { draft?: SaveClassAttendanceDraft } & SaveClassAttendanceDraft
    >(request);
    const draft = body?.draft || body;

    if (!draft || !draft.id_rombel || !draft.id_mapel || !draft.tanggal) {
      throw new ApiRequestError("Data presensi tidak lengkap.", 400);
    }

    const result = await saveClassAttendance(draft);
    return noStoreJson(result);
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
