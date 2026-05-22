const express = require('express');
const Database = require('better-sqlite3');
const crypto = require('crypto');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Open both databases on startup
const DB1 = new Database(path.join(__dirname, 'db', 'primary_emr.db'));
const DB2 = new Database(path.join(__dirname, 'db', 'hcps_backup.db'));

DB1.pragma('journal_mode = WAL');
DB2.pragma('journal_mode = WAL');
DB1.pragma('foreign_keys = ON');
DB2.pragma('foreign_keys = ON');

// In-memory system state. Resets on server restart — that's acceptable for a prototype.
const systemState = {
  primaryEMROnline: true,
  downtimeStartTime: null,
  lastSyncTime: null
};

// Active sessions — maps token → user. Lost on server restart.
const sessions = {};

const DEMO_USER = {
  username: 'admin',
  password: 'hcps2025',
  displayName: 'Dr. Admin User',
  role: 'System Administrator'
};

function makeToken() {
  return crypto.randomBytes(32).toString('hex');
}

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Auth middleware — all protected routes use this. Reads the Bearer token from the header.
function requireAuth(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  const session = sessions[auth.slice(7)];
  if (!session) {
    return res.status(401).json({ error: 'Invalid or expired session' });
  }
  req.user = session.user;
  next();
}

// Write to audit_log. Wrapped in try/catch so a logging failure never breaks a request.
function auditLog(db, user, action, patientId, details) {
  try {
    db.prepare(`
      INSERT INTO audit_log (timestamp, user, action, patient_id, details)
      VALUES (datetime('now'), ?, ?, ?, ?)
    `).run(user || 'system', action, patientId || null, details || null);
  } catch (e) {
    console.error('Audit log error:', e.message);
  }
}

// Write to both databases so the audit trail survives even if one DB becomes unavailable.
function auditBoth(user, action, patientId, details) {
  auditLog(DB1, user, action, patientId, details);
  auditLog(DB2, user, action, patientId, details);
}

// Single-user login for the prototype.
app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};

  if (username !== DEMO_USER.username || password !== DEMO_USER.password) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const token = makeToken();
  sessions[token] = {
    user: {
      username: DEMO_USER.username,
      displayName: DEMO_USER.displayName,
      role: DEMO_USER.role
    },
    loginTime: new Date().toISOString()
  };

  auditBoth(DEMO_USER.displayName, 'USER_LOGIN', null, `User '${DEMO_USER.username}' logged in`);
  res.json({ success: true, token, user: sessions[token].user });
});

app.post('/api/logout', requireAuth, (req, res) => {
  const token = req.headers.authorization.slice(7);
  auditBoth(req.user.displayName, 'USER_LOGOUT', null, `User '${req.user.username}' logged out`);
  delete sessions[token];
  res.json({ success: true });
});

// System status — polled every 15s by the frontend to update the header indicators.
app.get('/api/status', requireAuth, (req, res) => {
  let lastSync = null;
  try {
    lastSync = DB2.prepare('SELECT * FROM sync_metadata ORDER BY sync_time DESC LIMIT 1').get();
  } catch (e) {}

  let pendingCount = 0;
  try {
    const r = DB2.prepare(`
      SELECT
        (SELECT COUNT(*) FROM clinical_notes WHERE created_during_downtime=1 AND reconciliation_status='pending')
        + (SELECT COUNT(*) FROM medications WHERE created_during_downtime=1 AND reconciliation_status='pending')
        AS total
    `).get();
    pendingCount = r ? r.total : 0;
  } catch (e) {}

  res.json({
    primaryEMROnline: systemState.primaryEMROnline,
    downtimeStartTime: systemState.downtimeStartTime,
    hcpsDatabaseAvailable: true,
    lastSyncTime: lastSync ? lastSync.sync_time : null,
    lastSyncRecordsCount: lastSync ? lastSync.records_synced : null,
    lastSyncStatus: lastSync ? lastSync.sync_status : null,
    lastSyncType: lastSync ? lastSync.sync_type : null,
    pendingReconciliationCount: pendingCount,
    currentUser: req.user
  });
});

