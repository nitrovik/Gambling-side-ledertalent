(function () {
  const APP = document.getElementById('admin-app');
  let adminKey = sessionStorage.getItem('adminKey') || '';
  let pollTimer = null;
  let lastData = null;
  const renderedHtml = new WeakMap();
  const formMessages = {};
  let betFilter = '';
  let showAllBets = false;
  const BETS_PREVIEW = 25;
  const OUTCOME_ICONS = { pending: '⏳', won: '✅', lost: '❌' };

  const STAGE_BUTTONS = [
    { id: 'open', label: 'Åpent for spill' },
    { id: 'r1', label: 'Runde 1' },
    { id: 'r2', label: 'Runde 2' },
    { id: 'r3', label: 'Runde 3' },
  ];
  const METHODS = [
    { id: 'KO', label: 'KO' },
    { id: 'TKO', label: 'TKO' },
    { id: 'POENG', label: 'Poeng' },
  ];

  function esc(str) {
    return String(str || '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  function byId(id) {
    return document.getElementById(id);
  }

  function formatKr(ore) {
    const digits = ore % 100 ? 2 : 0;
    return `${(ore / 100).toLocaleString('nb-NO', { minimumFractionDigits: digits, maximumFractionDigits: 2 })}\u00a0kr`;
  }

  function formatOdds(odds) {
    return odds.toFixed(2).replace('.', ',');
  }

  function formatTime(ts) {
    return new Date(ts).toLocaleTimeString('nb-NO', { hour: '2-digit', minute: '2-digit' });
  }

  function pct(part, total) {
    if (!total) return 0;
    return Math.round((part / total) * 100);
  }

  // Forms keep what the admin is typing: they are only redrawn when untouched
  // and not focused, or when forced after a save.
  function patch(el, html, { form = false, force = false } = {}) {
    if (!el) return false;
    if (form && !force && (el.dataset.dirty === '1' || el.contains(document.activeElement))) return false;
    if (!force && renderedHtml.get(el) === html) return false;
    renderedHtml.set(el, html);
    el.innerHTML = html;
    el.dataset.dirty = '';
    return true;
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
    byId('login-btn').addEventListener('click', doLogin);
    byId('pw-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') doLogin();
    });
  }

  async function doLogin() {
    const pw = byId('pw-input').value;
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

  async function adminPost(url, body) {
    const res = await adminFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Noe gikk galt');
    return data;
  }

  function ensureShell(data) {
    if (byId('admin-status')) return;
    APP.innerHTML = `
      <section class="card" id="admin-status"></section>
      <section class="card">
        <h2>Styring</h2>
        <p class="muted small">Bestemmer hva storskjermen og mobilene viser. Å lagre et resultat mens kampen er i fokus går automatisk videre til avsløringen.</p>
        <div class="phase-list" id="admin-phases"></div>
      </section>
      ${data.matches.map((m) => `
        <section class="card match-admin">
          <div id="admin-${m.id}-head"></div>
          <h3 class="admin-sub">Hva salen har spilt på</h3>
          <div id="admin-${m.id}-stats"></div>
          <details class="odds-details">
            <summary>Odds for ${esc(m.title)}</summary>
            <div id="admin-${m.id}-odds"></div>
          </details>
          <h3 class="admin-sub">Resultat</h3>
          <div id="admin-${m.id}-result"></div>
        </section>
      `).join('')}
      <section class="card">
        <h2>Toppliste</h2>
        <div id="admin-leaderboard"></div>
      </section>
      <section class="card">
        <h2>Alle bonger</h2>
        <input id="bet-filter" type="search" placeholder="Søk på navn …" autocomplete="off" />
        <div id="admin-bets"></div>
      </section>
      <section class="card">
        <h2>Påmeldte</h2>
        <div id="admin-voters"></div>
      </section>
      <section class="card qr-card">
        <h2>QR-kode til publikum</h2>
        <p>Vises automatisk på storskjermen i lobbyen og mens spillet er åpent. Last den ned hvis du vil ha den på en slide.</p>
        <img class="qr-preview" src="qr.svg" alt="QR-kode til Fight Night" />
        <p class="qr-url">${esc(window.location.origin)}</p>
        <div class="form-actions">
          <a class="btn" href="qr.png?download=1">Last ned PNG</a>
          <a class="btn ghost-btn" href="qr.svg?download=1">Last ned SVG</a>
        </div>
      </section>
      <section class="card">
        <h2>Faresone</h2>
        <p>Nullstiller alle påmeldte, bonger, odds og resultater. Kan ikke angres.</p>
        <button class="btn danger-btn" data-action="reset">Nullstill alt</button>
      </section>
    `;
  }

  function phaseLabel(data, id) {
    if (id === 'lobby') return { label: 'Lobby', desc: 'Fighterne vises – publikum registrerer seg og kan spille' };
    if (id === 'final') return { label: 'Sluttresultat', desc: 'Toppliste – høyest saldo vinner leken (krever alle resultater)' };
    const [, matchId, kind] = /^(match\d+)_(open|result)$/.exec(id);
    const m = data.matches.find((x) => x.id === matchId);
    if (kind === 'open') return { label: `${m.title} i fokus`, desc: `${m.fighterA.name} vs ${m.fighterB.name}` };
    return { label: `Vis resultat ${m.title}`, desc: m.result ? m.result.summary : 'Krever at resultatet er registrert' };
  }

  function renderStatus(data) {
    const { totals } = data;
    return `
      <span class="phase-badge">Nåværende fase: ${esc(phaseLabel(data, data.phase).label)}</span>
      <div class="stat-grid four">
        <div class="stat-box"><span class="num">${data.registeredCount}</span><span class="label">påmeldte</span></div>
        <div class="stat-box"><span class="num">${totals.bets}</span><span class="label">bonger (${totals.openBets} aktive)</span></div>
        <div class="stat-box"><span class="num">${formatKr(totals.stakeOre)}</span><span class="label">satset</span></div>
        <div class="stat-box"><span class="num">${formatKr(totals.paidOutOre)}</span><span class="label">utbetalt</span></div>
      </div>
    `;
  }

  function renderPhases(data) {
    return data.phases.map((id) => {
      const info = phaseLabel(data, id);
      return `
        <button class="phase-btn ${data.phase === id ? 'active' : ''}" data-action="phase" data-phase="${id}">
          <span>${esc(info.label)}<small>${esc(info.desc)}</small></span>
          <span>${data.phase === id ? '● LIVE' : '▶'}</span>
        </button>
      `;
    }).join('');
  }

  function renderMatchHead(m) {
    const byFighter = m.backing.byFighterOre;
    const backed = byFighter[m.fighterA.id] + byFighter[m.fighterB.id];
    return `
      <div class="match-admin-head">
        <h2>${esc(m.title)}: <span style="color:${m.fighterA.color}">${esc(m.fighterA.name)}</span> vs <span style="color:${m.fighterB.color}">${esc(m.fighterB.name)}</span></h2>
      </div>
      <p class="match-stats">
        ${m.backing.betCount} ${m.backing.betCount === 1 ? 'bong' : 'bonger'} · ${formatKr(m.backing.totalStakeOre)} satset ·
        ${esc(m.fighterA.name.split(' ')[0])} ${pct(byFighter[m.fighterA.id], backed)} % / ${esc(m.fighterB.name.split(' ')[0])} ${pct(byFighter[m.fighterB.id], backed)} % av pengene på vinneren
      </p>
      <h3 class="admin-sub">Kampforløp</h3>
      <div class="stage-buttons">
        ${STAGE_BUTTONS.map((s) => `
          <button class="stage-btn ${m.stage === s.id ? 'active' : ''}" data-action="stage" data-match="${m.id}" data-stage="${s.id}">${s.label}</button>
        `).join('')}
      </div>
      ${m.stage === 'done'
        ? '<p class="closed-note">🔒 Kampen er avgjort og stengt for spill for godt. Å rette eller fjerne resultatet åpner den ikke igjen.</p>'
        : '<p class="muted small">Spillet på kampen stenger når du trykker «Runde 1». Når resultatet lagres, stenger kampen for godt.</p>'}
    `;
  }

  function currentProfileKey(m) {
    return m.oddsConfig.profile === 'favorite' ? `fav:${m.oddsConfig.favorite}` : m.oddsConfig.profile;
  }

  // Save confirmations fade out on a later poll so they don't linger as stale news.
  function formMessage(key) {
    const msg = formMessages[key];
    if (!msg || Date.now() - msg.at > 12000) return '';
    return `<p class="form-msg ${msg.type}">${esc(msg.text)}</p>`;
  }

  function renderOddsForm(m) {
    const profileKey = currentProfileKey(m);
    const base = m.profileOdds[profileKey];
    const overrides = m.oddsConfig.overrides || {};
    const option = (value, label) => `<option value="${value}" ${profileKey === value ? 'selected' : ''}>${esc(label)}</option>`;
    return `
      <form data-form="odds" data-match="${m.id}">
        <label class="field">Oddsprofil
          <select name="profile">
            ${option('standard', `Kveldens odds (${m.fighterA.name.split(' ')[0]} ${formatOdds(m.profileOdds.standard[`${m.id}:winner:${m.fighterA.id}`])} / ${m.fighterB.name.split(' ')[0]} ${formatOdds(m.profileOdds.standard[`${m.id}:winner:${m.fighterB.id}`])})`)}
            ${option('even', 'Jevn kamp (50/50)')}
            ${option(`fav:${m.fighterA.id}`, `Favoritt: ${m.fighterA.name} (60/40)`)}
            ${option(`fav:${m.fighterB.id}`, `Favoritt: ${m.fighterB.name} (60/40)`)}
          </select>
        </label>
        <table class="odds-table">
          <thead><tr><th>Valg</th><th>Profil</th><th>Overstyr</th><th>Nå</th></tr></thead>
          <tbody>
            ${m.markets.map((market) => `
              <tr class="group"><td colspan="4">${esc(market.label)}</td></tr>
              ${market.selections.map((sel) => `
                <tr>
                  <td>${esc(sel.label)}</td>
                  <td class="base-odds" data-key="${esc(sel.key)}">${formatOdds(base[sel.key])}</td>
                  <td><input class="odds-input" data-key="${esc(sel.key)}" inputmode="decimal" placeholder="${formatOdds(base[sel.key])}" value="${overrides[sel.key] ? formatOdds(overrides[sel.key]) : ''}" /></td>
                  <td class="${overrides[sel.key] ? 'overridden' : ''}">${formatOdds(sel.odds)}</td>
                </tr>
              `).join('')}
            `).join('')}
          </tbody>
        </table>
        <p class="muted small">La et felt stå tomt for å bruke profilens odds. Endringer gjelder bare nye bonger – leverte bonger beholder oddsen de fikk.</p>
        <div class="form-actions">
          <button class="btn" type="submit">Lagre odds</button>
          <button class="btn ghost-btn" type="button" data-action="clear-overrides" data-match="${m.id}">Tøm overstyringer</button>
          <button class="btn ghost-btn" type="button" data-action="discard" data-match="${m.id}" data-form-kind="odds">Angre</button>
        </div>
        ${formMessage(`odds:${m.id}`)}
      </form>
    `;
  }

  function renderResultForm(m) {
    const r = m.rawResult;
    const fighterOptions = (selected) => `<option value="">Velg …</option>${m.fighters.map((f) => `
      <option value="${f.id}" ${selected === f.id ? 'selected' : ''}>${esc(f.name)}</option>
    `).join('')}`;
    return `
      <form data-form="result" data-match="${m.id}">
        <p class="result-current ${r ? 'set' : ''}">${r ? `✅ Registrert: ${esc(m.result.summary)}` : 'Ingen resultat registrert ennå.'}</p>
        <div class="form-grid two">
          <label class="field">Kampvinner<select name="winner">${fighterOptions(r && r.winner)}</select></label>
          <label class="field">Avgjort på<select name="method">
            <option value="">Velg …</option>
            ${METHODS.map((x) => `<option value="${x.id}" ${r && r.method === x.id ? 'selected' : ''}>${x.label}</option>`).join('')}
          </select></label>
        </div>
        <p class="muted small">Kampen går alltid 3 runder og avgjøres i runde 3.</p>
        <div class="form-actions">
          <button class="btn" type="submit">${r ? 'Lagre rettet resultat' : 'Lagre resultat og avgjør bonger'}</button>
          ${r ? `<button class="btn danger-btn" type="button" data-action="clear-result" data-match="${m.id}">Fjern resultat</button>` : ''}
          <button class="btn ghost-btn" type="button" data-action="discard" data-match="${m.id}" data-form-kind="result">Angre</button>
        </div>
        ${formMessage(`result:${m.id}`)}
      </form>
    `;
  }

  function renderLeaderboard(rows) {
    if (!rows.length) return '<p class="muted">Ingen påmeldte ennå.</p>';
    return `
      <div class="table-wrap">
        <table class="admin-table">
          <thead><tr><th>#</th><th>Navn</th><th>Saldo</th><th>I spill</th><th>Avkastning</th><th>Bonger</th><th>Treff</th><th>Største gevinst</th></tr></thead>
          <tbody>
            ${rows.map((row) => `
              <tr>
                <td>${row.rank}</td>
                <td>${esc(row.name)}${row.debtOre ? ` <span class="warn">(gjeld ${formatKr(row.debtOre)})</span>` : ''}</td>
                <td>${formatKr(row.balanceOre)}</td>
                <td>${row.openStakeOre ? formatKr(row.openStakeOre) : '–'}</td>
                <td class="${row.netOre > 0 ? 'up' : row.netOre < 0 ? 'down' : ''}">${row.netOre > 0 ? '+' : ''}${formatKr(row.netOre)} (${row.netPct} %)</td>
                <td>${row.betCount}</td>
                <td>${row.hitRatePct === null ? '–' : `${row.hitRatePct} %`}</td>
                <td>${row.biggestWinOre ? formatKr(row.biggestWinOre) : '–'}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  function isWinningPick(result, marketId, sel) {
    if (!result) return false;
    if (marketId === 'winner') return sel.fighter === result.winner;
    return sel.fighter === result.winner && sel.method === result.method;
  }

  // Every pick in the match with how many bets include it and the money on them.
  function renderMarketStats(m) {
    if (!m.backing.betCount) return '<p class="muted small">Ingen har spilt på kampen ennå.</p>';
    const fighter = (id) => m.fighters.find((f) => f.id === id);
    return `
      <div class="market-stats">
        ${m.markets.map((market) => {
          const total = market.selections.reduce((sum, sel) => sum + sel.stakeOre, 0);
          return `
            <div class="market-stat">
              <p class="market-stat-title">${esc(market.label)}${market.open ? '' : ' 🔒'}</p>
              ${market.selections.map((sel) => {
                const f = fighter(sel.fighter);
                const name = market.id === 'method' ? `${f.name.split(' ')[0]} på ${sel.short}` : f.name;
                const won = isWinningPick(m.rawResult, market.id, sel);
                return `
                  <div class="stat-row ${won ? 'won' : ''}">
                    <span class="stat-label">${won ? '✅ ' : ''}${esc(name)} <small>${formatOdds(sel.odds)}</small></span>
                    <span class="stat-bar"><span style="width:${pct(sel.stakeOre, total)}%; background:${f.color}"></span></span>
                    <span class="stat-num">${sel.betCount
                      ? `${formatKr(sel.stakeOre)}<small>${sel.betCount} ${sel.betCount === 1 ? 'bong' : 'bonger'}</small>`
                      : '–'}</span>
                  </div>
                `;
              }).join('')}
            </div>
          `;
        }).join('')}
      </div>
      <p class="muted small">Antall bonger med valget og samlet innsats på dem. En kombinasjon teller med på hvert av valgene sine.</p>
    `;
  }

  function renderBetRow(bet) {
    let status = '<span class="bet-row-status lost">Tapt</span>';
    if (bet.status === 'open') status = `<span class="bet-row-status open">Aktiv · mulig ${formatKr(bet.potentialPayoutOre)}</span>`;
    if (bet.status === 'won') status = `<span class="bet-row-status won">Vunnet ${formatKr(bet.payoutOre)}</span>`;
    return `
      <div class="bet-row status-${bet.status}">
        <div class="bet-row-head">
          <strong>${esc(bet.name)}</strong>
          <span class="muted">${formatTime(bet.placedAt)} · ${bet.type === 'combo' ? `Kombinasjon · ${bet.selections.length} valg` : 'Singel'}</span>
          ${status}
        </div>
        <ul class="bet-row-sels">
          ${bet.selections.map((sel) => `
            <li><span>${OUTCOME_ICONS[sel.outcome]} ${esc(sel.matchTitle)} · ${esc(sel.label)}</span><span>${formatOdds(sel.odds)}</span></li>
          `).join('')}
        </ul>
        <p class="bet-row-foot">Innsats ${formatKr(bet.stakeOre)} · odds ${formatOdds(bet.totalOdds)}</p>
      </div>
    `;
  }

  function renderBetsList(bets) {
    if (!bets.length) return '<p class="muted">Ingen bonger levert ennå.</p>';
    const query = betFilter.trim().toLowerCase();
    const matching = query ? bets.filter((bet) => bet.name.toLowerCase().includes(query)) : bets;
    if (!matching.length) return `<p class="muted">Ingen bonger fra «${esc(betFilter.trim())}».</p>`;
    const shown = showAllBets ? matching : matching.slice(0, BETS_PREVIEW);
    const open = matching.filter((bet) => bet.status === 'open').length;
    return `
      <p class="muted small">${matching.length} bonger · ${open} aktive · nyeste først</p>
      <div class="bet-rows">${shown.map(renderBetRow).join('')}</div>
      ${matching.length > shown.length ? `<button class="btn ghost-btn" data-action="show-all-bets">Vis alle ${matching.length} bonger</button>` : ''}
    `;
  }

  function renderPanel(data, { forceForms = [] } = {}) {
    lastData = data;
    ensureShell(data);
    patch(byId('admin-status'), renderStatus(data));
    patch(byId('admin-phases'), renderPhases(data));
    data.matches.forEach((m) => {
      patch(byId(`admin-${m.id}-head`), renderMatchHead(m));
      patch(byId(`admin-${m.id}-stats`), renderMarketStats(m));
      patch(byId(`admin-${m.id}-odds`), renderOddsForm(m), { form: true, force: forceForms.includes(`odds:${m.id}`) });
      patch(byId(`admin-${m.id}-result`), renderResultForm(m), { form: true, force: forceForms.includes(`result:${m.id}`) });
    });
    patch(byId('admin-leaderboard'), renderLeaderboard(data.leaderboard));
    patch(byId('admin-bets'), renderBetsList(data.bets));
    patch(byId('admin-voters'), `<div class="voter-list">${data.voters.map(esc).join(', ') || 'Ingen ennå'}</div>`);
  }

  async function loadState(options) {
    if (!adminKey) {
      renderLogin();
      return;
    }
    try {
      const res = await adminFetch('/api/admin/state');
      const data = await res.json();
      renderPanel(data, options);
    } catch (err) {
      // unauthorized already handled by adminFetch
    }
  }

  function report(err) {
    if (err.message !== 'unauthorized') alert(err.message);
  }

  async function saveOdds(form) {
    const matchId = form.dataset.match;
    const profileValue = form.elements.profile.value;
    const overrides = {};
    form.querySelectorAll('.odds-input').forEach((input) => {
      if (input.value.trim()) overrides[input.dataset.key] = input.value.trim();
    });
    const body = profileValue.startsWith('fav:')
      ? { profile: 'favorite', favorite: profileValue.slice(4), overrides }
      : { profile: profileValue, overrides };
    const key = `odds:${matchId}`;
    try {
      await adminPost(`/api/admin/matches/${matchId}/odds`, body);
      formMessages[key] = { type: 'ok', text: 'Oddsen er lagret og gjelder for nye bonger.', at: Date.now() };
      await loadState({ forceForms: [key] });
    } catch (err) {
      if (err.message === 'unauthorized') return;
      const msg = form.querySelector('.form-msg') || form.appendChild(document.createElement('p'));
      msg.className = 'form-msg error';
      msg.textContent = err.message;
    }
  }

  async function saveResult(form, result) {
    const matchId = form.dataset.match;
    const key = `result:${matchId}`;
    try {
      const data = await adminPost(`/api/admin/matches/${matchId}/result`, { result });
      const parts = [result ? 'Resultatet er lagret.' : 'Resultatet er fjernet – bongene er åpne igjen.'];
      parts.push(`${data.changedBets} ${data.changedBets === 1 ? 'bong' : 'bonger'} fikk nytt utfall.`);
      if (data.votersWithDebt) {
        parts.push(`${data.votersWithDebt} deltaker(e) hadde allerede brukt gevinsten – differansen trekkes fra neste gevinst.`);
      }
      formMessages[key] = { type: 'ok', text: parts.join(' '), at: Date.now() };
      await loadState({ forceForms: [key] });
    } catch (err) {
      if (err.message === 'unauthorized') return;
      const msg = form.querySelector('.form-msg') || form.appendChild(document.createElement('p'));
      msg.className = 'form-msg error';
      msg.textContent = err.message;
    }
  }

  function readResultForm(form) {
    const el = form.elements;
    return { winner: el.winner.value, method: el.method.value };
  }

  APP.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn || !lastData) return;
    const { action, match: matchId } = btn.dataset;

    if (action === 'show-all-bets') {
      showAllBets = true;
      patch(byId('admin-bets'), renderBetsList(lastData.bets));
      return;
    }

    try {
      if (action === 'phase') {
        await adminPost('/api/admin/phase', { phase: btn.dataset.phase });
        await loadState();
      }
      if (action === 'stage') {
        const match = lastData.matches.find((m) => m.id === matchId);
        const reopen = match.stage === 'done';
        if (reopen && !confirm(`${match.title} er avgjort. Vil du virkelig åpne for spill igjen? Alle som har sett resultatet kan da spille på det.`)) return;
        await adminPost(`/api/admin/matches/${matchId}/stage`, { stage: btn.dataset.stage, reopen });
        await loadState();
      }
      if (action === 'clear-overrides') {
        const form = btn.closest('form');
        form.querySelectorAll('.odds-input').forEach((input) => { input.value = ''; });
        form.parentElement.dataset.dirty = '1';
      }
      if (action === 'discard') {
        delete formMessages[`${btn.dataset.formKind}:${matchId}`];
        await loadState({ forceForms: [`${btn.dataset.formKind}:${matchId}`] });
      }
      if (action === 'clear-result') {
        if (!confirm('Fjerne resultatet? Alle bonger på kampen blir åpne igjen og gevinster trekkes tilbake.')) return;
        await saveResult(btn.closest('form'), null);
      }
      if (action === 'reset') {
        if (!confirm('Sikker på at du vil nullstille alle påmeldte, bonger, odds og resultater?')) return;
        await adminPost('/api/admin/reset');
        Object.keys(formMessages).forEach((k) => delete formMessages[k]);
        await loadState({ forceForms: lastData.matches.flatMap((m) => [`odds:${m.id}`, `result:${m.id}`]) });
      }
    } catch (err) {
      report(err);
    }
  });

  APP.addEventListener('submit', async (e) => {
    const form = e.target.closest('form[data-form]');
    if (!form) return;
    e.preventDefault();
    if (form.dataset.form === 'odds') {
      await saveOdds(form);
      return;
    }
    const result = readResultForm(form);
    const match = lastData.matches.find((m) => m.id === form.dataset.match);
    const winner = match.fighters.find((f) => f.id === result.winner);
    const method = METHODS.find((x) => x.id === result.method);
    const description = winner && method
      ? `${winner.name} vant på ${result.method === 'POENG' ? 'poeng' : `${method.label} i runde 3`}`
      : 'resultatet';
    const question = match.rawResult
      ? `Rette resultatet til «${description}»? Alle bonger på kampen avgjøres på nytt.`
      : `Lagre «${description}»? Bongene avgjøres med en gang${lastData.phase === `${match.id}_open` ? ' og resultatet vises på storskjermen' : ''}.`;
    if (!confirm(question)) return;
    await saveResult(form, result);
  });

  function markDirty(e) {
    const form = e.target.closest('form[data-form]');
    if (!form) return;
    form.parentElement.dataset.dirty = '1';
    delete formMessages[`${form.dataset.form}:${form.dataset.match}`];
    if (form.dataset.form === 'odds' && e.target.name === 'profile' && lastData) {
      const match = lastData.matches.find((m) => m.id === form.dataset.match);
      const base = match.profileOdds[e.target.value];
      form.querySelectorAll('.base-odds').forEach((cell) => { cell.textContent = formatOdds(base[cell.dataset.key]); });
      form.querySelectorAll('.odds-input').forEach((input) => { input.placeholder = formatOdds(base[input.dataset.key]); });
    }
  }
  APP.addEventListener('input', markDirty);
  APP.addEventListener('input', (e) => {
    if (e.target.id !== 'bet-filter' || !lastData) return;
    betFilter = e.target.value;
    patch(byId('admin-bets'), renderBetsList(lastData.bets));
  });
  APP.addEventListener('change', markDirty);

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
