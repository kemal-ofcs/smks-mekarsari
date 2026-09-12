import { describe, expect, test } from "bun:test";
import {
  operationalSyncBatchSchema,
  operationalSyncEventSchema,
} from "@/lib/server/operational/sync-schema";

function shiftEvent() {
  return {
    eventId: `evt-${"a".repeat(64)}`,
    clientId: `desktop-${"b".repeat(64)}`,
    domain: "shift",
    operation: "create",
    entityKey: "kode:90",
    payload: {
      local_id_shift: -90,
      kode_shift: 90,
      nama_shift: "Shift Sinkronisasi",
      jam_masuk: "08:00",
      jam_pulang: "16:00",
    },
    baseRevision: null,
    createdAt: 1_786_300_000,
  };
}

describe("operational sync schema", () => {
  test("menerima event dengan domain dan operasi yang didukung", () => {
    expect(operationalSyncEventSchema.safeParse(shiftEvent()).success).toBe(
      true,
    );
    expect(
      operationalSyncEventSchema.safeParse({
        eventId: `evt-${"a".repeat(64)}`,
        clientId: `desktop-${"b".repeat(64)}`,
        domain: "holiday",
        operation: "create",
        entityKey: "2026-08-17",
        payload: {
          id_libur: -1,
          tanggal: "2026-08-17",
          nama_libur: "Hari Kemerdekaan RI",
          jenis_libur: "Libur Nasional",
          status_aktif: 1,
        },
        baseRevision: null,
        createdAt: 1_786_300_000,
      }).success,
    ).toBe(true);
    expect(
      operationalSyncEventSchema.safeParse({
        eventId: `evt-${"a".repeat(64)}`,
        clientId: `desktop-${"b".repeat(64)}`,
        domain: "setting",
        operation: "upsert",
        entityKey: "auto_alfa_aktif",
        payload: {
          key: "auto_alfa_aktif",
          value: "true",
        },
        baseRevision: null,
        createdAt: 1_786_300_000,
      }).success,
    ).toBe(true);
    expect(
      operationalSyncEventSchema.safeParse({
        eventId: `evt-${"a".repeat(64)}`,
        clientId: `desktop-${"b".repeat(64)}`,
        domain: "company-profile",
        operation: "update",
        entityKey: "default_company",
        payload: {
          id: "default_company",
          company_name: "SPPG Pusat",
          timezone: "Asia/Jakarta",
          created_at: "2026-08-20T00:00:00.000Z",
          updated_at: "2026-08-20T00:00:00.000Z",
        },
        baseRevision: null,
        createdAt: 1_786_300_000,
      }).success,
    ).toBe(true);
    expect(
      operationalSyncEventSchema.safeParse({
        eventId: `evt-${"a".repeat(64)}`,
        clientId: `desktop-${"b".repeat(64)}`,
        domain: "id-card-template",
        operation: "save",
        entityKey: "default_template",
        payload: {
          id: "default_template",
          name: "Template Default SPPG",
          orientation: "landscape",
          front_bg_url: null,
          back_bg_url: null,
          elements_json: "[]",
          is_active: 1,
          created_at: "2026-08-20T00:00:00.000Z",
          updated_at: "2026-08-20T00:00:00.000Z",
        },
        baseRevision: null,
        createdAt: 1_786_300_000,
      }).success,
    ).toBe(true);
  });

  test("menolak null, primitive, domain, dan operasi yang tidak didukung", () => {
    expect(operationalSyncEventSchema.safeParse(null).success).toBe(false);
    expect(operationalSyncEventSchema.safeParse("event").success).toBe(false);
    expect(
      operationalSyncEventSchema.safeParse({
        ...shiftEvent(),
        operation: "truncate",
      }).success,
    ).toBe(false);
  });

  test("menolak field liar pada event dan payload", () => {
    expect(
      operationalSyncEventSchema.safeParse({
        ...shiftEvent(),
        unexpected: true,
      }).success,
    ).toBe(false);
    expect(
      operationalSyncEventSchema.safeParse({
        ...shiftEvent(),
        payload: { ...shiftEvent().payload, sql: "DROP TABLE master_data" },
      }).success,
    ).toBe(false);
  });

  test("batch menolak client ID event yang berbeda", () => {
    expect(
      operationalSyncBatchSchema.safeParse({
        clientId: `desktop-${"c".repeat(64)}`,
        events: [shiftEvent()],
      }).success,
    ).toBe(false);
  });
});

