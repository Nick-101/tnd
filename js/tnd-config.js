// TnD 결합 데모 — 설정·데이터 (기획안 결합 v2.1). 로직은 tnd-game.js가 해석한다.
import { SKILLS, SKILL_DETAILS } from './config.js';

export const TND = {
  BOARD_SIZE: 32, START_CELL: 0,
  DICE: 3,                    // v2: 주사위 3개
  ROLLS_PER_TURN: 3,          // 자동 굴림 1 + 재굴림 2
  GAUGE: 10, COMBO_MAX: 9,
  PLAYER_START_FAITH: 0,
  CORRUPT_COUNTER: 3,
  DESTROY_MULT: 1.5,
  DECK_SIZE: 5, MAX_GRADE: 6,
  PURIFY_START: 1, PURIFY_STEP: 2,
  STOP_DISCOUNT: 0.5,         // 이번 턴 멈춘 칸의 업그레이드 = (비용÷2)×0.5 = 비용÷4
  REPEAT_CAP: 15,
  MONSTER: 'pilgrim',
};

export const ceil = n => Math.ceil(n - 1e-9);
export const upgradeCost = (def, stopped) => ceil(def.cost / 2 * (stopped ? TND.STOP_DISCOUNT : 1));
export const sellPrice = (def, g) => ceil(def.cost * g / 2);
export const enemyPieceCost = (g, m) => 2 * g + g * m;

// ── 몬스터 (데이터 정의 — 교체하면 다른 패턴·기믹이 코드 수정 없이 동작)
// 행동: move n · corrupt k · summon k · empower · heal n · wait
export const MONSTERS = {
  pilgrim: {
    id: 'pilgrim', name: '순례자', faith: 250, moveMode: 'basic',
    pattern: [{ t: 'move', n: 6 }, { t: 'move', n: 5 }, { t: 'corrupt', k: 1 }, { t: 'move', n: 7 }, { t: 'move', n: 6 }, { t: 'summon', k: 1 }],
    gimmicks: [{ t: 'flyover', from: 1, to: 8, landAt: 9 }], // 시작칸을 지나면 즉시 9번 칸으로 — 1~8은 밟지 않는다
    assault: [5, 10, 20, 40, 80, 160],
  },
};
export function actionLabel(a) {
  return a.t === 'move' ? `이동 ${a.n}` : a.t === 'corrupt' ? `타락 ${a.k}` : a.t === 'summon' ? `소환 ${a.k}`
    : a.t === 'empower' ? '강화' : a.t === 'heal' ? `회복 ${a.n}` : '대기';
}

