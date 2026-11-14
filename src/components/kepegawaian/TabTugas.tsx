"use client";

import {
  type FormEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { Modal } from "@/components/ui/Modal";
import { PilihCari } from "@/components/ui/PilihCari";
import { formatTanggalOperasional } from "@/lib/attendance/time-policy";
import {
  batalTugas,
  type DaftarTugas,
  muatTugas,
  type OrgKepegawaian,
  simpanTugas,
  type TugasBaris,
  type TugasDraft,
} from "@/lib/gateways/hris";
import { ID_WALI_KELAS } from "@/lib/validations/hris";
import {
  DialogCetakSurat,
  type PermintaanSurat,
  permintaanTugasTambahan,
} from "./DialogCetakSurat";
import { INPUT, LABEL, pesanGalat, TOMBOL, TOMBOL_UTAMA } from "./gaya";
import { ModalBatal } from "./TabKontrak";

const tgl = (t: string) => (t ? formatTanggalOperasional(t) : "-");

export function TabTugas({
  org,
  bolehUbah,
  onPesan,
  onGalat,
}: {
  org: OrgKepegawaian;
  bolehUbah: boolean;
  onPesan: (pesan: string) => void;
  onGalat: (pesan: string) => void;
}) {
  const [data, setData] = useState<DaftarTugas | null>(null);
  const [tahun, setTahun] = useState("");
  const [sunting, setSunting] = useState<TugasBaris | "baru" | null>(null);
  const [batal, setBatal] = useState<TugasBaris | null>(null);
  const [cetak, setCetak] = useState<PermintaanSurat | null>(null);
  const isSubmittingRef = useRef(false);
  const [menyimpan, setMenyimpan] = useState(false);

  const muat = useCallback(async () => {
    try {
      const hasil = await muatTugas();
      setData(hasil);
      setTahun(
        (lama) =>
          lama ||
          hasil.tahun_ajaran[0]?.nama_tahun ||
          hasil.tugas[0]?.tahun_ajaran ||
          "",
      );
    } catch (error) {
      onGalat(pesanGalat(error));
    }
  }, [onGalat]);

  useEffect(() => {
    void muat();
  }, [muat]);

  const jalankan = async (aksi: () => Promise<unknown>, berhasil: string) => {
    if (isSubmittingRef.current) return;
    isSubmittingRef.current = true;
    setMenyimpan(true);
    try {
      await aksi();
      setSunting(null);
      setBatal(null);
      onPesan(berhasil);
      await muat();
    } catch (error) {
      onGalat(pesanGalat(error));
    } finally {
      isSubmittingRef.current = false;
      setMenyimpan(false);
    }
  };

  if (!data)
    return <p className="text-sm text-slate-400">Memuat tugas tambahan…</p>;

  const nama = new Map(org.pegawai.map((p) => [p.id_unik, p.nama]));
  const jenis = new Map(data.jenis.map((j) => [j.id_jenis, j]));
  const rombel = new Map(data.wali_kelas.map((w) => [w.id_rombel, w]));
  const daftarTahun = [
    ...new Set([
      ...data.tahun_ajaran.map((t) => t.nama_tahun),
      ...data.tugas.map((t) => t.tahun_ajaran),
    ]),
  ].sort((a, b) => (a < b ? 1 : -1));
  const tugas = data.tugas.filter((t) => t.tahun_ajaran === tahun);
  const wali = data.wali_kelas.filter((w) => w.nama_tahun === tahun);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-48">
          <label htmlFor="tugas-tahun" className={LABEL}>
            Tahun ajaran
          </label>
          <select
            id="tugas-tahun"
            value={tahun}
            onChange={(e) => setTahun(e.target.value)}
            className={INPUT}
          >
            {daftarTahun.length === 0 ? (
              <option value="">Belum ada tahun ajaran</option>
            ) : null}
            {daftarTahun.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
        {bolehUbah ? (
          <button
            type="button"
            className={TOMBOL_UTAMA}
            onClick={() => setSunting("baru")}
          >
            Tambah tugas
          </button>
        ) : null}
      </div>

      <section aria-labelledby="judul-tugas" className="space-y-3">
        <h2 id="judul-tugas" className="text-base font-semibold text-white">
          Tugas tambahan
        </h2>
        <ul className="space-y-2">
          {tugas.map((t) => {
            const j = jenis.get(t.id_jenis);
            const jp = t.ekuivalen_jp ?? j?.ekuivalen_jp ?? 0;
            return (
              <li
                key={t.id_tugas}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-sm"
              >
                <div className="min-w-0">
                  <span className="font-semibold text-white">
                    {nama.get(t.id_karyawan) ?? t.id_karyawan}
                  </span>
                  <span className="text-slate-400">
                    {" "}
                    · {j?.nama ?? t.id_jenis}
                    {t.id_rombel
                      ? ` ${rombel.get(t.id_rombel)?.nama_rombel ?? ""}`
                      : ""}
                    {t.unit ? ` · ${t.unit}` : ""} · {jp} JP · {t.status}
                  </span>
                  <span className="block text-xs text-slate-400">
                    {tgl(t.tanggal_mulai)} s.d.{" "}
                    {t.tanggal_selesai ? tgl(t.tanggal_selesai) : "seterusnya"}
                    {t.nomor_sk ? ` · SK ${t.nomor_sk}` : ""}
                    {t.alasan_batal ? ` · Dibatalkan: ${t.alasan_batal}` : ""}
                  </span>
                </div>
                {bolehUbah && t.status !== "Dibatalkan" ? (
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className={TOMBOL}
                      onClick={() => setSunting(t)}
                    >
                      Ubah
                    </button>
                    <button
                      type="button"
                      className={TOMBOL}
                      onClick={() => setBatal(t)}
                    >
                      Batalkan
                    </button>
                    <button
                      type="button"
                      className={TOMBOL}
                      onClick={() =>
                        setCetak(permintaanTugasTambahan([t], data, nama))
                      }
                    >
                      Cetak SK
                    </button>
                  </div>
                ) : null}
              </li>
            );
          })}
          {tugas.length === 0 ? (
            <li className="text-sm text-slate-400">
              Belum ada tugas tambahan di tahun ajaran ini.
            </li>
          ) : null}
        </ul>
      </section>

      <section aria-labelledby="judul-wali" className="space-y-3">
        <h2 id="judul-wali" className="text-base font-semibold text-white">
          Wali kelas (dari rombel)
        </h2>
        <p className="text-sm text-slate-400">
          Diubah di menu Akademik → Rombel. Tunjangan wali kelas mengikuti
          daftar ini; nomor SK bisa dicatat lewat Tambah tugas.
        </p>
        <ul className="space-y-1 text-sm">
          {wali.map((w) => (
            <li key={w.id_rombel} className="text-slate-200">
              {w.nama_rombel} ({w.semester}) ·{" "}
              {nama.get(w.id_wali_kelas) ?? w.id_wali_kelas}
            </li>
          ))}
          {wali.length === 0 ? (
            <li className="text-slate-400">Belum ada wali kelas.</li>
          ) : null}
        </ul>
      </section>

      {sunting ? (
        <ModalTugas
          org={org}
          data={data}
          awal={sunting === "baru" ? null : sunting}
          tahunAwal={tahun}
          menyimpan={menyimpan}
          onClose={() => setSunting(null)}
          onSimpan={(draft) =>
            jalankan(() => simpanTugas(draft), "Tugas tambahan disimpan.")
          }
        />
      ) : null}
      {cetak ? (
        <DialogCetakSurat
          permintaan={cetak}
          onClose={() => {
            setCetak(null);
            void muat();
          }}
        />
      ) : null}
      {batal ? (
        <ModalBatal
          judul="Batalkan tugas tambahan"
          menyimpan={menyimpan}
          onClose={() => setBatal(null)}
          onBatal={(alasan) =>
            jalankan(
              () => batalTugas(batal.id_tugas, alasan),
              "Tugas tambahan dibatalkan.",
            )
          }
        />
      ) : null}
    </div>
  );
}

function ModalTugas({
  org,
  data,
  awal,
  tahunAwal,
  menyimpan,
  onClose,
  onSimpan,
}: {
  org: OrgKepegawaian;
  data: DaftarTugas;
  awal: TugasBaris | null;
  tahunAwal: string;
  menyimpan: boolean;
  onClose: () => void;
  onSimpan: (draft: TugasDraft) => void;
}) {
  const rentang = (nama: string) =>
    data.tahun_ajaran.find((t) => t.nama_tahun === nama);
  const [idKaryawan, setIdKaryawan] = useState(awal?.id_karyawan ?? "");
  const [idJenis, setIdJenis] = useState(awal?.id_jenis ?? "");
  const [unit, setUnit] = useState(awal?.unit ?? "");
  const [tahun, setTahun] = useState(awal?.tahun_ajaran ?? tahunAwal);
  const [idRombel, setIdRombel] = useState(awal?.id_rombel ?? "");
  const [nomorSk, setNomorSk] = useState(awal?.nomor_sk ?? "");
  const [tanggalSk, setTanggalSk] = useState(awal?.tanggal_sk ?? "");
  const [ekuivalen, setEkuivalen] = useState(
    awal?.ekuivalen_jp === null || awal?.ekuivalen_jp === undefined
      ? ""
      : String(awal.ekuivalen_jp),
  );
  const [mulai, setMulai] = useState(
    awal?.tanggal_mulai ?? rentang(tahunAwal)?.tanggal_mulai ?? data.hari_ini,
  );
  const [selesai, setSelesai] = useState(
    awal?.tanggal_selesai ?? rentang(tahunAwal)?.tanggal_selesai ?? "",
  );
  const pegawai = org.pegawai.filter(
    (p) => p.status_aktif === "Aktif" || p.id_unik === awal?.id_karyawan,
  );
  const jenis = data.jenis.filter(
    (j) => j.is_aktif === 1 || j.id_jenis === awal?.id_jenis,
  );
  const units = [...new Set(org.pegawai.map((p) => p.unit).filter(Boolean))];
  const rombel = data.wali_kelas.filter(
    (w) => w.id_wali_kelas === idKaryawan && w.nama_tahun === tahun,
  );
  const ekuivalenJenis =
    data.jenis.find((j) => j.id_jenis === idJenis)?.ekuivalen_jp ?? 0;

  const gantiTahun = (nama: string) => {
    setTahun(nama);
    const r = rentang(nama);
    if (r) {
      setMulai(r.tanggal_mulai);
      setSelesai(r.tanggal_selesai);
    }
  };

  const kirim = (event: FormEvent) => {
    event.preventDefault();
    onSimpan({
      id: awal?.id_tugas,
      id_karyawan: idKaryawan,
      id_jenis: idJenis,
      unit,
      tahun_ajaran: tahun,
      id_rombel: idJenis === ID_WALI_KELAS ? idRombel : "",
      nomor_sk: nomorSk,
      tanggal_sk: tanggalSk,
      ekuivalen_jp: ekuivalen === "" ? null : Number(ekuivalen),
      tanggal_mulai: mulai,
      tanggal_selesai: selesai,
    });
  };

  return (
    <Modal
      title={awal ? "Ubah tugas tambahan" : "Tambah tugas tambahan"}
      onClose={onClose}
      hideFooter
    >
      <form className="space-y-4" onSubmit={kirim}>
        <div>
          <label htmlFor="tugas-pegawai" className={LABEL}>
            Pegawai
          </label>
          <PilihCari
            id="tugas-pegawai"
            required
            value={idKaryawan}
            onChange={(e) => setIdKaryawan(e.target.value)}
            className={INPUT}
          >
            <option value="">Pilih pegawai</option>
            {pegawai.map((p) => (
              <option key={p.id_unik} value={p.id_unik}>
                {p.nama}
              </option>
            ))}
          </PilihCari>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="tugas-jenis" className={LABEL}>
              Jenis tugas
            </label>
            <select
              id="tugas-jenis"
              required
              value={idJenis}
              onChange={(e) => setIdJenis(e.target.value)}
              className={INPUT}
            >
              <option value="">Pilih jenis</option>
              {jenis.map((j) => (
                <option key={j.id_jenis} value={j.id_jenis}>
                  {j.nama}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="tugas-tahun-form" className={LABEL}>
              Tahun ajaran
            </label>
            <select
              id="tugas-tahun-form"
              required
              value={tahun}
              onChange={(e) => gantiTahun(e.target.value)}
              className={INPUT}
            >
              <option value="">Pilih tahun ajaran</option>
              {data.tahun_ajaran.map((t) => (
                <option key={t.nama_tahun} value={t.nama_tahun}>
                  {t.nama_tahun}
                </option>
              ))}
            </select>
          </div>
        </div>
        {idJenis === ID_WALI_KELAS ? (
          <div>
            <label htmlFor="tugas-rombel" className={LABEL}>
              Rombel yang diwalikan
            </label>
            <select
              id="tugas-rombel"
              required
              value={idRombel}
              onChange={(e) => setIdRombel(e.target.value)}
              className={INPUT}
            >
              <option value="">Pilih rombel</option>
              {rombel.map((w) => (
                <option key={w.id_rombel} value={w.id_rombel}>
                  {w.nama_rombel} ({w.semester})
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-slate-400">
              Hanya rombel yang walinya pegawai ini. Baris ini mencatat nomor
              SK; tunjangannya tetap mengikuti rombel.
            </p>
          </div>
        ) : null}
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="tugas-unit" className={LABEL}>
              Unit (kosong = lintas unit)
            </label>
            <select
              id="tugas-unit"
              value={unit}
              onChange={(e) => setUnit(e.target.value)}
              className={INPUT}
            >
              <option value="">Lintas unit/yayasan</option>
              {units.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="tugas-ekuivalen" className={LABEL}>
              Ekuivalen JP/minggu
            </label>
            <input
              id="tugas-ekuivalen"
              type="number"
              min={0}
              max={40}
              step={1}
              value={ekuivalen}
              placeholder={`Dari jenis: ${ekuivalenJenis}`}
              onChange={(e) => setEkuivalen(e.target.value)}
              className={INPUT}
            />
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="tugas-nomor-sk" className={LABEL}>
              Nomor SK (opsional)
            </label>
            <input
              id="tugas-nomor-sk"
              maxLength={80}
              value={nomorSk}
              onChange={(e) => setNomorSk(e.target.value)}
              className={INPUT}
            />
          </div>
          <div>
            <label htmlFor="tugas-tanggal-sk" className={LABEL}>
              Tanggal SK (opsional)
            </label>
            <input
              id="tugas-tanggal-sk"
              type="date"
              value={tanggalSk}
              onChange={(e) => setTanggalSk(e.target.value)}
              className={INPUT}
            />
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="tugas-mulai" className={LABEL}>
              Tanggal mulai
            </label>
            <input
              id="tugas-mulai"
              type="date"
              required
              value={mulai}
              onChange={(e) => setMulai(e.target.value)}
              className={INPUT}
            />
          </div>
          <div>
            <label htmlFor="tugas-selesai" className={LABEL}>
              Tanggal selesai (kosong = seterusnya)
            </label>
            <input
              id="tugas-selesai"
              type="date"
              min={mulai}
              value={selesai}
              onChange={(e) => setSelesai(e.target.value)}
              className={INPUT}
            />
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" className={TOMBOL} onClick={onClose}>
            Batal
          </button>
          <button type="submit" className={TOMBOL_UTAMA} disabled={menyimpan}>
            Simpan tugas
          </button>
        </div>
      </form>
    </Modal>
  );
}
