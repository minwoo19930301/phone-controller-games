/* The backend is selected only when starting a game, never for an existing room. */
(function (root) {
  'use strict';

  async function chooseServer(servers, options = {}) {
    const fetcher = options.fetcher || fetch;
    const random = options.random || Math.random;
    const timeout = options.timeout || 3000;
    const results = await Promise.all(servers.map(async (server) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);
      try {
        const response = await fetcher(`${server}/api/load`, { signal: controller.signal, credentials: 'omit' });
        if (!response.ok) return null;
        const body = await response.json();
        if (!Number.isSafeInteger(body.activeRooms) || body.activeRooms < 0) return null;
        return { server, rooms: body.activeRooms };
      } catch (_) {
        return null;
      } finally {
        clearTimeout(timer);
      }
    }));
    const available = results.filter(Boolean);
    if (!available.length) return { server: servers[0], fallback: true };
    const fewest = Math.min(...available.map((entry) => entry.rooms));
    const tied = available.filter((entry) => entry.rooms === fewest);
    return { server: tied[Math.floor(random() * tied.length)].server, fallback: false };
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = { chooseServer };
  if (!root || !root.document) return;
  const servers = root.PCG_RENDER_SERVERS;
  if (!Array.isArray(servers) || !servers.length) return;
  const overlay = root.document.createElement('div');
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-labelledby', 'server-wait-title');
  overlay.setAttribute('aria-describedby', 'server-wait-description');
  overlay.style.cssText = 'position:fixed;inset:0;z-index:99;display:none;place-items:center;padding:24px;background:rgba(3,8,18,.72)';
  overlay.hidden = true;

  const panel = root.document.createElement('div');
  panel.style.cssText = 'width:min(420px,100%);padding:28px;border:1px solid rgba(255,255,255,.15);border-radius:20px;background:#16243a;color:#fff;box-shadow:0 16px 48px #0008';
  const title = root.document.createElement('h2');
  title.id = 'server-wait-title';
  title.textContent = '게임 서버에 연결하고 있어요';
  title.style.cssText = 'margin:0 0 12px;font-size:22px;line-height:1.3';
  const description = root.document.createElement('p');
  description.id = 'server-wait-description';
  description.textContent = '서버가 켜지는 데 시간이 걸릴 수 있어요. 조금만 기다려 주세요.';
  description.style.cssText = 'margin:0;color:#d4dfed;line-height:1.55';
  const hint = root.document.createElement('p');
  hint.textContent = '2초 후 자동으로 이동해요.';
  hint.style.cssText = 'margin:10px 0 22px;color:#aebed2;font-size:14px';
  const confirm = root.document.createElement('button');
  confirm.type = 'button';
  confirm.textContent = '확인';
  confirm.style.cssText = 'width:100%;padding:12px;border:0;border-radius:10px;background:#ffd23a;color:#121620;font:inherit;font-weight:800;cursor:pointer';
  panel.append(title, description, hint, confirm);
  overlay.append(panel);
  root.document.body.append(overlay);

  let acknowledge = null;
  confirm.addEventListener('click', () => { if (acknowledge) acknowledge(); });
  overlay.addEventListener('keydown', (event) => {
    if (event.key === 'Tab') { event.preventDefault(); confirm.focus(); }
  });
  let selecting = false;
  root.addEventListener('pageshow', (event) => {
    if (event.persisted) { selecting = false; overlay.hidden = true; overlay.style.display = 'none'; }
  });
  root.document.querySelectorAll('a.card').forEach((card) => {
    card.addEventListener('click', async (event) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      if (selecting) return;
      selecting = true;
      overlay.hidden = false;
      overlay.style.display = 'grid';
      confirm.focus();
      // Start checking both servers while the notice is visible. The lookup
      // ends before the two-second automatic transition, even for sleeping servers.
      const selection = chooseServer(servers, { timeout: 1800 });
      const notice = new Promise((resolve) => {
        const timer = setTimeout(done, 2000);
        function done() { clearTimeout(timer); acknowledge = null; resolve(); }
        acknowledge = done;
      });
      const [result] = await Promise.all([selection, notice]);
      root.location.assign(new URL(new URL(card.href).pathname, result.server).href);
    });
  });
})(typeof window === 'undefined' ? null : window);
