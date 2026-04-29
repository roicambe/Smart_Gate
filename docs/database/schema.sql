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

-- User Management
CREATE TABLE IF NOT EXISTS persons (
    person_id INTEGER PRIMARY KEY AUTOINCREMENT,
    id_number VARCHAR UNIQUE NOT NULL, -- Renamed from school_id_number
    role TEXT CHECK(role IN ('student', 'professor', 'staff', 'visitor')) NOT NULL,
    first_name VARCHAR NOT NULL,
    middle_name VARCHAR NULL,
    last_name VARCHAR NOT NULL,
    email VARCHAR NULL,               -- Added: Normalized contact data
    contact_number VARCHAR NULL,      -- Added: Normalized contact data
    face_template_path VARCHAR NULL,
    is_active BOOLEAN NOT NULL DEFAULT 1,
    is_archived BOOLEAN NOT NULL DEFAULT 0,
    archived_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS students (
    person_id INTEGER PRIMARY KEY,
    program_id INTEGER NOT NULL,
    year_level INTEGER NULL,
    FOREIGN KEY (person_id) REFERENCES persons(person_id),
    FOREIGN KEY (program_id) REFERENCES programs(program_id)
);

CREATE TABLE IF NOT EXISTS visitors (
    person_id INTEGER PRIMARY KEY,
    purpose_of_visit VARCHAR NOT NULL,
    person_to_visit VARCHAR NOT NULL,
    FOREIGN KEY (person_id) REFERENCES persons(person_id)
);

CREATE TABLE IF NOT EXISTS employees (
    person_id INTEGER PRIMARY KEY,
    department_id INTEGER NOT NULL,
    position_title VARCHAR NOT NULL,
    FOREIGN KEY (person_id) REFERENCES persons(person_id),
    FOREIGN KEY (department_id) REFERENCES departments(department_id)
);

-- Hardware / Scanners
CREATE TABLE IF NOT EXISTS scanners (
    scanner_id INTEGER PRIMARY KEY AUTOINCREMENT,
    location_name VARCHAR NOT NULL,
    function TEXT CHECK(function IN ('entrance', 'exit', 'event')) NOT NULL
);

-- Logging & Events
CREATE TABLE IF NOT EXISTS entry_logs (
    log_id INTEGER PRIMARY KEY AUTOINCREMENT, -- SQLite uses INTEGER for bigints
    person_id INTEGER NOT NULL,
    scanner_id INTEGER NOT NULL,
    scanned_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (person_id) REFERENCES persons(person_id),
    FOREIGN KEY (scanner_id) REFERENCES scanners(scanner_id)
);

CREATE TABLE IF NOT EXISTS events (
    event_id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_name VARCHAR UNIQUE NOT NULL,
    description TEXT NULL,
    schedule_type VARCHAR NULL DEFAULT 'weekly',
    event_date VARCHAR NOT NULL,
    start_date VARCHAR NULL,
    end_date VARCHAR NULL,
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    required_role TEXT NOT NULL,
    is_enabled BOOLEAN NOT NULL DEFAULT 1,
    is_archived BOOLEAN NOT NULL DEFAULT 0,
    archived_at DATETIME NULL
);

CREATE TABLE IF NOT EXISTS event_attendance (
    attendance_id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id INTEGER NOT NULL,
    person_id INTEGER NOT NULL,
    scanned_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    status TEXT CHECK(status IN ('On Time', 'Late')) NOT NULL DEFAULT 'On Time',
    FOREIGN KEY (event_id) REFERENCES events(event_id),
    FOREIGN KEY (person_id) REFERENCES persons(person_id)
);

INSERT OR IGNORE INTO events (event_name, description, schedule_type, event_date, start_time, end_time, required_role, is_enabled)  
VALUES ('Flag Ceremony', 'Official weekly campus flag ceremony', 'weekly', 'Monday', '07:30', '08:00', 'all', 1);

-- Admin
CREATE TABLE IF NOT EXISTS audit_logs (
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

-- Seed Official University Academic Structure
INSERT OR IGNORE INTO departments (department_id, department_code, department_name) VALUES
    (1, 'COE', 'College of Education'),
    (2, 'CE', 'College of Engineering'),
    (3, 'CBA', 'College of Business and Accountancy'),
    (4, 'CAS', 'College of Arts and Sciences'),
    (5, 'CON', 'College of Nursing'),
    (6, 'CCS', 'College of Computer Studies'),
    (7, 'CIHM', 'College of International Hospitality Management');

-- Seed Official Programs
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

-- Seed Default Scanners
INSERT OR IGNORE INTO scanners (scanner_id, location_name, function) VALUES
    (1, 'Main Entrance', 'entrance'),
    (2, 'Main Exit', 'exit');

-- System Settings
CREATE TABLE IF NOT EXISTS settings (
    setting_key VARCHAR PRIMARY KEY,
    setting_value TEXT NOT NULL
);

INSERT OR IGNORE INTO settings (setting_key, setting_value) VALUES
    ('system_name', 'Pamantasan ng Lungsod ng Pasig'),
    ('system_title', 'SMART GATE'),
    ('report_address', 'Alkalde Jose St. Kapasigan Pasig City, Philippines 1600'),
    ('report_phone', '(106) 628-1014'),
    ('report_email', 'info@plpasig.edu.ph'),
    ('system_logo', ''),
    ('strict_email_domain', 'true'),
    ('enable_face_recognition', 'false');
