import { z } from "zod";
import { ATTENDANCE_SOURCE_VALUES } from "@/lib/contracts/scanner";

const eventIdSchema = z.string().regex(/^evt-[a-f0-9]{64}$/);
const clientIdSchema = z.string().regex(/^desktop-[a-f0-9]{64}$/);
const shortText = z.string().max(255);
const longText = z.string().max(8_192);
const assetText = z.string().max(10_485_760);
const finiteNumber = z.number().finite();
const integer = z.number().int().safe();

const optionalShortText = shortText.nullable().optional();

/**
 * Gerbang nilai `absensi_harian.sumber` / `log_scan.sumber_data` di batas sync.
 *
 * Daftarnya diambil dari `@/lib/contracts/scanner` supaya validator ini tidak
 * bisa drift dari tipe yang dipakai kode aplikasi. Sebelumnya kedua kolom
 * divalidasi sebagai teks bebas, sehingga nilai di luar CHECK constraint cloud
 * lolos sampai ke outbox dan baru ditolak setelah round-trip jaringan.
 */
const optionalAttendanceSource = z
  .enum(ATTENDANCE_SOURCE_VALUES)
  .nullable()
  .optional();
const optionalLongText = longText.nullable().optional();
const optionalNumber = finiteNumber.nullable().optional();

/**
 * Batas foto profil siswa dalam karakter base64 (±500 KB).
 *
 * WAJIB sama dengan `MAX_STUDENT_PHOTO_BASE64` di `academic.rs`. Foto yang
 * lolos di perangkat tetapi ditolak di sini akan macet selamanya di outbox
 * tanpa pernah bisa berhasil — pelajaran yang sama dengan `MAX_SCAN_PHOTO_BASE64`.
 */
export const MAX_STUDENT_PHOTO_SIZE = 512_000;

/**
 * Bentuk kanonik `presensi_mapel.jam_ke` di batas sinkronisasi.
 *
 * Nilainya bisa berupa satu jam pelajaran (`3`) atau RENTANG blok dua jam
 * (`1-2`) — karena itu kolomnya TEKS, bukan INTEGER. Regex ini menutup bentuk
 * asing yang dulu lolos lewat `shortText.min(1)`; urutan awal<akhir ditegakkan
 * `normalize_jam_ke` (Rust) dan `normalizeJamKe` (TS) sebelum event dibuat.
 */
const jamKeText = z.string().regex(/^(?:[1-9]|1[0-2])(?:-(?:[1-9]|1[0-2]))?$/);

const employeeDraftFields = {
  jabatan_status: optionalShortText,
  no_hp: optionalShortText,
  lp: optionalShortText,
  id_shift: optionalNumber,
  status_aktif: optionalShortText,
  tanggal_daftar: optionalShortText,
  catatan: optionalLongText,
  jenis_personil: optionalShortText,
  tanggal_mulai_aktif: optionalShortText,
  tanggal_selesai_aktif: optionalShortText,
};

const employeeCreatePayload = z
  .object({
    id_unik: shortText.min(1),
    kode_karyawan: shortText.min(1),
    nama: shortText.min(2),
    divisi: shortText.min(1),
    ...employeeDraftFields,
    token_absensi: shortText.min(1),
    qr_code: longText.min(1),
  })
  .strict();

const employeeUpdatePayload = z
  .object({
    id_unik: optionalShortText,
    kode_karyawan: shortText.min(1),
    nama: shortText.min(2),
    divisi: shortText.min(1),
    ...employeeDraftFields,
  })
  .strict();

const shiftFields = {
  id_shift: optionalNumber,
  local_id_shift: optionalNumber,
  kode_shift: optionalNumber,
  nama_shift: shortText.min(2),
  jam_masuk: shortText.min(1),
  jam_pulang: shortText.min(1),
  awal_absen_menit: optionalNumber,
  batas_masuk_menit: optionalNumber,
  toleransi_masuk_menit: optionalNumber,
  jam_kerja_normal_menit: optionalNumber,
  istirahat_menit: optionalNumber,
  batas_pulang_menit: optionalNumber,
  offset_istirahat_mulai: optionalNumber,
  offset_generate_alfa: optionalNumber,
  buffer_shift_malam_menit: optionalNumber,
  izinkan_multi_sesi: optionalNumber,
  shift_lanjutan_id: optionalNumber,
};

const shiftCreatePayload = z
  .object({ ...shiftFields, kode_shift: finiteNumber })
  .strict();
const shiftUpdatePayload = z.object(shiftFields).strict();

const scanLogSchema = z
  .object({
    timestamp_scan: shortText.min(1),
    tanggal_kerja: optionalShortText,
    jam_scan: optionalShortText,
    id_karyawan: shortText.min(1),
    nama: optionalShortText,
    divisi: optionalShortText,
    jenis_scan: shortText.min(1),
    status_proses: optionalShortText,
    sumber_data: optionalAttendanceSource,
    catatan_sistem: optionalLongText,
    keterangan: optionalLongText,
    menit_terlambat: optionalNumber,
    menit_datang_awal: optionalNumber,
    id_referensi: optionalShortText,
    kode_operator: optionalShortText,
  })
  .strict();

