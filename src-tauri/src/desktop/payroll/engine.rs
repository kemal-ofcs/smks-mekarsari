use rust_decimal::prelude::*;
use rust_decimal::Decimal;
use serde_json::json;
use std::collections::HashSet;

use super::models::{
    BpjsRule, ComponentSubject, JpRate, OvertimeTierRule, PayrollComponent, TaughtSession, TaxRule,
    TeachingTotals,
};

/// Bentuk kanonik `master_data.jenis_personil`.
///
/// Kolomnya tersimpan dengan ejaan berbeda-beda — 'GURU' dari alur akademik,
/// 'Guru' dari normalisasi, 'Pegawai' dari impor Excel — sehingga ia tidak
/// pernah boleh dibandingkan mentah. Cerminan `normalizePersonnelRole` di
/// `src/lib/contracts/scanner.ts`, termasuk jatuhnya nilai asing ke "Pegawai".
fn normalize_personnel_role(raw: &str) -> &'static str {
    match raw.trim().to_ascii_uppercase().as_str() {
        "SISWA" => "Siswa",
        "GURU" => "Guru",
        _ => "Pegawai",
    }
}

pub struct PayrollCalculator;

impl PayrollCalculator {
    /// Upah dari MENIT bulat dan tarif per jam.
    ///
    /// Urutannya menentukan, dan inilah satu-satunya tempat urutan itu dieja.
    /// Membagi lebih dulu — `Decimal::from(menit) / 60`, lalu dikalikan tarif —
    /// membuang presisi SEBELUM pembulatan: `11/60` bukan pecahan yang
    /// berhenti, jadi ia dipotong pada 28 digit menjadi sedikit di BAWAH nilai
    /// sebenarnya, dan hasil kalinya menjadi 3437,4999… Nilai yang seharusnya
    /// 3437,5 tepat lalu dibulatkan ke bawah, sehingga kebijakan
    /// `MidpointAwayFromZero` yang tertulis di bawah tidak pernah benar-benar
    /// berlaku pada titik tengah.
    ///
    /// Mengalikan lebih dulu membuat pembilangnya bilangan bulat eksak, dan
    /// hasil baginya oleh 60 selalu berhenti tepat ketika nilainya setengah
    /// bulat — persis kasus yang pembulatannya diperdebatkan. Cerminan TS-nya
    /// ada di `payroll-recap.ts` dan wajib tetap sama.
    pub fn wage_from_minutes(minutes: i64, rate_per_hour: i64) -> Decimal {
        ((Decimal::from(minutes) * Decimal::from(rate_per_hour)) / Decimal::from(60))
            .round_dp_with_strategy(0, RoundingStrategy::MidpointAwayFromZero)
    }

    /// Menghitung akumulasi indeks lembur berjenjang (PP 35/2021)
    /// Contoh Hari Kerja: 3 Jam Lembur -> Jam 1: 1.0 * 1.5 = 1.5; Jam 2-3: 2.0 * 2.0 = 4.0; Total Indeks = 5.5
    pub fn calculate_overtime_index(
        overtime_hours: Decimal,
        tiers: &[OvertimeTierRule],
    ) -> Decimal {
        if overtime_hours <= Decimal::ZERO || tiers.is_empty() {
            return Decimal::ZERO;
        }

        let mut remaining = overtime_hours;
        let mut total_index = Decimal::ZERO;

        for tier in tiers {
            if tier.is_active == 0 {
                continue;
            }
            if remaining <= Decimal::ZERO {
                break;
            }

            let start = Decimal::from_f64_retain(tier.hour_start).unwrap_or(Decimal::ZERO);
            let multiplier = Decimal::from_f64_retain(tier.multiplier).unwrap_or(Decimal::ONE);

            let span = match tier.hour_end {
                Some(end) => {
                    let end_dec = Decimal::from_f64_retain(end).unwrap_or(Decimal::ZERO);
                    if end_dec > start {
                        end_dec - start
                    } else {
                        Decimal::ZERO
                    }
                }
                None => remaining, // Tier tak berhingga
            };

            if span <= Decimal::ZERO {
                continue;
            }

            let hours_in_tier = remaining.min(span);
            total_index += hours_in_tier * multiplier;
            remaining -= hours_in_tier;
        }

        total_index.round_dp_with_strategy(2, RoundingStrategy::MidpointAwayFromZero)
    }

