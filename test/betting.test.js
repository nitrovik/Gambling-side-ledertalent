const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const betting = require('../betting');

const {
  BetError,
  defaultMatchState,
  selectionsForMatch,
  baseOdds,
  computeOdds,
  normalizeOddsConfig,
  isMarketOpen,
  findConflict,
  parseSelection,
  combinedOdds,
  payoutFor,
  walletOf,
  placeBet,
  normalizeResult,
  recordResult,
  settleAll,
  buildLeaderboard,
  backingFor,
  selectionStats,
  matchSummaryFor,
  START_BALANCE_ORE,
} = betting;

const MATCHES = [
  { id: 'match1', title: 'Kamp 1', fighterA: 'rita', fighterB: 'pal' },
  { id: 'match2', title: 'Kamp 2', fighterA: 'petra', fighterB: 'morten' },
];

function newState() {
  return {
    voters: {
      v1: { name: 'Kari', registeredAt: 1 },
      v2: { name: 'Ola', registeredAt: 2 },
      v3: { name: 'Siri', registeredAt: 3 },
    },
    bets: [],
    betSeq: 0,
    matches: { match1: defaultMatchState(), match2: defaultMatchState() },
  };
}

function place(state, voterId, selections, stakeKr, extra = {}) {
  return placeBet(state, MATCHES, { voterId, selections, stakeOre: Math.round(stakeKr * 100), ...extra }).bet;
}

function setResult(state, matchId, input) {
  return recordResult(state, MATCHES.find((m) => m.id === matchId), input);
}

function balanceKr(state, voterId) {
  return walletOf(state, voterId).balanceOre / 100;
}

const RITA_WINS_KO = { winner: 'rita', method: 'KO' };
const RITA_ON_POINTS = { winner: 'rita', method: 'POENG' };

