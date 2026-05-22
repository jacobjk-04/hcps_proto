# HCPS — How the Code Works

Quick reference for understanding the prototype. Useful for explaining it to a supervisor, or for coming back to it after a break.

---

## What it does

HCPS simulates what happens when a hospital's EMR goes down. During an outage, staff still need to look up patients and record notes or medications. This system keeps a backup copy of recent patient data in a second database (DB2) that clinicians can read from during downtime. When the EMR comes back, anything recorded during the outage gets reviewed and copied back in — that's the reconciliation step.

---

## Backend (server.js)

Node.js + Express. All the API routes are in one file. I kept it in a single file deliberately — for a prototype with this many routes, splitting into separate route files would add structure without much benefit.

### Startup

Opens both SQLite databases, enables WAL mode (better performance under concurrent reads), then listens on port 3000.

### Auth

There's one hardcoded user: `admin` / `hcps2025`. Not secure, but enough to demonstrate the session concept.

On login, the server generates a random 64-char hex token and stores it in a `sessions` object in memory. Every API request after that needs this token in the `Authorization: Bearer <token>` header. If the server restarts, all sessions are wiped and you have to log in again — that's an expected limitation.

### systemState

This is the core mechanism behind downtime mode:

```js
const systemState = {
  primaryEMROnline: true,
  downtimeStartTime: null,
  lastSyncTime: null
};
```

It's just an object in memory. Every route that reads patients checks `systemState.primaryEMROnline` to decide whether to read from DB1 or DB2. Resets on server restart.

### Routes

| Route | What it does |
|---|---|
| `POST /api/login` | Check credentials, return a session token |
| `POST /api/logout` | Delete the session token |
| `GET /api/status` | Current state — EMR online/offline, last sync, pending count |
| `POST /api/sync` | Copy data from DB1 to DB2 |
| `POST /api/downtime/start` | Set `primaryEMROnline = false` |
| `POST /api/downtime/end` | Set `primaryEMROnline = true` |
| `GET /api/patients` | List admitted patients (DB1 or DB2 depending on state) |
| `GET /api/patients/:id` | Full patient record — meds, allergies, notes, labs |
| `POST /api/hcps/notes` | Add a downtime note to DB2 |
| `POST /api/hcps/medication-entry` | Add a downtime medication to DB2 |
| `GET /api/reconciliation` | List all downtime entries pending review |
| `POST /api/reconciliation/:id/confirm` | Copy a downtime entry from DB2 into DB1 |
| `POST /api/reconciliation/:id/defer` | Mark an entry for later review |
| `GET /api/audit-log` | Recent audit log entries |

### Audit logging

Every significant action is written to `audit_log`. The `auditBoth()` helper writes to both DB1 and DB2 — the reasoning being that if one database is unavailable, you still have a log copy in the other.

---

## The Databases

Two SQLite files in the `db/` folder. SQLite was the right choice here — no server process to set up, works fine for a single-user prototype, and the databases are just files you can inspect directly.

### DB1 — primary_emr.db

The simulated primary EMR. Seeded with 8 fake patients and their clinical data. This is the source of truth under normal conditions. In a real system this would be something like Epic or Cerner — here it's a local file.

### DB2 — hcps_backup.db

The backup database. Same tables as DB1, plus three extra columns on medications and clinical_notes:

- `source` — `'EMR'` (came from a sync) or `'HCPS'` (added during downtime)
- `reconciliation_status` — `'n/a'`, `'pending'`, `'reconciled'`, or `'deferred'`
- `created_during_downtime` — `1` if added while the EMR was offline, `0` otherwise

DB2 also has a `sync_metadata` table that records each sync run. DB2 starts empty and only gets data after the first sync.

### Tables

| Table | What it stores |
|---|---|
| `patients` | Name, DOB, MRN, ward, bed, diagnosis |
| `medications` | Drug, dose, frequency, route, prescriber |
| `allergies` | Allergen, reaction, severity |
| `clinical_notes` | Note text, type, author, timestamp |
| `lab_results` | Test name, value, unit, reference range |
| `audit_log` | Timestamp, user, action type, patient ID, details |
| `sync_metadata` | Sync history — time, record count, status (DB2 only) |

---

## The Sync

Clicking "Run Manual Sync" copies a snapshot of DB1 into DB2. It only copies what a clinician actually needs during an outage — not the full database.

