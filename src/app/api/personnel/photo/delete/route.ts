import type { NextRequest } from "next/server";
import { assertActorPermission } from "@/lib/auth/permission-assertion";
import { requireWebSession } from "@/lib/server/auth/authorize";
import {
  ensureServerDatabaseInitialized,
  getServerDatabase,
} from "@/lib/server/db";
import {
  ApiRequestError,
  noStoreJson,
  readJsonBody,
  toApiErrorResponse,
} from "@/lib/server/http/api-response";
import { assertSameOriginMutation } from "@/lib/server/http/request-security";
import { deletePersonnelPhoto } from "@/lib/services/academic";
import {
  izinKelolaFoto,
  jenisFotoPersonil,
} from "@/lib/validations/personnel-photo";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    assertSameOriginMutation(request);
    const actor = await requireWebSession(request);
    await ensureServerDatabaseInitialized();
    const body = await readJsonBody<{ id_unik?: string }>(request);
    const idUnik = body?.id_unik?.trim();

    if (!idUnik) {
      throw new ApiRequestError("ID personil wajib disertakan.", 400);
    }
    // Izin mengikuti jenis personil pemilik foto; cerminan
    // `desktop_delete_personnel_photo` di `commands.rs`.
    assertActorPermission(
      actor,
      izinKelolaFoto(await jenisFotoPersonil(getServerDatabase(), idUnik)),
    );

    const result = await deletePersonnelPhoto(idUnik);
    return noStoreJson(result);
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
