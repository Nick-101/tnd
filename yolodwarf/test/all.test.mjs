// 검증. 쓰는 법: node test/all.test.mjs  (또는 npm test)
// 1) yolodwarf2_testcases.json의 사례 221개  2) 참고 엔진과 무작위 보드로 맞대기
// 3) 제작 요청서 5.2절: 후보, 덱, 업그레이드, 새로고침, 스테이지 전환, 판정, 웨이브 끝  4) 무작위 봇으로 한 런 끝까지
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { makeEngine, formulaText } from '../js/engine.js';
import { createGame } from '../js/game.js';
import { makeRng } from '../js/rng.js';
import * as ref from '../docs/demo2/reference_engine2.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const data = JSON.parse(readFileSync(join(root, 'data/yolodwarf2_data.json'), 'utf8'));
const tc = JSON.parse(readFileSync(join(root, 'data/yolodwarf2_testcases.json'), 'utf8'));
const engine = makeEngine(data), c = data.constants;

let fail = 0, checks = 0;
const check = (ok, msg) => { checks++; if (!ok) { fail++; if (fail < 40) console.log('  어긋남: ' + msg); } };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const section = name => { const f0 = fail, c0 = checks; return () => console.log(`[${name}] 확인 ${checks - c0}개${fail > f0 ? ` · 어긋남 ${fail - f0}` : ''}`); };

// ── 1. 검증 사례 221개 ───────────────────────────────────────
{
  let pass = 0; const groups = {};
  for (const k of tc.cases) {
    const got = engine.runWave(k.board, k.levels, k.wave);
    const ok = same(got, k.expected);
    groups[k.group] = groups[k.group] || [0, 0]; groups[k.group][1]++; if (ok) { pass++; groups[k.group][0]++; }
    else {
      const keys = Object.keys(k.expected).filter(x => !same(got[x], k.expected[x]));
      console.log(`  어긋남 ${k.id} (${k.group}, ${k.note}) 다른 곳: ${keys.join(', ')}`);
      for (const x of keys.slice(0, 2)) console.log(`     ${x}\n       엔진   ${JSON.stringify(got[x])}\n       기대값 ${JSON.stringify(k.expected[x])}`);
    }
  }
  console.log(`[검증 사례] 통과 ${pass} / ${tc.cases.length}  (${Object.entries(groups).map(([g, [a, b]]) => `${g} ${a}/${b}`).join(', ')})`);
  fail += tc.cases.length - pass;
}

