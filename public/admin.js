(function () {
  const APP = document.getElementById('admin-app');
  let adminKey = sessionStorage.getItem('adminKey') || '';
  let pollTimer = null;

  const PHASE_INFO = [
    { id: 'lobby', label: 'Lobby', desc: 'Publikum ser fighterne, ingen tipping ennå' },
    { id: 'match1_open', label: 'Åpne Kamp 1', desc: 'Rita Relator vs Pål Producer — tipping åpen' },
    { id: 'match1_result', label: 'Vis resultat Kamp 1', desc: 'Rita Relator vinner i runde 3' },
    { id: 'match2_open', label: 'Åpne Kamp 2', desc: 'Petra Processor vs Morten Motivator — tipping åpen' },
    { id: 'match2_result', label: 'Vis resultat Kamp 2', desc: 'Petra Processor vinner i runde 3' },
    { id: 'final', label: 'Sluttresultat', desc: 'Vis leaderboard for hele kvelden' },
  ];

  function esc(str) {
    return String(str || '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  function renderLogin(errorMsg) {
    APP.innerHTML = `
      <section class="card login-form">
        <h2>Logg inn</h2>
        <p>Skriv admin-passordet for å styre kampkvelden.</p>
        <input id="pw-input" type="password" placeholder="Passord" />
        <button class="btn" id="login-btn">Logg inn</button>
        ${errorMsg ? `<p class="error">${esc(errorMsg)}</p>` : ''}
      </section>
    `;
    document.getElementById('login-btn').addEventListener('click', doLogin);
    document.getElementById('pw-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') doLogin();
    });
  }

  async function doLogin() {
    const pw = document.getElementById('pw-input').value;
    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: pw }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Feil passord');
      adminKey = pw;
      sessionStorage.setItem('adminKey', pw);
      await loadState();
      startPolling();
    } catch (err) {
      renderLogin(err.message);
    }
  }

  async function adminFetch(url, options = {}) {
    const res = await fetch(url, {
      ...options,
      headers: { ...(options.headers || {}), 'x-admin-key': adminKey },
    });
    if (res.status === 401) {
      adminKey = '';
      sessionStorage.removeItem('adminKey');
      stopPolling();
      renderLogin('Sesjonen utløp — logg inn igjen');
      throw new Error('unauthorized');
    }
    return res;
  }

  function renderPanel(data) {
    const phaseButtons = PHASE_INFO.map((p) => `
      <button class="phase-btn ${data.phase === p.id ? 'active' : ''}" data-phase="${p.id}">
        <span>
          ${esc(p.label)}
          <small>${esc(p.desc)}</small>
        </span>
        <span>${data.phase === p.id ? '● LIVE' : '▶'}</span>
      </button>
    `).join('');

    APP.innerHTML = `
      <section class="card">
        <span class="phase-badge">Nåværende fase: ${esc(data.phase)}</span>
        <div class="stat-grid">
          <div class="stat-box"><span class="num">${data.registeredCount}</span><span class="label">påmeldte</span></div>
          <div class="stat-box"><span class="num">${data.match1.totalVotes} / ${data.match2.totalVotes}</span><span class="label">stemmer K1 / K2</span></div>
        </div>
      </section>

      <section class="card">
        <h2>Styring</h2>
        <div class="phase-list">${phaseButtons}</div>
      </section>

      <section class="card">
        <h2>Påmeldte (${data.voters.length})</h2>
        <div class="voter-list">${data.voters.map(esc).join(', ') || 'Ingen ennå'}</div>
      </section>

      <section class="card">
        <h2>Faresone</h2>
        <p>Nullstiller alle påmeldte og all tipping. Kan ikke angres.</p>
        <button class="btn danger-btn" id="reset-btn">Nullstill alt</button>
      </section>
    `;

    APP.querySelectorAll('[data-phase]').forEach((btn) => {
      btn.addEventListener('click', () => setPhase(btn.dataset.phase));
    });
    document.getElementById('reset-btn').addEventListener('click', doReset);
  }

  async function setPhase(phase) {
    try {
      await adminFetch('/api/admin/phase', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phase }),
      });
      await loadState();
    } catch (err) {
      if (err.message !== 'unauthorized') alert(err.message);
    }
  }

  async function doReset() {
    if (!confirm('Sikker på at du vil nullstille alle påmeldte og all tipping?')) return;
    try {
      await adminFetch('/api/admin/reset', { method: 'POST' });
      await loadState();
    } catch (err) {
      if (err.message !== 'unauthorized') alert(err.message);
    }
  }

  async function loadState() {
    if (!adminKey) {
      renderLogin();
      return;
    }
    try {
      const res = await adminFetch('/api/admin/state');
      const data = await res.json();
      renderPanel(data);
    } catch (err) {
      // unauthorized already handled by adminFetch
    }
  }

  function startPolling() {
    if (pollTimer) return;
    pollTimer = setInterval(loadState, 3000);
  }

  function stopPolling() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  if (adminKey) {
    loadState();
    startPolling();
  } else {
    renderLogin();
  }
})();
