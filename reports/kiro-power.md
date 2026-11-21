# Kiro Power: ghostfield-fdtd

Branch `feat/kiro-power`. Only `powers/ghostfield-fdtd/` and this file were added.

## Contents
```
powers/ghostfield-fdtd/
  plugin.json                       # name, version, description, author, keywords
  skills/ghostfield-engine/SKILL.md # model, coefficients, CFL rule, run a job on CPU/GPU, backend choice, tests
  skills/wifi-signal/SKILL.md       # Wi-Fi output is relative dB (2D), not dBm; setup facts; bass note
```
No `mcp.json` (no tools needed).

## Facts checked against code (origin/main at ecbd5fc)
CFL_LIMIT 0.7071, DEFAULT_COURANT 0.693, cMax = 1/sqrt(min C * min L), stride-4 coef `[Au,Bu,Aq,Bq]`, ETD with expm1 and 1e-8 cutoff, `FieldJob` / `runCpuJob` / `runGpuJob` signatures, `makePlan` 3-snapshot rule, CPML defaults, `detectBackend` and `CPU_GRID_SCALE` 0.5, GPU limits (8 sources, 8 probes, 16 steps per submit), `referencePower` / `toDb` in `apps/wifi-deadzone/src/scene.ts`.

## Install in Kiro
Powers panel, Add Custom Power, Import from a folder, pick `powers/ghostfield-fdtd`. A GitHub URL to that folder should also work.

## Checked
- `plugin.json` parses as JSON; layout matches `reports/day1-checks.md` section 3.

## Not tested
- Never loaded in Kiro (no IDE run). The `$schema` URL and skill front matter follow the docs as quoted in day1-checks, not a live validator.
- Code samples were not compiled or run.
- Bass claims (horizontal modes, pressure mapping) come from the project design notes. The bass app is in PR #6 and was not read.
