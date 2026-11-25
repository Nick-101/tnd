// 한 런의 진행 (시제품 1차 제작 요청서 3절과 4.3절). DOM을 쓰지 않는다. 계산은 engine.js에 맡긴다.
// 단계(phase): intro(런 시작) → prep(정비) → pick(웨이브: 드워프 고르기) ×3~4 → judge(판정) → prep … → over
// 건물은 데이터의 effect.type으로만 가린다. 데이터에서 건물을 빼면 그 건물 없이 돌아간다.
import { makeEngine } from './engine.js';
import { makeRng } from './rng.js';

export function createGame(data, { seed, targetMult = 1, traits = true, supportRate = null, disabled = [], forced = [] } = {}) {
  const c = data.constants;
  const engine = makeEngine(data);
  const isShop = id => !!engine.shop(id);
  const typeOf = id => (id && engine.support(id) ? engine.support(id).effect.type : null);
  const candRng = makeRng(`${seed}/candidates`);   // 후보, 드워프, 유행은 서로 다른 수열을 쓴다
  const rate = supportRate == null ? c.candidateRates.support : supportRate;

  const s = {
    seed: String(seed),
    options: { targetMult, traits, supportRate: rate, disabled: [...disabled], forced: forced.slice(0, 3) },
    phase: 'intro',
    wave: 0,                                   // 0부터. 화면에는 +1
    money: c.startMoney,
    borrowed: 0,                               // 대출 창구로 빌린 돈. 남은 목표가 그만큼 올라 있다
    board: new Array(data.waves[0].tiles).fill(null),   // 칸마다 null 또는 { id, stars, lastSales, waveSales }. lastSales가 null이면 이번 정비에 지은 건물
    newTiles: [],                              // 이번 정비에 새로 생긴 칸
    candidates: new Array(c.candidates).fill(null),     // { id, locked } 또는 null
    buildsLeft: 0, upgradesLeft: 0, refreshPresses: 0,
    timers: {},                                // 팝업 스토어와 공사 현장의 남은 횟수 { 건물 id: 수 }
    eventCount: 0,                             // 이벤트 부스의 세기. 건물에 남는다
    deck: [],
    trends: [],                                // 웨이브마다의 유행하는 업종(잡지사). 런을 시작할 때 미리 뽑는다
    hand: [], order: [], orderPos: 0, sendIndex: 0, sends: c.sendsPerWave,
    g: 0,                                      // 이 웨이브에서 성장 지원이 자란 횟수(추가 바퀴 수)
    waveSales: 0, waveTips: 0, waveSends: [],
    results: [],                               // 웨이브마다 { wave, sales, tips, moneyAfter, target, passed, sends }
    log: [],                                   // 웨이브마다 기록 복사에 쓸 것 { seen, built, demolished, upgraded, notes }
    notices: [],                               // 화면이 알릴 일(이자, 철거로 얻은 돈, 빌린 돈, 대기업 사옥 들). 화면이 읽고 비운다
    bestPay: null, maxLaps: 0,
    judge: null, outcome: null,                // outcome: 'clear' | 'fail'
  };
  const targetOf = wave => Math.ceil(data.waves[wave].target * s.options.targetMult) + (wave >= s.wave ? s.borrowed : 0);
  const target = () => targetOf(s.wave);
  const ids = () => s.board.map(b => (b ? b.id : null));
  const levels = () => s.board.map(b => (b ? b.stars : 0));
  const has = type => s.board.some(b => b && typeOf(b.id) === type);
  const prep = () => engine.prep({ board: ids(), levels: levels(), trend: s.trends[s.wave] || null });
  const noteLog = () => s.log[s.wave];
  const nameOf = id => engine.building(id).name;

  // 덱: 90마리에서 고르게 30마리, 그 가운데 10마리에 특성. 런을 시작할 때 한 번 뽑는다
  // (인기 업종과 비인기 업종으로 덱에 색을 주던 것은 뺐다. 데이터의 deck.popularKinds, unpopularKinds, weights는 쓰지 않는다)
  function buildDeck() {
    const rng = makeRng(`${s.seed}/deck`), dk = c.deck;
    const deck = rng.shuffle(data.dwarves).slice(0, dk.size).map(d => ({ ...d, trait: null }));
    if (s.options.traits) {
      const lucky = rng.shuffle(deck.map((_, i) => i)).slice(0, dk.traitsEach * data.traits.length);
      lucky.forEach((di, n) => { deck[di].trait = data.traits[n % data.traits.length].id; });
    }
    s.deck = deck;
  }
  // 잡지사: 웨이브 열 개의 유행을 미리 뽑는다. 여덟 업종에서 고르게, 바로 앞 웨이브와 같은 업종은 뽑지 않는다
  function buildTrends() {
    const rng = makeRng(`${s.seed}/trend`);
    for (let w = 0; w < data.waves.length; w++) { const pool = c.kinds.filter(k => k !== s.trends[w - 1]); s.trends.push(pool[rng.int(pool.length)]); }
  }

  // 후보에 나올 수 있는 지원 건물인가 (3.3절)
  function supportAllowed(x, taken) {
    if (x.inCandidates === false || s.options.disabled.includes(x.id) || taken.has(x.id)) return false;
    if (x.effect.type === 'construction') {   // 공사 현장: 보드에 공사 현장이나 랜드마크가 있으면, 그리고 정해진 웨이브 뒤로는 나오지 않는다
      if (s.board.some(b => b && (b.id === x.id || b.id === x.effect.becomes))) return false;
      if (c.constructionLastWave != null && s.wave + 1 > c.constructionLastWave) return false;
    }
    return true;
  }
  // 후보 한 장: 묶음(매장/지원 건물)을 확률로 뽑고 그 안에서 고르게. 뽑을 지원 건물이 없으면 매장을 뽑는다
  function fillSlots(slots, forcedIds = []) {
    const taken = new Set(s.board.filter(b => b && !isShop(b.id)).map(b => b.id));
    s.candidates.forEach((cd, i) => { if (cd && !slots.includes(i) && !isShop(cd.id)) taken.add(cd.id); });
    const queue = forcedIds.filter(id => engine.support(id) && supportAllowed(engine.support(id), taken));
    for (const i of slots) {
      let pick;
      if (queue.length) pick = engine.support(queue.shift());
      else {
        const pool = candRng.rand() < s.options.supportRate ? data.supports.filter(x => supportAllowed(x, taken)) : [];
        const from = pool.length ? pool : data.shops;
        pick = from[candRng.int(from.length)];
      }
      s.candidates[i] = { id: pick.id, locked: false };
      if (!isShop(pick.id)) { taken.add(pick.id); const seen = noteLog().seen; if (!seen.includes(pick.id)) seen.push(pick.id); }
    }
  }
  const unlockedSlots = () => s.candidates.map((cd, i) => (cd && cd.locked ? -1 : i)).filter(i => i >= 0);

  // 정비를 시작할 때 (3.6절의 8~10): 칸이 늘고, 은행의 이자가 들어오고, 새로고침의 비용이 처음으로 돌아가고, 후보가 나온다
  function enterPrep() {
    s.phase = 'prep'; s.judge = null;
    s.log[s.wave] = { seen: [], built: [], demolished: [], upgraded: [], notes: [] };
    const r = engine.startPrep({ board: ids(), levels: levels(), timers: s.timers, money: s.money }, s.wave + 1);
    s.newTiles = [];
    while (s.board.length < r.board.length) { s.newTiles.push(s.board.length); s.board.push(null); }
    if (r.money !== s.money) { const amount = r.money - s.money; s.money = r.money; s.notices.push({ type: 'interest', amount }); noteLog().notes.push(`이자 +${amount}`); }
    s.buildsLeft = c.buildsPerPrep;
    s.upgradesLeft = c.upgrade.perPrep;
    s.refreshPresses = 0;
    fillSlots(unlockedSlots(), s.wave === 0 ? s.options.forced : []);   // 잠근 후보만 남고 나머지는 새로 뽑는다
  }

  const refreshCost = () => engine.refreshCost(s.wave + 1, s.refreshPresses);
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

  function nextHand(returning) {
    const take = c.handSize - (returning ? 1 : 0);
    const drawn = s.order.slice(s.orderPos, s.orderPos + take).map(i => s.deck[i]);
    s.orderPos += take;
    s.hand = returning ? [returning, ...drawn] : drawn;
  }

  const api = {
    state: s, data, engine, c,
    target, targetOf, prep, refreshCost, canRefresh, canMove, upgradeInfo, has,
    finalMoney: () => s.money - s.borrowed,   // 끝 화면과 최고 기록은 빌린 돈을 뺀 값이다
    takeNotices() { const n = s.notices; s.notices = []; return n; },

    begin() { if (s.phase !== 'intro') return false; enterPrep(); return true; },

    build(slot, tile) {
      const cd = s.candidates[slot];
      if (s.phase !== 'prep' || !cd || s.buildsLeft <= 0 || tile == null || s.board[tile] !== null) return false;
      if (!isShop(cd.id) && s.board.some(b => b && b.id === cd.id)) return false;   // 같은 지원 건물은 한 채만
      s.board[tile] = { id: cd.id, stars: 0, lastSales: null, waveSales: 0 };
      s.candidates[slot] = null;
      s.buildsLeft -= 1;
      noteLog().built.push(cd.id);
      const e = engine.support(cd.id) ? engine.support(cd.id).effect : null;
      if (e && e.waves) s.timers[cd.id] = e.waves;   // 팝업 스토어, 공사 현장: 남은 횟수
      if (e && e.type === 'loan') {                  // 대출 창구: 이번 웨이브의 지금 목표만큼 얻고, 남은 목표가 그만큼 오른다
        const amount = target();
        s.money += amount; s.borrowed += amount;
        s.notices.push({ type: 'loan', amount }); noteLog().notes.push(`빌린 돈 +${amount}`);
      }
      return true;
    },

    // 자리 바꾸기: 빈 칸으로 옮기거나 두 건물의 자리를 바꾼다. ★과 매출 기록은 건물을 따라간다.
    move(from, to) {
      if (!canMove() || from === to || !s.board[from] || to == null || to < 0 || to >= s.board.length) return false;
      [s.board[from], s.board[to]] = [s.board[to], s.board[from]];
      return true;
    },

    // 철거: 무료. 건설 횟수는 돌아오지 않는다. ★도 사라진다. 철거 업체가 있으면 매장의 지난 웨이브 매출만큼 얻는다.
    demolish(tile) {
      const b = s.board[tile];
      if (s.phase !== 'prep' || !b) return false;
      if (isShop(b.id) && has('demolitionIncome')) {
        const amount = b.lastSales || 0;   // 이번 정비에 지은 매장은 0
        s.money += amount; s.notices.push({ type: 'demolitionIncome', amount, name: nameOf(b.id) });
        if (amount) noteLog().notes.push(`철거 +${amount}`);
      }
      delete s.timers[b.id];
      if (typeOf(b.id) === 'everyNth') s.eventCount = 0;   // 이벤트 부스를 철거하면 세기가 사라진다
      s.board[tile] = null;
      noteLog().demolished.push(b.id);
      return true;
    },

    upgrade(tile) {
      const u = upgradeInfo(tile);
      if (!u.ok) return false;
      s.money -= u.cost; s.upgradesLeft -= 1; s.board[tile].stars += 1;
      noteLog().upgraded.push(s.board[tile].id);
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
      s.refreshPresses += 1;
      fillSlots(unlockedSlots());
      return true;
    },

    startWave() {
      if (s.phase !== 'prep') return false;
      s.phase = 'pick';
      s.order = makeRng(`${s.seed}/dwarves/${s.wave}`).shuffle(s.deck.map((_, i) => i));
      s.orderPos = 0; s.sendIndex = 0; s.g = 0; s.waveSales = 0; s.waveTips = 0; s.waveSends = [];   // 지난 웨이브에서 자란 것은 처음으로
      // 버스 터미널: 웨이브를 시작할 때 보드에 있으면 한 번 더 보낸다
      s.sends = c.sendsPerWave + s.board.reduce((a, b) => a + (b && typeOf(b.id) === 'extraSend' ? engine.support(b.id).effect.amount : 0), 0);
      for (const b of s.board) if (b) b.waveSales = 0;
      nextHand(null);
      return true;
    },

    // 시험용: 지금 보드에서 이 드워프를 보내면 매출과 팁이 얼마인가. 이벤트 부스의 세기를 바꾸지 않는다.
    preview(choice) {
      const r = engine.runDwarf(prep(), s.hand[choice], s.g, null, { eventCount: s.eventCount }, { events: false });
      return { sales: r.sales, tip: r.tip, laps: r.laps };
    },

    // 드워프를 보낸다. 결과(기록 포함)를 돌려주고 상태를 끝까지 진행한다. 화면은 기록을 재생만 한다.
    send(choice) {
      const dwarf = s.hand[choice];
      if (s.phase !== 'pick' || !dwarf) return null;
      const info = prep(), sales = s.board.map(() => 0), ctx = { eventCount: s.eventCount };
      const r = engine.runDwarf(info, dwarf, s.g, sales, ctx);
      const out = { ...r, dwarf, info, wave: s.wave, sendIndex: s.sendIndex, sends: s.sends, hand: s.hand.slice(), target: target(),
        eventCountBefore: s.eventCount, moneyBefore: s.money, waveSalesBefore: s.waveSales, bestPayBefore: s.bestPay ? s.bestPay.pay : 0 };
      s.eventCount = ctx.eventCount;
      s.money += r.sales + r.tip;                    // 3.6절의 1: 드워프가 떠날 때 팁이 들어온다
      s.g += r.extraLaps; s.waveSales += r.sales; s.waveTips += r.tip;
      sales.forEach((v, i) => { if (s.board[i]) s.board[i].waveSales += v; });   // 2호점에서 올린 것은 본점의 기록에. 팁은 넣지 않는다
      s.waveSends.push({ name: dwarf.name, sales: r.sales, tip: r.tip, laps: r.laps });
      if (r.laps > s.maxLaps) s.maxLaps = r.laps;
      if (r.bestPay > (s.bestPay ? s.bestPay.pay : 0)) s.bestPay = { pay: r.bestPay, dwarf: dwarf.name, wave: s.wave };
      s.sendIndex += 1;
      if (s.sendIndex < s.sends) nextHand(has('returnDwarf') ? dwarf : null);   // 쿠폰 가판대: 방금 보낸 드워프가 다음 셋에 다시 나온다
      else {
        // 3.6절의 2: 판정
        const t = target(), passed = s.money >= t, cleared = passed && s.wave === data.waves.length - 1;
        s.judge = { passed, cleared, money: s.money, target: t, ratio: s.money / t, events: [] };
        s.results.push({ wave: s.wave, sales: s.waveSales, tips: s.waveTips, moneyAfter: s.money, target: t, passed, sends: s.waveSends });
        if (passed && !cleared) {
          // 3~6: 매출을 적어 두고, 대기업 사옥, 팝업 스토어, 공사 현장
          const byTile = s.board.map(b => (b ? b.waveSales : 0));
          const before = s.board.slice();
          const r2 = engine.endWave({ board: ids(), levels: levels(), timers: s.timers, money: s.money }, byTile);
          s.board = r2.board.map((id, i) => {
            if (id === null) return null;
            const b = before[i] && before[i].id === id ? before[i] : { id, stars: 0, lastSales: 0, waveSales: 0 };
            b.stars = r2.levels[i]; b.lastSales = r2.lastSales[i];
            return b;
          });
          s.timers = r2.timers; s.money = r2.money;
          for (const e of r2.events) {
            if (e.type === 'merger') { const n = { type: 'merger', demolished: nameOf(e.shop), kept: nameOf(s.board[e.starTo].id), tile: e.demolished, starTo: e.starTo }; s.judge.events.push(n); noteLog().demolished.push(e.shop); noteLog().notes.push(`대기업 사옥: ${n.demolished} 철거, ${n.kept} ★`); }
            else if (e.type === 'demolitionIncome') { s.judge.events.push({ type: 'demolitionIncome', amount: e.amount }); noteLog().notes.push(`철거 +${e.amount}`); }
            else { s.judge.events.push({ type: e.type, name: nameOf(e.id), tile: e.tile }); noteLog().notes.push(e.type === 'gone' ? `${nameOf(e.id)} 사라짐` : '랜드마크 완성'); }
          }
          s.judge.moneyAfterEvents = s.money;
        }
        s.hand = [];
        s.phase = 'judge';
      }
      return out;
    },

    // 판정 뒤: 통과면 다음 정비, 열째 웨이브를 통과했거나 모자라면 끝.
    proceed() {
      if (s.phase !== 'judge') return false;
      const j = s.judge;
      if (!j.passed || j.cleared) { s.outcome = j.cleared ? 'clear' : 'fail'; s.phase = 'over'; }
      else { s.wave += 1; enterPrep(); }
      return true;
    },
  };
  buildDeck(); buildTrends();
  return api;
}
