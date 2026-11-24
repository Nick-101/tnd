// 욜로드워프 데모 2.0 참고 엔진 (2026-11-24)
// 규칙 문서 v3(욜로드워프_데모2_규칙.md)의 6~10절을 그대로 옮긴 계산이다. 화면, 난수, 정비의 흐름은 들어 있지 않다.
// 게임의 코드가 이 파일을 그대로 쓸 필요는 없다. 계산이 같은지를 검증 사례로 맞춰 보는 기준이다.
// 쓰는 법: node reference_engine2.mjs yolodwarf2_data.json yolodwarf2_testcases.json
import { readFileSync } from 'node:fs';

export function index(data) {
  const shops = new Map(data.shops.map(s => [s.id, s]));
  const supports = new Map(data.supports.map(s => [s.id, s]));
  return { data, shops, supports, c: data.constants };
}

// 웨이브를 시작할 때의 보드를 읽는다. board: 0번 칸(입구)부터의 건물 id 배열(빈 칸은 null), levels: 칸마다의 ★ 수.
export function prep(ix, board, levels) {
  const N = board.length;
  const shopAt = board.map(b => (b && ix.shops.get(b)) || null);
  const supAt = board.map(b => (b && ix.supports.get(b)) || null);
  const shopTiles = []; for (let i = 0; i < N; i++) if (shopAt[i]) shopTiles.push(i);
  const adj1 = i => [(i - 1 + N) % N, (i + 1) % N];
  const adj2 = i => [...new Set([(i - 2 + N) % N, (i - 1 + N) % N, (i + 1) % N, (i + 2) % N])];
  // 발전소: 양옆 1칸의 지원 건물은 효과를 한 번 더 건다. 발전소 자신에게는 걸리지 않는다.
  const times = board.map((b, i) => {
    if (!supAt[i] || supAt[i].effect.type === 'boost') return 1;
    return 1 + adj1(i).filter(j => supAt[j] && supAt[j].effect.type === 'boost').length;
  });
  const fee = board.map((b, i) => (shopAt[i] ? shopAt[i].fee : 0));
  const mult = board.map(() => 1), again = board.map(() => 0), growFee = board.map(() => 0);
  const growMult = board.map(() => []), restMult = board.map(() => 1);
  const hasKind = (i, k) => shopAt[i].kinds.includes(k);
  const matches = (i, target) => target === 'shops' ? true
    : target === 'oneKind' ? shopAt[i].kinds.length === 1
    : target === 'twoKind' ? shopAt[i].kinds.length === 2
    : hasKind(i, target);
  const tilesOf = (i, scope) => (scope === 'all' ? shopTiles : scope === 'adj1' ? adj1(i) : scope === 'adj2' ? adj2(i) : scope === 'prev' ? [(i - 1 + N) % N] : [])
    .filter(j => shopAt[j]);
  const stars = shopTiles.reduce((a, j) => a + levels[j], 0);
  // 1) 요금을 더하는 것부터. "요금이 가장 높은 매장"은 요금을 모두 더한 뒤에 정한다.
  for (let i = 0; i < N; i++) {
    const s = supAt[i]; if (!s) continue; const e = s.effect, m = times[i];
    const hit = () => tilesOf(i, e.scope).filter(j => matches(j, e.target));
    if (e.type === 'fee') for (const j of hit()) fee[j] += e.amount * m;
    else if (e.type === 'feePerBoardStar') for (const j of hit()) fee[j] += e.amount * stars * m;
    else if (e.type === 'feePerOwnStar') for (const j of hit()) fee[j] += e.amount * levels[j] * m;
    else if (e.type === 'feePerShop') for (const j of hit()) fee[j] += e.amount * shopTiles.length * m;
  }
  // 같으면 입구에서 먼저 나오는 칸
  const best = (tiles, keys) => tiles.reduce((a, j) => {
    if (a === null) return j;
    for (const k of keys) { if (k(j) > k(a)) return j; if (k(j) < k(a)) return a; }
    return a;
  }, null);
  const top = best(shopTiles, [j => fee[j]]);
  // 2) 곱, 한 번 더, 성장, 휴식
  const kindCount = new Set(shopTiles.flatMap(j => shopAt[j].kinds)).size;
  for (let i = 0; i < N; i++) {
    const s = supAt[i]; if (!s) continue; const e = s.effect, m = times[i];
    const hit = () => tilesOf(i, e.scope).filter(j => matches(j, e.target));
    if (e.type === 'mult') {
      let tiles;
      if (e.scope === 'top') { const t = best(shopTiles.filter(j => matches(j, e.target)), [j => fee[j]]); tiles = t === null ? [] : [t]; }
      else if (e.scope === 'mostStars') { const t = best(shopTiles.filter(j => levels[j] > 0), [j => levels[j], j => fee[j]]); tiles = t === null ? [] : [t]; }
      else if (e.scope === 'duplicates') tiles = shopTiles.filter(j => shopTiles.filter(q => board[q] === board[j]).length >= 2);
      else tiles = hit();
      if (e.condition && e.condition.kindsAtLeast && kindCount < e.condition.kindsAtLeast) tiles = [];
      for (const j of tiles) mult[j] *= Math.pow(e.amount, m);
    } else if (e.type === 'again') for (const j of hit()) again[j] += e.amount * m;
    else if (e.type === 'growFee') for (const j of hit()) growFee[j] += e.amount * m;
    else if (e.type === 'growMult') {
      const tiles = e.scope === 'top' ? (top === null ? [] : [top]) : hit();
      for (const j of tiles) growMult[j].push(e.amount * m);   // 건물마다 자기 배율을 따로 갖는다
    } else if (e.type === 'restMult') for (const j of hit()) restMult[j] *= Math.pow(e.amount, m);
  }
  for (const j of shopTiles) mult[j] *= Math.pow(ix.c.upgrade.salesMultPerStar, levels[j]);   // ★ 하나마다 ×2
  const branchTimes = board.map((b, i) => (supAt[i] && supAt[i].effect.type === 'branch' ? times[i] : 0));
  return { N, board, shopAt, shopTiles, fee, mult, again, growFee, growMult, restMult, top, branchTimes };
}

