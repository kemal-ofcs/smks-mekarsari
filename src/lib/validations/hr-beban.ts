// HRIS Fase 3a (`prd-hris.md` §21.2.1): rekap beban mengajar per semester.
//
// SQL di berkas ini disalin harfiah dari `desktop/hr_beban.rs` (diperiksa
// `hr-beban.test.ts`). Rekap disusun SEKALI di sini (`susunBebanMengajar`,
// Q-65) dari data mentah command `desktop_hr_teaching_load` / rute
// `/api/kepegawaian/teaching-load/query`; tidak ada kembaran Rust.

import { z } from "zod";
import { rentangJamKe } from "./class-attendance";

/** Body rute; `""` = semester aktif. */
export const bebanQuerySchema = z
  .object({ id_tahun_ajaran: z.string().trim().max(80) })
  .strict();

export const SEMESTER_SQL =
  "SELECT id_tahun_ajaran, nama_tahun, semester, tanggal_mulai, tanggal_selesai, is_aktif FROM akademik_tahun_ajaran ORDER BY tanggal_mulai DESC, id_tahun_ajaran\n-- batas: dua semester per tahun ajaran sekolah\n;";

export const BEBAN_GURU_SQL =
  "SELECT m.id_unik, m.nama, COALESCE(g.gelar, '') AS gelar, COALESCE(g.nip, '') AS nip, COALESCE(g.nuptk, '') AS nuptk, COALESCE(m.unit, '') AS unit, CASE WHEN COALESCE(m.status_aktif, 'Aktif') = 'Aktif' THEN 1 ELSE 0 END AS aktif FROM master_data m LEFT JOIN guru_data g ON g.id_guru = m.id_unik WHERE (g.id_guru IS NOT NULL AND COALESCE(m.status_aktif, 'Aktif') = 'Aktif') OR EXISTS (SELECT 1 FROM jadwal_mengajar j WHERE j.id_guru = m.id_unik AND j.is_aktif = 1 AND j.id_tahun_ajaran = ?1) ORDER BY m.nama, m.id_unik\n-- batas: guru sekolah, dibatasi jumlah personil lembaga\n;";

export const BEBAN_JADWAL_SQL =
  "SELECT j.id_jadwal, j.id_guru, j.hari, j.jam_ke, j.id_rombel, COALESCE(r.nama_rombel, j.id_rombel) AS nama_rombel, j.id_mapel, COALESCE(mp.nama_mapel, j.id_mapel) AS nama_mapel, COALESCE(u.nama_unit, '') AS unit FROM jadwal_mengajar j LEFT JOIN akademik_rombel r ON r.id_rombel = j.id_rombel LEFT JOIN akademik_mapel mp ON mp.id_mapel = j.id_mapel LEFT JOIN akademik_unit u ON u.id_unit = r.id_unit WHERE j.is_aktif = 1 AND j.id_tahun_ajaran = ?1 ORDER BY j.id_guru, j.hari, CAST(j.jam_ke AS INTEGER), j.jam_ke, j.id_jadwal\n-- batas: jadwal mingguan satu semester, sebesar rombel kali jam pelajaran\n;";

export const BEBAN_TUGAS_SQL =
  "SELECT t.id_tugas, t.id_karyawan, t.id_jenis, COALESCE(j.nama, t.id_jenis) AS nama_jenis, COALESCE(t.ekuivalen_jp, j.ekuivalen_jp, 0) AS ekuivalen_jp, COALESCE(t.unit, '') AS unit, '' AS nama_rombel, COALESCE(t.nomor_sk, '') AS nomor_sk, COALESCE(t.tanggal_sk, '') AS tanggal_sk FROM hr_tugas_tambahan t LEFT JOIN hr_tugas_jenis j ON j.id_jenis = t.id_jenis WHERE t.dibatalkan_pada IS NULL AND t.id_jenis <> 'tgs-wali-kelas' AND t.tanggal_mulai <= ?2 AND (COALESCE(t.tanggal_selesai, '') = '' OR t.tanggal_selesai >= ?1) UNION ALL SELECT 'wali:' || r.id_rombel, r.id_wali_kelas, 'tgs-wali-kelas', COALESCE(j.nama, 'Wali Kelas'), COALESCE((SELECT w.ekuivalen_jp FROM hr_tugas_tambahan w WHERE w.id_jenis = 'tgs-wali-kelas' AND w.id_rombel = r.id_rombel AND w.id_karyawan = r.id_wali_kelas AND w.dibatalkan_pada IS NULL AND w.ekuivalen_jp IS NOT NULL ORDER BY w.tanggal_mulai DESC, w.id_tugas DESC LIMIT 1), j.ekuivalen_jp, 0), COALESCE(u.nama_unit, ''), r.nama_rombel, '', '' FROM akademik_rombel r JOIN akademik_tahun_ajaran ta ON ta.id_tahun_ajaran = r.id_tahun_ajaran LEFT JOIN hr_tugas_jenis j ON j.id_jenis = 'tgs-wali-kelas' LEFT JOIN akademik_unit u ON u.id_unit = r.id_unit WHERE r.is_aktif = 1 AND COALESCE(r.id_wali_kelas, '') <> '' AND ta.tanggal_mulai <= ?2 AND ta.tanggal_selesai >= ?1 ORDER BY 2, 3, 1\n-- batas: tugas tambahan pegawai sekolah pada satu semester\n;";

