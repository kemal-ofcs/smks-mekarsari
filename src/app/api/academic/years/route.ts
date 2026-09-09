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
  deleteAcademicYear,
  saveAcademicYear,
  setActiveAcademicYear,
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
        id_tahun_ajaran?: string;
        nama_tahun: string;
        semester: "Ganjil" | "Genap";
        tanggal_mulai: string;
        tanggal_selesai: string;
        is_aktif?: number;
      };
      id?: string;
    }>(request);

    if (body.action === "delete") {
      if (!body.id) {
        throw new ApiRequestError("ID tahun ajaran wajib disertakan.", 400);
      }
      return noStoreJson(await deleteAcademicYear(body.id));
    }

    if (body.action === "set-active") {
      if (!body.id) {
        throw new ApiRequestError("ID tahun ajaran wajib disertakan.", 400);
      }
      return noStoreJson(await setActiveAcademicYear(body.id));
    }

    if (!body.draft || !body.draft.nama_tahun) {
      throw new ApiRequestError("Draft tahun ajaran tidak valid.", 400);
    }

    return noStoreJson(await saveAcademicYear(body.draft));
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
