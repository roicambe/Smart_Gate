use crate::db::{self, DbPool};
use crate::email;
use crate::models::*;
use serde::Serialize;
use std::process::Command;
use tauri::State;
use base64;
use image;

#[tauri::command]
pub fn get_persons(pool: State<'_, DbPool>) -> Result<Vec<Person>, String> {
    db::get_persons(&pool)
}

#[tauri::command]
pub fn add_person(
    pool: State<'_, DbPool>,
    id_number: String,
    first_name: String,
    middle_name: Option<String>,
    last_name: String,
    face_template_path: Option<String>,
    is_active: bool,
) -> Result<i64, String> {
    let person = Person {
        person_id: 0, // Assigned by DB
        id_number,
        first_name,
        middle_name,
        last_name,
        face_template_path,
        is_active,
        is_archived: false,
    };
    db::add_person(&pool, person)
}

#[tauri::command]
pub fn get_roles(pool: State<'_, DbPool>) -> Result<Vec<Role>, String> {
    db::get_roles(&pool)
}

#[tauri::command]
pub fn get_departments(pool: State<'_, DbPool>) -> Result<Vec<Department>, String> {
    db::get_departments(&pool)
}
#[tauri::command]
pub fn add_department(pool: State<'_, DbPool>, department: Department, active_admin_id: i64) -> Result<i64, String> {
    db::add_department(&pool, department, active_admin_id)
}
#[tauri::command]
pub fn update_department(
    pool: State<'_, DbPool>,
    department_id: i64,
    department_name: String,
    department_code: String,
    active_admin_id: i64,
) -> Result<(), String> {
    db::update_department(&pool, department_id, &department_name, &department_code, active_admin_id)
}
#[tauri::command]
pub fn delete_department(pool: State<'_, DbPool>, department_id: i64, active_admin_id: i64) -> Result<(), String> {
    db::delete_department(&pool, department_id, active_admin_id)
}

#[tauri::command]
pub fn get_programs(pool: State<'_, DbPool>) -> Result<Vec<Program>, String> {
    db::get_programs(&pool)
}
#[tauri::command]
pub fn add_program(pool: State<'_, DbPool>, program: Program, active_admin_id: i64) -> Result<i64, String> {
    db::add_program(&pool, program, active_admin_id)
}
#[tauri::command]
pub fn update_program(
    pool: State<'_, DbPool>,
    program_id: i64,
    department_id: i64,
    program_name: String,
    program_code: String,
    active_admin_id: i64,
) -> Result<(), String> {
    db::update_program(
        &pool,
        program_id,
        department_id,
        &program_name,
        &program_code,
        active_admin_id,
    )
}
#[tauri::command]
pub fn delete_program(pool: State<'_, DbPool>, program_id: i64, active_admin_id: i64) -> Result<(), String> {
    db::delete_program(&pool, program_id, active_admin_id)
}

#[tauri::command]
pub fn get_students(pool: State<'_, DbPool>) -> Result<Vec<StudentDetails>, String> {
    db::get_students(&pool)
}
#[tauri::command]
pub fn add_student(pool: State<'_, DbPool>, student: Student) -> Result<(), String> {
    db::add_student(&pool, student)
}

#[tauri::command]
pub fn promote_all_students(pool: State<'_, DbPool>, active_admin_id: i64) -> Result<(), String> {
    db::promote_all_students(&pool, active_admin_id)
}

#[tauri::command]
pub fn get_employees(pool: State<'_, DbPool>) -> Result<Vec<EmployeeDetails>, String> {
    db::get_employees(&pool)
}
#[tauri::command]
pub fn add_employee(pool: State<'_, DbPool>, employee: Employee) -> Result<(), String> {
    db::add_employee(&pool, employee)
}

#[tauri::command]
pub fn update_person_status(
    pool: State<'_, DbPool>,
    person_id: i64,
    is_active: bool,
    active_admin_id: i64,
) -> Result<(), String> {
    db::update_person_status(&pool, person_id, is_active, active_admin_id)
}

