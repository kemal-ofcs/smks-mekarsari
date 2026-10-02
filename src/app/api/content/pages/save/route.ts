import type { NextRequest } from "next/server";
import { requireWebPermission } from "@/lib/server/auth/authorize";
import {
  ensureServerDatabaseInitialized,
  getServerDatabase,
} from "@/lib/server/db";
import {
  noStoreJson,
  readJsonBody,
  toApiErrorResponse,
} from "@/lib/server/http/api-response";
import { assertSameOriginMutation } from "@/lib/server/http/request-security";
import { savePageContent } from "@/lib/services/content-admin";
import type { PageContentUpdateInput } from "@/types/content";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    assertSameOriginMutation(request);
    await requireWebPermission(request, "content.manage", true);
    await ensureServerDatabaseInitialized();

    // Batas 3 MB mengakomodasi data URL gambar latar hero terkompresi (~300 KB)
    // beserta field teks dan koleksi JSON lainnya tanpa memicu HTTP 413.
    const body = (await readJsonBody(
      request,
      3 * 1024 * 1024,
    )) as PageContentUpdateInput;
    const result = await savePageContent(
      getServerDatabase(),
      body.halaman,
      body.items,
    );
    return noStoreJson(result);
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
