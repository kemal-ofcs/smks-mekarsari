"use client";

import {
  type FormEvent,
  type ReactNode,
  useCallback,
  useEffect,
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
  buatKuitansiPdf,
  cetakKuitansi,
  namaAlokasi,
  teksKuitansiWa,
} from "@/components/keuangan/kuitansi";
import { PilihAkunBayar } from "@/components/keuangan/PilihAkunBayar";
import { Modal } from "@/components/ui/Modal";
import { saveFileWithPicker } from "@/lib/client/download";
import { openWhatsAppChat } from "@/lib/client/open-url";
import {
  type AkunSiswaTagihan,
  batalkanKuitansi,
  catatPembayaran,
  type DetailKuitansi,
  daftarKuitansi,
  daftarSiswaTagihan,
  getAkunSiswa,
  getDetailKuitansi,
  getSeriKuitansi,
  getTinjauanPembayaran,
  type KuitansiItem,
  pindahkanKeTitipan,
  type SeriKuitansi,
  type SiswaTagihan,
  simpanSeriKuitansi,
  type TinjauanPembayaran,
} from "@/lib/gateways/billing";
import { subscribeSyncCompleted } from "@/lib/gateways/sync-status";
import { isMobileRuntime } from "@/lib/runtime/app-runtime";
import { formatRupiah } from "@/lib/validations/accounting";
import {
  akunBawaanMetode,
  alokasiPembayaran,
  BATAS_DAFTAR_KUITANSI,
  METODE_BAYAR,
  type MetodeBayar,
} from "@/lib/validations/billing";

/**
 * Tab pembayaran di halaman tagihan (K3b): Bayar, Kuitansi, Tinjauan, dan
 * Seri Kuitansi. Dipakai apa adanya oleh Web/Desktop dan Mobile (disalin
 * lewat `filesToCopy`). Alokasi yang tampil sebelum menyimpan memakai fungsi
 * yang sama dengan backend; yang tersimpan tetap hitungan backend.
 */

const GALAT_KOTAK =
  "p-3 rounded-lg border border-rose-500/30 bg-rose-500/20 text-sm text-rose-100";
const KARTU = "rounded-xl border border-slate-800 bg-slate-900/60";
const LENCANA_AMBER =
  "rounded px-1.5 border border-amber-500/30 bg-amber-500/20 text-amber-100";
const LENCANA_MERAH =
  "rounded px-1.5 border border-rose-500/30 bg-rose-500/20 text-rose-100";

function bacaNominal(teks: string): number {
  const digit = teks.replace(/\D/g, "");
  return digit ? Number(digit) : 0;
}

function Rp({ nilai }: { nilai: number }) {
  return <span className="tabular-nums">{formatRupiah(nilai)}</span>;
}

function periodeTampil(periode: string): string {
  return periode === "SEKALI" ? "" : periode;
}

function KotakGalat({
  pesan,
  onUlang,
}: {
  pesan: string;
  onUlang: () => void;
}) {
  return (
    <div className={`${GALAT_KOTAK} space-y-3`}>
      <p>{pesan}</p>
      <button type="button" className={TOMBOL_KEDUA} onClick={onUlang}>
        Coba muat lagi
      </button>
    </div>
  );
}

// ── Bayar ───────────────────────────────────────────────────────────────────