describe('oddsberegning', () => {
  it('det finnes bare to markeder: kampvinner og vinnermetode', () => {
    assert.deepEqual(betting.MARKETS, ['winner', 'method']);
    const keys = selectionsForMatch(MATCHES[0]).map((sel) => sel.key);
    assert.equal(keys.length, 8);
    assert.equal(keys.some((key) => /:r\d:/.test(key)), false);
    assert.equal(parseSelection('match1:r1:rita', MATCHES), null);
  });

  it('jevn kamp gir 1.87 på kampvinner og 3.75/6.25/9.50 på metode for begge', () => {
    const odds = baseOdds(MATCHES[0], { profile: 'even', favorite: null, overrides: {} });
    ['rita', 'pal'].forEach((f) => {
      assert.equal(odds[`match1:winner:${f}`], 1.87);
      assert.equal(odds[`match1:method:${f}:POENG`], 3.75);
      assert.equal(odds[`match1:method:${f}:TKO`], 6.25);
      assert.equal(odds[`match1:method:${f}:KO`], 9.5);
    });
  });

  it('favoritt/underdog gir riktig odds til riktig fighter', () => {
    const odds = baseOdds(MATCHES[0], { profile: 'favorite', favorite: 'rita', overrides: {} });
    assert.equal(odds['match1:winner:rita'], 1.55);
    assert.equal(odds['match1:winner:pal'], 2.35);
    assert.deepEqual(
      ['POENG', 'TKO', 'KO'].map((m) => odds[`match1:method:rita:${m}`]),
      [3.1, 5.2, 7.8],
    );
    assert.deepEqual(
      ['POENG', 'TKO', 'KO'].map((m) => odds[`match1:method:pal:${m}`]),
      [4.25, 8.5, 13],
    );
  });

  it('favoritten kan byttes til den andre fighteren', () => {
    const odds = baseOdds(MATCHES[0], { profile: 'favorite', favorite: 'pal', overrides: {} });
    assert.equal(odds['match1:winner:pal'], 1.55);
    assert.equal(odds['match1:winner:rita'], 2.35);
    assert.equal(odds['match1:method:rita:KO'], 13);
  });

  it('hvert marked har ca. 7 % margin i begge profilene', () => {
    [
      { profile: 'even', favorite: null, overrides: {} },
      { profile: 'favorite', favorite: 'rita', overrides: {} },
    ].forEach((config) => {
      const odds = baseOdds(MATCHES[0], config);
      betting.MARKETS.forEach((market) => {
        const keys = selectionsForMatch(MATCHES[0]).filter((s) => s.market === market).map((s) => s.key);
        const overround = keys.reduce((sum, key) => sum + 1 / odds[key], 0) - 1;
        assert.ok(overround > 0.05 && overround < 0.08, `${config.profile}/${market}: ${overround}`);
      });
    });
  });

  it('manuell overstyring endrer bare det ene valget', () => {
    const config = normalizeOddsConfig(MATCHES[0], {
      profile: 'even',
      overrides: { 'match1:winner:rita': '2,456', 'match1:method:pal:KO': '' },
    });
    assert.deepEqual(config.overrides, { 'match1:winner:rita': 2.46 });
    const odds = computeOdds(MATCHES[0], config);
    assert.equal(odds['match1:winner:rita'], 2.46);
    assert.equal(odds['match1:winner:pal'], 1.87);
    assert.equal(odds['match1:method:pal:KO'], 9.5);
  });

  it('kveldens odds: Rita 3.75 / Pål 1.87, og Petra litt lavere enn Morten', () => {
    const [match1, match2] = require('../server').MATCH_DEFS;
    const kamp1 = baseOdds(match1, defaultMatchState(match1).odds);
    const kamp2 = baseOdds(match2, defaultMatchState(match2).odds);
    assert.equal(defaultMatchState(match1).odds.profile, 'standard');
    assert.equal(kamp1['match1:winner:rita'], 3.75);
    assert.equal(kamp1['match1:winner:pal'], 1.87);
    assert.ok(kamp2['match2:winner:petra'] < kamp2['match2:winner:morten']);
    assert.ok(kamp2['match2:winner:morten'] - kamp2['match2:winner:petra'] <= 0.5);
    // KO pays more than TKO, TKO more than poeng, and the methods together match the winner odds.
    [[match1, kamp1], [match2, kamp2]].forEach(([match, odds]) => {
      [match.fighterA, match.fighterB].forEach((f) => {
        const [poeng, tko, ko] = ['POENG', 'TKO', 'KO'].map((m) => odds[`${match.id}:method:${f}:${m}`]);
        assert.ok(odds[`${match.id}:winner:${f}`] < poeng && poeng < tko && tko < ko, f);
        const methods = 1 / poeng + 1 / tko + 1 / ko;
        assert.ok(Math.abs(methods - 1 / odds[`${match.id}:winner:${f}`]) < 0.01, f);
      });
    });
  });

  it('avviser ugyldige oddsinnstillinger', () => {
    const bad = [
      { profile: 'nope' },
      { profile: 'standard' },
      { profile: 'favorite' },
      { profile: 'favorite', favorite: 'petra' },
      { profile: 'even', overrides: { 'match1:winner:rita': 1.0 } },
      { profile: 'even', overrides: { 'match1:winner:rita': 'abc' } },
      { profile: 'even', overrides: { 'match1:winner:rita': 5000 } },
      { profile: 'even', overrides: { 'match2:winner:petra': 2 } },
    ];
    bad.forEach((input) => assert.throws(() => normalizeOddsConfig(MATCHES[0], input), BetError, JSON.stringify(input)));
  });

  it('kombinert odds er produktet av oddsene og gevinst rundes til nærmeste øre', () => {
    const odds = combinedOdds([1.87, 1.87, 1.87]);
    assert.ok(Math.abs(odds - 6.539203) < 1e-9);
    assert.equal(payoutFor(1000, odds), 6539);
    assert.equal(payoutFor(1000, 1.87), 1870);
  });

  it('en levert bong beholder oddsen den ble levert med selv om admin endrer odds', () => {
    const state = newState();
    const bet = place(state, 'v1', ['match1:winner:rita'], 100);
    state.matches.match1.odds = normalizeOddsConfig(MATCHES[0], { profile: 'favorite', favorite: 'pal' });
    setResult(state, 'match1', RITA_WINS_KO);
    assert.equal(bet.selections[0].odds, 1.87);
    assert.equal(bet.payoutOre, 18700);
  });
});

