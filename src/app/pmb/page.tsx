"use client";

import { redirect } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { KelolaBerkas } from "@/components/berkas/KelolaBerkas";
import {
  DataDapodikDetail,
  TombolEksporDapodik,
} from "@/components/pmb/DataDapodikPmb";
import { PembayaranPmb } from "@/components/pmb/PembayaranPmb";
import { FeedbackBanner } from "@/components/ui/FeedbackBanner";
import { Modal } from "@/components/ui/Modal";
import { PageHeader } from "@/components/ui/PageHeader";
import { PilihCari } from "@/components/ui/PilihCari";
import { canAccessArea, hasPermission } from "@/lib/auth/access";
import { useAuth } from "@/lib/context/AuthContext";
import { getDaftarRombel, getDaftarUnit } from "@/lib/gateways/academic";
import {
  hapusBerkasPendaftar,
  simpanBerkasPendaftar,
} from "@/lib/gateways/berkas-sekolah";
import {
  daftarGelombangPmb,
  daftarPendaftarPmb,
  getBerkasPendaftarPmb,
  getDetailPendaftarPmb,
  hapusPendaftarPmb,
  jadikanSiswaDariPmb,
  type PmbRegistrantDetail,
  type PmbRegistrantItem,
  type PmbWave,
  simpanGelombangPmb,
  ubahStatusPendaftarPmb,
} from "@/lib/gateways/pmb";
import { useConfirmDialog } from "@/lib/hooks/useConfirmDialog";
import {
  rupiahPmb,
  tolakUbahStatusPmb,
} from "@/lib/validations/pmb-pembayaran";
import { KEADAAN_BAYAR_PMB, PMB_STATUS_MANUAL } from "@/types/pmb";

interface Rombel {
  id_rombel: string;
  nama_rombel: string;
}

const GELOMBANG_KOSONG = {
  nama: "",
  tahunAjaran: "",
  tanggalBuka: "",
  tanggalTutup: "",
  kuota: 0,
  biayaPendaftaran: 0,
  lamaBayarHari: 7,
  isAktif: true,
};

