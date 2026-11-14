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
import { getBebanMengajar } from "@/lib/services/hr-beban";
import { bebanQuerySchema } from "@/lib/validations/hr-beban";

export const runtime = "nodejs";

/** Data mentah rekap beban mengajar; disusun di layar (`susunBebanMengajar`). */
export async function POST(request: NextRequest) {
  try {
    assertSameOriginMutation(request);
    await requireWebPermission(request, "teachers.view");
    await ensureServerDatabaseInitialized();
    const parsed = bebanQuerySchema.safeParse(await readJsonBody(request));
    if (!parsed.success) {
      return noStoreJson(
        { sukses: false, pesan: "Pilihan semester tidak valid." },
        400,
      );
    }
    return noStoreJson(
      await getBebanMengajar(getServerDatabase(), parsed.data.id_tahun_ajaran),
    );
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
