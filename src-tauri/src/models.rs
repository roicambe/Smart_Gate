use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct Department {
    pub department_id: i64,
    pub department_code: String,
    pub department_name: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct Program {
    pub program_id: i64,
    pub department_id: i64,
    pub program_code: String,
    pub program_name: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct Role {
    pub role_id: i64,
    pub role_name: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct PersonContact {
    pub contact_id: i64,
    pub person_id: i64,
    pub contact_type: String, // 'email', 'phone'
    pub contact_value: String,
    pub is_primary: bool,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct Person {
    pub person_id: i64,
    pub id_number: String,
    pub first_name: String,
    pub middle_name: Option<String>,
    pub last_name: String,
    pub face_template_path: Option<String>,
    pub is_active: bool,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct Student {
    pub person_id: i64,
    pub program_id: i64,
    pub year_level: Option<i64>,
    pub is_irregular: Option<bool>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct Employee {
    pub person_id: i64,
    pub department_id: i64,
    pub position_title: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct Scanner {
    pub scanner_id: i64,
    pub location_name: String,
    pub function: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct Event {
    pub event_id: i64,
    pub event_name: String,
    pub description: Option<String>,
    pub is_enabled: bool,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct EventWeeklySchedule {
    pub schedule_id: i64,
    pub event_id: i64,
    pub day_of_week: String,
    pub start_time: String,
    pub end_time: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct EventDateRangeSchedule {
    pub schedule_id: i64,
    pub event_id: i64,
    pub start_date: String,
    pub end_date: String,
    pub start_time: String,
    pub end_time: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ActivityLog {
    pub log_id: i64,
    pub person_id: i64,
    pub scanner_id: i64,
    pub activity_type: String,
    pub event_id: Option<i64>,
    pub scanned_at: String,
    pub status: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
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

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct StudentDetails {
    pub person_id: i64,
    pub id_number: String,
    pub first_name: String,
    pub middle_name: Option<String>,
    pub last_name: String,
    pub roles: Vec<String>,
    pub contacts: Vec<PersonContact>,
    pub is_active: bool,
    pub program_id: i64,
    pub program_name: String,
    pub year_level: Option<i64>,
    pub is_irregular: Option<bool>,
    pub department_name: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct EmployeeDetails {
    pub person_id: i64,
    pub id_number: String,
    pub first_name: String,
    pub middle_name: Option<String>,
    pub last_name: String,
    pub roles: Vec<String>,
    pub contacts: Vec<PersonContact>,
    pub is_active: bool,
    pub department_id: i64,
    pub position_title: String,
    pub department_name: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct VisitorDetails {
    pub person_id: i64,
    pub id_number: String,
    pub first_name: String,
    pub middle_name: Option<String>,
    pub last_name: String,
    pub contacts: Vec<PersonContact>,
    pub purpose_of_visit: String,
    pub person_to_visit: String,
    pub created_at: Option<String>,
    pub time_in: Option<String>,
    pub time_out: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct EventDetails {
    pub event: Event,
    pub weekly_schedules: Vec<EventWeeklySchedule>,
    pub date_range_schedules: Vec<EventDateRangeSchedule>,
    pub required_roles: Vec<Role>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ActivityLogDetails {
    pub log_id: i64,
    pub scanned_at: String,
    pub person_name: String,
    pub id_number: String,
    pub roles: Vec<String>,
    pub department_name: Option<String>,
    pub scanner_location: String,
    pub activity_type: String,
    pub event_name: Option<String>,
    pub status: Option<String>,
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
    pub roles: Option<Vec<String>>,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct ScanPersonDetails {
    pub person_id: i64,
    pub roles: Vec<String>,
    pub id_number: String,
    pub first_name: String,
    pub middle_name: Option<String>,
    pub last_name: String,
    pub department_name: Option<String>,
    pub program_name: Option<String>,
    pub year_level: Option<i64>,
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

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct AuditEvent {
    pub event_id: i64,
    pub action_type: String,
    pub entity_type: String,
    pub entity_id: i64,
    pub entity_label: String,
    pub performed_by: i64,
    pub admin_username: String,
    pub admin_full_name: String,
    pub created_at: String,
    pub changes: Vec<AuditChange>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct AuditChange {
    pub change_id: i64,
    pub event_id: i64,
    pub field_name: String,
    pub old_value: Option<String>,
    pub new_value: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct SystemBranding {
    pub system_name: String,
    pub system_logo: String,
    pub system_title: String,
    pub report_address: String,
    pub report_phone: String,
    pub report_email: String,
    pub primary_logo: Option<String>,
    pub secondary_logo_1: Option<String>,
    pub secondary_logo_2: Option<String>,
    pub primary_circle: bool,
    pub secondary1_circle: bool,
    pub secondary2_circle: bool,
    pub primary_logo_enabled: bool,
    pub secondary_logo_1_enabled: bool,
    pub secondary_logo_2_enabled: bool,
    pub strict_email_domain: bool,
    pub enable_face_recognition: bool,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct BulkImportResult {
    pub success_count: i64,
    pub failed_count: i64,
    pub imported_ids: Vec<String>,
    pub error_logs: Vec<String>,
}