export default function PmbPage() {
  const { user, isAuthenticated, isLoading: authLoading } = useAuth();
  const { konfirmasi, dialogKonfirmasi } = useConfirmDialog();
  const id = useId();

  const [memuat, setMemuat] = useState(false);
  const [galat, setGalat] = useState<string | null>(null);
  const [kabar, setKabar] = useState<string | null>(null);

  const [gelombang, setGelombang] = useState<PmbWave[]>([]);
  const [pendaftar, setPendaftar] = useState<PmbRegistrantItem[]>([]);
  const [rombel, setRombel] = useState<Rombel[]>([]);
  // Nama unit aktif untuk modal promosi; unit siswa disimpan sebagai nama.
  const [daftarUnit, setDaftarUnit] = useState<string[]>([]);

  const [filterGelombang, setFilterGelombang] = useState("Semua");
  const [filterStatus, setFilterStatus] = useState("Semua");
  const [filterBayar, setFilterBayar] = useState("Semua");
  const [pencarian, setPencarian] = useState("");

  const [detail, setDetail] = useState<PmbRegistrantDetail | null>(null);
  const [modalGelombang, setModalGelombang] = useState(false);
  const [modalPromosi, setModalPromosi] = useState<PmbRegistrantItem | null>(
    null,
  );
  const [draftGelombang, setDraftGelombang] = useState(GELOMBANG_KOSONG);

  /**
   * Penjaga klik ganda (aturan 5, ditegakkan mesin oleh `audit:ui-guard`).
   *
   * `useRef`, bukan state: state baru terlihat setelah render berikutnya,
   * sehingga dua klik cepat sama-sama membaca `false`. Di halaman ini akibatnya
   * paling mahal pada tombol "Jadikan Siswa": dua permintaan berarti dua baris
   * `master_data`, dua kartu identitas, dan dua token QR untuk satu anak.
   */
  const isSubmittingRef = useRef(false);

  const muatData = useCallback(async () => {
    setMemuat(true);
    setGalat(null);
    try {
      const [hasilPendaftar, hasilGelombang] = await Promise.all([
        daftarPendaftarPmb({
          id_gelombang: filterGelombang,
          status: filterStatus,
          search: pencarian || null,
          pembayaran: filterBayar,
        }),
        daftarGelombangPmb(),
      ]);
      setPendaftar(hasilPendaftar.items);
      setGelombang(hasilGelombang.items);
    } catch (error) {
      // PMB cloud-only: tanpa jaringan tidak ada data sama sekali. Kegagalannya
      // WAJIB terlihat: daftar kosong yang sebenarnya kegagalan tidak bisa
      // dibedakan dari "belum ada pendaftar", dan panitia akan menyimpulkan yang
      // salah tepat pada hari pendaftaran dibuka.
      setGalat(
        error instanceof Error
          ? `${error.message}: halaman PMB membaca data langsung dari cloud dan memerlukan jaringan.`
          : "Gagal memuat data PMB. Halaman ini memerlukan jaringan.",
      );
      setPendaftar([]);
    } finally {
      setMemuat(false);
    }
  }, [filterGelombang, filterStatus, filterBayar, pencarian]);

  useEffect(() => {
    if (!authLoading && isAuthenticated) {
      void muatData();
    }
  }, [authLoading, isAuthenticated, muatData]);

  useEffect(() => {
    if (!authLoading && isAuthenticated) {
      getDaftarRombel()
        .then((hasil) => setRombel(hasil as unknown as Rombel[]))
        .catch((error) => {
          // Rombel hanya dipakai pada modal promosi. Kegagalannya tidak boleh
          // menjatuhkan seluruh halaman verifikasi, tetapi juga tidak didiamkan:
          // modal promosi akan mengatakan daftarnya kosong.
          console.error("[pmb] gagal memuat daftar rombel:", error);
        });
      getDaftarUnit()
        .then((hasil) =>
          setDaftarUnit(
            hasil
              .filter((u) => Number(u.status_aktif ?? 1) === 1)
              .map((u) => String(u.nama_unit)),
          ),
        )
        .catch((error) => {
          // Sama dengan rombel: modal promosi tetap bisa dipakai tanpa unit.
          console.error("[pmb] gagal memuat daftar unit:", error);
        });
    }
  }, [authLoading, isAuthenticated]);

  async function bukaDetail(idPendaftar: string) {
    setGalat(null);
    try {
      setDetail(await getDetailPendaftarPmb(idPendaftar));
    } catch (error) {
      setGalat(error instanceof Error ? error.message : "Detail gagal dimuat.");
    }
  }

  async function ubahStatus(idPendaftar: string, status: string) {
    if (isSubmittingRef.current) return;
    isSubmittingRef.current = true;
    setGalat(null);
    try {
      await ubahStatusPendaftarPmb({ idPendaftar, status });
      setKabar(`Status pendaftar diubah menjadi "${status}".`);
      await muatData();
      if (detail?.pendaftar.id_pendaftar === idPendaftar) {
        setDetail(await getDetailPendaftarPmb(idPendaftar));
      }
    } catch (error) {
      setGalat(error instanceof Error ? error.message : "Status gagal diubah.");
    } finally {
      isSubmittingRef.current = false;
    }
  }

  async function setelahBayarBerubah(pesan: string) {
    setKabar(pesan);
    await muatData();
    if (detail) {
      setDetail(await getDetailPendaftarPmb(detail.pendaftar.id_pendaftar));
    }
  }

  async function hapusPendaftar(item: PmbRegistrantItem) {
    const setuju = await konfirmasi({
      title: "Hapus pendaftar ini?",
      description: (
        <>
          Seluruh berkas identitas <strong>{item.nama_lengkap}</strong> (kartu
          keluarga, akta kelahiran, ijazah) ikut terhapus permanen. Berkas itu
          diunggah keluarganya dan tidak tersimpan di tempat lain mana pun di
          sistem ini.
        </>
      ),
      preserved:
        "Gelombang pendaftaran dan data pendaftar lain tidak terpengaruh.",
      confirmLabel: "Hapus permanen",
      tone: "danger",
    });
    if (!setuju) return;

    if (isSubmittingRef.current) return;
    isSubmittingRef.current = true;
    setGalat(null);
    try {
      await hapusPendaftarPmb(item.id_pendaftar);
      setKabar("Pendaftar dihapus.");
      setDetail(null);
      await muatData();
    } catch (error) {
      setGalat(
        error instanceof Error ? error.message : "Pendaftar gagal dihapus.",
      );
    } finally {
      isSubmittingRef.current = false;
    }
  }

  async function promosikan(peristiwa: React.FormEvent<HTMLFormElement>) {
    peristiwa.preventDefault();
    if (!modalPromosi) return;
    if (isSubmittingRef.current) return;
    isSubmittingRef.current = true;
    setGalat(null);

    try {
      const data = new FormData(peristiwa.currentTarget);
      const idRombel = String(data.get("idRombel") ?? "").trim();
      const angkatan = Number(data.get("angkatan") ?? 0);
      const unit = String(data.get("unit") ?? "").trim();

      await jadikanSiswaDariPmb({
        idPendaftar: modalPromosi.id_pendaftar,
        idRombel,
        angkatan: angkatan || null,
        unit: unit || null,
      });
      setKabar(
        `${modalPromosi.nama_lengkap} kini terdaftar sebagai siswa aktif.`,
      );
      setModalPromosi(null);
      setDetail(null);
      await muatData();
    } catch (error) {
      setGalat(
        error instanceof Error
          ? error.message
          : "Pendaftar gagal diangkat menjadi siswa.",
      );
    } finally {
      isSubmittingRef.current = false;
    }
  }

  async function simpanGelombang(peristiwa: React.FormEvent<HTMLFormElement>) {
    peristiwa.preventDefault();
    if (isSubmittingRef.current) return;
    isSubmittingRef.current = true;
    setGalat(null);

    try {
      await simpanGelombangPmb(draftGelombang);
      setKabar("Gelombang pendaftaran disimpan.");
      setModalGelombang(false);
      setDraftGelombang(GELOMBANG_KOSONG);
      await muatData();
    } catch (error) {
      setGalat(
        error instanceof Error ? error.message : "Gelombang gagal disimpan.",
      );
    } finally {
      isSubmittingRef.current = false;
    }
  }

  if (authLoading) {
    return (
      <AppShell>
        <p className="text-slate-400 text-sm">Memuat…</p>
      </AppShell>
    );
  }

  if (!isAuthenticated) {
    redirect("/login");
  }

  if (!canAccessArea(user, "pmb")) {
    redirect("/forbidden");
  }

  const bolehKelola = hasPermission(user, "pmb.manage");
  const bolehHapus = hasPermission(user, "pmb.delete");
  const bolehAngkat =
    hasPermission(user, "pmb.promote") &&
    hasPermission(user, "students.manage");

  return (
    <AppShell>
      <div className="space-y-6">
        <PageHeader
          actions={
            bolehKelola ? (
              <button
                className="rounded-lg bg-amber-500 px-4 py-2 font-semibold text-slate-950 text-sm"
                onClick={() => {
                  setDraftGelombang(GELOMBANG_KOSONG);
                  setModalGelombang(true);
                }}
                type="button"
              >
                Gelombang Baru
              </button>
            ) : null
          }
          description="Meninjau calon siswa yang mendaftar lewat situs publik, memverifikasi berkasnya, dan mengangkat yang diterima menjadi siswa aktif. Data PMB berada di cloud dan memerlukan jaringan."
          eyebrow="Kesiswaan"
          title="Penerimaan Peserta Didik Baru"
        />

        {galat ? (
          <FeedbackBanner onDismiss={() => setGalat(null)} tone="error">
            {galat}
          </FeedbackBanner>
        ) : null}
        {kabar ? (
          <FeedbackBanner onDismiss={() => setKabar(null)} tone="success">
            {kabar}
          </FeedbackBanner>
        ) : null}

        <section className="rounded-xl border border-white/10 bg-slate-900/95 p-4">
          <h2 className="font-semibold text-sm text-white">
            Gelombang Pendaftaran
          </h2>
          {gelombang.length === 0 ? (
            <p className="mt-3 text-slate-400 text-sm">
              Belum ada gelombang. Situs publik tidak akan menerima pendaftaran
              sampai satu gelombang dibuat dan diaktifkan.
            </p>
          ) : (
            <ul className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {gelombang.map((item) => (
                <li
                  className="rounded-lg border border-white/10 p-3"
                  key={item.id_gelombang}
                >
                  <p className="font-medium text-sm text-white">
                    {item.nama}
                    {item.is_aktif ? (
                      <span className="ml-2 rounded-full bg-emerald-500/20 px-2 py-0.5 text-emerald-300 text-xs">
                        Aktif
                      </span>
                    ) : null}
                  </p>
                  <p className="mt-1 text-slate-400 text-xs">
                    {item.tahun_ajaran} · {item.tanggal_buka} →{" "}
                    {item.tanggal_tutup}
                  </p>
                  <p className="mt-1 text-slate-400 text-xs">
                    Pendaftar: {item.terpakai ?? 0}
                    {item.kuota > 0 ? ` / ${item.kuota}` : ""}
                  </p>
                  {item.biaya_pendaftaran > 0 ? (
                    <p className="mt-1 text-slate-400 text-xs">
                      Biaya Rp{rupiahPmb(item.biaya_pendaftaran)}, batas bayar{" "}
                      {item.lama_bayar_hari} hari
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-xl border border-white/10 bg-slate-900/95 p-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <label
                className="block text-slate-400 text-xs"
                htmlFor={`${id}-filter-gelombang`}
              >
                Filter gelombang
              </label>
              <PilihCari
                className="mt-1 w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white"
                id={`${id}-filter-gelombang`}
                onChange={(e) => setFilterGelombang(e.target.value)}
                value={filterGelombang}
              >
                <option value="Semua">Semua gelombang</option>
                {gelombang.map((item) => (
                  <option key={item.id_gelombang} value={item.id_gelombang}>
                    {item.nama}
                  </option>
                ))}
              </PilihCari>
            </div>
            <div>
              <label
                className="block text-slate-400 text-xs"
                htmlFor={`${id}-filter-status`}
              >
                Filter status
              </label>
              <select
                className="mt-1 w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white"
                id={`${id}-filter-status`}
                onChange={(e) => setFilterStatus(e.target.value)}
                value={filterStatus}
              >
                <option value="Semua">Semua status</option>
                {PMB_STATUS_MANUAL.map((status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
                <option value="Terdaftar">Terdaftar</option>
              </select>
            </div>
            <div>
              <label
                className="block text-slate-400 text-xs"
                htmlFor={`${id}-filter-bayar`}
              >
                Filter pembayaran
              </label>
              <select
                className="mt-1 w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white"
                id={`${id}-filter-bayar`}
                onChange={(e) => setFilterBayar(e.target.value)}
                value={filterBayar}
              >
                <option value="Semua">Semua pembayaran</option>
                {KEADAAN_BAYAR_PMB.map((keadaan) => (
                  <option key={keadaan} value={keadaan}>
                    {keadaan}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label
                className="block text-slate-400 text-xs"
                htmlFor={`${id}-cari`}
              >
                Cari nama / nomor pendaftaran
              </label>
              <input
                className="mt-1 w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white"
                id={`${id}-cari`}
                onChange={(e) => setPencarian(e.target.value)}
                type="search"
                value={pencarian}
              />
            </div>
          </div>

          <div className="mt-3">
            <TombolEksporDapodik
              filter={{
                id_gelombang: filterGelombang,
                status: filterStatus,
                search: pencarian || null,
                pembayaran: filterBayar,
              }}
            />
          </div>

          <div className="mt-4 overflow-x-auto">
            {memuat ? (
              <p className="text-slate-400 text-sm">Memuat pendaftar…</p>
            ) : pendaftar.length === 0 && !galat ? (
              <p className="text-slate-400 text-sm">
                Belum ada pendaftar yang cocok dengan filter ini.
              </p>
            ) : (
              <table className="w-full text-left text-sm">
                <thead className="text-slate-400 text-xs uppercase">
                  <tr>
                    <th className="py-2">Nomor</th>
                    <th className="py-2">Nama</th>
                    <th className="py-2">Gelombang</th>
                    <th className="py-2">Unit</th>
                    <th className="py-2">Berkas</th>
                    <th className="py-2">Status</th>
                    <th className="py-2">Pembayaran</th>
                    <th className="py-2">Aksi</th>
                  </tr>
                </thead>
                <tbody>
                  {pendaftar.map((item) => (
                    <tr
                      className="border-white/5 border-t"
                      key={item.id_pendaftar}
                    >
                      <td className="py-2 font-mono text-slate-300 text-xs">
                        {item.nomor_pendaftaran}
                      </td>
                      <td className="py-2 text-white">{item.nama_lengkap}</td>
                      <td className="py-2 text-slate-400">
                        {item.nama_gelombang}
                      </td>
                      <td className="py-2 text-slate-400">
                        {item.pilihan_unit || "-"}
                      </td>
                      <td className="py-2 text-slate-400">
                        {item.jumlah_berkas}
                      </td>
                      <td className="py-2 text-slate-300">{item.status}</td>
                      <td className="py-2 text-slate-400">
                        {item.keadaan_bayar}
                        {item.keadaan_bayar === "Menunggu Pembayaran" &&
                        item.batas_bayar
                          ? ` (s.d. ${item.batas_bayar})`
                          : ""}
                      </td>
                      <td className="py-2">
                        <button
                          className="rounded-md border border-white/15 px-2 py-1 text-xs text-white"
                          onClick={() => void bukaDetail(item.id_pendaftar)}
                          type="button"
                        >
                          Detail
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>
      </div>

      <Modal
        isOpen={detail !== null}
        onClose={() => setDetail(null)}
        title={detail?.pendaftar.nama_lengkap ?? "Detail Pendaftar"}
      >
        {detail ? (
          <div className="space-y-4 text-sm">
            <dl className="grid grid-cols-2 gap-2 text-slate-300">
              <dt className="text-slate-500">Nomor</dt>
              <dd className="font-mono">
                {detail.pendaftar.nomor_pendaftaran}
              </dd>
              <dt className="text-slate-500">NISN</dt>
              <dd>{detail.pendaftar.nisn || "-"}</dd>
              <dt className="text-slate-500">Asal sekolah</dt>
              <dd>{detail.pendaftar.asal_sekolah || "-"}</dd>
              <dt className="text-slate-500">Unit tujuan</dt>
              <dd>{detail.pendaftar.pilihan_unit || "-"}</dd>
              <dt className="text-slate-500">Program keahlian</dt>
              <dd>{detail.pendaftar.pilihan_jurusan || "-"}</dd>
              <dt className="text-slate-500">Wali</dt>
              <dd>{detail.pendaftar.nama_wali}</dd>
              <dt className="text-slate-500">WhatsApp wali</dt>
              <dd>{detail.pendaftar.no_whatsapp_wali}</dd>
              <dt className="text-slate-500">Status</dt>
              <dd>{detail.pendaftar.status}</dd>
            </dl>

            <PembayaranPmb
              bolehKelola={bolehKelola}
              onBerubah={setelahBayarBerubah}
              pendaftar={detail.pendaftar}
            />

            <DataDapodikDetail pendaftar={detail.pendaftar} />

            <div>
              <h3 className="font-semibold text-white text-xs uppercase">
                Berkas
              </h3>
              {detail.pendaftar.status === "Terdaftar" ? (
                <p className="mt-1 text-slate-400">
                  Berkas sudah dipindah ke data siswa. Kelola di halaman Siswa,
                  tombol DAPODIK.
                </p>
              ) : (
                <div className="mt-2">
                  <KelolaBerkas
                    ambil={getBerkasPendaftarPmb}
                    berkas={detail.berkas}
                    bisaUbah={bolehKelola}
                    hapus={hapusBerkasPendaftar}
                    onBerubah={async () => {
                      await muatData();
                      setDetail(
                        await getDetailPendaftarPmb(
                          detail.pendaftar.id_pendaftar,
                        ),
                      );
                    }}
                    simpan={(berkas) =>
                      simpanBerkasPendaftar(
                        detail.pendaftar.id_pendaftar,
                        berkas,
                      )
                    }
                  />
                </div>
              )}
            </div>

            {bolehKelola ? (
              <div>
                <label
                  className="block text-slate-400 text-xs"
                  htmlFor={`${id}-ubah-status`}
                >
                  Ubah status verifikasi
                </label>
                <select
                  className="mt-1 w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white"
                  id={`${id}-ubah-status`}
                  onChange={(e) =>
                    void ubahStatus(
                      detail.pendaftar.id_pendaftar,
                      e.target.value,
                    )
                  }
                  value={detail.pendaftar.status}
                >
                  {PMB_STATUS_MANUAL.filter(
                    (status) =>
                      status === detail.pendaftar.status ||
                      !tolakUbahStatusPmb(
                        detail.pendaftar.keadaan_bayar,
                        status,
                      ),
                  ).map((status) => (
                    <option key={status} value={status}>
                      {status}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}

            {bolehAngkat &&
            ["Baru", "Berkas Lengkap", "Terverifikasi"].includes(
              detail.pendaftar.status,
            ) &&
            !tolakUbahStatusPmb(detail.pendaftar.keadaan_bayar, "Diterima") ? (
              <p className="text-slate-400 text-xs">
                Ubah status ke Diterima untuk menjadikan pendaftar ini siswa.
              </p>
            ) : null}

            <div className="flex flex-wrap gap-2 pt-2">
              {bolehAngkat && detail.pendaftar.status === "Diterima" ? (
                <button
                  className="rounded-lg bg-emerald-500 px-3 py-2 font-semibold text-slate-950 text-xs"
                  onClick={() => {
                    setModalPromosi(detail.pendaftar);
                    setDetail(null);
                  }}
                  type="button"
                >
                  Jadikan Siswa
                </button>
              ) : null}
              {bolehHapus && detail.pendaftar.status !== "Terdaftar" ? (
                <button
                  className="rounded-lg border border-rose-500/40 px-3 py-2 text-rose-300 text-xs"
                  onClick={() => void hapusPendaftar(detail.pendaftar)}
                  type="button"
                >
                  Hapus Pendaftar
                </button>
              ) : null}
            </div>
          </div>
        ) : null}
      </Modal>

      <Modal
        isOpen={modalPromosi !== null}
        onClose={() => setModalPromosi(null)}
        title="Jadikan Siswa"
      >
        <form className="space-y-4 text-sm" onSubmit={promosikan}>
          <p className="text-slate-300">
            {modalPromosi?.nama_lengkap} akan dibuatkan data induk, data siswa,
            kartu identitas, dan token QR absensi. Datanya tersebar ke seluruh
            perangkat lewat sinkronisasi.
          </p>
          <div>
            <label
              className="block text-slate-400 text-xs"
              htmlFor={`${id}-rombel`}
            >
              Rombel tujuan
            </label>
            <PilihCari
              className="mt-1 w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-white"
              id={`${id}-rombel`}
              name="idRombel"
              required
            >
              <option value="">Pilih rombel</option>
              {rombel.map((item) => (
                <option key={item.id_rombel} value={item.id_rombel}>
                  {item.nama_rombel}
                </option>
              ))}
            </PilihCari>
            {rombel.length === 0 ? (
              <p className="mt-1 text-amber-300 text-xs">
                Daftar rombel belum termuat. Pastikan jaringan tersedia lalu
                buka ulang jendela ini.
              </p>
            ) : null}
          </div>
          <div>
            <label
              className="block text-slate-400 text-xs"
              htmlFor={`${id}-unit`}
            >
              Unit
            </label>
            <PilihCari
              className="mt-1 w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-white"
              defaultValue={
                modalPromosi?.pilihan_unit &&
                daftarUnit.includes(modalPromosi.pilihan_unit)
                  ? modalPromosi.pilihan_unit
                  : ""
              }
              id={`${id}-unit`}
              key={`${modalPromosi?.id_pendaftar ?? ""}-${daftarUnit.length}`}
              name="unit"
            >
              <option value="">Tanpa unit</option>
              {daftarUnit.map((nama) => (
                <option key={nama} value={nama}>
                  {nama}
                </option>
              ))}
            </PilihCari>
            {modalPromosi?.pilihan_unit &&
            daftarUnit.length > 0 &&
            !daftarUnit.includes(modalPromosi.pilihan_unit) ? (
              <p className="mt-1 text-amber-300 text-xs">
                Pendaftar memilih unit "{modalPromosi.pilihan_unit}", yang tidak
                ada lagi di daftar unit aktif. Pilih unitnya di sini.
              </p>
            ) : null}
          </div>
          <div>
            <label
              className="block text-slate-400 text-xs"
              htmlFor={`${id}-angkatan`}
            >
              Angkatan
            </label>
            <input
              className="mt-1 w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-white"
              defaultValue={new Date().getFullYear()}
              id={`${id}-angkatan`}
              name="angkatan"
              type="number"
            />
          </div>
          <button
            className="w-full rounded-lg bg-emerald-500 px-4 py-2 font-semibold text-slate-950"
            type="submit"
          >
            Buat data siswa
          </button>
        </form>
      </Modal>

      <Modal
        isOpen={modalGelombang}
        onClose={() => setModalGelombang(false)}
        title="Gelombang Pendaftaran"
      >
        <form className="space-y-3 text-sm" onSubmit={simpanGelombang}>
          <div>
            <label
              className="block text-slate-400 text-xs"
              htmlFor={`${id}-gel-nama`}
            >
              Nama gelombang
            </label>
            <input
              className="mt-1 w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-white"
              id={`${id}-gel-nama`}
              onChange={(e) =>
                setDraftGelombang((d) => ({ ...d, nama: e.target.value }))
              }
              required
              type="text"
              value={draftGelombang.nama}
            />
          </div>
          <div>
            <label
              className="block text-slate-400 text-xs"
              htmlFor={`${id}-gel-ta`}
            >
              Tahun ajaran
            </label>
            <input
              className="mt-1 w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-white"
              id={`${id}-gel-ta`}
              onChange={(e) =>
                setDraftGelombang((d) => ({
                  ...d,
                  tahunAjaran: e.target.value,
                }))
              }
              placeholder="2026/2027"
              required
              type="text"
              value={draftGelombang.tahunAjaran}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label
                className="block text-slate-400 text-xs"
                htmlFor={`${id}-gel-buka`}
              >
                Tanggal buka
              </label>
              <input
                className="mt-1 w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-white"
                id={`${id}-gel-buka`}
                onChange={(e) =>
                  setDraftGelombang((d) => ({
                    ...d,
                    tanggalBuka: e.target.value,
                  }))
                }
                required
                type="date"
                value={draftGelombang.tanggalBuka}
              />
            </div>
            <div>
              <label
                className="block text-slate-400 text-xs"
                htmlFor={`${id}-gel-tutup`}
              >
                Tanggal tutup
              </label>
              <input
                className="mt-1 w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-white"
                id={`${id}-gel-tutup`}
                onChange={(e) =>
                  setDraftGelombang((d) => ({
                    ...d,
                    tanggalTutup: e.target.value,
                  }))
                }
                required
                type="date"
                value={draftGelombang.tanggalTutup}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label
                className="block text-slate-400 text-xs"
                htmlFor={`${id}-gel-kuota`}
              >
                Kuota (0 = tanpa batas)
              </label>
              <input
                className="mt-1 w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-white"
                id={`${id}-gel-kuota`}
                min={0}
                onChange={(e) =>
                  setDraftGelombang((d) => ({
                    ...d,
                    kuota: Number(e.target.value),
                  }))
                }
                type="number"
                value={draftGelombang.kuota}
              />
            </div>
            <div>
              <label
                className="block text-slate-400 text-xs"
                htmlFor={`${id}-gel-biaya`}
              >
                Biaya pendaftaran
              </label>
              <input
                className="mt-1 w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-white"
                id={`${id}-gel-biaya`}
                min={0}
                onChange={(e) =>
                  setDraftGelombang((d) => ({
                    ...d,
                    biayaPendaftaran: Number(e.target.value),
                  }))
                }
                type="number"
                value={draftGelombang.biayaPendaftaran}
              />
            </div>
          </div>
          <div>
            <label
              className="block text-slate-400 text-xs"
              htmlFor={`${id}-gel-lama-bayar`}
            >
              Lama waktu bayar (hari sejak mendaftar, 1–60)
            </label>
            <input
              className="mt-1 w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-white"
              id={`${id}-gel-lama-bayar`}
              max={60}
              min={1}
              onChange={(e) =>
                setDraftGelombang((d) => ({
                  ...d,
                  lamaBayarHari: Number(e.target.value),
                }))
              }
              required
              type="number"
              value={draftGelombang.lamaBayarHari}
            />
          </div>
          <div className="flex items-center gap-2">
            <input
              checked={draftGelombang.isAktif}
              id={`${id}-gel-aktif`}
              name="isAktif"
              onChange={(e) =>
                setDraftGelombang((d) => ({ ...d, isAktif: e.target.checked }))
              }
              type="checkbox"
            />
            <label
              className="text-slate-300 text-xs"
              htmlFor={`${id}-gel-aktif`}
            >
              Aktifkan gelombang ini (gelombang lain otomatis dinonaktifkan)
            </label>
          </div>
          <button
            className="w-full rounded-lg bg-amber-500 px-4 py-2 font-semibold text-slate-950"
            type="submit"
          >
            Simpan gelombang
          </button>
        </form>
      </Modal>

      {dialogKonfirmasi}
    </AppShell>
  );
}
