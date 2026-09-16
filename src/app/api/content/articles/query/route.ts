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
import { listArticles } from "@/lib/services/content-admin";
import type { ArticleFilter } from "@/types/content";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    assertSameOriginMutation(request);
    await requireWebPermission(request, "content.view", false);
    await ensureServerDatabaseInitialized();

    const body = (await readJsonBody(request, 1024 * 1024).catch(
      () => ({}),
    )) as ArticleFilter;
    const data = await listArticles(getServerDatabase(), body);
    return noStoreJson(data);
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