describe('kombinasjonsbonger og motstridende valg', () => {
  const parse = (keys) => keys.map((k) => parseSelection(k, MATCHES));

  it('tillater valg som ikke motsier hverandre', () => {
    [
      ['match1:winner:rita', 'match2:winner:petra'],
      ['match1:method:rita:TKO', 'match2:method:morten:POENG'],
      ['match1:method:rita:KO', 'match2:winner:petra'],
      ['match1:winner:rita', 'match1:method:rita:KO'],
      ['match1:winner:pal', 'match1:method:pal:POENG', 'match2:winner:morten', 'match2:method:morten:TKO'],
    ].forEach((keys) => assert.equal(findConflict(parse(keys)), null, keys.join(' + ')));
  });

  it('blokkerer valg som motsier hverandre', () => {
    const cases = [
      [['match1:winner:rita', 'match1:winner:pal'], /samme kamp/],
      [['match1:method:rita:KO', 'match1:method:rita:TKO'], /én måte/],
      [['match1:method:rita:KO', 'match1:method:pal:POENG'], /én måte/],
      [['match1:winner:rita', 'match1:method:pal:KO'], /motsier/],
      [['match1:method:pal:KO', 'match1:winner:rita'], /motsier/],
      [['match1:winner:rita', 'match1:winner:rita'], /én gang/],
    ];
    cases.forEach(([keys, pattern]) => assert.match(findConflict(parse(keys)), pattern, keys.join(' + ')));
  });

  it('en bong med motstridende valg blir avvist uten å trekke penger', () => {
    const state = newState();
    assert.throws(() => place(state, 'v1', ['match1:winner:rita', 'match1:method:pal:KO'], 100), /motsier/);
    assert.equal(state.bets.length, 0);
    assert.equal(balanceKr(state, 'v1'), 2000);
  });

  it('avviser tom bong, ukjente valg og for mange valg', () => {
    const state = newState();
    assert.throws(() => place(state, 'v1', [], 100), /tom/);
    assert.throws(() => place(state, 'v1', ['match1:winner:petra'], 100), /ugyldig/);
    assert.throws(() => place(state, 'v1', ['match3:winner:rita'], 100), /ugyldig/);
    assert.throws(() => place(state, 'v1', [42], 100), /ugyldig/);
    assert.throws(() => place(state, 'v1', new Array(11).fill('match1:winner:rita'), 100), /maks/);
  });
});

describe('låsing', () => {
  it('spillet er åpent til runde 1 starter, og stengt resten av kampen', () => {
    const expectations = { open: true, r1: false, r2: false, r3: false, done: false };
    Object.entries(expectations).forEach(([stage, open]) => {
      assert.equal(isMarketOpen({ stage, result: null }), open, stage);
    });
  });

  it('et registrert resultat stenger kampen', () => {
    assert.equal(isMarketOpen({ stage: 'open', result: RITA_WINS_KO }), false);
  });

  it('når resultatet er lagret er kampen stengt for godt – også om resultatet rettes eller fjernes', () => {
    const state = newState();
    setResult(state, 'match1', RITA_WINS_KO);
    assert.equal(state.matches.match1.stage, 'done');
    const keys = selectionsForMatch(MATCHES[0]).map((sel) => sel.key);
    keys.forEach((key) => assert.throws(() => place(state, 'v1', [key], 100), /låst/, key));

    setResult(state, 'match1', { ...RITA_ON_POINTS, winner: 'pal' });
    setResult(state, 'match1', null);
    assert.equal(state.matches.match1.result, null);
    assert.equal(state.matches.match1.stage, 'done');
    keys.forEach((key) => assert.throws(() => place(state, 'v1', [key], 100), /låst/, key));
    assert.throws(() => place(state, 'v1', ['match2:winner:petra', 'match1:winner:pal'], 100), /låst/);

    place(state, 'v1', ['match2:winner:petra'], 100);
    assert.equal(state.bets.length, 1);
    assert.equal(balanceKr(state, 'v1'), 1900);
  });

  it('avviser bonger på kampen når runde 1 har startet, men den andre kampen er fortsatt åpen', () => {
    const state = newState();
    place(state, 'v1', ['match1:winner:rita'], 100);
    state.matches.match1.stage = 'r1';
    assert.throws(() => place(state, 'v1', ['match1:winner:rita'], 100), /Kampvinner i Kamp 1 er låst/);
    assert.throws(() => place(state, 'v1', ['match1:method:rita:KO'], 100), /Vinnermetode i Kamp 1 er låst/);
    place(state, 'v1', ['match2:winner:petra'], 100);
    assert.equal(state.bets.length, 2);
  });

  it('en kombinasjonsbong med ett låst valg avvises i sin helhet', () => {
    const state = newState();
    state.matches.match1.stage = 'r1';
    assert.throws(() => place(state, 'v1', ['match2:winner:petra', 'match1:winner:rita'], 100), /låst/);
    assert.equal(state.bets.length, 0);
    assert.equal(balanceKr(state, 'v1'), 2000);
  });
});