    /// Menerapkan sakelar lembur pada menit mentah seseorang.
    ///
    /// Ketika lembur DIIZINKAN, nilainya diteruskan apa adanya — itulah
    /// perilaku yang sudah berjalan. Ketika TIDAK, dua hal terjadi dan keduanya
    /// disengaja: menit lemburnya menjadi nol, dan jam kerja pada tanggal libur
    /// berpindah ke menit reguler alih-alih ikut hilang.
    ///
    /// Bagian kedua itu yang mudah salah. Jam pada tanggal libur sengaja berada
    /// di luar menit reguler karena menurut PP 35/2021 setiap jam hari itu
    /// dihitung lembur. Kalau sakelarnya hanya "buang yang berbau lembur", guru
    /// yang benar-benar mengajar di hari libur dibayar NOL untuk hari itu —
    /// bukan kehilangan pengali lemburnya, melainkan tidak dibayar sama sekali.
    /// Menit lembur pada hari libur tetap dibuang; jam kerjanya dipertahankan.
    ///
    /// Mengembalikan `(menit reguler, menit lembur, menit hari libur)`.
    /// Cerminan `applyOvertimePolicy` di `payroll-calculator.ts`; keduanya
    /// diuji dengan vektor yang sama.
    pub fn apply_overtime_policy(
        regular_minutes: i64,
        overtime_minutes: i64,
        holiday_total_minutes: i64,
        holiday_regular_minutes: i64,
        overtime_allowed: bool,
    ) -> (i64, i64, i64) {
        if overtime_allowed {
            (regular_minutes, overtime_minutes, holiday_total_minutes)
        } else {
            (regular_minutes + holiday_regular_minutes, 0, 0)
        }
    }

    /// Tarif per JP yang berlaku untuk satu sesi mengajar.
    ///
    /// Urutannya: tarif khusus (guru + mapel) menang atas tarif umum mapel,
    /// dan keduanya menang atas tarif bawaan orang itu di `salary_configs`.
    /// Dalam satu tingkat, yang dipilih adalah `effective_date` terbesar yang
    /// tidak melewati tanggal sesi — tarif yang naik di tengah bulan karena itu
    /// tidak pernah berlaku surut.
    ///
    /// Urutan pemutus serinya (tanggal berlaku, lalu `updated_at`, lalu `id`)
    /// SENGAJA lengkap sampai ke `id`. `tarif_jp` tidak punya UNIQUE selain PK,
    /// jadi dua perangkat offline boleh membuat baris yang sama persis; tanpa
    /// pemutus yang deterministik, dua perangkat akan memilih tarif berbeda
    /// untuk sesi yang sama dan menghasilkan slip yang berbeda dari data yang
    /// identik.
    ///
    /// Cerminan `resolveJpRate` di `payroll-calculator.ts`.
    pub fn resolve_jp_rate(
        rates: &[JpRate],
        id_mapel: &str,
        id_guru: &str,
        tanggal: &str,
        fallback_rate: i64,
    ) -> i64 {
        let mut terpilih: Option<&JpRate> = None;
        let mut terpilih_khusus = false;

        for rate in rates {
            if rate.status_aktif == 0 || rate.id_mapel != id_mapel {
                continue;
            }
            if rate.effective_date.as_str() > tanggal {
                continue;
            }
            let khusus = match rate.id_guru.as_deref() {
                Some(guru) if !guru.trim().is_empty() => {
                    if guru != id_guru {
                        continue;
                    }
                    true
                }
                _ => false,
            };

            let lebih_baik = match terpilih {
                None => true,
                Some(_) if khusus != terpilih_khusus => khusus,
                Some(lama) => (
                    &rate.effective_date,
                    &rate.updated_at,
                    &rate.id,
                ) > (&lama.effective_date, &lama.updated_at, &lama.id),
            };

            if lebih_baik {
                terpilih = Some(rate);
                terpilih_khusus = khusus;
            }
        }

        terpilih
            .map(|rate| rate.rate_per_jp)
            .unwrap_or(fallback_rate)
            .max(0)
    }

