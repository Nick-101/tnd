// 화면 (데모 2.0). 엔진이 돌려준 기록을 재생만 한다. 규칙 계산은 하지 않는다.
// 글은 텍스트 v3을 따른다: 건물 문구는 데이터의 text, 버튼과 안내는 해요체.
import { createGame } from './game.js';
import { formulaText, fmtNum, gaugeText } from './engine.js';
import { randomSeed } from './rng.js';

const $ = id => document.getElementById(id);
const won = n => Math.round(n).toLocaleString('ko-KR');
// 칸이 좁을 때 줄여 적는다 (12.3만)
const short = n => (n >= 1e8 ? `${(n / 1e8).toFixed(1)}억` : n >= 1e5 ? `${(n / 1e4).toFixed(1)}만` : won(n));

// ── 데이터 ──────────────────────────────────────────────────
let data;
try {
  // 한 파일로 묶은 판(build-single.mjs)은 데이터를 안에 품고 있다.
  data = globalThis.__YOLO_DATA__ ?? await (await fetch('data/yolodwarf2_data.json', { cache: 'no-store' })).json();
} catch (e) {
  document.body.innerHTML = `<p style="padding:24px;color:#fff">데이터 파일(data/yolodwarf2_data.json)을 읽지 못했어요. README의 실행 방법대로 <code>npm start</code>로 열었는지, 파일의 쉼표나 따옴표가 깨지지 않았는지 확인해 주세요.<br><br>${e}</p>`;
  throw e;
}
const c = data.constants;
const COLORS = { 운동: '#4fb873', 식당: '#f0923b', 카페: '#c0946a', 술집: '#a078e8', 오락: '#e8574e', 공연: '#f083b8', 쇼핑: '#e3bf3a', 휴식: '#559fec' };
const ICONS = { 운동: '🏋️', 식당: '🍜', 카페: '☕', 술집: '🍺', 오락: '🕹️', 공연: '🎤', 쇼핑: '🛍️', 휴식: '🛏️' };
const GRADE = { common: '일반', uncommon: '고급', rare: '희귀' };
const SN = data.stacks;   // 스택의 이름: 허기, 포만감, 취기, 흥, 피로
const kindColor = k => COLORS[k] || '#888';
const chip = (k, mark = '') => `<span class="chip" style="--c:${kindColor(k)}">${mark}${ICONS[k] || ''} ${k}</span>`;
const traitOf = id => data.traits.find(t => t.id === id);
const traitBadge = d => (d.trait ? `<span class="trait" title="${traitOf(d.trait).text}">${traitOf(d.trait).name}</span>` : '');

// 건물 문구를 그린다: [업종]은 아이콘으로, 요금의 +와 매출의 ×와 스택의 +는 색을 달리, "(지금 …)"은 지금 값으로.
function rich(text, now = null) {
  let t = text.replace(/\s*\(지금 [^)]*\)/, '');
  t = t.replace(/(매출 배율 \+[\d.]+|매출 ×[\d.]+)/g, '<span class="cmult">$1</span>')
    .replace(/(요금 \+\d+)/g, '<span class="cfee">$1</span>')
    .replace(/(만족도 [+×]\d+)/g, '<span class="csat">$1</span>')
    .replace(/((?:허기|포만감|취기|흥) \+\d+|대신 \+\d+)/g, '<span class="cstack">$1</span>')
    .replace(/\[(\S+?)\]/g, (_, k) => `<span class="kind" style="--c:${kindColor(k)}">${ICONS[k] || ''}${k}</span>`);
  return t + (now ? ` <span class="now">(지금 ${now})</span>` : '');
}
// 키워드 풀이 (텍스트 v3의 5.2절)
const KEYWORDS = [
  ['만취 상태', '취기가 3 이상인 상태입니다.'], ['포만 상태', '포만감이 3 이상인 상태입니다.'],
  ['지나칩니다', '드워프가 이 매장을 이용하지 않고 지나갑니다. 매출도 스택도 생기지 않습니다.'],
  ['소모합니다', '그 스택을 0으로 만듭니다. 소모한 수만큼 효과를 냅니다.'],
  ['한 번 더 이용합니다', '드워프가 그 매장을 이어서 다시 이용합니다. 매출이 다시 들어오고 스택과 만족도도 다시 받습니다. [휴식]이 피로를 만족도로 바꾸는 것은 한 번만 합니다.'],
  ['추가 바퀴', '기본 바퀴를 다 돈 뒤 만족도를 내고 도는 바퀴입니다. 필요한 만족도는 3, 6, 12, 24로 오릅니다. 추가 바퀴로 자란 요금과 매출 배율은 이번 웨이브가 끝나면 처음으로 돌아갑니다.'],
  ['매출 배율', '그 건물이 매출에 거는 ×의 크기입니다. 1에서 시작합니다.'],
  ['★', '업그레이드 한 단계입니다. ★ 하나마다 그 매장은 매출 ×2. 세 개까지 올립니다.'],
  ['요금이 가장 높은', '지금 요금이 가장 높은 매장 한 곳입니다. 같으면 입구에서 가까운 매장입니다. 추가 바퀴로 자란 요금은 치지 않습니다.'],
  ['피로', '매장을 이용할 때마다 1 오르는 스택입니다. [휴식]은 피로를 주지 않습니다.'],
];
const keywordHelp = text => KEYWORDS.filter(([k]) => text.includes(k)).map(([k, v]) => `<div class="kw"><b>${k}</b> ${rich(v)}</div>`).join('');

// ── 저장되는 것: 역대 최고 기록, 시험용 스위치 ─────────────────
const store = {
  get(key, fallback) { try { const v = localStorage.getItem('yolodwarf2.' + key); return v == null ? fallback : JSON.parse(v); } catch { return fallback; } },
  set(key, v) { try { localStorage.setItem('yolodwarf2.' + key, JSON.stringify(v)); } catch { /* 저장이 막힌 브라우저 */ } },
};
const settings = { targetMult: 1, startStage: 1, preview: false, traits: true, deckColor: true, autoSkip: false, ...store.get('settings', {}) };
let record = store.get('record', null);       // 역대 최고 기록 { money, pay, laps }
const testing = () => settings.targetMult !== 1 || settings.startStage !== 1 || settings.preview || !settings.traits || !settings.deckColor;

// ── 화면 상태 ────────────────────────────────────────────────
let game;
const ui = { sel: null, hover: null, playing: false, play: null, speed: store.get('speed', 1), skip: false, wake: null, modal: null, drag: null, logBig: false, recorded: false };

function newGame(seed) {
  game = createGame(data, { seed: seed || randomSeed(), targetMult: settings.targetMult, startStage: settings.startStage, traits: settings.traits, deckColor: settings.deckColor });
  Object.assign(ui, { sel: null, hover: null, playing: false, play: null, skip: false, modal: 'stage', recorded: false });
  $('log').innerHTML = '';
  addLog(`새 런 · 난수 씨앗 ${game.state.seed} · 자금 ${won(game.state.money)}`, 'mark');
  try { history.replaceState(null, '', '?seed=' + encodeURIComponent(game.state.seed)); } catch { /* 주소를 못 바꾸는 곳 */ }
  render();
}
const bld = id => game.engine.building(id);
const isShop = id => !!game.engine.shop(id);
const stageLabel = (st = game.state.stage, wv = game.state.wave) => `스테이지 ${st + 1} · 웨이브 ${wv + 1}`;

// ── 보드의 칸 자리: 둥근 네모 트랙. 모서리 네 칸 + 변마다 같은 수. 0번이 왼쪽 위, 시계 방향 ──
function tilePos(i, N) {
  const S = N / 4 + 1;   // 한 변의 칸 수(모서리 포함)
  if (i < S) return { r: 1, c: i + 1, dir: i === S - 1 ? '↓' : '→', corner: i === 0 ? 'tl' : i === S - 1 ? 'tr' : '' };
  if (i < 2 * S - 1) return { r: i - S + 2, c: S, dir: i === 2 * S - 2 ? '←' : '↓', corner: i === 2 * S - 2 ? 'br' : '' };
  if (i < 3 * S - 2) return { r: S, c: S - (i - (2 * S - 2)), dir: i === 3 * S - 3 ? '↑' : '←', corner: i === 3 * S - 3 ? 'bl' : '' };
  return { r: S - (i - (3 * S - 3)), c: 1, dir: i === N - 1 ? '→' : '↑', corner: '' };
}