/**
 * Payload akademik dieja PERSIS seperti yang diproduksi `academic.rs`.
 *
 * Sejak validatornya `.strict()`, satu kunci yang ada di produsen tetapi tidak
 * ada di skema akan menolak SETIAP push domain itu — dan penolakan cloud
 * menghentikan event di `failed` dengan `next_retry_at = NULL`, yaitu gagal
 * permanen. Test ini yang menjaga kedua sisi tetap sepadan; memperbarui payload
 * di `academic.rs` tanpa memperbarui skema akan menggagalkannya di sini, bukan
 * di perangkat pengguna.
 */
const ACADEMIC_PAYLOADS: [string, string, Record<string, unknown>][] = [
  [
    "academic-year",
    "create",
    {
      id_tahun_ajaran: "ta_1",
      nama_tahun: "2026/2027",
      semester: "Ganjil",
      tanggal_mulai: "2026-07-01",
      tanggal_selesai: "2027-06-30",
      is_aktif: 1,
      created_at: "2026-09-07 03:00:00",
      updated_at: "2026-09-07 03:00:00",
    },
  ],
  [
    "academic-year",
    "update",
    {
      id_tahun_ajaran: "ta_1",
      nama_tahun: "2026/2027",
      semester: "Genap",
      tanggal_mulai: "2026-07-01",
      tanggal_selesai: "2027-06-30",
      is_aktif: 1,
      created_at: "2026-09-07 03:00:00",
      updated_at: "2026-09-07 03:10:00",
    },
  ],
  ["academic-year", "delete", { id_tahun_ajaran: "ta_1" }],
  [
    "academic-department",
    "create",
    {
      id_jurusan: "jur_1",
      kode_jurusan: "RPL",
      nama_jurusan: "Rekayasa Perangkat Lunak",
      deskripsi: null,
      is_aktif: 1,
    },
  ],
  [
    "academic-department",
    "update",
    {
      id_jurusan: "jur_1",
      kode_jurusan: "RPL",
      nama_jurusan: "Rekayasa Perangkat Lunak",
      deskripsi: "Program keahlian",
      is_aktif: 0,
    },
  ],
  ["academic-department", "delete", { id_jurusan: "jur_1" }],
  [
    "academic-class",
    "create",
    {
      id_rombel: "rom_1",
      id_tahun_ajaran: "ta_1",
      tingkat: 10,
      id_jurusan: "jur_1",
      nama_rombel: "X RPL 1",
      id_wali_kelas: "ptk_1",
      kapasitas: 36,
      ruang_kelas: "R-101",
      is_aktif: 1,
    },
  ],
  [
    "academic-class",
    "update",
    {
      id_rombel: "rom_1",
      id_tahun_ajaran: "ta_1",
      tingkat: 11,
      id_jurusan: null,
      nama_rombel: "XI RPL 1",
      id_wali_kelas: null,
      kapasitas: 32,
      ruang_kelas: null,
      is_aktif: 1,
    },
  ],
  ["academic-class", "delete", { id_rombel: "rom_1" }],
  [
    "academic-subject",
    "create",
    {
      id_mapel: "map_1",
      kode_mapel: "MTK",
      nama_mapel: "Matematika",
      tingkat: 10,
      kelompok: "Wajib",
      beban_jam: 4,
      kkm: 75,
      is_aktif: 1,
    },
  ],
  [
    "academic-subject",
    "update",
    {
      id_mapel: "map_1",
      kode_mapel: "MTK",
      nama_mapel: "Matematika",
      tingkat: null,
      kelompok: "Kejuruan",
      beban_jam: 2,
      kkm: 70,
      is_aktif: 0,
    },
  ],
  ["academic-subject", "delete", { id_mapel: "map_1" }],
  [
    "academic-assignment",
    "create",
    {
      id_penugasan: "gm_1",
      id_tahun_ajaran: "ta_1",
      id_rombel: "rom_1",
      id_mapel: "map_1",
      id_guru: "ptk_1",
    },
  ],
  ["academic-assignment", "delete", { id_penugasan: "gm_1" }],
  [
    "teacher",
    "create",
    {
      id_guru: "ptk_1",
      nip: "1987",
      nuptk: null,
      gelar: "S.Pd.",
      spesialisasi_mapel: "Matematika",
      status_kepegawaian: "Honorer",
      created_at: "2026-09-07 03:00:00",
      updated_at: "2026-09-07 03:00:00",
    },
  ],
  [
    "teacher",
    "update",
    {
      id_guru: "ptk_1",
      nip: null,
      nuptk: "998877",
      gelar: null,
      spesialisasi_mapel: null,
      status_kepegawaian: "PNS",
      created_at: "2026-09-07 03:00:00",
      updated_at: "2026-09-07 03:20:00",
    },
  ],
  ["teacher", "delete", { id_guru: "ptk_1" }],
  [
    "student",
    "create",
    {
      id_siswa: "sis_1",
      nis: "12345",
      nisn: "0098765432",
      nama_lengkap: "Siswa Uji",
      jenis_kelamin: "P",
      id_rombel: "rom_1",
      nama_wali: "Wali Uji",
      no_whatsapp_wali: "+6281234567890",
      alamat: "Jalan Uji 1",
      angkatan: 2026,
      status: "Aktif",
      created_at: "2026-09-07 03:00:00",
      updated_at: "2026-09-07 03:00:00",
    },
  ],
  [
    "student",
    "update",
    {
      id_siswa: "sis_1",
      nis: null,
      nisn: null,
      nama_lengkap: "Siswa Uji",
      jenis_kelamin: "L",
      id_rombel: "rom_1",
      nama_wali: null,
      no_whatsapp_wali: null,
      alamat: null,
      angkatan: 2025,
      status: "Lulus",
      created_at: "2026-09-07 03:00:00",
      updated_at: "2026-09-07 03:30:00",
    },
  ],
  ["student", "delete", { id_siswa: "sis_1" }],
  [
    "class-attendance",
    "create",
    {
      id_presensi_mapel: "pm_1",
      id_tahun_ajaran: "ta_1",
      id_rombel: "rom_1",
      id_mapel: "map_1",
      id_guru: "ptk_1",
      tanggal: "2026-09-07",
      jam_ke: "1",
      materi_pokok: "Aljabar",
      catatan: null,
      total_hadir: 30,
      total_izin: 1,
      total_sakit: 1,
      total_alfa: 0,
      total_dispensasi: 0,
      created_at: "2026-09-07 08:00:00",
      updated_at: "2026-09-07 08:00:00",
    },
  ],
  [
    "class-attendance",
    "update",
    {
      id_presensi_mapel: "pm_1",
      id_tahun_ajaran: "ta_1",
      id_rombel: "rom_1",
      id_mapel: "map_1",
      id_guru: "ptk_1",
      tanggal: "2026-09-07",
      jam_ke: "1",
      materi_pokok: "Aljabar Linear",
      catatan: "Selesai bab 1",
      total_hadir: 29,
      total_izin: 2,
      total_sakit: 1,
      total_alfa: 0,
      total_dispensasi: 0,
      created_at: "2026-09-07 08:00:00",
      updated_at: "2026-09-07 09:00:00",
    },
  ],
  ["class-attendance", "delete", { id_presensi_mapel: "pm_1" }],
  [
    "class-attendance-detail",
    "save",
    {
      id_detail: "pmd_1",
      id_presensi_mapel: "pm_1",
      id_siswa: "sis_1",
      status: "Hadir",
      catatan: null,
      created_at: "2026-09-07 08:00:00",
      updated_at: "2026-09-07 08:00:00",
    },
  ],
  [
    "class-attendance-detail",
    "delete",
    {
      id_detail: "pmd_1",
      id_presensi_mapel: "pm_1",
      id_siswa: "sis_1",
    },
  ],
  [
    "teaching-journal",
    "save",
    {
      id_jurnal: "jrn_1",
      id_presensi_mapel: "pm_1",
      materi_disampaikan: "Penyelesaian SPLDV metode eliminasi",
      kendala: "Proyektor mati di 15 menit awal",
      tindak_lanjut: "Latihan soal mandiri nomor 1-5",
      paraf_nama: "Budi Santoso, S.Pd",
      paraf_operator: "operator-1",
      paraf_at: "2026-09-07 09:30:00",
      created_at: "2026-09-07 09:30:00",
      updated_at: "2026-09-07 09:30:00",
    },
  ],
  [
    "teaching-journal",
    "delete",
    { id_jurnal: "jrn_1", id_presensi_mapel: "pm_1" },
  ],
  [
    "attendance-ledger",
    "freeze",
    {
      id_leger: "lgr_1",
      id_tahun_ajaran: "ta_1",
      semester: "Ganjil",
      id_siswa: "sis_1",
      id_rombel: "rom_1",
      total_hari_efektif: 100,
      hadir: 95,
      izin: 3,
      sakit: 2,
      alfa: 0,
      dispensasi: 0,
      persen_kehadiran: 95.0,
      dibekukan_at: "2026-09-07 10:00:00",
      dibekukan_oleh: "operator-1",
      created_at: "2026-09-07 10:00:00",
      updated_at: "2026-09-07 10:00:00",
    },
  ],
  [
    "attendance-ledger",
    "delete",
    { id_leger: "lgr_1", id_tahun_ajaran: "ta_1" },
  ],
];

