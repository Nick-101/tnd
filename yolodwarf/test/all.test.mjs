// 검증 (시제품 1차). 쓰는 법: node test/all.test.mjs  (또는 npm test)
// 1) yolodwarf_proto1_testcases.json의 사례 304개  2) 참고 엔진과 무작위 보드로 맞대기
// 3) 제작 요청서 8.2절의 열네 가지  4) 무작위로 누르는 봇으로 한 런 끝까지  5) 건물을 데이터에서 지워도 도는가
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { makeEngine, formulaText } from '../js/engine.js';
import { createGame } from '../js/game.js';
import { makeRng } from '../js/rng.js';
import * as ref from '../docs/proto1/reference_engine_proto1.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const data = JSON.parse(readFileSync(join(root, 'data/yolodwarf_proto1_data.json'), 'utf8'));
const tc = JSON.parse(readFileSync(join(root, 'data/yolodwarf_proto1_testcases.json'), 'utf8'));
const engine = makeEngine(data), c = data.constants;
const STACKS = { hunger: '허기', fullness: '포만감', tipsy: '취기', hype: '흥' };

let fail = 0, checks = 0;
const check = (ok, msg) => { checks++; if (!ok) { fail++; if (fail < 40) console.log('  어긋남: ' + msg); } };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const section = name => { const f0 = fail, c0 = checks; return () => console.log(`[${name}] 확인 ${checks - c0}개${fail > f0 ? ` · 어긋남 ${fail - f0}` : ''}`); };
const isShop = id => !!engine.shop(id);

