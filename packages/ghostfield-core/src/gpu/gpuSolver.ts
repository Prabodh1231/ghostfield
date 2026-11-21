import type { CoefficientSet } from "../coefficients";
import type { Cpml } from "../cpu/cpml";
import type { Probe, Source } from "../cpu/solver";
import { Q_KERNEL, U_KERNEL, WORKGROUP } from "./shaders";

export const MAX_SOURCES = 8;
export const MAX_PROBES = 8;
/** Steps recorded into one command buffer and sent in one queue.submit. Each step has its own params buffer. */
export const STEPS_PER_SUBMIT = 16;

export interface GpuSolverOptions {
  /** CPML built for the same CoefficientSet. Its profiles are copied; psi is kept in strips here. */
  cpml?: Cpml;
  /** Solid-cell mask (1 = solid), as for cpu rigidWalls. Applied after CPML, like composeBoundaries(cpml, walls). */
  solid?: Uint8Array;
}

/** Profile arrays that Cpml keeps private. Read by name so the GPU copy cannot drift from the CPU one. */
interface CpmlProfiles {
  thickness: number;
  bFx: Float64Array; aFx: Float64Array; kFx: Float64Array;
  bCx: Float64Array; aCx: Float64Array; kCx: Float64Array;
  bFy: Float64Array; aFy: Float64Array; kFy: Float64Array;
  bCy: Float64Array; aCy: Float64Array; kCy: Float64Array;
}

// WebGPU usage flag values, as numbers so importing this module needs no GPUBufferUsage global (Node).
const USAGE = { MAP_READ: 0x1, COPY_SRC: 0x4, COPY_DST: 0x8, UNIFORM: 0x40, STORAGE: 0x80 };
const MAP_READ_MODE = 1;
const STORAGE = USAGE.STORAGE | USAGE.COPY_DST | USAGE.COPY_SRC;

/**
 * WebGPU runner with the same Source / Probe interface as CpuSolver.
 * run() and readU() are async because GPU readback is. Sources and probes are limited to 8 each.
 */
export class GpuSolver {
  readonly nx: number;
  readonly ny: number;
  readonly dt: number;
  step = 0;
  readonly sources: Source[] = [];
  readonly probes: Probe[] = [];
  private readonly dev: GPUDevice;
  private readonly invDx: number;
  private readonly T: number;
  private readonly cpml: boolean;
  private readonly params: GPUBuffer[] = [];
  private readonly bufU: GPUBuffer;
  private readonly bufQx: GPUBuffer;
  private readonly bufQy: GPUBuffer;
  private readonly bufCoef: GPUBuffer;
  private readonly bufProf: GPUBuffer;
  private readonly bufPsiQ: GPUBuffer;
  private readonly bufPsiU: GPUBuffer;
  private readonly bufSolid: GPUBuffer;
  private readonly pipeQ: GPUComputePipeline;
  private readonly pipeU: GPUComputePipeline;
  private readonly paramData = new ArrayBuffer(288);

