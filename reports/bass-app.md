# Bass ghost finder (`apps/bass-ghost-finder`)

Branch `feat/bass-app`. PR: https://github.com/Prabodh1231/ghostfield/pull/6

## What was built

| Where | What |
|---|---|
| `apps/bass-ghost-finder/` | Vite + React static SPA (`base: "./"`). |
| `src/scene.ts` | Room (rectangle or L-shape), traps to cells, `gamma_q = Rf / rho_eff`, job builders. |
| `src/sim.ts` | `detectBackend`, then WebGPU, or the CPU solver in a Web Worker. |
| `src/cpu.worker.ts` | Worker for both job kinds. |
| `src/audio.ts` | Web Audio player: laptop mode and normal mode, limiter, volume cap. |
| `src/App.tsx` | Plan view, response chart, controls. |
| `packages/ghostfield-core/src/runtime/responseJob.ts` | NEW. Ricker pulse in, `u` at the seat out; `responseSpectrum`. |
| `packages/ghostfield-core/src/gpu/responseGpuJob.ts` | NEW. Same job on WebGPU. |
| `packages/ghostfield-core/tests/response-job.test.ts` | NEW. CPU peak test, GPU vs CPU. |
| `.github/workflows/ci.yml` | New steps for the above, the app tests and the app build. `pages.yml` untouched. |

Solver math, coefficient layout and shaders are unchanged.

How it works:

- **Room**: rigid walls. `u` = pressure, `q` = particle velocity, `C = 1/(rho0 c^2)`, `L = rho_eff = rho0 = 1.2`, `c = 343`. Width and depth 1.5 to 6.4 m. L-shape = a rectangle cut from the top-right corner (cut-out size editable).
- **Grid**: WebGPU 2.5 cm cells (256x256 at 6.4 m). CPU fallback: 5 cm cells (128x128 at 6.4 m), same room size, since 300 Hz is still 23 cells per wavelength.
- **Traps (2 types)**: 5 cm PU foam (Rf 5,000, `gamma_q` 4167 /s): drag a line, it becomes a strip 5 cm thick along the wall (at least 1 cell). 60 cm corner superchunk (Rf 10,000, `gamma_q` 8333 /s): drop it, it snaps to the nearest inside corner and fills a triangle with 60 cm legs. `rho_eff = rho0` for both (no tortuosity). Erase and clear buttons.
- **Source and seat**: draggable (SUB, SEAT).
- **Frequency response**: Ricker pulse (120 Hz centre) at the SUB, 2 s of `u` at the SEAT. Response = |P(f)| / |S(f)|, 20 to 300 Hz every 0.5 Hz, last half of the record faded out. Chart in dB relative to the top peak. Peaks are orange dots. Click a peak (or anywhere) to set the frequency.
- **Map**: a continuous sine at the chosen frequency (0.5 s settle, 2 periods averaged), shown as dB relative to the loudest cell, -40 to 0 dB. Blue is a null, red is a boom. The page is labelled "Horizontal modes (2D plan view, no floor-to-ceiling modes)".
- **Sound**: *Laptop mode* plays a stack of 10 sine harmonics (k x f, up to 1200 Hz, weights 1/sqrt(k)). The whole stack is scaled by the simulated response at f against the median of the band: +12 dB at most, -24 dB at least. *Normal* plays the low tone alone, flat. Volume starts at 5%, the slider stops at 40%, a compressor set as a hard limiter (threshold -12 dB, ratio 20) sits before the speakers, and start and stop fade.
- **Backend**: the page shows WebGPU or CPU, the cell size and the grid. `?backend=cpu` forces the CPU path.

## Headless check (CPU solver)

`apps/bass-ghost-finder/tests/trap.test.ts`. Empty room 256x200 cells at 2.5 cm (6.4 m x 5.0 m), rigid walls, SUB at (0.2, 0.27) and SEAT at (0.8, 0.74) of the room (off the nodal lines), 4 s record. It takes about 3 minutes (175 s here). Superchunk in the top-left corner.

Modes, empty room:

| Mode | Formula Hz | Measured Hz | Error % | Peak dB |
|---|---|---|---|---|
| (1,0) | 26.797 | 26.795 | -0.009 | -2.47 |
| (0,1) | 34.300 | 34.303 | 0.010 | -5.68 |
| (1,1) | 43.527 | 43.524 | -0.006 | -3.34 |

