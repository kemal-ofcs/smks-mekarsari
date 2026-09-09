import type { NextRequest } from "next/server";
import { requireWebPermission } from "@/lib/server/auth/authorize";
import { ensureServerDatabaseInitialized } from "@/lib/server/db";
import {
  noStoreJson,
  readJsonBody,
  toApiErrorResponse,
} from "@/lib/server/http/api-response";
import { assertSameOriginMutation } from "@/lib/server/http/request-security";
import { getAcademicAssignments } from "@/lib/services/academic";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    assertSameOriginMutation(request);
    await requireWebPermission(request, "academic.view");
    await ensureServerDatabaseInitialized();

    const body = await readJsonBody<{ id_rombel?: string }>(request).catch(
      () => ({ id_rombel: undefined }),
    );
    const assignments = await getAcademicAssignments(body.id_rombel);
    return noStoreJson({ sukses: true, assignments });
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
