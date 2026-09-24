const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createApp } = require('../server');

const ADMIN = 'test-admin';
const KARI = 'aaaaaaaa-0000-4000-8000-000000000001';
const OLA = 'bbbbbbbb-0000-4000-8000-000000000002';

let tmpDir;
let dataFile;
let server;
let base;

async function start() {
  const app = createApp({ dataFile, adminPassword: ADMIN });
  server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  base = `http://127.0.0.1:${server.address().port}`;
}

async function stop() {
  await new Promise((resolve) => server.close(resolve));
}

async function call(method, url, body, headers = {}) {
  const res = await fetch(base + url, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

const get = (url) => call('GET', url);
const post = (url, body) => call('POST', url, body);
const admin = (url, body) => call('POST', url, body, { 'x-admin-key': ADMIN });

async function register(voterId, name) {
  const res = await post('/api/register', { voterId, name });
  assert.equal(res.status, 200, JSON.stringify(res.body));
}

async function bet(voterId, selections, stakeKr, extra = {}) {
  return post('/api/bets', { voterId, selections, stakeOre: Math.round(stakeKr * 100), ...extra });
}

async function balance(voterId) {
  const res = await get(`/api/state?voterId=${voterId}`);
  return res.body.wallet.balanceOre / 100;
}

const RITA_KO_R3 = { winner: 'rita', method: 'KO', endRound: 3, roundWinners: { 1: 'rita', 2: 'pal', 3: 'rita' } };

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fightnight-'));
  dataFile = path.join(tmpDir, 'state.json');
  await start();
});