// ── 2. 참고 엔진과 맞대기 + 기록이 결과와 맞는지 ──────────────
{
  const done = section('참고 엔진과 무작위 보드 2,000개');
  const ix = ref.index(data), rng = makeRng('diff');
  const all = [...data.shops, ...data.supports];
  for (let n = 0; n < 2000; n++) {
    const N = data.stages[rng.int(5)].tiles, used = new Set();
    const board = Array.from({ length: N }, () => {
      if (rng.rand() < 0.2) return null;
      const b = rng.rand() < 0.6 ? data.shops[rng.int(data.shops.length)] : data.supports[rng.int(data.supports.length)];
      if (b.grade) { if (used.has(b.id)) return null; used.add(b.id); }
      return b.id;
    });
    const levels = board.map(b => (b && engine.shop(b) && rng.rand() < 0.4 ? 1 + rng.int(3) : 0));
    const wave = Array.from({ length: 1 + rng.int(3) }, () => { const d = data.dwarves[rng.int(90)]; return { likes: d.likes, dislike: d.dislike, trait: rng.rand() < 0.4 ? data.traits[rng.int(5)].id : null }; });
    check(same(engine.runWave(board, levels, wave), ref.runWave(ix, board, levels, wave)), `무작위 보드 #${n}이 참고 엔진과 다르다: ${JSON.stringify({ board, levels, wave })}`);
    // 기록: 매출의 합, 바퀴 수, 계산식
    const info = engine.prep(board, levels), r = engine.runDwarf(info, wave[0], 0);
    const uses = r.events.filter(e => e.type === 'use');
    check(uses.reduce((a, e) => a + e.pay, 0) === r.sales && r.events.filter(e => e.type === 'lapEnd').length === r.laps, `#${n} 기록의 합`);
    check(uses.every(e => e.pay === Math.floor((e.fee + e.add) * e.mult) && formulaText(e, data.stacks).endsWith(String(e.pay)) || formulaText(e, data.stacks).includes(`= ${e.pay}`)), `#${n} 기록의 계산식`);
    check(r.bestPay === Math.max(0, ...uses.map(e => e.pay)), `#${n} 한 번에 올린 최고 매출`);
  }
  // 손으로 따질 수 있는 것 몇 가지
  const E = id => data.shops.concat(data.supports).find(b => b.name === id).id;
  const D = (likes, dislike, trait = null) => ({ likes, dislike, trait });
  let r = engine.runDwarf(engine.prep([E('수영장'), E('헬스장'), E('고깃집'), null, null, null, null, null], Array(8).fill(0)), D(['운동', '식당'], '오락'));
  const lap1 = r.events.filter(e => e.type === 'use' && e.lap === 1);
  check(same(lap1.map(e => e.pay), [6, 8, 30]) && formulaText(lap1[2], data.stacks) === '6 + 허기 3 × 8 = 30', '수영장-헬스장-고깃집: 6, 8, 30');
  check(r.laps === 4 && same(r.events.filter(e => e.type === 'lapEnd').map(e => e.result), ['base', 'extra', 'extra', 'leave']), '만족도 6 → 3을 내고, 다시 6 → 6을 내고, 3 < 12라 떠난다');
  r = engine.runDwarf(engine.prep([E('수영장'), null, null, null, null, null, null, null], Array(8).fill(0)), D(['카페', '술집'], '운동'));
  check(r.events.filter(e => e.type === 'lapEnd').pop().sat === -2, '만족도는 0 아래로 내려간다');
  r = engine.runDwarf(engine.prep([E('공원'), null, null, null, null, null, null, null], Array(8).fill(0)), D(['카페', '술집'], '운동', 'easygoing'));
  check(r.laps === 3 && r.extraLaps === 0, '느긋함은 기본 3바퀴');
  const p = engine.prep([E('보석상'), E('왕실 공방'), E('발전소'), null, null, null, null, null], [3, 0, 0, 0, 0, 0, 0, 0]);
  check(p.mult[0] === 2.5 * 2.5 * 8 && p.top === 0 && p.mostStars === 0, '발전소 옆 왕실 공방 ×6.25, ★★★ ×8');
  done();
}

