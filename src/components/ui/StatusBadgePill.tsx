import { Icon, type IconName } from "@/components/ui/Icon";

export type AttendanceStatusType =
  | "Hadir"
  | "Terlambat"
  | "Izin"
  | "Sakit"
  | "Alfa"
  | "Pending";

interface StatusBadgePillProps {
  status: AttendanceStatusType | string;
  className?: string;
  showIcon?: boolean;
}

const STATUS_CONFIG: Record<
  AttendanceStatusType,
  {
    bg: string;
    text: string;
    border: string;
    icon: IconName;
    label: string;
  }
> = {
  Hadir: {
    bg: "bg-emerald-500/15 dark:bg-emerald-500/20",
    text: "text-emerald-700 dark:text-emerald-300",
    border: "border-emerald-600/30 dark:border-emerald-500/40",
    icon: "check",
    label: "Hadir",
  },
  Terlambat: {
    bg: "bg-amber-500/15 dark:bg-amber-500/20",
    text: "text-amber-800 dark:text-amber-300",
    border: "border-amber-600/30 dark:border-amber-500/40",
    icon: "clock",
    label: "Terlambat",
  },
  Izin: {
    bg: "bg-blue-500/15 dark:bg-blue-500/20",
    text: "text-blue-700 dark:text-blue-300",
    border: "border-blue-600/30 dark:border-blue-500/40",
    icon: "document",
    label: "Izin",
  },
  Sakit: {
    bg: "bg-purple-500/15 dark:bg-purple-500/20",
    text: "text-purple-700 dark:text-purple-300",
    border: "border-purple-600/30 dark:border-purple-500/40",
    icon: "alert",
    label: "Sakit",
  },
  Alfa: {
    bg: "bg-rose-500/15 dark:bg-rose-500/20",
    text: "text-rose-700 dark:text-rose-300",
    border: "border-rose-600/30 dark:border-rose-500/40",
    icon: "x",
    label: "Alfa",
  },
  Pending: {
    bg: "bg-slate-500/15 dark:bg-slate-500/20",
    text: "text-slate-700 dark:text-slate-300",
    border: "border-slate-500/30 dark:border-slate-500/40",
    icon: "sync",
    label: "Menunggu",
  },
};

export function StatusBadgePill({
  status,
  className = "",
  showIcon = true,
}: StatusBadgePillProps) {
  const normalized = (status.charAt(0).toUpperCase() +
    status.slice(1).toLowerCase()) as AttendanceStatusType;
  const config = STATUS_CONFIG[normalized] || STATUS_CONFIG.Pending;

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-bold border tracking-wide font-mono-data ${config.bg} ${config.text} ${config.border} ${className}`}
    >
      {showIcon && (
        <Icon name={config.icon} className="size-3.5 stroke-[2.5]" />
      )}
      <span>{config.label}</span>
    </span>
  );
}