#[tauri::command]
pub fn get_scanners(pool: State<'_, DbPool>) -> Result<Vec<Scanner>, String> {
    db::get_scanners(&pool)
}
#[tauri::command]
pub fn add_scanner(pool: State<'_, DbPool>, scanner: Scanner, active_admin_id: i64) -> Result<i64, String> {
    db::add_scanner(&pool, scanner, active_admin_id)
}
#[tauri::command]
pub fn get_access_logs(
    pool: State<'_, DbPool>,
    role_filter: Option<String>,
    action_type: Option<String>,
    department_id: Option<i64>,
    search_term: Option<String>,
    start_date: Option<String>,
    end_date: Option<String>,
) -> Result<Vec<ActivityLogDetails>, String> {
    db::get_access_logs(
        &pool,
        role_filter,
        action_type,
        department_id,
        None, // program_id
        None, // year_level
        search_term,
        start_date,
        end_date,
    )
}

#[tauri::command]
pub fn get_event_attendance_logs(
    pool: State<'_, DbPool>,
    start_date: Option<String>,
    end_date: Option<String>,
    department_id: Option<i64>,
    program_id: Option<i64>,
    year_level: Option<i64>,
) -> Result<Vec<ActivityLogDetails>, String> {
    db::get_event_attendance_logs(&pool, start_date, end_date, department_id, program_id, year_level)
}

#[tauri::command]
pub fn get_events(pool: State<'_, DbPool>) -> Result<Vec<EventDetails>, String> {
    db::get_events(&pool)
}
#[tauri::command]
pub fn add_event(pool: State<'_, DbPool>, event: EventDetails, active_admin_id: i64) -> Result<i64, String> {
    db::add_event(&pool, event, active_admin_id)
}
#[tauri::command]
pub fn update_event(pool: State<'_, DbPool>, event_id: i64, event: EventDetails, active_admin_id: i64) -> Result<(), String> {
    db::update_event(&pool, event_id, event, active_admin_id)
}
#[tauri::command]
pub fn delete_event(pool: State<'_, DbPool>, event_id: i64, active_admin_id: i64) -> Result<(), String> {
    db::delete_event(&pool, event_id, active_admin_id)
}

#[tauri::command]
pub fn log_entry(
    pool: State<'_, DbPool>,
    scanner_id: i64,
    person_id: i64,
) -> Result<ScanResult, String> {
    db::log_entry(&pool, scanner_id, person_id)
}
#[tauri::command]
pub fn log_audit_action(
    pool: State<'_, DbPool>,
    admin_id: i64,
    action_type: String,
    target_table: String,
    target_id: i64,
    old_values: Option<String>,
    new_values: Option<String>,
) -> Result<(), String> {
    let old_val = old_values.and_then(|s| serde_json::from_str(&s).ok());
    let new_val = new_values.and_then(|s| serde_json::from_str(&s).ok());
    db::log_audit_action(&pool, admin_id, &action_type, &target_table, target_id, "System Action", old_val, new_val)
}

#[tauri::command]
pub fn log_frontend_action(
    pool: State<'_, DbPool>,
    admin_id: i64,
    action_type: String,
    target_table: String,
    target_id: Option<i64>,
    old_values: Option<String>,
    new_values: Option<String>,
) -> Result<(), String> {
    let old_val = old_values.and_then(|s| serde_json::from_str(&s).ok());
    let new_val = new_values.and_then(|s| serde_json::from_str(&s).ok());
    db::log_audit_action(&pool, admin_id, &action_type, &target_table, target_id.unwrap_or(0), "System Action", old_val, new_val)
}

#[tauri::command]
pub fn get_audit_logs(
    pool: State<'_, DbPool>,
    start_date: Option<String>,
    end_date: Option<String>,
) -> Result<Vec<AuditEvent>, String> {
    db::get_audit_logs(&pool, start_date, end_date)
}

#[tauri::command]
pub async fn admin_login(
    pool: State<'_, DbPool>,
    username: String,
    password: String,
) -> Result<AdminLoginResponse, String> {
    let mut response = db::admin_login(&pool, &username, &password)?;

    if response.success && response.requires_activation {
        let account_id = response
            .account
            .as_ref()
            .map(|account| account.account_id)
            .ok_or_else(|| "The account session could not be prepared.".to_string())?;

        let challenge = db::create_first_login_challenge(&pool, account_id)?;
        if let Err(err) = email::send_verification_otp_email(
            &challenge.email,
            &challenge.account.full_name,
            &challenge.otp_code,
        )
        .await
        {
            return Ok(AdminLoginResponse {
                success: false,
                message: format!(
                    "Credentials verified, but the verification code could not be sent. {}",
                    err
                ),
                requires_activation: false,
                masked_email: None,
                account: None,
            });
        }
        response.masked_email = Some(challenge.masked_email);
    }

    Ok(response)
}

