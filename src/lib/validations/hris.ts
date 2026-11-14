/**
 * HRIS Fase 1a (`prd-hris.md` §19.2.1): bagian dan jabatan sebagai master.
 * Cermin `desktop/hris.rs`: fungsi bernama sama dalam snake_case, vektor
 * `hris.vektor.json` diuji kedua bahasa, dan konstanta SQL di bawah disalin
 * harfiah (diperiksa `hris.test.ts`). Pesan galatnya pun wajib identik.
 */

import { z } from "zod";
import { type AccessSubject, hasPermission } from "@/lib/auth/access";
import { normalizeOperatorPhone } from "@/lib/operators/contact";
import {
  MIME_BERKAS_SEKOLAH,
  type MimeBerkasSekolah,
  tandaTanganCocok,
  ukuranBase64,
} from "./berkas-sekolah";
import { tanggalValid } from "./hari-kerja";
import type { BarisJenis } from "./hr-pengajuan";

export const NAMA_MAKS = 60;

/** Spasi beruntun menjadi satu, spasi tepi dibuang. */
export function normalisasiNama(nama: string): string {
  return nama.split(/\s+/).filter(Boolean).join(" ");
}

/** Kunci pembanding nama: tanpa beda huruf besar-kecil dan spasi ganda. */
export function kunciNama(nama: string): string {
  return normalisasiNama(nama).toLowerCase();
}

export function validasiNamaMaster(
  nama: string,
  jenis: string,
): { ok: true; nama: string } | { ok: false; galat: string } {
  const normal = normalisasiNama(nama);
  const panjang = [...normal].length;
  if (panjang < 2)
    return { ok: false, galat: `Nama ${jenis} minimal 2 karakter.` };
  if (panjang > NAMA_MAKS)
    return {
      ok: false,
      galat: `Nama ${jenis} maksimal ${NAMA_MAKS} karakter.`,
    };
  return { ok: true, nama: normal };
}

/**
 * Id `hr_bagian_nama`. Huruf kecil ASCII saja, sama dengan `lower()` SQLite
 * di SQL migrasi.
 */
