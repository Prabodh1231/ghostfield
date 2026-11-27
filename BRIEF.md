# GhostField — Build Brief (handoff from planning session, 2026-11-21)

Kiroween 2026 hackathon entry, **Skeleton Crew** category.
Deadline: **Fri Dec 4, 2026, 2:00 PM PT** (Sat Dec 5, 3:30 AM IST). Submit by Dec 4 morning PT.
Claim the 4,000 free Kiro credits on the Devpost Resources tab **before Dec 1, 12:00 PM PT**.

## What it is
One lean 2D wave-physics engine (FDTD on a staggered Yee grid) that powers two browser apps:
1. `apps/wifi-deadzone` — 2.4 GHz Wi-Fi dead-zone map. Draw walls, drag the router, see a dBm heatmap.
2. `apps/bass-ghost-finder` — 20–300 Hz room bass modes. Draw a room (rectangle or L-shape), drop bass traps, see and hear the booms and nulls.

Both apps share the same engine. Each app only supplies its own materials, sources, probes and UI.

## Repo layout (public GitHub, MIT license)
```
ghostfield/
  LICENSE                      # MIT, must show in GitHub "About"
  .kiro/                       # specs, hooks, steering; NEVER in .gitignore
  packages/ghostfield-core/    # engine only: no UI, no domain code
    src/cpu/                   # pure-TS Float32Array reference solver (also the CPU fallback)
    src/gpu/                   # WGSL compute shaders + WebGPU runner
    src/runtime/detectBackend.ts
    tests/                     # fast-check + Vitest physics PBTs
  apps/wifi-deadzone/          # Vite + React static SPA
  apps/bass-ghost-finder/      # Vite + React static SPA
  powers/ghostfield-fdtd/      # Kiro Power (plugin.json + skills/)
ghostfield-crew/               # separate public repo: Kiro Crew app (1 agent, 1 tool)
```

## Engine decisions (locked)
- Canonical system: `C du/dt + γu·u = -div q`, `L dq/dt + γq·q = -grad u`.
  - Wi-Fi: u = Ez, q = rotated H, C = ε0·εr, L = μ0, γu = σ/(ε0·εr).
  - Bass: u = pressure, q = particle velocity, C = 1/(ρ0·c²), L = ρ_eff, γq = flow resistivity / ρ_eff.
- Loss update: **ETD** coefficients `A = exp(-γΔt)`, `B = (1-A)/(γ·Δt)·Δt/C` (limit `Δt/C` as γ→0). Precompute on CPU. Never Crank-Nicolson.
- CFL: Courant number S = cΔt/Δx ≤ 0.693, using free-air speed.
- Boundary: 16-cell CPML for Wi-Fi (open space). Rigid walls for bass.
- WebGPU limits: ≤ 8 storage buffers, `@workgroup_size(16,16,1)`, no optional features (no float32-filterable).
- Fallback: if no adapter, or `adapter.info?.isFallbackAdapter`, run the pure-TS solver in a Web Worker at a smaller grid. No Rust/WASM.
- Wi-Fi default grid: 768×768 @ 1.0 cm. Bass default grid: 256×256 @ 2.5 cm.
- Wi-Fi walls: ITU-R P.2040-3 materials (drywall, glass, wood, brick, concrete, metal).
- Bass traps: 2 types only — 5 cm PU foam (Rf 5,000) and 60 cm corner superchunk (Rf 10,000).
- Bass "Laptop mode": play a harmonic stack scaled by the simulated room response, so bass is audible on laptop speakers.

## Physics tests (fast-check + Vitest, seeded)
1. Energy: a lossless closed room conserves energy; a lossy one only loses energy.
2. Reciprocity: h(A→B) = h(B→A) in a random L-shaped room with random traps.
3. Mirror symmetry.
4. 2D spreading: amplitude ∝ r^-0.5.
5. CPML reflection < -60 dB.
6. CFL guard + ETD A ∈ [0,1], no NaN.
7. Rectangular room modes match `f = (c/2)·sqrt((m/Lx)² + (n/Ly)²)` within 1% in f32.
Note: numbers in earlier research docs are NOT verified. Only quote numbers our own tests produce.

## Cut (do not build)
Rust/WASM SIMD, Crank-Nicolson, RLC tuned trap, 2.5D ceiling overlay, ConvolverNode reverb, 5 GHz.
(Round 7 change: "image floor-plan tracing" was removed from this list. See "Round 7" at the end.)

## Plan
| Days | Goal |
|---|---|
| 1–3 (Nov 21–23) | Repo + .kiro steering/hooks. TS engine + physics tests green. |
| 4–5 | WGSL shaders match TS engine within 1e-4. |
| 6–7 | Wi-Fi app live on Cloudflare Pages / Vercel (HTTPS). |
| 8–9 | Bass app + laptop mode. |
| 10 | ghostfield-crew app (1 agent, 1 tool) + Kiro Power. |
| 11 (Dec 1) | Feature freeze. Credits claimed. |
| 12–13 | Video (< 3:00, public YouTube), DEV.to blog, #KiroweenHackathon26 post. |
| 14 (Dec 4) | Audit and submit early. |

Fallback: if WebGPU is not working by Day 5, ship CPU-only.

## Day 1 checks (verify before relying on them)
- Kiro v1 `PreToolUse` hook with exit code 2 actually blocks a bad `.wgsl` write.
- Kiro Crew app-kit APIs (`kirocrew app init`, `verify_proxy_request`, `useChatLauncher`). These were NOT found in local Kiro Crew docs.

## Working rules
- Host memory is low. Run one agent at a time. Run targeted tests, not full suites.
- The user tests in a real browser, judges the sound, records the video and submits.

## First task
Scaffold `ghostfield/` (pnpm workspace, TypeScript, Vitest, fast-check, MIT LICENSE, `.kiro/steering/{product,tech,structure}.md`). Then build the pure-TS solver in `packages/ghostfield-core/src/cpu/` and make tests 6 and 7 pass first.

## Round 7 (2026-11-27): the owner's new request overrides the old brief

The first brief said "do not build image floor-plan tracing". The owner has now asked for it, so **that rule no longer applies**. The sketch importer is built (`importSketch` in `packages/ghostfield-ui`) and used in three places: the Wi-Fi app, the bass app (PR #12, merged) and the Echo Stalker game ("Play Your Sketch", merged).

Also new in round 7:
- A live wave mode in the engine (`createLiveSim`), so a click can send a ping and the wave can be watched.
- The radar look (palette, afterglow, thump, bottom bar, Before/After slider, mission pills) in the Wi-Fi and bass apps (PR #12, merged).
- A third product, `apps/echo-stalker`, an echolocation stealth game at `/echo/` (merged as dff356c). It is now part of the plan: three things on one engine.
- A shared package `packages/ghostfield-ui` for the look and the sketch importer.

Still true: the models are 2D, Wi-Fi is relative signal not dBm, live pings run in slow motion, and only numbers our own tests print may be quoted. Facts and gaps: `docs/echo-stalker.md`, `docs/radar-and-sketch.md`, README "Honest limits".
