// 화면 (데모 3.0). 엔진이 돌려준 기록을 재생만 한다. 규칙 계산은 하지 않는다.
// 보드에 손대는 일의 미리 보기는 game.simulate(엔진의 apply)에서 나온다. 실제로 놓는 것과 같은 함수다.
import { createGame } from './game.js';
import { formulaText, fmtNum, fmtMult, gaugeText } from './engine.js';
import { randomSeed } from './rng.js';

const $ = id => document.getElementById(id);
const won = n => Math.round(n).toLocaleString('ko-KR');
const short = n => (n >= 1e8 ? `${(n / 1e8).toFixed(1)}억` : n >= 1e5 ? `${(n / 1e4).toFixed(1)}만` : won(n));   // 칸이 좁을 때 (123.4만)

// ── 데이터 ──────────────────────────────────────────────────
let data;
try {
  data = globalThis.__YOLO_DATA__ ?? await (await fetch('data/yolodwarf3_data.json', { cache: 'no-store' })).json();   // 한 파일로 묶은 판은 데이터를 안에 품고 있다
} catch (e) {
  document.body.innerHTML = `<p style="padding:24px;color:#fff">데이터 파일(data/yolodwarf3_data.json)을 읽지 못했어요. README의 실행 방법대로 <code>npm start</code>로 열었는지, 파일의 쉼표나 따옴표가 깨지지 않았는지 확인해 주세요.<br><br>${e}</p>`;
  throw e;
}
const c = data.constants, H = c.hand;
const WAVES = data.waves.length;
const COLORS = { 운동: '#4fb873', 식당: '#f0923b', 카페: '#c0946a', 술집: '#a078e8', 오락: '#e8574e', 공연: '#f083b8', 쇼핑: '#e3bf3a', 휴식: '#559fec' };
const ICONS = { 운동: '🏋️', 식당: '🍜', 카페: '☕', 술집: '🍺', 오락: '🕹️', 공연: '🎤', 쇼핑: '🛍️', 휴식: '🛏️' };
const SP_ICON = { rotary: '🔄', lucky_spot: '🍀', station_front: '🚉', fertile_land: '🌱', old_site: '🏚️', regulars_alley: '💞', prime_land: '💎', back_door: '🚪' };
const SN = { hunger: '허기', fullness: '포만감', tipsy: '취기', hype: '흥', fatigue: '피로' };
const tasteKinds = c.kinds.filter(k => data.dwarves.some(d => d.likes.includes(k)));
const specials = data.specialTiles || [], guestList = data.guests || [];
const kindColor = k => COLORS[k] || '#888';
const chip = (k, mark = '') => `<span class="chip" style="--c:${kindColor(k)}">${mark}${ICONS[k] || ''} ${k}</span>`;
const kindTok = k => `<span class="kind" style="--c:${kindColor(k)}">${ICONS[k] || ''}${k}</span>`;
const traitOf = id => data.traits.find(t => t.id === id);
const traitBadge = d => (d.trait ? `<span class="trait" title="${traitOf(d.trait).text}">${traitOf(d.trait).name}</span>` : d.guest || d.quirk ? '<span class="trait guestb">귀빈</span>' : '');
const bldDef = id => data.shops.find(x => x.id === id) || data.supports.find(x => x.id === id);
const bldName = id => (bldDef(id) ? bldDef(id).name : id);
const spDef = id => specials.find(x => x.id === id);
const josa = (word, a, b) => { const code = word.charCodeAt(word.length - 1) - 0xac00; return word + (code >= 0 && code <= 11171 && code % 28 ? a : b); };   // 받침에 따라 이/가, 을/를

// 건물 문구를 그린다: [업종]은 아이콘으로, 부호 붙은 숫자는 색을 달리, "(지금 …)"은 지금 값으로.
function rich(text, now = null) {
  let t = text.replace(/\s*\(지금 [^)]*\)/, '');
  t = t.replace(/(매출 ×[\d.]+)/g, '<span class="cmult">$1</span>')
    .replace(/(배율 \+[\d.]+)/g, '<span class="cmult">$1</span>')
    .replace(/(요금 \+\d+)/g, '<span class="cfee">$1</span>')
    .replace(/(만족도 [+×]\d+|★ \+1)/g, '<span class="csat">$1</span>')
    .replace(/((?:허기|포만감|취기|흥|피로|스택) \+\d+)/g, '<span class="cstack">$1</span>')
    .replace(/\[(\S+?)\]/g, (_, k) => kindTok(k));
  return t + (now ? ` <span class="now">(지금 ${now})</span>` : '');
}

// ── 저장되는 것: 최고 기록, 시험용 스위치 ─────────────────────
const store = {
  get(key, fallback) { try { const v = localStorage.getItem('yolodwarf3.' + key); return v == null ? fallback : JSON.parse(v); } catch { return fallback; } },
  set(key, v) { try { localStorage.setItem('yolodwarf3.' + key, JSON.stringify(v)); } catch { /* 저장이 막힌 브라우저 */ } },
};
const DEFAULT_RATE = c.candidateRates.support;
const settings = { targetMult: 1, preview: false, traits: true, supportRate: DEFAULT_RATE, disabled: [], forced: [], guestPicks: ['', '', ''], startSpecial: '', alwaysThree: false, autoSkip: false, ...store.get('settings', {}) };
settings.disabled = settings.disabled.filter(id => data.supports.some(x => x.id === id));   // 데이터에서 빠진 것은 설정에서도 뺀다
settings.forced = settings.forced.filter(id => data.supports.some(x => x.id === id) && !settings.disabled.includes(id)).slice(0, 2);
settings.guestPicks = c.guests.waves.map((_, k) => (guestList.some(g => g.id === settings.guestPicks[k]) ? settings.guestPicks[k] : ''));
if (!spDef(settings.startSpecial)) settings.startSpecial = '';
let record = store.get('record', null);       // 최고 기록 { money, pay, laps }
const switchesOn = () => [
  settings.targetMult !== 1 ? `목표 배율 ${settings.targetMult}` : '', settings.preview ? '예상 매출 미리보기' : '', settings.traits ? '' : '특성 끔',
  settings.supportRate !== DEFAULT_RATE ? `지원 건물이 나올 확률 ${Math.round(settings.supportRate * 100)}` : '',
  settings.forced.length ? `꼭 나오게 하기: ${settings.forced.map(bldName).join(', ')}` : '',
  settings.guestPicks.some(Boolean) ? `귀빈 고르기: ${settings.guestPicks.map((id, k) => (id ? `웨이브 ${c.guests.waves[k]} ${guestList.find(g => g.id === id).name}` : '')).filter(Boolean).join(', ')}` : '',
  settings.startSpecial ? `시작 특수 칸: ${spDef(settings.startSpecial).name}` : '', settings.alwaysThree ? '보상 후보를 늘 셋' : '',
].filter(Boolean);

// ── 화면 상태 ────────────────────────────────────────────────
let game;
const ui = { sel: null, hover: null, playing: false, play: null, speed: store.get('speed', 1), skip: false, wake: null, modal: null, drag: null, logBig: false, recorded: false, copyText: null, reward: { special: null, pos: null }, over: null };

function newGame(seed) {
  game = createGame(data, { seed: seed || randomSeed(), targetMult: settings.targetMult, traits: settings.traits, supportRate: settings.supportRate, disabled: settings.disabled, forced: settings.forced,
    guestPicks: settings.guestPicks.map(x => x || null), startSpecial: settings.startSpecial || null, alwaysThree: settings.alwaysThree });
  Object.assign(ui, { sel: null, hover: null, playing: false, play: null, skip: false, modal: 'intro', recorded: false, copyText: null, reward: { special: null, pos: null }, over: null });
  $('log').innerHTML = '';
  addLog(`새 런 · 난수 씨앗 ${game.state.seed} · 자금 ${won(game.state.st.money)}`, 'mark');
  try { history.replaceState(null, '', '?seed=' + encodeURIComponent(game.state.seed)); } catch { /* 주소를 못 바꾸는 곳 */ }
  render();
}
const isShop = id => !!game.engine.shop(id);
const typeOf = id => (id && game.engine.support(id) ? game.engine.support(id).effect.type : null);
const waveLabel = (w = game.state.wave) => `웨이브 ${w + 1} / ${WAVES}`;
const boardHas = type => game.state.st.board.some(b => typeOf(b) === type);

// ── 보드의 칸 자리: 둥근 네모 트랙. 칸 수가 홀수면 입구 앞에 빈 자리 하나를 둔다 ──
function shape(M) {
  const side = M % 4 === 0 ? (M - 4) / 4 : (M - 6) / 4, top = M % 4 === 0 ? side : side + 1;
  return { cols: top + 2, rows: side + 2, side };
}
function tilePos(i, N) {
  const M = N % 2 ? N + 1 : N, { cols, rows, side } = shape(M);
  if (i < cols) return { r: 1, c: i + 1, dir: i === cols - 1 ? '↓' : '→', corner: i === 0 ? 'tl' : i === cols - 1 ? 'tr' : '' };
  if (i < cols + side) return { r: i - cols + 2, c: cols, dir: '↓', corner: '' };
  if (i < 2 * cols + side) { const k = i - (cols + side); return { r: rows, c: cols - k, dir: k === cols - 1 ? '↑' : '←', corner: k === 0 ? 'br' : k === cols - 1 ? 'bl' : '' }; }
  const k = i - (2 * cols + side);
  return { r: rows - 1 - k, c: 1, dir: i === N - 1 ? '→' : '↑', corner: '' };
}
const sizeClass = N => (N <= 8 ? 'n8' : N <= 12 ? 'n12' : N <= 16 ? 'n16' : 'n20');

// ── 그리기 ──────────────────────────────────────────────────
function render(flip = null) {
  ui.info = ui.playing ? ui.play.out.info : game.info();
  renderTop(); renderBoard(); renderCenter(); renderHud(); renderTray(); renderDetail(); renderModal(); applyHighlights();
  $('side').classList.toggle('logbig', ui.logBig);
  if (flip) playFlip(flip);
}

function nextGuest() {
  const s = game.state;
  for (let k = 0; k < c.guests.waves.length; k++) if (c.guests.waves[k] >= s.wave + 1 && s.guests[k]) return { wave: c.guests.waves[k], g: game.engine.guest(s.guests[k]), k };
  return null;
}
function renderTop() {
  const s = game.state, P = ui.play;
  const money = P ? P.money : s.st.money, target = P ? P.out.target : game.target();
  const best = P ? Math.max(P.out.bestPayBefore, P.bestPay) : (s.bestPay ? s.bestPay.pay : 0);
  const pct = Math.min(100, (money / target) * 100), ng = nextGuest();
  $('top').innerHTML = `
    <div class="brand">욜로드워프 <small>데모 3.0</small></div>
    <div class="stat"><b class="sw">${waveLabel(P ? P.out.wave : s.wave)}</b></div>
    <div class="stat money ${money >= target ? 'hit' : ''}"><label>자금</label><b id="money">${won(money)}</b><label>목표</label><b class="tg">${won(target)}</b>
      <div class="bar"><i style="width:${pct}%"></i></div></div>
    <div class="stat"><label>최고 매출</label><b title="한 번의 이용에서 올린 최고 매출">${short(best)}</b></div>
    <div class="stat"><label>최고 기록</label><b>${record ? short(record.money) : '-'}</b></div>
    ${ng ? `<div class="stat nextguest" data-guest="${ng.k}" title="${ng.g.text}"><label>다음 귀빈: ${ng.g.name} (웨이브 ${ng.wave})</label></div>` : ''}
    <div class="grow"></div>
    ${switchesOn().length || settings.disabled.length ? '<span class="flag">시험용 스위치 켜짐</span>' : ''}
    <button data-act="deck">덱 · 귀빈</button>
    <button data-act="settings">설정</button>
    <button data-act="restart">새 런</button>
    <div class="seed" title="같은 씨앗을 설정에 넣으면 같은 판이 다시 나와요">씨앗 <b>${s.seed}</b></div>`;
}

