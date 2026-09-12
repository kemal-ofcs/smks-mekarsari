/**
 * Peringatan sebelum menyimpan presensi kelas.
 *
 * Status awal seluruh roster adalah "Hadir" — lihat `DEFAULT_ROSTER_STATUS` di
 * `src/lib/services/class-attendance.ts` dan cerminan Rust-nya untuk alasannya.
 * Bawaan itu sengaja tidak pernah diisi "Alfa" supaya kartu yang tertinggal atau
 * scanner yang mati tidak menghukum siswa.
 *
 * Konsekuensinya ada di arah sebaliknya: guru yang menekan simpan tanpa memeriksa
 * akan menandai HADIR seluruh kelas, termasuk siswa yang benar-benar tidak masuk.
 * Anomali `TANPA_SCAN_GERBANG` memang menjaringnya, tetapi baru SETELAH kejadian.
 * Fungsi ini memindahkan temuan yang sama ke detik sebelum penyimpanan, tanpa
 * pernah mengubah status siapa pun secara otomatis — gurunya yang memutuskan.
 */

/**
 * Batas STRUKTURAL jam pelajaran — pagar terluar, bukan kebijakan sekolah.
 *
 * Angka ini hanya menjaga agar teks asing tidak masuk ke kolom yang ikut
 * disinkronkan; jumlah jam pelajaran yang benar-benar dipakai sebuah sekolah
 * diatur terpisah lewat `jp_max_per_hari` di `setting_gex_system`. Keduanya
 * dipisah karena sifatnya berbeda: yang ini melindungi database dan karena itu
 * dieja di kode, yang satu lagi keputusan sekolah dan karena itu bisa diubah
 * tanpa memasang ulang aplikasi.
 *
 * Dinaikkan dari 12 ke 20 pada versi ini: pesantren dan sekolah berasrama
 * benar-benar punya jam pelajaran sampai belasan, dan batas lama menguncinya
 * tanpa alasan teknis apa pun.
 */
export const MAX_JAM_KE = 20;

/** Jenis baris pada jadwal bel sekolah. */
export const JENIS_JAM_PELAJARAN = [
  "KBM",
  "Istirahat",
  "Upacara",
  "Ekstrakurikuler",
] as const;

export type JenisJamPelajaran = (typeof JENIS_JAM_PELAJARAN)[number];

/**
 * Normalisasi jam dinding `HH:MM` pada jadwal bel.
 *
 * Menerima `7:5` dan mengembalikan `07:05`, karena orang mengetik jam seperti
 * itu; menolak apa pun yang bukan jam. Kolomnya TEKS dan ikut disinkronkan,
 * jadi satu ejaan bebas akan membuat pengurutan bel berantakan di perangkat
 * lain tanpa pesan apa pun.
 *
 * Cerminan `normalize_jam_bel` di `class_attendance.rs`; keduanya diuji dengan
 * vektor yang sama.
 */
export function normalizeJamBel(raw: string): string | null {
  const compact = String(raw ?? "").replace(/\s+/g, "");
  const pisah = compact.indexOf(":");
  if (pisah <= 0) return null;

  const jamText = compact.slice(0, pisah);
  const menitText = compact.slice(pisah + 1);
  if (!/^\d{1,2}$/.test(jamText) || !/^\d{1,2}$/.test(menitText)) return null;

  const jam = Number(jamText);
  const menit = Number(menitText);
  if (jam < 0 || jam > 23 || menit < 0 || menit > 59) return null;

  return `${String(jam).padStart(2, "0")}:${String(menit).padStart(2, "0")}`;
}

/** Kunci `setting_gex_system` untuk jumlah jam pelajaran per hari. */
export const JP_MAX_PER_DAY_SETTING_KEY = "jp_max_per_hari";

/** Kunci `setting_gex_system` untuk lama satu jam pelajaran (menit). */
export const JP_DURATION_SETTING_KEY = "jp_durasi_menit";

/** Jumlah jam pelajaran per hari bila sekolah belum mengaturnya. */
export const DEFAULT_JP_MAX_PER_DAY = 12;

