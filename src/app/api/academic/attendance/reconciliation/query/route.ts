import type { NextRequest } from "next/server";
import { requireWebPermission } from "@/lib/server/auth/authorize";
import { ensureServerDatabaseInitialized } from "@/lib/server/db";
import {
  noStoreJson,
  readJsonBody,
  toApiErrorResponse,
} from "@/lib/server/http/api-response";
import { assertSameOriginMutation } from "@/lib/server/http/request-security";
import { getAttendanceReconciliation } from "@/lib/services/class-attendance";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    assertSameOriginMutation(request);
    await requireWebPermission(request, "class_attendance.view");
    await ensureServerDatabaseInitialized();
    interface ReconciliationQueryBody {
      tanggal?: string;
      id_rombel?: string;
      idRombel?: string;
    }
    const body = await readJsonBody<ReconciliationQueryBody>(request).catch(
      (): ReconciliationQueryBody => ({}),
    );

    const result = await getAttendanceReconciliation({
      tanggal: body.tanggal,
      id_rombel: body.idRombel || body.id_rombel,
    });
    return noStoreJson({ sukses: true, ...result });
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