#[tauri::command]
pub fn update_admin_credentials(
    pool: State<'_, DbPool>,
    account_id: i64,
    current_password: String,
    new_password: String,
) -> Result<bool, String> {
    db::update_admin_credentials(&pool, account_id, &current_password, &new_password)
}

#[tauri::command]
pub fn get_admin_accounts(pool: State<'_, DbPool>) -> Result<Vec<AdminAccount>, String> {
    db::get_admin_accounts(&pool)
}

#[tauri::command]
pub fn add_admin_account(
    pool: State<'_, DbPool>,
    username: String,
    password: String,
    full_name: String,
    email: String,
    role: String,
    active_admin_id: i64,
) -> Result<i64, String> {
    db::add_admin_account(
        &pool,
        &username,
        &password,
        &full_name,
        &email,
        &role,
        active_admin_id,
    )
}

#[tauri::command]
pub fn create_admin_account(
    pool: State<'_, DbPool>,
    username: String,
    password: String,
    full_name: String,
    email: String,
    role: String,
    active_admin_id: i64,
) -> Result<i64, String> {
    db::add_admin_account(
        &pool,
        &username,
        &password,
        &full_name,
        &email,
        &role,
        active_admin_id,
    )
}

#[tauri::command]
pub fn update_admin_role(
    pool: State<'_, DbPool>,
    account_id: i64,
    new_role: String,
    active_admin_id: i64,
) -> Result<(), String> {
    db::update_admin_role(&pool, account_id, &new_role, active_admin_id)
}

#[tauri::command]
pub fn reset_admin_password(
    pool: State<'_, DbPool>,
    account_id: i64,
    new_password: String,
    active_admin_id: i64,
) -> Result<(), String> {
    db::reset_admin_password(&pool, account_id, &new_password, active_admin_id)
}

#[tauri::command]
pub fn update_admin_info(
    pool: State<'_, DbPool>,
    account_id: i64,
    username: String,
    full_name: String,
    email: String,
    active_admin_id: i64,
) -> Result<(), String> {
    db::update_admin_info(
        &pool,
        account_id,
        &username,
        &full_name,
        &email,
        active_admin_id,
    )
}

#[tauri::command]
pub fn delete_admin_account(
    pool: State<'_, DbPool>,
    account_id: i64,
    active_admin_id: i64,
) -> Result<(), String> {
    db::delete_admin_account(&pool, account_id, active_admin_id)
}

#[tauri::command]
pub fn activate_admin_first_login(
    pool: State<'_, DbPool>,
    account_id: i64,
    otp_code: String,
    new_password: String,
    confirm_password: String,
) -> Result<AdminActivationResponse, String> {
    db::activate_admin_first_login(
        &pool,
        account_id,
        &otp_code,
        &new_password,
        &confirm_password,
    )
}

#[tauri::command]
pub async fn forgot_password_request(
    pool: State<'_, DbPool>,
    email: String,
    username: String,
) -> Result<serde_json::Value, String> {
    let (account_id, _username, full_name, masked_email, otp_code) =
        db::forgot_password_request(&pool, &email, &username)?;

    // Send the OTP email
    email::send_password_reset_otp_email(&email, &full_name, &otp_code)
        .await
        .map_err(|e| format!("Failed to send email: {}", e))?;

    Ok(serde_json::json!({
        "success": true,
        "account_id": account_id,
        "masked_email": masked_email,
        "message": "Verification code sent successfully"
    }))
}

#[tauri::command]
pub fn verify_forgot_password_otp(
    pool: State<'_, DbPool>,
    account_id: i64,
    otp_code: String,
) -> Result<serde_json::Value, String> {
    let is_valid = db::verify_forgot_password_otp(&pool, account_id, &otp_code)?;

    Ok(serde_json::json!({
        "success": is_valid,
        "message": if is_valid { "OTP verified" } else { "Invalid verification code" }
    }))
}

#[tauri::command]
pub fn reset_password_with_otp(
    pool: State<'_, DbPool>,
    account_id: i64,
    otp_code: String,
    new_password: String,
) -> Result<serde_json::Value, String> {
    let success = db::reset_password_with_otp(&pool, account_id, &otp_code, &new_password)?;

    Ok(serde_json::json!({
        "success": success,
        "message": if success { "Password reset successful" } else { "Failed to reset password" }
    }))
}

#[tauri::command]
pub fn get_dashboard_stats(pool: State<'_, DbPool>) -> Result<DashboardData, String> {
    db::get_dashboard_stats(&pool)
}

