"use client";

import type { Dispatch, SetStateAction } from "react";
import {
  buildDefaultFrontSlots,
  computeMirroredBackLayout,
  deletePrintLayoutPreset,
  generatePresetId,
  getPaperDimensionsMm,
  loadPrintLayoutPresets,
  setActivePrintLayoutId,
  upsertPrintLayoutPreset,
} from "@/lib/client/print-layout-store";
import type {
  DuplexPositionMode,
  FlipAxis,
  IdCardPrintLayoutConfig,
  IdCardTemplateConfig,
  PrintDuplexMode,
  PrintPaperSize,
  PrintSlotAssignment,
} from "@/types/id-card";

/**
 * Panel pengaturan tata letak dan kertas cetak.
 *
 * Alasan pemisahannya sama dengan `BuilderPanel`: panel ini hanya dirender saat
 * tabnya aktif, tetapi selama berada di berkas halaman ia tetap ikut diunduh
 * oleh setiap orang yang hanya membuka daftar kartu. Nama propsnya sengaja
 * identik dengan variabel di halaman induk supaya badan JSX-nya pindah tanpa
 * disunting sama sekali.
 */
export interface LayoutPanelProps {
  template: IdCardTemplateConfig;
  activeLayout: IdCardPrintLayoutConfig;
  setActiveLayout: Dispatch<SetStateAction<IdCardPrintLayoutConfig>>;
  printLayouts: IdCardPrintLayoutConfig[];
  setPrintLayouts: Dispatch<SetStateAction<IdCardPrintLayoutConfig[]>>;
  layoutPreviewPage: "front" | "back" | "both";
  setLayoutPreviewPage: Dispatch<SetStateAction<"front" | "back" | "both">>;
  matrixEditorPage: "front" | "back";
  setMatrixEditorPage: Dispatch<SetStateAction<"front" | "back">>;
  newPresetName: string;
  setNewPresetName: Dispatch<SetStateAction<string>>;
  isSavingLayout: boolean;
  setIsSavingLayout: Dispatch<SetStateAction<boolean>>;
  setMessage: Dispatch<SetStateAction<string | null>>;
}

