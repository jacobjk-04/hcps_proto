# Development Notes

## How the prototype evolved

Started as a static UI mockup to test whether the workflow made sense. After that I added the Node/Express backend and two SQLite databases to actually implement the DB1/DB2 idea. The frontend is vanilla JS — no framework — because the UI is simple enough that React or Vue would have been overhead for no real benefit.

---

## DB1 and DB2

**DB1** (`primary_emr.db`) is the simulated primary EMR. Under normal conditions all reads come from here.

**DB2** (`hcps_backup.db`) is the HCPS backup. It gets populated by the sync and is the read source during downtime. The medications and clinical_notes tables have three extra columns that DB1 doesn't have:
- `source` — either `'EMR'` (synced from DB1) or `'HCPS'` (added during downtime)
- `reconciliation_status` — `'n/a'`, `'pending'`, `'reconciled'`, or `'deferred'`
- `created_during_downtime` — 1 or 0

These are what make reconciliation possible. Without them you couldn't tell apart an EMR-sourced record from one a clinician typed in during an outage.

---

## Why sync is manual

A scheduled sync would need a background job, some kind of state tracking for what's changed, and more error handling. For the prototype, a manual button was enough to show the concept.

The sync is also intentionally selective — it only copies what a clinician would actually need during a short outage: recent notes (7 days), active meds, allergies, recent labs (3 days). Older records are excluded to keep DB2 lightweight.

---

## What is simplified

- **Auth**: one hardcoded user, token stored in a plain object in memory. Cleared on server restart. Fine for a demo, obviously not for anything real.
- **Conflict detection**: checks whether the patient's DB1 record was modified after the last sync and shows a warning. That's it — there's no automated resolution. The clinician decides.
- **IDs**: synced records keep their original DB1 IDs. This simplifies the sync logic (`INSERT OR REPLACE` handles duplicates). In production you'd need UUIDs to avoid collisions across systems.
- **systemState**: just a plain in-memory object. No persistence, no distributed state.

---

## What would change in a real version

- Proper EMR integration (FHIR R4 / HL7 v2)
- Scheduled or event-driven sync, not manual
- Encrypted connections and encrypted databases
- Role-based access control (different permissions for nurses, doctors, admins)
- UUID-based IDs
- Persistent session state
- A proper clinical workflow for conflict resolution, not just a flag
- Audit log that can't be tampered with