  constructor(dev: GPUDevice, cs: CoefficientSet, opts: GpuSolverOptions = {}) {
    const { nx, ny } = cs;
    this.dev = dev;
    this.nx = nx;
    this.ny = ny;
    this.dt = cs.dt;
    this.invDx = 1 / cs.dx;
    const cp = opts.cpml as unknown as CpmlProfiles | undefined;
    this.cpml = !!cp;
    this.T = cp ? cp.thickness : 0;
    const T = this.T;

    const mk = (bytes: number) => dev.createBuffer({ size: Math.max(16, Math.ceil(bytes / 4) * 4), usage: STORAGE });
    const upload = (b: GPUBuffer, data: ArrayBufferView) => dev.queue.writeBuffer(b, 0, data as unknown as GPUAllowSharedBufferSource);

    for (let k = 0; k < STEPS_PER_SUBMIT; k++) this.params.push(dev.createBuffer({ size: 288, usage: USAGE.UNIFORM | USAGE.COPY_DST }));
    this.bufU = mk(4 * nx * ny);
    this.bufQx = mk(4 * (nx + 1) * ny);
    this.bufQy = mk(4 * nx * (ny + 1));
    this.bufCoef = mk(4 * cs.coef.length);
    upload(this.bufCoef, cs.coef);
    // Profile: [b, a, kappa, 0] per entry: fx | cx | fy | cy.
    const counts = [nx + 1, nx, ny + 1, ny];
    const total = counts.reduce((a, b) => a + b, 0);
    this.bufProf = mk(16 * total);
    if (cp) {
      const pf = new Float32Array(4 * total);
      const srcs = [
        [cp.bFx, cp.aFx, cp.kFx], [cp.bCx, cp.aCx, cp.kCx],
        [cp.bFy, cp.aFy, cp.kFy], [cp.bCy, cp.aCy, cp.kCy],
      ] as const;
      let o = 0;
      for (const [b, a, k] of srcs) {
        for (let i = 0; i < b.length; i++, o++) {
          pf[4 * o] = b[i]!;
          pf[4 * o + 1] = a[i]!;
          pf[4 * o + 2] = k[i]!;
        }
      }
      upload(this.bufProf, pf);
    }
    this.bufPsiQ = mk(cp ? 4 * (ny * 2 * T + 2 * T * nx) : 16);
    this.bufPsiU = mk(cp ? 4 * (ny * 2 * T + 2 * T * nx) : 16);
    this.bufSolid = mk(4 * nx * ny);
    if (opts.solid) upload(this.bufSolid, Uint32Array.from(opts.solid));

    this.pipeQ = dev.createComputePipeline({
      layout: "auto",
      compute: { module: dev.createShaderModule({ code: Q_KERNEL }), entryPoint: "main" },
    });
    this.pipeU = dev.createComputePipeline({
      layout: "auto",
      compute: { module: dev.createShaderModule({ code: U_KERNEL }), entryPoint: "main" },
    });
  }

  addSource(s: Source): void {
    this.check(s.ix, s.iy);
    if (this.sources.length >= MAX_SOURCES) throw new RangeError(`at most ${MAX_SOURCES} sources`);
    this.sources.push(s);
  }

  addProbe(ix: number, iy: number): Probe {
    this.check(ix, iy);
    if (this.probes.length >= MAX_PROBES) throw new RangeError(`at most ${MAX_PROBES} probes`);
    const p: Probe = { ix, iy, samples: [] };
    this.probes.push(p);
    return p;
  }

  private check(ix: number, iy: number): void {
    if (!(Number.isInteger(ix) && Number.isInteger(iy) && ix >= 0 && iy >= 0 && ix < this.nx && iy < this.ny)) {
      throw new RangeError(`cell (${ix},${iy}) outside grid`);
    }
  }

