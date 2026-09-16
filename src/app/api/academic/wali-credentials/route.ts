import type { InStatement, InValue } from "@libsql/client";
import type { NextRequest } from "next/server";
import { hashPasswordValue } from "@/lib/auth/password";
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

function hitungPasswordDefault(
  nis?: string | null,
  nisn?: string | null,
  unit?: string | null,
) {
  const nomor = String(nisn || nis || "").trim();
  const unitClean = String(unit || "")
    .trim()
    .toUpperCase();
  return `${nomor}${unitClean}`;
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
        sql: `SELECT s.id_siswa, s.nis, s.nisn, m.unit,
                     k.changed_at, k.password_hash
                FROM siswa_data s
           LEFT JOIN master_data m ON m.id_unik = s.id_siswa
           LEFT JOIN wali_kredensial k ON k.id_siswa = s.id_siswa
               WHERE s.id_siswa = ? LIMIT 1;`,
        args: [body.id_siswa],
      });

      const baris = hasil.rows[0];
      if (!baris) {
        throw new ApiRequestError("Data siswa tidak ditemukan.", 404);
      }

      const nis = baris.nis ? String(baris.nis) : "";
      const nisn = baris.nisn ? String(baris.nisn) : "";
      const unit = baris.unit ? String(baris.unit) : "";
      const defaultPassword = hitungPasswordDefault(nis, nisn, unit);

      const hasHash = Boolean(baris.password_hash);
      const changedAt = baris.changed_at ? String(baris.changed_at) : null;

      const status = !hasHash
        ? "belum_ada"
        : changedAt === null
          ? "bawaan"
          : "diubah";

      return noStoreJson({
        idSiswa: String(baris.id_siswa),
        status,
        changedAt,
        defaultPassword,
      });
    }

    if (body.action === "reset") {
      await requireWebPermission(request, "students.reset_wali_password");
      if (!body.id_siswa) {
        throw new ApiRequestError("ID siswa wajib disertakan.", 400);
      }

      const hasil = await db.execute({
        sql: `SELECT s.id_siswa, s.nis, s.nisn, m.unit
                FROM siswa_data s
           LEFT JOIN master_data m ON m.id_unik = s.id_siswa
               WHERE s.id_siswa = ? LIMIT 1;`,
        args: [body.id_siswa],
      });

      const baris = hasil.rows[0];
      if (!baris) {
        throw new ApiRequestError("Data siswa tidak ditemukan.", 404);
      }

      const nis = baris.nis ? String(baris.nis) : "";
      const nisn = baris.nisn ? String(baris.nisn) : "";
      const unit = baris.unit ? String(baris.unit) : "";
      const defaultPassword = hitungPasswordDefault(nis, nisn, unit);
      const passwordHash = await hashPasswordValue(defaultPassword);

      await db.batch(
        [
          {
            sql: `INSERT INTO wali_kredensial (
                    id_siswa, password_hash, changed_at, created_at, updated_at
                  ) VALUES (?, ?, NULL, datetime('now'), datetime('now'))
                  ON CONFLICT(id_siswa) DO UPDATE SET
                    password_hash = excluded.password_hash,
                    changed_at = NULL,
                    updated_at = datetime('now');`,
            args: [body.id_siswa, passwordHash],
          },
          {
            sql: `UPDATE wali_session
                     SET revoked_at = datetime('now'), revoked_reason = 'admin_reset'
                   WHERE id_siswa = ? AND revoked_at IS NULL;`,
            args: [body.id_siswa],
          },
        ],
        "write",
      );

      return noStoreJson({
        sukses: true,
        defaultPassword,
      });
    }

    if (body.action === "bulk_issue") {
      await requireWebPermission(request, "students.reset_wali_password");
      const list = body.id_siswa_list;

      let sql = `SELECT s.id_siswa, s.nis, s.nisn, s.nama_lengkap, r.nama_rombel, m.unit,
                        k.changed_at, k.password_hash
                   FROM siswa_data s
                   JOIN akademik_rombel r ON r.id_rombel = s.id_rombel
              LEFT JOIN master_data m ON m.id_unik = s.id_siswa
              LEFT JOIN wali_kredensial k ON k.id_siswa = s.id_siswa
                   WHERE s.status = 'Aktif'`;
      const args: InValue[] = [];

      if (Array.isArray(list) && list.length > 0) {
        const placeholders = list.map(() => "?").join(", ");
        sql += ` AND s.id_siswa IN (${placeholders})`;
        args.push(...list.map((item) => String(item)));
      }
      sql += ` ORDER BY r.nama_rombel, s.nama_lengkap;`;

      const hasil = await db.execute({ sql, args });
      const batchStmts: InStatement[] = [];
      const credentials: {
        idSiswa: string;
        namaSiswa: string;
        nis: string | null;
        nisn: string | null;
        rombel: string | null;
        unit: string | null;
        defaultPassword: string;
        status: "bawaan" | "diubah" | "belum_ada";
      }[] = [];

      for (const baris of hasil.rows) {
        const idSiswa = String(baris.id_siswa);
        const nis = baris.nis ? String(baris.nis).trim() : "";
        const nisn = baris.nisn ? String(baris.nisn).trim() : "";
        const unit = baris.unit ? String(baris.unit).trim() : "";
        const defaultPassword = hitungPasswordDefault(nis, nisn, unit);
        const passwordHash = await hashPasswordValue(defaultPassword);

        batchStmts.push(
          {
            sql: `INSERT INTO wali_kredensial (
                    id_siswa, password_hash, changed_at, created_at, updated_at
                  ) VALUES (?, ?, NULL, datetime('now'), datetime('now'))
                  ON CONFLICT(id_siswa) DO UPDATE SET
                    password_hash = excluded.password_hash,
                    changed_at = NULL,
                    updated_at = datetime('now');`,
            args: [idSiswa, passwordHash],
          },
          {
            sql: `UPDATE wali_session
                     SET revoked_at = datetime('now'), revoked_reason = 'admin_reset'
                   WHERE id_siswa = ? AND revoked_at IS NULL;`,
            args: [idSiswa],
          },
        );

        credentials.push({
          idSiswa,
          namaSiswa: String(baris.nama_lengkap ?? ""),
          nis: nis || null,
          nisn: nisn || null,
          rombel: baris.nama_rombel ? String(baris.nama_rombel) : null,
          unit: unit || null,
          defaultPassword,
          status: "bawaan",
        });
      }

      if (batchStmts.length > 0) {
        await db.batch(batchStmts, "write");
      }

      return noStoreJson({
        sukses: true,
        count: credentials.length,
        credentials,
      });
    }

    if (body.action === "print_slips") {
      await requireWebPermission(request, "students.view");
      const list = body.id_siswa_list;

      let sql = `SELECT s.id_siswa, s.nis, s.nisn, s.nama_lengkap, r.nama_rombel, m.unit,
                        k.changed_at, k.password_hash
                   FROM siswa_data s
                   JOIN akademik_rombel r ON r.id_rombel = s.id_rombel
              LEFT JOIN master_data m ON m.id_unik = s.id_siswa
              LEFT JOIN wali_kredensial k ON k.id_siswa = s.id_siswa
                  WHERE s.status = 'Aktif'`;
      const args: InValue[] = [];

      if (Array.isArray(list) && list.length > 0) {
        const placeholders = list.map(() => "?").join(", ");
        sql += ` AND s.id_siswa IN (${placeholders})`;
        args.push(...list.map((item) => String(item)));
      }
      sql += ` ORDER BY r.nama_rombel, s.nama_lengkap;`;

      const hasil = await db.execute({ sql, args });
      const credentials = hasil.rows.map((baris) => {
        const idSiswa = String(baris.id_siswa);
        const nis = baris.nis ? String(baris.nis).trim() : "";
        const nisn = baris.nisn ? String(baris.nisn).trim() : "";
        const unit = baris.unit ? String(baris.unit).trim() : "";
        const defaultPassword = hitungPasswordDefault(nis, nisn, unit);
        const hasHash = Boolean(baris.password_hash);
        const changedAt = baris.changed_at ? String(baris.changed_at) : null;

        const status: "bawaan" | "diubah" | "belum_ada" = !hasHash
          ? "belum_ada"
          : changedAt === null
            ? "bawaan"
            : "diubah";

        return {
          idSiswa,
          namaSiswa: String(baris.nama_lengkap ?? ""),
          nis: nis || null,
          nisn: nisn || null,
          rombel: baris.nama_rombel ? String(baris.nama_rombel) : null,
          unit: unit || null,
          defaultPassword,
          status,
        };
      });

      return noStoreJson({ credentials });
    }

    throw new ApiRequestError("Aksi tidak valid.", 400);
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
