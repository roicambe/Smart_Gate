use tauri::State;
use crate::db::{self, DbPool};
use crate::models::*;

#[tauri::command]
pub fn get_persons(pool: State<'_, DbPool>) -> Result<Vec<Person>, String> {
    db::get_persons(&pool)
}

#[tauri::command]
pub fn add_person(
    pool: State<'_, DbPool>,
    id_number: String,
    role: String,
    first_name: String,
    middle_name: Option<String>,
    last_name: String,
    email: Option<String>,
    contact_number: Option<String>,
    face_template_path: Option<String>,
    is_active: bool,
) -> Result<i64, String> {
    let person = Person {
        person_id: 0, // Assigned by DB
        id_number,
        role,
        first_name,
        middle_name,
        last_name,
        email,
        contact_number,
        face_template_path,
        is_active,
    };
    db::add_person(&pool, person)
}

#[tauri::command] pub fn get_departments(pool: State<'_, DbPool>) -> Result<Vec<Department>, String> { db::get_departments(&pool) }
#[tauri::command] pub fn add_department(pool: State<'_, DbPool>, department: Department) -> Result<i64, String> { db::add_department(&pool, department) }
#[tauri::command] pub fn update_department(pool: State<'_, DbPool>, department_id: i64, department_name: String, department_code: String) -> Result<(), String> { db::update_department(&pool, department_id, &department_name, &department_code) }
#[tauri::command] pub fn delete_department(pool: State<'_, DbPool>, department_id: i64) -> Result<(), String> { db::delete_department(&pool, department_id) }

#[tauri::command] pub fn get_programs(pool: State<'_, DbPool>) -> Result<Vec<Program>, String> { db::get_programs(&pool) }
#[tauri::command] pub fn add_program(pool: State<'_, DbPool>, program: Program) -> Result<i64, String> { db::add_program(&pool, program) }
#[tauri::command] pub fn update_program(pool: State<'_, DbPool>, program_id: i64, department_id: i64, program_name: String, program_code: String) -> Result<(), String> { db::update_program(&pool, program_id, department_id, &program_name, &program_code) }
#[tauri::command] pub fn delete_program(pool: State<'_, DbPool>, program_id: i64) -> Result<(), String> { db::delete_program(&pool, program_id) }

#[tauri::command] pub fn get_students(pool: State<'_, DbPool>) -> Result<Vec<StudentDetails>, String> { db::get_students(&pool) }
#[tauri::command] pub fn add_student(pool: State<'_, DbPool>, student: Student) -> Result<(), String> { db::add_student(&pool, student) }

#[tauri::command] pub fn get_employees(pool: State<'_, DbPool>) -> Result<Vec<EmployeeDetails>, String> { db::get_employees(&pool) }
#[tauri::command] pub fn add_employee(pool: State<'_, DbPool>, employee: Employee) -> Result<(), String> { db::add_employee(&pool, employee) }

#[tauri::command] pub fn update_person_status(pool: State<'_, DbPool>, person_id: i64, is_active: bool) -> Result<(), String> { db::update_person_status(&pool, person_id, is_active) }

#[tauri::command] pub fn get_scanners(pool: State<'_, DbPool>) -> Result<Vec<Scanner>, String> { db::get_scanners(&pool) }
#[tauri::command] pub fn add_scanner(pool: State<'_, DbPool>, scanner: Scanner) -> Result<i64, String> { db::add_scanner(&pool, scanner) }
#[tauri::command] pub fn get_access_logs(
    pool: State<'_, DbPool>,
    start_date: Option<String>,
    end_date: Option<String>,
) -> Result<Vec<AccessLogDetails>, String> {
    db::get_access_logs(&pool, start_date, end_date)
}

#[tauri::command]
pub fn get_event_attendance_logs(
    pool: State<'_, DbPool>,
    start_date: Option<String>,
    end_date: Option<String>,
) -> Result<Vec<EventAttendanceLog>, String> {
    db::get_event_attendance_logs(&pool, start_date, end_date)
}

#[tauri::command] pub fn get_events(pool: State<'_, DbPool>) -> Result<Vec<Event>, String> { db::get_events(&pool) }
#[tauri::command] pub fn add_event(pool: State<'_, DbPool>, event: Event) -> Result<i64, String> { db::add_event(&pool, event) }
#[tauri::command] pub fn update_event(pool: State<'_, DbPool>, event_id: i64, event: Event) -> Result<(), String> { db::update_event(&pool, event_id, event) }
#[tauri::command] pub fn delete_event(pool: State<'_, DbPool>, event_id: i64) -> Result<(), String> { db::delete_event(&pool, event_id) }

