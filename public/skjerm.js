(function () {
  const APP = document.getElementById('skjerm-app');
  const POLL_MS = 2000;
  const JOIN_URL = window.location.origin;

  let lastPhase = null;

  function esc(str) {
    return String(str || '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  function pct(part, total) {
    if (!total) return 0;
    return Math.round((part / total) * 100);
  }

  function renderTally(match) {
    const a = match.fighterA;
    const b = match.fighterB;
    const votesA = match.votes[a.id];
    const votesB = match.votes[b.id];
    return `
      <div class="skjerm-tally">
        <div class="skjerm-tally-row">
          <span style="color:${a.color}">${esc(a.name.split(' ')[0])}</span>
          <div class="skjerm-bar-track"><div class="skjerm-bar-fill" style="width:${pct(votesA, match.totalVotes)}%; background:${a.color}"></div></div>
          <span>${pct(votesA, match.totalVotes)}%</span>
        </div>
        <div class="skjerm-tally-row">
          <span style="color:${b.color}">${esc(b.name.split(' ')[0])}</span>
          <div class="skjerm-bar-track"><div class="skjerm-bar-fill" style="width:${pct(votesB, match.totalVotes)}%; background:${b.color}"></div></div>
          <span>${pct(votesB, match.totalVotes)}%</span>
        </div>
        <p class="skjerm-tally-total">${match.totalVotes} stemmer</p>
      </div>
    `;
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
      <p class="skjerm-join">Bli med og tipp på <strong>${esc(JOIN_URL)}</strong></p>
      <p class="skjerm-count">${state.registeredCount} har blitt med så langt</p>
    `;
  }

  function renderMatchOpen(title, match) {
    return `
      <p class="skjerm-eyebrow">${title}</p>
      <div class="skjerm-live-badge"><span class="skjerm-live-dot"></span> TIPPING ÅPEN</div>
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
      <p class="skjerm-join">Tipp på <strong>${esc(JOIN_URL)}</strong></p>
    `;
  }

  function renderMatchResult(title, match) {
    return `
      <p class="skjerm-eyebrow">${title} — avgjort i runde ${match.decidingRound}</p>
      <p class="skjerm-tagline">🏆 VINNER</p>
      <div class="skjerm-result">
        <img src="${match.winner.photo}" alt="${esc(match.winner.name)}" />
      </div>
      <p class="skjerm-winner-name" style="color:${match.winner.color}">${esc(match.winner.name)}</p>
      ${renderTally(match)}
    `;
  }

  function renderFinal(state) {
    if (!state.leaderboard) return `${renderHeader()}<p class="skjerm-tagline">Venter på sluttresultat...</p>`;
    const { rows } = state.leaderboard;
    const topScore = rows.length ? rows[0].correct : 0;
    const list = rows.map((row, i) => {
      const isTop = row.correct === topScore && topScore > 0;
      return `
        <div class="skjerm-lb-row ${isTop ? 'top' : ''}">
          <span class="skjerm-lb-rank">${i + 1}</span>
          <span>${esc(row.name)}</span>
          <span class="skjerm-lb-score">${row.correct}/${row.voted} riktig</span>
        </div>
      `;
    }).join('');
    return `
      <p class="skjerm-eyebrow">🏆 Kveldens gamblere</p>
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

    switch (state.phase) {
      case 'match1_open':
        APP.innerHTML = renderMatchOpen('KAMP 1', state.match1);
        break;
      case 'match1_result':
        APP.innerHTML = renderMatchResult('KAMP 1', state.match1);
        break;
      case 'match2_open':
        APP.innerHTML = renderMatchOpen('KAMP 2', state.match2);
        break;
      case 'match2_result':
        APP.innerHTML = renderMatchResult('KAMP 2', state.match2);
        break;
      case 'final':
        APP.innerHTML = renderFinal(state);
        break;
      case 'lobby':
      default:
        APP.innerHTML = renderLobby(state);
    }
  }

  const confetti = createConfetti(document.getElementById('confetti-canvas'));

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
