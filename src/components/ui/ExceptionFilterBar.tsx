"use client";

import { Icon } from "@/components/ui/Icon";

export type FilterStatusKey = "all" | "hadir" | "terlambat" | "belum_absen";

interface FilterOption {
  key: FilterStatusKey;
  label: string;
  count?: number;
  icon?: "check" | "clock" | "alert" | "users";
  colorClass?: string;
}

interface ExceptionFilterBarProps {
  activeFilter: FilterStatusKey;
  onFilterChange: (filter: FilterStatusKey) => void;
  counts?: {
    all?: number;
    hadir?: number;
    terlambat?: number;
    belum_absen?: number;
  };
  className?: string;
}

export function ExceptionFilterBar({
  activeFilter,
  onFilterChange,
  counts,
  className = "",
}: ExceptionFilterBarProps) {
  const options: FilterOption[] = [
    {
      key: "all",
      label: "Semua",
      count: counts?.all,
      icon: "users",
    },
    {
      key: "hadir",
      label: "Hadir",
      count: counts?.hadir,
      icon: "check",
      colorClass: "text-emerald-700 dark:text-emerald-400",
    },
    {
      key: "terlambat",
      label: "Terlambat",
      count: counts?.terlambat,
      icon: "clock",
      colorClass: "text-amber-700 dark:text-amber-400",
    },
    {
      key: "belum_absen",
      label: "Belum Absen",
      count: counts?.belum_absen,
      icon: "alert",
      colorClass: "text-rose-700 dark:text-rose-400",
    },
  ];

  return (
    <fieldset
      aria-label="Filter status kehadiran"
      className={`border-0 p-0 m-0 flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none ${className}`}
    >
      {options.map((opt) => {
        const isActive = activeFilter === opt.key;
        return (
          <button
            key={opt.key}
            type="button"
            onClick={() => onFilterChange(opt.key)}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold transition-all shrink-0 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 ${
              isActive
                ? "bg-[#003399] text-white shadow-sm"
                : "bg-slate-100 dark:bg-slate-800/80 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700"
            }`}
          >
            {opt.icon && (
              <Icon
                name={opt.icon}
                className={`size-3.5 ${
                  isActive ? "text-white" : opt.colorClass || "text-slate-500"
                }`}
              />
            )}
            <span>{opt.label}</span>
            {opt.count !== undefined && (
              <span
                className={`ml-0.5 px-1.5 py-0.2 rounded-full text-[10px] font-mono-data ${
                  isActive
                    ? "bg-white/20 text-white"
                    : "bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300"
                }`}
              >
                {opt.count}
              </span>
            )}
          </button>
        );
      })}
    </fieldset>
  );
}
