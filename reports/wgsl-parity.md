# WGSL shaders + WebGPU runner: parity with the CPU solver

Branch `feat/wgsl`. PR: https://github.com/Prabodh1231/ghostfield/pull/3

## What was built

| File | Job |
|---|---|
| `packages/ghostfield-core/src/gpu/shaders.ts` | Two WGSL kernels, `@workgroup_size(16,16,1)` |
| `packages/ghostfield-core/src/gpu/gpuSolver.ts` | `GpuSolver`: same `Source` / `Probe` types as `CpuSolver`; `run()` and `readU()` are async |
| `packages/ghostfield-core/src/gpu/parity.ts` | The comparison (3 scenes), shared by the test and the browser page |
| `packages/ghostfield-core/src/runtime/detectBackend.ts` | WebGPU, unless no adapter or `adapter.info?.isFallbackAdapter`; else `{kind:"cpu", gridScale: 0.5}` |
| `packages/ghostfield-core/tests/gpu-parity.test.ts` | Vitest parity test (headless Dawn); skips itself with no adapter |
| `packages/ghostfield-core/parity/index.html` | Browser page, prints PASS/FAIL and the max diff |

Step order matches the CPU: q update, CPML q correction, rigid-wall zeroing (Q kernel); u update, sources, CPML u correction, probes (U kernel). Two dispatches per step.

## Storage buffers per pipeline (limit 8)

| Pipeline | Storage buffers | Uniform |
|---|---|---|
| Q kernel | 7: u, qx, qy, coef (vec4 `[Au,Bu,Aq,Bq]`), profile, psiQ, solid | 1 |
| U kernel | 7: u, qx, qy, coef, profile, psiU, probeOut | 1 |

CPML psi lives only in the layer strips (2T lines per axis), not the full grid. No optional features, default device limits.
Faces `ix = nx` and `iy = ny` have no cell: the shader never writes them or reads coefficients for them (stay 0 = rigid outer wall). High-side-cell rule for q faces is the same as the CPU (PR1 review NICE 4).

## Measured max diff

Measured in **Node with headless WebGPU (the `webgpu` npm package, Dawn)** on this machine, adapter: NVIDIA, D3D12, not a fallback adapter. **Not yet measured in a browser.**

64x64, 300 steps, mixed C, L and loss patches, 2 sources, 4 probes. Diff = max |u_gpu - u_cpu| over the final field and all probe samples. Peak = max |u_cpu| over the same samples. Limit: diff/peak < 1e-4.

| Scene | max abs diff | peak | diff / peak |
|---|---|---|---|
| Rigid room, inner wall, lossy patch | 6.985e-8 | 6.245e-2 | 1.118e-6 |
| CPML (T=8), lossy patch | 2.608e-8 | 6.245e-2 | 4.175e-7 |
| CPML + inner wall | 3.062e-8 | 6.245e-2 | 4.902e-7 |

All about 100x under the limit.

## Break check (parity goes red)

Each break was applied to `shaders.ts`, the test run, then reverted (file restored; `git diff` clean against the committed shader).

| Break | Result |
|---|---|
| `- cf.w * g` to `+ cf.w * g` in the qx update | FAIL: diff/peak = NaN (blows up) in all 3 scenes |
| CPML u psi without the decay term `b*psi` | FAIL: CPML scenes 1.958e-1; rigid scene stays 1.1e-6 |
| Solid-wall zeroing dropped for qy | FAIL: rigid scene 6.684e-1, CPML+wall 2.926e-2 |

## Notes

- `GpuSolver` reads the CPML profile arrays from the `Cpml` instance by name (they are `private` in TS). No change to `src/cpu/`. If those field names change, the GPU copy breaks loudly (parity fails).
- Wall order is CPML first, then walls (like `composeBoundaries(cpml, walls)`).
- Dawn crashes the process if the `webgpu` instance or adapter is garbage collected, so the test keeps them referenced.
- CI: a "GPU parity" step was added. On a runner with no adapter the test skips. Whether the GitHub runner has an adapter is shown in the CI log of the PR.
- `pnpm-workspace.yaml` now allows the `webgpu` postinstall build. New dev dependencies in `ghostfield-core`: `webgpu`, `@webgpu/types`, `vite`.

## Run the browser parity page (Chrome)

1. In a terminal: `cd C:\Users\prabo\Projects\ghostfield`
2. `git checkout feat/wgsl` (or main, after the PR is merged), then `pnpm install`
3. `pnpm --filter ghostfield-core run parity`
4. Open the URL Vite prints (usually http://localhost:5173/) in Chrome. Use a recent desktop Chrome with WebGPU on.
5. Wait a second. The page shows a big **PASS** or **FAIL**, and one line per scene with the max abs diff and diff/peak. Copy those numbers back to me if you like.
6. Stop the server with Ctrl+C.

If it says "no usable WebGPU", open `chrome://gpu` and check the WebGPU line. The page also fails on a software fallback adapter (by design, same rule as `detectBackend`).

## Skipped / not checked

- Not verified in a browser (the page builds with `vite build`, but was not opened in Chrome).
- The Web Worker host for the CPU fallback is not written. `detectBackend` only returns `{kind:"cpu", gridScale: 0.5}`; the app starts the worker.
- Only 64x64 and 300 steps. No 768x768 run, no timing, no f64 comparison.
- Max 8 sources and 8 probes. One submit per step (no batching), fine for tests, slow for the app: batch before the app ships.
- Wall-then-CPML order (the other `composeBoundaries` order) is not supported on the GPU.
- Existing tests 1-7 were not rerun locally; only `tsc --noEmit` (clean) and the parity test.

## CI result

CI (physics-tests) passed on PR #3. The GPU parity test was SKIPPED there (no adapter on the runner), as designed.
