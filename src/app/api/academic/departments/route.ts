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
import {
  deleteAcademicDepartment,
  saveAcademicDepartment,
} from "@/lib/services/academic";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    assertSameOriginMutation(request);
    await requireWebPermission(request, "academic.manage");
    await ensureServerDatabaseInitialized();

    const body = await readJsonBody<{
      action?: string;
      draft?: {
        id_jurusan?: string;
        kode_jurusan: string;
        nama_jurusan: string;
        deskripsi?: string | null;
        is_aktif?: number;
      };
      id?: string;
    }>(request);

    if (body.action === "delete") {
      if (!body.id) {
        throw new ApiRequestError("ID jurusan wajib disertakan.", 400);
      }
      return noStoreJson(await deleteAcademicDepartment(body.id));
    }

    if (!body.draft || !body.draft.kode_jurusan || !body.draft.nama_jurusan) {
      throw new ApiRequestError("Draft jurusan tidak valid.", 400);
    }

    return noStoreJson(await saveAcademicDepartment(body.draft));
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
