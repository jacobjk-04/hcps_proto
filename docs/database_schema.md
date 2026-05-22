# HCPS Database Schema

## Hybrid Continuity Planning System — Honours Thesis Prototype

---

## Overview

The system uses two separate SQLite databases to simulate the
dual-database architecture of a clinical continuity system.

| Database | File | Purpose |
|---|---|---|
| DB1 | `db/primary_emr.db` | Simulated primary EMR — source of truth during normal operation |
| DB2 | `db/hcps_backup.db` | HCPS backup database — minimum continuity dataset + downtime entries |

---

## DB1: primary_emr.db

### `patients`
| Column | Type | Description |
|---|---|---|
| id | INTEGER PK | Auto-increment patient ID |
| mrn | TEXT UNIQUE | Medical Record Number (e.g. MRN-001) |
| first_name | TEXT | Patient first name |
| last_name | TEXT | Patient last name |
| dob | TEXT | Date of birth (YYYY-MM-DD) |
| gender | TEXT | Male / Female / Other |
| ward | TEXT | Hospital ward |
| bed | TEXT | Bed number |
| admission_date | TEXT | Admission date |
| discharge_date | TEXT | Discharge date (null if admitted) |
| status | TEXT | admitted \| discharged |
| diagnosis | TEXT | Primary diagnosis |
| updated_at | TEXT | Last modification timestamp |

### `medications`
| Column | Type | Description |
|---|---|---|
| id | INTEGER PK | Auto-increment |
| patient_id | INTEGER FK | References patients.id |
| name | TEXT | Medication name |
| dosage | TEXT | Dose (e.g. "500mg") |
| frequency | TEXT | Frequency (e.g. "Twice daily") |
| route | TEXT | Route (Oral, IV, SC, etc.) |
| prescriber | TEXT | Prescribing clinician |
| start_date | TEXT | Start date |
| end_date | TEXT | End date (null if ongoing) |
| status | TEXT | active \| ceased \| on-hold |
| source | TEXT | EMR (default) |
| updated_at | TEXT | Last modification timestamp |

### `allergies`
| Column | Type | Description |
|---|---|---|
| id | INTEGER PK | Auto-increment |
| patient_id | INTEGER FK | References patients.id |
| allergen | TEXT | Allergen name |
| reaction | TEXT | Reaction description |
| severity | TEXT | Mild \| Moderate \| Severe |
| updated_at | TEXT | Last modification timestamp |

### `clinical_notes`
| Column | Type | Description |
|---|---|---|
| id | INTEGER PK | Auto-increment |
| patient_id | INTEGER FK | References patients.id |
| note_type | TEXT | Note category (Admission Note, etc.) |
| note_text | TEXT | Full note body |
| author | TEXT | Clinician who wrote the note |
| created_at | TEXT | Creation timestamp |
| updated_at | TEXT | Last modification timestamp |
| source | TEXT | EMR (default) |

### `lab_results`
| Column | Type | Description |
|---|---|---|
| id | INTEGER PK | Auto-increment |
| patient_id | INTEGER FK | References patients.id |
| test_name | TEXT | Test name (e.g. "HbA1c") |
| value | TEXT | Result value |
| unit | TEXT | Unit of measure |
| reference_range | TEXT | Normal reference range |
| status | TEXT | final \| preliminary \| corrected |
| collected_at | TEXT | Collection timestamp |
| updated_at | TEXT | Last modification timestamp |

### `audit_log`
| Column | Type | Description |
|---|---|---|
| id | INTEGER PK | Auto-increment |
| timestamp | TEXT | Event timestamp |
| user | TEXT | User who performed the action |
| action | TEXT | Action type (see below) |
| patient_id | INTEGER | Related patient ID (nullable) |
| details | TEXT | Human-readable description |

---

## DB2: hcps_backup.db

Tables `patients`, `allergies`, and `lab_results` share the same schema as DB1
(using explicit IDs matching DB1's primary keys).

Tables `medications` and `clinical_notes` have three additional columns:

### Additional columns on `medications` and `clinical_notes`

| Column | Type | Description |
|---|---|---|
| source | TEXT | `'EMR'` = synced from DB1 \| `'HCPS'` = added during downtime |
| reconciliation_status | TEXT | `'n/a'` \| `'pending'` \| `'deferred'` \| `'reconciled'` |
| created_during_downtime | INTEGER | `0` = synced record \| `1` = downtime entry |

### `sync_metadata` (DB2 only)
| Column | Type | Description |
|---|---|---|
| id | INTEGER PK | Auto-increment |
| sync_time | TEXT | Timestamp of sync event |
| records_synced | INTEGER | Total records copied in this sync |
| sync_status | TEXT | `success` \| `failed` |
| sync_type | TEXT | `manual` \| `scheduled` |
| details | TEXT | Human-readable sync summary |

---

## Audit Log Action Types

| Action | Logged In | Description |
|---|---|---|
| USER_LOGIN | Both DBs | User authenticated |
| USER_LOGOUT | Both DBs | User logged out |
| SYNC_STARTED | Both DBs | Manual sync initiated |
| SYNC_COMPLETED | Both DBs | Sync completed successfully |
| SYNC_FAILED | Both DBs | Sync failed with error |
| DOWNTIME_ACTIVATED | Both DBs | Primary EMR marked offline |
| EMR_RESTORED | Both DBs | Primary EMR restored online |
| PATIENT_LIST_VIEWED_DOWNTIME | DB2 only | Patient list accessed during downtime |
| PATIENT_RECORD_VIEWED_DOWNTIME | DB2 only | Individual patient record viewed during downtime |
| DOWNTIME_NOTE_ADDED | DB2 only | Clinical note added during downtime |
| DOWNTIME_MEDICATION_ADDED | DB2 only | Medication entry added during downtime |
| RECONCILIATION_CONFIRMED | Both DBs | Downtime entry confirmed and copied to DB1 |
| RECONCILIATION_DEFERRED | Both DBs | Downtime entry deferred for later review |

---

## Seed Data Summary (DB1)

| Entity | Count | Notes |
|---|---|---|
| Patients | 8 | All admitted, various wards |
| Medications | 33 | Active medications, various routes |
| Allergies | 8 | Various allergens and severities |
| Clinical Notes | 16 | 2 notes per patient |
| Lab Results | 31 | 3–6 results per patient |

---

## Key Design Decisions

1. **DB2 shares table names with DB1**: Simplifies the sync and query logic.
   The application state (`systemState.primaryEMROnline`) determines which
   database to read from at query time.

2. **Explicit IDs for synced records**: When copying from DB1 to DB2,
   the original DB1 ID is preserved to enable deduplication on re-sync
   (`INSERT OR REPLACE` / `INSERT OR IGNORE`).

3. **HCPS downtime entries get auto-generated IDs**: When a clinician adds
   a note or medication during downtime, no explicit ID is provided,
   so SQLite's AUTOINCREMENT assigns the next available ID.

4. **Source column**: `source = 'EMR'` marks records copied from DB1.
   `source = 'HCPS'` marks records created during downtime.
   The sync process only deletes `source = 'EMR'` records, protecting
   HCPS downtime entries from being overwritten.

5. **Prototype limitation — ID management**: In a production system,
   UUIDs would be used to prevent potential ID collisions between DB1
   and DB2 after multiple sync cycles.
