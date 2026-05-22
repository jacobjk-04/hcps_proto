# HCPS — Hybrid Continuity Planning System

**Honours Thesis Prototype** | Bachelor of Software Engineering

> This is a proof-of-concept prototype built for academic demonstration.
> All patient data is entirely fictional. This system is not connected to
> any real hospital or clinical system and is not suitable for clinical use.

---

## Project Purpose

HCPS demonstrates how a hospital can maintain clinical continuity during
Electronic Medical Record (EMR) downtime. The system simulates:

- **DB1** — A primary EMR database (`primary_emr.db`)
- **DB2** — An HCPS backup database (`hcps_backup.db`)
- Selective synchronisation of a **minimum continuity dataset** from DB1 to DB2
- A **downtime mode** where clinicians read from DB2 and document into it
- A **reconciliation queue** to merge downtime entries back into DB1
- **Audit logging** of all significant system actions

---

## Installation

**Prerequisites:** Node.js 18+ installed.

```bash
# 1. Navigate to the project directory
cd hcps-fullstack

# 2. Install dependencies
npm install

# 3. Initialise databases (creates and seeds SQLite databases)
npm run init-db

# 4. Start the server
npm start
```

The server will start at **http://localhost:3000**

---

## Demo Login

| Field | Value |
|---|---|
| Username | `admin` |
| Password | `hcps2025` |

---

## Project Structure

```
hcps-fullstack/
├── package.json          — Node.js project config & dependencies
├── server.js             — Express backend (all API routes)
├── README.md             — This file
│
├── db/
│   ├── init.js           — Database schema creation & seed data
│   ├── schema.sql        — Schema reference (documentation only)
│   ├── primary_emr.db    — DB1: Primary EMR (created on init)
│   └── hcps_backup.db    — DB2: HCPS backup (created on init)
│
├── public/
│   ├── index.html        — SPA shell
│   ├── styles.css        — Healthcare-themed stylesheet
│   └── app.js            — Frontend SPA (all UI logic)
│
└── docs/
    ├── architecture.md   — System architecture documentation
    └── database_schema.md — Database schema documentation
```

---

## API Routes

| Method | Route | Description |
|---|---|---|
| POST | `/api/login` | Authenticate (admin/hcps2025) |
| POST | `/api/logout` | End session |
| GET  | `/api/status` | System status, sync info, pending count |
| POST | `/api/sync` | Selective sync from DB1 → DB2 |
| POST | `/api/downtime/start` | Activate downtime mode |
| POST | `/api/downtime/end` | Restore primary EMR |
| GET  | `/api/patients` | List admitted patients (DB1 or DB2) |
| GET  | `/api/patients/:id` | Full patient record (DB1 or DB2) |
| POST | `/api/hcps/notes` | Add downtime clinical note (DB2) |
| POST | `/api/hcps/medication-entry` | Add downtime medication (DB2) |
| GET  | `/api/reconciliation` | List pending/deferred downtime entries |
| POST | `/api/reconciliation/:id/confirm` | Copy entry to DB1, mark reconciled |
| POST | `/api/reconciliation/:id/defer` | Mark entry as deferred |
| GET  | `/api/audit-log` | Retrieve audit log entries |

---

## Demonstration Workflow

Follow these steps to demonstrate the full HCPS workflow:

### Step 1 — Login
Open http://localhost:3000, log in with `admin` / `hcps2025`.

### Step 2 — View Primary EMR Dashboard
The dashboard shows system status. The Primary EMR (DB1) is online.
Note that no sync has been performed yet.

### Step 3 — View Patients from DB1
Navigate to **Patient Records**. Eight fictional patients are displayed
from the primary EMR database. Click any patient to view their full
record including medications, allergies, notes, and lab results.

### Step 4 — Run Manual Sync (DB1 → DB2)
Navigate to **Sync & Status** and click **Run Manual Sync Now**.
The system copies the minimum continuity dataset from DB1 to DB2:
admitted patients, allergies, active medications, recent notes (7 days),
and recent lab results (3 days).

### Step 5 — Observe Sync Metadata
After sync, the header shows the last sync time. The dashboard shows
the number of records synced. DB2 now contains a current snapshot.

### Step 6 — Activate Downtime Mode
Navigate to **Downtime Controls** and click **Activate Downtime Mode**.
A confirmation prompt is shown. Confirm to proceed.

### Step 7 — Observe HCPS Mode
A red downtime banner appears across the UI. All patient data is now
served from the HCPS backup database (DB2). The header shows
"DOWNTIME MODE ACTIVE".

### Step 8 — View Patients from DB2
Navigate to **Patient Records**. Patients are now shown from DB2.
A banner indicates the data source and the last sync time.
The patient list and records appear the same — this demonstrates
successful pre-synchronisation.

