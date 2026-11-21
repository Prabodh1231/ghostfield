import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { responseSpectrum } from "@core/runtime/responseJob";
import { BassPlayer, levelAt, stackLevels, type PlayMode } from "./audio";
import {
  FREQS,
  F_MAX,
  F_MIN,
  MAX_ROOM_M,
  MIN_ROOM_M,
  TRAPS,
  buildFieldJob,
  buildResponseJob,
  buildRoom,
  defaultScene,
  isAir,
  type Scene,
  type Trap,
  type TrapType,
} from "./scene";
import { pickBackend, startField, startResponse, type Backend, type SimHandle } from "./sim";

const PX_PER_M = 100;
const GRAB_M = 0.3;
const MAP_DB = 40;
type Tool = TrapType | "erase";
interface Response {
  db: Float64Array;
}
interface Status {
  text: string;
  fraction: number | null;
  error?: boolean;
}

/** Deep blue (null) to red (boom): hue 240 to 0 degrees, brighter with level. */
function ramp(t: number): [number, number, number] {
  const h = (240 * (1 - t)) / 60;
  const v = 0.3 + 0.7 * t;
  const x = 1 - Math.abs((h % 2) - 1);
  const [r, g, b] = h < 1 ? [1, x, 0] : h < 2 ? [x, 1, 0] : h < 3 ? [0, 1, x] : h < 4 ? [0, x, 1] : [x, 0, 1];
  return [Math.round(255 * v * r), Math.round(255 * v * g), Math.round(255 * v * b)];
}

function distSeg(px: number, py: number, t: Trap): number {
  const dx = t.x2 - t.x1;
  const dy = t.y2 - t.y1;
  const l2 = dx * dx + dy * dy;
  const k = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - t.x1) * dx + (py - t.y1) * dy) / l2));
  return Math.hypot(px - (t.x1 + k * dx), py - (t.y1 + k * dy));
}

/** Local maxima of the response that stand at least 3 dB above the median. */
function findPeaks(db: Float64Array): number[] {
  const med = Array.from(db).sort((a, b) => a - b)[db.length >> 1]!;
  const out: number[] = [];
  for (let i = 2; i < db.length - 2; i++) if (db[i]! > db[i - 1]! && db[i]! >= db[i + 1]! && db[i]! > db[i - 2]! && db[i]! >= db[i + 2]! && db[i]! > med + 3) out.push(i);
  return out;
}

