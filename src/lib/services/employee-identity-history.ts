import "server-only";

import type { Client } from "@libsql/client";
import {
  normalisasiRiwayatIdentitas,
  type RiwayatIdentitasKaryawan,
} from "@/lib/validations/employee-identity";

/**
 * Riwayat penggantian identitas karyawan, terbaru dulu. Cerminan
 * `list_employee_identity_history` di `turso.rs`.
 */
export async function listRiwayatIdentitasKaryawan(
  database: Client,
  search = "",
  limit = 200,
): Promise<RiwayatIdentitasKaryawan[]> {
  const cari = search.trim().slice(0, 60);
  const like = `%${cari}%`;
  const result = await database.execute({
    sql: "SELECT id_riwayat, waktu, id_unik, data_lama, data_baru, kode_operator, client_id, event_id FROM riwayat_identitas_karyawan WHERE ? = '' OR id_unik LIKE ? COLLATE NOCASE OR data_lama LIKE ? COLLATE NOCASE OR data_baru LIKE ? COLLATE NOCASE OR kode_operator LIKE ? COLLATE NOCASE ORDER BY id_riwayat DESC LIMIT ?;",
    args: [
      cari,
      like,
      like,
      like,
      like,
      Math.min(Math.max(Math.trunc(limit) || 200, 1), 500),
    ],
  });
  return result.rows.map((row) =>
    normalisasiRiwayatIdentitas(row as unknown as Record<string, unknown>),
  );
}