export function PanelBayar({
  bolehBatal,
  onInfo,
}: {
  bolehBatal: boolean;
  onInfo: (pesan: string) => void;
}) {
  const [siswa, setSiswa] = useState<SiswaTagihan[] | null>(null);
  const [galatSiswa, setGalatSiswa] = useState<string | null>(null);
  const [cari, setCari] = useState("");
  const [idSiswa, setIdSiswa] = useState<string | null>(null);
  const [akun, setAkun] = useState<AkunSiswaTagihan | null>(null);
  const [galatAkun, setGalatAkun] = useState<string | null>(null);
  const [dipilih, setDipilih] = useState<Set<string>>(new Set());
  const [tanggal, setTanggal] = useState(hariIniWib());
  const [metode, setMetode] = useState<MetodeBayar>("Tunai");
  const [idAkunKas, setIdAkunKas] = useState("akun-kas");
  const [jumlah, setJumlah] = useState("");
  const [keterangan, setKeterangan] = useState("");
  const [galat, setGalat] = useState<string | null>(null);
  const [sibuk, setSibuk] = useState(false);
  const [kuitansiBaru, setKuitansiBaru] = useState<string | null>(null);
  const [lihat, setLihat] = useState<string | null>(null);
  const isSubmittingRef = useRef(false);

  const muatSiswa = useCallback(async () => {
    setGalatSiswa(null);
    try {
      setSiswa((await daftarSiswaTagihan()).items);
    } catch (error) {
      setGalatSiswa(pesanGalat(error, "Daftar siswa tidak bisa dimuat."));
    }
  }, []);

  useEffect(() => {
    void muatSiswa();
  }, [muatSiswa]);

  const muatAkun = useCallback(async (id: string) => {
    setGalatAkun(null);
    try {
      const data = await getAkunSiswa(id);
      setAkun(data);
      setDipilih(new Set(data.tagihan.map((item) => item.id_tagihan)));
    } catch (error) {
      setGalatAkun(pesanGalat(error, "Tagihan siswa tidak bisa dimuat."));
    }
  }, []);

  useEffect(() => {
    if (idSiswa) void muatAkun(idSiswa);
  }, [idSiswa, muatAkun]);
  useEffect(
    () =>
      subscribeSyncCompleted(() => {
        if (idSiswa) void muatAkun(idSiswa);
      }),
    [idSiswa, muatAkun],
  );

  // Saldo titipan habis (mis. baru saja dipakai): pilihan "Pakai titipan"
  // hilang dari daftar, jadi metodenya ikut kembali ke Tunai.
  useEffect(() => {
    if (akun && akun.titipan <= 0 && metode === "Titipan") {
      setMetode("Tunai");
      setIdAkunKas("akun-kas");
    }
  }, [akun, metode]);

  const kata = cari.trim().toLowerCase();
  const cocok =
    siswa && kata
      ? siswa
          .filter(
            (item) =>
              item.nama_lengkap.toLowerCase().includes(kata) ||
              item.nis.toLowerCase().includes(kata) ||
              item.kelas.toLowerCase().includes(kata),
          )
          .slice(0, 20)
      : [];

  const tagihanDipilih =
    akun?.tagihan.filter((item) => dipilih.has(item.id_tagihan)) ?? [];
  const sisaDipilih = tagihanDipilih.reduce((sum, item) => sum + item.sisa, 0);
  const total = bacaNominal(jumlah);
  const rencana = alokasiPembayaran(tagihanDipilih, total);
  const titipanKurang =
    metode === "Titipan" && akun !== null && total > akun.titipan;

  function gantiMetode(nilai: MetodeBayar) {
    setMetode(nilai);
    const bawaan = akunBawaanMetode(nilai);
    if (bawaan) setIdAkunKas(bawaan);
  }

  function pilihSiswa(id: string) {
    setIdSiswa(id);
    setAkun(null);
    setCari("");
    setJumlah("");
    setKeterangan("");
    setGalat(null);
    setKuitansiBaru(null);
    setMetode("Tunai");
    setIdAkunKas("akun-kas");
  }

  function ubahPilihan(id: string, centang: boolean) {
    setDipilih((lama) => {
      const baru = new Set(lama);
      if (centang) baru.add(id);
      else baru.delete(id);
      return baru;
    });
  }

  async function simpan(event: FormEvent) {
    event.preventDefault();
    if (!idSiswa || isSubmittingRef.current) return;
    isSubmittingRef.current = true;
    setSibuk(true);
    setGalat(null);
    try {
      const hasil = await catatPembayaran({
        id_siswa: idSiswa,
        tanggal,
        metode,
        total,
        id_akun_kas: metode === "Titipan" ? null : idAkunKas,
        keterangan: keterangan.trim() || null,
        id_tagihan: [...dipilih],
      });
      setKuitansiBaru(hasil.id_pembayaran);
      setJumlah("");
      setKeterangan("");
      onInfo(
        hasil.ke_titipan > 0
          ? `Kuitansi ${hasil.nomor} tersimpan. ${formatRupiah(hasil.ke_titipan)} masuk Titipan Wali.`
          : `Kuitansi ${hasil.nomor} tersimpan.`,
      );
      await muatAkun(idSiswa);
    } catch (error) {
      setGalat(pesanGalat(error, "Pembayaran tidak bisa disimpan."));
    } finally {
      isSubmittingRef.current = false;
      setSibuk(false);
    }
  }

  if (galatSiswa) {
    return <KotakGalat pesan={galatSiswa} onUlang={() => void muatSiswa()} />;
  }

  return (
    <div className="space-y-4">
      <div>
        <label className={LABEL} htmlFor="bayar-cari-siswa">
          Cari siswa
        </label>
        <input
          id="bayar-cari-siswa"
          className={INPUT}
          placeholder="Nama, NIS, atau kelas"
          value={cari}
          onChange={(e) => setCari(e.target.value)}
          disabled={!siswa}
        />
        {!siswa ? (
          <p className="mt-1 text-xs text-slate-400">Memuat daftar siswa...</p>
        ) : kata && cocok.length === 0 ? (
          <p className="mt-1 text-xs text-slate-400">
            Tidak ada siswa aktif yang cocok.
          </p>
        ) : null}
        {cocok.length > 0 ? (
          <ul
            aria-label="Hasil pencarian siswa"
            className={`mt-2 divide-y divide-slate-800 ${KARTU}`}
          >
            {cocok.map((item) => (
              <li key={item.id_siswa}>
                <button
                  type="button"
                  onClick={() => pilihSiswa(item.id_siswa)}
                  className="w-full min-h-11 px-4 py-2 text-left text-sm hover:bg-slate-800/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
                >
                  <span className="text-slate-100">{item.nama_lengkap}</span>{" "}
                  <span className="text-slate-400">
                    {[item.kelas, item.nis].filter(Boolean).join(" · ")}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      {!idSiswa ? (
        <p className="p-6 text-center text-sm text-slate-400 rounded-xl border border-dashed border-slate-700">
          Cari siswa yang membayar untuk melihat tagihan dan titipannya.
        </p>
      ) : galatAkun ? (
        <KotakGalat pesan={galatAkun} onUlang={() => void muatAkun(idSiswa)} />
      ) : !akun ? (
        <p className="p-6 text-center text-sm text-slate-400">
          Memuat tagihan siswa...
        </p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-4">
            <div className={`${KARTU} p-4`}>
              <p className="text-base font-semibold text-slate-100">
                {akun.siswa.nama_lengkap}
              </p>
              <p className="text-sm text-slate-400">
                {akun.siswa.kelas || "Tanpa kelas"}
                {akun.titipan !== 0 ? (
                  <>
                    {" · "}Titipan <Rp nilai={akun.titipan} />
                  </>
                ) : null}
              </p>
            </div>

            <fieldset className={`${KARTU} p-4 space-y-2`}>
              <legend className="px-1 text-sm font-semibold text-slate-200">
                Tagihan yang dibayar
              </legend>
              {akun.tagihan.length === 0 ? (
                <p className="text-sm text-slate-400">
                  Tidak ada tunggakan. Uang yang dicatat sekarang seluruhnya
                  masuk Titipan Wali.
                </p>
              ) : (
                akun.tagihan.map((item) => (
                  <label
                    key={item.id_tagihan}
                    className="flex min-h-11 items-start gap-3 rounded-lg px-2 py-2 hover:bg-slate-800/60"
                  >
                    <input
                      type="checkbox"
                      className="mt-1 h-5 w-5 accent-sky-500"
                      checked={dipilih.has(item.id_tagihan)}
                      onChange={(e) =>
                        ubahPilihan(item.id_tagihan, e.target.checked)
                      }
                    />
                    <span className="flex-1 text-sm">
                      <span className="flex flex-wrap justify-between gap-x-3">
                        <span className="text-slate-100">
                          {item.nama_tagihan} {periodeTampil(item.periode)}
                        </span>
                        <Rp nilai={item.sisa} />
                      </span>
                      <span className="block text-xs text-slate-400">
                        Jatuh tempo {item.jatuh_tempo}
                        {item.dibayar > 0 ? (
                          <>
                            {" · "}sudah dibayar <Rp nilai={item.dibayar} />
                          </>
                        ) : null}
                      </span>
                    </span>
                  </label>
                ))
              )}
            </fieldset>

            {akun.riwayat.length > 0 ? (
              <div className={`${KARTU} p-4 space-y-2`}>
                <p className="text-sm font-semibold text-slate-200">
                  Kuitansi terakhir
                </p>
                <ul className="space-y-1">
                  {akun.riwayat.map((item) => (
                    <li key={item.id_pembayaran}>
                      <button
                        type="button"
                        onClick={() => setLihat(item.id_pembayaran)}
                        className="w-full min-h-11 rounded-lg px-2 py-1 text-left text-xs hover:bg-slate-800/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
                      >
                        <span className="flex flex-wrap justify-between gap-x-3 text-sm">
                          <span className="text-slate-100">{item.nomor}</span>
                          {item.status === "Dibatalkan" ? (
                            <span className={LENCANA_MERAH}>Dibatalkan</span>
                          ) : (
                            <Rp nilai={item.total} />
                          )}
                        </span>
                        <span className="block text-slate-400">
                          {item.tanggal} · {item.rincian || item.metode}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>

          <form onSubmit={simpan} className={`${KARTU} p-4 space-y-3`}>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className={LABEL} htmlFor="bayar-tanggal">
                  Tanggal bayar
                </label>
                <input
                  id="bayar-tanggal"
                  type="date"
                  required
                  max={hariIniWib()}
                  className={INPUT}
                  value={tanggal}
                  onChange={(e) => setTanggal(e.target.value)}
                />
              </div>
              <div>
                <label className={LABEL} htmlFor="bayar-metode">
                  Cara bayar
                </label>
                <select
                  id="bayar-metode"
                  className={INPUT}
                  value={metode}
                  onChange={(e) => gantiMetode(e.target.value as MetodeBayar)}
                >
                  {METODE_BAYAR.filter(
                    (item) => item !== "Titipan" || akun.titipan > 0,
                  ).map((item) => (
                    <option key={item} value={item}>
                      {item === "Titipan" ? "Pakai titipan" : item}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {metode === "Titipan" ? (
              <p className="text-xs text-slate-400">
                Saldo titipan <Rp nilai={akun.titipan} />. Pemakaiannya tetap
                bernomor kuitansi, tanpa uang tunai.
              </p>
            ) : (
              <PilihAkunBayar
                id="bayar-akun"
                label="Diterima di akun"
                value={idAkunKas}
                onChange={setIdAkunKas}
                bawaan={akunBawaanMetode(metode) ?? "akun-kas"}
                catatanTanpaIzin={
                  metode === "Transfer"
                    ? "Uangnya dicatat lewat akun Bank di pembukuan."
                    : "Uangnya dicatat lewat akun Kas di pembukuan."
                }
              />
            )}

            <div>
              <label className={LABEL} htmlFor="bayar-jumlah">
                Jumlah dibayar (Rp)
              </label>
              <input
                id="bayar-jumlah"
                inputMode="numeric"
                required
                className={INPUT}
                value={total ? total.toLocaleString("id-ID") : ""}
                onChange={(e) => setJumlah(e.target.value)}
              />
              {sisaDipilih > 0 ? (
                <button
                  type="button"
                  className="mt-1 min-h-11 text-xs font-semibold text-sky-300 underline focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 rounded"
                  onClick={() =>
                    setJumlah(
                      String(
                        metode === "Titipan"
                          ? Math.min(sisaDipilih, Math.max(akun.titipan, 0))
                          : sisaDipilih,
                      ),
                    )
                  }
                >
                  Isi sesuai sisa tagihan terpilih ({formatRupiah(sisaDipilih)})
                </button>
              ) : null}
            </div>

            <div>
              <label className={LABEL} htmlFor="bayar-keterangan">
                Keterangan (opsional)
              </label>
              <input
                id="bayar-keterangan"
                maxLength={150}
                className={INPUT}
                value={keterangan}
                onChange={(e) => setKeterangan(e.target.value)}
              />
            </div>

            {total > 0 ? (
              <div className="rounded-lg border border-slate-700 p-3 text-sm space-y-1">
                <p className="text-xs font-semibold text-slate-300">
                  Uang ini akan dipakai untuk
                </p>
                {rencana.alokasi.map((item) => {
                  const tagihan = akun.tagihan.find(
                    (t) => t.id_tagihan === item.id_tagihan,
                  );
                  return (
                    <p
                      key={item.id_tagihan}
                      className="flex justify-between gap-3 text-slate-200"
                    >
                      <span>
                        {tagihan?.nama_tagihan}{" "}
                        {periodeTampil(tagihan?.periode ?? "")}
                        {item.nominal >= (tagihan?.sisa ?? 0) ? " (lunas)" : ""}
                      </span>
                      <Rp nilai={item.nominal} />
                    </p>
                  );
                })}
                {rencana.titipan > 0 ? (
                  <p
                    className={`flex justify-between gap-3 ${metode === "Titipan" ? "text-rose-100" : "text-amber-100"}`}
                  >
                    <span>
                      {metode === "Titipan"
                        ? "Melebihi sisa tagihan terpilih"
                        : "Masuk Titipan Wali"}
                    </span>
                    <Rp nilai={rencana.titipan} />
                  </p>
                ) : null}
              </div>
            ) : null}

            {titipanKurang ? (
              <p className="text-xs text-rose-100">
                Saldo titipan hanya {formatRupiah(Math.max(akun.titipan, 0))}.
              </p>
            ) : null}
            {galat ? (
              <p role="alert" className={GALAT_KOTAK}>
                {galat}
              </p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <button
                type="submit"
                className={TOMBOL_UTAMA}
                disabled={
                  sibuk ||
                  total <= 0 ||
                  titipanKurang ||
                  (metode === "Titipan" && rencana.titipan > 0)
                }
              >
                {sibuk ? "Menyimpan..." : "Simpan dan buat kuitansi"}
              </button>
              {kuitansiBaru ? (
                <button
                  type="button"
                  className={TOMBOL_KEDUA}
                  onClick={() => setLihat(kuitansiBaru)}
                >
                  Lihat kuitansi
                </button>
              ) : null}
            </div>
          </form>
        </div>
      )}

      {lihat ? (
        <DialogKuitansi
          idPembayaran={lihat}
          bolehBatal={bolehBatal}
          onClose={() => setLihat(null)}
          onBerubah={async (pesan) => {
            setLihat(null);
            onInfo(pesan);
            if (idSiswa) await muatAkun(idSiswa);
          }}
        />
      ) : null}
    </div>
  );
}

// ── Dialog kuitansi ─────────────────────────────────────────────────────────

type AksiKuitansi = "batal" | "titipan";

export function DialogKuitansi({
  idPembayaran,
  bolehBatal = false,
  onClose,
  onBerubah,
}: {
  idPembayaran: string;
  bolehBatal?: boolean;
  onClose: () => void;
  onBerubah: (pesan: string) => Promise<void>;
}) {
  const [detail, setDetail] = useState<DetailKuitansi | null>(null);
  const [galatMuat, setGalatMuat] = useState<string | null>(null);
  const [alasan, setAlasan] = useState("");
  const [aksi, setAksi] = useState<AksiKuitansi | null>(null);
  const [galat, setGalat] = useState<string | null>(null);
  const [sibuk, setSibuk] = useState(false);
  const [pesanWa, setPesanWa] = useState<{
    teks: string;
    galat: boolean;
  } | null>(null);
  const isSubmittingRef = useRef(false);

  const muat = useCallback(async () => {
    setGalatMuat(null);
    try {
      setDetail(await getDetailKuitansi(idPembayaran));
    } catch (error) {
      setGalatMuat(pesanGalat(error, "Kuitansi tidak bisa dimuat."));
    }
  }, [idPembayaran]);

  useEffect(() => {
    void muat();
  }, [muat]);

  async function jalankan(event: FormEvent) {
    event.preventDefault();
    if (!aksi || isSubmittingRef.current) return;
    isSubmittingRef.current = true;
    setSibuk(true);
    setGalat(null);
    try {
      if (aksi === "batal") {
        await batalkanKuitansi(idPembayaran, alasan);
        await onBerubah(
          `Kuitansi ${detail?.pembayaran.nomor ?? ""} dibatalkan.`,
        );
      } else {
        const hasil = await pindahkanKeTitipan(idPembayaran, alasan);
        await onBerubah(
          `Kuitansi ${detail?.pembayaran.nomor ?? ""} dibatalkan dan diganti ${hasil.nomor} ke Titipan Wali.`,
        );
      }
    } catch (error) {
      setGalat(pesanGalat(error, "Kuitansi tidak bisa diubah."));
    } finally {
      isSubmittingRef.current = false;
      setSibuk(false);
    }
  }

  async function unduhPdf() {
    if (!detail) return;
    setPesanWa(null);
    try {
      const isi = await buatKuitansiPdf(detail);
      const hasil = await saveFileWithPicker(
        new Blob([isi], { type: "application/pdf" }),
        `kuitansi-${detail.pembayaran.nomor.replaceAll("/", "-")}.pdf`,
        {
          description: "Dokumen PDF (*.pdf)",
          accept: { "application/pdf": [".pdf"] },
        },
      );
      if (hasil.sukses) {
        setPesanWa({ teks: "Berkas PDF tersimpan.", galat: false });
      } else if (!hasil.cancelled) {
        setPesanWa({ teks: "Berkas PDF tidak bisa disimpan.", galat: true });
      }
    } catch (error) {
      setPesanWa({
        teks: pesanGalat(error, "Berkas PDF tidak bisa dibuat."),
        galat: true,
      });
    }
  }

  async function kirimWa() {
    if (!detail) return;
    setPesanWa(null);
    const terbuka = await openWhatsAppChat(
      detail.pembayaran.no_wali,
      teksKuitansiWa(detail),
    );
    if (!terbuka) {
      setPesanWa({
        teks: "WhatsApp tidak bisa dibuka di perangkat ini.",
        galat: true,
      });
    }
  }

  const p = detail?.pembayaran;
  return (
    <Modal
      isOpen
      onClose={onClose}
      title={p ? `Kuitansi ${p.nomor}` : "Kuitansi"}
      hideFooter
    >
      {galatMuat ? (
        <KotakGalat pesan={galatMuat} onUlang={() => void muat()} />
      ) : !detail || !p ? (
        <p className="p-6 text-center text-sm text-slate-400">
          Memuat kuitansi...
        </p>
      ) : (
        <div className="space-y-4 text-sm">
          {p.status === "Dibatalkan" ? (
            <p className={GALAT_KOTAK}>
              Kuitansi ini dibatalkan: {p.alasan_batal}
            </p>
          ) : null}
          <dl className="grid gap-2 grid-cols-2">
            <div>
              <dt className="text-xs text-slate-400">Siswa</dt>
              <dd className="text-slate-100">
                {p.nama_siswa}
                {p.kelas ? ` (${p.kelas})` : ""}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-slate-400">Tanggal</dt>
              <dd className="text-slate-100">{p.tanggal}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-400">Cara bayar</dt>
              <dd className="text-slate-100">
                {p.metode === "Titipan"
                  ? "Dari titipan"
                  : `${p.metode}${p.nama_akun ? ` · ${p.nama_akun}` : ""}`}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-slate-400">Dicatat oleh</dt>
              <dd className="text-slate-100 break-words">{p.dibuat_oleh}</dd>
            </div>
            {p.keterangan ? (
              <div className="col-span-2">
                <dt className="text-xs text-slate-400">Keterangan</dt>
                <dd className="text-slate-100 break-words">{p.keterangan}</dd>
              </div>
            ) : null}
          </dl>
          <ul className="divide-y divide-slate-800 rounded-lg border border-slate-800">
            {detail.alokasi.map((item) => (
              <li
                key={item.id_alokasi}
                className="flex justify-between gap-3 px-3 py-2"
              >
                <span className="text-slate-200">{namaAlokasi(item)}</span>
                <Rp nilai={item.nominal} />
              </li>
            ))}
            <li className="flex justify-between gap-3 px-3 py-2 font-semibold text-slate-100">
              <span>Total</span>
              <Rp nilai={p.total} />
            </li>
          </ul>
          {detail.saldo_titipan !== 0 ? (
            <p className="text-xs text-slate-400">
              Saldo titipan siswa sekarang <Rp nilai={detail.saldo_titipan} />.
            </p>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <button
              className={TOMBOL_KEDUA}
              onClick={() => void unduhPdf()}
              type="button"
            >
              Unduh PDF
            </button>
            {isMobileRuntime() ? null : (
              <button
                type="button"
                className={TOMBOL_KEDUA}
                onClick={() => cetakKuitansi(detail)}
              >
                Cetak
              </button>
            )}
            {p.no_wali ? (
              <button
                type="button"
                className={TOMBOL_KEDUA}
                onClick={() => void kirimWa()}
              >
                Kirim ke WhatsApp wali
              </button>
            ) : (
              <p className="text-xs text-slate-400 self-center">
                Nomor WhatsApp wali belum diisi di data siswa.
              </p>
            )}
          </div>
          {pesanWa ? (
            <p
              className={`text-xs ${pesanWa.galat ? "text-rose-100" : "text-emerald-100"}`}
              role={pesanWa.galat ? "alert" : "status"}
            >
              {pesanWa.teks}
            </p>
          ) : null}

          {p.status === "Sah" && bolehBatal ? (
            <form
              data-tanpa-konfirmasi
              onSubmit={jalankan}
              className="space-y-2 p-3 rounded-lg border border-rose-500/30"
            >
              <label className={LABEL} htmlFor="kuitansi-alasan">
                Alasan pembatalan
              </label>
              <input
                id="kuitansi-alasan"
                required
                maxLength={150}
                className={INPUT}
                value={alasan}
                onChange={(e) => {
                  setAlasan(e.target.value);
                  setAksi(null);
                }}
              />
              <p className="text-xs text-slate-400">
                Nomor kuitansi tetap terpakai dan jurnalnya dibalik.
                {p.metode === "Titipan"
                  ? " Saldo titipannya kembali dengan sendirinya."
                  : ' Pilih "Pindahkan ke titipan" bila uangnya tetap disimpan sekolah, misalnya tagihannya ternyata sudah dibayar di perangkat lain.'}
              </p>
              {galat ? (
                <p role="alert" className={GALAT_KOTAK}>
                  {galat}
                </p>
              ) : null}
              {aksi ? (
                <div className="flex flex-wrap gap-2">
                  <button
                    type="submit"
                    className={TOMBOL_BAHAYA}
                    disabled={sibuk}
                  >
                    {sibuk
                      ? "Memproses..."
                      : aksi === "batal"
                        ? "Ya, batalkan dan kembalikan uangnya"
                        : `Ya, pindahkan ${formatRupiah(p.total)} ke titipan`}
                  </button>
                  <button
                    type="button"
                    className={TOMBOL_KEDUA}
                    onClick={() => setAksi(null)}
                    disabled={sibuk}
                  >
                    Jangan
                  </button>
                </div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className={TOMBOL_KEDUA}
                    disabled={!alasan.trim()}
                    onClick={() => setAksi("batal")}
                  >
                    Batalkan kuitansi
                  </button>
                  {p.metode === "Titipan" ? null : (
                    <button
                      type="button"
                      className={TOMBOL_KEDUA}
                      disabled={!alasan.trim()}
                      onClick={() => setAksi("titipan")}
                    >
                      Pindahkan ke titipan
                    </button>
                  )}
                </div>
              )}
            </form>
          ) : null}
        </div>
      )}
    </Modal>
  );
}

// ── Kuitansi ────────────────────────────────────────────────────────────────

function awalBulan(): string {
  return `${hariIniWib().slice(0, 7)}-01`;
}

export function PanelKuitansi({
  bolehBatal,
  onInfo,
}: {
  bolehBatal: boolean;
  onInfo: (pesan: string) => void;
}) {
  const [dari, setDari] = useState(awalBulan());
  const [sampai, setSampai] = useState(hariIniWib());
  const [seri, setSeri] = useState("");
  const [data, setData] = useState<{
    items: KuitansiItem[];
    total_sah: number;
  } | null>(null);
  const [galatMuat, setGalatMuat] = useState<string | null>(null);
  const [lihat, setLihat] = useState<string | null>(null);

  const muat = useCallback(async () => {
    setGalatMuat(null);
    try {
      setData(await daftarKuitansi(dari, sampai, seri.trim() || null));
    } catch (error) {
      setGalatMuat(pesanGalat(error, "Daftar kuitansi tidak bisa dimuat."));
    }
  }, [dari, sampai, seri]);

  useEffect(() => {
    void muat();
  }, [muat]);
  useEffect(() => subscribeSyncCompleted(() => void muat()), [muat]);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <label className={LABEL} htmlFor="kuitansi-dari">
            Dari tanggal
          </label>
          <input
            id="kuitansi-dari"
            type="date"
            className={INPUT}
            value={dari}
            onChange={(e) => setDari(e.target.value)}
          />
        </div>
        <div>
          <label className={LABEL} htmlFor="kuitansi-sampai">
            Sampai tanggal
          </label>
          <input
            id="kuitansi-sampai"
            type="date"
            className={INPUT}
            value={sampai}
            onChange={(e) => setSampai(e.target.value)}
          />
        </div>
        <div>
          <label className={LABEL} htmlFor="kuitansi-seri">
            Seri (opsional)
          </label>
          <input
            id="kuitansi-seri"
            className={INPUT}
            placeholder="Contoh: TU1"
            value={seri}
            onChange={(e) => setSeri(e.target.value.toUpperCase())}
          />
        </div>
      </div>

      {galatMuat ? (
        <KotakGalat pesan={galatMuat} onUlang={() => void muat()} />
      ) : !data ? (
        <p className="p-6 text-center text-sm text-slate-400">
          Memuat kuitansi...
        </p>
      ) : data.items.length === 0 ? (
        <p className="p-6 text-center text-sm text-slate-400 rounded-xl border border-dashed border-slate-700">
          Belum ada kuitansi pada rentang ini.
        </p>
      ) : (
        <div className="space-y-2">
          <p className="text-sm text-slate-300">
            {data.items.length} kuitansi, total diterima{" "}
            <Rp nilai={data.total_sah} />
          </p>
          <ul className={`divide-y divide-slate-800 ${KARTU}`}>
            {data.items.map((item) => (
              <li key={item.id_pembayaran}>
                <button
                  type="button"
                  onClick={() => setLihat(item.id_pembayaran)}
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
                      {item.status === "Dibatalkan" ? (
                        "Dibatalkan"
                      ) : (
                        <Rp nilai={item.total} />
                      )}
                    </span>
                  </span>
                  <span className="mt-1 flex flex-wrap gap-2 text-xs text-slate-400">
                    <span className="text-slate-300">{item.nomor}</span>
                    <span>{item.tanggal}</span>
                    <span>
                      {item.metode === "Titipan" ? "Dari titipan" : item.metode}
                    </span>
                    {item.nomor_ganda ? (
                      <span className={LENCANA_AMBER}>Nomor kembar</span>
                    ) : null}
                    {item.status === "Dibatalkan" ? (
                      <span className={LENCANA_MERAH}>Dibatalkan</span>
                    ) : null}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {data.items.length >= BATAS_DAFTAR_KUITANSI ? (
            <p className="text-xs text-slate-400">
              Hanya {BATAS_DAFTAR_KUITANSI} kuitansi pertama yang ditampilkan.
              Persempit rentang tanggal atau seri.
            </p>
          ) : null}
          {data.items.some((item) => item.nomor_ganda) ? (
            <p className="text-xs text-slate-400">
              Nomor kembar muncul bila dua perangkat diberi seri yang sama.
              Kuitansinya tetap sah; perbaiki seri di tab Seri Kuitansi.
            </p>
          ) : null}
        </div>
      )}

      {lihat ? (
        <DialogKuitansi
          idPembayaran={lihat}
          bolehBatal={bolehBatal}
          onClose={() => setLihat(null)}
          onBerubah={async (pesan) => {
            setLihat(null);
            onInfo(pesan);
            await muat();
          }}
        />
      ) : null}
    </div>
  );
}

// ── Tinjauan ────────────────────────────────────────────────────────────────

export function PanelTinjauan({
  bolehBatal,
  onInfo,
}: {
  bolehBatal: boolean;
  onInfo: (pesan: string) => void;
}) {
  const [data, setData] = useState<TinjauanPembayaran | null>(null);
  const [galatMuat, setGalatMuat] = useState<string | null>(null);
  const [lihat, setLihat] = useState<string | null>(null);

  const muat = useCallback(async () => {
    setGalatMuat(null);
    try {
      setData(await getTinjauanPembayaran());
    } catch (error) {
      setGalatMuat(pesanGalat(error, "Tinjauan tidak bisa dimuat."));
    }
  }, []);

  useEffect(() => {
    void muat();
  }, [muat]);
  useEffect(() => subscribeSyncCompleted(() => void muat()), [muat]);

  if (galatMuat) {
    return <KotakGalat pesan={galatMuat} onUlang={() => void muat()} />;
  }
  if (!data) {
    return (
      <p className="p-6 text-center text-sm text-slate-400">
        Memeriksa kuitansi...
      </p>
    );
  }
  const kosong =
    data.lebih_bayar.length === 0 &&
    data.kemungkinan_ganda.length === 0 &&
    data.titipan_minus.length === 0;

  const tombolKuitansi = (id: string, isi: ReactNode) => (
    <button
      type="button"
      onClick={() => setLihat(id)}
      className="w-full min-h-11 px-3 py-2 text-left text-sm rounded-lg hover:bg-slate-800/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
    >
      {isi}
    </button>
  );

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-400">
        Kuitansi dari perangkat yang sempat offline baru bisa dibandingkan
        setelah tersinkron. Yang muncul di sini perlu diputuskan petugas: buka
        kuitansinya, lalu batalkan atau pindahkan ke titipan.
      </p>
      {kosong ? (
        <p className="p-6 text-center text-sm text-slate-400 rounded-xl border border-dashed border-slate-700">
          Tidak ada pembayaran yang perlu ditinjau.
        </p>
      ) : null}

      {data.lebih_bayar.length > 0 ? (
        <section className={`${KARTU} p-4 space-y-3`}>
          <h3 className="text-sm font-semibold text-slate-100">
            Tagihan lebih bayar ({data.lebih_bayar.length})
          </h3>
          {data.lebih_bayar.map((item) => (
            <div key={item.id_tagihan} className="space-y-1">
              <p className="text-sm text-slate-200">
                {item.nama_siswa}: {item.nama_tagihan}{" "}
                {periodeTampil(item.periode)}
                {item.dibatalkan ? (
                  <span className={`ml-2 text-xs ${LENCANA_MERAH}`}>
                    Tagihan dibatalkan
                  </span>
                ) : null}
              </p>
              <p className="text-xs text-slate-400">
                Tagihan <Rp nilai={item.bersih} />, dibayar{" "}
                <Rp nilai={item.dibayar} />, lebih{" "}
                <Rp nilai={item.dibayar - item.bersih} />
              </p>
              <ul>
                {item.kuitansi.map((k) => (
                  <li key={k.id_pembayaran}>
                    {tombolKuitansi(
                      k.id_pembayaran,
                      <span className="flex flex-wrap justify-between gap-x-3">
                        <span className="text-slate-100">
                          {k.nomor}{" "}
                          <span className="text-xs text-slate-400">
                            {k.tanggal}
                          </span>
                        </span>
                        <Rp nilai={k.nominal} />
                      </span>,
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      ) : null}

      {data.kemungkinan_ganda.length > 0 ? (
        <section className={`${KARTU} p-4 space-y-2`}>
          <h3 className="text-sm font-semibold text-slate-100">
            Kemungkinan dicatat dua kali ({data.kemungkinan_ganda.length})
          </h3>
          <p className="text-xs text-slate-400">
            Siswa, tanggal, dan jumlah sama, dari perangkat yang berbeda.
          </p>
          <ul>
            {data.kemungkinan_ganda.map((k) => (
              <li key={k.id_pembayaran}>
                {tombolKuitansi(
                  k.id_pembayaran,
                  <>
                    <span className="flex flex-wrap justify-between gap-x-3">
                      <span className="text-slate-100">{k.nama_siswa}</span>
                      <Rp nilai={k.total} />
                    </span>
                    <span className="block text-xs text-slate-400">
                      {k.nomor} · {k.tanggal}
                    </span>
                  </>,
                )}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {data.titipan_minus.length > 0 ? (
        <section className={`${KARTU} p-4 space-y-2`}>
          <h3 className="text-sm font-semibold text-slate-100">
            Titipan minus ({data.titipan_minus.length})
          </h3>
          <p className="text-xs text-slate-400">
            Kuitansi yang menghasilkan titipan dibatalkan setelah titipannya
            terpakai. Tagih kekurangannya ke wali, atau buka tab Bayar, cari
            siswanya, lalu batalkan kuitansi pemakaian titipan dari daftar
            kuitansi terakhirnya.
          </p>
          <ul className="space-y-1">
            {data.titipan_minus.map((item) => (
              <li
                key={item.id_siswa}
                className="flex justify-between gap-3 px-3 py-2 text-sm"
              >
                <span className="text-slate-200">{item.nama_siswa}</span>
                <span className="text-rose-100">
                  <Rp nilai={item.saldo} />
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {lihat ? (
        <DialogKuitansi
          idPembayaran={lihat}
          bolehBatal={bolehBatal}
          onClose={() => setLihat(null)}
          onBerubah={async (pesan) => {
            setLihat(null);
            onInfo(pesan);
            await muat();
          }}
        />
      ) : null}
    </div>
  );
}

// ── Seri kuitansi ───────────────────────────────────────────────────────────

export function PanelSeri({
  bolehKelola,
  onInfo,
}: {
  bolehKelola: boolean;
  onInfo: (pesan: string) => void;
}) {
  const [data, setData] = useState<SeriKuitansi | null>(null);
  const [galatMuat, setGalatMuat] = useState<string | null>(null);
  const [ubah, setUbah] = useState<{
    device_code: string;
    seri: string;
    nama_perangkat: string;
  } | null>(null);
  const [galat, setGalat] = useState<string | null>(null);
  const [sibuk, setSibuk] = useState(false);
  const isSubmittingRef = useRef(false);

  const muat = useCallback(async () => {
    setGalatMuat(null);
    try {
      setData(await getSeriKuitansi());
    } catch (error) {
      setGalatMuat(pesanGalat(error, "Seri kuitansi tidak bisa dimuat."));
    }
  }, []);

  useEffect(() => {
    void muat();
  }, [muat]);
  useEffect(() => subscribeSyncCompleted(() => void muat()), [muat]);

  async function simpan(event: FormEvent) {
    event.preventDefault();
    if (!ubah || isSubmittingRef.current) return;
    isSubmittingRef.current = true;
    setSibuk(true);
    setGalat(null);
    try {
      const hasil = await simpanSeriKuitansi(
        ubah.device_code,
        ubah.seri,
        ubah.nama_perangkat,
      );
      setUbah(null);
      onInfo(`Seri ${hasil.seri} tersimpan.`);
      await muat();
    } catch (error) {
      setGalat(pesanGalat(error, "Seri tidak bisa disimpan."));
    } finally {
      isSubmittingRef.current = false;
      setSibuk(false);
    }
  }

  if (galatMuat) {
    return <KotakGalat pesan={galatMuat} onUlang={() => void muat()} />;
  }
  if (!data) {
    return (
      <p className="p-6 text-center text-sm text-slate-400">
        Memuat seri kuitansi...
      </p>
    );
  }
  const perangkatIni = data.device_code;

  return (
    <div className="space-y-4">
      <div className={`${KARTU} p-4 space-y-2 text-sm`}>
        {perangkatIni ? (
          <>
            <p className="text-slate-200">
              Kuitansi dari perangkat ini bernomor{" "}
              <span className="font-semibold text-slate-100">
                KWT/tahun/{data.seri_aktif}/0001
              </span>
              {data.terdaftar ? "." : ", seri otomatis dari kode perangkat."}
            </p>
            {!data.terdaftar && bolehKelola ? (
              <button
                type="button"
                className={TOMBOL_KEDUA}
                onClick={() => {
                  setGalat(null);
                  setUbah({
                    device_code: perangkatIni,
                    seri: "",
                    nama_perangkat: "",
                  });
                }}
              >
                Beri seri untuk perangkat ini
              </button>
            ) : null}
          </>
        ) : (
          <p className="text-slate-200">
            Kuitansi dari aplikasi Web memakai seri{" "}
            <span className="font-semibold text-slate-100">WEB</span>. Seri
            perangkat Desktop dan Mobile diberikan dari perangkat itu sendiri.
          </p>
        )}
        <p className="text-xs text-slate-400">
          Setiap perangkat punya deret nomornya sendiri, jadi dua loket yang
          sama-sama offline tidak pernah membuat nomor yang sama. Mengganti seri
          tidak mengubah kuitansi yang sudah terbit.
        </p>
      </div>

      {data.items.length === 0 ? (
        <p className="p-6 text-center text-sm text-slate-400 rounded-xl border border-dashed border-slate-700">
          Belum ada perangkat yang diberi seri.
        </p>
      ) : (
        <ul className={`divide-y divide-slate-800 ${KARTU}`}>
          {data.items.map((item) => (
            <li
              key={item.device_code}
              className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
            >
              <span className="min-w-0 text-sm">
                <span className="font-semibold text-slate-100">
                  {item.seri}
                </span>{" "}
                <span className="text-slate-300">
                  {item.nama_perangkat || "Tanpa nama"}
                </span>
                {item.device_code === perangkatIni ? (
                  <span className="ml-2 text-xs text-sky-300">
                    Perangkat ini
                  </span>
                ) : null}
                <span className="block text-xs text-slate-400 break-all">
                  {item.device_code}
                </span>
              </span>
              {bolehKelola ? (
                <button
                  type="button"
                  className={TOMBOL_KEDUA}
                  aria-label={`Ubah seri ${item.seri}`}
                  onClick={() => {
                    setGalat(null);
                    setUbah({ ...item });
                  }}
                >
                  Ubah
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {ubah ? (
        <Modal
          isOpen
          onClose={() => setUbah(null)}
          title="Seri kuitansi perangkat"
          hideFooter
        >
          <form onSubmit={simpan} className="space-y-3 text-sm">
            <p className="text-xs text-slate-400 break-all">
              Kode perangkat {ubah.device_code}
            </p>
            <div>
              <label className={LABEL} htmlFor="seri-kode">
                Seri (2 sampai 8 huruf atau angka)
              </label>
              <input
                id="seri-kode"
                required
                maxLength={8}
                className={INPUT}
                placeholder="Contoh: TU1"
                value={ubah.seri}
                onChange={(e) =>
                  setUbah({ ...ubah, seri: e.target.value.toUpperCase() })
                }
              />
            </div>
            <div>
              <label className={LABEL} htmlFor="seri-nama">
                Nama perangkat (opsional)
              </label>
              <input
                id="seri-nama"
                maxLength={60}
                className={INPUT}
                placeholder="Contoh: Laptop loket TU"
                value={ubah.nama_perangkat}
                onChange={(e) =>
                  setUbah({ ...ubah, nama_perangkat: e.target.value })
                }
              />
            </div>
            {galat ? (
              <p role="alert" className={GALAT_KOTAK}>
                {galat}
              </p>
            ) : null}
            <button type="submit" className={TOMBOL_UTAMA} disabled={sibuk}>
              {sibuk ? "Menyimpan..." : "Simpan seri"}
            </button>
          </form>
        </Modal>
      ) : null}
    </div>
  );
}
