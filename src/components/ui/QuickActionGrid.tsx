"use client";

import {
  QuickActionTile,
  type QuickActionTileProps,
} from "@/components/ui/QuickActionTile";
import { type AppArea, canAccessArea } from "@/lib/auth/access";
import { useAuth } from "@/lib/context/AuthContext";

export interface QuickActionItem extends QuickActionTileProps {
  area?: AppArea;
}

interface QuickActionGridProps {
  tiles?: QuickActionItem[];
  className?: string;
}

const DEFAULT_TILES: QuickActionItem[] = [
  {
    href: "/id-cards",
    icon: "user",
    title: "Cetak ID Card",
    tone: "purple",
    area: "idcards",
  },
  {
    href: "/jurnal-mengajar",
    icon: "document",
    title: "Jurnal Mengajar",
    tone: "primary",
    area: "jurnal_mengajar",
  },
  {
    href: "/leger-kehadiran",
    icon: "calendar",
    title: "Leger Kehadiran",
    tone: "emerald",
    area: "leger_kehadiran",
  },
  {
    href: "/audit-absensi",
    icon: "alert",
    title: "Live Audit Presensi",
    tone: "amber",
    area: "audit",
  },
  {
    href: "/notifikasi-wa",
    icon: "whatsapp",
    title: "Notifikasi WhatsApp",
    tone: "emerald",
    area: "notifikasi_wa",
  },
  {
    href: "/payroll",
    icon: "document",
    title: "Penggajian & Slip Gaji",
    tone: "emerald",
    area: "payroll",
  },
  {
    href: "/presensi-kelas",
    icon: "clock",
    title: "Presensi Mapel & Anomali",
    tone: "primary",
    area: "presensi_kelas",
  },
  {
    href: "/history",
    icon: "clock",
    title: "Riwayat Presensi",
    tone: "neutral",
    area: "history",
  },
];

export function QuickActionGrid({
  tiles = DEFAULT_TILES,
  className = "",
}: QuickActionGridProps) {
  const { user } = useAuth();
  const visibleTiles = tiles.filter(
    (tile) => !tile.area || canAccessArea(user, tile.area),
  );

  return (
    <section aria-label="Aksi Cepat Operasional" className={className}>
      <div className="grid grid-cols-4 gap-2.5 sm:gap-3.5">
        {visibleTiles.map((tile) => (
          <QuickActionTile key={tile.href} {...tile} />
        ))}
      </div>
    </section>
  );
}
