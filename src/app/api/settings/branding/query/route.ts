import type { NextRequest } from "next/server";
import { getServerDatabase } from "@/lib/server/db";
import {
  noStoreJson,
  toApiErrorResponse,
} from "@/lib/server/http/api-response";
import { assertSameOriginMutation } from "@/lib/server/http/request-security";

export const runtime = "nodejs";

/**
 * Logo dan nama instansi. Padanan `desktop_get_public_branding`.
 *
 * Bisa dipanggil TANPA login karena layar login menampilkannya, jadi batasnya
 * disengaja: hanya dua kolom ini, dan hanya membaca. Tanda tangan, alamat, dan
 * kontak tetap lewat `company-profile/query` yang menuntut `settings.manage`.
 */
export async function POST(request: NextRequest) {
  try {
    assertSameOriginMutation(request);
    const hasil = await getServerDatabase().execute(
      "SELECT company_name, logo_url FROM company_profile WHERE id = 'default_company' LIMIT 1;",
    );
    const baris = hasil.rows[0];
    return noStoreJson({
      data: {
        company_name: (baris?.company_name as string | null) ?? null,
        logo_url: (baris?.logo_url as string | null) ?? null,
      },
    });
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
