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

/**
 * Teks pesan per jenis yang bisa disunting pemegang izin `notification.template`
 * — cerminan `WA_TEMPLATE_*`, `render_wa_template`, dan `validate_wa_template`
 * di `wa_notification.rs`, diuji dengan vektor yang sama.
 *
 * Disimpan di `setting_gex_system` (`wa_template_<jenis>`) karena pesan disusun
 * SAAT MENGANTRE, di dalam transaksi SQLite lokal terminal yang mungkin tanpa
 * jaringan. Nilai kosong berarti teks bawaan di bawah.
 */
export const WA_TEMPLATE_KEY_PREFIX = "wa_template_";
export const MAX_WA_TEMPLATE_CHARS = 1000;

export type WaTemplateMap = Record<WaNotificationKind, string>;

export function waTemplateKey(jenis: WaNotificationKind): string {
  return `${WA_TEMPLATE_KEY_PREFIX}${jenis}`;
}

export const WA_TEMPLATE_LABELS: Record<WaNotificationKind, string> = {
  scan_masuk: "Scan masuk",
  scan_pulang: "Scan pulang",
  bolos: "Tidak ikut pelajaran",
  ambang_alfa: "Ambang alfa",
  koreksi_admin: "Koreksi admin",
  import_manual: "Input manual",
};

/** Teks bawaan, sama persis dengan pesan sebelum template bisa disunting. */
export const DEFAULT_WA_TEMPLATES: WaTemplateMap = {
  scan_masuk:
    "Yth. Wali Murid dari {nama} ({rombel}). Kami informasikan bahwa ananda telah hadir dan melakukan scan masuk di sekolah pada pukul {jam} WIB ({tanggal}). Status: {status}.",
  scan_pulang:
    "Yth. Wali Murid dari {nama} ({rombel}). Kami informasikan bahwa ananda telah selesai KBM dan melakukan scan pulang pada pukul {jam} WIB ({tanggal}).",
  bolos:
    "Yth. Wali Murid dari {nama} ({rombel}). Kami informasikan bahwa ananda tercatat hadir di sekolah namun tidak mengikuti KBM {mapel} (Jam ke-{jam_ke}) pada tanggal {tanggal}. Status: Alfa.",
  ambang_alfa:
    "Yth. Wali Murid dari {nama} ({rombel}). Kami informasikan bahwa ananda telah tercatat tidak hadir tanpa keterangan (Alfa) sebanyak {total_alfa} kali dalam {hari} hari terakhir. Mohon perhatian dan konfirmasi dari Bapak/Ibu Wali Murid.",
  koreksi_admin:
    "Yth. Wali Murid dari {nama} ({rombel}). Kami informasikan bahwa catatan kehadiran ananda pada {tanggal} telah dikoreksi oleh admin sekolah menjadi: {status}. Keterangan: {keterangan}. Mohon konfirmasi bila ada yang tidak sesuai.",
  import_manual:
    "Yth. Wali Murid dari {nama} ({rombel}). Kami informasikan bahwa catatan kehadiran ananda pada {tanggal} dimasukkan secara manual oleh admin sekolah dengan status: {status}. Keterangan: {keterangan}. Mohon konfirmasi bila ada yang tidak sesuai.",
};

/** Isian yang tersedia untuk sebuah jenis. Isian lain ditolak saat disimpan. */
export const WA_TEMPLATE_PLACEHOLDERS: Record<
  WaNotificationKind,
  readonly string[]
> = {
  scan_masuk: ["nama", "rombel", "jam", "tanggal", "status"],
  scan_pulang: ["nama", "rombel", "jam", "tanggal"],
  bolos: ["nama", "rombel", "mapel", "jam_ke", "tanggal"],
  ambang_alfa: ["nama", "rombel", "total_alfa", "hari"],
  koreksi_admin: ["nama", "rombel", "tanggal", "status", "keterangan"],
  import_manual: ["nama", "rombel", "tanggal", "status", "keterangan"],
};

export function isWaNotificationKind(
  value: string,
): value is WaNotificationKind {
  return (WA_NOTIFICATION_KINDS as readonly string[]).includes(value);
}

/**
 * Isi `{isian}` dalam SATU lintasan: nilai yang kebetulan memuat `{rombel}`
 * tidak diisi ulang. Isian tak dikenal dibiarkan apa adanya.
 */
export function renderWaTemplate(
  template: string,
  vars: Record<string, string>,
): string {
  let out = "";
  let rest = template;
  for (;;) {
    const start = rest.indexOf("{");
    if (start < 0) break;
    out += rest.slice(0, start);
    const after = rest.slice(start + 1);
    const end = after.indexOf("}");
    if (end < 0) return out + rest.slice(start);
    const name = after.slice(0, end);
    out += Object.hasOwn(vars, name) ? vars[name] : `{${name}}`;
    rest = after.slice(end + 1);
  }
  return out + rest;
}

export type WaTemplateCheck =
  | { ok: true; value: string }
  | { ok: false; pesan: string };

/** Nilai template yang boleh disimpan. Kosong = pakai teks bawaan. */
export function validateWaTemplate(
  jenis: string,
  raw: string,
): WaTemplateCheck {
  if (!isWaNotificationKind(jenis)) {
    return { ok: false, pesan: "Jenis notifikasi tidak dikenal." };
  }
  const text = raw.trim();
  if (!text) return { ok: true, value: "" };
  if ([...text].length > MAX_WA_TEMPLATE_CHARS) {
    return {
      ok: false,
      pesan: `Teks pesan maksimal ${MAX_WA_TEMPLATE_CHARS} karakter.`,
    };
  }
  const allowed = WA_TEMPLATE_PLACEHOLDERS[jenis];
  let rest = text;
  for (;;) {
    const start = rest.indexOf("{");
    if (start < 0) break;
    const after = rest.slice(start + 1);
    const end = after.indexOf("}");
    if (end < 0) {
      return { ok: false, pesan: "Ada tanda { yang tidak ditutup dengan }." };
    }
    const name = after.slice(0, end);
    if (!allowed.includes(name)) {
      return {
        ok: false,
        pesan: `Isian {${name}} tidak dikenal untuk pesan ini.`,
      };
    }
    rest = after.slice(end + 1);
  }
  if (!text.includes("{nama}")) {
    return { ok: false, pesan: "Teks pesan wajib memuat isian {nama}." };
  }
  return { ok: true, value: text };
}

/**
 * Susun isi pesan dari template tersimpan, atau teks bawaan bila kosong.
 * Template tersimpan yang tidak lolos validasi jatuh ke bawaan: wali tidak
 * boleh menerima `{nmaa}`.
 */
export function composeWaMessage(
  jenis: WaNotificationKind,
  stored: string | null | undefined,
  vars: Record<string, string>,
): string {
  const check = validateWaTemplate(jenis, String(stored ?? ""));
  const template =
    check.ok && check.value ? check.value : DEFAULT_WA_TEMPLATES[jenis];
  return renderWaTemplate(template, vars);
}
