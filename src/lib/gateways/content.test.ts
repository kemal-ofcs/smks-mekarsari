import { describe, expect, test } from "bun:test";
import { canAccessArea } from "@/lib/auth/access";
import {
  PERMISSION_CATALOG,
  SENSITIVE_MUTATION_PERMISSIONS,
} from "@/lib/rbac/catalog";
import type { ArticleDraft, ArticleItem, PageContentMap } from "./content";

describe("Tahap D: CMS Landing Page (Berita & Konten Publik) RBAC & Gateway Contract", () => {
  test("Permission 'content.view', 'content.manage', 'content.delete' terdaftar di katalog", () => {
    const view = PERMISSION_CATALOG.find((p) => p.key === "content.view");
    const manage = PERMISSION_CATALOG.find((p) => p.key === "content.manage");
    const del = PERMISSION_CATALOG.find((p) => p.key === "content.delete");

    expect(view).toBeDefined();
    expect(view?.group).toBe("Situs Publik");

    expect(manage).toBeDefined();
    expect(manage?.group).toBe("Situs Publik");

    expect(del).toBeDefined();
    expect(del?.group).toBe("Situs Publik");
  });

  test("'content.delete' masuk SENSITIVE_MUTATION_PERMISSIONS", () => {
    expect(SENSITIVE_MUTATION_PERMISSIONS.has("content.delete")).toBe(true);
    expect(SENSITIVE_MUTATION_PERMISSIONS.has("content.manage")).toBe(false);
  });

  test("Area guard 'konten' dijaga oleh canAccessArea dan izin 'content.view'", () => {
    expect(
      canAccessArea(
        { isSuperadmin: false, permissions: ["content.view"] },
        "konten",
      ),
    ).toBe(true);
    expect(
      canAccessArea({ isSuperadmin: false, permissions: [] }, "konten"),
    ).toBe(false);
    expect(
      canAccessArea({ isSuperadmin: true, permissions: [] }, "konten"),
    ).toBe(true);
  });

  test("Kontrak tipe ArticleItem dan ArticleDraft terstruktur sesuai skema", () => {
    const mockItem: ArticleItem = {
      id_berita: "berita-1-abc",
      judul: "Kegiatan Belajar Mengajar Perdana",
      slug: "kegiatan-belajar-mengajar-perdana",
      ringkasan: "Ringkasan artikel berita perdana",
      status: "Terbit",
      tanggal_terbit: "2026-09-17",
      penulis: "Admin",
      created_at: "2026-09-17 08:00:00",
      updated_at: "2026-09-17 08:00:00",
    };
    expect(mockItem.status).toBe("Terbit");

    const mockDraft: ArticleDraft = {
      judul: "Judul Baru",
      ringkasan: "Ringkasan baru",
      isi: "<p>Konten artikel baru</p>",
      status: "Draft",
    };
    expect(mockDraft.judul).toBe("Judul Baru");
    expect(mockDraft.status).toBe("Draft");
  });

  test("Kontrak PageContentMap mendukung pasangan key-value string", () => {
    const map: PageContentMap = {
      "profil.sejarah": "Sejarah sekolah...",
      "profil.visi": "Menjadi sekolah unggulan...",
      "kontak.telepon": "021-1234567",
    };
    expect(map["profil.sejarah"]).toBe("Sejarah sekolah...");
    expect(map["kontak.telepon"]).toBe("021-1234567");
  });
});