// ── 각인 18종 (주사위당 1, 중복 불가). kind: move | roll | settle | board
export const ENGRAVINGS = [
  { id: 'doyak',   name: '도약',   kind: 'move',   moveMode: 'teleport', desc: '순간이동으로 이동 (경유 없음)' },
  { id: 'biyak',   name: '비약',   kind: 'move',   moveMode: 'jump',     desc: '점프(2)로 이동 (2칸마다 밟음)' },
  { id: 'sullye',  name: '순례',   kind: 'move',   moveMode: 'slow',     desc: '서행으로 이동 (경유 칸마다 밟음+멈춤)' },
  { id: 'eunsin',  name: '은신',   kind: 'move',   moveMode: 'stealth',  desc: '은밀 이동 (아무것도 발동하지 않음)' },
  { id: 'hwalbo',  name: '활보',   kind: 'move',   moveMode: 'basic', extra: 1, desc: '기본 이동, 거리 +1' },
  { id: 'jaedo',   name: '재도',   kind: 'roll',   desc: '두 번 굴려 높은 쪽을 취한다' },
  { id: 'innae',   name: '인내',   kind: 'roll',   desc: '잠긴 채로 턴을 넘기면 눈 +1 (최대 6, 굴리면 원래대로)' },
  { id: 'bulgul',  name: '불굴',   kind: 'roll',   desc: '1이 나오면 한 번 더 굴린다' },
  { id: 'gyunhyeong', name: '균형', kind: 'roll',  desc: '재굴림 시 직전과 다른 눈만 나온다' },
  { id: 'gongheo', name: '공허',   kind: 'settle', desc: '이 주사위의 잠재면 스킬 효과 2배 (+는 2배, ×는 제곱)' },
  { id: 'jongjang', name: '종장',  kind: 'settle', desc: '항상 마지막에 계산된다' },
  { id: 'seojang', name: '서장',   kind: 'settle', desc: '항상 처음에 계산된다' },
  { id: 'jjakheart', name: '짝의 심장', kind: 'settle', desc: '눈이 짝수면 이 주사위 계산 후 누산기 ×1.2' },
  { id: 'heonsin', name: '헌신',   kind: 'settle', desc: '활성면에 스킬이 없으면 눈을 3배로 취급' },
  { id: 'chukbok', name: '축복',   kind: 'board',  desc: '이 주사위로 이동 시 밟은 내 기물을 등급 +1로 취급' },
  { id: 'jeonghwabal', name: '정화의 발걸음', kind: 'board', desc: '이 주사위로 멈춘 칸의 타락 카운터 +2' },
  { id: 'gaecheok', name: '개척',  kind: 'board',  desc: '이 주사위로 멈춘 빈 칸의 건설 비용 −30%' },
  { id: 'jingsu',  name: '징수',   kind: 'board',  desc: '이 주사위로 멈춘 적 기물의 강제지불 절반' },
];
export const ENGRAVINGS_BY_ID = Object.fromEntries(ENGRAVINGS.map(e => [e.id, e]));
export const ENGRAVING_KIND_LABEL = { move: '이동', roll: '굴림', settle: '정산', board: '보드' };
export const MOVE_MODE_LABEL = { basic: '기본', teleport: '순간이동', jump: '점프(2)', slow: '서행', stealth: '은밀' };
export const ENGRAVING_DETAILS = {
  doyak: '이동형. 이 주사위로 이동하면 경유 칸을 밟지 않고 도착 칸만 밟음+멈춤 처리한다. 적 기물 밀집 구간을 건너뛰어 원하는 칸에 착지하는 용도.',
  biyak: '이동형. 2칸마다 한 번씩 밟고, 도착 칸은 밟음+멈춤. 경로의 절반만 발동시킨다.',
  sullye: '이동형. 경유하는 모든 칸에서 밟음과 멈춤을 처리한다 — 내 기물의 멈춤 효과를 줄줄이 터뜨리지만, 경로의 적 기물마다 강제지불하고 타락마다 정화 창이 뜬다.',
  eunsin: '이동형. 경유·도착 어디서도 아무 효과도 발동하지 않는 순수 재배치. 마지막 구간에 쓰면 최종 칸의 멈춤 자체가 사라진다.',
  hwalbo: '이동형. 기본 이동이지만 이 주사위의 거리가 항상 +1. 최종 도착 칸을 한 칸 밀어내는 유일한 각인.',
  jaedo: '굴림형. 이 주사위는 굴릴 때마다 두 번 굴려 더 높은 눈을 취한다 (재굴림 포함).',
  innae: '굴림형. 잠근 채로 턴을 넘기면 다음 턴에도 잠긴 상태로 유지되며 눈 +1 (최대 6). 굴리면 보너스가 사라진다.',
  bulgul: '굴림형. 굴려서 1이 나오면 한 번 더 굴린다 (두 번째 결과를 그대로 취한다).',
  gyunhyeong: '굴림형. 재굴림하면 직전 윗면과 다른 면만 나온다 (턴 시작 굴림에는 적용 안 됨).',
  gongheo: '정산형. 이 주사위의 잠재면(윗면이 아닌 면) 스킬 효과를 2배로 — 덧셈은 2배, 곱셈은 제곱. 잠재 곱셈 빌드의 엔진.',
  jongjang: '정산형. 계산 순서와 무관하게 이 주사위를 항상 마지막에 계산한다. 곱셈 스킬을 몰아둘 자리.',
  seojang: '정산형. 이 주사위를 항상 처음에 계산한다. 덧셈·도화선(누산 30 미만) 스킬용.',
  jjakheart: '정산형. 이 주사위의 눈이 짝수면, 이 주사위의 면 스킬을 모두 적용한 뒤 누산기를 ×1.2 한다.',
  heonsin: '정산형. 활성면(윗면)에 스킬이 없으면 이 주사위의 눈을 3배로 취급해 기본 눈합에 넣는다. 눈 6이면 18.',
  chukbok: '보드형. 이 주사위로 이동하는 동안 밟거나 멈춘 내 기물을 등급 +1로 취급한다 (최대 6).',
  jeonghwabal: '보드형. 이 주사위로 멈춘 칸이 타락이면 카운터 +2 (정화 창은 그대로 뜬다).',
  gaecheok: '보드형. 이 주사위로 멈춘 빈 칸에 건설할 때 비용 −30% (올림).',
  jingsu: '보드형. 이 주사위로 멈춘 칸의 사악한 기물 강제지불이 절반(올림)이 된다.',
};

