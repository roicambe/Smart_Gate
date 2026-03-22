use chrono::{Duration, Local};
use r2d2::Pool;
use r2d2_sqlite::SqliteConnectionManager;
use rusqlite::{params, OptionalExtension};
use std::collections::HashMap;
use std::fs;
use tauri::Manager;
use crate::models::*;

pub type DbPool = Pool<SqliteConnectionManager>;

fn table_has_column(conn: &rusqlite::Connection, table: &str, column: &str) -> Result<bool, String> {
    let pragma = format!("PRAGMA table_info({table})");
    let mut stmt = conn.prepare(&pragma).map_err(|e| e.to_string())?;
    let columns = stmt.query_map([], |row| row.get::<_, String>(1)).map_err(|e| e.to_string())?;

    for item in columns {
        if item.map_err(|e| e.to_string())? == column {
            return Ok(true);
        }
    }

    Ok(false)
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
    let pool = r2d2::Pool::new(manager).map_err(|e| format!("Failed to create database pool: {}", e))?;

    // Initialize the database with schema.sql
    let conn = pool.get().map_err(|e| format!("Failed to get connection from pool: {}", e))?;
    let schema = include_str!("../../docs/database/schema.sql");
    conn.execute_batch(schema).map_err(|e| format!("Failed to execute schema: {}", e))?;

    // Normalize legacy person schema to the current id_number/email/contact_number layout.
    if table_has_column(&conn, "persons", "school_id_number")? && !table_has_column(&conn, "persons", "id_number")? {
        conn.execute("ALTER TABLE persons RENAME COLUMN school_id_number TO id_number", params![])
            .map_err(|e| format!("Failed to migrate persons.id_number: {}", e))?;
    }

    let _ = conn.execute("ALTER TABLE persons ADD COLUMN email VARCHAR NULL", params![]);
    let _ = conn.execute("ALTER TABLE persons ADD COLUMN contact_number VARCHAR NULL", params![]);

    // Drop the UNIQUE constraint on email by recreating the table if it exists
    let persons_sql: String = conn.query_row(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='persons'",
        [],
        |row| row.get(0),
    ).unwrap_or_default();

    if persons_sql.contains("email VARCHAR UNIQUE") {
        conn.execute_batch("
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
        ").map_err(|e| format!("Failed to migrate un-unique email: {}", e))?;
    }

    // Fix Visitor Schema (dynamically add person_to_visit if missing) and move legacy contact data into persons.
    let _ = conn.execute("ALTER TABLE visitors ADD COLUMN person_to_visit TEXT DEFAULT ''", params![]);
    if table_has_column(&conn, "visitors", "contact_number")? {
        conn.execute(
            "UPDATE persons
             SET contact_number = COALESCE(persons.contact_number, (
                 SELECT v.contact_number FROM visitors v WHERE v.person_id = persons.person_id
             ))
             WHERE role = 'visitor'",
            params![],
        ).map_err(|e| format!("Failed to migrate visitor contact numbers: {}", e))?;
    }

    // Admin RBAC updates and role normalization.
    let _ = conn.execute("ALTER TABLE accounts ADD COLUMN full_name VARCHAR DEFAULT 'Administrator'", params![]);
    conn.execute(
        "UPDATE accounts
         SET full_name = COALESCE(NULLIF(TRIM(full_name), ''), 'Administrator')",
        params![],
    ).map_err(|e| format!("Failed to normalize account names: {}", e))?;
    conn.execute(
        "UPDATE accounts
         SET role = CASE
             WHEN role IN ('Super Admin', 'System Administrator') THEN 'System Administrator'
             WHEN role IN ('Admin', 'Gate Supervisor') THEN 'Gate Supervisor'
             ELSE role
         END",
        params![],
    ).map_err(|e| format!("Failed to normalize account roles: {}", e))?;
    conn.execute(
        "INSERT OR IGNORE INTO accounts (username, password_hash, full_name, role)
         VALUES ('admin', 'admin123', 'Administrator', 'System Administrator')",
        params![],
    ).map_err(|e| format!("Failed to seed default admin account: {}", e))?;

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

pub fn add_department(pool: &DbPool, department: Department) -> Result<i64, String> {
    let conn = pool.get().map_err(|e| e.to_string())?;
    
    conn.execute(
        "INSERT INTO departments (department_code, department_name)
         VALUES (?1, ?2)",
        params![department.department_code, department.department_name],
    ).map_err(|e| e.to_string())?;

    Ok(conn.last_insert_rowid())
}

pub fn get_departments(pool: &DbPool) -> Result<Vec<Department>, String> {
    let conn = pool.get().map_err(|e| e.to_string())?;
    
    let mut stmt = conn.prepare("SELECT department_id, department_code, department_name FROM departments")
        .map_err(|e| e.to_string())?;
        
    let iter = stmt.query_map([], |row| {
        Ok(Department {
            department_id: row.get(0)?,
            department_code: row.get(1)?,
            department_name: row.get(2)?,
        })
    }).map_err(|e| e.to_string())?;

    let mut list = Vec::new();
    for item in iter {
        list.push(item.map_err(|e| e.to_string())?);
    }
    
    Ok(list)
}

pub fn update_department(pool: &DbPool, department_id: i64, new_name: &str, new_code: &str) -> Result<(), String> {
    let conn = pool.get().map_err(|e| e.to_string())?;
    
    conn.execute(
        "UPDATE departments SET department_name = ?1, department_code = ?2 WHERE department_id = ?3",
        params![new_name, new_code, department_id],
    ).map_err(|e| e.to_string())?;

    Ok(())
}

pub fn delete_department(pool: &DbPool, department_id: i64) -> Result<(), String> {
    let conn = pool.get().map_err(|e| e.to_string())?;
    
    // Check if there are programs associated
    let count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM programs WHERE department_id = ?1",
        params![department_id],
        |row| row.get(0)
    ).unwrap_or(0);
    
    if count > 0 {
        return Err("Cannot delete department because it has associated programs. Please delete the programs first.".to_string());
    }

    conn.execute(
        "DELETE FROM departments WHERE department_id = ?1",
        params![department_id],
    ).map_err(|e| e.to_string())?;

    Ok(())
}

pub fn add_program(pool: &DbPool, program: Program) -> Result<i64, String> {
    let conn = pool.get().map_err(|e| e.to_string())?;
    
    conn.execute(
        "INSERT INTO programs (department_id, program_code, program_name)
         VALUES (?1, ?2, ?3)",
        params![program.department_id, program.program_code, program.program_name],
    ).map_err(|e| e.to_string())?;

    Ok(conn.last_insert_rowid())
}

pub fn get_programs(pool: &DbPool) -> Result<Vec<Program>, String> {
    let conn = pool.get().map_err(|e| e.to_string())?;
    
    let mut stmt = conn.prepare("SELECT program_id, department_id, program_code, program_name FROM programs")
        .map_err(|e| e.to_string())?;
        
    let iter = stmt.query_map([], |row| {
        Ok(Program {
            program_id: row.get(0)?,
            department_id: row.get(1)?,
            program_code: row.get(2)?,
            program_name: row.get(3)?,
        })
    }).map_err(|e| e.to_string())?;

    let mut list = Vec::new();
    for item in iter {
        list.push(item.map_err(|e| e.to_string())?);
    }
    
    Ok(list)
}

pub fn update_program(pool: &DbPool, program_id: i64, department_id: i64, new_name: &str, new_code: &str) -> Result<(), String> {
    let conn = pool.get().map_err(|e| e.to_string())?;
    
    conn.execute(
        "UPDATE programs SET department_id = ?1, program_name = ?2, program_code = ?3 WHERE program_id = ?4",
        params![department_id, new_name, new_code, program_id],
    ).map_err(|e| e.to_string())?;

    Ok(())
}

pub fn delete_program(pool: &DbPool, program_id: i64) -> Result<(), String> {
    let conn = pool.get().map_err(|e| e.to_string())?;
    
    // Check if there are students associated
    let count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM students WHERE program_id = ?1",
        params![program_id],
        |row| row.get(0)
    ).unwrap_or(0);
    
    if count > 0 {
        return Err("Cannot delete program because it has associated students.".to_string());
    }

    conn.execute(
        "DELETE FROM programs WHERE program_id = ?1",
        params![program_id],
    ).map_err(|e| e.to_string())?;

    Ok(())
}

