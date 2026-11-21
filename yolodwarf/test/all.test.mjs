// 검증. 쓰는 법: node test/all.test.mjs  (또는 npm test)
// 1) yolodwarf_testcases.json의 사례 전부  2) 요청서 9.2의 손 계산  3) 한 판 진행 규칙(정비·웨이브·판정)
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { makeEngine, formulaText } from '../js/engine.js';
import { createGame } from '../js/game.js';
import { makeRng } from '../js/rng.js';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'data');
const data = JSON.parse(readFileSync(join(dir, 'yolodwarf_data.json'), 'utf8'));
const tests = JSON.parse(readFileSync(join(dir, 'yolodwarf_testcases.json'), 'utf8'));
const engine = makeEngine(data);

let fail = 0, checks = 0;
const check = (ok, msg) => { checks++; if (!ok) { fail++; console.log('  어긋남: ' + msg); } };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ── 1. 검증 사례 ─────────────────────────────────────────────
let caseFail = 0;
for (const c of tests.singleRuns) {
  const r = engine.simulateDwarf(engine.prepareBoard(c.board), c.dwarf, c.lapsDoneBeforeInWave);
  const ok = r.income === c.expected.income && r.laps === c.expected.laps && same(r.incomePerLap, c.expected.incomePerLap);
  if (!ok) { caseFail++; console.log(`  어긋남 singleRuns #${c.id} (${c.label}, ${c.dwarf}): 기대 ${JSON.stringify(c.expected)} / 결과 ${JSON.stringify({ income: r.income, laps: r.laps, incomePerLap: r.incomePerLap })}`); }
  // 기록이 결과와 맞는지: 낸 돈의 합 = 수입, 바퀴 끝 기록 수 = 바퀴 수
  const uses = r.events.filter(e => e.type === 'use');
  check(uses.reduce((a, e) => a + e.pay, 0) === r.income, `#${c.id} 기록의 낸 돈 합이 수입과 다르다`);
  check(r.events.filter(e => e.type === 'lapEnd').length === r.laps, `#${c.id} 바퀴 끝 기록 수`);
  check(uses.every(e => e.pay === Math.floor((e.fee + e.add) * e.mult)), `#${c.id} 기록의 계산식`);
}
for (const w of tests.waves) {
  const r = engine.simulateWave(w.board, w.sendOrder);
  const ok = r.waveIncome === w.expected.waveIncome && r.sends.every((s, i) => s.income === w.expected.sends[i].income && s.laps === w.expected.sends[i].laps);
  if (!ok) { caseFail++; console.log(`  어긋남 waves #${w.id}: 기대 ${JSON.stringify(w.expected)} / 결과 ${JSON.stringify(r.sends.map(s => ({ dwarf: s.dwarf, income: s.income, laps: s.laps })))}`); }
}
const total = tests.singleRuns.length + tests.waves.length;
console.log(`[검증 사례] ${total}개 가운데 ${total - caseFail}개 통과`);
fail += caseFail;

// ── 2. 요청서 9.2의 손 계산 ──────────────────────────────────
{
  const board = ['수영장', '헬스장', '고깃집', '신문사', '야외무대', '기념품 가게', '보석상', null, null, null, null, null];
  const p = engine.prepareBoard(board);
  const r = engine.simulateDwarf(p, '삼두 브롬', 0);
  const lap1 = r.events.filter(e => e.type === 'use' && e.lap === 1);
  check(same(lap1.map(e => e.pay), [6, 8, 30, 4, 16, 28]), '9.2 첫 바퀴 칸마다 낸 돈');
  check(same(lap1.map(e => e.after.satisfaction), [1, 2, 3, 3, 3, 3]), '9.2 첫 바퀴 만족도');
  check(formulaText(lap1[2]) === '6 + 허기짐 3 × 8 = 30', '9.2 고깃집 계산식: ' + formulaText(lap1[2]));
  check(lap1[2].after.gauge === 0, '9.2 고깃집 뒤 눈금 0');
  check(same(r.events.filter(e => e.type === 'lapEnd').map(e => e.result), ['base', 'extra', 'extra', 'leave']), '9.2 바퀴 결과');
  check(same(r.events.filter(e => e.type === 'lapEnd').map(e => e.satisfaction), [3, 3, 0, 3]), '9.2 바퀴 뒤 남은 만족도');
  const d = engine.simulateDwarf(p, '지름신 도르카', 0);
  check(d.income === 190 && d.laps === 2, '9.2 도르카 190');
  check(engine.simulateDwarf(p, '삼두 브롬', 4).incomePerLap[0] === 116, '9.2 g=4에서 첫 바퀴 116');
  // 10절: 광산 + 변전소 = 6.25배, 관광 안내소 2 × 광산 2.5 × 도매 시장 1.5 = 7.5배
  check(engine.prepareBoard(['보석상', null, '광산', '변전소', null, null, null, null, null, null, null, null]).mult[0] === 6.25, '변전소 붙은 광산 6.25배');
  check(engine.prepareBoard(['보석상', null, '광산', null, '관광 안내소', null, '도매 시장', null, null, null, null, null]).mult[0] === 7.5, '곱 셋이 걸리면 7.5배');
  // 싫어하는 종류 스위치: 끄면 깎이지 않는다
  const off = engine.simulateDwarf(p, '지름신 도르카', 0, { dislike: false });
  check(off.laps > d.laps, '싫어하는 종류를 끄면 도르카가 더 돈다');
  // 새로고침 값 (5.11)
  check(same([0, 1, 2, 3, 4].map(w => engine.refreshCost(w, 0)), [3, 17, 50, 120, 250]), '첫 새로고침 값');
  check(same([0, 1, 2].map(k => engine.refreshCost(1, k)), [17, 34, 68]), '둘째 웨이브 새로고침 17/34/68');
}