// Copy data from DB1 to DB2: admitted patients, allergies, active meds, notes (7d), labs (3d).
// Runs in a transaction so it either fully succeeds or fully rolls back.
// Only EMR-sourced rows are deleted before re-inserting — downtime entries are left untouched.
app.post('/api/sync', requireAuth, (req, res) => {
  if (!systemState.primaryEMROnline) {
    return res.status(400).json({ error: 'Cannot sync: Primary EMR is currently offline' });
  }

  const syncType = (req.body && req.body.syncType) || 'manual';
  auditBoth(req.user.displayName, 'SYNC_STARTED', null, `${syncType} sync started`);

  let recordsSynced = 0;

  try {
    // Transaction — if any step fails, DB2 is left unchanged.
    const doSync = DB2.transaction(() => {
      let count = 0;

      // Step 1: copy admitted patients
      const activePatients = DB1.prepare("SELECT * FROM patients WHERE status = 'admitted'").all();
      const upsertPatient = DB2.prepare(`
        INSERT OR REPLACE INTO patients
          (id, mrn, first_name, last_name, dob, gender, ward, bed,
           admission_date, discharge_date, status, diagnosis, updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
      `);
      for (const p of activePatients) {
        upsertPatient.run(
          p.id, p.mrn, p.first_name, p.last_name, p.dob, p.gender,
          p.ward, p.bed, p.admission_date, p.discharge_date,
          p.status, p.diagnosis, p.updated_at
        );
        count++;
      }

      if (activePatients.length === 0) return count;

      const ids = activePatients.map(p => p.id);
      const ph = ids.map(() => '?').join(',');

      // Step 2: copy allergies (delete and re-insert all of them)
      DB2.prepare(`DELETE FROM allergies WHERE patient_id IN (${ph})`).run(...ids);
      const allergies = DB1.prepare(`SELECT * FROM allergies WHERE patient_id IN (${ph})`).all(...ids);
      const insAllergy = DB2.prepare(`
        INSERT OR IGNORE INTO allergies (id, patient_id, allergen, reaction, severity, updated_at)
        VALUES (?,?,?,?,?,?)
      `);
      for (const a of allergies) {
        insAllergy.run(a.id, a.patient_id, a.allergen, a.reaction, a.severity, a.updated_at);
        count++;
      }

      // Step 3: copy active medications (only delete EMR-sourced ones, keep downtime entries)
      DB2.prepare(`DELETE FROM medications WHERE patient_id IN (${ph}) AND source = 'EMR'`).run(...ids);
      const meds = DB1.prepare(`SELECT * FROM medications WHERE patient_id IN (${ph}) AND status = 'active'`).all(...ids);
      const insMed = DB2.prepare(`
        INSERT INTO medications
          (id, patient_id, name, dosage, frequency, route, prescriber,
           start_date, end_date, status, source,
           reconciliation_status, created_during_downtime, updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,'active','EMR','n/a',0,?)
      `);
      for (const m of meds) {
        insMed.run(
          m.id, m.patient_id, m.name, m.dosage, m.frequency,
          m.route, m.prescriber, m.start_date, m.end_date, m.updated_at
        );
        count++;
      }

      // Step 4: copy clinical notes from the last 7 days (only delete EMR-sourced ones)
      DB2.prepare(`DELETE FROM clinical_notes WHERE patient_id IN (${ph}) AND source = 'EMR'`).run(...ids);
      const notes = DB1.prepare(`
        SELECT * FROM clinical_notes
        WHERE patient_id IN (${ph}) AND created_at >= datetime('now','-7 days')
      `).all(...ids);
      const insNote = DB2.prepare(`
        INSERT INTO clinical_notes
          (id, patient_id, note_type, note_text, author, created_at, updated_at,
           source, reconciliation_status, created_during_downtime)
        VALUES (?,?,?,?,?,?,?,'EMR','n/a',0)
      `);
      for (const n of notes) {
        insNote.run(n.id, n.patient_id, n.note_type, n.note_text, n.author, n.created_at, n.updated_at);
        count++;
      }

      // Step 5: copy lab results from the last 3 days
      DB2.prepare(`DELETE FROM lab_results WHERE patient_id IN (${ph}) AND source = 'EMR'`).run(...ids);
      const labs = DB1.prepare(`
        SELECT * FROM lab_results
        WHERE patient_id IN (${ph}) AND collected_at >= datetime('now','-3 days')
      `).all(...ids);
      const insLab = DB2.prepare(`
        INSERT OR IGNORE INTO lab_results
          (id, patient_id, test_name, value, unit, reference_range,
           status, collected_at, updated_at, source)
        VALUES (?,?,?,?,?,?,?,?,?,'EMR')
      `);
      for (const l of labs) {
        insLab.run(
          l.id, l.patient_id, l.test_name, l.value, l.unit,
          l.reference_range, l.status, l.collected_at, l.updated_at
        );
        count++;
      }

      return count;
    });

    recordsSynced = doSync();

    DB2.prepare(`
      INSERT INTO sync_metadata (sync_time, records_synced, sync_status, sync_type, details)
      VALUES (datetime('now'),?,?,?,?)
    `).run(recordsSynced, 'success', syncType, `Sync complete: ${recordsSynced} records copied to DB2.`);

    systemState.lastSyncTime = new Date().toISOString();
    auditBoth(req.user.displayName, 'SYNC_COMPLETED', null, `${syncType} sync done. ${recordsSynced} records copied to DB2.`);

    res.json({
      success: true,
      recordsSynced,
      syncTime: systemState.lastSyncTime,
      message: `Sync complete. ${recordsSynced} records copied to HCPS backup database.`
    });

  } catch (err) {
    console.error('Sync error:', err);
    try {
      DB2.prepare(`
        INSERT INTO sync_metadata (sync_time, records_synced, sync_status, sync_type, details)
        VALUES (datetime('now'),0,'failed',?,?)
      `).run(syncType, `Sync failed: ${err.message}`);
    } catch (_) {}
    auditBoth(req.user.displayName, 'SYNC_FAILED', null, `Sync failed: ${err.message}`);
    res.status(500).json({ error: 'Synchronisation failed', details: err.message });
  }
});

