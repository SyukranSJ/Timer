/*
 * bell.js — Web Audio event bell, synthesised locally (no files, no network).
 *
 * The strike is an inharmonic partial stack (the ratios that give a struck
 * metal bell its shimmer) plus a short filtered-noise transient for the
 * initial "clang", pushed through a limiter so it stays loud in a room
 * without clipping.
 */
(function (global) {
  'use strict';

  var ctx = null;
  var bus = null;

  // Bell-like inharmonic series: ratio, relative level, decay seconds.
  var PARTIALS = [
    { r: 0.50, g: 0.30, d: 3.6 }, // hum tone
    { r: 1.00, g: 1.00, d: 3.0 }, // strike note
    { r: 2.01, g: 0.62, d: 2.0 },
    { r: 2.99, g: 0.45, d: 1.3 },
    { r: 4.13, g: 0.26, d: 0.8 },
    { r: 5.42, g: 0.16, d: 0.5 },
    { r: 6.79, g: 0.09, d: 0.3 }
  ];

  var FUNDAMENTAL = 660; // E5 — cuts through room noise without being shrill

  function build() {
    var AC = global.AudioContext || global.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();

    var limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -8;
    limiter.knee.value = 6;
    limiter.ratio.value = 12;
    limiter.attack.value = 0.002;
    limiter.release.value = 0.20;

    bus = ctx.createGain();
    bus.gain.value = 0.9;
    bus.connect(limiter).connect(ctx.destination);
    return ctx;
  }

  /** Create/resume the AudioContext. Must be called from a user gesture. */
  function unlock() {
    if (!ctx && !build()) return null;
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function noiseBuffer(actx) {
    var len = Math.floor(actx.sampleRate * 0.08);
    var buf = actx.createBuffer(1, len, actx.sampleRate);
    var data = buf.getChannelData(0);
    for (var i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    return buf;
  }

  /**
   * Render one bell strike into any AudioContext at time `t`.
   * Kept context-agnostic so it can be rendered and measured offline.
   */
  function renderStrike(actx, dest, t, level) {
    var ctx = actx; // local alias: every node below belongs to `actx`
    PARTIALS.forEach(function (p) {
      var osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(FUNDAMENTAL * p.r, t);
      // Tiny downward glide: struck metal settles slightly in pitch.
      osc.frequency.exponentialRampToValueAtTime(FUNDAMENTAL * p.r * 0.995, t + p.d);

      var g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(Math.max(0.0002, p.g * level * 0.48), t + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, t + p.d);

      osc.connect(g).connect(dest);
      osc.start(t);
      osc.stop(t + p.d + 0.05);
    });

    // Metallic transient.
    var src = ctx.createBufferSource();
    src.buffer = noiseBuffer(ctx);
    var bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = FUNDAMENTAL * 4;
    bp.Q.value = 1.1;
    var ng = ctx.createGain();
    ng.gain.setValueAtTime(0.40 * level, t);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
    src.connect(bp).connect(ng).connect(dest);
    src.start(t);
    src.stop(t + 0.1);
  }

  /**
   * Ring the bell `count` times. Strikes are scheduled on the audio clock,
   * so their spacing is sample-accurate regardless of what the page is doing.
   */
  function ring(count, level) {
    if (!unlock()) return;
    count = count || 1;
    level = level == null ? 1 : level;
    var t0 = ctx.currentTime + 0.02;
    for (var i = 0; i < count; i++) renderStrike(ctx, bus, t0 + i * 0.78, level);
  }

  global.Bell = { unlock: unlock, ring: ring, renderStrike: renderStrike, GAP: 0.78 };
})(window);
