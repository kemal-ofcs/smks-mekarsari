"use client";

import { useEffect, useState } from "react";
import { PilihCari } from "@/components/ui/PilihCari";
import { formatTanggalOperasional } from "@/lib/attendance/time-policy";
import { hasPermission } from "@/lib/auth/access";
import { useAuth } from "@/lib/context/AuthContext";
import { muatPengajuan } from "@/lib/gateways/hr-pengajuan";
import {
  type DaftarKontrak,
  type DaftarTugas,
  muatBebanMengajar,
  muatKontrak,
  muatTugas,
  type OrgKepegawaian,
} from "@/lib/gateways/hris";
import {
  type DataBeban,
  daftarUnitBeban,
  dalamUnitBeban,
  type JenisSurat,
  susunBebanMengajar,
} from "@/lib/validations/hr-beban";
import {
  type PengajuanTersusun,
  statusBerlaku,
} from "@/lib/validations/hr-pengajuan";
import { kontrakSah } from "@/lib/validations/hris";
import {
  DialogCetakSurat,
  mapelSemesterAktif,
  type PermintaanSurat,
  permintaanKeteranganAktif,
  permintaanPembagianTugas,
  permintaanPengangkatan,
  permintaanTugasLuar,
  permintaanTugasTambahan,
} from "./DialogCetakSurat";
import { INPUT, LABEL, pesanGalat, TOMBOL_UTAMA } from "./gaya";
import { NAMA_SURAT } from "./suratKepegawaian";

const tgl = (t: string) => (t ? formatTanggalOperasional(t) : "-");

type Sumber =
  | { jenis: "ptm"; data: DataBeban }
  | { jenis: "tugas"; data: DaftarTugas }
  | { jenis: "angkat"; data: DaftarKontrak }
  | { jenis: "tugas_luar"; data: PengajuanTersusun[] }
  | { jenis: "aktif" };

/**
 * Tab "Surat" (§21.5 butir 2, `hr.duty.manage`): pilih jenis, lalu
 * semester/tugas/kontrak/pengajuan/pegawai, lalu dialog cetak yang sama
 * dengan tombol cetak di tab lain. Jenis yang data sumbernya tidak boleh
 * dibaca sesi ini tidak ditawarkan.
 */
