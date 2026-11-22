// 다국어 모듈의 사전·틀 맞추기 검사(DOM 없이).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
// 이 저장소의 .js 는 node 에서 CommonJS 로 읽히므로, 브라우저용 ES 모듈은 글자로 읽어 data: 주소로 불러옵니다.
const src = fs.readFileSync(new URL('../public/common/i18n.js', import.meta.url), 'utf8');
const { register, t, setLang, lang, missing } = await import('data:text/javascript;base64,' + Buffer.from(src).toString('base64'));

register({
  en: {
    '준비': 'Ready',
    '쉬움': 'Easy',
    '준비 {a}/{b}': 'Ready {a}/{b}',
    '{p} 차례': "{p}'s turn",
    '난이도 {d}': 'Difficulty: {d}',
    '준비 {a}/{b} · 폰에서 모두 준비를 누르면 시작': 'Ready {a}/{b} · starts when every phone taps Ready',
  },
  ja: { '준비': '準備OK' },
});

test('Korean is the source language and passes through untouched', () => {
  assert.equal(lang(), 'ko');
  assert.equal(t('준비'), '준비');
  assert.equal(t('준비 {a}/{b}', { a: 1, b: 3 }), '준비 1/3');
});

test('exact strings, templates with values, and shape matching for ready-made sentences', () => {
  setLang('en');
  assert.equal(t('준비'), 'Ready');
  assert.equal(t('준비 {a}/{b}', { a: 1, b: 3 }), 'Ready 1/3');
  assert.equal(t('준비 2/4'), 'Ready 2/4'); // 이미 숫자가 들어간 문장도 틀로 찾음
  assert.equal(t('준비 2/4 · 폰에서 모두 준비를 누르면 시작'), 'Ready 2/4 · starts when every phone taps Ready'); // 더 구체적인 틀이 이김
  assert.equal(t('3P 차례'), "3P's turn");
  assert.equal(t('난이도 쉬움'), 'Difficulty: Easy'); // 자리에 들어온 한국어 값도 번역
  assert.equal(t('난이도 {d}', { d: '쉬움' }), 'Difficulty: Easy');
});

test('missing strings stay Korean and are collected for the checker', () => {
  assert.equal(t('없는 문장'), '없는 문장');
  assert.ok(missing().includes('없는 문장'));
  setLang('ja');
  assert.equal(t('준비'), '準備OK');
  assert.equal(t('쉬움'), '쉬움');
  setLang('ko');
});

test('a template with no fixed text is not a catch-all pattern', () => {
  register({ ja: { '{label} {said}': '{label}を{said}' } });
  setLang('ja');
  assert.equal(t('타이밍 ±0.3초 · 거의 다 들어가요'), '타이밍 ±0.3초 · 거의 다 들어가요');
  assert.equal(t('{label} {said}', { label: '슬로우', said: '켜기' }), '슬로우を켜기');
  assert.ok(missing().includes('타이밍 ±0.3초 · 거의 다 들어가요'));
  setLang('ko');
});