// ── 3. 한 판 진행: 무작위로 누르는 봇을 여러 시드로 돌려 규칙이 지켜지는지 본다 ──
{
  const cfg = data.config;
  const supports = new Set(data.buildings.filter(b => b.group === 'support').map(b => b.name));
  const noDupSupport = g => {
    const names = [...g.state.board, ...g.state.candidates.map(c => c && c.name)].filter(n => n && supports.has(n));
    return new Set(names).size === names.length;
  };
  const play = (seed, record) => {
    const g = createGame(data, { seed });
    const bot = makeRng('bot' + seed);
    const s = g.state;
    g.begin();
    let guard = 0;
    while (s.phase !== 'over' && guard++ < 100) {
      if (s.phase === 'prep') {
        check(s.candidates.every(c => c), `시드 ${seed}: 정비 시작에 후보 5칸이 차 있다`);
        check(noDupSupport(g), `시드 ${seed}: 같은 지원이 보드/후보에 두 번`);
        check(s.buildsLeft === cfg.buildsPerPrep && g.refreshCost() === Math.max(1, Math.floor(g.target() * 0.05)), `시드 ${seed}: 정비 시작 값`);
        if (bot.rand() < 0.5) { const f = bot.int(5); g.toggleFreeze(f); }
        const frozenBefore = s.candidates.map(c => (c && c.frozen ? c.name : null));
        const cost = g.refreshCost(), money = s.money;
        if (g.refresh()) {
          check(s.money === money - cost && g.refreshCost() === cost * 2, `시드 ${seed}: 새로고침 값`);
          check(frozenBefore.every((n, i) => !n || s.candidates[i].name === n), `시드 ${seed}: 얼린 후보가 새로고침에 남는다`);
          check(noDupSupport(g), `시드 ${seed}: 새로고침 뒤 지원 중복`);
        } else check(money < cost || s.candidates.every(c => c && c.frozen), `시드 ${seed}: 새로고침이 막힌 까닭`);
        let built = 0;
        for (let k = 0; k < 8; k++) {
          const empty = s.board.map((b, i) => (b == null ? i : -1)).filter(i => i >= 0);
          if (g.build(bot.int(5), empty[bot.int(empty.length)])) built++;
        }
        check(built === cfg.buildsPerPrep && s.buildsLeft === 0 && s.candidates.filter(c => !c).length === built, `시드 ${seed}: 한 정비에 ${built}채를 지었다`);
        check(!g.build(0, s.board.findIndex(b => b != null)), `시드 ${seed}: 건물이 있는 칸에 지었다`);
        g.move(bot.int(12), bot.int(12));
        const frozen = s.candidates.map(c => (c && c.frozen ? c.name : null));
        record.push(s.board.slice(), s.candidates.map(c => c && c.name));
        g.startWave();
        check(new Set(s.deck).size === 30, `시드 ${seed}: 덱 30마리`);
        s._frozen = frozen;
      } else if (s.phase === 'pick') {
        check(s.choices.length === 3 && !g.build(0, 11) && !g.refresh() && !g.toggleFreeze(0), `시드 ${seed}: 웨이브 중에는 건설/새로고침/얼리기 불가`);
        const i = bot.int(3), money = s.money, gBefore = s.g, pv = g.preview(i);
        const r = g.send(i);
        check(r.income === pv.income && s.money === money + r.income && s.g === gBefore + r.laps && r.lapsDoneBefore === gBefore, `시드 ${seed}: 보내기 결과`);
        record.push(r.dwarf, r.income);
      } else if (s.phase === 'judge') {
        check(s.judge.passed === (s.money >= g.target()), `시드 ${seed}: 판정`);
        check(s.waveSends.length === 3 && s.sendIndex === 3, `시드 ${seed}: 3번 보냈다`);
        const frozen = s._frozen;
        g.proceed();
        if (s.phase === 'prep') check(frozen.every((n, i) => !n || (s.candidates[i].name === n && s.candidates[i].frozen)), `시드 ${seed}: 얼린 후보가 다음 정비에 남는다`);
      }
    }
    check(s.phase === 'over' && (s.outcome === 'clear') === (s.waveResults.length === 5 && s.waveResults[4].passed), `시드 ${seed}: 판이 끝났다`);
    check(s.money >= 0, `시드 ${seed}: 돈이 음수`);
    return s;
  };
  let clears = 0;
  for (let i = 0; i < 300; i++) {
    const a = [], b = [];
    const s = play('T' + i, a); play('T' + i, b);
    check(same(a, b), `시드 T${i}: 같은 시드, 같은 조작인데 판이 다르다`);
    if (s.outcome === 'clear') clears++;
  }
  // 후보 무게: 장사와 흔한 지원 3, 보통 2, 드묾 1
  const g = createGame(data, { seed: 'weights' }); g.begin();
  const count = {};
  for (let i = 0; i < 4000; i++) { g.state.money = 1e9; g.state.refreshCount = 0; g.refresh(); for (const c of g.state.candidates) count[c.name] = (count[c.name] || 0) + 1; }
  const avg = w => { const bs = data.buildings.filter(b => b.weight === w); return bs.reduce((a, b) => a + (count[b.name] || 0), 0) / bs.length; };
  check(avg(3) > avg(2) && avg(2) > avg(1) && avg(1) > 0, `후보 무게 순서: ${avg(3) | 0} / ${avg(2) | 0} / ${avg(1) | 0}`);
  console.log(`[진행 규칙] 무작위 봇 300판 (그중 클리어 ${clears}판), 확인 ${checks}개`);
}

console.log(fail ? `\n실패 ${fail}건` : '\n모두 통과');
process.exit(fail ? 1 : 0);
