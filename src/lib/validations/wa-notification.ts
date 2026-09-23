/**
 * Sakelar induk notifikasi WhatsApp — cerminan TypeScript dari konstanta dan
 * fungsi bernama sama di `src-tauri/src/desktop/wa_notification.rs`.
 *
 * Aturan yang sama dinilai dua kali: server Web memakai modul ini, terminal
 * Desktop/Mobile memakai fungsi Rust-nya. Perbedaan sekecil apa pun akan tampak
 * sebagai "notifikasi diantre di satu jalur, tidak di jalur lain" — persis pola
 * paritas yang sudah dipakai `ip-allowlist` dan `holiday-whitelist`.
 */

/**
 * Kunci `setting_gex_system` per jenis notifikasi.
 *
 * Sengaja di tabel setting yang IKUT SINKRONISASI, bukan di `app_wa_config`
 * yang cloud-only: scanner Desktop/Mobile mengantre di dalam transaksi SQLite
 * lokal dan mungkin sedang tanpa jaringan, sehingga tabel cloud tidak akan
 * pernah bisa dibacanya pada saat yang menentukan.
 */
export const WA_NOTIFY_SCAN_MASUK_KEY = "wa_notify_scan_masuk";
export const WA_NOTIFY_SCAN_PULANG_KEY = "wa_notify_scan_pulang";
export const WA_NOTIFY_BOLOS_KEY = "wa_notify_bolos";
export const WA_NOTIFY_AMBANG_ALFA_KEY = "wa_notify_ambang_alfa";
export const WA_NOTIFY_KOREKSI_ADMIN_KEY = "wa_notify_koreksi_admin";
export const WA_NOTIFY_IMPORT_MANUAL_KEY = "wa_notify_import_manual";

/**
 * Sakelar "Kirim otomatis" — cerminan `WA_AUTO_SEND_KEY` di Rust. Bawaannya
 * MATI. Diperiksa oleh pengirim (`drainWaQueue` / `wa_sender::drain`) saat
 * dipanggil runner, bukan oleh runner-nya.
 */
export const WA_AUTO_SEND_KEY = "wa_kirim_otomatis";

/** Kunci setting dinamis untuk ambang jumlah alfa dan rentang hari evaluasi. */
export const WA_NOTIFY_AMBANG_ALFA_LIMIT_KEY = "wa_notify_ambang_alfa_limit";
export const WA_NOTIFY_AMBANG_ALFA_DAYS_KEY = "wa_notify_ambang_alfa_days";
export const DEFAULT_AMBANG_ALFA_LIMIT = 3;
export const DEFAULT_AMBANG_ALFA_DAYS = 30;

/** Jenis notifikasi yang dikenal sistem. */
export const WA_NOTIFICATION_KINDS = [
  "scan_masuk",
  "scan_pulang",
  "bolos",
  "ambang_alfa",
  "koreksi_admin",
  "import_manual",
] as const;

export type WaNotificationKind = (typeof WA_NOTIFICATION_KINDS)[number];

/**
 * Status antrean yang sah — sama persis dengan CHECK constraint
 * `notifikasi_wa.status`, enum Zod di `sync-schema.ts`, dan daftar di
 * `wa_notification.rs`.
 *
 * Nilai di luar daftar ini WAJIB DITOLAK, bukan dinormalkan menjadi
 * `Menunggu`. Menormalkannya diam-diam mengubah bug klien menjadi pesan
 * WhatsApp yang benar-benar terkirim ke nomor wali seorang siswa — kegagalan
 * yang tidak bisa ditarik kembali dan tidak meninggalkan jejak bahwa ada yang
 * salah. Ini pola `class_status` dari Fase 2, dengan taruhan yang lebih tinggi.
 */
export const WA_NOTIFICATION_STATUSES = [
  "Menunggu",
  "Terkirim",
  "Gagal",
  "Dibatalkan",
] as const;

export type WaNotificationStatusValue =
  (typeof WA_NOTIFICATION_STATUSES)[number];

