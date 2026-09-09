import type { NextRequest } from "next/server";
import { requireWebPermission } from "@/lib/server/auth/authorize";
import { ensureServerDatabaseInitialized } from "@/lib/server/db";
import {
  noStoreJson,
  readJsonBody,
  toApiErrorResponse,
} from "@/lib/server/http/api-response";
import { assertSameOriginMutation } from "@/lib/server/http/request-security";
import { getStudents } from "@/lib/services/academic";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    assertSameOriginMutation(request);
    await requireWebPermission(request, "students.view");
    await ensureServerDatabaseInitialized();

    const body = await readJsonBody<{ id_rombel?: string }>(request).catch(
      () => ({ id_rombel: undefined }),
    );
    const students = await getStudents(body.id_rombel);
    return noStoreJson({ sukses: true, students });
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