// ------ User Management CRUD Operations ------

pub fn add_person(pool: &DbPool, person: Person) -> Result<i64, String> {
    let conn = pool.get().map_err(|e| e.to_string())?;
    
    let is_active = if person.is_active { 1 } else { 0 };
    
    conn.execute(
        "INSERT INTO persons (id_number, role, first_name, middle_name, last_name, email, contact_number, face_template_path, is_active)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
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
        
    let person_iter = stmt.query_map([], |row| {
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
    }).map_err(|e| e.to_string())?;

    let mut persons = Vec::new();
    for person in person_iter {
        persons.push(person.map_err(|e| e.to_string())?);
    }
    
    Ok(persons)
}

pub fn update_person_status(pool: &DbPool, person_id: i64, is_active: bool) -> Result<(), String> {
    let conn = pool.get().map_err(|e| e.to_string())?;
    let active_int = if is_active { 1 } else { 0 };
    
    conn.execute(
        "UPDATE persons SET is_active = ?1 WHERE person_id = ?2",
        params![active_int, person_id],
    ).map_err(|e| e.to_string())?;
    
    Ok(())
}

pub fn add_student(pool: &DbPool, student: Student) -> Result<(), String> {
    let conn = pool.get().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO students (person_id, program_id) VALUES (?1, ?2)",
        params![student.person_id, student.program_id],
    ).map_err(|e| e.to_string())?;
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
    
    let iter = stmt.query_map([], |row| {
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
    }).map_err(|e| e.to_string())?;
    
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
        params![employee.person_id, employee.department_id, employee.position_title],
    ).map_err(|e| e.to_string())?;
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
) -> Result<i64, String> {
    let mut conn = pool.get().map_err(|e| e.to_string())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    tx.execute(
        "INSERT INTO persons (id_number, role, first_name, middle_name, last_name, email, contact_number, is_active)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 1)",
        params![id_number, role, first_name, middle_name, last_name, email, contact_number],
    ).map_err(|e| e.to_string())?;

    let person_id = tx.last_insert_rowid();

    match role {
        "student" => {
            tx.execute(
                "INSERT INTO students (person_id, program_id, year_level) VALUES (?1, ?2, ?3)",
                params![person_id, program_id.unwrap_or(1), year_level],
            ).map_err(|e| e.to_string())?;
        },
        "professor" | "staff" => {
            tx.execute(
                "INSERT INTO employees (person_id, department_id, position_title) VALUES (?1, ?2, ?3)",
                params![person_id, department_id.unwrap_or(1), position_title.unwrap_or_default()],
            ).map_err(|e| e.to_string())?;
        },
        "visitor" => {
            tx.execute(
                "INSERT INTO visitors (person_id, purpose_of_visit, person_to_visit) VALUES (?1, ?2, ?3)",
                params![person_id, purpose.unwrap_or_default(), person_to_visit.unwrap_or_default()],
            ).map_err(|e| e.to_string())?;
        },
        _ => return Err("Invalid role specified".to_string()),
    }

    tx.commit().map_err(|e| e.to_string())?;
    Ok(person_id)
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
) -> Result<(), String> {
    let mut conn = pool.get().map_err(|e| e.to_string())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;

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
            ).map_err(|e| e.to_string())?;
        },
        "professor" | "staff" => {
            tx.execute(
                "UPDATE employees SET department_id = ?1, position_title = ?2 WHERE person_id = ?3",
                params![department_id.unwrap_or(1), position_title.unwrap_or_default(), person_id],
            ).map_err(|e| e.to_string())?;
        },
        "visitor" => {
            tx.execute(
                "UPDATE visitors SET purpose_of_visit = ?1, person_to_visit = ?2 WHERE person_id = ?3",
                params![purpose.unwrap_or_default(), person_to_visit.unwrap_or_default(), person_id],
            ).map_err(|e| e.to_string())?;
        },
        _ => return Err("Invalid role specified".to_string()),
    }

    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