export function isValidWaNotificationStatus(
  value: string,
): value is WaNotificationStatusValue {
  return (WA_NOTIFICATION_STATUSES as readonly string[]).includes(value);
}

/**
 * Umur maksimal baris antrean yang sudah selesai, dalam hari.
 *
 * Angka ini WAJIB sama dengan `WA_QUEUE_RETENTION_DAYS` di Rust: kedua sisi
 * memangkas tabel yang sama, dan ambang yang berbeda membuat satu sisi
 * menghidupkan kembali baris yang baru saja dihapus sisi lain lewat sinkronisasi.
 */
export const WA_QUEUE_RETENTION_DAYS = 90;

/** Kunci sakelar untuk sebuah jenis notifikasi. */
export function waNotifySettingKey(jenis: string): string | null {
  switch (jenis) {
    case "scan_masuk":
      return WA_NOTIFY_SCAN_MASUK_KEY;
    case "scan_pulang":
      return WA_NOTIFY_SCAN_PULANG_KEY;
    case "bolos":
      return WA_NOTIFY_BOLOS_KEY;
    case "ambang_alfa":
      return WA_NOTIFY_AMBANG_ALFA_KEY;
    case "koreksi_admin":
      return WA_NOTIFY_KOREKSI_ADMIN_KEY;
    case "import_manual":
      return WA_NOTIFY_IMPORT_MANUAL_KEY;
    default:
      return null;
  }
}

/**
 * Baca sebuah sakelar boolean dari nilai `setting_gex_system`.
 *
 * Kunci yang belum pernah ditulis berarti MATI. Itulah cara fitur ini tidak
 * menyala sendiri pada database yang sudah berjalan.
 */
export function settingEnabled(value: string | null | undefined): boolean {
  return (
    String(value ?? "")
      .trim()
      .toLowerCase() === "true"
  );
}

/**
 * Bolehkah jenis notifikasi ini diantrekan secara otomatis?
 *
 * Jenis yang tidak dikenal menjawab `false`: nilai asing hanya bisa datang dari
 * kode yang salah, dan bawaan yang aman untuk mengirim pesan ke luar adalah
 * tidak mengirim.
 */
export function waNotifyEnabled(
  settings: Map<string, string> | Record<string, string>,
  jenis: string,
): boolean {
  const key = waNotifySettingKey(jenis);
  if (!key) return false;
  const value =
    settings instanceof Map
      ? settings.get(key)
      : (settings as Record<string, string>)[key];
  return settingEnabled(value);
}

/**
 * Urai nilai konfigurasi ambang batas jumlah alfa dari string/number/Map/Record.
 * Mengembalikan nilai integer positif (1-100), default 3 jika kosong/tidak valid.
 */
export function parseAmbangAlfaLimit(input: unknown): number {
  let raw: unknown = input;
  if (input instanceof Map) {
    raw = input.get(WA_NOTIFY_AMBANG_ALFA_LIMIT_KEY);
  } else if (
    input &&
    typeof input === "object" &&
    WA_NOTIFY_AMBANG_ALFA_LIMIT_KEY in input
  ) {
    raw = (input as Record<string, unknown>)[WA_NOTIFY_AMBANG_ALFA_LIMIT_KEY];
  }
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 100
    ? parsed
    : DEFAULT_AMBANG_ALFA_LIMIT;
}

/**
 * Urai nilai konfigurasi rentang hari evaluasi alfa dari string/number/Map/Record.
 * Mengembalikan nilai integer positif (1-365), default 30 jika kosong/tidak valid.
 */
export function parseAmbangAlfaDays(input: unknown): number {
  let raw: unknown = input;
  if (input instanceof Map) {
    raw = input.get(WA_NOTIFY_AMBANG_ALFA_DAYS_KEY);
  } else if (
    input &&
    typeof input === "object" &&
    WA_NOTIFY_AMBANG_ALFA_DAYS_KEY in input
  ) {
    raw = (input as Record<string, unknown>)[WA_NOTIFY_AMBANG_ALFA_DAYS_KEY];
  }
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 365
    ? parsed
    : DEFAULT_AMBANG_ALFA_DAYS;
}
