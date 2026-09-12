import "server-only";

import type { Client } from "@libsql/client";
import {
  applyOvertimePolicy,
  type BpjsRule,
  calculateBpjs,
  calculateComponents,
  calculateOvertimeIndex,
  calculatePph21Ter,
  type JpRate,
  type OvertimeTierRule,
  type PayrollComponent,
  roundMoney,
  summarizeTeaching,
  type TaughtSession,
  type TaxRule,
} from "@/lib/services/payroll-calculator";
import { rentangJamKe } from "@/lib/validations/class-attendance";
import {
  type ComponentSubject,
  isTeacherPersonnel,
  parseTeacherOvertimeSetting,
  TEACHER_OVERTIME_SETTING_KEY,
} from "@/lib/validations/payroll-policy";

export interface PayrollRecapRow {
  id_karyawan: string;
  nama_karyawan: string;
  divisi: string;
  /**
   * Dibawa dari rekap supaya PEMBEKUAN memakai sudut pandang yang sama dengan
   * yang dilihat admin — komponen bertujuan kelompok dinilai dari keduanya.
   */
  jenis_personil: string;
  status_kepegawaian: string;
  rate_per_hour: number;
  ptkp_status: string;
  total_hadir: number;
  total_terlambat_menit: number;
  total_regular_hours: number;
  total_overtime_hours: number;
  total_overtime_index: number;
  /**
   * Seluruh jam kerja yang jatuh pada tanggal hari libur aktif.
   *
   * Menurut PP 35/2021 tidak ada "jam kerja biasa" pada hari libur resmi: SETIAP
   * jam yang dikerjakan hari itu dihitung lembur. Karena itu nilainya adalah
   * jam_kerja + lembur pada tanggal tersebut, dan ia sengaja TIDAK ikut
   * `total_regular_hours`/`total_overtime_hours`.
   */
  total_holiday_hours: number;
  /** Indeks hasil `total_holiday_hours` melewati jenjang HARI_LIBUR. */
  total_holiday_overtime_index: number;
  /** Jam pelajaran yang diajar dan sudah diparaf pada periode ini. */
  total_teaching_jp: number;
  /** Honor mengajar dari JP di atas. */
  teaching_salary: number;
  /**
   * JP yang tidak menemukan tarif mana pun. Peringatan, BUKAN penghalang:
   * tarif nol adalah keadaan normal bagi sekolah yang tidak memakai honor per
   * JP sama sekali.
   */
  unrated_teaching_jp: number;
  est_basic_salary: number;
  est_overtime_salary: number;
  est_gross_salary: number;
  est_total_allowance: number;
  est_total_deduction: number;
  est_bpjs_employee: number;
  est_pph21: number;
  est_net_salary: number;
  // Extra fields (not part of the Rust PayrollRecapRow response shape, but
  // needed by run creation to build payroll_items without recomputing).
  breakdown_snapshot: string;
  bpjs_company_total: number;
}

async function loadOvertimeTiers(
  client: Client,
  ruleType: string,
): Promise<OvertimeTierRule[]> {
  const result = await client.execute({
    sql: `SELECT id, rule_type, tier_order, hour_start, hour_end, multiplier, is_active
          FROM overtime_tier_rules
          WHERE rule_type = ? AND is_active = 1
          ORDER BY tier_order ASC;`,
    args: [ruleType],
  });
  return result.rows.map((row) => ({
    id: String(row.id),
    rule_type: String(row.rule_type),
    tier_order: Number(row.tier_order),
    hour_start: Number(row.hour_start),
    hour_end: row.hour_end === null ? null : Number(row.hour_end),
    multiplier: Number(row.multiplier),
    is_active: Number(row.is_active),
  }));
}

/**
 * Sesi mengajar yang JP-nya dihitung, dikelompokkan per guru.
 *
 * Syaratnya satu: jurnal mengajarnya SUDAH DIPARAF. Dipakai `EXISTS`, bukan
 * JOIN — `jurnal_mengajar` tidak punya UNIQUE pada `id_presensi_mapel`,
 * sehingga dua perangkat offline bisa menulis dua jurnal untuk sesi yang sama
 * dan JOIN akan menggandakan honornya.
 *
 * SQL-nya sama persis dengan `load_taught_sessions` di `payroll/commands.rs`.
 */
