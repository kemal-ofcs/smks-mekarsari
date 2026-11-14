import type { NextRequest } from "next/server";
import { requireAnyWebPermission } from "@/lib/server/auth/authorize";
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
import { getSetupSurat } from "@/lib/services/hr-beban";
import { suratSetupSchema } from "@/lib/validations/hr-beban";

export const runtime = "nodejs";

/**
 * Bahan cetak SK dan surat (kop, pengaturan, kepala unit, identitas guru).
 * Juga untuk pembaca SP: penanda tangan bawaan dan cetak SP.
 */
export async function POST(request: NextRequest) {
  try {
    assertSameOriginMutation(request);
    await requireAnyWebPermission(request, [
      "hr.duty.manage",
      "hr.warning.view",
    ]);
    await ensureServerDatabaseInitialized();
    const parsed = suratSetupSchema.safeParse(await readJsonBody(request));
    if (!parsed.success) {
      return noStoreJson(
        { sukses: false, pesan: "Tanggal surat tidak valid." },
        400,
      );
    }
    return noStoreJson(
      await getSetupSurat(getServerDatabase(), parsed.data.tanggal),
    );
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
