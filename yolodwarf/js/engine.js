// 욜로드워프 데모 2.0 계산 엔진. 규칙 문서 v3의 6~10절.
// 화면과 무관한 순수 계산이다. DOM도 난수도 쓰지 않는다. 숫자는 모두 데이터 파일에서 읽는다.
// prep(board, levels)   → 웨이브를 시작할 때의 보드를 읽는다 (요금, ×, 한 번 더, 성장, 요금이 가장 높은 매장)
// runDwarf(info, dwarf) → 드워프 한 마리의 매출과 "어느 칸에서 얼마가 왜 들어왔는지"의 기록
// runWave(...)          → 보낸 순서대로. 성장 지원이 자란 것이 다음 드워프에게 이어진다
// 계산은 docs/demo2/reference_engine2.mjs와 같다(검증 사례로 맞춘다). 여기에는 화면이 쓸 기록을 더했다.

export function makeEngine(data) {
  const c = data.constants;
  const shops = new Map(data.shops.map(s => [s.id, s]));
  const supports = new Map(data.supports.map(s => [s.id, s]));
  const traits = new Map(data.traits.map(t => [t.id, t]));
  const restKind = data.kinds.find(k => !data.tasteKinds.includes(k));

  // board: 0번 칸(입구)부터의 건물 id 배열(빈 칸은 null), levels: 칸마다의 ★ 수.
  function prep(board, levels) {
    const N = board.length;
    const shopAt = board.map(b => (b && shops.get(b)) || null);
    const supAt = board.map(b => (b && supports.get(b)) || null);
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
    // 화면용 기록: 칸마다 걸린 지원(sources), 지원마다 닿는 칸(targets). 계산에는 쓰지 않는다.
    const sources = board.map(() => []), targets = board.map(() => []);
    const note = (i, j, type, value) => { sources[j].push({ from: i, id: board[i], type, value, times: times[i] }); if (!targets[i].includes(j)) targets[i].push(j); };
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
      const add = (j, v) => { fee[j] += v; note(i, j, 'fee', v); };
      if (e.type === 'fee') for (const j of hit()) add(j, e.amount * m);
      else if (e.type === 'feePerBoardStar') for (const j of hit()) add(j, e.amount * stars * m);
      else if (e.type === 'feePerOwnStar') for (const j of hit()) add(j, e.amount * levels[j] * m);
      else if (e.type === 'feePerShop') for (const j of hit()) add(j, e.amount * shopTiles.length * m);
    }
    // 같으면 입구에서 먼저 나오는 칸
    const best = (tiles, keys) => tiles.reduce((a, j) => {
      if (a === null) return j;
      for (const k of keys) { if (k(j) > k(a)) return j; if (k(j) < k(a)) return a; }
      return a;
    }, null);
    const top = best(shopTiles, [j => fee[j]]);
    const mostStars = best(shopTiles.filter(j => levels[j] > 0), [j => levels[j], j => fee[j]]);
    // 2) 곱, 한 번 더, 성장, 휴식
    const kindCount = new Set(shopTiles.flatMap(j => shopAt[j].kinds)).size;
    for (let i = 0; i < N; i++) {
      const s = supAt[i]; if (!s) continue; const e = s.effect, m = times[i];
      const hit = () => tilesOf(i, e.scope).filter(j => matches(j, e.target));
      if (e.type === 'mult') {
        let tiles;
        if (e.scope === 'top') { const t = best(shopTiles.filter(j => matches(j, e.target)), [j => fee[j]]); tiles = t === null ? [] : [t]; }
        else if (e.scope === 'mostStars') tiles = mostStars === null ? [] : [mostStars];
        else if (e.scope === 'duplicates') tiles = shopTiles.filter(j => shopTiles.filter(q => board[q] === board[j]).length >= 2);
        else tiles = hit();
        if (e.condition && e.condition.kindsAtLeast && kindCount < e.condition.kindsAtLeast) tiles = [];
        for (const j of tiles) { mult[j] *= Math.pow(e.amount, m); note(i, j, 'mult', Math.pow(e.amount, m)); }
      } else if (e.type === 'again') for (const j of hit()) { again[j] += e.amount * m; note(i, j, 'again', e.amount * m); }
      else if (e.type === 'growFee') for (const j of hit()) { growFee[j] += e.amount * m; note(i, j, 'growFee', e.amount * m); }
      else if (e.type === 'growMult') {
        const tiles = e.scope === 'top' ? (top === null ? [] : [top]) : hit();
        for (const j of tiles) { growMult[j].push(e.amount * m); note(i, j, 'growMult', e.amount * m); }   // 건물마다 자기 배율을 따로 갖는다
      } else if (e.type === 'restMult') for (const j of hit()) { restMult[j] *= Math.pow(e.amount, m); note(i, j, 'restMult', Math.pow(e.amount, m)); }
      else if (e.type === 'branch') { if (top !== null) note(i, top, 'branch', m); }
      else if (e.type === 'boost') for (const j of adj1(i)) if (supAt[j] && supAt[j].effect.type !== 'boost') note(i, j, 'boost', 1);
    }
    const starMult = board.map((b, i) => (shopAt[i] ? Math.pow(c.upgrade.salesMultPerStar, levels[i]) : 1));
    for (const j of shopTiles) mult[j] *= starMult[j];   // ★ 하나마다 ×2
    const branchTimes = board.map((b, i) => (supAt[i] && supAt[i].effect.type === 'branch' ? times[i] : 0));
    return { N, board, levels, shopAt, supAt, shopTiles, times, fee, mult, starMult, again, growFee, growMult, restMult, top, mostStars, branchTimes, sources, targets, kindCount, stars };
  }

  // 그 바퀴의 요금과 ×. g: 이 웨이브에서 지금까지 성장 지원이 자란 횟수(추가 바퀴에 들어선 횟수).
  const feeAt = (info, j, g) => info.fee[j] + info.growFee[j] * g;
  const multAt = (info, j, g) => { let m = info.mult[j]; for (const x of info.growMult[j]) m *= 1 + x * g; return m; };

  const tasteOf = (shop, dwarf) => {
    if (!shop) return 0;
    const like = shop.kinds.some(k => dwarf.likes.includes(k)), dis = shop.kinds.includes(dwarf.dislike);
    return like && !dis ? c.satisfaction.like : dis && !like ? c.satisfaction.dislike : 0;
  };

  // 드워프 한 마리를 보낸다. dwarf: { likes, dislike, trait }. g0: 이 웨이브에서 지금까지 돈 추가 바퀴 수.
  // sales: 칸마다의 매출을 더해 갈 배열(2호점에서 올린 것은 본점의 칸에). options.events가 false면 기록을 남기지 않는다.
  function runDwarf(info, dwarf, g0 = 0, sales = null, options = {}) {
    const trait = dwarf.trait ? traits.get(dwarf.trait).effect : {};
    const start = trait.lapStart || {};
    const baseLaps = trait.baseLaps || c.baseLaps;
    const fresh = () => ({ h: (start.hunger || 0) - (start.fullness || 0), d: start.tipsy || 0, y: start.hype || 0, tired: 0 });   // h: 양수는 허기, 음수는 포만감
    const taste = info.board.map((b, i) => tasteOf(info.shopAt[i], dwarf));
    const log = options.events === false ? null : [];
    let st = fresh(), sat = 0, cost = c.extraLapCost.first, laps = 0, total = 0, bestPay = 0;
    const amount = name => name === 'hunger' ? Math.max(st.h, 0) : name === 'fullness' ? Math.max(-st.h, 0) : name === 'tipsy' ? st.d : st.y;
    const snap = () => ({ h: st.h, d: st.d, y: st.y, tired: st.tired, sat });
    // 이용 한 번. 지나치면 null. (규칙 7절의 순서 1~5)
    const use = (j, g, ev) => {
      const s = info.shopAt[j];
      if (s.skip === 'drunk' && st.d >= c.thresholds.drunk) { if (ev) ev.skip = 'drunk'; return null; }
      if (s.skip === 'full' && -st.h >= c.thresholds.full) { if (ev) ev.skip = 'full'; return null; }
      let add = 0; for (const r of s.read) add += r.per * amount(r.stack);
      let m = info.mult[j]; for (const x of info.growMult[j]) m *= 1 + x * g;
      const over = !!(s.threshold && amount(s.threshold.stack) >= s.threshold.at);
      if (ev) Object.assign(ev, { fee: info.fee[j] + info.growFee[j] * g, terms: s.read.map(r => ({ stack: r.stack, count: amount(r.stack), per: r.per })), add, baseMult: m, threshold: over ? s.threshold : null });
      if (over) m *= s.threshold.mult;
      const raw = (info.fee[j] + info.growFee[j] * g + add) * m;
      const pay = Math.floor(raw);
      if (ev) Object.assign(ev, { mult: m, raw, pay });
      for (const r of s.read) if (r.consume) { if (r.stack === 'fullness') { if (st.h < 0) st.h = 0; } else if (r.stack === 'tipsy') st.d = 0; else if (r.stack === 'hype') st.y = 0; }
      st.h += s.give.hunger - s.give.fullness; st.d += s.give.tipsy; st.y += s.give.hype;
      return pay;
    };
    const regular = j => { const r = info.shopAt[j].regular; if (r && taste[j] === 1) { if (r.stack === 'hunger') st.h += r.extra; else if (r.stack === 'tipsy') st.d += r.extra; else st.y += r.extra; return true; } return false; };
    const isRest = j => info.shopAt[j].kinds.includes(restKind);
    for (;;) {
      const g = g0 + Math.max(0, laps - baseLaps + 1);   // 추가 바퀴에 들어설 때마다 한 번 자란다
      const lap = laps + 1, lapStartTotal = total;
      if (log) log.push({ type: 'lapStart', lap, g, extra: laps >= baseLaps, extraNo: Math.max(0, laps - baseLaps + 1), stacks: snap(), sat, cost, baseLaps });
      for (let i = 0; i < info.N; i++) {
        if (info.shopAt[i]) {
          for (let u = 0; u <= info.again[i]; u++) {
            const ev = log ? { type: 'use', lap, tile: i, shopTile: i, via: u === 0 ? null : 'again', before: snap() } : null;
            const pay = use(i, g, ev);
            if (pay === null) { if (log) { ev.type = 'skip'; log.push(ev); } break; }
            total += pay; if (sales) sales[i] += pay; if (pay > bestPay) bestPay = pay;
            const wasRegular = regular(i);
            let restGain = 0, restFrom = null;
            if (isRest(i)) {
              if (u === 0) {   // 피로를 만족도로 바꾸는 것은 처음 이용할 때 한 번만
                const r = info.shopAt[i].rest; let gain;
                restFrom = st.tired;
                if (r.mode === 'consumePer') { gain = Math.floor(st.tired / r.per); st.tired = 0; }
                else if (r.mode === 'per') gain = Math.floor(st.tired / r.per);
                else gain = st.tired >= r.at ? r.gain : 0;
                if (gain > 0) { restGain = gain * info.restMult[i]; sat += restGain; }
              }
            } else st.tired += c.fatiguePerUse;
            sat += taste[i];
            if (log) { Object.assign(ev, { taste: taste[i], satChange: taste[i], restGain, restFrom, restMult: info.restMult[i], regular: wasRegular, after: snap(), total }); log.push(ev); }
          }
        } else if (info.branchTimes[i] > 0 && info.top !== null) {   // 2호점: 요금이 가장 높은 매장을 이 칸에서 이용한다
          const j = info.top;
          for (let u = 0; u < info.branchTimes[i]; u++) {
            const ev = log ? { type: 'use', lap, tile: i, shopTile: j, via: 'branch', before: snap() } : null;
            const pay = use(j, g, ev);
            if (pay === null) { if (log) { ev.type = 'skip'; log.push(ev); } break; }
            total += pay; if (sales) sales[j] += pay; if (pay > bestPay) bestPay = pay;
            if (!isRest(j)) st.tired += c.fatiguePerUse;
            const wasRegular = regular(j);
            if (log) { Object.assign(ev, { taste: 0, satChange: 0, restGain: 0, restFrom: null, regular: wasRegular, after: snap(), total }); log.push(ev); }
          }
        }
      }
      laps += 1;
      const end = log ? { type: 'lapEnd', lap, lapSales: total - lapStartTotal, total, stacksBefore: snap(), satBefore: sat } : null;
      st = fresh();
      let result = 'base';
      if (laps >= baseLaps) {
        if (sat >= cost) { sat -= cost; if (end) end.paid = cost; cost *= c.extraLapCost.multiplier; result = 'extra'; }
        else { result = 'leave'; if (end) end.needed = cost; }
      }
      if (end) { Object.assign(end, { result, sat, cost, gNext: g0 + Math.max(0, laps - baseLaps + 1) }); log.push(end); }
      if (result === 'leave') break;
    }
    return { sales: total, laps, extraLaps: laps - baseLaps, bestPay, events: log, g0, baseLaps };
  }

  // 웨이브 하나: 보낸 순서대로 드워프를 돌린다. 검증 사례와 같은 꼴을 돌려준다.
  function runWave(board, levels, wave) {
    const info = prep(board, levels); const sales = board.map(() => 0); let g = 0; const perDwarf = [];
    for (const d of wave) { const r = runDwarf(info, d, g, sales, { events: false }); perDwarf.push({ sales: r.sales, laps: r.laps, extraLaps: r.extraLaps }); g += r.extraLaps; }
    return { perDwarf, waveSales: perDwarf.reduce((a, r) => a + r.sales, 0), salesByTile: sales, topTile: info.top,
      feeByTile: board.map((b, i) => (info.shopAt[i] ? info.fee[i] : null)), multByTile: board.map((b, i) => (info.shopAt[i] ? info.mult[i] : null)) };
  }

  // 업그레이드 비용: 그 매장이 지난 웨이브에 올린 매출의 두 배, 최소 10.
  const upgradeCost = lastWaveSales => Math.max(c.upgrade.minCost, Math.floor(lastWaveSales * c.upgrade.costFactor));
  // 새로고침 비용: 그 스테이지의 처음 값에서 시작해 누를 때마다 두 배. presses: 이 스테이지에서 지금까지 누른 횟수.
  const refreshCost = (stage, presses) => data.stages[stage - 1].refreshBase * Math.pow(c.refresh.multiplierPerPress, presses);

  return { prep, runDwarf, runWave, upgradeCost, refreshCost, feeAt, multAt, tasteOf, shop: id => shops.get(id), support: id => supports.get(id), building: id => shops.get(id) || supports.get(id), trait: id => traits.get(id), restKind };
}

