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
  deleteAcademicSubject,
  saveAcademicSubject,
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
        id_mapel?: string;
        kode_mapel: string;
        nama_mapel: string;
        tingkat?: number | null;
        kelompok?: "Wajib" | "Peminatan" | "Muatan Lokal" | "Kejuruan";
        beban_jam?: number;
        kkm?: number;
        is_aktif?: number;
      };
      id?: string;
    }>(request);

    if (body.action === "delete") {
      if (!body.id) {
        throw new ApiRequestError("ID mapel wajib disertakan.", 400);
      }
      return noStoreJson(await deleteAcademicSubject(body.id));
    }

    if (!body.draft || !body.draft.kode_mapel || !body.draft.nama_mapel) {
      throw new ApiRequestError("Draft mapel tidak valid.", 400);
    }

    return noStoreJson(await saveAcademicSubject(body.draft));
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
