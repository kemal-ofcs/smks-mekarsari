/**
 * Tipe bersama modul nilai akademik (v28).
 *
 * Berbeda dari PMB: kedua tabelnya IKUT SINKRONISASI, sehingga fitur ini
 * bekerja penuh tanpa jaringan. Guru menilai di kelas, dan kelas tidak selalu
 * punya sinyal.
 */

/** Dieja sama persis dengan CHECK constraint `nilai_penilaian.jenis`. */
export const JENIS_PENILAIAN = [
  "Tugas",
  "Ulangan Harian",
  "Praktik",
  "UTS",
  "UAS",
] as const;

export type JenisPenilaian = (typeof JENIS_PENILAIAN)[number];

export const SEMESTER_LIST = ["Ganjil", "Genap"] as const;
export type Semester = (typeof SEMESTER_LIST)[number];

export interface PenilaianItem {
  id_penilaian: string;
  id_tahun_ajaran: string;
  semester: Semester;
  id_rombel: string;
  id_mapel: string;
  id_guru: string;
  jenis: JenisPenilaian;
  nama_penilaian: string;
  tanggal: string;
  bobot: number;
  kkm: number;
  nilai_maks: number;
  catatan: string | null;
  created_at: string;
  updated_at: string;
  nama_mapel: string;
  jumlah_siswa: number;
  jumlah_dinilai: number;
  /**
   * `null` berarti belum ada satu pun skor — bukan rata-rata nol.
   *
   * Dihitung `AVG(skor)` yang mengabaikan NULL, sehingga rata-ratanya berasal
   * dari anak yang SUDAH dinilai. Memakai `COALESCE(skor, 0)` akan menurunkan
   * angka seluruh kelas hanya karena gurunya belum selesai.
   */
  rata_rata: number | null;
}

export interface PenilaianDraft {
  id_penilaian?: string | null;
  id_tahun_ajaran: string;
  semester: Semester;
  id_rombel: string;
  id_mapel: string;
  id_guru: string;
  jenis: JenisPenilaian;
  nama_penilaian: string;
  tanggal: string;
  bobot: number;
  /** Hanya dipakai saat penilaian BARU dibuat; sesudahnya dibekukan. */
  kkm?: number;
  nilai_maks: number;
  catatan?: string | null;
}

export interface NilaiSiswaItem {
  id_siswa: string;
  nama_lengkap: string;
  nis: string;
  id_nilai: string | null;
  /** `null` berarti BELUM DINILAI, bukan nol. */
  skor: number | null;
  keterangan: string | null;
}

export interface PenilaianDetail {
  penilaian: PenilaianItem & { nama_rombel: string };
  items: NilaiSiswaItem[];
}

export interface SimpanNilaiDraft {
  id_penilaian: string;
  items: Array<{
    id_siswa: string;
    skor: number | null;
    keterangan?: string | null;
  }>;
}

export interface PenilaianFilter {
  id_tahun_ajaran: string;
  semester: Semester;
  id_rombel: string;
  id_mapel?: string | null;
}
