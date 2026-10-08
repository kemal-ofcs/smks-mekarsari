"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useSyncExternalStore } from "react";
import { BrandLogo } from "@/components/ui/BrandLogo";
import { Icon } from "@/components/ui/Icon";
import { canAccessArea } from "@/lib/auth/access";
import { BRANDING } from "@/lib/constants/branding";
import { useAuth } from "@/lib/context/AuthContext";
import { useAppName } from "@/lib/hooks/useAppName";
import { useCompanyName } from "@/lib/hooks/useCompanyName";
import { useOnlineStatus } from "@/lib/hooks/useOnlineStatus";
import {
  groupNavigation,
  NAVIGATION,
  type NavigationGroup,
  routeIsActive,
} from "./navigation-items";

const STORAGE_KEY = "kos.sidebar.hidden";
const DESKTOP_QUERY = "(min-width: 1024px)";
/** Sampai jumlah ini seluruh kelompok dibuka: melipat menu sependek itu hanya menambah klik. */
const OPEN_ALL_MAX_ITEMS = 10;

interface SidebarState {
  /** Sidebar tetap di layar lebar. Preferensi perangkat, tersimpan di localStorage. */
  desktopOpen: boolean;
  /** Laci di layar sempit. Tidak disimpan. */
  drawerOpen: boolean;
}

/**
 * Status sidebar hidup di tingkat modul, bukan `useState`: setiap halaman
 * merender `AppShell`-nya sendiri, sehingga shell dipasang ulang pada setiap
 * perpindahan halaman dan state React di dalamnya kembali ke awal. Sidebar
 * yang disembunyikan akan muncul lagi sekejap di setiap klik menu.
 */
const SERVER_STATE: SidebarState = { desktopOpen: true, drawerOpen: false };
let state = SERVER_STATE;
let loaded = false;
const listeners = new Set<() => void>();

function getSnapshot(): SidebarState {
  if (!loaded) {
    loaded = true;
    try {
      if (window.localStorage.getItem(STORAGE_KEY) === "1") {
        state = { ...state, desktopOpen: false };
      }
    } catch {
      // Penyimpanan lokal ditolak: sidebar tetap terbuka, cukup tidak diingat.
    }
  }
  return state;
}

