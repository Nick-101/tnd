// 욜로드워프 시제품 1차 참고 엔진 (2026-11-25)
// 데모 2.0의 참고 엔진(reference_engine2.mjs)에 시제품 지원 건물의 계산을 더한 것이다.
// 기준은 욜로드워프_시제품1_제작요청서.md의 3절(규칙)과 4절(건물마다의 동작)이다. 화면, 난수, 후보 뽑기는 들어 있지 않다.
// 쓰는 법: node reference_engine_proto1.mjs yolodwarf_proto1_data.json yolodwarf_proto1_testcases.json
import { readFileSync } from 'node:fs';

export function index(data) {
  const shops = new Map(data.shops.map(s => [s.id, s]));
  const supports = new Map(data.supports.map(s => [s.id, s]));
  return { data, shops, supports, c: data.constants };
}

// 웨이브를 시작할 때의 보드를 읽는다.
// st: { board: 0번 칸(입구)부터의 건물 id(빈 칸은 null), levels: 칸마다의 ★ 수, trend: 이번 웨이브의 유행 업종(없으면 null) }
export function prep(ix, st) {
  const { board, levels } = st; const N = board.length; const c = ix.c;
  const shopAt = board.map(b => (b && ix.shops.get(b)) || null);
  const supAt = board.map(b => (b && ix.supports.get(b)) || null);
  const typeAt = board.map((b, i) => (supAt[i] ? supAt[i].effect.type : null));
  const shopTiles = []; for (let i = 0; i < N; i++) if (shopAt[i]) shopTiles.push(i);
  const adj1 = i => [(i - 1 + N) % N, (i + 1) % N];
  const adj2 = i => [...new Set([(i - 2 + N) % N, (i - 1 + N) % N, (i + 1) % N, (i + 2) % N])];
  const prev = i => (i - 1 + N) % N;

  // 0) 업종. 구름다리: 양옆 1칸이 모두 매장이면 두 매장은 서로의 업종도 갖는다(매장이 본래 가진 업종만 건넨다).
  const kindsAt = board.map((b, i) => (shopAt[i] ? [...shopAt[i].kinds] : null));
  for (let i = 0; i < N; i++) if (typeAt[i] === 'shareKinds') {
    const [a, b] = adj1(i);
    if (shopAt[a] && shopAt[b]) {
      for (const k of shopAt[b].kinds) if (!kindsAt[a].includes(k)) kindsAt[a].push(k);
      for (const k of shopAt[a].kinds) if (!kindsAt[b].includes(k)) kindsAt[b].push(k);
    }
  }
  const matches = (j, target) => target === 'shops' ? true : kindsAt[j].includes(target);
  const tilesOf = (i, scope) => (scope === 'all' ? shopTiles : scope === 'adj1' ? adj1(i) : scope === 'adj2' ? adj2(i) : scope === 'prev' ? [prev(i)] : [])
    .filter(j => shopAt[j]);
  const empty = board.filter(b => b === null).length;

  // 1) 요금을 더하는 것부터. "요금이 가장 높은 매장"은 요금을 모두 더한 뒤에 정한다.
  const fee = board.map((b, i) => (shopAt[i] ? shopAt[i].fee : 0));
  for (let i = 0; i < N; i++) {
    const s = supAt[i]; if (!s) continue; const e = s.effect;
    if (e.type === 'fee') for (const j of tilesOf(i, e.scope).filter(j => matches(j, e.target))) fee[j] += e.amount;
    else if (e.type === 'smelter') for (const j of shopTiles) fee[j] += e.feeAll;
    else if (e.type === 'feePerEmpty') for (const j of shopTiles) fee[j] += e.amount * empty;
  }
  const best = (tiles, keys) => tiles.reduce((a, j) => {
    if (a === null) return j;
    for (const k of keys) { if (k(j) > k(a)) return j; if (k(j) < k(a)) return a; }
    return a;   // 같으면 입구에서 먼저 나오는 칸
  }, null);
  const top = best(shopTiles, [j => fee[j]]);

  // 2) 곱, 주는 스택, 손님을 가리는 것, 성장, 휴식
  const mult = board.map(() => 1), again = board.map(() => 0), growFee = board.map(() => 0), restMult = board.map(() => 1);
  const giveBonus = board.map(() => 0), vip = board.map(() => false);
  for (let i = 0; i < N; i++) {
    const s = supAt[i]; if (!s) continue; const e = s.effect;
    const hit = () => tilesOf(i, e.scope).filter(j => matches(j, e.target));
    if (e.type === 'mult') {
      const tiles = e.scope === 'duplicates' ? shopTiles.filter(j => shopTiles.filter(q => board[q] === board[j]).length >= 2) : hit();
      for (const j of tiles) mult[j] *= e.amount;
    } else if (e.type === 'growFee') for (const j of hit()) growFee[j] += e.amount;
    else if (e.type === 'restMult') for (const j of hit()) restMult[j] *= e.amount;
    else if (e.type === 'campus') for (const j of tilesOf(i, 'adj1')) { mult[j] *= e.mult; giveBonus[j] += e.giveBonus; }
    else if (e.type === 'smelter') for (const j of tilesOf(i, 'adj1')) mult[j] *= e.multAdj;
    else if (e.type === 'popup') for (const j of tilesOf(i, 'adj1')) mult[j] *= e.mult;
    else if (e.type === 'vip') for (const j of tilesOf(i, 'adj1')) { mult[j] *= e.mult; vip[j] = true; }
    else if (e.type === 'original') {   // 이전 칸의 매장. 그 매장의 업종을 가진 매장이 보드에 또 있으면 효과가 없다
      const j = prev(i);
      if (shopAt[j] && !shopTiles.some(q => q !== j && kindsAt[q].some(k => kindsAt[j].includes(k)))) mult[j] *= e.mult;
    } else if (e.type === 'streak') {   // 같은 업종을 가진 매장이 e.min칸 이상 이어진 구간. 고리의 끝과 입구도 이어진다. 한 매장에는 한 번만 건다. 아치가 한 칸을 차지하므로 고리 전체가 한 구간이 되는 일은 없다
      const marked = new Set();
      for (const k of c.kinds) {
        const has = j => !!shopAt[j] && kindsAt[j].includes(k);
        for (let j = 0; j < N; j++) if (has(j) && !has(prev(j))) {
          const run = []; for (let q = j; has(q); q = (q + 1) % N) run.push(q);
          if (run.length >= e.min) run.forEach(q => marked.add(q));
        }
      }
      for (const j of marked) mult[j] *= e.mult;
    } else if (e.type === 'trend') { if (st.trend) for (const j of shopTiles) if (kindsAt[j].includes(st.trend)) mult[j] *= e.mult; }
  }
  for (const j of shopTiles) mult[j] *= Math.pow(c.upgrade.salesMultPerStar, levels[j]);   // ★ 하나마다 ×2

  // 3) 드워프가 지나갈 때 일하는 것과 보드 어디에 있든 일하는 것
  const passAt = board.map((b, i) => (typeAt[i] === 'pass' ? supAt[i].effect : null));
  const branchAt = board.map((b, i) => typeAt[i] === 'branch');
  const roundabout = typeAt.indexOf('roundabout');
  const roundaboutTiles = roundabout >= 0 ? supAt[roundabout].effect.tiles : 0;
  const keep = supAt.filter(s => s && s.effect.type === 'keepStack').map(s => s.effect.stack);
  const tipSup = supAt.find(s => s && s.effect.type === 'tip'); const tipDivisor = tipSup ? tipSup.effect.divisor : 0;
  const ev = typeAt.indexOf('everyNth');
  const eventTile = ev >= 0 && shopAt[prev(ev)] ? prev(ev) : null; const eventEffect = ev >= 0 ? supAt[ev].effect : null;
  // 거리 표지판: 휴식을 뺀 업종 가운데 그 업종을 가진 매장이 가장 많은 업종. 같으면 그 업종의 첫 매장이 입구에 가까운 쪽, 그것도 같으면 업종의 정해진 순서
  let likeAll = null;
  if (typeAt.includes('likeMost')) {
    let bestCount = 0, bestFirst = N;
    for (const k of c.kinds) {
      if (k === '휴식') continue;
      const tiles = shopTiles.filter(j => kindsAt[j].includes(k)); if (!tiles.length) continue;
      if (tiles.length > bestCount || (tiles.length === bestCount && tiles[0] < bestFirst)) { likeAll = k; bestCount = tiles.length; bestFirst = tiles[0]; }
    }
  }
  return { N, board, shopAt, shopTiles, kindsAt, fee, mult, again, growFee, restMult, giveBonus, vip, top, passAt, branchAt,
    roundabout, roundaboutTiles, keep, tipDivisor, eventTile, eventEffect, likeAll };
}

