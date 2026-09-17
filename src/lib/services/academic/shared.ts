import "server-only";

import { db } from "@/lib/db";
import { normalizeOperatorPhone } from "@/lib/operators/contact";
import { ApiRequestError } from "@/lib/server/http/api-response";
import { generateRandomToken } from "@/lib/services/employee";

/**
 * Nomor WhatsApp wali murid, dinormalkan ke bentuk kanonik `+62…`.
 *
 * Memakai normalizer yang SAMA dengan kontak operator — aturannya hidup di satu
 * tempat (`@/lib/operators/contact`) dan punya cerminan Rust yang diuji. Tanpa
 * ini satu nomor bisa tersimpan sebagai `0812…`, `62812…`, dan `+62 812-…`
 * sekaligus, dan tautan `wa.me` tidak selalu terbuka.
 */

/**
 * Helper bersama modul akademik: normalisasi, penjaga keunikan, dan penjaga penghapusan master.
 *
 * Dipecah dari `services/academic.ts` yang tumbuh sampai 1.434 baris berisi
 * sepuluh entitas. Jalur impornya TIDAK berubah — `@/lib/services/academic`
 * kini sebuah direktori dengan `index.ts` sebagai barelnya, sehingga 22 route
 * handler yang mengimpornya tidak perlu disentuh sama sekali.
 */

export function normalizeWaliPhone(value: string | null | undefined) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const normalized = normalizeOperatorPhone(raw);
  if (!normalized) {
    throw new ApiRequestError(
      "Nomor WhatsApp wali tidak valid. Gunakan format 08xxxxxxxxxx atau +62xxxxxxxxxx.",
      400,
    );
  }
  return normalized;
}

/**
 * Tolak nilai yang seharusnya unik, di lapisan aplikasi — bukan lewat UNIQUE.
 *
 * Cerminan `assert_unique_value` di `academic.rs`; alasan lengkapnya ada di
 * sana. Ringkasnya: UNIQUE pada tabel yang ikut sinkronisasi mengubah tabrakan
 * data menjadi kegagalan push PERMANEN yang tidak bisa dipulihkan operator.
 */
export async function assertUniqueValue(spec: {
  table: string;
  column: string;
  idColumn: string;
  value: string | null | undefined;
  exceptId: string;
  message: string;
}) {
  const trimmed = String(spec.value ?? "").trim();
  if (!trimmed) return;
  const existing = await db.execute({
    sql: `SELECT 1 FROM ${spec.table}
          WHERE LOWER(TRIM(${spec.column})) = LOWER(TRIM(?)) AND ${spec.idColumn} <> ?
          LIMIT 1;`,
    args: [trimmed, spec.exceptId],
  });
  if (existing.rows.length > 0) {
    throw new ApiRequestError(spec.message, 409);
  }
}

/**
 * Shift (jam scan) pilihan draft guru/siswa, bila draft mengirimnya.
 *
 * Cerminan `chosen_shift` di `academic.rs`. `null` berarti draft tidak memilih:
 * baris baru jatuh ke shift 1, baris lama MEMPERTAHANKAN shift-nya — dieja di
 * SQL sebagai `COALESCE(?, 1)` dan `COALESCE(?, master_data.id_shift)`.
 */
export async function chosenShift(idShift: unknown): Promise<number | null> {
  if (idShift === undefined || idShift === null || idShift === "") return null;
  const value = Number(idShift);
  if (!Number.isInteger(value) || value <= 0) {
    throw new ApiRequestError("Shift yang dipilih tidak valid.", 400);
  }
  const existing = await db.execute({
    sql: "SELECT 1 FROM tbl_shift WHERE id_shift = ? LIMIT 1;",
    args: [value],
  });
  if (existing.rows.length === 0) {
    throw new ApiRequestError(
      "Shift yang dipilih tidak ditemukan. Muat ulang halaman lalu pilih shift lagi.",
      400,
    );
  }
  return value;
}