    /// Menjumlahkan JP dan honor seorang guru pada satu periode.
    ///
    /// Jam pelajaran dihitung sebagai GABUNGAN: satu jam pada satu tanggal
    /// dihitung SEKALI meskipun tercatat di beberapa sesi. Itu bukan pembulatan
    /// ke bawah melainkan syarat kebenaran — guru Agama mengajar siswa dari
    /// tiga rombel pada jam yang sama dan setiap rombel tetap butuh presensinya
    /// sendiri, begitu pula kelas gabungan PJOK. Menjumlahkan sesi begitu saja
    /// akan membayar satu jam kerja tiga kali. Ini juga yang membuat sesi
    /// kembar dari dua perangkat offline tidak pernah menggandakan honor.
    ///
    /// Sesinya diurutkan lebih dulu supaya jam yang diklaim oleh dua mapel
    /// berbeda selalu jatuh ke mapel yang sama di perangkat mana pun.
    ///
    /// Cerminan `summarizeTeaching` di `payroll-calculator.ts`; keduanya diuji
    /// dengan vektor yang sama.
    pub fn summarize_teaching(
        sessions: &[TaughtSession],
        rates: &[JpRate],
        id_guru: &str,
        fallback_rate: i64,
    ) -> TeachingTotals {
        let mut urut: Vec<&TaughtSession> = sessions.iter().collect();
        urut.sort_by(|a, b| {
            (&a.tanggal, a.jam_awal, a.jam_akhir, &a.id_mapel, &a.id_presensi_mapel).cmp(&(
                &b.tanggal,
                b.jam_awal,
                b.jam_akhir,
                &b.id_mapel,
                &b.id_presensi_mapel,
            ))
        });

        let mut terpakai: HashSet<(String, u32)> = HashSet::new();
        let mut total_jp = 0i64;
        let mut honor = 0i64;
        let mut unrated_jp = 0i64;

        for sesi in urut {
            if sesi.jam_akhir < sesi.jam_awal {
                continue;
            }
            for jam in sesi.jam_awal..=sesi.jam_akhir {
                if !terpakai.insert((sesi.tanggal.clone(), jam)) {
                    continue;
                }
                total_jp += 1;
                let rate = Self::resolve_jp_rate(
                    rates,
                    &sesi.id_mapel,
                    id_guru,
                    &sesi.tanggal,
                    fallback_rate,
                );
                if rate > 0 {
                    honor += rate;
                } else {
                    unrated_jp += 1;
                }
            }
        }

        TeachingTotals {
            total_jp,
            honor,
            unrated_jp,
        }
    }

    /// Apakah komponen dengan `applies_to` ini berlaku untuk orang tersebut?
    ///
    /// "ALL" berlaku untuk semua; sebuah id berlaku untuk satu orang; dan
    /// ketiga awalan kelompok (`PERSONIL:`, `STATUS:`, `DIVISI:`) dijawab dari
    /// kolom yang sudah dibawa rekap. Nilai yang TIDAK dikenal diperlakukan
    /// sebagai id — bukan sebagai "berlaku untuk semua". Salah arah di sini
    /// berarti tunjangan menyebar ke seluruh sekolah karena satu salah ketik,
    /// dan itu tidak terlihat di layar mana pun sampai slip terbit.
    ///
    /// Cerminan `appliesToSubject` di `src/lib/validations/payroll-policy.ts`;
    /// keduanya diuji dengan vektor yang sama.
    pub fn applies_to_subject(applies_to: &str, subject: &ComponentSubject) -> bool {
        let value = applies_to.trim();
        if value.is_empty() || value.eq_ignore_ascii_case("ALL") {
            return true;
        }

        if let Some((prefix, isi)) = value.split_once(':') {
            let prefix = prefix.trim().to_ascii_uppercase();
            let isi = isi.trim();
            if !isi.is_empty() {
                let sama = |lain: &str| lain.trim().eq_ignore_ascii_case(isi);
                match prefix.as_str() {
                    // Jenis personil tersimpan dengan ejaan berbeda-beda
                    // ('GURU', 'Guru'), jadi dinormalkan dulu seperti di TS.
                    "PERSONIL" => return sama(normalize_personnel_role(&subject.jenis_personil)),
                    "STATUS" => return sama(&subject.status_kepegawaian),
                    "DIVISI" => return sama(&subject.divisi),
                    _ => {}
                }
            }
        }

        value == subject.id_karyawan
    }

