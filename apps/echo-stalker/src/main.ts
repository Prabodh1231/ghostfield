import "./styles.css";
import { buildCoefficients, DEFAULT_COURANT, dtFromCourant } from "@core/coefficients";
import { createLiveSim, type LiveSim } from "@core/live";
import { C0 } from "@core/live/acoustics";
import { detectBackend } from "@core/runtime/detectBackend";
import { importSketch, SketchError, thump } from "@ui";
import { airMaterial, CPU_PROFILE, GPU_PROFILE, type Profile } from "./config";
import { LEVELS, rasterize, type LevelData } from "./levels";
import { PX, Renderer, VIEW_H, VIEW_W } from "./render";
import { sketchToLevel } from "./sketchLevel";
import { World, type GameEvent, type Input } from "./world";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>("view");

// ---- backend ----
let profile: Profile = CPU_PROFILE;
let device: GPUDevice | undefined;
let backendNote = "";

async function pickBackend() {
  if (new URLSearchParams(location.search).get("backend") === "cpu") {
    backendNote = "Running on the CPU (forced by ?backend=cpu): lower detail, slower waves.";
    return;
  }
  // shortcut: a hung requestAdapter (some GPU-less setups) must not leave the page blank; give up after 4 s.
  const b = await Promise.race([detectBackend(), new Promise<{ kind: "cpu"; reason: string }>((r) => setTimeout(() => r({ kind: "cpu", reason: "WebGPU did not answer" }), 4000))]);
  if (b.kind === "webgpu") {
    profile = GPU_PROFILE;
    device = b.device;
    backendNote = "Running on your graphics card (WebGPU): full detail.";
  } else {
    backendNote = `Running on the CPU (${b.reason}): lower detail, slower waves.`;
  }
}

function makeSim(lvl: LevelData): LiveSim {
  const p = profile;
  const dt = dtFromCourant(DEFAULT_COURANT, p.dx, C0);
  const cs = buildCoefficients(p.nx, p.ny, p.dx, dt, () => airMaterial(p));
  return createLiveSim({ cs, backend: p.name === "gpu" ? "gpu" : "cpu", device, solid: lvl.solid, pulseHz: p.pulseHz });
}

// ---- audio ----
let muted = false;
function sound(e: GameEvent, w: World) {
  if (muted) return;
  const dist = Math.hypot(e.x - w.px, e.y - w.py);
  if (e.kind === "clap") thump({ pitchHz: 85, volume: 0.7 });
  else if (e.kind === "step") thump({ pitchHz: 55, volume: 0.1 });
  else if (e.kind === "pebble") thump({ pitchHz: 420, volume: Math.max(0.05, 0.3 - dist * 0.02) });
  else thump({ pitchHz: 38, volume: Math.max(0, 0.5 - dist * 0.04) });
}

// ---- state ----
type Screen = "start" | "play" | "help" | "over" | "sketch";
let screen: Screen = "start";
let world: World | null = null;
let renderer: Renderer | null = null;
let current: { idx: number; make: () => LevelData } | null = null;
let underlayCv: HTMLCanvasElement | null = null;

const keys = new Set<string>();
let clapQueued = false;
let throwQueued: { x: number; y: number } | null = null;
let mouse = { x: 0, y: 0 };

const stats = { frameMs: [] as number[], simMs: [] as number[] };
(window as unknown as { __echo: unknown }).__echo = { get world() { return world; }, stats, get profile() { return profile; }, get screen() { return screen; } };

function show(s: Screen) {
  screen = s;
  $("start").hidden = s !== "start";
  $("help").hidden = s !== "help";
  $("over").hidden = s !== "over";
  $("sketch").hidden = s !== "sketch";
  $("hud").hidden = s === "start" || s === "sketch";
  if (s !== "play") $("toast").hidden = true;
}

let toastTimer = 0;
function toast(text: string, ms = 7000) {
  const t = $("toast");
  t.textContent = text;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (t.hidden = true), ms);
}

function startLevel(idx: number, make: () => LevelData, name?: string) {
  world?.sim.destroy();
  const lvl = make();
  world = new World(makeSim(lvl), profile, lvl);
  renderer = new Renderer(canvas, world);
  if (idx < 0 && underlayCv) {
    renderer.underlay = { img: underlayCv, w: VIEW_W, h: VIEW_H };
    renderer.showUnderlay = $<HTMLInputElement>("underlay").checked;
  }
  current = { idx, make };
  $("levelName").textContent = name ?? lvl.name;
  show("play");
  toast(`${lvl.hint}  (Space = clap, click = pebble, Shift = sneak)`);
}

