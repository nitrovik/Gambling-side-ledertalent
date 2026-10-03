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

const RITA_KO = { winner: 'rita', method: 'KO' };

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
    assert.equal(res.body.bet.potentialPayoutOre, Math.round(10000 * 3.75 * 1.75));
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
  it('spillet på en kamp stenger når runde 1 starter', async () => {
    await register(KARI, 'Kari');
    assert.equal((await admin('/api/admin/matches/match1/stage', { stage: 'r1' })).status, 200);
    const locked = await bet(KARI, ['match1:winner:rita'], 100);
    assert.equal(locked.status, 400);
    assert.match(locked.body.error, /låst/);
    assert.equal((await bet(KARI, ['match1:method:rita:KO'], 100)).status, 400);
    assert.equal((await bet(KARI, ['match1:r2:rita'], 100)).status, 400);
    assert.equal((await bet(KARI, ['match2:winner:petra'], 100)).status, 200);
    const state = await get(`/api/state?voterId=${KARI}`);
    assert.ok(state.body.matches.match1.markets.every((m) => !m.open));
    assert.ok(state.body.matches.match2.markets.every((m) => m.open));
    assert.equal((await admin('/api/admin/matches/match1/stage', { stage: 'r9' })).status, 400);
  });

  it('når resultatet er annonsert kan ingen spille på kampen lenger – heller ikke etter retting', async () => {
    await register(KARI, 'Kari');
    await admin('/api/admin/phase', { phase: 'match1_open' });
    await admin('/api/admin/matches/match1/result', { result: RITA_KO });
    const state = await get(`/api/state?voterId=${KARI}`);
    assert.equal(state.body.phase, 'match1_result');
    assert.equal(state.body.matches.match1.stage, 'done');
    assert.ok(state.body.matches.match1.markets.every((m) => !m.open));
    for (const key of ['match1:winner:rita', 'match1:method:rita:KO', 'match1:method:pal:POENG']) {
      assert.equal((await bet(KARI, [key], 100)).status, 400, key);
    }
    assert.equal((await bet(KARI, ['match2:winner:petra', 'match1:winner:rita'], 100)).status, 400);

    await admin('/api/admin/matches/match1/result', { result: null });
    assert.equal((await bet(KARI, ['match1:winner:pal'], 100)).status, 400);
    const stage = await admin('/api/admin/matches/match1/stage', { stage: 'open' });
    assert.equal(stage.status, 400);
    assert.match(stage.body.error, /stengt/);
    assert.equal((await bet(KARI, ['match1:winner:pal'], 100)).status, 400);

    assert.equal((await bet(KARI, ['match2:winner:petra'], 100)).status, 200);
    assert.equal(await balance(KARI), 1900);

    assert.equal((await admin('/api/admin/matches/match1/stage', { stage: 'open', reopen: true })).status, 200);
    assert.equal((await bet(KARI, ['match1:winner:pal'], 100)).status, 200);
  });

  it('krever admin-passord', async () => {
    const res = await post('/api/admin/matches/match1/result', { result: RITA_KO });
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

    const saved = await admin('/api/admin/matches/match1/result', { result: RITA_KO });
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    assert.equal(saved.body.phase, 'match1_result');
    assert.equal(saved.body.changedBets, 2);
    assert.equal(await balance(KARI), 2275);
    assert.equal(await balance(OLA), 1900);

    const resaved = await admin('/api/admin/matches/match1/result', { result: RITA_KO });
    assert.equal(resaved.body.changedBets, 0);
    assert.equal(await balance(KARI), 2275);

    const corrected = await admin('/api/admin/matches/match1/result', { result: { winner: 'pal', method: 'POENG' } });
    assert.equal(corrected.body.phase, 'match1_result');
    assert.equal(await balance(KARI), 1900);
    assert.equal(await balance(OLA), 2087);

    const state = await get(`/api/state?voterId=${OLA}`);
    assert.equal(state.body.matches.match1.result.summary, 'Pål Producer vant på poeng etter 3 runder');
    assert.equal(state.body.myMatchSummary.match1.won, 1);
  });

  it('resultatet er bare kampvinner og metode, og vinnermetode betaler kveldens odds', async () => {
    await register(KARI, 'Kari');
    await bet(KARI, ['match1:method:rita:KO'], 100);
    const saved = await admin('/api/admin/matches/match1/result', { result: RITA_KO });
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    const state = await get(`/api/state?voterId=${KARI}`);
    const { result } = state.body.matches.match1;
    assert.equal(result.summary, 'Rita Relator vant på KO i runde 3');
    assert.equal(result.rounds, undefined);
    assert.equal(state.body.myBets[0].status, 'won');
    assert.equal(await balance(KARI), 2000 - 100 + 1900);
  });

  it('avviser ugyldig resultat og lar admin fjerne et resultat igjen', async () => {
    await register(KARI, 'Kari');
    await bet(KARI, ['match1:winner:rita'], 100);
    const invalid = await admin('/api/admin/matches/match1/result', { result: { winner: 'rita' } });
    assert.equal(invalid.status, 400);
    assert.equal((await admin('/api/admin/matches/match9/result', { result: RITA_KO })).status, 404);

    await admin('/api/admin/phase', { phase: 'match1_open' });
    await admin('/api/admin/matches/match1/result', { result: RITA_KO });
    assert.equal(await balance(KARI), 2275);
    const cleared = await admin('/api/admin/matches/match1/result', { result: null });
    assert.equal(cleared.body.phase, 'match1_open');
    assert.equal(await balance(KARI), 1900);
    const state = await get(`/api/state?voterId=${KARI}`);
    assert.equal(state.body.myBets[0].status, 'open');
  });

  it('faser som viser resultat krever at resultatet er registrert', async () => {
    assert.equal((await admin('/api/admin/phase', { phase: 'match1_result' })).status, 400);
    assert.equal((await admin('/api/admin/phase', { phase: 'final' })).status, 400);
    await admin('/api/admin/matches/match1/result', { result: RITA_KO });
    assert.equal((await admin('/api/admin/phase', { phase: 'match1_result' })).status, 200);
    assert.equal((await admin('/api/admin/phase', { phase: 'final' })).status, 400);
  });

  it('kveldens odds er standard: Rita 3,75 / Pål 1,87 og Petra 1,75 / Morten 2,05', async () => {
    const state = await get('/api/state');
    const odds = (matchId) => Object.fromEntries(state.body.matches[matchId].markets
      .flatMap((m) => m.selections).map((sel) => [sel.key, sel.odds]));
    assert.deepEqual(state.body.matches.match1.markets.map((m) => m.id), ['winner', 'method']);
    const kamp1 = odds('match1');
    assert.equal(kamp1['match1:winner:rita'], 3.75);
    assert.equal(kamp1['match1:method:rita:TKO'], 12.5);
    assert.equal(kamp1['match1:method:rita:KO'], 19);
    assert.equal(kamp1['match1:winner:pal'], 1.87);
    assert.equal(kamp1['match1:method:pal:KO'], 9.5);
    const kamp2 = odds('match2');
    assert.equal(kamp2['match2:winner:petra'], 1.75);
    assert.equal(kamp2['match2:winner:morten'], 2.05);
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
    assert.equal(profileOdds.standard['match1:winner:rita'], 3.75);
    assert.equal(profileOdds.even['match1:winner:pal'], 1.87);
    assert.equal(profileOdds['fav:pal']['match1:winner:pal'], 1.55);
    assert.equal(profileOdds['fav:rita']['match1:method:pal:KO'], 13);

    await bet(KARI, ['match1:winner:rita'], 100);
    await admin('/api/admin/matches/match1/result', { result: RITA_KO });
    const state = await get(`/api/state?voterId=${KARI}`);
    const payouts = state.body.myBets.map((b) => b.payoutOre).sort((a, b) => a - b);
    assert.deepEqual(payouts, [15500, 37500]);

    const back = await admin('/api/admin/matches/match1/odds', { profile: 'standard' });
    assert.equal(back.status, 200, JSON.stringify(back.body));
    assert.equal(back.body.odds['match1:winner:rita'], 3.75);
  });
});

