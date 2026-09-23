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
  batalkanPenugasanBackup,
  buatPenugasanBackup,
  hapusPenugasanBackup,
  type PenugasanBackupInput,
} from "@/lib/services/backup";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    assertSameOriginMutation(request);
    const actor = await requireWebPermission(request, "backups.manage");
    const body = await readJsonBody<Record<string, unknown>>(request);
    const draft: PenugasanBackupInput = {
      tanggal_tugas:
        typeof body.tanggal_tugas === "string" ? body.tanggal_tugas.trim() : "",
      id_karyawan_asal:
        typeof body.id_karyawan_asal === "string"
          ? body.id_karyawan_asal.trim()
          : "",
      id_karyawan_pengganti:
        typeof body.id_karyawan_pengganti === "string"
          ? body.id_karyawan_pengganti.trim()
          : "",
      id_shift_backup: Number(body.id_shift_backup),
      alasan_backup:
        typeof body.alasan_backup === "string"
          ? body.alasan_backup.trim()
          : undefined,
      catatan:
        typeof body.catatan === "string" ? body.catatan.trim() : undefined,
      kode_operator: actor.kode_operator,
    };
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(draft.tanggal_tugas) ||
      !draft.id_karyawan_asal ||
      !draft.id_karyawan_pengganti ||
      !Number.isSafeInteger(draft.id_shift_backup)
    ) {
      throw new ApiRequestError("Data penugasan backup tidak valid.", 400);
    }
    await ensureServerDatabaseInitialized();
    const result = await buatPenugasanBackup(draft);
    if (!result.sukses) throw new ApiRequestError(result.pesan, 409);
    return noStoreJson(result, 201);
  } catch (error) {
    return toApiErrorResponse(error);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    assertSameOriginMutation(request);
    const body = await readJsonBody<Record<string, unknown>>(request);
    const action =
      typeof body.action === "string"
        ? body.action.trim().toLowerCase()
        : "cancel";
    if (action !== "cancel" && action !== "delete") {
      throw new ApiRequestError("Aksi penugasan backup tidak dikenali.", 400);
    }
    // Hapus permanen menghilangkan jejak pembatalan, jadi setara hapus data
    // operasional lain dan tidak ikut paket bawaan Admin.
    const actor = await requireWebPermission(
      request,
      action === "delete" ? "operational.delete" : "backups.manage",
    );
    const id = typeof body.id_backup === "string" ? body.id_backup.trim() : "";
    if (!id) throw new ApiRequestError("ID backup tidak valid.", 400);
    await ensureServerDatabaseInitialized();

    if (action === "delete") {
      const result = await hapusPenugasanBackup(id);
      if (!result.sukses) throw new ApiRequestError(result.pesan, 400);
      return noStoreJson(result);
    }

    const result = await batalkanPenugasanBackup(id, actor.kode_operator);
    return noStoreJson(result);
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
