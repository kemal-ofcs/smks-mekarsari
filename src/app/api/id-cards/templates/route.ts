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
  getIdCardTemplate,
  saveIdCardTemplate,
} from "@/lib/services/id-card-template";
import type { IdCardTemplateConfig } from "@/types/id-card";

export const runtime = "nodejs";

async function prepare(request: NextRequest) {
  assertSameOriginMutation(request);
  const actor = await requireWebPermission(request, "employees.manage", true);
  await ensureServerDatabaseInitialized();
  return actor;
}

export async function POST(request: NextRequest) {
  try {
    assertSameOriginMutation(request);
    await requireWebPermission(request, "employees.manage", false);
    await ensureServerDatabaseInitialized();
    const body = (await readJsonBody(request).catch(() => ({}))) as {
      id?: string;
    };
    const data = await getIdCardTemplate(body.id || "default_template");
    return noStoreJson({ data });
  } catch (error) {
    return toApiErrorResponse(error);
  }
}

export async function PUT(request: NextRequest) {
  try {
    await prepare(request);
    const body = (await readJsonBody(
      request,
      25_165_824,
    )) as IdCardTemplateConfig;
    const data = await saveIdCardTemplate(body);
    return noStoreJson({ data });
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
