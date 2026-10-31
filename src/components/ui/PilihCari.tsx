"use client";

import {
  Children,
  Fragment,
  isValidElement,
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  type Pilihan,
  pisahKelasWadah,
  saringPilihan,
} from "@/lib/validations/pilih-cari";

/** Daftar puluhan ribu baris tetap ringan; sisanya dicapai lewat pencarian. */
const MAKS_TAMPIL = 200;
const TINGGI_DAFTAR = 288;

function teksAnak(node: ReactNode): string {
  return Children.toArray(node)
    .filter((anak) => typeof anak === "string" || typeof anak === "number")
    .join("");
}

function bacaPilihan(children: ReactNode, hasil: Pilihan[] = []): Pilihan[] {
  Children.forEach(children, (anak) => {
    if (!isValidElement(anak)) return;
    const props = anak.props as {
      children?: ReactNode;
      disabled?: boolean;
      value?: string | number;
    };
    if (anak.type === Fragment) {
      bacaPilihan(props.children, hasil);
    } else if (anak.type === "option") {
      const label = teksAnak(props.children);
      hasil.push({
        value: String(props.value ?? label),
        label,
        disabled: Boolean(props.disabled),
      });
    }
  });
  return hasil;
}

interface PilihCariProps {
  "aria-describedby"?: string;
  "aria-label"?: string;
  /** `<option>` seperti pada dropdown bawaan; `value=""` menjadi teks petunjuk. */
  children: ReactNode;
  className?: string;
  /** Tanpa `value`, nilainya dipegang di sini dan dibaca lewat `name`/FormData. */
  defaultValue?: string;
  disabled?: boolean;
  id?: string;
  name?: string;
  onChange?: (event: { target: { value: string } }) => void;
  required?: boolean;
  value?: string | number | null;
}

/**
 * Pengganti dropdown bawaan untuk daftar yang bisa panjang: kotak pencarian, tombol
 * panah di sampingnya, dan daftar bergulir setinggi terbatas.
 *
 * Isi dan `onChange`-nya sengaja sama dengan dropdown bawaan, jadi pemakaiannya cukup
 * mengganti nama tag. Pilihan tetap yang pendek tidak perlu memakai ini.
 *
 * Daftar memakai Popover API supaya naik ke top layer: `overflow` dan
 * `backdrop-filter` pada Modal akan memotongnya kalau hanya `position: fixed`.
 * Ia tetap anak di DOM, jadi jebakan fokus Modal dan event React tidak terganggu.
 */
