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
import { getRosterForAttendance } from "@/lib/services/class-attendance";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    assertSameOriginMutation(request);
    await requireWebPermission(request, "class_attendance.view");
    await ensureServerDatabaseInitialized();
    const body = await readJsonBody<{
      id_rombel?: string;
      idRombel?: string;
      tanggal?: string;
    }>(request);
    const idRombel = body?.idRombel || body?.id_rombel;
    const tanggal = body?.tanggal;

    if (!idRombel || !tanggal) {
      throw new ApiRequestError("id_rombel dan tanggal wajib disertakan.", 400);
    }

    const roster = await getRosterForAttendance(idRombel, tanggal);
    return noStoreJson({ sukses: true, roster });
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