// 드워프 한 마리를 보낸다. g0: 이 웨이브에서 지금까지 돈 추가 바퀴 수(성장 지원이 자란 횟수). sales: 칸마다의 매출을 더해 갈 배열.
export function runDwarf(ix, info, dwarf, g0 = 0, sales = null) {
  const c = ix.c, trait = dwarf.trait ? ix.data.traits.find(t => t.id === dwarf.trait).effect : {};
  const start = trait.lapStart || {};
  const baseLaps = trait.baseLaps || c.baseLaps;
  const fresh = () => ({ h: (start.hunger || 0) - (start.fullness || 0), d: start.tipsy || 0, y: start.hype || 0, tired: 0 });   // h: 양수는 허기, 음수는 포만감
  const taste = info.board.map((b, i) => {
    const s = info.shopAt[i]; if (!s) return 0;
    const like = s.kinds.some(k => dwarf.likes.includes(k)), dis = s.kinds.includes(dwarf.dislike);
    return like && !dis ? c.satisfaction.like : dis && !like ? c.satisfaction.dislike : 0;
  });
  let st = fresh(), sat = 0, cost = c.extraLapCost.first, laps = 0, total = 0;
  const amount = (s, name) => name === 'hunger' ? Math.max(st.h, 0) : name === 'fullness' ? Math.max(-st.h, 0) : name === 'tipsy' ? st.d : st.y;
  // 이용 한 번. 지나치면 null.
  const use = (j, g) => {
    const s = info.shopAt[j];
    if (s.skip === 'drunk' && st.d >= c.thresholds.drunk) return null;
    if (s.skip === 'full' && -st.h >= c.thresholds.full) return null;
    let add = 0; for (const r of s.read) add += r.per * amount(s, r.stack);
    let m = info.mult[j]; for (const x of info.growMult[j]) m *= 1 + x * g;
    if (s.threshold && amount(s, s.threshold.stack) >= s.threshold.at) m *= s.threshold.mult;
    const pay = Math.floor((info.fee[j] + info.growFee[j] * g + add) * m);
    for (const r of s.read) if (r.consume) { if (r.stack === 'fullness') { if (st.h < 0) st.h = 0; } else if (r.stack === 'tipsy') st.d = 0; else if (r.stack === 'hype') st.y = 0; }
    st.h += s.give.hunger - s.give.fullness; st.d += s.give.tipsy; st.y += s.give.hype;
    return pay;
  };
  const regular = j => { const r = info.shopAt[j].regular; if (r && taste[j] === 1) { if (r.stack === 'hunger') st.h += r.extra; else if (r.stack === 'tipsy') st.d += r.extra; else st.y += r.extra; } };
  const isRest = j => info.shopAt[j].kinds.includes('휴식');
  for (;;) {
    const g = g0 + Math.max(0, laps - baseLaps + 1);   // 추가 바퀴에 들어설 때마다 한 번 자란다
    for (let i = 0; i < info.N; i++) {
      if (info.shopAt[i]) {
        for (let u = 0; u <= info.again[i]; u++) {
          const pay = use(i, g); if (pay === null) break;
          total += pay; if (sales) sales[i] += pay;
          regular(i);
          if (isRest(i)) {
            if (u === 0) {   // 피로를 만족도로 바꾸는 것은 처음 이용할 때 한 번만
              const r = info.shopAt[i].rest; let gain;
              if (r.mode === 'consumePer') { gain = Math.floor(st.tired / r.per); st.tired = 0; }
              else if (r.mode === 'per') gain = Math.floor(st.tired / r.per);
              else gain = st.tired >= r.at ? r.gain : 0;
              if (gain > 0) sat += gain * info.restMult[i];
            }
          } else st.tired += c.fatiguePerUse;
          sat += taste[i];
        }
      } else if (info.branchTimes[i] > 0 && info.top !== null) {   // 2호점: 요금이 가장 높은 매장을 이 칸에서 이용한다
        const j = info.top;
        for (let u = 0; u < info.branchTimes[i]; u++) {
          const pay = use(j, g); if (pay === null) break;
          total += pay; if (sales) sales[j] += pay;
          if (!isRest(j)) st.tired += c.fatiguePerUse;
          regular(j);
        }
      }
    }
    laps += 1; st = fresh();
    if (laps >= baseLaps) { if (sat >= cost) { sat -= cost; cost *= c.extraLapCost.multiplier; } else break; }
  }
  return { sales: total, laps, extraLaps: laps - baseLaps };
}

