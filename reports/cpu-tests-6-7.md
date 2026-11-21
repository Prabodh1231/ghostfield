# CPU solver, tests 6 and 7

Branch `feat/cpu-solver`. PR: https://github.com/Prabodh1231/ghostfield/pull/1

Node v24.21.0, pnpm 12.21.0, Vitest 2.1.9, Windows. Single fork, no watch.

## What was built
- `packages/ghostfield-core/src/coefficients.ts`: Material -> (C, L, gammaU, gammaQ); ETD A, B in f64 (`-expm1`, limit dt/C below g*dt = 1e-8), cast to f32 last. One `Float32Array` with a vec4 per cell `[Au, Bu, Aq, Bq]` (review point 8). CFL guard (`CFL_LIMIT = 0.7071`, default S = 0.693).
- `packages/ghostfield-core/src/cpu/solver.ts`: staggered-grid Float32Array solver (u, qx, qy). Rigid walls by default (outer q faces never updated, wall on the face, Lx = N*dx). `Boundary` hook (afterQ, afterU), `Source` and `Probe` interfaces.
- `tests/test6-cfl-etd.test.ts`, `tests/test7-room-modes.test.ts`, `.github/workflows/ci.yml`.

A bug the tests found: a face pairs the C of one cell with the L of its neighbour. With mixed materials the fastest speed is 1/sqrt(min C * min L), which can beat every single cell. The first version of the guard used the fastest single cell and the solver blew up at S = 0.707099999 (fast-check counterexample). The guard now uses 1/sqrt(min C * min L).

## Commands
```
pnpm --filter ghostfield-core exec vitest run tests/test6-cfl-etd.test.ts --pool=forks --poolOptions.forks.singleFork
pnpm --filter ghostfield-core exec vitest run tests/test7-room-modes.test.ts --pool=forks --poolOptions.forks.singleFork --testTimeout=300000
pnpm exec tsc --noEmit -p packages/ghostfield-core   # clean, no output
```

## Test 6 output (verbatim)
```
 RUN  v2.1.9 C:/Users/prabo/Projects/ghostfield/packages/ghostfield-core
 G£ô tests/test6-cfl-etd.test.ts (7 tests) 211ms
 Test Files  1 passed (1)
      Tests  7 passed (7)
   Start at  16:44:30
   Duration  737ms (transform 70ms, setup 0ms, collect 263ms, tests 211ms, environment 0ms, prepare 106ms)
```

## Test 7 output (verbatim, default run)
```
 RUN  v2.1.9 C:/Users/prabo/Projects/ghostfield/packages/ghostfield-core
stdout | tests/test7-room-modes.test.ts > test 7: rectangular room modes > lowest modes match (c/2)sqrt((m/Lx)^2+(n/Ly)^2) within 1%
room 256x200 @ 0.025 m: Lx=6.4 m Ly=5 m, c=343 m/s, S=0.693, dt=0.00005051020408163265 s
steps=118788 (6.000 s), source=(51,54) probe=(205,148), f32 fields
m,n | formula Hz | measured Hz | % error
1,0 | 26.797 | 26.797 | -0.000
0,1 | 34.300 | 34.300 | -0.001
1,1 | 43.527 | 43.527 | -0.000
2,0 | 53.594 | 53.593 | -0.001
2,1 | 63.630 | 63.630 | -0.000
0,2 | 68.600 | 68.599 | -0.002
1,2 | 73.648 | 73.647 | -0.001
max |error| = 0.002 %
 G£ô tests/test7-room-modes.test.ts (1 test) 93641ms
   G£ô test 7: rectangular room modes > lowest modes match (c/2)sqrt((m/Lx)^2+(n/Ly)^2) within 1% 93640ms
 Test Files  1 passed (1)
      Tests  1 passed (1)
   Start at  16:40:10
   Duration  94.23s (transform 81ms, setup 0ms, collect 97ms, tests 93.64s, environment 0ms, prepare 228ms)
```

### Per-mode table, default run (256x200 @ 2.5 cm, Lx = 6.4 m, Ly = 5.0 m, source (51,54), probe (205,148))
| m,n | formula Hz | measured Hz | % error |
|---|---|---|---|
| 1,0 | 26.797 | 26.797 | -0.000 |
| 0,1 | 34.300 | 34.300 | -0.001 |
| 1,1 | 43.527 | 43.527 | -0.000 |
| 2,0 | 53.594 | 53.593 | -0.001 |
| 2,1 | 63.630 | 63.630 | -0.000 |
| 0,2 | 68.600 | 68.599 | -0.002 |
| 1,2 | 73.648 | 73.647 | -0.001 |

## Nearby inputs tried (env overrides in the test file)
| Input | Result |
|---|---|
| 256x200, source (51,54), probe (205,148) (default) | pass, max error 0.002 % |
| 200x168 (Lx 5.0 m, Ly 4.2 m) | pass, max error 0.002 % |
| 256x200, source (170,31), probe (37,162) | pass, max error 0.002 % |