function academicEvent(
  domain: string,
  operation: string,
  payload: Record<string, unknown>,
) {
  return {
    eventId: `evt-${"a".repeat(64)}`,
    clientId: `desktop-${"b".repeat(64)}`,
    domain,
    operation,
    entityKey: "akademik-uji",
    payload,
    baseRevision: null,
    createdAt: 1_786_300_000,
  };
}

describe("skema sinkronisasi akademik", () => {
  for (const [domain, operation, payload] of ACADEMIC_PAYLOADS) {
    test(`menerima payload ${domain}/${operation} apa adanya`, () => {
      const result = operationalSyncEventSchema.safeParse(
        academicEvent(domain, operation, payload),
      );
      expect(result.success).toBe(true);
    });
  }

  test("menolak kunci asing — inilah guna .strict()", () => {
    expect(
      operationalSyncEventSchema.safeParse(
        academicEvent("academic-year", "delete", {
          id_tahun_ajaran: "ta_1",
          kunci_yang_tidak_dikenal: "x",
        }),
      ).success,
    ).toBe(false);
  });

  test("menolak nilai di luar CHECK constraint cloud", () => {
    for (const payload of [
      { ...ACADEMIC_PAYLOADS[17]?.[2], jenis_kelamin: "X" },
      { ...ACADEMIC_PAYLOADS[17]?.[2], status: "Cuti" },
      { ...ACADEMIC_PAYLOADS[0]?.[2], semester: "Pendek" },
    ]) {
      expect(
        operationalSyncEventSchema.safeParse(
          academicEvent(
            payload === undefined ? "student" : "student",
            "create",
            payload as Record<string, unknown>,
          ),
        ).success,
      ).toBe(false);
    }
  });
});