describe('innsats og saldo', () => {
  it('alle starter med 2000 kr og innsatsen trekkes når bongen leveres', () => {
    const state = newState();
    assert.equal(balanceKr(state, 'v1'), 2000);
    place(state, 'v1', ['match1:winner:rita'], 150);
    const wallet = walletOf(state, 'v1');
    assert.equal(wallet.balanceOre, 185000);
    assert.equal(wallet.openStakeOre, 15000);
    assert.equal(balanceKr(state, 'v2'), 2000);
  });

  it('minsteinnsats er 10 kr', () => {
    const state = newState();
    assert.throws(() => place(state, 'v1', ['match1:winner:rita'], 9.99), /Minsteinnsats/);
    place(state, 'v1', ['match1:winner:rita'], 10);
    assert.equal(balanceKr(state, 'v1'), 1990);
  });

  it('avviser innsats som ikke er hele øre', () => {
    const state = newState();
    assert.throws(
      () => placeBet(state, MATCHES, { voterId: 'v1', selections: ['match1:winner:rita'], stakeOre: 1000.5 }),
      /Ugyldig innsats/,
    );
    assert.throws(
      () => placeBet(state, MATCHES, { voterId: 'v1', selections: ['match1:winner:rita'], stakeOre: '1000' }),
      /Ugyldig innsats/,
    );
  });

  it('kan aldri satse mer enn saldoen, men kan gå all in', () => {
    const state = newState();
    assert.throws(() => place(state, 'v1', ['match1:winner:rita'], 2000.01), /saldoen/);
    place(state, 'v1', ['match1:winner:rita'], 2000);
    assert.equal(balanceKr(state, 'v1'), 0);
    assert.throws(() => place(state, 'v1', ['match1:winner:pal'], 10), /saldoen/);
  });

  it('krever registrert deltaker', () => {
    const state = newState();
    ['ukjent', 'constructor', '__proto__', 'toString', undefined, 42].forEach((voterId) => {
      assert.throws(() => place(state, voterId, ['match1:winner:rita'], 100), /registrere/, String(voterId));
    });
    assert.equal(state.bets.length, 0);
  });

  it('samme bong-ID leveres bare én gang (dobbelttrykk)', () => {
    const state = newState();
    const first = placeBet(state, MATCHES, { voterId: 'v1', selections: ['match1:winner:rita'], stakeOre: 10000, clientBetId: 'abc' });
    const second = placeBet(state, MATCHES, { voterId: 'v1', selections: ['match1:winner:rita'], stakeOre: 10000, clientBetId: 'abc' });
    assert.equal(first.duplicate, false);
    assert.equal(second.duplicate, true);
    assert.equal(second.bet.id, first.bet.id);
    assert.equal(state.bets.length, 1);
    assert.equal(balanceKr(state, 'v1'), 1900);
  });

  it('avviser bongen hvis oddsen er endret siden deltakeren så den', () => {
    const state = newState();
    assert.throws(
      () => place(state, 'v1', ['match1:winner:rita'], 100, { expectedOdds: { 'match1:winner:rita': 1.55 } }),
      /Oddsen er endret/,
    );
    place(state, 'v1', ['match1:winner:rita'], 100, { expectedOdds: { 'match1:winner:rita': 1.87 } });
    assert.equal(state.bets.length, 1);
  });
});

