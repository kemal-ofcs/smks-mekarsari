"use client";

import { requestWebApi } from "@/lib/client/api-client";
import { isDesktopRuntime } from "@/lib/runtime/app-runtime";
import { invokeDesktop } from "@/lib/runtime/desktop-commands";
import {
  normalisasiRiwayatIdentitas,
  type RiwayatIdentitasKaryawan,
} from "@/lib/validations/employee-identity";

type JsonRecord = Record<string, unknown>;

function entriesOf(response: JsonRecord) {
  return Array.isArray(response.entries)
    ? (response.entries as JsonRecord[])
    : [];
}

/**
 * Riwayat penggantian ID Unik karyawan lewat "Gunakan Versi Lokal".
 *
 * Tabelnya khusus cloud: Desktop/Mobile memanggil command Rust yang membaca
 * cloud langsung, jadi halaman ini butuh jaringan di sana. Penjaga izinnya
 * (`employees.view`) ada di route handler dan di command Rust.
 */
export async function getRiwayatIdentitasKaryawan(
  search = "",
  limit = 200,
): Promise<RiwayatIdentitasKaryawan[]> {
  const payload = { search, limit };
  const response = isDesktopRuntime()
    ? await invokeDesktop<JsonRecord>(
        "desktop_list_employee_identity_history",
        payload,
      )
    : await requestWebApi<JsonRecord>(
        "/api/employees/identity-history/query",
        "POST",
        payload,
      );
  // Baris Web sudah dinormalkan server; baris Rust masih mentah. Keduanya
  // dinormalkan lagi di sini supaya UI hanya mengenal satu bentuk.
  return entriesOf(response).map((row) =>
    "idUnik" in row
      ? (row as unknown as RiwayatIdentitasKaryawan)
      : normalisasiRiwayatIdentitas(row),
  );
}
