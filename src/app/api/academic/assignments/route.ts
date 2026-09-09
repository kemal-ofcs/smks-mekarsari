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
  deleteAcademicAssignment,
  saveAcademicAssignment,
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
        id_penugasan?: string;
        id_tahun_ajaran: string;
        id_rombel: string;
        id_mapel: string;
        id_guru: string;
      };
      id?: string;
    }>(request);

    if (body.action === "delete") {
      if (!body.id) {
        throw new ApiRequestError("ID penugasan wajib disertakan.", 400);
      }
      return noStoreJson(await deleteAcademicAssignment(body.id));
    }

    if (
      !body.draft ||
      !body.draft.id_tahun_ajaran ||
      !body.draft.id_rombel ||
      !body.draft.id_mapel ||
      !body.draft.id_guru
    ) {
      throw new ApiRequestError("Draft penugasan guru tidak lengkap.", 400);
    }

    return noStoreJson(await saveAcademicAssignment(body.draft));
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
