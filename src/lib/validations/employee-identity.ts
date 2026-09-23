/**
 * Kolom identitas yang dicatat di `riwayat_identitas_karyawan` saat ID Unik
 * dipakai dua orang. Pencatatannya terjadi di Rust (`turso.rs`), satu-satunya
 * jalur push sejak jalur server aplikasi dipensiunkan; daftar ini dipakai UI
 * untuk menampilkan data sebelum/sesudah dengan urutan yang sama.
 */
export const EMPLOYEE_IDENTITY_FIELDS = [
  "id_unik",
  "kode_karyawan",
  "nama",
  "divisi",
  "jabatan_status",
  "no_hp",
  "lp",
  "id_shift",
  "status_aktif",
  "jenis_personil",
  "unit",
] as const;

/** Satu penggantian identitas karyawan lewat "Gunakan Versi Lokal". */
export interface RiwayatIdentitasKaryawan {
  id: number;
  waktu: string;
  idUnik: string;
  dataLama: Record<string, string>;
  dataBaru: Record<string, string>;
  kodeOperator: string;
  clientId: string;
  eventId: string;
}

function parseRingkasan(value: unknown): Record<string, string> {
  try {
    const parsed = JSON.parse(String(value ?? "{}")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    return Object.fromEntries(
      Object.entries(parsed).map(([key, item]) => [key, String(item ?? "")]),
    );
  } catch {
    return {};
  }
}

/** Baris mentah `riwayat_identitas_karyawan` (Web maupun Rust) ke bentuk UI. */
export function normalisasiRiwayatIdentitas(
  row: Record<string, unknown>,
): RiwayatIdentitasKaryawan {
  const text = (key: string) =>
    row[key] === null || row[key] === undefined ? "" : String(row[key]);
  return {
    id: Number(row.id_riwayat ?? 0),
    waktu: text("waktu"),
    idUnik: text("id_unik"),
    dataLama: parseRingkasan(row.data_lama),
    dataBaru: parseRingkasan(row.data_baru),
    kodeOperator: text("kode_operator"),
    clientId: text("client_id"),
    eventId: text("event_id"),
  };
}

/** Label tampilan untuk setiap kolom di `EMPLOYEE_IDENTITY_FIELDS`. */
export const LABEL_IDENTITAS_KARYAWAN: Record<
  (typeof EMPLOYEE_IDENTITY_FIELDS)[number],
  string
> = {
  id_unik: "ID Unik",
  kode_karyawan: "Kode Karyawan",
  nama: "Nama",
  divisi: "Divisi",
  jabatan_status: "Jabatan",
  no_hp: "No. HP",
  lp: "L/P",
  id_shift: "Shift",
  status_aktif: "Status",
  jenis_personil: "Jenis Personil",
  unit: "Unit",
};
