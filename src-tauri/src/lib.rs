use tauri::Manager;
use chrono;
use log;

pub mod commands;
pub mod db;
pub mod email;
pub mod models;
pub mod face_recognition;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Load .env from current directory or src-tauri subdirectory (for root workspace runs)
    dotenvy::dotenv().ok();
    dotenvy::from_filename("src-tauri/.env").ok();
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
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
            

            
            // --- Initialize App Icon ---
            if let Ok(branding) = db::get_system_branding(&pool) {
                if let Some(icon_data) = branding.app_icon {
                    if !icon_data.is_empty() {
                        let base64_str = if icon_data.contains(',') {
                            icon_data.split(',').nth(1).unwrap_or(&icon_data)
                        } else {
                            &icon_data
                        };
                        if let Ok(bytes) = base64::Engine::decode(&base64::engine::general_purpose::STANDARD, base64_str) {
                            if let Ok(img_decoded) = image::load_from_memory(&bytes) {
                                let (width, height) = image::GenericImageView::dimensions(&img_decoded);
                                let rgba = img_decoded.to_rgba8().into_raw();
                                let tauri_img = tauri::image::Image::new_owned(rgba, width, height);
                                
                                // In Tauri v2, icons are set per window
                                for window in app.handle().webview_windows().values() {
                                    let _ = window.set_icon(tauri_img.clone());
                                }
                            }
                        }
                    }
                }
            }
            
            // --- Initialize Face Recognition Pipeline ---
            // Graceful: if ONNX models are not present, the app still starts.
            let resource_dir = app.path().resource_dir().unwrap_or_else(|_| std::path::PathBuf::from("."));
            let face_config = face_recognition::PipelineConfig {
                scrfd_model_path: resource_dir.join("models/det_2.5g.onnx").to_string_lossy().to_string(),
                arcface_model_path: resource_dir.join("models/w600k_r50.onnx").to_string_lossy().to_string(),
                ..face_recognition::PipelineConfig::default()
            };
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
            
            app.manage(pool.clone());
            app.manage(std::sync::Mutex::new(pipeline_opt));

            // --- Background Auto-Exit Task ---
            let bg_pool = pool.clone();
            std::thread::spawn(move || {
                loop {
                    std::thread::sleep(std::time::Duration::from_secs(60));
                    
                    let Ok(branding) = db::get_system_branding(&bg_pool) else { continue; };
                    
                    if branding.enable_auto_exit {
                        let now = chrono::Local::now();
                        let current_time = now.format("%H:%M").to_string();
                        
                        if current_time == branding.auto_exit_time {
                            log::info!("Triggering automatic logout for all users still on campus...");
                            let _ = db::auto_exit_users(&bg_pool);
                        }
                    }
                }
            });

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
            commands::update_system_configuration,
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
            commands::add_role,
            commands::update_role,
            commands::delete_role,
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
            email::send_verification_otp,
            commands::open_external_url
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
