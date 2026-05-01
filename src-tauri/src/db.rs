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

fn get_person_roles(conn: &rusqlite::Connection, person_id: i64) -> Result<Vec<String>, String> {
    let mut stmt = conn
        .prepare("SELECT r.role_name FROM roles r JOIN person_roles pr ON r.role_id = pr.role_id WHERE pr.person_id = ?1")
        .map_err(|e| e.to_string())?;
    let roles = stmt
        .query_map([person_id], |row| row.get(0))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<String>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(roles)
}

fn get_person_contacts(conn: &rusqlite::Connection, person_id: i64) -> Result<Vec<PersonContact>, String> {
    let mut stmt = conn
        .prepare("SELECT contact_id, person_id, contact_type, contact_value, is_primary FROM person_contacts WHERE person_id = ?1")
        .map_err(|e| e.to_string())?;
    let contacts = stmt
        .query_map([person_id], |row| {
            Ok(PersonContact {
                contact_id: row.get(0)?,
                person_id: row.get(1)?,
                contact_type: row.get(2)?,
                contact_value: row.get(3)?,
                is_primary: row.get(4)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<PersonContact>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(contacts)
}

pub fn init_db(app_handle: &tauri::AppHandle) -> Result<DbPool, String> {
    let app_dir = app_handle
        .path()
        .app_data_dir()
        .expect("Failed to get app data directory");

    fs::create_dir_all(&app_dir).map_err(|e| format!("Failed to create App Directory: {}", e))?;

    let db_path = app_dir.join("smart_gate.sqlite");
    let manager = SqliteConnectionManager::file(&db_path);
    let pool = r2d2::Pool::new(manager).map_err(|e| format!("Failed to create database pool: {}", e))?;

    let conn = pool.get().map_err(|e| format!("Failed to get connection from pool: {}", e))?;

    // Check if migration to normalized schema is needed
    let migration_needed = table_has_column(&conn, "persons", "role").unwrap_or(false);

    if migration_needed {
        log::info!("Starting database normalization migration...");
        // Ensure foreign keys are OFF for migration to avoid constraint errors during table drops/recreation
        conn.execute("PRAGMA foreign_keys = OFF;", []).map_err(|e| e.to_string())?;
        run_normalization_migration(&conn)?;
        log::info!("Database normalization migration completed.");
    }

    // Enable foreign keys
    conn.execute("PRAGMA foreign_keys = ON;", []).map_err(|e| e.to_string())?;

    // Execute schema.sql (contains IF NOT EXISTS for everything)
    let schema = include_str!("../../docs/database/schema.sql");
    conn.execute_batch(schema).map_err(|e| format!("Failed to execute schema: {}", e))?;

    // Fix audit_events check constraint for existing databases if they lack ARCHIVE/RESTORE
    let audit_sql: String = conn.query_row(
        "SELECT sql FROM sqlite_master WHERE name='audit_events'",
        [],
        |row| row.get(0)
    ).unwrap_or_default();
    
    if !audit_sql.is_empty() && !audit_sql.contains("ARCHIVE") {
        log::info!("Updating audit_events check constraint to support ARCHIVE/RESTORE...");
        conn.execute("PRAGMA foreign_keys = OFF;", []).map_err(|e| e.to_string())?;
        conn.execute_batch("
            BEGIN TRANSACTION;
            CREATE TABLE audit_events_new (
                event_id INTEGER PRIMARY KEY AUTOINCREMENT,
                action_type TEXT CHECK(action_type IN ('CREATE', 'UPDATE', 'DELETE', 'ARCHIVE', 'RESTORE')) NOT NULL,
                entity_type TEXT NOT NULL,
                entity_id INTEGER NOT NULL,
                entity_label TEXT NOT NULL,
                performed_by INTEGER NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (performed_by) REFERENCES accounts(account_id)
            );
            INSERT INTO audit_events_new SELECT event_id, action_type, entity_type, entity_id, entity_label, performed_by, created_at FROM audit_events;
            DROP TABLE audit_events;
            ALTER TABLE audit_events_new RENAME TO audit_events;
            COMMIT;
        ").map_err(|e| e.to_string())?;
        conn.execute("PRAGMA foreign_keys = ON;", []).map_err(|e| e.to_string())?;
    }

    // Fix duplicate weekly schedules and add unique constraint if missing
    let weekly_sql: String = conn.query_row(
        "SELECT sql FROM sqlite_master WHERE name='event_weekly'",
        [],
        |row| row.get(0)
    ).unwrap_or_default();
    
    if !weekly_sql.is_empty() && !weekly_sql.contains("UNIQUE") {
        log::info!("Enforcing unique constraints on event schedules...");
        conn.execute("PRAGMA foreign_keys = OFF;", []).map_err(|e| e.to_string())?;
        conn.execute_batch("
            BEGIN TRANSACTION;
            
            -- Fix event_weekly
            CREATE TABLE event_weekly_new (
                schedule_id INTEGER PRIMARY KEY AUTOINCREMENT,
                event_id INTEGER NOT NULL,
                day_of_week TEXT NOT NULL,
                start_time TIME NOT NULL,
                end_time TIME NOT NULL,
                UNIQUE(event_id, day_of_week, start_time, end_time),
                FOREIGN KEY (event_id) REFERENCES events(event_id) ON DELETE CASCADE
            );
            INSERT OR IGNORE INTO event_weekly_new (event_id, day_of_week, start_time, end_time) 
            SELECT event_id, day_of_week, start_time, end_time FROM event_weekly;
            DROP TABLE event_weekly;
            ALTER TABLE event_weekly_new RENAME TO event_weekly;
            
            -- Fix event_date_range
            CREATE TABLE event_date_range_new (
                schedule_id INTEGER PRIMARY KEY AUTOINCREMENT,
                event_id INTEGER NOT NULL,
                start_date DATE NOT NULL,
                end_date DATE NOT NULL,
                start_time TIME NOT NULL,
                end_time TIME NOT NULL,
                UNIQUE(event_id, start_date, end_date, start_time, end_time),
                FOREIGN KEY (event_id) REFERENCES events(event_id) ON DELETE CASCADE
            );
            INSERT OR IGNORE INTO event_date_range_new (event_id, start_date, end_date, start_time, end_time)
            SELECT event_id, start_date, end_date, start_time, end_time FROM event_date_range;
            DROP TABLE event_date_range;
            ALTER TABLE event_date_range_new RENAME TO event_date_range;
            
            COMMIT;
        ").map_err(|e| e.to_string())?;
        conn.execute("PRAGMA foreign_keys = ON;", []).map_err(|e| e.to_string())?;
    }

    Ok(pool)
}

fn run_normalization_migration(conn: &rusqlite::Connection) -> Result<(), String> {
    conn.execute_batch("BEGIN TRANSACTION;")
        .map_err(|e| e.to_string())?;

    let run = || -> Result<(), String> {
        // 1. Create new tables (temporary if they exist in schema.sql already)
        // Note: We use the actual names from the new schema
        conn.execute_batch("
            CREATE TABLE IF NOT EXISTS roles (
                role_id INTEGER PRIMARY KEY AUTOINCREMENT,
                role_name TEXT UNIQUE NOT NULL
            );
            CREATE TABLE IF NOT EXISTS person_roles (
                person_id INTEGER NOT NULL,
                role_id INTEGER NOT NULL,
                PRIMARY KEY (person_id, role_id),
                FOREIGN KEY (person_id) REFERENCES persons(person_id) ON DELETE CASCADE,
                FOREIGN KEY (role_id) REFERENCES roles(role_id) ON DELETE CASCADE
            );
            CREATE TABLE IF NOT EXISTS person_contacts (
                contact_id INTEGER PRIMARY KEY AUTOINCREMENT,
                person_id INTEGER NOT NULL,
                contact_type TEXT CHECK(contact_type IN ('email', 'phone')) NOT NULL,
                contact_value TEXT NOT NULL,
                is_primary BOOLEAN NOT NULL DEFAULT 0,
                FOREIGN KEY (person_id) REFERENCES persons(person_id) ON DELETE CASCADE
            );
            CREATE TABLE IF NOT EXISTS event_weekly (
                schedule_id INTEGER PRIMARY KEY AUTOINCREMENT,
                event_id INTEGER NOT NULL,
                day_of_week TEXT NOT NULL,
                start_time TIME NOT NULL,
                end_time TIME NOT NULL,
                FOREIGN KEY (event_id) REFERENCES events(event_id) ON DELETE CASCADE
            );
            CREATE TABLE IF NOT EXISTS event_date_range (
                schedule_id INTEGER PRIMARY KEY AUTOINCREMENT,
                event_id INTEGER NOT NULL,
                start_date DATE NOT NULL,
                end_date DATE NOT NULL,
                start_time TIME NOT NULL,
                end_time TIME NOT NULL,
                FOREIGN KEY (event_id) REFERENCES events(event_id) ON DELETE CASCADE
            );
            CREATE TABLE IF NOT EXISTS event_required_roles (
                event_id INTEGER NOT NULL,
                role_id INTEGER NOT NULL,
                PRIMARY KEY (event_id, role_id),
                FOREIGN KEY (event_id) REFERENCES events(event_id) ON DELETE CASCADE,
                FOREIGN KEY (role_id) REFERENCES roles(role_id) ON DELETE CASCADE
            );
            CREATE TABLE IF NOT EXISTS scanners (
                scanner_id INTEGER PRIMARY KEY AUTOINCREMENT,
                location_name VARCHAR NOT NULL,
                function TEXT CHECK(function IN ('entrance', 'exit', 'event')) NOT NULL
            );
            CREATE TABLE IF NOT EXISTS activity_logs (
                log_id INTEGER PRIMARY KEY AUTOINCREMENT,
                person_id INTEGER NOT NULL,
                scanner_id INTEGER NOT NULL,
                activity_type TEXT CHECK(activity_type IN ('entrance', 'exit', 'event')) NOT NULL,
                event_id INTEGER NULL,
                scanned_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                status TEXT NULL,
                FOREIGN KEY (person_id) REFERENCES persons(person_id),
                FOREIGN KEY (scanner_id) REFERENCES scanners(scanner_id),
                FOREIGN KEY (event_id) REFERENCES events(event_id)
            );
            -- Ensure a default scanner exists for migrated event logs
            INSERT OR IGNORE INTO scanners (scanner_id, location_name, function) 
            VALUES (1, 'Main Gate (Migrated)', 'event');
        ").map_err(|e| e.to_string())?;

        // 2. Seed default roles
        conn.execute_batch("
            INSERT OR IGNORE INTO roles (role_name) VALUES ('student'), ('professor'), ('staff'), ('visitor'), ('dean');
        ").map_err(|e| e.to_string())?;

        // 3. Migrate Persons data (Roles and Contacts)
        let mut stmt = conn.prepare("SELECT person_id, role, email, contact_number FROM persons").map_err(|e| e.to_string())?;
        let person_rows = stmt.query_map([], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, Option<String>>(2)?,
                row.get::<_, Option<String>>(3)?,
            ))
        }).map_err(|e| e.to_string())?;

        for person in person_rows {
            let (pid, role_name, email, phone) = person.map_err(|e| e.to_string())?;
            
            // Insert role
            conn.execute(
                "INSERT INTO person_roles (person_id, role_id) 
                 SELECT ?1, role_id FROM roles WHERE role_name = ?2",
                params![pid, role_name.to_lowercase()]
            ).map_err(|e| e.to_string())?;

            // Insert contacts
            if let Some(e) = email {
                if !e.trim().is_empty() {
                    conn.execute(
                        "INSERT INTO person_contacts (person_id, contact_type, contact_value, is_primary) VALUES (?1, 'email', ?2, 1)",
                        params![pid, e]
                    ).map_err(|e| e.to_string())?;
                }
            }
            if let Some(p) = phone {
                if !p.trim().is_empty() {
                    conn.execute(
                        "INSERT INTO person_contacts (person_id, contact_type, contact_value, is_primary) VALUES (?1, 'phone', ?2, 0)",
                        params![pid, p]
                    ).map_err(|e| e.to_string())?;
                }
            }
        }

        // 4. Migrate Events data
        let mut stmt = conn.prepare("SELECT event_id, schedule_type, event_date, start_date, end_date, start_time, end_time, required_role FROM events").map_err(|e| e.to_string())?;
        let event_rows = stmt.query_map([], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, Option<String>>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, Option<String>>(3)?,
                row.get::<_, Option<String>>(4)?,
                row.get::<_, String>(5)?,
                row.get::<_, String>(6)?,
                row.get::<_, String>(7)?,
            ))
        }).map_err(|e| e.to_string())?;

        for event in event_rows {
            let (eid, s_type, e_date, s_date, end_date, s_time, end_time, req_role) = event.map_err(|e| e.to_string())?;
            
            // Migrate schedule
            match s_type.as_deref() {
                Some("weekly") => {
                    conn.execute(
                        "INSERT INTO event_weekly (event_id, day_of_week, start_time, end_time) VALUES (?1, ?2, ?3, ?4)",
                        params![eid, e_date, s_time, end_time]
                    ).map_err(|e| e.to_string())?;
                },
                Some("date_range") => {
                    if let (Some(sd), Some(ed)) = (s_date, end_date) {
                        conn.execute(
                            "INSERT INTO event_date_range (event_id, start_date, end_date, start_time, end_time) VALUES (?1, ?2, ?3, ?4, ?5)",
                            params![eid, sd, ed, s_time, end_time]
                        ).map_err(|e| e.to_string())?;
                    }
                },
                _ => {}
            }

            // Migrate required roles (CSV to junction table)
            for role in req_role.split(',') {
                let trimmed = role.trim().to_lowercase();
                if trimmed == "all" {
                    // Map 'all' to all existing roles
                    conn.execute(
                        "INSERT INTO event_required_roles (event_id, role_id) SELECT ?1, role_id FROM roles",
                        params![eid]
                    ).map_err(|e| e.to_string())?;
                } else {
                    conn.execute(
                        "INSERT INTO event_required_roles (event_id, role_id) 
                         SELECT ?1, role_id FROM roles WHERE role_name = ?2",
                        params![eid, trimmed]
                    ).map_err(|e| e.to_string())?;
                }
            }
        }

        // 5. Migrate Logs
        conn.execute_batch("
            INSERT INTO activity_logs (person_id, scanner_id, activity_type, scanned_at)
            SELECT person_id, scanner_id, 
                   CASE WHEN (SELECT function FROM scanners WHERE scanner_id = entry_logs.scanner_id) = 'entrance' THEN 'entrance' ELSE 'exit' END,
                   scanned_at
            FROM entry_logs;

            INSERT INTO activity_logs (person_id, scanner_id, activity_type, event_id, scanned_at, status)
            SELECT person_id, 1, 'event', event_id, scanned_at, status FROM event_attendance;
        ").map_err(|e| e.to_string())?;

        // 6. Finalize persons and events table cleanup
        conn.execute_batch("
            -- Recreate persons without old columns
            CREATE TABLE persons_new (
                person_id INTEGER PRIMARY KEY AUTOINCREMENT,
                id_number VARCHAR UNIQUE NOT NULL,
                first_name VARCHAR NOT NULL,
                middle_name VARCHAR NULL,
                last_name VARCHAR NOT NULL,
                face_template_path VARCHAR NULL,
                is_active BOOLEAN NOT NULL DEFAULT 1,
                is_archived BOOLEAN NOT NULL DEFAULT 0,
                archived_at DATETIME NULL,
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            INSERT INTO persons_new (person_id, id_number, first_name, middle_name, last_name, face_template_path, is_active, is_archived, archived_at, created_at)
            SELECT person_id, id_number, first_name, middle_name, last_name, face_template_path, is_active, is_archived, archived_at, created_at FROM persons;
            DROP TABLE persons;
            ALTER TABLE persons_new RENAME TO persons;

            -- Recreate events without old columns
            CREATE TABLE events_new (
                event_id INTEGER PRIMARY KEY AUTOINCREMENT,
                event_name VARCHAR UNIQUE NOT NULL,
                description TEXT NULL,
                is_enabled BOOLEAN NOT NULL DEFAULT 1,
                is_archived BOOLEAN NOT NULL DEFAULT 0,
                archived_at DATETIME NULL
            );
            INSERT INTO events_new (event_id, event_name, description, is_enabled, is_archived, archived_at)
            SELECT event_id, event_name, description, is_enabled, is_archived, archived_at FROM events;
            DROP TABLE events;
            ALTER TABLE events_new RENAME TO events;

            DROP TABLE entry_logs;
            DROP TABLE event_attendance;
        ").map_err(|e| e.to_string())?;

        Ok(())
    }();

    if let Err(e) = run {
        let _ = conn.execute("ROLLBACK;", []);
        return Err(e);
    }

    conn.execute("COMMIT;", []).map_err(|e| e.to_string())?;
    Ok(())
}

// ------ Face Embedding Storage ------

/// Persist a face embedding (512 × f32 = 2048 bytes) for a person.
/// Uses INSERT OR REPLACE so re-enrollment overwrites the old vector.
pub fn save_face_embedding(
    pool: &DbPool,
    person_id: i64,
    embedding: &[f32; 512],
) -> Result<(), String> {
    let conn = pool.get().map_err(|e| e.to_string())?;

    // Convert [f32; 512] → &[u8] (2048 bytes) — zero-copy via bytemuck-style cast
    let bytes: &[u8] = unsafe {
        std::slice::from_raw_parts(embedding.as_ptr() as *const u8, 512 * 4)
    };

    conn.execute(
        "INSERT OR REPLACE INTO face_embeddings (person_id, embedding, enrolled_at)
         VALUES (?1, ?2, datetime('now', 'localtime'))",
        params![person_id, bytes],
    )
    .map_err(|e| format!("Failed to save face embedding for person {person_id}: {e}"))?;

    log::info!("Saved face embedding for person_id={person_id}");
    Ok(())
}

/// Load all face embeddings from the database.
/// Returns `(person_id, [f32; 512])` pairs for bulk-loading the HNSW index.
pub fn load_all_face_embeddings(
    pool: &DbPool,
) -> Result<Vec<(i64, [f32; 512])>, String> {
    let conn = pool.get().map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare(
            "SELECT fe.person_id, fe.embedding
             FROM face_embeddings fe
             JOIN persons p ON p.person_id = fe.person_id
             WHERE p.is_active = 1 AND p.is_archived = 0",
        )
        .map_err(|e| e.to_string())?;

    let iter = stmt
        .query_map([], |row| {
            let person_id: i64 = row.get(0)?;
            let blob: Vec<u8> = row.get(1)?;
            Ok((person_id, blob))
        })
        .map_err(|e| e.to_string())?;

    let mut results = Vec::new();
    for item in iter {
        let (person_id, blob) = item.map_err(|e| e.to_string())?;

        if blob.len() != 512 * 4 {
            log::warn!(
                "Skipping person_id={person_id}: embedding blob is {} bytes (expected 2048)",
                blob.len()
            );
            continue;
        }

        // Convert &[u8] back to [f32; 512]
        let mut embedding = [0.0f32; 512];
        for (i, chunk) in blob.chunks_exact(4).enumerate() {
            embedding[i] = f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]);
        }

        results.push((person_id, embedding));
    }

    log::info!("Loaded {} face embeddings from database", results.len());
    Ok(results)
}

/// Remove a face embedding for a person (e.g., when un-enrolling).
pub fn delete_face_embedding(pool: &DbPool, person_id: i64) -> Result<(), String> {
    let conn = pool.get().map_err(|e| e.to_string())?;
    conn.execute(
        "DELETE FROM face_embeddings WHERE person_id = ?1",
        params![person_id],
    )
    .map_err(|e| format!("Failed to delete face embedding for person {person_id}: {e}"))?;

    log::info!("Deleted face embedding for person_id={person_id}");
    Ok(())
}

/// Returns the face registration status of all non-visitor, non-archived persons.
/// Used by the admin Face Recognition Management panel.
pub fn get_persons_face_status(pool: &DbPool) -> Result<Vec<serde_json::Value>, String> {
    let conn = pool.get().map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare(
            "SELECT
                p.person_id,
                p.id_number,
                p.first_name,
                COALESCE(p.middle_name, '') AS middle_name,
                p.last_name,
                p.is_active,
                CASE WHEN fe.embedding_id IS NOT NULL THEN 1 ELSE 0 END AS face_registered,
                fe.enrolled_at,
                COALESCE(emp_dept.department_name, stu_dept.department_name) AS department_name,
                prog.program_name,
                stu.year_level,
                emp.position_title,
                stu.is_irregular
             FROM persons p
             LEFT JOIN face_embeddings fe ON fe.person_id = p.person_id
             LEFT JOIN students stu ON p.person_id = stu.person_id
             LEFT JOIN programs prog ON stu.program_id = prog.program_id
             LEFT JOIN departments stu_dept ON prog.department_id = stu_dept.department_id
             LEFT JOIN employees emp ON p.person_id = emp.person_id
             LEFT JOIN departments emp_dept ON emp.department_id = emp_dept.department_id
             WHERE p.is_archived = 0
             ORDER BY p.last_name, p.first_name",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([], |row| {
            let person_id: i64 = row.get(0)?;
            let id_number: String = row.get(1)?;
            let first_name: String = row.get(2)?;
            let middle_name: String = row.get(3)?;
            let last_name: String = row.get(4)?;
            let is_active: bool = row.get(5)?;
            let face_registered: bool = row.get(6)?;
            let enrolled_at: Option<String> = row.get(7)?;
            let department_name: Option<String> = row.get(8)?;
            let program_name: Option<String> = row.get(9)?;
            let year_level: Option<i32> = row.get(10)?;
            let position_title: Option<String> = row.get(11)?;
            let is_irregular: Option<bool> = row.get(12)?;

            // Table format: First Last only (as requested)
            let full_name = format!("{} {}", first_name, last_name);

            Ok((person_id, id_number, first_name, middle_name, last_name, full_name, is_active, face_registered, enrolled_at, department_name, program_name, year_level, position_title, is_irregular))
        })
        .map_err(|e| e.to_string())?;

    let mut results = Vec::new();
    for row in rows {
        let (person_id, id_number, first_name, middle_name, last_name, full_name, is_active, face_registered, enrolled_at, department_name, program_name, year_level, position_title, is_irregular) = row.map_err(|e| e.to_string())?;
        
        let roles = get_person_roles(&conn, person_id)?;
        let contacts = get_person_contacts(&conn, person_id)?;

        results.push(serde_json::json!({
            "person_id": person_id,
            "id_number": id_number,
            "first_name": first_name,
            "middle_name": middle_name,
            "last_name": last_name,
            "full_name": full_name,
            "roles": roles,
            "is_active": is_active,
            "contacts": contacts,
            "face_registered": face_registered,
            "enrolled_at": enrolled_at,
            "department_name": department_name,
            "program_name": program_name,
            "year_level": year_level,
            "position_title": position_title,
            "is_irregular": is_irregular.unwrap_or(false),
        }));
    }

    Ok(results)
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
        "CREATE",
        "Department",
        target_id,
        &department.department_name,
        None,
        Some(json!({
            "department_code": department.department_code,
            "department_name": department.department_name
        })),
    );

    Ok(target_id)
}

pub fn get_departments(pool: &DbPool) -> Result<Vec<Department>, String> {
    let conn = pool.get().map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare("SELECT department_id, department_code, department_name FROM departments WHERE is_archived = 0")
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
        "Department",
        department_id,
        new_name,
        Some(json!({
            "department_code": old_code,
            "department_name": old_name
        })),
        Some(json!({
            "department_code": new_code,
            "department_name": new_name
        })),
    );

    Ok(())
}

