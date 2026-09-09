import type { NextRequest } from "next/server";
import { requireWebPermission } from "@/lib/server/auth/authorize";
import { ensureServerDatabaseInitialized } from "@/lib/server/db";
import {
  noStoreJson,
  toApiErrorResponse,
} from "@/lib/server/http/api-response";
import { assertSameOriginMutation } from "@/lib/server/http/request-security";
import { backfillMissingIdCards } from "@/lib/services/academic";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    assertSameOriginMutation(request);
    // Cakupannya seluruh `master_data` aktif — siswa, guru, dan karyawan — dan
    // ini pula izin yang menjaga area `/id-cards` tempat tombolnya berada.
    // Lihat `desktop_backfill_id_cards` untuk alasan lengkapnya.
    await requireWebPermission(request, "employees.manage");
    await ensureServerDatabaseInitialized();
    const result = await backfillMissingIdCards();
    return noStoreJson(result);
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
