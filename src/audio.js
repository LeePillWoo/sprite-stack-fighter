// ───────────────────────────────────────────────────────────── sound
// Everything is synthesised with Web Audio (there are no sound files): filtered noise for the engine, wind, guns
// and blasts, a few low oscillators for the thumps underneath. Each effect is layered the way recorded effects are —
// a sharp crack, a body, a low tail — and placed by distance and side, so it reads as a sound, not a bleep.
function createAudio(game) {
  const AC = window.AudioContext || window.webkitAudioContext;
  let ac = null, on = true, master = null, sfx = null, wet = null, white = null, brown = null, eng = null, lockOsc = null, lockGain = null;

  function makeBuffers() {
    const n = ac.sampleRate * 2;
    white = ac.createBuffer(1, n, ac.sampleRate);
    brown = ac.createBuffer(1, n, ac.sampleRate);
    const w = white.getChannelData(0), b = brown.getChannelData(0);
    let last = 0;
    for (let i = 0; i < n; i++) { w[i] = Math.random() * 2 - 1; last = (last + 0.02 * w[i]) / 1.02; b[i] = last * 3.5; }
    // a short outdoor tail for the big sounds: decaying noise, darker as it goes
    const ir = ac.createBuffer(2, ac.sampleRate * 1.8, ac.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = ir.getChannelData(c);
      let lp = 0;
      for (let i = 0; i < d.length; i++) { const t = i / ac.sampleRate; lp += (Math.random() * 2 - 1 - lp) * Math.max(0.04, 0.6 - t * 0.35); d[i] = lp * Math.exp(-t * 3.2); }
    }
    const conv = ac.createConvolver();
    conv.buffer = ir;
    wet = ac.createGain(); wet.gain.value = 0.32;
    wet.connect(conv); conv.connect(master);
  }

  function loop(buf, ...chain) {
    const s = ac.createBufferSource();
    s.buffer = buf; s.loop = true; s.loopStart = 0; s.loopEnd = buf.duration;
    let node = s;
    for (const c of chain) { node.connect(c); node = c; }
    s.start(0, Math.random() * buf.duration);
    return node;
  }
  const filt = (type, f, q = 0.7) => { const b = ac.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; return b; };
  const gain = v => { const g = ac.createGain(); g.gain.value = v; return g; };

  function init() {
    ac = new AC();
    const comp = ac.createDynamicsCompressor();
    comp.threshold.value = -16; comp.knee.value = 10; comp.ratio.value = 4; comp.attack.value = 0.004; comp.release.value = 0.25;
    master = gain(0.8); master.connect(comp); comp.connect(ac.destination);
    sfx = gain(1); sfx.connect(master);
    makeBuffers();
    // the jet itself: a deep rumble, a turbine whine, an afterburner roar and the wind over the canopy,
    // all through one filter that closes a little in the cockpit
    const bus = filt('lowpass', 9000); const busGain = gain(0.0); bus.connect(busGain); busGain.connect(master);
    eng = {
      bus, busGain,
      rumF: filt('lowpass', 260), rum: gain(0.5),
      whF: filt('bandpass', 2800, 9), wh: gain(0.06),
      roarF: filt('bandpass', 650, 0.6), roar: gain(0),
      windF: filt('bandpass', 1000, 0.8), wind: gain(0.1),
    };
    loop(brown, eng.rumF, eng.rum).connect(bus);
    loop(white, eng.whF, eng.wh).connect(bus);
    loop(white, eng.roarF, filt('lowpass', 2400), eng.roar).connect(bus);
    loop(white, eng.windF, eng.wind).connect(master);   // (the wind is outside: not muffled with the engine)
    // the lock tone: a low growl while the seeker looks, a steady tone once it has the target
    lockOsc = ac.createOscillator(); lockOsc.type = 'triangle'; lockOsc.frequency.value = 480;
    lockGain = gain(0); lockOsc.connect(lockGain); lockGain.connect(master); lockOsc.start();
  }

  // a burst of filtered noise with a sweep and a fast attack / exponential decay
  function noiseHit({ at, dur, vol, f0, f1 = f0, type = 'bandpass', q = 0.8, pan = 0, buf = white, verb = 0, attack = 0.002 }) {
    const s = ac.createBufferSource(); s.buffer = buf;
    const f = filt(type, f0, q), g = gain(0), p = ac.createStereoPanner(); p.pan.value = pan;
    s.connect(f); f.connect(g); g.connect(p); p.connect(sfx);
    if (verb) { const v = gain(verb); p.connect(v); v.connect(wet); }
    f.frequency.setValueAtTime(f0, at); f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), at + dur);
    g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(vol, at + attack); g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    s.start(at, Math.random() * 1.5, dur + 0.05);
    s.onended = () => { s.disconnect(); p.disconnect(); };
  }
  // a pitched thump (a sine dropping in pitch): the weight under guns and blasts
  function thump({ at, dur, vol, f0, f1, pan = 0 }) {
    const o = ac.createOscillator(), g = gain(0), p = ac.createStereoPanner(); p.pan.value = pan;
    o.frequency.setValueAtTime(f0, at); o.frequency.exponentialRampToValueAtTime(f1, at + dur);
    o.connect(g); g.connect(p); p.connect(sfx);
    g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(vol, at + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    o.start(at); o.stop(at + dur + 0.02);
    o.onended = () => { o.disconnect(); p.disconnect(); };
  }

  const SOUNDS = {
    // own cannon: a hard crack, a chesty body and a low kick — overlapping at the fire rate they make the "brrrt"
    gun(at, v, pan, lp) {
      noiseHit({ at, dur: 0.05, vol: 0.9 * v, f0: Math.min(lp, 2600), f1: 900, q: 1.1, pan });
      noiseHit({ at, dur: 0.09, vol: 1.3 * v, f0: Math.min(lp, 520), f1: 160, type: 'lowpass', pan, buf: brown });
      thump({ at, dur: 0.07, vol: 0.8 * v, f0: 150, f1: 48, pan });
    },
    egun(at, v, pan, lp) {
      noiseHit({ at, dur: 0.06, vol: 0.8 * v, f0: Math.min(lp, 1800), f1: 500, q: 0.9, pan });
      thump({ at, dur: 0.06, vol: 0.4 * v, f0: 120, f1: 50, pan });
    },
    // launch: the motor lights with a thud, then a rising hiss that becomes a fading roar
    missile(at, v, pan, lp) {
      thump({ at, dur: 0.28, vol: 0.7 * v, f0: 90, f1: 32, pan });
      noiseHit({ at, dur: 0.6, vol: 0.55 * v, f0: 350, f1: Math.min(lp, 2600), q: 0.9, pan, attack: 0.03 });
      noiseHit({ at: at + 0.05, dur: 1.6, vol: 0.45 * v, f0: Math.min(lp, 1800), f1: 220, type: 'lowpass', pan, attack: 0.08, verb: 0.4 });
    },
    // explosion: a crack, a body that darkens as it rolls away, a sub-bass punch, and debris crackling after
    boom(at, v, pan, lp) {
      noiseHit({ at, dur: 0.1, vol: 0.6 * v, f0: Math.min(lp, 4000), f1: 1500, type: 'highpass', pan });
      noiseHit({ at, dur: 1.9, vol: 1.1 * v, f0: Math.min(lp, 2800), f1: 90, type: 'lowpass', pan, buf: brown, verb: 0.9, attack: 0.006 });
      noiseHit({ at, dur: 1.2, vol: 0.5 * v, f0: Math.min(lp, 1200), f1: 140, type: 'lowpass', pan, verb: 0.5 });
      thump({ at, dur: 0.9, vol: 0.9 * v, f0: 70, f1: 26, pan });
      for (let i = 0; i < 7; i++) noiseHit({ at: at + 0.12 + Math.random() * 0.9, dur: 0.035, vol: (0.08 + Math.random() * 0.1) * v, f0: Math.min(lp, 3200), q: 1.5, pan: pan + (Math.random() - 0.5) * 0.4 });
    },
    // a round striking something: a short dull crack
    pop(at, v, pan, lp) {
      noiseHit({ at, dur: 0.07, vol: 0.6 * v, f0: Math.min(lp, 2200), f1: 700, q: 1.2, pan });
      noiseHit({ at, dur: 0.16, vol: 0.6 * v, f0: Math.min(lp, 500), f1: 120, type: 'lowpass', pan, buf: brown });
    },
    // rounds hitting your own airframe: a metallic clang that rings for a moment
    hurt(at) {
      noiseHit({ at, dur: 0.1, vol: 0.5, f0: 3000, f1: 1500, type: 'highpass' });
      for (const f of [1720, 2630, 4070]) noiseHit({ at, dur: 0.32, vol: 0.4, f0: f, q: 28 });
      thump({ at, dur: 0.12, vol: 0.5, f0: 110, f1: 60 });
    },
    // a wreck hitting the sea
    splash(at, v, pan, lp) {
      noiseHit({ at, dur: 1.1, vol: 0.7 * v, f0: Math.min(lp, 2400), f1: 500, q: 0.6, pan, attack: 0.01, verb: 0.4 });
      noiseHit({ at, dur: 0.6, vol: 0.5 * v, f0: 380, f1: 90, type: 'lowpass', pan, buf: brown });
    },
  };

  let lastGun = -1;
  function update() {
    const evs = game.events;
    if (!ac || !on) { evs.length = 0; return; }
    const now = ac.currentTime, L = game.lead, cy = Math.cos(L.yaw), sy = Math.sin(L.yaw), view = game.view;
    for (const [type, x, y, z] of evs) {
      if (type === 'gun') { if (now - lastGun < 0.05) continue; lastGun = now; }
      const dx = x - L.x, dy = y - L.y, dz = z - L.z, d = Math.hypot(dx, dy, dz);
      if (d > 1800) continue;
      // further away: quieter, darker, a little later (sound is slow), and to one side
      const v = 1 / (1 + d / 160), lp = 16000 / (1 + d / 120), pan = Math.max(-0.9, Math.min(0.9, (dx * cy + dy * sy) / (d + 40)));
      const at = now + 0.01 + Math.min(0.6, d / 1400);
      SOUNDS[type]?.(at, v, pan, lp);
    }
    evs.length = 0;
    // the jet: louder and brighter with speed and the afterburner; muffled from inside the cockpit; silent when shot down
    const spd = game.speed / game.P.speed, b = game.boost, alive = !game.cb.dead, inside = view === 2, t = now + 0.02, k = 0.12;
    eng.busGain.gain.setTargetAtTime(alive ? 0.9 : 0, t, 0.3);
    eng.bus.frequency.setTargetAtTime(inside ? 900 : 9000, t, 0.4);
    eng.rumF.frequency.setTargetAtTime(180 + 260 * spd + 200 * b, t, k);
    eng.rum.gain.setTargetAtTime(0.2 + 0.18 * b, t, k);
    eng.whF.frequency.setTargetAtTime(2300 + 1400 * spd, t, k);
    eng.wh.gain.setTargetAtTime(inside ? 0.03 : 0.05 + 0.03 * b, t, k);
    eng.roar.gain.setTargetAtTime(0.4 * b, t, k);
    eng.roarF.frequency.setTargetAtTime(500 + 500 * b, t, k);
    eng.windF.frequency.setTargetAtTime(700 + 700 * spd + 500 * L.g, t, k);
    eng.wind.gain.setTargetAtTime(alive ? (inside ? 0.09 : 0.045) * spd + 0.06 * L.g : 0.03, t, k);
    // lock tone
    const lk = game.cb.lock, locked = lk && game.cb.lockT >= 0.8;
    lockOsc.frequency.setTargetAtTime(locked ? 1150 : 470 + 40 * Math.sin(now * 40), t, 0.01);
    lockGain.gain.setTargetAtTime(lk && alive ? (locked ? 0.045 : 0.03 * (0.6 + 0.4 * Math.sin(now * 26))) : 0, t, 0.02);
  }

  return {
    // browsers only allow sound after a touch or a key press
    unlock() { if (!AC) return; if (!ac) init(); if (ac.state === 'suspended') ac.resume(); },
    toggle() { on = !on; if (master) master.gain.setTargetAtTime(on ? 0.8 : 0, ac.currentTime, 0.05); return on; },
    update,
  };
}
