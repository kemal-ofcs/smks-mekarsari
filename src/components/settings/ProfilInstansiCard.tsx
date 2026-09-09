"use client";

import type { ChangeEvent, Dispatch, FormEvent, SetStateAction } from "react";
import { Icon } from "@/components/ui/Icon";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { BRANDING } from "@/lib/constants/branding";
import type { CompanyProfile } from "@/lib/gateways/company-profile";

/**
 * Profil Instansi pada halaman Pengaturan.
 *
 * Dipisahkan dari halaman Pengaturan demi keterbacaan. Berbeda dengan panel ID
 * Card, seksi ini SELALU dirender bersama seksi lainnya, sehingga pemisahannya
 * TIDAK memperkecil apa pun yang diunduh — yang berubah hanyalah panjang berkas
 * yang harus dibaca orang berikutnya.
 *
 * Nama propsnya sengaja identik dengan nama variabel di halaman induk supaya
 * badan JSX-nya berpindah tanpa satu pun suntingan.
 */
export interface ProfilInstansiCardProps {
  appDisplayName: string;
  setAppDisplayName: Dispatch<SetStateAction<string>>;
  companyProfile: CompanyProfile;
  setCompanyProfile: Dispatch<SetStateAction<CompanyProfile>>;
  companyProfileBusy: boolean;
  handleCompanyProfileSubmit: (e: FormEvent<HTMLFormElement>) => Promise<void>;
  handleCompanyLogoUpload: (
    event: ChangeEvent<HTMLInputElement>,
  ) => Promise<void>;
  handleSignatureUpload: (
    event: ChangeEvent<HTMLInputElement>,
  ) => Promise<void>;
}