pub fn delete_department(pool: &DbPool, department_id: i64, active_admin_id: i64) -> Result<(), String> {
    let conn = pool.get().map_err(|e| e.to_string())?;

    // Check if there are active (non-archived) programs associated
    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM programs WHERE department_id = ?1 AND is_archived = 0",
            params![department_id],
            |row| row.get(0),
        )
        .unwrap_or(0);

    if count > 0 {
        return Err("Cannot archive department because it has active programs. Please archive the programs first.".to_string());
    }

    let (deleted_code, deleted_name): (String, String) = conn.query_row(
        "SELECT department_code, department_name FROM departments WHERE department_id = ?1",
        params![department_id],
        |row| Ok((row.get(0)?, row.get(1)?))
    ).unwrap_or_default();

    let now = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    conn.execute(
        "UPDATE departments SET is_archived = 1, archived_at = ?1 WHERE department_id = ?2",
        params![now, department_id],
    )
    .map_err(|e| e.to_string())?;

    let _ = log_audit_action(
        pool,
        active_admin_id,
        "ARCHIVE",
        "Department",
        department_id,
        &deleted_name,
        Some(json!({ "department_code": deleted_code, "department_name": deleted_name })),
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
        "CREATE",
        "Program",
        target_id,
        &program.program_name,
        None,
        Some(json!({
            "department": conn.query_row("SELECT department_code FROM departments WHERE department_id = ?1", params![program.department_id], |row| row.get::<_, String>(0)).ok(),
            "program_code": program.program_code,
            "program_name": program.program_name
        })),
    );

    Ok(target_id)
}

pub fn get_programs(pool: &DbPool) -> Result<Vec<Program>, String> {
    let conn = pool.get().map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare("SELECT program_id, department_id, program_code, program_name FROM programs WHERE is_archived = 0")
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
        "Program",
        program_id,
        new_name,
        Some(json!({
            "department": conn.query_row("SELECT department_code FROM departments WHERE department_id = ?1", params![old_dept_id], |row| row.get::<_, String>(0)).ok(),
            "program_code": old_code,
            "program_name": old_name
        })),
        Some(json!({
            "department": conn.query_row("SELECT department_code FROM departments WHERE department_id = ?1", params![department_id], |row| row.get::<_, String>(0)).ok(),
            "program_code": new_code,
            "program_name": new_name
        })),
    );

    Ok(())
}

pub fn delete_program(pool: &DbPool, program_id: i64, active_admin_id: i64) -> Result<(), String> {
    let conn = pool.get().map_err(|e| e.to_string())?;

    // Check if there are active students associated
    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM students s JOIN persons p ON s.person_id = p.person_id WHERE s.program_id = ?1 AND p.is_archived = 0",
            params![program_id],
            |row| row.get(0),
        )
        .unwrap_or(0);

    if count > 0 {
        return Err("Cannot archive program because it has active students.".to_string());
    }

    let (deleted_dept_id, deleted_code, deleted_name): (i64, String, String) = conn.query_row(
        "SELECT department_id, program_code, program_name FROM programs WHERE program_id = ?1",
        params![program_id],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?))
    ).unwrap_or_default();

    let now = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    conn.execute(
        "UPDATE programs SET is_archived = 1, archived_at = ?1 WHERE program_id = ?2",
        params![now, program_id],
    )
    .map_err(|e| e.to_string())?;

    let _ = log_audit_action(
        pool,
        active_admin_id,
        "ARCHIVE",
        "Program",
        program_id,
        &deleted_name,
        Some(json!({
            "department": conn.query_row("SELECT department_code FROM departments WHERE department_id = ?1", params![deleted_dept_id], |row| row.get::<_, String>(0)).ok(),
            "program_code": deleted_code,
            "program_name": deleted_name
        })),
        None,
    );

    Ok(())
}

// ------ User Management CRUD Operations ------

pub fn get_roles(pool: &DbPool) -> Result<Vec<Role>, String> {
    let conn = pool.get().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare("SELECT role_id, role_name FROM roles ORDER BY role_id ASC")
        .map_err(|e| e.to_string())?;
    let rows = stmt.query_map([], |row| {
        Ok(Role {
            role_id: row.get(0)?,
            role_name: row.get(1)?,
        })
    }).map_err(|e| e.to_string())?;

    let mut roles = Vec::new();
    for row in rows {
        roles.push(row.map_err(|e| e.to_string())?);
    }
    Ok(roles)
}

pub fn add_person(pool: &DbPool, person: Person) -> Result<i64, String> {
    let conn = pool.get().map_err(|e| e.to_string())?;

    let is_active = if person.is_active { 1 } else { 0 };

    let now = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    conn.execute(
        "INSERT INTO persons (id_number, first_name, middle_name, last_name, face_template_path, is_active, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            person.id_number,
            person.first_name,
            person.middle_name,
            person.last_name,
            person.face_template_path,
            is_active,
            now
        ],
    ).map_err(|e| e.to_string())?;

    Ok(conn.last_insert_rowid())
}

pub fn get_persons(pool: &DbPool) -> Result<Vec<Person>, String> {
    let conn = pool.get().map_err(|e| e.to_string())?;

    let mut stmt = conn.prepare("SELECT person_id, id_number, first_name, middle_name, last_name, face_template_path, is_active FROM persons WHERE is_archived = 0")
        .map_err(|e| e.to_string())?;

    let person_iter = stmt
        .query_map([], |row| {
            Ok(Person {
                person_id: row.get(0)?,
                id_number: row.get(1)?,
                first_name: row.get(2)?,
                middle_name: row.get(3).unwrap_or(None),
                last_name: row.get(4)?,
                face_template_path: row.get(5)?,
                is_active: row.get::<_, i32>(6)? == 1,
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
    if active_admin_id <= 0 {
        return Ok(());
    }

    let mut conn = pool.get().map_err(|e| e.to_string())?;

    // Only log if the status actually changed
    let current_status: bool = conn.query_row(
        "SELECT is_active FROM persons WHERE person_id = ?1",
        params![person_id],
        |row| row.get(0)
    ).map_err(|e| e.to_string())?;

    if current_status == is_active {
        return Ok(());
    }

    conn.execute(
        "UPDATE persons SET is_active = ?1 WHERE person_id = ?2",
        params![is_active, person_id],
    )
    .map_err(|e| e.to_string())?;

    let _ = log_audit_action(
        pool,
        active_admin_id,
        "UPDATE",
        "Person",
        person_id,
        &format!("Profile Status Change ({})", if is_active { "Activated" } else { "Deactivated" }),
        Some(json!({ "is_active": current_status })),
        Some(json!({ "is_active": is_active })),
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
        "SELECT p.person_id, p.id_number, p.first_name, p.middle_name, p.last_name, p.is_active,
                s.program_id, pr.program_name, s.year_level, s.is_irregular, d.department_name
         FROM persons p
         JOIN students s ON p.person_id = s.person_id
         JOIN programs pr ON s.program_id = pr.program_id
         JOIN departments d ON pr.department_id = d.department_id
         WHERE p.is_archived = 0"
    ).map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, Option<String>>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, i32>(5)? == 1,
                row.get::<_, i64>(6)?,
                row.get::<_, String>(7)?,
                row.get::<_, Option<i64>>(8)?,
                row.get::<_, Option<bool>>(9)?,
                row.get::<_, String>(10)?,
            ))
        })
        .map_err(|e| e.to_string())?;

    let mut list = Vec::new();
    for row in rows {
        let (person_id, id_number, first_name, middle_name, last_name, is_active, program_id, program_name, year_level, is_irregular, department_name) = row.map_err(|e| e.to_string())?;
        
        let roles = get_person_roles(&conn, person_id)?;
        let contacts = get_person_contacts(&conn, person_id)?;

        list.push(StudentDetails {
            person_id,
            id_number,
            first_name,
            middle_name,
            last_name,
            roles,
            contacts,
            is_active,
            program_id,
            program_name,
            year_level,
            is_irregular,
            department_name,
        });
    }
    Ok(list)
}

