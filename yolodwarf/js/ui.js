// 화면. 엔진이 돌려준 기록을 재생만 한다. 규칙 계산은 하지 않는다.
import { createGame } from './game.js';
import { formulaText, fmtNum, gaugeText } from './engine.js';
import { randomSeed } from './rng.js';

const $ = id => document.getElementById(id);
const won = n => Math.round(n).toLocaleString('ko-KR');

// ── 데이터 ──────────────────────────────────────────────────
let data;
try {
  // 한 파일로 묶은 판(build-single.mjs)은 데이터를 안에 품고 있다.
  data = globalThis.__YOLO_DATA__ ?? await (await fetch('data/yolodwarf_data.json', { cache: 'no-store' })).json();
} catch (e) {
  document.body.innerHTML = `<p style="padding:24px;color:#fff">데이터 파일(data/yolodwarf_data.json)을 읽지 못했습니다. README의 실행 방법대로 <code>npm start</code>로 열었는지, 파일의 쉼표나 따옴표가 깨지지 않았는지 확인해 주세요.<br><br>${e}</p>`;
  throw e;
}
const cfg = data.config;
const N = cfg.boardSize;
const COLORS = { 초록: '#4fb873', 주황: '#f0923b', 보라: '#a078e8', 빨강: '#e8574e', 분홍: '#f083b8', 노랑: '#e3bf3a', 파랑: '#559fec' };
const ICONS = { 운동: '🏋️', 식당: '🍜', 술집: '🍺', 오락: '🕹️', 공연: '🎤', 상점: '🛍️', 휴식: '🛏️' };
const RARITY = { common: '흔함', uncommon: '보통', rare: '드묾' };
const kindInfo = new Map(data.kinds.map(k => [k.name, k]));
const kindColor = k => COLORS[kindInfo.get(k)?.color] || '#888';
const building = name => data.buildings.find(b => b.name === name);
const dwarfOf = name => data.dwarves.find(d => d.name === name);
const chip = (k, mark = '') => `<span class="chip" style="--c:${kindColor(k)}">${mark}${ICONS[k] || ''} ${k}</span>`;

// ── 저장되는 것: 역대 최고, 시험용 스위치 ─────────────────────
const store = {
  get(key, fallback) { try { const v = localStorage.getItem('yolodwarf.' + key); return v == null ? fallback : JSON.parse(v); } catch { return fallback; } },
  set(key, v) { try { localStorage.setItem('yolodwarf.' + key, JSON.stringify(v)); } catch { /* 저장이 막힌 브라우저 */ } },
};
const settings = { preview: false, dislike: true, ...store.get('settings', {}) };
let allTimeBest = store.get('best', null);       // { income, dwarf, seed }

// ── 화면 상태 ────────────────────────────────────────────────
let game;
const ui = { sel: null, hover: null, playing: false, play: null, speed: store.get('speed', 1), skip: false, wake: null, modal: null, drag: null };

function newGame(seed) {
  game = createGame(data, { seed: seed || randomSeed(), dislike: settings.dislike });
  Object.assign(ui, { sel: null, hover: null, playing: false, play: null, skip: false, modal: 'intro' });
  $('log').innerHTML = '';
  try { history.replaceState(null, '', '?seed=' + encodeURIComponent(game.state.seed)); } catch { /* 주소를 못 바꾸는 곳 */ }
  render();
}

// ── 보드의 칸 자리: 사각 고리. 0번이 왼쪽 위, 시계 방향 ───────
const COLS = Math.ceil((N + 4) / 4), ROWS = (N + 4) / 2 - COLS;
function tilePos(i) {
  if (i < COLS) return { r: 1, c: i + 1, dir: i === COLS - 1 ? '↓' : '→' };
  if (i < COLS + ROWS - 1) return { r: i - COLS + 2, c: COLS, dir: i === COLS + ROWS - 2 ? '←' : '↓' };
  if (i < 2 * COLS + ROWS - 2) return { r: ROWS, c: COLS - (i - (COLS + ROWS - 2)), dir: i === 2 * COLS + ROWS - 3 ? '↑' : '←' };
  return { r: ROWS - (i - (2 * COLS + ROWS - 3)), c: 1, dir: i === N - 1 ? '→' : '↑' };
}

// ── 그리기 ──────────────────────────────────────────────────
function render() {
  ui.prep = ui.playing ? ui.play.info.prep : game.prep();
  renderTop(); renderBoard(); renderCenter(); renderTray(); renderDetail(); renderModal(); applyHighlights();
}

function renderTop() {
  const s = game.state, P = ui.play;
  const money = P ? P.money : s.money, target = game.target();
  const best = P ? Math.max(P.info.bestBefore, P.total) : (s.bestSend ? s.bestSend.income : 0);
  const pct = Math.min(100, (money / target) * 100);
  $('top').innerHTML = `
    <div class="brand">욜로드워프 <small>데모</small></div>
    <div class="stat"><label>웨이브</label><b>${s.wave + 1}</b><small>/ ${cfg.waves}</small></div>
    <div class="stat money ${money >= target ? 'hit' : ''}"><label>가진 돈 / 목표</label><b id="money">${won(money)}</b><small>/ ${won(target)}</small>
      <div class="bar"><i style="width:${pct}%"></i></div></div>
    <div class="stat"><label>이번 판 최고 수입</label><b>${won(best)}</b></div>
    <div class="stat"><label>역대 최고</label><b>${won(Math.max(P ? P.allBefore : allTimeBest ? allTimeBest.income : 0, best))}</b></div>
    <div class="grow"></div>
    ${settings.preview || !settings.dislike ? '<span class="flag">시험용 스위치 켜짐</span>' : ''}
    <button data-act="deck">덱 30마리</button>
    <button data-act="settings">설정</button>
    <button data-act="restart">새 판</button>
    <div class="seed" title="같은 시드를 설정에 넣으면 같은 판을 다시 한다">시드 <b>${s.seed}</b></div>`;
}

function tileStats(i, g) {
  const p = ui.prep, e = game.engine;
  const fee = e.feeAt(p, i, g), mult = e.multAt(p, i, g);
  return `<span class="fee" data-v="${fee}">요금 <b>${fmtNum(fee)}</b></span>` +
    (mult !== 1 ? `<span class="mult" data-v="${mult}">×<b>${fmtNum(mult)}</b></span>` : '') +
    (p.again[i] ? `<span class="again">+${p.again[i]}회</span>` : '');
}
const viewG = () => (ui.play ? ui.play.g : game.state.phase === 'pick' ? game.state.g : 0);

