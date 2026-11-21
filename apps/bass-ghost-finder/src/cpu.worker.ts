import { runCpuJob, type FieldJob } from "@core/runtime/cpuJob";
import { runCpuResponse, type ResponseJob } from "@core/runtime/responseJob";

/** One job per worker; the app terminate()s the worker to cancel. */
interface Scope {
  onmessage: ((e: { data: { type: "field"; job: FieldJob } | { type: "response"; job: ResponseJob } }) => void) | null;
  postMessage(msg: unknown, transfer?: Transferable[]): void;
}
const scope = self as unknown as Scope;

scope.onmessage = (e) => {
  try {
    const m = e.data;
    if (m.type === "field") {
      const r = runCpuJob(m.job, (fraction, phase) => scope.postMessage({ type: "progress", fraction, phase }));
      if (r) scope.postMessage({ type: "done", result: r }, [r.power.buffer]);
    } else {
      const r = runCpuResponse(m.job, (fraction) => scope.postMessage({ type: "progress", fraction, phase: "response" }));
      if (r) scope.postMessage({ type: "done", result: r }, [r.probe.buffer, r.source.buffer]);
    }
  } catch (err) {
    scope.postMessage({ type: "error", message: String(err) });
  }
};

