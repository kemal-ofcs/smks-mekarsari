import "server-only";

import type { Client } from "@libsql/client";
import type {
  NilaiSiswaItem,
  PenilaianDetail,
  PenilaianDraft,
  PenilaianFilter,
  PenilaianItem,
  SimpanNilaiDraft,
} from "@/types/grades";
import { JENIS_PENILAIAN, SEMESTER_LIST } from "@/types/grades";

/**
 * Sisi Web modul nilai — cerminan TypeScript dari `grades.rs`.
 *
 * Keduanya melayani halaman yang sama pada dua build berbeda: Desktop lewat
 * command Rust yang menulis ke SQLite lokal + outbox, Web lewat route handler
 * ini yang menulis langsung ke Turso. Aturannya WAJIB tetap sepadan — terutama
 * dua hal:
 *
 *   1. `skor` NULL berarti BELUM DINILAI, bukan nol. Tidak ada `?? 0` di
 *      berkas ini, dan tidak boleh ada.
 *   2. `kkm` dibekukan saat penilaian dibuat; pembaruan tidak menyentuhnya.
 */

export class GradeValidationError extends Error {
  readonly code = "VALIDATION_ERROR";
  readonly status = 400;

  constructor(message: string) {
    super(message);
    this.name = "GradeValidationError";
  }
}

export class GradeNotFoundError extends Error {
  readonly code = "NOT_FOUND";
  readonly status = 404;

  constructor(message: string) {
    super(message);
    this.name = "GradeNotFoundError";
  }
}

function buatIdNilai(prefix: string): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `${prefix}${Math.floor(Date.now() / 1000)}-${hex}`;
}

function teksWajib(nilai: unknown, pesan: string): string {
  const teks = String(nilai ?? "").trim();
  if (!teks) throw new GradeValidationError(pesan);
  return teks;
}

export async function listAssessments(
  client: Client,
  filter: PenilaianFilter,
): Promise<{ items: PenilaianItem[] }> {
  let query = `
    SELECT p.id_penilaian, p.id_tahun_ajaran, p.semester, p.id_rombel,
           p.id_mapel, p.id_guru, p.jenis, p.nama_penilaian, p.tanggal,
           p.bobot, p.kkm, p.nilai_maks, p.catatan, p.created_at, p.updated_at,
           COALESCE(m.nama_mapel, '') AS nama_mapel,
           (SELECT COUNT(*) FROM nilai_siswa n WHERE n.id_penilaian = p.id_penilaian)
             AS jumlah_siswa,
           (SELECT COUNT(*) FROM nilai_siswa n
             WHERE n.id_penilaian = p.id_penilaian AND n.skor IS NOT NULL)
             AS jumlah_dinilai,
           (SELECT AVG(n.skor) FROM nilai_siswa n
             WHERE n.id_penilaian = p.id_penilaian AND n.skor IS NOT NULL)
             AS rata_rata
      FROM nilai_penilaian p
      LEFT JOIN akademik_mapel m ON m.id_mapel = p.id_mapel
     WHERE p.id_tahun_ajaran = ? AND p.semester = ? AND p.id_rombel = ?`;
  const args: string[] = [
    filter.id_tahun_ajaran,
    filter.semester,
    filter.id_rombel,
  ];

  const mapel = String(filter.id_mapel ?? "").trim();
  if (mapel) {
    query += " AND p.id_mapel = ?";
    args.push(mapel);
  }
  query += " ORDER BY p.tanggal DESC, p.created_at DESC LIMIT 300;";

  const res = await client.execute({ sql: query, args });
  return { items: res.rows as unknown as PenilaianItem[] };
}

/**
 * Satu penilaian beserta roster lengkap rombelnya.
 *
 * Roster diambil dari `siswa_data` dan di-LEFT JOIN ke `nilai_siswa`, bukan
 * sebaliknya: siswa yang belum punya baris nilai tetap harus muncul di layar
 * guru dengan kolom kosong. Mengambil dari `nilai_siswa` saja menyembunyikan
 * anak yang justru paling perlu dinilai.
 */