#[tauri::command]
pub fn get_visitors(pool: State<'_, DbPool>, sort_order: Option<String>) -> Result<Vec<VisitorDetails>, String> {
    db::get_visitors(&pool, sort_order)
}

#[tauri::command]
pub fn bulk_import_users_from_excel(
    pool: State<'_, DbPool>,
    file_path: String,
    role: String,
    active_admin_id: i64,
) -> Result<BulkImportResult, String> {
    db::bulk_import_users_from_excel(&pool, &file_path, &role, active_admin_id)
}

#[tauri::command]
pub fn register_user(
    pool: State<'_, DbPool>,
    role: String,
    id_number: String,
    first_name: String,
    middle_name: Option<String>,
    last_name: String,
    email: Option<String>,
    contact_number: Option<String>,
    program_id: Option<i64>,
    year_level: Option<i64>,
    is_irregular: Option<bool>,
    department_id: Option<i64>,
    position_title: Option<String>,
    purpose: Option<String>,
    person_to_visit: Option<String>,
    is_active: bool,
    active_admin_id: Option<i64>,
) -> Result<i64, String> {
    db::register_user(
        &pool,
        vec![role],
        &id_number,
        &first_name,
        middle_name,
        &last_name,
        email.into_iter().collect(),
        contact_number.into_iter().collect(),
        program_id,
        year_level,
        is_irregular,
        department_id,
        position_title,
        purpose,
        person_to_visit,
        is_active,
        active_admin_id,
    )
}

#[tauri::command]
pub fn manual_id_entry(
    pool: State<'_, DbPool>,
    id_number: String,
    scanner_function: String,
) -> Result<ScanResult, String> {
    db::manual_id_entry(&pool, &id_number, &scanner_function)
}

#[tauri::command]
pub fn get_id_number_from_person_id(
    pool: State<'_, DbPool>,
    person_id: i64,
) -> Result<String, String> {
    db::get_id_number_from_person_id(&pool, person_id)
}

#[tauri::command]
pub fn get_scan_person_details(
    pool: State<'_, DbPool>,
    id_number: String,
) -> Result<Option<ScanPersonDetails>, String> {
    db::get_scan_person_details(&pool, &id_number)
}

#[tauri::command]
pub fn update_user(
    pool: State<'_, DbPool>,
    person_id: i64,
    role: String,
    id_number: String,
    first_name: String,
    middle_name: Option<String>,
    last_name: String,
    email: Option<String>,
    contact_number: Option<String>,
    program_id: Option<i64>,
    year_level: Option<i64>,
    is_irregular: Option<bool>,
    department_id: Option<i64>,
    position_title: Option<String>,
    purpose: Option<String>,
    person_to_visit: Option<String>,
    is_active: bool,
    active_admin_id: i64,
) -> Result<(), String> {
    db::update_user(
        &pool,
        person_id,
        vec![role],
        &id_number,
        &first_name,
        middle_name,
        &last_name,
        email.into_iter().collect(),
        contact_number.into_iter().collect(),
        program_id,
        year_level,
        is_irregular,
        department_id,
        position_title,
        purpose,
        person_to_visit,
        is_active,
        active_admin_id,
    )
}

#[tauri::command]
pub fn delete_user(
    pool: State<'_, DbPool>, 
    person_id: i64, 
    role: String, 
    active_admin_id: i64,
    pipeline_state: State<'_, std::sync::Mutex<Option<crate::face_recognition::pipeline::RecognitionPipeline>>>,
) -> Result<(), String> {
    db::delete_user(&pool, person_id, &role, active_admin_id)?;
    
    // Refresh the face index since an active user was removed
    let mut guard = pipeline_state.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(pipeline) = guard.as_mut() {
        let embeddings = db::load_all_face_embeddings(&pool).unwrap_or_default();
        pipeline.refresh_index(embeddings);
    }
    
    Ok(())
}

#[tauri::command]
pub fn log_event_attendance(
    pool: State<'_, DbPool>,
    event_id: i64,
    id_number: String,
    scanner_id: i64,
) -> Result<ScanResult, String> {
    db::log_event_attendance(&pool, event_id, &id_number, scanner_id)
}

#[tauri::command]
pub fn get_system_branding(pool: State<'_, DbPool>) -> Result<SystemBranding, String> {
    db::get_system_branding(&pool)
}

