import "server-only";

import crypto from "node:crypto";
import type { Client } from "@libsql/client";
import type {
  CounselingCaseDetail,
  CounselingCaseDraft,
  CounselingCaseFilter,
  CounselingCaseItem,
  CounselingCategory,
  CounselingSessionDraft,
  CounselingSessionItem,
  CounselingStatus,
} from "@/types/counseling";

export async function listCounselingCases(
  client: Client,
  filter?: CounselingCaseFilter,
): Promise<{ items: CounselingCaseItem[] }> {
  let sql = `
    SELECT k.id_kasus, k.id_siswa, k.id_tahun_ajaran, k.kategori,
           k.ringkasan, k.kronologi, k.status, k.dibuat_oleh,
           k.created_at, k.updated_at,
           COALESCE(s.nama_lengkap, m.nama, '') AS nama_siswa,
           COALESCE(s.nis, m.kode_karyawan, '') AS nis,
           COALESCE(r.nama_rombel, m.divisi, '') AS nama_rombel,
           COALESCE(s.nama_wali, '') AS nama_wali,
           COALESCE(s.no_whatsapp_wali, m.no_hp, '') AS no_whatsapp_wali,
           COALESCE(ta.nama_tahun, '') AS nama_tahun,
           (SELECT COUNT(*) FROM bk_sesi ses WHERE ses.id_kasus = k.id_kasus) AS total_sesi
    FROM bk_kasus k
    LEFT JOIN siswa_data s ON s.id_siswa = k.id_siswa
    LEFT JOIN akademik_rombel r ON r.id_rombel = s.id_rombel
    LEFT JOIN master_data m ON m.id_unik = k.id_siswa
    LEFT JOIN akademik_tahun_ajaran ta ON ta.id_tahun_ajaran = k.id_tahun_ajaran
    WHERE 1=1
  `;
  const args: (string | number)[] = [];

  const ta = filter?.id_tahun_ajaran?.trim();
  if (ta) {
    sql += " AND k.id_tahun_ajaran = ?";
    args.push(ta);
  }

  const st = filter?.status?.trim();
  if (st && st !== "Semua") {
    sql += " AND k.status = ?";
    args.push(st);
  }

  const kat = filter?.kategori?.trim();
  if (kat && kat !== "Semua") {
    sql += " AND k.kategori = ?";
    args.push(kat);
  }

  const sid = filter?.id_siswa?.trim();
  if (sid) {
    sql += " AND k.id_siswa = ?";
    args.push(sid);
  }

  const search = filter?.search?.trim();
  if (search) {
    sql +=
      " AND (k.ringkasan LIKE ? OR s.nama_lengkap LIKE ? OR m.nama LIKE ? OR s.nis LIKE ?)";
    const p = `%${search}%`;
    args.push(p, p, p, p);
  }

  sql += " ORDER BY k.created_at DESC";
  const limit = Math.min(Math.max(filter?.limit ?? 100, 1), 500);
  sql += ` LIMIT ${limit};`;

  const res = await client.execute({ sql, args });
  const items: CounselingCaseItem[] = res.rows.map((row) => ({
    id_kasus: String(row.id_kasus ?? ""),
    id_siswa: String(row.id_siswa ?? ""),
    id_tahun_ajaran: String(row.id_tahun_ajaran ?? ""),
    kategori: String(row.kategori ?? "kedisiplinan") as CounselingCategory,
    ringkasan: String(row.ringkasan ?? ""),
    kronologi: row.kronologi != null ? String(row.kronologi) : null,
    status: String(row.status ?? "Terbuka") as CounselingStatus,
    dibuat_oleh: String(row.dibuat_oleh ?? ""),
    created_at: String(row.created_at ?? ""),
    updated_at: String(row.updated_at ?? ""),
    nama_siswa: String(row.nama_siswa ?? ""),
    nis: String(row.nis ?? ""),
    nama_rombel: String(row.nama_rombel ?? ""),
    nama_wali: String(row.nama_wali ?? ""),
    no_whatsapp_wali: String(row.no_whatsapp_wali ?? ""),
    nama_tahun: String(row.nama_tahun ?? ""),
    total_sesi: Number(row.total_sesi ?? 0),
  }));

  return { items };
}

