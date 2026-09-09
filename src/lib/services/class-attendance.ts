import "server-only";

import { db, ensureDbInitialized } from "@/lib/db";
import { ApiRequestError } from "@/lib/server/http/api-response";
import { MAX_JAM_KE, normalizeJamKe } from "@/lib/validations/class-attendance";

/**
 * Status awal roster SELALU "Hadir" — TIDAK PERNAH diturunkan dari scan gerbang.
 *
 * Cerminan `DEFAULT_ROSTER_STATUS` di `class_attendance.rs`; alasan lengkapnya
 * ada di sana. Ringkasnya: mengisi "Alfa" untuk siswa tanpa scan gerbang berarti
 * menghukum kartu yang tertinggal atau scanner yang mati. Alfa keliru mengalir
 * ke notifikasi wali dan catatan BK; Hadir keliru dikoreksi guru yang sedang
 * menatap kelasnya. Anomali TANPA_SCAN_GERBANG yang menjaring sisi sebaliknya.
 */
const DEFAULT_ROSTER_STATUS = "Hadir" as const;

const GATE_SUMMARY_SUBQUERY = `(
  SELECT
    id_karyawan,
    tanggal,
    MIN(NULLIF(TRIM(jam_masuk), '')) AS jam_masuk,
    MAX(CASE
      WHEN COALESCE(TRIM(jam_masuk), '') <> ''
       AND COALESCE(status_kehadiran, '') <> 'Alfa'
      THEN 1 ELSE 0
    END) AS hadir_gerbang,
    MAX(COALESCE(status_kehadiran, '')) AS status_kehadiran
  FROM absensi_harian
  GROUP BY id_karyawan, tanggal
)`;

export type ClassAttendanceSessionFilter = {
  id_tahun_ajaran?: string;
  id_rombel?: string;
  id_mapel?: string;
  id_guru?: string;
  tanggal?: string;
  start_date?: string;
  end_date?: string;
  limit?: number;
};

export type StudentAttendanceDraftItem = {
  id_siswa: string;
  status: "Hadir" | "Izin" | "Sakit" | "Alfa" | "Dispensasi";
  catatan?: string | null;
};

export type SaveClassAttendanceDraft = {
  id_presensi_mapel?: string;
  id_tahun_ajaran: string;
  id_rombel: string;
  id_mapel: string;
  id_guru: string;
  tanggal: string;
  jam_ke: string;
  materi_pokok?: string | null;
  catatan?: string | null;
  items: StudentAttendanceDraftItem[];
};

export async function getClassAttendanceSessions(
  filter?: ClassAttendanceSessionFilter,
) {
  await ensureDbInitialized();

  const idTahunAjaran = filter?.id_tahun_ajaran?.trim() || null;
  const idRombel = filter?.id_rombel?.trim() || null;
  const idMapel = filter?.id_mapel?.trim() || null;
  const idGuru = filter?.id_guru?.trim() || null;
  const tanggal = filter?.tanggal?.trim() || null;
  const startDate = filter?.start_date?.trim() || null;
  const endDate = filter?.end_date?.trim() || null;
  const limit = filter?.limit && filter.limit > 0 ? filter.limit : 100;

  const sql = `
    SELECT
      p.id_presensi_mapel,
      p.id_tahun_ajaran,
      COALESCE(ta.nama_tahun, '') AS nama_tahun,
      COALESCE(ta.semester, '') AS semester,
      p.id_rombel,
      COALESCE(r.nama_rombel, '') AS nama_rombel,
      COALESCE(r.tingkat, 0) AS tingkat,
      p.id_mapel,
      COALESCE(m.nama_mapel, '') AS nama_mapel,
      COALESCE(m.kode_mapel, '') AS kode_mapel,
      p.id_guru,
      COALESCE(g.nama, '') AS nama_guru,
      p.tanggal,
      p.jam_ke,
      p.materi_pokok,
      p.catatan,
      p.total_hadir,
      p.total_izin,
      p.total_sakit,
      p.total_alfa,
      p.total_dispensasi,
      p.created_at,
      p.updated_at
    FROM presensi_mapel p
    LEFT JOIN akademik_tahun_ajaran ta ON ta.id_tahun_ajaran = p.id_tahun_ajaran
    LEFT JOIN akademik_rombel r ON r.id_rombel = p.id_rombel
    LEFT JOIN akademik_mapel m ON m.id_mapel = p.id_mapel
    LEFT JOIN master_data g ON g.id_unik = p.id_guru
    WHERE (? IS NULL OR p.id_tahun_ajaran = ?)
      AND (? IS NULL OR p.id_rombel = ?)
      AND (? IS NULL OR p.id_mapel = ?)
      AND (? IS NULL OR p.id_guru = ?)
      AND (? IS NULL OR p.tanggal = ?)
      AND (? IS NULL OR p.tanggal >= ?)
      AND (? IS NULL OR p.tanggal <= ?)
    ORDER BY p.tanggal DESC, CAST(p.jam_ke AS INTEGER) ASC, p.jam_ke ASC, p.created_at DESC
    LIMIT ?;
  `;

  const res = await db.execute({
    sql,
    args: [
      idTahunAjaran,
      idTahunAjaran,
      idRombel,
      idRombel,
      idMapel,
      idMapel,
      idGuru,
      idGuru,
      tanggal,
      tanggal,
      startDate,
      startDate,
      endDate,
      endDate,
      limit,
    ],
  });

  return res.rows;
}