// 숫자를 화면에 적는 법. 2.5, 6.25처럼 필요한 자리까지만.
export const fmtNum = x => (Number.isInteger(x) ? String(x) : String(Math.round(x * 1000) / 1000));

// 이용 기록 한 줄을 계산식 글자로. stackNames: 데이터 파일의 stacks(허기, 포만감, 취기, 흥).
// 예: "6 + 허기 3 × 8 = 30", "(12 + 취기 3 × 4) × 2.5 × 2(만취 상태) = 120"
export function formulaText(ev, stackNames) {
  const terms = ev.terms.filter(t => t.count > 0).map(t => `${stackNames[t.stack]} ${t.count} × ${t.per}`);
  const sum = [fmtNum(ev.fee), ...terms].join(' + ');
  const mults = [];
  if (ev.baseMult !== 1) mults.push(fmtNum(ev.baseMult));
  if (ev.threshold) {
    const label = ev.threshold.stack === 'tipsy' ? '만취 상태' : ev.threshold.stack === 'fullness' ? '포만 상태' : `${stackNames[ev.threshold.stack]} ${ev.threshold.at} 이상`;
    mults.push(`${fmtNum(ev.threshold.mult)}(${label})`);
  }
  if (!mults.length) return terms.length ? `${sum} = ${ev.pay}` : `요금 ${ev.pay}`;
  const floored = ev.raw !== ev.pay ? ' (소수 버림)' : '';
  return `${terms.length ? `(${sum})` : sum} × ${mults.join(' × ')} = ${ev.pay}${floored}`;
}

// 허기와 포만감은 한 눈금이다. 양수면 허기, 음수면 포만감.
export const gaugeText = h => (h > 0 ? `허기 ${h}` : h < 0 ? `포만감 ${-h}` : '허기 0');
