"use client";

import Link from "next/link";
import { Icon } from "@/components/ui/Icon";

interface FloatingScanDockProps {
  href?: string;
  isActive?: boolean;
  className?: string;
}

export function FloatingScanDock({
  href = "/scanner",
  isActive = false,
  className = "",
}: FloatingScanDockProps) {
  return (
    <Link
      href={href}
      aria-label="Buka Terminal Scanner QR Instan"
      className={`group relative -top-5 flex flex-col items-center focus-visible:outline-none ${className}`}
    >
      <div
        className={`grid size-14 place-items-center rounded-2xl shadow-lg transition-all duration-200 active:scale-90 ${
          isActive
            ? "bg-gradient-to-tr from-[#003399] via-blue-600 to-[#007aff] text-white ring-4 ring-white dark:ring-slate-950 ring-offset-2 ring-offset-blue-600/40 scale-105 shadow-blue-500/30"
            : "bg-gradient-to-tr from-[#003399] via-[#0055cc] to-[#007aff] dark:from-[#003399] dark:via-[#002266] dark:to-blue-700 text-white ring-4 ring-white dark:ring-slate-950 hover:scale-105 shadow-blue-500/20 dark:shadow-blue-950/40"
        }`}
      >
        <Icon name="scanner" className="size-7 stroke-[2.2] text-white" />
      </div>
      <span
        className={`mt-1 text-[11px] font-black tracking-tight transition-colors ${
          isActive
            ? "text-blue-600 dark:text-sky-300"
            : "text-slate-600 dark:text-slate-400"
        }`}
      >
        Scanner
      </span>
    </Link>
  );
}
