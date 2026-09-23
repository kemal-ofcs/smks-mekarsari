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
import { savePersonnelPhoto } from "@/lib/services/academic";
import {
  izinKelolaFoto,
  jenisFotoPersonil,
} from "@/lib/validations/personnel-photo";

export const runtime = "nodejs";

/**
 * Izinnya mengikuti jenis personil pemilik foto (`jenisFotoPersonil`): admin
 * siswa hanya boleh mengganti foto siswa, dan seterusnya. Cerminan
 * `desktop_save_personnel_photo` di `commands.rs`.
 */
export async function POST(request: NextRequest) {
  try {
    assertSameOriginMutation(request);
    const actor = await requireWebSession(request);
    await ensureServerDatabaseInitialized();
    const body = await readJsonBody<{
      id_unik?: string;
      foto_base64?: string;
      foto_mime?: string;
    }>(request);

    if (!body?.id_unik || !body?.foto_base64) {
      throw new ApiRequestError("ID personil dan foto wajib diisi.", 400);
    }
    assertActorPermission(
      actor,
      izinKelolaFoto(
        await jenisFotoPersonil(getServerDatabase(), body.id_unik),
      ),
    );

    const result = await savePersonnelPhoto({
      id_unik: body.id_unik,
      foto_base64: body.foto_base64,
      foto_mime: body.foto_mime,
    });
    return noStoreJson(result);
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