const attendanceSchema = z
  .object({
    tanggal: shortText.min(1),
    id_karyawan: shortText.min(1),
    nama: optionalShortText,
    kelas_divisi: optionalShortText,
    jam_masuk: optionalShortText,
    jam_pulang: optionalShortText,
    status_kehadiran: optionalShortText,
    status_absen: optionalShortText,
    keterangan: optionalLongText,
    sumber: optionalAttendanceSource,
    update_terakhir: optionalShortText,
    menit_terlambat: optionalNumber,
    menit_datang_awal: optionalNumber,
    jam_kerja: optionalNumber,
    lembur: optionalNumber,
    jam_kerja_kurang: optionalNumber,
    id_shift: optionalNumber,
    bulan: optionalShortText,
    tahun: optionalNumber,
    id_sesi: shortText.min(1),
    mode_tugas: optionalShortText,
    id_backup: optionalShortText,
    id_karyawan_asal: optionalShortText,
    tanggal_tugas: optionalShortText,
  })
  .strict();

/**
 * Foto bukti absensi yang ikut event `attendance/scan`.
 *
 * Batas 2 juta karakter base64 (kira-kira 1,5 MB gambar) dieja sama persis di
 * `scanner.rs` (`MAX_SCAN_PHOTO_BASE64`). Foto yang lolos di perangkat tetapi
 * ditolak di sini akan macet selamanya di outbox tanpa pernah bisa berhasil.
 */
const scanPhotoSchema = z
  .object({
    id_foto: shortText.min(1),
    id_sesi: optionalShortText,
    tanggal_kerja: shortText.min(1),
    id_karyawan: shortText.min(1),
    nama: optionalShortText,
    divisi: optionalShortText,
    jenis_scan: shortText.min(1),
    timestamp_scan: shortText.min(1),
    sumber_data: optionalAttendanceSource,
    kode_operator: optionalShortText,
    ip_perangkat: optionalShortText,
    client_id: optionalShortText,
    foto_mime: z.enum(["image/jpeg", "image/png", "image/webp"]).optional(),
    foto_base64: z.string().min(1).max(2_000_000),
    created_at: optionalShortText,
  })
  .strict();

const attendanceScanPayload = z
  .object({
    log: scanLogSchema,
    attendance: attendanceSchema.nullable().optional(),
    attendanceBaseUpdatedAt: optionalShortText,
    /** Bukti foto, bila role operator terminal mewajibkannya. */
    photo: scanPhotoSchema.nullable().optional(),
    /**
     * Operator memilih "Gunakan Versi Lokal" pada konflik ini, jadi pemeriksaan
     * konkurensi optimistis (`attendanceBaseUpdatedAt`) sengaja dilewati.
     * Perlindungan prioritas Koreksi Admin TETAP berlaku.
     */
    forceLocalOverride: z.boolean().optional(),
  })
  .strict();

const correctionSchema = z
  .object({
    id_referensi: shortText.min(1),
    tanggal: optionalShortText,
    id_karyawan: optionalShortText,
    nama: optionalShortText,
    divisi: optionalShortText,
    jenis_koreksi: shortText.min(1),
    jam_koreksi: optionalShortText,
    keterangan_admin: optionalLongText,
    status_proses: optionalShortText,
    timestamp: optionalShortText,
    kode_operator: optionalShortText,
  })
  .strict();

const correctionCreatePayload = z
  .object({
    correction: correctionSchema,
    attendance: attendanceSchema,
    log: scanLogSchema,
    attendanceBaseUpdatedAt: optionalShortText,
    forceLocalOverride: z.boolean().optional(),
  })
  .strict();

const backupSchema = z
  .object({
    id_backup: shortText.min(1),
    tanggal_tugas: optionalShortText,
    id_karyawan_asal: shortText.min(1),
    nama_karyawan_asal: optionalShortText,
    divisi_asal: optionalShortText,
    id_shift_asal: optionalNumber,
    id_karyawan_pengganti: shortText.min(1),
    nama_karyawan_pengganti: optionalShortText,
    divisi_pengganti: optionalShortText,
    id_shift_normal_pengganti: optionalNumber,
    id_shift_backup: optionalNumber,
    alasan_backup: optionalLongText,
    status_tugas: optionalShortText,
    kode_operator: optionalShortText,
    waktu_input: optionalShortText,
    catatan: optionalLongText,
    waktu_dibatalkan: optionalShortText,
    operator_pembatalan: optionalShortText,
  })
  .strict();