/** Lama satu jam pelajaran bila sekolah belum mengaturnya (menit). */
export const DEFAULT_JP_DURATION_MINUTES = 45;

/**
 * Membaca `jp_max_per_hari` dari `setting_gex_system`.
 *
 * Nilai yang hilang, bukan angka, atau di luar `1..MAX_JAM_KE` jatuh ke bawaan
 * — BUKAN ke nol dan bukan ke batas struktural. Nol akan membuat setiap
 * presensi ditolak, dan batas struktural akan diam-diam melonggarkan kebijakan
 * sekolah yang justru sedang salah tulis.
 *
 * Cerminan `jp_max_per_day` di `class_attendance.rs`; keduanya diuji dengan
 * vektor yang sama.
 */
export function parseJpMaxPerDay(raw: string | null | undefined): number {
  const value = Number(String(raw ?? "").trim());
  if (!Number.isInteger(value) || value < 1 || value > MAX_JAM_KE) {
    return DEFAULT_JP_MAX_PER_DAY;
  }
  return value;
}

/**
 * Membaca `jp_durasi_menit` dari `setting_gex_system`.
 *
 * Angka ini TIDAK mengubah nominal gaji: honor guru dibayar per jam pelajaran,
 * bukan per menit. Ia dipakai untuk menerangkan durasi di layar presensi.
 *
 * Cerminan `jp_duration_minutes` di `class_attendance.rs`.
 */
export function parseJpDuration(raw: string | null | undefined): number {
  const value = Number(String(raw ?? "").trim());
  if (!Number.isInteger(value) || value < 1 || value > 240) {
    return DEFAULT_JP_DURATION_MINUTES;
  }
  return value;
}

/**
 * Normalisasi dan validasi `presensi_mapel.jam_ke`.
 *
 * Kolomnya TEKS, dan itu memang benar — nilainya bukan sekadar angka melainkan
 * juga RENTANG untuk blok dua jam pelajaran (`1-2`, `3-4`). Mengubahnya menjadi
 * INTEGER akan memusnahkan bagian setelah tanda hubung.
 *
 * Cerminan `normalize_jam_ke` di `class_attendance.rs`; keduanya diuji dengan
 * vektor yang SAMA, pola paritas yang sama dengan `ip-allowlist` dan `totp`.
 *
 * Mengembalikan bentuk kanoniknya, atau `null` bila tidak valid.
 */
export function normalizeJamKe(raw: string): string | null {
  const compact = String(raw ?? "").replace(/\s+/g, "");

  const angka = (bagian: string): number | null => {
    if (!/^\d+$/.test(bagian)) return null;
    const value = Number(bagian);
    return value >= 1 && value <= MAX_JAM_KE ? value : null;
  };

  const pisah = compact.indexOf("-");
  if (pisah === -1) {
    const value = angka(compact);
    return value === null ? null : String(value);
  }

  const awal = angka(compact.slice(0, pisah));
  const akhir = angka(compact.slice(pisah + 1));
  if (awal === null || akhir === null || awal >= akhir) return null;
  return `${awal}-${akhir}`;
}

/** Rentang jam pelajaran: `3` menjadi `{ awal: 3, akhir: 3 }`. */
export interface RentangJamKe {
  awal: number;
  akhir: number;
}

/**
 * Rentang `jam_ke`, atau `null` bila nilainya tidak lolos `normalizeJamKe`.
 *
 * Pemanggil yang membandingkan dengan baris TERSIMPAN wajib memperlakukan
 * `null` sebagai "tidak diketahui", bukan bentrok: satu baris lama bertulisan
 * asing tidak boleh mengunci seluruh jadwal rombelnya dari presensi baru.
 *
 * Cerminan `jam_ke_range` di `class_attendance.rs`; keduanya diuji dengan
 * vektor yang sama.
 */
export function rentangJamKe(raw: string): RentangJamKe | null {
  const normal = normalizeJamKe(raw);
  if (normal === null) return null;

  const pisah = normal.indexOf("-");
  if (pisah === -1) {
    const value = Number(normal);
    return { awal: value, akhir: value };
  }
  return {
    awal: Number(normal.slice(0, pisah)),
    akhir: Number(normal.slice(pisah + 1)),
  };
}

