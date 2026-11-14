export const PERMISSION_CATALOG = [
  { key: "home.view", name: "Lihat Home", group: "Utama" },
  { key: "scanner.use", name: "Gunakan QR Scanner", group: "Utama" },
  { key: "dashboard.view", name: "Lihat Dashboard", group: "Utama" },
  { key: "dashboard.export", name: "Export laporan", group: "Utama" },
  { key: "employees.view", name: "Lihat karyawan", group: "Manajemen" },
  { key: "employees.manage", name: "Kelola karyawan", group: "Manajemen" },
  { key: "shifts.view", name: "Lihat shift", group: "Manajemen" },
  { key: "shifts.manage", name: "Kelola shift", group: "Manajemen" },
  { key: "holidays.view", name: "Lihat hari libur", group: "Manajemen" },
  { key: "holidays.manage", name: "Kelola hari libur", group: "Manajemen" },
  {
    key: "corrections.view",
    name: "Lihat koreksi admin",
    group: "Operasional",
  },
  {
    key: "corrections.manage",
    name: "Kelola koreksi admin",
    group: "Operasional",
  },
  { key: "backups.view", name: "Lihat penugasan backup", group: "Operasional" },
  {
    key: "backups.manage",
    name: "Kelola penugasan backup",
    group: "Operasional",
  },
  {
    key: "alfa.trigger",
    name: "Jalankan Generate Alfa Manual",
    group: "Operasional",
  },
  {
    key: "attendance_audit.view",
    name: "Lihat audit absensi",
    group: "Operasional",
  },
  {
    key: "operational.edit",
    name: "Edit Data Operasional",
    group: "Operasional",
  },
  {
    key: "operational.delete",
    name: "Hapus Data Operasional",
    group: "Operasional",
  },
  {
    key: "history.edit",
    name: "Edit Riwayat Absensi",
    group: "Riwayat",
  },
  {
    key: "history.delete",
    name: "Hapus Riwayat Absensi",
    group: "Riwayat",
  },
  // MENGAJUKAN reset password tidak butuh izin apa pun — alur "Lupa Password"
  // memang terbuka untuk semua akun tanpa sesi login. Dua izin di bawah hanya
  // mengatur siapa yang boleh MELIHAT dan MENGHAPUS riwayat pengajuan itu,
  // karena riwayatnya menyimpan foto wajah pemohon.
  {
    key: "password_reset.view",
    name: "Lihat Riwayat Reset Password",
    group: "Sistem",
  },
  {
    key: "password_reset.delete",
    name: "Hapus Riwayat Reset Password",
    group: "Sistem",
  },
  // MENGAKTIFKAN 2FA untuk akun sendiri tidak butuh izin apa pun — setiap
  // operator berhak mengamankan akunnya, termasuk role paling terbatas.
  // Yang di-RBAC adalah MEMATIKAN 2FA milik orang lain.
  {
    key: "two_factor.reset",
    name: "Reset 2FA Operator Lain",
    group: "Sistem",
  },
  // Foto bukti absensi memperlihatkan wajah dan lokasi orang saat scan, jadi
  // membacanya adalah hak yang diberikan sadar — bukan bagian dari melihat
  // rekap absensi biasa. MENGAMBIL fotonya tidak butuh izin: kewajibannya
  // ditentukan sakelar role pada halaman Master Operator, bukan permission.
  {
    key: "attendance_photo.view",
    name: "Lihat Foto Bukti Absensi",
    group: "Sistem",
  },
  {
    key: "attendance_photo.delete",
    name: "Hapus Foto Bukti Absensi",
    group: "Sistem",
  },
  // Wajah terdaftar untuk verifikasi 1:1 saat scan. MENGELOLANYA sensitif:
  // wajah orang lain yang didaftarkan di nama seseorang membuat kartu yang
  // dipinjamkan lolos pemeriksaan.
  {
    key: "face_template.view",
    name: "Lihat Pendaftaran Wajah",
    group: "Sistem",
  },
  {
    key: "face_template.manage",
    name: "Kelola Pendaftaran Wajah",
    group: "Sistem",
  },
  // Portabilitas data. MEMBUAT cadangan tidak butuh izin khusus di luar ini,
  // tetapi berkasnya memuat hash password, rahasia TOTP, dan foto absensi —
  // jadi mengeluarkannya dari perangkat adalah tindakan yang harus diberikan
  // sadar, bukan ikut paket bawaan.
  {
    key: "password_reset.approve",
    name: "Setujui Pemulihan Password",
    group: "Sistem",
  },
  {
    key: "database_backup.export",
    name: "Ekspor Cadangan Database",
    group: "Sistem",
  },
  {
    key: "database_backup.restore",
    name: "Pulihkan Database dari Cadangan",
    group: "Sistem",
  },
  { key: "operators.view", name: "Lihat Master Operator", group: "Sistem" },
  { key: "operators.manage", name: "Kelola Master Operator", group: "Sistem" },
  { key: "roles.manage", name: "Kelola Role & Akses", group: "Sistem" },
  {
    key: "settings.manage",
    name: "Kelola Pengaturan Sistem & Auto Alfa",
    group: "Sistem",
  },
  {
    key: "branding.manage",
    name: "Kelola identitas aplikasi",
    group: "Sistem",
  },
  { key: "sync.view", name: "Lihat status sinkronisasi", group: "Sistem" },
  { key: "sync.retry", name: "Ulangi sinkronisasi", group: "Sistem" },
  { key: "diagnostics.view", name: "Lihat diagnostik", group: "Sistem" },
  {
    key: "payroll.view",
    name: "Lihat Rekap & Estimasi Gaji",
    group: "Penggajian",
  },
  {
    key: "payroll.run.create",
    name: "Buat & Jalankan Batch Payroll",
    group: "Penggajian",
  },
  {
    key: "payroll.run.review",
    name: "Review Batch Payroll",
    group: "Penggajian",
  },
  {
    key: "payroll.run.approve",
    name: "Setujui Batch Payroll",
    group: "Penggajian",
  },
  {
    key: "payroll.run.disburse",
    name: "Tandai Dibayar & Kunci Slip",
    group: "Penggajian",
  },
  {
    key: "payroll.config.manage",
    name: "Kelola Tarif, Lembur & Pajak",
    group: "Penggajian",
  },
  {
    key: "payroll.export",
    name: "Export Laporan & Slip Gaji",
    group: "Penggajian",
  },
  {
    key: "payroll.rapel.manage",
    name: "Hitung & Setujui Rapel Gaji",
    group: "Penggajian",
  },
  { key: "academic.view", name: "Lihat Struktur Akademik", group: "Akademik" },
  {
    key: "academic.manage",
    name: "Kelola Struktur Akademik",
    group: "Akademik",
  },
  { key: "students.view", name: "Lihat Data Siswa", group: "Akademik" },
  { key: "students.manage", name: "Kelola Data Siswa", group: "Akademik" },
  {
    key: "students.reset_wali_password",
    name: "Reset / Terbitkan Password Wali",
    group: "Akademik",
  },
  { key: "teachers.view", name: "Lihat Data Guru & PTK", group: "Akademik" },
  { key: "teachers.manage", name: "Kelola Data Guru & PTK", group: "Akademik" },
  {
    key: "class_attendance.view",
    name: "Lihat Presensi Jam Mapel",
    group: "Akademik",
  },
  {
    key: "class_attendance.manage",
    name: "Kelola Presensi Jam Mapel",
    group: "Akademik",
  },
  {
    key: "class_attendance.delete",
    name: "Hapus Sesi Presensi Mapel",
    group: "Akademik",
  },
  {
    key: "teaching_journal.view",
    name: "Lihat Jurnal Mengajar",
    group: "Akademik",
  },
  {
    key: "teaching_journal.manage",
    name: "Kelola Jurnal Mengajar",
    group: "Akademik",
  },
  {
    key: "teaching_journal.delete",
    name: "Hapus Jurnal Mengajar",
    group: "Akademik",
  },
  {
    key: "attendance_ledger.view",
    name: "Lihat Leger Kehadiran",
    group: "Akademik",
  },
  {
    key: "attendance_ledger.manage",
    name: "Kelola & Bekukan Leger Kehadiran",
    group: "Akademik",
  },
  {
    key: "attendance_ledger.delete",
    name: "Batalkan Pembekuan Leger Kehadiran",
    group: "Akademik",
  },
  {
    key: "attendance_dashboard.view",
    name: "Lihat Dasbor Audit Kehadiran",
    group: "Akademik",
  },
  {
    key: "notification.view",
    name: "Lihat Antrean Notifikasi WhatsApp",
    group: "Komunikasi",
  },
  {
    key: "notification.manage",
    name: "Kelola Pengaturan Notifikasi",
    group: "Komunikasi",
  },
  {
    key: "notification.send",
    name: "Kirim Pesan WhatsApp ke Wali Murid",
    group: "Komunikasi",
  },
  {
    key: "notification.delete",
    name: "Batalkan / Hapus Antrean Notifikasi",
    group: "Komunikasi",
  },
  {
    key: "notification.template",
    name: "Ubah Teks Pesan WhatsApp",
    group: "Komunikasi",
  },
  {
    key: "counseling.view",
    name: "Lihat Kasus Bimbingan Konseling (BK)",
    group: "Kesiswaan",
  },
  {
    key: "counseling.manage",
    name: "Kelola Kasus & Sesi Konseling (BK)",
    group: "Kesiswaan",
  },
  {
    key: "counseling.delete",
    name: "Hapus Kasus Bimbingan Konseling (BK)",
    group: "Kesiswaan",
  },
  {
    key: "pmb.view",
    name: "Lihat Pendaftar PMB",
    group: "Kesiswaan",
  },
  {
    key: "pmb.manage",
    name: "Kelola Gelombang & Verifikasi PMB",
    group: "Kesiswaan",
  },
  {
    key: "pmb.delete",
    name: "Hapus Pendaftar PMB",
    group: "Kesiswaan",
  },
  {
    key: "pmb.promote",
    name: "Jadikan Pendaftar Sebagai Siswa",
    group: "Kesiswaan",
  },
  {
    key: "grades.view",
    name: "Lihat Nilai Akademik",
    group: "Akademik",
  },
  {
    key: "grades.manage",
    name: "Kelola Penilaian & Input Nilai",
    group: "Akademik",
  },
  {
    key: "grades.configure",
    name: "Atur Jenis & Bobot Nilai",
    group: "Akademik",
  },
  {
    key: "grades.delete",
    name: "Hapus Penilaian Beserta Nilainya",
    group: "Akademik",
  },
  {
    key: "content.view",
    name: "Lihat Konten & Berita CMS",
    group: "Situs Publik",
  },
  {
    key: "content.manage",
    name: "Kelola Konten & Berita CMS",
    group: "Situs Publik",
  },
  {
    key: "content.delete",
    name: "Hapus Konten & Berita CMS",
    group: "Situs Publik",
  },
  {
    key: "inventory.view",
    name: "Lihat Inventaris",
    group: "Sarpras",
  },
  {
    key: "inventory.manage",
    name: "Kelola Master Barang",
    group: "Sarpras",
  },
  {
    key: "inventory.record",
    name: "Catat Barang Masuk, Keluar & Pindah",
    group: "Sarpras",
  },
  {
    key: "inventory.adjust",
    name: "Koreksi & Batalkan Mutasi Inventaris",
    group: "Sarpras",
  },
  {
    key: "inventory.column.delete",
    name: "Hapus Permanen Kolom Tambahan",
    group: "Sarpras",
  },
  {
    key: "inventory.item.delete",
    name: "Hapus Barang Inventaris",
    group: "Sarpras",
  },
  {
    key: "uks.view",
    name: "Lihat Buku Kunjungan UKS",
    group: "UKS",
  },
  {
    key: "uks.record",
    name: "Catat Kunjungan UKS & Obat",
    group: "UKS",
  },
  {
    key: "uks.delete",
    name: "Hapus Kunjungan UKS",
    group: "UKS",
  },
  {
    key: "accounting.view",
    name: "Lihat Pembukuan",
    group: "Keuangan",
  },
  {
    key: "accounting.manage",
    name: "Kelola Akun & Catat Jurnal",
    group: "Keuangan",
  },
  {
    key: "accounting.reverse",
    name: "Batalkan Jurnal",
    group: "Keuangan",
  },
  {
    key: "accounting.close",
    name: "Tutup Buku",
    group: "Keuangan",
  },
  {
    key: "installment.cancel",
    name: "Batalkan Pembayaran & Tutup Kontrak Cicilan",
    group: "Keuangan",
  },
  {
    key: "loan.view",
    name: "Lihat Kasbon Karyawan",
    group: "Keuangan",
  },
  {
    key: "loan.manage",
    name: "Ajukan & Kelola Kasbon",
    group: "Keuangan",
  },
  {
    key: "loan.approve",
    name: "Setujui & Batalkan Kasbon",
    group: "Keuangan",
  },
  {
    key: "billing.view",
    name: "Lihat Tagihan Siswa",
    group: "Keuangan",
  },
  {
    key: "billing.manage",
    name: "Kelola & Terbitkan Tagihan",
    group: "Keuangan",
  },
  {
    key: "billing.collect",
    name: "Catat Pembayaran Tagihan",
    group: "Keuangan",
  },
  {
    key: "billing.cancel",
    name: "Batalkan Tagihan & Kuitansi",
    group: "Keuangan",
  },
  // HRIS Fase 1 (`prd-hris.md` §19.4).
  {
    key: "hr.org.manage",
    name: "Kelola Organisasi Kepegawaian",
    group: "Kepegawaian",
  },
  {
    key: "hr.contract.manage",
    name: "Kelola Kontrak & Status Kepegawaian",
    group: "Kepegawaian",
  },
  {
    key: "hr.duty.manage",
    name: "Kelola Tugas Tambahan",
    group: "Kepegawaian",
  },
  {
    key: "hr.personal.view",
    name: "Lihat Data Pribadi Pegawai",
    group: "Kepegawaian",
  },
  {
    key: "hr.personal.manage",
    name: "Ubah Data Pribadi Pegawai",
    group: "Kepegawaian",
  },
  {
    key: "hr.finance.view",
    name: "Lihat Data Keuangan Pegawai",
    group: "Kepegawaian",
  },
  {
    key: "hr.finance.manage",
    name: "Ubah Data Keuangan Pegawai",
    group: "Kepegawaian",
  },
  {
    key: "hr.document.view",
    name: "Lihat Dokumen Pegawai",
    group: "Kepegawaian",
  },
  {
    key: "hr.document.manage",
    name: "Kelola Dokumen Pegawai",
    group: "Kepegawaian",
  },
  // HRIS Fase 2 (`prd-hris.md` §20.4).
  {
    key: "hr.request.view",
    name: "Lihat Pengajuan Cuti & Izin",
    group: "Kepegawaian",
  },
  {
    key: "hr.request.submit",
    name: "Ajukan Cuti & Izin Pegawai",
    group: "Kepegawaian",
  },
  {
    key: "hr.request.urgent",
    name: "Setujui Pengajuan Urgent",
    group: "Kepegawaian",
  },
  {
    key: "hr.request.decide",
    name: "Putuskan Cuti & Izin",
    group: "Kepegawaian",
  },
  {
    key: "hr.request.decide_major",
    name: "Putuskan Cuti Panjang",
    group: "Kepegawaian",
  },
  {
    key: "hr.scope.all",
    name: "Semua Unit Kepegawaian",
    group: "Kepegawaian",
  },
  {
    key: "hr.substitute.manage",
    name: "Tangani Jam Kosong",
    group: "Kepegawaian",
  },
  {
    key: "hr.leave.adjust",
    name: "Sesuaikan Jatah Cuti",
    group: "Kepegawaian",
  },
  // HRIS Fase 4 (`prd-hris.md` §22.4).
  {
    key: "hr.warning.view",
    name: "Lihat Surat Peringatan",
    group: "Kepegawaian",
  },
  {
    key: "hr.warning.manage",
    name: "Buat Surat Peringatan",
    group: "Kepegawaian",
  },
  {
    key: "hr.warning.sp3",
    name: "Terbitkan SP3",
    group: "Kepegawaian",
  },
  {
    key: "hr.warning.cancel",
    name: "Cabut Surat Peringatan",
    group: "Kepegawaian",
  },
  {
    key: "hr.offboard.view",
    name: "Lihat Pegawai Keluar",
    group: "Kepegawaian",
  },
  {
    key: "hr.offboard.manage",
    name: "Siapkan Pegawai Keluar",
    group: "Kepegawaian",
  },
  {
    key: "hr.offboard.decide",
    name: "Berlakukan Pegawai Keluar",
    group: "Kepegawaian",
  },
] as const;

