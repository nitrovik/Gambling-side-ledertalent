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
  settleAll,
  buildLeaderboard,
  backingFor,
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

function rounds(r1, r2, r3) {
  return { 1: r1, 2: r2, 3: r3 };
}

function setResult(state, matchId, input) {
  const match = MATCHES.find((m) => m.id === matchId);
  state.matches[matchId].result = normalizeResult(match, input);
  return settleAll(state);
}

function balanceKr(state, voterId) {
  return walletOf(state, voterId).balanceOre / 100;
}

const RITA_WINS_KO_R3 = { winner: 'rita', method: 'KO', endRound: 3, roundWinners: rounds('rita', 'pal', 'rita') };
const RITA_ON_POINTS = { winner: 'rita', method: 'POENG', endRound: 3, roundWinners: rounds('rita', 'pal', 'rita') };

describe('oddsberegning', () => {
  it('jevn kamp gir 1.87 på kampvinner/runder og 3.75/6.25/9.50 på metode for begge', () => {
    const odds = baseOdds(MATCHES[0], { profile: 'even', favorite: null, overrides: {} });
    ['rita', 'pal'].forEach((f) => {
      assert.equal(odds[`match1:winner:${f}`], 1.87);
      [1, 2, 3].forEach((n) => assert.equal(odds[`match1:r${n}:${f}`], 1.87));
      assert.equal(odds[`match1:method:${f}:POENG`], 3.75);
      assert.equal(odds[`match1:method:${f}:TKO`], 6.25);
      assert.equal(odds[`match1:method:${f}:KO`], 9.5);
    });
  });

  it('favoritt/underdog gir riktig odds til riktig fighter', () => {
    const odds = baseOdds(MATCHES[0], { profile: 'favorite', favorite: 'rita', overrides: {} });
    assert.equal(odds['match1:winner:rita'], 1.55);
    assert.equal(odds['match1:winner:pal'], 2.35);
    [1, 2, 3].forEach((n) => {
      assert.equal(odds[`match1:r${n}:rita`], 1.55);
      assert.equal(odds[`match1:r${n}:pal`], 2.35);
    });
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
      overrides: { 'match1:winner:rita': '2,456', 'match1:r1:pal': '' },
    });
    assert.deepEqual(config.overrides, { 'match1:winner:rita': 2.46 });
    const odds = computeOdds(MATCHES[0], config);
    assert.equal(odds['match1:winner:rita'], 2.46);
    assert.equal(odds['match1:winner:pal'], 1.87);
    assert.equal(odds['match1:r1:pal'], 1.87);
  });

  it('avviser ugyldige oddsinnstillinger', () => {
    const bad = [
      { profile: 'nope' },
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
    setResult(state, 'match1', RITA_WINS_KO_R3);
    assert.equal(bet.selections[0].odds, 1.87);
    assert.equal(bet.payoutOre, 18700);
  });
});

