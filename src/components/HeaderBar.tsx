"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "@/components/ui/Icon";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import { canAccessArea } from "@/lib/auth/access";
import { useAuth } from "@/lib/context/AuthContext";
import {
  BrandLink,
  setDrawerOpen,
  toggleDesktopSidebar,
  useSidebarState,
} from "./AppSidebar";
import {
  BOTTOM_BAR_HREFS,
  NAVIGATION,
  routeIsActive,
} from "./navigation-items";

/**
 * Bilah atas dan bilah bawah layar sempit. Daftar menunya sendiri ada di
 * `AppSidebar`; di sini hanya tombol yang membuka atau menyembunyikannya.
 */
export function HeaderBar() {
  const { user, logout } = useAuth();
  const pathname = usePathname();
  const { desktopOpen, drawerOpen } = useSidebarState();

  if (!user) return null;

  const visibleNavigation = NAVIGATION.filter((item) =>
    canAccessArea(user, item.area),
  );
  const mobileNavigation = visibleNavigation.filter((item) =>
    BOTTOM_BAR_HREFS.has(item.href),
  );
  const contextualMobileItem =
    visibleNavigation.find(
      (item) =>
        !BOTTOM_BAR_HREFS.has(item.href) && routeIsActive(pathname, item.href),
    ) ?? visibleNavigation.find((item) => item.area === "history");
  if (
    contextualMobileItem &&
    !mobileNavigation.some((item) => item.href === contextualMobileItem.href)
  ) {
    mobileNavigation.push(contextualMobileItem);
  }
  const hasMoreMobileItems = visibleNavigation.some(
    (item) => !mobileNavigation.some((direct) => direct.href === item.href),
  );

  return (
    <>
      <header className="sticky top-0 z-50 border-b border-white/10 bg-slate-950/90 px-3 py-2.5 shadow-xl shadow-slate-950/30 backdrop-blur-xl sm:px-5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              onClick={toggleDesktopSidebar}
              aria-expanded={desktopOpen}
              aria-label="Menu samping"
              title={
                desktopOpen
                  ? "Sembunyikan menu samping"
                  : "Tampilkan menu samping"
              }
              className="hidden size-10 shrink-0 place-items-center rounded-xl border border-white/10 bg-white/[0.04] text-slate-300 transition hover:bg-white/[0.07] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 lg:grid"
            >
              <Icon name="menu" className="size-5" />
            </button>
            {/* Di layar lebar merek sudah ada di kepala sidebar selama ia terbuka. */}
            <div className={`min-w-0 ${desktopOpen ? "lg:hidden" : ""}`}>
              <BrandLink />
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <ThemeToggle variant="compact" />

            <div className="hidden min-w-0 items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-2.5 py-1.5 xl:flex">
              <span className="grid size-7 shrink-0 place-items-center rounded-full bg-gradient-to-br from-amber-300 to-amber-500 text-xs font-black text-slate-950">
                {user.nama_operator.charAt(0).toUpperCase()}
              </span>
              <span className="min-w-0 leading-tight">
                <span className="block max-w-24 truncate text-xs font-bold text-white xl:max-w-28">
                  {user.nama_operator}
                </span>
                <span className="block text-[10px] font-medium text-sky-300">
                  {user.role}
                </span>
              </span>
            </div>

            <button
              type="button"
              onClick={logout}
              aria-label="Keluar dari aplikasi"
              title="Keluar"
              className="grid size-10 place-items-center rounded-xl border border-rose-400/20 bg-rose-400/10 text-rose-200 transition hover:bg-rose-400/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-300"
            >
              <Icon name="logout" className="size-4" />
            </button>
          </div>
        </div>
      </header>

      <nav
        aria-label="Navigasi mobile"
        className="mobile-safe-bottom fixed inset-x-0 bottom-0 z-[70] border-t border-slate-200/80 dark:border-white/10 bg-white/95 dark:bg-slate-950/96 px-2 pt-2 shadow-[0_-10px_30px_rgba(0,0,0,0.06)] dark:shadow-[0_-14px_40px_rgba(2,8,23,0.55)] backdrop-blur-xl lg:hidden"
      >
        <div className="mx-auto flex w-full max-w-xl items-stretch justify-around gap-1">
          {mobileNavigation.map((item) => {
            const active = routeIsActive(pathname, item.href);
            if (item.area === "scanner") {
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  aria-label="Buka Terminal Scanner QR Instan"
                  className="group relative -top-3.5 flex flex-col items-center px-1"
                >
                  <div
                    className={`grid size-12 place-items-center rounded-2xl shadow-lg transition-all active:scale-90 ${
                      active
                        ? "bg-gradient-to-tr from-[#003399] via-blue-600 to-[#007aff] text-white ring-4 ring-white dark:ring-slate-950 shadow-blue-500/30 scale-105"
                        : "bg-gradient-to-tr from-[#003399] via-[#0055cc] to-[#007aff] dark:from-[#003399] dark:to-blue-700 text-white ring-4 ring-white dark:ring-slate-950 shadow-blue-500/20 hover:scale-105"
                    }`}
                  >
                    <Icon
                      name="scanner"
                      className="size-6 stroke-[2.2] text-white"
                    />
                  </div>
                  <span
                    className={`mt-0.5 text-[10px] font-black tracking-tight ${
                      active
                        ? "text-blue-600 dark:text-sky-300"
                        : "text-slate-600 dark:text-slate-400"
                    }`}
                  >
                    Scanner
                  </span>
                </Link>
              );
            }

            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`flex min-h-14 min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-xl px-1 text-[10px] font-bold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 active:scale-95 ${
                  active
                    ? "bg-blue-50 dark:bg-[#003399]/30 text-blue-700 dark:text-sky-200 font-bold"
                    : "text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-white/[0.06] hover:text-slate-900 dark:hover:text-white"
                }`}
              >
                <Icon name={item.icon} className="size-5" />
                <span className="w-full truncate text-center">
                  {item.label}
                </span>
              </Link>
            );
          })}

          {hasMoreMobileItems ? (
            <button
              type="button"
              aria-haspopup="dialog"
              aria-expanded={drawerOpen}
              onClick={() => setDrawerOpen(true)}
              className={`flex min-h-14 min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-xl px-1 text-[10px] font-bold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300 ${
                drawerOpen
                  ? "bg-sky-400/15 text-sky-200"
                  : "text-slate-400 hover:bg-white/[0.06] hover:text-white"
              }`}
            >
              <Icon name="menu" className="size-5" />
              {/* Ukuran di span: `button { font: inherit }` di globals.css
                  mengalahkan kelas ukuran teks pada tombolnya sendiri. */}
              <span className="text-[10px] font-bold">Menu</span>
            </button>
          ) : null}
        </div>
      </nav>
    </>
  );
}
