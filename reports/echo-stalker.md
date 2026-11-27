# Echo Stalker (apps/echo-stalker)

Branch `feat/echo-stalker`, stacked on `feat/radar-core` (PR #10). Live at `/echo/` once merged.

## What is in
- Black-screen echolocation game on `createLiveSim` (`@core`) with the `@ui` palette, 0.94 afterglow, thump and sketch importer. Own `@core` and `@ui` aliases in `vite.config.ts` and `tsconfig.json`. No new dependencies (same `vite` and `@webgpu/types` versions as wifi-deadzone, no React). `pnpm-lock.yaml` gains only the `apps/echo-stalker` importer (9 lines).
- **wallGlow** (`src/wallGlow.ts`): each wall cell touching air keeps the leaky max of u^2 of its air neighbours, decay time about 0.9 s. Walls are drawn only from this.
- **Player**: WASD or arrows. Soft footstep pulse every 1.2 m. Shift = sneak (silent, half speed). Space = clap (loud, 0.8 s cooldown). Click = pebble: flies 0.25 s, stops before the first wall, max 8 m, then makes a pulse.
- **Sound**: `@ui` thump at different pitches for clap, step, pebble ("click"), monster step. On-screen rings for every event (teal thin = you, red thick dashed = monster), so a muted video works. Sound on/off button.
- **Stealth zones**: grey dots (faint). Cells set with `setMaterial` (flow resistivity 3000). Sounds made inside are mostly soaked up.
- **Monster** (`src/monster.ts`, `src/world.ts`): hears a leaky-integrated (1.5 s) energy field. Heads along the gradient (16 directions, two radii, walls push away). Quiet: wanders to random spots, never slower than its wander speed, re-targets when stuck. Own steps are drawn and heard but never put into the sim, so it cannot follow itself. Same solid mask for collision as the solver. Seen only as a red flash when a wave passes over it.
- Exit marker (faint teal pulse), caught screen (Retry, Menu), win screen (Retry, Next level, Menu).
- Judge help: start screen with the one-line premise, controls, "Same wave engine as the Wi-Fi and bass apps", honest 2D note, `?` button (also Esc) in game. Hint toast for 7 s at level start. Backend line on the start screen.
- **Levels**: 1 First steps, 2 The snake (faster monster), 3 Two hunters (2 monsters). `?level=N` starts directly.
- **Play Your Sketch**: file input, 2-click scale bar plus metres, `@ui` `importSketch` (with `cellMetres`), start/exit/monster picked automatically (start in the biggest open area, exit at the far end of the path, monster at about 60% of the way), optional 15% photo underlay (checkbox, off by default because it shows the walls). Plain error messages (too big, too dark, no floor).
- Pages: `pages.yml` builds echo-stalker and copies it to `site/echo/`. `site-src/index.html` has a third card; `/wifi/` and `/bass/` cards untouched. `ci.yml` not changed (CI builds only wifi/bass; echo is built by the Pages job).
- Pauses when the tab is hidden (cancels the frame loop; no sim steps).

## What was cut or changed
- Nothing cut from the list.
- **CPU fallback grid differs from r7-core.md**: 160 x 96 cells at 10 cm (same 16 x 9.6 m world, pitch 160 Hz, 0.25x), not 160 x 100 at 4 cm (that only covers 6.4 x 4 m, so the same levels would not fit). Walls and waves are blurrier on CPU.
- **Time scale is 0.2x on GPU** (brief said about 0.5x). At 0.5x a wave crosses the room in under 3 frames, which looks like a flash and under-samples the monster's hearing. 0.2x crosses in about 14 frames.
- Global air loss (22 1/s on u and q) is added because the live sim has no CPML; without it echoes never die and the monster hears the room forever.
- Monster steps are not sim pulses (see above).
- Calibration test `tests/calibrate.test.ts` prints numbers only (it is not an assertion); it runs the 400x240 grid on the CPU for about 5 s.

## How to play
Open `/echo/` (or `?level=1`). Walk with WASD, clap with Space to see walls, click to throw a pebble away from you. Reach the faint pulsing exit. Hide in dotted zones, sneak with Shift. `?backend=cpu` forces the fallback.

## Frame times (real Chrome, headed, 1400x800, 60 Hz screen, Windows, NVIDIA GPU)
Script walked, clapped and threw a pebble for about 8 s; numbers from `window.__echo.stats` (about 450 frames each).

| Backend | frame interval avg / p95 | JS time per frame (update + draw) avg / p95 |
|---|---|---|
| GPU (WebGPU 400x240, 41 steps/frame) | 18.0-18.4 ms / 16.8-17 ms | 0.45 ms / 0.8 ms |
| CPU fallback (160x96, 20 steps/frame) | 17.9 ms / 17 ms | 3.2 ms / 3.7 ms |

Each run has one startup hitch of 266-283 ms (first frame, shader and canvas set-up) which lifts the average. GPU time itself is not visible from JS (async).
Screenshots in `reports/echo-shots/` (not committed): `gpu-*.png`, `cpu-*.png`, `level2-clap.png`, `level3-clap.png`, `sketch-setup.png`, `sketch-play.png`, `start.png`.

## Tests (targeted, `pnpm --filter echo-stalker exec vitest run tests/game.test.ts`)
10 pass: levels are well formed and start/exit/monsters are connected; wallGlow lights only wall cells next to air and decays; monster gradient step heads to the louder side and returns null when quiet; headless game on level 1 (CPU profile): a clap lights walls and the monster comes closer, a quiet monster keeps moving; sketch to level puts start, exit and monster on open floor. `tsc --noEmit` clean, `vite build` ok.

## Not checked
- A full run to the win screen and Retry/Next buttons were not played through by hand or script (only reachability by test). Level 2 and 3 difficulty was not tuned by playing.
- Audio was not heard (the headless run had no user gesture, Chrome logged the autoplay notice; the code calls thump from key handlers).
- Real paper photo for the sketch: only a synthetic drawn PNG was tried. Porous zones are not made from sketches.
- Stealth zone strength (flow resistivity 3000) was set from one calibration (about 2.5x less amplitude behind a 1.2 m slab), not tuned in play.
- Colour-blind and reduced-motion switches (plan points 25, 26) are not built: rings differ by shape (dashed, thick) but there is no "reduce flashing" switch.
- Touch input: keyboard and mouse only (said on the start screen).
- GPU timing inside the GPU is unmeasured; the CPU fallback was run in the same Chrome with `?backend=cpu`, not on a machine without WebGPU.
- CI does not build echo-stalker on pull requests.
