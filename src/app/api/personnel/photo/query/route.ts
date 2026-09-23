import type { NextRequest } from "next/server";
import { assertAnyActorPermission } from "@/lib/auth/permission-assertion";
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
import { getPersonnelPhoto } from "@/lib/services/academic";
import {
  izinLihatFoto,
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
    // Admin guru/siswa dulu ditolak di sini karena izinnya hanya karyawan.
    assertAnyActorPermission(
      actor,
      izinLihatFoto(await jenisFotoPersonil(getServerDatabase(), idUnik)),
    );

    const photo = await getPersonnelPhoto(idUnik);
    return noStoreJson(photo);
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
