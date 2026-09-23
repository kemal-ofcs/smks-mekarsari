import type { NextRequest } from "next/server";
import { requireWebPermission } from "@/lib/server/auth/authorize";
import { ensureServerDatabaseInitialized } from "@/lib/server/db";
import {
  noStoreJson,
  readJsonBody,
  toApiErrorResponse,
} from "@/lib/server/http/api-response";
import { assertSameOriginMutation } from "@/lib/server/http/request-security";
import { updateCompanyProfile } from "@/lib/services/company-profile";
import type { CompanyProfileInput } from "@/types/company-profile";

export const runtime = "nodejs";

async function prepare(request: NextRequest) {
  assertSameOriginMutation(request);
  const actor = await requireWebPermission(request, "settings.manage", true);
  await ensureServerDatabaseInitialized();
  return actor;
}

export async function PUT(request: NextRequest) {
  try {
    await prepare(request);
    const body = (await readJsonBody(
      request,
      25_165_824,
    )) as CompanyProfileInput;
    const data = await updateCompanyProfile(body);
    return noStoreJson({ data });
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
