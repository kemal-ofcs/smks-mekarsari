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
import { getStudentPhoto } from "@/lib/services/academic";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    assertSameOriginMutation(request);
    await requireWebPermission(request, "students.view");
    await ensureServerDatabaseInitialized();
    const body = await readJsonBody<{ id_siswa?: string }>(request);
    const idSiswa = body?.id_siswa?.trim();

    if (!idSiswa) {
      throw new ApiRequestError("ID Siswa wajib disertakan.", 400);
    }

    const photo = await getStudentPhoto(idSiswa);
    return noStoreJson(photo);
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
