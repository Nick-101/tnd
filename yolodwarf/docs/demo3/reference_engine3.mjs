// 욜로드워프 데모 3.0 참고 엔진 (2026-11-28)
// 기준은 욜로드워프_데모3_규칙.md다. 규칙 문서를 보고 새로 썼다. 화면, 난수, 후보 뽑기, 덱은 들어 있지 않다.
// 쓰는 법: node reference_engine3.mjs yolodwarf3_data.json yolodwarf3_testcases.json
//
// 상태(st): {
//   board: 0번 칸(입구)부터의 건물 id (빈 칸은 null),
//   stars: 칸마다의 ★ 수 (건물을 따라 움직인다),
//   grow:  칸마다 키운 배율. 0.1 단위의 정수다 (5면 +0.5). 건물을 따라 움직인다,
//   tiles: 칸마다의 특수 칸 id (보통 칸은 null). 칸은 움직이지 않는다,
//   kept:  터줏자리에 남은 배율 (0.1 단위의 정수),
//   timers: { popup_store: 남은 웨이브 수 }, money }
import { readFileSync } from 'node:fs';

export function index(data) {
  return { data, c: data.constants, shops: new Map(data.shops.map(s => [s.id, s])), supports: new Map(data.supports.map(s => [s.id, s])),
    guests: new Map(data.guests.map(g => [g.id, g])), traits: new Map(data.traits.map(t => [t.id, t])) };
}
const mod = (a, n) => ((a % n) + n) % n;
const clone = st => ({ ...st, board: [...st.board], stars: [...st.stars], grow: [...st.grow], tiles: [...st.tiles], kept: [...st.kept], timers: { ...st.timers } });

// 보드를 읽는다. 드워프를 보낼 때마다 다시 읽는다.
export function read(ix, st) {
  const { board, stars, grow, tiles } = st; const N = board.length; const c = ix.c;
  const shopAt = board.map(b => (b && ix.shops.get(b)) || null);
  const typeAt = board.map(b => (b && ix.supports.has(b) ? ix.supports.get(b).effect.type : null));
  const effAt = board.map(b => (b && ix.supports.has(b) ? ix.supports.get(b).effect : null));
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
  let likeAll = null;
  if (typeAt.includes('likeMost')) {
    let bestCount = 0, bestFirst = N;
    for (const k of c.kinds) {
      if (k === '휴식') continue;
      const t = shopTiles.filter(j => kindsAt[j].includes(k)); if (!t.length) continue;
      if (t.length > bestCount || (t.length === bestCount && t[0] < bestFirst)) { likeAll = k; bestCount = t.length; bestFirst = t[0]; }
    }
  }
  // 배율. 금싸라기 땅의 매장은 ★이 하나 더 있는 것으로 친다. 값은 10을 곱한 정수다 (124면 ×12.4).
  const starMult = j => Math.pow(c.stars.multPerStar, stars[j] + (tiles[j] === 'prime_land' ? 1 : 0));
  const mult10 = j => (10 + grow[j]) * starMult(j);
  // 배율이 가장 높은 매장. 같으면 요금이 높은 쪽, 그것도 같으면 입구에서 먼저 나오는 칸
  let top = null;
  for (const j of shopTiles) if (top === null || mult10(j) > mult10(top) || (mult10(j) === mult10(top) && shopAt[j].fee > shopAt[top].fee)) top = j;
  return { N, shopAt, typeAt, effAt, shopTiles, kindsAt, likeAll, near, starMult, top, has: t => typeAt.includes(t), at: t => typeAt.indexOf(t) };
}

