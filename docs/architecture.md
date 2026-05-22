# HCPS Architecture

---

## System overview

Two SQLite databases, one Express backend, one vanilla JS frontend. The backend keeps an in-memory flag (`systemState.primaryEMROnline`) that determines whether patient reads go to DB1 or DB2.

```
┌─────────────────────────────────────────────────────────────┐
│                     Browser (Frontend SPA)                  │
│  HTML / CSS / Vanilla JavaScript                            │
│  ─ Login  ─ Dashboard  ─ Patients  ─ Sync  ─ Downtime       │
│  ─ Reconciliation Queue  ─ Audit Log  ─ Prototype Scope     │
└──────────────────────────┬──────────────────────────────────┘
                           │  HTTP/JSON
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                  Express.js Backend (server.js)              │
│                                                             │
│  ┌────────────────┐   ┌───────────────────────────────────┐ │
│  │  systemState   │   │           REST Endpoints          │ │
│  │  primaryEMR    │   │  POST /api/login                  │ │
│  │  Online: true  │   │  GET  /api/status                 │ │
│  │  downtime      │   │  POST /api/sync                   │ │
│  │  StartTime     │   │  POST /api/downtime/start         │ │
│  └────────────────┘   │  POST /api/downtime/end           │ │
│                       │  GET  /api/patients               │ │
│  ┌────────────────┐   │  GET  /api/patients/:id           │ │
│  │    sessions    │   │  POST /api/hcps/notes             │ │
│  │  in-memory     │   │  POST /api/hcps/medication-entry  │ │
│  └────────────────┘   │  GET  /api/reconciliation         │ │
│                       │  POST /api/reconciliation/:id/... │ │
│                       │  GET  /api/audit-log              │ │
│                       └───────────────────────────────────┘ │
└──────────────┬────────────────────────────┬─────────────────┘
               │                            │
               ▼                            ▼
┌──────────────────────┐     ┌──────────────────────────────┐
│   primary_emr.db     │     │      hcps_backup.db          │
│   (DB1 — SQLite)     │     │      (DB2 — SQLite)          │
│                      │     │                              │
│  patients            │────▶│  patients                    │
│  medications         │────▶│  medications (+source,       │
│  allergies           │────▶│               +recon_status) │
│  clinical_notes      │────▶│  clinical_notes (+source,    │
│  lab_results         │────▶│                 +recon_status)│
│  audit_log           │     │  lab_results                 │
│                      │     │  sync_metadata               │
│                      │     │  audit_log                   │
└──────────────────────┘     └──────────────────────────────┘
```

---

## Data flow

### Normal operation

```
Browser → GET /api/patients → DB1 → response
```

### Sync (DB1 → DB2)

```
Click sync → POST /api/sync →
  1. Read admitted patients from DB1
  2. Read allergies, active meds, notes (7d), labs (3d)
  3. Delete old EMR-sourced rows from DB2 (keeps downtime entries)
  4. Insert fresh copies with source='EMR'
  5. Record sync_metadata in DB2
  6. Log SYNC_COMPLETED in audit_log (both DBs)
```

### Downtime activated

```
Click activate → POST /api/downtime/start →
  systemState.primaryEMROnline = false
  All subsequent patient reads go to DB2
```

### Downtime documentation

```
Add note or medication during downtime →
  POST /api/hcps/notes or /medication-entry →
    INSERT into DB2:
      source = 'HCPS'
      reconciliation_status = 'pending'
      created_during_downtime = 1
```

### EMR restored

```
Click restore → POST /api/downtime/end →
  systemState.primaryEMROnline = true
  Reconciliation queue becomes available
```

### Reconciliation

```
Review queue → GET /api/reconciliation →
  Queries DB2 where created_during_downtime=1
    AND reconciliation_status IN ('pending','deferred')
  Conflict check: was the patient's DB1 record updated after last sync?

Confirm → POST /api/reconciliation/:id/confirm →
  INSERT entry into DB1
  UPDATE DB2: reconciliation_status = 'reconciled'
  Log in audit_log (both DBs)

Defer → POST /api/reconciliation/:id/defer →
  UPDATE DB2: reconciliation_status = 'deferred'
  Stays in queue
```

---

## What gets synced

| Data | Window | Why |
|---|---|---|
| Admitted patients | All | Need patient list during downtime |
| Allergies | All | Safety-critical — can't miss these |
| Active medications | Current only | What clinicians actually need |
| Clinical notes | Last 7 days | Recent history is enough for a short outage |
| Lab results | Last 3 days | Same reasoning |
| Discharged patients | Not synced | Not needed during an outage |
| Notes older than 7d | Not synced | Reduces DB2 size; acceptable for downtime window |
| Billing / admin records | Not synced | Not clinically relevant |

---

## Stack

| Layer | Tech |
|---|---|
| Frontend | HTML, CSS, Vanilla JS (no framework) |
| Backend | Node.js, Express 4 |
| Database | SQLite via better-sqlite3 |
| Auth | Token-based, in-memory (prototype only) |
