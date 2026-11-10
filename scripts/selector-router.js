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
  const status = root.document.createElement('p');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  status.style.cssText = 'position:fixed;left:16px;right:16px;bottom:16px;z-index:99;color:#fff;background:#16294a;font-size:16px;padding:12px 16px;border-radius:12px;box-shadow:0 4px 20px #0008';
  status.hidden = true;
  root.document.querySelector('h1.title').after(status);
  let selecting = false;
  root.document.querySelectorAll('a.card').forEach((card) => {
    card.addEventListener('click', async (event) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      if (selecting) return;
      selecting = true;
      status.hidden = false;
      status.textContent = '게임 서버를 확인하고 있어요…';
      const result = await chooseServer(servers);
      if (result.fallback) {
        status.textContent = '서버 응답을 확인하지 못했어요. 기존 서버로 연결합니다. 서버가 깨어나는 데 1분 정도 걸릴 수 있어요.';
        await new Promise((resolve) => setTimeout(resolve, 1800));
      }
      root.location.assign(new URL(new URL(card.href).pathname, result.server).href);
    });
  });
})(typeof window === 'undefined' ? null : window);