#[tauri::command] pub fn log_entry(pool: State<'_, DbPool>, scanner_id: i64, person_id: i64) -> Result<ScanResult, String> { db::log_entry(&pool, scanner_id, person_id) }
#[tauri::command] pub fn log_audit_action(pool: State<'_, DbPool>, admin_id: i64, action_type: String, target_table: String, target_id: i64) -> Result<(), String> { db::log_audit_action(&pool, admin_id, &action_type, &target_table, target_id) }

#[tauri::command]
pub fn get_audit_logs(pool: State<'_, DbPool>, start_date: Option<String>, end_date: Option<String>) -> Result<Vec<AuditLogDetails>, String> {
    db::get_audit_logs(&pool, start_date, end_date)
}#[tauri::command]
pub fn admin_login(pool: State<'_, DbPool>, username: String, password: String) -> Result<AdminLoginResponse, String> {
    db::admin_login(&pool, &username, &password)
}

#[tauri::command]
pub fn update_admin_credentials(pool: State<'_, DbPool>, account_id: i64, current_password: String, new_password: String) -> Result<bool, String> {
    db::update_admin_credentials(&pool, account_id, &current_password, &new_password)
}

#[tauri::command]
pub fn get_admin_accounts(pool: State<'_, DbPool>) -> Result<Vec<AdminAccount>, String> {
    db::get_admin_accounts(&pool)
}

#[tauri::command]
pub fn add_admin_account(pool: State<'_, DbPool>, username: String, password: String, full_name: String, role: String, active_admin_id: i64) -> Result<i64, String> {
    db::add_admin_account(&pool, &username, &password, &full_name, &role, active_admin_id)
}

#[tauri::command]
pub fn update_admin_role(pool: State<'_, DbPool>, account_id: i64, new_role: String, active_admin_id: i64) -> Result<(), String> {
    db::update_admin_role(&pool, account_id, &new_role, active_admin_id)
}

#[tauri::command]
pub fn reset_admin_password(pool: State<'_, DbPool>, account_id: i64, new_password: String, active_admin_id: i64) -> Result<(), String> {
    db::reset_admin_password(&pool, account_id, &new_password, active_admin_id)
}

#[tauri::command]
pub fn update_admin_info(pool: State<'_, DbPool>, account_id: i64, username: String, full_name: String, active_admin_id: i64) -> Result<(), String> {
    db::update_admin_info(&pool, account_id, &username, &full_name, active_admin_id)
}

#[tauri::command]
pub fn get_dashboard_stats(pool: State<'_, DbPool>) -> Result<DashboardData, String> {
    db::get_dashboard_stats(&pool)
}

#[tauri::command]
pub fn get_visitors(pool: State<'_, DbPool>) -> Result<Vec<VisitorDetails>, String> {
    db::get_visitors(&pool)
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
    department_id: Option<i64>,
    position_title: Option<String>,
    purpose: Option<String>,
    person_to_visit: Option<String>,
) -> Result<i64, String> {
    db::register_user(
        &pool,
        &role,
        &id_number,
        &first_name,
        middle_name,
        &last_name,
        email,
        contact_number,
        program_id,
        year_level,
        department_id,
        position_title,
        purpose,
        person_to_visit,
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
    department_id: Option<i64>,
    position_title: Option<String>,
    purpose: Option<String>,
    person_to_visit: Option<String>,
) -> Result<(), String> {
    db::update_user(
        &pool,
        person_id,
        &role,
        &id_number,
        &first_name,
        middle_name,
        &last_name,
        email,
        contact_number,
        program_id,
        year_level,
        department_id,
        position_title,
        purpose,
        person_to_visit,
    )
}

#[tauri::command]
pub fn delete_user(pool: State<'_, DbPool>, person_id: i64, role: String) -> Result<(), String> {
    db::delete_user(&pool, person_id, &role)
}

#[tauri::command]
pub fn log_event_attendance(pool: State<'_, DbPool>, event_id: i64, id_number: String) -> Result<ScanResult, String> {
    db::log_event_attendance(&pool, event_id, &id_number)
}

#[tauri::command]
pub fn get_system_branding(pool: State<'_, DbPool>) -> Result<SystemBranding, String> {
    db::get_system_branding(&pool)
}

#[tauri::command]
pub fn update_system_branding(pool: State<'_, DbPool>, admin_id: i64, name: String, logo_base64: String) -> Result<(), String> {
    db::update_system_branding(&pool, admin_id, &name, &logo_base64)
}
