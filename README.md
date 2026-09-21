# Pitching + Q&A Event Timer

A two-phase event timer (Pitching → Q&A) for moderating pitch sessions.
Vanilla HTML/CSS/JS, no build step, no backend, works offline.

## Run

Open `index.html` in any modern browser. For a single portable file to copy
onto an event laptop, run `node build.js` and use `standalone.html`.

Press **F** (or the Fullscreen button) for projector display.

## Event workflow

1. **Setup screen** — tap a preset (5+5 / 7+7 / 10+10) or type custom minutes.
2. Press **START EVENT** — pitching begins immediately.
3. At **1:00** → one bell, screen turns amber: *1 MINUTE LEFT*.
4. At **0:00** → two bells, screen turns red: *PITCHING TIME'S UP*.
5. Q&A does **not** start on its own. Press **START Q&A** when the moderator
   is ready (the only big button on screen at that moment).
6. Q&A repeats the same two alerts and ends with *Q&A TIME'S UP*.
7. **New Event** returns to setup with the durations kept.

The phase is always shown as a large badge — 🎤 **PITCHING** (blue) or
❓ **Q&A** (teal) — and the phase colour never changes with the countdown
state, so the phase stays readable during a warning or time's up.

### Screen priority

Remaining time → phase → warning / time's up → controls → everything else.
While the countdown is running, only Pause and three small secondary controls
are shown; the keyboard hints hide themselves.

### Keyboard

| Key | Action |
| --- | --- |
| `Space` | The big button: Start Event → Pause / Resume → Start Q&A → New Event |
| `Q` | Start Q&A (only once pitching has ended) |
| `S` | Skip to Q&A (arms Q&A without starting it) |
| `R` `R` | Reset — **press twice**; one press only arms it |
| `Esc` | Cancel an armed reset |
| `F` | Fullscreen |

Shortcuts are ignored while a duration field has focus.

### Guards against accidents during a live event

- Reset needs two presses (button or `R`), shows *Press again to reset*, and
  disarms itself after 4 seconds. `Esc` cancels it.
- `Q` does nothing until pitching has actually ended, so the timer cannot jump
  phases on a stray keypress.
- Controls that cannot act right now are hidden, not shown disabled.

## Event branding (optional)

The **Branding** panel on the setup screen adds an event logo and name to the
timer screen. Both are optional and neither touches the timer.

- **Upload Logo** — PNG, JPG/JPEG, SVG or WebP from the local disk. A preview
  appears in the panel; before that the slot shows a *YOUR LOGO* placeholder.
- **Remove Logo** — clears it (only shown once a logo is set).
- **Show Logo** — hides the logo without discarding it.
- **Position** — *Top* (default) or *Bottom* of the timer stage.
- **Event Name** — e.g. `BioInnovation Launchpad 2026`, shown small and muted
  directly under the logo.

On the timer screen the block renders as:

```
    [ EVENT LOGO ]
  BIOINNOVATION LAUNCHPAD 2026

      🎤 PITCHING

          04:32
```

The countdown stays the dominant element. The logo is height-capped
(`--logo-size`, roughly 7.5 vh and larger in fullscreen) with `width: auto` and
`object-fit: contain`, so any aspect ratio is preserved and never stretched.
When branding is on, the clock gives back a little of its size
(`html[data-brand="on"]`) so the stage still fits without scrolling on a 1366×768
laptop or a 720p projector; below 560 px tall the event name drops out entirely.
With no branding set, the timer screen is pixel-identical to before.

### Persistence

The logo is read as a **data URL** and stored in `localStorage` under
`event-timer/branding`, alongside the name, visibility and position. Chrome,
Edge, Firefox and Safari all give `file://` pages a working `localStorage`, so
closing and reopening `standalone.html` on the same computer brings the logo
back. Nothing is uploaded and nothing is fetched — the app stays fully offline.

Limitations worth knowing before the event:

- Storage is per browser and per computer. Copying `standalone.html` to another
  laptop does not carry the logo with it; upload it again there.
- The quota is roughly 5 MB, so files over **1.5 MB** are refused with a message
  asking for a smaller one. A projected logo never needs more.
- Private/incognito windows, and browsers with site data disabled, may refuse to
  store it. The logo still works for the session; the panel says so explicitly
  rather than failing silently.

## Audio

The bell is synthesised with the Web Audio API — an inharmonic partial stack
plus a filtered-noise strike transient, through a limiter so it carries in a
room. No audio files, nothing fetched. Rendered offline and measured: peak
0.83 with zero clipped samples, still ringing at 2.2 s.

Browsers block audio until a user gesture, so the context is unlocked on the
first **Start Event** or **Test Bell** click; press **Test Bell** once before
the event.

## Accuracy

The timer never decrements a counter. A running phase stores an absolute
`endTime` and every frame computes `remaining = endTime - Date.now()`, so a
throttled or stalled tab cannot drift. Alerts are emitted by threshold
*crossings* guarded by one-shot flags, so update frequency, pausing, and
background-tab throttling can never duplicate or skip a bell.

## Files

| File | Role |
| --- | --- |
| `timer-core.js` | Pure, DOM-free timing engine (phases, alert crossings) |
| `bell.js` | Web Audio bell synthesis |
| `app.js` | Screen flow, DOM wiring, rendering, branding |
| `styles.css` | Projector-first dark UI, branding layout |
| `build.js` | Produces `standalone.html` |

## Tests

```
node test/timer-core.test.js      # engine: 15 tests
node test/app-integration.test.js # real app.js against a DOM stub: 25 tests
```

Both run on a virtual clock, so full 5/7/10-minute phases are verified
instantly. Covered: a complete 5+5, 7+7 and 10+10 walkthrough (pitching
1:00 → 0:00 → handover → Q&A 1:00 → 0:00), pause and resume across 1:00,
the two-press reset and its lapse, guarded `Q`, sub-minute durations,
250 Hz update rates, and a long tab stall jumping past both thresholds.
