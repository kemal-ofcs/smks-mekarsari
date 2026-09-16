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
import { saveArticle } from "@/lib/services/content-admin";
import type { ArticleDraft } from "@/types/content";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    assertSameOriginMutation(request);
    await requireWebPermission(request, "content.manage", true);
    await ensureServerDatabaseInitialized();

    const body = (await readJsonBody(request, 2 * 1024 * 1024)) as ArticleDraft;
    const result = await saveArticle(getServerDatabase(), body);
    return noStoreJson(result);
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