#[tauri::command]
pub fn update_system_branding(
    pool: State<'_, DbPool>,
    admin_id: i64,
    name: String,
    logo_base64: String,
    system_title: String,
    report_address: String,
    report_phone: String,
    report_email: String,
    primary_logo: Option<String>,
    secondary_logo_1: Option<String>,
    secondary_logo_2: Option<String>,
    primary_circle: Option<bool>,
    secondary1_circle: Option<bool>,
    secondary2_circle: Option<bool>,
    primary_logo_enabled: Option<bool>,
    secondary_logo_1_enabled: Option<bool>,
    secondary_logo_2_enabled: Option<bool>,
) -> Result<(), String> {
    db::update_system_branding(
        &pool,
        admin_id,
        &name,
        &logo_base64,
        &system_title,
        &report_address,
        &report_phone,
        &report_email,
        primary_logo,
        secondary_logo_1,
        secondary_logo_2,
        primary_circle.unwrap_or(false),
        secondary1_circle.unwrap_or(false),
        secondary2_circle.unwrap_or(false),
        primary_logo_enabled.unwrap_or(true),
        secondary_logo_1_enabled.unwrap_or(true),
        secondary_logo_2_enabled.unwrap_or(true),
    )
}

#[tauri::command]
pub fn update_system_configuration(
    pool: State<'_, DbPool>,
    admin_id: i64,
    strict_email_domain: bool,
    enable_face_recognition: bool,
) -> Result<(), String> {
    db::update_system_configuration(
        &pool,
        admin_id,
        strict_email_domain,
        enable_face_recognition,
    )
}

#[derive(Serialize)]
pub struct PrinterInfo {
    pub name: String,
    pub is_default: bool,
}

#[cfg(target_os = "windows")]
fn run_powershell_inline(script: &str) -> Result<String, String> {
    let output = Command::new("powershell.exe")
        .args(["-NoProfile", "-NonInteractive", "-Command", script])
        .output()
        .map_err(|err| format!("Failed to run PowerShell command: {err}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if stderr.is_empty() {
            "PowerShell command failed.".to_string()
        } else {
            stderr
        });
    }

    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

#[cfg(target_os = "windows")]
fn run_powershell_script_file(script: &str, params: &[(&str, String)]) -> Result<String, String> {
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|err| format!("Clock error: {err}"))?
        .as_millis();

    let script_path = std::env::temp_dir().join(format!("smart_gate_print_{timestamp}.ps1"));
    fs::write(&script_path, script).map_err(|err| format!("Failed to write temp script: {err}"))?;

    let mut cmd = Command::new("powershell.exe");
    cmd.args([
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
    ]);
    cmd.arg(&script_path);

    for (key, value) in params {
        cmd.arg(format!("-{key}"));
        cmd.arg(value);
    }

    let output = cmd
        .output()
        .map_err(|err| format!("Failed to execute print script: {err}"));

    let _ = fs::remove_file(&script_path);

    let output = output?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if stderr.is_empty() {
            "Silent print script failed.".to_string()
        } else {
            stderr
        });
    }

    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

#[tauri::command]
pub fn get_available_printers() -> Result<Vec<PrinterInfo>, String> {
    #[cfg(not(target_os = "windows"))]
    {
        return Err("Printer selection is currently available on Windows only.".to_string());
    }

    #[cfg(target_os = "windows")]
    {
        let raw = run_powershell_inline(
            "$ErrorActionPreference='Stop'; Get-Printer | Select-Object Name,Default | ConvertTo-Json -Compress",
        )?;

        if raw.is_empty() {
            return Ok(Vec::new());
        }

        let json: serde_json::Value = serde_json::from_str(&raw)
            .map_err(|err| format!("Failed to parse printer list: {err}"))?;

        let mut printers = Vec::new();
        match json {
            serde_json::Value::Array(items) => {
                for item in items {
                    if let Some(name) = item.get("Name").and_then(|value| value.as_str()) {
                        let is_default = item
                            .get("Default")
                            .and_then(|value| value.as_bool())
                            .unwrap_or(false);
                        printers.push(PrinterInfo {
                            name: name.to_string(),
                            is_default,
                        });
                    }
                }
            }
            serde_json::Value::Object(item) => {
                if let Some(name) = item.get("Name").and_then(|value| value.as_str()) {
                    let is_default = item
                        .get("Default")
                        .and_then(|value| value.as_bool())
                        .unwrap_or(false);
                    printers.push(PrinterInfo {
                        name: name.to_string(),
                        is_default,
                    });
                }
            }
            _ => {}
        }

        Ok(printers)
    }
}