// ── 그리기 ──────────────────────────────────────────────────
function render() {
  ui.info = ui.playing ? ui.play.out.info : game.prep();
  renderTop(); renderBoard(); renderCenter(); renderHud(); renderTray(); renderDetail(); renderModal(); applyHighlights();
  $('side').classList.toggle('logbig', ui.logBig);
}

function renderTop() {
  const s = game.state, P = ui.play;
  const money = P ? P.money : s.money, target = P ? P.out.target : game.target();
  const best = P ? Math.max(P.out.bestPayBefore, P.bestPay) : (s.bestPay ? s.bestPay.pay : 0);
  const pct = Math.min(100, (money / target) * 100);
  $('top').innerHTML = `
    <div class="brand">욜로드워프 <small>데모 2.0</small></div>
    <div class="stat"><b class="sw">${stageLabel(P ? P.out.stage : s.stage, P ? P.out.wave : s.wave)}</b></div>
    <div class="stat money ${money >= target ? 'hit' : ''}"><label>자금</label><b id="money">${won(money)}</b><label>목표</label><b class="tg">${won(target)}</b>
      <div class="bar"><i style="width:${pct}%"></i></div></div>
    <div class="stat"><label>한 번에 올린 최고 매출</label><b>${won(best)}</b></div>
    <div class="stat"><label>최고 기록</label><b>${record ? won(record.money) : '-'}</b></div>
    <div class="grow"></div>
    ${testing() ? '<span class="flag">시험용 스위치 켜짐</span>' : ''}
    <button data-act="deck">덱 보기</button>
    <button data-act="settings">설정</button>
    <button data-act="restart">새 런</button>
    <div class="seed" title="같은 씨앗을 설정에 넣으면 같은 판이 다시 나와요">씨앗 <b>${s.seed}</b></div>`;
}

const viewG = () => (ui.play ? ui.play.g : game.state.phase === 'pick' ? game.state.g : 0);
function tileStats(i, g) {
  const p = ui.info, e = game.engine, shop = p.shopAt[i];
  const fee = e.feeAt(p, i, g), mult = e.multAt(p, i, g);
  return `<span class="fee ${fee !== shop.fee ? 'buffed' : ''}" title="요금">${short(fee)}</span>` +
    (mult !== 1 ? `<span class="mult" title="걸린 ×">×${fmtNum(mult)}</span>` : '') +
    (p.again[i] ? `<span class="again" title="한 번 더">+${p.again[i]}회</span>` : '');
}
// 성장 지원의 지금 값
function growNow(i, g) {
  const p = ui.info, e = p.supAt[i] && p.supAt[i].effect;
  if (!e) return null;
  if (e.type === 'growFee') return `+${fmtNum(e.amount * p.times[i] * g)}`;
  if (e.type === 'growMult') return `×${fmtNum(1 + e.amount * p.times[i] * g)}`;
  return null;
}

function renderBoard() {
  const s = game.state, p = ui.info, g = viewG(), N = s.board.length, S = N / 4 + 1;
  const canEdit = game.canMove() && !ui.playing;
  let html = '';
  for (let i = 0; i < N; i++) {
    const pos = tilePos(i, N), b = s.board[i], def = b && bld(b.id);
    const style = `grid-row:${pos.r};grid-column:${pos.c}`;
    const cls = `${pos.corner ? 'corner-' + pos.corner : ''}`;
    const no = `<span class="tno">${i === 0 ? '입구' : i}</span><span class="arrow">${pos.dir}</span><span class="taste"></span>`;
    if (!def) { html += `<div class="tile empty ${cls}" data-tile="${i}" style="${style}">${no}</div>`; continue; }
    if (isShop(b.id)) {
      const marks = (p.top === i ? '<em class="mk top" title="요금이 가장 높은 매장">👑</em>' : '') + (p.mostStars === i ? '<em class="mk most" title="★이 가장 많은 매장">🏅</em>' : '');
      html += `<div class="tile shop ${cls} ${p.top === i ? 'top' : ''}" data-tile="${i}" style="${style}" draggable="${canEdit}">
        <div class="kbar">${def.kinds.map(k => `<i style="background:${kindColor(k)}"></i>`).join('')}</div>${no}
        <div class="tname"><span class="nm">${def.name}</span>${b.stars ? `<span class="stars">${'★'.repeat(b.stars)}</span>` : ''}${marks}</div>
        <div class="tkind">${def.kinds.map(k => ICONS[k]).join('')} ${def.kinds.join(' + ')}</div>
        <div class="tstats">${tileStats(i, g)}</div></div>`;
    } else {
      html += `<div class="tile support ${cls}" data-tile="${i}" style="${style}" draggable="${canEdit}">
        <div class="kbar"><i></i></div>${no}
        <div class="tname"><span class="nm">${def.name}</span>${p.times[i] > 1 ? `<em class="boost" title="발전소가 옆에 있어 효과가 ${p.times[i]}번 걸려요">⚡${p.times[i]}</em>` : ''}</div>
        <div class="tkind">지원 건물 · ${GRADE[def.grade]}</div>
        <div class="ttext">${rich(def.text, growNow(i, g))}</div></div>`;
    }
  }
  html += `<div id="center" style="grid-row:2/${S};grid-column:2/${S}"></div><div id="fx"><div id="token" hidden>🧔</div></div>`;
  const board = $('board');
  board.innerHTML = html;
  board.style.gridTemplateColumns = `repeat(${S}, 1fr)`; board.style.gridTemplateRows = `repeat(${S}, 1fr)`;
  board.className = `n${N}` + (ui.play && ui.play.fever ? ` fever f${Math.min(ui.play.fever, 4)}` : '');
  if (ui.play && ui.play.tile >= 0) placeToken(ui.play.tile, 0);
}

function renderCenter() {
  const s = game.state, P = ui.play, el = $('center');
  if (!el) return;
  if (P) {
    el.innerHTML = `<div class="cbox"><div class="ctitle">${P.out.dwarf.name} <small>${P.fever ? `🔥 추가 바퀴 ${P.fever}` : `바퀴 ${P.lap}`}</small></div>
      <div class="cbig">+${won(P.total)}</div>${P.banner ? `<div class="banner ${P.banner.cls}">${P.banner.html}</div>` : ''}</div>`;
  } else if (s.phase === 'judge') {
    const j = s.judge;
    el.innerHTML = `<div class="cbox judge ${j.passed ? 'pass' : 'failj'}"><div class="ctitle">${j.cleared ? '🎉 클리어!' : j.passed ? '목표 달성!' : '런이 끝났어요'}</div>
      ${j.passed ? `<div class="cbig">목표의 ${j.ratio.toFixed(1)}배</div>` : `<div class="csub">목표에 ${won(j.target - j.money)} 모자랐어요.</div>`}
      <button class="primary" data-act="proceed">${j.cleared || !j.passed ? '결과 보기' : j.stageDone ? '다음 스테이지' : '다음 정비'}</button></div>`;
  } else if (s.phase === 'prep') {
    el.innerHTML = `<div class="cbox"><div class="ctitle">정비 <small>${stageLabel()}</small></div><div class="csub">후보에서 건물을 골라 칸에 지으세요.</div></div>`;
  } else if (s.phase === 'pick') {
    el.innerHTML = `<div class="cbox"><div class="ctitle">웨이브 <small>보내기 ${s.sendIndex + 1} / ${c.sendsPerWave}</small></div><div class="csub">셋 가운데 하나를 골라 보내세요.</div></div>`;
  } else el.innerHTML = '';
}

const deckLabel = () => {
  const s = game.state;
  return s.popular.length ? `<span class="decklabel">인기 ${s.popular.map(k => chip(k)).join('')} · 비인기 ${s.unpopular.map(k => chip(k)).join('')}</span>` : '<span class="decklabel dim">덱의 색 없음</span>';
};

