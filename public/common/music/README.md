# 공용 음악 라이브러리

리듬 게임, 오케스트라, game-room 리듬 게임이 함께 쓰는 곡·악기·채보·CD 고르기 모듈입니다.
네 파일 모두 다른 파일을 불러오지 않는 ES 모듈이라 그대로 복사해 쓸 수 있습니다.

| 파일 | 하는 일 |
| --- | --- |
| `music/songs.js` | 퍼블릭 도메인 27곡의 악보 데이터(파트 6개)와 박↔초 변환 |
| `music/synth.js` | 녹음 샘플(VSCO 2 CE)과 WebAudio 합성 악기 14종, 박자 스케줄러(Transport), 미리듣기, 녹화용 믹스 |
| `music/charts.js` | 곡에서 리듬 게임 채보를 결정적으로 생성 |
| `../disc-picker.js` | CD 케이스 선반 모양의 곡 고르기 화면(끌기·튕기기·원격 조작) |

검사: `node .work/music-test.mjs` (곡 구조, 마디 박 수, 첫머리 선율 지문, 채보 간격·밀도·결정성).

## songs.js

```js
import { SONGS, getSong, beatToSec, secToBeat, bpmAt, chordAt, midiToFreq, midiToName, PART_NAMES, DRUM } from '/common/music/songs.js';
const s = getSong('ode-to-joy');
s.parts.melody   // [[박, 길이(박), midi, 세기 0~1], ...] 박 순서
```

- 박은 4분음표 = 1입니다. 6/8 곡도 4분음표 기준이라 한 마디가 3박입니다. `s.barLen`이 한 마디 박 수입니다.
- 곡 필드
  - `id`, `title`(한국어), `en`, `composer`, `composerEn`, `life`, `work`, `pd`(퍼블릭 도메인 근거)
  - `bpm`, `timeSig`, `key`, `genre`, `mood`, `cover: { hue, motif }`
  - `beats`, `lengthSec`, `tempos: [[박, bpm], ...]`(산왕의 궁전에서만 점점 빨라짐)
  - `sections: [{ name, beat, bars, beats, dyn }]`, `chordTrack: [{ beat, dur, name, root, ivs, bass }]`
  - `orch`(파트별 추천 악기), `ranges`(파트별 최저·최고 음), `previewBeat`
- 파트 `PART_NAMES = ['melody', 'harmony', 'bass', 'chords', 'drums', 'perc']`
  - `melody`: 한 줄 선율(겹치지 않음). 성악가·트럼펫·바이올린·피아노가 따라 할 파트입니다.
  - `harmony`: 둘째 성부. 화음에 맞춘 3·6도 아래 성부를 자동으로 붙입니다(선율이 낮으면 위). 캐논과 자크 형제는 선율을 늦춰 겹친 돌림노래입니다. 호른에 어울립니다.
  - `bass`, `chords`: 곡 양식(행진곡·왈츠·발라드·바로크…)에 맞춘 반주. `chords`는 같은 박에 여러 음이 있습니다.
  - `drums`: GM 번호(36 킥, 37 림, 38 스네어, 42/46 하이햇, 45/47/48 탐, 49 심벌).
  - `perc`: 85 캐스터네츠, 39 박수, 54 탬버린, 81 트라이앵글. 엇박·2/4박 위주라 캐스터네츠 파트로 씁니다.
- `beatToSec(song, beat)` / `secToBeat(song, sec)`: 빠르기 지도를 반영한 변환.
- `chordAt(song, beat)`: 그 박의 화음(음정 보정, 피아노 쉬움 모드에 씀).
- `BUILD_ERRORS`: 불러올 때 마디 박 수 검사 결과. 비어 있어야 정상입니다.

## synth.js