const importSchema = z
  .object({
    event_key: shortText.min(1),
    timestamp_input: optionalShortText,
    tanggal: optionalShortText,
    id_unik: optionalShortText,
    nama: optionalShortText,
    divisi: optionalShortText,
    jam_masuk: optionalShortText,
    jam_pulang: optionalShortText,
    status_kehadiran: optionalShortText,
    status_absen: optionalShortText,
    keterangan: optionalLongText,
    status_proses: optionalShortText,
    diproses_pada: optionalShortText,
    pesan_error: optionalLongText,
    kode_operator: optionalShortText,
  })
  .strict();

const eventBase = {
  eventId: eventIdSchema,
  clientId: clientIdSchema,
  entityKey: z.string().min(1).max(160),
  baseRevision: integer.nonnegative().nullable().optional(),
  createdAt: integer.positive(),
};

function eventSchema<Domain extends string, Operation extends string>(
  domain: Domain,
  operation: Operation,
  payload: z.ZodType,
) {
  return z
    .object({
      ...eventBase,
      domain: z.literal(domain),
      operation: z.literal(operation),
      payload,
    })
    .strict();
}

const holidayCreatePayload = z
  .object({
    id_libur: optionalNumber,
    tanggal: shortText.min(1),
    nama_libur: shortText.min(1),
    jenis_libur: optionalShortText,
    keterangan: optionalLongText,
    status_aktif: optionalNumber,
  })
  .strict();

const holidayUpdatePayload = z
  .object({
    id_libur: optionalNumber,
    tanggal: optionalShortText,
    nama_libur: optionalShortText,
    jenis_libur: optionalShortText,
    keterangan: optionalLongText,
    status_aktif: optionalNumber,
  })
  .strict();

const holidayDeletePayload = z
  .object({
    id_libur: optionalNumber,
    tanggal: optionalShortText,
    nama_libur: optionalShortText,
  })
  .strict();

/**
 * Whitelist Shift/Divisi hari libur.
 *
 * `scope_value` sengaja `shortText` apa adanya — normalisasinya (kode shift
 * desimal / nama divisi yang dirapikan) dilakukan modul
 * `@/lib/validations/holiday-whitelist` di sisi produsen, dan penilaiannya
 * di sisi konsumen juga menormalkan ulang, sehingga baris yang belum kanonik
 * dari klien versi lama tetap dinilai benar.
 */
const holidayWhitelistUpsertPayload = z
  .object({
    id: shortText.min(1),
    scope_type: z.enum(["SHIFT", "DIVISI"]),
    scope_value: shortText.min(1),
    tanggal_libur: optionalShortText,
    keterangan: optionalLongText,
    status_aktif: optionalNumber,
    created_at: optionalShortText,
    updated_at: optionalShortText,
  })
  .strict();

const holidayWhitelistDeletePayload = z
  .object({
    id: shortText.min(1),
  })
  .strict();

const settingUpsertPayload = z
  .object({
    key: shortText.min(1),
    value: longText,
  })
  .strict();

const companyProfileUpdatePayload = z
  .object({
    id: optionalShortText,
    company_name: shortText.min(1),
    branch_name: optionalShortText,
    logo_url: assetText.nullable().optional(),
    signature_url: assetText.nullable().optional(),
    address: optionalLongText,
    phone: optionalShortText,
    email: optionalShortText,
    website: optionalShortText,
    leader_name: optionalShortText,
    leader_title: optionalShortText,
    leader_nip: optionalShortText,
    card_terms: optionalLongText,
    timezone: optionalShortText,
    created_at: optionalShortText,
    updated_at: optionalShortText,
  })
  .strict();

const idCardTemplateSavePayload = z
  .object({
    id: optionalShortText,
    name: shortText.min(1),
    orientation: z.enum(["portrait", "landscape"]),
    front_bg_url: assetText.nullable().optional(),
    back_bg_url: assetText.nullable().optional(),
    elements_json: assetText.min(2),
    is_active: optionalNumber,
    created_at: optionalShortText,
    updated_at: optionalShortText,
  })
  .strict();

