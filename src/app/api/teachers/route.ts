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
import { deleteTeacher, saveTeacher } from "@/lib/services/academic";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    assertSameOriginMutation(request);
    await requireWebPermission(request, "teachers.manage");
    await ensureServerDatabaseInitialized();

    const body = await readJsonBody<{
      action?: string;
      draft?: {
        id_guru?: string;
        nama: string;
        kode_karyawan?: string;
        nip?: string | null;
        nuptk?: string | null;
        gelar?: string | null;
        spesialisasi_mapel?: string | null;
        status_kepegawaian?: string | null;
        no_hp?: string | null;
        lp?: string | null;
        id_shift?: number;
        status_aktif?: string;
      };
      id?: string;
    }>(request);

    if (body.action === "delete") {
      if (!body.id) {
        throw new ApiRequestError("ID guru wajib disertakan.", 400);
      }
      return noStoreJson(await deleteTeacher(body.id));
    }

    if (!body.draft || !body.draft.nama) {
      throw new ApiRequestError("Draft profil guru tidak lengkap.", 400);
    }

    return noStoreJson(await saveTeacher(body.draft));
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
