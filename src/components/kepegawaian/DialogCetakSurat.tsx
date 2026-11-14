"use client";

import { type FormEvent, useEffect, useRef, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import {
  type DaftarTugas,
  type KontrakBaris,
  muatBebanMengajar,
  muatSetupSurat,
  simpanTugas,
  type TugasBaris,
} from "@/lib/gateways/hris";
import {
  type DataBeban,
  type JenisSurat,
  type RekapBeban,
  type SetupSurat,
  susunBebanMengajar,
} from "@/lib/validations/hr-beban";
import type { PengajuanTersusun } from "@/lib/validations/hr-pengajuan";
import { INPUT, LABEL, pesanGalat, TOMBOL, TOMBOL_UTAMA } from "./gaya";
import {
  cetakSurat,
  type DasarCetak,
  identitas,
  KODE_SURAT,
  NAMA_SURAT,
  nomorSurat,
  polaSurat,
  suratKeteranganAktif,
  suratPembagianTugas,
  suratPengangkatan,
  suratTugasLuar,
  suratTugasTambahan,
  type TugasSk,
  unitSkTugas,
} from "./suratKepegawaian";

/**
 * Satu dialog cetak untuk kelima surat HRIS Fase 3b (§21.5): tanggal (bawaan
 * hari ini WIB), nomor dari pola + nomor urut buku agenda (Q-59), isian
 * tujuan/penyelenggara untuk Surat Tugas. Bahan dimuat ulang tiap tanggal
 * berubah karena kepala unit bergantung pada tanggal surat.
 */
export interface PermintaanSurat {
  jenis: JenisSurat;
  /** Baris kedua judul dialog (nama pegawai, unit, dan sebagainya). */
  keterangan: string;
  /** Nilai token `{unit}`. */
  unit: (setup: SetupSurat) => string;
  nomorAwal?: string;
  tanggalAwal?: string;
  rakit: (
    d: DasarCetak,
    isian: { tujuan: string; penyelenggara: string },
  ) => string;
  /** Hanya SK tugas tambahan: nomor dan tanggal SK disimpan ke barisnya. */
  simpanNomor?: (nomor: string, tanggal: string) => Promise<void>;
}

const TANGGAL = /^\d{4}-\d{2}-\d{2}$/;

export function DialogCetakSurat({
  permintaan,
  onClose,
}: {
  permintaan: PermintaanSurat;
  onClose: () => void;
}) {
  const permintaanRef = useRef(permintaan);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    permintaanRef.current = permintaan;
    onCloseRef.current = onClose;
  });
  const [tanggal, setTanggal] = useState(permintaan.tanggalAwal ?? "");
  const [setup, setSetup] = useState<SetupSurat | null>(null);
  const [galat, setGalat] = useState<string | null>(null);
  const [urut, setUrut] = useState("");
  const [nomor, setNomor] = useState(permintaan.nomorAwal ?? "");
  const [tujuan, setTujuan] = useState("");
  const [penyelenggara, setPenyelenggara] = useState("");
  const isSubmittingRef = useRef(false);
  const [menyimpan, setMenyimpan] = useState(false);
  const jenis = permintaan.jenis;

  useEffect(() => {
    if (tanggal !== "" && !TANGGAL.test(tanggal)) return;
    let berlaku = true;
    muatSetupSurat(tanggal)
      .then((hasil) => {
        if (!berlaku) return;
        setSetup(hasil);
        setGalat(null);
        if (tanggal === "") setTanggal(hasil.tanggal);
      })
      .catch((error: unknown) => {
        if (berlaku) setGalat(pesanGalat(error));
      });
    return () => {
      berlaku = false;
    };
  }, [tanggal]);

  const hitungNomor = (urutBaru: string, tanggalBaru: string) => {
    if (!setup || urutBaru.trim() === "") return;
    const hasil = nomorSurat(polaSurat(setup, jenis), {
      urut: urutBaru,
      kode: KODE_SURAT[jenis],
      unit: permintaanRef.current.unit(setup),
      tanggal: tanggalBaru,
    });
    if (hasil.ok) setNomor(hasil.nilai);
    else setGalat(hasil.galat);
  };

  const siap = setup !== null && setup.tanggal === tanggal;

  const cetak = async (event: FormEvent) => {
    event.preventDefault();
    if (!setup || !siap || isSubmittingRef.current) return;
    const nomorAkhir = nomor.trim();
    if (nomorAkhir === "") {
      setGalat("Isi nomor surat.");
      return;
    }
    isSubmittingRef.current = true;
    setMenyimpan(true);
    try {
      const p = permintaanRef.current;
      if (
        p.simpanNomor &&
        (nomorAkhir !== (p.nomorAwal ?? "") ||
          tanggal !== (p.tanggalAwal ?? ""))
      )
        await p.simpanNomor(nomorAkhir, tanggal);
      cetakSurat(
        p.rakit(
          { setup, nomor: nomorAkhir, tanggal },
          { tujuan, penyelenggara },
        ),
      );
      onCloseRef.current();
    } catch (error) {
      setGalat(pesanGalat(error));
    } finally {
      isSubmittingRef.current = false;
      setMenyimpan(false);
    }
  };

  return (
    <Modal
      title={`Cetak ${NAMA_SURAT[jenis]}`}
      subtitle={permintaan.keterangan}
      titleId="judul-cetak-surat"
      onClose={onClose}
      hideFooter
    >
      <form data-tanpa-konfirmasi onSubmit={cetak} className="space-y-4">
        <div>
          <label htmlFor="surat-tanggal" className={LABEL}>
            Tanggal surat
          </label>
          <input
            id="surat-tanggal"
            type="date"
            required
            value={tanggal}
            onChange={(e) => {
              setTanggal(e.target.value);
              hitungNomor(urut, e.target.value);
            }}
            className={INPUT}
          />
        </div>
        <div>
          <label htmlFor="surat-urut" className={LABEL}>
            Nomor urut dari buku agenda surat keluar
          </label>
          <input
            id="surat-urut"
            inputMode="numeric"
            value={urut}
            disabled={!setup}
            onChange={(e) => {
              setUrut(e.target.value);
              hitungNomor(e.target.value, tanggal);
            }}
            className={INPUT}
          />
        </div>
        <div>
          <label htmlFor="surat-nomor" className={LABEL}>
            Nomor surat
          </label>
          <input
            id="surat-nomor"
            required
            maxLength={200}
            value={nomor}
            onChange={(e) => setNomor(e.target.value)}
            className={INPUT}
            aria-describedby="surat-nomor-catatan"
          />
          <p id="surat-nomor-catatan" className="mt-1 text-xs text-slate-400">
            Terisi dari pola di Pengaturan surat dan boleh diubah.{" "}
            {permintaan.simpanNomor
              ? "Nomor dan tanggal ini disimpan ke tugas tambahannya."
              : "Nomor ini tidak disimpan aplikasi; catat di buku agenda."}
          </p>
        </div>
        {jenis === "tugas_luar" ? (
          <>
            <div>
              <label htmlFor="surat-tujuan" className={LABEL}>
                Tempat tujuan
              </label>
              <input
                id="surat-tujuan"
                maxLength={200}
                value={tujuan}
                onChange={(e) => setTujuan(e.target.value)}
                className={INPUT}
              />
            </div>
            <div>
              <label htmlFor="surat-penyelenggara" className={LABEL}>
                Penyelenggara
              </label>
              <input
                id="surat-penyelenggara"
                maxLength={200}
                value={penyelenggara}
                onChange={(e) => setPenyelenggara(e.target.value)}
                className={INPUT}
              />
            </div>
          </>
        ) : null}
        {galat ? (
          <p className="text-sm text-rose-300" role="alert">
            {galat}
          </p>
        ) : null}
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className={TOMBOL} onClick={onClose}>
            Tutup
          </button>
          <button
            type="submit"
            className={TOMBOL_UTAMA}
            disabled={!siap || menyimpan}
          >
            {menyimpan ? "Menyiapkan…" : siap ? "Cetak" : "Memuat…"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ── Pembangun permintaan per sumber data ────────────────────────────────────

export function permintaanPembagianTugas(
  data: DataBeban,
  rekap: readonly RekapBeban[],
  unit: string,
): PermintaanSurat {
  const semester = data.semester.find(
    (s) => s.id_tahun_ajaran === data.id_tahun_ajaran,
  ) ?? {
    id_tahun_ajaran: "",
    nama_tahun: "",
    semester: "",
    tanggal_mulai: "",
    tanggal_selesai: "",
    is_aktif: 0,
  };
  return {
    jenis: "ptm",
    keterangan: `${unit || "Semua unit"} · ${semester.nama_tahun} ${semester.semester}`,
    unit: () => unit,
    rakit: (d) => suratPembagianTugas(d, { unit, semester, rekap }),
  };
}

/** Satu baris, atau satu jenis satu tahun ajaran dalam satu SK. */
export function permintaanTugasTambahan(
  baris: readonly TugasBaris[],
  daftar: DaftarTugas,
  namaPegawai: ReadonlyMap<string, string>,
): PermintaanSurat {
  const jenis = new Map(daftar.jenis.map((j) => [j.id_jenis, j]));
  const rombel = new Map(
    daftar.wali_kelas.map((w) => [w.id_rombel, w.nama_rombel]),
  );
  const sk: TugasSk[] = baris.map((t) => ({
    id_karyawan: t.id_karyawan,
    nama_jenis: jenis.get(t.id_jenis)?.nama ?? t.id_jenis,
    unit: t.unit,
    nama_rombel: t.id_rombel ? (rombel.get(t.id_rombel) ?? "") : "",
    ekuivalen_jp: t.ekuivalen_jp ?? jenis.get(t.id_jenis)?.ekuivalen_jp ?? 0,
    tahun_ajaran: t.tahun_ajaran,
    tanggal_mulai: t.tanggal_mulai,
    tanggal_selesai: t.tanggal_selesai,
  }));
  const sama = (kunci: "nomor_sk" | "tanggal_sk") =>
    new Set(baris.map((t) => t[kunci])).size === 1 ? baris[0][kunci] : "";
  return {
    jenis: "tugas",
    keterangan:
      baris.length === 1
        ? `${namaPegawai.get(baris[0].id_karyawan) ?? baris[0].id_karyawan} · ${sk[0].nama_jenis}`
        : `${baris.length} tugas · ${[...new Set(sk.map((t) => t.nama_jenis))].join(", ")}`,
    unit: () => unitSkTugas(sk),
    nomorAwal: sama("nomor_sk"),
    tanggalAwal: sama("tanggal_sk"),
    rakit: (d) => suratTugasTambahan(d, sk),
    simpanNomor: async (nomor, tanggal) => {
      for (const t of baris) {
        if (t.nomor_sk === nomor && t.tanggal_sk === tanggal) continue;
        await simpanTugas({
          id: t.id_tugas,
          id_karyawan: t.id_karyawan,
          id_jenis: t.id_jenis,
          unit: t.unit,
          tahun_ajaran: t.tahun_ajaran,
          id_rombel: t.id_rombel,
          nomor_sk: nomor,
          tanggal_sk: tanggal,
          ekuivalen_jp: t.ekuivalen_jp,
          tanggal_mulai: t.tanggal_mulai,
          tanggal_selesai: t.tanggal_selesai,
        });
      }
    },
  };
}

export function permintaanPengangkatan(
  k: KontrakBaris,
  nama: string,
): PermintaanSurat {
  return {
    jenis: "angkat",
    keterangan: `${nama} · ${k.status}`,
    unit: (s) => identitas(s, k.id_karyawan).unit,
    nomorAwal: k.nomor,
    rakit: (d) =>
      suratPengangkatan(d, {
        id_karyawan: k.id_karyawan,
        status: k.status,
        tmt: k.tanggal_mulai,
      }),
  };
}

export function permintaanTugasLuar(p: PengajuanTersusun): PermintaanSurat {
  return {
    jenis: "tugas_luar",
    keterangan: `${p.nama} · ${p.nama_jenis}`,
    unit: (s) => identitas(s, p.id_karyawan).unit || p.unit,
    rakit: (d, isian) =>
      suratTugasLuar(d, {
        id_karyawan: p.id_karyawan,
        tanggal_mulai: p.tanggal_mulai,
        tanggal_selesai: p.tanggal_selesai,
        keperluan: p.alasan,
        ...isian,
      }),
  };
}

export function permintaanKeteranganAktif(
  idKaryawan: string,
  nama: string,
  mapel: readonly string[],
): PermintaanSurat {
  return {
    jenis: "aktif",
    keterangan: nama,
    unit: (s) => identitas(s, idKaryawan).unit,
    rakit: (d) => suratKeteranganAktif(d, { id_karyawan: idKaryawan, mapel }),
  };
}

/**
 * Mapel guru di semester aktif dari rekap beban ("Matematika (7A, 7B)"),
 * untuk Surat Keterangan Aktif Mengajar. Butuh `teachers.view`.
 */
export async function mapelSemesterAktif(
  idKaryawan: string,
): Promise<string[]> {
  const rekap = susunBebanMengajar(await muatBebanMengajar(""), null).find(
    (r) => r.id_unik === idKaryawan,
  );
  const per = new Map<string, string[]>();
  for (const m of rekap?.mapel ?? []) {
    per.set(m.nama_mapel, [...(per.get(m.nama_mapel) ?? []), m.nama_rombel]);
  }
  return [...per].map(([mapel, rombel]) => `${mapel} (${rombel.join(", ")})`);
}