/**
 * Token absensi personil sekolah, dibuat sekali dan tidak pernah ditimpa.
 *
 * Terminal pemindai menuntut isi QR berbentuk `id|token` dan membandingkan
 * `token_absensi` apa adanya; baris tanpa token membuat setiap kartu guru dan
 * siswa ditolak. Panjang 10 disamakan dengan `tambahKaryawan` supaya token
 * personil sekolah tidak bisa dibedakan bentuknya dari token karyawan.
 */
export async function ensureScanToken(idUnik: string) {
  const existing = await db.execute({
    sql: "SELECT token_absensi FROM master_data WHERE id_unik = ?;",
    args: [idUnik],
  });
  const current = String(existing.rows[0]?.token_absensi ?? "").trim();
  const token = current || generateRandomToken(10);
  return { token, qrCode: `${idUnik}|${token}` };
}

// ── Penjaga penghapusan master ──────────────────────────────────────────────
//
// Tabel `akademik_*` TIDAK punya FOREIGN KEY, jadi database menerima
// penghapusan rombel yang masih berisi siswa, mapel yang masih punya
// penugasan, atau tahun ajaran yang masih punya rombel — lalu meninggalkan
// baris yatim yang lenyap dari setiap daftar yang memakai JOIN. Daftar ini
// dieja DUA KALI dan wajib sama: di sini dan `*_USAGE` di `academic.rs`.
export const ACADEMIC_USAGE = {
  year: [
    [
      "SELECT COUNT(*) AS n FROM akademik_rombel WHERE id_tahun_ajaran = ?;",
      "rombel",
    ],
    [
      "SELECT COUNT(*) AS n FROM presensi_mapel WHERE id_tahun_ajaran = ?;",
      "sesi presensi kelas",
    ],
  ],
  department: [
    [
      "SELECT COUNT(*) AS n FROM akademik_rombel WHERE id_jurusan = ?;",
      "rombel",
    ],
  ],
  // Dicocokkan dengan NAMA unit, bukan id: `master_data.unit` menyimpan nama
  // supaya nilainya sama di semua perangkat. Pemanggilnya menukar id menjadi
  // nama lebih dulu.
  unit: [["SELECT COUNT(*) AS n FROM master_data WHERE unit = ?;", "personil"]],
  class: [
    ["SELECT COUNT(*) AS n FROM siswa_data WHERE id_rombel = ?;", "siswa"],
    [
      "SELECT COUNT(*) AS n FROM akademik_guru_mapel WHERE id_rombel = ?;",
      "penugasan guru",
    ],
    [
      "SELECT COUNT(*) AS n FROM presensi_mapel WHERE id_rombel = ?;",
      "sesi presensi kelas",
    ],
  ],
  subject: [
    [
      "SELECT COUNT(*) AS n FROM akademik_guru_mapel WHERE id_mapel = ?;",
      "penugasan guru",
    ],
    [
      "SELECT COUNT(*) AS n FROM presensi_mapel WHERE id_mapel = ?;",
      "sesi presensi kelas",
    ],
  ],
} as const satisfies Record<string, ReadonlyArray<readonly [string, string]>>;

export async function assertAcademicUnused(
  label: string,
  checks: ReadonlyArray<readonly [string, string]>,
  id: string,
  hint: string,
) {
  // Satu `batch` read-only, bukan satu `execute` per pemeriksaan: setiap
  // pemeriksaan adalah round-trip jaringan ke Turso, dan menghapus satu entitas
  // akademik melakukan dua sampai lima di antaranya secara berurutan. Urutan
  // hasilnya dijamin sama dengan urutan `checks`, jadi susunan alasannya —
  // yang ikut tampil di pesan error — tidak berubah.
  const hasil = await db.batch(
    checks.map(([sql]) => ({ sql, args: [id] })),
    "read",
  );
  const reasons: string[] = [];
  checks.forEach(([, noun], index) => {
    const count = Number(hasil[index]?.rows[0]?.n ?? 0);
    if (count > 0) reasons.push(`${count} ${noun}`);
  });
  if (reasons.length > 0) {
    throw new ApiRequestError(
      `${label} tidak dapat dihapus karena masih dipakai: ${reasons.join(", ")}. ${hint}`,
      409,
    );
  }
}
