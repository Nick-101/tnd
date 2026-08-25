// 게임 상수 및 데이터 정의 (로직 없음 — game.js가 해석한다)

export const DICE_COUNT = 5;
export const FACE_COUNT = 6;
export const FACE_MIN = 1;
export const FACE_MAX = 9;
export const TURNS_PER_STAGE = 4;
export const ROLLS_PER_TURN = 3; // 턴 시작 자동 굴림 1회 포함
export const REWARD_SKILL_COUNT = 3;
export const REWARD_TICKET_COUNT = 2;

// 스테이지별 목표 점수
export const STAGE_TARGETS = [70, 100, 200, 240, 310, 400, 500, 620];

// 장착 조건: any | low(3 이하) | high(4 이상) | even | odd | exact(n)
// 효과: game.js의 applyEffect / applyTotalEffect가 type별로 해석
export const SKILLS = [
  { id: 'coin',      name: '잔돈 줍기',     cond: { kind: 'any' },          effect: { type: 'flat', v: 8 },          desc: '눈 +8' },
  { id: 'heavy',     name: '묵직한 한 방',  cond: { kind: 'high' },         effect: { type: 'flat', v: 15 },          desc: '눈 +15' },
  { id: 'grit',      name: '밑바닥 근성',   cond: { kind: 'low' },          effect: { type: 'flat', v: 18 },          desc: '눈 +18' },
  { id: 'evenx2',    name: '짝수 예찬',     cond: { kind: 'even' },         effect: { type: 'mult', v: 4 },          desc: '눈 ×4' },
  { id: 'oddx2',     name: '홀수 반란',     cond: { kind: 'odd' },          effect: { type: 'mult', v: 4 },          desc: '눈 ×4' },
  { id: 'trinity',   name: '삼위일체',      cond: { kind: 'exact', n: 3 },  effect: { type: 'mult', v: 6 },          desc: '눈 ×6' },
  { id: 'lotto',     name: '로또',          cond: { kind: 'exact', n: 6 },  effect: { type: 'mult', v: 6 },          desc: '눈 ×6' },
  { id: 'ant',       name: '개미 군단',     cond: { kind: 'exact', n: 1 },  effect: { type: 'flat', v: 35 },         desc: '눈 +35' },
  { id: 'twin',      name: '쌍둥이 자석',   cond: { kind: 'any' },          effect: { type: 'perMatchOther', v: 15 }, desc: '같은 눈인 다른 주사위 하나당 +15' },
  { id: 'evenally',  name: '짝수 동맹',     cond: { kind: 'even' },         effect: { type: 'perEvenAll', v: 12 },    desc: '짝수 눈 주사위 하나당 +12 (자신 포함)' },
  { id: 'oddally',   name: '홀수 동맹',     cond: { kind: 'odd' },          effect: { type: 'perOddAll', v: 12 },     desc: '홀수 눈 주사위 하나당 +12 (자신 포함)' },
  { id: 'freeride',  name: '어부지리',      cond: { kind: 'any' },          effect: { type: 'maxOtherX2' },            desc: '다른 주사위 중 가장 높은 눈 ×2 만큼 +' },
  { id: 'hyena',     name: '하이에나',      cond: { kind: 'low' },          effect: { type: 'minOtherX3' },          desc: '다른 주사위 중 가장 낮은 눈 ×3 만큼 +' },
  { id: 'blessing',  name: '합의 축복',     cond: { kind: 'any' },          effect: { type: 'sumAll' },          desc: '모든 주사위 눈의 합만큼 +' },
  { id: 'lonewolf',  name: '외로운 늑대',   cond: { kind: 'any' },          effect: { type: 'uniqueMult', v: 5 },    desc: '같은 눈이 하나도 없으면 눈 ×5' },
  { id: 'crowd',     name: '군중 심리',     cond: { kind: 'any' },          effect: { type: 'crowdMult', v: 8 },     desc: '같은 눈이 2개 이상 더 있으면 눈 ×8' },
  { id: 'ladder',    name: '계단 오르기',   cond: { kind: 'any' },          effect: { type: 'ladder', v: 25 },       desc: '내 눈보다 1 큰 눈의 주사위가 있으면 +25' },
  { id: 'pureeven',  name: '순혈 짝수',     cond: { kind: 'even' },         effect: { type: 'noOddMult', v: 5 },     desc: '홀수 눈 주사위가 없으면 눈 ×5' },
  { id: 'pureodd',   name: '순혈 홀수',     cond: { kind: 'odd' },          effect: { type: 'noEvenMult', v: 5 },    desc: '짝수 눈 주사위가 없으면 눈 ×5' },
  { id: 'juggler',   name: '저글러',        cond: { kind: 'any' },          effect: { type: 'perLocked', v: 12 },     desc: '턴 종료 시 잠긴 주사위 하나당 +12' },
  { id: 'gambler',   name: '도박사',        cond: { kind: 'any' },          effect: { type: 'noLockedMult', v: 4 },  desc: '잠긴 주사위가 없으면 눈 ×4' },
  { id: 'sixbros',   name: '육형제',        cond: { kind: 'any' },          effect: { type: 'perSix', v: 18 },        desc: '눈이 6인 주사위 하나당 +18 (자신 포함)' },
  { id: 'sniper',    name: '스나이퍼',      cond: { kind: 'exact', n: 5 },  effect: { type: 'mult', v: 8 },          desc: '눈 ×8' },
  { id: 'objection', name: '이의 있음',     cond: { kind: 'exact', n: 2 },  effect: { type: 'mult', v: 9 },          desc: '눈 ×9' },
  { id: 'shooter',   name: '사수',          cond: { kind: 'exact', n: 4 },  effect: { type: 'flat', v: 20 },          desc: '눈 +20' },
  { id: 'richer',    name: '부익부',        cond: { kind: 'high' },         effect: { type: 'perHigh', v: 10 },       desc: '눈 4 이상 주사위 하나당 +10 (자신 포함)' },
  { id: 'poorer',    name: '빈익빈',        cond: { kind: 'low' },          effect: { type: 'perLow', v: 10 },        desc: '눈 3 이하 주사위 하나당 +10 (자신 포함)' },
  { id: 'orchestra', name: '오케스트라',    cond: { kind: 'any' },          effect: { type: 'totalMultEven4', v: 2 },   desc: '짝수 눈이 4개 이상이면 총점 ×2' },
  { id: 'shaman',    name: '무당',          cond: { kind: 'any' },          effect: { type: 'totalMultOdd4', v: 2 },    desc: '홀수 눈이 4개 이상이면 총점 ×2' },
  { id: 'fivestar',  name: '파이브 스타',   cond: { kind: 'any' },          effect: { type: 'totalMultTriple', v: 3 },  desc: '같은 눈이 3개 이상이면 총점 ×3' },
  { id: 'finale',    name: '그랜드 피날레', cond: { kind: 'exact', n: 6 },  effect: { type: 'totalFlat', v: 60 },    desc: '총점 +60' },
  { id: 'bastion',   name: '최후의 보루',   cond: { kind: 'exact', n: 1 },  effect: { type: 'totalFlat', v: 50 },    desc: '총점 +50' },
  { id: 'hoarder',   name: '수집광',        cond: { kind: 'any' },          effect: { type: 'perEquipped', v: 3 },   desc: '주사위들에 장착된 스킬 하나당 +3' },
  { id: 'veteran',   name: '베테랑',        cond: { kind: 'any' },          effect: { type: 'perStage', v: 6 },      desc: '현재 스테이지 번호 ×6 만큼 +' },
  { id: 'snowball',  name: '눈덩이',        cond: { kind: 'any' },          effect: { type: 'fifthScore' },          desc: '현재 스테이지 점수의 1/5만큼 + (내림)' },
];