// 드워프 한 마리를 보낸다. 상태를 바꾸지 않는다. 키운 배율은 결과의 grow로 돌려준다.
// dwarf: { likes, dislike, trait } 또는 귀빈 { likes, dislike: null, quirk, baseLaps?, firstLapCost?, guest: true }
// opt.first: 이 웨이브의 첫 드워프인가
export function runDwarf(ix, st, dwarf, opt = {}) {
  const c = ix.c, info = read(ix, st), N = info.N, tiles = st.tiles; const grow = [...st.grow];
  const trait = dwarf.trait ? ix.traits.get(dwarf.trait).effect : {};
  const quirk = dwarf.quirk || null;
  const start = trait.lapStart || {};
  const baseLaps = dwarf.baseLaps || trait.baseLaps || c.baseLaps;
  const payMult = dwarf.guest ? c.guests.payMult : 1;
  const fresh = () => ({ h: (start.hunger || 0) - (start.fullness || 0), d: start.tipsy || 0, y: start.hype || 0, tired: 0 });   // h: 양수는 허기, 음수는 포만감

  // 좋아하는 매장, 싫어하는 매장. 좋아하는 업종과 싫어하는 업종을 함께 가진 매장은 어느 쪽도 아니다. 단골 골목의 매장은 누구나 좋아한다.
  const likes = info.likeAll && !dwarf.likes.includes(info.likeAll) ? [...dwarf.likes, info.likeAll] : dwarf.likes;
  const liked = st.board.map(() => false), disliked = st.board.map(() => false);
  for (const j of info.shopTiles) {
    if (tiles[j] === 'regulars_alley') { liked[j] = true; continue; }
    const like = info.kindsAt[j].some(k => likes.includes(k)), dis = dwarf.dislike !== null && info.kindsAt[j].includes(dwarf.dislike);
    liked[j] = like && !dis; disliked[j] = dis && !like;
  }

  let s = fresh(), sat = 0, cost = dwarf.firstLapCost || c.extraLapCost.first, laps = 0, total = 0, uses = 0, fired = 0, dislikedThisLap = false;
  const sales = st.board.map(() => 0);
  const amount = name => name === 'hunger' ? Math.max(s.h, 0) : name === 'fullness' ? Math.max(-s.h, 0) : name === 'tipsy' ? s.d : name === 'hype' ? s.y : s.tired;
  const isShop = j => !!info.shopAt[j];
  // 지원 건물이 한 번 지나갈 때 발동하는 횟수: 역 앞이면 한 번 더, 수집가면 한 번 더
  const fires = i => 1 + (tiles[i] === 'station_front' ? 1 : 0) + (quirk === 'doubleSupports' ? 1 : 0);
  // 매장을 키운다. 프랜차이즈 본사가 있으면 같은 이름의 매장이 함께 자란다. 기름진 땅의 매장은 두 배로 자란다.
  const addGrow = (j, amt) => {
    const targets = info.has('franchise') ? info.shopTiles.filter(q => st.board[q] === st.board[j]) : [j];
    for (const q of targets) grow[q] += amt * (tiles[q] === 'fertile_land' ? 2 : 1);
  };

  // 매장 이용 한 번. 지나치면 null. 매출을 셈한 뒤에 스택을 소모하고, 그 뒤에 스택을 준다.
  const use = j => {
    const shop = info.shopAt[j];
    if (tiles[j] !== 'back_door') {
      if (shop.skip === 'drunk' && s.d >= c.thresholds.drunk) return null;
      if (shop.skip === 'full' && -s.h >= c.thresholds.full) return null;
      if (quirk === 'skipUnliked' && !liked[j]) return null;
    }
    let add = 0; for (const r of shop.read) add += r.per * amount(r.stack);
    const m = (10 + grow[j]) * info.starMult(j) * (shop.fanMult && liked[j] ? shop.fanMult : 1) * payMult;
    const pay = Math.floor((shop.fee + add) * m / 10);
    for (const r of shop.read) if (r.consume) { if (r.stack === 'fullness') { if (s.h < 0) s.h = 0; } else if (r.stack === 'tipsy') s.d = 0; else if (r.stack === 'hype') s.y = 0; }
    const bonus = tiles[j] === 'lucky_spot' ? 1 : 0, plus = x => (x > 0 ? x + bonus : 0), g = shop.give;
    s.h += plus(g.hunger) - (quirk === 'noFullness' ? 0 : plus(g.fullness)); s.d += plus(g.tipsy); s.y += plus(g.hype);
    return pay;
  };

  // 칸 하나를 지난다
  const visit = i => {
    if (isShop(i)) {
      const shop = info.shopAt[i], times = 1 + (tiles[i] === 'station_front' ? 1 : 0);
      for (let u = 0; u < times; u++) {
        const pay = use(i); if (pay === null) break;
        total += pay; sales[i] += pay; uses += 1;
        if (shop.rest) {   // 휴식: 피로를 만족도로 바꾼다. 한 번 지나갈 때 한 번만 바꾼다
          if (u === 0) { sat += Math.floor(s.tired / shop.rest.per) * shop.rest.gain; if (shop.rest.mode === 'consumePer') s.tired = 0; }
        } else if (liked[i]) s.tired += c.fatigue.perLikedUse * (quirk === 'doubleFatigue' ? 2 : 1);
        if (liked[i]) sat += c.satisfaction.like; else if (disliked[i]) { sat += c.satisfaction.dislike; dislikedThisLap = true; }
      }
      return;
    }
    const e = info.effAt[i]; if (!e) return;
    for (let f = 0; f < fires(i); f++) {
      if (e.type === 'branch') {   // 2호점: 배율이 가장 높은 매장을 이 칸에서 이용한다. 매출과 스택만 바뀐다
        if (info.top !== null) { const pay = use(info.top); if (pay !== null) { total += pay; sales[info.top] += pay; } }
      } else if (e.type === 'roundabout') {   // 회전교차로: 이전 칸들을 한 번 더 지난다. 입구 앞으로는 넘어가지 않는다
        for (let k = Math.max(0, i - e.tiles); k < i; k++) visit(k);
      } else if (e.type === 'pass') {   // 산책로, 버스킹 존
        for (const k of e.consume || []) { if (k === 'fullness') { if (s.h < 0) s.h = 0; } else if (k === 'tipsy') s.d = 0; else if (k === 'hype') s.y = 0; }
        if (e.convert) { const v = amount(e.convert.from); s.d = 0; s.y += v; }
        if (e.give) s.h += e.give.hunger || 0;
      } else if (e.type === 'grower') {
        const stacks3 = ['hunger', 'fullness', 'tipsy', 'hype', 'tired'].filter(k => amount(k) >= c.thresholds.nightMarket).length;
        const n = e.cond === 'any' ? 1 : e.cond === 'extraLap' ? +(laps >= baseLaps) : e.cond === 'first' ? +!!opt.first : e.cond === 'disliked' ? +dislikedThisLap
          : e.cond === 'stacks3' ? stacks3 : 1;   // likesPrev는 아래에서 매장마다 본다
        if (n === 0) continue;
        let targets = e.target === 'adj' ? info.near(i, 'adj') : e.target === 'prev' ? info.near(i, 'prev') : e.target === 'next' ? info.near(i, 'next')
          : e.target === 'all' ? info.shopTiles : info.shopTiles.filter(j => liked[j]);
        targets = targets.filter(isShop);
        if (e.cond === 'likesPrev') targets = targets.filter(j => liked[j]);
        for (const j of targets) addGrow(j, e.amount * n);
        if (targets.length) fired += 1;
      }
    }
  };

  for (;;) {
    for (let i = 0; i < N; i++) visit(i);
    laps += 1; dislikedThisLap = false;
    const kept = s; s = fresh();
    if (info.has('keepStack')) s.y += kept.y;          // 전광판: 흥은 바퀴를 넘어 남는다
    if (quirk === 'keepTipsy') s.d += kept.d;          // 술고래: 취기는 바퀴를 넘어 남는다
    if (laps >= baseLaps) { if (sat >= cost && laps < c.maxLaps) { sat -= cost; cost *= c.extraLapCost.multiplier; } else break; }
  }
  // 방명록: 떠날 때 남은 만족도 1당 배율이 가장 높은 매장이 자란다
  const gb = info.at('guestbook');
  if (gb >= 0 && sat > 0 && info.top !== null) addGrow(info.top, info.effAt[gb].amount * sat * fires(gb));
  return { sales: total, laps, extraLaps: laps - baseLaps, uses, fired, satLeft: sat, salesByTile: sales, grow, top: info.top };
}

