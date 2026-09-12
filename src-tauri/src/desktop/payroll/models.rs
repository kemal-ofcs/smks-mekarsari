use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum PayrollStatus {
    Draft,
    Submitted,
    Reviewed,
    Approved,
    Paid,
    Rejected,
}

impl PayrollStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            PayrollStatus::Draft => "DRAFT",
            PayrollStatus::Submitted => "SUBMITTED",
            PayrollStatus::Reviewed => "REVIEWED",
            PayrollStatus::Approved => "APPROVED",
            PayrollStatus::Paid => "PAID",
            PayrollStatus::Rejected => "REJECTED",
        }
    }

    pub fn from_str(s: &str) -> Option<Self> {
        match s.trim().to_uppercase().as_str() {
            "DRAFT" => Some(PayrollStatus::Draft),
            "SUBMITTED" => Some(PayrollStatus::Submitted),
            "REVIEWED" => Some(PayrollStatus::Reviewed),
            "APPROVED" => Some(PayrollStatus::Approved),
            "PAID" => Some(PayrollStatus::Paid),
            "REJECTED" => Some(PayrollStatus::Rejected),
            _ => None,
        }
    }

    pub fn can_transition_to(&self, next: &PayrollStatus) -> bool {
        match (self, next) {
            (PayrollStatus::Draft, PayrollStatus::Submitted) => true,
            (PayrollStatus::Submitted, PayrollStatus::Reviewed) => true,
            (PayrollStatus::Submitted, PayrollStatus::Rejected) => true,
            (PayrollStatus::Reviewed, PayrollStatus::Approved) => true,
            (PayrollStatus::Reviewed, PayrollStatus::Rejected) => true,
            (PayrollStatus::Approved, PayrollStatus::Paid) => true,
            (PayrollStatus::Rejected, PayrollStatus::Draft) => true,
            _ => false,
        }
    }
}

fn default_applies_to() -> String {
    "ALL".to_string()
}