// 오른쪽 위 창: 걷는 드워프의 스택, 또는 지금 단계의 요약
function renderHud() {
  const s = game.state, P = ui.play, el = $('hud');
  if (P) {
    const d = P.out.dwarf, st = P.st;
    const drunkOn = st.d >= c.thresholds.drunk, fullOn = -st.h >= c.thresholds.full;
    const pos = Math.max(-6, Math.min(6, st.h));
    const base = P.lap <= P.out.baseLaps;
    el.innerHTML = `<div class="hud ${P.fever ? 'fever' : ''}">
      <div class="hud-head"><b>🧔 ${d.name}</b>${d.likes.map(k => chip(k, '♥')).join('')}${chip(d.dislike, '✕')}${traitBadge(d)}
        <span class="lapno">${P.fever ? `🔥 추가 바퀴 ${P.fever}` : `바퀴 ${P.lap} / 기본 ${P.out.baseLaps}`}</span></div>
      <div class="hud-row"><span class="gauge" title="허기와 포만감은 한 눈금의 양 끝이에요">
        <i class="gl">포만감</i><span class="gtrack"><em style="left:${50 + pos * (50 / 6)}%"></em></span><i class="gr">허기</i></span>
        <b class="${st.h > 0 ? 'hungry' : st.h < 0 ? 'fullv' : ''}">${gaugeText(st.h)}</b>${fullOn ? '<span class="state full">포만 상태</span>' : ''}
        <span class="st">🍺 ${SN.tipsy} <b>${st.d}</b></span>${drunkOn ? '<span class="state drunk">만취 상태</span>' : ''}
        <span class="st">🎵 ${SN.hype} <b>${st.y}</b></span><span class="st">💤 ${SN.fatigue} <b>${st.tired}</b></span></div>
      <div class="hud-row sat"><span class="st">😊 만족도 <b class="${P.sat < 0 ? 'neg' : ''}">${P.sat}</b></span>
        <span class="st">다음 추가 바퀴의 비용 <b>${P.cost}</b></span>
        <span class="pips">${Array.from({ length: Math.min(P.cost, 12) }, (_, k) => `<i class="${k < P.sat ? 'on' : ''}"></i>`).join('')}</span>
        ${base && P.lap < P.out.baseLaps ? '<small>기본 바퀴는 만족도와 상관없이 돌아요</small>' : ''}</div>
      <div class="hud-row sums"><span>이 드워프의 매출 <b>${won(P.total)}</b></span><span>이번 웨이브의 매출 <b>${won(P.waveSales)}</b></span><span>추가 바퀴(성장) <b>${P.g}</b></span></div></div>`;
    return;
  }
  const sends = s.waveSends.map((x, i) => `<li>${i + 1}. ${x.name} <b>${won(x.sales)}</b> <small>${x.laps}바퀴</small></li>`).join('');
  const def = game.stageDef();
  if (s.phase === 'prep') {
    el.innerHTML = `<h3>정비 <small>${stageLabel()} · ${def.tiles}칸</small></h3>
      <p>남은 건설 <b class="num">${s.buildsLeft}</b> · 업그레이드 <b class="num">${s.upgradesLeft}</b> · ${deckLabel()}</p>
      <p class="dim">후보를 끌어다 빈 칸에 놓거나, 후보를 누른 뒤 빈 칸을 누르세요. 지은 건물을 누르면 업그레이드와 철거가 나와요. 끌면 자리를 바꿔요.</p>
      <p class="dim">이 스테이지의 목표: ${def.targets.map((t, i) => `<span class="${i === s.wave ? 'cur' : ''}">${won(game.targetOf(s.stage, i))}</span>`).join(' → ')}</p>`;
  } else if (s.phase === 'pick') {
    el.innerHTML = `<h3>웨이브 <small>${stageLabel()} · 보내기 ${s.sendIndex + 1} / ${c.sendsPerWave}</small></h3>
      <ul class="sends">${sends}</ul>
      <p>이번 웨이브의 매출 <b class="num">${won(s.waveSales)}</b> · 추가 바퀴(성장) <b class="num">${s.g}</b> · ${deckLabel()}</p>
      <p class="dim">고르기 전에 자리 바꾸기를 할 수 있어요. 카드에 마우스를 올리면 좋아하는 매장(♥)과 싫어하는 매장(✕)이 보드에 보여요.</p>`;
  } else if (s.phase === 'judge') {
    const j = s.judge;
    el.innerHTML = `<h3 class="${j.passed ? 'good' : 'bad'}">${j.passed ? '목표 달성!' : '런이 끝났어요'} <small>${stageLabel()}</small></h3>
      <p>자금 <b class="num">${won(j.money)}</b> · 목표 <b class="num">${won(j.target)}</b> · ${j.passed ? `<b class="good">목표의 ${j.ratio.toFixed(1)}배</b>` : `목표에 ${won(j.target - j.money)} 모자랐어요.`}</p>
      <ul class="sends">${sends}</ul><p>이번 웨이브의 매출 <b class="num">${won(s.waveSales)}</b></p>`;
  } else el.innerHTML = `<h3>${stageLabel()}</h3>`;
}

function buildingCard(def) {
  return isShop(def.id)
    ? `<div class="kbar">${def.kinds.map(k => `<i style="background:${kindColor(k)}"></i>`).join('')}</div>
       <div class="cname">${def.name}</div><div class="ckind">${def.kinds.map(k => ICONS[k] + k).join(' + ')} · 요금 <b>${def.fee}</b></div><div class="ctext">${rich(def.text)}</div>`
    : `<div class="kbar"><i></i></div><div class="cname">${def.name}</div><div class="ckind">지원 건물 · <span class="rar-${def.grade}">${GRADE[def.grade]}</span></div><div class="ctext">${rich(def.text)}</div>`;
}

function dwarfCard(d, i, extra = '') {
  return `<div class="dwarf ${extra}" data-dwarf="${i}">
    <div class="dname">🧔 ${d.name} ${traitBadge(d)}</div>
    <div class="drow"><span class="mark like">♥</span>${d.likes.map(k => chip(k)).join('')}</div>
    <div class="drow"><span class="mark hate">✕</span>${chip(d.dislike)}</div>
    ${d.trait ? `<div class="dtrait">${rich(traitOf(d.trait).text)}</div>` : ''}`;
}

function renderTray() {
  const s = game.state, t = $('tray');
  if (ui.playing) {
    const P = ui.play;
    t.innerHTML = `<div class="dwarves">${P.out.hand.map((d, i) => dwarfCard(d, i, d === P.out.dwarf ? 'chosen' : 'gone') + `<div class="dfoot">${d === P.out.dwarf ? '도는 중' : ''}</div></div>`).join('')}</div>
      <div class="actions"><div class="speed">${[1, 2, 4].map(x => `<button data-act="speed" data-x="${x}" class="${ui.speed === x ? 'on' : ''}">${x}배</button>`).join('')}</div>
      <button data-act="skip">결과만 보기 ⏭</button>
      <label class="auto"><input type="checkbox" data-set="autoSkip" ${settings.autoSkip ? 'checked' : ''}> 계속 결과만 보기</label></div>`;
  } else if (s.phase === 'prep') {
    const cost = game.refreshCost();
    t.innerHTML = `<div class="cands">${s.candidates.map((cd, i) => cd
      ? `<div class="cand ${isShop(cd.id) ? 'shop' : 'support'} ${cd.locked ? 'locked' : ''} ${ui.sel?.type === 'cand' && ui.sel.slot === i ? 'sel' : ''}" data-cand="${i}" draggable="${s.buildsLeft > 0}">
          ${buildingCard(bld(cd.id))}<button class="lock" data-act="lock" data-slot="${i}">${cd.locked ? '🔒 해제' : '잠금'}</button></div>`
      : '<div class="cand none"></div>').join('')}</div>
      <div class="actions"><div class="builds">남은 건설 <b>${s.buildsLeft}</b></div>
      <button data-act="refresh" ${game.canRefresh() ? '' : 'disabled'}>새로고침 <b>${won(cost)}</b></button>
      <button class="primary" data-act="startWave">웨이브 시작</button></div>`;
  } else if (s.phase === 'pick') {
    t.innerHTML = `<div class="dwarves">${s.hand.map((d, i) => {
      const pv = settings.preview ? game.preview(i) : null;
      return dwarfCard(d, i, 'pickable') + `<div class="dfoot">${pv ? `<span class="pv">예상 매출 ${won(pv.sales)} · ${pv.laps}바퀴</span>` : ''}<button class="primary" data-act="send" data-i="${i}">보내기</button></div></div>`;
    }).join('')}</div>
      <div class="actions"><div class="builds">보내기 <b>${s.sendIndex + 1}</b> / ${c.sendsPerWave}</div>
      <label class="auto"><input type="checkbox" data-set="autoSkip" ${settings.autoSkip ? 'checked' : ''}> 계속 결과만 보기</label></div>`;
  } else t.innerHTML = '<div class="actions wide"></div>';
}