pub fn promote_all_students(pool: &DbPool, active_admin_id: i64) -> Result<(), String> {
    let conn = pool.get().map_err(|e| e.to_string())?;

    conn.execute(
        "UPDATE students SET year_level = year_level + 1 WHERE year_level IS NOT NULL",
        params![],
    )
    .map_err(|e| e.to_string())?;

    let _ = log_audit_action(
        pool,
        active_admin_id,
        "UPDATE",
        "System",
        0,
        "Bulk Student Promotion",
        None,
        Some(json!({ "action": "All students year levels incremented by 1" })),
    );

    Ok(())
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
    roles: Vec<String>, // Changed from &str to Vec<String>
    id_number: &str,
    first_name: &str,
    middle_name: Option<String>,
    last_name: &str,
    emails: Vec<String>, // Changed from Option<String> to Vec<String>
    contact_numbers: Vec<String>, // Changed from Option<String> to Vec<String>
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
    let mut conn = pool.get().map_err(|e| e.to_string())?;

    // Domain validation for university roles
    let is_university_member = roles.iter().any(|r| r == "student" || r == "professor" || r == "staff");
    if is_university_member {
        let strict_email: bool = conn.query_row(
            "SELECT setting_value FROM settings WHERE setting_key = 'strict_email_domain'",
            [],
            |row| row.get::<_, String>(0).map(|v| v == "1" || v.to_lowercase() == "true")
        ).unwrap_or(false);

        if strict_email {
            if emails.is_empty() {
                return Err("Email is required for university members when strict domain is enabled.".to_string());
            }
            for email in &emails {
                if !email.to_lowercase().ends_with("@plpasig.edu.ph") {
                    return Err(format!("Invalid email domain for {}. Only @plpasig.edu.ph is allowed for university members.", email));
                }
            }
        }
    }

    let tx = conn.transaction().map_err(|e| e.to_string())?;

    let now = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    tx.execute(
        "INSERT INTO persons (id_number, first_name, middle_name, last_name, is_active, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![id_number, first_name, middle_name, last_name, is_active, now],
    ).map_err(|e| e.to_string())?;

    let person_id = tx.last_insert_rowid();

    // Insert roles
    for role_name in &roles {
        tx.execute(
            "INSERT INTO person_roles (person_id, role_id) 
             SELECT ?1, role_id FROM roles WHERE role_name = ?2",
            params![person_id, role_name.to_lowercase()],
        ).map_err(|e| format!("Failed to assign role '{}': {}", role_name, e))?;
    }

    // Insert contacts
    for (idx, email) in emails.iter().enumerate() {
        tx.execute(
            "INSERT INTO person_contacts (person_id, contact_type, contact_value, is_primary) VALUES (?1, 'email', ?2, ?3)",
            params![person_id, email, if idx == 0 { 1 } else { 0 }],
        ).map_err(|e| e.to_string())?;
    }
    for (idx, phone) in contact_numbers.iter().enumerate() {
        tx.execute(
            "INSERT INTO person_contacts (person_id, contact_type, contact_value, is_primary) VALUES (?1, 'phone', ?2, ?3)",
            params![person_id, phone, if idx == 0 && emails.is_empty() { 1 } else { 0 }],
        ).map_err(|e| e.to_string())?;
    }

    // Insert into subtype tables based on roles
    for role in &roles {
        match role.as_str() {
            "student" => {
                tx.execute(
                    "INSERT INTO students (person_id, program_id, year_level, is_irregular) VALUES (?1, ?2, ?3, ?4)",
                    params![person_id, program_id.unwrap_or(1), year_level, is_irregular.unwrap_or(false)],
                )
                .map_err(|e| e.to_string())?;
            }
            "professor" | "staff" => {
                tx.execute(
                    "INSERT INTO employees (person_id, department_id, position_title) VALUES (?1, ?2, ?3)",
                    params![person_id, department_id.unwrap_or(1), position_title.as_deref().unwrap_or("")],
                ).map_err(|e| e.to_string())?;
            }
            "visitor" => {
                tx.execute(
                    "INSERT INTO visitors (person_id, purpose_of_visit, person_to_visit) VALUES (?1, ?2, ?3)",
                    params![person_id, purpose.as_deref().unwrap_or(""), person_to_visit.as_deref().unwrap_or("")],
                ).map_err(|e| e.to_string())?;
            }
            _ => {} // Other roles might not have subtype tables
        }
    }

    // Fetch final state for accurate logging
    let final_roles = get_person_roles(&tx, person_id).unwrap_or_default();
    let final_contacts = get_person_contacts(&tx, person_id).unwrap_or_default();
    let final_emails: Vec<String> = final_contacts.iter().filter(|c| c.contact_type == "email").map(|c| c.contact_value.clone()).collect();
    let final_phones: Vec<String> = final_contacts.iter().filter(|c| c.contact_type == "phone").map(|c| c.contact_value.clone()).collect();

    tx.commit().map_err(|e| e.to_string())?;

    if let Some(admin_id) = active_admin_id {
        // Fetch names/codes for audit readability
        let conn = pool.get().map_err(|e| e.to_string())?;
        let program_code: Option<String> = program_id.and_then(|id| 
            conn.query_row("SELECT program_code FROM programs WHERE program_id = ?1", params![id], |row| row.get(0)).ok()
        );
        let dept_code: Option<String> = department_id.and_then(|id| 
            conn.query_row("SELECT department_code FROM departments WHERE department_id = ?1", params![id], |row| row.get(0)).ok()
        );

        let _ = log_audit_action(
            pool,
            admin_id,
            "CREATE",
            "Person",
            person_id,
            &format!("{} {}", first_name, last_name),
            None,
            Some(json!({
                "id_number": id_number,
                "first_name": first_name,
                "middle_name": middle_name,
                "last_name": last_name,
                "roles": final_roles,
                "emails": final_emails,
                "phones": final_phones,
                "program": program_code,
                "department": dept_code,
                "is_active": is_active
            })),
        );
    }

    Ok(person_id)
}

pub fn bulk_import_users_from_excel(
    pool: &DbPool,
    file_path: &str,
    role: &str, // This is still one role for the batch
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

    let strict_email: bool = conn.query_row(
        "SELECT setting_value FROM settings WHERE setting_key = 'strict_email_domain'",
        [],
        |row| row.get::<_, String>(0).map(|v| v == "1" || v.to_lowercase() == "true")
    ).unwrap_or(false);

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

        if strict_email {
            if email.is_empty() {
                failed_count += 1;
                error_logs.push(format!("Row {line_number}: [{first_name} {last_name}] Email is required when strict domain is enabled."));
                continue;
            } else if !email.to_lowercase().ends_with("@plpasig.edu.ph") {
                failed_count += 1;
                error_logs.push(format!("Row {line_number}: [{first_name} {last_name}] Invalid email domain. Only @plpasig.edu.ph is allowed."));
                continue;
            }
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
            let now = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
            tx.execute(
                "INSERT INTO persons (id_number, first_name, middle_name, last_name, is_active, created_at)
                 VALUES (?1, ?2, ?3, ?4, 1, ?5)",
                params![
                    id_number,
                    first_name,
                    if middle_name.is_empty() { None::<String> } else { Some(middle_name.clone()) },
                    last_name,
                    now
                ],
            )
            .map_err(|e| e.to_string())?;

            let person_id = tx.last_insert_rowid();

            // Link role
            tx.execute(
                "INSERT INTO person_roles (person_id, role_id) SELECT ?1, role_id FROM roles WHERE role_name = ?2",
                params![person_id, role],
            ).map_err(|e| e.to_string())?;

            // Link contacts
            if !email.is_empty() {
                tx.execute(
                    "INSERT INTO person_contacts (person_id, contact_type, contact_value, is_primary) VALUES (?1, 'email', ?2, 1)",
                    params![person_id, email],
                ).map_err(|e| e.to_string())?;
            }
            if !contact_number.is_empty() {
                tx.execute(
                    "INSERT INTO person_contacts (person_id, contact_type, contact_value, is_primary) VALUES (?1, 'phone', ?2, ?3)",
                    params![person_id, contact_number, if email.is_empty() { 1 } else { 0 }],
                ).map_err(|e| e.to_string())?;
            }

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
            "CREATE",
            "Person",
            0,
            &format!("Bulk Import ({})", role_label),
            None,
            Some(
                json!({
                    "summary": summary,
                    "role": role,
                    "count": success_count,
                    "id_numbers": imported_ids
                })
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
    roles: Vec<String>,
    id_number: &str,
    first_name: &str,
    middle_name: Option<String>,
    last_name: &str,
    emails: Vec<String>,
    contact_numbers: Vec<String>,
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
    let mut conn = pool.get().map_err(|e| e.to_string())?;

    // Domain validation
    let is_university_member = roles.iter().any(|r| r == "student" || r == "professor" || r == "staff");
    if is_university_member {
        let strict_email: bool = conn.query_row(
            "SELECT setting_value FROM settings WHERE setting_key = 'strict_email_domain'",
            [],
            |row| row.get::<_, String>(0).map(|v| v == "1" || v.to_lowercase() == "true")
        ).unwrap_or(false);

        if strict_email {
            if emails.is_empty() {
                return Err("Email is required for university members when strict domain is enabled.".to_string());
            }
            for email in &emails {
                if !email.to_lowercase().ends_with("@plpasig.edu.ph") {
                    return Err(format!("Invalid email domain for {}. Only @plpasig.edu.ph is allowed for university members.", email));
                }
            }
        }
    }

    let tx = conn.transaction().map_err(|e| e.to_string())?;

    // Fetch old data for audit log
    let old_roles = get_person_roles(&tx, person_id)?;
    let old_contacts = get_person_contacts(&tx, person_id)?;
    let old_person_data: (String, String, Option<String>, String, bool) = tx.query_row(
        "SELECT id_number, first_name, middle_name, last_name, is_active FROM persons WHERE person_id = ?1",
        params![person_id],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?))
    ).map_err(|e| e.to_string())?;

    let old_emails: Vec<String> = old_contacts.iter().filter(|c| c.contact_type == "email").map(|c| c.contact_value.clone()).collect();
    let old_phones: Vec<String> = old_contacts.iter().filter(|c| c.contact_type == "phone").map(|c| c.contact_value.clone()).collect();

    let old_program_code: Option<String> = tx.query_row(
        "SELECT p.program_code FROM students s JOIN programs p ON s.program_id = p.program_id WHERE s.person_id = ?1",
        params![person_id],
        |row| row.get(0)
    ).ok();

    let old_dept_code: Option<String> = tx.query_row(
        "SELECT d.department_code FROM employees e JOIN departments d ON e.department_id = d.department_id WHERE e.person_id = ?1",
        params![person_id],
        |row| row.get(0)
    ).ok();

    let old_data = json!({
        "id_number": old_person_data.0,
        "first_name": old_person_data.1,
        "middle_name": old_person_data.2,
        "last_name": old_person_data.3,
        "roles": old_roles,
        "emails": old_emails,
        "phones": old_phones,
        "program": old_program_code,
        "department": old_dept_code,
        "is_active": old_person_data.4
    });

    // Update core person data
    tx.execute(
        "UPDATE persons
         SET id_number = ?1, first_name = ?2, middle_name = ?3, last_name = ?4, is_active = ?5
         WHERE person_id = ?6",
        params![id_number, first_name, middle_name, last_name, is_active, person_id],
    ).map_err(|e| e.to_string())?;

    // Update roles (replace)
    tx.execute("DELETE FROM person_roles WHERE person_id = ?1", params![person_id]).map_err(|e| e.to_string())?;
    for role_name in &roles {
        tx.execute(
            "INSERT INTO person_roles (person_id, role_id) 
             SELECT ?1, role_id FROM roles WHERE role_name = ?2",
            params![person_id, role_name.to_lowercase()],
        ).map_err(|e| e.to_string())?;
    }

    // Update contacts (replace)
    tx.execute("DELETE FROM person_contacts WHERE person_id = ?1", params![person_id]).map_err(|e| e.to_string())?;
    for (idx, email) in emails.iter().enumerate() {
        tx.execute(
            "INSERT INTO person_contacts (person_id, contact_type, contact_value, is_primary) VALUES (?1, 'email', ?2, ?3)",
            params![person_id, email, if idx == 0 { 1 } else { 0 }],
        ).map_err(|e| e.to_string())?;
    }
    for (idx, phone) in contact_numbers.iter().enumerate() {
        tx.execute(
            "INSERT INTO person_contacts (person_id, contact_type, contact_value, is_primary) VALUES (?1, 'phone', ?2, ?3)",
            params![person_id, phone, if idx == 0 && emails.is_empty() { 1 } else { 0 }],
        ).map_err(|e| e.to_string())?;
    }

    // Update subtypes
    // Clear old subtypes first? Or just update if exists.
    // Given a person can have multiple roles, they can exist in multiple subtype tables.
    
    // Students
    if roles.iter().any(|r| r == "student") {
        tx.execute(
            "INSERT OR REPLACE INTO students (person_id, program_id, year_level, is_irregular) VALUES (?1, ?2, ?3, ?4)",
            params![person_id, program_id.unwrap_or(1), year_level, is_irregular.unwrap_or(false)],
        ).map_err(|e| e.to_string())?;
    } else {
        tx.execute("DELETE FROM students WHERE person_id = ?1", params![person_id]).map_err(|e| e.to_string())?;
    }

    // Employees
    if roles.iter().any(|r| r == "professor" || r == "staff") {
        tx.execute(
            "INSERT OR REPLACE INTO employees (person_id, department_id, position_title) VALUES (?1, ?2, ?3)",
            params![person_id, department_id.unwrap_or(1), position_title.as_deref().unwrap_or("")],
        ).map_err(|e| e.to_string())?;
    } else {
        tx.execute("DELETE FROM employees WHERE person_id = ?1", params![person_id]).map_err(|e| e.to_string())?;
    }

    // Visitors
    if roles.iter().any(|r| r == "visitor") {
        tx.execute(
            "INSERT OR REPLACE INTO visitors (person_id, purpose_of_visit, person_to_visit) VALUES (?1, ?2, ?3)",
            params![person_id, purpose.as_deref().unwrap_or(""), person_to_visit.as_deref().unwrap_or("")],
        ).map_err(|e| e.to_string())?;
    } else {
        tx.execute("DELETE FROM visitors WHERE person_id = ?1", params![person_id]).map_err(|e| e.to_string())?;
    }

    tx.commit().map_err(|e| e.to_string())?;

    let new_program_code: Option<String> = program_id.and_then(|id| 
        conn.query_row("SELECT program_code FROM programs WHERE program_id = ?1", params![id], |row| row.get(0)).ok()
    );
    let new_dept_code: Option<String> = department_id.and_then(|id| 
        conn.query_row("SELECT department_code FROM departments WHERE department_id = ?1", params![id], |row| row.get(0)).ok()
    );

    let new_data = json!({
        "id_number": id_number,
        "first_name": first_name,
        "middle_name": middle_name,
        "last_name": last_name,
        "roles": roles,
        "emails": emails,
        "phones": contact_numbers,
        "program": new_program_code,
        "department": new_dept_code,
        "is_active": is_active
    });

    let _ = log_audit_action(
        pool,
        active_admin_id,
        "UPDATE",
        "Person",
        person_id,
        &format!("{} {}", first_name, last_name),
        Some(old_data),
        Some(new_data),
    );

    Ok(())
}