// 드워프 한 마리를 보낸다. g0: 이 웨이브에서 지금까지 돈 추가 바퀴 수. sales: 칸마다의 매출을 더해 갈 배열. ctx.eventCount: 이벤트 부스가 센 이용 수(건물에 남는다).
export function runDwarf(ix, info, dwarf, g0 = 0, sales = null, ctx = { eventCount: 0 }) {
  const c = ix.c, trait = dwarf.trait ? ix.data.traits.find(t => t.id === dwarf.trait).effect : {};
  const start = trait.lapStart || {};
  const baseLaps = trait.baseLaps || c.baseLaps;
  const fresh = () => ({ h: (start.hunger || 0) - (start.fullness || 0), d: start.tipsy || 0, y: start.hype || 0, tired: 0 });   // h: 양수는 허기, 음수는 포만감
  const likes = info.likeAll && !dwarf.likes.includes(info.likeAll) ? [...dwarf.likes, info.likeAll] : dwarf.likes;
  const likeAt = info.board.map((b, i) => !!info.shopAt[i] && info.kindsAt[i].some(k => likes.includes(k)));
  const taste = info.board.map((b, i) => {
    if (!info.shopAt[i]) return 0;
    const like = likeAt[i], dis = info.kindsAt[i].includes(dwarf.dislike);
    return like && !dis ? c.satisfaction.like : dis && !like ? c.satisfaction.dislike : 0;
  });
  let st = fresh(), sat = 0, cost = c.extraLapCost.first, laps = 0, total = 0;
  const amount = name => name === 'hunger' ? Math.max(st.h, 0) : name === 'fullness' ? Math.max(-st.h, 0) : name === 'tipsy' ? st.d : st.y;
  // 이용 한 번. 지나치면 null.
  const use = (j, g) => {
    const s = info.shopAt[j];
    if (s.skip === 'drunk' && st.d >= c.thresholds.drunk) return null;
    if (s.skip === 'full' && -st.h >= c.thresholds.full) return null;
    if (info.vip[j] && !likeAt[j]) return null;   // VIP 라운지: 그 업종을 좋아하지 않는 드워프는 지나친다
    let add = 0; for (const r of s.read) add += r.per * amount(r.stack);
    let m = info.mult[j];
    if (s.threshold && amount(s.threshold.stack) >= s.threshold.at) m *= s.threshold.mult;
    if (j === info.eventTile) { ctx.eventCount += 1; if (ctx.eventCount % info.eventEffect.every === 0) m *= info.eventEffect.mult; }
    const pay = Math.floor((info.fee[j] + info.growFee[j] * g + add) * m);
    for (const r of s.read) if (r.consume) { if (r.stack === 'fullness') { if (st.h < 0) st.h = 0; } else if (r.stack === 'tipsy') st.d = 0; else if (r.stack === 'hype') st.y = 0; }
    const b = info.giveBonus[j], gv = s.give, plus = x => (x > 0 ? x + b : 0);   // 대학교: 그 매장이 주는 스택마다 더 준다
    st.h += plus(gv.hunger) - plus(gv.fullness); st.d += plus(gv.tipsy); st.y += plus(gv.hype);
    return pay;
  };
  const isRest = j => info.shopAt[j].kinds.includes('휴식');   // 휴식의 일은 매장이 본래 가진 업종으로만 본다
  // 칸 하나를 지난다
  const visit = (i, g) => {
    if (info.shopAt[i]) {
      for (let u = 0; u <= info.again[i]; u++) {
        const pay = use(i, g); if (pay === null) break;
        total += pay; if (sales) sales[i] += pay;
        if (isRest(i)) {
          if (u === 0) {
            const r = info.shopAt[i].rest; let gain;
            if (r.mode === 'consumePer') { gain = Math.floor(st.tired / r.per); st.tired = 0; }
            else if (r.mode === 'per') gain = Math.floor(st.tired / r.per);
            else gain = st.tired >= r.at ? r.gain : 0;
            if (gain > 0) sat += gain * info.restMult[i];
          }
        } else st.tired += c.fatiguePerUse;
        sat += taste[i];
      }
    } else if (info.branchAt[i]) {   // 2호점: 요금이 가장 높은 매장을 이 칸에서 이용한다. 만족도는 바뀌지 않는다
      if (info.top !== null) {
        const j = info.top; const pay = use(j, g);
        if (pay !== null) { total += pay; if (sales) sales[j] += pay; if (!isRest(j)) st.tired += c.fatiguePerUse; }
      }
    } else if (info.passAt[i]) {   // 산책로, 언덕길, 버스킹 존
      const e = info.passAt[i];
      for (const k of e.consume || []) { if (k === 'fullness') { if (st.h < 0) st.h = 0; } else if (k === 'tipsy') st.d = 0; else if (k === 'hype') st.y = 0; }
      if (e.convert) { const v = amount(e.convert.from); if (e.convert.from === 'tipsy') st.d = 0; if (e.convert.to === 'hype') st.y += v; }
      if (e.give) { st.h += (e.give.hunger || 0) - (e.give.fullness || 0); st.d += e.give.tipsy || 0; st.y += e.give.hype || 0; st.tired += e.give.fatigue || 0; }
    }
  };
  for (;;) {
    const g = g0 + Math.max(0, laps - baseLaps + 1);   // 추가 바퀴에 들어설 때마다 한 번 자란다
    for (let i = 0; i < info.N; i++) {
      // 회전교차로: 이 칸에 오면 이전 칸들을 한 번 더 지난다. 입구 앞으로는 넘어가지 않는다
      if (i === info.roundabout) for (let k = Math.max(0, i - info.roundaboutTiles); k < i; k++) visit(k, g);
      else visit(i, g);
    }
    laps += 1;
    const kept = st; st = fresh();
    if (info.keep.includes('hype')) st.y += kept.y;   // 전광판: 흥은 바퀴를 넘어 남는다
    if (laps >= baseLaps) { if (sat >= cost) { sat -= cost; cost *= c.extraLapCost.multiplier; } else break; }
  }
  const tip = info.tipDivisor && sat > 0 ? Math.floor(total * sat / info.tipDivisor) : 0;   // 팁 상자
  return { sales: total, laps, extraLaps: laps - baseLaps, tip };
}