export function ProfilInstansiCard({
  appDisplayName,
  setAppDisplayName,
  companyProfile,
  setCompanyProfile,
  companyProfileBusy,
  handleCompanyProfileSubmit,
  handleCompanyLogoUpload,
  handleSignatureUpload,
}: ProfilInstansiCardProps) {
  return (
    <section className="app-panel rounded-3xl p-5 sm:p-7">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-4">
          <span className="grid size-11 shrink-0 place-items-center rounded-2xl border border-sky-300/20 bg-sky-300/10 text-sky-200">
            <Icon name="tools" className="size-5" />
          </span>
          <div>
            <h2 className="text-base font-black text-white">
              Profil Instansi & Identitas ID Card
            </h2>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-400">
              Data resmi organisasi, kontak instansi, tanda tangan pimpinan, dan
              ketentuan kartu yang akan tercetak otomatis pada ID Card Karyawan
              dan laporan resmi.
            </p>
          </div>
        </div>
        <StatusBadge tone="info">
          {companyProfile.timezone || "Asia/Jakarta"}
        </StatusBadge>
      </div>

      <form onSubmit={handleCompanyProfileSubmit} className="mt-6 space-y-6">
        {/* 1. Informasi Utama */}
        <div className="grid gap-4 sm:grid-cols-3">
          <label className="space-y-1.5 text-xs font-bold text-slate-300 sm:col-span-3">
            Nama Tampilan Aplikasi / Sistem
            <input
              type="text"
              value={appDisplayName}
              onChange={(e) => setAppDisplayName(e.target.value)}
              placeholder={`Contoh: ${BRANDING.appDisplayName}`}
              className="min-h-11 w-full rounded-xl border border-white/10 bg-slate-950 px-3 text-white outline-none focus:border-sky-400"
            />
            <span className="text-[11px] font-normal text-slate-400 block">
              Nama sistem aplikasi yang ditampilkan pada judul aplikasi, form
              login, dan header.
            </span>
          </label>
          <label className="space-y-1.5 text-xs font-bold text-slate-300 sm:col-span-2">
            Nama Resmi Instansi / Organisasi *
            <input
              type="text"
              required
              value={companyProfile.company_name}
              onChange={(e) =>
                setCompanyProfile((c) => ({
                  ...c,
                  company_name: e.target.value,
                }))
              }
              placeholder="Contoh: PT Maju Bersama / Nama Instansi"
              className="min-h-11 w-full rounded-xl border border-white/10 bg-slate-950 px-3 text-white outline-none focus:border-sky-400"
            />
          </label>
          <label className="space-y-1.5 text-xs font-bold text-slate-300">
            Unit / Cabang / Wilayah
            <input
              type="text"
              value={companyProfile.branch_name || ""}
              onChange={(e) =>
                setCompanyProfile((c) => ({
                  ...c,
                  branch_name: e.target.value,
                }))
              }
              placeholder="Contoh: Kantor Pusat / Cabang 1"
              className="min-h-11 w-full rounded-xl border border-white/10 bg-slate-950 px-3 text-white outline-none focus:border-sky-400"
            />
          </label>
        </div>

        {/* 2. Logo & Tanda Tangan */}
        <div className="grid gap-6 sm:grid-cols-2">
          <div className="rounded-2xl border border-white/10 bg-slate-950/60 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-white">
                Logo Resmi Instansi (Untuk ID Card)
              </span>
              {companyProfile.logo_url ? (
                <button
                  type="button"
                  onClick={() =>
                    setCompanyProfile((c) => ({ ...c, logo_url: null }))
                  }
                  className="text-[11px] text-rose-400 hover:underline"
                >
                  Hapus Logo
                </button>
              ) : null}
            </div>
            <div className="flex items-center gap-4">
              <div className="grid size-20 shrink-0 place-items-center rounded-xl border border-dashed border-white/20 bg-slate-900 overflow-hidden">
                {companyProfile.logo_url ? (
                  /* biome-ignore lint/performance/noImgElement: Data URL preview */
                  <img
                    src={companyProfile.logo_url}
                    alt="Logo Instansi"
                    className="max-h-full max-w-full object-contain p-1"
                  />
                ) : (
                  <span className="text-[10px] text-slate-500">
                    Belum ada logo
                  </span>
                )}
              </div>
              <div className="flex-1 space-y-1.5">
                <label className="inline-flex min-h-9 cursor-pointer items-center justify-center gap-2 rounded-xl bg-slate-800 px-3 text-xs font-bold text-white border border-white/10 hover:bg-slate-700">
                  <Icon name="upload" className="size-3.5" />
                  Pilih Logo PNG
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    onChange={handleCompanyLogoUpload}
                    className="sr-only"
                  />
                </label>
                <p className="text-[11px] text-slate-500">
                  Format PNG transparan resolusi tinggi disarankan (Maks 2 MB).
                </p>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-slate-950/60 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-white">
                Tanda Tangan & Stempel Pimpinan (ID Card)
              </span>
              {companyProfile.signature_url ? (
                <button
                  type="button"
                  onClick={() =>
                    setCompanyProfile((c) => ({
                      ...c,
                      signature_url: null,
                    }))
                  }
                  className="text-[11px] text-rose-400 hover:underline"
                >
                  Hapus Tanda Tangan
                </button>
              ) : null}
            </div>
            <div className="flex items-center gap-4">
              <div className="grid size-20 shrink-0 place-items-center rounded-xl border border-dashed border-white/20 bg-slate-900 overflow-hidden">
                {companyProfile.signature_url ? (
                  /* biome-ignore lint/performance/noImgElement: Data URL preview */
                  <img
                    src={companyProfile.signature_url}
                    alt="Tanda Tangan"
                    className="max-h-full max-w-full object-contain p-1"
                  />
                ) : (
                  <span className="text-[10px] text-slate-500">Belum ada</span>
                )}
              </div>
              <div className="flex-1 space-y-1.5">
                <label className="inline-flex min-h-9 cursor-pointer items-center justify-center gap-2 rounded-xl bg-slate-800 px-3 text-xs font-bold text-white border border-white/10 hover:bg-slate-700">
                  <Icon name="upload" className="size-3.5" />
                  Pilih TTD / Stempel
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    onChange={handleSignatureUpload}
                    className="sr-only"
                  />
                </label>
                <p className="text-[11px] text-slate-500">
                  Gambar scan tanda tangan/stempel transparan di belakang ID
                  card.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* 3. Kontak & Alamat */}
        <div className="grid gap-4 sm:grid-cols-4">
          <label className="space-y-1.5 text-xs font-bold text-slate-300 sm:col-span-4">
            Alamat Lengkap Kantor / Instansi
            <textarea
              rows={2}
              value={companyProfile.address || ""}
              onChange={(e) =>
                setCompanyProfile((c) => ({
                  ...c,
                  address: e.target.value,
                }))
              }
              placeholder="Contoh: Jl. Jend. Sudirman Kav. 52-53, Senayan, Jakarta Selatan"
              className="w-full rounded-xl border border-white/10 bg-slate-950 p-3 text-white outline-none focus:border-sky-400 text-xs"
            />
          </label>
          <label className="space-y-1.5 text-xs font-bold text-slate-300 sm:col-span-1">
            No. Telepon / Hotline
            <input
              type="text"
              value={companyProfile.phone || ""}
              onChange={(e) =>
                setCompanyProfile((c) => ({
                  ...c,
                  phone: e.target.value,
                }))
              }
              placeholder="021-5550123"
              className="min-h-11 w-full rounded-xl border border-white/10 bg-slate-950 px-3 text-white outline-none focus:border-sky-400 font-mono"
            />
          </label>
          <label className="space-y-1.5 text-xs font-bold text-slate-300 sm:col-span-1">
            Email Resmi
            <input
              type="email"
              value={companyProfile.email || ""}
              onChange={(e) =>
                setCompanyProfile((c) => ({
                  ...c,
                  email: e.target.value,
                }))
              }
              placeholder="info@instansi.id"
              className="min-h-11 w-full rounded-xl border border-white/10 bg-slate-950 px-3 text-white outline-none focus:border-sky-400"
            />
          </label>
          <label className="space-y-1.5 text-xs font-bold text-slate-300 sm:col-span-1">
            Website
            <input
              type="text"
              value={companyProfile.website || ""}
              onChange={(e) =>
                setCompanyProfile((c) => ({
                  ...c,
                  website: e.target.value,
                }))
              }
              placeholder="https://instansi.id"
              className="min-h-11 w-full rounded-xl border border-white/10 bg-slate-950 px-3 text-white outline-none focus:border-sky-400"
            />
          </label>
          <label className="space-y-1.5 text-xs font-bold text-slate-300 sm:col-span-1">
            Zona Waktu
            <select
              value={companyProfile.timezone || "Asia/Jakarta"}
              onChange={(e) =>
                setCompanyProfile((c) => ({
                  ...c,
                  timezone: e.target.value,
                }))
              }
              className="min-h-11 w-full rounded-xl border border-white/10 bg-slate-950 px-3 text-white outline-none focus:border-sky-400"
            >
              <option value="Asia/Jakarta">WIB (Asia/Jakarta)</option>
              <option value="Asia/Makassar">WITA (Asia/Makassar)</option>
              <option value="Asia/Jayapura">WIT (Asia/Jayapura)</option>
            </select>
          </label>
        </div>

        {/* 4. Data Pimpinan */}
        <div className="grid gap-4 sm:grid-cols-3">
          <label className="space-y-1.5 text-xs font-bold text-slate-300">
            Nama Lengkap Pimpinan / Penandatangan
            <input
              type="text"
              value={companyProfile.leader_name || ""}
              onChange={(e) =>
                setCompanyProfile((c) => ({
                  ...c,
                  leader_name: e.target.value,
                }))
              }
              placeholder="Contoh: Dr. H. Ahmad Fauzi, M.M."
              className="min-h-11 w-full rounded-xl border border-white/10 bg-slate-950 px-3 text-white outline-none focus:border-sky-400"
            />
          </label>
          <label className="space-y-1.5 text-xs font-bold text-slate-300">
            Jabatan Pimpinan
            <input
              type="text"
              value={companyProfile.leader_title || ""}
              onChange={(e) =>
                setCompanyProfile((c) => ({
                  ...c,
                  leader_title: e.target.value,
                }))
              }
              placeholder="Contoh: Direktur Utama / Kepala Kantor"
              className="min-h-11 w-full rounded-xl border border-white/10 bg-slate-950 px-3 text-white outline-none focus:border-sky-400"
            />
          </label>
          <label className="space-y-1.5 text-xs font-bold text-slate-300">
            NIP / NIK / No. Registrasi
            <input
              type="text"
              value={companyProfile.leader_nip || ""}
              onChange={(e) =>
                setCompanyProfile((c) => ({
                  ...c,
                  leader_nip: e.target.value,
                }))
              }
              placeholder="19750815 200003 1 002"
              className="min-h-11 w-full rounded-xl border border-white/10 bg-slate-950 px-3 text-white outline-none focus:border-sky-400 font-mono"
            />
          </label>
        </div>

        {/* 5. Ketentuan Kartu */}
        <label className="block space-y-1.5 text-xs font-bold text-slate-300">
          Syarat & Ketentuan Default di Belakang ID Card
          <textarea
            rows={4}
            value={companyProfile.card_terms || ""}
            onChange={(e) =>
              setCompanyProfile((c) => ({
                ...c,
                card_terms: e.target.value,
              }))
            }
            placeholder="Tuliskan butir-butir syarat & ketentuan ID card..."
            className="w-full rounded-xl border border-white/10 bg-slate-950 p-3 text-white outline-none focus:border-sky-400 text-xs font-mono leading-5"
          />
        </label>

        <div>
          <button
            type="submit"
            disabled={companyProfileBusy}
            className="min-h-11 rounded-xl bg-sky-400 px-6 text-xs font-black text-slate-950 shadow-lg shadow-sky-950/20 transition hover:bg-sky-300 disabled:opacity-50 inline-flex items-center gap-2"
          >
            <Icon name="check" className="size-4" />
            <span>
              {companyProfileBusy
                ? "Menyimpan Profil..."
                : "Simpan Profil Instansi"}
            </span>
          </button>
        </div>
      </form>
    </section>
  );
}
