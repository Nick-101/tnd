// 욜로드워프 시제품 1차 계산 엔진. 제작 요청서(docs/proto1) 3절과 4절, 바탕은 규칙 문서 v3의 6~10절.
// 화면과 무관한 순수 계산이다. DOM도 난수도 쓰지 않는다. 숫자는 모두 데이터 파일에서 읽는다.
// 건물은 데이터의 effect.type으로만 가린다. 데이터에서 건물을 빼면 그 건물 없이 돌아간다.
// prep(st)                 → 보드를 읽는다 (업종, 요금, 걸린 ×, 지나갈 때 일하는 건물)
// runDwarf(info, dwarf, …) → 드워프 한 마리의 매출과 "어느 칸에서 얼마가 왜 들어왔는지"의 기록
// endWave / startPrep      → 웨이브가 끝났을 때와 정비를 시작할 때 보드에 일어나는 일
// 계산은 docs/proto1/reference_engine_proto1.mjs와 같다(검증 사례로 맞춘다). 여기에는 화면이 쓸 기록을 더했다.

export function makeEngine(data) {
  const c = data.constants;
  const shops = new Map(data.shops.map(s => [s.id, s]));
  const supports = new Map(data.supports.map(s => [s.id, s]));
  const traits = new Map(data.traits.map(t => [t.id, t]));
  const byType = type => data.supports.find(s => s.effect.type === type) || null;
  const REST = '휴식';

  // st: { board: 0번 칸(입구)부터의 건물 id(빈 칸은 null), levels: 칸마다의 ★ 수, trend: 이번 웨이브의 유행 업종(없으면 null) }
  function prep(st) {
    const { board, levels } = st; const N = board.length;
    const shopAt = board.map(b => (b && shops.get(b)) || null);
    const supAt = board.map(b => (b && supports.get(b)) || null);
    const typeAt = board.map((b, i) => (supAt[i] ? supAt[i].effect.type : null));
    const shopTiles = []; for (let i = 0; i < N; i++) if (shopAt[i]) shopTiles.push(i);
    const adj1 = i => [(i - 1 + N) % N, (i + 1) % N];
    const adj2 = i => [...new Set([(i - 2 + N) % N, (i - 1 + N) % N, (i + 1) % N, (i + 2) % N])];
    const prev = i => (i - 1 + N) % N;
    // 화면용 기록: 칸마다 걸린 지원(sources), 지원마다 닿는 칸(targets). 계산에는 쓰지 않는다.
    const sources = board.map(() => []), targets = board.map(() => []);
    const note = (i, j, type, value) => { sources[j].push({ from: i, id: board[i], type, value }); if (!targets[i].includes(j)) targets[i].push(j); };

    // 0) 업종. 구름다리: 양옆 1칸이 모두 매장이면 두 매장은 서로의 업종도 갖는다(매장이 본래 가진 업종만 건넨다).
    const kindsAt = board.map((b, i) => (shopAt[i] ? [...shopAt[i].kinds] : null));
    for (let i = 0; i < N; i++) if (typeAt[i] === 'shareKinds') {
      const [a, b] = adj1(i);
      if (shopAt[a] && shopAt[b]) {
        for (const k of shopAt[b].kinds) if (!kindsAt[a].includes(k)) kindsAt[a].push(k);
        for (const k of shopAt[a].kinds) if (!kindsAt[b].includes(k)) kindsAt[b].push(k);
        note(i, a, 'kinds', shopAt[b].kinds.join(', ')); note(i, b, 'kinds', shopAt[a].kinds.join(', '));
      }
    }
    const matches = (j, target) => target === 'shops' ? true : kindsAt[j].includes(target);
    const tilesOf = (i, scope) => (scope === 'all' ? shopTiles : scope === 'adj1' ? adj1(i) : scope === 'adj2' ? adj2(i) : scope === 'prev' ? [prev(i)] : [])
      .filter(j => shopAt[j]);
    const empty = board.filter(b => b === null).length;

    // 1) 요금을 더하는 것부터. "요금이 가장 높은 매장"은 요금을 모두 더한 뒤에 정한다.
    const fee = board.map((b, i) => (shopAt[i] ? shopAt[i].fee : 0));
    const addFee = (i, j, v) => { fee[j] += v; note(i, j, 'fee', v); };
    for (let i = 0; i < N; i++) {
      const s = supAt[i]; if (!s) continue; const e = s.effect;
      if (e.type === 'fee') for (const j of tilesOf(i, e.scope).filter(j => matches(j, e.target))) addFee(i, j, e.amount);
      else if (e.type === 'smelter') for (const j of shopTiles) addFee(i, j, e.feeAll);
      else if (e.type === 'feePerEmpty') for (const j of shopTiles) addFee(i, j, e.amount * empty);
    }
    const best = (tiles, keys) => tiles.reduce((a, j) => {
      if (a === null) return j;
      for (const k of keys) { if (k(j) > k(a)) return j; if (k(j) < k(a)) return a; }
      return a;   // 같으면 입구에서 먼저 나오는 칸
    }, null);
    const top = best(shopTiles, [j => fee[j]]);
    const mostStars = best(shopTiles.filter(j => levels[j] > 0), [j => levels[j], j => fee[j]]);

    // 2) 곱, 주는 스택, 드워프를 가리는 것, 성장, 휴식
    const mult = board.map(() => 1), again = board.map(() => 0), growFee = board.map(() => 0), restMult = board.map(() => 1);
    const giveBonus = board.map(() => 0), vip = board.map(() => false);
    const mul = (i, j, v) => { mult[j] *= v; note(i, j, 'mult', v); };
    for (let i = 0; i < N; i++) {
      const s = supAt[i]; if (!s) continue; const e = s.effect;
      const hit = () => tilesOf(i, e.scope).filter(j => matches(j, e.target));
      if (e.type === 'mult') {
        const tiles = e.scope === 'duplicates' ? shopTiles.filter(j => shopTiles.filter(q => board[q] === board[j]).length >= 2) : hit();
        for (const j of tiles) mul(i, j, e.amount);
      } else if (e.type === 'growFee') for (const j of hit()) { growFee[j] += e.amount; note(i, j, 'growFee', e.amount); }
      else if (e.type === 'restMult') for (const j of hit()) { restMult[j] *= e.amount; note(i, j, 'restMult', e.amount); }
      else if (e.type === 'campus') for (const j of tilesOf(i, 'adj1')) { mul(i, j, e.mult); giveBonus[j] += e.giveBonus; note(i, j, 'giveBonus', e.giveBonus); }
      else if (e.type === 'smelter') for (const j of tilesOf(i, 'adj1')) mul(i, j, e.multAdj);
      else if (e.type === 'popup') for (const j of tilesOf(i, 'adj1')) mul(i, j, e.mult);
      else if (e.type === 'vip') for (const j of tilesOf(i, 'adj1')) { mul(i, j, e.mult); vip[j] = true; note(i, j, 'vip', 1); }
      else if (e.type === 'original') {   // 이전 칸의 매장. 그 매장의 업종을 가진 매장이 보드에 또 있으면 효과가 없다
        const j = prev(i);
        if (shopAt[j]) { if (!shopTiles.some(q => q !== j && kindsAt[q].some(k => kindsAt[j].includes(k)))) mul(i, j, e.mult); else note(i, j, 'off', 1); }
      } else if (e.type === 'streak') {   // 같은 업종을 가진 매장이 e.min칸 이상 이어진 구간. 고리의 끝과 입구도 이어진다. 한 매장에는 한 번만 건다
        const marked = new Set();
        for (const k of c.kinds) {
          const has = j => !!shopAt[j] && kindsAt[j].includes(k);
          for (let j = 0; j < N; j++) if (has(j) && !has(prev(j))) {
            const run = []; for (let q = j; has(q); q = (q + 1) % N) run.push(q);
            if (run.length >= e.min) run.forEach(q => marked.add(q));
          }
        }
        for (const j of marked) mul(i, j, e.mult);
      } else if (e.type === 'trend') { if (st.trend) for (const j of shopTiles) if (kindsAt[j].includes(st.trend)) mul(i, j, e.mult); }
      else if (e.type === 'branch') { if (top !== null) note(i, top, 'branch', 1); }
      else if (e.type === 'everyNth') { if (shopAt[prev(i)]) note(i, prev(i), 'everyNth', e.mult); }
      else if (e.type === 'merger') { const [a, b] = adj1(i); if (shopAt[a] && shopAt[b]) { note(i, a, 'merger', 1); note(i, b, 'merger', 1); } }
      else if (e.type === 'roundabout') for (let k = Math.max(0, i - e.tiles); k < i; k++) targets[i].push(k);
    }
    const starMult = board.map((b, i) => (shopAt[i] ? Math.pow(c.upgrade.salesMultPerStar, levels[i]) : 1));
    for (const j of shopTiles) mult[j] *= starMult[j];   // ★ 하나마다 ×2

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
    const mostKind = () => {
      let kind = null, bestCount = 0, bestFirst = N;
      for (const k of c.kinds) {
        if (k === REST) continue;
        const tiles = shopTiles.filter(j => kindsAt[j].includes(k)); if (!tiles.length) continue;
        if (tiles.length > bestCount || (tiles.length === bestCount && tiles[0] < bestFirst)) { kind = k; bestCount = tiles.length; bestFirst = tiles[0]; }
      }
      return kind;
    };
    const likeAll = typeAt.includes('likeMost') ? mostKind() : null;
    return { N, board, levels, shopAt, supAt, typeAt, shopTiles, kindsAt, fee, mult, starMult, again, growFee, restMult, giveBonus, vip, top, mostStars, passAt, branchAt,
      roundabout, roundaboutTiles, keep, tipDivisor, eventTile, eventEffect, likeAll, mostKind: mostKind(), trend: st.trend || null, empty, sources, targets };
  }

  const feeAt = (info, j, g) => info.fee[j] + info.growFee[j] * g;
  // 이 드워프가 좋아하는 업종(거리 표지판이 더한 것까지)과 칸마다의 취향
  const likesOf = (info, dwarf) => (info.likeAll && !dwarf.likes.includes(info.likeAll) ? [...dwarf.likes, info.likeAll] : dwarf.likes);
  function tasteOf(info, i, dwarf) {
    if (!info.shopAt[i]) return 0;
    const like = info.kindsAt[i].some(k => likesOf(info, dwarf).includes(k)), dis = info.kindsAt[i].includes(dwarf.dislike);
    return like && !dis ? c.satisfaction.like : dis && !like ? c.satisfaction.dislike : 0;
  }

  // 드워프 한 마리를 보낸다. g0: 이 웨이브에서 지금까지 돈 추가 바퀴 수. sales: 칸마다의 매출을 더해 갈 배열.
  // ctx.eventCount: 이벤트 부스가 센 이용 수(건물에 남는다). options.events가 false면 기록을 남기지 않는다.
  function runDwarf(info, dwarf, g0 = 0, sales = null, ctx = { eventCount: 0 }, options = {}) {
    const trait = dwarf.trait ? traits.get(dwarf.trait).effect : {};
    const start = trait.lapStart || {};
    const baseLaps = trait.baseLaps || c.baseLaps;
    const fresh = () => ({ h: (start.hunger || 0) - (start.fullness || 0), d: start.tipsy || 0, y: start.hype || 0, tired: 0 });   // h: 양수는 허기, 음수는 포만감
    const likes = likesOf(info, dwarf);
    const likeAt = info.board.map((b, i) => !!info.shopAt[i] && info.kindsAt[i].some(k => likes.includes(k)));
    const taste = info.board.map((b, i) => tasteOf(info, i, dwarf));
    const log = options.events === false ? null : [];
    let st = fresh(), sat = 0, cost = c.extraLapCost.first, laps = 0, total = 0, bestPay = 0, step = 0, lap = 1;
    const amount = name => name === 'hunger' ? Math.max(st.h, 0) : name === 'fullness' ? Math.max(-st.h, 0) : name === 'tipsy' ? st.d : st.y;
    const snap = () => ({ h: st.h, d: st.d, y: st.y, tired: st.tired, sat });
    // 이용 한 번. 지나치면 null.
    const use = (j, g, ev) => {
      const s = info.shopAt[j];
      if (s.skip === 'drunk' && st.d >= c.thresholds.drunk) { if (ev) ev.skip = 'drunk'; return null; }
      if (s.skip === 'full' && -st.h >= c.thresholds.full) { if (ev) ev.skip = 'full'; return null; }
      if (info.vip[j] && !likeAt[j]) { if (ev) ev.skip = 'vip'; return null; }   // VIP 라운지: 그 업종을 좋아하지 않는 드워프는 지나친다
      let add = 0; for (const r of s.read) add += r.per * amount(r.stack);
      let m = info.mult[j];
      const over = !!(s.threshold && amount(s.threshold.stack) >= s.threshold.at);
      if (over) m *= s.threshold.mult;
      let nth = null, nthHit = false;
      if (j === info.eventTile) { ctx.eventCount += 1; nth = ctx.eventCount; if (ctx.eventCount % info.eventEffect.every === 0) { m *= info.eventEffect.mult; nthHit = true; } }
      const raw = (info.fee[j] + info.growFee[j] * g + add) * m;
      const pay = Math.floor(raw);
      if (ev) Object.assign(ev, { fee: info.fee[j] + info.growFee[j] * g, terms: s.read.map(r => ({ stack: r.stack, count: amount(r.stack), per: r.per })), add,
        baseMult: info.mult[j], threshold: over ? s.threshold : null, nth, nthHit, nthMult: nthHit ? info.eventEffect.mult : null, nthEvery: nth ? info.eventEffect.every : null, mult: m, raw, pay });
      for (const r of s.read) if (r.consume) { if (r.stack === 'fullness') { if (st.h < 0) st.h = 0; } else if (r.stack === 'tipsy') st.d = 0; else if (r.stack === 'hype') st.y = 0; }
      const b = info.giveBonus[j], gv = s.give, plus = x => (x > 0 ? x + b : 0);   // 대학교: 그 매장이 주는 스택마다 더 준다
      st.h += plus(gv.hunger) - plus(gv.fullness); st.d += plus(gv.tipsy); st.y += plus(gv.hype);
      return pay;
    };
    const isRest = j => info.shopAt[j].kinds.includes(REST);   // 휴식의 일은 매장이 본래 가진 업종으로만 본다
    // 칸 하나를 지난다. back: 회전교차로로 다시 지나는 것
    const visit = (i, g, back) => {
      const base = () => (log ? { type: 'use', lap, step, tile: i, shopTile: i, via: back ? 'roundabout' : null, before: snap() } : null);
      if (info.shopAt[i]) {
        for (let u = 0; u <= info.again[i]; u++) {
          const ev = base(); if (ev && u > 0) ev.via = 'again';
          const pay = use(i, g, ev);
          if (pay === null) { if (log) { ev.type = 'skip'; log.push(ev); } break; }
          total += pay; if (sales) sales[i] += pay; if (pay > bestPay) bestPay = pay;
          let restGain = 0, restFrom = null;
          if (isRest(i)) {
            if (u === 0) {
              const r = info.shopAt[i].rest; let gain;
              restFrom = st.tired;
              if (r.mode === 'consumePer') { gain = Math.floor(st.tired / r.per); st.tired = 0; }
              else if (r.mode === 'per') gain = Math.floor(st.tired / r.per);
              else gain = st.tired >= r.at ? r.gain : 0;
              if (gain > 0) { restGain = gain * info.restMult[i]; sat += restGain; }
            }
          } else st.tired += c.fatiguePerUse;
          sat += taste[i];
          if (log) { Object.assign(ev, { satChange: taste[i], restGain, restFrom, after: snap(), total }); log.push(ev); }
        }
      } else if (info.branchAt[i]) {   // 2호점: 요금이 가장 높은 매장을 이 칸에서 이용한다. 만족도는 바뀌지 않는다
        if (info.top !== null) {
          const j = info.top, ev = base(); if (ev) { ev.shopTile = j; ev.via = 'branch'; }
          const pay = use(j, g, ev);
          if (pay !== null) {
            total += pay; if (sales) sales[j] += pay; if (pay > bestPay) bestPay = pay;
            if (!isRest(j)) st.tired += c.fatiguePerUse;
            if (log) { Object.assign(ev, { satChange: 0, restGain: 0, restFrom: null, after: snap(), total }); log.push(ev); }
          } else if (log) { ev.type = 'skip'; log.push(ev); }
        }
      } else if (info.passAt[i]) {   // 산책로, 언덕길, 버스킹 존
        const e = info.passAt[i], before = log ? snap() : null;
        for (const k of e.consume || []) { if (k === 'fullness') { if (st.h < 0) st.h = 0; } else if (k === 'tipsy') st.d = 0; else if (k === 'hype') st.y = 0; }
        if (e.convert) { const v = amount(e.convert.from); if (e.convert.from === 'tipsy') st.d = 0; if (e.convert.to === 'hype') st.y += v; }
        if (e.give) { st.h += (e.give.hunger || 0) - (e.give.fullness || 0); st.d += e.give.tipsy || 0; st.y += e.give.hype || 0; st.tired += e.give.fatigue || 0; }
        if (log) log.push({ type: 'pass', lap, step, tile: i, via: back ? 'roundabout' : null, before, after: snap() });
      }
    };
    for (;;) {
      const g = g0 + Math.max(0, laps - baseLaps + 1);   // 추가 바퀴에 들어설 때마다 한 번 자란다
      const lapStartTotal = total; lap = laps + 1; step = 0;
      const path = [];   // 이 바퀴에 걷는 칸의 차례. 화면이 이대로 걷는다
      const head = log ? { type: 'lapStart', lap, g, extra: laps >= baseLaps, extraNo: Math.max(0, laps - baseLaps + 1), stacks: snap(), sat, cost, baseLaps, path } : null;
      if (log) log.push(head);
      for (let i = 0; i < info.N; i++) {
        path.push({ tile: i, back: false });
        // 회전교차로: 이 칸에 오면 이전 칸들을 한 번 더 지난다. 입구 앞으로는 넘어가지 않는다
        if (i === info.roundabout) { step++; for (let k = Math.max(0, i - info.roundaboutTiles); k < i; k++) { path.push({ tile: k, back: true }); visit(k, g, true); step++; } }
        else { visit(i, g, false); step++; }
      }
      laps += 1;
      const end = log ? { type: 'lapEnd', lap, lapSales: total - lapStartTotal, total, stacksBefore: snap(), satBefore: sat } : null;
      const kept = st; st = fresh();
      if (info.keep.includes('hype')) st.y += kept.y;   // 전광판: 흥은 바퀴를 넘어 남는다
      let result = 'base';
      if (laps >= baseLaps) {
        if (sat >= cost) { sat -= cost; if (end) end.paid = cost; cost *= c.extraLapCost.multiplier; result = 'extra'; }
        else { result = 'leave'; if (end) end.needed = cost; }
      }
      if (end) { Object.assign(end, { result, sat, cost, keptHype: info.keep.includes('hype') ? kept.y : 0 }); log.push(end); }
      if (result === 'leave') break;
    }
    const tip = info.tipDivisor && sat > 0 ? Math.floor(total * sat / info.tipDivisor) : 0;   // 팁 상자
    return { sales: total, laps, extraLaps: laps - baseLaps, tip, bestPay, satLeft: sat, events: log, g0, baseLaps };
  }

  // 웨이브 하나: 보낸 순서대로 드워프를 돌린다. 검증 사례와 같은 꼴을 돌려준다.
  function runWave(st, wave) {
    const info = prep(st); const sales = st.board.map(() => 0); let g = 0; const perDwarf = []; const ctx = { eventCount: st.eventCount || 0 };
    for (const d of wave) { const r = runDwarf(info, d, g, sales, ctx, { events: false }); perDwarf.push({ sales: r.sales, laps: r.laps, extraLaps: r.extraLaps, tip: r.tip }); g += r.extraLaps; }
    return { perDwarf, waveSales: perDwarf.reduce((a, r) => a + r.sales, 0), tips: perDwarf.reduce((a, r) => a + r.tip, 0), salesByTile: sales,
      topTile: info.top, feeByTile: st.board.map((b, i) => (info.shopAt[i] ? info.fee[i] : null)), multByTile: st.board.map((b, i) => (info.shopAt[i] ? info.mult[i] : null)),
      kindsByTile: info.kindsAt, likeAll: info.likeAll, eventCount: ctx.eventCount };
  }

  // 웨이브가 끝났을 때(판정을 통과한 뒤) 보드에 일어나는 일. 순서: 대기업 사옥, 팝업 스토어, 공사 현장. (3.6절의 3~6)
  // s: { board, levels, timers: { 건물 id: 남은 횟수 }, money }, salesByTile: 방금 끝난 웨이브에 칸마다 들어온 매출
  function endWave(s, salesByTile) {
    const board = [...s.board], levels = [...s.levels], timers = { ...s.timers }, lastSales = [...salesByTile]; let money = s.money; const events = [];
    const N = board.length; const isShop = i => !!board[i] && shops.has(board[i]);
    const typeOf = id => (id && supports.get(id) ? supports.get(id).effect.type : null);
    const hq = board.findIndex(b => typeOf(b) === 'merger');
    if (hq >= 0) {
      const a = (hq - 1 + N) % N, b = (hq + 1) % N;
      if (isShop(a) && isShop(b)) {
        // 매출이 높은 쪽이 남는다. 같으면 ★이 많은 쪽, 그것도 같으면 입구에서 먼저 나오는 쪽
        const lo = Math.min(a, b), hi = Math.max(a, b);
        const win = salesByTile[lo] !== salesByTile[hi] ? (salesByTile[lo] > salesByTile[hi] ? lo : hi) : levels[lo] !== levels[hi] ? (levels[lo] > levels[hi] ? lo : hi) : lo;
        const lose = win === lo ? hi : lo;
        if (levels[win] < c.upgrade.maxStars) {   // 남는 쪽이 이미 ★★★이면 아무 일도 없다
          if (board.some(x => typeOf(x) === 'demolitionIncome')) { money += salesByTile[lose]; events.push({ type: 'demolitionIncome', tile: lose, amount: salesByTile[lose] }); }
          events.push({ type: 'merger', demolished: lose, shop: board[lose], starTo: win });
          board[lose] = null; levels[lose] = 0; lastSales[lose] = 0; levels[win] += 1;
        }
      }
    }
    for (const [type, becomes] of [['popup', () => null], ['construction', e => e.becomes]]) {
      const i = board.findIndex(b => typeOf(b) === type); if (i < 0) continue;
      const id = board[i];
      timers[id] -= 1;
      if (timers[id] <= 0) { const to = becomes(supports.get(id).effect); board[i] = to; delete timers[id]; events.push({ type: to ? 'built' : 'gone', tile: i, id }); }
    }
    return { board, levels, timers, money, lastSales, events };
  }

  // 다음 정비를 시작할 때. 순서: 칸이 는다, 은행의 이자. (3.6절의 8~9)
  function startPrep(s, waveNo) {
    const board = [...s.board], levels = [...s.levels]; let money = s.money;
    while (board.length < data.waves[waveNo - 1].tiles) { board.push(null); levels.push(0); }   // 새 칸은 고리의 끝(마지막 칸과 입구 사이)에 생긴다
    const bank = board.map(b => b && supports.get(b)).find(x => x && x.effect.type === 'interest');
    if (bank) money += Math.floor(money / bank.effect.divisor);
    return { ...s, board, levels, money };
  }

  // 업그레이드 비용: 그 매장이 지난 웨이브에 올린 매출의 두 배, 최소 10.
  const upgradeCost = lastWaveSales => Math.max(c.upgrade.minCost, Math.floor(lastWaveSales * c.upgrade.costFactor));
  // 새로고침 비용: 그 웨이브의 처음 값에서 시작해 누를 때마다 두 배. presses: 이번 정비에서 지금까지 누른 횟수.
  const refreshCost = (waveNo, presses) => data.waves[waveNo - 1].refreshBase * Math.pow(c.refresh.multiplierPerPress, presses);

  return { prep, runDwarf, runWave, endWave, startPrep, upgradeCost, refreshCost, feeAt, tasteOf, likesOf, byType,
    shop: id => shops.get(id), support: id => supports.get(id), building: id => shops.get(id) || supports.get(id), trait: id => traits.get(id) };
}

