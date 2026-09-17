export type WaNotificationJenis =
  | "scan_masuk"
  | "scan_pulang"
  | "koreksi_admin"
  | "import_manual"
  | "bolos"
  | "ambang_alfa";

export type WaNotificationStatus =
  | "Menunggu"
  | "Terkirim"
  | "Gagal"
  | "Dibatalkan";

export interface WaNotificationItem {
  id_notifikasi: string;
  dedupe_key: string;
  jenis: WaNotificationJenis;
  id_siswa: string | null;
  tujuan_nomor: string;
  isi_pesan: string;
  status: WaNotificationStatus;
  attempt_count: number;
  last_error: string | null;
  sent_at: string | null;
  created_at: string;
  updated_at: string;
  nama_siswa: string;
  nama_rombel: string;
}

export interface WaNotificationFilter {
  status?: string | null;
  jenis?: string | null;
  idSiswa?: string | null;
  id_siswa?: string | null;
  tanggal?: string | null;
  limit?: number | null;
}

export interface WaNotificationDraft {
  id_notifikasi?: string | null;
  dedupe_key: string;
  jenis: WaNotificationJenis;
  id_siswa?: string | null;
  tujuan_nomor: string;
  isi_pesan: string;
  status?: WaNotificationStatus;
}

export type WaConfigProvider = "fonnte" | "wablas" | "custom";

export interface WaConfig {
  id: string;
  provider: WaConfigProvider;
  apiKey: string;
  hasApiKey: boolean;
  apiUrl: string | null;
  senderNumber: string | null;
  isActive: boolean;
  dailyLimit: number;
  scanMasukEnabled: boolean;
  scanPulangEnabled: boolean;
  bolosEnabled: boolean;
  ambangAlfaEnabled: boolean;
  koreksiAdminEnabled: boolean;
  importManualEnabled: boolean;
  ambangAlfaLimit?: number;
  ambangAlfaDays?: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface WaConfigDraft {
  provider: WaConfigProvider;
  apiKey: string;
  apiUrl?: string | null;
  senderNumber?: string | null;
  isActive: boolean;
  dailyLimit: number;
  scanMasukEnabled: boolean;
  scanPulangEnabled: boolean;
  bolosEnabled: boolean;
  ambangAlfaEnabled: boolean;
  koreksiAdminEnabled: boolean;
  importManualEnabled: boolean;
  ambangAlfaLimit?: number;
  ambangAlfaDays?: number;
}

/**
 * Hasil satu kali pengurasan antrean.
 *
 * Bentuknya sama persis dengan `DrainResult` di `services/wa-sender.ts` — di
 * sanalah nilainya benar-benar dihitung. Dideklarasikan ulang di `types/` dan
 * bukan diimpor dari `services/` supaya halaman tidak ikut menarik modul
 * `server-only` beserta `@libsql/client` ke dalam bundel klien.
 */
export interface WaDrainResult {
  sukses: boolean;
  processed: number;
  sent: number;
  cancelled_dedupe: number;
  cancelled_disabled: number;
  failed: number;
  purged: number;
  skipped_quota: boolean;
  message: string;
}
