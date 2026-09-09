import type { NextRequest } from "next/server";
import { requireWebPermission } from "@/lib/server/auth/authorize";
import { ensureServerDatabaseInitialized } from "@/lib/server/db";
import {
  noStoreJson,
  readJsonBody,
  toApiErrorResponse,
} from "@/lib/server/http/api-response";
import { assertSameOriginMutation } from "@/lib/server/http/request-security";
import {
  getTeachingJournal,
  listTeachingJournals,
} from "@/lib/services/teaching-journal";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    assertSameOriginMutation(request);
    await requireWebPermission(request, "teaching_journal.view");
    await ensureServerDatabaseInitialized();
    const body = await readJsonBody<{
      id_presensi_mapel?: string;
      id_rombel?: string;
      id_mapel?: string;
      id_guru?: string;
      tanggal_mulai?: string;
      tanggal_selesai?: string;
      limit?: number;
    }>(request);

    if (body?.id_presensi_mapel) {
      const journal = await getTeachingJournal(body.id_presensi_mapel);
      return noStoreJson(journal);
    }

    const journals = await listTeachingJournals({
      idRombel: body?.id_rombel,
      idMapel: body?.id_mapel,
      idGuru: body?.id_guru,
      tanggalMulai: body?.tanggal_mulai,
      tanggalSelesai: body?.tanggal_selesai,
      limit: Number(body?.limit) || undefined,
    });
    return noStoreJson(journals);
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
