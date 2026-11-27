# Echo Stalker: facts

Live: https://prabodh1231.github.io/ghostfield/echo/ (merged in dff356c). Code: `apps/echo-stalker`. Source of these facts: `reports/echo-stalker.md`.

## How it works, in plain words
1. The room is a grid. A clap or step adds a small push of "sound" to the grid, and the wave engine spreads it.
2. Walls are drawn only from the wave: each wall cell next to air keeps the loudest recent sound from its air neighbours and fades in about 0.9 s.
3. The monster hears the same sound field (it remembers for about 1.5 s). It walks toward the loudest direction (16 directions, walls push it away). When it hears nothing it wanders.
4. The monster's own steps are drawn and heard by you but are never put into the wave, so it cannot chase itself.
5. Stealth zones are cells with flow resistivity 3000. Sound made inside is mostly soaked up.

## Controls
WASD or arrows walk (a soft step sound every 1.2 m). Shift sneaks (silent, half speed). Space claps (0.8 s wait). Click throws a pebble (flies 0.25 s, stops before a wall, up to 8 m, then makes a sound). `?` or Esc opens help. The page pauses when the tab is hidden.

## Levels and options
Level 1 First steps. Level 2 The snake (faster monster). Level 3 Two hunters (two monsters). `?level=N` starts a level. `?backend=cpu` forces the CPU fallback.

## Play Your Sketch
File input, two clicks for scale plus metres, then `importSketch`. Start (biggest open area), exit (far end of the path) and monster (about 60% along the path) are picked automatically. An optional 15% photo underlay is off by default because it shows the walls. Plain errors for: too big, too dark, no floor. Stealth zones are not made from sketches.

## Numbers we measured
Real Chrome, headed, 1400x800, 60 Hz screen, Windows, NVIDIA GPU, about 450 frames per run.

| Backend | Frame interval avg / p95 | JS time per frame avg / p95 |
|---|---|---|
| GPU (WebGPU 400x240, 41 steps per frame) | 18.0-18.4 ms / 16.8-17 ms | 0.45 ms / 0.8 ms |
| CPU fallback (160x96, 20 steps per frame) | 17.9 ms / 17 ms | 3.2 ms / 3.7 ms |

Each run has one start-up hitch of 266-283 ms. GPU time inside the GPU is not visible from JS.

## Choices that differ from the plan
- Time scale is 0.2x on GPU, not 0.5x. At 0.5x a wave crosses the room in under 3 frames and looks like a flash.
- CPU grid is 160 x 96 cells at 10 cm (same 16 x 9.6 m world, 0.25x), not 160 x 100 at 4 cm, which only covers 6.4 x 4 m.
- A small air loss (22 per second) is added because the live sim has no absorbing edge. Without it echoes never die.

## Tests
10 tests pass (`pnpm --filter echo-stalker exec vitest run tests/game.test.ts`): levels are connected, wall glow lights only wall cells next to air and fades, the monster steps toward the louder side, a headless run on level 1 shows a clap lights walls and the monster comes closer, and a sketch becomes a playable level.

## Not checked
See "What was not checked" in the README. CI does not build the game on pull requests; the Pages job builds it.
