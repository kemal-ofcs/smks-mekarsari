import type { NextRequest } from "next/server";
import { requireWebPermission } from "@/lib/server/auth/authorize";
import { ensureServerDatabaseInitialized } from "@/lib/server/db";
import {
  noStoreJson,
  readJsonBody,
  toApiErrorResponse,
} from "@/lib/server/http/api-response";
import { assertSameOriginMutation } from "@/lib/server/http/request-security";
import { generateAlfaHarian } from "@/lib/services/alfa-audit";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    await requireWebPermission(request, "alfa.trigger");
    assertSameOriginMutation(request);
    await ensureServerDatabaseInitialized();

    const body = await readJsonBody<{ simulatedTime?: unknown }>(request);

    // Waktu simulasi hanya untuk pengujian, dan di produksi ia DITOLAK.
    //
    // `generateAlfaHarian` memakainya menggantikan jam server sepenuhnya,
    // sehingga hari kerja yang dinilai, pemeriksaan hari libur, dan cutoff-nya
    // ikut bergeser. Dengan waktu pilihan sendiri, pemanggil bisa membuat baris
    // `absensi_harian` untuk tanggal lampau maupun tanggal yang belum terjadi —
    // bertanda `sumber = 'Generate Sistem'` sehingga tidak bisa dibedakan dari
    // hasil otomatis yang sah. Alfa berarti nol jam kerja, dan nol jam kerja
    // mengalir ke payroll.
    //
    // Bentuk sebelumnya menerima apa pun: `new Date("ngawur")` menghasilkan
    // Invalid Date yang juga tidak ditolak.
    const raw = body.simulatedTime;
    const diminta = typeof raw === "string" && raw.trim() ? raw.trim() : null;
    if (diminta && process.env.NODE_ENV === "production") {
      throw new Error("Waktu simulasi hanya tersedia pada build pengembangan.");
    }
    let simulatedDate: Date | undefined;
    if (diminta) {
      const parsed = new Date(diminta);
      if (Number.isNaN(parsed.getTime())) {
        throw new Error("Format waktu simulasi tidak valid.");
      }
      simulatedDate = parsed;
    }

    const ringkasan = await generateAlfaHarian(simulatedDate);
    return noStoreJson({ ringkasan });
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