**What gets copied:**
- All admitted patients (not discharged)
- All their allergies — these are always included because they're safety-critical
- Active medications only
- Clinical notes from the last 7 days
- Lab results from the last 3 days

**What gets left out:** older notes/labs, discharged patients, billing records.

The whole sync runs inside a SQLite transaction, so if anything fails it rolls back completely. No half-synced state.

One important detail: for medications and notes, the sync only deletes rows with `source = 'EMR'` before re-inserting from DB1. Rows with `source = 'HCPS'` (added during a previous downtime) are left alone. Without this, a sync would wipe out unreconciled downtime entries.

---

## Downtime Mode

Clicking "Activate Downtime Mode" just sets `systemState.primaryEMROnline = false`. Every route that reads patients checks that flag and switches to DB2 if it's false.

During downtime:
- The frontend shows a red banner and warning pill in the header
- Patient data is read from DB2
- "Add Downtime Note" and "Add Downtime Medication" buttons appear on patient records
- New entries go into DB2 with `source = 'HCPS'`, `reconciliation_status = 'pending'`, and `created_during_downtime = 1`

Clicking "Restore Primary EMR" sets the flag back to true. The downtime records stay in DB2 until they're reconciled.

---

## Reconciliation

After the EMR is back, downtime entries in DB2 need to be reviewed and copied into DB1. The reconciliation queue shows all entries where `created_during_downtime = 1` and `reconciliation_status` is `'pending'` or `'deferred'`.

**Conflict detection:** Before showing each entry, the server checks whether the patient's record in DB1 was updated after the last sync. If it was, the entry gets a warning flag. This is advisory — no automated resolution. A clinician looks at it and decides.

**Confirm:** Inserts the entry into DB1, marks it `'reconciled'` in DB2, logs the action to both audit logs.

**Defer:** Sets `reconciliation_status = 'deferred'`. Entry stays in the queue and can be confirmed later.

---

## Frontend (public/app.js)

Vanilla JS, no frameworks. The whole UI renders into `<div id="app">` in index.html.

I chose this approach because adding React or Vue for a single-user prototype would introduce a build step and a lot of overhead without much benefit. Template strings and direct DOM updates are straightforward and easy to follow.

### How it works

Every "page" is a function that returns an HTML string. `render()` checks `AppState.page`, calls the right function, and sets `app.innerHTML`. There's no URL routing — the back button doesn't work. That's fine for a prototype demo.

### AppState

Plain object holding all current UI state:

```js
const AppState = {
  page: 'login',
  token: null,
  user: null,
  status: null,
  patients: [],
  currentPatient: null,
  currentTab: 'medications',
  ...
};
```

When something changes, update the object and call `render()`.

### The API object

A wrapper around `fetch()` that adds the auth header and parses JSON in one place. If the server returns an error status, it throws — so calling functions can catch it and show a toast.

### Status polling

After login, `startStatusPolling()` runs `/api/status` every 15 seconds. This keeps the header indicators (EMR online/offline, sync time) current without needing a full page reload.

### Session restore

On page load, `init()` checks localStorage for a saved token. If one exists, it calls `/api/status` to verify it's still valid. If the server restarted (session gone), the request fails and the user lands on the login page instead.

---

## File structure

| File | What it is |
|---|---|
| `server.js` | The whole backend — routes, auth, sync, downtime, reconciliation |
| `public/index.html` | One HTML file — just a shell with `<div id="app">` |
| `public/app.js` | All frontend JS — state, API calls, page rendering |
| `public/styles.css` | All CSS |
| `db/init.js` | Creates the database schema and seeds 8 fake patients into DB1 |
| `db/schema.sql` | SQL reference — not used at runtime |
| `db/primary_emr.db` | DB1 — not committed to git |
| `db/hcps_backup.db` | DB2 — not committed to git |

---

## Known simplifications

These are intentional trade-offs for a prototype, not oversights:

- Single hardcoded user — no user management or roles
- `systemState` is in-memory, so restarting the server resets downtime state to "online"
- No encryption at rest or in transit
- No session timeout or expiry
- Conflict detection is advisory — no automated resolution logic
- Patient IDs are shared between DB1 and DB2 to simplify sync logic (wouldn't work in production)
- SQLite is fine here; a real system would need PostgreSQL or similar
- No FHIR, HL7, or interoperability standards