export function PilihCari({
  "aria-describedby": ariaDescribedby,
  "aria-label": ariaLabel,
  children,
  className = "",
  defaultValue = "",
  disabled = false,
  id,
  name,
  onChange,
  required = false,
  value: nilaiLuar,
}: PilihCariProps) {
  const [nilaiDalam, setNilaiDalam] = useState(defaultValue);
  const value = nilaiLuar === undefined ? nilaiDalam : String(nilaiLuar ?? "");
  const idDaftar = useId();
  const wadahRef = useRef<HTMLDivElement | null>(null);
  const daftarRef = useRef<HTMLDivElement | null>(null);
  const [terbuka, setTerbuka] = useState(false);
  // null = belum mengetik, kotak menampilkan pilihan yang sedang terpilih.
  const [kata, setKata] = useState<string | null>(null);
  const [aktif, setAktif] = useState(0);

  const pilihan = bacaPilihan(children);
  const terpilih = pilihan.find((item) => item.value === value) ?? null;
  const petunjuk = pilihan.find((item) => item.value === "")?.label;
  // Pada kolom wajib, `value=""` hanya teks petunjuk dan tidak bisa dipilih.
  const tersedia = required
    ? pilihan.filter((item) => item.value !== "")
    : pilihan;
  const tersaring = saringPilihan(tersedia, kata ?? "");
  const tampil = tersaring.slice(0, MAKS_TAMPIL);
  const indeksAktif = Math.min(aktif, Math.max(tampil.length - 1, 0));
  const kelas = pisahKelasWadah(className);

  const buka = () => {
    setKata(null);
    setAktif(
      Math.max(
        tersedia.findIndex((item) => item.value === value),
        0,
      ),
    );
    setTerbuka(true);
  };
  const tutup = () => {
    setTerbuka(false);
    setKata(null);
  };
  const pilih = (item: Pilihan | undefined) => {
    if (!item || item.disabled) return;
    if (item.value !== value) {
      setNilaiDalam(item.value);
      onChange?.({ target: { value: item.value } });
    }
    tutup();
  };

  useLayoutEffect(() => {
    const daftar = daftarRef.current;
    const wadah = wadahRef.current;
    if (!terbuka || !daftar || !wadah) return;
    daftar.showPopover?.();
    const atur = () => {
      const kotak = wadah.getBoundingClientRect();
      const ruangBawah = window.innerHeight - kotak.bottom - 8;
      const ruangAtas = kotak.top - 8;
      const keAtas = ruangBawah < 180 && ruangAtas > ruangBawah;
      Object.assign(daftar.style, {
        left: `${kotak.left}px`,
        width: `${kotak.width}px`,
        maxHeight: `${Math.min(TINGGI_DAFTAR, keAtas ? ruangAtas : ruangBawah)}px`,
        top: keAtas ? "auto" : `${kotak.bottom + 4}px`,
        bottom: keAtas ? `${window.innerHeight - kotak.top + 4}px` : "auto",
      });
    };
    atur();
    window.addEventListener("scroll", atur, true);
    window.addEventListener("resize", atur);
    return () => {
      window.removeEventListener("scroll", atur, true);
      window.removeEventListener("resize", atur);
    };
  }, [terbuka]);

  useEffect(() => {
    if (!terbuka) return;
    const diLuar = (event: PointerEvent) => {
      if (wadahRef.current?.contains(event.target as Node)) return;
      setTerbuka(false);
      setKata(null);
    };
    document.addEventListener("pointerdown", diLuar, true);
    return () => document.removeEventListener("pointerdown", diLuar, true);
  }, [terbuka]);

  useEffect(() => {
    if (!terbuka) return;
    daftarRef.current?.children[indeksAktif]?.scrollIntoView({
      block: "nearest",
    });
  }, [terbuka, indeksAktif]);

  const tekan = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape" && terbuka) {
      // Menutup daftar saja, Modal di sekelilingnya tetap terbuka.
      event.stopPropagation();
      tutup();
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!terbuka) {
        buka();
        return;
      }
      const arah = event.key === "ArrowDown" ? 1 : -1;
      setAktif(
        Math.min(
          Math.max(indeksAktif + arah, 0),
          Math.max(tampil.length - 1, 0),
        ),
      );
    } else if (event.key === "Enter") {
      // Enter memilih, tidak mengirim formulir, sama seperti dropdown bawaan.
      event.preventDefault();
      if (terbuka) pilih(tampil[indeksAktif]);
      else buka();
    }
  };

  return (
    <div ref={wadahRef} className={`relative flex gap-1.5 ${kelas.wadah}`}>
      {name ? <input type="hidden" name={name} value={value} /> : null}
      <input
        id={id}
        type="text"
        // Di deretan filter tanpa lebar tetap, lebarnya mengikuti isi seperti dropdown bawaan.
        size={Math.min(
          Math.max(8, ...pilihan.map((item) => item.label.length)),
          24,
        )}
        role="combobox"
        aria-autocomplete="list"
        aria-activedescendant={
          terbuka && tampil.length > 0
            ? `${idDaftar}-${indeksAktif}`
            : undefined
        }
        aria-controls={idDaftar}
        aria-describedby={ariaDescribedby}
        aria-expanded={terbuka}
        aria-label={ariaLabel}
        autoComplete="off"
        spellCheck={false}
        disabled={disabled}
        required={required}
        placeholder={petunjuk ?? "Ketik untuk mencari"}
        value={kata ?? (terpilih?.value ? terpilih.label : "")}
        onBlur={tutup}
        onChange={(event) => {
          setKata(event.target.value);
          setAktif(0);
          setTerbuka(true);
        }}
        onClick={(event) => {
          if (terbuka) return;
          event.currentTarget.select();
          buka();
        }}
        onKeyDown={tekan}
        className={`${kelas.isian} min-w-0 flex-1`}
      />
      <button
        type="button"
        tabIndex={-1}
        disabled={disabled}
        aria-label="Tampilkan pilihan"
        aria-expanded={terbuka}
        // Fokus tetap di kotak pencarian, supaya `onBlur` tidak menutup daftar
        // yang baru saja dibuka tombol ini.
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => (terbuka ? tutup() : buka())}
        className="grid w-11 shrink-0 place-items-center rounded-lg border border-slate-700 bg-slate-900 text-slate-300 transition-colors hover:bg-slate-800 focus:outline-none disabled:opacity-60"
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 20 20"
          fill="currentColor"
          className={`size-5 transition-transform ${terbuka ? "rotate-180" : ""}`}
        >
          <path d="M5.2 7.2a.75.75 0 0 1 1.1 0L10 11l3.7-3.8a.75.75 0 1 1 1.1 1l-4.25 4.4a.75.75 0 0 1-1.1 0L5.2 8.2a.75.75 0 0 1 0-1Z" />
        </svg>
      </button>
      {terbuka ? (
        <div
          ref={daftarRef}
          id={idDaftar}
          role="listbox"
          tabIndex={-1}
          popover="manual"
          data-no-pull-refresh
          onMouseDown={(event) => event.preventDefault()}
          className="fixed z-[200] m-0 overflow-y-auto overscroll-contain rounded-lg border border-slate-700 bg-slate-900 p-1 text-sm text-slate-100 shadow-xl shadow-black/40"
        >
          {tampil.map((item, indeks) => (
            // biome-ignore lint/a11y/useFocusableInteractive: fokus tetap di kotak pencarian lewat aria-activedescendant.
            // biome-ignore lint/a11y/useKeyWithClickEvents: papan ketik ditangani `tekan` pada kotak pencarian.
            <div
              key={`${item.value}-${indeks}`}
              id={`${idDaftar}-${indeks}`}
              role="option"
              aria-selected={item.value === value}
              aria-disabled={item.disabled}
              onClick={(event) => {
                // Di dalam `<label>`, klik diteruskan ke kotak pencarian dan
                // membuka daftar lagi.
                event.preventDefault();
                pilih(item);
              }}
              onMouseEnter={() => setAktif(indeks)}
              className={`cursor-pointer break-words rounded-md px-3 py-2 ${
                item.disabled
                  ? "cursor-not-allowed text-slate-500"
                  : indeks === indeksAktif
                    ? "bg-sky-700 text-white"
                    : item.value === value
                      ? "font-semibold text-sky-300"
                      : ""
              }`}
            >
              {item.label}
            </div>
          ))}
          {tampil.length === 0 ? (
            <p className="px-3 py-2 text-slate-400">Tidak ada yang cocok.</p>
          ) : null}
          {tersaring.length > tampil.length ? (
            <p className="px-3 py-2 text-xs text-slate-400">
              Menampilkan {MAKS_TAMPIL} dari {tersaring.length}. Ketik untuk
              mempersempit.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