const viewGrow = () => (ui.play ? ui.play.grow : game.state.st.grow);
const mult10At = j => (10 + viewGrow()[j]) * ui.info.starMult(j);
function tileStats(i) {
  const shop = ui.info.shopAt[i], m = mult10At(i);
  return `<span class="mult ${m > 10 ? 'up' : ''}" title="배율: (1 + 키운 배율) × 2^★">×${fmtMult(m)}</span><span class="fee" title="요금">요금 ${shop.fee}</span>`;
}
// 문구 끝의 "(지금 …)"에 들어갈 지금 값. tile이 null이면 카드다
function nowText(id, tile) {
  const sup = game.engine.support(id); if (!sup || !/\(지금 /.test(sup.text)) return null;
  const e = sup.effect, s = game.state;
  if (e.type === 'likeMost') { const k = tile == null ? ui.info.mostKind : ui.info.likeAll; return k ? kindTok(k) : '없음'; }
  if (sup.waves) return `${tile == null ? sup.waves : s.st.timers[id] ?? sup.waves}번 남음`;
  return null;
}

function bldHTML(i) {
  const s = game.state, st = s.st, p = ui.info, id = st.board[i];
  if (!id) return '';
  const def = bldDef(id);
  if (isShop(id)) {
    const kinds = p.kindsAt[i] || def.kinds, stars = st.stars[i];
    const showTop = p.top === i && (boardHas('branch') || boardHas('guestbook'));
    const merger = st.board.some((b, k) => typeOf(b) === 'merger' && game.engine.reach(st, k).includes(i));
    const marks = (showTop ? '<em class="mk top" title="배율이 가장 높은 매장">👑</em>' : '') + (merger ? '<em class="mk merge" title="대기업 사옥: 웨이브가 끝날 때 양옆 가운데 매출이 낮은 곳이 철거돼요">⚔</em>' : '');
    return `<div class="bld shop" data-uid="${s.uid[i]}"><div class="kbar">${kinds.map(k => `<i style="background:${kindColor(k)}"></i>`).join('')}</div>
      <div class="tname"><span class="nm">${def.name}</span>${stars ? `<span class="stars">${'★'.repeat(stars)}</span>` : ''}${marks}</div>
      <div class="tkind">${kinds.map(k => ICONS[k]).join('')} ${kinds.join(' + ')}</div>
      <div class="tstats">${tileStats(i)}</div></div>`;
  }
  const left = st.timers[id];
  return `<div class="bld support" data-uid="${s.uid[i]}"><div class="kbar"><i></i></div>
    <div class="tname"><span class="nm">${def.name}</span>${left != null ? `<em class="timer" title="웨이브를 ${left}번 더 치르면 사라져요">⏳${left}</em>` : ''}</div>
    <div class="ttext">${rich(def.text, nowText(id, i))}</div></div>`;
}

function renderBoard() {
  const s = game.state, st = s.st, N = st.board.length, M = N % 2 ? N + 1 : N, { cols, rows } = shape(M);
  const canEdit = game.canMove() && !ui.playing;
  let html = '';
  for (let i = 0; i < N; i++) {
    const pos = tilePos(i, N), id = st.board[i], sp = st.tiles[i], spd = sp && spDef(sp);
    const cls = `${pos.corner ? 'corner-' + pos.corner : ''} ${s.phase === 'prep' && s.newTiles.includes(i) ? 'newtile' : ''} ${sp ? 'special' : ''} ${id ? '' : 'empty'}`;
    html += `<div class="tile ${cls}" data-tile="${i}" style="grid-row:${pos.r};grid-column:${pos.c}" draggable="${canEdit && !!id}">
      <span class="tno">${i === 0 ? '입구' : i}</span><span class="arrow">${pos.dir}</span><span class="taste"></span>
      ${spd ? `<em class="spb" title="${spd.name}: ${spd.text}">${SP_ICON[sp] || '✦'} ${spd.name}${st.kept[i] ? ` <b>+${fmtMult(st.kept[i])}</b>` : ''}</em>` : ''}
      ${bldHTML(i)}</div>`;
  }
  html += `<div id="center" style="grid-row:2/${rows};grid-column:2/${cols}"></div><div id="gaps"></div><div id="fx"><div id="token" hidden>🧔</div></div>`;
  const board = $('board');
  board.innerHTML = html;
  board.style.gridTemplateColumns = `repeat(${cols}, 1fr)`; board.style.gridTemplateRows = `repeat(${rows}, 1fr)`;
  board.className = sizeClass(N) + (ui.play && ui.play.fever ? ` fever f${Math.min(ui.play.fever, 4)}` : '') + (placing() ? ' placing' : '') + (s.phase === 'reward' && !ui.modal ? ' rewarding' : '');
  layoutGaps();
  if (ui.play && ui.play.tile >= 0) placeToken(ui.play.tile, 0);
}

// 틈: 이웃한 두 칸의 사이. 0은 마지막 칸과 0번 칸의 사이다. 놓을 것을 들고 있을 때만 보인다
const placing = () => !ui.playing && !!(ui.sel || ui.drag) && game.canMove();
const tileEl = i => document.querySelector(`#board .tile[data-tile="${i}"]`);
const centerOf = el => ({ x: el.offsetLeft + el.offsetWidth / 2, y: el.offsetTop + el.offsetHeight / 2 });
function layoutGaps() {
  const box = $('gaps'), N = game.state.st.board.length, reward = game.state.phase === 'reward';
  let html = '';
  for (let g = reward ? 1 : 0; g <= (reward ? N : N - 1); g++) {
    const a = tileEl((g - 1 + N) % N), b = tileEl(g % N); if (!a || !b) continue;
    const ca = centerOf(a), cb = centerOf(b);
    html += `<div class="gap ${reward && ui.reward.pos === g ? 'chosen' : ''}" data-gap="${g}" style="left:${(ca.x + cb.x) / 2}px;top:${(ca.y + cb.y) / 2}px"></div>`;
  }
  box.innerHTML = html;
}

function renderCenter() {
  const s = game.state, P = ui.play, el = $('center');
  if (!el) return;
  if (P) {
    el.innerHTML = `<div class="cbox"><div class="ctitle">${P.out.dwarf.guest ? '귀빈 ' : ''}${P.out.dwarf.name} <small>${P.fever ? `🔥 추가 바퀴 ${P.fever}` : `바퀴 ${P.lap}`}${P.out.dwarf.guest ? ' · 매출 ×3' : ''}</small></div>
      <div class="cbig">+${won(P.total)}</div>${P.banner ? `<div class="banner ${P.banner.cls}">${P.banner.html}</div>` : ''}</div>`;
  } else if (s.phase === 'judge') {
    const j = s.judge;
    el.innerHTML = `<div class="cbox judge ${j.passed ? 'pass' : 'failj'}"><div class="ctitle">${j.cleared ? '🎉 클리어!' : j.passed ? '목표 달성!' : '런이 끝났어요'}</div>
      ${j.passed ? `<div class="cbig">목표의 ${j.ratio.toFixed(1)}배</div>` : `<div class="csub">목표에 ${won(j.target - j.money)} 모자랐어요.</div>`}
      <button class="primary" data-act="proceed">${j.cleared || !j.passed ? '결과 보기' : j.reward && j.reward.offer.length ? '보상 고르기' : '다음 정비'}</button></div>`;
  } else if (s.phase === 'reward') {
    el.innerHTML = '<div class="cbox"><div class="ctitle">귀빈의 보상</div><div class="csub">특수 칸을 하나 고르고 끼워 넣을 자리를 골라 주세요.</div></div>';
  } else if (s.phase === 'prep') {
    el.innerHTML = `<div class="cbox"><div class="ctitle">정비 <small>${waveLabel()}</small></div><div class="csub">후보에서 2장까지 고르고, 손패의 카드를 보드에 놓으세요.</div></div>`;
  } else if (s.phase === 'pick') {
    el.innerHTML = `<div class="cbox"><div class="ctitle">웨이브 <small>보내기 ${s.sendIndex + 1} / ${game.sendsNow()}</small></div><div class="csub">셋 가운데 하나를 골라 보내세요.</div></div>`;
  } else el.innerHTML = '';
}

const judgeEventText = e => (e.type === 'merger' ? `${josa(e.demolished, '을', '를')} 철거하고 ${e.kept}에 ★을 줬어요.` : `${josa(e.name, '이', '가')} 문을 닫았어요.`);
const guestLine = (g, wave) => `<b>${g.name}</b>${wave ? ` <small>웨이브 ${wave}</small>` : ''} ${g.likes.map(k => chip(k, '♥')).join('')} <span class="gq">${g.text}</span>`;

// 오른쪽 위 창: 걷는 드워프의 스택, 또는 지금 단계의 요약
function renderHud() {
  const s = game.state, P = ui.play, el = $('hud');
  if (P) {
    const d = P.out.dwarf, st = P.st;
    const drunkOn = st.d >= c.thresholds.drunk, fullOn = -st.h >= c.thresholds.full;
    const pos = Math.max(-6, Math.min(6, st.h));
    el.innerHTML = `<div class="hud ${P.fever ? 'fever' : ''}">
      <div class="hud-head"><b>${d.guest ? '👑' : '🧔'} ${d.name}</b>${d.likes.map(k => chip(k, '♥')).join('')}${d.dislike ? chip(d.dislike, '✕') : ''}${traitBadge(d)}
        <span class="lapno">${P.fever ? `🔥 추가 바퀴 ${P.fever}` : `바퀴 ${P.lap} / 기본 ${P.out.baseLaps}`}</span></div>
      ${d.guest ? `<div class="hud-row"><span class="gq">${d.text}</span><span class="state guest">매출 ×${c.guests.payMult}</span></div>` : ''}
      <div class="hud-row"><span class="gauge" title="허기와 포만감은 한 눈금의 양 끝이에요">
        <i class="gl">포만감</i><span class="gtrack"><em style="left:${50 + pos * (50 / 6)}%"></em></span><i class="gr">허기</i></span>
        <b class="${st.h > 0 ? 'hungry' : st.h < 0 ? 'fullv' : ''}">${gaugeText(st.h)}</b>${fullOn ? '<span class="state full">포만 상태</span>' : ''}
        <span class="st">🍺 ${SN.tipsy} <b>${st.d}</b></span>${drunkOn ? '<span class="state drunk">만취 상태</span>' : ''}
        <span class="st">🎵 ${SN.hype} <b>${st.y}</b></span><span class="st">💤 ${SN.fatigue} <b>${st.tired}</b></span></div>
      <div class="hud-row sat"><span class="st">😊 만족도 <b class="${P.sat < 0 ? 'neg' : ''}">${P.sat}</b></span>
        <span class="st">다음 추가 바퀴의 비용 <b>${P.cost}</b></span>
        <span class="pips">${Array.from({ length: Math.min(P.cost, 12) }, (_, k) => `<i class="${k < P.sat ? 'on' : ''}"></i>`).join('')}</span></div>
      <div class="hud-row sums"><span>이 ${d.guest ? '귀빈' : '드워프'}의 매출 <b>${won(P.total)}</b></span><span>이번 웨이브의 매출 <b>${won(P.waveSales)}</b></span></div></div>`;
    return;
  }
  const sends = [...s.waveSends, ...(s.guestRun ? [{ name: `귀빈 ${s.guestRun.name}`, sales: s.guestRun.sales, laps: s.guestRun.laps }] : [])]
    .map((x, i) => `<li>${i + 1}. ${x.name} <b>${won(x.sales)}</b> <small>${x.laps}바퀴</small></li>`).join('');
  const g = game.guestOfWave();
  const guestNote = g ? `<p class="gnote">이번 웨이브의 귀빈: ${guestLine(g)}</p>` : '';
  if (s.phase === 'prep') {
    el.innerHTML = `<h3>정비 <small>${waveLabel()} · ${s.st.board.length}칸${s.newTiles.length ? ' (새 칸 1개)' : ''} · 이번 웨이브에 보낼 횟수 ${game.sendsNow()}</small></h3>
      ${guestNote}
      <p class="dim">후보에서 2장까지 골라 손패에 넣어요. 손패의 카드를 끌거나 누른 뒤, 빈 칸(짓기), 같은 매장(★ +1), 다른 건물(바꿔 짓기), 칸 사이의 틈(끼워 넣기)에 놓으세요. 보드의 건물도 끌어서 옮기거나 틈에 끼워 넣을 수 있어요. 정비를 마칠 때 손패는 ${H.keep}장까지 남아요.</p>`;
  } else if (s.phase === 'pick' || s.phase === 'guest') {
    el.innerHTML = `<h3>웨이브 <small>${waveLabel()} · 보내기 ${Math.min(s.sendIndex + 1, game.sendsNow())} / ${game.sendsNow()}</small></h3>
      <ul class="sends">${sends}</ul>
      <p>이번 웨이브의 매출 <b class="num">${won(s.waveSales)}</b></p>${guestNote}
      <p class="dim">고르기 전에 보드의 건물을 옮기거나 철거할 수 있어요.</p>`;
  } else if (s.phase === 'judge' || s.phase === 'reward') {
    const j = s.judge, rw = j.reward;
    el.innerHTML = `<h3 class="${j.passed ? 'good' : 'bad'}">${j.passed ? '목표 달성!' : '런이 끝났어요'} <small>${waveLabel()}</small></h3>
      <p>자금 <b class="num">${won(j.money)}</b> · 목표 <b class="num">${won(j.target)}</b> · ${j.passed ? `<b class="good">목표의 ${j.ratio.toFixed(1)}배</b>` : `목표에 ${won(j.target - j.money)} 모자랐어요.`}</p>
      <ul class="sends">${sends}</ul>
      ${j.events.length ? `<p class="good">${j.events.map(judgeEventText).join(' ')}</p>` : ''}
      ${rw ? `<p class="good">${rw.offer.length ? `추가 바퀴 ${s.guestRun.extraLaps}번. 특수 칸 후보 ${rw.offer.length}장을 받았어요.` : '추가 바퀴를 돌지 못했어요. 보상이 없어요.'}</p>` : ''}`;
  } else el.innerHTML = `<h3>${waveLabel()}</h3>`;
}

function cardHTML(id, extra = '') {
  const def = bldDef(id);
  return isShop(id)
    ? `<div class="kbar">${def.kinds.map(k => `<i style="background:${kindColor(k)}"></i>`).join('')}</div>
       <div class="cname">${def.name} <small>${def.kinds.map(k => ICONS[k] + k).join(' + ')} · 요금 <b>${def.fee}</b></small>${extra}</div><div class="ctext">${rich(def.text)}</div>`
    : `<div class="kbar"><i></i></div><div class="cname">${def.name} <small>지원 건물</small>${extra}</div><div class="ctext">${rich(def.text, nowText(id, null))}</div>`;
}
function dwarfCard(d, i, extra = '') {
  return `<div class="dwarf ${extra}" data-dwarf="${i}">
    <div class="dname">${d.guest ? '👑' : '🧔'} ${d.name} ${traitBadge(d)}</div>
    <div class="drow"><span class="mark like">♥</span>${d.likes.map(k => chip(k)).join('')}${d.dislike ? `<span class="mark hate">✕</span>${chip(d.dislike)}` : ''}</div>
    ${d.trait ? `<div class="dtrait">${rich(traitOf(d.trait).text)}</div>` : d.guest ? `<div class="dtrait">${d.text} 매출 ×${c.guests.payMult}.</div>` : ''}`;
}
const handRow = live => {
  const s = game.state;
  return `<div class="row"><div class="rlabel">손패<small>${s.hand.length}장${live ? ` · ${H.keep}장까지 남겨요` : ''}</small></div><div class="cards">${s.hand.map((id, h) =>
    `<div class="card ${isShop(id) ? 'shop' : 'support'} ${live ? 'live' : 'idle'} ${ui.sel?.type === 'card' && ui.sel.h === h ? 'sel' : ''}" data-hand="${h}" draggable="${live}">${cardHTML(id)}</div>`).join('') || '<div class="cardnone">손패가 비었어요</div>'}</div></div>`;
};

function renderTray() {
  const s = game.state, t = $('tray');
  const auto = `<label class="auto"><input type="checkbox" data-set="autoSkip" ${settings.autoSkip ? 'checked' : ''}> 계속 결과만 보기</label>`;
  if (ui.playing) {
    const P = ui.play, list = P.out.dwarf.guest ? [P.out.dwarf] : P.out.offer;
    t.innerHTML = `<div class="rows"><div class="row"><div class="rlabel">${P.out.dwarf.guest ? '귀빈' : '드워프'}</div><div class="dwarves">${list.map((d, i) => dwarfCard(d, i, d === P.out.dwarf ? 'chosen' : 'gone') + '</div>').join('')}</div></div>${handRow(false)}</div>
      <div class="actions"><div class="speed">${[1, 2, 4].map(x => `<button data-act="speed" data-x="${x}" class="${ui.speed === x ? 'on' : ''}">${x}배</button>`).join('')}</div>
      <button data-act="skip">결과만 보기 ⏭</button>${auto}</div>`;
  } else if (s.phase === 'prep') {
    const cost = game.refreshCost(), picked = H.picksPerPrep - s.picksLeft;
    t.innerHTML = `<div class="rows"><div class="row"><div class="rlabel">후보<small>${picked} / ${H.picksPerPrep}장 골랐어요</small></div><div class="cards">${s.candidates.map((cd, i) =>
        `<div class="card cand ${isShop(cd.id) ? 'shop' : 'support'} ${cd.picked ? 'picked' : s.picksLeft <= 0 ? 'dimmed' : ''}" data-cand="${i}">${cardHTML(cd.id, cd.built ? '<em class="builttag">지은 매장</em>' : '')}
          ${cd.picked ? '<span class="pickedtag">골랐어요</span>' : `<button class="pickbtn" data-act="pick" data-slot="${i}" ${s.picksLeft > 0 ? '' : 'disabled'}>고르기</button>`}</div>`).join('')}</div></div>
      ${handRow(true)}</div>
      <div class="actions"><button data-act="refresh" ${game.canRefresh() ? '' : 'disabled'}>새로고침 <b>${won(cost)}</b></button>
      <div class="discard ${ui.sel?.type === 'card' || ui.drag?.type === 'card' ? 'ready' : ''}" data-act="discard" data-discard="1">🗑 버리기<small>카드를 여기에 놓거나, 카드를 고르고 누르세요</small></div>
      <button class="primary" data-act="startWave">웨이브 시작</button></div>`;
  } else if (s.phase === 'pick') {
    t.innerHTML = `<div class="rows"><div class="row"><div class="rlabel">드워프<small>보내기 ${s.sendIndex + 1} / ${game.sendsNow()}</small></div><div class="dwarves">${s.hand3.map((d, i) => {
      const pv = settings.preview ? game.previewSend(i) : null;
      return dwarfCard(d, i, 'pickable') + `<div class="dfoot">${pv ? `<span class="pv">예상 매출 ${won(pv.sales)} · ${pv.laps}바퀴</span>` : ''}<button class="primary" data-act="send" data-i="${i}">보내기</button></div></div>`;
    }).join('')}</div></div>${handRow(false)}</div><div class="actions">${auto}</div>`;
  } else if (s.phase === 'reward' && !ui.modal) {
    const rw = s.judge.reward, N = s.st.board.length;
    t.innerHTML = `<div class="rows"><div class="row"><div class="rlabel">보상<small>특수 칸 후보 ${rw.offer.length}장</small></div><div class="cards">${rw.offer.map(id => { const d = spDef(id);
      return `<div class="card sp ${ui.reward.special === id ? 'sel' : ''}" data-act="rewardPick" data-sp="${id}"><div class="cname">${SP_ICON[id] || '✦'} ${d.name} <small>특수 칸</small></div><div class="ctext">${rich(d.text)}</div></div>`; }).join('')}</div></div>
      <div class="row"><div class="rlabel">자리</div><p class="rewardhelp">특수 칸을 하나 고르고 끼워 넣을 자리를 골라 주세요. 보드의 틈(●)을 누르면 그 자리에 새 칸이 생기고, 그 뒤의 칸과 건물이 한 칸씩 밀려요. 0번 칸의 앞에는 넣을 수 없어요. 놓기 전에는 틈을 바꿔 볼 수 있어요.
        ${ui.reward.pos != null ? `<br><b class="good">고른 자리: ${ui.reward.pos === N ? '마지막 칸의 뒤' : `${ui.reward.pos - 1}번 칸과 ${ui.reward.pos}번 칸의 사이`}</b>` : ''}</p></div></div>
      <div class="actions"><button class="primary" data-act="rewardPlace" ${ui.reward.special && ui.reward.pos != null ? '' : 'disabled'}>여기에 끼워 넣기</button></div>`;
  } else t.innerHTML = `<div class="rows">${s.phase === 'intro' ? '' : handRow(false)}</div><div class="actions"></div>`;
}

// ── 살펴보기 창 ──────────────────────────────────────────────
// 매장을 철거하거나 바꿔 지으려 할 때 잃는 것
function lossText(i) {
  const st = game.state.st, id = st.board[i];
  if (!id || !isShop(id)) return '';
  const m = (10 + st.grow[i]) * ui.info.starMult(i);
  return (st.stars[i] || st.grow[i] ? ` ★과 키운 배율(×${fmtMult(m)})이 사라져요.` : '') + (st.tiles[i] === 'old_site' && st.grow[i] ? ` 키운 배율(+${fmtMult(st.grow[i])})은 이 칸에 남아요.` : '');
}
function tileActions(i) {
  const s = game.state, id = s.st.board[i];
  if (!id || !game.canMove() || ui.playing || !(ui.sel?.type === 'tile' && ui.sel.i === i)) return '';
  return `<div class="tacts"><button data-act="demolish" data-tile="${i}">철거</button><small class="why">${lossText(i)}</small></div>`;
}
function detailTile(i) {
  const s = game.state, st = s.st, p = ui.info, id = st.board[i], sp = st.tiles[i], spd = sp && spDef(sp);
  const spLine = spd ? `<p class="spline">${SP_ICON[sp] || '✦'} <b>${spd.name}</b> ${rich(spd.text)}${st.kept[i] ? ` <span class="cmult">칸에 남은 배율 +${fmtMult(st.kept[i])}</span>` : ''}</p>` : '';
  if (!id) return `<h3>${i}번 칸 <small>빈 칸</small></h3>${spLine}<p class="dim">드워프는 그냥 지나가요.</p>`;
  const def = bldDef(id);
  if (!isShop(id)) {
    const t = game.engine.reach(st, i);
    return `<h3>${def.name} <small>${i}번 칸 · 지원 건물</small></h3><p>${rich(def.text, nowText(id, i))}</p>${spLine}${tileActions(i)}
      <p>닿는 칸: ${t.length ? t.map(j => `<b>${j}번${st.board[j] ? ' ' + bldName(st.board[j]) : ' 빈 칸'}</b>`).join(', ') : '<span class="dim">지금은 없어요</span>'}</p>`;
  }
  const kinds = p.kindsAt[i], stars = st.stars[i], g = viewGrow()[i], prime = st.tiles[i] === 'prime_land';
  const tags = [];
  if (p.top === i) tags.push('👑 배율이 가장 높은 매장');
  if (kinds.length > def.kinds.length) tags.push(`구름다리: 업종 ${kinds.slice(def.kinds.length).join(', ')}도 가져요`);
  return `<h3>${def.name}${stars ? ` <span class="stars">${'★'.repeat(stars)}</span>` : ''} <small>${i}번 칸</small> ${kinds.map(k => chip(k)).join('')}</h3><p>${rich(def.text)}</p>${spLine}${tileActions(i)}
    <table class="calc"><tr><th>배율</th><td>(1 + 키운 배율 <span class="cmult">${fmtMult(g)}</span>) × ${c.stars.multPerStar}<sup>★ ${stars}${prime ? ' + 1(금싸라기 땅)' : ''}</sup> = <b>×${fmtMult(mult10At(i))}</b></td></tr>
    <tr><th>요금</th><td>${def.fee}${def.fanMult ? ` <small>· 이 매장을 좋아하는 드워프는 매출 ×${def.fanMult}</small>` : ''}</td></tr></table>
    ${tags.length ? `<p class="good">${tags.join('<br>')}</p>` : ''}`;
}
function renderDetail() {
  const s = game.state, h = ui.hover || (ui.sel?.type === 'tile' ? { type: 'tile', i: ui.sel.i } : ui.sel?.type === 'card' ? { type: 'hand', h: ui.sel.h } : null);
  let html;
  if (h?.type === 'tile' && h.i < s.st.board.length) html = detailTile(h.i);
  else if ((h?.type === 'cand' && s.candidates[h.slot]) || (h?.type === 'hand' && s.hand[h.h])) {
    const id = h.type === 'cand' ? s.candidates[h.slot].id : s.hand[h.h], def = bldDef(id);
    html = `<h3>${def.name} <small>${h.type === 'cand' ? '후보' : '손패'} · ${isShop(id) ? `매장 · 요금 ${def.fee}` : '지원 건물'}</small> ${(def.kinds || []).map(k => chip(k)).join('')}</h3><p>${rich(def.text, nowText(id, null))}</p>
      ${isShop(id) ? '<p class="dim">같은 이름의 매장 위에 놓으면 ★ +1이에요(셋까지).</p>' : '<p class="dim">같은 지원 건물은 한 채만 지을 수 있어요.</p>'}`;
  } else if (h?.type === 'guest') { const g = game.engine.guest(s.guests[h.k]); html = `<h3>귀빈 ${g.name} <small>웨이브 ${c.guests.waves[h.k]}</small></h3><p>${g.likes.map(k => chip(k, '♥')).join('')}</p><p>${g.text}</p><p class="dim">귀빈은 드워프를 다 보낸 뒤에 마지막으로 돌아요. 귀빈이 낸 매출은 ${c.guests.payMult}배예요. 싫어하는 업종이 없어요.</p>`; }
  else if (h?.type === 'dwarf') {
    const d = ui.play ? (ui.play.out.dwarf.guest ? ui.play.out.dwarf : ui.play.out.offer[h.i]) : s.hand3[h.i];
    if (d) {
      const t = game.engine.tastes(s.st, ui.info, d);
      html = `<h3>${d.guest ? '👑' : '🧔'} ${d.name} ${traitBadge(d)}</h3><p>${d.likes.map(k => chip(k, '♥')).join('')} ${d.dislike ? chip(d.dislike, '✕') : ''}${ui.info.likeAll && !d.likes.includes(ui.info.likeAll) ? ` <small>거리 표지판:</small> ${chip(ui.info.likeAll, '♥')}` : ''}</p>
        ${d.trait ? `<p>${rich(traitOf(d.trait).text)}</p>` : d.guest ? `<p>${d.text}</p>` : ''}
        <p>보드에 좋아하는 매장 <b>${t.liked.filter(Boolean).length}곳</b>, 싫어하는 매장 <b>${t.disliked.filter(Boolean).length}곳</b></p>
        <p class="dim">좋아하는 매장을 이용하면 만족도 +1과 피로 +1, 싫어하는 매장이면 만족도가 1 내려요. 기본 바퀴를 다 돈 뒤 만족도가 추가 바퀴의 비용(3, 6, 12, 24…) 이상이면 그만큼 내고 한 바퀴를 더 돌아요.</p>`;
    }
  }
  if (!html) html = '<h3>살펴보기</h3><p class="dim">건물, 카드, 드워프, 귀빈에 마우스를 올리면 여기에 풀이가 나와요. 지원 건물은 닿는 칸이 보드에 밝혀져요. 색이 다른 칸은 특수 칸이에요.</p>';
  $('detail').innerHTML = html;
}

// 마우스가 올라간 것에 따라 보드에 표시를 한다. 칸을 다시 그리지 않는다(끌기가 끊기지 않게).
function applyHighlights() {
  const s = game.state, st = s.st, p = ui.info, h = ui.hover || (ui.sel?.type === 'tile' ? { type: 'tile', i: ui.sel.i } : null);
  const tiles = [...document.querySelectorAll('#board .tile')];
  const d = h?.type === 'dwarf' ? (ui.play ? (ui.play.out.dwarf.guest ? ui.play.out.dwarf : ui.play.out.offer[h.i]) : s.hand3[h.i]) : ui.play ? ui.play.out.dwarf : null;
  const t = d ? game.engine.tastes(st, p, d) : null;
  const reach = h?.type === 'tile' && st.board[h.i] && !isShop(st.board[h.i]) ? game.engine.reach(st, h.i) : [];
  tiles.forEach((el, i) => {
    el.classList.remove('hl-target', 'hl-self', 'sel', 'like', 'dislike');
    const like = t && t.liked[i], dis = t && t.disliked[i];
    el.querySelector('.taste').textContent = like ? '♥' : dis ? '✕' : '';
    if (like) el.classList.add('like'); else if (dis) el.classList.add('dislike');
    if (h?.type === 'tile' && h.i === i) el.classList.add('hl-self');
    if (reach.includes(i)) el.classList.add('hl-target');
    if (ui.sel?.type === 'tile' && ui.sel.i === i) el.classList.add('sel');
  });
}

// ── 놓기 전의 미리 보기 ──────────────────────────────────────
function hint(el, text, cls = '') {
  const h = $('hint');
  if (!el || !text) { h.hidden = true; return; }
  const r = el.getBoundingClientRect(), a = $('app').getBoundingClientRect();
  h.textContent = text; h.className = cls; h.hidden = false;
  h.style.left = Math.max(120, Math.min(a.width - 120, r.left - a.left + r.width / 2)) + 'px'; h.style.top = r.top - a.top - 6 + 'px';
}
function clearPreview() {
  document.querySelectorAll('#board .bld').forEach(b => { b.style.transform = ''; b.classList.remove('shifting'); });
  document.querySelectorAll('#board .tile.incoming, #board .tile.over, #board .tile.willshift, #board .tile.doomed').forEach(t => t.classList.remove('incoming', 'over', 'willshift', 'doomed'));
  document.querySelectorAll('#board .gap.hot').forEach(g => g.classList.remove('hot'));
  document.querySelector('#fx .ghost')?.remove();
  hint(null);
}
const held = () => ui.drag || ui.sel;
// 틈 위에 올렸을 때: 밀릴 건물 전부가 움직일 방향으로 반 칸쯤 비켜나고, 벌어진 자리에 놓을 건물이 흐리게 보인다
function previewGap(g) {
  clearPreview();
  const s = game.state, what = held(), gapEl = document.querySelector(`#board .gap[data-gap="${g}"]`);
  if (!what || !gapEl) return;
  const op = what.type === 'card' ? { type: 'insert', gap: g, id: s.hand[what.h] } : { type: 'insert', gap: g, from: what.i };
  const r = game.simulate(op);
  if (r.illegal) { if (what.type === 'card' && !s.st.board.includes(null)) hint(gapEl, '빈 칸이 없어요. 겹치거나 바꿔 지을 수 있어요.', 'bad'); else if (what.type === 'card') hint(gapEl, '같은 지원 건물은 한 채만 지을 수 있어요.', 'bad'); return; }
  gapEl.classList.add('hot');
  const movedUid = what.type === 'tile' ? s.uid[what.i] : -1;
  let dest = r.uid.indexOf(movedUid);
  r.uid.forEach((u, j) => {
    if (u <= 0 || u === movedUid) return;
    const from = s.uid.indexOf(u); if (from === j) return;
    const a = centerOf(tileEl(from)), b = centerOf(tileEl(j)), el = tileEl(from).querySelector('.bld');
    if (el) { el.style.transform = `translate(${(b.x - a.x) / 2}px, ${(b.y - a.y) / 2}px)`; el.classList.add('shifting'); }
    if (s.st.tiles[j]) tileEl(j).classList.add('incoming');   // 특수 칸으로 밀려 들어간다: 능력이 바뀐다
  });
  if (dest >= 0) {
    const id = what.type === 'card' ? s.hand[what.h] : s.st.board[what.i], ghost = document.createElement('div');
    ghost.className = 'ghost'; ghost.textContent = bldName(id);
    ghost.style.left = gapEl.style.left; ghost.style.top = gapEl.style.top;
    $('fx').appendChild(ghost);
    if (s.st.tiles[dest]) tileEl(dest).classList.add('incoming');
    hint(gapEl, `끼워 넣기 → ${dest}번 칸${s.st.tiles[dest] ? ` (${spDef(s.st.tiles[dest]).name})` : ''}`);
  }
}
// 칸 위에 올렸을 때: 무슨 일이 일어날지
function previewTile(i) {
  clearPreview();
  const s = game.state, st = s.st, what = held(), el = tileEl(i);
  if (!what || !el) return;
  if (what.type === 'tile') { if (what.i !== i) { el.classList.add('over'); hint(el, st.board[i] ? '자리 바꾸기' : '옮기기'); } return; }
  const id = s.hand[what.h], op = game.cardOp(id, i), r = game.simulate(op);
  el.classList.add('over');
  if (op.type === 'build') hint(el, '짓기');
  else if (op.type === 'overlap') hint(el, r.illegal ? '★이 가득 찼어요.' : '★ +1', r.illegal ? 'bad' : 'good');
  else if (r.illegal) hint(el, '같은 지원 건물은 한 채만 지을 수 있어요.', 'bad');
  else { el.classList.add('doomed'); hint(el, `${josa(bldName(st.board[i]), '이', '가')} 철거돼요.${lossText(i)}`, 'warn'); }
}
// 보상의 자리를 고를 때: 그 뒤의 칸들이 밀린다는 것을 보여 준다
function previewReward(pos) {
  document.querySelectorAll('#board .tile.willshift').forEach(t => t.classList.remove('willshift'));
  if (pos == null) return;
  for (let j = pos; j < game.state.st.board.length; j++) tileEl(j)?.classList.add('willshift');
}
// 놓은 뒤: 밀린 건물들이 제자리로 미끄러져 들어간다
function snapshot() { const m = new Map(); document.querySelectorAll('#board .bld[data-uid]').forEach(b => { const r = b.getBoundingClientRect(); m.set(b.dataset.uid, { x: r.left, y: r.top }); }); return m; }
function playFlip(before) {
  document.querySelectorAll('#board .bld[data-uid]').forEach(b => {
    const old = before.get(b.dataset.uid), r = b.getBoundingClientRect();
    if (!old) { b.classList.add('placed'); return; }
    const dx = old.x - r.left, dy = old.y - r.top; if (Math.abs(dx) + Math.abs(dy) < 2) return;
    b.style.transition = 'none'; b.style.transform = `translate(${dx}px, ${dy}px)`;
    requestAnimationFrame(() => requestAnimationFrame(() => { b.style.transition = 'transform .28s ease'; b.style.transform = ''; setTimeout(() => { b.style.transition = ''; }, 320); }));
  });
}

// ── 창: 런 시작/덱, 설정, 끝 ─────────────────────────────────
function runInfoHTML() {
  const s = game.state, cur = w => (w === s.wave ? 'cur' : '');
  const rows = tasteKinds.map(k => {
    const likes = s.deck.filter(d => d.likes.includes(k)).length, hates = s.deck.filter(d => d.dislike === k).length;
    return `<tr><td>${chip(k)}</td><td class="barcell"><span class="mark like">♥</span><i class="b like" style="width:${likes * 13}px"></i> ${likes}</td>
      <td class="barcell"><span class="mark hate">✕</span><i class="b hate" style="width:${hates * 13}px"></i> ${hates}</td></tr>`;
  }).join('');
  const traitCount = data.traits.map(t => `<span class="trait" title="${t.text}">${t.name}</span> ${s.deck.filter(d => d.trait === t.id).length}`).join(' · ');
  const sp = s.start.special && spDef(s.start.special);
  return `<h3>귀빈</h3><ul class="guests">${s.guests.map((id, k) => (id ? `<li>${guestLine(game.engine.guest(id), c.guests.waves[k])}</li>` : '')).join('')}</ul>
    <p class="dim">귀빈은 그 웨이브의 드워프를 다 보낸 뒤에 마지막으로 돌아요. 매출이 ${c.guests.payMult}배예요. 웨이브 ${c.guests.rewardWaves.join(', ')}의 귀빈은 추가 바퀴를 돈 횟수만큼(셋까지) 특수 칸 후보를 줘요.</p>
    ${sp ? `<h3>시작 보드의 특수 칸</h3><p>${SP_ICON[sp.id] || '✦'} <b>${sp.name}</b> <small>${s.start.tile}번 칸</small> ${rich(sp.text)}</p>` : ''}
    <h3>덱 ${s.deck.length}마리</h3>
    <table class="deckbars"><tr><th>업종</th><th>좋아하는 드워프</th><th>싫어하는 드워프</th></tr>${rows}</table>
    <p>특성: ${s.deck.some(d => d.trait) ? traitCount : '<span class="dim">없음</span>'}</p>
    <details><summary>카드 ${s.deck.length}장 펼쳐 보기</summary><div class="deckgrid">${s.deck.map(d =>
      `<div class="mini"><b>${d.name}</b>${traitBadge(d)}<span>${d.likes.map(k => chip(k, '♥')).join('')}</span><span>${chip(d.dislike, '✕')}</span></div>`).join('')}</div></details>
    <table class="targets"><tr><th>웨이브</th>${data.waves.map((x, w) => `<td class="${cur(w)}">${w + 1}${c.guests.waves.includes(w + 1) ? '👑' : ''}</td>`).join('')}</tr>
      <tr><th>칸</th>${data.waves.map((x, w) => `<td class="${cur(w)}">${x.tiles}</td>`).join('')}</tr>
      <tr><th>목표</th>${data.waves.map((_, w) => `<td class="${cur(w)}">${short(game.targetOf(w))}</td>`).join('')}</tr>
      <tr><th>새로고침</th>${data.waves.map((x, w) => `<td class="${cur(w)}">${won(x.refreshBase)}</td>`).join('')}</tr></table>`;
}

const sel = (key, opts, idx = null) => `<select data-setv="${key}" ${idx != null ? `data-idx="${idx}"` : ''}>${opts.map(([v, label]) => `<option value="${v}" ${(idx != null ? settings[key][idx] : settings[key]) === v ? 'selected' : ''}>${label}</option>`).join('')}</select>`;
const chk = (key, label, note) => `<label class="sw"><input type="checkbox" data-set="${key}" ${settings[key] ? 'checked' : ''}> <b>${label}</b> <small>${note}</small></label>`;

// 끝 화면의 "기록 복사"에 들어갈 글 (제작 요청서 7절. 덱의 인기·비인기 업종은 이 판에 없다)
function recordText() {
  const s = game.state, st = s.st, list = a => (a.length ? a.map(bldName).join(', ') : '-');
  const lines = [
    `욜로드워프 데모 3.0 기록 (${data.version || ''} ${data.date || ''})`,
    `난수 씨앗: ${s.seed}`,
    `켜 둔 스위치: ${switchesOn().join(' / ') || '없음'}`,
    `끈 건물: ${s.options.disabled.length ? s.options.disabled.map(bldName).join(', ') : '없음'}`,
    `귀빈: ${s.guests.map((id, k) => `웨이브 ${c.guests.waves[k]} ${id ? game.engine.guest(id).name : '-'}`).join(', ')}`,
    `시작 특수 칸: ${s.start.special ? `${spDef(s.start.special).name} (${s.start.tile}번 칸)` : '없음'}`,
    `결과: ${s.outcome === 'clear' ? '클리어' : `웨이브 ${s.wave + 1}에서 끝`} · 최종 자금 ${won(st.money)} · 닿은 웨이브 ${s.wave + 1} / ${WAVES} · 한 번의 이용에서 올린 최고 매출 ${won(s.bestPay ? s.bestPay.pay : 0)} · 최다 바퀴 ${s.maxLaps}바퀴`,
    '',
  ];
  s.results.forEach((r, w) => {
    const l = s.log[w];
    lines.push(`[웨이브 ${w + 1}] 목표 ${won(r.target)} · 매출 ${won(r.sales)} · 끝났을 때 자금 ${won(r.moneyAfter)} · ${r.passed ? `목표의 ${(r.moneyAfter / r.target).toFixed(1)}배` : '모자람'}`);
    lines.push(`  후보에 나온 카드: ${list(l.offered)}`);
    lines.push(`  고른 카드: ${list(l.picked)}`);
    lines.push(`  카드를 쓴 것: ${l.used.join(' / ') || '-'}`);
    lines.push(`  철거한 건물: ${l.demolished.join(', ') || '-'}`);
    lines.push(`  새로고침: ${l.refreshes}번`);
    lines.push(`  보낸 드워프: ${r.sends.map(x => `${x.name} ${x.laps}바퀴 ${won(x.sales)}`).join(' · ')}`);
    if (r.guest) lines.push(`  귀빈 ${r.guest.name}: 추가 바퀴 ${r.guest.extraLaps}번 · 매출 ${won(r.guest.sales)}${l.reward ? ` · 보상 후보 ${l.reward.offer.map(id => spDef(id).name).join(', ') || '없음'}${l.reward.chosen ? ` · 고른 특수 칸 ${spDef(l.reward.chosen).name} (${l.reward.pos}번 칸 자리)` : ''}` : ''}`);
  });
  lines.push('', `마지막 보드 (${st.board.length}칸, 0번이 입구):`);
  const info = game.info();
  lines.push(st.board.map((b, i) => `  ${i}: ${b ? bldName(b) + '★'.repeat(st.stars[i]) + (isShop(b) ? ` ×${fmtMult((10 + st.grow[i]) * info.starMult(i))}` : '') + (st.timers[b] != null ? ` (${st.timers[b]}번 남음)` : '') : '-'}${st.tiles[i] ? ` [${spDef(st.tiles[i]).name}${st.kept[i] ? ` +${fmtMult(st.kept[i])}` : ''}]` : ''}`).join('\n'));
  return lines.join('\n');
}

function renderModal() {
  const m = $('modal'), s = game.state;
  const kind = s.phase === 'over' && ui.modal !== 'settings' && ui.modal !== 'deck' ? 'over' : s.phase === 'intro' && !ui.modal ? 'intro' : ui.modal;
  if (!kind) { m.innerHTML = ''; m.className = ''; return; }
  m.className = 'open';
  let h = '';
  if (kind === 'intro' || kind === 'deck') {
    const intro = s.phase === 'intro';
    h = `<h2>${intro ? '런 시작' : '덱 · 귀빈'} <small>자금 ${won(s.st.money)}</small></h2>
      ${intro ? `<p>거리에 건물을 짓고, 드워프가 그 거리를 돌며 매장마다 돈을 내요. 지원 건물은 드워프가 지나갈 때 매장의 배율을 키우고, 키운 배율은 런 내내 남아요. 웨이브 ${WAVES}번, 웨이브가 끝났을 때 <b>자금이 목표 이상</b>이면 통과예요.</p>` : ''}
      ${runInfoHTML()}
      <div class="mfoot">${intro ? '<button data-act="settings">설정 · 시험용 스위치</button><button class="primary" data-act="begin">정비 시작</button>' : '<button data-act="close">닫기</button>'}</div>`;
  } else if (kind === 'settings') {
    const gopts = [['', '무작위'], ...guestList.map(g => [g.id, g.name])];
    h = `<h2>설정 · 시험용 스위치 <small>예상 매출 미리보기와 계속 결과만 보기를 뺀 나머지는 새 런부터예요.</small></h2>
      <div class="sw"><b>목표 배율</b> ${sel('targetMult', [[0.5, '0.5'], [1, '1 (기본)'], [2, '2'], [4, '4']])} <b class="gapl">지원 건물이 나올 확률</b> ${sel('supportRate', [[0.3, '30'], [DEFAULT_RATE, `${Math.round(DEFAULT_RATE * 100)} (기본)`], [0.6, '60']])} <small>확률은 100장에 몇 장인지예요. 나머지가 매장이에요.</small></div>
      <div class="sw two">${chk('preview', '예상 매출 미리보기', '드워프 셋을 고를 때 예상 매출을 보여 줘요.')}${chk('traits', '특성', '끄면 특성 없이 덱을 짜요.')}</div>
      <div class="sw"><b>귀빈 고르기</b> ${c.guests.waves.map((w, k) => `웨이브 ${w} ${sel('guestPicks', gopts, k)}`).join(' ')}</div>
      <div class="sw"><b>시작 특수 칸</b> ${sel('startSpecial', [['', '무작위'], ...specials.map(x => [x.id, x.name])])} <label class="inl"><input type="checkbox" data-set="alwaysThree" ${settings.alwaysThree ? 'checked' : ''}> <b>보상 후보를 늘 셋</b></label> <small>켜면 귀빈의 추가 바퀴와 상관없이 보상 후보가 셋 나와요.</small></div>
      <div class="sw"><b>건물 끄기</b> <small>체크를 푼 지원 건물은 후보와 시작 손패에 나오지 않아요. 설정은 다음 판에도 남아요.</small>
        <div class="bldgrid">${data.supports.map(x => `<label title="${x.text}"><input type="checkbox" data-bld="${x.id}" ${settings.disabled.includes(x.id) ? '' : 'checked'}> ${x.name}</label>`).join('')}</div>
        <button data-act="allOn" class="mini-btn">모두 켜기</button></div>
      <div class="sw"><b>꼭 나오게 하기</b> <small>둘까지 골라요. 고른 건물이 첫 정비의 후보에 들어가요. (지금 ${settings.forced.length} / 2)</small>
        <div class="bldgrid force">${data.supports.filter(x => !settings.disabled.includes(x.id)).map(x => `<label title="${x.text}"><input type="checkbox" data-force="${x.id}" ${settings.forced.includes(x.id) ? 'checked' : ''} ${!settings.forced.includes(x.id) && settings.forced.length >= 2 ? 'disabled' : ''}> ${x.name}</label>`).join('')}</div></div>
      <div class="sw"><b>난수 씨앗</b> <input id="seed-in" value="${s.seed}" spellcheck="false"> <button data-act="seedGo">이 씨앗으로 새 런</button> <button data-act="seedRandom">무작위 새 런</button></div>
      <div class="sw two">${chk('autoSkip', '계속 결과만 보기', '드워프가 도는 것을 건너뛰어요.')}<div class="sw"><b>최고 기록</b> ${record ? won(record.money) : '없음'} <button data-act="clearRecord" class="mini-btn">지우기</button></div></div>
      <div class="mfoot"><button data-act="close">닫기</button></div>`;
  } else if (kind === 'over') {
    const last = s.results[s.results.length - 1];
    const rows = s.results.map(w => `<tr class="${w.passed ? '' : 'bad'}"><td>${w.wave + 1}</td><td>${won(w.target)}</td><td><b>${won(w.sales)}</b></td><td>${won(w.moneyAfter)}</td>
      <td>${w.passed ? `${(w.moneyAfter / w.target).toFixed(1)}배` : '모자람'}</td><td class="l">${w.sends.map(x => `${x.name} ${won(x.sales)}(${x.laps}바퀴)`).join(' · ')}${w.guest ? ` · 👑${w.guest.name} ${won(w.guest.sales)}(추가 ${w.guest.extraLaps})` : ''}</td></tr>`).join('');
    h = `<h2>${s.outcome === 'clear' ? `🎉 클리어! 웨이브 ${WAVES}개를 모두 통과했어요` : `런이 끝났어요 <small>${last ? `목표에 ${won(last.target - last.moneyAfter)} 모자랐어요.` : ''}</small>`}</h2>
      <div class="records">
        <div><label>최종 자금</label><b class="big">${won(s.st.money)}</b></div>
        <div><label>닿은 곳</label><b>${waveLabel()}</b></div>
        <div><label>한 번의 이용에서 올린 최고 매출</label><b>${won(s.bestPay ? s.bestPay.pay : 0)}</b></div>
        <div><label>최다 바퀴</label><b>${s.maxLaps}바퀴</b></div>
        <div><label>최고 기록</label><b>${record ? won(record.money) : '-'}</b>${ui.newRecord ? '<em class="newrec">새 기록!</em>' : ''}</div></div>
      <div class="resultwrap"><table class="result"><tr><th>웨이브</th><th>목표</th><th>매출</th><th>끝났을 때 자금</th><th>목표의</th><th>보낸 드워프와 귀빈</th></tr>${rows}</table></div>
      ${ui.copyText != null ? `<textarea id="copy-out" readonly>${ui.copyText.replace(/</g, '&lt;')}</textarea>` : ''}
      <div class="mfoot"><span class="dim">씨앗 ${s.seed}</span><button data-act="copyRecord">기록 복사</button><button data-act="sameSeed">같은 씨앗으로 다시</button><button class="primary" data-act="restart">다시 하기</button></div>`;
  }
  m.innerHTML = `<div class="sheet ${kind}">${h}</div>`;
}

// ── 기록 창, 알림 ────────────────────────────────────────────
function addLog(html, cls = '') {
  const el = document.createElement('div');
  el.className = 'line ' + cls; el.innerHTML = html;
  const log = $('log'); log.appendChild(el);
  while (log.childElementCount > 1500) log.firstElementChild.remove();
  log.scrollTop = log.scrollHeight;
}
function toast(text, cls = '') {
  const el = document.createElement('div');
  el.className = 'toast ' + cls; el.textContent = text;
  const box = $('toasts');
  box.appendChild(el); setTimeout(() => el.remove(), 3000);
  while (box.childElementCount > 4) box.firstElementChild.remove();
}
const diff = (label, a, b) => (a === b ? '' : `${label} ${a}→${b}`);
const stackChanges = (a, b) => [a.h === b.h ? '' : `${gaugeText(a.h)}→${gaugeText(b.h)}`, diff(SN.tipsy, a.d, b.d), diff(SN.hype, a.y, b.y), diff(SN.fatigue, a.tired, b.tired)].filter(Boolean);
function changes(ev) {
  const a = ev.before, b = ev.after, parts = stackChanges(a, b);
  if (a.sat !== b.sat) parts.push(`만족도 ${a.sat}→${b.sat}${ev.satChange > 0 ? ' ♥' : ev.satChange < 0 ? ' ✕' : ''}${ev.restGain ? ` (휴식 +${ev.restGain})` : ''}`);
  return parts.join(' · ') || '변화 없음';
}

// ── 재생: 엔진이 돌려준 기록을 차례로 보여 준다 ───────────────
const TIME = { pass: 60, move: 180, use: 430, skip: 340, grow: 200, lapEnd: 1100, leave: 950 };
const feverRate = () => (ui.play ? Math.min(3, 1 + 0.35 * ui.play.fever) : 1);   // 추가 바퀴를 거듭할수록 빨라진다
function wait(ms) {
  if (ui.skip) return Promise.resolve();
  return new Promise(res => { const t = setTimeout(done, ms / (ui.speed * feverRate())); function done() { clearTimeout(t); ui.wake = null; res(); } ui.wake = done; });
}
function placeToken(i, ms) {
  const el = tileEl(i), tk = $('token');
  if (!el || !tk) return;
  tk.hidden = false; tk.textContent = ui.play && ui.play.out.dwarf.guest ? '👑' : '🧔';
  tk.style.transitionDuration = ms + 'ms';
  tk.style.left = el.offsetLeft + el.offsetWidth / 2 + 'px';
  tk.style.top = el.offsetTop + el.offsetHeight - 6 + 'px';
  tk.className = (ui.play && ui.play.out.dwarf.guest ? 'guest ' : '') + (ui.play && ui.play.fever ? `fever f${Math.min(ui.play.fever, 4)}` : '');
}
function popup(i, html, cls) {
  if (ui.skip) return;
  const el = tileEl(i), fx = $('fx');
  if (!el || !fx) return;
  const p = document.createElement('div');
  p.className = 'pop ' + cls; p.innerHTML = html;
  p.style.left = Math.max(70, Math.min(fx.offsetWidth - 70, el.offsetLeft + el.offsetWidth / 2)) + 'px';
  const stack = fx.querySelectorAll(`.pop[data-at="${i}"]:not(.growpop)`).length;   // 같은 칸에 연달아 뜨면 조금씩 위로
  p.dataset.at = i;
  p.style.top = el.offsetTop + el.offsetHeight * (cls === 'growpop' ? 0.15 : 0.6) - (cls === 'growpop' ? 0 : (stack % 3) * 24) + 'px';
  const life = 1500 / Math.pow(ui.speed * feverRate(), 0.7);
  p.style.animationDuration = life + 'ms';
  fx.appendChild(p); setTimeout(() => p.remove(), life + 50);
}
function flash(i, cls) {
  const el = tileEl(i);
  if (!el || ui.skip) return;
  el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls);
}