pub fn delete_user(pool: &DbPool, person_id: i64, role: &str) -> Result<(), String> {
    let mut conn = pool.get().map_err(|e| e.to_string())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    match role {
        "student" => {
            tx.execute("DELETE FROM students WHERE person_id = ?1", params![person_id]).map_err(|e| e.to_string())?;
        },
        "professor" | "staff" => {
            tx.execute("DELETE FROM employees WHERE person_id = ?1", params![person_id]).map_err(|e| e.to_string())?;
        },
        "visitor" => {
            tx.execute("DELETE FROM visitors WHERE person_id = ?1", params![person_id]).map_err(|e| e.to_string())?;
        },
        _ => return Err("Invalid role specified".to_string()),
    }
    
    // Also delete entry logs
    tx.execute("DELETE FROM entry_logs WHERE person_id = ?1", params![person_id]).map_err(|e| e.to_string())?;

    // Finally delete from persons
    tx.execute("DELETE FROM persons WHERE person_id = ?1", params![person_id]).map_err(|e| e.to_string())?;

    tx.commit().map_err(|e| e.to_string())?;
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
    
    let iter = stmt.query_map([], |row| {
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
    }).map_err(|e| e.to_string())?;
    
    let mut list = Vec::new();
    for item in iter {
        list.push(item.map_err(|e| e.to_string())?);
    }
    Ok(list)
}

pub fn get_visitors(pool: &DbPool) -> Result<Vec<VisitorDetails>, String> {
    let conn = pool.get().map_err(|e| e.to_string())?;
    
    // Simplistic approach: get the first entry today as time_in, and the last exit today as time_out
    let mut stmt = conn.prepare(
        "SELECT p.person_id, p.id_number, p.first_name, p.middle_name, p.last_name, p.email, p.contact_number, v.purpose_of_visit, v.person_to_visit,
            (SELECT MIN(e.scanned_at) FROM entry_logs e JOIN scanners s ON e.scanner_id = s.scanner_id WHERE e.person_id = p.person_id AND s.function = 'entrance') as time_in,
            (SELECT MAX(e.scanned_at) FROM entry_logs e JOIN scanners s ON e.scanner_id = s.scanner_id WHERE e.person_id = p.person_id AND s.function = 'exit') as time_out
         FROM persons p
         JOIN visitors v ON p.person_id = v.person_id
         WHERE p.role = 'visitor'"
    ).map_err(|e| e.to_string())?;

    let iter = stmt.query_map([], |row| {
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
            time_in: row.get(9).unwrap_or(None),
            time_out: row.get(10).unwrap_or(None),
        })
    }).map_err(|e| e.to_string())?;

    let mut list = Vec::new();
    for item in iter {
        list.push(item.map_err(|e| e.to_string())?);
    }
    Ok(list)
}

