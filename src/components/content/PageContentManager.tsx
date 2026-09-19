"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { hasPermission } from "@/lib/auth/access";
import {
  type CmsFieldConfig,
  HALAMAN_CMS,
  KOLEKSI_LANDING,
  LANDING_PAGE_SUBSECTIONS,
  muatKoleksiLanding,
  siapkanSimpanLanding,
} from "@/lib/constants/landing-cms-fields";
import { useAuth } from "@/lib/context/AuthContext";
import {
  ambilKontenHalaman,
  type PageContentMap,
  simpanKontenHalaman,
} from "@/lib/gateways/content";
import { CollectionRepeater } from "./CollectionRepeater";

export function PageContentManager() {
  const { user } = useAuth();
  const canManage = hasPermission(user, "content.manage");

  const [activeTab, setActiveTab] = useState<
    "profil" | "kontak" | "program" | "landing"
  >("profil");
  const [activeLandingSubTab, setActiveLandingSubTab] =
    useState<string>("hero_stats");
  const [contentMap, setContentMap] = useState<PageContentMap>({});
  // Item koleksi disimpan terurai sebagai array supaya repeater-nya bisa
  // menambah/menghapus/menggeser; baru diserialisasi jadi JSON saat disimpan.
  const [koleksiItems, setKoleksiItems] = useState<
    Record<string, Record<string, unknown>[]>
  >({});
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const muatKonten = useCallback(async (halaman: string) => {
    setLoading(true);
    setErrorMessage(null);
    setSuccessMessage(null);
    try {
      const res = await ambilKontenHalaman(halaman);
      const items = res.items || {};
      setContentMap(items);
      setKoleksiItems(muatKoleksiLanding(items));
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : "Gagal memuat konten halaman.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void muatKonten(activeTab);
  }, [activeTab, muatKonten]);

  const handleFieldChange = (key: string, value: string) => {
    setContentMap((prev) => ({
      ...prev,
      [key]: value,
    }));
  };

  const handleSimpan = () => {
    setErrorMessage(null);
    setSuccessMessage(null);
    startTransition(async () => {
      try {
        // Hanya tab Landing yang punya koleksi. Halaman lain disimpan apa
        // adanya — menyerialisasi koleksi di sana akan menulis kunci `landing.*`
        // ke halaman yang salah.
        const denganKoleksi =
          activeTab === "landing"
            ? siapkanSimpanLanding(contentMap, koleksiItems)
            : contentMap;
        await simpanKontenHalaman(activeTab, denganKoleksi);
        setContentMap(denganKoleksi);
        setSuccessMessage(
          "Konten halaman berhasil disimpan ke database cloud.",
        );
      } catch (err) {
        setErrorMessage(
          err instanceof Error
            ? err.message
            : "Gagal menyimpan konten halaman.",
        );
      }
    });
  };

  const currentLandingSubSection =
    LANDING_PAGE_SUBSECTIONS.find((s) => s.id === activeLandingSubTab) ??
    LANDING_PAGE_SUBSECTIONS[0];

  const currentTitle =
    activeTab === "landing"
      ? currentLandingSubSection.title
      : HALAMAN_CMS[activeTab].title;

  const currentDesc =
    activeTab === "landing"
      ? currentLandingSubSection.description
      : "Perubahan konten di sini akan langsung tampil pada situs publik dengan sistem graceful degradation.";

  const koleksiAktif =
    activeTab === "landing"
      ? (KOLEKSI_LANDING[currentLandingSubSection.id] ?? null)
      : null;

  const currentFields: CmsFieldConfig[] =
    activeTab === "landing"
      ? currentLandingSubSection.fields
      : HALAMAN_CMS[activeTab].fields;

  return (
    <div className="space-y-6">
      {/* Tab Switcher Utama */}
      <div className="flex border-b border-white/10 gap-2 overflow-x-auto pb-px">
        {(
          [
            { id: "profil", label: "Profil Sekolah" },
            { id: "kontak", label: "Kontak & Alamat" },
            { id: "program", label: "Program & Fasilitas Ringkasan" },
            { id: "landing", label: "Landing Page (Beranda)" },
          ] as const
        ).map((tab) => (
          <button
            key={tab.id}
            id={`tab-page-${tab.id}`}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={`whitespace-nowrap px-5 py-3 text-sm font-bold border-b-2 transition ${
              activeTab === tab.id
                ? "border-sky-400 text-sky-400"
                : "border-transparent text-slate-400 hover:text-white"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Sub-tab Switcher Khusus Landing Page */}
      {activeTab === "landing" && (
        <div className="flex flex-wrap gap-2 p-1.5 rounded-2xl bg-slate-800/60 border border-white/5">
          {LANDING_PAGE_SUBSECTIONS.map((sub) => (
            <button
              key={sub.id}
              id={`subtab-landing-${sub.id}`}
              type="button"
              onClick={() => setActiveLandingSubTab(sub.id)}
              className={`rounded-xl px-4 py-2 text-xs font-bold transition ${
                activeLandingSubTab === sub.id
                  ? "bg-sky-500 text-slate-950 shadow-md"
                  : "text-slate-400 hover:bg-white/5 hover:text-white"
              }`}
            >
              {sub.title}
            </button>
          ))}
        </div>
      )}

      {/* Alert Messages */}
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

      {/* Form Content */}
      <div className="rounded-3xl border border-white/10 bg-slate-900 p-6 sm:p-8 shadow-xl space-y-6">
        <div className="border-b border-white/10 pb-4">
          <h3 className="text-lg font-bold text-white">{currentTitle}</h3>
          <p className="mt-1 text-xs text-slate-400">{currentDesc}</p>
        </div>

        {loading ? (
          <div className="py-12 text-center text-sm text-slate-400">
            Memuat data konten...
          </div>
        ) : (
          <div className="space-y-5">
            {currentFields.map((field) => {
              const value = contentMap[field.key] ?? "";
              return (
                <div key={field.key}>
                  <label
                    htmlFor={`input-${field.key}`}
                    className="block text-xs font-bold text-slate-300 mb-1.5"
                  >
                    {field.label}
                  </label>
                  {field.description ? (
                    <p className="mb-2 text-[11px] text-sky-400/90 font-medium">
                      ℹ️ {field.description}
                    </p>
                  ) : null}
                  {field.type === "textarea" ? (
                    <textarea
                      id={`input-${field.key}`}
                      rows={field.rows || 3}
                      value={value}
                      onChange={(e) =>
                        handleFieldChange(field.key, e.target.value)
                      }
                      placeholder={field.placeholder}
                      disabled={!canManage}
                      className="w-full rounded-xl border border-white/10 bg-slate-800/90 px-4 py-2.5 text-sm text-white focus:border-sky-400 focus:outline-none disabled:opacity-60"
                    />
                  ) : (
                    <input
                      id={`input-${field.key}`}
                      type="text"
                      value={value}
                      onChange={(e) =>
                        handleFieldChange(field.key, e.target.value)
                      }
                      placeholder={field.placeholder}
                      disabled={!canManage}
                      className="w-full rounded-xl border border-white/10 bg-slate-800/90 px-4 py-2.5 text-sm text-white focus:border-sky-400 focus:outline-none disabled:opacity-60"
                    />
                  )}
                  <p className="mt-1 text-[11px] font-mono text-slate-500">
                    Kunci database: {field.key}
                  </p>
                </div>
              );
            })}

            {koleksiAktif ? (
              <CollectionRepeater
                label={koleksiAktif.label}
                description={koleksiAktif.description}
                kunci={koleksiAktif.kunci}
                fields={koleksiAktif.fields}
                items={koleksiItems[koleksiAktif.kunci] ?? []}
                maksItem={koleksiAktif.maksItem}
                disabled={!canManage}
                onChange={(items) =>
                  setKoleksiItems((prev) => ({
                    ...prev,
                    [koleksiAktif.kunci]: items,
                  }))
                }
              />
            ) : null}

            {canManage && (
              <div className="flex justify-end pt-4 border-t border-white/10">
                <button
                  id="btn-simpan-halaman"
                  type="button"
                  onClick={handleSimpan}
                  disabled={isPending}
                  className="rounded-xl bg-sky-500 px-6 py-2.5 text-sm font-bold text-slate-950 transition hover:bg-sky-400 disabled:opacity-50 shadow-lg shadow-sky-500/20"
                >
                  {isPending ? "Menyimpan..." : "Simpan Perubahan Bagian Ini"}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