function renderBoard() {
  const s = game.state, p = ui.prep, g = viewG();
  const canEdit = game.canEditBoard() && !ui.playing;
  let html = '';
  for (let i = 0; i < N; i++) {
    const pos = tilePos(i), name = s.board[i], b = name && building(name);
    const style = `grid-row:${pos.r};grid-column:${pos.c}`;
    const no = `<span class="tno">${i === 0 ? '0 · 입구' : i}</span><span class="arrow">${pos.dir}</span><span class="taste"></span>`;
    if (!b) { html += `<div class="tile empty" data-tile="${i}" style="${style}">${no}<span class="plus">빈 칸</span></div>`; continue; }
    if (b.group === 'shop') {
      const grow = [p.growFee[i] ? `요금 +${fmtNum(p.growFee[i])}` : '', p.growMult[i] ? `배수 +${fmtNum(p.growMult[i])}` : ''].filter(Boolean).join(' · ');
      html += `<div class="tile shop ${p.top === i ? 'top' : ''}" data-tile="${i}" style="${style}" draggable="${canEdit}">
        <div class="kbar">${b.kinds.map(k => `<i style="background:${kindColor(k)}"></i>`).join('')}</div>${no}
        <div class="tname">${b.kinds.map(k => ICONS[k] || '').join('')} ${b.name}</div>
        <div class="tkind">${b.kinds.join(' + ')}${p.top === i ? ' <em class="star">★ 최고 요금</em>' : ''}</div>
        <div class="tstats">${tileStats(i, g)}</div>
        ${grow ? `<div class="tgrow">▲ 바퀴마다 ${grow}</div>` : ''}</div>`;
    } else {
      html += `<div class="tile support" data-tile="${i}" style="${style}" draggable="${canEdit}">
        <div class="kbar"><i></i></div>${no}
        <div class="tname">⚙️ ${b.name}</div>
        <div class="tkind">지원 · ${RARITY[b.rarity] || ''}${p.supportMult[i] > 1 ? ` <em class="boost">효과 ×${p.supportMult[i]}</em>` : ''}</div>
        <div class="ttext">${b.text}</div></div>`;
    }
  }
  html += `<div id="center" style="grid-row:2/${ROWS};grid-column:2/${COLS}"></div><div id="fx"><div id="token" hidden>🧔</div></div>`;
  $('board').innerHTML = html;
  $('board').className = ui.play && ui.play.fever ? `fever f${Math.min(ui.play.fever, 4)}` : '';
  if (ui.play && ui.play.tile >= 0) placeToken(ui.play.tile, 0);
}

function stackHud(P) {
  const { gauge, drunk, hype } = P.stacks;
  const drunkOn = drunk >= cfg.drunkThreshold, fullOn = -gauge >= cfg.fullThreshold;
  const pos = Math.max(-6, Math.min(6, gauge));
  return `<div class="hud-row"><span class="gauge" title="허기짐과 포만감은 한 눈금의 양 끝">
      <i class="gl">포만감</i><span class="gtrack"><em style="left:${50 + pos * (50 / 6)}%"></em></span><i class="gr">허기짐</i></span>
      <b class="${gauge > 0 ? 'hungry' : gauge < 0 ? 'fullv' : ''}">${gaugeText(gauge)}</b>${fullOn ? '<span class="state full">배부름</span>' : ''}
      <span class="st">🍺 취함 <b>${drunk}</b></span>${drunkOn ? '<span class="state drunk">만취</span>' : ''}<span class="st">🎵 흥 <b>${hype}</b></span></div>`;
}

function renderCenter() {
  const s = game.state, P = ui.play, c = $('center');
  if (!c) return;
  if (P) {
    const d = dwarfOf(P.info.dwarf);
    const need = P.lap < cfg.baseLaps ? null : P.lapCost;
    c.innerHTML = `<div class="hud ${P.fever ? 'fever' : ''}">
      <div class="hud-head"><b>🧔 ${d.name}</b>
        <span class="lapno">${P.fever ? `🔥 추가 바퀴 ${P.fever}` : `바퀴 ${P.lap}`}</span></div>
      ${stackHud(P)}
      <div class="hud-row sat"><span class="st">😊 만족도 <b id="satv">${P.sat}</b></span>
        <span class="st">다음 한 바퀴 값 <b>${P.lapCost}</b></span>
        <span class="pips">${Array.from({ length: Math.min(P.lapCost, 12) }, (_, k) => `<i class="${k < P.sat ? 'on' : ''}"></i>`).join('')}</span>
        ${need == null ? '<small>첫 바퀴는 무조건 한 바퀴 더</small>' : ''}</div>
      <div class="hud-row sums"><span>이번 드워프 <b>${won(P.total)}</b></span><span>이번 웨이브 <b>${won(P.waveIncome)}</b></span><span>마친 바퀴 g <b>${P.g}</b></span></div>
      <div class="banner ${P.banner ? P.banner.cls : ''}">${P.banner ? P.banner.html : ''}</div></div>`;
    return;
  }
  const sends = s.waveSends.map((x, i) => `<li>${i + 1}. ${x.dwarf} <b>${won(x.income)}</b> <small>${x.laps}바퀴</small></li>`).join('');
  if (s.phase === 'prep') {
    c.innerHTML = `<div class="info"><h2>정비 <small>웨이브 ${s.wave + 1} 준비</small></h2>
      <p>후보를 골라 빈 칸에 짓는다. <b>남은 건설 ${s.buildsLeft} / ${cfg.buildsPerPrep}</b></p>
      <p class="dim">후보를 끌어다 놓거나, 후보를 누른 뒤 빈 칸을 누른다.<br>지은 건물은 끌어서 자리를 바꾼다(무료, 횟수 제한 없음).<br>드워프는 <b>입구(0번)</b>에서 화살표 방향으로 돈다.</p></div>`;
  } else if (s.phase === 'pick') {
    c.innerHTML = `<div class="info"><h2>웨이브 ${s.wave + 1} <small>보내기 ${s.sendIndex + 1} / ${cfg.sendsPerWave}</small></h2>
      <p>아래 셋 가운데 하나를 골라 보낸다. 안 고른 둘은 버려진다.</p>
      <ul class="sends">${sends}</ul>
      <p class="dim">이번 웨이브에 번 돈 <b>${won(s.waveIncome)}</b> · 마친 바퀴 g <b>${s.g}</b>${s.g ? ' (성장 지원이 그만큼 자라 있다)' : ''}<br>고르기 전에 자리 바꾸기를 할 수 있다.</p></div>`;
  } else if (s.phase === 'judge') {
    const j = s.judge;
    c.innerHTML = `<div class="info judge ${j.passed ? 'pass' : 'failj'}"><h2>${j.cleared ? '🎉 클리어!' : j.passed ? `✅ 웨이브 ${s.wave + 1} 통과` : `💀 웨이브 ${s.wave + 1} 실패`}</h2>
      <p>가진 돈 <b>${won(j.money)}</b> / 목표 <b>${won(j.target)}</b>${j.passed ? '' : ` — ${won(j.target - j.money)} 모자라다`}</p>
      <ul class="sends">${sends}</ul>
      <button class="primary" data-act="proceed">${j.passed && !j.cleared ? '다음 정비로' : '결과 보기'}</button></div>`;
  } else c.innerHTML = '';
}

