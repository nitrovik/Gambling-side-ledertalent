(function () {
  const APP = document.getElementById('app');
  const POLL_MS = 2500;
  const TABS = [
    { id: 'arena', label: 'Arena' },
    { id: 'spill', label: 'Spill' },
    { id: 'bonger', label: 'Bonger' },
    { id: 'toppliste', label: 'Toppliste' },
  ];
  const QUICK_STAKES_KR = [50, 100, 250];
  const OUTCOME_ICONS = { pending: '⏳', won: '✅', lost: '❌', void: '↩️' };
  const BET_STATUS = {
    open: 'Aktiv',
    won: 'Vunnet',
    lost: 'Tapt',
    void: 'Annullert – innsatsen tilbake',
  };

  function newId() {
    return crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2);
  }

  function getVoterId() {
    let id = localStorage.getItem('voterId');
    if (!id) {
      id = newId();
      localStorage.setItem('voterId', id);
    }
    return id;
  }

  const voterId = getVoterId();
  let lastPhase = null;
  let currentState = null;
  let activeTab = 'arena';
  const slip = { keys: [], stakeText: '', clientBetId: newId(), notice: null, submitting: false };
  const renderedHtml = new WeakMap();

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

  function formatSignedKr(ore) {
    if (!ore) return formatKr(0);
    return `${ore > 0 ? '+' : '−'}${formatKr(Math.abs(ore))}`;
  }

  function formatOdds(odds) {
    return odds.toLocaleString('nb-NO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function formatPct(value) {
    return `${value > 0 ? '+' : ''}${value.toLocaleString('nb-NO', { maximumFractionDigits: 1 })}\u00a0%`;
  }

  function parseStakeOre(text) {
    const cleaned = String(text || '').replace(/\s/g, '').replace(',', '.');
    if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
    return Math.round(parseFloat(cleaned) * 100);
  }

  // Only touch the DOM when the markup actually changed, so polling never
  // restarts animations or wipes what someone is typing.
  function patch(el, html) {
    if (!el || renderedHtml.get(el) === html) return;
    renderedHtml.set(el, html);
    el.innerHTML = html;
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

  function focusMatchId(phase) {
    const match = /^(match\d+)_/.exec(phase);
    return match ? match[1] : null;
  }

  function selectionIndex(state) {
    const index = {};
    state.matchOrder.forEach((id) => {
      const match = state.matches[id];
      match.markets.forEach((market) => {
        market.selections.forEach((sel) => {
          const fighter = sel.fighter === match.fighterA.id ? match.fighterA : match.fighterB;
          index[sel.key] = { ...sel, market, match, color: fighter.color };
        });
      });
    });
    return index;
  }

  // --- Bet slip ---

  function slipStatus(state) {
    const index = selectionIndex(state);
    const items = slip.keys.map((key) => index[key]).filter(Boolean);
    const odds = items.reduce((product, item) => product * item.odds, 1);
    const locked = items.some((item) => !item.market.open);
    const stakeOre = parseStakeOre(slip.stakeText);
    const balanceOre = state.wallet.balanceOre;
    let error = null;
    if (locked) error = 'Et av valgene er låst – fjern det fra bongen';
    else if (slip.stakeText.trim() && stakeOre === null) error = 'Skriv inn et gyldig beløp';
    else if (stakeOre !== null && stakeOre < state.limits.minStakeOre) error = `Minsteinnsats er ${formatKr(state.limits.minStakeOre)}`;
    else if (stakeOre !== null && stakeOre > balanceOre) error = `Du har bare ${formatKr(balanceOre)} på saldoen`;
    return {
      items,
      odds,
      stakeOre,
      error,
      payoutOre: stakeOre !== null ? Math.round(stakeOre * odds) : null,
      valid: items.length > 0 && !error && stakeOre !== null,
    };
  }

  function sameMatchClash(existingKey, key) {
    const [matchId, market] = key.split(':');
    const [otherMatch, otherMarket] = existingKey.split(':');
    if (otherMatch !== matchId) return false;
    if (otherMarket === market) return true;
    return (market === 'winner' && otherMarket === 'method') || (market === 'method' && otherMarket === 'winner');
  }

  function toggleSelection(key) {
    slip.notice = null;
    if (slip.keys.includes(key)) {
      slip.keys = slip.keys.filter((k) => k !== key);
    } else {
      const market = key.split(':')[1];
      const replaced = slip.keys.filter((k) => sameMatchClash(k, key));
      slip.keys = slip.keys.filter((k) => !sameMatchClash(k, key)).concat(key);
      if (replaced.some((k) => k.split(':')[1] !== market)) {
        slip.notice = {
          type: 'info',
          text: 'Kampvinner og vinnermetode i samme kamp kan ikke kombineres – det forrige valget ble byttet ut.',
        };
      }
    }
    slip.clientBetId = newId();
  }

  async function submitSlip() {
    if (!currentState || slip.submitting) return;
    const status = slipStatus(currentState);
    if (!status.valid) return;
    slip.submitting = true;
    render(currentState);
    try {
      const res = await fetch('/api/bets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          voterId,
          selections: slip.keys,
          stakeOre: status.stakeOre,
          clientBetId: slip.clientBetId,
          expectedOdds: Object.fromEntries(status.items.map((item) => [item.key, item.odds])),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Kunne ikke levere bongen');
      slip.keys = [];
      slip.stakeText = '';
      slip.clientBetId = newId();
      slip.notice = { type: 'success', text: `Bong levert! Mulig gevinst ${formatKr(data.bet.potentialPayoutOre)} 🍀` };
    } catch (err) {
      slip.notice = { type: 'error', text: err instanceof TypeError ? 'Nettverksfeil – prøv igjen' : err.message };
    } finally {
      slip.submitting = false;
      await fetchState();
    }
  }

  function updateSlipLive() {
    if (!currentState) return;
    const status = slipStatus(currentState);
    const payout = document.getElementById('slip-payout');
    const error = document.getElementById('slip-error');
    const button = document.getElementById('place-bet-btn');
    if (payout) payout.textContent = status.payoutOre !== null ? formatKr(status.payoutOre) : '–';
    if (error) error.textContent = status.error || '';
    if (button) {
      button.disabled = !status.valid || slip.submitting;
      button.textContent = status.valid ? `Lever bong · ${formatKr(status.stakeOre)}` : 'Lever bong';
    }
  }

  // --- Rendering ---

  function renderRegisterCard(errorMsg) {
    return `
      <section class="card" id="register-card">
        <h2>Bli med i gamblingen</h2>
        <p>Skriv navnet ditt – du får 2 000 kr i lekepenger å spille for!</p>
        <input id="name-input" placeholder="Navnet ditt" maxlength="40" autocomplete="off" />
        <button class="btn" data-action="register">Sett meg opp! 🥊</button>
        ${errorMsg ? `<p class="error">${esc(errorMsg)}</p>` : ''}
      </section>
    `;
  }

  function ensureShell() {
    if (document.getElementById('view-arena')) return;
    APP.innerHTML = `
      <section class="wallet-bar" id="wallet-bar"></section>
      <nav class="tabs" id="tabs"></nav>
      <div class="tab-view" id="view-arena"></div>
      <div class="tab-view" id="view-spill">
        <div id="spill-markets"></div>
        <div id="spill-dock" class="slip-dock-wrap"></div>
        <div id="spill-slip"></div>
      </div>
      <div class="tab-view" id="view-bonger"></div>
      <div class="tab-view" id="view-toppliste"></div>
    `;
  }

  function renderWallet(state) {
    const w = state.wallet;
    return `
      <div class="wallet-who">
        <span>Du spiller som <strong>${esc(state.voterName)}</strong></span>
        <span>${state.registeredCount} påmeldt</span>
      </div>
      <div class="wallet-balance">
        <span class="wallet-label">Saldo</span>
        <span class="wallet-amount">${formatKr(w.balanceOre)}</span>
      </div>
      ${w.openStakeOre ? `<p class="wallet-note">${formatKr(w.openStakeOre)} står i aktive bonger</p>` : ''}
      ${w.debtOre ? `<p class="wallet-note warn">Et resultat ble rettet – ${formatKr(w.debtOre)} trekkes fra neste gevinst</p>` : ''}
    `;
  }

  function renderTabs(state) {
    const openBets = state.myBets.filter((b) => b.status === 'open').length;
    return TABS.map((tab) => {
      let badge = '';
      if (tab.id === 'spill' && slip.keys.length) badge = `<span class="tab-badge">${slip.keys.length}</span>`;
      if (tab.id === 'bonger' && openBets) badge = `<span class="tab-badge">${openBets}</span>`;
      return `<button class="tab ${activeTab === tab.id ? 'active' : ''}" data-action="tab" data-tab="${tab.id}">${tab.label}${badge}</button>`;
    }).join('');
  }

  function stageBadge(match) {
    let cls = 'open';
    if (match.result) cls = 'done';
    else if (match.stage !== 'open') cls = 'live';
    return `<span class="stage-badge ${cls}">${cls === 'live' ? '<span class="live-dot"></span>' : ''}${esc(match.stageLabel)}</span>`;
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
        <button class="btn arena-cta" data-action="tab" data-tab="spill">Spill nå – alle starter med 2 000 kr 💸</button>
      </section>
    `;
  }

  function staticFighter(fighter) {
    return `
      <div class="fighter-pick static" style="border-color:${fighter.color}">
        <img src="${fighter.photo}" alt="${esc(fighter.name)}" />
        <span class="fighter-name" style="color:${fighter.color}">${esc(fighter.name)}</span>
        <span class="fighter-type-tag">${esc(fighter.type)}</span>
      </div>
    `;
  }

  function renderBacking(match) {
    const a = match.fighterA;
    const b = match.fighterB;
    const byFighter = match.backing.byFighterOre;
    const total = byFighter[a.id] + byFighter[b.id];
    const row = (f) => `
      <div class="tally-row">
        <span style="color:${f.color}">${esc(f.name.split(' ')[0])}</span>
        <div class="bar-track"><div class="bar-fill" style="width:${pct(byFighter[f.id], total)}%; background:${f.color}"></div></div>
        <span>${pct(byFighter[f.id], total)}%</span>
      </div>
    `;
    return `
      <div class="tally">
        <p class="tally-heading">Pengene i salen – hvem tror folk vinner?</p>
        ${row(a)}
        ${row(b)}
        <p class="tally-total">${formatKr(match.backing.totalStakeOre)} satset · ${match.backing.betCount} bonger</p>
      </div>
    `;
  }

  function renderMatchFocus(match) {
    return `
      <section class="card focus-card">
        <p class="match-title">${esc(match.title.toUpperCase())}</p>
        <div class="focus-stage">${stageBadge(match)}</div>
        <div class="versus">
          ${staticFighter(match.fighterA)}
          <div class="vs-badge">VS</div>
          ${staticFighter(match.fighterB)}
        </div>
        ${renderBacking(match)}
        <button class="btn focus-cta" data-action="tab" data-tab="spill">Spill på ${esc(match.title.toLowerCase())} 🎲</button>
      </section>
    `;
  }

  function summaryVerdict(summary) {
    if (!summary || !summary.bets) return { cls: 'neutral', text: 'Du hadde ingen bonger på denne kampen.' };
    const parts = [];
    if (summary.won) parts.push(`${summary.won} vunnet`);
    if (summary.lost) parts.push(`${summary.lost} tapt`);
    if (summary.void) parts.push(`${summary.void} annullert`);
    if (summary.open) parts.push(`${summary.open} venter på neste kamp`);
    const paid = summary.payoutOre ? ` – ${formatKr(summary.payoutOre)} utbetalt` : '';
    let cls = 'neutral';
    if (summary.won) cls = 'correct';
    else if (summary.lost && !summary.open) cls = 'wrong';
    return { cls, text: `${summary.won ? '✅' : summary.lost ? '❌' : '⏳'} ${parts.join(' · ')}${paid}` };
  }

  function howItEnded(result) {
    if (result.method === 'POENG') return 'Seier på poeng etter 3 runder';
    return `${result.methodLabel} i runde ${result.endRound}`;
  }

  function roundChips(result) {
    return `
      <div class="round-chips">
        ${result.rounds.map((r) => `
          <span class="round-chip ${r.winner ? '' : 'void'}" ${r.winner ? `style="border-color:${r.winner.color}"` : ''}>
            R${r.round}: ${r.winner ? esc(r.winner.name.split(' ')[0]) : 'Ikke gått'}
          </span>
        `).join('')}
      </div>
    `;
  }

  function renderMatchResult(match, summary, compact) {
    const { result } = match;
    const verdict = summaryVerdict(summary);
    return `
      <section class="card result-view ${compact ? 'compact' : ''}">
        <p class="eyebrow">${esc(match.title)} · Ferdig</p>
        <h2>🏆 Vinner</h2>
        ${compact ? '' : `<img src="${result.winner.photo}" alt="${esc(result.winner.name)}" />`}
        <p class="result-name" style="color:${result.winner.color}">${esc(result.winner.name)}</p>
        <p class="result-summary">${esc(howItEnded(result))}</p>
        ${roundChips(result)}
        <p class="result-verdict ${verdict.cls}">${esc(verdict.text)}</p>
        ${compact ? '' : renderBacking(match)}
      </section>
    `;
  }

  function renderLeaderboardList(rows) {
    if (!rows.length) return '<p class="muted">Ingen har registrert seg ennå.</p>';
    return `
      <div class="leaderboard-list">
        ${rows.map((row) => `
          <div class="leaderboard-row ${row.rank === 1 && row.betCount ? 'top' : ''} ${row.isMe ? 'me' : ''}">
            <span class="rank">${row.rank}</span>
            <div class="lb-main">
              <span class="lb-name">${esc(row.name)}${row.isMe ? ' <em>(deg)</em>' : ''}</span>
              <span class="lb-stats">
                <span>${row.betCount} ${row.betCount === 1 ? 'bong' : 'bonger'}</span>
                · <span>treff ${row.hitRatePct === null ? '–' : `${row.hitRatePct.toLocaleString('nb-NO')}\u00a0%`}</span>
                · <span>største gevinst ${row.biggestWinOre ? formatKr(row.biggestWinOre) : '–'}</span>
              </span>
            </div>
            <div class="lb-money">
              <span class="lb-balance">${formatKr(row.balanceOre)}</span>
              <span class="lb-net ${row.netOre > 0 ? 'up' : row.netOre < 0 ? 'down' : ''}">${formatSignedKr(row.netOre)}</span>
              <span class="lb-net ${row.netOre > 0 ? 'up' : row.netOre < 0 ? 'down' : ''}">${formatPct(row.netPct)}</span>
            </div>
          </div>
        `).join('')}
      </div>
    `;
  }

  function renderFinal(state) {
    const winners = state.leaderboard.filter((row) => row.rank === 1 && row.betCount);
    return `
      <section class="card final-view">
        <p class="eyebrow">Leken er over</p>
        <h2>🏆 ${winners.length ? esc(winners.map((w) => w.name).join(' og ')) : 'Kveldens gamblere'}</h2>
        ${winners.length ? `<p>vinner med ${formatKr(winners[0].balanceOre)} på konto (${formatPct(winners[0].netPct)})</p>` : ''}
        ${renderLeaderboardList(state.leaderboard)}
      </section>
    `;
  }

  function renderArena(state) {
    const { phase } = state;
    if (phase === 'lobby') return renderLobby();
    if (phase === 'final') return renderFinal(state);
    const matchId = focusMatchId(phase);
    const match = state.matches[matchId];
    const main = match.result
      ? renderMatchResult(match, state.myMatchSummary[matchId], false)
      : renderMatchFocus(match);
    const earlier = state.matchOrder
      .filter((id) => id !== matchId && state.matches[id].result)
      .map((id) => renderMatchResult(state.matches[id], state.myMatchSummary[id], true));
    return [main, ...earlier].join('');
  }

  function oddsButton(item) {
    const selected = slip.keys.includes(item.key);
    const open = item.market.open;
    return `
      <button class="odds-btn ${selected ? 'selected' : ''}" data-action="toggle-sel" data-key="${esc(item.key)}" ${open ? '' : 'disabled'} style="--fc:${item.color}">
        <span class="odds-name">${esc(item.short)}</span>
        <span class="odds-value">${open ? formatOdds(item.odds) : '🔒'}</span>
      </button>
    `;
  }

  function renderMatchMarkets(match, index) {
    const a = match.fighterA;
    const b = match.fighterB;
    const head = `
      <div class="market-head">
        <div>
          <p class="market-title">${esc(match.title)}</p>
          <p class="market-matchup"><span style="color:${a.color}">${esc(a.name)}</span> vs <span style="color:${b.color}">${esc(b.name)}</span></p>
        </div>
        ${stageBadge(match)}
      </div>
    `;
    if (match.result) {
      return `<section class="card market-card">${head}<p class="market-done">${esc(match.result.summary)}</p></section>`;
    }
    const marketBlock = (market, body) => `
      <div class="market ${market.open ? '' : 'locked'}">
        <p class="market-label">${esc(market.label)}${market.open ? '' : ' <span class="market-lock">🔒 Stengt</span>'}</p>
        ${body}
      </div>
    `;
    const blocks = match.markets.map((market) => {
      const items = market.selections.map((sel) => index[sel.key]);
      if (market.id !== 'method') {
        return marketBlock(market, `<div class="odds-row">${items.map(oddsButton).join('')}</div>`);
      }
      const group = (fighter) => `
        <div class="method-group">
          <span class="method-fighter" style="color:${fighter.color}">${esc(fighter.name)}</span>
          <div class="odds-row three">${items.filter((item) => item.fighter === fighter.id).map(oddsButton).join('')}</div>
        </div>
      `;
      return marketBlock(market, `${group(a)}${group(b)}`);
    });
    return `<section class="card market-card">${head}${blocks.join('')}</section>`;
  }

  function renderMarkets(state) {
    const index = selectionIndex(state);
    const focus = focusMatchId(state.phase);
    const ids = [...state.matchOrder].sort((x, y) => (x === focus ? -1 : y === focus ? 1 : 0));
    return `
      <p class="spill-intro">Trykk på oddsen du tror på. Flere valg blir en kombinasjonsbong – alle må treffe, men oddsen ganges sammen.</p>
      ${ids.map((id) => renderMatchMarkets(state.matches[id], index)).join('')}
    `;
  }

  function renderDock(state) {
    if (!slip.keys.length) return '';
    const status = slipStatus(state);
    return `
      <button class="slip-dock" data-action="scroll-slip">
        <span>🎟️ ${slip.keys.length} valg · odds ${formatOdds(status.odds)}</span>
        <span class="slip-dock-go">Til bongen ↓</span>
      </button>
    `;
  }

  function renderSlip(state) {
    const notice = slip.notice ? `<p class="slip-notice ${slip.notice.type}">${esc(slip.notice.text)}</p>` : '';
    if (!slip.keys.length) {
      return `${notice}<p class="slip-empty">Bongen er tom – trykk på en odds for å legge den til.</p>`;
    }
    const index = selectionIndex(state);
    const status = slipStatus(state);
    const lines = slip.keys.map((key) => {
      const item = index[key];
      if (!item) return '';
      return `
        <li class="slip-item ${item.market.open ? '' : 'locked'}">
          <div class="slip-item-text">
            <small>${esc(item.match.title)} · ${esc(item.market.label)}</small>
            <span style="color:${item.color}">${esc(item.label)}</span>
          </div>
          <span class="slip-odds">${item.market.open ? formatOdds(item.odds) : '🔒'}</span>
          <button class="slip-remove" data-action="remove-sel" data-key="${esc(key)}" aria-label="Fjern valget">×</button>
        </li>
      `;
    }).join('');
    const combo = status.items.length > 1;
    return `
      ${notice}
      <section class="card slip" id="bet-slip">
        <div class="slip-head">
          <h3>Bong <span class="slip-type">${combo ? `Kombinasjon · ${status.items.length} valg` : 'Singel'}</span></h3>
          <button class="slip-clear" data-action="clear-slip">Tøm</button>
        </div>
        <ul class="slip-list">${lines}</ul>
        <div class="slip-row"><span>${combo ? 'Samlet odds' : 'Odds'}</span><strong>${formatOdds(status.odds)}</strong></div>
        <label class="slip-stake-label" for="stake-input">Innsats</label>
        <div class="stake-field">
          <input id="stake-input" inputmode="decimal" autocomplete="off" placeholder="Minst ${formatKr(state.limits.minStakeOre)}" value="${esc(slip.stakeText)}" />
          <span>kr</span>
        </div>
        <div class="quick-stakes">
          ${QUICK_STAKES_KR.map((kr) => `<button data-action="quick-stake" data-kr="${kr}">${kr} kr</button>`).join('')}
          <button data-action="all-in">Alt inn</button>
        </div>
        <div class="slip-row payout"><span>Mulig gevinst</span><strong id="slip-payout">${status.payoutOre !== null ? formatKr(status.payoutOre) : '–'}</strong></div>
        <p class="slip-error" id="slip-error">${esc(status.error || '')}</p>
        <button class="btn" id="place-bet-btn" data-action="place-bet" ${status.valid && !slip.submitting ? '' : 'disabled'}>
          ${slip.submitting ? 'Leverer …' : `Lever bong${status.valid ? ` · ${formatKr(status.stakeOre)}` : ''}`}
        </button>
        <p class="slip-fineprint">Innsatsen trekkes fra saldoen med én gang. En levert bong kan ikke endres.</p>
      </section>
    `;
  }

  function renderBet(bet) {
    const effectiveOdds = bet.status === 'won' || bet.status === 'void' ? bet.payoutOre / bet.stakeOre : bet.totalOdds;
    return `
      <article class="bet-card status-${bet.status}">
        <div class="bet-head">
          <span class="bet-type">${bet.type === 'combo' ? `Kombinasjon · ${bet.selections.length} valg` : 'Singel'}</span>
          <span class="bet-status ${bet.status}">${BET_STATUS[bet.status]}</span>
        </div>
        <ul class="bet-lines">
          ${bet.selections.map((sel) => `
            <li class="outcome-${sel.outcome}">
              <span class="bet-icon">${OUTCOME_ICONS[sel.outcome]}</span>
              <span class="bet-label"><small>${esc(sel.matchTitle)} · ${esc(sel.marketLabel)}</small>${esc(sel.label)}</span>
              <span class="bet-odds">${sel.outcome === 'void' ? '1,00' : formatOdds(sel.odds)}</span>
            </li>
          `).join('')}
        </ul>
        <div class="bet-foot">
          <span>Innsats<strong>${formatKr(bet.stakeOre)}</strong></span>
          <span>Odds<strong>${formatOdds(effectiveOdds)}</strong></span>
          <span>${bet.status === 'open' ? 'Mulig gevinst' : 'Utbetalt'}<strong>${formatKr(bet.status === 'open' ? bet.potentialPayoutOre : bet.payoutOre)}</strong></span>
        </div>
      </article>
    `;
  }

  function renderMyBets(state) {
    if (!state.myBets.length) {
      return `
        <section class="card empty-card">
          <h2>Ingen bonger ennå</h2>
          <p>Du har ${formatKr(state.wallet.balanceOre)} å spille for.</p>
          <button class="btn" data-action="tab" data-tab="spill">Lag din første bong</button>
        </section>
      `;
    }
    const open = state.myBets.filter((b) => b.status === 'open');
    const settled = state.myBets.filter((b) => b.status !== 'open');
    return `
      ${open.length ? `<h3 class="section-title">Aktive bonger</h3>${open.map(renderBet).join('')}` : ''}
      ${settled.length ? `<h3 class="section-title">Avgjorte bonger</h3>${settled.map(renderBet).join('')}` : ''}
    `;
  }

  function renderToppliste(state) {
    return `
      <section class="card final-view">
        <h2>Toppliste</h2>
        <p>Sortert på saldo. Den med høyest saldo når leken er slutt, vinner.</p>
        ${renderLeaderboardList(state.leaderboard)}
      </section>
    `;
  }

  function stakeInputFocused() {
    return document.activeElement && document.activeElement.id === 'stake-input';
  }

  function render(state) {
    if (!state.registered) {
      slip.keys = [];
      // Don't clobber the input while someone is mid-registration.
      if (!document.getElementById('name-input')) {
        APP.innerHTML = renderRegisterCard();
      }
      return;
    }

    ensureShell();
    patch(document.getElementById('wallet-bar'), renderWallet(state));
    patch(document.getElementById('tabs'), renderTabs(state));
    TABS.forEach((tab) => {
      document.getElementById(`view-${tab.id}`).hidden = tab.id !== activeTab;
    });
    patch(document.getElementById('view-arena'), renderArena(state));
    patch(document.getElementById('spill-markets'), renderMarkets(state));
    patch(document.getElementById('spill-dock'), renderDock(state));
    if (!stakeInputFocused()) patch(document.getElementById('spill-slip'), renderSlip(state));
    patch(document.getElementById('view-bonger'), renderMyBets(state));
    patch(document.getElementById('view-toppliste'), renderToppliste(state));
  }

  function switchTab(tab) {
    activeTab = tab;
    render(currentState);
    const tabs = document.getElementById('tabs');
    if (tabs && window.scrollY > tabs.offsetTop) window.scrollTo(0, tabs.offsetTop);
  }

  APP.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const { action } = btn.dataset;

    if (action === 'register') {
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
      return;
    }

    if (action === 'punch') {
      triggerPunch(btn, btn.dataset.color);
      return;
    }

    if (!currentState || !currentState.registered) return;

    if (action === 'tab') switchTab(btn.dataset.tab);
    if (action === 'toggle-sel') {
      toggleSelection(btn.dataset.key);
      render(currentState);
    }
    if (action === 'remove-sel') {
      slip.keys = slip.keys.filter((k) => k !== btn.dataset.key);
      slip.clientBetId = newId();
      slip.notice = null;
      render(currentState);
    }
    if (action === 'clear-slip') {
      slip.keys = [];
      slip.notice = null;
      slip.clientBetId = newId();
      render(currentState);
    }
    if (action === 'quick-stake' || action === 'all-in') {
      slip.stakeText = action === 'all-in'
        ? (currentState.wallet.balanceOre / 100).toFixed(2).replace('.', ',').replace(/,00$/, '')
        : btn.dataset.kr;
      slip.clientBetId = newId();
      slip.notice = null;
      render(currentState);
    }
    if (action === 'scroll-slip') {
      const target = document.getElementById('bet-slip');
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    if (action === 'place-bet') await submitSlip();
  });

  APP.addEventListener('input', (e) => {
    if (e.target.id !== 'stake-input' || !currentState) return;
    slip.stakeText = e.target.value;
    slip.clientBetId = newId();
    slip.notice = null;
    updateSlipLive();
    // The live update above already shows what renderSlip would, so record it
    // as rendered – otherwise the next poll would swap out the "Lever bong"
    // button, possibly between someone's press and release.
    renderedHtml.set(document.getElementById('spill-slip'), renderSlip(currentState));
  });

  APP.addEventListener('keydown', (e) => {
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
    const lobby = document.querySelector('.arena-lobby');
    if (lobby && lobby.offsetParent !== null) {
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

    const resultPhase = /^(match\d+)_result$/.exec(phase);
    if (resultPhase) {
      const match = state.matches[resultPhase[1]];
      if (!match.result) return null;
      const verdict = summaryVerdict(state.myMatchSummary[match.id]);
      return `
        <p class="announcement-eyebrow">${esc(match.title)} · ${esc(howItEnded(match.result))}</p>
        <p class="announcement-title">🏆 ${esc(match.result.winner.name)} vinner!</p>
        <img src="${match.result.winner.photo}" alt="${esc(match.result.winner.name)}" />
        <p class="announcement-verdict ${verdict.cls}">${esc(verdict.text)}</p>
        <p class="announcement-balance">Saldo nå: <strong>${formatKr(state.wallet.balanceOre)}</strong></p>
      `;
    }

    if (phase === 'final') {
      const me = state.leaderboard.find((row) => row.isMe);
      if (!me) return null;
      const champion = me.rank === 1 && me.betCount > 0;
      return `
        <p class="announcement-eyebrow">Leken er over</p>
        <p class="announcement-rank">#${me.rank}</p>
        <p class="announcement-title">${esc(me.name)}</p>
        <p class="announcement-verdict ${champion ? 'correct' : 'neutral'}">
          ${formatKr(me.balanceOre)} · ${formatSignedKr(me.netOre)} (${formatPct(me.netPct)})${champion ? ' — du vant leken! 🏆' : ''}
        </p>
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