export async function getClassAttendanceDetail(idPresensiMapel: string) {
  await ensureDbInitialized();

  const sessionRes = await db.execute({
    sql: `
      SELECT
        p.id_presensi_mapel,
        p.id_tahun_ajaran,
        COALESCE(ta.nama_tahun, '') AS nama_tahun,
        COALESCE(ta.semester, '') AS semester,
        p.id_rombel,
        COALESCE(r.nama_rombel, '') AS nama_rombel,
        COALESCE(r.tingkat, 0) AS tingkat,
        p.id_mapel,
        COALESCE(m.nama_mapel, '') AS nama_mapel,
        COALESCE(m.kode_mapel, '') AS kode_mapel,
        p.id_guru,
        COALESCE(g.nama, '') AS nama_guru,
        p.tanggal,
        p.jam_ke,
        p.materi_pokok,
        p.catatan,
        p.total_hadir,
        p.total_izin,
        p.total_sakit,
        p.total_alfa,
        p.total_dispensasi,
        p.created_at,
        p.updated_at
      FROM presensi_mapel p
      LEFT JOIN akademik_tahun_ajaran ta ON ta.id_tahun_ajaran = p.id_tahun_ajaran
      LEFT JOIN akademik_rombel r ON r.id_rombel = p.id_rombel
      LEFT JOIN akademik_mapel m ON m.id_mapel = p.id_mapel
      LEFT JOIN master_data g ON g.id_unik = p.id_guru
      WHERE p.id_presensi_mapel = ?
      LIMIT 1;
    `,
    args: [idPresensiMapel],
  });

  const session = sessionRes.rows[0];
  if (!session) {
    throw new ApiRequestError("Sesi presensi kelas tidak ditemukan.", 404);
  }

  const idRombel = String(session.id_rombel ?? "");
  const tanggal = String(session.tanggal ?? "");

  const detailsRes = await db.execute({
    sql: `
      SELECT
        s.id_siswa,
        s.nis,
        s.nisn,
        s.nama_lengkap,
        s.jenis_kelamin,
        s.no_whatsapp_wali,
        s.nama_wali,
        d.id_detail,
        COALESCE(d.status, 'Hadir') AS status,
        COALESCE(d.catatan, '') AS catatan,
        ah.jam_masuk,
        ah.status_kehadiran AS gate_status
      FROM siswa_data s
      JOIN master_data md ON md.id_unik = s.id_siswa
      LEFT JOIN presensi_mapel_detail d
        ON d.id_presensi_mapel = ? AND d.id_siswa = s.id_siswa
      LEFT JOIN ${GATE_SUMMARY_SUBQUERY} ah
        ON ah.id_karyawan = s.id_siswa AND ah.tanggal = ?
      WHERE s.id_rombel = ? AND s.status = 'Aktif'
      ORDER BY s.nama_lengkap ASC;
    `,
    args: [idPresensiMapel, tanggal, idRombel],
  });

  return {
    session,
    details: detailsRes.rows,
  };
}

export async function getRosterForAttendance(
  idRombel: string,
  tanggal: string,
) {
  await ensureDbInitialized();

  const res = await db.execute({
    sql: `
      SELECT
        s.id_siswa,
        s.nis,
        s.nisn,
        s.nama_lengkap,
        s.jenis_kelamin,
        s.no_whatsapp_wali,
        s.nama_wali,
        ah.jam_masuk,
        ah.status_kehadiran AS gate_status
      FROM siswa_data s
      JOIN master_data md ON md.id_unik = s.id_siswa
      LEFT JOIN ${GATE_SUMMARY_SUBQUERY} ah
        ON ah.id_karyawan = s.id_siswa AND ah.tanggal = ?
      WHERE s.id_rombel = ? AND s.status = 'Aktif'
      ORDER BY s.nama_lengkap ASC;
    `,
    args: [tanggal, idRombel],
  });

  return res.rows.map((row) => ({
    id_siswa: row.id_siswa,
    nis: row.nis,
    nisn: row.nisn,
    nama_lengkap: row.nama_lengkap,
    jenis_kelamin: row.jenis_kelamin,
    no_whatsapp_wali: row.no_whatsapp_wali,
    nama_wali: row.nama_wali,
    status: DEFAULT_ROSTER_STATUS,
    catatan: "",
    jam_masuk: row.jam_masuk,
    gate_status: row.gate_status,
  }));
}

