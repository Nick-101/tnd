// 욜로드워프 데모 참고 엔진. 제작 요청서 5.5~5.8절을 그대로 옮겼다.
// 쓰는 법: node reference_engine.mjs   → yolodwarf_testcases.json의 사례를 모두 돌려 본다.
// 화면과 무관한 순수 계산이다. simulateDwarf는 "어느 칸에서 얼마를 왜 냈는지"의 기록(events)을 돌려준다.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export function makeEngine(data) {
  const cfg = data.config;
  const N = cfg.boardSize;
  const byName = new Map(data.buildings.map(b => [b.name, b]));
  const dwarfByName = new Map(data.dwarves.map(d => [d.name, d]));
  const prev = i => (i - 1 + N) % N;
  const next = i => (i + 1) % N;
  const isShop = name => name != null && byName.get(name).group === 'shop';
  const hasKind = (name, kind) => byName.get(name).kinds.includes(kind);

  // 5.5 지원 효과 정리하기. board는 길이 N의 배열(건물 이름 또는 null).
  function prepareBoard(board) {
    const shops = [];
    for (let i = 0; i < N; i++) if (isShop(board[i])) shops.push(i);
    // (1) 변전소 배수
    const m = new Array(N).fill(1);
    for (let i = 0; i < N; i++) {
      const name = board[i];
      if (name == null || isShop(name) || name === '변전소') continue;
      m[i] = 1 + [prev(i), next(i)].filter(j => board[j] === '변전소').length;
    }
    const supports = [];
    for (let i = 0; i < N; i++) {
      const name = board[i];
      if (name != null && !isShop(name)) supports.push({ i, name, e: byName.get(name).effect, m: m[i] });
    }
    const adjacentShops = i => [prev(i), next(i)].filter(j => isShop(board[j]));
    const within2 = i => [...new Set([prev(prev(i)), prev(i), next(i), next(next(i))])].filter(j => isShop(board[j]));
    // (2) 요금
    const fee = new Array(N).fill(0);
    for (const i of shops) fee[i] = byName.get(board[i]).fee;
    for (const s of supports) {
      const e = s.e;
      if (e.type === 'feeAdjacent') for (const j of adjacentShops(s.i)) fee[j] += e.amount * s.m;
      else if (e.type === 'feeAll') for (const j of shops) fee[j] += e.amount * s.m;
      else if (e.type === 'feeKindWithin2') { for (const j of within2(s.i)) if (hasKind(board[j], e.kind)) fee[j] += e.amount * s.m; }
      else if (e.type === 'feeBuildingAll') { for (const j of shops) if (board[j] === e.building) fee[j] += e.amount * s.m; }
    }
    // (3) 요금이 가장 높은 건물. 같으면 칸 번호가 작은 쪽
    let top = null;
    for (const i of shops) if (top === null || fee[i] > fee[top]) top = i;
    // (4) 곱, (5) 한 번 더, (6) 성장
    const mult = new Array(N).fill(1);
    const again = new Array(N).fill(0);
    const growFee = new Array(N).fill(0);
    const growMult = new Array(N).fill(0);
    for (const s of supports) {
      const e = s.e;
      if (e.type === 'multAdjacent') for (const j of adjacentShops(s.i)) mult[j] *= e.mult ** s.m;
      else if (e.type === 'multKindAll') { for (const j of shops) if (hasKind(board[j], e.kind)) mult[j] *= e.mult ** s.m; }
      else if (e.type === 'multBuildingAll') { for (const j of shops) if (board[j] === e.building) mult[j] *= e.mult ** s.m; }
      else if (e.type === 'multTop') { if (top !== null) mult[top] *= e.mult ** s.m; }
      else if (e.type === 'againPrevious') { if (isShop(board[prev(s.i)])) again[prev(s.i)] += s.m; }
      else if (e.type === 'againKindAdjacent') { for (const j of adjacentShops(s.i)) if (hasKind(board[j], e.kind)) again[j] += s.m; }
      else if (e.type === 'growFeeAll') for (const j of shops) growFee[j] += e.amountPerLap * s.m;
      else if (e.type === 'growFeeAdjacent') for (const j of adjacentShops(s.i)) growFee[j] += e.amountPerLap * s.m;
      else if (e.type === 'growMultAdjacent') for (const j of adjacentShops(s.i)) growMult[j] += e.addPerLap * s.m;
      else if (e.type === 'growMultTop') { if (top !== null) growMult[top] += e.addPerLap * s.m; }
    }
    return { board, shops, supportMult: m, fee, mult, again, growFee, growMult, top };
  }

  // 5.7, 5.8 드워프 한 마리. lapsDoneBefore는 이 웨이브에서 지금까지 마친 바퀴 수(5.6의 g).
  function simulateDwarf(prep, dwarfName, lapsDoneBefore = 0, options = {}) {
    const dwarf = dwarfByName.get(dwarfName);
    const useDislike = options.dislike !== false;
    const board = prep.board;
    let gauge = 0, drunk = 0, hype = 0;       // 눈금(양수 허기짐, 음수 포만감), 취함, 흥
    let satisfaction = 0, lapCost = cfg.lapCostStart;
    let laps = 0, income = 0;
    const incomePerLap = [], events = [];

    function useOnce(tile, shopTile, lap, feeNow, multNow, countsSatisfaction, via) {
      const b = byName.get(board[shopTile]);
      const e = b.effect;
      // 1. 받지 않는 조건
      if (b.refuses === 'drunk' && drunk >= cfg.drunkThreshold) { events.push({ lap, tile, building: b.name, refused: 'drunk', via }); return false; }
      if (b.refuses === 'full' && -gauge >= cfg.fullThreshold) { events.push({ lap, tile, building: b.name, refused: 'full', via }); return false; }
      // 2. 더하기 (이용 직전의 스택)
      const hunger = Math.max(0, gauge);
      let add = (e.feePerHunger ?? 0) * hunger + (e.feePerDrunk ?? 0) * drunk + (e.feePerHype ?? 0) * hype;
      if (e.consumeAllHypeFeePer) add += e.consumeAllHypeFeePer * hype;
      // 3. 낸 돈
      let mult = multNow;
      const arcade = e.doubleIfDrunkAtLeast != null && drunk >= e.doubleIfDrunkAtLeast;
      if (arcade) mult *= 2;
      const pay = Math.floor((feeNow + add) * mult);
      income += pay;
      // 4. 만족도
      let satChange = 0;
      if (countsSatisfaction) {
        const liked = b.kinds.some(k => dwarf.likes.includes(k));
        const disliked = b.kinds.includes(dwarf.dislikes);
        if (liked && !disliked) { satisfaction += cfg.likeSatisfaction; satChange = cfg.likeSatisfaction; }
        else if (disliked && !liked && useDislike) { const before = satisfaction; satisfaction = Math.max(0, satisfaction + cfg.dislikeSatisfaction); satChange = satisfaction - before; }
      }
      // 5. 스택을 쓰거나 없앤다
      if (e.consumeAllHypeFeePer) hype = 0;
      if (e.clearDrunk) drunk = 0;
      if (e.clearAll) { gauge = 0; drunk = 0; hype = 0; }
      if (e.reduceDrunk) drunk = Math.max(0, drunk - e.reduceDrunk);
      // 6. 스택을 준다
      gauge += (e.giveHunger ?? 0) - (e.giveFullness ?? 0);
      drunk += e.giveDrunk ?? 0;
      hype += e.giveHype ?? 0;
      events.push({ lap, tile, building: b.name, via, fee: feeNow, add, mult, arcadeDoubled: arcade, pay, satChange, after: { gauge, drunk, hype, satisfaction } });
      return true;
    }

    while (true) {
      const g = lapsDoneBefore + laps;
      const lap = laps + 1;
      const before = income;
      const feeNow = i => prep.fee[i] + prep.growFee[i] * g;
      const multNow = i => prep.mult[i] * (1 + prep.growMult[i] * g);
      for (let i = 0; i < prep.board.length; i++) {
        const name = board[i];
        if (name == null) continue;
        if (isShop(name)) {
          for (let k = 0; k < 1 + prep.again[i]; k++) if (!useOnce(i, i, lap, feeNow(i), multNow(i), true, k === 0 ? null : 'again')) break;
        } else if (byName.get(name).effect.type === 'useTopHere' && prep.top !== null) {
          for (let k = 0; k < prep.supportMult[i]; k++) if (!useOnce(i, prep.top, lap, feeNow(prep.top), multNow(prep.top), false, 'branch')) break;
        }
      }
      laps += 1;
      incomePerLap.push(income - before);
      gauge = 0; drunk = 0; hype = 0;      // 한 바퀴가 하루다
      if (laps < cfg.baseLaps) { events.push({ lap, lapEnd: true, result: 'base' }); continue; }
      if (satisfaction >= lapCost) {
        satisfaction -= lapCost;
        events.push({ lap, lapEnd: true, result: 'extra', paid: lapCost, satisfaction });
        lapCost *= cfg.lapCostGrowth;
        continue;
      }
      events.push({ lap, lapEnd: true, result: 'leave', needed: lapCost, satisfaction });
      break;
    }
    return { income, laps, incomePerLap, events };
  }

  // 5.6 웨이브: 보낸 순서대로, 마친 바퀴 수가 이어진다.
  function simulateWave(board, sendOrder, options = {}) {
    const prep = prepareBoard(board);
    let g = 0;
    const sends = sendOrder.map(name => { const r = simulateDwarf(prep, name, g, options); g += r.laps; return { dwarf: name, ...r }; });
    return { sends, waveIncome: sends.reduce((a, s) => a + s.income, 0) };
  }

  const refreshCost = (waveIndex, pressedThisPrep) =>
    Math.max(1, Math.floor(cfg.targets[waveIndex] * cfg.refreshBaseRate)) * cfg.refreshGrowth ** pressedThisPrep;

  return { prepareBoard, simulateDwarf, simulateWave, refreshCost };
}