// ── 살펴보기 창 ──────────────────────────────────────────────
const UP_REASON = { new: '이번 정비에 지은 매장은 다음 정비부터 올릴 수 있어요.', once: '업그레이드는 정비마다 한 번이에요.', max: '여기까지 올릴 수 있어요.', money: '자금이 모자라요.' };
function tileActions(i) {
  const s = game.state, b = s.board[i];
  if (!b || s.phase !== 'prep' || ui.playing || !(ui.sel?.type === 'tile' && ui.sel.i === i)) return '';
  let up = '';
  if (isShop(b.id)) {
    const u = game.upgradeInfo(i);
    up = `<button class="primary" data-act="upgrade" data-tile="${i}" ${u.ok ? '' : 'disabled'}>업그레이드${u.cost != null ? ` <b>${won(u.cost)}</b>` : ''}</button>${u.ok ? '' : `<small class="why">${UP_REASON[u.reason] || ''}</small>`}`;
  }
  return `<div class="tacts">${up}<button data-act="demolish" data-tile="${i}">철거</button></div>`;
}

function detailTile(i) {
  const s = game.state, p = ui.info, b = s.board[i];
  if (!b) return `<h3>${i}번 칸 <small>빈 칸</small></h3><p class="dim">드워프는 그냥 지나가요.</p>`;
  const def = bld(b.id), src = p.sources[i], g = viewG(), e = game.engine;
  const nm = x => { const d = bld(x.id); return `${d.name}<small>(${x.from}번 칸${x.times > 1 ? ' ⚡' : ''})</small>`; };
  if (!isShop(b.id)) {
    const t = p.targets[i];
    return `<h3>${def.name} <small>${i}번 칸 · 지원 건물 · ${GRADE[def.grade]}</small></h3><p>${rich(def.text, growNow(i, g))}</p>
      ${p.times[i] > 1 ? `<p class="good">발전소가 옆에 있어 효과가 ${p.times[i]}번 걸려요.</p>` : ''}
      ${tileActions(i)}
      <p>닿는 칸: ${t.length ? t.map(j => `<b>${j}번 ${bld(s.board[j].id).name}</b>`).join(', ') : '<span class="dim">지금은 없어요</span>'}</p>
      ${keywordHelp(def.text)}`;
  }
  const by = type => src.filter(x => x.type === type);
  const fees = by('fee'), mults = by('mult'), agains = by('again'), gf = by('growFee'), gm = by('growMult'), br = by('branch'), rm = by('restMult');
  let h = `<h3>${def.name}${b.stars ? ` <span class="stars">${'★'.repeat(b.stars)}</span>` : ''} <small>${i}번 칸</small> ${def.kinds.map(k => chip(k)).join('')}</h3><p>${rich(def.text)}</p>${tileActions(i)}<table class="calc">`;
  h += `<tr><th>요금</th><td>${def.fee}${fees.map(x => ` <span class="cfee">+ ${nm(x)} ${fmtNum(x.value)}</span>`).join('')}${fees.length ? ` = <b>${fmtNum(p.fee[i])}</b>` : ''}</td></tr>`;
  const mparts = [...(b.stars ? [`<span class="stars">${'★'.repeat(b.stars)}</span> ×${p.starMult[i]}`] : []), ...mults.map(x => `${nm(x)} ×${fmtNum(x.value)}`)];
  h += `<tr><th>매출</th><td>${mparts.length ? `<span class="cmult">${mparts.join(' · ')}</span> = <b>×${fmtNum(p.mult[i])}</b>` : '<span class="dim">×1</span>'}</td></tr>`;
  if (agains.length) h += `<tr><th>한 번 더</th><td>${agains.map(x => `${nm(x)} +${x.value}`).join(' · ')} → 올 때마다 <b>${1 + p.again[i]}번</b> 이용</td></tr>`;
  if (gf.length || gm.length) h += `<tr><th>성장</th><td>${[...gf.map(x => `${nm(x)} 요금 +${fmtNum(x.value)}`), ...gm.map(x => `${nm(x)} 매출 배율 +${fmtNum(x.value)}`)].join(' · ')} <small>(추가 바퀴마다)</small>${g > 0 ? ` → 지금 요금 <b>${fmtNum(e.feeAt(p, i, g))}</b>, 매출 <b>×${fmtNum(e.multAt(p, i, g))}</b>` : ''}</td></tr>`;
  if (rm.length) h += `<tr><th>휴식</th><td>${rm.map(x => `${nm(x)} 만족도 ×${fmtNum(x.value)}`).join(' · ')}</td></tr>`;
  h += '</table>';
  const tags = [];
  if (p.top === i) tags.push('👑 요금이 가장 높은 매장');
  if (p.mostStars === i) tags.push('🏅 ★이 가장 많은 매장');
  if (br.length) tags.push(br.map(x => `${nm(x)}에서도 ${x.value}번 이용돼요`).join(' · '));
  if (b.lastSales != null) tags.push(`지난 웨이브의 매출 ${won(b.lastSales)}`);
  if (tags.length) h += `<p class="good">${tags.join(' · ')}</p>`;
  return h + keywordHelp(def.text);
}

function renderDetail() {
  const h = ui.hover || (ui.sel?.type === 'tile' ? { type: 'tile', i: ui.sel.i } : ui.sel?.type === 'cand' ? { type: 'cand', slot: ui.sel.slot } : null), s = game.state;
  let html;
  if (h?.type === 'tile' && h.i < s.board.length) html = detailTile(h.i);
  else if (h?.type === 'cand' && s.candidates[h.slot]) {
    const def = bld(s.candidates[h.slot].id);
    html = `<h3>${def.name} <small>후보 · ${isShop(def.id) ? `매장 · 요금 ${def.fee}` : `지원 건물 · ${GRADE[def.grade]}`}</small> ${(def.kinds || []).map(k => chip(k)).join('')}</h3><p>${rich(def.text)}</p>
      ${!isShop(def.id) ? '<p class="dim">같은 지원 건물은 한 채만 지을 수 있어요.</p>' : ''}${keywordHelp(def.text)}`;
  } else if (h?.type === 'dwarf') {
    const d = (ui.play ? ui.play.out.hand : s.hand)[h.i];
    if (d) {
      const marks = ui.info.shopAt.map(shop => game.engine.tasteOf(shop, d));
      const both = ui.info.shopAt.filter(shop => shop && shop.kinds.some(k => d.likes.includes(k)) && shop.kinds.includes(d.dislike)).length;
      html = `<h3>🧔 ${d.name} ${traitBadge(d)}</h3><p>${d.likes.map(k => chip(k, '♥')).join('')} ${chip(d.dislike, '✕')}</p>
        ${d.trait ? `<p>${rich(traitOf(d.trait).text)}</p>` : ''}
        <p>보드에 좋아하는 매장 <b>${marks.filter(m => m > 0).length}곳</b>, 싫어하는 매장 <b>${marks.filter(m => m < 0).length}곳</b>${both ? `, 둘 다인 매장 ${both}곳` : ''}</p>
        <p class="dim">좋아하는 업종의 매장을 이용하면 만족도가 1 오르고 싫어하는 업종이면 1 내려요. 기본 바퀴를 다 돈 뒤 만족도가 추가 바퀴의 비용(3, 6, 12, 24…) 이상이면 그만큼 내고 한 바퀴를 더 돌아요.</p>`;
    }
  }
  if (!html) html = '<h3>살펴보기</h3><p class="dim">건물, 후보, 드워프 카드에 마우스를 올리면 여기에 풀이가 나와요. 지원 건물은 닿는 칸이, 매장은 자기에게 걸린 지원 건물이 보드에 밝혀져요.</p>';
  $('detail').innerHTML = html;
}