// ── 3. 제작 요청서 5.2절 ─────────────────────────────────────
const isShop = id => !!engine.shop(id);
const firstEmpty = g => g.state.board.findIndex(b => b === null);
const quickWave = g => { g.startWave(); while (g.state.phase === 'pick') g.send(0); };
{
  let done = section('후보 뽑기');
  const g = createGame(data, { seed: 'cand' }); g.begin();
  const count = { shop: 0, common: 0, uncommon: 0, rare: 0 }, seen = new Set(); let total = 0;
  for (let n = 0; n < 6000; n++) {
    g.state.money = 1e12; g.state.refreshPresses = 0; g.refresh();
    const sup = g.state.candidates.filter(x => !isShop(x.id)).map(x => x.id);
    check(new Set(sup).size === sup.length, '후보에 같은 지원 건물이 두 장');
    for (const x of g.state.candidates) { seen.add(x.id); total++; count[isShop(x.id) ? 'shop' : engine.support(x.id).grade]++; }
  }
  const pct = k => (100 * count[k] / total).toFixed(1);
  for (const [k, rate] of Object.entries(c.candidateRates)) check(Math.abs(count[k] / total - rate) < 0.012, `후보 ${k}의 비율 ${pct(k)} (기대 ${rate * 100})`);
  check(seen.size === 95, `건물 95채가 모두 후보에 나올 수 있다 (나온 것 ${seen.size})`);
  // 보드에 지은 지원 건물은 다시 나오지 않는다. 철거하면 다시 나올 수 있다
  let slot = -1;
  while (slot < 0) { g.state.refreshPresses = 0; g.refresh(); slot = g.state.candidates.findIndex(x => !isShop(x.id)); }
  const sid = g.state.candidates[slot].id;
  g.build(slot, 0);
  let again = false;
  for (let n = 0; n < 3000; n++) { g.state.refreshPresses = 0; g.refresh(); if (g.state.candidates.some(x => x.id === sid)) again = true; }
  check(!again, '보드에 지은 지원 건물이 후보에 다시 나왔다');
  g.demolish(0);
  for (let n = 0; n < 6000 && !again; n++) { g.state.refreshPresses = 0; g.refresh(); if (g.state.candidates.some(x => x.id === sid)) again = true; }
  check(again, '철거한 지원 건물은 다시 후보에 나올 수 있다');
  console.log(`    후보 ${total}장: 매장 ${pct('shop')} / 일반 ${pct('common')} / 고급 ${pct('uncommon')} / 희귀 ${pct('rare')} (100장에 몇 장)`);
  done();

  done = section('덱');
  let likePop = 0, likeUnpop = 0, hatePop = 0, hateUnpop = 0; const runs = 300;
  for (let n = 0; n < runs; n++) {
    const s = createGame(data, { seed: 'deck' + n }).state;
    check(s.deck.length === 30 && new Set(s.deck.map(d => d.id)).size === 30, '덱 30마리가 모두 다르다');
    const tr = {}; for (const d of s.deck) if (d.trait) tr[d.trait] = (tr[d.trait] || 0) + 1;
    check(Object.keys(tr).length === 5 && Object.values(tr).every(v => v === 2), '특성 다섯 가지를 두 마리씩');
    check(s.popular.length === 2 && s.unpopular.length === 1 && !s.popular.includes(s.unpopular[0]) && s.unpopular[0] !== '식당' && !s.popular.includes('휴식'), '인기 둘, 비인기 하나');
    likePop += s.deck.filter(d => d.likes.includes(s.popular[0])).length + s.deck.filter(d => d.likes.includes(s.popular[1])).length;
    likeUnpop += s.deck.filter(d => d.likes.includes(s.unpopular[0])).length;
    hateUnpop += s.deck.filter(d => d.dislike === s.unpopular[0]).length;
    hatePop += s.deck.filter(d => s.popular.includes(d.dislike)).length;
  }
  check(likePop / runs / 2 > 11 && likeUnpop / runs < 5 && hateUnpop / runs > 7, '인기 업종을 좋아하는 드워프가 뚜렷이 많다');
  console.log(`    덱 ${runs}개 평균: 인기 업종 하나를 좋아하는 드워프 ${(likePop / runs / 2).toFixed(1)}마리, 비인기 업종을 좋아하는 ${(likeUnpop / runs).toFixed(1)}마리 · 싫어하는 ${(hateUnpop / runs).toFixed(1)}마리`);
  const plain = createGame(data, { seed: 'x', traits: false, deckColor: false }).state;
  check(plain.deck.every(d => !d.trait) && plain.popular.length === 0 && plain.deck.length === 30, '스위치: 특성 끔, 덱의 색 끔');
  check(same(createGame(data, { seed: 'same' }).state.deck, createGame(data, { seed: 'same' }).state.deck), '같은 씨앗이면 같은 덱');
  done();

  done = section('업그레이드');
  const u = createGame(data, { seed: 'up' }); u.begin();
  const put = (tile, id) => { u.state.board[tile] = { id, stars: 0, lastSales: null, waveSales: 0 }; };
  put(0, 'swimming_pool'); put(1, 'ad_tower'); put(2, 'gym');
  check(u.upgradeInfo(0).reason === 'new' && !u.upgrade(0), '이번 정비에 지은 매장은 못 올린다');
  check(u.upgradeInfo(1).reason === 'support' && !u.upgrade(1), '지원 건물은 못 올린다');
  quickWave(u); u.state.money = 1e9; u.proceed();
  const pool = u.state.board[0], gym = u.state.board[2];
  check(pool.lastSales > 0 && u.state.board[1].lastSales === 0, '웨이브가 끝나면 매장마다 매출을 적어 둔다');
  check(u.upgradeInfo(0).cost === Math.max(10, pool.lastSales * 2) && engine.upgradeCost(0) === 10 && engine.upgradeCost(4) === 10 && engine.upgradeCost(123) === 246, '비용은 max(10, 지난 웨이브 매출 × 2)');
  u.move(0, 5);
  check(u.state.board[5] === pool && u.upgradeInfo(5).cost === Math.max(10, pool.lastSales * 2), '자리를 바꿔도 매출 기록이 따라간다');
  const m0 = u.state.money, cost = u.upgradeInfo(5).cost;
  check(u.upgrade(5) && pool.stars === 1 && u.state.money === m0 - cost, '올리면 ★ 하나, 비용만큼 자금이 빠진다');
  check(u.upgradeInfo(2).reason === 'once' && !u.upgrade(2), '정비마다 한 번');
  u.move(5, 3); check(u.state.board[3].stars === 1, '자리를 바꿔도 ★이 따라간다');
  quickWave(u); u.state.money = 1e9; u.proceed(); u.upgrade(3);
  quickWave(u); u.state.money = 1e9; u.proceed(); u.upgrade(3);
  check(pool.stars === 3, '★ 셋까지');
  quickWave(u); u.state.money = 1e9; u.proceed();
  check(u.upgradeInfo(3).reason === 'max' && !u.upgrade(3) && pool.stars === 3, '★ 셋에서 멈춘다');
  u.state.money = 0; check(u.upgradeInfo(2).reason === 'money' && !u.upgrade(2), '자금이 모자라면 못 올린다');
  u.demolish(3); check(u.state.board[3] === null && gym.stars === 0, '철거하면 ★과 함께 사라진다');
  put(3, 'swimming_pool'); check(u.state.board[3].stars === 0 && u.upgradeInfo(3).reason === 'new', '다시 지은 매장은 새 매장이다');
  done();

  done = section('새로고침과 잠금');
  const r = createGame(data, { seed: 'ref' }); r.begin(); r.state.money = 1e9;
  const costs = []; for (let n = 0; n < 3; n++) { costs.push(r.refreshCost()); const m = r.state.money; r.refresh(); check(r.state.money === m - costs[n], '새로고침 비용만큼 빠진다'); }
  check(same(costs, [5, 10, 20]), `스테이지 1에서 5, 10, 20 (${costs})`);
  r.toggleLock(1); const locked = r.state.candidates[1].id, other = r.state.candidates.map(x => x.id);
  r.refresh(); check(r.state.candidates[1].id === locked && r.state.candidates[1].locked, '잠근 후보는 새로고침에 남는다');
  r.build(0, 0); check(r.state.candidates[0] === null, '지은 후보의 자리는 비워 둔다');
  r.refresh(); check(r.state.candidates.every(x => x), '새로고침하면 비어 있던 자리도 다시 찬다');
  quickWave(r); r.state.money = 1e9; r.proceed();
  check(r.refreshCost() === 160 && r.state.candidates[1].id === locked, '웨이브가 넘어가도 비용이 내려가지 않고, 잠근 후보는 다음 정비에도 남는다');
  r.state.candidates.forEach((x, i) => { if (!x.locked) r.toggleLock(i); });
  check(!r.canRefresh(), '모두 잠그면 새로고침을 못 한다');
  r.state.money = 3; r.toggleLock(0); check(!r.refresh() && r.state.money === 3, '자금이 모자라면 못 누른다');
  void other; done();

  done = section('스테이지 전환과 판정');
  const t = createGame(data, { seed: 'stage' }); t.begin();
  t.state.board[0] = { id: 'swimming_pool', stars: 2, lastSales: 5, waveSales: 0 }; t.toggleLock(2); t.state.money = 1e6; t.refresh();
  const deck1 = t.state.deck.map(d => d.id);
  for (let w = 0; w < 5; w++) { check(t.state.wave === w && t.state.stage === 0, '웨이브 차례'); quickWave(t); check(t.state.judge.passed && t.state.judge.stageDone === (w === 4), '판정'); t.proceed(); if (w < 4) check(t.state.phase === 'prep', '다음 정비'); }
  const st = t.state;
  check(st.phase === 'stage' && st.stage === 1 && st.wave === 0, '다섯째 웨이브를 통과하면 다음 스테이지');
  check(st.money > 1e6 - 100, '자금이 남는다');
  check(st.board.length === 12 && st.board.every(b => b === null), '보드가 12칸으로 비워진다 (★도 사라진다)');
  check(st.candidates.length === 6 && st.candidates.every(x => x === null), '잠근 후보가 사라진다');
  check(!same(st.deck.map(d => d.id), deck1) && st.deck.length === 30, '새 덱이 뽑힌다');
  t.begin(); check(t.refreshCost() === 10 && st.buildsLeft === 3 && st.candidates.every(x => x && !x.locked), '스테이지 2: 새로고침 10부터, 건설 3채, 후보 6장');
  check(same(data.stages.map(x => [x.tiles, x.buildsPerPrep, x.candidates]), [[8, 2, 5], [12, 3, 6], [16, 4, 7], [20, 5, 8], [24, 6, 9]]), '스테이지마다 칸 수, 짓는 수, 후보 수');
  // 판정: 자금이 목표와 같으면 통과, 1 모자라면 끝. 쓴 만큼 빠진다
  for (const d of [0, -1]) {
    const j = createGame(data, { seed: 'judge' }); j.begin(); j.state.money = 30 + d + 5; j.refresh(); j.startWave();
    while (j.state.phase === 'pick') j.send(0);
    check(j.state.waveSales === 0 && j.state.money === 30 + d && j.state.judge.passed === (d === 0), `자금 ${30 + d} / 목표 30 → ${d === 0 ? '통과' : '끝'}`);
    j.proceed(); check((j.state.phase === 'over') === (d !== 0) && (d === 0 || j.state.outcome === 'fail'), '모자라면 런이 끝난다');
  }
  // 시험용 스위치: 목표 배율, 시작 스테이지
  check(createGame(data, { seed: 'm', targetMult: 2 }).target() === 60 && createGame(data, { seed: 'm', targetMult: 0.5 }).target() === 15, '목표 배율');
  const s3 = createGame(data, { seed: 'm', startStage: 3 });
  check(s3.state.stage === 2 && s3.state.money === 10000 && s3.state.board.length === 16 && s3.target() === 10500, '시작 스테이지 3: 자금 10,000, 16칸');
  // 클리어
  const z = createGame(data, { seed: 'clear', startStage: 5 }); z.state.money = 1e9; z.begin();
  for (let w = 0; w < 5; w++) { quickWave(z); z.proceed(); if (w < 4) check(z.state.phase === 'prep', '스테이지 5의 다음 정비'); }
  check(z.state.phase === 'over' && z.state.outcome === 'clear', '다섯째 스테이지의 다섯째 웨이브를 통과하면 클리어');
  done();

  done = section('웨이브 끝: 자란 것이 처음으로');
  const w = createGame(data, { seed: 'grow' }); w.begin(); w.state.money = 1e9;
  ['newspaper', 'swimming_pool', 'gym', 'steakhouse'].forEach((id, i) => { w.state.board[i] = { id, stars: 0, lastSales: null, waveSales: 0 }; });
  w.startWave();
  w.state.hand[0] = { ...w.state.hand[0], likes: ['운동', '식당'], dislike: '오락', trait: null };
  const first = w.send(0);
  check(first.extraLaps > 0 && w.state.g === first.extraLaps, '추가 바퀴만큼 자란다');
  const second = w.send(0); check(second.g0 === first.extraLaps, '자란 것은 다음 드워프에게 이어진다');
  w.send(0); w.proceed(); w.startWave();
  check(w.state.g === 0 && w.send(0).g0 === 0, '다음 웨이브에는 처음으로 돌아간다');
  done();
}

