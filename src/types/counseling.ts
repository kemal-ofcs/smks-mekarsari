export type CounselingCategory =
  | "kedisiplinan"
  | "akademik"
  | "kehadiran"
  | "sosial";

export type CounselingStatus = "Terbuka" | "Dalam Bimbingan" | "Selesai";

export interface CounselingCaseItem {
  id_kasus: string;
  id_siswa: string;
  id_tahun_ajaran: string;
  kategori: CounselingCategory;
  ringkasan: string;
  kronologi: string | null;
  status: CounselingStatus;
  dibuat_oleh: string;
  created_at: string;
  updated_at: string;
  nama_siswa: string;
  nis: string;
  nama_rombel: string;
  nama_wali: string;
  no_whatsapp_wali: string;
  nama_tahun: string;
  total_sesi: number;
}

export interface CounselingSessionItem {
  id_sesi: string;
  id_kasus: string;
  tanggal: string;
  catatan_konseling: string;
  tindak_lanjut: string | null;
  konselor: string;
  created_at: string;
  updated_at: string;
}

export interface CounselingCaseDetail extends CounselingCaseItem {
  sesi: CounselingSessionItem[];
}

export interface CounselingCaseDraft {
  id_siswa: string;
  id_tahun_ajaran: string;
  kategori: CounselingCategory;
  ringkasan: string;
  kronologi?: string | null;
  status?: CounselingStatus;
}

export interface CounselingSessionDraft {
  id_kasus: string;
  tanggal: string;
  catatan_konseling: string;
  tindak_lanjut?: string | null;
}

export interface CounselingCaseFilter {
  id_tahun_ajaran?: string | null;
  status?: string | null;
  kategori?: string | null;
  id_siswa?: string | null;
  search?: string | null;
  limit?: number | null;
}
