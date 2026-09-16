import "server-only";

import type { Client } from "@libsql/client";
import type {
  ArticleDetail,
  ArticleDraft,
  ArticleFilter,
  ArticleItem,
  ArticleListResponse,
  PageContentMap,
} from "@/types/content";

/**
 * Service CMS Landing Page (Berita & Konten Publik) sisi sekolah.
 * Cerminan TypeScript dari metode di `turso.rs` untuk jalur Web (Next.js server).
 *
 * Kedua tabel (berita, konten_publik) adalah Cloud-Only dan tidak masuk
 * SNAPSHOT_TABLES maupun outbox sync SQLite perangkat.
 */

export class ContentValidationError extends Error {
  readonly code = "VALIDATION_ERROR";
  readonly status = 400;

  constructor(message: string) {
    super(message);
    this.name = "ContentValidationError";
  }
}

export class ContentNotFoundError extends Error {
  readonly code = "NOT_FOUND";
  readonly status = 404;

  constructor(message: string) {
    super(message);
    this.name = "ContentNotFoundError";
  }
}

function teksWajib(nilai: unknown, pesan: string): string {
  const teks = String(nilai ?? "").trim();
  if (!teks) throw new ContentValidationError(pesan);
  return teks;
}

/**
 * Pembuatan ID unik artikel: `berita-<epoch detik>-<48 bit acak>`.
 */
function buatIdBerita(): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `berita-${Math.floor(Date.now() / 1000)}-${hex}`;
}

/**
 * Normalisasi judul menjadi slug URL yang bersih.
 */
