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
import { simpanSp } from "@/lib/services/hr-keluar";
import { spDraftSchema } from "@/lib/validations/hr-keluar";

export const runtime = "nodejs";

/**
 * Buat SP atau ubah teksnya; cermin `desktop_hr_warning_save`. SP3, cakupan
 * unit, dan "bukan diri sendiri" diperiksa service dari sesi.
 */
export async function POST(request: NextRequest) {
  try {
    assertSameOriginMutation(request);
    const actor = await requireWebPermission(request, "hr.warning.manage");
    await ensureServerDatabaseInitialized();
    const parsed = spDraftSchema.safeParse(await readJsonBody(request));
    if (!parsed.success) {
      return noStoreJson(
        { sukses: false, pesan: "Data surat peringatan tidak valid." },
        400,
      );
    }
    return noStoreJson(await simpanSp(getServerDatabase(), actor, parsed.data));
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
