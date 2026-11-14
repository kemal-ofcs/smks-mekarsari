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
import { getIsiLampiran } from "@/lib/services/hris";
import { idSchema } from "@/lib/validations/hris";

export const runtime = "nodejs";

/** Satu lampiran pengajuan beserta isinya; cermin `desktop_hr_request_file`. */
export async function POST(request: NextRequest) {
  try {
    assertSameOriginMutation(request);
    await requireWebPermission(request, "hr.request.view");
    await ensureServerDatabaseInitialized();
    const parsed = idSchema.safeParse(await readJsonBody(request));
    if (!parsed.success) {
      return noStoreJson(
        { sukses: false, pesan: "Berkas tidak dikenal." },
        400,
      );
    }
    return noStoreJson(
      await getIsiLampiran(getServerDatabase(), parsed.data.id),
    );
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
