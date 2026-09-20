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
import { getPersonnelPhoto } from "@/lib/services/academic";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    assertSameOriginMutation(request);
    await requireWebPermission(request, "employees.view");
    await ensureServerDatabaseInitialized();
    const body = await readJsonBody<{ id_unik?: string }>(request);
    const idUnik = body?.id_unik?.trim();

    if (!idUnik) {
      throw new ApiRequestError("ID personil wajib disertakan.", 400);
    }

    const photo = await getPersonnelPhoto(idUnik);
    return noStoreJson(photo);
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
