# 공통 모듈 (public/common)

모든 종목이 같이 쓰는 난이도·옵션, 처음 하는 사람 연습(튜토리얼), 진동·번쩍임·손전등 모듈입니다.
프레임워크 없는 ES 모듈이고, 스타일은 모듈이 직접 넣습니다(클래스 이름 앞에 `pcgs-` `pcgp-` `pcgt-` `pcgb-` `pcgh-`).
페이지의 `p`, `button`, `h1` 같은 전역 규칙에 휘둘리지 않게 만들었습니다.

| 파일 | 쪽 | 하는 일 |
| --- | --- | --- |
| `settings.js` | 큰 화면 | 난이도·옵션 값 보관(종목별 localStorage), 대기실 알약 버튼·질문 카드, 키보드 `D`, 폰의 `settings` 처리, `forState()` |
| `phone-settings.js` | 폰 | `game_state.settings` 를 알약·질문 카드로 그림, `settings` 보내기, `isAnswered()`, 준비 버튼 막기 |
| `tutorial.js` | 폰 | 처음이면 3~5단계 연습. 단계마다 그림·한 줄 설명, 종목 감지기 신호로 ✓, 건너뛰기, "튜토리얼 다시 하기" |
| `tutorial-board.js` | 큰 화면 | 폰의 `tutorial` 을 받아 "2P 연습 중 2/4 · 휘둘러 보기" 칸을 띄움 |
| `haptics.js` | 폰 (+ 화면의 `sendHaptic`) | 진동, iPhone 대체(번쩍+틱+iOS 18 스위치 햅틱), 손전등(안드로이드), `d2c haptic` 듣기 |
| `ready.js` | 둘 다 | 모두 준비 띠(기존). 게임 스크립트보다 먼저 불러야 합니다 |

## 불러오기

모듈은 `import` 로 씁니다. 폰 컨트롤러가 지금처럼 일반 스크립트(IIFE)라면 둘 중 하나로 합니다.

1. `<script type="module" src="controller.js"></script>` 로 바꾸고 맨 위에 `import` 를 씁니다. 모듈은 strict 모드이고 문서를 다 읽은 뒤 실행됩니다. `ready.js` 는 그대로 그 앞에 일반 스크립트로 둡니다.
2. 일반 스크립트를 그대로 두고 `const { haptics } = await import('/common/haptics.js')` 처럼 async 함수 안에서 불러옵니다.

불러온 모듈은 시험용으로 `window.PCG.settings`, `PCG.phoneSettings`, `PCG.tutorials[key]`, `PCG.tutorialBoard`, `PCG.haptics` 에도 걸립니다.

## 오가는 이벤트

| 방향 | 이벤트 | 내용 |
| --- | --- | --- |
| 폰 → 화면 | `c2d settings` | `{ difficulty: 'easy' }` 처럼 바꾼 항목만. 서버가 `slot` 을 붙입니다 |
| 폰 → 화면 | `c2d tutorial` | `{ key, step, total, title, done, skipped? }`. `step` 은 1부터 |
| 화면 → 폰 | `game_state.settings` | `settings.forState()` 결과. 종목이 `game_state` 에 넣어 보냅니다 |
| 화면 → 폰 | `d2c msg {type:'pcg-settings', settings}` | `settings.attach()` 가 값이 바뀔 때·사람이 들어올 때 직접 보냅니다. 종목이 `game_state` 를 늦게 보내도 폰이 바로 맞춰집니다. 종목이 `msg` 를 따로 쓰면 이 `type` 은 무시하면 됩니다 |
| 화면 → 폰 | `d2c haptic` | `{ kind, strength, pattern?, color? }`. `slot` 을 주면 그 폰에만 |

`forState()` 모양: `{ v, sid, rev, locked, values, answered, last: { key, value, by, at }, fields: [...] }`.
폰은 같은 `sid`(화면 페이지) 안에서 `rev` 가 작아지는 상태를 버립니다. `game_state` 를 아주 자주(초당 여러 번) 보내는 종목은 `forState({ lite: true })` 로 `fields` 를 빼고 보내도 됩니다(폰이 마지막 `fields` 를 기억합니다).

## 큰 화면 예 (10줄)