    /// Menghitung tunjangan dan potongan dinamis
    pub fn calculate_components(
        basic_salary: Decimal,
        components: &[PayrollComponent],
        subject: &ComponentSubject,
    ) -> (Decimal, Decimal, Vec<serde_json::Value>) {
        let mut total_allowance = Decimal::ZERO;
        let mut total_deduction = Decimal::ZERO;
        let mut breakdown = Vec::new();

        for comp in components {
            if comp.is_active == 0 {
                continue;
            }
            if !Self::applies_to_subject(&comp.applies_to, subject) {
                continue;
            }

            let default_val = Decimal::from_f64_retain(comp.default_value).unwrap_or(Decimal::ZERO);
            // Keempat jenis dieja di SATU tempat ini, dan `_` jatuh ke nominal
            // tetap — sama seperti sebelum PER_JP dan PER_HADIR ada. Jenis
            // asing karena itu tidak pernah membuat slip gagal terbit; ia hanya
            // membayar nominal yang tertulis, yang memang bentuk paling jinak
            // dari sebuah nilai yang tidak dikenali.
            let nominal = match comp.calc_type.as_str() {
                "PERCENTAGE" => (basic_salary * (default_val / Decimal::from(100)))
                    .round_dp_with_strategy(0, RoundingStrategy::MidpointAwayFromZero),
                "PER_JP" => (default_val * Decimal::from(subject.total_teaching_jp.max(0)))
                    .round_dp_with_strategy(0, RoundingStrategy::MidpointAwayFromZero),
                "PER_HADIR" => (default_val * Decimal::from(subject.total_hadir.max(0)))
                    .round_dp_with_strategy(0, RoundingStrategy::MidpointAwayFromZero),
                _ => default_val.round_dp_with_strategy(0, RoundingStrategy::MidpointAwayFromZero),
            };

            if comp.category == "ALLOWANCE" {
                total_allowance += nominal;
            } else {
                total_deduction += nominal;
            }

            breakdown.push(json!({
                "id": comp.id,
                "name": comp.name,
                "category": comp.category,
                "calc_type": comp.calc_type,
                "rate": comp.default_value,
                "nominal": nominal.to_i64().unwrap_or(0)
            }));
        }

        (total_allowance, total_deduction, breakdown)
    }

    /// Menghitung BPJS Ketenagakerjaan & Kesehatan
    pub fn calculate_bpjs(
        gross_salary: Decimal,
        bpjs_rules: &[BpjsRule],
    ) -> (Decimal, Decimal, Vec<serde_json::Value>) {
        let mut total_emp = Decimal::ZERO;
        let mut total_co = Decimal::ZERO;
        let mut breakdown = Vec::new();

        for rule in bpjs_rules {
            let basis = match rule.wage_cap {
                Some(cap) if cap > 0 => {
                    let cap_dec = Decimal::from(cap);
                    gross_salary.min(cap_dec)
                }
                _ => gross_salary,
            };

            let rate = Decimal::from_f64_retain(rule.rate_percentage).unwrap_or(Decimal::ZERO);
            let nominal = (basis * (rate / Decimal::from(100)))
                .round_dp_with_strategy(0, RoundingStrategy::MidpointAwayFromZero);

            let is_employee = rule.component_code.ends_with("_EMP");
            if is_employee {
                total_emp += nominal;
            } else {
                total_co += nominal;
            }

            breakdown.push(json!({
                "code": rule.component_code,
                "name": rule.component_name,
                "rate": rule.rate_percentage,
                "wage_cap": rule.wage_cap,
                "nominal": nominal.to_i64().unwrap_or(0),
                "is_employee": is_employee
            }));
        }

        (total_emp, total_co, breakdown)
    }

    /// Menghitung PPh 21 Metode TER (PMK 168/2023)
    pub fn calculate_pph21_ter(
        gross_salary: Decimal,
        ptkp_status: &str,
        tax_rules: &[TaxRule],
    ) -> (Decimal, serde_json::Value) {
        // Tentukan Kategori TER berdasarkan PTKP
        let ter_category = match ptkp_status.trim().to_uppercase().as_str() {
            "TK/0" | "TK/1" | "K/0" => "TER_A",
            "TK/2" | "TK/3" | "K/1" | "K/2" => "TER_B",
            "K/3" => "TER_C",
            _ => "TER_A",
        };

        let gross_i64 = gross_salary.to_i64().unwrap_or(0);

        // Cari bracket TER yang cocok
        let matching_rule = tax_rules.iter().find(|rule| {
            if rule.category != ter_category {
                return false;
            }
            let min_ok = gross_i64 >= rule.bracket_min;
            let max_ok = match rule.bracket_max {
                Some(max) => gross_i64 <= max,
                None => true,
            };
            min_ok && max_ok
        });

        if let Some(rule) = matching_rule {
            let rate = Decimal::from_f64_retain(rule.rate_percentage).unwrap_or(Decimal::ZERO);
            let pph21 = (gross_salary * (rate / Decimal::from(100)))
                .round_dp_with_strategy(0, RoundingStrategy::MidpointAwayFromZero);

            (
                pph21,
                json!({
                    "method": "TER",
                    "category": ter_category,
                    "ptkp_status": ptkp_status,
                    "rate_percentage": rule.rate_percentage,
                    "pph21_amount": pph21.to_i64().unwrap_or(0)
                }),
            )
        } else {
            (
                Decimal::ZERO,
                json!({
                    "method": "TER",
                    "category": ter_category,
                    "ptkp_status": ptkp_status,
                    "rate_percentage": 0.0,
                    "pph21_amount": 0
                }),
            )
        }
    }
}