function startBuiltIn(i: number) {
  startLevel(i, () => rasterize(LEVELS[i]!, profile));
}

// ---- loop ----
let last = 0;
let raf = 0;
function frame(now: number) {
  raf = requestAnimationFrame(frame);
  const dt = last ? (now - last) / 1000 : 0.016;
  last = now;
  if (screen !== "play" || !world || !renderer) return;
  const t0 = performance.now();
  const ax = (keys.has("d") || keys.has("arrowright") ? 1 : 0) - (keys.has("a") || keys.has("arrowleft") ? 1 : 0);
  const ay = (keys.has("s") || keys.has("arrowdown") ? 1 : 0) - (keys.has("w") || keys.has("arrowup") ? 1 : 0);
  const inp: Input = { mx: ax, my: ay, sneak: keys.has("shift"), clap: clapQueued, throwAt: throwQueued };
  clapQueued = false;
  throwQueued = null;
  world.update(dt, inp);
  const t1 = performance.now();
  for (const e of world.events) sound(e, world);
  renderer.addEvents(world.events);
  world.events = [];
  renderer.draw(Math.min(dt, 0.05));
  const t2 = performance.now();
  stats.simMs.push(t1 - t0);
  stats.frameMs.push(dt * 1000);
  if (stats.frameMs.length > 600) {
    stats.frameMs.shift();
    stats.simMs.shift();
  }
  void t2;
  if (world.status !== "play") endScreen();
}

function endScreen() {
  const w = world!;
  const won = w.status === "won";
  const lastLevel = current!.idx >= LEVELS.length - 1 || current!.idx < 0;
  $("overTitle").textContent = won ? "You got out" : "It caught you";
  $("overText").textContent = won ? (lastLevel ? "You escaped. Try your own sketch, or play again." : "You found the exit in the dark.") : "It heard you. Stay quiet, hide in the grey dotted zones, and throw a pebble to lure it away.";
  $("next").hidden = !(won && !lastLevel);
  show("over");
}

document.addEventListener("visibilitychange", () => {
  // pause the loop when the tab is hidden: no sim steps, no drawing
  if (document.hidden) {
    cancelAnimationFrame(raf);
    keys.clear();
  } else {
    last = 0;
    raf = requestAnimationFrame(frame);
  }
});

// ---- input ----
addEventListener("keydown", (e) => {
  const k = e.key.toLowerCase();
  if (screen === "play") {
    if (k === " ") {
      clapQueued = true;
      e.preventDefault();
    }
    if (k === "escape" || k === "?") show("help");
    if (["arrowup", "arrowdown", "arrowleft", "arrowright"].includes(k)) e.preventDefault();
    keys.add(k);
  } else if (screen === "help" && k === "escape") show("play");
});
addEventListener("keyup", (e) => keys.delete(e.key.toLowerCase()));
addEventListener("blur", () => keys.clear());
canvas.addEventListener("mousedown", (e) => {
  if (screen !== "play") return;
  const r = canvas.getBoundingClientRect();
  mouse = { x: ((e.clientX - r.left) / r.width) * (VIEW_W / PX), y: ((e.clientY - r.top) / r.height) * (VIEW_H / PX) };
  throwQueued = { ...mouse };
});

// ---- buttons ----
$("mute").onclick = () => {
  muted = !muted;
  $("mute").textContent = `Sound: ${muted ? "off" : "on"}`;
};
$("helpBtn").onclick = () => show("help");
$("helpClose").onclick = () => show(world ? "play" : "start");
$("retry").onclick = () => current && startLevel(current.idx, current.make, $("levelName").textContent ?? undefined);
$("next").onclick = () => startBuiltIn(current!.idx + 1);
$("menu").onclick = () => show("start");
for (let i = 0; i < LEVELS.length; i++) {
  const b = document.createElement("button");
  b.textContent = i === 0 ? "Play level 1" : `Level ${i + 1}`;
  if (i > 0) b.className = "ghost";
  b.onclick = () => startBuiltIn(i);
  $("levelButtons").appendChild(b);
}

// ---- Play Your Sketch ----
const skCv = $<HTMLCanvasElement>("sketchCv");
const skCtx = skCv.getContext("2d")!;
let skImg: HTMLCanvasElement | null = null;
let skPts: { x: number; y: number }[] = [];
const skMsg = (t: string) => ($("sketchMsg").textContent = t);