Peak height change against the empty room (same record, same window):

| Mode | Superchunk, Rf 10,000 | Superchunk, Rf 0 (broken) |
|---|---|---|
| (1,0) | **-3.00 dB** | 0.00 dB |
| (0,1) | -4.07 dB | 0.00 dB |
| (1,1) | -9.75 dB | 0.00 dB |

With Rf set to 0 the effect is exactly gone (0.00 dB), so the change comes from the loss in the trap cells. The test asserts the (1,0) drop is more than 1 dB and the broken case is under 0.01 dB. The foam strip was not part of this run.

## Other checks

| Check | Result |
|---|---|
| `tests/response-job.test.ts` (core): CPU peak at (1,0) within 1%, GPU vs CPU probe trace (Dawn) | pass, max diff / peak = 7.9e-6 |
| `tests/scene.test.ts` (app): `gamma_q`, foam is 2 rows at 2.5 cm, chunk is a 300-cell triangle in the corner, 4 corners (rectangle) and 5 (L-shape), laptop levels order, and a CPU map at the (1,0) mode | pass; wall power / middle-line power = 1881 |
| `tsc --noEmit` | clean |

## Build size

`pnpm --filter bass-ghost-finder build` (`dist/`, relative paths):

| File | Size |
|---|---|
| `index.html` | 0.42 kB |
| `assets/index-*.js` | 250.11 kB (79.76 kB gzip) |
| `assets/cpu.worker-*.js` | 5.78 kB |
| `assets/index-*.css` | 1.76 kB |

About 258 kB in total.

## Run it locally in Chrome

1. `cd C:\Users\prabo\Projects\ghostfield`
2. `git checkout feat/bass-app` (or `main` after the merge), then `pnpm install`
3. `pnpm --filter bass-ghost-finder dev`
4. Open the URL Vite prints (usually http://localhost:5173/) in desktop Chrome.
5. The "Backend:" line should say **WebGPU, cell 2.5 cm, grid 200x160** for the 5 x 4 m start room. The first chart and map take a few seconds.
6. Look for:
   - The blue line has sharp peaks. In the 5 x 4 m room the first ones are near 34 Hz, 43 Hz and 55 Hz.
   - Click a peak. The map changes to its mode shape: red bands (booms) and blue bands (nulls). At the lowest peak the walls at the two ends are red and the middle line is blue.
   - Choose "60 cm corner superchunk" and drag in a corner. Peaks near it get lower and wider. Choose foam and drag along a wall: the change is small.
   - Drag SEAT onto a blue band of the map. The response at the seat changes, and the level readout moves.
7. Sound (start with the laptop volume low):
   - Press **Play** in *Laptop mode* at 40 Hz. You should hear a tone with a clear low pitch even on small speakers, because the harmonics carry it.
   - Move the frequency slider onto a peak, then onto a dip. The sound gets louder on a peak and quieter on a dip. The page shows the dB against the room median.
   - Switch to *Normal*. Small speakers play almost nothing below about 100 Hz. Headphones or a subwoofer play the tone itself.
8. L-shape: pick "L-shape". Modes change and a fifth corner appears.
9. CPU path: open http://localhost:5173/?backend=cpu. The line says "CPU (Web Worker)", cell 5 cm.
10. Stop the server with Ctrl+C.

## Skipped / not checked

- **Not opened in a browser.** The build, the types and the headless runs pass, but I did not view the page, the pointer drag, the colours, the chart clicks or the sound. The browser tool here only opens public sites.
- The Web Worker path ran only as functions in Node, not as a real worker. The GPU map job (`runGpuJob` with rigid walls) was not run for this app; the core GPU job test covers CPML and blocks, and the response job has a GPU vs CPU test.
- Laptop mode scales the stack by the response at the fundamental only. It does not use the response at each harmonic.
- No loudness measurement or listening test. The limiter and volume cap are by design, not tested with a meter.
- The 2D model has no floor-to-ceiling modes and no air absorption. The superchunk is a loss region (`gamma_q`), not a tuned model of a real trap. Foam effect was not measured here.
- The headless run is one room, one source and seat position, one trap position. No grid-convergence study and no check of how the drop depends on record length.
- The trap test takes about 3 minutes in CI.
- No React UI tests.
- Nothing is deployed. `pages.yml` is not touched.
