import type { NextRequest } from "next/server";
import { requireWebPermission } from "@/lib/server/auth/authorize";
import { ensureServerDatabaseInitialized } from "@/lib/server/db";
import {
  noStoreJson,
  readJsonBody,
  toApiErrorResponse,
} from "@/lib/server/http/api-response";
import { assertSameOriginMutation } from "@/lib/server/http/request-security";
import { getAcademicClasses } from "@/lib/services/academic";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    assertSameOriginMutation(request);
    await requireWebPermission(request, "academic.view");
    await ensureServerDatabaseInitialized();

    const body = await readJsonBody<{ id_tahun_ajaran?: string }>(
      request,
    ).catch(() => ({ id_tahun_ajaran: undefined }));
    const classes = await getAcademicClasses(body.id_tahun_ajaran);
    return noStoreJson({ sukses: true, classes });
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
