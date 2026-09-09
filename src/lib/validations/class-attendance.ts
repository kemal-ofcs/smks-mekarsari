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
 * Batas atas jam pelajaran yang masuk akal dalam satu hari sekolah.
 *
 * Sengaja lebih longgar daripada 8 pilihan yang ditawarkan UI: sekolah dengan
 * 10–12 jam pelajaran tidak boleh terkunci hanya karena validator ini.
 */
export const MAX_JAM_KE = 12;

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
