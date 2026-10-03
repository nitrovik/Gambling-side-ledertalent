// Fictional betting game: odds, markets, bet slips, settlement and wallets.
// All money is stored as integer øre to avoid floating point drift.

const START_BALANCE_ORE = 200000;
const MIN_STAKE_ORE = 1000;
const MAX_SELECTIONS = 10;
// Betting is open until round 1 starts. 'done' is final: a match gets there when
// its result is saved and stays closed.
const STAGES = ['open', 'r1', 'r2', 'r3', 'done'];
const METHODS = ['POENG', 'TKO', 'KO'];
const MARKETS = ['winner', 'method'];

const MARKET_LABELS = {
  winner: 'Kampvinner',
  method: 'Vinnermetode',
};

const STAGE_LABELS = {
  open: 'Åpent for spill',
  r1: 'Runde 1 pågår',
  r2: 'Runde 2 pågår',
  r3: 'Runde 3 pågår',
  done: 'Ferdig',
};

const METHOD_LABELS = { POENG: 'poeng', TKO: 'TKO', KO: 'KO' };
const METHOD_SHORT = { POENG: 'Poeng', TKO: 'TKO', KO: 'KO' };

// Generic profiles the admin can switch to, with about 7 % margin on every
// market. A match can also bring its own odds per fighter ('standard').
const ODDS_PROFILES = {
  even: {
    winner: { favorite: 1.87, underdog: 1.87 },
    method: {
      favorite: { POENG: 3.75, TKO: 6.25, KO: 9.5 },
      underdog: { POENG: 3.75, TKO: 6.25, KO: 9.5 },
    },
  },
  favorite: {
    winner: { favorite: 1.55, underdog: 2.35 },
    method: {
      favorite: { POENG: 3.1, TKO: 5.2, KO: 7.8 },
      underdog: { POENG: 4.25, TKO: 8.5, KO: 13 },
    },
  },
};

class BetError extends Error {}

function isVoter(state, voterId) {
  return typeof voterId === 'string' && Object.prototype.hasOwnProperty.call(state.voters, voterId);
}

function formatKr(ore) {
  const sign = ore < 0 ? '-' : '';
  const abs = Math.abs(ore);
  const kr = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  const rest = abs % 100;
  return `${sign}${kr}${rest ? `,${String(rest).padStart(2, '0')}` : ''} kr`;
}

// `plannedResult` is what the admin has entered, possibly long before the fight.
// It stays private and settles nothing; `result` is the one that has been shown.
function defaultMatchState(match) {
  return {
    stage: 'open',
    odds: { profile: match && match.standardOdds ? 'standard' : 'even', favorite: null, overrides: {} },
    plannedResult: null,
    result: null,
  };
}

function selectionsForMatch(match) {
  const fighters = [match.fighterA, match.fighterB];
  const list = [];
  fighters.forEach((fighter) => {
    list.push({ key: `${match.id}:winner:${fighter}`, matchId: match.id, market: 'winner', fighter });
  });
  fighters.forEach((fighter) => {
    METHODS.forEach((method) => {
      list.push({ key: `${match.id}:method:${fighter}:${method}`, matchId: match.id, market: 'method', fighter, method });
    });
  });
  return list;
}

function parseSelection(key, matches) {
  if (typeof key !== 'string') return null;
  const match = matches.find((m) => key.startsWith(`${m.id}:`));
  if (!match) return null;
  return selectionsForMatch(match).find((s) => s.key === key) || null;
}

// One fighter's odds under a profile, as { winner, POENG, TKO, KO }.
function fighterOdds(match, oddsConfig, fighter) {
  if (oddsConfig.profile === 'standard') return match.standardOdds[fighter];
  const profile = ODDS_PROFILES[oddsConfig.profile];
  const side = oddsConfig.profile === 'favorite' && fighter !== oddsConfig.favorite ? 'underdog' : 'favorite';
  return { winner: profile.winner[side], ...profile.method[side] };
}

function baseOdds(match, oddsConfig) {
  const odds = {};
  selectionsForMatch(match).forEach((sel) => {
    const table = fighterOdds(match, oddsConfig, sel.fighter);
    odds[sel.key] = sel.market === 'winner' ? table.winner : table[sel.method];
  });
  return odds;
}

function computeOdds(match, oddsConfig) {
  const odds = baseOdds(match, oddsConfig);
  Object.entries(oddsConfig.overrides || {}).forEach(([key, value]) => {
    if (key in odds) odds[key] = value;
  });
  return odds;
}

