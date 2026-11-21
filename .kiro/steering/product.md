# GhostField: product

Kiroween 2026 entry, Skeleton Crew category. MIT license, public repo.

One lean 2D wave-physics engine (FDTD, staggered Yee grid) powers two browser apps:

1. `apps/wifi-deadzone`: 2.4 GHz Wi-Fi dead-zone map. Draw walls, drag the router, see a heatmap.
2. `apps/bass-ghost-finder`: 20-300 Hz room bass modes. Draw a room, drop bass traps, see and hear booms and nulls.

Each app only supplies its own materials, sources, probes and UI.

## Wording rules (honest claims)

- The Wi-Fi map shows **relative signal, 2D model**. It is NOT dBm. A 2D field spreads as r^-0.5, real 3D power as r^-1.
- Bass results are **horizontal modes** (plan view). The model has no floor-to-ceiling modes.
- A 5 cm foam trap absorbs weakly below 300 Hz. Do not promise large effects.
- Quote only numbers our own tests print. Numbers in earlier research docs are unverified.

## Cut (do not build)

Rust/WASM SIMD, Crank-Nicolson, RLC tuned trap, 2.5D ceiling overlay, ConvolverNode reverb, image floor-plan tracing, 5 GHz.
