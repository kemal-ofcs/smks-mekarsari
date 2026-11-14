"use client";

import {
  type FormEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  cabutSuratPeringatan,
  muatSetupSurat,
  muatSuratPeringatan,
  type PegawaiKepegawaian,
  simpanSuratPeringatan,
} from "@/lib/gateways/hris";
import {
  type DaftarSp,
  MAKS_PELANGGARAN,
  MAKS_PENANDA,
  MAKS_TEKS_SP,
  type SpBaris,
  TINGKAT_SP,
  type TingkatSp,
  usulanTingkat,
} from "@/lib/validations/hr-keluar";
import { NOMOR_MAKS } from "@/lib/validations/hris";
import { type PermintaanSurat, permintaanSp } from "./DialogCetakSurat";
import {
  INPUT,
  LABEL,
  PERINGATAN,
  pesanGalat,
  TOMBOL,
  TOMBOL_UTAMA,
} from "./gaya";
import { kepalaUnit, ketuaYayasan } from "./suratKepegawaian";

const WARNA_STATUS: Record<SpBaris["status"], string> = {
  Berlaku: "border-amber-300/40 text-amber-200",
  Berakhir: "border-white/10 text-slate-300",
  Dicabut: "border-rose-300/40 text-rose-300",
};

const NOMOR_KEMBAR =
  "Tersimpan. Nomor ini juga dipakai SP lain; periksa buku agenda.";

/**
 * Tab SP di rincian pegawai (HRIS Fase 4a, §22.5 layar 1): riwayat dengan
 * status turunan, Buat SP dengan usulan tingkat, ubah teks, Cabut, Cetak. Data
 * cloud-only: tanpa koneksi tab ini menampilkan pesan luring. Izin di sini
 * hanya menyembunyikan tombol; backend menilai ulang dari sesi.
 */
