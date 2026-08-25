import { Game, mulberry32 } from './game.js';
import { Renderer } from './render.js';

// ?seed=123 으로 재현 가능한 판을 만들 수 있다 (검수용)
const params = new URLSearchParams(location.search);
const seedParam = params.get('seed');
const rng = seedParam !== null ? mulberry32(Number(seedParam)) : Math.random;

const game = new Game({ rng });
const renderer = new Renderer(game, document.getElementById('app'));

// 검수(콘솔 자동화)용 훅
window.__game = game;
window.__renderer = renderer;