function applyUse(ev, P) {
  const out = P.out, shop = out.info.shopAt[ev.shopTile];
  P.st = { h: ev.after.h, d: ev.after.d, y: ev.after.y, tired: ev.after.tired }; P.sat = ev.after.sat; P.total = ev.total;
  if (ev.pay > P.bestPay) P.bestPay = ev.pay;
  const moneyBefore = P.money;
  P.money = out.moneyBefore + ev.total; P.waveSales = out.waveSalesBefore + ev.total;
  const formula = formulaText(ev, SN);
  const tag = ev.via === 'roundabout' ? ' (회전교차로)' : ev.via === 'again' ? ' (역 앞: 한 번 더)' : '';
  const where = ev.via === 'branch' ? `2호점→${shop.name}` : shop.name + tag;
  const via = ev.via === 'roundabout' ? '<i class="via">↩ 회전교차로</i>' : ev.via === 'branch' ? `<i class="via">2호점 → ${shop.name}</i>` : ev.via === 'again' ? '<i class="via">역 앞: 한 번 더</i>' : '';
  const size = Math.min(44, 16 + 5.5 * Math.log10(ev.pay + 1));
  const satMark = (ev.satChange > 0 ? '<span class="s like">♥ 만족도 +1</span>' : ev.satChange < 0 ? '<span class="s hate">✕ 만족도 −1</span>' : '')
    + (ev.restGain ? `<span class="s rest">💤 ${SN.fatigue} ${ev.restFrom} → 만족도 +${ev.restGain}</span>` : '');
  popup(ev.tile, `${via}<b style="font-size:${size}px">+${won(ev.pay)}</b><span class="f">${formula}</span>${satMark}`, ev.pay >= 50000 ? 'pay huge' : ev.pay >= 2000 ? 'pay big' : 'pay');
  flash(ev.tile, ev.pay >= 10000 ? 'paid-big' : 'paid');
  if (ev.via === 'branch') flash(ev.shopTile, 'paid');
  addLog(`<span class="lt">바퀴${ev.lap} · ${ev.tile}번</span><b>${where}</b><span class="lf">${formula}</span><span class="lp">+${won(ev.pay)}</span><span class="ls">${changes(ev)}</span>`);
  if (moneyBefore < out.target && P.money >= out.target) { toast(`🎯 목표 달성! ${won(out.target)}`, 'goal'); addLog(`🎯 자금이 목표 ${won(out.target)}을 넘었어요`, 'mark'); }
  if (!P.broke && out.bestPayBefore > 0 && ev.pay > out.bestPayBefore) { P.broke = true; toast(`⭐ 한 번의 이용에서 올린 최고 매출 ${won(ev.pay)}`, 'record'); }
}

