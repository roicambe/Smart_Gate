-- Academic Structure
CREATE TABLE IF NOT EXISTS departments (
    department_id INTEGER PRIMARY KEY,
    department_code VARCHAR UNIQUE NOT NULL,
    department_name VARCHAR NOT NULL,
    is_archived BOOLEAN NOT NULL DEFAULT 0,
    archived_at DATETIME NULL
);

CREATE TABLE IF NOT EXISTS programs (
    program_id INTEGER PRIMARY KEY,
    department_id INTEGER NOT NULL,
    program_code VARCHAR UNIQUE NOT NULL,
    program_name VARCHAR NOT NULL,
    is_archived BOOLEAN NOT NULL DEFAULT 0,
    archived_at DATETIME NULL,
    FOREIGN KEY (department_id) REFERENCES departments(department_id)
);

-- User Management (Normalized)
CREATE TABLE IF NOT EXISTS persons (
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

-- Biometrics
CREATE TABLE IF NOT EXISTS face_embeddings (
    embedding_id INTEGER PRIMARY KEY AUTOINCREMENT,
    person_id    INTEGER NOT NULL UNIQUE,
    embedding    BLOB NOT NULL,
    enrolled_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (person_id) REFERENCES persons(person_id) ON DELETE CASCADE
);

-- Subtype tables
CREATE TABLE IF NOT EXISTS students (
    person_id INTEGER PRIMARY KEY,
    program_id INTEGER NOT NULL,
    year_level INTEGER NULL,
    is_irregular BOOLEAN NOT NULL DEFAULT 0,
    FOREIGN KEY (person_id) REFERENCES persons(person_id) ON DELETE CASCADE,
    FOREIGN KEY (program_id) REFERENCES programs(program_id)
);

CREATE TABLE IF NOT EXISTS visitors (
    person_id INTEGER PRIMARY KEY,
    purpose_of_visit VARCHAR NOT NULL,
    person_to_visit VARCHAR NOT NULL,
    FOREIGN KEY (person_id) REFERENCES persons(person_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS employees (
    person_id INTEGER PRIMARY KEY,
    department_id INTEGER NOT NULL,
    position_title VARCHAR NOT NULL,
    FOREIGN KEY (person_id) REFERENCES persons(person_id) ON DELETE CASCADE,
    FOREIGN KEY (department_id) REFERENCES departments(department_id)
);

-- Hardware / Scanners
CREATE TABLE IF NOT EXISTS scanners (
    scanner_id INTEGER PRIMARY KEY AUTOINCREMENT,
    location_name VARCHAR NOT NULL,
    function TEXT CHECK(function IN ('entrance', 'exit', 'event')) NOT NULL
);

-- Events & Scheduling (Normalized)
CREATE TABLE IF NOT EXISTS events (
    event_id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_name VARCHAR UNIQUE NOT NULL,
    description TEXT NULL,
    is_enabled BOOLEAN NOT NULL DEFAULT 1,
    is_archived BOOLEAN NOT NULL DEFAULT 0,
    archived_at DATETIME NULL
);

CREATE TABLE IF NOT EXISTS event_weekly (
    schedule_id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id INTEGER NOT NULL,
    day_of_week TEXT NOT NULL, -- Monday, Tuesday, etc.
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    UNIQUE(event_id, day_of_week, start_time, end_time),
    FOREIGN KEY (event_id) REFERENCES events(event_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS event_date_range (
    schedule_id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id INTEGER NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    UNIQUE(event_id, start_date, end_date, start_time, end_time),
    FOREIGN KEY (event_id) REFERENCES events(event_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS event_required_roles (
    event_id INTEGER NOT NULL,
    role_id INTEGER NOT NULL,
    PRIMARY KEY (event_id, role_id),
    FOREIGN KEY (event_id) REFERENCES events(event_id) ON DELETE CASCADE,
    FOREIGN KEY (role_id) REFERENCES roles(role_id) ON DELETE CASCADE
);

-- Unified Activity Logs
CREATE TABLE IF NOT EXISTS activity_logs (
    log_id INTEGER PRIMARY KEY AUTOINCREMENT,
    person_id INTEGER NOT NULL,
    scanner_id INTEGER NOT NULL,
    activity_type TEXT CHECK(activity_type IN ('entrance', 'exit', 'event')) NOT NULL,
    event_id INTEGER NULL, -- Links to events table if activity_type is 'event'
    scanned_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    status TEXT NULL, -- 'On Time', 'Late' for events, NULL for gate
    FOREIGN KEY (person_id) REFERENCES persons(person_id),
    FOREIGN KEY (scanner_id) REFERENCES scanners(scanner_id),
    FOREIGN KEY (event_id) REFERENCES events(event_id)
);

-- Admin
CREATE TABLE IF NOT EXISTS audit_events (
    event_id INTEGER PRIMARY KEY AUTOINCREMENT,
    action_type TEXT CHECK(action_type IN ('CREATE', 'UPDATE', 'DELETE', 'ARCHIVE', 'RESTORE')) NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id INTEGER NOT NULL,
    entity_label TEXT NOT NULL,
    performed_by INTEGER NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (performed_by) REFERENCES accounts(account_id)
);

CREATE TABLE IF NOT EXISTS audit_changes (
    change_id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id INTEGER NOT NULL,
    field_name TEXT NOT NULL,
    old_value TEXT NULL,
    new_value TEXT NULL,
    FOREIGN KEY (event_id) REFERENCES audit_events(event_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS accounts (
    account_id INTEGER PRIMARY KEY AUTOINCREMENT,
    username VARCHAR UNIQUE NOT NULL,
    password_hash VARCHAR NOT NULL,
    full_name VARCHAR NOT NULL DEFAULT 'Administrator',
    email VARCHAR NULL,
    role TEXT CHECK(role IN ('System Administrator', 'Gate Supervisor')) NOT NULL,
    is_first_login BOOLEAN NOT NULL DEFAULT 0,
    activation_otp VARCHAR NULL,
    activation_otp_expires_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- System Settings
CREATE TABLE IF NOT EXISTS settings (
    setting_key VARCHAR PRIMARY KEY,
    setting_value TEXT NOT NULL
);

-- Seed Data
INSERT OR IGNORE INTO roles (role_name) VALUES 
    ('student'), ('professor'), ('staff'), ('visitor');

INSERT OR IGNORE INTO departments (department_id, department_code, department_name) VALUES
    (1, 'COE', 'College of Education'),
    (2, 'CE', 'College of Engineering'),
    (3, 'CBA', 'College of Business and Accountancy'),
    (4, 'CAS', 'College of Arts and Sciences'),
    (5, 'CON', 'College of Nursing'),
    (6, 'CCS', 'College of Computer Studies'),
    (7, 'CIHM', 'College of International Hospitality Management');

INSERT OR IGNORE INTO programs (program_id, department_id, program_code, program_name) VALUES
    (1, 1, 'BEED', 'Bachelor of Elementary Education'),
    (2, 1, 'BSED-EN', 'Bachelor of Secondary Education Major in English'),
    (3, 1, 'BSED-MA', 'Bachelor of Secondary Education Major in Mathematics'),
    (4, 1, 'BSED-FL', 'Bachelor of Secondary Education Major in Filipino'),
    (5, 2, 'BSCE', 'Bachelor of Science in Civil Engineering'),
    (6, 3, 'BSBA-MM', 'Bachelor of Science in Business Administration Major in Marketing Management'),
    (7, 4, 'BA-COMM', 'Bachelor of Arts in Communication'),
    (8, 4, 'BS-PSYCH', 'Bachelor of Science in Psychology'),
    (9, 5, 'BSN', 'Bachelor of Science in Nursing'),
    (10, 6, 'BSIT', 'Bachelor of Science in Information Technology'),
    (11, 6, 'BSCS', 'Bachelor of Science in Computer Science'),
    (12, 7, 'BSHM', 'Bachelor of Science in Hospitality Management'),
    (13, 7, 'BSTM', 'Bachelor of Science in Tourism Management');

INSERT OR IGNORE INTO scanners (scanner_id, location_name, function) VALUES
    (1, 'Main Entrance', 'entrance'),
    (2, 'Main Exit', 'exit');

INSERT OR IGNORE INTO settings (setting_key, setting_value) VALUES
    ('system_name', 'Pamantasan ng Lungsod ng Pasig'),
    ('system_title', 'SMART GATE'),
    ('report_address', 'Alkalde Jose St. Kapasigan Pasig City, Philippines 1600'),
    ('report_phone', '(106) 628-1014'),
    ('report_email', 'info@plpasig.edu.ph'),
    ('system_logo', ''),
    ('strict_email_domain', 'true'),
    ('enable_face_recognition', 'true');

INSERT OR IGNORE INTO accounts (username, password_hash, full_name, role, is_first_login) VALUES
    ('admin', 'admin123', 'System Administrator', 'System Administrator', 0);

-- Default Events
INSERT OR IGNORE INTO events (event_id, event_name, description) VALUES
    (1, 'Flag Ceremony', 'Official Monday morning assembly');

INSERT OR IGNORE INTO event_weekly (event_id, day_of_week, start_time, end_time) VALUES
    (1, 'Monday', '07:30:00', '08:30:00');

INSERT OR IGNORE INTO event_required_roles (event_id, role_id)
SELECT 1, role_id FROM roles;