export async function getCounselingCase(
  client: Client,
  idKasus: string,
): Promise<CounselingCaseDetail> {
  const caseRes = await client.execute({
    sql: `
      SELECT k.id_kasus, k.id_siswa, k.id_tahun_ajaran, k.kategori,
             k.ringkasan, k.kronologi, k.status, k.dibuat_oleh,
             k.created_at, k.updated_at,
             COALESCE(s.nama_lengkap, m.nama, '') AS nama_siswa,
             COALESCE(s.nis, m.kode_karyawan, '') AS nis,
             COALESCE(r.nama_rombel, m.divisi, '') AS nama_rombel,
             COALESCE(s.nama_wali, '') AS nama_wali,
             COALESCE(s.no_whatsapp_wali, m.no_hp, '') AS no_whatsapp_wali,
             COALESCE(ta.nama_tahun, '') AS nama_tahun
      FROM bk_kasus k
      LEFT JOIN siswa_data s ON s.id_siswa = k.id_siswa
      LEFT JOIN akademik_rombel r ON r.id_rombel = s.id_rombel
      LEFT JOIN master_data m ON m.id_unik = k.id_siswa
      LEFT JOIN akademik_tahun_ajaran ta ON ta.id_tahun_ajaran = k.id_tahun_ajaran
      WHERE k.id_kasus = ?
      LIMIT 1;
    `,
    args: [idKasus.trim()],
  });

  const row = caseRes.rows[0];
  if (!row) {
    throw new Error("Kasus BK tidak ditemukan.");
  }

  const sessionsRes = await client.execute({
    sql: `
      SELECT id_sesi, id_kasus, tanggal, catatan_konseling, tindak_lanjut, konselor, created_at, updated_at
      FROM bk_sesi
      WHERE id_kasus = ?
      ORDER BY tanggal ASC, created_at ASC;
    `,
    args: [idKasus.trim()],
  });

  const sessions: CounselingSessionItem[] = sessionsRes.rows.map((sRow) => ({
    id_sesi: String(sRow.id_sesi ?? ""),
    id_kasus: String(sRow.id_kasus ?? ""),
    tanggal: String(sRow.tanggal ?? ""),
    catatan_konseling: String(sRow.catatan_konseling ?? ""),
    tindak_lanjut:
      sRow.tindak_lanjut != null ? String(sRow.tindak_lanjut) : null,
    konselor: String(sRow.konselor ?? ""),
    created_at: String(sRow.created_at ?? ""),
    updated_at: String(sRow.updated_at ?? ""),
  }));

  return {
    id_kasus: String(row.id_kasus ?? ""),
    id_siswa: String(row.id_siswa ?? ""),
    id_tahun_ajaran: String(row.id_tahun_ajaran ?? ""),
    kategori: String(row.kategori ?? "kedisiplinan") as CounselingCategory,
    ringkasan: String(row.ringkasan ?? ""),
    kronologi: row.kronologi != null ? String(row.kronologi) : null,
    status: String(row.status ?? "Terbuka") as CounselingStatus,
    dibuat_oleh: String(row.dibuat_oleh ?? ""),
    created_at: String(row.created_at ?? ""),
    updated_at: String(row.updated_at ?? ""),
    nama_siswa: String(row.nama_siswa ?? ""),
    nis: String(row.nis ?? ""),
    nama_rombel: String(row.nama_rombel ?? ""),
    nama_wali: String(row.nama_wali ?? ""),
    no_whatsapp_wali: String(row.no_whatsapp_wali ?? ""),
    nama_tahun: String(row.nama_tahun ?? ""),
    total_sesi: sessions.length,
    sesi: sessions,
  };
}

export async function createCounselingCase(
  client: Client,
  draft: CounselingCaseDraft,
  actor: string,
): Promise<{ sukses: boolean; id_kasus: string }> {
  const idSiswa = draft.id_siswa.trim();
  const idTahunAjaran = draft.id_tahun_ajaran.trim();
  const ringkasan = draft.ringkasan.trim();
  if (!idSiswa || !idTahunAjaran || !ringkasan) {
    throw new Error("ID Siswa, Tahun Ajaran, dan Ringkasan kasus wajib diisi.");
  }

  const validKategori = ["kedisiplinan", "akademik", "kehadiran", "sosial"];
  if (!validKategori.includes(draft.kategori)) {
    throw new Error("Kategori kasus tidak valid.");
  }

  const status = draft.status ?? "Terbuka";
  const validStatus = ["Terbuka", "Dalam Bimbingan", "Selesai"];
  if (!validStatus.includes(status)) {
    throw new Error("Status kasus tidak valid.");
  }

  const idKasus = `bk_${crypto.randomBytes(16).toString("hex")}`;

  await client.execute({
    sql: `
      INSERT INTO bk_kasus (
        id_kasus, id_siswa, id_tahun_ajaran, kategori, ringkasan,
        kronologi, status, dibuat_oleh, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'));
    `,
    args: [
      idKasus,
      idSiswa,
      idTahunAjaran,
      draft.kategori,
      ringkasan,
      draft.kronologi?.trim() || null,
      status,
      actor,
    ],
  });

  return { sukses: true, id_kasus: idKasus };
}

