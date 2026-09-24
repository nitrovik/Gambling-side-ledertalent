(function () {
  const APP = document.getElementById('skjerm-app');
  const POLL_MS = 2000;
  const JOIN_URL = window.location.origin;

  let lastPhase = null;
  let lastHtml = null;

  function esc(str) {
    return String(str || '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  function pct(part, total) {
    if (!total) return 0;
    return Math.round((part / total) * 100);
  }

  function formatKr(ore) {
    const digits = ore % 100 ? 2 : 0;
    return `${(ore / 100).toLocaleString('nb-NO', { minimumFractionDigits: digits, maximumFractionDigits: 2 })}\u00a0kr`;
  }

  function formatPct(value) {
    return `${value > 0 ? '+' : ''}${value.toLocaleString('nb-NO', { maximumFractionDigits: 1 })}\u00a0%`;
  }

  function howItEnded(result) {
    if (result.method === 'POENG') return 'Seier på poeng etter 3 runder';
    return `${result.methodLabel} i runde ${result.endRound}`;
  }

  function renderTally(match) {
    const a = match.fighterA;
    const b = match.fighterB;
    const byFighter = match.backing.byFighterOre;
    const total = byFighter[a.id] + byFighter[b.id];
    const row = (f) => `
      <div class="skjerm-tally-row">
        <span style="color:${f.color}">${esc(f.name.split(' ')[0])}</span>
        <div class="skjerm-bar-track"><div class="skjerm-bar-fill" style="width:${pct(byFighter[f.id], total)}%; background:${f.color}"></div></div>
        <span>${pct(byFighter[f.id], total)}%</span>
      </div>
    `;
    return `
      <div class="skjerm-tally">
        ${row(a)}
        ${row(b)}
        <p class="skjerm-tally-total">Pengene i salen · ${formatKr(match.backing.totalStakeOre)} satset på ${match.backing.betCount} bonger</p>
      </div>
    `;
  }

  function stageBadge(match) {
    if (match.stage === 'open') {
      return '<div class="skjerm-live-badge open">SPILLET ER ÅPENT</div>';
    }
    return `<div class="skjerm-live-badge"><span class="skjerm-live-dot"></span> ${esc(match.stageLabel.toUpperCase())}</div>`;
  }

  function renderHeader() {
    return `
      <p class="skjerm-eyebrow">Ledertalent presenterer</p>
      <h1 class="skjerm-title">FIGHT NIGHT</h1>
    `;
  }

  const LOBBY_FIGHTERS = [
    { name: 'Rita Relator', photo: 'images/rita_photo.jpg', color: '#f6b9e2' },
    { name: 'Morten Motivator', photo: 'images/morten_photo.jpg', color: '#f6dd90' },
    { name: 'Petra Processor', photo: 'images/petra_photo.jpg', color: '#9db6ce' },
    { name: 'Pål Producer', photo: 'images/pal_photo.jpg', color: '#a8c29e' },
  ];

  function renderLobby(state) {
    const tiles = LOBBY_FIGHTERS.map((f, i) => `
      <div class="skjerm-arena-fighter" style="animation-delay:${(i * 0.15).toFixed(2)}s">
        <div class="skjerm-arena-photo-wrap">
          <div class="skjerm-arena-glow" style="background:${f.color}; animation-delay:${(i * 0.3).toFixed(2)}s"></div>
          <div class="skjerm-arena-frame" style="border-color:${f.color}; animation-delay:${(i * 0.4).toFixed(2)}s">
            <img src="${f.photo}" alt="${esc(f.name)}" />
          </div>
        </div>
        <p class="skjerm-arena-name" style="color:${f.color}">${esc(f.name)}</p>
      </div>
    `).join('');

    return `
      ${renderHeader()}
      <div class="skjerm-ticker">
        <div class="skjerm-ticker-track">
          <span>🥊 FIGHT NIGHT &nbsp;•&nbsp; LEDERTALENT &nbsp;•&nbsp; GAMBL PÅ VINNEREN &nbsp;•&nbsp; </span>
          <span>🥊 FIGHT NIGHT &nbsp;•&nbsp; LEDERTALENT &nbsp;•&nbsp; GAMBL PÅ VINNEREN &nbsp;•&nbsp; </span>
        </div>
      </div>
      <div class="skjerm-arena-grid">${tiles}</div>
      <p class="skjerm-join">Alle får 2 000 kr å spille for – bli med på <strong>${esc(JOIN_URL)}</strong></p>
      <p class="skjerm-count">${state.registeredCount} har blitt med så langt</p>
    `;
  }

  function renderMatchOpen(match) {
    return `
      <p class="skjerm-eyebrow">${esc(match.title)}</p>
      ${stageBadge(match)}
      <div class="skjerm-versus">
        <div class="skjerm-fighter">
          <img src="${match.fighterA.photo}" alt="${esc(match.fighterA.name)}" style="border-color:${match.fighterA.color}" />
          <p class="skjerm-fighter-name" style="color:${match.fighterA.color}">${esc(match.fighterA.name)}</p>
          <p class="skjerm-fighter-type">${esc(match.fighterA.type)}</p>
        </div>
        <p class="skjerm-vs">VS</p>
        <div class="skjerm-fighter">
          <img src="${match.fighterB.photo}" alt="${esc(match.fighterB.name)}" style="border-color:${match.fighterB.color}" />
          <p class="skjerm-fighter-name" style="color:${match.fighterB.color}">${esc(match.fighterB.name)}</p>
          <p class="skjerm-fighter-type">${esc(match.fighterB.type)}</p>
        </div>
      </div>
      ${renderTally(match)}
      <p class="skjerm-join">Spill på <strong>${esc(JOIN_URL)}</strong></p>
    `;
  }

  function renderMatchResult(match) {
    const { result } = match;
    return `
      <p class="skjerm-eyebrow">${esc(match.title)} — ${esc(howItEnded(result))}</p>
      <p class="skjerm-tagline">🏆 VINNER</p>
      <div class="skjerm-result">
        <img src="${result.winner.photo}" alt="${esc(result.winner.name)}" />
      </div>
      <p class="skjerm-winner-name" style="color:${result.winner.color}">${esc(result.winner.name)}</p>
      <div class="skjerm-rounds">
        ${result.rounds.map((r) => `
          <span class="skjerm-round ${r.winner ? '' : 'void'}" ${r.winner ? `style="border-color:${r.winner.color}"` : ''}>
            Runde ${r.round}: ${r.winner ? esc(r.winner.name.split(' ')[0]) : 'ikke gått'}
          </span>
        `).join('')}
      </div>
      ${renderTally(match)}
    `;
  }

  function renderFinal(state) {
    const rows = state.leaderboard;
    const list = rows.map((row) => `
      <div class="skjerm-lb-row ${row.rank === 1 && row.betCount ? 'top' : ''}">
        <span class="skjerm-lb-rank">${row.rank}</span>
        <span class="skjerm-lb-name">${esc(row.name)}</span>
        <span class="skjerm-lb-score">${formatKr(row.balanceOre)}</span>
        <span class="skjerm-lb-net ${row.netOre > 0 ? 'up' : row.netOre < 0 ? 'down' : ''}">${formatPct(row.netPct)}</span>
      </div>
    `).join('');
    return `
      <p class="skjerm-eyebrow">🏆 Kveldens gamblere – høyest saldo vinner</p>
      <h1 class="skjerm-title" style="font-size:clamp(36px, 5vw, 72px)">SLUTTRESULTAT</h1>
      <div class="skjerm-leaderboard">${list || '<p>Ingen har registrert seg ennå.</p>'}</div>
    `;
  }

  function render(state) {
    // The lobby fighter grid is static — re-mounting it every poll would
    // replay its entrance/idle animations from scratch. Just keep the
    // headcount fresh instead of touching the grid.
    if (state.phase === 'lobby' && document.querySelector('.skjerm-arena-grid')) {
      const count = document.querySelector('.skjerm-count');
      if (count) count.textContent = `${state.registeredCount} har blitt med så langt`;
      return;
    }

    const focus = /^(match\d+)_/.exec(state.phase);
    let html;
    if (focus) {
      const match = state.matches[focus[1]];
      html = match.result ? renderMatchResult(match) : renderMatchOpen(match);
    } else if (state.phase === 'final') {
      html = renderFinal(state);
    } else {
      html = renderLobby(state);
    }
    if (html !== lastHtml) {
      APP.innerHTML = html;
      lastHtml = html;
    }
  }

  const confetti = createConfetti(document.getElementById('confetti-canvas'));

  // --- Occasional floating reaction emojis while the lobby is up ---
  const REACTION_EMOJIS = ['🔥', '👊', '💥', '⚡', '😤', '🥊'];
  function spawnReaction() {
    if (document.querySelector('.skjerm-arena-grid')) {
      const el = document.createElement('span');
      el.className = 'reaction-emoji';
      el.textContent = REACTION_EMOJIS[Math.floor(Math.random() * REACTION_EMOJIS.length)];
      el.style.left = `${8 + Math.random() * 84}vw`;
      el.style.bottom = '0px';
      el.style.fontSize = '44px';
      document.body.appendChild(el);
      el.addEventListener('animationend', () => el.remove());
    }
    setTimeout(spawnReaction, 2200 + Math.random() * 1800);
  }
  setTimeout(spawnReaction, 2500);

  function handlePhaseChange(phase) {
    if (lastPhase === null) return;
    if (phase === lastPhase) return;
    if (phase.endsWith('_result') || phase === 'final') {
      confetti.fire(220);
    }
  }

  async function fetchState() {
    try {
      const res = await fetch('/api/state');
      const data = await res.json();
      render(data);
      handlePhaseChange(data.phase);
      lastPhase = data.phase;
    } catch (err) {
      console.error('Klarte ikke å hente status', err);
    }
  }

  fetchState();
  setInterval(fetchState, POLL_MS);
})();
