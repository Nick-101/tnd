# TnD — 주사위 덱빌딩 × 모노폴리 디펜스 데모

타이틀에서 두 모드를 고른다.
- **고행 (결합 데모 v2.2)**: 주사위 3개에 각인(18종)과 면 스킬(52종)을 장착하고 기물덱 5장(11종: 기준선·경로 조작·경제)을 편성해, 마름모 32칸 보드에서 정산(신앙치→신앙)·3구간 이동(밟음/멈춤)·건설·밟은 기물 업그레이드로 타워 디펜스식 웨이브 12(마지막은 보스)를 막는다. 내 턴이 끝나면 몬스터가 한 바퀴를 쭉 돌고, 웨이브 프리뷰가 예상 피해와 처치/탈출 판정을 미리 보여준다.
- **스테이지 (주사위 덱빌딩 v2)**: 8스테이지 로그라이크. 4턴 안에 목표 점수 달성, 드래프트로 스킬 확장.

## 욜로드워프 데모 (별도 폴더)

`yolodwarf/` 폴더에 따로 들어 있다(이 브랜치는 시제품 1차). 실행·검증 방법은 [`yolodwarf/README.md`](yolodwarf/README.md).

## 실행

빌드 도구 없음. 로컬 서버로 열면 된다 (ES 모듈이라 `file://` 직접 열기는 브라우저에 따라 차단될 수 있음):

```bash
python3 -m http.server 8000
# → http://localhost:8000/index.html
# 재현 가능한 판: ?seed=123 · 타이틀 생략: ?mode=tnd 또는 ?mode=stage
```

## 구조

- `design/plan.md` — 스테이지 데모 기획서 / `design/plan-tnd.md` — 결합 데모 기획서
- `js/tnd-config.js` `js/tnd-game.js` `js/tnd-render.js` `js/tnd-art.js` — 결합 데모 (데이터 / 순수 로직 / DOM / 아이콘)
- `index.html` + `css/style.css` — 화면 (발라트로풍, 애니메이션 없음, 마우스 전용)
- `js/config.js` — 상수·스킬·스테이지 데이터
- `js/game.js` — 순수 게임 로직 (DOM 의존 없음 → headless 테스트 가능)
- `js/render.js` — DOM 렌더러 / `js/main.js` — 조립
- `test/sim.test.mjs`, `test/bot.mjs` — 스테이지 데모 검수 / `test/tnd.test.mjs`, `test/tnd-bot.mjs` — 결합 데모 검수
- `progress.txt` — 검수·수정 이력

## 테스트

```bash
node test/sim.test.mjs   # 스테이지 데모
node test/tnd.test.mjs   # 결합 데모
```

## 크레딧

- 아이콘: [game-icons.net](https://game-icons.net) — Lorc, Delapouite, [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/). `js/tnd-art.js`에 단색 path로 내장 (외부 요청 없음).