#[cfg(test)]
mod tests {
    // Jalur RELATIF, bukan `crate::desktop::…`: berkas ini disalin ke Mobile
    // sebagai `payroll_admin`, dan penulisan ulang `crate::desktop` →
    // `crate::mobile` akan menunjuk modul yang namanya berbeda di sana.
    use super::super::models::{
        ComponentSubject, JpRate, PayrollComponent, TaughtSession, TeachingTotals,
    };
    use super::PayrollCalculator;
    use rust_decimal::Decimal;

    /// Vektor yang SAMA dieja di `payroll-calculator.test.ts`.
    ///
    /// Uang dihitung dua kali di repo ini — Rust untuk Desktop/Mobile, TypeScript
    /// untuk Web — dan keduanya menulis ke `payroll_items` yang sama. Yang
    /// menjaga keduanya tetap sepakat bukan komentar, melainkan vektor ini.
    ///
    /// Empat kasus pertama adalah titik tengah sejati: `menit x tarif` habis
    /// dibagi 30 tetapi tidak habis dibagi 60, sehingga nilainya tepat setengah
    /// rupiah. Di sanalah kebijakan `MidpointAwayFromZero` benar-benar diuji,
    /// dan di sanalah urutan bagi-lalu-kali yang lama selalu membulatkan ke
    /// BAWAH.
    const VEKTOR: &[(i64, i64, i64)] = &[
        // (menit, tarif per jam, upah yang benar)
        (11, 18_750, 3_438),
        (9, 18_750, 2_813),
        (7, 18_750, 2_188),
        (13, 18_750, 4_063),
        // Pembagian yang berhenti: tidak ada perdebatan pembulatan.
        (60, 25_000, 25_000),
        (30, 25_000, 12_500),
        (0, 25_000, 0),
        // Sehari penuh dan sebulan penuh.
        (480, 18_750, 150_000),
        (10_080, 21_875, 3_675_000),
    ];

    #[test]
    fn upah_dari_menit_membulatkan_titik_tengah_menjauhi_nol() {
        for (menit, tarif, harapan) in VEKTOR {
            let hasil = PayrollCalculator::wage_from_minutes(*menit, *tarif);
            assert_eq!(
                hasil,
                Decimal::from(*harapan),
                "{menit} menit pada tarif {tarif}/jam"
            );
        }
    }

    /// Vektor sasaran komponen — WAJIB identik dengan `appliesToSubject` di
    /// `payroll-calculator.test.ts`.
    ///
    /// `(applies_to, cocok untuk guru honorer Divisi Kurikulum?)`
    const VEKTOR_SASARAN: &[(&str, bool)] = &[
        ("ALL", true),
        ("", true),
        ("all", true),
        // Perorangan: hanya orang itu.
        ("emp-1", true),
        ("emp-2", false),
        // Jenis personil, dinormalkan lebih dulu.
        ("PERSONIL:Guru", true),
        ("personil:guru", true),
        ("PERSONIL:GURU", true),
        ("PERSONIL:Pegawai", false),
        // Status kepegawaian, hanya dimiliki guru.
        ("STATUS:Honorer", true),
        ("STATUS:honorer", true),
        ("STATUS:PNS", false),
        // Divisi, nama bebas tulisan sekolahnya.
        ("DIVISI:Kurikulum", true),
        ("DIVISI:kurikulum", true),
        ("DIVISI:Tata Usaha", false),
        // Awalan yang TIDAK dikenal diperlakukan sebagai id, bukan "semua".
        ("KELOMPOK:Guru", false),
        ("PERSONIL:", false),
    ];

    #[test]
    fn sasaran_komponen_dinilai_dari_kelompok_dan_bukan_dari_tebakan() {
        let subject = ComponentSubject {
            id_karyawan: "emp-1".to_string(),
            jenis_personil: "GURU".to_string(),
            status_kepegawaian: "Honorer".to_string(),
            divisi: "Kurikulum".to_string(),
            ..Default::default()
        };

        for (applies_to, harapan) in VEKTOR_SASARAN {
            assert_eq!(
                PayrollCalculator::applies_to_subject(applies_to, &subject),
                *harapan,
                "applies_to: {applies_to}"
            );
        }
    }

