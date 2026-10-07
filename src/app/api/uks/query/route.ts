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
import { listVisits } from "@/lib/services/uks";

export const runtime = "nodejs";

const bodySchema = z
  .object({
    dari: z.string().max(10),
    sampai: z.string().max(10),
    cari: z.string().max(100).nullish(),
  })
  .strict();

export async function POST(request: NextRequest) {
  try {
    assertSameOriginMutation(request);
    await requireWebPermission(request, "uks.view");
    await ensureServerDatabaseInitialized();
    const parsed = bodySchema.safeParse(await readJsonBody(request));
    if (!parsed.success) {
      return noStoreJson(
        { sukses: false, pesan: "Permintaan kunjungan UKS tidak valid." },
        400,
      );
    }
    return noStoreJson(
      await listVisits(
        getServerDatabase(),
        parsed.data.dari,
        parsed.data.sampai,
        parsed.data.cari ?? null,
      ),
    );
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
