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
import { getPmbFile } from "@/lib/services/pmb-admin";

export const runtime = "nodejs";

/**
 * Satu berkas, diambil saat panitia benar-benar membukanya.
 *
 * Sengaja endpoint tersendiri, bukan ikut di dalam detail pendaftar: satu
 * berkas sampai 500 KB, dan membawanya di setiap pemuatan detail membuat
 * halaman verifikasi berat tanpa ada yang melihat berkasnya.
 */
export async function POST(request: NextRequest) {
  try {
    assertSameOriginMutation(request);
    await requireWebPermission(request, "pmb.view");
    await ensureServerDatabaseInitialized();

    const { idBerkas } = await readJsonBody<{ idBerkas: string }>(request);
    const berkas = await getPmbFile(getServerDatabase(), idBerkas);
    return noStoreJson({ sukses: true, berkas });
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
