import type { NextRequest } from "next/server";
import { z } from "zod";
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
import { drainWaQueue } from "@/lib/services/wa-sender";

export const runtime = "nodejs";

const bodySchema = z.object({ otomatis: z.boolean().optional() }).strict();

export async function POST(request: NextRequest) {
  try {
    assertSameOriginMutation(request);
    await requireWebPermission(request, "notification.send");
    await ensureServerDatabaseInitialized();

    const parsed = bodySchema.safeParse(await readJsonBody(request));
    if (!parsed.success) {
      return noStoreJson(
        { sukses: false, pesan: "Permintaan kuras antrean tidak valid." },
        400,
      );
    }
    const client = getServerDatabase();
    const result = await drainWaQueue(client, 25, {
      otomatis: parsed.data.otomatis === true,
    });
    return noStoreJson(result);
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