pub fn delete_user(pool: &DbPool, person_id: i64, _role: &str, active_admin_id: i64) -> Result<(), String> {
    let conn = pool.get().map_err(|e| e.to_string())?;

    let old_roles = get_person_roles(&conn, person_id)?;
    let old_contacts = get_person_contacts(&conn, person_id)?;
    let old_person_data: (String, String, Option<String>, String) = conn.query_row(
        "SELECT id_number, first_name, middle_name, last_name FROM persons WHERE person_id = ?1",
        params![person_id],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
    ).map_err(|e| e.to_string())?;

    let old_data = json!({
        "id_number": old_person_data.0,
        "first_name": old_person_data.1,
        "middle_name": old_person_data.2,
        "last_name": old_person_data.3,
        "roles": old_roles,
        "contacts": old_contacts
    });

    let now = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    conn.execute(
        "UPDATE persons SET is_archived = 1, archived_at = ?1 WHERE person_id = ?2",
        params![now, person_id],
    )
    .map_err(|e| e.to_string())?;

    let _ = log_audit_action(
        pool,
        active_admin_id,
        "ARCHIVE",
        "Person",
        person_id,
        &format!("{} {}", old_person_data.1, old_person_data.3),
        Some(old_data),
        None,
    );

    Ok(())
}

pub fn get_employees(pool: &DbPool) -> Result<Vec<EmployeeDetails>, String> {
    let conn = pool.get().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare(
        "SELECT p.person_id, p.id_number, p.first_name, p.middle_name, p.last_name, p.is_active,
                e.department_id, e.position_title, d.department_name
         FROM persons p
         JOIN employees e ON p.person_id = e.person_id
         JOIN departments d ON e.department_id = d.department_id
         WHERE p.is_archived = 0"
    ).map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, Option<String>>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, i32>(5)? == 1,
                row.get::<_, i64>(6)?,
                row.get::<_, String>(7)?,
                row.get::<_, String>(8)?,
            ))
        })
        .map_err(|e| e.to_string())?;

    let mut list = Vec::new();
    for row in rows {
        let (person_id, id_number, first_name, middle_name, last_name, is_active, department_id, position_title, department_name) = row.map_err(|e| e.to_string())?;
        
        let roles = get_person_roles(&conn, person_id)?;
        let contacts = get_person_contacts(&conn, person_id)?;

        list.push(EmployeeDetails {
            person_id,
            id_number,
            first_name,
            middle_name,
            last_name,
            roles,
            contacts,
            is_active,
            department_id,
            position_title,
            department_name,
        });
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

    let query = format!(
        "SELECT p.person_id, p.id_number, p.first_name, p.middle_name, p.last_name, v.purpose_of_visit, v.person_to_visit, p.created_at,
            (SELECT MIN(scanned_at) FROM activity_logs WHERE person_id = p.person_id AND activity_type = 'entrance') as time_in,
            (SELECT MAX(scanned_at) FROM activity_logs WHERE person_id = p.person_id AND activity_type = 'exit') as time_out
         FROM persons p
         JOIN visitors v ON p.person_id = v.person_id
         WHERE p.is_archived = 0
         ORDER BY p.created_at {order_direction}"
    );

    let mut stmt = conn.prepare(&query).map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, Option<String>>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, String>(5)?,
                row.get::<_, String>(6)?,
                row.get::<_, Option<String>>(7)?,
                row.get::<_, Option<String>>(8)?,
                row.get::<_, Option<String>>(9)?,
            ))
        })
        .map_err(|e| e.to_string())?;

    let mut list = Vec::new();
    for row in rows {
        let (person_id, id_number, first_name, middle_name, last_name, purpose, person_to_visit, created_at, time_in, time_out) = row.map_err(|e| e.to_string())?;
        
        let contacts = get_person_contacts(&conn, person_id)?;

        list.push(VisitorDetails {
            person_id,
            id_number,
            first_name,
            middle_name,
            last_name,
            contacts,
            purpose_of_visit: purpose,
            person_to_visit,
            created_at,
            time_in,
            time_out,
        });
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
        "CREATE",
        "Scanner",
        target_id,
        &scanner.location_name,
        None,
        Some(json!({
            "location_name": scanner.location_name,
            "function": scanner.function
        })),
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
    department_id: Option<i64>,
    program_id: Option<i64>,
    year_level: Option<i64>,
    search_term: Option<String>,
    start_date: Option<String>,
    end_date: Option<String>,
) -> Result<Vec<ActivityLogDetails>, String> {
    let conn = pool.get().map_err(|e| e.to_string())?;

    let base_query = "
        SELECT l.log_id, l.scanned_at, p.first_name, p.last_name, p.id_number, 
               COALESCE(d_s.department_name, d_e.department_name, 'N/A') as department_name, 
               s.location_name, l.activity_type, e.event_name, l.status, p.person_id
        FROM activity_logs l
        JOIN persons p ON l.person_id = p.person_id
        JOIN scanners s ON l.scanner_id = s.scanner_id
        LEFT JOIN events e ON l.event_id = e.event_id
        LEFT JOIN students stu ON p.person_id = stu.person_id
        LEFT JOIN programs prog ON stu.program_id = prog.program_id
        LEFT JOIN departments d_s ON prog.department_id = d_s.department_id
        LEFT JOIN employees emp ON p.person_id = emp.person_id
        LEFT JOIN departments d_e ON emp.department_id = d_e.department_id
        WHERE 1=1
        AND (?1 IS NULL OR EXISTS (SELECT 1 FROM person_roles pr JOIN roles r ON pr.role_id = r.role_id WHERE pr.person_id = p.person_id AND r.role_name = ?1))
        AND (?2 IS NULL OR l.activity_type = ?2)
        AND (?3 IS NULL OR COALESCE(prog.department_id, emp.department_id) = ?3)
        AND (?4 IS NULL OR prog.program_id = ?4)
        AND (?5 IS NULL OR stu.year_level = ?5)
        AND (?6 IS NULL OR p.first_name LIKE '%' || ?6 || '%' OR p.last_name LIKE '%' || ?6 || '%' OR p.id_number LIKE '%' || ?6 || '%')
        AND (?7 IS NULL OR DATE(l.scanned_at) >= DATE(?7))
        AND (?8 IS NULL OR DATE(l.scanned_at) <= DATE(?8))
        ORDER BY l.scanned_at DESC LIMIT 500
    ";

    let mut stmt = conn.prepare(&base_query).map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map(
            params![
                role_filter,
                action_type,
                department_id,
                program_id,
                year_level,
                search_term,
                start_date,
                end_date
            ],
            |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, String>(5)?,
                    row.get::<_, String>(6)?,
                    row.get::<_, String>(7)?,
                    row.get::<_, Option<String>>(8)?,
                    row.get::<_, Option<String>>(9)?,
                    row.get::<_, i64>(10)?,
                ))
            },
        )
        .map_err(|e| e.to_string())?;

    let mut list = Vec::new();
    for row in rows {
        let (log_id, scanned_at, first_name, last_name, id_number, dept_name, scanner_loc, activity_type, event_name, status, person_id) = row.map_err(|e| e.to_string())?;
        
        let roles = get_person_roles(&conn, person_id)?;

        list.push(ActivityLogDetails {
            log_id,
            scanned_at,
            person_name: format!("{} {}", first_name, last_name),
            id_number,
            roles,
            department_name: Some(dept_name),
            scanner_location: scanner_loc,
            activity_type,
            event_name,
            status,
        });
    }
    Ok(list)
}

pub fn get_event_attendance_logs(
    pool: &DbPool,
    start_date: Option<String>,
    end_date: Option<String>,
    department_id: Option<i64>,
    program_id: Option<i64>,
    year_level: Option<i64>,
) -> Result<Vec<ActivityLogDetails>, String> {
    // This is now similar to get_access_logs but filtered for activity_type = 'event'
    get_access_logs(pool, None, Some("event".to_string()), department_id, program_id, year_level, None, start_date, end_date)
}

pub fn add_event(
    pool: &DbPool, 
    event_details: EventDetails, // Changed to handle complex structure
    active_admin_id: i64
) -> Result<i64, String> {
    let mut conn = pool.get().map_err(|e| e.to_string())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    tx.execute(
        "INSERT INTO events (event_name, description, is_enabled) VALUES (?1, ?2, ?3)",
        params![
            event_details.event.event_name,
            event_details.event.description,
            event_details.event.is_enabled
        ],
    ).map_err(|e| e.to_string())?;

    let event_id = tx.last_insert_rowid();

    // Insert weekly schedules
    for s in &event_details.weekly_schedules {
        tx.execute(
            "INSERT INTO event_weekly (event_id, day_of_week, start_time, end_time) VALUES (?1, ?2, ?3, ?4)",
            params![event_id, s.day_of_week, s.start_time, s.end_time],
        ).map_err(|e| e.to_string())?;
    }

    // Insert date range schedules
    for s in &event_details.date_range_schedules {
        tx.execute(
            "INSERT INTO event_date_range (event_id, start_date, end_date, start_time, end_time) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![event_id, s.start_date, s.end_date, s.start_time, s.end_time],
        ).map_err(|e| e.to_string())?;
    }

    // Insert required roles
    for role in &event_details.required_roles {
        tx.execute(
            "INSERT INTO event_required_roles (event_id, role_id) VALUES (?1, ?2)",
            params![event_id, role.role_id],
        ).map_err(|e| e.to_string())?;
    }

    tx.commit().map_err(|e| e.to_string())?;

    let _ = log_audit_action(
        pool,
        active_admin_id,
        "CREATE",
        "Event",
        event_id,
        &event_details.event.event_name,
        None,
        Some(json!({
            "event_name": event_details.event.event_name,
            "description": event_details.event.description,
            "is_enabled": event_details.event.is_enabled,
            "weekly_schedules": event_details.weekly_schedules.len(),
            "date_range_schedules": event_details.date_range_schedules.len()
        })),
    );

    Ok(event_id)
}