export default function App() {
  const [backend, setBackend] = useState<Backend | null>(null);
  const [scene, setScene] = useState<Scene>(defaultScene);
  const [tool, setTool] = useState<Tool>("foam");
  const [draft, setDraft] = useState<Trap | null>(null);
  const [freq, setFreq] = useState(40);
  const [response, setResponse] = useState<Response | null>(null);
  const [mapVersion, setMapVersion] = useState(0);
  const [stale, setStale] = useState(false);
  const [status, setStatus] = useState<Status>({ text: "Detecting backend...", fraction: null });
  const [mode, setMode] = useState<PlayMode>("laptop");
  const [volume, setVolume] = useState(5);
  const [playing, setPlaying] = useState(false);

  const planRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<HTMLCanvasElement>(null);
  const mapRef = useRef<HTMLCanvasElement | null>(null);
  const sceneRef = useRef(scene);
  const freqRef = useRef(freq);
  const backendRef = useRef<Backend | null>(null);
  const respSim = useRef<SimHandle<unknown> | null>(null);
  const mapSim = useRef<SimHandle<unknown> | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const mapTimer = useRef<number | undefined>(undefined);
  const drag = useRef<null | "sub" | "seat" | "trap">(null);
  const player = useRef<BassPlayer>(new BassPlayer());

  const room = useMemo(() => (backend ? buildRoom(draft ? { ...scene, traps: [...scene.traps, draft] } : scene, backend.dx) : null), [scene, draft, backend]);

  const runMap = useCallback(() => {
    const b = backendRef.current;
    if (!b) return;
    mapSim.current?.cancel();
    try {
      const { room: r, job } = buildFieldJob(sceneRef.current, b.dx, freqRef.current);
      const sim = startField(b, job, (f) => setStatus({ text: "Drawing the map of booms and nulls...", fraction: f }));
      mapSim.current = sim as SimHandle<unknown>;
      sim.result
        .then((res) => {
          if (!res || mapSim.current !== (sim as SimHandle<unknown>)) return;
          let pmax = 0;
          for (let i = 0; i < res.power.length; i++) if (!r.solid[i]) pmax = Math.max(pmax, res.power[i]!);
          const c = document.createElement("canvas");
          c.width = r.nx;
          c.height = r.ny;
          const img = c.getContext("2d")!.createImageData(r.nx, r.ny);
          for (let i = 0; i < res.power.length; i++) {
            const o = 4 * i;
            if (r.solid[i]) {
              img.data.set([34, 34, 38, 255], o);
              continue;
            }
            const db = 10 * Math.log10(Math.max(1e-12, res.power[i]! / pmax));
            const [R, G, B] = ramp(Math.max(0, Math.min(1, (db + MAP_DB) / MAP_DB)));
            img.data.set([R, G, B, 255], o);
          }
          c.getContext("2d")!.putImageData(img, 0, 0);
          mapRef.current = c;
          setMapVersion((v) => v + 1);
          setStale(false);
          setStatus({ text: `Done. Map at ${freqRef.current.toFixed(1)} Hz.`, fraction: null });
        })
        .catch((e) => setStatus({ text: `Map failed: ${String(e)}`, fraction: null, error: true }));
    } catch (e) {
      setStatus({ text: `Cannot start: ${String(e)}`, fraction: null, error: true });
    }
  }, []);

  const runResponse = useCallback(() => {
    const b = backendRef.current;
    if (!b) return;
    respSim.current?.cancel();
    mapSim.current?.cancel();
    try {
      const { job } = buildResponseJob(sceneRef.current, b.dx, 2);
      setStatus({ text: "Measuring the room response...", fraction: 0 });
      const sim = startResponse(b, job, (f) => setStatus({ text: "Measuring the room response...", fraction: f }));
      respSim.current = sim as SimHandle<unknown>;
      sim.result
        .then((res) => {
          if (!res || respSim.current !== (sim as SimHandle<unknown>)) return;
          const h = responseSpectrum(res, FREQS);
          setResponse({ db: Float64Array.from(h, (v) => 20 * Math.log10(Math.max(1e-30, v))) });
          runMap();
        })
        .catch((e) => setStatus({ text: `Simulation failed: ${String(e)}`, fraction: null, error: true }));
    } catch (e) {
      setStatus({ text: `Cannot start: ${String(e)}`, fraction: null, error: true });
    }
  }, [runMap]);

  useEffect(() => {
    pickBackend().then((b) => {
      backendRef.current = b;
      setBackend(b);
      runResponse();
    });
    const p = player.current;
    return () => {
      respSim.current?.cancel();
      mapSim.current?.cancel();
      p.stop();
    };
  }, [runResponse]);

  const edit = useCallback(
    (next: Scene) => {
      sceneRef.current = next;
      setScene(next);
      setStale(true);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(runResponse, 300);
    },
    [runResponse],
  );

  const chooseFreq = useCallback(
    (f: number) => {
      const v = Math.max(F_MIN, Math.min(F_MAX, f));
      freqRef.current = v;
      setFreq(v);
      setStale(true);
      window.clearTimeout(mapTimer.current);
      mapTimer.current = window.setTimeout(runMap, 300);
    },
    [runMap],
  );

  // Plan view: map, walls, traps, subwoofer, seat.
  useEffect(() => {
    const c = planRef.current;
    if (!c || !room || !backend) return;
    const k = PX_PER_M;
    c.width = Math.round(room.nx * room.dx * k);
    c.height = Math.round(room.ny * room.dx * k);
    const g = c.getContext("2d")!;
    const cell = room.dx * k;
    g.fillStyle = "#1c2430";
    g.fillRect(0, 0, c.width, c.height);
    if (mapRef.current) {
      g.imageSmoothingEnabled = true;
      g.drawImage(mapRef.current, 0, 0, c.width, c.height);
    } else {
      g.fillStyle = "#34383f";
      for (let j = 0; j < room.ny; j++) for (let i = 0; i < room.nx; i++) if (room.solid[j * room.nx + i]) g.fillRect(i * cell, j * cell, cell + 0.5, cell + 0.5);
    }
    for (let j = 0; j < room.ny; j++)
      for (let i = 0; i < room.nx; i++) {
        const rf = room.rf[j * room.nx + i]!;
        if (rf > 0) {
          g.fillStyle = rf >= TRAPS.chunk.rf ? "rgba(190,120,255,0.75)" : "rgba(255,170,60,0.8)";
          g.fillRect(i * cell, j * cell, cell + 0.5, cell + 0.5);
        }
      }
    const dot = (p: { x: number; y: number }, color: string, label: string) => {
      g.fillStyle = color;
      g.strokeStyle = "#000";
      g.lineWidth = 2;
      g.beginPath();
      g.arc(p.x * k, p.y * k, 11, 0, 2 * Math.PI);
      g.fill();
      g.stroke();
      g.fillStyle = "#000";
      g.font = "bold 10px system-ui";
      g.textAlign = "center";
      g.fillText(label, p.x * k, p.y * k + 3.5);
    };
    dot(scene.sub, "#ffd24a", "SUB");
    dot(scene.seat, "#6ee07a", "SEAT");
  }, [room, backend, scene.sub, scene.seat, mapVersion]);

  // Response chart.
  useEffect(() => {
    const c = chartRef.current;
    if (!c) return;
    c.width = 640;
    c.height = 240;
    const g = c.getContext("2d")!;
    g.fillStyle = "#14161a";
    g.fillRect(0, 0, 640, 240);
    const L = 44;
    const R = 628;
    const T = 10;
    const B = 212;
    const xOf = (f: number) => L + ((f - F_MIN) / (F_MAX - F_MIN)) * (R - L);
    g.font = "11px system-ui";
    g.fillStyle = "#b9bec7";
    g.strokeStyle = "#2a2f38";
    g.textAlign = "center";
    for (let f = 50; f <= 300; f += 50) {
      g.beginPath();
      g.moveTo(xOf(f), T);
      g.lineTo(xOf(f), B);
      g.stroke();
      g.fillText(`${f}`, xOf(f), B + 14);
    }
    g.fillText("Hz", R - 6, B + 28);
    if (response) {
      const d = response.db;
      let mx = -Infinity;
      for (const v of d) mx = Math.max(mx, v);
      const span = 50;
      const yOf = (v: number) => B - ((Math.max(mx - span, v) - (mx - span)) / span) * (B - T);
      g.textAlign = "right";
      for (let s = 0; s <= span; s += 10) {
        g.fillText(`${-s}`, L - 6, yOf(mx - s) + 4);
        g.beginPath();
        g.moveTo(L, yOf(mx - s));
        g.lineTo(R, yOf(mx - s));
        g.stroke();
      }
      g.strokeStyle = "#6fc3ff";
      g.lineWidth = 1.5;
      g.beginPath();
      FREQS.forEach((f, i) => (i === 0 ? g.moveTo(xOf(f), yOf(d[i]!)) : g.lineTo(xOf(f), yOf(d[i]!))));
      g.stroke();
      g.fillStyle = "#ff9d5c";
      for (const i of findPeaks(d)) {
        g.beginPath();
        g.arc(xOf(FREQS[i]!), yOf(d[i]!), 3.5, 0, 2 * Math.PI);
        g.fill();
      }
    }
    g.strokeStyle = "#ffd24a";
    g.lineWidth = 1.5;
    g.beginPath();
    g.moveTo(xOf(freq), T);
    g.lineTo(xOf(freq), B);
    g.stroke();
  }, [response, freq]);

  // Keep the sound in step with the frequency and the room.
  useEffect(() => {
    if (!playing || !response) return;
    player.current.update(mode, freq, stackLevels(FREQS, response.db, freq));
  }, [playing, mode, freq, response]);

  const planPoint = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: ((e.clientX - r.left) * (e.currentTarget.width / r.width)) / PX_PER_M, y: ((e.clientY - r.top) * (e.currentTarget.height / r.height)) / PX_PER_M };
  };

  const onDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!room) return;
    const p = planPoint(e);
    e.currentTarget.setPointerCapture(e.pointerId);
    const s = sceneRef.current;
    if (Math.hypot(p.x - s.sub.x, p.y - s.sub.y) < GRAB_M) drag.current = "sub";
    else if (Math.hypot(p.x - s.seat.x, p.y - s.seat.y) < GRAB_M) drag.current = "seat";
    else if (tool === "erase") {
      let best = -1;
      let bd = 0.5;
      s.traps.forEach((t, i) => {
        const d = t.type === "foam" ? distSeg(p.x, p.y, t) : Math.hypot(p.x - t.x1, p.y - t.y1);
        if (d < bd) {
          bd = d;
          best = i;
        }
      });
      if (best >= 0) edit({ ...s, traps: s.traps.filter((_, i) => i !== best) });
    } else if (isAir(room, p.x, p.y)) {
      drag.current = "trap";
      setDraft({ type: tool, x1: p.x, y1: p.y, x2: p.x, y2: p.y });
    }
  };

  const onMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drag.current || !room) return;
    const p = planPoint(e);
    const s = sceneRef.current;
    if (drag.current === "trap") {
      setDraft((d) => (d ? (d.type === "chunk" ? { ...d, x1: p.x, y1: p.y, x2: p.x, y2: p.y } : { ...d, x2: p.x, y2: p.y }) : d));
    } else if (isAir(room, p.x, p.y)) {
      edit({ ...s, [drag.current]: { x: p.x, y: p.y } });
    }
  };

  const onUp = () => {
    const s = sceneRef.current;
    if (drag.current === "trap" && draft) {
      const len = Math.hypot(draft.x2 - draft.x1, draft.y2 - draft.y1);
      if (draft.type === "chunk" || len >= 0.1) edit({ ...s, traps: [...s.traps, draft] });
    }
    drag.current = null;
    setDraft(null);
  };

  const setSize = (key: "w" | "h" | "notchW" | "notchH", v: number) => {
    if (!(v > 0)) return;
    const s = sceneRef.current;
    const n = { ...s, [key]: Math.max(key.startsWith("notch") ? 0.5 : MIN_ROOM_M, Math.min(MAX_ROOM_M, v)) };
    const cl = (p: { x: number; y: number }) => ({ x: Math.min(p.x, n.w - 0.2), y: Math.min(p.y, n.h - 0.2) });
    edit({ ...n, sub: cl(n.sub), seat: cl(n.seat) });
  };

  const onChartClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - r.left) * (640 / r.width);
    let f = F_MIN + ((x - 44) / (628 - 44)) * (F_MAX - F_MIN);
    if (response) {
      let best = -1;
      let bd = 6;
      for (const i of findPeaks(response.db)) if (Math.abs(FREQS[i]! - f) < bd) {
        bd = Math.abs(FREQS[i]! - f);
        best = i;
      }
      if (best >= 0) f = FREQS[best]!;
    }
    chooseFreq(Math.round(f * 2) / 2);
  };

  const togglePlay = () => {
    if (playing) {
      player.current.stop();
      setPlaying(false);
    } else if (response) {
      player.current.volume = volume / 100;
      player.current.start(mode, freq, stackLevels(FREQS, response.db, freq));
      setPlaying(true);
    }
  };

  const relDb = response ? levelAt(FREQS, response.db, freq) - Array.from(response.db).sort((a, b) => a - b)[response.db.length >> 1]! : 0;

  return (
    <div className="app">
      <h1>GhostField: bass ghost finder</h1>
      <p className="note">Horizontal modes (2D plan view, no floor-to-ceiling modes). A model, not a measurement. Thin foam does little below 300 Hz; that is the physics, not a bug.</p>
      <div className="bar">
        <label>
          Room{" "}
          <select value={scene.shape} onChange={(e) => edit({ ...sceneRef.current, shape: e.target.value as Scene["shape"] })}>
            <option value="rect">Rectangle</option>
            <option value="L">L-shape</option>
          </select>
        </label>
        <label>
          Width m <input type="number" step="0.1" min={MIN_ROOM_M} max={MAX_ROOM_M} value={scene.w} onChange={(e) => setSize("w", +e.target.value)} />
        </label>
        <label>
          Depth m <input type="number" step="0.1" min={MIN_ROOM_M} max={MAX_ROOM_M} value={scene.h} onChange={(e) => setSize("h", +e.target.value)} />
        </label>
        {scene.shape === "L" && (
          <>
            <label>
              Cut-out width m <input type="number" step="0.1" min={0.5} max={MAX_ROOM_M} value={scene.notchW} onChange={(e) => setSize("notchW", +e.target.value)} />
            </label>
            <label>
              Cut-out depth m <input type="number" step="0.1" min={0.5} max={MAX_ROOM_M} value={scene.notchH} onChange={(e) => setSize("notchH", +e.target.value)} />
            </label>
          </>
        )}
      </div>
      <div className="bar">
        Trap (drag on the plan):
        {(["foam", "chunk", "erase"] as Tool[]).map((t) => (
          <button key={t} className={tool === t ? "on" : ""} onClick={() => setTool(t)}>
            {t === "erase" ? "Erase trap" : `${TRAPS[t].label} (Rf ${TRAPS[t].rf.toLocaleString("en")})`}
          </button>
        ))}
        <button onClick={() => edit({ ...sceneRef.current, traps: [] })}>Clear traps</button>
      </div>
      <div className="cols">
        <div>
          <div className={`stage${stale ? " stale" : ""}`}>
            <canvas ref={planRef} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} />
          </div>
          <div className="legend">
            <div className="grad" style={{ background: "linear-gradient(90deg, rgb(0,0,77), rgb(0,150,255), rgb(0,255,60), rgb(255,200,0), rgb(255,0,0))" }} />
            <div className="ticks">
              <span>null (quiet, -{MAP_DB} dB)</span>
              <span>boom (loud, 0 dB)</span>
            </div>
            Map at {freq.toFixed(1)} Hz. Drag SUB or SEAT. Orange = foam, purple = superchunk.
          </div>
        </div>
        <div>
          <canvas ref={chartRef} className="chart" onClick={onChartClick} />
          <div className="legend">Response at the seat, dB relative to the highest peak. Click a peak (orange dot) to see its mode shape.</div>
          <div className="bar">
            <label>
              Frequency{" "}
              <input type="range" min={F_MIN} max={F_MAX} step={0.5} value={freq} onChange={(e) => chooseFreq(+e.target.value)} /> {freq.toFixed(1)} Hz
            </label>
            <span>{relDb >= 0 ? "+" : ""}{relDb.toFixed(1)} dB vs the room median</span>
          </div>
          <div className="bar">
            <label>
              Sound{" "}
              <select value={mode} onChange={(e) => setMode(e.target.value as PlayMode)}>
                <option value="laptop">Laptop mode (harmonic stack)</option>
                <option value="tone">Normal (the low tone itself)</option>
              </select>
            </label>
            <label>
              Volume{" "}
              <input
                type="range"
                min={0}
                max={40}
                value={volume}
                onChange={(e) => {
                  setVolume(+e.target.value);
                  player.current.setVolume(+e.target.value / 100);
                }}
              />
            </label>
            <button className={playing ? "on" : ""} onClick={togglePlay} disabled={!response}>
              {playing ? "Stop" : "Play"}
            </button>
          </div>
        </div>
      </div>
      <div className="status">
        Backend:{" "}
        {backend
          ? backend.kind === "webgpu"
            ? `WebGPU, cell ${backend.dx * 100} cm${room ? `, grid ${room.nx}x${room.ny}` : ""}`
            : `CPU (Web Worker), cell ${backend.dx * 100} cm${room ? `, grid ${room.nx}x${room.ny}` : ""} (${backend.reason})`
          : "..."}
        <div className={status.error ? "err" : ""}>{status.text}</div>
        {status.fraction !== null && <progress value={status.fraction} max={1} />}
      </div>
    </div>
  );
}