export function idNamaBagian(idBagian: string, nama: string): string {
  const kecil = nama.replace(/[A-Z]/g, (c) => c.toLowerCase());
  const hex = [...new TextEncoder().encode(kecil)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `${idBagian}:${hex}`;
}

/** Atasan untuk pegawai: bukan dirinya, tanpa siklus. `atasan` = peta pegawai → atasannya. */
export function periksaAtasan(
  idKaryawan: string,
  idAtasan: string,
  atasan: ReadonlyMap<string, string>,
): string | null {
  if (idAtasan === "") return null;
  if (idAtasan === idKaryawan) return "Atasan tidak boleh dirinya sendiri.";
  const dilalui = new Set<string>();
  let kini = idAtasan;
  for (;;) {
    const berikut = atasan.get(kini);
    if (!berikut) break;
    if (berikut === idKaryawan)
      return "Atasan ini membuat rantai atasan yang berputar.";
    if (dilalui.has(kini)) break;
    dilalui.add(kini);
    kini = berikut;
  }
  return null;
}

/** Pegawai yang berada di dalam siklus atasan, terurut. */
export function dalamSiklusAtasan(
  atasan: ReadonlyMap<string, string>,
): string[] {
  const hasil = new Set<string>();
  for (const awal of atasan.keys()) {
    const dilalui = new Set<string>();
    let kini = awal;
    for (;;) {
      const berikut = atasan.get(kini);
      if (!berikut) break;
      if (berikut === awal) {
        hasil.add(awal);
        break;
      }
      if (dilalui.has(kini)) break;
      dilalui.add(kini);
      kini = berikut;
    }
  }
  return [...hasil].sort(bandingTeks);
}

/** Urutan byte seperti `BTreeSet<String>` Rust, bukan `localeCompare`. */
function bandingTeks(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export interface PegawaiOrg {
  id_unik: string;
  divisi: string;
  id_bagian: string;
  id_jabatan: string;
  id_atasan: string;
}

export interface MasterOrg {
  id: string;
  nama: string;
  is_aktif: number;
}

export interface NamaLama {
  id_bagian: string;
  nama: string;
}

export interface BagianOrg {
  id_bagian: string;
  nama: string;
  is_aktif: number;
  anggota: number;
  nama_lama: string[];
  nama_ganda: boolean;
}

export interface JabatanOrg {
  id_jabatan: string;
  nama: string;
  is_aktif: number;
  anggota: number;
  nama_ganda: boolean;
}

export interface SusunanOrg {
  bagian: BagianOrg[];
  jabatan: JabatanOrg[];
  tanpa_master: { divisi: string; jumlah: number }[];
  atasan_siklus: string[];
}

/** Turunan halaman Organisasi; cermin `susun_org`. */
export function susunOrg(
  pegawai: readonly PegawaiOrg[],
  bagian: readonly MasterOrg[],
  namaLama: readonly NamaLama[],
  jabatan: readonly MasterOrg[],
): SusunanOrg {
  const ganda = (daftar: readonly MasterOrg[]) => {
    const hitung = new Map<string, number>();
    for (const m of daftar) {
      if (m.is_aktif !== 1) continue;
      const k = kunciNama(m.nama);
      hitung.set(k, (hitung.get(k) ?? 0) + 1);
    }
    return hitung;
  };
  const gandaBagian = ganda(bagian);
  const gandaJabatan = ganda(jabatan);
  const dikenal = new Set([
    ...namaLama.map((n) => kunciNama(n.nama)),
    ...bagian.map((b) => kunciNama(b.nama)),
  ]);
  const tanpa = new Map<string, { divisi: string; jumlah: number }>();
  for (const p of pegawai) {
    if (p.id_bagian !== "") continue;
    const k = kunciNama(p.divisi);
    if (k === "" || dikenal.has(k)) continue;
    const entri = tanpa.get(k) ?? {
      divisi: normalisasiNama(p.divisi),
      jumlah: 0,
    };
    entri.jumlah += 1;
    tanpa.set(k, entri);
  }
  return {
    bagian: bagian.map((b) => ({
      id_bagian: b.id,
      nama: b.nama,
      is_aktif: b.is_aktif,
      anggota: pegawai.filter((p) => p.id_bagian === b.id).length,
      nama_lama: namaLama
        .filter(
          (n) =>
            n.id_bagian === b.id && kunciNama(n.nama) !== kunciNama(b.nama),
        )
        .map((n) => n.nama),
      nama_ganda:
        b.is_aktif === 1 && (gandaBagian.get(kunciNama(b.nama)) ?? 0) > 1,
    })),
    jabatan: jabatan.map((j) => ({
      id_jabatan: j.id,
      nama: j.nama,
      is_aktif: j.is_aktif,
      anggota: pegawai.filter((p) => p.id_jabatan === j.id).length,
      nama_ganda:
        j.is_aktif === 1 && (gandaJabatan.get(kunciNama(j.nama)) ?? 0) > 1,
    })),
    tanpa_master: [...tanpa.entries()]
      .sort(([a], [b]) => bandingTeks(a, b))
      .map(([, v]) => v),
    atasan_siklus: dalamSiklusAtasan(
      new Map(pegawai.map((p) => [p.id_unik, p.id_atasan])),
    ),
  };
}

/** Baris pegawai `ORG_PEGAWAI_SQL`. */
export interface PegawaiKepegawaian extends PegawaiOrg {
  kode_karyawan: string;
  nama: string;
  unit: string;
  jabatan_status: string;
  status_aktif: string;
  tmt: string;
  kelompok: "Guru" | "Tendik";
  status_kepegawaian: string;
}

export interface OrgKepegawaian extends SusunanOrg {
  /** `status_kepegawaian` di sini = status kini (`STATUS_KINI_SQL`, hari ini WIB). */
  pegawai: PegawaiKepegawaian[];
  jenis_tugas: JenisTugas[];
  /** Jenis pengajuan cuti/izin (HRIS Fase 2), disunting di tab Organisasi. */
  jenis_pengajuan: BarisJenis[];
  pengaturan: PengaturanKontrak;
}

export const bagianDraftSchema = z
  .object({
    id: z.string().trim().max(80).optional(),
    nama: z.string().max(200),
    is_aktif: z.union([z.literal(0), z.literal(1)]).default(1),
  })
  .strict();
export type MasterDraft = z.input<typeof bagianDraftSchema>;

export const gabungBagianSchema = z
  .object({
    id_asal: z.string().trim().min(1).max(80),
    id_tujuan: z.string().trim().min(1).max(80),
  })
  .strict();

/** Kolom organisasi di payload simpan Karyawan/Guru; kosong = tidak dipilih. */
export const organisasiPegawaiSchema = {
  id_bagian: z.string().trim().max(80).optional(),
  id_jabatan: z.string().trim().max(80).optional(),
  id_atasan: z.string().trim().max(80).optional(),
};

// SQL (harfiah sama dengan hris.rs)

export const PEGAWAI_SQL =
  "LOWER(TRIM(COALESCE(m.jenis_personil, ''))) <> 'siswa' AND NOT EXISTS (SELECT 1 FROM siswa_data sd WHERE sd.id_siswa = m.id_unik)";

export const MIGRASI_ORGANISASI_SQL = [
  "INSERT OR IGNORE INTO hr_bagian (id_bagian, nama) SELECT 'bag-' || lower(hex(lower(trim(m.divisi)))), trim(m.divisi) FROM master_data m WHERE LOWER(TRIM(COALESCE(m.jenis_personil, ''))) <> 'siswa' AND NOT EXISTS (SELECT 1 FROM siswa_data sd WHERE sd.id_siswa = m.id_unik) AND trim(COALESCE(m.divisi, '')) <> '' GROUP BY lower(trim(m.divisi)), trim(m.divisi) ORDER BY lower(trim(m.divisi)), COUNT(*) DESC, trim(m.divisi);",
  "INSERT OR IGNORE INTO hr_bagian_nama (id_nama, id_bagian, nama) SELECT b.id_bagian || ':' || lower(hex(lower(b.nama))), b.id_bagian, b.nama FROM hr_bagian b;",
  "INSERT OR IGNORE INTO hr_jabatan (id_jabatan, nama) SELECT 'jab-' || lower(hex(lower(trim(m.jabatan_status)))), trim(m.jabatan_status) FROM master_data m WHERE LOWER(TRIM(COALESCE(m.jenis_personil, ''))) <> 'siswa' AND NOT EXISTS (SELECT 1 FROM siswa_data sd WHERE sd.id_siswa = m.id_unik) AND trim(COALESCE(m.jabatan_status, '')) NOT IN ('', '-') GROUP BY lower(trim(m.jabatan_status)), trim(m.jabatan_status) ORDER BY lower(trim(m.jabatan_status)), COUNT(*) DESC, trim(m.jabatan_status);",
  "UPDATE master_data SET id_bagian = 'bag-' || lower(hex(lower(trim(divisi)))) WHERE id_bagian IS NULL AND trim(COALESCE(divisi, '')) <> '' AND id_unik IN (SELECT m.id_unik FROM master_data m WHERE LOWER(TRIM(COALESCE(m.jenis_personil, ''))) <> 'siswa' AND NOT EXISTS (SELECT 1 FROM siswa_data sd WHERE sd.id_siswa = m.id_unik));",
  "UPDATE master_data SET id_jabatan = 'jab-' || lower(hex(lower(trim(jabatan_status)))) WHERE id_jabatan IS NULL AND trim(COALESCE(jabatan_status, '')) NOT IN ('', '-') AND id_unik IN (SELECT m.id_unik FROM master_data m WHERE LOWER(TRIM(COALESCE(m.jenis_personil, ''))) <> 'siswa' AND NOT EXISTS (SELECT 1 FROM siswa_data sd WHERE sd.id_siswa = m.id_unik));",
  "INSERT OR IGNORE INTO hr_tugas_jenis (id_jenis, nama, ekuivalen_jp) VALUES ('tgs-kepsek', 'Kepala Sekolah', 24), ('tgs-wakasek', 'Wakil Kepala Sekolah', 12), ('tgs-kaprog', 'Kepala Program Keahlian', 12), ('tgs-kaperpus', 'Kepala Perpustakaan', 12), ('tgs-kalab', 'Kepala Laboratorium/Bengkel', 12), ('tgs-wali-kelas', 'Wali Kelas', 2), ('tgs-pembina-osis', 'Pembina OSIS', 2), ('tgs-pembina-ekskul', 'Pembina Ekstrakurikuler', 2), ('tgs-piket', 'Guru Piket', 1), ('tgs-bendahara-bos', 'Bendahara BOS', 0);",
  "INSERT OR IGNORE INTO hr_dokumen_jenis (id_jenis, nama) VALUES ('dok-ktp', 'KTP'), ('dok-kk', 'Kartu Keluarga'), ('dok-npwp', 'NPWP'), ('dok-ijazah', 'Ijazah'), ('dok-transkrip', 'Transkrip Nilai'), ('dok-serdik', 'Sertifikat Pendidik'), ('dok-sk-yayasan', 'SK Yayasan'), ('dok-sk-tugas', 'SK Tugas'), ('dok-kontrak', 'Kontrak Kerja'), ('dok-skck', 'SKCK'), ('dok-sehat', 'Surat Keterangan Sehat'), ('dok-pelatihan', 'Sertifikat Pelatihan'), ('dok-lainnya', 'Lainnya');",
] as const;

export const SIMPAN_BAGIAN_SQL =
  "INSERT INTO hr_bagian (id_bagian, nama, is_aktif, created_at, updated_at) VALUES (?1, ?2, ?3, datetime('now'), datetime('now')) ON CONFLICT(id_bagian) DO UPDATE SET nama = excluded.nama, is_aktif = excluded.is_aktif, updated_at = excluded.updated_at;";

export const CATAT_NAMA_BAGIAN_SQL =
  "INSERT OR IGNORE INTO hr_bagian_nama (id_nama, id_bagian, nama, created_at) VALUES (?1, ?2, ?3, datetime('now'));";

export const SIMPAN_JABATAN_SQL =
  "INSERT INTO hr_jabatan (id_jabatan, nama, is_aktif, created_at, updated_at) VALUES (?1, ?2, ?3, datetime('now'), datetime('now')) ON CONFLICT(id_jabatan) DO UPDATE SET nama = excluded.nama, is_aktif = excluded.is_aktif, updated_at = excluded.updated_at;";

export const TULIS_ULANG_BAGIAN_SQL = [
  "UPDATE master_data SET id_bagian = ?1 WHERE COALESCE(id_bagian, '') = '' AND EXISTS (SELECT 1 FROM hr_bagian WHERE id_bagian = ?1 AND is_aktif = 1) AND lower(trim(divisi)) IN (SELECT lower(trim(nama)) FROM hr_bagian_nama WHERE id_bagian = ?1) AND LOWER(TRIM(COALESCE(jenis_personil, ''))) <> 'siswa' AND NOT EXISTS (SELECT 1 FROM siswa_data sd WHERE sd.id_siswa = master_data.id_unik);",
  "UPDATE master_data SET divisi = (SELECT nama FROM hr_bagian WHERE id_bagian = ?1) WHERE id_bagian = ?1 AND EXISTS (SELECT 1 FROM hr_bagian WHERE id_bagian = ?1) AND divisi IS NOT (SELECT nama FROM hr_bagian WHERE id_bagian = ?1);",
  "UPDATE id_card SET divisi = (SELECT nama FROM hr_bagian WHERE id_bagian = ?1) WHERE id_unik IN (SELECT id_unik FROM master_data WHERE id_bagian = ?1) AND EXISTS (SELECT 1 FROM hr_bagian WHERE id_bagian = ?1) AND divisi IS NOT (SELECT nama FROM hr_bagian WHERE id_bagian = ?1);",
  "UPDATE absensi_harian SET kelas_divisi = (SELECT nama FROM hr_bagian WHERE id_bagian = ?1) WHERE id_karyawan IN (SELECT id_unik FROM master_data WHERE id_bagian = ?1) AND EXISTS (SELECT 1 FROM hr_bagian WHERE id_bagian = ?1) AND kelas_divisi IS NOT (SELECT nama FROM hr_bagian WHERE id_bagian = ?1);",
  "UPDATE log_scan SET divisi = (SELECT nama FROM hr_bagian WHERE id_bagian = ?1) WHERE id_karyawan IN (SELECT id_unik FROM master_data WHERE id_bagian = ?1) AND EXISTS (SELECT 1 FROM hr_bagian WHERE id_bagian = ?1) AND divisi IS NOT (SELECT nama FROM hr_bagian WHERE id_bagian = ?1);",
  "UPDATE backup_karyawan SET divisi_pengganti = (SELECT nama FROM hr_bagian WHERE id_bagian = ?1) WHERE id_karyawan_pengganti IN (SELECT id_unik FROM master_data WHERE id_bagian = ?1) AND EXISTS (SELECT 1 FROM hr_bagian WHERE id_bagian = ?1) AND divisi_pengganti IS NOT (SELECT nama FROM hr_bagian WHERE id_bagian = ?1);",
  "UPDATE backup_karyawan SET divisi_asal = (SELECT nama FROM hr_bagian WHERE id_bagian = ?1) WHERE id_karyawan_asal IN (SELECT id_unik FROM master_data WHERE id_bagian = ?1) AND EXISTS (SELECT 1 FROM hr_bagian WHERE id_bagian = ?1) AND divisi_asal IS NOT (SELECT nama FROM hr_bagian WHERE id_bagian = ?1);",
  "UPDATE koreksi_admin SET divisi = (SELECT nama FROM hr_bagian WHERE id_bagian = ?1) WHERE id_karyawan IN (SELECT id_unik FROM master_data WHERE id_bagian = ?1) AND EXISTS (SELECT 1 FROM hr_bagian WHERE id_bagian = ?1) AND divisi IS NOT (SELECT nama FROM hr_bagian WHERE id_bagian = ?1);",
  "UPDATE payroll_components SET applies_to = 'DIVISI:' || (SELECT nama FROM hr_bagian WHERE id_bagian = ?1) WHERE EXISTS (SELECT 1 FROM hr_bagian WHERE id_bagian = ?1) AND upper(substr(trim(applies_to), 1, 7)) = 'DIVISI:' AND lower(trim(substr(trim(applies_to), 8))) IN (SELECT lower(trim(nama)) FROM hr_bagian_nama WHERE id_bagian = ?1) AND applies_to IS NOT ('DIVISI:' || (SELECT nama FROM hr_bagian WHERE id_bagian = ?1));",
  "UPDATE hari_libur_whitelist SET scope_value = (SELECT nama FROM hr_bagian WHERE id_bagian = ?1), updated_at = datetime('now') WHERE scope_type = 'DIVISI' AND EXISTS (SELECT 1 FROM hr_bagian WHERE id_bagian = ?1) AND lower(trim(scope_value)) IN (SELECT lower(trim(nama)) FROM hr_bagian_nama WHERE id_bagian = ?1) AND scope_value IS NOT (SELECT nama FROM hr_bagian WHERE id_bagian = ?1);",
] as const;

export const TULIS_ULANG_JABATAN_SQL =
  "UPDATE master_data SET jabatan_status = (SELECT nama FROM hr_jabatan WHERE id_jabatan = ?1) WHERE id_jabatan = ?1 AND EXISTS (SELECT 1 FROM hr_jabatan WHERE id_jabatan = ?1) AND jabatan_status IS NOT (SELECT nama FROM hr_jabatan WHERE id_jabatan = ?1);";

export const GABUNG_BAGIAN_SQL = [
  "INSERT OR IGNORE INTO hr_bagian_nama (id_nama, id_bagian, nama, created_at) SELECT ?2 || substr(id_nama, length(?1) + 1), ?2, nama, created_at FROM hr_bagian_nama WHERE id_bagian = ?1 AND ?1 <> ?2 AND EXISTS (SELECT 1 FROM hr_bagian WHERE id_bagian = ?2);",
  "UPDATE master_data SET id_bagian = ?2 WHERE id_bagian = ?1 AND ?1 <> ?2 AND EXISTS (SELECT 1 FROM hr_bagian WHERE id_bagian = ?2);",
  "UPDATE hr_bagian SET is_aktif = 0, updated_at = datetime('now') WHERE id_bagian = ?1 AND ?1 <> ?2 AND EXISTS (SELECT 1 FROM hr_bagian WHERE id_bagian = ?2);",
] as const;

export const PETA_BAGIAN_SQL =
  "SELECT n.id_bagian, b.nama FROM hr_bagian_nama n JOIN hr_bagian b ON b.id_bagian = n.id_bagian WHERE lower(trim(n.nama)) = lower(trim(?1)) ORDER BY b.is_aktif DESC, n.created_at DESC, n.id_nama LIMIT 1;";

export const PETA_JABATAN_SQL =
  "SELECT id_jabatan, nama FROM hr_jabatan WHERE lower(trim(nama)) = lower(trim(?1)) ORDER BY is_aktif DESC, id_jabatan LIMIT 1;";

export const BENTROK_BAGIAN_SQL =
  "SELECT 1 FROM hr_bagian b WHERE b.id_bagian <> ?2 AND b.is_aktif = 1 AND lower(trim(b.nama)) = lower(trim(?1)) UNION ALL SELECT 1 FROM hr_bagian_nama n JOIN hr_bagian b ON b.id_bagian = n.id_bagian WHERE n.id_bagian <> ?2 AND b.is_aktif = 1 AND lower(trim(n.nama)) = lower(trim(?1)) LIMIT 1;";

export const BENTROK_JABATAN_SQL =
  "SELECT 1 FROM hr_jabatan WHERE id_jabatan <> ?2 AND is_aktif = 1 AND lower(trim(nama)) = lower(trim(?1)) LIMIT 1;";

export const ORG_PEGAWAI_SQL =
  "SELECT m.id_unik, COALESCE(m.kode_karyawan, '') AS kode_karyawan, m.nama, COALESCE(m.unit, '') AS unit, COALESCE(m.divisi, '') AS divisi, COALESCE(m.jabatan_status, '') AS jabatan_status, COALESCE(m.id_bagian, '') AS id_bagian, COALESCE(m.id_jabatan, '') AS id_jabatan, COALESCE(m.id_atasan, '') AS id_atasan, COALESCE(m.status_aktif, 'Aktif') AS status_aktif, COALESCE(m.tanggal_mulai_aktif, '') AS tmt, CASE WHEN g.id_guru IS NOT NULL OR LOWER(TRIM(COALESCE(m.jenis_personil, ''))) = 'guru' THEN 'Guru' ELSE 'Tendik' END AS kelompok, COALESCE(g.status_kepegawaian, '') AS status_kepegawaian FROM master_data m LEFT JOIN guru_data g ON g.id_guru = m.id_unik WHERE LOWER(TRIM(COALESCE(m.jenis_personil, ''))) <> 'siswa' AND NOT EXISTS (SELECT 1 FROM siswa_data sd WHERE sd.id_siswa = m.id_unik) ORDER BY m.nama, m.id_unik\n-- batas: pegawai sekolah (guru dan tendik), dibatasi jumlah personil lembaga\n;";

export const ORG_BAGIAN_SQL =
  "SELECT id_bagian, nama, is_aktif FROM hr_bagian ORDER BY nama, id_bagian\n-- batas: daftar bagian sekolah, tidak tumbuh per hari\n;";

export const ORG_BAGIAN_NAMA_SQL =
  "SELECT id_bagian, nama FROM hr_bagian_nama ORDER BY created_at, id_nama\n-- batas: nama yang pernah dipakai bagian sekolah\n;";

export const ORG_JABATAN_SQL =
  "SELECT id_jabatan, nama, is_aktif FROM hr_jabatan ORDER BY nama, id_jabatan\n-- batas: daftar jabatan sekolah, tidak tumbuh per hari\n;";

// Fase 1b: kontrak dan status kepegawaian (§19.2.4)

/** K-1, Q-24. Cermin `STATUS_KONTRAK` dan CHECK `hr_kontrak.status`. */
export const STATUS_KONTRAK = [
  "GTY",
  "PTY",
  "GTT",
  "PTT",
  "Honorer",
  "PNS",
  "PPPK",
] as const;
export type StatusKontrak = (typeof STATUS_KONTRAK)[number];
export const STATUS_PEMBATALAN = "Pembatalan";
export const NOMOR_MAKS = 80;
export const CATATAN_MAKS = 500;

/** Angka hukum kontrak sebagai pengaturan sekolah (Q-28); kosong = bawaan. */
export const KUNCI_PERCOBAAN_MAKS = "hr_percobaan_maks_bulan";
export const KUNCI_PKWT_MAKS = "hr_pkwt_maks_bulan";
/** Batas beban mengajar per minggu (HRIS Fase 3a, §21.2.1); kosong = bawaan. */
export const KUNCI_BEBAN_MIN_JP = "hr_beban_min_jp";
export const KUNCI_BEBAN_MAKS_JP = "hr_beban_maks_jp";

export interface Aturan {
  bawaan: number;
  min: number;
  maks: number;
  satuan: string;
}
export const ATURAN_PERCOBAAN = {
  bawaan: 3,
  min: 1,
  maks: 12,
  satuan: "bulan",
} as const satisfies Aturan;
export const ATURAN_PKWT = {
  bawaan: 60,
  min: 12,
  maks: 120,
  satuan: "bulan",
} as const satisfies Aturan;
export const ATURAN_BEBAN_MIN = {
  bawaan: 24,
  min: 0,
  maks: 60,
  satuan: "JP",
} as const satisfies Aturan;
export const ATURAN_BEBAN_MAKS = {
  bawaan: 40,
  min: 1,
  maks: 60,
  satuan: "JP",
} as const satisfies Aturan;

type Hasil<T> = { ok: true; nilai: T } | { ok: false; galat: string };

const panjang = (teks: string) => [...teks].length;

/** Isian kontrak (form, payload outbox); kosong = tidak diisi. */
export interface KontrakIsian {
  status: string;
  nomor: string;
  tanggal_mulai: string;
  tanggal_selesai: string;
  percobaan_selesai: string;
  catatan: string;
}

/** Kelengkapan kontrak, bukan angka hukum. `guru` = punya `guru_data`. */
export function validasiKontrak(
  isian: KontrakIsian,
  guru: boolean,
): Hasil<KontrakIsian> {
  const k: KontrakIsian = {
    status: isian.status.trim(),
    nomor: isian.nomor.trim(),
    tanggal_mulai: isian.tanggal_mulai.trim(),
    tanggal_selesai: isian.tanggal_selesai.trim(),
    percobaan_selesai: isian.percobaan_selesai.trim(),
    catatan: isian.catatan.trim(),
  };
  const salah = (galat: string) => ({ ok: false as const, galat });
  if (!(STATUS_KONTRAK as readonly string[]).includes(k.status))
    return salah("Status kontrak tidak dikenal.");
  if (!tanggalValid(k.tanggal_mulai))
    return salah("Tanggal mulai kontrak tidak valid.");
  if (k.tanggal_selesai !== "" && !tanggalValid(k.tanggal_selesai))
    return salah("Tanggal selesai kontrak tidak valid.");
  if (k.percobaan_selesai !== "" && !tanggalValid(k.percobaan_selesai))
    return salah("Tanggal akhir masa percobaan tidak valid.");
  if ((k.status === "GTY" || k.status === "GTT") && !guru)
    return salah("Status GTY dan GTT hanya untuk guru.");
  if ((k.status === "PTY" || k.status === "PTT") && guru)
    return salah("Status PTY dan PTT hanya untuk tenaga kependidikan.");
  if ((k.status === "GTT" || k.status === "PTT") && k.tanggal_selesai === "")
    return salah("Kontrak GTT dan PTT wajib punya tanggal selesai.");
  if (k.tanggal_selesai !== "" && k.tanggal_selesai < k.tanggal_mulai)
    return salah("Tanggal selesai tidak boleh sebelum tanggal mulai.");
  if (k.percobaan_selesai !== "") {
    if (k.status !== "GTY" && k.status !== "PTY")
      return salah("Masa percobaan hanya untuk GTY dan PTY.");
    if (k.percobaan_selesai < k.tanggal_mulai)
      return salah("Akhir masa percobaan tidak boleh sebelum tanggal mulai.");
    if (k.tanggal_selesai !== "" && k.percobaan_selesai > k.tanggal_selesai)
      return salah("Akhir masa percobaan melewati tanggal selesai kontrak.");
  }
  if (panjang(k.nomor) > NOMOR_MAKS)
    return salah(`Nomor SK/kontrak maksimal ${NOMOR_MAKS} karakter.`);
  if (panjang(k.catatan) > CATATAN_MAKS)
    return salah(`Catatan maksimal ${CATATAN_MAKS} karakter.`);
  return { ok: true, nilai: k };
}

/** Alasan pembatalan kontrak atau tugas. */
export function validasiAlasan(alasan: string): Hasil<string> {
  const teks = alasan.trim();
  if (teks === "")
    return { ok: false, galat: "Alasan pembatalan wajib diisi." };
  if (panjang(teks) > CATATAN_MAKS)
    return { ok: false, galat: `Alasan maksimal ${CATATAN_MAKS} karakter.` };
  return { ok: true, nilai: teks };
}

function hariDalamBulan(tahun: number, bulan: number): number {
  return new Date(Date.UTC(tahun, bulan, 0)).getUTCDate();
}

/** Tanggal + n bulan; tanggal di luar bulan tujuan menjadi akhir bulan. */
export function tambahBulan(tanggal: string, bulan: number): string | null {
  if (!tanggalValid(tanggal)) return null;
  const [y, m, d] = tanggal.split("-").map(Number);
  const total = y * 12 + (m - 1) + bulan;
  const ty = Math.floor(total / 12);
  const tm = (total % 12) + 1;
  const td = Math.min(d, hariDalamBulan(ty, tm));
  const dua = (n: number) => String(n).padStart(2, "0");
  return `${String(ty).padStart(4, "0")}-${dua(tm)}-${dua(td)}`;
}

/** Baris `hr_kontrak` (`KONTRAK_SQL`); kolom kosong = `""`. */
export interface KontrakBaris {
  id_kontrak: string;
  id_karyawan: string;
  status: string;
  id_ref: string;
  nomor: string;
  tanggal_mulai: string;
  tanggal_selesai: string;
  percobaan_selesai: string;
  catatan: string;
  dicatat_oleh: string;
  created_at: string;
}

/** Kontrak tidak dibatalkan, urut (tanggal mulai, id) seperti `STATUS_KINI_SQL`. */
export function kontrakSah(kontrak: readonly KontrakBaris[]): KontrakBaris[] {
  const batal = new Set(
    kontrak.filter((k) => k.status === STATUS_PEMBATALAN).map((k) => k.id_ref),
  );
  return kontrak
    .filter((k) => k.status !== STATUS_PEMBATALAN && !batal.has(k.id_kontrak))
    .sort(
      (a, b) =>
        bandingTeks(a.tanggal_mulai, b.tanggal_mulai) ||
        bandingTeks(a.id_kontrak, b.id_kontrak),
    );
}

export interface StatusKerja {
  keadaan: "Berlaku" | "Berakhir" | "Akan berlaku" | "Tanpa kontrak";
  status: string;
  id_kontrak: string;
  sampai: string;
  percobaan_sampai: string;
}

/** Keadaan kontrak satu orang pada `tanggal`; cermin `status_kerja`. */
export function statusKerja(
  kontrak: readonly KontrakBaris[],
  tanggal: string,
): StatusKerja {
  const sah = kontrakSah(kontrak);
  const berjalan = sah.filter((k) => k.tanggal_mulai <= tanggal);
  const k = berjalan[berjalan.length - 1];
  if (!k) {
    const nanti = sah[0];
    if (!nanti)
      return {
        keadaan: "Tanpa kontrak",
        status: "",
        id_kontrak: "",
        sampai: "",
        percobaan_sampai: "",
      };
    return {
      keadaan: "Akan berlaku",
      status: nanti.status,
      id_kontrak: nanti.id_kontrak,
      sampai: nanti.tanggal_selesai,
      percobaan_sampai: nanti.percobaan_selesai,
    };
  }
  return {
    keadaan:
      k.tanggal_selesai !== "" && k.tanggal_selesai < tanggal
        ? "Berakhir"
        : "Berlaku",
    status: k.status,
    id_kontrak: k.id_kontrak,
    sampai: k.tanggal_selesai,
    percobaan_sampai:
      k.percobaan_selesai !== "" && k.percobaan_selesai >= tanggal
        ? k.percobaan_selesai
        : "",
  };
}

export interface AturanKontrak {
  percobaan_maks_bulan: number;
  pkwt_maks_bulan: number;
}

/**
 * Tanda, bukan penolakan (Q-28). `pkwt_lewat`: rangkaian GTT/PTT terakhir
 * (diputus status lain) lebih panjang dari batas, dihitung dari tanggal mulai
 * kontrak pertamanya sampai tanggal selesai terjauh; celah tidak memutus.
 */
export function tandaKontrak(
  kontrak: readonly KontrakBaris[],
  aturan: AturanKontrak,
): string[] {
  const sah = kontrakSah(kontrak);
  const tanda: string[] = [];
  const percobaanLewat = sah.some((k) => {
    if (k.percobaan_selesai === "") return false;
    const batas = tambahBulan(k.tanggal_mulai, aturan.percobaan_maks_bulan);
    return batas !== null && k.percobaan_selesai > batas;
  });
  if (percobaanLewat) tanda.push("percobaan_lewat");
  let awal = sah.length;
  while (
    awal > 0 &&
    (sah[awal - 1].status === "GTT" || sah[awal - 1].status === "PTT")
  )
    awal--;
  const rangkaian = sah.slice(awal);
  if (rangkaian.length > 0) {
    const batas = tambahBulan(
      rangkaian[0].tanggal_mulai,
      aturan.pkwt_maks_bulan,
    );
    const akhir = rangkaian
      .map((k) => k.tanggal_selesai)
      .reduce((a, b) => (b > a ? b : a), "");
    if (batas !== null && akhir > batas) tanda.push("pkwt_lewat");
  }
  return tanda;
}

export interface RingkasKontrak extends StatusKerja {
  id_karyawan: string;
  tanda: string[];
}

export interface SusunanKontrak {
  ringkas: RingkasKontrak[];
  dibatalkan: string[];
}

/** Ringkasan tab Kontrak per pegawai (urut id); cermin `susun_kontrak`. */
export function susunKontrak(
  kontrak: readonly KontrakBaris[],
  hariIni: string,
  aturan: AturanKontrak,
): SusunanKontrak {
  const per = new Map<string, KontrakBaris[]>();
  for (const k of kontrak) {
    const daftar = per.get(k.id_karyawan) ?? [];
    daftar.push(k);
    per.set(k.id_karyawan, daftar);
  }
  return {
    ringkas: [...per.keys()].sort(bandingTeks).map((id) => {
      const daftar = per.get(id) ?? [];
      return {
        id_karyawan: id,
        ...statusKerja(daftar, hariIni),
        tanda: tandaKontrak(daftar, aturan),
      };
    }),
    dibatalkan: [
      ...new Set(
        kontrak
          .filter((k) => k.status === STATUS_PEMBATALAN && k.id_ref !== "")
          .map((k) => k.id_ref),
      ),
    ].sort(bandingTeks),
  };
}

/** Nilai kunci angka kontrak; kosong, rusak, atau di luar rentang = bawaan. */
export function angkaPengaturan(nilai: string | null, aturan: Aturan): number {
  const teks = (nilai ?? "").trim();
  if (!/^\d{1,4}$/.test(teks)) return aturan.bawaan;
  const n = Number(teks);
  return n >= aturan.min && n <= aturan.maks ? n : aturan.bawaan;
}

/** Isian pengaturan dari layar; `""` = kembali ke bawaan. */
export function validasiAngkaPengaturan(
  teks: string,
  aturan: Aturan,
  label: string,
): Hasil<string> {
  const isi = teks.trim();
  if (isi === "") return { ok: true, nilai: "" };
  const n = /^\d{1,4}$/.test(isi) ? Number(isi) : Number.NaN;
  if (!(n >= aturan.min && n <= aturan.maks))
    return {
      ok: false,
      galat: `${label} harus ${aturan.min} sampai ${aturan.maks} ${aturan.satuan}, atau kosong untuk bawaan ${aturan.bawaan}.`,
    };
  return { ok: true, nilai: String(n) };
}

/**
 * Batas JP berlaku [min, maks]; maks yang kurang dari min (dua perangkat
 * menyimpan berbeda) dinaikkan ke min. Cermin `batas_beban`.
 */
export function batasBeban(
  min: string | null,
  maks: string | null,
): [number, number] {
  const bawah = angkaPengaturan(min, ATURAN_BEBAN_MIN);
  return [bawah, Math.max(angkaPengaturan(maks, ATURAN_BEBAN_MAKS), bawah)];
}

/** Isian batas JP dari layar; cermin `validasi_batas_beban`. */
export function validasiBatasBeban(
  min: string,
  maks: string,
): Hasil<[string, string]> {
  const bawah = validasiAngkaPengaturan(
    min,
    ATURAN_BEBAN_MIN,
    "Batas minimal beban mengajar",
  );
  if (!bawah.ok) return bawah;
  const atas = validasiAngkaPengaturan(
    maks,
    ATURAN_BEBAN_MAKS,
    "Batas maksimal beban mengajar",
  );
  if (!atas.ok) return atas;
  const berlakuMin = angkaPengaturan(bawah.nilai, ATURAN_BEBAN_MIN);
  if (angkaPengaturan(atas.nilai, ATURAN_BEBAN_MAKS) < berlakuMin)
    return {
      ok: false,
      galat: `Batas maksimal beban mengajar tidak boleh kurang dari batas minimal (${berlakuMin} JP).`,
    };
  return { ok: true, nilai: [bawah.nilai, atas.nilai] };
}

// Fase 1b: tugas tambahan (§19.2.2)

/** Satu-satunya id jenis yang dikenal kode: wali kelas dibaca dari rombel. */
export const ID_WALI_KELAS = "tgs-wali-kelas";
export const EKUIVALEN_MAKS = 40;

export interface TugasIsian {
  id_karyawan: string;
  id_jenis: string;
  unit: string;
  tahun_ajaran: string;
  id_rombel: string;
  nomor_sk: string;
  tanggal_sk: string;
  ekuivalen_jp: number | null;
  tanggal_mulai: string;
  tanggal_selesai: string;
}

const ekuivalenSah = (n: number) =>
  Number.isInteger(n) && n >= 0 && n <= EKUIVALEN_MAKS;

/** Kelengkapan tugas tambahan; cermin `validasi_tugas`. */
export function validasiTugas(isian: TugasIsian): Hasil<TugasIsian> {
  const t: TugasIsian = {
    id_karyawan: isian.id_karyawan.trim(),
    id_jenis: isian.id_jenis.trim(),
    unit: normalisasiNama(isian.unit),
    tahun_ajaran: isian.tahun_ajaran.trim(),
    id_rombel: isian.id_rombel.trim(),
    nomor_sk: isian.nomor_sk.trim(),
    tanggal_sk: isian.tanggal_sk.trim(),
    ekuivalen_jp: isian.ekuivalen_jp,
    tanggal_mulai: isian.tanggal_mulai.trim(),
    tanggal_selesai: isian.tanggal_selesai.trim(),
  };
  const salah = (galat: string) => ({ ok: false as const, galat });
  if (t.id_karyawan === "") return salah("Pilih pegawai.");
  if (t.id_jenis === "") return salah("Pilih jenis tugas.");
  if (t.tahun_ajaran === "") return salah("Tahun ajaran wajib dipilih.");
  if (panjang(t.tahun_ajaran) > 20) return salah("Tahun ajaran tidak valid.");
  if (!tanggalValid(t.tanggal_mulai))
    return salah("Tanggal mulai tugas tidak valid.");
  if (t.tanggal_selesai !== "" && !tanggalValid(t.tanggal_selesai))
    return salah("Tanggal selesai tugas tidak valid.");
  if (t.tanggal_selesai !== "" && t.tanggal_selesai < t.tanggal_mulai)
    return salah("Tanggal selesai tidak boleh sebelum tanggal mulai.");
  if (t.tanggal_sk !== "" && !tanggalValid(t.tanggal_sk))
    return salah("Tanggal SK tidak valid.");
  if (t.ekuivalen_jp !== null && !ekuivalenSah(t.ekuivalen_jp))
    return salah(`Ekuivalen JP harus 0 sampai ${EKUIVALEN_MAKS}.`);
  if (panjang(t.nomor_sk) > NOMOR_MAKS)
    return salah(`Nomor SK maksimal ${NOMOR_MAKS} karakter.`);
  if (panjang(t.unit) > NOMOR_MAKS)
    return salah(`Unit maksimal ${NOMOR_MAKS} karakter.`);
  if (t.id_jenis === ID_WALI_KELAS) {
    if (t.id_rombel === "")
      return salah("Tugas wali kelas wajib memilih rombel.");
  } else {
    t.id_rombel = "";
  }
  return { ok: true, nilai: t };
}

/** Jenis tugas dari layar Organisasi. */
export function validasiJenisTugas(isian: {
  nama: string;
  ekuivalen_jp: number;
}): Hasil<{ nama: string; ekuivalen_jp: number }> {
  const nama = validasiNamaMaster(isian.nama, "jenis tugas");
  if (!nama.ok) return nama;
  if (!ekuivalenSah(isian.ekuivalen_jp))
    return {
      ok: false,
      galat: `Ekuivalen JP harus 0 sampai ${EKUIVALEN_MAKS}.`,
    };
  return {
    ok: true,
    nilai: { nama: nama.nama, ekuivalen_jp: isian.ekuivalen_jp },
  };
}

export type StatusTugas = "Berlaku" | "Akan berlaku" | "Selesai" | "Dibatalkan";

/** Status tugas diturunkan, tidak disimpan; cermin `status_tugas`. */
export function statusTugas(
  t: {
    tanggal_mulai: string;
    tanggal_selesai: string;
    dibatalkan_pada: string;
  },
  hariIni: string,
): StatusTugas {
  if (t.dibatalkan_pada !== "") return "Dibatalkan";
  if (t.tanggal_selesai !== "" && t.tanggal_selesai < hariIni) return "Selesai";
  if (t.tanggal_mulai > hariIni) return "Akan berlaku";
  return "Berlaku";
}

// Skema rute Fase 1b

const teksOpsional = (maks: number) =>
  z.string().max(maks).optional().default("");

export const kontrakDraftSchema = z
  .object({
    id_karyawan: z.string().trim().min(1).max(80),
    status: z.string().max(20),
    nomor: teksOpsional(200),
    tanggal_mulai: z.string().max(20),
    tanggal_selesai: teksOpsional(20),
    percobaan_selesai: teksOpsional(20),
    catatan: teksOpsional(1000),
  })
  .strict();
export type KontrakDraft = z.input<typeof kontrakDraftSchema>;

export const batalSchema = z
  .object({
    id: z.string().trim().min(1).max(80),
    alasan: z.string().max(1000),
  })
  .strict();

export const jenisTugasDraftSchema = z
  .object({
    id: z.string().trim().max(80).optional(),
    nama: z.string().max(200),
    ekuivalen_jp: z.number().int(),
    is_aktif: z.union([z.literal(0), z.literal(1)]).default(1),
  })
  .strict();
export type JenisTugasDraft = z.input<typeof jenisTugasDraftSchema>;

export const tugasDraftSchema = z
  .object({
    id: z.string().trim().max(80).optional(),
    id_karyawan: z.string().max(80),
    id_jenis: z.string().max(80),
    unit: teksOpsional(200),
    tahun_ajaran: z.string().max(40),
    id_rombel: teksOpsional(80),
    nomor_sk: teksOpsional(200),
    tanggal_sk: teksOpsional(20),
    ekuivalen_jp: z.number().int().nullable().default(null),
    tanggal_mulai: z.string().max(20),
    tanggal_selesai: teksOpsional(20),
  })
  .strict();
export type TugasDraft = z.input<typeof tugasDraftSchema>;

export const pengaturanKontrakSchema = z
  .object({
    percobaan_maks_bulan: z.string().max(10),
    pkwt_maks_bulan: z.string().max(10),
    beban_min_jp: z.string().max(10),
    beban_maks_jp: z.string().max(10),
  })
  .strict();
export type PengaturanKontrakDraft = z.infer<typeof pengaturanKontrakSchema>;

// Bentuk kembalian command/rute Fase 1b

export interface JenisTugas {
  id_jenis: string;
  nama: string;
  ekuivalen_jp: number;
  is_aktif: number;
}

export interface PengaturanKontrak {
  /** Isi kunci apa adanya; `""` = bawaan. */
  percobaan_maks_bulan: string;
  pkwt_maks_bulan: string;
  beban_min_jp: string;
  beban_maks_jp: string;
  berlaku: AturanKontrak & { beban_min_jp: number; beban_maks_jp: number };
}

export interface DaftarKontrak extends SusunanKontrak {
  kontrak: KontrakBaris[];
  hari_ini: string;
  pengaturan: PengaturanKontrak;
}

export interface TugasBaris extends Omit<TugasIsian, "ekuivalen_jp"> {
  id_tugas: string;
  ekuivalen_jp: number | null;
  dicatat_oleh: string;
  dibatalkan_pada: string;
  dibatalkan_oleh: string;
  alasan_batal: string;
  status: StatusTugas;
}

export interface WaliKelasRombel {
  id_rombel: string;
  nama_rombel: string;
  id_wali_kelas: string;
  nama_tahun: string;
  semester: string;
  tanggal_mulai: string;
  tanggal_selesai: string;
}

export interface TahunAjaranRentang {
  nama_tahun: string;
  tanggal_mulai: string;
  tanggal_selesai: string;
}

export interface DaftarTugas {
  jenis: JenisTugas[];
  tugas: TugasBaris[];
  wali_kelas: WaliKelasRombel[];
  tahun_ajaran: TahunAjaranRentang[];
  hari_ini: string;
}

// SQL Fase 1b (harfiah sama dengan hris.rs)

/**
 * Status kepegawaian per pegawai pada ?1 (Q-25): kontrak tidak dibatalkan
 * terakhir yang sudah mulai, lalu `guru_data`, lalu kosong. Dipakai ketiga
 * titik hitung gaji dan daftar Kepegawaian.
 */
export const STATUS_KINI_SQL =
  "SELECT m.id_unik, COALESCE((SELECT k.status FROM hr_kontrak k WHERE k.id_karyawan = m.id_unik AND k.status <> 'Pembatalan' AND k.tanggal_mulai <= ?1 AND NOT EXISTS (SELECT 1 FROM hr_kontrak b WHERE b.status = 'Pembatalan' AND b.id_ref = k.id_kontrak) ORDER BY k.tanggal_mulai DESC, k.id_kontrak DESC LIMIT 1), g.status_kepegawaian, '') AS status FROM master_data m LEFT JOIN guru_data g ON g.id_guru = m.id_unik WHERE LOWER(TRIM(COALESCE(m.jenis_personil, ''))) <> 'siswa' AND NOT EXISTS (SELECT 1 FROM siswa_data sd WHERE sd.id_siswa = m.id_unik)\n-- batas: pegawai sekolah (guru dan tendik), dibatasi jumlah personil lembaga\n;";

/**
 * Cermin status kontrak terakhir ke `guru_data` (tanggal 9999-12-31, tidak
 * bergantung jam). Tanpa kontrak sah tersisa, `guru_data` tidak diubah
 * (keputusan A). ?1 = id pegawai.
 */
export const CERMIN_STATUS_SQL =
  "UPDATE guru_data SET status_kepegawaian = (SELECT k.status FROM hr_kontrak k WHERE k.id_karyawan = ?1 AND k.status <> 'Pembatalan' AND NOT EXISTS (SELECT 1 FROM hr_kontrak b WHERE b.status = 'Pembatalan' AND b.id_ref = k.id_kontrak) ORDER BY k.tanggal_mulai DESC, k.id_kontrak DESC LIMIT 1) WHERE id_guru = ?1 AND EXISTS (SELECT 1 FROM hr_kontrak k WHERE k.id_karyawan = ?1 AND k.status <> 'Pembatalan' AND NOT EXISTS (SELECT 1 FROM hr_kontrak b WHERE b.status = 'Pembatalan' AND b.id_ref = k.id_kontrak)) AND status_kepegawaian IS NOT (SELECT k.status FROM hr_kontrak k WHERE k.id_karyawan = ?1 AND k.status <> 'Pembatalan' AND NOT EXISTS (SELECT 1 FROM hr_kontrak b WHERE b.status = 'Pembatalan' AND b.id_ref = k.id_kontrak) ORDER BY k.tanggal_mulai DESC, k.id_kontrak DESC LIMIT 1);";

/** Guru (alias `g`) yang punya kontrak sah: isian status di form terkunci. */
export const BERKONTRAK_SQL =
  "EXISTS (SELECT 1 FROM hr_kontrak k WHERE k.id_karyawan = g.id_guru AND k.status <> 'Pembatalan' AND NOT EXISTS (SELECT 1 FROM hr_kontrak b WHERE b.status = 'Pembatalan' AND b.id_ref = k.id_kontrak))";

/** ?1 id, ?2 pegawai, ?3 status, ?4 id_ref, ?5 nomor, ?6 mulai, ?7 selesai, ?8 percobaan, ?9 catatan, ?10 pencatat. */
export const SIMPAN_KONTRAK_SQL =
  "INSERT OR IGNORE INTO hr_kontrak (id_kontrak, id_karyawan, status, id_ref, nomor, tanggal_mulai, tanggal_selesai, percobaan_selesai, catatan, dicatat_oleh, created_at) VALUES (?1, ?2, ?3, NULLIF(?4, ''), NULLIF(?5, ''), ?6, NULLIF(?7, ''), NULLIF(?8, ''), NULLIF(?9, ''), NULLIF(?10, ''), datetime('now'));";

export const KONTRAK_SQL =
  "SELECT id_kontrak, id_karyawan, status, COALESCE(id_ref, '') AS id_ref, COALESCE(nomor, '') AS nomor, tanggal_mulai, COALESCE(tanggal_selesai, '') AS tanggal_selesai, COALESCE(percobaan_selesai, '') AS percobaan_selesai, COALESCE(catatan, '') AS catatan, COALESCE(dicatat_oleh, '') AS dicatat_oleh, created_at FROM hr_kontrak ORDER BY id_karyawan, tanggal_mulai, id_kontrak\n-- batas: kontrak pegawai sekolah, beberapa baris per orang sepanjang masa kerja\n;";

export const PENGATURAN_KONTRAK_SQL =
  "SELECT key, value FROM setting_gex_system WHERE key IN ('hr_percobaan_maks_bulan', 'hr_pkwt_maks_bulan', 'hr_beban_min_jp', 'hr_beban_maks_jp')\n-- batas: empat kunci pengaturan\n;";

export const HARI_INI_SQL = "SELECT date('now', '+7 hours') AS hari_ini;";

/** ?1 id, ?2 nama, ?3 ekuivalen JP, ?4 aktif. */
export const SIMPAN_JENIS_TUGAS_SQL =
  "INSERT INTO hr_tugas_jenis (id_jenis, nama, ekuivalen_jp, is_aktif, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, datetime('now'), datetime('now')) ON CONFLICT(id_jenis) DO UPDATE SET nama = excluded.nama, ekuivalen_jp = excluded.ekuivalen_jp, is_aktif = excluded.is_aktif, updated_at = excluded.updated_at;";

export const BENTROK_JENIS_TUGAS_SQL =
  "SELECT 1 FROM hr_tugas_jenis WHERE id_jenis <> ?2 AND is_aktif = 1 AND lower(trim(nama)) = lower(trim(?1)) LIMIT 1;";

export const JENIS_TUGAS_SQL =
  "SELECT id_jenis, nama, ekuivalen_jp, is_aktif FROM hr_tugas_jenis ORDER BY nama, id_jenis\n-- batas: jenis tugas tambahan sekolah, tidak tumbuh per hari\n;";

/**
 * Upsert penuh tugas; baris yang sudah dibatalkan tidak berubah lagi.
 * ?1 id, ?2 pegawai, ?3 jenis, ?4 unit, ?5 tahun ajaran, ?6 rombel, ?7 nomor
 * SK, ?8 tanggal SK, ?9 ekuivalen, ?10 mulai, ?11 selesai, ?12 pencatat.
 */
export const SIMPAN_TUGAS_SQL =
  "INSERT INTO hr_tugas_tambahan (id_tugas, id_karyawan, id_jenis, unit, tahun_ajaran, id_rombel, nomor_sk, tanggal_sk, ekuivalen_jp, tanggal_mulai, tanggal_selesai, dicatat_oleh, created_at, updated_at) VALUES (?1, ?2, ?3, NULLIF(?4, ''), ?5, NULLIF(?6, ''), NULLIF(?7, ''), NULLIF(?8, ''), ?9, ?10, NULLIF(?11, ''), NULLIF(?12, ''), datetime('now'), datetime('now')) ON CONFLICT(id_tugas) DO UPDATE SET id_karyawan = excluded.id_karyawan, id_jenis = excluded.id_jenis, unit = excluded.unit, tahun_ajaran = excluded.tahun_ajaran, id_rombel = excluded.id_rombel, nomor_sk = excluded.nomor_sk, tanggal_sk = excluded.tanggal_sk, ekuivalen_jp = excluded.ekuivalen_jp, tanggal_mulai = excluded.tanggal_mulai, tanggal_selesai = excluded.tanggal_selesai, updated_at = excluded.updated_at WHERE hr_tugas_tambahan.dibatalkan_pada IS NULL;";

/** ?1 id, ?2 pembatal, ?3 alasan; hanya bila belum dibatalkan. */
export const BATAL_TUGAS_SQL =
  "UPDATE hr_tugas_tambahan SET dibatalkan_pada = datetime('now'), dibatalkan_oleh = ?2, alasan_batal = ?3, updated_at = datetime('now') WHERE id_tugas = ?1 AND dibatalkan_pada IS NULL;";

/**
 * Jenis tugas yang dipegang tiap pegawai pada periode [?1, ?2] (Q-29):
 * tugas tidak dibatalkan yang beririsan, ditambah wali kelas dari rombel aktif
 * yang semesternya beririsan. Baris berjenis wali kelas hanya pembawa nomor
 * SK, tidak memberi tugas sendiri.
 */
export const TUGAS_BERLAKU_SQL =
  "SELECT t.id_karyawan, t.id_jenis FROM hr_tugas_tambahan t WHERE t.dibatalkan_pada IS NULL AND t.id_jenis <> 'tgs-wali-kelas' AND t.tanggal_mulai <= ?2 AND (COALESCE(t.tanggal_selesai, '') = '' OR t.tanggal_selesai >= ?1) UNION SELECT r.id_wali_kelas, 'tgs-wali-kelas' FROM akademik_rombel r JOIN akademik_tahun_ajaran ta ON ta.id_tahun_ajaran = r.id_tahun_ajaran WHERE r.is_aktif = 1 AND COALESCE(r.id_wali_kelas, '') <> '' AND ta.tanggal_mulai <= ?2 AND ta.tanggal_selesai >= ?1 ORDER BY 1, 2\n-- batas: tugas tambahan pegawai sekolah pada satu periode gaji\n;";

export const TUGAS_SQL =
  "SELECT id_tugas, id_karyawan, id_jenis, COALESCE(unit, '') AS unit, tahun_ajaran, COALESCE(id_rombel, '') AS id_rombel, COALESCE(nomor_sk, '') AS nomor_sk, COALESCE(tanggal_sk, '') AS tanggal_sk, ekuivalen_jp, tanggal_mulai, COALESCE(tanggal_selesai, '') AS tanggal_selesai, COALESCE(dicatat_oleh, '') AS dicatat_oleh, COALESCE(dibatalkan_pada, '') AS dibatalkan_pada, COALESCE(dibatalkan_oleh, '') AS dibatalkan_oleh, COALESCE(alasan_batal, '') AS alasan_batal FROM hr_tugas_tambahan ORDER BY tahun_ajaran DESC, tanggal_mulai, id_tugas\n-- batas: tugas tambahan sekolah, beberapa per pegawai per tahun ajaran\n;";

export const WALI_KELAS_SQL =
  "SELECT r.id_rombel, r.nama_rombel, r.id_wali_kelas, ta.nama_tahun, ta.semester, ta.tanggal_mulai, ta.tanggal_selesai FROM akademik_rombel r JOIN akademik_tahun_ajaran ta ON ta.id_tahun_ajaran = r.id_tahun_ajaran WHERE r.is_aktif = 1 AND COALESCE(r.id_wali_kelas, '') <> '' ORDER BY ta.nama_tahun DESC, ta.semester, r.nama_rombel, r.id_rombel\n-- batas: rombel aktif sekolah, satu wali per rombel\n;";

export const TAHUN_AJARAN_SQL =
  "SELECT nama_tahun, MIN(tanggal_mulai) AS tanggal_mulai, MAX(tanggal_selesai) AS tanggal_selesai FROM akademik_tahun_ajaran GROUP BY nama_tahun ORDER BY nama_tahun DESC\n-- batas: tahun ajaran sekolah, satu per tahun\n;";

// ── HRIS 1c: data cloud-only (kembar `desktop/hris_cloud.rs`) ──
//
// Pribadi, keuangan, pendidik, dan dokumen hanya ada di database cloud
// (Q-31): tidak pernah masuk SQLite perangkat, snapshot, atau outbox.

export const AGAMA = [
  "Islam",
  "Kristen",
  "Katolik",
  "Hindu",
  "Buddha",
  "Konghucu",
  "Lainnya",
] as const;
export const STATUS_NIKAH = [
  "Belum Kawin",
  "Kawin",
  "Cerai Hidup",
  "Cerai Mati",
] as const;
export const JENJANG = [
  "SD",
  "SMP",
  "SMA/SMK",
  "D1",
  "D2",
  "D3",
  "D4",
  "S1",
  "S2",
  "S3",
] as const;
export const TEKS_MAKS = 100;
export const ALAMAT_MAKS = 500;
export const NAMA_BERKAS_MAKS = 180;
export const MAKS_BYTE_DOKUMEN = 1024 * 1024;
export const MAKS_BERKAS_DOKUMEN = 5;
export const MAKS_BASE64_DOKUMEN = Math.ceil(MAKS_BYTE_DOKUMEN / 3) * 4;

export const PESAN_LURING =
  "Data ini butuh koneksi ke database. Periksa jaringan, lalu coba lagi.";
export const PESAN_PEGAWAI_BELUM_DI_CLOUD =
  "Pegawai ini belum ada di database pusat. Sinkronkan perangkat, lalu coba lagi.";
export const PESAN_DOKUMEN_DITOLAK =
  "Pegawai belum ada di database pusat, atau jenis dokumennya tidak dikenal.";
export const PESAN_BERKAS_PENUH =
  "Dokumen tidak ditemukan, atau sudah berisi 5 berkas.";

const ATURAN_NOMOR: Record<string, [string, number, number]> = {
  nik: ["NIK", 16, 16],
  no_kk: ["Nomor KK", 16, 16],
  npwp: ["NPWP", 15, 16],
  nuptk: ["NUPTK", 16, 16],
  nrg: ["NRG", 12, 12],
  bpjs_kesehatan: ["Nomor BPJS Kesehatan", 5, 20],
  bpjs_ketenagakerjaan: ["Nomor BPJS Ketenagakerjaan", 5, 20],
  no_rekening: ["Nomor rekening", 5, 20],
};

/**
 * Nomor pengenal tanpa tanda baca dan spasi (§19.2.3); kosong = tidak diisi.
 * Cermin `nomor_identitas`.
 */
export function nomorIdentitas(jenis: string, teks: string): Hasil<string> {
  const aturan = ATURAN_NOMOR[jenis];
  if (!aturan) return { ok: false, galat: "Jenis nomor tidak dikenal." };
  const [label, min, maks] = aturan;
  const angka = [...teks].filter((c) => !/^[\s!-/:-@[-`{-~]$/.test(c)).join("");
  if (angka === "") return { ok: true, nilai: "" };
  if (!/^\d+$/.test(angka)) {
    return { ok: false, galat: `${label} hanya boleh berisi angka.` };
  }
  if (angka.length >= min && angka.length <= maks) {
    return { ok: true, nilai: angka };
  }
  const galat =
    min === maks
      ? `${label} harus ${min} digit.`
      : maks === min + 1
        ? `${label} harus ${min} atau ${maks} digit.`
        : `${label} harus ${min} sampai ${maks} digit.`;
  return { ok: false, galat };
}

class GalatIsian extends Error {}

function ambil<T>(hasil: Hasil<T>): T {
  if (!hasil.ok) throw new GalatIsian(hasil.galat);
  return hasil.nilai;
}

/** Urutan pemeriksaan sama dengan Rust: galat pertama yang dilaporkan. */
function periksa<T>(susun: () => T): Hasil<T> {
  try {
    return { ok: true, nilai: susun() };
  } catch (error) {
    if (error instanceof GalatIsian) return { ok: false, galat: error.message };
    throw error;
  }
}

function teksPendek(nilai: string, label: string, maks: number): string {
  const teks = nilai.trim();
  if (panjang(teks) > maks) {
    throw new GalatIsian(`${label} maksimal ${maks} karakter.`);
  }
  return teks;
}

function pilihan(nilai: string, daftar: readonly string[], galat: string) {
  const teks = nilai.trim();
  if (teks !== "" && !daftar.includes(teks)) throw new GalatIsian(galat);
  return teks;
}

function tanggalOpsional(nilai: string, galat: string): string {
  const teks = nilai.trim();
  if (teks !== "" && !tanggalValid(teks)) throw new GalatIsian(galat);
  return teks;
}

function tahunOpsional(tahun: number | null, galat: string): number | null {
  if (tahun !== null && (tahun < 1950 || tahun > 2100)) {
    throw new GalatIsian(galat);
  }
  return tahun;
}

export interface Pribadi {
  nik: string;
  no_kk: string;
  tempat_lahir: string;
  tanggal_lahir: string;
  agama: string;
  status_nikah: string;
  nama_ibu_kandung: string;
  alamat_ktp: string;
  alamat_domisili: string;
  darurat_nama: string;
  darurat_hubungan: string;
  darurat_hp: string;
}

export function validasiPribadi(p: Pribadi): Hasil<Pribadi> {
  return periksa(() => {
    const hp = p.darurat_hp.trim();
    // Bentuk kanonik `+62…` seperti kontak operator.
    const darurat_hp = hp === "" ? "" : normalizeOperatorPhone(hp);
    if (
      hp !== "" &&
      (!darurat_hp.startsWith("+") ||
        darurat_hp.length - 1 < 9 ||
        darurat_hp.length - 1 > 15)
    ) {
      throw new GalatIsian("Nomor HP darurat tidak valid.");
    }
    return {
      nik: ambil(nomorIdentitas("nik", p.nik)),
      no_kk: ambil(nomorIdentitas("no_kk", p.no_kk)),
      tempat_lahir: teksPendek(p.tempat_lahir, "Tempat lahir", TEKS_MAKS),
      tanggal_lahir: tanggalOpsional(
        p.tanggal_lahir,
        "Tanggal lahir tidak valid.",
      ),
      agama: pilihan(p.agama, AGAMA, "Agama tidak dikenal."),
      status_nikah: pilihan(
        p.status_nikah,
        STATUS_NIKAH,
        "Status pernikahan tidak dikenal.",
      ),
      nama_ibu_kandung: teksPendek(
        p.nama_ibu_kandung,
        "Nama ibu kandung",
        TEKS_MAKS,
      ),
      alamat_ktp: teksPendek(p.alamat_ktp, "Alamat KTP", ALAMAT_MAKS),
      alamat_domisili: teksPendek(
        p.alamat_domisili,
        "Alamat domisili",
        ALAMAT_MAKS,
      ),
      darurat_nama: teksPendek(
        p.darurat_nama,
        "Nama kontak darurat",
        TEKS_MAKS,
      ),
      darurat_hubungan: teksPendek(
        p.darurat_hubungan,
        "Hubungan kontak darurat",
        TEKS_MAKS,
      ),
      darurat_hp,
    };
  });
}

export interface Keuangan {
  bank: string;
  no_rekening: string;
  nama_rekening: string;
  npwp: string;
  bpjs_kesehatan: string;
  bpjs_ketenagakerjaan: string;
}

export function validasiKeuangan(k: Keuangan): Hasil<Keuangan> {
  return periksa(() => ({
    bank: teksPendek(k.bank, "Nama bank", TEKS_MAKS),
    no_rekening: ambil(nomorIdentitas("no_rekening", k.no_rekening)),
    nama_rekening: teksPendek(
      k.nama_rekening,
      "Nama pemilik rekening",
      TEKS_MAKS,
    ),
    npwp: ambil(nomorIdentitas("npwp", k.npwp)),
    bpjs_kesehatan: ambil(nomorIdentitas("bpjs_kesehatan", k.bpjs_kesehatan)),
    bpjs_ketenagakerjaan: ambil(
      nomorIdentitas("bpjs_ketenagakerjaan", k.bpjs_ketenagakerjaan),
    ),
  }));
}

export interface Pendidikan {
  jenjang: string;
  prodi: string;
  perguruan_tinggi: string;
  tahun_lulus: number | null;
  linier: number;
  catatan: string;
}

export function validasiPendidikan(p: Pendidikan): Hasil<Pendidikan> {
  return periksa(() => {
    const jenjang = p.jenjang.trim();
    if (!(JENJANG as readonly string[]).includes(jenjang)) {
      throw new GalatIsian("Jenjang pendidikan tidak dikenal.");
    }
    if (p.linier !== 0 && p.linier !== 1) {
      throw new GalatIsian("Tanda linier tidak valid.");
    }
    return {
      jenjang,
      prodi: teksPendek(p.prodi, "Program studi", 150),
      perguruan_tinggi: teksPendek(
        p.perguruan_tinggi,
        "Nama sekolah/perguruan tinggi",
        150,
      ),
      tahun_lulus: tahunOpsional(p.tahun_lulus, "Tahun lulus tidak valid."),
      linier: p.linier,
      catatan: teksPendek(p.catatan, "Catatan", CATATAN_MAKS),
    };
  });
}

export interface Sertifikasi {
  nomor_sertifikat: string;
  nrg: string;
  tahun: number | null;
  bidang_studi: string;
  catatan: string;
}

export function validasiSertifikasi(s: Sertifikasi): Hasil<Sertifikasi> {
  return periksa(() => {
    const hasil = {
      nomor_sertifikat: teksPendek(
        s.nomor_sertifikat,
        "Nomor sertifikat",
        NOMOR_MAKS,
      ),
      nrg: ambil(nomorIdentitas("nrg", s.nrg)),
      tahun: tahunOpsional(s.tahun, "Tahun sertifikat tidak valid."),
      bidang_studi: teksPendek(s.bidang_studi, "Bidang studi", 150),
      catatan: teksPendek(s.catatan, "Catatan", CATATAN_MAKS),
    };
    if (hasil.nomor_sertifikat === "" && hasil.nrg === "") {
      throw new GalatIsian("Isi nomor sertifikat atau NRG.");
    }
    if (hasil.bidang_studi === "") {
      throw new GalatIsian("Bidang studi sertifikat wajib diisi.");
    }
    return hasil;
  });
}

export interface Dokumen {
  id_jenis: string;
  nomor: string;
  tanggal_terbit: string;
  tanggal_kedaluwarsa: string;
  catatan: string;
}

/** Keputusan 1c B: jenis dan tanggal terbit wajib, nomor opsional. */
export function validasiDokumen(d: Dokumen): Hasil<Dokumen> {
  return periksa(() => {
    const id_jenis = d.id_jenis.trim();
    if (id_jenis === "") throw new GalatIsian("Jenis dokumen wajib dipilih.");
    const tanggal_terbit = d.tanggal_terbit.trim();
    if (!tanggalValid(tanggal_terbit)) {
      throw new GalatIsian("Tanggal terbit tidak valid.");
    }
    const tanggal_kedaluwarsa = tanggalOpsional(
      d.tanggal_kedaluwarsa,
      "Tanggal kedaluwarsa tidak valid.",
    );
    if (tanggal_kedaluwarsa !== "" && tanggal_kedaluwarsa < tanggal_terbit) {
      throw new GalatIsian(
        "Tanggal kedaluwarsa tidak boleh sebelum tanggal terbit.",
      );
    }
    return {
      id_jenis,
      nomor: teksPendek(d.nomor, "Nomor dokumen", NOMOR_MAKS),
      tanggal_terbit,
      tanggal_kedaluwarsa,
      catatan: teksPendek(d.catatan, "Catatan", CATATAN_MAKS),
    };
  });
}

export interface BerkasDokumen {
  nama_berkas: string;
  mime_type: MimeBerkasSekolah;
  data_base64: string;
  ukuran_byte: number;
}

/** Cermin `urai_berkas_dokumen`: 1 MB, empat MIME, tanda tangan bita (§19.2.5). */
export function uraiBerkasDokumen(
  namaBerkas: string,
  mimeType: string,
  dataBase64: string,
): Hasil<BerkasDokumen> {
  const nama = namaBerkas.trim();
  if (nama === "") return { ok: false, galat: "Nama berkas wajib diisi." };
  if (panjang(nama) > NAMA_BERKAS_MAKS) {
    return {
      ok: false,
      galat: `Nama berkas maksimal ${NAMA_BERKAS_MAKS} karakter.`,
    };
  }
  const mime = MIME_BERKAS_SEKOLAH.find((m) => m === mimeType);
  if (!mime) {
    return {
      ok: false,
      galat: "Berkas harus berupa JPG, PNG, WEBP, atau PDF.",
    };
  }
  const isi = dataBase64.trim();
  const ukuran = /^[A-Za-z0-9+/]*={0,2}$/.test(isi) ? ukuranBase64(isi) : -1;
  if (ukuran <= 0) return { ok: false, galat: "Berkas tidak terbaca." };
  if (ukuran > MAKS_BYTE_DOKUMEN) {
    return { ok: false, galat: "Berkas lebih dari 1 MB." };
  }
  if (!tandaTanganCocok(mime, isi)) {
    return { ok: false, galat: "Isi berkas tidak sesuai formatnya." };
  }
  return {
    ok: true,
    nilai: {
      nama_berkas: nama,
      mime_type: mime,
      data_base64: isi,
      ukuran_byte: ukuran,
    },
  };
}

/** Kelompok profil yang boleh dibaca, dari izin SESI (bukan payload). */
export interface KelompokProfil {
  pribadi: boolean;
  keuangan: boolean;
  pendidik: boolean;
}

export function kelompokProfil(subjek: AccessSubject): KelompokProfil {
  return {
    pribadi: hasPermission(subjek, "hr.personal.view"),
    keuangan: hasPermission(subjek, "hr.finance.view"),
    pendidik: hasPermission(subjek, "teachers.view"),
  };
}

/**
 * Jenis dokumen saja (tanpa pegawai) boleh dibaca pengelola organisasi
 * (keputusan 1c A); dokumen seorang pegawai tetap butuh `hr.document.view`.
 */
export function bolehBacaDokumen(subjek: AccessSubject, idKaryawan: string) {
  return (
    hasPermission(subjek, "hr.document.view") ||
    (idKaryawan.trim() === "" && hasPermission(subjek, "hr.org.manage"))
  );
}

// Skema rute 1c

const isianTeks = (maks: number) => z.string().max(maks).optional().default("");

export const pribadiDraftSchema = z
  .object({
    id_karyawan: z.string().trim().min(1).max(80),
    nik: isianTeks(60),
    no_kk: isianTeks(60),
    tempat_lahir: isianTeks(300),
    tanggal_lahir: isianTeks(20),
    agama: isianTeks(40),
    status_nikah: isianTeks(40),
    nama_ibu_kandung: isianTeks(300),
    alamat_ktp: isianTeks(1000),
    alamat_domisili: isianTeks(1000),
    darurat_nama: isianTeks(300),
    darurat_hubungan: isianTeks(300),
    darurat_hp: isianTeks(40),
  })
  .strict();
export type PribadiDraft = z.input<typeof pribadiDraftSchema>;

export const keuanganDraftSchema = z
  .object({
    id_karyawan: z.string().trim().min(1).max(80),
    bank: isianTeks(300),
    no_rekening: isianTeks(60),
    nama_rekening: isianTeks(300),
    npwp: isianTeks(60),
    bpjs_kesehatan: isianTeks(60),
    bpjs_ketenagakerjaan: isianTeks(60),
  })
  .strict();
export type KeuanganDraft = z.input<typeof keuanganDraftSchema>;

const idOpsional = z.string().trim().max(80).optional();
const pemilik = z.string().trim().min(1).max(80);
const tahun = z.number().int().nullable().default(null);

export const pendidikanDraftSchema = z
  .object({
    id: idOpsional,
    id_karyawan: pemilik,
    jenjang: z.string().max(20),
    prodi: isianTeks(400),
    perguruan_tinggi: isianTeks(400),
    tahun_lulus: tahun,
    linier: z.number().int().default(0),
    catatan: isianTeks(1000),
  })
  .strict();
export type PendidikanDraft = z.input<typeof pendidikanDraftSchema>;

export const sertifikasiDraftSchema = z
  .object({
    id: idOpsional,
    id_karyawan: pemilik,
    nomor_sertifikat: isianTeks(200),
    nrg: isianTeks(60),
    tahun,
    bidang_studi: isianTeks(400),
    catatan: isianTeks(1000),
  })
  .strict();
export type SertifikasiDraft = z.input<typeof sertifikasiDraftSchema>;

export const dokumenDraftSchema = z
  .object({
    id: idOpsional,
    id_karyawan: pemilik,
    id_jenis: z.string().max(80),
    nomor: isianTeks(200),
    tanggal_terbit: z.string().max(20),
    tanggal_kedaluwarsa: isianTeks(20),
    catatan: isianTeks(1000),
  })
  .strict();
export type DokumenDraft = z.input<typeof dokumenDraftSchema>;

export const berkasDokumenSchema = z
  .object({
    id_dokumen: pemilik,
    nama_berkas: z.string().max(400),
    mime_type: z.string().max(40),
    data_base64: z
      .string()
      .max(MAKS_BASE64_DOKUMEN + 8, "Berkas lebih dari 1 MB."),
  })
  .strict();
export type BerkasDokumenDraft = z.input<typeof berkasDokumenSchema>;

export const jenisDokumenDraftSchema = z
  .object({
    id: idOpsional,
    nama: z.string().max(200),
    is_aktif: z.union([z.literal(0), z.literal(1)]).default(1),
  })
  .strict();
export type JenisDokumenDraft = z.input<typeof jenisDokumenDraftSchema>;

export const idSchema = z.object({ id: pemilik }).strict();

export const lampiranQuerySchema = z.object({ id_pengajuan: pemilik }).strict();

export const lampiranSchema = z
  .object({
    id_pengajuan: pemilik,
    nama_berkas: z.string().max(400),
    mime_type: z.string().max(40),
    data_base64: z
      .string()
      .max(MAKS_BASE64_DOKUMEN + 8, "Berkas lebih dari 1 MB."),
  })
  .strict();
export type LampiranDraft = z.input<typeof lampiranSchema>;

export interface BarisLampiran {
  id_berkas: string;
  urutan: number;
  nama_berkas: string;
  mime_type: string;
  ukuran_byte: number;
  diunggah_oleh: string;
  created_at: string;
}

/** Jawaban `desktop_hr_request_files` / `POST /api/pengajuan/files/query`. */
export interface DaftarLampiran {
  /** Pengajuan sudah sampai di database pusat. */
  ada: boolean;
  boleh_ubah: boolean;
  tanda: string[];
  berkas: BarisLampiran[];
}

// Bentuk kembalian command/rute 1c

export interface Jejak {
  diubah_oleh: string;
  diubah_pada: string;
}

export interface PendidikanBaris extends Pendidikan {
  id_pendidikan: string;
  dicatat_oleh: string;
  updated_at: string;
}

export interface SertifikasiBaris extends Sertifikasi {
  id_sertifikasi: string;
  dicatat_oleh: string;
  updated_at: string;
}

/** Kunci absen = izinnya tidak dipegang; `null` = belum pernah diisi. */
export interface ProfilPegawai {
  id_karyawan: string;
  pribadi?: (Pribadi & Jejak) | null;
  keuangan?: (Keuangan & Jejak) | null;
  pendidik?: {
    pendidikan: PendidikanBaris[];
    sertifikasi: SertifikasiBaris[];
  };
}

export interface JenisDokumen {
  id_jenis: string;
  nama: string;
  is_aktif: number;
}

export interface DokumenBaris extends Dokumen {
  id_dokumen: string;
  jenis: string;
  dicatat_oleh: string;
  updated_at: string;
}

export interface BerkasDokumenBaris {
  id_berkas: string;
  id_dokumen: string;
  urutan: number;
  nama_berkas: string;
  mime_type: string;
  ukuran_byte: number;
}

export interface DaftarDokumen {
  jenis: JenisDokumen[];
  dokumen?: DokumenBaris[];
  berkas?: BerkasDokumenBaris[];
}

export interface IsiBerkasDokumen {
  id_berkas: string;
  id_dokumen: string;
  nama_berkas: string;
  mime_type: string;
  data_base64: string;
}

export interface BarisPtk {
  id_unik: string;
  nama: string;
  nip: string;
  nuptk: string;
  unit: string;
  bagian: string;
  jabatan: string;
  tmt: string;
  kelompok: "Guru" | "Tendik";
  jenjang: string;
  prodi: string;
  perguruan_tinggi: string;
  linier: number;
  sertifikat_bidang: string;
  sertifikat_tahun: number | null;
  nrg: string;
  mapel: string;
  status: string;
}

export interface LaporanPtk {
  hari_ini: string;
  baris: BarisPtk[];
}

export interface RingkasPtk {
  unit: string;
  guru: number;
  tendik: number;
  guru_s1: number;
  guru_sertifikat: number;
  persen_s1: number;
  persen_sertifikat: number;
}

const S1_KE_ATAS = new Set(["D4", "S1", "S2", "S3"]);

/**
 * Ringkasan Laporan PTK per unit (§19.2.7). Persentase dihitung atas GURU:
 * kualifikasi S1/D4 dan sertifikat pendidik adalah syarat guru, bukan tendik.
 */
export function ringkasPtk(baris: readonly BarisPtk[]): {
  per_unit: RingkasPtk[];
  total: RingkasPtk;
} {
  const kosong = (unit: string): RingkasPtk => ({
    unit,
    guru: 0,
    tendik: 0,
    guru_s1: 0,
    guru_sertifikat: 0,
    persen_s1: 0,
    persen_sertifikat: 0,
  });
  const peta = new Map<string, RingkasPtk>();
  const total = kosong("Semua unit");
  for (const b of baris) {
    const unit = peta.get(b.unit) ?? kosong(b.unit);
    peta.set(b.unit, unit);
    for (const r of [unit, total]) {
      if (b.kelompok === "Tendik") {
        r.tendik++;
        continue;
      }
      r.guru++;
      if (S1_KE_ATAS.has(b.jenjang)) r.guru_s1++;
      if (b.sertifikat_bidang !== "" || b.nrg !== "") r.guru_sertifikat++;
    }
  }
  const persen = (x: number, n: number) =>
    n === 0 ? 0 : Math.round((x * 1000) / n) / 10;
  const selesai = (r: RingkasPtk) => ({
    ...r,
    persen_s1: persen(r.guru_s1, r.guru),
    persen_sertifikat: persen(r.guru_sertifikat, r.guru),
  });
  return {
    per_unit: [...peta.values()]
      .sort((a, b) => a.unit.localeCompare(b.unit))
      .map(selesai),
    total: selesai(total),
  };
}

// SQL 1c (harfiah sama dengan hris_cloud.rs)

export const PROFIL_PRIBADI_SQL =
  "SELECT COALESCE(nik, '') AS nik, COALESCE(no_kk, '') AS no_kk, COALESCE(tempat_lahir, '') AS tempat_lahir, COALESCE(tanggal_lahir, '') AS tanggal_lahir, COALESCE(agama, '') AS agama, COALESCE(status_nikah, '') AS status_nikah, COALESCE(nama_ibu_kandung, '') AS nama_ibu_kandung, COALESCE(alamat_ktp, '') AS alamat_ktp, COALESCE(alamat_domisili, '') AS alamat_domisili, COALESCE(darurat_nama, '') AS darurat_nama, COALESCE(darurat_hubungan, '') AS darurat_hubungan, COALESCE(darurat_hp, '') AS darurat_hp, COALESCE(pribadi_diubah_oleh, '') AS diubah_oleh, COALESCE(pribadi_diubah_pada, '') AS diubah_pada FROM hr_profil WHERE id_karyawan = ?1 LIMIT 1;";

export const PROFIL_KEUANGAN_SQL =
  "SELECT COALESCE(bank, '') AS bank, COALESCE(no_rekening, '') AS no_rekening, COALESCE(nama_rekening, '') AS nama_rekening, COALESCE(npwp, '') AS npwp, COALESCE(bpjs_kesehatan, '') AS bpjs_kesehatan, COALESCE(bpjs_ketenagakerjaan, '') AS bpjs_ketenagakerjaan, COALESCE(keuangan_diubah_oleh, '') AS diubah_oleh, COALESCE(keuangan_diubah_pada, '') AS diubah_pada FROM hr_profil WHERE id_karyawan = ?1 LIMIT 1;";

export const SIMPAN_PRIBADI_SQL =
  "INSERT INTO hr_profil (id_karyawan, nik, no_kk, tempat_lahir, tanggal_lahir, agama, status_nikah, nama_ibu_kandung, alamat_ktp, alamat_domisili, darurat_nama, darurat_hubungan, darurat_hp, pribadi_diubah_oleh, pribadi_diubah_pada) SELECT ?1, NULLIF(?2, ''), NULLIF(?3, ''), NULLIF(?4, ''), NULLIF(?5, ''), NULLIF(?6, ''), NULLIF(?7, ''), NULLIF(?8, ''), NULLIF(?9, ''), NULLIF(?10, ''), NULLIF(?11, ''), NULLIF(?12, ''), NULLIF(?13, ''), ?14, datetime('now') FROM master_data m WHERE m.id_unik = ?1 AND LOWER(TRIM(COALESCE(m.jenis_personil, ''))) <> 'siswa' AND NOT EXISTS (SELECT 1 FROM siswa_data sd WHERE sd.id_siswa = m.id_unik) ON CONFLICT(id_karyawan) DO UPDATE SET nik = excluded.nik, no_kk = excluded.no_kk, tempat_lahir = excluded.tempat_lahir, tanggal_lahir = excluded.tanggal_lahir, agama = excluded.agama, status_nikah = excluded.status_nikah, nama_ibu_kandung = excluded.nama_ibu_kandung, alamat_ktp = excluded.alamat_ktp, alamat_domisili = excluded.alamat_domisili, darurat_nama = excluded.darurat_nama, darurat_hubungan = excluded.darurat_hubungan, darurat_hp = excluded.darurat_hp, pribadi_diubah_oleh = excluded.pribadi_diubah_oleh, pribadi_diubah_pada = excluded.pribadi_diubah_pada;";

export const SIMPAN_KEUANGAN_SQL =
  "INSERT INTO hr_profil (id_karyawan, bank, no_rekening, nama_rekening, npwp, bpjs_kesehatan, bpjs_ketenagakerjaan, keuangan_diubah_oleh, keuangan_diubah_pada) SELECT ?1, NULLIF(?2, ''), NULLIF(?3, ''), NULLIF(?4, ''), NULLIF(?5, ''), NULLIF(?6, ''), NULLIF(?7, ''), ?8, datetime('now') FROM master_data m WHERE m.id_unik = ?1 AND LOWER(TRIM(COALESCE(m.jenis_personil, ''))) <> 'siswa' AND NOT EXISTS (SELECT 1 FROM siswa_data sd WHERE sd.id_siswa = m.id_unik) ON CONFLICT(id_karyawan) DO UPDATE SET bank = excluded.bank, no_rekening = excluded.no_rekening, nama_rekening = excluded.nama_rekening, npwp = excluded.npwp, bpjs_kesehatan = excluded.bpjs_kesehatan, bpjs_ketenagakerjaan = excluded.bpjs_ketenagakerjaan, keuangan_diubah_oleh = excluded.keuangan_diubah_oleh, keuangan_diubah_pada = excluded.keuangan_diubah_pada;";

export const PENDIDIKAN_SQL =
  "SELECT id_pendidikan, jenjang, COALESCE(prodi, '') AS prodi, COALESCE(perguruan_tinggi, '') AS perguruan_tinggi, tahun_lulus, linier, COALESCE(catatan, '') AS catatan, COALESCE(dicatat_oleh, '') AS dicatat_oleh, updated_at FROM hr_pendidikan WHERE id_karyawan = ?1 ORDER BY COALESCE(tahun_lulus, 0) DESC, id_pendidikan\n-- batas: riwayat pendidikan satu pegawai\n;";

export const SERTIFIKASI_SQL =
  "SELECT id_sertifikasi, COALESCE(nomor_sertifikat, '') AS nomor_sertifikat, COALESCE(nrg, '') AS nrg, tahun, COALESCE(bidang_studi, '') AS bidang_studi, COALESCE(catatan, '') AS catatan, COALESCE(dicatat_oleh, '') AS dicatat_oleh, updated_at FROM hr_sertifikasi WHERE id_karyawan = ?1 ORDER BY COALESCE(tahun, 0) DESC, id_sertifikasi\n-- batas: sertifikat pendidik satu pegawai\n;";

export const SIMPAN_PENDIDIKAN_SQL =
  "INSERT INTO hr_pendidikan (id_pendidikan, id_karyawan, jenjang, prodi, perguruan_tinggi, tahun_lulus, linier, catatan, dicatat_oleh, created_at, updated_at) SELECT ?1, ?2, ?3, NULLIF(?4, ''), NULLIF(?5, ''), ?6, ?7, NULLIF(?8, ''), ?9, datetime('now'), datetime('now') FROM master_data m WHERE m.id_unik = ?2 AND LOWER(TRIM(COALESCE(m.jenis_personil, ''))) <> 'siswa' AND NOT EXISTS (SELECT 1 FROM siswa_data sd WHERE sd.id_siswa = m.id_unik) ON CONFLICT(id_pendidikan) DO UPDATE SET jenjang = excluded.jenjang, prodi = excluded.prodi, perguruan_tinggi = excluded.perguruan_tinggi, tahun_lulus = excluded.tahun_lulus, linier = excluded.linier, catatan = excluded.catatan, updated_at = excluded.updated_at WHERE hr_pendidikan.id_karyawan = excluded.id_karyawan;";

export const HAPUS_PENDIDIKAN_SQL =
  "DELETE FROM hr_pendidikan WHERE id_pendidikan = ?1;";

export const SIMPAN_SERTIFIKASI_SQL =
  "INSERT INTO hr_sertifikasi (id_sertifikasi, id_karyawan, nomor_sertifikat, nrg, tahun, bidang_studi, catatan, dicatat_oleh, created_at, updated_at) SELECT ?1, ?2, NULLIF(?3, ''), NULLIF(?4, ''), ?5, ?6, NULLIF(?7, ''), ?8, datetime('now'), datetime('now') FROM master_data m WHERE m.id_unik = ?2 AND LOWER(TRIM(COALESCE(m.jenis_personil, ''))) <> 'siswa' AND NOT EXISTS (SELECT 1 FROM siswa_data sd WHERE sd.id_siswa = m.id_unik) ON CONFLICT(id_sertifikasi) DO UPDATE SET nomor_sertifikat = excluded.nomor_sertifikat, nrg = excluded.nrg, tahun = excluded.tahun, bidang_studi = excluded.bidang_studi, catatan = excluded.catatan, updated_at = excluded.updated_at WHERE hr_sertifikasi.id_karyawan = excluded.id_karyawan;";

export const HAPUS_SERTIFIKASI_SQL =
  "DELETE FROM hr_sertifikasi WHERE id_sertifikasi = ?1;";

export const JENIS_DOKUMEN_SQL =
  "SELECT id_jenis, nama, is_aktif FROM hr_dokumen_jenis ORDER BY nama, id_jenis\n-- batas: jenis dokumen kepegawaian, tidak tumbuh per hari\n;";

export const SIMPAN_JENIS_DOKUMEN_SQL =
  "INSERT INTO hr_dokumen_jenis (id_jenis, nama, is_aktif, created_at, updated_at) VALUES (?1, ?2, ?3, datetime('now'), datetime('now')) ON CONFLICT(id_jenis) DO UPDATE SET nama = excluded.nama, is_aktif = excluded.is_aktif, updated_at = excluded.updated_at;";

export const BENTROK_JENIS_DOKUMEN_SQL =
  "SELECT 1 FROM hr_dokumen_jenis WHERE id_jenis <> ?2 AND is_aktif = 1 AND lower(trim(nama)) = lower(trim(?1)) LIMIT 1;";

export const DOKUMEN_SQL =
  "SELECT d.id_dokumen, d.id_jenis, COALESCE(j.nama, d.id_jenis) AS jenis, COALESCE(d.nomor, '') AS nomor, COALESCE(d.tanggal_terbit, '') AS tanggal_terbit, COALESCE(d.tanggal_kedaluwarsa, '') AS tanggal_kedaluwarsa, COALESCE(d.catatan, '') AS catatan, COALESCE(d.dicatat_oleh, '') AS dicatat_oleh, d.updated_at FROM hr_dokumen d LEFT JOIN hr_dokumen_jenis j ON j.id_jenis = d.id_jenis WHERE d.id_karyawan = ?1 ORDER BY d.tanggal_terbit DESC, d.id_dokumen\n-- batas: dokumen satu pegawai\n;";

export const BERKAS_DOKUMEN_SQL =
  "SELECT b.id_berkas, b.id_dokumen, b.urutan, COALESCE(b.nama_berkas, '') AS nama_berkas, b.mime_type, (length(b.data_base64) / 4) * 3 - (CASE WHEN b.data_base64 LIKE '%==' THEN 2 WHEN b.data_base64 LIKE '%=' THEN 1 ELSE 0 END) AS ukuran_byte FROM hr_dokumen_berkas b JOIN hr_dokumen d ON d.id_dokumen = b.id_dokumen WHERE d.id_karyawan = ?1 ORDER BY b.id_dokumen, b.urutan\n-- batas: berkas dokumen satu pegawai, maksimal 5 per dokumen\n;";

export const AMBIL_BERKAS_SQL =
  "SELECT id_berkas, id_dokumen, COALESCE(nama_berkas, '') AS nama_berkas, mime_type, data_base64 FROM hr_dokumen_berkas WHERE id_berkas = ?1 LIMIT 1;";

export const SIMPAN_DOKUMEN_SQL =
  "INSERT INTO hr_dokumen (id_dokumen, id_karyawan, id_jenis, nomor, tanggal_terbit, tanggal_kedaluwarsa, catatan, dicatat_oleh, created_at, updated_at) SELECT ?1, ?2, ?3, NULLIF(?4, ''), ?5, NULLIF(?6, ''), NULLIF(?7, ''), ?8, datetime('now'), datetime('now') FROM master_data m WHERE m.id_unik = ?2 AND LOWER(TRIM(COALESCE(m.jenis_personil, ''))) <> 'siswa' AND NOT EXISTS (SELECT 1 FROM siswa_data sd WHERE sd.id_siswa = m.id_unik) AND EXISTS (SELECT 1 FROM hr_dokumen_jenis WHERE id_jenis = ?3) ON CONFLICT(id_dokumen) DO UPDATE SET id_jenis = excluded.id_jenis, nomor = excluded.nomor, tanggal_terbit = excluded.tanggal_terbit, tanggal_kedaluwarsa = excluded.tanggal_kedaluwarsa, catatan = excluded.catatan, updated_at = excluded.updated_at WHERE hr_dokumen.id_karyawan = excluded.id_karyawan;";

export const TAMBAH_BERKAS_SQL =
  "WITH slot(n) AS (VALUES (1), (2), (3), (4), (5)) INSERT INTO hr_dokumen_berkas (id_berkas, id_dokumen, urutan, nama_berkas, mime_type, data_base64, created_at) SELECT ?1, ?2, MIN(slot.n), ?3, ?4, ?5, datetime('now') FROM slot WHERE slot.n NOT IN (SELECT urutan FROM hr_dokumen_berkas WHERE id_dokumen = ?2) AND EXISTS (SELECT 1 FROM hr_dokumen WHERE id_dokumen = ?2) HAVING MIN(slot.n) IS NOT NULL;";

export const HAPUS_BERKAS_SQL =
  "DELETE FROM hr_dokumen_berkas WHERE id_berkas = ?1;";

// Lampiran pengajuan (HRIS Fase 2 §20.3, Q-51), cermin `hris_cloud.rs`.
export const PENGAJUAN_LAMPIRAN_SQL =
  "SELECT p.diajukan_oleh, p.izin_pemutus, COALESCE(j.wajib_dokumen, 0) AS wajib_dokumen FROM hr_pengajuan p LEFT JOIN hr_jenis_pengajuan j ON j.id_jenis = p.id_jenis WHERE p.id_pengajuan = ?1 LIMIT 1;";
export const LAMPIRAN_SQL =
  "SELECT id_berkas, urutan, COALESCE(nama_berkas, '') AS nama_berkas, mime_type, (length(data_base64) / 4) * 3 - (CASE WHEN data_base64 LIKE '%==' THEN 2 WHEN data_base64 LIKE '%=' THEN 1 ELSE 0 END) AS ukuran_byte, COALESCE(diunggah_oleh, '') AS diunggah_oleh, created_at FROM hr_pengajuan_berkas WHERE id_pengajuan = ?1 ORDER BY urutan\n-- batas: lampiran satu pengajuan, maksimal 5\n;";
export const AMBIL_LAMPIRAN_SQL =
  "SELECT id_berkas, id_pengajuan, COALESCE(nama_berkas, '') AS nama_berkas, mime_type, data_base64 FROM hr_pengajuan_berkas WHERE id_berkas = ?1 LIMIT 1;";
export const PEMILIK_LAMPIRAN_SQL =
  "SELECT p.diajukan_oleh, p.izin_pemutus FROM hr_pengajuan_berkas b JOIN hr_pengajuan p ON p.id_pengajuan = b.id_pengajuan WHERE b.id_berkas = ?1 LIMIT 1;";
export const TAMBAH_LAMPIRAN_SQL =
  "WITH slot(n) AS (VALUES (1), (2), (3), (4), (5)) INSERT INTO hr_pengajuan_berkas (id_berkas, id_pengajuan, urutan, nama_berkas, mime_type, data_base64, diunggah_oleh, created_at) SELECT ?1, ?2, MIN(slot.n), ?3, ?4, ?5, ?6, datetime('now') FROM slot WHERE slot.n NOT IN (SELECT urutan FROM hr_pengajuan_berkas WHERE id_pengajuan = ?2) AND EXISTS (SELECT 1 FROM hr_pengajuan WHERE id_pengajuan = ?2) HAVING MIN(slot.n) IS NOT NULL;";
export const HAPUS_LAMPIRAN_SQL =
  "DELETE FROM hr_pengajuan_berkas WHERE id_berkas = ?1;";

export const PESAN_PENGAJUAN_BELUM_DI_CLOUD =
  "Pengajuan ini belum sampai di database pusat. Sinkronkan perangkat, lalu coba lagi.";
export const PESAN_LAMPIRAN_PENUH = "Pengajuan ini sudah berisi 5 lampiran.";
export const PESAN_LAMPIRAN_DITOLAK =
  "Hanya pengaju atau pemutus jenis pengajuan ini yang bisa mengubah lampirannya.";

/** Cermin `tanda_lampiran` (Q-51): tanda, bukan penolakan. */
export function tandaLampiran(wajibDokumen: boolean, jumlah: number): string[] {
  return wajibDokumen && jumlah === 0 ? ["tanpa_dokumen"] : [];
}

export const PTK_SQL =
  "SELECT m.id_unik, m.nama, COALESCE(g.nip, '') AS nip, COALESCE(g.nuptk, '') AS nuptk, COALESCE(m.unit, '') AS unit, COALESCE(m.divisi, '') AS bagian, COALESCE(m.jabatan_status, '') AS jabatan, COALESCE(m.tanggal_mulai_aktif, '') AS tmt, CASE WHEN g.id_guru IS NOT NULL OR LOWER(TRIM(COALESCE(m.jenis_personil, ''))) = 'guru' THEN 'Guru' ELSE 'Tendik' END AS kelompok, COALESCE(p.jenjang, '') AS jenjang, COALESCE(p.prodi, '') AS prodi, COALESCE(p.perguruan_tinggi, '') AS perguruan_tinggi, COALESCE(p.linier, 0) AS linier, COALESCE(s.bidang_studi, '') AS sertifikat_bidang, s.tahun AS sertifikat_tahun, COALESCE(s.nrg, '') AS nrg, COALESCE((SELECT group_concat(nama_mapel, ', ') FROM (SELECT DISTINCT mp.nama_mapel FROM jadwal_mengajar j JOIN akademik_mapel mp ON mp.id_mapel = j.id_mapel JOIN akademik_tahun_ajaran ta ON ta.id_tahun_ajaran = j.id_tahun_ajaran WHERE j.id_guru = m.id_unik AND j.is_aktif = 1 AND ta.is_aktif = 1 ORDER BY mp.nama_mapel)), '') AS mapel FROM master_data m LEFT JOIN guru_data g ON g.id_guru = m.id_unik LEFT JOIN hr_pendidikan p ON p.id_pendidikan = (SELECT x.id_pendidikan FROM hr_pendidikan x WHERE x.id_karyawan = m.id_unik ORDER BY CASE x.jenjang WHEN 'S3' THEN 10 WHEN 'S2' THEN 9 WHEN 'S1' THEN 8 WHEN 'D4' THEN 7 WHEN 'D3' THEN 6 WHEN 'D2' THEN 5 WHEN 'D1' THEN 4 WHEN 'SMA/SMK' THEN 3 WHEN 'SMP' THEN 2 ELSE 1 END DESC, COALESCE(x.tahun_lulus, 0) DESC, x.id_pendidikan DESC LIMIT 1) LEFT JOIN hr_sertifikasi s ON s.id_sertifikasi = (SELECT y.id_sertifikasi FROM hr_sertifikasi y WHERE y.id_karyawan = m.id_unik ORDER BY COALESCE(y.tahun, 0) DESC, y.id_sertifikasi DESC LIMIT 1) WHERE LOWER(TRIM(COALESCE(m.jenis_personil, ''))) <> 'siswa' AND NOT EXISTS (SELECT 1 FROM siswa_data sd WHERE sd.id_siswa = m.id_unik) AND COALESCE(m.status_aktif, 'Aktif') = 'Aktif' ORDER BY unit, m.nama, m.id_unik\n-- batas: pegawai aktif sekolah, dibatasi jumlah personil lembaga\n;";

export const HAPUS_DOKUMEN_SQL = [
  "DELETE FROM hr_dokumen_berkas WHERE id_dokumen = ?1;",
  "DELETE FROM hr_dokumen WHERE id_dokumen = ?1;",
] as const;