    /// Vektor jenis perhitungan — WAJIB identik dengan blok "jenis perhitungan
    /// komponen" di `payroll-calculator.test.ts`.
    ///
    /// `(calc_type, nilai, nominal untuk 20 JP / 24 hari hadir / pokok 2.000.000)`
    const VEKTOR_CALC: &[(&str, f64, i64)] = &[
        ("FIXED", 150_000.0, 150_000),
        ("PERCENTAGE", 10.0, 200_000),
        ("PER_JP", 5_000.0, 100_000),
        ("PER_HADIR", 25_000.0, 600_000),
        // Jenis asing membayar nominal yang tertulis — bentuk paling jinak,
        // dan sama seperti sebelum kedua jenis baru ada.
        ("ENTAH_APA", 7_000.0, 7_000),
    ];

    #[test]
    fn jenis_perhitungan_komponen_dihitung_dari_dasar_masing_masing() {
        let subject = ComponentSubject {
            id_karyawan: "emp-1".to_string(),
            jenis_personil: "GURU".to_string(),
            status_kepegawaian: "Honorer".to_string(),
            divisi: "Kurikulum".to_string(),
            total_teaching_jp: 20,
            total_hadir: 24,
        };

        for (calc_type, nilai, harapan) in VEKTOR_CALC {
            let comp = PayrollComponent {
                id: "c1".to_string(),
                name: "Uji".to_string(),
                category: "ALLOWANCE".to_string(),
                calc_type: (*calc_type).to_string(),
                default_value: *nilai,
                applies_to: "ALL".to_string(),
                is_active: 1,
            };
            let (allowance, _, _) = PayrollCalculator::calculate_components(
                Decimal::from(2_000_000),
                std::slice::from_ref(&comp),
                &subject,
            );
            assert_eq!(
                allowance,
                Decimal::from(*harapan),
                "calc_type: {calc_type}"
            );
        }
    }

    #[test]
    fn dasar_negatif_tidak_pernah_mengurangi_tunjangan() {
        // JP dan hari hadir tidak bisa negatif lewat jalur normal, tetapi
        // membiarkannya mengalir apa adanya berarti satu baris data rusak bisa
        // MENGURANGI tunjangan orang lain lewat total yang sama.
        let subject = ComponentSubject {
            id_karyawan: "emp-1".to_string(),
            total_teaching_jp: -5,
            total_hadir: -3,
            ..Default::default()
        };
        let comp = PayrollComponent {
            id: "c1".to_string(),
            name: "Uji".to_string(),
            category: "ALLOWANCE".to_string(),
            calc_type: "PER_JP".to_string(),
            default_value: 5_000.0,
            applies_to: "ALL".to_string(),
            is_active: 1,
        };
        let (allowance, _, _) = PayrollCalculator::calculate_components(
            Decimal::ZERO,
            std::slice::from_ref(&comp),
            &subject,
        );
        assert_eq!(allowance, Decimal::ZERO);
    }

    #[test]
    fn kelompok_status_tidak_pernah_cocok_untuk_yang_bukan_guru() {
        // `status_kepegawaian` kosong bagi karyawan non-guru, dan kosong tidak
        // boleh cocok dengan apa pun — kalau tidak, "Guru berstatus Honorer"
        // akan menyebar ke seluruh staf.
        let staf = ComponentSubject {
            id_karyawan: "emp-9".to_string(),
            jenis_personil: "Pegawai".to_string(),
            status_kepegawaian: String::new(),
            divisi: "Tata Usaha".to_string(),
            ..Default::default()
        };
        assert!(!PayrollCalculator::applies_to_subject(
            "STATUS:Honorer",
            &staf
        ));
        assert!(PayrollCalculator::applies_to_subject(
            "PERSONIL:Pegawai",
            &staf
        ));
        assert!(PayrollCalculator::applies_to_subject(
            "DIVISI:Tata Usaha",
            &staf
        ));
    }