function buildingCard(b) {
  return b.group === 'shop'
    ? `<div class="kbar">${b.kinds.map(k => `<i style="background:${kindColor(k)}"></i>`).join('')}</div>
       <div class="cname">${b.name}</div><div class="ckind">${b.kinds.map(k => (ICONS[k] || '') + k).join(' + ')}</div>
       <div class="cfee">요금 <b>${b.fee}</b></div><div class="ctext">${b.text}</div>`
    : `<div class="kbar"><i></i></div><div class="cname">⚙️ ${b.name}</div><div class="ckind">지원</div>
       <div class="cfee rar-${b.rarity}">${RARITY[b.rarity] || ''}</div><div class="ctext">${b.text}</div>`;
}

function dwarfCard(name, i, extra = '') {
  const d = dwarfOf(name);
  return `<div class="dwarf ${extra}" data-dwarf="${i}" data-name="${name}">
    <div class="dname">🧔 ${d.name}</div>
    <div class="dtaste">${d.likes.map(k => kindInfo.get(k).taste).join(' · ')}</div>
    <div class="drow"><span class="mark like">♥ 좋아함</span>${d.likes.map(k => chip(k)).join('')}</div>
    <div class="drow"><span class="mark hate">✕ 싫어함</span>${chip(d.dislikes)}</div>`;
}

function renderTray() {
  const s = game.state, t = $('tray');
  if (ui.playing) {
    const P = ui.play;
    t.innerHTML = `<div class="dwarves">${P.choices.map((n, i) => dwarfCard(n, i, n === P.info.dwarf ? 'chosen' : 'gone') + `<div class="dfoot">${n === P.info.dwarf ? '도는 중…' : '버려짐'}</div></div>`).join('')}</div>
      <div class="actions"><div class="speed">배속 ${[1, 2, 4].map(x => `<button data-act="speed" data-x="${x}" class="${ui.speed === x ? 'on' : ''}">${x}배</button>`).join('')}</div>
      <button data-act="skip">건너뛰기 ⏭</button><small>건너뛰어도 결과는 같다</small></div>`;
  } else if (s.phase === 'prep') {
    const cost = game.refreshCost();
    t.innerHTML = `<div class="cands">${s.candidates.map((c, i) => c
      ? `<div class="cand ${building(c.name).group} ${c.frozen ? 'frozen' : ''} ${ui.sel?.type === 'cand' && ui.sel.slot === i ? 'sel' : ''}" data-cand="${i}" draggable="${s.buildsLeft > 0}">
          ${buildingCard(building(c.name))}<button class="freeze" data-act="freeze" data-slot="${i}">${c.frozen ? '❄️ 얼림 (풀기)' : '얼리기'}</button></div>`
      : '<div class="cand none">지음</div>').join('')}</div>
      <div class="actions"><div class="builds">남은 건설 <b>${s.buildsLeft}</b> / ${cfg.buildsPerPrep}</div>
      <button data-act="refresh" ${game.canRefresh() ? '' : 'disabled'}>🔄 새로고침 <b>${won(cost)}</b></button>
      <button class="primary" data-act="startWave">웨이브 ${s.wave + 1} 시작 ▶</button></div>`;
  } else if (s.phase === 'pick') {
    t.innerHTML = `<div class="dwarves">${s.choices.map((n, i) => {
      const pv = settings.preview ? game.preview(i) : null;
      return dwarfCard(n, i, 'pickable') + `<div class="dfoot">${pv ? `<span class="pv">예상 ${won(pv.income)} · ${pv.laps}바퀴</span>` : ''}<button class="primary" data-act="send" data-i="${i}">보내기</button></div></div>`;
    }).join('')}</div>
      <div class="actions"><div class="builds">보내기 <b>${s.sendIndex + 1}</b> / ${cfg.sendsPerWave}</div><small>카드에 마우스를 올리면 좋아하는 건물(♥)과 싫어하는 건물(✕)이 보드에 표시된다</small></div>`;
  } else t.innerHTML = `<div class="actions wide"><small>${s.phase === 'judge' ? '판정 결과는 보드 가운데에 있다.' : ''}</small></div>`;
}

// ── 살펴보기 창 ──────────────────────────────────────────────
function detailTile(i) {
  const s = game.state, p = ui.prep, name = s.board[i];
  if (!name) return `<h3>${i}번 칸 <small>빈 칸</small></h3><p class="dim">드워프는 그냥 지나간다.</p>`;
  const b = building(name), src = p.sources[i], g = viewG();
  const from = x => `${x.name}<small>(${x.from}번 칸${x.m > 1 ? `, 변전소 ×${x.m}` : ''})</small>`;
  if (b.group === 'support') {
    const t = p.targets[i];
    return `<h3>⚙️ ${b.name} <small>${i}번 칸 · 지원 · ${RARITY[b.rarity]}</small></h3><p>${b.text}</p>
      ${p.supportMult[i] > 1 ? `<p class="good">변전소가 옆에 있어 효과가 ${p.supportMult[i]}번 걸린다.</p>` : ''}
      <p>닿는 칸: ${t.length ? t.map(j => `<b>${j}번 ${s.board[j]}</b>`).join(', ') : '<span class="dim">지금은 없다</span>'}</p>`;
  }
  const fees = src.filter(x => x.type === 'fee'), mults = src.filter(x => x.type === 'mult');
  const agains = src.filter(x => x.type === 'again'), gf = src.filter(x => x.type === 'growFee'), gm = src.filter(x => x.type === 'growMult'), br = src.filter(x => x.type === 'branch');
  const e = game.engine;
  let h = `<h3>${b.name} <small>${i}번 칸</small> ${b.kinds.map(k => chip(k)).join('')}</h3><p>${b.text}</p><table class="calc">`;
  h += `<tr><th>요금</th><td>기본 ${b.fee}${fees.map(x => ` + ${from(x)} ${x.value}`).join('')}${fees.length ? ` = <b>${p.fee[i]}</b>` : ''}</td></tr>`;
  h += `<tr><th>곱</th><td>${mults.length ? mults.map(x => `${from(x)} ×${fmtNum(x.value)}`).join(' · ') + ` = <b>×${fmtNum(p.mult[i])}</b>` : '<span class="dim">×1</span>'}</td></tr>`;
  h += `<tr><th>한 번 더</th><td>${agains.length ? agains.map(x => `${from(x)} +${x.value}`).join(' · ') + ` → 한 번 올 때 <b>${1 + p.again[i]}번</b> 이용` : '<span class="dim">없음</span>'}</td></tr>`;
  if (gf.length || gm.length) h += `<tr><th>성장</th><td>${[...gf.map(x => `${from(x)} 요금 +${fmtNum(x.value)}`), ...gm.map(x => `${from(x)} 배수 +${fmtNum(x.value)}`)].join(' · ')} <small>(바퀴마다)</small></td></tr>`;
  if (g > 0 && (gf.length || gm.length)) h += `<tr><th>지금</th><td>마친 바퀴 g=${g} → 요금 <b>${fmtNum(e.feeAt(p, i, g))}</b>, 곱 <b>×${fmtNum(e.multAt(p, i, g))}</b></td></tr>`;
  h += '</table>';
  if (p.top === i) h += '<p class="good">★ 요금이 가장 높은 건물 (관광 안내소·방송국·2호점의 대상)</p>';
  if (br.length) h += `<p class="good">${br.map(x => `${from(x)}에서도 ${x.value}번 이용된다`).join(' · ')}</p>`;
  if (b.refuses) h += `<p class="warn">${b.refuses === 'drunk' ? `만취(취함 ${cfg.drunkThreshold} 이상)한 손님을 받지 않는다` : `배부른(포만감 ${cfg.fullThreshold} 이상) 손님을 받지 않는다`}</p>`;
  return h;
}

