CREATE TABLE patients (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  mrn            TEXT    UNIQUE NOT NULL,
  first_name     TEXT    NOT NULL,
  last_name      TEXT    NOT NULL,
  dob            TEXT    NOT NULL,
  gender         TEXT,
  ward           TEXT,
  bed            TEXT,
  admission_date TEXT,
  discharge_date TEXT,
  status         TEXT    DEFAULT 'admitted',
  diagnosis      TEXT,
  updated_at     TEXT    DEFAULT (datetime('now'))
);

CREATE TABLE medications (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id  INTEGER NOT NULL,
  name        TEXT    NOT NULL,
  dosage      TEXT,
  frequency   TEXT,
  route       TEXT,
  prescriber  TEXT,
  start_date  TEXT,
  end_date    TEXT,
  status      TEXT    DEFAULT 'active',
  source      TEXT    DEFAULT 'EMR',
  updated_at  TEXT    DEFAULT (datetime('now')),
  FOREIGN KEY (patient_id) REFERENCES patients(id)
);

CREATE TABLE allergies (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id INTEGER NOT NULL,
  allergen   TEXT    NOT NULL,
  reaction   TEXT,
  severity   TEXT,
  updated_at TEXT    DEFAULT (datetime('now')),
  FOREIGN KEY (patient_id) REFERENCES patients(id)
);

CREATE TABLE clinical_notes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id INTEGER NOT NULL,
  note_type  TEXT,
  note_text  TEXT,
  author     TEXT,
  created_at TEXT    DEFAULT (datetime('now')),
  updated_at TEXT    DEFAULT (datetime('now')),
  source     TEXT    DEFAULT 'EMR',
  FOREIGN KEY (patient_id) REFERENCES patients(id)
);

CREATE TABLE lab_results (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id      INTEGER NOT NULL,
  test_name       TEXT,
  value           TEXT,
  unit            TEXT,
  reference_range TEXT,
  status          TEXT    DEFAULT 'final',
  collected_at    TEXT,
  updated_at      TEXT    DEFAULT (datetime('now')),
  FOREIGN KEY (patient_id) REFERENCES patients(id)
);

CREATE TABLE audit_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp  TEXT    DEFAULT (datetime('now')),
  user       TEXT,
  action     TEXT,
  patient_id INTEGER,
  details    TEXT
);


CREATE TABLE patients (
  id             INTEGER PRIMARY KEY,
  mrn            TEXT    UNIQUE NOT NULL,
  first_name     TEXT    NOT NULL,
  last_name      TEXT    NOT NULL,
  dob            TEXT    NOT NULL,
  gender         TEXT,
  ward           TEXT,
  bed            TEXT,
  admission_date TEXT,
  discharge_date TEXT,
  status         TEXT    DEFAULT 'admitted',
  diagnosis      TEXT,
  updated_at     TEXT    DEFAULT (datetime('now'))
);

CREATE TABLE medications (
  id                      INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id              INTEGER NOT NULL,
  name                    TEXT    NOT NULL,
  dosage                  TEXT,
  frequency               TEXT,
  route                   TEXT,
  prescriber              TEXT,
  start_date              TEXT,
  end_date                TEXT,
  status                  TEXT    DEFAULT 'active',
  source                  TEXT    DEFAULT 'EMR',
  reconciliation_status   TEXT    DEFAULT 'n/a',
  created_during_downtime INTEGER DEFAULT 0,
  updated_at              TEXT    DEFAULT (datetime('now')),
  FOREIGN KEY (patient_id) REFERENCES patients(id)
);

CREATE TABLE allergies (
  id         INTEGER PRIMARY KEY,
  patient_id INTEGER NOT NULL,
  allergen   TEXT    NOT NULL,
  reaction   TEXT,
  severity   TEXT,
  updated_at TEXT    DEFAULT (datetime('now')),
  FOREIGN KEY (patient_id) REFERENCES patients(id)
);

CREATE TABLE clinical_notes (
  id                      INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id              INTEGER NOT NULL,
  note_type               TEXT,
  note_text               TEXT,
  author                  TEXT,
  created_at              TEXT    DEFAULT (datetime('now')),
  updated_at              TEXT    DEFAULT (datetime('now')),
  source                  TEXT    DEFAULT 'EMR',
  reconciliation_status   TEXT    DEFAULT 'n/a',
  created_during_downtime INTEGER DEFAULT 0,
  FOREIGN KEY (patient_id) REFERENCES patients(id)
);

CREATE TABLE lab_results (
  id              INTEGER PRIMARY KEY,
  patient_id      INTEGER NOT NULL,
  test_name       TEXT,
  value           TEXT,
  unit            TEXT,
  reference_range TEXT,
  status          TEXT    DEFAULT 'final',
  collected_at    TEXT,
  updated_at      TEXT    DEFAULT (datetime('now')),
  source          TEXT    DEFAULT 'EMR',
  FOREIGN KEY (patient_id) REFERENCES patients(id)
);

CREATE TABLE sync_metadata (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  sync_time      TEXT    DEFAULT (datetime('now')),
  records_synced INTEGER,
  sync_status    TEXT,
  sync_type      TEXT,
  details        TEXT
);

CREATE TABLE audit_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp  TEXT    DEFAULT (datetime('now')),
  user       TEXT,
  action     TEXT,
  patient_id INTEGER,
  details    TEXT
);