pub fn get_events(pool: &DbPool) -> Result<Vec<EventDetails>, String> {
    let conn = pool.get().map_err(|e| e.to_string())?;

    let mut stmt = conn.prepare("SELECT event_id, event_name, description, is_enabled FROM events WHERE is_archived = 0")
        .map_err(|e| e.to_string())?;

    let event_rows = stmt
        .query_map([], |row| {
            Ok(Event {
                event_id: row.get(0)?,
                event_name: row.get(1)?,
                description: row.get(2)?,
                is_enabled: row.get::<_, i32>(3)? == 1,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut list = Vec::new();
    for event in event_rows {
        let event = event.map_err(|e| e.to_string())?;
        let event_id = event.event_id;

        // Get weekly schedules
        let mut stmt_w = conn.prepare("SELECT schedule_id, event_id, day_of_week, start_time, end_time FROM event_weekly WHERE event_id = ?1").map_err(|e| e.to_string())?;
        let weekly = stmt_w.query_map([event_id], |row| {
            Ok(EventWeeklySchedule {
                schedule_id: row.get(0)?,
                event_id: row.get(1)?,
                day_of_week: row.get(2)?,
                start_time: row.get(3)?,
                end_time: row.get(4)?,
            })
        }).map_err(|e| e.to_string())?.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?;

        // Get date range schedules
        let mut stmt_d = conn.prepare("SELECT schedule_id, event_id, start_date, end_date, start_time, end_time FROM event_date_range WHERE event_id = ?1").map_err(|e| e.to_string())?;
        let date_range = stmt_d.query_map([event_id], |row| {
            Ok(EventDateRangeSchedule {
                schedule_id: row.get(0)?,
                event_id: row.get(1)?,
                start_date: row.get(2)?,
                end_date: row.get(3)?,
                start_time: row.get(4)?,
                end_time: row.get(5)?,
            })
        }).map_err(|e| e.to_string())?.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?;

        // Get required roles
        let mut stmt_r = conn.prepare("SELECT r.role_id, r.role_name FROM roles r JOIN event_required_roles err ON r.role_id = err.role_id WHERE err.event_id = ?1").map_err(|e| e.to_string())?;
        let roles = stmt_r.query_map([event_id], |row| {
            Ok(Role {
                role_id: row.get(0)?,
                role_name: row.get(1)?,
            })
        }).map_err(|e| e.to_string())?.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?;

        list.push(EventDetails {
            event,
            weekly_schedules: weekly,
            date_range_schedules: date_range,
            required_roles: roles,
        });
    }

    Ok(list)
}

pub fn update_event(
    pool: &DbPool, 
    event_id: i64, 
    event_details: EventDetails, 
    active_admin_id: i64
) -> Result<(), String> {
    let mut conn = pool.get().map_err(|e| e.to_string())?;
    
    // Audit data collection (Simplified for brevity, usually you'd want the whole struct)
    let old_name: String = conn.query_row("SELECT event_name FROM events WHERE event_id = ?1", params![event_id], |row| row.get(0)).map_err(|e| e.to_string())?;

    let tx = conn.transaction().map_err(|e| e.to_string())?;

    tx.execute(
        "UPDATE events SET event_name = ?1, description = ?2, is_enabled = ?3 WHERE event_id = ?4",
        params![
            event_details.event.event_name,
            event_details.event.description,
            event_details.event.is_enabled,
            event_id
        ],
    ).map_err(|e| e.to_string())?;

    // Update schedules (replace)
    tx.execute("DELETE FROM event_weekly WHERE event_id = ?1", params![event_id]).map_err(|e| e.to_string())?;
    for s in &event_details.weekly_schedules {
        tx.execute(
            "INSERT INTO event_weekly (event_id, day_of_week, start_time, end_time) VALUES (?1, ?2, ?3, ?4)",
            params![event_id, s.day_of_week, s.start_time, s.end_time],
        ).map_err(|e| e.to_string())?;
    }

    tx.execute("DELETE FROM event_date_range WHERE event_id = ?1", params![event_id]).map_err(|e| e.to_string())?;
    for s in &event_details.date_range_schedules {
        tx.execute(
            "INSERT INTO event_date_range (event_id, start_date, end_date, start_time, end_time) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![event_id, s.start_date, s.end_date, s.start_time, s.end_time],
        ).map_err(|e| e.to_string())?;
    }

    // Update roles
    tx.execute("DELETE FROM event_required_roles WHERE event_id = ?1", params![event_id]).map_err(|e| e.to_string())?;
    for role in &event_details.required_roles {
        tx.execute(
            "INSERT INTO event_required_roles (event_id, role_id) VALUES (?1, ?2)",
            params![event_id, role.role_id],
        ).map_err(|e| e.to_string())?;
    }

    tx.commit().map_err(|e| e.to_string())?;

    let _ = log_audit_action(
        pool,
        active_admin_id,
        "UPDATE",
        "Event",
        event_id,
        &event_details.event.event_name,
        Some(json!({ "event_name": old_name })),
        Some(json!({
            "event_name": event_details.event.event_name,
            "description": event_details.event.description,
            "is_enabled": event_details.event.is_enabled
        })),
    );

    Ok(())
}

pub fn delete_event(pool: &DbPool, event_id: i64, active_admin_id: i64) -> Result<(), String> {
    let conn = pool.get().map_err(|e| e.to_string())?;

    let old_data: Option<serde_json::Value> = conn.query_row(
        "SELECT event_name, description, schedule_type, event_date, start_date, end_date, start_time, end_time, required_role, required_programs, required_year_levels, is_enabled FROM events WHERE event_id = ?1",
        params![event_id],
        |row| {
           Ok(json!({
               "event_name": row.get::<_, String>(0)?,
               "description": row.get::<_, Option<String>>(1)?,
               "schedule_type": row.get::<_, String>(2)?,
               "event_date": row.get::<_, Option<String>>(3)?,
               "start_date": row.get::<_, Option<String>>(4)?,
               "end_date": row.get::<_, Option<String>>(5)?,
               "start_time": row.get::<_, String>(6)?,
               "end_time": row.get::<_, String>(7)?,
               "required_role": row.get::<_, String>(8)?,
               "required_programs": row.get::<_, Option<String>>(9)?,
               "required_year_levels": row.get::<_, Option<String>>(10)?,
               "is_enabled": row.get::<_, i32>(11)? == 1
           }))
        }
    ).ok();
    let now = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    conn.execute(
        "UPDATE events SET is_archived = 1, archived_at = ?1 WHERE event_id = ?2",
        params![now, event_id],
    )
    .map_err(|e| e.to_string())?;

    let label = old_data.as_ref().and_then(|v| v.get("event_name")).and_then(|v| v.as_str()).unwrap_or("Unknown Event").to_string();
    let _ = log_audit_action(
        pool,
        active_admin_id,
        "ARCHIVE",
        "Event",
        event_id,
        &label,
        old_data,
        None,
    );

    Ok(())
}

// ------ Access Logging & Business Rules ------

pub fn log_entry(pool: &DbPool, scanner_id: i64, person_id: i64) -> Result<ScanResult, String> {
    let conn = pool.get().map_err(|e| e.to_string())?;

    // 1. Check if person exists and is active
    let mut stmt = conn.prepare("SELECT first_name, last_name, is_active, DATE(created_at) == DATE('now', 'localtime') as is_created_today FROM persons WHERE person_id = ?1")
        .map_err(|e| e.to_string())?;

    let person_data = stmt.query_row(params![person_id], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, bool>(2)?,
            row.get::<_, bool>(3)?,
        ))
    }).optional().map_err(|e| e.to_string())?;

    if let Some((first_name, last_name, is_active, is_created_today)) = person_data {
        let roles = get_person_roles(&conn, person_id)?;
        
        if !is_active {
            return Ok(ScanResult {
                success: false,
                message: "Access Denied: ID is inactive.".to_string(),
                person_name: Some(format!("{} {}", first_name, last_name)),
                roles: Some(roles),
            });
        }

        // 2. Check scanner function
        let scanner: Scanner = conn.query_row(
            "SELECT scanner_id, location_name, function FROM scanners WHERE scanner_id = ?1",
            params![scanner_id],
            |row| Ok(Scanner {
                scanner_id: row.get(0)?,
                location_name: row.get(1)?,
                function: row.get(2)?,
            })
        ).map_err(|e| e.to_string())?;

        // 3. Logic check based on activity_logs
        let last_log: Option<String> = conn.query_row(
            "SELECT activity_type FROM activity_logs WHERE person_id = ?1 AND activity_type IN ('entrance', 'exit') ORDER BY scanned_at DESC LIMIT 1",
            params![person_id],
            |row| row.get(0)
        ).optional().map_err(|e| e.to_string())?;

        if scanner.function == "exit" {
            if last_log.as_deref() != Some("entrance") {
                return Ok(ScanResult {
                    success: false,
                    message: "No entry record found for this ID".to_string(),
                    person_name: Some(format!("{} {}", first_name, last_name)),
                    roles: Some(roles),
                });
            }
        } else if scanner.function == "entrance" {
            // Visitor expiration
            if roles.iter().any(|r| r == "visitor") && !is_created_today {
                let _ = conn.execute("UPDATE persons SET is_active = 0 WHERE person_id = ?1", params![person_id]);
                return Ok(ScanResult {
                    success: false,
                    message: "Access Denied: This Visitor Pass expired at 11:59 PM yesterday. Please re-register.".to_string(),
                    person_name: Some(format!("{} {}", first_name, last_name)),
                    roles: Some(roles),
                });
            }

            if last_log.as_deref() == Some("entrance") {
                return Ok(ScanResult {
                    success: false,
                    message: "User is already on campus".to_string(),
                    person_name: Some(format!("{} {}", first_name, last_name)),
                    roles: Some(roles),
                });
            }
        }

        // 4. Log the activity
        let now = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
        conn.execute(
            "INSERT INTO activity_logs (person_id, scanner_id, activity_type, scanned_at) VALUES (?1, ?2, ?3, ?4)",
            params![person_id, scanner_id, scanner.function, now],
        ).map_err(|e| e.to_string())?;

        // 5. Visitor auto-deactivation on exit
        if scanner.function == "exit" && roles.iter().any(|r| r == "visitor") {
            let _ = conn.execute("UPDATE persons SET is_active = 0 WHERE person_id = ?1", params![person_id]);
        }

        Ok(ScanResult {
            success: true,
            message: format!("{} Successful.", if scanner.function == "entrance" { "Entry" } else { "Exit" }),
            person_name: Some(format!("{} {}", first_name, last_name)),
            roles: Some(roles),
        })
    } else {
        Ok(ScanResult {
            success: false,
            message: "Access Denied: ID not found.".to_string(),
            person_name: None,
            roles: None,
        })
    }
}

pub fn get_id_number_from_person_id(pool: &DbPool, person_id: i64) -> Result<String, String> {
    let conn = pool.get().map_err(|e| e.to_string())?;
    conn.query_row(
        "SELECT id_number FROM persons WHERE person_id = ?1",
        params![person_id],
        |row| row.get(0),
    )
    .map_err(|e| format!("Failed to find ID number for person_id {}: {}", person_id, e))
}

pub fn manual_id_entry(
    pool: &DbPool,
    id_number: &str,
    scanner_function: &str,
) -> Result<ScanResult, String> {
    let conn = pool.get().map_err(|e| e.to_string())?;

    let mut stmt = conn.prepare("SELECT person_id, first_name, last_name, is_active, DATE(created_at) == DATE('now', 'localtime') as is_created_today FROM persons WHERE id_number = ?1")
        .map_err(|e| e.to_string())?;

    let person_data = stmt.query_row(params![id_number], |row| {
        Ok((
            row.get::<_, i64>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, bool>(3)?,
            row.get::<_, bool>(4)?,
        ))
    }).optional().map_err(|e| e.to_string())?;

    if let Some((person_id, first_name, last_name, is_active, is_created_today)) = person_data {
        let roles = get_person_roles(&conn, person_id)?;

        if !is_active {
            return Ok(ScanResult {
                success: false,
                message: "Access Denied: ID is inactive.".to_string(),
                person_name: Some(format!("{} {}", first_name, last_name)),
                roles: Some(roles),
            });
        }

        // Find an appropriate scanner ID for logging (mocking based on function)
        let scanner: Scanner = conn.query_row(
            "SELECT scanner_id, location_name, function FROM scanners WHERE function = ?1 LIMIT 1",
            params![scanner_function],
            |row| Ok(Scanner {
                scanner_id: row.get(0)?,
                location_name: row.get(1)?,
                function: row.get(2)?,
            })
        ).unwrap_or(Scanner { scanner_id: 1, location_name: "Manual".to_string(), function: scanner_function.to_string() });

        // Logic Check
        let last_log: Option<String> = conn.query_row(
            "SELECT activity_type FROM activity_logs WHERE person_id = ?1 AND activity_type IN ('entrance', 'exit') ORDER BY scanned_at DESC LIMIT 1",
            params![person_id],
            |row| row.get(0)
        ).optional().map_err(|e| e.to_string())?;

        if scanner.function == "exit" {
            if last_log.as_deref() != Some("entrance") {
                return Ok(ScanResult {
                    success: false,
                    message: "No entry record found for this ID".to_string(),
                    person_name: Some(format!("{} {}", first_name, last_name)),
                    roles: Some(roles),
                });
            }
        } else if scanner.function == "entrance" {
            // Visitor expiration
            if roles.iter().any(|r| r == "visitor") && !is_created_today {
                let _ = conn.execute("UPDATE persons SET is_active = 0 WHERE person_id = ?1", params![person_id]);
                return Ok(ScanResult {
                    success: false,
                    message: "Access Denied: This Visitor Pass expired at 11:59 PM yesterday. Please re-register.".to_string(),
                    person_name: Some(format!("{} {}", first_name, last_name)),
                    roles: Some(roles),
                });
            }

            if last_log.as_deref() == Some("entrance") {
                return Ok(ScanResult {
                    success: false,
                    message: "User is already on campus".to_string(),
                    person_name: Some(format!("{} {}", first_name, last_name)),
                    roles: Some(roles),
                });
            }
        }

        let now = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
        conn.execute(
            "INSERT INTO activity_logs (person_id, scanner_id, activity_type, scanned_at) VALUES (?1, ?2, ?3, ?4)",
            params![person_id, scanner.scanner_id, scanner.function, now],
        ).map_err(|e| e.to_string())?;

        // Visitor destruction on exit
        if scanner.function == "exit" && roles.iter().any(|r| r == "visitor") {
            let _ = conn.execute("UPDATE persons SET is_active = 0 WHERE person_id = ?1", params![person_id]);
        }

        Ok(ScanResult {
            success: true,
            message: format!("Manual {} Successful.", if scanner.function == "entrance" { "Entry" } else { "Exit" }),
            person_name: Some(format!("{} {}", first_name, last_name)),
            roles: Some(roles),
        })
    } else {
        Ok(ScanResult {
            success: false,
            message: "Access Denied: Record not found in database.".to_string(),
            person_name: None,
            roles: None,
        })
    }
}

pub fn get_scan_person_details(
    pool: &DbPool,
    id_number: &str,
) -> Result<Option<ScanPersonDetails>, String> {
    let conn = pool.get().map_err(|e| e.to_string())?;

    let person_basic = conn.query_row(
        "SELECT person_id, id_number, first_name, middle_name, last_name FROM persons WHERE id_number = ?1",
        params![id_number],
        |row| Ok((
            row.get::<_, i64>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, Option<String>>(3)?,
            row.get::<_, String>(4)?,
        ))
    ).optional().map_err(|e| e.to_string())?;

    if let Some((person_id, id_num, first, middle, last)) = person_basic {
        let roles = get_person_roles(&conn, person_id)?;
        
        let mut dept_name = None;
        let mut prog_name = None;
        let mut y_lvl = None;

        if roles.iter().any(|r| r == "student") {
            let stu_info: Option<(String, Option<i64>)> = conn.query_row(
                "SELECT p.program_name, s.year_level FROM students s JOIN programs p ON s.program_id = p.program_id WHERE s.person_id = ?1",
                params![person_id],
                |row| Ok((row.get(0)?, row.get(1)?))
            ).optional().map_err(|e| e.to_string())?;
            if let Some((p, y)) = stu_info {
                prog_name = Some(p);
                y_lvl = y;
            }
        }

        if roles.iter().any(|r| r == "professor" || r == "staff") {
            dept_name = conn.query_row(
                "SELECT d.department_name FROM employees e JOIN departments d ON e.department_id = d.department_id WHERE e.person_id = ?1",
                params![person_id],
                |row| row.get(0)
            ).optional().map_err(|e| e.to_string())?;
        }

        Ok(Some(ScanPersonDetails {
            person_id,
            roles,
            id_number: id_num,
            first_name: first,
            middle_name: middle,
            last_name: last,
            department_name: dept_name,
            program_name: prog_name,
            year_level: y_lvl,
        }))
    } else {
        Ok(None)
    }
}

pub fn log_audit_action(
    pool: &DbPool,
    admin_id: i64,
    action_type: &str,
    entity_type: &str,
    entity_id: i64,
    entity_label: &str,
    old_values: Option<serde_json::Value>,
    new_values: Option<serde_json::Value>,
) -> Result<(), String> {
    // Normalize action type (legacy INSERT -> CREATE)
    let action = match action_type {
        "INSERT" => "CREATE",
        _ => action_type,
    };

    let mut conn = pool.get().map_err(|e| e.to_string())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    let now = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();

    tx.execute(
        "INSERT INTO audit_events (action_type, entity_type, entity_id, entity_label, performed_by, created_at) 
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![action, entity_type, entity_id, entity_label, admin_id, now],
    ).map_err(|e| e.to_string())?;

    let event_id = tx.last_insert_rowid();

    match action {
        "CREATE" => {
            if let Some(new_val) = new_values {
                if let Some(obj) = new_val.as_object() {
                    for (field, val) in obj {
                        let val_str = if val.is_string() {
                            val.as_str().unwrap().to_string()
                        } else {
                            val.to_string()
                        };
                        
                        if val_str != "null" && !val_str.trim().is_empty() {
                            tx.execute(
                                "INSERT INTO audit_changes (event_id, field_name, old_value, new_value) VALUES (?1, ?2, ?3, ?4)",
                                params![event_id, field, None::<String>, val_str],
                            ).map_err(|e| e.to_string())?;
                        }
                    }
                }
            }
        },
        "UPDATE" | "RESTORE" => {
            let mut changes_made = false;
            if let (Some(old_val), Some(new_val)) = (old_values, new_values) {
                if let (Some(old_obj), Some(new_obj)) = (old_val.as_object(), new_val.as_object()) {
                    for (field, new_v) in new_obj {
                        let old_v = old_obj.get(field).unwrap_or(&serde_json::Value::Null);
                        if old_v != new_v {
                            let old_v_str = if old_v.is_string() {
                                old_v.as_str().unwrap().to_string()
                            } else {
                                old_v.to_string()
                            };
                            let new_v_str = if new_v.is_string() {
                                new_v.as_str().unwrap().to_string()
                            } else {
                                new_v.to_string()
                            };
                            
                            tx.execute(
                                "INSERT INTO audit_changes (event_id, field_name, old_value, new_value) VALUES (?1, ?2, ?3, ?4)",
                                params![event_id, field, old_v_str, new_v_str],
                            ).map_err(|e| e.to_string())?;
                            changes_made = true;
                        }
                    }
                }
            }
            
            // If no fields actually changed (and it's not a RESTORE which is an action itself), rollback
            if !changes_made && action == "UPDATE" {
                tx.rollback().map_err(|e| e.to_string())?;
                return Ok(());
            }
        },
        "DELETE" | "ARCHIVE" => {
            if let Some(old_val) = old_values {
                if let Some(obj) = old_val.as_object() {
                    for (field, val) in obj {
                        let val_str = if val.is_string() {
                            val.as_str().unwrap().to_string()
                        } else {
                            val.to_string()
                        };
                        
                        if val_str != "null" && !val_str.trim().is_empty() {
                            tx.execute(
                                "INSERT INTO audit_changes (event_id, field_name, old_value, new_value) VALUES (?1, ?2, ?3, ?4)",
                                params![event_id, field, val_str, None::<String>],
                            ).map_err(|e| e.to_string())?;
                        }
                    }
                }
            }
        },
        _ => {}
    }

    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

pub fn get_audit_logs(
    pool: &DbPool,
    start_date: Option<String>,
    end_date: Option<String>,
) -> Result<Vec<AuditEvent>, String> {
    let conn = pool.get().map_err(|e| e.to_string())?;

    let mut base_query = "
        SELECT e.event_id, e.action_type, e.entity_type, e.entity_id, e.entity_label, e.performed_by, acc.username, acc.full_name, e.created_at 
        FROM audit_events e
        LEFT JOIN accounts acc ON e.performed_by = acc.account_id
    ".to_string();

    let mut where_clauses = Vec::new();
    let mut params_vec: Vec<String> = Vec::new();

    if let Some(start) = start_date {
        where_clauses.push("DATE(e.created_at) >= DATE(?)");
        params_vec.push(start);
    }
    if let Some(end) = end_date {
        where_clauses.push("DATE(e.created_at) <= DATE(?)");
        params_vec.push(end);
    }

    if !where_clauses.is_empty() {
        base_query.push_str(" WHERE ");
        base_query.push_str(&where_clauses.join(" AND "));
    }

    base_query.push_str(" ORDER BY e.created_at DESC");

    let mut stmt = conn.prepare(&base_query).map_err(|e| e.to_string())?;
    
    let mut events = Vec::new();
    let rows = stmt.query_map(rusqlite::params_from_iter(params_vec), |row| {
        Ok(AuditEvent {
            event_id: row.get(0)?,
            action_type: row.get(1)?,
            entity_type: row.get(2)?,
            entity_id: row.get(3)?,
            entity_label: row.get(4)?,
            performed_by: row.get(5)?,
            admin_username: row.get::<_, Option<String>>(6)?.unwrap_or_else(|| "Unknown".to_string()),
            admin_full_name: row.get::<_, Option<String>>(7)?.unwrap_or_else(|| "Unknown Administrator".to_string()),
            created_at: row.get(8)?,
            changes: Vec::new(),
        })
    }).map_err(|e| e.to_string())?;

    for event_res in rows {
        let mut event = event_res.map_err(|e| e.to_string())?;
        
        let mut change_stmt = conn.prepare("SELECT change_id, event_id, field_name, old_value, new_value FROM audit_changes WHERE event_id = ?1")
            .map_err(|e| e.to_string())?;
        
        let changes = change_stmt.query_map([event.event_id], |row| {
            Ok(AuditChange {
                change_id: row.get(0)?,
                event_id: row.get(1)?,
                field_name: row.get(2)?,
                old_value: row.get(3)?,
                new_value: row.get(4)?,
            })
        }).map_err(|e| e.to_string())?
        .collect::<Result<Vec<AuditChange>, _>>()
        .map_err(|e| e.to_string())?;
        
        event.changes = changes;
        events.push(event);
    }

    Ok(events)
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
        .prepare("SELECT username, password_hash FROM accounts WHERE account_id = ?1")
        .map_err(|e| e.to_string())?;

    let mut rows = stmt.query(params![account_id]).map_err(|e| e.to_string())?;

    if let Some(row) = rows.next().map_err(|e| e.to_string())? {
        let username: String = row.get(0).map_err(|e| e.to_string())?;
        let stored_hash: String = row.get(1).map_err(|e| e.to_string())?;
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

            let _ = log_audit_action(
                pool,
                account_id,
                "UPDATE",
                "Account",
                account_id,
                &username,
                Some(json!({ "password_hash": "(old)" })),
                Some(
                    json!({
                        "summary": format!("Password changed for account: {}.", username),
                        "password_hash": "(updated)"
                    })
                ),
            );
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
    let password = password.trim();
    let normalized_password = if password.is_empty() && role == "Gate Supervisor" {
        generate_gate_supervisor_password(full_name)
    } else {
        password.to_string()
    };

    if username.is_empty() || full_name.is_empty() || normalized_password.is_empty() {
        return Err("Username, full name, and temporary password are required.".to_string());
    }

    if !is_valid_email(email) {
        return Err("A valid contact/notification email is required.".to_string());
    }

    let conn = pool.get().map_err(|e| e.to_string())?;

    let strict_email: bool = conn.query_row(
        "SELECT setting_value FROM settings WHERE setting_key = 'strict_email_domain'",
        [],
        |row| row.get::<_, String>(0).map(|v| v == "1" || v.to_lowercase() == "true")
    ).unwrap_or(false);

    if strict_email && !email.to_lowercase().ends_with("@plpasig.edu.ph") {
        return Err("Institutional Email Required: Administrator accounts must use a @plpasig.edu.ph address.".to_string());
    }
    let now = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    conn.execute(
        "INSERT INTO accounts (username, password_hash, full_name, email, role, is_first_login, activation_otp, activation_otp_expires_at, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, 1, NULL, NULL, ?6)",
        params![username, normalized_password, full_name, email, role, now],
    ).map_err(|e| e.to_string())?;
    let target_id = conn.last_insert_rowid();

    let _ = log_audit_action(
        pool, 
        active_admin_id, 
        "CREATE", 
        "Account", 
        target_id, 
        full_name,
        None, 
        Some(json!({
            "username": username,
            "full_name": full_name,
            "email": email,
            "role": role
        }))
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

    let (old_role, account_name): (String, String) = conn.query_row(
        "SELECT role, full_name FROM accounts WHERE account_id = ?1", 
        params![account_id], 
        |row| Ok((row.get(0)?, row.get(1)?))
    ).unwrap_or_else(|_| ("Unknown".to_string(), "Unknown".to_string()));

    conn.execute(
        "UPDATE accounts SET role = ?1 WHERE account_id = ?2",
        params![new_role, account_id],
    )
    .map_err(|e| e.to_string())?;

    let _ = log_audit_action(
        pool, 
        active_admin_id, 
        "UPDATE", 
        "Account", 
        account_id, 
        &account_name,
        Some(json!({"role": old_role})), 
        Some(json!({
            "role": new_role
        }))
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
    let account_name: String = conn
        .query_row(
            "SELECT full_name FROM accounts WHERE account_id = ?1",
            params![account_id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;

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
        "Account", 
        account_id, 
        &account_name,
        Some(json!({"password_hash": "(old)"})), 
        Some(
            json!({
                "summary": format!("Password reset for account: {}.", account_name),
                "password_hash": "(new)"
            })
        )
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

    let strict_email: bool = conn.query_row(
        "SELECT setting_value FROM settings WHERE setting_key = 'strict_email_domain'",
        [],
        |row| row.get::<_, String>(0).map(|v| v == "1" || v.to_lowercase() == "true")
    ).unwrap_or(false);

    if strict_email && !email.to_lowercase().ends_with("@plpasig.edu.ph") {
        return Err("Institutional Email Required: Administrator accounts must use a @plpasig.edu.ph address.".to_string());
    }

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
        "Account", 
        account_id, 
        full_name,
        Some(json!({
            "username": old_username,
            "full_name": old_full_name,
            "email": old_email
        })), 
        Some(json!({
            "username": username,
            "full_name": full_name,
            "email": email
        }))
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

    let (deleted_username, deleted_full_name): (String, String) = conn.query_row(
        "SELECT username, full_name FROM accounts WHERE account_id = ?1", 
        params![account_id], 
        |row| Ok((row.get(0)?, row.get(1)?))
    ).unwrap_or_else(|_| ("Unknown".to_string(), "Unknown".to_string()));

    // Reassign audit_events that reference the to-be-deleted account to the
    // active admin, so the FK constraint is satisfied without losing history.
    conn.execute(
        "UPDATE audit_events SET performed_by = ?1 WHERE performed_by = ?2",
        params![active_admin_id, account_id],
    )
    .map_err(|e| format!("Failed to reassign audit logs: {}", e))?;

    conn.execute(
        "DELETE FROM accounts WHERE account_id = ?1",
        params![account_id],
    )
    .map_err(|e| e.to_string())?;

    let _ = log_audit_action(
        pool, 
        active_admin_id, 
        "DELETE", 
        "Account", 
        account_id, 
        &deleted_full_name,
        Some(json!({
            "username": deleted_username,
            "full_name": deleted_full_name
        })), 
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
            "SELECT COUNT(*) FROM persons p 
             JOIN person_roles pr ON p.person_id = pr.person_id 
             JOIN roles r ON pr.role_id = r.role_id 
             WHERE r.role_name = 'student' AND p.is_archived = 0",
            [],
            |row| row.get(0),
        )
        .unwrap_or(0);

    let total_employees: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM persons p 
             JOIN person_roles pr ON p.person_id = pr.person_id 
             JOIN roles r ON pr.role_id = r.role_id 
             WHERE r.role_name IN ('professor', 'staff', 'dean') AND p.is_archived = 0",
            [],
            |row| row.get(0),
        )
        .unwrap_or(0);

    let total_visitors: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM persons p 
             JOIN person_roles pr ON p.person_id = pr.person_id 
             JOIN roles r ON pr.role_id = r.role_id 
             WHERE r.role_name = 'visitor' AND p.is_archived = 0",
            [],
            |row| row.get(0),
        )
        .unwrap_or(0);

    let entries_today: i64 = conn.query_row(
        "SELECT COUNT(*) FROM activity_logs l JOIN scanners s ON l.scanner_id = s.scanner_id WHERE s.function = 'entrance' AND DATE(l.scanned_at) = DATE('now', 'localtime')",
        [], |row| row.get(0)
    ).unwrap_or(0);

    let exits_today: i64 = conn.query_row(
        "SELECT COUNT(*) FROM activity_logs l JOIN scanners s ON l.scanner_id = s.scanner_id WHERE s.function = 'exit' AND DATE(l.scanned_at) = DATE('now', 'localtime')",
        [], |row| row.get(0)
    ).unwrap_or(0);

    let mut trend_stmt = conn
        .prepare(
            "SELECT DATE(l.scanned_at) AS scan_date, r.role_name, COUNT(DISTINCT l.person_id) AS total
         FROM activity_logs l
         JOIN person_roles pr ON pr.person_id = l.person_id
         JOIN roles r ON r.role_id = pr.role_id
         JOIN scanners s ON s.scanner_id = l.scanner_id
         WHERE s.function = 'entrance'
           AND DATE(l.scanned_at) BETWEEN ?1 AND ?2
         GROUP BY DATE(l.scanned_at), r.role_name
         ORDER BY DATE(l.scanned_at) ASC",
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
    scanner_id: i64,
) -> Result<ScanResult, String> {
    let conn = pool.get().map_err(|e| e.to_string())?;

    // 1. Fetch Event Details
    let event_details = get_events(pool)?
        .into_iter()
        .find(|e| e.event.event_id == event_id)
        .ok_or("Event not found.")?;

    if !event_details.event.is_enabled {
        return Ok(ScanResult {
            success: false,
            message: "Attendance Closed: Event is not enabled.".to_string(),
            person_name: None,
            roles: None,
        });
    }

    // 2. Check Schedule
    let now = chrono::Local::now();
    let current_day = now.format("%A").to_string();
    let current_date = now.format("%Y-%m-%d").to_string();
    let current_time = now.format("%H:%M:%S").to_string();

    let mut is_scheduled_today = false;

    // Check Weekly
    for sw in &event_details.weekly_schedules {
        if sw.day_of_week.to_lowercase() == current_day.to_lowercase() {
            if current_time >= sw.start_time && current_time <= sw.end_time {
                is_scheduled_today = true;
                break;
            }
        }
    }

    // Check Date Range (override if matches)
    if !is_scheduled_today {
        for sd in &event_details.date_range_schedules {
            if current_date >= sd.start_date && current_date <= sd.end_date {
                if current_time >= sd.start_time && current_time <= sd.end_time {
                    is_scheduled_today = true;
                    break;
                }
            }
        }
    }

    if !is_scheduled_today {
        return Ok(ScanResult {
            success: false,
            message: "Event is not scheduled for today or is currently outside active hours.".to_string(),
            person_name: None,
            roles: None,
        });
    }

    // 3. Fetch Person
    let person_data = conn.query_row(
        "SELECT person_id, first_name, last_name, is_active, DATE(created_at) == DATE('now', 'localtime') as is_created_today FROM persons WHERE id_number = ?1",
        params![id_number],
        |row| Ok((
            row.get::<_, i64>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, bool>(3)?,
            row.get::<_, bool>(4)?,
        ))
    ).optional().map_err(|e| e.to_string())?;

    if let Some((person_id, first_name, last_name, is_active, is_created_today)) = person_data {
        let roles = get_person_roles(&conn, person_id)?;

        if !is_active {
            return Ok(ScanResult {
                success: false,
                message: "Access Denied: ID is inactive.".to_string(),
                person_name: Some(format!("{} {}", first_name, last_name)),
                roles: Some(roles),
            });
        }

        // Visitor check
        if roles.iter().any(|r| r == "visitor") && !is_created_today {
            let _ = conn.execute("UPDATE persons SET is_active = 0 WHERE person_id = ?1", params![person_id]);
            return Ok(ScanResult {
                success: false,
                message: "Access Denied: This Visitor Pass expired at 11:59 PM yesterday. Please re-register.".to_string(),
                person_name: Some(format!("{} {}", first_name, last_name)),
                roles: Some(roles),
            });
        }

        // Role requirement check
        let has_required_role = event_details.required_roles.is_empty() || event_details.required_roles.iter().any(|rr| {
            roles.iter().any(|pr| pr.to_lowercase() == rr.role_name.to_lowercase())
        });

        if !has_required_role {
            return Ok(ScanResult {
                success: false,
                message: "Access Denied: You do not have the required role for this event.".to_string(),
                person_name: Some(format!("{} {}", first_name, last_name)),
                roles: Some(roles),
            });
        }

        // Check if already recorded for this event today (to prevent double scanning)
        let already_logged: Option<i64> = conn.query_row(
            "SELECT log_id FROM activity_logs WHERE person_id = ?1 AND event_id = ?2 AND activity_type = 'event' AND DATE(scanned_at) = DATE(?3) LIMIT 1",
            params![person_id, event_id, current_date],
            |row| row.get(0)
        ).optional().map_err(|e| e.to_string())?;

        if already_logged.is_some() {
            return Ok(ScanResult {
                success: false,
                message: "Attendance already recorded for this event today.".to_string(),
                person_name: Some(format!("{} {}", first_name, last_name)),
                roles: Some(roles),
            });
        }

        // 4. Log Attendance
        let status = "Present"; 

        conn.execute(
            "INSERT INTO activity_logs (person_id, scanner_id, activity_type, event_id, status, scanned_at) 
             VALUES (?1, ?2, 'event', ?3, ?4, ?5)",
            params![person_id, scanner_id, event_id, status, current_date.clone() + " " + &current_time],
        ).map_err(|e| e.to_string())?;

        Ok(ScanResult {
            success: true,
            message: format!("Attendance logged for {}.", event_details.event.event_name),
            person_name: Some(format!("{} {}", first_name, last_name)),
            roles: Some(roles),
        })
    } else {
        Ok(ScanResult {
            success: false,
            message: "Access Denied: ID not found.".to_string(),
            person_name: None,
            roles: None,
        })
    }
}

pub fn get_system_branding(pool: &DbPool) -> Result<SystemBranding, String> {
    let conn = pool.get().map_err(|e| e.to_string())?;

    let mut system_name = "Pamantasan ng Lungsod ng Pasig".to_string();
    let mut system_logo = "".to_string();
    let mut system_title = "SMART GATE".to_string();
    let mut report_address = "Alkalde Jose St. Kapasigan Pasig City, Philippines 1600".to_string();
    let mut report_phone = "(106) 628-1014".to_string();
    let mut report_email = "info@plpasig.edu.ph".to_string();
    let mut primary_logo: Option<String> = None;
    let mut secondary_logo_1: Option<String> = None;
    let mut secondary_logo_2: Option<String> = None;
    let mut primary_circle: bool = false;
    let mut secondary1_circle: bool = false;
    let mut secondary2_circle: bool = false;
    let mut primary_logo_enabled: bool = true;
    let mut secondary_logo_1_enabled: bool = true;
    let mut secondary_logo_2_enabled: bool = true;
    let mut strict_email_domain: bool = false;
    let mut enable_face_recognition: bool = false;

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
                "system_title" => system_title = value,
                "report_address" => report_address = value,
                "report_phone" => report_phone = value,
                "report_email" => report_email = value,
                "primary_logo" => primary_logo = Some(value).filter(|v| !v.is_empty()),
                "secondary_logo_1" => secondary_logo_1 = Some(value).filter(|v| !v.is_empty()),
                "secondary_logo_2" => secondary_logo_2 = Some(value).filter(|v| !v.is_empty()),
                "primary_circle" => primary_circle = value == "1" || value.to_lowercase() == "true",
                "secondary1_circle" => secondary1_circle = value == "1" || value.to_lowercase() == "true",
                "secondary2_circle" => secondary2_circle = value == "1" || value.to_lowercase() == "true",
                "primary_logo_enabled" => primary_logo_enabled = value == "1" || value.to_lowercase() == "true",
                "secondary_logo_1_enabled" => secondary_logo_1_enabled = value == "1" || value.to_lowercase() == "true",
                "secondary_logo_2_enabled" => secondary_logo_2_enabled = value == "1" || value.to_lowercase() == "true",
                "strict_email_domain" => strict_email_domain = value == "1" || value.to_lowercase() == "true",
                "enable_face_recognition" => enable_face_recognition = value == "1" || value.to_lowercase() == "true",
                "circle_logo_format" => {
                    // Legacy support: if individual ones aren't set yet, they could inherit this
                    // but we'll prioritize individual ones.
                }
                _ => {}
            }
        }
    }

    Ok(SystemBranding {
        system_name,
        system_logo,
        system_title,
        report_address,
        report_phone,
        report_email,
        primary_logo,
        secondary_logo_1,
        secondary_logo_2,
        primary_circle,
        secondary1_circle,
        secondary2_circle,
        primary_logo_enabled,
        secondary_logo_1_enabled,
        secondary_logo_2_enabled,
        strict_email_domain,
        enable_face_recognition,
    })
}

pub fn update_system_branding(
    pool: &DbPool,
    admin_id: i64,
    name: &str,
    logo_base64: &str,
    system_title: &str,
    report_address: &str,
    report_phone: &str,
    report_email: &str,
    primary_logo: Option<String>,
    secondary_logo_1: Option<String>,
    secondary_logo_2: Option<String>,
    primary_circle: bool,
    secondary1_circle: bool,
    secondary2_circle: bool,
    primary_logo_enabled: bool,
    secondary_logo_1_enabled: bool,
    secondary_logo_2_enabled: bool,
    strict_email_domain: bool,
    enable_face_recognition: bool,
) -> Result<(), String> {
    let mut conn = pool.get().map_err(|e| e.to_string())?;

    let old_system_name: Option<String> = conn.query_row("SELECT setting_value FROM settings WHERE setting_key = 'system_name'", [], |row| row.get(0)).unwrap_or(None);
    let old_primary: Option<String> = conn.query_row("SELECT setting_value FROM settings WHERE setting_key = 'primary_logo'", [], |row| row.get(0)).unwrap_or(None);
    let old_sec1: Option<String> = conn.query_row("SELECT setting_value FROM settings WHERE setting_key = 'secondary_logo_1'", [], |row| row.get(0)).unwrap_or(None);
    let old_sec2: Option<String> = conn.query_row("SELECT setting_value FROM settings WHERE setting_key = 'secondary_logo_2'", [], |row| row.get(0)).unwrap_or(None);

    let mut branding_changes = Vec::new();

    let old_primary_len = old_primary.unwrap_or_default().len();
    let new_primary_len = primary_logo.as_deref().unwrap_or_default().len();
    if old_primary_len == 0 && new_primary_len > 0 { branding_changes.push("Added Primary Logo"); }
    else if old_primary_len > 0 && new_primary_len == 0 { branding_changes.push("Removed Primary Logo"); }
    else if old_primary_len > 0 && new_primary_len > 0 && old_primary_len != new_primary_len { branding_changes.push("Updated Primary Logo"); }

    let old_sec1_len = old_sec1.unwrap_or_default().len();
    let new_sec1_len = secondary_logo_1.as_deref().unwrap_or_default().len();
    if old_sec1_len == 0 && new_sec1_len > 0 { branding_changes.push("Added Secondary Logo 1"); }
    else if old_sec1_len > 0 && new_sec1_len == 0 { branding_changes.push("Removed Secondary Logo 1"); }
    else if old_sec1_len > 0 && new_sec1_len > 0 && old_sec1_len != new_sec1_len { branding_changes.push("Updated Secondary Logo 1"); }

    let old_sec2_len = old_sec2.unwrap_or_default().len();
    let new_sec2_len = secondary_logo_2.as_deref().unwrap_or_default().len();
    if old_sec2_len == 0 && new_sec2_len > 0 { branding_changes.push("Added Secondary Logo 2"); }
    else if old_sec2_len > 0 && new_sec2_len == 0 { branding_changes.push("Removed Secondary Logo 2"); }
    else if old_sec2_len > 0 && new_sec2_len > 0 && old_sec2_len != new_sec2_len { branding_changes.push("Updated Secondary Logo 2"); }

    let name_changed = old_system_name.as_deref().unwrap_or_default() != name;

    let summary_message = if branding_changes.is_empty() {
        if name_changed {
            format!("Updated System Branding. Name set to '{}'", name)
        } else {
            "Updated System Settings Appearance".to_string()
        }
    } else {
        if name_changed {
            format!("Updated System Branding. Name set to '{}' | Setup Logs: {}", name, branding_changes.join(", "))
        } else {
            branding_changes.join(", ")
        }
    };

    let tx = conn.transaction().map_err(|e| e.to_string())?;

    // We'll skip extensive audit logging for the 3 new logos to prevent massive bloat unless necessary, 
    // but we'll do the standard inserts.

    // Insert or update system_name
    tx.execute(
        "INSERT INTO settings (setting_key, setting_value) VALUES ('system_name', ?1)
         ON CONFLICT(setting_key) DO UPDATE SET setting_value=excluded.setting_value",
        params![name],
    )
    .map_err(|e| e.to_string())?;

    // Insert or update system_logo
    tx.execute(
        "INSERT INTO settings (setting_key, setting_value) VALUES ('system_logo', ?1)
         ON CONFLICT(setting_key) DO UPDATE SET setting_value=excluded.setting_value",
        params![logo_base64],
    )
    .map_err(|e| e.to_string())?;

    tx.execute(
        "INSERT INTO settings (setting_key, setting_value) VALUES ('system_title', ?1)
         ON CONFLICT(setting_key) DO UPDATE SET setting_value=excluded.setting_value",
        params![system_title],
    )
    .map_err(|e| e.to_string())?;

    tx.execute(
        "INSERT INTO settings (setting_key, setting_value) VALUES ('report_address', ?1)
         ON CONFLICT(setting_key) DO UPDATE SET setting_value=excluded.setting_value",
        params![report_address],
    )
    .map_err(|e| e.to_string())?;

    tx.execute(
        "INSERT INTO settings (setting_key, setting_value) VALUES ('report_phone', ?1)
         ON CONFLICT(setting_key) DO UPDATE SET setting_value=excluded.setting_value",
        params![report_phone],
    )
    .map_err(|e| e.to_string())?;

    tx.execute(
        "INSERT INTO settings (setting_key, setting_value) VALUES ('report_email', ?1)
         ON CONFLICT(setting_key) DO UPDATE SET setting_value=excluded.setting_value",
        params![report_email],
    )
    .map_err(|e| e.to_string())?;

    // Insert or update primary_logo
    tx.execute(
        "INSERT INTO settings (setting_key, setting_value) VALUES ('primary_logo', ?1)
         ON CONFLICT(setting_key) DO UPDATE SET setting_value=excluded.setting_value",
        params![primary_logo.unwrap_or_default()],
    )
    .map_err(|e| e.to_string())?;

    // Insert or update secondary_logo_1
    tx.execute(
        "INSERT INTO settings (setting_key, setting_value) VALUES ('secondary_logo_1', ?1)
         ON CONFLICT(setting_key) DO UPDATE SET setting_value=excluded.setting_value",
        params![secondary_logo_1.unwrap_or_default()],
    )
    .map_err(|e| e.to_string())?;

    // Insert or update secondary_logo_2
    tx.execute(
        "INSERT INTO settings (setting_key, setting_value) VALUES ('secondary_logo_2', ?1)
         ON CONFLICT(setting_key) DO UPDATE SET setting_value=excluded.setting_value",
        params![secondary_logo_2.unwrap_or_default()],
    )
    .map_err(|e| e.to_string())?;

    // Insert or update individual circle formats
    tx.execute(
        "INSERT INTO settings (setting_key, setting_value) VALUES ('primary_circle', ?1)
         ON CONFLICT(setting_key) DO UPDATE SET setting_value=excluded.setting_value",
        params![if primary_circle { "1" } else { "0" }],
    ).map_err(|e| e.to_string())?;

    tx.execute(
        "INSERT INTO settings (setting_key, setting_value) VALUES ('secondary1_circle', ?1)
         ON CONFLICT(setting_key) DO UPDATE SET setting_value=excluded.setting_value",
        params![if secondary1_circle { "1" } else { "0" }],
    ).map_err(|e| e.to_string())?;

    tx.execute(
        "INSERT INTO settings (setting_key, setting_value) VALUES ('secondary2_circle', ?1)
         ON CONFLICT(setting_key) DO UPDATE SET setting_value=excluded.setting_value",
        params![if secondary2_circle { "1" } else { "0" }],
    ).map_err(|e| e.to_string())?;

    tx.execute(
        "INSERT INTO settings (setting_key, setting_value) VALUES ('primary_logo_enabled', ?1)
         ON CONFLICT(setting_key) DO UPDATE SET setting_value=excluded.setting_value",
        params![if primary_logo_enabled { "1" } else { "0" }],
    ).map_err(|e| e.to_string())?;

    tx.execute(
        "INSERT INTO settings (setting_key, setting_value) VALUES ('secondary_logo_1_enabled', ?1)
         ON CONFLICT(setting_key) DO UPDATE SET setting_value=excluded.setting_value",
        params![if secondary_logo_1_enabled { "1" } else { "0" }],
    ).map_err(|e| e.to_string())?;

    tx.execute(
        "INSERT INTO settings (setting_key, setting_value) VALUES ('secondary_logo_2_enabled', ?1)
         ON CONFLICT(setting_key) DO UPDATE SET setting_value=excluded.setting_value",
        params![if secondary_logo_2_enabled { "1" } else { "0" }],
    ).map_err(|e| e.to_string())?;

    tx.execute(
        "INSERT INTO settings (setting_key, setting_value) VALUES ('strict_email_domain', ?1)
         ON CONFLICT(setting_key) DO UPDATE SET setting_value=excluded.setting_value",
        params![if strict_email_domain { "1" } else { "0" }],
    ).map_err(|e| e.to_string())?;

    tx.execute(
        "INSERT INTO settings (setting_key, setting_value) VALUES ('enable_face_recognition', ?1)
         ON CONFLICT(setting_key) DO UPDATE SET setting_value=excluded.setting_value",
        params![if enable_face_recognition { "1" } else { "0" }],
    ).map_err(|e| e.to_string())?;

    tx.commit().map_err(|e| e.to_string())?;

    // Log the branding update
    let _ = log_audit_action(
        pool,
        admin_id,
        "UPDATE",
        "System",
        0,
        "System Branding Update",
        None,
        Some(
            serde_json::json!({
                "summary": summary_message,
                "system_name": name,
                "system_title": system_title,
                "report_address": report_address,
                "report_phone": report_phone,
                "report_email": report_email,
                "primary_circle": primary_circle,
                "secondary1_circle": secondary1_circle,
                "secondary2_circle": secondary2_circle,
                "primary_logo_enabled": primary_logo_enabled,
                "secondary_logo_1_enabled": secondary_logo_1_enabled,
                "secondary_logo_2_enabled": secondary_logo_2_enabled,
                "strict_email_domain": strict_email_domain,
                "enable_face_recognition": enable_face_recognition
            })
        ),
    );

    Ok(())
}

// Forgot Password Functions

pub fn forgot_password_request(pool: &DbPool, email: &str, username: &str) -> Result<(i64, String, String, String, String), String> {
    let conn = pool.get().map_err(|e| e.to_string())?;
    let email_lower = email.trim().to_lowercase();
    let username_lower = username.trim().to_lowercase();

    let row = conn.query_row(
        "SELECT account_id, username, full_name, email
         FROM accounts
         WHERE LOWER(email) = ?1 AND LOWER(username) = ?2",
        params![email_lower, username_lower],
        |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
            ))
        },
    ).map_err(|_| "No account found matching that username and email address.".to_string())?;

    let (account_id, username, full_name, actual_email) = row;

    // Generate OTP
    let otp_code = generate_six_digit_otp(account_id);
    let expires_at = (Local::now() + Duration::minutes(15)).naive_local().format("%Y-%m-%d %H:%M:%S").to_string();

    conn.execute(
        "UPDATE accounts
         SET activation_otp = ?1,
             activation_otp_expires_at = ?2
         WHERE account_id = ?3",
        params![&otp_code, &expires_at, account_id],
    ).map_err(|e| format!("Failed to store verification code: {}", e))?;

    let masked_email = mask_email(&actual_email);

    Ok((account_id, username, full_name, masked_email, otp_code))
}

