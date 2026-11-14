import type { NextRequest } from "next/server";
import { requireAnyWebPermission } from "@/lib/server/auth/authorize";
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
import { hapusLampiran, tambahLampiran } from "@/lib/services/hris";
import { idSchema, lampiranSchema } from "@/lib/validations/hris";

export const runtime = "nodejs";

// Satu berkas maks 1 MB (base64 ±1,4 MB) ditambah amplop JSON.
const BATAS_BODY = 1_677_722;

// Pengaju atau pemegang izin pemutus jenisnya; dinilai ulang di service.
const IZIN_LAMPIRAN = [
  "hr.request.submit",
  "hr.request.decide",
  "hr.request.decide_major",
] as const;

/** Tambah lampiran pengajuan; cermin `desktop_hr_request_file_add`. */
export async function POST(request: NextRequest) {
  try {
    assertSameOriginMutation(request);
    const actor = await requireAnyWebPermission(request, [...IZIN_LAMPIRAN]);
    await ensureServerDatabaseInitialized();
    const parsed = lampiranSchema.safeParse(
      await readJsonBody(request, BATAS_BODY),
    );
    if (!parsed.success) {
      return noStoreJson(
        {
          sukses: false,
          pesan: parsed.error.issues[0]?.message ?? "Berkas tidak terbaca.",
        },
        400,
      );
    }
    return noStoreJson(
      await tambahLampiran(getServerDatabase(), actor, parsed.data),
    );
  } catch (error) {
    return toApiErrorResponse(error);
  }
}

/** Hapus satu lampiran; cermin `desktop_hr_request_file_delete`. */
export async function DELETE(request: NextRequest) {
  try {
    assertSameOriginMutation(request);
    const actor = await requireAnyWebPermission(request, [...IZIN_LAMPIRAN]);
    await ensureServerDatabaseInitialized();
    const parsed = idSchema.safeParse(await readJsonBody(request));
    if (!parsed.success) {
      return noStoreJson(
        { sukses: false, pesan: "Berkas tidak dikenal." },
        400,
      );
    }
    return noStoreJson(
      await hapusLampiran(getServerDatabase(), actor, parsed.data.id),
    );
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
