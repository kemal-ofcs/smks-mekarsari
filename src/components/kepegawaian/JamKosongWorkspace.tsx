"use client";

import {
  type FormEvent,
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
  TOMBOL_KEDUA,
  TOMBOL_UTAMA,
} from "@/components/inventory/gaya";
import { Modal } from "@/components/ui/Modal";
import { PilihCari } from "@/components/ui/PilihCari";
import {
  type DaftarJp,
  type JpTersusun,
  muatJpTerdampak,
  simpanPenanganan,
} from "@/lib/gateways/hr-pengajuan";
import { subscribeSyncCompleted } from "@/lib/gateways/sync-status";
import {
  dalamCakupan,
  LABEL_TANDA_JP,
  PESAN_BENTROK_PENGGANTI,
  penggantiBentrok,
  periksaPenanganan,
} from "@/lib/validations/hr-pengajuan";

// Disalin ke Mobile lewat `filesToCopy` (Q-50): hanya mengimpor yang ada di
// kedua workspace.

/** Status penanganan satu JP untuk dibaca. */
export function teksPenanganan(j: JpTersusun): string {
  const h = j.penanganan;
  if (!h) return "Belum ditangani";
  if (h.status === "Tugas Mandiri") return "Tugas mandiri";
  return `${h.status}: ${h.nama_pengganti || h.id_guru_pengganti}`;
}

/** Satu baris JP terdampak (dipakai juga rincian pengajuan). */
export function RingkasJp({ j }: { j: JpTersusun }) {
  return (
    <>
      <p className="font-semibold text-white">
        Jam {j.jam_ke} · {j.nama_rombel}
        <span className="font-normal text-slate-400">
          {" "}
          · {j.nama_mapel}
          {j.unit ? ` · ${j.unit}` : ""}
        </span>
      </p>
      <p className="text-slate-300">
        {j.tanggal} · guru {j.nama_guru || j.id_karyawan}
      </p>
      <p className={j.penanganan ? "text-emerald-300" : "text-amber-200"}>
        {teksPenanganan(j)}
        {j.penanganan?.catatan ? ` · ${j.penanganan.catatan}` : ""}
      </p>
      {j.tanda.length > 0 ? (
        <p className="text-xs text-amber-200">
          {j.tanda.map((t) => LABEL_TANDA_JP[t] ?? t).join(" · ")}
        </p>
      ) : null}
    </>
  );
}

type Aksi = "Diganti" | "Tugas Mandiri" | "Digabung";

/** Jam Kosong (§20.2.5, §20.5 layar 2): JP terdampak per tanggal dan penanganannya. */
export function JamKosongWorkspace() {
  const [tanggal, setTanggal] = useState(hariIniWib);
  const [unit, setUnit] = useState("");
  const [belumSaja, setBelumSaja] = useState(false);
  const [data, setData] = useState<DaftarJp | null>(null);
  const [galat, setGalat] = useState<string | null>(null);
  const [kabar, setKabar] = useState<string | null>(null);
  const [dialog, setDialog] = useState<{ j: JpTersusun; aksi: Aksi } | null>(
    null,
  );

  const muat = useCallback(async () => {
    try {
      setData(await muatJpTerdampak({ tanggal }));
      setGalat(null);
    } catch (error) {
      setGalat(pesanGalat(error, "Jam kosong gagal dimuat."));
    }
  }, [tanggal]);

  useEffect(() => {
    void muat();
  }, [muat]);
  useEffect(() => subscribeSyncCompleted(() => void muat()), [muat]);

  const daftarUnit = [
    ...new Set((data?.jp ?? []).map((j) => j.unit).filter(Boolean)),
  ].sort();
  const tampil = (data?.jp ?? []).filter(
    (j) => (!unit || j.unit === unit) && (!belumSaja || !j.penanganan),
  );
  const belum = (data?.jp ?? []).filter((j) => !j.penanganan).length;

  const alasanTerkunci = (j: JpTersusun): string | null => {
    if (!data) return null;
    const cek = periksaPenanganan(
      j.id_karyawan,
      "",
      data.sesi.id_karyawan,
      dalamCakupan(data.sesi.lingkup_semua, data.sesi.unit, j.unit),
    );
    if (cek.ok) return null;
    if (data.sesi.id_karyawan === "" && !data.sesi.lingkup_semua) {
      return "Akunmu belum ditautkan ke data personil, jadi belum bisa menangani jam kosong unit mana pun.";
    }
    return cek.pesan;
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="jam-kosong-tanggal" className={LABEL}>
            Tanggal
          </label>
          <input
            id="jam-kosong-tanggal"
            type="date"
            value={tanggal}
            onChange={(e) => e.target.value && setTanggal(e.target.value)}
            className={INPUT}
          />
        </div>
        <div>
          <label htmlFor="jam-kosong-unit" className={LABEL}>
            Unit
          </label>
          <select
            id="jam-kosong-unit"
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
        <label
          htmlFor="jam-kosong-belum"
          className="flex min-h-11 items-center gap-2 text-sm text-slate-200"
        >
          <input
            id="jam-kosong-belum"
            type="checkbox"
            checked={belumSaja}
            onChange={(e) => setBelumSaja(e.target.checked)}
          />
          Belum ditangani saja
        </label>
      </div>

      {galat ? (
        <p className="text-sm text-rose-300" role="alert">
          {galat}
        </p>
      ) : null}
      {kabar ? (
        <output className="block text-sm text-emerald-300">{kabar}</output>
      ) : null}
      {data ? (
        <p className="text-sm text-slate-400">
          {data.jp.length} jam pelajaran terdampak cuti/izin, {belum} belum
          ditangani.
        </p>
      ) : galat ? null : (
        <p className="text-sm text-slate-400">Memuat jam kosong…</p>
      )}

      <ul className="space-y-2">
        {tampil.map((j) => {
          const terkunci = alasanTerkunci(j);
          return (
            <li
              key={j.id_penanganan}
              className="space-y-2 rounded-xl border border-white/10 bg-slate-900 px-4 py-3 text-sm"
            >
              <RingkasJp j={j} />
              {terkunci ? (
                <p className="text-xs text-slate-400">{terkunci}</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className={TOMBOL_KEDUA}
                    onClick={() => setDialog({ j, aksi: "Diganti" })}
                  >
                    Tunjuk pengganti
                  </button>
                  <button
                    type="button"
                    className={TOMBOL_KEDUA}
                    onClick={() => setDialog({ j, aksi: "Tugas Mandiri" })}
                  >
                    Tugas mandiri
                  </button>
                  <button
                    type="button"
                    className={TOMBOL_KEDUA}
                    onClick={() => setDialog({ j, aksi: "Digabung" })}
                  >
                    Digabung
                  </button>
                </div>
              )}
            </li>
          );
        })}
        {data && tampil.length === 0 ? (
          <li className="text-sm text-slate-400">
            Tidak ada jam kosong untuk saringan ini.
          </li>
        ) : null}
      </ul>

      {dialog && data ? (
        <DialogPenanganan
          j={dialog.j}
          aksi={dialog.aksi}
          data={data}
          onClose={() => setDialog(null)}
          onSelesai={async (pesan) => {
            setDialog(null);
            setKabar(pesan);
            await muat();
          }}
        />
      ) : null}
    </div>
  );
}