### Step 9 — Add a Downtime Clinical Note
Click any patient → **Clinical Notes** tab → **Add Downtime Note**.
Fill in the form and submit. The note is saved to DB2 with
`source='HCPS'` and `reconciliation_status='pending'`.

### Step 10 — Add a Downtime Medication Entry
On the same or a different patient → **Medications** tab →
**Add Downtime Medication**. Fill in the form and submit.
The entry is saved to DB2, pending reconciliation.

### Step 11 — Restore Primary EMR
Navigate to **Downtime Controls** → **Restore Primary EMR**.
The system returns to serving data from DB1.

### Step 12 — Open Reconciliation Queue
Navigate to **Reconciliation Queue**. The two downtime entries
added in steps 9 and 10 appear. Any entries where the DB1 record
was modified after the last sync will show a conflict warning.

### Step 13 — Confirm Reconciliation
Click **Confirm** on a downtime entry. The entry is copied from DB2
into DB1 and marked as `reconciled` in DB2. The action is logged.

### Step 14 — Verify in Primary EMR
Navigate to the relevant patient in **Patient Records** (now reading
from DB1). The reconciled entry is present with a `[HCPS]` annotation.

### Step 15 — Review Audit Log
Navigate to **Audit Log**. The complete trail of actions is displayed:
login, sync, downtime activation, record views, note/medication additions,
EMR restoration, and reconciliation confirmations.

---

## How Synchronisation Works

The `POST /api/sync` endpoint performs a **selective synchronisation**:

1. Queries all admitted patients from DB1
2. For each patient, copies allergies (complete), active medications,
   clinical notes from the last 7 days, and lab results from the last 3 days
3. **Protects HCPS downtime entries**: only deletes records with `source='EMR'`
   before re-inserting, so any HCPS-created entries are never overwritten
4. Records a `sync_metadata` entry in DB2 with timestamp and record count
5. Logs `SYNC_COMPLETED` in both DBs' audit logs

---

## How Downtime Mode Works

The server maintains a `systemState.primaryEMROnline` boolean flag.

- When `true`: `GET /api/patients` and `GET /api/patients/:id` query **DB1**
- When `false`: the same endpoints query **DB2**
- `POST /api/hcps/notes` and `/api/hcps/medication-entry` only accept
  requests when `primaryEMROnline === false`

The flag is changed by:
- `POST /api/downtime/start` → sets `primaryEMROnline = false`
- `POST /api/downtime/end` → sets `primaryEMROnline = true`

All patient record views during downtime are logged in the audit log.

---

## How Reconciliation Works

After the EMR is restored, `GET /api/reconciliation` queries DB2 for all
entries where `created_during_downtime = 1` and `reconciliation_status IN
('pending', 'deferred')`.

**Conflict detection**: For each item, the system checks whether the
patient's record in DB1 (`updated_at`) or their medications were modified
after the last successful sync. If so, a conflict warning is attached.

**Confirm** (`POST /api/reconciliation/:id/confirm`):
1. Reads the downtime entry from DB2
2. Inserts it into DB1 with a `[Reconciled from HCPS]` annotation
3. Updates `reconciliation_status = 'reconciled'` in DB2
4. Logs `RECONCILIATION_CONFIRMED` in both DBs

**Defer** (`POST /api/reconciliation/:id/defer`):
1. Updates `reconciliation_status = 'deferred'` in DB2
2. Logs `RECONCILIATION_DEFERRED` in both DBs
3. Item remains visible in the queue

---

## Resetting the Prototype

To reset to a clean state (delete all databases and re-seed):

```bash
# Windows
del db\primary_emr.db db\hcps_backup.db
npm run init-db
npm start

# macOS / Linux
rm db/primary_emr.db db/hcps_backup.db
npm run init-db
npm start
```

---

## Prototype Limitations

| Limitation | Production Requirement |
|---|---|
| SQLite, no encryption | Enterprise RDBMS with encryption at rest |
| Single hardcoded credential | OAuth2 / SAML, RBAC, MFA |
| In-memory session state | Distributed session store (Redis) |
| No FHIR/HL7 integration | Real EMR API integration |
| Advisory conflict detection only | Clinical workflow-based resolution |
| No patient privacy controls | Privacy Act / HIPAA compliance |
| Simplified ID management | UUID-based distributed IDs |
| No scheduled sync | Automated sync with change data capture |
| No audit tamper-proofing | Immutable append-only audit store |
| Not clinically validated | Full clinical and usability validation |

---

## Academic Note

This prototype was developed as a thesis proof-of-concept to demonstrate
the architectural concepts of clinical EMR continuity planning. It is
intended to support academic discussion and is not a design specification
for a production system. Terminology used throughout the code and UI
(simulated primary EMR, HCPS backup database, selective synchronisation,
minimum continuity dataset, downtime entry, reconciliation queue) reflects
the academic framing of the thesis research.
