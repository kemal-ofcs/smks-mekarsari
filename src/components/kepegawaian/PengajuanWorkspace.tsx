"use client";

import {
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { FeedbackBanner } from "@/components/ui/FeedbackBanner";
import { Modal } from "@/components/ui/Modal";
import { PilihCari } from "@/components/ui/PilihCari";
import { OPERATIONAL_TIME_ZONE } from "@/lib/attendance/time-policy";
import { hasPermission } from "@/lib/auth/access";
import type { OperatorUser } from "@/lib/auth/operator-user";
import {
  type DaftarPengajuan,
  type JpTersusun,
  muatJpTerdampak,
  muatPengajuan,
  muatSaldoCuti,
  type PengajuanDraft,
  type PengajuanTersusun,
  putuskanPengajuan,
  type SaldoCuti,
  simpanPengajuan,
} from "@/lib/gateways/hr-pengajuan";
import {
  dalamCakupan,
  LABEL_TANDA,
  periksaAksi,
  periksaSunting,
  samaOrang,
  statusBerlaku,
  tambahHari,
} from "@/lib/validations/hr-pengajuan";
import {
  DialogCetakSurat,
  type PermintaanSurat,
  permintaanTugasLuar,
} from "./DialogCetakSurat";
import {
  INPUT,
  LABEL,
  PERINGATAN,
  pesanGalat,
  TOMBOL,
  TOMBOL_UTAMA,
} from "./gaya";
import { RingkasJp } from "./JamKosongWorkspace";
import { LampiranPengajuan } from "./LampiranPengajuan";

type Saringan = "menunggu" | "diketahui" | "ditinjau" | "semua";

const SARINGAN: [Saringan, string][] = [
  ["menunggu", "Menunggu"],
  ["diketahui", "Perlu diketahui"],
  ["ditinjau", "Perlu ditinjau"],
  ["semua", "Semua"],
];

const WARNA_STATUS: Record<string, string> = {
  Menunggu: "border-amber-300/30 bg-amber-300/10 text-amber-100",
  Disetujui: "border-emerald-300/30 bg-emerald-300/10 text-emerald-100",
  "Disetujui (urgent)":
    "border-emerald-300/30 bg-emerald-300/10 text-emerald-100",
  Ditolak: "border-rose-300/30 bg-rose-300/10 text-rose-100",
  Dibatalkan: "border-white/10 bg-slate-800 text-slate-300",
};

const KELOMPOK_JAM = ["Izin", "Sakit", "Dinas Luar"];

/** Hari ini menurut kalender WIB, hanya untuk rentang bawaan saringan. */
function hariIniWib() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: OPERATIONAL_TIME_ZONE,
  }).format(new Date());
}

function rentangTeks(p: PengajuanTersusun) {
  const tanggal =
    p.tanggal_mulai === p.tanggal_selesai
      ? p.tanggal_mulai
      : `${p.tanggal_mulai} s.d. ${p.tanggal_selesai}`;
  const jam: string[] = [];
  if (p.jam_mulai_ke !== null) jam.push(`mulai jam ke-${p.jam_mulai_ke}`);
  if (p.jam_sampai_ke !== null) jam.push(`sampai jam ke-${p.jam_sampai_ke}`);
  if (p.setengah_hari === 1) jam.push("setengah hari");
  return jam.length > 0 ? `${tanggal} (${jam.join(", ")})` : tanggal;
}

