"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { Icon } from "@/components/ui/Icon";
import { hasPermission } from "@/lib/auth/access";
import { optimizeImageFile } from "@/lib/client/image-optimizer";
import { useAuth } from "@/lib/context/AuthContext";
import {
  type ArticleDetail,
  type ArticleDraft,
  type ArticleItem,
  type ArticleStatus,
  ambilDetailArtikel,
  daftarArtikel,
  hapusArtikel,
  simpanArtikel,
} from "@/lib/gateways/content";

export function ArticleManager() {
  const { user } = useAuth();
  const canManage = hasPermission(user, "content.manage");
  const canDelete = hasPermission(user, "content.delete");

  const [articles, setArticles] = useState<ArticleItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Filter state
  const [statusFilter, setStatusFilter] = useState<ArticleStatus | "Semua">(
    "Semua",
  );
  const [searchQuery, setSearchQuery] = useState("");

  // Modal form state
  const [formOpen, setFormOpen] = useState(false);
  const [editingArticle, setEditingArticle] = useState<ArticleDetail | null>(
    null,
  );
  const [loadingDetail, setLoadingDetail] = useState(false);

  // Draft form data
  const [formJudul, setFormJudul] = useState("");
  const [formSlug, setFormSlug] = useState("");
  const [formRingkasan, setFormRingkasan] = useState("");
  const [formIsi, setFormIsi] = useState("");
  const [formStatus, setFormStatus] = useState<ArticleStatus>("Draft");
  const [formPenulis, setFormPenulis] = useState("");
  const [formGambarSampul, setFormGambarSampul] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // Delete confirmation
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const muatDaftarArtikel = useCallback(async () => {
    setLoading(true);
    setErrorMessage(null);
    try {
      const res = await daftarArtikel({
        status: statusFilter,
        search: searchQuery.trim() || undefined,
        limit: 50,
      });
      setArticles(res.items);
      setTotal(res.total);
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : "Gagal memuat daftar artikel.",
      );
    } finally {
      setLoading(false);
    }
  }, [statusFilter, searchQuery]);

  useEffect(() => {
    void muatDaftarArtikel();
  }, [muatDaftarArtikel]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void muatDaftarArtikel();
  };

  const bukaFormTambah = () => {
    setEditingArticle(null);
    setFormJudul("");
    setFormSlug("");
    setFormRingkasan("");
    setFormIsi("");
    setFormStatus("Draft");
    setFormPenulis(user?.nama_operator || "");
    setFormGambarSampul(null);
    setFormError(null);
    setFormOpen(true);
  };

  const bukaFormEdit = async (item: ArticleItem) => {
    setLoadingDetail(true);
    setFormError(null);
    try {
      const res = await ambilDetailArtikel(item.id_berita);
      const art = res.article;
      setEditingArticle(art);
      setFormJudul(art.judul);
      setFormSlug(art.slug);
      setFormRingkasan(art.ringkasan);
      setFormIsi(art.isi);
      setFormStatus(art.status);
      setFormPenulis(art.penulis || "");
      setFormGambarSampul(art.gambar_sampul);
      setFormOpen(true);
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : "Gagal memuat detail artikel.",
      );
    } finally {
      setLoadingDetail(false);
    }
  };

  /**
   * Kompresi lewat `optimizeImageFile`, bukan rantai FileReader→Image→canvas
   * yang dirakit sendiri.
   *
   * Versi sebelumnya tidak punya satu pun penanganan kegagalan — tanpa
   * `reader.onerror`, tanpa `img.onerror`, dan dengan `if (ctx)` tanpa cabang
   * lain. Kalau salah satu langkah putus, `setFormGambarSampul` tidak pernah
   * terpanggil: tidak ada pesan, tidak ada pratinjau, dan artikelnya tetap
   * tersimpan "berhasil" tanpa sampul. Helper itu me-`reject` kedua jalur
   * gagalnya, sehingga kegagalan selalu terlihat.
   *
   * Hasilnya kini JPEG, bukan WebP. Endpoint gambar situs publik menerima
   * keduanya, tetapi `toDataURL("image/webp")` tidak didukung seluruh WebView
   * dan diam-diam jatuh ke format lain di sebagian di antaranya.
   */
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Dikosongkan supaya memilih berkas yang sama dua kali tetap memicu change.
    e.target.value = "";
    if (!file) return;

    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setFormError("Format file harus berupa gambar JPEG, PNG, atau WebP.");
      return;
    }

    if (file.size > 2 * 1024 * 1024) {
      setFormError("Ukuran file gambar maksimal 2 MB sebelum kompresi.");
      return;
    }

    try {
      const { dataUrl } = await optimizeImageFile(file, {
        maxWidth: 1200,
        maxHeight: 800,
        quality: 0.85,
        mimeType: "image/jpeg",
        fit: "contain",
      });
      if (dataUrl.length > 750_000) {
        setFormError(
          "Gambar masih terlalu besar setelah dikompres. Silakan pilih resolusi lebih rendah.",
        );
        return;
      }
      setFormGambarSampul(dataUrl);
      setFormError(null);
    } catch (err) {
      setFormError(
        err instanceof Error ? err.message : "Gagal memproses gambar sampul.",
      );
    }
  };

  const handleSimpan = () => {
    if (!formJudul.trim()) {
      setFormError("Judul artikel wajib diisi.");
      return;
    }
    if (!formIsi.trim()) {
      setFormError("Isi artikel wajib diisi.");
      return;
    }

    setFormError(null);
    startTransition(async () => {
      try {
        const draft: ArticleDraft = {
          idBerita: editingArticle?.id_berita,
          judul: formJudul.trim(),
          slug: formSlug.trim() || undefined,
          ringkasan: formRingkasan.trim(),
          isi: formIsi.trim(),
          gambarSampul: formGambarSampul,
          status: formStatus,
          penulis: formPenulis.trim() || undefined,
        };
        await simpanArtikel(draft);
        setSuccessMessage(
          editingArticle
            ? "Artikel berhasil diperbarui."
            : "Artikel baru berhasil dibuat.",
        );
        setFormOpen(false);
        await muatDaftarArtikel();
      } catch (err) {
        setFormError(
          err instanceof Error ? err.message : "Gagal menyimpan artikel.",
        );
      }
    });
  };

  const handleHapus = async (idBerita: string) => {
    if (
      !window.confirm(
        "Apakah Anda yakin ingin menghapus artikel ini? Tindakan ini tidak dapat dibatalkan.",
      )
    ) {
      return;
    }
    setDeletingId(idBerita);
    try {
      await hapusArtikel(idBerita);
      setSuccessMessage("Artikel berhasil dihapus.");
      await muatDaftarArtikel();
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : "Gagal menghapus artikel.",
      );
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header filter & tambah */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <form
          onSubmit={handleSearchSubmit}
          className="flex flex-1 items-center gap-2 max-w-md"
        >
          <div className="relative flex-1">
            <input
              id="article-search-input"
              type="text"
              aria-label="Cari artikel berita"
              placeholder="Cari judul artikel..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full rounded-xl border border-white/10 bg-slate-800/80 px-4 py-2.5 pl-10 text-sm text-white placeholder-slate-400 focus:border-sky-400 focus:outline-none focus:ring-1 focus:ring-sky-400"
            />
            <span className="pointer-events-none absolute left-3 top-3 text-slate-400">
              <Icon name="tools" className="size-4" />
            </span>
          </div>
          <button
            id="article-search-button"
            type="submit"
            className="rounded-xl bg-slate-800 px-4 py-2.5 text-sm font-semibold text-slate-200 transition hover:bg-slate-700 hover:text-white"
          >
            Cari
          </button>
        </form>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <label
              htmlFor="article-status-filter"
              className="text-xs font-semibold text-slate-400"
            >
              Status:
            </label>
            <select
              id="article-status-filter"
              value={statusFilter}
              onChange={(e) =>
                setStatusFilter(e.target.value as ArticleStatus | "Semua")
              }
              className="rounded-xl border border-white/10 bg-slate-800 px-3 py-2 text-xs font-semibold text-white focus:border-sky-400 focus:outline-none"
            >
              <option value="Semua" className="bg-slate-900 text-white">
                Semua
              </option>
              <option value="Terbit" className="bg-slate-900 text-white">
                Terbit
              </option>
              <option value="Draft" className="bg-slate-900 text-white">
                Draft
              </option>
            </select>
          </div>

          {canManage && (
            <button
              id="btn-tambah-artikel"
              type="button"
              onClick={bukaFormTambah}
              className="flex items-center gap-2 rounded-xl bg-sky-500 px-4 py-2.5 text-sm font-bold text-slate-950 transition hover:bg-sky-400 shadow-lg shadow-sky-500/20"
            >
              <Icon name="plus" className="size-4" />
              <span>Tulis Berita</span>
            </button>
          )}
        </div>
      </div>

      {/* Alert pesan */}
      {errorMessage && (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-300">
          {errorMessage}
        </div>
      )}
      {successMessage && (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-300">
          {successMessage}
        </div>
      )}

      {/* Tabel Artikel */}
      <div className="overflow-hidden rounded-2xl border border-white/10 bg-slate-900 shadow-xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-white/10 bg-slate-850 text-xs font-bold uppercase tracking-wider text-slate-400">
              <tr>
                <th className="px-5 py-3.5">Judul & Ringkasan</th>
                <th className="px-5 py-3.5">Status</th>
                <th className="px-5 py-3.5">Penulis</th>
                <th className="px-5 py-3.5">Tanggal</th>
                <th className="px-5 py-3.5 text-right">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5 text-slate-300">
              {loading ? (
                <tr>
                  <td
                    colSpan={5}
                    className="px-5 py-8 text-center text-slate-400"
                  >
                    Memuat daftar artikel...
                  </td>
                </tr>
              ) : articles.length === 0 ? (
                <tr>
                  <td
                    colSpan={5}
                    className="px-5 py-8 text-center text-slate-400"
                  >
                    Belum ada artikel berita yang ditemukan.
                  </td>
                </tr>
              ) : (
                articles.map((item) => (
                  <tr
                    key={item.id_berita}
                    className="transition hover:bg-white/[0.02]"
                  >
                    <td className="px-5 py-4">
                      <p className="font-bold text-white line-clamp-1">
                        {item.judul}
                      </p>
                      <p className="mt-1 text-xs text-slate-400 line-clamp-1">
                        {item.ringkasan || "Tidak ada ringkasan."}
                      </p>
                      <p className="mt-0.5 text-[11px] font-mono text-sky-400">
                        /berita/{item.slug}
                      </p>
                    </td>
                    <td className="px-5 py-4">
                      <span
                        className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-bold ${
                          item.status === "Terbit"
                            ? "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30"
                            : "bg-amber-500/15 text-amber-300 border border-amber-500/30"
                        }`}
                      >
                        {item.status}
                      </span>
                    </td>
                    <td className="px-5 py-4 text-xs text-slate-300">
                      {item.penulis || "—"}
                    </td>
                    <td className="px-5 py-4 text-xs text-slate-400">
                      {item.tanggal_terbit
                        ? new Date(item.tanggal_terbit).toLocaleDateString(
                            "id-ID",
                            {
                              day: "numeric",
                              month: "short",
                              year: "numeric",
                            },
                          )
                        : "—"}
                    </td>
                    <td className="px-5 py-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        {canManage && (
                          <button
                            id={`btn-edit-${item.id_berita}`}
                            type="button"
                            onClick={() => bukaFormEdit(item)}
                            disabled={loadingDetail}
                            className="rounded-lg bg-white/[0.07] px-3 py-1.5 text-xs font-semibold text-slate-200 transition hover:bg-white/[0.12] hover:text-white"
                          >
                            Edit
                          </button>
                        )}
                        {canDelete && (
                          <button
                            id={`btn-hapus-${item.id_berita}`}
                            type="button"
                            onClick={() => handleHapus(item.id_berita)}
                            disabled={deletingId === item.id_berita}
                            className="rounded-lg bg-rose-500/15 px-3 py-1.5 text-xs font-semibold text-rose-300 transition hover:bg-rose-500/25 disabled:opacity-50"
                          >
                            {deletingId === item.id_berita ? "..." : "Hapus"}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="border-t border-white/10 px-5 py-3 text-xs text-slate-400">
          Menampilkan {articles.length} dari total {total} artikel
        </div>
      </div>

      {/* Modal Form Dialog */}
      {formOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
          <div
            id="article-form-dialog"
            role="dialog"
            aria-modal="true"
            className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-3xl border border-white/10 bg-slate-900 p-6 shadow-2xl space-y-5"
          >
            <div className="flex items-center justify-between border-b border-white/10 pb-4">
              <h3 className="text-lg font-bold text-white">
                {editingArticle ? "Edit Artikel Berita" : "Tulis Artikel Baru"}
              </h3>
              <button
                type="button"
                onClick={() => setFormOpen(false)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-white/[0.06] hover:text-white"
              >
                ✕
              </button>
            </div>

            {formError && (
              <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-300">
                {formError}
              </div>
            )}

            <div className="space-y-4">
              <div>
                <label
                  htmlFor="input-article-judul"
                  className="block text-xs font-bold text-slate-300 mb-1"
                >
                  Judul Artikel *
                </label>
                <input
                  id="input-article-judul"
                  type="text"
                  value={formJudul}
                  onChange={(e) => setFormJudul(e.target.value)}
                  placeholder="Masukkan judul artikel..."
                  className="w-full rounded-xl border border-white/10 bg-slate-800 px-4 py-2.5 text-sm text-white focus:border-sky-400 focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label
                    htmlFor="input-article-slug"
                    className="block text-xs font-bold text-slate-300 mb-1"
                  >
                    Slug URL (Opsional / Otomatis)
                  </label>
                  <input
                    id="input-article-slug"
                    type="text"
                    value={formSlug}
                    onChange={(e) => setFormSlug(e.target.value)}
                    placeholder="kegiatan-sekolah-perdana"
                    className="w-full rounded-xl border border-white/10 bg-slate-800 px-4 py-2 text-sm text-white focus:border-sky-400 focus:outline-none"
                  />
                </div>

                <div>
                  <label
                    htmlFor="input-article-penulis"
                    className="block text-xs font-bold text-slate-300 mb-1"
                  >
                    Penulis
                  </label>
                  <input
                    id="input-article-penulis"
                    type="text"
                    value={formPenulis}
                    onChange={(e) => setFormPenulis(e.target.value)}
                    placeholder="Admin / Humas"
                    className="w-full rounded-xl border border-white/10 bg-slate-800 px-4 py-2 text-sm text-white focus:border-sky-400 focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label
                  htmlFor="input-article-ringkasan"
                  className="block text-xs font-bold text-slate-300 mb-1"
                >
                  Ringkasan Singkat (Maks. 500 karakter)
                </label>
                <textarea
                  id="input-article-ringkasan"
                  rows={2}
                  value={formRingkasan}
                  onChange={(e) => setFormRingkasan(e.target.value)}
                  placeholder="Ringkasan singkat yang ditampilkan di kartu listing berita..."
                  className="w-full rounded-xl border border-white/10 bg-slate-800 px-4 py-2.5 text-sm text-white focus:border-sky-400 focus:outline-none"
                />
              </div>

              <div>
                <label
                  htmlFor="input-article-isi"
                  className="block text-xs font-bold text-slate-300 mb-1"
                >
                  Konten / Isi Artikel *
                </label>
                <textarea
                  id="input-article-isi"
                  rows={8}
                  value={formIsi}
                  onChange={(e) => setFormIsi(e.target.value)}
                  placeholder="Tuliskan isi lengkap artikel berita di sini..."
                  className="w-full rounded-xl border border-white/10 bg-slate-800 px-4 py-2.5 text-sm text-white focus:border-sky-400 focus:outline-none font-sans"
                />
              </div>

              <div>
                <label
                  htmlFor="input-article-gambar"
                  className="block text-xs font-bold text-slate-300 mb-1"
                >
                  Gambar Sampul (Maks 500 KB, JPEG/PNG/WebP)
                </label>
                <input
                  id="input-article-gambar"
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={handleFileChange}
                  className="w-full text-xs text-slate-400 file:mr-4 file:rounded-xl file:border-0 file:bg-slate-800 file:px-4 file:py-2 file:text-xs file:font-bold file:text-sky-300 hover:file:bg-slate-700"
                />
                {formGambarSampul && (
                  <div className="mt-2 relative w-48 h-32 rounded-xl overflow-hidden border border-white/10 bg-slate-950">
                    {/* biome-ignore lint/performance/noImgElement: Preview data URI dari kompresi canvas client-side */}
                    <img
                      src={formGambarSampul}
                      alt="Preview Sampul"
                      className="w-full h-full object-cover"
                    />
                    <button
                      type="button"
                      onClick={() => setFormGambarSampul(null)}
                      className="absolute top-1 right-1 rounded-full bg-black/60 p-1 text-xs text-rose-400 hover:bg-black/90"
                    >
                      ✕
                    </button>
                  </div>
                )}
              </div>

              <div>
                <label
                  htmlFor="input-article-status"
                  className="block text-xs font-bold text-slate-300 mb-1"
                >
                  Status Publikasi
                </label>
                <select
                  id="input-article-status"
                  value={formStatus}
                  onChange={(e) =>
                    setFormStatus(e.target.value as ArticleStatus)
                  }
                  className="rounded-xl border border-white/10 bg-slate-800 px-4 py-2.5 text-sm font-semibold text-white focus:border-sky-400 focus:outline-none"
                >
                  <option value="Draft" className="bg-slate-900 text-white">
                    Draft (Hanya disimpan di CMS)
                  </option>
                  <option value="Terbit" className="bg-slate-900 text-white">
                    Terbit (Tampil di Situs Publik)
                  </option>
                </select>
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 border-t border-white/10 pt-4">
              <button
                id="btn-batal-artikel"
                type="button"
                onClick={() => setFormOpen(false)}
                className="rounded-xl bg-white/[0.06] px-4 py-2.5 text-sm font-semibold text-slate-300 hover:bg-white/[0.1] hover:text-white"
              >
                Batal
              </button>
              <button
                id="btn-simpan-artikel"
                type="button"
                onClick={handleSimpan}
                disabled={isPending}
                className="rounded-xl bg-sky-500 px-5 py-2.5 text-sm font-bold text-slate-950 hover:bg-sky-400 disabled:opacity-50 shadow-lg shadow-sky-500/20"
              >
                {isPending ? "Menyimpan..." : "Simpan Artikel"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
