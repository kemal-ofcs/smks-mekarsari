"use client";

import { Icon } from "@/components/ui/Icon";

/**
 * Editor koleksi berulang untuk CMS landing page.
 *
 * Empat blok landing - pilar, ekstrakurikuler, fasilitas, statistik - dulu
 * berupa slot bernomor yang jumlahnya mati di dalam kode. Menambah pilar kelima
 * menuntut menyunting komponen publik DAN daftar field panel ini sekaligus.
 * Di sini jumlahnya ditentukan orang yang mengisi: tambah, hapus, geser.
 *
 * Seluruh koleksi disimpan sebagai SATU baris `konten_publik` berisi JSON.
 * Nama field-nya adalah kontrak dengan
 * `web-public/src/lib/services/landing-collections.ts`; mengubahnya di satu
 * sisi saja membuat koleksinya terbaca kosong di situs, tanpa pesan kesalahan.
 */

export interface FieldKoleksi {
  /** Nama field di dalam objek JSON - ini bagian kontraknya. */
  name: string;
  label: string;
  type?: "text" | "textarea";
  placeholder?: string;
  /** Satu baris per nilai; disimpan sebagai array. */
  multiline?: boolean;
}

export interface CollectionRepeaterProps {
  label: string;
  description?: string;
  /** Kunci `konten_publik` tempat JSON-nya disimpan. */
  kunci: string;
  fields: FieldKoleksi[];
  items: Record<string, unknown>[];
  maksItem: number;
  disabled?: boolean;
  onChange: (items: Record<string, unknown>[]) => void;
}

function nilaiTeks(item: Record<string, unknown>, field: FieldKoleksi): string {
  const nilai = item[field.name];
  if (field.multiline && Array.isArray(nilai)) {
    return nilai.map((baris) => String(baris)).join("\n");
  }
  return typeof nilai === "string" ? nilai : "";
}

export function CollectionRepeater({
  label,
  description,
  kunci,
  fields,
  items,
  maksItem,
  disabled = false,
  onChange,
}: CollectionRepeaterProps) {
  const ubahField = (index: number, field: FieldKoleksi, teks: string) => {
    onChange(
      items.map((item, i) => {
        if (i !== index) return item;
        return {
          ...item,
          [field.name]: field.multiline
            ? teks
                .split("\n")
                .map((baris) => baris.trim())
                .filter(Boolean)
            : teks,
        };
      }),
    );
  };

  const tambah = () => {
    if (items.length >= maksItem) return;
    const kosong: Record<string, unknown> = {};
    for (const field of fields) {
      kosong[field.name] = field.multiline ? [] : "";
    }
    onChange([...items, kosong]);
  };

  const hapus = (index: number) => {
    onChange(items.filter((_, i) => i !== index));
  };

  const geser = (index: number, arah: -1 | 1) => {
    const tujuan = index + arah;
    if (tujuan < 0 || tujuan >= items.length) return;
    const berikut = [...items];
    const simpan = berikut[index];
    berikut[index] = berikut[tujuan];
    berikut[tujuan] = simpan;
    onChange(berikut);
  };

  return (
    <section className="rounded-2xl border border-white/10 bg-slate-950/40 p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-white/10 pb-3">
        <div>
          <h4 className="text-sm font-bold text-white">{label}</h4>
          {description ? (
            <p className="mt-1 text-[11px] text-slate-400">{description}</p>
          ) : null}
          <p className="mt-1 font-mono text-[11px] text-slate-500">
            Kunci database: {kunci}
          </p>
        </div>
        <span className="shrink-0 rounded-lg border border-white/10 bg-slate-800 px-2.5 py-1 text-[11px] font-bold text-slate-300">
          {items.length} / {maksItem}
        </span>
      </div>

      {items.length === 0 ? (
        <p className="py-6 text-center text-xs text-slate-400">
          Belum ada item. Selama kosong, situs publik menampilkan isi bawaannya,
          jadi halaman depan tidak pernah tampil kosong.
        </p>
      ) : (
        <ol className="mt-4 space-y-4">
          {items.map((item, index) => (
            <li
              // Posisi memang identitasnya di sini: item boleh digeser dan
              // isinya boleh sama persis, jadi tidak ada nilai lain yang stabil.
              // biome-ignore lint/suspicious/noArrayIndexKey: urutan adalah identitas item
              key={index}
              className="rounded-xl border border-white/10 bg-slate-900/70 p-4"
            >
              <div className="mb-3 flex items-center justify-between gap-2">
                <span className="text-xs font-bold text-slate-300">
                  Item {index + 1}
                </span>
                {!disabled && (
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      aria-label={`Pindahkan item ${index + 1} ke atas`}
                      disabled={index === 0}
                      onClick={() => geser(index, -1)}
                      className="rounded-lg bg-white/5 px-2 py-1 text-xs text-slate-300 hover:bg-white/10 disabled:opacity-30"
                    >
                      Naik
                    </button>
                    <button
                      type="button"
                      aria-label={`Pindahkan item ${index + 1} ke bawah`}
                      disabled={index === items.length - 1}
                      onClick={() => geser(index, 1)}
                      className="rounded-lg bg-white/5 px-2 py-1 text-xs text-slate-300 hover:bg-white/10 disabled:opacity-30"
                    >
                      Turun
                    </button>
                    <button
                      type="button"
                      aria-label={`Hapus item ${index + 1}`}
                      onClick={() => hapus(index)}
                      className="rounded-lg bg-rose-500/10 p-1.5 text-rose-400 hover:bg-rose-500/20"
                    >
                      <Icon name="trash" className="size-3.5" />
                    </button>
                  </div>
                )}
              </div>

              <div className="space-y-3">
                {fields.map((field) => {
                  const id = `koleksi-${kunci}-${index}-${field.name}`;
                  const nilai = nilaiTeks(item, field);
                  return (
                    <div key={field.name}>
                      <label
                        htmlFor={id}
                        className="block text-[11px] font-bold text-slate-400 mb-1"
                      >
                        {field.label}
                      </label>
                      {field.type === "textarea" || field.multiline ? (
                        <textarea
                          id={id}
                          rows={field.multiline ? 4 : 3}
                          value={nilai}
                          placeholder={field.placeholder}
                          disabled={disabled}
                          onChange={(e) =>
                            ubahField(index, field, e.target.value)
                          }
                          className="w-full rounded-lg border border-white/10 bg-slate-800/90 px-3 py-2 text-sm text-white focus:border-sky-400 focus:outline-none disabled:opacity-60"
                        />
                      ) : (
                        <input
                          id={id}
                          type="text"
                          value={nilai}
                          placeholder={field.placeholder}
                          disabled={disabled}
                          onChange={(e) =>
                            ubahField(index, field, e.target.value)
                          }
                          className="w-full rounded-lg border border-white/10 bg-slate-800/90 px-3 py-2 text-sm text-white focus:border-sky-400 focus:outline-none disabled:opacity-60"
                        />
                      )}
                      {field.multiline ? (
                        <p className="mt-1 text-[11px] text-slate-500">
                          Satu baris per poin.
                        </p>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </li>
          ))}
        </ol>
      )}

      {!disabled && (
        <button
          type="button"
          onClick={tambah}
          disabled={items.length >= maksItem}
          className="mt-4 inline-flex items-center gap-2 rounded-xl border border-sky-500/30 bg-sky-500/10 px-3.5 py-2 text-xs font-bold text-sky-300 hover:bg-sky-500/20 disabled:opacity-40"
        >
          <Icon name="plus" className="size-3.5" />
          Tambah item
        </button>
      )}
    </section>
  );
}