export async function saveClassAttendance(draft: SaveClassAttendanceDraft) {
  await ensureDbInitialized();

  const idTahunAjaran = draft.id_tahun_ajaran.trim();
  const idRombel = draft.id_rombel.trim();
  const idMapel = draft.id_mapel.trim();
  const idGuru = draft.id_guru.trim();
  const tanggal = draft.tanggal.trim();
  const jamKe = draft.jam_ke.trim();
  const materiPokok = draft.materi_pokok?.trim() || null;
  const catatan = draft.catatan?.trim() || null;

  if (
    !idTahunAjaran ||
    !idRombel ||
    !idMapel ||
    !idGuru ||
    !tanggal ||
    !jamKe
  ) {
    throw new ApiRequestError(
      "Tahun ajaran, rombel, mata pelajaran, guru, tanggal, dan jam ke wajib diisi.",
      400,
    );
  }

  // Dinormalkan SEBELUM pemeriksaan duplikat: tanpa itu "1-2" dan "1 - 2"
  // terbaca sebagai dua sesi berbeda untuk jam pelajaran yang sama.
  const jamKeNormal = normalizeJamKe(jamKe);
  if (jamKeNormal === null) {
    throw new ApiRequestError(
      `Jam pelajaran '${jamKe}' tidak valid. Gunakan angka 1-${MAX_JAM_KE} atau rentang seperti 1-2.`,
      400,
    );
  }

  const idPresensi =
    draft.id_presensi_mapel?.trim() ||
    `pm_${crypto.randomUUID().replace(/-/g, "")}`;

  // Aturan 32: Validasi keunikan di level aplikasi
  const duplicate = await db.execute({
    sql: `
      SELECT 1 FROM presensi_mapel
      WHERE id_tahun_ajaran = ?
        AND id_rombel = ?
        AND id_mapel = ?
        AND tanggal = ?
        AND jam_ke = ?
        AND id_presensi_mapel <> ?
      LIMIT 1;
    `,
    args: [idTahunAjaran, idRombel, idMapel, tanggal, jamKeNormal, idPresensi],
  });

  if (duplicate.rows.length > 0) {
    throw new ApiRequestError(
      "Sesi presensi untuk rombel, mapel, tanggal, dan jam ke ini sudah pernah dibuat.",
      409,
    );
  }

  let totalHadir = 0;
  let totalIzin = 0;
  let totalSakit = 0;
  let totalAlfa = 0;
  let totalDispensasi = 0;

  const validItems = (draft.items ?? []).map((item) => {
    // Cerminan `class_status` di `class_attendance.rs`: kosong berarti "belum
    // ditandai" dan jatuh ke Hadir, tetapi nilai tak dikenal DITOLAK. Mengubah
    // status asing menjadi Hadir secara diam-diam akan menandai siswa yang
    // tidak hadir sebagai hadir tanpa satu pun tanda.
    const raw = String(item.status ?? "").trim();
    if (
      raw !== "" &&
      raw !== "Hadir" &&
      raw !== "Izin" &&
      raw !== "Sakit" &&
      raw !== "Alfa" &&
      raw !== "Dispensasi"
    ) {
      throw new ApiRequestError(
        `Status kehadiran '${raw}' tidak dikenal. Gunakan Hadir, Izin, Sakit, Alfa, atau Dispensasi.`,
        400,
      );
    }
    const status: "Hadir" | "Izin" | "Sakit" | "Alfa" | "Dispensasi" =
      raw === "Izin" ||
      raw === "Sakit" ||
      raw === "Alfa" ||
      raw === "Dispensasi"
        ? raw
        : "Hadir";

    if (status === "Hadir") totalHadir++;
    else if (status === "Izin") totalIzin++;
    else if (status === "Sakit") totalSakit++;
    else if (status === "Alfa") totalAlfa++;
    else if (status === "Dispensasi") totalDispensasi++;

    return {
      id_siswa: item.id_siswa.trim(),
      status,
      catatan: item.catatan?.trim() || null,
    };
  });

  const statements: Array<{
    sql: string;
    args: Array<string | number | boolean | null>;
  }> = [
    {
      sql: `
        INSERT INTO presensi_mapel (
          id_presensi_mapel, id_tahun_ajaran, id_rombel, id_mapel, id_guru,
          tanggal, jam_ke, materi_pokok, catatan,
          total_hadir, total_izin, total_sakit, total_alfa, total_dispensasi,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
        ON CONFLICT(id_presensi_mapel) DO UPDATE SET
          id_tahun_ajaran = excluded.id_tahun_ajaran,
          id_rombel = excluded.id_rombel,
          id_mapel = excluded.id_mapel,
          id_guru = excluded.id_guru,
          tanggal = excluded.tanggal,
          jam_ke = excluded.jam_ke,
          materi_pokok = excluded.materi_pokok,
          catatan = excluded.catatan,
          total_hadir = excluded.total_hadir,
          total_izin = excluded.total_izin,
          total_sakit = excluded.total_sakit,
          total_alfa = excluded.total_alfa,
          total_dispensasi = excluded.total_dispensasi,
          updated_at = datetime('now');
      `,
      args: [
        idPresensi,
        idTahunAjaran,
        idRombel,
        idMapel,
        idGuru,
        tanggal,
        jamKeNormal,
        materiPokok,
        catatan,
        totalHadir,
        totalIzin,
        totalSakit,
        totalAlfa,
        totalDispensasi,
      ],
    },
  ];

  // Baris detail yang sudah ada untuk sesi ini.
  //
  // WAJIB dibaca lebih dulu. Versi sebelumnya selalu membuat `id_detail` baru,
  // sehingga `ON CONFLICT(id_detail)` tidak pernah aktif dan setiap penyimpanan
  // ulang MENGGANDAKAN seluruh baris detail sesi itu — tiga kali simpan berarti
  // tiga baris per siswa, dan rekonsiliasi menghitungnya berkali-kali.
  const existingRes = await db.execute({
    sql: "SELECT id_detail, id_siswa FROM presensi_mapel_detail WHERE id_presensi_mapel = ?;",
    args: [idPresensi],
  });
  const existingByStudent = new Map<string, string>();
  for (const row of existingRes.rows) {
    existingByStudent.set(
      String(row.id_siswa ?? ""),
      String(row.id_detail ?? ""),
    );
  }

  const submitted = new Set<string>();
  for (const item of validItems) {
    if (!item.id_siswa) continue;
    submitted.add(item.id_siswa);
    const idDetail =
      existingByStudent.get(item.id_siswa) ??
      `pmd_${crypto.randomUUID().replace(/-/g, "")}`;
    statements.push({
      sql: `
        INSERT INTO presensi_mapel_detail (
          id_detail, id_presensi_mapel, id_siswa, status, catatan, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))
        ON CONFLICT(id_detail) DO UPDATE SET
          status = excluded.status,
          catatan = excluded.catatan,
          updated_at = datetime('now');
      `,
      args: [idDetail, idPresensi, item.id_siswa, item.status, item.catatan],
    });
  }

  // Siswa yang keluar dari roster: barisnya dibuang supaya isi tabel detail
  // tetap cocok dengan `total_*` di header — lihat alasan lengkapnya di
  // `save_class_attendance` (`class_attendance.rs`).
  for (const [idSiswa, idDetail] of existingByStudent) {
    if (submitted.has(idSiswa)) continue;
    statements.push({
      sql: "DELETE FROM presensi_mapel_detail WHERE id_detail = ?;",
      args: [idDetail],
    });
  }

  await db.batch(statements, "write");

  return { sukses: true, id_presensi_mapel: idPresensi };
}

