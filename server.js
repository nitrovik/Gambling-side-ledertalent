const express = require('express');
const fs = require('fs');
const path = require('path');
const betting = require('./betting');

const FIGHTERS = {
  rita: { id: 'rita', name: 'Rita Relator', color: '#f6b9e2', photo: 'images/rita_photo.jpg',
    type: 'Relasjoner og stemning' },
  morten: { id: 'morten', name: 'Morten Motivator', color: '#f6dd90', photo: 'images/morten_photo.jpg',
    type: 'Energi og engasjement' },
  petra: { id: 'petra', name: 'Petra Processor', color: '#9db6ce', photo: 'images/petra_photo.jpg',
    type: 'Fakta og metode' },
  pal: { id: 'pal', name: 'Pål Producer', color: '#a8c29e', photo: 'images/pal_photo.jpg',
    type: 'Mål og resultat' },
};

const MATCH_DEFS = [
  { id: 'match1', title: 'Kamp 1', fighterA: 'rita', fighterB: 'pal' },
  { id: 'match2', title: 'Kamp 2', fighterA: 'petra', fighterB: 'morten' },
];

const PHASES = ['lobby', 'match1_open', 'match1_result', 'match2_open', 'match2_result', 'final'];

function defaultState() {
  return {
    phase: 'lobby',
    voters: {},
    bets: [],
    betSeq: 0,
    matches: Object.fromEntries(MATCH_DEFS.map((m) => [m.id, betting.defaultMatchState()])),
  };
}

function phaseError(state, phase) {
  if (!PHASES.includes(phase)) return 'Ukjent fase';
  const resultPhase = phase.match(/^(match\d+)_result$/);
  if (resultPhase && !state.matches[resultPhase[1]].result) {
    return 'Registrer resultatet for kampen før du viser det';
  }
  if (phase === 'final' && MATCH_DEFS.some((m) => !state.matches[m.id].result)) {
    return 'Registrer resultat for alle kampene før du viser sluttresultatet';
  }
  return null;
}

function normalizeState(raw) {
  const state = defaultState();
  if (!raw || typeof raw !== 'object') return state;
  if (raw.voters && typeof raw.voters === 'object') state.voters = raw.voters;
  if (Array.isArray(raw.bets)) state.bets = raw.bets;
  if (Number.isInteger(raw.betSeq)) state.betSeq = raw.betSeq;
  MATCH_DEFS.forEach((def) => {
    const saved = raw.matches && raw.matches[def.id];
    if (!saved) return;
    const target = state.matches[def.id];
    if (betting.STAGES.includes(saved.stage)) target.stage = saved.stage;
    try {
      target.odds = betting.normalizeOddsConfig(def, saved.odds);
    } catch (err) {
      // keep default odds
    }
    try {
      target.result = betting.normalizeResult(def, saved.result === undefined ? null : saved.result);
    } catch (err) {
      target.result = null;
    }
  });
  if (!phaseError(state, raw.phase)) state.phase = raw.phase;
  betting.settleAll(state);
  return state;
}

function loadState(dataFile) {
  try {
    return normalizeState(JSON.parse(fs.readFileSync(dataFile, 'utf8')));
  } catch (err) {
    return defaultState();
  }
}

function publicFighter(id) {
  const f = FIGHTERS[id];
  return { id: f.id, name: f.name, color: f.color, photo: f.photo, type: f.type };
}

function resultPayload(result) {
  return {
    winner: publicFighter(result.winner),
    method: result.method,
    methodLabel: betting.METHOD_SHORT[result.method],
    summary: betting.describeResult(result, FIGHTERS),
    rounds: betting.ROUNDS.map((n) => ({ round: n, winner: publicFighter(result.roundWinners[n]) })),
  };
}

