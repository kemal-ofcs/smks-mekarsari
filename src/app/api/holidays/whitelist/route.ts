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
import {
  type HolidayWhitelistInput,
  hapusHolidayWhitelist,
  tambahHolidayWhitelist,
  updateHolidayWhitelist,
} from "@/lib/services/holiday-whitelist";

export const runtime = "nodejs";

interface WhitelistMutationBody {
  whitelistId?: unknown;
  draft?: unknown;
}

function parseDraft(value: unknown): HolidayWhitelistInput {
  const draft = (value ?? {}) as Record<string, unknown>;
  return {
    scope_type:
      typeof draft.scope_type === "string" ? draft.scope_type.trim() : "",
    scope_value:
      typeof draft.scope_value === "string" ? draft.scope_value.trim() : "",
    tanggal_libur:
      typeof draft.tanggal_libur === "string" && draft.tanggal_libur.trim()
        ? draft.tanggal_libur.trim()
        : null,
    keterangan:
      typeof draft.keterangan === "string" ? draft.keterangan.trim() : null,
    status_aktif:
      draft.status_aktif === false || Number(draft.status_aktif) === 0 ? 0 : 1,
  };
}

function parseId(value: unknown): string {
  const id = typeof value === "string" ? value.trim() : "";
  if (!id) throw new ApiRequestError("ID whitelist wajib diisi.", 400);
  return id;
}

/** Baris terkini, dipakai membangun payload sync yang utuh. */
export async function POST(request: NextRequest) {
  try {
    await requireWebPermission(request, "holidays.manage");
    assertSameOriginMutation(request);
    await ensureServerDatabaseInitialized();

    const body = await readJsonBody<WhitelistMutationBody>(request);
    const result = await tambahHolidayWhitelist(parseDraft(body.draft));

    return noStoreJson(result, 201);
  } catch (error) {
    return toApiErrorResponse(error);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    await requireWebPermission(request, "holidays.manage");
    assertSameOriginMutation(request);
    await ensureServerDatabaseInitialized();

    const body = await readJsonBody<WhitelistMutationBody>(request);
    const id = parseId(body.whitelistId);
    const result = await updateHolidayWhitelist(id, parseDraft(body.draft));

    return noStoreJson(result);
  } catch (error) {
    return toApiErrorResponse(error);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    await requireWebPermission(request, "holidays.manage");
    assertSameOriginMutation(request);
    await ensureServerDatabaseInitialized();

    const body = await readJsonBody<WhitelistMutationBody>(request);
    const id = parseId(body.whitelistId);
    const result = await hapusHolidayWhitelist(id);

    return noStoreJson(result);
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