// ── 1. 검증 사례 304개 ───────────────────────────────────────
{
  let pass = 0; const groups = {};
  for (const k of tc.cases) {
    const got = k.kind === 'endWave' ? engine.endWave(k.state, k.salesByTile) : k.kind === 'startPrep' ? engine.startPrep(k.state, k.waveNo) : engine.runWave(k.state, k.wave);
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

// ── 2. 참고 엔진과 맞대기 + 화면이 쓰는 기록이 결과와 맞는지 ───
{
  const done = section('참고 엔진과 무작위 보드 2,000개');
  const ix = ref.index(data), rng = makeRng('diff');
  for (let n = 0; n < 2000; n++) {
    const N = data.waves[rng.int(10)].tiles, used = new Set();
    const board = Array.from({ length: N }, () => {
      if (rng.rand() < 0.2) return null;
      const b = rng.rand() < 0.55 ? data.shops[rng.int(data.shops.length)] : data.supports[rng.int(data.supports.length)];
      if (!isShop(b.id)) { if (used.has(b.id)) return null; used.add(b.id); }
      return b.id;
    });
    const st = { board, levels: board.map(b => (b && isShop(b) && rng.rand() < 0.4 ? 1 + rng.int(3) : 0)), trend: rng.rand() < 0.7 ? c.kinds[rng.int(8)] : null, eventCount: rng.int(9) };
    const wave = Array.from({ length: 1 + rng.int(4) }, () => { const d = data.dwarves[rng.int(90)]; return { likes: d.likes, dislike: d.dislike, trait: rng.rand() < 0.4 ? data.traits[rng.int(5)].id : null }; });
    check(same(engine.runWave(st, wave), ref.runWave(ix, st, wave)), `무작위 보드 #${n}이 참고 엔진과 다르다: ${JSON.stringify({ st, wave })}`);
    // 기록: 매출의 합, 바퀴 수, 계산식, 걷는 차례
    const info = engine.prep(st), r = engine.runDwarf(info, wave[0], 0, null, { eventCount: st.eventCount });
    const uses = r.events.filter(e => e.type === 'use');
    check(uses.reduce((a, e) => a + e.pay, 0) === r.sales && r.events.filter(e => e.type === 'lapEnd').length === r.laps, `#${n} 기록의 합`);
    check(uses.every(e => e.pay === Math.floor((e.fee + e.add) * e.mult) && formulaText(e, STACKS).endsWith(` ${e.pay}`) | formulaText(e, STACKS).includes(`= ${e.pay}`)), `#${n} 기록의 계산식`);
    const heads = r.events.filter(e => e.type === 'lapStart');
    check(r.events.every(e => !('step' in e) || heads.find(h => h.lap === e.lap).path[e.step].tile === e.tile), `#${n} 기록의 걷는 차례`);
    check(r.bestPay === Math.max(0, ...uses.map(e => e.pay)), `#${n} 한 번에 올린 최고 매출`);
  }
  done();
}

// ── 3. 제작 요청서 8.2절 ─────────────────────────────────────
const put = (g, tile, id, extra = {}) => { g.state.board[tile] = { id, stars: 0, lastSales: null, waveSales: 0, ...extra }; };
const quickWave = g => { g.startWave(); while (g.state.phase === 'pick') g.send(0); };
const rich = g => { g.state.money = 1e12; };
const nextPrep = g => { rich(g); quickWave(g); g.proceed(); };
const boardIds = g => g.state.board.map(b => b && b.id);
{
  let done = section('보드가 자란다');
  const g = createGame(data, { seed: 'grow' }); g.begin();
  put(g, 3, 'swimming_pool', { stars: 2 }); put(g, 5, 'event_booth'); put(g, 4, 'gym'); put(g, 6, 'popup_store'); g.state.timers.popup_store = 50; put(g, 7, 'construction_site'); g.state.timers.construction_site = 99;
  for (let w = 1; w <= 10; w++) {
    check(g.state.board.length === 6 + 2 * w && g.state.board.length === data.waves[w - 1].tiles, `웨이브 ${w}의 정비에서 ${6 + 2 * w}칸 (지금 ${g.state.board.length})`);
    if (w > 1) check(same(g.state.newTiles, [4 + 2 * w, 5 + 2 * w]) && g.state.board.slice(-2).every(b => b === null), `웨이브 ${w}: 새 칸 2개가 끝에 빈 칸으로 생긴다`);
    check(g.state.board[3].id === 'swimming_pool' && g.state.board[3].stars === 2 && g.state.board[5].id === 'event_booth' && g.state.board[6].id === 'popup_store', `웨이브 ${w}: 건물과 ★의 칸 번호가 그대로`);
    if (w === 2) { check(g.state.board[3].lastSales > 0, '매출 기록이 남는다'); }
    if (w < 10) { const ec = g.state.eventCount, ls = g.state.board[3].lastSales; nextPrep(g); check(g.state.eventCount >= ec, '이벤트 부스의 세기가 남는다'); check(g.state.timers.popup_store === 50 - w && g.state.timers.construction_site === 99 - w, '남은 횟수가 웨이브마다 하나씩 준다'); void ls; }
  }
  done();

  done = section('후보');
  const cg = createGame(data, { seed: 'cand' }); cg.begin();
  const count = {}; let shopN = 0, total = 0;
  for (let n = 0; n < 8000; n++) {
    rich(cg); cg.state.refreshPresses = 0; cg.refresh();
    const sup = cg.state.candidates.filter(x => !isShop(x.id)).map(x => x.id);
    check(new Set(sup).size === sup.length, '후보에 같은 지원 건물이 두 장');
    for (const x of cg.state.candidates) { total++; if (isShop(x.id)) shopN++; count[x.id] = (count[x.id] || 0) + 1; }
  }
  check(cg.state.candidates.length === 7, '후보 7장');
  check(Math.abs(shopN / total - 0.55) < 0.012, `매장의 비율 ${(100 * shopN / total).toFixed(1)} (기대 55)`);
  const supCounts = data.supports.filter(x => x.inCandidates).map(x => count[x.id] || 0), mean = supCounts.reduce((a, b) => a + b, 0) / supCounts.length;
  check(supCounts.length === 30 && supCounts.every(v => v > mean * 0.85 && v < mean * 1.15), `지원 건물 30채가 고르게 나온다 (가장 적게 ${Math.min(...supCounts)}, 가장 많이 ${Math.max(...supCounts)})`);
  check(data.shops.every(x => count[x.id] > 0), '매장 16곳이 모두 나온다');
  check(!count.landmark, '랜드마크는 후보에 나오지 않는다');
  console.log(`    후보 ${total}장: 매장 ${(100 * shopN / total).toFixed(1)}, 지원 건물 ${(100 - 100 * shopN / total).toFixed(1)} (100장에 몇 장) · 지원 건물 한 채에 ${Math.min(...supCounts)}~${Math.max(...supCounts)}장`);
  // 보드에 지은 것, 끈 건물, 공사 현장의 조건
  const drawMany = (g, n = 2500) => { const seen = new Set(); for (let k = 0; k < n; k++) { rich(g); g.state.refreshPresses = 0; g.refresh(); for (const x of g.state.candidates) seen.add(x.id); } return seen; };
  const b1 = createGame(data, { seed: 'c2' }); b1.begin(); put(b1, 0, 'bank'); put(b1, 1, 'landmark');
  let seen = drawMany(b1);
  check(!seen.has('bank'), '보드에 지은 지원 건물은 나오지 않는다'); check(!seen.has('construction_site'), '보드에 랜드마크가 있으면 공사 현장이 나오지 않는다');
  b1.state.board[1] = null; put(b1, 1, 'construction_site'); check(!drawMany(b1).has('construction_site'), '보드에 공사 현장이 있으면 공사 현장이 나오지 않는다');
  b1.state.board[0] = null; b1.state.board[1] = null; seen = drawMany(b1); check(seen.has('bank') && seen.has('construction_site'), '철거하면 다시 나올 수 있다');
  const b2 = createGame(data, { seed: 'c3', disabled: ['roundabout', 'tip_jar'] }); b2.begin(); seen = drawMany(b2);
  check(!seen.has('roundabout') && !seen.has('tip_jar') && seen.has('bank'), '끈 건물은 나오지 않는다');
  const b3 = createGame(data, { seed: 'c4' }); b3.begin();
  for (let w = 1; w <= 8; w++) { if (w === 7) check(drawMany(b3).has('construction_site'), '일곱째 웨이브의 정비까지는 공사 현장이 나온다'); if (w === 8) check(!drawMany(b3).has('construction_site'), '여덟째 웨이브의 정비부터는 공사 현장이 나오지 않는다'); if (w < 8) nextPrep(b3); }
  const b4 = createGame(data, { seed: 'c5', forced: ['magazine', 'bank', 'roundabout', 'tip_jar'] }); b4.begin();
  check(same(b4.state.candidates.slice(0, 3).map(x => x.id), ['magazine', 'bank', 'roundabout']) && !b4.state.candidates.some(x => x.id === 'tip_jar') && b4.state.candidates.length === 7, '꼭 나오게 한 건물 셋이 첫 정비의 후보에 있다');
  const b5 = createGame(data, { seed: 'c5', forced: ['landmark', 'gym'] }); b5.begin(); check(!b5.state.candidates.some(x => x.id === 'landmark'), '랜드마크는 꼭 나오게 할 수 없다');
  const lo = createGame(data, { seed: 'c6', supportRate: 0.3 }); lo.begin(); let sN = 0, tN = 0; for (let n = 0; n < 4000; n++) { rich(lo); lo.state.refreshPresses = 0; lo.refresh(); for (const x of lo.state.candidates) { tN++; if (isShop(x.id)) sN++; } }
  check(Math.abs(sN / tN - 0.7) < 0.015, `스위치: 지원 건물이 나올 확률 30 → 매장 ${(100 * sN / tN).toFixed(1)}`);
  done();

  done = section('새로고침, 잠금, 덱');
  const r = createGame(data, { seed: 'ref' }); r.begin(); rich(r);
  const costs = []; for (let n = 0; n < 3; n++) { costs.push(r.refreshCost()); const m = r.state.money; r.refresh(); check(r.state.money === m - costs[n], '새로고침 비용만큼 빠진다'); }
  check(same(costs, [5, 10, 20]), `첫 정비에서 5, 10, 20 (${costs})`);
  r.toggleLock(1); const locked = r.state.candidates[1].id; const deck0 = r.state.deck.map(d => d.id + d.trait);
  const bases = [];
  for (let w = 2; w <= 10; w++) { nextPrep(r); bases.push(r.refreshCost()); check(r.state.candidates[1].id === locked && r.state.candidates[1].locked, '잠근 후보는 런 내내 남는다'); check(same(r.state.deck.map(d => d.id + d.trait), deck0), '덱은 런 내내 같은 30마리'); r.refresh(); r.refresh(); }
  check(same(bases, [5, 10, 10, 20, 20, 40, 40, 80, 80]), `정비마다 그 웨이브의 처음 값으로 돌아간다 (${bases})`);
  check(deck0.length === 30 && new Set(r.state.deck.map(d => d.id)).size === 30 && r.state.deck.filter(d => d.trait).length === 10, '덱 30마리, 특성 10마리');
  check(r.state.buildsLeft === 4, '정비마다 4채');
  // 덱은 90마리에서 고르게 뽑는다(인기·비인기 업종 없음): 덱 400개에서 드워프마다 뽑힌 수가 고르다
  const picked = {}; for (let k = 0; k < 400; k++) for (const d of createGame(data, { seed: 'dk' + k }).state.deck) picked[d.id] = (picked[d.id] || 0) + 1;
  const pk = data.dwarves.map(d => picked[d.id] || 0);
  check(Math.min(...pk) > 95 && Math.max(...pk) < 175 && !('popular' in r.state) && !('unpopular' in r.state), `덱은 90마리에서 고르게 뽑는다 (드워프 한 마리가 400덱 가운데 ${Math.min(...pk)}~${Math.max(...pk)}번)`);
  check(createGame(data, { seed: 'x', traits: false }).state.deck.every(d => !d.trait), '스위치: 특성 끔');
  done();

  done = section('순서 (3.6절)');
  // 판정이 대기업 사옥과 은행보다 먼저: 판정 때의 자금에는 철거로 얻은 돈과 이자가 없다
  const o = createGame(data, { seed: 'order' }); o.begin();
  ['swimming_pool', 'conglomerate_tower', 'gym', 'demolition_company', 'bank', 'popup_store', 'construction_site'].forEach((id, i) => put(o, i, id));
  o.state.timers = { popup_store: 1, construction_site: 1 }; o.state.money = 1000;
  o.startWave(); let sum = 0; while (o.state.phase === 'pick') sum += o.send(0).sales;
  const j = o.state.judge;
  check(j.money === 1000 + sum && j.passed, '판정 때의 자금은 시작 자금 + 매출이다');
  const mergerEv = j.events.find(e => e.type === 'merger'), inc = j.events.find(e => e.type === 'demolitionIncome');
  check(mergerEv && inc && o.state.money === j.money + inc.amount, '판정 뒤에 대기업 사옥이 철거하고, 철거 업체가 그 웨이브의 매출만큼 준다');
  check(o.state.board.filter(b => b && isShop(b.id)).length === 1 && o.state.board.find(b => b && isShop(b.id)).stars === 1, '낮은 쪽이 철거되고 남는 쪽에 ★ +1');
  check(o.state.board[5] === null && o.state.board[6].id === 'landmark' && !('popup_store' in o.state.timers) && same(j.events.map(e => e.type), ['demolitionIncome', 'merger', 'gone', 'built']), '그 뒤에 팝업 스토어가 사라지고 공사 현장이 랜드마크가 된다');
  check(o.state.upgradesLeft === 1, '대기업 사옥의 ★은 정비마다 한 번인 업그레이드와 따로다');
  const before = o.state.money; o.proceed();
  check(o.state.money === before + Math.floor(before / 10) && o.state.board.length === 10 && o.state.notices.some(n => n.type === 'interest'), '다음 정비를 시작할 때 칸이 늘고 은행의 이자가 들어온다');
  // 모자라면 런이 끝나고 3부터를 하지 않는다
  const f = createGame(data, { seed: 'order2', targetMult: 4 }); f.begin();
  ['swimming_pool', 'conglomerate_tower', 'gym', 'popup_store'].forEach((id, i) => put(f, i, id)); f.state.timers = { popup_store: 1 }; f.state.money = 0;
  quickWave(f); check(!f.state.judge.passed && f.state.board[3] && f.state.board[0] && f.state.board[2] && f.state.judge.events.length === 0, '모자라면 대기업 사옥도 팝업 스토어도 일하지 않는다');
  f.proceed(); check(f.state.phase === 'over' && f.state.outcome === 'fail', '모자라면 런이 끝난다');
  // 열째 웨이브를 통과한 뒤에도 하지 않는다
  const z = createGame(data, { seed: 'order3' }); z.begin(); for (let w = 1; w < 10; w++) nextPrep(z);
  put(z, 0, 'swimming_pool'); put(z, 1, 'conglomerate_tower'); put(z, 2, 'gym'); rich(z); quickWave(z);
  check(z.state.wave === 9 && z.state.judge.cleared && z.state.board[0] && z.state.board[2] && z.state.judge.events.length === 0, '열째 웨이브를 통과한 뒤에는 3부터를 하지 않는다');
  z.proceed(); check(z.state.phase === 'over' && z.state.outcome === 'clear' && z.state.results.length === 10, '열째 웨이브를 통과하면 클리어');
  // 판정: 자금이 목표와 같으면 통과
  for (const d of [0, -1]) { const k = createGame(data, { seed: 'judge' }); k.begin(); k.state.money = 70 + d; quickWave(k); check(k.state.judge.passed === (d === 0), `자금 ${70 + d} / 목표 70`); }
  check(createGame(data, { seed: 'm', targetMult: 2 }).target() === 140 && same(data.waves.map((_, w) => createGame(data, { seed: 'm' }).targetOf(w)), [70, 350, 1100, 3200, 8800, 23000, 59000, 130000, 290000, 520000]), '목표 열 개와 목표 배율');
  // 신문사가 키운 요금은 웨이브가 끝나면 처음으로
  const n = createGame(data, { seed: 'news' }); n.begin(); rich(n); ['newspaper', 'swimming_pool', 'gym', 'noodle_shop'].forEach((id, i) => put(n, i, id));
  n.startWave(); n.state.hand[0] = { ...n.state.hand[0], likes: ['운동', '식당'], dislike: '오락', trait: null };
  const first = n.send(0); check(first.extraLaps > 0 && n.state.g === first.extraLaps && n.send(0).g0 === first.extraLaps, '추가 바퀴만큼 자라고 다음 드워프에게 이어진다');
  n.send(0); n.proceed(); n.startWave(); check(n.state.g === 0 && n.send(0).g0 === 0, '다음 웨이브에는 처음으로 돌아간다');
  done();

  done = section('쿠폰 가판대, 버스 터미널');
  const q = createGame(data, { seed: 'coupon' }); q.begin(); rich(q); put(q, 0, 'coupon_stand'); put(q, 1, 'swimming_pool');
  q.startWave(); const firstHand = q.state.hand.map(d => d.id);
  const sent = q.state.hand[1]; q.send(1);
  check(q.state.hand.length === 3 && q.state.hand[0] === sent && !q.state.hand.slice(1).some(d => firstHand.includes(d.id)), '다음 셋에 방금 보낸 드워프가 있고 나머지 둘은 덱에서 뽑는다');
  q.send(0); check(q.state.hand[0] === sent, '다시 나온 드워프를 또 보내면 또 나온다');
  q.send(0); check(q.state.waveSends.every(x => x.name === sent.name) && q.state.phase === 'judge', '같은 드워프를 세 번 보낼 수 있다');
  q.proceed(); q.startWave(); check(new Set(q.state.hand.map(d => d.id)).size === 3, '다음 웨이브로 이어지지 않는다');
  const nq = createGame(data, { seed: 'coupon' }); nq.begin(); rich(nq); nq.startWave(); const h0 = nq.state.hand.map(d => d.id); nq.send(1); check(!nq.state.hand.some(d => h0.includes(d.id)), '쿠폰 가판대가 없으면 한 번 나온 드워프는 다시 나오지 않는다');
  const bt = createGame(data, { seed: 'bus' }); bt.begin(); rich(bt); put(bt, 0, 'bus_terminal'); put(bt, 1, 'gym');
  bt.startWave(); check(bt.state.sends === 4, '버스 터미널: 보낼 횟수가 4'); let nSend = 0; while (bt.state.phase === 'pick') { bt.send(0); nSend++; }
  check(nSend === 4 && bt.state.waveSends.length === 4, '4번 보낸다');
  bt.proceed(); bt.demolish(0); bt.startWave(); check(bt.state.sends === 3, '버스 터미널이 없으면 3번');
  done();

  done = section('철거 업체, 팝업 스토어, 공사 현장');
  const d = createGame(data, { seed: 'demo' }); d.begin(); put(d, 0, 'demolition_company'); put(d, 1, 'gym'); put(d, 2, 'neon_sign'); d.state.money = 1000;
  nextPrep(d); const gymSales = d.state.board[1].lastSales; d.state.money = 500;
  check(gymSales > 0 && d.demolish(1) && d.state.money === 500 + gymSales, `매장을 철거하면 지난 웨이브의 매출만큼 들어온다 (+${gymSales})`);
  d.build(d.state.candidates.findIndex(x => x && isShop(x.id)), 1); const m1 = d.state.money; d.demolish(1); check(d.state.money === m1, '이번 정비에 지은 매장은 0');
  d.demolish(2); check(d.state.money === m1, '지원 건물의 철거에는 없다');
  const nd = createGame(data, { seed: 'demo' }); nd.begin(); put(nd, 1, 'gym'); nextPrep(nd); nd.state.money = 500; nd.demolish(1); check(nd.state.money === 500, '철거 업체가 없으면 들어오지 않는다');
  const p = createGame(data, { seed: 'popup' }); p.begin(); rich(p);
  const forceCand = (g, id) => { g.state.candidates[0] = { id, locked: false }; };
  forceCand(p, 'popup_store'); p.build(0, 2); forceCand(p, 'construction_site'); p.build(0, 3);
  check(p.state.timers.popup_store === 2 && p.state.timers.construction_site === 3, '지을 때 남은 횟수가 2와 3');
  nextPrep(p); p.move(2, 6); p.move(3, 7); check(p.state.timers.popup_store === 1 && p.state.timers.construction_site === 2 && p.state.board[6].id === 'popup_store', '자리를 옮겨도 남은 횟수는 그대로');
  nextPrep(p); check(p.state.board[6] === null && !('popup_store' in p.state.timers) && p.state.board[7].id === 'construction_site', '웨이브를 2번 치르면 팝업 스토어가 사라진다(빈 칸)');
  nextPrep(p); check(p.state.board[7].id === 'landmark' && !('construction_site' in p.state.timers), '웨이브를 3번 치르면 공사 현장이 랜드마크가 된다');
  check(p.demolish(7) && p.state.board[7] === null, '랜드마크는 철거할 수 있다');
  done();

  done = section('대출 창구, 잡지사, 이벤트 부스, 팁');
  const l = createGame(data, { seed: 'loan' }); l.begin(); l.state.candidates[0] = { id: 'loan_office', locked: false };
  l.build(0, 0);
  check(l.state.money === 10 + 70 && l.state.borrowed === 70 && l.target() === 140 && l.targetOf(9) === 520070 && l.finalMoney() === 10, '지으면 목표만큼 얻고, 남은 목표가 모두 그만큼 오르고, 빌린 돈이 적힌다');
  l.demolish(0); check(l.state.borrowed === 70 && l.target() === 140, '철거해도 목표와 빌린 돈은 그대로');
  l.state.candidates[1] = { id: 'loan_office', locked: false }; l.build(1, 0); check(l.state.borrowed === 210 && l.state.money === 220 && l.target() === 280, '다시 지으면 또 빌린다(지금 목표만큼)');
  quickWave(l); check(l.state.judge.target === 280 && l.finalMoney() === l.state.money - 210, '끝 화면의 값은 빌린 돈을 뺀 값');
  const t1 = createGame(data, { seed: 'trend' }).state.trends, t2 = createGame(data, { seed: 'trend' }).state.trends;
  check(t1.length === 10 && same(t1, t2) && !same(t1, createGame(data, { seed: 'trend2' }).state.trends), '같은 씨앗이면 유행의 순서가 같다');
  let rep = 0; const seenK = new Set(); for (let k = 0; k < 300; k++) { const t = createGame(data, { seed: 'tr' + k }).state.trends; t.forEach((x, i) => { seenK.add(x); if (i && x === t[i - 1]) rep++; }); }
  check(rep === 0 && seenK.size === 8, '유행하는 업종이 잇달아 같지 않고 여덟 업종이 모두 나온다');
  const mg = createGame(data, { seed: 'trend' }); mg.begin(); put(mg, 0, 'magazine'); const tk = mg.state.trends[0]; const shopOf = data.shops.find(x => x.kinds.includes(tk)); put(mg, 1, shopOf.id);
  check(mg.prep().mult[1] === 3 && mg.prep().trend === tk, '잡지사: 이번 웨이브의 유행하는 업종의 매장은 매출 ×3');
  const e = createGame(data, { seed: 'event' }); e.begin(); rich(e); put(e, 0, 'gym'); put(e, 1, 'event_booth');
  e.startWave(); const c0 = e.state.eventCount; const pv = e.preview(0);
  check(e.state.eventCount === c0 && pv.sales === e.preview(0).sales, '미리보기가 세기를 바꾸지 않는다');
  const r1 = e.send(0); check(r1.sales === pv.sales && e.state.eventCount === c0 + r1.laps, '보내면 이용한 만큼 세기가 오른다');
  while (e.state.phase === 'pick') e.send(0); const c1 = e.state.eventCount; e.proceed(); e.move(1, 5); e.move(0, 4);
  check(e.state.eventCount === c1 && c1 >= 6, '세기가 웨이브를 넘어, 자리를 옮겨도 남는다');
  e.demolish(5); check(e.state.eventCount === 0, '철거하면 사라진다');
  const tp = createGame(data, { seed: 'tip' }); tp.begin(); tp.state.money = 100; put(tp, 0, 'tip_jar'); put(tp, 1, 'gym'); put(tp, 2, 'swimming_pool');
  tp.startWave(); tp.state.hand[0] = { ...tp.state.hand[0], likes: ['운동', '식당'], dislike: '오락', trait: 'easygoing' };
  const pvt = tp.preview(0), rt = tp.send(0);
  check(rt.tip > 0 && rt.tip === Math.floor(rt.sales * rt.satLeft / 10) && pvt.tip === rt.tip, `팁 = floor(매출 × 남은 만족도 ÷ 10) (매출 ${rt.sales}, 남은 만족도 ${rt.satLeft}, 팁 ${rt.tip})`);
  check(tp.state.money === 100 + rt.sales + rt.tip, '팁은 자금에 들어간다');
  check(tp.state.board[1].waveSales + tp.state.board[2].waveSales === rt.sales && tp.state.waveSales === rt.sales && tp.state.waveTips === rt.tip, '팁은 매장의 매출 기록에 들어가지 않는다');
  check(tp.state.bestPay.pay === rt.bestPay && rt.bestPay < rt.sales, '팁은 "한 번에 올린 최고 매출"에 들어가지 않는다');
  done();

  done = section('업그레이드');
  const u = createGame(data, { seed: 'up' }); u.begin(); put(u, 0, 'swimming_pool'); put(u, 1, 'ad_tower');
  check(u.upgradeInfo(0).reason === 'new' && u.upgradeInfo(1).reason === 'support', '이번 정비에 지은 매장과 지원 건물은 못 올린다');
  nextPrep(u); const pool = u.state.board[0];
  check(u.upgradeInfo(0).cost === Math.max(10, pool.lastSales * 2) && u.upgrade(0) && pool.stars === 1 && u.upgradeInfo(0).reason === 'once', '비용은 max(10, 지난 웨이브 매출 × 2), 정비마다 한 번');
  nextPrep(u); u.upgrade(0); nextPrep(u); u.upgrade(0); nextPrep(u); check(pool.stars === 3 && u.upgradeInfo(0).reason === 'max', '★ 셋에서 멈춘다');
  done();
}

// ── 4. 무작위로 누르는 봇으로 런을 끝까지 ────────────────────
{
  const done = section('무작위 봇 60런');
  const play = (seed, record, richRun, opts = {}, d = data) => {
    const g = createGame(d, { seed, ...opts }), s = g.state, bot = makeRng('bot' + seed), shop = id => !!g.engine.shop(id);
    let guard = 0;
    g.begin();
    while (s.phase !== 'over' && guard++ < 2000) {
      if (richRun) s.money = Math.max(s.money, 1e9);
      if (s.phase === 'prep') {
        check(s.board.length === 8 + 2 * s.wave && s.candidates.length === 7 && s.candidates.every(x => x) && s.buildsLeft === 4 && s.upgradesLeft === 1 && s.refreshPresses === 0, `씨앗 ${seed}: 정비 시작`);
        if (bot.rand() < 0.3) g.toggleLock(bot.int(7));
        if (bot.rand() < 0.4) g.refresh();
        if (bot.rand() < 0.5) g.demolish(bot.int(s.board.length));
        let built = 0;
        for (let k = 0; k < 40; k++) { const e = s.board.map((b, i) => (b ? -1 : i)).filter(i => i >= 0); if (e.length && g.build(bot.int(7), e[bot.int(e.length)])) built++; }
        check(built <= 4, `씨앗 ${seed}: 정비마다 4채까지`);
        const sup = s.board.filter(b => b && !shop(b.id)).map(b => b.id);
        check(new Set(sup).size === sup.length, `씨앗 ${seed}: 같은 지원 건물이 보드에 두 채`);
        for (let k = 0; k < 6; k++) g.upgrade(bot.int(s.board.length));
        g.move(bot.int(s.board.length), bot.int(s.board.length));
        check(Object.keys(s.timers).every(id => s.board.some(b => b && b.id === id)), `씨앗 ${seed}: 남은 횟수는 보드에 있는 건물의 것만`);
        record.push(s.board.map(b => b && b.id + b.stars), s.candidates.map(x => x && x.id), s.money);
        g.startWave();
      } else if (s.phase === 'pick') {
        check(s.hand.length === 3 && !g.build(0, s.board.findIndex(b => !b)) && !g.refresh() && !g.demolish(0) && !g.upgrade(0), `씨앗 ${seed}: 웨이브에서는 건설, 철거, 새로고침, 업그레이드를 못 한다`);
        const i = bot.int(3), m = s.money, pv = g.preview(i), r = g.send(i);
        check(r.sales === pv.sales && r.tip === pv.tip && (s.phase !== 'pick' || s.money === m + r.sales + r.tip), `씨앗 ${seed}: 보내기`);
        record.push(r.dwarf.name, r.sales, r.tip);
      } else if (s.phase === 'judge') { check(s.judge.passed === (s.judge.money >= s.judge.target), '판정'); g.proceed(); }
    }
    check(s.phase === 'over' && s.money >= 0, `씨앗 ${seed}: 런이 끝났다`);
    return s;
  };
  for (let n = 0; n < 30; n++) { const a = [], b = []; play('R' + n, a, false); play('R' + n, b, false); check(same(a, b), `씨앗 R${n}: 같은 씨앗, 같은 조작인데 판이 다르다`); }
  let clears = 0; const builtAll = new Set();
  for (let n = 0; n < 30; n++) { const s = play('Rich' + n, [], true); if (s.outcome === 'clear') { clears++; check(s.results.length === 10 && s.board.length === 26, '웨이브 열, 26칸'); } s.log.forEach(l => l.built.forEach(id => builtAll.add(id))); }
  check(clears === 30, `자금이 넉넉하면 웨이브 10까지 끝난다 (클리어 ${clears}/30)`);
  check(data.supports.filter(x => x.inCandidates).every(x => builtAll.has(x.id)), `지원 건물 30채를 모두 지어 봤다 (${[...builtAll].filter(id => !isShop(id)).length}채)`);
  done();

  // ── 5. 건물을 데이터에서 지워도 돈다 ──
  const done2 = section('건물을 데이터에서 지우고 돌리기');
  for (const gone of data.supports.map(x => x.id)) {
    const d2 = { ...data, supports: data.supports.filter(x => x.id !== gone) };
    let ok = true;
    try { const s = play('Del' + gone, [], true, {}, d2); ok = s.outcome === 'clear' && !s.log.some(l => l.seen.includes(gone) || l.built.includes(gone)); } catch (err) { ok = false; console.log('   ', gone, err.message); }
    check(ok, `${gone}을(를) 지우면 그 건물 없이 끝까지 돈다`);
  }
  for (const gone of ['park', 'dive_bar']) {
    const d2 = { ...data, shops: data.shops.filter(x => x.id !== gone) };
    let ok = true; try { ok = play('DelS' + gone, [], true, {}, d2).outcome === 'clear'; } catch (err) { ok = false; console.log('   ', gone, err.message); }
    check(ok, `매장 ${gone}을(를) 지워도 돈다`);
  }
  done2();
}

console.log(fail ? `\n실패 ${fail}건 (확인 ${checks}개)` : `\n모두 통과 (검증 사례 ${tc.cases.length}개 + 확인 ${checks}개)`);
process.exit(fail ? 1 : 0);