function createApp({ dataFile, adminPassword }) {
  const app = express();
  let state = loadState(dataFile);

  function saveState() {
    fs.mkdirSync(path.dirname(dataFile), { recursive: true });
    const tmp = `${dataFile}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
    fs.renameSync(tmp, dataFile);
  }

  function findMatch(matchId) {
    return MATCH_DEFS.find((m) => m.id === matchId);
  }

  function matchPayload(def) {
    const matchState = state.matches[def.id];
    const odds = betting.computeOdds(def, matchState.odds);
    const selections = betting.selectionsForMatch(def);
    return {
      id: def.id,
      title: def.title,
      fighterA: publicFighter(def.fighterA),
      fighterB: publicFighter(def.fighterB),
      stage: matchState.stage,
      stageLabel: matchState.result ? 'Ferdig' : betting.STAGE_LABELS[matchState.stage],
      markets: betting.MARKETS.map((market) => ({
        id: market,
        label: betting.MARKET_LABELS[market],
        open: betting.isMarketOpen(matchState, market),
        selections: selections
          .filter((sel) => sel.market === market)
          .map((sel) => ({
            key: sel.key,
            fighter: sel.fighter,
            method: sel.method || null,
            odds: odds[sel.key],
            ...betting.describeSelection(sel, FIGHTERS),
          })),
      })),
      result: matchState.result ? resultPayload(matchState.result) : null,
      backing: betting.backingFor(state, def),
    };
  }

  function betPayload(bet) {
    const totalOdds = betting.combinedOdds(bet.selections.map((sel) => sel.odds));
    return {
      id: bet.id,
      placedAt: bet.placedAt,
      type: bet.selections.length > 1 ? 'combo' : 'single',
      stakeOre: bet.stakeOre,
      totalOdds,
      potentialPayoutOre: betting.payoutFor(bet.stakeOre, totalOdds),
      status: bet.status,
      payoutOre: bet.payoutOre,
      selections: bet.selections.map((sel, i) => ({
        key: sel.key,
        matchTitle: findMatch(sel.matchId).title,
        marketLabel: betting.MARKET_LABELS[sel.market],
        label: betting.describeSelection(sel, FIGHTERS).label,
        odds: sel.odds,
        outcome: bet.outcomes[i],
      })),
    };
  }

  function leaderboardPayload(viewerId) {
    return betting.buildLeaderboard(state).map(({ voterId, registeredAt, ...row }) => ({
      ...row,
      isMe: voterId === viewerId,
    }));
  }

  function handle(fn) {
    return (req, res) => {
      try {
        fn(req, res);
      } catch (err) {
        if (err instanceof betting.BetError) {
          res.status(400).json({ error: err.message });
          return;
        }
        throw err;
      }
    };
  }

  function checkAdmin(req, res, next) {
    const key = req.get('x-admin-key');
    if (key !== adminPassword) return res.status(401).json({ error: 'Feil passord' });
    next();
  }

  app.use(express.json());
  app.use(express.static(path.join(__dirname, 'public')));

  app.get('/api/state', (req, res) => {
    const voterId = betting.isVoter(state, req.query.voterId) ? req.query.voterId : null;
    const voter = voterId ? state.voters[voterId] : null;
    const matches = Object.fromEntries(MATCH_DEFS.map((def) => [def.id, matchPayload(def)]));

    const payload = {
      phase: state.phase,
      matchOrder: MATCH_DEFS.map((m) => m.id),
      registered: !!voter,
      voterName: voter ? voter.name : null,
      registeredCount: Object.keys(state.voters).length,
      limits: { startBalanceOre: betting.START_BALANCE_ORE, minStakeOre: betting.MIN_STAKE_ORE },
      matches,
      leaderboard: leaderboardPayload(voter ? voterId : null),
    };

    if (voter) {
      payload.wallet = betting.walletOf(state, voterId);
      payload.myBets = state.bets
        .filter((bet) => bet.voterId === voterId)
        .sort((a, b) => b.placedAt - a.placedAt)
        .map(betPayload);
      payload.myMatchSummary = Object.fromEntries(
        MATCH_DEFS.map((def) => [def.id, betting.matchSummaryFor(state, voterId, def.id)]),
      );
    }

    res.json(payload);
  });

  app.post('/api/register', (req, res) => {
    const { voterId, name } = req.body || {};
    if (typeof voterId !== 'string' || !/^[A-Za-z0-9-]{8,100}$/.test(voterId)) {
      return res.status(400).json({ error: 'Ugyldig deltaker-ID' });
    }
    const trimmed = typeof name === 'string' ? name.trim() : '';
    if (!trimmed) return res.status(400).json({ error: 'Navn kan ikke være tomt' });
    if (trimmed.length > 40) return res.status(400).json({ error: 'Navnet er for langt' });

    if (!betting.isVoter(state, voterId)) {
      state.voters[voterId] = { name: trimmed, registeredAt: Date.now() };
    } else {
      state.voters[voterId].name = trimmed;
    }
    saveState();
    res.json({ ok: true, name: trimmed });
  });

  app.post('/api/bets', handle((req, res) => {
    const body = req.body || {};
    const { bet, duplicate } = betting.placeBet(state, MATCH_DEFS, {
      voterId: body.voterId,
      selections: body.selections,
      stakeOre: body.stakeOre,
      clientBetId: body.clientBetId,
      expectedOdds: body.expectedOdds,
    });
    if (!duplicate) saveState();
    res.json({ ok: true, duplicate, bet: betPayload(bet), wallet: betting.walletOf(state, bet.voterId) });
  }));

  app.post('/api/admin/login', (req, res) => {
    const { password } = req.body || {};
    if (password !== adminPassword) return res.status(401).json({ error: 'Feil passord' });
    res.json({ ok: true });
  });

  app.get('/api/admin/state', checkAdmin, (req, res) => {
    const totals = state.bets.reduce((sum, bet) => ({
      bets: sum.bets + 1,
      stakeOre: sum.stakeOre + bet.stakeOre,
      paidOutOre: sum.paidOutOre + bet.payoutOre,
      openBets: sum.openBets + (bet.status === 'open' ? 1 : 0),
    }), { bets: 0, stakeOre: 0, paidOutOre: 0, openBets: 0 });

    res.json({
      phase: state.phase,
      phases: PHASES,
      registeredCount: Object.keys(state.voters).length,
      voters: Object.values(state.voters).map((v) => v.name).sort((a, b) => a.localeCompare(b, 'nb')),
      totals,
      matches: MATCH_DEFS.map((def) => ({
        ...matchPayload(def),
        fighters: [publicFighter(def.fighterA), publicFighter(def.fighterB)],
        oddsConfig: state.matches[def.id].odds,
        profileOdds: {
          even: betting.baseOdds(def, { profile: 'even' }),
          [`fav:${def.fighterA}`]: betting.baseOdds(def, { profile: 'favorite', favorite: def.fighterA }),
          [`fav:${def.fighterB}`]: betting.baseOdds(def, { profile: 'favorite', favorite: def.fighterB }),
        },
        rawResult: state.matches[def.id].result,
      })),
      leaderboard: leaderboardPayload(null),
    });
  });

  app.post('/api/admin/phase', checkAdmin, (req, res) => {
    const { phase } = req.body || {};
    const error = phaseError(state, phase);
    if (error) return res.status(400).json({ error });
    state.phase = phase;
    saveState();
    res.json({ ok: true, phase: state.phase });
  });

  app.post('/api/admin/matches/:matchId/stage', checkAdmin, (req, res) => {
    const def = findMatch(req.params.matchId);
    if (!def) return res.status(404).json({ error: 'Ukjent kamp' });
    const { stage } = req.body || {};
    if (!betting.STAGES.includes(stage)) return res.status(400).json({ error: 'Ukjent stadium' });
    state.matches[def.id].stage = stage;
    saveState();
    res.json({ ok: true, stage });
  });

  app.post('/api/admin/matches/:matchId/odds', checkAdmin, handle((req, res) => {
    const def = findMatch(req.params.matchId);
    if (!def) return res.status(404).json({ error: 'Ukjent kamp' });
    state.matches[def.id].odds = betting.normalizeOddsConfig(def, req.body || {});
    saveState();
    res.json({ ok: true, odds: betting.computeOdds(def, state.matches[def.id].odds) });
  }));

  app.post('/api/admin/matches/:matchId/result', checkAdmin, handle((req, res) => {
    const def = findMatch(req.params.matchId);
    if (!def) return res.status(404).json({ error: 'Ukjent kamp' });
    const result = betting.normalizeResult(def, (req.body || {}).result);
    state.matches[def.id].result = result;
    const { changed } = betting.settleAll(state);
    if (result && state.phase === `${def.id}_open`) state.phase = `${def.id}_result`;
    if (!result && phaseError(state, state.phase)) state.phase = `${def.id}_open`;
    saveState();
    const votersWithDebt = Object.keys(state.voters).filter((id) => betting.walletOf(state, id).debtOre > 0).length;
    res.json({ ok: true, phase: state.phase, changedBets: changed, votersWithDebt });
  }));

  app.post('/api/admin/reset', checkAdmin, (req, res) => {
    state = defaultState();
    saveState();
    res.json({ ok: true });
  });

  return app;
}

if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'ledertalent';
  const app = createApp({ dataFile: path.join(__dirname, 'data', 'state.json'), adminPassword: ADMIN_PASSWORD });
  app.listen(PORT, () => {
    console.log(`Fight Night-serveren kjører på http://localhost:${PORT}`);
    console.log(`Admin-passord: ${ADMIN_PASSWORD}`);
  });
}

module.exports = { createApp, FIGHTERS, MATCH_DEFS, PHASES };
