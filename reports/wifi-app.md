# Wi-Fi dead-zone app (`apps/wifi-deadzone`)

Branch `feat/wifi-app`. PR: https://github.com/Prabodh1231/ghostfield/pull/4

## What was built

| Where | What |
|---|---|
| `apps/wifi-deadzone/` | Vite + React static SPA. Draw straight walls, pick a material, drag the router, see the heatmap. |
| `apps/wifi-deadzone/src/materials.ts` | ITU-R P.2040-3 table at 2.4 GHz, and material to (C, L, gamma). |
| `apps/wifi-deadzone/src/scene.ts` | Walls to cells, job builder, 0 dB reference, dB conversion. |
| `apps/wifi-deadzone/src/sim.ts` | `detectBackend`, then WebGPU or the CPU Web Worker. |
| `packages/ghostfield-core/src/runtime/cpuJob.ts`, `cpuWorkerHost.ts`, `sineSource.ts` | New. CPU job runner and its Web Worker host; CW source; averaging plan. |
| `packages/ghostfield-core/src/gpu/gpuJob.ts` | New. Same job on WebGPU. |
| `packages/ghostfield-core/src/gpu/gpuSolver.ts` | Changed. Batched submits: 16 steps per `queue.submit` (one params buffer per step). Shaders and solver math are untouched. |
| `.github/workflows/ci.yml` | New steps: GPU job test, material test, shadow check, app build. |

How it behaves:

- Router: a point source, a 2.4 GHz sine with a 6-period turn-on, amplitude 1.
- Edge: 16-cell CPML along the outer edge of the grid.
- Map: time-averaged `Ez^2` over 2 periods, after the waves have crossed the room about twice. Shown in dB under the title **Relative signal (2D model)**. 0 dB is the mean level on a ring 0.5 m around the router. Colour range is -60 to 0 dB. A note on the page says: 2D model, not a calibrated measurement. The word dBm is not used anywhere in the app.
- Grid: 768x768 at 1.0 cm (room 7.68 m) on WebGPU. CPU fallback: 384x384 at **1.0 cm** (room 3.84 m), so wavelength resolution stays the same and only the room is smaller. The page shows the backend, grid, cell size and room size.
- Responsive: the CPU run is in a Web Worker. The GPU run is async, in chunks of 64 steps (16 steps per submit), with a progress bar. Any edit cancels the run and starts a new one 250 ms later.
- Averaging on GPU: the shaders do not average, so the app reads `u` back every 3 steps during the 2-period window (12 reads). No shader was changed.

## Material table

Source: Recommendation ITU-R P.2040-3 (08/2023), Section 3, Table 3, Eqs. (57), (58): `epsr = a f^b`, `sigma = c f^d`, f in GHz. The a, b, c, d were read from the MathWorks `buildingMaterialPermittivity` page, which says it repeats Table 3. I did not open the ITU PDF (it did not load as text). The unit test recomputes the 2.4 GHz columns.

| Wall | a | b | c | d | epsr @ 2.4 GHz | sigma @ 2.4 GHz (S/m) | gamma_u = sigma/(eps0 epsr) (1/s) | Thickness used |
|---|---|---|---|---|---|---|---|---|
| Drywall (plasterboard) | 2.73 | 0 | 0.0085 | 0.9395 | 2.73 | 0.0193 | 7.99e8 | 1.5 cm |
| Glass | 6.31 | 0 | 0.0036 | 1.3394 | 6.31 | 0.0116 | 2.08e8 | 1 cm |
| Wood | 1.99 | 0 | 0.0047 | 1.0718 | 1.99 | 0.0120 | 6.81e8 | 4 cm |
| Brick | 3.91 | 0 | 0.0238 | 0.16 | 3.91 | 0.0274 | 7.92e8 | 10 cm |
| Concrete | 5.24 | 0 | 0.0462 | 0.7822 | 5.24 | 0.0916 | 1.97e9 | 20 cm |
| Metal | 1 | 0 | 1e7 | 0 | 1 | 1e7 | 1.13e18 | 1 cm |

Mapping: `C = eps0 epsr`, `L = mu0`, `gamma_u = sigma / (eps0 epsr)`, `gamma_q = 0`. Air is `epsr = 1, sigma = 0`.

Thickness is NOT from ITU. It is my choice of a typical value. A wall is drawn at least 1 cell (1 cm) thick, rounded to whole cells, so drywall (1.5 cm) is 2 cells and glass is 1 cell.

## Shadow check (headless, CPU solver)

