"use client";

import type { ChangeEvent, Dispatch, RefObject, SetStateAction } from "react";
import { Icon } from "@/components/ui/Icon";
import type {
  CardSide,
  IdCardElement,
  IdCardTemplateConfig,
} from "@/types/id-card";

/**
 * Panel perancang template kartu identitas.
 *
 * Dipisahkan dari halaman ID Card BUKAN demi keterbacaan semata: panel ini
 * hanya dirender ketika tabnya aktif, tetapi selama ia berada di berkas yang
 * sama ia tetap ikut diunduh oleh setiap orang yang hanya ingin melihat daftar
 * kartu. Halaman induknya memuatnya lewat `dynamic()`, pola yang sudah dipakai
 * repo ini untuk adegan 3D di `components/visual/*Gate.tsx`.
 *
 * Nama propsnya sengaja identik dengan nama variabel di halaman induk. Itu
 * membuat badan JSX-nya berpindah tanpa satu pun suntingan — dan sebuah
 * pemindahan 950 baris yang juga menyunting isinya tidak bisa dibuktikan setara
 * dengan aslinya oleh siapa pun.
 */
export interface BuilderPanelProps {
  template: IdCardTemplateConfig;
  setTemplate: Dispatch<SetStateAction<IdCardTemplateConfig>>;
  builderSide: CardSide;
  setBuilderSide: Dispatch<SetStateAction<CardSide>>;
  selectedElementId: string | null;
  setSelectedElementId: Dispatch<SetStateAction<string | null>>;
  selectedElement: IdCardElement | null;
  showBoundingBoxes: boolean;
  setShowBoundingBoxes: Dispatch<SetStateAction<boolean>>;
  builderBusy: boolean;
  builderCanvasRef: RefObject<HTMLCanvasElement | null>;
  setAddElementModalOpen: Dispatch<SetStateAction<boolean>>;
  handleSwitchTemplate: (newId: string) => Promise<void>;
  handleSaveTemplate: () => Promise<void>;
  handleCustomBgUpload: (
    event: ChangeEvent<HTMLInputElement>,
    side: CardSide,
  ) => Promise<void>;
  handleCanvasMouseDown: (e: React.MouseEvent<HTMLCanvasElement>) => void;
  handleCanvasMouseMove: (e: React.MouseEvent<HTMLCanvasElement>) => void;
  handleCanvasMouseUp: () => void;
  handleCanvasTouchStart: (e: React.TouchEvent<HTMLCanvasElement>) => void;
  handleCanvasTouchMove: (e: React.TouchEvent<HTMLCanvasElement>) => void;
  handleUpdateSelectedElement: (updates: Partial<IdCardElement>) => void;
  handleToggleElementVisible: (elementId: string) => void;
  handleSwitchElementSide: (elementId: string, targetSide: CardSide) => void;
  handleDeleteElement: (elementId: string) => void;
  handleResetToDefault: () => void;
}