// 웨이브 하나: 보낸 순서대로 드워프를 돌린다. 성장 지원이 자란 것과 이벤트 부스의 세기는 다음 드워프에게 이어진다.
export function runWave(ix, st, wave) {
  const info = prep(ix, st); const sales = st.board.map(() => 0); let g = 0; const perDwarf = []; const ctx = { eventCount: st.eventCount || 0 };
  for (const d of wave) { const r = runDwarf(ix, info, d, g, sales, ctx); perDwarf.push(r); g += r.extraLaps; }
  return { perDwarf, waveSales: perDwarf.reduce((a, r) => a + r.sales, 0), tips: perDwarf.reduce((a, r) => a + r.tip, 0), salesByTile: sales,
    topTile: info.top, feeByTile: st.board.map((b, i) => (info.shopAt[i] ? info.fee[i] : null)), multByTile: st.board.map((b, i) => (info.shopAt[i] ? info.mult[i] : null)),
    kindsByTile: info.kindsAt, likeAll: info.likeAll, eventCount: ctx.eventCount };
}

// 웨이브가 끝났을 때(판정을 통과한 뒤) 보드에 일어나는 일. 순서: 대기업 사옥, 팝업 스토어, 공사 현장.
// s: { board, levels, timers: { popup_store, construction_site }, money }, salesByTile: 방금 끝난 웨이브에 칸마다 들어온 매출
export function endWave(ix, s, salesByTile) {
  const board = [...s.board], levels = [...s.levels], timers = { ...s.timers }, lastSales = [...salesByTile]; let money = s.money; const events = [];
  const N = board.length; const isShop = i => !!board[i] && ix.shops.has(board[i]);
  const hq = board.indexOf('conglomerate_tower');
  if (hq >= 0) {
    const a = (hq - 1 + N) % N, b = (hq + 1) % N;
    if (isShop(a) && isShop(b)) {
      // 매출이 높은 쪽이 남는다. 같으면 ★이 많은 쪽, 그것도 같으면 입구에서 먼저 나오는 쪽
      const lo = Math.min(a, b), hi = Math.max(a, b);
      const win = salesByTile[lo] !== salesByTile[hi] ? (salesByTile[lo] > salesByTile[hi] ? lo : hi) : levels[lo] !== levels[hi] ? (levels[lo] > levels[hi] ? lo : hi) : lo;
      const lose = win === lo ? hi : lo;
      if (levels[win] < ix.c.upgrade.maxStars) {   // 남는 쪽이 이미 ★★★이면 아무 일도 없다
        if (board.includes('demolition_company')) { money += salesByTile[lose]; events.push({ type: 'demolitionIncome', tile: lose, amount: salesByTile[lose] }); }
        events.push({ type: 'merger', demolished: lose, shop: board[lose], starTo: win });
        board[lose] = null; levels[lose] = 0; lastSales[lose] = 0; levels[win] += 1;
      }
    }
  }
  for (const [id, becomes] of [['popup_store', null], ['construction_site', 'landmark']]) {
    const i = board.indexOf(id); if (i < 0) continue;
    timers[id] -= 1;
    if (timers[id] <= 0) { board[i] = becomes; delete timers[id]; events.push({ type: becomes ? 'built' : 'gone', tile: i, id }); }
  }
  return { board, levels, timers, money, lastSales, events };
}

