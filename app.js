/*
 * app.js — DOM wiring for the Pitching + Q&A event timer.
 * All timing decisions live in timer-core.js; this file only drives the
 * engine from operator input and paints its snapshot.
 *
 * Two screens: SETUP (presets, durations, Start Event) and TIMER (countdown).
 * The operator flow is: pick a preset -> Start Event -> pitching runs -> one
 * bell at 1:00, two at 0:00 -> "PITCHING TIME'S UP" -> Start Q&A -> the same
 * again -> "Q&A TIME'S UP". Q&A never starts on its own.
 *
 * Branding (logo + event name) is purely presentational: it is read from
 * localStorage at boot, painted into the timer stage, and never consulted by
 * the timing engine.
 */
(function () {
  'use strict';

  var Core = window.EventTimerCore;
  var PHASES = Core.PHASES, STATUS = Core.STATUS, EVENTS = Core.EVENTS;
  var fmt = Core.formatClock;
  var STORE_KEY = 'event-timer/durations';
  var BRAND_KEY = 'event-timer/branding';

  /*
   * The logo is persisted as a data URL inside localStorage, which is the only
   * offline-safe store an unhosted file:// page can rely on. Its quota is
   * ~5 MB of UTF-16, so a data URL much over ~1.5 MB risks a quota error (and
   * would be pointlessly heavy for a projected logo anyway).
   */
  var MAX_LOGO_BYTES = 1.5 * 1024 * 1024;
  var LOGO_RE = /\.(png|jpe?g|svg|webp)$/i;
  var LOGO_TYPE_RE = /^image\/(png|jpeg|svg\+xml|webp)$/;
  var DEFAULT_NOTE = 'PNG, JPG, SVG or WebP. Kept on this computer only \u2014 nothing is uploaded.';

  // Reset is destructive mid-event, so the first press only arms it.
  var RESET_ARM_MS = 4000;

  var $ = function (id) { return document.getElementById(id); };
  var el = {
    root: document.documentElement,
    status: $('status-pill'),
    phaseIcon: $('phase-icon'),
    phase: $('phase-label'),
    clock: $('clock'),
    banner: $('banner'),
    progress: $('progress-fill'),
    duration: $('meta-duration'),
    next: $('meta-next'),
    elapsed: $('meta-elapsed'),
    startEvent: $('btn-start-event'),
    primary: $('btn-primary'),
    startQA: $('btn-startqa'),
    skipQA: $('btn-skipqa'),
    restart: $('btn-restart'),
    reset: $('btn-reset'),
    fullscreen: $('btn-fullscreen'),
    testBell: $('btn-testbell'),
    pitchingInput: $('input-pitching'),
    qaInput: $('input-qa'),

    logoFile: $('input-logo-file'),
    logoPreview: $('logo-preview'),
    logoPreviewImg: $('logo-preview-img'),
    logoPlaceholder: $('logo-placeholder'),
    logoRemove: $('btn-logo-remove'),
    logoShow: $('input-logo-show'),
    logoTop: $('btn-logo-top'),
    logoBottom: $('btn-logo-bottom'),
    logoNote: $('logo-note'),
    eventNameInput: $('input-event-name'),
    brandBlock: $('event-brand'),
    eventLogo: $('event-logo'),
    eventName: $('event-name'),
    presets: document.querySelectorAll('[data-preset]')
  };

  var saved = loadDurations();
  var branding = loadBranding();
  var timer = new Core.EventTimer({ pitchingMs: saved.pitching, qaMs: saved.qa });
  var screen = 'setup';        // 'setup' | 'timer'
  var resetArmedUntil = 0;     // epoch ms; 0 = not armed
  var wakeLock = null;

  /* -------------------------------------------------------- persistence */

  function loadDurations() {
    var fallback = { pitching: 5 * 60000, qa: 5 * 60000 };
    try {
      var raw = JSON.parse(localStorage.getItem(STORE_KEY));
      if (!raw) return fallback;
      return {
        pitching: clampMs(raw.pitching) || fallback.pitching,
        qa: clampMs(raw.qa) || fallback.qa
      };
    } catch (e) { return fallback; }
  }

  function saveDurations() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({
        pitching: timer.durations[PHASES.PITCHING],
        qa: timer.durations[PHASES.QA]
      }));
    } catch (e) { /* private mode — durations simply won't persist */ }
  }

  function loadBranding() {
    var fallback = { logo: '', name: '', show: true, position: 'top' };
    try {
      var raw = JSON.parse(localStorage.getItem(BRAND_KEY));
      if (!raw) return fallback;
      return {
        logo: typeof raw.logo === 'string' ? raw.logo : '',
        name: typeof raw.name === 'string' ? raw.name.slice(0, 60) : '',
        show: raw.show !== false,                                  // default on
        position: raw.position === 'bottom' ? 'bottom' : 'top'     // default top
      };
    } catch (e) { return fallback; }
  }

  // Returns false when the browser refused to store it (private mode, quota).
  function saveBranding() {
    try {
      localStorage.setItem(BRAND_KEY, JSON.stringify(branding));
      return true;
    } catch (e) { return false; }
  }

  function clampMs(ms) {
    if (typeof ms !== 'number' || !isFinite(ms)) return 0;
    return Math.min(120 * 60000, Math.max(30000, Math.round(ms)));
  }

  /* -------------------------------------------------------------- audio */

  function handleEvent(evt) {
    if (evt === EVENTS.WARNING) window.Bell.ring(1);
    else if (evt === EVENTS.PHASE_END) window.Bell.ring(2);
  }

  /* ------------------------------------------------------------ actions */

  function now() { return Date.now(); }

  function disarmReset() { resetArmedUntil = 0; }

  // Start the whole event: pitching, from the top. Also the audio unlock
  // gesture, so the first bell is never swallowed by autoplay policy.
  function startEvent() {
    window.Bell.unlock();
    timer.reset();
    timer.start(now());
    screen = 'timer';
    disarmReset();
    render();
  }

  function goToSetup() {
    timer.reset();
    screen = 'setup';
    disarmReset();
    syncInputs();
    render();
  }

  // Space: whatever the single big button in front of the operator does.
  function primaryAction() {
    window.Bell.unlock();
    disarmReset();
    if (screen === 'setup') { startEvent(); return; }
    if (timer.status === STATUS.PHASE_ENDED) { doStartQA(); return; }
    if (timer.status === STATUS.FINISHED) { goToSetup(); return; }
    timer.toggle(now());
    render();
  }

  // Only available once pitching has actually ended — no accidental jumps.
  function qaAvailable() {
    return screen === 'timer' && timer.status === STATUS.PHASE_ENDED;
  }

  function doStartQA() {
    if (!qaAvailable()) return;
    window.Bell.unlock();
    timer.startQA(now());
    disarmReset();
    render();
  }

  function doSkipQA() {
    if (screen !== 'timer' || timer.phase !== PHASES.PITCHING) return;
    timer.skipToQA();
    disarmReset();
    render();
  }

  function doRestartPhase() {
    if (screen !== 'timer') return;
    timer.restartPhase(now(), false);
    disarmReset();
    render();
  }

  // First press arms, second confirms; the arming lapses on its own.
  function requestReset() {
    if (resetArmedUntil && now() < resetArmedUntil) { goToSetup(); return; }
    resetArmedUntil = now() + RESET_ARM_MS;
    render();
  }

  function applyDuration(phase, minutes) {
    timer.setDuration(phase, clampMs(minutes * 60000));
    saveDurations();
    render();
  }

  function syncInputs() {
    el.pitchingInput.value = round1(timer.durations[PHASES.PITCHING] / 60000);
    el.qaInput.value = round1(timer.durations[PHASES.QA] / 60000);
  }

  function round1(n) { return Math.round(n * 10) / 10; }

  /* ----------------------------------------------------------- branding */

  function setNote(text, warn) {
    el.logoNote.textContent = text;
    el.logoNote.classList.toggle('is-warn', !!warn);
  }

  /*
   * Branding never changes on its own, so it is painted on demand rather than
   * from the 50 ms loop — the countdown path stays untouched.
   */
  function renderBranding() {
    var hasLogo = !!branding.logo;
    var showLogo = hasLogo && branding.show;

    // Setup preview: the image, or the "YOUR LOGO" placeholder.
    if (hasLogo && el.logoPreviewImg.src !== branding.logo) el.logoPreviewImg.src = branding.logo;
    el.logoPreviewImg.hidden = !hasLogo;
    el.logoPlaceholder.hidden = hasLogo;
    el.logoRemove.hidden = !hasLogo;

    // Timer stage. The src is left in place when hidden so re-showing it
    // never flashes an empty box.
    if (showLogo && el.eventLogo.src !== branding.logo) el.eventLogo.src = branding.logo;
    el.eventLogo.hidden = !showLogo;
    el.eventName.textContent = branding.name;
    el.eventName.hidden = !branding.name;

    var anyBrand = showLogo || !!branding.name;
    el.brandBlock.hidden = !anyBrand;

    // Drives logo placement and the small trim to the clock's size.
    el.root.setAttribute('data-logo-pos', branding.position);
    el.root.setAttribute('data-brand', anyBrand ? 'on' : 'off');

    el.logoTop.classList.toggle('is-on', branding.position === 'top');
    el.logoBottom.classList.toggle('is-on', branding.position === 'bottom');
  }

  function syncBrandingInputs() {
    el.eventNameInput.value = branding.name;
    el.logoShow.checked = branding.show;
  }

  function acceptLogoFile(file) {
    if (!file) return;
    if (!LOGO_TYPE_RE.test(file.type || '') && !LOGO_RE.test(file.name || '')) {
      setNote('Unsupported file. Use a PNG, JPG, SVG or WebP image.', true);
      return;
    }
    if (file.size > MAX_LOGO_BYTES) {
      setNote('That image is ' + (file.size / 1048576).toFixed(1) + ' MB. Use one under 1.5 MB '
        + 'so it can be stored on this computer.', true);
      return;
    }

    var reader = new FileReader();
    reader.onerror = function () { setNote('That file could not be read.', true); };
    reader.onload = function () {
      branding.logo = String(reader.result || '');
      var stored = saveBranding();
      renderBranding();
      setNote(stored
        ? 'Logo saved on this computer \u2014 it will still be here next time you open this file.'
        : 'Logo applied, but this browser would not store it. It will be lost when the page closes.',
        !stored);
    };
    reader.readAsDataURL(file);   // a data URL survives a reload; blob URLs do not
  }

  function setLogoPosition(pos) {
    branding.position = pos === 'bottom' ? 'bottom' : 'top';
    saveBranding();
    renderBranding();
  }

  /* ----------------------------------------------------------- rendering */

  var STATUS_TEXT = {};
  STATUS_TEXT[STATUS.READY] = 'Ready';
  STATUS_TEXT[STATUS.RUNNING] = 'Running';
  STATUS_TEXT[STATUS.PAUSED] = 'Paused';
  STATUS_TEXT[STATUS.PHASE_ENDED] = "Time's up";
  STATUS_TEXT[STATUS.FINISHED] = "Time's up";

  // Cached so the 50 ms loop only touches the DOM when something changed.
  var lastClock = '', lastBanner = '', lastPrimary = '', lastReset = '';

  function render() {
    var s = timer.snapshot(now());
    var isQA = s.phase === PHASES.QA;
    var ended = s.status === STATUS.PHASE_ENDED || s.status === STATUS.FINISHED;

    if (resetArmedUntil && now() >= resetArmedUntil) resetArmedUntil = 0;

    var visual = 'normal';
    if (ended) visual = 'ended';
    else if (s.inWarning) visual = 'warning';

    el.root.setAttribute('data-screen', screen);
    el.root.setAttribute('data-state', visual);
    el.root.setAttribute('data-phase', s.phase);
    el.root.setAttribute('data-status', s.status);

    var text = fmt(s.remainingMs);
    if (text !== lastClock) { el.clock.textContent = text; lastClock = text; }

    el.phase.textContent = isQA ? 'Q&A' : 'PITCHING';
    el.phaseIcon.textContent = isQA ? '❓' : '🎤';

    el.status.textContent = STATUS_TEXT[s.status];
    el.duration.textContent = fmt(s.durationMs);
    el.elapsed.textContent = fmt(s.elapsedMs);
    el.progress.style.width = (s.progress * 100).toFixed(2) + '%';

    if (ended) el.next.textContent = isQA ? '—' : 'Start Q&A';
    else if (s.warningArmed) el.next.textContent = 'Bell at 01:00';
    else el.next.textContent = 'Two bells at 00:00';

    if (s.status === STATUS.FINISHED) {
      showBanner("Q&A TIME'S UP", 'End of session');
    } else if (s.status === STATUS.PHASE_ENDED) {
      showBanner("PITCHING TIME'S UP", 'Press Start Q&A when the moderator is ready');
    } else if (s.status === STATUS.PAUSED) {
      showBanner('PAUSED', 'Press Space or Resume to continue');
    } else if (s.inWarning) {
      showBanner('1 MINUTE LEFT', '');
    } else {
      el.banner.hidden = true;
    }

    renderPresets();
    renderControls(s);
  }

  function showBanner(title, note) {
    var markup = '<strong>' + title + '</strong>' + (note ? '<span>' + note + '</span>' : '');
    el.banner.hidden = false;
    if (markup !== lastBanner) { el.banner.innerHTML = markup; lastBanner = markup; }
  }

  function renderPresets() {
    var p = timer.durations[PHASES.PITCHING], q = timer.durations[PHASES.QA];
    Array.prototype.forEach.call(el.presets, function (btn) {
      var ms = parseFloat(btn.dataset.preset) * 60000;
      btn.classList.toggle('is-selected', p === ms && q === ms);
    });
  }

  /*
   * One big button is correct at any moment; everything else is a quiet
   * secondary control, and controls that cannot act right now are hidden
   * rather than shown disabled.
   */
  function renderControls(s) {
    var handover = s.status === STATUS.PHASE_ENDED;
    var finished = s.status === STATUS.FINISHED;
    var onTimer = screen === 'timer';

    el.startQA.hidden = !(onTimer && handover);
    el.primary.hidden = !onTimer || handover;

    var label = 'Start';
    if (s.status === STATUS.RUNNING) label = 'Pause';
    else if (s.status === STATUS.PAUSED) label = 'Resume';
    else if (finished) label = 'New Event';
    else if (s.phase === PHASES.QA) label = 'Start Q&A';
    var markup = label + '<kbd>Space</kbd>';
    if (markup !== lastPrimary) { el.primary.innerHTML = markup; lastPrimary = markup; }

    // Skip to Q&A only means something while pitching is still on the clock.
    el.skipQA.hidden = !onTimer || s.phase !== PHASES.PITCHING || handover;
    el.restart.hidden = !onTimer;
    el.reset.hidden = !onTimer || finished;

    var armed = !!resetArmedUntil;
    var resetLabel = armed ? 'Press again to reset' : 'Reset<kbd>R</kbd>';
    if (resetLabel !== lastReset) { el.reset.innerHTML = resetLabel; lastReset = resetLabel; }
    el.reset.classList.toggle('is-armed', armed);

    el.restart.textContent = s.phase === PHASES.QA ? 'Restart Q&A' : 'Restart Pitching';
  }

  /* ---------------------------------------------------------- main loop */

  // 50 ms keeps the readout and progress bar smooth; every alert decision is
  // made from timestamps inside tick(), so a throttled tab cannot skip a bell.
  function step() {
    timer.tick(now()).forEach(handleEvent);
    render();
  }
  setInterval(step, 50);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) step(); });

  /* -------------------------------------------------------- screen wake */

  function updateWakeLock() {
    if (!('wakeLock' in navigator)) return;
    if (timer.isRunning() && !wakeLock) {
      navigator.wakeLock.request('screen').then(function (lock) {
        wakeLock = lock;
        lock.addEventListener('release', function () { wakeLock = null; });
      }).catch(function () { /* unsupported or denied — harmless */ });
    } else if (!timer.isRunning() && wakeLock) {
      wakeLock.release().catch(function () {});
      wakeLock = null;
    }
  }
  setInterval(updateWakeLock, 1000);
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) updateWakeLock();
  });

  /* -------------------------------------------------------------- events */

  el.startEvent.addEventListener('click', startEvent);
  el.primary.addEventListener('click', primaryAction);
  el.startQA.addEventListener('click', doStartQA);
  el.skipQA.addEventListener('click', doSkipQA);
  el.restart.addEventListener('click', doRestartPhase);
  el.reset.addEventListener('click', requestReset);
  el.testBell.addEventListener('click', function () { window.Bell.unlock(); window.Bell.ring(1); });
  el.fullscreen.addEventListener('click', toggleFullscreen);

  el.pitchingInput.addEventListener('change', function () {
    applyDuration(PHASES.PITCHING, parseFloat(this.value) || 5);
    syncInputs();
  });
  el.qaInput.addEventListener('change', function () {
    applyDuration(PHASES.QA, parseFloat(this.value) || 5);
    syncInputs();
  });

  el.logoFile.addEventListener('change', function () {
    var file = this.files && this.files[0];
    this.value = '';                       // so re-picking the same file re-fires
    acceptLogoFile(file);
  });

  el.logoRemove.addEventListener('click', function () {
    branding.logo = '';
    saveBranding();
    renderBranding();
    setNote(DEFAULT_NOTE, false);
  });

  el.logoShow.addEventListener('change', function () {
    branding.show = !!this.checked;
    saveBranding();
    renderBranding();
  });

  el.logoTop.addEventListener('click', function () { setLogoPosition('top'); });
  el.logoBottom.addEventListener('click', function () { setLogoPosition('bottom'); });

  function onEventNameInput() {
    branding.name = String(this.value || '').slice(0, 60);
    saveBranding();
    renderBranding();
  }
  el.eventNameInput.addEventListener('input', onEventNameInput);
  el.eventNameInput.addEventListener('change', onEventNameInput);

  Array.prototype.forEach.call(el.presets, function (btn) {
    btn.addEventListener('click', function () {
      var mins = parseFloat(btn.dataset.preset);
      timer.setDuration(PHASES.PITCHING, mins * 60000);
      timer.setDuration(PHASES.QA, mins * 60000);
      saveDurations();
      syncInputs();
      render();
    });
  });

  function toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen().catch(function () {});
  }

  /* --------------------------------------------------------- keyboard */

  function isTyping(target) {
    if (!target) return false;
    var tag = target.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
  }

  document.addEventListener('keydown', function (e) {
    if (isTyping(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;

    switch (e.key) {
      case ' ':
      case 'Spacebar':
        e.preventDefault();   // stop the page scrolling / re-firing a focused button
        primaryAction();
        break;
      case 'r': case 'R':
        e.preventDefault();
        if (screen === 'timer') requestReset();   // two presses, never one
        break;
      case 'q': case 'Q': e.preventDefault(); doStartQA(); break;
      case 's': case 'S': e.preventDefault(); doSkipQA(); break;
      case 'f': case 'F': e.preventDefault(); toggleFullscreen(); break;
      case 'Escape': disarmReset(); render(); break;
    }
  });

  /* ------------------------------------------------------------- start */

  syncInputs();
  syncBrandingInputs();
  renderBranding();
  render();
})();