export type PermissionKey = (typeof PERMISSION_CATALOG)[number]["key"];

export const SUPERADMIN_ONLY_PERMISSIONS = new Set<PermissionKey>([
  "operators.view",
  "operators.manage",
  "roles.manage",
  "payroll.config.manage",
]);

export const SENSITIVE_MUTATION_PERMISSIONS = new Set<PermissionKey>([
  "history.edit",
  "history.delete",
  "operational.edit",
  "operational.delete",
  // Menghapus riwayat reset menghilangkan satu-satunya jejak siapa yang pernah
  // mengajukan pemulihan beserta foto wajahnya. Tidak ikut paket bawaan Admin —
  // harus diberikan sadar lewat Role & Akses, sama seperti hak hapus data
  // operasional.
  "password_reset.delete",
  // Mematikan 2FA orang lain melucuti lapisan kedua akunnya. Berguna ketika
  // ponsel hilang, tetapi juga jalan pintas bagi siapa pun yang ingin
  // melemahkan akun sebelum menyerangnya — jadi harus diberikan sadar.
  "two_factor.reset",
  // Menghapus foto bukti absensi menghilangkan satu-satunya bukti visual bahwa
  // sebuah scan benar dilakukan orang yang bersangkutan.
  "attendance_photo.delete",
  // Wajah yang salah di nama seseorang meloloskan kartu yang dipinjamkan.
  "face_template.manage",
  // Memulihkan cadangan MENIMPA seluruh data perusahaan sekaligus — absensi,
  // payroll, operator, dan hak aksesnya. Tidak ada operasi lain di aplikasi ini
  // yang bisa menghapus sebanyak itu dalam satu langkah.
  "database_backup.restore",
  // Menyetujui pemulihan berarti menyerahkan kendali sebuah akun kepada orang
  // yang sedang berdiri di depan layar. Peninjaunya WAJIB sadar memikul itu,
  // jadi tidak ikut paket bawaan Admin.
  "password_reset.approve",
  // Menghapus sesi presensi memusnahkan seluruh rekam jejak kehadiran kelas jam
  // tersebut beserta seluruh detail siswa.
  "class_attendance.delete",
  // Menghapus jurnal menghilangkan catatan kendala kelas dan bukti penyampaian materi.
  "teaching_journal.delete",
  // Membatalkan pembekuan leger membuka kembali angka kehadiran yang sudah disahkan untuk rapor.
  "attendance_ledger.delete",
  // Mengirim pesan langsung membebani kuota API/biaya dan mengirim komunikasi resmi ke wali.
  "notification.send",
  // Membatalkan/menghapus antrean notifikasi menghilangkan antrean pemberitahuan wali.
  "notification.delete",
  // Teks pesan otomatis dikirim atas nama sekolah ke setiap nomor wali, dan
  // pesan yang sudah terkirim tidak bisa ditarik kembali.
  "notification.template",
  // Menghapus kasus BK memusnahkan rekam jejak konseling dan kedisiplinan siswa.
  "counseling.delete",
  // Menghapus pendaftar PMB memusnahkan berkas identitas seorang anak — kartu
  // keluarga, akta kelahiran, ijazah — yang diunggah keluarganya dan tidak
  // tersimpan di tempat lain mana pun di sistem ini.
  "pmb.delete",
  // Mengangkat pendaftar menjadi siswa membuat baris `master_data`, `siswa_data`,
  // dan `id_card` sekaligus, lalu menyebarkannya ke SELURUH perangkat lewat
  // sinkronisasi. Ia juga menerbitkan token QR yang langsung bisa dipakai
  // memindai absensi. Bukan aksi yang pantas ikut paket bawaan Admin.
  "pmb.promote",
  // Menghapus satu penilaian memusnahkan skor SELURUH kelas untuk peristiwa itu,
  // dan tidak ada jalan memulihkannya selain menilai ulang. Alasan yang sama
  // dengan .
  "grades.delete",
  "grades.configure",
  // Reset password wali menerbitkan kredensial login baru dan mencabut sesi wali yang sedang aktif.
  "students.reset_wali_password",
  // Menghapus berita atau artikel dari CMS situs publik.
  "content.delete",
  // Pembatalan, opname, dan penghapusan stok mengurangi stok tanpa barangnya
  // diterima siapa pun — cara paling mudah menutupi barang yang diambil orang.
  "inventory.adjust",
  // Menghapus kolom tambahan memusnahkan isinya di SEMUA barang sekaligus, dan
  // tidak ada jalan mengembalikannya.
  "inventory.column.delete",
  // Menghapus barang mengeluarkannya dari daftar, label, dan impor di semua
  // perangkat, dan tidak bisa dikembalikan dari aplikasi.
  "inventory.item.delete",
  // Menghapus kunjungan UKS menghilangkan satu-satunya catatan siapa yang
  // ditangani, kapan, dan obat apa yang diberikan untuknya.
  "uks.delete",
  // Membatalkan jurnal mengubah saldo setiap akun yang disentuhnya. Jejaknya
  // tetap ada (jurnal pembalik), tetapi pembatalan yang tidak semestinya
  // adalah cara paling halus menghapus transaksi dari laporan.
  "accounting.reverse",
  // Menyetujui kasbon mencairkan uang sekolah ke tangan seseorang, dan
  // membatalkannya menghapus piutangnya dari pembukuan.
  "loan.approve",
  // Membatalkan tagihan menghapus piutang seorang siswa dari pembukuan.
  "billing.cancel",
  // Menutup buku membuat setiap perangkat menolak pencatatan di periode itu,
  // dan memutuskan bentrokan tutup buku menentukan potret saldo resmi.
  "accounting.close",
  // Menyetujui rapel berarti mengeluarkan uang sekolah di proses gaji berikutnya.
  "payroll.rapel.manage",
  // Membatalkan pembayaran cicilan membalik jurnalnya, dan menutup kontrak
  // membuat sisa utangnya hanya bisa dibereskan dengan jurnal manual.
  "installment.cancel",
  // Rekening, NPWP, dan BPJS pegawai menentukan ke mana gaji dibayar dan atas
  // nama siapa pajaknya dilaporkan.
  "hr.finance.manage",
  // HRIS Fase 2 (§20.4): memutus dan menyesuaikan jatah membayar hari
  // yang tidak hadir; urgent = menyetujui sekaligus (Q-49).
  "hr.request.urgent",
  "hr.request.decide",
  "hr.request.decide_major",
  "hr.scope.all",
  "hr.leave.adjust",
  // HRIS Fase 4 (§22.4): SP3 dan Berlakukan/Batalkan keluar adalah keputusan
  // Yayasan; mencabut SP menghapus dasar eskalasi.
  "hr.warning.sp3",
  "hr.warning.cancel",
  "hr.offboard.decide",
]);

