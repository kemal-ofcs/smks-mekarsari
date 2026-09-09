import "server-only";

import { formatTanggalOperasional } from "@/lib/attendance/time-policy";
import { db, ensureDbInitialized } from "@/lib/db";

const GATE_SUMMARY_SUBQUERY = `(
  SELECT
    id_karyawan,
    tanggal,
    MIN(NULLIF(TRIM(jam_masuk), '')) AS jam_masuk,
    MAX(NULLIF(TRIM(jam_pulang), '')) AS jam_pulang,
    MAX(CASE
      WHEN COALESCE(TRIM(jam_masuk), '') <> ''
       AND COALESCE(status_kehadiran, '') <> 'Alfa'
      THEN 1 ELSE 0
    END) AS hadir_gerbang,
    MAX(COALESCE(status_kehadiran, '')) AS status_kehadiran,
    MAX(COALESCE(menit_terlambat, 0)) AS menit_terlambat
  FROM absensi_harian
  GROUP BY id_karyawan, tanggal
)`;

export interface AttendanceDashboardCategoryMetrics {
  total: number;
  hadir: number;
  terlambat: number;
  sakit: number;
  izin: number;
  dispen: number;
  alfa: number;
  persentase: number;
}

export interface AttendanceDashboardRombelItem {
  id_rombel: string;
  nama_rombel: string;
  total_siswa: number;
  hadir: number;
  sakit_izin: number;
  alfa: number;
  persentase: number;
}

export interface AttendanceDashboardTeacherItem {
  id_karyawan: string;
  nama_lengkap: string;
  jabatan: string;
  jam_masuk: string;
  jam_pulang: string;
  status_kehadiran: string;
  menit_terlambat: number;
}

export interface AttendanceDashboardMetrics {
  tanggal: string;
  siswa: AttendanceDashboardCategoryMetrics;
  guru: AttendanceDashboardCategoryMetrics;
  rekapRombel: AttendanceDashboardRombelItem[];
  rekapGuru: AttendanceDashboardTeacherItem[];
  anomaliBolos: number;
}

