import type { IconName } from "@/components/ui/Icon";
import type { AppArea } from "@/lib/auth/access";

export interface NavigationItem {
  area: AppArea;
  href: string;
  icon: IconName;
  label: string;
}

export const NAVIGATION: readonly NavigationItem[] = [
  { area: "home", href: "/", icon: "home", label: "Home" },
  { area: "scanner", href: "/scanner", icon: "scanner", label: "QR Scanner" },
  {
    area: "dashboard",
    href: "/dashboard",
    icon: "dashboard",
    label: "Dashboard",
  },
  { area: "history", href: "/history", icon: "clock", label: "Riwayat" },
  { area: "karyawan", href: "/karyawan", icon: "user", label: "Karyawan" },
  { area: "idcards", href: "/id-cards", icon: "user", label: "ID Card" },
  { area: "shift", href: "/shift", icon: "clock", label: "Shift" },
  {
    area: "holidays",
    href: "/holidays",
    icon: "calendar",
    label: "Hari Libur",
  },
  {
    area: "operational",
    href: "/operational",
    icon: "tools",
    label: "Operasional",
  },
  {
    area: "payroll",
    href: "/payroll",
    icon: "document",
    label: "Penggajian",
  },
  {
    area: "akademik",
    href: "/akademik",
    icon: "calendar",
    label: "Akademik",
  },
  {
    area: "presensi_kelas",
    href: "/presensi-kelas",
    icon: "clock",
    label: "Presensi KBM",
  },
  {
    area: "jurnal_mengajar",
    href: "/jurnal-mengajar",
    icon: "document",
    label: "Jurnal Mengajar",
  },
  {
    area: "leger_kehadiran",
    href: "/leger-kehadiran",
    icon: "calendar",
    label: "Leger Kehadiran",
  },
  {
    area: "guru",
    href: "/guru",
    icon: "user",
    label: "Guru / PTK",
  },
  {
    area: "siswa",
    href: "/siswa",
    icon: "users",
    label: "Peserta Didik",
  },
  {
    area: "dasbor_kehadiran",
    href: "/dasbor-kehadiran",
    icon: "dashboard",
    label: "Dasbor Kehadiran",
  },
  {
    area: "notifikasi_wa",
    href: "/notifikasi-wa",
    icon: "whatsapp",
    label: "Notifikasi WA",
  },
  {
    area: "bimbingan_konseling",
    href: "/bimbingan-konseling",
    icon: "users",
    label: "Bimbingan Konseling",
  },
  {
    area: "pmb",
    href: "/pmb",
    icon: "document",
    label: "PMB",
  },
  {
    area: "nilai",
    href: "/nilai",
    icon: "document",
    label: "Penilaian",
  },
  {
    area: "konten",
    href: "/konten",
    icon: "monitor",
    label: "Situs Publik",
  },
  {
    area: "audit",
    href: "/audit-absensi",
    icon: "alert",
    label: "Audit Absensi",
  },
  {
    area: "operators",
    href: "/operators",
    icon: "users",
    label: "Operator",
  },
  {
    area: "password_reset",
    href: "/riwayat-reset-password",
    icon: "lock",
    label: "Riwayat Reset",
  },
  {
    area: "karyawan",
    href: "/riwayat-identitas-karyawan",
    icon: "history",
    label: "Riwayat Identitas",
  },
  {
    area: "attendance_photo",
    href: "/foto-absensi",
    icon: "eye",
    label: "Foto Absensi",
  },
  {
    area: "settings",
    href: "/settings",
    icon: "settings",
    label: "Pengaturan",
  },
];

/** Tombol tetap di bilah bawah layar sempit; sisanya dibuka lewat "Menu". */
export const BOTTOM_BAR_HREFS: ReadonlySet<string> = new Set([
  "/",
  "/scanner",
  "/operational",
  "/karyawan",
  "/settings",
]);

interface NavigationGroupSpec {
  label: string;
  /** Tampil tanpa judul dan tidak bisa dilipat. */
  pinned?: boolean;
  hrefs: readonly string[];
}

/**
 * Pengelompokan menu sidebar. MURNI TAMPILAN: tidak ada rute yang berubah dan
 * hak aksesnya tetap ditentukan `canAccessArea` per item.
 *
 * Dikunci per href, bukan per area: area `karyawan` punya dua halaman
 * (Karyawan dan Riwayat Identitas), dan pencarian per area hanya menemukan
 * yang pertama.
 *
 * `Operator` masuk Sistem, bukan Personil: yang dikelola di sana adalah akun
 * aplikasi beserta role-nya, satu urusan dengan Riwayat Reset dan Pengaturan.
 */
export const NAVIGATION_GROUPS: readonly NavigationGroupSpec[] = [
  { label: "Utama", pinned: true, hrefs: ["/", "/scanner", "/dashboard"] },
  {
    label: "Kehadiran",
    hrefs: [
      "/operational",
      "/history",
      "/dasbor-kehadiran",
      "/audit-absensi",
      "/foto-absensi",
    ],
  },
  {
    label: "Personil",
    hrefs: [
      "/karyawan",
      "/guru",
      "/siswa",
      "/id-cards",
      "/riwayat-identitas-karyawan",
    ],
  },
  {
    label: "Akademik & KBM",
    hrefs: [
      "/akademik",
      "/presensi-kelas",
      "/jurnal-mengajar",
      "/leger-kehadiran",
      "/nilai",
      "/bimbingan-konseling",
    ],
  },
  {
    label: "Penggajian & Aturan Kerja",
    hrefs: ["/payroll", "/shift", "/holidays"],
  },
  {
    label: "Komunikasi & Situs Publik",
    hrefs: ["/notifikasi-wa", "/konten", "/pmb"],
  },
  {
    label: "Sistem",
    hrefs: ["/settings", "/operators", "/riwayat-reset-password"],
  },
];

export interface NavigationGroup {
  label: string;
  pinned: boolean;
  items: NavigationItem[];
}

export function routeIsActive(pathname: string, href: string) {
  return href === "/"
    ? pathname === href
    : pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * Susun item yang boleh diakses pengguna ke dalam kelompoknya. Kelompok yang
 * kosong tidak dikembalikan, judulnya sekalian.
 *
 * Halaman yang lupa didaftarkan di `NAVIGATION_GROUPS` TETAP TAMPIL di
 * "Lainnya", bukan hilang diam-diam: `audit:page-guard` memeriksa izin, bukan
 * apakah sebuah halaman bisa dicapai dari navigasi.
 */
export function groupNavigation(
  items: readonly NavigationItem[],
): NavigationGroup[] {
  const groups: NavigationGroup[] = NAVIGATION_GROUPS.map((group) => ({
    label: group.label,
    pinned: group.pinned ?? false,
    items: group.hrefs
      .map((href) => items.find((item) => item.href === href))
      .filter((item): item is NavigationItem => Boolean(item)),
  }));
  const grouped = new Set(NAVIGATION_GROUPS.flatMap((group) => group.hrefs));
  groups.push({
    label: "Lainnya",
    pinned: false,
    items: items.filter((item) => !grouped.has(item.href)),
  });
  return groups.filter((group) => group.items.length > 0);
}