    /// Vektor sakelar lembur — WAJIB identik dengan `applyOvertimePolicy` di
    /// `payroll-calculator.test.ts`.
    ///
    /// `(reguler, lembur, total hari libur, jam kerja hari libur, diizinkan)`
    /// menghasilkan `(reguler, lembur, hari libur)`.
    const VEKTOR_LEMBUR: &[(i64, i64, i64, i64, bool, i64, i64, i64)] = &[
        // Diizinkan: diteruskan apa adanya.
        (9_600, 240, 480, 360, true, 9_600, 240, 480),
        (9_600, 0, 0, 0, true, 9_600, 0, 0),
        // Tidak diizinkan: lembur hilang, jam kerja hari libur pindah ke reguler.
        (9_600, 240, 480, 360, false, 9_960, 0, 0),
        // Tanpa hari libur: hanya lemburnya yang hilang.
        (9_600, 240, 0, 0, false, 9_600, 0, 0),
        // Seluruh periode jatuh pada hari libur: tetap dibayar jam kerjanya.
        (0, 0, 480, 360, false, 360, 0, 0),
    ];

    #[test]
    fn sakelar_lembur_memindahkan_jam_hari_libur_bukan_membuangnya() {
        for (reguler, lembur, libur_total, libur_kerja, diizinkan, r, l, h) in VEKTOR_LEMBUR {
            assert_eq!(
                PayrollCalculator::apply_overtime_policy(
                    *reguler,
                    *lembur,
                    *libur_total,
                    *libur_kerja,
                    *diizinkan
                ),
                (*r, *l, *h),
                "({reguler}, {lembur}, {libur_total}, {libur_kerja}, diizinkan={diizinkan})"
            );
        }
    }

    fn tarif(
        id: &str,
        mapel: &str,
        guru: Option<&str>,
        rate: i64,
        berlaku: &str,
        updated: &str,
    ) -> JpRate {
        JpRate {
            id: id.to_string(),
            id_mapel: mapel.to_string(),
            id_guru: guru.map(|g| g.to_string()),
            rate_per_jp: rate,
            effective_date: berlaku.to_string(),
            status_aktif: 1,
            updated_at: updated.to_string(),
        }
    }

    fn sesi(id: &str, mapel: &str, tanggal: &str, awal: u32, akhir: u32) -> TaughtSession {
        TaughtSession {
            id_presensi_mapel: id.to_string(),
            id_mapel: mapel.to_string(),
            tanggal: tanggal.to_string(),
            jam_awal: awal,
            jam_akhir: akhir,
        }
    }

    /// Urutan pemilihan tarif — WAJIB identik dengan `resolveJpRate` di
    /// `payroll-calculator.test.ts`.
    #[test]
    fn tarif_khusus_guru_menang_atas_tarif_umum_mapel() {
        let rates = vec![
            tarif("t1", "mtk", None, 100_000, "2026-01-01", "2026-01-01"),
            tarif("t2", "mtk", Some("g1"), 120_000, "2026-01-01", "2026-01-01"),
            tarif("t3", "ind", None, 50_000, "2026-01-01", "2026-01-01"),
        ];

        // Guru yang punya tarif khusus memakainya, meski tarif umum ada.
        assert_eq!(
            PayrollCalculator::resolve_jp_rate(&rates, "mtk", "g1", "2026-09-10", 0),
            120_000
        );
        // Guru lain memakai tarif umum mapel itu.
        assert_eq!(
            PayrollCalculator::resolve_jp_rate(&rates, "mtk", "g2", "2026-09-10", 0),
            100_000
        );
        // Mapel lain memakai tarifnya sendiri.
        assert_eq!(
            PayrollCalculator::resolve_jp_rate(&rates, "ind", "g1", "2026-09-10", 0),
            50_000
        );
        // Mapel tanpa tarif jatuh ke tarif bawaan orangnya.
        assert_eq!(
            PayrollCalculator::resolve_jp_rate(&rates, "seni", "g1", "2026-09-10", 40_000),
            40_000
        );
    }

    #[test]
    fn tarif_yang_berlaku_mengikuti_tanggal_sesi_bukan_akhir_periode() {
        let rates = vec![
            tarif("t1", "mtk", None, 100_000, "2026-01-01", "2026-01-01"),
            tarif("t2", "mtk", None, 150_000, "2026-09-15", "2026-09-15"),
        ];

        // Sebelum tarif baru berlaku: tarif lama. Kenaikan tidak berlaku surut.
        assert_eq!(
            PayrollCalculator::resolve_jp_rate(&rates, "mtk", "g1", "2026-09-14", 0),
            100_000
        );
        // Pada dan sesudah tanggal berlakunya: tarif baru.
        assert_eq!(
            PayrollCalculator::resolve_jp_rate(&rates, "mtk", "g1", "2026-09-15", 0),
            150_000
        );
    }