// ------ Hardware & Events CRUD Operations ------

pub fn add_scanner(pool: &DbPool, scanner: Scanner) -> Result<i64, String> {
    let conn = pool.get().map_err(|e| e.to_string())?;
    
    conn.execute(
        "INSERT INTO scanners (location_name, function)
         VALUES (?1, ?2)",
        params![scanner.location_name, scanner.function],
    ).map_err(|e| e.to_string())?;

    Ok(conn.last_insert_rowid())
}

pub fn get_scanners(pool: &DbPool) -> Result<Vec<Scanner>, String> {
    let conn = pool.get().map_err(|e| e.to_string())?;
    
    let mut stmt = conn.prepare("SELECT scanner_id, location_name, function FROM scanners")
        .map_err(|e| e.to_string())?;
        
    let iter = stmt.query_map([], |row| {
        Ok(Scanner {
            scanner_id: row.get(0)?,
            location_name: row.get(1)?,
            function: row.get(2)?,
        })
    }).map_err(|e| e.to_string())?;

    let mut list = Vec::new();
    for item in iter {
        list.push(item.map_err(|e| e.to_string())?);
    }
    
    Ok(list)
}

pub fn get_access_logs(pool: &DbPool, start_date: Option<String>, end_date: Option<String>) -> Result<Vec<AccessLogDetails>, String> {
    let conn = pool.get().map_err(|e| e.to_string())?;
    
    let mut base_query = "
        SELECT l.log_id, l.scanned_at, p.first_name, p.last_name, p.id_number, p.role, s.location_name, s.function
        FROM entry_logs l
        JOIN persons p ON l.person_id = p.person_id
        JOIN scanners s ON l.scanner_id = s.scanner_id
    ".to_string();

    if start_date.is_some() && end_date.is_some() {
        base_query.push_str(" WHERE DATE(l.scanned_at) BETWEEN DATE(?1) AND DATE(?2)");
    } else if start_date.is_some() {
        base_query.push_str(" WHERE DATE(l.scanned_at) >= DATE(?1)");
    } else if end_date.is_some() {
        base_query.push_str(" WHERE DATE(l.scanned_at) <= DATE(?1)");
    }

    base_query.push_str(" ORDER BY l.scanned_at DESC LIMIT 100");

    let mut stmt = conn.prepare(&base_query).map_err(|e| e.to_string())?;
    
    let mut list = Vec::new();

    if let (Some(start), Some(end)) = (&start_date, &end_date) {
        let iter = stmt.query_map(params![start, end], |row| {
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
        }).map_err(|e| e.to_string())?;
        for item in iter { list.push(item.map_err(|e| e.to_string())?); }
    } else if let Some(date) = start_date.or(end_date) {
        let iter = stmt.query_map(params![date], |row| {
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
        }).map_err(|e| e.to_string())?;
        for item in iter { list.push(item.map_err(|e| e.to_string())?); }
    } else {
        let iter = stmt.query_map([], |row| {
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
        }).map_err(|e| e.to_string())?;
        for item in iter { list.push(item.map_err(|e| e.to_string())?); }
    }

    
    Ok(list)
}

pub fn get_event_attendance_logs(pool: &DbPool, start_date: Option<String>, end_date: Option<String>) -> Result<Vec<EventAttendanceLog>, String> {
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
        let iter = stmt.query_map(params![start, end], |row| {
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
        }).map_err(|e| e.to_string())?;
        for item in iter { list.push(item.map_err(|e| e.to_string())?); }
    } else if let Some(date) = start_date.or(end_date) {
        let iter = stmt.query_map(params![date], |row| {
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
        }).map_err(|e| e.to_string())?;
        for item in iter { list.push(item.map_err(|e| e.to_string())?); }
    } else {
        let iter = stmt.query_map([], |row| {
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
        }).map_err(|e| e.to_string())?;
        for item in iter { list.push(item.map_err(|e| e.to_string())?); }
    }

    Ok(list)
}

pub fn add_event(pool: &DbPool, event: Event) -> Result<i64, String> {
    let conn = pool.get().map_err(|e| e.to_string())?;
    
    let is_enabled = if event.is_enabled { 1 } else { 0 };
    
    conn.execute(
        "INSERT INTO events (event_name, event_date, start_time, end_time, required_role, is_enabled)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![
            event.event_name,
            event.event_date,
            event.start_time,
            event.end_time,
            event.required_role,
            is_enabled
        ],
    ).map_err(|e| e.to_string())?;

    Ok(conn.last_insert_rowid())
}

