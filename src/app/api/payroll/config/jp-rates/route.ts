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

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    assertSameOriginMutation(request);
    await requireWebPermission(request, "payroll.view");
    await ensureServerDatabaseInitialized();
    const client = getServerDatabase();

    // Tanpa LIMIT: `tarif_jp` sebesar daftar mata pelajaran sekolah, bukan
    // tabel yang tumbuh setiap hari operasional.
    const result = await client.execute(
      `SELECT t.id, t.id_mapel, t.id_guru, t.rate_per_jp, t.effective_date,
              t.status_aktif, t.created_at, t.updated_at,
              COALESCE(m.nama_mapel, '') AS nama_mapel,
              COALESCE(md.nama, '') AS nama_guru
       FROM tarif_jp t
       LEFT JOIN akademik_mapel m ON m.id_mapel = t.id_mapel
       LEFT JOIN master_data md ON md.id_unik = t.id_guru
       ORDER BY COALESCE(m.nama_mapel, ''), t.effective_date DESC;`,
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
    const draft = body.draft ?? {};
    const idMapel = String(draft.id_mapel ?? "").trim();
    const effectiveDate = String(draft.effective_date ?? "").trim();
    const idGuru = String(draft.id_guru ?? "").trim() || null;
    const ratePerJp = Number(draft.rate_per_jp ?? -1);
    const statusAktif = Number(draft.status_aktif ?? 1);

    if (!idMapel || !effectiveDate) {
      throw new ApiRequestError(
        "Mata pelajaran dan tanggal berlaku wajib diisi.",
        400,
      );
    }
    if (!Number.isFinite(ratePerJp) || ratePerJp < 0) {
      throw new ApiRequestError(
        "Tarif per jam pelajaran tidak boleh kurang dari nol.",
        400,
      );
    }
    if (statusAktif !== 0 && statusAktif !== 1) {
      throw new ApiRequestError("Status aktif hanya boleh 0 atau 1.", 400);
    }

    // Mapel dan guru diverifikasi ke master datanya, bukan dipercaya dari
    // formulir: tarif yang menunjuk mapel yang sudah dihapus tidak akan pernah
    // terpakai, dan itu hanya terlihat sebagai honor yang diam-diam nol.
    // Cerminan validasi di `desktop_save_jp_rate`.
    const mapel = await client.execute({
      sql: "SELECT 1 FROM akademik_mapel WHERE id_mapel = ? LIMIT 1;",
      args: [idMapel],
    });
    if (mapel.rows.length === 0) {
      throw new ApiRequestError("Mata pelajaran tidak ditemukan.", 400);
    }
    if (idGuru) {
      const guru = await client.execute({
        sql: `SELECT 1 FROM master_data
              WHERE id_unik = ?
                AND LOWER(TRIM(COALESCE(jenis_personil, ''))) = 'guru'
              LIMIT 1;`,
        args: [idGuru],
      });
      if (guru.rows.length === 0) {
        throw new ApiRequestError(
          "Guru tidak ditemukan pada data personil.",
          400,
        );
      }
    }

    const id = String(draft.id ?? "").trim() || `tjp-${Date.now()}`;
    // Stempel waktu dihitung SQLite, bukan `new Date()`: satu baris bisa
    // dibuat Rust dan dibaca TypeScript, dan pemilihan tarif memakai
    // `updated_at` sebagai pemutus seri.
    await client.execute({
      sql: `
        INSERT INTO tarif_jp (
          id, id_mapel, id_guru, rate_per_jp, effective_date, status_aktif, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
        ON CONFLICT(id) DO UPDATE SET
          id_mapel = excluded.id_mapel,
          id_guru = excluded.id_guru,
          rate_per_jp = excluded.rate_per_jp,
          effective_date = excluded.effective_date,
          status_aktif = excluded.status_aktif,
          updated_at = datetime('now');
      `,
      args: [id, idMapel, idGuru, ratePerJp, effectiveDate, statusAktif],
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
      sql: "DELETE FROM tarif_jp WHERE id = ?;",
      args: [body.id],
    });

    return noStoreJson({ sukses: true });
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