// Set primaryEMROnline = false. All patient reads will now come from DB2.
app.post('/api/downtime/start', requireAuth, (req, res) => {
  if (!systemState.primaryEMROnline) {
    return res.status(400).json({ error: 'System is already in downtime mode' });
  }

  systemState.primaryEMROnline = false;
  systemState.downtimeStartTime = new Date().toISOString();

  auditBoth(req.user.displayName, 'DOWNTIME_ACTIVATED', null,
    `Downtime activated by ${req.user.displayName}. System now reading from DB2.`);

  res.json({
    success: true,
    message: 'Downtime mode activated. System is now serving data from the HCPS backup database.',
    downtimeStartTime: systemState.downtimeStartTime
  });
});

// Set primaryEMROnline = true. System returns to reading from DB1.
app.post('/api/downtime/end', requireAuth, (req, res) => {
  if (systemState.primaryEMROnline) {
    return res.status(400).json({ error: 'System is not currently in downtime mode' });
  }

  systemState.primaryEMROnline = true;
  const durationMs = systemState.downtimeStartTime
    ? Date.now() - new Date(systemState.downtimeStartTime).getTime()
    : 0;
  const durationMin = Math.round(durationMs / 60000);
  systemState.downtimeStartTime = null;

  auditBoth(req.user.displayName, 'EMR_RESTORED', null,
    `EMR restored after ${durationMin} minute(s). Reconciliation queue is available.`);

  res.json({
    success: true,
    message: `Primary EMR restored. Downtime lasted ${durationMin} minute(s). Please review the reconciliation queue.`,
    durationMin
  });
});