/**
 * Izin data rahasia pegawai (Q-33): tidak sensitif, tetapi juga tidak ikut
 * paket bawaan Admin, yang memuat setiap izin tidak sensitif. NIK, rekening,
 * dan pindaian KTP diberikan sadar lewat Role & Akses atau role Kepegawaian.
 * `hr.finance.manage` ada di `SENSITIVE_MUTATION_PERMISSIONS`. Cermin
 * `ADMIN_DEFAULT_EXCLUDED_PERMISSIONS` di `turso.rs`.
 */
export const CONFIDENTIAL_PERMISSIONS = new Set<PermissionKey>([
  "hr.personal.view",
  "hr.personal.manage",
  "hr.finance.view",
  "hr.document.view",
  "hr.document.manage",
  // Isi SP dan pesangon (§22.4).
  "hr.warning.view",
  "hr.warning.manage",
  "hr.offboard.view",
  "hr.offboard.manage",
]);

export const SYSTEM_ROLE_KEYS = [
  "superadmin",
  "admin",
  "operator",
  "scanner",
  // HRIS Fase 1 (Q-34); Kepala TU dan Guru Piket di Fase 2 (§20.4).
  "yayasan",
  "kepala-sekolah",
  "kepegawaian",
  "kepala-tu",
  "guru-piket",
] as const;