export const SKILLS_BY_ID = Object.fromEntries(SKILLS.map(s => [s.id, s]));

// 스킬 상세 설명 (도감·툴팁용) — 발동 조건, 계산 방식, 예시까지 풀어서 설명
export const SKILL_DETAILS = {
  coin: '이 스킬이 장착된 면이 나온 채로 턴을 종료하면, 이 주사위의 점수가 눈 +8이 된다. 예: 눈 5가 나오면 13점.',
  heavy: '4 이상의 면에만 장착할 수 있다. 이 면이 나오면 눈 +15. 예: 눈 6이면 21점.',
  grit: '3 이하의 면에만 장착할 수 있다. 이 면이 나오면 눈 +18. 낮은 눈을 고점으로 바꿔준다. 예: 눈 1이면 19점.',
  evenx2: '짝수 면 전용. 이 면이 나오면 눈 ×4. 예: 눈 6이면 24점, 숫자 변경권으로 8까지 키우면 32점.',
  oddx2: '홀수 면 전용. 이 면이 나오면 눈 ×4. 예: 눈 5면 20점, 9까지 키우면 36점.',
  trinity: '눈이 정확히 3인 면에만 장착할 수 있다. 이 면이 나오면 3×6 = 18점. 숫자 변경권으로 면이 3이 아니게 되면 스킬이 해제되어 인벤토리로 돌아간다.',
  lotto: '눈이 정확히 6인 면 전용. 이 면이 나오면 6×6 = 36점.',
  ant: '눈이 정확히 1인 면 전용. 이 면이 나오면 1+35 = 36점. 최저 눈을 최고 한 방으로 바꾼다.',
  twin: '이 면이 나왔을 때, 나와 같은 눈이 나온 다른 주사위 1개당 +15. 자신은 세지 않는다. 예: 내가 4이고 다른 주사위 2개도 4면 4+30 = 34점.',
  evenally: '짝수 면 전용. 턴 종료 시 짝수 눈이 나온 주사위 1개당 +12 (이 면 자신도 짝수이므로 최소 1개 포함). 예: 짝수가 4개면 눈+48.',
  oddally: '홀수 면 전용. 턴 종료 시 홀수 눈이 나온 주사위 1개당 +12 (자신 포함). 예: 홀수가 3개면 눈+36.',
  freeride: '이 면이 나오면, 자신을 제외한 주사위 중 가장 높은 눈의 2배를 더한다. 예: 다른 주사위 최고가 6이면 눈+12.',
  hyena: '3 이하 면 전용. 자신을 제외한 주사위 중 가장 낮은 눈의 3배를 더한다. 낮은 눈이 없을수록(최저가 높을수록) 강하다. 예: 최저가 5면 눈+15.',
  blessing: '이 면이 나오면, 다섯 주사위 눈의 총합(자신 포함)을 그대로 더한다. 예: 눈 합이 25면 눈+25. 눈이 클수록 함께 커진다.',
  lonewolf: '이 면이 나왔을 때, 나와 같은 눈이 나온 다른 주사위가 하나도 없으면 눈 ×5. 하나라도 있으면 발동하지 않는다.',
  crowd: '이 면이 나왔을 때, 나와 같은 눈이 나온 다른 주사위가 2개 이상이면(같은 눈 총 3개 이상) 눈 ×8. 잠금으로 같은 눈을 모아야 한다.',
  ladder: '이 면이 나왔을 때, 내 눈보다 정확히 1 큰 눈이 나온 주사위가 있으면 +25. 예: 내가 4이고 어딘가 5가 있으면 29점.',
  pureeven: '짝수 면 전용. 턴 종료 시 다섯 주사위가 전부 짝수면 눈 ×5. 하나라도 홀수면 발동하지 않는다.',
  pureodd: '홀수 면 전용. 턴 종료 시 다섯 주사위가 전부 홀수면 눈 ×5.',
  juggler: '이 면이 나오면, 턴 종료 시점에 잠겨 있는 주사위 1개당 +12 (자신이 잠겨 있어도 포함). 잠근 채 턴을 끝내는 플레이와 시너지.',
  gambler: '이 면이 나왔을 때, 턴 종료 시점에 잠긴 주사위가 하나도 없으면 눈 ×4. 잠금 없이 마지막 굴림을 그대로 받아들이는 도박. 저글러와 상극.',
  sixbros: '이 면이 나오면, 눈이 정확히 6인 주사위 1개당 +18 (자신이 6이면 포함). 7 이상은 세지 않으므로 6을 유지하는 것이 중요하다.',
  sniper: '눈이 정확히 5인 면 전용. 이 면이 나오면 5×8 = 40점.',
  objection: '눈이 정확히 2인 면 전용. 이 면이 나오면 2×9 = 18점.',
  shooter: '눈이 정확히 4인 면 전용. 이 면이 나오면 4+20 = 24점.',
  richer: '4 이상 면 전용. 턴 종료 시 눈 4 이상인 주사위 1개당 +10 (자신 포함). 높은 눈 위주로 잠글수록 강하다.',
  poorer: '3 이하 면 전용. 턴 종료 시 눈 3 이하인 주사위 1개당 +10 (자신 포함). 낮은 눈 판을 점수로 바꾼다.',
  hoarder: '이 면이 나오면, 다섯 주사위의 모든 면에 장착된 스킬 총 개수 ×3을 더한다 (자신 포함). 스킬이 쌓이는 후반일수록 강해진다.',
  veteran: '이 면이 나오면, 현재 스테이지 번호 ×6을 더한다. 스테이지 1에서는 +6, 스테이지 8에서는 +48.',
  snowball: '이 면이 나오면, 이번 스테이지에서 지금까지 쌓인 점수의 1/5(내림)을 더한다. 점수가 쌓인 뒤 턴일수록 강하다. 예: 누적 150점이면 눈+30.',
  orchestra: '이 면이 나온 턴에만 발동. 턴 종료 시 짝수 눈이 4개 이상이면, 개별 스킬 계산이 끝난 이번 턴 합계를 ×2 한다. 여러 장이 함께 발동하면 곱으로 쌓인다.',
  shaman: '이 면이 나온 턴에만 발동. 턴 종료 시 홀수 눈이 4개 이상이면 이번 턴 합계를 ×2 한다.',
  fivestar: '이 면이 나온 턴에만 발동. 턴 종료 시 같은 눈이 3개 이상이면 이번 턴 합계를 ×3 한다. 잠금으로 같은 눈을 모으는 빌드의 핵심.',
  finale: '눈이 정확히 6인 면 전용. 이 면이 나온 턴에, 개별 스킬 계산이 끝난 턴 합계에 +60 한다.',
  bastion: '눈이 정확히 1인 면 전용. 이 면이 나온 턴에, 턴 합계에 +50 한다.',
};


// 장착 조건 검사: 면의 숫자 value에 이 스킬을 둘 수 있는가
export function condAllows(cond, value) {
  switch (cond.kind) {
    case 'any': return true;
    case 'low': return value <= 3;
    case 'high': return value >= 4;
    case 'even': return value % 2 === 0;
    case 'odd': return value % 2 === 1;
    case 'exact': return value === cond.n;
    default: return false;
  }
}

export function condLabel(cond) {
  switch (cond.kind) {
    case 'any': return '모두';
    case 'low': return '3 이하';
    case 'high': return '4 이상';
    case 'even': return '짝수';
    case 'odd': return '홀수';
    case 'exact': return `${cond.n}만`;
    default: return '?';
  }
}