// 이 웨이브에 드워프를 보내는 횟수. 버스 터미널이 있으면 한 번 더, 그것이 역 앞에 있으면 또 한 번 더.
export function sends(ix, st) {
  const i = st.board.indexOf('bus_terminal');
  return ix.c.sendsPerWave + (i >= 0 ? ix.supports.get('bus_terminal').effect.amount * (1 + (st.tiles[i] === 'station_front' ? 1 : 0)) : 0);
}
// 귀빈의 보상으로 나오는 특수 칸 후보의 수
export function guestReward(ix, waveNo, extraLaps) { return ix.c.guests.rewardWaves.includes(waveNo) ? Math.min(ix.c.guests.rewardMax, Math.max(0, extraLaps)) : 0; }
// 새로고침 비용: 그 웨이브의 처음 값에서 시작해 누를 때마다 두 배. presses: 이번 정비에서 지금까지 누른 횟수
export function refreshCost(ix, waveNo, presses) { return ix.data.waves[waveNo - 1].refreshBase * Math.pow(ix.c.refresh.multiplierPerPress, presses); }

// 웨이브 하나: 보낸 순서대로 드워프를 돌리고, 귀빈이 있으면 마지막에 돌린다. 키운 배율은 다음 드워프에게 이어진다.
export function runWave(ix, st, dwarves, guestId = null) {
  let cur = clone(st); const salesByTile = st.board.map(() => 0); const perDwarf = [];
  const one = (d, first) => {
    const r = runDwarf(ix, cur, d, { first }); cur.grow = r.grow; r.salesByTile.forEach((v, i) => { salesByTile[i] += v; });
    return { sales: r.sales, laps: r.laps, extraLaps: r.extraLaps, uses: r.uses, satLeft: r.satLeft, top: r.top };
  };
  dwarves.forEach((d, k) => perDwarf.push(one(d, k === 0)));
  const guest = guestId ? one({ ...ix.guests.get(guestId), guest: true }, false) : null;
  const info = read(ix, st);
  return { perDwarf, guest, waveSales: perDwarf.reduce((a, r) => a + r.sales, 0) + (guest ? guest.sales : 0), salesByTile, growAfter: cur.grow,
    kindsByTile: info.kindsAt, likeAll: info.likeAll };
}

