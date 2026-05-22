const Database = require('better-sqlite3');
const path = require('path');

const PRIMARY_DB_PATH = path.join(__dirname, 'primary_emr.db');
const HCPS_DB_PATH = path.join(__dirname, 'hcps_backup.db');

const primaryDb = new Database(PRIMARY_DB_PATH);
const hcpsDb = new Database(HCPS_DB_PATH);

primaryDb.pragma('journal_mode = WAL');
hcpsDb.pragma('journal_mode = WAL');
primaryDb.pragma('foreign_keys = ON');
hcpsDb.pragma('foreign_keys = ON');

primaryDb.exec(`
  CREATE TABLE IF NOT EXISTS patients (
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

  CREATE TABLE IF NOT EXISTS medications (
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

  CREATE TABLE IF NOT EXISTS allergies (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    patient_id INTEGER NOT NULL,
    allergen   TEXT    NOT NULL,
    reaction   TEXT,
    severity   TEXT,
    updated_at TEXT    DEFAULT (datetime('now')),
    FOREIGN KEY (patient_id) REFERENCES patients(id)
  );

  CREATE TABLE IF NOT EXISTS clinical_notes (
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

  CREATE TABLE IF NOT EXISTS lab_results (
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

  CREATE TABLE IF NOT EXISTS audit_log (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp  TEXT    DEFAULT (datetime('now')),
    user       TEXT,
    action     TEXT,
    patient_id INTEGER,
    details    TEXT
  );
`);

hcpsDb.exec(`
  CREATE TABLE IF NOT EXISTS patients (
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

  CREATE TABLE IF NOT EXISTS medications (
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

  CREATE TABLE IF NOT EXISTS allergies (
    id         INTEGER PRIMARY KEY,
    patient_id INTEGER NOT NULL,
    allergen   TEXT    NOT NULL,
    reaction   TEXT,
    severity   TEXT,
    updated_at TEXT    DEFAULT (datetime('now')),
    FOREIGN KEY (patient_id) REFERENCES patients(id)
  );

  CREATE TABLE IF NOT EXISTS clinical_notes (
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

  CREATE TABLE IF NOT EXISTS lab_results (
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

  CREATE TABLE IF NOT EXISTS sync_metadata (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    sync_time      TEXT    DEFAULT (datetime('now')),
    records_synced INTEGER,
    sync_status    TEXT,
    sync_type      TEXT,
    details        TEXT
  );

  CREATE TABLE IF NOT EXISTS audit_log (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp  TEXT    DEFAULT (datetime('now')),
    user       TEXT,
    action     TEXT,
    patient_id INTEGER,
    details    TEXT
  );
`);

const existingPatients = primaryDb.prepare('SELECT COUNT(*) as count FROM patients').get();
if (existingPatients.count > 0) {
  console.log('Primary EMR database already seeded. Skipping seed step.');
  console.log('  → Delete db/primary_emr.db and db/hcps_backup.db to reset.\n');
  process.exit(0);
}

console.log('Seeding primary EMR database with fake patient data...');