`apps/wifi-deadzone/tests/shadow.test.ts`. Room 3.2 m (320x320 cells at 1.0 cm), 16-cell CPML, router at (0.8, 1.6) m. One wall at x = 1.6 m, from y = 0.8 to 2.4 m (1.6 m long). Probe box x 2.0 to 2.4 m, y 1.4 to 1.8 m, directly behind the wall. Shadow = 10 log10 of the mean `Ez^2` in the box with the wall, over the same box with no wall.

| Wall | Shadow (dB) |
|---|---|
| Wood | -0.62 |
| Drywall | -1.63 |
| Brick | -3.88 |
| Glass | -4.66 |
| Concrete | -17.19 |
| Metal | -35.87 |
| **Break check: metal with sigma = 0** | **0.00** |

Metal gives a clear shadow (-35.9 dB). Drywall a weak one (-1.6 dB). With the metal conductivity set to 0 the shadow goes from -35.87 dB to 0.00 dB (the wall is then just air). The test asserts metal < -20 dB, drywall > -3 dB, metal < concrete < drywall, and broken metal > -3 dB. It takes about 16 s.

Reading the numbers: these are 2D, TM-polarised, single-wall numbers in one geometry, with a finite wall (some signal goes round the ends). They are not predictions for real walls. Nothing was tuned to get this order. Glass (6.31) and brick (3.91) land close together; I did not look into why.

## Other checks

| Check | Result |
|---|---|
| GPU job vs CPU job, 96x96, CPML, loss and dense blocks (`tests/gpu-job.test.ts`, headless Dawn, NVIDIA D3D12) | max diff / peak = 6.2e-8 (limit 1e-3 in the test) |
| GPU job vs CPU job on the real app scene, 384x384 | max diff / peak = 1.3e-7 (one-off run, not in CI) |
| Existing GPU parity (`tests/gpu-parity.test.ts`) after batching | still 1.1e-6, 4.2e-7, 4.9e-7 (limit 1e-4) |
| Time, headless Dawn, 768x768, 2252 steps | about 0.3 s |
| Time, Node, CPU solver, 384x384, 1144 steps | about 2.7 s |
| `tsc --noEmit` for app and core | clean |
| `tests/test6-cfl-etd.test.ts` (sanity that core still runs) | 7 passed |

## Build output

`pnpm --filter wifi-deadzone build` makes `apps/wifi-deadzone/dist/` (`base: "./"`, so it works from any path):

| File | Size |
|---|---|
| `index.html` | 0.41 kB |
| `assets/index-*.js` | 242.52 kB (77.43 kB gzip) |
| `assets/cpu.worker-*.js` | 5.14 kB |
| `assets/index-*.css` | 1.27 kB |

About 249 kB in total.

## Run it locally in Chrome

1. `cd C:\Users\prabo\Projects\ghostfield`
2. `git checkout feat/wifi-app` (or `main` after the merge), then `pnpm install`
3. `pnpm --filter wifi-deadzone dev`
4. Open the URL Vite prints, usually http://localhost:5173/ , in desktop Chrome.
5. Check the line "Backend:". On your NVIDIA card it should say **WebGPU, 768x768 cells @ 1.0 cm, room 7.68 m**. The first map appears after about a second.
6. Try these:
   - Drag the green router into another room. The map redraws when you let go.
   - Pick **Metal**, drag a wall in front of the router. Behind it the map goes dark. Then pick **Drywall** and draw the same wall. The shadow is much weaker.
   - Hold Shift to draw straight walls. Use **Erase wall** and click a wall to remove it. **Example flat** brings back the start layout.
   - Move the mouse over the map: the dB under the cursor shows below the colour bar.
7. To see the CPU path, open http://localhost:5173/?backend=cpu . The line should say **CPU (Web Worker)**, 384x384, room 3.84 m, and a progress bar runs for a few seconds while the page stays responsive.
8. Stop the server with Ctrl+C.

## Skipped / not checked

- **Not opened in a browser.** The build works and the same code runs headless (Dawn for GPU, Node for CPU), but I did not view the page, the pointer handling, the colours or the Web Worker in Chrome. The browser tool here only opens public sites.
- The CPU Web Worker path ran only in Node (`runCpuJob`), not as a real worker.
- ITU values came from a mirror of Table 3, not the ITU PDF.
- Wall thickness values are my choice, not ITU. Walls are staircase-rasterised; a thin wall can be one cell off.
- Shadow numbers are one geometry at one grid, no convergence study (no 0.5 cm run, no longer settle time).
- The GPU reads back `u` 12 times for the average, so the average is a snapshot mean, not an in-shader sum.
- The GPU runner allocates new buffers for each run; no reuse, no device-lost handling.
- No tests for the React UI (pointer drawing, erase, router drag).
- No touch-specific handling beyond pointer events; no mobile layout work.
- Nothing is deployed.
- Review items from `reports/pr3-review.md` (NICE 1 to 5) were not touched.
