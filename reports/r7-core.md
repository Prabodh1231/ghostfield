# Round 7: speed spike, live core, @ui

Branch `feat/radar-core`. Items 0, 1, 2 of the r7 split.

## 0. Speed spike (scratch test, not committed)

Machine: NVIDIA GPU via Node + Dawn (`webgpu` package). Pulse: Ricker, peak 400 Hz (content to about 1 kHz). dx = 4 cm, dt = 80.8 us (Courant 0.693, c = 343). Rigid room, one source, no probes.

| Grid | CPU ms/step | GPU ms/step (waits for finish, batch of 256) | GPU ms/step (JS-side submit only) |
|---|---|---|---|
| 160 x 100 (6.4 x 4.0 m) | 0.148 | 0.026 | 0.037 |
| 400 x 240 (16 x 9.6 m) | 0.778 | 0.022 | 0.022 |

Real time at 60 fps needs 1/60 / 80.8 us = 206 steps per frame.

| Backend / grid | Steps in an 8 ms budget | Time scale reached |
|---|---|---|
| GPU 400x240 | about 350 (206 needs 4.7 ms) | 1x possible; 0.5x leaves lots of room |
| CPU 160x100 | about 54 | about 0.25x |
| CPU 400x240 | about 10 | 0.05x (too slow, not used) |

### Choice
- dx = 4 cm (6.9 cells per wavelength at 1 kHz, 8.6 at 800 Hz).
- GPU: 400 x 240 (16 x 9.6 m), 103 steps per frame = time scale 0.5x (about 2.4 ms of GPU work). 1x also fits.
- CPU fallback: 160 x 100 (6.4 x 4 m), 50 steps per frame = time scale about 0.25x.
- Measured in Node, not in a browser. Browser GPU timing and the `mapAsync` copy-back were not measured there.

## 1. API (frozen in 8537017, `packages/ghostfield-core/src/live/types.ts`)

```ts
createLiveSim({ cs, solid?, backend: "cpu" | "gpu", device?, pulseHz = 400, readbackEvery = 1 }): LiveSim
LiveSim: advance(n), field(), addPulse(x, y, amp) -> slot, setSolid(ix, iy, bool),
         setMaterial(ix, iy, Material), reset(), destroy(); nx, ny, dx, dt, step
MAX_PULSES = 8 (oldest pulse dropped when full)
```
- `advance` never blocks. GPU `field()` is the last finished copy (lags 1-3 frames); the array stays the same object.
- Edits made before `advance` apply from its first step. `setMaterial` throws if the cell is faster than `cs.cMax`.
- Shared acoustic builders in `live/acoustics.ts`: `RHO0`, `C0`, `gammaQ`, `acousticMaterial(rf)`, `makeMaterialAt`, `acousticCoefficients(nx, ny, dx, rf?)`. The bass app `scene.ts` now imports and re-exports them (only that file changed in the app).
- Existing GPU kernels and CPU solver are unchanged.

## 3. `@ui` (`packages/ghostfield-ui/src`)
`PALETTE`, `ramp(t)`, `createAfterglow(w, h, 0.94)`, `thump()`, `importSketch(img, opts)`, `drawUnderlay`, `SketchError`.

Change to the frozen stub: `SketchOptions.cellMetres?` (optional, added). With it, a room that needs more cells than `maxCols x maxRows` is refused with a plain message. Without it, the sketch is fitted to the grid. Without this field the grid cap could not be checked, because the stub had no cell size.

Importer: gray, cap 1024 px, adaptive threshold from an integral-image block mean (window about 1/16 of the image), refuse over 60% dark, max-pool to cells so thin pen lines survive, thicken to 2 cells (grows down and right), scale from the 2-click bar.

## Tests
| Command | Result |
|---|---|
| `pnpm --filter ghostfield-core exec vitest run` | 12 files, 26 tests pass (incl. 4 new in `tests/live.test.ts`; existing 7 physics tests untouched) |
| `pnpm --filter ghostfield-core exec vitest run --root ../ghostfield-ui` | 6 tests pass (3 synthetic fixtures: clean, shadowed, rotated 3 deg; scale; too big / too dark; ramp) |
| `tsc --noEmit` core, ui, bass app | clean |

New live tests: CPU live equals a batch `CpuSolver` with the same pulse (energy within 1e-6); slot recycling; solid wall blocks the wave (zero energy behind it); porous cells lower energy; GPU live vs CPU live (diff / peak < 1e-3, skips with no adapter).

## Not checked
- Browser: GPU timing, `mapAsync` copy-back, `createAfterglow`, `thump` audio, `drawUnderlay` were not run in a browser (Node has no canvas or audio). They are untested code.
- Importer fixtures are synthetic; no real paper photo was tried. No deskew: a rotated sketch is only tolerated, not straightened.
- Live sim has no CPML (rigid rooms only). Bass and Wi-Fi apps were not rebuilt (bass: tsc only).
- `readbackEvery` and `reset()` on GPU are not covered by tests.
