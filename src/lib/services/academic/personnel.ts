import "server-only";

import { db, ensureDbInitialized } from "@/lib/db";
import { ApiRequestError } from "@/lib/server/http/api-response";
import {
  assertUniqueValue,
  chosenShift,
  ensureScanToken,
  normalizeWaliPhone,
} from "./shared";

/**
 * Personil akademik: guru (PTK) dan siswa, termasuk foto dan backfill kartu identitasnya.
 *
 * Dipecah dari `services/academic.ts` yang tumbuh sampai 1.434 baris berisi
 * sepuluh entitas. Jalur impornya TIDAK berubah — `@/lib/services/academic`
 * kini sebuah direktori dengan `index.ts` sebagai barelnya, sehingga 22 route
 * handler yang mengimpornya tidak perlu disentuh sama sekali.
 */

// ── 6. Guru (PTK) ───────────────────────────────────────────────────────────

export async function getTeachers() {
  await ensureDbInitialized();
  const sql = `
    SELECT g.id_guru, g.nip, g.nuptk, g.gelar, g.spesialisasi_mapel, g.status_kepegawaian,
           g.created_at, g.updated_at,
           m.kode_karyawan, m.nama, m.divisi, m.jabatan_status, m.no_hp, m.lp,
           m.status_aktif, m.id_shift, m.token_absensi, m.qr_code, m.status_qr, m.unit
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
  unit?: string;
}) {
  await ensureDbInitialized();
  const id = draft.id_guru || `ptk_${crypto.randomUUID().replace(/-/g, "")}`;
  const statusAktif = draft.status_aktif || "Aktif";
  // Cadangannya ID UTUH, bukan irisannya. `id.slice(4, 10)` dulu mengasumsikan
  // setiap ID berawalan `ptk_` buatan sistem; begitu operator mengetik ID
  // sendiri lewat formulir atau impor Excel, irisan itu mencomot enam karakter
  // acak dari tengah ID-nya. `kode_karyawan` UNIQUE, dan ID sudah primary key,
  // jadi memakainya utuh sekaligus menjamin keunikan yang tidak dijamin irisan.
  const kode = draft.kode_karyawan || draft.nip || id;
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
        status_qr, jenis_personil, unit, status_backup
      ) VALUES (?, ?, ?, 'Tenaga Pengajar', 'Guru', ?, ?, COALESCE(?, 1), ?, date('now','+7 hours'), 'Data PTK Sekolah', ?, ?, 'Generated', 'GURU', NULLIF(?, ''), 'NORMAL')
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
        jenis_personil = 'GURU',
        -- Draft tanpa unit tidak boleh mengosongkan unit tersimpan; pola yang
        -- sama dengan id_shift di atas.
        unit = COALESCE(NULLIF(?, ''), master_data.unit);
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
          draft.unit || "",
          idShift,
          draft.unit || "",
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
           m.token_absensi, m.qr_code, m.status_qr, m.id_shift, m.unit,
           m.kode_karyawan
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
  kode_karyawan?: string;
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
  unit?: string;
}) {
  await ensureDbInitialized();
  const id = draft.id_siswa || `sis_${crypto.randomUUID().replace(/-/g, "")}`;
  // Sama seperti guru: ID utuh, bukan irisannya. Lihat catatan di simpanGuru.
  const kode = draft.kode_karyawan || draft.nis || id;
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
        status_qr, jenis_personil, unit, status_backup
      ) VALUES (?, ?, ?, 'Peserta Didik', 'Siswa', ?, COALESCE(?, 1), ?, date('now','+7 hours'), 'Data Siswa Sekolah', ?, ?, 'Generated', 'SISWA', NULLIF(?, ''), 'NORMAL')
      ON CONFLICT(id_unik) DO UPDATE SET
        kode_karyawan = excluded.kode_karyawan,
        nama = excluded.nama,
        lp = excluded.lp,
        id_shift = COALESCE(?, master_data.id_shift),
        status_aktif = excluded.status_aktif,
        token_absensi = excluded.token_absensi,
        qr_code = excluded.qr_code,
        status_qr = excluded.status_qr,
        jenis_personil = 'SISWA',
        -- Lihat catatan di saveTeacher.
        unit = COALESCE(NULLIF(?, ''), master_data.unit);
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
          draft.unit || "",
          idShift,
          draft.unit || "",
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