export type SystemRoleKey = (typeof SYSTEM_ROLE_KEYS)[number];

export const DEFAULT_ROLE_PERMISSIONS: Record<
  Exclude<SystemRoleKey, "superadmin">,
  readonly PermissionKey[]
> = {
  admin: PERMISSION_CATALOG.filter(
    ({ key }) =>
      !SUPERADMIN_ONLY_PERMISSIONS.has(key) &&
      key !== "diagnostics.view" &&
      !SENSITIVE_MUTATION_PERMISSIONS.has(key) &&
      !CONFIDENTIAL_PERMISSIONS.has(key),
  ).map(({ key }) => key),
  operator: [
    "home.view",
    "scanner.use",
    "dashboard.view",
    "employees.view",
    "shifts.view",
    "sync.view",
    "academic.view",
    "students.view",
    "teachers.view",
    "class_attendance.view",
    "teaching_journal.view",
    "attendance_ledger.view",
    "attendance_dashboard.view",
    "notification.view",
    "counseling.view",
    // Ikut paket bawaan operator supaya role yang sudah ada tidak terkunci dari
    // halaman yang akan mereka pakai begitu modulnya hidup.
    "grades.view",
    "content.view",
    "inventory.view",
  ],
  scanner: ["home.view", "scanner.use", "sync.view"],
  // Cermin `ROLE_HRIS_BAWAAN` di `turso.rs`.
  yayasan: [
    "home.view",
    "employees.view",
    "teachers.view",
    "hr.org.manage",
    "hr.contract.manage",
    "hr.duty.manage",
    "hr.request.view",
    "hr.request.submit",
    "hr.request.decide",
    "hr.request.decide_major",
    "hr.scope.all",
    "hr.warning.view",
    "hr.warning.manage",
    "hr.warning.sp3",
    "hr.warning.cancel",
    "hr.offboard.view",
    "hr.offboard.manage",
    "hr.offboard.decide",
  ],
  "kepala-sekolah": [
    "home.view",
    "employees.view",
    "teachers.view",
    "hr.duty.manage",
    "hr.request.view",
    "hr.request.submit",
    "hr.request.urgent",
    "hr.request.decide",
    "hr.substitute.manage",
    "hr.warning.view",
    "hr.warning.manage",
  ],
  kepegawaian: [
    "home.view",
    "employees.view",
    "employees.manage",
    "teachers.view",
    "teachers.manage",
    "hr.org.manage",
    "hr.contract.manage",
    "hr.duty.manage",
    "hr.personal.view",
    "hr.personal.manage",
    "hr.finance.view",
    "hr.finance.manage",
    "hr.document.view",
    "hr.document.manage",
    "hr.request.view",
    "hr.request.submit",
    "hr.substitute.manage",
    "hr.leave.adjust",
    "hr.warning.view",
    "hr.offboard.view",
    "hr.offboard.manage",
  ],
  "kepala-tu": [
    "home.view",
    "employees.view",
    "hr.request.view",
    "hr.request.submit",
    "hr.request.urgent",
    "hr.request.decide",
  ],
  "guru-piket": ["home.view", "sync.view", "hr.substitute.manage"],
};

export function normalizeRoleKey(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function isPermissionKey(value: string): value is PermissionKey {
  return PERMISSION_CATALOG.some(({ key }) => key === value);
}