#[tauri::command]
pub fn print_receipt_image_silent(
    printer_name: String,
    receipt_image_data_url: String,
) -> Result<String, String> {
    #[cfg(not(target_os = "windows"))]
    {
        return Err("Silent printing is currently available on Windows only.".to_string());
    }

    #[cfg(target_os = "windows")]
    {
        use std::fs;
        use std::time::{SystemTime, UNIX_EPOCH};

        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|err| format!("Clock error: {err}"))?
            .as_millis();
        let data_path = std::env::temp_dir().join(format!("smart_gate_receipt_{timestamp}.txt"));
        fs::write(&data_path, &receipt_image_data_url)
            .map_err(|err| format!("Failed to write receipt image data: {err}"))?;

        let script = r#"
param(
    [string]$PrinterName,
    [string]$ReceiptImageDataUrlFile
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms

if ([string]::IsNullOrWhiteSpace($PrinterName)) {
    $PrinterName = (Get-Printer | Where-Object { $_.Default } | Select-Object -First 1 -ExpandProperty Name)
}

if ([string]::IsNullOrWhiteSpace($PrinterName)) {
    throw 'No printer selected and no default printer found.'
}

if ([string]::IsNullOrWhiteSpace($ReceiptImageDataUrlFile) -or -not (Test-Path $ReceiptImageDataUrlFile)) {
    throw 'Receipt image data file is missing.'
}

$ReceiptImageDataUrl = Get-Content -Raw -Path $ReceiptImageDataUrlFile

if ([string]::IsNullOrWhiteSpace($ReceiptImageDataUrl) -or -not $ReceiptImageDataUrl.Contains(',')) {
    throw 'Receipt image data is missing or invalid.'
}

$base64 = $ReceiptImageDataUrl.Split(',')[1]
$bytes = [Convert]::FromBase64String($base64)
$memoryStream = New-Object System.IO.MemoryStream(, $bytes)
$tempImage = [System.Drawing.Image]::FromStream($memoryStream)
$receiptBitmap = New-Object System.Drawing.Bitmap($tempImage)
$tempImage.Dispose()
$memoryStream.Dispose()

$doc = New-Object System.Drawing.Printing.PrintDocument
$doc.PrinterSettings.PrinterName = $PrinterName

if (-not $doc.PrinterSettings.IsValid) {
    throw "Selected printer is not available: $PrinterName"
}

$doc.PrintController = New-Object System.Drawing.Printing.StandardPrintController
$doc.DefaultPageSettings.Margins = New-Object System.Drawing.Printing.Margins(0, 0, 0, 0)

$paperWidth = 228
$renderScale = 0.84
$targetWidth = [int][Math]::Round($paperWidth * $renderScale)
$targetHeight = [int][Math]::Ceiling(($targetWidth * $receiptBitmap.Height) / $receiptBitmap.Width)
$paperHeight = [int][Math]::Max($targetHeight + 28, 140)
$doc.DefaultPageSettings.PaperSize = New-Object System.Drawing.Printing.PaperSize('SmartGate58mm', $paperWidth, $paperHeight)

$doc.add_PrintPage({
    param($sender, $e)
    $graphics = $e.Graphics
    $graphics.Clear([System.Drawing.Color]::White)
    $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality

    $pageWidth = [int]$doc.DefaultPageSettings.PaperSize.Width
    $printWidth = [int][Math]::Round($pageWidth * $renderScale)
    $printHeight = [int][Math]::Ceiling(($printWidth * $receiptBitmap.Height) / $receiptBitmap.Width)

    $x = [int][Math]::Round(($pageWidth - $printWidth) / 2)
    $hardMarginX = [int][Math]::Round($doc.DefaultPageSettings.HardMarginX)
    $hardMarginY = [int][Math]::Round($doc.DefaultPageSettings.HardMarginY)
    $horizontalNudge = -20
    $topNudge = -8

    # Compensate hardware hard margins so image is visually centered on thermal paper.
    $drawX = $x - $hardMarginX + $horizontalNudge
    $drawY = 0 - $hardMarginY + $topNudge

    $graphics.DrawImage($receiptBitmap, $drawX, $drawY, $printWidth, $printHeight)
    $e.HasMorePages = $false
})

$doc.Print()

$receiptBitmap.Dispose()
$doc.Dispose()

Write-Output "Printed successfully to $PrinterName"
"#;

        let result = run_powershell_script_file(
            script,
            &[
                ("PrinterName", printer_name),
                (
                    "ReceiptImageDataUrlFile",
                    data_path.to_string_lossy().to_string(),
                ),
            ],
        );

        let _ = fs::remove_file(&data_path);
        result
    }
}