afterEach(async () => {
  await stop();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('API: lommebok og bonger', () => {
  it('ny deltaker får 2000 kr og innsatsen trekkes når bongen leveres', async () => {
    await register(KARI, 'Kari');
    const state = await get(`/api/state?voterId=${KARI}`);
    assert.equal(state.body.wallet.balanceOre, 200000);
    assert.equal(state.body.matches.match1.markets.find((m) => m.id === 'winner').open, true);

    const res = await bet(KARI, ['match1:winner:rita', 'match2:winner:petra'], 100, { clientBetId: 'slip-1' });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.bet.type, 'combo');
    assert.equal(res.body.bet.potentialPayoutOre, Math.round(10000 * 1.87 * 1.87));
    assert.equal(res.body.wallet.balanceOre, 190000);

    const again = await bet(KARI, ['match1:winner:rita', 'match2:winner:petra'], 100, { clientBetId: 'slip-1' });
    assert.equal(again.body.duplicate, true);
    assert.equal(await balance(KARI), 1900);

    const mine = await get(`/api/state?voterId=${KARI}`);
    assert.equal(mine.body.myBets.length, 1);
    assert.equal(mine.body.myBets[0].selections[0].label, 'Rita Relator vinner kampen');
  });

  it('avviser innsats over saldo, under minsteinnsats og motstridende valg', async () => {
    await register(KARI, 'Kari');
    assert.equal((await bet(KARI, ['match1:winner:rita'], 2001)).status, 400);
    assert.equal((await bet(KARI, ['match1:winner:rita'], 5)).status, 400);
    const conflict = await bet(KARI, ['match1:winner:rita', 'match1:method:pal:KO'], 100);
    assert.equal(conflict.status, 400);
    assert.match(conflict.body.error, /motsier/);
    assert.equal(await balance(KARI), 2000);
  });

  it('krever registrering og avviser farlige deltaker-ID-er', async () => {
    assert.equal((await bet(KARI, ['match1:winner:rita'], 100)).status, 400);
    assert.equal((await bet('constructor', ['match1:winner:rita'], 100)).status, 400);
    assert.equal((await get('/api/state?voterId=constructor')).body.registered, false);
    assert.equal((await get('/api/state?voterId=__proto__')).body.registered, false);
    assert.equal((await post('/api/register', { voterId: '__proto__', name: 'X' })).status, 400);
    assert.equal((await post('/api/register', { voterId: 'kort', name: 'X' })).status, 400);
    assert.equal((await get('/api/state')).body.registeredCount, 0);
  });

  it('topplisten viser ikke andres deltaker-ID', async () => {
    await register(KARI, 'Kari');
    await register(OLA, 'Ola');
    const res = await get(`/api/state?voterId=${KARI}`);
    assert.equal(res.body.leaderboard.length, 2);
    res.body.leaderboard.forEach((row) => assert.equal(row.voterId, undefined));
    assert.deepEqual(res.body.leaderboard.filter((r) => r.isMe).map((r) => r.name), ['Kari']);
    assert.equal(JSON.stringify(res.body).includes(OLA), false);
  });
});

describe('API: låsing', () => {
  it('admin-stadiet stenger markedene i riktig rekkefølge', async () => {
    await register(KARI, 'Kari');
    assert.equal((await admin('/api/admin/matches/match1/stage', { stage: 'r1' })).status, 200);
    const locked = await bet(KARI, ['match1:winner:rita'], 100);
    assert.equal(locked.status, 400);
    assert.match(locked.body.error, /låst/);
    assert.equal((await bet(KARI, ['match1:r2:rita'], 100)).status, 200);
    assert.equal((await bet(KARI, ['match2:winner:petra'], 100)).status, 200);

    await admin('/api/admin/matches/match1/stage', { stage: 'r2' });
    assert.equal((await bet(KARI, ['match1:r2:pal'], 100)).status, 400);
    assert.equal((await admin('/api/admin/matches/match1/stage', { stage: 'r9' })).status, 400);
  });

  it('krever admin-passord', async () => {
    const res = await post('/api/admin/matches/match1/result', { result: RITA_KO_R3 });
    assert.equal(res.status, 401);
    const stage = await call('POST', '/api/admin/matches/match1/stage', { stage: 'r1' }, { 'x-admin-key': 'feil' });
    assert.equal(stage.status, 401);
  });
});

describe('API: resultat, avgjøring og retting', () => {
  it('avgjør bonger, viser resultatet og retter feil uten dobbel utbetaling', async () => {
    await register(KARI, 'Kari');
    await register(OLA, 'Ola');
    await bet(KARI, ['match1:winner:rita'], 100);
    await bet(OLA, ['match1:winner:pal'], 100);
    await admin('/api/admin/phase', { phase: 'match1_open' });

    const saved = await admin('/api/admin/matches/match1/result', { result: RITA_KO_R3 });
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    assert.equal(saved.body.phase, 'match1_result');
    assert.equal(saved.body.changedBets, 2);
    assert.equal(await balance(KARI), 2087);
    assert.equal(await balance(OLA), 1900);

    const resaved = await admin('/api/admin/matches/match1/result', { result: RITA_KO_R3 });
    assert.equal(resaved.body.changedBets, 0);
    assert.equal(await balance(KARI), 2087);

    const corrected = await admin('/api/admin/matches/match1/result', {
      result: { winner: 'pal', method: 'POENG', endRound: 3, roundWinners: { 1: 'pal', 2: 'pal', 3: 'rita' } },
    });
    assert.equal(corrected.body.phase, 'match1_result');
    assert.equal(await balance(KARI), 1900);
    assert.equal(await balance(OLA), 2087);

    const state = await get(`/api/state?voterId=${OLA}`);
    assert.equal(state.body.matches.match1.result.summary, 'Pål Producer vant på poeng etter 3 runder');
    assert.equal(state.body.myMatchSummary.match1.won, 1);
  });

  it('annullerer runder som ikke ble gått og betaler tilbake innsatsen', async () => {
    await register(KARI, 'Kari');
    await bet(KARI, ['match1:r3:rita'], 100);
    await bet(KARI, ['match1:r1:pal', 'match1:r2:rita'], 100);
    await admin('/api/admin/matches/match1/result', {
      result: { winner: 'pal', method: 'TKO', endRound: 1, roundWinners: { 1: 'pal' } },
    });
    const state = await get(`/api/state?voterId=${KARI}`);
    const statuses = state.body.myBets.map((b) => b.status).sort();
    assert.deepEqual(statuses, ['void', 'won']);
    assert.equal(await balance(KARI), 2000 - 200 + 100 + 187);
  });

  it('viser redusert mulig gevinst når en kombinasjon får et annullert valg', async () => {
    await register(KARI, 'Kari');
    await bet(KARI, ['match1:r3:rita', 'match2:winner:petra'], 100);
    await admin('/api/admin/matches/match1/result', {
      result: { winner: 'pal', method: 'KO', endRound: 2, roundWinners: { 1: 'pal', 2: 'pal' } },
    });
    const open = (await get(`/api/state?voterId=${KARI}`)).body.myBets[0];
    assert.equal(open.status, 'open');
    assert.deepEqual(open.selections.map((s) => s.outcome), ['void', 'pending']);
    assert.equal(open.totalOdds, 1.87);
    assert.equal(open.potentialPayoutOre, 18700);

    await admin('/api/admin/matches/match2/result', {
      result: { winner: 'petra', method: 'POENG', endRound: 3, roundWinners: { 1: 'petra', 2: 'petra', 3: 'morten' } },
    });
    const won = (await get(`/api/state?voterId=${KARI}`)).body.myBets[0];
    assert.equal(won.status, 'won');
    assert.equal(won.payoutOre, won.potentialPayoutOre);
    assert.equal(await balance(KARI), 1900 + 187);
  });

  it('avviser ugyldig resultat og lar admin fjerne et resultat igjen', async () => {
    await register(KARI, 'Kari');
    await bet(KARI, ['match1:winner:rita'], 100);
    const invalid = await admin('/api/admin/matches/match1/result', {
      result: { winner: 'rita', method: 'POENG', endRound: 2, roundWinners: { 1: 'rita', 2: 'rita' } },
    });
    assert.equal(invalid.status, 400);
    assert.equal((await admin('/api/admin/matches/match9/result', { result: RITA_KO_R3 })).status, 404);

    await admin('/api/admin/phase', { phase: 'match1_open' });
    await admin('/api/admin/matches/match1/result', { result: RITA_KO_R3 });
    assert.equal(await balance(KARI), 2087);
    const cleared = await admin('/api/admin/matches/match1/result', { result: null });
    assert.equal(cleared.body.phase, 'match1_open');
    assert.equal(await balance(KARI), 1900);
    const state = await get(`/api/state?voterId=${KARI}`);
    assert.equal(state.body.myBets[0].status, 'open');
  });

  it('faser som viser resultat krever at resultatet er registrert', async () => {
    assert.equal((await admin('/api/admin/phase', { phase: 'match1_result' })).status, 400);
    assert.equal((await admin('/api/admin/phase', { phase: 'final' })).status, 400);
    await admin('/api/admin/matches/match1/result', { result: RITA_KO_R3 });
    assert.equal((await admin('/api/admin/phase', { phase: 'match1_result' })).status, 200);
    assert.equal((await admin('/api/admin/phase', { phase: 'final' })).status, 400);
  });

  it('oddsprofil og overstyring gjelder nye bonger, ikke gamle', async () => {
    await register(KARI, 'Kari');
    await bet(KARI, ['match1:winner:rita'], 100);
    const updated = await admin('/api/admin/matches/match1/odds', {
      profile: 'favorite', favorite: 'rita', overrides: { 'match1:winner:pal': '2,50' },
    });
    assert.equal(updated.status, 200, JSON.stringify(updated.body));
    assert.equal(updated.body.odds['match1:winner:rita'], 1.55);
    assert.equal(updated.body.odds['match1:winner:pal'], 2.5);
    assert.equal((await admin('/api/admin/matches/match1/odds', { profile: 'favorite' })).status, 400);

    const adminState = await call('GET', '/api/admin/state', undefined, { 'x-admin-key': ADMIN });
    const profileOdds = adminState.body.matches[0].profileOdds;
    assert.equal(profileOdds.even['match1:winner:pal'], 1.87);
    assert.equal(profileOdds['fav:pal']['match1:winner:pal'], 1.55);
    assert.equal(profileOdds['fav:rita']['match1:method:pal:KO'], 13);

    await bet(KARI, ['match1:winner:rita'], 100);
    await admin('/api/admin/matches/match1/result', { result: RITA_KO_R3 });
    const state = await get(`/api/state?voterId=${KARI}`);
    const payouts = state.body.myBets.map((b) => b.payoutOre).sort((a, b) => a - b);
    assert.deepEqual(payouts, [15500, 18700]);
  });
});

describe('API: lagring', () => {
  it('saldo og bonger overlever at serveren startes på nytt', async () => {
    await register(KARI, 'Kari');
    await bet(KARI, ['match1:winner:rita'], 250);
    await admin('/api/admin/matches/match1/result', { result: RITA_KO_R3 });
    const before = await get(`/api/state?voterId=${KARI}`);

    await stop();
    await start();

    const after = await get(`/api/state?voterId=${KARI}`);
    assert.deepEqual(after.body.wallet, before.body.wallet);
    assert.deepEqual(after.body.myBets, before.body.myBets);
    assert.equal(after.body.wallet.balanceOre, 200000 - 25000 + 46750);
  });

  it('nullstilling tømmer alt', async () => {
    await register(KARI, 'Kari');
    await bet(KARI, ['match1:winner:rita'], 250);
    assert.equal((await admin('/api/admin/reset')).status, 200);
    const state = await get(`/api/state?voterId=${KARI}`);
    assert.equal(state.body.registered, false);
    assert.equal(state.body.leaderboard.length, 0);
  });
});