fn default_active() -> i64 {
    1
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OvertimeTierRule {
    #[serde(default)]
    pub id: String,
    pub rule_type: String, // "HARI_KERJA" | "HARI_LIBUR"
    pub tier_order: i64,
    pub hour_start: f64,
    #[serde(default)]
    pub hour_end: Option<f64>,
    pub multiplier: f64,
    #[serde(default = "default_active")]
    pub is_active: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PayrollComponent {
    #[serde(default)]
    pub id: String,
    pub name: String,
    pub category: String,  // "ALLOWANCE" | "DEDUCTION"
    pub calc_type: String, // "FIXED" | "PERCENTAGE"
    pub default_value: f64,
    #[serde(default = "default_applies_to")]
    pub applies_to: String, // "ALL" | id_karyawan
    #[serde(default = "default_active")]
    pub is_active: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaxRule {
    #[serde(default)]
    pub id: String,
    pub category: String, // "TER_A" | "TER_B" | "TER_C" | "PASAL_17"
    pub bracket_min: i64,
    #[serde(default)]
    pub bracket_max: Option<i64>,
    pub rate_percentage: f64,
    #[serde(default)]
    pub effective_date: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BpjsRule {
    #[serde(default)]
    pub id: String,
    pub component_code: String,
    pub component_name: String,
    pub rate_percentage: f64,
    #[serde(default)]
    pub wage_cap: Option<i64>,
    #[serde(default)]
    pub effective_date: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SalaryConfig {
    #[serde(default)]
    pub id: String,
    pub id_karyawan: String,
    pub rate_per_hour: i64,
    /// Tarif bawaan per jam pelajaran; dipakai bila mapel yang diajar belum
    /// punya tarifnya sendiri di `tarif_jp`. Nol berarti tidak dibayar per JP.
    #[serde(default)]
    pub rate_per_jp: i64,
    #[serde(default)]
    pub ptkp_status: String,
    #[serde(default)]
    pub effective_date: String,
    #[serde(default)]
    pub created_by: String,
    #[serde(default)]
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PayrollRun {
    pub id: String,
    pub idempotency_key: String,
    pub period_start: String,
    pub period_end: String,
    pub status: String,
    pub total_gross_payout: i64,
    pub total_net_payout: i64,
    pub total_employees: i64,
    pub created_by: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PayrollItem {
    pub id: String,
    pub payroll_run_id: String,
    pub id_karyawan: String,
    pub nama_karyawan: String,
    pub divisi: String,
    pub ptkp_status: String,
    pub total_regular_hours: f64,
    pub total_overtime_hours: f64,
    pub total_overtime_index: f64,
    /// Seluruh jam kerja yang jatuh pada tanggal hari libur aktif.
    ///
    /// Menurut PP 35/2021 tidak ada "jam kerja biasa" pada hari libur resmi:
    /// SETIAP jam yang dikerjakan hari itu dihitung sebagai lembur. Karena itu
    /// nilainya adalah jam_kerja + lembur pada tanggal tersebut, dan ia sengaja
    /// TIDAK ikut `total_regular_hours`/`total_overtime_hours`.
    pub total_holiday_hours: f64,
    /// Indeks hasil `total_holiday_hours` melewati jenjang HARI_LIBUR.
    pub total_holiday_overtime_index: f64,
    /// JP yang diajar pada periode ini, DIBEKUKAN bersama honornya di bawah.
    #[serde(default)]
    pub total_teaching_jp: i64,
    #[serde(default)]
    pub teaching_salary: i64,
    pub rate_per_hour: i64,
    pub basic_salary: i64,
    pub overtime_salary: i64,
    pub gross_salary: i64,
    pub total_allowances: i64,
    pub total_deductions: i64,
    pub bpjs_employee_total: i64,
    pub bpjs_company_total: i64,
    pub pph21_amount: i64,
    pub net_salary: i64,
    pub breakdown_snapshot: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PayrollAuditLog {
    pub id: String,
    pub payroll_run_id: String,
    pub action: String,
    pub old_status: Option<String>,
    pub new_status: String,
    pub performed_by: String,
    pub notes: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PayrollRecapRow {
    pub id_karyawan: String,
    pub nama_karyawan: String,
    pub divisi: String,
    /// Dibawa dari rekap supaya PEMBEKUAN memakai sudut pandang yang sama
    /// dengan yang dilihat admin. Tanpa keduanya, pembekuan harus menanyakan
    /// ulang kelompok setiap orang ke database — dan jawaban yang berubah di
    /// antara dua query berarti angka yang disetujui bukan angka yang dibayar.
    pub jenis_personil: String,
    pub status_kepegawaian: String,
    pub rate_per_hour: i64,
    pub ptkp_status: String,
    pub total_hadir: i64,
    pub total_terlambat_menit: i64,
    /// Menit MENTAH dari `absensi_harian`, sebelum dibagi 60.
    ///
    /// Inilah sumber kebenaran jamnya, dan pembekuan payroll WAJIB berangkat
    /// dari sini — bukan dari `total_regular_hours` di bawah. Angka jam itu
    /// `f64` hasil pembagian, dan membacanya kembali menjadi `Decimal` tidak
    /// mengembalikan presisi yang sudah hilang: pratinjau menghitung
    /// `menit/60` secara eksak, sementara pembekuan yang berangkat dari `f64`
    /// menghasilkan angka yang berbeda satu rupiah pada setiap nilai yang
    /// jatuh tepat di titik tengah pembulatan (11 menit pada tarif 18.750/jam
    /// = 3.437,5 tepat). Admin lalu menyetujui satu angka dan membayarkan
    /// angka lain.
    pub total_regular_minutes: i64,
    pub total_overtime_minutes: i64,
    pub total_holiday_minutes: i64,
    pub total_regular_hours: f64,
    pub total_overtime_hours: f64,
    pub total_overtime_index: f64,
    /// Jam kerja pada tanggal hari libur (jam_kerja + lembur hari itu).
    pub total_holiday_hours: f64,
    /// Indeks jenjang HARI_LIBUR untuk jam di atas.
    pub total_holiday_overtime_index: f64,
    /// Jumlah jam pelajaran yang diajar dan sudah diparaf pada periode ini.
    pub total_teaching_jp: i64,
    /// Honor mengajar dari JP di atas.
    pub teaching_salary: i64,
    /// JP yang tidak menemukan tarif mana pun (tarif mapel maupun bawaan).
    ///
    /// Ditampilkan sebagai peringatan, BUKAN penghalang. Tarif nol adalah
    /// keadaan normal bagi sekolah yang tidak memakai honor per JP sama
    /// sekali, sehingga memblokir payroll karenanya akan mengunci seluruh
    /// penggajian hanya karena fitur ini ada.
    pub unrated_teaching_jp: i64,
    pub est_basic_salary: i64,
    pub est_overtime_salary: i64,
    pub est_gross_salary: i64,
    pub est_total_allowance: i64,
    pub est_total_deduction: i64,
    pub est_bpjs_employee: i64,
    pub est_pph21: i64,
    pub est_net_salary: i64,
}

/// Satu orang, dilihat dari sudut pandang penyaringan komponen payroll.
///
/// Ketiga kolom di bawah `id_karyawan` adalah yang membuat tunjangan bisa
/// ditujukan ke KELOMPOK — semua guru, guru honorer, satu divisi — tanpa
/// menuliskan satu per satu orangnya. Ketiganya sengaja dibawa dari baris rekap
/// yang sudah ada, bukan dari query tambahan per komponen.
#[derive(Debug, Clone, Default)]
pub struct ComponentSubject {
    pub id_karyawan: String,
    /// `master_data.jenis_personil`, ejaan apa adanya.
    pub jenis_personil: String,
    /// `guru_data.status_kepegawaian`; kosong untuk yang bukan guru.
    pub status_kepegawaian: String,
    /// `master_data.divisi`.
    pub divisi: String,
    /// JP mengajar terparaf pada periode ini; dasar komponen `PER_JP`.
    pub total_teaching_jp: i64,
    /// Hari hadir pada periode ini; dasar komponen `PER_HADIR`.
    pub total_hadir: i64,
}

/// Satu sesi mengajar yang JP-nya dihitung.
///
/// Hanya sesi `presensi_mapel` yang jurnal mengajarnya SUDAH DIPARAF yang
/// pernah sampai ke sini — paraf itu bukti bahwa pelajarannya benar berlangsung,
/// dan itulah syarat yang dipilih pemilik sistem ini.
#[derive(Debug, Clone)]
pub struct TaughtSession {
    pub id_presensi_mapel: String,
    pub id_mapel: String,
    pub tanggal: String,
    /// Jam pelajaran pertama dan terakhir sesi ini, inklusif di kedua ujung.
    pub jam_awal: u32,
    pub jam_akhir: u32,
}

/// Satu baris `tarif_jp`.
#[derive(Debug, Clone)]
pub struct JpRate {
    pub id: String,
    pub id_mapel: String,
    /// `None` berarti tarif umum untuk mapel ini, berlaku bagi guru mana pun.
    pub id_guru: Option<String>,
    pub rate_per_jp: i64,
    pub effective_date: String,
    pub status_aktif: i64,
    pub updated_at: String,
}

/// Hasil penjumlahan JP dan honor seorang guru pada satu periode.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TeachingTotals {
    pub total_jp: i64,
    pub honor: i64,
    /// JP yang tidak menemukan tarif mana pun. Peringatan, bukan penghalang.
    pub unrated_jp: i64,
}
