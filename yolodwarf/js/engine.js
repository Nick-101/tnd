// 욜로드워프 데모 3.0 계산 엔진. 규칙 문서(docs/demo3/욜로드워프_데모3_규칙.md)의 2~11절.
// 화면과 무관한 순수 계산이다. DOM도 난수도 쓰지 않는다. 숫자는 모두 데이터 파일에서 읽는다.
// 계산은 docs/demo3/reference_engine3.mjs와 같다(검증 사례로 맞춘다). 여기에는 화면이 쓸 기록(events)을 더했다.
//
// 상태(st): { board: 건물 id(빈 칸은 null), stars: ★ 수, grow: 키운 배율(0.1 단위의 정수), tiles: 특수 칸 id, kept: 터줏자리에 남은 배율, timers, money }
// read(st)             → 보드를 읽는다 (업종, 거리 표지판, 이웃, 배율이 가장 높은 매장)
// runDwarf(st, dwarf)  → 드워프 한 마리. 상태를 바꾸지 않는다. 키운 배율은 결과의 grow로 돌려준다
// apply(st, op)        → 보드에 손대는 일 하나. 새 상태나 { illegal }을 돌려준다. 미리 보기도 이 함수로 한다
// endWave / startPrep  → 웨이브가 끝났을 때와 정비를 시작할 때

const mod = (a, n) => ((a % n) + n) % n;
const clone = st => ({ ...st, board: [...st.board], stars: [...st.stars], grow: [...st.grow], tiles: [...st.tiles], kept: [...st.kept], timers: { ...st.timers } });

