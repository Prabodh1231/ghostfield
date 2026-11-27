import { Q_KERNEL, U_KERNEL, WORKGROUP } from "../gpu/shaders";
import { STEPS_PER_SUBMIT } from "../gpu/gpuSolver";
import { checkCell, checkMaterial, cellCoef } from "./cpuLive";
import { PulseBank } from "./pulse";
import { MAX_PULSES, type LiveSim, type LiveSimOptions } from "./types";

// WebGPU usage flags as numbers (no GPUBufferUsage global in Node).
const USAGE = { MAP_READ: 0x1, COPY_SRC: 0x4, COPY_DST: 0x8, UNIFORM: 0x40, STORAGE: 0x80 };
const STORAGE = USAGE.STORAGE | USAGE.COPY_DST | USAGE.COPY_SRC;

/**
 * GPU live sim. Reuses the batch kernels unchanged (no CPML). advance() only records and submits;
 * the field is copied back with a non-blocking mapAsync, one copy in flight at a time.
 */
export function createGpuLive(opts: LiveSimOptions): LiveSim {
  const dev = opts.device;
  if (!dev) throw new Error("gpu backend needs opts.device");
  const { cs } = opts;
  const { nx, ny, dx, dt } = cs;
  const invDx = 1 / dx;
  const bank = new PulseBank(opts.pulseHz ?? 400, dt);
  const every = Math.max(1, opts.readbackEvery ?? 1);
  let step = 0;
  let calls = 0;
  const f32 = (n: number) => dev.createBuffer({ size: Math.max(16, 4 * n), usage: STORAGE });
  const bufU = f32(nx * ny);
  const bufQx = f32((nx + 1) * ny);
  const bufQy = f32(nx * (ny + 1));
  const bufCoef = f32(cs.coef.length);
  const bufProf = f32(4);
  const bufPsi = f32(4);
  const bufPsi2 = f32(4);
  const bufProbe = f32(4);
  const bufSolid = f32(nx * ny);
  const w = (b: GPUBuffer, off: number, d: ArrayBufferView) => dev.queue.writeBuffer(b, off, d as unknown as GPUAllowSharedBufferSource);
  w(bufCoef, 0, cs.coef);
  if (opts.solid) w(bufSolid, 0, Uint32Array.from(opts.solid));
  const params: GPUBuffer[] = [];
  for (let k = 0; k < STEPS_PER_SUBMIT; k++) params.push(dev.createBuffer({ size: 288, usage: USAGE.UNIFORM | USAGE.COPY_DST }));
  const pipeQ = dev.createComputePipeline({ layout: "auto", compute: { module: dev.createShaderModule({ code: Q_KERNEL }), entryPoint: "main" } });
  const pipeU = dev.createComputePipeline({ layout: "auto", compute: { module: dev.createShaderModule({ code: U_KERNEL }), entryPoint: "main" } });
  const bgs = params.map((p) => ({
    q: dev.createBindGroup({
      layout: pipeQ.getBindGroupLayout(0),
      entries: [p, bufU, bufQx, bufQy, bufCoef, bufProf, bufPsi, bufSolid].map((buffer, binding) => ({ binding, resource: { buffer } })),
    }),
    u: dev.createBindGroup({
      layout: pipeU.getBindGroupLayout(0),
      entries: [p, bufU, bufQx, bufQy, bufCoef, bufProf, bufPsi2, bufProbe].map((buffer, binding) => ({ binding, resource: { buffer } })),
    }),
  }));
  const gx = Math.ceil((nx + 1) / WORKGROUP);
  const gy = Math.ceil((ny + 1) / WORKGROUP);
  const paramData = new ArrayBuffer(288);
  const staging = dev.createBuffer({ size: Math.max(16, 4 * nx * ny), usage: USAGE.MAP_READ | USAGE.COPY_DST });
  const snapshot = new Float32Array(nx * ny);
  let pending = false;
  let dead = false;
  const zero4 = new Uint32Array(1);

  const writeParams = (s: number, target: GPUBuffer) => {
    const dv = new DataView(paramData);
    dv.setUint32(0, nx, true);
    dv.setUint32(4, ny, true);
    dv.setUint32(8, 0, true);
    dv.setUint32(12, 0, true);
    dv.setFloat32(16, invDx, true);
    let n = 0;
    for (let k = 0; k < MAX_PULSES; k++) {
      if (!bank.alive[k]) continue;
      const v = bank.value(k, s);
      if (v === 0) continue;
      dv.setFloat32(32 + 16 * n, bank.ix[k]!, true);
      dv.setFloat32(36 + 16 * n, bank.iy[k]!, true);
      dv.setFloat32(40 + 16 * n, v, true);
      n++;
    }
    dv.setUint32(20, n, true);
    dv.setUint32(24, 0, true);
    dv.setUint32(28, 0, true);
    dev.queue.writeBuffer(target, 0, paramData);
  };

  const readback = () => {
    if (pending || dead) return;
    pending = true;
    const enc = dev.createCommandEncoder();
    enc.copyBufferToBuffer(bufU, 0, staging, 0, Math.max(16, 4 * nx * ny));
    dev.queue.submit([enc.finish()]);
    staging.mapAsync(1).then(
      () => {
        snapshot.set(new Float32Array(staging.getMappedRange(0, 4 * nx * ny)));
        staging.unmap();
        pending = false;
      },
      () => {
        pending = false;
      },
    );
  };

  return {
    backend: "gpu",
    nx,
    ny,
    dx,
    dt,
    get step() {
      return step;
    },
    advance(n) {
      for (let n0 = 0; n0 < n; n0 += STEPS_PER_SUBMIT) {
        const enc = dev.createCommandEncoder();
        for (let i = n0; i < Math.min(n, n0 + STEPS_PER_SUBMIT); i++) {
          const k = i - n0;
          step++;
          writeParams(step, params[k]!);
          const pq = enc.beginComputePass();
          pq.setPipeline(pipeQ);
          pq.setBindGroup(0, bgs[k]!.q);
          pq.dispatchWorkgroups(gx, gy);
          pq.end();
          const pu = enc.beginComputePass();
          pu.setPipeline(pipeU);
          pu.setBindGroup(0, bgs[k]!.u);
          pu.dispatchWorkgroups(gx, gy);
          pu.end();
        }
        dev.queue.submit([enc.finish()]);
      }
      if (++calls % every === 0) readback();
    },
    field: () => snapshot,
    addPulse(x, y, amp) {
      checkCell(nx, ny, x, y);
      return bank.add(x, y, amp, step);
    },
    setSolid(ix, iy, s) {
      checkCell(nx, ny, ix, iy);
      const c = iy * nx + ix;
      zero4[0] = s ? 1 : 0;
      w(bufSolid, 4 * c, zero4);
      zero4[0] = 0;
      w(bufU, 4 * c, zero4);
    },
    setMaterial(ix, iy, m) {
      checkCell(nx, ny, ix, iy);
      checkMaterial(m, cs.cMax);
      w(bufCoef, 16 * (iy * nx + ix), Float32Array.from(cellCoef(m, dt)));
    },
    reset() {
      w(bufU, 0, new Float32Array(nx * ny));
      w(bufQx, 0, new Float32Array((nx + 1) * ny));
      w(bufQy, 0, new Float32Array(nx * (ny + 1)));
      bank.clear();
      snapshot.fill(0);
    },
    destroy() {
      dead = true;
      for (const b of [bufU, bufQx, bufQy, bufCoef, bufProf, bufPsi, bufPsi2, bufProbe, bufSolid, ...params]) b.destroy();
      if (!pending) staging.destroy();
    },
  };
}
