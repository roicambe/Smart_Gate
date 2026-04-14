use rusqlite::{params, Connection, Result};
use std::env;
use std::fs;

fn main() -> Result<()> {
    let appdata = env::var("APPDATA").expect("APPDATA env var not found");
    let db_path = format!("{}\\com.tauri.dev\\smart_gate.sqlite", appdata);

    // Recreate DB: delete old to ensure latest schema is applied
    let _ = fs::remove_file(&db_path);

    let conn = Connection::open(&db_path)?;

    // Initialize with latest schema
    let schema = include_str!("../../../docs/database/schema.sql");
    conn.execute_batch(schema)
        .expect("Failed to execute schema sql");

    // 1. Ensure Department "CSS" exists
    conn.execute(
        "INSERT OR IGNORE INTO departments (department_code, department_name) VALUES (?1, ?2)",
        params!["CSS", "CSS"],
    )?;

    let dept_id: i64 = conn
        .query_row(
            "SELECT department_id FROM departments WHERE department_code = ?1",
            params!["CSS"],
            |row| row.get(0),
        )
        .unwrap_or(1);

    // 2. Ensure Program "BSIT" exists
    conn.execute(
        "INSERT OR IGNORE INTO programs (program_code, program_name, department_id) VALUES (?1, ?2, ?3)",
        params!["BSIT", "Bachelor of Science in Information Technology", dept_id],
    )?;

    let prog_id: i64 = conn
        .query_row(
            "SELECT program_id FROM programs WHERE program_code = ?1",
            params!["BSIT"],
            |row| row.get(0),
        )
        .unwrap_or(1);

    // 3. Insert Person: Roi Yvann Cambe
    conn.execute(
        "INSERT OR IGNORE INTO persons (id_number, role, first_name, middle_name, last_name, is_active)
         VALUES (?1, ?2, ?3, ?4, ?5, 1)",
        params!["23-00193", "student", "Roi Yvann", "Montemayor", "Cambe"],
    )?;

    let person_id: i64 = conn
        .query_row(
            "SELECT person_id FROM persons WHERE id_number = ?1",
            params!["23-00193"],
            |row| row.get(0),
        )
        .unwrap_or(0);

    // 4. Insert Student Record
    if person_id > 0 {
        conn.execute(
            "INSERT OR IGNORE INTO students (person_id, program_id, year_level) VALUES (?1, ?2, ?3)",
            params![person_id, prog_id, 3],
        )?;
        println!(
            "Successfully inserted student: Roi Yvann Montemayor Cambe, 23-00193, BSIT, 3rd Year"
        );
    } else {
        println!("Failed to locate inserted person ID.");
    }

    // 5. Ensure Scanners exist
    conn.execute(
        "INSERT OR IGNORE INTO scanners (location_name, function) VALUES (?1, ?2), (?3, ?4)",
        params![
            "Main Gate - Entrance",
            "entrance",
            "Main Gate - Exit",
            "exit"
        ],
    )?;
    println!("Successfully inserted default scanners.");

    Ok(())
}