describe('avgjøring', () => {
  it('singelbong: gevinst = innsats × odds og legges til saldo', () => {
    const state = newState();
    place(state, 'v1', ['match1:winner:rita'], 100);
    place(state, 'v2', ['match1:winner:pal'], 100);
    setResult(state, 'match1', RITA_WINS_KO);
    assert.equal(state.bets[0].status, 'won');
    assert.equal(state.bets[0].payoutOre, 18700);
    assert.equal(state.bets[1].status, 'lost');
    assert.equal(balanceKr(state, 'v1'), 2087);
    assert.equal(balanceKr(state, 'v2'), 1900);
  });

  it('kombinasjonsbong: alle valg må treffe, oddsen multipliseres', () => {
    const state = newState();
    const hit = place(state, 'v1', ['match1:winner:rita', 'match1:method:rita:KO'], 10);
    const miss = place(state, 'v2', ['match1:winner:rita', 'match1:method:rita:TKO'], 10);
    setResult(state, 'match1', RITA_WINS_KO);
    assert.equal(hit.status, 'won');
    assert.equal(hit.payoutOre, payoutFor(1000, 1.87 * 9.5));
    assert.deepEqual(hit.outcomes, ['won', 'won']);
    assert.deepEqual(miss.outcomes, ['won', 'lost']);
    assert.equal(miss.status, 'lost');
    assert.equal(miss.payoutOre, 0);
  });

  it('kampvinner og vinnermetode i begge kamper kan stackes på én bong', () => {
    const state = newState();
    const keys = ['match1:winner:rita', 'match1:method:rita:KO', 'match2:winner:petra', 'match2:method:petra:POENG'];
    const bet = place(state, 'v1', keys, 10);
    const odds = 1.87 * 9.5 * 1.87 * 3.75;
    setResult(state, 'match1', RITA_WINS_KO);
    assert.equal(bet.status, 'open');
    setResult(state, 'match2', { winner: 'petra', method: 'POENG' });
    assert.equal(bet.status, 'won');
    assert.equal(bet.payoutOre, payoutFor(1000, odds));
    assert.equal(balanceKr(state, 'v1'), 1990 + bet.payoutOre / 100);
  });

  it('vinnermetode treffer bare på riktig fighter og riktig metode', () => {
    const state = newState();
    const ko = place(state, 'v1', ['match1:method:rita:KO'], 100);
    const tko = place(state, 'v1', ['match1:method:rita:TKO'], 100);
    const palKo = place(state, 'v1', ['match1:method:pal:KO'], 100);
    setResult(state, 'match1', RITA_WINS_KO);
    assert.equal(ko.status, 'won');
    assert.equal(ko.payoutOre, 95000);
    assert.equal(tko.status, 'lost');
    assert.equal(palKo.status, 'lost');
  });

  it('kombinasjon over to kamper venter på begge, men tapes med én gang ved bom', () => {
    const state = newState();
    const waiting = place(state, 'v1', ['match1:winner:rita', 'match2:winner:petra'], 100);
    const busted = place(state, 'v2', ['match1:winner:pal', 'match2:winner:petra'], 100);
    setResult(state, 'match1', RITA_WINS_KO);
    assert.equal(waiting.status, 'open');
    assert.deepEqual(waiting.outcomes, ['won', 'pending']);
    assert.equal(busted.status, 'lost');
    setResult(state, 'match2', { winner: 'petra', method: 'POENG' });
    assert.equal(waiting.status, 'won');
    assert.equal(waiting.payoutOre, payoutFor(10000, 1.87 * 1.87));
  });

  it('en bong avgjøres aldri to ganger', () => {
    const state = newState();
    place(state, 'v1', ['match1:winner:rita'], 100);
    setResult(state, 'match1', RITA_WINS_KO);
    const before = balanceKr(state, 'v1');
    const again = settleAll(state);
    const thirdTime = settleAll(state);
    assert.equal(again.changed, 0);
    assert.equal(thirdTime.changed, 0);
    assert.equal(balanceKr(state, 'v1'), before);
    assert.equal(before, 2087);
  });

  it('retting av feil resultat avgjør bongene på nytt riktig', () => {
    const state = newState();
    place(state, 'v1', ['match1:winner:rita'], 100);
    place(state, 'v2', ['match1:winner:pal'], 100);
    setResult(state, 'match1', RITA_WINS_KO);
    assert.equal(balanceKr(state, 'v1'), 2087);
    assert.equal(balanceKr(state, 'v2'), 1900);

    const correction = setResult(state, 'match1', { winner: 'pal', method: 'TKO' });
    assert.equal(correction.changed, 2);
    assert.equal(balanceKr(state, 'v1'), 1900);
    assert.equal(balanceKr(state, 'v2'), 2087);

    setResult(state, 'match1', RITA_WINS_KO);
    assert.equal(balanceKr(state, 'v1'), 2087);
    assert.equal(balanceKr(state, 'v2'), 1900);
  });

  it('å fjerne et resultat gjør bongene åpne igjen', () => {
    const state = newState();
    const bet = place(state, 'v1', ['match1:winner:rita'], 100);
    setResult(state, 'match1', RITA_WINS_KO);
    setResult(state, 'match1', null);
    assert.equal(bet.status, 'open');
    assert.equal(bet.payoutOre, 0);
    assert.equal(bet.settledAt, null);
    assert.equal(balanceKr(state, 'v1'), 1900);
  });
});

