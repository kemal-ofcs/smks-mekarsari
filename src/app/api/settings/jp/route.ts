import type { NextRequest } from "next/server";
import { requireWebPermission } from "@/lib/server/auth/authorize";
import {
  ensureServerDatabaseInitialized,
  getServerDatabase,
} from "@/lib/server/db";
import {
  ApiRequestError,
  noStoreJson,
  readJsonBody,
  toApiErrorResponse,
} from "@/lib/server/http/api-response";
import { assertSameOriginMutation } from "@/lib/server/http/request-security";
import { recordOperationalChange } from "@/lib/server/operational/change-log";
import {
  JP_DURATION_SETTING_KEY,
  JP_MAX_PER_DAY_SETTING_KEY,
  MAX_JAM_KE,
  parseJpDuration,
  parseJpMaxPerDay,
} from "@/lib/validations/class-attendance";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    assertSameOriginMutation(request);
    // Cukup sesi: layar presensi perlu tahu berapa jam pelajaran yang tersedia
    // sebelum gurunya menyimpan.
    await requireWebPermission(request, "home.view");
    await ensureServerDatabaseInitialized();
    const client = getServerDatabase();

    const result = await client.execute({
      sql: "SELECT key, value FROM setting_gex_system WHERE key IN (?, ?);",
      args: [JP_MAX_PER_DAY_SETTING_KEY, JP_DURATION_SETTING_KEY],
    });
    const nilai = new Map(
      result.rows.map((row) => [String(row.key), String(row.value ?? "")]),
    );

    return noStoreJson({
      maxPerHari: parseJpMaxPerDay(nilai.get(JP_MAX_PER_DAY_SETTING_KEY)),
      durasiMenit: parseJpDuration(nilai.get(JP_DURATION_SETTING_KEY)),
      batasStruktural: MAX_JAM_KE,
    });
  } catch (error) {
    return toApiErrorResponse(error);
  }
}

export async function PUT(request: NextRequest) {
  try {
    const actor = await requireWebPermission(request, "settings.manage");
    assertSameOriginMutation(request);
    await ensureServerDatabaseInitialized();
    const client = getServerDatabase();

    const body = await readJsonBody<{
      maxPerHari?: unknown;
      durasiMenit?: unknown;
    }>(request);
    const maxPerHari = Number(body.maxPerHari);
    const durasiMenit = Number(body.durasiMenit);

    if (
      !Number.isInteger(maxPerHari) ||
      maxPerHari < 1 ||
      maxPerHari > MAX_JAM_KE
    ) {
      throw new ApiRequestError(
        `Jumlah jam pelajaran per hari harus di antara 1 dan ${MAX_JAM_KE}.`,
        400,
      );
    }
    if (
      !Number.isInteger(durasiMenit) ||
      durasiMenit < 1 ||
      durasiMenit > 240
    ) {
      throw new ApiRequestError(
        "Lama satu jam pelajaran harus di antara 1 dan 240 menit.",
        400,
      );
    }

    await client.batch(
      [
        {
          sql: `INSERT INTO setting_gex_system (key, value) VALUES (?, ?)
                ON CONFLICT(key) DO UPDATE SET value = excluded.value;`,
          args: [JP_MAX_PER_DAY_SETTING_KEY, String(maxPerHari)],
        },
        {
          sql: `INSERT INTO setting_gex_system (key, value) VALUES (?, ?)
                ON CONFLICT(key) DO UPDATE SET value = excluded.value;`,
          args: [JP_DURATION_SETTING_KEY, String(durasiMenit)],
        },
      ],
      "write",
    );

    for (const [key, value] of [
      [JP_MAX_PER_DAY_SETTING_KEY, String(maxPerHari)],
      [JP_DURATION_SETTING_KEY, String(durasiMenit)],
    ]) {
      await recordOperationalChange(client, {
        domain: "setting",
        entityKey: key,
        operation: "update",
        payload: { key, value },
        actorOperatorId: actor.id,
      });
    }

    return noStoreJson({ sukses: true, maxPerHari, durasiMenit });
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