// 마우스가 올라간 것에 따라 보드에 표시를 한다. 칸을 다시 그리지 않고 표시만 바꾼다(끌기가 끊기지 않게).
function applyHighlights() {
  const s = game.state, p = ui.info, h = ui.hover || (ui.sel?.type === 'tile' ? { type: 'tile', i: ui.sel.i } : null);
  const tiles = [...document.querySelectorAll('#board .tile')];
  const d = h?.type === 'dwarf' ? (ui.play ? ui.play.out.hand : s.hand)[h.i] : ui.play ? ui.play.out.dwarf : null;
  tiles.forEach((el, i) => {
    el.classList.remove('hl-target', 'hl-source', 'hl-self', 'hl-prev', 'sel', 'like', 'dislike', 'droppable');
    const t = d ? game.engine.tasteOf(p.shopAt[i], d) : 0;
    el.querySelector('.taste').textContent = t > 0 ? '♥' : t < 0 ? '✕' : '';
    if (t) el.classList.add(t > 0 ? 'like' : 'dislike');
    if (h?.type === 'tile' && s.board[h.i]) {
      if (h.i === i) el.classList.add('hl-self');
      if (p.targets[h.i].includes(i)) { el.classList.add('hl-target'); if (p.supAt[h.i]?.effect.scope === 'prev') el.classList.add('hl-prev'); }
      if (p.sources[h.i].some(x => x.from === i)) el.classList.add('hl-source');
    }
    if (ui.sel?.type === 'tile' && ui.sel.i === i) el.classList.add('sel');
    if (!ui.playing && ui.sel?.type === 'cand' && !s.board[i]) el.classList.add('droppable');
  });
}

// ── 창: 스테이지 시작/덱, 설정, 끝 ───────────────────────────
function deckHTML() {
  const s = game.state, def = game.stageDef();
  const rows = data.tasteKinds.map(k => {
    const likes = s.deck.filter(d => d.likes.includes(k)).length, hates = s.deck.filter(d => d.dislike === k).length;
    const tag = s.popular.includes(k) ? '<em class="pop-tag">인기</em>' : s.unpopular.includes(k) ? '<em class="unpop-tag">비인기</em>' : '';
    return `<tr><td>${chip(k)}${tag}</td><td class="barcell"><span class="mark like">♥</span><i class="b like" style="width:${likes * 13}px"></i> ${likes}</td>
      <td class="barcell"><span class="mark hate">✕</span><i class="b hate" style="width:${hates * 13}px"></i> ${hates}</td></tr>`;
  }).join('');
  const traitCount = data.traits.map(t => `<span class="trait" title="${t.text}">${t.name}</span> ${s.deck.filter(d => d.trait === t.id).length}`).join(' · ');
  return `<p class="deckhead">${deckLabel()}</p>
    <table class="deckbars"><tr><th>업종</th><th>좋아하는 드워프</th><th>싫어하는 드워프</th></tr>${rows}</table>
    <p>특성: ${s.deck.some(d => d.trait) ? traitCount : '<span class="dim">없음</span>'}</p>
    <details><summary>카드 ${s.deck.length}장 펼쳐 보기</summary><div class="deckgrid">${s.deck.map(d =>
      `<div class="mini"><b>${d.name}</b>${traitBadge(d)}<span>${d.likes.map(k => chip(k, '♥')).join('')}</span><span>${chip(d.dislike, '✕')}</span></div>`).join('')}</div></details>
    <table class="targets"><tr><th>스테이지 (칸)</th>${Array.from({ length: c.wavesPerStage }, (_, i) => `<th>웨이브 ${i + 1}</th>`).join('')}<th>건설</th><th>후보</th><th>새로고침</th></tr>
      ${data.stages.map((st, si) => `<tr class="${si === s.stage ? 'curstage' : ''}"><th>${si + 1} (${st.tiles}칸)</th>${st.targets.map((_, wi) => `<td class="${si === s.stage && wi === s.wave ? 'cur' : ''}">${won(game.targetOf(si, wi))}</td>`).join('')}<td>${st.buildsPerPrep}</td><td>${st.candidates}</td><td>${st.refreshBase}</td></tr>`).join('')}</table>
    <p class="dim">${def.tiles}칸 보드 · 정비마다 ${def.buildsPerPrep}채 건설 · 자금은 런 동안 남아요.</p>`;
}

const sel = (key, opts) => `<select data-setv="${key}">${opts.map(([v, label]) => `<option value="${v}" ${settings[key] === v ? 'selected' : ''}>${label}</option>`).join('')}</select>`;
const chk = (key, label, note) => `<label class="sw"><input type="checkbox" data-set="${key}" ${settings[key] ? 'checked' : ''}> <b>${label}</b> <small>${note}</small></label>`;