describe('kombinasjonsbonger og motstridende valg', () => {
  const parse = (keys) => keys.map((k) => parseSelection(k, MATCHES));

  it('tillater valg som ikke motsier hverandre', () => {
    [
      ['match1:winner:rita', 'match2:winner:petra'],
      ['match1:winner:rita', 'match1:r1:pal', 'match1:r2:rita', 'match1:r3:rita'],
      ['match1:method:pal:KO', 'match1:r1:rita'],
      ['match1:method:rita:TKO', 'match2:method:morten:POENG'],
    ].forEach((keys) => assert.equal(findConflict(parse(keys)), null, keys.join(' + ')));
  });

  it('blokkerer valg som motsier hverandre', () => {
    const cases = [
      [['match1:winner:rita', 'match1:winner:pal'], /samme kamp/],
      [['match1:r2:rita', 'match1:r2:pal'], /runde 2/],
      [['match1:method:rita:KO', 'match1:method:rita:TKO'], /én måte/],
      [['match1:method:rita:KO', 'match1:method:pal:POENG'], /én måte/],
      [['match1:winner:rita', 'match1:method:pal:KO'], /motsier/],
      [['match1:method:pal:KO', 'match1:winner:rita'], /motsier/],
      [['match1:winner:rita', 'match1:method:rita:KO'], /inkluderer/],
      [['match1:r1:rita', 'match1:r1:rita'], /én gang/],
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
  it('kampvinner og metode stenger ved kampstart, runde N stenger når runde N starter', () => {
    const expectations = {
      open: { winner: true, method: true, r1: true, r2: true, r3: true },
      r1: { winner: false, method: false, r1: false, r2: true, r3: true },
      r2: { winner: false, method: false, r1: false, r2: false, r3: true },
      r3: { winner: false, method: false, r1: false, r2: false, r3: false },
    };
    Object.entries(expectations).forEach(([stage, markets]) => {
      Object.entries(markets).forEach(([market, open]) => {
        assert.equal(isMarketOpen({ stage, result: null }, market), open, `${stage}/${market}`);
      });
    });
  });

  it('et registrert resultat stenger alle markeder', () => {
    betting.MARKETS.forEach((market) => {
      assert.equal(isMarketOpen({ stage: 'open', result: RITA_WINS_KO_R3 }, market), false);
    });
  });

  it('avviser bonger på låste markeder, men tillater senere runder', () => {
    const state = newState();
    state.matches.match1.stage = 'r1';
    assert.throws(() => place(state, 'v1', ['match1:winner:rita'], 100), /Kampvinner i Kamp 1 er låst/);
    assert.throws(() => place(state, 'v1', ['match1:method:rita:KO'], 100), /låst/);
    assert.throws(() => place(state, 'v1', ['match1:r1:rita'], 100), /låst/);
    place(state, 'v1', ['match1:r2:rita'], 100);
    state.matches.match1.stage = 'r2';
    assert.throws(() => place(state, 'v1', ['match1:r2:rita'], 100), /låst/);
    place(state, 'v1', ['match1:r3:pal'], 100);
    state.matches.match1.stage = 'r3';
    assert.throws(() => place(state, 'v1', ['match1:r3:pal'], 100), /låst/);
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
    setResult(state, 'match1', RITA_WINS_KO_R3);
    assert.equal(state.bets[0].status, 'won');
    assert.equal(state.bets[0].payoutOre, 18700);
    assert.equal(state.bets[1].status, 'lost');
    assert.equal(balanceKr(state, 'v1'), 2087);
    assert.equal(balanceKr(state, 'v2'), 1900);
  });

  it('kombinasjonsbong: alle valg må treffe, oddsen multipliseres', () => {
    const state = newState();
    const hit = place(state, 'v1', ['match1:winner:rita', 'match1:r1:rita', 'match1:r2:pal'], 10);
    const miss = place(state, 'v2', ['match1:winner:rita', 'match1:r2:rita'], 10);
    setResult(state, 'match1', RITA_WINS_KO_R3);
    assert.equal(hit.status, 'won');
    assert.equal(hit.payoutOre, payoutFor(1000, 1.87 * 1.87 * 1.87));
    assert.deepEqual(hit.outcomes, ['won', 'won', 'won']);
    assert.equal(miss.status, 'lost');
    assert.equal(miss.payoutOre, 0);
  });

  it('vinnermetode treffer bare på riktig fighter og riktig metode', () => {
    const state = newState();
    const ko = place(state, 'v1', ['match1:method:rita:KO'], 100);
    const tko = place(state, 'v1', ['match1:method:rita:TKO'], 100);
    const palKo = place(state, 'v1', ['match1:method:pal:KO'], 100);
    setResult(state, 'match1', RITA_WINS_KO_R3);
    assert.equal(ko.status, 'won');
    assert.equal(ko.payoutOre, 95000);
    assert.equal(tko.status, 'lost');
    assert.equal(palKo.status, 'lost');
  });

  it('kombinasjon over to kamper venter på begge, men tapes med én gang ved bom', () => {
    const state = newState();
    const waiting = place(state, 'v1', ['match1:winner:rita', 'match2:winner:petra'], 100);
    const busted = place(state, 'v2', ['match1:winner:pal', 'match2:winner:petra'], 100);
    setResult(state, 'match1', RITA_WINS_KO_R3);
    assert.equal(waiting.status, 'open');
    assert.deepEqual(waiting.outcomes, ['won', 'pending']);
    assert.equal(busted.status, 'lost');
    setResult(state, 'match2', { winner: 'petra', method: 'POENG', endRound: 3, roundWinners: rounds('petra', 'petra', 'morten') });
    assert.equal(waiting.status, 'won');
    assert.equal(waiting.payoutOre, payoutFor(10000, 1.87 * 1.87));
  });

  it('en bong avgjøres aldri to ganger', () => {
    const state = newState();
    place(state, 'v1', ['match1:winner:rita'], 100);
    setResult(state, 'match1', RITA_WINS_KO_R3);
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
    setResult(state, 'match1', RITA_WINS_KO_R3);
    assert.equal(balanceKr(state, 'v1'), 2087);
    assert.equal(balanceKr(state, 'v2'), 1900);

    const correction = setResult(state, 'match1', {
      winner: 'pal', method: 'TKO', endRound: 2, roundWinners: rounds('rita', 'pal'),
    });
    assert.equal(correction.changed, 2);
    assert.equal(balanceKr(state, 'v1'), 1900);
    assert.equal(balanceKr(state, 'v2'), 2087);

    setResult(state, 'match1', RITA_WINS_KO_R3);
    assert.equal(balanceKr(state, 'v1'), 2087);
    assert.equal(balanceKr(state, 'v2'), 1900);
  });

  it('å fjerne et resultat gjør bongene åpne igjen', () => {
    const state = newState();
    const bet = place(state, 'v1', ['match1:winner:rita'], 100);
    setResult(state, 'match1', RITA_WINS_KO_R3);
    setResult(state, 'match1', null);
    assert.equal(bet.status, 'open');
    assert.equal(bet.payoutOre, 0);
    assert.equal(bet.settledAt, null);
    assert.equal(balanceKr(state, 'v1'), 1900);
  });
});

describe('annullering når kampen stoppes før runde 3', () => {
  const KO_ROUND_1 = { winner: 'pal', method: 'KO', endRound: 1, roundWinners: rounds('pal') };

  it('singelbonger på runder som ikke ble gått får innsatsen tilbake', () => {
    const state = newState();
    const r1 = place(state, 'v1', ['match1:r1:pal'], 100);
    const r2 = place(state, 'v1', ['match1:r2:rita'], 100);
    const r3 = place(state, 'v1', ['match1:r3:pal'], 100);
    setResult(state, 'match1', KO_ROUND_1);
    assert.equal(r1.status, 'won');
    assert.equal(r2.status, 'void');
    assert.equal(r2.payoutOre, 10000);
    assert.equal(r3.status, 'void');
    assert.equal(r3.payoutOre, 10000);
    assert.equal(balanceKr(state, 'v1'), 2000 - 300 + 187 + 100 + 100);
  });

  it('i kombinasjonsbong settes det annullerte valget til odds 1.00', () => {
    const state = newState();
    const bet = place(state, 'v1', ['match1:winner:pal', 'match1:r1:pal', 'match1:r3:rita'], 100);
    setResult(state, 'match1', KO_ROUND_1);
    assert.deepEqual(bet.outcomes, ['won', 'won', 'void']);
    assert.equal(bet.status, 'won');
    assert.equal(bet.payoutOre, payoutFor(10000, 1.87 * 1.87));
  });

  it('kombinasjonsbong med bare annullerte valg får innsatsen tilbake', () => {
    const state = newState();
    const bet = place(state, 'v1', ['match1:r2:rita', 'match1:r3:pal'], 100);
    setResult(state, 'match1', KO_ROUND_1);
    assert.equal(bet.status, 'void');
    assert.equal(bet.payoutOre, 10000);
  });

  it('et tapt valg taper bongen selv om andre valg annulleres', () => {
    const state = newState();
    const bet = place(state, 'v1', ['match1:r1:rita', 'match1:r3:pal'], 100);
    setResult(state, 'match1', KO_ROUND_1);
    assert.equal(bet.status, 'lost');
  });

  it('validerer resultatet', () => {
    const match = MATCHES[0];
    assert.throws(() => normalizeResult(match, { ...RITA_ON_POINTS, endRound: 2 }), /alle tre runder/);
    assert.throws(() => normalizeResult(match, { ...RITA_ON_POINTS, winner: 'petra' }), /vant kampen/);
    assert.throws(() => normalizeResult(match, { ...RITA_ON_POINTS, method: 'DQ' }), /vinnermetode/);
    assert.throws(() => normalizeResult(match, { ...RITA_ON_POINTS, endRound: 4 }), /runde kampen endte/);
    assert.throws(() => normalizeResult(match, { ...RITA_ON_POINTS, roundWinners: rounds('rita', 'pal') }), /runde 3/);
    assert.throws(() => normalizeResult(match, undefined), /Mangler/);
    const stopped = normalizeResult(match, { winner: 'pal', method: 'TKO', endRound: 2, roundWinners: rounds('rita', 'pal', 'rita') });
    assert.deepEqual(stopped.roundWinners, { 1: 'rita', 2: 'pal', 3: null });
    assert.equal(normalizeResult(match, null), null);
  });
});

describe('korrigering etter at gevinsten er brukt', () => {
  it('saldo blir aldri negativ – differansen blir gjeld som trekkes fra neste gevinst', () => {
    const state = newState();
    place(state, 'v1', ['match1:winner:rita'], 1000);
    setResult(state, 'match1', RITA_WINS_KO_R3);
    assert.equal(balanceKr(state, 'v1'), 2870);
    place(state, 'v1', ['match2:winner:petra'], 2870);
    assert.equal(balanceKr(state, 'v1'), 0);

    setResult(state, 'match1', { ...RITA_WINS_KO_R3, winner: 'pal', roundWinners: rounds('rita', 'pal', 'pal') });
    const wallet = walletOf(state, 'v1');
    assert.equal(wallet.balanceOre, 0);
    assert.equal(wallet.debtOre, 187000);
    assert.throws(() => place(state, 'v1', ['match2:r1:petra'], 10), /saldoen/);

    setResult(state, 'match2', { winner: 'petra', method: 'POENG', endRound: 3, roundWinners: rounds('petra', 'petra', 'petra') });
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
      const fighters = [match.fighterA, match.fighterB];
      const method = pick(['POENG', 'TKO', 'KO']);
      const endRound = method === 'POENG' ? 3 : pick([1, 2, 3]);
      return { winner: pick(fighters), method, endRound, roundWinners: rounds(pick(fighters), pick(fighters), pick(fighters)) };
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
        state.matches[match.id].result = normalizeResult(match, randomResult(match));
        settleAll(state);
      } else {
        state.matches[pick(MATCHES).id].result = null;
        settleAll(state);
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
    place(state, 'v1', ['match1:r2:rita'], 100);
    place(state, 'v1', ['match1:method:rita:KO'], 100);
    place(state, 'v1', ['match2:winner:petra'], 50);
    place(state, 'v2', ['match1:winner:pal'], 500);
    setResult(state, 'match1', RITA_WINS_KO_R3);

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

  it('annullerte bonger teller ikke i treffprosenten', () => {
    const state = newState();
    place(state, 'v1', ['match1:r3:rita'], 100);
    place(state, 'v1', ['match1:r1:pal'], 100);
    setResult(state, 'match1', { winner: 'pal', method: 'KO', endRound: 1, roundWinners: rounds('pal') });
    const kari = buildLeaderboard(state).find((r) => r.name === 'Kari');
    assert.equal(kari.hitRatePct, 100);
  });
});

describe('statistikk per kamp', () => {
  it('summerer penger på hver fighter og deltakerens resultat på kampen', () => {
    const state = newState();
    place(state, 'v1', ['match1:winner:rita'], 100);
    place(state, 'v2', ['match1:method:pal:KO', 'match2:winner:petra'], 50);
    place(state, 'v3', ['match1:r1:rita'], 20);
    const backing = backingFor(state, MATCHES[0]);
    assert.deepEqual(backing.byFighterOre, { rita: 10000, pal: 5000 });
    assert.equal(backing.totalStakeOre, 17000);
    assert.equal(backing.betCount, 3);

    setResult(state, 'match1', RITA_WINS_KO_R3);
    assert.deepEqual(matchSummaryFor(state, 'v1', 'match1'), {
      bets: 1, won: 1, lost: 0, void: 0, open: 0, stakeOre: 10000, payoutOre: 18700,
    });
    assert.equal(matchSummaryFor(state, 'v2', 'match1').lost, 1);
  });
});