pub fn verify_forgot_password_otp(pool: &DbPool, account_id: i64, otp_code: &str) -> Result<bool, String> {
    let conn = pool.get().map_err(|e| e.to_string())?;

    let row = conn.query_row(
        "SELECT activation_otp, activation_otp_expires_at
         FROM accounts
         WHERE account_id = ?1",
        params![account_id],
        |row| {
            Ok((
                row.get::<_, Option<String>>(0)?,
                row.get::<_, Option<String>>(1)?,
            ))
        },
    ).map_err(|_| "Account not found.".to_string())?;

    let (stored_otp, otp_expires_at) = row;

    let stored_otp = stored_otp.ok_or_else(|| "No verification code is currently active.".to_string())?;
    if stored_otp != otp_code {
        return Ok(false);
    }

    let otp_expires_at = otp_expires_at.ok_or_else(|| "Verification code has expired.".to_string())?;
    let parsed_expiry = NaiveDateTime::parse_from_str(&otp_expires_at, "%Y-%m-%d %H:%M:%S")
        .map_err(|_| "Unable to validate verification code expiry.".to_string())?;

    if Local::now().naive_local() > parsed_expiry {
        return Err("The verification code has expired. Please request a new one.".to_string());
    }

    Ok(true)
}

pub fn reset_password_with_otp(
    pool: &DbPool,
    account_id: i64,
    otp_code: &str,
    new_password: &str,
) -> Result<bool, String> {
    // First verify the OTP is still valid
    let is_valid = verify_forgot_password_otp(pool, account_id, otp_code)?;
    if !is_valid {
        return Ok(false);
    }

    let conn = pool.get().map_err(|e| e.to_string())?;

    // Fetch username for the audit entry before the update
    let account_username: String = conn
        .query_row(
            "SELECT username FROM accounts WHERE account_id = ?1",
            params![account_id],
            |row| row.get(0),
        )
        .unwrap_or_else(|_| "Unknown".to_string());

    conn.execute(
        "UPDATE accounts
         SET password_hash = ?1,
             activation_otp = NULL,
             activation_otp_expires_at = NULL
         WHERE account_id = ?2",
        params![new_password, account_id],
    )
    .map_err(|e| format!("Failed to reset password: {}", e))?;

    // Audit: actor is the account itself (they are not yet in a session)
    let _ = log_audit_action(
        pool,
        account_id,
        "UPDATE",
        "Account",
        account_id,
        &account_username,
        Some(json!({ "password_hash": "(old)" })),
        Some(
            json!({
                "summary": format!("Password reset via Forgot Password for account: {}.", account_username),
                "password_hash": "(new)"
            })
        ),
    );

    Ok(true)
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

// ------ Archive Center Functions ------

pub fn get_archived_users(pool: &DbPool) -> Result<Vec<serde_json::Value>, String> {
    let conn = pool.get().map_err(|e| e.to_string())?;

    let mut stmt = conn.prepare(
        "SELECT p.person_id, p.id_number, p.first_name, p.middle_name, p.last_name, p.archived_at
         FROM persons p
         WHERE p.is_archived = 1
         ORDER BY p.archived_at DESC"
    ).map_err(|e| e.to_string())?;

    let rows = stmt.query_map([], |row| {
        let person_id: i64 = row.get(0)?;
        let roles = get_person_roles(&conn, person_id).unwrap_or_default();
        let contacts = get_person_contacts(&conn, person_id).unwrap_or_default();

        Ok(json!({
            "person_id": person_id,
            "id_number": row.get::<_, String>(1)?,
            "first_name": row.get::<_, String>(2)?,
            "middle_name": row.get::<_, Option<String>>(3)?,
            "last_name": row.get::<_, String>(4)?,
            "roles": roles,
            "contacts": contacts,
            "archived_at": row.get::<_, Option<String>>(5)?
        }))
    }).map_err(|e| e.to_string())?;

    let mut list = Vec::new();
    for row in rows {
        list.push(row.map_err(|e| e.to_string())?);
    }
    Ok(list)
}

pub fn get_archived_events(pool: &DbPool) -> Result<Vec<serde_json::Value>, String> {
    // We can reuse get_events but filtered for is_archived = 1
    let conn = pool.get().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare("SELECT event_id, event_name, description, is_enabled, archived_at FROM events WHERE is_archived = 1")
        .map_err(|e| e.to_string())?;

    let rows = stmt.query_map([], |row| {
        let event_id: i64 = row.get(0)?;
        
        // Basic event info
        let event_json = json!({
            "event_id": event_id,
            "event_name": row.get::<_, String>(1)?,
            "description": row.get::<_, Option<String>>(2)?,
            "is_enabled": row.get::<_, i32>(3)? == 1,
            "archived_at": row.get::<_, Option<String>>(4)?
        });

        Ok(event_json)
    }).map_err(|e| e.to_string())?;

    let mut list = Vec::new();
    for row in rows {
        list.push(row.map_err(|e| e.to_string())?);
    }
    Ok(list)
}

pub fn get_archived_academic(pool: &DbPool) -> Result<serde_json::Value, String> {
    let conn = pool.get().map_err(|e| e.to_string())?;

    // Archived departments
    let mut dept_stmt = conn.prepare(
        "SELECT department_id, department_code, department_name, archived_at
         FROM departments WHERE is_archived = 1
         ORDER BY archived_at DESC"
    ).map_err(|e| e.to_string())?;

    let dept_iter = dept_stmt.query_map([], |row| {
        let department_id = row.get::<_, i64>(0)?;
        let department_code = row.get::<_, String>(1)?;
        let department_name = row.get::<_, String>(2)?;
        let archived_at = row.get::<_, Option<String>>(3)?;
        Ok(json!({
            "id": department_id,
            "code": department_code,
            "name": department_name,
            "department_id": department_id,
            "department_code": department_code,
            "department_name": department_name,
            "type": "Department",
            "archived_at": archived_at
        }))
    }).map_err(|e| e.to_string())?;

    let mut departments = Vec::new();
    for item in dept_iter {
        departments.push(item.map_err(|e| e.to_string())?);
    }

    // Archived programs
    let mut prog_stmt = conn.prepare(
        "SELECT p.program_id, p.program_code, p.program_name, p.archived_at, d.department_name
         FROM programs p
         LEFT JOIN departments d ON p.department_id = d.department_id
         WHERE p.is_archived = 1
         ORDER BY p.archived_at DESC"
    ).map_err(|e| e.to_string())?;

    let prog_iter = prog_stmt.query_map([], |row| {
        let program_id = row.get::<_, i64>(0)?;
        let program_code = row.get::<_, String>(1)?;
        let program_name = row.get::<_, String>(2)?;
        let archived_at = row.get::<_, Option<String>>(3)?;
        let department_name = row.get::<_, Option<String>>(4)?;
        Ok(json!({
            "id": program_id,
            "code": program_code,
            "name": program_name,
            "program_id": program_id,
            "program_code": program_code,
            "program_name": program_name,
            "type": "Program",
            "archived_at": archived_at,
            "department_name": department_name
        }))
    }).map_err(|e| e.to_string())?;

    let mut programs = Vec::new();
    for item in prog_iter {
        programs.push(item.map_err(|e| e.to_string())?);
    }

    Ok(json!({
        "departments": departments,
        "programs": programs
    }))
}

pub fn restore_user(pool: &DbPool, person_id: i64, active_admin_id: i64) -> Result<(), String> {
    let conn = pool.get().map_err(|e| e.to_string())?;

    let name: String = conn.query_row(
        "SELECT first_name || ' ' || last_name FROM persons WHERE person_id = ?1",
        params![person_id],
        |row| row.get(0),
    ).unwrap_or_else(|_| "Unknown".to_string());

    conn.execute(
        "UPDATE persons SET is_archived = 0, archived_at = NULL WHERE person_id = ?1",
        params![person_id],
    ).map_err(|e| e.to_string())?;

    let _ = log_audit_action(
        pool,
        active_admin_id,
        "RESTORE",
        "Person",
        person_id,
        &name,
        Some(json!({ "is_archived": true })),
        Some(json!({ "name": name, "is_archived": false })),
    );

    Ok(())
}

pub fn restore_event(pool: &DbPool, event_id: i64, active_admin_id: i64) -> Result<(), String> {
    let conn = pool.get().map_err(|e| e.to_string())?;

    let name: String = conn.query_row(
        "SELECT event_name FROM events WHERE event_id = ?1",
        params![event_id],
        |row| row.get(0),
    ).unwrap_or_else(|_| "Unknown".to_string());

    conn.execute(
        "UPDATE events SET is_archived = 0, archived_at = NULL WHERE event_id = ?1",
        params![event_id],
    ).map_err(|e| e.to_string())?;

    let _ = log_audit_action(
        pool,
        active_admin_id,
        "RESTORE",
        "Event",
        event_id,
        &name,
        Some(json!({ "is_archived": true })),
        Some(json!({ "event_name": name, "is_archived": false })),
    );

    Ok(())
}

pub fn restore_department(pool: &DbPool, department_id: i64, active_admin_id: i64) -> Result<(), String> {
    let conn = pool.get().map_err(|e| e.to_string())?;

    let name: String = conn.query_row(
        "SELECT department_name FROM departments WHERE department_id = ?1",
        params![department_id],
        |row| row.get(0),
    ).unwrap_or_else(|_| "Unknown".to_string());

    conn.execute(
        "UPDATE departments SET is_archived = 0, archived_at = NULL WHERE department_id = ?1",
        params![department_id],
    ).map_err(|e| e.to_string())?;

    let _ = log_audit_action(
        pool,
        active_admin_id,
        "RESTORE",
        "Department",
        department_id,
        &name,
        Some(json!({ "is_archived": true })),
        Some(json!({ "department_name": name, "is_archived": false })),
    );

    Ok(())
}

pub fn restore_program(pool: &DbPool, program_id: i64, active_admin_id: i64) -> Result<(), String> {
    let conn = pool.get().map_err(|e| e.to_string())?;

    let name: String = conn.query_row(
        "SELECT program_name FROM programs WHERE program_id = ?1",
        params![program_id],
        |row| row.get(0),
    ).unwrap_or_else(|_| "Unknown".to_string());

    conn.execute(
        "UPDATE programs SET is_archived = 0, archived_at = NULL WHERE program_id = ?1",
        params![program_id],
    ).map_err(|e| e.to_string())?;

    let _ = log_audit_action(
        pool,
        active_admin_id,
        "RESTORE",
        "Program",
        program_id,
        &name,
        Some(json!({ "is_archived": true })),
        Some(json!({ "program_name": name, "is_archived": false })),
    );

    Ok(())
}

pub fn permanent_delete_user(pool: &DbPool, person_id: i64, active_admin_id: i64) -> Result<(), String> {
    let mut conn = pool.get().map_err(|e| e.to_string())?;

    // Only allow permanent delete of archived records
    let is_archived: bool = conn.query_row(
        "SELECT is_archived FROM persons WHERE person_id = ?1",
        params![person_id],
        |row| row.get::<_, i32>(0).map(|v| v == 1),
    ).map_err(|e| e.to_string())?;

    if !is_archived {
        return Err("Only archived records can be permanently deleted. Archive the record first.".to_string());
    }

    let old_data: Option<serde_json::Value> = conn.query_row(
        "SELECT id_number, first_name, last_name FROM persons WHERE person_id = ?1",
        params![person_id],
        |row| {
            let roles = get_person_roles(&conn, person_id).unwrap_or_default();
            Ok(json!({
                "id_number": row.get::<_, String>(0)?,
                "first_name": row.get::<_, String>(1)?,
                "last_name": row.get::<_, String>(2)?,
                "roles": roles
            }))
        }
    ).optional().map_err(|e| e.to_string())?;

    let tx = conn.transaction().map_err(|e| e.to_string())?;

    // Most role-specific tables have ON DELETE CASCADE in the new schema.
    // However, activity_logs might not (depending on schema design, but good to be explicit here).
    tx.execute("DELETE FROM activity_logs WHERE person_id = ?1", params![person_id]).ok();
    
    // Deleting from persons will cascade to students, employees, visitors, person_roles, person_contacts, and face_embeddings.
    tx.execute("DELETE FROM persons WHERE person_id = ?1", params![person_id])
        .map_err(|e| e.to_string())?;

    tx.commit().map_err(|e| e.to_string())?;

    let label = old_data.as_ref().and_then(|v| v.get("first_name")).and_then(|v| v.as_str()).unwrap_or("Unknown").to_string();
    let _ = log_audit_action(
        pool,
        active_admin_id,
        "DELETE",
        "Person",
        person_id,
        &label,
        old_data,
        None,
    );

    Ok(())
}

pub fn permanent_delete_event(pool: &DbPool, event_id: i64, active_admin_id: i64) -> Result<(), String> {
    let mut conn = pool.get().map_err(|e| e.to_string())?;

    let is_archived: bool = conn.query_row(
        "SELECT is_archived FROM events WHERE event_id = ?1",
        params![event_id],
        |row| row.get::<_, i32>(0).map(|v| v == 1),
    ).map_err(|e| e.to_string())?;

    if !is_archived {
        return Err("Only archived events can be permanently deleted.".to_string());
    }

    let old_data: Option<serde_json::Value> = conn.query_row(
        "SELECT event_name FROM events WHERE event_id = ?1",
        params![event_id],
        |row| Ok(json!({ "event_name": row.get::<_, String>(0)? })),
    ).ok();

    let tx = conn.transaction().map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM activity_logs WHERE event_id = ?1", params![event_id]).ok();
    tx.execute("DELETE FROM events WHERE event_id = ?1", params![event_id])
        .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;

    let label = old_data.as_ref().and_then(|v| v.get("event_name")).and_then(|v| v.as_str()).unwrap_or("Unknown Event").to_string();
    let _ = log_audit_action(
        pool,
        active_admin_id,
        "DELETE",
        "Event",
        event_id,
        &label,
        old_data,
        None,
    );

    Ok(())
}

pub fn permanent_delete_department(pool: &DbPool, department_id: i64, active_admin_id: i64) -> Result<(), String> {
    let conn = pool.get().map_err(|e| e.to_string())?;

    let is_archived: bool = conn.query_row(
        "SELECT is_archived FROM departments WHERE department_id = ?1",
        params![department_id],
        |row| row.get::<_, i32>(0).map(|v| v == 1),
    ).map_err(|e| e.to_string())?;

    if !is_archived {
        return Err("Only archived departments can be permanently deleted.".to_string());
    }

    let old_data: Option<serde_json::Value> = conn.query_row(
        "SELECT department_code, department_name FROM departments WHERE department_id = ?1",
        params![department_id],
        |row| Ok(json!({ "department_code": row.get::<_, String>(0)?, "department_name": row.get::<_, String>(1)? })),
    ).ok();

    conn.execute("DELETE FROM departments WHERE department_id = ?1", params![department_id])
        .map_err(|e| e.to_string())?;

    let label = old_data.as_ref().and_then(|v| v.get("department_name")).and_then(|v| v.as_str()).unwrap_or("Unknown Department").to_string();
    let _ = log_audit_action(
        pool,
        active_admin_id,
        "DELETE",
        "Department",
        department_id,
        &label,
        old_data,
        None,
    );

    Ok(())
}

pub fn permanent_delete_program(pool: &DbPool, program_id: i64, active_admin_id: i64) -> Result<(), String> {
    let conn = pool.get().map_err(|e| e.to_string())?;

    let is_archived: bool = conn.query_row(
        "SELECT is_archived FROM programs WHERE program_id = ?1",
        params![program_id],
        |row| row.get::<_, i32>(0).map(|v| v == 1),
    ).map_err(|e| e.to_string())?;

    if !is_archived {
        return Err("Only archived programs can be permanently deleted.".to_string());
    }

    let old_data: Option<serde_json::Value> = conn.query_row(
        "SELECT p.program_code, p.program_name, d.department_code 
         FROM programs p 
         JOIN departments d ON p.department_id = d.department_id 
         WHERE p.program_id = ?1",
        params![program_id],
        |row| Ok(json!({ 
            "program_code": row.get::<_, String>(0)?, 
            "program_name": row.get::<_, String>(1)?,
            "department": row.get::<_, String>(2)?
        })),
    ).ok();

    conn.execute("DELETE FROM programs WHERE program_id = ?1", params![program_id])
        .map_err(|e| e.to_string())?;

    let label = old_data.as_ref().and_then(|v| v.get("program_name")).and_then(|v| v.as_str()).unwrap_or("Unknown Program").to_string();
    let _ = log_audit_action(
        pool,
        active_admin_id,
        "DELETE",
        "Program",
        program_id,
        &label,
        old_data,
        None,
    );

    Ok(())
}

// ------ Database Backup & Recovery ------

pub fn backup_database(app_handle: &tauri::AppHandle, destination_path: &str) -> Result<String, String> {
    let app_dir = app_handle
        .path()
        .app_data_dir()
        .expect("Failed to get app data directory");
    let db_path = app_dir.join("smart_gate.sqlite");

    if !db_path.exists() {
        return Err("Database file not found.".to_string());
    }

    fs::copy(&db_path, destination_path)
        .map_err(|e| format!("Failed to create backup: {}", e))?;

    Ok(format!("Backup saved to: {}", destination_path))
}

pub fn restore_database(app_handle: &tauri::AppHandle, source_path: &str) -> Result<String, String> {
    let app_dir = app_handle
        .path()
        .app_data_dir()
        .expect("Failed to get app data directory");
    let db_path = app_dir.join("smart_gate.sqlite");

    let source = std::path::Path::new(source_path);
    if !source.exists() {
        return Err("Backup file not found.".to_string());
    }

    // Create a safety backup before overwriting
    let safety_backup = app_dir.join("smart_gate_pre_restore_backup.sqlite");
    if db_path.exists() {
        fs::copy(&db_path, &safety_backup)
            .map_err(|e| format!("Failed to create safety backup: {}", e))?;
    }

    fs::copy(source_path, &db_path)
        .map_err(|e| format!("Failed to restore database: {}", e))?;

    Ok("Database restored successfully. Please restart the application.".to_string())
}

pub fn get_database_stats(app_handle: &tauri::AppHandle, pool: &DbPool) -> Result<serde_json::Value, String> {
    let app_dir = app_handle
        .path()
        .app_data_dir()
        .expect("Failed to get app data directory");
    let db_path = app_dir.join("smart_gate.sqlite");

    let file_size = if db_path.exists() {
        fs::metadata(&db_path).map(|m| m.len()).unwrap_or(0)
    } else {
        0
    };

    let conn = pool.get().map_err(|e| e.to_string())?;

    let total_persons: i64 = conn.query_row("SELECT COUNT(*) FROM persons", [], |row| row.get(0)).unwrap_or(0);
    let total_events: i64 = conn.query_row("SELECT COUNT(*) FROM events", [], |row| row.get(0)).unwrap_or(0);
    let total_logs: i64 = conn.query_row("SELECT COUNT(*) FROM activity_logs", [], |row| row.get(0)).unwrap_or(0);
    let total_audit: i64 = conn.query_row("SELECT COUNT(*) FROM audit_events", [], |row| row.get(0)).unwrap_or(0);
    let archived_persons: i64 = conn.query_row("SELECT COUNT(*) FROM persons WHERE is_archived = 1", [], |row| row.get(0)).unwrap_or(0);
    let archived_events: i64 = conn.query_row("SELECT COUNT(*) FROM events WHERE is_archived = 1", [], |row| row.get(0)).unwrap_or(0);

    Ok(json!({
        "file_size_bytes": file_size,
        "total_persons": total_persons,
        "total_events": total_events,
        "total_entry_logs": total_logs,
        "total_audit_events": total_audit,
        "archived_persons": archived_persons,
        "archived_events": archived_events
    }))
}