const SKIP_TEXT = { drunk: '지나침 (만취)', full: '지나침 (포만)', unliked: '좋아하지 않는 매장이라 지나쳐요.' };
function applySkip(ev, P) {
  const shop = P.out.info.shopAt[ev.shopTile], why = SKIP_TEXT[ev.skip];
  popup(ev.tile, `<b>🚫 ${why}</b>`, 'refuse');
  flash(ev.tile, 'refused');
  addLog(`<span class="lt">바퀴${ev.lap} · ${ev.tile}번</span><b>${ev.via === 'branch' ? `2호점→${shop.name}` : shop.name}</b><span class="lr">${why}</span><span class="ls">${ev.skip === 'drunk' ? `${SN.tipsy} ${ev.before.d}` : ev.skip === 'full' ? gaugeText(ev.before.h) : ''}</span>`, 'refuse');
}
// 산책로, 버스킹 존: 지나갈 때 스택이 바뀐다. 바뀐 것이 없으면 보여 주지 않는다
function applyPass(ev, P) {
  const ch = stackChanges(ev.before, ev.after);
  P.st = { h: ev.after.h, d: ev.after.d, y: ev.after.y, tired: ev.after.tired };
  if (!ch.length) return false;
  popup(ev.tile, `<b>${ch.join('<br>')}</b>`, 'passpop');
  flash(ev.tile, 'paid');
  addLog(`<span class="lt">바퀴${ev.lap} · ${ev.tile}번</span><b>${bldName(game.state.st.board[ev.tile])}</b><span class="ls">${ch.join(' · ')}</span>`, 'passl');
  return true;
}
// 키우는 건물이 발동했다: 어느 지원 건물이 어느 매장을 얼마나 키웠는지
function applyGrow(ev, P) {
  const st = game.state.st;
  flash(ev.tile, 'fired');
  for (const ch of ev.changes) {
    P.grow[ch.tile] = ch.now;
    const el = tileEl(ch.tile);
    if (el && !ui.skip) { const ts = el.querySelector('.tstats'); if (ts) ts.innerHTML = tileStats(ch.tile); }
    popup(ch.tile, `<b>배율 +${fmtMult(ch.amount)}</b>`, 'growpop');
    flash(ch.tile, 'grew');
  }
  addLog(`<span class="lt">${ev.leaving ? '떠날 때' : `바퀴${ev.lap} · ${ev.tile}번`}</span><b>${bldName(st.board[ev.tile])}</b><span class="ls grow">${ev.changes.map(ch => `${bldName(st.board[ch.tile])}(${ch.tile}번) 배율 +${fmtMult(ch.amount)} → 키운 배율 ${fmtMult(ch.now)}`).join(' · ')}</span>`, 'growl');
}
function applyLapEnd(ev, P) {
  const st = ev.stacksBefore;
  const had = [st.h ? gaugeText(st.h) : '', st.d ? `${SN.tipsy} ${st.d}` : '', st.y ? `${SN.hype} ${st.y}` : '', st.tired ? `${SN.fatigue} ${st.tired}` : ''].filter(Boolean).join(', ');
  const cleared = (had ? `스택이 사라져요 (${had})` : '스택 없음') + (ev.keptHype ? ` · 전광판: ${SN.hype} ${ev.keptHype}은 남아요` : '') + (ev.keptTipsy ? ` · 술고래: ${SN.tipsy} ${ev.keptTipsy}는 남아요` : '');
  let line, cls;
  if (ev.result === 'base') { line = `기본 바퀴라 계속 돌아요 (만족도 ${ev.sat})`; cls = 'base'; }
  else if (ev.result === 'extra') { line = `만족도 ${ev.satBefore}에서 ${ev.paid}를 내고 <b>🔥 추가 바퀴!</b> (남은 만족도 ${ev.sat}, 다음 비용 ${ev.cost})`; cls = 'extra'; }
  else { line = `만족도 ${ev.sat}, 추가 바퀴의 비용 ${ev.needed} → 떠나요`; cls = 'leave'; }
  P.sat = ev.sat; P.cost = ev.cost;
  P.banner = { cls, html: `바퀴 ${ev.lap} 끝<br>${line}` };
  addLog(`<span class="lt">바퀴${ev.lap} 끝</span><span class="ls">${cleared} · ${line.replace(/<[^>]+>/g, '')}</span>`, 'lap ' + cls);
  if (ev.result === 'extra' && !ui.skip) { const b = $('board'); b.classList.remove('burst'); void b.offsetWidth; b.classList.add('burst'); }
}

