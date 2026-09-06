// TnD 결합 데모 — 설정·데이터 (기획안 결합 v1). 로직은 tnd-game.js가 해석한다.
import { SKILLS, SKILL_DETAILS } from './config.js';

export const TND = {
  BOARD_SIZE: 32,
  START_CELL: 0,
  DICE: 5,
  ROLLS_PER_TURN: 3,          // 자동 굴림 1 + 재굴림 2
  GAUGE: 10,
  COMBO_MAX: 9,
  ENEMY_START_FAITH: 100,
  PLAYER_START_FAITH: 0,      // 기획안 미지정 → 0 (첫 정산으로 시작)
  ENEMY_DIE: [1, 1, 2, 2, 3, 3],
  ENEMY_ROLLS: 3,
  CORRUPT_COUNTER: 3,
  CORRUPT_PER_LAP: 'laps',    // 'laps' = 누진(바퀴 수만큼) | 1 = 원안(바퀴당 1개)
  DESTROY_MULT: 1.5,
  DECK_SIZE: 5,
  MAX_GRADE: 6,
  PURIFY_START: 1,
  PURIFY_STEP: 2,
  HOME_RANGE: 8,              // '귀향': 시작칸에서 8칸 이내
  REPEAT_CAP: 15,             // '반복' 최대 +15
};

// ── 스킬: 덱빌딩 v2 48종에서 '여유'(남은 턴 참조)를 제거하고, ★ 재정의 + ☆ 신규 9종 추가 → 57종
const REMOVED = new Set(['yeoyu']);
const OVERRIDE = {
  banbok: { desc: '이번 고행에서 발동한 횟수만큼 + (최대 +15)' },
  gagin: { desc: '+5로 시작, 내 말이 한 바퀴 돌 때마다 +5', kind: 'growStage' },
  chukjeok: { desc: '이 면 눈의 절반(올림)만큼 +' },
};
const NEW_SKILLS = [
  // 4.7 자원 참조 ★
  { id: 'shindo',    name: '신도',   grade: 'advanced', layer: 'opposite', cond: { kind: 'any' },  op: 'add', kind: 'perPiece', v: 3,    desc: '보드 위 내 기물 1개당 +3' },
  // 4.9 보드 참조 ☆
  { id: 'seongjeon', name: '성전',   grade: 'advanced', layer: 'active',   cond: { kind: 'any' },  op: 'add', kind: 'perPiece', v: 3,    desc: '보드 위 내 기물 1개당 +3' },
  { id: 'sungyo',    name: '순교',   grade: 'advanced', layer: 'latent',   cond: { kind: 'any' },  op: 'add', kind: 'perCorrupt', v: 2,  desc: '보드 위 타락 칸 1개당 +2' },
  { id: 'eungjing',  name: '응징',   grade: 'rare',     layer: 'active',   cond: { kind: 'high' }, op: 'mul', kind: 'perEnemyPieceMult', v: 1.15, desc: '보드 위 적 기물 1개당 ×1.15' },
  { id: 'gwihyang',  name: '귀향',   grade: 'advanced', layer: 'opposite', cond: { kind: 'any' },  op: 'add', kind: 'homeNear', v: 12,   desc: '내 말이 시작칸에서 8칸 이내면 +12' },
  // 4.10 이동 계층 ☆ — 이 주사위를 이동에 사용할 때 발동
  { id: 'heonnap',   name: '헌납',   grade: 'common',   layer: 'move', cond: { kind: 'any' },         op: 'move', kind: 'moveFaith', v: 1,   desc: '신앙 +1' },
  { id: 'sullye',    name: '순례',   grade: 'advanced', layer: 'move', cond: { kind: 'any' },         op: 'move', kind: 'moveDouble',        desc: '도착 칸의 내 기물 "플레이어가 밟을 시" 효과 2회' },
  { id: 'haenggun',  name: '행군',   grade: 'common',   layer: 'move', cond: { kind: 'high' },        op: 'move', kind: 'moveExtra', v: 1,   desc: '1칸 추가 이동 (밟음은 최종 칸)' },
  { id: 'seongsu',   name: '성수',   grade: 'common',   layer: 'move', cond: { kind: 'low' },         op: 'move', kind: 'moveHoly', v: 2,    desc: '도착 칸이 타락이면 카운터 +2' },
  { id: 'ganghaeng', name: '강행',   grade: 'rare',     layer: 'move', cond: { kind: 'exact', n: 6 }, op: 'move', kind: 'moveSkipPay',      desc: '도착 칸의 적 기물 강제지불 면제' },
];
export const TND_SKILLS = [
  ...SKILLS.filter(s => !REMOVED.has(s.id)).map(s => ({ ...s, ...(OVERRIDE[s.id] || {}) })),
  ...NEW_SKILLS,
];
export const TND_SKILLS_BY_ID = Object.fromEntries(TND_SKILLS.map(s => [s.id, s]));
export const TND_LAYER_LABEL = { active: '활성', opposite: '맞은편', side: '측면', latent: '잠재', move: '이동' };

