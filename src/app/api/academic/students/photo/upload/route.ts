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
import { saveStudentPhoto } from "@/lib/services/academic";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    assertSameOriginMutation(request);
    await requireWebPermission(request, "students.manage");
    await ensureServerDatabaseInitialized();
    const body = await readJsonBody<{
      id_siswa?: string;
      foto_base64?: string;
      foto_mime?: string;
    }>(request);

    if (!body?.id_siswa || !body?.foto_base64) {
      throw new ApiRequestError("ID Siswa dan foto wajib diisi.", 400);
    }

    const result = await saveStudentPhoto({
      id_siswa: body.id_siswa,
      foto_base64: body.foto_base64,
      foto_mime: body.foto_mime,
    });
    return noStoreJson(result);
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