function normalizeOddsConfig(match, input) {
  const profile = input && input.profile;
  const known = ODDS_PROFILES[profile] || (profile === 'standard' && match.standardOdds);
  if (!known) throw new BetError('Ukjent oddsprofil');
  let favorite = null;
  if (profile === 'favorite') {
    favorite = input.favorite;
    if (favorite !== match.fighterA && favorite !== match.fighterB) {
      throw new BetError('Velg hvem som er favoritt');
    }
  }
  const validKeys = new Set(selectionsForMatch(match).map((s) => s.key));
  const overrides = {};
  Object.entries((input && input.overrides) || {}).forEach(([key, raw]) => {
    if (raw === null || raw === undefined || raw === '') return;
    if (!validKeys.has(key)) throw new BetError('Ukjent valg i oddsoverstyringen');
    const value = Number(String(raw).replace(',', '.'));
    if (!Number.isFinite(value) || value < 1.01 || value > 1000) {
      throw new BetError('Odds må være et tall mellom 1,01 og 1000');
    }
    overrides[key] = Math.round(value * 100) / 100;
  });
  return { profile, favorite, overrides };
}

function isMarketOpen(matchState) {
  return Boolean(matchState) && !matchState.result && matchState.stage === 'open';
}

function findConflict(selections) {
  const keys = new Set();
  const markets = new Map();
  for (const sel of selections) {
    if (keys.has(sel.key)) return 'Samme valg kan bare stå én gang på bongen';
    keys.add(sel.key);
    const marketId = `${sel.matchId}:${sel.market}`;
    if (markets.has(marketId)) {
      if (sel.market === 'winner') return 'Begge kan ikke vinne samme kamp';
      return 'En kamp kan bare avgjøres på én måte';
    }
    markets.set(marketId, sel);
  }
  // Winner and method stack freely, as long as they name the same fighter.
  for (const sel of selections) {
    if (sel.market !== 'method') continue;
    const winnerPick = markets.get(`${sel.matchId}:winner`);
    if (winnerPick && winnerPick.fighter !== sel.fighter) return 'Kampvinner og vinnermetode motsier hverandre';
  }
  return null;
}

function combinedOdds(odds) {
  return odds.reduce((product, value) => product * value, 1);
}

function payoutFor(stakeOre, odds) {
  return Math.round(stakeOre * odds);
}

function walletOf(state, voterId) {
  let ledgerOre = START_BALANCE_ORE;
  let openStakeOre = 0;
  state.bets.forEach((bet) => {
    if (bet.voterId !== voterId) return;
    ledgerOre += bet.payoutOre - bet.stakeOre;
    if (bet.status === 'open') openStakeOre += bet.stakeOre;
  });
  return {
    balanceOre: Math.max(0, ledgerOre),
    debtOre: Math.max(0, -ledgerOre),
    ledgerOre,
    openStakeOre,
  };
}

function placeBet(state, matches, input) {
  const { voterId, clientBetId } = input;
  if (!isVoter(state, voterId)) throw new BetError('Du må registrere deg først');
  if (clientBetId !== undefined && clientBetId !== null) {
    if (typeof clientBetId !== 'string' || clientBetId.length > 100) throw new BetError('Ugyldig bong-ID');
    const existing = state.bets.find((b) => b.voterId === voterId && b.clientBetId === clientBetId);
    if (existing) return { bet: existing, duplicate: true };
  }

  const keys = input.selections;
  if (!Array.isArray(keys) || keys.length === 0) throw new BetError('Bongen er tom');
  if (keys.length > MAX_SELECTIONS) throw new BetError(`En bong kan ha maks ${MAX_SELECTIONS} valg`);
  const parsed = keys.map((key) => parseSelection(key, matches));
  if (parsed.some((sel) => !sel)) throw new BetError('Bongen inneholder et ugyldig valg');

  const conflict = findConflict(parsed);
  if (conflict) throw new BetError(conflict);

  for (const sel of parsed) {
    if (!isMarketOpen(state.matches[sel.matchId])) {
      const match = matches.find((m) => m.id === sel.matchId);
      throw new BetError(`${MARKET_LABELS[sel.market]} i ${match.title || match.id} er låst`);
    }
  }

  const stakeOre = input.stakeOre;
  if (!Number.isInteger(stakeOre)) throw new BetError('Ugyldig innsats');
  if (stakeOre < MIN_STAKE_ORE) throw new BetError(`Minsteinnsats er ${formatKr(MIN_STAKE_ORE)}`);
  const wallet = walletOf(state, voterId);
  if (stakeOre > wallet.balanceOre) {
    throw new BetError(`Du kan ikke satse mer enn saldoen din (${formatKr(wallet.balanceOre)})`);
  }

  const selections = parsed.map((sel) => {
    const match = matches.find((m) => m.id === sel.matchId);
    return { ...sel, odds: computeOdds(match, state.matches[sel.matchId].odds)[sel.key] };
  });

  if (input.expectedOdds && typeof input.expectedOdds === 'object') {
    const changed = selections.some((sel) => {
      const expected = input.expectedOdds[sel.key];
      return expected !== undefined && Math.abs(Number(expected) - sel.odds) > 1e-9;
    });
    if (changed) throw new BetError('Oddsen er endret – sjekk bongen og lever på nytt');
  }

  state.betSeq = (state.betSeq || 0) + 1;
  const bet = {
    id: `b${state.betSeq}`,
    voterId,
    clientBetId: clientBetId || null,
    placedAt: input.now || Date.now(),
    stakeOre,
    selections,
    status: 'open',
    outcomes: selections.map(() => 'pending'),
    payoutOre: 0,
    settledAt: null,
  };
  state.bets.push(bet);
  return { bet, duplicate: false };
}