// ── 면 스킬 52종: v1 57종에서 이동 계층 5종 제외, 귀향·각인의 기억 재정의
const REMOVED = new Set(['yeoyu']);
const OVERRIDE = {
  banbok: { desc: '이번 고행에서 발동한 횟수만큼 + (최대 +15)' },
  gagin: { name: '각인의 기억', desc: '+5로 시작, 내 말이 한 바퀴 돌 때마다 +3', kind: 'growStage', step: 3 },
  chukjeok: { desc: '이 면 눈의 절반(올림)만큼 +' },
  yeonswae: { desc: '활성 눈 3개가 연속이면 +18' },
  sangae: { desc: '활성 눈 3개가 서로 다르면 ×1.8' },
  samjung: { desc: '활성 눈 3개가 모두 같으면 ×2.2' },
};
const NEW_SKILLS = [
  { id: 'shindo',    name: '신도', grade: 'advanced', layer: 'opposite', cond: { kind: 'any' },  op: 'add', kind: 'perPiece', v: 3, desc: '보드 위 내 기물 1개당 +3' },
  { id: 'seongjeon', name: '성전', grade: 'advanced', layer: 'active',   cond: { kind: 'any' },  op: 'add', kind: 'perPiece', v: 3, desc: '보드 위 내 기물 1개당 +3' },
  { id: 'sungyo',    name: '순교', grade: 'advanced', layer: 'latent',   cond: { kind: 'any' },  op: 'add', kind: 'perCorrupt', v: 2, desc: '보드 위 타락 칸 1개당 +2' },
  { id: 'eungjing',  name: '응징', grade: 'rare',     layer: 'active',   cond: { kind: 'high' }, op: 'mul', kind: 'perEnemyPieceMult', v: 1.15, desc: '보드 위 사악한 기물 1개당 ×1.15' },
  { id: 'gwihyang',  name: '귀향', grade: 'advanced', layer: 'opposite', cond: { kind: 'any' },  op: 'add', kind: 'safeZone', v: 12, desc: '내 말이 안전지대(1~8)에 있으면 +12' },
];
export const TND_SKILLS = [
  ...SKILLS.filter(s => !REMOVED.has(s.id)).map(s => ({ ...s, ...(OVERRIDE[s.id] || {}) })),
  ...NEW_SKILLS,
];
export const TND_SKILLS_BY_ID = Object.fromEntries(TND_SKILLS.map(s => [s.id, s]));
export const TND_LAYER_LABEL = { active: '활성', opposite: '맞은편', side: '측면', latent: '잠재' };
export const TND_SKILL_DETAILS = {
  ...SKILL_DETAILS,
  chukjeok: '잠재형. 윗면이 아니면 이 면 눈의 절반(올림)만큼 더한다. 결합판은 모든 소수점을 올림 처리한다.',
  banbok: '잠재형 (성장). 윗면이 아니면 발동하며, 이번 고행에서 발동한 횟수(이번 발동 포함)만큼 더한다. 최대 +15. 고행 시작 시 초기화.',
  gagin: '맞은편형 (성장). 이 면이 바닥면이면 현재 값만큼 더한다. +5로 시작해 내 말이 시작칸을 지나 한 바퀴 돌 때마다 +3 (턴당 약 10칸 이동하므로 3턴에 한 바퀴). 고행 시작 시 초기화.',
  seongjang: '활성형 (성장). 이 면이 윗면이면 현재 값만큼 더한다. +3으로 시작해 발동할 때마다 +2. 고행 시작 시 초기화.',
  yeonma: '활성형 곱셈 (성장). 눈 6 면 전용. 6이 윗면이면 현재 배수만큼 곱한다. ×1.5로 시작해 발동마다 +0.1. 고행 시작 시 초기화.',
  yeonswae: '활성형 (집합 참조). 주사위가 3개이므로 활성 눈 3개가 연속(예: 2·3·4)이면 +18.',
  sangae: '활성형 곱셈 (집합 참조). 활성 눈 3개가 서로 다르면 ×1.8.',
  samjung: '활성형 곱셈 (집합 참조). 활성 눈 3개가 모두 같으면 ×2.2. 잠금으로 같은 눈을 모아야 한다.',
  shindo: '맞은편형 (자원 참조). 이 면이 바닥면이면 보드 위 내 기물 1개당 +3.',
  seongjeon: '활성형 (보드 참조). 이 면이 윗면이면 보드 위 내 기물 1개당 +3.',
  sungyo: '잠재형 (보드 참조). 윗면이 아니면 보드 위 타락 칸 1개당 +2.',
  eungjing: '활성형 곱셈 (보드 참조). 눈 4~6 면 전용. 이 면이 윗면이면 보드 위 사악한 기물 1개당 ×1.15 (곱으로 중첩).',
  gwihyang: '맞은편형 (보드 참조). 이 면이 바닥면이고 내 말이 안전지대(1~8, 순례자가 밟지 않는 비행 구간)에 있으면 +12.',
};