```js
import { createSettings, fields } from '/common/settings.js';
import { createTutorialBoard } from '/common/tutorial-board.js';
import { sendHaptic } from '/common/haptics.js';
const settings = createSettings({ game: 'pingpong', fields: [fields.difficulty(), fields.slow()], onChange: () => pushState() });
settings.attach(socket); settings.mount($('settingsBox'));                  // 대기실 패널, 키보드 D·L
const board = createTutorialBoard(); board.attach(socket);                    // 연습 현황(화면 아래 가운데)
function pushState() { send('game_state', { phase: game.phase, players: statePlayers(), settings: settings.forState() }); }
function startGame() { if (!settings.requireAnswered()) return; settings.lock(true); board.hide(true); /* … */ }
const WINDOW = settings.pick({ easy: 0.30, normal: 0.20, hard: 0.12 });     // 난이도별 값
sendHaptic(socket, slot, 'hit', 0.8);                                         // 맞힌 폰을 진동
```

대기실로 돌아갈 때 `settings.lock(false)`, `board.hide(false)` 를 부릅니다.

## 폰 예 (10줄)

```js
import { haptics } from '/common/haptics.js';
import { createPhoneSettings } from '/common/phone-settings.js';
import { createTutorial } from '/common/tutorial.js';
const ps = createPhoneSettings(); ps.attach(socket); ps.mount($('setBox')); ps.bindReady($('btnGo'));
const tut = createTutorial({ key: 'pingpong', socket, steps: [
  { title: '포핸드', body: '오른쪽에서 앞으로 휘둘러요', svg: 'swing', waitFor: 'swing', check: (d) => d.hand === 'fore' || '반대쪽이에요' },
  { title: '백핸드', body: '손등 쪽으로 휘둘러요', svg: 'swing', svgOpts: { dir: -1 }, waitFor: 'swing', check: (d) => d.hand === 'back' || '반대쪽이에요' }] });
tut.link($('waitBox')); haptics.listen(socket, { slot: () => me && me.slot });
$('btnStart').onclick = async () => { haptics.unlock(); await calibrate(); if (tut.firstTime()) await tut.run(); showWait(); };
function onSwing(d) { haptics.hit(d.power); if (tut.signal('swing', d)) return; socket.emit('c2d', { event: 'swing', data: d }); }
```

## settings.js (큰 화면)

`createSettings(opts)`

- `opts.game` (필수): 저장 키 `pcg-settings-<game>`.
- `opts.fields`: 항목 목록. 없으면 난이도만.
- `opts.onChange(values, change)`: 값이 바뀔 때마다. `change = { key, value, by }`, `by` 는 자리 번호 또는 `'display'`. 여기서 `game_state` 를 다시 보내세요.
- `opts.keys = true`: 단축키(`hotkey`)를 켭니다. `e.code` 로 보므로 한글 자판에서도 됩니다. 잠겨 있으면 무시합니다. Shift 를 누르면 거꾸로 돕니다.
- `opts.persist = true`.

항목 만들기(`fields`):

| 함수 | 결과 |
| --- | --- |
| `fields.difficulty({ hints? })` | `difficulty`: `easy` 쉬움 / `normal` 보통(기본) / `hard` 어려움, 단축키 `D`. `hints: { easy: '타이밍 ±0.3초' }` 로 설명을 바꿉니다 |
| `fields.slow()` | `slow`: 처음엔 비어 있는 질문(`type:'ask'`). "슬로우 모드 켤까요? 치기 직전에 느려져서 타이밍 맞추기 쉬워요" [켜기][끄기], 단축키 `L` |
| `fields.toggle(key, label, { on, off, default, ask, hotkey })` | 켜기/끄기 두 칸. `ask: true` 면 slow 처럼 먼저 묻습니다 |
| `fields.choice(key, label, options, { default, hotkey, perPlayer })` | 여러 칸 중 하나. `options` 는 `['a','b']` 또는 `[{ value, label, hint }]` |

직접 만들 때 모양: `{ key, label, type: 'pills'|'ask', options: [{ value, label, short?, hint?, tone?, level?, said? }], default?, hotkey?, perPlayer?, ask?: { title, body } }`.
`perPlayer: true` 면 사람마다 값이 따로 있습니다(리듬의 입력 방식·각자 난이도 등). 폰은 자기 값만 바꾸고, 큰 화면에서 바꾸면 모두에게 적용됩니다.

메서드:

