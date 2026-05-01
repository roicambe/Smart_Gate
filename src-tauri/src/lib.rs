use tauri::Manager;

pub mod commands;
pub mod db;
pub mod email;
pub mod models;
pub mod face_recognition;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    dotenvy::dotenv().ok();
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
            
            // --- Initialize Face Recognition Pipeline ---
            // Graceful: if ONNX models are not present, the app still starts.
            // Face recognition commands will return errors until models are placed.
            let face_config = face_recognition::PipelineConfig::default();
            let pipeline_opt = match face_recognition::pipeline::RecognitionPipeline::new(face_config) {
                Ok(mut pipeline) => {
                    // Load existing embeddings from DB into the HNSW index
                    let embeddings = db::load_all_face_embeddings(&pool).unwrap_or_default();
                    let count = embeddings.len();
                    pipeline.enroll_batch(embeddings);
                    log::info!("Face Recognition Pipeline ready. Loaded {} embeddings.", count);
                    Some(pipeline)
                }
                Err(e) => {
                    log::warn!("Face Recognition Pipeline not available: {}. Place ONNX models in the models/ folder to enable.", e);
                    None
                }
            };
            
            app.manage(pool);
            app.manage(std::sync::Mutex::new(pipeline_opt));
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
            commands::log_frontend_action,
            commands::admin_login,
            commands::update_admin_credentials,
            commands::get_dashboard_stats,
            commands::get_visitors,
            commands::bulk_import_users_from_excel,
            commands::register_user,
            commands::manual_id_entry,
            commands::get_scan_person_details,
            commands::update_user,
            commands::delete_user,
            commands::get_audit_logs,
            commands::log_event_attendance,
            commands::get_event_attendance_logs,
            commands::get_admin_accounts,
            commands::add_admin_account,
            commands::create_admin_account,
            commands::update_admin_role,
            commands::reset_admin_password,
            commands::update_admin_info,
            commands::delete_admin_account,
            commands::activate_admin_first_login,
            commands::forgot_password_request,
            commands::verify_forgot_password_otp,
            commands::reset_password_with_otp,
            commands::get_system_branding,
            commands::update_system_branding,
            commands::get_available_printers,
            commands::print_receipt_image_silent,
            commands::promote_all_students,
            commands::get_archived_users,
            commands::get_archived_events,
            commands::get_archived_academic,
            commands::restore_user,
            commands::restore_event,
            commands::restore_department,
            commands::restore_program,
            commands::permanent_delete_user,
            commands::get_roles,
            commands::permanent_delete_event,
            commands::permanent_delete_department,
            commands::permanent_delete_program,
            commands::backup_database,
            commands::restore_database,
            commands::get_database_stats,
            commands::identify_person_face,
            commands::enroll_person_face,
            commands::get_face_registration_status,
            commands::reset_face_data,
            commands::get_id_number_from_person_id,
            email::send_visitor_qr,
            email::send_verification_otp
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
