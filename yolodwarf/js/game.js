// 한 런의 진행 (데모 3.0 규칙 문서의 1~4절, 11절). DOM을 쓰지 않는다. 계산과 보드에 손대는 일은 engine.js에 맡긴다.
// 단계(phase): intro → prep(정비) → pick(드워프 고르기) … → guest(귀빈이 돌 차례) → judge(판정) → reward(귀빈의 보상) → prep … → over
// 인기 업종과 비인기 업종(덱의 색)은 넣지 않았다(사용자 요청). 덱은 90마리에서 고르게 뽑는다.
import { makeEngine } from './engine.js';
import { makeRng } from './rng.js';

export function createGame(data, { seed, targetMult = 1, traits = true, supportRate = null, disabled = [], forced = [], guestPicks = [], startSpecial = null, alwaysThree = false } = {}) {
  const c = data.constants, H = c.hand;
  const engine = makeEngine(data);
  const isShop = id => !!engine.shop(id);
  const typeOf = id => (id && engine.support(id) ? engine.support(id).effect.type : null);
  const nameOf = id => engine.building(id).name;
  const candRng = makeRng(`${seed}/candidates`);   // 후보, 드워프, 시작, 보상은 서로 다른 수열을 쓴다
  const rate = supportRate == null ? c.candidateRates.support : supportRate;
  const N0 = data.waves[0].tiles;

  const s = {
    seed: String(seed),
    options: { targetMult, traits, supportRate: rate, disabled: [...disabled], forced: forced.slice(0, 2), guestPicks: [...guestPicks], startSpecial, alwaysThree },
    phase: 'intro',
    wave: 0,                                   // 0부터. 화면에는 +1
    st: { board: new Array(N0).fill(null), stars: new Array(N0).fill(0), grow: new Array(N0).fill(0), tiles: new Array(N0).fill(null), kept: new Array(N0).fill(0), timers: {}, money: c.startMoney },
    uid: new Array(N0).fill(0), nextUid: 1,     // 건물마다의 표. 건물을 따라 움직인다(웨이브의 매출을 건물에 적어 두려고)
    newTiles: [],
    hand: [],                                  // 손패: 건물 id들
    candidates: new Array(H.candidates).fill(null),   // { id, built } 또는 null(골랐거나 없음)
    picksLeft: 0, refreshPresses: 0,
    deck: [], guests: [],                      // guests: 귀빈 웨이브 차례대로의 귀빈 id
    start: { tile: null, special: null },
    hand3: [], order: [], orderPos: 0, sendIndex: 0,
    waveSales: 0, waveSends: [], salesByUid: {}, guestRun: null,
    results: [], log: [],
    bestPay: null, maxLaps: 0,
    judge: null, outcome: null,
  };
  const targetOf = wave => Math.ceil(data.waves[wave].target * s.options.targetMult);
  const target = () => targetOf(s.wave);
  const noteLog = () => s.log[s.wave];
  const guestWaveIndex = () => c.guests.waves.indexOf(s.wave + 1);
  const guestOfWave = (w = s.wave) => { const k = c.guests.waves.indexOf(w + 1); return k >= 0 && s.guests[k] ? engine.guest(s.guests[k]) : null; };

  // ── 런을 시작할 때: 덱, 귀빈 셋, 시작 보드의 특수 칸, 시작 손패 ──
  function setup() {
    const rng = makeRng(`${s.seed}/deck`), dk = c.deck;
    s.deck = rng.shuffle(data.dwarves).slice(0, dk.size).map(d => ({ ...d, trait: null }));   // 90마리에서 고르게 30마리
    if (s.options.traits) {
      const lucky = rng.shuffle(s.deck.map((_, i) => i)).slice(0, dk.traitsEach * data.traits.length);
      lucky.forEach((di, n) => { s.deck[di].trait = data.traits[n % data.traits.length].id; });
    }
    const r2 = makeRng(`${s.seed}/start`);
    // 귀빈: 여섯 가운데 셋(서로 다르다). 시험용 스위치로 정한 자리는 그대로 둔다
    const all = (data.guests || []).map(g => g.id), chosen = c.guests.waves.map((_, k) => (all.includes(s.options.guestPicks[k]) ? s.options.guestPicks[k] : null));
    const rest = r2.shuffle(all.filter(id => !chosen.includes(id)));
    s.guests = chosen.map(id => id || rest.shift() || null);
    // 시작 보드의 특수 칸: 칸과 종류 모두 무작위
    const specials = (data.specialTiles || []).map(x => x.id);
    for (let k = 0; k < (specials.length ? c.specialTiles.atStart : 0); k++) {
      const special = specials.includes(s.options.startSpecial) ? s.options.startSpecial : specials[r2.int(specials.length)];
      const tile = r2.int(N0);
      s.st.tiles[tile] = special; s.start = { tile, special };
    }
    // 시작 손패: 매장 3장과 지원 건물 1장
    for (let k = 0; k < H.startShops; k++) s.hand.push(data.shops[r2.int(data.shops.length)].id);
    for (let k = 0; k < H.startSupports; k++) {
      const pool = data.supports.filter(x => !s.options.disabled.includes(x.id) && !s.hand.includes(x.id));
      s.hand.push((pool.length ? pool : data.shops)[r2.int((pool.length ? pool : data.shops).length)].id);
    }
  }

  // ── 보드에 손대는 일. 엔진의 apply로 하고, 건물의 표(uid)도 같은 일로 함께 옮긴다 ──
  function applyOp(op) {
    const r = engine.apply(s.st, op);
    if (r.illegal) return r;
    const n = s.st.board.length;
    const shadow = engine.apply({ board: s.st.board, stars: new Array(n).fill(0), grow: s.uid, tiles: new Array(n).fill(null), kept: new Array(n).fill(0), timers: {}, money: 0 }, op);
    s.uid = shadow.grow.map((u, i) => (r.board[i] === null ? 0 : u || s.nextUid++));   // 새로 선 건물은 새 표를 받는다
    s.st = r;
    return r;
  }
  const preview = op => engine.apply(s.st, op);
  // 카드를 칸에 놓으면 무슨 일이 되는가: 빈 칸이면 짓기, 같은 이름의 매장이면 겹치기, 다른 건물이면 바꿔 짓기
  const cardOp = (id, tile) => (s.st.board[tile] === null ? { type: 'build', tile, id } : s.st.board[tile] === id && isShop(id) ? { type: 'overlap', tile, id } : { type: 'replace', tile, id });

  // ── 후보 (3.1절) ──
  function supportAllowed(x, taken) { return !s.options.disabled.includes(x.id) && !taken.has(x.id); }
  function drawCandidates(slots, forcedIds = []) {
    const taken = new Set([...s.st.board.filter(b => b && !isShop(b)), ...s.hand.filter(id => !isShop(id))]);
    s.candidates.forEach((cd, i) => { if (cd && !slots.includes(i) && !isShop(cd.id)) taken.add(cd.id); });
    const queue = forcedIds.filter(id => engine.support(id) && supportAllowed(engine.support(id), taken));
    const builtShops = s.st.board.filter(b => b && isShop(b));
    for (const i of slots) {
      let pick, built = false;
      if (queue.length) pick = engine.support(queue.shift());
      else if (i === 0 && s.wave + 1 >= H.builtShopCandidateFromPrep && builtShops.length) { pick = engine.shop(builtShops[candRng.int(builtShops.length)]); built = true; }   // 첫 장은 보드에 지은 매장
      else {
        const pool = candRng.rand() < s.options.supportRate ? data.supports.filter(x => supportAllowed(x, taken)) : [];
        const from = pool.length ? pool : data.shops;
        pick = from[candRng.int(from.length)];
      }
      s.candidates[i] = { id: pick.id, built };
      if (!isShop(pick.id)) taken.add(pick.id);
      noteLog().offered.push(pick.id);
    }
  }
  const openSlots = () => s.candidates.map((cd, i) => (cd && cd.picked ? -1 : i)).filter(i => i >= 0);

  function enterPrep() {
    s.phase = 'prep'; s.judge = null; s.guestRun = null;
    s.log[s.wave] = { offered: [], picked: [], used: [], demolished: [], refreshes: 0, reward: null };
    const before = s.st.board.length;
    s.st = engine.startPrep(s.st, s.wave + 1);             // 둘째 웨이브부터 고리의 끝에 빈 칸 하나
    s.newTiles = []; while (s.uid.length < s.st.board.length) { s.newTiles.push(s.uid.length); s.uid.push(0); }
    void before;
    s.picksLeft = H.picksPerPrep; s.refreshPresses = 0;
    s.candidates = new Array(H.candidates).fill(null);
    drawCandidates(s.candidates.map((_, i) => i), s.wave === 0 ? s.options.forced : []);
  }

  const refreshCost = () => engine.refreshCost(s.wave + 1, s.refreshPresses);
  const canRefresh = () => s.phase === 'prep' && s.picksLeft > 0 && s.st.money >= refreshCost() && openSlots().length > 0;
  const canMove = () => s.phase === 'prep' || s.phase === 'pick';
  const sendsNow = () => engine.sends(s.st);   // 보낼 횟수는 드워프를 보낼 때마다 다시 센다

  function nextHand(returning) {
    const take = c.offerSize - (returning ? 1 : 0);
    const drawn = s.order.slice(s.orderPos, s.orderPos + take).map(i => s.deck[i]);
    s.orderPos += take;
    s.hand3 = returning ? [returning, ...drawn] : drawn;
  }

  // 드워프나 귀빈 한 마리의 결과를 상태에 넣는다
  function commitRun(r, who) {
    const out = { ...r, dwarf: who, wave: s.wave, sendIndex: s.sendIndex, sends: sendsNow(), offer: s.hand3.slice(), target: target(), growBefore: [...s.st.grow],
      moneyBefore: s.st.money, waveSalesBefore: s.waveSales, bestPayBefore: s.bestPay ? s.bestPay.pay : 0 };
    s.st = { ...s.st, grow: r.grow, money: s.st.money + r.sales };
    s.waveSales += r.sales;
    r.salesByTile.forEach((v, i) => { if (v) s.salesByUid[s.uid[i]] = (s.salesByUid[s.uid[i]] || 0) + v; });   // 2호점에서 올린 것도 그 매장의 매출이다
    if (r.laps > s.maxLaps) s.maxLaps = r.laps;
    if (r.bestPay > (s.bestPay ? s.bestPay.pay : 0)) s.bestPay = { pay: r.bestPay, dwarf: who.name, wave: s.wave };
    return out;
  }

  // 웨이브의 끝 (11절): 판정 → 대기업 사옥 → 팝업 스토어 → 귀빈의 보상
  function finishWave() {
    const t = target(), passed = s.st.money >= t, cleared = passed && s.wave === data.waves.length - 1;
    s.judge = { passed, cleared, money: s.st.money, target: t, ratio: s.st.money / t, events: [], reward: null };
    s.results.push({ wave: s.wave, sales: s.waveSales, moneyAfter: s.st.money, target: t, passed, sends: s.waveSends, guest: s.guestRun });
    if (passed && !cleared) {
      const r = engine.endWave(s.st, s.st.board.map((_, i) => s.salesByUid[s.uid[i]] || 0));
      for (const e of r.events) {
        if (e.type === 'merger') { s.judge.events.push({ type: 'merger', demolished: nameOf(e.shop), kept: nameOf(r.state.board[e.starTo]), tile: e.demolished, starTo: e.starTo }); noteLog().demolished.push(`${nameOf(e.shop)}(대기업 사옥)`); }
        else s.judge.events.push({ type: 'gone', name: nameOf(e.id), tile: e.tile });
      }
      s.st = r.state; s.uid = s.uid.map((u, i) => (s.st.board[i] === null ? 0 : u));
      // 귀빈의 보상: 추가 바퀴 수만큼(셋까지) 아직 보드에 없는 특수 칸 가운데서
      const waveNo = s.wave + 1;
      if (c.guests.rewardWaves.includes(waveNo) && s.guestRun) {
        const count = s.options.alwaysThree ? c.guests.rewardMax : engine.guestReward(waveNo, s.guestRun.extraLaps);
        const pool = makeRng(`${s.seed}/reward/${s.wave}`).shuffle((data.specialTiles || []).map(x => x.id).filter(id => !s.st.tiles.includes(id)));
        s.judge.reward = { count, offer: pool.slice(0, count) };
        noteLog().reward = { offer: s.judge.reward.offer.slice(), chosen: null, pos: null };
      }
    }
    s.hand3 = [];
    s.phase = 'judge';
  }

  const api = {
    state: s, data, engine, c,
    target, targetOf, refreshCost, canRefresh, canMove, sendsNow, preview, cardOp, guestOfWave,
    info: () => engine.read(s.st),
    isGuestWave: () => guestWaveIndex() >= 0 && !!guestOfWave(),

    begin() { if (s.phase !== 'intro') return false; enterPrep(); return true; },

    // 후보에서 고른다. 한 정비에 2장까지
    pick(slot) {
      const cd = s.candidates[slot];
      if (s.phase !== 'prep' || !cd || cd.picked || s.picksLeft <= 0) return false;
      s.hand.push(cd.id); cd.picked = true; s.picksLeft -= 1;
      noteLog().picked.push(cd.id);
      return true;
    },

    // 새로고침: 아직 고르지 않은 후보를 모두 다시 뽑는다. 고른 수는 그대로다
    refresh() {
      if (!canRefresh()) return false;
      s.st = { ...s.st, money: s.st.money - refreshCost() };
      s.refreshPresses += 1; noteLog().refreshes += 1;
      drawCandidates(openSlots());
      return true;
    },

    // 손패의 카드를 쓴다. target: { tile } (짓기, 겹치기, 바꿔 짓기) 또는 { gap } (끼워 넣기). 할 수 없으면 { illegal }
    playCard(h, where) {
      const id = s.hand[h];
      if (s.phase !== 'prep' || id == null) return { illegal: '지금은 쓸 수 없다' };
      const op = where.gap != null ? { type: 'insert', gap: where.gap, id } : cardOp(id, where.tile);
      const was = op.type === 'replace' ? s.st.board[op.tile] : null;
      const r = applyOp(op);
      if (r.illegal) return r;
      s.hand.splice(h, 1);
      const verb = { build: '짓기', overlap: '겹치기', replace: '바꿔 짓기', insert: '끼워 넣기' }[op.type];
      noteLog().used.push(`${verb} ${nameOf(id)}${op.type === 'insert' ? `(틈 ${op.gap})` : `(${op.tile}번${was ? `, ${nameOf(was)} 철거` : ''})`}`);
      if (was) noteLog().demolished.push(nameOf(was));
      return { ok: true, op };
    },

    discard(h) {
      if (s.phase !== 'prep' || s.hand[h] == null) return false;
      noteLog().used.push(`버리기 ${nameOf(s.hand[h])}`);
      s.hand.splice(h, 1);
      return true;
    },

    // 보드의 건물: 자리 바꾸기, 끼워 넣기(옮기기), 철거. 정비 때와 드워프를 고르기 전에 할 수 있다
    swap(a, b) { if (!canMove() || a === b || (s.st.board[a] === null && s.st.board[b] === null)) return false; return !applyOp({ type: 'swap', a, b }).illegal; },
    insertFrom(from, gap) { if (!canMove()) return false; return !applyOp({ type: 'insert', gap, from }).illegal; },
    demolish(tile) {
      if (!canMove() || s.st.board[tile] === null) return false;
      const id = s.st.board[tile];
      if (applyOp({ type: 'demolish', tile }).illegal) return false;
      noteLog().demolished.push(nameOf(id));
      return true;
    },

    // 정비를 마친다. 손패는 2장까지 남긴다
    startWave() {
      if (s.phase !== 'prep' || s.hand.length > H.keep) return false;
      s.phase = 'pick';
      s.order = makeRng(`${s.seed}/dwarves/${s.wave}`).shuffle(s.deck.map((_, i) => i));
      s.orderPos = 0; s.sendIndex = 0; s.waveSales = 0; s.waveSends = []; s.salesByUid = {}; s.guestRun = null;
      nextHand(null);
      return true;
    },

    // 시험용: 지금 보드에서 이 드워프를 보내면 매출이 얼마인가. 상태를 바꾸지 않는다(배율을 키우지 않는다)
    previewSend(choice) {
      const r = engine.runDwarf(s.st, s.hand3[choice], { first: s.sendIndex === 0, events: false });
      return { sales: r.sales, laps: r.laps };
    },

    // 드워프를 보낸다. 결과(기록 포함)를 돌려주고 상태를 진행한다. 화면은 기록을 재생만 한다
    send(choice) {
      const dwarf = s.hand3[choice];
      if (s.phase !== 'pick' || !dwarf) return null;
      const r = engine.runDwarf(s.st, dwarf, { first: s.sendIndex === 0 });   // 웨이브의 첫 드워프는 처음 보낸 드워프다
      const out = commitRun(r, dwarf);
      s.waveSends.push({ name: dwarf.name, sales: r.sales, laps: r.laps });
      s.sendIndex += 1;
      if (s.sendIndex < sendsNow()) nextHand(s.st.board.some(b => typeOf(b) === 'returnDwarf') ? dwarf : null);   // 쿠폰 가판대
      else if (api.isGuestWave()) { s.hand3 = []; s.phase = 'guest'; }   // 드워프를 다 보낸 뒤에 귀빈이 마지막으로 돈다
      else finishWave();
      return out;
    },

    // 귀빈이 돈다. 고르는 것이 아니다. 웨이브의 첫 드워프로 치지 않는다
    runGuest() {
      if (s.phase !== 'guest') return null;
      const g = { ...guestOfWave(), guest: true };
      const r = engine.runDwarf(s.st, g, { first: false });
      const out = commitRun(r, g);
      s.guestRun = { id: g.id, name: g.name, sales: r.sales, laps: r.laps, extraLaps: r.extraLaps };
      finishWave();
      return out;
    },

    // 판정 뒤: 모자라거나 클리어면 끝. 보상이 있으면 보상을 고르고, 없으면 다음 정비
    proceed() {
      if (s.phase !== 'judge') return false;
      const j = s.judge;
      if (!j.passed || j.cleared) { s.outcome = j.cleared ? 'clear' : 'fail'; s.phase = 'over'; }
      else if (j.reward && j.reward.offer.length) s.phase = 'reward';
      else { s.wave += 1; enterPrep(); }
      return true;
    },

    // 귀빈의 보상: 특수 칸 하나를 골라 틈에 끼워 넣는다. pos는 1부터 칸 수까지(칸 수면 마지막 칸의 뒤)
    previewReward(special, pos) { return engine.apply(s.st, { type: 'addTile', pos, special }); },
    chooseReward(special, pos) {
      if (s.phase !== 'reward' || !s.judge.reward.offer.includes(special)) return false;
      if (applyOp({ type: 'addTile', pos, special }).illegal) return false;
      Object.assign(noteLog().reward, { chosen: special, pos });
      s.wave += 1; enterPrep();
      return true;
    },
  };
  setup();
  return api;
}
