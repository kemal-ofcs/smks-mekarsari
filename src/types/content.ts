/**
 * Status publikasi artikel berita di CMS.
 */
export type ArticleStatus = "Draft" | "Terbit";

/**
 * Ringkasan artikel untuk daftar/tabel admin dan listing publik.
 * Kolom `isi` dan `gambar_sampul` sengaja tidak dibawa untuk menghemat bandwidth.
 */
export interface ArticleItem {
  id_berita: string;
  judul: string;
  slug: string;
  ringkasan: string;
  status: ArticleStatus;
  tanggal_terbit: string | null;
  penulis: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Detail lengkap artikel berita termasuk isi dan gambar sampul base64.
 */
export interface ArticleDetail extends ArticleItem {
  isi: string;
  gambar_sampul: string | null;
}

/**
 * Payload form penyimpanan artikel berita dari UI admin.
 */
export interface ArticleDraft {
  idBerita?: string;
  judul: string;
  slug?: string;
  ringkasan: string;
  isi: string;
  gambarSampul?: string | null;
  status: ArticleStatus;
  tanggalTerbit?: string | null;
  penulis?: string | null;
}

/**
 * Filter pencarian dan paginasi daftar artikel berita.
 */
export interface ArticleFilter {
  status?: ArticleStatus | "Semua";
  search?: string;
  limit?: number;
  offset?: number;
}

/**
 * Respon daftar artikel berita.
 */
export interface ArticleListResponse {
  items: ArticleItem[];
  total: number;
}

/**
 * Peta key-value untuk konten statis halaman situs publik.
 */
export type PageContentMap = Record<string, string>;

/**
 * Input pembaruan konten halaman publik.
 */
export interface PageContentUpdateInput {
  halaman: string;
  items: Record<string, string>;
}
