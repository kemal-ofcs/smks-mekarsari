import "server-only";

import type { Client, Row } from "@libsql/client";

/**
 * Kunci payload yang barisnya SENGAJA tidak utuh di snapshot ini.
 *
 * Query di bawah membatasi lima tabel dengan jendela 31 hari, dan scanLogs
 * ditambah LIMIT 5000. Batas itu benar — tanpa batas, satu sekolah 800 personil
 * mengirim puluhan ribu baris tiap pull. Yang salah adalah membiarkan klien
 * menebak apa arti sebuah baris yang tidak muncul.
 *
 * `sync::apply_table` menghapus baris lokal yang tidak muncul di snapshot bila
 * `delete_missing` menyala, dan attendance, scanLogs, corrections, serta
 * imports SEMUANYA menyalakannya. Tanpa daftar ini klien tidak bisa membedakan
 * "baris ini sudah dihapus di server" dari "baris ini di luar jendela",
 * sehingga setiap pull menghapus seluruh riwayat lokal di luar 31 hari — dan
 * pada scanLogs memangkasnya lagi ke 5.000 baris yang sempat terkirim. Cloud
 * tetap utuh; yang hilang justru salinan offline yang menjadi inti produk ini,
 * dan hilangnya tidak meninggalkan jejak apa pun.
 *
 * Menambahkan jendela pada query lain WAJIB menambahkan kuncinya ke sini.
 */
export const PARTIAL_SNAPSHOT_KEYS = [
  "backups",
  "corrections",
  "imports",
  "attendance",
  "scanLogs",
] as const;

function plainRows(rows: Row[]) {
  return rows.map((row) => Object.fromEntries(Object.entries(row)));
}

/**
 * Baris yang dihapus di cloud sejak `since`, beserta kursor barunya.
 *
 * Dibaca TERPISAH dari `client.batch` di bawah dan kegagalannya tidak
 * mematikan snapshot: `sync_tombstone` dipasang jalur provisioning Rust, jadi
 * database yang belum pernah disentuh klien Desktop/Mobile belum memilikinya.
 * Menyatukannya ke dalam batch akan menukar "penghapusan belum menyebar"
 * dengan "tidak ada data sama sekali yang menyebar".
 */
async function readTombstones(client: Client, since: number) {
  try {
    const result = await client.execute({
      sql: "SELECT id, table_name, entity_key FROM sync_tombstone WHERE id > ? ORDER BY id;",
      args: [since],
    });
    let cursor = since;
    const rows = result.rows.flatMap((row) => {
      const id = Number(row.id ?? 0);
      // Kursor maju untuk SETIAP baris yang terbaca, termasuk yang dilewati.
      // Kalau baris cacat tidak ikut memajukannya, kursor berhenti tepat
      // sebelum baris itu dan perangkat membacanya ulang setiap siklus,
      // selamanya — sekaligus tidak pernah sampai ke tombstone sesudahnya.
      if (id > cursor) cursor = id;
      const table = String(row.table_name ?? "");
      const entityKey = String(row.entity_key ?? "");
      if (!table || !entityKey) return [];
      return [{ table, entityKey }];
    });
    return { tombstones: rows, tombstoneCursor: cursor };
  } catch {
    // Tabelnya belum ada di database ini. Kursor dikembalikan apa adanya
    // sehingga perangkat mencobanya lagi siklus berikutnya, alih-alih
    // melompati penghapusan yang belum sempat terbaca.
    return { tombstones: [], tombstoneCursor: since };
  }
}

