"use client";

import { type FormEvent, useRef, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import {
  type JenisTugas,
  type OrgKepegawaian,
  simpanJenisTugas,
  simpanPengaturanKontrak,
} from "@/lib/gateways/hris";
import {
  ATURAN_BEBAN_MAKS,
  ATURAN_BEBAN_MIN,
  ATURAN_PERCOBAAN,
  ATURAN_PKWT,
} from "@/lib/validations/hris";
import { INPUT, LABEL, pesanGalat, TOMBOL, TOMBOL_UTAMA } from "./gaya";

/** Jenis tugas tambahan dan angka kontrak di tab Organisasi (`hr.org.manage`). */
export function OrganisasiTugasKontrak({
  org,
  bolehUbah,
  onBerhasil,
  onGalat,
}: {
  org: OrgKepegawaian;
  bolehUbah: boolean;
  onBerhasil: (pesan: string) => Promise<void>;
  onGalat: (pesan: string) => void;
}) {
  const [sunting, setSunting] = useState<JenisTugas | "baru" | null>(null);
  const [percobaan, setPercobaan] = useState(
    org.pengaturan.percobaan_maks_bulan,
  );
  const [pkwt, setPkwt] = useState(org.pengaturan.pkwt_maks_bulan);
  const [bebanMin, setBebanMin] = useState(org.pengaturan.beban_min_jp);
  const [bebanMaks, setBebanMaks] = useState(org.pengaturan.beban_maks_jp);
  const isSubmittingRef = useRef(false);
  const [menyimpan, setMenyimpan] = useState(false);

  const jalankan = async (aksi: () => Promise<unknown>, berhasil: string) => {
    if (isSubmittingRef.current) return;
    isSubmittingRef.current = true;
    setMenyimpan(true);
    try {
      await aksi();
      setSunting(null);
      await onBerhasil(berhasil);
    } catch (error) {
      onGalat(pesanGalat(error));
    } finally {
      isSubmittingRef.current = false;
      setMenyimpan(false);
    }
  };

  const simpanAngka = (event: FormEvent) => {
    event.preventDefault();
    void jalankan(
      () =>
        simpanPengaturanKontrak({
          percobaan_maks_bulan: percobaan,
          pkwt_maks_bulan: pkwt,
          beban_min_jp: bebanMin,
          beban_maks_jp: bebanMaks,
        }),
      "Angka kontrak dan batas JP disimpan.",
    );
  };

  return (
    <>
      <section aria-labelledby="judul-jenis-tugas" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2
            id="judul-jenis-tugas"
            className="text-base font-semibold text-white"
          >
            Jenis tugas tambahan
          </h2>
          {bolehUbah ? (
            <button
              type="button"
              className={TOMBOL_UTAMA}
              onClick={() => setSunting("baru")}
            >
              Tambah jenis
            </button>
          ) : null}
        </div>
        <p className="text-sm text-slate-400">
          Tunjangan per tugas dibuat di Konfigurasi Gaji dengan sasaran "Tugas
          tambahan". Ekuivalen JP mengikuti Permendikbud 15/2018; periksa ulang
          angkanya.
        </p>
        <ul className="space-y-2">
          {org.jenis_tugas.map((j) => (
            <li
              key={j.id_jenis}
              className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-sm"
            >
              <span>
                <span className="font-semibold text-white">{j.nama}</span>
                <span className="text-slate-400">
                  {" "}
                  · {j.ekuivalen_jp} JP/minggu
                  {j.is_aktif === 1 ? "" : " · nonaktif"}
                </span>
              </span>
              {bolehUbah ? (
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className={TOMBOL}
                    onClick={() => setSunting(j)}
                  >
                    Ubah
                  </button>
                  <button
                    type="button"
                    className={TOMBOL}
                    disabled={menyimpan}
                    onClick={() =>
                      jalankan(
                        () =>
                          simpanJenisTugas({
                            id: j.id_jenis,
                            nama: j.nama,
                            ekuivalen_jp: j.ekuivalen_jp,
                            is_aktif: j.is_aktif === 1 ? 0 : 1,
                          }),
                        j.is_aktif === 1
                          ? `"${j.nama}" dinonaktifkan.`
                          : `"${j.nama}" diaktifkan.`,
                      )
                    }
                  >
                    {j.is_aktif === 1 ? "Nonaktifkan" : "Aktifkan"}
                  </button>
                </div>
              ) : null}
            </li>
          ))}
          {org.jenis_tugas.length === 0 ? (
            <li className="text-sm text-slate-400">
              Belum ada jenis tugas. Jenis bawaan datang dari database cloud
              saat sinkron.
            </li>
          ) : null}
        </ul>
      </section>

      <section aria-labelledby="judul-angka-kontrak" className="space-y-3">
        <h2
          id="judul-angka-kontrak"
          className="text-base font-semibold text-white"
        >
          Angka kontrak dan beban mengajar
        </h2>
        <p className="text-sm text-slate-400">
          Dipakai untuk menandai kontrak di tab Kontrak dan guru di tab Beban
          Mengajar, tidak untuk menolak. Kosongkan untuk memakai angka bawaan.
          Batas JP per minggu mengikuti Permendikbud 15/2018; periksa ulang
          angkanya.
        </p>
        <form
          className="grid gap-4 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1fr_1fr_auto] lg:items-end"
          onSubmit={simpanAngka}
        >
          <div>
            <label htmlFor="angka-percobaan" className={LABEL}>
              Masa percobaan maksimal (bulan)
            </label>
            <input
              id="angka-percobaan"
              inputMode="numeric"
              disabled={!bolehUbah}
              value={percobaan}
              placeholder={`Bawaan ${ATURAN_PERCOBAAN.bawaan}`}
              onChange={(e) => setPercobaan(e.target.value)}
              className={INPUT}
            />
          </div>
          <div>
            <label htmlFor="angka-pkwt" className={LABEL}>
              GTT/PTT berturut-turut maksimal (bulan)
            </label>
            <input
              id="angka-pkwt"
              inputMode="numeric"
              disabled={!bolehUbah}
              value={pkwt}
              placeholder={`Bawaan ${ATURAN_PKWT.bawaan}`}
              onChange={(e) => setPkwt(e.target.value)}
              className={INPUT}
            />
          </div>
          <div>
            <label htmlFor="angka-beban-min" className={LABEL}>
              Beban mengajar minimal (JP/minggu)
            </label>
            <input
              id="angka-beban-min"
              inputMode="numeric"
              disabled={!bolehUbah}
              value={bebanMin}
              placeholder={`Bawaan ${ATURAN_BEBAN_MIN.bawaan}`}
              onChange={(e) => setBebanMin(e.target.value)}
              className={INPUT}
            />
          </div>
          <div>
            <label htmlFor="angka-beban-maks" className={LABEL}>
              Beban mengajar maksimal (JP/minggu)
            </label>
            <input
              id="angka-beban-maks"
              inputMode="numeric"
              disabled={!bolehUbah}
              value={bebanMaks}
              placeholder={`Bawaan ${ATURAN_BEBAN_MAKS.bawaan}`}
              onChange={(e) => setBebanMaks(e.target.value)}
              className={INPUT}
            />
          </div>
          {bolehUbah ? (
            <button type="submit" className={TOMBOL_UTAMA} disabled={menyimpan}>
              Simpan angka
            </button>
          ) : null}
        </form>
      </section>

      {sunting ? (
        <ModalJenis
          awal={sunting === "baru" ? null : sunting}
          menyimpan={menyimpan}
          onClose={() => setSunting(null)}
          onSimpan={(nama, ekuivalen) =>
            jalankan(
              () =>
                simpanJenisTugas({
                  id: sunting === "baru" ? undefined : sunting.id_jenis,
                  nama,
                  ekuivalen_jp: ekuivalen,
                  is_aktif:
                    sunting === "baru" || sunting.is_aktif === 1 ? 1 : 0,
                }),
              `Jenis tugas "${nama}" disimpan.`,
            )
          }
        />
      ) : null}
    </>
  );
}

function ModalJenis({
  awal,
  menyimpan,
  onClose,
  onSimpan,
}: {
  awal: JenisTugas | null;
  menyimpan: boolean;
  onClose: () => void;
  onSimpan: (nama: string, ekuivalen: number) => void;
}) {
  const [nama, setNama] = useState(awal?.nama ?? "");
  const [ekuivalen, setEkuivalen] = useState(String(awal?.ekuivalen_jp ?? 0));
  const kirim = (event: FormEvent) => {
    event.preventDefault();
    onSimpan(nama, Number(ekuivalen));
  };
  return (
    <Modal
      title={awal ? "Ubah jenis tugas" : "Tambah jenis tugas"}
      onClose={onClose}
      hideFooter
    >
      <form className="space-y-4" onSubmit={kirim}>
        <div>
          <label htmlFor="jenis-nama" className={LABEL}>
            Nama jenis tugas
          </label>
          <input
            id="jenis-nama"
            required
            minLength={2}
            maxLength={60}
            value={nama}
            onChange={(e) => setNama(e.target.value)}
            className={INPUT}
          />
        </div>
        <div>
          <label htmlFor="jenis-ekuivalen" className={LABEL}>
            Ekuivalen JP per minggu
          </label>
          <input
            id="jenis-ekuivalen"
            type="number"
            required
            min={0}
            max={40}
            step={1}
            value={ekuivalen}
            onChange={(e) => setEkuivalen(e.target.value)}
            className={INPUT}
          />
        </div>
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