// ------ Archive Center Commands ------

#[tauri::command]
pub fn get_archived_users(pool: State<'_, DbPool>) -> Result<Vec<serde_json::Value>, String> {
    db::get_archived_users(&pool)
}

#[tauri::command]
pub fn get_archived_events(pool: State<'_, DbPool>) -> Result<Vec<serde_json::Value>, String> {
    db::get_archived_events(&pool)
}

#[tauri::command]
pub fn get_archived_academic(pool: State<'_, DbPool>) -> Result<serde_json::Value, String> {
    db::get_archived_academic(&pool)
}

#[tauri::command]
pub fn restore_user(
    pool: State<'_, DbPool>, 
    person_id: i64, 
    active_admin_id: i64,
    pipeline_state: State<'_, std::sync::Mutex<Option<crate::face_recognition::pipeline::RecognitionPipeline>>>,
) -> Result<(), String> {
    db::restore_user(&pool, person_id, active_admin_id)?;
    
    // Refresh the face index after restoration
    let mut guard = pipeline_state.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(pipeline) = guard.as_mut() {
        let embeddings = db::load_all_face_embeddings(&pool).unwrap_or_default();
        pipeline.refresh_index(embeddings);
    }
    
    Ok(())
}

#[tauri::command]
pub fn restore_event(pool: State<'_, DbPool>, event_id: i64, active_admin_id: i64) -> Result<(), String> {
    db::restore_event(&pool, event_id, active_admin_id)
}

#[tauri::command]
pub fn restore_department(pool: State<'_, DbPool>, department_id: i64, active_admin_id: i64) -> Result<(), String> {
    db::restore_department(&pool, department_id, active_admin_id)
}

#[tauri::command]
pub fn restore_program(pool: State<'_, DbPool>, program_id: i64, active_admin_id: i64) -> Result<(), String> {
    db::restore_program(&pool, program_id, active_admin_id)
}

#[tauri::command]
pub fn permanent_delete_user(
    pool: State<'_, DbPool>, 
    person_id: i64, 
    active_admin_id: i64,
    pipeline_state: State<'_, std::sync::Mutex<Option<crate::face_recognition::pipeline::RecognitionPipeline>>>,
) -> Result<(), String> {
    db::permanent_delete_user(&pool, person_id, active_admin_id)?;

    // Refresh the face index after permanent deletion
    let mut guard = pipeline_state.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(pipeline) = guard.as_mut() {
        let embeddings = db::load_all_face_embeddings(&pool).unwrap_or_default();
        pipeline.refresh_index(embeddings);
    }

    Ok(())
}

#[tauri::command]
pub fn permanent_delete_event(pool: State<'_, DbPool>, event_id: i64, active_admin_id: i64) -> Result<(), String> {
    db::permanent_delete_event(&pool, event_id, active_admin_id)
}

#[tauri::command]
pub fn permanent_delete_department(pool: State<'_, DbPool>, department_id: i64, active_admin_id: i64) -> Result<(), String> {
    db::permanent_delete_department(&pool, department_id, active_admin_id)
}

#[tauri::command]
pub fn permanent_delete_program(pool: State<'_, DbPool>, program_id: i64, active_admin_id: i64) -> Result<(), String> {
    db::permanent_delete_program(&pool, program_id, active_admin_id)
}

// ------ Backup & Recovery Commands ------

#[tauri::command]
pub fn backup_database(app_handle: tauri::AppHandle, destination_path: String) -> Result<String, String> {
    db::backup_database(&app_handle, &destination_path)
}

#[tauri::command]
pub fn restore_database(app_handle: tauri::AppHandle, source_path: String) -> Result<String, String> {
    db::restore_database(&app_handle, &source_path)
}

#[tauri::command]
pub fn get_database_stats(app_handle: tauri::AppHandle, pool: State<'_, DbPool>) -> Result<serde_json::Value, String> {
    db::get_database_stats(&app_handle, &pool)
}

// --- Face Recognition Commands ---

