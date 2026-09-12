import "server-only";

import { db, ensureDbInitialized } from "@/lib/db";
import { normalizeOperatorPhone } from "@/lib/operators/contact";
import { ApiRequestError } from "@/lib/server/http/api-response";
import { generateRandomToken } from "@/lib/services/employee";
import {
  JENIS_JAM_PELAJARAN,
  type JenisJamPelajaran,
  JP_MAX_PER_DAY_SETTING_KEY,
  jamKeBeririsan,
  normalizeJamBel,
  normalizeJamKe,
  parseJpMaxPerDay,
} from "@/lib/validations/class-attendance";

/**
 * Nomor WhatsApp wali murid, dinormalkan ke bentuk kanonik `+62…`.
 *
 * Memakai normalizer yang SAMA dengan kontak operator — aturannya hidup di satu
 * tempat (`@/lib/operators/contact`) dan punya cerminan Rust yang diuji. Tanpa
 * ini satu nomor bisa tersimpan sebagai `0812…`, `62812…`, dan `+62 812-…`
 * sekaligus, dan tautan `wa.me` tidak selalu terbuka.
 */
function normalizeWaliPhone(value: string | null | undefined) {
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
async function assertUniqueValue(spec: {
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
async function chosenShift(idShift: unknown): Promise<number | null> {
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
async function ensureScanToken(idUnik: string) {
  const existing = await db.execute({
    sql: "SELECT token_absensi FROM master_data WHERE id_unik = ?;",
    args: [idUnik],
  });
  const current = String(existing.rows[0]?.token_absensi ?? "").trim();
  const token = current || generateRandomToken(10);
  return { token, qrCode: `${idUnik}|${token}` };
}

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

// ── Penjaga penghapusan master ──────────────────────────────────────────────
//
// Tabel `akademik_*` TIDAK punya FOREIGN KEY, jadi database menerima
// penghapusan rombel yang masih berisi siswa, mapel yang masih punya
// penugasan, atau tahun ajaran yang masih punya rombel — lalu meninggalkan
// baris yatim yang lenyap dari setiap daftar yang memakai JOIN. Daftar ini
// dieja DUA KALI dan wajib sama: di sini dan `*_USAGE` di `academic.rs`.
const ACADEMIC_USAGE = {
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

async function assertAcademicUnused(
  label: string,
  checks: ReadonlyArray<readonly [string, string]>,
  id: string,
  hint: string,
) {
  const reasons: string[] = [];
  for (const [sql, noun] of checks) {
    const res = await db.execute({ sql, args: [id] });
    const count = Number(res.rows[0]?.n ?? 0);
    if (count > 0) reasons.push(`${count} ${noun}`);
  }
  if (reasons.length > 0) {
    throw new ApiRequestError(
      `${label} tidak dapat dihapus karena masih dipakai: ${reasons.join(", ")}. ${hint}`,
      409,
    );
  }
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

// ── 6. Guru (PTK) ───────────────────────────────────────────────────────────

export async function getTeachers() {
  await ensureDbInitialized();
  const sql = `
    SELECT g.id_guru, g.nip, g.nuptk, g.gelar, g.spesialisasi_mapel, g.status_kepegawaian,
           g.created_at, g.updated_at,
           m.kode_karyawan, m.nama, m.divisi, m.jabatan_status, m.no_hp, m.lp,
           m.status_aktif, m.id_shift, m.token_absensi, m.qr_code, m.status_qr
    FROM guru_data g
    JOIN master_data m ON m.id_unik = g.id_guru
    ORDER BY m.nama ASC;
  `;
  const res = await db.execute(sql);
  return res.rows;
}

export async function saveTeacher(draft: {
  id_guru?: string;
  nama: string;
  kode_karyawan?: string;
  nip?: string | null;
  nuptk?: string | null;
  gelar?: string | null;
  spesialisasi_mapel?: string | null;
  status_kepegawaian?: string | null;
  no_hp?: string | null;
  lp?: string | null;
  id_shift?: number;
  status_aktif?: string;
}) {
  await ensureDbInitialized();
  const id = draft.id_guru || `ptk_${crypto.randomUUID().replace(/-/g, "")}`;
  const statusAktif = draft.status_aktif || "Aktif";
  const kode = draft.kode_karyawan || draft.nip || `G-${id.slice(4, 10)}`;
  // `master_data.kode_karyawan` MASIH UNIQUE (skema lama, tidak diubah).
  await assertUniqueValue({
    table: "master_data",
    column: "kode_karyawan",
    idColumn: "id_unik",
    value: kode,
    exceptId: id,
    message: "Kode personil/NIP ini sudah dipakai orang lain di data induk.",
  });
  const idShift = await chosenShift(draft.id_shift);
  const { token, qrCode } = await ensureScanToken(id);

  // Kedua tulisan dijalankan sebagai satu batch "write": kegagalan di tengah
  // akan meninggalkan baris `master_data` yatim yang bisa scan di gerbang tanpa
  // profil PTK sama sekali.
  await db.batch(
    [
      {
        sql: `
      INSERT INTO master_data (
        id_unik, kode_karyawan, nama, divisi, jabatan_status, no_hp, lp,
        id_shift, status_aktif, tanggal_daftar, catatan, token_absensi, qr_code,
        status_qr, jenis_personil, status_backup
      ) VALUES (?, ?, ?, 'Tenaga Pengajar', 'Guru', ?, ?, COALESCE(?, 1), ?, date('now','+7 hours'), 'Data PTK Sekolah', ?, ?, 'Generated', 'GURU', 'NORMAL')
      ON CONFLICT(id_unik) DO UPDATE SET
        kode_karyawan = excluded.kode_karyawan,
        nama = excluded.nama,
        no_hp = excluded.no_hp,
        lp = excluded.lp,
        id_shift = COALESCE(?, master_data.id_shift),
        status_aktif = excluded.status_aktif,
        token_absensi = excluded.token_absensi,
        qr_code = excluded.qr_code,
        status_qr = excluded.status_qr,
        jenis_personil = 'GURU';
    `,
        args: [
          id,
          kode,
          draft.nama,
          draft.no_hp || null,
          draft.lp || "L",
          idShift,
          statusAktif,
          token,
          qrCode,
          idShift,
        ],
      },
      {
        sql: `
      INSERT INTO guru_data (
        id_guru, nip, nuptk, gelar, spesialisasi_mapel, status_kepegawaian, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
      ON CONFLICT(id_guru) DO UPDATE SET
        nip = excluded.nip,
        nuptk = excluded.nuptk,
        gelar = excluded.gelar,
        spesialisasi_mapel = excluded.spesialisasi_mapel,
        status_kepegawaian = excluded.status_kepegawaian,
        updated_at = excluded.updated_at;
    `,
        args: [
          id,
          draft.nip || null,
          draft.nuptk || null,
          draft.gelar || null,
          draft.spesialisasi_mapel || null,
          draft.status_kepegawaian || "Honorer",
        ],
      },
      {
        sql: `
      INSERT INTO id_card (id_unik, nama, divisi, idcard_status, tanggal_generate)
      SELECT ?, ?, 'Tenaga Pengajar', 'Belum', date('now','+7 hours')
      WHERE NOT EXISTS (SELECT 1 FROM id_card WHERE id_unik = ?);
    `,
        args: [id, draft.nama, id],
      },
      {
        sql: "UPDATE id_card SET nama = ?, divisi = 'Tenaga Pengajar' WHERE id_unik = ?;",
        args: [draft.nama, id],
      },
    ],
    "write",
  );

  return { sukses: true, id_guru: id };
}

export async function deleteTeacher(id: string) {
  await ensureDbInitialized();
  // Profil dihapus dan identitas gerbangnya dinonaktifkan dalam satu batch:
  // kegagalan di antara keduanya menyisakan baris `master_data` yang masih
  // `Aktif` sehingga orangnya tetap diterima terminal pemindai.
  await db.batch(
    [
      {
        sql: "DELETE FROM guru_data WHERE id_guru = ?;",
        args: [id],
      },
      {
        sql: "UPDATE master_data SET status_aktif = 'Nonaktif' WHERE id_unik = ?;",
        args: [id],
      },
    ],
    "write",
  );
  return { sukses: true };
}

// ── 7. Siswa ────────────────────────────────────────────────────────────────

export async function getStudents(id_rombel?: string | null) {
  await ensureDbInitialized();
  const sql = `
    SELECT s.id_siswa, s.nis, s.nisn, s.nama_lengkap, s.jenis_kelamin, s.id_rombel,
           s.nama_wali, s.no_whatsapp_wali, s.alamat, s.angkatan, s.status,
           s.created_at, s.updated_at,
           r.nama_rombel, r.tingkat,
           m.token_absensi, m.qr_code, m.status_qr, m.id_shift
    FROM siswa_data s
    JOIN akademik_rombel r ON r.id_rombel = s.id_rombel
    LEFT JOIN master_data m ON m.id_unik = s.id_siswa
    WHERE (? IS NULL OR s.id_rombel = ?)
    ORDER BY s.nama_lengkap ASC;
  `;
  const res = await db.execute({
    sql,
    args: [id_rombel || null, id_rombel || null],
  });
  return res.rows;
}

export async function saveStudent(draft: {
  id_siswa?: string;
  nama_lengkap: string;
  nis?: string | null;
  nisn?: string | null;
  jenis_kelamin?: "L" | "P";
  id_rombel: string;
  nama_wali?: string | null;
  no_whatsapp_wali?: string | null;
  alamat?: string | null;
  angkatan?: number;
  status?: string;
  id_shift?: number;
}) {
  await ensureDbInitialized();
  const id = draft.id_siswa || `sis_${crypto.randomUUID().replace(/-/g, "")}`;
  const kode = draft.nis || `S-${id.slice(4, 10)}`;
  await assertUniqueValue({
    table: "siswa_data",
    column: "nis",
    idColumn: "id_siswa",
    value: draft.nis,
    exceptId: id,
    message: "NIS sudah dipakai siswa lain.",
  });
  await assertUniqueValue({
    table: "siswa_data",
    column: "nisn",
    idColumn: "id_siswa",
    value: draft.nisn,
    exceptId: id,
    message: "NISN sudah dipakai siswa lain.",
  });
  await assertUniqueValue({
    table: "master_data",
    column: "kode_karyawan",
    idColumn: "id_unik",
    value: kode,
    exceptId: id,
    message: "NIS ini sudah dipakai sebagai kode personil lain di data induk.",
  });
  const status = draft.status || "Aktif";
  const idShift = await chosenShift(draft.id_shift);
  const { token, qrCode } = await ensureScanToken(id);

  // Satu batch "write" seperti pada guru — lihat alasannya di `saveTeacher`.
  await db.batch(
    [
      {
        sql: `
      INSERT INTO master_data (
        id_unik, kode_karyawan, nama, divisi, jabatan_status, lp,
        id_shift, status_aktif, tanggal_daftar, catatan, token_absensi, qr_code,
        status_qr, jenis_personil, status_backup
      ) VALUES (?, ?, ?, 'Peserta Didik', 'Siswa', ?, COALESCE(?, 1), ?, date('now','+7 hours'), 'Data Siswa Sekolah', ?, ?, 'Generated', 'SISWA', 'NORMAL')
      ON CONFLICT(id_unik) DO UPDATE SET
        kode_karyawan = excluded.kode_karyawan,
        nama = excluded.nama,
        lp = excluded.lp,
        id_shift = COALESCE(?, master_data.id_shift),
        status_aktif = excluded.status_aktif,
        token_absensi = excluded.token_absensi,
        qr_code = excluded.qr_code,
        status_qr = excluded.status_qr,
        jenis_personil = 'SISWA';
    `,
        args: [
          id,
          kode,
          draft.nama_lengkap,
          draft.jenis_kelamin || "L",
          idShift,
          status === "Aktif" ? "Aktif" : "Nonaktif",
          token,
          qrCode,
          idShift,
        ],
      },
      {
        sql: `
      INSERT INTO siswa_data (
        id_siswa, nis, nisn, nama_lengkap, jenis_kelamin, id_rombel,
        nama_wali, no_whatsapp_wali, alamat, angkatan, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
      ON CONFLICT(id_siswa) DO UPDATE SET
        nis = excluded.nis,
        nisn = excluded.nisn,
        nama_lengkap = excluded.nama_lengkap,
        jenis_kelamin = excluded.jenis_kelamin,
        id_rombel = excluded.id_rombel,
        nama_wali = excluded.nama_wali,
        no_whatsapp_wali = excluded.no_whatsapp_wali,
        alamat = excluded.alamat,
        angkatan = excluded.angkatan,
        status = excluded.status,
        updated_at = excluded.updated_at;
    `,
        args: [
          id,
          draft.nis || null,
          draft.nisn || null,
          draft.nama_lengkap,
          draft.jenis_kelamin || "L",
          draft.id_rombel,
          draft.nama_wali || null,
          normalizeWaliPhone(draft.no_whatsapp_wali),
          draft.alamat || null,
          draft.angkatan || 2026,
          status,
        ],
      },
      {
        sql: `
      INSERT INTO id_card (id_unik, nama, divisi, idcard_status, tanggal_generate)
      SELECT ?, ?, 'Peserta Didik', 'Belum', date('now','+7 hours')
      WHERE NOT EXISTS (SELECT 1 FROM id_card WHERE id_unik = ?);
    `,
        args: [id, draft.nama_lengkap, id],
      },
      {
        sql: "UPDATE id_card SET nama = ?, divisi = 'Peserta Didik' WHERE id_unik = ?;",
        args: [draft.nama_lengkap, id],
      },
    ],
    "write",
  );

  return { sukses: true, id_siswa: id };
}

export async function deleteStudent(id: string) {
  await ensureDbInitialized();
  // Profil dihapus dan identitas gerbangnya dinonaktifkan dalam satu batch:
  // kegagalan di antara keduanya menyisakan baris `master_data` yang masih
  // `Aktif` sehingga orangnya tetap diterima terminal pemindai.
  await db.batch(
    [
      {
        sql: "DELETE FROM siswa_data WHERE id_siswa = ?;",
        args: [id],
      },
      {
        sql: "UPDATE master_data SET status_aktif = 'Nonaktif' WHERE id_unik = ?;",
        args: [id],
      },
    ],
    "write",
  );
  return { sukses: true };
}

export async function backfillMissingIdCards() {
  await ensureDbInitialized();
  const result = await db.execute({
    sql: `
      INSERT INTO id_card (id_unik, nama, divisi, idcard_status, tanggal_generate)
      SELECT m.id_unik, m.nama, m.divisi, 'Belum', date('now','+7 hours')
      FROM master_data m
      WHERE m.status_aktif = 'Aktif'
        AND NOT EXISTS (SELECT 1 FROM id_card c WHERE c.id_unik = m.id_unik);
    `,
  });
  return { sukses: true, total_inserted: result.rowsAffected };
}

export async function saveStudentPhoto(data: {
  id_siswa: string;
  foto_base64: string;
  foto_mime?: string;
}) {
  await ensureDbInitialized();
  const idSiswa = data.id_siswa.trim();
  const fotoBase64 = data.foto_base64.trim();
  if (!idSiswa || !fotoBase64) {
    throw new ApiRequestError("ID Siswa dan foto wajib diisi.", 400);
  }
  if (fotoBase64.length > 512_000) {
    throw new ApiRequestError("Ukuran foto melebihi batas 500 KB.", 400);
  }
  const mime = (data.foto_mime || "image/jpeg").trim();
  await db.execute({
    sql: `
      INSERT INTO siswa_foto (id_siswa, foto_mime, foto_base64, updated_at)
      VALUES (?, ?, ?, datetime('now'))
      ON CONFLICT(id_siswa) DO UPDATE SET
        foto_mime = excluded.foto_mime,
        foto_base64 = excluded.foto_base64,
        updated_at = excluded.updated_at;
    `,
    args: [idSiswa, mime, fotoBase64],
  });
  return { sukses: true, id_siswa: idSiswa };
}

export async function getStudentPhoto(idSiswa: string) {
  await ensureDbInitialized();
  const result = await db.execute({
    sql: "SELECT id_siswa, foto_mime, foto_base64, updated_at FROM siswa_foto WHERE id_siswa = ? LIMIT 1;",
    args: [idSiswa],
  });
  if (result.rows.length === 0) return null;
  const row = result.rows[0];
  return {
    id_siswa: String(row.id_siswa),
    foto_mime: String(row.foto_mime),
    foto_base64: String(row.foto_base64),
    updated_at: String(row.updated_at),
  };
}

// ── 9. Jadwal Bel Sekolah (Jam Pelajaran) ───────────────────────────────────
//
// Tabel KETERANGAN: presensi kelas tetap menyimpan `jam_ke` dan honor tetap
// dihitung per jam pelajaran, jadi baris yang belum lengkap tidak pernah
// menghalangi presensi — layar hanya berhenti menampilkan pukulnya.

export async function getLessonPeriods() {
  await ensureDbInitialized();
  // Tanpa LIMIT: satu baris per jam pelajaran per hari sekolah — dibatasi
  // `jp_max_per_hari` ditambah beberapa baris istirahat, bukan oleh waktu.
  const res = await db.execute(
    `SELECT id_jam_pelajaran, jam_ke, jam_mulai, jam_selesai, jenis,
            COALESCE(keterangan, '') AS keterangan, is_aktif, created_at, updated_at
     FROM akademik_jam_pelajaran
     ORDER BY jam_ke, jam_mulai;`,
  );
  return res.rows;
}

export async function saveLessonPeriod(draft: {
  id_jam_pelajaran?: string;
  jam_ke: number;
  jam_mulai: string;
  jam_selesai: string;
  jenis?: JenisJamPelajaran;
  keterangan?: string | null;
  is_aktif?: number;
}) {
  await ensureDbInitialized();

  const jamMulai = normalizeJamBel(draft.jam_mulai);
  const jamSelesai = normalizeJamBel(draft.jam_selesai);
  if (jamMulai === null) {
    throw new ApiRequestError(
      "Jam mulai harus berbentuk jam, misalnya 07:00.",
      400,
    );
  }
  if (jamSelesai === null) {
    throw new ApiRequestError(
      "Jam selesai harus berbentuk jam, misalnya 07:45.",
      400,
    );
  }
  // Jam selesai yang lebih awal bukan sekadar salah ketik: ia membuat durasi
  // negatif di layar dan urutan bel yang tidak masuk akal. Bel yang melewati
  // tengah malam tidak didukung — sekolah tidak punya jam pelajaran seperti itu.
  if (jamSelesai <= jamMulai) {
    throw new ApiRequestError(
      "Jam selesai harus lebih lambat daripada jam mulai.",
      400,
    );
  }

  const jenis: JenisJamPelajaran = draft.jenis ?? "KBM";
  if (!JENIS_JAM_PELAJARAN.includes(jenis)) {
    throw new ApiRequestError("Jenis jam pelajaran tidak dikenal.", 400);
  }
  const isAktif = draft.is_aktif === 0 ? 0 : 1;

  const batasRow = await db.execute({
    sql: "SELECT value FROM setting_gex_system WHERE key = ? LIMIT 1;",
    args: [JP_MAX_PER_DAY_SETTING_KEY],
  });
  const batas = parseJpMaxPerDay(
    batasRow.rows[0] ? String(batasRow.rows[0].value ?? "") : null,
  );
  if (
    !Number.isInteger(draft.jam_ke) ||
    draft.jam_ke < 1 ||
    draft.jam_ke > batas
  ) {
    throw new ApiRequestError(
      `Jam pelajaran harus di antara 1 dan ${batas}, sesuai Pengaturan.`,
      400,
    );
  }

  const id =
    draft.id_jam_pelajaran?.trim() ||
    `jp_${crypto.randomUUID().replace(/-/g, "")}`;

  // Keunikan jam pelajaran ditegakkan di APLIKASI, bukan skema: tabelnya
  // sengaja tanpa UNIQUE supaya push dari perangkat offline tidak macet.
  if (isAktif === 1) {
    const bentrok = await db.execute({
      sql: `SELECT 1 FROM akademik_jam_pelajaran
            WHERE jam_ke = ? AND id_jam_pelajaran <> ? AND is_aktif = 1
            LIMIT 1;`,
      args: [draft.jam_ke, id],
    });
    if (bentrok.rows.length > 0) {
      throw new ApiRequestError(
        `Jam pelajaran ke-${draft.jam_ke} sudah terdaftar pada jadwal bel.`,
        409,
      );
    }
  }

  // Stempel waktu dihitung SQLite, bukan `new Date()`: satu baris bisa dibuat
  // Rust dan dibaca TypeScript.
  await db.execute({
    sql: `
      INSERT INTO akademik_jam_pelajaran (
        id_jam_pelajaran, jam_ke, jam_mulai, jam_selesai, jenis,
        keterangan, is_aktif, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
      ON CONFLICT(id_jam_pelajaran) DO UPDATE SET
        jam_ke = excluded.jam_ke,
        jam_mulai = excluded.jam_mulai,
        jam_selesai = excluded.jam_selesai,
        jenis = excluded.jenis,
        keterangan = excluded.keterangan,
        is_aktif = excluded.is_aktif,
        updated_at = datetime('now');
    `,
    args: [
      id,
      draft.jam_ke,
      jamMulai,
      jamSelesai,
      jenis,
      draft.keterangan?.trim() || null,
      isAktif,
    ],
  });

  return { sukses: true, id_jam_pelajaran: id };
}

export async function deleteLessonPeriod(id: string) {
  await ensureDbInitialized();
  // Tanpa pemeriksaan "sedang dipakai": jadwal bel hanya KETERANGAN, dan
  // presensi yang sudah tersimpan memegang `jam_ke`-nya sendiri.
  await db.execute({
    sql: "DELETE FROM akademik_jam_pelajaran WHERE id_jam_pelajaran = ?;",
    args: [id],
  });
  return { sukses: true };
}

// ── 10. Jadwal Mengajar Mingguan ────────────────────────────────────────────
//
// Tabel KETERANGAN: presensi kelas tetap bisa dicatat tanpa jadwal. Gunanya
// memberi tombol isi-cepat di layar presensi.

/**
 * Hari dari sebuah tanggal, 1=Senin sampai 7=Minggu.
 *
 * Dihitung SQLite (`strftime('%w')`, 0=Minggu), bukan di JavaScript: aritmetika
 * tanggal yang dieja dua kali adalah cara paling mudah membuat dua platform
 * tidak sepakat tentang hari apa sebuah tanggal itu. SQL-nya sama persis
 * dengan `WEEKDAY_SQL` di `academic.rs`.
 */
const WEEKDAY_SQL =
  "CASE WHEN strftime('%w', ?) = '0' THEN 7 ELSE CAST(strftime('%w', ?) AS INTEGER) END";

export async function getTeachingSchedules(filter?: {
  id_rombel?: string | null;
  id_tahun_ajaran?: string | null;
  id_guru?: string | null;
  tanggal?: string | null;
  hari?: number | null;
}) {
  await ensureDbInitialized();

  let hari = filter?.hari ?? null;
  if (hari === null && filter?.tanggal) {
    const res = await db.execute({
      sql: `SELECT ${WEEKDAY_SQL} AS hari;`,
      args: [filter.tanggal, filter.tanggal],
    });
    hari = res.rows[0] ? Number(res.rows[0].hari) : null;
  }

  // Tanpa LIMIT: jadwal mingguan sebesar jumlah rombel dikali jam pelajaran,
  // bukan tabel yang tumbuh setiap hari operasional.
  const res = await db.execute({
    sql: `
      SELECT j.id_jadwal, j.id_tahun_ajaran, j.id_rombel, j.id_mapel, j.id_guru,
             j.hari, j.jam_ke, j.is_aktif, j.created_at, j.updated_at,
             COALESCE(r.nama_rombel, '') AS nama_rombel,
             COALESCE(m.nama_mapel, '') AS nama_mapel,
             COALESCE(p.nama, '') AS nama_guru
      FROM jadwal_mengajar j
      LEFT JOIN akademik_rombel r ON r.id_rombel = j.id_rombel
      LEFT JOIN akademik_mapel m ON m.id_mapel = j.id_mapel
      LEFT JOIN master_data p ON p.id_unik = j.id_guru
      WHERE (? IS NULL OR j.id_rombel = ?)
        AND (? IS NULL OR j.id_tahun_ajaran = ?)
        AND (? IS NULL OR j.id_guru = ?)
        AND (? IS NULL OR j.hari = ?)
      ORDER BY j.hari, CAST(j.jam_ke AS INTEGER), j.jam_ke;
    `,
    args: [
      filter?.id_rombel ?? null,
      filter?.id_rombel ?? null,
      filter?.id_tahun_ajaran ?? null,
      filter?.id_tahun_ajaran ?? null,
      filter?.id_guru ?? null,
      filter?.id_guru ?? null,
      hari,
      hari,
    ],
  });
  return res.rows;
}

export async function saveTeachingSchedule(draft: {
  id_jadwal?: string;
  id_tahun_ajaran: string;
  id_rombel: string;
  id_mapel: string;
  id_guru: string;
  hari: number;
  jam_ke: string;
  is_aktif?: number;
}) {
  await ensureDbInitialized();

  if (
    !draft.id_tahun_ajaran ||
    !draft.id_rombel ||
    !draft.id_mapel ||
    !draft.id_guru
  ) {
    throw new ApiRequestError(
      "Tahun ajaran, rombel, mata pelajaran, dan guru wajib diisi.",
      400,
    );
  }
  if (!Number.isInteger(draft.hari) || draft.hari < 1 || draft.hari > 7) {
    throw new ApiRequestError(
      "Hari harus di antara 1 (Senin) dan 7 (Minggu).",
      400,
    );
  }

  // `jam_ke` memakai validator yang SAMA dengan presensi kelas.
  const jamKe = normalizeJamKe(draft.jam_ke);
  if (jamKe === null) {
    throw new ApiRequestError(
      `Jam pelajaran '${draft.jam_ke}' tidak valid. Gunakan angka atau rentang seperti 1-2.`,
      400,
    );
  }

  const id =
    draft.id_jadwal?.trim() || `jdw${crypto.randomUUID().replace(/-/g, "")}`;
  const isAktif = draft.is_aktif === 0 ? 0 : 1;

  // Bentrok dinilai dengan cakupan yang SAMA seperti presensi: rombel + mapel
  // + hari, bukan seluruh rombel — pelajaran Agama memang memecah satu rombel
  // pada jam yang sama. Cerminan `save_teaching_schedule` di `academic.rs`.
  if (isAktif === 1) {
    const lain = await db.execute({
      sql: `SELECT jam_ke FROM jadwal_mengajar
            WHERE id_tahun_ajaran = ? AND id_rombel = ? AND id_mapel = ?
              AND hari = ? AND is_aktif = 1 AND id_jadwal <> ?;`,
      args: [
        draft.id_tahun_ajaran,
        draft.id_rombel,
        draft.id_mapel,
        draft.hari,
        id,
      ],
    });
    const bentrok = lain.rows
      .map((row) => String(row.jam_ke ?? ""))
      .find((tersimpan) => jamKeBeririsan(jamKe, tersimpan));
    if (bentrok !== undefined) {
      throw new ApiRequestError(
        `Jadwal mapel ini pada hari tersebut sudah memakai jam ke-${bentrok}, yang beririsan dengan jam ke-${jamKe}.`,
        409,
      );
    }
  }

  await db.execute({
    sql: `
      INSERT INTO jadwal_mengajar (
        id_jadwal, id_tahun_ajaran, id_rombel, id_mapel, id_guru,
        hari, jam_ke, is_aktif, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
      ON CONFLICT(id_jadwal) DO UPDATE SET
        id_tahun_ajaran = excluded.id_tahun_ajaran,
        id_rombel = excluded.id_rombel,
        id_mapel = excluded.id_mapel,
        id_guru = excluded.id_guru,
        hari = excluded.hari,
        jam_ke = excluded.jam_ke,
        is_aktif = excluded.is_aktif,
        updated_at = datetime('now');
    `,
    args: [
      id,
      draft.id_tahun_ajaran,
      draft.id_rombel,
      draft.id_mapel,
      draft.id_guru,
      draft.hari,
      jamKe,
      isAktif,
    ],
  });

  return { sukses: true, id_jadwal: id };
}

export async function deleteTeachingSchedule(id: string) {
  await ensureDbInitialized();
  // Tanpa pemeriksaan "sedang dipakai": presensi yang sudah tersimpan memegang
  // rombel, mapel, guru, dan jamnya sendiri.
  await db.execute({
    sql: "DELETE FROM jadwal_mengajar WHERE id_jadwal = ?;",
    args: [id],
  });
  return { sukses: true };
}
