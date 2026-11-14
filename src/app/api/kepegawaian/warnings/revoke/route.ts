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
import { cabutSp } from "@/lib/services/hr-keluar";
import { spCabutSchema } from "@/lib/validations/hr-keluar";

export const runtime = "nodejs";

/** Cabut SP dengan alasan, sekali; cermin `desktop_hr_warning_revoke`. */
export async function POST(request: NextRequest) {
  try {
    assertSameOriginMutation(request);
    const actor = await requireWebPermission(request, "hr.warning.cancel");
    await ensureServerDatabaseInitialized();
    const parsed = spCabutSchema.safeParse(await readJsonBody(request));
    if (!parsed.success) {
      return noStoreJson(
        { sukses: false, pesan: "Data pencabutan SP tidak valid." },
        400,
      );
    }
    return noStoreJson(
      await cabutSp(
        getServerDatabase(),
        actor,
        parsed.data.id_sp,
        parsed.data.alasan,
      ),
    );
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
