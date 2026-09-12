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
import {
  APPLIES_TO_ALL,
  APPLIES_TO_GROUP_PREFIXES,
  isStudentPersonnel,
  normalizeAppliesTo,
  PAYROLL_CALC_TYPES,
  type PayrollCalcType,
} from "@/lib/validations/payroll-policy";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    await requireWebPermission(request, "payroll.view");
    await ensureServerDatabaseInitialized();
    const client = getServerDatabase();

    const result = await client.execute(
      "SELECT * FROM payroll_components ORDER BY category, name ASC;",
    );
    return noStoreJson({ data: result.rows });
  } catch (error) {
    return toApiErrorResponse(error);
  }
}

export async function PUT(request: NextRequest) {
  try {
    await requireWebPermission(request, "payroll.config.manage");
    assertSameOriginMutation(request);
    await ensureServerDatabaseInitialized();
    const client = getServerDatabase();

    const body = await readJsonBody<{ draft?: Record<string, unknown> }>(
      request,
    );
    const draft = body.draft;
    if (!draft || !draft.name || !draft.category || !draft.calc_type) {
      throw new ApiRequestError(
        "name, category, dan calc_type wajib diisi.",
        400,
      );
    }

    const compId =
      typeof draft.id === "string" && draft.id.trim()
        ? draft.id.trim()
        : `comp-${Date.now()}`;

    // Penerima komponen: "ALL" atau satu personil yang benar-benar ada dan
    // bukan siswa. Cerminan validasi di `desktop_save_payroll_component`.
    // Tanpa ini, id yang salah ketik tersimpan sebagai komponen yang tidak
    // pernah berlaku untuk siapa pun — tanpa pesan, dan hanya terlihat sebagai
    // tunjangan yang "hilang" di slip orangnya.
    // Jenis perhitungan divalidasi SEBELUM menyentuh database: nilai asing
    // ditolak CHECK constraint dengan pesan SQLite yang tidak bisa dipahami
    // pengguna. Cerminan validasi di `desktop_save_payroll_component`.
    if (
      !PAYROLL_CALC_TYPES.includes(String(draft.calc_type) as PayrollCalcType)
    ) {
      throw new ApiRequestError(
        "Jenis perhitungan komponen tidak dikenal.",
        400,
      );
    }

    const appliesTo = normalizeAppliesTo(draft.applies_to);
    // Bentuk kelompok tidak diverifikasi ke master data: divisi atau status
    // yang hari ini belum dipakai siapa pun boleh didaftarkan lebih dulu, dan
    // komponennya diam sampai ada orangnya. Yang diverifikasi hanya bentuk
    // PERORANGAN. Cerminan validasi di `desktop_save_payroll_component`.
    const bentukKelompok = APPLIES_TO_GROUP_PREFIXES.some(
      (prefix) =>
        appliesTo.startsWith(`${prefix}:`) &&
        appliesTo.slice(prefix.length + 1).trim() !== "",
    );
    if (appliesTo !== APPLIES_TO_ALL && !bentukKelompok) {
      const personil = await client.execute({
        sql: "SELECT COALESCE(jenis_personil, '') AS jenis_personil FROM master_data WHERE id_unik = ? LIMIT 1;",
        args: [appliesTo],
      });
      const row = personil.rows[0];
      if (!row) {
        throw new ApiRequestError(
          "Penerima komponen tidak ditemukan pada data personil.",
          400,
        );
      }
      if (isStudentPersonnel(row.jenis_personil)) {
        throw new ApiRequestError(
          "Siswa tidak menerima komponen payroll.",
          400,
        );
      }
    }

    await client.execute({
      sql: `
        INSERT INTO payroll_components (
          id, name, category, calc_type, default_value, applies_to, is_active
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          category = excluded.category,
          calc_type = excluded.calc_type,
          default_value = excluded.default_value,
          applies_to = excluded.applies_to,
          is_active = excluded.is_active;
      `,
      args: [
        compId,
        String(draft.name),
        String(draft.category),
        String(draft.calc_type),
        Number(draft.default_value || 0),
        appliesTo,
        Number(draft.is_active ?? 1),
      ],
    });

    return noStoreJson({ sukses: true });
  } catch (error) {
    return toApiErrorResponse(error);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    await requireWebPermission(request, "payroll.config.manage");
    assertSameOriginMutation(request);
    await ensureServerDatabaseInitialized();
    const client = getServerDatabase();

    const body = await readJsonBody<{ id?: string }>(request);
    if (!body.id) {
      throw new ApiRequestError("id wajib diisi.", 400);
    }

    await client.execute({
      sql: "DELETE FROM payroll_components WHERE id = ?;",
      args: [body.id],
    });

    return noStoreJson({ sukses: true });
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