/**
 * Jumlah jam pelajaran yang dipakai sebuah sesi: `3-5` bernilai 3 JP.
 *
 * Dipakai pratinjau "= N JP" di layar presensi, dan menjadi dasar honor guru
 * per JP. Karena itu ia dieja sekali di sini, bukan dihitung ulang di layar.
 */
export function hitungJp(raw: string): number | null {
  const rentang = rentangJamKe(raw);
  return rentang === null ? null : rentang.akhir - rentang.awal + 1;
}

/**
 * Apakah dua `jam_ke` memakai setidaknya satu jam pelajaran yang sama?
 *
 * Membandingkan IRISAN, bukan teks: `1-2` dan `2` adalah dua nilai berbeda bagi
 * `=`, padahal keduanya memakai jam ke-2. Pemeriksaan duplikat yang lama
 * mencocokkan teks persis, sehingga pasangan itu tersimpan sebagai dua sesi dan
 * jam ke-2 terhitung dua kali.
 *
 * Cerminan `jam_ke_overlaps` di `class_attendance.rs`.
 */
export function jamKeBeririsan(a: string, b: string): boolean {
  const kiri = rentangJamKe(a);
  const kanan = rentangJamKe(b);
  if (kiri === null || kanan === null) return false;
  return kiri.awal <= kanan.akhir && kanan.awal <= kiri.akhir;
}

/**
 * Menyusun `jam_ke` dari dua angka yang diketik pengguna.
 *
 * Layar presensi memberi dua kolom "dari" dan "sampai" alih-alih daftar pilihan
 * tetap, supaya sekolah dengan jam pelajaran di luar delapan pilihan lama tidak
 * terkunci. Bentuk kanoniknya tetap dihasilkan `normalizeJamKe`, jadi tidak ada
 * ejaan kedua yang bisa lolos ke database.
 */
export function susunJamKe(dari: number, sampai: number): string | null {
  if (!Number.isInteger(dari) || !Number.isInteger(sampai)) return null;
  return normalizeJamKe(dari === sampai ? String(dari) : `${dari}-${sampai}`);
}

/**
 * Status awal setiap baris roster.
 *
 * Dieja di sini — modul netral yang dipakai UI maupun service — supaya nilainya
 * tidak bercabang antara keduanya. Alasan mengapa bawaannya `Hadir` dan bukan
 * `Alfa` ada di `DEFAULT_ROSTER_STATUS` pada `class_attendance.rs`.
 */
export const DEFAULT_ROSTER_STATUS = "Hadir" as const;

/**
 * Apakah roster memuat pekerjaan guru yang belum tersimpan?
 *
 * Memuat ulang roster mengembalikan SELURUH siswa ke status bawaan dan
 * menghapus sesi yang sedang disunting. Tombolnya duduk tepat di sebelah filter,
 * jadi satu salah ketuk di layar sentuh bisa menghapus tiga puluh tanda
 * kehadiran tanpa jejak — dan karena `editingSessionId` ikut hilang, simpan
 * berikutnya membuat sesi baru yang justru ditolak sebagai duplikat.
 *
 * Hanya penyimpangan dari bawaan yang dihitung: memuat ulang roster yang belum
 * disentuh sama sekali tidak kehilangan apa pun, jadi tidak perlu ditanyakan.
 */
export function hasUnsavedAttendanceMarks(
  items: readonly RosterAttendanceCheckItem[],
): boolean {
  return items.some((item) => {
    const status = String(item.status ?? "").trim();
    if (status !== "" && status !== DEFAULT_ROSTER_STATUS) return true;
    return String(item.catatan ?? "").trim() !== "";
  });
}

/** Bentuk minimal satu baris anomali yang dibutuhkan penyusunan pesan wali. */
export interface ParentNotificationSource {
  anomaly_type?: string | null;
  nama_siswa?: string | null;
  nama_mapel?: string | null;
  jam_ke?: string | null;
  nama_guru?: string | null;
  jam_masuk_gerbang?: string | null;
}

