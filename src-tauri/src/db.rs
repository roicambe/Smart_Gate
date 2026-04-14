use crate::models::*;
use calamine::{open_workbook_auto, Data, Reader};
use serde_json::json;
use chrono::{Duration, Local, NaiveDateTime};
use r2d2::Pool;
use r2d2_sqlite::SqliteConnectionManager;
use rusqlite::{params, OptionalExtension};
use std::collections::HashMap;
use std::fs;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::Manager;

pub type DbPool = Pool<SqliteConnectionManager>;

pub(crate) struct FirstLoginChallenge {
    pub(crate) account: AdminAccount,
    pub(crate) email: String,
    pub(crate) otp_code: String,
    pub(crate) masked_email: String,
}

fn table_has_column(
    conn: &rusqlite::Connection,
    table: &str,
    column: &str,
) -> Result<bool, String> {
    let pragma = format!("PRAGMA table_info({table})");
    let mut stmt = conn.prepare(&pragma).map_err(|e| e.to_string())?;
    let columns = stmt
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|e| e.to_string())?;

    for item in columns {
        if item.map_err(|e| e.to_string())? == column {
            return Ok(true);
        }
    }

    Ok(false)
}

fn is_valid_email(email: &str) -> bool {
    let trimmed = email.trim();
    let Some((local, domain)) = trimmed.split_once('@') else {
        return false;
    };

    !local.is_empty()
        && !domain.is_empty()
        && !domain.starts_with('.')
        && !domain.ends_with('.')
        && domain.contains('.')
        && !trimmed.contains(' ')
}

fn generate_gate_supervisor_password(full_name: &str) -> String {
    let first_token = full_name
        .split_whitespace()
        .find(|part| !part.trim().is_empty())
        .unwrap_or("")
        .chars()
        .filter(|ch| ch.is_ascii_alphanumeric())
        .collect::<String>()
        .to_lowercase();

    if first_token.is_empty() {
        "gatesupervisor123".to_string()
    } else {
        format!("{first_token}123")
    }
}

fn mask_email(email: &str) -> String {
    let trimmed = email.trim();
    let Some((local, domain)) = trimmed.split_once('@') else {
        return trimmed.to_string();
    };

    let masked_local = match local.len() {
        0 => "".to_string(),
        1 => "*".to_string(),
        2 => format!("{}*", &local[..1]),
        _ => format!(
            "{}{}{}",
            &local[..1],
            "*".repeat(local.len().saturating_sub(2)),
            &local[local.len() - 1..]
        ),
    };

    format!("{masked_local}@{domain}")
}

fn generate_six_digit_otp(account_id: i64) -> String {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0);
    let account_bias = (account_id.unsigned_abs() as u128).wrapping_mul(1_103_515_245_u128);

    format!("{:06}", ((now ^ account_bias) % 1_000_000) as u32)
}

fn normalize_lookup_key(value: &str) -> String {
    value
        .trim()
        .to_ascii_lowercase()
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .collect()
}

fn cell_to_string(cell: &Data) -> String {
    match cell {
        Data::String(s) => s.trim().to_string(),
        Data::Float(n) => {
            if n.fract() == 0.0 {
                format!("{}", *n as i64)
            } else {
                n.to_string()
            }
        }
        Data::Int(n) => n.to_string(),
        Data::Bool(b) => b.to_string(),
        Data::Empty => String::new(),
        _ => cell.to_string().trim().to_string(),
    }
}

