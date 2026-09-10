use std::{collections::HashMap, env, path::PathBuf};

const DESKTOP_COMMANDS: &[&str] = &[
    "desktop_get_session",
    "desktop_get_runtime_status",
    "desktop_get_bootstrap_status",
    "desktop_bootstrap_superadmin",
    "desktop_check_bootstrap_database",
    "desktop_link_bootstrap_database",
    "desktop_login",
    "desktop_logout",
    "desktop_password_reset_approve",
    "desktop_password_recovery_with_code",
    "desktop_password_reset_route",
    "desktop_list_password_reset_history",
    "desktop_get_password_reset_photo",
    "desktop_delete_password_reset_history",
    "desktop_purge_password_reset_history",
    "desktop_list_attendance_photos",
    "desktop_get_attendance_photo",
    "desktop_delete_attendance_photo",
    "desktop_purge_attendance_photos",
    "desktop_get_scan_security",
    "desktop_update_scan_security",
    "desktop_password_reset_lookup",
    "desktop_password_reset_confirm",
    "desktop_password_reset_swap_challenge",
    "desktop_password_reset_verify",
    "desktop_password_reset_inspect",
    "desktop_password_reset_complete",
    "desktop_send_test_mail",
    "desktop_get_mail_config",
    "desktop_save_mail_config",
    "desktop_get_two_factor_status",
    "desktop_issue_recovery_codes",
    "desktop_begin_two_factor_setup",
    "desktop_confirm_two_factor_setup",
    "desktop_disable_two_factor",
    "desktop_admin_disable_two_factor",
    "desktop_get_master_operators",
    "desktop_create_operator",
    "desktop_update_operator",
    "desktop_delete_operator",
    "desktop_get_roles",
    "desktop_create_role",
    "desktop_update_role",
    "desktop_set_role_permissions",
    "desktop_delete_role",
    "desktop_get_employees",
    "desktop_create_employee",
    "desktop_import_employees",
    "desktop_update_employee",
    "desktop_set_employee_status",
    "desktop_generate_employee_tokens",
    "desktop_get_shifts",
    "desktop_create_shift",
    "desktop_update_shift",
    "desktop_delete_shift",
    "desktop_submit_qr_scan",
    "desktop_get_corrections",
    "desktop_create_correction",
    "desktop_delete_correction",
    "desktop_update_attendance",
    "desktop_delete_attendance",
    "desktop_delete_log_scan",
    "desktop_delete_import_offline",
    "desktop_get_backups",
    "desktop_create_backup",
    "desktop_cancel_backup",
    "desktop_get_imports",
    "desktop_import_offline",
    "desktop_get_dashboard_data",
    "desktop_get_id_cards",
    "desktop_update_id_card",
    "desktop_get_geofence_settings",
    "desktop_update_geofence_settings",
    "desktop_get_scanner_settings",
    "desktop_update_scanner_settings",
    "desktop_get_app_display_name",
    "desktop_update_app_display_name",
    "desktop_get_sync_status",
    "desktop_sync_now",
    "desktop_get_sync_conflicts",
    "desktop_retry_failed_sync",
    "desktop_resolve_sync_conflicts",
    "desktop_resolve_sync_conflicts_local",
    "desktop_clear_failed_sync",
    "desktop_export_database",
    "desktop_import_database",
    "desktop_import_database_bytes",
    "desktop_get_data_folder",
    "desktop_save_file",
    "desktop_get_holidays",
    "desktop_get_holiday_whitelist",
    "desktop_create_holiday_whitelist",
    "desktop_update_holiday_whitelist",
    "desktop_delete_holiday_whitelist",
    "desktop_create_holiday",
    "desktop_update_holiday",
    "desktop_delete_holiday",
    "desktop_get_alfa_settings",
    "desktop_save_alfa_settings",
    "desktop_trigger_generate_alfa",
    "desktop_get_attendance_audit",
    "desktop_get_server_url",
    "desktop_set_server_url",
    "desktop_get_company_profile",
    "desktop_update_company_profile",
    "desktop_get_id_card_template",
    "desktop_save_id_card_template",
    "desktop_force_resync_settings",
    "desktop_debug_template_sync",
    "desktop_get_turso_url",
    "desktop_get_database_config",
    "desktop_save_turso_config",
    "desktop_test_turso_connection",
    "desktop_clear_turso_config",
    "desktop_get_salary_configs",
    "desktop_save_salary_config",
    "desktop_delete_salary_config",
    "desktop_get_overtime_rules",
    "desktop_save_overtime_rule",
    "desktop_delete_overtime_rule",
    "desktop_save_overtime_rules",
    "desktop_get_payroll_components",
    "desktop_save_payroll_component",
    "desktop_delete_payroll_component",
    "desktop_get_tax_rules",
    "desktop_save_tax_rule",
    "desktop_delete_tax_rule",
    "desktop_save_tax_rules",
    "desktop_get_bpjs_rules",
    "desktop_save_bpjs_rule",
    "desktop_delete_bpjs_rule",
    "desktop_save_bpjs_rules",
    "desktop_get_payroll_recap",
    "desktop_create_payroll_run",
    "desktop_list_payroll_runs",
    "desktop_get_payroll_run_detail",
    "desktop_transition_payroll_status",
    "desktop_get_academic_years",
    "desktop_save_academic_year",
    "desktop_delete_academic_year",
    "desktop_set_active_academic_year",
    "desktop_get_academic_departments",
    "desktop_save_academic_department",
    "desktop_delete_academic_department",
    "desktop_get_academic_classes",
    "desktop_save_academic_class",
    "desktop_delete_academic_class",
    "desktop_get_academic_subjects",
    "desktop_save_academic_subject",
    "desktop_delete_academic_subject",
    "desktop_get_academic_assignments",
    "desktop_save_academic_assignment",
    "desktop_delete_academic_assignment",
    "desktop_get_teachers",
    "desktop_save_teacher",
    "desktop_delete_teacher",
    "desktop_get_students",
    "desktop_save_student",
    "desktop_delete_student",
    "desktop_get_class_attendance_sessions",
    "desktop_get_class_attendance_detail",
    "desktop_get_roster_for_attendance",
    "desktop_save_class_attendance",
    "desktop_delete_class_attendance",
    "desktop_get_attendance_reconciliation",
    "desktop_get_teaching_journal",
    "desktop_list_teaching_journals",
    "desktop_save_teaching_journal",
    "desktop_delete_teaching_journal",
    "desktop_get_ledger_preview",
    "desktop_freeze_attendance_ledger",
    "desktop_get_frozen_ledger",
    "desktop_delete_frozen_ledger",
    "desktop_backfill_id_cards",
    "desktop_save_student_photo",
    "desktop_get_student_photo",
    "desktop_get_attendance_dashboard_metrics",
    "desktop_queue_wa_notification",
    "desktop_cancel_wa_notification",
    "desktop_list_wa_notifications",
    "desktop_get_wa_config",
    "desktop_save_wa_config",
    "desktop_list_counseling_cases",
    "desktop_get_counseling_case",
    "desktop_create_counseling_case",
    "desktop_update_counseling_case",
    "desktop_delete_counseling_case",
    "desktop_add_counseling_session",
    "desktop_delete_counseling_session",
];

