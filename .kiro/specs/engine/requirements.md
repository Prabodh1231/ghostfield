# Engine requirements

Short spec for `ghostfield-core`. Uses EARS style.

1. WHEN a lossless closed room is simulated, THE engine SHALL conserve the leapfrog energy form within tolerance; a lossy room SHALL only lose energy.
2. WHEN source and probe are swapped (both on u), THE engine SHALL give the same response within a small tolerance (reciprocity).
3. THE engine SHALL be mirror symmetric for mirror-symmetric inputs.
4. IN the far field, THE 2D amplitude SHALL fall as r^-0.5.
5. THE 16-cell CPML SHALL reflect less than -60 dB at the angles the test measures.
6. THE engine SHALL reject a Courant number above 1/sqrt(2) = 0.7071 and default to 0.693. ETD coefficient A SHALL be in [0,1], with no NaN, including the gamma -> 0 limit.
7. FOR a rectangular room, measured mode frequencies SHALL match `f = (c/2)*sqrt((m/Lx)^2 + (n/Ly)^2)` within 1% in f32.
8. THE CPU and GPU solvers SHALL read coefficients from one shared module, `src/coefficients.ts`.
9. WHEN no WebGPU adapter exists, or it is a fallback adapter, THE runtime SHALL use the TS solver in a Web Worker.

Only numbers printed by our own tests may be quoted in claims.