// 다음 정비를 시작할 때. 순서: 칸이 는다, 은행의 이자.
export function startPrep(ix, s, waveNo) {
  const board = [...s.board], levels = [...s.levels]; let money = s.money;
  while (board.length < ix.data.waves[waveNo - 1].tiles) { board.push(null); levels.push(0); }   // 새 칸은 고리의 끝(마지막 칸과 입구 사이)에 생긴다
  if (board.includes('bank')) money += Math.floor(money / ix.supports.get('bank').effect.divisor);
  return { ...s, board, levels, money };
}

// 업그레이드 비용: 그 매장이 지난 웨이브에 올린 매출의 두 배, 최소 10.
export function upgradeCost(ix, lastWaveSales) { return Math.max(ix.c.upgrade.minCost, Math.floor(lastWaveSales * ix.c.upgrade.costFactor)); }
// 새로고침 비용: 그 웨이브의 처음 값에서 시작해 누를 때마다 두 배. presses: 이번 정비에서 지금까지 누른 횟수.
export function refreshCost(ix, waveNo, presses) { return ix.data.waves[waveNo - 1].refreshBase * Math.pow(ix.c.refresh.multiplierPerPress, presses); }

if (process.argv[1] && process.argv[1].endsWith('reference_engine_proto1.mjs') && process.argv.length >= 4) {
  const ix = index(JSON.parse(readFileSync(process.argv[2], 'utf8'))); const tc = JSON.parse(readFileSync(process.argv[3], 'utf8'));
  let pass = 0; const bad = [];
  for (const c of tc.cases) {
    const got = c.kind === 'endWave' ? endWave(ix, c.state, c.salesByTile) : c.kind === 'startPrep' ? startPrep(ix, c.state, c.waveNo) : runWave(ix, c.state, c.wave);
    if (JSON.stringify(got) === JSON.stringify(c.expected)) pass++; else bad.push({ id: c.id, group: c.group, note: c.note, got, expected: c.expected });
  }
  console.log(`통과 ${pass} / ${tc.cases.length}`);
  for (const b of bad.slice(0, 6)) {
    const keys = Object.keys(b.expected).filter(k => JSON.stringify(b.got[k]) !== JSON.stringify(b.expected[k]));
    console.log(b.id, b.group, b.note, '다른 곳:', keys.join(', '));
    for (const k of keys.slice(0, 2)) console.log('   ', k, '\n      엔진  ', JSON.stringify(b.got[k]), '\n      기대값', JSON.stringify(b.expected[k]));
  }
  if (bad.length) { console.log('다른 사례의 묶음', JSON.stringify(bad.reduce((a, b) => (a[b.group] = (a[b.group] || 0) + 1, a), {}))); process.exit(1); }
}