export async function updateCounselingCase(
  client: Client,
  idKasus: string,
  draft: Partial<CounselingCaseDraft>,
): Promise<{ sukses: boolean }> {
  const updates: string[] = [];
  const args: (string | number)[] = [];

  if (draft.kategori) {
    const validKategori = ["kedisiplinan", "akademik", "kehadiran", "sosial"];
    if (!validKategori.includes(draft.kategori)) {
      throw new Error("Kategori kasus tidak valid.");
    }
    updates.push("kategori = ?");
    args.push(draft.kategori);
  }

  if (draft.ringkasan !== undefined) {
    const r = draft.ringkasan.trim();
    if (!r) throw new Error("Ringkasan tidak boleh kosong.");
    updates.push("ringkasan = ?");
    args.push(r);
  }

  if (draft.kronologi !== undefined) {
    updates.push("kronologi = ?");
    args.push(draft.kronologi?.trim() || "");
  }

  if (draft.status) {
    const validStatus = ["Terbuka", "Dalam Bimbingan", "Selesai"];
    if (!validStatus.includes(draft.status)) {
      throw new Error("Status kasus tidak valid.");
    }
    updates.push("status = ?");
    args.push(draft.status);
  }

  if (updates.length === 0) {
    return { sukses: true };
  }

  updates.push("updated_at = datetime('now')");
  args.push(idKasus.trim());

  await client.execute({
    sql: `UPDATE bk_kasus SET ${updates.join(", ")} WHERE id_kasus = ?;`,
    args,
  });

  return { sukses: true };
}

export async function deleteCounselingCase(
  client: Client,
  idKasus: string,
): Promise<{ sukses: boolean }> {
  await client.batch(
    [
      {
        sql: "DELETE FROM bk_sesi WHERE id_kasus = ?;",
        args: [idKasus.trim()],
      },
      {
        sql: "DELETE FROM bk_kasus WHERE id_kasus = ?;",
        args: [idKasus.trim()],
      },
    ],
    "write",
  );

  return { sukses: true };
}

export async function addCounselingSession(
  client: Client,
  draft: CounselingSessionDraft,
  counselor: string,
): Promise<{ sukses: boolean; id_sesi: string }> {
  const idKasus = draft.id_kasus.trim();
  const tanggal = draft.tanggal.trim();
  const catatan = draft.catatan_konseling.trim();
  if (!idKasus || !tanggal || !catatan) {
    throw new Error("ID Kasus, tanggal, dan catatan konseling wajib diisi.");
  }

  const idSesi = `bks_${crypto.randomBytes(16).toString("hex")}`;

  await client.batch(
    [
      {
        sql: `
          INSERT INTO bk_sesi (
            id_sesi, id_kasus, tanggal, catatan_konseling, tindak_lanjut,
            konselor, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'));
        `,
        args: [
          idSesi,
          idKasus,
          tanggal,
          catatan,
          draft.tindak_lanjut?.trim() || null,
          counselor,
        ],
      },
      {
        sql: `
          UPDATE bk_kasus
          SET status = CASE WHEN status = 'Terbuka' THEN 'Dalam Bimbingan' ELSE status END,
              updated_at = datetime('now')
          WHERE id_kasus = ?;
        `,
        args: [idKasus],
      },
    ],
    "write",
  );

  return { sukses: true, id_sesi: idSesi };
}

export async function deleteCounselingSession(
  client: Client,
  idSesi: string,
): Promise<{ sukses: boolean }> {
  await client.execute({
    sql: "DELETE FROM bk_sesi WHERE id_sesi = ?;",
    args: [idSesi.trim()],
  });

  return { sukses: true };
}
