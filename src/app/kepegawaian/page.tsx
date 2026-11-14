"use client";

import { redirect } from "next/navigation";
import {
  type FormEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { AppShell } from "@/components/AppShell";
import { AturanCutiOrganisasi } from "@/components/kepegawaian/AturanCutiOrganisasi";
import {
  DialogCetakSurat,
  mapelSemesterAktif,
  type PermintaanSurat,
  permintaanKeteranganAktif,
} from "@/components/kepegawaian/DialogCetakSurat";
import { masaKerja } from "@/components/kepegawaian/gaya";
import { JenisDokumenOrganisasi } from "@/components/kepegawaian/JenisDokumenOrganisasi";
import { JenisPengajuanOrganisasi } from "@/components/kepegawaian/JenisPengajuanOrganisasi";
import { OrganisasiTugasKontrak } from "@/components/kepegawaian/OrganisasiTugasKontrak";
import { PengaturanSurat } from "@/components/kepegawaian/PengaturanSurat";
import { RincianPegawai } from "@/components/kepegawaian/RincianPegawai";
import { TabBebanMengajar } from "@/components/kepegawaian/TabBebanMengajar";
import { TabKontrak } from "@/components/kepegawaian/TabKontrak";
import { TabLaporanPtk } from "@/components/kepegawaian/TabLaporanPtk";
import { TabSurat } from "@/components/kepegawaian/TabSurat";
import { TabTugas } from "@/components/kepegawaian/TabTugas";
import { FeedbackBanner } from "@/components/ui/FeedbackBanner";
import { Modal } from "@/components/ui/Modal";
import { PageHeader } from "@/components/ui/PageHeader";
import { PilihCari } from "@/components/ui/PilihCari";
import { formatTanggalOperasional } from "@/lib/attendance/time-policy";
import { canAccessArea, hasPermission } from "@/lib/auth/access";
import { useAuth } from "@/lib/context/AuthContext";
import {
  type BagianOrg,
  gabungBagian,
  type JabatanOrg,
  type MasterDraft,
  muatOrgKepegawaian,
  type OrgKepegawaian,
  type PegawaiKepegawaian,
  simpanBagian,
  simpanJabatan,
} from "@/lib/gateways/hris";

type Tab =
  | "daftar"
  | "struktur"
  | "kontrak"
  | "tugas"
  | "organisasi"
  | "ptk"
  | "beban"
  | "surat";

const TAB: { kunci: Tab; label: string }[] = [
  { kunci: "daftar", label: "Daftar" },
  { kunci: "struktur", label: "Struktur" },
  { kunci: "kontrak", label: "Kontrak" },
  { kunci: "tugas", label: "Tugas Tambahan" },
  { kunci: "organisasi", label: "Organisasi" },
  { kunci: "ptk", label: "Laporan PTK" },
  { kunci: "beban", label: "Beban Mengajar" },
  { kunci: "surat", label: "Surat" },
];

/** Tab yang hanya untuk pemegang `teachers.view` (area juga lolos lewat `employees.view`). */
const TAB_GURU: readonly Tab[] = ["ptk", "beban"];
/** Tab cetak SK dan surat (HRIS Fase 3b, §21.4). */
const TAB_SURAT: readonly Tab[] = ["surat"];

const INPUT =
  "min-h-10 w-full rounded-xl border border-white/10 bg-slate-950 px-3 text-sm text-white outline-none focus:border-sky-500";
const TOMBOL =
  "min-h-10 rounded-xl border border-white/10 px-3 text-sm font-semibold text-slate-200 hover:bg-slate-800 disabled:opacity-50";
const TOMBOL_UTAMA =
  "min-h-10 rounded-xl bg-sky-500 px-4 text-sm font-semibold text-slate-950 hover:bg-sky-400 disabled:opacity-50";

function pesanGalat(error: unknown) {
  return error instanceof Error ? error.message : "Permintaan gagal.";
}

export default function KepegawaianPage() {
  const { user, isAuthenticated, isLoading } = useAuth();
  const [tab, setTab] = useState<Tab>("daftar");
  const [org, setOrg] = useState<OrgKepegawaian | null>(null);
  const [galat, setGalat] = useState<string | null>(null);
  const [pesan, setPesan] = useState<string | null>(null);

  if (!isLoading && isAuthenticated && !canAccessArea(user, "kepegawaian")) {
    redirect("/forbidden");
  }

  const muat = useCallback(async () => {
    try {
      setOrg(await muatOrgKepegawaian());
      setGalat(null);
    } catch (error) {
      setGalat(pesanGalat(error));
    }
  }, []);

  useEffect(() => {
    if (isAuthenticated) void muat();
  }, [isAuthenticated, muat]);

  const bolehUbah = hasPermission(user, "hr.org.manage");

  return (
    <AppShell contentClassName="mx-auto w-full max-w-6xl space-y-6 px-4 py-6 sm:px-6 md:py-8 lg:px-8">
      <PageHeader
        eyebrow="Personil"
        title="Kepegawaian"
        description="Guru dan tenaga kependidikan menurut unit, bagian, jabatan, dan atasan langsung."
      />
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
      <div
        role="tablist"
        aria-label="Bagian halaman Kepegawaian"
        className="flex flex-wrap gap-2 rounded-2xl border border-white/10 bg-slate-900 p-1"
      >
        {TAB.filter(
          ({ kunci }) =>
            (!TAB_GURU.includes(kunci) ||
              hasPermission(user, "teachers.view")) &&
            (!TAB_SURAT.includes(kunci) ||
              hasPermission(user, "hr.duty.manage")),
        ).map(({ kunci, label }) => (
          <button
            key={kunci}
            id={`tab-kepegawaian-${kunci}`}
            role="tab"
            type="button"
            aria-selected={tab === kunci}
            aria-controls="panel-kepegawaian"
            onClick={() => setTab(kunci)}
            className={`min-h-10 rounded-xl px-4 text-sm font-semibold ${
              tab === kunci
                ? "bg-sky-500 text-slate-950"
                : "text-slate-300 hover:bg-slate-800"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      <div
        id="panel-kepegawaian"
        role="tabpanel"
        aria-labelledby={`tab-kepegawaian-${tab}`}
      >
        {!org ? (
          <p className="text-sm text-slate-400">Memuat data kepegawaian…</p>
        ) : tab === "daftar" ? (
          <TabDaftar org={org} onGalat={setGalat} />
        ) : tab === "struktur" ? (
          <TabStruktur org={org} />
        ) : tab === "kontrak" ? (
          <TabKontrak
            org={org}
            bolehUbah={hasPermission(user, "hr.contract.manage")}
            bolehCetak={hasPermission(user, "hr.duty.manage")}
            onPesan={setPesan}
            onGalat={setGalat}
          />
        ) : tab === "tugas" ? (
          <TabTugas
            org={org}
            bolehUbah={hasPermission(user, "hr.duty.manage")}
            onPesan={setPesan}
            onGalat={setGalat}
          />
        ) : tab === "ptk" ? (
          <TabLaporanPtk onPesan={setPesan} onGalat={setGalat} />
        ) : tab === "beban" ? (
          <TabBebanMengajar onPesan={setPesan} onGalat={setGalat} />
        ) : tab === "surat" ? (
          <TabSurat org={org} onGalat={setGalat} />
        ) : (
          <TabOrganisasi
            org={org}
            bolehUbah={bolehUbah}
            jenisDokumen={bolehUbah || hasPermission(user, "hr.document.view")}
            aturanCuti={bolehUbah || hasPermission(user, "hr.request.view")}
            pengaturanSurat={hasPermission(user, "hr.duty.manage")}
            onPesan={setPesan}
            onBerhasil={async (teks) => {
              setPesan(teks);
              await muat();
            }}
            onGalat={setGalat}
          />
        )}
      </div>
    </AppShell>
  );
}

function TabDaftar({
  org,
  onGalat,
}: {
  org: OrgKepegawaian;
  onGalat: (pesan: string) => void;
}) {
  const { user } = useAuth();
  const [cetak, setCetak] = useState<PermintaanSurat | null>(null);
  const [cari, setCari] = useState("");
  const [unit, setUnit] = useState("");
  const [bagian, setBagian] = useState("");
  const [jabatan, setJabatan] = useState("");
  const [kelompok, setKelompok] = useState("");
  const [rincian, setRincian] = useState<PegawaiKepegawaian | null>(null);
  const hariIni = formatTanggalOperasional(Date.now());
  const namaAtasan = new Map(org.pegawai.map((p) => [p.id_unik, p.nama]));
  const daftarUnit = [
    ...new Set(org.pegawai.map((p) => p.unit).filter(Boolean)),
  ].sort();
  const kata = cari.trim().toLowerCase();
  const terlihat = org.pegawai.filter(
    (p) =>
      (!kata ||
        p.nama.toLowerCase().includes(kata) ||
        p.kode_karyawan.toLowerCase().includes(kata)) &&
      (!unit || p.unit === unit) &&
      (!bagian || (bagian === "-" ? !p.id_bagian : p.id_bagian === bagian)) &&
      (!jabatan || p.id_jabatan === jabatan) &&
      (!kelompok || p.kelompok === kelompok),
  );

  return (
    <div className="space-y-4">
      <form
        data-tanpa-konfirmasi
        onSubmit={(e) => e.preventDefault()}
        className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5"
      >
        <input
          aria-label="Cari nama atau kode"
          placeholder="Cari nama atau kode"
          value={cari}
          onChange={(e) => setCari(e.target.value)}
          className={INPUT}
        />
        <PilihCari
          aria-label="Saring unit"
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
        </PilihCari>
        <PilihCari
          aria-label="Saring bagian"
          value={bagian}
          onChange={(e) => setBagian(e.target.value)}
          className={INPUT}
        >
          <option value="">Semua bagian</option>
          <option value="-">Tanpa bagian</option>
          {org.bagian.map((b) => (
            <option key={b.id_bagian} value={b.id_bagian}>
              {b.nama}
            </option>
          ))}
        </PilihCari>
        <PilihCari
          aria-label="Saring jabatan"
          value={jabatan}
          onChange={(e) => setJabatan(e.target.value)}
          className={INPUT}
        >
          <option value="">Semua jabatan</option>
          {org.jabatan.map((j) => (
            <option key={j.id_jabatan} value={j.id_jabatan}>
              {j.nama}
            </option>
          ))}
        </PilihCari>
        <select
          aria-label="Saring guru atau tendik"
          value={kelompok}
          onChange={(e) => setKelompok(e.target.value)}
          className={INPUT}
        >
          <option value="">Guru dan tendik</option>
          <option value="Guru">Guru</option>
          <option value="Tendik">Tendik</option>
        </select>
      </form>
      <p className="text-sm text-slate-400">
        {terlihat.length} dari {org.pegawai.length} pegawai
      </p>
      <div className="overflow-x-auto rounded-2xl border border-white/10">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="bg-slate-900 text-xs uppercase text-slate-400">
            <tr>
              <th className="px-3 py-2">Nama</th>
              <th className="px-3 py-2">Unit</th>
              <th className="px-3 py-2">Bagian</th>
              <th className="px-3 py-2">Jabatan</th>
              <th className="px-3 py-2">Atasan</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">TMT</th>
              <th className="px-3 py-2">Masa kerja</th>
              <th className="px-3 py-2">
                <span className="sr-only">Aksi</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {terlihat.map((p) => (
              <tr key={p.id_unik} className="text-slate-200">
                <td className="px-3 py-2">
                  <span className="font-semibold text-white">{p.nama}</span>
                  <span className="block text-xs text-slate-400">
                    {p.kelompok}
                    {p.kode_karyawan ? ` · ${p.kode_karyawan}` : ""}
                    {p.status_aktif !== "Aktif" ? " · Nonaktif" : ""}
                  </span>
                </td>
                <td className="px-3 py-2">{p.unit || "-"}</td>
                <td className="px-3 py-2">
                  {p.divisi || "-"}
                  {!p.id_bagian && p.divisi ? (
                    <span className="block text-xs text-amber-200">
                      Belum terhubung ke master
                    </span>
                  ) : null}
                </td>
                <td className="px-3 py-2">{p.jabatan_status || "-"}</td>
                <td className="px-3 py-2">
                  {namaAtasan.get(p.id_atasan) ?? "-"}
                </td>
                <td className="px-3 py-2">{p.status_kepegawaian || "-"}</td>
                <td className="px-3 py-2">{p.tmt || "-"}</td>
                <td className="px-3 py-2">{masaKerja(p.tmt, hariIni)}</td>
                <td className="px-3 py-2">
                  <button
                    type="button"
                    className={TOMBOL}
                    aria-label={`Rincian ${p.nama}`}
                    onClick={() => setRincian(p)}
                  >
                    Rincian
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rincian ? (
        <RincianPegawai
          pegawai={rincian}
          org={org}
          hariIni={hariIni}
          onClose={() => setRincian(null)}
          onCetakKeterangan={
            hasPermission(user, "hr.duty.manage")
              ? async () => {
                  const p = rincian;
                  setRincian(null);
                  try {
                    const mapel =
                      p.kelompok === "Guru" &&
                      hasPermission(user, "teachers.view")
                        ? await mapelSemesterAktif(p.id_unik)
                        : [];
                    setCetak(
                      permintaanKeteranganAktif(p.id_unik, p.nama, mapel),
                    );
                  } catch (error) {
                    onGalat(pesanGalat(error));
                  }
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

function TabStruktur({ org }: { org: OrgKepegawaian }) {
  const aktif = org.pegawai.filter((p) => p.status_aktif === "Aktif");
  const ada = new Set(aktif.map((p) => p.id_unik));
  const siklus = new Set(org.atasan_siklus);
  const bawahan = new Map<string, PegawaiKepegawaian[]>();
  for (const p of aktif) {
    if (!p.id_atasan || !ada.has(p.id_atasan) || siklus.has(p.id_unik))
      continue;
    bawahan.set(p.id_atasan, [...(bawahan.get(p.id_atasan) ?? []), p]);
  }
  const puncak = aktif.filter(
    (p) => !p.id_atasan || !ada.has(p.id_atasan) || siklus.has(p.id_unik),
  );

  const simpul = (p: PegawaiKepegawaian, dilalui: Set<string>) => {
    const anak = dilalui.has(p.id_unik) ? [] : (bawahan.get(p.id_unik) ?? []);
    const lanjut = new Set(dilalui).add(p.id_unik);
    return (
      <li key={p.id_unik} className="space-y-1">
        <div className="rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-sm">
          <span className="font-semibold text-white">{p.nama}</span>
          <span className="text-slate-400">
            {" "}
            · {p.jabatan_status || "-"} · {p.divisi || "-"}
            {p.unit ? ` · ${p.unit}` : ""}
          </span>
          {siklus.has(p.id_unik) ? (
            <span className="block text-xs text-amber-200">
              Rantai atasannya berputar; perbaiki atasan di form pegawai.
            </span>
          ) : null}
        </div>
        {anak.length > 0 ? (
          <ul className="ml-4 space-y-1 border-l border-white/10 pl-3">
            {anak.map((a) => simpul(a, lanjut))}
          </ul>
        ) : null}
      </li>
    );
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
      <section aria-labelledby="judul-bagan" className="space-y-3">
        <h2 id="judul-bagan" className="text-base font-semibold text-white">
          Menurut atasan langsung
        </h2>
        <ul className="space-y-2">{puncak.map((p) => simpul(p, new Set()))}</ul>
      </section>
      <section aria-labelledby="judul-per-bagian" className="space-y-3">
        <h2
          id="judul-per-bagian"
          className="text-base font-semibold text-white"
        >
          Per bagian
        </h2>
        <ul className="space-y-2 text-sm">
          {org.bagian
            .filter((b) => b.is_aktif === 1)
            .map((b) => (
              <li
                key={b.id_bagian}
                className="flex justify-between rounded-xl border border-white/10 bg-slate-900 px-3 py-2"
              >
                <span className="text-slate-200">{b.nama}</span>
                <span className="text-slate-400">{b.anggota} orang</span>
              </li>
            ))}
        </ul>
      </section>
    </div>
  );
}

type Sunting =
  | { jenis: "bagian"; data: BagianOrg | null; nama?: string }
  | { jenis: "jabatan"; data: JabatanOrg | null }
  | { jenis: "gabung"; data: BagianOrg };

function TabOrganisasi({
  org,
  bolehUbah,
  jenisDokumen,
  aturanCuti,
  pengaturanSurat,
  onPesan,
  onBerhasil,
  onGalat,
}: {
  org: OrgKepegawaian;
  bolehUbah: boolean;
  jenisDokumen: boolean;
  aturanCuti: boolean;
  pengaturanSurat: boolean;
  onPesan: (pesan: string) => void;
  onBerhasil: (pesan: string) => Promise<void>;
  onGalat: (pesan: string) => void;
}) {
  const [sunting, setSunting] = useState<Sunting | null>(null);
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

  const ubahAktif = (
    b: { nama: string; is_aktif: number },
    simpan: (draft: MasterDraft) => Promise<unknown>,
    id: string,
  ) =>
    jalankan(
      () => simpan({ id, nama: b.nama, is_aktif: b.is_aktif === 1 ? 0 : 1 }),
      b.is_aktif === 1
        ? `"${b.nama}" dinonaktifkan.`
        : `"${b.nama}" diaktifkan.`,
    );

  return (
    <div className="space-y-8">
      {!bolehUbah ? (
        <p className="text-sm text-slate-400">
          Mengubah organisasi butuh izin Kelola Organisasi Kepegawaian.
        </p>
      ) : null}

      <section aria-labelledby="judul-bagian" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="judul-bagian" className="text-base font-semibold text-white">
            Bagian
          </h2>
          {bolehUbah ? (
            <button
              type="button"
              className={TOMBOL_UTAMA}
              onClick={() => setSunting({ jenis: "bagian", data: null })}
            >
              Tambah bagian
            </button>
          ) : null}
        </div>
        <ul className="space-y-2">
          {org.bagian.map((b) => (
            <li
              key={b.id_bagian}
              className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-sm"
            >
              <div>
                <span className="font-semibold text-white">{b.nama}</span>
                <span className="text-slate-400">
                  {" "}
                  · {b.anggota} orang
                  {b.is_aktif === 1 ? "" : " · nonaktif"}
                </span>
                {b.nama_lama.length > 0 ? (
                  <span className="block text-xs text-slate-400">
                    Nama lama: {b.nama_lama.join(", ")}
                  </span>
                ) : null}
                {b.nama_ganda ? (
                  <span className="block text-xs text-amber-200">
                    Ada bagian aktif lain bernama sama; gabungkan salah satunya.
                  </span>
                ) : null}
              </div>
              {bolehUbah ? (
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className={TOMBOL}
                    onClick={() => setSunting({ jenis: "bagian", data: b })}
                  >
                    Ganti nama
                  </button>
                  {b.is_aktif === 1 ? (
                    <button
                      type="button"
                      className={TOMBOL}
                      onClick={() => setSunting({ jenis: "gabung", data: b })}
                    >
                      Gabungkan
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className={TOMBOL}
                    disabled={menyimpan}
                    onClick={() => ubahAktif(b, simpanBagian, b.id_bagian)}
                  >
                    {b.is_aktif === 1 ? "Nonaktifkan" : "Aktifkan"}
                  </button>
                </div>
              ) : null}
            </li>
          ))}
          {org.bagian.length === 0 ? (
            <li className="text-sm text-slate-400">Belum ada bagian.</li>
          ) : null}
        </ul>
      </section>

      {org.tanpa_master.length > 0 ? (
        <section aria-labelledby="judul-tanpa-master" className="space-y-3">
          <h2
            id="judul-tanpa-master"
            className="text-base font-semibold text-white"
          >
            Teks divisi tanpa master
          </h2>
          <p className="text-sm text-slate-400">
            Pegawai ini masih memakai teks divisi yang tidak cocok dengan bagian
            mana pun.
          </p>
          <ul className="space-y-2">
            {org.tanpa_master.map((t) => (
              <li
                key={t.divisi}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-300/25 bg-amber-300/10 px-3 py-2 text-sm text-amber-100"
              >
                <span>
                  {t.divisi} · {t.jumlah} orang
                </span>
                {bolehUbah ? (
                  <button
                    type="button"
                    className={TOMBOL}
                    disabled={menyimpan}
                    onClick={() =>
                      jalankan(
                        () => simpanBagian({ nama: t.divisi }),
                        `Bagian "${t.divisi}" dibuat dan ${t.jumlah} pegawai dihubungkan.`,
                      )
                    }
                  >
                    Jadikan bagian
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="judul-jabatan" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="judul-jabatan" className="text-base font-semibold text-white">
            Jabatan
          </h2>
          {bolehUbah ? (
            <button
              type="button"
              className={TOMBOL_UTAMA}
              onClick={() => setSunting({ jenis: "jabatan", data: null })}
            >
              Tambah jabatan
            </button>
          ) : null}
        </div>
        <ul className="space-y-2">
          {org.jabatan.map((j) => (
            <li
              key={j.id_jabatan}
              className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-sm"
            >
              <div>
                <span className="font-semibold text-white">{j.nama}</span>
                <span className="text-slate-400">
                  {" "}
                  · {j.anggota} orang
                  {j.is_aktif === 1 ? "" : " · nonaktif"}
                </span>
                {j.nama_ganda ? (
                  <span className="block text-xs text-amber-200">
                    Ada jabatan aktif lain bernama sama.
                  </span>
                ) : null}
              </div>
              {bolehUbah ? (
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className={TOMBOL}
                    onClick={() => setSunting({ jenis: "jabatan", data: j })}
                  >
                    Ganti nama
                  </button>
                  <button
                    type="button"
                    className={TOMBOL}
                    disabled={menyimpan}
                    onClick={() => ubahAktif(j, simpanJabatan, j.id_jabatan)}
                  >
                    {j.is_aktif === 1 ? "Nonaktifkan" : "Aktifkan"}
                  </button>
                </div>
              ) : null}
            </li>
          ))}
          {org.jabatan.length === 0 ? (
            <li className="text-sm text-slate-400">Belum ada jabatan.</li>
          ) : null}
        </ul>
      </section>

      <OrganisasiTugasKontrak
        org={org}
        bolehUbah={bolehUbah}
        onBerhasil={onBerhasil}
        onGalat={onGalat}
      />

      <JenisPengajuanOrganisasi
        org={org}
        bolehUbah={bolehUbah}
        onBerhasil={onBerhasil}
        onGalat={onGalat}
      />

      {aturanCuti ? (
        <AturanCutiOrganisasi
          bolehUbah={bolehUbah}
          onBerhasil={onBerhasil}
          onGalat={onGalat}
        />
      ) : null}

      {jenisDokumen ? (
        <JenisDokumenOrganisasi bolehUbah={bolehUbah} onPesan={onPesan} />
      ) : null}

      {pengaturanSurat ? (
        <PengaturanSurat
          bolehUbah={bolehUbah}
          onPesan={onPesan}
          onGalat={onGalat}
        />
      ) : null}

      {sunting?.jenis === "bagian" || sunting?.jenis === "jabatan" ? (
        <ModalNama
          sunting={sunting}
          menyimpan={menyimpan}
          onClose={() => setSunting(null)}
          onSimpan={(nama) =>
            sunting.jenis === "bagian"
              ? jalankan(
                  () =>
                    simpanBagian({
                      id: sunting.data?.id_bagian,
                      nama,
                      is_aktif: sunting.data?.is_aktif === 0 ? 0 : 1,
                    }),
                  `Bagian "${nama}" disimpan.`,
                )
              : jalankan(
                  () =>
                    simpanJabatan({
                      id: sunting.data?.id_jabatan,
                      nama,
                      is_aktif: sunting.data?.is_aktif === 0 ? 0 : 1,
                    }),
                  `Jabatan "${nama}" disimpan.`,
                )
          }
        />
      ) : null}
      {sunting?.jenis === "gabung" ? (
        <ModalGabung
          asal={sunting.data}
          bagian={org.bagian}
          menyimpan={menyimpan}
          onClose={() => setSunting(null)}
          onGabung={(tujuan) =>
            jalankan(
              () => gabungBagian(sunting.data.id_bagian, tujuan),
              `"${sunting.data.nama}" digabungkan.`,
            )
          }
        />
      ) : null}
    </div>
  );
}

function ModalNama({
  sunting,
  menyimpan,
  onClose,
  onSimpan,
}: {
  sunting:
    | { jenis: "bagian"; data: BagianOrg | null }
    | { jenis: "jabatan"; data: JabatanOrg | null };
  menyimpan: boolean;
  onClose: () => void;
  onSimpan: (nama: string) => void;
}) {
  const [nama, setNama] = useState(sunting.data?.nama ?? "");
  const label = sunting.jenis === "bagian" ? "bagian" : "jabatan";
  const gantiNama = Boolean(sunting.data);
  const kirim = (event: FormEvent) => {
    event.preventDefault();
    onSimpan(nama);
  };
  return (
    <Modal
      title={gantiNama ? `Ganti nama ${label}` : `Tambah ${label}`}
      onClose={onClose}
      hideFooter
    >
      <form className="space-y-4" onSubmit={kirim}>
        <div>
          <label
            htmlFor="nama-master"
            className="mb-1 block text-sm font-semibold text-slate-300"
          >
            Nama {label}
          </label>
          <input
            id="nama-master"
            required
            minLength={2}
            maxLength={60}
            value={nama}
            onChange={(e) => setNama(e.target.value)}
            className={INPUT}
          />
        </div>
        {gantiNama && sunting.data && "anggota" in sunting.data ? (
          <p className="rounded-xl border border-amber-300/25 bg-amber-300/10 px-3 py-2 text-sm text-amber-100">
            {sunting.jenis === "bagian"
              ? `Nama baru ditulis ke ${sunting.data.anggota} pegawai beserta riwayat absensi, log scan, koreksi, backup, kartu ID, tunjangan per divisi, dan whitelist libur mereka. Nama lama tetap dikenali saat impor.`
              : `Nama baru ditulis ke ${sunting.data.anggota} pegawai dan kartu ID mereka.`}
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

function ModalGabung({
  asal,
  bagian,
  menyimpan,
  onClose,
  onGabung,
}: {
  asal: BagianOrg;
  bagian: BagianOrg[];
  menyimpan: boolean;
  onClose: () => void;
  onGabung: (idTujuan: string) => void;
}) {
  const [tujuan, setTujuan] = useState("");
  const pilihan = bagian.filter(
    (b) => b.is_aktif === 1 && b.id_bagian !== asal.id_bagian,
  );
  const kirim = (event: FormEvent) => {
    event.preventDefault();
    if (tujuan) onGabung(tujuan);
  };
  return (
    <Modal title={`Gabungkan "${asal.nama}"`} onClose={onClose} hideFooter>
      <form className="space-y-4" onSubmit={kirim}>
        <div>
          <label
            htmlFor="bagian-tujuan"
            className="mb-1 block text-sm font-semibold text-slate-300"
          >
            Pindahkan ke bagian
          </label>
          <PilihCari
            id="bagian-tujuan"
            required
            value={tujuan}
            onChange={(e) => setTujuan(e.target.value)}
            className={INPUT}
          >
            <option value="">Pilih bagian tujuan</option>
            {pilihan.map((b) => (
              <option key={b.id_bagian} value={b.id_bagian}>
                {b.nama}
              </option>
            ))}
          </PilihCari>
        </div>
        <p className="rounded-xl border border-amber-300/25 bg-amber-300/10 px-3 py-2 text-sm text-amber-100">
          {asal.anggota} pegawai pindah ke bagian tujuan, riwayat mereka ikut
          memakai nama bagian tujuan, dan "{asal.nama}" dinonaktifkan. Namanya
          tetap dikenali sebagai nama lama bagian tujuan.
        </p>
        <div className="flex justify-end gap-2">
          <button type="button" className={TOMBOL} onClick={onClose}>
            Batal
          </button>
          <button
            type="submit"
            className={TOMBOL_UTAMA}
            disabled={menyimpan || !tujuan}
          >
            Gabungkan
          </button>
        </div>
      </form>
    </Modal>
  );
}
