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
import { getLampiran } from "@/lib/services/hris";
import { lampiranQuerySchema } from "@/lib/validations/hris";

export const runtime = "nodejs";

/** Lampiran satu pengajuan tanpa isinya; cermin `desktop_hr_request_files`. */
export async function POST(request: NextRequest) {
  try {
    assertSameOriginMutation(request);
    const actor = await requireWebPermission(request, "hr.request.view");
    await ensureServerDatabaseInitialized();
    const parsed = lampiranQuerySchema.safeParse(await readJsonBody(request));
    if (!parsed.success) {
      return noStoreJson(
        { sukses: false, pesan: "Pengajuan tidak dikenal." },
        400,
      );
    }
    return noStoreJson(
      await getLampiran(getServerDatabase(), actor, parsed.data.id_pengajuan),
    );
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
