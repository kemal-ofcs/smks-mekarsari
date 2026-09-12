import { normalizePersonnelRole } from "@/lib/contracts/scanner";

/**
 * Kebijakan payroll yang dibaca DUA sisi: layar (Web/Desktop/Mobile) dan mesin
 * penggajian. Modul ini sengaja netral — tanpa `server-only` dan tanpa akses
 * database — supaya satu-satunya ejaan kuncinya dipakai halaman konfigurasi,
 * route handler Web, dan cerminan Rust-nya sekaligus.
 */

/**
 * Sakelar lembur untuk personil berjenis Guru.
 *
 * Kunci yang BELUM ADA berarti MENYALA, sama seperti `auto_alfa_aktif` dan
 * berbeda dari sakelar fitur baru yang bawaannya mati. Alasannya: lembur guru
 * sudah terhitung sejak sebelum sakelar ini ada, dan pemasangan yang berjalan
 * tidak boleh diam-diam kehilangan komponen gaji hanya karena aplikasinya
 * diperbarui. Yang mematikan harus menjadi keputusan sadar sekolahnya.
 *
 * Ia hidup di `setting_gex_system` yang ikut sinkronisasi — ini kebijakan
 * sekolah, bukan setelan perangkat, jadi TIDAK boleh masuk
 * `sync::DEVICE_LOCAL_SETTING_KEYS`.
 */
export const TEACHER_OVERTIME_SETTING_KEY = "payroll_lembur_guru_aktif";

/**
 * Membaca nilai sakelar lembur guru dari `setting_gex_system`.
 *
 * Bentuknya sama persis dengan pembacaan `auto_alfa_aktif` di Rust: baris yang
 * ada dibandingkan dengan "true" tanpa memandang huruf besar-kecil, baris yang
 * tidak ada berarti menyala. Cerminan `teacher_overtime_enabled` di
 * `payroll/engine.rs`; keduanya diuji dengan vektor yang sama.
 */
export function parseTeacherOvertimeSetting(
  raw: string | null | undefined,
): boolean {
  if (raw === null || raw === undefined) return true;
  return raw.trim().toLowerCase() === "true";
}

/**
 * Apakah personil ini seorang siswa?
 *
 * `master_data.jenis_personil` tersimpan dengan ejaan berbeda-beda ('SISWA'
 * dari alur akademik, 'Siswa' dari normalisasi, 'Pegawai' dari impor Excel),
 * jadi ia tidak pernah boleh dibandingkan mentah.
 */
export function isStudentPersonnel(jenisPersonil: unknown): boolean {
  return normalizePersonnelRole(String(jenisPersonil ?? "")) === "Siswa";
}

/** Apakah personil ini seorang guru? Dasar sakelar lembur guru. */
export function isTeacherPersonnel(jenisPersonil: unknown): boolean {
  return normalizePersonnelRole(String(jenisPersonil ?? "")) === "Guru";
}

/** Nilai `payroll_components.applies_to` untuk komponen yang berlaku umum. */
export const APPLIES_TO_ALL = "ALL";

/**
 * Bentuk kanonik `payroll_components.applies_to`.
 *
 * Kosong berarti berlaku untuk semua, dan itu HARUS menjadi "ALL" yang literal:
 * `calculate_components` membandingkan kolom ini dengan "ALL" persis, sehingga
 * string kosong akan membuat komponennya tidak pernah berlaku untuk siapa pun
 * dan tidak terlihat salah di layar mana pun.
 */
export function normalizeAppliesTo(raw: unknown): string {
  const value = String(raw ?? "").trim();
  if (value === "" || value.toUpperCase() === APPLIES_TO_ALL) {
    return APPLIES_TO_ALL;
  }
  const pisah = value.indexOf(":");
  if (pisah > 0) {
    const prefix = value.slice(0, pisah).trim().toUpperCase();
    const isi = value.slice(pisah + 1).trim();
    if (APPLIES_TO_GROUP_PREFIXES.includes(prefix as AppliesToGroupPrefix)) {
      // Isi kelompok TIDAK diseragamkan huruf besar-kecilnya: nama divisi
      // ditulis manusia ("Tata Usaha"), dan menampilkannya kembali sebagai
      // "TATA USAHA" membuat layar terasa bukan miliknya. Perbandingannya yang
      // mengabaikan huruf besar-kecil, bukan penyimpanannya.
      return isi === "" ? APPLIES_TO_ALL : `${prefix}:${isi}`;
    }
  }
  return value;
}

/**
 * Awalan kelompok yang dikenali `applies_to`, selain "ALL" dan satu id personil.
 *
 * Ketiganya dipilih karena bisa dijawab dari data yang SUDAH ada di setiap
 * baris rekap: jenis personil dan divisi hidup di `master_data`, status
 * kepegawaian di `guru_data`. Menambah awalan keempat berarti menambah kolom
 * yang harus ikut dibawa rekap — itu bukan penambahan pilihan, melainkan
 * penambahan query.
 */
export const APPLIES_TO_GROUP_PREFIXES = [
  "PERSONIL",
  "STATUS",
  "DIVISI",
] as const;

export type AppliesToGroupPrefix = (typeof APPLIES_TO_GROUP_PREFIXES)[number];

/**
 * Status kepegawaian guru yang ditawarkan form Master Guru.
 *
 * Dipakai layar konfigurasi payroll untuk menyusun pilihan kelompok
 * `STATUS:…`. Kolomnya sendiri TEKS bebas, jadi daftar ini hanya memandu
 * pilihan — penilaiannya tetap membandingkan apa yang benar-benar tersimpan,
 * termasuk status lama yang tidak ada di daftar ini.
 */
