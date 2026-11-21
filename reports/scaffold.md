# Scaffold report

## Versions
- Node: v24.21.0
- pnpm: 12.21.0 (was not installed; installed with 
pm i -g pnpm`)
- npm: 10.8.1, git: 2.43.0.windows.1

## Commands run (in order)
```
node -v; pnpm -v; git --version          # pnpm missing
npm i -g pnpm
git init -b main                         # in ghostfield/, local only
pnpm install                             # 1st run: exit 1, ERR_PNPM_IGNORED_BUILDS (esbuild@0.21.5)
# added to pnpm-workspace.yaml:  allowBuilds:\n  esbuild: true
pnpm install                             # 2nd run: exit 0
pnpm --filter ghostfield-core exec vitest run tests/smoke.test.ts
git add <specific files>; git commit
```

## Test output (verbatim, ANSI colour codes removed)
```
 RUN  v2.1.9 C:/Users/prabo/.kiro/crew/workspace/ghostfield/packages/ghostfield-core

 ✓ tests/smoke.test.ts (1 test) 4ms

 Test Files  1 passed (1)
      Tests  1 passed (1)
   Start at  16:34:24
   Duration  836ms (transform 61ms, setup 0ms, collect 236ms, tests 4ms, environment 0ms, prepare 281ms)
```

## Made
Root: package.json, pnpm-workspace.yaml, tsconfig.base.json, LICENSE (MIT, 2026 GhostField contributors), .gitignore (does not ignore .kiro/).
Core: packages/ghostfield-core/{package.json,tsconfig.json,src/cpu,src/gpu,src/runtime,tests/smoke.test.ts}.
Kiro: .kiro/steering/{product,tech,structure}.md (review fixes 2, 6, 7, 12 applied), .kiro/specs/engine/requirements.md.

## Relocation
Moved from C:\Users\prabo\.kiro\crew\workspace\ghostfield to C:\Users\prabo\Projects\ghostfield (robocopy, 72/72 files matched, old folder removed, `pnpm install` and the smoke test re-run there: 1 passed, exit 0).

## GitHub
Commands: `gh auth status` (logged in as Prabodh1231), then `gh repo create ghostfield --public --source . --push --description "2D FDTD wave engine: Wi-Fi dead zones and room bass modes in the browser"`.
Repo URL: REPOURL

## Skipped
- No .kiro/hooks, no solver code, no src/coefficients.ts, no GitHub remote or push.
- No app folders or powers/ (only apps/.gitkeep). `pnpm typecheck` not run.
- Vitest/TypeScript pinned to v2 / 5.9 by caret ranges; no vitest config file.
- Smoke test imports fast-check; verified only that it passes.
