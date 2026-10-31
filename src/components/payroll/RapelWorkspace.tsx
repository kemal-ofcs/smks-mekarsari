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
import {
  batalkanRapel,
  type CalonRapel,
  daftarRapel,
  hitungCalonRapel,
  type RapelItem,
  simpanRapel,
} from "@/lib/gateways/payroll-rapel";
import { subscribeSyncCompleted } from "@/lib/gateways/sync-status";
import { formatRupiah } from "@/lib/validations/accounting";
import {
  MAKS_ALASAN_BATAL_RAPEL,
  MAKS_BULAN_DETEKSI,
  STATUS_RAPEL,
  type StatusRapel,
} from "@/lib/validations/payroll-rapel";

/**
 * Seluruh UI rapel gaji, dipakai apa adanya oleh halaman Web/Desktop dan
 * Mobile (disalin lewat `filesToCopy`). Jumlah rapel tidak pernah dihitung di
 * sini: angkanya datang dari backend, yang menghitungnya dari slip beku.
 */

type Feedback = { tone: "success" | "error"; message: string } | null;

const KETERANGAN_STATUS: Record<StatusRapel, string> = {
  Menunggu: "Menunggu proses gaji berikutnya",
  Diproses: "Masuk proses gaji yang belum dibayar",
  Dibayar: "Sudah dibayar",
  Dibatalkan: "Dibatalkan",
};

const GALAT_KOTAK =
  "p-3 rounded-lg border border-rose-500/30 bg-rose-500/20 text-sm text-rose-100";

function bulanWib(geserBulan: number): string {
  const [tahun, bulan] = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
  })
    .format(new Date())
    .split("-")
    .map(Number);
  const indeks = tahun * 12 + (bulan - 1) + geserBulan;
  return `${Math.floor(indeks / 12)}-${String((indeks % 12) + 1).padStart(2, "0")}`;
}