| 메서드 | 설명 |
| --- | --- |
| `attach(socket)` | `settings`·`players`·`room` 듣기, 바뀌면 `msg pcg-settings` 보내기. 반환: 끄는 함수 |
| `mount(el, { compact })` | 대기실 패널(질문 카드 + 알약 줄 + 잠금·변경 알림). 여러 번 붙여도 됩니다 |
| `get(key, slot?)`, `set(key, value, by?)`, `cycle(key, dir?)` | 값 읽기·바꾸기. 잠겨 있으면 `set` 은 false |
| `handle(data)` | 폰의 `settings` 를 직접 넘길 때(`attach` 를 안 쓰면) |
| `forState({ lite })` | `game_state.settings` 에 넣을 값 |
| `lock(bool)`, `isLocked()` | 경기 중 잠금. 폰 알약도 잠깁니다 |
| `isAnswered()`, `unanswered()`, `requireAnswered()` | 질문에 다 답했는지. `requireAnswered()` 는 아니면 질문 카드를 흔들고 false. 시작(Enter) 앞에 둡니다 |
| `pick({ easy, normal, hard }, slot?)`, `difficulty(slot?)` | 난이도별 값. `byDifficulty(level, table)` 도 내보냅니다 |
| `setPlayers(list)` | 각자 항목 칩용(보통은 `attach` 가 알아서) |
| `reset(key?)` | 기억한 값 지우기. 질문 항목은 다시 묻습니다 |
| `onChange(fn)`, `destroy()` | |

## phone-settings.js (폰)

`createPhoneSettings({ socket?, send?(event, data), slot?, onChange?, compact? })`

| 메서드 | 설명 |
| --- | --- |
| `attach(socket)` | `game_state`(`.settings`)·`msg`(`pcg-settings`)·`assigned` 듣기 |
| `update(state)` | `game_state` 를 직접 처리할 때 `ps.update(s.settings)` |
| `mount(el, { compact })` | 대기 화면 안에 그리기. 아직 설정을 못 받았으면 숨어 있습니다. 경기 화면에는 `compact` 로 한 번 더 붙여도 됩니다 |
| `bindReady(btn, { hint })` | 질문에 답할 때까지 준비 버튼을 흐리게 하고, 누르면 질문 카드를 흔들고 안내합니다(`disabled` 를 쓰지 않으므로 종목 코드가 버튼을 다시 그려도 됩니다). `hint: false` 면 안내 글 없음 |
| `isAnswered()`, `unanswered()` | 고른 직후(화면 확인 전)도 답한 것으로 봅니다 |
| `get(key)`, `values`, `pick(table)`, `difficulty()` | 내 자리 값(각자 항목은 내 값) |
| `choose(key, value)` | 코드에서 고르기 |
| `isLocked()`, `onChange(fn)`, `nudge()`, `destroy()` | |

누르면 바로 '보내는 중'으로 바뀌고, 큰 화면이 2.5초 안에 확인하지 않으면 원래 값으로 돌아갑니다.
다른 사람이 바꾸면 "2P가 난이도를 쉬움으로 바꿨어요" 가 잠깐 뜹니다.

## tutorial.js (폰)

`createTutorial(opts)`

- `key` (필수): 기억 키 `pcg-tut-<key>`. 오케스트라는 악기마다 `orchestra-drum` 처럼.
- `steps`: 3~5개 권장. 아래 모양.
- `socket` 또는 `send(event, data)`: 진행 상황 보내기. `socket` 을 주면 자리 배정(`assigned`)·큰 화면 새로고침(`display_status`) 때 지금 단계를 다시 보냅니다. `send` 만 주면 다시 연결된 뒤 `tut.resend()` 를 부르세요.
- `color`: 없으면 페이지의 `--c`(내 색)를 따라갑니다.
- `title`(맨 위 작은 글), `onStep(i, step)`, `onDone({ completed, skipped })`, `helpAfterMs = 9000`, `advanceMs = 1100`, `finish: { title, body, button }`.

단계 모양:

```js
{
  title: '휘둘러 보기',              // 큰 제목
  body: '폰을 앞으로 휙 휘둘러요.',   // 한 줄 설명
  svg: 'swing',                      // 그림 이름, SVG 문자열, 또는 함수
  svgOpts: { dir: -1 },
  waitFor: 'swing',                  // 기다릴 신호. 배열 가능. 'tap' 은 그림을 누르면 됨. 없으면 '다음' 버튼 단계
  check: (data) => true,             // true | false | '안내 글'(실패) | { ok, msg }
  count: 2,                          // 몇 번 해야 하는지
  hint: '두 번 휘둘러요',            // '해 보세요' 대신
  okText: '좋아요!',
  render: (stage, api) => cleanup,   // 단계 안에 종목 UI(피아노 건반, 패드 등)를 그릴 때. api.ok(msg) / api.fail(msg) / api.signal(name, data)
  next: '다음'
}
```