export function makeEngine(data) {
  const c = data.constants;
  const shops = new Map(data.shops.map(s => [s.id, s]));
  const supports = new Map(data.supports.map(s => [s.id, s]));
  const guests = new Map((data.guests || []).map(g => [g.id, g]));
  const traits = new Map(data.traits.map(t => [t.id, t]));
  const REST = '휴식';

  // 보드를 읽는다. 드워프를 보낼 때마다 다시 읽는다.
  function read(st) {
    const { board, stars, grow, tiles } = st; const N = board.length;
    const shopAt = board.map(b => (b && shops.get(b)) || null);
    const typeAt = board.map(b => (b && supports.has(b) ? supports.get(b).effect.type : null));
    const effAt = board.map(b => (b && supports.has(b) ? supports.get(b).effect : null));
    const shopTiles = []; for (let i = 0; i < N; i++) if (shopAt[i]) shopTiles.push(i);
    const prev = i => mod(i - 1, N), next = i => mod(i + 1, N);

    // 이웃. 로터리의 건물은 모든 칸과 이웃하고, 모든 칸은 로터리의 건물과 이웃한다.
    const rotary = tiles.indexOf('rotary');
    const near = (i, which) => {
      if (i === rotary) return board.map((b, j) => j).filter(j => j !== i);
      const base = which === 'adj' ? [prev(i), next(i)] : which === 'prev' ? [prev(i)] : [next(i)];
      if (rotary >= 0) base.push(rotary);
      return [...new Set(base)];
    };

    // 업종. 구름다리: 실제 양옆 칸이 모두 매장이면 두 매장은 서로의 업종도 갖는다 (본래 가진 업종만 건넨다). 로터리와 상관없다.
    const kindsAt = board.map((b, i) => (shopAt[i] ? [...shopAt[i].kinds] : null));
    for (let i = 0; i < N; i++) if (typeAt[i] === 'shareKinds') {
      const a = prev(i), b = next(i);
      if (shopAt[a] && shopAt[b] && a !== b) {
        for (const k of shopAt[b].kinds) if (!kindsAt[a].includes(k)) kindsAt[a].push(k);
        for (const k of shopAt[a].kinds) if (!kindsAt[b].includes(k)) kindsAt[b].push(k);
      }
    }
    // 거리 표지판: 휴식을 뺀 업종 가운데 그 업종을 가진 매장이 가장 많은 업종. 같으면 그 업종의 첫 매장이 입구에 가까운 쪽, 그것도 같으면 업종의 정해진 순서
    const mostKind = () => {
      let kind = null, bestCount = 0, bestFirst = N;
      for (const k of c.kinds) {
        if (k === REST) continue;
        const t = shopTiles.filter(j => kindsAt[j].includes(k)); if (!t.length) continue;
        if (t.length > bestCount || (t.length === bestCount && t[0] < bestFirst)) { kind = k; bestCount = t.length; bestFirst = t[0]; }
      }
      return kind;
    };
    const likeAll = typeAt.includes('likeMost') ? mostKind() : null;
    // 배율. 금싸라기 땅의 매장은 ★이 하나 더 있는 것으로 친다. 값은 10을 곱한 정수다 (124면 ×12.4).
    const starMult = j => Math.pow(c.stars.multPerStar, stars[j] + (tiles[j] === 'prime_land' ? 1 : 0));
    const mult10 = j => (10 + grow[j]) * starMult(j);
    // 배율이 가장 높은 매장. 같으면 요금이 높은 쪽, 그것도 같으면 입구에서 먼저 나오는 칸
    let top = null;
    for (const j of shopTiles) if (top === null || mult10(j) > mult10(top) || (mult10(j) === mult10(top) && shopAt[j].fee > shopAt[top].fee)) top = j;
    return { N, shopAt, typeAt, effAt, shopTiles, kindsAt, likeAll, mostKind: mostKind(), near, starMult, mult10, top, rotary, prev, next, has: t => typeAt.includes(t), at: t => typeAt.indexOf(t) };
  }

  // 좋아하는 매장, 싫어하는 매장. 좋아하는 업종과 싫어하는 업종을 함께 가진 매장은 어느 쪽도 아니다. 단골 골목의 매장은 누구나 좋아한다.
  function tastes(st, info, dwarf) {
    const likes = info.likeAll && !dwarf.likes.includes(info.likeAll) ? [...dwarf.likes, info.likeAll] : dwarf.likes;
    const liked = st.board.map(() => false), disliked = st.board.map(() => false);
    for (const j of info.shopTiles) {
      if (st.tiles[j] === 'regulars_alley') { liked[j] = true; continue; }
      const like = info.kindsAt[j].some(k => likes.includes(k)), dis = dwarf.dislike != null && info.kindsAt[j].includes(dwarf.dislike);
      liked[j] = like && !dis; disliked[j] = dis && !like;
    }
    return { liked, disliked, likes };
  }

  // 드워프 한 마리를 보낸다. 상태를 바꾸지 않는다. 키운 배율은 결과의 grow로 돌려준다.
  // dwarf: { likes, dislike, trait } 또는 귀빈 { likes, dislike: null, quirk, baseLaps?, firstLapCost?, guest: true }
  // opt.first: 이 웨이브의 첫 드워프인가. opt.events가 false면 기록을 남기지 않는다.
  function runDwarf(st, dwarf, opt = {}) {
    const info = read(st), N = info.N, tiles = st.tiles; const grow = [...st.grow];
    const trait = dwarf.trait ? traits.get(dwarf.trait).effect : {};
    const quirk = dwarf.quirk || null;
    const start = trait.lapStart || {};
    const baseLaps = dwarf.baseLaps || trait.baseLaps || c.baseLaps;
    const payMult = dwarf.guest ? c.guests.payMult : 1;
    const fresh = () => ({ h: (start.hunger || 0) - (start.fullness || 0), d: start.tipsy || 0, y: start.hype || 0, tired: 0 });   // h: 양수는 허기, 음수는 포만감
    const { liked, disliked } = tastes(st, info, dwarf);
    const log = opt.events === false ? null : [];

    let s = fresh(), sat = 0, cost = dwarf.firstLapCost || c.extraLapCost.first, laps = 0, total = 0, uses = 0, fired = 0, dislikedThisLap = false, bestPay = 0;
    let step = 0, path = [], back = 0;   // 화면용: 이 바퀴에 걷는 칸의 차례
    const sales = st.board.map(() => 0);
    const amount = name => name === 'hunger' ? Math.max(s.h, 0) : name === 'fullness' ? Math.max(-s.h, 0) : name === 'tipsy' ? s.d : name === 'hype' ? s.y : s.tired;
    const isShop = j => !!info.shopAt[j];
    const snap = () => ({ h: s.h, d: s.d, y: s.y, tired: s.tired, sat });
    // 지원 건물이 한 번 지나갈 때 발동하는 횟수: 역 앞이면 한 번 더, 수집가면 한 번 더
    const fires = i => 1 + (tiles[i] === 'station_front' ? 1 : 0) + (quirk === 'doubleSupports' ? 1 : 0);
    // 매장을 키운다. 프랜차이즈 본사가 있으면 같은 이름의 매장이 함께 자란다. 기름진 땅의 매장은 두 배로 자란다.
    const addGrow = (j, amt, changes) => {
      const targets = info.has('franchise') ? info.shopTiles.filter(q => st.board[q] === st.board[j]) : [j];
      for (const q of targets) { const v = amt * (tiles[q] === 'fertile_land' ? 2 : 1); grow[q] += v; if (changes) changes.push({ tile: q, amount: v, now: grow[q] }); }
    };

    // 매장 이용 한 번. 지나치면 null. 매출을 셈한 뒤에 스택을 소모하고, 그 뒤에 스택을 준다.
    const use = (j, ev) => {
      const shop = info.shopAt[j];
      if (tiles[j] !== 'back_door') {
        if (shop.skip === 'drunk' && s.d >= c.thresholds.drunk) { if (ev) ev.skip = 'drunk'; return null; }
        if (shop.skip === 'full' && -s.h >= c.thresholds.full) { if (ev) ev.skip = 'full'; return null; }
        if (quirk === 'skipUnliked' && !liked[j]) { if (ev) ev.skip = 'unliked'; return null; }
      }
      let add = 0; for (const r of shop.read) add += r.per * amount(r.stack);
      const fan = shop.fanMult && liked[j] ? shop.fanMult : 1;
      const m = (10 + grow[j]) * info.starMult(j) * fan * payMult;
      const pay = Math.floor((shop.fee + add) * m / 10);
      if (ev) Object.assign(ev, { fee: shop.fee, terms: shop.read.map(r => ({ stack: r.stack, count: amount(r.stack), per: r.per })), add,
        mult10: (10 + grow[j]) * info.starMult(j), fan, guestMult: payMult, raw: (shop.fee + add) * m / 10, pay });
      for (const r of shop.read) if (r.consume) { if (r.stack === 'fullness') { if (s.h < 0) s.h = 0; } else if (r.stack === 'tipsy') s.d = 0; else if (r.stack === 'hype') s.y = 0; }
      const bonus = tiles[j] === 'lucky_spot' ? 1 : 0, plus = x => (x > 0 ? x + bonus : 0), g = shop.give;
      s.h += plus(g.hunger) - (quirk === 'noFullness' ? 0 : plus(g.fullness)); s.d += plus(g.tipsy); s.y += plus(g.hype);
      return pay;
    };

    // 칸 하나를 지난다
    const visit = i => {
      const base = (shopTile, via) => (log ? { type: 'use', lap: laps + 1, step, tile: i, shopTile, via, before: snap() } : null);
      if (isShop(i)) {
        const shop = info.shopAt[i], times = 1 + (tiles[i] === 'station_front' ? 1 : 0);
        for (let u = 0; u < times; u++) {
          const ev = base(i, u > 0 ? 'again' : back ? 'roundabout' : null);
          const pay = use(i, ev);
          if (pay === null) { if (log) { ev.type = 'skip'; log.push(ev); } break; }
          total += pay; sales[i] += pay; uses += 1; if (pay > bestPay) bestPay = pay;
          let restGain = 0, restFrom = null, satChange = 0;
          if (shop.rest) {   // 휴식: 피로를 만족도로 바꾼다. 한 번 지나갈 때 한 번만 바꾼다
            if (u === 0) { restFrom = s.tired; restGain = Math.floor(s.tired / shop.rest.per) * shop.rest.gain; sat += restGain; if (shop.rest.mode === 'consumePer') s.tired = 0; }
          } else if (liked[i]) s.tired += c.fatigue.perLikedUse * (quirk === 'doubleFatigue' ? 2 : 1);
          if (liked[i]) { sat += c.satisfaction.like; satChange = c.satisfaction.like; } else if (disliked[i]) { sat += c.satisfaction.dislike; satChange = c.satisfaction.dislike; dislikedThisLap = true; }
          if (log) { Object.assign(ev, { satChange, restGain, restFrom, after: snap(), total }); log.push(ev); }
        }
        return;
      }
      const e = info.effAt[i]; if (!e) return;
      for (let f = 0; f < fires(i); f++) {
        if (e.type === 'branch') {   // 2호점: 배율이 가장 높은 매장을 이 칸에서 이용한다. 매출과 스택만 바뀐다
          if (info.top !== null) {
            const ev = base(info.top, 'branch');
            const pay = use(info.top, ev);
            if (pay !== null) { total += pay; sales[info.top] += pay; if (pay > bestPay) bestPay = pay; if (log) { Object.assign(ev, { satChange: 0, restGain: 0, restFrom: null, after: snap(), total }); log.push(ev); } }
            else if (log) { ev.type = 'skip'; log.push(ev); }
          }
        } else if (e.type === 'roundabout') {   // 회전교차로: 이전 칸들을 한 번 더 지난다. 입구 앞으로는 넘어가지 않는다
          const here = step;
          for (let k = Math.max(0, i - e.tiles); k < i; k++) { path.push({ tile: k, back: true }); step = path.length - 1; back++; visit(k); back--; }
          if (f + 1 < fires(i)) { path.push({ tile: i, back: true }); step = path.length - 1; } else step = here;
        } else if (e.type === 'pass') {   // 산책로, 버스킹 존
          const before = log ? snap() : null;
          for (const k of e.consume || []) { if (k === 'fullness') { if (s.h < 0) s.h = 0; } else if (k === 'tipsy') s.d = 0; else if (k === 'hype') s.y = 0; }
          if (e.convert) { const v = amount(e.convert.from); s.d = 0; s.y += v; }
          if (e.give) s.h += e.give.hunger || 0;
          if (log) log.push({ type: 'pass', lap: laps + 1, step, tile: i, before, after: snap() });
        } else if (e.type === 'grower') {
          const stacks3 = ['hunger', 'fullness', 'tipsy', 'hype', 'tired'].filter(k => amount(k) >= c.thresholds.nightMarket).length;
          const n = e.cond === 'any' ? 1 : e.cond === 'extraLap' ? +(laps >= baseLaps) : e.cond === 'first' ? +!!opt.first : e.cond === 'disliked' ? +dislikedThisLap
            : e.cond === 'stacks3' ? stacks3 : 1;   // likesPrev는 아래에서 매장마다 본다
          if (n === 0) continue;
          let targets = e.target === 'adj' ? info.near(i, 'adj') : e.target === 'prev' ? info.near(i, 'prev') : e.target === 'next' ? info.near(i, 'next')
            : e.target === 'all' ? info.shopTiles : info.shopTiles.filter(j => liked[j]);
          targets = targets.filter(isShop);
          if (e.cond === 'likesPrev') targets = targets.filter(j => liked[j]);
          const changes = log ? [] : null;
          for (const j of targets) addGrow(j, e.amount * n, changes);
          if (targets.length) { fired += 1; if (log) log.push({ type: 'grow', lap: laps + 1, step, tile: i, changes }); }
        }
      }
    };

    for (;;) {
      path = []; step = 0;
      if (log) log.push({ type: 'lapStart', lap: laps + 1, extra: laps >= baseLaps, extraNo: Math.max(0, laps - baseLaps + 1), stacks: snap(), sat, cost, baseLaps, path });
      for (let i = 0; i < N; i++) { path.push({ tile: i, back: false }); step = path.length - 1; visit(i); }
      laps += 1; dislikedThisLap = false;
      const end = log ? { type: 'lapEnd', lap: laps, total, stacksBefore: snap(), satBefore: sat } : null;
      const kept = s; s = fresh();
      if (info.has('keepStack')) s.y += kept.y;          // 전광판: 흥은 바퀴를 넘어 남는다
      if (quirk === 'keepTipsy') s.d += kept.d;          // 술고래: 취기는 바퀴를 넘어 남는다
      let result = 'base';
      if (laps >= baseLaps) {
        if (sat >= cost && laps < c.maxLaps) { sat -= cost; if (end) end.paid = cost; cost *= c.extraLapCost.multiplier; result = 'extra'; }
        else { result = 'leave'; if (end) end.needed = cost; }
      }
      if (end) { Object.assign(end, { result, sat, cost, keptHype: info.has('keepStack') ? kept.y : 0, keptTipsy: quirk === 'keepTipsy' ? kept.d : 0 }); log.push(end); }
      if (result === 'leave') break;
    }
    // 방명록: 떠날 때 남은 만족도 1당 배율이 가장 높은 매장이 자란다
    const gb = info.at('guestbook');
    if (gb >= 0 && sat > 0 && info.top !== null) { const changes = log ? [] : null; addGrow(info.top, info.effAt[gb].amount * sat * fires(gb), changes); if (log) log.push({ type: 'grow', leaving: true, tile: gb, changes }); }
    return { sales: total, laps, extraLaps: laps - baseLaps, uses, fired, satLeft: sat, salesByTile: sales, grow, top: info.top, bestPay, events: log, baseLaps, info, liked, disliked };
  }

  // 이 웨이브에 드워프를 보내는 횟수. 버스 터미널이 있으면 한 번 더, 그것이 역 앞에 있으면 또 한 번 더.
  function sends(st) {
    const i = st.board.findIndex(b => b && supports.has(b) && supports.get(b).effect.type === 'extraSend');
    return c.sendsPerWave + (i >= 0 ? supports.get(st.board[i]).effect.amount * (1 + (st.tiles[i] === 'station_front' ? 1 : 0)) : 0);
  }
  // 귀빈의 보상으로 나오는 특수 칸 후보의 수
  const guestReward = (waveNo, extraLaps) => (c.guests.rewardWaves.includes(waveNo) ? Math.min(c.guests.rewardMax, Math.max(0, extraLaps)) : 0);
  // 새로고침 비용: 그 웨이브의 처음 값에서 시작해 누를 때마다 두 배. presses: 이번 정비에서 지금까지 누른 횟수
  const refreshCost = (waveNo, presses) => data.waves[waveNo - 1].refreshBase * Math.pow(c.refresh.multiplierPerPress, presses);

  // 웨이브 하나: 보낸 순서대로 드워프를 돌리고, 귀빈이 있으면 마지막에 돌린다. 검증 사례와 같은 꼴을 돌려준다.
  function runWave(st, dwarves, guestId = null) {
    const cur = clone(st); const salesByTile = st.board.map(() => 0); const perDwarf = [];
    const one = (d, first) => {
      const r = runDwarf(cur, d, { first, events: false }); cur.grow = r.grow; r.salesByTile.forEach((v, i) => { salesByTile[i] += v; });
      return { sales: r.sales, laps: r.laps, extraLaps: r.extraLaps, uses: r.uses, satLeft: r.satLeft, top: r.top };
    };
    dwarves.forEach((d, k) => perDwarf.push(one(d, k === 0)));
    const guest = guestId ? one({ ...guests.get(guestId), guest: true }, false) : null;
    const info = read(st);
    return { perDwarf, guest, waveSales: perDwarf.reduce((a, r) => a + r.sales, 0) + (guest ? guest.sales : 0), salesByTile, growAfter: cur.grow,
      kindsByTile: info.kindsAt, likeAll: info.likeAll };
  }

  // 보드에 손대는 일들. 새 상태를 돌려준다. 할 수 없는 일이면 { illegal: 까닭 }을 돌려준다.
  // op: { type: 'build' | 'overlap' | 'replace', tile, id } | { type: 'demolish', tile } | { type: 'swap', a, b }
  //   | { type: 'insert', gap, from } (보드의 건물을 틈에 끼워 넣는다) | { type: 'insert', gap, id } (손패의 카드를 틈에 끼워 넣는다)
  //   | { type: 'addTile', pos, special } (귀빈의 보상: pos번 칸 자리에 새 특수 칸을 끼워 넣는다. pos는 1부터 칸 수까지)
  // 틈 gap은 (gap − 1)번 칸과 gap번 칸의 사이다. 0은 마지막 칸과 0번 칸의 사이다.
  function apply(st0, op) {
    const st = clone(st0), N = st.board.length; const isShop = id => shops.has(id), isSup = id => supports.has(id);
    const known = id => isShop(id) || isSup(id);
    const empty = i => st.board[i] === null;
    const put = (i, b) => { st.board[i] = b.id; st.stars[i] = b.stars; st.grow[i] = b.grow; };
    const take = i => { const b = { id: st.board[i], stars: st.stars[i], grow: st.grow[i] }; st.board[i] = null; st.stars[i] = 0; st.grow[i] = 0; return b; };
    const fresh = id => { if (supports.has(id) && supports.get(id).waves) st.timers[id] = supports.get(id).waves; return { id, stars: 0, grow: 0 }; };
    const demolish = i => {   // 터줏자리의 매장을 철거하면 키운 배율이 칸에 남는다
      if (isShop(st.board[i]) && st.tiles[i] === 'old_site') st.kept[i] += st.grow[i];
      if (st.board[i] in st.timers) delete st.timers[st.board[i]];
      take(i);
    };
    const dupSupport = id => isSup(id) && st.board.includes(id);
    const bad = why => ({ illegal: why });
    if (op.type === 'build') {
      if (!known(op.id)) return bad('없는 건물'); if (!empty(op.tile)) return bad('빈 칸이 아니다'); if (dupSupport(op.id)) return bad('같은 지원 건물은 한 채');
      put(op.tile, fresh(op.id));
    } else if (op.type === 'overlap') {
      if (!isShop(op.id) || st.board[op.tile] !== op.id) return bad('같은 이름의 매장이 아니다'); if (st.stars[op.tile] >= c.stars.max) return bad('★이 가득 찼다');
      st.stars[op.tile] += 1;
    } else if (op.type === 'replace') {
      if (!known(op.id)) return bad('없는 건물'); if (empty(op.tile)) return bad('빈 칸이다'); if (st.board[op.tile] === op.id) return bad('같은 건물이다');
      demolish(op.tile); if (dupSupport(op.id)) return bad('같은 지원 건물은 한 채');
      put(op.tile, fresh(op.id));
    } else if (op.type === 'demolish') {
      if (empty(op.tile)) return bad('빈 칸이다'); demolish(op.tile);
    } else if (op.type === 'swap') {
      const a = take(op.a), b = take(op.b); put(op.a, b); put(op.b, a);
    } else if (op.type === 'insert') {
      if (op.id !== undefined) { if (!known(op.id)) return bad('없는 건물'); if (dupSupport(op.id)) return bad('같은 지원 건물은 한 채'); }
      else if (empty(op.from)) return bad('빈 칸이다');
      const b = op.id !== undefined ? null : take(op.from);   // 보드의 건물은 먼저 들어 올린다. 그 칸은 빈 칸이 된다
      let dL = -1, dR = -1;
      for (let k = 0; k < N && dR < 0; k++) if (empty(mod(op.gap + k, N))) dR = k;          // 가는 방향으로 가장 가까운 빈 칸
      for (let k = 0; k < N && dL < 0; k++) if (empty(mod(op.gap - 1 - k, N))) dL = k;      // 오는 방향으로 가장 가까운 빈 칸
      if (dR < 0) return bad('빈 칸이 없다');
      const b2 = b || fresh(op.id);
      if (dR <= dL) {   // 틈의 뒤쪽 건물들이 가는 방향으로 한 칸씩 밀린다. 거리가 같으면 이쪽이다
        for (let k = dR; k >= 1; k--) put(mod(op.gap + k, N), take(mod(op.gap + k - 1, N)));
        put(mod(op.gap, N), b2);
      } else {          // 틈의 앞쪽 건물들이 오는 방향으로 한 칸씩 밀린다
        for (let k = dL; k >= 1; k--) put(mod(op.gap - 1 - k, N), take(mod(op.gap - k, N)));
        put(mod(op.gap - 1, N), b2);
      }
    } else if (op.type === 'addTile') {
      if (op.pos < 1 || op.pos > N) return bad('끼워 넣을 수 없는 자리'); if (st.tiles.includes(op.special)) return bad('같은 특수 칸은 한 런에 한 번');
      st.board.splice(op.pos, 0, null); st.stars.splice(op.pos, 0, 0); st.grow.splice(op.pos, 0, 0); st.tiles.splice(op.pos, 0, op.special); st.kept.splice(op.pos, 0, 0);
    } else return bad('모르는 일');
    // 터줏자리에 남은 배율은 그 칸에 놓인 매장이 가져간다
    for (let i = 0; i < st.board.length; i++) if (st.kept[i] > 0 && isShop(st.board[i])) { st.grow[i] += st.kept[i]; st.kept[i] = 0; }
    return st;
  }

  // 웨이브가 끝났을 때(판정을 통과한 뒤) 보드에 일어나는 일. 순서: 대기업 사옥, 팝업 스토어.
  function endWave(st0, salesByTile) {
    const st = clone(st0), N = st.board.length, events = []; const isShop = i => !!st.board[i] && shops.has(st.board[i]);
    const typeOf = id => (id && supports.has(id) ? supports.get(id).effect.type : null);
    const hq = st.board.findIndex(b => typeOf(b) === 'merger');
    if (hq >= 0) {
      const a = mod(hq - 1, N), b = mod(hq + 1, N);
      if (a !== b && isShop(a) && isShop(b)) {
        // 매출이 높은 쪽이 남는다. 같으면 ★이 많은 쪽, 그것도 같으면 입구에서 먼저 나오는 쪽
        const lo = Math.min(a, b), hi = Math.max(a, b);
        const win = salesByTile[lo] !== salesByTile[hi] ? (salesByTile[lo] > salesByTile[hi] ? lo : hi) : st.stars[lo] !== st.stars[hi] ? (st.stars[lo] > st.stars[hi] ? lo : hi) : lo;
        const lose = win === lo ? hi : lo;
        if (st.stars[win] < c.stars.max) {   // 남는 쪽이 이미 ★★★이면 아무 일도 없다
          events.push({ type: 'merger', demolished: lose, shop: st.board[lose], starTo: win });
          if (st.tiles[lose] === 'old_site') st.kept[lose] += st.grow[lose];
          st.board[lose] = null; st.stars[lose] = 0; st.grow[lose] = 0; st.stars[win] += 1;
        }
      }
    }
    for (const id of Object.keys(st.timers)) {   // 팝업 스토어
      const p = st.board.indexOf(id); if (p < 0) continue;
      st.timers[id] -= 1;
      if (st.timers[id] <= 0) { st.board[p] = null; st.stars[p] = 0; st.grow[p] = 0; delete st.timers[id]; events.push({ type: 'gone', tile: p, id }); }
    }
    return { state: st, events };
  }

  // 정비를 시작할 때: 둘째 웨이브부터 고리의 끝에 빈 칸이 하나 생긴다.
  function startPrep(st0, waveNo) {
    const st = clone(st0);
    if (waveNo >= 2) for (let k = 0; k < c.tilesPerPrep; k++) { st.board.push(null); st.stars.push(0); st.grow.push(0); st.tiles.push(null); st.kept.push(0); }
    return st;
  }

  // 화면용: 이 칸의 지원 건물이 닿는 칸
  function reach(st, i) {
    const info = read(st), e = info.effAt[i]; if (!e) return [];
    if (e.type === 'grower') return (e.target === 'adj' ? info.near(i, 'adj') : e.target === 'prev' ? info.near(i, 'prev') : e.target === 'next' ? info.near(i, 'next') : info.shopTiles).filter(j => info.shopAt[j]);
    if (e.type === 'branch' || e.type === 'guestbook') return info.top === null ? [] : [info.top];
    if (e.type === 'roundabout') { const out = []; for (let k = Math.max(0, i - e.tiles); k < i; k++) out.push(k); return out; }
    if (e.type === 'shareKinds' || e.type === 'merger') { const a = info.prev(i), b = info.next(i); return a !== b && info.shopAt[a] && info.shopAt[b] ? [a, b] : []; }
    return [];
  }

  return { read, tastes, runDwarf, runWave, apply, endWave, startPrep, sends, guestReward, refreshCost, reach, clone,
    shop: id => shops.get(id), support: id => supports.get(id), building: id => shops.get(id) || supports.get(id), guest: id => guests.get(id), trait: id => traits.get(id) };
}