function renderModal() {
  const m = $('modal'), s = game.state;
  const kind = s.phase === 'over' && ui.modal !== 'settings' && ui.modal !== 'deck' ? 'over' : s.phase === 'stage' && !ui.modal ? 'stage' : ui.modal;
  if (!kind) { m.innerHTML = ''; m.className = ''; return; }
  m.className = 'open';
  let h = '';
  if (kind === 'stage' || kind === 'deck') {
    const intro = s.phase === 'stage';
    h = `<h2>${intro ? `스테이지 ${s.stage + 1} 시작` : `덱 · 스테이지 ${s.stage + 1}`} <small>자금 ${won(s.money)}</small></h2>
      ${intro && s.stage === game.state.options.startStage - 1 ? '<p>거리에 건물을 짓고, 드워프가 그 거리를 돌며 매장마다 돈을 내요. 웨이브가 끝났을 때 <b>자금이 목표 이상</b>이면 통과예요. 목표는 바닥이고, 얼마나 넘었는가가 주인공이에요.</p>' : ''}
      ${intro && s.stage > game.state.options.startStage - 1 ? '<p>보드가 커졌어요. 지은 건물과 ★, 잠근 후보는 사라지고 자금은 그대로 가져가요.</p>' : ''}
      ${deckHTML()}
      <div class="mfoot">${intro ? '<button class="primary" data-act="begin">정비 시작</button>' : '<button data-act="close">닫기</button>'}</div>`;
  } else if (kind === 'settings') {
    h = `<h2>설정 · 시험용 스위치</h2>
      <div class="sw"><b>목표 배율</b> ${sel('targetMult', [[0.5, '0.5'], [1, '1 (기본)'], [2, '2'], [4, '4']])} <small>목표 표의 모든 값에 곱해요. 새 런부터.</small></div>
      <div class="sw"><b>시작 스테이지</b> ${sel('startStage', [1, 2, 3, 4, 5].map(n => [n, n === 1 ? '1 (기본)' : String(n)]))} <small>앞 스테이지의 마지막 목표만큼의 자금으로 시작해요. 새 런부터.</small></div>
      ${chk('preview', '예상 매출 미리보기', '드워프 셋을 고를 때 예상 매출을 보여 줘요. (기본 끔)')}
      ${chk('traits', '특성', '끄면 특성 없이 덱을 짜요. 새 런부터. (기본 켬)')}
      ${chk('deckColor', '덱의 색', '끄면 90마리에서 고르게 30마리를 뽑아요. 새 런부터. (기본 켬)')}
      <div class="sw"><b>난수 씨앗</b> <input id="seed-in" value="${s.seed}" spellcheck="false"> <button data-act="seedGo">이 씨앗으로 새 런</button> <button data-act="seedRandom">무작위 새 런</button>
        <small>같은 씨앗, 같은 조작이면 같은 판이 다시 나와요.</small></div>
      ${chk('autoSkip', '계속 결과만 보기', '드워프가 도는 것을 건너뛰고 결과만 봐요. 시험용 스위치가 아니에요.')}
      <div class="sw"><b>최고 기록</b> ${record ? `${won(record.money)} <small>(한 번에 올린 최고 매출 ${won(record.pay)}, 최다 바퀴 ${record.laps}바퀴)</small>` : '없음'} <button data-act="clearRecord">지우기</button></div>
      <div class="mfoot"><button data-act="close">닫기</button></div>`;
  } else if (kind === 'over') {
    const last = s.results[s.results.length - 1];
    const rows = s.results.map(w => `<tr class="${w.passed ? '' : 'bad'}"><td>${w.stage + 1}-${w.wave + 1}</td><td>${won(w.target)}</td><td><b>${won(w.sales)}</b></td><td>${won(w.moneyAfter)}</td>
      <td>${w.passed ? `${(w.moneyAfter / w.target).toFixed(1)}배` : '모자람'}</td><td class="l">${w.sends.map(x => `${x.name} ${won(x.sales)}(${x.laps}바퀴)`).join(' · ')}</td></tr>`).join('');
    h = `<h2>${s.outcome === 'clear' ? '🎉 클리어! 다섯 스테이지를 모두 통과했어요' : `런이 끝났어요 <small>${last ? `목표에 ${won(last.target - last.moneyAfter)} 모자랐어요.` : ''}</small>`}</h2>
      <div class="records">
        <div><label>최종 자금</label><b class="big">${won(s.money)}</b></div>
        <div><label>닿은 곳</label><b>${stageLabel()}</b></div>
        <div><label>한 번에 올린 최고 매출</label><b>${won(s.bestPay ? s.bestPay.pay : 0)}</b></div>
        <div><label>최다 바퀴</label><b>${s.maxLaps}바퀴</b></div>
        <div><label>최고 기록</label><b>${record ? won(record.money) : '-'}</b>${ui.newRecord ? '<em class="newrec">새 기록!</em>' : ''}</div></div>
      <div class="resultwrap"><table class="result"><tr><th>웨이브</th><th>목표</th><th>매출</th><th>판정 때 자금</th><th>목표의</th><th>보낸 드워프</th></tr>${rows}</table></div>
      <div class="mfoot"><span class="dim">씨앗 ${s.seed}</span><button data-act="sameSeed">같은 씨앗으로 다시</button><button class="primary" data-act="restart">다시 하기</button></div>`;
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
  box.appendChild(el); setTimeout(() => el.remove(), 2600);
  while (box.childElementCount > 3) box.firstElementChild.remove();
}
const diff = (label, a, b) => (a === b ? '' : `${label} ${a}→${b}`);
function changes(ev) {
  const a = ev.before, b = ev.after;
  const parts = [a.h === b.h ? '' : `${gaugeText(a.h)}→${gaugeText(b.h)}`, diff(SN.tipsy, a.d, b.d), diff(SN.hype, a.y, b.y), diff(SN.fatigue, a.tired, b.tired)].filter(Boolean);
  if (a.sat !== b.sat) parts.push(`만족도 ${a.sat}→${b.sat}${ev.satChange > 0 ? ' ♥' : ev.satChange < 0 ? ' ✕' : ''}${ev.restGain ? ` (휴식 +${ev.restGain})` : ''}`);
  return parts.join(' · ') || '변화 없음';
}

// ── 재생: 엔진이 돌려준 기록을 차례로 보여 준다 ───────────────
const TIME = { pass: 60, move: 180, use: 430, skip: 340, lapEnd: 1100, leave: 950 };
const feverRate = () => (ui.play ? Math.min(3, 1 + 0.35 * ui.play.fever) : 1);   // 추가 바퀴를 거듭할수록 빨라진다
function wait(ms) {
  if (ui.skip) return Promise.resolve();
  return new Promise(res => { const t = setTimeout(done, ms / (ui.speed * feverRate())); function done() { clearTimeout(t); ui.wake = null; res(); } ui.wake = done; });
}
const tileEl = i => document.querySelector(`#board .tile[data-tile="${i}"]`);
function placeToken(i, ms) {
  const el = tileEl(i), tk = $('token');
  if (!el || !tk) return;
  tk.hidden = false;
  tk.style.transitionDuration = ms + 'ms';
  tk.style.left = el.offsetLeft + el.offsetWidth / 2 + 'px';
  tk.style.top = el.offsetTop + el.offsetHeight - 6 + 'px';
  tk.className = ui.play && ui.play.fever ? `fever f${Math.min(ui.play.fever, 4)}` : '';
}
function popup(i, html, cls) {
  if (ui.skip) return;
  const el = tileEl(i), fx = $('fx');
  if (!el || !fx) return;
  const p = document.createElement('div');
  p.className = 'pop ' + cls; p.innerHTML = html;
  p.style.left = Math.max(70, Math.min(fx.offsetWidth - 70, el.offsetLeft + el.offsetWidth / 2)) + 'px';
  // 같은 칸에 연달아 뜨면(한 번 더, 2호점) 겹치지 않게 조금씩 위로 올린다
  const stack = fx.querySelectorAll(`.pop[data-at="${i}"]:not(.growpop)`).length;
  p.dataset.at = i;
  p.style.top = el.offsetTop + el.offsetHeight * (cls === 'growpop' ? 0.2 : 0.6) - (cls === 'growpop' ? 0 : (stack % 3) * 24) + 'px';
  const life = 1500 / Math.pow(ui.speed * feverRate(), 0.7);
  p.style.animationDuration = life + 'ms';
  fx.appendChild(p); setTimeout(() => p.remove(), life + 50);
}
function flash(i, cls) {
  const el = tileEl(i);
  if (!el || ui.skip) return;
  el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls);
}
function markReaders(from) {   // 스택을 읽는 매장은 드워프가 다가올 때 밝아진다
  document.querySelectorAll('#board .tile.reading').forEach(el => el.classList.remove('reading'));
  const P = ui.play, p = P.out.info, st = P.st;
  const amount = name => (name === 'hunger' ? Math.max(st.h, 0) : name === 'fullness' ? Math.max(-st.h, 0) : name === 'tipsy' ? st.d : st.y);
  for (let k = 1; k <= 2 && from + k < p.N; k++) {
    const shop = p.shopAt[from + k];
    if (!shop) continue;
    const live = shop.read.some(r => amount(r.stack) > 0) || (shop.threshold && amount(shop.threshold.stack) >= shop.threshold.at) || (shop.rest && st.tired >= (shop.rest.per || shop.rest.at));
    if (live) tileEl(from + k)?.classList.add('reading');
  }
}

function applyUse(ev, P) {
  const out = P.out, shop = out.info.shopAt[ev.shopTile];
  P.st = { h: ev.after.h, d: ev.after.d, y: ev.after.y, tired: ev.after.tired }; P.sat = ev.after.sat; P.total = ev.total;
  if (ev.pay > P.bestPay) P.bestPay = ev.pay;
  const moneyBefore = P.money;
  P.money = out.moneyBefore + ev.total; P.waveSales = out.waveSalesBefore + ev.total;
  const formula = formulaText(ev, SN);
  const where = ev.via === 'branch' ? `2호점→${shop.name}` : shop.name + (ev.via === 'again' ? ' (한 번 더)' : '');
  const via = ev.via === 'again' ? '<i class="via">한 번 더</i>' : ev.via === 'branch' ? `<i class="via">2호점 → ${shop.name}</i>` : '';
  const size = Math.min(44, 16 + 6.5 * Math.log10(ev.pay + 1));
  const satMark = (ev.satChange > 0 ? '<span class="s like">♥ 만족도 +1</span>' : ev.satChange < 0 ? '<span class="s hate">✕ 만족도 −1</span>' : '')
    + (ev.restGain ? `<span class="s rest">💤 ${SN.fatigue} ${ev.restFrom} → 만족도 +${ev.restGain}</span>` : '');
  popup(ev.tile, `${via}<b style="font-size:${size}px">+${won(ev.pay)}</b><span class="f">${formula}</span>${satMark}`, ev.pay >= 10000 ? 'pay huge' : ev.pay >= 500 ? 'pay big' : 'pay');
  flash(ev.tile, ev.pay >= 2000 ? 'paid-big' : 'paid');
  if (ev.via === 'branch') flash(ev.shopTile, 'paid');
  addLog(`<span class="lt">바퀴${ev.lap} · ${ev.tile}번</span><b>${where}</b><span class="lf">${formula}</span><span class="lp">+${won(ev.pay)}</span><span class="ls">${changes(ev)}</span>`);
  if (moneyBefore < out.target && P.money >= out.target) { toast(`🎯 목표 달성! ${won(out.target)}`, 'goal'); addLog(`🎯 자금이 목표 ${won(out.target)}을 넘었어요`, 'mark'); }
  if (!P.broke && out.bestPayBefore > 0 && ev.pay > out.bestPayBefore) { P.broke = true; toast(`⭐ 한 번에 올린 최고 매출 ${won(ev.pay)}`, 'record'); }
}

function applySkip(ev, P) {
  const shop = P.out.info.shopAt[ev.shopTile];
  const why = ev.skip === 'drunk' ? '지나침 (만취)' : '지나침 (포만)';
  popup(ev.tile, `<b>🚫 ${why}</b>`, 'refuse');
  flash(ev.tile, 'refused');
  addLog(`<span class="lt">바퀴${ev.lap} · ${ev.tile}번</span><b>${ev.via === 'branch' ? `2호점→${shop.name}` : shop.name}${ev.via === 'again' ? ' (한 번 더)' : ''}</b><span class="lr">${why}</span><span class="ls">${ev.skip === 'drunk' ? `${SN.tipsy} ${ev.before.d}` : gaugeText(ev.before.h)}</span>`, 'refuse');
}