// 숫자를 화면에 적는 법. 2.5, 0.75처럼 필요한 자리까지만.
export const fmtNum = x => (Number.isInteger(x) ? String(x) : String(Math.round(x * 1000) / 1000));

// 이용 기록 한 줄을 계산식 글자로. stackNames: 스택의 이름(허기, 포만감, 취기, 흥).
// 예: "6 + 허기 3 × 8 = 30", "(12 + 취기 3 × 4) × 3 × 2(만취 상태) × 5(5번째 이용) = 720"
export function formulaText(ev, stackNames) {
  const terms = ev.terms.filter(t => t.count > 0).map(t => `${stackNames[t.stack]} ${t.count} × ${t.per}`);
  const sum = [fmtNum(ev.fee), ...terms].join(' + ');
  const mults = [];
  if (ev.baseMult !== 1) mults.push(fmtNum(ev.baseMult));
  if (ev.threshold) {
    const label = ev.threshold.stack === 'tipsy' ? '만취 상태' : ev.threshold.stack === 'fullness' ? '포만 상태' : `${stackNames[ev.threshold.stack]} ${ev.threshold.at} 이상`;
    mults.push(`${fmtNum(ev.threshold.mult)}(${label})`);
  }
  if (ev.nthHit) mults.push(`${fmtNum(ev.nthMult)}(${ev.nthEvery}번째 이용)`);
  if (!mults.length) return terms.length ? `${sum} = ${ev.pay}` : `요금 ${ev.pay}`;
  const floored = ev.raw !== ev.pay ? ' (소수 버림)' : '';
  return `${terms.length ? `(${sum})` : sum} × ${mults.join(' × ')} = ${ev.pay}${floored}`;
}

// 허기와 포만감은 한 눈금이다. 양수면 허기, 음수면 포만감.
export const gaugeText = h => (h > 0 ? `허기 ${h}` : h < 0 ? `포만감 ${-h}` : '허기 0');
