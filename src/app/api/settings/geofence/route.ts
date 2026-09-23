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
  getGeofenceSettings,
  updateGeofenceSettings,
} from "@/lib/services/geofence";
import {
  type GeofenceSettings,
  validateGeofenceSettings,
} from "@/lib/validations/geofence";

export const runtime = "nodejs";

async function prepare(request: NextRequest) {
  assertSameOriginMutation(request);
  const actor = await requireWebPermission(request, "branding.manage", true);
  await ensureServerDatabaseInitialized();
  return actor;
}

function parseSettings(value: unknown): GeofenceSettings {
  const input = (value ?? {}) as Record<string, unknown>;
  const settings: GeofenceSettings = {
    enabled: input.enabled === true,
    latitude: Number(input.latitude),
    longitude: Number(input.longitude),
    radiusMeter: Number(input.radiusMeter),
  };
  const message = Object.values(validateGeofenceSettings(settings))[0];
  if (message) throw new ApiRequestError(message, 400);
  return settings;
}

export async function POST(request: NextRequest) {
  try {
    await prepare(request);
    return noStoreJson({ data: await getGeofenceSettings() });
  } catch (error) {
    return toApiErrorResponse(error);
  }
}

export async function PUT(request: NextRequest) {
  try {
    await prepare(request);
    const settings = parseSettings(await readJsonBody(request));
    const data = await updateGeofenceSettings(settings);
    return noStoreJson({ data });
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
