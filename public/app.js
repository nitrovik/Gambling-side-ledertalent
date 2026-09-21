(function () {
  const APP = document.getElementById('app');
  const POLL_MS = 2500;

  function getVoterId() {
    let id = localStorage.getItem('voterId');
    if (!id) {
      id = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2));
      localStorage.setItem('voterId', id);
    }
    return id;
  }

  const voterId = getVoterId();
  let lastPhase = null;
  let currentState = null;
  const pendingPicks = { match1: null, match2: null };

  function esc(str) {
    return String(str || '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  function pct(part, total) {
    if (!total) return 0;
    return Math.round((part / total) * 100);
  }

  async function fetchState() {
    try {
      const res = await fetch(`/api/state?voterId=${encodeURIComponent(voterId)}`);
      const data = await res.json();
      currentState = data;
      render(data);
      handlePhaseChange(data);
      lastPhase = data.phase;
    } catch (err) {
      console.error('Klarte ikke å hente status', err);
    }
  }

  async function register(name) {
    const res = await fetch('/api/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ voterId, name }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Kunne ikke registrere deg');
    return data;
  }

  async function vote(matchId, pick) {
    const res = await fetch('/api/vote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ voterId, matchId, pick }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Kunne ikke registrere tippingen');
    return data;
  }

  function renderRegisterCard(errorMsg) {
    return `
      <section class="card" id="register-card">
        <h2>Bli med i gamblingen</h2>
        <p>Skriv navnet ditt og gjør deg klar til å tippe vinneren!</p>
        <input id="name-input" placeholder="Navnet ditt" maxlength="40" autocomplete="off" />
        <button class="btn" data-action="register">Sett meg opp! 🥊</button>
        ${errorMsg ? `<p class="error">${esc(errorMsg)}</p>` : ''}
      </section>
    `;
  }

  function renderWelcome(state) {
    return `
      <section class="welcome">
        Du gambler som <strong>${esc(state.voterName)}</strong> · ${state.registeredCount} påmeldt
      </section>
    `;
  }

  const LOBBY_FIGHTERS = [
    { name: 'Rita Relator', photo: 'images/rita_photo.jpg', color: '#f6b9e2' },
    { name: 'Morten Motivator', photo: 'images/morten_photo.jpg', color: '#f6dd90' },
    { name: 'Petra Processor', photo: 'images/petra_photo.jpg', color: '#9db6ce' },
    { name: 'Pål Producer', photo: 'images/pal_photo.jpg', color: '#a8c29e' },
  ];

  function renderLobby() {
    const tiles = LOBBY_FIGHTERS.map((f, i) => `
      <div class="arena-fighter" data-action="punch" data-color="${f.color}" style="animation-delay:${(i * 0.12).toFixed(2)}s">
        <div class="arena-fighter-photo-wrap">
          <div class="arena-fighter-glow" style="background:${f.color}; animation-delay:${(i * 0.3).toFixed(2)}s"></div>
          <div class="arena-fighter-frame" style="border-color:${f.color}; animation-delay:${(i * 0.4).toFixed(2)}s">
            <img src="${f.photo}" alt="${esc(f.name)}" />
          </div>
        </div>
        <p class="arena-fighter-name" style="color:${f.color}">${esc(f.name)}</p>
      </div>
    `).join('');

    return `
      <section class="arena-lobby">
        <div class="arena-ticker">
          <div class="arena-ticker-track">
            <span>🥊 FIGHT NIGHT &nbsp;•&nbsp; LEDERTALENT &nbsp;•&nbsp; GAMBL PÅ VINNEREN &nbsp;•&nbsp; </span>
            <span>🥊 FIGHT NIGHT &nbsp;•&nbsp; LEDERTALENT &nbsp;•&nbsp; GAMBL PÅ VINNEREN &nbsp;•&nbsp; </span>
          </div>
        </div>
        <h2 class="arena-heading">Kampene starter snart</h2>
        <p class="arena-sub">Trykk på en fighter og kjenn på trøkket 👊</p>
        <div class="arena-grid">${tiles}</div>
      </section>
    `;
  }

  function fighterPick(matchId, fighter, isSelected, locked) {
    return `
      <button class="fighter-pick ${isSelected ? 'selected' : ''}" data-action="select" data-match="${matchId}" data-pick="${fighter.id}" ${locked ? 'disabled' : ''} style="border-color:${isSelected ? fighter.color : 'transparent'}">
        <img src="${fighter.photo}" alt="${esc(fighter.name)}" />
        <span class="fighter-name" style="color:${fighter.color}">${esc(fighter.name)}</span>
        <span class="fighter-type-tag">${esc(fighter.type)}</span>
      </button>
    `;
  }

  function renderTally(match) {
    const a = match.fighterA;
    const b = match.fighterB;
    const votesA = match.votes[a.id];
    const votesB = match.votes[b.id];
    return `
      <div class="tally">
        <div class="tally-row">
          <span style="color:${a.color}">${esc(a.name.split(' ')[0])}</span>
          <div class="bar-track"><div class="bar-fill" style="width:${pct(votesA, match.totalVotes)}%; background:${a.color}"></div></div>
          <span>${pct(votesA, match.totalVotes)}%</span>
        </div>
        <div class="tally-row">
          <span style="color:${b.color}">${esc(b.name.split(' ')[0])}</span>
          <div class="bar-track"><div class="bar-fill" style="width:${pct(votesB, match.totalVotes)}%; background:${b.color}"></div></div>
          <span>${pct(votesB, match.totalVotes)}%</span>
        </div>
        <p class="tally-total">${match.totalVotes} stemmer</p>
      </div>
    `;
  }

  function renderMatchOpen(matchId, title, match, myPick) {
    const locked = !!myPick;
    const pending = pendingPicks[matchId];
    const selectedId = locked ? myPick : pending;
    const selectedFighter = selectedId
      ? (selectedId === match.fighterA.id ? match.fighterA : match.fighterB)
      : null;

    let message;
    let messageClass = '';
    if (locked) {
      message = `🔒 Valget ditt er låst: ${esc(selectedFighter.name)}. Dette kan ikke endres.`;
      messageClass = 'locked';
    } else if (pending) {
      message = `Du har valgt ${esc(selectedFighter.name)}. Trykk "Lås svar" for å bekrefte!`;
      messageClass = 'pending';
    } else {
      message = 'Trykk på en fighter for å velge.';
    }

    return `
      <section class="card">
        <p class="match-title">${title}</p>
        <div class="versus">
          ${fighterPick(matchId, match.fighterA, selectedId === match.fighterA.id, locked)}
          <div class="vs-badge">VS</div>
          ${fighterPick(matchId, match.fighterB, selectedId === match.fighterB.id, locked)}
        </div>
        <p class="pick-confirm ${messageClass}">${message}</p>
        ${!locked ? `
          <button class="btn lock-btn" data-action="lock" data-match="${matchId}" ${pending ? '' : 'disabled'}>
            ${pending ? `🔒 Lås svar: ${esc(selectedFighter.name)}` : '🔒 Lås svar'}
          </button>
        ` : ''}
        ${renderTally(match)}
      </section>
    `;
  }

  function verdictFor(match, myPick) {
    if (!myPick) return { className: 'neutral', text: 'Du rakk ikke å tippe denne kampen.' };
    if (myPick === match.winner.id) return { className: 'correct', text: '✅ Du tippet riktig!' };
    return { className: 'wrong', text: '❌ Du tippet feil denne gangen.' };
  }

  function renderMatchResult(matchId, title, match, myPick) {
    const verdict = verdictFor(match, myPick);
    return `
      <section class="card result-view">
        <p class="eyebrow">Avgjort i runde ${match.decidingRound}</p>
        <h2>🏆 Vinner</h2>
        <img src="${match.winner.photo}" alt="${esc(match.winner.name)}" />
        <p class="result-name" style="color:${match.winner.color}">${esc(match.winner.name)}</p>
        <p class="result-verdict ${verdict.className}">${verdict.text}</p>
        ${renderTally(match)}
      </section>
    `;
  }

  function renderFinal(state) {
    if (!state.leaderboard) return '';
    const { rows } = state.leaderboard;
    const topScore = rows.length ? rows[0].correct : 0;
    const list = rows.map((row, i) => {
      const isTop = row.correct === topScore && topScore > 0;
      const isMe = row.voterId === voterId;
      return `
        <div class="leaderboard-row ${isTop ? 'top' : ''} ${isMe ? 'me' : ''}">
          <span class="rank">${i + 1}</span>
          <span>${esc(row.name)}${isMe ? ' <em>(deg)</em>' : ''}</span>
          <span class="score-pill">${row.correct}/${row.voted} riktig</span>
        </div>
      `;
    }).join('');
    return `
      <section class="card final-view">
        <h2>🏆 Kveldens gamblere</h2>
        <p>Sånn tippet salen — gratulerer til dem som gjennomskuet fighterne!</p>
        <div class="leaderboard-list">${list || '<p>Ingen har registrert seg ennå.</p>'}</div>
      </section>
    `;
  }

  function render(state) {
    const sections = [];

    if (!state.registered) {
      // Don't clobber the input while someone is mid-registration: re-render
      // only if the register card isn't already on screen.
      if (!document.getElementById('name-input')) {
        APP.innerHTML = renderRegisterCard();
      }
      return;
    }

    // The lobby is static (no live data to reflect) — re-mounting it every poll
    // would replay its entrance/idle animations from scratch. Just keep the
    // welcome banner's headcount fresh instead of touching the fighter grid.
    if (state.phase === 'lobby' && document.querySelector('.arena-lobby')) {
      const welcome = document.querySelector('.welcome');
      if (welcome) {
        welcome.innerHTML = `Du gambler som <strong>${esc(state.voterName)}</strong> · ${state.registeredCount} påmeldt`;
      }
      return;
    }

    sections.push(renderWelcome(state));

    switch (state.phase) {
      case 'lobby':
        sections.push(renderLobby());
        break;
      case 'match1_open':
        sections.push(renderMatchOpen('match1', 'KAMP 1', state.match1, state.myPicks.match1));
        break;
      case 'match1_result':
        sections.push(renderMatchResult('match1', 'KAMP 1', state.match1, state.myPicks.match1));
        break;
      case 'match2_open':
        sections.push(renderMatchResult('match1', 'KAMP 1 — RESULTAT', state.match1, state.myPicks.match1));
        sections.push(renderMatchOpen('match2', 'KAMP 2', state.match2, state.myPicks.match2));
        break;
      case 'match2_result':
        sections.push(renderMatchResult('match2', 'KAMP 2', state.match2, state.myPicks.match2));
        break;
      case 'final':
        sections.push(renderFinal(state));
        break;
      default:
        sections.push(renderLobby());
    }

    APP.innerHTML = sections.join('');
  }

  APP.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;

    if (btn.dataset.action === 'register') {
      const input = document.getElementById('name-input');
      const name = input ? input.value : '';
      btn.disabled = true;
      try {
        await register(name);
        await fetchState();
      } catch (err) {
        APP.innerHTML = renderRegisterCard(err.message);
      } finally {
        btn.disabled = false;
      }
    }

    if (btn.dataset.action === 'select') {
      const matchId = btn.dataset.match;
      pendingPicks[matchId] = btn.dataset.pick;
      if (currentState) render(currentState);
    }

    if (btn.dataset.action === 'lock') {
      const matchId = btn.dataset.match;
      const pick = pendingPicks[matchId];
      if (!pick) return;
      btn.disabled = true;
      try {
        await vote(matchId, pick);
        await fetchState();
      } catch (err) {
        alert(err.message);
        btn.disabled = false;
      }
    }

    if (btn.dataset.action === 'punch') {
      triggerPunch(btn, btn.dataset.color);
    }
  });

  document.getElementById('app').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.id === 'name-input') {
      e.preventDefault();
      document.querySelector('[data-action="register"]').click();
    }
  });

  const confetti = createConfetti(document.getElementById('confetti-canvas'));

  // --- Tap a fighter in the lobby to throw a punch ---
  const PUNCH_WORDS = ['POW!', 'BOOM!', 'BAM!', 'KO!', 'WHAM!', '🔥', '💥'];

  function triggerPunch(tile, color) {
    const wrap = tile.querySelector('.arena-fighter-photo-wrap');
    const frame = tile.querySelector('.arena-fighter-frame');
    const rect = wrap.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;

    const ring = document.createElement('span');
    ring.className = 'punch-ring';
    ring.style.left = `${cx}px`;
    ring.style.top = `${cy}px`;
    ring.style.borderColor = color;
    document.body.appendChild(ring);
    ring.addEventListener('animationend', () => ring.remove());

    const word = document.createElement('span');
    word.className = 'punch-word';
    word.textContent = PUNCH_WORDS[Math.floor(Math.random() * PUNCH_WORDS.length)];
    word.style.left = `${cx}px`;
    word.style.top = `${cy - 40}px`;
    word.style.color = color;
    document.body.appendChild(word);
    word.addEventListener('animationend', () => word.remove());

    if (frame && frame.animate) {
      frame.animate([
        { transform: 'translateX(0) rotate(0deg)' },
        { transform: 'translateX(-7px) rotate(-3deg)' },
        { transform: 'translateX(6px) rotate(3deg)' },
        { transform: 'translateX(-4px) rotate(-1.5deg)' },
        { transform: 'translateX(2px) rotate(1deg)' },
        { transform: 'translateX(0) rotate(0deg)' },
      ], { duration: 380, easing: 'ease-in-out' });
    }

    confetti.burst(cx, cy, color, 16);
  }

  // --- Occasional floating reaction emojis for extra lobby chaos ---
  const REACTION_EMOJIS = ['🔥', '👊', '💥', '⚡', '😤', '🥊'];
  function spawnReaction() {
    if (document.querySelector('.arena-lobby')) {
      const el = document.createElement('span');
      el.className = 'reaction-emoji';
      el.textContent = REACTION_EMOJIS[Math.floor(Math.random() * REACTION_EMOJIS.length)];
      el.style.left = `${8 + Math.random() * 84}vw`;
      el.style.bottom = '0px';
      document.body.appendChild(el);
      el.addEventListener('animationend', () => el.remove());
    }
    setTimeout(spawnReaction, 2600 + Math.random() * 2200);
  }
  setTimeout(spawnReaction, 3000);

  // --- Announcement overlay (full-screen popup on your phone when a result drops) ---
  const overlay = document.getElementById('announcement-overlay');
  const overlayContent = document.getElementById('announcement-content');

  function showAnnouncement(html) {
    overlayContent.innerHTML = html;
    overlay.hidden = false;
  }

  function hideAnnouncement() {
    overlay.hidden = true;
  }

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay || e.target.closest('[data-action="close-announcement"]')) {
      hideAnnouncement();
    }
  });

  function buildAnnouncementHTML(phase, state) {
    if (!state.registered) return null;

    if (phase === 'match1_result' || phase === 'match2_result') {
      const match = phase === 'match1_result' ? state.match1 : state.match2;
      const myPick = phase === 'match1_result' ? state.myPicks.match1 : state.myPicks.match2;
      const verdict = verdictFor(match, myPick);
      return `
        <p class="announcement-eyebrow">Avgjort i runde ${match.decidingRound}</p>
        <p class="announcement-title">🏆 ${esc(match.winner.name)} vinner!</p>
        <img src="${match.winner.photo}" alt="${esc(match.winner.name)}" />
        <p class="announcement-verdict ${verdict.className}">${verdict.text}</p>
      `;
    }

    if (phase === 'final' && state.leaderboard) {
      const rows = state.leaderboard.rows;
      const myIndex = rows.findIndex((row) => row.voterId === voterId);
      if (myIndex === -1) return null;
      const me = rows[myIndex];
      const topScore = rows.length ? rows[0].correct : 0;
      const isChampion = me.correct === topScore && topScore > 0;
      return `
        <p class="announcement-eyebrow">Kvelden er over</p>
        <p class="announcement-rank">#${myIndex + 1}</p>
        <p class="announcement-title">${esc(me.name)}</p>
        <p class="announcement-verdict ${isChampion ? 'correct' : 'neutral'}">${me.correct}/${me.voted} riktig${isChampion ? ' — du er en av kveldens gamblere! 🏆' : ''}</p>
      `;
    }

    return null;
  }

  function handlePhaseChange(state) {
    if (lastPhase === null) return;
    if (state.phase === lastPhase) return;
    if (state.phase.endsWith('_result') || state.phase === 'final') {
      confetti.fire();
      const html = buildAnnouncementHTML(state.phase, state);
      if (html) showAnnouncement(html);
    }
  }

  fetchState();
  setInterval(fetchState, POLL_MS);
})();
