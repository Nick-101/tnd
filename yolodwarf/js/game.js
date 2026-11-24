// 한 런의 진행 (규칙 문서 v3의 3, 5, 10, 11, 12절). DOM을 쓰지 않는다. 계산은 engine.js에 맡긴다.
// 단계(phase): stage(스테이지 시작) → prep(정비) → pick(웨이브: 드워프 고르기) ×3 → judge(판정) → prep … → stage … → over
import { makeEngine } from './engine.js';
import { makeRng } from './rng.js';

export function createGame(data, { seed, targetMult = 1, startStage = 1, traits = true, deckColor = true } = {}) {
  const c = data.constants;
  const engine = makeEngine(data);
  const isShop = id => !!engine.shop(id);
  const candRng = makeRng(`${seed}/candidates`);   // 후보와 드워프는 서로 다른 수열을 쓴다
  // 아무도 싫어하지 않는 업종(식당)은 비인기 업종이 되지 않는다 (5.2절)
  const neverDisliked = data.tasteKinds.filter(k => !data.dwarves.some(d => d.dislike === k));

  const s = {
    seed: String(seed),
    options: { targetMult, startStage, traits, deckColor },
    phase: 'stage',
    stage: startStage - 1, wave: 0,            // 0부터. 화면에는 +1
    money: c.startMoney,
    board: [],                                 // 칸마다 null 또는 { id, stars, lastSales, waveSales }. lastSales가 null이면 이번 정비에 지은 건물
    candidates: [],                            // { id, locked } 또는 null
    buildsLeft: 0, upgradesLeft: 0, refreshPresses: 0,
    deck: [], popular: [], unpopular: [],
    hand: [], order: [], sendIndex: 0,
    g: 0,                                      // 이 웨이브에서 성장 지원이 자란 횟수(추가 바퀴 수)
    waveSales: 0, waveSends: [],
    results: [],                               // 웨이브마다 { stage, wave, sales, moneyAfter, target, passed, sends }
    bestPay: null,                             // 한 번에 올린 최고 매출 { pay, shop, dwarf }
    maxLaps: 0,
    judge: null, outcome: null,                // outcome: 'clear' | 'fail'
  };
  const stageDef = (i = s.stage) => data.stages[i];
  const targetOf = (stage, wave) => Math.ceil(data.stages[stage].targets[wave] * s.options.targetMult);
  const target = () => targetOf(s.stage, s.wave);
  if (startStage > 1) s.money = targetOf(startStage - 2, c.wavesPerStage - 1);   // 시험용: 앞 스테이지의 마지막 목표만큼으로 시작

  const ids = () => s.board.map(b => (b ? b.id : null));
  const levels = () => s.board.map(b => (b ? b.stars : 0));
  const prep = () => engine.prep(ids(), levels());

  // 5.2 스테이지의 덱: 90마리에서 30마리, 덱의 색, 특성
  function buildDeck() {
    const rng = makeRng(`${s.seed}/deck/${s.stage}`), dk = c.deck, w = dk.weights;
    s.popular = []; s.unpopular = [];
    if (s.options.deckColor) {
      s.popular = rng.shuffle(data.tasteKinds).slice(0, dk.popularKinds);
      s.unpopular = rng.shuffle(data.tasteKinds.filter(k => !s.popular.includes(k) && !neverDisliked.includes(k))).slice(0, dk.unpopularKinds);
    }
    const weight = d => {
      let x = 1;
      for (const k of d.likes) { if (s.popular.includes(k)) x *= w.likePopular; if (s.unpopular.includes(k)) x *= w.likeUnpopular; }
      if (s.unpopular.includes(d.dislike)) x *= w.dislikeUnpopular;
      if (s.popular.includes(d.dislike)) x *= w.dislikePopular;
      return x;
    };
    const pool = data.dwarves.slice(), deck = [];
    while (deck.length < dk.size && pool.length) { const d = rng.weighted(pool, weight); pool.splice(pool.indexOf(d), 1); deck.push({ ...d, trait: null }); }
    if (s.options.traits) {
      const lucky = rng.shuffle(deck.map((_, i) => i)).slice(0, dk.traitsEach * data.traits.length);
      lucky.forEach((di, n) => { deck[di].trait = data.traits[n % data.traits.length].id; });
    }
    s.deck = deck;
  }

  // 3.3 후보 한 장: 묶음(매장/일반/고급/희귀)을 확률로 뽑고, 그 안에서 고르게. 보드와 후보에 있는 지원 건물은 빼고, 빈 묶음이면 묶음부터 다시.
  function fillSlots(slots) {
    const taken = new Set(s.board.filter(b => b && !isShop(b.id)).map(b => b.id));
    s.candidates.forEach((cd, i) => { if (cd && !slots.includes(i) && !isShop(cd.id)) taken.add(cd.id); });
    const buckets = Object.entries(c.candidateRates);
    for (const i of slots) {
      let pick = null;
      for (let guard = 0; guard < 1000 && !pick; guard++) {
        const [bucket] = candRng.weighted(buckets, b => b[1]);
        const pool = bucket === 'shop' ? data.shops : data.supports.filter(x => x.grade === bucket && !taken.has(x.id));
        if (pool.length) pick = pool[candRng.int(pool.length)];
      }
      s.candidates[i] = { id: pick.id, locked: false };
      if (!isShop(pick.id)) taken.add(pick.id);
    }
  }
  const unlockedSlots = () => s.candidates.map((cd, i) => (cd && cd.locked ? -1 : i)).filter(i => i >= 0);

  function enterStage() {
    const def = stageDef();
    s.phase = 'stage'; s.wave = 0;
    s.board = new Array(def.tiles).fill(null);         // 보드, ★, 잠근 후보가 모두 사라진다. 자금은 그대로
    s.candidates = new Array(def.candidates).fill(null);
    s.refreshPresses = 0;
    s.judge = null;
    buildDeck();
  }
  function enterPrep() {
    s.phase = 'prep';
    s.buildsLeft = stageDef().buildsPerPrep;
    s.upgradesLeft = c.upgrade.perPrep;
    s.judge = null;
    fillSlots(unlockedSlots());                        // 잠근 후보만 남고 나머지는 새로 뽑는다
  }

  const refreshCost = () => engine.refreshCost(s.stage + 1, s.refreshPresses);
  const canRefresh = () => s.phase === 'prep' && s.money >= refreshCost() && unlockedSlots().length > 0;
  const canMove = () => s.phase === 'prep' || s.phase === 'pick';

  // 업그레이드를 할 수 있는가. 안 되면 까닭: support | new | once | max | money
  function upgradeInfo(tile) {
    const b = s.board[tile];
    if (!b || s.phase !== 'prep') return { ok: false, reason: 'phase' };
    if (!isShop(b.id)) return { ok: false, reason: 'support' };
    if (b.stars >= c.upgrade.maxStars) return { ok: false, reason: 'max' };
    if (b.lastSales == null) return { ok: false, reason: 'new' };
    const cost = engine.upgradeCost(b.lastSales);
    if (s.upgradesLeft <= 0) return { ok: false, reason: 'once', cost };
    if (s.money < cost) return { ok: false, reason: 'money', cost };
    return { ok: true, cost };
  }

  const api = {
    state: s, data, engine, c,
    target, targetOf, stageDef, prep, refreshCost, canRefresh, canMove, upgradeInfo,

    begin() { if (s.phase !== 'stage') return false; enterPrep(); return true; },

    build(slot, tile) {
      const cd = s.candidates[slot];
      if (s.phase !== 'prep' || !cd || s.buildsLeft <= 0 || tile == null || s.board[tile] !== null) return false;
      if (!isShop(cd.id) && s.board.some(b => b && b.id === cd.id)) return false;   // 같은 지원 건물은 한 채만
      s.board[tile] = { id: cd.id, stars: 0, lastSales: null, waveSales: 0 };
      s.candidates[slot] = null;
      s.buildsLeft -= 1;
      return true;
    },

    // 자리 바꾸기: 빈 칸으로 옮기거나 두 건물의 자리를 바꾼다. ★과 매출 기록은 건물을 따라간다.
    move(from, to) {
      if (!canMove() || from === to || !s.board[from] || to == null || to < 0 || to >= s.board.length) return false;
      [s.board[from], s.board[to]] = [s.board[to], s.board[from]];
      return true;
    },

    // 철거: 무료. 자금도 건설 횟수도 돌아오지 않는다. ★도 사라진다.
    demolish(tile) {
      if (s.phase !== 'prep' || !s.board[tile]) return false;
      s.board[tile] = null;
      return true;
    },

    upgrade(tile) {
      const u = upgradeInfo(tile);
      if (!u.ok) return false;
      s.money -= u.cost; s.upgradesLeft -= 1; s.board[tile].stars += 1;
      return true;
    },

    toggleLock(slot) {
      const cd = s.candidates[slot];
      if (s.phase !== 'prep' || !cd) return false;
      cd.locked = !cd.locked;
      return true;
    },

    refresh() {
      if (!canRefresh()) return false;
      s.money -= refreshCost();
      s.refreshPresses += 1;                           // 스테이지 동안 내려가지 않는다
      fillSlots(unlockedSlots());
      return true;
    },

    startWave() {
      if (s.phase !== 'prep') return false;
      s.phase = 'pick';
      s.order = makeRng(`${s.seed}/dwarves/${s.stage}/${s.wave}`).shuffle(s.deck.map((_, i) => i));
      s.sendIndex = 0; s.g = 0; s.waveSales = 0; s.waveSends = [];   // 지난 웨이브에서 자란 것은 처음으로
      for (const b of s.board) if (b) b.waveSales = 0;
      s.hand = s.order.slice(0, c.handSize).map(i => s.deck[i]);
      return true;
    },

    // 시험용: 지금 보드에서 이 드워프를 보내면 매출이 얼마인가.
    preview(choice) {
      const r = engine.runDwarf(prep(), s.hand[choice], s.g, null, { events: false });
      return { sales: r.sales, laps: r.laps };
    },

    // 드워프를 보낸다. 결과(기록 포함)를 돌려주고 상태를 끝까지 진행한다. 화면은 기록을 재생만 한다.
    send(choice) {
      const dwarf = s.hand[choice];
      if (s.phase !== 'pick' || !dwarf) return null;
      const info = prep(), sales = s.board.map(() => 0);
      const r = engine.runDwarf(info, dwarf, s.g, sales);
      const out = { ...r, dwarf, info, stage: s.stage, wave: s.wave, sendIndex: s.sendIndex, hand: s.hand.slice(), target: target(),
        moneyBefore: s.money, waveSalesBefore: s.waveSales, bestPayBefore: s.bestPay ? s.bestPay.pay : 0 };
      s.money += r.sales; s.g += r.extraLaps; s.waveSales += r.sales;
      sales.forEach((v, i) => { if (s.board[i]) s.board[i].waveSales += v; });   // 2호점에서 올린 것은 본점의 기록에
      s.waveSends.push({ name: dwarf.name, sales: r.sales, laps: r.laps });
      if (r.laps > s.maxLaps) s.maxLaps = r.laps;
      if (r.bestPay > (s.bestPay ? s.bestPay.pay : 0)) s.bestPay = { pay: r.bestPay, dwarf: dwarf.name, stage: s.stage, wave: s.wave };
      s.sendIndex += 1;
      if (s.sendIndex < c.sendsPerWave) s.hand = s.order.slice(s.sendIndex * c.handSize, (s.sendIndex + 1) * c.handSize).map(i => s.deck[i]);
      else {
        const t = target(), passed = s.money >= t;
        const lastWave = s.wave === c.wavesPerStage - 1, lastStage = s.stage === data.stages.length - 1;
        for (const b of s.board) if (b) b.lastSales = b.waveSales;   // 다음 정비의 업그레이드 비용에 쓴다
        s.judge = { passed, money: s.money, target: t, ratio: s.money / t, stageDone: passed && lastWave, cleared: passed && lastWave && lastStage };
        s.results.push({ stage: s.stage, wave: s.wave, sales: s.waveSales, moneyAfter: s.money, target: t, passed, sends: s.waveSends });
        s.hand = [];
        s.phase = 'judge';
      }
      return out;
    },

    // 판정 뒤: 통과면 다음 정비나 다음 스테이지, 다섯째 스테이지를 통과했거나 모자라면 끝.
    proceed() {
      if (s.phase !== 'judge') return false;
      const j = s.judge;
      if (!j.passed || j.cleared) { s.outcome = j.cleared ? 'clear' : 'fail'; s.phase = 'over'; }
      else if (j.stageDone) { s.stage += 1; enterStage(); }
      else { s.wave += 1; enterPrep(); }
      return true;
    },
  };
  enterStage();
  return api;
}
