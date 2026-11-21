---
name: ghostfield-engine
description: Set up a scene and run the GhostField 2D FDTD solver on CPU or WebGPU. Covers coefficients, the CFL rule, sources, boundaries and backend choice. Use when editing or calling packages/ghostfield-core.
---

# GhostField engine

Code lives in `packages/ghostfield-core/src/`. Apps import it as `@core/...`.

## The model
One canonical system for both Wi-Fi and bass:
`C du/dt + gu*u = -div q`, `L dq/dt + gq*q = -grad u`.
Staggered Yee grid, row-major, x fastest. `u` is at cell centres (nx*ny). `qx` is (nx+1)*ny. `qy` is nx*(ny+1).

| Use | u | C | L |
|---|---|---|---|
| Wi-Fi | Ez | eps0*epsr | mu0 |
| Bass | pressure | 1/(rho0*c^2) | rho_eff |

## Coefficients (single source of truth)
`packages/ghostfield-core/src/coefficients.ts`. The CPU solver and the GPU shaders both use it. Never compute coefficients anywhere else.

- `buildCoefficients(nx, ny, dx, dt, materialAt)` returns a `CoefficientSet`.
- `materialAt(ix, iy)` returns `{ C, L, gammaU, gammaQ }`.
- `coef` is one `Float32Array`, stride 4 per cell: `[Au, Bu, Aq, Bq]`.
- Update: `u <- Au*u - Bu*div(q)/dx`, `q <- Aq*q - Bq*grad(u)/dx`. The `1/dx` is not in the coefficients.
- `A = exp(-g*dt)`. `B = (1-A)/(g*dt) * dt/C`. Computed in f64 with `expm1`, then cast to f32. If `g*dt < 1e-8` it uses `B = dt/C`.

## CFL rule
- Hard 2D limit: `S = cMax*dt/dx <= 1/sqrt(2) = 0.7071` (`CFL_LIMIT`).
- Default: `DEFAULT_COURANT = 0.693`. This is a safety margin, not the limit.
- `buildCoefficients` throws `RangeError` above the limit.
- `cMax = 1/sqrt(min C * min L)` over the grid. This can be faster than any single cell's speed. Do not use the fastest single cell.
- Pick dt from the fastest speed: `dt = DEFAULT_COURANT * dx / cMax` (`dtFromCourant`).

## Run a job (same data for both backends)
```ts
import { buildCoefficients, DEFAULT_COURANT } from "@core/coefficients";
import { makePlan } from "@core/runtime/sineSource";
import { runCpuJob, type FieldJob } from "@core/runtime/cpuJob";
import { runGpuJob } from "@core/gpu/gpuJob";

// material = { C, L, gammaU, gammaQ }; cMax = 1/sqrt(min C * min L) over the grid\nconst dt = (DEFAULT_COURANT * dx) / cMax;
const cs = buildCoefficients(n, n, dx, dt, (ix, iy) => material);
const plan = makePlan(freq, dt, settleSteps, averagePeriods, sampleEvery);
const job: FieldJob = {
  cs,
  cpmlThickness: 16,                 // 0 = none (rigid outer walls)
  solid,                             // optional Uint8Array, 1 = rigid solid cell
  sources: [{ ix, iy, freq, amplitude: 1, rampPeriods: 6 }],
  plan,
};
const cpu = runCpuJob(job, onProgress, cancelled);        // sync, returns FieldResult | null
const gpu = await runGpuJob(device, job, onProgress, cancelled); // async
// result.power = time-averaged u^2 per cell (nx*ny)
```
- `sampleEvery` must give at least 3 snapshots per period (`makePlan` throws otherwise). The Wi-Fi app uses 6.
- Reference app: `apps/wifi-deadzone/src/scene.ts` (`buildJob`).

## Response job (broadband, used by the bass app)
Source is a Ricker pulse, output is a spectrum. CPU: unCpuResponse(job, onProgress, cancelled) in untime/responseJob.ts, with ickerSource(ix, iy, f0) and esponseSpectrum(result, freqs). GPU: unGpuResponse(...) in gpu/responseGpuJob.ts. Reference app: pps/bass-ghost-finder (sim.ts).

## Low level CPU use
`new CpuSolver(cs, boundary)`, then `addSource`, `addProbe(ix, iy)`, `run(n)` or `advance()`.
- No boundary hook: outer faces stay 0, so rigid walls exactly on the outer face (`Lx = nx*dx`).
- `new Cpml(cs, { thickness })` absorbs outgoing waves. Defaults: thickness 16, order 3, r0 1e-8. The outer face behind it is still rigid.
- `rigidWalls(nx, ny, solid)` for inner walls. Combine with `composeBoundaries(a, b)`.
- Sources are soft: added to `u` after each step.

## Backend choice
`detectBackend()` in `runtime/detectBackend.ts` returns WebGPU, or CPU with a `gridScale` of 0.5 (`CPU_GRID_SCALE`). A software fallback adapter counts as no GPU. Run the CPU solver in a Web Worker (`runtime/cpuWorkerHost.ts`; app example `apps/wifi-deadzone/src/sim.ts`).
GPU limits: default limits only, max 8 storage buffers per stage. `MAX_SOURCES = 8`, `MAX_PROBES = 8`, `STEPS_PER_SUBMIT = 16`.

## Tests
From `packages/ghostfield-core`: `pnpm test` (vitest). It is heavy. Run one file when possible, for example `pnpm vitest run tests/test6-cfl-etd.test.ts`. Tests 1-5 cover energy, reciprocity, mirror, spreading and CPML reflection. Test 6 covers the CFL guard and ETD. Test 7 covers room modes.
