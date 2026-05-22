# HCPS — Hybrid Continuity Planning System

Honours thesis prototype — Bachelor of Software Engineering.

> Not connected to any real hospital system. All patient data is fictional and for demo purposes only.

---

## What it does

This prototype shows a basic backup workflow for EMR downtime. Selected patient data is copied from a main EMR database (DB1) into a local HCPS backup database (DB2). If the main EMR goes offline, clinicians can still view key patient information from DB2, add notes and medications, and then merge those entries back into DB1 once the EMR is restored.

Main features:
- Manual sync from DB1 to DB2 (admitted patients, allergies, active meds, recent notes and labs)
- Downtime mode — switches all reads to DB2 when the primary EMR is marked offline
- Downtime documentation — notes and medications added to DB2 during an outage
- Reconciliation queue — review and copy downtime entries back into DB1
- Audit log of all significant actions

---

## How to run it

Requires Node.js 18+.

```bash
npm install
npm run init-db   # creates and seeds both databases
npm start         # starts at http://localhost:3000
```

Login: **admin** / **hcps2025**

To reset the databases back to the original seed data:
```bash
# Windows
del db\primary_emr.db db\hcps_backup.db
npm run init-db
```

---

## How it works

The backend keeps an in-memory flag (`systemState.primaryEMROnline`). When true, patient reads go to DB1. When false, they go to DB2. Downtime mode is toggled manually via the UI.

Sync copies the following from DB1 to DB2:
- All admitted patients
- All allergies (always included — safety-critical)
- Active medications
- Clinical notes from the last 7 days
- Lab results from the last 3 days

Notes and medications added during downtime are stored in DB2 with `source = 'HCPS'` and `reconciliation_status = 'pending'`. After the EMR is restored, these appear in the reconciliation queue where you can confirm (copy to DB1) or defer each one.

---

## Main files

| File | What it is |
|---|---|
| `server.js` | Express backend — all routes in one file |
| `public/app.js` | Vanilla JS frontend — all UI logic |
| `public/index.html` | Single HTML shell |
| `public/styles.css` | Stylesheet |
| `db/init.js` | Creates the schema and seeds 8 fake patients |
| `db/schema.sql` | Schema reference (not used at runtime) |
| `docs/architecture.md` | Data flow overview |
| `docs/database_schema.md` | Schema reference |
| `DEVELOPMENT_NOTES.md` | Notes on how the prototype was built |

---

## Development notes

Started as a UI mockup to test whether the workflow made sense, then added the Node/Express backend and two SQLite databases to make the DB1/DB2 split actually work.

The sync is manual for now — that was enough to demonstrate the concept. In a real system it would need scheduled syncing, proper EMR integration (FHIR/HL7), encrypted connections, and more reliable conflict handling. The auth is intentionally basic — one hardcoded user, token in memory — it was enough for the prototype.

---

## Limitations

- Single hardcoded user — no roles, no encryption, no session timeout
- No FHIR or HL7 integration — completely standalone
- Sync is manual only
- Conflict detection is advisory — shows a warning, no automated resolution
- SQLite is fine here but wouldn't scale
- In-memory session state — cleared on server restart
- Not suitable for real clinical use