// 숫자를 화면에 적는 법
export const fmtNum = x => (Number.isInteger(x) ? String(x) : String(Math.round(x * 1000) / 1000));
// 배율(10을 곱한 정수)을 화면에 적는 법: 124 → "12.4", 10 → "1"
export const fmtMult = m10 => (m10 % 10 === 0 ? String(m10 / 10) : (m10 / 10).toFixed(1));

// 이용 기록 한 줄을 계산식 글자로. 예: "(4 + 허기 3 × 4) × 12.4 × 3(단골) × 3(귀빈) = 1785"
export function formulaText(ev, stackNames) {
  const terms = ev.terms.filter(t => t.count > 0).map(t => `${stackNames[t.stack]} ${t.count} × ${t.per}`);
  const sum = [fmtNum(ev.fee), ...terms].join(' + ');
  const mults = [];
  if (ev.mult10 !== 10) mults.push(fmtMult(ev.mult10));
  if (ev.fan !== 1) mults.push(`${ev.fan}(단골)`);
  if (ev.guestMult !== 1) mults.push(`${ev.guestMult}(귀빈)`);
  if (!mults.length) return terms.length ? `${sum} = ${ev.pay}` : `요금 ${ev.pay}`;
  const floored = ev.raw !== ev.pay ? ' (소수 버림)' : '';
  return `${terms.length ? `(${sum})` : sum} × ${mults.join(' × ')} = ${ev.pay}${floored}`;
}

// 허기와 포만감은 한 눈금이다. 양수면 허기, 음수면 포만감.
export const gaugeText = h => (h > 0 ? `허기 ${h}` : h < 0 ? `포만감 ${-h}` : '허기 0');