function tasteOf(d, b) {
  if (!b || b.group !== 'shop') return null;
  const liked = b.kinds.some(k => d.likes.includes(k)), hated = b.kinds.includes(d.dislikes);
  return liked && hated ? 'both' : liked ? 'like' : hated ? 'dislike' : null;
}

function renderDetail() {
  const h = ui.hover, s = game.state;
  let html;
  if (h?.type === 'tile') html = detailTile(h.i);
  else if (h?.type === 'cand' && s.candidates[h.slot]) {
    const b = building(s.candidates[h.slot].name);
    html = `<h3>${b.group === 'support' ? '⚙️ ' : ''}${b.name} <small>후보 · ${b.group === 'shop' ? `장사 · 요금 ${b.fee}` : `지원 · ${RARITY[b.rarity]}`}</small> ${(b.kinds || []).map(k => chip(k)).join('')}</h3><p>${b.text}</p>
      ${b.refuses ? `<p class="warn">${b.refuses === 'drunk' ? '만취한 손님을 받지 않는다' : '배부른 손님을 받지 않는다'}</p>` : ''}
      ${b.group === 'support' ? '<p class="dim">같은 지원 건물은 보드에 한 채만 지을 수 있다.</p>' : ''}`;
  } else if (h?.type === 'dwarf') {
    const d = dwarfOf(h.name);
    const marks = s.board.map(n => tasteOf(d, n && building(n)));
    html = `<h3>🧔 ${d.name}</h3><p>${d.likes.map(k => chip(k, '♥')).join('')} ${chip(d.dislikes, '✕')}</p>
      <p>보드에 좋아하는 건물 <b>${marks.filter(m => m === 'like').length}채</b>, 싫어하는 건물 <b>${marks.filter(m => m === 'dislike').length}채</b>${marks.includes('both') ? `, 둘 다인 건물 ${marks.filter(m => m === 'both').length}채(변화 없음)` : ''}</p>
      <p class="dim">좋아하는 건물을 이용하면 만족도 +1, 싫어하는 건물은 −1(0 아래로는 안 내려간다). 낸 돈은 취향과 무관하다.<br>기본 2바퀴 뒤, 만족도가 한 바퀴 값(3 → 6 → 12 → 24) 이상이면 그만큼 내고 한 바퀴 더 돈다.</p>`;
  } else {
    html = `<h3>살펴보기</h3><p class="dim">건물, 후보, 드워프 카드에 마우스를 올리면 여기에 풀이가 나온다.<br>지원 건물은 효과가 닿는 칸이, 장사 건물은 자기에게 걸린 지원이 보드에 표시된다.</p>
      <p class="dim">웨이브 목표: ${cfg.targets.map((t, i) => `<span class="${i === s.wave ? 'cur' : ''}">${i + 1}웨이브 ${won(t)}</span>`).join(' · ')}</p>`;
  }
  $('detail').innerHTML = html;
}

// 마우스가 올라간 것에 따라 보드에 표시를 한다. 칸을 다시 그리지 않고 표시만 바꾼다(끌기가 끊기지 않게).
function applyHighlights() {
  const s = game.state, p = ui.prep, h = ui.hover;
  const tiles = [...document.querySelectorAll('#board .tile')];
  const dwarfName = h?.type === 'dwarf' ? h.name : ui.play ? ui.play.info.dwarf : null;
  const d = dwarfName && dwarfOf(dwarfName);
  tiles.forEach((el, i) => {
    el.classList.remove('hl-target', 'hl-source', 'hl-self', 'sel', 'like', 'dislike', 'both', 'droppable');
    const t = d ? tasteOf(d, s.board[i] && building(s.board[i])) : null;
    el.querySelector('.taste').textContent = t === 'like' ? '♥' : t === 'dislike' ? '✕' : t === 'both' ? '♥✕' : '';
    if (t) el.classList.add(t);
    if (h?.type === 'tile' && s.board[h.i]) {
      if (h.i === i) el.classList.add('hl-self');
      if (p.targets[h.i].includes(i)) el.classList.add('hl-target');
      if (p.sources[h.i].some(x => x.from === i)) el.classList.add('hl-source');
    }
    if (ui.sel?.type === 'tile' && ui.sel.i === i) el.classList.add('sel');
    if (ui.sel?.type === 'cand' && s.board[i] == null) el.classList.add('droppable');
    if (ui.sel?.type === 'tile' && ui.sel.i !== i) el.classList.add('droppable');
  });
}

// ── 창: 시작/덱, 설정, 결과 ──────────────────────────────────
function deckHTML() {
  const rows = data.kinds.map(k => {
    const likes = data.dwarves.filter(d => d.likes.includes(k.name)).length, hates = data.dwarves.filter(d => d.dislikes === k.name).length;
    return `<tr><td>${chip(k.name)}</td><td class="barcell"><span class="mark like">♥</span><i class="b like" style="width:${likes * 16}px"></i> ${likes}</td>
      <td class="barcell"><span class="mark hate">✕</span><i class="b hate" style="width:${hates * 16}px"></i> ${hates}</td></tr>`;
  }).join('');
  return `<table class="deckbars"><tr><th>종류</th><th>좋아하는 드워프</th><th>싫어하는 드워프</th></tr>${rows}</table>
    <details><summary>카드 ${data.dwarves.length}장 펼쳐 보기</summary><div class="deckgrid">${data.dwarves.map(d =>
      `<div class="mini"><b>${d.name}</b><span>${d.likes.map(k => chip(k, '♥')).join('')}</span><span>${chip(d.dislikes, '✕')}</span></div>`).join('')}</div></details>
    <table class="targets"><tr><th>웨이브</th>${cfg.targets.map((_, i) => `<td class="${i === game.state.wave ? 'cur' : ''}">${i + 1}</td>`).join('')}</tr>
      <tr><th>목표 (가진 돈)</th>${cfg.targets.map((t, i) => `<td class="${i === game.state.wave ? 'cur' : ''}"><b>${won(t)}</b></td>`).join('')}</tr>
      <tr><th>첫 새로고침 값</th>${cfg.targets.map((_, i) => `<td>${won(game.engine.refreshCost(i, 0))}</td>`).join('')}</tr></table>`;
}