#[tauri::command]
pub async fn identify_person_face(
    image_base64: String,
    pipeline_state: tauri::State<'_, std::sync::Mutex<Option<crate::face_recognition::pipeline::RecognitionPipeline>>>,
) -> Result<Vec<crate::face_recognition::RecognitionResult>, String> {
    // 1. Decode base64 image
    let img_bytes = base64::Engine::decode(&base64::engine::general_purpose::STANDARD, image_base64)
        .map_err(|e| format!("Base64 decode error: {}", e))?;
    
    let img = image::load_from_memory(&img_bytes)
        .map_err(|e| format!("Image load error: {}", e))?
        .to_rgb8();
    
    let (width, height) = img.dimensions();
    
    // 2. Run recognition
    let guard = pipeline_state.lock().unwrap();
    let pipeline = guard.as_ref()
        .ok_or_else(|| "Face Recognition is not available. ONNX models are not installed.".to_string())?;
    pipeline.recognize_frame(&img, width, height)
}

#[tauri::command]
pub async fn enroll_person_face(
    person_id: i64,
    images_base64: Vec<String>,
    pool: tauri::State<'_, crate::db::DbPool>,
    pipeline_state: tauri::State<'_, std::sync::Mutex<Option<crate::face_recognition::pipeline::RecognitionPipeline>>>,
) -> Result<bool, String> {
    let total_images = images_base64.len();
    use rayon::prelude::*;

    // 1. Process each image in the batch in parallel
    let embeddings: Vec<crate::face_recognition::FaceEmbedding> = {
        // Lock the pipeline briefly to get a reference for the parallel processing
        let guard = pipeline_state.lock().unwrap_or_else(|e| e.into_inner());
        let pipeline = guard.as_ref()
            .ok_or_else(|| "Face Recognition is not available. ONNX models are not installed.".to_string())?;

        images_base64
            .par_iter()
            .enumerate()
            .filter_map(|(idx, b64)| {
                let img_bytes = base64::Engine::decode(&base64::engine::general_purpose::STANDARD, b64).ok()?;
                let img = image::load_from_memory(&img_bytes).ok()?.to_rgb8();
                let (width, height) = img.dimensions();
                
                // This call is thread-safe because pipeline is Sync and extract_embeddings is &self
                let mut face_embeddings = pipeline.extract_embeddings(img.as_raw(), width, height).ok()?;
                let best_face = face_embeddings.pop()?;
                
                log::info!("Parallel enrollment image {}/{}: face detected", idx + 1, total_images);
                Some(best_face)
            })
            .collect()
    }; // The lock (guard) is dropped here automatically

    // Be lenient: accept enrollment if we got at least 1 face from the batch
    if embeddings.is_empty() {
        return Err(format!(
            "No faces could be detected in any of the {} enrollment images. Please ensure your face is clearly visible and well-lit.",
            total_images
        ));
    }

    log::info!("Computing centroid from {}/{} successful detections", embeddings.len(), total_images);

    // 2. Compute the "Golden Embedding" (Centroid)
    let golden_embedding = crate::face_recognition::pipeline::RecognitionPipeline::compute_centroid(&embeddings);

    // 3. Save to Database
    crate::db::save_face_embedding(&pool, person_id, &golden_embedding)
        .map_err(|e| format!("Failed to save embedding to DB: {}", e))?;

    // 4. Update the live HNSW Index
    {
        let mut guard = pipeline_state.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(ref mut pipeline) = *guard {
            pipeline.enroll(person_id, golden_embedding);
        }
    }
    
    log::info!("Successfully enrolled person_id={} with centroid of {} faces", person_id, embeddings.len());
    
    Ok(true)
}

#[tauri::command]
pub fn get_face_registration_status(
    pool: State<'_, DbPool>,
) -> Result<Vec<serde_json::Value>, String> {
    db::get_persons_face_status(&pool)
}

#[tauri::command]
pub fn reset_face_data(
    person_id: i64,
    pool: State<'_, DbPool>,
    pipeline_state: State<'_, std::sync::Mutex<Option<crate::face_recognition::pipeline::RecognitionPipeline>>>,
) -> Result<bool, String> {
    db::delete_face_embedding(&pool, person_id)?;
    
    // Refresh the in-memory index
    let mut guard = pipeline_state.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(pipeline) = guard.as_mut() {
        let embeddings = db::load_all_face_embeddings(&pool).unwrap_or_default();
        pipeline.refresh_index(embeddings);
    }

    log::info!("Admin reset face data for person_id={}", person_id);
    Ok(true)
}
