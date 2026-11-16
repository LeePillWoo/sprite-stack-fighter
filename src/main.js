// ───────────────────────────────────────────────────────────── page: canvas, input, loop
// (started a moment after the page shows, so the loading message is on screen while the world is built)
setTimeout(() => {
  const $ = id => document.getElementById(id);
  const cv = $('c'), ctx = cv.getContext('2d'), wrap = $('wrap'), msg = $('msg'), fpsEl = $('fps'), bot = $('bot'), pad = $('pad');
  const qs = new URLSearchParams(location.search), debug = qs.has('debug');
  const game = createGame();
  // The picture fills the window (any shape from 4:3 tablets to 21:9 phones and ultrawide monitors), kept clear of
  // notches. The buffer is that box divided by a whole number of *device* pixels, so every pixel is a sharp square
  // on any screen density; it aims for about 360 rows (270 on touch devices, which are slower).
  // `coarse` adds to that number: bigger pixels, fewer of them, when the machine is busy.
  let coarse = +(qs.get('tier') || 0), manual = qs.has('tier'), image = null, scale = 1, touch = false;
  const safe = document.createElement('div');
  safe.style.cssText = 'position:fixed;inset:0;visibility:hidden;pointer-events:none;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)';
  document.body.appendChild(safe);
  function fit() {
    const cs = getComputedStyle(safe), vv = window.visualViewport;
    const vw = (vv ? vv.width : innerWidth) - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const vh = (vv ? vv.height : innerHeight) - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    const aspect = clamp(vw / vh, 4 / 3, 21 / 9), boxW = Math.min(vw, vh * aspect), boxH = boxW / aspect;
    const dpr = window.devicePixelRatio || 1;
    scale = Math.max(1, Math.round((boxH * dpr) / (touch ? 270 : 360))) + coarse;
    const w = Math.max(240, Math.floor((boxW * dpr) / scale) & ~1), h = Math.max(136, Math.floor((boxH * dpr) / scale) & ~1);
    if (game.width !== w || game.height !== h) { game.resize(w, h); cv.width = w; cv.height = h; image = new ImageData(w, h); }
    cv.style.width = (w * scale) / dpr + 'px'; cv.style.height = (h * scale) / dpr + 'px'; wrap.style.width = (w * scale) / dpr + 'px';
    if (touch) msg.textContent = innerHeight > innerWidth ? '화면을 가로로 돌려 주세요' : '';
  }
  addEventListener('resize', fit);
  addEventListener('orientationchange', () => setTimeout(fit, 250));
  if (window.visualViewport) visualViewport.addEventListener('resize', fit);
  matchMedia('(resolution: 1dppx)').addEventListener?.('change', fit);   // dragged to a screen of another density
  fit();

  let noteT = 0;
  const note = t => { msg.textContent = t; noteT = 1.6; };

  // ── input: everything ends up in three calls — where the pointer is, whether the gun is held, and the keys
  const keys = {}, held = { gun: false, boost: false, up: false, down: false };
  let mouseGun = false, steerId = -1;
  const sync = () => {
    game.setHolding(mouseGun || !!keys.Space || held.gun);
    game.setKeys((keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0),
      (keys.KeyW || keys.ArrowUp || held.up ? 1 : 0) - (keys.KeyS || keys.ArrowDown || held.down ? 1 : 0), !!(keys.ShiftLeft || keys.ShiftRight || held.boost));
  };
  const toBuf = e => { const r = cv.getBoundingClientRect(); game.pointerMove(((e.clientX - r.left) / r.width) * game.width, ((e.clientY - r.top) / r.height) * game.height); };
  const useTouch = () => { if (touch) return; touch = true; pad.hidden = false; bot.hidden = true; fit(); };
  // on a phone the first touch goes full screen and holds landscape (where the browser allows it; iPhones do not)
  let wentFull = false;
  const goFull = () => {
    if (wentFull || !touch) return;
    wentFull = true;
    const el = document.documentElement, req = el.requestFullscreen || el.webkitRequestFullscreen;
    if (!req) return;
    Promise.resolve(req.call(el, { navigationUI: 'hide' })).then(() => screen.orientation?.lock?.('landscape')).catch(() => {}).finally(() => setTimeout(fit, 300));
  };
  addEventListener('pointerdown', e => { if (e.pointerType === 'touch') { useTouch(); goFull(); } }, true);
  if (matchMedia('(pointer: coarse)').matches) useTouch();

  // mouse: move steers, left button fires, right button launches. A finger on the picture steers while it is down.
  addEventListener('pointermove', e => { if (e.pointerType !== 'touch' || e.pointerId === steerId) toBuf(e); });
  cv.addEventListener('contextmenu', e => e.preventDefault());
  cv.addEventListener('pointerdown', e => {
    toBuf(e);
    if (e.pointerType === 'touch') { useTouch(); steerId = e.pointerId; return; }
    if (e.button === 0) { mouseGun = true; sync(); }
    if (e.button === 2) game.fireMissile();
  });
  const release = e => {
    if (e.pointerId === steerId) { steerId = -1; game.pointerLeave(); }
    else if (e.pointerType !== 'touch' && e.button === 0) { mouseGun = false; sync(); }
  };
  addEventListener('pointerup', release);
  addEventListener('pointercancel', release);
  addEventListener('blur', () => { for (const k in keys) keys[k] = false; for (const k in held) held[k] = false; mouseGun = false; sync(); });

  // touch buttons: some are held (gun, thrust, climb, dive), some are taps
  const tap = { msl: () => game.fireMissile(), roll: () => game.startRoll(0), view: () => game.toggleView(), calm: () => note('화면 안정: ' + (game.toggleCalm() ? '켬' : '끔')) };
  for (const b of pad.querySelectorAll('button')) {
    const k = b.dataset.k;
    const set = (e, on) => {
      e.preventDefault(); e.stopPropagation();
      if (on) { try { b.setPointerCapture(e.pointerId); } catch { /* the touch has already ended */ } if (tap[k]) tap[k](); }
      if (k in held) { held[k] = on; sync(); }
      b.classList.toggle('on', on);
    };
    b.addEventListener('pointerdown', e => set(e, true));
    b.addEventListener('pointerup', e => set(e, false));
    b.addEventListener('pointercancel', e => set(e, false));
    b.addEventListener('contextmenu', e => e.preventDefault());
  }

  addEventListener('keydown', e => {
    keys[e.code] = true; sync();
    if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
    if (e.repeat) return;
    if (e.code === 'Digit1' || e.code === 'Digit2' || e.code === 'Digit3') game.setView(+e.code[5] - 1);
    if (e.code === 'KeyQ') game.startRoll(-1);
    if (e.code === 'KeyE') game.startRoll(1);
    if (e.code === 'KeyF') game.fireMissile();
    if (e.code === 'KeyT') game.cycleTime();
    if (e.code === 'KeyC') note('화면 안정: ' + (game.toggleCalm() ? '켬' : '끔'));
    if (e.code === 'KeyB') note('움직임 보정: ' + ['끔', '약', '강'][game.cycleSmooth()]);
    if (e.code === 'KeyR') { coarse = (coarse + 1) % 3; manual = true; fit(); note(`해상도 ${game.width}×${game.height}`); }
  });
  addEventListener('keyup', e => { keys[e.code] = false; sync(); });
  addEventListener('wheel', e => { e.preventDefault(); game.nudgeAlt(-Math.sign(e.deltaY) * 16); }, { passive: false });

  // ── loop
  let last = performance.now(), acc = 0, frames = 0, slow = 0, fast = 0, cost = 0;
  window.game = game; game.fps = 0; game.ms = 0;
  function frame(now) {
    const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
    last = now;
    const t0 = performance.now();
    game.step(dt);
    image.data.set(game.render());
    ctx.putImageData(image, 0, 0);
    cost += performance.now() - t0; acc += dt; frames++;
    if (acc >= 0.5) {
      game.fps = Math.round(frames / acc); game.ms = cost / frames;
      // too slow for 60 fps: go one step coarser rather than stutter; plenty to spare for a while: go finer again
      if (!manual) {
        slow = game.ms > 14.5 ? slow + 1 : 0;
        fast = coarse > 0 && game.ms * ((scale / (scale - 1)) ** 2) < 10 ? fast + 1 : 0;
        if (slow >= 3 && coarse < 2) { coarse++; slow = 0; fit(); } else if (fast >= 12) { coarse--; fast = 0; fit(); }
      }
      fpsEl.textContent = debug ? `${game.fps} fps · ${game.ms.toFixed(1)} ms · ${game.width}x${game.height}` : '';
      if ((noteT -= acc) <= 0 && !(touch && innerHeight > innerWidth)) msg.textContent = game.cb.dead ? '격추당했습니다 — 재출격 중…' : '';
      bot.className = game.view === 2 ? 'top' : '';
      acc = 0; frames = 0; cost = 0;
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}, 30);
