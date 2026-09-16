import type { NextRequest } from "next/server";
import { requireWebPermission } from "@/lib/server/auth/authorize";
import { ensureServerDatabaseInitialized } from "@/lib/server/db";
import {
  noStoreJson,
  toApiErrorResponse,
} from "@/lib/server/http/api-response";
import { assertSameOriginMutation } from "@/lib/server/http/request-security";
import { getAcademicUnits } from "@/lib/services/academic";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    assertSameOriginMutation(request);
    // Dropdown unit dipakai formulir peserta didik, guru/PTK, dan karyawan —
    // bukan hanya halaman Akademik. `academic.view` aman untuk ketiganya: ia
    // sudah ikut paket bawaan Admin dan Operator, dan role Scanner tidak pernah
    // membuka satu pun halaman itu. Yang di-RBAC ketat adalah mengubahnya
    // (`academic.manage`), bukan membacanya.
    await requireWebPermission(request, "academic.view");
    await ensureServerDatabaseInitialized();
    const units = await getAcademicUnits();
    return noStoreJson({ sukses: true, units });
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