export function BuilderPanel({
  template,
  setTemplate,
  builderSide,
  setBuilderSide,
  selectedElementId,
  setSelectedElementId,
  selectedElement,
  showBoundingBoxes,
  setShowBoundingBoxes,
  builderBusy,
  builderCanvasRef,
  setAddElementModalOpen,
  handleSwitchTemplate,
  handleSaveTemplate,
  handleCustomBgUpload,
  handleCanvasMouseDown,
  handleCanvasMouseMove,
  handleCanvasMouseUp,
  handleCanvasTouchStart,
  handleCanvasTouchMove,
  handleUpdateSelectedElement,
  handleToggleElementVisible,
  handleSwitchElementSide,
  handleDeleteElement,
  handleResetToDefault,
}: BuilderPanelProps) {
  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-2xl border border-white/10 bg-slate-900/80">
        <div>
          <h3 className="text-xs font-bold text-white uppercase tracking-wider">
            Pilihan Template Identitas
          </h3>
          <p className="text-[11px] text-slate-400">
            Pilih template yang ingin disunting konfigurasinya (Pegawai, Guru,
            atau Siswa).
          </p>
        </div>
        <select
          aria-label="Template kartu aktif"
          value={template.id}
          onChange={(e) => void handleSwitchTemplate(e.target.value)}
          disabled={builderBusy}
          className="rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-xs font-bold text-white outline-none focus:border-sky-400"
        >
          <option value="default_template">
            Template Pegawai / Umum (default_template)
          </option>
          <option value="template_guru">
            Template Guru / PTK (template_guru)
          </option>
          <option value="template_siswa">
            Template Siswa / Pelajar (template_siswa)
          </option>
        </select>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        {/* Left: Live Preview Canvas */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-bold uppercase tracking-wider text-slate-400">
                Live Realtime Canvas Preview
              </h2>
              <p className="text-[11px] text-slate-500">
                Perubahan posisi, teks, dan ukuran langsung terlihat tanpa jeda.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setShowBoundingBoxes(!showBoundingBoxes)}
                className={`rounded-lg px-2.5 py-1.5 text-xs font-bold transition flex items-center gap-1.5 border ${
                  showBoundingBoxes
                    ? "border-sky-400 bg-sky-500/15 text-sky-300"
                    : "border-white/10 bg-slate-800 text-slate-400 hover:text-white"
                }`}
                title="Tampilkan / Sembunyikan garis pembatas kotak elemen di preview"
              >
                <Icon name="palette" className="size-3.5" />
                <span>
                  {showBoundingBoxes ? "Garis Box: ON" : "Garis Box: OFF"}
                </span>
              </button>
              <button
                type="button"
                onClick={() => setBuilderSide("front")}
                className={`rounded-lg px-3 py-1.5 text-xs font-bold transition ${
                  builderSide === "front"
                    ? "bg-sky-400 text-slate-950"
                    : "bg-slate-800 text-slate-300 hover:bg-slate-700"
                }`}
              >
                Sisi Depan
              </button>
              <button
                type="button"
                onClick={() => setBuilderSide("back")}
                className={`rounded-lg px-3 py-1.5 text-xs font-bold transition ${
                  builderSide === "back"
                    ? "bg-sky-400 text-slate-950"
                    : "bg-slate-800 text-slate-300 hover:bg-slate-700"
                }`}
              >
                Sisi Belakang
              </button>
            </div>
          </div>

          <div className="grid min-h-[380px] place-items-center rounded-3xl border border-white/10 bg-slate-950/80 p-6 shadow-inner">
            <div
              className={`relative rounded-2xl overflow-hidden shadow-2xl shadow-black/80 border border-white/20 transition-all ${
                template.orientation === "portrait"
                  ? "w-[240px] h-[380px]"
                  : "w-[380px] h-[240px]"
              }`}
            >
              <canvas
                ref={builderCanvasRef}
                onMouseDown={handleCanvasMouseDown}
                onMouseMove={handleCanvasMouseMove}
                onMouseUp={handleCanvasMouseUp}
                onMouseLeave={handleCanvasMouseUp}
                onTouchStart={handleCanvasTouchStart}
                onTouchMove={handleCanvasTouchMove}
                onTouchEnd={handleCanvasMouseUp}
                className="size-full object-contain bg-slate-900 select-none cursor-pointer"
                title="Klik & geser langsung elemen mana saja pada kartu untuk memindahkannya"
              />
            </div>
            <div className="mt-2 text-center text-[11px] text-slate-400">
              💡{" "}
              <span className="font-semibold text-slate-300">
                Fitur Interaktif:
              </span>{" "}
              Klik dan geser (*drag & drop*) langsung teks, foto, logo, atau QR
              code di atas kartu untuk memindahkannya secara realtime.
            </div>
          </div>

          {/* Template Orientasi & Dimensi */}
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() =>
                setTemplate({ ...template, orientation: "landscape" })
              }
              className={`rounded-2xl border p-3 text-xs font-bold transition text-left ${
                template.orientation === "landscape"
                  ? "border-sky-400 bg-sky-400/10 text-white"
                  : "border-white/10 bg-slate-950 text-slate-400 hover:bg-slate-800"
              }`}
            >
              <div className="font-bold">Landscape (Mendatar)</div>
              <div className="text-[10px] text-slate-500">
                Standar CR80 85.6 × 54 mm
              </div>
            </button>
            <button
              type="button"
              onClick={() =>
                setTemplate({ ...template, orientation: "portrait" })
              }
              className={`rounded-2xl border p-3 text-xs font-bold transition text-left ${
                template.orientation === "portrait"
                  ? "border-sky-400 bg-sky-400/10 text-white"
                  : "border-white/10 bg-slate-950 text-slate-400 hover:bg-slate-800"
              }`}
            >
              <div className="font-bold">Portrait (Tegak)</div>
              <div className="text-[10px] text-slate-500">
                Standar CR80 54 × 85.6 mm
              </div>
            </button>
          </div>

          {/* Background Image Upload for active side */}
          <div className="rounded-2xl border border-white/10 bg-slate-950/60 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-white">
                Background Desain (Sisi{" "}
                {builderSide === "front" ? "Depan" : "Belakang"})
              </span>
              {(
                builderSide === "front"
                  ? template.frontBgUrl
                  : template.backBgUrl
              ) ? (
                <button
                  type="button"
                  onClick={() =>
                    setTemplate({
                      ...template,
                      [builderSide === "front" ? "frontBgUrl" : "backBgUrl"]:
                        undefined,
                    })
                  }
                  className="text-[11px] text-rose-400 hover:underline"
                >
                  Hapus Custom Background
                </button>
              ) : null}
            </div>
            <label className="inline-flex min-h-9 cursor-pointer items-center justify-center gap-2 rounded-xl bg-slate-800 px-3 text-xs font-bold text-white border border-white/10 hover:bg-slate-700 w-full">
              <Icon name="upload" className="size-3.5" />
              Upload Background Desain Baru (300 DPI)
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={(e) => handleCustomBgUpload(e, builderSide)}
                className="sr-only"
              />
            </label>
            <p className="text-[11px] text-slate-500">
              Disarankan rasio 85.6:54 (1011×638 px) PNG/JPEG tanpa teks agar
              dapat diisi dinamis.
            </p>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-slate-900 p-4">
            <button
              type="button"
              onClick={handleResetToDefault}
              className="rounded-xl border border-white/10 bg-slate-800 px-3.5 py-2 text-xs font-bold text-slate-300 hover:bg-slate-700 hover:text-white transition"
            >
              Reset ke Standar SPPG
            </button>
            <button
              type="button"
              disabled={builderBusy}
              onClick={handleSaveTemplate}
              className="rounded-xl bg-emerald-400 px-5 py-2 text-xs font-black text-slate-950 shadow-md hover:bg-emerald-300 disabled:opacity-50 inline-flex items-center gap-2"
            >
              <Icon name="check" className="size-4" />
              <span>
                {builderBusy ? "Menyimpan..." : "Simpan Pengaturan Template"}
              </span>
            </button>
          </div>
        </div>

        {/* Right: Controls & Element Toolbar */}
        <div className="space-y-5 rounded-3xl border border-white/10 bg-slate-900/90 p-5 sm:p-6 transition-all">
          {/* Header Toolbar (Selalu Muncul) */}
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-base font-black text-white">
                Tata Letak Elemen Kartu
              </h3>
              <p className="text-xs text-slate-400">
                Sisi Aktif:{" "}
                <strong className="text-sky-300">
                  {builderSide === "front" ? "Sisi Depan" : "Sisi Belakang"}
                </strong>
              </p>
            </div>
            <button
              type="button"
              onClick={() => setAddElementModalOpen(true)}
              className="rounded-xl bg-sky-400 px-3.5 py-1.5 text-xs font-black text-slate-950 hover:bg-sky-300 inline-flex items-center gap-1.5 shadow"
            >
              <Icon name="add" className="size-3.5" />
              <span>Tambah Elemen</span>
            </button>
          </div>

          {/* FOCUSED ELEMENT INSPECTOR (Tampil langsung di paling atas saat ada elemen yang dipilih) */}
          {selectedElement ? (
            <div className="space-y-4 rounded-3xl border border-sky-400/40 bg-slate-950 p-5 shadow-2xl shadow-sky-950/40">
              <div className="flex items-center justify-between border-b border-white/10 pb-3">
                <div className="flex items-center gap-2.5">
                  <span className="flex size-7 items-center justify-center rounded-xl bg-sky-400/20 text-sky-300">
                    <Icon name="palette" className="size-4" />
                  </span>
                  <div>
                    <div className="text-[10px] font-black uppercase tracking-wider text-sky-400">
                      Pengaturan Elemen Terpilih
                    </div>
                    <div className="text-sm font-black text-white">
                      {selectedElement.label}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {selectedElement.id.startsWith("el-custom-") ? (
                    <button
                      type="button"
                      onClick={() => handleDeleteElement(selectedElement.id)}
                      className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-2.5 py-1 text-xs font-bold text-rose-300 hover:bg-rose-500/20"
                    >
                      Hapus Elemen
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => setSelectedElementId(null)}
                    className="rounded-xl border border-white/10 bg-slate-800 px-3 py-1 text-xs font-bold text-slate-300 hover:bg-slate-700 hover:text-white transition flex items-center gap-1"
                    title="Selesai mengedit elemen ini"
                  >
                    <span>✕ Selesai</span>
                  </button>
                </div>
              </div>

              {/* Status Visibilitas & Sisi Penempatan */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <div className="text-xs font-medium text-slate-400">
                    Status di Kartu
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      handleToggleElementVisible(selectedElement.id)
                    }
                    className={`w-full rounded-xl p-2 text-xs font-bold transition text-center border ${
                      selectedElement.visible !== false
                        ? "border-emerald-400 bg-emerald-500/10 text-emerald-300"
                        : "border-rose-500/30 bg-rose-500/10 text-rose-300"
                    }`}
                  >
                    {selectedElement.visible !== false
                      ? "✓ Ditampilkan di Kartu"
                      : "✗ Disembunyikan / Nonaktif"}
                  </button>
                </div>

                <label className="space-y-1 text-xs font-medium text-slate-400">
                  Sisi Penempatan
                  <select
                    value={selectedElement.side}
                    onChange={(e) => {
                      const newSide = e.target.value as CardSide;
                      handleSwitchElementSide(selectedElement.id, newSide);
                    }}
                    className="min-h-9 w-full rounded-xl border border-white/10 bg-slate-900 px-2 text-xs text-white"
                  >
                    <option value="front">Sisi Depan</option>
                    <option value="back">Sisi Belakang</option>
                  </select>
                </label>
              </div>

              {/* Custom Label & Static text */}
              <div className="grid grid-cols-2 gap-3">
                <label className="space-y-1 text-xs font-medium text-slate-400">
                  Nama Label Elemen
                  <input
                    type="text"
                    value={selectedElement.label}
                    onChange={(e) =>
                      handleUpdateSelectedElement({ label: e.target.value })
                    }
                    className="min-h-9 w-full rounded-xl border border-white/10 bg-slate-900 px-3 text-xs text-white"
                  />
                </label>
                {selectedElement.type === "static_text" ? (
                  <label className="space-y-1 text-xs font-medium text-slate-400">
                    Isi Teks Statis
                    <input
                      type="text"
                      value={selectedElement.staticValue || ""}
                      onChange={(e) =>
                        handleUpdateSelectedElement({
                          staticValue: e.target.value,
                        })
                      }
                      className="min-h-9 w-full rounded-xl border border-white/10 bg-slate-900 px-3 text-xs text-white"
                    />
                  </label>
                ) : null}
              </div>

              {/* Posisi X & Posisi Y Sliders + Precision Steppers */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {/* Posisi X */}
                <div className="space-y-2 rounded-2xl border border-white/5 bg-slate-900/60 p-3">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-slate-300">
                      Posisi X (Mendatar)
                    </span>
                    <div className="flex items-center gap-1 rounded-lg border border-white/10 bg-slate-950 px-2 py-0.5">
                      <input
                        aria-label="Posisi horizontal elemen dalam persen"
                        type="number"
                        min={0}
                        max={100}
                        step={0.1}
                        value={selectedElement.x}
                        onChange={(e) =>
                          handleUpdateSelectedElement({
                            x: Math.round(Number(e.target.value) * 10) / 10,
                          })
                        }
                        className="w-12 bg-transparent text-right font-mono text-xs font-bold text-sky-400 focus:outline-none"
                      />
                      <span className="text-[10px] font-bold text-slate-400">
                        %
                      </span>
                    </div>
                  </div>
                  <input
                    aria-label="Geser posisi horizontal elemen"
                    type="range"
                    min={0}
                    max={100}
                    step={0.1}
                    value={selectedElement.x}
                    onChange={(e) =>
                      handleUpdateSelectedElement({
                        x: Math.round(Number(e.target.value) * 10) / 10,
                      })
                    }
                    className="w-full accent-sky-400 cursor-pointer"
                  />
                  <div className="grid grid-cols-4 gap-1 pt-0.5">
                    <button
                      type="button"
                      onClick={() =>
                        handleUpdateSelectedElement({
                          x: Math.max(
                            0,
                            Math.round((selectedElement.x - 1) * 10) / 10,
                          ),
                        })
                      }
                      className="rounded-lg border border-slate-700/50 bg-slate-800 py-1 text-center font-mono text-[10px] font-bold text-slate-300 hover:bg-slate-700 hover:text-white transition"
                    >
                      -1%
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        handleUpdateSelectedElement({
                          x: Math.max(
                            0,
                            Math.round((selectedElement.x - 0.1) * 10) / 10,
                          ),
                        })
                      }
                      className="rounded-lg border border-slate-700/50 bg-slate-800 py-1 text-center font-mono text-[10px] font-bold text-slate-300 hover:bg-slate-700 hover:text-white transition"
                    >
                      -0.1%
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        handleUpdateSelectedElement({
                          x: Math.min(
                            100,
                            Math.round((selectedElement.x + 0.1) * 10) / 10,
                          ),
                        })
                      }
                      className="rounded-lg border border-slate-700/50 bg-slate-800 py-1 text-center font-mono text-[10px] font-bold text-slate-300 hover:bg-slate-700 hover:text-white transition"
                    >
                      +0.1%
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        handleUpdateSelectedElement({
                          x: Math.min(
                            100,
                            Math.round((selectedElement.x + 1) * 10) / 10,
                          ),
                        })
                      }
                      className="rounded-lg border border-slate-700/50 bg-slate-800 py-1 text-center font-mono text-[10px] font-bold text-slate-300 hover:bg-slate-700 hover:text-white transition"
                    >
                      +1%
                    </button>
                  </div>
                </div>

                {/* Posisi Y */}
                <div className="space-y-2 rounded-2xl border border-white/5 bg-slate-900/60 p-3">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-slate-300">
                      Posisi Y (Tegak)
                    </span>
                    <div className="flex items-center gap-1 rounded-lg border border-white/10 bg-slate-950 px-2 py-0.5">
                      <input
                        aria-label="Posisi vertikal elemen dalam persen"
                        type="number"
                        min={0}
                        max={100}
                        step={0.1}
                        value={selectedElement.y}
                        onChange={(e) =>
                          handleUpdateSelectedElement({
                            y: Math.round(Number(e.target.value) * 10) / 10,
                          })
                        }
                        className="w-12 bg-transparent text-right font-mono text-xs font-bold text-sky-400 focus:outline-none"
                      />
                      <span className="text-[10px] font-bold text-slate-400">
                        %
                      </span>
                    </div>
                  </div>
                  <input
                    aria-label="Geser posisi vertikal elemen"
                    type="range"
                    min={0}
                    max={100}
                    step={0.1}
                    value={selectedElement.y}
                    onChange={(e) =>
                      handleUpdateSelectedElement({
                        y: Math.round(Number(e.target.value) * 10) / 10,
                      })
                    }
                    className="w-full accent-sky-400 cursor-pointer"
                  />
                  <div className="grid grid-cols-4 gap-1 pt-0.5">
                    <button
                      type="button"
                      onClick={() =>
                        handleUpdateSelectedElement({
                          y: Math.max(
                            0,
                            Math.round((selectedElement.y - 1) * 10) / 10,
                          ),
                        })
                      }
                      className="rounded-lg border border-slate-700/50 bg-slate-800 py-1 text-center font-mono text-[10px] font-bold text-slate-300 hover:bg-slate-700 hover:text-white transition"
                    >
                      -1%
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        handleUpdateSelectedElement({
                          y: Math.max(
                            0,
                            Math.round((selectedElement.y - 0.1) * 10) / 10,
                          ),
                        })
                      }
                      className="rounded-lg border border-slate-700/50 bg-slate-800 py-1 text-center font-mono text-[10px] font-bold text-slate-300 hover:bg-slate-700 hover:text-white transition"
                    >
                      -0.1%
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        handleUpdateSelectedElement({
                          y: Math.min(
                            100,
                            Math.round((selectedElement.y + 0.1) * 10) / 10,
                          ),
                        })
                      }
                      className="rounded-lg border border-slate-700/50 bg-slate-800 py-1 text-center font-mono text-[10px] font-bold text-slate-300 hover:bg-slate-700 hover:text-white transition"
                    >
                      +0.1%
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        handleUpdateSelectedElement({
                          y: Math.min(
                            100,
                            Math.round((selectedElement.y + 1) * 10) / 10,
                          ),
                        })
                      }
                      className="rounded-lg border border-slate-700/50 bg-slate-800 py-1 text-center font-mono text-[10px] font-bold text-slate-300 hover:bg-slate-700 hover:text-white transition"
                    >
                      +1%
                    </button>
                  </div>
                </div>
              </div>

              {/* Width & Height (for QR / Image / bounded boxes) */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {/* Lebar Box */}
                <div className="space-y-2 rounded-2xl border border-white/5 bg-slate-900/60 p-3">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-slate-300">
                      Lebar Box
                    </span>
                    <div className="flex items-center gap-1 rounded-lg border border-white/10 bg-slate-950 px-2 py-0.5">
                      <input
                        aria-label="Lebar elemen dalam persen"
                        type="number"
                        min={2}
                        max={100}
                        step={0.5}
                        value={selectedElement.width || 20}
                        onChange={(e) =>
                          handleUpdateSelectedElement({
                            width: Math.round(Number(e.target.value) * 10) / 10,
                          })
                        }
                        className="w-12 bg-transparent text-right font-mono text-xs font-bold text-sky-400 focus:outline-none"
                      />
                      <span className="text-[10px] font-bold text-slate-400">
                        %
                      </span>
                    </div>
                  </div>
                  <input
                    aria-label="Geser lebar elemen"
                    type="range"
                    min={2}
                    max={100}
                    step={0.5}
                    value={selectedElement.width || 20}
                    onChange={(e) =>
                      handleUpdateSelectedElement({
                        width: Math.round(Number(e.target.value) * 10) / 10,
                      })
                    }
                    className="w-full accent-sky-400 cursor-pointer"
                  />
                  <div className="grid grid-cols-4 gap-1 pt-0.5">
                    <button
                      type="button"
                      onClick={() =>
                        handleUpdateSelectedElement({
                          width: Math.max(
                            2,
                            Math.round(
                              ((selectedElement.width || 20) - 5) * 10,
                            ) / 10,
                          ),
                        })
                      }
                      className="rounded-lg border border-slate-700/50 bg-slate-800 py-1 text-center font-mono text-[10px] font-bold text-slate-300 hover:bg-slate-700 hover:text-white transition"
                    >
                      -5%
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        handleUpdateSelectedElement({
                          width: Math.max(
                            2,
                            Math.round(
                              ((selectedElement.width || 20) - 1) * 10,
                            ) / 10,
                          ),
                        })
                      }
                      className="rounded-lg border border-slate-700/50 bg-slate-800 py-1 text-center font-mono text-[10px] font-bold text-slate-300 hover:bg-slate-700 hover:text-white transition"
                    >
                      -1%
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        handleUpdateSelectedElement({
                          width: Math.min(
                            100,
                            Math.round(
                              ((selectedElement.width || 20) + 1) * 10,
                            ) / 10,
                          ),
                        })
                      }
                      className="rounded-lg border border-slate-700/50 bg-slate-800 py-1 text-center font-mono text-[10px] font-bold text-slate-300 hover:bg-slate-700 hover:text-white transition"
                    >
                      +1%
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        handleUpdateSelectedElement({
                          width: Math.min(
                            100,
                            Math.round(
                              ((selectedElement.width || 20) + 5) * 10,
                            ) / 10,
                          ),
                        })
                      }
                      className="rounded-lg border border-slate-700/50 bg-slate-800 py-1 text-center font-mono text-[10px] font-bold text-slate-300 hover:bg-slate-700 hover:text-white transition"
                    >
                      +5%
                    </button>
                  </div>
                </div>

                {/* Tinggi Box */}
                <div className="space-y-2 rounded-2xl border border-white/5 bg-slate-900/60 p-3">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-slate-300">
                      Tinggi Box
                    </span>
                    <div className="flex items-center gap-1 rounded-lg border border-white/10 bg-slate-950 px-2 py-0.5">
                      <input
                        aria-label="Tinggi elemen dalam persen"
                        type="number"
                        min={2}
                        max={100}
                        step={0.5}
                        value={selectedElement.height || 20}
                        onChange={(e) =>
                          handleUpdateSelectedElement({
                            height:
                              Math.round(Number(e.target.value) * 10) / 10,
                          })
                        }
                        className="w-12 bg-transparent text-right font-mono text-xs font-bold text-sky-400 focus:outline-none"
                      />
                      <span className="text-[10px] font-bold text-slate-400">
                        %
                      </span>
                    </div>
                  </div>
                  <input
                    aria-label="Geser tinggi elemen"
                    type="range"
                    min={2}
                    max={100}
                    step={0.5}
                    value={selectedElement.height || 20}
                    onChange={(e) =>
                      handleUpdateSelectedElement({
                        height: Math.round(Number(e.target.value) * 10) / 10,
                      })
                    }
                    className="w-full accent-sky-400 cursor-pointer"
                  />
                  <div className="grid grid-cols-4 gap-1 pt-0.5">
                    <button
                      type="button"
                      onClick={() =>
                        handleUpdateSelectedElement({
                          height: Math.max(
                            2,
                            Math.round(
                              ((selectedElement.height || 20) - 5) * 10,
                            ) / 10,
                          ),
                        })
                      }
                      className="rounded-lg border border-slate-700/50 bg-slate-800 py-1 text-center font-mono text-[10px] font-bold text-slate-300 hover:bg-slate-700 hover:text-white transition"
                    >
                      -5%
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        handleUpdateSelectedElement({
                          height: Math.max(
                            2,
                            Math.round(
                              ((selectedElement.height || 20) - 1) * 10,
                            ) / 10,
                          ),
                        })
                      }
                      className="rounded-lg border border-slate-700/50 bg-slate-800 py-1 text-center font-mono text-[10px] font-bold text-slate-300 hover:bg-slate-700 hover:text-white transition"
                    >
                      -1%
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        handleUpdateSelectedElement({
                          height: Math.min(
                            100,
                            Math.round(
                              ((selectedElement.height || 20) + 1) * 10,
                            ) / 10,
                          ),
                        })
                      }
                      className="rounded-lg border border-slate-700/50 bg-slate-800 py-1 text-center font-mono text-[10px] font-bold text-slate-300 hover:bg-slate-700 hover:text-white transition"
                    >
                      +1%
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        handleUpdateSelectedElement({
                          height: Math.min(
                            100,
                            Math.round(
                              ((selectedElement.height || 20) + 5) * 10,
                            ) / 10,
                          ),
                        })
                      }
                      className="rounded-lg border border-slate-700/50 bg-slate-800 py-1 text-center font-mono text-[10px] font-bold text-slate-300 hover:bg-slate-700 hover:text-white transition"
                    >
                      +5%
                    </button>
                  </div>
                </div>
              </div>

              {/* Typography & Styling */}
              <div className="grid grid-cols-3 gap-3">
                <label className="space-y-1 text-xs font-medium text-slate-400">
                  Ukuran Font (pt)
                  <input
                    type="number"
                    min={6}
                    max={48}
                    value={selectedElement.fontSize}
                    onChange={(e) =>
                      handleUpdateSelectedElement({
                        fontSize: Number(e.target.value),
                      })
                    }
                    className="min-h-9 w-full rounded-xl border border-white/10 bg-slate-900 px-2 text-xs text-white"
                  />
                </label>
                <label className="space-y-1 text-xs font-medium text-slate-400">
                  Warna Teks / QR
                  <input
                    type="color"
                    value={selectedElement.color || "#ffffff"}
                    onChange={(e) =>
                      handleUpdateSelectedElement({ color: e.target.value })
                    }
                    className="h-9 w-full cursor-pointer rounded-xl border border-white/10 bg-slate-900 p-1"
                  />
                </label>
                <label className="space-y-1 text-xs font-medium text-slate-400">
                  Huruf Kapital
                  <select
                    value={selectedElement.isUppercase ? "yes" : "no"}
                    onChange={(e) =>
                      handleUpdateSelectedElement({
                        isUppercase: e.target.value === "yes",
                      })
                    }
                    className="min-h-9 w-full rounded-xl border border-white/10 bg-slate-900 px-2 text-xs text-white"
                  >
                    <option value="yes">KAPITAL</option>
                    <option value="no">Normal</option>
                  </select>
                </label>
              </div>

              {/* Perataan Teks (Alignment) */}
              <div className="space-y-1">
                <div className="text-xs font-medium text-slate-400">
                  Perataan Teks
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {(["left", "center", "right"] as const).map((align) => (
                    <button
                      key={align}
                      type="button"
                      onClick={() =>
                        handleUpdateSelectedElement({ textAlign: align })
                      }
                      className={`rounded-xl py-1.5 text-xs font-bold capitalize transition border ${
                        (selectedElement.textAlign || "left") === align
                          ? "border-sky-400 bg-sky-400/10 text-sky-300"
                          : "border-white/5 bg-slate-900 text-slate-400 hover:bg-slate-800"
                      }`}
                    >
                      {align === "left"
                        ? "Kiri"
                        : align === "center"
                          ? "Tengah"
                          : "Kanan"}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : null}

          {/* Element Selector List for active side (Selalu Muncul) */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span>
                Daftar Elemen (Sisi{" "}
                {builderSide === "front" ? "Depan" : "Belakang"}):
              </span>
              <span className="text-[11px] text-slate-500">
                Klik elemen untuk memilih & mengedit posisinya
              </span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-56 overflow-y-auto rounded-2xl border border-white/10 bg-slate-950 p-2.5">
              {template.elements
                .filter((el) => el.side === builderSide)
                .map((el) => {
                  const isSelected = selectedElementId === el.id;
                  const isVisible = el.visible !== false;
                  return (
                    <div
                      key={el.id}
                      className={`flex items-center justify-between rounded-xl border p-2 text-xs transition ${
                        isSelected
                          ? "border-sky-400 bg-sky-500/10 text-white"
                          : "border-white/5 bg-slate-900 text-slate-300 hover:bg-slate-800"
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => setSelectedElementId(el.id)}
                        className="flex-1 text-left font-bold truncate pr-2"
                      >
                        <div className="truncate">{el.label}</div>
                        <div className="text-[10px] font-normal text-slate-500">
                          Pos ({el.x}%, {el.y}%)
                        </div>
                      </button>

                      {/* Visibility Toggle Button */}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleToggleElementVisible(el.id);
                        }}
                        title={
                          isVisible
                            ? "Elemen aktif (klik untuk menyembunyikan)"
                            : "Elemen disembunyikan (klik untuk mengaktifkan)"
                        }
                        className={`rounded-lg px-2 py-1 text-[10px] font-bold transition flex items-center gap-1 ${
                          isVisible
                            ? "bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30"
                            : "bg-slate-800 text-slate-500 hover:bg-slate-700"
                        }`}
                      >
                        <Icon
                          name={isVisible ? "eye" : "eye-off"}
                          className="size-3"
                        />
                        <span>{isVisible ? "Aktif" : "Mati"}</span>
                      </button>
                    </div>
                  );
                })}
            </div>
          </div>

          {/* Elements on opposite side helper (Selalu Muncul) */}
          {template.elements.some((el) => el.side !== builderSide) ? (
            <div className="rounded-2xl border border-white/5 bg-slate-950/40 p-3 space-y-2">
              <div className="text-[11px] font-bold text-slate-400">
                Elemen di Sisi Sebaliknya (
                {builderSide === "front" ? "Sisi Belakang" : "Sisi Depan"}):
              </div>
              <div className="flex flex-wrap gap-1.5">
                {template.elements
                  .filter((el) => el.side !== builderSide)
                  .map((el) => (
                    <button
                      key={el.id}
                      type="button"
                      onClick={() =>
                        handleSwitchElementSide(el.id, builderSide)
                      }
                      title={`Klik untuk memindahkan "${el.label}" ke Sisi ${builderSide === "front" ? "Depan" : "Belakang"}`}
                      className="rounded-lg border border-white/10 bg-slate-900 px-2.5 py-1 text-[11px] text-slate-300 hover:border-sky-400 hover:text-white transition inline-flex items-center gap-1"
                    >
                      <span>{el.label}</span>
                      <span className="text-[9px] text-sky-400">
                        (Pindahkan ke Sisi Ini)
                      </span>
                    </button>
                  ))}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
