# GhostField: tech

Stack: TypeScript, pnpm workspace, Vitest, fast-check (seeded). Apps: Vite + React static SPAs.

## Canonical system

`C du/dt + gu*u = -div q`, `L dq/dt + gq*q = -grad u`.

- Wi-Fi: u = Ez, q = rotated H, C = eps0*epsr, L = mu0, gu = sigma/(eps0*epsr).
- Bass: u = pressure, q = particle velocity, C = 1/(rho0*c^2), L = rho_eff, gq = flow resistivity / rho_eff.

## Loss update: ETD (never Crank-Nicolson)

`A = exp(-g*dt)`, `B = (1-A)/(g*dt) * dt/C`. Limit as g -> 0 is `dt/C`.
Compute in f64 with `-expm1(-g*dt)/g`; use the limit when `g*dt < ~1e-8`. Cast to f32 last.

## CFL

- Hard limit for 2D Yee: S = c*dt/dx <= 1/sqrt(2) = 0.7071.
- Default S = 0.693. This is a safety margin (about 98% of the limit), not the limit.
- Guard uses the fastest wave speed in the grid, not only free air.

## Shared coefficients (the CPU/GPU seam)

All precomputed coefficients (A, B, grid index layout) live in ONE module:
`packages/ghostfield-core/src/coefficients.ts`. `src/cpu/` and `src/gpu/` both import it. Neither computes its own.

## Solver API

Leave room now for a boundary hook and a source/probe interface. Do not hardcode rigid walls.

## Boundaries

- Wi-Fi: 16-cell CPML (polynomial sigma, order 3). Test CPML on a small domain (e.g. 200x200), not 768x768.
- Bass: rigid walls. Wall sits at a q-node face; Lx = N*dx exactly.

## WebGPU

<= 8 storage buffers (pack coefficients into vec4 buffers; keep CPML psi only in border strips), `@workgroup_size(16,16,1)`, no optional features.
Fallback: no adapter or `adapter.info?.isFallbackAdapter` -> pure-TS solver in a Web Worker, smaller grid. No Rust/WASM.

## Grids

Wi-Fi 768x768 @ 1.0 cm. Bass 256x256 @ 2.5 cm.

## Test rules

- Run one test file at a time: `pnpm --filter ghostfield-core exec vitest run tests/<file>`. No watch mode (low host memory).
- Energy test uses the leapfrog-conserved form (q at two time levels), not naive sum.
- Mode test (7): non-square room, zero-padded DFT with peak interpolation, single example, off-nodal source/probe.