const seedData = primaryDb.transaction(() => {

  const insertPatient = primaryDb.prepare(`
    INSERT INTO patients (mrn, first_name, last_name, dob, gender, ward, bed, admission_date, status, diagnosis, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'admitted', ?, datetime('now', ?))
  `);

  insertPatient.run('MRN-001', 'Margaret', 'Thompson', '1959-03-12', 'Female',  '4A',       '12',  '2026-05-15', 'Type 2 Diabetes Mellitus with Diabetic Foot Ulcer (Left)',         '-1 hours');
  insertPatient.run('MRN-002', 'Robert',   'Chen',     '1972-07-24', 'Male',    '2B',       '7',   '2026-05-13', 'Unstable Angina, Hypertension, Hypercholesterolaemia',              '-30 minutes');
  insertPatient.run('MRN-003', 'Sarah',    'Williams', '1992-01-18', 'Female',  '3C',       '3',   '2026-05-18', 'Perforated Appendicitis — Post-operative Day 2',                   '-2 hours');
  insertPatient.run('MRN-004', 'James',    'Patterson','1955-11-05', 'Male',    'ICU',      '2',   '2026-05-13', 'Community Acquired Pneumonia with Type 2 Respiratory Failure',     '-45 minutes');
  insertPatient.run('MRN-005', 'Lisa',     'Martinez', '1981-04-30', 'Female',  '2A',       '9',   '2026-05-16', 'Bilateral Pulmonary Embolism',                                     '-3 hours');
  insertPatient.run('MRN-006', 'David',    'Kim',      '1963-09-17', 'Male',    '4B',       '5',   '2026-05-14', 'Acute on Chronic Kidney Disease (CKD Stage 3b)',                   '-20 minutes');
  insertPatient.run('MRN-007', 'Emma',     'Johnson',  '1998-02-14', 'Female',  '1A (Mat)', '1',   '2026-05-19', 'Severe Preeclampsia at 34 weeks gestation',                        '-10 minutes');
  insertPatient.run('MRN-008', 'George',   'Wilson',   '1947-06-22', 'Male',    '5A',       '8',   '2026-05-16', 'Right Neck of Femur Fracture — Post Total Hip Replacement, Day 2', '-90 minutes');

  const insertMed = primaryDb.prepare(`
    INSERT INTO medications (patient_id, name, dosage, frequency, route, prescriber, start_date, status, source, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, '2026-05-15', 'active', 'EMR', datetime('now'))
  `);

  insertMed.run(1, 'Metformin',        '500mg',     'Twice daily',              'Oral',         'Dr. A. Smith');
  insertMed.run(1, 'Insulin Glargine', '20 units',  'Nightly',                  'Subcutaneous', 'Dr. A. Smith');
  insertMed.run(1, 'Metronidazole',    '400mg',     'Three times daily',         'Oral',         'Dr. A. Smith');
  insertMed.run(1, 'Aspirin',          '100mg',     'Daily',                    'Oral',         'Dr. A. Smith');

  insertMed.run(2, 'Atorvastatin',     '80mg',      'Nightly',                  'Oral',         'Dr. B. Patel');
  insertMed.run(2, 'Aspirin',          '100mg',     'Daily',                    'Oral',         'Dr. B. Patel');
  insertMed.run(2, 'Clopidogrel',      '75mg',      'Daily',                    'Oral',         'Dr. B. Patel');
  insertMed.run(2, 'Metoprolol',       '50mg',      'Twice daily',              'Oral',         'Dr. B. Patel');
  insertMed.run(2, 'Ramipril',         '5mg',       'Daily',                    'Oral',         'Dr. B. Patel');

  insertMed.run(3, 'Cefazolin',        '1g',        'Every 8 hours',            'IV',           'Dr. C. Nguyen');
  insertMed.run(3, 'Metronidazole',    '500mg',     'Every 8 hours',            'IV',           'Dr. C. Nguyen');
  insertMed.run(3, 'Paracetamol',      '1g',        'Four times daily',         'Oral',         'Dr. C. Nguyen');
  insertMed.run(3, 'Oxycodone',        '5mg',       'As required (max 6-hrly)', 'Oral',         'Dr. C. Nguyen');

  insertMed.run(4, 'Piperacillin/Tazobactam', '4.5g', 'Every 6 hours',         'IV',           'Dr. D. Okafor');
  insertMed.run(4, 'Azithromycin',     '500mg',     'Daily',                    'IV',           'Dr. D. Okafor');
  insertMed.run(4, 'Heparin',          '5000 units','Twice daily',              'Subcutaneous', 'Dr. D. Okafor');
  insertMed.run(4, 'Salbutamol',       '2.5mg',     'As required',              'Nebulised',    'Dr. D. Okafor');

  insertMed.run(5, 'Rivaroxaban',      '15mg',      'Twice daily (with food)',  'Oral',         'Dr. E. Walsh');
  insertMed.run(5, 'Paracetamol',      '1g',        'Four times daily',         'Oral',         'Dr. E. Walsh');
  insertMed.run(5, 'Oxygen',           '2 L/min',   'Continuous',               'Nasal prongs', 'Dr. E. Walsh');

  insertMed.run(6, 'Amlodipine',       '10mg',      'Daily',                    'Oral',         'Dr. F. Lee');
  insertMed.run(6, 'Furosemide',       '40mg',      'Twice daily',              'Oral',         'Dr. F. Lee');
  insertMed.run(6, 'Sodium Bicarbonate','500mg',    'Three times daily',         'Oral',         'Dr. F. Lee');
  insertMed.run(6, 'Calcitriol',       '0.25 mcg',  'Daily',                    'Oral',         'Dr. F. Lee');

  insertMed.run(7, 'Labetalol',        '200mg',     'Twice daily',              'Oral',         'Dr. G. Pham');
  insertMed.run(7, 'Magnesium Sulphate','1g/hr',    'Continuous infusion',       'IV',           'Dr. G. Pham');
  insertMed.run(7, 'Hydralazine',      '5mg',       'As required (BP>160/110)', 'IV',           'Dr. G. Pham');
  insertMed.run(7, 'Betamethasone',    '12mg',      'Two doses 24hrs apart',    'IM',           'Dr. G. Pham');

  insertMed.run(8, 'Enoxaparin',       '40mg',      'Daily',                    'Subcutaneous', 'Dr. H. Russo');
  insertMed.run(8, 'Paracetamol',      '1g',        'Four times daily',         'Oral',         'Dr. H. Russo');
  insertMed.run(8, 'Oxycodone SR',     '10mg',      'Twice daily',              'Oral',         'Dr. H. Russo');
  insertMed.run(8, 'Atorvastatin',     '40mg',      'Nightly',                  'Oral',         'Dr. H. Russo');
  insertMed.run(8, 'Ramipril',         '2.5mg',     'Daily',                    'Oral',         'Dr. H. Russo');

  const insertAllergy = primaryDb.prepare(`
    INSERT INTO allergies (patient_id, allergen, reaction, severity, updated_at)
    VALUES (?, ?, ?, ?, datetime('now'))
  `);

  insertAllergy.run(1, 'Penicillin',   'Rash',              'Moderate');
  insertAllergy.run(1, 'Sulfonamides', 'Anaphylaxis',       'Severe');
  insertAllergy.run(2, 'Codeine',      'Nausea/Vomiting',   'Mild');
  insertAllergy.run(4, 'Amoxicillin',  'Rash',              'Moderate');
  insertAllergy.run(4, 'NSAIDs',       'GI Upset',          'Mild');
  insertAllergy.run(5, 'Latex',        'Urticaria (hives)', 'Moderate');
  insertAllergy.run(6, 'Contrast Dye', 'Anaphylaxis',       'Severe');
  insertAllergy.run(8, 'Penicillin',   'Rash',              'Mild');

  const insertNote = primaryDb.prepare(`
    INSERT INTO clinical_notes (patient_id, note_type, note_text, author, created_at, updated_at, source)
    VALUES (?, ?, ?, ?, datetime('now', ?), datetime('now', ?), 'EMR')
  `);

  insertNote.run(1, 'Admission Note',
    'Pt Margaret Thompson, 67F, admitted via ED with worsening diabetic foot ulcer left foot x 1 week. ' +
    'PMHx: T2DM, HTN, hypothyroidism. BSL on admission 18.2 mmol/L. Wound: 3x2cm ulcer base of 2nd toe, ' +
    'moderate exudate, no crepitus, no systemic sepsis. Admitted for IV antibiotics, wound care, and BSL optimisation. ' +
    'HbA1c 9.2% — suboptimal control. Insulin commenced. Surgical and Endocrine reviews requested.',
    'Dr. A. Smith', '-5 hours', '-5 hours');
  insertNote.run(1, 'Wound Care Note',
    'Wound dressing reviewed — 3x2cm diabetic foot ulcer L 2nd toe. Moderate serous exudate. No signs of ' +
    'spreading cellulitis. Wound swab sent for MCS. Silver alginate dressing applied. Offloading boot in situ. ' +
    'Patient compliance with non-weight bearing discussed. BSL 14.3 mmol/L this AM — dietitian review arranged.',
    'Wound Care RN T. Brooks', '-2 hours', '-2 hours');

  insertNote.run(2, 'Cardiology Consult',
    'Pt Robert Chen, 54M, referred for cardiology review — unstable angina. Hx of hypertension and ' +
    'hypercholesterolaemia. ECG: ST changes V4-V5. Troponin I trending 0.04 → 0.08 ug/L. ' +
    'Echo scheduled. DAPT commenced (Aspirin + Clopidogrel). Ramipril added for cardiac protection. ' +
    'Lipids: TC 6.8 mmol/L, LDL 4.2 mmol/L — Atorvastatin 80mg initiated. Recommend coronary angiogram.',
    'Dr. B. Patel (Cardiology)', '-6 hours', '-6 hours');
  insertNote.run(2, 'Nursing Assessment',
    'Pt stable overnight. BP 148/92 mmHg. HR 74 bpm. No further chest pain reported. Troponin declining. ' +
    'Patient anxious about procedure — social work referral made. Medications reviewed with patient. ' +
    'Fluid balance maintained. Angiogram consent obtained.',
    'RN J. Morgan', '-1 hour', '-1 hour');

  insertNote.run(3, 'Operative Note',
    'Pt Sarah Williams, 34F. Emergency laparoscopic appendicectomy converted to open due to significant ' +
    'contamination. Perforated appendix with localised peritonitis. Peritoneal washout performed. ' +
    'Drain inserted. Wound closed in layers. EBL ~100mL. Procedure tolerated well. Post-op antibiotics ' +
    'commenced: Cefazolin + Metronidazole. Pain management: Paracetamol + Oxycodone PRN.',
    'Dr. C. Nguyen (Surgery)', '-2 days', '-2 days');
  insertNote.run(3, 'Post-operative Review',
    'Post-op Day 2. Pt progressing well. Apyrexial. Drain output minimal (5mL serosanguinous). ' +
    'Tolerating clear fluids. Bowel sounds present. Wound clean, no signs of infection. ' +
    'IV antibiotics to continue x 5 days. Mobilising with physiotherapy. Expected discharge day 5-7.',
    'Dr. C. Nguyen', '-3 hours', '-3 hours');

  insertNote.run(4, 'ICU Admission Note',
    'Pt James Patterson, 71M, transferred from ED to ICU with CAP and T2 respiratory failure. ' +
    'SpO2 84% on 15L O2 via NRM on arrival. CXR: bilateral infiltrates consistent with pneumonia. ' +
    'Blood cultures x2 sent (subsequently grew S. pneumoniae). ' +
    'Commenced on Pip-Tazo + Azithromycin. HFNO commenced — SpO2 improved to 94%. ' +
    'GCS 14 (E4V4M6). ITU score 8. Family notified. Advance care directive discussed.',
    'Dr. D. Okafor (ICU Consultant)', '-7 days', '-7 days');
  insertNote.run(4, 'Respiratory Therapy Note',
    'Day 7 ICU. Patient remains on HFNO 40L/min 50% FiO2. Weaning attempted yesterday — failed. ' +
    'SpO2 92% on current settings. CPAP trial planned for today. ABG pH 7.34, pCO2 48, pO2 72. ' +
    'Repeat CXR shows improving bilateral infiltrates. Antibiotics Day 7 — IV to oral step-down considered.',
    'Dr. D. Okafor', '-4 hours', '-4 hours');

  insertNote.run(5, 'Emergency Admission Note',
    'Pt Lisa Martinez, 45F, presented to ED with acute onset dyspnoea, pleuritic chest pain, tachycardia. ' +
    'HR 118, BP 108/72, SpO2 91% RA. D-Dimer markedly elevated at 4200 ug/L. ' +
    'CTPA confirmed bilateral pulmonary emboli — right > left. No RV strain on echo. ' +
    'Haemodynamically stable. Commenced on Rivaroxaban 15mg BD. ' +
    'Risk factors: OCP use, recent long-haul flight. Haematology review requested. Thrombophilia screen ordered.',
    'Dr. E. Walsh', '-4 days', '-4 days');
  insertNote.run(5, 'Haematology Review',
    'Seen by haematology. Bilateral PE in 45F on OCP — likely provoked. ' +
    'DOAC choice: Rivaroxaban appropriate. Duration 3-6 months if provoked. OCP to be ceased permanently. ' +
    'Thrombophilia screen sent (to be processed 3 months after stopping anticoagulation). ' +
    'Patient counselled re: activity, return precautions. Follow-up outpatient haematology in 6 weeks.',
    'Dr. R. Singh (Haematology)', '-2 days', '-2 days');

  insertNote.run(6, 'Nephrology Consult',
    'Pt David Kim, 62M, admitted with AKI on CKD 3b. Creatinine 285 umol/L (baseline 160). ' +
    'eGFR 22 mL/min. K+ 5.8 mmol/L — hold ACE inhibitor. Metabolic acidosis: HCO3 18. ' +
    'Fluid overloaded — bilateral leg oedema, raised JVP. Commenced Furosemide 40mg BD. ' +
    'Sodium Bicarb supplement commenced. Nephrology to review trigger — likely NSAID use (patient self-medicating). ' +
    'Renal US: bilateral echogenic kidneys consistent with CKD, no obstruction.',
    'Dr. F. Lee (Nephrology)', '-6 days', '-6 days');
  insertNote.run(6, 'Fluid Balance Review',
    'Day 6. Creatinine improving — 210 umol/L. eGFR 31. K+ 5.2 mmol/L. ' +
    'Net fluid balance -1.2L over 24h. Peripheral oedema reducing. ' +
    'Diet: renal diet initiated. Dietitian review completed. ' +
    'Renal function trajectory improving — likely avoidance of dialysis. ' +
    'Plan: continue current management, reassess in 48h.',
    'Dr. F. Lee', '-1 hour', '-1 hour');

  insertNote.run(7, 'Obstetric Admission Note',
    'Pt Emma Johnson, 28F, 34/40 gestation, G1P0, admitted via antenatal clinic with BP 166/108 mmHg. ' +
    'Symptoms: headache, visual disturbance, RUQ discomfort. Urine dipstick 3+ protein. ' +
    'Diagnosis: severe preeclampsia. MgSO4 commenced per protocol — seizure prophylaxis. ' +
    'Labetalol commenced for BP control. Betamethasone given for fetal lung maturation. ' +
    'CTG: reactive. U/S: IUGR suspicious — BPP 8/10. Obstetric senior review and neonatal team notified. ' +
    'Delivery plan: aim for 37 weeks if stabilised, or earlier if deterioration.',
    'Dr. G. Pham (Obstetrics)', '-19 hours', '-19 hours');
  insertNote.run(7, 'Midwifery Assessment',
    'BP trending: 158/100 → 155/98 → 152/96 over last 4h. MgSO4 infusion running at 1g/hr. ' +
    'Urine output 55mL/hr — adequate. DTRs present, no hyperreflexia. ' +
    'Patient anxious — birth plan discussed. Partner present. ' +
    'CTG: reactive, no decelerations. Fetal movements reported as active. ' +
    'Senior obstetric review due at 1600h.',
    'Midwife P. Clarke', '-3 hours', '-3 hours');

  insertNote.run(8, 'Orthopaedic Operative Note',
    'Pt George Wilson, 79M, right neck of femur fracture following mechanical fall at home. ' +
    'Right total hip replacement performed under spinal anaesthesia. Posterior approach. ' +
    'Cemented prosthesis. Perioperative blood loss ~450mL — transfusion not required. ' +
    'Enoxaparin VTE prophylaxis commenced day 1 post-op. ' +
    'Pre-existing HTN, hypercholesterolaemia, CKD — home medications continued (Ramipril, Atorvastatin).',
    'Dr. H. Russo (Orthopaedics)', '-2 days', '-2 days');
  insertNote.run(8, 'Physiotherapy Assessment',
    'Post-op Day 2. Patient mobilised with frame to edge of bed — tolerated well. ' +
    'Hip precautions educated (no flexion >90°, no internal rotation). Pain 4/10 on mobilisation. ' +
    'Weight-bearing as tolerated on right. Goal: walking frame by day 3. ' +
    'Delirium screening: AMT 9/10 — baseline. Discharge to rehab facility planned day 5-7.',
    'PT K. Andrews', '-4 hours', '-4 hours');

  const insertLab = primaryDb.prepare(`
    INSERT INTO lab_results (patient_id, test_name, value, unit, reference_range, status, collected_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'final', datetime('now', ?), datetime('now'))
  `);

  insertLab.run(1, 'HbA1c',                   '9.2',  '%',       '< 7.0',              '-3 days');
  insertLab.run(1, 'Blood Glucose (fasting)',  '14.3', 'mmol/L',  '3.9–5.5',            '-4 hours');
  insertLab.run(1, 'eGFR',                     '62',   'mL/min',  '> 60',               '-1 days');
  insertLab.run(1, 'WBC',                      '11.2', 'x10⁹/L', '4.0–11.0',           '-1 days');
  insertLab.run(1, 'CRP',                      '45',   'mg/L',    '< 10',               '-1 days');

  insertLab.run(2, 'Troponin I (repeat)',       '0.08', 'µg/L',   '< 0.04 (99th %ile)', '-4 hours');
  insertLab.run(2, 'CK-MB',                    '18',   'U/L',     '< 25',               '-4 hours');
  insertLab.run(2, 'Total Cholesterol',         '6.8',  'mmol/L', '< 5.5',              '-2 days');
  insertLab.run(2, 'LDL Cholesterol',           '4.2',  'mmol/L', '< 3.0',              '-2 days');

  insertLab.run(3, 'WBC',                       '16.3', 'x10⁹/L', '4.0–11.0',          '-6 hours');
  insertLab.run(3, 'CRP',                       '180',  'mg/L',    '< 10',              '-6 hours');
  insertLab.run(3, 'Haemoglobin',               '108',  'g/L',     '120–160',           '-6 hours');
  insertLab.run(3, 'Platelet Count',            '342',  'x10⁹/L', '150–400',           '-6 hours');

  insertLab.run(4, 'WBC',                       '18.4', 'x10⁹/L', '4.0–11.0',          '-8 hours');
  insertLab.run(4, 'CRP',                       '220',  'mg/L',    '< 10',              '-8 hours');
  insertLab.run(4, 'ABG — pH',                  '7.34', '',        '7.35–7.45',         '-4 hours');
  insertLab.run(4, 'ABG — pCO₂',               '48',   'mmHg',    '35–45',             '-4 hours');
  insertLab.run(4, 'ABG — pO₂',                '72',   'mmHg',    '80–100',            '-4 hours');
  insertLab.run(4, 'Lactate',                   '1.8',  'mmol/L',  '0.5–2.0',           '-4 hours');

  insertLab.run(5, 'D-Dimer',                   '4200', 'µg/L',    '< 500',             '-4 days');
  insertLab.run(5, 'Troponin I',                '0.06', 'µg/L',    '< 0.04',            '-4 days');
  insertLab.run(5, 'SpO₂ (on 2L O₂)',          '96',   '%',       '> 95',              '-1 hours');

  insertLab.run(6, 'Creatinine',                '210',  'µmol/L',  '60–110',            '-6 hours');
  insertLab.run(6, 'eGFR',                      '31',   'mL/min',  '> 60',              '-6 hours');
  insertLab.run(6, 'Potassium',                 '5.2',  'mmol/L',  '3.5–5.0',           '-6 hours');
  insertLab.run(6, 'Bicarbonate',               '18',   'mmol/L',  '22–29',             '-6 hours');
  insertLab.run(6, 'Urea',                      '22',   'mmol/L',  '3.0–8.0',           '-6 hours');

  insertLab.run(7, 'Platelet Count',            '145',  'x10⁹/L', '150–400',           '-3 hours');
  insertLab.run(7, 'ALT',                       '68',   'U/L',     '7–45',              '-3 hours');
  insertLab.run(7, 'Creatinine',                '98',   'µmol/L',  '45–90',             '-3 hours');
  insertLab.run(7, 'Urine Protein (dipstick)',  '3+',   '',        'Negative',          '-3 hours');

  insertLab.run(8, 'Haemoglobin',               '98',   'g/L',     '130–175',           '-6 hours');
  insertLab.run(8, 'INR',                       '1.1',  '',        '0.9–1.2',           '-6 hours');
  insertLab.run(8, 'eGFR',                      '58',   'mL/min',  '> 60',              '-6 hours');

  console.log('  ✔ 8 patients inserted');
  console.log('  ✔ 33 medications inserted');
  console.log('  ✔ 8 allergy records inserted');
  console.log('  ✔ 16 clinical notes inserted');
  console.log('  ✔ 31 lab results inserted');
});

seedData();

primaryDb.close();
hcpsDb.close();

console.log('\nDatabase initialisation complete.');
console.log('  primary_emr.db  — seeded with fake patient data (DB1)');
console.log('  hcps_backup.db  — schema created, empty until first sync (DB2)');
console.log('\nRun  npm start  to launch the server.\n');