### 200x168 (verbatim output)
```
 RUN  v2.1.9 C:/Users/prabo/Projects/ghostfield/packages/ghostfield-core
stdout | tests/test7-room-modes.test.ts > test 7: rectangular room modes > lowest modes match (c/2)sqrt((m/Lx)^2+(n/Ly)^2) within 1%
room 200x168 @ 0.025 m: Lx=5 m Ly=4.2 m, c=343 m/s, S=0.693, dt=0.00005051020408163265 s
steps=118788 (6.000 s), source=(40,45) probe=(160,124), f32 fields
m,n | formula Hz | measured Hz | % error
1,0 | 34.300 | 34.300 | -0.001
0,1 | 40.833 | 40.833 | -0.001
1,1 | 53.328 | 53.328 | -0.000
2,0 | 68.600 | 68.599 | -0.002
2,1 | 79.833 | 79.832 | -0.001
max |error| = 0.002 %
 G£ô tests/test7-room-modes.test.ts (1 test) 59891ms
   G£ô test 7: rectangular room modes > lowest modes match (c/2)sqrt((m/Lx)^2+(n/Ly)^2) within 1% 59890ms
 Test Files  1 passed (1)
      Tests  1 passed (1)
   Start at  16:41:57
   Duration  60.32s (transform 69ms, setup 0ms, collect 88ms, tests 59.89s, environment 0ms, prepare 154ms)
```
| m,n | formula Hz | measured Hz | % error |
|---|---|---|---|
| 1,0 | 34.300 | 34.300 | -0.001 |
| 0,1 | 40.833 | 40.833 | -0.001 |
| 1,1 | 53.328 | 53.328 | -0.000 |
| 2,0 | 68.600 | 68.599 | -0.002 |
| 2,1 | 79.833 | 79.832 | -0.001 |

### 256x200, source (170,31), probe (37,162) (verbatim output)
```
 RUN  v2.1.9 C:/Users/prabo/Projects/ghostfield/packages/ghostfield-core
stdout | tests/test7-room-modes.test.ts > test 7: rectangular room modes > lowest modes match (c/2)sqrt((m/Lx)^2+(n/Ly)^2) within 1%
room 256x200 @ 0.025 m: Lx=6.4 m Ly=5 m, c=343 m/s, S=0.693, dt=0.00005051020408163265 s
steps=118788 (6.000 s), source=(170,31) probe=(37,162), f32 fields
m,n | formula Hz | measured Hz | % error
1,0 | 26.797 | 26.797 | -0.000
0,1 | 34.300 | 34.300 | -0.001
1,1 | 43.527 | 43.527 | -0.000
2,0 | 53.594 | 53.593 | -0.001
2,1 | 63.630 | 63.630 | -0.000
0,2 | 68.600 | 68.599 | -0.002
1,2 | 73.648 | 73.647 | -0.001
max |error| = 0.002 %
 G£ô tests/test7-room-modes.test.ts (1 test) 70700ms
   G£ô test 7: rectangular room modes > lowest modes match (c/2)sqrt((m/Lx)^2+(n/Ly)^2) within 1% 70700ms
 Test Files  1 passed (1)
      Tests  1 passed (1)
   Start at  16:42:58
   Duration  71.11s (transform 74ms, setup 0ms, collect 89ms, tests 70.70s, environment 0ms, prepare 129ms)
```
| m,n | formula Hz | measured Hz | % error |
|---|---|---|---|
| 1,0 | 26.797 | 26.797 | -0.000 |
| 0,1 | 34.300 | 34.300 | -0.001 |
| 1,1 | 43.527 | 43.527 | -0.000 |
| 2,0 | 53.594 | 53.593 | -0.001 |
| 2,1 | 63.630 | 63.630 | -0.000 |
| 0,2 | 68.600 | 68.599 | -0.002 |
| 1,2 | 73.648 | 73.647 | -0.001 |

Run time: about 94 s (default), 60 s (200x168), 71 s (moved source).

## Skipped
- CPML (only the hook exists), GPU code, tests 1-5.
- No f64 build comparison (not needed: the error is 0.002 %).
- Test 7 checks modes below 80 Hz only (7 modes in the default room). Higher modes closer than 4 % apart share a search window, so they were left out.
- Peak search windows are +-2 % around the formula, so a mode absent from the signal would fail, but a wrong peak inside the window would be read as that mode.
- The DFT is a direct evaluation at chosen frequencies (equal to unlimited zero padding), not an FFT.
- CI: `gh pr checks 1` read live: physics-tests pass, 1m15s (https://github.com/Prabodh1231/ghostfield/actions/runs/44898207570).
- Only 6 s records were tried; 8 s was not.