/** Halaman `/pengajuan` (Web/Desktop, §20.5 layar 1). */
export function PengajuanWorkspace({ user }: { user: OperatorUser | null }) {
  const hariIni = useMemo(hariIniWib, []);
  const [dari, setDari] = useState(() => tambahHari(hariIni, -60));
  const [sampai, setSampai] = useState(() => tambahHari(hariIni, 60));
  // Rentang yang sedang ditampilkan; berganti lewat tombol Tampilkan.
  const [rentang, setRentang] = useState(() => ({ dari, sampai }));
  const [saringan, setSaringan] = useState<Saringan>("menunggu");
  const [unit, setUnit] = useState("");
  const [data, setData] = useState<DaftarPengajuan | null>(null);
  const [galat, setGalat] = useState<string | null>(null);
  const [pesan, setPesan] = useState<string | null>(null);
  const [form, setForm] = useState<PengajuanDraft | null>(null);
  const [rincian, setRincian] = useState<PengajuanTersusun | null>(null);
  const [cetak, setCetak] = useState<PermintaanSurat | null>(null);

  const muat = useCallback(async () => {
    try {
      setData(await muatPengajuan(rentang.dari, rentang.sampai));
      setGalat(null);
    } catch (error) {
      setGalat(pesanGalat(error));
    }
  }, [rentang]);

  useEffect(() => {
    void muat();
  }, [muat]);

  const bolehAjukan = hasPermission(user, "hr.request.submit");
  const daftarUnit = useMemo(
    () =>
      [...new Set((data?.pegawai ?? []).map((p) => p.unit).filter(Boolean))]
        .sort()
        .map(String),
    [data],
  );
  const tampil = (data?.pengajuan ?? []).filter((p) => {
    if (unit && p.unit !== unit) return false;
    if (saringan === "menunggu") return p.status === "Menunggu";
    if (saringan === "diketahui") return p.tanda.includes("perlu_diketahui");
    if (saringan === "ditinjau") return p.tanda.length > 0;
    return true;
  });

  const selesai = async (teks: string) => {
    setForm(null);
    setRincian(null);
    setPesan(teks);
    await muat();
  };

  return (
    <div className="space-y-4">
      {galat ? (
        <FeedbackBanner tone="error" onDismiss={() => setGalat(null)}>
          {galat}
        </FeedbackBanner>
      ) : null}
      {pesan ? (
        <FeedbackBanner tone="success" onDismiss={() => setPesan(null)}>
          {pesan}
        </FeedbackBanner>
      ) : null}

      <form
        data-tanpa-konfirmasi
        className="grid gap-3 rounded-2xl border border-white/10 bg-slate-900 p-4 sm:grid-cols-2 lg:grid-cols-5"
        onSubmit={(event) => {
          event.preventDefault();
          setRentang({ dari, sampai });
        }}
      >
        <div>
          <label htmlFor="pengajuan-dari" className={LABEL}>
            Dari
          </label>
          <input
            id="pengajuan-dari"
            type="date"
            required
            value={dari}
            onChange={(e) => setDari(e.target.value)}
            className={INPUT}
          />
        </div>
        <div>
          <label htmlFor="pengajuan-sampai" className={LABEL}>
            Sampai
          </label>
          <input
            id="pengajuan-sampai"
            type="date"
            required
            min={dari}
            value={sampai}
            onChange={(e) => setSampai(e.target.value)}
            className={INPUT}
          />
        </div>
        <div>
          <label htmlFor="pengajuan-unit" className={LABEL}>
            Unit
          </label>
          <select
            id="pengajuan-unit"
            value={unit}
            onChange={(e) => setUnit(e.target.value)}
            className={INPUT}
          >
            <option value="">Semua unit</option>
            {daftarUnit.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-end gap-2 lg:col-span-2">
          <button type="submit" className={TOMBOL}>
            Tampilkan
          </button>
          {bolehAjukan && data ? (
            <button
              type="button"
              className={TOMBOL_UTAMA}
              onClick={() =>
                setForm({
                  id_karyawan: "",
                  id_jenis: "",
                  tanggal_mulai: hariIni,
                  tanggal_selesai: hariIni,
                  alasan: "",
                })
              }
            >
              Ajukan
            </button>
          ) : null}
        </div>
      </form>

      <div
        role="tablist"
        aria-label="Saring pengajuan"
        className="flex flex-wrap gap-2"
      >
        {SARINGAN.map(([kunci, label]) => (
          <button
            key={kunci}
            type="button"
            role="tab"
            aria-selected={saringan === kunci}
            className={
              saringan === kunci
                ? "min-h-10 rounded-xl bg-sky-500 px-3 text-sm font-semibold text-slate-950"
                : TOMBOL
            }
            onClick={() => setSaringan(kunci)}
          >
            {label}
          </button>
        ))}
      </div>

      {!data && !galat ? (
        <p className="text-sm text-slate-400">Memuat pengajuan…</p>
      ) : null}
      {data && tampil.length === 0 ? (
        <p className="text-sm text-slate-400">
          Tidak ada pengajuan untuk saringan ini.
        </p>
      ) : null}
      <ul className="space-y-2">
        {tampil.map((p) => (
          <li
            key={p.id_pengajuan}
            className="rounded-xl border border-white/10 bg-slate-900 px-4 py-3 text-sm"
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-semibold text-white">
                  {p.nama}
                  <span className="font-normal text-slate-400">
                    {p.unit ? ` · ${p.unit}` : ""} · {p.nama_jenis}
                  </span>
                </p>
                <p className="text-slate-300">{rentangTeks(p)}</p>
                <p className="break-words text-slate-400">{p.alasan}</p>
                {data?.jp[p.id_pengajuan] ? (
                  <p
                    className={
                      data.jp[p.id_pengajuan].belum > 0
                        ? "text-xs text-amber-200"
                        : "text-xs text-slate-400"
                    }
                  >
                    {data.jp[p.id_pengajuan].total} jam pelajaran terdampak,{" "}
                    {data.jp[p.id_pengajuan].belum} belum ditangani
                  </p>
                ) : null}
                {p.tanda.length > 0 ? (
                  <p className="text-xs text-amber-200">
                    {p.tanda.map((t) => LABEL_TANDA[t] ?? t).join(" · ")}
                  </p>
                ) : null}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${WARNA_STATUS[p.status] ?? ""}`}
                >
                  {p.status}
                </span>
                <button
                  type="button"
                  className={TOMBOL}
                  onClick={() => setRincian(p)}
                >
                  Rincian
                </button>
              </div>
            </div>
          </li>
        ))}
      </ul>

      {form && data ? (
        <FormPengajuan
          awal={form}
          data={data}
          user={user}
          onClose={() => setForm(null)}
          onSelesai={selesai}
        />
      ) : null}
      {rincian && data ? (
        <RincianPengajuan
          p={rincian}
          data={data}
          user={user}
          onClose={() => setRincian(null)}
          onSunting={() => {
            setRincian(null);
            setForm({
              id_pengajuan: rincian.id_pengajuan,
              id_karyawan: rincian.id_karyawan,
              id_jenis: rincian.id_jenis,
              tanggal_mulai: rincian.tanggal_mulai,
              tanggal_selesai: rincian.tanggal_selesai,
              jam_mulai_ke: rincian.jam_mulai_ke,
              jam_sampai_ke: rincian.jam_sampai_ke,
              setengah_hari: rincian.setengah_hari === 1,
              alasan: rincian.alasan,
            });
          }}
          onSelesai={selesai}
          onCetakSuratTugas={
            hasPermission(user, "hr.duty.manage") &&
            rincian.kelompok === "Dinas Luar" &&
            statusBerlaku(rincian.status)
              ? () => {
                  setRincian(null);
                  setCetak(permintaanTugasLuar(rincian));
                }
              : undefined
          }
        />
      ) : null}
      {cetak ? (
        <DialogCetakSurat permintaan={cetak} onClose={() => setCetak(null)} />
      ) : null}
    </div>
  );
}

function FormPengajuan({
  awal,
  data,
  user,
  onClose,
  onSelesai,
}: {
  awal: PengajuanDraft;
  data: DaftarPengajuan;
  user: OperatorUser | null;
  onClose: () => void;
  onSelesai: (pesan: string) => Promise<void>;
}) {
  const [d, setD] = useState<PengajuanDraft>(awal);
  const [galat, setGalat] = useState<string | null>(null);
  const isSubmittingRef = useRef(false);
  const [menyimpan, setMenyimpan] = useState(false);
  const ubah = (sebagian: Partial<PengajuanDraft>) =>
    setD((lama) => ({ ...lama, ...sebagian }));

  const pegawai = data.pegawai.find((p) => p.id_unik === d.id_karyawan);
  const jenis = data.jenis.find((j) => j.id_jenis === d.id_jenis);
  const aktif = data.jenis.filter(
    (j) => j.is_aktif === 1 || j.id_jenis === awal.id_jenis,
  );
  const guru = pegawai?.guru === 1;
  const pakaiJam = guru && KELOMPOK_JAM.includes(jenis?.kelompok ?? "");
  const pakaiSetengah =
    !guru &&
    jenis?.kelompok === "Izin" &&
    d.tanggal_mulai === d.tanggal_selesai;
  const bolehUrgent =
    jenis?.boleh_urgent === 1 && hasPermission(user, "hr.request.urgent");
  const ringkasan = useRingkasanJatah(
    d.id_karyawan,
    d.tanggal_mulai,
    d.tanggal_selesai,
  );
  const periodeMulai = ringkasan?.periode.find(
    (p) => p.mulai <= d.tanggal_mulai && d.tanggal_mulai <= p.selesai,
  );
  const sisaSesudah =
    periodeMulai && jenis?.potong_jatah === 1
      ? periodeMulai.sisa - (ringkasan?.hari_wajib ?? 0)
      : null;
  const jpForm = useJpForm(
    guru ? d.id_karyawan : "",
    d.tanggal_mulai,
    d.tanggal_selesai,
    pakaiJam ? (d.jam_mulai_ke ?? null) : null,
    pakaiJam ? (d.jam_sampai_ke ?? null) : null,
  );

  const kirim = async (event: FormEvent) => {
    event.preventDefault();
    if (isSubmittingRef.current) return;
    isSubmittingRef.current = true;
    setMenyimpan(true);
    try {
      const hasil = await simpanPengajuan({
        ...d,
        jam_mulai_ke: pakaiJam ? (d.jam_mulai_ke ?? null) : null,
        jam_sampai_ke: pakaiJam ? (d.jam_sampai_ke ?? null) : null,
        setengah_hari: pakaiSetengah && Boolean(d.setengah_hari),
        urgent: bolehUrgent && Boolean(d.urgent),
      });
      const teks = d.urgent
        ? "Pengajuan urgent tersimpan dan langsung berlaku."
        : "Pengajuan tersimpan dan menunggu keputusan.";
      await onSelesai(hasil.peringatan ? `${teks} ${hasil.peringatan}` : teks);
    } catch (error) {
      setGalat(pesanGalat(error));
    } finally {
      isSubmittingRef.current = false;
      setMenyimpan(false);
    }
  };

  const angka = (nilai: string) => (nilai === "" ? null : Number(nilai));

  return (
    <Modal
      title={awal.id_pengajuan ? "Ubah pengajuan" : "Ajukan cuti atau izin"}
      onClose={onClose}
      hideFooter
      maxWidth="max-w-2xl"
    >
      <form className="space-y-4" onSubmit={(e) => void kirim(e)}>
        {galat ? (
          <p className="text-sm text-rose-300" role="alert">
            {galat}
          </p>
        ) : null}
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="pengajuan-pegawai" className={LABEL}>
              Pegawai
            </label>
            <PilihCari
              id="pengajuan-pegawai"
              required
              value={d.id_karyawan}
              onChange={(e) => ubah({ id_karyawan: e.target.value })}
              className={INPUT}
            >
              <option value="">Pilih pegawai</option>
              {data.pegawai.map((p) => (
                <option key={p.id_unik} value={p.id_unik}>
                  {p.nama}
                  {p.unit ? ` · ${p.unit}` : ""}
                  {p.guru === 1 ? " · guru" : ""}
                </option>
              ))}
            </PilihCari>
          </div>
          <div>
            <label htmlFor="pengajuan-jenis" className={LABEL}>
              Jenis
            </label>
            <select
              id="pengajuan-jenis"
              required
              value={d.id_jenis}
              onChange={(e) => ubah({ id_jenis: e.target.value })}
              className={INPUT}
            >
              <option value="">Pilih jenis</option>
              {aktif.map((j) => (
                <option key={j.id_jenis} value={j.id_jenis}>
                  {j.nama}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="pengajuan-mulai" className={LABEL}>
              Tanggal mulai
            </label>
            <input
              id="pengajuan-mulai"
              type="date"
              required
              value={d.tanggal_mulai}
              onChange={(e) =>
                ubah({
                  tanggal_mulai: e.target.value,
                  tanggal_selesai:
                    d.tanggal_selesai < e.target.value
                      ? e.target.value
                      : d.tanggal_selesai,
                })
              }
              className={INPUT}
            />
          </div>
          <div>
            <label htmlFor="pengajuan-selesai" className={LABEL}>
              Tanggal selesai
            </label>
            <input
              id="pengajuan-selesai"
              type="date"
              required
              min={d.tanggal_mulai}
              value={d.tanggal_selesai}
              onChange={(e) => ubah({ tanggal_selesai: e.target.value })}
              className={INPUT}
            />
          </div>
          {pakaiJam ? (
            <>
              <div>
                <label htmlFor="pengajuan-jam-mulai" className={LABEL}>
                  Mulai jam ke- (hari pertama, opsional)
                </label>
                <input
                  id="pengajuan-jam-mulai"
                  type="number"
                  min={1}
                  max={20}
                  inputMode="numeric"
                  value={d.jam_mulai_ke ?? ""}
                  onChange={(e) =>
                    ubah({ jam_mulai_ke: angka(e.target.value) })
                  }
                  className={INPUT}
                />
              </div>
              <div>
                <label htmlFor="pengajuan-jam-sampai" className={LABEL}>
                  Sampai jam ke- (hari terakhir, opsional)
                </label>
                <input
                  id="pengajuan-jam-sampai"
                  type="number"
                  min={1}
                  max={20}
                  inputMode="numeric"
                  value={d.jam_sampai_ke ?? ""}
                  onChange={(e) =>
                    ubah({ jam_sampai_ke: angka(e.target.value) })
                  }
                  className={INPUT}
                />
              </div>
            </>
          ) : null}
        </div>
        {pakaiSetengah ? (
          <label
            htmlFor="pengajuan-setengah"
            className="flex items-center gap-2 text-sm text-slate-200"
          >
            <input
              id="pengajuan-setengah"
              type="checkbox"
              checked={Boolean(d.setengah_hari)}
              onChange={(e) => ubah({ setengah_hari: e.target.checked })}
            />
            Setengah hari
          </label>
        ) : null}
        <div>
          <label htmlFor="pengajuan-alasan" className={LABEL}>
            Alasan
          </label>
          <textarea
            id="pengajuan-alasan"
            required
            maxLength={500}
            rows={3}
            value={d.alasan}
            onChange={(e) => ubah({ alasan: e.target.value })}
            className={`${INPUT} py-2`}
          />
        </div>
        {bolehUrgent && !awal.id_pengajuan ? (
          <label
            htmlFor="pengajuan-urgent"
            className="flex items-start gap-2 text-sm text-slate-200"
          >
            <input
              id="pengajuan-urgent"
              type="checkbox"
              className="mt-1"
              checked={Boolean(d.urgent)}
              onChange={(e) => ubah({ urgent: e.target.checked })}
            />
            <span>
              Urgent: langsung berlaku sekarang, pemutus tetap menandai
              diketahui nanti.
            </span>
          </label>
        ) : null}
        {ringkasan && ringkasan.hari_wajib !== undefined ? (
          <div className="rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-sm text-slate-200">
            <p>
              Hari kerja dalam rentang ini: {ringkasan.hari_wajib} hari
              {jenis?.potong_jatah === 1 ? " (memotong jatah cuti)" : ""}.
            </p>
            {jenis?.potong_jatah === 1 ? (
              periodeMulai && sisaSesudah !== null ? (
                <p className={sisaSesudah < 0 ? "text-amber-200" : ""}>
                  Sisa jatah periode {periodeMulai.mulai} s.d.{" "}
                  {periodeMulai.selesai}: {periodeMulai.sisa} hari, sesudah
                  pengajuan ini {sisaSesudah} hari
                  {sisaSesudah < 0
                    ? ". Melebihi jatah; pemutus tetap bisa menyetujui."
                    : "."}
                </p>
              ) : (
                <p className="text-amber-200">
                  Tanggal ini di luar periode jatah pegawai (TMT kosong atau
                  belum berhak cuti).
                </p>
              )
            ) : null}
          </div>
        ) : null}
        {jpForm ? (
          <div className="rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-sm text-slate-200">
            {jpForm.length === 0 ? (
              <p>Tidak ada jam pelajaran terjadwal yang terdampak.</p>
            ) : (
              <>
                <p>
                  {jpForm.length} jam pelajaran terdampak; penggantinya diatur
                  di menu Jam Kosong.
                </p>
                <ul className="mt-1 space-y-0.5 text-slate-300">
                  {jpForm.slice(0, 20).map((j) => (
                    <li key={j.id_penanganan}>
                      {j.tanggal} · jam {j.jam_ke} · {j.nama_rombel} ·{" "}
                      {j.nama_mapel}
                    </li>
                  ))}
                  {jpForm.length > 20 ? (
                    <li className="text-slate-400">
                      dan {jpForm.length - 20} lainnya
                    </li>
                  ) : null}
                </ul>
              </>
            )}
          </div>
        ) : null}
        {jenis?.wajib_dokumen === 1 ? (
          <p className={PERINGATAN}>
            Jenis ini perlu dokumen pendukung (misalnya surat dokter). Pengajuan
            tetap bisa disimpan tanpa dokumen; lampirannya ditambahkan di
            rincian sesudah tersimpan.
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <button type="button" className={TOMBOL} onClick={onClose}>
            Batal
          </button>
          <button type="submit" className={TOMBOL_UTAMA} disabled={menyimpan}>
            Simpan
          </button>
        </div>
      </form>
    </Modal>
  );
}

/**
 * Jatah dan hari wajib pegawai untuk rentang form (§20.2.4: "hari terpakai dan
 * sisa sebelum disimpan"). Rentang belum lengkap atau gagal dimuat = tanpa
 * ringkasan; backend tetap menilai ulang saat simpan.
 */
function useRingkasanJatah(id: string, mulai: string, selesai: string) {
  const [hasil, setHasil] = useState<SaldoCuti["pegawai"]>(null);
  useEffect(() => {
    if (!id || !mulai || !selesai || selesai < mulai) {
      setHasil(null);
      return;
    }
    let batal = false;
    const tunda = setTimeout(() => {
      muatSaldoCuti(id, mulai, selesai)
        .then((s) => {
          if (!batal) setHasil(s.pegawai);
        })
        .catch(() => {
          if (!batal) setHasil(null);
        });
    }, 300);
    return () => {
      batal = true;
      clearTimeout(tunda);
    };
  }, [id, mulai, selesai]);
  return hasil;
}

/**
 * JP terdampak isian form guru sebelum disimpan (§20.5 layar 1). Tanpa guru
 * atau rentang belum lengkap = tanpa ringkasan.
 */
function useJpForm(
  id: string,
  mulai: string,
  selesai: string,
  jamMulai: number | null,
  jamSampai: number | null,
) {
  const [hasil, setHasil] = useState<JpTersusun[] | null>(null);
  useEffect(() => {
    if (!id || !mulai || !selesai || selesai < mulai) {
      setHasil(null);
      return;
    }
    let batal = false;
    const tunda = setTimeout(() => {
      muatJpTerdampak({
        draft: {
          id_karyawan: id,
          tanggal_mulai: mulai,
          tanggal_selesai: selesai,
          jam_mulai_ke: jamMulai,
          jam_sampai_ke: jamSampai,
        },
      })
        .then((d) => {
          if (!batal) setHasil(d.jp);
        })
        .catch(() => {
          if (!batal) setHasil(null);
        });
    }, 300);
    return () => {
      batal = true;
      clearTimeout(tunda);
    };
  }, [id, mulai, selesai, jamMulai, jamSampai]);
  return hasil;
}

/** JP terdampak satu pengajuan beserta penanganannya (rincian). */
function JpPengajuan({ idPengajuan }: { idPengajuan: string }) {
  const [jp, setJp] = useState<JpTersusun[] | null>(null);
  const [galat, setGalat] = useState<string | null>(null);
  useEffect(() => {
    let batal = false;
    muatJpTerdampak({ idPengajuan })
      .then((d) => {
        if (!batal) setJp(d.jp);
      })
      .catch((error) => {
        if (!batal) setGalat(pesanGalat(error));
      });
    return () => {
      batal = true;
    };
  }, [idPengajuan]);
  if (galat) return <p className="text-slate-400">{galat}</p>;
  if (!jp || jp.length === 0) return null;
  return (
    <section aria-labelledby="jp-pengajuan" className="space-y-2">
      <h3 id="jp-pengajuan" className="text-sm font-semibold text-white">
        Jam pelajaran terdampak ({jp.filter((j) => !j.penanganan).length} belum
        ditangani)
      </h3>
      <ul className="space-y-2">
        {jp.map((j) => (
          <li
            key={j.id_penanganan}
            className="rounded-xl border border-white/10 px-3 py-2"
          >
            <RingkasJp j={j} />
          </li>
        ))}
      </ul>
    </section>
  );
}

const TOMBOL_AKSI: [string, string][] = [
  ["Setujui", "Setujui"],
  ["Tolak", "Tolak"],
  ["Diketahui", "Tandai diketahui"],
  ["Batal", "Batalkan pengajuan"],
];

function RincianPengajuan({
  p,
  data,
  user,
  onClose,
  onSunting,
  onSelesai,
  onCetakSuratTugas,
}: {
  p: PengajuanTersusun;
  data: DaftarPengajuan;
  user: OperatorUser | null;
  onClose: () => void;
  onSunting: () => void;
  onSelesai: (pesan: string) => Promise<void>;
  /** Hanya Dinas Luar berlaku dan pemegang `hr.duty.manage` (§21.5). */
  onCetakSuratTugas?: () => void;
}) {
  const [alasan, setAlasan] = useState("");
  const [galat, setGalat] = useState<string | null>(null);
  const isSubmittingRef = useRef(false);
  const [menyimpan, setMenyimpan] = useState(false);

  const keadaan = {
    status: p.status,
    sudah_diketahui: p.keputusan.some((k) => k.jenis === "Diketahui"),
    pengaju_sendiri: samaOrang(p.diajukan_oleh, user?.username ?? ""),
    superadmin: Boolean(user?.isSuperadmin),
    karyawan_sendiri:
      data.sesi.id_karyawan !== "" && data.sesi.id_karyawan === p.id_karyawan,
    boleh_putus: hasPermission(
      user,
      p.izin_pemutus as Parameters<typeof hasPermission>[1],
    ),
    dalam_cakupan: dalamCakupan(
      data.sesi.lingkup_semua,
      data.sesi.unit,
      p.unit,
    ),
  };
  // Tombol yang ditampilkan dinilai aturan yang sama dengan backend; alasan
  // diisi contoh supaya tombol Tolak/Batal tetap tampil sebelum diketik.
  const aksiTersedia = TOMBOL_AKSI.filter(
    ([aksi]) => periksaAksi(aksi, "-", keadaan).ok,
  );
  const bolehSunting =
    hasPermission(user, "hr.request.submit") &&
    periksaSunting(p.status, keadaan.pengaju_sendiri, keadaan.superadmin).ok;

  const putuskan = async (aksi: string) => {
    const cek = periksaAksi(aksi, alasan, keadaan);
    if (!cek.ok) {
      setGalat(cek.pesan);
      return;
    }
    if (isSubmittingRef.current) return;
    isSubmittingRef.current = true;
    setMenyimpan(true);
    try {
      await putuskanPengajuan(p.id_pengajuan, aksi, alasan);
      await onSelesai(`Keputusan "${aksi}" tersimpan.`);
    } catch (error) {
      setGalat(pesanGalat(error));
    } finally {
      isSubmittingRef.current = false;
      setMenyimpan(false);
    }
  };

  return (
    <Modal
      title={`${p.nama_jenis}: ${p.nama}`}
      subtitle={p.status}
      onClose={onClose}
      hideFooter
      maxWidth="max-w-2xl"
    >
      <div className="space-y-4 text-sm">
        <dl className="grid gap-x-4 gap-y-2 sm:grid-cols-[10rem_1fr]">
          <dt className="text-slate-400">Tanggal</dt>
          <dd className="text-white">{rentangTeks(p)}</dd>
          <dt className="text-slate-400">Unit</dt>
          <dd className="text-white">{p.unit || "-"}</dd>
          <dt className="text-slate-400">Kelompok</dt>
          <dd className="text-white">
            {p.kelompok} · {p.dampak_gaji}
            {p.potong_jatah === 1 ? " · memotong jatah cuti" : ""}
          </dd>
          <dt className="text-slate-400">Alasan</dt>
          <dd className="break-words text-white">{p.alasan}</dd>
          <dt className="text-slate-400">Diajukan oleh</dt>
          <dd className="text-white">
            {p.diajukan_oleh} · {p.waktu_perangkat}
          </dd>
        </dl>
        {p.tanda.length > 0 ? (
          <ul className={PERINGATAN}>
            {p.tanda.map((t) => (
              <li key={t}>{LABEL_TANDA[t] ?? t}</li>
            ))}
          </ul>
        ) : null}
        {p.guru === 1 ? <JpPengajuan idPengajuan={p.id_pengajuan} /> : null}
        <LampiranPengajuan idPengajuan={p.id_pengajuan} />
        <section aria-labelledby="riwayat-keputusan" className="space-y-2">
          <h3
            id="riwayat-keputusan"
            className="text-sm font-semibold text-white"
          >
            Riwayat keputusan
          </h3>
          {p.keputusan.length === 0 ? (
            <p className="text-slate-400">Belum ada keputusan.</p>
          ) : (
            <ul className="space-y-1">
              {p.keputusan.map((k) => (
                <li key={k.id_keputusan} className="text-slate-300">
                  <span className="font-semibold text-white">{k.jenis}</span>{" "}
                  oleh {k.oleh} · {k.waktu_perangkat}
                  {k.sidik === p.sidik ? "" : " · atas isi lama"}
                  {k.diterima_cloud === null ? " · belum tersinkron" : ""}
                  {k.alasan ? (
                    <span className="block text-slate-400">{k.alasan}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>
        {galat ? (
          <p className="text-rose-300" role="alert">
            {galat}
          </p>
        ) : null}
        {aksiTersedia.length > 0 ? (
          <div className="space-y-3 border-t border-white/10 pt-3">
            <div>
              <label htmlFor="keputusan-alasan" className={LABEL}>
                Alasan (wajib untuk Tolak dan Batalkan)
              </label>
              <textarea
                id="keputusan-alasan"
                maxLength={500}
                rows={2}
                value={alasan}
                onChange={(e) => setAlasan(e.target.value)}
                className={`${INPUT} py-2`}
              />
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              {aksiTersedia.map(([aksi, label]) => (
                <button
                  key={aksi}
                  type="button"
                  data-konfirmasi
                  disabled={menyimpan}
                  className={aksi === "Setujui" ? TOMBOL_UTAMA : TOMBOL}
                  onClick={() => void putuskan(aksi)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        ) : null}
        {!keadaan.dalam_cakupan &&
        (p.status === "Menunggu" || statusBerlaku(p.status)) &&
        keadaan.boleh_putus ? (
          <p className="text-slate-400">
            {data.sesi.id_karyawan === ""
              ? "Akunmu belum ditautkan ke data personil, jadi belum bisa memutus pengajuan unit mana pun."
              : "Pegawai ini di luar unitmu."}
          </p>
        ) : null}
        <div className="flex flex-wrap justify-end gap-2">
          {onCetakSuratTugas ? (
            <button
              type="button"
              className={TOMBOL}
              onClick={onCetakSuratTugas}
            >
              Cetak Surat Tugas
            </button>
          ) : null}
          {bolehSunting ? (
            <button type="button" className={TOMBOL} onClick={onSunting}>
              Ubah pengajuan
            </button>
          ) : null}
          <button type="button" className={TOMBOL} onClick={onClose}>
            Tutup
          </button>
        </div>
      </div>
    </Modal>
  );
}
