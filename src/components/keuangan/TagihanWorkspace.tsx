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
import {
  PanelBayar,
  PanelKuitansi,
  PanelSeri,
  PanelTinjauan,
} from "@/components/keuangan/PembayaranPanel";
import { PilihAkunBayar } from "@/components/keuangan/PilihAkunBayar";
import { RekapTagihan } from "@/components/keuangan/RekapTagihan";
import { Modal } from "@/components/ui/Modal";
import { PilihCari } from "@/components/ui/PilihCari";
import { hasPermission } from "@/lib/auth/access";
import { useAuth } from "@/lib/context/AuthContext";
import {
  batalkanTagihan,
  type DaftarTagihan,
  daftarKeringanan,
  daftarSiswaTagihan,
  daftarTagihan,
  getMasterTagihan,
  hapusTarif,
  type JenisTagihanItem,
  type KeringananItem,
  kirimPengingatTagihan,
  type MasterTagihan,
  type PratinjauTagihan,
  pratinjauTagihan,
  type SiswaTagihan,
  simpanJenisTagihan,
  simpanKeringanan,
  simpanPortalTagihan,
  simpanTarif,
  type TagihanItem,
  terbitkanTagihan,
} from "@/lib/gateways/billing";
import { subscribeSyncCompleted } from "@/lib/gateways/sync-status";
import { formatRupiah } from "@/lib/validations/accounting";
import {
  AKUN_PENDAPATAN_SPP,
  BATAS_DAFTAR_TAGIHAN,
  JENIS_KERINGANAN,
  type JenisKeringanan,
  PERIODIK,
  type Periodik,
} from "@/lib/validations/billing";
import { tanggalTampil } from "@/lib/validations/tutup-buku";

/**
 * Seluruh UI tagihan siswa, dipakai apa adanya oleh halaman Web/Desktop dan
 * Mobile (disalin lewat `filesToCopy`). Nominal, keringanan, dan sisa tidak
 * pernah dihitung di sini: semuanya datang dari backend.
 */

type Tab =
  | "tunggakan"
  | "bayar"
  | "kuitansi"
  | "tinjauan"
  | "rekap"
  | "terbitkan"
  | "jenis"
  | "keringanan"
  | "seri";
type Feedback = { tone: "success" | "error"; message: string } | null;

const LABEL_TAB: Record<Tab, string> = {
  tunggakan: "Tunggakan",
  bayar: "Bayar",
  kuitansi: "Kuitansi",
  tinjauan: "Tinjauan",
  rekap: "Rekap",
  terbitkan: "Terbitkan",
  jenis: "Jenis & Tarif",
  keringanan: "Keringanan",
  seri: "Seri Kuitansi",
};

const LABEL_PERIODIK: Record<Periodik, string> = {
  Bulanan: "Bulanan",
  Tahunan: "Per tahun ajaran",
  Sekali: "Sekali per siswa",
};

const GALAT_KOTAK =
  "p-3 rounded-lg border border-rose-500/30 bg-rose-500/20 text-sm text-rose-100";

function bacaNominal(teks: string): number {
  const digit = teks.replace(/\D/g, "");
  return digit ? Number(digit) : 0;
}

function Rp({ nilai }: { nilai: number }) {
  return <span className="tabular-nums">{formatRupiah(nilai)}</span>;
}

export function TagihanWorkspace() {
  const { user } = useAuth();
  const bolehKelola = hasPermission(user, "billing.manage");
  const bolehBatal = hasPermission(user, "billing.cancel");
  const bolehBayar = hasPermission(user, "billing.collect");
  const tabs = (Object.keys(LABEL_TAB) as Tab[]).filter(
    (id) =>
      (id !== "terbitkan" || bolehKelola) && (id !== "bayar" || bolehBayar),
  );

  const [tab, setTab] = useState<Tab>("tunggakan");
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [master, setMaster] = useState<MasterTagihan | null>(null);
  const [galatMaster, setGalatMaster] = useState<string | null>(null);

  const muatMaster = useCallback(async () => {
    setGalatMaster(null);
    try {
      setMaster(await getMasterTagihan());
    } catch (error) {
      setGalatMaster(pesanGalat(error, "Data tagihan tidak bisa dimuat."));
    }
  }, []);

  useEffect(() => {
    void muatMaster();
  }, [muatMaster]);
  useEffect(
    () => subscribeSyncCompleted(() => void muatMaster()),
    [muatMaster],
  );

  const info = (message: string) => setFeedback({ tone: "success", message });

  return (
    <div className="space-y-4">
      <div
        role="tablist"
        aria-label="Bagian tagihan"
        className="flex gap-1 p-1 rounded-xl border border-slate-800 bg-slate-900/60 overflow-x-auto"
      >
        {tabs.map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            id={`tab-tagihan-${id}`}
            aria-selected={tab === id}
            aria-controls={`panel-tagihan-${id}`}
            onClick={() => setTab(id)}
            className={`min-h-11 flex-1 whitespace-nowrap px-4 py-2 text-sm font-medium rounded-lg transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 ${
              tab === id
                ? "bg-sky-700 text-white"
                : "text-slate-300 hover:bg-slate-800"
            }`}
          >
            {LABEL_TAB[id]}
          </button>
        ))}
      </div>

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

      <div
        role="tabpanel"
        id={`panel-tagihan-${tab}`}
        aria-labelledby={`tab-tagihan-${tab}`}
      >
        {galatMaster ? (
          <div className={`${GALAT_KOTAK} space-y-3`}>
            <p>{galatMaster}</p>
            <button
              type="button"
              className={TOMBOL_KEDUA}
              onClick={() => void muatMaster()}
            >
              Coba muat lagi
            </button>
          </div>
        ) : tab === "bayar" ? (
          <PanelBayar bolehBatal={bolehBatal} onInfo={info} />
        ) : tab === "kuitansi" ? (
          <PanelKuitansi bolehBatal={bolehBatal} onInfo={info} />
        ) : tab === "tinjauan" ? (
          <PanelTinjauan bolehBatal={bolehBatal} onInfo={info} />
        ) : tab === "seri" ? (
          <PanelSeri bolehKelola={bolehKelola} onInfo={info} />
        ) : !master ? (
          <p className="p-10 text-center text-sm text-slate-400">
            Memuat data tagihan...
          </p>
        ) : tab === "tunggakan" ? (
          <PanelTunggakan
            master={master}
            bolehKelola={bolehKelola}
            bolehBatal={bolehBatal}
            onInfo={info}
          />
        ) : tab === "rekap" ? (
          <RekapTagihan master={master} />
        ) : tab === "terbitkan" ? (
          <PanelTerbitkan master={master} onInfo={info} />
        ) : tab === "jenis" ? (
          <PanelJenis
            master={master}
            bolehKelola={bolehKelola}
            onBerubah={async (pesan) => {
              info(pesan);
              await muatMaster();
            }}
          />
        ) : (
          <PanelKeringanan
            master={master}
            bolehKelola={bolehKelola}
            onInfo={info}
          />
        )}
      </div>
    </div>
  );
}

