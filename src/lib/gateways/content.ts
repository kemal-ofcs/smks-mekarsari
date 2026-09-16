"use client";

import { requestWebApi } from "@/lib/client/api-client";
import { isDesktopRuntime } from "@/lib/runtime/app-runtime";
import { invokeDesktop } from "@/lib/runtime/desktop-commands";
import type {
  ArticleDetail,
  ArticleDraft,
  ArticleFilter,
  ArticleListResponse,
  PageContentMap,
} from "@/types/content";

export type {
  ArticleDetail,
  ArticleDraft,
  ArticleFilter,
  ArticleItem,
  ArticleListResponse,
  ArticleStatus,
  PageContentMap,
  PageContentUpdateInput,
} from "@/types/content";

/**
 * Gateway CMS Landing Page (Berita & Konten Publik) sisi sekolah.
 *
 * Mengikuti pola Hybrid Isomorphic Gateway:
 * - Desktop: `invokeDesktop(...)` ke command Rust langsung yang berkomunikasi dengan Turso Cloud.
 * - Web: `requestWebApi(...)` ke Next.js API Route Handlers.
 * Kedua tabel bersifat Cloud-Only sehingga tidak melalui antrean outbox SQLite perangkat.
 */

export async function daftarArtikel(
  filter?: ArticleFilter,
): Promise<ArticleListResponse> {
  if (isDesktopRuntime()) {
    return invokeDesktop<ArticleListResponse>("desktop_list_articles", {
      status: filter?.status === "Semua" ? null : (filter?.status ?? null),
      search: filter?.search ?? null,
      limit: filter?.limit ?? null,
      offset: filter?.offset ?? null,
    });
  }
  return requestWebApi<ArticleListResponse>(
    "/api/content/articles/query",
    "POST",
    filter ?? {},
  );
}

export async function ambilDetailArtikel(
  idBerita: string,
): Promise<{ article: ArticleDetail }> {
  if (isDesktopRuntime()) {
    return invokeDesktop<{ article: ArticleDetail }>("desktop_get_article", {
      idBerita,
    });
  }
  return requestWebApi<{ article: ArticleDetail }>(
    "/api/content/articles/get",
    "POST",
    { idBerita },
  );
}

export async function simpanArtikel(
  draft: ArticleDraft,
): Promise<{ id_berita: string; slug: string }> {
  if (isDesktopRuntime()) {
    return invokeDesktop<{ id_berita: string; slug: string }>(
      "desktop_save_article",
      { draft },
    );
  }
  return requestWebApi<{ id_berita: string; slug: string }>(
    "/api/content/articles/save",
    "POST",
    draft,
  );
}

export async function hapusArtikel(
  idBerita: string,
): Promise<{ success: boolean; id_berita: string }> {
  if (isDesktopRuntime()) {
    return invokeDesktop<{ success: boolean; id_berita: string }>(
      "desktop_delete_article",
      { idBerita },
    );
  }
  return requestWebApi<{ success: boolean; id_berita: string }>(
    "/api/content/articles/delete",
    "POST",
    { idBerita },
  );
}

export async function ambilKontenHalaman(
  halaman: string,
): Promise<{ items: PageContentMap }> {
  if (isDesktopRuntime()) {
    return invokeDesktop<{ items: PageContentMap }>(
      "desktop_get_page_content",
      { halaman },
    );
  }
  return requestWebApi<{ items: PageContentMap }>(
    "/api/content/pages/query",
    "POST",
    { halaman },
  );
}

export async function simpanKontenHalaman(
  halaman: string,
  items: Record<string, string>,
): Promise<{ success: boolean; count: number }> {
  if (isDesktopRuntime()) {
    return invokeDesktop<{ success: boolean; count: number }>(
      "desktop_save_page_content",
      { halaman, items },
    );
  }
  return requestWebApi<{ success: boolean; count: number }>(
    "/api/content/pages/save",
    "POST",
    { halaman, items },
  );
}