```js
import { createSynth, createTransport, playPreview, renderOffline, defaultOrch, INSTRUMENTS, INSTRUMENT_INFO } from '/common/music/synth.js';
const synth = createSynth();          // { ctx, destination, volume, reverb, silent } 선택
button.onclick = () => synth.resume(); // 반드시 탭·클릭 안에서 한 번

const vio = synth.instrument('violin', { gain: 1, pan: 0 });
vio.play(76, { when: synth.now(), dur: 0.5, vel: 0.8 });   // 길이를 아는 음
const v = vio.noteOn(76, { vel: 0.7 });                    // 누르는 동안 이어지는 음
v.setLevel(0.5);  v.setPitch(77, 0.03);  v.setBend(-20);  v.off();
synth.instrument('drums').play(38, { vel: 0.9 });          // 타악기는 GM 번호(또는 .hit('snare'))
```

- 악기 `INSTRUMENTS`: `piano`, `strings`, `violin`, `cello`, `trumpet`, `horn`, `flute`, `choir`, `bass`, `drums`, `castanets`, `glock`, `celesta`, `timpani`. `INSTRUMENT_INFO[이름]`에 한국어 이름·음역·지속음 여부가 있습니다.
  - 지속음 악기(현·관·합창·베이스)는 `setLevel`로 활 세기·숨 세기를 따라가게 할 수 있습니다. 금관은 세기에 따라 밝기도 바뀝니다.
  - `choir`는 'ah' 모음 포먼트입니다. 성악가 보정 음(목소리 크기로 `setLevel`, 보정한 음높이로 `setPitch`)에 쓰면 됩니다.
- 소리 길: 악기 → (패닝) → 버스 → 저역 정리·고역 다듬기 → 부드러운 컴프레서 → 리미터 → 스피커. 잔향은 패닝 앞에서 스테레오 홀 잔향(초기 반사 + 고역이 먼저 줄어드는 약 2.3초 꼬리)으로 보냅니다.
  - `inst.ready`: 녹음 샘플을 다 불러오면(실패하면 합성 음색으로 정해지면) 풀리는 약속입니다.
  - `synth.instrument(name, { recordOnly: true })`는 스피커로 나가지 않고 녹화 믹스에만 섞입니다(큰 화면이 폰 연주를 녹화에만 넣을 때).
  - `const unplug = synth.renderTo(mediaStreamDest)`: 스피커 길과 녹화 전용 길을 모두 그 노드로도 보냅니다.
- `createTransport(synth, { lookahead: 0.12, interval: 25 })`
  - `tr.load(song, { orch, parts, gains, mute, gain, recordOnly: { melody: true }, instruments: { melody: null } })`
    - `instruments`에 `null`을 주면 그 파트는 소리 없이 이벤트만 냅니다(플레이어가 맡은 파트).
  - `tr.start({ fromBeat, at })`, `tr.stop()`, `tr.unload()`
  - `tr.setRate(1.1)`: 지휘 빠르기 배율(0.5~2). 지금 박을 기준으로 이어 붙이므로 끊기지 않습니다.
  - `tr.beat`, `tr.bpm`, `tr.timeAt(beat)`, `tr.beatAt(audioTime)`, `tr.setMute(part)`, `tr.setGain(part, g)`
  - `tr.on('beat', ({ beat, time }) => {})`, `tr.on('note', ({ track, note, time, dur }) => {})`, `tr.on('end', fn)`. `time`은 오디오 시계라 판정·화면 동기에 그대로 씁니다.
  - 사람 손맛: 반주 소리에는 박 위치·4마디 프레이즈에 따른 세기, 화음 굴림, 레가토, 반주 파트(harmony·chords·bass)의 ±약 10ms 흔들림을 입힙니다(같은 곡이면 늘 같음). 판정에 쓰는 melody·drums·perc 는 시각을 건드리지 않고, `note` 이벤트의 `time`도 악보 그대로입니다.
  - 반주 악기는 오케스트라 자리(`SEAT`: 바이올린 왼쪽, 첼로·베이스 오른쪽, 금관 가운데 뒤)에 앉힙니다. 폰의 내 악기 소리는 가운데 그대로입니다.
- `const stop = playPreview(synth, song, { seconds: 12, fromBeat })`: 미리듣기(끝에서 부드럽게 줄임).
- `await renderOffline(song, { fromBeat, seconds, parts, orch, noSamples })`: 오프라인 렌더(AudioBuffer). 검사·내려받기용입니다. 녹음 샘플을 다 불러온 뒤 게임과 같은 손맛·자리로 렌더합니다(`noSamples: true`면 합성 대체 음색).

