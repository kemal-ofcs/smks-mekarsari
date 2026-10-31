"use client";

import { useId, useMemo, useRef, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { formatTanggalOperasional } from "@/lib/attendance/time-policy";
import {
  type HasilLiburMassal,
  tambahHariLiburMassal,
} from "@/lib/gateways/holiday";
import {
  JENIS_LIBUR,
  type LiburMassal,
  liburNasionalTahun,
  MAKS_LIBUR_MASSAL,
  rentangTanggal,
  tahunLiburNasional,
} from "@/lib/validations/hari-kerja";

type Tab = "rentang" | "nasional";

const LABEL_JENIS: Record<string, string> = {
  "Libur Nasional": "Libur Nasional",
  "Cuti Bersama": "Cuti Bersama",
  "Libur Khusus": "Libur Khusus / Sekolah",
};

function tanggalPanjang(tanggal: string) {
  const [y, m, d] = tanggal.split("-").map(Number);
  return new Intl.DateTimeFormat("id-ID", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

const kelasInput =
  "min-h-11 w-full rounded-xl border border-slate-800 bg-slate-900 px-3.5 text-white outline-none focus:border-sky-500";
const kelasLabel = "mb-1 block text-xs font-bold tracking-wide text-slate-300";

/**
 * Menambah banyak hari libur sekaligus: satu rentang tanggal (libur semester,
 * kegiatan sekolah) atau libur nasional bawaan yang dicentang satu per satu.
 * Hasilnya baris `tbl_hari_libur` biasa, jadi tetap bisa disunting dan
 * dihapus satu per satu. Dipakai halaman Hari Libur Web/Desktop dan Mobile.
 */
export function LiburMassalDialog({
  tanggalTerdaftar,
  onClose,
  onSaved,
}: {
  tanggalTerdaftar: ReadonlySet<string>;
  onClose: () => void;
  onSaved: (hasil: HasilLiburMassal) => void;
}) {
  const idDasar = useId();
  const isSubmittingRef = useRef(false);
  const [tab, setTab] = useState<Tab>("rentang");
  const [saving, setSaving] = useState(false);
  const [galat, setGalat] = useState<string | null>(null);

  const hariIni = formatTanggalOperasional(Date.now());
  const [mulai, setMulai] = useState(hariIni);
  const [sampai, setSampai] = useState(hariIni);
  const [nama, setNama] = useState("");
  const [jenis, setJenis] = useState<string>("Libur Khusus");
  const [keterangan, setKeterangan] = useState("");

  const daftarTahun = tahunLiburNasional();
  const tahunIni = Number(hariIni.slice(0, 4));
  const [tahun, setTahun] = useState(
    daftarTahun.includes(tahunIni) ? tahunIni : (daftarTahun[0] ?? tahunIni),
  );
  const dataNasional = useMemo(() => liburNasionalTahun(tahun), [tahun]);
  const [dipilih, setDipilih] = useState<Set<string>>(
    () =>
      new Set(
        liburNasionalTahun(
          daftarTahun.includes(tahunIni) ? tahunIni : (daftarTahun[0] ?? 0),
        )
          .map((d) => d.tanggal)
          .filter((t) => !tanggalTerdaftar.has(t)),
      ),
  );

  const tanggalRentang = rentangTanggal(mulai, sampai);
  const rentangBaru = tanggalRentang.filter((t) => !tanggalTerdaftar.has(t));

  const gantiTahun = (baru: number) => {
    setTahun(baru);
    setDipilih(
      new Set(
        liburNasionalTahun(baru)
          .map((d) => d.tanggal)
          .filter((t) => !tanggalTerdaftar.has(t)),
      ),
    );
  };

  const centang = (tanggal: string, aktif: boolean) =>
    setDipilih((prev) => {
      const next = new Set(prev);
      if (aktif) next.add(tanggal);
      else next.delete(tanggal);
      return next;
    });

  const simpan = async () => {
    if (isSubmittingRef.current) return;
    let entries: LiburMassal[];
    if (tab === "rentang") {
      if (!nama.trim()) {
        setGalat("Isi nama libur, misalnya Libur Semester Ganjil.");
        return;
      }
      if (tanggalRentang.length === 0) {
        setGalat("Tanggal akhir tidak boleh sebelum tanggal mulai.");
        return;
      }
      entries = tanggalRentang.map((tanggal) => ({
        tanggal,
        nama_libur: nama.trim(),
        jenis_libur: jenis,
        keterangan: keterangan.trim() || null,
      }));
    } else {
      entries = dataNasional.filter((d) => dipilih.has(d.tanggal));
      if (entries.length === 0) {
        setGalat("Centang minimal satu tanggal.");
        return;
      }
    }
    isSubmittingRef.current = true;
    setSaving(true);
    setGalat(null);
    try {
      onSaved(await tambahHariLiburMassal(entries));
    } catch (err) {
      setGalat(
        err instanceof Error ? err.message : "Hari libur gagal disimpan.",
      );
    } finally {
      isSubmittingRef.current = false;
      setSaving(false);
    }
  };

  const jumlahSimpan =
    tab === "rentang"
      ? rentangBaru.length
      : dataNasional.filter((d) => dipilih.has(d.tanggal)).length;

  return (
    <Modal
      isOpen
      titleId={`${idDasar}-judul`}
      title="Tambah Banyak Hari Libur"
      maxWidth="max-w-2xl"
      onClose={() => !saving && onClose()}
    >
      <div className="space-y-4">
        <div
          role="tablist"
          aria-label="Cara menambah"
          className="grid grid-cols-2 gap-1 rounded-xl border border-slate-800 bg-slate-950/60 p-1"
        >
          {(
            [
              ["rentang", "Rentang tanggal"],
              ["nasional", "Libur nasional"],
            ] as const
          ).map(([nilai, label]) => (
            <button
              key={nilai}
              type="button"
              role="tab"
              aria-selected={tab === nilai}
              onClick={() => {
                setTab(nilai);
                setGalat(null);
              }}
              className={`min-h-11 rounded-lg text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300 ${
                tab === nilai
                  ? "bg-sky-700 text-white"
                  : "text-slate-300 hover:bg-white/5"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === "rentang" ? (
          <div className="space-y-3">
            <p className="text-sm text-slate-400">
              Untuk libur yang berlangsung beberapa hari, misalnya libur
              semester. Setiap tanggal disimpan sebagai satu baris yang bisa
              disunting sendiri nanti.
            </p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor={`${idDasar}-mulai`} className={kelasLabel}>
                  Dari tanggal
                </label>
                <input
                  id={`${idDasar}-mulai`}
                  type="date"
                  value={mulai}
                  onChange={(e) => {
                    setMulai(e.target.value);
                    if (sampai < e.target.value) setSampai(e.target.value);
                  }}
                  className={kelasInput}
                />
              </div>
              <div>
                <label htmlFor={`${idDasar}-sampai`} className={kelasLabel}>
                  Sampai tanggal
                </label>
                <input
                  id={`${idDasar}-sampai`}
                  type="date"
                  value={sampai}
                  min={mulai}
                  onChange={(e) => setSampai(e.target.value)}
                  className={kelasInput}
                />
              </div>
            </div>
            <div>
              <label htmlFor={`${idDasar}-nama`} className={kelasLabel}>
                Nama libur
              </label>
              <input
                id={`${idDasar}-nama`}
                type="text"
                value={nama}
                maxLength={120}
                placeholder="Contoh: Libur Semester Ganjil"
                onChange={(e) => setNama(e.target.value)}
                className={kelasInput}
              />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor={`${idDasar}-jenis`} className={kelasLabel}>
                  Jenis
                </label>
                <select
                  id={`${idDasar}-jenis`}
                  value={jenis}
                  onChange={(e) => setJenis(e.target.value)}
                  className={kelasInput}
                >
                  {JENIS_LIBUR.map((j) => (
                    <option key={j} value={j}>
                      {LABEL_JENIS[j]}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor={`${idDasar}-keterangan`} className={kelasLabel}>
                  Keterangan (opsional)
                </label>
                <input
                  id={`${idDasar}-keterangan`}
                  type="text"
                  value={keterangan}
                  onChange={(e) => setKeterangan(e.target.value)}
                  className={kelasInput}
                />
              </div>
            </div>
            <p aria-live="polite" className="text-sm text-slate-300">
              {tanggalRentang.length === 0
                ? "Tanggal akhir tidak boleh sebelum tanggal mulai."
                : tanggalRentang.length > MAKS_LIBUR_MASSAL
                  ? `Rentang terlalu panjang. Paling banyak ${MAKS_LIBUR_MASSAL} hari sekali simpan.`
                  : `${tanggalRentang.length} hari, ${rentangBaru.length} di antaranya belum terdaftar.`}
            </p>
          </div>
        ) : daftarTahun.length === 0 ? (
          <p className="text-sm text-slate-400">
            Aplikasi ini belum membawa data libur nasional. Tambahkan libur
            nasional lewat tombol Tambah Hari Libur.
          </p>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <label htmlFor={`${idDasar}-tahun`} className={kelasLabel}>
                  Tahun
                </label>
                <select
                  id={`${idDasar}-tahun`}
                  value={tahun}
                  onChange={(e) => gantiTahun(Number(e.target.value))}
                  className={`${kelasInput} sm:w-40`}
                >
                  {daftarTahun.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>
              <p className="max-w-sm text-xs text-slate-400">
                Sesuai {dataNasional[0]?.keterangan ?? "SKB 3 Menteri"}. Buang
                centang tanggal yang tidak berlaku di sekolah ini, misalnya cuti
                bersama.
              </p>
            </div>
            <ul className="max-h-80 divide-y divide-slate-800/60 overflow-y-auto rounded-xl border border-slate-800">
              {dataNasional.map((d) => {
                const sudahAda = tanggalTerdaftar.has(d.tanggal);
                const id = `${idDasar}-${d.tanggal}`;
                return (
                  <li key={d.tanggal}>
                    <label
                      htmlFor={id}
                      className={`flex min-h-11 items-center gap-3 px-3 py-2 ${
                        sudahAda
                          ? "cursor-not-allowed opacity-60"
                          : "cursor-pointer hover:bg-white/[0.03]"
                      }`}
                    >
                      <input
                        id={id}
                        type="checkbox"
                        disabled={sudahAda}
                        checked={!sudahAda && dipilih.has(d.tanggal)}
                        onChange={(e) => centang(d.tanggal, e.target.checked)}
                        className="size-4 shrink-0 accent-sky-500"
                      />
                      <span className="w-32 shrink-0 text-xs text-slate-400">
                        {tanggalPanjang(d.tanggal)}
                      </span>
                      <span className="min-w-0 flex-1 text-sm text-white">
                        {d.nama_libur}
                        {d.jenis_libur === "Cuti Bersama" ? (
                          <span className="ml-2 text-xs text-amber-300">
                            cuti bersama
                          </span>
                        ) : null}
                      </span>
                      {sudahAda ? (
                        <span className="shrink-0 text-xs text-slate-400">
                          Sudah ada
                        </span>
                      ) : null}
                    </label>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {galat ? (
          <p
            role="alert"
            className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200"
          >
            {galat}
          </p>
        ) : null}

        <div className="flex flex-wrap items-center justify-end gap-3 pt-1">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="min-h-11 rounded-xl border border-slate-800 px-4 text-sm font-semibold text-slate-300 transition hover:bg-white/5"
          >
            Batal
          </button>
          <button
            type="button"
            data-konfirmasi
            onClick={simpan}
            disabled={saving || jumlahSimpan === 0}
            className="min-h-11 rounded-xl bg-sky-700 px-5 text-sm font-bold text-white transition hover:bg-sky-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300 disabled:opacity-50"
          >
            {saving
              ? "Menyimpan..."
              : jumlahSimpan === 0
                ? "Tidak ada tanggal baru"
                : `Simpan ${jumlahSimpan} tanggal`}
          </button>
        </div>
      </div>
    </Modal>
  );
}
