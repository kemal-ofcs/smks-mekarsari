import "server-only";

import type { Client } from "@libsql/client";
import type {
  PmbFileContent,
  PmbRegistrantDetail,
  PmbRegistrantFilter,
  PmbRegistrantItem,
  PmbWave,
  PmbWaveDraft,
} from "@/types/pmb";
import { PMB_STATUS_MANUAL } from "@/types/pmb";

/**
 * Sisi sekolah untuk PMB — cerminan TypeScript dari metode PMB di `turso.rs`.
 *
 * Keduanya melayani halaman yang sama pada dua build berbeda: Desktop lewat
 * command Rust, Web lewat route handler ini. Query-nya WAJIB tetap sepadan —
 * kalau tidak, panitia yang membuka halaman dari panel admin akan melihat
 * daftar yang berbeda dari panitia yang membukanya dari aplikasi Desktop, pada
 * database yang sama persis.
 *
 * Ketiga tabelnya cloud-only dan tidak pernah lewat outbox, jadi tidak ada
 * `enqueue` di sini sama sekali.
 */

export class PmbValidationError extends Error {
  readonly code = "VALIDATION_ERROR";
  readonly status = 400;

  constructor(message: string) {
    super(message);
    this.name = "PmbValidationError";
  }
}

export class PmbNotFoundError extends Error {
  readonly code = "NOT_FOUND";
  readonly status = 404;

  constructor(message: string) {
    super(message);
    this.name = "PmbNotFoundError";
  }
}

function teksWajib(nilai: unknown, pesan: string): string {
  const teks = String(nilai ?? "").trim();
  if (!teks) throw new PmbValidationError(pesan);
  return teks;
}

/**
 * Id baris PMB: `<prefix>-<epoch detik>-<48 bit acak>`.
 *
 * Bentuk yang sama dengan `new_pmb_id` di `turso.rs` dan `buatIdPendaftar` di
 * web-public. Bagian acaknya yang menjamin keunikan — id epoch telanjang sudah
 * pernah bertabrakan di repo ini, di dalam satu penyimpanan massal.
 */
function buatIdPmb(prefix: string): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `${prefix}-${Math.floor(Date.now() / 1000)}-${hex}`;
}

export async function listPmbWaves(client: Client): Promise<PmbWave[]> {
  const res = await client.execute(
    `SELECT g.id_gelombang, g.nama, g.tahun_ajaran, g.tanggal_buka,
            g.tanggal_tutup, g.kuota, g.biaya_pendaftaran, g.is_aktif,
            g.created_at, g.updated_at,
            (SELECT COUNT(*) FROM pmb_pendaftar p
              WHERE p.id_gelombang = g.id_gelombang
                AND p.status NOT IN ('Ditolak', 'Dibatalkan')) AS terpakai
       FROM pmb_gelombang g
   ORDER BY g.tanggal_buka DESC
      LIMIT 200;`,
  );
  return res.rows as unknown as PmbWave[];
}

/**
 * Simpan gelombang dengan aturan aktif-tunggal yang ATOMIK.
 *
 * Penonaktifan gelombang lain ikut dalam batch yang sama — pola idempoten yang
 * sudah dipakai `akademik_tahun_ajaran.is_aktif`. Dua gelombang aktif sekaligus
 * membuat situs publik memilih salah satunya berdasarkan urutan tanggal, dan
 * pendaftar akan masuk ke gelombang yang tidak diniatkan panitia tanpa ada yang
 * menyadarinya sampai rekapnya dibuat.
 */
export async function savePmbWave(
  client: Client,
  draft: PmbWaveDraft,
): Promise<{ idGelombang: string }> {
  const nama = teksWajib(draft.nama, "Nama gelombang wajib diisi.");
  const tahunAjaran = teksWajib(
    draft.tahunAjaran,
    "Tahun ajaran gelombang wajib diisi.",
  );
  const tanggalBuka = teksWajib(draft.tanggalBuka, "Tanggal buka wajib diisi.");
  const tanggalTutup = teksWajib(
    draft.tanggalTutup,
    "Tanggal tutup wajib diisi.",
  );

  if (tanggalTutup < tanggalBuka) {
    throw new PmbValidationError(
      "Tanggal tutup tidak boleh mendahului tanggal buka.",
    );
  }

  const id = String(draft.idGelombang ?? "").trim() || buatIdPmb("gel");
  const aktif = draft.isAktif ? 1 : 0;

  const statements = [
    {
      sql: `INSERT INTO pmb_gelombang (
              id_gelombang, nama, tahun_ajaran, tanggal_buka, tanggal_tutup,
              kuota, biaya_pendaftaran, is_aktif, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
            ON CONFLICT(id_gelombang) DO UPDATE SET
              nama = excluded.nama,
              tahun_ajaran = excluded.tahun_ajaran,
              tanggal_buka = excluded.tanggal_buka,
              tanggal_tutup = excluded.tanggal_tutup,
              kuota = excluded.kuota,
              biaya_pendaftaran = excluded.biaya_pendaftaran,
              is_aktif = excluded.is_aktif,
              updated_at = datetime('now');`,
      args: [
        id,
        nama,
        tahunAjaran,
        tanggalBuka,
        tanggalTutup,
        Math.max(0, Number(draft.kuota ?? 0)),
        Math.max(0, Number(draft.biayaPendaftaran ?? 0)),
        aktif,
      ],
    },
  ];

  if (aktif === 1) {
    statements.push({
      sql: "UPDATE pmb_gelombang SET is_aktif = 0, updated_at = datetime('now') WHERE id_gelombang <> ?;",
      args: [id],
    });
  }

  await client.batch(statements, "write");
  return { idGelombang: id };
}

