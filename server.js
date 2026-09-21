const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'ledertalent';
const DATA_FILE = path.join(__dirname, 'data', 'state.json');

const FIGHTERS = {
  rita: { id: 'rita', name: 'Rita Relator', color: '#f6b9e2', image: 'images/rita_card.png', photo: 'images/rita_photo.png',
    type: 'Relasjoner og stemning',
    quote: 'Når det oppstår dårlig stemning eller relasjonen mellom mennesker blir truet' },
  morten: { id: 'morten', name: 'Morten Motivator', color: '#f6dd90', image: 'images/morten_card.png', photo: 'images/morten_photo.png',
    type: 'Energi og engasjement',
    quote: 'Når energi, engasjement eller muligheten til å bli hørt blir blokkert' },
  petra: { id: 'petra', name: 'Petra Processor', color: '#9db6ce', image: 'images/petra_card.png', photo: 'images/petra_photo.png',
    type: 'Fakta og metode',
    quote: 'Når det er uenighet om fakta, regler, metode eller hva som er riktig' },
  pal: { id: 'pal', name: 'Pål Producer', color: '#a8c29e', image: 'images/pal_card.png', photo: 'images/pal_photo.png',
    type: 'Mål og resultat',
    quote: 'Når noe eller noen står i veien for målet/resultatet' },
};

const MATCH_DEFS = [
  { id: 'match1', fighterA: 'rita', fighterB: 'pal', winner: 'rita', decidingRound: 3 },
  { id: 'match2', fighterA: 'petra', fighterB: 'morten', winner: 'petra', decidingRound: 3 },
];

const PHASES = ['lobby', 'match1_open', 'match1_result', 'match2_open', 'match2_result', 'final'];

function defaultState() {
  return {
    phase: 'lobby',
    voters: {},
    votes: { match1: {}, match2: {} },
  };
}

function loadState() {
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed.votes) parsed.votes = { match1: {}, match2: {} };
    if (!parsed.voters) parsed.voters = {};
    if (!PHASES.includes(parsed.phase)) parsed.phase = 'lobby';
    return parsed;
  } catch (err) {
    return defaultState();
  }
}

let state = loadState();

function saveState() {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(state, null, 2));
}

function tallyFor(matchId) {
  const def = MATCH_DEFS.find((m) => m.id === matchId);
  const counts = { [def.fighterA]: 0, [def.fighterB]: 0 };
  Object.values(state.votes[matchId]).forEach((pick) => {
    if (counts[pick] !== undefined) counts[pick] += 1;
  });
  const total = counts[def.fighterA] + counts[def.fighterB];
  return { counts, total };
}

function buildMatchPayload(matchId, revealResult) {
  const def = MATCH_DEFS.find((m) => m.id === matchId);
  const { counts, total } = tallyFor(matchId);
  return {
    id: def.id,
    fighterA: FIGHTERS[def.fighterA],
    fighterB: FIGHTERS[def.fighterB],
    votes: { [def.fighterA]: counts[def.fighterA], [def.fighterB]: counts[def.fighterB] },
    totalVotes: total,
    isOpen: state.phase === `${matchId}_open`,
    isDecided: revealResult,
    winner: revealResult ? FIGHTERS[def.winner] : null,
    decidingRound: revealResult ? def.decidingRound : null,
  };
}

