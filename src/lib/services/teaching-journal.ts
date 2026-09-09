import "server-only";

import { db, ensureDbInitialized } from "@/lib/db";
import { ApiRequestError } from "@/lib/server/http/api-response";

export interface TeachingJournalRecord {
  id_jurnal: string;
  id_presensi_mapel: string;
  materi_disampaikan: string | null;
  kendala: string | null;
  tindak_lanjut: string | null;
  paraf_nama: string | null;
  paraf_operator: string;
  paraf_at: string;
  created_at: string;
  updated_at: string;
  tanggal?: string;
  jam_ke?: string;
  materi_pokok?: string;
  id_rombel?: string;
  id_mapel?: string;
  id_guru?: string;
  nama_mapel?: string;
  nama_rombel?: string;
  nama_guru?: string;
}

export async function getTeachingJournal(
  idPresensiMapel: string,
): Promise<TeachingJournalRecord | null> {
  await ensureDbInitialized();
  const cleanId = String(idPresensiMapel || "").trim();
  if (!cleanId) return null;

  const result = await db.execute({
    sql: `
      SELECT j.id_jurnal, j.id_presensi_mapel, j.materi_disampaikan, j.kendala,
             j.tindak_lanjut, j.paraf_nama, j.paraf_operator, j.paraf_at,
             j.created_at, j.updated_at,
             p.tanggal, p.jam_ke, p.materi_pokok,
             m.nama_mapel, r.nama_rombel, g.nama as nama_guru
      FROM jurnal_mengajar j
      JOIN presensi_mapel p ON p.id_presensi_mapel = j.id_presensi_mapel
      LEFT JOIN akademik_mapel m ON m.id_mapel = p.id_mapel
      LEFT JOIN akademik_rombel r ON r.id_rombel = p.id_rombel
      LEFT JOIN master_data g ON g.id_unik = p.id_guru
      WHERE j.id_presensi_mapel = ?
      LIMIT 1;
    `,
    args: [cleanId],
  });

  if (result.rows.length === 0) return null;
  const row = result.rows[0];
  return {
    id_jurnal: String(row.id_jurnal),
    id_presensi_mapel: String(row.id_presensi_mapel),
    materi_disampaikan: row.materi_disampaikan
      ? String(row.materi_disampaikan)
      : null,
    kendala: row.kendala ? String(row.kendala) : null,
    tindak_lanjut: row.tindak_lanjut ? String(row.tindak_lanjut) : null,
    paraf_nama: row.paraf_nama ? String(row.paraf_nama) : null,
    paraf_operator: String(row.paraf_operator),
    paraf_at: String(row.paraf_at),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
    tanggal: row.tanggal ? String(row.tanggal) : undefined,
    jam_ke: row.jam_ke ? String(row.jam_ke) : undefined,
    materi_pokok: row.materi_pokok ? String(row.materi_pokok) : undefined,
    nama_mapel: row.nama_mapel ? String(row.nama_mapel) : undefined,
    nama_rombel: row.nama_rombel ? String(row.nama_rombel) : undefined,
    nama_guru: row.nama_guru ? String(row.nama_guru) : undefined,
  };
}

export async function listTeachingJournals(filter?: {
  idRombel?: string;
  idMapel?: string;
  idGuru?: string;
  tanggalMulai?: string;
  tanggalSelesai?: string;
  limit?: number;
}): Promise<TeachingJournalRecord[]> {
  await ensureDbInitialized();
  // Setiap filter di sini opsional, sehingga pemanggilan tanpa filter berarti
  // "seluruh jurnal mengajar yang pernah dicatat" — satu baris per kelas per
  // jam pelajaran per hari, bertambah selamanya. Batasnya dijepit di sini,
  // pola yang sama dengan `getRiwayatScan` dan `listWaNotifications`.
  //
  // Bawaannya sama dengan pagar maksimumnya: 30 rombel × 8 jam × 20 hari
  // sekolah sudah ±4.800 baris sebulan, jadi bawaan yang lebih kecil akan
  // memotong tampilan sebulan tanpa memberi tahu siapa pun. Angka ini pagar
  // terhadap bencana, bukan ukuran halaman.
  const limit = Math.min(1000, Math.max(1, filter?.limit || 1000));
  const idRombel = filter?.idRombel?.trim() || null;
  const idMapel = filter?.idMapel?.trim() || null;
  const idGuru = filter?.idGuru?.trim() || null;
  const tanggalMulai = filter?.tanggalMulai?.trim() || null;
  const tanggalSelesai = filter?.tanggalSelesai?.trim() || null;

  const result = await db.execute({
    sql: `
      SELECT j.id_jurnal, j.id_presensi_mapel, j.materi_disampaikan, j.kendala,
             j.tindak_lanjut, j.paraf_nama, j.paraf_operator, j.paraf_at,
             j.created_at, j.updated_at,
             p.tanggal, p.jam_ke, p.materi_pokok, p.id_rombel, p.id_mapel, p.id_guru,
             m.nama_mapel, r.nama_rombel, g.nama as nama_guru
      FROM jurnal_mengajar j
      JOIN presensi_mapel p ON p.id_presensi_mapel = j.id_presensi_mapel
      LEFT JOIN akademik_mapel m ON m.id_mapel = p.id_mapel
      LEFT JOIN akademik_rombel r ON r.id_rombel = p.id_rombel
      LEFT JOIN master_data g ON g.id_unik = p.id_guru
      WHERE (? IS NULL OR p.id_rombel = ?)
        AND (? IS NULL OR p.id_mapel = ?)
        AND (? IS NULL OR p.id_guru = ?)
        AND (? IS NULL OR p.tanggal >= ?)
        AND (? IS NULL OR p.tanggal <= ?)
      ORDER BY p.tanggal DESC, CAST(p.jam_ke AS INTEGER) DESC
      LIMIT ?;
    `,
    args: [
      idRombel,
      idRombel,
      idMapel,
      idMapel,
      idGuru,
      idGuru,
      tanggalMulai,
      tanggalMulai,
      tanggalSelesai,
      tanggalSelesai,
      limit,
    ],
  });

  return result.rows.map((row) => ({
    id_jurnal: String(row.id_jurnal),
    id_presensi_mapel: String(row.id_presensi_mapel),
    materi_disampaikan: row.materi_disampaikan
      ? String(row.materi_disampaikan)
      : null,
    kendala: row.kendala ? String(row.kendala) : null,
    tindak_lanjut: row.tindak_lanjut ? String(row.tindak_lanjut) : null,
    paraf_nama: row.paraf_nama ? String(row.paraf_nama) : null,
    paraf_operator: String(row.paraf_operator),
    paraf_at: String(row.paraf_at),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
    tanggal: row.tanggal ? String(row.tanggal) : undefined,
    jam_ke: row.jam_ke ? String(row.jam_ke) : undefined,
    materi_pokok: row.materi_pokok ? String(row.materi_pokok) : undefined,
    id_rombel: row.id_rombel ? String(row.id_rombel) : undefined,
    id_mapel: row.id_mapel ? String(row.id_mapel) : undefined,
    id_guru: row.id_guru ? String(row.id_guru) : undefined,
    nama_mapel: row.nama_mapel ? String(row.nama_mapel) : undefined,
    nama_rombel: row.nama_rombel ? String(row.nama_rombel) : undefined,
    nama_guru: row.nama_guru ? String(row.nama_guru) : undefined,
  }));
}