describe('API: lagring', () => {
  it('saldo og bonger overlever at serveren startes på nytt', async () => {
    await register(KARI, 'Kari');
    await bet(KARI, ['match1:winner:rita'], 250);
    await admin('/api/admin/matches/match1/result', { result: RITA_KO });
    const before = await get(`/api/state?voterId=${KARI}`);

    await stop();
    await start();

    const after = await get(`/api/state?voterId=${KARI}`);
    assert.deepEqual(after.body.wallet, before.body.wallet);
    assert.deepEqual(after.body.myBets, before.body.myBets);
    assert.equal(after.body.wallet.balanceOre, 200000 - 25000 + 93750);
  });

  it('gammel lagring: bonger på runder fjernes (innsatsen tilbake) og kveldens odds tas i bruk', async () => {
    await stop();
    fs.writeFileSync(dataFile, JSON.stringify({
      phase: 'match1_open',
      voters: { [KARI]: { name: 'Kari', registeredAt: 1 } },
      betSeq: 2,
      bets: [
        { id: 'b1', voterId: KARI, stakeOre: 10000, placedAt: 1, status: 'open', payoutOre: 0, outcomes: ['pending'],
          selections: [{ key: 'match1:r1:rita', matchId: 'match1', market: 'r1', fighter: 'rita', odds: 1.87 }] },
        { id: 'b2', voterId: KARI, stakeOre: 5000, placedAt: 2, status: 'open', payoutOre: 0, outcomes: ['pending'],
          selections: [{ key: 'match1:winner:rita', matchId: 'match1', market: 'winner', fighter: 'rita', odds: 1.87 }] },
      ],
      matches: {
        match1: { stage: 'open', odds: { profile: 'even', favorite: null, overrides: {} }, result: null },
        match2: { stage: 'open', odds: { profile: 'favorite', favorite: 'morten', overrides: {} }, result: null },
      },
    }));
    await start();
    const state = await get(`/api/state?voterId=${KARI}`);
    assert.deepEqual(state.body.myBets.map((b) => b.id), ['b2']);
    assert.equal(state.body.wallet.balanceOre, 200000 - 5000);
    assert.equal(state.body.myBets[0].selections[0].odds, 1.87);
    const winner1 = state.body.matches.match1.markets.find((m) => m.id === 'winner');
    assert.equal(winner1.selections.find((sel) => sel.fighter === 'rita').odds, 3.75);
    const winner2 = state.body.matches.match2.markets.find((m) => m.id === 'winner');
    assert.equal(winner2.selections.find((sel) => sel.fighter === 'morten').odds, 1.55);

    // Once saved in the new format, a deliberately chosen 'even' profile is kept.
    await admin('/api/admin/matches/match1/odds', { profile: 'even' });
    await stop();
    await start();
    const again = await get('/api/state');
    const rita = again.body.matches.match1.markets.find((m) => m.id === 'winner').selections.find((s) => s.fighter === 'rita');
    assert.equal(rita.odds, 1.87);
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

describe('API: admin-oversikt', () => {
  it('viser alle bonger med navn, nyeste først, og hva salen har spilt på', async () => {
    await register(KARI, 'Kari');
    await register(OLA, 'Ola');
    await bet(KARI, ['match1:winner:rita'], 100);
    await bet(OLA, ['match1:winner:rita', 'match1:method:rita:KO'], 50);

    const res = await call('GET', '/api/admin/state', undefined, { 'x-admin-key': ADMIN });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.bets.map((b) => b.name), ['Ola', 'Kari']);
    assert.equal(res.body.bets[0].type, 'combo');
    assert.equal(res.body.bets[0].potentialPayoutOre, Math.round(5000 * 3.75 * 19));
    assert.equal(JSON.stringify(res.body.bets).includes(KARI), false);

    const winner = res.body.matches[0].markets.find((m) => m.id === 'winner');
    const rita = winner.selections.find((s) => s.fighter === 'rita');
    const pal = winner.selections.find((s) => s.fighter === 'pal');
    assert.deepEqual([rita.betCount, rita.stakeOre], [2, 15000]);
    assert.deepEqual([pal.betCount, pal.stakeOre], [0, 0]);
    assert.equal(res.body.leaderboard.find((r) => r.name === 'Kari').openStakeOre, 10000);
  });
});

describe('API: QR-kode', () => {
  it('peker på adressen siden ble åpnet på, og respekterer HTTPS bak en proxy', async () => {
    const QRCode = require('qrcode');
    const svg = await fetch(`${base}/qr.svg`);
    assert.equal(svg.status, 200);
    assert.match(svg.headers.get('content-type'), /svg/);
    const options = { margin: 2, errorCorrectionLevel: 'M', type: 'svg' };
    assert.equal(await svg.text(), await QRCode.toString(`${base}/`, options));

    const proxied = await fetch(`${base}/qr.svg`, { headers: { 'x-forwarded-proto': 'https' } });
    assert.equal(await proxied.text(), await QRCode.toString(`${base.replace('http:', 'https:')}/`, options));

    const png = await fetch(`${base}/qr.png?download=1`);
    assert.equal(png.status, 200);
    assert.match(png.headers.get('content-disposition'), /fight-night-qr\.png/);
    const bytes = Buffer.from(await png.arrayBuffer());
    assert.deepEqual([...bytes.subarray(1, 4)], [...Buffer.from('PNG')]);
  });
});
