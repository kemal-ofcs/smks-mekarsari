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
import { simpanPenanganan } from "@/lib/services/hr-pengajuan";
import { penangananDraftSchema } from "@/lib/validations/hr-pengajuan";

export const runtime = "nodejs";

/** Tunjuk pengganti, Tugas Mandiri, atau Digabung; cermin `desktop_hr_substitute_save`. */
export async function POST(request: NextRequest) {
  try {
    assertSameOriginMutation(request);
    const actor = await requireWebPermission(request, "hr.substitute.manage");
    await ensureServerDatabaseInitialized();
    const parsed = penangananDraftSchema.safeParse(await readJsonBody(request));
    if (!parsed.success) {
      return noStoreJson(
        { sukses: false, pesan: "Data penanganan jam pelajaran tidak valid." },
        400,
      );
    }
    return noStoreJson(
      await simpanPenanganan(getServerDatabase(), actor, parsed.data),
    );
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