pub fn get_events(pool: &DbPool) -> Result<Vec<Event>, String> {
    let conn = pool.get().map_err(|e| e.to_string())?;
    
    let mut stmt = conn.prepare("SELECT event_id, event_name, event_date, start_time, end_time, required_role, is_enabled FROM events")
        .map_err(|e| e.to_string())?;
        
    let iter = stmt.query_map([], |row| {
        Ok(Event {
            event_id: row.get(0)?,
            event_name: row.get(1)?,
            event_date: row.get(2)?,
            start_time: row.get(3)?,
            end_time: row.get(4)?,
            required_role: row.get(5)?,
            is_enabled: row.get::<_, i32>(6)? == 1,
        })
    }).map_err(|e| e.to_string())?;

    let mut list = Vec::new();
    for item in iter {
        list.push(item.map_err(|e| e.to_string())?);
    }
    
    Ok(list)
}

pub fn update_event(pool: &DbPool, event_id: i64, event: Event) -> Result<(), String> {
    let conn = pool.get().map_err(|e| e.to_string())?;
    
    let is_enabled = if event.is_enabled { 1 } else { 0 };
    
    conn.execute(
        "UPDATE events SET event_name = ?1, event_date = ?2, start_time = ?3, end_time = ?4, required_role = ?5, is_enabled = ?6 WHERE event_id = ?7",
        params![
            event.event_name,
            event.event_date,
            event.start_time,
            event.end_time,
            event.required_role,
            is_enabled,
            event_id
        ],
    ).map_err(|e| e.to_string())?;

    Ok(())
}

pub fn delete_event(pool: &DbPool, event_id: i64) -> Result<(), String> {
    let conn = pool.get().map_err(|e| e.to_string())?;
    
    conn.execute(
        "DELETE FROM events WHERE event_id = ?1",
        params![event_id],
    ).map_err(|e| e.to_string())?;

    Ok(())
}

// ------ Access Logging & Business Rules ------