// ── Tunggakan ───────────────────────────────────────────────────────────────

function PanelTunggakan({
  master,
  bolehKelola,
  bolehBatal,
  onInfo,
}: {
  master: MasterTagihan;
  bolehKelola: boolean;
  bolehBatal: boolean;
  onInfo: (pesan: string) => void;
}) {
  const [periode, setPeriode] = useState("");
  const [idJenis, setIdJenis] = useState("");
  const [idRombel, setIdRombel] = useState("");
  const [status, setStatus] = useState("Aktif");
  const [jatuhTempo, setJatuhTempo] = useState("");
  const [data, setData] = useState<DaftarTagihan | null>(null);
  const [galatMuat, setGalatMuat] = useState<string | null>(null);
  const [dipilih, setDipilih] = useState<TagihanItem | null>(null);
  const [bukaPengingat, setBukaPengingat] = useState(false);
  const siswaMenunggak = useMemo(
    () =>
      new Set(
        (data?.items ?? [])
          .filter((item) => item.sisa > 0)
          .map((item) => item.id_siswa),
      ).size,
    [data],
  );

  const muat = useCallback(async () => {
    setGalatMuat(null);
    try {
      setData(
        await daftarTagihan({
          periode: periode.trim() || null,
          idJenisTagihan: idJenis || null,
          idRombel: idRombel || null,
          status: status || null,
          jatuhTempo: jatuhTempo || null,
        }),
      );
    } catch (error) {
      setGalatMuat(pesanGalat(error, "Daftar tagihan tidak bisa dimuat."));
    }
  }, [periode, idJenis, idRombel, status, jatuhTempo]);

  useEffect(() => {
    void muat();
  }, [muat]);
  useEffect(() => subscribeSyncCompleted(() => void muat()), [muat]);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <div>
          <label className={LABEL} htmlFor="tunggakan-periode">
            Periode (opsional)
          </label>
          <input
            id="tunggakan-periode"
            className={INPUT}
            placeholder="2026-07 atau 2026/2027"
            value={periode}
            onChange={(e) => setPeriode(e.target.value)}
          />
        </div>
        <div>
          <label className={LABEL} htmlFor="tunggakan-jenis">
            Jenis tagihan
          </label>
          <PilihCari
            id="tunggakan-jenis"
            className={INPUT}
            value={idJenis}
            onChange={(e) => setIdJenis(e.target.value)}
          >
            <option value="">Semua jenis</option>
            {master.jenis.map((item) => (
              <option key={item.id_jenis_tagihan} value={item.id_jenis_tagihan}>
                {item.nama}
              </option>
            ))}
          </PilihCari>
        </div>
        <div>
          <label className={LABEL} htmlFor="tunggakan-rombel">
            Rombel
          </label>
          <PilihCari
            id="tunggakan-rombel"
            className={INPUT}
            value={idRombel}
            onChange={(e) => setIdRombel(e.target.value)}
          >
            <option value="">Semua rombel</option>
            {master.rombel.map((item) => (
              <option key={item.id_rombel} value={item.id_rombel}>
                {item.nama_rombel}
              </option>
            ))}
          </PilihCari>
        </div>
        <div>
          <label className={LABEL} htmlFor="tunggakan-status">
            Status tagihan
          </label>
          <select
            id="tunggakan-status"
            className={INPUT}
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="Aktif">Belum lunas</option>
            <option value="Lunas">Lunas</option>
            <option value="Dibatalkan">Dibatalkan</option>
            <option value="">Semua</option>
          </select>
        </div>
        <div>
          <label className={LABEL} htmlFor="tunggakan-jatuh-tempo">
            Jatuh tempo
          </label>
          <select
            id="tunggakan-jatuh-tempo"
            className={INPUT}
            value={jatuhTempo}
            onChange={(e) => setJatuhTempo(e.target.value)}
          >
            <option value="">Semua</option>
            <option value="lewat">Lewat jatuh tempo</option>
            <option value="segera">Jatuh tempo 7 hari lagi atau kurang</option>
            <option value="belum">Belum jatuh tempo</option>
          </select>
        </div>
      </div>

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
      ) : !data ? (
        <p className="p-6 text-center text-sm text-slate-400">
          Memuat tagihan...
        </p>
      ) : data.items.length === 0 ? (
        <p className="p-6 text-center text-sm text-slate-400 rounded-xl border border-dashed border-slate-700">
          Tidak ada tagihan dengan saringan ini.
        </p>
      ) : (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-slate-300">
              {data.items.length} tagihan, sisa <Rp nilai={data.total_sisa} />
            </p>
            {bolehKelola && siswaMenunggak > 0 ? (
              data.pengingat_wa ? (
                <button
                  type="button"
                  className={TOMBOL_KEDUA}
                  onClick={() => setBukaPengingat(true)}
                >
                  Kirim pengingat WhatsApp
                </button>
              ) : (
                <p className="text-xs text-slate-400">
                  Pengingat WhatsApp belum dinyalakan. Sakelarnya ada di
                  Pengaturan bagian Notifikasi WhatsApp (Web/Desktop) atau
                  tombol Gateway di halaman Notifikasi WA (Mobile).
                </p>
              )
            ) : null}
          </div>
          <ul className="divide-y divide-slate-800 rounded-xl border border-slate-800 bg-slate-900/60">
            {data.items.map((item) => (
              <li key={item.id_tagihan}>
                <button
                  type="button"
                  onClick={() => setDipilih(item)}
                  className="w-full min-h-11 px-4 py-3 text-left hover:bg-slate-800/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
                >
                  <span className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                    <span className="text-sm font-semibold text-slate-100">
                      {item.nama_siswa}
                      {item.kelas ? (
                        <span className="font-normal text-slate-400">
                          {" "}
                          {item.kelas}
                        </span>
                      ) : null}
                    </span>
                    <span className="text-sm text-slate-100">
                      {item.status === "Aktif" ? (
                        <Rp nilai={item.sisa} />
                      ) : (
                        item.status
                      )}
                    </span>
                  </span>
                  <span className="mt-1 flex flex-wrap gap-2 text-xs text-slate-400">
                    <span className="text-slate-300">
                      {item.nama_tagihan}{" "}
                      {item.periode === "SEKALI" ? "" : item.periode}
                    </span>
                    <span>Jatuh tempo {tanggalTampil(item.jatuh_tempo)}</span>
                    {item.potongan > 0 ? (
                      <span>
                        Keringanan <Rp nilai={item.potongan} />
                      </span>
                    ) : null}
                    {item.status === "Aktif" && item.dibayar > 0 ? (
                      <span>
                        Sudah dibayar <Rp nilai={item.dibayar} />
                      </span>
                    ) : null}
                    {item.terlambat ? (
                      <span className="rounded px-1.5 border border-amber-500/30 bg-amber-500/20 text-amber-100">
                        Lewat jatuh tempo
                      </span>
                    ) : null}
                    {item.status === "Dibatalkan" ? (
                      <span className="rounded px-1.5 border border-rose-500/30 bg-rose-500/20 text-rose-100">
                        Dibatalkan
                      </span>
                    ) : null}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {data.items.length >= BATAS_DAFTAR_TAGIHAN ? (
            <p className="text-xs text-slate-400">
              Hanya {BATAS_DAFTAR_TAGIHAN} tagihan pertama yang ditampilkan.
              Persempit dengan periode, jenis, atau rombel.
            </p>
          ) : null}
        </div>
      )}

      {bukaPengingat ? (
        <DialogPengingat
          filter={{
            periode: periode.trim() || null,
            idJenisTagihan: idJenis || null,
            idRombel: idRombel || null,
            jatuhTempo: jatuhTempo || null,
          }}
          jumlahSiswa={siswaMenunggak}
          onClose={() => setBukaPengingat(false)}
          onSelesai={(pesan) => {
            setBukaPengingat(false);
            onInfo(pesan);
          }}
        />
      ) : null}

      {dipilih ? (
        <DialogTagihan
          item={dipilih}
          bolehBatal={bolehBatal}
          onClose={() => setDipilih(null)}
          onDibatalkan={async () => {
            setDipilih(null);
            onInfo(`Tagihan ${dipilih.nama_siswa} dibatalkan.`);
            await muat();
          }}
        />
      ) : null}
    </div>
  );
}

