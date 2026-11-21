
# GhostField plan review (round 1)

Reviewer only. No code written. Items marked **MUST** or **NICE**.

## 1. Premises and physics

1. **ETD B formula: correct. Precompute it carefully. MUST.** For `u' = -γu + S`, exact decay gives `u+ = A·u + (1-A)/γ · S`. With `S = -div q / C` this equals `B·(-div q)`, where `B = (1-A)/(γΔt) · Δt/C`. The brief matches. The risk is f32 and small γ: `(1-A)/(γΔt)` cancels badly. Compute in f64 with `-expm1(-γΔt)/γ`, and use the limit `Δt/C` when `γΔt < ~1e-8`. Cast to f32 only at the end. Test 6 should check the γ→0 limit.

2. **CFL 0.693: fine, but the reason is wrong. NICE.** The 2D Yee limit is `1/√2 = 0.7071`. 0.693 is a 98% safety margin, not a limit. Write that in `tech.md`. Test 6 should assert S ≤ 0.7071 as a hard limit and 0.693 as the default. It must use the fastest speed in the grid, not only free air. Here that is free air, so keep the guard anyway.

3. **Test 1 energy is ill-defined for leapfrog. MUST.** The naive `Σ(C u² + L q²)` oscillates a little even in a lossless room. The conserved quantity uses `q` at two time levels (`L·q(n-½)·q(n+½)`). Use that form, or allow a tolerance. "Lossy only loses" must use the same form. Otherwise the test fails on correct code.

4. **Test 7 room modes: feasible, with conditions. MUST.**
   - Resolution: 1% of the 26.8 Hz mode is 0.27 Hz. A plain FFT needs more than 4 s. At Δt ≈ 50 µs that is more than 80k steps on 65k cells, about 5 G cell updates. Pure TS does this in roughly 30–90 s. Use zero-padded DFT with peak interpolation and 6–8 s of record. Run it as a single example test, not as fast-check with many runs.
   - Use a non-square room, such as 256×200. A square room has degenerate modes ((1,2)=(2,1)) that merge peaks.
   - Define the wall position. On a staggered grid the rigid wall sits at a q-node face. State that Lx = N·Δx exactly. An off-by-half-cell error is 0.2–0.4% at 256 cells and would eat the 1% budget.
   - Put the source and probe off nodal lines, and avoid symmetric spots.
   - Dispersion at 300 Hz is about 46 cells per wavelength, around 0.05%. f32 round-off over 160k steps does not move the frequency. Both are fine.
   - Compare against the formula only. Also run an f64 build once to separate dispersion from f32 error, if the test fails.

5. **CPML -60 dB on 768×768 at 1 cm: tight. MUST.**
   - 2.4 GHz has λ = 12.5 cm, which is only 12.5 cells per wavelength. That is coarse: phase-speed error is about 1% and grazing waves are worse.
   - 16 cells is 1.3 λ. -60 dB is reachable with a polynomial σ profile (order 3), κ and α terms, but not guaranteed at grazing incidence.
   - Do not run test 5 on 768². Run it on a small domain (for example 200×200) with the same 16-cell layer. Measure against a large reference domain.
   - Make the -60 dB claim only for the angles the test measures. Say which.

6. **Wi-Fi is 2D, so "dBm" is not calibrated. MUST (wording).** A 2D field spreads as r^-0.5. Real 3D power falls as r^-1. Label the map "relative signal, 2D model", or calibrate with a 1/r correction. Do not label it dBm without that. Judges will check.

7. **Bass is plan-view only. MUST (wording).** The 2D model has no height modes. Real room booms include floor-to-ceiling modes. Say "horizontal modes". A 5 cm foam trap is 2 cells at 2.5 cm and absorbs weakly below 300 Hz. That is real physics, not a bug. Do not promise large effects from it.

8. **WebGPU limit of 8 storage buffers: likely exceeded with CPML. MUST.** Count for Wi-Fi: u, qx, qy, A/B for u, A/B for q, plus CPML ψ arrays for each direction. That is over 8 unless packed. Pack coefficients into `vec4` buffers and keep ψ only in the border strips. Decide the packing before round 1 b) writes the CPU data layout, so the CPU layout can mirror it.

9. **Test 4 (r^-0.5) depends on CPML. NICE.** Run it in the far field (kr ≫ 1) and only after test 5, or use a big domain with a time gate before reflections return.