function normalizeResult(match, input) {
  if (input === null) return null;
  if (!input || typeof input !== 'object') throw new BetError('Mangler resultat');
  if (![match.fighterA, match.fighterB].includes(input.winner)) throw new BetError('Velg hvem som vant kampen');
  if (!METHODS.includes(input.method)) throw new BetError('Velg vinnermetode (KO, TKO eller poeng)');
  return { winner: input.winner, method: input.method };
}

// Saving a result closes the match for betting for good. Correcting or removing
// the result later never reopens it, because everyone has seen the outcome.
function recordResult(state, match, input) {
  const result = normalizeResult(match, input);
  const matchState = state.matches[match.id];
  matchState.result = result;
  if (result) matchState.stage = 'done';
  return settleAll(state);
}

// Saves the admin's result for later. Before it has been shown nothing happens to
// the bets; once shown, a correction is applied (and settled) straight away.
function planResult(state, match, input) {
  const result = normalizeResult(match, input);
  const matchState = state.matches[match.id];
  matchState.plannedResult = result;
  if (!matchState.result) return { changed: 0, published: false };
  return { ...recordResult(state, match, result), published: Boolean(result) };
}

// Shows the saved result: settles the bets and closes the match for good.
function publishResult(state, match) {
  const { plannedResult } = state.matches[match.id];
  if (!plannedResult) throw new BetError('Lagre resultatet for kampen først');
  return recordResult(state, match, plannedResult);
}

function selectionOutcome(sel, result) {
  if (!result) return 'pending';
  if (sel.market === 'winner') return sel.fighter === result.winner ? 'won' : 'lost';
  return sel.fighter === result.winner && sel.method === result.method ? 'won' : 'lost';
}

function evaluateBet(bet, matchStates) {
  const outcomes = bet.selections.map((sel) => {
    const matchState = matchStates[sel.matchId];
    return selectionOutcome(sel, matchState ? matchState.result : null);
  });
  if (outcomes.includes('lost')) return { status: 'lost', payoutOre: 0, outcomes };
  if (outcomes.includes('pending')) return { status: 'open', payoutOre: 0, outcomes };
  const odds = combinedOdds(bet.selections.map((sel) => sel.odds));
  return { status: 'won', payoutOre: payoutFor(bet.stakeOre, odds), outcomes };
}

// Recomputes every bet from the current results. Running it again with the same
// results changes nothing, so a bet can never be paid out twice, and a corrected
// result replaces the old payout instead of adding to it.
function settleAll(state, now = Date.now()) {
  let changed = 0;
  state.bets.forEach((bet) => {
    const next = evaluateBet(bet, state.matches);
    if (next.status !== bet.status || next.payoutOre !== bet.payoutOre) {
      changed += 1;
      bet.settledAt = next.status === 'open' ? null : now;
    }
    bet.status = next.status;
    bet.payoutOre = next.payoutOre;
    bet.outcomes = next.outcomes;
  });
  return { changed };
}