export async function deleteClassAttendance(idPresensiMapel: string) {
  await ensureDbInitialized();

  await db.batch(
    [
      {
        sql: "DELETE FROM presensi_mapel_detail WHERE id_presensi_mapel = ?;",
        args: [idPresensiMapel],
      },
      {
        sql: "DELETE FROM presensi_mapel WHERE id_presensi_mapel = ?;",
        args: [idPresensiMapel],
      },
    ],
    "write",
  );

  return { sukses: true };
}

export async function getAttendanceReconciliation(filter?: {
  tanggal?: string;
  id_rombel?: string;
}) {
  await ensureDbInitialized();

  // "Hari ini" WAJIB WIB, bukan UTC — lihat alasan lengkapnya di
  // `get_attendance_reconciliation` (`class_attendance.rs`). Formulanya sama
  // dengan `attendance-processor.ts` dan `current_jakarta_moment` di Rust.
  const nowRow = await db.execute("SELECT date('now','+7 hours') AS today;");
  const defaultToday = String(nowRow.rows[0]?.today ?? "").trim();
  if (!defaultToday) {
    throw new Error("Tanggal server tidak dapat dibaca.");
  }
  const tanggal = filter?.tanggal?.trim() || defaultToday;
  const idRombel = filter?.id_rombel?.trim() || null;

  // Anomali 1: Bolos di sekolah (Hadir gerbang, Alfa di kelas)
  const bolosRes = await db.execute({
    sql: `
      SELECT
        s.id_siswa,
        COALESCE(s.nis, '') AS nis,
        s.nama_lengkap AS nama_siswa,
        r.id_rombel,
        r.nama_rombel,
        p.tanggal,
        ah.jam_masuk AS jam_masuk_gerbang,
        ah.status_kehadiran AS status_gerbang,
        p.id_presensi_mapel,
        m.nama_mapel,
        p.jam_ke,
        COALESCE(g.nama, '') AS nama_guru,
        d.status AS status_mapel,
        COALESCE(d.catatan, '') AS catatan_mapel,
        s.no_whatsapp_wali,
        s.nama_wali,
        'BOLOS_DI_SEKOLAH' AS anomaly_type,
        'Tercatat masuk gerbang pagi hari, tetapi Alfa pada jam pelajaran' AS anomaly_label
      FROM presensi_mapel_detail d
      JOIN presensi_mapel p ON p.id_presensi_mapel = d.id_presensi_mapel
      JOIN siswa_data s ON s.id_siswa = d.id_siswa
      JOIN akademik_rombel r ON r.id_rombel = p.id_rombel
      JOIN akademik_mapel m ON m.id_mapel = p.id_mapel
      LEFT JOIN master_data g ON g.id_unik = p.id_guru
      JOIN ${GATE_SUMMARY_SUBQUERY} ah ON ah.id_karyawan = s.id_siswa AND ah.tanggal = p.tanggal
      WHERE p.tanggal = ?
        AND (? IS NULL OR p.id_rombel = ?)
        AND d.status = 'Alfa'
        AND ah.hadir_gerbang = 1
      ORDER BY r.nama_rombel ASC, s.nama_lengkap ASC, CAST(p.jam_ke AS INTEGER) ASC, p.jam_ke ASC;
    `,
    args: [tanggal, idRombel, idRombel],
  });

  // Anomali 2: Hadir tanpa scan gerbang (Hadir di kelas, tidak ada scan gerbang)
  const tanpaScanRes = await db.execute({
    sql: `
      SELECT
        s.id_siswa,
        COALESCE(s.nis, '') AS nis,
        s.nama_lengkap AS nama_siswa,
        r.id_rombel,
        r.nama_rombel,
        p.tanggal,
        ah.jam_masuk AS jam_masuk_gerbang,
        COALESCE(ah.status_kehadiran, 'Tidak Ada Scan') AS status_gerbang,
        p.id_presensi_mapel,
        m.nama_mapel,
        p.jam_ke,
        COALESCE(g.nama, '') AS nama_guru,
        d.status AS status_mapel,
        COALESCE(d.catatan, '') AS catatan_mapel,
        s.no_whatsapp_wali,
        s.nama_wali,
        'HADIR_TANPA_SCAN_GERBANG' AS anomaly_type,
        'Hadir di kelas, tetapi belum/tidak melakukan scan di gerbang sekolah' AS anomaly_label
      FROM presensi_mapel_detail d
      JOIN presensi_mapel p ON p.id_presensi_mapel = d.id_presensi_mapel
      JOIN siswa_data s ON s.id_siswa = d.id_siswa
      JOIN akademik_rombel r ON r.id_rombel = p.id_rombel
      JOIN akademik_mapel m ON m.id_mapel = p.id_mapel
      LEFT JOIN master_data g ON g.id_unik = p.id_guru
      LEFT JOIN ${GATE_SUMMARY_SUBQUERY} ah ON ah.id_karyawan = s.id_siswa AND ah.tanggal = p.tanggal
      WHERE p.tanggal = ?
        AND (? IS NULL OR p.id_rombel = ?)
        AND d.status = 'Hadir'
        AND COALESCE(ah.hadir_gerbang, 0) = 0
      ORDER BY r.nama_rombel ASC, s.nama_lengkap ASC, CAST(p.jam_ke AS INTEGER) ASC, p.jam_ke ASC;
    `,
    args: [tanggal, idRombel, idRombel],
  });

  return {
    tanggal,
    anomalies: [...bolosRes.rows, ...tanpaScanRes.rows],
  };
}