// ── 기물 20종. 훅: myPass(내밟) myStop(내멈) foePass(적밟) foeStop(적멈) aura. 효과 로직은 tnd-game.js
export const TIER_LABEL = ['', 'I', 'II', 'III', 'IV', 'V'];
export const PIECES = [
  { id: 'stake',     name: '말뚝',   tier: 1, cost: 2,    hooks: ['foePass'],                 desc: '적밟: −G' },
  { id: 'altar',     name: '제단',   tier: 1, cost: 3,    hooks: ['foePass', 'foeStop', 'myStop'], desc: '적밟: −G · 적멈: −3G · 내멈: 신앙 +1' },
  { id: 'well',      name: '우물',   tier: 1, cost: 3,    hooks: ['myPass', 'myStop'],        desc: '내밟: 게이지 +G · 내멈: 게이지 +3G' },
  { id: 'signpost',  name: '이정표', tier: 1, cost: 4,    hooks: ['myPass'],                  desc: '내밟: 이번 이동 거리 +1 (이동당 1회)' },
  { id: 'grave',     name: '묘지',   tier: 1, cost: 5,    hooks: ['foePass'],                 desc: '적밟: −G · 타락해도 효과 유지' },
  { id: 'sanctum',   name: '성소',   tier: 2, cost: 10,   hooks: ['foePass', 'foeStop'],      desc: '적밟: −2G · 적멈: −6G' },
  { id: 'purifier',  name: '정화소', tier: 2, cost: 12,   hooks: ['myStop'],                  desc: '내멈: 정화 비용 1로 초기화, 좌우 G칸의 타락 제거' },
  { id: 'bell',      name: '종탑',   tier: 2, cost: 12,   hooks: ['foeStop'],                 desc: '적멈: 적을 2G칸 뒤로 (되돌아간 칸은 밟지 않음)' },
  { id: 'hall',      name: '회당',   tier: 2, cost: 15,   hooks: ['myStop', 'foePass'],       desc: '내멈: 다음 정산 누산기 +5G · 적밟: −G' },
  { id: 'beacon',    name: '봉화',   tier: 2, cost: 15,   hooks: ['myPass', 'foePass'],       desc: '내밟: 좌우 G칸 타락 카운터 +1 · 적밟: −2G' },
  { id: 'taxman',    name: '세리',   tier: 2, cost: 20,   hooks: ['foePass'],                 desc: '적밟: −(G×N)' },
  { id: 'reliquary', name: '성물함', tier: 3, cost: 50,   hooks: ['myStop', 'foePass'],       desc: '내멈: 다음 턴 재굴림 +G · 적밟: −2G' },
  { id: 'spire',     name: '첨탑',   tier: 3, cost: 60,   hooks: ['foePass', 'foeStop'],      desc: '적밟: −G² · 적멈: −3G²' },
  { id: 'road',      name: '순례길', tier: 3, cost: 70,   hooks: ['myStop', 'foePass'],       desc: '내멈: 즉시 G칸 추가 이동 (기본, 연쇄) · 적밟: −2G' },
  { id: 'gate',      name: '성문',   tier: 3, cost: 80,   hooks: ['foeStop', 'foePass'],      desc: '적멈: 적의 다음 패턴 행동을 건너뜀 · 적밟: −2G' },
  { id: 'court',     name: '심판소', tier: 4, cost: 350,  hooks: ['foeStop'],                 desc: '적멈: 적 현재 신앙의 5G% 차감' },
  { id: 'cathedral', name: '대성당', tier: 4, cost: 400,  hooks: ['aura', 'foeStop'],         desc: '오라: 좌우 2칸 기물의 모든 효과 ×2 · 적멈: −10G' },
  { id: 'constellation', name: '성좌', tier: 4, cost: 500, hooks: ['aura', 'foePass'],        desc: '오라: 적이 밟는 모든 칸을 멈춤으로도 판정 · 적밟: −3G' },
  { id: 'temple',    name: '신전',   tier: 5, cost: 2000, hooks: ['aura', 'foePass'],         desc: '오라: 내 모든 기물 등급 +2 (최대 6) · 턴 시작 시 신앙 +10G · 적밟: −50' },
  { id: 'grail',     name: '성배',   tier: 5, cost: 3000, hooks: ['aura', 'foeStop'],         desc: '오라: 게이지 잔량이 항상 9 · 적멈: −100' },
];
export const PIECES_BY_ID = Object.fromEntries(PIECES.map(p => [p.id, p]));

// 권장 입문 빌드 / 입문 덱 (§13, §18) — 정비 초기 프리셋. 각인은 비워 둔다 (플레이어 선택)
export const STARTER_BUILD = { 0: { 5: 'jungta', 0: 'janhyang' }, 1: { 5: 'gangta', 1: 'yeoun' }, 2: { 2: 'gyeotnal', 0: 'miyeol' } };
export const STARTER_DECK = ['altar', 'altar', 'sanctum', 'well', 'spire'];
