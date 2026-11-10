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

test('a normal game click navigates to the chosen origin with its game path', async () => {
  let click;
  let navigated;
  let prevented = false;
  const card = { href: `${servers[0]}/golf/`, addEventListener: (_, handler) => { click = handler; } };
  const status = { setAttribute() {}, style: {} };
  const window = {
    PCG_RENDER_SERVERS: servers,
    document: { createElement: () => status, querySelector: () => ({ after() {} }), querySelectorAll: () => [card] },
    location: { assign: (url) => { navigated = url; } }
  };
  vm.runInNewContext(fs.readFileSync(require.resolve('./selector-router'), 'utf8'), {
    window, URL, AbortController, setTimeout, clearTimeout,
    fetch: async (url) => response(url.includes('second') ? 0 : 2)
  });
  await click({ button: 0, preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(navigated, `${servers[1]}/golf/`);
});
