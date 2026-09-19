"use client";

import Link from "next/link";
import { Icon, type IconName } from "@/components/ui/Icon";

export interface QuickActionTileProps {
  href: string;
  icon: IconName;
  title: string;
  subtitle?: string;
  badge?: number | string;
  badgeColor?: "rose" | "amber" | "emerald" | "sky";
  tone?: "primary" | "emerald" | "amber" | "purple" | "neutral";
  isPrimaryAction?: boolean;
}

const TONE_STYLES = {
  primary: {
    iconBg:
      "bg-blue-600/15 text-blue-600 dark:bg-blue-500/20 dark:text-sky-300",
    border:
      "border-slate-200/80 hover:border-blue-500/50 dark:border-slate-800 dark:hover:border-blue-500/50",
    hoverBg: "hover:bg-blue-50/50 dark:hover:bg-slate-900/60",
  },
  emerald: {
    iconBg:
      "bg-emerald-600/15 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300",
    border:
      "border-slate-200/80 hover:border-emerald-500/50 dark:border-slate-800 dark:hover:border-emerald-500/50",
    hoverBg: "hover:bg-emerald-50/50 dark:hover:bg-slate-900/60",
  },
  amber: {
    iconBg:
      "bg-amber-600/15 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300",
    border:
      "border-slate-200/80 hover:border-amber-500/50 dark:border-slate-800 dark:hover:border-amber-500/50",
    hoverBg: "hover:bg-amber-50/50 dark:hover:bg-slate-900/60",
  },
  purple: {
    iconBg:
      "bg-purple-600/15 text-purple-700 dark:bg-purple-500/20 dark:text-purple-300",
    border:
      "border-slate-200/80 hover:border-purple-500/50 dark:border-slate-800 dark:hover:border-purple-500/50",
    hoverBg: "hover:bg-purple-50/50 dark:hover:bg-slate-900/60",
  },
  neutral: {
    iconBg: "bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-200",
    border:
      "border-slate-200/80 hover:border-slate-400 dark:border-slate-800 dark:hover:border-slate-600",
    hoverBg: "hover:bg-slate-100/60 dark:hover:bg-slate-900/60",
  },
};

export function QuickActionTile({
  href,
  icon,
  title,
  badge,
  badgeColor = "rose",
  tone = "primary",
  isPrimaryAction = false,
}: QuickActionTileProps) {
  const styles = TONE_STYLES[tone] || TONE_STYLES.primary;

  const badgeBg = {
    rose: "bg-rose-500 text-white",
    amber: "bg-amber-500 text-white",
    emerald: "bg-emerald-500 text-white",
    sky: "bg-sky-500 text-white",
  }[badgeColor];

  return (
    <Link
      href={href}
      className={`group relative flex flex-col items-center justify-center text-center p-3.5 sm:p-4 rounded-2xl border bg-white dark:bg-slate-900/80 backdrop-blur-sm transition-all duration-150 active:scale-95 shadow-sm hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-950 ${
        styles.border
      } ${styles.hoverBg} ${
        isPrimaryAction
          ? "ring-2 ring-blue-600/30 dark:ring-blue-500/30 bg-blue-50/30 dark:bg-blue-950/20"
          : ""
      }`}
    >
      {/* Badge Notification */}
      {badge !== undefined && badge !== null && (
        <span
          className={`absolute -top-1.5 -right-1.5 flex min-w-5 h-5 px-1.5 items-center justify-center rounded-full text-[10px] font-bold font-mono-data shadow-sm ${badgeBg}`}
        >
          {badge}
        </span>
      )}

      {/* Icon Tile */}
      <div
        className={`flex size-12 sm:size-13 items-center justify-center rounded-xl transition-transform group-hover:scale-105 duration-200 ${styles.iconBg}`}
      >
        <Icon name={icon} className="size-6 stroke-[2.2]" />
      </div>

      {/* Title */}
      <span className="mt-2 text-xs sm:text-sm font-bold text-slate-900 dark:text-slate-100 tracking-tight line-clamp-2 min-h-[2.25rem] flex items-center justify-center">
        {title}
      </span>
    </Link>
  );
}