// 드워프나 귀빈 한 마리의 기록을 재생한다
async function playRun(out) {
  const s = game.state, d = out.dwarf, N = out.info.N;
  const P = ui.play = { out, lap: 1, fever: 0, tile: 0, st: { h: 0, d: 0, y: 0, tired: 0 }, sat: 0, cost: c.extraLapCost.first, total: 0, bestPay: 0, grow: [...out.growBefore], money: out.moneyBefore, waveSales: out.waveSalesBefore, banner: null, broke: false };
  Object.assign(ui, { playing: true, skip: settings.autoSkip, sel: null, hover: null });
  clearPreview();
  if (d.guest) { toast(`귀빈 ${josa(d.name, '이', '가')} 왔어요.`, 'record'); addLog(`👑 ${waveLabel(out.wave)} · 귀빈 <b>${d.name}</b> (♥ ${d.likes.join(', ')}) · ${d.text} · 매출 ×${c.guests.payMult}`, 'head'); }
  else addLog(`▶ ${waveLabel(out.wave)} · 보내기 ${out.sendIndex + 1}/${out.sends} · <b>${d.name}</b> (♥ ${d.likes.join(', ')} / ✕ ${d.dislike}${d.trait ? ` / ${traitOf(d.trait).name}` : ''})`, 'head');
  render();
  const evs = out.events;
  let k = 0;
  const show = async e => {
    const shown = e.type === 'use' ? (applyUse(e, P), true) : e.type === 'skip' ? (applySkip(e, P), true) : e.type === 'grow' ? (applyGrow(e, P), true) : applyPass(e, P);
    if (!ui.skip && shown) { renderHud(); renderCenter(); renderTop(); await wait(e.type === 'use' ? TIME.use : e.type === 'grow' ? TIME.grow : TIME.skip); }
  };
  while (k < evs.length) {
    const ev = evs[k];
    if (ev.type === 'lapStart') {
      k++;
      Object.assign(P, { lap: ev.lap, cost: ev.cost, sat: ev.sat, st: { h: ev.stacks.h, d: ev.stacks.d, y: ev.stacks.y, tired: 0 } });
      if (ev.extraNo !== P.fever) { P.fever = ev.extraNo; if (!ui.skip) $('board').className = sizeClass(N) + (P.fever ? ` fever f${Math.min(P.fever, 4)}` : ''); }
      if (ev.lap > 1 && !ui.skip) await wait(TIME.pass);
      if (ev.lap > 1) P.banner = P.banner && P.banner.cls === 'extra' ? P.banner : null;
      // 엔진이 알려 준 차례대로 걷는다. 회전교차로에서는 이전 칸들로 돌아가서 다시 걷는다
      for (let si = 0; si < ev.path.length; si++) {
        const stepAt = ev.path[si], here = [];
        while (k < evs.length && evs[k].type !== 'lapEnd' && evs[k].type !== 'lapStart' && !evs[k].leaving && evs[k].step === si) here.push(evs[k++]);
        const turning = !stepAt.back && ev.path[si + 1] && ev.path[si + 1].back;
        P.tile = stepAt.tile;
        if (!ui.skip) {
          const busy = here.length || turning || stepAt.back;
          placeToken(stepAt.tile, (busy ? TIME.move : TIME.pass) / (ui.speed * feverRate()));
          if (here.length || si === 0) { renderHud(); renderCenter(); }
          await wait(busy ? TIME.move : TIME.pass);
          if (turning) { popup(stepAt.tile, '<b>↩ 이전 칸으로 돌아가요</b>', 'passpop'); flash(stepAt.tile, 'fired'); await wait(TIME.skip); }
        }
        for (const e of here) await show(e);
      }
    } else if (ev.type === 'lapEnd') {
      k++;
      applyLapEnd(ev, P);
      if (!ui.skip) { renderHud(); renderCenter(); renderTop(); await wait(ev.result === 'leave' ? TIME.leave : TIME.lapEnd); }
    } else { k++; await show(ev); }   // 방명록: 떠날 때
  }
  addLog(`■ ${d.guest ? '귀빈 ' : ''}${d.name} · ${out.laps}바퀴(추가 ${out.extraLaps}) · 매출 <b>+${won(out.sales)}</b> · 자금 ${won(out.moneyBefore + out.sales)}`, 'tail');
  if (ui.skip) toast(`${d.guest ? '귀빈 ' : ''}${d.name}: +${won(out.sales)} (${out.laps}바퀴)`, 'sum');
  if (ui.skip && out.moneyBefore < out.target && out.moneyBefore + out.sales >= out.target) toast(`🎯 목표 달성! ${won(out.target)}`, 'goal');
  Object.assign(ui, { playing: false, play: null, skip: false });
  if (s.phase === 'guest') return playRun(game.runGuest());   // 드워프를 다 보낸 뒤에 귀빈이 마지막으로 돈다
  if (s.phase === 'judge') {
    const j = s.judge;
    if (d.guest && j.reward) { const text = j.reward.offer.length ? `추가 바퀴 ${out.extraLaps}번. 특수 칸 후보 ${j.reward.offer.length}장을 받았어요.` : '추가 바퀴를 돌지 못했어요. 보상이 없어요.'; toast(text, 'record'); addLog(`👑 ${text}`, 'mark'); }
    addLog(`${j.passed ? '✅' : '■'} ${waveLabel()} 판정: 자금 ${won(j.money)} / 목표 ${won(j.target)} → ${j.passed ? `목표 달성! 목표의 ${j.ratio.toFixed(1)}배` : `목표에 ${won(j.target - j.money)} 모자랐어요.`} (이번 웨이브의 매출 ${won(s.waveSales)})`, 'mark');
    for (const e of j.events) { const text = judgeEventText(e); toast(text, 'sum'); addLog(`🏗 ${text}`, 'mark'); }
  }
  render();
}

