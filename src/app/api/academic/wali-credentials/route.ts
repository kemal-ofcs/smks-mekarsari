import type { InStatement, InValue } from "@libsql/client";
import type { NextRequest } from "next/server";
import { hashPasswordValue } from "@/lib/auth/password";
import { buatPasswordWaliAcak } from "@/lib/auth/wali-password";
import { db } from "@/lib/db";
import { requireWebPermission } from "@/lib/server/auth/authorize";
import { ensureServerDatabaseInitialized } from "@/lib/server/db";
import {
  ApiRequestError,
  noStoreJson,
  readJsonBody,
  toApiErrorResponse,
} from "@/lib/server/http/api-response";
import { assertSameOriginMutation } from "@/lib/server/http/request-security";

export const runtime = "nodejs";

type StatusKredensial = "bawaan" | "diubah" | "belum_ada";

function statusKredensial(hasHash: boolean, changedAt: string | null) {
  const status: StatusKredensial = !hasHash
    ? "belum_ada"
    : changedAt === null
      ? "bawaan"
      : "diubah";
  return status;
}

/**
 * Password wali TIDAK pernah bisa dibaca ulang: database hanya memegang
 * hash-nya. Karena itu `password` hanya terisi pada balasan yang baru saja
 * menerbitkannya; di tempat lain nilainya `null`.
 */
async function daftarKredensial(list: string[] | null | undefined) {
  let sql = `SELECT s.id_siswa, s.nis, s.nisn, s.nama_lengkap, r.nama_rombel, m.unit,
                    k.changed_at, k.password_hash
               FROM siswa_data s
               JOIN akademik_rombel r ON r.id_rombel = s.id_rombel
          LEFT JOIN master_data m ON m.id_unik = s.id_siswa
          LEFT JOIN wali_kredensial k ON k.id_siswa = s.id_siswa
              WHERE s.status = 'Aktif'`;
  const args: InValue[] = [];
  if (Array.isArray(list) && list.length > 0) {
    sql += ` AND s.id_siswa IN (${list.map(() => "?").join(", ")})`;
    args.push(...list.map((item) => String(item)));
  }
  sql += ` ORDER BY r.nama_rombel, s.nama_lengkap;`;

  const hasil = await db.execute({ sql, args });
  return hasil.rows.map((baris) => ({
    idSiswa: String(baris.id_siswa),
    namaSiswa: String(baris.nama_lengkap ?? ""),
    nis: baris.nis ? String(baris.nis).trim() || null : null,
    nisn: baris.nisn ? String(baris.nisn).trim() || null : null,
    rombel: baris.nama_rombel ? String(baris.nama_rombel) : null,
    unit: baris.unit ? String(baris.unit).trim() || null : null,
    password: null as string | null,
    status: statusKredensial(
      Boolean(baris.password_hash),
      baris.changed_at ? String(baris.changed_at) : null,
    ),
  }));
}

/** Simpan password sementara dan cabut sesi wali yang masih hidup. */
async function pernyataanTerbitkan(
  idSiswa: string,
  password: string,
): Promise<InStatement[]> {
  return [
    {
      sql: `INSERT INTO wali_kredensial (
              id_siswa, password_hash, changed_at, created_at, updated_at
            ) VALUES (?, ?, NULL, datetime('now'), datetime('now'))
            ON CONFLICT(id_siswa) DO UPDATE SET
              password_hash = excluded.password_hash,
              changed_at = NULL,
              updated_at = datetime('now');`,
      args: [idSiswa, await hashPasswordValue(password)],
    },
    {
      sql: `UPDATE wali_session
               SET revoked_at = datetime('now'), revoked_reason = 'admin_reset'
             WHERE id_siswa = ? AND revoked_at IS NULL;`,
      args: [idSiswa],
    },
  ];
}

export async function POST(request: NextRequest) {
  try {
    assertSameOriginMutation(request);
    await ensureServerDatabaseInitialized();

    const body = await readJsonBody<{
      action?: "status" | "reset" | "bulk_issue" | "print_slips";
      id_siswa?: string;
      id_siswa_list?: string[] | null;
    }>(request);

    if (body.action === "status") {
      await requireWebPermission(request, "students.view");
      if (!body.id_siswa) {
        throw new ApiRequestError("ID siswa wajib disertakan.", 400);
      }

      const hasil = await db.execute({
        sql: `SELECT s.id_siswa, k.changed_at, k.password_hash
                FROM siswa_data s
           LEFT JOIN wali_kredensial k ON k.id_siswa = s.id_siswa
               WHERE s.id_siswa = ? LIMIT 1;`,
        args: [body.id_siswa],
      });

      const baris = hasil.rows[0];
      if (!baris) {
        throw new ApiRequestError("Data siswa tidak ditemukan.", 404);
      }
      const changedAt = baris.changed_at ? String(baris.changed_at) : null;

      return noStoreJson({
        idSiswa: String(baris.id_siswa),
        status: statusKredensial(Boolean(baris.password_hash), changedAt),
        changedAt,
      });
    }

    if (body.action === "reset") {
      await requireWebPermission(request, "students.reset_wali_password");
      if (!body.id_siswa) {
        throw new ApiRequestError("ID siswa wajib disertakan.", 400);
      }

      const hasil = await db.execute({
        sql: "SELECT id_siswa FROM siswa_data WHERE id_siswa = ? LIMIT 1;",
        args: [body.id_siswa],
      });
      if (!hasil.rows[0]) {
        throw new ApiRequestError("Data siswa tidak ditemukan.", 404);
      }

      const password = buatPasswordWaliAcak();
      await db.batch(
        await pernyataanTerbitkan(body.id_siswa, password),
        "write",
      );

      return noStoreJson({ sukses: true, password });
    }

    // Wali yang sudah mengganti password sendiri TIDAK ikut diterbitkan ulang:
    // dialog penerbitan menjanjikan itu, dan menimpanya diam-diam mengunci wali
    // yang sudah aktif keluar dari portal.
    if (body.action === "bulk_issue") {
      await requireWebPermission(request, "students.reset_wali_password");
      const terbit = (await daftarKredensial(body.id_siswa_list)).filter(
        (baris) => baris.status !== "diubah",
      );

      const batchStmts: InStatement[] = [];
      for (const baris of terbit) {
        baris.password = buatPasswordWaliAcak();
        baris.status = "bawaan";
        batchStmts.push(
          ...(await pernyataanTerbitkan(baris.idSiswa, baris.password)),
        );
      }
      if (batchStmts.length > 0) {
        await db.batch(batchStmts, "write");
      }

      return noStoreJson({
        sukses: true,
        count: terbit.length,
        credentials: terbit,
      });
    }

    if (body.action === "print_slips") {
      await requireWebPermission(request, "students.view");
      return noStoreJson({
        credentials: await daftarKredensial(body.id_siswa_list),
      });
    }

    throw new ApiRequestError("Aksi tidak valid.", 400);
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
