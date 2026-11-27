// 검증 (데모 3.0). 쓰는 법: node test/all.test.mjs  (또는 npm test)
// 1) yolodwarf3_testcases.json의 사례 494개  2) 참고 엔진과 무작위 보드로 맞대기
// 3) 제작 요청서 8.3절의 열네 가지  4) 무작위로 누르는 봇으로 한 런 끝까지  5) 건물을 데이터에서 지워도 도는가
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { makeEngine, formulaText } from '../js/engine.js';
import { createGame } from '../js/game.js';
import { makeRng } from '../js/rng.js';
import * as ref from '../docs/demo3/reference_engine3.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const data = JSON.parse(readFileSync(join(root, 'data/yolodwarf3_data.json'), 'utf8'));
const tc = JSON.parse(readFileSync(join(root, 'data/yolodwarf3_testcases.json'), 'utf8'));
const engine = makeEngine(data), c = data.constants;
const STACKS = { hunger: '허기', fullness: '포만감', tipsy: '취기', hype: '흥' };

let fail = 0, checks = 0;
const check = (ok, msg) => { checks++; if (!ok) { fail++; if (fail < 40) console.log('  어긋남: ' + msg); } };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const section = name => { const f0 = fail, c0 = checks; return () => console.log(`[${name}] 확인 ${checks - c0}개${fail > f0 ? ` · 어긋남 ${fail - f0}` : ''}`); };
const isShop = id => !!engine.shop(id);

