// Global state for the SPA. Call render() after changing anything in here.
const AppState = {
  page: 'login',
  token: null,
  user: null,
  status: null,
  patients: [],
  currentPatient: null,
  currentTab: 'medications',
  reconciliation: null,
  auditLogs: null,
  statusPollId: null
};

// Wrapper around fetch(). Handles the auth header and JSON parsing in one place
// so every API call doesn't need to repeat the same setup.
const API = {
  async request(method, path, body) {
    const opts = {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(AppState.token ? { Authorization: `Bearer ${AppState.token}` } : {})
      }
    };
    if (body) opts.body = JSON.stringify(body);
    const resp = await fetch(path, opts);
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(data.error || `HTTP ${resp.status}`);
    return data;
  },
  get:    (path)        => API.request('GET',  path),
  post:   (path, body)  => API.request('POST', path, body),
  login:  (u, p)        => API.post('/api/login',   { username: u, password: p }),
  logout: ()            => API.post('/api/logout'),
  status: ()            => API.get('/api/status'),
  sync:   ()            => API.post('/api/sync',    { syncType: 'manual' }),
  startDowntime: ()     => API.post('/api/downtime/start'),
  endDowntime:   ()     => API.post('/api/downtime/end'),
  patients:      ()     => API.get('/api/patients'),
  patient:    (id)      => API.get(`/api/patients/${id}`),
  addNote:    (body)    => API.post('/api/hcps/notes',            body),
  addMed:     (body)    => API.post('/api/hcps/medication-entry', body),
  reconcile:  ()        => API.get('/api/reconciliation'),
  confirm: (id, type)   => API.post(`/api/reconciliation/${id}/confirm`, { type }),
  defer:   (id, type)   => API.post(`/api/reconciliation/${id}/defer`,   { type }),
  auditLog: (limit)     => API.get(`/api/audit-log?limit=${limit || 150}`)
};

// "12 Jan 2024" — Australian date format used throughout the UI.
function fmtDate(d) {
  if (!d) return '—';
  const dt = new Date(d);
  if (isNaN(dt)) return d;
  return dt.toLocaleDateString('en-AU', { day:'2-digit', month:'short', year:'numeric' });
}

// "12 Jan 2024, 14:30" — used for timestamps in tables and the status bar.
function fmtDateTime(d) {
  if (!d) return '—';
  const dt = new Date(d);
  if (isNaN(dt)) return d;
  return dt.toLocaleString('en-AU', {
    day:'2-digit', month:'short', year:'numeric',
    hour:'2-digit', minute:'2-digit', hour12: false
  });
}

// Converts DOB to age in years, e.g. "43y".
function fmtAge(dob) {
  if (!dob) return '—';
  const diff = Date.now() - new Date(dob).getTime();
  return Math.floor(diff / (365.25 * 24 * 3600 * 1000)) + 'y';
}

