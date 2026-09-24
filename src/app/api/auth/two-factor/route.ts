import type { Client } from "@libsql/client";
import type { NextRequest } from "next/server";
import { verifyPassword } from "@/lib/auth/password";
import {
  requireWebPermission,
  requireWebSession,
} from "@/lib/server/auth/authorize";
import { issuePasswordRecoveryCodes } from "@/lib/server/auth/password-reset";
import {
  beginTwoFactorSetup,
  confirmTwoFactorSetup,
  disableTwoFactor,
  getTwoFactorStatus,
  TwoFactorError,
} from "@/lib/server/auth/two-factor";
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

export const runtime = "nodejs";

/**
 * Pengelolaan verifikasi dua langkah.
 *
 * `POST` untuk semua langkah, termasuk pembacaan status: build Desktop/Mobile
 * memakai `output: "export"` yang tidak bisa melayani route handler `GET`.
 *
 * Langkah `status`, `begin`, `confirm`, dan `disable` selalu bekerja pada akun
 * PEMANGGIL — id operatornya diambil dari sesi, tidak pernah dari badan
 * permintaan. Tanpa aturan itu, siapa pun yang punya sesi bisa mematikan 2FA
 * milik orang lain hanya dengan menebak id.
 */
type TwoFactorStep =
  | "status"
  | "begin"
  | "confirm"
  | "disable"
  | "admin-disable"
  | "recovery-codes";

interface TwoFactorBody {
  step?: unknown;
  code?: unknown;
  /** Hanya dipakai `admin-disable`, dan dijaga izin operators.manage. */
  operatorId?: unknown;
  /** Wajib untuk `begin` dan `recovery-codes`. */
  currentPassword?: unknown;
}

/**
 * Bukti bahwa yang memegang sesi memang pemilik akunnya. Sesi saja tidak cukup
 * untuk mendaftarkan autentikator atau mencetak kode pemulihan: siapa pun di
 * depan komputer yang ditinggal dalam keadaan login akan mendapat kunci
 * cadangan permanen ke akun itu.
 */
async function assertPasswordSaatIni(
  database: Client,
  operatorId: number,
  password: unknown,
) {
  const baris = await database.execute({
    sql: "SELECT password_hash FROM master_operator WHERE id = ? LIMIT 1;",
    args: [operatorId],
  });
  const cocok =
    typeof password === "string" &&
    password.length > 0 &&
    (await verifyPassword(password, String(baris.rows[0]?.password_hash ?? "")))
      .valid;
  if (!cocok) {
    throw new TwoFactorError("Password akun Anda tidak cocok.", 403);
  }
}

export async function POST(request: NextRequest) {
  try {
    assertSameOriginMutation(request);
    await ensureServerDatabaseInitialized();
    const body = await readJsonBody<TwoFactorBody>(request);
    const step = (
      typeof body.step === "string" ? body.step : "status"
    ) as TwoFactorStep;
    const database = getServerDatabase();
    const code = typeof body.code === "string" ? body.code : "";

    if (step === "admin-disable") {
      const admin = await requireWebPermission(request, "two_factor.reset");
      const target = Number(body.operatorId);
      if (!Number.isSafeInteger(target) || target < 1) {
        throw new TwoFactorError("ID operator tidak valid.");
      }
      // Izin ini bisa diberikan ke role selain Superadmin; tanpa penjaga ini
      // pemegangnya bisa melepas lapisan terakhir akun tertinggi. Cerminan
      // `desktop_admin_disable_two_factor`.
      if (!admin.isSuperadmin) {
        const peran = await database.execute({
          sql: "SELECT COALESCE(r.is_superadmin, 0) AS superadmin FROM master_operator m JOIN app_role r ON r.id = m.role_id WHERE m.id = ? LIMIT 1;",
          args: [target],
        });
        if (Number(peran.rows[0]?.superadmin ?? 0) === 1) {
          throw new TwoFactorError(
            "Hanya Superadmin yang boleh mematikan verifikasi dua langkah akun Superadmin.",
            403,
          );
        }
      }
      await disableTwoFactor(database, target, { requireProof: false });
      return noStoreJson({ sukses: true });
    }

    const actor = await requireWebSession(request);
    switch (step) {
      case "begin":
        await assertPasswordSaatIni(database, actor.id, body.currentPassword);
        return noStoreJson({
          sukses: true,
          setup: await beginTwoFactorSetup(database, actor.id),
        });
      case "confirm":
        return noStoreJson({
          sukses: true,
          ...(await confirmTwoFactorSetup(database, actor.id, code)),
        });
      case "disable":
        await disableTwoFactor(database, actor.id, {
          requireProof: true,
          code,
        });
        return noStoreJson({ sukses: true });
      // Kode pemulihan password, bukan kode cadangan 2FA — tetapi tunduk pada
      // aturan yang sama seperti langkah lain di berkas ini: id operatornya
      // diambil dari SESI, tidak pernah dari badan permintaan. Mencetak kode
      // bagi akun orang lain berarti membuat kunci cadangan ke akun itu tanpa
      // pemiliknya pernah tahu.
      case "recovery-codes":
        await assertPasswordSaatIni(database, actor.id, body.currentPassword);
        return noStoreJson({
          sukses: true,
          codes: await issuePasswordRecoveryCodes(database, actor.id),
        });
      default:
        return noStoreJson({
          sukses: true,
          status: await getTwoFactorStatus(database, actor.id),
        });
    }
  } catch (error) {
    if (error instanceof TwoFactorError) {
      return noStoreJson({ sukses: false, pesan: error.message }, error.status);
    }
    return toApiErrorResponse(error);
  }
}
