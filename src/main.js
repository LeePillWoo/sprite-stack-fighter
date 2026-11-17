// ───────────────────────────────────────────────────────────── page: canvas, input, loop
// (started a moment after the page shows, so the loading message is on screen while the world is built)
setTimeout(() => {
  const $ = id => document.getElementById(id);
  const cv = $('c'), ctx = cv.getContext('2d'), wrap = $('wrap'), msg = $('msg'), fpsEl = $('fps'), bot = $('bot'), pad = $('pad');
  const qs = new URLSearchParams(location.search), debug = qs.has('debug');
  const game = createGame();
  // The picture fills the window (any shape from 4:3 tablets to 21:9 phones and ultrawide monitors), kept clear of
  // notches. Four resolution steps, by the number of rows drawn: 1K, 720, 360, 150 (never more rows than the screen
  // has). From twice the step upwards the buffer is the screen divided by a whole number of device pixels, so every
  // pixel is a sharp square (a 1170-row phone at "360" draws 390 rows, 3 device pixels each); below that, where whole
  // numbers do not fit, the exact step is drawn and scaled smoothly.
  const TIERS = [1080, 720, 360, 150], TIER_NAME = ['1K', '720', '360', '150'];
  let tier = qs.has('tier') ? clamp(+qs.get('tier') | 0, 0, 3) : 2, manual = qs.has('tier'), image = null, touch = false;
  const minTier = () => (touch ? 1 : 0);   // phones and tablets stop at 720
  const safe = document.createElement('div');
  safe.style.cssText = 'position:fixed;inset:0;visibility:hidden;pointer-events:none;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)';
  document.body.appendChild(safe);
  function fit() {
    const cs = getComputedStyle(safe), vv = window.visualViewport;
    const vw = (vv ? vv.width : innerWidth) - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const vh = (vv ? vv.height : innerHeight) - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    const aspect = clamp(vw / vh, 4 / 3, 21 / 9), boxW = Math.min(vw, vh * aspect), boxH = boxW / aspect;
    const dpr = window.devicePixelRatio || 1, devH = boxH * dpr, k = devH / TIERS[tier];
    const whole = k >= 2 || k <= 1, n = k <= 1 ? 1 : Math.round(k);
    const h = Math.max(136, Math.floor(whole ? devH / n : TIERS[tier]) & ~1), w = Math.max(240, Math.round(h * aspect) & ~1);
    if (game.width !== w || game.height !== h) { game.resize(w, h); cv.width = w; cv.height = h; image = new ImageData(w, h); }
    const cw = whole ? (w * n) / dpr : boxW, ch = whole ? (h * n) / dpr : boxH;
    cv.style.width = cw + 'px'; cv.style.height = ch + 'px'; wrap.style.width = cw + 'px';
    cv.style.imageRendering = whole ? '' : 'auto';
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
  const keys = {}, held = { boost: false };
  let mouseGun = false;
  const sync = () => {
    game.setHolding(mouseGun || !!keys.Space);
    game.setKeys((keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0),
      (keys.KeyW || keys.ArrowUp ? 1 : 0) - (keys.KeyS || keys.ArrowDown ? 1 : 0), !!(keys.ShiftLeft || keys.ShiftRight || held.boost));
  };
  const toBuf = e => { const r = cv.getBoundingClientRect(); game.pointerMove(((e.clientX - r.left) / r.width) * game.width, ((e.clientY - r.top) / r.height) * game.height); };
  const useTouch = () => { if (touch) return; touch = true; game.setTouch(true); tier = Math.max(tier, minTier()); pad.hidden = false; bot.hidden = true; fit(); joyHome(); note(MODE[game.view]); };
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

  const MSL_MSG = { empty: '미사일 없음 — 5초마다 1발 충전', lock: '미사일 발사 — 락온', seek: '미사일 발사 — 추적', dumb: '미사일 발사' };
  // on touch each view flies differently (and the guns fire by themselves): say which when the view changes
  const MODE = ['위에서 보기 — 조이스틱 방향으로 비행 · 사격 자동', '뒤에서 따라가기 — 좌우 선회 · 위로 밀면 상승 · 사격 자동', '조종석 — 실제 비행기처럼: 좌우 롤, 당기면 기수 상승 · 사격 자동'];
  const sound = createAudio(game);
  addEventListener('pointerdown', () => sound.unlock(), true);
  addEventListener('keydown', () => sound.unlock(), true);
  const launch = () => { const r = game.fireMissile(); if (MSL_MSG[r]) note(MSL_MSG[r]); };

  // mouse: move steers, left button fires, right button launches
  addEventListener('pointermove', e => { if (e.pointerType !== 'touch') toBuf(e); });
  cv.addEventListener('contextmenu', e => e.preventDefault());
  cv.addEventListener('pointerdown', e => {
    if (e.pointerType === 'touch') return;
    toBuf(e);
    if (e.button === 0) { mouseGun = true; sync(); }
    if (e.button === 2) launch();
  });
  addEventListener('pointerup', e => { if (e.pointerType !== 'touch' && e.button === 0) { mouseGun = false; sync(); } });

  // touch: a stick that appears wherever a finger lands on the left half, and follows it until it lifts.
  // At rest it waits, faint, at its home spot so it is clear where to touch.
  const joy = $('joy'), knob = $('knob');
  let joyId = -1, jx = 0, jy = 0;
  const joyReach = () => joy.offsetWidth * 0.42;
  const joyHome = () => { const r = wrap.getBoundingClientRect(); jx = Math.max(joy.offsetWidth * 0.6, r.width * 0.13); jy = r.height - Math.max(joy.offsetWidth * 0.7, r.height * 0.27); joy.style.left = jx + 'px'; joy.style.top = jy + 'px'; };
  const joyOff = () => { joyId = -1; joy.classList.remove('on'); knob.style.transform = ''; joyHome(); game.setStick(false, 0, 0); };
  wrap.addEventListener('pointerdown', e => {
    if (e.pointerType !== 'touch' || e.target.closest('button') || joyId !== -1) return;
    const r = wrap.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    if (x > r.width * 0.5) return;
    e.preventDefault();
    joyId = e.pointerId; jx = x; jy = y;
    joy.style.left = x + 'px'; joy.style.top = y + 'px'; knob.style.transform = ''; joy.classList.add('on');
    game.setStick(true, 0, 0);
  });
  addEventListener('pointermove', e => {
    if (e.pointerId !== joyId) return;
    const r = wrap.getBoundingClientRect(), R = joyReach();
    let dx = e.clientX - r.left - jx, dy = e.clientY - r.top - jy;
    const d = Math.hypot(dx, dy);
    if (d > R) { dx *= R / d; dy *= R / d; }
    knob.style.transform = `translate(${dx}px,${dy}px)`;
    game.setStick(true, dx / R, -dy / R);
  });
  const joyUp = e => { if (e.pointerId === joyId) joyOff(); };
  addEventListener('pointerup', joyUp);
  addEventListener('pointercancel', joyUp);
  addEventListener('resize', () => { if (joyId === -1) joyHome(); });
  addEventListener('blur', () => { for (const k in keys) keys[k] = false; for (const k in held) held[k] = false; mouseGun = false; sync(); joyOff(); });

  // touch buttons: some are held (gun, thrust, climb, dive), some are taps
  const tap = { roll: () => game.startRoll(0), view: () => { game.toggleView(); note(MODE[game.view]); }, sound: () => note('소리: ' + (sound.toggle() ? '켬' : '끔')), calm: () => note('화면 안정: ' + (game.toggleCalm() ? '켬' : '끔')) };
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

  if (matchMedia('(pointer: coarse)').matches) useTouch();   // (after the stick exists)

  addEventListener('keydown', e => {
    keys[e.code] = true; sync();
    if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
    if (e.repeat) return;
    if (e.code === 'Digit1' || e.code === 'Digit2' || e.code === 'Digit3') game.setView(+e.code[5] - 1);
    if (e.code === 'KeyQ') game.startRoll(-1);
    if (e.code === 'KeyE') game.startRoll(1);
    if (e.code === 'KeyF') launch();
    if (e.code === 'KeyT') game.cycleTime();
    if (e.code === 'KeyM') note('소리: ' + (sound.toggle() ? '켬' : '끔'));
    if (e.code === 'KeyC') note('화면 안정: ' + (game.toggleCalm() ? '켬' : '끔'));
    if (e.code === 'KeyB') note('움직임 보정: ' + ['끔', '약', '강'][game.cycleSmooth()]);
    if (e.code === 'KeyR') { tier = tier >= 3 ? minTier() : tier + 1; manual = true; fit(); note(`해상도 ${TIER_NAME[tier]} (${game.width}×${game.height})`); }
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
    sound.update();
    image.data.set(game.render());
    ctx.putImageData(image, 0, 0);
    cost += performance.now() - t0; acc += dt; frames++;
    if (acc >= 0.5) {
      game.fps = Math.round(frames / acc); game.ms = cost / frames;
      // Automatic step, unless R chose one: a step down only when the frame rate has clearly suffered for a couple of
      // seconds (under ~45 fps), a step up only when the next step's cost (by its pixel count) fits a 60 fps frame.
      if (!manual) {
        const up = tier > minTier() ? Math.min(TIERS[tier - 1], game.height * 3) : 0, upCost = game.ms * (up / game.height) ** 2;
        slow = game.ms > 22 ? slow + 1 : 0;
        fast = up > game.height && upCost < 12 ? fast + 1 : 0;
        if (slow >= 4 && tier < 3) { tier++; slow = 0; fit(); } else if (fast >= 10) { tier--; fast = 0; fit(); }
      }
      fpsEl.textContent = debug ? `${game.fps} fps · ${game.ms.toFixed(1)} ms · ${TIER_NAME[tier]} ${game.width}x${game.height}` : '';
      if ((noteT -= acc) <= 0 && !(touch && innerHeight > innerWidth)) msg.textContent = game.cb.dead ? '격추당했습니다 — 재출격 중…' : '';
      bot.className = game.view === 2 ? 'top' : '';
      acc = 0; frames = 0; cost = 0;
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}, 30);
