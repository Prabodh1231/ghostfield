/**
 * WGSL for the FDTD step. Mirrors cpu/solver.ts + cpu/cpml.ts + cpu/walls.ts, same order:
 *   1. q update (interior faces)  2. CPML q correction  3. rigid-wall zeroing
 *   4. u update  5. soft sources  6. CPML u correction  7. probes
 * Steps 1-3 are the Q kernel, steps 4-7 the U kernel. Two dispatches per step, so every
 * kernel reads the finished output of the previous one (no cross-workgroup races).
 *
 * Storage buffers per pipeline (limit 8): Q kernel 7 (u, qx, qy, coef, prof, psiQ, solid),
 * U kernel 7 (u, qx, qy, coef, prof, psiU, probeOut). Both also use 1 uniform buffer.
 *
 * Coefficient buffer: array<vec4<f32>> per cell = [Au, Bu, Aq, Bq].
 * Face rule (same as the CPU): face i of qx and face j of qy use the coefficients of the cell
 * on their HIGH side. Faces ix = nx and iy = ny have no cell, so they are never written
 * (they stay 0 = rigid outer wall) and never read coefficients.
 *
 * CPML profile buffer: array<vec4<f32>> of [b, a, kappa, 0], concatenated:
 *   fx (nx+1) | cx (nx) | fy (ny+1) | cy (ny).
 * CPML psi lives only in the layer strips, 2T lines per axis. Line index for a coordinate p
 * on an axis of length n: p < T ? p : p - (n - T) + T.
 *   psiQ = [ psiQx: ny rows x 2T | psiQy: 2T rows x nx ]   (same layout for psiU)
 */
export const WORKGROUP = 16;

const COMMON = /* wgsl */ `
struct Params {
  nx: u32, ny: u32, T: u32, cpml: u32,
  invDx: f32, nSrc: u32, nProbe: u32, probeBase: u32,
  src: array<vec4<f32>, 8>,     // x = ix, y = iy, z = value to add this step
  probes: array<vec4<u32>, 8>,  // x = ix, y = iy
};
@group(0) @binding(0) var<uniform> P: Params;
@group(0) @binding(4) var<storage, read> coef: array<vec4<f32>>;
@group(0) @binding(5) var<storage, read> prof: array<vec4<f32>>;

fn lineIdx(p: u32, n: u32) -> u32 {
  if (p < P.T) { return p; }
  return p - (n - P.T) + P.T;
}
`;

export const Q_KERNEL = /* wgsl */ `
${COMMON}
@group(0) @binding(1) var<storage, read> u: array<f32>;
@group(0) @binding(2) var<storage, read_write> qx: array<f32>;
@group(0) @binding(3) var<storage, read_write> qy: array<f32>;
@group(0) @binding(6) var<storage, read_write> psiQ: array<f32>;
@group(0) @binding(7) var<storage, read> solid: array<u32>;

@compute @workgroup_size(${WORKGROUP}, ${WORKGROUP}, 1)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let i = id.x;
  let j = id.y;
  let nx = P.nx;
  let ny = P.ny;
  let T = P.T;
  // qx face (i, j): i in 1..nx-1, j in 0..ny-1. Face nx has no cell, so it is skipped.
  if (i >= 1u && i < nx && j < ny) {
    let c = j * nx + i;
    let cf = coef[c];
    let g = (u[c] - u[c - 1u]) * P.invDx;
    let p = j * (nx + 1u) + i;
    var q = cf.z * qx[p] - cf.w * g;
    if (P.cpml == 1u && (i < T || i > nx - T)) {
      let pr = prof[i];                     // fx
      let s = j * 2u * T + lineIdx(i, nx);
      let psi = pr.x * psiQ[s] + pr.y * g;
      psiQ[s] = psi;
      q = q - cf.w * ((1.0 / pr.z - 1.0) * g + psi);
    }
    if (solid[c] != 0u || solid[c - 1u] != 0u) { q = 0.0; }
    qx[p] = q;
  }
  // qy face (i, j): i in 0..nx-1, j in 1..ny-1. Face ny has no cell, so it is skipped.
  if (i < nx && j >= 1u && j < ny) {
    let c = j * nx + i;
    let cf = coef[c];
    let g = (u[c] - u[c - nx]) * P.invDx;
    var q = cf.z * qy[c] - cf.w * g;
    if (P.cpml == 1u && (j < T || j > ny - T)) {
      let pr = prof[2u * nx + 1u + j];      // fy
      let s = ny * 2u * T + lineIdx(j, ny) * nx + i;
      let psi = pr.x * psiQ[s] + pr.y * g;
      psiQ[s] = psi;
      q = q - cf.w * ((1.0 / pr.z - 1.0) * g + psi);
    }
    if (solid[c] != 0u || solid[c - nx] != 0u) { q = 0.0; }
    qy[c] = q;
  }
}
`;

export const U_KERNEL = /* wgsl */ `
${COMMON}
@group(0) @binding(1) var<storage, read_write> u: array<f32>;
@group(0) @binding(2) var<storage, read> qx: array<f32>;
@group(0) @binding(3) var<storage, read> qy: array<f32>;
@group(0) @binding(6) var<storage, read_write> psiU: array<f32>;
@group(0) @binding(7) var<storage, read_write> probeOut: array<f32>;

@compute @workgroup_size(${WORKGROUP}, ${WORKGROUP}, 1)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let i = id.x;
  let j = id.y;
  let nx = P.nx;
  let ny = P.ny;
  let T = P.T;
  if (i >= nx || j >= ny) { return; }
  let c = j * nx + i;
  let cf = coef[c];
  let rowQx = j * (nx + 1u);
  let div = qx[rowQx + i + 1u] - qx[rowQx + i] + qy[c + nx] - qy[c];
  var v = cf.x * u[c] - cf.y * div * P.invDx;
  for (var k = 0u; k < P.nSrc; k = k + 1u) {
    let s = P.src[k];
    if (u32(s.x) == i && u32(s.y) == j) { v = v + s.z; }
  }
  if (P.cpml == 1u) {
    if (i < T || i >= nx - T) {
      let pr = prof[nx + 1u + i];           // cx
      let d = (qx[rowQx + i + 1u] - qx[rowQx + i]) * P.invDx;
      let s = j * 2u * T + lineIdx(i, nx);
      let psi = pr.x * psiU[s] + pr.y * d;
      psiU[s] = psi;
      v = v - cf.y * ((1.0 / pr.z - 1.0) * d + psi);
    }
    if (j < T || j >= ny - T) {
      let pr = prof[2u * nx + ny + 2u + j]; // cy
      let d = (qy[c + nx] - qy[c]) * P.invDx;
      let s = ny * 2u * T + lineIdx(j, ny) * nx + i;
      let psi = pr.x * psiU[s] + pr.y * d;
      psiU[s] = psi;
      v = v - cf.y * ((1.0 / pr.z - 1.0) * d + psi);
    }
  }
  u[c] = v;
  for (var k = 0u; k < P.nProbe; k = k + 1u) {
    let pb = P.probes[k];
    if (pb.x == i && pb.y == j) { probeOut[P.probeBase + k] = v; }
  }
}
`;