export const TEACHER_EMPLOYMENT_STATUSES = [
  "PNS",
  "GTY",
  "GTT",
  "Honorer",
] as const;

/** Satu orang, dilihat dari sudut pandang penyaringan komponen payroll. */
export interface ComponentSubject {
  id_karyawan: string;
  /** `master_data.jenis_personil`, ejaan apa adanya. */
  jenis_personil: string;
  /** `guru_data.status_kepegawaian`; kosong untuk yang bukan guru. */
  status_kepegawaian: string;
  /** `master_data.divisi`. */
  divisi: string;
  /** JP mengajar terparaf pada periode ini; dasar komponen `PER_JP`. */
  total_teaching_jp: number;
  /** Hari hadir pada periode ini; dasar komponen `PER_HADIR`. */
  total_hadir: number;
}

/**
 * Jenis perhitungan komponen payroll.
 *
 * `PER_JP` dan `PER_HADIR` ditambahkan pada schema versi 25 dan menuntut CHECK
 * constraint `payroll_components.calc_type` dibangun ulang di ketiga jalur
 * provisioning — daftar ini WAJIB sama dengan ketiganya dan dengan enum Zod di
 * `sync-schema.ts`.
 */
export const PAYROLL_CALC_TYPES = [
  "FIXED",
  "PERCENTAGE",
  "PER_JP",
  "PER_HADIR",
] as const;

export type PayrollCalcType = (typeof PAYROLL_CALC_TYPES)[number];

/** Label jenis perhitungan yang dibaca manusia. */
export const PAYROLL_CALC_TYPE_LABEL: Record<PayrollCalcType, string> = {
  FIXED: "Nominal Tetap (Rp)",
  PERCENTAGE: "Persentase (%) Gaji Pokok",
  PER_JP: "Nominal × JP Mengajar",
  PER_HADIR: "Nominal × Hari Hadir",
};

/** Membandingkan dua teks tanpa memandang huruf besar-kecil dan spasi tepi. */
function samaTeks(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * Apakah komponen dengan `applies_to` ini berlaku untuk orang tersebut?
 *
 * "ALL" berlaku untuk semua; sebuah id berlaku untuk satu orang; dan ketiga
 * awalan kelompok menjawab dari kolom yang sudah dibawa rekap. Nilai yang tidak
 * dikenal diperlakukan sebagai id — bukan sebagai "berlaku untuk semua".
 * Salah arah di sini berarti tunjangan menyebar ke seluruh sekolah karena satu
 * salah ketik, dan itu tidak terlihat di layar mana pun sampai slip terbit.
 *
 * Cerminan `applies_to_subject` di `payroll/engine.rs`; keduanya diuji dengan
 * vektor yang sama.
 */
export function appliesToSubject(
  appliesTo: string,
  subject: ComponentSubject,
): boolean {
  // SENGAJA tidak lewat `normalizeAppliesTo`: normalisasi mengubah kelompok
  // berisi kosong (`PERSONIL:`) menjadi "ALL", dan di titik PENYIMPANAN itu
  // benar — formulir yang belum lengkap tidak boleh tersimpan sebagai kelompok
  // hantu. Di titik PENILAIAN artinya terbalik: nilai cacat yang terlanjur ada
  // di database akan membayar tunjangan itu kepada seluruh sekolah. Di sini
  // nilai yang tidak dikenali diperlakukan sebagai id, sehingga ia tidak cocok
  // dengan siapa pun. Cerminan `applies_to_subject` di `payroll/engine.rs`.
  const value = appliesTo.trim();
  if (value === "" || value.toUpperCase() === APPLIES_TO_ALL) return true;

  const pisah = value.indexOf(":");
  if (pisah > 0) {
    const prefix = value.slice(0, pisah).trim().toUpperCase();
    const isi = value.slice(pisah + 1).trim();
    if (isi !== "") {
      switch (prefix) {
        case "PERSONIL":
          return samaTeks(normalizePersonnelRole(subject.jenis_personil), isi);
        case "STATUS":
          return samaTeks(subject.status_kepegawaian, isi);
        case "DIVISI":
          return samaTeks(subject.divisi, isi);
        default:
          break;
      }
    }
  }
  return value === subject.id_karyawan;
}

/**
 * Label "Berlaku untuk" yang dibaca manusia.
 *
 * `namaPersonil` dipakai hanya untuk nilai berbentuk id; kelompok tidak
 * membutuhkannya. Dipakai tabel Desktop maupun Mobile supaya keduanya tidak
 * mengarang istilah sendiri untuk nilai yang sama.
 */
export function labelAppliesTo(
  appliesTo: string,
  namaPersonil?: (id: string) => string,
): string {
  const value = normalizeAppliesTo(appliesTo);
  if (value === APPLIES_TO_ALL) return "Semua Personil Digaji";

  const pisah = value.indexOf(":");
  if (pisah > 0) {
    const prefix = value.slice(0, pisah).toUpperCase();
    const isi = value.slice(pisah + 1);
    if (prefix === "PERSONIL") return `Semua ${isi}`;
    if (prefix === "STATUS") return `Guru berstatus ${isi}`;
    if (prefix === "DIVISI") return `Divisi ${isi}`;
  }
  return namaPersonil ? namaPersonil(value) : value;
}