export function SuratPeringatanPegawai({
  pegawai,
  boleh,
  onCetak,
}: {
  pegawai: PegawaiKepegawaian;
  boleh: (
    izin: "hr.warning.manage" | "hr.warning.sp3" | "hr.warning.cancel",
  ) => boolean;
  onCetak: (permintaan: PermintaanSurat) => void;
}) {
  const id = pegawai.id_unik;
  const [data, setData] = useState<DaftarSp | null>(null);
  const [galat, setGalat] = useState<string | null>(null);
  const [pesan, setPesan] = useState<string | null>(null);
  const [form, setForm] = useState<"baru" | SpBaris | null>(null);
  const [cabut, setCabut] = useState<SpBaris | null>(null);

  const muat = useCallback(async () => {
    try {
      setData(await muatSuratPeringatan(id));
      setGalat(null);
    } catch (error) {
      setGalat(pesanGalat(error));
    }
  }, [id]);

  useEffect(() => {
    void muat();
  }, [muat]);

  if (galat && !data) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-rose-300" role="alert">
          {galat}
        </p>
        <button type="button" className={TOMBOL} onClick={() => void muat()}>
          Coba lagi
        </button>
      </div>
    );
  }
  if (!data) return <p className="text-sm text-slate-400">Memuat…</p>;

  const bolehBuat = boleh("hr.warning.manage");
  const bolehSp3 = boleh("hr.warning.sp3");
  const bolehUbah = (sp: SpBaris) =>
    bolehBuat && sp.status !== "Dicabut" && (sp.tingkat !== "SP3" || bolehSp3);
  const sp3 = data.sp.find(
    (sp) => sp.tingkat === "SP3" && sp.status === "Berlaku",
  );

  const selesai = async (kabar: string) => {
    setForm(null);
    setCabut(null);
    setPesan(kabar);
    await muat();
  };

  return (
    <div className="space-y-4">
      {pesan ? (
        <output className="block text-sm text-emerald-300">{pesan}</output>
      ) : null}
      {galat ? (
        <p className="text-sm text-rose-300" role="alert">
          {galat}
        </p>
      ) : null}
      {sp3 ? (
        <p className={PERINGATAN}>
          SP3 berlaku sampai {sp3.berlaku_sampai}. Langkah berikutnya adalah
          proses keluar pegawai.
        </p>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-slate-300">
          Usulan tingkat hari ini:{" "}
          <span className="font-semibold text-white">
            {data.usulan.tingkat}
          </span>{" "}
          · masa berlaku SP baru {data.masa_bulan} bulan
        </p>
        {bolehBuat && form === null ? (
          <button
            type="button"
            className={TOMBOL_UTAMA}
            onClick={() => {
              setPesan(null);
              setCabut(null);
              setForm("baru");
            }}
          >
            Buat SP
          </button>
        ) : null}
      </div>

      {form ? (
        <FormSp
          pegawai={pegawai}
          data={data}
          lama={form === "baru" ? null : form}
          bolehSp3={bolehSp3}
          onBatal={() => setForm(null)}
          onTersimpan={(kembar) =>
            selesai(kembar ? NOMOR_KEMBAR : "SP tersimpan.")
          }
        />
      ) : null}

      {data.sp.length === 0 ? (
        <p className="text-sm text-slate-400">Belum ada surat peringatan.</p>
      ) : (
        <ul className="space-y-2">
          {data.sp.map((sp) => (
            <li
              key={sp.id_sp}
              className="space-y-2 rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-sm"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold text-white">{sp.tingkat}</span>
                <span
                  className={`rounded-full border px-2 text-xs font-semibold ${WARNA_STATUS[sp.status]}`}
                >
                  {sp.status}
                </span>
                <span className="text-slate-400">
                  {sp.tanggal} s.d. {sp.berlaku_sampai}
                  {sp.nomor ? ` · ${sp.nomor}` : " · tanpa nomor"}
                </span>
              </div>
              <p className="whitespace-pre-line break-words text-slate-200">
                {sp.pelanggaran}
              </p>
              {sp.alasan_tingkat ? (
                <p className="text-xs text-slate-400">
                  Usulan {sp.usulan_tingkat}, dipilih {sp.tingkat}:{" "}
                  {sp.alasan_tingkat}
                </p>
              ) : null}
              {sp.status === "Dicabut" ? (
                <p className="text-xs text-rose-300">
                  Dicabut oleh {sp.dicabut_oleh}: {sp.alasan_cabut}
                </p>
              ) : null}
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className={TOMBOL}
                  onClick={() =>
                    onCetak(permintaanSp(sp, pegawai.nama, bolehUbah(sp)))
                  }
                >
                  Cetak
                </button>
                {bolehUbah(sp) ? (
                  <button
                    type="button"
                    className={TOMBOL}
                    onClick={() => {
                      setPesan(null);
                      setCabut(null);
                      setForm(sp);
                    }}
                  >
                    Ubah
                  </button>
                ) : null}
                {boleh("hr.warning.cancel") && sp.status !== "Dicabut" ? (
                  <button
                    type="button"
                    className={TOMBOL}
                    onClick={() => {
                      setPesan(null);
                      setForm(null);
                      setCabut(sp);
                    }}
                  >
                    Cabut
                  </button>
                ) : null}
              </div>
              {cabut?.id_sp === sp.id_sp ? (
                <FormCabut
                  sp={sp}
                  onBatal={() => setCabut(null)}
                  onTercabut={() => selesai("SP dicabut.")}
                />
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function FormSp({
  pegawai,
  data,
  lama,
  bolehSp3,
  onBatal,
  onTersimpan,
}: {
  pegawai: PegawaiKepegawaian;
  data: DaftarSp;
  lama: SpBaris | null;
  bolehSp3: boolean;
  onBatal: () => void;
  onTersimpan: (nomorKembar: boolean) => Promise<void>;
}) {
  const awal = (lama?.tanggal ?? data.hari_ini) || "";
  const [tanggal, setTanggal] = useState(awal);
  const usulan = usulanTingkat(
    data.sp.map((sp) => ({
      tingkat: sp.tingkat,
      tanggal: sp.tanggal,
      berlaku_sampai: sp.berlaku_sampai,
      dicabut: sp.status === "Dicabut",
    })),
    tanggal,
  ).tingkat;
  const [tingkat, setTingkat] = useState<TingkatSp>(
    lama?.tingkat ?? data.usulan.tingkat,
  );
  const [alasanTingkat, setAlasanTingkat] = useState(
    lama?.alasan_tingkat ?? "",
  );
  const [nomor, setNomor] = useState(lama?.nomor ?? "");
  const [pelanggaran, setPelanggaran] = useState(lama?.pelanggaran ?? "");
  const [harapan, setHarapan] = useState(lama?.harapan ?? "");
  const [penandaNama, setPenandaNama] = useState(lama?.penanda_nama ?? "");
  const [penandaJabatan, setPenandaJabatan] = useState(
    lama?.penanda_jabatan ?? "",
  );
  const [penandaNip, setPenandaNip] = useState(lama?.penanda_nip ?? "");
  // Penanda bawaan diisi selama belum disentuh: kepala unit pada tanggal SP
  // untuk SP1/SP2, ketua yayasan untuk SP3 (§22.2.1).
  const penandaDisentuh = useRef(lama !== null);
  const [galat, setGalat] = useState<string | null>(null);
  const isSubmittingRef = useRef(false);
  const [menyimpan, setMenyimpan] = useState(false);
  const baru = lama === null;

  useEffect(() => {
    if (!baru || !/^\d{4}-\d{2}-\d{2}$/.test(tanggal)) return;
    let berlaku = true;
    muatSetupSurat(tanggal)
      .then((setup) => {
        if (!berlaku || penandaDisentuh.current) return;
        const p =
          tingkat === "SP3"
            ? ketuaYayasan(setup)
            : kepalaUnit(setup, pegawai.unit);
        setPenandaNama(p.nama);
        setPenandaJabatan(p.jabatan);
        setPenandaNip(p.nip);
      })
      .catch(() => {
        // Penanda tetap bisa diketik; bahan cetak tidak wajib untuk menyimpan.
      });
    return () => {
      berlaku = false;
    };
  }, [baru, tanggal, tingkat, pegawai.unit]);

  const sentuhPenanda = (ubah: (v: string) => void) => (v: string) => {
    penandaDisentuh.current = true;
    ubah(v);
  };

  const kirim = async (event: FormEvent) => {
    event.preventDefault();
    if (isSubmittingRef.current) return;
    isSubmittingRef.current = true;
    setMenyimpan(true);
    setGalat(null);
    try {
      const hasil = await simpanSuratPeringatan({
        id_sp: lama?.id_sp ?? "",
        id_karyawan: pegawai.id_unik,
        tingkat,
        tanggal,
        nomor,
        pelanggaran,
        harapan,
        alasan_tingkat: tingkat === usulan ? "" : alasanTingkat,
        penanda_nama: penandaNama,
        penanda_jabatan: penandaJabatan,
        penanda_nip: penandaNip,
      });
      await onTersimpan(hasil.nomor_kembar);
    } catch (error) {
      setGalat(pesanGalat(error));
    } finally {
      isSubmittingRef.current = false;
      setMenyimpan(false);
    }
  };

  return (
    <form
      onSubmit={kirim}
      className="space-y-3 rounded-xl border border-white/10 bg-slate-900 p-3"
      aria-labelledby="judul-form-sp"
    >
      <h3 id="judul-form-sp" className="text-sm font-semibold text-white">
        {baru ? "Surat peringatan baru" : `Ubah ${lama.tingkat}`}
      </h3>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="sp-tanggal" className={LABEL}>
            Tanggal SP
          </label>
          <input
            id="sp-tanggal"
            type="date"
            required
            max={data.hari_ini}
            disabled={!baru}
            value={tanggal}
            onChange={(e) => setTanggal(e.target.value)}
            className={INPUT}
          />
        </div>
        <div>
          <label htmlFor="sp-tingkat" className={LABEL}>
            Tingkat {baru ? `(usulan ${usulan})` : ""}
          </label>
          <select
            id="sp-tingkat"
            disabled={!baru}
            value={tingkat}
            onChange={(e) => setTingkat(e.target.value as TingkatSp)}
            className={INPUT}
          >
            {TINGKAT_SP.map((t) => (
              <option key={t} value={t} disabled={t === "SP3" && !bolehSp3}>
                {t}
              </option>
            ))}
          </select>
        </div>
      </div>
      {baru && tingkat !== usulan ? (
        <div>
          <label htmlFor="sp-alasan-tingkat" className={LABEL}>
            Alasan memilih {tingkat}, bukan {usulan}
          </label>
          <textarea
            id="sp-alasan-tingkat"
            required
            rows={2}
            maxLength={MAKS_TEKS_SP}
            value={alasanTingkat}
            onChange={(e) => setAlasanTingkat(e.target.value)}
            className={`${INPUT} py-2`}
          />
        </div>
      ) : null}
      <div>
        <label htmlFor="sp-pelanggaran" className={LABEL}>
          Pelanggaran
        </label>
        <textarea
          id="sp-pelanggaran"
          required
          rows={3}
          maxLength={MAKS_PELANGGARAN}
          value={pelanggaran}
          onChange={(e) => setPelanggaran(e.target.value)}
          className={`${INPUT} py-2`}
        />
      </div>
      <div>
        <label htmlFor="sp-harapan" className={LABEL}>
          Perbaikan yang diminta (boleh kosong)
        </label>
        <textarea
          id="sp-harapan"
          rows={2}
          maxLength={MAKS_TEKS_SP}
          value={harapan}
          onChange={(e) => setHarapan(e.target.value)}
          className={`${INPUT} py-2`}
        />
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="sp-penanda-nama" className={LABEL}>
            Nama penanda tangan
          </label>
          <input
            id="sp-penanda-nama"
            required
            maxLength={MAKS_PENANDA}
            value={penandaNama}
            onChange={(e) => sentuhPenanda(setPenandaNama)(e.target.value)}
            className={INPUT}
          />
        </div>
        <div>
          <label htmlFor="sp-penanda-jabatan" className={LABEL}>
            Jabatan penanda tangan
          </label>
          <input
            id="sp-penanda-jabatan"
            required
            maxLength={MAKS_PENANDA}
            value={penandaJabatan}
            onChange={(e) => sentuhPenanda(setPenandaJabatan)(e.target.value)}
            className={INPUT}
          />
        </div>
        <div>
          <label htmlFor="sp-penanda-nip" className={LABEL}>
            NIP penanda tangan (boleh kosong)
          </label>
          <input
            id="sp-penanda-nip"
            maxLength={30}
            value={penandaNip}
            onChange={(e) => sentuhPenanda(setPenandaNip)(e.target.value)}
            className={INPUT}
          />
        </div>
        <div>
          <label htmlFor="sp-nomor" className={LABEL}>
            Nomor surat (boleh diisi saat cetak)
          </label>
          <input
            id="sp-nomor"
            maxLength={NOMOR_MAKS}
            value={nomor}
            onChange={(e) => setNomor(e.target.value)}
            className={INPUT}
          />
        </div>
      </div>
      {galat ? (
        <p className="text-sm text-rose-300" role="alert">
          {galat}
        </p>
      ) : null}
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" className={TOMBOL} onClick={onBatal}>
          Batal
        </button>
        <button type="submit" className={TOMBOL_UTAMA} disabled={menyimpan}>
          {menyimpan ? "Menyimpan…" : "Simpan SP"}
        </button>
      </div>
    </form>
  );
}

function FormCabut({
  sp,
  onBatal,
  onTercabut,
}: {
  sp: SpBaris;
  onBatal: () => void;
  onTercabut: () => Promise<void>;
}) {
  const [alasan, setAlasan] = useState("");
  const [galat, setGalat] = useState<string | null>(null);
  const isSubmittingRef = useRef(false);
  const [menyimpan, setMenyimpan] = useState(false);
  const idAlasan = `sp-cabut-${sp.id_sp}`;

  const kirim = async (event: FormEvent) => {
    event.preventDefault();
    if (isSubmittingRef.current) return;
    isSubmittingRef.current = true;
    setMenyimpan(true);
    setGalat(null);
    try {
      await cabutSuratPeringatan(sp.id_sp, alasan);
      await onTercabut();
    } catch (error) {
      setGalat(pesanGalat(error));
    } finally {
      isSubmittingRef.current = false;
      setMenyimpan(false);
    }
  };

  return (
    <form onSubmit={kirim} className="space-y-2 border-t border-white/10 pt-2">
      <label htmlFor={idAlasan} className={LABEL}>
        Alasan mencabut {sp.tingkat}
      </label>
      <textarea
        id={idAlasan}
        required
        rows={2}
        maxLength={MAKS_TEKS_SP}
        value={alasan}
        onChange={(e) => setAlasan(e.target.value)}
        className={`${INPUT} py-2`}
      />
      <p className="text-xs text-slate-400">
        SP yang dicabut tidak dihitung untuk usulan tingkat dan tidak bisa
        diubah lagi. Pencabutan tidak bisa dibatalkan.
      </p>
      {galat ? (
        <p className="text-sm text-rose-300" role="alert">
          {galat}
        </p>
      ) : null}
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" className={TOMBOL} onClick={onBatal}>
          Batal
        </button>
        <button type="submit" className={TOMBOL_UTAMA} disabled={menyimpan}>
          {menyimpan ? "Mencabut…" : "Cabut SP"}
        </button>
      </div>
    </form>
  );
}
