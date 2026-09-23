import type { InStatement, ResultSet } from "@libsql/client";
import type { PermissionKey } from "@/lib/rbac/catalog";

/**
 * Jenis personil pemilik sebuah foto, penentu izin yang berlaku atasnya.
 *
 * Dulu Desktop/Mobile menerima izin karyawan, guru, ATAU siswa untuk personil
 * mana pun (admin siswa bisa mengganti foto karyawan), sementara Web hanya
 * menerima izin karyawan (admin guru ditolak). Kini izinnya mengikuti jenis
 * personil pemilik foto. Cerminan `PersonnelKind` di `academic.rs`, diuji
 * dengan vektor yang sama.
 */
export type JenisPersonilFoto = "karyawan" | "guru" | "siswa";

/**
 * `jenis_personil` tersimpan dengan ejaan berbeda-beda (`'SISWA'`, `'Siswa'`,
 * `'Pegawai'`), jadi WAJIB dibandingkan setelah dinormalkan.
 */
export function jenisDariLabel(label: unknown): JenisPersonilFoto {
  const normal = String(label ?? "")
    .trim()
    .toLowerCase();
  if (normal === "siswa") return "siswa";
  if (normal === "guru") return "guru";
  return "karyawan";
}

/** Izin untuk menyimpan atau menghapus foto. */
export function izinKelolaFoto(jenis: JenisPersonilFoto): PermissionKey {
  if (jenis === "siswa") return "students.manage";
  if (jenis === "guru") return "teachers.manage";
  return "employees.manage";
}

/**
 * Salah satu izin ini cukup untuk MELIHAT foto. `employees.manage` ikut karena
 * halaman kartu identitas mencetak kartu seluruh personil.
 */
export function izinLihatFoto(jenis: JenisPersonilFoto): PermissionKey[] {
  if (jenis === "siswa") {
    return ["students.view", "students.manage", "employees.manage"];
  }
  if (jenis === "guru") {
    return ["teachers.view", "teachers.manage", "employees.manage"];
  }
  return ["employees.view", "employees.manage"];
}

/** Izin yang cukup untuk membaca STATUS "punya foto" pada daftar personil. */
export const IZIN_STATUS_FOTO: PermissionKey[] = [
  "employees.view",
  "teachers.view",
  "students.view",
  "employees.manage",
  "teachers.manage",
  "students.manage",
];

/** `Client` maupun `Transaction` libSQL. */
interface SqlExecutor {
  execute(statement: InStatement): Promise<ResultSet>;
}

/**
 * Jenis personil pemilik `idUnik` menurut database. Baris `siswa_data` /
 * `guru_data` menjadi cadangan untuk personil lama yang `jenis_personil`-nya
 * kosong. ID yang tidak dikenal diperlakukan sebagai karyawan. Cerminan
 * `personnel_kind` di `academic.rs`.
 */
export async function jenisFotoPersonil(
  executor: SqlExecutor,
  idUnik: string,
): Promise<JenisPersonilFoto> {
  const result = await executor.execute({
    sql: `SELECT CASE
            WHEN LOWER(TRIM(COALESCE(m.jenis_personil, ''))) = 'siswa'
              OR EXISTS(SELECT 1 FROM siswa_data s WHERE s.id_siswa = ?1) THEN 'siswa'
            WHEN LOWER(TRIM(COALESCE(m.jenis_personil, ''))) = 'guru'
              OR EXISTS(SELECT 1 FROM guru_data g WHERE g.id_guru = ?1) THEN 'guru'
            ELSE 'karyawan' END AS jenis
          FROM (SELECT ?1 AS id) x LEFT JOIN master_data m ON m.id_unik = x.id;`,
    args: [idUnik.trim()],
  });
  return jenisDariLabel(result.rows[0]?.jenis);
}
