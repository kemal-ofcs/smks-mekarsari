import "server-only";

import { db, ensureDbInitialized } from "@/lib/db";
import { ApiRequestError } from "@/lib/server/http/api-response";
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
 * Jadwal akademik: jam pelajaran (bel sekolah) dan jadwal mengajar mingguan.
 *
 * Dipecah dari `services/academic.ts` yang tumbuh sampai 1.434 baris berisi
 * sepuluh entitas. Jalur impornya TIDAK berubah — `@/lib/services/academic`
 * kini sebuah direktori dengan `index.ts` sebagai barelnya, sehingga 22 route
 * handler yang mengimpornya tidak perlu disentuh sama sekali.
 */

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
