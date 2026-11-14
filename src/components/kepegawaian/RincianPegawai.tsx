"use client";

import {
  type FormEvent,
  type HTMLAttributes,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { Modal } from "@/components/ui/Modal";
import { hasPermission } from "@/lib/auth/access";
import { useAuth } from "@/lib/context/AuthContext";
import {
  type DaftarKontrak,
  muatKontrak,
  muatProfilPegawai,
  type OrgKepegawaian,
  type PegawaiKepegawaian,
  type ProfilPegawai,
  simpanDataKeuangan,
  simpanDataPribadi,
} from "@/lib/gateways/hris";
import { AGAMA, STATUS_NIKAH } from "@/lib/validations/hris";
import { CutiPegawai } from "./CutiPegawai";
import { DokumenPegawai } from "./DokumenPegawai";
import {
  INPUT,
  LABEL,
  masaKerja,
  pesanGalat,
  TOMBOL,
  TOMBOL_UTAMA,
} from "./gaya";
import { PendidikPegawai } from "./PendidikPegawai";

type TabRincian =
  | "kerja"
  | "pribadi"
  | "keuangan"
  | "pendidik"
  | "kontrak"
  | "cuti"
  | "dokumen";

interface Isian {
  kunci: string;
  label: string;
  jenis?: "date" | "area" | "pilih";
  pilihan?: readonly string[];
  inputMode?: HTMLAttributes<HTMLInputElement>["inputMode"];
}

const ISIAN_PRIBADI: Isian[] = [
  { kunci: "nik", label: "NIK", inputMode: "numeric" },
  { kunci: "no_kk", label: "Nomor KK", inputMode: "numeric" },
  { kunci: "tempat_lahir", label: "Tempat lahir" },
  { kunci: "tanggal_lahir", label: "Tanggal lahir", jenis: "date" },
  { kunci: "agama", label: "Agama", jenis: "pilih", pilihan: AGAMA },
  {
    kunci: "status_nikah",
    label: "Status pernikahan",
    jenis: "pilih",
    pilihan: STATUS_NIKAH,
  },
  { kunci: "nama_ibu_kandung", label: "Nama ibu kandung" },
  { kunci: "alamat_ktp", label: "Alamat sesuai KTP", jenis: "area" },
  { kunci: "alamat_domisili", label: "Alamat domisili", jenis: "area" },
  { kunci: "darurat_nama", label: "Nama kontak darurat" },
  { kunci: "darurat_hubungan", label: "Hubungan kontak darurat" },
  { kunci: "darurat_hp", label: "HP kontak darurat", inputMode: "tel" },
];

const ISIAN_KEUANGAN: Isian[] = [
  { kunci: "bank", label: "Nama bank" },
  { kunci: "no_rekening", label: "Nomor rekening", inputMode: "numeric" },
  { kunci: "nama_rekening", label: "Nama pemilik rekening" },
  { kunci: "npwp", label: "NPWP", inputMode: "numeric" },
  {
    kunci: "bpjs_kesehatan",
    label: "Nomor BPJS Kesehatan",
    inputMode: "numeric",
  },
  {
    kunci: "bpjs_ketenagakerjaan",
    label: "Nomor BPJS Ketenagakerjaan",
    inputMode: "numeric",
  },
];

/**
 * Rincian satu pegawai (HRIS 1c). Kerja dan Kontrak dibaca dari data yang
 * tersinkron; Pribadi, Keuangan, Pendidik, dan Dokumen cloud-only, jadi
 * tab-tab itu menampilkan pesan bila koneksi ke database tidak ada. Tab tanpa
 * izin tidak ditampilkan; backend memeriksa ulang dari sesi.
 */
export function RincianPegawai({
  pegawai,
  org,
  hariIni,
  onClose,
  onCetakKeterangan,
}: {
  pegawai: PegawaiKepegawaian;
  org: OrgKepegawaian;
  hariIni: string;
  onClose: () => void;
  /** Surat Keterangan Aktif; hanya bila sesi memegang `hr.duty.manage` (§21.5). */
  onCetakKeterangan?: () => void;
}) {
  const { user } = useAuth();
  const boleh = (izin: Parameters<typeof hasPermission>[1]) =>
    hasPermission(user, izin);
  const daftarTab: { kunci: TabRincian; label: string }[] = [
    { kunci: "kerja", label: "Kerja" },
    ...(boleh("hr.personal.view")
      ? [{ kunci: "pribadi" as const, label: "Pribadi" }]
      : []),
    ...(boleh("hr.finance.view")
      ? [{ kunci: "keuangan" as const, label: "Keuangan" }]
      : []),
    ...(boleh("teachers.view")
      ? [{ kunci: "pendidik" as const, label: "Pendidik" }]
      : []),
    { kunci: "kontrak", label: "Kontrak" },
    ...(boleh("hr.request.view")
      ? [{ kunci: "cuti" as const, label: "Cuti" }]
      : []),
    ...(boleh("hr.document.view")
      ? [{ kunci: "dokumen" as const, label: "Dokumen" }]
      : []),
  ];
  const [tab, setTab] = useState<TabRincian>("kerja");
  const [profil, setProfil] = useState<ProfilPegawai | null>(null);
  const [galatProfil, setGalatProfil] = useState<string | null>(null);
  const id = pegawai.id_unik;

  const muatProfil = useCallback(async () => {
    try {
      setProfil(await muatProfilPegawai(id));
      setGalatProfil(null);
    } catch (error) {
      setGalatProfil(pesanGalat(error));
    }
  }, [id]);

  const butuhProfil =
    tab === "pribadi" || tab === "keuangan" || tab === "pendidik";
  useEffect(() => {
    if (butuhProfil && !profil && !galatProfil) void muatProfil();
  }, [butuhProfil, profil, galatProfil, muatProfil]);

  const panelProfil = () => {
    if (galatProfil) {
      return (
        <div className="space-y-3">
          <p className="text-sm text-rose-300" role="alert">
            {galatProfil}
          </p>
          <button
            type="button"
            className={TOMBOL}
            onClick={() => setGalatProfil(null)}
          >
            Coba lagi
          </button>
        </div>
      );
    }
    if (!profil) return <p className="text-sm text-slate-400">Memuat…</p>;
    if (tab === "pribadi") {
      return (
        <FormProfil
          awalan="pribadi"
          isian={ISIAN_PRIBADI}
          awal={profil.pribadi ?? null}
          bolehUbah={boleh("hr.personal.manage")}
          onSimpan={async (nilai) => {
            await simpanDataPribadi({ id_karyawan: id, ...nilai });
            await muatProfil();
          }}
        />
      );
    }
    if (tab === "keuangan") {
      return (
        <FormProfil
          awalan="keuangan"
          isian={ISIAN_KEUANGAN}
          awal={profil.keuangan ?? null}
          bolehUbah={boleh("hr.finance.manage")}
          onSimpan={async (nilai) => {
            await simpanDataKeuangan({ id_karyawan: id, ...nilai });
            await muatProfil();
          }}
        />
      );
    }
    return (
      <PendidikPegawai
        idKaryawan={id}
        pendidik={profil.pendidik ?? { pendidikan: [], sertifikasi: [] }}
        bolehUbah={boleh("teachers.manage")}
        onBerubah={muatProfil}
      />
    );
  };

  return (
    <Modal
      title={pegawai.nama}
      onClose={onClose}
      hideFooter
      maxWidth="max-w-3xl"
    >
      <div className="space-y-4">
        <div
          role="tablist"
          aria-label="Bagian rincian pegawai"
          className="flex flex-wrap gap-2"
        >
          {daftarTab.map(({ kunci, label }) => (
            <button
              key={kunci}
              id={`tab-rincian-${kunci}`}
              role="tab"
              type="button"
              aria-selected={tab === kunci}
              aria-controls="panel-rincian"
              onClick={() => setTab(kunci)}
              className={`min-h-10 rounded-xl px-3 text-sm font-semibold ${
                tab === kunci
                  ? "bg-sky-500 text-slate-950"
                  : "text-slate-300 hover:bg-slate-800"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <div
          id="panel-rincian"
          role="tabpanel"
          aria-labelledby={`tab-rincian-${tab}`}
        >
          {tab === "kerja" ? (
            <Kerja pegawai={pegawai} org={org} hariIni={hariIni} />
          ) : tab === "kontrak" ? (
            <Kontrak idKaryawan={id} />
          ) : tab === "cuti" ? (
            <CutiPegawai
              idKaryawan={id}
              bolehSesuaikan={boleh("hr.leave.adjust")}
            />
          ) : tab === "dokumen" ? (
            <DokumenPegawai
              idKaryawan={id}
              bolehUbah={boleh("hr.document.manage")}
            />
          ) : (
            panelProfil()
          )}
        </div>
        {onCetakKeterangan ? (
          <div className="flex justify-end border-t border-white/10 pt-3">
            <button
              type="button"
              className={TOMBOL}
              onClick={onCetakKeterangan}
            >
              Cetak Surat Keterangan Aktif
            </button>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}

function Kerja({
  pegawai: p,
  org,
  hariIni,
}: {
  pegawai: PegawaiKepegawaian;
  org: OrgKepegawaian;
  hariIni: string;
}) {
  const atasan = org.pegawai.find((x) => x.id_unik === p.id_atasan)?.nama;
  const baris: [string, string][] = [
    ["Kelompok", p.kelompok],
    ["Kode", p.kode_karyawan || "-"],
    ["Unit", p.unit || "-"],
    ["Bagian", p.divisi || "-"],
    ["Jabatan", p.jabatan_status || "-"],
    ["Atasan langsung", atasan ?? "-"],
    ["Status kepegawaian", p.status_kepegawaian || "-"],
    ["TMT", p.tmt || "-"],
    ["Masa kerja", masaKerja(p.tmt, hariIni)],
    ["Status aktif", p.status_aktif],
  ];
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
      {baris.map(([label, nilai]) => (
        <div key={label}>
          <dt className="text-xs text-slate-400">{label}</dt>
          <dd className="text-white">{nilai}</dd>
        </div>
      ))}
    </dl>
  );
}

function Kontrak({ idKaryawan }: { idKaryawan: string }) {
  const [data, setData] = useState<DaftarKontrak | null>(null);
  const [galat, setGalat] = useState<string | null>(null);

  useEffect(() => {
    muatKontrak()
      .then(setData)
      .catch((error: unknown) => setGalat(pesanGalat(error)));
  }, []);

  if (galat) {
    return (
      <p className="text-sm text-rose-300" role="alert">
        {galat}
      </p>
    );
  }
  if (!data) return <p className="text-sm text-slate-400">Memuat…</p>;
  const ringkas = data.ringkas.find((r) => r.id_karyawan === idKaryawan);
  const milik = data.kontrak.filter(
    (k) => k.id_karyawan === idKaryawan && k.status !== "Pembatalan",
  );
  const batal = new Set(data.dibatalkan);
  return (
    <div className="space-y-3 text-sm">
      <p className="text-slate-300">
        {ringkas && ringkas.keadaan !== "Tanpa kontrak"
          ? `${ringkas.status} · ${ringkas.keadaan}${ringkas.sampai ? ` sampai ${ringkas.sampai}` : ""}`
          : "Belum ada kontrak."}
      </p>
      <ul className="space-y-2">
        {milik.map((k) => (
          <li
            key={k.id_kontrak}
            className="rounded-xl border border-white/10 bg-slate-950 px-3 py-2"
          >
            <span className="font-semibold text-white">{k.status}</span>
            <span className="text-slate-400">
              {" "}
              · {k.tanggal_mulai}
              {k.tanggal_selesai ? ` s.d. ${k.tanggal_selesai}` : ""}
              {k.nomor ? ` · ${k.nomor}` : ""}
              {batal.has(k.id_kontrak) ? " · dibatalkan" : ""}
            </span>
          </li>
        ))}
      </ul>
      <p className="text-xs text-slate-400">
        Kontrak baru dan pembatalan dicatat di tab Kontrak.
      </p>
    </div>
  );
}

function FormProfil({
  awalan,
  isian,
  awal,
  bolehUbah,
  onSimpan,
}: {
  awalan: string;
  isian: Isian[];
  awal: object | null;
  bolehUbah: boolean;
  onSimpan: (nilai: Record<string, string>) => Promise<void>;
}) {
  const lama = awal as Record<string, unknown> | null;
  const [nilai, setNilai] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      isian.map((i) => [i.kunci, String(lama?.[i.kunci] ?? "")]),
    ),
  );
  const [kabar, setKabar] = useState<string | null>(null);
  const [galat, setGalat] = useState<string | null>(null);
  const isSubmittingRef = useRef(false);
  const [menyimpan, setMenyimpan] = useState(false);

  const kirim = async (event: FormEvent) => {
    event.preventDefault();
    if (isSubmittingRef.current) return;
    isSubmittingRef.current = true;
    setMenyimpan(true);
    setKabar(null);
    setGalat(null);
    try {
      await onSimpan(nilai);
      setKabar("Tersimpan.");
    } catch (error) {
      setGalat(pesanGalat(error));
    } finally {
      isSubmittingRef.current = false;
      setMenyimpan(false);
    }
  };

  const jejak = lama?.diubah_pada
    ? `Terakhir diubah ${String(lama.diubah_pada)} oleh ${String(lama.diubah_oleh || "-")}.`
    : "Belum pernah diisi.";

  return (
    <form className="space-y-4" onSubmit={kirim}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {isian.map((i) => {
          const idKontrol = `${awalan}-${i.kunci}`;
          const umum = {
            disabled: !bolehUbah,
            value: nilai[i.kunci] ?? "",
            className: INPUT,
          };
          const ubah = (v: string) => setNilai((n) => ({ ...n, [i.kunci]: v }));
          return (
            <div
              key={i.kunci}
              className={i.jenis === "area" ? "sm:col-span-2" : ""}
            >
              <label htmlFor={idKontrol} className={LABEL}>
                {i.label}
              </label>
              {i.jenis === "pilih" ? (
                <select
                  id={idKontrol}
                  {...umum}
                  onChange={(e) => ubah(e.target.value)}
                >
                  <option value="">-</option>
                  {i.pilihan?.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              ) : i.jenis === "area" ? (
                <textarea
                  id={idKontrol}
                  {...umum}
                  rows={2}
                  maxLength={500}
                  className={`${INPUT} py-2`}
                  onChange={(e) => ubah(e.target.value)}
                />
              ) : (
                <input
                  id={idKontrol}
                  {...umum}
                  type={i.jenis === "date" ? "date" : "text"}
                  inputMode={i.inputMode}
                  maxLength={100}
                  onChange={(e) => ubah(e.target.value)}
                />
              )}
            </div>
          );
        })}
      </div>
      <p className="text-xs text-slate-400">
        {jejak} Tanda baca dan spasi pada nomor dibuang saat disimpan.
      </p>
      {kabar ? (
        <output className="block text-sm text-emerald-300">{kabar}</output>
      ) : null}
      {galat ? (
        <p className="text-sm text-rose-300" role="alert">
          {galat}
        </p>
      ) : null}
      {bolehUbah ? (
        <div className="flex justify-end">
          <button type="submit" className={TOMBOL_UTAMA} disabled={menyimpan}>
            Simpan
          </button>
        </div>
      ) : null}
    </form>
  );
}
