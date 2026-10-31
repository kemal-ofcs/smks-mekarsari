"use client";

import { useEffect, useMemo, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { PilihCari } from "@/components/ui/PilihCari";
import { saveFileWithPicker } from "@/lib/client/download";
import { saveWorkbook } from "@/lib/client/xlsx";
import { type BahanErapor, getBahanErapor } from "@/lib/gateways/grades";
import {
  adaPeringatan,
  PEMETAAN_BAWAAN,
  type PemetaanErapor,
  susunErapor,
  teksBertab,
} from "@/lib/validations/erapor";

/**
 * Ekspor nilai satu rombel × semester ke format e-Rapor (Fase N3): semua mapel
 * berpenilaian dalam satu berkas, judul kolom persis templat sekolah. Dipakai
 * `/nilai` Web/Desktop dan Mobile (disalin lewat `filesToCopy`).
 */

const KUNCI_PEMETAAN = "kos.erapor.pemetaan";
const TOMBOL =
  "min-h-11 rounded-lg border border-white/15 px-3 py-2 text-white text-sm disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500";
const TOMBOL_UTAMA =
  "min-h-11 rounded-lg bg-sky-600 px-3 py-2 text-white text-sm font-semibold disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500";
const ISIAN =
  "mt-1 w-full min-h-11 rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-white text-sm";
const LABEL = "block text-xs text-slate-400";
const GALAT =
  "rounded-lg border border-rose-500/30 bg-rose-500/20 p-3 text-rose-100 text-sm";

function bacaPemetaan(): PemetaanErapor {
  try {
    const tersimpan = JSON.parse(
      localStorage.getItem(KUNCI_PEMETAAN) ?? "null",
    );
    if (
      tersimpan &&
      typeof tersimpan.lm === "string" &&
      typeof tersimpan.sts === "string" &&
      typeof tersimpan.sas === "string"
    ) {
      return tersimpan;
    }
  } catch {
    // Penyimpanan peramban bisa diblokir atau berisi data lama; pemetaan
    // bawaan tetap benar untuk sekolah yang memakai jenis bawaan.
  }
  return PEMETAAN_BAWAAN;
}

function simpanPemetaan(pemetaan: PemetaanErapor) {
  try {
    localStorage.setItem(KUNCI_PEMETAAN, JSON.stringify(pemetaan));
  } catch {
    // Hanya kenyamanan per perangkat; ekspor tetap memakai pilihan di layar.
  }
}

/**
 * Pemetaan tersimpan bisa menunjuk jenis yang sudah dinonaktifkan; pilihan
 * itu tidak tampil di daftar, jadi layar dan berkas akan berbeda. Jatuh ke
 * pemetaan bawaan, lalu ke jenis aktif pertama.
 */
function pemetaanSah(
  pemetaan: PemetaanErapor,
  aktif: readonly string[],
): PemetaanErapor {
  const pilih = (kunci: keyof PemetaanErapor) =>
    aktif.includes(pemetaan[kunci])
      ? pemetaan[kunci]
      : aktif.includes(PEMETAAN_BAWAAN[kunci])
        ? PEMETAAN_BAWAAN[kunci]
        : (aktif[0] ?? "");
  return { lm: pilih("lm"), sts: pilih("sts"), sas: pilih("sas") };
}

function namaBerkas(bahan: BahanErapor, ekstensi: string): string {
  return `erapor-${bahan.rombel}-${bahan.tahun_ajaran}-${bahan.semester}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .concat(`.${ekstensi}`);
}

export function EksporErapor({
  idTahunAjaran,
  semester,
  idRombel,
}: {
  idTahunAjaran: string;
  semester: string;
  idRombel: string;
}) {
  const [buka, setBuka] = useState(false);
  const siap = Boolean(idTahunAjaran && idRombel);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        className={TOMBOL}
        disabled={!siap}
        onClick={() => setBuka(true)}
      >
        Ekspor e-Rapor
      </button>
      {!siap ? (
        <span className="text-xs text-slate-400">
          Pilih tahun ajaran dan rombel untuk mengekspor nilai ke format
          e-Rapor.
        </span>
      ) : null}
      {buka ? (
        <DialogErapor
          idTahunAjaran={idTahunAjaran}
          semester={semester}
          idRombel={idRombel}
          onClose={() => setBuka(false)}
        />
      ) : null}
    </div>
  );
}

function DialogErapor({
  idTahunAjaran,
  semester,
  idRombel,
  onClose,
}: {
  idTahunAjaran: string;
  semester: string;
  idRombel: string;
  onClose: () => void;
}) {
  const [bahan, setBahan] = useState<BahanErapor | null>(null);
  const [galat, setGalat] = useState<string | null>(null);
  const [pemetaan, setPemetaan] = useState<PemetaanErapor>(bacaPemetaan);
  const [idMapel, setIdMapel] = useState("");
  const [format, setFormat] = useState<"xlsx" | "txt">("xlsx");
  const [sibuk, setSibuk] = useState(false);
  const [kabar, setKabar] = useState<{ teks: string; galat: boolean } | null>(
    null,
  );

  useEffect(() => {
    getBahanErapor(idTahunAjaran, semester, idRombel)
      .then((hasil) => {
        setBahan(hasil);
        setPemetaan((lama) =>
          pemetaanSah(
            lama,
            hasil.jenis.filter((j) => j.is_aktif).map((j) => j.id_jenis),
          ),
        );
      })
      .catch((error) =>
        setGalat(
          error instanceof Error && error.message
            ? error.message
            : "Bahan ekspor e-Rapor tidak bisa disusun.",
        ),
      );
  }, [idTahunAjaran, semester, idRombel]);

  const berkas = useMemo(
    () => (bahan ? susunErapor(bahan, pemetaan, idMapel || null) : null),
    [bahan, pemetaan, idMapel],
  );

  function ubahPemetaan(kunci: keyof PemetaanErapor, nilai: string) {
    const baru = { ...pemetaan, [kunci]: nilai };
    setPemetaan(baru);
    simpanPemetaan(baru);
  }

  async function ekspor() {
    if (!bahan || !berkas) return;
    setSibuk(true);
    setKabar(null);
    try {
      const hasil =
        format === "xlsx"
          ? await saveWorkbook({
              headers: berkas.kolom,
              rows: berkas.baris.map((baris) =>
                Object.fromEntries(berkas.kolom.map((k, i) => [k, baris[i]])),
              ),
              filename: namaBerkas(bahan, "xlsx"),
              sheetName: "Nilai e-Rapor",
            })
          : await saveFileWithPicker(
              new Blob([teksBertab(berkas)], {
                type: "text/plain;charset=utf-8",
              }),
              namaBerkas(bahan, "txt"),
              {
                description: "Teks bertab (*.txt)",
                accept: { "text/plain": [".txt"] },
              },
            );
      setKabar(
        hasil.sukses
          ? { teks: "Berkas e-Rapor tersimpan.", galat: false }
          : hasil.cancelled
            ? null
            : { teks: "Berkas e-Rapor tidak bisa disimpan.", galat: true },
      );
    } catch (error) {
      setKabar({
        teks:
          error instanceof Error && error.message
            ? error.message
            : "Berkas e-Rapor tidak bisa dibuat.",
        galat: true,
      });
    } finally {
      setSibuk(false);
    }
  }

  const jenisAktif = bahan?.jenis.filter((j) => j.is_aktif) ?? [];
  const p = berkas?.peringatan;

  return (
    <Modal isOpen onClose={onClose} title="Ekspor nilai ke e-Rapor" hideFooter>
      <div className="space-y-4 text-sm text-slate-200">
        {galat ? (
          <p role="alert" className={GALAT}>
            {galat}
          </p>
        ) : !bahan || !berkas ? (
          <p className="text-slate-400">Menyusun bahan ekspor…</p>
        ) : (
          <>
            <p className="text-slate-300">
              Rombel {bahan.rombel}, {bahan.tahun_ajaran} semester{" "}
              {bahan.semester}. Rata Sumatif LM dan Nilai Akhir memakai bobot di
              Pengaturan Nilai, sama dengan tab Rekap Nilai.
            </p>
            <div className="grid gap-3 sm:grid-cols-3">
              {(
                [
                  ["lm", "Sumatif Lingkup Materi"],
                  ["sts", "Sumatif Tengah Semester"],
                  ["sas", "Sumatif Akhir Semester"],
                ] as const
              ).map(([kunci, label]) => (
                <div key={kunci}>
                  <label className={LABEL} htmlFor={`erapor-${kunci}`}>
                    {label}
                  </label>
                  <PilihCari
                    id={`erapor-${kunci}`}
                    className={ISIAN}
                    value={pemetaan[kunci]}
                    onChange={(e) => ubahPemetaan(kunci, e.target.value)}
                  >
                    {jenisAktif.map((j) => (
                      <option key={j.id_jenis} value={j.id_jenis}>
                        {j.nama}
                      </option>
                    ))}
                  </PilihCari>
                </div>
              ))}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className={LABEL} htmlFor="erapor-mapel">
                  Mata pelajaran
                </label>
                <PilihCari
                  id="erapor-mapel"
                  className={ISIAN}
                  value={idMapel}
                  onChange={(e) => setIdMapel(e.target.value)}
                >
                  <option value="">Semua mapel ({bahan.mapel.length})</option>
                  {bahan.mapel.map((m) => (
                    <option key={m.id_mapel} value={m.id_mapel}>
                      {m.nama_mapel}
                    </option>
                  ))}
                </PilihCari>
              </div>
              <div>
                <label className={LABEL} htmlFor="erapor-format">
                  Format berkas
                </label>
                <select
                  id="erapor-format"
                  className={ISIAN}
                  value={format}
                  onChange={(e) => setFormat(e.target.value as "xlsx" | "txt")}
                >
                  <option value="xlsx">Excel (.xlsx)</option>
                  <option value="txt">Teks bertab (.txt)</option>
                </select>
              </div>
            </div>
            <p className="text-slate-300">
              {berkas.baris.length} baris. Kolom Kode TP dikosongkan karena
              aplikasi belum menyimpan Tujuan Pembelajaran. Deskripsi capaian
              disusun dari nama penilaian Sumatif LM dengan skor tertinggi dan
              terendah, dan bisa disunting di berkasnya.
            </p>
            {p && adaPeringatan(p) ? (
              <div
                role="alert"
                className="rounded-lg border border-amber-500/30 bg-amber-500/20 p-3 text-amber-100 space-y-1"
              >
                <p className="font-semibold">
                  Periksa dulu sebelum mengekspor:
                </p>
                <ul className="list-disc pl-5 space-y-0.5">
                  {p.tanpaNisn > 0 ? (
                    <li>{p.tanpaNisn} siswa belum punya NISN.</li>
                  ) : null}
                  {p.skorKosong > 0 ? (
                    <li>
                      {p.skorKosong} skor Sumatif LM, STS, atau SAS belum diisi
                      (selnya dikosongkan).
                    </li>
                  ) : null}
                  {p.tanpaSts.length > 0 ? (
                    <li>Belum ada STS: {p.tanpaSts.join(", ")}.</li>
                  ) : null}
                  {p.tanpaSas.length > 0 ? (
                    <li>Belum ada SAS: {p.tanpaSas.join(", ")}.</li>
                  ) : null}
                  {p.lebihTigaLm.length > 0 ? (
                    <li>
                      Lebih dari 3 Sumatif LM, kolomnya ditambah:{" "}
                      {p.lebihTigaLm.join(", ")}.
                    </li>
                  ) : null}
                </ul>
              </div>
            ) : null}
            {kabar ? (
              <output
                aria-live="polite"
                className={
                  kabar.galat ? "block text-rose-300" : "block text-emerald-300"
                }
              >
                {kabar.teks}
              </output>
            ) : null}
            <div className="flex flex-wrap justify-end gap-2">
              <button type="button" className={TOMBOL} onClick={onClose}>
                {p && adaPeringatan(p) ? "Jangan ekspor" : "Tutup"}
              </button>
              <button
                type="button"
                className={TOMBOL_UTAMA}
                disabled={sibuk || berkas.baris.length === 0}
                onClick={() => void ekspor()}
              >
                {sibuk
                  ? "Menyimpan…"
                  : p && adaPeringatan(p)
                    ? "Ya, lanjutkan"
                    : "Ekspor"}
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