async function loadTaughtSessions(
  client: Client,
  periodStart: string,
  periodEnd: string,
): Promise<Map<string, TaughtSession[]>> {
  const result = await client.execute({
    sql: `
      -- batas: dijepit satu periode payroll (sebulan) di kedua ujung tanggal, dan di dalamnya jumlah baris dibatasi jumlah rombel dikali jam pelajaran per hari — bukan oleh waktu. LIMIT justru berbahaya di sini: memotong sesi berarti memotong honor guru tanpa satu pun tanda.
      SELECT pm.id_presensi_mapel, pm.id_guru, pm.id_mapel, pm.tanggal, pm.jam_ke
      FROM presensi_mapel pm
      WHERE pm.tanggal >= ? AND pm.tanggal <= ?
        AND EXISTS (
          SELECT 1 FROM jurnal_mengajar j
          WHERE j.id_presensi_mapel = pm.id_presensi_mapel
            AND j.paraf_at IS NOT NULL AND TRIM(j.paraf_at) <> ''
        )
      ORDER BY pm.tanggal, pm.jam_ke;
    `,
    args: [periodStart, periodEnd],
  });

  const perGuru = new Map<string, TaughtSession[]>();
  for (const row of result.rows) {
    // `jam_ke` yang tidak terbaca dilewati, bukan dianggap satu JP: baris lama
    // bisa memuat teks apa pun, dan menebaknya berarti menebak uang.
    const rentang = rentangJamKe(String(row.jam_ke ?? ""));
    if (rentang === null) continue;
    const idGuru = String(row.id_guru ?? "");
    const daftar = perGuru.get(idGuru) ?? [];
    daftar.push({
      id_presensi_mapel: String(row.id_presensi_mapel ?? ""),
      id_mapel: String(row.id_mapel ?? ""),
      tanggal: String(row.tanggal ?? ""),
      jam_awal: rentang.awal,
      jam_akhir: rentang.akhir,
    });
    perGuru.set(idGuru, daftar);
  }
  return perGuru;
}

/**
 * Seluruh tarif JP. Tabelnya sebesar daftar mata pelajaran sekolah, jadi dibaca
 * utuh sekali per rekap alih-alih satu query per sesi.
 */
async function loadJpRates(client: Client): Promise<JpRate[]> {
  const result = await client.execute(
    `SELECT id, id_mapel, id_guru, rate_per_jp, effective_date, status_aktif, updated_at
     FROM tarif_jp
     ORDER BY id_mapel, effective_date DESC;`,
  );
  return result.rows.map((row) => ({
    id: String(row.id),
    id_mapel: String(row.id_mapel),
    id_guru: row.id_guru === null ? null : String(row.id_guru),
    rate_per_jp: Number(row.rate_per_jp ?? 0),
    effective_date: String(row.effective_date ?? ""),
    status_aktif: Number(row.status_aktif ?? 1),
    updated_at: String(row.updated_at ?? ""),
  }));
}

async function loadPayrollComponents(
  client: Client,
): Promise<PayrollComponent[]> {
  const result = await client.execute(
    `SELECT id, name, category, calc_type, default_value, applies_to, is_active
     FROM payroll_components
     WHERE is_active = 1
     ORDER BY category, name ASC;`,
  );
  return result.rows.map((row) => ({
    id: String(row.id),
    name: String(row.name),
    category: String(row.category),
    calc_type: String(row.calc_type),
    default_value: Number(row.default_value),
    applies_to: String(row.applies_to),
    is_active: Number(row.is_active),
  }));
}

/**
 * Tarif pajak yang BERLAKU pada akhir periode, bukan seluruh isi tabelnya.
 *
 * `effective_date` sudah ada di skema dan didokumentasikan sebagai kunci
 * generasi tarif, tetapi tidak pernah dipakai menyaring: tabelnya dibaca utuh,
 * lalu `calculatePph21Ter` memakai bracket PERTAMA yang cocok. Menambahkan
 * tabel TER tahun depan membuat periode berjalan memakai bracket yang
 * urutannya tidak ditentukan siapa pun. Bahkan tanpa generasi ganda, tarif
 * yang berlakunya masih di MASA DEPAN pun ikut terpakai hari ini.
 *
 * SQL-nya sama persis dengan `load_tax_rules` di `payroll/commands.rs`.
 */
async function loadTaxRules(
  client: Client,
  periodEnd: string,
): Promise<TaxRule[]> {
  const result = await client.execute({
    sql: `SELECT id, category, bracket_min, bracket_max, rate_percentage, effective_date
     FROM tax_rules
     WHERE effective_date = COALESCE(
       (SELECT MAX(t2.effective_date) FROM tax_rules t2
         WHERE t2.category = tax_rules.category AND t2.effective_date <= ?),
       (SELECT MIN(t3.effective_date) FROM tax_rules t3
         WHERE t3.category = tax_rules.category)
     )
     ORDER BY category, bracket_min ASC;`,
    args: [periodEnd],
  });
  return result.rows.map((row) => ({
    id: String(row.id),
    category: String(row.category),
    bracket_min: Number(row.bracket_min),
    bracket_max: row.bracket_max === null ? null : Number(row.bracket_max),
    rate_percentage: Number(row.rate_percentage),
    effective_date: String(row.effective_date),
  }));
}

