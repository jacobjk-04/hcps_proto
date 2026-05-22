# HCPS Architecture

## Hybrid Continuity Planning System — Honours Thesis Prototype

---

## Overview

HCPS is a full-stack web prototype demonstrating the key concepts of clinical
continuity planning during Electronic Medical Record (EMR) downtime. It
simulates a dual-database architecture where a primary EMR database (DB1) and
an HCPS backup database (DB2) coexist, with selective synchronisation, downtime
failover, downtime documentation, and post-downtime reconciliation.

---

## System Components

```
┌─────────────────────────────────────────────────────────────┐
│                     Browser (Frontend SPA)                  │
│  HTML / CSS / Vanilla JavaScript                            │
│  ─ Login  ─ Dashboard  ─ Patients  ─ Sync  ─ Downtime       │
│  ─ Reconciliation Queue  ─ Audit Log  ─ Prototype Scope     │
└──────────────────────────┬──────────────────────────────────┘
                           │  HTTP/JSON REST API
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                  Express.js Backend (server.js)              │
│                                                             │
│  ┌────────────────┐   ┌───────────────────────────────────┐ │
│  │  System State  │   │           REST Endpoints          │ │
│  │  primaryEMR    │   │  POST /api/login                  │ │
│  │  Online: true  │   │  GET  /api/status                 │ │
│  │  downtime      │   │  POST /api/sync                   │ │
│  │  StartTime     │   │  POST /api/downtime/start         │ │
│  └────────────────┘   │  POST /api/downtime/end           │ │
│                       │  GET  /api/patients               │ │
│  ┌────────────────┐   │  GET  /api/patients/:id           │ │
│  │    Sessions    │   │  POST /api/hcps/notes             │ │
│  │  Token-based   │   │  POST /api/hcps/medication-entry  │ │
│  │  In-memory     │   │  GET  /api/reconciliation         │ │
│  └────────────────┘   │  POST /api/reconciliation/:id/... │ │
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

## Data Flow

### Normal Operation (primaryEMROnline = true)

```
Clinician → Browser → GET /api/patients → DB1 → Response
```

### Synchronisation (DB1 → DB2)

```
Admin clicks Sync → POST /api/sync →
  1. Read admitted patients from DB1
  2. Read allergies, active meds, recent notes, recent labs
  3. Delete old EMR-sourced records from DB2
     (preserves HCPS downtime entries)
  4. Insert fresh copies into DB2 with source='EMR'
  5. Record sync_metadata in DB2
  6. Log SYNC_COMPLETED in audit_log (both DBs)
```

### Downtime Activation (primaryEMROnline = false)

```
Admin → POST /api/downtime/start →
  systemState.primaryEMROnline = false
  All subsequent GET /api/patients reads DB2 instead of DB1
  Log DOWNTIME_ACTIVATED in audit_log
```

### Downtime Documentation

```
Clinician adds note/medication during downtime →
  POST /api/hcps/notes or /api/hcps/medication-entry →
    INSERT into DB2 with:
      source = 'HCPS'
      reconciliation_status = 'pending'
      created_during_downtime = 1
    Log DOWNTIME_NOTE_ADDED in audit_log (DB2)
```

### EMR Restoration

```
Admin → POST /api/downtime/end →
  systemState.primaryEMROnline = true
  Log EMR_RESTORED in audit_log
  Reconciliation queue becomes available
```

### Reconciliation

```
Admin reviews GET /api/reconciliation →
  Queries DB2 for entries where:
    created_during_downtime = 1
    AND reconciliation_status IN ('pending', 'deferred')
  Conflict detection:
    Checks if patient in DB1 was updated after last sync_time

Confirm → POST /api/reconciliation/:id/confirm →
  INSERT entry into DB1 (copy from DB2)
  UPDATE DB2 entry: reconciliation_status = 'reconciled'
  Log RECONCILIATION_CONFIRMED in audit_log (both DBs)

Defer → POST /api/reconciliation/:id/defer →
  UPDATE DB2 entry: reconciliation_status = 'deferred'
  Log RECONCILIATION_DEFERRED in audit_log (both DBs)
```

---

## Selective Synchronisation — Minimum Continuity Dataset

| Data Category | Window | Rationale |
|---|---|---|
| Admitted patients | All active | Required for patient identification |
| Allergies | Complete record | Critical safety data — no window |
| Active medications | Current orders | Required for safe medication administration |
| Clinical notes | Last 7 days | Relevant clinical history window |
| Lab results | Last 3 days | Recent pathology for clinical decisions |
| Discharged patients | Not synced | Not required for downtime operations |
| Historical notes >7d | Not synced | Reduces sync volume; within downtime window |
| Administrative/billing | Not synced | Not required for clinical continuity |

---

## Technology Stack

| Layer | Technology | Notes |
|---|---|---|
| Frontend | HTML5, CSS3, Vanilla JS | Single-page app, no framework |
| Backend | Node.js 18+, Express 4 | REST API |
| Database | SQLite (better-sqlite3) | Two separate .db files |
| Auth | Token-based (in-memory) | Prototype only |
| Styling | Custom CSS with variables | Healthcare-themed |

---

## Prototype Scope Boundary

This prototype demonstrates:
- Dual-database architecture (DB1 + DB2)
- Selective synchronisation
- Downtime failover and documentation
- Reconciliation with conflict detection
- Audit logging

This prototype does NOT implement:
- Real EMR integration (no FHIR/HL7)
- Encryption at rest or in transit
- Role-based access control
- Patient privacy controls
- Clinical validation
- Production-grade error handling
- Automated synchronisation scheduling