export function RapelWorkspace() {
  const { user } = useAuth();
  const bolehKelola = hasPermission(user, "payroll.rapel.manage");

  const [items, setItems] = useState<RapelItem[] | null>(null);
  const [galatMuat, setGalatMuat] = useState<string | null>(null);
  const [filter, setFilter] = useState<StatusRapel | "">("");
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [cariBuka, setCariBuka] = useState(false);
  const [batal, setBatal] = useState<RapelItem | null>(null);

  const muat = useCallback(async () => {
    setGalatMuat(null);
    try {
      setItems((await daftarRapel()).items);
    } catch (error) {
      setGalatMuat(pesanGalat(error, "Daftar rapel tidak bisa dimuat."));
    }
  }, []);

  useEffect(() => {
    void muat();
  }, [muat]);
  useEffect(() => subscribeSyncCompleted(() => void muat()), [muat]);

  const tampil = useMemo(
    () => (items ?? []).filter((item) => !filter || item.status === filter),
    [items, filter],
  );
  const totalMenunggu = (items ?? [])
    .filter((item) => item.status === "Menunggu")
    .reduce((n, item) => n + item.jumlah, 0);

  async function selesai(pesan: string) {
    setFeedback({ tone: "success", message: pesan });
    await muat();
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-400">
        Rapel adalah selisih gaji bulan yang sudah dibayar karena tarifnya
        dinaikkan sesudahnya. Rapel yang disetujui dibayar sebagai tunjangan di
        proses gaji berikutnya, dan ikut dihitung PPh 21 serta BPJS bulan itu.
      </p>

      <div className="grid gap-3 sm:grid-cols-[16rem_auto] sm:items-end sm:justify-between">
        <div>
          <label className={LABEL} htmlFor="rapel-filter">
            Status rapel
          </label>
          <select
            id="rapel-filter"
            className={INPUT}
            value={filter}
            onChange={(e) => setFilter(e.target.value as StatusRapel | "")}
          >
            <option value="">Semua status</option>
            {STATUS_RAPEL.map((status) => (
              <option key={status} value={status}>
                {KETERANGAN_STATUS[status]}
              </option>
            ))}
          </select>
        </div>
        {bolehKelola ? (
          <button
            type="button"
            className={TOMBOL_UTAMA}
            onClick={() => setCariBuka(true)}
          >
            Cari selisih tarif
          </button>
        ) : null}
      </div>

      {totalMenunggu > 0 ? (
        <p className="text-sm text-slate-300">
          Akan dibayar di proses gaji berikutnya:{" "}
          <span className="font-semibold tabular-nums text-slate-100">
            {formatRupiah(totalMenunggu)}
          </span>
        </p>
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
            className="shrink-0 px-2 text-xs font-semibold underline focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 rounded"
          >
            Tutup
          </button>
        </output>
      ) : null}

      {galatMuat ? (
        <div className={`${GALAT_KOTAK} space-y-3`}>
          <p>{galatMuat}</p>
          <button
            type="button"
            className={TOMBOL_KEDUA}
            onClick={() => void muat()}
          >
            Coba muat lagi
          </button>
        </div>
      ) : items === null ? (
        <p className="p-6 text-center text-sm text-slate-400">
          Memuat rapel...
        </p>
      ) : tampil.length === 0 ? (
        <p className="p-6 text-center text-sm text-slate-400 rounded-xl border border-dashed border-slate-700">
          {items.length === 0
            ? 'Belum ada rapel. Tekan "Cari selisih tarif" setelah menaikkan tarif dengan tanggal berlaku mundur.'
            : "Tidak ada rapel dengan status ini."}
        </p>
      ) : (
        <ul className="divide-y divide-slate-800 rounded-xl border border-slate-800 bg-slate-900/60">
          {tampil.map((item) => (
            <li key={item.id_rapel} className="px-4 py-3">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <span className="text-sm font-semibold text-slate-100">
                  {item.nama_karyawan} · {item.label}
                </span>
                <span className="text-sm text-slate-100 tabular-nums">
                  {formatRupiah(item.jumlah)}
                </span>
              </div>
              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-400">
                <span className="text-slate-300">
                  {KETERANGAN_STATUS[item.status]}
                </span>
                <span className="tabular-nums">
                  Tarif {formatRupiah(item.rate_lama)} →{" "}
                  {formatRupiah(item.rate_baru)} per jam
                </span>
                <span>Disetujui {item.dibuat_oleh}</span>
                {item.alasan_batal ? (
                  <span>
                    Dibatalkan {item.dibatalkan_oleh}: {item.alasan_batal}
                  </span>
                ) : null}
              </div>
              {bolehKelola && item.status === "Menunggu" ? (
                <button
                  type="button"
                  className={`${TOMBOL_KEDUA} mt-2`}
                  onClick={() => setBatal(item)}
                >
                  Batalkan rapel
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {cariBuka ? (
        <DialogCari
          onClose={() => setCariBuka(false)}
          onTersimpan={async (disimpan) => {
            setCariBuka(false);
            await selesai(
              `${disimpan} rapel disetujui. Rapel dibayar di proses gaji berikutnya.`,
            );
          }}
        />
      ) : null}
      {batal ? (
        <DialogBatal
          item={batal}
          onClose={() => setBatal(null)}
          onSelesai={async () => {
            setBatal(null);
            await selesai("Rapel dibatalkan.");
          }}
        />
      ) : null}
    </div>
  );
}

function DialogCari({
  onClose,
  onTersimpan,
}: {
  onClose: () => void;
  onTersimpan: (disimpan: number) => Promise<void>;
}) {
  const [dari, setDari] = useState(() => bulanWib(-(MAKS_BULAN_DETEKSI - 1)));
  const [sampai, setSampai] = useState(() => bulanWib(0));
  const [calon, setCalon] = useState<CalonRapel[] | null>(null);
  const [dipilih, setDipilih] = useState<Set<string>>(new Set());
  const [galat, setGalat] = useState<string | null>(null);
  const [sibuk, setSibuk] = useState(false);
  const isSubmittingRef = useRef(false);

  async function hitung(event: FormEvent) {
    event.preventDefault();
    if (isSubmittingRef.current) return;
    isSubmittingRef.current = true;
    setSibuk(true);
    setGalat(null);
    try {
      const hasil = (await hitungCalonRapel(dari, sampai)).items;
      setCalon(hasil);
      setDipilih(
        new Set(
          hasil.filter((item) => !item.kelebihan_bayar).map((i) => i.id_item),
        ),
      );
    } catch (error) {
      setGalat(pesanGalat(error, "Selisih tarif tidak bisa dihitung."));
    } finally {
      isSubmittingRef.current = false;
      setSibuk(false);
    }
  }

  async function setujui() {
    if (isSubmittingRef.current || !calon) return;
    isSubmittingRef.current = true;
    setSibuk(true);
    setGalat(null);
    try {
      const hasil = await simpanRapel(
        calon
          .filter((item) => dipilih.has(item.id_item))
          .map((item) => ({ idItem: item.id_item, rateBaru: item.rate_baru })),
      );
      await onTersimpan(hasil.disimpan);
    } catch (error) {
      setGalat(pesanGalat(error, "Rapel tidak bisa disimpan."));
    } finally {
      isSubmittingRef.current = false;
      setSibuk(false);
    }
  }

  function ubahPilihan(id: string, centang: boolean) {
    setDipilih((lama) => {
      const baru = new Set(lama);
      if (centang) baru.add(id);
      else baru.delete(id);
      return baru;
    });
  }

  const total = (calon ?? [])
    .filter((item) => dipilih.has(item.id_item))
    .reduce((n, item) => n + item.jumlah, 0);

  return (
    <Modal
      isOpen
      onClose={onClose}
      title="Cari selisih tarif"
      maxWidth="max-w-2xl"
      hideFooter
    >
      <div className="space-y-4">
        <form
          data-tanpa-konfirmasi
          onSubmit={hitung}
          className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
        >
          <div>
            <label className={LABEL} htmlFor="rapel-dari">
              Gaji bulan
            </label>
            <input
              id="rapel-dari"
              type="month"
              required
              className={INPUT}
              value={dari}
              onChange={(e) => setDari(e.target.value)}
            />
          </div>
          <div>
            <label className={LABEL} htmlFor="rapel-sampai">
              Sampai bulan
            </label>
            <input
              id="rapel-sampai"
              type="month"
              required
              className={INPUT}
              value={sampai}
              onChange={(e) => setSampai(e.target.value)}
            />
          </div>
          <button type="submit" className={TOMBOL_KEDUA} disabled={sibuk}>
            {sibuk && calon === null ? "Menghitung..." : "Hitung"}
          </button>
        </form>
        <p className="text-xs text-slate-400">
          Hanya slip yang sudah dibayar. Selisih dihitung dari jam kerja,
          lembur, dan tunjangan persen yang tercatat di slip itu, paling lama{" "}
          {MAKS_BULAN_DETEKSI} bulan sekali cari. Honor mengajar per JP tidak
          dirapel.
        </p>

        {calon === null ? null : calon.length === 0 ? (
          <p className="p-4 text-center text-sm text-slate-400 rounded-xl border border-dashed border-slate-700">
            Tidak ada slip yang tarifnya berubah pada rentang ini.
          </p>
        ) : (
          <fieldset className="space-y-2">
            <legend className="sr-only">Pilih rapel yang disetujui</legend>
            <ul className="max-h-[50vh] overflow-y-auto divide-y divide-slate-800 rounded-xl border border-slate-800">
              {calon.map((item) => {
                const id = `rapel-calon-${item.id_item}`;
                return (
                  <li key={item.id_item} className="px-3 py-2">
                    <label
                      htmlFor={id}
                      className={`flex min-h-11 gap-3 ${item.kelebihan_bayar ? "opacity-70" : "cursor-pointer"}`}
                    >
                      <input
                        id={id}
                        type="checkbox"
                        className="mt-1 h-4 w-4 shrink-0"
                        disabled={item.kelebihan_bayar}
                        checked={dipilih.has(item.id_item)}
                        onChange={(e) =>
                          ubahPilihan(item.id_item, e.target.checked)
                        }
                      />
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-baseline justify-between gap-x-3">
                          <span className="text-sm font-semibold text-slate-100">
                            {item.nama_karyawan} · {item.label}
                          </span>
                          <span className="text-sm tabular-nums text-slate-100">
                            {formatRupiah(item.jumlah)}
                          </span>
                        </span>
                        <span className="mt-1 flex flex-wrap gap-x-3 text-xs text-slate-400 tabular-nums">
                          <span>
                            Tarif {formatRupiah(item.rate_lama)} →{" "}
                            {formatRupiah(item.rate_baru)}
                          </span>
                          <span>Pokok {formatRupiah(item.selisih_pokok)}</span>
                          {item.selisih_lembur !== 0 ? (
                            <span>
                              Lembur {formatRupiah(item.selisih_lembur)}
                            </span>
                          ) : null}
                          {item.selisih_komponen !== 0 ? (
                            <span>
                              Tunjangan persen{" "}
                              {formatRupiah(item.selisih_komponen)}
                            </span>
                          ) : null}
                        </span>
                        {item.kelebihan_bayar ? (
                          <span className="mt-1 block text-xs text-amber-100">
                            Tarif turun: ini kelebihan bayar, tidak dirapel dan
                            tidak dipotong otomatis.
                          </span>
                        ) : null}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </fieldset>
        )}

        {galat ? (
          <p role="alert" className={GALAT_KOTAK}>
            {galat}
          </p>
        ) : null}

        <div className="flex flex-wrap items-center justify-end gap-2">
          {calon && dipilih.size > 0 ? (
            <span className="mr-auto text-sm text-slate-300" aria-live="polite">
              {dipilih.size} rapel,{" "}
              <span className="tabular-nums">{formatRupiah(total)}</span>
            </span>
          ) : null}
          <button type="button" className={TOMBOL_KEDUA} onClick={onClose}>
            Tutup
          </button>
          {calon && calon.length > 0 ? (
            <button
              type="button"
              className={TOMBOL_UTAMA}
              disabled={sibuk || dipilih.size === 0}
              onClick={() => void setujui()}
            >
              Setujui rapel terpilih
            </button>
          ) : null}
        </div>
      </div>
    </Modal>
  );
}

function DialogBatal({
  item,
  onClose,
  onSelesai,
}: {
  item: RapelItem;
  onClose: () => void;
  onSelesai: () => Promise<void>;
}) {
  const [alasan, setAlasan] = useState("");
  const [galat, setGalat] = useState<string | null>(null);
  const [sibuk, setSibuk] = useState(false);
  const isSubmittingRef = useRef(false);

  async function kirim(event: FormEvent) {
    event.preventDefault();
    if (isSubmittingRef.current) return;
    isSubmittingRef.current = true;
    setSibuk(true);
    setGalat(null);
    try {
      await batalkanRapel(item.id_rapel, alasan);
      await onSelesai();
    } catch (error) {
      setGalat(pesanGalat(error, "Rapel tidak bisa dibatalkan."));
    } finally {
      isSubmittingRef.current = false;
      setSibuk(false);
    }
  }

  return (
    <Modal isOpen onClose={onClose} title="Batalkan rapel" hideFooter>
      <form data-tanpa-konfirmasi onSubmit={kirim} className="space-y-3">
        <p className="text-sm text-slate-300">
          {item.nama_karyawan}, {item.label}:{" "}
          <span className="tabular-nums">{formatRupiah(item.jumlah)}</span>.
          Rapel yang dibatalkan tidak dibayar, dan slipnya akan muncul lagi saat
          mencari selisih tarif.
        </p>
        <div>
          <label className={LABEL} htmlFor="rapel-alasan">
            Alasan pembatalan
          </label>
          <input
            id="rapel-alasan"
            required
            maxLength={MAKS_ALASAN_BATAL_RAPEL}
            className={INPUT}
            value={alasan}
            onChange={(e) => setAlasan(e.target.value)}
          />
        </div>
        {galat ? (
          <p role="alert" className={GALAT_KOTAK}>
            {galat}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <button type="button" className={TOMBOL_KEDUA} onClick={onClose}>
            Kembali
          </button>
          <button type="submit" className={TOMBOL_BAHAYA} disabled={sibuk}>
            Batalkan rapel
          </button>
        </div>
      </form>
    </Modal>
  );
}