function renderModal() {
  const m = $('modal'), s = game.state;
  const kind = s.phase === 'over' && ui.modal !== 'settings' && ui.modal !== 'deck' ? 'over' : ui.modal;
  if (!kind) { m.innerHTML = ''; m.className = ''; return; }
  m.className = 'open';
  let h = '';
  if (kind === 'intro' || kind === 'deck') {
    h = `<h2>${kind === 'intro' ? '욜로드워프 — 스테이지 시작' : '덱 30마리'}</h2>
      ${kind === 'intro' ? `<p>고리 모양 보드에 가게를 짓고, 손님 드워프가 그 위를 돌며 돈을 낸다. 웨이브마다 셋씩 세 번 보여 주는 드워프 가운데 하나씩 골라 보낸다. 웨이브가 끝났을 때 <b>가진 돈이 목표 이상</b>이면 통과다. 시작 돈 ${cfg.startMoney}.</p>` : ''}
      ${deckHTML()}
      <div class="mfoot">${kind === 'intro' ? '<button class="primary" data-act="begin">정비 시작 ▶</button>' : '<button data-act="close">닫기</button>'}</div>`;
  } else if (kind === 'settings') {
    h = `<h2>설정 · 시험용 스위치</h2>
      <label class="sw"><input type="checkbox" data-set="preview" ${settings.preview ? 'checked' : ''}> <b>예상 수입 미리보기</b> <small>드워프 카드에 그 드워프를 보냈을 때의 수입을 보여 준다 (기본 끔)</small></label>
      <label class="sw"><input type="checkbox" data-set="dislike" ${settings.dislike ? 'checked' : ''}> <b>싫어하는 종류</b> <small>끄면 만족도를 깎지 않는다 (기본 켬)</small></label>
      <div class="sw"><b>시드</b> <input id="seed-in" value="${s.seed}" spellcheck="false"> <button data-act="seedGo">이 시드로 새 판</button> <button data-act="seedRandom">무작위 새 판</button>
        <small>같은 시드, 같은 조작이면 후보와 드워프가 똑같이 나온다.</small></div>
      <div class="sw"><b>역대 최고</b> ${allTimeBest ? `${won(allTimeBest.income)} <small>(${allTimeBest.dwarf}, 시드 ${allTimeBest.seed})</small>` : '없음'} <button data-act="clearBest">지우기</button></div>
      <div class="mfoot"><button data-act="close">닫기</button></div>`;
  } else if (kind === 'over') {
    const rows = s.waveResults.map(w => `<tr class="${w.passed ? '' : 'bad'}"><td>${w.wave + 1}</td><td>${won(w.target)}</td><td><b>${won(w.income)}</b></td><td>${won(w.moneyAfter)}</td>
      <td>${w.passed ? '통과' : '실패'}</td><td class="l">${w.sends.map(x => `${x.dwarf} ${won(x.income)}(${x.laps}바퀴)`).join(' · ')}</td></tr>`).join('');
    h = `<h2>${s.outcome === 'clear' ? '🎉 클리어! 다섯 웨이브를 모두 통과했다' : `💀 웨이브 ${s.wave + 1}에서 끝났다`}</h2>
      <p>이번 판 최고 수입 <b class="big">${won(s.bestSend ? s.bestSend.income : 0)}</b> ${s.bestSend ? `<small>(${s.bestSend.dwarf}, 웨이브 ${s.bestSend.wave + 1})</small>` : ''}
        · 역대 최고 <b>${allTimeBest ? won(allTimeBest.income) : 0}</b> · 마지막에 가진 돈 <b>${won(s.money)}</b></p>
      <table class="result"><tr><th>웨이브</th><th>목표</th><th>번 돈</th><th>판정 때 가진 돈</th><th>판정</th><th>보낸 드워프</th></tr>${rows}</table>
      <div class="mfoot"><span class="dim">시드 ${s.seed}</span><button data-act="sameSeed">같은 시드로 다시</button><button class="primary" data-act="restart">다시 하기</button></div>`;
  }
  m.innerHTML = `<div class="sheet ${kind}">${h}</div>`;
}

// ── 기록 창, 알림 ────────────────────────────────────────────
function addLog(html, cls = '') {
  const el = document.createElement('div');
  el.className = 'line ' + cls; el.innerHTML = html;
  const log = $('log'); log.appendChild(el); log.scrollTop = log.scrollHeight;
}
function toast(text, cls = '') {
  const el = document.createElement('div');
  el.className = 'toast ' + cls; el.textContent = text;
  $('toasts').appendChild(el); setTimeout(() => el.remove(), 2600);
}
const diff = (label, a, b) => (a === b ? '' : `${label} ${a}→${b}`);
function changes(ev) {
  const a = ev.before, b = ev.after;
  const parts = [a.gauge === b.gauge ? '' : `${gaugeText(a.gauge)}→${gaugeText(b.gauge)}`, diff('취함', a.drunk, b.drunk), diff('흥', a.hype, b.hype)].filter(Boolean);
  let sat = '';
  if (ev.countsSatisfaction && ev.taste === 'like') sat = `만족도 ${a.satisfaction}→${b.satisfaction} ♥`;
  else if (ev.countsSatisfaction && ev.taste === 'dislike') sat = ev.satChange ? `만족도 ${a.satisfaction}→${b.satisfaction} ✕` : (game.state.options.dislike ? '만족도 0 그대로 ✕' : '');
  if (sat) parts.push(sat);
  return parts.join(' · ') || '변화 없음';
}