export function TabSurat({
  org,
  onGalat,
}: {
  org: OrgKepegawaian;
  onGalat: (pesan: string) => void;
}) {
  const { user } = useAuth();
  const bolehGuru = hasPermission(user, "teachers.view");
  const jenisBoleh: JenisSurat[] = [
    ...(bolehGuru ? (["ptm"] as const) : []),
    "tugas",
    "angkat",
    ...(hasPermission(user, "hr.request.view")
      ? (["tugas_luar"] as const)
      : []),
    "aktif",
  ];
  const [jenis, setJenis] = useState<JenisSurat>(jenisBoleh[0]);
  const [sumber, setSumber] = useState<Sumber | null>(null);
  const [pilihan, setPilihan] = useState("");
  const [pilihanDua, setPilihanDua] = useState("");
  const [permintaan, setPermintaan] = useState<PermintaanSurat | null>(null);
  const [menyiapkan, setMenyiapkan] = useState(false);

  useEffect(() => {
    let berlaku = true;
    setSumber(null);
    setPilihan("");
    setPilihanDua("");
    const muat = async (): Promise<Sumber> => {
      if (jenis === "ptm") return { jenis, data: await muatBebanMengajar("") };
      if (jenis === "tugas") return { jenis, data: await muatTugas() };
      if (jenis === "angkat") return { jenis, data: await muatKontrak() };
      if (jenis === "tugas_luar") {
        const tahun = formatTanggalOperasional(Date.now()).slice(0, 4);
        const daftar = await muatPengajuan(`${tahun}-01-01`, `${tahun}-12-31`);
        return {
          jenis,
          data: daftar.pengajuan.filter(
            (p) => p.kelompok === "Dinas Luar" && statusBerlaku(p.status),
          ),
        };
      }
      return { jenis: "aktif" };
    };
    muat()
      .then((hasil) => {
        if (berlaku) setSumber(hasil);
      })
      .catch((error: unknown) => {
        if (berlaku) onGalat(pesanGalat(error));
      });
    return () => {
      berlaku = false;
    };
  }, [jenis, onGalat]);

  const nama = new Map(org.pegawai.map((p) => [p.id_unik, p.nama]));

  const siapkan = async () => {
    if (!sumber || menyiapkan) return;
    setMenyiapkan(true);
    try {
      if (sumber.jenis === "ptm") {
        const rekap = susunBebanMengajar(sumber.data, null).filter((r) =>
          dalamUnitBeban(r, pilihan),
        );
        setPermintaan(permintaanPembagianTugas(sumber.data, rekap, pilihan));
      } else if (sumber.jenis === "tugas") {
        const baris = sumber.data.tugas.filter(
          (t) =>
            t.status !== "Dibatalkan" &&
            t.tahun_ajaran === pilihan &&
            t.id_jenis === pilihanDua,
        );
        if (baris.length === 0) {
          onGalat("Tidak ada tugas jenis itu di tahun ajaran ini.");
          return;
        }
        setPermintaan(permintaanTugasTambahan(baris, sumber.data, nama));
      } else if (sumber.jenis === "angkat") {
        const k = sumber.data.kontrak.find((x) => x.id_kontrak === pilihan);
        if (k)
          setPermintaan(
            permintaanPengangkatan(k, nama.get(k.id_karyawan) ?? ""),
          );
      } else if (sumber.jenis === "tugas_luar") {
        const p = sumber.data.find((x) => x.id_pengajuan === pilihan);
        if (p) setPermintaan(permintaanTugasLuar(p));
      } else {
        const p = org.pegawai.find((x) => x.id_unik === pilihan);
        if (!p) return;
        const mapel =
          p.kelompok === "Guru" && bolehGuru
            ? await mapelSemesterAktif(p.id_unik)
            : [];
        setPermintaan(permintaanKeteranganAktif(p.id_unik, p.nama, mapel));
      }
    } catch (error) {
      onGalat(pesanGalat(error));
    } finally {
      setMenyiapkan(false);
    }
  };

  const pilih = (
    id: string,
    label: string,
    nilai: string,
    ubah: (v: string) => void,
    opsi: { value: string; label: string }[],
    kosong: string,
  ) => (
    <div>
      <label htmlFor={id} className={LABEL}>
        {label}
      </label>
      <PilihCari
        id={id}
        value={nilai}
        onChange={(e) => ubah(e.target.value)}
        className={INPUT}
      >
        <option value="">{kosong}</option>
        {opsi.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </PilihCari>
    </div>
  );

  const isian = () => {
    if (!sumber) return <p className="text-sm text-slate-400">Memuat…</p>;
    if (sumber.jenis === "ptm") {
      const rekap = susunBebanMengajar(sumber.data, null);
      return (
        <>
          <p className="text-sm text-slate-400">
            Semester aktif. Semester lain dicetak dari tab Beban Mengajar.
          </p>
          {pilih(
            "surat-unit",
            "Unit rombel",
            pilihan,
            setPilihan,
            daftarUnitBeban(rekap).map((u) => ({ value: u, label: u })),
            "Semua unit",
          )}
        </>
      );
    }
    if (sumber.jenis === "tugas") {
      const tahun = [
        ...new Set(sumber.data.tugas.map((t) => t.tahun_ajaran)),
      ].sort((a, b) => (a < b ? 1 : -1));
      return (
        <>
          {pilih(
            "surat-tahun",
            "Tahun ajaran",
            pilihan,
            setPilihan,
            tahun.map((t) => ({ value: t, label: t })),
            "Pilih tahun ajaran",
          )}
          {pilih(
            "surat-jenis-tugas",
            "Jenis tugas (semua pegawai dalam satu SK)",
            pilihanDua,
            setPilihanDua,
            sumber.data.jenis.map((j) => ({
              value: j.id_jenis,
              label: j.nama,
            })),
            "Pilih jenis tugas",
          )}
          <p className="text-sm text-slate-400">
            SK untuk satu orang dicetak dari baris di tab Tugas Tambahan.
          </p>
        </>
      );
    }
    if (sumber.jenis === "angkat") {
      const sah = kontrakSah(sumber.data.kontrak).filter(
        (k) => k.status === "GTY" || k.status === "PTY",
      );
      return pilih(
        "surat-kontrak",
        "Kontrak GTY/PTY",
        pilihan,
        setPilihan,
        sah.map((k) => ({
          value: k.id_kontrak,
          label: `${nama.get(k.id_karyawan) ?? k.id_karyawan} · ${k.status} · mulai ${tgl(k.tanggal_mulai)}`,
        })),
        "Pilih kontrak",
      );
    }
    if (sumber.jenis === "tugas_luar") {
      return pilih(
        "surat-pengajuan",
        "Dinas Luar yang disetujui (tahun ini)",
        pilihan,
        setPilihan,
        sumber.data.map((p) => ({
          value: p.id_pengajuan,
          label: `${p.nama} · ${tgl(p.tanggal_mulai)}${p.tanggal_selesai !== p.tanggal_mulai ? ` s.d. ${tgl(p.tanggal_selesai)}` : ""}`,
        })),
        "Pilih pengajuan",
      );
    }
    return pilih(
      "surat-pegawai",
      "Pegawai",
      pilihan,
      setPilihan,
      org.pegawai
        .filter((p) => p.status_aktif === "Aktif")
        .map((p) => ({
          value: p.id_unik,
          label: `${p.nama} · ${p.kelompok}${p.unit ? ` · ${p.unit}` : ""}`,
        })),
      "Pilih pegawai",
    );
  };

  const lengkap =
    sumber !== null &&
    (sumber.jenis === "ptm" ||
      (pilihan !== "" && (sumber.jenis !== "tugas" || pilihanDua !== "")));

  return (
    <div className="max-w-xl space-y-4">
      <div>
        <label htmlFor="surat-jenis" className={LABEL}>
          Jenis surat
        </label>
        <select
          id="surat-jenis"
          value={jenis}
          onChange={(e) => setJenis(e.target.value as JenisSurat)}
          className={INPUT}
        >
          {jenisBoleh.map((j) => (
            <option key={j} value={j}>
              {NAMA_SURAT[j]}
            </option>
          ))}
        </select>
      </div>
      {isian()}
      <button
        type="button"
        className={TOMBOL_UTAMA}
        disabled={!lengkap || menyiapkan}
        onClick={() => void siapkan()}
      >
        {menyiapkan ? "Menyiapkan…" : "Siapkan surat"}
      </button>
      {permintaan ? (
        <DialogCetakSurat
          permintaan={permintaan}
          onClose={() => setPermintaan(null)}
        />
      ) : null}
    </div>
  );
}