// ── 1. 검증 사례 494개 ───────────────────────────────────────
function runCase(cs) {
  if (cs.kind === 'wave') return engine.runWave(cs.state, cs.dwarves, cs.guest || null);
  if (cs.kind === 'ops') { let st = cs.state; const steps = []; for (const op of cs.ops) { const r = engine.apply(st, op); if (r.illegal) steps.push('illegal'); else { st = r; steps.push('ok'); } } return { steps, state: st }; }
  if (cs.kind === 'endWave') return engine.endWave(cs.state, cs.salesByTile);
  if (cs.kind === 'startPrep') return engine.startPrep(cs.state, cs.waveNo);
  return { sends: engine.sends(cs.state), reward: engine.guestReward(cs.waveNo, cs.extraLaps), refresh: engine.refreshCost(cs.waveNo, cs.presses) };
}
{
  let pass = 0; const groups = {};
  for (const k of tc.cases) {
    const got = runCase(k), ok = same(got, k.expected);
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
  const specials = data.specialTiles.map(x => x.id);
  for (let n = 0; n < 2000; n++) {
    const N = 8 + rng.int(12), used = new Set();
    const board = Array.from({ length: N }, () => {
      if (rng.rand() < 0.15) return null;
      const b = rng.rand() < 0.55 ? data.shops[rng.int(data.shops.length)] : data.supports[rng.int(data.supports.length)];
      if (!isShop(b.id)) { if (used.has(b.id)) return null; used.add(b.id); }
      return b.id;
    });
    const tiles = board.map(() => null); for (const sp of rng.shuffle(specials).slice(0, rng.int(4))) tiles[rng.int(N)] = sp;
    const uniq = tiles.map((t, i) => (t && tiles.indexOf(t) !== i ? null : t));
    const st = { board, stars: board.map(b => (b && isShop(b) && rng.rand() < 0.4 ? 1 + rng.int(3) : 0)), grow: board.map(b => (b && isShop(b) && rng.rand() < 0.5 ? rng.int(60) : 0)), tiles: uniq, kept: board.map(() => 0), timers: board.includes('popup_store') ? { popup_store: 2 } : {}, money: 0 };
    const wave = Array.from({ length: 1 + rng.int(4) }, () => { const d = data.dwarves[rng.int(90)]; return { likes: d.likes, dislike: d.dislike, trait: rng.rand() < 0.4 ? data.traits[rng.int(5)].id : null }; });
    const guest = rng.rand() < 0.5 ? data.guests[rng.int(6)].id : null;
    check(same(engine.runWave(st, wave, guest), ref.runWave(ix, st, wave, guest)), `무작위 보드 #${n}이 참고 엔진과 다르다: ${JSON.stringify({ st, wave, guest })}`);
    // 기록: 매출의 합, 바퀴 수, 계산식, 걷는 차례, 자란 배율
    const who = guest ? { ...engine.guest(guest), guest: true } : wave[0];
    const before = JSON.stringify(st), r = engine.runDwarf(st, who, { first: true });
    check(JSON.stringify(st) === before, `#${n} 드워프 한 마리의 계산이 상태를 바꿨다`);
    const uses = r.events.filter(e => e.type === 'use');
    check(uses.reduce((a, e) => a + e.pay, 0) === r.sales && r.events.filter(e => e.type === 'lapEnd').length === r.laps, `#${n} 기록의 합`);
    check(uses.every(e => e.pay === Math.floor((e.fee + e.add) * e.mult10 * e.fan * e.guestMult / 10) && formulaText(e, STACKS).length > 0), `#${n} 기록의 계산식`);
    let head = null, okPath = true; for (const e of r.events) { if (e.type === 'lapStart') head = e; else if ('step' in e && (!head.path[e.step] || head.path[e.step].tile !== e.tile)) okPath = false; }
    check(okPath, `#${n} 기록의 걷는 차례`);
    const grown = st.grow.slice(); for (const e of r.events) if (e.type === 'grow') for (const ch of e.changes) grown[ch.tile] += ch.amount;
    check(same(grown, r.grow), `#${n} 기록의 자란 배율의 합이 결과와 같다`);
    // 무작위로 손대는 일도 참고 엔진과 같다
    let a = st, b = st;
    for (let k = 0; k < 6; k++) {
      const pickId = () => { const list = rng.rand() < 0.6 ? data.shops : data.supports; return list[rng.int(list.length)].id; };
      const ops = [{ type: 'build', tile: rng.int(N), id: pickId() }, { type: 'overlap', tile: rng.int(N), id: board[rng.int(N)] || 'park' }, { type: 'replace', tile: rng.int(N), id: pickId() }, { type: 'demolish', tile: rng.int(N) },
        { type: 'swap', a: rng.int(N), b: rng.int(N) }, { type: 'insert', gap: rng.int(N), from: rng.int(N) }, { type: 'insert', gap: rng.int(N), id: pickId() }, { type: 'addTile', pos: rng.int(N + 2), special: specials[rng.int(8)] }];
      const op = ops[rng.int(ops.length)], ra = engine.apply(a, op), rb = ref.apply(ix, b, op);
      check(same(ra, rb), `#${n} 손대는 일 ${JSON.stringify(op)}`);
      if (!ra.illegal) { a = ra; b = rb; }
    }
  }
  done();
}

// ── 3. 제작 요청서 8.3절 ─────────────────────────────────────
const rich = g => { g.state.st.money = 1e12; };
const place = (g, tile, id, stars = 0, grow = 0) => { const s = g.state; s.st.board[tile] = id; s.st.stars[tile] = stars; s.st.grow[tile] = grow; s.uid[tile] = s.nextUid++; if (engine.support(id) && engine.support(id).waves) s.st.timers[id] = engine.support(id).waves; };
const trimHand = g => { while (g.state.hand.length > c.hand.keep) g.discard(0); };
const runWaveQuick = g => { trimHand(g); g.startWave(); while (g.state.phase === 'pick') g.send(0); if (g.state.phase === 'guest') g.runGuest(); };
const nextPrep = g => { rich(g); runWaveQuick(g); g.proceed(); if (g.state.phase === 'reward') g.chooseReward(g.state.judge.reward.offer[0], g.state.st.board.length); };
{
  let done = section('보드, 시작 손패, 덱');
  for (let k = 0; k < 200; k++) {
    const g = createGame(data, { seed: 'st' + k }), s = g.state;
    check(s.st.board.length === 8 && s.st.board.every(b => b === null) && s.st.tiles.filter(t => t).length === 1 && s.st.tiles[s.start.tile] === s.start.special, '시작 보드는 8칸이고 특수 칸이 꼭 하나다');
    check(s.hand.length === 4 && s.hand.filter(isShop).length === 3, '시작 손패는 매장 3장과 지원 건물 1장');
    check(s.guests.length === 3 && new Set(s.guests).size === 3 && s.guests.every(id => engine.guest(id)), '귀빈 셋이 정해지고 서로 다르다');
    check(s.deck.length === 30 && new Set(s.deck.map(d => d.id)).size === 30 && s.deck.filter(d => d.trait).length === 10 && !('popular' in s), '덱 30마리, 특성 10마리, 인기·비인기 업종 없음');
  }
  const seenSp = new Set(), seenTile = new Set(), seenG = new Set(), seenSup = new Set();
  for (let k = 0; k < 400; k++) { const s = createGame(data, { seed: 'v' + k }).state; seenSp.add(s.start.special); seenTile.add(s.start.tile); s.guests.forEach(x => seenG.add(x)); seenSup.add(s.hand.find(id => !isShop(id))); }
  check(seenSp.size === 8 && seenTile.size === 8 && seenG.size === 6 && seenSup.size === 20, `특수 칸 8가지, 칸 8곳, 귀빈 6명, 지원 건물 20채가 모두 시작에 나올 수 있다 (${seenSp.size}, ${seenTile.size}, ${seenG.size}, ${seenSup.size})`);
  const off = ['ad_tower', 'roundabout', 'second_branch'];
  let bad = 0; for (let k = 0; k < 300; k++) if (createGame(data, { seed: 'd' + k, disabled: off }).state.hand.some(id => off.includes(id))) bad++;
  check(bad === 0, '끈 건물은 시작 손패에 나오지 않는다');
  const sw = createGame(data, { seed: 'sw', guestPicks: ['collector', null, 'gourmet'], startSpecial: 'rotary', traits: false }).state;
  check(sw.guests[0] === 'collector' && sw.guests[2] === 'gourmet' && new Set(sw.guests).size === 3 && sw.start.special === 'rotary' && sw.deck.every(d => !d.trait), '스위치: 귀빈 고르기, 시작 특수 칸, 특성 끔');
  const g = createGame(data, { seed: 'grow' }); g.begin(); place(g, 2, 'gift_shop', 2, 7);
  const deck0 = g.state.deck.map(d => d.id + d.trait);
  for (let w = 1; w <= 10; w++) {
    const extra = g.state.st.tiles.filter(t => t).length - 1;
    check(g.state.st.board.length === 7 + w + extra, `웨이브 ${w}의 정비에서 ${7 + w}칸(+끼워 넣은 특수 칸 ${extra})`);
    if (w > 1) check(same(g.state.newTiles, [g.state.st.board.length - 1]) && g.state.st.board[g.state.st.board.length - 1] === null, `웨이브 ${w}: 새 칸이 끝에 생긴다`);
    check(same(g.state.deck.map(d => d.id + d.trait), deck0), '덱은 런 내내 같은 30마리');
    if (w < 10) nextPrep(g);
  }
  check(g.state.st.board.includes('gift_shop') && g.state.st.stars[g.state.st.board.indexOf('gift_shop')] === 2 && g.state.st.tiles.filter(t => t).length >= 1 && g.state.st.tiles.filter(t => t).length <= 3, '건물과 ★이 남고, 특수 칸은 셋까지다');
  done();

  done = section('후보, 고르기, 손패, 새로고침');
  const cg = createGame(data, { seed: 'cand' }); cg.begin();
  check(cg.state.candidates.length === 5 && cg.state.candidates.every(x => x && !x.built), '첫 정비: 후보 5장, 첫 장은 지은 매장이 아니다');
  let shopN = 0, total = 0; const cnt = {};
  for (let n = 0; n < 6000; n++) {
    rich(cg); cg.state.refreshPresses = 0; cg.refresh();
    const sup = cg.state.candidates.filter(x => !isShop(x.id)).map(x => x.id);
    check(new Set(sup).size === sup.length && !sup.some(id => cg.state.hand.includes(id)), '후보 안에 같은 지원 건물이 두 장 없고 손패에 있는 지원 건물이 나오지 않는다');
    for (const x of cg.state.candidates) { total++; if (isShop(x.id)) shopN++; cnt[x.id] = (cnt[x.id] || 0) + 1; }
  }
  check(Math.abs(shopN / total - 0.55) < 0.012, `매장의 비율 ${(100 * shopN / total).toFixed(1)} (기대 55)`);
  const handSup = cg.state.hand.find(id => !isShop(id));
  check(data.supports.filter(x => x.id !== handSup).every(x => cnt[x.id] > 0) && !cnt[handSup] && data.shops.every(x => cnt[x.id] > 0), '손패에 없는 지원 건물 19채와 매장 16곳이 모두 후보에 나온다');
  console.log(`    후보 ${total}장: 매장 ${(100 * shopN / total).toFixed(1)}, 지원 건물 ${(100 - 100 * shopN / total).toFixed(1)} (100장에 몇 장)`);
  // 둘째 정비부터 첫 장은 보드에 지은 매장
  const b = createGame(data, { seed: 'built' }); b.begin(); place(b, 0, 'park'); place(b, 1, 'pub'); place(b, 2, 'ad_tower'); nextPrep(b);
  const firsts = new Set(); let rest = 0, restShop = 0;
  for (let n = 0; n < 3000; n++) { rich(b); b.state.refreshPresses = 0; b.refresh(); const cs = b.state.candidates; check(cs[0].built && ['park', 'pub'].includes(cs[0].id), '둘째 정비부터 첫 장은 보드에 지은 매장'); firsts.add(cs[0].id); for (const x of cs.slice(1)) { rest++; if (isShop(x.id)) restShop++; check(x.id !== 'ad_tower' && !x.built, '보드에 지은 지원 건물은 나오지 않는다'); } }
  check(firsts.size === 2 && Math.abs(restShop / rest - 0.55) < 0.015, `첫 장은 지은 매장 가운데서 고르게, 나머지는 매장 55 언저리 (${(100 * restShop / rest).toFixed(1)})`);
  const nb = createGame(data, { seed: 'nob' }); nb.begin(); nextPrep(nb); check(!nb.state.candidates[0].built, '보드에 매장이 없으면 첫 장도 보통대로 뽑는다');
  const dis = createGame(data, { seed: 'dis', disabled: ['guestbook', 'fan_club'] }); dis.begin(); const seen = new Set(); for (let n = 0; n < 2500; n++) { rich(dis); dis.state.refreshPresses = 0; dis.refresh(); dis.state.candidates.forEach(x => seen.add(x.id)); }
  check(!seen.has('guestbook') && !seen.has('fan_club') && seen.has('ad_tower'), '끈 건물은 후보에 나오지 않는다');
  const fo = createGame(data, { seed: 'fo', forced: ['roundabout', 'second_branch', 'ad_tower'] }); fo.begin();
  check(fo.state.candidates.length === 5 && (fo.state.hand.includes('roundabout') || fo.state.candidates[0].id === 'roundabout') && fo.state.candidates.filter(x => ['roundabout', 'second_branch'].includes(x.id)).length + fo.state.hand.filter(x => ['roundabout', 'second_branch'].includes(x)).length === 2 && !fo.state.candidates.some(x => x.id === 'ad_tower' && fo.state.candidates.indexOf(x) < 2 && false), '꼭 나오게 한 건물 둘이 첫 정비의 후보(나 시작 손패)에 있다');
  const lo = createGame(data, { seed: 'lo', supportRate: 0.3 }); lo.begin(); let sN = 0, tN = 0; for (let n = 0; n < 4000; n++) { rich(lo); lo.state.refreshPresses = 0; lo.refresh(); for (const x of lo.state.candidates) { tN++; if (isShop(x.id)) sN++; } }
  check(Math.abs(sN / tN - 0.7) < 0.015, `스위치: 지원 건물이 나올 확률 30 → 매장 ${(100 * sN / tN).toFixed(1)}`);
  // 고르기: 2장까지. 새로고침 뒤에도 고른 수가 이어진다
  const p = createGame(data, { seed: 'pick' }); p.begin(); rich(p);
  check(p.pick(0) && p.state.hand.length === 5 && p.state.picksLeft === 1 && !p.pick(0), '고르면 손패에 들어가고 같은 후보는 다시 못 고른다');
  const costs = [p.refreshCost()]; const m0 = p.state.st.money; p.refresh(); costs.push(p.refreshCost()); p.refresh(); costs.push(p.refreshCost());
  check(same(costs, [5, 10, 20]) && p.state.st.money === m0 - 15, `첫 정비에서 새로고침 5, 10, 20 (${costs})`);
  check(p.state.picksLeft === 1 && p.state.candidates[0].picked && p.state.candidates.slice(1).every(x => x && !x.picked), '새로고침은 고르지 않은 후보만 다시 뽑고 고른 수는 그대로다');
  check(p.pick(2) && p.state.picksLeft === 0 && !p.pick(3) && p.state.hand.length === 6 && !p.canRefresh(), '2장까지만 골라진다');
  // 손패: 2장까지 남긴다
  check(!p.startWave() && p.state.phase === 'prep', '손패가 2장을 넘으면 정비를 마칠 수 없다');
  while (p.state.hand.length > 2) p.discard(0); const kept = p.state.hand.slice();
  check(p.startWave(), '2장이면 마칠 수 있다'); while (p.state.phase === 'pick') p.send(0); p.proceed();
  check(same(p.state.hand, kept) && p.state.picksLeft === 2 && p.refreshCost() === 10, '남긴 카드가 다음 정비에 그대로 있고, 새로고침은 그 웨이브의 처음 값으로 돌아간다');
  const bases = [p.refreshCost()]; for (let w = 3; w <= 10; w++) { p.refresh(); nextPrep(p); bases.push(p.refreshCost()); }
  check(same(bases, data.waves.slice(1).map(w => w.refreshBase)), `정비마다 처음 값 (${bases})`);
  const poor = createGame(data, { seed: 'poor' }); poor.begin(); poor.state.st.money = 4; check(!poor.refresh() && poor.state.st.money === 4, '자금이 모자라면 새로고침을 못 누른다');
  done();

  done = section('카드를 쓰는 법, 끼워 넣기');
  const u = createGame(data, { seed: 'use' }); u.begin(); u.state.hand = ['pub', 'pub', 'park', 'ad_tower', 'ad_tower', 'gift_shop'];
  check(u.playCard(0, { tile: 3 }).ok && u.state.st.board[3] === 'pub' && u.state.hand.length === 5, '짓는다');
  check(u.playCard(0, { tile: 3 }).op.type === 'overlap' && u.state.st.stars[3] === 1, '겹친다: ★ +1');
  u.state.st.grow[3] = 12; u.state.st.stars[3] = 3; u.state.hand.push('pub');
  check(!!u.playCard(u.state.hand.length - 1, { tile: 3 }).illegal && u.state.hand.includes('pub'), '★★★인 매장에는 겹칠 수 없고 카드는 손에 남는다');
  check(u.playCard(1, { tile: 4 }).ok && u.state.st.board[4] === 'ad_tower' && !!u.playCard(1, { tile: 5 }).illegal, '같은 지원 건물은 한 채');
  check(u.playCard(0, { tile: 3 }).op.type === 'replace' && u.state.st.board[3] === 'park' && u.state.st.stars[3] === 0 && u.state.st.grow[3] === 0, '바꿔 짓는다: 있던 매장의 ★과 키운 배율이 사라진다');
  const hl = u.state.hand.length; check(u.discard(0) && u.state.hand.length === hl - 1, '버린다');
  // 끼워 넣기: 미리 보기와 놓은 뒤의 보드가 같다
  const q = createGame(data, { seed: 'ins' }); q.begin(); ['pub', 'park', null, 'gift_shop', 'inn'].forEach((id, i) => id && place(q, i, id, i, i * 3)); q.state.hand = ['tea_room'];
  const pv = q.preview({ type: 'insert', gap: 1, id: 'tea_room' });
  check(q.playCard(0, { gap: 1 }).ok && same(q.state.st.board.slice(0, 5), ['pub', 'tea_room', 'park', 'gift_shop', 'inn']) && same(q.state.st, pv), '손패의 카드를 틈에: 가까운 빈 칸 쪽으로 밀리고, 미리 보기와 같다');
  check(q.state.st.stars[2] === 1 && q.state.st.grow[2] === 3, '★과 키운 배율이 건물을 따라간다');
  const pv2 = q.preview({ type: 'insert', gap: 4, from: 0 }); const uidPub = q.state.uid[0];
  check(q.insertFrom(0, 4) && same(q.state.st, pv2) && same(q.state.st.board.slice(0, 6), [null, 'tea_room', 'park', 'gift_shop', 'pub', 'inn']) && q.state.uid[4] === uidPub, '보드의 건물을 틈으로: 가까운 빈 칸 쪽으로 밀리고, 미리 보기와 같다');
  q.startWave(); const before = q.state.st.board.slice();
  check(q.swap(0, 1) && q.insertFrom(0, 5) && !same(q.state.st.board, before) && !q.playCard(0, { tile: 6 }).ok, '웨이브 도중에도 자리 바꾸기와 끼워 넣기가 된다. 카드는 정비 때만 쓴다');
  const full = createGame(data, { seed: 'full' }); full.begin(); for (let i = 0; i < 8; i++) place(full, i, 'park'); full.state.hand = ['pub'];
  place(full, 0, 'pub'); place(full, 1, 'inn');
  check(!!full.playCard(0, { gap: 3 }).illegal && full.insertFrom(0, 4) && same(full.state.st.board.slice(0, 4), ['inn', 'park', 'park', 'pub']), '빈 칸이 없으면 손패의 카드는 끼워 넣을 수 없다. 보드의 건물은 옮길 수 있고 사이의 건물들이 당겨진다');
  // 터줏자리
  const o = createGame(data, { seed: 'old', startSpecial: 'old_site' }); o.begin(); const ot = o.state.start.tile; place(o, ot, 'pub', 2, 30);
  check(o.demolish(ot) && o.state.st.kept[ot] === 30 && o.state.st.board[ot] === null, '터줏자리의 매장을 철거하면 키운 배율이 칸에 남는다');
  o.state.hand = ['park']; o.playCard(0, { tile: ot }); check(o.state.st.grow[ot] === 30 && o.state.st.kept[ot] === 0, '다음에 놓이는 매장이 가져간다');
  done();

  done = section('웨이브: 순서, 쿠폰 가판대, 버스 터미널, 미리보기');
  const w = createGame(data, { seed: 'order', targetMult: 0.5 }); w.begin();
  ['swimming_pool', 'conglomerate_tower', 'pub', null, 'popup_store'].forEach((id, i) => id && place(w, i, id)); w.state.st.timers.popup_store = 1; w.state.st.money = 1000;
  trimHand(w); w.startWave(); let sum = 0; while (w.state.phase === 'pick') sum += w.send(0).sales;
  const j = w.state.judge;
  check(j.passed && j.money === 1000 + sum, '판정 때의 자금은 시작 자금 + 매출이다');
  check(same(j.events.map(e => e.type), ['merger', 'gone']) && w.state.st.board.filter(x => x && isShop(x)).length === 1 && Math.max(...w.state.st.stars) === 1 && !w.state.st.board.includes('popup_store'), '판정 뒤에 대기업 사옥이 낮은 쪽을 철거하고 ★을 주고, 그 뒤에 팝업 스토어가 사라진다');
  const f = createGame(data, { seed: 'order2' }); f.begin(); ['swimming_pool', 'conglomerate_tower', 'pub'].forEach((id, i) => place(f, i, id)); f.state.st.money = 0; runWaveQuick(f);
  check(!f.state.judge.passed && f.state.st.board[0] && f.state.st.board[2] && f.state.judge.events.length === 0, '모자라면 대기업 사옥이 일하지 않는다'); f.proceed(); check(f.state.phase === 'over' && f.state.outcome === 'fail', '모자라면 런이 끝난다');
  for (const d of [0, -1]) { const k = createGame(data, { seed: 'judge' }); k.begin(); k.state.st.money = 140 + d; runWaveQuick(k); check(k.state.judge.passed === (d === 0), `자금 ${140 + d} / 목표 140`); }
  check(same(data.waves.map((_, i) => createGame(data, { seed: 'm' }).targetOf(i)), [140, 460, 2200, 4700, 10000, 31000, 54000, 97000, 160000, 370000]) && createGame(data, { seed: 'm', targetMult: 2 }).target() === 280, '목표 열 개와 목표 배율');
  // 쿠폰 가판대
  const cp = createGame(data, { seed: 'coupon' }); cp.begin(); rich(cp); place(cp, 0, 'coupon_stand'); place(cp, 1, 'pub'); trimHand(cp); cp.startWave();
  const first3 = cp.state.hand3.map(d => d.id), sent = cp.state.hand3[1]; cp.send(1);
  check(cp.state.hand3.length === 3 && cp.state.hand3[0] === sent && !cp.state.hand3.slice(1).some(d => first3.includes(d.id)), '쿠폰 가판대: 다음 셋에 방금 보낸 드워프가 있다');
  cp.send(0); cp.send(0); check(cp.state.waveSends.every(x => x.name === sent.name), '같은 드워프를 세 번 보낼 수 있다'); cp.proceed(); trimHand(cp); cp.startWave(); check(new Set(cp.state.hand3.map(d => d.id)).size === 3, '다음 웨이브로 이어지지 않는다');
  // 버스 터미널
  const bt = createGame(data, { seed: 'bus', startSpecial: 'station_front' }); bt.begin(); rich(bt); const st0 = bt.state.start.tile; const other = (st0 + 3) % 8;
  place(bt, other, 'bus_terminal'); place(bt, (st0 + 1) % 8, 'pub'); check(bt.sendsNow() === 4, '버스 터미널: 4번');
  bt.swap(other, st0); check(bt.sendsNow() === 5, '역 앞의 버스 터미널: 5번');
  trimHand(bt); bt.startWave(); bt.send(0); bt.send(0); bt.demolish(st0); check(bt.sendsNow() === 3, '웨이브 도중에 철거하면 횟수가 다시 세어진다'); bt.send(0); check(bt.state.phase === 'judge' && bt.state.waveSends.length === 3, '다시 센 횟수만큼 보내면 웨이브가 끝난다');
  const b2 = createGame(data, { seed: 'bus2' }); b2.begin(); rich(b2); place(b2, 0, 'bus_terminal'); place(b2, 1, 'pub'); trimHand(b2); b2.startWave(); b2.send(0); b2.send(0); b2.send(0);
  check(b2.state.phase === 'pick' && b2.demolish(0) && b2.state.phase === 'judge' && b2.state.waveSends.length === 3, '세 번 보낸 뒤에 버스 터미널을 철거하면 웨이브가 거기서 끝난다');
  // 미리보기는 배율을 키우지 않는다
  const pvg = createGame(data, { seed: 'pv' }); pvg.begin(); rich(pvg); ['pub', 'ad_tower', 'gift_shop', 'popup_store', 'fan_club'].forEach((id, i) => place(pvg, i, id)); trimHand(pvg); pvg.startWave();
  const g0 = JSON.stringify(pvg.state.st), x1 = pvg.previewSend(0), x2 = pvg.previewSend(0);
  check(JSON.stringify(pvg.state.st) === g0 && x1.sales === x2.sales, '예상 매출 미리보기가 배율을 키우지 않는다');
  const out = pvg.send(0); check(out.sales === x1.sales && pvg.state.st.grow.some(v => v > 0) && same(out.grow, pvg.state.st.grow), '보내면 미리보기와 같은 매출이 들어오고 배율이 자란다');
  done();

  done = section('귀빈과 보상');
  const gq = createGame(data, { seed: 'guest', guestPicks: ['pilgrim', 'collector', 'drunkard'] }); gq.begin();
  ['opera_house', 'gift_shop', 'coffee_shop', 'outdoor_stage', 'opening_wreath', 'jewelry_store'].forEach((id, i) => place(gq, i, id, 1));
  nextPrep(gq); nextPrep(gq);
  check(gq.state.wave === 2 && gq.isGuestWave() && gq.guestOfWave().id === 'pilgrim', '3웨이브는 귀빈 웨이브다');
  rich(gq); trimHand(gq); gq.startWave(); let nS = 0; while (gq.state.phase === 'pick') { gq.send(0); nS++; }
  check(nS === 3 && gq.state.phase === 'guest', '드워프를 다 보낸 뒤에 귀빈이 돌 차례가 된다');
  const growB = gq.state.st.grow.slice(), mB = gq.state.st.money, go = gq.runGuest();
  check(go.dwarf.guest && go.sales > 0 && gq.state.st.money === mB + go.sales && gq.state.phase === 'judge' && gq.state.guestRun.extraLaps === go.extraLaps, '귀빈이 마지막으로 돌고 매출이 자금에 들어온다');
  const noWreath = engine.runDwarf({ ...gq.state.st, grow: growB }, { ...engine.guest('pilgrim'), guest: true }, { first: true });
  check(same(go.grow, engine.runDwarf({ ...gq.state.st, grow: growB }, { ...engine.guest('pilgrim'), guest: true }, { first: false }).grow) && !same(go.grow, noWreath.grow), '귀빈은 웨이브의 첫 드워프로 쳐지지 않는다(개업 화환)');
  const rw = gq.state.judge.reward;
  check(rw && rw.count === Math.min(3, go.extraLaps) && rw.offer.length === rw.count && rw.offer.every(id => !gq.state.st.tiles.includes(id)) && new Set(rw.offer).size === rw.offer.length, `보상 후보의 수는 추가 바퀴 수(셋까지)이고 보드에 있는 특수 칸은 나오지 않는다 (추가 바퀴 ${go.extraLaps}, 후보 ${rw && rw.offer.length})`);
  gq.proceed(); check(gq.state.phase === 'reward', '보상을 고를 차례');
  const n0 = gq.state.st.board.length, sp = rw.offer[0], bBefore = gq.state.st.board.slice();
  check(!gq.chooseReward(sp, 0) && gq.state.phase === 'reward' && !gq.chooseReward('nope', 2), '0번 칸의 앞에는 넣을 수 없다');
  check(same(gq.previewReward(sp, 2).board, [...bBefore.slice(0, 2), null, ...bBefore.slice(2)]), '끼워 넣으면 그 뒤의 칸과 건물이 한 칸씩 밀린다(미리 보기)');
  check(gq.chooseReward(sp, 2) && gq.state.phase === 'prep' && gq.state.wave === 3 && gq.state.st.tiles[2] === sp && gq.state.st.board[2] === null && gq.state.st.board.length === n0 + 2, '고른 특수 칸이 빈 칸으로 들어가고 다음 정비가 시작된다(새 칸도 하나)');
  check(gq.state.st.board[3] === bBefore[2] && gq.state.uid[3] > 0, '밀린 건물은 건물의 표도 함께 밀린다');
  // 추가 바퀴가 0이면 보상이 없다. 스위치를 켜면 늘 셋
  const z = createGame(data, { seed: 'zero', guestPicks: ['gourmet', null, null] }); z.begin(); nextPrep(z); nextPrep(z); rich(z); runWaveQuick(z);
  check(z.state.guestRun.extraLaps === 0 && z.state.judge.reward.offer.length === 0, '추가 바퀴를 못 돌면 보상이 없다'); z.proceed(); check(z.state.phase === 'prep' && z.state.wave === 3, '보상 없이 다음 정비로');
  const a3 = createGame(data, { seed: 'zero', guestPicks: ['gourmet', null, null], alwaysThree: true }); a3.begin(); nextPrep(a3); nextPrep(a3); rich(a3); runWaveQuick(a3);
  check(a3.state.judge.reward.offer.length === 3, '스위치: 보상 후보를 늘 셋');
  // 열째 웨이브: 귀빈은 돌지만 보상이 없다. 통과하면 클리어
  const t = createGame(data, { seed: 'ten' }); t.begin(); for (let k = 1; k < 10; k++) nextPrep(t);
  place(t, 0, 'swimming_pool'); place(t, 1, 'conglomerate_tower'); place(t, 2, 'pub'); rich(t); runWaveQuick(t);
  check(t.state.wave === 9 && t.state.guestRun && t.state.judge.cleared && !t.state.judge.reward && t.state.judge.events.length === 0, '열째 웨이브: 귀빈이 돌고, 보상도 대기업 사옥도 없다');
  t.proceed(); check(t.state.phase === 'over' && t.state.outcome === 'clear' && t.state.results.length === 10, '열째 웨이브를 통과하면 클리어');
  check(t.state.results.filter(r => r.guest).length === 3 && same(t.state.results.map((r, i) => (r.guest ? i + 1 : 0)).filter(Boolean), [3, 6, 10]), '귀빈은 3, 6, 10웨이브에 온다');
  done();
}

// ── 4. 무작위로 누르는 봇으로 런을 끝까지 ────────────────────
{
  const done = section('무작위 봇 60런');
  const play = (seed, record, richRun, opts = {}, d = data) => {
    const g = createGame(d, { seed, ...opts }), s = g.state, bot = makeRng('bot' + seed), shop = id => !!g.engine.shop(id);
    let guard = 0;
    g.begin();
    while (s.phase !== 'over' && guard++ < 3000) {
      if (richRun) s.st.money = Math.max(s.st.money, 1e9);
      const N = s.st.board.length;
      if (s.phase === 'prep') {
        check(s.candidates.length === 5 && s.candidates.every(x => x) && s.picksLeft === 2 && s.refreshPresses === 0 && s.hand.length <= (s.wave === 0 ? 4 : 2), `씨앗 ${seed}: 정비 시작`);
        if (bot.rand() < 0.4) g.refresh();
        for (let k = 0; k < 4; k++) g.pick(bot.int(5));
        check(s.hand.length <= 6, '손패는 많아야 6장');
        for (let k = 0; k < 12 && s.hand.length; k++) { const h = bot.int(s.hand.length); if (bot.rand() < 0.35) g.playCard(h, { gap: bot.int(N) }); else g.playCard(h, { tile: bot.int(N) }); }
        if (bot.rand() < 0.3) g.demolish(bot.int(N));
        g.swap(bot.int(N), bot.int(N)); g.insertFrom(bot.int(N), bot.int(N));
        while (s.hand.length > 2) g.discard(bot.int(s.hand.length));
        const sup = s.st.board.filter(b => b && !shop(b));
        check(new Set(sup).size === sup.length && s.st.stars.every(v => v >= 0 && v <= 3), `씨앗 ${seed}: 같은 지원 건물은 한 채, ★은 셋까지`);
        check(s.st.board.every((b, i) => (b === null) === (s.uid[i] === 0)) && new Set(s.uid.filter(Boolean)).size === s.uid.filter(Boolean).length, `씨앗 ${seed}: 건물의 표가 건물과 맞는다`);
        check(s.st.board.every((b, i) => (b && shop(b)) || (s.st.stars[i] === 0 && s.st.grow[i] === 0)), `씨앗 ${seed}: ★과 키운 배율은 매장에만 있다`);
        record.push(s.st.board.slice(), s.st.stars.slice(), s.candidates.map(x => x.id), s.hand.slice(), s.st.money);
        g.startWave();
      } else if (s.phase === 'pick') {
        check(s.hand3.length === 3 && !g.pick(0) && !g.refresh() && !g.playCard(0, { tile: 0 }).ok, `씨앗 ${seed}: 웨이브에서는 고르기, 새로고침, 카드 쓰기를 못 한다`);
        if (bot.rand() < 0.2) g.swap(bot.int(N), bot.int(N));
        const i = bot.int(3), m = s.st.money, pv = g.previewSend(i), r = g.send(i);
        check(r.sales === pv.sales && s.st.money === m + r.sales, `씨앗 ${seed}: 보내기`);
        record.push(r.dwarf.name, r.sales);
      } else if (s.phase === 'guest') { const r = g.runGuest(); record.push(r.dwarf.name, r.sales); }
      else if (s.phase === 'judge') { check(s.judge.passed === (s.judge.money >= s.judge.target), '판정'); g.proceed(); }
      else if (s.phase === 'reward') { const of = s.judge.reward.offer; check(g.chooseReward(of[bot.int(of.length)], 1 + bot.int(N)), '보상을 끼워 넣는다'); }
    }
    check(s.phase === 'over' && s.st.money >= 0, `씨앗 ${seed}: 런이 끝났다`);
    return s;
  };
  for (let n = 0; n < 30; n++) { const a = [], b = []; play('R' + n, a, false); play('R' + n, b, false); check(same(a, b), `씨앗 R${n}: 같은 씨앗, 같은 조작인데 판이 다르다`); }
  let clears = 0, maxTiles = 0; const built = new Set(), gotSp = new Set();
  for (let n = 0; n < 30; n++) {
    const s = play('Rich' + n, [], true, { alwaysThree: true });
    if (s.outcome === 'clear') { clears++; check(s.results.length === 10 && s.st.board.length === 17 + s.st.tiles.filter(t => t).length - 1, '웨이브 열, 17칸 + 끼워 넣은 특수 칸'); }
    maxTiles = Math.max(maxTiles, s.st.board.length); s.log.forEach(l => l.used.forEach(x => built.add(x.split(' ').slice(1).join(' ').replace(/\(.*/, '')))); s.st.tiles.forEach(t => t && gotSp.add(t));
  }
  check(clears === 30 && maxTiles === 19, `자금이 넉넉하면 웨이브 10까지 끝나고 보드는 19칸까지 자란다 (클리어 ${clears}/30, 가장 큰 보드 ${maxTiles}칸)`);
  check(data.supports.every(x => built.has(x.name)) && gotSp.size === 8, `지원 건물 20채를 모두 써 봤고 특수 칸 8가지가 모두 나왔다 (${data.supports.filter(x => built.has(x.name)).length}채, ${gotSp.size}가지)`);
  done();

  const done2 = section('건물, 특수 칸, 귀빈을 데이터에서 지우고 돌리기');
  for (const gone of data.supports.map(x => x.id)) {
    const d2 = { ...data, supports: data.supports.filter(x => x.id !== gone) }; let ok = true;
    try { const s = play('Del' + gone, [], true, {}, d2); ok = s.outcome === 'clear' && !s.st.board.includes(gone) && !s.log.some(l => l.offered.includes(gone)); } catch (err) { ok = false; console.log('   ', gone, err.message); }
    check(ok, `${gone}을(를) 지우면 그 건물 없이 끝까지 돈다`);
  }
  for (const [key, id] of [['shops', 'park'], ['shops', 'pub'], ['specialTiles', 'rotary'], ['specialTiles', 'old_site'], ['guests', 'gourmet']]) {
    const d2 = { ...data, [key]: data[key].filter(x => x.id !== id) }; let ok = true;
    try { ok = play('DelX' + id, [], true, {}, d2).outcome === 'clear'; } catch (err) { ok = false; console.log('   ', id, err.message); }
    check(ok, `${key}의 ${id}을(를) 지워도 돈다`);
  }
  done2();
}

console.log(fail ? `\n실패 ${fail}건 (확인 ${checks}개)` : `\n모두 통과 (검증 사례 ${tc.cases.length}개 + 확인 ${checks}개)`);
process.exit(fail ? 1 : 0);
