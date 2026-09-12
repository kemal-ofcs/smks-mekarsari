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
  deleteTeachingSchedule,
  getTeachingSchedules,
  saveTeachingSchedule,
} from "@/lib/services/academic";

export const runtime = "nodejs";

/**
 * Jadwal mengajar mingguan.
 *
 * Membaca menuntut `academic.view` — layar presensi memakainya untuk tombol
 * isi-cepat. Menyusunnya menuntut `academic.manage`.
 */
export async function POST(request: NextRequest) {
  try {
    assertSameOriginMutation(request);
    await ensureServerDatabaseInitialized();

    const body = await readJsonBody<{
      action?: string;
      filter?: {
        id_rombel?: string | null;
        id_tahun_ajaran?: string | null;
        id_guru?: string | null;
        tanggal?: string | null;
        hari?: number | null;
      };
      draft?: {
        id_jadwal?: string;
        id_tahun_ajaran: string;
        id_rombel: string;
        id_mapel: string;
        id_guru: string;
        hari: number;
        jam_ke: string;
        is_aktif?: number;
      };
      id?: string;
    }>(request);

    if (body.action === "delete") {
      await requireWebPermission(request, "academic.manage");
      if (!body.id) {
        throw new ApiRequestError("ID jadwal wajib disertakan.", 400);
      }
      return noStoreJson(await deleteTeachingSchedule(body.id));
    }

    if (body.action === "save") {
      await requireWebPermission(request, "academic.manage");
      if (!body.draft) {
        throw new ApiRequestError("Draft jadwal tidak valid.", 400);
      }
      return noStoreJson(await saveTeachingSchedule(body.draft));
    }

    await requireWebPermission(request, "academic.view");
    return noStoreJson({ data: await getTeachingSchedules(body.filter) });
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