// ── 재생: 엔진이 돌려준 기록을 차례로 보여 준다 ───────────────
const TIME = { pass: 90, move: 230, use: 520, refuse: 420, lapEnd: 1250, leave: 1100 };
function wait(ms) {
  if (ui.skip) return Promise.resolve();
  const fever = ui.play ? Math.min(3, 1 + 0.35 * ui.play.fever) : 1;   // 추가 바퀴를 거듭할수록 빨라진다
  return new Promise(res => { const t = setTimeout(done, ms / (ui.speed * fever)); function done() { clearTimeout(t); ui.wake = null; res(); } ui.wake = done; });
}
function tileEl(i) { return document.querySelector(`#board .tile[data-tile="${i}"]`); }
function placeToken(i, ms) {
  const el = tileEl(i), tk = $('token');
  if (!el || !tk) return;
  tk.hidden = false;
  tk.style.transitionDuration = ms + 'ms';
  tk.style.left = el.offsetLeft + el.offsetWidth / 2 + 'px';
  tk.style.top = el.offsetTop + el.offsetHeight - 8 + 'px';
  tk.className = ui.play && ui.play.fever ? `fever f${Math.min(ui.play.fever, 4)}` : '';
}
function popup(i, html, cls) {
  if (ui.skip) return;
  const el = tileEl(i), fx = $('fx');
  if (!el || !fx) return;
  const p = document.createElement('div');
  p.className = 'pop ' + cls; p.innerHTML = html;
  p.style.left = el.offsetLeft + el.offsetWidth / 2 + 'px';
  // 같은 칸에 연달아 뜨면(한 번 더, 2호점) 겹치지 않게 조금씩 위로 올린다
  const stack = fx.querySelectorAll(`.pop[data-at="${i}"]:not(.growpop)`).length;
  p.dataset.at = i;
  p.style.top = el.offsetTop + el.offsetHeight * (cls === 'growpop' ? 0.2 : 0.62) - (cls === 'growpop' ? 0 : (stack % 3) * 26) + 'px';
  const life = 1600 / Math.pow(ui.speed * (ui.play ? Math.min(3, 1 + 0.35 * ui.play.fever) : 1), 0.7);
  p.style.animationDuration = life + 'ms';
  fx.appendChild(p); setTimeout(() => p.remove(), life + 50);
}
function flash(i, cls) {
  const el = tileEl(i);
  if (!el || ui.skip) return;
  el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls);
}
const READS = ['feePerHunger', 'feePerDrunk', 'feePerHype', 'consumeAllHypeFeePer', 'doubleIfDrunkAtLeast'];
function markReaders(from) {   // 스택을 읽는 건물은 드워프가 다가올 때 밝아진다
  document.querySelectorAll('#board .tile.reading').forEach(el => el.classList.remove('reading'));
  const s = game.state, P = ui.play;
  for (let k = 1; k <= 2 && from + k < N; k++) {
    const b = s.board[from + k] && building(s.board[from + k]);
    if (!b || b.group !== 'shop') continue;
    const st = P.stacks, e = b.effect;
    const live = (e.feePerHunger && st.gauge > 0) || (e.feePerDrunk && st.drunk > 0) || ((e.feePerHype || e.consumeAllHypeFeePer) && st.hype > 0) || (e.doubleIfDrunkAtLeast != null && st.drunk >= e.doubleIfDrunkAtLeast);
    if (READS.some(key => e[key] != null) && live) tileEl(from + k)?.classList.add('reading');
  }
}

function applyUse(ev, P) {
  const info = P.info;
  P.stacks = { gauge: ev.after.gauge, drunk: ev.after.drunk, hype: ev.after.hype };
  P.sat = ev.after.satisfaction; P.total = ev.incomeSoFar;
  const moneyBefore = P.money;
  P.money = info.moneyBefore + ev.incomeSoFar; P.waveIncome = info.waveIncomeBefore + ev.incomeSoFar;
  const formula = formulaText(ev);
  const via = ev.via === 'again' ? '<i class="via">한 번 더</i>' : ev.via === 'branch' ? `<i class="via">2호점 → ${ev.building}</i>` : '';
  const size = Math.min(46, 17 + 7 * Math.log10(ev.pay + 1));
  const satMark = !ev.countsSatisfaction ? '' : ev.taste === 'like' ? '<span class="s like">♥ 만족도 +1</span>'
    : ev.taste === 'dislike' && game.state.options.dislike ? `<span class="s hate">✕ 만족도 ${ev.satChange ? '−1' : '0 그대로'}</span>` : '';
  popup(ev.tile, `${via}<b style="font-size:${size}px">+${won(ev.pay)}</b><span class="f">${formula}</span>${satMark}`, ev.pay >= 1000 ? 'pay huge' : ev.pay >= 100 ? 'pay big' : 'pay');
  flash(ev.tile, ev.pay >= 300 ? 'paid-big' : 'paid');
  if (ev.via === 'branch') flash(ev.shopTile, 'paid');
  addLog(`<span class="lt">바퀴${ev.lap} · ${ev.tile}번</span><b>${ev.via === 'branch' ? `2호점→${ev.building}` : ev.building}${ev.via === 'again' ? ' (한 번 더)' : ''}</b><span class="lf">${formula}</span><span class="lp">+${won(ev.pay)}</span><span class="ls">${changes(ev)}</span>`);
  const target = game.cfg.targets[info.wave];
  if (moneyBefore < target && P.money >= target) { toast(`🎯 목표 ${won(target)} 돌파!`, 'goal'); addLog(`🎯 가진 돈이 목표 ${won(target)}을 넘었다`, 'mark'); }
  if (!P.brokeAll && P.allBefore > 0 && P.total > P.allBefore) { P.brokeAll = P.brokeRun = true; toast(`🏆 역대 최고 수입 경신! (종전 ${won(P.allBefore)})`, 'record'); }
  else if (!P.brokeRun && info.bestBefore > 0 && P.total > info.bestBefore) { P.brokeRun = true; toast(`⭐ 이번 판 최고 수입 경신! (종전 ${won(info.bestBefore)})`, 'record'); }
}

function applyRefuse(ev, P) {
  const why = ev.reason === 'drunk' ? '만취해서 못 들어감' : '배불러서 못 들어감';
  popup(ev.tile, `<b>🚫 ${why}</b>${ev.via === 'again' ? '<span class="f">남은 "한 번 더"도 하지 않는다</span>' : ''}`, 'refuse');
  flash(ev.tile, 'refused');
  addLog(`<span class="lt">바퀴${ev.lap} · ${ev.tile}번</span><b>${ev.via === 'branch' ? `2호점→${ev.building}` : ev.building}${ev.via === 'again' ? ' (한 번 더)' : ''}</b><span class="lr">🚫 ${why}</span><span class="ls">${ev.reason === 'drunk' ? `취함 ${ev.before.drunk}` : gaugeText(ev.before.gauge)}</span>`, 'refuse');
}