function finishRun() {   // 끝 화면으로 갈 때 한 번: 최고 기록을 남긴다
  const s = game.state;
  if (ui.recorded) return;
  ui.recorded = true;
  ui.newRecord = !record || s.st.money > record.money;
  if (ui.newRecord) { record = { money: s.st.money, pay: s.bestPay ? s.bestPay.pay : 0, laps: s.maxLaps, seed: s.seed }; store.set('record', record); }
}

// ── 조작 ────────────────────────────────────────────────────
// 되돌릴 수 없는 버튼은 두 번 눌러야 한다(브라우저 확인 창은 막힌 곳이 있어 쓰지 않는다).
let armed = null;
function twice(key, msg) {
  if (armed && armed.key === key && Date.now() - armed.t < 5000) { armed = null; return true; }
  armed = { key, t: Date.now() }; toast(msg);
  return false;
}

// 들고 있는 것(손패의 카드나 보드의 건물)을 칸이나 틈에 놓는다
function place(where) {
  const s = game.state, what = held(); if (!what) return;
  const before = snapshot();
  if (what.type === 'card') {
    const id = s.hand[what.h], r = game.playCard(what.h, where);
    if (r.illegal) toast(r.illegal === '★이 가득 찼다' ? '★이 가득 찼어요.' : r.illegal === '같은 지원 건물은 한 채' ? '같은 지원 건물은 한 채만 지을 수 있어요.' : r.illegal === '빈 칸이 없다' ? '빈 칸이 없어요. 겹치거나 바꿔 지을 수 있어요.' : '여기에는 놓을 수 없어요.');
    else addLog(`${s.log[s.wave].used[s.log[s.wave].used.length - 1]}${r.op.type === 'overlap' ? ' · ★ +1' : ''}`, 'prepl');
    void id;
  } else if (where.gap != null) { const nm = bldName(s.st.board[what.i]); if (game.insertFrom(what.i, where.gap)) addLog(`끼워 넣기: ${nm} ${what.i}번 → 틈 ${where.gap}`, 'prepl'); }
  else if (where.tile !== what.i) { const a = s.st.board[what.i], z = s.st.board[where.tile]; if (game.swap(what.i, where.tile)) addLog(`자리 바꾸기: ${bldName(a)} ${what.i}→${where.tile}${z ? `, ${bldName(z)} ${where.tile}→${what.i}` : ''}`, 'prepl'); }
  ui.sel = null; ui.drag = null;
  clearPreview(); render(before);
  if (s.phase === 'guest') playRun(game.runGuest());   // 보드를 손대서 보낼 횟수가 줄었다: 드워프를 다 보낸 것이 됐다
}