export const BEBAN_PENUGASAN_SQL =
  "SELECT p.id_guru, p.id_rombel, COALESCE(r.nama_rombel, p.id_rombel) AS nama_rombel, p.id_mapel, COALESCE(mp.nama_mapel, p.id_mapel) AS nama_mapel, COALESCE(mp.beban_jam, 0) AS beban_jam FROM akademik_guru_mapel p LEFT JOIN akademik_rombel r ON r.id_rombel = p.id_rombel LEFT JOIN akademik_mapel mp ON mp.id_mapel = p.id_mapel WHERE p.id_tahun_ajaran = ?1 ORDER BY p.id_guru, p.id_rombel, p.id_mapel, p.id_penugasan\n-- batas: penugasan satu semester, sebesar rombel kali mapel\n;";

// Bentuk kembalian command/rute (kolom SQL di atas)

export interface SemesterBeban {
  id_tahun_ajaran: string;
  nama_tahun: string;
  semester: string;
  tanggal_mulai: string;
  tanggal_selesai: string;
  is_aktif: number;
}

export interface GuruBeban {
  id_unik: string;
  nama: string;
  gelar: string;
  nip: string;
  nuptk: string;
  unit: string;
  aktif: number;
}

export interface JadwalBeban {
  id_jadwal: string;
  id_guru: string;
  hari: number;
  jam_ke: string;
  id_rombel: string;
  nama_rombel: string;
  id_mapel: string;
  nama_mapel: string;
  unit: string;
}

export interface TugasBeban {
  id_tugas: string;
  id_karyawan: string;
  id_jenis: string;
  nama_jenis: string;
  ekuivalen_jp: number;
  unit: string;
  nama_rombel: string;
  nomor_sk: string;
  tanggal_sk: string;
}

export interface PenugasanBeban {
  id_guru: string;
  id_rombel: string;
  nama_rombel: string;
  id_mapel: string;
  nama_mapel: string;
  beban_jam: number;
}

export interface BatasBeban {
  min: number;
  maks: number;
}

export interface DataBeban {
  semester: SemesterBeban[];
  /** Semester yang dipakai; `""` bila belum ada semester sama sekali. */
  id_tahun_ajaran: string;
  guru: GuruBeban[];
  jadwal: JadwalBeban[];
  tugas: TugasBeban[];
  penugasan: PenugasanBeban[];
  /** `STATUS_KINI_SQL` pada akhir semester. */
  status: { id_unik: string; status: string }[];
  batas: BatasBeban;
  hari_ini: string;
}

// Rekap (tampilan dan Excel; tidak disimpan)

export const TANDA_BEBAN = [
  "kurang_dari_batas",
  "lebih_dari_batas",
  "tanpa_jadwal",
  "jam_tidak_terbaca",
  "gabungan_lintas_unit",
  "beda_penugasan",
  "nonaktif",
  "mapel_di_luar_sertifikat",
] as const;
export type TandaBeban = (typeof TANDA_BEBAN)[number];

export interface RincianMapel {
  id_rombel: string;
  nama_rombel: string;
  id_mapel: string;
  nama_mapel: string;
  unit: string;
  /** JP baris jadwal rombel × mapel ini, sebelum peleburan jam gabungan. */
  jp: number;
  /** `beban_jam` penugasan, `null` bila tidak ada penugasan. */
  jp_penugasan: number | null;
}

