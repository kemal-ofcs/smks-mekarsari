"use client";

import { requestWebApi } from "@/lib/client/api-client";
import { requestSyncNow } from "@/lib/gateways/sync-status";
import { isDesktopRuntime, isMobileRuntime } from "@/lib/runtime/app-runtime";
import { invokeDesktop } from "@/lib/runtime/desktop-commands";
import type { PayrollCalcType } from "@/lib/validations/payroll-policy";

function kickDesktopSync() {
  requestSyncNow();
}

export interface SalaryConfigRow {
  id: string;
  id_karyawan: string;
  rate_per_hour: number;
  /**
   * Tarif bawaan per jam pelajaran; dipakai bila mapel yang diajar belum punya
   * tarifnya sendiri. Nol berarti orang ini tidak dibayar per JP.
   */
  rate_per_jp: number;
  ptkp_status: string;
  effective_date: string;
  created_by: string;
  created_at: string;
}

export interface OvertimeTierRuleRow {
  id: string;
  rule_type: "HARI_KERJA" | "HARI_LIBUR";
  tier_order: number;
  hour_start: number;
  hour_end: number | null;
  multiplier: number;
  is_active: number;
}

export interface PayrollComponentRow {
  id: string;
  name: string;
  category: "ALLOWANCE" | "DEDUCTION";
  /** Termasuk PER_JP dan PER_HADIR sejak schema versi 25. */
  calc_type: PayrollCalcType;
  default_value: number;
  applies_to: string;
  is_active: number;
}

export interface TaxRuleRow {
  id: string;
  category: "TER_A" | "TER_B" | "TER_C" | "PASAL_17";
  bracket_min: number;
  bracket_max: number | null;
  rate_percentage: number;
  effective_date: string;
}

export interface BpjsRuleRow {
  id: string;
  component_code: string;
  component_name: string;
  rate_percentage: number;
  wage_cap: number | null;
  effective_date: string;
}

export interface PayrollRecapRow {
  id_karyawan: string;
  nama_karyawan: string;
  divisi: string;
  rate_per_hour: number;
  ptkp_status: string;
  total_hadir: number;
  total_terlambat_menit: number;
  total_regular_hours: number;
  total_overtime_hours: number;
  total_overtime_index: number;
  /**
   * Jam kerja pada tanggal hari libur (jam_kerja + lembur hari itu).
   *
   * Menurut PP 35/2021 tidak ada "jam kerja biasa" pada hari libur resmi, jadi
   * angka ini SENGAJA di luar total_regular_hours/total_overtime_hours.
   */
  total_holiday_hours: number;
  /** Indeks jenjang HARI_LIBUR untuk jam di atas. */
  total_holiday_overtime_index: number;
  /** Jam pelajaran yang diajar dan sudah diparaf pada periode ini. */
  total_teaching_jp: number;
  /** Honor mengajar dari JP di atas. */
  teaching_salary: number;
  /** JP yang tidak menemukan tarif mana pun. Peringatan, bukan penghalang. */
  unrated_teaching_jp: number;
  est_basic_salary: number;
  est_overtime_salary: number;
  est_gross_salary: number;
  est_total_allowance: number;
  est_total_deduction: number;
  est_bpjs_employee: number;
  est_pph21: number;
  est_net_salary: number;
}

