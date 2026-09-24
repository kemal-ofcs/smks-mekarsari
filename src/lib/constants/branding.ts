/**
 * Konstanta branding terpusat (Single Source of Truth).
 *
 * ATURAN:
 * - `appDisplayName` adalah nama aplikasi yang tidak berubah mengikuti
 *   nama instansi — dipakai di metadata, TOTP issuer, dan email sistem.
 * - `defaultCompanyName` adalah nilai fallback sementara sebelum
 *   `company_profile.company_name` selesai dimuat dari database.
 * - File ini disalin ke mobile via `mobile/scripts/sync-frontend-lib.ts`
 *   melalui direktori `lib/constants`. JANGAN import dari path mobile secara
 *   langsung; selalu edit dari web-desktop sebagai sumber kanonik.
 */
export const BRANDING = {
  /** Nama tetap aplikasi (tidak bergantung pada nama instansi). */
  appDisplayName: "Manajemen Sekolah",
  /**
   * Placeholder instansi sebelum admin mengisi Pengaturan. Sengaja terbaca
   * sebagai placeholder, bukan nama orang atau lembaga karangan: nilai ini
   * ikut tercetak di kartu dan laporan sekolah baru.
   */
  defaultCompanyName: "Nama Instansi",
  defaultBranchName: "Pusat",
  defaultAddress: "Alamat Instansi",
  defaultPhone: "-",
  defaultEmail: "-",
  defaultWebsite: "-",
  defaultLeaderTitle: "Kepala Sekolah",
  defaultLeaderName: "-",
  defaultLeaderNip: "-",
  defaultCardTerms: `1. Kartu ini adalah tanda pengenal resmi personil instansi.\n2. Wajib dibawa dan dipindai (scan QR) setiap datang dan pulang.\n3. Dilarang memindahtangankan atau meminjamkan kartu ini kepada pihak lain.\n4. Bila kartu hilang atau ditemukan, segera laporkan ke bagian tata usaha.`,
  defaultTemplateName: "Template Standar ID Card",
} as const;

/**
 * Mengambil singkatan nama perusahaan untuk BrandLogo fallback.
 * Contoh: "PT Maju Bersama" => "PMB", "Nama Instansi" => "NI"
 * Maks 4 karakter.
 */
export function companyInitials(companyName?: string | null): string {
  const name = companyName?.trim() || BRANDING.defaultCompanyName;
  const words = name.split(/\s+/).filter(Boolean);
  if (words.length === 1) return name.slice(0, 4).toUpperCase();
  return words
    .slice(0, 4)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
}
