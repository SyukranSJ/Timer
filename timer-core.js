/*
 * timer-core.js — pure, DOM-free timing engine for the Pitching + Q&A event timer.
 *
 * Design notes:
 *  - Time is never decremented. A running phase stores an absolute `endTime`
 *    (ms epoch); remaining time is always `endTime - now`. Pausing freezes the
 *    remaining value; resuming recomputes a fresh `endTime`.
 *  - Audio alerts are emitted by `tick()` as *threshold crossings*, guarded by
 *    one-shot flags (`warned`, `ended`) that live on the phase. Rendering
 *    frequency therefore has no effect on how many times a bell fires.
 *  - Exposed on `globalThis.EventTimerCore` so it works both as a plain
 *    <script> on file:// and via require() in Node for the test suite.
 */
(function (global) {
  'use strict';

  var PHASES = { PITCHING: 'pitching', QA: 'qa' };

  var STATUS = {
    READY: 'ready',             // configured, not started
    RUNNING: 'running',
    PAUSED: 'paused',
    PHASE_ENDED: 'phase-ended', // pitching hit 0:00, waiting for the moderator
    FINISHED: 'finished'        // Q&A hit 0:00 — TIME'S UP
  };

  var EVENTS = {
    WARNING: 'warning',     // one bell  — 1:00 remaining
    PHASE_END: 'phase-end'  // two bells — 0:00
  };

  var WARNING_MS = 60 * 1000;

  function EventTimer(options) {
    options = options || {};
    this.durations = {};
    this.durations[PHASES.PITCHING] = options.pitchingMs != null ? options.pitchingMs : 5 * 60 * 1000;
    this.durations[PHASES.QA] = options.qaMs != null ? options.qaMs : 5 * 60 * 1000;
    this.reset();
  }

  /* ---------------------------------------------------------------- state */

  // Move to `phase` in a clean, un-started state. This is the single place
  // where alert flags are cleared, so every entry point (reset, restart,
  // start Q&A, skip to Q&A) resets alerts consistently.
  EventTimer.prototype._enterPhase = function (phase) {
    this.phase = phase;
    this.status = STATUS.READY;
    this.endTime = null;
    this.remainingMs = this.durations[phase];
    this.warned = false;
    this.ended = false;
  };

  EventTimer.prototype.reset = function () {
    this._enterPhase(PHASES.PITCHING);
  };

  EventTimer.prototype.durationMs = function () {
    return this.durations[this.phase];
  };

  EventTimer.prototype.isRunning = function () {
    return this.status === STATUS.RUNNING;
  };

  // Changing a duration always re-arms that phase from scratch. If the phase
  // being edited is not the current one, only the stored duration changes.
  EventTimer.prototype.setDuration = function (phase, ms) {
    ms = Math.max(1000, Math.round(ms));
    this.durations[phase] = ms;
    if (phase === this.phase) this._enterPhase(phase);
    return ms;
  };

  /* ------------------------------------------------------------- controls */

  EventTimer.prototype.start = function (now) {
    if (this.status !== STATUS.READY && this.status !== STATUS.PAUSED) return false;
    if (this.remainingMs <= 0) return false;
    this.endTime = now + this.remainingMs;
    this.status = STATUS.RUNNING;
    return true;
  };

  EventTimer.prototype.pause = function (now) {
    if (this.status !== STATUS.RUNNING) return false;
    this.remainingMs = Math.max(0, this.endTime - now);
    this.endTime = null;
    this.status = STATUS.PAUSED;
    return true;
  };

  EventTimer.prototype.toggle = function (now) {
    return this.status === STATUS.RUNNING ? this.pause(now) : this.start(now);
  };

  // Re-arm the current phase at its full duration (alerts armed again).
  EventTimer.prototype.restartPhase = function (now, autoStart) {
    this._enterPhase(this.phase);
    if (autoStart) this.start(now);
  };

  // Move to Q&A and begin immediately (the "Start Q&A" button).
  EventTimer.prototype.startQA = function (now) {
    this._enterPhase(PHASES.QA);
    return this.start(now);
  };

  // Move to Q&A but stay ready — the moderator starts it when they choose.
  EventTimer.prototype.skipToQA = function () {
    this._enterPhase(PHASES.QA);
  };

  /* ----------------------------------------------------------------- tick */

  /**
   * Advance the clock and return any audio events that were crossed.
   * Safe to call at any frequency, including after a long tab stall.
   * @returns {string[]} zero or more EVENTS values
   */
  EventTimer.prototype.tick = function (now) {
    if (this.status !== STATUS.RUNNING) return [];

    var events = [];
    var remaining = this.endTime - now;

    if (remaining <= 0) {
      this.remainingMs = 0;
      this.endTime = null;
      this.status = this.phase === PHASES.PITCHING ? STATUS.PHASE_ENDED : STATUS.FINISHED;
      if (!this.ended) {
        this.ended = true;
        events.push(EVENTS.PHASE_END);
      }
      return events;
    }

    this.remainingMs = remaining;

    // Fire once, only if the phase is actually longer than the warning point.
    if (!this.warned && this.durationMs() > WARNING_MS && remaining <= WARNING_MS) {
      this.warned = true;
      events.push(EVENTS.WARNING);
    }
    return events;
  };

  /* -------------------------------------------------------------- readout */

  EventTimer.prototype.snapshot = function (now) {
    var remaining = this.status === STATUS.RUNNING
      ? Math.max(0, this.endTime - now)
      : Math.max(0, this.remainingMs);
    var duration = this.durationMs();
    return {
      phase: this.phase,
      status: this.status,
      remainingMs: remaining,
      durationMs: duration,
      elapsedMs: duration - remaining,
      progress: duration > 0 ? Math.min(1, (duration - remaining) / duration) : 1,
      warningArmed: !this.warned && duration > WARNING_MS,
      inWarning: remaining > 0 && remaining <= WARNING_MS && duration > WARNING_MS
    };
  };

  /* ------------------------------------------------------------ formatting */

  // Ceil so a 5:00 phase reads "05:00" on the first frame and only shows
  // "00:00" once the phase has genuinely expired.
  function formatClock(ms) {
    var total = Math.max(0, Math.ceil(ms / 1000));
    var m = Math.floor(total / 60);
    var s = total % 60;
    return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
  }

  global.EventTimerCore = {
    EventTimer: EventTimer,
    PHASES: PHASES,
    STATUS: STATUS,
    EVENTS: EVENTS,
    WARNING_MS: WARNING_MS,
    formatClock: formatClock
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
