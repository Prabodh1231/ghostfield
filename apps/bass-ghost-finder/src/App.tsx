import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { responseSpectrum } from "@core/runtime/responseJob";
import { acousticCoefficients } from "@core/live/acoustics";
import { createLiveSim, type LiveSim } from "@core/live";
import { drawUnderlay } from "@ui/index";
import { BassPlayer, levelAt, stackLevels, type PlayMode } from "./audio";
import { HATCH_CSS, HelpPanel, PALETTE, Pinger, SketchDialog, WipeBar, hatchPixel, ramp, thump, useReducedMotion, type SketchApplied } from "./radar";
import { COACH_STEPS, Coach } from "./coach";
import { drawCouch, drawFloor, drawHighlight, drawOutline, drawRoomSize, drawSpeaker, drawSpot, findSpots, label, seatWord, sketchPower } from "./draw";
import {
  FREQS,
  F_MAX,
  F_MIN,
  MAX_ROOM_M,
  MIN_ROOM_M,
  TRAPS,
  airCell,
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

const PX_PER_M = 150;
const GRAB_M = 0.3;
const MAP_DB = 40;
/** Loudest spots: within this many dB of the peak they get red stripes. */
const BOOM_DB = -3;
const SPF_GPU = 4;
const SPF_CPU = 2;
const COURANT = 0.693;
/** Cell size used to draw the room before the solver (and its backend) is known. */
const DX_FIRST_PAINT = 0.05;
/** The same ramp the map uses (cubed), so the legend matches the colours. */
const LEGEND_GRADIENT = `linear-gradient(90deg, ${Array.from({ length: 11 }, (_, k) => {
  const [r, g, b] = ramp((k / 10) ** 3);
  return `rgb(${r},${g},${b}) ${k * 10}%`;
}).join(",")})`;
type Tool = TrapType | "erase" | "ping";
interface Response {
  db: Float64Array;
}
interface Status {
  text: string;
  fraction: number | null;
  error?: boolean;
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
  const [tool, setTool] = useState<Tool>("ping");
  const [draft, setDraft] = useState<Trap | null>(null);
  const [freq, setFreq] = useState(40);
  const [response, setResponse] = useState<Response | null>(null);
  const [mapVersion, setMapVersion] = useState(0);
  const [stale, setStale] = useState(false);
  const [status, setStatus] = useState<Status>({ text: "Starting up…", fraction: null });
  const [mode, setMode] = useState<PlayMode>("laptop");
  const [volume, setVolume] = useState(5);
  const [playing, setPlaying] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [panel, setPanel] = useState<"room" | "sound" | null>(() => (window.innerWidth >= 1500 ? "sound" : null));
  const [sketchOpen, setSketchOpen] = useState(false);
  const [pinging, setPinging] = useState(false);
  const [toast, setToast] = useState("");
  const [wipe, setWipe] = useState({ show: false, pos: 50 });
  const [step, setStep] = useState(0);
  const [gotIt, setGotIt] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [vw, setVw] = useState(window.innerWidth);
  const reduced = useReducedMotion();
  const spotsRef = useRef<ReturnType<typeof findSpots> | null>(null);

  const mapDivRef = useRef<HTMLDivElement>(null);
  const planRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<HTMLCanvasElement>(null);
  const mapRef = useRef<HTMLCanvasElement | null>(null);
  const beforeMapRef = useRef<HTMLCanvasElement | null>(null);
  const photoRef = useRef<{ photo: HTMLCanvasElement; wM: number; hM: number } | null>(null);
  const sceneRef = useRef(scene);
  const freqRef = useRef(freq);
  const responseRef = useRef<Response | null>(null);
  const backendRef = useRef<Backend | null>(null);
  const respSim = useRef<SimHandle<unknown> | null>(null);
  const mapSim = useRef<SimHandle<unknown> | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const mapTimer = useRef<number | undefined>(undefined);
  const toastTimer = useRef<number | undefined>(undefined);
  const drag = useRef<null | "sub" | "seat" | "trap" | "ping">(null);
  const player = useRef<BassPlayer>(new BassPlayer());
  const frozen = useRef(false);
  const pendingTrap = useRef<number | null>(null);
  const pingerRef = useRef<Pinger | null>(null);
  const liveRef = useRef<LiveSim | null>(null);

  const room = useMemo(() => buildRoom(draft ? { ...scene, traps: [...scene.traps, draft] } : scene, backend?.dx ?? DX_FIRST_PAINT), [scene, draft, backend]);
  const relDb = response ? levelAt(FREQS, response.db, freq) - Array.from(response.db).sort((a, b) => a - b)[response.db.length >> 1]! : 0;
  const hasMap = mapRef.current !== null;
  const coachTarget = step < COACH_STEPS.length && !(step === 4 && !wipe.show) ? COACH_STEPS[step]!.target : undefined;

  const say = useCallback((text: string, ms = 7000) => {
    setToast(text);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(""), ms);
  }, []);

  const runMap = useCallback(() => {
    const b = backendRef.current;
    if (!b) return;
    mapSim.current?.cancel();
    try {
      const { room: r, job } = buildFieldJob(sceneRef.current, b.dx, freqRef.current);
      const sim = startField(b, job, (f) => setStatus({ text: "Drawing the map of booms and quiet spots...", fraction: f }));
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
              img.data.set([42, 52, 64, 255], o);
              continue;
            }
            const db = 10 * Math.log10(Math.max(1e-12, res.power[i]! / pmax));
            // Loudest spots: red stripes (a shape), the rest on the teal ramp.
            if (db >= BOOM_DB && hatchPixel(i % r.nx, Math.floor(i / r.nx))) {
              img.data.set([0xff, 0x3b, 0x5c, 255], o);
              continue;
            }
            const [R, G, B] = ramp(((db + MAP_DB) / MAP_DB) ** 3);
            img.data.set([R, G, B, 255], o);
          }
          c.getContext("2d")!.putImageData(img, 0, 0);
          mapRef.current = c;
          spotsRef.current = findSpots(res.power, r.solid, r.nx, r.ny, r.dx);
          if (frozen.current) {
            frozen.current = false;
            setWipe({ show: true, pos: 50 });
          }
          setMapVersion((v) => v + 1);
          setStale(false);
          setStatus({ text: "Done. The map is ready.", fraction: null });
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
      setStatus({ text: "Measuring how the room sounds...", fraction: 0 });
      const sim = startResponse(b, job, (f) => setStatus({ text: "Measuring how the room sounds...", fraction: f }));
      respSim.current = sim as SimHandle<unknown>;
      sim.result
        .then((res) => {
          if (!res || respSim.current !== (sim as SimHandle<unknown>)) return;
          const h = responseSpectrum(res, FREQS);
          const next = { db: Float64Array.from(h, (v) => 20 * Math.log10(Math.max(1e-30, v))) };
          // A foam piece was added and the note on the map got quieter at the seat: say how much.
          if (pendingTrap.current !== null) {
            const drop = pendingTrap.current - levelAt(FREQS, next.db, freqRef.current);
            if (drop >= 3) say(`Foam made your seat quieter: about ${Math.round(100 * (1 - 10 ** (-drop / 20)))}% less boom. Press Play to hear it.`);
            pendingTrap.current = null;
          }
          responseRef.current = next;
          setResponse(next);
          runMap();
        })
        .catch((e) => setStatus({ text: `Simulation failed: ${String(e)}`, fraction: null, error: true }));
    } catch (e) {
      setStatus({ text: `Cannot start: ${String(e)}`, fraction: null, error: true });
    }
  }, [runMap, say]);

  useEffect(() => {
    pickBackend().then((b) => {
      backendRef.current = b;
      setBackend(b);
      const p = new Pinger(b.kind === "webgpu" ? SPF_GPU : SPF_CPU, Math.round((2 * (MAX_ROOM_M / b.dx)) / COURANT));
      p.onActive = setPinging;
      pingerRef.current = p;
      mapDivRef.current?.appendChild(p.host);
      runResponse();
    });
    const p = player.current;
    return () => {
      respSim.current?.cancel();
      mapSim.current?.cancel();
      pingerRef.current?.cancel();
      liveRef.current?.destroy();
      p.stop();
    };
  }, [runResponse]);

  const edit = useCallback(
    (next: Scene) => {
      // The first edit after a settled map keeps that map as "before" for the wipe slider.
      if (mapRef.current && !frozen.current) {
        const c = document.createElement("canvas");
        c.width = mapRef.current.width;
        c.height = mapRef.current.height;
        c.getContext("2d")!.drawImage(mapRef.current, 0, 0);
        beforeMapRef.current = c;
        frozen.current = true;
      }
      if (next.traps.length > sceneRef.current.traps.length) setStep((s) => (s === 2 ? 3 : s));
      if (next.traps.length > sceneRef.current.traps.length && responseRef.current && pendingTrap.current === null) {
        pendingTrap.current = levelAt(FREQS, responseRef.current.db, freqRef.current);
      }
      // The live wave belongs to the old room.
      pingerRef.current?.cancel();
      liveRef.current?.destroy();
      liveRef.current = null;
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

  useEffect(() => {
    const onResize = () => setVw(window.innerWidth);
    window.addEventListener("resize", onResize);
    const t1 = window.setTimeout(() => setGotIt(true), 6000);
    return () => {
      window.removeEventListener("resize", onResize);
      window.clearTimeout(t1);
    };
  }, []);

  // Coach: step 1 moves on after "Got it" (or 6 s) once the real map is there. The last step hides after 8 s.
  useEffect(() => {
    if (step === 0 && gotIt && hasMap) setStep(1);
    if (step === COACH_STEPS.length - 1) {
      const t = window.setTimeout(() => setStep(COACH_STEPS.length), 8000);
      return () => window.clearTimeout(t);
    }
  }, [step, gotIt, hasMap, mapVersion]);

  // Plan view: floor, quick sketch or real map, before/after bar, photo, foam, outline, speaker, couch, markers.
  useEffect(() => {
    const c = planRef.current;
    if (!c) return;
    const k = PX_PER_M;
    c.width = Math.round(room.nx * room.dx * k);
    c.height = Math.round(room.ny * room.dx * k);
    const g = c.getContext("2d")!;
    const cell = room.dx * k;
    const s = c.width / Math.max(1, c.clientWidth || c.width);
    const px = Math.round(13 * s);
    const u = Math.max(1, s * 0.85);
    g.fillStyle = PALETTE.bg;
    g.fillRect(0, 0, c.width, c.height);
    drawFloor(g, room, k);
    let spots = spotsRef.current;
    if (mapRef.current) {
      g.imageSmoothingEnabled = true;
      g.drawImage(mapRef.current, 0, 0, c.width, c.height);
      if (wipe.show && beforeMapRef.current) {
        const x = (c.width * wipe.pos) / 100;
        g.save();
        g.beginPath();
        g.rect(0, 0, x, c.height);
        g.clip();
        g.drawImage(beforeMapRef.current, 0, 0, c.width, c.height);
        g.restore();
        g.strokeStyle = PALETTE.teal;
        g.lineWidth = 2;
        g.beginPath();
        g.moveTo(x, 0);
        g.lineTo(x, c.height);
        g.stroke();
      }
    } else {
      // Quick sketch: no solver, so the picture is there at once. Labelled as rough.
      const sk = sketchPower(scene, freq);
      const sc = document.createElement("canvas");
      sc.width = sk.nx;
      sc.height = sk.ny;
      const img = sc.getContext("2d")!.createImageData(sk.nx, sk.ny);
      for (let i = 0; i < sk.power.length; i++) {
        if (sk.solid[i]) {
          img.data.set([42, 52, 64, 255], 4 * i);
          continue;
        }
        const [R, G, B] = ramp(sk.power[i]! ** 2);
        img.data.set([R, G, B, 153], 4 * i);
      }
      sc.getContext("2d")!.putImageData(img, 0, 0);
      g.imageSmoothingEnabled = true;
      g.drawImage(sc, 0, 0, c.width, c.height);
      spots = scene.shape === "rect" && !scene.imported ? findSpots(sk.power, sk.solid, sk.nx, sk.ny, sk.cell) : null;
      label(g, "Quick sketch. Exact map in a few seconds.", c.width / 2, c.height - px * 1.2, px, "#cfe8e4");
    }
    const ph = photoRef.current;
    if (ph) drawUnderlay(g, ph.photo, ph.wM * k, ph.hM * k, 0.15);
    for (let j = 0; j < room.ny; j++)
      for (let i = 0; i < room.nx; i++) {
        const rf = room.rf[j * room.nx + i]!;
        if (rf > 0) {
          g.fillStyle = rf >= TRAPS.chunk.rf ? "rgba(190,120,255,0.8)" : "rgba(235,245,255,0.85)";
          g.fillRect(i * cell, j * cell, cell + 0.5, cell + 0.5);
        }
      }
    drawOutline(g, room, k);
    drawRoomSize(g, scene, k, px);
    if (spots) {
      spots.loud.forEach((p, i) => drawSpot(g, p, k, "boom", px, coachTarget === "boom" && i === 0));
      spots.quiet.forEach((p) => drawSpot(g, p, k, "quiet", px));
    }
    const sub = scene.sub;
    const seat = scene.seat;
    drawSpeaker(g, sub.x * k, sub.y * k, u);
    label(g, "Speaker", sub.x * k, sub.y * k + 28 * u + px, px);
    drawCouch(g, seat.x * k, seat.y * k, u);
    label(g, "Your seat", seat.x * k, seat.y * k + 22 * u + px, px);
    const word = hasMap && response ? seatWord(relDb) : "...";
    label(g, word, seat.x * k, seat.y * k - 22 * u - px * 0.4, Math.round(px * 1.2), word === "Boomy" ? "#ff8aa0" : word === "Thin" ? "#ffd24a" : "#38f2d6");
    if (coachTarget === "couch") drawHighlight(g, seat.x * k, seat.y * k, 40 * u);
  }, [room, scene, freq, mapVersion, wipe, response, relDb, coachTarget, vw, hasMap]);
  // Response chart. Peaks are red diamonds (a shape as well as a colour).
  useEffect(() => {
    const c = chartRef.current;
    if (!c) return;
    c.width = 640;
    c.height = 240;
    const g = c.getContext("2d")!;
    g.fillStyle = "#05070b";
    g.fillRect(0, 0, 640, 240);
    const L = 44;
    const R = 628;
    const T = 10;
    const B = 212;
    const xOf = (f: number) => L + ((f - F_MIN) / (F_MAX - F_MIN)) * (R - L);
    g.font = "11px system-ui";
    g.fillStyle = "#9fb7b3";
    g.strokeStyle = "#1c2a2d";
    g.textAlign = "center";
    for (let f = 50; f <= 300; f += 50) {
      g.beginPath();
      g.moveTo(xOf(f), T);
      g.lineTo(xOf(f), B);
      g.stroke();
      g.fillText(`${f}`, xOf(f), B + 14);
    }
    g.textAlign = "left";
    g.fillText("Deep notes", L, B + 28);
    g.textAlign = "right";
    g.fillText("High notes", R, B + 28);
    g.textAlign = "left";
    g.fillText("Louder is up", L + 6, T + 12);
    if (response) {
      const d = response.db;
      let mx = -Infinity;
      for (const v of d) mx = Math.max(mx, v);
      const span = 50;
      const yOf = (v: number) => B - ((Math.max(mx - span, v) - (mx - span)) / span) * (B - T);
      for (let s = 0; s <= span; s += 10) {
        g.beginPath();
        g.moveTo(L, yOf(mx - s));
        g.lineTo(R, yOf(mx - s));
        g.stroke();
      }
      g.strokeStyle = PALETTE.teal;
      g.lineWidth = 1.5;
      g.beginPath();
      FREQS.forEach((f, i) => (i === 0 ? g.moveTo(xOf(f), yOf(d[i]!)) : g.lineTo(xOf(f), yOf(d[i]!))));
      g.stroke();
      g.fillStyle = PALETTE.alert;
      for (const i of findPeaks(d)) {
        const x = xOf(FREQS[i]!);
        const y = yOf(d[i]!);
        g.beginPath();
        g.moveTo(x, y - 6);
        g.lineTo(x + 5, y);
        g.lineTo(x, y + 6);
        g.lineTo(x - 5, y);
        g.closePath();
        g.fill();
      }
    }
    g.strokeStyle = "#ffd24a";
    g.lineWidth = 1.5;
    g.beginPath();
    g.moveTo(xOf(freq), T);
    g.lineTo(xOf(freq), B);
    g.stroke();
  }, [response, freq, panel]);

  // Keep the sound in step with the frequency and the room.
  useEffect(() => {
    if (!playing || !response) return;
    player.current.update(mode, freq, stackLevels(FREQS, response.db, freq));
  }, [playing, mode, freq, response]);

  const planPoint = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: ((e.clientX - r.left) * (e.currentTarget.width / r.width)) / PX_PER_M, y: ((e.clientY - r.top) * (e.currentTarget.height / r.height)) / PX_PER_M };
  };

  /** A click in the room: one pulse from that spot, slowed down so you can watch it. */
  const ping = (p: { x: number; y: number }) => {
    const b = backendRef.current;
    const pg = pingerRef.current;
    if (!b || !pg) return;
    const rm = buildRoom(sceneRef.current, b.dx);
    if (!isAir(rm, p.x, p.y)) return;
    thump();
    if (reduced) {
      say("Your system asks for less motion, so the wave is not animated. The thump still plays.");
      return;
    }
    try {
      if (!liveRef.current) {
        const sim = createLiveSim({
          cs: acousticCoefficients(rm.nx, rm.ny, rm.dx, rm.rf),
          solid: rm.solid,
          backend: b.kind === "webgpu" ? "gpu" : "cpu",
          device: b.kind === "webgpu" ? b.device : undefined,
          pulseHz: 400,
        });
        liveRef.current = sim;
        pg.attach(sim);
      }
      const sim = liveRef.current;
      pg.ping(Math.min(sim.nx - 1, Math.floor(p.x / rm.dx)), Math.min(sim.ny - 1, Math.floor(p.y / rm.dx)));
      const ratio = 1 / 60 / ((b.kind === "webgpu" ? SPF_GPU : SPF_CPU) * sim.dt);
      say(`Slowed down about ${Math.round(ratio)} times so you can watch it. The thump is just for feel.`, 8000);
    } catch (e) {
      say(`The wave is not available here: ${String(e)}`);
    }
  };

  const onDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!room) return;
    const p = planPoint(e);
    e.currentTarget.setPointerCapture(e.pointerId);
    const s = sceneRef.current;
    if (Math.hypot(p.x - s.sub.x, p.y - s.sub.y) < GRAB_M) drag.current = "sub";
    else if (Math.hypot(p.x - s.seat.x, p.y - s.seat.y) < GRAB_M) drag.current = "seat";
    else if (tool === "ping") {
      ping(p);
    } else if (tool === "erase") {
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
      else ping(p);
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
    } else if ((drag.current === "sub" || drag.current === "seat") && isAir(room, p.x, p.y)) {
      edit({ ...s, [drag.current]: { x: p.x, y: p.y } });
    }
  };

  const onUp = () => {
    const s = sceneRef.current;
    if (drag.current === "trap" && draft) {
      const len = Math.hypot(draft.x2 - draft.x1, draft.y2 - draft.y1);
      if (draft.type === "chunk" || len >= 0.1) edit({ ...s, traps: [...s.traps, draft] });
      else ping({ x: draft.x1, y: draft.y1 });
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

  const applySketch = ({ result, photo }: SketchApplied) => {
    const b = backendRef.current;
    if (!b) return;
    const dx = b.dx;
    const w = Math.max(MIN_ROOM_M, result.cols * dx);
    const h = Math.max(MIN_ROOM_M, result.rows * dx);
    photoRef.current = { photo, wM: result.cols * result.metresPerCell, hM: result.rows * result.metresPerCell };
    const base: Scene = { ...sceneRef.current, shape: "rect", w, h, traps: [], imported: { mask: result.solid, cols: result.cols, rows: result.rows, dx } };
    // Put SUB and SEAT on the nearest free floor, since the old spots may now be inside a wall.
    const rm = buildRoom(base, dx);
    const place = (fx: number, fy: number) => {
      const a = airCell(rm, fx * w, fy * h);
      return { x: (a.ix + 0.5) * dx, y: (a.iy + 0.5) * dx };
    };
    edit({ ...base, sub: place(0.2, 0.8), seat: place(0.7, 0.3) });
    setSketchOpen(false);
  };

  const onChartClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - r.left) * (640 / r.width);
    let f = F_MIN + ((x - 44) / (628 - 44)) * (F_MAX - F_MIN);
    if (response) {
      let best = -1;
      let bd = 6;
      for (const i of findPeaks(response.db))
        if (Math.abs(FREQS[i]! - f) < bd) {
          bd = Math.abs(FREQS[i]! - f);
          best = i;
        }
      if (best >= 0) {
        f = FREQS[best]!;
      }
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
      setStep((s) => (s === 1 || s === 3 ? s + 1 : s));
    }
  };

  const ratio = room.nx / room.ny;
  const ring = (target: string) => (coachTarget === target ? " ring" : "");

  return (
    <>
      <div className="stage">
        <div ref={mapDivRef} className={`map${stale ? " stale" : ""}${pinging ? " pinging" : ""}`} style={{ "--r": String(ratio), aspectRatio: String(ratio) } as React.CSSProperties}>
          <canvas ref={planRef} className="plan" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} style={{ cursor: "crosshair" }} />
        </div>
        {step < COACH_STEPS.length && !(step === 4 && !wipe.show) && (
          <Coach
            step={step}
            onSkip={() => {
              if (step === 0) setGotIt(true);
              else setStep((s) => s + 1);
            }}
          />
        )}
      </div>
      {!hasMap && (
        <div className="chip wait" role="status">
          <div>Working out the exact map... a few seconds</div>
          <progress value={status.fraction ?? undefined} max={1} />
        </div>
      )}

      <div className="chip title">
        <a href="../">&larr; Home</a>
        <h1>Find where bass booms in your room</h1>
      </div>
      <div className="topright">
        <div className={`chip status${status.error ? " err" : ""}`}>
          {status.text}
          {status.fraction !== null && <progress value={status.fraction} max={1} style={{ width: 90, marginLeft: 8 }} />}
        </div>
        <button className="chip qbtn" onClick={() => setHelpOpen((v) => !v)} aria-label="How does this work?" aria-expanded={helpOpen}>
          ?
        </button>
      </div>
      {helpOpen && (
        <HelpPanel onClose={() => setHelpOpen(false)}>
          <h2>How this works</h2>
          <p>This is your room seen from above. It shows how sound waves bounce around it, right in your browser. Low notes pile up in some spots (boom) and cancel in others (quiet).</p>
          <ol>
            <li>Drag the speaker and the couch (where you listen) to new spots.</li>
            <li>Press Play bass to hear the note from your seat.</li>
            <li>Read the map: bright teal = loud, dark = quiet, red rings = boom. Press Add foam, then drag along a wall to calm the boom.</li>
          </ol>
          <p>Press Send a wave, then click the room to send one wave and watch it bounce. The Before | After bar appears after you change something. In Chart &amp; sound, click a red marker to map that boomy note.</p>
          <p className="small">
            Honest note: this is a flat top-down view, so it shows side-to-side booms only, not floor-to-ceiling ones. It is a model, not a measurement. Thin foam does little for deep bass; that is physics, not a bug. The wave is a slowed-down movie; the steady map is the main result. The first picture is a quick sketch, then the exact map replaces it.
            {backend ? ` Running on ${backend.kind === "webgpu" ? "your graphics chip" : "your processor"}.` : ""}
          </p>
        </HelpPanel>
      )}      {panel === "sound" && (
        <div className="panel">
          <canvas ref={chartRef} className="chart" onClick={onChartClick} />
          {!response && <div className="small">Measuring the room... red markers appear here in a few seconds</div>}
          <div className="small">What you hear at your seat for each note, deep to high, compared with the loudest. Dips are quiet, red markers boom. Click a red marker to map it. Yellow line = the note on the map.</div>
          <label>
            Note (Hz = how deep or high) <input type="range" min={F_MIN} max={F_MAX} step={0.5} value={freq} onChange={(e) => chooseFreq(+e.target.value)} /> {freq.toFixed(1)} Hz
          </label>
          <div className="small">{!response ? "" : relDb >= 3 ? "At your seat this note is louder than most of the room." : relDb <= -3 ? "At your seat this note is quieter than most of the room." : "At your seat this note is about average."}</div>
          <label>
            Sound{" "}
            <select value={mode} onChange={(e) => setMode(e.target.value as PlayMode)}>
              <option value="laptop">Laptop speakers (adds higher tones)</option>
              <option value="tone">Normal (the pure low tone)</option>
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
            />{" "}
            <button className={playing ? "on" : ""} onClick={togglePlay} disabled={!response}>
              {playing ? "Stop" : "Play"}
            </button>
          </label>
        </div>
      )}
      {panel === "room" && (
        <div className="panel">
          <label>
            Room{" "}
            <select value={scene.shape} onChange={(e) => edit({ ...sceneRef.current, shape: e.target.value as Scene["shape"], imported: undefined })}>
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
      )}      {toast && <div className="chip toast">{toast}</div>}
      {wipe.show && (
        <WipeBar
          pos={wipe.pos}
          ring={coachTarget === "bar"}
          onChange={(v) => {
            setWipe({ show: true, pos: v });
            setStep((s) => (s === 4 ? 5 : s));
          }}
          onClose={() => {
            setWipe({ show: false, pos: 50 });
            setStep((s) => (s === 4 ? 5 : s));
          }}
        />
      )}
      <div className="chip dock">
        <div className="legend">
          <strong>Map for one deep note ({freq.toFixed(0)} Hz: how deep it is). Change it in Chart &amp; sound.</strong>
          <div className="grad" style={{ background: LEGEND_GRADIENT }} />
          <div className="ticks">
            <span>Dark = quiet</span>
            <span>Bright teal = loud</span>
          </div>
          <div className="key">
            <span>
              <span className="hatch" style={{ background: HATCH_CSS }} />
              Red ring = boom
            </span>
            <span>
              <span className="swatch" style={{ background: "rgb(235,245,255)" }} />
              Foam wall
            </span>
            <span>
              <span className="swatch" style={{ background: "rgb(190,120,255)" }} />
              Corner foam
            </span>
            <span>
              <span className="swatch" style={{ background: "rgb(42,52,64)" }} />
              Wall
            </span>
          </div>
        </div>
        <div className="tools">
          <button className={`playbtn${playing ? " on" : ""}${ring("play")}`} onClick={togglePlay} disabled={!response}>
            {playing ? "Stop bass" : "Play bass"}
          </button>
          <button className={`${tool === "foam" ? "on" : ""}${ring("foam")}`} onClick={() => setTool("foam")}>
            Add foam
          </button>
          <button className={tool === "erase" ? "on" : ""} onClick={() => setTool("erase")}>
            Erase foam
          </button>
          <button className={tool === "ping" ? "on" : ""} onClick={() => setTool("ping")}>
            Send a wave
          </button>
          <button className={moreOpen ? "on" : ""} onClick={() => setMoreOpen((v) => !v)} aria-expanded={moreOpen}>
            More
          </button>
        </div>
        {moreOpen && (
          <div className="tools more">
            <button className={tool === "chunk" ? "on" : ""} onClick={() => setTool("chunk")}>
              Add corner foam
            </button>
            <button onClick={() => edit({ ...sceneRef.current, traps: [] })}>Clear foam</button>
            <button className={panel === "room" ? "on" : ""} onClick={() => setPanel(panel === "room" ? null : "room")}>
              Room size
            </button>
            <button className={panel === "sound" ? "on" : ""} onClick={() => setPanel(panel === "sound" ? null : "sound")}>
              Chart &amp; sound
            </button>
            <button onClick={() => setSketchOpen(true)}>Use my floor plan</button>
          </div>
        )}
      </div>
      {sketchOpen && backend && (
        <SketchDialog cellMetres={backend.dx} maxCols={Math.floor(MAX_ROOM_M / backend.dx)} maxRows={Math.floor(MAX_ROOM_M / backend.dx)} onApply={applySketch} onClose={() => setSketchOpen(false)} />
      )}
    </>
  );
}