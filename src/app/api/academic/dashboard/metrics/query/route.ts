import type { NextRequest } from "next/server";
import { requireWebPermission } from "@/lib/server/auth/authorize";
import { ensureServerDatabaseInitialized } from "@/lib/server/db";
import {
  noStoreJson,
  readJsonBody,
  toApiErrorResponse,
} from "@/lib/server/http/api-response";
import { assertSameOriginMutation } from "@/lib/server/http/request-security";
import { getAttendanceDashboardMetrics } from "@/lib/services/attendance-dashboard";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    assertSameOriginMutation(request);
    await requireWebPermission(request, "attendance_dashboard.view");
    await ensureServerDatabaseInitialized();

    interface DashboardQueryBody {
      tanggal?: string;
    }
    const body = await readJsonBody<DashboardQueryBody>(request).catch(
      (): DashboardQueryBody => ({}),
    );

    const result = await getAttendanceDashboardMetrics({
      tanggal: body.tanggal,
    });
    return noStoreJson({ sukses: true, data: result });
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
