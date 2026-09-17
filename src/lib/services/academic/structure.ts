import "server-only";

import { db, ensureDbInitialized } from "@/lib/db";
import { ApiRequestError } from "@/lib/server/http/api-response";
import {
  ACADEMIC_USAGE,
  assertAcademicUnused,
  assertUniqueValue,
} from "./shared";

/**
 * Struktur akademik: tahun ajaran, unit, jurusan, rombel, mata pelajaran, dan penugasan guru.
 *
 * Dipecah dari `services/academic.ts` yang tumbuh sampai 1.434 baris berisi
 * sepuluh entitas. Jalur impornya TIDAK berubah — `@/lib/services/academic`
 * kini sebuah direktori dengan `index.ts` sebagai barelnya, sehingga 22 route
 * handler yang mengimpornya tidak perlu disentuh sama sekali.
 */

// ── 1. Tahun Ajaran ─────────────────────────────────────────────────────────

export async function getAcademicYears() {
  await ensureDbInitialized();
  const res = await db.execute(`
    SELECT id_tahun_ajaran, nama_tahun, semester, tanggal_mulai, tanggal_selesai,
           is_aktif, created_at, updated_at
    FROM akademik_tahun_ajaran
    ORDER BY tanggal_mulai DESC;
  `);
  return res.rows;
}

export async function saveAcademicYear(draft: {
  id_tahun_ajaran?: string;
  nama_tahun: string;
  semester: "Ganjil" | "Genap";
  tanggal_mulai: string;
  tanggal_selesai: string;
  is_aktif?: number;
}) {
  await ensureDbInitialized();
  const id =
    draft.id_tahun_ajaran || `ta_${crypto.randomUUID().replace(/-/g, "")}`;
  const isAktif = draft.is_aktif ? 1 : 0;

  // Satu batch "write": penonaktifan tahun lain dan penyimpanan tahun ini harus
  // berhasil atau gagal bersama — kegagalan di antaranya meninggalkan sekolah
  // TANPA satu pun tahun ajaran aktif.
  const statements = [
    {
      sql: `
      INSERT INTO akademik_tahun_ajaran (
        id_tahun_ajaran, nama_tahun, semester, tanggal_mulai, tanggal_selesai,
        is_aktif, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
      ON CONFLICT(id_tahun_ajaran) DO UPDATE SET
        nama_tahun = excluded.nama_tahun,
        semester = excluded.semester,
        tanggal_mulai = excluded.tanggal_mulai,
        tanggal_selesai = excluded.tanggal_selesai,
        is_aktif = excluded.is_aktif,
        updated_at = excluded.updated_at;
    `,
      args: [
        id,
        draft.nama_tahun,
        draft.semester,
        draft.tanggal_mulai,
        draft.tanggal_selesai,
        isAktif,
      ] as (string | number)[],
    },
  ];

  // Menonaktifkan SESUDAH menyimpan, dan hanya yang lain — urutan ini membuat
  // hasilnya sama dengan yang ditegakkan handler sinkronisasi di `turso.rs`.
  if (isAktif === 1) {
    statements.push({
      sql: "UPDATE akademik_tahun_ajaran SET is_aktif = 0 WHERE id_tahun_ajaran <> ? AND is_aktif = 1;",
      args: [id],
    });
  }

  await db.batch(statements, "write");

  return { sukses: true, id_tahun_ajaran: id };
}

export async function deleteAcademicYear(id: string) {
  await ensureDbInitialized();
  const aktif = await db.execute({
    sql: "SELECT COUNT(*) AS n FROM akademik_tahun_ajaran WHERE id_tahun_ajaran = ? AND is_aktif = 1;",
    args: [id],
  });
  if (Number(aktif.rows[0]?.n ?? 0) > 0) {
    throw new ApiRequestError(
      "Tahun ajaran aktif tidak dapat dihapus. Aktifkan tahun ajaran lain lebih dulu.",
      409,
    );
  }
  await assertAcademicUnused(
    "Tahun ajaran",
    ACADEMIC_USAGE.year,
    id,
    "Hapus atau pindahkan data yang memakainya lebih dulu.",
  );
  await db.execute({
    sql: "DELETE FROM akademik_tahun_ajaran WHERE id_tahun_ajaran = ?;",
    args: [id],
  });
  return { sukses: true };
}