/**
 * Hapus gelombang yang belum pernah dipakai mendaftar.
 *
 * `pmb_pendaftar.id_gelombang` sengaja tanpa foreign key, jadi tidak ada apa pun
 * di tingkat database yang mencegah gelombang berisi pendaftar ikut hilang.
 * Aturannya ditegakkan di lapisan aplikasi, di sini dan di `turso.rs`.
 */
export async function deletePmbWave(
  client: Client,
  idGelombang: string,
): Promise<void> {
  const terpakai = await client.execute({
    sql: "SELECT COUNT(*) AS total FROM pmb_pendaftar WHERE id_gelombang = ?;",
    args: [idGelombang],
  });
  const total = Number(terpakai.rows[0]?.total ?? 0);
  if (total > 0) {
    throw new PmbValidationError(
      `Gelombang ini sudah memiliki ${total} pendaftar dan tidak dapat dihapus. Nonaktifkan saja bila sudah tidak dipakai.`,
    );
  }

  await client.execute({
    sql: "DELETE FROM pmb_gelombang WHERE id_gelombang = ?;",
    args: [idGelombang],
  });
}

/**
 * Daftar pendaftar — TANPA isi berkas, hanya jumlahnya.
 *
 * Satu berkas sampai 500 KB; seratus pendaftar akan membuat balasannya puluhan
 * megabyte, dan halaman ini dibuka panitia berkali-kali sehari. Aturan yang
 * sama dengan `photo_base64` di riwayat reset password.
 */
export async function listPmbRegistrants(
  client: Client,
  filter: PmbRegistrantFilter = {},
): Promise<{ items: PmbRegistrantItem[] }> {
  let query = `
    SELECT p.id_pendaftar, p.nomor_pendaftaran, p.id_gelombang, p.nama_lengkap,
           p.nisn, p.jenis_kelamin, p.asal_sekolah, p.pilihan_jurusan,
           p.nama_wali, p.no_whatsapp_wali, p.status, p.id_siswa,
           p.created_at, p.updated_at,
           COALESCE(g.nama, '') AS nama_gelombang,
           (SELECT COUNT(*) FROM pmb_berkas b
             WHERE b.id_pendaftar = p.id_pendaftar) AS jumlah_berkas
      FROM pmb_pendaftar p
      LEFT JOIN pmb_gelombang g ON g.id_gelombang = p.id_gelombang
     WHERE 1=1`;
  const args: (string | number)[] = [];

  const gelombang = String(filter.id_gelombang ?? "").trim();
  if (gelombang && gelombang !== "Semua") {
    query += " AND p.id_gelombang = ?";
    args.push(gelombang);
  }

  const status = String(filter.status ?? "").trim();
  if (status && status !== "Semua") {
    query += " AND p.status = ?";
    args.push(status);
  }

  const search = String(filter.search ?? "").trim();
  if (search) {
    query +=
      " AND (p.nama_lengkap LIKE ? OR p.nomor_pendaftaran LIKE ? OR p.nisn LIKE ? OR p.nama_wali LIKE ?)";
    const pattern = `%${search}%`;
    args.push(pattern, pattern, pattern, pattern);
  }

  const limit = Math.min(500, Math.max(1, Number(filter.limit ?? 100)));
  query += ` ORDER BY p.created_at DESC LIMIT ${limit};`;

  const res = await client.execute({ sql: query, args });
  return { items: res.rows as unknown as PmbRegistrantItem[] };
}