export const operationalSyncEventSchema = z.union([
  eventSchema("employee", "create", employeeCreatePayload),
  eventSchema("employee", "update", employeeUpdatePayload),
  eventSchema(
    "employee",
    "status",
    z.object({ status_aktif: z.enum(["Aktif", "Nonaktif"]) }).strict(),
  ),
  eventSchema(
    "employee",
    "token",
    z
      .object({
        token_absensi: shortText.min(1),
        qr_code: longText.min(1),
      })
      .strict(),
  ),
  eventSchema("shift", "create", shiftCreatePayload),
  eventSchema("shift", "update", shiftUpdatePayload),
  eventSchema("shift", "delete", z.object({ id_shift: finiteNumber }).strict()),
  eventSchema("holiday", "create", holidayCreatePayload),
  eventSchema("holiday", "update", holidayUpdatePayload),
  eventSchema("holiday", "delete", holidayDeletePayload),
  eventSchema("holiday-whitelist", "create", holidayWhitelistUpsertPayload),
  eventSchema("holiday-whitelist", "update", holidayWhitelistUpsertPayload),
  eventSchema("holiday-whitelist", "delete", holidayWhitelistDeletePayload),
  eventSchema("setting", "upsert", settingUpsertPayload),
  eventSchema("setting", "update", settingUpsertPayload),
  eventSchema("company-profile", "update", companyProfileUpdatePayload),
  eventSchema("id-card-template", "save", idCardTemplateSavePayload),
  eventSchema("id-card-template", "update", idCardTemplateSavePayload),
  eventSchema("attendance", "scan", attendanceScanPayload),
  eventSchema(
    "attendance",
    "create",
    z.object({ attendance: attendanceSchema }).strict(),
  ),
  eventSchema(
    "attendance",
    "update",
    z
      .object({
        id_sesi: shortText.min(1),
        jam_masuk: optionalShortText,
        jam_pulang: optionalShortText,
        status_kehadiran: optionalShortText,
        status_absen: optionalShortText,
        keterangan: optionalLongText,
      })
      .strict(),
  ),
  eventSchema(
    "attendance",
    "delete",
    z.object({ id_sesi: shortText.min(1) }).strict(),
  ),
  eventSchema(
    "log-scan",
    "delete",
    z
      .object({
        id_log: optionalNumber,
        id_referensi: optionalShortText,
        id_karyawan: optionalShortText,
        tanggal_kerja: optionalShortText,
        timestamp_scan: optionalShortText,
      })
      .strict(),
  ),
  eventSchema("correction", "create", correctionCreatePayload),
  eventSchema(
    "correction",
    "delete",
    z.object({ id_referensi: shortText.min(1) }).strict(),
  ),
  eventSchema("backup", "create", z.object({ backup: backupSchema }).strict()),
  eventSchema(
    "backup",
    "cancel",
    z
      .object({
        id_backup: optionalShortText,
        waktu_dibatalkan: optionalShortText,
        operator_pembatalan: optionalShortText,
      })
      .strict(),
  ),
  eventSchema(
    "offline-import",
    "row",
    z
      .object({
        import: importSchema,
        attendance: attendanceSchema,
        logs: z.array(scanLogSchema).max(4),
        attendanceBaseUpdatedAt: optionalShortText,
      })
      .strict(),
  ),
  eventSchema(
    "offline-import",
    "delete",
    z.object({ event_key: shortText.min(1) }).strict(),
  ),
  eventSchema(
    "id-card",
    "update",
    z
      .object({
        id_unik: optionalShortText,
        idcard_status: z.enum(["Belum", "Berhasil", "Gagal"]),
        tanggal_generate: optionalShortText,
        idcard_last_generate: optionalShortText,
        idcard_pdf_url: assetText.nullable().optional(),
        link_qr_png: assetText.nullable().optional(),
        idcard_catatan: optionalLongText,
      })
      .strict(),
  ),
  eventSchema(
    "payroll",
    "salary-config",
    z
      .object({
        id: shortText.min(1),
        id_karyawan: shortText.min(1),
        rate_per_hour: finiteNumber,
        // Opsional: perangkat yang belum diperbarui masih mengirim baris tanpa
        // kolom ini, dan menolaknya akan membuat outbox-nya macet permanen.
        rate_per_jp: finiteNumber.optional(),
        ptkp_status: shortText.min(1),
        effective_date: shortText.min(1),
        created_by: shortText.min(1),
        created_at: shortText.min(1),
      })
      .strict(),
  ),
  eventSchema(
    "payroll",
    "jp-rate",
    z
      .object({
        id: shortText.min(1),
        id_mapel: shortText.min(1),
        // NULL berarti tarif berlaku untuk siapa pun yang mengajar mapel ini.
        id_guru: shortText.nullable().optional(),
        rate_per_jp: finiteNumber,
        effective_date: shortText.min(1),
        status_aktif: finiteNumber,
        created_at: shortText.min(1),
        updated_at: shortText.min(1),
      })
      .strict(),
  ),
  eventSchema(
    "payroll",
    "overtime-rule",
    z
      .object({
        id: shortText.min(1),
        rule_type: z.enum(["HARI_KERJA", "HARI_LIBUR"]),
        tier_order: finiteNumber,
        hour_start: finiteNumber,
        hour_end: finiteNumber.nullable().optional(),
        multiplier: finiteNumber,
        is_active: finiteNumber,
      })
      .strict(),
  ),
  eventSchema(
    "payroll",
    "payroll-component",
    z
      .object({
        id: shortText.min(1),
        name: shortText.min(1),
        category: z.enum(["ALLOWANCE", "DEDUCTION"]),
        // PER_JP dan PER_HADIR menyusul pada schema versi 25, bersama rebuild
        // CHECK constraint `payroll_components.calc_type` di ketiga jalur
        // provisioning. Daftar ini WAJIB sama dengan ketiganya.
        calc_type: z.enum(["FIXED", "PERCENTAGE", "PER_JP", "PER_HADIR"]),
        default_value: finiteNumber,
        applies_to: shortText.min(1),
        is_active: finiteNumber,
      })
      .strict(),
  ),
  eventSchema(
    "payroll",
    "tax-rule",
    z
      .object({
        id: shortText.min(1),
        category: shortText.min(1),
        bracket_min: finiteNumber,
        bracket_max: finiteNumber.nullable().optional(),
        rate_percentage: finiteNumber,
        effective_date: shortText.min(1),
      })
      .strict(),
  ),
  eventSchema(
    "payroll",
    "bpjs-rule",
    z
      .object({
        id: shortText.min(1),
        component_code: shortText.min(1),
        component_name: shortText.min(1),
        rate_percentage: finiteNumber,
        wage_cap: finiteNumber.nullable().optional(),
        effective_date: shortText.min(1),
      })
      .strict(),
  ),
  eventSchema(
    "payroll",
    "delete",
    z
      .object({
        table: z.enum([
          "salary_configs",
          "overtime_tier_rules",
          "payroll_components",
          "tax_rules",
          "bpjs_rules",
          "tarif_jp",
        ]),
        id: shortText.min(1),
      })
      .strict(),
  ),
  eventSchema(
    "payroll",
    "create-run",
    z
      .object({
        run: z.record(z.string(), z.unknown()),
        items: z.array(z.record(z.string(), z.unknown())),
        audit: z.record(z.string(), z.unknown()),
      })
      .strict(),
  ),
  eventSchema(
    "payroll",
    "transition-status",
    z
      .object({
        id: shortText.min(1),
        status: z.enum([
          "DRAFT",
          "SUBMITTED",
          "REVIEWED",
          "APPROVED",
          "PAID",
          "REJECTED",
        ]),
        updated_at: shortText.min(1),
        audit: z.record(z.string(), z.unknown()),
      })
      .strict(),
  ),
  eventSchema(
    "academic-year",
    "create",
    z
      .object({
        id_tahun_ajaran: shortText.min(1),
        nama_tahun: shortText.min(1),
        semester: z.enum(["Ganjil", "Genap"]),
        tanggal_mulai: shortText.min(1),
        tanggal_selesai: shortText.min(1),
        is_aktif: optionalNumber,
        created_at: optionalShortText,
        updated_at: optionalShortText,
      })
      .strict(),
  ),
  eventSchema(
    "academic-year",
    "update",
    z
      .object({
        id_tahun_ajaran: optionalShortText,
        nama_tahun: optionalShortText,
        semester: z.enum(["Ganjil", "Genap"]).optional(),
        tanggal_mulai: optionalShortText,
        tanggal_selesai: optionalShortText,
        is_aktif: optionalNumber,
        // `save_academic_year` memakai satu payload yang sama untuk create dan
        // update, dan `set_active_academic_year` membacakan barisnya utuh —
        // keduanya ikut membawa `created_at`.
        created_at: optionalShortText,
        updated_at: optionalShortText,
      })
      .strict(),
  ),
  eventSchema(
    "academic-year",
    "delete",
    z
      .object({
        id_tahun_ajaran: optionalShortText,
      })
      .strict(),
  ),
  eventSchema(
    "academic-department",
    "create",
    z
      .object({
        id_jurusan: shortText.min(1),
        kode_jurusan: shortText.min(1),
        nama_jurusan: shortText.min(1),
        deskripsi: optionalLongText,
        is_aktif: optionalNumber,
      })
      .strict(),
  ),
  eventSchema(
    "academic-department",
    "update",
    z
      .object({
        id_jurusan: optionalShortText,
        kode_jurusan: optionalShortText,
        nama_jurusan: optionalShortText,
        deskripsi: optionalLongText,
        is_aktif: optionalNumber,
      })
      .strict(),
  ),
  eventSchema(
    "academic-department",
    "delete",
    z
      .object({
        id_jurusan: optionalShortText,
      })
      .strict(),
  ),
  eventSchema(
    "academic-class",
    "create",
    z
      .object({
        id_rombel: shortText.min(1),
        id_tahun_ajaran: shortText.min(1),
        tingkat: finiteNumber,
        id_jurusan: optionalShortText,
        nama_rombel: shortText.min(1),
        id_wali_kelas: optionalShortText,
        kapasitas: optionalNumber,
        ruang_kelas: optionalShortText,
        is_aktif: optionalNumber,
      })
      .strict(),
  ),
  eventSchema(
    "academic-class",
    "update",
    z
      .object({
        id_rombel: optionalShortText,
        id_tahun_ajaran: optionalShortText,
        tingkat: optionalNumber,
        id_jurusan: optionalShortText,
        nama_rombel: optionalShortText,
        id_wali_kelas: optionalShortText,
        kapasitas: optionalNumber,
        ruang_kelas: optionalShortText,
        is_aktif: optionalNumber,
      })
      .strict(),
  ),
  eventSchema(
    "academic-class",
    "delete",
    z
      .object({
        id_rombel: optionalShortText,
      })
      .strict(),
  ),
  eventSchema(
    "academic-subject",
    "create",
    z
      .object({
        id_mapel: shortText.min(1),
        kode_mapel: shortText.min(1),
        nama_mapel: shortText.min(1),
        tingkat: optionalNumber,
        kelompok: z
          .enum(["Wajib", "Peminatan", "Muatan Lokal", "Kejuruan"])
          .optional(),
        beban_jam: optionalNumber,
        kkm: optionalNumber,
        is_aktif: optionalNumber,
      })
      .strict(),
  ),
  eventSchema(
    "academic-subject",
    "update",
    z
      .object({
        id_mapel: optionalShortText,
        kode_mapel: optionalShortText,
        nama_mapel: optionalShortText,
        tingkat: optionalNumber,
        kelompok: z
          .enum(["Wajib", "Peminatan", "Muatan Lokal", "Kejuruan"])
          .optional(),
        beban_jam: optionalNumber,
        kkm: optionalNumber,
        is_aktif: optionalNumber,
      })
      .strict(),
  ),
  eventSchema(
    "academic-subject",
    "delete",
    z
      .object({
        id_mapel: optionalShortText,
      })
      .strict(),
  ),
  // Jadwal mengajar mingguan. `hari` 1=Senin sampai 7=Minggu; `jam_ke` sudah
  // berbentuk kanonik karena dinormalkan `normalizeJamKe`/`normalize_jam_ke`
  // sebelum event dibuat.
  ...(["create", "update"] as const).map((operation) =>
    eventSchema(
      "teaching-schedule",
      operation,
      z
        .object({
          id_jadwal: shortText.min(1),
          id_tahun_ajaran: shortText.min(1),
          id_rombel: shortText.min(1),
          id_mapel: shortText.min(1),
          id_guru: shortText.min(1),
          hari: finiteNumber,
          jam_ke: shortText.min(1),
          is_aktif: optionalNumber,
          created_at: optionalShortText,
          updated_at: optionalShortText,
        })
        .strict(),
    ),
  ),
  eventSchema(
    "teaching-schedule",
    "delete",
    z
      .object({
        id_jadwal: optionalShortText,
      })
      .strict(),
  ),
  // Jadwal bel sekolah. `jam_mulai`/`jam_selesai` divalidasi bentuk jamnya di
  // `normalizeJamBel`, bukan di sini: aturan yang sama harus berlaku pada
  // penyimpanan lokal Rust, dan Zod hanya menjaga sisi cloud.
  eventSchema(
    "academic-period",
    "create",
    z
      .object({
        id_jam_pelajaran: shortText.min(1),
        jam_ke: finiteNumber,
        jam_mulai: shortText.min(1),
        jam_selesai: shortText.min(1),
        jenis: z.enum(["KBM", "Istirahat", "Upacara", "Ekstrakurikuler"]),
        keterangan: optionalShortText,
        is_aktif: optionalNumber,
        created_at: optionalShortText,
        updated_at: optionalShortText,
      })
      .strict(),
  ),
  eventSchema(
    "academic-period",
    "update",
    z
      .object({
        id_jam_pelajaran: shortText.min(1),
        jam_ke: finiteNumber,
        jam_mulai: shortText.min(1),
        jam_selesai: shortText.min(1),
        jenis: z.enum(["KBM", "Istirahat", "Upacara", "Ekstrakurikuler"]),
        keterangan: optionalShortText,
        is_aktif: optionalNumber,
        created_at: optionalShortText,
        updated_at: optionalShortText,
      })
      .strict(),
  ),
  eventSchema(
    "academic-period",
    "delete",
    z
      .object({
        id_jam_pelajaran: optionalShortText,
      })
      .strict(),
  ),
  eventSchema(
    "academic-assignment",
    "create",
    z
      .object({
        id_penugasan: shortText.min(1),
        id_tahun_ajaran: shortText.min(1),
        id_rombel: shortText.min(1),
        id_mapel: shortText.min(1),
        id_guru: shortText.min(1),
      })
      .strict(),
  ),
  eventSchema(
    "academic-assignment",
    "delete",
    z
      .object({
        id_penugasan: optionalShortText,
      })
      .strict(),
  ),
  eventSchema(
    "teacher",
    "create",
    z
      .object({
        id_guru: optionalShortText,
        nip: optionalShortText,
        nuptk: optionalShortText,
        gelar: optionalShortText,
        spesialisasi_mapel: optionalShortText,
        status_kepegawaian: optionalShortText,
        created_at: optionalShortText,
        updated_at: optionalShortText,
      })
      .strict(),
  ),
  eventSchema(
    "teacher",
    "update",
    z
      .object({
        id_guru: optionalShortText,
        nip: optionalShortText,
        nuptk: optionalShortText,
        gelar: optionalShortText,
        spesialisasi_mapel: optionalShortText,
        status_kepegawaian: optionalShortText,
        created_at: optionalShortText,
        updated_at: optionalShortText,
      })
      .strict(),
  ),
  eventSchema(
    "teacher",
    "delete",
    z
      .object({
        id_guru: optionalShortText,
      })
      .strict(),
  ),
  eventSchema(
    "student",
    "create",
    z
      .object({
        id_siswa: optionalShortText,
        nis: optionalShortText,
        nisn: optionalShortText,
        nama_lengkap: optionalShortText,
        jenis_kelamin: z.enum(["L", "P"]).nullable().optional(),
        id_rombel: optionalShortText,
        nama_wali: optionalShortText,
        no_whatsapp_wali: optionalShortText,
        alamat: optionalLongText,
        angkatan: optionalNumber,
        status: z
          .enum(["Aktif", "Lulus", "Pindah", "Keluar", "Drop Out"])
          .optional(),
        created_at: optionalShortText,
        updated_at: optionalShortText,
      })
      .strict(),
  ),
  eventSchema(
    "student",
    "update",
    z
      .object({
        id_siswa: optionalShortText,
        nis: optionalShortText,
        nisn: optionalShortText,
        nama_lengkap: optionalShortText,
        jenis_kelamin: z.enum(["L", "P"]).nullable().optional(),
        id_rombel: optionalShortText,
        nama_wali: optionalShortText,
        no_whatsapp_wali: optionalShortText,
        alamat: optionalLongText,
        angkatan: optionalNumber,
        status: z
          .enum(["Aktif", "Lulus", "Pindah", "Keluar", "Drop Out"])
          .optional(),
        created_at: optionalShortText,
        updated_at: optionalShortText,
      })
      .strict(),
  ),
  eventSchema(
    "student",
    "delete",
    z
      .object({
        id_siswa: optionalShortText,
      })
      .strict(),
  ),
  /**
   * Foto profil siswa yang didorong ke cloud.
   *
   * `siswa_foto` sengaja di luar `SNAPSHOT_TABLES` supaya foto tidak ikut
   * ditarik di setiap siklus pull — tetapi ia tetap harus DIDORONG, persis
   * seperti `absensi_foto` yang menumpang event `attendance/scan`.
   */
  eventSchema(
    "student-photo",
    "save",
    z
      .object({
        id_siswa: shortText.min(1),
        foto_mime: z.enum(["image/jpeg", "image/png", "image/webp"]).optional(),
        foto_base64: z.string().min(1).max(MAX_STUDENT_PHOTO_SIZE),
        updated_at: optionalShortText,
      })
      .strict(),
  ),
  eventSchema(
    "class-attendance",
    "create",
    z
      .object({
        id_presensi_mapel: shortText.min(1),
        id_tahun_ajaran: shortText.min(1),
        id_rombel: shortText.min(1),
        id_mapel: shortText.min(1),
        id_guru: shortText.min(1),
        tanggal: shortText.min(1),
        jam_ke: jamKeText,
        materi_pokok: optionalLongText,
        catatan: optionalLongText,
        total_hadir: optionalNumber,
        total_izin: optionalNumber,
        total_sakit: optionalNumber,
        total_alfa: optionalNumber,
        total_dispensasi: optionalNumber,
        created_at: optionalShortText,
        updated_at: optionalShortText,
      })
      .strict(),
  ),
  eventSchema(
    "class-attendance",
    "update",
    z
      .object({
        id_presensi_mapel: optionalShortText,
        id_tahun_ajaran: optionalShortText,
        id_rombel: optionalShortText,
        id_mapel: optionalShortText,
        id_guru: optionalShortText,
        tanggal: optionalShortText,
        jam_ke: jamKeText.optional(),
        materi_pokok: optionalLongText,
        catatan: optionalLongText,
        total_hadir: optionalNumber,
        total_izin: optionalNumber,
        total_sakit: optionalNumber,
        total_alfa: optionalNumber,
        total_dispensasi: optionalNumber,
        created_at: optionalShortText,
        updated_at: optionalShortText,
      })
      .strict(),
  ),
  eventSchema(
    "class-attendance",
    "delete",
    z
      .object({
        id_presensi_mapel: optionalShortText,
      })
      .strict(),
  ),
  eventSchema(
    "class-attendance-detail",
    "delete",
    z
      .object({
        id_detail: optionalShortText,
        id_presensi_mapel: optionalShortText,
        id_siswa: optionalShortText,
      })
      .strict(),
  ),
  eventSchema(
    "class-attendance-detail",
    "save",
    z
      .object({
        id_detail: shortText.min(1),
        id_presensi_mapel: shortText.min(1),
        id_siswa: shortText.min(1),
        status: z.enum(["Hadir", "Izin", "Sakit", "Alfa", "Dispensasi"]),
        catatan: optionalLongText,
        created_at: optionalShortText,
        updated_at: optionalShortText,
      })
      .strict(),
  ),
  eventSchema(
    "teaching-journal",
    "save",
    z
      .object({
        id_jurnal: shortText.min(1),
        id_presensi_mapel: shortText.min(1),
        materi_disampaikan: optionalLongText,
        kendala: optionalLongText,
        tindak_lanjut: optionalLongText,
        paraf_nama: optionalShortText,
        paraf_operator: optionalShortText,
        paraf_at: optionalShortText,
        created_at: optionalShortText,
        updated_at: optionalShortText,
      })
      .strict(),
  ),
  eventSchema(
    "teaching-journal",
    "delete",
    z
      .object({
        id_jurnal: optionalShortText,
        id_presensi_mapel: optionalShortText,
      })
      .strict(),
  ),
  eventSchema(
    "attendance-ledger",
    "freeze",
    z
      .object({
        id_leger: shortText.min(1),
        id_tahun_ajaran: shortText.min(1),
        semester: z.enum(["Ganjil", "Genap"]),
        id_siswa: shortText.min(1),
        id_rombel: shortText.min(1),
        total_hari_efektif: z.number().int().min(0),
        hadir: z.number().int().min(0),
        izin: z.number().int().min(0),
        sakit: z.number().int().min(0),
        alfa: z.number().int().min(0),
        dispensasi: z.number().int().min(0),
        persen_kehadiran: z.number().min(0).max(100),
        dibekukan_at: optionalShortText,
        dibekukan_oleh: optionalShortText,
        created_at: optionalShortText,
        updated_at: optionalShortText,
      })
      .strict(),
  ),
  eventSchema(
    "attendance-ledger",
    "delete",
    z
      .object({
        id_leger: optionalShortText,
        id_tahun_ajaran: optionalShortText,
        semester: z.enum(["Ganjil", "Genap"]).optional(),
        id_rombel: optionalShortText,
      })
      .strict(),
  ),
  eventSchema(
    "wa-notification",
    "queue",
    z
      .object({
        id_notifikasi: shortText.min(1),
        dedupe_key: shortText.min(1),
        jenis: z.enum(["scan_masuk", "scan_pulang", "bolos", "ambang_alfa"]),
        id_siswa: optionalShortText,
        tujuan_nomor: shortText.min(1),
        isi_pesan: z.string().min(1).max(5000),
        status: z
          .enum(["Menunggu", "Terkirim", "Gagal", "Dibatalkan"])
          .optional(),
        created_at: optionalShortText,
        updated_at: optionalShortText,
      })
      .strict(),
  ),
  eventSchema(
    "wa-notification",
    "cancel",
    z
      .object({
        id_notifikasi: shortText.min(1),
        alasan: optionalShortText,
      })
      .strict(),
  ),
]);