## charts.js

```js
import { genChart, chartInfo, CHART_LIMITS, LANE_NAMES } from '/common/music/charts.js';
const c = genChart(song, { difficulty: 'normal', lanes: 4, input: 'pad' });
c.notes  // [{ beat, t(초), lane, len(길게 누르기 박), lenSec, jump, src }]  시간 순서
c.count, c.taps, c.jumps, c.holds, c.nps, c.maxNps, c.stars
```

- 같은 곡·옵션이면 언제나 같은 채보입니다.
- 쉬움은 정박 4분음표 위주, 보통은 8분음표와 가끔 동시 누르기, 어려움은 16분음표·동시 누르기·길게 누르기입니다.
- 모션 입력은 동시 누르기가 없고 훨씬 성깁니다(쉬움 0.75초, 보통 0.5초, 어려움 0.36초 이상 간격). 길게 누르기는 어려움에서만 나옵니다.
- 간격·2초 밀도 한도는 `CHART_LIMITS[input][difficulty]`에 있습니다.
- 레인은 선율 윤곽을 따라갑니다. 음이 오르면 오른쪽, 내리면 왼쪽입니다. 4레인은 `← ↓ ↑ →`, 5레인은 `↙ ↖ ● ↗ ↘` 순서입니다.
- 선율이 오래 끄는 곳은 북 박자로 채웁니다(`src: 'drum'`).
- `chartInfo(song, difficulty, { lanes, input })` → `{ stars, count }`(캐시됨). CD 고르기 난이도 칩에 씁니다.

## disc-picker.js

```js
import { createDiscPicker } from '/common/disc-picker.js';
const picker = createDiscPicker(el, {
  songs: SONGS, difficulty: 'normal',
  chartInfo: (s, d) => chartInfo(s, d),
  preview: (s) => playPreview(synth, s, { seconds: 12 }),   // 멈추는 함수를 돌려줍니다
  onGesture: () => synth.resume(),                          // 첫 터치·클릭·키 입력 때
  onChange(song, i) {}, onSettle(song, i) {}, onSelect(song, diff, i) {}, onDifficulty(diff) {},
});
picker.nudge(1); picker.fling(-8); picker.select(); picker.setDifficulty('hard'); picker.cycleDifficulty(1);
picker.setDriver({ label: '2P', color: '#3ab4ff', text: '고르는 중' }); picker.setEnabled(false); picker.destroy();
```

- 입력: 마우스·터치·펜 끌기(관성과 자리 맞춤), 휠, `← →`(넘기기), `↑ ↓`(난이도), `Enter`/`Space`(선택). 옆 CD를 누르면 그 곡으로 가고, 가운데 CD를 누르면 선택입니다.
  - 키보드를 직접 처리하려면 `keyboard: false`를 줍니다.
- 원격(폰): `nudge(±1)`, `fling(초당 CD 수)`, `select()`, `setDifficulty(d)`, `goTo(i)`, `goToId(id)`.
- 가운데 CD가 멈추면 케이스에서 빠져나와 돌고, `previewDelay`(0.55초) 뒤 `preview`를 부릅니다.
  - 끌기 시작·선택·`setEnabled(false)` 때 미리듣기를 멈춥니다.
- 순서는 방문마다 섞이고(`seed` 옵션으로 고정 가능), 처음 가운데 CD는 직전 방문과 겹치지 않습니다(`localStorage['<storageKey>:first']`).
- 크기는 담는 요소에 맞춰 바뀝니다. 높이 340px 이상을 권합니다. 글꼴은 Pretendard가 있으면 쓰고, 없으면 시스템 글꼴을 씁니다.
- 읽기 전용: `picker.songs`(섞인 순서), `index`, `song`, `difficulty`, `position`, `seed`, `el`.
- `drawCover(song, size)`도 내보냅니다(결과 화면 등에 같은 표지를 쓸 때).

## 곡 목록과 퍼블릭 도메인 근거