// 직접 실행하면 검증 사례를 돌린다.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const dir = dirname(fileURLToPath(import.meta.url));
  const data = JSON.parse(readFileSync(join(dir, 'yolodwarf_data.json'), 'utf8'));
  const tests = JSON.parse(readFileSync(join(dir, 'yolodwarf_testcases.json'), 'utf8'));
  const engine = makeEngine(data);
  let fail = 0;
  for (const c of tests.singleRuns) {
    const r = engine.simulateDwarf(engine.prepareBoard(c.board), c.dwarf, c.lapsDoneBeforeInWave);
    const ok = r.income === c.expected.income && r.laps === c.expected.laps && JSON.stringify(r.incomePerLap) === JSON.stringify(c.expected.incomePerLap);
    if (!ok) { fail++; console.log(`어긋남 singleRuns #${c.id} (${c.label}, ${c.dwarf}): 기대 ${JSON.stringify(c.expected)} / 결과 ${JSON.stringify({ income: r.income, laps: r.laps, incomePerLap: r.incomePerLap })}`); }
  }
  for (const w of tests.waves) {
    const r = engine.simulateWave(w.board, w.sendOrder);
    const ok = r.waveIncome === w.expected.waveIncome && r.sends.every((s, i) => s.income === w.expected.sends[i].income && s.laps === w.expected.sends[i].laps);
    if (!ok) { fail++; console.log(`어긋남 waves #${w.id}: 기대 ${JSON.stringify(w.expected)} / 결과 ${JSON.stringify(r.sends.map(s => ({ dwarf: s.dwarf, income: s.income, laps: s.laps })))}`); }
  }
  console.log(`사례 ${tests.singleRuns.length + tests.waves.length}개 가운데 ${tests.singleRuns.length + tests.waves.length - fail}개 통과`);
  console.log('새로고침 값 (웨이브 1~5의 첫 번째, 두 번째, 세 번째):', [0, 1, 2, 3, 4].map(w => [0, 1, 2].map(k => engine.refreshCost(w, k)).join('/')).join('  '));
  process.exit(fail ? 1 : 0);
}