function slugify(judul: string): string {
  return judul
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Validasi MIME type dan batas ukuran base64 gambar sampul (maks ~500 KB / 750.000 karakter).
 * Mematuhi Aturan 43 pencegahan payload cacat.
 */
function validasiGambarSampul(gambarBase64?: string | null): string | null {
  if (!gambarBase64 || !gambarBase64.trim()) {
    return null;
  }
  const clean = gambarBase64.trim();
  if (clean.length > 750_000) {
    throw new ContentValidationError(
      "Ukuran gambar sampul terlalu besar (maksimal 500 KB). Silakan kompres gambar terlebih dahulu.",
    );
  }
  if (!clean.startsWith("data:image/")) {
    throw new ContentValidationError(
      "Format gambar sampul tidak valid. Gunakan data URI gambar yang valid (JPEG, PNG, atau WebP).",
    );
  }
  const mimeMatch = clean.match(/^data:(image\/(?:jpeg|png|webp));base64,/);
  if (!mimeMatch) {
    throw new ContentValidationError(
      "MIME type gambar sampul tidak didukung. Hanya JPEG, PNG, dan WebP yang diizinkan.",
    );
  }
  return clean;
}

/**
 * Mengambil daftar ringkasan artikel berita dengan filter dan paginasi.
 * Kolom `isi` dan `gambar_sampul` tidak di-query demi efisiensi transfer data.
 */
export async function listArticles(
  client: Client,
  filter?: ArticleFilter,
): Promise<ArticleListResponse> {
  const conditions: string[] = [];
  const args: (string | number)[] = [];

  if (filter?.status && filter.status !== "Semua") {
    conditions.push("status = ?");
    args.push(filter.status);
  }

  if (filter?.search?.trim()) {
    conditions.push("(judul LIKE ? OR ringkasan LIKE ?)");
    const searchTerm = `%${filter.search.trim()}%`;
    args.push(searchTerm, searchTerm);
  }

  const whereClause =
    conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit = Math.max(1, Math.min(filter?.limit ?? 20, 100));
  const offset = Math.max(0, filter?.offset ?? 0);

  const countQuery = `SELECT COUNT(*) AS total FROM berita ${whereClause};`;
  const countRes = await client.execute({
    sql: countQuery,
    args: [...args],
  });
  const total = Number(countRes.rows[0]?.total ?? 0);

  const listQuery = `
    SELECT id_berita, judul, slug, ringkasan, status, tanggal_terbit, penulis, created_at, updated_at
      FROM berita
     ${whereClause}
  ORDER BY created_at DESC
     LIMIT ? OFFSET ?;
  `;
  const listRes = await client.execute({
    sql: listQuery,
    args: [...args, limit, offset],
  });

  return {
    items: listRes.rows as unknown as ArticleItem[],
    total,
  };
}

/**
 * Mengambil detail lengkap artikel berdasarkan ID berita.
 */
export async function getArticle(
  client: Client,
  idBerita: string,
): Promise<ArticleDetail> {
  const id = teksWajib(idBerita, "ID berita wajib diisi.");
  const res = await client.execute({
    sql: `SELECT id_berita, judul, slug, ringkasan, isi, gambar_sampul, status, tanggal_terbit, penulis, created_at, updated_at
            FROM berita
           WHERE id_berita = ?
           LIMIT 1;`,
    args: [id],
  });

  if (res.rows.length === 0) {
    throw new ContentNotFoundError(
      `Artikel berita dengan ID '${id}' tidak ditemukan.`,
    );
  }

  return res.rows[0] as unknown as ArticleDetail;
}

/**
 * Mengambil detail lengkap artikel berdasarkan slug (digunakan situs publik).
 */
export async function getArticleBySlug(
  client: Client,
  slug: string,
): Promise<ArticleDetail> {
  const cleanSlug = teksWajib(slug, "Slug berita wajib diisi.");
  const res = await client.execute({
    sql: `SELECT id_berita, judul, slug, ringkasan, isi, gambar_sampul, status, tanggal_terbit, penulis, created_at, updated_at
            FROM berita
           WHERE slug = ?
           LIMIT 1;`,
    args: [cleanSlug],
  });

  if (res.rows.length === 0) {
    throw new ContentNotFoundError(
      `Artikel dengan slug '${cleanSlug}' tidak ditemukan.`,
    );
  }

  return res.rows[0] as unknown as ArticleDetail;
}

/**
 * Menyimpan artikel baru atau memperbarui artikel yang sudah ada.
 */
export async function saveArticle(
  client: Client,
  draft: ArticleDraft,
): Promise<{ id_berita: string; slug: string }> {
  const judul = teksWajib(draft.judul, "Judul artikel wajib diisi.");
  if (judul.length > 200) {
    throw new ContentValidationError("Judul artikel maksimal 200 karakter.");
  }

  const ringkasan = String(draft.ringkasan ?? "").trim();
  if (ringkasan.length > 500) {
    throw new ContentValidationError(
      "Ringkasan artikel maksimal 500 karakter.",
    );
  }

  const isi = teksWajib(draft.isi, "Isi artikel wajib diisi.");

  const status = draft.status === "Terbit" ? "Terbit" : "Draft";
  const gambarSampul = validasiGambarSampul(draft.gambarSampul);
  const penulis = draft.penulis?.trim() || null;
  const tanggalTerbit =
    status === "Terbit"
      ? draft.tanggalTerbit?.trim() || new Date().toISOString()
      : draft.tanggalTerbit?.trim() || null;

  const idBerita = draft.idBerita?.trim() || buatIdBerita();
  let baseSlug = draft.slug?.trim() ? slugify(draft.slug) : slugify(judul);
  if (!baseSlug) {
    baseSlug = `artikel-${Math.floor(Date.now() / 1000)}`;
  }

  // Jamin keunikan slug terhadap artikel lain
  let finalSlug = baseSlug;
  let counter = 1;
  while (true) {
    const existing = await client.execute({
      sql: `SELECT id_berita FROM berita WHERE slug = ? AND id_berita != ? LIMIT 1;`,
      args: [finalSlug, idBerita],
    });
    if (existing.rows.length === 0) {
      break;
    }
    finalSlug = `${baseSlug}-${counter}`;
    counter++;
  }

  await client.execute({
    sql: `
      INSERT INTO berita (
        id_berita, judul, slug, ringkasan, isi, gambar_sampul, status, tanggal_terbit, penulis, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
      ON CONFLICT(id_berita) DO UPDATE SET
        judul = excluded.judul,
        slug = excluded.slug,
        ringkasan = excluded.ringkasan,
        isi = excluded.isi,
        gambar_sampul = excluded.gambar_sampul,
        status = excluded.status,
        tanggal_terbit = excluded.tanggal_terbit,
        penulis = excluded.penulis,
        updated_at = datetime('now');
    `,
    args: [
      idBerita,
      judul,
      finalSlug,
      ringkasan,
      isi,
      gambarSampul,
      status,
      tanggalTerbit,
      penulis,
    ],
  });

  return { id_berita: idBerita, slug: finalSlug };
}

/**
 * Menghapus artikel berita dari database Cloud.
 */
export async function deleteArticle(
  client: Client,
  idBerita: string,
): Promise<{ success: boolean; id_berita: string }> {
  const id = teksWajib(idBerita, "ID berita wajib diisi.");
  const res = await client.execute({
    sql: `DELETE FROM berita WHERE id_berita = ?;`,
    args: [id],
  });

  if (res.rowsAffected === 0) {
    throw new ContentNotFoundError(
      `Artikel berita dengan ID '${id}' tidak ditemukan.`,
    );
  }

  return { success: true, id_berita: id };
}

/**
 * Mengambil seluruh key-value konten untuk satu halaman tertentu.
 */
export async function getPageContent(
  client: Client,
  halaman: string,
): Promise<{ items: PageContentMap }> {
  const cleanHalaman = teksWajib(halaman, "Nama halaman wajib diisi.");
  const res = await client.execute({
    sql: `SELECT kunci, nilai FROM konten_publik WHERE halaman = ?;`,
    args: [cleanHalaman],
  });

  const map: PageContentMap = {};
  for (const row of res.rows) {
    const k = String(row.kunci ?? "");
    const v = String(row.nilai ?? "");
    if (k) {
      map[k] = v;
    }
  }

  return { items: map };
}

/**
 * Menyimpan atau memperbarui pasangan key-value konten suatu halaman.
 */
export async function savePageContent(
  client: Client,
  halaman: string,
  items: Record<string, string>,
): Promise<{ success: boolean; count: number }> {
  const cleanHalaman = teksWajib(halaman, "Nama halaman wajib diisi.");
  const entries = Object.entries(items ?? {});

  if (entries.length === 0) {
    return { success: true, count: 0 };
  }

  // Simpan secara batch dalam satu transaksi
  const statements = entries.map(([kunci, nilai]) => ({
    sql: `
      INSERT INTO konten_publik (halaman, kunci, nilai, updated_at)
      VALUES (?, ?, ?, datetime('now'))
      ON CONFLICT(halaman, kunci) DO UPDATE SET
        nilai = excluded.nilai,
        updated_at = datetime('now');
    `,
    args: [cleanHalaman, kunci.trim(), String(nilai ?? "").trim()],
  }));

  await client.batch(statements, "write");

  return { success: true, count: entries.length };
}
