# Radar look for the Wi-Fi and bass apps

Branch `feat/radar-apps` (from origin/main 92dde83). Only `apps/wifi-deadzone/**` and `apps/bass-ghost-finder/**` changed.

## What changed (both apps)
1. **Palette.** Maps use `ramp()` from `@ui` (#05070B to #38F2D6), cubed so the middle of the range is not all bright teal. Legends use the same ramp. Alert red #FF3B5C is used with a **shape**: diagonal stripes (Wi-Fi dead zones, bass boom spots) and red diamonds on the bass chart.
2. **Full-bleed canvas + floating dock.** Map fills the window (it leaves 130 px at the bottom so the dock never hides the map). Title chip, "?" panel (3 steps, honest 2D note, backend), legend always in the dock, first-run "Click anywhere to ping" hint that fades on the first click.
3. **Click-to-ping.** `createLiveSim` pulse, drawn with `createAfterglow(…, 0.94)` and the `@ui` `thump()`. A click that is not a drag pings (bass default tool is "Ping"). Wi-Fi says on screen how much it is slowed down. The number is computed, not fixed: about **72 million times** (GPU), not "a billion". Bass: about 80 times.
4. **Before/after wipe.** First edit after a settled map copies that map; when the new map arrives a Before/After slider appears.
5. **Mission pills (3 per app, ticked on detection).** Wi-Fi: hover a dead zone; move router and touch the wipe slider; ping. Bass: click a peak diamond; add a trap and the level at the seat drops 3 dB or more at the map note; touch the wipe slider.
6. **"Use my floor plan".** `importSketch` with file input, 2-click scale bar, metres box, 15% underlay (`drawUnderlay`). Wi-Fi: walls become brick cells. Bass: walls are added to the room's solid cells; SUB and SEAT move to the nearest free floor.
7. **Motion.** `prefers-reduced-motion`: no wave animation (thump and a note only), CSS transitions off. The animation loop is in a class (`Pinger` in `radar.tsx`) with `requestAnimationFrame`, no React state per frame. It does nothing in a hidden tab and stops by itself when the wave and trail are gone.

Other edits: `@ui` alias in each app's `vite.config.ts` and `tsconfig.json`. `Scene.imported` added in each `scene.ts` (Wi-Fi `buildJob`, bass `buildRoom`). `radar.tsx` and `styles.css` are the same file in both apps (shared code would have to live in `packages/**`, not mine). Wi-Fi dead-zone limit moved from -45 dB to -30 dB, because at -45 the example flat showed almost nothing; "medium" is now above -20 dB. The absorbing edge layer is no longer striped red.

## Cut
Nothing from the cut list. Photo underlay is fixed at 15% (no slider).

## Checks run
- `tsc --noEmit` both apps: clean. `vite build` both apps: pass.
- Wi-Fi `vitest run` (materials, shadow): 3 pass. Bass `tests/scene.test.ts`: 5 pass. Bass `tests/trap.test.ts` (once, 99 s): 1 pass.
- Headed Chrome (real GPU, WebGPU) driven over CDP, 1366x768, both apps: first map appears (Wi-Fi in about 1.7 s, bass in about 2.1 s), no blank screen, no console errors. Ping, edit, wipe slider, "?" panel, and the floor-plan import (synthetic 600x400 PNG, 5 m scale) all ran.

## Screenshots (`C:\Users\prabo\Projects\ghostfield\reports\radar-shots\`, outside git)
`wifi-` and `bass-` + `0-loading, 1-first-map, 2-ping, 3-ping-trail, 4-after-edit-stale, 5-wipe, 6-help, 7-sketch-dialog, 8-sketch-ready, 9-sketch-imported` (.png).

## Not checked
- CPU fallback (`?backend=cpu`) in the browser: the new live pulse, the 384 px Wi-Fi grid and the 5 cm bass grid were not run. Not tested: GPU timing of the pulse in the browser at other window sizes.
- `prefers-reduced-motion` was not switched on in a browser. Sound of `thump()` was not heard (no audio check).
- Mission ticks: only the ping tick was seen. The others were only checked by reading the code, as were the wipe-slider tick and the "trap drops 3 dB" tick.
- Real photos of paper plans: only a synthetic PNG. In the bass import the area outside the drawn room shows as grey wall; not investigated.
- Phones and small screens (CSS written, not viewed).
- Wi-Fi live pulse has no absorbing edge (core limit), so it bounces off the room edge. The bass live pulse is shown at 400 Hz, so the wave is a soft wide ring.
- No new UI tests (the UI is browser-only).
