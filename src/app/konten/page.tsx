"use client";

import { redirect } from "next/navigation";
import { useState } from "react";
import { AppShell } from "@/components/AppShell";
import { ArticleManager } from "@/components/content/ArticleManager";
import { PageContentManager } from "@/components/content/PageContentManager";
import { PageHeader } from "@/components/ui/PageHeader";
import { canAccessArea } from "@/lib/auth/access";
import { useAuth } from "@/lib/context/AuthContext";

export default function KontenPage() {
  const { user, isAuthenticated, isLoading: authLoading } = useAuth();
  const [activeTab, setActiveTab] = useState<"berita" | "halaman">("berita");

  if (authLoading) {
    return (
      <AppShell>
        <div className="py-12 text-center text-sm text-slate-400">
          Memuat hak akses...
        </div>
      </AppShell>
    );
  }

  if (!isAuthenticated) {
    redirect("/login");
  }

  if (!canAccessArea(user, "konten")) {
    redirect("/forbidden");
  }

  return (
    <AppShell>
      <div className="space-y-6">
        <PageHeader
          eyebrow="Situs Publik"
          title="Manajemen Konten & Berita (CMS)"
          description="Kelola publikasi artikel berita, liputan kegiatan, serta pembaharuan konten profil, program, dan informasi kontak situs web sekolah."
        />

        {/* Tab Navigasi Utama */}
        <div className="flex border-b border-white/10 gap-4">
          <button
            id="tab-cms-berita"
            type="button"
            onClick={() => setActiveTab("berita")}
            className={`pb-3 text-sm font-bold border-b-2 transition ${
              activeTab === "berita"
                ? "border-sky-400 text-sky-400"
                : "border-transparent text-slate-400 hover:text-white"
            }`}
          >
            Berita & Pengumuman
          </button>
          <button
            id="tab-cms-halaman"
            type="button"
            onClick={() => setActiveTab("halaman")}
            className={`pb-3 text-sm font-bold border-b-2 transition ${
              activeTab === "halaman"
                ? "border-sky-400 text-sky-400"
                : "border-transparent text-slate-400 hover:text-white"
            }`}
          >
            Konten Halaman Publik
          </button>
        </div>

        {/* Konten Tab Aktif */}
        {activeTab === "berita" ? <ArticleManager /> : <PageContentManager />}
      </div>
    </AppShell>
  );
}