pub fn log_entry(pool: &DbPool, scanner_id: i64, person_id: i64) -> Result<ScanResult, String> {
    let conn = pool.get().map_err(|e| e.to_string())?;

    // 1. Check if person exists and is active
    let mut stmt = conn.prepare("SELECT first_name, last_name, role, is_active FROM persons WHERE person_id = ?1")
        .map_err(|e| e.to_string())?;
    
    let mut person_iter = stmt.query_map(params![person_id], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, i32>(3)? == 1,
        ))
    }).map_err(|e| e.to_string())?;

    let person_data = person_iter.next();

    if let Some(Ok((first_name, last_name, role, is_active))) = person_data {
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
        let scanner_function: String = conn.query_row(
            "SELECT function FROM scanners WHERE scanner_id = ?1",
            params![scanner_id],
            |row| row.get(0)
        ).map_err(|e| e.to_string())?;

        // Get the latest log for this person
        let last_log_function: Option<String> = conn.query_row(
            "SELECT s.function FROM entry_logs e 
             JOIN scanners s ON e.scanner_id = s.scanner_id 
             WHERE e.person_id = ?1 
             ORDER BY e.scanned_at DESC LIMIT 1",
            params![person_id],
            |row| row.get(0)
        ).optional().map_err(|e| e.to_string())?;

        // Logic Re-Check
        if scanner_function == "exit" {
             // Can only exit if the last log was 'entrance'. 
             // If no logs (None) or last was 'exit', deny.
             match last_log_function.as_deref() {
                Some("entrance") => {
                    // Valid exit
                },
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
             // Prevent double entry
             match last_log_function.as_deref() {
                Some("entrance") => {
                     return Ok(ScanResult {
                        success: false,
                        message: "User is already on campus".to_string(),
                        person_name: Some(format!("{} {}", first_name, last_name)),
                        role: Some(role),
                    });
                },
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
        ).map_err(|e| e.to_string())?;

        Ok(ScanResult {
            success: true,
            message: format!("{} Successful.", if scanner_function == "entrance" { "Entry" } else { "Exit" }),
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

pub fn manual_id_entry(pool: &DbPool, id_number: &str, scanner_function: &str) -> Result<ScanResult, String> {
    let conn = pool.get().map_err(|e| e.to_string())?;

    let mut stmt = conn.prepare("SELECT person_id, first_name, last_name, role, is_active FROM persons WHERE id_number = ?1")
        .map_err(|e| e.to_string())?;
        
    let mut person_iter = stmt.query_map(params![id_number], |row| {
        Ok((
            row.get::<_, i64>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, String>(3)?,
            row.get::<_, i32>(4)? == 1,
        ))
    }).map_err(|e| e.to_string())?;

    let person_data = person_iter.next();

    if let Some(Ok((person_id, first_name, last_name, role, is_active))) = person_data {
        if !is_active {
            return Ok(ScanResult {
                success: false,
                message: "Access Denied: ID is inactive.".to_string(),
                person_name: Some(format!("{} {}", first_name, last_name)),
                role: Some(role),
            });
        }

        // Find an appropriate scanner ID for logging (mocking based on function)
        let scanner_id: i64 = conn.query_row(
            "SELECT scanner_id FROM scanners WHERE function = ?1 LIMIT 1",
            params![scanner_function],
            |row| row.get(0)
        ).unwrap_or(1); // Default to 1 if none found

        // Validation Logic for Manual Entry
         let last_log_function: Option<String> = conn.query_row(
            "SELECT s.function FROM entry_logs e 
             JOIN scanners s ON e.scanner_id = s.scanner_id 
             WHERE e.person_id = ?1 
             ORDER BY e.scanned_at DESC LIMIT 1",
            params![person_id],
            |row| row.get(0)
        ).optional().map_err(|e| e.to_string())?;

        if scanner_function == "exit" {
             match last_log_function.as_deref() {
                Some("entrance") => { /* Valid */ },
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
             match last_log_function.as_deref() {
                Some("entrance") => {
                     return Ok(ScanResult {
                        success: false,
                        message: "User is already on campus".to_string(),
                        person_name: Some(format!("{} {}", first_name, last_name)),
                        role: Some(role),
                    });
                },
                _ => { /* Valid */ }
             }
        }

        let now = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
        conn.execute(
            "INSERT INTO entry_logs (person_id, scanner_id, scanned_at) VALUES (?1, ?2, ?3)",
            params![person_id, scanner_id, now],
        ).map_err(|e| e.to_string())?;

        Ok(ScanResult {
            success: true,
            message: format!("Manual {} Successful.", if scanner_function == "entrance" { "Entry" } else { "Exit" }),
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

pub fn log_audit_action(pool: &DbPool, admin_id: i64, action_type: &str, target_table: &str, target_id: i64) -> Result<(), String> {
    let conn = pool.get().map_err(|e| e.to_string())?;
    
    conn.execute(
        "INSERT INTO audit_logs (admin_id, action_type, target_table, target_id) VALUES (?1, ?2, ?3, ?4)",
        params![admin_id, action_type, target_table, target_id],
    ).map_err(|e| e.to_string())?;
    
    Ok(())
}

pub fn get_audit_logs(pool: &DbPool, start_date: Option<String>, end_date: Option<String>) -> Result<Vec<AuditLogDetails>, String> {
    let conn = pool.get().map_err(|e| e.to_string())?;

    let mut base_query = "
        SELECT a.audit_id, acc.username, a.action_type, a.target_table, a.target_id, a.old_values, a.new_values, a.created_at 
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

    if let (Some(start), Some(end)) = (&start_date, &end_date) {
        let iter = stmt.query_map(params![start, end], |row| {
            Ok(AuditLogDetails {
                audit_id: row.get(0)?,
                admin_username: row.get::<_, Option<String>>(1)?.unwrap_or_else(|| "Unknown".to_string()),
                action_type: row.get(2)?,
                target_table: row.get(3)?,
                target_id: row.get(4)?,
                old_values: row.get(5)?,
                new_values: row.get(6)?,
                created_at: row.get(7)?,
            })
        }).map_err(|e| e.to_string())?;
        for log in iter { if let Ok(l) = log { logs.push(l); } }
    } else if let Some(date) = start_date.or(end_date) {
        let iter = stmt.query_map(params![date], |row| {
            Ok(AuditLogDetails {
                audit_id: row.get(0)?,
                admin_username: row.get::<_, Option<String>>(1)?.unwrap_or_else(|| "Unknown".to_string()),
                action_type: row.get(2)?,
                target_table: row.get(3)?,
                target_id: row.get(4)?,
                old_values: row.get(5)?,
                new_values: row.get(6)?,
                created_at: row.get(7)?,
            })
        }).map_err(|e| e.to_string())?;
        for log in iter { if let Ok(l) = log { logs.push(l); } }
    } else {
        let iter = stmt.query_map([], |row| {
            Ok(AuditLogDetails {
                audit_id: row.get(0)?,
                admin_username: row.get::<_, Option<String>>(1)?.unwrap_or_else(|| "Unknown".to_string()),
                action_type: row.get(2)?,
                target_table: row.get(3)?,
                target_id: row.get(4)?,
                old_values: row.get(5)?,
                new_values: row.get(6)?,
                created_at: row.get(7)?,
            })
        }).map_err(|e| e.to_string())?;
        for log in iter { if let Ok(l) = log { logs.push(l); } }
    }

    Ok(logs)
}

// ------ Admin Dashboard & Auth ------

pub fn admin_login(pool: &DbPool, username: &str, password: &str) -> Result<AdminLoginResponse, String> {
    let conn = pool.get().map_err(|e| e.to_string())?;
    
    let mut stmt = conn.prepare("SELECT account_id, password_hash, full_name, role, created_at FROM accounts WHERE username = ?1")
        .map_err(|e| e.to_string())?;
        
    let mut rows = stmt.query(params![username]).map_err(|e| e.to_string())?;
    
    if let Some(row) = rows.next().map_err(|e| e.to_string())? {
        let account_id: i64 = row.get(0).map_err(|e| e.to_string())?;
        let stored_hash: String = row.get(1).map_err(|e| e.to_string())?;
        let full_name: String = row.get(2).map_err(|e| e.to_string())?;
        let role: String = row.get(3).map_err(|e| e.to_string())?;
        let created_at: String = row.get(4).map_err(|e| e.to_string())?;
        
        if stored_hash == password {
            return Ok(AdminLoginResponse {
                success: true,
                message: "Login successful".to_string(),
                account: Some(AdminAccount {
                    account_id,
                    username: username.to_string(),
                    full_name,
                    role,
                    created_at,
                }),
            });
        }
    }
    
    Ok(AdminLoginResponse {
        success: false,
        message: "Invalid credentials".to_string(),
        account: None,
    })
}

pub fn update_admin_credentials(pool: &DbPool, account_id: i64, current_password: &str, new_password: &str) -> Result<bool, String> {
    let conn = pool.get().map_err(|e| e.to_string())?;
    
    let mut stmt = conn.prepare("SELECT password_hash FROM accounts WHERE account_id = ?1")
        .map_err(|e| e.to_string())?;
        
    let mut rows = stmt.query(params![account_id]).map_err(|e| e.to_string())?;
    
    if let Some(row) = rows.next().map_err(|e| e.to_string())? {
        let stored_hash: String = row.get(0).map_err(|e| e.to_string())?;
        if stored_hash == current_password {
            conn.execute(
                "UPDATE accounts SET password_hash = ?1 WHERE account_id = ?2",
                params![new_password, account_id],
            ).map_err(|e| e.to_string())?;
            return Ok(true);
        }
    }
    
    Ok(false)
}

pub fn get_admin_accounts(pool: &DbPool) -> Result<Vec<AdminAccount>, String> {
    let conn = pool.get().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare("SELECT account_id, username, full_name, role, created_at FROM accounts")
        .map_err(|e| e.to_string())?;
        
    let iter = stmt.query_map([], |row| {
        Ok(AdminAccount {
            account_id: row.get(0)?,
            username: row.get(1)?,
            full_name: row.get(2)?,
            role: row.get(3)?,
            created_at: row.get(4)?,
        })
    }).map_err(|e| e.to_string())?;

    let mut list = Vec::new();
    for item in iter { list.push(item.map_err(|e| e.to_string())?); }
    Ok(list)
}

pub fn add_admin_account(pool: &DbPool, username: &str, password: &str, full_name: &str, role: &str, active_admin_id: i64) -> Result<i64, String> {
    let conn = pool.get().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO accounts (username, password_hash, full_name, role) VALUES (?1, ?2, ?3, ?4)",
        params![username, password, full_name, role],
    ).map_err(|e| e.to_string())?;
    let target_id = conn.last_insert_rowid();

    let _ = log_audit_action(pool, active_admin_id, "INSERT", "accounts", target_id);
    Ok(target_id)
}

pub fn update_admin_role(pool: &DbPool, account_id: i64, new_role: &str, active_admin_id: i64) -> Result<(), String> {
    let conn = pool.get().map_err(|e| e.to_string())?;
    conn.execute("UPDATE accounts SET role = ?1 WHERE account_id = ?2", params![new_role, account_id])
        .map_err(|e| e.to_string())?;
        
    let _ = log_audit_action(pool, active_admin_id, "UPDATE", "accounts", account_id);
    Ok(())
}

pub fn reset_admin_password(pool: &DbPool, account_id: i64, new_password: &str, active_admin_id: i64) -> Result<(), String> {
    let conn = pool.get().map_err(|e| e.to_string())?;
    conn.execute("UPDATE accounts SET password_hash = ?1 WHERE account_id = ?2", params![new_password, account_id])
        .map_err(|e| e.to_string())?;
        
    let _ = log_audit_action(pool, active_admin_id, "UPDATE", "accounts", account_id);
    Ok(())
}

pub fn update_admin_info(pool: &DbPool, account_id: i64, username: &str, full_name: &str, active_admin_id: i64) -> Result<(), String> {
    let conn = pool.get().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE accounts SET username = ?1, full_name = ?2 WHERE account_id = ?3",
        params![username, full_name, account_id],
    ).map_err(|e| e.to_string())?;

    let _ = log_audit_action(pool, active_admin_id, "UPDATE", "accounts", account_id);
    Ok(())
}

pub fn get_dashboard_stats(pool: &DbPool) -> Result<DashboardData, String> {
    let conn = pool.get().map_err(|e| e.to_string())?;
    let today = Local::now().date_naive();
    let seven_days_ago = today - Duration::days(6);

    let total_students: i64 = conn.query_row(
        "SELECT COUNT(*) FROM persons WHERE role = 'student'", [], |row| row.get(0)
    ).unwrap_or(0);

    let total_employees: i64 = conn.query_row(
        "SELECT COUNT(*) FROM persons WHERE role IN ('professor', 'staff')", [], |row| row.get(0)
    ).unwrap_or(0);

    let total_visitors: i64 = conn.query_row(
        "SELECT COUNT(*) FROM persons WHERE role = 'visitor'", [], |row| row.get(0)
    ).unwrap_or(0);

    let entries_today: i64 = conn.query_row(
        "SELECT COUNT(*) FROM entry_logs e JOIN scanners s ON e.scanner_id = s.scanner_id WHERE s.function = 'entrance' AND DATE(e.scanned_at) = DATE('now', 'localtime')",
        [], |row| row.get(0)
    ).unwrap_or(0);

    let exits_today: i64 = conn.query_row(
        "SELECT COUNT(*) FROM entry_logs e JOIN scanners s ON e.scanner_id = s.scanner_id WHERE s.function = 'exit' AND DATE(e.scanned_at) = DATE('now', 'localtime')",
        [], |row| row.get(0)
    ).unwrap_or(0);

    let mut trend_stmt = conn.prepare(
        "SELECT DATE(e.scanned_at) AS scan_date, p.role, COUNT(DISTINCT e.person_id) AS total
         FROM entry_logs e
         JOIN persons p ON p.person_id = e.person_id
         JOIN scanners s ON s.scanner_id = e.scanner_id
         WHERE s.function = 'entrance'
           AND DATE(e.scanned_at) BETWEEN ?1 AND ?2
         GROUP BY DATE(e.scanned_at), p.role
         ORDER BY DATE(e.scanned_at) ASC"
    ).map_err(|e| e.to_string())?;

    let trend_rows = trend_stmt.query_map(
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
    ).map_err(|e| e.to_string())?;

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
            let (students, employees, visitors) = trend_lookup.get(&key).copied().unwrap_or((0, 0, 0));

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

pub fn log_event_attendance(pool: &DbPool, event_id: i64, id_number: &str) -> Result<ScanResult, String> {
    let conn = pool.get().map_err(|e| e.to_string())?;

    // 1. Fetch Event and Validate Date/Time
    let event: Event = conn.query_row(
        "SELECT event_id, event_name, event_date, start_time, end_time, required_role, is_enabled FROM events WHERE event_id = ?1",
        params![event_id],
        |row| {
            Ok(Event {
                event_id: row.get(0)?,
                event_name: row.get(1)?,
                event_date: row.get(2)?,
                start_time: row.get(3)?,
                end_time: row.get(4)?,
                required_role: row.get(5)?,
                is_enabled: row.get::<_, i32>(6)? == 1,
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

    let is_valid_day = event.event_date == current_date || 
                       event.event_date.to_lowercase() == current_day.to_lowercase() ||
                       event.event_date.to_lowercase() == format!("every {}", current_day.to_lowercase()) ||
                       event.event_date.to_lowercase() == "everyday";

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
    let mut stmt = conn.prepare("SELECT person_id, first_name, last_name, role, is_active FROM persons WHERE id_number = ?1")
        .map_err(|e| e.to_string())?;
        
    let mut person_iter = stmt.query_map(params![id_number], |row| {
        Ok((
            row.get::<_, i64>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, String>(3)?,
            row.get::<_, i32>(4)? == 1,
        ))
    }).map_err(|e| e.to_string())?;

    let person_data = person_iter.next();

    if let Some(Ok((person_id, first_name, last_name, role, is_active))) = person_data {
        if !is_active {
            return Ok(ScanResult {
                success: false,
                message: "Access Denied: ID is inactive.".to_string(),
                person_name: Some(format!("{} {}", first_name, last_name)),
                role: Some(role),
            });
        }

        // Check if role matches Required Role (unless "all")
        if event.required_role != "all" && event.required_role.to_lowercase() != role.to_lowercase() {
            return Ok(ScanResult {
                success: false,
                message: format!("Access Denied: Event requires {} role.", event.required_role),
                person_name: Some(format!("{} {}", first_name, last_name)),
                role: Some(role),
            });
        }

        // 3. Check if already recorded for this event
        let existing: Option<i64> = conn.query_row(
            "SELECT attendance_id FROM event_attendance WHERE event_id = ?1 AND person_id = ?2",
            params![event_id, person_id],
            |row| row.get(0)
        ).optional().map_err(|e| e.to_string())?;

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
        ).map_err(|e| e.to_string())?;

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
        let dept_id = add_department(&pool, Department {
            department_id: 0,
            department_code: "CS".to_string(),
            department_name: "Computer Science".to_string(),
        }).unwrap();
        
        assert_eq!(dept_id, 1);
        
        // Assert Retrieval
        let depts = get_departments(&pool).unwrap();
        assert_eq!(depts.len(), 1);
        assert_eq!(depts[0].department_name, "Computer Science");
        
        // Add Program
        let prog_id = add_program(&pool, Program {
            program_id: 0,
            department_id: dept_id,
            program_code: "BSCS".to_string(),
            program_name: "Bachelor of Science in Computer Science".to_string(),
        }).unwrap();
        
        assert_eq!(prog_id, 1);
    }
    
    #[test]
    fn test_person_and_access_log() {
        let pool = setup_memory_db();
        
        // 1. Add typical user
        let person_id = add_person(&pool, Person {
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
        }).unwrap();
        
        // 2. Add Scanner
        let scanner_id = add_scanner(&pool, Scanner {
            scanner_id: 0,
            location_name: "Main Gate".to_string(),
            function: "entrance".to_string(),
        }).unwrap();
        
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
