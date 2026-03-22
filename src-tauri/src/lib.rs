use tauri::Manager;

pub mod models;
pub mod db;
pub mod commands;
pub mod email;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_fs::init())
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      let pool = db::init_db(app.handle()).expect("Failed to initialize database");
      app.manage(pool);
      Ok(())
    })
    .invoke_handler(tauri::generate_handler![
        commands::get_persons,
        commands::add_person,
        commands::get_departments,
        commands::add_department,
        commands::update_department,
        commands::delete_department,
        commands::get_programs,
        commands::add_program,
        commands::update_program,
        commands::delete_program,
        commands::get_students,
        commands::add_student,
        commands::get_employees,
        commands::add_employee,
        commands::update_person_status,
        commands::get_scanners,
        commands::add_scanner,
        commands::get_access_logs,
        commands::get_events,
        commands::add_event,
        commands::update_event,
        commands::delete_event,
        commands::log_entry,
        commands::log_audit_action,
        commands::admin_login,
        commands::update_admin_credentials,
        commands::get_dashboard_stats,
        commands::get_visitors,
        commands::register_user,
        commands::manual_id_entry,
        commands::update_user,
        commands::delete_user,
        commands::get_audit_logs,
        commands::log_event_attendance,
        commands::get_event_attendance_logs,
        commands::get_admin_accounts,
        commands::add_admin_account,
        commands::update_admin_role,
        commands::reset_admin_password,
        commands::update_admin_info,
        email::send_visitor_qr
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
