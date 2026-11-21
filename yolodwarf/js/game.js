// 한 판의 진행 (5.1, 5.9, 5.10, 5.11). DOM을 쓰지 않는다. 계산은 engine.js에 맡긴다.
// 단계(phase): intro → prep → pick → (send ×3) → judge → prep … → over
import { makeEngine } from './engine.js';
import { makeRng } from './rng.js';

export function createGame(data, { seed, dislike = true } = {}) {
  const cfg = data.config;
  const engine = makeEngine(data);
  const isSupport = name => !engine.isShop(name);
  // 후보와 드워프는 서로 다른 수열을 쓴다. 새로고침을 몇 번 눌렀든 같은 시드면 드워프 순서가 같다.
  const candRng = makeRng(`${seed}/candidates`);

  const s = {
    seed: String(seed),
    options: { dislike },
    phase: 'intro',
    wave: 0,                                   // 0부터. 화면에는 +1
    money: cfg.startMoney,
    board: new Array(cfg.boardSize).fill(null),
    candidates: new Array(cfg.candidates).fill(null),   // { name, frozen } 또는 null
    buildsLeft: 0,
    refreshCount: 0,
    deck: [], sendIndex: 0, choices: [],
    g: 0,                                      // 이 웨이브에서 마친 바퀴 수 (5.6)
    waveIncome: 0, waveSends: [],
    waveResults: [],                           // 웨이브마다 { wave, income, sends, moneyAfter, target, passed }
    bestSend: null,                            // 이번 판 최고 수입 { income, dwarf, wave }
    judge: null, outcome: null,                // outcome: 'clear' | 'fail'
  };

  const target = () => cfg.targets[s.wave];
  const prep = () => engine.prepareBoard(s.board);

  // 5.9 후보 뽑기. 보드의 지원과 후보 칸에 떠 있는 지원은 풀에서 뺀다.
  function fillSlots(slots) {
    const taken = new Set(s.board.filter(n => n != null && isSupport(n)));
    s.candidates.forEach((c, i) => { if (c && !slots.includes(i) && isSupport(c.name)) taken.add(c.name); });
    for (const i of slots) {
      const pool = data.buildings.filter(b => !(b.group === 'support' && taken.has(b.name)));
      const pick = candRng.weighted(pool, b => b.weight);
      s.candidates[i] = { name: pick.name, frozen: false };
      if (pick.group === 'support') taken.add(pick.name);
    }
  }
  const unfrozenSlots = () => s.candidates.map((c, i) => (c && c.frozen ? -1 : i)).filter(i => i >= 0);

  function enterPrep() {
    s.phase = 'prep';
    s.buildsLeft = cfg.buildsPerPrep;
    s.refreshCount = 0;
    s.judge = null;
    fillSlots(unfrozenSlots());   // 얼린 후보만 남는다 (README "정해야 할 것" 1)
  }

  const refreshCost = () => engine.refreshCost(s.wave, s.refreshCount);
  const canRefresh = () => s.phase === 'prep' && s.money >= refreshCost() && unfrozenSlots().length > 0;
  const canEditBoard = () => s.phase === 'prep' || s.phase === 'pick';

  function deal() {
    s.choices = s.deck.slice(s.sendIndex * cfg.choicesPerSend, (s.sendIndex + 1) * cfg.choicesPerSend);
  }

  const api = {
    state: s, data, engine, cfg,
    target, prep, refreshCost, canRefresh, canEditBoard,

    begin() { if (s.phase !== 'intro') return false; enterPrep(); return true; },

    build(slot, tile) {
      const c = s.candidates[slot];
      if (s.phase !== 'prep' || !c || s.buildsLeft <= 0 || s.board[tile] != null) return false;
      if (isSupport(c.name) && s.board.includes(c.name)) return false;   // 같은 지원은 한 채만 (5.3)
      s.board[tile] = c.name;
      s.candidates[slot] = null;
      s.buildsLeft -= 1;
      return true;
    },

    // 자리 바꾸기: 빈 칸으로 옮기거나 두 건물을 맞바꾼다.
    move(from, to) {
      if (!canEditBoard() || from === to || s.board[from] == null) return false;
      [s.board[from], s.board[to]] = [s.board[to], s.board[from]];
      return true;
    },

    toggleFreeze(slot) {
      const c = s.candidates[slot];
      if (s.phase !== 'prep' || !c) return false;
      c.frozen = !c.frozen;
      return true;
    },

    refresh() {
      if (!canRefresh()) return false;
      s.money -= refreshCost();
      s.refreshCount += 1;
      fillSlots(unfrozenSlots());
      return true;
    },

    startWave() {
      if (s.phase !== 'prep') return false;
      s.phase = 'pick';
      s.deck = makeRng(`${s.seed}/dwarves/${s.wave}`).shuffle(data.dwarves.map(d => d.name));
      s.sendIndex = 0; s.g = 0; s.waveIncome = 0; s.waveSends = [];
      deal();
      return true;
    },

    // 시험용: 지금 보드에서 이 드워프를 보내면 얼마를 버는가.
    preview(choice) {
      const r = engine.simulateDwarf(prep(), s.choices[choice], s.g, s.options);
      return { income: r.income, laps: r.laps };
    },

    // 드워프를 보낸다. 결과(기록 포함)를 돌려주고 상태를 끝까지 진행한다. 화면은 기록을 재생만 한다.
    send(choice) {
      if (s.phase !== 'pick' || !s.choices[choice]) return null;
      const p = prep();
      const result = engine.simulateDwarf(p, s.choices[choice], s.g, s.options);
      const info = { ...result, prep: p, wave: s.wave, sendIndex: s.sendIndex, moneyBefore: s.money, waveIncomeBefore: s.waveIncome, bestBefore: s.bestSend ? s.bestSend.income : 0 };
      s.money += result.income;
      s.g += result.laps;
      s.waveIncome += result.income;
      s.waveSends.push({ dwarf: result.dwarf, income: result.income, laps: result.laps });
      if (!s.bestSend || result.income > s.bestSend.income) s.bestSend = { income: result.income, dwarf: result.dwarf, wave: s.wave };
      s.sendIndex += 1;
      if (s.sendIndex < cfg.sendsPerWave) deal();
      else {
        const passed = s.money >= target();
        s.judge = { passed, cleared: passed && s.wave === cfg.waves - 1, money: s.money, target: target() };
        s.waveResults.push({ wave: s.wave, income: s.waveIncome, sends: s.waveSends, moneyAfter: s.money, target: target(), passed });
        s.choices = [];
        s.phase = 'judge';
      }
      return info;
    },

    // 판정 뒤: 통과면 다음 정비, 다섯째를 통과했거나 모자라면 끝.
    proceed() {
      if (s.phase !== 'judge') return false;
      if (s.judge.passed && !s.judge.cleared) { s.wave += 1; enterPrep(); }
      else { s.outcome = s.judge.cleared ? 'clear' : 'fail'; s.phase = 'over'; }
      return true;
    },
  };
  return api;
}