| 메서드 | 설명 |
| --- | --- |
| `firstTime()` | 이 폰에서 처음인지 |
| `run(el?, { inline })` | 전체 화면으로 띄웁니다. 반환 Promise `{ completed, skipped }`. 끝내거나 건너뛰면 기억합니다. 화면을 CSS 로 돌린 컨테이너(카트)를 `el` 로 주면 그 안에 맞춰 뜹니다 |
| `signal(name, data)` | 감지기에서 부릅니다. 지금 단계가 그 신호를 기다리면 판정하고 true(이때는 실제 게임 이벤트를 보내지 않아도 됩니다) |
| `ok(msg)`, `fail(msg)`, `simulate()`, `next()`, `skip()`, `cancel()` | 종목이 직접 판정·시험·닫기 |
| `link(el, { label, before })` | 대기 화면의 "튜토리얼 다시 하기" 링크. `setLinkVisible(false)` 로 경기 중 숨기기 |
| `isRunning()`, `current()`, `reset()`, `markDone()`, `setColor(c)`, `setSocket(s)`, `resend()` | |

맞으면 ✓ 와 함께 `haptics.success()`(진동, iPhone 은 번쩍+소리), 틀리면 화면이 흔들리고 안내 글이 뜹니다.
9초가 지나도 못 하면 "잘 안 되면 넘어가기" 가 나옵니다. 가로 화면에서는 그림 왼쪽, 글 오른쪽으로 바뀝니다.

그림 이름(`illustrations` 로도 내보냄): `hold`(=`still`,`grip`), `swing`(`{dir:-1}` 왼쪽, `{from,to}` 각도), `cast`, `tilt`(=`steer`), `tap`, `swipe`(=`bow`), `flick`(`{dir:'up'|'down'|'left'|'right'}`), `strike`(아래로 휙), `lift`(위로 휙), `twist`, `point`(=`aim`), `blow`, `conduct`(4/4 지휘), `check`.

## tutorial-board.js (큰 화면)

`createTutorialBoard({ mount?, position = 'bottom' | 'top', doneMs = 5000, title? })`

- `mount` 가 없으면 화면 아래 가운데에 떠 있습니다(`top` 은 준비 띠 아래). 대기실에 자리가 있으면 `mount` 로 그 안에 넣는 편이 깔끔합니다.
- `attach(socket)`: `tutorial`·`players`·`room` 듣기. 나간 사람 칸은 지우고, 끊긴 사람은 흐리게 합니다.
- `update(data)`, `setPlayers(list)`, `practicing()`(연습 중인 자리 번호들), `summary()`("2P·3P 연습 중"), `hide(bool)`, `clear()`, `destroy()`.
- 끝나면 "연습 끝 ✓" 를 5초, 건너뛰면 "연습 건너뜀" 을 3초 보이고 사라집니다. 2분 동안 소식이 없으면 지웁니다.

## haptics.js (폰)

`import { haptics, sendHaptic } from '/common/haptics.js'`

| 함수 | 진동(ms) | iPhone·PC 대체 |
| --- | --- | --- |
| `haptics.hit(strength 0~1)` | 12~50 | 내 색 번쩍(세기만큼) + 틱 |
| `haptics.shot()` | 24 + 총구 번쩍 + 손전등(켰으면) | 총구 번쩍 |
| `haptics.success()` | 28·50·60 | 초록 번쩍 + 두 음 |
| `haptics.fail()` | 110 | 빨강 번쩍 + 낮은 음 |
| `haptics.tick()` | 8 | 틱 소리만 |
| `haptics.play(kind, strength)` | `strong` `block` `clash` `perfect` `great` `good` `miss` `bite` `warn` 도 있음 | |
| `haptics.flash(color, { opacity, ms })` | 진동과 상관없이 화면 번쩍 | |
| `haptics.buzz(pattern)` | 무늬 그대로 | |

