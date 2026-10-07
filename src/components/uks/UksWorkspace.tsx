"use client";

import {
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  hariIniWib,
  INPUT,
  LABEL,
  pesanGalat,
  TOMBOL_BAHAYA,
  TOMBOL_KEDUA,
  TOMBOL_UTAMA,
} from "@/components/inventory/gaya";
import { Modal } from "@/components/ui/Modal";
import { hasPermission } from "@/lib/auth/access";
import { useAuth } from "@/lib/context/AuthContext";
import { subscribeSyncCompleted } from "@/lib/gateways/sync-status";
import {
  bukaKunjunganUks,
  type DaftarKunjunganUks,
  type FormDataUks,
  getFormDataUks,
  getKunjunganUks,
  getObatKunjunganUks,
  hapusKunjunganUks,
  type KunjunganUks,
  type ObatDraft,
  type ObatKunjungan,
  simpanKunjunganUks,
} from "@/lib/gateways/uks";
import { formatSejakSync } from "@/lib/validations/uks";

/**
 * UI Buku Kunjungan UKS, dipakai apa adanya oleh Web/Desktop dan Mobile
 * (`filesToCopy`). Kunjungan yang dicatat perangkat lain hanya bisa diubah
 * setelah salinannya diambil dari database, jadi setiap kali perangkat tidak
 * terhubung, halaman ini mengatakannya beserta kapan sinkronisasi terakhir
 * berhasil (permintaan User), bukan menampilkan daftar yang tampak lengkap.
 */

type Feedback = { tone: "success" | "error"; message: string } | null;
type SubmitRef = { current: boolean };

const KELUHAN_UMUM = [
  "Demam",
  "Pusing",
  "Sakit perut",
  "Luka",
  "Pingsan",
  "Mual",
];

function jamSekarangWib(): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Jakarta",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date());
}

function pesanOffline(detik: number | null): string {
  return `Sinkronisasi terakhir berhasil ${formatSejakSync(detik)}.`;
}