function skDraw() {
  skCtx.fillStyle = "#fff";
  skCtx.fillRect(0, 0, skCv.width, skCv.height);
  if (!skImg) return;
  const k = Math.min(skCv.width / skImg.width, skCv.height / skImg.height);
  skCtx.drawImage(skImg, 0, 0, skImg.width * k, skImg.height * k);
  skCtx.strokeStyle = "#e0245e";
  skCtx.fillStyle = "#e0245e";
  skCtx.lineWidth = 2;
  for (const p of skPts) {
    skCtx.beginPath();
    skCtx.arc(p.x * k, p.y * k, 5, 0, 6.283);
    skCtx.fill();
  }
  if (skPts.length === 2) {
    skCtx.beginPath();
    skCtx.moveTo(skPts[0]!.x * k, skPts[0]!.y * k);
    skCtx.lineTo(skPts[1]!.x * k, skPts[1]!.y * k);
    skCtx.stroke();
  }
}

$("underlay").onchange = () => renderer && (renderer.showUnderlay = $<HTMLInputElement>("underlay").checked);
$("sketchBtn").onclick = () => show("sketch");
$("sketchBack").onclick = () => show("start");
$<HTMLInputElement>("file").onchange = async (ev) => {
  const f = (ev.target as HTMLInputElement).files?.[0];
  if (!f) return;
  try {
    const bmp = await createImageBitmap(f);
    const k = Math.min(1, 1024 / Math.max(bmp.width, bmp.height));
    skImg = Object.assign(document.createElement("canvas"), { width: Math.round(bmp.width * k), height: Math.round(bmp.height * k) });
    skImg.getContext("2d")!.drawImage(bmp, 0, 0, skImg.width, skImg.height);
    skPts = [];
    skCv.height = Math.round((skCv.width * skImg.height) / skImg.width);
    skMsg("Now click two points on the picture that you know the real distance between.");
    $<HTMLButtonElement>("sketchGo").disabled = true;
    skDraw();
  } catch {
    skMsg("That file could not be read as a picture. Try a JPG or PNG.");
  }
};
skCv.addEventListener("click", (e) => {
  if (!skImg) return;
  const r = skCv.getBoundingClientRect();
  const k = Math.min(skCv.width / skImg.width, skCv.height / skImg.height);
  const x = (((e.clientX - r.left) / r.width) * skCv.width) / k;
  const y = (((e.clientY - r.top) / r.height) * skCv.height) / k;
  if (skPts.length >= 2) skPts = [];
  skPts.push({ x, y });
  skDraw();
  $<HTMLButtonElement>("sketchGo").disabled = skPts.length < 2;
  skMsg(skPts.length < 2 ? "Click the second point." : "Type the real distance in metres, then press Make my level.");
});
$("sketchGo").onclick = () => {
  if (!skImg || skPts.length < 2) return;
  try {
    const metres = Number($<HTMLInputElement>("metres").value);
    const img = skImg.getContext("2d")!.getImageData(0, 0, skImg.width, skImg.height);
    const res = importSketch(img, {
      maxCols: profile.nx,
      maxRows: profile.ny,
      scale: { x1: skPts[0]!.x, y1: skPts[0]!.y, x2: skPts[1]!.x, y2: skPts[1]!.y, metres },
      cellMetres: profile.dx,
      minWallCells: Math.max(2, Math.round(0.12 / profile.dx)),
    });
    const lvl = sketchToLevel(res.solid, res.cols, res.rows, profile);
    // The photo, scaled to the map (the importer's cell size is about dx; this keeps the picture lined up with the walls).
    underlayCv = Object.assign(document.createElement("canvas"), { width: VIEW_W, height: VIEW_H });
    underlayCv.getContext("2d")!.drawImage(skImg, 0, 0, (res.cols / profile.nx) * VIEW_W, (res.rows / profile.ny) * VIEW_H);
    startLevel(-1, () => lvl, "Your sketch");
  } catch (err) {
    skMsg(err instanceof SketchError ? err.message : `Could not make a level: ${String(err)}`);
  }
};

// ---- boot ----
void (async () => {
  await pickBackend();
  $("backendNote").textContent = backendNote;
  const lv = Number(new URLSearchParams(location.search).get("level"));
  if (lv >= 1 && lv <= LEVELS.length) startBuiltIn(lv - 1);
  else show("start");
  raf = requestAnimationFrame(frame);
})();
