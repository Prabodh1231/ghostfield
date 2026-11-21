# GhostField: structure

```
ghostfield/
  LICENSE                      # MIT
  .kiro/                       # specs, hooks, steering; never in .gitignore
  packages/ghostfield-core/    # engine only: no UI, no domain code
    src/coefficients.ts        # shared by cpu/ and gpu/
    src/cpu/                   # pure-TS Float32Array reference solver and CPU fallback
    src/gpu/                   # WGSL compute shaders + WebGPU runner
    src/runtime/detectBackend.ts
    tests/                     # Vitest + fast-check physics tests
  apps/wifi-deadzone/          # Vite + React static SPA
  apps/bass-ghost-finder/      # Vite + React static SPA
  powers/ghostfield-fdtd/      # Kiro Power (format unverified; check Kiro docs first)
```

Rules:

- Core has no UI and no app-specific code.
- Materials and sources live in each app. The `Material -> (C, L, gu, gq)` conversion lives in core.
- Steering files are append-only after the scaffold.
- The separate `ghostfield-crew` repo is out of this tree.
