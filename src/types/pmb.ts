/**
 * Tipe bersama untuk Penerimaan Peserta Didik Baru (PMB).
 *
 * Ketiga tabelnya cloud-only — tidak pernah ada di SQLite perangkat, tidak
 * pernah lewat outbox. Konsekuensinya seluruh layar PMB menuntut jaringan,
 * sama seperti Bimbingan Konseling.
 */

/**
 * Status pendaftar. Dieja sama persis dengan CHECK constraint
 * `pmb_pendaftar.status` di KEDUA jalur provisioning, dan dengan
 * `PMB_STATUS` di `web-public/src/lib/validations/pmb.ts`.
 */
export const PMB_STATUS_LIST = [
  "Baru",
  "Berkas Lengkap",
  "Terverifikasi",
  "Diterima",
  "Ditolak",
  "Dibatalkan",
  "Terdaftar",
] as const;

export type PmbStatus = (typeof PMB_STATUS_LIST)[number];

/**
 * Status yang boleh disetel manusia lewat layar verifikasi.
 *
 * `Terdaftar` sengaja di luar daftar: status itu hanya lahir dari promosi yang
 * benar-benar membuat baris siswa. Menyetelnya dengan tangan menghasilkan
 * pendaftar yang tampak sudah menjadi siswa padahal tidak ada baris
 * `master_data` mana pun yang mewakilinya — dan tidak ada yang akan mencarinya.
 */
export const PMB_STATUS_MANUAL = PMB_STATUS_LIST.filter(
  (status) => status !== "Terdaftar",
);

export interface PmbWave {
  id_gelombang: string;
  nama: string;
  tahun_ajaran: string;
  tanggal_buka: string;
  tanggal_tutup: string;
  kuota: number;
  biaya_pendaftaran: number;
  is_aktif: number;
  terpakai?: number;
  created_at?: string;
  updated_at?: string;
}

export interface PmbWaveDraft {
  idGelombang?: string | null;
  nama: string;
  tahunAjaran: string;
  tanggalBuka: string;
  tanggalTutup: string;
  kuota: number;
  biayaPendaftaran: number;
  isAktif: boolean;
}

export interface PmbRegistrantItem {
  id_pendaftar: string;
  nomor_pendaftaran: string;
  id_gelombang: string;
  nama_gelombang: string;
  nama_lengkap: string;
  nisn: string | null;
  jenis_kelamin: string | null;
  asal_sekolah: string | null;
  pilihan_jurusan: string | null;
  nama_wali: string;
  no_whatsapp_wali: string;
  status: PmbStatus;
  id_siswa: string | null;
  jumlah_berkas: number;
  created_at: string;
  updated_at: string;
}

/** Metadata berkas — TIDAK pernah membawa `konten_base64`. */
export interface PmbFileMeta {
  id_berkas: string;
  jenis: string;
  nama_file: string;
  mime: string;
  ukuran_byte: number;
  created_at?: string;
}

export interface PmbFileContent extends PmbFileMeta {
  konten_base64: string;
}

export interface PmbRegistrantDetail {
  pendaftar: PmbRegistrantItem & {
    tempat_lahir: string | null;
    tanggal_lahir: string | null;
    alamat: string | null;
    email_wali: string | null;
    catatan_verifikator: string | null;
    diverifikasi_oleh: string | null;
    diverifikasi_at: string | null;
  };
  berkas: PmbFileMeta[];
}

export interface PmbRegistrantFilter {
  id_gelombang?: string | null;
  status?: string | null;
  search?: string | null;
  limit?: number | null;
}

export interface PmbPromotionInput {
  idPendaftar: string;
  idRombel: string;
  idShift?: number | null;
  angkatan?: number | null;
}
