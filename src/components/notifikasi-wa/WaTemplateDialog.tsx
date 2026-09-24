"use client";

import { useEffect, useRef, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import {
  getWaTemplatesGateway,
  saveWaTemplatesGateway,
} from "@/lib/gateways/wa-notification";
import {
  DEFAULT_WA_TEMPLATES,
  renderWaTemplate,
  validateWaTemplate,
  WA_NOTIFICATION_KINDS,
  WA_TEMPLATE_LABELS,
  WA_TEMPLATE_PLACEHOLDERS,
  type WaNotificationKind,
  type WaTemplateMap,
} from "@/lib/validations/wa-notification";

/** Data contoh untuk pratinjau. Tidak pernah dikirim ke siapa pun. */
const CONTOH: Record<string, string> = {
  nama: "Budi Santoso",
  rombel: "VII-A",
  jam: "07:05",
  tanggal: "2026-09-24",
  status: "Tepat Waktu",
  mapel: "Matematika",
  jam_ke: "3",
  total_alfa: "3",
  hari: "30",
  keterangan: "Sakit, surat menyusul",
};

/**
 * Dialog penyunting teks pesan WhatsApp otomatis.
 *
 * Disalin apa adanya ke Mobile lewat `filesToCopy` di `sync-frontend-lib.ts`,
 * jadi hanya memakai kelas slate padat yang dibalik benar oleh tema terang di
 * kedua workspace.
 */
export function WaTemplateDialog({
  isOpen,
  onClose,
  onSaved,
}: {
  isOpen: boolean;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [drafts, setDrafts] = useState<WaTemplateMap | null>(null);
  const [jenis, setJenis] = useState<WaNotificationKind>("scan_masuk");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const isSubmittingRef = useRef(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setDrafts(null);
    setError(null);
    getWaTemplatesGateway()
      .then((stored) => {
        if (cancelled) return;
        // Yang kosong ditampilkan sebagai teks bawaan supaya admin menyunting
        // dari kalimat yang sekarang benar-benar terkirim.
        const awal = {} as WaTemplateMap;
        for (const kind of WA_NOTIFICATION_KINDS) {
          awal[kind] = stored[kind] || DEFAULT_WA_TEMPLATES[kind];
        }
        setDrafts(awal);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "Gagal memuat teks pesan.",
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  const checks = drafts
    ? WA_NOTIFICATION_KINDS.map((kind) => ({
        kind,
        check: validateWaTemplate(kind, drafts[kind]),
      }))
    : [];
  const invalid = checks.filter(({ check }) => !check.ok);
  const current = drafts?.[jenis] ?? "";
  const currentCheck = validateWaTemplate(jenis, current);

  const setCurrent = (value: string) =>
    setDrafts((prev) => (prev ? { ...prev, [jenis]: value } : prev));

  const insertPlaceholder = (name: string) => {
    const token = `{${name}}`;
    const el = textareaRef.current;
    const start = el?.selectionStart ?? current.length;
    const end = el?.selectionEnd ?? current.length;
    setCurrent(current.slice(0, start) + token + current.slice(end));
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + token.length, start + token.length);
    });
  };

  const handleSave = async () => {
    if (isSubmittingRef.current || !drafts || invalid.length > 0) return;
    isSubmittingRef.current = true;
    setSaving(true);
    setError(null);
    try {
      // Teks yang sama dengan bawaan disimpan kosong, supaya perbaikan teks
      // bawaan di versi berikutnya tetap sampai ke sekolah ini.
      const payload = {} as WaTemplateMap;
      for (const kind of WA_NOTIFICATION_KINDS) {
        const value = drafts[kind].trim();
        payload[kind] = value === DEFAULT_WA_TEMPLATES[kind] ? "" : value;
      }
      await saveWaTemplatesGateway(payload);
      onSaved(
        "Teks pesan WhatsApp tersimpan. Pesan yang sudah di antrean tidak berubah.",
      );
      onClose();
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : "Gagal menyimpan teks pesan.",
      );
    } finally {
      isSubmittingRef.current = false;
      setSaving(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Ubah Teks Pesan WhatsApp"
      subtitle="Berlaku untuk pesan yang diantrekan setelah disimpan"
      maxWidth="max-w-2xl"
      footer={
        <div className="flex flex-wrap justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-700 bg-slate-800 px-4 py-2 text-xs font-medium text-slate-300 transition hover:bg-slate-700"
          >
            Batal
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={!drafts || saving || invalid.length > 0}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-emerald-500 disabled:opacity-50"
          >
            {saving ? "Menyimpan..." : "Simpan Semua"}
          </button>
        </div>
      }
    >
      {!drafts ? (
        <p className="text-xs text-slate-400">
          {error ?? "Memuat teks pesan..."}
        </p>
      ) : (
        <div className="space-y-4 text-xs">
          <div>
            <label
              htmlFor="wa-template-jenis"
              className="mb-1.5 block font-medium text-slate-300"
            >
              Jenis pesan
            </label>
            <select
              id="wa-template-jenis"
              value={jenis}
              onChange={(e) => setJenis(e.target.value as WaNotificationKind)}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200"
            >
              {WA_NOTIFICATION_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {WA_TEMPLATE_LABELS[kind]}
                  {validateWaTemplate(kind, drafts[kind]).ok
                    ? ""
                    : " (perlu diperbaiki)"}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              htmlFor="wa-template-teks"
              className="mb-1.5 block font-medium text-slate-300"
            >
              Teks pesan
            </label>
            <textarea
              id="wa-template-teks"
              ref={textareaRef}
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              rows={6}
              aria-invalid={!currentCheck.ok}
              aria-describedby="wa-template-isian wa-template-galat"
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm leading-relaxed text-slate-200"
            />
            <div className="mt-1 flex flex-wrap items-center justify-between gap-2 text-slate-400">
              <span>{[...current.trim()].length} / 1000 karakter</span>
              <button
                type="button"
                onClick={() => setCurrent(DEFAULT_WA_TEMPLATES[jenis])}
                disabled={current === DEFAULT_WA_TEMPLATES[jenis]}
                className="font-medium text-sky-400 underline-offset-2 hover:underline disabled:text-slate-500 disabled:no-underline"
              >
                Kembalikan ke teks bawaan
              </button>
            </div>
            {!currentCheck.ok ? (
              <p
                id="wa-template-galat"
                role="alert"
                className="mt-1 font-medium text-rose-400"
              >
                {currentCheck.pesan}
              </p>
            ) : null}
          </div>

          <div id="wa-template-isian">
            <p className="mb-1.5 text-slate-400">
              Klik untuk menyisipkan isian. {"{nama}"} wajib ada.
            </p>
            <div className="flex flex-wrap gap-2">
              {WA_TEMPLATE_PLACEHOLDERS[jenis].map((name) => (
                <button
                  key={name}
                  type="button"
                  onClick={() => insertPlaceholder(name)}
                  className="rounded-md border border-slate-700 bg-slate-800 px-2 py-1 font-mono text-slate-200 transition hover:bg-slate-700"
                >
                  {`{${name}}`}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="mb-1.5 text-slate-400">
              Pratinjau dengan data contoh
            </p>
            <div className="whitespace-pre-wrap rounded-lg border border-slate-800 bg-slate-950 p-3 text-sm leading-relaxed text-slate-200">
              {renderWaTemplate(
                current.trim() || DEFAULT_WA_TEMPLATES[jenis],
                CONTOH,
              )}
            </div>
          </div>

          {invalid.length > 0 ? (
            <p className="font-medium text-rose-400">
              Belum bisa disimpan. Perbaiki:{" "}
              {invalid.map(({ kind }) => WA_TEMPLATE_LABELS[kind]).join(", ")}.
            </p>
          ) : null}
          {error ? (
            <p role="alert" className="font-medium text-rose-400">
              {error}
            </p>
          ) : null}
        </div>
      )}
    </Modal>
  );
}
