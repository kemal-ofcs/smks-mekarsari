"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { hasPermission } from "@/lib/auth/access";
import { useAuth } from "@/lib/context/AuthContext";
import {
  ambilKontenHalaman,
  type PageContentMap,
  simpanKontenHalaman,
} from "@/lib/gateways/content";

interface FieldConfig {
  key: string;
  label: string;
  type: "text" | "textarea";
  placeholder: string;
  rows?: number;
}

const PAGE_SECTIONS: Record<string, { title: string; fields: FieldConfig[] }> =
  {
    profil: {
      title: "Halaman Profil Sekolah",
      fields: [
        {
          key: "profil.visi",
          label: "Visi Sekolah",
          type: "textarea",
          placeholder: "Tuliskan visi sekolah...",
          rows: 3,
        },
        {
          key: "profil.misi",
          label: "Misi Sekolah",
          type: "textarea",
          placeholder: "Tuliskan misi sekolah (pisahkan dengan baris baru)...",
          rows: 5,
        },
        {
          key: "profil.sejarah",
          label: "Sejarah Singkat",
          type: "textarea",
          placeholder: "Tuliskan sejarah berdirinya sekolah...",
          rows: 5,
        },
        {
          key: "profil.sambutan",
          label: "Sambutan Kepala Sekolah",
          type: "textarea",
          placeholder: "Sambutan hangat dari kepala sekolah...",
          rows: 5,
        },
      ],
    },
    kontak: {
      title: "Informasi Kontak & Lokasi",
      fields: [
        {
          key: "kontak.alamat",
          label: "Alamat Lengkap",
          type: "textarea",
          placeholder: "Alamat jalan, kelurahan, kecamatan, kota/kabupaten...",
          rows: 2,
        },
        {
          key: "kontak.telepon",
          label: "Nomor Telepon Kantor",
          type: "text",
          placeholder: "(021) 1234567",
        },
        {
          key: "kontak.whatsapp",
          label: "Nomor WhatsApp Humas / Info",
          type: "text",
          placeholder: "+6281234567890",
        },
        {
          key: "kontak.email",
          label: "Email Resmi",
          type: "text",
          placeholder: "info@sekolah.sch.id",
        },
        {
          key: "kontak.jam_kerja",
          label: "Jam Layanan / Kerja",
          type: "text",
          placeholder: "Senin - Jumat, 07:00 - 16:00 WIB",
        },
      ],
    },
    program: {
      title: "Program & Fasilitas",
      fields: [
        {
          key: "program.kejuruan_ringkasan",
          label: "Ringkasan Program Kejuruan",
          type: "textarea",
          placeholder:
            "Penjelasan umum mengenai konsentrasi keahlian yang dibuka...",
          rows: 4,
        },
        {
          key: "program.fasilitas_ringkasan",
          label: "Ringkasan Fasilitas",
          type: "textarea",
          placeholder:
            "Laboratorium komputer modern, bengkel praktik standar industri...",
          rows: 4,
        },
        {
          key: "program.ekstrakurikuler_ringkasan",
          label: "Ringkasan Ekstrakurikuler",
          type: "textarea",
          placeholder: "Pengembangan minat dan bakat siswa...",
          rows: 4,
        },
      ],
    },
    landing: {
      title: "Halaman Utama (Landing Page)",
      fields: [
        {
          key: "landing.hero_title",
          label: "Judul Utama (Hero Headline)",
          type: "text",
          placeholder: "Membentuk Generasi Unggul Berkarakter & Berdaya Saing",
        },
        {
          key: "landing.hero_subtitle",
          label: "Subjudul Utama (Hero Subtitle)",
          type: "textarea",
          placeholder:
            "Lembaga pendidikan terakreditasi A dengan kurikulum berbasis teknologi dan industri...",
          rows: 3,
        },
        {
          key: "landing.keunggulan_1",
          label: "Keunggulan 1",
          type: "text",
          placeholder: "Kurikulum Terkoneksi Industri",
        },
        {
          key: "landing.keunggulan_2",
          label: "Keunggulan 2",
          type: "text",
          placeholder: "Fasilitas Belajar & Lab Standar Internasional",
        },
        {
          key: "landing.keunggulan_3",
          label: "Keunggulan 3",
          type: "text",
          placeholder: "Penyaluran Kerja & Kerjasama Mitra Luas",
        },
      ],
    },
  };

export function PageContentManager() {
  const { user } = useAuth();
  const canManage = hasPermission(user, "content.manage");

  const [activeTab, setActiveTab] = useState<
    "profil" | "kontak" | "program" | "landing"
  >("profil");
  const [contentMap, setContentMap] = useState<PageContentMap>({});
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
      setContentMap(res.items || {});
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
        await simpanKontenHalaman(activeTab, contentMap);
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

  const currentSection = PAGE_SECTIONS[activeTab];

  return (
    <div className="space-y-6">
      {/* Tab Switcher */}
      <div className="flex border-b border-white/10 gap-2 overflow-x-auto pb-px">
        {(
          [
            { id: "profil", label: "Profil Sekolah" },
            { id: "kontak", label: "Kontak & Alamat" },
            { id: "program", label: "Program & Fasilitas" },
            { id: "landing", label: "Landing Hero" },
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
          <h3 className="text-lg font-bold text-white">
            {currentSection.title}
          </h3>
          <p className="mt-1 text-xs text-slate-400">
            Perubahan konten di sini akan langsung tampil pada situs publik
            dengan sistem graceful degradation.
          </p>
        </div>

        {loading ? (
          <div className="py-12 text-center text-sm text-slate-400">
            Memuat data konten...
          </div>
        ) : (
          <div className="space-y-5">
            {currentSection.fields.map((field) => {
              const value = contentMap[field.key] ?? "";
              return (
                <div key={field.key}>
                  <label
                    htmlFor={`input-${field.key}`}
                    className="block text-xs font-bold text-slate-300 mb-1.5"
                  >
                    {field.label}
                  </label>
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
