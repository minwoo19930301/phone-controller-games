// 큰 화면 소리 안내: 브라우저가 소리를 막아 둔(AudioContext 가 suspended) 동안만 작은 안내를 띄웁니다.
// 화면을 누르거나 키를 누르면 소리가 켜지고 안내는 사라집니다. getCtx() 는 AudioContext 또는 null 을 돌려주고(만들지는 않습니다), unlock() 은 소리를 켭니다.
export function mountSoundGate(getCtx, unlock, shouldShow) {
  const el = document.createElement('button');
  el.type = 'button';
  el.textContent = '화면을 한 번 눌러 소리 켜기';
  el.setAttribute('aria-live', 'polite');
  el.style.cssText = 'position:fixed;left:50%;top:14px;transform:translateX(-50%);z-index:200;display:none;padding:10px 20px;border:0;border-radius:999px;' +
    'background:rgba(8,13,28,.82);color:#fff;font:800 15px/1 "Pretendard Variable",Pretendard,system-ui,sans-serif;cursor:pointer;';
  document.body.appendChild(el);
  const poke = () => { try { if (unlock) unlock(); } catch (e) { /* 소리 없이 계속 */ } };
  el.addEventListener('click', poke);
  // 키·포인터 입력이 들어오면 브라우저가 소리를 풀어 줍니다. 풀리는 데 잠깐 걸리니 곧바로 다시 확인합니다.
  for (const ev of ['pointerdown', 'keydown', 'touchstart']) window.addEventListener(ev, () => setTimeout(tick, 150), { capture: true });
  // 안내는 대기실에서 소리가 잠겨 있는(suspended 등 running 이 아닌) 동안만 보입니다. shouldShow 가 아직 쓸 수 없으면(초기화 전) 보이는 쪽으로 봅니다.
  const lobby = () => { try { return shouldShow ? shouldShow() : true; } catch (e) { return true; } };
  const tick = () => {
    const c = getCtx();
    el.style.display = lobby() && !(c && c.state === 'running') ? 'block' : 'none';
  };
  setInterval(tick, 800);
  tick();
  return el;
}