/**
 * Pesan WhatsApp untuk wali murid, DIBEDAKAN per jenis anomali.
 *
 * Rekonsiliasi menghasilkan dua anomali yang artinya berlawanan, tetapi teks
 * pesannya sempat dipaku untuk salah satu saja. Akibatnya wali dari siswa
 * `HADIR_TANPA_SCAN_GERBANG` menerima kalimat yang setiap klausanya terbalik —
 * "tercatat hadir di gerbang … namun TIDAK HADIR di kelas" — padahal yang
 * terjadi justru sebaliknya. Mengabari orang tua dengan fakta terbalik tentang
 * anaknya adalah kesalahan yang jauh lebih mahal daripada tidak mengabari.
 *
 * Nada `HADIR_TANPA_SCAN_GERBANG` sengaja tidak menuduh: penyebab paling lazim
 * adalah kartu tertinggal atau antrean scanner, bukan pelanggaran.
 */
export function buildParentNotificationText(
  item: ParentNotificationSource,
): string {
  const nama = String(item.nama_siswa ?? "").trim() || "ananda";
  const mapel = String(item.nama_mapel ?? "").trim() || "mata pelajaran";
  const jamKe = String(item.jam_ke ?? "").trim();
  const guru = String(item.nama_guru ?? "").trim();
  const pelajaran = jamKe ? `${mapel} jam ke-${jamKe}` : mapel;
  const pengampu = guru ? ` (${guru})` : "";

  if (item.anomaly_type === "HADIR_TANPA_SCAN_GERBANG") {
    return (
      `Yth. Bapak/Ibu Wali dari ${nama}, ananda tercatat HADIR pada ${pelajaran}${pengampu}, ` +
      "namun tidak ditemukan catatan scan di gerbang sekolah hari ini. " +
      "Mohon dipastikan ananda membawa kartu pelajarnya dan memindai di gerbang saat tiba. Terima kasih."
    );
  }

  const jamGerbang = String(item.jam_masuk_gerbang ?? "").trim();
  const waktu = jamGerbang ? `pukul ${jamGerbang}` : "pagi hari";
  return (
    `Yth. Bapak/Ibu Wali dari ${nama}, diberitahukan bahwa ananda tercatat hadir di gerbang sekolah (${waktu}), ` +
    `namun TIDAK HADIR (Alfa) pada ${pelajaran}${pengampu}. ` +
    "Mohon konfirmasi kehadiran siswa. Terima kasih."
  );
}

/** Bentuk minimal satu baris roster yang dibutuhkan pemeriksaan ini. */
export interface RosterAttendanceCheckItem {
  nama_lengkap?: string | null;
  status?: string | null;
  jam_masuk?: string | null;
  catatan?: string | null;
}

/** Siswa yang ditandai Hadir tetapi tidak punya catatan scan gerbang hari itu. */
export function findPresentWithoutGateScan(
  items: readonly RosterAttendanceCheckItem[],
): string[] {
  return items
    .filter(
      (item) =>
        String(item.status ?? "").trim() === "Hadir" &&
        String(item.jam_masuk ?? "").trim() === "",
    )
    .map((item) => String(item.nama_lengkap ?? "").trim() || "(tanpa nama)");
}

/**
 * Pesan konfirmasi, atau `null` bila tidak ada yang perlu ditanyakan.
 *
 * Nama dibatasi lima supaya kotak dialog tetap terbaca di layar ponsel; sisanya
 * diringkas sebagai hitungan.
 */
export function buildPresentWithoutGateScanWarning(
  items: readonly RosterAttendanceCheckItem[],
): string | null {
  const names = findPresentWithoutGateScan(items);
  if (names.length === 0) return null;

  const shown = names.slice(0, 5).join(", ");
  const sisa = names.length - 5;
  const daftar = sisa > 0 ? `${shown}, dan ${sisa} lainnya` : shown;

  return (
    `${names.length} siswa ditandai Hadir tetapi belum scan gerbang hari ini:\n\n` +
    `${daftar}\n\n` +
    "Periksa sekali lagi sebelum menyimpan. Lanjutkan?"
  );
}