// 추가 바퀴에 들어서면 성장 지원이 한 번 자란다
function applyGrowth(P, oldG) {
  const p = P.out.info, e = game.engine, grown = [];
  for (const i of p.shopTiles) {
    if (!p.growFee[i] && !p.growMult[i].length) continue;
    const el = tileEl(i);
    if (el) el.querySelector('.tstats').innerHTML = tileStats(i, P.g);
    flash(i, 'grew');
    const parts = [p.growFee[i] ? `요금 +${fmtNum(p.growFee[i])}` : '', p.growMult[i].length ? `매출 ×${fmtNum(e.multAt(p, i, P.g))}` : ''].filter(Boolean).join(' · ');
    popup(i, `<b>▲ ${parts}</b>`, 'growpop');
    grown.push(`${p.shopAt[i].name} 요금 ${fmtNum(e.feeAt(p, i, oldG))}→${fmtNum(e.feeAt(p, i, P.g))}${p.growMult[i].length ? `, 매출 ×${fmtNum(e.multAt(p, i, oldG))}→×${fmtNum(e.multAt(p, i, P.g))}` : ''}`);
  }
  for (let i = 0; i < p.N; i++) {   // 성장 지원의 문구 끝 "(지금 …)"
    const now = growNow(i, P.g), el = now && tileEl(i);
    if (el) { el.querySelector('.ttext').innerHTML = rich(p.supAt[i].text, now); flash(i, 'grew'); }
  }
  if (grown.length) addLog(`<span class="lt">성장</span><span class="ls">${grown.join(' · ')}</span>`, 'growl');
}

function applyLapEnd(ev, P) {
  const st = ev.stacksBefore;
  const had = [st.h ? gaugeText(st.h) : '', st.d ? `${SN.tipsy} ${st.d}` : '', st.y ? `${SN.hype} ${st.y}` : '', st.tired ? `${SN.fatigue} ${st.tired}` : ''].filter(Boolean).join(', ');
  const cleared = had ? `스택이 사라져요 (${had})` : '스택 없음';
  let line, cls;
  if (ev.result === 'base') { line = `기본 바퀴라 계속 돌아요 (만족도 ${ev.sat})`; cls = 'base'; }
  else if (ev.result === 'extra') { line = `만족도 ${ev.satBefore}에서 ${ev.paid}를 내고 <b>🔥 추가 바퀴!</b> (남은 만족도 ${ev.sat}, 다음 비용 ${ev.cost})`; cls = 'extra'; }
  else { line = `만족도 ${ev.sat}, 추가 바퀴의 비용 ${ev.needed} → 떠나요`; cls = 'leave'; }
  P.sat = ev.sat; P.cost = ev.cost;
  P.banner = { cls, html: `바퀴 ${ev.lap} 끝 · 이 바퀴의 매출 <b>${won(ev.lapSales)}</b><br>${line}` };
  addLog(`<span class="lt">바퀴${ev.lap} 끝</span><span class="lp">이 바퀴 +${won(ev.lapSales)}</span><span class="ls">${cleared} · ${line.replace(/<[^>]+>/g, '')}</span>`, 'lap ' + cls);
  if (ev.result === 'extra' && !ui.skip) { const b = $('board'); b.classList.remove('burst'); void b.offsetWidth; b.classList.add('burst'); }
}

async function playSend(choice) {
  const s = game.state;
  if (ui.playing || s.phase !== 'pick') return;
  const out = game.send(choice);
  if (!out) return;
  const d = out.dwarf;
  const P = ui.play = { out, g: out.g0, lap: 1, fever: 0, tile: 0, st: { h: 0, d: 0, y: 0, tired: 0 }, sat: 0, cost: c.extraLapCost.first, total: 0, bestPay: 0, money: out.moneyBefore, waveSales: out.waveSalesBefore, banner: null, broke: false };
  Object.assign(ui, { playing: true, skip: settings.autoSkip, sel: null, hover: null });
  addLog(`▶ ${stageLabel(out.stage, out.wave)} · 보내기 ${out.sendIndex + 1}/${c.sendsPerWave} · <b>${d.name}</b> (♥ ${d.likes.join(', ')} / ✕ ${d.dislike}${d.trait ? ` / ${traitOf(d.trait).name}` : ''})`, 'head');
  render();
  const evs = out.events, N = out.info.N;
  let k = 0;
  while (k < evs.length) {
    const ev = evs[k];
    if (ev.type === 'lapStart') {
      k++;
      const oldG = P.g;
      Object.assign(P, { lap: ev.lap, g: ev.g, cost: ev.cost, sat: ev.sat, st: { h: ev.stacks.h, d: ev.stacks.d, y: ev.stacks.y, tired: 0 } });
      if (ev.extraNo !== P.fever) { P.fever = ev.extraNo; if (!ui.skip) $('board').className = `n${N}` + (P.fever ? ` fever f${Math.min(P.fever, 4)}` : ''); }
      if (ev.g > oldG) applyGrowth(P, oldG);
      if (ev.lap > 1 && !ui.skip) await wait(TIME.pass);
      if (ev.lap > 1) P.banner = P.banner && P.banner.cls === 'extra' ? P.banner : null;
      for (let i = 0; i < N; i++) {
        const here = [];
        while (k < evs.length && evs[k].type !== 'lapEnd' && evs[k].tile === i) here.push(evs[k++]);
        P.tile = i;
        if (!ui.skip) {
          placeToken(i, (here.length ? TIME.move : TIME.pass) / (ui.speed * feverRate()));
          if (here.length || i === 0) { markReaders(i); renderHud(); renderCenter(); }
          await wait(here.length ? TIME.move : TIME.pass);
        }
        for (const e of here) {
          if (e.type === 'use') applyUse(e, P); else applySkip(e, P);
          if (!ui.skip) { renderHud(); renderCenter(); renderTop(); markReaders(i); await wait(e.type === 'use' ? TIME.use : TIME.skip); }
        }
      }
    } else {
      k++;
      applyLapEnd(ev, P);
      if (!ui.skip) { renderHud(); renderCenter(); renderTop(); await wait(ev.result === 'leave' ? TIME.leave : TIME.lapEnd); }
    }
  }
  addLog(`■ ${d.name} · ${out.laps}바퀴(추가 ${out.extraLaps}) · 매출 <b>+${won(out.sales)}</b> · 자금 ${won(s.money)}`, 'tail');
  if (ui.skip) toast(`${d.name}: +${won(out.sales)} (${out.laps}바퀴)`, 'sum');
  if (ui.skip && out.moneyBefore < out.target && s.money >= out.target) toast(`🎯 목표 달성! ${won(out.target)}`, 'goal');
  Object.assign(ui, { playing: false, play: null, skip: false });
  if (s.phase === 'judge') {
    const j = s.judge;
    addLog(`${j.passed ? '✅' : '■'} ${stageLabel()} 판정: 자금 ${won(j.money)} / 목표 ${won(j.target)} → ${j.passed ? `목표 달성! 목표의 ${j.ratio.toFixed(1)}배` : `목표에 ${won(j.target - j.money)} 모자랐어요.`} (이번 웨이브의 매출 ${won(s.waveSales)})`, 'mark');
  }
  render();
}

function finishRun() {   // 끝 화면으로 갈 때 한 번: 최고 기록을 남긴다
  const s = game.state;
  if (ui.recorded) return;
  ui.recorded = true;
  ui.newRecord = !record || s.money > record.money;
  if (ui.newRecord) { record = { money: s.money, pay: s.bestPay ? s.bestPay.pay : 0, laps: s.maxLaps, seed: s.seed }; store.set('record', record); }
}

// ── 조작 ────────────────────────────────────────────────────
// 되돌릴 수 없는 버튼은 두 번 눌러야 한다(브라우저 확인 창은 막힌 곳이 있어 쓰지 않는다).
let armed = null;
function twice(key, msg) {
  if (armed && armed.key === key && Date.now() - armed.t < 5000) { armed = null; return true; }
  armed = { key, t: Date.now() }; toast(msg);
  return false;
}