export async function getAssessment(
  client: Client,
  idPenilaian: string,
): Promise<PenilaianDetail> {
  const kepala = await client.execute({
    sql: `SELECT p.id_penilaian, p.id_tahun_ajaran, p.semester, p.id_rombel,
                 p.id_mapel, p.id_guru, p.jenis, p.nama_penilaian, p.tanggal,
                 p.bobot, p.kkm, p.nilai_maks, p.catatan,
                 p.created_at, p.updated_at,
                 COALESCE(m.nama_mapel, '') AS nama_mapel,
                 COALESCE(r.nama_rombel, '') AS nama_rombel
            FROM nilai_penilaian p
            LEFT JOIN akademik_mapel m ON m.id_mapel = p.id_mapel
            LEFT JOIN akademik_rombel r ON r.id_rombel = p.id_rombel
           WHERE p.id_penilaian = ?
           LIMIT 1;`,
    args: [idPenilaian],
  });

  const baris = kepala.rows[0];
  if (!baris) throw new GradeNotFoundError("Penilaian tidak ditemukan.");

  const roster = await client.execute({
    sql: `SELECT s.id_siswa, s.nama_lengkap, COALESCE(s.nis, '') AS nis,
                 n.id_nilai, n.skor, n.keterangan
            FROM siswa_data s
            LEFT JOIN nilai_siswa n
                   ON n.id_siswa = s.id_siswa AND n.id_penilaian = ?
           WHERE s.id_rombel = ? AND s.status = 'Aktif'
        ORDER BY s.nama_lengkap ASC
           LIMIT 200;`,
    args: [idPenilaian, String(baris.id_rombel)],
  });

  return {
    penilaian: baris as unknown as PenilaianDetail["penilaian"],
    items: roster.rows as unknown as NilaiSiswaItem[],
  };
}

export async function saveAssessment(
  client: Client,
  draft: PenilaianDraft,
): Promise<{ idPenilaian: string }> {
  const idMasuk = String(draft.id_penilaian ?? "").trim();
  const baru = !idMasuk;
  const id = idMasuk || buatIdNilai("nil-");

  const idTahunAjaran = teksWajib(
    draft.id_tahun_ajaran,
    "Tahun ajaran wajib diisi.",
  );
  const idRombel = teksWajib(draft.id_rombel, "Rombel wajib diisi.");
  const idMapel = teksWajib(draft.id_mapel, "Mata pelajaran wajib diisi.");
  const idGuru = teksWajib(draft.id_guru, "Guru pengampu wajib diisi.");
  const nama = teksWajib(draft.nama_penilaian, "Nama penilaian wajib diisi.");
  const tanggal = teksWajib(draft.tanggal, "Tanggal penilaian wajib diisi.");

  // Enum ditolak bila asing, TIDAK dinormalkan. Nilai yang lolos di sini
  // tetapi ditolak CHECK constraint akan gagal saat INSERT — dan pada jalur
  // Desktop, menghentikan push-nya permanen.
  if (!(SEMESTER_LIST as readonly string[]).includes(draft.semester)) {
    throw new GradeValidationError("Semester tidak dikenal.");
  }
  if (!(JENIS_PENILAIAN as readonly string[]).includes(draft.jenis)) {
    throw new GradeValidationError("Jenis penilaian tidak dikenal.");
  }

  const bobot = Math.min(100, Math.max(1, Number(draft.bobot ?? 1)));
  const nilaiMaks = Math.min(
    1000,
    Math.max(1, Number(draft.nilai_maks ?? 100)),
  );

  // Keunikan ditegakkan di APLIKASI, bukan UNIQUE constraint: tabel ini
  // melewati outbox pada jalur Desktop, dan UNIQUE akan mematikan push
  // perangkat kedua secara permanen.
  const bentrok = await client.execute({
    sql: `SELECT nama_penilaian FROM nilai_penilaian
           WHERE id_tahun_ajaran = ? AND semester = ? AND id_rombel = ?
             AND id_mapel = ? AND LOWER(TRIM(nama_penilaian)) = LOWER(TRIM(?))
             AND id_penilaian <> ?
           LIMIT 1;`,
    args: [idTahunAjaran, draft.semester, idRombel, idMapel, nama, id],
  });
  if (bentrok.rows[0]) {
    throw new GradeValidationError(
      `Penilaian bernama '${String(bentrok.rows[0].nama_penilaian)}' sudah ada pada mata pelajaran dan rombel ini di semester yang sama.`,
    );
  }

  // KKM dibekukan: hanya diambil dari draft/mapel saat baris BARU dibuat.
  let kkm: number;
  if (baru) {
    const bawaan = await client.execute({
      sql: "SELECT kkm FROM akademik_mapel WHERE id_mapel = ? LIMIT 1;",
      args: [idMapel],
    });
    kkm = Math.min(
      100,
      Math.max(0, Number(draft.kkm ?? bawaan.rows[0]?.kkm ?? 75)),
    );
  } else {
    const tersimpan = await client.execute({
      sql: "SELECT kkm FROM nilai_penilaian WHERE id_penilaian = ? LIMIT 1;",
      args: [id],
    });
    kkm = Number(tersimpan.rows[0]?.kkm ?? 75);
  }

  await client.execute({
    sql: `INSERT INTO nilai_penilaian (
            id_penilaian, id_tahun_ajaran, semester, id_rombel, id_mapel, id_guru,
            jenis, nama_penilaian, tanggal, bobot, kkm, nilai_maks, catatan,
            created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
          ON CONFLICT(id_penilaian) DO UPDATE SET
            id_tahun_ajaran = excluded.id_tahun_ajaran,
            semester = excluded.semester,
            id_rombel = excluded.id_rombel,
            id_mapel = excluded.id_mapel,
            id_guru = excluded.id_guru,
            jenis = excluded.jenis,
            nama_penilaian = excluded.nama_penilaian,
            tanggal = excluded.tanggal,
            bobot = excluded.bobot,
            nilai_maks = excluded.nilai_maks,
            catatan = excluded.catatan,
            updated_at = excluded.updated_at;`,
    args: [
      id,
      idTahunAjaran,
      draft.semester,
      idRombel,
      idMapel,
      idGuru,
      draft.jenis,
      nama,
      tanggal,
      bobot,
      kkm,
      nilaiMaks,
      draft.catatan?.trim() || null,
    ],
  });

  return { idPenilaian: id };
}

