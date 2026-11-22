/* The backend is selected only when starting a game, never for an existing room. */
(function (root) {
  'use strict';

  // 무료 서버는 요청을 받으면 깨어나 15분 동안 그 워크스페이스의 무료 시간을 씁니다.
  // 서버가 많을 때 고를 때마다 전부 깨우지 않도록, 그중 몇 대만 무작위로 골라 방 수를 묻습니다.
  const PROBE_COUNT = 3;
  function pickProbes(servers, count, random) {
    if (servers.length <= count) return servers;
    const pool = servers.slice();
    const picked = [];
    while (picked.length < count) picked.push(pool.splice(Math.floor(random() * pool.length), 1)[0]);
    return picked;
  }

  async function chooseServer(servers, options = {}) {
    const fetcher = options.fetcher || fetch;
    const random = options.random || Math.random;
    const timeout = options.timeout || 3000;
    const probes = pickProbes(servers, options.probe || PROBE_COUNT, random);
    const results = await Promise.all(probes.map(async (server) => {
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
    // 아무도 제때 답하지 않으면 방금 깨우기 시작한 첫 후보로 갑니다(목록이 짧으면 설정의 첫 서버).
    if (!available.length) return { server: probes[0], fallback: true };
    const fewest = Math.min(...available.map((entry) => entry.rooms));
    const tied = available.filter((entry) => entry.rooms === fewest);
    return { server: tied[Math.floor(random() * tied.length)].server, fallback: false };
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = { chooseServer };
  if (!root || !root.document) return;
  const servers = root.PCG_RENDER_SERVERS;
  if (!Array.isArray(servers) || !servers.length) return;
  // 서버 조회가 NOTICE_AFTER_MS 보다 오래 걸릴 때만 짧은 안내를 보여 줍니다. 조회가 끝나면 바로 넘어갑니다.
  const NOTICE_AFTER_MS = 400;
  const overlay = root.document.createElement('div');
  overlay.setAttribute('role', 'status');
  overlay.setAttribute('aria-live', 'polite');
  overlay.style.cssText = 'position:fixed;inset:0;z-index:99;display:none;place-items:center;padding:24px;background:rgba(3,8,18,.72)';
  overlay.hidden = true;

  const panel = root.document.createElement('div');
  panel.style.cssText = 'padding:18px 26px;border:1px solid rgba(255,255,255,.15);border-radius:16px;background:#16243a;color:#fff;box-shadow:0 16px 48px #0008';
  const title = root.document.createElement('p');
  title.id = 'server-wait-title';
  title.textContent = '게임 서버에 연결하고 있어요';
  title.style.cssText = 'margin:0;font-size:18px;font-weight:700;line-height:1.4';
  panel.append(title);
  overlay.append(panel);
  root.document.body.append(overlay);

  let selecting = false;
  let noticeTimer = 0;
  const hideNotice = () => { clearTimeout(noticeTimer); overlay.hidden = true; overlay.style.display = 'none'; };
  root.addEventListener('pageshow', (event) => {
    if (event.persisted) { selecting = false; hideNotice(); }
  });
  root.document.querySelectorAll('a.card').forEach((card) => {
    card.addEventListener('click', async (event) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      if (selecting) return;
      selecting = true;
      noticeTimer = setTimeout(() => { overlay.hidden = false; overlay.style.display = 'grid'; }, NOTICE_AFTER_MS);
      let result;
      try {
        result = await chooseServer(servers, { timeout: 1800 });
      } catch (_) {
        result = { server: servers[0], fallback: true };
      }
      // 이동이 시작되면 안내는 그대로 둡니다(깨어나는 서버는 로딩이 길 수 있습니다). 타이머만 정리합니다.
      clearTimeout(noticeTimer);
      root.location.assign(new URL(new URL(card.href).pathname, result.server).href);
    });
  });
})(typeof window === 'undefined' ? null : window);
