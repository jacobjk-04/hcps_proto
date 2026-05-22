# HCPS Database Schema

Two SQLite files. DB1 is the simulated primary EMR. DB2 is the HCPS backup — same tables, plus a few extra columns on medications and clinical_notes to support reconciliation.

| Database | File | Role |
|---|---|---|
| DB1 | `db/primary_emr.db` | Primary EMR — source of truth during normal operation |
| DB2 | `db/hcps_backup.db` | Backup — read source during downtime, stores downtime entries |

---

## DB1: primary_emr.db

### `patients`
| Column | Type | Notes |
|---|---|---|
| id | INTEGER PK | Auto-increment |
| mrn | TEXT UNIQUE | e.g. MRN-001 |
| first_name | TEXT | |
| last_name | TEXT | |
| dob | TEXT | YYYY-MM-DD |
| gender | TEXT | |
| ward | TEXT | |
| bed | TEXT | |
| admission_date | TEXT | |
| discharge_date | TEXT | Null if still admitted |
| status | TEXT | admitted / discharged |
| diagnosis | TEXT | |
| updated_at | TEXT | Last modified timestamp |

### `medications`
| Column | Type | Notes |
|---|---|---|
| id | INTEGER PK | |
| patient_id | INTEGER FK | → patients.id |
| name | TEXT | |
| dosage | TEXT | e.g. "500mg" |
| frequency | TEXT | e.g. "Twice daily" |
| route | TEXT | Oral, IV, SC, etc. |
| prescriber | TEXT | |
| start_date | TEXT | |
| end_date | TEXT | Null if ongoing |
| status | TEXT | active / ceased / on-hold |
| source | TEXT | EMR (default) |
| updated_at | TEXT | |

### `allergies`
| Column | Type | Notes |
|---|---|---|
| id | INTEGER PK | |
| patient_id | INTEGER FK | |
| allergen | TEXT | |
| reaction | TEXT | |
| severity | TEXT | Mild / Moderate / Severe |
| updated_at | TEXT | |

### `clinical_notes`
| Column | Type | Notes |
|---|---|---|
| id | INTEGER PK | |
| patient_id | INTEGER FK | |
| note_type | TEXT | e.g. Admission Note, Nursing Note |
| note_text | TEXT | |
| author | TEXT | |
| created_at | TEXT | |
| updated_at | TEXT | |
| source | TEXT | EMR (default) |

### `lab_results`
| Column | Type | Notes |
|---|---|---|
| id | INTEGER PK | |
| patient_id | INTEGER FK | |
| test_name | TEXT | e.g. "HbA1c" |
| value | TEXT | |
| unit | TEXT | |
| reference_range | TEXT | |
| status | TEXT | final / preliminary / corrected |
| collected_at | TEXT | |
| updated_at | TEXT | |

### `audit_log`
| Column | Type | Notes |
|---|---|---|
| id | INTEGER PK | |
| timestamp | TEXT | |
| user | TEXT | |
| action | TEXT | See action types below |
| patient_id | INTEGER | Nullable |
| details | TEXT | |

---

## DB2: hcps_backup.db

Same schema as DB1, except medications and clinical_notes have three extra columns:

| Column | Type | Values |
|---|---|---|
| source | TEXT | `'EMR'` = synced from DB1 / `'HCPS'` = added during downtime |
| reconciliation_status | TEXT | `'n/a'` / `'pending'` / `'deferred'` / `'reconciled'` |
| created_during_downtime | INTEGER | 0 or 1 |

The sync only deletes rows where `source = 'EMR'` before re-inserting. This is what stops a sync from wiping out downtime entries.

DB2 also has a `sync_metadata` table that DB1 doesn't:

### `sync_metadata`
| Column | Type | Notes |
|---|---|---|
| id | INTEGER PK | |
| sync_time | TEXT | |
| records_synced | INTEGER | |
| sync_status | TEXT | success / failed |
| sync_type | TEXT | manual |
| details | TEXT | |

---

## Audit log action types

| Action | Where logged |
|---|---|
| USER_LOGIN | Both DBs |
| USER_LOGOUT | Both DBs |
| SYNC_STARTED | Both DBs |
| SYNC_COMPLETED | Both DBs |
| SYNC_FAILED | Both DBs |
| DOWNTIME_ACTIVATED | Both DBs |
| EMR_RESTORED | Both DBs |
| PATIENT_LIST_VIEWED_DOWNTIME | DB2 only |
| PATIENT_RECORD_VIEWED_DOWNTIME | DB2 only |
| DOWNTIME_NOTE_ADDED | DB2 only |
| DOWNTIME_MEDICATION_ADDED | DB2 only |
| RECONCILIATION_CONFIRMED | Both DBs |
| RECONCILIATION_DEFERRED | Both DBs |

---

## Seed data (DB1)

| Entity | Count |
|---|---|
| Patients | 8 |
| Medications | 33 |
| Allergies | 8 |
| Clinical notes | 16 |
| Lab results | 31 |

---

## Design notes

**IDs are shared between DB1 and DB2.** When syncing, DB1's original IDs are written into DB2 (`INSERT OR REPLACE`). This makes deduplication straightforward on re-sync. The trade-off is that in a real multi-system deployment you'd need UUIDs to avoid collisions — here it's fine because it's a single local prototype.

**Downtime entries use auto-generated IDs.** When a clinician adds a note or medication during downtime, no ID is specified, so SQLite assigns the next available AUTOINCREMENT value. These IDs don't need to match anything in DB1.