describe('resultat', () => {
  it('resultatet er bare kampvinner og metode – rundevinnere registreres ikke', () => {
    const match = MATCHES[0];
    assert.deepEqual(normalizeResult(match, RITA_WINS_KO), { winner: 'rita', method: 'KO' });
    assert.deepEqual(
      normalizeResult(match, { ...RITA_ON_POINTS, roundWinners: { 1: 'pal', 2: 'pal', 3: 'pal' } }),
      { winner: 'rita', method: 'POENG' },
    );
    assert.equal(betting.describeResult(RITA_WINS_KO, { rita: { name: 'Rita Relator' } }), 'Rita Relator vant på KO i runde 3');
    assert.equal(betting.describeResult(RITA_ON_POINTS, { rita: { name: 'Rita Relator' } }), 'Rita Relator vant på poeng etter 3 runder');
  });

  it('validerer resultatet', () => {
    const match = MATCHES[0];
    assert.throws(() => normalizeResult(match, { ...RITA_ON_POINTS, winner: 'petra' }), /vant kampen/);
    assert.throws(() => normalizeResult(match, { ...RITA_ON_POINTS, method: 'DQ' }), /vinnermetode/);
    assert.throws(() => normalizeResult(match, { method: 'KO' }), /vant kampen/);
    assert.throws(() => normalizeResult(match, undefined), /Mangler/);
    assert.equal(normalizeResult(match, null), null);
  });
});

describe('korrigering etter at gevinsten er brukt', () => {
  it('saldo blir aldri negativ – differansen blir gjeld som trekkes fra neste gevinst', () => {
    const state = newState();
    place(state, 'v1', ['match1:winner:rita'], 1000);
    setResult(state, 'match1', RITA_WINS_KO);
    assert.equal(balanceKr(state, 'v1'), 2870);
    place(state, 'v1', ['match2:winner:petra'], 2870);
    assert.equal(balanceKr(state, 'v1'), 0);

    setResult(state, 'match1', { ...RITA_WINS_KO, winner: 'pal' });
    const wallet = walletOf(state, 'v1');
    assert.equal(wallet.balanceOre, 0);
    assert.equal(wallet.debtOre, 187000);
    assert.throws(() => place(state, 'v1', ['match2:method:petra:KO'], 10), /saldoen/);

    setResult(state, 'match2', { winner: 'petra', method: 'POENG' });
    const after = walletOf(state, 'v1');
    assert.equal(after.debtOre, 0);
    assert.equal(after.balanceOre, 2000 * 100 - 100000 - 287000 + payoutFor(287000, 1.87));
  });

  it('saldo er aldri negativ og alt stemmer gjennom tilfeldige spill og rettinger', () => {
    let seed = 42;
    const random = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    const pick = (list) => list[Math.floor(random() * list.length)];
    const state = newState();
    const allKeys = MATCHES.flatMap((m) => selectionsForMatch(m).map((s) => s.key));
    const randomResult = (match) => {
      return { winner: pick([match.fighterA, match.fighterB]), method: pick(['POENG', 'TKO', 'KO']) };
    };

    for (let i = 0; i < 600; i += 1) {
      const action = random();
      if (action < 0.75) {
        const voterId = pick(['v1', 'v2', 'v3']);
        const count = random() < 0.6 ? 1 : 2 + Math.floor(random() * 2);
        const keys = Array.from({ length: count }, () => pick(allKeys));
        const stakeOre = 1000 + Math.floor(random() * 20000);
        try {
          placeBet(state, MATCHES, { voterId, selections: keys, stakeOre });
        } catch (err) {
          assert.ok(err instanceof BetError, err.message);
        }
      } else if (action < 0.85) {
        const match = pick(MATCHES);
        state.matches[match.id].stage = pick(['open', 'open', 'r1', 'r2', 'r3']);
      } else if (action < 0.95) {
        const match = pick(MATCHES);
        recordResult(state, match, randomResult(match));
      } else {
        recordResult(state, pick(MATCHES), null);
      }

      ['v1', 'v2', 'v3'].forEach((voterId) => {
        const wallet = walletOf(state, voterId);
        assert.ok(wallet.balanceOre >= 0);
        assert.ok(wallet.debtOre >= 0);
        const bets = state.bets.filter((b) => b.voterId === voterId);
        const expected = START_BALANCE_ORE + bets.reduce((sum, b) => sum + b.payoutOre - b.stakeOre, 0);
        assert.equal(wallet.ledgerOre, expected);
      });
      const snapshot = JSON.stringify(state.bets);
      assert.equal(settleAll(state).changed, 0);
      assert.equal(JSON.stringify(state.bets), snapshot);
    }
    assert.ok(state.bets.length > 20, `bare ${state.bets.length} bonger ble levert`);
  });
});

