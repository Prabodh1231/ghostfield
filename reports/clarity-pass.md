# Clarity pass

Goal: a first-time visitor understands GhostField in 30 seconds. Only UI text, layout, legend, home page and `pages.yml` changed. No solver, coefficient, shader, test or `ci.yml` change.

## New URLs

| Page | URL |
|---|---|
| Home (new) | https://prabodh1231.github.io/ghostfield/ |
| Wi-Fi app (moved) | https://prabodh1231.github.io/ghostfield/wifi/ |
| Bass app (same) | https://prabodh1231.github.io/ghostfield/bass/ |

The old Wi-Fi address (`/`) now shows the home page. `pages.yml` builds both apps, copies `site-src/index.html` to `site/`, Wi-Fi to `site/wifi/`, bass to `site/bass/`.

## Home page (new, `site-src/index.html`)

- One sentence: "GhostField simulates invisible waves in a room, in your browser, so you can see where Wi-Fi is weak and where bass booms or vanishes."
- Why it is cool: one physics engine for radio waves and sound.
- Two cards: "Find the dead zone in your flat" (to `wifi/`), "Find where bass booms in your room" (to `bass/`).

## Wi-Fi app: before / after

| Where | Before | After |
|---|---|---|
| Title | GhostField: Wi-Fi dead zones | Find the dead zone in your flat (+ "Back to home" link, one-line explainer) |
| Top note | 2D model of a 2.4 GHz router. Not a calibrated measurement... | Moved below the legend, small: "numbers are relative, not real dBm. Real rooms are 3D..." |
| How to use | none | 1 Draw walls. 2 Drag the green dot (router). 3 Bright = strong, dark = weak or dead |
| Backend line | Backend: CPU (Web Worker) · 256×256 cells @ 2.5 cm · WebGPU not used: ... | Small line at the bottom: "Running on: your processor. Grid 256x256, room N m wide." |
| Legend title | Relative signal (2D model) | Signal strength |
| Legend ends | -60 dB / 0 dB | Dead (-60 dB) / Weak / Strong (0 dB) |
| Legend note | 0 dB = the average level on a ring 0.5 m around the router. Time-averaged abs(Ez)^2... | Compared with the signal right next to the router (0 dB). Every -10 dB is ten times weaker. |
| Buttons | Example flat / Run again | Back to example flat / Redraw map |
| Help line | Drag the green router. Draw a wall... | The map redraws a moment after each change. Hold Shift for a straight wall. |
| Status | Detecting backend... | Starting up... |

First load: the example flat already runs and paints the map (unchanged behavior).

## Bass app: before / after

| Where | Before | After |
|---|---|---|
| Title | GhostField: bass ghost finder | Find where bass booms in your room (+ "Back to home", one-line explainer) |
| Top note | Horizontal modes (2D plan view...). Thin foam does little below 300 Hz... | Small honest note: top-down view, side-to-side booms only, model not measurement, thin foam does little for deep bass |
| How to use | none | 1 Drag SUB and SEAT. 2 Click an orange dot on the chart. 3 Red = boom, blue = quiet; add foam |
| Trap buttons | Trap (drag on the plan): 5 cm PU foam (Rf 5,000) / 60 cm corner superchunk (Rf 10,000) | Bass trap (drag on the map): Foam panel (5 cm) / Big corner block (60 cm) |
| Legend ends | null (quiet, -40 dB) / boom (loud, 0 dB) | Quiet (null) / Medium / Boom (loud); small: blue is 40 dB (10,000x less power) below red |
| Legend text | Map at N Hz. Drag SUB or SEAT. Orange = foam, purple = superchunk. | Map of one note: N Hz. ... Orange = foam panel, purple = corner block. Dark grey = wall. |
| Chart text | Response at the seat, dB relative to the highest peak. Click a peak to see its mode shape. | What you hear at SEAT for each note, compared with the loudest. Dips vanish, orange dots boom. Click a dot to see where it booms. |
| Level text | +x dB vs the room median | +x dB louder than a typical spot in the room |
| Sound menu | Laptop mode (harmonic stack) / Normal (the low tone itself) | Laptop speakers (adds higher tones so you can hear it) / Normal (the pure low tone) |
| Backend line | Backend: CPU (Web Worker), cell 2.5 cm, grid ... (reason) | Small: "Running on: your processor, grid NxN" |
| Status | Measuring the room response... / ...booms and nulls... | Measuring how the room sounds... / ...booms and quiet spots... |

First load: the default room already runs and paints the map and chart (unchanged behavior).

## Checked

- `pnpm --filter wifi-deadzone build` and `bass-ghost-finder build` pass; `tsc --noEmit` gives no errors for both.
- Assembled `site/` by hand as `pages.yml` does: `index.html`, `wifi/` (assets use `./` paths), `bass/`.

## Not checked

- Nothing was opened in a browser: layout, wrapping on a phone, colors, and the back link are untested.
- Live URLs only exist after merge and the Pages run.
- Tests were not run (no physics code changed; memory was low).
- Old links to the Wi-Fi app at `/` now land on the home page.
- Wi-Fi legend colors are dark to yellow, not red (the how-to says "bright = strong").
