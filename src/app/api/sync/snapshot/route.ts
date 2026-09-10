import type { NextRequest } from "next/server";
import { requireWebPermission } from "@/lib/server/auth/authorize";
import { withTransientDatabaseRetry } from "@/lib/server/database-retry";
import {
  ensureServerDatabaseInitialized,
  getServerDatabase,
} from "@/lib/server/db";
import {
  noStoreJson,
  toApiErrorResponse,
} from "@/lib/server/http/api-response";
import { assertSameOriginMutation } from "@/lib/server/http/request-security";
import { readOperationalSnapshot } from "@/lib/server/operational/snapshot";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    assertSameOriginMutation(request);
    // Klien versi lama memanggil endpoint ini TANPA body sama sekali, jadi
    // body yang tidak bisa diurai berarti "belum pernah menerapkan tombstone",
    // bukan permintaan yang cacat. Menolaknya akan mematikan sinkronisasi
    // setiap perangkat yang belum diperbarui.
    const tombstoneSince = await request
      .json()
      .then((body: unknown) => {
        const nilai = (body as { tombstoneSince?: unknown } | null)
          ?.tombstoneSince;
        return Number.isFinite(Number(nilai)) && Number(nilai) >= 0
          ? Number(nilai)
          : 0;
      })
      .catch(() => 0);
    const snapshot = await withTransientDatabaseRetry(async () => {
      await requireWebPermission(request, "sync.view");
      await ensureServerDatabaseInitialized();
      return readOperationalSnapshot(getServerDatabase(), tombstoneSince);
    });
    return noStoreJson({
      sukses: true,
      snapshot,
    });
  } catch (error) {
    console.error("SYNC SNAPSHOT API ERROR:", error);
    return toApiErrorResponse(error);
  }
}
