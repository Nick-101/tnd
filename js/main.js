import { Game, mulberry32 } from './game.js';
import { Renderer } from './render.js';
import { TndGame } from './tnd-game.js';
import { TndRenderer } from './tnd-render.js';

// ?seed=123 으로 재현 가능한 판, ?mode=stage|tnd 로 타이틀 생략
const params = new URLSearchParams(location.search);
const seedParam = params.get('seed');
const rng = seedParam !== null ? mulberry32(Number(seedParam)) : Math.random;
const app = document.getElementById('app');

function startStage() {
  const game = new Game({ rng });
  window.__game = game;
  window.__renderer = new Renderer(game, app);
}
function startTnd() {
  const game = new TndGame({ rng });
  window.__tnd = game;
  window.__renderer = new TndRenderer(game, app);
}
function title() {
  app.innerHTML = `
    <div id="title-screen" class="screen">
      <div class="card title-card">
        <div class="title-logo">TnD</div>
        <div class="title-sub">주사위 덱빌딩 × 모노폴리 디펜스 — 코어 매커니즘 데모</div>
        <div class="title-buttons">
          <button id="btn-mode-tnd" class="btn btn-red big">고행 — 결합 데모 (v1)</button>
          <button id="btn-mode-stage" class="btn btn-blue big">스테이지 — 주사위 덱빌딩 (v2)</button>
        </div>
        <div class="title-hint">마우스 전용 · 결합 데모: 정비에서 주사위 5개와 기물덱을 편성해 적의 신앙 100을 소진시키세요</div>
      </div>
    </div>`;
  document.getElementById('btn-mode-tnd').addEventListener('click', startTnd);
  document.getElementById('btn-mode-stage').addEventListener('click', startStage);
}
const mode = params.get('mode');
if (mode === 'stage') startStage(); else if (mode === 'tnd') startTnd(); else title();
