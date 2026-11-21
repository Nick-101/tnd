// 욜로드워프 계산 엔진. 제작 요청서 5.5~5.8절.
// 화면과 무관한 순수 계산이다. DOM도 무작위도 쓰지 않는다.
// prepareBoard(board)      → 지원 효과를 정리한 값 (5.5)
// simulateDwarf(prep, ...) → 드워프 한 마리의 수입과 "어느 칸에서 얼마를 왜 냈는지"의 기록 (5.7, 5.8)
// simulateWave(board, ...) → 보낸 순서대로, 마친 바퀴 수 g가 이어진다 (5.6)

export function makeEngine(data) {
  const cfg = data.config;
  const N = cfg.boardSize;
  const byName = new Map(data.buildings.map(b => [b.name, b]));
  const dwarfByName = new Map(data.dwarves.map(d => [d.name, d]));
  const prev = i => (i - 1 + N) % N;
  const next = i => (i + 1) % N;
  const isShop = name => name != null && byName.get(name).group === 'shop';
  const hasKind = (name, kind) => byName.get(name).kinds.includes(kind);
  const isRepeater = name => name != null && byName.get(name).effect.type === 'repeatAdjacentSupports';

  // 5.5 지원 효과 정리하기. board는 길이 N의 배열(건물 이름 또는 null).
  function prepareBoard(board) {
    const shops = [];
    for (let i = 0; i < N; i++) if (isShop(board[i])) shops.push(i);
    // (1) 변전소 배수
    const m = new Array(N).fill(1);
    for (let i = 0; i < N; i++) {
      const name = board[i];
      if (name == null || isShop(name) || isRepeater(name)) continue;
      m[i] = 1 + [prev(i), next(i)].filter(j => isRepeater(board[j])).length;
    }
    const supports = [];
    for (let i = 0; i < N; i++) {
      const name = board[i];
      if (name != null && !isShop(name)) supports.push({ i, name, e: byName.get(name).effect, m: m[i] });
    }
    const adjacentShops = i => [prev(i), next(i)].filter(j => isShop(board[j]));
    const within2 = i => [...new Set([prev(prev(i)), prev(i), next(i), next(next(i))])].filter(j => isShop(board[j]));

    // 화면이 "무엇이 어디에 걸렸는지"를 보여 줄 수 있게 남기는 기록. 계산에는 쓰지 않는다.
    const sources = Array.from({ length: N }, () => []);   // 칸마다: 이 칸에 걸린 지원
    const targets = Array.from({ length: N }, () => []);   // 칸마다: 이 칸의 지원이 닿는 칸
    const note = (s, j, type, value) => { sources[j].push({ from: s.i, name: s.name, type, value, m: s.m }); targets[s.i].push(j); };

    // (2) 요금
    const fee = new Array(N).fill(0);
    for (const i of shops) fee[i] = byName.get(board[i]).fee;
    for (const s of supports) {
      const e = s.e;
      if (e.type === 'feeAdjacent') for (const j of adjacentShops(s.i)) { fee[j] += e.amount * s.m; note(s, j, 'fee', e.amount * s.m); }
      else if (e.type === 'feeAll') for (const j of shops) { fee[j] += e.amount * s.m; note(s, j, 'fee', e.amount * s.m); }
      else if (e.type === 'feeKindWithin2') { for (const j of within2(s.i)) if (hasKind(board[j], e.kind)) { fee[j] += e.amount * s.m; note(s, j, 'fee', e.amount * s.m); } }
      else if (e.type === 'feeBuildingAll') { for (const j of shops) if (board[j] === e.building) { fee[j] += e.amount * s.m; note(s, j, 'fee', e.amount * s.m); } }
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
      if (e.type === 'multAdjacent') for (const j of adjacentShops(s.i)) { mult[j] *= e.mult ** s.m; note(s, j, 'mult', e.mult ** s.m); }
      else if (e.type === 'multKindAll') { for (const j of shops) if (hasKind(board[j], e.kind)) { mult[j] *= e.mult ** s.m; note(s, j, 'mult', e.mult ** s.m); } }
      else if (e.type === 'multBuildingAll') { for (const j of shops) if (board[j] === e.building) { mult[j] *= e.mult ** s.m; note(s, j, 'mult', e.mult ** s.m); } }
      else if (e.type === 'multTop') { if (top !== null) { mult[top] *= e.mult ** s.m; note(s, top, 'mult', e.mult ** s.m); } }
      else if (e.type === 'againPrevious') { if (isShop(board[prev(s.i)])) { again[prev(s.i)] += s.m; note(s, prev(s.i), 'again', s.m); } }
      else if (e.type === 'againKindAdjacent') { for (const j of adjacentShops(s.i)) if (hasKind(board[j], e.kind)) { again[j] += s.m; note(s, j, 'again', s.m); } }
      else if (e.type === 'growFeeAll') for (const j of shops) { growFee[j] += e.amountPerLap * s.m; note(s, j, 'growFee', e.amountPerLap * s.m); }
      else if (e.type === 'growFeeAdjacent') for (const j of adjacentShops(s.i)) { growFee[j] += e.amountPerLap * s.m; note(s, j, 'growFee', e.amountPerLap * s.m); }
      else if (e.type === 'growMultAdjacent') for (const j of adjacentShops(s.i)) { growMult[j] += e.addPerLap * s.m; note(s, j, 'growMult', e.addPerLap * s.m); }
      else if (e.type === 'growMultTop') { if (top !== null) { growMult[top] += e.addPerLap * s.m; note(s, top, 'growMult', e.addPerLap * s.m); } }
      else if (e.type === 'useTopHere') { if (top !== null) note(s, top, 'branch', s.m); }
      else if (e.type === 'repeatAdjacentSupports') {
        for (const j of [prev(s.i), next(s.i)]) if (board[j] != null && !isShop(board[j]) && !isRepeater(board[j])) { sources[j].push({ from: s.i, name: s.name, type: 'repeat', value: 1, m: 1 }); targets[s.i].push(j); }
      }
    }
    return { board, shops, supportMult: m, fee, mult, again, growFee, growMult, top, sources, targets };
  }

  // 5.6 그 바퀴의 요금과 곱. g는 이 웨이브에서 마친 바퀴 수.
  const feeAt = (prep, i, g) => prep.fee[i] + prep.growFee[i] * g;
  const multAt = (prep, i, g) => prep.mult[i] * (1 + prep.growMult[i] * g);

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
      const before = { gauge, drunk, hype, satisfaction };
      // 1. 받지 않는 조건
      if (b.refuses === 'drunk' && drunk >= cfg.drunkThreshold) { events.push({ type: 'refused', lap, tile, shopTile, building: b.name, reason: 'drunk', via, before }); return false; }
      if (b.refuses === 'full' && -gauge >= cfg.fullThreshold) { events.push({ type: 'refused', lap, tile, shopTile, building: b.name, reason: 'full', via, before }); return false; }
      // 2. 더하기 (이용 직전의 스택)
      const hunger = Math.max(0, gauge);
      let add = (e.feePerHunger ?? 0) * hunger + (e.feePerDrunk ?? 0) * drunk + (e.feePerHype ?? 0) * hype;
      if (e.consumeAllHypeFeePer) add += e.consumeAllHypeFeePer * hype;
      const terms = [];
      if (e.feePerHunger) terms.push({ stack: '허기짐', count: hunger, per: e.feePerHunger });
      if (e.feePerDrunk) terms.push({ stack: '취함', count: drunk, per: e.feePerDrunk });
      if (e.feePerHype) terms.push({ stack: '흥', count: hype, per: e.feePerHype });
      if (e.consumeAllHypeFeePer) terms.push({ stack: '흥', count: hype, per: e.consumeAllHypeFeePer });
      // 3. 낸 돈
      let mult = multNow;
      const arcade = e.doubleIfDrunkAtLeast != null && drunk >= e.doubleIfDrunkAtLeast;
      if (arcade) mult *= 2;
      const raw = (feeNow + add) * mult;
      const pay = Math.floor(raw);
      income += pay;
      // 4. 만족도
      let satChange = 0, taste = 'none';
      const liked = b.kinds.some(k => dwarf.likes.includes(k));
      const disliked = b.kinds.includes(dwarf.dislikes);
      if (liked && !disliked) taste = 'like';
      else if (disliked && !liked) taste = 'dislike';
      else if (liked && disliked) taste = 'both';
      if (countsSatisfaction) {
        if (taste === 'like') { satisfaction += cfg.likeSatisfaction; satChange = cfg.likeSatisfaction; }
        else if (taste === 'dislike' && useDislike) { const b4 = satisfaction; satisfaction = Math.max(0, satisfaction + cfg.dislikeSatisfaction); satChange = satisfaction - b4; }
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
      events.push({
        type: 'use', lap, tile, shopTile, building: b.name, via,
        fee: feeNow, terms, add, baseMult: multNow, mult, arcadeDoubled: arcade, raw, pay,
        taste, countsSatisfaction, satChange, before, after: { gauge, drunk, hype, satisfaction }, incomeSoFar: income,
      });
      return true;
    }

    while (true) {
      const g = lapsDoneBefore + laps;
      const lap = laps + 1;
      const before = income;
      events.push({ type: 'lapStart', lap, g, extra: laps >= cfg.baseLaps, satisfaction, lapCost });
      for (let i = 0; i < N; i++) {
        const name = board[i];
        if (name == null) continue;
        if (isShop(name)) {
          for (let k = 0; k < 1 + prep.again[i]; k++) if (!useOnce(i, i, lap, feeAt(prep, i, g), multAt(prep, i, g), true, k === 0 ? null : 'again')) break;
        } else if (byName.get(name).effect.type === 'useTopHere' && prep.top !== null) {
          for (let k = 0; k < prep.supportMult[i]; k++) if (!useOnce(i, prep.top, lap, feeAt(prep, prep.top, g), multAt(prep, prep.top, g), false, 'branch')) break;
        }
      }
      laps += 1;
      incomePerLap.push(income - before);
      const stacksBefore = { gauge, drunk, hype };
      gauge = 0; drunk = 0; hype = 0;      // 한 바퀴가 하루다
      const end = { type: 'lapEnd', lap, g: lapsDoneBefore + laps, lapIncome: income - before, incomeSoFar: income, stacksBefore, satisfactionBefore: satisfaction };
      if (laps < cfg.baseLaps) { events.push({ ...end, result: 'base', satisfaction, lapCost }); continue; }
      if (satisfaction >= lapCost) {
        satisfaction -= lapCost;
        const paid = lapCost;
        lapCost *= cfg.lapCostGrowth;
        events.push({ ...end, result: 'extra', paid, satisfaction, lapCost });
        continue;
      }
      events.push({ ...end, result: 'leave', needed: lapCost, satisfaction, lapCost });
      break;
    }
    return { dwarf: dwarfName, income, laps, incomePerLap, events, lapsDoneBefore };
  }

  // 5.6 웨이브: 보낸 순서대로, 마친 바퀴 수가 이어진다.
  function simulateWave(board, sendOrder, options = {}) {
    const prep = prepareBoard(board);
    let g = 0;
    const sends = sendOrder.map(name => { const r = simulateDwarf(prep, name, g, options); g += r.laps; return r; });
    return { sends, waveIncome: sends.reduce((a, s) => a + s.income, 0) };
  }

  // 5.9 새로고침 값. pressedThisPrep는 이 정비에서 이미 누른 횟수.
  const refreshCost = (waveIndex, pressedThisPrep) =>
    Math.max(1, Math.floor(cfg.targets[waveIndex] * cfg.refreshBaseRate)) * cfg.refreshGrowth ** pressedThisPrep;

  return { prepareBoard, simulateDwarf, simulateWave, refreshCost, feeAt, multAt, isShop, building: n => byName.get(n), dwarf: n => dwarfByName.get(n) };
}