function act(name, el) {
  const s = game.state;
  switch (name) {
    case 'begin': game.begin(); ui.modal = null; addLog(`— 스테이지 ${s.stage + 1} 시작 · ${game.stageDef().tiles}칸 · 자금 ${won(s.money)}${s.popular.length ? ` · 인기 ${s.popular.join(', ')} · 비인기 ${s.unpopular.join(', ')}` : ''}`, 'mark'); break;
    case 'close': ui.modal = null; break;
    case 'deck': ui.modal = 'deck'; break;
    case 'settings': ui.modal = 'settings'; break;
    case 'restart': if (s.phase === 'over' || (s.results.length === 0 && s.phase === 'stage') || twice('restart', '한 번 더 누르면 지금 런을 버리고 새 런을 시작해요')) return newGame();
      return;
    case 'sameSeed': return newGame(s.seed);
    case 'seedGo': { const v = $('seed-in').value.trim(); if (v) return newGame(v); return; }
    case 'seedRandom': return newGame();
    case 'clearRecord': record = null; store.set('record', null); break;
    case 'lock': game.toggleLock(+el.dataset.slot); break;
    case 'refresh': { const cost = game.refreshCost(); if (game.refresh()) { ui.sel = null; addLog(`새로고침 −${won(cost)} · 자금 ${won(s.money)}`, 'prepl'); } else toast('자금이 모자라요.'); break; }
    case 'upgrade': { const i = +el.dataset.tile, u = game.upgradeInfo(i), nm = bld(s.board[i].id).name;
      if (game.upgrade(i)) addLog(`업그레이드: ${i}번 ${nm} ${'★'.repeat(s.board[i].stars)} · −${won(u.cost)} · 자금 ${won(s.money)}`, 'prepl'); else toast(UP_REASON[u.reason] || '');
      break; }
    case 'demolish': { const i = +el.dataset.tile, nm = bld(s.board[i].id).name;
      if (!twice('demolish' + i, `한 번 더 누르면 ${nm}을(를) 철거해요. 자금과 건설 횟수는 돌아오지 않아요`)) return;
      if (game.demolish(i)) { addLog(`철거: ${i}번 ${nm}`, 'prepl'); ui.sel = null; }
      break; }
    case 'startWave': if (s.buildsLeft > 0 && s.candidates.some(x => x) && s.board.some(b => !b) && !twice('wave' + s.stage + '-' + s.wave, `남은 건설 ${s.buildsLeft}. 남긴 건설은 넘어가지 않아요. 한 번 더 누르면 시작해요`)) return;
      ui.sel = null; game.startWave(); addLog(`— ${stageLabel()} 시작 · 목표 ${won(game.target())} · 자금 ${won(s.money)}`, 'mark'); break;
    case 'send': playSend(+el.dataset.i); return;
    case 'speed': ui.speed = +el.dataset.x; store.set('speed', ui.speed); renderTray(); return;
    case 'skip': ui.skip = true; ui.wake?.(); return;
    case 'proceed': game.proceed(); ui.sel = null; if (s.phase === 'over') { finishRun(); ui.modal = null; } else if (s.phase === 'stage') ui.modal = 'stage'; break;
    case 'logsize': ui.logBig = !ui.logBig; break;
  }
  render();
}

function tryBuild(slot, tile) {
  const s = game.state, cd = s.candidates[slot];
  if (!cd) return;
  if (game.build(slot, tile)) { addLog(`건설: ${tile}번 칸에 <b>${bld(cd.id).name}</b>`, 'prepl'); ui.sel = null; }
  else if (s.buildsLeft <= 0) toast('이번 정비의 건설을 다 썼어요.');
  else if (s.board[tile]) toast('빈 칸에만 지을 수 있어요.');
  else if (!isShop(cd.id)) toast('같은 지원 건물은 한 채만 지을 수 있어요.');
  render();
}
function tryMove(from, to) {
  const b = game.state.board, a = b[from], z = b[to];
  if (game.move(from, to)) addLog(`자리 바꾸기: ${bld(a.id).name} ${from}→${to}${z ? `, ${bld(z.id).name} ${to}→${from}` : ''}`, 'prepl');
  ui.sel = null; render();
}

const root = $('app');
root.addEventListener('click', e => {
  const actEl = e.target.closest('[data-act]');
  if (actEl) { if (!actEl.disabled) act(actEl.dataset.act, actEl); return; }
  if (e.target.id === 'modal' && ui.modal && game.state.phase !== 'stage' && game.state.phase !== 'over') { ui.modal = null; render(); return; }
  if (e.target.closest('#modal') || e.target.closest('input, select, label')) return;
  if (ui.playing) return;
  const s = game.state;
  const cand = e.target.closest('[data-cand]');
  if (cand && s.phase === 'prep') {
    const slot = +cand.dataset.cand;
    ui.sel = ui.sel?.type === 'cand' && ui.sel.slot === slot ? null : { type: 'cand', slot };
    if (ui.sel && s.buildsLeft <= 0) { ui.sel = null; toast('이번 정비의 건설을 다 썼어요.'); }
    return render();
  }
  const tile = e.target.closest('[data-tile]');
  if (tile && game.canMove()) {
    const i = +tile.dataset.tile;
    if (ui.sel?.type === 'cand') return tryBuild(ui.sel.slot, i);
    if (ui.sel?.type === 'tile') return ui.sel.i === i ? (ui.sel = null, render()) : tryMove(ui.sel.i, i);
    if (s.board[i]) { ui.sel = { type: 'tile', i }; render(); }
    return;
  }
  if (e.target.closest('#detail')) return;
  if (ui.sel) { ui.sel = null; render(); }
});
root.addEventListener('change', e => {
  const key = e.target.dataset?.set, keyv = e.target.dataset?.setv;
  if (key) settings[key] = e.target.checked;
  else if (keyv) settings[keyv] = Number(e.target.value);
  else return;
  store.set('settings', settings);
  if (key === 'autoSkip' && ui.playing && settings.autoSkip) { ui.skip = true; ui.wake?.(); return; }
  if (ui.playing) return;
  render();
});
root.addEventListener('keydown', e => { if (e.target.id === 'seed-in' && e.key === 'Enter') act('seedGo'); });

function hoverOf(target) {
  const t = target.closest?.('[data-tile]'); if (t) return { type: 'tile', i: +t.dataset.tile };
  const cd = target.closest?.('[data-cand]'); if (cd) return { type: 'cand', slot: +cd.dataset.cand };
  const d = target.closest?.('[data-dwarf]'); if (d) return { type: 'dwarf', i: +d.dataset.dwarf };
  return null;
}
root.addEventListener('mouseover', e => {
  if (e.target.closest?.('#detail')) return;   // 살펴보기 창 안의 버튼을 누르러 가는 동안은 그대로 둔다
  const h = hoverOf(e.target);
  if (JSON.stringify(h) === JSON.stringify(ui.hover) || ui.drag) return;
  ui.hover = h; renderDetail(); applyHighlights();
});
root.addEventListener('mouseleave', () => { ui.hover = null; renderDetail(); applyHighlights(); });

// 끌어다 놓기: 후보 → 빈 칸(건설), 건물 → 다른 칸(자리 바꾸기)
root.addEventListener('dragstart', e => {
  if (ui.playing) return e.preventDefault();
  const cd = e.target.closest?.('[data-cand]'), t = e.target.closest?.('[data-tile]');
  if (cd && game.state.phase === 'prep' && game.state.buildsLeft > 0) ui.drag = { type: 'cand', slot: +cd.dataset.cand };
  else if (t && game.canMove() && game.state.board[+t.dataset.tile]) ui.drag = { type: 'tile', i: +t.dataset.tile };
  else return e.preventDefault();
  e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', 'x');
  ui.sel = ui.drag; applyHighlights();
});
const dropOk = i => ui.drag && (ui.drag.type === 'cand' ? !game.state.board[i] : ui.drag.i !== i);
root.addEventListener('dragover', e => {
  const t = e.target.closest?.('[data-tile]');
  if (t && dropOk(+t.dataset.tile)) { e.preventDefault(); t.classList.add('over'); }
});
root.addEventListener('dragleave', e => e.target.closest?.('[data-tile]')?.classList.remove('over'));
root.addEventListener('drop', e => {
  const t = e.target.closest?.('[data-tile]'), d = ui.drag;
  ui.drag = null;
  if (!t || !d) return;
  e.preventDefault();
  const i = +t.dataset.tile;
  if (d.type === 'cand') tryBuild(d.slot, i); else tryMove(d.i, i);
});
root.addEventListener('dragend', () => { if (ui.drag) { ui.drag = null; ui.sel = null; render(); } });

let seed0 = null;
try { seed0 = new URLSearchParams(location.search).get('seed'); } catch { /* 주소를 못 읽는 곳 */ }
newGame(seed0 || undefined);
window.__yolo = { get game() { return game; }, ui, settings, newGame, render };   // 콘솔에서 들여다보기용