10. **Test 2 reciprocity under ETD. NICE.** Different A for u and q can break exact discrete symmetry. Use the same source and probe type (both on u) and a small tolerance. Check it with a lossless case first.

11. **Unverified claims. MUST.** `plugin.json` for a Kiro Power, the hook `exit 2` behavior, and the Crew app-kit APIs are all unverified. Real Kiro Powers use a `POWER.md` layout, not necessarily `plugin.json`. Check against Kiro docs before building `powers/`.

## 2. Hand-offs and shared files

12. **Coefficient precompute is the shared seam. MUST.** `cpu/` and `gpu/` must read the same precomputed arrays and the same grid index layout. Put them in one module (for example `src/coefficients.ts`) in round 1 b), not inside the CPU solver. WGSL parity (later) breaks if each writes its own.

13. **Solver API must leave room for CPML and probes now. MUST.** Tests 1–5 later will edit the solver and the test helpers b) creates. If b) hardcodes rigid walls, test 5 forces a rewrite. Add a boundary hook and a source/probe interface in b), even if CPML itself comes later.

14. **Steering files and `.kiro/` are touched by every task. NICE.** Treat them as append-only after b). The hook check (c) may change what the hooks in `.kiro/` look like, so c) should run before the hooks are written.

15. **Materials are shared by both apps. NICE.** Keep materials and sources in each app, as the brief says, but keep the `Material → (C, L, γu, γq)` conversion in core.

## 3. Schedule

16. **Biggest risks: WebGPU parity (days 4–5), two apps in four days (6–9), and the crew app (day 10). MUST (plan the cut).** The crew app depends on APIs not found locally. Its risk is the highest and its payoff the lowest.

17. **Cut order. MUST (agree now).**
    1. `ghostfield-crew` (separate repo, unverified APIs).
    2. Kiro Power, only if the format check fails.
    3. L-shaped rooms and laptop mode in the bass app.
    4. WebGPU (ship CPU-in-Worker; the brief already allows this at Day 5). CPU cost is feasible: about 3,000 steps × 590k cells ≈ 2 G updates, roughly 20–40 s in a Worker, so use a smaller grid.
    5. Bass app, last. Keep Wi-Fi plus one more strong feature.
    Do not cut: tests 6, 7, 5, the public repo, the video.

18. **Human gates are on the critical path. MUST.** The user must claim the 4,000 credits before Dec 1 12:00 PT. That is the same day as feature freeze. The user must also sign in for the public GitHub publish, record the video and submit. Ask the user to do the credit claim and GitHub sign-in this week, not on Dec 1.

19. **Kiro-use evidence is thin. NICE.** Judges look for specs, hooks and steering. The plan has steering and a hook check but no `.kiro/specs/`. Add one spec (engine) while building, not afterward.

20. **Dates check out.** Dec 4 2:00 PM PT is Dec 5 03:30 IST. Nov 21 is day 1 and Dec 1 is day 11.

## 4. Round 1 b) and c)

21. **Split b) into b1 and b2. MUST.**
    - b1: scaffold (pnpm, TS, Vitest, fast-check, LICENSE, steering). Proof: `pnpm vitest --version` and an empty passing test.
    - b2: solver, coefficients, test 6, then test 7.
    A scaffold failure (pnpm missing, install on low memory) should not hide solver progress.

22. **Do test 6 first, then 7. Run them one file at a time. MUST.** Test 7 takes minutes. Use `vitest run <file>`, a single fork (`--pool=forks --poolOptions.forks.singleFork`), and a long timeout (for example 300 s). Free memory is about 2 GB, so do not run Vitest watch mode.

23. **Check pnpm and Node versions first. NICE.** Record them in the proof file.

24. **Order c) before the hooks half of b1. NICE.** The hook test is quick. If exit 2 does not block, the steering text and hook design change.

25. **c) in a scratch folder may not test the right thing. MUST.** Kiro hooks load from the workspace's `.kiro/`. A worker in Kiro Crew is not the Kiro IDE or CLI, so a PreToolUse hook may never fire there. If it cannot run, report "not verifiable here" and ask the user to test in Kiro. Do not report a pass from reading docs. Same for the app-kit APIs: if not found, say "not found" and do not invent them.

26. **Proof files must quote only numbers the tests print. MUST.** The brief says this. For test 7, print the measured frequency, the formula value and the percent error for each mode.

Free-memory note: the 2 GB host limit fits one agent at a time, as the plan already says.