describe('toppliste', () => {
  it('sorteres på saldo og viser avkastning, antall bonger, treffprosent og største gevinst', () => {
    const state = newState();
    place(state, 'v1', ['match1:winner:rita'], 100);
    place(state, 'v1', ['match1:method:rita:TKO'], 100);
    place(state, 'v1', ['match1:method:rita:KO'], 100);
    place(state, 'v1', ['match2:winner:petra'], 50);
    place(state, 'v2', ['match1:winner:pal'], 500);
    setResult(state, 'match1', RITA_WINS_KO);

    const rows = buildLeaderboard(state);
    assert.deepEqual(rows.map((r) => r.name), ['Kari', 'Siri', 'Ola']);

    const kari = rows[0];
    assert.equal(kari.rank, 1);
    assert.equal(kari.balanceOre, 200000 - 35000 + 18700 + 95000);
    assert.equal(kari.netOre, kari.balanceOre - 200000);
    assert.equal(kari.netPct, Math.round((kari.netOre / 200000) * 1000) / 10);
    assert.equal(kari.betCount, 4);
    assert.equal(kari.wonCount, 2);
    assert.equal(kari.lostCount, 1);
    assert.equal(kari.hitRatePct, 66.7);
    assert.equal(kari.biggestWinOre, 95000);
    assert.equal(kari.openStakeOre, 5000);

    const siri = rows[1];
    assert.equal(siri.balanceOre, 200000);
    assert.equal(siri.netPct, 0);
    assert.equal(siri.hitRatePct, null);

    const ola = rows[2];
    assert.equal(ola.netOre, -50000);
    assert.equal(ola.netPct, -25);
    assert.equal(ola.hitRatePct, 0);
  });

  it('lik saldo gir lik plassering', () => {
    const rows = buildLeaderboard(newState());
    assert.deepEqual(rows.map((r) => r.rank), [1, 1, 1]);
  });
});

describe('statistikk per kamp', () => {
  it('teller bonger og innsats per valg – kombinasjoner teller på hvert valg', () => {
    const state = newState();
    place(state, 'v1', ['match1:winner:rita'], 100);
    place(state, 'v2', ['match1:winner:rita', 'match1:method:rita:KO', 'match2:winner:petra'], 50);
    place(state, 'v3', ['match1:winner:pal'], 20);
    const stats = selectionStats(state);
    assert.deepEqual(stats['match1:winner:rita'], { betCount: 2, stakeOre: 15000 });
    assert.deepEqual(stats['match1:method:rita:KO'], { betCount: 1, stakeOre: 5000 });
    assert.deepEqual(stats['match2:winner:petra'], { betCount: 1, stakeOre: 5000 });
    assert.deepEqual(stats['match1:winner:pal'], { betCount: 1, stakeOre: 2000 });
    assert.equal(stats['match1:method:pal:KO'], undefined);
  });

  it('summerer penger på hver fighter og deltakerens resultat på kampen', () => {
    const state = newState();
    place(state, 'v1', ['match1:winner:rita'], 100);
    place(state, 'v2', ['match1:method:pal:KO', 'match2:winner:petra'], 50);
    place(state, 'v3', ['match1:method:rita:POENG'], 20);
    const backing = backingFor(state, MATCHES[0]);
    assert.deepEqual(backing.byFighterOre, { rita: 12000, pal: 5000 });
    assert.equal(backing.totalStakeOre, 17000);
    assert.equal(backing.betCount, 3);

    setResult(state, 'match1', RITA_WINS_KO);
    assert.deepEqual(matchSummaryFor(state, 'v1', 'match1'), {
      bets: 1, won: 1, lost: 0, open: 0, stakeOre: 10000, payoutOre: 18700,
    });
    assert.equal(matchSummaryFor(state, 'v2', 'match1').lost, 1);
  });
});
