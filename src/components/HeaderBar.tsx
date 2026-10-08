"use client";

import { Icon } from "@/components/ui/Icon";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import { useAuth } from "@/lib/context/AuthContext";
import {
  BrandLink,
  setDrawerOpen,
  toggleDesktopSidebar,
  useSidebarState,
} from "./AppSidebar";

const MENU_BUTTON_CLASS =
  "shrink-0 place-items-center rounded-xl border border-white/10 bg-white/[0.04] text-slate-300 transition hover:bg-white/[0.07] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500";

/**
 * Bilah atas. Daftar menunya sendiri ada di `AppSidebar`; di sini hanya tombol
 * yang membukanya: kolom samping di layar lebar, laci di layar sempit. Di
 * layar sempit tombol Keluar ikut pindah ke dalam laci.
 */
export function HeaderBar() {
  const { user, logout } = useAuth();
  const { desktopOpen, drawerOpen } = useSidebarState();

  if (!user) return null;

  return (
    <header className="sticky top-0 z-50 border-b border-white/10 bg-slate-950/90 px-3 py-2.5 shadow-xl shadow-slate-950/30 backdrop-blur-xl sm:px-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            aria-haspopup="dialog"
            aria-expanded={drawerOpen}
            aria-label="Buka menu"
            className={`grid size-11 lg:hidden ${MENU_BUTTON_CLASS}`}
          >
            <Icon name="menu" className="size-5" />
          </button>
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
            className={`hidden size-10 lg:grid ${MENU_BUTTON_CLASS}`}
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
            className="hidden size-10 place-items-center rounded-xl border border-rose-400/20 bg-rose-400/10 text-rose-200 transition hover:bg-rose-400/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-300 lg:grid"
          >
            <Icon name="logout" className="size-4" />
          </button>
        </div>
      </div>
    </header>
  );
}