// 웨이브 하나: 보낸 순서대로 드워프를 돌린다. 성장 지원이 자란 것은 다음 드워프에게 이어진다.
export function runWave(ix, board, levels, wave) {
  const info = prep(ix, board, levels); const sales = board.map(() => 0); let g = 0; const perDwarf = [];
  for (const d of wave) { const r = runDwarf(ix, info, d, g, sales); perDwarf.push(r); g += r.extraLaps; }
  return { perDwarf, waveSales: perDwarf.reduce((a, r) => a + r.sales, 0), salesByTile: sales, topTile: info.top,
    feeByTile: board.map((b, i) => (info.shopAt[i] ? info.fee[i] : null)), multByTile: board.map((b, i) => (info.shopAt[i] ? info.mult[i] : null)) };
}

// 업그레이드 비용: 그 매장이 지난 웨이브에 올린 매출의 두 배, 최소 10.
export function upgradeCost(ix, lastWaveSales) { return Math.max(ix.c.upgrade.minCost, Math.floor(lastWaveSales * ix.c.upgrade.costFactor)); }
// 새로고침 비용: 그 스테이지의 처음 값에서 시작해 누를 때마다 두 배. presses: 이 스테이지에서 지금까지 누른 횟수.
export function refreshCost(ix, stage, presses) { return ix.data.stages[stage - 1].refreshBase * Math.pow(ix.c.refresh.multiplierPerPress, presses); }

if (process.argv[1] && process.argv[1].endsWith('reference_engine2.mjs') && process.argv.length >= 4) {
  const ix = index(JSON.parse(readFileSync(process.argv[2], 'utf8'))); const tc = JSON.parse(readFileSync(process.argv[3], 'utf8'));
  let pass = 0; const bad = [];
  for (const c of tc.cases) {
    const got = runWave(ix, c.board, c.levels, c.wave);
    const same = JSON.stringify(got) === JSON.stringify(c.expected);
    if (same) pass++; else bad.push({ id: c.id, group: c.group, note: c.note, got, expected: c.expected });
  }
  console.log(`통과 ${pass} / ${tc.cases.length}`);
  for (const b of bad.slice(0, 6)) {
    const keys = Object.keys(b.expected).filter(k => JSON.stringify(b.got[k]) !== JSON.stringify(b.expected[k]));
    console.log(b.id, b.group, b.note, '다른 곳:', keys.join(', '));
    for (const k of keys.slice(0, 2)) console.log('   ', k, '\n      엔진  ', JSON.stringify(b.got[k]), '\n      기대값', JSON.stringify(b.expected[k]));
  }
  if (bad.length) { console.log('다른 사례의 묶음', JSON.stringify(bad.reduce((a, b) => (a[b.group] = (a[b.group] || 0) + 1, a), {}))); process.exit(1); }
}