const JUDUL: Record<Aksi, string> = {
  Diganti: "Tunjuk guru pengganti",
  "Tugas Mandiri": "Tugas mandiri",
  Digabung: "Gabung dengan kelas lain",
};

function DialogPenanganan({
  j,
  aksi,
  data,
  onClose,
  onSelesai,
}: {
  j: JpTersusun;
  aksi: Aksi;
  data: DaftarJp;
  onClose: () => void;
  onSelesai: (pesan: string) => Promise<void>;
}) {
  const lama = j.penanganan?.status === aksi ? j.penanganan : null;
  const [pengganti, setPengganti] = useState(lama?.id_guru_pengganti ?? "");
  const [catatan, setCatatan] = useState(lama?.catatan ?? "");
  const [galat, setGalat] = useState<string | null>(null);
  const [menyimpan, setMenyimpan] = useState(false);
  const isSubmittingRef = useRef(false);
  const pakaiGuru = aksi !== "Tugas Mandiri";
  const guru = (data.guru ?? []).filter((g) => g.id_unik !== j.id_karyawan);
  const bentrok =
    pakaiGuru &&
    penggantiBentrok(
      pengganti,
      aksi,
      j.tanggal,
      j.jam_ke,
      j.id_penanganan,
      data.jadwal ?? [],
      data.penanganan ?? [],
    );

  const kirim = async (event: FormEvent) => {
    event.preventDefault();
    if (isSubmittingRef.current) return;
    isSubmittingRef.current = true;
    setMenyimpan(true);
    try {
      const hasil = await simpanPenanganan({
        id_pengajuan: j.id_pengajuan,
        tanggal: j.tanggal,
        id_jadwal: j.id_jadwal,
        status: aksi,
        id_guru_pengganti: pakaiGuru ? pengganti : "",
        catatan,
      });
      const teks = `Jam ${j.jam_ke} ${j.nama_rombel} tercatat: ${JUDUL[aksi].toLowerCase()}.`;
      await onSelesai(hasil.peringatan ? `${teks} ${hasil.peringatan}` : teks);
    } catch (error) {
      setGalat(pesanGalat(error, "Penanganan gagal disimpan."));
    } finally {
      isSubmittingRef.current = false;
      setMenyimpan(false);
    }
  };

  return (
    <Modal
      isOpen
      title={JUDUL[aksi]}
      subtitle={`Jam ${j.jam_ke} · ${j.nama_rombel} · ${j.tanggal}`}
      onClose={onClose}
      hideFooter
    >
      <form className="space-y-4" onSubmit={(e) => void kirim(e)}>
        {galat ? (
          <p className="text-sm text-rose-300" role="alert">
            {galat}
          </p>
        ) : null}
        {pakaiGuru ? (
          <div>
            <label htmlFor="penanganan-guru" className={LABEL}>
              {aksi === "Digabung" ? "Guru kelas gabungan" : "Guru pengganti"}
            </label>
            <PilihCari
              id="penanganan-guru"
              required
              value={pengganti}
              onChange={(e) => setPengganti(e.target.value)}
              className={INPUT}
            >
              <option value="">Pilih guru</option>
              {guru.map((g) => (
                <option key={g.id_unik} value={g.id_unik}>
                  {g.nama}
                  {g.unit ? ` · ${g.unit}` : ""}
                </option>
              ))}
            </PilihCari>
          </div>
        ) : (
          <p className="text-sm text-slate-300">
            Siswa mengerjakan tugas sendiri; jam ini tidak dibayar ke siapa pun.
          </p>
        )}
        {bentrok ? (
          <p className="text-sm text-amber-200">{PESAN_BENTROK_PENGGANTI}</p>
        ) : null}
        <div>
          <label htmlFor="penanganan-catatan" className={LABEL}>
            Catatan (opsional)
          </label>
          <textarea
            id="penanganan-catatan"
            maxLength={500}
            rows={2}
            value={catatan}
            onChange={(e) => setCatatan(e.target.value)}
            className={INPUT}
          />
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" className={TOMBOL_KEDUA} onClick={onClose}>
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
