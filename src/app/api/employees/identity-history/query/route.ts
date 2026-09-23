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
import { listRiwayatIdentitasKaryawan } from "@/lib/services/employee-identity-history";

export const runtime = "nodejs";

interface HistoryQueryBody {
  search?: unknown;
  limit?: unknown;
}

/**
 * Pembacaan riwayat penggantian identitas karyawan.
 *
 * `POST`, bukan `GET`: build Desktop/Mobile memakai `output: "export"` yang
 * tidak dapat melayani route handler `GET`.
 */
export async function POST(request: NextRequest) {
  try {
    assertSameOriginMutation(request);
    await ensureServerDatabaseInitialized();
    await requireWebPermission(request, "employees.view");
    const body = await readJsonBody<HistoryQueryBody>(request);
    return noStoreJson({
      sukses: true,
      entries: await listRiwayatIdentitasKaryawan(
        getServerDatabase(),
        typeof body.search === "string" ? body.search : "",
        Number.isFinite(Number(body.limit)) ? Number(body.limit) : 200,
      ),
    });
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
