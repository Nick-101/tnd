// 밸런스 참고용 봇. 쓰는 법: node test/bot.mjs [판수]
// 규칙 검증이 아니다(그건 all.test.mjs). "생각하고 두면 어디까지 가는가"를 어림해 본다.
// 봇: 건설은 후보×빈 칸을 모두 대 보고 덱 30마리의 평균 수입이 가장 큰 곳에, 드워프는 예상 수입이 가장 큰 쪽을 보낸다. 새로고침·얼리기·자리 바꾸기는 안 한다.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createGame } from '../js/game.js';

const data = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'yolodwarf_data.json'), 'utf8'));
const games = Number(process.argv[2]) || 200;
const reached = new Array(data.config.waves + 1).fill(0), bests = [];
for (let n = 0; n < games; n++) {
  const g = createGame(data, { seed: 'BOT' + n }), s = g.state, e = g.engine;
  const value = board => { const p = e.prepareBoard(board); return data.dwarves.reduce((a, d) => a + e.simulateDwarf(p, d.name, 2).income, 0); };
  g.begin();
  while (s.phase !== 'over') {
    if (s.phase === 'prep') {
      while (s.buildsLeft > 0) {
        let best = null;
        s.candidates.forEach((c, slot) => { if (!c) return; s.board.forEach((b, tile) => { if (b != null) return; const t = s.board.slice(); t[tile] = c.name; const v = value(t); if (!best || v > best.v) best = { v, slot, tile }; }); });
        if (!best) break;
        g.build(best.slot, best.tile);
      }
      g.startWave();
    } else if (s.phase === 'pick') {
      const pv = s.choices.map((_, i) => g.preview(i).income);
      g.send(pv.indexOf(Math.max(...pv)));
    } else g.proceed();
  }
  reached[s.waveResults.filter(w => w.passed).length]++;
  bests.push(s.bestSend.income);
}
bests.sort((a, b) => a - b);
console.log(`봇 ${games}판 · 통과한 웨이브 수 분포 (0~${data.config.waves}): ${reached.join(' / ')} · 클리어 ${(100 * reached[data.config.waves] / games).toFixed(0)}%`);
console.log(`판마다 최고 수입: 중앙값 ${bests[games >> 1]}, 상위 10% ${bests[Math.floor(games * 0.9)]}, 최고 ${bests[games - 1]}`);