export async function setActiveAcademicYear(id: string) {
  await ensureDbInitialized();
  await db.batch(
    [
      {
        sql: "UPDATE akademik_tahun_ajaran SET is_aktif = 1, updated_at = datetime('now') WHERE id_tahun_ajaran = ?;",
        args: [id],
      },
      {
        sql: "UPDATE akademik_tahun_ajaran SET is_aktif = 0 WHERE id_tahun_ajaran <> ? AND is_aktif = 1;",
        args: [id],
      },
    ],
    "write",
  );
  return { sukses: true };
}

// ── 1b. Unit satuan pendidikan ──────────────────────────────────────────────
//
// Dipakai sebagai dropdown di formulir peserta didik, guru/PTK, dan karyawan.
// `master_data.unit` menyimpan NAMA unit, bukan `id_unit`, supaya nilainya
// berarti sama di setiap perangkat; karena itu mengganti nama sebuah unit ikut
// memindahkan personil yang memakainya, dan itu dikerjakan dalam satu batch.

export async function getAcademicUnits() {
  await ensureDbInitialized();
  const res = await db.execute(`
    SELECT id_unit, nama_unit, keterangan, urutan, status_aktif
    FROM akademik_unit
    ORDER BY urutan ASC, nama_unit ASC;
  `);
  return res.rows;
}

export async function saveAcademicUnit(draft: {
  id_unit?: string;
  nama_unit: string;
  keterangan?: string | null;
  urutan?: number;
  status_aktif?: number;
}) {
  await ensureDbInitialized();
  const nama = draft.nama_unit?.trim() ?? "";
  if (!nama) {
    throw new ApiRequestError("Nama unit wajib diisi.", 400);
  }
  const id = draft.id_unit || `unt_${crypto.randomUUID().replace(/-/g, "")}`;
  await assertUniqueValue({
    table: "akademik_unit",
    column: "nama_unit",
    idColumn: "id_unit",
    value: nama,
    exceptId: id,
    message: "Nama unit ini sudah terdaftar.",
  });

  // Nama lama dibaca SEBELUM ditimpa: bila berubah, personil yang memakainya
  // ikut dipindahkan. Tanpa ini, mengganti "SMP" menjadi "SMP Islam" akan
  // meninggalkan setiap siswa menunjuk unit yang tidak ada lagi.
  const lama = await db.execute({
    sql: "SELECT nama_unit FROM akademik_unit WHERE id_unit = ?;",
    args: [id],
  });
  const namaLama = lama.rows[0]?.nama_unit
    ? String(lama.rows[0].nama_unit)
    : null;

  const now = new Date().toISOString();
  const statements = [
    {
      sql: `
        INSERT INTO akademik_unit (
          id_unit, nama_unit, keterangan, urutan, status_aktif, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id_unit) DO UPDATE SET
          nama_unit = excluded.nama_unit,
          keterangan = excluded.keterangan,
          urutan = excluded.urutan,
          status_aktif = excluded.status_aktif,
          updated_at = excluded.updated_at;
      `,
      args: [
        id,
        nama,
        draft.keterangan || null,
        draft.urutan ?? 0,
        draft.status_aktif ?? 1,
        now,
        now,
      ],
    },
  ];
  if (namaLama && namaLama !== nama) {
    statements.push({
      sql: "UPDATE master_data SET unit = ? WHERE unit = ?;",
      args: [nama, namaLama],
    });
  }
  await db.batch(statements, "write");

  return { sukses: true, id_unit: id };
}