// Patient list — DB1 when online, DB2 during downtime.
app.get('/api/patients', requireAuth, (req, res) => {
  const db = systemState.primaryEMROnline ? DB1 : DB2;
  const source = systemState.primaryEMROnline ? 'primary_emr' : 'hcps_backup';

  try {
    const patients = db.prepare(
      "SELECT * FROM patients WHERE status='admitted' ORDER BY last_name, first_name"
    ).all();

    if (!systemState.primaryEMROnline) {
      auditLog(DB2, req.user.displayName, 'PATIENT_LIST_VIEWED_DOWNTIME', null,
        'Patient list accessed during downtime from HCPS backup database');
    }

    res.json({ patients, source });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Full patient record: demographics, meds, allergies, notes, labs. Same DB1/DB2 switch as above.
app.get('/api/patients/:id', requireAuth, (req, res) => {
  const db = systemState.primaryEMROnline ? DB1 : DB2;
  const source = systemState.primaryEMROnline ? 'primary_emr' : 'hcps_backup';
  const id = parseInt(req.params.id, 10);

  try {
    const patient = db.prepare('SELECT * FROM patients WHERE id=?').get(id);
    if (!patient) return res.status(404).json({ error: 'Patient not found' });

    const medications = db.prepare(
      "SELECT * FROM medications WHERE patient_id=? AND status='active' ORDER BY name"
    ).all(id);

    const allergies = db.prepare(
      'SELECT * FROM allergies WHERE patient_id=? ORDER BY severity DESC'
    ).all(id);

    const notes = db.prepare(
      'SELECT * FROM clinical_notes WHERE patient_id=? ORDER BY created_at DESC'
    ).all(id);

    const labs = db.prepare(
      'SELECT * FROM lab_results WHERE patient_id=? ORDER BY collected_at DESC'
    ).all(id);

    if (!systemState.primaryEMROnline) {
      auditLog(DB2, req.user.displayName, 'PATIENT_RECORD_VIEWED_DOWNTIME', id,
        `Patient ${patient.first_name} ${patient.last_name} (${patient.mrn}) viewed during downtime`);
    }

    res.json({ patient, medications, allergies, notes, labs, source });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Save a downtime note to DB2. Blocked if the EMR is online — downtime-only feature.
app.post('/api/hcps/notes', requireAuth, (req, res) => {
  if (systemState.primaryEMROnline) {
    return res.status(400).json({
      error: 'Downtime documentation is only available when the primary EMR is offline'
    });
  }

  const { patient_id, note_type, note_text } = req.body || {};
  if (!patient_id || !note_text || note_text.trim() === '') {
    return res.status(400).json({ error: 'patient_id and note_text are required' });
  }

  try {
    const patient = DB2.prepare('SELECT * FROM patients WHERE id=?').get(patient_id);
    if (!patient) {
      return res.status(404).json({ error: 'Patient not found in HCPS backup database' });
    }

    const result = DB2.prepare(`
      INSERT INTO clinical_notes
        (patient_id, note_type, note_text, author, created_at, updated_at,
         source, reconciliation_status, created_during_downtime)
      VALUES (?, ?, ?, ?, datetime('now'), datetime('now'), 'HCPS', 'pending', 1)
    `).run(patient_id, note_type || 'Downtime Note', note_text.trim(), req.user.displayName);

    auditLog(DB2, req.user.displayName, 'DOWNTIME_NOTE_ADDED', patient_id,
      `Downtime note added for ${patient.first_name} ${patient.last_name} (${patient.mrn}). Type: ${note_type || 'Downtime Note'}.`);

    res.json({
      success: true,
      noteId: result.lastInsertRowid,
      reconciliationStatus: 'pending',
      message: 'Downtime note saved. Awaiting reconciliation.'
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Save a downtime medication to DB2. Same pattern as the notes endpoint above.
app.post('/api/hcps/medication-entry', requireAuth, (req, res) => {
  if (systemState.primaryEMROnline) {
    return res.status(400).json({
      error: 'Downtime documentation is only available when the primary EMR is offline'
    });
  }

  const { patient_id, name, dosage, frequency, route, prescriber } = req.body || {};
  if (!patient_id || !name || name.trim() === '') {
    return res.status(400).json({ error: 'patient_id and medication name are required' });
  }

  try {
    const patient = DB2.prepare('SELECT * FROM patients WHERE id=?').get(patient_id);
    if (!patient) {
      return res.status(404).json({ error: 'Patient not found in HCPS backup database' });
    }

    const result = DB2.prepare(`
      INSERT INTO medications
        (patient_id, name, dosage, frequency, route, prescriber,
         start_date, status, source,
         reconciliation_status, created_during_downtime, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, datetime('now'), 'active', 'HCPS', 'pending', 1, datetime('now'))
    `).run(
      patient_id, name.trim(), dosage || null,
      frequency || null, route || null,
      prescriber || req.user.displayName
    );

    auditLog(DB2, req.user.displayName, 'DOWNTIME_MEDICATION_ADDED', patient_id,
      `Downtime medication added for ${patient.first_name} ${patient.last_name} (${patient.mrn}). Medication: ${name} ${dosage || ''}.`);

    res.json({
      success: true,
      medicationId: result.lastInsertRowid,
      reconciliationStatus: 'pending',
      message: 'Downtime medication saved. Awaiting reconciliation.'
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Reconciliation queue — pending/deferred downtime entries from DB2.
// Includes a basic conflict check: was the patient's DB1 record updated after the last sync?
app.get('/api/reconciliation', requireAuth, (req, res) => {
  try {
    const lastSync = DB2.prepare(
      "SELECT sync_time FROM sync_metadata WHERE sync_status='success' ORDER BY sync_time DESC LIMIT 1"
    ).get();
    const lastSyncTime = lastSync ? lastSync.sync_time : null;

    const pendingNotes = DB2.prepare(`
      SELECT
        cn.id, cn.patient_id,
        p.first_name || ' ' || p.last_name AS patient_name,
        p.mrn,
        'clinical_note'      AS entry_type,
        cn.note_type         AS entry_subtype,
        cn.note_text         AS entry_text,
        cn.author, cn.created_at, cn.source, cn.reconciliation_status
      FROM clinical_notes cn
      JOIN patients p ON cn.patient_id = p.id
      WHERE cn.created_during_downtime = 1
        AND cn.reconciliation_status IN ('pending','deferred')
      ORDER BY cn.created_at DESC
    `).all();

    const pendingMeds = DB2.prepare(`
      SELECT
        m.id, m.patient_id,
        p.first_name || ' ' || p.last_name AS patient_name,
        p.mrn,
        'medication_entry'   AS entry_type,
        m.route              AS entry_subtype,
        m.name || COALESCE(' ' || m.dosage,'') || COALESCE(' ' || m.frequency,'') AS entry_text,
        m.prescriber         AS author,
        m.start_date         AS created_at,
        m.source, m.reconciliation_status
      FROM medications m
      JOIN patients p ON m.patient_id = p.id
      WHERE m.created_during_downtime = 1
        AND m.reconciliation_status IN ('pending','deferred')
      ORDER BY m.start_date DESC
    `).all();

    const allItems = [...pendingNotes, ...pendingMeds]
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    // Flag any items where the patient's DB1 record changed after the last sync.
    const itemsWithFlags = allItems.map(item => {
      let hasConflict = false;
      let conflictDetail = null;

      if (lastSyncTime) {
        try {
          const p = DB1.prepare(
            "SELECT updated_at FROM patients WHERE id=? AND updated_at > ?"
          ).get(item.patient_id, lastSyncTime);

          if (p) {
            hasConflict = true;
            conflictDetail = `Patient record updated in DB1 after last sync (${lastSyncTime}).`;
          }

          const mUpdate = DB1.prepare(
            "SELECT COUNT(*) AS cnt FROM medications WHERE patient_id=? AND updated_at > ?"
          ).get(item.patient_id, lastSyncTime);

          if (mUpdate && mUpdate.cnt > 0) {
            hasConflict = true;
            conflictDetail = (conflictDetail || '') +
              (conflictDetail ? ' ' : '') +
              `${mUpdate.cnt} medication(s) updated in DB1 after last sync.`;
          }
        } catch (_) {}
      }

      return { ...item, hasConflict, conflictDetail };
    });

    res.json({
      items: itemsWithFlags,
      lastSyncTime,
      totalPending: itemsWithFlags.filter(i => i.reconciliation_status === 'pending').length,
      totalDeferred: itemsWithFlags.filter(i => i.reconciliation_status === 'deferred').length
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Confirm reconciliation — insert the downtime entry into DB1, mark it reconciled in DB2.
app.post('/api/reconciliation/:id/confirm', requireAuth, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const type = (req.body && req.body.type) || '';

  try {
    if (type === 'clinical_note') {
      const note = DB2.prepare(
        'SELECT cn.*, p.first_name, p.last_name, p.mrn FROM clinical_notes cn JOIN patients p ON cn.patient_id=p.id WHERE cn.id=? AND cn.created_during_downtime=1'
      ).get(id);
      if (!note) return res.status(404).json({ error: 'Downtime note not found' });

      DB1.prepare(`
        INSERT INTO clinical_notes
          (patient_id, note_type, note_text, author, created_at, updated_at, source)
        VALUES (?, ?, ?, ?, ?, datetime('now'), 'HCPS')
      `).run(
        note.patient_id, note.note_type,
        note.note_text + '\n[Reconciled from HCPS downtime entry by ' + req.user.displayName + ']',
        note.author, note.created_at
      );

      DB2.prepare(
        "UPDATE clinical_notes SET reconciliation_status='reconciled', updated_at=datetime('now') WHERE id=?"
      ).run(id);

      auditBoth(req.user.displayName, 'RECONCILIATION_CONFIRMED', note.patient_id,
        `Downtime note reconciled for ${note.first_name} ${note.last_name} (${note.mrn}). ID ${id} copied to DB1.`);

      res.json({ success: true, message: 'Clinical note reconciled and copied to primary EMR.' });

    } else if (type === 'medication_entry') {
      const med = DB2.prepare(
        'SELECT m.*, p.first_name, p.last_name, p.mrn FROM medications m JOIN patients p ON m.patient_id=p.id WHERE m.id=? AND m.created_during_downtime=1'
      ).get(id);
      if (!med) return res.status(404).json({ error: 'Downtime medication entry not found' });

      DB1.prepare(`
        INSERT INTO medications
          (patient_id, name, dosage, frequency, route, prescriber, start_date, status, source, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'active', 'HCPS', datetime('now'))
      `).run(
        med.patient_id, med.name + ' [Reconciled from HCPS]',
        med.dosage, med.frequency, med.route, med.prescriber, med.start_date
      );

      DB2.prepare(
        "UPDATE medications SET reconciliation_status='reconciled', updated_at=datetime('now') WHERE id=?"
      ).run(id);

      auditBoth(req.user.displayName, 'RECONCILIATION_CONFIRMED', med.patient_id,
        `Downtime medication reconciled for ${med.first_name} ${med.last_name} (${med.mrn}). ${med.name}. ID ${id} copied to DB1.`);

      res.json({ success: true, message: 'Medication entry reconciled and copied to primary EMR.' });

    } else {
      res.status(400).json({ error: 'type must be clinical_note or medication_entry' });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Defer — update reconciliation_status to 'deferred'. Entry stays in DB2 for later review.
app.post('/api/reconciliation/:id/defer', requireAuth, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const type = (req.body && req.body.type) || '';

  try {
    if (type === 'clinical_note') {
      const note = DB2.prepare(
        'SELECT cn.*, p.first_name, p.last_name, p.mrn FROM clinical_notes cn JOIN patients p ON cn.patient_id=p.id WHERE cn.id=?'
      ).get(id);
      if (!note) return res.status(404).json({ error: 'Note not found' });

      DB2.prepare(
        "UPDATE clinical_notes SET reconciliation_status='deferred', updated_at=datetime('now') WHERE id=?"
      ).run(id);

      auditBoth(req.user.displayName, 'RECONCILIATION_DEFERRED', note.patient_id,
        `Note deferred for ${note.first_name} ${note.last_name} (${note.mrn}). Note ID: ${id}`);

    } else if (type === 'medication_entry') {
      const med = DB2.prepare(
        'SELECT m.*, p.first_name, p.last_name, p.mrn FROM medications m JOIN patients p ON m.patient_id=p.id WHERE m.id=?'
      ).get(id);
      if (!med) return res.status(404).json({ error: 'Medication entry not found' });

      DB2.prepare(
        "UPDATE medications SET reconciliation_status='deferred', updated_at=datetime('now') WHERE id=?"
      ).run(id);

      auditBoth(req.user.displayName, 'RECONCILIATION_DEFERRED', med.patient_id,
        `Medication deferred for ${med.first_name} ${med.last_name} (${med.mrn}). ${med.name}`);

    } else {
      return res.status(400).json({ error: 'type must be clinical_note or medication_entry' });
    }

    res.json({ success: true, message: 'Entry deferred. It will remain in the reconciliation queue.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Audit log — returns recent entries from DB2, newest first.
app.get('/api/audit-log', requireAuth, (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit || '150', 10), 500);
    const offset = parseInt(req.query.offset || '0', 10);

    const logs = DB2.prepare(
      'SELECT * FROM audit_log ORDER BY timestamp DESC LIMIT ? OFFSET ?'
    ).all(limit, offset);

    const total = DB2.prepare('SELECT COUNT(*) AS cnt FROM audit_log').get();
    res.json({ logs, total: total.cnt, limit, offset });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`\nHCPS running at http://localhost:${PORT}`);
  console.log(`Login: admin / hcps2025`);
  console.log(`DB1: db/primary_emr.db  |  DB2: db/hcps_backup.db\n`);
});
