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
      maybeConfetti(data.phase);
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

  function renderLobby() {
    return `
      <section class="card">
        <h2>Kampene starter snart!</h2>
        <p>Fire ledertyper møtes i ringen. To kamper. Gjør deg klar til å tippe vinneren.</p>
        <div class="fighter-grid">
          <img src="images/rita_card.png" alt="Rita Relator" />
          <img src="images/morten_card.png" alt="Morten Motivator" />
          <img src="images/petra_card.png" alt="Petra Processor" />
          <img src="images/pal_card.png" alt="Pål Producer" />
        </div>
      </section>
    `;
  }

  function fighterPick(matchId, fighter, isSelected, disabled) {
    return `
      <button class="fighter-pick ${isSelected ? 'selected' : ''}" data-action="pick" data-match="${matchId}" data-pick="${fighter.id}" ${disabled ? 'disabled' : ''} style="border-color:${isSelected ? fighter.color : 'transparent'}">
        <img src="${fighter.photo}" alt="${esc(fighter.name)}" />
        <span class="fighter-name" style="color:${fighter.color}">${esc(fighter.name)}</span>
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
    return `
      <section class="card">
        <p class="match-title">${title}</p>
        <div class="versus">
          ${fighterPick(matchId, match.fighterA, myPick === match.fighterA.id, false)}
          <div class="vs-badge">VS</div>
          ${fighterPick(matchId, match.fighterB, myPick === match.fighterB.id, false)}
        </div>
        <p class="pick-confirm">${myPick ? `Du har tippet ${esc((myPick === match.fighterA.id ? match.fighterA.name : match.fighterB.name))}! Du kan bytte helt til kampen avgjøres.` : 'Trykk på en fighter for å tippe'}</p>
        ${renderTally(match)}
      </section>
    `;
  }

  function renderMatchResult(matchId, title, match, myPick) {
    let verdictClass = 'neutral';
    let verdictText = 'Du rakk ikke å tippe denne kampen.';
    if (myPick) {
      if (myPick === match.winner.id) {
        verdictClass = 'correct';
        verdictText = '✅ Du tippet riktig!';
      } else {
        verdictClass = 'wrong';
        verdictText = '❌ Du tippet feil denne gangen.';
      }
    }
    return `
      <section class="card result-view">
        <p class="eyebrow">Avgjort i runde ${match.decidingRound}</p>
        <h2>🏆 Vinner</h2>
        <img src="${match.winner.photo}" alt="${esc(match.winner.name)}" />
        <p class="result-name" style="color:${match.winner.color}">${esc(match.winner.name)}</p>
        <p class="result-verdict ${verdictClass}">${verdictText}</p>
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
      sections.push(renderRegisterCard());
      APP.innerHTML = sections.join('');
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

    if (btn.dataset.action === 'pick') {
      const matchId = btn.dataset.match;
      const pick = btn.dataset.pick;
      btn.disabled = true;
      try {
        await vote(matchId, pick);
        await fetchState();
      } catch (err) {
        alert(err.message);
        btn.disabled = false;
      }
    }
  });

  document.getElementById('app').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.id === 'name-input') {
      e.preventDefault();
      document.querySelector('[data-action="register"]').click();
    }
  });

  // --- Confetti ---
  const canvas = document.getElementById('confetti-canvas');
  const ctx = canvas.getContext('2d');
  let confettiParticles = [];
  let confettiRAF = null;

  function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  }
  window.addEventListener('resize', resizeCanvas);
  resizeCanvas();

  const CONFETTI_COLORS = ['#f6b9e2', '#f6dd90', '#9db6ce', '#a8c29e', '#ff3b5c', '#ffffff'];

  function fireConfetti() {
    confettiParticles = Array.from({ length: 140 }, () => ({
      x: Math.random() * canvas.width,
      y: -20 - Math.random() * canvas.height * 0.3,
      r: 4 + Math.random() * 5,
      color: CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)],
      vy: 2 + Math.random() * 3,
      vx: -1.5 + Math.random() * 3,
      rot: Math.random() * Math.PI,
      vRot: -0.1 + Math.random() * 0.2,
    }));
    const start = performance.now();
    if (confettiRAF) cancelAnimationFrame(confettiRAF);
    function tick(now) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      confettiParticles.forEach((p) => {
        p.x += p.vx;
        p.y += p.vy;
        p.rot += p.vRot;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.r / 2, -p.r / 2, p.r, p.r * 0.6);
        ctx.restore();
      });
      if (now - start < 3200) {
        confettiRAF = requestAnimationFrame(tick);
      } else {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
    }
    confettiRAF = requestAnimationFrame(tick);
  }

  function maybeConfetti(phase) {
    if (lastPhase === null) return;
    if (phase === lastPhase) return;
    if (phase.endsWith('_result') || phase === 'final') {
      fireConfetti();
    }
  }

  fetchState();
  setInterval(fetchState, POLL_MS);
})();
