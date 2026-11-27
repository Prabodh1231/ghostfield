import { createCpuLive } from "./cpuLive";
import { createGpuLive } from "./gpuLive";
import type { CreateLiveSim } from "./types";

export * from "./types";
export * from "./acoustics";
export { PulseBank, rickerAt } from "./pulse";

export const createLiveSim: CreateLiveSim = (opts) => (opts.backend === "gpu" ? createGpuLive(opts) : createCpuLive(opts));