export async function deleteAcademicUnit(id: string) {
  await ensureDbInitialized();
  const row = await db.execute({
    sql: "SELECT nama_unit FROM akademik_unit WHERE id_unit = ?;",
    args: [id],
  });
  const nama = row.rows[0]?.nama_unit ? String(row.rows[0].nama_unit) : null;
  if (nama) {
    await assertAcademicUnused(
      "Unit",
      ACADEMIC_USAGE.unit,
      nama,
      "Pindahkan personilnya ke unit lain, atau nonaktifkan unit ini saja.",
    );
  }
  await db.execute({
    sql: "DELETE FROM akademik_unit WHERE id_unit = ?;",
    args: [id],
  });
  return { sukses: true };
}

// ── 2. Jurusan ──────────────────────────────────────────────────────────────

export async function getAcademicDepartments() {
  await ensureDbInitialized();
  const res = await db.execute(`
    SELECT id_jurusan, kode_jurusan, nama_jurusan, deskripsi, is_aktif
    FROM akademik_jurusan
    ORDER BY kode_jurusan ASC;
  `);
  return res.rows;
}

export async function saveAcademicDepartment(draft: {
  id_jurusan?: string;
  kode_jurusan: string;
  nama_jurusan: string;
  deskripsi?: string | null;
  is_aktif?: number;
}) {
  await ensureDbInitialized();
  const id = draft.id_jurusan || `jur_${crypto.randomUUID().replace(/-/g, "")}`;
  await assertUniqueValue({
    table: "akademik_jurusan",
    column: "kode_jurusan",
    idColumn: "id_jurusan",
    value: draft.kode_jurusan,
    exceptId: id,
    message: "Kode jurusan sudah dipakai program keahlian lain.",
  });
  const isAktif = draft.is_aktif !== undefined ? draft.is_aktif : 1;

  await db.execute({
    sql: `
      INSERT INTO akademik_jurusan (id_jurusan, kode_jurusan, nama_jurusan, deskripsi, is_aktif)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(id_jurusan) DO UPDATE SET
        kode_jurusan = excluded.kode_jurusan,
        nama_jurusan = excluded.nama_jurusan,
        deskripsi = excluded.deskripsi,
        is_aktif = excluded.is_aktif;
    `,
    args: [
      id,
      draft.kode_jurusan,
      draft.nama_jurusan,
      draft.deskripsi || null,
      isAktif,
    ],
  });

  return { sukses: true, id_jurusan: id };
}

export async function deleteAcademicDepartment(id: string) {
  await ensureDbInitialized();
  await assertAcademicUnused(
    "Jurusan",
    ACADEMIC_USAGE.department,
    id,
    "Nonaktifkan jurusan ini saja.",
  );
  await db.execute({
    sql: "DELETE FROM akademik_jurusan WHERE id_jurusan = ?;",
    args: [id],
  });
  return { sukses: true };
}

// ── 3. Rombel (Kelas) ───────────────────────────────────────────────────────

export async function getAcademicClasses(id_tahun_ajaran?: string | null) {
  await ensureDbInitialized();
  const sql = `
    SELECT r.id_rombel, r.id_tahun_ajaran, r.tingkat, r.id_jurusan, r.nama_rombel,
           r.id_wali_kelas, r.kapasitas, r.ruang_kelas, r.is_aktif,
           j.nama_jurusan, j.kode_jurusan,
           w.nama AS nama_wali_kelas,
           (SELECT COUNT(*) FROM siswa_data s WHERE s.id_rombel = r.id_rombel AND s.status = 'Aktif') AS jumlah_siswa
    FROM akademik_rombel r
    LEFT JOIN akademik_jurusan j ON j.id_jurusan = r.id_jurusan
    LEFT JOIN master_data w ON w.id_unik = r.id_wali_kelas
    WHERE (? IS NULL OR r.id_tahun_ajaran = ?)
    ORDER BY r.tingkat ASC, r.nama_rombel ASC;
  `;
  const res = await db.execute({
    sql,
    args: [id_tahun_ajaran || null, id_tahun_ajaran || null],
  });
  return res.rows;
}