    #[test]
    fn baris_tarif_kembar_dipilih_secara_deterministik() {
        // `tarif_jp` tanpa UNIQUE selain PK: dua perangkat offline boleh
        // membuat baris yang sama persis. Yang dipilih harus sama di keduanya.
        let rates = vec![
            tarif("aaa", "mtk", None, 90_000, "2026-01-01", "2026-01-02"),
            tarif("zzz", "mtk", None, 110_000, "2026-01-01", "2026-01-02"),
        ];
        assert_eq!(
            PayrollCalculator::resolve_jp_rate(&rates, "mtk", "g1", "2026-09-10", 0),
            110_000,
            "id terbesar menang ketika tanggal dan updated_at sama"
        );

        let nonaktif = vec![JpRate {
            status_aktif: 0,
            ..tarif("t1", "mtk", None, 90_000, "2026-01-01", "2026-01-01")
        }];
        assert_eq!(
            PayrollCalculator::resolve_jp_rate(&nonaktif, "mtk", "g1", "2026-09-10", 7_000),
            7_000,
            "tarif nonaktif dilewati"
        );
    }

    /// Gabungan jam — WAJIB identik dengan `summarizeTeaching` di TS.
    #[test]
    fn jam_yang_sama_pada_satu_tanggal_dihitung_sekali() {
        let rates = vec![tarif("t1", "agama", None, 50_000, "2026-01-01", "2026-01-01")];

        // Guru Agama mengajar tiga rombel pada jam 1-2 yang sama. Tiga sesi,
        // tetapi tetap dua jam pelajaran — dan dua kali honor, bukan enam.
        let sessions = vec![
            sesi("pm1", "agama", "2026-09-10", 1, 2),
            sesi("pm2", "agama", "2026-09-10", 1, 2),
            sesi("pm3", "agama", "2026-09-10", 1, 2),
        ];
        assert_eq!(
            PayrollCalculator::summarize_teaching(&sessions, &rates, "g1", 0),
            TeachingTotals {
                total_jp: 2,
                honor: 100_000,
                unrated_jp: 0
            }
        );

        // Irisan sebagian: 1-2 dan 2-3 bersama-sama memakai jam 1, 2, dan 3.
        let irisan = vec![
            sesi("pm1", "agama", "2026-09-10", 1, 2),
            sesi("pm2", "agama", "2026-09-10", 2, 3),
        ];
        assert_eq!(
            PayrollCalculator::summarize_teaching(&irisan, &rates, "g1", 0).total_jp,
            3
        );

        // Tanggal berbeda tidak pernah saling menutup.
        let dua_hari = vec![
            sesi("pm1", "agama", "2026-09-10", 1, 2),
            sesi("pm2", "agama", "2026-09-11", 1, 2),
        ];
        assert_eq!(
            PayrollCalculator::summarize_teaching(&dua_hari, &rates, "g1", 0).total_jp,
            4
        );
    }

    #[test]
    fn jp_tanpa_tarif_dihitung_terpisah_dan_tidak_menggagalkan_apa_pun() {
        let sessions = vec![sesi("pm1", "seni", "2026-09-10", 1, 3)];
        let hasil = PayrollCalculator::summarize_teaching(&sessions, &[], "g1", 0);
        assert_eq!(
            hasil,
            TeachingTotals {
                total_jp: 3,
                honor: 0,
                unrated_jp: 3
            }
        );
    }

    /// Membagi lebih dulu memang membuang titik tengahnya.
    ///
    /// Tes ini menahan bentuk lama supaya tidak diam-diam kembali: ia menuntut
    /// urutan bagi-lalu-kali benar-benar menghasilkan jawaban yang BERBEDA,
    /// sehingga siapa pun yang menyederhanakan `wage_from_minutes` kembali ke
    /// bentuk itu akan melihat tes ini gagal, bukan menemukannya berbulan
    /// kemudian di slip gaji.
    #[test]
    fn membagi_lebih_dulu_kehilangan_titik_tengahnya() {
        let menit = Decimal::from(11);
        let tarif = Decimal::from(18_750);
        let lewat_jam = (menit / Decimal::from(60) * tarif).round();
        assert_eq!(
            lewat_jam,
            Decimal::from(3_437),
            "bentuk lama membulatkan ke bawah"
        );
        assert_eq!(
            PayrollCalculator::wage_from_minutes(11, 18_750),
            Decimal::from(3_438),
            "bentuk sekarang membulatkan menjauhi nol"
        );
    }
}