// ── 4. 무작위로 누르는 봇으로 런을 끝까지 ────────────────────
{
  const done = section('무작위 봇 60런');
  const play = (seed, record, rich) => {
    const g = createGame(data, { seed }), s = g.state, bot = makeRng('bot' + seed);
    let guard = 0, waves = 0;
    while (s.phase !== 'over' && guard++ < 2000) {
      if (rich) s.money = Math.max(s.money, 1e7);
      if (s.phase === 'stage') { check(s.board.length === g.stageDef().tiles && s.deck.length === 30, '스테이지 시작'); g.begin(); }
      else if (s.phase === 'prep') {
        const def = g.stageDef();
        check(s.candidates.length === def.candidates && s.candidates.every(x => x) && s.buildsLeft === def.buildsPerPrep && s.upgradesLeft === 1, `씨앗 ${seed}: 정비 시작`);
        if (bot.rand() < 0.3) g.toggleLock(bot.int(def.candidates));
        if (bot.rand() < 0.3) g.refresh();
        if (bot.rand() < 0.5 && s.board.every(b => b)) g.demolish(bot.int(def.tiles));
        let built = 0;
        for (let k = 0; k < 40; k++) { const e = s.board.map((b, i) => (b ? -1 : i)).filter(i => i >= 0); if (e.length && g.build(bot.int(def.candidates), e[bot.int(e.length)])) built++; }
        check(built <= def.buildsPerPrep, `씨앗 ${seed}: 정비마다 ${def.buildsPerPrep}채까지`);
        const sup = s.board.filter(b => b && !isShop(b.id)).map(b => b.id);
        check(new Set(sup).size === sup.length, `씨앗 ${seed}: 같은 지원 건물이 보드에 두 채`);
        for (let k = 0; k < 6; k++) g.upgrade(bot.int(def.tiles));
        check(s.upgradesLeft >= 0 && s.board.every(b => !b || b.stars <= 3), '업그레이드 한도');
        g.move(bot.int(def.tiles), bot.int(def.tiles));
        record.push(s.board.map(b => b && b.id + b.stars), s.candidates.map(x => x && x.id));
        g.startWave(); waves++;
      } else if (s.phase === 'pick') {
        check(s.hand.length === 3 && !g.build(0, firstEmpty(g)) && !g.refresh() && !g.demolish(0) && !g.upgrade(0), `씨앗 ${seed}: 웨이브에서는 건설, 철거, 새로고침, 업그레이드를 못 한다`);
        const i = bot.int(3), m = s.money, pv = g.preview(i), r = g.send(i);
        check(r.sales === pv.sales && s.money === m + r.sales, `씨앗 ${seed}: 보내기`);
        record.push(r.dwarf.name, r.sales);
      } else if (s.phase === 'judge') {
        const seenThisWave = s.order.slice(0, 9); check(new Set(seenThisWave).size === 9, '한 웨이브에 같은 드워프가 다시 나오지 않는다');
        check(s.judge.passed === (s.money >= g.target()), '판정'); g.proceed();
      }
    }
    check(s.phase === 'over' && s.money >= 0, `씨앗 ${seed}: 런이 끝났다`);
    return { s, waves };
  };
  for (let n = 0; n < 40; n++) { const a = [], b = []; play('R' + n, a, false); play('R' + n, b, false); check(same(a, b), `씨앗 R${n}: 같은 씨앗, 같은 조작인데 판이 다르다`); }
  let clears = 0;
  for (let n = 0; n < 20; n++) { const { s, waves } = play('Rich' + n, [], true); if (s.outcome === 'clear') { clears++; check(waves === 25 && s.results.length === 25, '웨이브 스물다섯'); } }
  check(clears === 20, `자금이 넉넉하면 스테이지 5까지 끝난다 (클리어 ${clears}/20)`);
  done();
}

console.log(fail ? `\n실패 ${fail}건 (확인 ${checks}개)` : `\n모두 통과 (검증 사례 ${tc.cases.length}개 + 확인 ${checks}개)`);
process.exit(fail ? 1 : 0);