export async function saveAcademicClass(draft: {
  id_rombel?: string;
  id_tahun_ajaran: string;
  tingkat: number;
  id_jurusan?: string | null;
  nama_rombel: string;
  id_wali_kelas?: string | null;
  kapasitas?: number;
  ruang_kelas?: string | null;
  is_aktif?: number;
}) {
  await ensureDbInitialized();
  const id = draft.id_rombel || `rom_${crypto.randomUUID().replace(/-/g, "")}`;
  const isAktif = draft.is_aktif !== undefined ? draft.is_aktif : 1;
  const kapasitas = draft.kapasitas || 36;

  await db.execute({
    sql: `
      INSERT INTO akademik_rombel (
        id_rombel, id_tahun_ajaran, tingkat, id_jurusan, nama_rombel,
        id_wali_kelas, kapasitas, ruang_kelas, is_aktif
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id_rombel) DO UPDATE SET
        id_tahun_ajaran = excluded.id_tahun_ajaran,
        tingkat = excluded.tingkat,
        id_jurusan = excluded.id_jurusan,
        nama_rombel = excluded.nama_rombel,
        id_wali_kelas = excluded.id_wali_kelas,
        kapasitas = excluded.kapasitas,
        ruang_kelas = excluded.ruang_kelas,
        is_aktif = excluded.is_aktif;
    `,
    args: [
      id,
      draft.id_tahun_ajaran,
      draft.tingkat,
      draft.id_jurusan || null,
      draft.nama_rombel,
      draft.id_wali_kelas || null,
      kapasitas,
      draft.ruang_kelas || null,
      isAktif,
    ],
  });

  return { sukses: true, id_rombel: id };
}

export async function deleteAcademicClass(id: string) {
  await ensureDbInitialized();
  await assertAcademicUnused(
    "Rombel",
    ACADEMIC_USAGE.class,
    id,
    "Nonaktifkan rombel ini saja.",
  );
  await db.execute({
    sql: "DELETE FROM akademik_rombel WHERE id_rombel = ?;",
    args: [id],
  });
  return { sukses: true };
}

// ── 4. Mata Pelajaran (Mapel) ───────────────────────────────────────────────

export async function getAcademicSubjects() {
  await ensureDbInitialized();
  const res = await db.execute(`
    SELECT id_mapel, kode_mapel, nama_mapel, tingkat, kelompok, beban_jam, kkm, is_aktif
    FROM akademik_mapel
    ORDER BY kode_mapel ASC;
  `);
  return res.rows;
}

export async function saveAcademicSubject(draft: {
  id_mapel?: string;
  kode_mapel: string;
  nama_mapel: string;
  tingkat?: number | null;
  kelompok?: "Wajib" | "Peminatan" | "Muatan Lokal" | "Kejuruan";
  beban_jam?: number;
  kkm?: number;
  is_aktif?: number;
}) {
  await ensureDbInitialized();
  const id = draft.id_mapel || `map_${crypto.randomUUID().replace(/-/g, "")}`;
  await assertUniqueValue({
    table: "akademik_mapel",
    column: "kode_mapel",
    idColumn: "id_mapel",
    value: draft.kode_mapel,
    exceptId: id,
    message: "Kode mata pelajaran sudah dipakai mapel lain.",
  });
  const kelompok = draft.kelompok || "Wajib";
  const beban = draft.beban_jam || 2;
  const kkm = draft.kkm || 75;
  const isAktif = draft.is_aktif !== undefined ? draft.is_aktif : 1;

  await db.execute({
    sql: `
      INSERT INTO akademik_mapel (
        id_mapel, kode_mapel, nama_mapel, tingkat, kelompok, beban_jam, kkm, is_aktif
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id_mapel) DO UPDATE SET
        kode_mapel = excluded.kode_mapel,
        nama_mapel = excluded.nama_mapel,
        tingkat = excluded.tingkat,
        kelompok = excluded.kelompok,
        beban_jam = excluded.beban_jam,
        kkm = excluded.kkm,
        is_aktif = excluded.is_aktif;
    `,
    args: [
      id,
      draft.kode_mapel,
      draft.nama_mapel,
      draft.tingkat || null,
      kelompok,
      beban,
      kkm,
      isAktif,
    ],
  });

  return { sukses: true, id_mapel: id };
}