export async function getPmbRegistrant(
  client: Client,
  idPendaftar: string,
): Promise<PmbRegistrantDetail> {
  const pendaftar = await client.execute({
    sql: `SELECT p.*, COALESCE(g.nama, '') AS nama_gelombang
            FROM pmb_pendaftar p
            LEFT JOIN pmb_gelombang g ON g.id_gelombang = p.id_gelombang
           WHERE p.id_pendaftar = ?
           LIMIT 1;`,
    args: [idPendaftar],
  });

  const baris = pendaftar.rows[0];
  if (!baris) throw new PmbNotFoundError("Data pendaftar tidak ditemukan.");

  const berkas = await client.execute({
    sql: `SELECT id_berkas, jenis, nama_file, mime, ukuran_byte, created_at
            FROM pmb_berkas
           WHERE id_pendaftar = ?
        ORDER BY jenis ASC
           LIMIT 20;`,
    args: [idPendaftar],
  });

  return {
    pendaftar: baris as unknown as PmbRegistrantDetail["pendaftar"],
    berkas: berkas.rows as unknown as PmbRegistrantDetail["berkas"],
  };
}

/** Satu berkas beserta isinya, diambil saat panitia benar-benar membukanya. */
export async function getPmbFile(
  client: Client,
  idBerkas: string,
): Promise<PmbFileContent> {
  const res = await client.execute({
    sql: "SELECT id_berkas, jenis, nama_file, mime, ukuran_byte, konten_base64 FROM pmb_berkas WHERE id_berkas = ? LIMIT 1;",
    args: [idBerkas],
  });

  const baris = res.rows[0];
  if (!baris) throw new PmbNotFoundError("Berkas tidak ditemukan.");
  return baris as unknown as PmbFileContent;
}

export async function updatePmbStatus(
  client: Client,
  idPendaftar: string,
  status: string,
  catatan: string | null,
  operator: string,
): Promise<void> {
  if (!(PMB_STATUS_MANUAL as readonly string[]).includes(status)) {
    throw new PmbValidationError("Status pendaftar tidak dikenali.");
  }

  const hasil = await client.execute({
    sql: `UPDATE pmb_pendaftar
             SET status = ?,
                 catatan_verifikator = ?,
                 diverifikasi_oleh = ?,
                 diverifikasi_at = datetime('now'),
                 updated_at = datetime('now')
           WHERE id_pendaftar = ?
             AND status <> 'Terdaftar';`,
    args: [status, catatan?.trim() || null, operator, idPendaftar],
  });

  if (Number(hasil.rowsAffected ?? 0) === 0) {
    throw new PmbValidationError(
      "Pendaftar tidak ditemukan, atau sudah terlanjur diangkat menjadi siswa.",
    );
  }
}

/**
 * Tandai pendaftar sudah menjadi siswa.
 *
 * Syarat `status = 'Diterima'` di klausa WHERE adalah pencegah promosi ganda
 * yang sebenarnya: menyembunyikan tombolnya di UI hanya menyembunyikannya dari
 * orang yang sopan, sementara dua klik cepat pada perangkat lambat tetap
 * mengirim dua permintaan.
 */
export async function markPmbRegistered(
  client: Client,
  idPendaftar: string,
  idSiswa: string,
): Promise<void> {
  const hasil = await client.execute({
    sql: `UPDATE pmb_pendaftar
             SET status = 'Terdaftar',
                 id_siswa = ?,
                 updated_at = datetime('now')
           WHERE id_pendaftar = ?
             AND status = 'Diterima';`,
    args: [idSiswa, idPendaftar],
  });

  if (Number(hasil.rowsAffected ?? 0) === 0) {
    throw new PmbValidationError(
      "Hanya pendaftar berstatus 'Diterima' yang dapat diangkat menjadi siswa.",
    );
  }
}

/**
 * Hapus pendaftar beserta seluruh berkasnya.
 *
 * `pmb_berkas` ber-CASCADE, jadi berkasnya ikut terhapus oleh database.
 * Pendaftar yang sudah menjadi siswa TIDAK boleh dihapus: barisnya adalah
 * satu-satunya jejak dari mana siswa itu berasal.
 */
export async function deletePmbRegistrant(
  client: Client,
  idPendaftar: string,
): Promise<void> {
  const hasil = await client.execute({
    sql: "DELETE FROM pmb_pendaftar WHERE id_pendaftar = ? AND status <> 'Terdaftar';",
    args: [idPendaftar],
  });

  if (Number(hasil.rowsAffected ?? 0) === 0) {
    throw new PmbValidationError(
      "Pendaftar tidak ditemukan, atau sudah menjadi siswa sehingga jejaknya dipertahankan.",
    );
  }
}
