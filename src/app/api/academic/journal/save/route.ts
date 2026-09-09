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
import { saveTeachingJournal } from "@/lib/services/teaching-journal";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    assertSameOriginMutation(request);
    const actor = await requireWebPermission(
      request,
      "teaching_journal.manage",
    );
    await ensureServerDatabaseInitialized();
    const body = await readJsonBody<{
      draft?: {
        id_jurnal?: string;
        id_presensi_mapel: string;
        materi_disampaikan?: string | null;
        kendala?: string | null;
        tindak_lanjut?: string | null;
        paraf_nama?: string | null;
      };
      id_jurnal?: string;
      id_presensi_mapel?: string;
      materi_disampaikan?: string | null;
      kendala?: string | null;
      tindak_lanjut?: string | null;
      paraf_nama?: string | null;
    }>(request);

    const draft = body?.draft || body;
    if (!draft || !draft.id_presensi_mapel) {
      throw new ApiRequestError("Tautan sesi presensi mapel wajib diisi.", 400);
    }

    const result = await saveTeachingJournal(actor.username, {
      id_jurnal: draft.id_jurnal,
      id_presensi_mapel: draft.id_presensi_mapel,
      materi_disampaikan: draft.materi_disampaikan,
      kendala: draft.kendala,
      tindak_lanjut: draft.tindak_lanjut,
      paraf_nama: draft.paraf_nama,
    });
    return noStoreJson(result);
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