export async function deleteAcademicSubject(id: string) {
  await ensureDbInitialized();
  await assertAcademicUnused(
    "Mata pelajaran",
    ACADEMIC_USAGE.subject,
    id,
    "Nonaktifkan mata pelajaran ini saja.",
  );
  await db.execute({
    sql: "DELETE FROM akademik_mapel WHERE id_mapel = ?;",
    args: [id],
  });
  return { sukses: true };
}

// ── 5. Penugasan Guru Mapel (Akademik Guru Mapel) ───────────────────────────

export async function getAcademicAssignments(id_rombel?: string | null) {
  await ensureDbInitialized();
  const sql = `
    SELECT gm.id_penugasan, gm.id_tahun_ajaran, gm.id_rombel, gm.id_mapel, gm.id_guru,
           m.nama_mapel, m.kode_mapel, m.kelompok, m.beban_jam,
           r.nama_rombel, r.tingkat,
           g.nip, g.gelar,
           p.nama AS nama_guru
    FROM akademik_guru_mapel gm
    JOIN akademik_mapel m ON m.id_mapel = gm.id_mapel
    JOIN akademik_rombel r ON r.id_rombel = gm.id_rombel
    JOIN guru_data g ON g.id_guru = gm.id_guru
    LEFT JOIN master_data p ON p.id_unik = gm.id_guru
    WHERE (? IS NULL OR gm.id_rombel = ?)
    ORDER BY r.nama_rombel ASC, m.nama_mapel ASC;
  `;
  const res = await db.execute({
    sql,
    args: [id_rombel || null, id_rombel || null],
  });
  return res.rows;
}

export async function saveAcademicAssignment(draft: {
  id_penugasan?: string;
  id_tahun_ajaran: string;
  id_rombel: string;
  id_mapel: string;
  id_guru: string;
}) {
  await ensureDbInitialized();
  const id =
    draft.id_penugasan || `gm_${crypto.randomUUID().replace(/-/g, "")}`;

  // Dulu dijaga `UNIQUE (id_tahun_ajaran, id_rombel, id_mapel)` — lihat
  // `assertUniqueValue` untuk alasan pemindahannya ke lapisan aplikasi.
  const bentrok = await db.execute({
    sql: `SELECT 1 FROM akademik_guru_mapel
          WHERE id_tahun_ajaran = ? AND id_rombel = ? AND id_mapel = ?
            AND id_penugasan <> ? LIMIT 1;`,
    args: [draft.id_tahun_ajaran, draft.id_rombel, draft.id_mapel, id],
  });
  if (bentrok.rows.length > 0) {
    throw new ApiRequestError(
      "Mata pelajaran ini sudah punya pengampu di rombel tersebut pada tahun ajaran yang sama.",
      409,
    );
  }

  await db.execute({
    sql: `
      INSERT INTO akademik_guru_mapel (id_penugasan, id_tahun_ajaran, id_rombel, id_mapel, id_guru)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(id_penugasan) DO UPDATE SET
        id_tahun_ajaran = excluded.id_tahun_ajaran,
        id_rombel = excluded.id_rombel,
        id_mapel = excluded.id_mapel,
        id_guru = excluded.id_guru;
    `,
    args: [
      id,
      draft.id_tahun_ajaran,
      draft.id_rombel,
      draft.id_mapel,
      draft.id_guru,
    ],
  });

  return { sukses: true, id_penugasan: id };
}

export async function deleteAcademicAssignment(id: string) {
  await ensureDbInitialized();
  await db.execute({
    sql: "DELETE FROM akademik_guru_mapel WHERE id_penugasan = ?;",
    args: [id],
  });
  return { sukses: true };
}