export function UksWorkspace() {
  const { user } = useAuth();
  const isSubmittingRef = useRef(false);
  const canRecord = hasPermission(user, "uks.record");
  const canDelete = hasPermission(user, "uks.delete");
  const hariIni = hariIniWib();

  const [dari, setDari] = useState(hariIni);
  const [sampai, setSampai] = useState(hariIni);
  const [cari, setCari] = useState("");
  const [data, setData] = useState<DaftarKunjunganUks | null>(null);
  const [memuat, setMemuat] = useState(true);
  const [galat, setGalat] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [formData, setFormData] = useState<FormDataUks | null>(null);
  const [formGalat, setFormGalat] = useState<string | null>(null);
  const [bukaBaru, setBukaBaru] = useState(false);
  const [simpan, setSimpan] = useState<{
    kunjungan: KunjunganUks;
    tutup: boolean;
  } | null>(null);
  const [hapus, setHapus] = useState<KunjunganUks | null>(null);

  const muat = useCallback(async () => {
    setMemuat(true);
    try {
      setData(await getKunjunganUks(dari, sampai, cari.trim() || null));
      setGalat(null);
    } catch (error) {
      setGalat(pesanGalat(error, "Daftar kunjungan tidak bisa dimuat."));
    } finally {
      setMemuat(false);
    }
  }, [dari, sampai, cari]);

  useEffect(() => {
    void muat();
  }, [muat]);

  useEffect(() => subscribeSyncCompleted(() => void muat()), [muat]);

  const siapkanForm = async () => {
    if (formData) return;
    try {
      setFormData(await getFormDataUks());
      setFormGalat(null);
    } catch (error) {
      setFormGalat(pesanGalat(error, "Data formulir tidak bisa dimuat."));
    }
  };

  const selesai = async (message: string) => {
    setFeedback({ tone: "success", message });
    setFormData(null);
    await muat();
  };

  // Kunjungan perangkat lain tidak bisa diubah tanpa koneksi.
  const terkunci = (kunjungan: KunjunganUks) =>
    !kunjungan.lokal && Boolean(data?.offline);

  return (
    <div className="space-y-6">
      {data?.offline ? (
        <output className="block p-4 rounded-xl border border-amber-500/30 bg-amber-500/20 text-sm text-amber-100 space-y-2">
          <span className="block font-semibold">
            Perangkat ini tidak terhubung ke database
          </span>
          <span className="block">
            Mencatat kunjungan baru dan menutup kunjungan yang dicatat di
            perangkat ini tetap bisa. Riwayat lengkap dan kunjungan dari
            perangkat lain baru bisa dibuka setelah perangkat terhubung.{" "}
            {pesanOffline(data.detik_sejak_sync)}
          </span>
          <button
            type="button"
            onClick={() => void muat()}
            className={TOMBOL_KEDUA}
          >
            Coba hubungkan lagi
          </button>
        </output>
      ) : null}

      {feedback ? (
        <output
          className={`flex items-start justify-between gap-3 p-3 rounded-lg border text-sm ${
            feedback.tone === "success"
              ? "border-emerald-500/30 bg-emerald-500/20 text-emerald-100"
              : "border-rose-500/30 bg-rose-500/20 text-rose-100"
          }`}
        >
          <span>{feedback.message}</span>
          <button
            type="button"
            onClick={() => setFeedback(null)}
            className="shrink-0 px-2 text-xs font-semibold underline rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
          >
            Tutup
          </button>
        </output>
      ) : null}

      <section aria-labelledby="uks-sedang-judul" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2
            id="uks-sedang-judul"
            className="text-base font-semibold text-slate-100"
          >
            Sedang di UKS
          </h2>
          {canRecord ? (
            <button
              type="button"
              onClick={() => {
                setBukaBaru(true);
                void siapkanForm();
              }}
              className={TOMBOL_UTAMA}
            >
              Kunjungan baru
            </button>
          ) : null}
        </div>
        {memuat && !data ? (
          <p className="p-6 text-center text-sm text-slate-400">
            Memuat kunjungan...
          </p>
        ) : galat ? (
          <div className="p-4 rounded-xl border border-rose-500/30 bg-rose-500/20 text-sm text-rose-100 space-y-3">
            <p>{galat}</p>
            <button
              type="button"
              onClick={() => void muat()}
              className={TOMBOL_KEDUA}
            >
              Coba muat lagi
            </button>
          </div>
        ) : !data || data.sedang.length === 0 ? (
          <p className="p-6 text-center text-sm text-slate-400 rounded-xl border border-dashed border-slate-800">
            Tidak ada yang sedang di UKS.
            {canRecord
              ? " Catat siswa atau guru yang datang lewat Kunjungan baru."
              : ""}
          </p>
        ) : (
          <ul className="space-y-2">
            {data.sedang.map((kunjungan) => (
              <li
                key={kunjungan.id_kunjungan}
                className="flex flex-col gap-3 p-4 rounded-xl border border-slate-800 bg-slate-900/60 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0 space-y-1">
                  <p className="font-semibold text-slate-100 wrap-break-word">
                    {kunjungan.nama_personil}
                    {kunjungan.kelas ? (
                      <span className="font-normal text-slate-400">
                        {" "}
                        · {kunjungan.kelas}
                      </span>
                    ) : null}
                  </p>
                  <p className="text-sm text-slate-300">
                    Masuk {kunjungan.jam_masuk}
                    {kunjungan.tanggal !== hariIni
                      ? ` (${kunjungan.tanggal})`
                      : ""}{" "}
                    · {kunjungan.keluhan}
                  </p>
                  <StatusSalinan kunjungan={kunjungan} data={data} />
                </div>
                {canRecord ? (
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={terkunci(kunjungan)}
                      onClick={() => {
                        setSimpan({ kunjungan, tutup: false });
                        void siapkanForm();
                      }}
                      className={TOMBOL_KEDUA}
                    >
                      Beri obat atau catatan
                    </button>
                    <button
                      type="button"
                      disabled={terkunci(kunjungan)}
                      onClick={() => {
                        setSimpan({ kunjungan, tutup: true });
                        void siapkanForm();
                      }}
                      className={TOMBOL_UTAMA}
                    >
                      Tutup kunjungan
                    </button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <Riwayat
        data={data}
        dari={dari}
        sampai={sampai}
        cari={cari}
        hariIni={hariIni}
        canRecord={canRecord}
        canDelete={canDelete}
        terkunci={terkunci}
        onFilter={(nilai) => {
          setDari(nilai.dari);
          setSampai(nilai.sampai);
          setCari(nilai.cari);
        }}
        onUbah={(kunjungan) => {
          setSimpan({ kunjungan, tutup: false });
          void siapkanForm();
        }}
        onHapus={setHapus}
      />

      {bukaBaru ? (
        <FormBuka
          formData={formData}
          formGalat={formGalat}
          isSubmittingRef={isSubmittingRef}
          onClose={() => setBukaBaru(false)}
          onSaved={async (message) => {
            setBukaBaru(false);
            await selesai(message);
          }}
        />
      ) : null}

      {simpan ? (
        <FormSimpan
          kunjungan={simpan.kunjungan}
          tutup={simpan.tutup}
          formData={formData}
          formGalat={formGalat}
          detikSejakSync={data?.detik_sejak_sync ?? null}
          isSubmittingRef={isSubmittingRef}
          onClose={() => setSimpan(null)}
          onSaved={async (message) => {
            setSimpan(null);
            await selesai(message);
          }}
        />
      ) : null}

      {hapus ? (
        <KonfirmasiHapus
          kunjungan={hapus}
          detikSejakSync={data?.detik_sejak_sync ?? null}
          isSubmittingRef={isSubmittingRef}
          onClose={() => setHapus(null)}
          onDone={async (message) => {
            setHapus(null);
            await selesai(message);
          }}
        />
      ) : null}
    </div>
  );
}

function StatusSalinan({
  kunjungan,
  data,
}: {
  kunjungan: KunjunganUks;
  data: DaftarKunjunganUks;
}) {
  if (kunjungan.belum_terkirim) {
    return (
      <p className="text-xs font-medium text-amber-300">
        Belum terkirim ke database. Akan terkirim otomatis saat perangkat
        terhubung.
      </p>
    );
  }
  if (!kunjungan.lokal) {
    return (
      <p className="text-xs text-slate-400">
        Dicatat di perangkat lain.{" "}
        {data.offline
          ? `Mengubahnya butuh koneksi ke database. ${pesanOffline(data.detik_sejak_sync)}`
          : "Salinannya diambil dari database saat diubah."}
      </p>
    );
  }
  return null;
}

// ── Riwayat & rekap ─────────────────────────────────────────────────────────

function Riwayat({
  data,
  dari,
  sampai,
  cari,
  hariIni,
  canRecord,
  canDelete,
  terkunci,
  onFilter,
  onUbah,
  onHapus,
}: {
  data: DaftarKunjunganUks | null;
  dari: string;
  sampai: string;
  cari: string;
  hariIni: string;
  canRecord: boolean;
  canDelete: boolean;
  terkunci: (kunjungan: KunjunganUks) => boolean;
  onFilter: (nilai: { dari: string; sampai: string; cari: string }) => void;
  onUbah: (kunjungan: KunjunganUks) => void;
  onHapus: (kunjungan: KunjunganUks) => void;
}) {
  const [filterDari, setFilterDari] = useState(dari);
  const [filterSampai, setFilterSampai] = useState(sampai);
  const [filterCari, setFilterCari] = useState(cari);
  const [terbuka, setTerbuka] = useState<string | null>(null);

  const baris = data?.baris ?? [];
  const rekap = useMemo(() => {
    const perKelas = new Map<string, number>();
    const perKeluhan = new Map<string, { label: string; jumlah: number }>();
    for (const kunjungan of baris) {
      const kelas = kunjungan.kelas ?? "Guru dan pegawai";
      perKelas.set(kelas, (perKelas.get(kelas) ?? 0) + 1);
      const kunci = kunjungan.keluhan.trim().toLowerCase();
      const lama = perKeluhan.get(kunci);
      perKeluhan.set(kunci, {
        label: lama?.label ?? kunjungan.keluhan.trim(),
        jumlah: (lama?.jumlah ?? 0) + 1,
      });
    }
    return {
      kelas: [...perKelas.entries()].sort((a, b) => b[1] - a[1]),
      keluhan: [...perKeluhan.values()]
        .sort((a, b) => b.jumlah - a.jumlah)
        .slice(0, 5),
    };
  }, [baris]);

  return (
    <section aria-labelledby="uks-riwayat-judul" className="space-y-3">
      <h2
        id="uks-riwayat-judul"
        className="text-base font-semibold text-slate-100"
      >
        Riwayat kunjungan
      </h2>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onFilter({
            dari: filterDari,
            sampai: filterSampai,
            cari: filterCari,
          });
        }}
        className="p-3 rounded-xl border border-slate-800 bg-slate-900/60 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4"
      >
        <div>
          <label htmlFor="uks-dari" className={LABEL}>
            Dari tanggal
          </label>
          <input
            id="uks-dari"
            type="date"
            max={filterSampai}
            value={filterDari}
            onChange={(e) => setFilterDari(e.target.value)}
            className={INPUT}
          />
        </div>
        <div>
          <label htmlFor="uks-sampai" className={LABEL}>
            Sampai tanggal
          </label>
          <input
            id="uks-sampai"
            type="date"
            min={filterDari}
            max={hariIni}
            value={filterSampai}
            onChange={(e) => setFilterSampai(e.target.value)}
            className={INPUT}
          />
        </div>
        <div>
          <label htmlFor="uks-cari" className={LABEL}>
            Cari nama, kelas, atau keluhan
          </label>
          <input
            id="uks-cari"
            type="search"
            value={filterCari}
            onChange={(e) => setFilterCari(e.target.value)}
            className={INPUT}
          />
        </div>
        <div className="flex items-end">
          <button type="submit" className={TOMBOL_KEDUA}>
            Tampilkan
          </button>
        </div>
      </form>

      {baris.length > 0 ? (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="p-3 rounded-xl border border-slate-800 bg-slate-900/60">
            <p className="text-sm font-semibold text-slate-200">
              Kunjungan per kelas
            </p>
            <ul className="mt-2 space-y-1 text-sm">
              {rekap.kelas.map(([kelas, jumlah]) => (
                <li
                  key={kelas}
                  className="flex justify-between gap-2 text-slate-300"
                >
                  <span>{kelas}</span>
                  <span className="font-semibold text-slate-100">{jumlah}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="p-3 rounded-xl border border-slate-800 bg-slate-900/60">
            <p className="text-sm font-semibold text-slate-200">
              Keluhan terbanyak
            </p>
            <ul className="mt-2 space-y-1 text-sm">
              {rekap.keluhan.map((item) => (
                <li
                  key={item.label}
                  className="flex justify-between gap-2 text-slate-300"
                >
                  <span className="wrap-break-word">{item.label}</span>
                  <span className="font-semibold text-slate-100">
                    {item.jumlah}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}

      {!data ? null : baris.length === 0 ? (
        <p className="p-6 text-center text-sm text-slate-400 rounded-xl border border-dashed border-slate-800">
          {data.offline
            ? "Tidak ada kunjungan di perangkat ini pada rentang tersebut. Riwayat dari perangkat lain tampil setelah terhubung."
            : "Tidak ada kunjungan pada rentang tanggal ini."}
        </p>
      ) : (
        <ul className="divide-y divide-slate-800 rounded-xl border border-slate-800 bg-slate-900/60">
          {baris.map((kunjungan) => {
            const buka = terbuka === kunjungan.id_kunjungan;
            return (
              <li key={kunjungan.id_kunjungan} className="px-4 py-3 space-y-2">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0 space-y-1">
                    <p className="text-xs text-slate-400">
                      {kunjungan.tanggal} · {kunjungan.jam_masuk}
                      {kunjungan.jam_keluar
                        ? `-${kunjungan.jam_keluar}`
                        : " (masih di UKS)"}
                    </p>
                    <p className="font-medium text-slate-100 wrap-break-word">
                      {kunjungan.nama_personil}
                      {kunjungan.kelas ? (
                        <span className="font-normal text-slate-400">
                          {" "}
                          · {kunjungan.kelas}
                        </span>
                      ) : null}
                    </p>
                    <p className="text-sm text-slate-300 wrap-break-word">
                      {kunjungan.keluhan}
                      {kunjungan.tindak_lanjut
                        ? ` · ${kunjungan.tindak_lanjut}`
                        : ""}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      aria-expanded={buka}
                      onClick={() =>
                        setTerbuka(buka ? null : kunjungan.id_kunjungan)
                      }
                      className={TOMBOL_KEDUA}
                    >
                      {buka ? "Tutup rincian" : "Rincian"}
                    </button>
                    {canRecord ? (
                      <button
                        type="button"
                        disabled={terkunci(kunjungan)}
                        onClick={() => onUbah(kunjungan)}
                        className={TOMBOL_KEDUA}
                      >
                        Ubah
                      </button>
                    ) : null}
                    {canDelete ? (
                      <button
                        type="button"
                        disabled={terkunci(kunjungan)}
                        onClick={() => onHapus(kunjungan)}
                        className={TOMBOL_KEDUA}
                      >
                        Hapus
                      </button>
                    ) : null}
                  </div>
                </div>
                {data ? (
                  <StatusSalinan kunjungan={kunjungan} data={data} />
                ) : null}
                {buka ? <Rincian kunjungan={kunjungan} /> : null}
              </li>
            );
          })}
        </ul>
      )}
      {data?.terpotong ? (
        <p className="text-xs text-amber-300">
          Hanya 500 kunjungan terbaru yang ditampilkan. Persempit rentang
          tanggal.
        </p>
      ) : null}
    </section>
  );
}

function Rincian({ kunjungan }: { kunjungan: KunjunganUks }) {
  const [obat, setObat] = useState<ObatKunjungan[] | null>(null);
  const [galat, setGalat] = useState<string | null>(null);

  useEffect(() => {
    getObatKunjunganUks(kunjungan.id_kunjungan)
      .then((hasil) => setObat(hasil.obat))
      .catch((error) =>
        setGalat(pesanGalat(error, "Daftar obat tidak bisa dimuat.")),
      );
  }, [kunjungan.id_kunjungan]);

  return (
    <dl className="grid grid-cols-1 gap-2 p-3 rounded-lg border border-slate-800 bg-slate-950/40 text-sm sm:grid-cols-2">
      <div>
        <dt className="text-xs text-slate-400">Tindakan</dt>
        <dd className="text-slate-200 wrap-break-word">
          {kunjungan.tindakan || "-"}
        </dd>
      </div>
      <div>
        <dt className="text-xs text-slate-400">Tindak lanjut</dt>
        <dd className="text-slate-200 wrap-break-word">
          {kunjungan.tindak_lanjut || "-"}
        </dd>
      </div>
      <div>
        <dt className="text-xs text-slate-400">Obat yang diberikan</dt>
        <dd className="text-slate-200">
          {galat ? (
            <span className="text-rose-200">{galat}</span>
          ) : obat === null ? (
            "Memuat..."
          ) : obat.length === 0 ? (
            "Tidak ada"
          ) : (
            <ul>
              {obat.map((item) => (
                <li key={item.id_mutasi}>
                  {item.nama_barang} {item.jumlah} {item.satuan}
                  {item.dibatalkan ? " (dibatalkan)" : ""}
                </li>
              ))}
            </ul>
          )}
        </dd>
      </div>
      <div>
        <dt className="text-xs text-slate-400">Petugas</dt>
        <dd className="text-slate-200">
          {kunjungan.dicatat_oleh}
          {kunjungan.ditutup_oleh &&
          kunjungan.ditutup_oleh !== kunjungan.dicatat_oleh
            ? `, ditutup ${kunjungan.ditutup_oleh}`
            : ""}
        </dd>
      </div>
      {kunjungan.catatan ? (
        <div className="sm:col-span-2">
          <dt className="text-xs text-slate-400">Catatan</dt>
          <dd className="text-slate-200 wrap-break-word">
            {kunjungan.catatan}
          </dd>
        </div>
      ) : null}
    </dl>
  );
}

// ── Baris obat ──────────────────────────────────────────────────────────────

interface BarisObatState {
  kunci: number;
  id_barang: string;
  posisi: string;
  jumlah: string;
}

function BarisObat({
  formData,
  baris,
  onChange,
}: {
  formData: FormDataUks;
  baris: BarisObatState[];
  onChange: (baris: BarisObatState[]) => void;
}) {
  const bersaldo = formData.barang.filter(
    (barang) => barang.status_aktif && barang.posisi.some((p) => p.saldo > 0),
  );
  const ubah = (kunci: number, sebagian: Partial<BarisObatState>) =>
    onChange(baris.map((b) => (b.kunci === kunci ? { ...b, ...sebagian } : b)));

  return (
    <fieldset className="space-y-2">
      <legend className={LABEL}>Obat yang diberikan</legend>
      {baris.length === 0 ? (
        <p className="text-xs text-slate-400">
          Belum ada obat. Stok berkurang otomatis saat disimpan.
        </p>
      ) : null}
      {baris.map((item, index) => {
        const barang = bersaldo.find((b) => b.id_barang === item.id_barang);
        const posisi = barang?.posisi.filter((p) => p.saldo > 0) ?? [];
        return (
          <div
            key={item.kunci}
            className="grid grid-cols-1 gap-2 p-2 rounded-lg border border-slate-800 sm:grid-cols-[2fr_2fr_1fr_auto]"
          >
            <div>
              <label htmlFor={`uks-obat-${index}`} className={LABEL}>
                Obat
              </label>
              <select
                id={`uks-obat-${index}`}
                value={item.id_barang}
                onChange={(e) =>
                  ubah(item.kunci, { id_barang: e.target.value, posisi: "0" })
                }
                className={INPUT}
              >
                <option value="">Pilih obat</option>
                {bersaldo.map((b) => (
                  <option key={b.id_barang} value={b.id_barang}>
                    {b.nama_barang}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor={`uks-obat-posisi-${index}`} className={LABEL}>
                Diambil dari
              </label>
              <select
                id={`uks-obat-posisi-${index}`}
                value={item.posisi}
                onChange={(e) => ubah(item.kunci, { posisi: e.target.value })}
                className={INPUT}
                disabled={!barang}
              >
                {posisi.map((p, i) => (
                  <option
                    key={`${p.tempat}|${p.id_batch ?? ""}|${p.kondisi}`}
                    value={String(i)}
                  >
                    {p.tempat}
                    {p.tanggal_expired
                      ? ` · kedaluwarsa ${p.tanggal_expired}`
                      : ""}{" "}
                    (sisa {p.saldo})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor={`uks-obat-jumlah-${index}`} className={LABEL}>
                Jumlah{barang ? ` (${barang.satuan})` : ""}
              </label>
              <input
                id={`uks-obat-jumlah-${index}`}
                type="number"
                min={1}
                step={1}
                inputMode="numeric"
                value={item.jumlah}
                onChange={(e) => ubah(item.kunci, { jumlah: e.target.value })}
                className={INPUT}
              />
            </div>
            <div className="flex items-end">
              <button
                type="button"
                onClick={() =>
                  onChange(baris.filter((b) => b.kunci !== item.kunci))
                }
                aria-label={`Hapus baris obat ${index + 1}`}
                className={TOMBOL_KEDUA}
              >
                Hapus
              </button>
            </div>
          </div>
        );
      })}
      {bersaldo.length === 0 ? (
        <p className="text-xs text-amber-300">
          Belum ada barang yang punya stok. Catat obat UKS sebagai barang masuk
          di Inventaris.
        </p>
      ) : (
        <button
          type="button"
          onClick={() =>
            onChange([
              ...baris,
              { kunci: Date.now(), id_barang: "", posisi: "0", jumlah: "1" },
            ])
          }
          className={TOMBOL_KEDUA}
        >
          Tambah obat
        </button>
      )}
    </fieldset>
  );
}

function obatDariBaris(
  formData: FormDataUks,
  baris: BarisObatState[],
): ObatDraft[] {
  return baris
    .filter((b) => b.id_barang)
    .map((b) => {
      const barang = formData.barang.find(
        (item) => item.id_barang === b.id_barang,
      );
      const posisi = barang?.posisi.filter((p) => p.saldo > 0)[
        Number(b.posisi)
      ];
      return {
        id_barang: b.id_barang,
        tempat: posisi?.tempat ?? "",
        kondisi: posisi?.kondisi ?? null,
        id_batch: posisi?.id_batch ?? null,
        jumlah: Number(b.jumlah),
      };
    });
}

// ── Form kunjungan baru ─────────────────────────────────────────────────────

function FormBuka({
  formData,
  formGalat,
  isSubmittingRef,
  onClose,
  onSaved,
}: {
  formData: FormDataUks | null;
  formGalat: string | null;
  isSubmittingRef: SubmitRef;
  onClose: () => void;
  onSaved: (message: string) => Promise<void>;
}) {
  const [cariOrang, setCariOrang] = useState("");
  const [idPersonil, setIdPersonil] = useState("");
  const [keluhan, setKeluhan] = useState("");
  const [jamMasuk, setJamMasuk] = useState(jamSekarangWib());
  const [catatan, setCatatan] = useState("");
  const [obat, setObat] = useState<BarisObatState[]>([]);
  const [galat, setGalat] = useState<string | null>(null);
  const [menyimpan, setMenyimpan] = useState(false);

  const personil = useMemo(() => {
    const kata = cariOrang.trim().toLowerCase();
    return (formData?.personil ?? [])
      .filter(
        (orang) =>
          !kata ||
          orang.nama.toLowerCase().includes(kata) ||
          orang.kelas?.toLowerCase().includes(kata),
      )
      .slice(0, 100);
  }, [formData, cariOrang]);

  const simpanBaru = async (event: FormEvent) => {
    event.preventDefault();
    if (isSubmittingRef.current || !formData) return;
    isSubmittingRef.current = true;
    setMenyimpan(true);
    setGalat(null);
    try {
      await bukaKunjunganUks({
        id_personil: idPersonil,
        jam_masuk: jamMasuk,
        keluhan,
        catatan,
        obat: obatDariBaris(formData, obat),
      });
      const nama =
        formData.personil.find((o) => o.id === idPersonil)?.nama ?? "Kunjungan";
      await onSaved(`${nama} tercatat masuk UKS pukul ${jamMasuk}.`);
    } catch (error) {
      setGalat(pesanGalat(error, "Kunjungan tidak bisa disimpan."));
    } finally {
      isSubmittingRef.current = false;
      setMenyimpan(false);
    }
  };

  return (
    <Modal
      isOpen={true}
      onClose={onClose}
      title="Kunjungan baru"
      titleId="uks-buka-judul"
    >
      {formGalat ? (
        <p role="alert" className="text-sm text-rose-200">
          {formGalat}
        </p>
      ) : !formData ? (
        <p className="text-sm text-slate-400">Memuat data formulir...</p>
      ) : (
        <form onSubmit={simpanBaru} className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="uks-cari-orang" className={LABEL}>
                Cari nama atau kelas
              </label>
              <input
                id="uks-cari-orang"
                type="search"
                value={cariOrang}
                onChange={(e) => setCariOrang(e.target.value)}
                className={INPUT}
              />
            </div>
            <div>
              <label htmlFor="uks-personil" className={LABEL}>
                Yang berkunjung
              </label>
              <select
                id="uks-personil"
                required
                value={idPersonil}
                onChange={(e) => setIdPersonil(e.target.value)}
                className={INPUT}
              >
                <option value="">Pilih personil</option>
                {personil.map((orang) => (
                  <option key={orang.id} value={orang.id}>
                    {orang.nama}
                    {orang.kelas
                      ? ` · ${orang.kelas}`
                      : orang.jenis
                        ? ` · ${orang.jenis}`
                        : ""}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="uks-keluhan" className={LABEL}>
                Keluhan
              </label>
              <input
                id="uks-keluhan"
                required
                maxLength={500}
                list="uks-keluhan-saran"
                value={keluhan}
                onChange={(e) => setKeluhan(e.target.value)}
                className={INPUT}
              />
              <datalist id="uks-keluhan-saran">
                {KELUHAN_UMUM.map((nilai) => (
                  <option key={nilai} value={nilai} />
                ))}
              </datalist>
            </div>
            <div>
              <label htmlFor="uks-jam-masuk" className={LABEL}>
                Jam masuk
              </label>
              <input
                id="uks-jam-masuk"
                type="time"
                required
                value={jamMasuk}
                onChange={(e) => setJamMasuk(e.target.value)}
                className={INPUT}
              />
            </div>
          </div>
          <BarisObat formData={formData} baris={obat} onChange={setObat} />
          <div>
            <label htmlFor="uks-catatan-buka" className={LABEL}>
              Catatan (opsional)
            </label>
            <input
              id="uks-catatan-buka"
              maxLength={500}
              value={catatan}
              onChange={(e) => setCatatan(e.target.value)}
              className={INPUT}
            />
          </div>
          {galat ? (
            <p
              role="alert"
              className="p-3 rounded-lg border border-rose-500/30 bg-rose-500/20 text-sm text-rose-100"
            >
              {galat}
            </p>
          ) : null}
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" onClick={onClose} className={TOMBOL_KEDUA}>
              Batal
            </button>
            <button type="submit" disabled={menyimpan} className={TOMBOL_UTAMA}>
              {menyimpan ? "Menyimpan..." : "Catat kunjungan"}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}

// ── Form simpan / tutup ─────────────────────────────────────────────────────

function galatDenganSinkron(
  error: unknown,
  cadangan: string,
  detik: number | null,
): string {
  // invokeDesktop hanya meneruskan pesan, bukan kode galat; kedua pesan UKS
  // yang menuntut koneksi dikenali dari isinya (`butuh_koneksi`, `butuh_salinan`).
  const pesan = pesanGalat(error, cadangan);
  return pesan.includes("tidak terhubung ke database") ||
    pesan.includes("dicatat di perangkat lain")
    ? `${pesan} ${pesanOffline(detik)}`
    : pesan;
}

function FormSimpan({
  kunjungan,
  tutup,
  formData,
  formGalat,
  detikSejakSync,
  isSubmittingRef,
  onClose,
  onSaved,
}: {
  kunjungan: KunjunganUks;
  tutup: boolean;
  formData: FormDataUks | null;
  formGalat: string | null;
  detikSejakSync: number | null;
  isSubmittingRef: SubmitRef;
  onClose: () => void;
  onSaved: (message: string) => Promise<void>;
}) {
  const sudahDitutup = kunjungan.jam_keluar !== null;
  const [jamKeluar, setJamKeluar] = useState(
    kunjungan.jam_keluar ?? jamSekarangWib(),
  );
  const [tindakan, setTindakan] = useState(kunjungan.tindakan ?? "");
  const [tindakLanjut, setTindakLanjut] = useState(
    kunjungan.tindak_lanjut ?? "",
  );
  const [catatan, setCatatan] = useState(kunjungan.catatan ?? "");
  const [obat, setObat] = useState<BarisObatState[]>([]);
  const [galat, setGalat] = useState<string | null>(null);
  const [menyimpan, setMenyimpan] = useState(false);
  const pakaiJamKeluar = tutup || sudahDitutup;
  const [kabariWali, setKabariWali] = useState(false);
  // Backend tetap yang memutuskan (siswa, sakelar, nomor wali); ini hanya
  // supaya kotaknya tidak muncul untuk guru atau pegawai.
  const orang = formData?.personil.find((p) => p.id === kunjungan.id_personil);
  const siswa =
    (orang?.jenis ?? "").trim().toLowerCase() === "siswa" ||
    (orang?.kelas ?? kunjungan.kelas) !== null;
  const tawarkanWa =
    tutup && !sudahDitutup && siswa && formData?.wa_uks_aktif === true;

  const kirim = async (event: FormEvent) => {
    event.preventDefault();
    if (isSubmittingRef.current || !formData) return;
    isSubmittingRef.current = true;
    setMenyimpan(true);
    setGalat(null);
    try {
      const hasil = await simpanKunjunganUks(kunjungan, {
        jam_keluar: pakaiJamKeluar ? jamKeluar : null,
        tindakan,
        tindak_lanjut: tindakLanjut,
        catatan,
        obat: obatDariBaris(formData, obat),
        kabari_wali: tawarkanWa && kabariWali,
      });
      const pesanWa =
        hasil.wa_diantre === true
          ? " Pesan untuk wali masuk antrean WhatsApp."
          : hasil.wa_diantre === false
            ? " Pesan untuk wali tidak diantre: nomor WhatsApp wali kosong atau tidak valid di data siswa."
            : "";
      await onSaved(
        hasil.ditutup && !sudahDitutup
          ? `Kunjungan ${kunjungan.nama_personil} ditutup pukul ${jamKeluar}.${pesanWa}`
          : `Kunjungan ${kunjungan.nama_personil} diperbarui.`,
      );
    } catch (error) {
      setGalat(
        galatDenganSinkron(
          error,
          "Kunjungan tidak bisa disimpan.",
          detikSejakSync,
        ),
      );
    } finally {
      isSubmittingRef.current = false;
      setMenyimpan(false);
    }
  };

  return (
    <Modal
      isOpen={true}
      onClose={onClose}
      title={tutup && !sudahDitutup ? "Tutup kunjungan" : "Perbarui kunjungan"}
      titleId="uks-simpan-judul"
    >
      {formGalat ? (
        <p role="alert" className="text-sm text-rose-200">
          {formGalat}
        </p>
      ) : !formData ? (
        <p className="text-sm text-slate-400">Memuat data formulir...</p>
      ) : (
        <form onSubmit={kirim} className="space-y-4">
          <p className="text-sm text-slate-300">
            {kunjungan.nama_personil}
            {kunjungan.kelas ? ` · ${kunjungan.kelas}` : ""}, masuk{" "}
            {kunjungan.jam_masuk}: {kunjungan.keluhan}
          </p>
          {!kunjungan.lokal ? (
            <p className="text-xs text-slate-400">
              Kunjungan ini dicatat di perangkat lain. Saat disimpan, salinannya
              diambil dulu dari database, jadi perangkat harus terhubung.
            </p>
          ) : null}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {pakaiJamKeluar ? (
              <div>
                <label htmlFor="uks-jam-keluar" className={LABEL}>
                  Jam keluar
                </label>
                <input
                  id="uks-jam-keluar"
                  type="time"
                  required
                  value={jamKeluar}
                  onChange={(e) => setJamKeluar(e.target.value)}
                  className={INPUT}
                />
              </div>
            ) : null}
            <div className={pakaiJamKeluar ? "" : "sm:col-span-2"}>
              <label htmlFor="uks-tindak-lanjut" className={LABEL}>
                Tindak lanjut{pakaiJamKeluar ? "" : " (opsional)"}
              </label>
              <input
                id="uks-tindak-lanjut"
                required={pakaiJamKeluar}
                maxLength={200}
                list="uks-tindak-lanjut-saran"
                value={tindakLanjut}
                onChange={(e) => setTindakLanjut(e.target.value)}
                className={INPUT}
                aria-describedby="uks-tindak-lanjut-bantuan"
              />
              <datalist id="uks-tindak-lanjut-saran">
                {formData.tindak_lanjut.map((nilai) => (
                  <option key={nilai} value={nilai} />
                ))}
              </datalist>
              <p
                id="uks-tindak-lanjut-bantuan"
                className="mt-1 text-xs text-slate-400"
              >
                Misalnya kembali ke kelas, pulang dijemput orang tua, atau
                dirujuk ke Puskesmas.
              </p>
            </div>
          </div>
          <div>
            <label htmlFor="uks-tindakan" className={LABEL}>
              Tindakan
            </label>
            <textarea
              id="uks-tindakan"
              rows={2}
              maxLength={500}
              value={tindakan}
              onChange={(e) => setTindakan(e.target.value)}
              className={INPUT}
            />
          </div>
          <BarisObat formData={formData} baris={obat} onChange={setObat} />
          <div>
            <label htmlFor="uks-catatan-simpan" className={LABEL}>
              Catatan (opsional)
            </label>
            <input
              id="uks-catatan-simpan"
              maxLength={500}
              value={catatan}
              onChange={(e) => setCatatan(e.target.value)}
              className={INPUT}
            />
          </div>
          {tawarkanWa ? (
            <div className="flex items-start gap-2">
              <input
                id="uks-kabari-wali"
                type="checkbox"
                checked={kabariWali}
                onChange={(e) => setKabariWali(e.target.checked)}
                className="mt-1 h-4 w-4 accent-emerald-500"
                aria-describedby="uks-kabari-wali-bantuan"
              />
              <div>
                <label
                  htmlFor="uks-kabari-wali"
                  className="text-sm font-semibold text-slate-200"
                >
                  Kabari wali lewat WhatsApp
                </label>
                <p
                  id="uks-kabari-wali-bantuan"
                  className="text-xs text-slate-400"
                >
                  Pesan memuat tanggal, jam masuk, dan tindak lanjut. Keluhan
                  tidak ikut kecuali template pesannya diubah di Pengaturan.
                </p>
              </div>
            </div>
          ) : null}
          {galat ? (
            <p
              role="alert"
              className="p-3 rounded-lg border border-rose-500/30 bg-rose-500/20 text-sm text-rose-100"
            >
              {galat}
            </p>
          ) : null}
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" onClick={onClose} className={TOMBOL_KEDUA}>
              Batal
            </button>
            <button type="submit" disabled={menyimpan} className={TOMBOL_UTAMA}>
              {menyimpan
                ? "Menyimpan..."
                : tutup && !sudahDitutup
                  ? "Tutup kunjungan"
                  : "Simpan"}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}

function KonfirmasiHapus({
  kunjungan,
  detikSejakSync,
  isSubmittingRef,
  onClose,
  onDone,
}: {
  kunjungan: KunjunganUks;
  detikSejakSync: number | null;
  isSubmittingRef: SubmitRef;
  onClose: () => void;
  onDone: (message: string) => Promise<void>;
}) {
  const [galat, setGalat] = useState<string | null>(null);
  const [menghapus, setMenghapus] = useState(false);

  const hapus = async () => {
    if (isSubmittingRef.current) return;
    isSubmittingRef.current = true;
    setMenghapus(true);
    setGalat(null);
    try {
      await hapusKunjunganUks(kunjungan);
      await onDone(
        `Kunjungan ${kunjungan.nama_personil} tanggal ${kunjungan.tanggal} dihapus.`,
      );
    } catch (error) {
      setGalat(
        galatDenganSinkron(
          error,
          "Kunjungan tidak bisa dihapus.",
          detikSejakSync,
        ),
      );
    } finally {
      isSubmittingRef.current = false;
      setMenghapus(false);
    }
  };

  return (
    <Modal
      isOpen={true}
      onClose={onClose}
      title="Hapus kunjungan"
      titleId="uks-hapus-judul"
    >
      <div className="space-y-4">
        <p className="text-sm text-slate-300">
          Catatan kunjungan {kunjungan.nama_personil} tanggal{" "}
          {kunjungan.tanggal} akan dihapus. Obat yang sudah diberikan tetap
          tercatat keluar dari stok.
        </p>
        {galat ? (
          <p
            role="alert"
            className="p-3 rounded-lg border border-rose-500/30 bg-rose-500/20 text-sm text-rose-100"
          >
            {galat}
          </p>
        ) : null}
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" onClick={onClose} className={TOMBOL_KEDUA}>
            Batal
          </button>
          <button
            type="button"
            onClick={() => void hapus()}
            disabled={menghapus}
            className={TOMBOL_BAHAYA}
          >
            {menghapus ? "Menghapus..." : "Hapus kunjungan"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
