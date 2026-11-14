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
import { daftarSp } from "@/lib/services/hr-keluar";
import { spQuerySchema } from "@/lib/validations/hr-keluar";

export const runtime = "nodejs";

/** Riwayat SP seorang pegawai; cermin `desktop_hr_warnings`. */
export async function POST(request: NextRequest) {
  try {
    assertSameOriginMutation(request);
    await requireWebPermission(request, "hr.warning.view");
    await ensureServerDatabaseInitialized();
    const parsed = spQuerySchema.safeParse(await readJsonBody(request));
    if (!parsed.success) {
      return noStoreJson(
        { sukses: false, pesan: "Pegawai wajib dipilih." },
        400,
      );
    }
    return noStoreJson(
      await daftarSp(getServerDatabase(), parsed.data.id_karyawan),
    );
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