// 보드에 손대는 일들. 새 상태를 돌려준다. 할 수 없는 일이면 { illegal: 까닭 }을 돌려준다.
// op: { type: 'build' | 'overlap' | 'replace', tile, id } | { type: 'demolish', tile } | { type: 'swap', a, b }
//   | { type: 'insert', gap, from } (보드의 건물을 틈에 끼워 넣는다) | { type: 'insert', gap, id } (손패의 카드를 틈에 끼워 넣는다)
//   | { type: 'addTile', pos, special } (귀빈의 보상: pos번 칸 자리에 새 특수 칸을 끼워 넣는다. pos는 1부터 칸 수까지)
// 틈 gap은 (gap − 1)번 칸과 gap번 칸의 사이다. 0은 마지막 칸과 0번 칸의 사이다.
export function apply(ix, st0, op) {
  const st = clone(st0), N = st.board.length; const isShop = id => ix.shops.has(id), isSup = id => ix.supports.has(id);
  const known = id => isShop(id) || isSup(id);
  const empty = i => st.board[i] === null;
  const put = (i, b) => { st.board[i] = b.id; st.stars[i] = b.stars; st.grow[i] = b.grow; };
  const take = i => { const b = { id: st.board[i], stars: st.stars[i], grow: st.grow[i] }; st.board[i] = null; st.stars[i] = 0; st.grow[i] = 0; return b; };
  const fresh = id => { if (id === 'popup_store') st.timers.popup_store = ix.supports.get(id).waves; return { id, stars: 0, grow: 0 }; };
  const demolish = i => {   // 터줏자리의 매장을 철거하면 키운 배율이 칸에 남는다
    if (isShop(st.board[i]) && st.tiles[i] === 'old_site') st.kept[i] += st.grow[i];
    if (st.board[i] === 'popup_store') delete st.timers.popup_store;
    take(i);
  };
  const dupSupport = id => isSup(id) && st.board.includes(id);
  const bad = why => ({ illegal: why });
  if (op.type === 'build') {
    if (!known(op.id)) return bad('없는 건물'); if (!empty(op.tile)) return bad('빈 칸이 아니다'); if (dupSupport(op.id)) return bad('같은 지원 건물은 한 채');
    put(op.tile, fresh(op.id));
  } else if (op.type === 'overlap') {
    if (!isShop(op.id) || st.board[op.tile] !== op.id) return bad('같은 이름의 매장이 아니다'); if (st.stars[op.tile] >= ix.c.stars.max) return bad('★이 가득 찼다');
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
// salesByTile: 방금 끝난 웨이브에 칸마다 들어온 매출
export function endWave(ix, st0, salesByTile) {
  const st = clone(st0), N = st.board.length, events = []; const isShop = i => !!st.board[i] && ix.shops.has(st.board[i]);
  const hq = st.board.indexOf('conglomerate_tower');
  if (hq >= 0) {
    const a = mod(hq - 1, N), b = mod(hq + 1, N);
    if (a !== b && isShop(a) && isShop(b)) {
      // 매출이 높은 쪽이 남는다. 같으면 ★이 많은 쪽, 그것도 같으면 입구에서 먼저 나오는 쪽
      const lo = Math.min(a, b), hi = Math.max(a, b);
      const win = salesByTile[lo] !== salesByTile[hi] ? (salesByTile[lo] > salesByTile[hi] ? lo : hi) : st.stars[lo] !== st.stars[hi] ? (st.stars[lo] > st.stars[hi] ? lo : hi) : lo;
      const lose = win === lo ? hi : lo;
      if (st.stars[win] < ix.c.stars.max) {   // 남는 쪽이 이미 ★★★이면 아무 일도 없다
        events.push({ type: 'merger', demolished: lose, shop: st.board[lose], starTo: win });
        if (st.tiles[lose] === 'old_site') st.kept[lose] += st.grow[lose];
        st.board[lose] = null; st.stars[lose] = 0; st.grow[lose] = 0; st.stars[win] += 1;
      }
    }
  }
  const p = st.board.indexOf('popup_store');
  if (p >= 0) { st.timers.popup_store -= 1; if (st.timers.popup_store <= 0) { st.board[p] = null; st.stars[p] = 0; st.grow[p] = 0; delete st.timers.popup_store; events.push({ type: 'gone', tile: p, id: 'popup_store' }); } }
  return { state: st, events };
}

// 정비를 시작할 때: 둘째 웨이브부터 고리의 끝에 빈 칸이 하나 생긴다.
export function startPrep(ix, st0, waveNo) {
  const st = clone(st0);
  if (waveNo >= 2) for (let k = 0; k < ix.c.tilesPerPrep; k++) { st.board.push(null); st.stars.push(0); st.grow.push(0); st.tiles.push(null); st.kept.push(0); }
  return st;
}

export function runCase(ix, cs) {
  if (cs.kind === 'wave') return runWave(ix, cs.state, cs.dwarves, cs.guest || null);
  if (cs.kind === 'ops') { let st = cs.state; const steps = []; for (const op of cs.ops) { const r = apply(ix, st, op); if (r.illegal) { steps.push('illegal'); } else { st = r; steps.push('ok'); } } return { steps, state: st }; }
  if (cs.kind === 'endWave') return endWave(ix, cs.state, cs.salesByTile);
  if (cs.kind === 'startPrep') return startPrep(ix, cs.state, cs.waveNo);
  if (cs.kind === 'counts') return { sends: sends(ix, cs.state), reward: guestReward(ix, cs.waveNo, cs.extraLaps), refresh: refreshCost(ix, cs.waveNo, cs.presses) };
  throw new Error('모르는 사례: ' + cs.kind);
}

if (process.argv[1] && process.argv[1].endsWith('reference_engine3.mjs') && process.argv.length >= 4) {
  const ix = index(JSON.parse(readFileSync(process.argv[2], 'utf8'))); const tc = JSON.parse(readFileSync(process.argv[3], 'utf8'));
  let pass = 0; const bad = [];
  for (const cs of tc.cases) {
    const got = runCase(ix, cs);
    if (JSON.stringify(got) === JSON.stringify(cs.expected)) pass++; else bad.push({ id: cs.id, group: cs.group, note: cs.note, got, expected: cs.expected });
  }
  console.log(`통과 ${pass} / ${tc.cases.length}`);
  for (const b of bad.slice(0, 6)) {
    const keys = Object.keys(b.expected).filter(k => JSON.stringify(b.got[k]) !== JSON.stringify(b.expected[k]));
    console.log(b.id, b.group, b.note, '다른 곳:', keys.join(', '));
    for (const k of keys.slice(0, 2)) console.log('   ', k, '\n      엔진  ', JSON.stringify(b.got[k]), '\n      기대값', JSON.stringify(b.expected[k]));
  }
  if (bad.length) { console.log('다른 사례의 묶음', JSON.stringify(bad.reduce((a, b) => (a[b.group] = (a[b.group] || 0) + 1, a), {}))); process.exit(1); }
}
