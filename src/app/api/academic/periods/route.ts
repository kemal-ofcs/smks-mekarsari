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
  deleteLessonPeriod,
  getLessonPeriods,
  saveLessonPeriod,
} from "@/lib/services/academic";
import type { JenisJamPelajaran } from "@/lib/validations/class-attendance";

export const runtime = "nodejs";

/**
 * Jadwal bel sekolah.
 *
 * Membaca hanya menuntut sesi — layar presensi perlu tahu pukul berapa jam
 * pelajaran berlangsung. Mengubahnya menuntut `settings.manage`, sama dengan
 * pengaturan jam pelajaran yang membatasinya.
 */
export async function POST(request: NextRequest) {
  try {
    assertSameOriginMutation(request);
    await ensureServerDatabaseInitialized();

    const body = await readJsonBody<{
      action?: string;
      draft?: {
        id_jam_pelajaran?: string;
        jam_ke: number;
        jam_mulai: string;
        jam_selesai: string;
        jenis?: JenisJamPelajaran;
        keterangan?: string | null;
        is_aktif?: number;
      };
      id?: string;
    }>(request);

    if (body.action === "delete") {
      await requireWebPermission(request, "settings.manage");
      if (!body.id) {
        throw new ApiRequestError("ID jam pelajaran wajib disertakan.", 400);
      }
      return noStoreJson(await deleteLessonPeriod(body.id));
    }

    if (body.action === "save") {
      await requireWebPermission(request, "settings.manage");
      if (!body.draft) {
        throw new ApiRequestError("Draft jam pelajaran tidak valid.", 400);
      }
      return noStoreJson(await saveLessonPeriod(body.draft));
    }

    await requireWebPermission(request, "home.view");
    return noStoreJson({ data: await getLessonPeriods() });
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