function applyLapEnd(ev, P) {
  const st = ev.stacksBefore;
  const had = [st.gauge ? gaugeText(st.gauge) : '', st.drunk ? `취함 ${st.drunk}` : '', st.hype ? `흥 ${st.hype}` : ''].filter(Boolean).join(', ');
  const cleared = had ? `스택이 사라진다 (${had} → 0)` : '스택 없음';
  let line, cls;
  if (ev.result === 'base') { line = `기본 바퀴 — 무조건 한 바퀴 더 (만족도 ${ev.satisfaction}은 쌓아 둔다)`; cls = 'base'; }
  else if (ev.result === 'extra') { line = `만족도 ${ev.satisfactionBefore} − 한 바퀴 값 ${ev.paid} = ${ev.satisfaction} → <b>🔥 한 바퀴 더!</b> (다음 값 ${ev.lapCost})`; cls = 'extra'; }
  else { line = `만족도 ${ev.satisfaction} &lt; 한 바퀴 값 ${ev.needed} → 떠난다`; cls = 'leave'; }
  P.stacks = { gauge: 0, drunk: 0, hype: 0 }; P.sat = ev.satisfaction; P.lapCost = ev.lapCost;
  P.banner = { cls, html: `<b>바퀴 ${ev.lap} 끝 · 이 바퀴 +${won(ev.lapIncome)}</b><br>${cleared}<br>${line}` };
  addLog(`<span class="lt">바퀴${ev.lap} 끝</span><span class="lp">이 바퀴 +${won(ev.lapIncome)}</span><span class="ls">${cleared} · ${line.replace(/<[^>]+>/g, '')}</span>`, 'lap ' + cls);
  // 성장 지원이 건물을 키운다 (g가 1 늘었다)
  const prep = P.info.prep, oldG = P.g;
  P.g = ev.g;
  const grown = [];
  for (const i of prep.shops) {
    if (!prep.growFee[i] && !prep.growMult[i]) continue;
    const el = tileEl(i);
    if (el) el.querySelector('.tstats').innerHTML = tileStats(i, P.g);
    flash(i, 'grew');
    const parts = [prep.growFee[i] ? `요금 +${fmtNum(prep.growFee[i])}` : '', prep.growMult[i] ? `곱 +${fmtNum(prep.mult[i] * prep.growMult[i])}` : ''].filter(Boolean).join(' · ');
    popup(i, `<b>▲ ${parts}</b>`, 'growpop');
    grown.push(`${game.state.board[i]} 요금 ${fmtNum(game.engine.feeAt(prep, i, oldG))}→${fmtNum(game.engine.feeAt(prep, i, P.g))}${prep.growMult[i] ? `, 곱 ×${fmtNum(game.engine.multAt(prep, i, oldG))}→×${fmtNum(game.engine.multAt(prep, i, P.g))}` : ''}`);
  }
  if (grown.length) addLog(`<span class="lt">성장</span><span class="ls">${grown.join(' · ')}</span>`, 'growl');
  if (ev.result === 'extra' && !ui.skip) {
    const b = $('board'); b.classList.remove('burst'); void b.offsetWidth; b.classList.add('burst');
  }
}

async function playSend(choice) {
  const s = game.state;
  if (ui.playing || s.phase !== 'pick') return;
  const choices = s.choices.slice(), allBefore = allTimeBest ? allTimeBest.income : 0;
  const info = game.send(choice);
  if (!info) return;
  if (info.income > allBefore) { allTimeBest = { income: info.income, dwarf: info.dwarf, seed: s.seed }; store.set('best', allTimeBest); }
  const P = ui.play = { info, choices, allBefore, g: info.lapsDoneBefore, lap: 1, fever: 0, tile: 0, stacks: { gauge: 0, drunk: 0, hype: 0 }, sat: 0, lapCost: cfg.lapCostStart, total: 0, money: info.moneyBefore, waveIncome: info.waveIncomeBefore, banner: null, brokeRun: false, brokeAll: false };
  Object.assign(ui, { playing: true, skip: false, sel: null, hover: null });
  const d = dwarfOf(info.dwarf);
  addLog(`▶ 웨이브 ${info.wave + 1} · 보내기 ${info.sendIndex + 1}/${cfg.sendsPerWave} · <b>${d.name}</b> (♥ ${d.likes.join(', ')} / ✕ ${d.dislikes}) · 시작 g=${info.lapsDoneBefore}`, 'head');
  render();
  const evs = info.events;
  let k = 0;
  while (k < evs.length) {
    const ev = evs[k];
    if (ev.type === 'lapStart') {
      k++;
      P.lap = ev.lap; P.g = ev.g; P.lapCost = ev.lapCost;
      const fever = ev.extra ? ev.lap - cfg.baseLaps : 0;
      if (fever !== P.fever) { P.fever = fever; $('board').className = fever ? `fever f${Math.min(fever, 4)}` : ''; }
      if (ev.lap > 1) P.banner = null;
      for (let i = 0; i < N; i++) {
        const here = [];
        while (k < evs.length && evs[k].type !== 'lapEnd' && evs[k].tile === i) here.push(evs[k++]);
        P.tile = i;
        const ms = (here.length ? TIME.move : TIME.pass) / (ui.speed * Math.min(3, 1 + 0.35 * P.fever));
        placeToken(i, ui.skip ? 0 : ms);
        if (!ui.skip) { applyHighlights(); markReaders(i); renderCenter(); }
        await wait(here.length ? TIME.move : TIME.pass);
        for (const e of here) {
          if (e.type === 'use') applyUse(e, P); else applyRefuse(e, P);
          if (!ui.skip) { renderCenter(); renderTop(); markReaders(i); }
          await wait(e.type === 'use' ? TIME.use : TIME.refuse);
        }
      }
    } else {
      k++;
      applyLapEnd(ev, P);
      if (!ui.skip) { renderCenter(); renderTop(); }
      await wait(ev.result === 'leave' ? TIME.leave : TIME.lapEnd);
    }
  }
  addLog(`■ ${d.name} 떠남 · ${info.laps}바퀴 · 합계 <b>+${won(info.income)}</b> (바퀴마다 ${info.incomePerLap.map(won).join(' / ')}) · 가진 돈 ${won(s.money)}`, 'tail');
  if (ui.skip) {   // 건너뛰었으면 놓친 알림을 한 번에
    const target = cfg.targets[info.wave];
    toast(`${d.name}: +${won(info.income)} (${info.laps}바퀴)`, 'sum');
    if (info.moneyBefore < target && s.money >= target) toast(`🎯 목표 ${won(target)} 돌파!`, 'goal');
  }
  Object.assign(ui, { playing: false, play: null, skip: false });
  if (s.phase === 'judge') addLog(`${s.judge.passed ? '✅' : '💀'} 웨이브 ${s.wave + 1} 판정: 가진 돈 ${won(s.money)} / 목표 ${won(s.judge.target)} → ${s.judge.cleared ? '클리어' : s.judge.passed ? '통과' : '실패'} (이번 웨이브에 번 돈 ${won(s.waveIncome)})`, 'mark');
  render();
}