// 숫자를 화면에 적는 법. 2.5, 6.25, 9.375처럼 필요한 자리까지만.
export const fmtNum = x => (Number.isInteger(x) ? String(x) : String(Math.round(x * 1000) / 1000));

// 이용 기록 한 줄을 계산식 글자로. 예: "6 + 허기짐 3 × 8 = 30", "(12 + 0) × 2.5 × 2(만취) = 60"
export function formulaText(ev) {
  const terms = ev.terms.filter(t => t.count > 0).map(t => `${t.stack} ${t.count} × ${t.per}`);
  const sum = [fmtNum(ev.fee), ...terms].join(' + ');
  const mults = [];
  if (ev.baseMult !== 1) mults.push(fmtNum(ev.baseMult));
  if (ev.arcadeDoubled) mults.push('2(만취)');
  if (!mults.length) return terms.length ? `${sum} = ${ev.pay}` : `요금 ${ev.pay}`;
  const floored = ev.raw !== ev.pay ? ' (소수 버림)' : '';
  return `${terms.length ? `(${sum})` : sum} × ${mults.join(' × ')} = ${ev.pay}${floored}`;
}

// 눈금 숫자를 글자로. 양수면 허기짐, 음수면 포만감.
export const gaugeText = g => (g > 0 ? `허기짐 ${g}` : g < 0 ? `포만감 ${-g}` : '눈금 0');