- `haptics.unlock()`: 시작 버튼 탭 안에서 한 번. 대체용 소리를 엽니다(안 불러도 첫 터치 때 엽니다).
- `haptics.listen(socket, { slot, dedupeMs = 220 })`: `d2c haptic` 받기. 폰이 방금 스스로 울린 같은 계열(`hit`·`judge`)은 220ms 안이면 한 번만 울립니다. 그래서 "폰이 스윙을 잡자마자 진동 + 화면이 판정한 뒤 확인 진동"을 둘 다 불러도 됩니다.
- `haptics.config({ mode, sound, flash, color, intensity })`, `haptics.mode`(`vibrate`|`ios`|`visual`|`off`), `haptics.onEvent(fn)`(디버그 줄에 쓰기 좋음).
- 아직 화면을 한 번도 안 누른 페이지에서는 브라우저가 진동을 막으므로 부르지 않고 번쩍임으로 대신합니다(콘솔 경고 없음).
- iOS 18+ 스위치 햅틱은 보이지 않는 `<label><input type=checkbox switch>` 를 눌러 시도합니다. 실제로 울리는지는 실폰에서만 알 수 있고, 실패해도 예외·화면 변화가 없습니다.

손전등 `haptics.torch`:

| 메서드 | 설명 |
| --- | --- |
| `supported()` | iOS·http·카메라 API 없음·이미 안 됐던 폰이면 false |
| `enable()` | 탭 안에서. 뒤 카메라를 열고 torch 가 되는지 확인. 되면 true(`pcg-torch` 에 기억) |
| `pulse(ms = 70)` | 켰다 끄기. `haptics.shot()` 이 알아서 부릅니다 |
| `off()`, `disable()`, `enabled` | |
| `mountToggle(el, { label, sub, onChange })` | 시작 화면 스위치 "총 쏠 때 손전등 번쩍 · 안드로이드". 안 되는 폰에서는 숨고, 눌렀는데 손전등이 없으면 "이 폰은 손전등을 켤 수 없어요" 를 보이고 숨습니다 |

화면이 꺼지거나 페이지를 떠나면 손전등을 끄고 카메라를 놓습니다. 돌아오면 다음 발에서 다시 잡습니다(권한은 이미 있음).

큰 화면에서는 `sendHaptic(socket, slot | null, kind, strength, extra?)` 만 씁니다. `null` 이면 모든 폰.

## 시험

| 주소 | 효과 |
| --- | --- |
| 큰 화면 `?difficulty=easy`, `?slow=on`, `?mode=speed` | 항목 값 덮어쓰기(저장 안 함) |
| 큰 화면 `?settings=reset` | 이 화면에 기억한 값 지우기(슬로우 질문이 다시 뜸) |
| 폰 `?tut=1` / `?tut=0` | 늘 튜토리얼 / 안 띄움 |
| 폰 `&debug` | 튜토리얼에 "시험: 성공 처리" 버튼 |
| 폰 `?haptics=ios` / `visual` / `vibrate` / `off` | 진동 방식 강제(iPhone 대체 화면을 PC 에서 보기) |
| 폰 `?torch=sim` | 손전등을 흉내(스위치가 보이고, 쏠 때 "손전등 번쩍" 표시) |

봇(`?bots=N`)은 설정을 보내지 않습니다. 큰 화면 키보드(`D`, `L`, 종목 단축키)나 `settings.set()` 으로 바꿉니다.

## 종목별로 챙길 것

- 테니스: 지금의 `L` 키·`tennis.slow` 기억·`?noslow` 는 `fields.slow()` 로 옮기고, 기존 `L` 처리기는 지웁니다(두 번 바뀜).
- 리듬: 경기 중 `D` 는 레인 키입니다. 설정은 경기 중 잠기므로 겹치지 않지만, 대기실에서도 `D` 를 레인 시험에 쓰려면 `fields.difficulty({ hotkey: null })` 로 끕니다. 각자 난이도는 `perPlayer: true`.
- 카트: 폰 화면을 CSS 로 돌리면 `tut.run(돌린컨테이너)` 로 띄웁니다. 아이템전/스피드전은 `fields.choice('items', '경기 방식', [...])`.
- 낚시: 대기실이 없으므로 `lock()` 을 쓰지 않습니다. 폰에서 언제든 바꿀 수 있습니다.
- `ready.js` 는 `/play` 로 시작하는 주소를 폰으로 봅니다. 새 폰 페이지도 `/play/<종목>/` 아래에 둡니다.
