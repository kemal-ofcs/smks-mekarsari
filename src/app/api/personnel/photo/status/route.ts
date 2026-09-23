import type { NextRequest } from "next/server";
import { assertAnyActorPermission } from "@/lib/auth/permission-assertion";
import { requireWebSession } from "@/lib/server/auth/authorize";
import { ensureServerDatabaseInitialized } from "@/lib/server/db";
import {
  noStoreJson,
  readJsonBody,
  toApiErrorResponse,
} from "@/lib/server/http/api-response";
import { assertSameOriginMutation } from "@/lib/server/http/request-security";
import { listPersonnelPhotoIds } from "@/lib/services/academic";
import { IZIN_STATUS_FOTO } from "@/lib/validations/personnel-photo";

export const runtime = "nodejs";

/**
 * Status "punya foto" untuk tombol "Lihat Foto" di daftar personil. Hanya ID,
 * tidak pernah isi foto. Cerminan `desktop_list_personnel_photo_status`.
 *
 * `POST`, bukan `GET`: build Desktop/Mobile memakai `output: "export"`.
 */
export async function POST(request: NextRequest) {
  try {
    assertSameOriginMutation(request);
    const actor = await requireWebSession(request);
    assertAnyActorPermission(actor, IZIN_STATUS_FOTO);
    await ensureServerDatabaseInitialized();
    const body = await readJsonBody<{ ids?: unknown }>(request);
    const ids = Array.isArray(body?.ids)
      ? body.ids.filter((id): id is string => typeof id === "string")
      : [];
    return noStoreJson({ ids: await listPersonnelPhotoIds(ids) });
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