export async function getAttendanceDashboardMetrics(filter?: {
  tanggal?: string;
}): Promise<AttendanceDashboardMetrics> {
  await ensureDbInitialized();

  const dateStr =
    filter?.tanggal?.trim() || formatTanggalOperasional(new Date());

  // 1. Siswa stats
  const totalSiswaRes = await db.execute({
    sql: `
      SELECT COUNT(*) as total FROM master_data
      WHERE status_aktif = 'Aktif'
        AND (LOWER(TRIM(COALESCE(jenis_personil, ''))) = 'siswa' 
             OR LOWER(TRIM(COALESCE(jabatan_status, ''))) = 'siswa');
    `,
  });
  const totalSiswa = Number(totalSiswaRes.rows[0]?.total || 0);

  const siswaStatsRes = await db.execute({
    sql: `
      SELECT
        COUNT(CASE WHEN ah.hadir_gerbang = 1 OR ah.status_kehadiran = 'Hadir' THEN 1 END) AS hadir,
        COUNT(CASE WHEN ah.menit_terlambat > 0 THEN 1 END) AS terlambat,
        COUNT(CASE WHEN ah.status_kehadiran = 'Sakit' THEN 1 END) AS sakit,
        COUNT(CASE WHEN ah.status_kehadiran = 'Izin' THEN 1 END) AS izin,
        COUNT(CASE WHEN ah.status_kehadiran = 'Dispen' THEN 1 END) AS dispen,
        COUNT(CASE WHEN ah.status_kehadiran = 'Alfa' THEN 1 END) AS alfa
      FROM master_data m
      LEFT JOIN ${GATE_SUMMARY_SUBQUERY} ah 
        ON ah.id_karyawan = m.id_unik AND ah.tanggal = ?
      WHERE m.status_aktif = 'Aktif'
        AND (LOWER(TRIM(COALESCE(m.jenis_personil, ''))) = 'siswa' 
             OR LOWER(TRIM(COALESCE(m.jabatan_status, ''))) = 'siswa');
    `,
    args: [dateStr],
  });
  const sRow = siswaStatsRes.rows[0] as Record<string, unknown>;
  const siswaHadir = Number(sRow?.hadir || 0);
  const siswaTerlambat = Number(sRow?.terlambat || 0);
  const siswaSakit = Number(sRow?.sakit || 0);
  const siswaIzin = Number(sRow?.izin || 0);
  const siswaDispen = Number(sRow?.dispen || 0);
  const siswaAlfa = Number(sRow?.alfa || 0);
  const siswaPersentase =
    totalSiswa > 0 ? Math.round((siswaHadir / totalSiswa) * 100) : 0;

  // 2. Guru / PTK stats
  const totalGuruRes = await db.execute({
    sql: `
      SELECT COUNT(*) as total FROM master_data
      WHERE status_aktif = 'Aktif'
        AND LOWER(TRIM(COALESCE(jenis_personil, ''))) <> 'siswa' 
        AND LOWER(TRIM(COALESCE(jabatan_status, ''))) <> 'siswa';
    `,
  });
  const totalGuru = Number(totalGuruRes.rows[0]?.total || 0);

  const guruStatsRes = await db.execute({
    sql: `
      SELECT
        COUNT(CASE WHEN ah.hadir_gerbang = 1 OR ah.status_kehadiran = 'Hadir' THEN 1 END) AS hadir,
        COUNT(CASE WHEN ah.menit_terlambat > 0 THEN 1 END) AS terlambat,
        COUNT(CASE WHEN ah.status_kehadiran = 'Sakit' THEN 1 END) AS sakit,
        COUNT(CASE WHEN ah.status_kehadiran = 'Izin' THEN 1 END) AS izin,
        COUNT(CASE WHEN ah.status_kehadiran = 'Dispen' THEN 1 END) AS dispen,
        COUNT(CASE WHEN ah.status_kehadiran = 'Alfa' THEN 1 END) AS alfa
      FROM master_data m
      LEFT JOIN ${GATE_SUMMARY_SUBQUERY} ah 
        ON ah.id_karyawan = m.id_unik AND ah.tanggal = ?
      WHERE m.status_aktif = 'Aktif'
        AND LOWER(TRIM(COALESCE(m.jenis_personil, ''))) <> 'siswa' 
        AND LOWER(TRIM(COALESCE(m.jabatan_status, ''))) <> 'siswa';
    `,
    args: [dateStr],
  });
  const gRow = guruStatsRes.rows[0] as Record<string, unknown>;
  const guruHadir = Number(gRow?.hadir || 0);
  const guruTerlambat = Number(gRow?.terlambat || 0);
  const guruSakit = Number(gRow?.sakit || 0);
  const guruIzin = Number(gRow?.izin || 0);
  const guruDispen = Number(gRow?.dispen || 0);
  const guruAlfa = Number(gRow?.alfa || 0);
  const guruPersentase =
    totalGuru > 0 ? Math.round((guruHadir / totalGuru) * 100) : 0;

  // 3. Rekap Rombel
  const rombelRes = await db.execute({
    sql: `
      SELECT
        r.id_rombel,
        r.nama_rombel,
        COUNT(s.id_siswa) AS total_siswa,
        COUNT(CASE WHEN ah.hadir_gerbang = 1 OR ah.status_kehadiran = 'Hadir' THEN 1 END) AS hadir,
        COUNT(CASE WHEN ah.status_kehadiran IN ('Sakit', 'Izin', 'Dispen') THEN 1 END) AS sakit_izin,
        COUNT(CASE WHEN ah.status_kehadiran = 'Alfa' THEN 1 END) AS alfa
      FROM akademik_rombel r
      LEFT JOIN siswa_data s ON s.id_rombel = r.id_rombel
      LEFT JOIN master_data m ON m.id_unik = s.id_siswa AND m.status_aktif = 'Aktif'
      LEFT JOIN ${GATE_SUMMARY_SUBQUERY} ah ON ah.id_karyawan = s.id_siswa AND ah.tanggal = ?
      GROUP BY r.id_rombel, r.nama_rombel
      ORDER BY r.nama_rombel ASC;
    `,
    args: [dateStr],
  });

  const rekapRombel: AttendanceDashboardRombelItem[] = rombelRes.rows.map(
    (row) => {
      const total = Number(row.total_siswa || 0);
      const hadir = Number(row.hadir || 0);
      const sakit_izin = Number(row.sakit_izin || 0);
      const alfa = Number(row.alfa || 0);
      const persentase = total > 0 ? Math.round((hadir / total) * 100) : 0;
      return {
        id_rombel: String(row.id_rombel),
        nama_rombel: String(row.nama_rombel),
        total_siswa: total,
        hadir,
        sakit_izin,
        alfa,
        persentase,
      };
    },
  );

  // 4. Rekap Guru Detail
  const guruListRes = await db.execute({
    sql: `
      SELECT
        m.id_unik AS id_karyawan,
        m.nama AS nama_lengkap,
        COALESCE(m.jabatan_status, 'Guru / PTK') AS jabatan,
        COALESCE(ah.jam_masuk, '') AS jam_masuk,
        COALESCE(ah.jam_pulang, '') AS jam_pulang,
        COALESCE(ah.status_kehadiran, 'Belum Hadir') AS status_kehadiran,
        COALESCE(ah.menit_terlambat, 0) AS menit_terlambat
      FROM master_data m
      LEFT JOIN ${GATE_SUMMARY_SUBQUERY} ah ON ah.id_karyawan = m.id_unik AND ah.tanggal = ?
      WHERE m.status_aktif = 'Aktif'
        AND LOWER(TRIM(COALESCE(m.jenis_personil, ''))) <> 'siswa' 
        AND LOWER(TRIM(COALESCE(m.jabatan_status, ''))) <> 'siswa'
      ORDER BY m.nama ASC;
    `,
    args: [dateStr],
  });

  const rekapGuru: AttendanceDashboardTeacherItem[] = guruListRes.rows.map(
    (row) => ({
      id_karyawan: String(row.id_karyawan),
      nama_lengkap: String(row.nama_lengkap),
      jabatan: String(row.jabatan),
      jam_masuk: String(row.jam_masuk),
      jam_pulang: String(row.jam_pulang),
      status_kehadiran: String(row.status_kehadiran),
      menit_terlambat: Number(row.menit_terlambat || 0),
    }),
  );

  // 5. Deteksi Anomali Bolos
  const bolosRes = await db.execute({
    sql: `
      SELECT COUNT(DISTINCT ah.id_karyawan) as count
      FROM ${GATE_SUMMARY_SUBQUERY} ah
      JOIN presensi_mapel pm ON pm.tanggal = ah.tanggal
      JOIN presensi_mapel_detail pmd ON pmd.id_presensi_mapel = pm.id_presensi_mapel 
           AND pmd.id_siswa = ah.id_karyawan
      WHERE ah.tanggal = ?
        AND ah.hadir_gerbang = 1
        AND pmd.status = 'Alfa';
    `,
    args: [dateStr],
  });
  const anomaliBolos = Number(bolosRes.rows[0]?.count || 0);

  return {
    tanggal: dateStr,
    siswa: {
      total: totalSiswa,
      hadir: siswaHadir,
      terlambat: siswaTerlambat,
      sakit: siswaSakit,
      izin: siswaIzin,
      dispen: siswaDispen,
      alfa: siswaAlfa,
      persentase: siswaPersentase,
    },
    guru: {
      total: totalGuru,
      hadir: guruHadir,
      terlambat: guruTerlambat,
      sakit: guruSakit,
      izin: guruIzin,
      dispen: guruDispen,
      alfa: guruAlfa,
      persentase: guruPersentase,
    },
    rekapRombel,
    rekapGuru,
    anomaliBolos,
  };
}
