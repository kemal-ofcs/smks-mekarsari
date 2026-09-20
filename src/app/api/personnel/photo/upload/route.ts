import type { NextRequest } from "next/server";
import { requireWebPermission } from "@/lib/server/auth/authorize";
import { ensureServerDatabaseInitialized } from "@/lib/server/db";
import {
  ApiRequestError,
  noStoreJson,
  readJsonBody,
  toApiErrorResponse,
} from "@/lib/server/http/api-response";
import { assertSameOriginMutation } from "@/lib/server/http/request-security";
import { savePersonnelPhoto } from "@/lib/services/academic";

export const runtime = "nodejs";

/**
 * Izinnya `employees.manage`, bukan `students.manage`: endpoint ini menulis
 * foto untuk SELURUH jenis personil tanpa membedakannya, jadi izin domain siswa
 * di sini akan menjadi celah eskalasi hak akses. Cerminan
 * `desktop_save_personnel_photo` di `commands.rs`.
 */
export async function POST(request: NextRequest) {
  try {
    assertSameOriginMutation(request);
    await requireWebPermission(request, "employees.manage");
    await ensureServerDatabaseInitialized();
    const body = await readJsonBody<{
      id_unik?: string;
      foto_base64?: string;
      foto_mime?: string;
    }>(request);

    if (!body?.id_unik || !body?.foto_base64) {
      throw new ApiRequestError("ID personil dan foto wajib diisi.", 400);
    }

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