// "3m ago", "2h ago" etc. — used in the header sync pill.
function timeSince(d) {
  if (!d) return 'Never';
  const seconds = Math.round((Date.now() - new Date(d).getTime()) / 1000);
  if (seconds < 60)  return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds/60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds/3600)}h ago`;
  return fmtDateTime(d);
}

// Sanitise user-supplied strings before dropping them into innerHTML — prevents XSS.
function escHtml(s) {
  if (!s) return '';
  return String(s)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;');
}

// Small toast notification — type is 'success', 'error', 'warning', or 'info'.
function showToast(msg, type = 'info') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  const icons = { success:'✓', error:'✗', warning:'⚠', info:'ℹ' };
  el.innerHTML = `<span>${icons[type] || 'ℹ'}</span> <span>${escHtml(msg)}</span>`;
  document.getElementById('toast-container').appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transform = 'translateX(100%)'; el.style.transition = '0.3s'; }, 3200);
  setTimeout(() => el.remove(), 3500);
}

function showModal(html) {
  document.getElementById('modal-box').innerHTML = html;
  document.getElementById('modal-overlay').classList.remove('hidden');
}

function closeModal() {
  document.getElementById('modal-overlay').classList.add('hidden');
  document.getElementById('modal-box').innerHTML = '';
}

// Click outside the modal box to dismiss it.
document.getElementById('modal-overlay').addEventListener('click', e => {
  if (e.target === document.getElementById('modal-overlay')) closeModal();
});

// Navigate to a page by name and re-render. Pass extra state fields as the second arg.
function navigate(page, extra) {
  AppState.page = page;
  if (extra) Object.assign(AppState, extra);
  render();
  window.scrollTo(0, 0);
}

// Fetches current system status and updates the header status pills.
// Called on every navigate and every 15 seconds by the poll interval.
async function refreshStatus() {
  try {
    AppState.status = await API.status();
    const em = document.getElementById('header-emr-status');
    const ls = document.getElementById('header-sync-time');
    const rb = document.getElementById('recon-badge');
    if (em) em.outerHTML = headerEMRPill();
    if (ls) ls.outerHTML = headerSyncPill();
    if (rb && AppState.status) {
      const cnt = AppState.status.pendingReconciliationCount || 0;
      rb.innerHTML = cnt > 0 ? `<span class="nav-badge">${cnt}</span>` : '';
    }
  } catch (_) {}
}

// HTML snippet for the "Primary EMR: Online/Offline" pill in the header.
function headerEMRPill() {
  const online = AppState.status?.primaryEMROnline !== false;
  return `<span id="header-emr-status" class="status-pill">
    <span class="status-dot ${online ? 'dot-green':'dot-red'}"></span>
    Primary EMR: <strong>${online ? 'Online':'Offline'}</strong>
  </span>`;
}

// HTML snippet for the "Last Sync" pill in the header.
function headerSyncPill() {
  const t = AppState.status?.lastSyncTime;
  return `<span id="header-sync-time" class="status-pill">
    <span class="status-dot ${t ? 'dot-amber':'dot-grey'}"></span>
    Last Sync: <strong>${t ? timeSince(t) : 'Never'}</strong>
  </span>`;
}

// Shell layout — wraps the inner content with the header, sidebar, and downtime banner.
// Every page renderer calls this and passes its own content string.
function renderLayout(content) {
  const s = AppState.status || {};
  const online = s.primaryEMROnline !== false;
  const pending = s.pendingReconciliationCount || 0;
  const pages = [
    { id:'dashboard',   icon:'🏠', label:'Dashboard'           },
    { id:'patients',    icon:'🧑‍⚕️', label:'Patient Records'   },
    null,
    { id:'sync',        icon:'🔄', label:'Sync & Status'       },
    { id:'downtime',    icon:'⚡', label:'Downtime Controls'   },
    null,
    { id:'reconciliation', icon:'📋', label:'Reconciliation Queue', badge: pending > 0 ? pending : 0 },
    { id:'audit-log',   icon:'📜', label:'Audit Log'           },
    null,
    { id:'scope',       icon:'ℹ️', label:'Prototype Scope'     }
  ];

  return `
    <div class="layout">
      <header class="header">
        <div class="header-brand">
          <span class="brand-icon">🏥</span>
          <div>
            HCPS
            <span class="brand-sub">Hybrid Continuity Planning System</span>
          </div>
        </div>
        <div class="header-status">
          ${headerEMRPill()}
          <span class="status-pill">
            <span class="status-dot dot-green"></span>
            HCPS Database: <strong>Available</strong>
          </span>
          ${headerSyncPill()}
          ${!online ? `<span class="status-pill">
            <span class="status-dot dot-red"></span>
            <strong style="color:#EF9A9A">DOWNTIME MODE ACTIVE</strong>
          </span>` : ''}
        </div>
        <div class="header-user">
          <span>👤 ${escHtml(AppState.user?.displayName || 'User')}</span>
          <button class="btn-logout" onclick="handleLogout()">Logout</button>
        </div>
      </header>

      <nav class="sidebar">
        <div class="sidebar-section-label">Navigation</div>
        ${pages.map(p => {
          if (!p) return '<hr class="sidebar-divider">';
          const active = AppState.page === p.id ? ' active' : '';
          return `<div class="nav-item${active}" onclick="navigate('${p.id}')">
            <span class="nav-icon">${p.icon}</span>
            <span>${p.label}</span>
            ${p.id==='reconciliation' ? `<span id="recon-badge">${p.badge > 0 ? `<span class="nav-badge">${p.badge}</span>` : ''}</span>` : ''}
          </div>`;
        }).join('')}
        <div class="sidebar-footer">
          HCPS v1.0<br>Honours Thesis Prototype<br>Not for clinical use
        </div>
      </nav>

      <main class="main-content">
        ${!online ? `
          <div class="downtime-banner">
            <span class="banner-icon">⚠</span>
            <div>
              <strong>DOWNTIME MODE ACTIVE — Primary EMR Unavailable</strong>
              <div class="banner-detail">
                System is now serving data from the HCPS backup database (DB2).
                All entries added here will be queued for reconciliation.
                ${s.downtimeStartTime ? `Downtime started: ${fmtDateTime(s.downtimeStartTime)}` : ''}
              </div>
            </div>
          </div>` : ''}
        ${content}
      </main>
    </div>`;
}

function renderLogin() {
  return `
    <div class="login-page">
      <div class="login-card">
        <div class="login-logo">
          <span class="logo-icon">🏥</span>
          <h1>HCPS</h1>
          <div class="logo-sub">Hybrid Continuity Planning System</div>
          <div class="logo-sub" style="margin-top:2px;color:#B71C1C;font-weight:600">Honours Thesis Prototype</div>
        </div>
        <div id="login-error" class="login-error"></div>
        <div class="form-group">
          <label class="form-label" for="l-user">Username</label>
          <input id="l-user" class="form-control" type="text" placeholder="Enter username" value="admin" />
        </div>
        <div class="form-group">
          <label class="form-label" for="l-pass">Password</label>
          <input id="l-pass" class="form-control" type="password" placeholder="Enter password" value="hcps2025"
            onkeydown="if(event.key==='Enter') handleLogin()" />
        </div>
        <button class="btn btn-primary" style="width:100%;margin-top:6px;padding:10px" onclick="handleLogin()">
          Sign In
        </button>
        <div class="login-divider">
          Demo credentials: <strong>admin</strong> / <strong>hcps2025</strong>
        </div>
        <div style="font-size:.72rem;color:#90A4AE;text-align:center;margin-top:8px">
          This is a thesis prototype. All patient data is fictional.
        </div>
      </div>
    </div>`;
}

// Submit the login form. On success, stores the token in localStorage and goes to the dashboard.
async function handleLogin() {
  const u  = document.getElementById('l-user')?.value?.trim();
  const p  = document.getElementById('l-pass')?.value;
  const er = document.getElementById('login-error');
  if (!u || !p) { if(er){er.textContent='Please enter credentials.'; er.classList.add('show');} return; }
  try {
    const r = await API.login(u, p);
    AppState.token = r.token;
    AppState.user  = r.user;
    localStorage.setItem('hcps_token', r.token);
    localStorage.setItem('hcps_user',  JSON.stringify(r.user));
    AppState.status = await API.status();
    navigate('dashboard');
    startStatusPolling();
    showToast(`Welcome, ${r.user.displayName}`, 'success');
  } catch (e) {
    if(er){er.textContent='Invalid username or password.'; er.classList.add('show');}
  }
}

// Clear the session and return to the login page.
async function handleLogout() {
  try { await API.logout(); } catch(_) {}
  stopStatusPolling();
  AppState.token = null;
  AppState.user  = null;
  AppState.status = null;
  localStorage.removeItem('hcps_token');
  localStorage.removeItem('hcps_user');
  navigate('login');
}

// Poll the status endpoint every 15s so the header stays current.
function startStatusPolling() {
  if (AppState.statusPollId) clearInterval(AppState.statusPollId);
  AppState.statusPollId = setInterval(refreshStatus, 15000);
}

function stopStatusPolling() {
  if (AppState.statusPollId) clearInterval(AppState.statusPollId);
  AppState.statusPollId = null;
}

// Dashboard — shows stat cards, system status, quick actions, and the demo workflow steps.
async function renderDashboard() {
  let s = AppState.status;
  if (!s) { try { s = AppState.status = await API.status(); } catch (_) {} }
  if (!s) return renderLayout('<div class="loading">Loading status…</div>');

  let patCount = AppState.patients.length;
  if (patCount === 0) {
    try { const r = await API.patients(); AppState.patients = r.patients || []; patCount = AppState.patients.length; }
    catch (_) {}
  }

  const online = s.primaryEMROnline !== false;
  const pending = s.pendingReconciliationCount || 0;

  const content = `
    <div class="page-header">
      <div class="page-title">🏠 Dashboard</div>
      <div class="page-subtitle">System overview — ${online ? 'Primary EMR online' : 'DOWNTIME MODE — serving from HCPS backup'}</div>
    </div>

    <div class="stat-grid">
      <div class="stat-card blue">
        <div class="stat-label">Admitted Patients</div>
        <div class="stat-value blue">${patCount}</div>
        <div class="stat-meta">Active patient records</div>
      </div>
      <div class="stat-card ${online ? 'green':'red'}">
        <div class="stat-label">Primary EMR (DB1)</div>
        <div class="stat-value ${online ? 'green':'red'}">${online ? 'Online' : 'Offline'}</div>
        <div class="stat-meta">${online ? 'Fully operational' : 'Downtime mode active'}</div>
      </div>
      <div class="stat-card green">
        <div class="stat-label">HCPS Database (DB2)</div>
        <div class="stat-value green">Ready</div>
        <div class="stat-meta">${s.lastSyncTime ? 'Last synced ' + timeSince(s.lastSyncTime) : 'Not yet synced'}</div>
      </div>
      <div class="stat-card ${pending > 0 ? 'amber' : 'green'}">
        <div class="stat-label">Pending Reconciliation</div>
        <div class="stat-value ${pending > 0 ? 'amber' : 'green'}">${pending}</div>
        <div class="stat-meta">${pending > 0 ? 'Items awaiting review' : 'Queue is clear'}</div>
      </div>
    </div>

    <div class="grid-2" style="margin-bottom:20px">
      <div class="card">
        <div class="card-header">
          <div class="card-title"><span class="card-icon">🔗</span> System Status</div>
        </div>
        <div class="sync-status-grid" style="margin-bottom:0">
          <div class="sync-status-item">
            <div class="sti-label">Primary EMR</div>
            <div class="sti-value">
              <span class="badge ${online ? 'badge-online':'badge-offline'}">${online ? '● Online':'● Offline'}</span>
            </div>
          </div>
          <div class="sync-status-item">
            <div class="sti-label">HCPS Database</div>
            <div class="sti-value"><span class="badge badge-online">● Available</span></div>
          </div>
          <div class="sync-status-item">
            <div class="sti-label">Last Sync</div>
            <div class="sti-value" style="font-size:.85rem">${s.lastSyncTime ? fmtDateTime(s.lastSyncTime) : 'Never'}</div>
          </div>
          <div class="sync-status-item">
            <div class="sti-label">Sync Status</div>
            <div class="sti-value">
              <span class="badge ${s.lastSyncStatus==='success' ? 'badge-online' : s.lastSyncStatus ? 'badge-warning' : 'badge-deferred'}">
                ${s.lastSyncStatus || 'No sync yet'}
              </span>
            </div>
          </div>
        </div>
        ${!s.lastSyncTime ? `
          <div class="info-box mt-12">
            <strong>No sync performed yet.</strong>
            Run a manual sync to copy patient data from the primary EMR into the HCPS backup database.
          </div>` : `
          <div class="info-box mt-12">
            Data may not include changes made after ${fmtDateTime(s.lastSyncTime)}.
            ${online ? 'Run a sync to update the HCPS backup database.' : 'Primary EMR is offline — reading from HCPS backup.'}
          </div>`}
      </div>

      <div class="card">
        <div class="card-header">
          <div class="card-title"><span class="card-icon">⚡</span> Quick Actions</div>
        </div>
        <div style="display:flex;flex-direction:column;gap:10px">
          <button class="btn btn-primary" onclick="navigate('patients')" style="justify-content:center">
            🧑‍⚕️ View Patient Records
          </button>
          ${online ? `
          <button class="btn btn-ghost" onclick="handleSync()" style="justify-content:center">
            🔄 Run Manual Sync (DB1 → DB2)
          </button>
          <button class="btn btn-danger" onclick="navigate('downtime')" style="justify-content:center">
            ⚡ Activate Downtime Mode
          </button>` : `
          <button class="btn btn-success" onclick="navigate('downtime')" style="justify-content:center">
            ✅ Restore Primary EMR
          </button>
          `}
          ${pending > 0 ? `
          <button class="btn btn-warning" onclick="navigate('reconciliation')" style="justify-content:center">
            📋 Review Reconciliation Queue (${pending})
          </button>` : ''}
          <button class="btn btn-secondary" onclick="navigate('audit-log')" style="justify-content:center">
            📜 View Audit Log
          </button>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-header">
        <div class="card-title"><span class="card-icon">ℹ️</span> Demonstration Workflow</div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:10px;font-size:.82rem;color:var(--text-secondary)">
        ${[
          ['1','Login & view dashboard','Complete ✓'],
          ['2','View patient records from DB1', online ? 'Ready' : 'Using DB2'],
          ['3','Run manual sync (DB1→DB2)', s.lastSyncTime ? 'Done ✓' : 'Pending'],
          ['4','Activate downtime mode', !online ? 'Active ✓' : 'Pending'],
          ['5','Add downtime note/medication', !online ? 'Available' : 'Requires downtime'],
          ['6','Restore primary EMR', online ? 'Online ✓' : 'Pending'],
          ['7','Confirm reconciliation', 'See Reconciliation Queue'],
          ['8','Review audit log', 'See Audit Log']
        ].map(([n,label,state]) => `
          <div style="background:var(--surface-2);border:1px solid var(--border);border-radius:6px;padding:10px 12px">
            <div style="font-weight:700;color:var(--text);margin-bottom:2px">Step ${n}: ${label}</div>
            <div style="color:var(--text-muted)">${state}</div>
          </div>`).join('')}
      </div>
    </div>`;

  return renderLayout(content);
}

// Patient list. The source badge (DB1/DB2) shows which database is currently active.
async function renderPatients() {
  try {
    const r = await API.patients();
    AppState.patients = r.patients || [];
    const source = r.source;
    const online = source === 'primary_emr';

    const rows = AppState.patients.length === 0
      ? '<tr class="empty-row"><td colspan="7">No admitted patients found.</td></tr>'
      : AppState.patients.map(p => `
          <tr style="cursor:pointer" onclick="loadPatient(${p.id})">
            <td><strong>${escHtml(p.last_name)}, ${escHtml(p.first_name)}</strong></td>
            <td><span style="font-family:var(--font-mono);font-size:.8rem">${escHtml(p.mrn)}</span></td>
            <td>${fmtDate(p.dob)} <span class="text-muted text-small">(${fmtAge(p.dob)})</span></td>
            <td>${escHtml(p.gender || '—')}</td>
            <td>${escHtml(p.ward || '—')} / ${escHtml(p.bed || '—')}</td>
            <td class="text-truncate" style="max-width:220px">${escHtml(p.diagnosis || '—')}</td>
            <td><span class="badge badge-online">Admitted</span></td>
          </tr>`).join('');

    const content = `
      <div class="page-header">
        <div class="page-title">🧑‍⚕️ Patient Records</div>
        <div class="page-subtitle">
          ${AppState.patients.length} admitted patient(s) — reading from
          <strong>${online ? 'Primary EMR (DB1)' : 'HCPS Backup Database (DB2)'}</strong>
          ${!online ? '— <em>data reflects last sync</em>' : ''}
        </div>
      </div>
      ${!online ? `<div class="info-box mb-16">
        <strong>HCPS Mode:</strong>
        Displaying patients from the HCPS backup database.
        Data was synchronised at ${AppState.status?.lastSyncTime ? fmtDateTime(AppState.status.lastSyncTime) : 'an unknown time'} and may not reflect the most recent changes.
      </div>` : ''}
      <div class="card">
        <div class="card-header">
          <div class="card-title">
            <span class="card-icon">🏥</span>
            Admitted Patients
            <span class="badge badge-primary" style="margin-left:4px">${AppState.patients.length}</span>
          </div>
          <span class="badge ${online ? 'badge-emr' : 'badge-hcps'}">
            ${online ? '📡 Primary EMR (DB1)' : '🗄 HCPS Backup (DB2)'}
          </span>
        </div>
        <div class="table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th>Patient Name</th>
                <th>MRN</th>
                <th>Date of Birth</th>
                <th>Gender</th>
                <th>Ward / Bed</th>
                <th>Diagnosis</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </div>`;

    return renderLayout(content);
  } catch (err) {
    return renderLayout(`<div class="card"><p style="color:var(--danger)">Error loading patients: ${escHtml(err.message)}</p></div>`);
  }
}

// Load a single patient's full record and render the detail view.
async function loadPatient(id) {
  AppState.page = 'patient-detail';
  AppState.currentTab = 'medications';
  document.getElementById('app').innerHTML = renderLayout('<div class="loading"><span class="spinner"></span> Loading patient record…</div>');
  try {
    const data = await API.patient(id);
    AppState.currentPatient = data;
    document.getElementById('app').innerHTML = await renderPatientDetail();
    attachPatientTabs();
  } catch (err) {
    document.getElementById('app').innerHTML = renderLayout(`<div class="card"><p style="color:var(--danger)">Error: ${escHtml(err.message)}</p></div>`);
  }
}

// Patient detail — patient banner, four tabs (meds, allergies, notes, labs).
// During downtime, meds and notes tabs get "Add Downtime" buttons.
async function renderPatientDetail() {
  const d = AppState.currentPatient;
  if (!d) return renderLayout('<div class="card">No patient selected.</div>');

  const { patient: p, medications, allergies, notes, labs, source } = d;
  const online = source === 'primary_emr';
  const isDowntime = !online;

  function sevBadge(sev) {
    const s = (sev||'').toLowerCase();
    if (s.includes('severe'))   return `<span class="badge badge-severe">Severe</span>`;
    if (s.includes('moderate')) return `<span class="badge badge-moderate">Moderate</span>`;
    return `<span class="badge badge-mild">Mild</span>`;
  }

  // Shows where this record came from — either the EMR (synced) or HCPS (added during downtime).
  function sourceBadge(src) {
    return src === 'HCPS'
      ? `<span class="source-tag source-hcps">HCPS</span>`
      : `<span class="source-tag source-emr">EMR</span>`;
  }

  const allergyTab = `
    <div class="card">
      <div class="card-header">
        <div class="card-title">🚨 Allergies & Adverse Reactions</div>
        ${isDowntime ? `<span class="badge badge-hcps">HCPS Backup</span>` : ''}
      </div>
      ${allergies.length === 0 ? `<p style="color:var(--text-muted);font-style:italic">No known drug allergies (NKDA)</p>` : `
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>Allergen</th><th>Reaction</th><th>Severity</th></tr></thead>
          <tbody>
            ${allergies.map(a => `
              <tr>
                <td><strong>${escHtml(a.allergen)}</strong></td>
                <td>${escHtml(a.reaction || '—')}</td>
                <td>${sevBadge(a.severity)}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>`}
    </div>`;

  const medTab = `
    <div class="card">
      <div class="card-header">
        <div class="card-title">💊 Active Medications</div>
        <div style="display:flex;gap:8px;align-items:center">
          ${isDowntime ? `<span class="badge badge-hcps">HCPS Backup</span>` : ''}
          ${isDowntime ? `<button class="btn btn-primary btn-sm" onclick="openAddMedModal(${p.id},'${escHtml(p.first_name)} ${escHtml(p.last_name)}')">+ Add Downtime Medication</button>` : ''}
        </div>
      </div>
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>Medication</th><th>Dosage</th><th>Frequency</th><th>Route</th><th>Prescriber</th>${isDowntime?'<th>Source</th>':''}</tr></thead>
          <tbody>
            ${medications.length === 0 ? '<tr class="empty-row"><td colspan="6">No active medications recorded.</td></tr>' :
              medications.map(m => `
                <tr>
                  <td><strong>${escHtml(m.name)}</strong></td>
                  <td>${escHtml(m.dosage||'—')}</td>
                  <td>${escHtml(m.frequency||'—')}</td>
                  <td>${escHtml(m.route||'—')}</td>
                  <td>${escHtml(m.prescriber||'—')}</td>
                  ${isDowntime ? `<td>${sourceBadge(m.source)}</td>` : ''}
                </tr>`).join('')}
          </tbody>
        </table>
      </div>
      ${isDowntime ? `<div class="info-box mt-12">
        <strong>HCPS Mode:</strong> Medications marked <span class="source-tag source-emr">EMR</span> are from the last sync.
        Entries marked <span class="source-tag source-hcps">HCPS</span> were added during downtime and are pending reconciliation.
      </div>` : ''}
    </div>`;

  const noteTab = `
    <div class="card">
      <div class="card-header">
        <div class="card-title">📝 Clinical Notes</div>
        <div style="display:flex;gap:8px;align-items:center">
          ${isDowntime ? `<span class="badge badge-hcps">HCPS Backup</span>` : ''}
          ${isDowntime ? `<button class="btn btn-primary btn-sm" onclick="openAddNoteModal(${p.id},'${escHtml(p.first_name)} ${escHtml(p.last_name)}')">+ Add Downtime Note</button>` : ''}
        </div>
      </div>
      ${notes.length === 0 ? `<p style="color:var(--text-muted);font-style:italic">No clinical notes found.</p>` : `
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>Date/Time</th><th>Type</th><th>Author</th><th>Note</th>${isDowntime?'<th>Source</th>':''}</tr></thead>
          <tbody>
            ${notes.map(n => `
              <tr>
                <td style="white-space:nowrap">${fmtDateTime(n.created_at)}</td>
                <td><span class="badge badge-primary">${escHtml(n.note_type||'Note')}</span></td>
                <td>${escHtml(n.author||'—')}</td>
                <td class="note-text-cell"><div class="note-text-preview">${escHtml(n.note_text||'')}</div></td>
                ${isDowntime ? `<td>${sourceBadge(n.source)}</td>` : ''}
              </tr>`).join('')}
          </tbody>
        </table>
      </div>`}
    </div>`;

  // Flag out-of-range lab values. Handles <X, >X, and X–Y range formats.
  function labFlag(val, ref) {
    if (!val || !ref) return '';
    const v = parseFloat(val);
    if (isNaN(v)) return '';
    const lt = ref.match(/^<\s*([\d.]+)/);
    const gt = ref.match(/^>\s*([\d.]+)/);
    const rng = ref.match(/([\d.]+)[–\-]([\d.]+)/);
    if (lt  && v >= parseFloat(lt[1]))  return '<span class="badge badge-warning" style="margin-left:4px">High</span>';
    if (gt  && v <= parseFloat(gt[1]))  return '<span class="badge badge-warning" style="margin-left:4px">Low</span>';
    if (rng) {
      if (v > parseFloat(rng[2])) return '<span class="badge badge-warning" style="margin-left:4px">High</span>';
      if (v < parseFloat(rng[1])) return '<span class="badge badge-warning" style="margin-left:4px">Low</span>';
    }
    return '';
  }

  const labTab = `
    <div class="card">
      <div class="card-header">
        <div class="card-title">🧪 Laboratory Results</div>
        ${isDowntime ? `<span class="badge badge-hcps">HCPS Backup — data from last sync</span>` : ''}
      </div>
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>Test</th><th>Value</th><th>Unit</th><th>Reference Range</th><th>Status</th><th>Collected</th></tr></thead>
          <tbody>
            ${labs.length === 0 ? '<tr class="empty-row"><td colspan="6">No lab results found for this patient.</td></tr>' :
              labs.map(l => `
                <tr>
                  <td><strong>${escHtml(l.test_name||'—')}</strong></td>
                  <td>${escHtml(l.value||'—')} ${labFlag(l.value, l.reference_range)}</td>
                  <td>${escHtml(l.unit||'—')}</td>
                  <td style="font-size:.78rem;color:var(--text-muted)">${escHtml(l.reference_range||'—')}</td>
                  <td><span class="badge badge-online">${escHtml(l.status||'final')}</span></td>
                  <td style="white-space:nowrap">${fmtDateTime(l.collected_at)}</td>
                </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>`;

  const content = `
    <div class="page-header" style="display:flex;align-items:center;justify-content:space-between">
      <div>
        <div class="page-title">
          <button class="btn btn-secondary btn-sm" onclick="navigate('patients')" style="font-size:.8rem">← Back</button>
          Patient Record
        </div>
      </div>
      <span class="badge ${online ? 'badge-emr' : 'badge-hcps'}">
        ${online ? '📡 Primary EMR (DB1)' : '🗄 HCPS Backup (DB2)'}
      </span>
    </div>

    <div class="patient-banner">
      <div class="patient-name-row">
        <span class="patient-name">${escHtml(p.last_name)}, ${escHtml(p.first_name)}</span>
        <span class="patient-mrn">${escHtml(p.mrn)}</span>
        <span class="badge badge-online">Admitted</span>
        ${allergies.some(a => a.severity?.toLowerCase().includes('severe'))
          ? `<span class="badge badge-severe">⚠ Severe Allergy</span>` : ''}
      </div>
      <div class="patient-meta-row">
        <span><strong>DOB:</strong> ${fmtDate(p.dob)} (${fmtAge(p.dob)})</span>
        <span><strong>Gender:</strong> ${escHtml(p.gender || '—')}</span>
        <span><strong>Ward:</strong> ${escHtml(p.ward || '—')} / Bed ${escHtml(p.bed || '—')}</span>
        <span><strong>Admitted:</strong> ${fmtDate(p.admission_date)}</span>
        <span><strong>Diagnosis:</strong> ${escHtml(p.diagnosis || '—')}</span>
      </div>
    </div>

    <div class="tabs" id="patient-tabs">
      <button class="tab-btn ${AppState.currentTab==='medications'?'active':''}" data-tab="medications">💊 Medications (${medications.length})</button>
      <button class="tab-btn ${AppState.currentTab==='allergies' ?'active':''}" data-tab="allergies">🚨 Allergies (${allergies.length})</button>
      <button class="tab-btn ${AppState.currentTab==='notes'     ?'active':''}" data-tab="notes">📝 Notes (${notes.length})</button>
      <button class="tab-btn ${AppState.currentTab==='labs'      ?'active':''}" data-tab="labs">🧪 Labs (${labs.length})</button>
    </div>

    <div id="tab-medications" class="tab-panel ${AppState.currentTab==='medications'?'active':''}">${medTab}</div>
    <div id="tab-allergies"   class="tab-panel ${AppState.currentTab==='allergies' ?'active':''}">${allergyTab}</div>
    <div id="tab-notes"       class="tab-panel ${AppState.currentTab==='notes'     ?'active':''}">${noteTab}</div>
    <div id="tab-labs"        class="tab-panel ${AppState.currentTab==='labs'      ?'active':''}">${labTab}</div>`;

  return renderLayout(content);
}

// Wire up tab switching on the patient detail page. Called after rendering patient detail.
function attachPatientTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      AppState.currentTab = btn.dataset.tab;
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b === btn));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.id === `tab-${btn.dataset.tab}`));
    });
  });
}

// Open the "Add Downtime Note" modal. Only reachable during downtime.
function openAddNoteModal(patientId, patientName) {
  showModal(`
    <div class="modal-header">
      <div class="modal-title">📝 Add Downtime Clinical Note</div>
      <button class="modal-close" onclick="closeModal()">✕</button>
    </div>
    <div class="modal-body">
      <div class="info-box mb-16">
        <strong>HCPS Downtime Entry</strong>
        This note will be stored in the HCPS backup database and marked as <em>pending reconciliation</em>.
        It will need to be reviewed and confirmed after the primary EMR is restored.
      </div>
      <div class="form-group">
        <label class="form-label">Patient</label>
        <input class="form-control" type="text" value="${escHtml(patientName)}" disabled />
      </div>
      <div class="form-group">
        <label class="form-label">Note Type</label>
        <select id="dt-note-type" class="form-control">
          <option value="Downtime Note">Downtime Note</option>
          <option value="Clinical Observation">Clinical Observation</option>
          <option value="Nursing Note">Nursing Note</option>
          <option value="Medical Note">Medical Note</option>
          <option value="Medication Administration">Medication Administration</option>
          <option value="Vital Signs">Vital Signs</option>
          <option value="Patient Assessment">Patient Assessment</option>
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Clinical Note *</label>
        <textarea id="dt-note-text" class="form-control" rows="5" placeholder="Enter clinical note…"></textarea>
      </div>
      <div class="form-group">
        <label class="form-label">Author (auto-filled)</label>
        <input class="form-control" type="text" value="${escHtml(AppState.user?.displayName || '')}" disabled />
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="submitDowntimeNote(${patientId})">Save Downtime Note</button>
    </div>`);
}

// Submit the downtime note form, then reload the patient record to show the new entry.
async function submitDowntimeNote(patientId) {
  const noteType = document.getElementById('dt-note-type')?.value;
  const noteText = document.getElementById('dt-note-text')?.value?.trim();
  if (!noteText) { showToast('Please enter a note.', 'warning'); return; }
  try {
    await API.addNote({ patient_id: patientId, note_type: noteType, note_text: noteText });
    closeModal();
    showToast('Downtime note saved. Pending reconciliation.', 'success');
    const data = await API.patient(patientId);
    AppState.currentPatient = data;
    AppState.currentTab = 'notes';
    document.getElementById('app').innerHTML = await renderPatientDetail();
    attachPatientTabs();
    refreshStatus();
  } catch (err) {
    showToast(`Error: ${err.message}`, 'error');
  }
}

// Open the "Add Downtime Medication" modal. Only reachable during downtime.
function openAddMedModal(patientId, patientName) {
  showModal(`
    <div class="modal-header">
      <div class="modal-title">💊 Add Downtime Medication Entry</div>
      <button class="modal-close" onclick="closeModal()">✕</button>
    </div>
    <div class="modal-body">
      <div class="info-box mb-16">
        <strong>HCPS Downtime Entry</strong>
        This medication entry will be stored in the HCPS backup database and marked as <em>pending reconciliation</em>.
        It must be reviewed by a prescriber and confirmed after the primary EMR is restored.
      </div>
      <div class="form-group">
        <label class="form-label">Patient</label>
        <input class="form-control" type="text" value="${escHtml(patientName)}" disabled />
      </div>
      <div class="grid-2">
        <div class="form-group">
          <label class="form-label">Medication Name *</label>
          <input id="dt-med-name" class="form-control" type="text" placeholder="e.g. Paracetamol" />
        </div>
        <div class="form-group">
          <label class="form-label">Dosage</label>
          <input id="dt-med-dosage" class="form-control" type="text" placeholder="e.g. 1g" />
        </div>
        <div class="form-group">
          <label class="form-label">Frequency</label>
          <input id="dt-med-freq" class="form-control" type="text" placeholder="e.g. Four times daily" />
        </div>
        <div class="form-group">
          <label class="form-label">Route</label>
          <select id="dt-med-route" class="form-control">
            <option value="">Select route…</option>
            <option value="Oral">Oral</option>
            <option value="IV">IV</option>
            <option value="Subcutaneous">Subcutaneous</option>
            <option value="IM">IM</option>
            <option value="Nebulised">Nebulised</option>
            <option value="Topical">Topical</option>
            <option value="Nasal prongs">Nasal prongs (O₂)</option>
          </select>
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Prescriber (auto-filled)</label>
        <input class="form-control" type="text" value="${escHtml(AppState.user?.displayName || '')}" disabled />
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="submitDowntimeMed(${patientId})">Save Medication Entry</button>
    </div>`);
}

// Submit the downtime medication form, then reload the patient record.
async function submitDowntimeMed(patientId) {
  const name      = document.getElementById('dt-med-name')?.value?.trim();
  const dosage    = document.getElementById('dt-med-dosage')?.value?.trim();
  const frequency = document.getElementById('dt-med-freq')?.value?.trim();
  const route     = document.getElementById('dt-med-route')?.value;
  if (!name) { showToast('Medication name is required.', 'warning'); return; }
  try {
    await API.addMed({ patient_id: patientId, name, dosage, frequency, route });
    closeModal();
    showToast('Medication entry saved. Pending reconciliation.', 'success');
    const data = await API.patient(patientId);
    AppState.currentPatient = data;
    AppState.currentTab = 'medications';
    document.getElementById('app').innerHTML = await renderPatientDetail();
    attachPatientTabs();
    refreshStatus();
  } catch (err) {
    showToast(`Error: ${err.message}`, 'error');
  }
}

// Sync page — shows last sync time, what gets included, and the sync button.
async function renderSync() {
  let s = AppState.status;
  try { s = AppState.status = await API.status(); } catch (_) {}

  const online = s?.primaryEMROnline !== false;

  let historyRows = '<tr class="empty-row"><td colspan="5">No sync history available.</td></tr>';
  try {
    if (s?.lastSyncTime) {
      historyRows = `<tr>
        <td>${fmtDateTime(s.lastSyncTime)}</td>
        <td>${s.lastSyncRecordsCount ?? '—'}</td>
        <td><span class="badge badge-online">${s.lastSyncStatus || 'success'}</span></td>
        <td>${s.lastSyncType || 'manual'}</td>
        <td>Selective sync — admitted patients, allergies, active medications, notes (7d), labs (3d)</td>
      </tr>`;
    }
  } catch (_) {}

  const content = `
    <div class="page-header">
      <div class="page-title">🔄 Sync & Status</div>
      <div class="page-subtitle">Manage synchronisation between the Primary EMR (DB1) and HCPS Backup (DB2)</div>
    </div>

    <div class="sync-status-grid mb-20">
      <div class="sync-status-item">
        <div class="sti-label">Primary EMR (DB1)</div>
        <div class="sti-value"><span class="badge ${online?'badge-online':'badge-offline'}">${online?'● Online':'● Offline'}</span></div>
      </div>
      <div class="sync-status-item">
        <div class="sti-label">HCPS Database (DB2)</div>
        <div class="sti-value"><span class="badge badge-online">● Available</span></div>
      </div>
      <div class="sync-status-item">
        <div class="sti-label">Last Successful Sync</div>
        <div class="sti-value" style="font-size:.88rem">${s?.lastSyncTime ? fmtDateTime(s.lastSyncTime) : 'Never'}</div>
      </div>
      <div class="sync-status-item">
        <div class="sti-label">Records in Last Sync</div>
        <div class="sti-value">${s?.lastSyncRecordsCount ?? '—'}</div>
      </div>
    </div>

    <div class="grid-2 mb-20">
      <div class="card">
        <div class="card-header">
          <div class="card-title">🔄 Manual Synchronisation</div>
        </div>
        <p style="font-size:.85rem;color:var(--text-secondary);margin-bottom:14px">
          Copies the <strong>minimum continuity dataset</strong> from the Primary EMR (DB1) into the
          HCPS Backup Database (DB2). This includes:
        </p>
        <ul style="font-size:.83rem;color:var(--text-secondary);padding-left:18px;margin-bottom:16px;line-height:1.8">
          <li>All active/admitted patients</li>
          <li>All patient allergies (critical safety data)</li>
          <li>Current active medications</li>
          <li>Clinical notes from the last 7 days</li>
          <li>Laboratory results from the last 3 days</li>
          <li>Ward and bed location</li>
        </ul>
        <div class="info-box mb-16">
          <strong>Selective synchronisation:</strong>
          Only the minimum continuity dataset is copied. Historical records,
          administrative data, and billing records are excluded.
          HCPS downtime entries are never overwritten during sync.
        </div>
        ${!online
          ? `<div style="background:var(--danger-bg);border:1px solid #FFCDD2;border-radius:6px;padding:10px 14px;font-size:.83rem;color:var(--danger);margin-bottom:12px">
              <strong>Sync unavailable:</strong> Primary EMR is currently offline. Sync can only be performed when the primary EMR is online.
             </div>`
          : ''}
        <button class="btn btn-primary btn-lg" onclick="handleSync()" ${!online?'disabled':''} style="width:100%;justify-content:center">
          🔄 Run Manual Sync Now
        </button>
      </div>

      <div class="card">
        <div class="card-header">
          <div class="card-title">📊 Sync Configuration</div>
        </div>
        <div style="font-size:.84rem;color:var(--text-secondary)">
          <div style="margin-bottom:12px">
            <strong style="color:var(--text)">Data included in sync:</strong>
            <div style="margin-top:6px;display:flex;flex-direction:column;gap:6px">
              ${[
                ['✅','Active/admitted patients','All demographics and ward location'],
                ['✅','Patient allergies','Complete allergy register (critical safety data)'],
                ['✅','Active medications','Current medication orders only'],
                ['✅','Recent clinical notes','Last 7 days'],
                ['✅','Recent lab results','Last 3 days'],
                ['❌','Discharged patients','Not included in HCPS minimum dataset'],
                ['❌','Historical notes >7d','Not included — downtime window assumption'],
                ['❌','Billing / administrative','Excluded from clinical continuity dataset']
              ].map(([i,l,d]) => `
                <div style="display:flex;gap:8px;padding:6px 10px;background:var(--surface-2);border-radius:4px">
                  <span>${i}</span>
                  <div><strong>${l}</strong><br><span style="font-size:.78rem;color:var(--text-muted)">${d}</span></div>
                </div>`).join('')}
            </div>
          </div>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-header">
        <div class="card-title">📋 Sync History</div>
      </div>
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>Time</th><th>Records Synced</th><th>Status</th><th>Type</th><th>Details</th></tr></thead>
          <tbody>${historyRows}</tbody>
        </table>
      </div>
    </div>`;

  return renderLayout(content);
}

// Trigger a manual sync and refresh the page when it's done.
async function handleSync() {
  const btn = event?.target;
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Syncing…'; }
  try {
    const r = await API.sync();
    showToast(r.message || 'Sync completed successfully', 'success');
    AppState.status = await API.status();
    navigate('sync');
  } catch (err) {
    showToast(`Sync failed: ${err.message}`, 'error');
    if (btn) { btn.disabled = false; btn.textContent = '🔄 Run Manual Sync Now'; }
  }
}

// Downtime controls page — shows current state and the activate/restore button.
async function renderDowntime() {
  let s = AppState.status;
  try { s = AppState.status = await API.status(); } catch (_) {}
  const online = s?.primaryEMROnline !== false;

  const content = `
    <div class="page-header">
      <div class="page-title">⚡ Downtime Controls</div>
      <div class="page-subtitle">Simulate primary EMR downtime and restoration for demonstration purposes</div>
    </div>

    <div class="grid-2 mb-20">
      <div class="card">
        <div class="card-header">
          <div class="card-title"><span class="card-icon">${online?'🟢':'🔴'}</span> Current System State</div>
        </div>
        <div style="text-align:center;padding:20px 0">
          <div style="font-size:3rem;margin-bottom:8px">${online?'🟢':'🔴'}</div>
          <div style="font-size:1.3rem;font-weight:700;color:${online?'var(--success)':'var(--danger)'}">
            ${online ? 'Primary EMR Online' : 'DOWNTIME MODE ACTIVE'}
          </div>
          <div style="font-size:.85rem;color:var(--text-muted);margin-top:6px">
            ${online
              ? 'All requests are being served from the Primary EMR (DB1)'
              : 'All requests are being served from the HCPS Backup Database (DB2)'}
          </div>
          ${!online && s?.downtimeStartTime ? `
            <div style="margin-top:10px;font-size:.82rem;color:var(--danger)">
              Downtime started: ${fmtDateTime(s.downtimeStartTime)}
            </div>` : ''}
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          <div class="card-title">🔧 Controls</div>
        </div>
        ${online ? `
          <div style="margin-bottom:14px">
            <h4 style="font-size:.9rem;margin-bottom:8px;color:var(--text)">Activate Downtime Mode</h4>
            <p style="font-size:.83rem;color:var(--text-secondary);margin-bottom:12px">
              Simulates the primary EMR becoming unavailable. The system will automatically
              switch to serving data from the HCPS backup database (DB2).
              Clinicians will be able to add downtime notes and medication entries.
            </p>
            <div style="background:var(--danger-bg);border:1px solid #FFCDD2;border-radius:6px;padding:10px 14px;font-size:.82rem;color:var(--danger);margin-bottom:14px">
              <strong>⚠ Warning:</strong> This will mark the primary EMR as offline.
              Ensure a sync has been performed before activating downtime.
              ${s?.lastSyncTime ? `Last sync: ${fmtDateTime(s.lastSyncTime)}` : 'No sync has been performed yet.'}
            </div>
            <button class="btn btn-danger btn-lg" onclick="handleDowntimeStart()" style="width:100%;justify-content:center">
              ⚡ Activate Downtime Mode
            </button>
          </div>` : `
          <div style="margin-bottom:14px">
            <h4 style="font-size:.9rem;margin-bottom:8px;color:var(--text)">Restore Primary EMR</h4>
            <p style="font-size:.83rem;color:var(--text-secondary);margin-bottom:12px">
              Marks the primary EMR as restored and online. The system will return to
              serving data from DB1. Any downtime entries added to DB2 will be available
              in the reconciliation queue for review.
            </p>
            <div style="background:var(--success-bg);border:1px solid #A5D6A7;border-radius:6px;padding:10px 14px;font-size:.82rem;color:var(--success);margin-bottom:14px">
              <strong>After restoration:</strong> Review the reconciliation queue to copy
              downtime entries back into the primary EMR.
            </div>
            <button class="btn btn-success btn-lg" onclick="handleDowntimeEnd()" style="width:100%;justify-content:center">
              ✅ Restore Primary EMR
            </button>
          </div>`}
      </div>
    </div>

    <div class="card">
      <div class="card-header">
        <div class="card-title">📖 Downtime Mode Explained</div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px;font-size:.84rem">
        ${[
          ['🔄 Before Downtime', 'Run a manual sync to copy the minimum continuity dataset from DB1 to DB2. This ensures DB2 has current patient information before the EMR goes offline.'],
          ['⚡ During Downtime', 'The system reads all patient data from DB2. Clinicians can view pre-synced records and add downtime notes and medication entries, all stored in DB2 with reconciliation_status = pending.'],
          ['✅ After Restoration', 'The primary EMR comes back online. All downtime entries in DB2 are shown in the reconciliation queue for clinical review.'],
          ['📋 Reconciliation', 'Each downtime entry can be confirmed (copied to DB1) or deferred. Conflict warnings are shown if the primary record was modified after the last sync.']
        ].map(([t,d]) => `
          <div style="background:var(--surface-2);border:1px solid var(--border);border-radius:var(--radius);padding:14px">
            <div style="font-weight:700;margin-bottom:6px">${t}</div>
            <div style="color:var(--text-secondary)">${d}</div>
          </div>`).join('')}
      </div>
    </div>`;

  return renderLayout(content);
}

// Activate downtime — sets the server flag that makes all reads go to DB2.
async function handleDowntimeStart() {
  if (!confirm('Activate downtime mode? The primary EMR will be marked as offline and the system will switch to the HCPS backup database.')) return;
  try {
    const r = await API.startDowntime();
    showToast('Downtime mode activated. Serving from HCPS backup database.', 'warning');
    AppState.status = await API.status();
    navigate('downtime');
  } catch (err) {
    showToast(`Error: ${err.message}`, 'error');
  }
}

// Restore the EMR — flips the flag back, system returns to reading from DB1.
async function handleDowntimeEnd() {
  try {
    const r = await API.endDowntime();
    showToast(r.message || 'Primary EMR restored.', 'success');
    AppState.status = await API.status();
    navigate('downtime');
  } catch (err) {
    showToast(`Error: ${err.message}`, 'error');
  }
}

// Reconciliation queue — lists all downtime entries with Confirm/Defer buttons.
// Entries with a conflict warning had their patient record updated in DB1 after the last sync.
async function renderReconciliation() {
  try {
    const data = await API.reconcile();
    AppState.reconciliation = data;
    const { items, lastSyncTime, totalPending, totalDeferred } = data;

    const rows = items.length === 0
      ? '<tr class="empty-row"><td colspan="7">No items in the reconciliation queue.</td></tr>'
      : items.map(item => `
          <tr>
            <td>
              <strong>${escHtml(item.patient_name)}</strong><br>
              <span style="font-size:.75rem;font-family:var(--font-mono);color:var(--text-muted)">${escHtml(item.mrn)}</span>
            </td>
            <td>
              <span class="badge ${item.entry_type==='clinical_note'?'badge-primary':'badge-info'}">
                ${item.entry_type === 'clinical_note' ? '📝 Clinical Note' : '💊 Medication'}
              </span>
              ${item.entry_subtype ? `<br><span style="font-size:.75rem;color:var(--text-muted)">${escHtml(item.entry_subtype)}</span>` : ''}
            </td>
            <td class="note-text-cell">
              <div class="note-text-preview">${escHtml(item.entry_text || '—')}</div>
              ${item.hasConflict ? `
                <div class="conflict-alert">
                  <span class="ci">⚠</span>
                  <span><strong>Potential conflict:</strong> ${escHtml(item.conflictDetail || 'Primary EMR record was updated after last HCPS sync.')}</span>
                </div>` : ''}
            </td>
            <td>${escHtml(item.author || '—')}</td>
            <td style="white-space:nowrap">${fmtDateTime(item.created_at)}</td>
            <td>
              <span class="badge ${item.reconciliation_status==='pending'?'badge-pending':item.reconciliation_status==='deferred'?'badge-deferred':'badge-reconciled'}">
                ${item.reconciliation_status}
              </span>
            </td>
            <td class="col-actions">
              <div class="btn-group" style="justify-content:flex-end">
                <button class="btn btn-success btn-sm" onclick="handleConfirm(${item.id},'${item.entry_type}')">
                  ✓ Confirm
                </button>
                <button class="btn btn-secondary btn-sm" onclick="handleDefer(${item.id},'${item.entry_type}')">
                  Defer
                </button>
              </div>
            </td>
          </tr>`).join('');

    const content = `
      <div class="page-header">
        <div class="page-title">📋 Reconciliation Queue</div>
        <div class="page-subtitle">Review downtime entries and confirm or defer their transfer back to the Primary EMR (DB1)</div>
      </div>

      <div class="stat-grid mb-20">
        <div class="stat-card amber">
          <div class="stat-label">Pending</div>
          <div class="stat-value amber">${totalPending}</div>
          <div class="stat-meta">Awaiting review</div>
        </div>
        <div class="stat-card blue">
          <div class="stat-label">Deferred</div>
          <div class="stat-value blue">${totalDeferred}</div>
          <div class="stat-meta">Marked for later</div>
        </div>
        <div class="stat-card blue">
          <div class="stat-label">Last Sync Time</div>
          <div class="stat-value" style="font-size:1rem;color:var(--primary)">${lastSyncTime ? fmtDateTime(lastSyncTime) : 'Never'}</div>
          <div class="stat-meta">Reference time for conflict detection</div>
        </div>
      </div>

      ${totalPending > 0 ? `<div class="info-box mb-16">
        <strong>Reconciliation required:</strong>
        ${totalPending} downtime entry/entries need to be reviewed.
        Items marked ⚠ <strong>Potential conflict</strong> indicate that the patient's record
        in the primary EMR was modified after the last HCPS sync — review carefully before confirming.
      </div>` : ''}

      <div class="card">
        <div class="card-header">
          <div class="card-title">📋 Downtime Entries</div>
          <button class="btn btn-secondary btn-sm" onclick="navigate('reconciliation')">↻ Refresh</button>
        </div>
        <div class="table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th>Patient</th>
                <th>Type</th>
                <th>Content / Conflict</th>
                <th>Author</th>
                <th>Created</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </div>

      <div class="card mt-16">
        <div class="card-header">
          <div class="card-title">ℹ️ Reconciliation Process</div>
        </div>
        <div style="font-size:.84rem;color:var(--text-secondary);display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px">
          <div style="background:var(--success-bg);border-radius:6px;padding:12px">
            <strong style="color:var(--success)">✓ Confirm</strong><br>
            Copies the downtime entry from DB2 into the Primary EMR (DB1).
            The entry in DB2 is marked as <em>reconciled</em>.
            Action is recorded in the audit log.
          </div>
          <div style="background:var(--deferred-bg);border-radius:6px;padding:12px">
            <strong style="color:var(--deferred)">Defer</strong><br>
            Keeps the entry in the reconciliation queue for later review.
            The entry remains in DB2 with status <em>deferred</em>.
            Deferred items can still be confirmed at any time.
          </div>
          <div style="background:var(--warning-bg);border-radius:6px;padding:12px">
            <strong style="color:var(--warning)">⚠ Conflict Warning</strong><br>
            Shown when the patient's record in DB1 was modified after the last HCPS sync.
            This is advisory only — the clinician decides how to proceed.
          </div>
        </div>
      </div>`;

    return renderLayout(content);
  } catch (err) {
    return renderLayout(`<div class="card"><p style="color:var(--danger)">Error loading reconciliation queue: ${escHtml(err.message)}</p></div>`);
  }
}

// Confirm reconciliation — copies the downtime entry into DB1 and marks it reconciled in DB2.
async function handleConfirm(id, type) {
  const label = type === 'clinical_note' ? 'clinical note' : 'medication entry';
  if (!confirm(`Confirm reconciliation of this ${label}? It will be copied to the Primary EMR database.`)) return;
  try {
    const r = await API.confirm(id, type);
    showToast(r.message || 'Entry reconciled successfully.', 'success');
    AppState.status = await API.status();
    navigate('reconciliation');
  } catch (err) {
    showToast(`Error: ${err.message}`, 'error');
  }
}

// Defer — keeps the entry in the queue with status 'deferred' for later review.
async function handleDefer(id, type) {
  try {
    const r = await API.defer(id, type);
    showToast(r.message || 'Entry deferred.', 'info');
    navigate('reconciliation');
  } catch (err) {
    showToast(`Error: ${err.message}`, 'error');
  }
}

// Audit log — shows the last 150 entries, colour-coded by action type.
async function renderAuditLog() {
  try {
    const data = await API.auditLog(150);
    AppState.auditLogs = data;
    const { logs, total } = data;

    // Each action type gets a colour-coded badge.
    const actionBadge = (action) => {
      const styles = {
        USER_LOGIN:               'badge-online',
        USER_LOGOUT:              'badge-deferred',
        SYNC_STARTED:             'badge-info',
        SYNC_COMPLETED:           'badge-online',
        SYNC_FAILED:              'badge-offline',
        DOWNTIME_ACTIVATED:       'badge-offline',
        EMR_RESTORED:             'badge-online',
        DOWNTIME_NOTE_ADDED:      'badge-hcps',
        DOWNTIME_MEDICATION_ADDED:'badge-hcps',
        PATIENT_LIST_VIEWED_DOWNTIME:   'badge-warning',
        PATIENT_RECORD_VIEWED_DOWNTIME: 'badge-warning',
        RECONCILIATION_CONFIRMED: 'badge-online',
        RECONCILIATION_DEFERRED:  'badge-deferred'
      };
      return `<span class="badge ${styles[action] || 'badge-primary'}" style="font-size:.7rem">${escHtml(action)}</span>`;
    };

    const rows = logs.length === 0
      ? '<tr class="empty-row"><td colspan="5">No audit log entries found.</td></tr>'
      : logs.map(l => `
          <tr>
            <td style="white-space:nowrap">${fmtDateTime(l.timestamp)}</td>
            <td>${escHtml(l.user || '—')}</td>
            <td>${actionBadge(l.action)}</td>
            <td>${l.patient_id ? `<span style="font-family:var(--font-mono);font-size:.78rem">#${l.patient_id}</span>` : '—'}</td>
            <td style="font-size:.8rem;color:var(--text-secondary)">${escHtml(l.details || '—')}</td>
          </tr>`).join('');

    const content = `
      <div class="page-header">
        <div class="page-title">📜 Audit Log</div>
        <div class="page-subtitle">Complete record of significant system actions. Showing ${logs.length} of ${total} entries.</div>
      </div>
      <div class="card">
        <div class="card-header">
          <div class="card-title">📜 Audit Trail</div>
          <button class="btn btn-secondary btn-sm" onclick="navigate('audit-log')">↻ Refresh</button>
        </div>
        <div class="table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th>Timestamp</th>
                <th>User</th>
                <th>Action</th>
                <th>Patient</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </div>`;

    return renderLayout(content);
  } catch (err) {
    return renderLayout(`<div class="card"><p style="color:var(--danger)">Error loading audit log: ${escHtml(err.message)}</p></div>`);
  }
}

// Scope & Limitations page — academic framing, what the prototype demonstrates and doesn't.
function renderScope() {
  const content = `
    <div class="page-header">
      <div class="page-title">ℹ️ Prototype Scope & Limitations</div>
      <div class="page-subtitle">Academic framing and known limitations of this honours thesis prototype</div>
    </div>

    <div class="card mb-20">
      <div class="card-header">
        <div class="card-title">🎓 Research Context</div>
      </div>
      <div style="font-size:.88rem;color:var(--text-secondary);line-height:1.7">
        <p style="margin-bottom:10px">
          <strong>HCPS (Hybrid Continuity Planning System)</strong> is a proof-of-concept prototype developed
          as part of a Bachelor of Software Engineering honours thesis. It demonstrates core concepts in
          clinical informatics, specifically the management of Electronic Medical Record (EMR) downtime
          in a hospital setting.
        </p>
        <p>
          This system is intended to serve as a functional demonstrator for academic evaluation purposes only.
          It is not connected to any real hospital system, does not contain real patient data,
          and has not undergone clinical validation or security review.
        </p>
      </div>
    </div>

    <div class="grid-2 mb-20">
      <div class="card">
        <div class="scope-section">
          <h3>What This Prototype Demonstrates</h3>
          <ul class="scope-list">
            <li>Dual-database architecture: Primary EMR (DB1) and HCPS Backup (DB2)</li>
            <li>Selective synchronisation of the minimum continuity dataset from DB1 to DB2</li>
            <li>Simulated downtime mode: automatic failover to read from DB2</li>
            <li>Clinician documentation during downtime (notes and medication entries in DB2)</li>
            <li>Post-downtime reconciliation queue with conflict detection</li>
            <li>Comprehensive audit logging of all significant system actions</li>
            <li>Prototype demonstration workflow for academic presentation</li>
          </ul>
        </div>
        <div class="scope-section">
          <h3>Database Architecture</h3>
          <ul class="scope-list">
            <li><strong>DB1 (primary_emr.db):</strong> Simulates a hospital primary EMR. Contains all patient data, updated by clinical staff under normal operations.</li>
            <li><strong>DB2 (hcps_backup.db):</strong> The HCPS backup database. Receives the minimum continuity dataset via selective sync. Stores downtime entries awaiting reconciliation.</li>
            <li>Both databases are SQLite files for simplicity. Production would use enterprise RDBMS (PostgreSQL, Oracle).</li>
          </ul>
        </div>
      </div>

      <div class="card">
        <div class="scope-section">
          <h3>Known Prototype Limitations</h3>
          <ul class="scope-list">
            <li>Authentication is minimal — a single hardcoded credential. No role-based access control.</li>
            <li>All patient data is entirely fictional and generated for demonstration purposes.</li>
            <li>Synchronisation is simulated locally; there is no actual network communication.</li>
            <li>No data encryption at rest or in transit. SQLite files are unencrypted.</li>
            <li>No session timeout or concurrent user management.</li>
            <li>Conflict detection is advisory only — no automated resolution logic.</li>
            <li>No support for FHIR, HL7, or any healthcare interoperability standard.</li>
            <li>ID management between DB1 and DB2 is simplified — a production system would use UUIDs.</li>
            <li>No automated or scheduled synchronisation — manual only.</li>
            <li>No patient privacy controls, consent management, or data masking.</li>
          </ul>
        </div>
      </div>
    </div>

    <div class="card mb-20">
      <div class="card-header">
        <div class="card-title">🏥 Production System Requirements</div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;font-size:.83rem">
        ${[
          ['🔗 Interoperability', 'FHIR R4 / HL7 v2 integration with real EMR systems (Epic, Cerner, etc.)'],
          ['🔐 Security', 'TLS encryption, data encryption at rest, penetration testing, OWASP compliance'],
          ['👥 Access Control', 'Role-based access control (RBAC): clinicians, nurses, administrators, auditors'],
          ['🔒 Privacy', 'Privacy Act 1988 / HIPAA compliance, patient consent management, data masking'],
          ['⚡ Availability', 'High availability architecture, automated failover, 99.99% uptime SLA'],
          ['🤖 Sync', 'Automated scheduled synchronisation with real-time change detection'],
          ['⚖️ Conflict Resolution', 'Clinical workflow-based conflict resolution with prescriber review'],
          ['🧪 Validation', 'Clinical validation, usability testing with real clinicians, IRB approval'],
          ['📊 Monitoring', 'Real-time system health monitoring, alerting, and incident management'],
          ['📝 Governance', 'Formal clinical governance, change management, and staff training programs']
        ].map(([t,d]) => `
          <div style="background:var(--surface-2);border:1px solid var(--border);border-radius:6px;padding:12px">
            <strong style="display:block;margin-bottom:4px">${t}</strong>
            <span style="color:var(--text-secondary)">${d}</span>
          </div>`).join('')}
      </div>
    </div>

    <div class="scope-disclaimer">
      <strong>⚠ Disclaimer</strong>
      This system is a thesis prototype developed for academic demonstration purposes only.
      It is NOT suitable for clinical use, does NOT contain real patient data, and has NOT been
      clinically validated or security tested. All patient names, MRNs, and clinical data displayed
      are entirely fictional. This prototype should not be used in any clinical, research, or
      production environment.
    </div>`;

  return renderLayout(content);
}

// Main render dispatcher — calls the right render function for the current page.
// Redirects to login if there's no token.
async function render() {
  const app = document.getElementById('app');
  if (AppState.page === 'login') {
    app.innerHTML = renderLogin();
    return;
  }
  if (!AppState.token) {
    navigate('login');
    return;
  }

  const loadingPages = ['dashboard','patients','sync','downtime','reconciliation','audit-log'];
  if (loadingPages.includes(AppState.page)) {
    app.innerHTML = renderLayout('<div class="loading"><span class="spinner"></span> Loading…</div>');
  }

  let html = '';
  switch (AppState.page) {
    case 'dashboard':      html = await renderDashboard();      break;
    case 'patients':       html = await renderPatients();       break;
    case 'patient-detail': html = await renderPatientDetail();  break;
    case 'sync':           html = await renderSync();           break;
    case 'downtime':       html = await renderDowntime();       break;
    case 'reconciliation': html = await renderReconciliation(); break;
    case 'audit-log':      html = await renderAuditLog();       break;
    case 'scope':          html = renderScope();                break;
    default:               html = renderLayout('<p>Page not found.</p>');
  }
  app.innerHTML = html;

  if (AppState.page === 'patient-detail') {
    attachPatientTabs();
  }
}

// On page load — check localStorage for a saved token and try to resume the session.
// If the server has restarted (session gone), fall back to the login page.
async function init() {
  const savedToken = localStorage.getItem('hcps_token');
  const savedUser  = localStorage.getItem('hcps_user');
  if (savedToken && savedUser) {
    AppState.token = savedToken;
    try {
      AppState.user   = JSON.parse(savedUser);
      AppState.status = await API.status();
      AppState.page   = 'dashboard';
      startStatusPolling();
    } catch (_) {
      AppState.token = null;
      AppState.user  = null;
      localStorage.removeItem('hcps_token');
      localStorage.removeItem('hcps_user');
      AppState.page = 'login';
    }
  }
  await render();
}

// Expose handler functions globally so inline onclick attributes in the HTML can call them.
window.navigate          = navigate;
window.handleLogin       = handleLogin;
window.handleLogout      = handleLogout;
window.handleSync        = handleSync;
window.handleDowntimeStart = handleDowntimeStart;
window.handleDowntimeEnd   = handleDowntimeEnd;
window.loadPatient       = loadPatient;
window.openAddNoteModal  = openAddNoteModal;
window.openAddMedModal   = openAddMedModal;
window.submitDowntimeNote = submitDowntimeNote;
window.submitDowntimeMed  = submitDowntimeMed;
window.handleConfirm     = handleConfirm;
window.handleDefer       = handleDefer;
window.closeModal        = closeModal;

window.addEventListener('DOMContentLoaded', init);