pub fn init_db(app_handle: &tauri::AppHandle) -> Result<DbPool, String> {
    // Determine the path to the database file
    let app_dir = app_handle
        .path()
        .app_data_dir()
        .expect("Failed to get app data directory");

    fs::create_dir_all(&app_dir).map_err(|e| format!("Failed to create App Directory: {}", e))?;

    let db_path = app_dir.join("smart_gate.sqlite");

    // Set up the connection manager and pool
    let manager = SqliteConnectionManager::file(&db_path);
    let pool =
        r2d2::Pool::new(manager).map_err(|e| format!("Failed to create database pool: {}", e))?;

    // Initialize the database with schema.sql
    let conn = pool
        .get()
        .map_err(|e| format!("Failed to get connection from pool: {}", e))?;
    let schema = include_str!("../../docs/database/schema.sql");
    conn.execute_batch(schema)
        .map_err(|e| format!("Failed to execute schema: {}", e))?;

    // Normalize legacy person schema to the current id_number/email/contact_number layout.
    if table_has_column(&conn, "persons", "school_id_number")?
        && !table_has_column(&conn, "persons", "id_number")?
    {
        conn.execute(
            "ALTER TABLE persons RENAME COLUMN school_id_number TO id_number",
            params![],
        )
        .map_err(|e| format!("Failed to migrate persons.id_number: {}", e))?;
    }

    let _ = conn.execute(
        "ALTER TABLE persons ADD COLUMN email VARCHAR NULL",
        params![],
    );
    let _ = conn.execute(
        "ALTER TABLE persons ADD COLUMN contact_number VARCHAR NULL",
        params![],
    );

    // Drop the UNIQUE constraint on email by recreating the table if it exists
    let persons_sql: String = conn
        .query_row(
            "SELECT sql FROM sqlite_master WHERE type='table' AND name='persons'",
            [],
            |row| row.get(0),
        )
        .unwrap_or_default();

    if persons_sql.contains("email VARCHAR UNIQUE") {
        conn.execute_batch(
            "
            PRAGMA foreign_keys = OFF;
            CREATE TABLE IF NOT EXISTS persons_new (
                person_id INTEGER PRIMARY KEY AUTOINCREMENT,
                id_number VARCHAR UNIQUE NOT NULL,
                role TEXT CHECK(role IN ('student', 'professor', 'staff', 'visitor')) NOT NULL,
                first_name VARCHAR NOT NULL,
                middle_name VARCHAR NULL,
                last_name VARCHAR NOT NULL,
                email VARCHAR NULL,
                contact_number VARCHAR NULL,
                face_template_path VARCHAR NULL,
                is_active BOOLEAN NOT NULL DEFAULT 1    
            );
            INSERT INTO persons_new SELECT * FROM persons;
            DROP TABLE persons;
            ALTER TABLE persons_new RENAME TO persons;
            PRAGMA foreign_keys = ON;
        ",
        )
        .map_err(|e| format!("Failed to migrate un-unique email: {}", e))?;
    }

    // Add created_at if missing (For Same-Day Expiry logic)
    if !table_has_column(&conn, "persons", "created_at")? {
        // SQLite doesn't allow adding a column with a non-constant default (CURRENT_TIMESTAMP) via ALTER TABLE.
        // We add it as nullable, then update existing rows.
        conn.execute(
            "ALTER TABLE persons ADD COLUMN created_at DATETIME",
            params![],
        )
        .map_err(|e| format!("Failed to add created_at column to persons: {}", e))?;

        conn.execute(
            "UPDATE persons SET created_at = CURRENT_TIMESTAMP WHERE created_at IS NULL",
            params![],
        )
        .map_err(|e| format!("Failed to populate created_at for existing rows: {}", e))?;
    }

    // Fix Visitor Schema (dynamically add person_to_visit if missing) and move legacy contact data into persons.
    let _ = conn.execute(
        "ALTER TABLE visitors ADD COLUMN person_to_visit TEXT DEFAULT ''",
        params![],
    );
    if table_has_column(&conn, "visitors", "contact_number")? {
        conn.execute(
            "UPDATE persons
             SET contact_number = COALESCE(persons.contact_number, (
                 SELECT v.contact_number FROM visitors v WHERE v.person_id = persons.person_id
             ))
             WHERE role = 'visitor'",
            params![],
        )
        .map_err(|e| format!("Failed to migrate visitor contact numbers: {}", e))?;
    }

    if table_has_column(&conn, "visitors", "id_presented")? {
        conn.execute_batch(
            "
            PRAGMA foreign_keys = OFF;
            CREATE TABLE IF NOT EXISTS visitors_new (
                person_id INTEGER PRIMARY KEY,
                purpose_of_visit VARCHAR NOT NULL,
                person_to_visit VARCHAR NOT NULL,
                FOREIGN KEY (person_id) REFERENCES persons(person_id)
            );
            INSERT INTO visitors_new (person_id, purpose_of_visit, person_to_visit)
            SELECT person_id, purpose_of_visit, person_to_visit FROM visitors;
            DROP TABLE visitors;
            ALTER TABLE visitors_new RENAME TO visitors;
            PRAGMA foreign_keys = ON;
        ",
        )
        .map_err(|e| format!("Failed to migrate visitors id_presented: {}", e))?;
    }

    // Admin RBAC updates and role normalization.
    if !table_has_column(&conn, "events", "schedule_type")? {
        conn.execute(
            "ALTER TABLE events ADD COLUMN schedule_type VARCHAR NULL DEFAULT 'weekly'",
            params![],
        )
        .map_err(|e| format!("Failed to add schedule_type col to events: {}", e))?;
    }
    if !table_has_column(&conn, "events", "start_date")? {
        conn.execute(
            "ALTER TABLE events ADD COLUMN start_date VARCHAR NULL",
            params![],
        )
        .map_err(|e| format!("Failed to add start_date col to events: {}", e))?;
    }
    if !table_has_column(&conn, "events", "end_date")? {
        conn.execute(
            "ALTER TABLE events ADD COLUMN end_date VARCHAR NULL",
            params![],
        )
        .map_err(|e| format!("Failed to add end_date col to events: {}", e))?;
    }

    if !table_has_column(&conn, "accounts", "full_name")? {
        conn.execute(
            "ALTER TABLE accounts ADD COLUMN full_name VARCHAR DEFAULT 'Administrator'",
            params![],
        )
        .map_err(|e| format!("Failed to add full_name column to accounts: {}", e))?;
    }

    if !table_has_column(&conn, "accounts", "role")? {
        // If role column is missing, we add it.
        // We use 'Gate Supervisor' as default for existing accounts to be safe,
        // but 'admin' will be seeded as 'System Administrator' anyway.
        conn.execute(
            "ALTER TABLE accounts ADD COLUMN role TEXT DEFAULT 'Gate Supervisor'",
            params![],
        )
        .map_err(|e| format!("Failed to add role column to accounts: {}", e))?;
    }

    if !table_has_column(&conn, "accounts", "email")? {
        conn.execute(
            "ALTER TABLE accounts ADD COLUMN email VARCHAR NULL",
            params![],
        )
        .map_err(|e| format!("Failed to add email column to accounts: {}", e))?;
    }

    if !table_has_column(&conn, "accounts", "is_first_login")? {
        conn.execute(
            "ALTER TABLE accounts ADD COLUMN is_first_login BOOLEAN NOT NULL DEFAULT 0",
            params![],
        )
        .map_err(|e| format!("Failed to add is_first_login column to accounts: {}", e))?;
    }

    if !table_has_column(&conn, "accounts", "activation_otp")? {
        conn.execute(
            "ALTER TABLE accounts ADD COLUMN activation_otp VARCHAR NULL",
            params![],
        )
        .map_err(|e| format!("Failed to add activation_otp column to accounts: {}", e))?;
    }

    if !table_has_column(&conn, "accounts", "activation_otp_expires_at")? {
        conn.execute(
            "ALTER TABLE accounts ADD COLUMN activation_otp_expires_at DATETIME NULL",
            params![],
        )
        .map_err(|e| {
            format!(
                "Failed to add activation_otp_expires_at column to accounts: {}",
                e
            )
        })?;
    }

    conn.execute(
        "UPDATE accounts
         SET full_name = COALESCE(NULLIF(TRIM(full_name), ''), 'Administrator')",
        params![],
    )
    .map_err(|e| format!("Failed to normalize account names: {}", e))?;

    conn.execute(
        "UPDATE accounts
         SET role = CASE
             WHEN role IN ('Super Admin', 'System Administrator') THEN 'System Administrator'
             WHEN role IN ('Admin', 'Gate Supervisor') THEN 'Gate Supervisor'
             ELSE role
         END",
        params![],
    )
    .map_err(|e| format!("Failed to normalize account roles: {}", e))?;

    conn.execute(
        "UPDATE accounts
         SET email = NULL
         WHERE TRIM(COALESCE(email, '')) = ''",
        params![],
    )
    .map_err(|e| format!("Failed to normalize account emails: {}", e))?;

    conn.execute(
        "UPDATE accounts
         SET is_first_login = COALESCE(is_first_login, 0)",
        params![],
    )
    .map_err(|e| format!("Failed to normalize first-login flags: {}", e))?;

    // Migrate system_settings to settings
    let _ = conn.execute(
        "INSERT OR IGNORE INTO settings (setting_key, setting_value) SELECT setting_key, setting_value FROM system_settings;",
        params![]
    );
    let _ = conn.execute("DROP TABLE IF EXISTS system_settings", params![]);
    conn.execute(
        "INSERT OR IGNORE INTO accounts (username, password_hash, full_name, role)
         VALUES ('admin', 'admin123', 'Administrator', 'System Administrator')",
        params![],
    )
    .map_err(|e| format!("Failed to seed default admin account: {}", e))?;

    // Fix audit_logs CHECK constraint migration:
    // Old schema used lowercase ('create','read','update','delete') but the Rust code inserts
    // uppercase ('INSERT','UPDATE','DELETE'). We recreate the table if the old constraint is present.
    let old_constraint_exists: bool = conn.query_row(
        "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='audit_logs' AND sql LIKE \"%'create'%\"",
        [],
        |row| row.get::<_, i64>(0),
    ).unwrap_or(0) > 0;

    if old_constraint_exists {
        conn.execute_batch("
            PRAGMA foreign_keys = OFF;
            CREATE TABLE IF NOT EXISTS audit_logs_new (
                audit_id INTEGER PRIMARY KEY AUTOINCREMENT,
                admin_id INTEGER NOT NULL,
                action_type TEXT CHECK(action_type IN ('INSERT', 'READ', 'UPDATE', 'DELETE')) NOT NULL,
                target_table VARCHAR NOT NULL,
                target_id INTEGER NOT NULL,
                old_values JSON NULL,
                new_values JSON NULL,
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (admin_id) REFERENCES accounts(account_id)
            );
            DROP TABLE audit_logs;
            ALTER TABLE audit_logs_new RENAME TO audit_logs;
            PRAGMA foreign_keys = ON;
        ").map_err(|e| format!("Failed to migrate audit_logs: {}", e))?;
    }

    Ok(pool)
}

// ------ Academic Structure CRUD Operations ------

pub fn add_department(pool: &DbPool, department: Department, active_admin_id: i64) -> Result<i64, String> {
    let conn = pool.get().map_err(|e| e.to_string())?;

    conn.execute(
        "INSERT INTO departments (department_code, department_name)
         VALUES (?1, ?2)",
        params![department.department_code, department.department_name],
    )
    .map_err(|e| e.to_string())?;

    let target_id = conn.last_insert_rowid();

    let _ = log_audit_action(
        pool,
        active_admin_id,
        "INSERT",
        "departments",
        target_id,
        None,
        Some(json!({
            "department_code": department.department_code,
            "department_name": department.department_name
        }).to_string()),
    );

    Ok(target_id)
}

pub fn get_departments(pool: &DbPool) -> Result<Vec<Department>, String> {
    let conn = pool.get().map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare("SELECT department_id, department_code, department_name FROM departments")
        .map_err(|e| e.to_string())?;

    let iter = stmt
        .query_map([], |row| {
            Ok(Department {
                department_id: row.get(0)?,
                department_code: row.get(1)?,
                department_name: row.get(2)?,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut list = Vec::new();
    for item in iter {
        list.push(item.map_err(|e| e.to_string())?);
    }

    Ok(list)
}

pub fn update_department(
    pool: &DbPool,
    department_id: i64,
    new_name: &str,
    new_code: &str,
    active_admin_id: i64,
) -> Result<(), String> {
    let conn = pool.get().map_err(|e| e.to_string())?;

    let (old_code, old_name): (String, String) = conn.query_row(
        "SELECT department_code, department_name FROM departments WHERE department_id = ?1",
        params![department_id],
        |row| Ok((row.get(0)?, row.get(1)?))
    ).unwrap_or_default();

    conn.execute(
        "UPDATE departments SET department_name = ?1, department_code = ?2 WHERE department_id = ?3",
        params![new_name, new_code, department_id],
    ).map_err(|e| e.to_string())?;

    let _ = log_audit_action(
        pool,
        active_admin_id,
        "UPDATE",
        "departments",
        department_id,
        Some(json!({
            "department_code": old_code,
            "department_name": old_name
        }).to_string()),
        Some(json!({
            "department_code": new_code,
            "department_name": new_name
        }).to_string()),
    );

    Ok(())
}

pub fn delete_department(pool: &DbPool, department_id: i64, active_admin_id: i64) -> Result<(), String> {
    let conn = pool.get().map_err(|e| e.to_string())?;

    // Check if there are programs associated
    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM programs WHERE department_id = ?1",
            params![department_id],
            |row| row.get(0),
        )
        .unwrap_or(0);

    if count > 0 {
        return Err("Cannot delete department because it has associated programs. Please delete the programs first.".to_string());
    }

    let (deleted_code, deleted_name): (String, String) = conn.query_row(
        "SELECT department_code, department_name FROM departments WHERE department_id = ?1",
        params![department_id],
        |row| Ok((row.get(0)?, row.get(1)?))
    ).unwrap_or_default();

    conn.execute(
        "DELETE FROM departments WHERE department_id = ?1",
        params![department_id],
    )
    .map_err(|e| e.to_string())?;

    let _ = log_audit_action(
        pool,
        active_admin_id,
        "DELETE",
        "departments",
        department_id,
        Some(json!({ "department_code": deleted_code, "department_name": deleted_name }).to_string()),
        None,
    );

    Ok(())
}

pub fn add_program(pool: &DbPool, program: Program, active_admin_id: i64) -> Result<i64, String> {
    let conn = pool.get().map_err(|e| e.to_string())?;

    conn.execute(
        "INSERT INTO programs (department_id, program_code, program_name)
         VALUES (?1, ?2, ?3)",
        params![
            program.department_id,
            program.program_code,
            program.program_name
        ],
    )
    .map_err(|e| e.to_string())?;

    let target_id = conn.last_insert_rowid();

    let _ = log_audit_action(
        pool,
        active_admin_id,
        "INSERT",
        "programs",
        target_id,
        None,
        Some(json!({
            "department_id": program.department_id,
            "program_code": program.program_code,
            "program_name": program.program_name
        }).to_string()),
    );

    Ok(target_id)
}

pub fn get_programs(pool: &DbPool) -> Result<Vec<Program>, String> {
    let conn = pool.get().map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare("SELECT program_id, department_id, program_code, program_name FROM programs")
        .map_err(|e| e.to_string())?;

    let iter = stmt
        .query_map([], |row| {
            Ok(Program {
                program_id: row.get(0)?,
                department_id: row.get(1)?,
                program_code: row.get(2)?,
                program_name: row.get(3)?,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut list = Vec::new();
    for item in iter {
        list.push(item.map_err(|e| e.to_string())?);
    }

    Ok(list)
}

pub fn update_program(
    pool: &DbPool,
    program_id: i64,
    department_id: i64,
    new_name: &str,
    new_code: &str,
    active_admin_id: i64,
) -> Result<(), String> {
    let conn = pool.get().map_err(|e| e.to_string())?;

    let (old_dept_id, old_code, old_name): (i64, String, String) = conn.query_row(
        "SELECT department_id, program_code, program_name FROM programs WHERE program_id = ?1",
        params![program_id],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?))
    ).unwrap_or_default();

    conn.execute(
        "UPDATE programs SET department_id = ?1, program_name = ?2, program_code = ?3 WHERE program_id = ?4",
        params![department_id, new_name, new_code, program_id],
    ).map_err(|e| e.to_string())?;

    let _ = log_audit_action(
        pool,
        active_admin_id,
        "UPDATE",
        "programs",
        program_id,
        Some(json!({
            "department_id": old_dept_id,
            "program_code": old_code,
            "program_name": old_name
        }).to_string()),
        Some(json!({
            "department_id": department_id,
            "program_code": new_code,
            "program_name": new_name
        }).to_string()),
    );

    Ok(())
}

pub fn delete_program(pool: &DbPool, program_id: i64, active_admin_id: i64) -> Result<(), String> {
    let conn = pool.get().map_err(|e| e.to_string())?;

    // Check if there are students associated
    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM students WHERE program_id = ?1",
            params![program_id],
            |row| row.get(0),
        )
        .unwrap_or(0);

    if count > 0 {
        return Err("Cannot delete program because it has associated students.".to_string());
    }

    let (deleted_dept_id, deleted_code, deleted_name): (i64, String, String) = conn.query_row(
        "SELECT department_id, program_code, program_name FROM programs WHERE program_id = ?1",
        params![program_id],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?))
    ).unwrap_or_default();

    conn.execute(
        "DELETE FROM programs WHERE program_id = ?1",
        params![program_id],
    )
    .map_err(|e| e.to_string())?;

    let _ = log_audit_action(
        pool,
        active_admin_id,
        "DELETE",
        "programs",
        program_id,
        Some(json!({ "department_id": deleted_dept_id, "program_code": deleted_code, "program_name": deleted_name }).to_string()),
        None,
    );

    Ok(())
}

// ------ User Management CRUD Operations ------

pub fn add_person(pool: &DbPool, person: Person) -> Result<i64, String> {
    let conn = pool.get().map_err(|e| e.to_string())?;

    let is_active = if person.is_active { 1 } else { 0 };

    conn.execute(
        "INSERT INTO persons (id_number, role, first_name, middle_name, last_name, email, contact_number, face_template_path, is_active, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, CURRENT_TIMESTAMP)",
        params![
            person.id_number,
            person.role,
            person.first_name,
            person.middle_name,
            person.last_name,
            person.email,
            person.contact_number,
            person.face_template_path,
            is_active
        ],
    ).map_err(|e| e.to_string())?;

    Ok(conn.last_insert_rowid())
}

pub fn get_persons(pool: &DbPool) -> Result<Vec<Person>, String> {
    let conn = pool.get().map_err(|e| e.to_string())?;

    let mut stmt = conn.prepare("SELECT person_id, id_number, role, first_name, middle_name, last_name, email, contact_number, face_template_path, is_active FROM persons")
        .map_err(|e| e.to_string())?;

    let person_iter = stmt
        .query_map([], |row| {
            Ok(Person {
                person_id: row.get(0)?,
                id_number: row.get(1)?,
                role: row.get(2)?,
                first_name: row.get(3)?,
                middle_name: row.get(4).unwrap_or(None),
                last_name: row.get(5)?,
                email: row.get(6).unwrap_or(None),
                contact_number: row.get(7).unwrap_or(None),
                face_template_path: row.get(8)?,
                is_active: row.get::<_, i32>(9)? == 1,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut persons = Vec::new();
    for person in person_iter {
        persons.push(person.map_err(|e| e.to_string())?);
    }

    Ok(persons)
}

pub fn update_person_status(pool: &DbPool, person_id: i64, is_active: bool, active_admin_id: i64) -> Result<(), String> {
    let conn = pool.get().map_err(|e| e.to_string())?;
    let active_int = if is_active { 1 } else { 0 };

    conn.execute(
        "UPDATE persons SET is_active = ?1 WHERE person_id = ?2",
        params![active_int, person_id],
    )
    .map_err(|e| e.to_string())?;

    let _ = log_audit_action(
        pool,
        active_admin_id,
        "UPDATE",
        "persons",
        person_id,
        None,
        Some(json!({ "is_active": is_active }).to_string()),
    );

    Ok(())
}

pub fn add_student(pool: &DbPool, student: Student) -> Result<(), String> {
    let conn = pool.get().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO students (person_id, program_id) VALUES (?1, ?2)",
        params![student.person_id, student.program_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn get_students(pool: &DbPool) -> Result<Vec<StudentDetails>, String> {
    let conn = pool.get().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare(
        "SELECT p.person_id, p.id_number, p.first_name, p.middle_name, p.last_name, p.email, p.contact_number, p.is_active,
                s.program_id, pr.program_name, s.year_level
         FROM persons p
         JOIN students s ON p.person_id = s.person_id
         JOIN programs pr ON s.program_id = pr.program_id"
    ).map_err(|e| e.to_string())?;

    let iter = stmt
        .query_map([], |row| {
            Ok(StudentDetails {
                person_id: row.get(0)?,
                id_number: row.get(1)?,
                first_name: row.get(2)?,
                middle_name: row.get(3).unwrap_or(None),
                last_name: row.get(4)?,
                email: row.get(5).unwrap_or(None),
                contact_number: row.get(6).unwrap_or(None),
                is_active: row.get::<_, i32>(7)? == 1,
                program_id: row.get(8)?,
                program_name: row.get(9)?,
                year_level: row.get(10).unwrap_or(None),
            })
        })
        .map_err(|e| e.to_string())?;

    let mut list = Vec::new();
    for item in iter {
        list.push(item.map_err(|e| e.to_string())?);
    }
    Ok(list)
}

pub fn add_employee(pool: &DbPool, employee: Employee) -> Result<(), String> {
    let conn = pool.get().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO employees (person_id, department_id, position_title) VALUES (?1, ?2, ?3)",
        params![
            employee.person_id,
            employee.department_id,
            employee.position_title
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn register_user(
    pool: &DbPool,
    role: &str,
    id_number: &str,
    first_name: &str,
    middle_name: Option<String>,
    last_name: &str,
    email: Option<String>,
    contact_number: Option<String>,
    program_id: Option<i64>,
    year_level: Option<i64>,
    department_id: Option<i64>,
    position_title: Option<String>,
    purpose: Option<String>,
    person_to_visit: Option<String>,
    active_admin_id: Option<i64>,
) -> Result<i64, String> {
    let mut conn = pool.get().map_err(|e| e.to_string())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    tx.execute(
        "INSERT INTO persons (id_number, role, first_name, middle_name, last_name, email, contact_number, is_active, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 1, CURRENT_TIMESTAMP)",
        params![id_number, role, first_name, middle_name, last_name, email, contact_number],
    ).map_err(|e| e.to_string())?;

    let person_id = tx.last_insert_rowid();

    match role {
        "student" => {
            tx.execute(
                "INSERT INTO students (person_id, program_id, year_level) VALUES (?1, ?2, ?3)",
                params![person_id, program_id.unwrap_or(1), year_level],
            )
            .map_err(|e| e.to_string())?;
        }
        "professor" | "staff" => {
            tx.execute(
                "INSERT INTO employees (person_id, department_id, position_title) VALUES (?1, ?2, ?3)",
                params![person_id, department_id.unwrap_or(1), position_title.unwrap_or_default()],
            ).map_err(|e| e.to_string())?;
        }
        "visitor" => {
            tx.execute(
                "INSERT INTO visitors (person_id, purpose_of_visit, person_to_visit) VALUES (?1, ?2, ?3)",
                params![person_id, purpose.unwrap_or_default(), person_to_visit.unwrap_or_default()],
            ).map_err(|e| e.to_string())?;
        }
        _ => return Err("Invalid role specified".to_string()),
    }

    tx.commit().map_err(|e| e.to_string())?;

    if let Some(admin_id) = active_admin_id {
        let _ = log_audit_action(
            pool,
            admin_id,
            "INSERT",
            "persons",
            person_id,
            None,
            Some(json!({
                "id_number": id_number,
                "role": role,
                "first_name": first_name,
                "last_name": last_name
            }).to_string()),
        );
    }

    Ok(person_id)
}

pub fn bulk_import_users_from_excel(
    pool: &DbPool,
    file_path: &str,
    role: &str,
    active_admin_id: i64,
) -> Result<BulkImportResult, String> {
    if !matches!(role, "student" | "professor" | "staff") {
        return Err("Excel import is only supported for students, professors, and staff.".to_string());
    }

    let mut workbook = open_workbook_auto(file_path)
        .map_err(|e| format!("Failed to open Excel file: {e}"))?;
    let first_sheet_name = workbook
        .sheet_names()
        .first()
        .cloned()
        .ok_or_else(|| "No worksheet found in the selected Excel file.".to_string())?;
    let range = workbook
        .worksheet_range(&first_sheet_name)
        .map_err(|e| format!("Failed to read worksheet: {e}"))?;

    let mut rows = range.rows();
    let header_row = rows
        .next()
        .ok_or_else(|| "The Excel file is empty. Please include a header row.".to_string())?;

    let mut header_index: HashMap<String, usize> = HashMap::new();
    for (idx, cell) in header_row.iter().enumerate() {
        let normalized = normalize_lookup_key(&cell_to_string(cell));
        if !normalized.is_empty() {
            header_index.insert(normalized, idx);
        }
    }

    let require_col = |keys: &[&str]| -> Result<usize, String> {
        for key in keys {
            if let Some(idx) = header_index.get(&normalize_lookup_key(key)) {
                return Ok(*idx);
            }
        }
        Err(format!("Missing required column. Expected one of: {}", keys.join(", ")))
    };

    let optional_col = |keys: &[&str]| -> Option<usize> {
        for key in keys {
            if let Some(idx) = header_index.get(&normalize_lookup_key(key)) {
                return Some(*idx);
            }
        }
        None
    };

    let idx_id_number = require_col(&["id_number", "id number"])?;
    let idx_first_name = require_col(&["first_name", "first name"])?;
    let idx_last_name = require_col(&["last_name", "last name"])?;
    let idx_middle_name = optional_col(&["middle_name", "middle name"]);
    let idx_email = optional_col(&["email"]);
    let idx_contact = optional_col(&["contact_number", "contact number"]);

    let idx_program_name = optional_col(&["program_name", "program name"]);
    let idx_program_code = optional_col(&["program_code", "program code"]);
    let idx_year_level = optional_col(&["year_level", "year level"]);

    let idx_department_name = optional_col(&["department_name", "department name"]);
    let idx_department_code = optional_col(&["department_code", "department code"]);
    let idx_position_title = optional_col(&["position_title", "position title"]);

    if role == "student" && idx_program_name.is_none() && idx_program_code.is_none() {
        return Err("Student import requires either program_name or program_code column.".to_string());
    }
    if (role == "professor" || role == "staff")
        && idx_department_name.is_none()
        && idx_department_code.is_none()
    {
        return Err("Employee import requires either department_name or department_code column.".to_string());
    }

    let mut conn = pool.get().map_err(|e| e.to_string())?;

    let mut program_lookup: HashMap<String, i64> = HashMap::new();
    let mut department_lookup: HashMap<String, i64> = HashMap::new();

    if role == "student" {
        let mut stmt = conn
            .prepare("SELECT program_id, program_name, program_code FROM programs")
            .map_err(|e| e.to_string())?;
        let iter = stmt
            .query_map([], |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                ))
            })
            .map_err(|e| e.to_string())?;
        for item in iter {
            let (program_id, program_name, program_code) = item.map_err(|e| e.to_string())?;
            program_lookup.insert(normalize_lookup_key(&program_name), program_id);
            program_lookup.insert(normalize_lookup_key(&program_code), program_id);
        }
    }

    if role == "professor" || role == "staff" {
        let mut stmt = conn
            .prepare("SELECT department_id, department_name, department_code FROM departments")
            .map_err(|e| e.to_string())?;
        let iter = stmt
            .query_map([], |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                ))
            })
            .map_err(|e| e.to_string())?;
        for item in iter {
            let (department_id, department_name, department_code) = item.map_err(|e| e.to_string())?;
            department_lookup.insert(normalize_lookup_key(&department_name), department_id);
            department_lookup.insert(normalize_lookup_key(&department_code), department_id);
        }
    }

    let mut success_count = 0_i64;
    let mut failed_count = 0_i64;
    let mut imported_ids: Vec<String> = Vec::new();
    let mut error_logs: Vec<String> = Vec::new();

    for (row_idx, row) in rows.enumerate() {
        let line_number = row_idx + 2;
        let get_col = |idx_opt: Option<usize>| -> String {
            idx_opt
                .and_then(|idx| row.get(idx))
                .map(cell_to_string)
                .unwrap_or_default()
                .trim()
                .to_string()
        };
        let id_number = get_col(Some(idx_id_number));
        let first_name = get_col(Some(idx_first_name));
        let last_name = get_col(Some(idx_last_name));
        let middle_name = get_col(idx_middle_name);
        let email = get_col(idx_email);
        let contact_number = get_col(idx_contact);

        if id_number.is_empty() || first_name.is_empty() || last_name.is_empty() {
            failed_count += 1;
            error_logs.push(format!("Row {line_number}: Missing required fields (id_number, first_name, or last_name)."));
            continue;
        }

        let duplicate_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM persons WHERE id_number = ?1",
                params![id_number],
                |r| r.get(0),
            )
            .unwrap_or(0);
        if duplicate_count > 0 {
            failed_count += 1;
            error_logs.push(format!("Row {line_number}: Duplicate ID Number '{}' already exists.", id_number));
            continue;
        }

        let row_result: Result<(), String> = (|| {
            let tx = conn.transaction().map_err(|e| e.to_string())?;
            tx.execute(
                "INSERT INTO persons (id_number, role, first_name, middle_name, last_name, email, contact_number, is_active, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 1, CURRENT_TIMESTAMP)",
                params![
                    id_number,
                    role,
                    first_name,
                    if middle_name.is_empty() { None::<String> } else { Some(middle_name.clone()) },
                    last_name,
                    if email.is_empty() { None::<String> } else { Some(email.clone()) },
                    if contact_number.is_empty() { None::<String> } else { Some(contact_number.clone()) },
                ],
            )
            .map_err(|e| e.to_string())?;

            let person_id = tx.last_insert_rowid();

            if role == "student" {
                let program_name_value = get_col(idx_program_name);
                let program_code_value = get_col(idx_program_code);
                let year_level_value = get_col(idx_year_level);
                let program_id = [&program_name_value, &program_code_value]
                    .iter()
                    .map(|v| normalize_lookup_key(v))
                    .find_map(|k| program_lookup.get(&k).copied())
                    .ok_or_else(|| {
                        format!(
                            "Row {line_number}: Unable to resolve program from '{}' / '{}'.",
                            program_name_value, program_code_value
                        )
                    })?;

                let year_level = if year_level_value.is_empty() {
                    None
                } else {
                    Some(
                        year_level_value
                            .parse::<i64>()
                            .map_err(|_| format!("Row {line_number}: Invalid year_level '{}'.", year_level_value))?,
                    )
                };

                tx.execute(
                    "INSERT INTO students (person_id, program_id, year_level) VALUES (?1, ?2, ?3)",
                    params![person_id, program_id, year_level],
                )
                .map_err(|e| e.to_string())?;
            } else {
                let department_name_value = get_col(idx_department_name);
                let department_code_value = get_col(idx_department_code);
                let position_title = get_col(idx_position_title);
                if position_title.is_empty() {
                    return Err(format!("Row {line_number}: position_title is required."));
                }

                let department_id = [&department_name_value, &department_code_value]
                    .iter()
                    .map(|v| normalize_lookup_key(v))
                    .find_map(|k| department_lookup.get(&k).copied())
                    .ok_or_else(|| {
                        format!(
                            "Row {line_number}: Unable to resolve department from '{}' / '{}'.",
                            department_name_value, department_code_value
                        )
                    })?;

                tx.execute(
                    "INSERT INTO employees (person_id, department_id, position_title) VALUES (?1, ?2, ?3)",
                    params![person_id, department_id, position_title],
                )
                .map_err(|e| e.to_string())?;
            }

            tx.commit().map_err(|e| e.to_string())?;
            Ok(())
        })();

        match row_result {
            Ok(()) => {
                success_count += 1;
                imported_ids.push(id_number);
            }
            Err(err) => {
                failed_count += 1;
                error_logs.push(err);
            }
        }
    }

    if success_count > 0 {
        let role_label = match role {
            "student" => "Student",
            "professor" => "Professor",
            "staff" => "Staff",
            _ => "User",
        };
        let summary = format!("Bulk Imported {} {} Profiles via Excel.", success_count, role_label);
        let _ = log_audit_action(
            pool,
            active_admin_id,
            "INSERT",
            "persons",
            0,
            None,
            Some(
                json!({
                    "summary": summary,
                    "role": role,
                    "count": success_count,
                    "id_numbers": imported_ids
                })
                .to_string(),
            ),
        );
    }

    Ok(BulkImportResult {
        success_count,
        failed_count,
        imported_ids,
        error_logs,
    })
}

pub fn update_user(
    pool: &DbPool,
    person_id: i64,
    role: &str,
    id_number: &str,
    first_name: &str,
    middle_name: Option<String>,
    last_name: &str,
    email: Option<String>,
    contact_number: Option<String>,
    program_id: Option<i64>,
    year_level: Option<i64>,
    department_id: Option<i64>,
    position_title: Option<String>,
    purpose: Option<String>,
    person_to_visit: Option<String>,
    active_admin_id: i64,
) -> Result<(), String> {
    let mut conn = pool.get().map_err(|e| e.to_string())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    let old_data: Option<serde_json::Value> = tx.query_row(
        "SELECT id_number, first_name, middle_name, last_name, email, contact_number, role
         FROM persons WHERE person_id = ?1",
        params![person_id],
        |row| {
           Ok(json!({
               "id_number": row.get::<_, String>(0)?,
               "first_name": row.get::<_, String>(1)?,
               "middle_name": row.get::<_, Option<String>>(2)?,
               "last_name": row.get::<_, String>(3)?,
               "email": row.get::<_, Option<String>>(4)?,
               "contact_number": row.get::<_, Option<String>>(5)?,
               "role": row.get::<_, String>(6)?
           }))
        }
    ).ok();

    tx.execute(
        "UPDATE persons
         SET id_number = ?1, first_name = ?2, middle_name = ?3, last_name = ?4, email = ?5, contact_number = ?6
         WHERE person_id = ?7",
        params![id_number, first_name, middle_name, last_name, email, contact_number, person_id],
    ).map_err(|e| e.to_string())?;

    match role {
        "student" => {
            tx.execute(
                "UPDATE students SET program_id = ?1, year_level = ?2 WHERE person_id = ?3",
                params![program_id.unwrap_or(1), year_level, person_id],
            )
            .map_err(|e| e.to_string())?;
        }
        "professor" | "staff" => {
            tx.execute(
                "UPDATE employees SET department_id = ?1, position_title = ?2 WHERE person_id = ?3",
                params![
                    department_id.unwrap_or(1),
                    position_title.unwrap_or_default(),
                    person_id
                ],
            )
            .map_err(|e| e.to_string())?;
        }
        "visitor" => {
            tx.execute(
                "UPDATE visitors SET purpose_of_visit = ?1, person_to_visit = ?2 WHERE person_id = ?3",
                params![purpose.unwrap_or_default(), person_to_visit.unwrap_or_default(), person_id],
            ).map_err(|e| e.to_string())?;
        }
        _ => return Err("Invalid role specified".to_string()),
    }

    tx.commit().map_err(|e| e.to_string())?;

    let new_data = json!({
        "id_number": id_number,
        "first_name": first_name,
        "middle_name": middle_name,
        "last_name": last_name,
        "email": email,
        "contact_number": contact_number,
        "role": role
    });

    let _ = log_audit_action(
        pool,
        active_admin_id,
        "UPDATE",
        "persons",
        person_id,
        old_data.map(|v| v.to_string()),
        Some(new_data.to_string()),
    );

    Ok(())
}

pub fn delete_user(pool: &DbPool, person_id: i64, role: &str, active_admin_id: i64) -> Result<(), String> {
    let mut conn = pool.get().map_err(|e| e.to_string())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    let old_data: Option<serde_json::Value> = tx.query_row(
        "SELECT id_number, first_name, middle_name, last_name, email, contact_number, role
         FROM persons WHERE person_id = ?1",
        params![person_id],
        |row| {
           Ok(json!({
               "id_number": row.get::<_, String>(0)?,
               "first_name": row.get::<_, String>(1)?,
               "middle_name": row.get::<_, Option<String>>(2)?,
               "last_name": row.get::<_, String>(3)?,
               "email": row.get::<_, Option<String>>(4)?,
               "contact_number": row.get::<_, Option<String>>(5)?,
               "role": row.get::<_, String>(6)?
           }))
        }
    ).ok();

    match role {
        "student" => {
            tx.execute(
                "DELETE FROM students WHERE person_id = ?1",
                params![person_id],
            )
            .map_err(|e| e.to_string())?;
        }
        "professor" | "staff" => {
            tx.execute(
                "DELETE FROM employees WHERE person_id = ?1",
                params![person_id],
            )
            .map_err(|e| e.to_string())?;
        }
        "visitor" => {
            tx.execute(
                "DELETE FROM visitors WHERE person_id = ?1",
                params![person_id],
            )
            .map_err(|e| e.to_string())?;
        }
        _ => return Err("Invalid role specified".to_string()),
    }

    // Also delete entry logs
    tx.execute(
        "DELETE FROM entry_logs WHERE person_id = ?1",
        params![person_id],
    )
    .map_err(|e| e.to_string())?;

    // Finally delete from persons
    tx.execute(
        "DELETE FROM persons WHERE person_id = ?1",
        params![person_id],
    )
    .map_err(|e| e.to_string())?;

    tx.commit().map_err(|e| e.to_string())?;

    let _ = log_audit_action(
        pool,
        active_admin_id,
        "DELETE",
        "persons",
        person_id,
        old_data.map(|v| v.to_string()),
        None,
    );

    Ok(())
}

pub fn get_employees(pool: &DbPool) -> Result<Vec<EmployeeDetails>, String> {
    let conn = pool.get().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare(
        "SELECT p.person_id, p.id_number, p.first_name, p.middle_name, p.last_name, p.email, p.contact_number, p.is_active,
                e.department_id, e.position_title, d.department_name
         FROM persons p
         JOIN employees e ON p.person_id = e.person_id
         JOIN departments d ON e.department_id = d.department_id"
    ).map_err(|e| e.to_string())?;

    let iter = stmt
        .query_map([], |row| {
            Ok(EmployeeDetails {
                person_id: row.get(0)?,
                id_number: row.get(1)?,
                first_name: row.get(2)?,
                middle_name: row.get(3).unwrap_or(None),
                last_name: row.get(4)?,
                email: row.get(5).unwrap_or(None),
                contact_number: row.get(6).unwrap_or(None),
                is_active: row.get::<_, i32>(7)? == 1,
                department_id: row.get(8)?,
                position_title: row.get(9)?,
                department_name: row.get(10)?,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut list = Vec::new();
    for item in iter {
        list.push(item.map_err(|e| e.to_string())?);
    }
    Ok(list)
}

pub fn get_visitors(pool: &DbPool, sort_order: Option<String>) -> Result<Vec<VisitorDetails>, String> {
    let conn = pool.get().map_err(|e| e.to_string())?;
    let order_direction = match sort_order
        .unwrap_or_else(|| "desc".to_string())
        .to_ascii_lowercase()
        .as_str()
    {
        "asc" => "ASC",
        _ => "DESC",
    };

    // Simplistic approach: get the first entry today as time_in, and the last exit today as time_out
    let query = format!(
        "SELECT p.person_id, p.id_number, p.first_name, p.middle_name, p.last_name, p.email, p.contact_number, v.purpose_of_visit, v.person_to_visit, p.created_at,
            (SELECT MIN(e.scanned_at) FROM entry_logs e JOIN scanners s ON e.scanner_id = s.scanner_id WHERE e.person_id = p.person_id AND s.function = 'entrance') as time_in,
            (SELECT MAX(e.scanned_at) FROM entry_logs e JOIN scanners s ON e.scanner_id = s.scanner_id WHERE e.person_id = p.person_id AND s.function = 'exit') as time_out
         FROM persons p
         JOIN visitors v ON p.person_id = v.person_id
         WHERE p.role = 'visitor'
         ORDER BY p.created_at {order_direction}"
    );

    let mut stmt = conn.prepare(
        &query
    ).map_err(|e| e.to_string())?;

    let iter = stmt
        .query_map([], |row| {
            Ok(VisitorDetails {
                person_id: row.get(0)?,
                id_number: row.get(1)?,
                first_name: row.get(2)?,
                middle_name: row.get(3).unwrap_or(None),
                last_name: row.get(4)?,
                email: row.get(5).unwrap_or(None),
                contact_number: row.get(6).unwrap_or(None),
                purpose_of_visit: row.get(7)?,
                person_to_visit: row.get(8)?,
                created_at: row.get(9).unwrap_or(None),
                time_in: row.get(10).unwrap_or(None),
                time_out: row.get(11).unwrap_or(None),
            })
        })
        .map_err(|e| e.to_string())?;

    let mut list = Vec::new();
    for item in iter {
        list.push(item.map_err(|e| e.to_string())?);
    }
    Ok(list)
}

// ------ Hardware & Events CRUD Operations ------

pub fn add_scanner(pool: &DbPool, scanner: Scanner, active_admin_id: i64) -> Result<i64, String> {
    let conn = pool.get().map_err(|e| e.to_string())?;

    conn.execute(
        "INSERT INTO scanners (location_name, function)
         VALUES (?1, ?2)",
        params![scanner.location_name, scanner.function],
    )
    .map_err(|e| e.to_string())?;

    let target_id = conn.last_insert_rowid();

    let _ = log_audit_action(
        pool,
        active_admin_id,
        "INSERT",
        "scanners",
        target_id,
        None,
        Some(json!({
            "location_name": scanner.location_name,
            "function": scanner.function
        }).to_string()),
    );

    Ok(target_id)
}

pub fn get_scanners(pool: &DbPool) -> Result<Vec<Scanner>, String> {
    let conn = pool.get().map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare("SELECT scanner_id, location_name, function FROM scanners")
        .map_err(|e| e.to_string())?;

    let iter = stmt
        .query_map([], |row| {
            Ok(Scanner {
                scanner_id: row.get(0)?,
                location_name: row.get(1)?,
                function: row.get(2)?,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut list = Vec::new();
    for item in iter {
        list.push(item.map_err(|e| e.to_string())?);
    }

    Ok(list)
}

pub fn get_access_logs(
    pool: &DbPool,
    role_filter: Option<String>,
    action_type: Option<String>,
    location_name: Option<String>,
    search_term: Option<String>,
    start_date: Option<String>,
    end_date: Option<String>,
) -> Result<Vec<AccessLogDetails>, String> {
    let conn = pool.get().map_err(|e| e.to_string())?;

    let base_query = "
        SELECT l.log_id, l.scanned_at, p.first_name, p.last_name, p.id_number, p.role, s.location_name, s.function
        FROM entry_logs l
        JOIN persons p ON l.person_id = p.person_id
        JOIN scanners s ON l.scanner_id = s.scanner_id
        WHERE 1=1
        AND (?1 IS NULL OR p.role = ?1)
        AND (?2 IS NULL OR s.function = ?2)
        AND (?3 IS NULL OR s.location_name = ?3)
        AND (?4 IS NULL OR p.first_name LIKE '%' || ?4 || '%' OR p.last_name LIKE '%' || ?4 || '%' OR p.id_number LIKE '%' || ?4 || '%')
        AND (?5 IS NULL OR DATE(l.scanned_at) >= DATE(?5))
        AND (?6 IS NULL OR DATE(l.scanned_at) <= DATE(?6))
        ORDER BY l.scanned_at DESC LIMIT 100
    ";

    let mut stmt = conn.prepare(&base_query).map_err(|e| e.to_string())?;

    let mut list = Vec::new();

    let iter = stmt
        .query_map(
            params![
                role_filter,
                action_type,
                location_name,
                search_term,
                start_date,
                end_date
            ],
            |row| {
                let first_name: String = row.get(2)?;
                let last_name: String = row.get(3)?;
                Ok(AccessLogDetails {
                    log_id: row.get(0)?,
                    scanned_at: row.get(1)?,
                    person_name: format!("{} {}", first_name, last_name),
                    id_number: row.get(4)?,
                    role: row.get(5)?,
                    scanner_location: row.get(6)?,
                    scanner_function: row.get(7)?,
                })
            },
        )
        .map_err(|e| e.to_string())?;

    for item in iter {
        list.push(item.map_err(|e| e.to_string())?);
    }
    Ok(list)
}

pub fn get_event_attendance_logs(
    pool: &DbPool,
    start_date: Option<String>,
    end_date: Option<String>,
) -> Result<Vec<EventAttendanceLog>, String> {
    let conn = pool.get().map_err(|e| e.to_string())?;

    let mut base_query = "
        SELECT a.attendance_id, p.first_name, p.last_name, p.id_number, p.role, e.event_name, a.scanned_at
        FROM event_attendance a
        JOIN persons p ON a.person_id = p.person_id
        JOIN events e ON a.event_id = e.event_id
    ".to_string();

    if start_date.is_some() && end_date.is_some() {
        base_query.push_str(" WHERE DATE(a.scanned_at) BETWEEN DATE(?1) AND DATE(?2)");
    } else if start_date.is_some() {
        base_query.push_str(" WHERE DATE(a.scanned_at) >= DATE(?1)");
    } else if end_date.is_some() {
        base_query.push_str(" WHERE DATE(a.scanned_at) <= DATE(?1)");
    }

    base_query.push_str(" ORDER BY a.scanned_at DESC LIMIT 100");

    let mut stmt = conn.prepare(&base_query).map_err(|e| e.to_string())?;

    let mut list = Vec::new();

    if let (Some(start), Some(end)) = (&start_date, &end_date) {
        let iter = stmt
            .query_map(params![start, end], |row| {
                let first_name: String = row.get(1)?;
                let last_name: String = row.get(2)?;
                Ok(EventAttendanceLog {
                    log_id: row.get(0)?,
                    person_name: format!("{} {}", first_name, last_name),
                    id_number: row.get(3)?,
                    role: row.get(4)?,
                    event_name: row.get(5)?,
                    scanned_at: row.get(6)?,
                })
            })
            .map_err(|e| e.to_string())?;
        for item in iter {
            list.push(item.map_err(|e| e.to_string())?);
        }
    } else if let Some(date) = start_date.or(end_date) {
        let iter = stmt
            .query_map(params![date], |row| {
                let first_name: String = row.get(1)?;
                let last_name: String = row.get(2)?;
                Ok(EventAttendanceLog {
                    log_id: row.get(0)?,
                    person_name: format!("{} {}", first_name, last_name),
                    id_number: row.get(3)?,
                    role: row.get(4)?,
                    event_name: row.get(5)?,
                    scanned_at: row.get(6)?,
                })
            })
            .map_err(|e| e.to_string())?;
        for item in iter {
            list.push(item.map_err(|e| e.to_string())?);
        }
    } else {
        let iter = stmt
            .query_map([], |row| {
                let first_name: String = row.get(1)?;
                let last_name: String = row.get(2)?;
                Ok(EventAttendanceLog {
                    log_id: row.get(0)?,
                    person_name: format!("{} {}", first_name, last_name),
                    id_number: row.get(3)?,
                    role: row.get(4)?,
                    event_name: row.get(5)?,
                    scanned_at: row.get(6)?,
                })
            })
            .map_err(|e| e.to_string())?;
        for item in iter {
            list.push(item.map_err(|e| e.to_string())?);
        }
    }

    Ok(list)
}

pub fn add_event(pool: &DbPool, event: Event, active_admin_id: i64) -> Result<i64, String> {
    let conn = pool.get().map_err(|e| e.to_string())?;

    let is_enabled = if event.is_enabled { 1 } else { 0 };

    conn.execute(
        "INSERT INTO events (event_name, schedule_type, event_date, start_date, end_date, start_time, end_time, required_role, is_enabled)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![
            event.event_name,
            event.schedule_type,
            event.event_date,
            event.start_date,
            event.end_date,
            event.start_time,
            event.end_time,
            event.required_role,
            is_enabled
        ],
    ).map_err(|e| e.to_string())?;

    let target_id = conn.last_insert_rowid();

    let _ = log_audit_action(
        pool,
        active_admin_id,
        "INSERT",
        "events",
        target_id,
        None,
        Some(json!({
            "event_name": event.event_name,
            "event_date": event.event_date
        }).to_string()),
    );

    Ok(target_id)
}

pub fn get_events(pool: &DbPool) -> Result<Vec<Event>, String> {
    let conn = pool.get().map_err(|e| e.to_string())?;

    let mut stmt = conn.prepare("SELECT event_id, event_name, schedule_type, event_date, start_date, end_date, start_time, end_time, required_role, is_enabled FROM events")
        .map_err(|e| e.to_string())?;

    let iter = stmt
        .query_map([], |row| {
            Ok(Event {
                event_id: row.get(0)?,
                event_name: row.get(1)?,
                schedule_type: row.get(2)?,
                event_date: row.get(3)?,
                start_date: row.get(4)?,
                end_date: row.get(5)?,
                start_time: row.get(6)?,
                end_time: row.get(7)?,
                required_role: row.get(8)?,
                is_enabled: row.get::<_, i32>(9)? == 1,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut list = Vec::new();
    for item in iter {
        list.push(item.map_err(|e| e.to_string())?);
    }

    Ok(list)
}

pub fn update_event(pool: &DbPool, event_id: i64, event: Event, active_admin_id: i64) -> Result<(), String> {
    let conn = pool.get().map_err(|e| e.to_string())?;

    let old_data: Option<serde_json::Value> = conn.query_row(
        "SELECT event_name, schedule_type, event_date, start_date, end_date, start_time, end_time, required_role, is_enabled FROM events WHERE event_id = ?1",
        params![event_id],
        |row| {
           Ok(json!({
               "event_name": row.get::<_, String>(0)?,
               "schedule_type": row.get::<_, String>(1)?,
               "event_date": row.get::<_, Option<String>>(2)?,
               "start_date": row.get::<_, Option<String>>(3)?,
               "end_date": row.get::<_, Option<String>>(4)?,
               "start_time": row.get::<_, String>(5)?,
               "end_time": row.get::<_, String>(6)?,
               "required_role": row.get::<_, String>(7)?,
               "is_enabled": row.get::<_, i32>(8)? == 1
           }))
        }
    ).ok();

    let is_enabled = if event.is_enabled { 1 } else { 0 };

    conn.execute(
        "UPDATE events SET event_name = ?1, schedule_type = ?2, event_date = ?3, start_date = ?4, end_date = ?5, start_time = ?6, end_time = ?7, required_role = ?8, is_enabled = ?9 WHERE event_id = ?10",
        params![
            event.event_name,
            event.schedule_type,
            event.event_date,
            event.start_date,
            event.end_date,
            event.start_time,
            event.end_time,
            event.required_role,
            is_enabled,
            event_id
        ],
    ).map_err(|e| e.to_string())?;

    let new_data = json!({
        "event_name": event.event_name,
        "schedule_type": event.schedule_type,
        "event_date": event.event_date,
        "start_date": event.start_date,
        "end_date": event.end_date,
        "start_time": event.start_time,
        "end_time": event.end_time,
        "required_role": event.required_role,
        "is_enabled": event.is_enabled
    });

    let _ = log_audit_action(
        pool,
        active_admin_id,
        "UPDATE",
        "events",
        event_id,
        old_data.map(|v| v.to_string()),
        Some(new_data.to_string()),
    );

    Ok(())
}

pub fn delete_event(pool: &DbPool, event_id: i64, active_admin_id: i64) -> Result<(), String> {
    let conn = pool.get().map_err(|e| e.to_string())?;

    let old_data: Option<serde_json::Value> = conn.query_row(
        "SELECT event_name, schedule_type, event_date, start_date, end_date, start_time, end_time, required_role, is_enabled FROM events WHERE event_id = ?1",
        params![event_id],
        |row| {
           Ok(json!({
               "event_name": row.get::<_, String>(0)?,
               "schedule_type": row.get::<_, String>(1)?,
               "event_date": row.get::<_, Option<String>>(2)?,
               "start_date": row.get::<_, Option<String>>(3)?,
               "end_date": row.get::<_, Option<String>>(4)?,
               "start_time": row.get::<_, String>(5)?,
               "end_time": row.get::<_, String>(6)?,
               "required_role": row.get::<_, String>(7)?,
               "is_enabled": row.get::<_, i32>(8)? == 1
           }))
        }
    ).ok();

    conn.execute("DELETE FROM events WHERE event_id = ?1", params![event_id])
        .map_err(|e| e.to_string())?;

    let _ = log_audit_action(
        pool,
        active_admin_id,
        "DELETE",
        "events",
        event_id,
        old_data.map(|v| v.to_string()),
        None,
    );

    Ok(())
}

// ------ Access Logging & Business Rules ------

pub fn log_entry(pool: &DbPool, scanner_id: i64, person_id: i64) -> Result<ScanResult, String> {
    let conn = pool.get().map_err(|e| e.to_string())?;

    // 1. Check if person exists and is active
    let mut stmt = conn.prepare("SELECT first_name, last_name, role, is_active, DATE(created_at, 'localtime') == DATE('now', 'localtime') as is_created_today FROM persons WHERE person_id = ?1")
        .map_err(|e| e.to_string())?;

    let mut person_iter = stmt
        .query_map(params![person_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, i32>(3)? == 1,
                row.get::<_, i32>(4)? == 1,
            ))
        })
        .map_err(|e| e.to_string())?;

    let person_data = person_iter.next();

    if let Some(Ok((first_name, last_name, role, is_active, is_created_today))) = person_data {
        if !is_active {
            return Ok(ScanResult {
                success: false,
                message: "Access Denied: ID is inactive.".to_string(),
                person_name: Some(format!("{} {}", first_name, last_name)),
                role: Some(role),
            });
        }

        // 2a. Check previous log to validate Entry/Exit sequence
        // We need to know what kind of scanner this is (Entrance or Exit)
        let scanner_function: String = conn
            .query_row(
                "SELECT function FROM scanners WHERE scanner_id = ?1",
                params![scanner_id],
                |row| row.get(0),
            )
            .map_err(|e| e.to_string())?;

        // Get the latest log for this person
        let last_log_function: Option<String> = conn
            .query_row(
                "SELECT s.function FROM entry_logs e 
             JOIN scanners s ON e.scanner_id = s.scanner_id 
             WHERE e.person_id = ?1 
             ORDER BY e.scanned_at DESC LIMIT 1",
                params![person_id],
                |row| row.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?;

        // Logic Re-Check
        if scanner_function == "exit" {
            // Can only exit if the last log was 'entrance'.
            // If no logs (None) or last was 'exit', deny.
            match last_log_function.as_deref() {
                Some("entrance") => {
                    // Valid exit
                }
                _ => {
                    return Ok(ScanResult {
                        success: false,
                        message: "No entry record found for this ID".to_string(),
                        person_name: Some(format!("{} {}", first_name, last_name)),
                        role: Some(role),
                    });
                }
            }
        } else if scanner_function == "entrance" {
            // Visitor Expiration Check
            if role == "visitor" && !is_created_today {
                return Ok(ScanResult {
                     success: false,
                     message: "Access Denied: This Visitor Pass expired at 11:59 PM yesterday. Please re-register.".to_string(),
                     person_name: Some(format!("{} {}", first_name, last_name)),
                     role: Some(role),
                 });
            }

            // Prevent double entry
            match last_log_function.as_deref() {
                Some("entrance") => {
                    return Ok(ScanResult {
                        success: false,
                        message: "User is already on campus".to_string(),
                        person_name: Some(format!("{} {}", first_name, last_name)),
                        role: Some(role),
                    });
                }
                _ => {
                    // Valid entrance
                }
            }
        }

        // 2b. Insert into entry_logs
        let now = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
        conn.execute(
            "INSERT INTO entry_logs (person_id, scanner_id, scanned_at) VALUES (?1, ?2, ?3)",
            params![person_id, scanner_id, now],
        )
        .map_err(|e| e.to_string())?;

        // 2c. Visitor Exit Destruction
        if scanner_function == "exit" && role == "visitor" {
            let _ = conn.execute(
                "UPDATE persons SET is_active = 0 WHERE person_id = ?1",
                params![person_id],
            );
        }

        Ok(ScanResult {
            success: true,
            message: format!(
                "{} Successful.",
                if scanner_function == "entrance" {
                    "Entry"
                } else {
                    "Exit"
                }
            ),
            person_name: Some(format!("{} {}", first_name, last_name)),
            role: Some(role),
        })
    } else {
        Ok(ScanResult {
            success: false,
            message: "Access Denied: ID not found.".to_string(),
            person_name: None,
            role: None,
        })
    }
}

pub fn manual_id_entry(
    pool: &DbPool,
    id_number: &str,
    scanner_function: &str,
) -> Result<ScanResult, String> {
    let conn = pool.get().map_err(|e| e.to_string())?;

    let mut stmt = conn.prepare("SELECT person_id, first_name, last_name, role, is_active, DATE(created_at, 'localtime') == DATE('now', 'localtime') as is_created_today FROM persons WHERE id_number = ?1")
        .map_err(|e| e.to_string())?;

    let mut person_iter = stmt
        .query_map(params![id_number], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, i32>(4)? == 1,
                row.get::<_, i32>(5)? == 1,
            ))
        })
        .map_err(|e| e.to_string())?;

    let person_data = person_iter.next();

    if let Some(Ok((person_id, first_name, last_name, role, is_active, is_created_today))) =
        person_data
    {
        if !is_active {
            return Ok(ScanResult {
                success: false,
                message: "Access Denied: ID is inactive.".to_string(),
                person_name: Some(format!("{} {}", first_name, last_name)),
                role: Some(role),
            });
        }

        // Find an appropriate scanner ID for logging (mocking based on function)
        let scanner_id: i64 = conn
            .query_row(
                "SELECT scanner_id FROM scanners WHERE function = ?1 LIMIT 1",
                params![scanner_function],
                |row| row.get(0),
            )
            .unwrap_or(1); // Default to 1 if none found

        // Validation Logic for Manual Entry
        let last_log_function: Option<String> = conn
            .query_row(
                "SELECT s.function FROM entry_logs e 
             JOIN scanners s ON e.scanner_id = s.scanner_id 
             WHERE e.person_id = ?1 
             ORDER BY e.scanned_at DESC LIMIT 1",
                params![person_id],
                |row| row.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?;

        if scanner_function == "exit" {
            match last_log_function.as_deref() {
                Some("entrance") => { /* Valid */ }
                _ => {
                    return Ok(ScanResult {
                        success: false,
                        message: "No entry record found for this ID".to_string(),
                        person_name: Some(format!("{} {}", first_name, last_name)),
                        role: Some(role),
                    });
                }
            }
        } else if scanner_function == "entrance" {
            // Visitor Expiration Check
            if role == "visitor" && !is_created_today {
                return Ok(ScanResult {
                     success: false,
                     message: "Access Denied: This Visitor Pass expired at 11:59 PM yesterday. Please re-register.".to_string(),
                     person_name: Some(format!("{} {}", first_name, last_name)),
                     role: Some(role),
                 });
            }

            match last_log_function.as_deref() {
                Some("entrance") => {
                    return Ok(ScanResult {
                        success: false,
                        message: "User is already on campus".to_string(),
                        person_name: Some(format!("{} {}", first_name, last_name)),
                        role: Some(role),
                    });
                }
                _ => { /* Valid */ }
            }
        }

        let now = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
        conn.execute(
            "INSERT INTO entry_logs (person_id, scanner_id, scanned_at) VALUES (?1, ?2, ?3)",
            params![person_id, scanner_id, now],
        )
        .map_err(|e| e.to_string())?;

        // Visitor Exit Destruction
        if scanner_function == "exit" && role == "visitor" {
            let _ = conn.execute(
                "UPDATE persons SET is_active = 0 WHERE person_id = ?1",
                params![person_id],
            );
        }

        Ok(ScanResult {
            success: true,
            message: format!(
                "Manual {} Successful.",
                if scanner_function == "entrance" {
                    "Entry"
                } else {
                    "Exit"
                }
            ),
            person_name: Some(format!("{} {}", first_name, last_name)),
            role: Some(role),
        })
    } else {
        Ok(ScanResult {
            success: false,
            message: "Access Denied: Record not found in database.".to_string(),
            person_name: None,
            role: None,
        })
    }
}

pub fn log_audit_action(
    pool: &DbPool,
    admin_id: i64,
    action_type: &str,
    target_table: &str,
    target_id: i64,
    old_values: Option<String>,
    new_values: Option<String>,
) -> Result<(), String> {
    if action_type == "UPDATE" {
        if let (Some(old_str), Some(new_str)) = (&old_values, &new_values) {
            if let (Ok(old_val), Ok(new_val)) = (
                serde_json::from_str::<serde_json::Value>(old_str),
                serde_json::from_str::<serde_json::Value>(new_str),
            ) {
                if let (Some(old_obj), Some(new_obj)) = (old_val.as_object(), new_val.as_object()) {
                    let mut has_changes = false;
                    for (k, v) in new_obj.iter() {
                        if old_obj.get(k) != Some(v) {
                            has_changes = true;
                            break;
                        }
                    }
                    if !has_changes {
                        return Ok(()); // Skip logging empty changes
                    }
                }
            }
        }
    }

    let conn = pool.get().map_err(|e| e.to_string())?;

    conn.execute(
        "INSERT INTO audit_logs (admin_id, action_type, target_table, target_id, old_values, new_values) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![admin_id, action_type, target_table, target_id, old_values, new_values],
    ).map_err(|e| e.to_string())?;

    Ok(())
}

pub fn get_audit_logs(
    pool: &DbPool,
    start_date: Option<String>,
    end_date: Option<String>,
) -> Result<Vec<AuditLogDetails>, String> {
    let conn = pool.get().map_err(|e| e.to_string())?;

    let mut base_query = "
        SELECT a.audit_id, a.admin_id, acc.username, acc.full_name, a.action_type, a.target_table, a.target_id, a.old_values, a.new_values, a.created_at 
        FROM audit_logs a
        LEFT JOIN accounts acc ON a.admin_id = acc.account_id
    ".to_string();

    if start_date.is_some() && end_date.is_some() {
        base_query.push_str(" WHERE DATE(a.created_at) BETWEEN DATE(?1) AND DATE(?2)");
    } else if start_date.is_some() {
        base_query.push_str(" WHERE DATE(a.created_at) >= DATE(?1)");
    } else if end_date.is_some() {
        base_query.push_str(" WHERE DATE(a.created_at) <= DATE(?1)");
    }

    base_query.push_str(" ORDER BY a.created_at DESC");

    let mut stmt = conn.prepare(&base_query).map_err(|e| e.to_string())?;

    let mut logs = Vec::new();

    let map_row = |row: &rusqlite::Row| -> rusqlite::Result<AuditLogDetails> {
        Ok(AuditLogDetails {
            audit_id: row.get(0)?,
            admin_id: row.get(1)?,
            admin_username: row
                .get::<_, Option<String>>(2)?
                .unwrap_or_else(|| "Unknown".to_string()),
            admin_full_name: row
                .get::<_, Option<String>>(3)?
                .unwrap_or_else(|| "Unknown Administrator".to_string()),
            action_type: row.get(4)?,
            target_table: row.get(5)?,
            target_id: row.get(6)?,
            old_values: row.get(7)?,
            new_values: row.get(8)?,
            created_at: row.get(9)?,
        })
    };

    if let (Some(start), Some(end)) = (&start_date, &end_date) {
        let iter = stmt
            .query_map(params![start, end], map_row)
            .map_err(|e| e.to_string())?;
        for log in iter {
            if let Ok(l) = log {
                logs.push(l);
            }
        }
    } else if let Some(date) = start_date.or(end_date) {
        let iter = stmt
            .query_map(params![date], map_row)
            .map_err(|e| e.to_string())?;
        for log in iter {
            if let Ok(l) = log {
                logs.push(l);
            }
        }
    } else {
        let iter = stmt
            .query_map([], map_row)
            .map_err(|e| e.to_string())?;
        for log in iter {
            if let Ok(l) = log {
                logs.push(l);
            }
        }
    }

    Ok(logs)

}

// ------ Admin Dashboard & Auth ------

pub fn admin_login(
    pool: &DbPool,
    username: &str,
    password: &str,
) -> Result<AdminLoginResponse, String> {
    let conn = pool.get().map_err(|e| e.to_string())?;

    let mut stmt = conn.prepare("SELECT account_id, password_hash, full_name, email, role, is_first_login, created_at FROM accounts WHERE username = ?1")
        .map_err(|e| e.to_string())?;

    let mut rows = stmt.query(params![username]).map_err(|e| e.to_string())?;

    if let Some(row) = rows.next().map_err(|e| e.to_string())? {
        let account_id: i64 = row.get(0).map_err(|e| e.to_string())?;
        let stored_hash: String = row.get(1).map_err(|e| e.to_string())?;
        let full_name: String = row.get(2).map_err(|e| e.to_string())?;
        let email: Option<String> = row.get(3).map_err(|e| e.to_string())?;
        let role: String = row.get(4).map_err(|e| e.to_string())?;
        let is_first_login: bool = row.get::<_, i32>(5).map_err(|e| e.to_string())? == 1;
        let created_at: String = row.get(6).map_err(|e| e.to_string())?;

        if stored_hash == password {
            let masked_email = email
                .as_deref()
                .filter(|value| !value.trim().is_empty())
                .map(mask_email);

            return Ok(AdminLoginResponse {
                success: true,
                message: if is_first_login {
                    "Temporary password verified. Account activation is required.".to_string()
                } else {
                    "Login successful".to_string()
                },
                requires_activation: is_first_login,
                masked_email,
                account: Some(AdminAccount {
                    account_id,
                    username: username.to_string(),
                    full_name,
                    email,
                    role,
                    is_first_login,
                    created_at,
                }),
            });
        }
    }

    Ok(AdminLoginResponse {
        success: false,
        message: "Invalid credentials".to_string(),
        requires_activation: false,
        masked_email: None,
        account: None,
    })
}

pub fn update_admin_credentials(
    pool: &DbPool,
    account_id: i64,
    current_password: &str,
    new_password: &str,
) -> Result<bool, String> {
    let conn = pool.get().map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare("SELECT password_hash FROM accounts WHERE account_id = ?1")
        .map_err(|e| e.to_string())?;

    let mut rows = stmt.query(params![account_id]).map_err(|e| e.to_string())?;

    if let Some(row) = rows.next().map_err(|e| e.to_string())? {
        let stored_hash: String = row.get(0).map_err(|e| e.to_string())?;
        if stored_hash == current_password {
            conn.execute(
                "UPDATE accounts
                 SET password_hash = ?1,
                     is_first_login = 0,
                     activation_otp = NULL,
                     activation_otp_expires_at = NULL
                 WHERE account_id = ?2",
                params![new_password, account_id],
            )
            .map_err(|e| e.to_string())?;
            return Ok(true);
        }
    }

    Ok(false)
}

pub fn get_admin_accounts(pool: &DbPool) -> Result<Vec<AdminAccount>, String> {
    let conn = pool.get().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare("SELECT account_id, username, full_name, email, role, is_first_login, created_at FROM accounts ORDER BY created_at DESC, username ASC")
        .map_err(|e| e.to_string())?;

    let iter = stmt
        .query_map([], |row| {
            Ok(AdminAccount {
                account_id: row.get(0)?,
                username: row.get(1)?,
                full_name: row.get(2)?,
                email: row.get(3)?,
                role: row.get(4)?,
                is_first_login: row.get::<_, i32>(5)? == 1,
                created_at: row.get(6)?,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut list = Vec::new();
    for item in iter {
        list.push(item.map_err(|e| e.to_string())?);
    }
    Ok(list)
}

pub fn add_admin_account(
    pool: &DbPool,
    username: &str,
    password: &str,
    full_name: &str,
    email: &str,
    role: &str,
    active_admin_id: i64,
) -> Result<i64, String> {
    let username = username.trim();
    let full_name = full_name.trim();
    let email = email.trim();
    let normalized_password = if role == "Gate Supervisor" {
        generate_gate_supervisor_password(full_name)
    } else {
        password.trim().to_string()
    };

    if username.is_empty() || full_name.is_empty() || normalized_password.is_empty() {
        return Err("Username, full name, and temporary password are required.".to_string());
    }

    if !is_valid_email(email) {
        return Err("A valid contact/notification email is required.".to_string());
    }

    let conn = pool.get().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO accounts (username, password_hash, full_name, email, role, is_first_login, activation_otp, activation_otp_expires_at)
         VALUES (?1, ?2, ?3, ?4, ?5, 1, NULL, NULL)",
        params![username, normalized_password, full_name, email, role],
    ).map_err(|e| e.to_string())?;
    let target_id = conn.last_insert_rowid();

    let _ = log_audit_action(
        pool, 
        active_admin_id, 
        "INSERT", 
        "accounts", 
        target_id, 
        None, 
        Some(json!({
            "username": username,
            "full_name": full_name,
            "email": email,
            "role": role
        }).to_string())
    );
    Ok(target_id)
}

pub fn update_admin_role(
    pool: &DbPool,
    account_id: i64,
    new_role: &str,
    active_admin_id: i64,
) -> Result<(), String> {
    let conn = pool.get().map_err(|e| e.to_string())?;

    let old_role: String = conn.query_row(
        "SELECT role FROM accounts WHERE account_id = ?1", 
        params![account_id], 
        |row| row.get(0)
    ).unwrap_or_else(|_| "Unknown".to_string());

    conn.execute(
        "UPDATE accounts SET role = ?1 WHERE account_id = ?2",
        params![new_role, account_id],
    )
    .map_err(|e| e.to_string())?;

    let _ = log_audit_action(
        pool, 
        active_admin_id, 
        "UPDATE", 
        "accounts", 
        account_id, 
        Some(json!({"role": old_role}).to_string()), 
        Some(json!({"role": new_role}).to_string())
    );
    Ok(())
}

pub fn reset_admin_password(
    pool: &DbPool,
    account_id: i64,
    new_password: &str,
    active_admin_id: i64,
) -> Result<(), String> {
    let conn = pool.get().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE accounts
         SET password_hash = ?1,
             is_first_login = 1,
             activation_otp = NULL,
             activation_otp_expires_at = NULL
         WHERE account_id = ?2",
        params![new_password.trim(), account_id],
    )
    .map_err(|e| e.to_string())?;

    let _ = log_audit_action(
        pool, 
        active_admin_id, 
        "UPDATE", 
        "accounts", 
        account_id, 
        Some(json!({"password_hash": "(old)"}).to_string()), 
        Some(json!({"password_hash": "(new)"}).to_string())
    );
    Ok(())
}

pub fn update_admin_info(
    pool: &DbPool,
    account_id: i64,
    username: &str,
    full_name: &str,
    email: &str,
    active_admin_id: i64,
) -> Result<(), String> {
    let username = username.trim();
    let full_name = full_name.trim();
    let email = email.trim();

    if username.is_empty() || full_name.is_empty() {
        return Err("Username and full name are required.".to_string());
    }

    if !is_valid_email(email) {
        return Err("A valid contact/notification email is required.".to_string());
    }

    let conn = pool.get().map_err(|e| e.to_string())?;

    let (old_username, old_full_name, old_email): (String, String, Option<String>) = conn.query_row(
        "SELECT username, full_name, email FROM accounts WHERE account_id = ?1",
        params![account_id],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
    ).unwrap_or_default();

    conn.execute(
        "UPDATE accounts SET username = ?1, full_name = ?2, email = ?3 WHERE account_id = ?4",
        params![username, full_name, email, account_id],
    )
    .map_err(|e| e.to_string())?;

    let _ = log_audit_action(
        pool, 
        active_admin_id, 
        "UPDATE", 
        "accounts", 
        account_id, 
        Some(json!({
            "username": old_username,
            "full_name": old_full_name,
            "email": old_email
        }).to_string()), 
        Some(json!({
            "username": username,
            "full_name": full_name,
            "email": email
        }).to_string())
    );
    Ok(())
}

pub fn delete_admin_account(
    pool: &DbPool,
    account_id: i64,
    active_admin_id: i64,
) -> Result<(), String> {
    if account_id == active_admin_id {
        return Err("You cannot delete your own account.".to_string());
    }

    let conn = pool.get().map_err(|e| e.to_string())?;

    let active_role: Option<String> = conn
        .query_row(
            "SELECT role FROM accounts WHERE account_id = ?1",
            params![active_admin_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;

    if active_role.as_deref() != Some("System Administrator") {
        return Err("Only a System Administrator can delete administrator accounts.".to_string());
    }

    let target_role: Option<String> = conn
        .query_row(
            "SELECT role FROM accounts WHERE account_id = ?1",
            params![account_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;

    let Some(target_role) = target_role else {
        return Err("Account not found.".to_string());
    };

    if target_role == "System Administrator" {
        let system_admin_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM accounts WHERE role = 'System Administrator'",
                [],
                |row| row.get(0),
            )
            .map_err(|e| e.to_string())?;

        if system_admin_count <= 1 {
            return Err("The last System Administrator account cannot be deleted.".to_string());
        }
    }

    let deleted_username: String = conn.query_row(
        "SELECT username FROM accounts WHERE account_id = ?1", 
        params![account_id], 
        |row| row.get(0)
    ).unwrap_or_else(|_| "Unknown".to_string());

    conn.execute(
        "DELETE FROM accounts WHERE account_id = ?1",
        params![account_id],
    )
    .map_err(|e| e.to_string())?;

    let _ = log_audit_action(
        pool, 
        active_admin_id, 
        "DELETE", 
        "accounts", 
        account_id, 
        Some(json!({ "username": deleted_username }).to_string()), 
        None
    );
    Ok(())
}

pub(crate) fn create_first_login_challenge(
    pool: &DbPool,
    account_id: i64,
) -> Result<FirstLoginChallenge, String> {
    let conn = pool.get().map_err(|e| e.to_string())?;

    let account = conn
        .query_row(
            "SELECT account_id, username, full_name, email, role, is_first_login, created_at
         FROM accounts
         WHERE account_id = ?1",
            params![account_id],
            |row| {
                Ok(AdminAccount {
                    account_id: row.get(0)?,
                    username: row.get(1)?,
                    full_name: row.get(2)?,
                    email: row.get(3)?,
                    role: row.get(4)?,
                    is_first_login: row.get::<_, i32>(5)? == 1,
                    created_at: row.get(6)?,
                })
            },
        )
        .map_err(|_| "Account not found.".to_string())?;

    if !account.is_first_login {
        return Err("This account no longer requires first-login activation.".to_string());
    }

    let email = account
        .email
        .clone()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| {
            "No contact/notification email is configured for this account.".to_string()
        })?;

    if !is_valid_email(&email) {
        return Err("The stored contact/notification email is invalid.".to_string());
    }

    let otp_code = generate_six_digit_otp(account_id);
    let expires_at = (Local::now() + Duration::minutes(15))
        .format("%Y-%m-%d %H:%M:%S")
        .to_string();

    conn.execute(
        "UPDATE accounts
         SET activation_otp = ?1,
             activation_otp_expires_at = ?2
         WHERE account_id = ?3",
        params![otp_code, expires_at, account_id],
    )
    .map_err(|e| e.to_string())?;

    Ok(FirstLoginChallenge {
        account,
        email: email.clone(),
        otp_code,
        masked_email: mask_email(&email),
    })
}

pub fn activate_admin_first_login(
    pool: &DbPool,
    account_id: i64,
    otp_code: &str,
    new_password: &str,
    confirm_password: &str,
) -> Result<AdminActivationResponse, String> {
    let otp_code = otp_code.trim();
    let new_password = new_password.trim();
    let confirm_password = confirm_password.trim();

    if otp_code.len() != 6 || !otp_code.chars().all(|ch| ch.is_ascii_digit()) {
        return Err("Please enter the 6-digit verification code.".to_string());
    }

    if new_password.is_empty() || confirm_password.is_empty() {
        return Err("Both password fields are required.".to_string());
    }

    if new_password != confirm_password {
        return Err("New password and confirm password do not match.".to_string());
    }

    let conn = pool.get().map_err(|e| e.to_string())?;
    let row = conn.query_row(
        "SELECT username, full_name, email, role, is_first_login, created_at, activation_otp, activation_otp_expires_at
         FROM accounts
         WHERE account_id = ?1",
        params![account_id],
        |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, Option<String>>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, i32>(4)? == 1,
                row.get::<_, String>(5)?,
                row.get::<_, Option<String>>(6)?,
                row.get::<_, Option<String>>(7)?,
            ))
        },
    ).map_err(|_| "Account not found.".to_string())?;

    let (username, full_name, email, role, is_first_login, created_at, stored_otp, otp_expires_at) =
        row;

    if !is_first_login {
        return Ok(AdminActivationResponse {
            success: true,
            message: "Account is already active.".to_string(),
            account: Some(AdminAccount {
                account_id,
                username,
                full_name,
                email,
                role,
                is_first_login: false,
                created_at,
            }),
        });
    }

    let stored_otp = stored_otp
        .ok_or_else(|| "No verification code is currently active for this account.".to_string())?;
    if stored_otp != otp_code {
        return Err("The verification code is incorrect.".to_string());
    }

    let otp_expires_at = otp_expires_at.ok_or_else(|| {
        "The verification code has already expired. Please sign in again.".to_string()
    })?;
    let parsed_expiry = NaiveDateTime::parse_from_str(&otp_expires_at, "%Y-%m-%d %H:%M:%S")
        .map_err(|_| "Unable to validate the verification code expiry.".to_string())?;

    if Local::now().naive_local() > parsed_expiry {
        return Err(
            "The verification code has expired. Please sign in again to request a new one."
                .to_string(),
        );
    }

    conn.execute(
        "UPDATE accounts
         SET password_hash = ?1,
             is_first_login = 0,
             activation_otp = NULL,
             activation_otp_expires_at = NULL
         WHERE account_id = ?2",
        params![new_password, account_id],
    )
    .map_err(|e| e.to_string())?;

    Ok(AdminActivationResponse {
        success: true,
        message: "Account fully activated. Welcome to Smart Gate!".to_string(),
        account: Some(AdminAccount {
            account_id,
            username,
            full_name,
            email,
            role,
            is_first_login: false,
            created_at,
        }),
    })
}

pub fn get_dashboard_stats(pool: &DbPool) -> Result<DashboardData, String> {
    let conn = pool.get().map_err(|e| e.to_string())?;
    let today = Local::now().date_naive();
    let seven_days_ago = today - Duration::days(6);

    let total_students: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM persons WHERE role = 'student'",
            [],
            |row| row.get(0),
        )
        .unwrap_or(0);

    let total_employees: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM persons WHERE role IN ('professor', 'staff')",
            [],
            |row| row.get(0),
        )
        .unwrap_or(0);

    let total_visitors: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM persons WHERE role = 'visitor'",
            [],
            |row| row.get(0),
        )
        .unwrap_or(0);

    let entries_today: i64 = conn.query_row(
        "SELECT COUNT(*) FROM entry_logs e JOIN scanners s ON e.scanner_id = s.scanner_id WHERE s.function = 'entrance' AND DATE(e.scanned_at) = DATE('now', 'localtime')",
        [], |row| row.get(0)
    ).unwrap_or(0);

    let exits_today: i64 = conn.query_row(
        "SELECT COUNT(*) FROM entry_logs e JOIN scanners s ON e.scanner_id = s.scanner_id WHERE s.function = 'exit' AND DATE(e.scanned_at) = DATE('now', 'localtime')",
        [], |row| row.get(0)
    ).unwrap_or(0);

    let mut trend_stmt = conn
        .prepare(
            "SELECT DATE(e.scanned_at) AS scan_date, p.role, COUNT(DISTINCT e.person_id) AS total
         FROM entry_logs e
         JOIN persons p ON p.person_id = e.person_id
         JOIN scanners s ON s.scanner_id = e.scanner_id
         WHERE s.function = 'entrance'
           AND DATE(e.scanned_at) BETWEEN ?1 AND ?2
         GROUP BY DATE(e.scanned_at), p.role
         ORDER BY DATE(e.scanned_at) ASC",
        )
        .map_err(|e| e.to_string())?;

    let trend_rows = trend_stmt
        .query_map(
            params![
                seven_days_ago.format("%Y-%m-%d").to_string(),
                today.format("%Y-%m-%d").to_string()
            ],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, i64>(2)?,
                ))
            },
        )
        .map_err(|e| e.to_string())?;

    let mut trend_lookup: HashMap<String, (i64, i64, i64)> = HashMap::new();
    for item in trend_rows {
        let (scan_date, role, total) = item.map_err(|e| e.to_string())?;
        let daily_totals = trend_lookup.entry(scan_date).or_insert((0, 0, 0));

        match role.as_str() {
            "student" => daily_totals.0 += total,
            "professor" | "staff" => daily_totals.1 += total,
            "visitor" => daily_totals.2 += total,
            _ => {}
        }
    }

    let attendance_trend = (0..7)
        .map(|offset| {
            let current_day = seven_days_ago + Duration::days(offset);
            let key = current_day.format("%Y-%m-%d").to_string();
            let (students, employees, visitors) =
                trend_lookup.get(&key).copied().unwrap_or((0, 0, 0));

            ChartDataPoint {
                date: current_day.format("%a").to_string(),
                students,
                employees,
                visitors,
            }
        })
        .collect();

    Ok(DashboardData {
        total_students,
        total_employees,
        total_visitors,
        entries_today,
        exits_today,
        attendance_trend,
    })
}

pub fn log_event_attendance(
    pool: &DbPool,
    event_id: i64,
    id_number: &str,
) -> Result<ScanResult, String> {
    let conn = pool.get().map_err(|e| e.to_string())?;

    // 1. Fetch Event and Validate Date/Time
    let event: Event = conn.query_row(
        "SELECT event_id, event_name, schedule_type, event_date, start_date, end_date, start_time, end_time, required_role, is_enabled FROM events WHERE event_id = ?1",
        params![event_id],
        |row| {
            Ok(Event {
                event_id: row.get(0)?,
                event_name: row.get(1)?,
                schedule_type: row.get(2)?,
                event_date: row.get(3)?,
                start_date: row.get(4)?,
                end_date: row.get(5)?,
                start_time: row.get(6)?,
                end_time: row.get(7)?,
                required_role: row.get(8)?,
                is_enabled: row.get::<_, i32>(9)? == 1,
            })
        }
    ).map_err(|_| "Event not found.")?;

    if !event.is_enabled {
        return Ok(ScanResult {
            success: false,
            message: "Attendance Closed: Event is not enabled.".to_string(),
            person_name: None,
            role: None,
        });
    }

    let now = chrono::Local::now();
    let current_day = now.format("%A").to_string(); // e.g. "Monday"
    let current_date = now.format("%Y-%m-%d").to_string(); // e.g. "2026-03-18"
    let current_time = now.format("%H:%M").to_string(); // e.g. "14:53"

    let is_valid_day = if event.schedule_type.as_deref().unwrap_or("weekly") == "date_range" {
        let event_start = event.start_date.clone().unwrap_or_default();
        let event_end = event.end_date.clone().unwrap_or_default();
        current_date >= event_start && current_date <= event_end
    } else {
        let days: Vec<&str> = event.event_date.split(',').map(|s| s.trim()).collect();
        let current_day_lower = current_day.to_lowercase();
        let current_date_lower = current_date.to_lowercase();

        days.iter().any(|d| {
            let d_lower = d.to_lowercase();
            d_lower == current_date_lower
                || d_lower == current_day_lower
                || d_lower == format!("every {}", current_day_lower)
                || d_lower == "everyday"
        })
    };

    let is_valid_time = current_time >= event.start_time && current_time <= event.end_time;

    if !is_valid_day || !is_valid_time {
        return Ok(ScanResult {
            success: false,
            message: "Attendance Closed: No active event at this time.".to_string(),
            person_name: None,
            role: None,
        });
    }

    // 2. Check if person exists and is active
    let mut stmt = conn.prepare("SELECT person_id, first_name, last_name, role, is_active, created_at FROM persons WHERE id_number = ?1")
        .map_err(|e| e.to_string())?;

    let mut person_iter = stmt
        .query_map(params![id_number], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, i32>(4)? == 1,
                row.get::<_, Option<String>>(5)?,
            ))
        })
        .map_err(|e| e.to_string())?;

    let person_data = person_iter.next();

    if let Some(Ok((person_id, first_name, last_name, role, is_active, created_at))) = person_data {
        if !is_active {
            return Ok(ScanResult {
                success: false,
                message: "Access Denied: ID is inactive.".to_string(),
                person_name: Some(format!("{} {}", first_name, last_name)),
                role: Some(role.clone()),
            });
        }

        if role == "visitor" {
            // Check if created_at is strictly today. If it spans back yesterday, deny.
            if let Some(created_time) = created_at {
                let created_date = created_time.split(' ').next().unwrap_or("");
                if created_date != chrono::Local::now().format("%Y-%m-%d").to_string() {
                    return Ok(ScanResult {
                        success: false,
                        message: "Access Denied: This Visitor Pass expired at 11:59 PM yesterday. Please re-register.".to_string(),
                        person_name: Some(format!("{} {}", first_name, last_name)),
                        role: Some(role),
                    });
                }
            }
        }

        // Check if role matches Required Role (unless "all")
        if event.required_role != "all" && event.required_role.to_lowercase() != role.to_lowercase()
        {
            return Ok(ScanResult {
                success: false,
                message: format!(
                    "Access Denied: Event requires {} role.",
                    event.required_role
                ),
                person_name: Some(format!("{} {}", first_name, last_name)),
                role: Some(role),
            });
        }

        // 3. Check if already recorded for this event
        let existing: Option<i64> = conn
            .query_row(
                "SELECT attendance_id FROM event_attendance WHERE event_id = ?1 AND person_id = ?2",
                params![event_id, person_id],
                |row| row.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?;

        if existing.is_some() {
            return Ok(ScanResult {
                success: false,
                message: "Attendance already recorded for this event".to_string(),
                person_name: Some(format!("{} {}", first_name, last_name)),
                role: Some(role),
            });
        }

        // 4. Insert into event_attendance
        let now = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
        conn.execute(
            "INSERT INTO event_attendance (event_id, person_id, scanned_at) VALUES (?1, ?2, ?3)",
            params![event_id, person_id, now],
        )
        .map_err(|e| e.to_string())?;

        Ok(ScanResult {
            success: true,
            message: "Event Attendance Recorded Successfully.".to_string(),
            person_name: Some(format!("{} {}", first_name, last_name)),
            role: Some(role),
        })
    } else {
        Ok(ScanResult {
            success: false,
            message: "Access Denied: ID not found.".to_string(),
            person_name: None,
            role: None,
        })
    }
}

pub fn get_system_branding(pool: &DbPool) -> Result<SystemBranding, String> {
    let conn = pool.get().map_err(|e| e.to_string())?;

    let mut system_name = "Pamantasan ng Lungsod ni Roi".to_string();
    let mut system_logo = "".to_string();

    let mut stmt = conn
        .prepare("SELECT setting_key, setting_value FROM settings")
        .map_err(|e| e.to_string())?;

    let iter = stmt
        .query_map([], |row| {
            let key: String = row.get(0)?;
            let value: String = row.get(1)?;
            Ok((key, value))
        })
        .map_err(|e| e.to_string())?;

    for item in iter {
        if let Ok((key, value)) = item {
            match key.as_str() {
                "system_name" => system_name = value,
                "system_logo" => system_logo = value,
                _ => {}
            }
        }
    }

    Ok(SystemBranding {
        system_name,
        system_logo,
    })
}

pub fn update_system_branding(
    pool: &DbPool,
    admin_id: i64,
    name: &str,
    logo_base64: &str,
) -> Result<(), String> {
    let mut conn = pool.get().map_err(|e| e.to_string())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    // Get old values for audit logging
    let mut old_system_name = "Pamantasan ng Lungsod ni Roi".to_string();
    let mut old_system_logo = "".to_string();

    {
        let mut stmt = tx.prepare("SELECT setting_key, setting_value FROM settings WHERE setting_key IN ('system_name', 'system_logo')")
            .map_err(|e| e.to_string())?;

        let iter = stmt
            .query_map([], |row| {
                let key: String = row.get(0)?;
                let value: String = row.get(1)?;
                Ok((key, value))
            })
            .map_err(|e| e.to_string())?;

        for item in iter {
            if let Ok((key, value)) = item {
                match key.as_str() {
                    "system_name" => old_system_name = value,
                    "system_logo" => old_system_logo = value,
                    _ => {}
                }
            }
        }
    }

    // Insert or update system_name
    tx.execute(
        "INSERT INTO settings (setting_key, setting_value) VALUES ('system_name', ?1)
         ON CONFLICT(setting_key) DO UPDATE SET setting_value=excluded.setting_value",
        params![name],
    )
    .map_err(|e| e.to_string())?;

    // Log audit for system_name change if it changed
    if old_system_name != name {
        let old_values = format!(
            r#"{{"system_name":"{}"}}"#,
            old_system_name.replace("\"", "\\\"")
        );
        let new_values = format!(r#"{{"system_name":"{}"}}"#, name.replace("\"", "\\\""));

        tx.execute(
            "INSERT INTO audit_logs (admin_id, action_type, target_table, target_id, old_values, new_values) 
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![admin_id, "UPDATE", "settings", 1_i64, old_values, new_values],
        ).map_err(|e| e.to_string())?;
    }

    // Insert or update system_logo
    tx.execute(
        "INSERT INTO settings (setting_key, setting_value) VALUES ('system_logo', ?1)
         ON CONFLICT(setting_key) DO UPDATE SET setting_value=excluded.setting_value",
        params![logo_base64],
    )
    .map_err(|e| e.to_string())?;

    // Log audit for system_logo change if it changed
    if old_system_logo != logo_base64 {
        let old_logo_preview = if old_system_logo.len() > 100 {
            format!("{}...", &old_system_logo[..100])
        } else {
            old_system_logo.clone()
        };
        let new_logo_preview = if logo_base64.len() > 100 {
            format!("{}...", &logo_base64[..100])
        } else {
            logo_base64.to_string()
        };

        let old_values = format!(
            r#"{{"system_logo":"{}"}}"#,
            old_logo_preview.replace("\"", "\\\"")
        );
        let new_values = format!(
            r#"{{"system_logo":"{}"}}"#,
            new_logo_preview.replace("\"", "\\\"")
        );

        tx.execute(
            "INSERT INTO audit_logs (admin_id, action_type, target_table, target_id, old_values, new_values) 
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![admin_id, "UPDATE", "settings", 2_i64, old_values, new_values],
        ).map_err(|e| e.to_string())?;
    }

    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use r2d2::Pool;
    use r2d2_sqlite::SqliteConnectionManager;

    fn setup_memory_db() -> DbPool {
        let manager = SqliteConnectionManager::memory();
        let pool = Pool::new(manager).unwrap();
        let conn = pool.get().unwrap();

        let schema = include_str!("../../docs/database/schema.sql");
        conn.execute_batch(schema).unwrap();
        pool
    }

    #[test]
    fn test_department_and_program() {
        let pool = setup_memory_db();

        // Add Department
        let dept_id = add_department(
            &pool,
            Department {
                department_id: 0,
                department_code: "CS".to_string(),
                department_name: "Computer Science".to_string(),
            },
        )
        .unwrap();

        assert!(dept_id > 0);

        // Assert Retrieval
        let depts = get_departments(&pool).unwrap();
        assert!(depts.iter().any(
            |dept| dept.department_id == dept_id && dept.department_name == "Computer Science"
        ));

        // Add Program
        let prog_id = add_program(
            &pool,
            Program {
                program_id: 0,
                department_id: dept_id,
                program_code: "BSCS-TEST".to_string(),
                program_name: "Bachelor of Science in Computer Science".to_string(),
            },
        )
        .unwrap();

        assert!(prog_id > 0);

        let programs = get_programs(&pool).unwrap();
        assert!(programs.iter().any(|program| program.program_id == prog_id
            && program.program_name == "Bachelor of Science in Computer Science"));
    }

    #[test]
    fn test_person_and_access_log() {
        let pool = setup_memory_db();

        // 1. Add typical user
        let person_id = add_person(
            &pool,
            Person {
                person_id: 0,
                id_number: "2020-12345".to_string(),
                role: "student".to_string(),
                first_name: "John".to_string(),
                middle_name: None,
                last_name: "Doe".to_string(),
                email: None,
                contact_number: None,
                face_template_path: None,
                is_active: true,
            },
        )
        .unwrap();

        // 2. Add Scanner
        let scanner_id = add_scanner(
            &pool,
            Scanner {
                scanner_id: 0,
                location_name: "Main Gate".to_string(),
                function: "entrance".to_string(),
            },
        )
        .unwrap();

        // 3. Test Access Granted
        let result = log_entry(&pool, scanner_id, person_id).unwrap();
        assert!(result.success);
        assert_eq!(result.message, "Entry Successful.");
        assert_eq!(result.person_name, Some("John Doe".to_string()));

        // 4. Test Deactivation / Status update
        update_person_status(&pool, person_id, false).unwrap();

        // 5. Test Access Denied
        let result_denied = log_entry(&pool, scanner_id, person_id).unwrap();
        assert!(!result_denied.success);
        assert_eq!(result_denied.message, "Access Denied: ID is inactive.");
    }
}
