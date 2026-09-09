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
import { deleteStudent, saveStudent } from "@/lib/services/academic";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    assertSameOriginMutation(request);
    await requireWebPermission(request, "students.manage");
    await ensureServerDatabaseInitialized();

    const body = await readJsonBody<{
      action?: string;
      draft?: {
        id_siswa?: string;
        nama_lengkap: string;
        nis?: string | null;
        nisn?: string | null;
        jenis_kelamin?: "L" | "P";
        id_rombel: string;
        nama_wali?: string | null;
        no_whatsapp_wali?: string | null;
        alamat?: string | null;
        angkatan?: number;
        status?: string;
      };
      id?: string;
    }>(request);

    if (body.action === "delete") {
      if (!body.id) {
        throw new ApiRequestError("ID siswa wajib disertakan.", 400);
      }
      return noStoreJson(await deleteStudent(body.id));
    }

    if (!body.draft || !body.draft.nama_lengkap || !body.draft.id_rombel) {
      throw new ApiRequestError("Draft profil siswa tidak lengkap.", 400);
    }

    return noStoreJson(await saveStudent(body.draft));
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
