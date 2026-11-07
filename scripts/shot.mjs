// 헤드리스 크롬으로 페이지를 열어 정해진 시각마다 스크린샷을 찍고, 콘솔 오류와 마지막 상태를 모읍니다.
// 폰이 없는 환경에서 화면을 눈으로 확인하는 개발용 도구입니다.
//
// 사용: node scripts/shot.mjs <url> <출력접두사> "<ms>[:<URL인코딩된 JS>],<ms>..." ["<마지막에 출력할 JS 식>"] [폭] [높이]
//   예: node scripts/shot.mjs "http://localhost:3301/fishing/?bots=2" .shots/fish "3000,8000:__fishing.forceBite(1)" "JSON.stringify(__fishing.players)"
//   각 시각마다 <출력접두사>-<순번>.png 를 씁니다. ':' 뒤의 JS 는 그 시각에 먼저 실행한 뒤 찍습니다.
// 환경 변수: GPU=1 (실제 GPU, WebGL 이 빠름), MOBILE=1 (폰처럼 터치·좁은 화면·기기 배율 3)
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const [, , url, out, times = '3000', expr = '', w = process.env.MOBILE ? '390' : '1600', h = process.env.MOBILE ? '844' : '900'] = process.argv;
if (!url || !out) {
  console.error('사용: node scripts/shot.mjs <url> <출력접두사> "<ms>[:<js>],..." ["<js 식>"] [폭] [높이]');
  process.exit(2);
}
const CH = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const port = 9300 + Math.floor(Math.random() * 600);
const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'pcg-shot-'));
const gpu = process.env.GPU ? ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
const proc = spawn(CH, ['--headless=new', ...gpu, '--hide-scrollbars', '--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
  `--remote-debugging-port=${port}`, `--window-size=${w},${h}`, `--user-data-dir=${prof}`, 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cleanup = () => { try { proc.kill('SIGKILL'); } catch (e) {} try { fs.rmSync(prof, { recursive: true, force: true }); } catch (e) {} };
process.on('exit', cleanup);

let list = null;
for (let i = 0; i < 60 && !list; i++) {
  await sleep(250);
  try { list = await fetch(`http://127.0.0.1:${port}/json`).then((r) => r.json()); } catch (e) {}
}
if (!list) { console.error('크롬을 띄우지 못했습니다'); process.exit(1); }
const page = list.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0;
const pending = new Map();
const logs = [];
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result || m.error); pending.delete(m.id); return; }
  if (m.method === 'Runtime.consoleAPICalled' && (m.params.type === 'error' || m.params.type === 'warning' || process.env.LOGS)) {
    logs.push(`[console.${m.params.type}] ` + m.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
  }
  if (m.method === 'Runtime.exceptionThrown') logs.push('[exception] ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
  if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') logs.push('[log.error] ' + m.params.entry.text + ' ' + (m.params.entry.url || ''));
};
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
await send('Runtime.enable');
await send('Page.enable');
await send('Log.enable');
if (process.env.MOBILE) {
  await send('Emulation.setDeviceMetricsOverride', { width: +w, height: +h, deviceScaleFactor: 3, mobile: true });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await send('Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36' });
}
await send('Page.navigate', { url });
const t0 = Date.now();
const evalJs = async (js) => {
  const r = await send('Runtime.evaluate', { expression: js, awaitPromise: true, returnByValue: true });
  if (r && r.exceptionDetails) return '[error] ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r && r.result ? r.result.value : undefined;
};
const steps = times.split(',').filter(Boolean).map((s) => {
  const i = s.indexOf(':');
  return i < 0 ? { at: +s, js: null } : { at: +s.slice(0, i), js: decodeURIComponent(s.slice(i + 1)) };
});
fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
let k = 0;
for (const st of steps) {
  const wait = st.at - (Date.now() - t0);
  if (wait > 0) await sleep(wait);
  if (st.js) {
    const v = await evalJs(st.js);
    if (v !== undefined) console.log(`[${st.at}ms] ${String(v).slice(0, 400)}`);
    await sleep(120);
  }
  k++;
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  const file = `${out}-${k}.png`;
  fs.writeFileSync(file, Buffer.from(shot.data, 'base64'));
  console.log('shot', path.resolve(file));
}
if (expr) console.log('expr:', String(await evalJs(expr)).slice(0, 4000));
console.log(logs.length ? logs.join('\n') : '(콘솔 오류 없음)');
ws.close();
cleanup();
process.exit(0);
