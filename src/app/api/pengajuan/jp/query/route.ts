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
import { jpTerdampakBaca } from "@/lib/services/hr-pengajuan";
import { jpQuerySchema } from "@/lib/validations/hr-pengajuan";

export const runtime = "nodejs";

/** JP terdampak per pengajuan, per tanggal, atau isian form; cermin `desktop_hr_affected_jp`. */
export async function POST(request: NextRequest) {
  try {
    assertSameOriginMutation(request);
    const actor = await requireAnyWebPermission(request, [
      "hr.request.view",
      "hr.substitute.manage",
    ]);
    await ensureServerDatabaseInitialized();
    const parsed = jpQuerySchema.safeParse(await readJsonBody(request));
    if (!parsed.success) {
      return noStoreJson(
        { sukses: false, pesan: "Permintaan jam pelajaran tidak valid." },
        400,
      );
    }
    return noStoreJson(
      await jpTerdampakBaca(
        getServerDatabase(),
        actor,
        parsed.data.id_pengajuan ?? null,
        parsed.data.tanggal ?? null,
        parsed.data.draft ?? null,
      ),
    );
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
