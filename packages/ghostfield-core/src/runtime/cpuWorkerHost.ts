import { runCpuJob, type FieldJob, type FieldResult } from "./cpuJob";

/**
 * Web Worker host for the CPU fallback. A worker file only has to `import` this module.
 *
 * Messages in:  { type: "run", job: FieldJob }   (a new "run" replaces the old one)
 * Messages out: { type: "progress", fraction, phase } | { type: "done", result } | { type: "error", message }
 *
 * shortcut: the loop runs without yielding, so a "run" sent while another is running is only seen
 * after it ends. The app cancels by terminate()-ing the worker and starting a new one.
 */
interface WorkerScope {
  onmessage: ((e: { data: { type: string; job?: FieldJob } }) => void) | null;
  postMessage(msg: unknown, transfer?: Transferable[]): void;
}
const scope = self as unknown as WorkerScope;

scope.onmessage = (e) => {
  if (e.data.type !== "run" || !e.data.job) return;
  try {
    const result: FieldResult | null = runCpuJob(e.data.job, (fraction, phase) => scope.postMessage({ type: "progress", fraction, phase }));
    if (result) scope.postMessage({ type: "done", result }, [result.power.buffer]);
  } catch (err) {
    scope.postMessage({ type: "error", message: String(err) });
  }
};
