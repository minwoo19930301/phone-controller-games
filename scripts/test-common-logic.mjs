// 공통 모듈의 기본값·튜토리얼 상한 검사(DOM 없이).
// 브라우저용 ES 모듈이라 임시 폴더에 .js 를 복사해 "type":"module" 로 읽고, window·localStorage 는 흉내만 냅니다.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const src = new URL('../public/common/', import.meta.url);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pcg-common-'));
fs.writeFileSync(path.join(tmp, 'package.json'), '{"type":"module"}');
for (const f of ['settings.js', 'tutorial.js', 'haptics.js']) fs.copyFileSync(new URL(f, src), path.join(tmp, f));

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
function setUrl(search) {
  globalThis.window = { location: { search, pathname: '/play/x/' }, PCG: undefined, addEventListener() {}, removeEventListener() {} };
  globalThis.location = globalThis.window.location;
}
globalThis.document = { hidden: false, body: null, head: null, addEventListener() {}, removeEventListener() {} };
setUrl('');
const load = (name, q) => import(pathToFileURL(path.join(tmp, name)).href + '?' + q);

const S = await load('settings.js', 'a');
const mk = (n) => Array.from({ length: n }, (_, i) => ({ title: '단계 ' + (i + 1), body: '설명' }));

test('기본 난이도는 쉬움이고, 항목 기본값도 쉬움', () => {
  assert.equal(S.DEFAULT_DIFFICULTY, 'easy');
  assert.equal(S.fields.difficulty().default, 'easy');
  assert.equal(S.byDifficulty(undefined ?? S.DEFAULT_DIFFICULTY, { easy: 1, normal: 2, hard: 3 }), 1);
});

test('슬로우 모드는 켜짐이 기본인 보통 알약(질문 카드 아님)', () => {
  const f = S.fields.slow();
  assert.equal(f.type, 'pills');
  assert.equal(f.default, true);
  assert.equal(f.ask, undefined);
});

test('저장 버전을 올려서 예전에 기억된 보통은 이기지 않고, 새로 고른 값은 기억됨', () => {
  store.clear();
  store.set('pcg-settings-demo', JSON.stringify({ difficulty: 'normal' })); // 예전 저장 버전
  const a = S.createSettings({ game: 'demo', fields: [S.fields.difficulty(), S.fields.slow()], keys: false });
  assert.equal(a.difficulty(), 'easy');
  assert.equal(a.values.slow, true);
  assert.equal(a.unanswered().length, 0); // 슬로우가 준비를 막지 않음
  a.set('difficulty', 'normal');
  a.destroy();
  const b = S.createSettings({ game: 'demo', fields: [S.fields.difficulty(), S.fields.slow()], keys: false });
  assert.equal(b.difficulty(), 'normal'); // 바꾼 뒤에 고른 값은 그대로 기억
  b.destroy();
});

test('튜토리얼은 ?tut=1 이 아니면 저절로 시작하지 않음', async () => {
  setUrl('');
  const T0 = await load('tutorial.js', 'b');
  assert.equal(T0.createTutorial({ key: 'a', steps: mk(3) }).firstTime(), false);
  setUrl('?tut=1');
  const T1 = await load('tutorial.js', 'c');
  assert.equal(T1.createTutorial({ key: 'b', steps: mk(3) }).firstTime(), true);
  // 예전처럼 저장소가 비어 있어도(처음 하는 폰) 주소에 없으면 false
  setUrl('?tut=0');
  const T2 = await load('tutorial.js', 'd');
  assert.equal(T2.createTutorial({ key: 'c', steps: mk(3) }).firstTime(), false);
});

test('튜토리얼은 { full: true } 가 아니면 2단계까지만', async () => {
  setUrl('');
  const T = await load('tutorial.js', 'e');
  assert.equal(T.createTutorial({ key: 'd', steps: mk(5) }).steps.length, 2);
  assert.equal(T.createTutorial({ key: 'e', steps: mk(1) }).steps.length, 1);
  assert.equal(T.createTutorial({ key: 'f', steps: mk(5), full: true }).steps.length, 5);
});

test('공통 사전: 네 칸이 다 있고 {자리} 이름이 언어마다 같음', () => {
  const text = fs.readFileSync(new URL('i18n-common.js', src), 'utf8');
  const rows = [...text.matchAll(/^\s*\[(['"])((?:\\.|(?!\1).)*)\1, (['"])((?:\\.|(?!\3).)*)\3, (['"])((?:\\.|(?!\5).)*)\5, (['"])((?:\\.|(?!\7).)*)\7\],?\s*$/gm)];
  assert.ok(rows.length > 100, 'rows ' + rows.length);
  const ph = (x) => (x.match(/\{\w+\}/g) || []).sort().join();
  for (const m of rows) {
    const [ko, en, ja, zh] = [m[2], m[4], m[6], m[8]];
    assert.ok(en && ja && zh, ko);
    assert.equal(ph(en), ph(ko), 'en ' + ko);
    assert.equal(ph(ja), ph(ko), 'ja ' + ko);
    assert.equal(ph(zh), ph(ko), 'zh ' + ko);
  }
});

test('songTitle / songComposer: 한국어 페이지는 한국어 필드, 그 밖에는 영어 필드', async () => {
  const code = fs.readFileSync(new URL('music/songs.js', src), 'utf8');
  const M = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
  const song = { title: '엘리제를 위하여', en: 'Für Elise', composer: '베토벤', composerEn: 'Beethoven' };
  globalThis.PCG = undefined;
  assert.equal(M.songTitle(song), '엘리제를 위하여');
  for (const [lang, title, comp] of [['ko', '엘리제를 위하여', '베토벤'], ['en', 'Für Elise', 'Beethoven'], ['ja', 'Für Elise', 'Beethoven'], ['zh', 'Für Elise', 'Beethoven']]) {
    globalThis.PCG = { i18n: { lang: () => lang } };
    assert.equal(M.songTitle(song), title, lang);
    assert.equal(M.songComposer(song), comp, lang);
  }
  globalThis.PCG = { i18n: { lang: () => 'en' } };
  assert.equal(M.songTitle({ title: '제목' }), '제목'); // 영어 필드가 없으면 한국어로
  globalThis.PCG = undefined;
});

test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