function buildLeaderboard() {
  const decided = MATCH_DEFS.filter((m) => {
    const resultIdx = PHASES.indexOf(`${m.id}_result`);
    return PHASES.indexOf(state.phase) >= resultIdx;
  });
  const rows = Object.entries(state.voters).map(([voterId, voter]) => {
    let correct = 0;
    let voted = 0;
    decided.forEach((def) => {
      const pick = state.votes[def.id][voterId];
      if (pick) {
        voted += 1;
        if (pick === def.winner) correct += 1;
      }
    });
    return { voterId, name: voter.name, correct, voted, registeredAt: voter.registeredAt };
  });
  rows.sort((a, b) => b.correct - a.correct || a.registeredAt - b.registeredAt);
  return { rows, decidedCount: decided.length };
}

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/state', (req, res) => {
  const voterId = req.query.voterId;
  const voter = voterId ? state.voters[voterId] : null;

  const payload = {
    phase: state.phase,
    registered: !!voter,
    voterName: voter ? voter.name : null,
    registeredCount: Object.keys(state.voters).length,
    match1: buildMatchPayload('match1', PHASES.indexOf(state.phase) >= PHASES.indexOf('match1_result')),
    match2: buildMatchPayload('match2', PHASES.indexOf(state.phase) >= PHASES.indexOf('match2_result')),
    myPicks: voterId
      ? { match1: state.votes.match1[voterId] || null, match2: state.votes.match2[voterId] || null }
      : { match1: null, match2: null },
  };

  if (state.phase === 'final') {
    payload.leaderboard = buildLeaderboard();
  }

  res.json(payload);
});

app.post('/api/register', (req, res) => {
  const { voterId, name } = req.body || {};
  if (!voterId || typeof voterId !== 'string') return res.status(400).json({ error: 'voterId mangler' });
  const trimmed = (name || '').trim();
  if (!trimmed) return res.status(400).json({ error: 'Navn kan ikke være tomt' });
  if (trimmed.length > 40) return res.status(400).json({ error: 'Navnet er for langt' });

  if (!state.voters[voterId]) {
    state.voters[voterId] = { name: trimmed, registeredAt: Date.now() };
  } else {
    state.voters[voterId].name = trimmed;
  }
  saveState();
  res.json({ ok: true, name: trimmed });
});

app.post('/api/vote', (req, res) => {
  const { voterId, matchId, pick } = req.body || {};
  if (!voterId || !state.voters[voterId]) return res.status(400).json({ error: 'Du må registrere deg først' });
  const def = MATCH_DEFS.find((m) => m.id === matchId);
  if (!def) return res.status(400).json({ error: 'Ukjent kamp' });
  if (state.phase !== `${matchId}_open`) return res.status(400).json({ error: 'Tippingen for denne kampen er ikke åpen' });
  if (pick !== def.fighterA && pick !== def.fighterB) return res.status(400).json({ error: 'Ugyldig valg' });
  if (state.votes[matchId][voterId]) return res.status(400).json({ error: 'Du har allerede tippet denne kampen — valget er låst.' });

  state.votes[matchId][voterId] = pick;
  saveState();
  res.json({ ok: true });
});

function checkAdmin(req, res, next) {
  const key = req.get('x-admin-key');
  if (key !== ADMIN_PASSWORD) return res.status(401).json({ error: 'Feil passord' });
  next();
}

app.post('/api/admin/login', (req, res) => {
  const { password } = req.body || {};
  if (password !== ADMIN_PASSWORD) return res.status(401).json({ error: 'Feil passord' });
  res.json({ ok: true });
});

app.get('/api/admin/state', checkAdmin, (req, res) => {
  res.json({
    phase: state.phase,
    phases: PHASES,
    registeredCount: Object.keys(state.voters).length,
    match1: buildMatchPayload('match1', true),
    match2: buildMatchPayload('match2', true),
    voters: Object.values(state.voters)
      .map((v) => v.name)
      .sort((a, b) => a.localeCompare(b, 'nb')),
  });
});

app.post('/api/admin/phase', checkAdmin, (req, res) => {
  const { phase } = req.body || {};
  if (!PHASES.includes(phase)) return res.status(400).json({ error: 'Ukjent fase' });
  state.phase = phase;
  saveState();
  res.json({ ok: true, phase: state.phase });
});

app.post('/api/admin/reset', checkAdmin, (req, res) => {
  state = defaultState();
  saveState();
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`Fight Night-serveren kjører på http://localhost:${PORT}`);
  console.log(`Admin-passord: ${ADMIN_PASSWORD}`);
});