export async function readOperationalSnapshot(
  client: Client,
  tombstoneSince = 0,
) {
  const [
    employees,
    idCards,
    shifts,
    holidays,
    holidayWhitelists,
    settings,
    companyProfiles,
    idCardTemplates,
    backups,
    corrections,
    imports,
    attendance,
    scanLogs,
    salaryConfigs,
    overtimeTierRules,
    jpRates,
    lessonPeriods,
    teachingSchedules,
    payrollComponents,
    taxRules,
    bpjsRules,
    payrollRuns,
    payrollItems,
    payrollAuditLogs,
    akademikTahunAjaran,
    akademikJurusan,
    akademikRombel,
    akademikMapel,
    akademikGuruMapel,
    guruData,
    siswaData,
    presensiMapel,
    presensiMapelDetail,
    jurnalMengajar,
    legerKehadiran,
    revision,
  ] = await client.batch(
    [
      `
      SELECT id_unik, kode_karyawan, nama, divisi, jabatan_status, no_hp, lp,
             id_shift, status_aktif, tanggal_daftar, catatan, token_absensi,
             qr_code, status_qr, jenis_personil, tanggal_mulai_aktif,
             tanggal_selesai_aktif, status_backup
      FROM master_data;
    `,
      "SELECT * FROM id_card ORDER BY nama;",
      "SELECT * FROM tbl_shift ORDER BY kode_shift;",
      "SELECT * FROM tbl_hari_libur ORDER BY tanggal ASC;",
      "SELECT * FROM hari_libur_whitelist ORDER BY scope_type, scope_value;",
      "SELECT key, value FROM setting_gex_system;",
      "SELECT * FROM company_profile;",
      "SELECT * FROM id_card_template ORDER BY created_at ASC;",
      `
      SELECT * FROM backup_karyawan
      WHERE status_tugas = 'Aktif'
         OR datetime(waktu_input) >= datetime('now', '-31 days');
    `,
      `
      SELECT * FROM koreksi_admin
      WHERE date(tanggal) >= date('now', '-31 days')
      ORDER BY id_koreksi DESC;
    `,
      `SELECT * FROM import_offline
        WHERE datetime(timestamp_input) >= datetime('now', '-31 days')
        ORDER BY id_import DESC;`,
      `
      SELECT * FROM absensi_harian
      -- sengaja-utuh: snapshot sinkronisasi wajib utuh; memotongnya membuat perangkat menarik data tak lengkap lalu menganggapnya lengkap. Jendela 31 hari membatasi sisi waktunya,
      -- tetapi tidak sisi personilnya: 800 personil = ±24.000 baris.
      WHERE date(tanggal) >= date('now', '-31 days');
    `,
      `
      SELECT * FROM log_scan
      WHERE date(tanggal_kerja) >= date('now', '-31 days')
      ORDER BY id_log DESC
      LIMIT 5000;
    `,
      "SELECT * FROM salary_configs ORDER BY id_karyawan, effective_date DESC;",
      "SELECT * FROM overtime_tier_rules ORDER BY rule_type, tier_order;",
      "SELECT * FROM tarif_jp ORDER BY id_mapel, effective_date DESC;",
      "SELECT * FROM akademik_jam_pelajaran ORDER BY jam_ke, jam_mulai;",
      "SELECT * FROM jadwal_mengajar ORDER BY id_rombel, hari, jam_ke;",
      "SELECT * FROM payroll_components ORDER BY category, name;",
      "SELECT * FROM tax_rules ORDER BY category, bracket_min;",
      "SELECT * FROM bpjs_rules ORDER BY component_code;",
      "SELECT * FROM payroll_runs ORDER BY period_start DESC, created_at DESC;",
      `
      SELECT * FROM payroll_items
      -- sengaja-utuh: snapshot sinkronisasi wajib utuh; memotongnya membuat perangkat menarik data tak lengkap lalu menganggapnya lengkap.
      ORDER BY created_at;
    `,
      "SELECT * FROM payroll_audit_logs ORDER BY created_at;",
      "SELECT * FROM akademik_tahun_ajaran ORDER BY tanggal_mulai DESC;",
      "SELECT * FROM akademik_jurusan ORDER BY kode_jurusan;",
      "SELECT * FROM akademik_rombel ORDER BY tingkat, nama_rombel;",
      "SELECT * FROM akademik_mapel ORDER BY kode_mapel;",
      "SELECT * FROM akademik_guru_mapel;",
      "SELECT * FROM guru_data ORDER BY created_at;",
      "SELECT * FROM siswa_data ORDER BY nama_lengkap;",
      `
      SELECT * FROM presensi_mapel
      -- sengaja-utuh: snapshot sinkronisasi wajib utuh; memotongnya membuat perangkat menarik data tak lengkap lalu menganggapnya lengkap.
      ORDER BY tanggal DESC, jam_ke ASC;
    `,
      `
      SELECT * FROM presensi_mapel_detail
      -- sengaja-utuh: snapshot sinkronisasi wajib utuh; memotongnya membuat perangkat menarik data tak lengkap lalu menganggapnya lengkap. Tabel ini yang tumbuh paling cepat di sini:
      -- satu baris per siswa per jam pelajaran, tanpa jendela waktu sama sekali.
      ORDER BY id_presensi_mapel, id_siswa;
    `,
      `
      SELECT * FROM jurnal_mengajar
      -- sengaja-utuh: snapshot sinkronisasi wajib utuh; memotongnya membuat perangkat menarik data tak lengkap lalu menganggapnya lengkap.
      ORDER BY updated_at DESC;
    `,
      `
      SELECT * FROM leger_kehadiran
      -- sengaja-utuh: snapshot sinkronisasi wajib utuh; memotongnya membuat perangkat menarik data tak lengkap lalu menganggapnya lengkap.
      ORDER BY id_tahun_ajaran, semester, id_rombel, id_siswa;
    `,
      "SELECT COALESCE(MAX(revision), 0) AS revision FROM sync_change_log;",
    ],
    "read",
  );

  const { tombstones, tombstoneCursor } = await readTombstones(
    client,
    tombstoneSince,
  );

  return {
    revision: Number(revision.rows[0]?.revision ?? 0),
    generatedAt: new Date().toISOString(),
    // Penghapusan yang terjadi di cloud sejak kursor perangkat. Tanpa ini,
    // penghapusan tidak pernah sampai ke perangkat untuk 25 dari 32 tabel
    // snapshot — `delete_missing` hanya menyimpulkannya dari ketidakhadiran
    // baris, dan itu hanya menyala pada tujuh tabel.
    tombstones,
    tombstoneCursor,
    // Lihat PARTIAL_SNAPSHOT_KEYS: tanpa penanda ini klien menghapus riwayat
    // lokalnya sendiri di luar jendela 31 hari, setiap siklus sinkronisasi.
    partialKeys: [...PARTIAL_SNAPSHOT_KEYS],
    employees: plainRows(employees.rows),
    idCards: plainRows(idCards.rows),
    shifts: plainRows(shifts.rows),
    holidays: plainRows(holidays.rows),
    holidayWhitelists: plainRows(holidayWhitelists.rows),
    settings: plainRows(settings.rows),
    companyProfiles: plainRows(companyProfiles.rows),
    idCardTemplates: plainRows(idCardTemplates.rows),
    backups: plainRows(backups.rows),
    corrections: plainRows(corrections.rows),
    imports: plainRows(imports.rows),
    attendance: plainRows(attendance.rows),
    scanLogs: plainRows(scanLogs.rows),
    salaryConfigs: plainRows(salaryConfigs.rows),
    overtimeTierRules: plainRows(overtimeTierRules.rows),
    jpRates: plainRows(jpRates.rows),
    lessonPeriods: plainRows(lessonPeriods.rows),
    teachingSchedules: plainRows(teachingSchedules.rows),
    payrollComponents: plainRows(payrollComponents.rows),
    taxRules: plainRows(taxRules.rows),
    bpjsRules: plainRows(bpjsRules.rows),
    payrollRuns: plainRows(payrollRuns.rows),
    payrollItems: plainRows(payrollItems.rows),
    payrollAuditLogs: plainRows(payrollAuditLogs.rows),
    akademikTahunAjaran: plainRows(akademikTahunAjaran.rows),
    akademikJurusan: plainRows(akademikJurusan.rows),
    akademikRombel: plainRows(akademikRombel.rows),
    akademikMapel: plainRows(akademikMapel.rows),
    akademikGuruMapel: plainRows(akademikGuruMapel.rows),
    guruData: plainRows(guruData.rows),
    siswaData: plainRows(siswaData.rows),
    presensiMapel: plainRows(presensiMapel.rows),
    presensiMapelDetail: plainRows(presensiMapelDetail.rows),
    jurnalMengajar: plainRows(jurnalMengajar.rows),
    legerKehadiran: plainRows(legerKehadiran.rows),
  };
}