/**
 * Iuran BPJS yang BERLAKU pada akhir periode.
 *
 * Alasannya sama dengan `loadTaxRules`. SQL-nya sama persis dengan
 * `load_bpjs_rules` di `payroll/commands.rs`.
 */
async function loadBpjsRules(
  client: Client,
  periodEnd: string,
): Promise<BpjsRule[]> {
  const result = await client.execute({
    sql: `SELECT id, component_code, component_name, rate_percentage, wage_cap, effective_date
     FROM bpjs_rules
     WHERE effective_date = COALESCE(
       (SELECT MAX(b2.effective_date) FROM bpjs_rules b2
         WHERE b2.component_code = bpjs_rules.component_code AND b2.effective_date <= ?),
       (SELECT MIN(b3.effective_date) FROM bpjs_rules b3
         WHERE b3.component_code = bpjs_rules.component_code)
     )
     ORDER BY component_code ASC;`,
    args: [periodEnd],
  });
  return result.rows.map((row) => ({
    id: String(row.id),
    component_code: String(row.component_code),
    component_name: String(row.component_name),
    rate_percentage: Number(row.rate_percentage),
    wage_cap: row.wage_cap === null ? null : Number(row.wage_cap),
    effective_date: String(row.effective_date),
  }));
}

export async function computePayrollRecap(
  client: Client,
  periodStart: string,
  periodEnd: string,
): Promise<PayrollRecapRow[]> {
  const [
    overtimeTiers,
    holidayTiers,
    components,
    taxRules,
    bpjsRules,
    teacherOvertimeRow,
    taughtSessions,
    jpRates,
    aggResult,
  ] = await Promise.all([
    loadOvertimeTiers(client, "HARI_KERJA"),
    // Jenjang lembur hari libur dikonfigurasi terpisah oleh user di menu
    // "Aturan Jenjang Lembur" (rule_type = 'HARI_LIBUR'). Sebelum ini jenjang
    // itu tersimpan dan bisa disunting, tetapi tidak pernah dibaca siapa pun.
    loadOvertimeTiers(client, "HARI_LIBUR"),
    loadPayrollComponents(client),
    loadTaxRules(client, periodEnd),
    loadBpjsRules(client, periodEnd),
    // Sakelar lembur guru: kebijakan sekolah di `setting_gex_system`, dibaca
    // sekali per rekap. Cerminan `teacher_overtime_enabled` di
    // `payroll/commands.rs`.
    client.execute({
      sql: "SELECT value FROM setting_gex_system WHERE key = ? LIMIT 1;",
      args: [TEACHER_OVERTIME_SETTING_KEY],
    }),
    loadTaughtSessions(client, periodStart, periodEnd),
    loadJpRates(client),
    client.execute({
      sql: `
          SELECT
            md.id_unik,
            md.nama,
            md.divisi,
            COALESCE(md.jenis_personil, '') AS jenis_personil,
            -- Status kepegawaian hanya ada pada guru, dan hanya dipakai
            -- komponen bertujuan kelompok (STATUS:Honorer). Kosong untuk yang
            -- bukan guru, sehingga kelompok itu tidak pernah cocok.
            COALESCE(g.status_kepegawaian, '') AS status_kepegawaian,
            COALESCE(sc.rate_per_hour, 0) AS rate_per_hour,
            COALESCE(sc.rate_per_jp, 0) AS rate_per_jp,
            COALESCE(sc.ptkp_status, 'TK/0') AS ptkp_status,
            COUNT(CASE WHEN ah.status_kehadiran IN ('Hadir', 'PRESENT') THEN 1 END) AS total_hadir,
            COALESCE(SUM(ah.menit_terlambat), 0) AS total_terlambat_menit,
            COALESCE(SUM(CASE WHEN hl.tanggal IS NULL THEN ah.jam_kerja ELSE 0 END), 0) AS total_jam_kerja_menit,
            COALESCE(SUM(CASE WHEN hl.tanggal IS NULL THEN ah.lembur ELSE 0 END), 0) AS total_lembur_menit,
            COALESCE(SUM(CASE WHEN hl.tanggal IS NOT NULL
              THEN COALESCE(ah.jam_kerja, 0) + COALESCE(ah.lembur, 0) ELSE 0 END), 0) AS total_libur_menit,
            -- Jam kerja (tanpa lembur) yang jatuh pada tanggal libur. Hanya
            -- dipakai ketika lembur seseorang dimatikan: menit ini pindah ke jam
            -- reguler supaya hari itu tetap dibayar. Lihat applyOvertimePolicy.
            COALESCE(SUM(CASE WHEN hl.tanggal IS NOT NULL
              THEN COALESCE(ah.jam_kerja, 0) ELSE 0 END), 0) AS total_libur_jam_kerja_menit
          FROM master_data md
          LEFT JOIN guru_data g ON g.id_guru = md.id_unik
          LEFT JOIN salary_configs sc ON sc.id_karyawan = md.id_unik
            AND sc.effective_date = (
              SELECT MAX(effective_date) FROM salary_configs
              WHERE id_karyawan = md.id_unik AND effective_date <= ?
            )
          LEFT JOIN absensi_harian ah ON ah.id_karyawan = md.id_unik
            AND ah.tanggal >= ? AND ah.tanggal <= ?
          -- Penanda hari libur diambil dari tanggal kerja barisnya, BUKAN dari
          -- kolom pada absensi_harian. Kolom tbl_hari_libur.tanggal UNIQUE sehingga
          -- join ini tidak pernah menggandakan baris, dan absensi lama otomatis
          -- ikut terhitung benar begitu admin melengkapi daftar hari liburnya.
          LEFT JOIN tbl_hari_libur hl ON hl.tanggal = ah.tanggal AND hl.status_aktif = 1
          WHERE md.status_aktif = 'Aktif'
            -- Siswa TIDAK digaji. Mereka hidup di master_data yang sama dengan
            -- guru dan karyawan, sehingga tanpa baris ini setiap siswa aktif
            -- ikut masuk rekap dan setiap komponen tunjangan yang berlaku untuk
            -- 'ALL' menerbitkan slip untuk mereka. Dibandingkan dalam bentuk
            -- ternormalisasi karena kolomnya tersimpan dengan ejaan
            -- berbeda-beda ('SISWA', 'Siswa').
            AND LOWER(TRIM(COALESCE(md.jenis_personil, ''))) <> 'siswa'
          GROUP BY md.id_unik
          ORDER BY md.nama ASC;
        `,
      args: [periodEnd, periodStart, periodEnd],
    }),
  ]);

  const teacherOvertime = parseTeacherOvertimeSetting(
    teacherOvertimeRow.rows[0]
      ? String(teacherOvertimeRow.rows[0].value ?? "")
      : null,
  );

  return aggResult.rows.map((row) => {
    const idKaryawan = String(row.id_unik);
    const ratePerHour = Number(row.rate_per_hour || 0);
    const ptkpStatus = String(row.ptkp_status || "TK/0");

    // Sakelar lembur guru: kebijakan sekolah, tidak pernah berlaku untuk
    // selain guru.
    const overtimeAllowed =
      teacherOvertime || !isTeacherPersonnel(row.jenis_personil);
    const {
      regular: jamKerjaMenit,
      overtime: lemburMenit,
      holiday: liburMenit,
    } = applyOvertimePolicy(
      Number(row.total_jam_kerja_menit || 0),
      Number(row.total_lembur_menit || 0),
      Number(row.total_libur_menit || 0),
      Number(row.total_libur_jam_kerja_menit || 0),
      overtimeAllowed,
    );

    const regHours = jamKerjaMenit / 60;
    const otHours = lemburMenit / 60;
    const holidayHours = liburMenit / 60;

    // Dua indeks, dua jenjang: jam lembur hari biasa memakai HARI_KERJA,
    // seluruh jam pada tanggal libur memakai HARI_LIBUR. Keduanya dijumlahkan
    // lalu dikalikan rate per jam SEKALI, supaya pembulatannya identik dengan
    // `desktop_get_payroll_recap` di payroll/commands.rs.
    const otIndex = calculateOvertimeIndex(otHours, overtimeTiers);
    const holidayIndex = calculateOvertimeIndex(holidayHours, holidayTiers);

    // Uang diturunkan dari MENIT BULAT, bukan dari jam yang sudah dibagi.
    //
    // `regHours * ratePerHour` menempuh dua operasi pecahan: menit dibagi 60
    // lalu dikalikan tarif, dan galat pembagiannya membuat nilai yang
    // seharusnya jatuh TEPAT di titik tengah pembulatan mendarat sedikit di
    // bawahnya. Sebelas menit pada tarif 18.750/jam bernilai 3.437,5 persis,
    // tetapi lewat jalur itu ia menjadi 3.437,4999… lalu dibulatkan ke 3.437.
    //
    // `menit * tarif` adalah bilangan bulat eksak, dan hasil baginya oleh 60
    // hanya punya satu bit pecahan ketika ia setengah bulat — sehingga
    // titik tengahnya terwakili persis dan `roundMoney` menjawab benar. Ini
    // yang membuat hasilnya sama dengan `Decimal` di `payroll/commands.rs`.
    const basicSalary = roundMoney((jamKerjaMenit * ratePerHour) / 60);

    // Alasan yang sama untuk lembur: indeksnya sudah dibulatkan ke 2 desimal,
    // jadi seratus kalinya bilangan bulat dan perkaliannya menjadi eksak.
    const indeksRatusan = Math.round((otIndex + holidayIndex) * 100);
    const overtimeSalary = roundMoney((indeksRatusan * ratePerHour) / 100);

    // Honor mengajar berdiri SENDIRI di samping upah kehadiran: gaji pokok
    // berasal dari jam di sekolah lewat scan gerbang, honor ini dari jam
    // pelajaran yang benar-benar diajar dan sudah diparaf. Guru honorer dengan
    // rate pokok 0 karenanya tetap dibayar.
    const teaching = summarizeTeaching(
      taughtSessions.get(idKaryawan) ?? [],
      jpRates,
      idKaryawan,
      Number(row.rate_per_jp || 0),
    );

    // Tunjangan persentase tetap dihitung dari GAJI POKOK saja, sesuai label di
    // layar konfigurasinya. Memasukkan honor mengajar ke dasarnya akan
    // diam-diam mengubah arti setiap komponen persen yang sudah ada.
    const subject: ComponentSubject = {
      id_karyawan: idKaryawan,
      jenis_personil: String(row.jenis_personil ?? ""),
      status_kepegawaian: String(row.status_kepegawaian ?? ""),
      divisi: String(row.divisi ?? ""),
      total_teaching_jp: teaching.total_jp,
      total_hadir: Number(row.total_hadir || 0),
    };
    const {
      allowance,
      deduction,
      breakdown: compBreakdown,
    } = calculateComponents(basicSalary, components, subject);

    const gross = basicSalary + overtimeSalary + teaching.honor + allowance;
    const {
      employee: bpjsEmployee,
      company: bpjsCompany,
      breakdown: bpjsBreakdown,
    } = calculateBpjs(gross, bpjsRules);
    const { pph21Amount, breakdown: taxBreakdown } = calculatePph21Ter(
      gross,
      ptkpStatus,
      taxRules,
    );

    const net = Math.max(0, gross - deduction - bpjsEmployee - pph21Amount);

    const breakdownSnapshot = JSON.stringify({
      rate_per_hour: ratePerHour,
      regular_hours: regHours,
      overtime_hours: otHours,
      overtime_index: otIndex,
      holiday_hours: holidayHours,
      holiday_overtime_index: holidayIndex,
      basic_salary: basicSalary,
      overtime_salary: overtimeSalary,
      teaching_jp: teaching.total_jp,
      teaching_salary: teaching.honor,
      components: compBreakdown,
      bpjs: bpjsBreakdown,
      tax: taxBreakdown,
      calculated_at: new Date().toISOString(),
    });

    return {
      id_karyawan: idKaryawan,
      nama_karyawan: String(row.nama || ""),
      divisi: subject.divisi,
      jenis_personil: subject.jenis_personil,
      status_kepegawaian: subject.status_kepegawaian,
      rate_per_hour: ratePerHour,
      ptkp_status: ptkpStatus,
      total_hadir: Number(row.total_hadir || 0),
      total_terlambat_menit: Number(row.total_terlambat_menit || 0),
      total_regular_hours: regHours,
      total_overtime_hours: otHours,
      total_overtime_index: otIndex,
      total_holiday_hours: holidayHours,
      total_holiday_overtime_index: holidayIndex,
      total_teaching_jp: teaching.total_jp,
      teaching_salary: teaching.honor,
      unrated_teaching_jp: teaching.unrated_jp,
      est_basic_salary: basicSalary,
      est_overtime_salary: overtimeSalary,
      est_gross_salary: gross,
      est_total_allowance: allowance,
      est_total_deduction: deduction,
      est_bpjs_employee: bpjsEmployee,
      est_pph21: pph21Amount,
      est_net_salary: net,
      breakdown_snapshot: breakdownSnapshot,
      bpjs_company_total: bpjsCompany,
    };
  });
}
