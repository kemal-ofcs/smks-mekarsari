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
import { getClassAttendanceDetail } from "@/lib/services/class-attendance";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    assertSameOriginMutation(request);
    await requireWebPermission(request, "class_attendance.view");
    await ensureServerDatabaseInitialized();
    const body = await readJsonBody<{
      id_presensi_mapel?: string;
      idPresensiMapel?: string;
    }>(request);
    const id = body?.idPresensiMapel || body?.id_presensi_mapel;
    if (!id || typeof id !== "string") {
      throw new ApiRequestError("id_presensi_mapel wajib disertakan.", 400);
    }
    const data = await getClassAttendanceDetail(id);
    return noStoreJson({ sukses: true, ...data });
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