모든 편곡은 원곡 선율을 바탕으로 이 프로젝트에서 직접 단순화해 적은 것입니다. 녹음이나 현대 편곡은 쓰지 않았습니다.

일부 곡은 잘 알려진 대목만 원곡대로 적었습니다. 나머지 대목은 같은 동기로 짧게 직접 이어 붙였습니다.

- 아이네 클라이네 나흐트무지크: 2단락
- 사계 중 봄: 새소리 대목
- 터키 행진곡: 둘째 끝맺음
- 아름답고 푸른 도나우: 끝 네 마디
- 짐노페디: 끝맺음

| # | 제목 | 영어 | 작곡 | 박자·조·BPM | 길이 | 근거 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 환희의 송가 | Ode to Joy | 베토벤 (Ludwig van Beethoven, 1770–1827) | 4/4 · D · 112 | 69초 | 작곡가 1827년 사망, 사후 70년이 지나 저작권이 끝난 퍼블릭 도메인 |
| 2 | 캐논 | Canon in D | 파헬벨 (Johann Pachelbel, 1653–1706) | 4/4 · D · 76 | 79초 | 작곡가 1706년 사망, 사후 70년이 지나 저작권이 끝난 퍼블릭 도메인 |
| 3 | 아이네 클라이네 나흐트무지크 | Eine kleine Nachtmusik | 모차르트 (Wolfgang Amadeus Mozart, 1756–1791) | 4/4 · G · 126 | 61초 | 작곡가 1791년 사망, 사후 70년이 지나 저작권이 끝난 퍼블릭 도메인 |
| 4 | 엘리제를 위하여 | Für Elise | 베토벤 (Ludwig van Beethoven, 1770–1827) | 3/4 · Am · 126 | 70초 | 작곡가 1827년 사망, 사후 70년이 지나 저작권이 끝난 퍼블릭 도메인 |
| 5 | 터키 행진곡 | Rondo alla Turca | 모차르트 (Wolfgang Amadeus Mozart, 1756–1791) | 2/4 · Am · 120 | 65초 | 작곡가 1791년 사망, 사후 70년이 지나 저작권이 끝난 퍼블릭 도메인 |
| 6 | 아름답고 푸른 도나우 | The Blue Danube | 요한 슈트라우스 2세 (Johann Strauss II, 1825–1899) | 3/4 · D · 168 | 69초 | 작곡가 1899년 사망, 사후 70년이 지나 저작권이 끝난 퍼블릭 도메인 |
| 7 | 산왕의 궁전에서 | In the Hall of the Mountain King | 그리그 (Edvard Grieg, 1843–1907) | 4/4 · Bm · 100 | 78초 | 작곡가 1907년 사망, 사후 70년이 지나 저작권이 끝난 퍼블릭 도메인 |
| 8 | 사계 중 봄 | Spring (The Four Seasons) | 비발디 (Antonio Vivaldi, 1678–1741) | 4/4 · E · 92 | 63초 | 작곡가 1741년 사망, 사후 70년이 지나 저작권이 끝난 퍼블릭 도메인 |
| 9 | 캉캉 | Can-can (Galop infernal) | 오펜바흐 (Jacques Offenbach, 1819–1880) | 2/4 · C · 150 | 64초 | 작곡가 1880년 사망, 사후 70년이 지나 저작권이 끝난 퍼블릭 도메인 |
| 10 | 백조의 호수 | Swan Lake (Scene) | 차이콥스키 (Pyotr Ilyich Tchaikovsky, 1840–1893) | 4/4 · Bm · 72 | 60초 | 작곡가 1893년 사망, 사후 70년이 지나 저작권이 끝난 퍼블릭 도메인 |
| 11 | 미뉴에트 G장조 | Minuet in G | 페촐트 (Christian Petzold, 1677–1733) | 3/4 · G · 132 | 87초 | 작곡가 1733년 사망, 사후 70년이 지나 저작권이 끝난 퍼블릭 도메인 |
| 12 | 짐노페디 1번 | Gymnopédie No. 1 | 사티 (Erik Satie, 1866–1925) | 3/4 · D · 72 | 65초 | 작곡가 1925년 사망, 사후 70년이 지나 저작권이 끝난 퍼블릭 도메인 |
| 13 | 신세계 교향곡 2악장 | New World Symphony, Largo | 드보르자크 (Antonín Dvořák, 1841–1904) | 4/4 · D · 64 | 90초 | 작곡가 1904년 사망, 사후 70년이 지나 저작권이 끝난 퍼블릭 도메인 |
| 14 | 아리랑 | Arirang | 한국 민요 (Korean folk song, 전래) | 3/4 · C · 92 | 63초 | 전해 내려오는 민요, 저작권이 없는 퍼블릭 도메인 |
| 15 | 그린슬리브스 | Greensleeves | 잉글랜드 민요 (English folk song, 16세기) | 3/4 · Am · 132 | 89초 | 전해 내려오는 민요, 저작권이 없는 퍼블릭 도메인 |
| 16 | 징글벨 | Jingle Bells | 피어폰트 (James Lord Pierpont, 1822–1893) | 4/4 · G · 132 | 87초 | 작곡가 1893년 사망, 사후 70년이 지나 저작권이 끝난 퍼블릭 도메인 |
| 17 | 어메이징 그레이스 | Amazing Grace | 미국 민요 (American folk hymn (New Britain), 1829) | 3/4 · G · 80 | 74초 | 전해 내려오는 민요, 저작권이 없는 퍼블릭 도메인 |
| 18 | 브람스의 자장가 | Brahms' Lullaby | 브람스 (Johannes Brahms, 1833–1897) | 3/4 · F · 72 | 83초 | 작곡가 1897년 사망, 사후 70년이 지나 저작권이 끝난 퍼블릭 도메인 |
| 19 | 코로베이니키 | Korobeiniki | 러시아 민요 (Russian folk song, 19세기) | 4/4 · Am · 150 | 77초 | 전해 내려오는 민요, 저작권이 없는 퍼블릭 도메인 |
| 20 | 성자의 행진 | When the Saints Go Marching In | 미국 민요 (American spiritual, 전래) | 4/4 · C · 116 | 66초 | 전해 내려오는 민요, 저작권이 없는 퍼블릭 도메인 |
| 21 | 반짝반짝 작은 별 | Twinkle Twinkle Little Star | 프랑스 민요 (French folk song, 18세기) | 4/4 · C · 108 | 80초 | 전해 내려오는 민요, 저작권이 없는 퍼블릭 도메인 |
| 22 | 석별의 정 | Auld Lang Syne | 스코틀랜드 민요 (Scottish folk song, 18세기) | 4/4 · F · 92 | 86초 | 전해 내려오는 민요, 저작권이 없는 퍼블릭 도메인 |
| 23 | 고요한 밤 거룩한 밤 | Silent Night | 그루버 (Franz Xaver Gruber, 1787–1863) | 6/8 · C · 84 | 103초 | 작곡가 1863년 사망, 사후 70년이 지나 저작권이 끝난 퍼블릭 도메인 |
| 24 | 덱 더 홀스 | Deck the Halls | 웨일스 민요 (Welsh folk carol, 16세기) | 4/4 · F · 116 | 66초 | 전해 내려오는 민요, 저작권이 없는 퍼블릭 도메인 |
| 25 | 기쁘다 구주 오셨네 | Joy to the World | 로웰 메이슨 (Lowell Mason, 1792–1872) | 2/4 · D · 100 | 68초 | 작곡가 1872년 사망, 사후 70년이 지나 저작권이 끝난 퍼블릭 도메인 |
| 26 | 자크 형제 (돌림노래) | Frère Jacques | 프랑스 민요 (French folk round, 18세기) | 4/4 · C · 116 | 66초 | 전해 내려오는 민요, 저작권이 없는 퍼블릭 도메인 |
| 27 | 생일 축하 노래 | Happy Birthday to You | 힐 자매 (Mildred J. Hill & Patty Hill, 1859–1916 · 1868–1946) | 3/4 · C · 96 | 62초 | 두 작곡가 모두 사망 후 70년이 지나 2017년부터 퍼블릭 도메인 |