export interface RekapBeban {
  id_unik: string;
  nama: string;
  gelar: string;
  nip: string;
  nuptk: string;
  unit: string;
  status: string;
  aktif: boolean;
  /** Pasangan (hari, jam) unik, kunci yang sama dengan honor JP. */
  jp_tatap_muka: number;
  jp_tugas: number;
  total: number;
  mapel: RincianMapel[];
  /** JP tatap muka per unit rombel (dilebur di dalam unit itu). */
  per_unit: { unit: string; jp: number }[];
  tugas: TugasBeban[];
  /** Isi `jam_ke` yang tidak terbaca; barisnya tidak dihitung. */
  jam_rusak: string[];
  tanda: TandaBeban[];
}

const kunciTeks = (teks: string) => teks.trim().toLowerCase();

/**
 * Huruf kecil, tanda baca menjadi spasi, spasi ganda dirapatkan. Dipakai
 * `cocokBidang` dan pencocokan unit.
 */
function normalBidang(teks: string): string {
  return teks
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/**
 * Petunjuk linier (Q-64): mapel "cocok" bila namanya memuat bidang sertifikat
 * atau sebaliknya. Bidang kosong = tidak bersertifikat, selalu cocok.
 */
export function cocokBidang(mapel: string, bidang: string): boolean {
  const b = normalBidang(bidang);
  if (b === "") return true;
  const m = normalBidang(mapel);
  return m !== "" && (m.includes(b) || b.includes(m));
}

function bandingTeks(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Rekap per guru, urut seperti `BEBAN_GURU_SQL`. `sertifikat` (id pegawai →
 * bidang sertifikat) hanya ada saat daring; `null` = tanda linier tidak
 * dinilai.
 */
export function susunBebanMengajar(
  data: DataBeban,
  sertifikat: ReadonlyMap<string, string> | null,
): RekapBeban[] {
  const status = new Map(data.status.map((s) => [s.id_unik, s.status]));
  const jadwalPer = new Map<string, JadwalBeban[]>();
  for (const j of data.jadwal) {
    jadwalPer.set(j.id_guru, [...(jadwalPer.get(j.id_guru) ?? []), j]);
  }
  const tugasPer = new Map<string, TugasBeban[]>();
  for (const t of data.tugas) {
    tugasPer.set(t.id_karyawan, [...(tugasPer.get(t.id_karyawan) ?? []), t]);
  }
  const penugasanPer = new Map<string, Map<string, number>>();
  for (const p of data.penugasan) {
    const per = penugasanPer.get(p.id_guru) ?? new Map<string, number>();
    const kunci = `${p.id_rombel}\u0000${p.id_mapel}`;
    per.set(kunci, (per.get(kunci) ?? 0) + p.beban_jam);
    penugasanPer.set(p.id_guru, per);
  }

  return data.guru.map((g) => {
    const jadwal = jadwalPer.get(g.id_unik) ?? [];
    const penugasan = penugasanPer.get(g.id_unik) ?? new Map<string, number>();
    const jam = new Map<string, Set<string>>();
    const jamUnit = new Map<string, Set<string>>();
    const mapel = new Map<string, RincianMapel>();
    const jamRusak: string[] = [];
    const namaUnit = new Map<string, string>();

    for (const j of jadwal) {
      const rentang = rentangJamKe(j.jam_ke);
      if (rentang === null) {
        jamRusak.push(j.jam_ke);
        continue;
      }
      const unit = kunciTeks(j.unit);
      if (unit !== "" && !namaUnit.has(unit)) namaUnit.set(unit, j.unit.trim());
      for (let k = rentang.awal; k <= rentang.akhir; k++) {
        const kunci = `${j.hari} ${k}`;
        jam.set(kunci, (jam.get(kunci) ?? new Set()).add(unit));
        jamUnit.set(unit, (jamUnit.get(unit) ?? new Set()).add(kunci));
      }
      const kunciMapel = `${j.id_rombel}\u0000${j.id_mapel}`;
      const r = mapel.get(kunciMapel) ?? {
        id_rombel: j.id_rombel,
        nama_rombel: j.nama_rombel,
        id_mapel: j.id_mapel,
        nama_mapel: j.nama_mapel,
        unit: j.unit,
        jp: 0,
        jp_penugasan: penugasan.get(kunciMapel) ?? null,
      };
      r.jp += rentang.akhir - rentang.awal + 1;
      mapel.set(kunciMapel, r);
    }

    const tugas = tugasPer.get(g.id_unik) ?? [];
    const jpTatapMuka = jam.size;
    const jpTugas = tugas.reduce((n, t) => n + t.ekuivalen_jp, 0);
    const total = jpTatapMuka + jpTugas;
    const rincian = [...mapel.values()].sort(
      (a, b) =>
        bandingTeks(a.nama_mapel, b.nama_mapel) ||
        bandingTeks(a.nama_rombel, b.nama_rombel) ||
        bandingTeks(a.id_rombel, b.id_rombel),
    );
    const bidang = sertifikat?.get(g.id_unik) ?? "";

    const tanda: TandaBeban[] = [];
    if (total < data.batas.min) tanda.push("kurang_dari_batas");
    if (total > data.batas.maks) tanda.push("lebih_dari_batas");
    if (jadwal.length === 0) tanda.push("tanpa_jadwal");
    if (jamRusak.length > 0) tanda.push("jam_tidak_terbaca");
    if (
      [...jam.values()].some(
        (unit) => [...unit].filter((u) => u !== "").length > 1,
      )
    )
      tanda.push("gabungan_lintas_unit");
    const kunciJadwal = new Set(mapel.keys());
    if (
      rincian.some((r) => r.jp !== r.jp_penugasan) ||
      [...penugasan.keys()].some((k) => !kunciJadwal.has(k))
    )
      tanda.push("beda_penugasan");
    if (g.aktif !== 1 && jadwal.length > 0) tanda.push("nonaktif");
    if (sertifikat && rincian.some((r) => !cocokBidang(r.nama_mapel, bidang)))
      tanda.push("mapel_di_luar_sertifikat");

    return {
      id_unik: g.id_unik,
      nama: g.nama,
      gelar: g.gelar,
      nip: g.nip,
      nuptk: g.nuptk,
      unit: g.unit,
      status: status.get(g.id_unik) ?? "",
      aktif: g.aktif === 1,
      jp_tatap_muka: jpTatapMuka,
      jp_tugas: jpTugas,
      total,
      mapel: rincian,
      per_unit: [...jamUnit.entries()]
        .map(([u, k]) => ({ unit: namaUnit.get(u) ?? "", jp: k.size }))
        .sort((a, b) => bandingTeks(a.unit, b.unit)),
      tugas,
      jam_rusak: jamRusak,
      tanda,
    };
  });
}

/** Unit pilihan: unit utama guru dan unit rombel yang diajarnya, tanpa ganda. */
export function daftarUnitBeban(rekap: readonly RekapBeban[]): string[] {
  const unit = new Map<string, string>();
  for (const r of rekap) {
    for (const u of [r.unit, ...r.per_unit.map((p) => p.unit)]) {
      const k = kunciTeks(u);
      if (k !== "" && !unit.has(k)) unit.set(k, u.trim());
    }
  }
  return [...unit.values()].sort(bandingTeks);
}

/** Guru masuk unit `unit` bila unit utamanya itu atau ia mengajar di sana; `""` = semua. */
export function dalamUnitBeban(r: RekapBeban, unit: string): boolean {
  const k = kunciTeks(unit);
  return (
    k === "" ||
    kunciTeks(r.unit) === k ||
    r.per_unit.some((p) => kunciTeks(p.unit) === k)
  );
}

/** Tanda dalam kalimat untuk layar dan kolom Keterangan Excel. */
export function kalimatTandaBeban(
  tanda: TandaBeban,
  batas: BatasBeban,
): string {
  switch (tanda) {
    case "kurang_dari_batas":
      return `Di bawah batas minimal ${batas.min} JP`;
    case "lebih_dari_batas":
      return `Di atas batas maksimal ${batas.maks} JP`;
    case "tanpa_jadwal":
      return "Tidak punya jadwal mengajar di semester ini";
    case "jam_tidak_terbaca":
      return "Ada jam pelajaran yang tidak terbaca di jadwal (tidak dihitung)";
    case "gabungan_lintas_unit":
      return "Jam yang sama terjadwal di dua unit (periksa jadwal)";
    case "beda_penugasan":
      return "Jadwal berbeda dengan penugasan mapel";
    case "nonaktif":
      return "Guru nonaktif tetapi masih punya jadwal";
    case "mapel_di_luar_sertifikat":
      return "Mapel di luar bidang sertifikat (periksa)";
  }
}