// ── 조작 ────────────────────────────────────────────────────
// 되돌릴 수 없는 단추는 두 번 눌러야 한다(브라우저 확인 창은 막힌 곳이 있어 쓰지 않는다).
let armed = null;
function twice(key, msg) {
  if (armed && armed.key === key && Date.now() - armed.t < 5000) { armed = null; return true; }
  armed = { key, t: Date.now() }; toast(msg);
  return false;
}
function act(name, el) {
  const s = game.state;
  switch (name) {
    case 'begin': game.begin(); ui.modal = null; addLog(`새 판 · 시드 ${s.seed} · 시작 돈 ${cfg.startMoney}`, 'mark'); break;
    case 'close': ui.modal = null; break;
    case 'deck': ui.modal = s.phase === 'intro' ? 'intro' : 'deck'; break;
    case 'settings': ui.modal = 'settings'; break;
    case 'restart': if (s.phase === 'over' || s.phase === 'intro' || twice('restart', '한 번 더 누르면 지금 판을 버리고 새 판을 시작한다')) return newGame();
      return;
    case 'sameSeed': return newGame(s.seed);
    case 'seedGo': { const v = $('seed-in').value.trim(); if (v) return newGame(v); return; }
    case 'seedRandom': return newGame();
    case 'clearBest': allTimeBest = null; store.set('best', null); break;
    case 'freeze': game.toggleFreeze(+el.dataset.slot); break;
    case 'refresh': { const cost = game.refreshCost(); if (game.refresh()) { ui.sel = null; addLog(`🔄 새로고침 −${won(cost)} · 가진 돈 ${won(s.money)}`, 'prepl'); } break; }
    case 'startWave': if (s.buildsLeft > 0 && s.candidates.some(c => c) && !twice('wave' + s.wave, `건설이 ${s.buildsLeft}채 남았다. 남긴 건설은 넘어가지 않는다. 한 번 더 누르면 시작`)) return;
      ui.sel = null; game.startWave(); addLog(`— 웨이브 ${s.wave + 1} 시작 · 목표 ${won(game.target())} · 보드: ${s.board.map((b, i) => (b ? `${i}:${b}` : '')).filter(Boolean).join(', ') || '비어 있음'}`, 'mark'); break;
    case 'send': playSend(+el.dataset.i); return;
    case 'speed': ui.speed = +el.dataset.x; store.set('speed', ui.speed); renderTray(); return;
    case 'skip': ui.skip = true; ui.wake?.(); return;
    case 'proceed': game.proceed(); if (s.phase === 'over') ui.modal = null; break;
  }
  render();
}

function tryBuild(slot, tile) {
  const c = game.state.candidates[slot];
  if (!c) return;
  if (game.build(slot, tile)) { addLog(`🏗 ${tile}번 칸에 <b>${c.name}</b> 건설`, 'prepl'); ui.sel = null; }
  else if (game.state.buildsLeft <= 0) toast('이번 정비의 건설 2채를 다 썼다');
  else if (game.state.board[tile] != null) toast('빈 칸에만 지을 수 있다');
  render();
}
function tryMove(from, to) {
  const b = game.state.board;
  const a = b[from], z = b[to];
  if (game.move(from, to)) addLog(`↔ 자리 바꾸기: ${a} ${from}→${to}${z ? `, ${z} ${to}→${from}` : ''}`, 'prepl');
  ui.sel = null; render();
}

const root = $('app');
root.addEventListener('click', e => {
  const actEl = e.target.closest('[data-act]');
  if (actEl) { if (!actEl.disabled) act(actEl.dataset.act, actEl); return; }
  if (e.target.id === 'modal' && ui.modal && ui.modal !== 'intro') { ui.modal = null; render(); return; }
  if (ui.playing) return;
  const s = game.state;
  const cand = e.target.closest('[data-cand]');
  if (cand && s.phase === 'prep') {
    const slot = +cand.dataset.cand;
    ui.sel = ui.sel?.type === 'cand' && ui.sel.slot === slot ? null : { type: 'cand', slot };
    if (ui.sel && s.buildsLeft <= 0) { ui.sel = null; toast('이번 정비의 건설 2채를 다 썼다'); }
    return render();
  }
  const tile = e.target.closest('[data-tile]');
  if (tile && game.canEditBoard()) {
    const i = +tile.dataset.tile;
    if (ui.sel?.type === 'cand') return tryBuild(ui.sel.slot, i);
    if (ui.sel?.type === 'tile') return ui.sel.i === i ? (ui.sel = null, render()) : tryMove(ui.sel.i, i);
    if (s.board[i] != null) { ui.sel = { type: 'tile', i }; render(); }
    return;
  }
  if (ui.sel) { ui.sel = null; render(); }
});
root.addEventListener('change', e => {
  const key = e.target.dataset?.set;
  if (!key) return;
  settings[key] = e.target.checked; store.set('settings', settings);
  game.state.options.dislike = settings.dislike;
  render();
});
root.addEventListener('keydown', e => { if (e.target.id === 'seed-in' && e.key === 'Enter') act('seedGo'); });

function hoverOf(target) {
  const t = target.closest?.('[data-tile]'); if (t) return { type: 'tile', i: +t.dataset.tile };
  const c = target.closest?.('[data-cand]'); if (c) return { type: 'cand', slot: +c.dataset.cand };
  const d = target.closest?.('[data-name]'); if (d) return { type: 'dwarf', name: d.dataset.name };
  return null;
}
root.addEventListener('mouseover', e => {
  const h = hoverOf(e.target);
  if (JSON.stringify(h) === JSON.stringify(ui.hover) || ui.drag) return;
  ui.hover = h; renderDetail(); applyHighlights();
});
root.addEventListener('mouseleave', () => { ui.hover = null; renderDetail(); applyHighlights(); });

// 끌어다 놓기: 후보 → 빈 칸(건설), 건물 → 다른 칸(자리 바꾸기)
root.addEventListener('dragstart', e => {
  if (ui.playing) return e.preventDefault();
  const c = e.target.closest?.('[data-cand]'), t = e.target.closest?.('[data-tile]');
  if (c && game.state.phase === 'prep' && game.state.buildsLeft > 0) ui.drag = { type: 'cand', slot: +c.dataset.cand };
  else if (t && game.canEditBoard() && game.state.board[+t.dataset.tile] != null) ui.drag = { type: 'tile', i: +t.dataset.tile };
  else return e.preventDefault();
  e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', 'x');
  ui.sel = ui.drag; applyHighlights();
});
const dropOk = i => ui.drag && (ui.drag.type === 'cand' ? game.state.board[i] == null : ui.drag.i !== i);
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

newGame(new URLSearchParams(location.search).get('seed') || undefined);
window.__yolo = { get game() { return game; }, ui, newGame };   // 콘솔에서 들여다보기용