function buildLeaderboard(state) {
  const rows = Object.entries(state.voters).map(([voterId, voter]) => {
    const wallet = walletOf(state, voterId);
    const bets = state.bets.filter((b) => b.voterId === voterId);
    const won = bets.filter((b) => b.status === 'won');
    const lost = bets.filter((b) => b.status === 'lost');
    const decided = won.length + lost.length;
    const netOre = wallet.ledgerOre - START_BALANCE_ORE;
    return {
      voterId,
      name: voter.name,
      registeredAt: voter.registeredAt || 0,
      balanceOre: wallet.balanceOre,
      debtOre: wallet.debtOre,
      openStakeOre: wallet.openStakeOre,
      netOre,
      netPct: Math.round((netOre / START_BALANCE_ORE) * 1000) / 10,
      betCount: bets.length,
      wonCount: won.length,
      lostCount: lost.length,
      hitRatePct: decided ? Math.round((won.length / decided) * 1000) / 10 : null,
      biggestWinOre: won.reduce((max, b) => Math.max(max, b.payoutOre), 0),
    };
  });
  rows.sort((a, b) => b.netOre - a.netOre || a.registeredAt - b.registeredAt);
  rows.forEach((row, i) => {
    row.rank = i > 0 && rows[i - 1].netOre === row.netOre ? rows[i - 1].rank : i + 1;
  });
  return rows;
}

function backingFor(state, match) {
  const byFighterOre = { [match.fighterA]: 0, [match.fighterB]: 0 };
  let totalStakeOre = 0;
  let betCount = 0;
  state.bets.forEach((bet) => {
    const onMatch = bet.selections.filter((sel) => sel.matchId === match.id);
    if (!onMatch.length) return;
    betCount += 1;
    totalStakeOre += bet.stakeOre;
    const backed = onMatch.find((sel) => sel.market === 'winner' || sel.market === 'method');
    if (backed) byFighterOre[backed.fighter] += bet.stakeOre;
  });
  return { byFighterOre, totalStakeOre, betCount };
}

// How many bets include each selection, and how much money rides on those bets.
function selectionStats(state) {
  const stats = {};
  state.bets.forEach((bet) => {
    bet.selections.forEach((sel) => {
      if (!stats[sel.key]) stats[sel.key] = { betCount: 0, stakeOre: 0 };
      stats[sel.key].betCount += 1;
      stats[sel.key].stakeOre += bet.stakeOre;
    });
  });
  return stats;
}

function matchSummaryFor(state, voterId, matchId) {
  const summary = { bets: 0, won: 0, lost: 0, open: 0, stakeOre: 0, payoutOre: 0 };
  state.bets.forEach((bet) => {
    if (bet.voterId !== voterId || !bet.selections.some((sel) => sel.matchId === matchId)) return;
    summary.bets += 1;
    summary.stakeOre += bet.stakeOre;
    summary[bet.status] += 1;
    summary.payoutOre += bet.payoutOre;
  });
  return summary;
}

function describeSelection(sel, fighters) {
  const name = fighters[sel.fighter] ? fighters[sel.fighter].name : sel.fighter;
  if (sel.market === 'winner') return { label: `${name} vinner kampen`, short: name };
  return { label: `${name} vinner på ${METHOD_LABELS[sel.method]}`, short: METHOD_SHORT[sel.method] };
}

function describeResult(result, fighters) {
  const name = fighters[result.winner] ? fighters[result.winner].name : result.winner;
  if (result.method === 'POENG') return `${name} vant på poeng etter 3 runder`;
  return `${name} vant på ${METHOD_LABELS[result.method]} i runde 3`;
}

module.exports = {
  START_BALANCE_ORE,
  MIN_STAKE_ORE,
  MAX_SELECTIONS,
  STAGES,
  METHODS,
  MARKETS,
  MARKET_LABELS,
  STAGE_LABELS,
  METHOD_SHORT,
  ODDS_PROFILES,
  BetError,
  isVoter,
  formatKr,
  defaultMatchState,
  selectionsForMatch,
  parseSelection,
  baseOdds,
  computeOdds,
  normalizeOddsConfig,
  isMarketOpen,
  findConflict,
  combinedOdds,
  payoutFor,
  walletOf,
  placeBet,
  normalizeResult,
  recordResult,
  planResult,
  publishResult,
  selectionOutcome,
  evaluateBet,
  settleAll,
  buildLeaderboard,
  backingFor,
  selectionStats,
  matchSummaryFor,
  describeSelection,
  describeResult,
};