function act(name, el) {
  const s = game.state;
  switch (name) {
    case 'begin': game.begin(); ui.modal = null; addLog(`— 런 시작 · 자금 ${won(s.st.money)} · 귀빈 ${s.guests.map((id, k) => `웨이브 ${c.guests.waves[k]} ${game.engine.guest(id).name}`).join(', ')}`, 'mark'); break;
    case 'close': if (s.phase === 'intro' && ui.modal === 'settings') return newGame(s.seed);   // 런을 시작하기 전이면 바꾼 스위치로 다시 짠다
      ui.modal = null; break;
    case 'deck': ui.modal = s.phase === 'intro' ? 'intro' : 'deck'; break;
    case 'settings': ui.modal = 'settings'; break;
    case 'restart': if (s.phase === 'over' || s.phase === 'intro' || twice('restart', '한 번 더 누르면 지금 런을 버리고 새 런을 시작해요')) return newGame();
      return;
    case 'sameSeed': return newGame(s.seed);
    case 'seedGo': { const v = $('seed-in').value.trim(); if (v) return newGame(v); return; }
    case 'seedRandom': return newGame();
    case 'clearRecord': record = null; store.set('record', null); break;
    case 'allOn': settings.disabled = []; store.set('settings', settings); break;
    case 'copyRecord': {
      const text = recordText();
      ui.copyText = text;   // 복사가 막힌 곳에서는 아래 글상자에서 골라 복사한다
      const ok = () => toast('기록을 복사했어요.', 'coin');
      const no = () => { toast('아래 글상자의 글을 복사해 주세요.'); const t = $('copy-out'); if (t) { t.focus(); t.select(); } };
      try { navigator.clipboard.writeText(text).then(ok, no); } catch { setTimeout(no, 0); }
      break;
    }
    case 'pick': if (game.pick(+el.dataset.slot)) addLog(`고르기: ${bldName(s.hand[s.hand.length - 1])}`, 'prepl'); break;
    case 'refresh': { const cost = game.refreshCost(); if (game.refresh()) { ui.sel = null; addLog(`새로고침 −${won(cost)} · 자금 ${won(s.st.money)}`, 'prepl'); } else toast('자금이 모자라요.'); break; }
    case 'discard': if (ui.sel?.type === 'card') { const nm = bldName(s.hand[ui.sel.h]); if (game.discard(ui.sel.h)) addLog(`버리기: ${nm}`, 'prepl'); ui.sel = null; } else toast('버릴 카드를 먼저 골라 주세요.'); break;
    case 'demolish': { const i = +el.dataset.tile, nm = bldName(s.st.board[i]);
      if (!twice('demolish' + i, `한 번 더 누르면 ${josa(nm, '을', '를')} 철거해요.${lossText(i)}`)) return;
      if (game.demolish(i)) { addLog(`철거: ${i}번 ${nm}`, 'prepl'); ui.sel = null; }
      if (s.phase === 'guest') { clearPreview(); playRun(game.runGuest()); return; }
      break; }
    case 'startWave': if (s.hand.length > H.keep) { toast(`손패는 ${H.keep}장까지 남길 수 있어요. 버릴 카드를 골라 주세요.`); return; }
      if (s.picksLeft > 0 && !twice('wave' + s.wave, `후보를 ${s.picksLeft}장 더 고를 수 있어요. 한 번 더 누르면 시작해요`)) return;
      ui.sel = null; game.startWave(); addLog(`— ${waveLabel()} 시작 · 목표 ${won(game.target())} · 자금 ${won(s.st.money)} · 보낼 횟수 ${game.sendsNow()}`, 'mark'); break;
    case 'send': { const out = game.send(+el.dataset.i); if (out) playRun(out); return; }
    case 'speed': ui.speed = +el.dataset.x; store.set('speed', ui.speed); renderTray(); return;
    case 'skip': ui.skip = true; ui.wake?.(); return;
    case 'proceed': game.proceed(); ui.sel = null; ui.reward = { special: null, pos: null };
      if (s.phase === 'over') { finishRun(); ui.modal = null; }
      else if (s.phase === 'prep') { addLog(`— ${waveLabel()}의 정비 · 보드가 ${s.st.board.length}칸이 됐어요`, 'mark'); }
      break;
    case 'rewardPick': ui.reward.special = el.dataset.sp; break;
    case 'rewardPlace': { const { special, pos } = ui.reward, before = snapshot();
      if (game.chooseReward(special, pos)) { addLog(`👑 특수 칸 ${spDef(special).name}을(를) ${pos}번 칸 자리에 끼워 넣었어요`, 'mark'); addLog(`— ${waveLabel()}의 정비 · 보드가 ${s.st.board.length}칸이 됐어요`, 'mark'); ui.reward = { special: null, pos: null }; clearPreview(); return render(before); }
      break; }
    case 'logsize': ui.logBig = !ui.logBig; break;
  }
  clearPreview();
  render();
  if (s.phase === 'reward') previewReward(ui.reward.pos);
}