fn local_build_values() -> HashMap<String, String> {
    let path = PathBuf::from(env::var("CARGO_MANIFEST_DIR").expect("manifest dir"))
        .join("..")
        .join(".env");
    dotenvy::from_path_iter(path)
        .map(|entries| entries.filter_map(Result::ok).collect())
        .unwrap_or_default()
}

fn expose_build_value(name: &str, local: &HashMap<String, String>) -> Option<String> {
    let value = env::var(name)
        .ok()
        .or_else(|| local.get(name).cloned())
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty());
    if let Some(value) = &value {
        println!("cargo:rustc-env={name}={value}");
    }
    println!("cargo:rerun-if-env-changed={name}");
    value
}

/// Hentikan build RELEASE bila masa login offline belum ditetapkan.
///
/// `option_env!` dievaluasi saat KOMPILASI, bukan saat jalan. Pada build debug
/// nilai kosong jatuh ke default sehingga `tauri dev` selalu bekerja dan
/// masalahnya tidak pernah terlihat. Pada build release TIDAK ada default:
/// `"".parse::<u64>()` gagal, `DesktopState::initialize(...)?` di setup hook
/// mengembalikan Err, Tauri membatalkan startup, dan jendelanya tertutup
/// seketika TANPA PESAN APA PUN.
///
/// `.env*` di-gitignore, jadi setiap mesin baru dan setiap clone mengulang
/// kegagalan itu — dan yang menanggungnya adalah pengguna akhir, bukan yang
/// membangunnya. Di Android lebih jahat lagi: APK tetap terbangun dan Gradle
/// melapor hijau.
///
/// Karena itu kegagalannya dipindahkan ke sini, ke waktu build, tempat orang
/// yang bisa memperbaikinya masih berdiri di depan layar. Angka ini kebijakan
/// keamanan — berapa lama perangkat yang hilang masih bisa dipakai masuk tanpa
/// jaringan — jadi ia memang harus ditetapkan sadar, bukan dijatuhkan ke
/// default diam-diam.
fn assert_offline_hours_present_on_release(value: Option<&str>) {
    if env::var("PROFILE").as_deref() != Ok("release") {
        return;
    }
    let pesan = match value {
        None => "SPPG_OFFLINE_AUTH_MAX_AGE_HOURS belum diisi".to_owned(),
        Some(raw) => match raw.parse::<u64>() {
            Ok(jam) if (1..=720).contains(&jam) => return,
            Ok(jam) => format!("nilainya {jam}, di luar rentang 1-720"),
            Err(_) => format!("nilainya '{raw}' bukan angka"),
        },
    };
    panic!(
        "\n\nBUILD RELEASE DIHENTIKAN: {pesan}.\n\n\
         Tanpa nilai ini aplikasi TETAP TERBANGUN tetapi MATI SAAT DIBUKA, tanpa\n\
         pesan apa pun ke pengguna. Salin `.env.example` menjadi `.env` di folder\n\
         workspace ini lalu isi SPPG_OFFLINE_AUTH_MAX_AGE_HOURS (1-720 jam).\n\n\
         Angka itu kebijakan keamanan: berapa lama perangkat yang hilang masih\n\
         bisa dipakai masuk tanpa jaringan.\n"
    );
}

fn main() {
    println!("cargo:rerun-if-changed=../.env");
    let local = local_build_values();
    expose_build_value("TURSO_DATABASE_URL", &local);
    expose_build_value("TURSO_AUTH_TOKEN", &local);
    expose_build_value("SPPG_API_BASE_URL", &local);
    expose_build_value("SPPG_DEV_API_BASE_URL", &local);
    let offline_hours = expose_build_value("SPPG_OFFLINE_AUTH_MAX_AGE_HOURS", &local);
    assert_offline_hours_present_on_release(offline_hours.as_deref());

    tauri_build::try_build(
        tauri_build::Attributes::new()
            .app_manifest(tauri_build::AppManifest::new().commands(DESKTOP_COMMANDS)),
    )
    .expect("gagal membangun manifest Tauri");
}