function update(patch: Partial<SidebarState>) {
  state = { ...getSnapshot(), ...patch };
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useSidebarState(): SidebarState {
  return useSyncExternalStore(subscribe, getSnapshot, () => SERVER_STATE);
}

export function toggleDesktopSidebar() {
  const desktopOpen = !getSnapshot().desktopOpen;
  try {
    window.localStorage.setItem(STORAGE_KEY, desktopOpen ? "0" : "1");
  } catch {
    // Penyimpanan lokal ditolak: pilihan tetap berlaku sampai aplikasi
    // ditutup, cukup tidak diingat pada pembukaan berikutnya.
  }
  update({ desktopOpen });
}

export function setDrawerOpen(drawerOpen: boolean) {
  if (getSnapshot().drawerOpen !== drawerOpen) update({ drawerOpen });
}

// Daftarnya kembali ke atas setiap kali shell dipasang ulang; tanpa ini
// halaman aktif di kelompok bawah berada di luar tampilan setelah diklik.
function scrollActiveLinkIntoView(root: HTMLElement | null) {
  root
    ?.querySelector('[aria-current="page"]')
    ?.scrollIntoView({ block: "nearest" });
}

export function BrandLink({ onNavigate }: { onNavigate?: () => void }) {
  const isOnline = useOnlineStatus();
  const appName = useAppName();
  const companyName = useCompanyName();

  return (
    <Link
      href="/"
      onClick={onNavigate}
      className="flex min-w-0 items-center gap-2 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
      aria-label={`Buka Home ${BRANDING.appDisplayName}`}
    >
      <BrandLogo size={36} />
      <span className="min-w-0 leading-tight">
        <span className="block truncate text-sm font-black tracking-tight text-white">
          {appName}
        </span>
        <span className="block truncate text-[10px] font-semibold text-sky-300">
          {companyName}
        </span>
        <span className="flex items-center gap-1.5 text-[10px] font-medium text-slate-400">
          <span
            className={`size-1.5 rounded-full ${isOnline ? "bg-emerald-400" : "bg-amber-300"}`}
          />
          <span className="truncate">{isOnline ? "Online" : "Offline"}</span>
        </span>
      </span>
    </Link>
  );
}

function SidebarNav({
  groups,
  onNavigate,
}: {
  groups: NavigationGroup[];
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const navRef = useRef<HTMLElement>(null);
  const openAll =
    groups.reduce((total, group) => total + group.items.length, 0) <=
    OPEN_ALL_MAX_ITEMS;

  useEffect(() => scrollActiveLinkIntoView(navRef.current), []);

  const renderItems = (group: NavigationGroup) =>
    group.items.map((item) => {
      const active = routeIsActive(pathname, item.href);
      return (
        <Link
          key={item.href}
          href={item.href}
          onClick={onNavigate}
          aria-current={active ? "page" : undefined}
          className={`flex min-h-11 items-center gap-2.5 rounded-lg px-3 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 lg:min-h-9 ${
            active
              ? "bg-sky-400/15 text-sky-200"
              : "text-slate-300 hover:bg-white/[0.07] hover:text-white"
          }`}
        >
          <Icon name={item.icon} className="size-4 shrink-0" />
          <span className="truncate">{item.label}</span>
        </Link>
      );
    });

  return (
    <nav
      ref={navRef}
      aria-label="Navigasi utama"
      className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-4"
    >
      {groups.map((group) =>
        group.pinned ? (
          <div key={group.label} className="space-y-0.5 pb-2">
            {renderItems(group)}
          </div>
        ) : (
          <details
            key={group.label}
            className="group border-t border-white/10 py-1"
            open={
              openAll ||
              group.items.some((item) => routeIsActive(pathname, item.href))
            }
          >
            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 rounded-lg px-3 text-xs font-bold text-slate-400 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 lg:min-h-9 [&::-webkit-details-marker]:hidden">
              <span className="truncate">{group.label}</span>
              <Icon
                name="chevron-right"
                className="size-3.5 shrink-0 transition-transform group-open:rotate-90"
              />
            </summary>
            <div className="space-y-0.5 pb-1">{renderItems(group)}</div>
          </details>
        ),
      )}
    </nav>
  );
}

/**
 * Menu aplikasi: kolom tetap di layar lebar, laci di layar sempit. Keduanya
 * merender daftar yang sama dari `navigation-items.ts`.
 */
export function AppSidebar() {
  const { user, logout } = useAuth();
  const { desktopOpen, drawerOpen } = useSidebarState();
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (drawerOpen && !dialog.open) {
      dialog.showModal();
      scrollActiveLinkIntoView(dialog);
    }
    if (!drawerOpen && dialog.open) dialog.close();
  }, [drawerOpen]);

  // Laci yang masih terbuka saat jendela dilebarkan disembunyikan CSS, tetapi
  // dialog modalnya tetap membuat seluruh halaman tidak bisa diklik.
  useEffect(() => {
    const media = window.matchMedia(DESKTOP_QUERY);
    const closeOnDesktop = () => {
      if (media.matches) setDrawerOpen(false);
    };
    media.addEventListener("change", closeOnDesktop);
    return () => {
      media.removeEventListener("change", closeOnDesktop);
      setDrawerOpen(false);
    };
  }, []);

  if (!user) return null;

  const groups = groupNavigation(
    NAVIGATION.filter((item) => canAccessArea(user, item.area)),
  );
  const closeDrawer = () => setDrawerOpen(false);

  return (
    <>
      {desktopOpen ? (
        <aside className="app-sidebar sticky top-0 z-10 hidden h-dvh w-64 shrink-0 flex-col self-start border-r border-white/10 bg-slate-950 lg:flex print:hidden">
          <div className="px-4 py-3">
            <BrandLink />
          </div>
          <SidebarNav groups={groups} />
        </aside>
      ) : null}

      {/* biome-ignore lint/a11y/useKeyWithClickEvents: padanan keyboard-nya Escape, yang ditangani dialog native lewat onClose */}
      <dialog
        ref={dialogRef}
        aria-label="Menu aplikasi"
        onClose={closeDrawer}
        onClick={(event) => {
          // Klik pada backdrop mendarat di elemen dialognya sendiri.
          if (event.target === event.currentTarget) closeDrawer();
        }}
        className="app-sidebar m-0 h-dvh max-h-none w-72 max-w-[85vw] flex-col border-0 border-r border-white/10 bg-slate-950 p-0 text-slate-100 backdrop:bg-slate-950/70 open:flex lg:hidden"
      >
        <div className="flex items-center justify-between gap-2 py-3 pl-4 pr-2">
          <BrandLink onNavigate={closeDrawer} />
          <button
            type="button"
            onClick={closeDrawer}
            aria-label="Tutup menu"
            className="grid size-11 shrink-0 place-items-center rounded-xl text-slate-300 transition-colors hover:bg-white/[0.07] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          >
            <Icon name="x" className="size-5" />
          </button>
        </div>
        <SidebarNav groups={groups} onNavigate={closeDrawer} />
        {/* Di layar sempit Keluar hanya ada di sini; HeaderBar menyembunyikannya
            supaya tidak tersentuh tanpa sengaja di samping tombol tema. */}
        <div className="mobile-safe-bottom border-t border-white/10 px-2 pt-2">
          <button
            type="button"
            onClick={() => {
              closeDrawer();
              logout();
            }}
            className="flex min-h-11 w-full items-center gap-2.5 rounded-lg border border-rose-400/20 bg-rose-400/10 px-3 text-sm font-semibold text-rose-200 transition-colors hover:bg-rose-400/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-300"
          >
            <Icon name="logout" className="size-4 shrink-0" />
            <span>Keluar</span>
          </button>
        </div>
      </dialog>
    </>
  );
}
