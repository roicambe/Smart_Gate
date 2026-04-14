use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Debug)]
pub struct Department {
    pub department_id: i64,
    pub department_code: String,
    pub department_name: String,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct Program {
    pub program_id: i64,
    pub department_id: i64,
    pub program_code: String,
    pub program_name: String,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct Person {
    pub person_id: i64,
    pub id_number: String,
    pub role: String,
    pub first_name: String,
    pub middle_name: Option<String>,
    pub last_name: String,
    pub email: Option<String>,
    pub contact_number: Option<String>,
    pub face_template_path: Option<String>,
    pub is_active: bool,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct Student {
    pub person_id: i64,
    pub program_id: i64,
    pub year_level: Option<i64>,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct Employee {
    pub person_id: i64,
    pub department_id: i64,
    pub position_title: String,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct Scanner {
    pub scanner_id: i64,
    pub location_name: String,
    pub function: String,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct Event {
    pub event_id: i64,
    pub event_name: String,
    pub schedule_type: Option<String>,
    pub event_date: String,
    pub start_date: Option<String>,
    pub end_date: Option<String>,
    pub start_time: String,
    pub end_time: String,
    pub required_role: String,
    pub is_enabled: bool,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct EntryLog {
    pub log_id: i64,
    pub person_id: i64,
    pub scanner_id: i64,
    pub scanned_at: String, // Stored as ISO8601 string or similar
}

#[derive(Serialize, Deserialize, Debug)]
pub struct AuditLog {
    pub audit_id: i64,
    pub admin_id: i64,
    pub action_type: String,
    pub target_table: String,
    pub target_id: i64,
    pub old_values: Option<String>,
    pub new_values: Option<String>,
    pub created_at: String,
}

// ------ Joined Models for Frontend Use ------

#[derive(Serialize, Deserialize, Debug)]
pub struct StudentDetails {
    pub person_id: i64,
    pub id_number: String,
    pub first_name: String,
    pub middle_name: Option<String>,
    pub last_name: String,
    pub email: Option<String>,
    pub contact_number: Option<String>,
    pub is_active: bool,
    pub program_id: i64,
    pub program_name: String,
    pub year_level: Option<i64>,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct EmployeeDetails {
    pub person_id: i64,
    pub id_number: String,
    pub first_name: String,
    pub middle_name: Option<String>,
    pub last_name: String,
    pub email: Option<String>,
    pub contact_number: Option<String>,
    pub is_active: bool,
    pub department_id: i64,
    pub position_title: String,
    pub department_name: String,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct VisitorDetails {
    pub person_id: i64,
    pub id_number: String,
    pub first_name: String,
    pub middle_name: Option<String>,
    pub last_name: String,
    pub email: Option<String>,
    pub purpose_of_visit: String,
    pub person_to_visit: String,
    pub contact_number: Option<String>,
    pub created_at: Option<String>,
    pub time_in: Option<String>,
    pub time_out: Option<String>,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct EventAttendance {
    pub attendance_id: i64,
    pub event_id: i64,
    pub person_id: i64,
    pub scanned_at: String,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct EventAttendanceLog {
    pub log_id: i64,
    pub person_name: String,
    pub id_number: String,
    pub role: String,
    pub event_name: String,
    pub scanned_at: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct AdminAccount {
    pub account_id: i64,
    pub username: String,
    pub full_name: String,
    pub email: Option<String>,
    pub role: String,
    pub is_first_login: bool,
    pub created_at: String,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct AdminLoginResponse {
    pub success: bool,
    pub message: String,
    pub requires_activation: bool,
    pub masked_email: Option<String>,
    pub account: Option<AdminAccount>,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct AdminActivationResponse {
    pub success: bool,
    pub message: String,
    pub account: Option<AdminAccount>,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct ScanResult {
    pub success: bool,
    pub message: String,
    pub person_name: Option<String>,
    pub role: Option<String>,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct ChartDataPoint {
    pub date: String,
    pub students: i64,
    pub employees: i64,
    pub visitors: i64,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct DashboardData {
    pub total_students: i64,
    pub total_employees: i64,
    pub total_visitors: i64,
    pub entries_today: i64,
    pub exits_today: i64,
    pub attendance_trend: Vec<ChartDataPoint>,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct AccessLogDetails {
    pub log_id: i64,
    pub scanned_at: String,
    pub person_name: String,
    pub id_number: String,
    pub role: String,
    pub scanner_location: String,
    pub scanner_function: String,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct AuditLogDetails {
    pub audit_id: i64,
    pub admin_id: i64,
    pub admin_username: String,
    pub admin_full_name: String,
    pub action_type: String,
    pub target_table: String,
    pub target_id: Option<i64>,
    pub old_values: Option<String>,
    pub new_values: Option<String>,
    pub created_at: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct SystemBranding {
    pub system_name: String,
    pub system_logo: String,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct BulkImportResult {
    pub success_count: i64,
    pub failed_count: i64,
    pub imported_ids: Vec<String>,
    pub error_logs: Vec<String>,
}