/**
 * Simpan skor satu kelas sekaligus, dalam SATU batch transaksional.
 *
 * Kegagalan di tengah tidak boleh meninggalkan separuh kelas tersimpan: guru
 * tidak punya cara mengetahui mana yang sudah masuk.
 */
export async function saveScores(
  client: Client,
  draft: SimpanNilaiDraft,
): Promise<{ tersimpan: number }> {
  const idPenilaian = teksWajib(
    draft.id_penilaian,
    "Penilaian wajib dipilih sebelum menyimpan nilai.",
  );

  const kepala = await client.execute({
    sql: "SELECT nilai_maks FROM nilai_penilaian WHERE id_penilaian = ? LIMIT 1;",
    args: [idPenilaian],
  });
  const barisKepala = kepala.rows[0];
  if (!barisKepala) throw new GradeNotFoundError("Penilaian tidak ditemukan.");
  const nilaiMaks = Number(barisKepala.nilai_maks ?? 100);

  const tersedia = await client.execute({
    sql: "SELECT id_nilai, id_siswa FROM nilai_siswa WHERE id_penilaian = ? LIMIT 400;",
    args: [idPenilaian],
  });
  const idPerSiswa = new Map<string, string>(
    tersedia.rows.map((baris) => [
      String(baris.id_siswa),
      String(baris.id_nilai),
    ]),
  );

  const pernyataan = [];
  for (const item of draft.items ?? []) {
    const idSiswa = String(item.id_siswa ?? "").trim();
    if (!idSiswa) continue;

    // `null` DISIMPAN sebagai NULL, bukan dilewati dan bukan diubah jadi nol.
    // Guru yang mengosongkan kembali sebuah nilai berhak mengembalikan anak itu
    // ke keadaan "belum dinilai".
    const skor =
      item.skor === null || item.skor === undefined ? null : Number(item.skor);
    if (
      skor !== null &&
      (!Number.isFinite(skor) || skor < 0 || skor > nilaiMaks)
    ) {
      throw new GradeValidationError(
        `Nilai ${item.skor} di luar rentang yang diizinkan (0 sampai ${nilaiMaks}).`,
      );
    }

    const idNilai = idPerSiswa.get(idSiswa) ?? buatIdNilai("nis-");
    pernyataan.push({
      sql: `INSERT INTO nilai_siswa (
              id_nilai, id_penilaian, id_siswa, skor, keterangan, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))
            ON CONFLICT(id_nilai) DO UPDATE SET
              skor = excluded.skor,
              keterangan = excluded.keterangan,
              updated_at = excluded.updated_at;`,
      args: [
        idNilai,
        idPenilaian,
        idSiswa,
        skor,
        item.keterangan?.trim() || null,
      ],
    });
  }

  if (pernyataan.length > 0) {
    await client.batch(pernyataan, "write");
  }
  return { tersimpan: pernyataan.length };
}

/**
 * Hapus penilaian beserta seluruh nilainya, atomik.
 *
 * Detailnya dihapus lebih dulu dalam batch yang sama. Tidak ada FOREIGN KEY
 * yang melakukannya — tabel tersinkronisasi sengaja tanpa FK.
 */
export async function deleteAssessment(
  client: Client,
  idPenilaian: string,
): Promise<void> {
  const ada = await client.execute({
    sql: "SELECT id_penilaian FROM nilai_penilaian WHERE id_penilaian = ? LIMIT 1;",
    args: [idPenilaian],
  });
  if (!ada.rows[0]) throw new GradeNotFoundError("Penilaian tidak ditemukan.");

  await client.batch(
    [
      {
        sql: "DELETE FROM nilai_siswa WHERE id_penilaian = ?;",
        args: [idPenilaian],
      },
      {
        sql: "DELETE FROM nilai_penilaian WHERE id_penilaian = ?;",
        args: [idPenilaian],
      },
    ],
    "write",
  );
}
