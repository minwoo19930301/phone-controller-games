const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { chooseServer } = require('./selector-router');

const servers = ['https://first.example', 'https://second.example', 'https://third.example'];
const response = (rooms) => ({ ok: true, json: async () => ({ activeRooms: rooms }) });

test('selects the responding server with the fewest active rooms', async () => {
  const result = await chooseServer(servers, { fetcher: async (url) => response(url.includes('first') ? 4 : url.includes('second') ? 1 : 3) });
  assert.deepEqual(result, { server: servers[1], fallback: false });
});

test('breaks ties randomly and ignores failed or malformed responses', async () => {
  const tied = await chooseServer(servers, { random: () => 0.99, fetcher: async () => response(2) });
  assert.equal(tied.server, servers[2]);
  const healthy = await chooseServer(servers, { fetcher: async (url) => {
    if (url.includes('first')) throw Error('offline');
    if (url.includes('second')) return response(-1);
    return response(5);
  } });
  assert.equal(healthy.server, servers[2]);
});

test('times out sleeping servers and falls back to the first configured server', async () => {
  const fetcher = (url, { signal }) => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(Error('timeout')));
  });
  const result = await chooseServer(servers, { fetcher, timeout: 10 });
  assert.deepEqual(result, { server: servers[0], fallback: true });
});

test('single server remains usable and bad HTTP responses are ignored', async () => {
  assert.deepEqual(await chooseServer([servers[0]], { fetcher: async () => response(8) }), { server: servers[0], fallback: false });
  assert.deepEqual(await chooseServer([servers[0]], { fetcher: async () => ({ ok: false }) }), { server: servers[0], fallback: true });
});

function makePage(fetcher) {
  let click, navigated;
  let nextTimer = 0;
  const timers = new Map();
  const fakeSetTimeout = (handler, ms) => { const id = ++nextTimer; timers.set(id, { handler, ms }); return id; };
  const fakeClearTimeout = (id) => timers.delete(id);
  const card = { href: `${servers[0]}/golf/`, addEventListener: (_, handler) => { click = handler; } };
  const elements = [];
  function makeElement(tag) {
    const element = { tag, style: {}, children: [], events: {}, setAttribute() {},
      append(...children) { this.children.push(...children); },
      addEventListener(name, handler) { this.events[name] = handler; },
      focus() { this.focused = true; }
    };
    elements.push(element);
    return element;
  }
  const window = {
    PCG_RENDER_SERVERS: servers,
    document: { createElement: makeElement, body: { append() {} }, querySelectorAll: () => [card] },
    location: { assign: (url) => { navigated = url; } },
    addEventListener() {}
  };
  vm.runInNewContext(fs.readFileSync(require.resolve('./selector-router'), 'utf8'), {
    window, URL, AbortController, setTimeout: fakeSetTimeout, clearTimeout: fakeClearTimeout,
    fetch: fetcher
  });
  return { click: (event) => click(event), elements, timers, get navigated() { return navigated; } };
}

test('notice lets the user confirm and enter the chosen game server', async () => {
  let prevented = false;
  const page = makePage(async (url) => response(url.includes('second') ? 0 : 2));
  const pending = page.click({ button: 0, preventDefault() { prevented = true; } });
  const dialog = page.elements[0];
  const button = page.elements.find((element) => element.tag === 'button');
  assert.equal(prevented, true);
  assert.equal(dialog.hidden, false);
  assert.equal(button.focused, true);
  assert.match(page.elements.find((element) => element.id === 'server-wait-description').textContent, /시간이 걸릴 수/);
  assert.equal(page.navigated, undefined);
  button.events.click();
  await pending;
  assert.equal(page.navigated, `${servers[1]}/golf/`);
  assert.equal([...page.timers.values()].some((timer) => timer.ms === 2000), false);
});

test('notice automatically enters the fallback server after two seconds', async () => {
  const page = makePage(async () => { throw Error('offline'); });
  const pending = page.click({ button: 0, preventDefault() {} });
  const timer = [...page.timers.values()].find((entry) => entry.ms === 2000);
  assert.ok(timer);
  assert.equal(page.navigated, undefined);
  timer.handler();
  await pending;
  assert.equal(page.navigated, `${servers[0]}/golf/`);
});