export function LayoutPanel({
  template,
  activeLayout,
  setActiveLayout,
  printLayouts,
  setPrintLayouts,
  layoutPreviewPage,
  setLayoutPreviewPage,
  matrixEditorPage,
  setMatrixEditorPage,
  newPresetName,
  setNewPresetName,
  isSavingLayout,
  setIsSavingLayout,
  setMessage,
}: LayoutPanelProps) {
  return (
    <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
      {/* Kolom Kiri: Dual Sheet Preview */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-bold uppercase tracking-wider text-slate-400">
              Pratinjau Lembar Cetak
            </h2>
            <p className="text-[11px] text-slate-500">
              Simulasi posisi kartu di atas kertas — depan dan belakang secara
              berdampingan.
            </p>
          </div>
          {/* Toggle preview page */}
          <div className="flex gap-1 rounded-xl border border-white/10 bg-slate-900 p-1">
            {(["both", "front", "back"] as const).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setLayoutPreviewPage(p)}
                className={`rounded-lg px-2.5 py-1 text-[11px] font-bold transition ${
                  layoutPreviewPage === p
                    ? "bg-violet-500 text-white"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                {p === "both"
                  ? "Keduanya"
                  : p === "front"
                    ? "Depan"
                    : "Belakang"}
              </button>
            ))}
          </div>
        </div>

        {/* SVG Sheet Preview */}
        <div className="rounded-2xl border border-white/10 bg-slate-900/60 p-4 overflow-auto">
          {(() => {
            const L = activeLayout;
            const pW = L.paperWidthMm;
            const pH = L.paperHeightMm;
            const isPortrait = template?.orientation === "portrait";
            const baseW = isPortrait ? 54 : 85.6;
            const baseH = isPortrait ? 85.6 : 54;
            const cardWMm = baseW + L.bleedMm * 2;
            const cardHMm = baseH + L.bleedMm * 2;
            const totalSlots = L.gridCols * L.gridRows;

            // Scale: fit preview ke max 320px lebar per halaman
            const scale = Math.min(320 / pW, 220 / pH);
            const svgW = pW * scale;
            const svgH = pH * scale;

            // Hitung posisi slot
            const frontSlots = buildDefaultFrontSlots(L.gridCols, L.gridRows)
              .slice(0, totalSlots)
              .map((s) => ({ ...s, cardIndex: s.slotIndex }));
            const backSlots = computeMirroredBackLayout(
              frontSlots,
              L.gridCols,
              L.gridRows,
              L.flipAxis,
            );

            const renderSlots = (
              slots: PrintSlotAssignment[],
              page: "front" | "back",
            ) =>
              slots.map((slot) => {
                const row = Math.floor(slot.slotIndex / L.gridCols);
                const col = slot.slotIndex % L.gridCols;
                const x =
                  (L.marginLeftMm + col * (cardWMm + L.gapColMm)) * scale;
                const y =
                  (L.marginTopMm + row * (cardHMm + L.gapRowMm)) * scale;
                const w = cardWMm * scale;
                const h = cardHMm * scale;
                const label = `K${slot.cardIndex + 1}${page === "front" ? "D" : "B"}`;
                const fillColor = page === "front" ? "#0ea5e9" : "#8b5cf6";
                return (
                  <g key={`${page}-${slot.slotIndex}`}>
                    <rect
                      x={x}
                      y={y}
                      width={w}
                      height={h}
                      fill={fillColor}
                      fillOpacity={0.18}
                      stroke={fillColor}
                      strokeWidth={1}
                      rx={2}
                    />
                    <text
                      x={x + w / 2}
                      y={y + h / 2 + 4}
                      textAnchor="middle"
                      fontSize={Math.max(8, Math.min(13, w / 5))}
                      fontWeight="bold"
                      fill={fillColor}
                    >
                      {label}
                    </text>
                    {/* Crop marks di sudut jika aktif */}
                    {L.showCropMarks && (
                      <>
                        {/* Kiri-Atas */}
                        <line
                          x1={
                            x -
                            L.cropMarkOffsetMm * scale -
                            L.cropMarkLengthMm * scale
                          }
                          y1={y - L.cropMarkOffsetMm * scale}
                          x2={x - L.cropMarkOffsetMm * scale}
                          y2={y - L.cropMarkOffsetMm * scale}
                          stroke="#64748b"
                          strokeWidth={0.5}
                        />
                        <line
                          x1={x - L.cropMarkOffsetMm * scale}
                          y1={
                            y -
                            L.cropMarkOffsetMm * scale -
                            L.cropMarkLengthMm * scale
                          }
                          x2={x - L.cropMarkOffsetMm * scale}
                          y2={y - L.cropMarkOffsetMm * scale}
                          stroke="#64748b"
                          strokeWidth={0.5}
                        />
                        {/* Kanan-Atas */}
                        <line
                          x1={x + w + L.cropMarkOffsetMm * scale}
                          y1={y - L.cropMarkOffsetMm * scale}
                          x2={
                            x +
                            w +
                            L.cropMarkOffsetMm * scale +
                            L.cropMarkLengthMm * scale
                          }
                          y2={y - L.cropMarkOffsetMm * scale}
                          stroke="#64748b"
                          strokeWidth={0.5}
                        />
                        <line
                          x1={x + w + L.cropMarkOffsetMm * scale}
                          y1={
                            y -
                            L.cropMarkOffsetMm * scale -
                            L.cropMarkLengthMm * scale
                          }
                          x2={x + w + L.cropMarkOffsetMm * scale}
                          y2={y - L.cropMarkOffsetMm * scale}
                          stroke="#64748b"
                          strokeWidth={0.5}
                        />
                        {/* Kiri-Bawah */}
                        <line
                          x1={
                            x -
                            L.cropMarkOffsetMm * scale -
                            L.cropMarkLengthMm * scale
                          }
                          y1={y + h + L.cropMarkOffsetMm * scale}
                          x2={x - L.cropMarkOffsetMm * scale}
                          y2={y + h + L.cropMarkOffsetMm * scale}
                          stroke="#64748b"
                          strokeWidth={0.5}
                        />
                        <line
                          x1={x - L.cropMarkOffsetMm * scale}
                          y1={y + h + L.cropMarkOffsetMm * scale}
                          x2={x - L.cropMarkOffsetMm * scale}
                          y2={
                            y +
                            h +
                            L.cropMarkOffsetMm * scale +
                            L.cropMarkLengthMm * scale
                          }
                          stroke="#64748b"
                          strokeWidth={0.5}
                        />
                        {/* Kanan-Bawah */}
                        <line
                          x1={x + w + L.cropMarkOffsetMm * scale}
                          y1={y + h + L.cropMarkOffsetMm * scale}
                          x2={
                            x +
                            w +
                            L.cropMarkOffsetMm * scale +
                            L.cropMarkLengthMm * scale
                          }
                          y2={y + h + L.cropMarkOffsetMm * scale}
                          stroke="#64748b"
                          strokeWidth={0.5}
                        />
                        <line
                          x1={x + w + L.cropMarkOffsetMm * scale}
                          y1={y + h + L.cropMarkOffsetMm * scale}
                          x2={x + w + L.cropMarkOffsetMm * scale}
                          y2={
                            y +
                            h +
                            L.cropMarkOffsetMm * scale +
                            L.cropMarkLengthMm * scale
                          }
                          stroke="#64748b"
                          strokeWidth={0.5}
                        />
                      </>
                    )}
                  </g>
                );
              });

            const showFront =
              layoutPreviewPage === "both" || layoutPreviewPage === "front";
            const showBack =
              layoutPreviewPage === "both" || layoutPreviewPage === "back";
            const gap = layoutPreviewPage === "both" ? 20 : 0;
            const totalW =
              (showFront ? svgW : 0) +
              (showBack ? svgW : 0) +
              (layoutPreviewPage === "both" ? gap : 0);

            return (
              <div className="flex flex-col items-center gap-2">
                <svg
                  role="img"
                  aria-label="Pratinjau lembar cetak ID Card — posisi kartu di atas kertas"
                  width={totalW}
                  height={svgH + 28}
                  style={{ maxWidth: "100%", height: "auto" }}
                >
                  {/* Kertas Depan */}
                  {showFront ? (
                    <g transform="translate(0, 0)">
                      <rect
                        x={0}
                        y={0}
                        width={svgW}
                        height={svgH}
                        fill="#1e293b"
                        stroke="#334155"
                        strokeWidth={1}
                        rx={3}
                      />
                      <text
                        x={svgW / 2}
                        y={svgH + 16}
                        textAnchor="middle"
                        fontSize={10}
                        fill="#60a5fa"
                        fontWeight="bold"
                      >
                        Hal. 1 — Sisi Depan ({pW}×{pH}mm)
                      </text>
                      {renderSlots(frontSlots, "front")}
                    </g>
                  ) : null}

                  {/* Panah alignment (hanya saat mode both + duplex) */}
                  {layoutPreviewPage === "both" && L.duplexMode === "duplex"
                    ? frontSlots.map((fSlot) => {
                        const bSlot = backSlots.find(
                          (b) => b.cardIndex === fSlot.cardIndex,
                        );
                        if (!bSlot) return null;
                        const fRow = Math.floor(fSlot.slotIndex / L.gridCols);
                        const fCol = fSlot.slotIndex % L.gridCols;
                        const bRow = Math.floor(bSlot.slotIndex / L.gridCols);
                        const bCol = bSlot.slotIndex % L.gridCols;
                        const fx =
                          (L.marginLeftMm +
                            fCol * (cardWMm + L.gapColMm) +
                            cardWMm) *
                          scale;
                        const fy =
                          (L.marginTopMm +
                            fRow * (cardHMm + L.gapRowMm) +
                            cardHMm / 2) *
                          scale;
                        const bx =
                          svgW +
                          gap +
                          (L.marginLeftMm + bCol * (cardWMm + L.gapColMm)) *
                            scale;
                        const by =
                          (L.marginTopMm +
                            bRow * (cardHMm + L.gapRowMm) +
                            cardHMm / 2) *
                          scale;
                        return (
                          <line
                            key={`arrow-${fSlot.cardIndex}`}
                            x1={fx}
                            y1={fy}
                            x2={bx}
                            y2={by}
                            stroke="#f97316"
                            strokeWidth={1}
                            strokeDasharray="4 3"
                            markerEnd="url(#arrowhead)"
                            opacity={0.7}
                          />
                        );
                      })
                    : null}

                  {/* Definisi arrowhead */}
                  <defs>
                    <marker
                      id="arrowhead"
                      markerWidth="6"
                      markerHeight="4"
                      refX="6"
                      refY="2"
                      orient="auto"
                    >
                      <polygon points="0 0, 6 2, 0 4" fill="#f97316" />
                    </marker>
                  </defs>

                  {/* Kertas Belakang */}
                  {showBack ? (
                    <g
                      transform={`translate(${showFront ? svgW + gap : 0}, 0)`}
                    >
                      <rect
                        x={0}
                        y={0}
                        width={svgW}
                        height={svgH}
                        fill="#1e293b"
                        stroke="#334155"
                        strokeWidth={1}
                        rx={3}
                      />
                      <text
                        x={svgW / 2}
                        y={svgH + 16}
                        textAnchor="middle"
                        fontSize={10}
                        fill="#a78bfa"
                        fontWeight="bold"
                      >
                        Hal. 2 — Sisi Belakang (sebelum flip)
                      </text>
                      {renderSlots(backSlots, "back")}
                    </g>
                  ) : null}
                </svg>

                {/* Legenda */}
                <div className="flex items-center gap-4 text-[10px] text-slate-400 mt-1">
                  <span className="flex items-center gap-1.5">
                    <span className="inline-block w-3 h-3 rounded bg-sky-500/40 border border-sky-400" />
                    Sisi Depan (K=Karyawan, D=Depan)
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="inline-block w-3 h-3 rounded bg-violet-500/40 border border-violet-400" />
                    Sisi Belakang (B=Belakang)
                  </span>
                  {L.duplexMode === "duplex" ? (
                    <span className="flex items-center gap-1.5">
                      <span className="inline-block w-5 border-t-2 border-dashed border-orange-400" />
                      Pasangan duplex
                    </span>
                  ) : null}
                </div>
              </div>
            );
          })()}
        </div>

        {/* Info Overflow Warning */}
        {(() => {
          const L = activeLayout;
          const isPortrait = template?.orientation === "portrait";
          const baseW = isPortrait ? 54 : 85.6;
          const baseH = isPortrait ? 85.6 : 54;
          const cardWMm = baseW + L.bleedMm * 2;
          const cardHMm = baseH + L.bleedMm * 2;
          const usedW =
            L.marginLeftMm +
            L.marginRightMm +
            L.gridCols * cardWMm +
            (L.gridCols - 1) * L.gapColMm;
          const usedH =
            L.marginTopMm +
            L.marginBottomMm +
            L.gridRows * cardHMm +
            (L.gridRows - 1) * L.gapRowMm;
          const overflowW = usedW > L.paperWidthMm;
          const overflowH = usedH > L.paperHeightMm;
          if (!overflowW && !overflowH) return null;
          return (
            <div className="rounded-xl border border-red-400/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
              <strong>Peringatan:</strong>{" "}
              {overflowW
                ? `Lebar grid (${usedW.toFixed(1)}mm) melebihi kertas (${L.paperWidthMm}mm). `
                : ""}
              {overflowH
                ? `Tinggi grid (${usedH.toFixed(1)}mm) melebihi kertas (${L.paperHeightMm}mm).`
                : ""}{" "}
              Kurangi kolom/baris, margin, atau jarak antar kartu.
            </div>
          );
        })()}
      </div>

      {/* Kolom Kanan: Panel Konfigurasi */}
      <div className="space-y-4 overflow-y-auto max-h-[calc(100vh-200px)]">
        {/* Preset Selector */}
        <div className="rounded-2xl border border-white/10 bg-slate-900/80 p-4 space-y-3">
          <div className="text-xs font-bold uppercase tracking-wider text-slate-400">
            Preset Layout
          </div>
          <select
            aria-label="Preset layout"
            id="layout-preset-select"
            value={activeLayout.presetId}
            onChange={(e) => {
              const found = printLayouts.find(
                (p) => p.presetId === e.target.value,
              );
              if (found) {
                setActiveLayout(found);
                setActivePrintLayoutId(found.presetId);
              }
            }}
            className="min-h-10 w-full rounded-xl border border-white/10 bg-slate-950 px-3 text-xs text-white"
          >
            {printLayouts.map((p) => (
              <option key={p.presetId} value={p.presetId}>
                {p.presetName}
                {p.isBuiltIn ? " (bawaan)" : ""}
              </option>
            ))}
          </select>
          <div className="flex gap-2">
            <input
              aria-label="Nama preset baru"
              type="text"
              value={newPresetName}
              onChange={(e) => setNewPresetName(e.target.value)}
              placeholder="Nama preset baru..."
              className="min-h-9 flex-1 rounded-xl border border-white/10 bg-slate-950 px-3 text-xs text-white"
            />
            <button
              type="button"
              disabled={!newPresetName.trim()}
              onClick={() => {
                const newPreset: IdCardPrintLayoutConfig = {
                  ...activeLayout,
                  presetId: generatePresetId(),
                  presetName: newPresetName.trim(),
                  isBuiltIn: false,
                };
                upsertPrintLayoutPreset(newPreset);
                const updated = loadPrintLayoutPresets();
                setPrintLayouts(updated);
                setActiveLayout(newPreset);
                setActivePrintLayoutId(newPreset.presetId);
                setNewPresetName("");
                setMessage("Preset layout berhasil disimpan ke perangkat ini.");
              }}
              className="rounded-xl bg-violet-500 px-3 py-1 text-xs font-bold text-white hover:bg-violet-400 disabled:opacity-40"
            >
              Simpan
            </button>
            {!activeLayout.isBuiltIn ? (
              <button
                type="button"
                onClick={() => {
                  deletePrintLayoutPreset(activeLayout.presetId);
                  const updated = loadPrintLayoutPresets();
                  setPrintLayouts(updated);
                  const first = updated[0];
                  if (first) {
                    setActiveLayout(first);
                    setActivePrintLayoutId(first.presetId);
                  }
                  setMessage("Preset dihapus.");
                }}
                className="rounded-xl border border-red-400/30 bg-red-500/10 px-3 py-1 text-xs font-bold text-red-300 hover:bg-red-500/20"
              >
                Hapus
              </button>
            ) : null}
          </div>
        </div>

        {/* Helper untuk update field di activeLayout */}
        {/* Ukuran Kertas */}
        <div className="rounded-2xl border border-white/10 bg-slate-900/80 p-4 space-y-3">
          <div className="text-xs font-bold uppercase tracking-wider text-slate-400">
            Ukuran Kertas
          </div>
          <div className="grid grid-cols-2 gap-2">
            {(
              [
                ["cr80", "CR80 (85.6×54mm)"],
                ["a4", "A4 (210×297mm)"],
                ["f4", "F4 Folio (215×330mm)"],
                ["letter", "Letter (216×279mm)"],
                ["a3", "A3 (297×420mm)"],
                ["custom", "Kustom (isi manual)"],
              ] as [PrintPaperSize, string][]
            ).map(([size, label]) => (
              <button
                key={size}
                type="button"
                onClick={() => {
                  const { widthMm, heightMm } = getPaperDimensionsMm(
                    size,
                    activeLayout.paperWidthMm,
                    activeLayout.paperHeightMm,
                  );
                  setActiveLayout((prev) => ({
                    ...prev,
                    paperSize: size,
                    paperWidthMm: widthMm,
                    paperHeightMm: heightMm,
                  }));
                }}
                className={`rounded-xl border p-2 text-left text-[11px] font-bold transition ${
                  activeLayout.paperSize === size
                    ? "border-violet-400 bg-violet-400/10 text-white"
                    : "border-white/10 bg-slate-950 text-slate-400 hover:bg-slate-900"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          {activeLayout.paperSize === "custom" ? (
            <div className="grid grid-cols-2 gap-2">
              <label className="block space-y-1 text-[11px] font-bold text-slate-400">
                Lebar (mm)
                <input
                  type="number"
                  min={50}
                  max={500}
                  step={0.1}
                  value={activeLayout.paperWidthMm}
                  onChange={(e) =>
                    setActiveLayout((prev) => ({
                      ...prev,
                      paperWidthMm: Number(e.target.value),
                    }))
                  }
                  className="min-h-9 w-full rounded-xl border border-white/10 bg-slate-950 px-2 text-xs text-white"
                />
              </label>
              <label className="block space-y-1 text-[11px] font-bold text-slate-400">
                Tinggi (mm)
                <input
                  type="number"
                  min={50}
                  max={700}
                  step={0.1}
                  value={activeLayout.paperHeightMm}
                  onChange={(e) =>
                    setActiveLayout((prev) => ({
                      ...prev,
                      paperHeightMm: Number(e.target.value),
                    }))
                  }
                  className="min-h-9 w-full rounded-xl border border-white/10 bg-slate-950 px-2 text-xs text-white"
                />
              </label>
            </div>
          ) : null}
        </div>

        {/* Grid */}
        <div className="rounded-2xl border border-white/10 bg-slate-900/80 p-4 space-y-3">
          <div className="text-xs font-bold uppercase tracking-wider text-slate-400">
            Grid Kartu
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="block space-y-1 text-[11px] font-bold text-slate-400">
              Kolom (1–4)
              <input
                type="number"
                min={1}
                max={4}
                value={activeLayout.gridCols}
                onChange={(e) =>
                  setActiveLayout((prev) => ({
                    ...prev,
                    gridCols: Math.max(1, Math.min(4, Number(e.target.value))),
                  }))
                }
                className="min-h-9 w-full rounded-xl border border-white/10 bg-slate-950 px-2 text-xs text-white"
              />
            </label>
            <label className="block space-y-1 text-[11px] font-bold text-slate-400">
              Baris (1–6)
              <input
                type="number"
                min={1}
                max={6}
                value={activeLayout.gridRows}
                onChange={(e) =>
                  setActiveLayout((prev) => ({
                    ...prev,
                    gridRows: Math.max(1, Math.min(6, Number(e.target.value))),
                  }))
                }
                className="min-h-9 w-full rounded-xl border border-white/10 bg-slate-950 px-2 text-xs text-white"
              />
            </label>
          </div>
          <div className="text-[10px] text-slate-500">
            {activeLayout.gridCols * activeLayout.gridRows} slot kartu per
            halaman
          </div>
        </div>

        {/* Margin & Jarak */}
        <div className="rounded-2xl border border-white/10 bg-slate-900/80 p-4 space-y-3">
          <div className="text-xs font-bold uppercase tracking-wider text-slate-400">
            Margin Tepi & Jarak Antar Kartu (mm)
          </div>
          <div className="grid grid-cols-2 gap-2">
            {(
              [
                ["marginTopMm", "Margin Atas"],
                ["marginBottomMm", "Margin Bawah"],
                ["marginLeftMm", "Margin Kiri"],
                ["marginRightMm", "Margin Kanan"],
                ["gapColMm", "Jarak Horizontal"],
                ["gapRowMm", "Jarak Vertikal"],
              ] as [keyof IdCardPrintLayoutConfig, string][]
            ).map(([field, label]) => (
              <label
                key={field}
                className="block space-y-1 text-[11px] font-bold text-slate-400"
              >
                {label}
                <input
                  type="number"
                  min={0}
                  max={50}
                  step={0.5}
                  value={activeLayout[field] as number}
                  onChange={(e) =>
                    setActiveLayout((prev) => ({
                      ...prev,
                      [field]: Math.max(0, Number(e.target.value)),
                    }))
                  }
                  className="min-h-9 w-full rounded-xl border border-white/10 bg-slate-950 px-2 text-xs text-white"
                />
              </label>
            ))}
          </div>
        </div>

        {/* Tanda Potong & Finishing */}
        <div className="rounded-2xl border border-white/10 bg-slate-900/80 p-4 space-y-3">
          <div className="text-xs font-bold uppercase tracking-wider text-slate-400">
            Tanda Potong & Finishing
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-300">
              Tampilkan Garis Potong (Crop Marks)
            </span>
            <button
              type="button"
              onClick={() =>
                setActiveLayout((prev) => ({
                  ...prev,
                  showCropMarks: !prev.showCropMarks,
                }))
              }
              className={`h-6 w-11 rounded-full transition-colors ${
                activeLayout.showCropMarks ? "bg-violet-500" : "bg-slate-700"
              }`}
            >
              <span
                className={`block h-4 w-4 rounded-full bg-white shadow transition-transform mx-1 ${
                  activeLayout.showCropMarks ? "translate-x-5" : "translate-x-0"
                }`}
              />
            </button>
          </div>
          {activeLayout.showCropMarks ? (
            <div className="grid grid-cols-2 gap-2">
              <label className="block space-y-1 text-[11px] font-bold text-slate-400">
                Panjang Garis (mm)
                <input
                  type="number"
                  min={1}
                  max={10}
                  step={0.5}
                  value={activeLayout.cropMarkLengthMm}
                  onChange={(e) =>
                    setActiveLayout((prev) => ({
                      ...prev,
                      cropMarkLengthMm: Number(e.target.value),
                    }))
                  }
                  className="min-h-9 w-full rounded-xl border border-white/10 bg-slate-950 px-2 text-xs text-white"
                />
              </label>
              <label className="block space-y-1 text-[11px] font-bold text-slate-400">
                Offset dari Kartu (mm)
                <input
                  type="number"
                  min={0}
                  max={5}
                  step={0.5}
                  value={activeLayout.cropMarkOffsetMm}
                  onChange={(e) =>
                    setActiveLayout((prev) => ({
                      ...prev,
                      cropMarkOffsetMm: Number(e.target.value),
                    }))
                  }
                  className="min-h-9 w-full rounded-xl border border-white/10 bg-slate-950 px-2 text-xs text-white"
                />
              </label>
            </div>
          ) : null}
          <div className="grid grid-cols-2 gap-2">
            <label className="block space-y-1 text-[11px] font-bold text-slate-400">
              Bleed (mm, 0–3)
              <input
                type="number"
                min={0}
                max={3}
                step={0.5}
                value={activeLayout.bleedMm}
                onChange={(e) =>
                  setActiveLayout((prev) => ({
                    ...prev,
                    bleedMm: Math.max(0, Math.min(3, Number(e.target.value))),
                  }))
                }
                className="min-h-9 w-full rounded-xl border border-white/10 bg-slate-950 px-2 text-xs text-white"
              />
            </label>
            <div className="flex items-center gap-2 pt-5">
              <button
                type="button"
                onClick={() =>
                  setActiveLayout((prev) => ({
                    ...prev,
                    showCardBorder: !prev.showCardBorder,
                  }))
                }
                className={`h-5 w-9 rounded-full transition-colors ${
                  activeLayout.showCardBorder ? "bg-violet-500" : "bg-slate-700"
                }`}
              >
                <span
                  className={`block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform mx-0.5 ${
                    activeLayout.showCardBorder
                      ? "translate-x-4"
                      : "translate-x-0"
                  }`}
                />
              </button>
              <span className="text-[11px] text-slate-400">
                Garis Tepi Kartu
              </span>
            </div>
          </div>
        </div>

        {/* Duplex & Position Matrix */}
        <div className="rounded-2xl border border-white/10 bg-slate-900/80 p-4 space-y-3">
          <div className="text-xs font-bold uppercase tracking-wider text-slate-400">
            Sisi Cetak & Duplex Alignment
          </div>

          {/* Sisi yang dicetak */}
          <div className="grid grid-cols-2 gap-2">
            {(
              [
                ["front_only", "Depan Saja"],
                ["back_only", "Belakang Saja"],
                ["duplex", "Bolak-Balik (Duplex)"],
                ["side_by_side", "Berdampingan (Lipat)"],
              ] as [PrintDuplexMode, string][]
            ).map(([mode, label]) => (
              <button
                key={mode}
                type="button"
                onClick={() =>
                  setActiveLayout((prev) => ({ ...prev, duplexMode: mode }))
                }
                className={`rounded-xl border p-2 text-[11px] font-bold transition ${
                  activeLayout.duplexMode === mode
                    ? "border-violet-400 bg-violet-400/10 text-white"
                    : "border-white/10 bg-slate-950 text-slate-400 hover:bg-slate-900"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Flip Axis (hanya saat duplex) */}
          {activeLayout.duplexMode === "duplex" ? (
            <div className="space-y-2">
              <div className="text-[11px] font-bold text-slate-400">
                Arah Balik Kertas Printer
              </div>
              <div className="grid grid-cols-2 gap-2">
                {(
                  [
                    ["long_edge", "Balik Kiri-Kanan (Long Edge)"],
                    ["short_edge", "Balik Atas-Bawah (Short Edge)"],
                  ] as [FlipAxis, string][]
                ).map(([axis, label]) => (
                  <button
                    key={axis}
                    type="button"
                    onClick={() =>
                      setActiveLayout((prev) => ({
                        ...prev,
                        flipAxis: axis,
                      }))
                    }
                    className={`rounded-xl border p-2 text-[11px] font-bold transition ${
                      activeLayout.flipAxis === axis
                        ? "border-orange-400 bg-orange-400/10 text-orange-200"
                        : "border-white/10 bg-slate-950 text-slate-400 hover:bg-slate-900"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {/* Duplex Position Mode */}
              <div className="text-[11px] font-bold text-slate-400 pt-1">
                Mode Penempatan Slot
              </div>
              <div className="grid grid-cols-2 gap-2">
                {(
                  [
                    ["auto_mirror", "Auto Mirror (Otomatis)"],
                    ["manual_matrix", "Manual Matrix (Kustom)"],
                  ] as [DuplexPositionMode, string][]
                ).map(([m, label]) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() =>
                      setActiveLayout((prev) => ({
                        ...prev,
                        duplexPositionMode: m,
                      }))
                    }
                    className={`rounded-xl border p-2 text-[11px] font-bold transition ${
                      activeLayout.duplexPositionMode === m
                        ? "border-violet-400 bg-violet-400/10 text-white"
                        : "border-white/10 bg-slate-950 text-slate-400 hover:bg-slate-900"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {/* Position Matrix Editor */}
              {activeLayout.duplexPositionMode === "manual_matrix" ? (
                <div className="space-y-3 rounded-xl border border-violet-400/20 bg-violet-950/20 p-3">
                  <div className="flex items-center justify-between">
                    <div className="text-[11px] font-bold text-violet-300">
                      Position Matrix Editor
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          // Reset ke auto mirror
                          const front = buildDefaultFrontSlots(
                            activeLayout.gridCols,
                            activeLayout.gridRows,
                          ).map((s) => ({ ...s, cardIndex: s.slotIndex }));
                          const back = computeMirroredBackLayout(
                            front,
                            activeLayout.gridCols,
                            activeLayout.gridRows,
                            activeLayout.flipAxis,
                          );
                          setActiveLayout((prev) => ({
                            ...prev,
                            frontPageSlots: front,
                            backPageSlots: back,
                          }));
                        }}
                        className="rounded-lg bg-violet-500/20 px-2 py-1 text-[10px] font-bold text-violet-300 hover:bg-violet-500/30"
                      >
                        Hitung Mirror Otomatis
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setActiveLayout((prev) => ({
                            ...prev,
                            frontPageSlots: undefined,
                            backPageSlots: undefined,
                          }));
                        }}
                        className="rounded-lg border border-white/10 px-2 py-1 text-[10px] font-bold text-slate-400 hover:text-white"
                      >
                        Reset
                      </button>
                    </div>
                  </div>

                  {/* Toggle halaman mana yang diedit */}
                  <div className="flex gap-1 rounded-lg border border-white/10 bg-slate-900 p-1 w-fit">
                    {(["front", "back"] as const).map((p) => (
                      <button
                        key={p}
                        type="button"
                        onClick={() => setMatrixEditorPage(p)}
                        className={`rounded-md px-2.5 py-1 text-[10px] font-bold transition ${
                          matrixEditorPage === p
                            ? p === "front"
                              ? "bg-sky-500 text-white"
                              : "bg-violet-500 text-white"
                            : "text-slate-400 hover:text-white"
                        }`}
                      >
                        {p === "front" ? "Halaman Depan" : "Halaman Belakang"}
                      </button>
                    ))}
                  </div>

                  {/* Grid matrix slot */}
                  <div
                    className="grid gap-1"
                    style={{
                      gridTemplateColumns: `repeat(${activeLayout.gridCols}, minmax(0, 1fr))`,
                    }}
                  >
                    {Array.from(
                      {
                        length: activeLayout.gridCols * activeLayout.gridRows,
                      },
                      (_, i) => i,
                    ).map((slotNum) => {
                      const slotsKey =
                        matrixEditorPage === "front"
                          ? "frontPageSlots"
                          : "backPageSlots";
                      const currentSlots =
                        activeLayout[slotsKey] ??
                        (matrixEditorPage === "front"
                          ? buildDefaultFrontSlots(
                              activeLayout.gridCols,
                              activeLayout.gridRows,
                            ).map((s) => ({
                              ...s,
                              cardIndex: s.slotIndex,
                            }))
                          : computeMirroredBackLayout(
                              buildDefaultFrontSlots(
                                activeLayout.gridCols,
                                activeLayout.gridRows,
                              ).map((s) => ({
                                ...s,
                                cardIndex: s.slotIndex,
                              })),
                              activeLayout.gridCols,
                              activeLayout.gridRows,
                              activeLayout.flipAxis,
                            ));

                      const slot = currentSlots.find(
                        (s) => s.slotIndex === slotNum,
                      );

                      const cardOptions = Array.from(
                        {
                          length: activeLayout.gridCols * activeLayout.gridRows,
                        },
                        (_, i) => i,
                      );

                      return (
                        <div
                          key={`matrix-slot-${matrixEditorPage}-${slotNum}`}
                          className="rounded-lg border border-white/10 bg-slate-950 p-1.5 text-center"
                        >
                          <div className="text-[9px] text-slate-500 mb-1">
                            Slot {slotNum + 1}
                          </div>
                          <select
                            aria-label="Slot penempatan kartu"
                            value={
                              slot
                                ? `${slot.cardIndex}|${slot.side}`
                                : "-1|front"
                            }
                            onChange={(e) => {
                              const [ci, sd] = e.target.value.split("|");
                              const updatedSlots = currentSlots.map((s) =>
                                s.slotIndex === slotNum
                                  ? {
                                      ...s,
                                      cardIndex: Number(ci),
                                      side: sd as "front" | "back",
                                    }
                                  : s,
                              );
                              const existing = updatedSlots.find(
                                (s) => s.slotIndex === slotNum,
                              );
                              const finalSlots = existing
                                ? updatedSlots
                                : [
                                    ...updatedSlots,
                                    {
                                      slotIndex: slotNum,
                                      cardIndex: Number(ci),
                                      side: sd as "front" | "back",
                                    },
                                  ];
                              setActiveLayout((prev) => ({
                                ...prev,
                                [slotsKey]: finalSlots,
                              }));
                            }}
                            className="w-full rounded bg-slate-900 text-[9px] text-white border border-white/10 px-1 py-0.5"
                          >
                            <option value="-1|front">Kosong</option>
                            {cardOptions.map((cardNum) => (
                              <option
                                key={`s${slotNum}-k${cardNum}-front`}
                                value={`${cardNum}|front`}
                              >
                                K{cardNum + 1} Depan
                              </option>
                            ))}
                            {cardOptions.map((cardNum) => (
                              <option
                                key={`s${slotNum}-k${cardNum}-back`}
                                value={`${cardNum}|back`}
                              >
                                K{cardNum + 1} Belakang
                              </option>
                            ))}
                          </select>
                        </div>
                      );
                    })}
                  </div>

                  <div className="text-[10px] text-slate-500">
                    Atur sendiri kartu mana di slot mana. Gunakan "Hitung Mirror
                    Otomatis" sebagai titik awal, lalu sesuaikan.
                  </div>
                </div>
              ) : (
                <div className="rounded-xl border border-sky-400/20 bg-sky-950/20 p-3 text-[11px] text-sky-300">
                  Mode <strong>Auto Mirror</strong>: sistem akan menghitung
                  posisi halaman belakang secara otomatis berdasarkan arah balik
                  kertas yang dipilih di atas. Garis oranye putus-putus di
                  preview menunjukkan pasangan alignment setiap kartu.
                </div>
              )}
            </div>
          ) : null}
        </div>

        {/* Kalibrasi Printer */}
        <div className="rounded-2xl border border-white/10 bg-slate-900/80 p-4 space-y-3">
          <div className="text-xs font-bold uppercase tracking-wider text-slate-400">
            Kalibrasi Offset Printer (mm)
          </div>
          <p className="text-[10px] text-slate-500">
            Geser seluruh tata letak kartu untuk kompensasi perbedaan mekanik
            printer. Positif = ke kanan/bawah, negatif = ke kiri/atas. Rentang:
            -5 s.d. +5 mm.
          </p>
          <div className="grid grid-cols-2 gap-2">
            <label className="block space-y-1 text-[11px] font-bold text-slate-400">
              Offset Horizontal (X)
              <input
                type="number"
                min={-5}
                max={5}
                step={0.1}
                value={activeLayout.printerOffsetXMm}
                onChange={(e) =>
                  setActiveLayout((prev) => ({
                    ...prev,
                    printerOffsetXMm: Math.max(
                      -5,
                      Math.min(5, Number(e.target.value)),
                    ),
                  }))
                }
                className="min-h-9 w-full rounded-xl border border-white/10 bg-slate-950 px-2 text-xs text-white"
              />
            </label>
            <label className="block space-y-1 text-[11px] font-bold text-slate-400">
              Offset Vertikal (Y)
              <input
                type="number"
                min={-5}
                max={5}
                step={0.1}
                value={activeLayout.printerOffsetYMm}
                onChange={(e) =>
                  setActiveLayout((prev) => ({
                    ...prev,
                    printerOffsetYMm: Math.max(
                      -5,
                      Math.min(5, Number(e.target.value)),
                    ),
                  }))
                }
                className="min-h-9 w-full rounded-xl border border-white/10 bg-slate-950 px-2 text-xs text-white"
              />
            </label>
          </div>
        </div>

        {/* Tombol Simpan */}
        <button
          id="save-layout-preset-btn"
          type="button"
          disabled={isSavingLayout}
          onClick={() => {
            setIsSavingLayout(true);
            try {
              upsertPrintLayoutPreset(activeLayout);
              setActivePrintLayoutId(activeLayout.presetId);
              const updated = loadPrintLayoutPresets();
              setPrintLayouts(updated);
              setMessage(
                `Layout "${activeLayout.presetName}" berhasil disimpan ke perangkat ini.`,
              );
            } finally {
              setIsSavingLayout(false);
            }
          }}
          className="w-full rounded-2xl bg-violet-500 py-3 text-sm font-black text-white hover:bg-violet-400 disabled:opacity-50 transition shadow-md shadow-violet-950/30"
        >
          {isSavingLayout
            ? "Menyimpan..."
            : "Terapkan & Simpan Preset ke Perangkat Ini"}
        </button>
      </div>
    </div>
  );
}