  /** Run `steps` steps and append probe samples. Resolves when the GPU has finished. */
  async run(steps: number): Promise<void> {
    const { dev, nx, ny } = this;
    const nProbe = this.probes.length;
    const probeOut = dev.createBuffer({ size: Math.max(16, 4 * steps * Math.max(nProbe, 1)), usage: STORAGE });
    // One bind group pair per params buffer, so a batch of steps can be recorded before one submit.
    const bgs = this.params.map((params) => ({
      q: dev.createBindGroup({
        layout: this.pipeQ.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: params } },
          { binding: 1, resource: { buffer: this.bufU } },
          { binding: 2, resource: { buffer: this.bufQx } },
          { binding: 3, resource: { buffer: this.bufQy } },
          { binding: 4, resource: { buffer: this.bufCoef } },
          { binding: 5, resource: { buffer: this.bufProf } },
          { binding: 6, resource: { buffer: this.bufPsiQ } },
          { binding: 7, resource: { buffer: this.bufSolid } },
        ],
      }),
      u: dev.createBindGroup({
        layout: this.pipeU.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: params } },
          { binding: 1, resource: { buffer: this.bufU } },
          { binding: 2, resource: { buffer: this.bufQx } },
          { binding: 3, resource: { buffer: this.bufQy } },
          { binding: 4, resource: { buffer: this.bufCoef } },
          { binding: 5, resource: { buffer: this.bufProf } },
          { binding: 6, resource: { buffer: this.bufPsiU } },
          { binding: 7, resource: { buffer: probeOut } },
        ],
      }),
    }));
    const gx = Math.ceil((nx + 1) / WORKGROUP);
    const gy = Math.ceil((ny + 1) / WORKGROUP);
    for (let n0 = 0; n0 < steps; n0 += STEPS_PER_SUBMIT) {
      const enc = dev.createCommandEncoder();
      for (let n = n0; n < Math.min(steps, n0 + STEPS_PER_SUBMIT); n++) {
        const k = n - n0;
        this.step++;
        this.writeParams(this.step, n * nProbe, this.params[k]!);
        const pq = enc.beginComputePass();
        pq.setPipeline(this.pipeQ);
        pq.setBindGroup(0, bgs[k]!.q);
        pq.dispatchWorkgroups(gx, gy);
        pq.end();
        const pu = enc.beginComputePass();
        pu.setPipeline(this.pipeU);
        pu.setBindGroup(0, bgs[k]!.u);
        pu.dispatchWorkgroups(gx, gy);
        pu.end();
      }
      dev.queue.submit([enc.finish()]);
    }
    if (nProbe > 0) {
      const data = await this.read(probeOut, 4 * steps * nProbe);
      for (let n = 0; n < steps; n++) for (let k = 0; k < nProbe; k++) this.probes[k]!.samples.push(data[n * nProbe + k]!);
    } else {
      await dev.queue.onSubmittedWorkDone();
    }
    probeOut.destroy();
  }

  /** Copy the u field back to the CPU. */
  async readU(): Promise<Float32Array> {
    return this.read(this.bufU, 4 * this.nx * this.ny);
  }

  destroy(): void {
    for (const b of [...this.params, this.bufU, this.bufQx, this.bufQy, this.bufCoef, this.bufProf, this.bufPsiQ, this.bufPsiU, this.bufSolid]) b.destroy();
  }

  private writeParams(step: number, probeBase: number, target: GPUBuffer): void {
    const dv = new DataView(this.paramData);
    const t = step * this.dt;
    dv.setUint32(0, this.nx, true);
    dv.setUint32(4, this.ny, true);
    dv.setUint32(8, this.T, true);
    dv.setUint32(12, this.cpml ? 1 : 0, true);
    dv.setFloat32(16, this.invDx, true);
    dv.setUint32(20, this.sources.length, true);
    dv.setUint32(24, this.probes.length, true);
    dv.setUint32(28, probeBase, true);
    this.sources.forEach((s, k) => {
      dv.setFloat32(32 + 16 * k, s.ix, true);
      dv.setFloat32(36 + 16 * k, s.iy, true);
      dv.setFloat32(40 + 16 * k, s.value(step, t), true);
    });
    this.probes.forEach((p, k) => {
      dv.setUint32(160 + 16 * k, p.ix, true);
      dv.setUint32(164 + 16 * k, p.iy, true);
    });
    this.dev.queue.writeBuffer(target, 0, this.paramData);
  }

  private async read(src: GPUBuffer, bytes: number): Promise<Float32Array> {
    const staging = this.dev.createBuffer({ size: Math.max(16, bytes), usage: USAGE.MAP_READ | USAGE.COPY_DST });
    const enc = this.dev.createCommandEncoder();
    enc.copyBufferToBuffer(src, 0, staging, 0, Math.max(16, bytes));
    this.dev.queue.submit([enc.finish()]);
    await staging.mapAsync(MAP_READ_MODE);
    const out = new Float32Array(staging.getMappedRange().slice(0, bytes));
    staging.unmap();
    staging.destroy();
    return out;
  }
}
