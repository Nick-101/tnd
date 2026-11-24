// 밸런스 참고용 봇. 쓰는 법: node test/bot.mjs [런 수]
// 규칙 검증이 아니다(그건 all.test.mjs). "생각 없이 욕심만 부리면 어디까지 가는가"를 어림해 본다.
// 봇: 건설은 후보×빈 칸을 대 보고 덱에서 뽑은 드워프 몇 마리의 평균 매출이 가장 큰 곳에, 업그레이드는 지난 웨이브 매출이 가장 큰 매장에(자금이 목표를 넘고도 남을 때만),
//     드워프는 예상 매출이 가장 큰 쪽을 보낸다. 새로고침, 잠금, 자리 바꾸기, 철거는 하지 않는다.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createGame } from '../js/game.js';

const data = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'yolodwarf2_data.json'), 'utf8'));
const runs = Number(process.argv[2]) || 60;
const reached = {}, finals = [], pays = [], laps = [];
let clears = 0;
for (let n = 0; n < runs; n++) {
  const g = createGame(data, { seed: 'BOT' + n }), s = g.state, e = g.engine;
  const value = () => { const info = g.prep(); let v = 0; for (let k = 0; k < 8; k++) v += e.runDwarf(info, s.deck[(k * 7) % 30], 1, null, { events: false }).sales; return v; };
  while (s.phase !== 'over') {
    if (s.phase === 'stage') g.begin();
    else if (s.phase === 'prep') {
      while (s.buildsLeft > 0) {
        let best = null;
        s.candidates.forEach((cd, slot) => {
          if (!cd) return;
          const empties = s.board.map((b, i) => (b ? -1 : i)).filter(i => i >= 0);
          for (const tile of empties.slice(0, 6)) { s.board[tile] = { id: cd.id, stars: 0, lastSales: null, waveSales: 0 }; const v = value(); s.board[tile] = null; if (!best || v > best.v) best = { v, slot, tile }; }
        });
        if (!best || !g.build(best.slot, best.tile)) break;
      }
      const ups = s.board.map((b, i) => ({ i, u: g.upgradeInfo(i), last: b ? b.lastSales : 0 })).filter(x => x.u.ok && s.money - x.u.cost >= g.target()).sort((a, b) => b.last - a.last);
      if (ups.length) g.upgrade(ups[0].i);
      g.startWave();
    } else if (s.phase === 'pick') { const pv = s.hand.map((_, i) => g.preview(i).sales); g.send(pv.indexOf(Math.max(...pv))); }
    else g.proceed();
  }
  const passed = s.results.filter(r => r.passed).length;
  const key = s.outcome === 'clear' ? '클리어' : `${s.stage + 1}-${s.wave + 1}`;
  reached[key] = (reached[key] || 0) + 1; if (s.outcome === 'clear') clears++;
  finals.push(s.money); pays.push(s.bestPay ? s.bestPay.pay : 0); laps.push(s.maxLaps); void passed;
}
const med = a => a.slice().sort((x, y) => x - y)[a.length >> 1], max = a => Math.max(...a);
console.log(`봇 ${runs}런 · 클리어 ${clears}런`);
console.log('끝난 곳(스테이지-웨이브):', Object.entries(reached).sort().map(([k, v]) => `${k} ${v}`).join(' / '));
console.log(`최종 자금: 중앙값 ${med(finals).toLocaleString()}, 최고 ${max(finals).toLocaleString()} · 한 번에 올린 최고 매출: 중앙값 ${med(pays).toLocaleString()}, 최고 ${max(pays).toLocaleString()} · 최다 바퀴: 중앙값 ${med(laps)}, 최고 ${max(laps)}`);