/**
 * Modul nilai (v28) — tabel TERSINKRONISASI pertama sejak Fase 4.
 *
 * Yang diuji di sini bukan bentuk Zod-nya melainkan satu invarian yang paling
 * mudah salah dan paling mahal: `skor` NULL berarti BELUM DINILAI, bukan nol.
 */
describe("sync schema modul nilai", () => {
  function gradeEvent(payload: Record<string, unknown>) {
    return {
      eventId: `evt-${"c".repeat(64)}`,
      clientId: `desktop-${"d".repeat(64)}`,
      domain: "grade-detail",
      operation: "save",
      entityKey: "nis-1",
      payload,
      baseRevision: null,
      createdAt: 1_786_300_000,
    };
  }

  test("skor null diterima — belum dinilai bukan nol", () => {
    const hasil = operationalSyncEventSchema.safeParse(
      gradeEvent({
        id_nilai: "nis-1",
        id_penilaian: "nil-1",
        id_siswa: "sis-1",
        skor: null,
      }),
    );
    expect(hasil.success).toBe(true);
  });

  test("skor angka diterima", () => {
    expect(
      operationalSyncEventSchema.safeParse(
        gradeEvent({
          id_nilai: "nis-1",
          id_penilaian: "nil-1",
          id_siswa: "sis-1",
          skor: 87.5,
        }),
      ).success,
    ).toBe(true);
  });

  test("kolom asing ditolak — schema strict", () => {
    expect(
      operationalSyncEventSchema.safeParse(
        gradeEvent({
          id_nilai: "nis-1",
          id_penilaian: "nil-1",
          id_siswa: "sis-1",
          skor: 80,
          nilai_huruf: "A",
        }),
      ).success,
    ).toBe(false);
  });

  test("jenis penilaian di luar CHECK constraint ditolak", () => {
    const hasil = operationalSyncEventSchema.safeParse({
      eventId: `evt-${"e".repeat(64)}`,
      clientId: `desktop-${"f".repeat(64)}`,
      domain: "grade",
      operation: "create",
      entityKey: "nil-1",
      payload: {
        id_penilaian: "nil-1",
        id_tahun_ajaran: "ta-1",
        semester: "Ganjil",
        id_rombel: "rom-1",
        id_mapel: "map-1",
        id_guru: "gur-1",
        // Nilai asing. Kalau lolos di sini, CHECK constraint cloud yang
        // menolaknya — dan penolakan itu menghentikan push-nya di `failed`
        // dengan `next_retry_at = NULL`, hilang tanpa jalan pulih dari UI.
        jenis: "Kuis Dadakan",
        nama_penilaian: "UH 1",
        tanggal: "2026-09-01",
        bobot: 1,
        kkm: 75,
        nilai_maks: 100,
      },
      baseRevision: null,
      createdAt: 1_786_300_000,
    });
    expect(hasil.success).toBe(false);
  });

  test("semester di luar CHECK constraint ditolak", () => {
    const hasil = operationalSyncEventSchema.safeParse({
      eventId: `evt-${"e".repeat(64)}`,
      clientId: `desktop-${"f".repeat(64)}`,
      domain: "grade",
      operation: "create",
      entityKey: "nil-1",
      payload: {
        id_penilaian: "nil-1",
        id_tahun_ajaran: "ta-1",
        semester: "Pendek",
        id_rombel: "rom-1",
        id_mapel: "map-1",
        id_guru: "gur-1",
        jenis: "UTS",
        nama_penilaian: "UTS",
        tanggal: "2026-09-01",
        bobot: 1,
        kkm: 75,
        nilai_maks: 100,
      },
      baseRevision: null,
      createdAt: 1_786_300_000,
    });
    expect(hasil.success).toBe(false);
  });
});
