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
import { deleteVisit } from "@/lib/services/uks";

export const runtime = "nodejs";

const bodySchema = z
  .object({ idKunjungan: z.string().min(1).max(160) })
  .strict();

export async function POST(request: NextRequest) {
  try {
    assertSameOriginMutation(request);
    await requireWebPermission(request, "uks.delete");
    await ensureServerDatabaseInitialized();
    const parsed = bodySchema.safeParse(await readJsonBody(request));
    if (!parsed.success) {
      return noStoreJson(
        { sukses: false, pesan: "Permintaan kunjungan UKS tidak valid." },
        400,
      );
    }
    return noStoreJson(
      await deleteVisit(getServerDatabase(), parsed.data.idKunjungan),
    );
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
