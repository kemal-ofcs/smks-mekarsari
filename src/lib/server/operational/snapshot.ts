import "server-only";

import type { Client, Row } from "@libsql/client";

function plainRows(rows: Row[]) {
  return rows.map((row) => Object.fromEntries(Object.entries(row)));
}

export async function readOperationalSnapshot(client: Client) {
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

  return {
    revision: Number(revision.rows[0]?.revision ?? 0),
    generatedAt: new Date().toISOString(),
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