export interface PayrollRunRow {
  id: string;
  idempotency_key: string;
  period_start: string;
  period_end: string;
  status: "DRAFT" | "SUBMITTED" | "REVIEWED" | "APPROVED" | "PAID" | "REJECTED";
  total_gross_payout: number;
  total_net_payout: number;
  total_employees: number;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface PayrollItemRow {
  id: string;
  payroll_run_id: string;
  id_karyawan: string;
  nama_karyawan: string;
  divisi: string;
  ptkp_status: string;
  total_regular_hours: number;
  total_overtime_hours: number;
  total_overtime_index: number;
  total_holiday_hours: number;
  total_holiday_overtime_index: number;
  total_teaching_jp: number;
  teaching_salary: number;
  rate_per_hour: number;
  basic_salary: number;
  overtime_salary: number;
  gross_salary: number;
  total_allowances: number;
  total_deductions: number;
  bpjs_employee_total: number;
  bpjs_company_total: number;
  pph21_amount: number;
  net_salary: number;
  breakdown_snapshot: string;
  created_at: string;
}

export interface PayrollAuditLogRow {
  id: string;
  payroll_run_id: string;
  action: string;
  old_status: string | null;
  new_status: string;
  performed_by: string;
  notes: string | null;
  created_at: string;
}

export interface PayrollRunDetail {
  run: PayrollRunRow;
  items: PayrollItemRow[];
  audit_logs: PayrollAuditLogRow[];
}

export async function getSalaryConfigs(
  search?: string,
): Promise<SalaryConfigRow[]> {
  if (isDesktopRuntime()) {
    return invokeDesktop<SalaryConfigRow[]>("desktop_get_salary_configs", {
      search,
    });
  }
  const response = await requestWebApi<{ data: SalaryConfigRow[] }>(
    "/api/payroll/config/salary",
    "POST",
    { search },
  );
  return response.data;
}

export async function saveSalaryConfig(
  draft: Partial<SalaryConfigRow>,
): Promise<boolean> {
  if (isDesktopRuntime()) {
    const result = await invokeDesktop<boolean>("desktop_save_salary_config", {
      draft,
    });
    kickDesktopSync();
    return result;
  }
  const response = await requestWebApi<{ sukses: boolean }>(
    "/api/payroll/config/salary",
    "PUT",
    { draft },
  );
  return response.sukses;
}

export async function deleteSalaryConfig(id: string): Promise<boolean> {
  if (isDesktopRuntime()) {
    const result = await invokeDesktop<boolean>(
      "desktop_delete_salary_config",
      { id },
    );
    kickDesktopSync();
    return result;
  }
  const response = await requestWebApi<{ sukses: boolean }>(
    "/api/payroll/config/salary",
    "DELETE",
    { id },
  );
  return response.sukses;
}

export async function getOvertimeRules(): Promise<OvertimeTierRuleRow[]> {
  if (isDesktopRuntime()) {
    return invokeDesktop<OvertimeTierRuleRow[]>("desktop_get_overtime_rules");
  }
  const response = await requestWebApi<{ data: OvertimeTierRuleRow[] }>(
    "/api/payroll/config/overtime",
    "POST",
  );
  return response.data;
}

export async function saveOvertimeRule(
  draft: Partial<OvertimeTierRuleRow>,
): Promise<boolean> {
  if (isDesktopRuntime()) {
    const result = await invokeDesktop<boolean>("desktop_save_overtime_rule", {
      draft,
    });
    kickDesktopSync();
    return result;
  }
  const response = await requestWebApi<{ sukses: boolean }>(
    "/api/payroll/config/overtime",
    "PUT",
    { draft },
  );
  return response.sukses;
}

export async function deleteOvertimeRule(id: string): Promise<boolean> {
  if (isDesktopRuntime()) {
    const result = await invokeDesktop<boolean>(
      "desktop_delete_overtime_rule",
      { id },
    );
    kickDesktopSync();
    return result;
  }
  const response = await requestWebApi<{ sukses: boolean }>(
    "/api/payroll/config/overtime",
    "DELETE",
    { id },
  );
  return response.sukses;
}

export async function saveOvertimeRules(
  rules: OvertimeTierRuleRow[],
): Promise<boolean> {
  if (isDesktopRuntime()) {
    const result = await invokeDesktop<boolean>("desktop_save_overtime_rules", {
      rules,
    });
    kickDesktopSync();
    return result;
  }
  const response = await requestWebApi<{ sukses: boolean }>(
    "/api/payroll/config/overtime",
    "PUT",
    { rules },
  );
  return response.sukses;
}

/** Satu baris tarif honor per jam pelajaran. */
export interface JpRateRow {
  id: string;
  id_mapel: string;
  /** `null` berarti tarif umum mapel ini, berlaku bagi guru mana pun. */
  id_guru: string | null;
  rate_per_jp: number;
  effective_date: string;
  status_aktif: number;
  created_at: string;
  updated_at: string;
  nama_mapel?: string;
  nama_guru?: string;
}

export async function getJpRates(): Promise<JpRateRow[]> {
  if (isDesktopRuntime()) {
    return invokeDesktop<JpRateRow[]>("desktop_get_jp_rates");
  }
  const response = await requestWebApi<{ data: JpRateRow[] }>(
    "/api/payroll/config/jp-rates",
    "POST",
  );
  return response.data;
}

export async function saveJpRate(draft: Partial<JpRateRow>): Promise<boolean> {
  if (isDesktopRuntime()) {
    const result = await invokeDesktop<boolean>("desktop_save_jp_rate", {
      draft,
    });
    kickDesktopSync();
    return result;
  }
  const response = await requestWebApi<{ sukses: boolean }>(
    "/api/payroll/config/jp-rates",
    "PUT",
    { draft },
  );
  return response.sukses;
}

export async function deleteJpRate(id: string): Promise<boolean> {
  if (isDesktopRuntime()) {
    const result = await invokeDesktop<boolean>("desktop_delete_jp_rate", {
      id,
    });
    kickDesktopSync();
    return result;
  }
  const response = await requestWebApi<{ sukses: boolean }>(
    "/api/payroll/config/jp-rates",
    "DELETE",
    { id },
  );
  return response.sukses;
}

/**
 * Sakelar lembur guru. Kebijakan sekolah, tersimpan di `setting_gex_system`
 * dan ikut sinkronisasi — bukan setelan per perangkat.
 */
export async function getTeacherOvertimePolicy(): Promise<boolean> {
  if (isDesktopRuntime()) {
    const result = await invokeDesktop<{ enabled: boolean }>(
      "desktop_get_teacher_overtime_policy",
    );
    return result.enabled;
  }
  const response = await requestWebApi<{ enabled: boolean }>(
    "/api/payroll/config/teacher-overtime",
    "POST",
  );
  return response.enabled;
}

export async function saveTeacherOvertimePolicy(
  enabled: boolean,
): Promise<boolean> {
  if (isDesktopRuntime()) {
    const result = await invokeDesktop<{ sukses: boolean }>(
      "desktop_save_teacher_overtime_policy",
      { enabled },
    );
    kickDesktopSync();
    return result.sukses;
  }
  const response = await requestWebApi<{ sukses: boolean }>(
    "/api/payroll/config/teacher-overtime",
    "PUT",
    { enabled },
  );
  return response.sukses;
}

export async function getPayrollComponents(): Promise<PayrollComponentRow[]> {
  if (isDesktopRuntime()) {
    return invokeDesktop<PayrollComponentRow[]>(
      "desktop_get_payroll_components",
    );
  }
  const response = await requestWebApi<{ data: PayrollComponentRow[] }>(
    "/api/payroll/config/components",
    "POST",
  );
  return response.data;
}

export async function savePayrollComponent(
  draft: Partial<PayrollComponentRow>,
): Promise<boolean> {
  if (isDesktopRuntime()) {
    const result = await invokeDesktop<boolean>(
      "desktop_save_payroll_component",
      { draft },
    );
    kickDesktopSync();
    return result;
  }
  const response = await requestWebApi<{ sukses: boolean }>(
    "/api/payroll/config/components",
    "PUT",
    { draft },
  );
  return response.sukses;
}

export async function deletePayrollComponent(id: string): Promise<boolean> {
  if (isDesktopRuntime()) {
    const result = await invokeDesktop<boolean>(
      "desktop_delete_payroll_component",
      { id },
    );
    kickDesktopSync();
    return result;
  }
  const response = await requestWebApi<{ sukses: boolean }>(
    "/api/payroll/config/components",
    "DELETE",
    { id },
  );
  return response.sukses;
}

export async function getTaxRules(): Promise<TaxRuleRow[]> {
  if (isDesktopRuntime()) {
    return invokeDesktop<TaxRuleRow[]>("desktop_get_tax_rules");
  }
  const response = await requestWebApi<{ data: TaxRuleRow[] }>(
    "/api/payroll/config/tax",
    "POST",
  );
  return response.data;
}

export async function saveTaxRule(
  draft: Partial<TaxRuleRow>,
): Promise<boolean> {
  if (isDesktopRuntime()) {
    const result = await invokeDesktop<boolean>("desktop_save_tax_rule", {
      draft,
    });
    kickDesktopSync();
    return result;
  }
  const response = await requestWebApi<{ sukses: boolean }>(
    "/api/payroll/config/tax",
    "PUT",
    { draft },
  );
  return response.sukses;
}

export async function deleteTaxRule(id: string): Promise<boolean> {
  if (isDesktopRuntime()) {
    const result = await invokeDesktop<boolean>("desktop_delete_tax_rule", {
      id,
    });
    kickDesktopSync();
    return result;
  }
  const response = await requestWebApi<{ sukses: boolean }>(
    "/api/payroll/config/tax",
    "DELETE",
    { id },
  );
  return response.sukses;
}

export async function saveTaxRules(rules: TaxRuleRow[]): Promise<boolean> {
  if (isDesktopRuntime()) {
    const result = await invokeDesktop<boolean>("desktop_save_tax_rules", {
      rules,
    });
    kickDesktopSync();
    return result;
  }
  const response = await requestWebApi<{ sukses: boolean }>(
    "/api/payroll/config/tax",
    "PUT",
    { rules },
  );
  return response.sukses;
}

export async function getBpjsRules(): Promise<BpjsRuleRow[]> {
  if (isDesktopRuntime()) {
    return invokeDesktop<BpjsRuleRow[]>("desktop_get_bpjs_rules");
  }
  const response = await requestWebApi<{ data: BpjsRuleRow[] }>(
    "/api/payroll/config/bpjs",
    "POST",
  );
  return response.data;
}

export async function saveBpjsRule(
  draft: Partial<BpjsRuleRow>,
): Promise<boolean> {
  if (isDesktopRuntime()) {
    const result = await invokeDesktop<boolean>("desktop_save_bpjs_rule", {
      draft,
    });
    kickDesktopSync();
    return result;
  }
  const response = await requestWebApi<{ sukses: boolean }>(
    "/api/payroll/config/bpjs",
    "PUT",
    { draft },
  );
  return response.sukses;
}

export async function deleteBpjsRule(id: string): Promise<boolean> {
  if (isDesktopRuntime()) {
    const result = await invokeDesktop<boolean>("desktop_delete_bpjs_rule", {
      id,
    });
    kickDesktopSync();
    return result;
  }
  const response = await requestWebApi<{ sukses: boolean }>(
    "/api/payroll/config/bpjs",
    "DELETE",
    { id },
  );
  return response.sukses;
}

export async function saveBpjsRules(rules: BpjsRuleRow[]): Promise<boolean> {
  if (isDesktopRuntime()) {
    const result = await invokeDesktop<boolean>("desktop_save_bpjs_rules", {
      rules,
    });
    kickDesktopSync();
    return result;
  }
  const response = await requestWebApi<{ sukses: boolean }>(
    "/api/payroll/config/bpjs",
    "PUT",
    { rules },
  );
  return response.sukses;
}

export async function getPayrollRecap(
  periodStart: string,
  periodEnd: string,
): Promise<PayrollRecapRow[]> {
  // Desktop DAN Mobile: Mobile mendaftarkan `desktop_get_payroll_recap` dari
  // modul `payroll_admin` (salinan persis modul Desktop). Dulu Mobile memakai
  // `mobile_get_payroll_recap` dengan salinan kalkulatornya sendiri yang tidak
  // mengenal jam hari libur, sehingga estimasi di HP berbeda dari batch.
  if (isDesktopRuntime()) {
    return invokeDesktop<PayrollRecapRow[]>("desktop_get_payroll_recap", {
      periodStart,
      periodEnd,
    });
  }
  const response = await requestWebApi<{ data: PayrollRecapRow[] }>(
    "/api/payroll/recap",
    "POST",
    {
      periodStart,
      periodEnd,
    },
  );
  return response.data;
}

export async function createPayrollRun(
  idempotencyKey: string,
  periodStart: string,
  periodEnd: string,
): Promise<PayrollRunRow> {
  if (isDesktopRuntime()) {
    const result = await invokeDesktop<PayrollRunRow>(
      "desktop_create_payroll_run",
      {
        idempotencyKey,
        periodStart,
        periodEnd,
      },
    );
    kickDesktopSync();
    return result;
  }
  const response = await requestWebApi<{ data: PayrollRunRow }>(
    "/api/payroll/runs",
    "PUT",
    {
      idempotencyKey,
      periodStart,
      periodEnd,
    },
  );
  return response.data;
}

export async function listPayrollRuns(
  status?: string,
): Promise<PayrollRunRow[]> {
  if (isDesktopRuntime()) {
    return invokeDesktop<PayrollRunRow[]>("desktop_list_payroll_runs", {
      status,
    });
  }
  const response = await requestWebApi<{ data: PayrollRunRow[] }>(
    "/api/payroll/runs",
    "POST",
    { status },
  );
  return response.data;
}

export async function getPayrollRunDetail(
  runId: string,
): Promise<PayrollRunDetail> {
  if (isDesktopRuntime()) {
    return invokeDesktop<PayrollRunDetail>("desktop_get_payroll_run_detail", {
      runId,
    });
  }
  const response = await requestWebApi<PayrollRunDetail>(
    "/api/payroll/runs",
    "POST",
    { runId },
  );
  return response;
}

export async function transitionPayrollStatus(
  runId: string,
  targetStatus: string,
  notes?: string,
): Promise<PayrollRunRow> {
  if (isDesktopRuntime()) {
    const result = await invokeDesktop<PayrollRunRow>(
      "desktop_transition_payroll_status",
      {
        runId,
        targetStatus,
        notes,
      },
    );
    kickDesktopSync();
    return result;
  }
  const response = await requestWebApi<{ data: PayrollRunRow }>(
    "/api/payroll/runs",
    "PATCH",
    {
      runId,
      targetStatus,
      notes,
    },
  );
  return response.data;
}

export interface MobileSlipSummary {
  id: string;
  payroll_run_id: string;
  period_start: string;
  period_end: string;
  status: string;
  net_salary: number;
  created_at: string;
}

export interface MobileSlipDetail {
  id: string;
  payroll_run_id: string;
  id_karyawan: string;
  nama_karyawan: string;
  divisi: string;
  ptkp_status: string;
  period_start: string;
  period_end: string;
  total_hadir?: number;
  total_regular_hours: number;
  total_overtime_hours: number;
  total_overtime_index: number;
  total_holiday_hours?: number;
  total_holiday_overtime_index?: number;
  /** JP mengajar yang dibekukan di slip ini. */
  total_teaching_jp?: number;
  teaching_salary?: number;
  rate_per_hour: number;
  basic_salary: number;
  overtime_salary: number;
  gross_salary: number;
  total_allowances: number;
  total_deductions: number;
  bpjs_employee_total: number;
  bpjs_company_total: number;
  pph21_amount: number;
  net_salary: number;
  breakdown_snapshot: string;
  created_at: string;
}

export async function getEmployeePayrollEstimate(
  idKaryawan: string,
  periodStart: string,
  periodEnd: string,
): Promise<MobileSlipDetail> {
  const recap = await getPayrollRecap(periodStart, periodEnd);
  const row = recap.find((r) => r.id_karyawan === idKaryawan);
  if (!row) {
    return {
      id: `EST-${idKaryawan}`,
      payroll_run_id: "ESTIMATE",
      id_karyawan: idKaryawan,
      nama_karyawan: "",
      divisi: "",
      ptkp_status: "TK/0",
      period_start: periodStart,
      period_end: periodEnd,
      total_hadir: 0,
      total_regular_hours: 0,
      total_overtime_hours: 0,
      total_overtime_index: 0,
      total_holiday_hours: 0,
      total_holiday_overtime_index: 0,
      total_teaching_jp: 0,
      teaching_salary: 0,
      rate_per_hour: 0,
      basic_salary: 0,
      overtime_salary: 0,
      gross_salary: 0,
      total_allowances: 0,
      total_deductions: 0,
      bpjs_employee_total: 0,
      bpjs_company_total: 0,
      pph21_amount: 0,
      net_salary: 0,
      breakdown_snapshot: "{}",
      created_at: new Date().toISOString(),
    };
  }
  return {
    id: `EST-${row.id_karyawan}`,
    payroll_run_id: "ESTIMATE",
    id_karyawan: row.id_karyawan,
    nama_karyawan: row.nama_karyawan,
    divisi: row.divisi,
    ptkp_status: row.ptkp_status,
    period_start: periodStart,
    period_end: periodEnd,
    total_hadir: row.total_hadir,
    total_regular_hours: row.total_regular_hours,
    total_overtime_hours: row.total_overtime_hours,
    total_overtime_index: row.total_overtime_index,
    total_holiday_hours: row.total_holiday_hours,
    total_holiday_overtime_index: row.total_holiday_overtime_index,
    total_teaching_jp: row.total_teaching_jp,
    teaching_salary: row.teaching_salary,
    rate_per_hour: row.rate_per_hour,
    basic_salary: row.est_basic_salary,
    overtime_salary: row.est_overtime_salary,
    gross_salary: row.est_gross_salary,
    total_allowances: row.est_total_allowance,
    total_deductions: row.est_total_deduction,
    bpjs_employee_total: row.est_bpjs_employee,
    bpjs_company_total: 0,
    pph21_amount: row.est_pph21,
    net_salary: row.est_net_salary,
    breakdown_snapshot: JSON.stringify({
      rate_per_hour: row.rate_per_hour,
      regular_hours: row.total_regular_hours,
      overtime_hours: row.total_overtime_hours,
      overtime_index: row.total_overtime_index,
      holiday_hours: row.total_holiday_hours,
      holiday_overtime_index: row.total_holiday_overtime_index,
      teaching_jp: row.total_teaching_jp,
      teaching_salary: row.teaching_salary,
      basic_salary: row.est_basic_salary,
      overtime_salary: row.est_overtime_salary,
    }),
    created_at: new Date().toISOString(),
  };
}

export async function getMyPayrollSlips(
  idKaryawan: string,
): Promise<MobileSlipSummary[]> {
  // Jalur "kumpulkan semua run lalu ambil detailnya" di bawah memanggil satu
  // command per batch. Mobile punya command khusus yang membaca tabel hasil
  // sync dalam SATU query — jauh lebih ringan di perangkat genggam.
  if (isMobileRuntime()) {
    const slips = await invokeDesktop<MobileSlipSummary[]>(
      "mobile_get_my_payroll_slips",
      { idKaryawan },
    );
    return slips.filter(
      (slip) => slip.status === "PAID" || slip.status === "APPROVED",
    );
  }
  const runs = await listPayrollRuns();
  const paidRuns = runs.filter(
    (r) => r.status === "PAID" || r.status === "APPROVED",
  );
  const result: MobileSlipSummary[] = [];
  for (const run of paidRuns) {
    try {
      const detail = await getPayrollRunDetail(run.id);
      const myItem = detail.items.find((it) => it.id_karyawan === idKaryawan);
      if (myItem) {
        result.push({
          id: myItem.id,
          payroll_run_id: run.id,
          period_start: run.period_start,
          period_end: run.period_end,
          status: run.status,
          net_salary: myItem.net_salary,
          created_at: myItem.created_at,
        });
      }
    } catch {
      // Ignore run details that fail
    }
  }
  return result;
}

export async function getPayrollSlipDetail(
  slipId: string,
): Promise<MobileSlipDetail> {
  if (isMobileRuntime()) {
    const detail = await invokeDesktop<Omit<MobileSlipDetail, "total_hadir">>(
      "mobile_get_payroll_slip_detail",
      { payrollItemId: slipId },
    );
    // `total_hadir` tidak disimpan pada baris slip; hanya dipakai layar estimasi.
    return { ...detail, total_hadir: 0 };
  }
  const runs = await listPayrollRuns();
  for (const run of runs) {
    try {
      const detail = await getPayrollRunDetail(run.id);
      const item = detail.items.find((it) => it.id === slipId);
      if (item) {
        return {
          id: item.id,
          payroll_run_id: run.id,
          id_karyawan: item.id_karyawan,
          nama_karyawan: item.nama_karyawan,
          divisi: item.divisi,
          ptkp_status: item.ptkp_status,
          period_start: run.period_start,
          period_end: run.period_end,
          total_regular_hours: item.total_regular_hours,
          total_overtime_hours: item.total_overtime_hours,
          total_overtime_index: item.total_overtime_index,
          total_holiday_hours: item.total_holiday_hours,
          total_holiday_overtime_index: item.total_holiday_overtime_index,
          rate_per_hour: item.rate_per_hour,
          basic_salary: item.basic_salary,
          overtime_salary: item.overtime_salary,
          gross_salary: item.gross_salary,
          total_allowances: item.total_allowances,
          total_deductions: item.total_deductions,
          bpjs_employee_total: item.bpjs_employee_total,
          bpjs_company_total: item.bpjs_company_total,
          pph21_amount: item.pph21_amount,
          net_salary: item.net_salary,
          breakdown_snapshot: item.breakdown_snapshot,
          created_at: item.created_at,
        };
      }
    } catch {
      // Baris yang bentuknya tidak dikenali dilewati, bukan menjatuhkan
      // seluruh daftar. Satu baris payroll lama berskema berbeda tidak boleh
      // membuat riwayat penggajian gagal tampil seluruhnya.
    }
  }
  throw new Error("Slip gaji tidak ditemukan.");
}