export async function saveTeachingJournal(
  sessionOperator: string,
  draft: {
    id_jurnal?: string;
    id_presensi_mapel: string;
    materi_disampaikan?: string | null;
    kendala?: string | null;
    tindak_lanjut?: string | null;
    paraf_nama?: string | null;
  },
) {
  await ensureDbInitialized();
  const idPresensi = String(draft.id_presensi_mapel || "").trim();
  if (!idPresensi) {
    throw new ApiRequestError("Tautan sesi presensi mapel wajib diisi.", 400);
  }

  const operator = String(sessionOperator || "").trim();
  if (!operator) {
    throw new ApiRequestError(
      "Sesi operator tidak valid untuk memaraf jurnal.",
      400,
    );
  }

  const sessionCheck = await db.execute({
    sql: "SELECT 1 FROM presensi_mapel WHERE id_presensi_mapel = ? LIMIT 1;",
    args: [idPresensi],
  });
  if (sessionCheck.rows.length === 0) {
    throw new ApiRequestError("Sesi presensi pelajaran tidak ditemukan.", 404);
  }

  const existingRes = await db.execute({
    sql: "SELECT id_jurnal FROM jurnal_mengajar WHERE id_presensi_mapel = ? LIMIT 1;",
    args: [idPresensi],
  });

  const existingId = existingRes.rows[0]?.id_jurnal
    ? String(existingRes.rows[0].id_jurnal)
    : null;

  const id =
    draft.id_jurnal?.trim() ||
    existingId ||
    `jrn_${crypto.randomUUID().replace(/-/g, "")}`;

  await db.execute({
    sql: `
      INSERT INTO jurnal_mengajar (
        id_jurnal, id_presensi_mapel, materi_disampaikan, kendala, tindak_lanjut,
        paraf_nama, paraf_operator, paraf_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'), datetime('now'))
      ON CONFLICT(id_jurnal) DO UPDATE SET
        id_presensi_mapel = excluded.id_presensi_mapel,
        materi_disampaikan = excluded.materi_disampaikan,
        kendala = excluded.kendala,
        tindak_lanjut = excluded.tindak_lanjut,
        paraf_nama = excluded.paraf_nama,
        paraf_operator = excluded.paraf_operator,
        paraf_at = excluded.paraf_at,
        updated_at = excluded.updated_at;
    `,
    args: [
      id,
      idPresensi,
      draft.materi_disampaikan?.trim() || null,
      draft.kendala?.trim() || null,
      draft.tindak_lanjut?.trim() || null,
      draft.paraf_nama?.trim() || null,
      operator,
    ],
  });

  return { sukses: true, id_jurnal: id };
}

export async function deleteTeachingJournal(idJurnal: string) {
  await ensureDbInitialized();
  const cleanId = String(idJurnal || "").trim();
  if (!cleanId) {
    throw new ApiRequestError("ID Jurnal wajib diisi.", 400);
  }

  const check = await db.execute({
    sql: "SELECT 1 FROM jurnal_mengajar WHERE id_jurnal = ? LIMIT 1;",
    args: [cleanId],
  });
  if (check.rows.length === 0) {
    throw new ApiRequestError("Jurnal mengajar tidak ditemukan.", 404);
  }

  await db.execute({
    sql: "DELETE FROM jurnal_mengajar WHERE id_jurnal = ?;",
    args: [cleanId],
  });

  return { sukses: true };
}