export const TND_SKILL_DETAILS = {
  ...SKILL_DETAILS,
  chukjeok: '잠재형. 윗면이 아니면 이 면 눈의 절반(올림)만큼 더한다. 결합판은 모든 소수점을 올림 처리한다.',
  banbok: '잠재형 (성장). 윗면이 아니면 발동하며, 이번 고행에서 발동한 횟수(이번 발동 포함)만큼 더한다. 최대 +15. 고행 시작 시 초기화.',
  gagin: '맞은편형 (성장). 이 면이 바닥면이면 현재 값만큼 더한다. +5로 시작해 내 말이 시작칸을 지나 한 바퀴 돌 때마다 +5. 고행 시작 시 초기화.',
  seongjang: '활성형 (성장). 이 면이 윗면이면 현재 값만큼 더한다. +3으로 시작해 발동할 때마다 +2. 고행 시작 시 초기화.',
  yeonma: '활성형 곱셈 (성장). 눈 6 면 전용. 6이 윗면이면 현재 배수만큼 곱한다. ×1.5로 시작해 발동마다 +0.1. 고행 시작 시 초기화.',
  shindo: '맞은편형 (자원 참조). 이 면이 바닥면이면 보드 위 내 기물 1개당 +3. 기물이 늘수록 강해진다.',
  seongjeon: '활성형 (보드 참조). 이 면이 윗면이면 보드 위 내 기물 1개당 +3.',
  sungyo: '잠재형 (보드 참조). 윗면이 아니면 보드 위 타락 칸 1개당 +2. 타락이 퍼질수록 신앙치가 오르는 역전 장치.',
  eungjing: '활성형 곱셈 (보드 참조). 눈 4~6 면 전용. 이 면이 윗면이면 보드 위 사악한 기물 1개당 ×1.15 (곱으로 중첩: 3개면 ×1.52).',
  gwihyang: '맞은편형 (보드 참조). 이 면이 바닥면이고 내 말이 시작칸(0)에서 시계·반시계 어느 쪽으로든 8칸 이내에 있으면 +12.',
  heonnap: '이동 계층: 이 주사위를 이동에 사용할 때만 발동. 신앙 +1.',
  sullye: '이동 계층. 이 주사위로 이동해 도착한 칸에 내 기물이 있으면 "플레이어가 밟을 시" 효과를 2회 발동한다 (제단이면 신앙 +2, 회당이면 +6G 등).',
  haenggun: '이동 계층. 눈 4~6 면 전용. 이 주사위로 이동할 때 1칸을 더 간다. 밟음 판정은 최종 칸에서만 일어난다.',
  seongsu: '이동 계층. 눈 1~3 면 전용. 이 주사위로 이동해 도착한 칸이 타락이면 그 타락 카운터 +2 (만료를 늦춘다).',
  ganghaeng: '이동 계층. 눈 6 면 전용. 이 주사위로 이동해 도착한 칸에 사악한 기물이 있어도 이번 이동에 한해 강제지불을 면제한다.',
};

// ── 기물 14종. 효과 로직은 tnd-game.js의 pieceOnPlayerStep / pieceOnEnemyStep
export const PIECES = [
  { id: 'well',      name: '우물',   cost: 2, role: '경제', p: '게이지 +2G칸 (10 초과분 버림)', e: '적 신앙 −G' },
  { id: 'grave',     name: '묘지',   cost: 2, role: '방어', p: '—', e: '적 신앙 −(1+N). 타락해도 무효화되지 않음' },
  { id: 'altar',     name: '제단',   cost: 3, role: '통행세', p: '신앙 +1', e: '적 신앙 −(2G+N)' },
  { id: 'beacon',    name: '봉화',   cost: 3, role: '방어', p: '좌우 G칸 이내 타락 카운터 +2', e: '적 신앙 −G' },
  { id: 'purifier',  name: '정화소', cost: 3, role: '방어', p: '정화 비용을 1로 초기화', e: '적 신앙 −G' },
  { id: 'road',      name: '순례길', cost: 3, role: '기동', p: '추가로 G칸 이동 후 밟음 판정', e: '적 신앙 −G' },
  { id: 'hall',      name: '회당',   cost: 4, role: '경제', p: '다음 정산의 누산기 시작값 +3G', e: '적 신앙 −(G+N)' },
  { id: 'reliquary', name: '성물함', cost: 4, role: '경제', p: '다음 턴 재굴림 +1 (G≥4면 +2)', e: '적 신앙 −(G+N)' },
  { id: 'bell',      name: '종탑',   cost: 4, role: '제어', p: '—', e: '적 신앙 −G, 적 말을 G칸 뒤로' },
  { id: 'offering',  name: '헌금함', cost: 4, role: '변환', p: '—', e: '플레이어가 최대 3G 신앙을 지불하면(선택) 적 신앙을 그 2배 차감' },
  { id: 'sanctum',   name: '성소',   cost: 5, role: '통행세', p: '—', e: '적 신앙 −(3G+N)' },
  { id: 'gate',      name: '성문',   cost: 5, role: '제어', p: '—', e: '적 신앙 −G, 적의 이번 턴 남은 굴림 취소' },
  { id: 'taxman',    name: '세리',   cost: 6, role: '통행세', p: '—', e: '적 신앙 −(G×N)' },
  { id: 'spire',     name: '첨탑',   cost: 8, role: '통행세', p: '—', e: '적 신앙 −(G²+N)' },
];
export const PIECES_BY_ID = Object.fromEntries(PIECES.map(p => [p.id, p]));

// 권장 입문 빌드 / 입문 덱 (기획안 §5, §10) — 정비 화면 초기 프리셋
export const STARTER_BUILD = { 0: { 5: 'jungta', 0: 'janhyang' }, 1: { 5: 'gangta', 1: 'yeoun' }, 2: { 2: 'gyeotnal', 0: 'miyeol' } };
export const STARTER_DECK = ['altar', 'altar', 'sanctum', 'well', 'purifier'];

export const ceil = n => Math.ceil(n - 1e-9);
export const upgradeCost = def => ceil(def.cost / 2);
export const sellPrice = (def, g) => ceil(def.cost * g / 2);
export const enemyPieceCost = (g, m) => 2 * g + g * m;
