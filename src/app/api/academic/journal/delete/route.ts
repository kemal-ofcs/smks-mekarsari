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
import { deleteTeachingJournal } from "@/lib/services/teaching-journal";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    assertSameOriginMutation(request);
    await requireWebPermission(request, "teaching_journal.delete");
    await ensureServerDatabaseInitialized();
    const body = await readJsonBody<{ id_jurnal?: string }>(request);
    const idJurnal = body?.id_jurnal?.trim();

    if (!idJurnal) {
      throw new ApiRequestError("ID Jurnal wajib disertakan.", 400);
    }

    const result = await deleteTeachingJournal(idJurnal);
    return noStoreJson(result);
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