/** Kalimat hasil pengingat; yang dilewati disebut beserta dua alasannya. */
function pesanPengingat(hasil: {
  siswa: number;
  diantre: number;
  terpotong: boolean;
}): string {
  const lewat = hasil.siswa - hasil.diantre;
  return [
    hasil.diantre > 0
      ? `${hasil.diantre} pesan pengingat masuk antrean WhatsApp.`
      : "Tidak ada pesan baru yang masuk antrean.",
    lewat > 0
      ? `${lewat} siswa dilewati karena walinya sudah diingatkan hari ini atau nomor WhatsApp walinya kosong.`
      : "",
    hasil.terpotong
      ? "Hanya 500 siswa pertama yang diproses. Persempit saringan lalu kirim lagi untuk sisanya."
      : "",
  ]
    .filter(Boolean)
    .join(" ");
}

function DialogPengingat({
  filter,
  jumlahSiswa,
  onClose,
  onSelesai,
}: {
  filter: {
    periode: string | null;
    idJenisTagihan: string | null;
    idRombel: string | null;
    jatuhTempo: string | null;
  };
  jumlahSiswa: number;
  onClose: () => void;
  onSelesai: (pesan: string) => void;
}) {
  const [galat, setGalat] = useState<string | null>(null);
  const [sibuk, setSibuk] = useState(false);
  const isSubmittingRef = useRef(false);

  async function kirim() {
    if (isSubmittingRef.current) return;
    isSubmittingRef.current = true;
    setSibuk(true);
    setGalat(null);
    try {
      onSelesai(pesanPengingat(await kirimPengingatTagihan(filter)));
    } catch (error) {
      setGalat(pesanGalat(error, "Pengingat tidak bisa diantre."));
    } finally {
      isSubmittingRef.current = false;
      setSibuk(false);
    }
  }

  return (
    <Modal isOpen onClose={onClose} title="Kirim pengingat tagihan" hideFooter>
      <div className="space-y-4 text-sm text-slate-200">
        <p>
          Wali dari {jumlahSiswa} siswa di daftar ini akan menerima satu pesan
          WhatsApp. Pesannya memuat seluruh tunggakan siswa, termasuk yang tidak
          tampil karena saringan.
        </p>
        <p className="text-slate-400">
          Wali yang sudah diingatkan hari ini dilewati. Pesan terkirim saat
          antrean WhatsApp dikirim, otomatis atau dari halaman Notifikasi WA.
        </p>
        {galat ? (
          <p role="alert" className={GALAT_KOTAK}>
            {galat}
          </p>
        ) : null}
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className={TOMBOL_KEDUA} onClick={onClose}>
            Batal
          </button>
          <button
            type="button"
            className={TOMBOL_UTAMA}
            disabled={sibuk}
            onClick={() => void kirim()}
          >
            {sibuk ? "Mengantre..." : "Kirim pengingat"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function DialogTagihan({
  item,
  bolehBatal,
  onClose,
  onDibatalkan,
}: {
  item: TagihanItem;
  bolehBatal: boolean;
  onClose: () => void;
  onDibatalkan: () => Promise<void>;
}) {
  const [alasan, setAlasan] = useState("");
  const [galat, setGalat] = useState<string | null>(null);
  const [sibuk, setSibuk] = useState(false);
  const isSubmittingRef = useRef(false);

  async function batalkan(event: FormEvent) {
    event.preventDefault();
    if (isSubmittingRef.current) return;
    isSubmittingRef.current = true;
    setSibuk(true);
    setGalat(null);
    try {
      await batalkanTagihan(item.id_tagihan, alasan);
      await onDibatalkan();
    } catch (error) {
      setGalat(pesanGalat(error, "Tagihan tidak bisa dibatalkan."));
    } finally {
      isSubmittingRef.current = false;
      setSibuk(false);
    }
  }

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={`Tagihan ${item.nama_siswa}`}
      hideFooter
    >
      <div className="space-y-4 text-sm">
        <dl className="grid gap-2 grid-cols-2">
          <div>
            <dt className="text-xs text-slate-400">Tagihan</dt>
            <dd className="text-slate-100">
              {item.nama_tagihan}{" "}
              {item.periode === "SEKALI" ? "" : item.periode}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-slate-400">Kelas</dt>
            <dd className="text-slate-100">{item.kelas || "-"}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-400">Nominal</dt>
            <dd className="text-slate-100">
              <Rp nilai={item.nominal} />
            </dd>
          </div>
          <div>
            <dt className="text-xs text-slate-400">Keringanan</dt>
            <dd className="text-slate-100">
              <Rp nilai={item.potongan} />
            </dd>
          </div>
          <div>
            <dt className="text-xs text-slate-400">Jatuh tempo</dt>
            <dd className="text-slate-100">
              {tanggalTampil(item.jatuh_tempo)}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-slate-400">Sudah dibayar</dt>
            <dd className="text-slate-100">
              <Rp nilai={item.dibayar} />
            </dd>
          </div>
          <div>
            <dt className="text-xs text-slate-400">Status</dt>
            <dd className="text-slate-100">
              {item.status === "Aktif"
                ? `Sisa ${formatRupiah(item.sisa)}`
                : item.status}
            </dd>
          </div>
          {item.alasan_batal ? (
            <div className="col-span-2">
              <dt className="text-xs text-slate-400">Alasan pembatalan</dt>
              <dd className="text-slate-100 break-words">
                {item.alasan_batal}
              </dd>
            </div>
          ) : null}
        </dl>

        {item.status === "Aktif" && item.dibayar > 0 && bolehBatal ? (
          <p className="text-xs text-slate-400">
            Tagihan yang sudah dibayar sebagian tidak bisa dibatalkan langsung.
            Batalkan kuitansinya atau pindahkan ke titipan dari tab Kuitansi.
          </p>
        ) : item.status === "Aktif" && bolehBatal ? (
          <form
            data-tanpa-konfirmasi
            onSubmit={batalkan}
            className="space-y-2 p-3 rounded-lg border border-rose-500/30"
          >
            <label className={LABEL} htmlFor="tagihan-alasan-batal">
              Alasan pembatalan
            </label>
            <input
              id="tagihan-alasan-batal"
              required
              maxLength={150}
              className={INPUT}
              value={alasan}
              onChange={(e) => setAlasan(e.target.value)}
            />
            <p className="text-xs text-slate-400">
              Tagihan tidak dihapus. Jurnal pendapatannya dibalik, dan tagihan
              untuk siswa dan periode yang sama tidak bisa diterbitkan lagi.
            </p>
            {galat ? (
              <p role="alert" className={GALAT_KOTAK}>
                {galat}
              </p>
            ) : null}
            <button type="submit" className={TOMBOL_BAHAYA} disabled={sibuk}>
              {sibuk ? "Membatalkan..." : "Batalkan tagihan"}
            </button>
          </form>
        ) : null}
      </div>
    </Modal>
  );
}

// ── Terbitkan ───────────────────────────────────────────────────────────────

function bulanIni(): string {
  return hariIniWib().slice(0, 7);
}

function PanelTerbitkan({
  master,
  onInfo,
}: {
  master: MasterTagihan;
  onInfo: (pesan: string) => void;
}) {
  const jenisAktif = useMemo(
    () => master.jenis.filter((item) => item.is_aktif === 1),
    [master.jenis],
  );
  const [idJenis, setIdJenis] = useState(jenisAktif[0]?.id_jenis_tagihan ?? "");
  const jenis = jenisAktif.find((item) => item.id_jenis_tagihan === idJenis);
  const [bulan, setBulan] = useState(bulanIni());
  const [tahunAjaran, setTahunAjaran] = useState(master.tahun_ajaran[0] ?? "");
  const [unit, setUnit] = useState("");
  const [idRombel, setIdRombel] = useState("");
  const [jatuhTempo, setJatuhTempo] = useState(`${bulanIni()}-10`);
  const [pratinjau, setPratinjau] = useState<PratinjauTagihan | null>(null);
  const [galat, setGalat] = useState<string | null>(null);
  const [yakin, setYakin] = useState(false);
  const [sibuk, setSibuk] = useState(false);
  const isSubmittingRef = useRef(false);

  const periode =
    jenis?.periodik === "Bulanan"
      ? bulan
      : jenis?.periodik === "Tahunan"
        ? tahunAjaran
        : "SEKALI";

  // Pratinjau usang begitu saringannya berubah.
  // biome-ignore lint/correctness/useExhaustiveDependencies: saringan sengaja jadi pemicu.
  useEffect(() => {
    setPratinjau(null);
    setYakin(false);
  }, [idJenis, periode, unit, idRombel]);

  async function lihat() {
    if (!idJenis) return;
    setGalat(null);
    setSibuk(true);
    try {
      setPratinjau(
        await pratinjauTagihan(
          idJenis,
          periode,
          unit || null,
          idRombel || null,
        ),
      );
    } catch (error) {
      setGalat(pesanGalat(error, "Pratinjau tidak bisa dibuat."));
    } finally {
      setSibuk(false);
    }
  }

  async function terbitkan() {
    if (isSubmittingRef.current) return;
    isSubmittingRef.current = true;
    setSibuk(true);
    setGalat(null);
    try {
      const hasil = await terbitkanTagihan(
        idJenis,
        periode,
        jatuhTempo,
        unit || null,
        idRombel || null,
      );
      onInfo(
        `${hasil.terbit} tagihan terbit${hasil.dilewati > 0 ? `, ${hasil.dilewati} dilewati karena sudah ada` : ""}.`,
      );
      setPratinjau(null);
      setYakin(false);
    } catch (error) {
      setGalat(pesanGalat(error, "Tagihan tidak bisa diterbitkan."));
    } finally {
      isSubmittingRef.current = false;
      setSibuk(false);
    }
  }

  if (jenisAktif.length === 0) {
    return (
      <p className="p-6 text-center text-sm text-slate-400 rounded-xl border border-dashed border-slate-700">
        Belum ada jenis tagihan aktif. Buat dulu di tab Jenis & Tarif.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div>
          <label className={LABEL} htmlFor="terbit-jenis">
            Jenis tagihan
          </label>
          <PilihCari
            id="terbit-jenis"
            className={INPUT}
            value={idJenis}
            onChange={(e) => setIdJenis(e.target.value)}
          >
            {jenisAktif.map((item) => (
              <option key={item.id_jenis_tagihan} value={item.id_jenis_tagihan}>
                {item.nama} ({LABEL_PERIODIK[item.periodik]})
              </option>
            ))}
          </PilihCari>
        </div>
        {jenis?.periodik === "Bulanan" ? (
          <div>
            <label className={LABEL} htmlFor="terbit-bulan">
              Bulan tagihan
            </label>
            <input
              id="terbit-bulan"
              type="month"
              className={INPUT}
              value={bulan}
              onChange={(e) => {
                setBulan(e.target.value);
                if (e.target.value) setJatuhTempo(`${e.target.value}-10`);
              }}
            />
          </div>
        ) : jenis?.periodik === "Tahunan" ? (
          <div>
            <label className={LABEL} htmlFor="terbit-tahun">
              Tahun ajaran
            </label>
            <PilihCari
              id="terbit-tahun"
              className={INPUT}
              value={tahunAjaran}
              onChange={(e) => setTahunAjaran(e.target.value)}
            >
              {master.tahun_ajaran.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </PilihCari>
          </div>
        ) : (
          <p className="self-end text-xs text-slate-400">
            Tagihan ini hanya terbit sekali untuk setiap siswa.
          </p>
        )}
        <div>
          <label className={LABEL} htmlFor="terbit-jatuh-tempo">
            Jatuh tempo
          </label>
          <input
            id="terbit-jatuh-tempo"
            type="date"
            className={INPUT}
            value={jatuhTempo}
            onChange={(e) => setJatuhTempo(e.target.value)}
          />
        </div>
        <div>
          <label className={LABEL} htmlFor="terbit-unit">
            Unit
          </label>
          <PilihCari
            id="terbit-unit"
            className={INPUT}
            value={unit}
            onChange={(e) => setUnit(e.target.value)}
          >
            <option value="">Semua unit</option>
            {master.unit.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </PilihCari>
        </div>
        <div>
          <label className={LABEL} htmlFor="terbit-rombel">
            Rombel
          </label>
          <PilihCari
            id="terbit-rombel"
            className={INPUT}
            value={idRombel}
            onChange={(e) => setIdRombel(e.target.value)}
          >
            <option value="">Semua rombel</option>
            {master.rombel.map((item) => (
              <option key={item.id_rombel} value={item.id_rombel}>
                {item.nama_rombel}
              </option>
            ))}
          </PilihCari>
        </div>
      </div>

      <button
        type="button"
        className={TOMBOL_KEDUA}
        disabled={sibuk}
        onClick={() => void lihat()}
      >
        Lihat pratinjau
      </button>

      {galat ? (
        <p role="alert" className={GALAT_KOTAK}>
          {galat}
        </p>
      ) : null}

      {pratinjau ? (
        <section className="space-y-3" aria-live="polite">
          <p className="text-sm text-slate-200">
            {pratinjau.jumlah_baru} tagihan baru, total{" "}
            <Rp nilai={pratinjau.total_bersih} />
            {pratinjau.jumlah_sudah_ada > 0
              ? `. ${pratinjau.jumlah_sudah_ada} siswa dilewati karena sudah punya tagihan periode ini.`
              : "."}
          </p>
          {pratinjau.items.length > 0 ? (
            <div className="max-h-80 overflow-auto rounded-xl border border-slate-800">
              <table className="w-full text-left text-sm">
                <thead className="text-xs text-slate-400">
                  <tr>
                    <th className="px-3 py-2 font-medium">Siswa</th>
                    <th className="px-3 py-2 font-medium text-right">
                      Nominal
                    </th>
                    <th className="px-3 py-2 font-medium text-right">
                      Keringanan
                    </th>
                    <th className="px-3 py-2 font-medium text-right">Bersih</th>
                  </tr>
                </thead>
                <tbody>
                  {pratinjau.items.map((item) => (
                    <tr
                      key={item.id_siswa}
                      className="border-t border-slate-800"
                    >
                      <td className="px-3 py-2 text-slate-100">
                        {item.nama}
                        <span className="block text-xs text-slate-400">
                          {item.kelas}
                          {item.sudah_ada ? ", sudah punya tagihan" : ""}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right text-slate-100">
                        <Rp nilai={item.nominal} />
                      </td>
                      <td className="px-3 py-2 text-right text-slate-100">
                        {item.potongan ? <Rp nilai={item.potongan} /> : null}
                      </td>
                      <td className="px-3 py-2 text-right text-slate-100">
                        <Rp nilai={item.bersih} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          {pratinjau.jumlah_baru > 0 ? (
            yakin ? (
              <button
                type="button"
                className={TOMBOL_UTAMA}
                disabled={sibuk}
                onClick={() => void terbitkan()}
              >
                {sibuk
                  ? "Menerbitkan..."
                  : `Ya, terbitkan ${pratinjau.jumlah_baru} tagihan`}
              </button>
            ) : (
              <button
                type="button"
                className={TOMBOL_UTAMA}
                onClick={() => setYakin(true)}
              >
                Terbitkan tagihan
              </button>
            )
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

// ── Jenis & tarif ───────────────────────────────────────────────────────────

/**
 * Sakelar halaman Tagihan di portal wali (K4c). Disimpan sebagai setting
 * tersinkron, jadi berlaku untuk situs publik begitu sampai ke cloud.
 */
function PortalWali({
  master,
  bolehKelola,
  onBerubah,
}: {
  master: MasterTagihan;
  bolehKelola: boolean;
  onBerubah: (pesan: string) => Promise<void>;
}) {
  const [galat, setGalat] = useState<string | null>(null);
  const [sibuk, setSibuk] = useState(false);
  const isSubmittingRef = useRef(false);

  async function ubah(aktif: boolean) {
    if (isSubmittingRef.current) return;
    isSubmittingRef.current = true;
    setSibuk(true);
    setGalat(null);
    try {
      await simpanPortalTagihan(aktif);
      await onBerubah(
        aktif
          ? "Halaman Tagihan di portal wali dibuka."
          : "Halaman Tagihan di portal wali ditutup.",
      );
    } catch (error) {
      setGalat(
        pesanGalat(error, "Pengaturan portal wali tidak bisa disimpan."),
      );
    } finally {
      isSubmittingRef.current = false;
      setSibuk(false);
    }
  }

  return (
    <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/60 space-y-2">
      {bolehKelola ? (
        <label className="flex min-h-11 items-center gap-3 text-sm font-semibold text-slate-100">
          <input
            type="checkbox"
            checked={master.portal_wali_tagihan}
            disabled={sibuk}
            onChange={(e) => void ubah(e.target.checked)}
          />
          Tampilkan tagihan di portal wali
        </label>
      ) : (
        <p className="text-sm font-semibold text-slate-100">
          Tagihan di portal wali:{" "}
          {master.portal_wali_tagihan ? "ditampilkan" : "tidak ditampilkan"}
        </p>
      )}
      <p className="text-xs text-slate-400">
        Wali yang masuk ke portal melihat tunggakan anaknya, saldo titipan, dan
        kuitansi 12 bulan terakhir. Kuitansi yang dibatalkan ikut tampil dengan
        tanda dibatalkan.
      </p>
      {galat ? (
        <p role="alert" className={GALAT_KOTAK}>
          {galat}
        </p>
      ) : null}
    </div>
  );
}

function PanelJenis({
  master,
  bolehKelola,
  onBerubah,
}: {
  master: MasterTagihan;
  bolehKelola: boolean;
  onBerubah: (pesan: string) => Promise<void>;
}) {
  const [formJenis, setFormJenis] = useState<JenisTagihanItem | "baru" | null>(
    null,
  );
  const [formTarif, setFormTarif] = useState<JenisTagihanItem | null>(null);
  const [galat, setGalat] = useState<string | null>(null);
  const [akanDihapus, setAkanDihapus] = useState<string | null>(null);

  async function hapus(idTarif: string) {
    setGalat(null);
    setAkanDihapus(null);
    try {
      await hapusTarif(idTarif);
      await onBerubah("Tarif dihapus.");
    } catch (error) {
      setGalat(pesanGalat(error, "Tarif tidak bisa dihapus."));
    }
  }

  return (
    <div className="space-y-4">
      <PortalWali
        master={master}
        bolehKelola={bolehKelola}
        onBerubah={onBerubah}
      />
      {bolehKelola ? (
        <button
          type="button"
          className={TOMBOL_UTAMA}
          onClick={() => setFormJenis("baru")}
        >
          Tambah jenis tagihan
        </button>
      ) : null}
      {galat ? (
        <p role="alert" className={GALAT_KOTAK}>
          {galat}
        </p>
      ) : null}
      {master.jenis.length === 0 ? (
        <p className="p-6 text-center text-sm text-slate-400 rounded-xl border border-dashed border-slate-700">
          Belum ada jenis tagihan. Contoh: SPP bulanan, uang pangkal sekali per
          siswa.
        </p>
      ) : (
        <ul className="space-y-3">
          {master.jenis.map((item) => {
            const tarif = master.tarif.filter(
              (t) => t.id_jenis_tagihan === item.id_jenis_tagihan,
            );
            return (
              <li
                key={item.id_jenis_tagihan}
                className="p-4 rounded-xl border border-slate-800 bg-slate-900/60 space-y-2"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-sm font-semibold text-slate-100">
                    {item.nama}
                    {item.is_aktif ? "" : " (nonaktif)"}
                  </span>
                  <span className="text-sm text-slate-300">
                    {LABEL_PERIODIK[item.periodik]}, bawaan{" "}
                    <Rp nilai={item.nominal_bawaan} />
                  </span>
                </div>
                {tarif.length > 0 ? (
                  <ul className="text-xs text-slate-300 space-y-1">
                    {tarif.map((t) => (
                      <li
                        key={t.id_tarif}
                        className="flex flex-wrap items-center justify-between gap-2"
                      >
                        <span>
                          {t.nama_unit || "Semua unit"}
                          {t.tingkat ? `, tingkat ${t.tingkat}` : ""}:{" "}
                          <Rp nilai={t.nominal} />
                        </span>
                        {bolehKelola ? (
                          akanDihapus === t.id_tarif ? (
                            <button
                              type="button"
                              className={TOMBOL_BAHAYA}
                              onClick={() => void hapus(t.id_tarif)}
                            >
                              Ya, hapus tarif ini
                            </button>
                          ) : (
                            <button
                              type="button"
                              className={TOMBOL_KEDUA}
                              aria-label={`Hapus tarif ${t.nama_unit || "semua unit"} ${t.tingkat ?? ""} untuk ${item.nama}`}
                              onClick={() => setAkanDihapus(t.id_tarif)}
                            >
                              Hapus
                            </button>
                          )
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : null}
                {bolehKelola ? (
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className={TOMBOL_KEDUA}
                      aria-label={`Ubah jenis tagihan ${item.nama}`}
                      onClick={() => setFormJenis(item)}
                    >
                      Ubah
                    </button>
                    <button
                      type="button"
                      className={TOMBOL_KEDUA}
                      aria-label={`Tambah tarif untuk ${item.nama}`}
                      onClick={() => setFormTarif(item)}
                    >
                      Tambah tarif khusus
                    </button>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {formJenis ? (
        <DialogJenis
          awal={formJenis === "baru" ? null : formJenis}
          onClose={() => setFormJenis(null)}
          onTersimpan={async () => {
            setFormJenis(null);
            await onBerubah("Jenis tagihan tersimpan.");
          }}
        />
      ) : null}
      {formTarif ? (
        <DialogTarif
          jenis={formTarif}
          unit={master.unit}
          onClose={() => setFormTarif(null)}
          onTersimpan={async () => {
            setFormTarif(null);
            await onBerubah("Tarif tersimpan.");
          }}
        />
      ) : null}
    </div>
  );
}

function DialogJenis({
  awal,
  onClose,
  onTersimpan,
}: {
  awal: JenisTagihanItem | null;
  onClose: () => void;
  onTersimpan: () => Promise<void>;
}) {
  const [nama, setNama] = useState(awal?.nama ?? "");
  const [periodik, setPeriodik] = useState<Periodik>(
    awal?.periodik ?? "Bulanan",
  );
  const [nominal, setNominal] = useState(
    awal ? String(awal.nominal_bawaan) : "",
  );
  const [akun, setAkun] = useState(
    awal?.id_akun_pendapatan ?? AKUN_PENDAPATAN_SPP,
  );
  const [aktif, setAktif] = useState(awal ? awal.is_aktif === 1 : true);
  const [galat, setGalat] = useState<string | null>(null);
  const [sibuk, setSibuk] = useState(false);
  const isSubmittingRef = useRef(false);

  async function simpan(event: FormEvent) {
    event.preventDefault();
    if (isSubmittingRef.current) return;
    isSubmittingRef.current = true;
    setSibuk(true);
    setGalat(null);
    try {
      await simpanJenisTagihan({
        id_jenis_tagihan: awal?.id_jenis_tagihan ?? null,
        nama,
        periodik,
        nominal_bawaan: bacaNominal(nominal),
        id_akun_pendapatan: akun,
        is_aktif: aktif,
      });
      await onTersimpan();
    } catch (error) {
      setGalat(pesanGalat(error, "Jenis tagihan tidak bisa disimpan."));
    } finally {
      isSubmittingRef.current = false;
      setSibuk(false);
    }
  }

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={awal ? "Ubah jenis tagihan" : "Tambah jenis tagihan"}
      hideFooter
    >
      <form onSubmit={simpan} className="space-y-3">
        <div>
          <label className={LABEL} htmlFor="jenis-nama">
            Nama tagihan
          </label>
          <input
            id="jenis-nama"
            required
            maxLength={80}
            className={INPUT}
            placeholder="SPP"
            value={nama}
            onChange={(e) => setNama(e.target.value)}
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className={LABEL} htmlFor="jenis-periodik">
              Ditagih
            </label>
            <select
              id="jenis-periodik"
              className={INPUT}
              value={periodik}
              disabled={awal !== null}
              onChange={(e) => setPeriodik(e.target.value as Periodik)}
            >
              {PERIODIK.map((item) => (
                <option key={item} value={item}>
                  {LABEL_PERIODIK[item]}
                </option>
              ))}
            </select>
            {awal ? (
              <p className="mt-1 text-xs text-slate-400">
                Cara penagihan tidak bisa diubah setelah jenis dibuat, karena
                periode tagihan yang sudah terbit bergantung padanya.
              </p>
            ) : null}
          </div>
          <div>
            <label className={LABEL} htmlFor="jenis-nominal">
              Nominal bawaan
            </label>
            <input
              id="jenis-nominal"
              required
              inputMode="numeric"
              className={`${INPUT} text-right tabular-nums`}
              value={nominal}
              onChange={(e) => setNominal(e.target.value)}
            />
          </div>
        </div>
        <PilihAkunBayar
          id="jenis-akun"
          label="Dicatat sebagai pendapatan"
          value={akun}
          onChange={setAkun}
          kelompok="Pendapatan"
          bawaan={AKUN_PENDAPATAN_SPP}
          catatanTanpaIzin="Dicatat sebagai Pendapatan SPP di pembukuan."
        />
        {awal ? (
          <label className="flex min-h-11 items-center gap-2 text-sm text-slate-200">
            <input
              type="checkbox"
              className="h-4 w-4"
              checked={aktif}
              onChange={(e) => setAktif(e.target.checked)}
            />
            Jenis aktif dan bisa diterbitkan
          </label>
        ) : null}
        <p className="text-xs text-slate-400">
          Nominal bawaan berlaku untuk semua siswa kecuali yang punya tarif
          khusus per unit atau tingkat. Mengubahnya tidak mengubah tagihan yang
          sudah terbit.
        </p>
        {galat ? (
          <p role="alert" className={GALAT_KOTAK}>
            {galat}
          </p>
        ) : null}
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className={TOMBOL_KEDUA} onClick={onClose}>
            Batal
          </button>
          <button type="submit" className={TOMBOL_UTAMA} disabled={sibuk}>
            {sibuk ? "Menyimpan..." : "Simpan jenis tagihan"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function DialogTarif({
  jenis,
  unit,
  onClose,
  onTersimpan,
}: {
  jenis: JenisTagihanItem;
  unit: string[];
  onClose: () => void;
  onTersimpan: () => Promise<void>;
}) {
  const [namaUnit, setNamaUnit] = useState("");
  const [tingkat, setTingkat] = useState("");
  const [nominal, setNominal] = useState("");
  const [galat, setGalat] = useState<string | null>(null);
  const [sibuk, setSibuk] = useState(false);
  const isSubmittingRef = useRef(false);

  async function simpan(event: FormEvent) {
    event.preventDefault();
    if (isSubmittingRef.current) return;
    isSubmittingRef.current = true;
    setSibuk(true);
    setGalat(null);
    try {
      await simpanTarif({
        id_jenis_tagihan: jenis.id_jenis_tagihan,
        nama_unit: namaUnit || null,
        tingkat: tingkat ? Number(tingkat) : null,
        nominal: bacaNominal(nominal),
      });
      await onTersimpan();
    } catch (error) {
      setGalat(pesanGalat(error, "Tarif tidak bisa disimpan."));
    } finally {
      isSubmittingRef.current = false;
      setSibuk(false);
    }
  }

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={`Tarif khusus ${jenis.nama}`}
      hideFooter
    >
      <form onSubmit={simpan} className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className={LABEL} htmlFor="tarif-unit">
              Unit
            </label>
            <PilihCari
              id="tarif-unit"
              className={INPUT}
              value={namaUnit}
              onChange={(e) => setNamaUnit(e.target.value)}
            >
              <option value="">Semua unit</option>
              {unit.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </PilihCari>
          </div>
          <div>
            <label className={LABEL} htmlFor="tarif-tingkat">
              Tingkat (opsional)
            </label>
            <input
              id="tarif-tingkat"
              type="number"
              min={1}
              max={20}
              className={INPUT}
              value={tingkat}
              onChange={(e) => setTingkat(e.target.value)}
            />
          </div>
        </div>
        <div>
          <label className={LABEL} htmlFor="tarif-nominal">
            Nominal
          </label>
          <input
            id="tarif-nominal"
            required
            inputMode="numeric"
            className={`${INPUT} text-right tabular-nums`}
            value={nominal}
            onChange={(e) => setNominal(e.target.value)}
          />
        </div>
        <p className="text-xs text-slate-400">
          Tarif yang paling spesifik dipakai lebih dulu: unit dan tingkat, lalu
          unit saja, lalu tingkat saja, lalu nominal bawaan.
        </p>
        {galat ? (
          <p role="alert" className={GALAT_KOTAK}>
            {galat}
          </p>
        ) : null}
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className={TOMBOL_KEDUA} onClick={onClose}>
            Batal
          </button>
          <button type="submit" className={TOMBOL_UTAMA} disabled={sibuk}>
            {sibuk ? "Menyimpan..." : "Simpan tarif"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ── Keringanan ──────────────────────────────────────────────────────────────

function PanelKeringanan({
  master,
  bolehKelola,
  onInfo,
}: {
  master: MasterTagihan;
  bolehKelola: boolean;
  onInfo: (pesan: string) => void;
}) {
  const [items, setItems] = useState<KeringananItem[] | null>(null);
  const [galatMuat, setGalatMuat] = useState<string | null>(null);
  const [form, setForm] = useState<KeringananItem | "baru" | null>(null);

  const muat = useCallback(async () => {
    setGalatMuat(null);
    try {
      setItems((await daftarKeringanan()).items);
    } catch (error) {
      setGalatMuat(pesanGalat(error, "Daftar keringanan tidak bisa dimuat."));
    }
  }, []);

  useEffect(() => {
    void muat();
  }, [muat]);
  useEffect(() => subscribeSyncCompleted(() => void muat()), [muat]);

  return (
    <div className="space-y-4">
      {bolehKelola ? (
        <button
          type="button"
          className={TOMBOL_UTAMA}
          onClick={() => setForm("baru")}
        >
          Tambah keringanan
        </button>
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
          Memuat keringanan...
        </p>
      ) : items.length === 0 ? (
        <p className="p-6 text-center text-sm text-slate-400 rounded-xl border border-dashed border-slate-700">
          Belum ada keringanan.
        </p>
      ) : (
        <ul className="divide-y divide-slate-800 rounded-xl border border-slate-800 bg-slate-900/60">
          {items.map((item) => (
            <li
              key={item.id_keringanan}
              className="flex flex-wrap items-center justify-between gap-2 px-4 py-3"
            >
              <span className="min-w-0 text-sm">
                <span className="text-slate-100">{item.nama_siswa}</span>
                <span className="block text-xs text-slate-400">
                  {item.nama_tagihan}:{" "}
                  {item.jenis === "Persen"
                    ? `${item.nilai}%`
                    : formatRupiah(item.nilai)}
                  {item.periode_mulai || item.periode_selesai
                    ? `, ${item.periode_mulai ?? "awal"} s.d. ${item.periode_selesai ?? "seterusnya"}`
                    : ""}
                  {item.alasan ? `, ${item.alasan}` : ""}
                  {item.is_aktif ? "" : ", nonaktif"}
                </span>
              </span>
              {bolehKelola ? (
                <button
                  type="button"
                  className={TOMBOL_KEDUA}
                  aria-label={`Ubah keringanan ${item.nama_siswa}`}
                  onClick={() => setForm(item)}
                >
                  Ubah
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {form ? (
        <DialogKeringanan
          awal={form === "baru" ? null : form}
          jenis={master.jenis}
          onClose={() => setForm(null)}
          onTersimpan={async () => {
            setForm(null);
            onInfo(
              "Keringanan tersimpan. Berlaku untuk tagihan yang terbit sesudahnya.",
            );
            await muat();
          }}
        />
      ) : null}
    </div>
  );
}

function DialogKeringanan({
  awal,
  jenis,
  onClose,
  onTersimpan,
}: {
  awal: KeringananItem | null;
  jenis: JenisTagihanItem[];
  onClose: () => void;
  onTersimpan: () => Promise<void>;
}) {
  const [siswa, setSiswa] = useState<SiswaTagihan[] | null>(null);
  const [idSiswa, setIdSiswa] = useState(awal?.id_siswa ?? "");
  const [idJenis, setIdJenis] = useState(
    awal?.id_jenis_tagihan ?? jenis[0]?.id_jenis_tagihan ?? "",
  );
  const [tipe, setTipe] = useState<JenisKeringanan>(awal?.jenis ?? "Persen");
  const [nilai, setNilai] = useState(awal ? String(awal.nilai) : "");
  const [mulai, setMulai] = useState(awal?.periode_mulai ?? "");
  const [selesai, setSelesai] = useState(awal?.periode_selesai ?? "");
  const [alasan, setAlasan] = useState(awal?.alasan ?? "");
  const [aktif, setAktif] = useState(awal ? awal.is_aktif === 1 : true);
  const [galat, setGalat] = useState<string | null>(null);
  const [sibuk, setSibuk] = useState(false);
  const isSubmittingRef = useRef(false);

  useEffect(() => {
    let hidup = true;
    daftarSiswaTagihan()
      .then((hasil) => hidup && setSiswa(hasil.items))
      .catch(
        (error) =>
          hidup &&
          setGalat(pesanGalat(error, "Daftar siswa tidak bisa dimuat.")),
      );
    return () => {
      hidup = false;
    };
  }, []);

  async function simpan(event: FormEvent) {
    event.preventDefault();
    if (isSubmittingRef.current) return;
    isSubmittingRef.current = true;
    setSibuk(true);
    setGalat(null);
    try {
      await simpanKeringanan({
        id_keringanan: awal?.id_keringanan ?? null,
        id_siswa: idSiswa,
        id_jenis_tagihan: idJenis,
        jenis: tipe,
        nilai: bacaNominal(nilai),
        periode_mulai: mulai.trim() || null,
        periode_selesai: selesai.trim() || null,
        alasan: alasan.trim() || null,
        is_aktif: aktif,
      });
      await onTersimpan();
    } catch (error) {
      setGalat(pesanGalat(error, "Keringanan tidak bisa disimpan."));
    } finally {
      isSubmittingRef.current = false;
      setSibuk(false);
    }
  }

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={awal ? "Ubah keringanan" : "Tambah keringanan"}
      hideFooter
    >
      <form onSubmit={simpan} className="space-y-3">
        <div>
          <label className={LABEL} htmlFor="krg-siswa">
            Siswa
          </label>
          <PilihCari
            id="krg-siswa"
            required
            className={INPUT}
            value={idSiswa}
            disabled={siswa === null}
            onChange={(e) => setIdSiswa(e.target.value)}
          >
            <option value="">
              {siswa === null ? "Memuat siswa..." : "Pilih siswa"}
            </option>
            {(siswa ?? []).map((item) => (
              <option key={item.id_siswa} value={item.id_siswa}>
                {item.nama_lengkap} {item.kelas ? `(${item.kelas})` : ""}
              </option>
            ))}
          </PilihCari>
        </div>
        <div>
          <label className={LABEL} htmlFor="krg-jenis">
            Untuk tagihan
          </label>
          <PilihCari
            id="krg-jenis"
            required
            className={INPUT}
            value={idJenis}
            onChange={(e) => setIdJenis(e.target.value)}
          >
            {jenis.map((item) => (
              <option key={item.id_jenis_tagihan} value={item.id_jenis_tagihan}>
                {item.nama}
              </option>
            ))}
          </PilihCari>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className={LABEL} htmlFor="krg-tipe">
              Bentuk keringanan
            </label>
            <select
              id="krg-tipe"
              className={INPUT}
              value={tipe}
              onChange={(e) => setTipe(e.target.value as JenisKeringanan)}
            >
              {JENIS_KERINGANAN.map((item) => (
                <option key={item} value={item}>
                  {item === "Persen"
                    ? "Persen dari nominal"
                    : "Potongan rupiah"}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={LABEL} htmlFor="krg-nilai">
              {tipe === "Persen"
                ? "Persen (1 sampai 100)"
                : "Potongan per tagihan"}
            </label>
            <input
              id="krg-nilai"
              required
              inputMode="numeric"
              className={`${INPUT} text-right tabular-nums`}
              value={nilai}
              onChange={(e) => setNilai(e.target.value)}
            />
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className={LABEL} htmlFor="krg-mulai">
              Berlaku mulai periode (opsional)
            </label>
            <input
              id="krg-mulai"
              className={INPUT}
              placeholder="2026-07"
              value={mulai}
              onChange={(e) => setMulai(e.target.value)}
            />
          </div>
          <div>
            <label className={LABEL} htmlFor="krg-selesai">
              Sampai periode (opsional)
            </label>
            <input
              id="krg-selesai"
              className={INPUT}
              placeholder="2027-06"
              value={selesai}
              onChange={(e) => setSelesai(e.target.value)}
            />
          </div>
        </div>
        <div>
          <label className={LABEL} htmlFor="krg-alasan">
            Alasan singkat (opsional)
          </label>
          <input
            id="krg-alasan"
            maxLength={80}
            className={INPUT}
            placeholder="Beasiswa prestasi"
            value={alasan}
            onChange={(e) => setAlasan(e.target.value)}
          />
          <p className="mt-1 text-xs text-slate-400">
            Tersalin ke semua perangkat sekolah. Tulis alasan umum, bukan
            kondisi keluarga.
          </p>
        </div>
        {awal ? (
          <label className="flex min-h-11 items-center gap-2 text-sm text-slate-200">
            <input
              type="checkbox"
              className="h-4 w-4"
              checked={aktif}
              onChange={(e) => setAktif(e.target.checked)}
            />
            Keringanan aktif
          </label>
        ) : null}
        {galat ? (
          <p role="alert" className={GALAT_KOTAK}>
            {galat}
          </p>
        ) : null}
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className={TOMBOL_KEDUA} onClick={onClose}>
            Batal
          </button>
          <button type="submit" className={TOMBOL_UTAMA} disabled={sibuk}>
            {sibuk ? "Menyimpan..." : "Simpan keringanan"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