const root = $('app');
root.addEventListener('click', e => {
  const gap = e.target.closest('.gap');
  if (gap && !ui.playing) {
    const g = +gap.dataset.gap;
    if (game.state.phase === 'reward') { ui.reward.pos = g; render(); previewReward(g); return; }
    if (held()) return place({ gap: g });
  }
  const actEl = e.target.closest('[data-act]');
  if (actEl) { if (!actEl.disabled) act(actEl.dataset.act, actEl); return; }
  if (e.target.id === 'modal' && ui.modal && game.state.phase !== 'intro' && game.state.phase !== 'over') { ui.modal = null; render(); return; }
  if (e.target.closest('#modal') || e.target.closest('input, select, label, textarea')) return;
  if (ui.playing) return;
  const s = game.state;
  const card = e.target.closest('[data-hand]');
  if (card && s.phase === 'prep') { const h = +card.dataset.hand; ui.sel = ui.sel?.type === 'card' && ui.sel.h === h ? null : { type: 'card', h }; clearPreview(); return render(); }
  const tile = e.target.closest('[data-tile]');
  if (tile && game.canMove()) {
    const i = +tile.dataset.tile;
    if (ui.sel?.type === 'card') return place({ tile: i });
    if (ui.sel?.type === 'tile') { if (ui.sel.i === i) { ui.sel = null; clearPreview(); return render(); } return place({ tile: i }); }
    if (s.st.board[i]) { ui.sel = { type: 'tile', i }; render(); }
    return;
  }
  if (e.target.closest('#detail')) return;
  if (ui.sel) { ui.sel = null; clearPreview(); render(); }
});
root.addEventListener('change', e => {
  const ds = e.target.dataset || {};
  if (ds.set) settings[ds.set] = e.target.checked;
  else if (ds.setv) { const v = e.target.value, val = v !== '' && !isNaN(v) ? Number(v) : v; if (ds.idx != null) settings[ds.setv][+ds.idx] = val; else settings[ds.setv] = val; }
  else if (ds.bld) {   // 건물 끄기: 체크를 풀면 끈다
    settings.disabled = e.target.checked ? settings.disabled.filter(id => id !== ds.bld) : [...settings.disabled, ds.bld];
    settings.forced = settings.forced.filter(id => !settings.disabled.includes(id));
  } else if (ds.force) settings.forced = e.target.checked ? [...settings.forced, ds.force].slice(0, 2) : settings.forced.filter(id => id !== ds.force);
  else return;
  store.set('settings', settings);
  if (ds.set === 'autoSkip' && ui.playing && settings.autoSkip) { ui.skip = true; ui.wake?.(); return; }
  if (ui.playing) return;
  const sheet = document.querySelector('#modal .sheet'), top = sheet ? sheet.scrollTop : 0;
  render();
  const again = document.querySelector('#modal .sheet'); if (again) again.scrollTop = top;
});
root.addEventListener('keydown', e => { if (e.target.id === 'seed-in' && e.key === 'Enter') act('seedGo'); });

function hoverOf(target) {
  const g = target.closest?.('.gap'); if (g) return { type: 'gap', g: +g.dataset.gap };
  const t = target.closest?.('[data-tile]'); if (t) return { type: 'tile', i: +t.dataset.tile };
  const cd = target.closest?.('[data-cand]'); if (cd) return { type: 'cand', slot: +cd.dataset.cand };
  const hd = target.closest?.('[data-hand]'); if (hd) return { type: 'hand', h: +hd.dataset.hand };
  const d = target.closest?.('[data-dwarf]'); if (d) return { type: 'dwarf', i: +d.dataset.dwarf };
  const gu = target.closest?.('[data-guest]'); if (gu) return { type: 'guest', k: +gu.dataset.guest };
  return null;
}
// 들고 있는 것이 있으면 올린 곳에 미리 보기를 띄운다
function over(h) {
  if (JSON.stringify(h) === JSON.stringify(ui.over)) return;
  ui.over = h;
  if (game.state.phase === 'reward') { if (h?.type === 'gap') previewReward(h.g); else previewReward(ui.reward.pos); return; }
  if (!placing()) return;
  if (h?.type === 'gap') previewGap(h.g); else if (h?.type === 'tile') previewTile(h.i); else clearPreview();
}
root.addEventListener('mouseover', e => {
  if (e.target.closest?.('#detail')) return;   // 살펴보기 창 안의 버튼을 누르러 가는 동안은 그대로 둔다
  const h = hoverOf(e.target);
  if (ui.drag) return;
  over(h);
  if (h?.type === 'gap' || JSON.stringify(h) === JSON.stringify(ui.hover)) return;
  ui.hover = h; renderDetail(); applyHighlights();
});
root.addEventListener('mouseleave', () => { ui.hover = null; ui.over = null; if (!ui.drag) clearPreview(); renderDetail(); applyHighlights(); });

// 끌어다 놓기: 손패의 카드 → 칸, 틈, 버리는 자리 / 보드의 건물 → 다른 칸, 틈
root.addEventListener('dragstart', e => {
  if (ui.playing) return e.preventDefault();
  const hd = e.target.closest?.('[data-hand]'), t = e.target.closest?.('[data-tile]');
  if (hd && game.state.phase === 'prep') ui.drag = { type: 'card', h: +hd.dataset.hand };
  else if (t && game.canMove() && game.state.st.board[+t.dataset.tile]) ui.drag = { type: 'tile', i: +t.dataset.tile };
  else return e.preventDefault();
  e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', 'x');
  ui.sel = null; ui.over = null;
  $('board').classList.add('placing'); document.querySelector('.discard')?.classList.toggle('ready', ui.drag.type === 'card');
});
root.addEventListener('dragover', e => {
  if (!ui.drag) return;
  const h = hoverOf(e.target), dis = e.target.closest?.('[data-discard]');
  if (dis && ui.drag.type === 'card') { e.preventDefault(); over(null); return; }
  if (h?.type === 'gap' || (h?.type === 'tile' && !(ui.drag.type === 'tile' && ui.drag.i === h.i))) { e.preventDefault(); over(h); } else over(null);
});
root.addEventListener('drop', e => {
  const d = ui.drag; if (!d) return;
  e.preventDefault();
  const h = hoverOf(e.target), dis = e.target.closest?.('[data-discard]');
  if (dis && d.type === 'card') { const nm = bldName(game.state.hand[d.h]); if (game.discard(d.h)) addLog(`버리기: ${nm}`, 'prepl'); ui.drag = null; clearPreview(); return render(); }
  if (h?.type === 'gap') return place({ gap: h.g });
  if (h?.type === 'tile') return place({ tile: h.i });
  ui.drag = null; clearPreview(); render();
});
root.addEventListener('dragend', () => { if (ui.drag) { ui.drag = null; clearPreview(); render(); } });

let seed0 = null;
try { seed0 = new URLSearchParams(location.search).get('seed'); } catch { /* 주소를 못 읽는 곳 */ }
newGame(seed0 || undefined);
window.__yolo = { get game() { return game; }, ui, settings, newGame, render, recordText };   // 콘솔에서 들여다보기용
