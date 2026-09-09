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
  deleteAcademicClass,
  saveAcademicClass,
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
        id_rombel?: string;
        id_tahun_ajaran: string;
        tingkat: number;
        id_jurusan?: string | null;
        nama_rombel: string;
        id_wali_kelas?: string | null;
        kapasitas?: number;
        ruang_kelas?: string | null;
        is_aktif?: number;
      };
      id?: string;
    }>(request);

    if (body.action === "delete") {
      if (!body.id) {
        throw new ApiRequestError("ID rombel wajib disertakan.", 400);
      }
      return noStoreJson(await deleteAcademicClass(body.id));
    }

    if (!body.draft || !body.draft.id_tahun_ajaran || !body.draft.nama_rombel) {
      throw new ApiRequestError("Draft rombel tidak valid.", 400);
    }

    return noStoreJson(await saveAcademicClass(body.draft));
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