export const studentPhotoUploadSchema = z
  .object({
    id_siswa: shortText.min(1),
    foto_mime: z
      .enum(["image/jpeg", "image/png", "image/webp"])
      .default("image/jpeg"),
    foto_base64: z.string().min(1).max(MAX_STUDENT_PHOTO_SIZE),
  })
  .strict();

export type OperationalSyncEvent = {
  eventId: string;
  clientId: string;
  domain: string;
  operation: string;
  entityKey: string;
  payload: Record<string, unknown>;
  baseRevision?: number | null;
  createdAt: number;
};

export const operationalSyncBatchSchema = z
  .object({
    clientId: clientIdSchema,
    // Versi skema yang dipahami client pengirim; dicocokkan dengan
    // CURRENT_SCHEMA_VERSION di route push. Opsional agar client lama yang
    // belum mengirim field ini tetap terbaca — mereka ditolak di route dengan
    // pesan yang jelas, bukan gagal validasi yang membingungkan.
    schemaVersion: z.number().int().min(0).optional(),
    events: z.array(operationalSyncEventSchema).min(1).max(50),
  })
  .strict()
  .superRefine((batch, context) => {
    batch.events.forEach((event, index) => {
      if (event.clientId !== batch.clientId) {
        context.addIssue({
          code: "custom",
          message: "Identitas client sinkronisasi berbeda.",
          path: ["events", index, "clientId"],
        });
      }
    });
  });

export function parseOperationalSyncBatch(input: unknown): {
  clientId: string;
  schemaVersion?: number;
  events: OperationalSyncEvent[];
} {
  return operationalSyncBatchSchema.parse(input) as {
    clientId: string;
    schemaVersion?: number;
    events: OperationalSyncEvent[];
  };
}

export function safeParseOperationalSyncEvent(input: unknown) {
  return operationalSyncEventSchema.safeParse(input);
}
