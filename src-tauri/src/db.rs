use r2d2::Pool;
use r2d2_sqlite::SqliteConnectionManager;
use rusqlite::{params, OptionalExtension};
use std::fs;
use tauri::Manager;
use crate::models::*;

pub type DbPool = Pool<SqliteConnectionManager>;

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
        "INSERT INTO persons (school_id_number, role, first_name, middle_name, last_name, face_template_path, is_active)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            person.school_id_number,
            person.role,
            person.first_name,
            person.middle_name,
            person.last_name,
            person.face_template_path,
            is_active
        ],
    ).map_err(|e| e.to_string())?;

    Ok(conn.last_insert_rowid())
}

pub fn get_persons(pool: &DbPool) -> Result<Vec<Person>, String> {
    let conn = pool.get().map_err(|e| e.to_string())?;
    
    let mut stmt = conn.prepare("SELECT person_id, school_id_number, role, first_name, middle_name, last_name, face_template_path, is_active FROM persons")
        .map_err(|e| e.to_string())?;
        
    let person_iter = stmt.query_map([], |row| {
        Ok(Person {
            person_id: row.get(0)?,
            school_id_number: row.get(1)?,
            role: row.get(2)?,
            first_name: row.get(3)?,
            middle_name: row.get(4).unwrap_or(None),
            last_name: row.get(5)?,
            face_template_path: row.get(6)?,
            is_active: row.get::<_, i32>(7)? == 1,
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
        "SELECT p.person_id, p.school_id_number, p.first_name, p.middle_name, p.last_name, p.is_active,
                s.program_id, pr.program_name, s.year_level
         FROM persons p
         JOIN students s ON p.person_id = s.person_id
         JOIN programs pr ON s.program_id = pr.program_id"
    ).map_err(|e| e.to_string())?;
    
    let iter = stmt.query_map([], |row| {
        Ok(StudentDetails {
            person_id: row.get(0)?,
            school_id_number: row.get(1)?,
            first_name: row.get(2)?,
            middle_name: row.get(3).unwrap_or(None),
            last_name: row.get(4)?,
            is_active: row.get::<_, i32>(5)? == 1,
            program_id: row.get(6)?,
            program_name: row.get(7)?,
            year_level: row.get(8).unwrap_or(None),
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
    school_id: &str,
    first_name: &str,
    middle_name: Option<String>,
    last_name: &str,
    program_id: Option<i64>,
    year_level: Option<i64>,
    department_id: Option<i64>,
    position_title: Option<String>,
    purpose: Option<String>,
    id_presented: Option<String>,
    contact_number: Option<String>,
) -> Result<i64, String> {
    let mut conn = pool.get().map_err(|e| e.to_string())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    tx.execute(
        "INSERT INTO persons (school_id_number, role, first_name, middle_name, last_name, is_active)
         VALUES (?1, ?2, ?3, ?4, ?5, 1)",
        params![school_id, role, first_name, middle_name, last_name],
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
                "INSERT INTO visitors (person_id, purpose_of_visit, id_presented, contact_number) VALUES (?1, ?2, ?3, ?4)",
                params![person_id, purpose.unwrap_or_default(), id_presented.unwrap_or_default(), contact_number.unwrap_or_default()],
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
    school_id: &str,
    first_name: &str,
    middle_name: Option<String>,
    last_name: &str,
    program_id: Option<i64>,
    year_level: Option<i64>,
    department_id: Option<i64>,
    position_title: Option<String>,
    purpose: Option<String>,
    id_presented: Option<String>,
    contact_number: Option<String>,
) -> Result<(), String> {
    let mut conn = pool.get().map_err(|e| e.to_string())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    tx.execute(
        "UPDATE persons SET school_id_number = ?1, first_name = ?2, middle_name = ?3, last_name = ?4
         WHERE person_id = ?5",
        params![school_id, first_name, middle_name, last_name, person_id],
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
                "UPDATE visitors SET purpose_of_visit = ?1, id_presented = ?2, contact_number = ?3 WHERE person_id = ?4",
                params![purpose.unwrap_or_default(), id_presented.unwrap_or_default(), contact_number.unwrap_or_default(), person_id],
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
        "SELECT p.person_id, p.school_id_number, p.first_name, p.middle_name, p.last_name, p.is_active,
                e.department_id, e.position_title, d.department_name
         FROM persons p
         JOIN employees e ON p.person_id = e.person_id
         JOIN departments d ON e.department_id = d.department_id"
    ).map_err(|e| e.to_string())?;
    
    let iter = stmt.query_map([], |row| {
        Ok(EmployeeDetails {
            person_id: row.get(0)?,
            school_id_number: row.get(1)?,
            first_name: row.get(2)?,
            middle_name: row.get(3).unwrap_or(None),
            last_name: row.get(4)?,
            is_active: row.get::<_, i32>(5)? == 1,
            department_id: row.get(6)?,
            position_title: row.get(7)?,
            department_name: row.get(8)?,
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
        "SELECT p.person_id, p.first_name, p.middle_name, p.last_name, v.purpose_of_visit, v.id_presented, v.contact_number,
            (SELECT MIN(e.scanned_at) FROM entry_logs e JOIN scanners s ON e.scanner_id = s.scanner_id WHERE e.person_id = p.person_id AND s.function = 'entrance' AND DATE(e.scanned_at) = DATE('now', 'localtime')) as time_in,
            (SELECT MAX(e.scanned_at) FROM entry_logs e JOIN scanners s ON e.scanner_id = s.scanner_id WHERE e.person_id = p.person_id AND s.function = 'exit' AND DATE(e.scanned_at) = DATE('now', 'localtime')) as time_out
         FROM persons p
         JOIN visitors v ON p.person_id = v.person_id
         WHERE p.role = 'visitor' AND p.is_active = 1"
    ).map_err(|e| e.to_string())?;

    let iter = stmt.query_map([], |row| {
        Ok(VisitorDetails {
            person_id: row.get(0)?,
            first_name: row.get(1)?,
            middle_name: row.get(2).unwrap_or(None),
            last_name: row.get(3)?,
            purpose_of_visit: row.get(4)?,
            id_presented: row.get(5)?,
            contact_number: row.get(6)?,
            time_in: row.get(7).unwrap_or(None),
            time_out: row.get(8).unwrap_or(None),
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
        SELECT l.log_id, l.scanned_at, p.first_name, p.last_name, p.school_id_number, p.role, s.location_name, s.function
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
                school_id_number: row.get(4)?,
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
                school_id_number: row.get(4)?,
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
                school_id_number: row.get(4)?,
                role: row.get(5)?,
                scanner_location: row.get(6)?,
                scanner_function: row.get(7)?,
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
        conn.execute(
            "INSERT INTO entry_logs (person_id, scanner_id) VALUES (?1, ?2)",
            params![person_id, scanner_id],
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

pub fn manual_id_entry(pool: &DbPool, school_id: &str, scanner_function: &str) -> Result<ScanResult, String> {
    let conn = pool.get().map_err(|e| e.to_string())?;

    let mut stmt = conn.prepare("SELECT person_id, first_name, last_name, role, is_active FROM persons WHERE school_id_number = ?1")
        .map_err(|e| e.to_string())?;
        
    let mut person_iter = stmt.query_map(params![school_id], |row| {
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

        conn.execute(
            "INSERT INTO entry_logs (person_id, scanner_id) VALUES (?1, ?2)",
            params![person_id, scanner_id],
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

pub fn admin_login(pool: &DbPool, password: &str) -> Result<bool, String> {
    let conn = pool.get().map_err(|e| e.to_string())?;
    
    let mut stmt = conn.prepare("SELECT password_hash FROM accounts WHERE username = 'admin'")
        .map_err(|e| e.to_string())?;
        
    let mut rows = stmt.query([]).map_err(|e| e.to_string())?;
    
    if let Some(row) = rows.next().map_err(|e| e.to_string())? {
        let stored_hash: String = row.get(0).map_err(|e| e.to_string())?;
        if stored_hash == password {
            return Ok(true);
        }
    }
    
    Ok(false)
}

pub fn update_admin_credentials(pool: &DbPool, current_password: &str, new_password: &str) -> Result<bool, String> {
    let conn = pool.get().map_err(|e| e.to_string())?;
    
    let mut stmt = conn.prepare("SELECT password_hash FROM accounts WHERE username = 'admin'")
        .map_err(|e| e.to_string())?;
        
    let mut rows = stmt.query([]).map_err(|e| e.to_string())?;
    
    if let Some(row) = rows.next().map_err(|e| e.to_string())? {
        let stored_hash: String = row.get(0).map_err(|e| e.to_string())?;
        if stored_hash == current_password {
            conn.execute(
                "UPDATE accounts SET password_hash = ?1 WHERE username = 'admin'",
                params![new_password],
            ).map_err(|e| e.to_string())?;
            return Ok(true);
        }
    }
    
    Ok(false)
}

pub fn get_dashboard_stats(pool: &DbPool) -> Result<DashboardData, String> {
    let conn = pool.get().map_err(|e| e.to_string())?;

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

    // Mock trend data for UI purposes until complex date grouping is implemented
    let attendance_trend = vec![
        ChartDataPoint { date: "Mon".to_string(), students: 0, employees: 0, visitors: 0 },
        ChartDataPoint { date: "Tue".to_string(), students: 0, employees: 0, visitors: 0 },
        ChartDataPoint { date: "Wed".to_string(), students: 0, employees: 0, visitors: 0 },
        ChartDataPoint { date: "Thu".to_string(), students: 0, employees: 0, visitors: 0 },
        ChartDataPoint { date: "Fri".to_string(), students: 0, employees: 0, visitors: 0 },
        ChartDataPoint { date: "Sat".to_string(), students: 0, employees: 0, visitors: 0 },
        ChartDataPoint { date: "Sun".to_string(), students: 0, employees: 0, visitors: 0 },
    ];

    Ok(DashboardData {
        total_students,
        total_employees,
        total_visitors,
        entries_today,
        exits_today,
        attendance_trend,
    })
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
            school_id_number: "2020-12345".to_string(),
            role: "student".to_string(),
            first_name: "John".to_string(),
            middle_name: None,
            last_name: "Doe".to_string(),
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
