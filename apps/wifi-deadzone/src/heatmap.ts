/** Colour scale for the relative signal in dB: dark = weak, bright = strong. */
export const DB_MIN = -60;
export const DB_MAX = 0;

const STOPS: [number, number, number][] = [
  [0, 0, 4],
  [60, 15, 110],
  [150, 40, 110],
  [220, 80, 60],
  [250, 170, 20],
  [252, 255, 164],
];

export function dbToRgb(db: number): [number, number, number] {
  const t = Math.min(1, Math.max(0, (db - DB_MIN) / (DB_MAX - DB_MIN))) * (STOPS.length - 1);
  const i = Math.min(STOPS.length - 2, Math.floor(t));
  const f = t - i;
  const a = STOPS[i]!;
  const b = STOPS[i + 1]!;
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}

/** Paint an n x n dB field into a canvas of n x n pixels. */
export function paintHeatmap(canvas: HTMLCanvasElement, db: Float32Array, n: number): void {
  canvas.width = n;
  canvas.height = n;
  const ctx = canvas.getContext("2d")!;
  const img = ctx.createImageData(n, n);
  for (let k = 0; k < n * n; k++) {
    const [r, g, b] = dbToRgb(db[k]!);
    img.data[4 * k] = r;
    img.data[4 * k + 1] = g;
    img.data[4 * k + 2] = b;
    img.data[4 * k + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
}

/** CSS gradient for the legend bar. */
export function legendGradient(): string {
  const parts: string[] = [];
  for (let k = 0; k <= 10; k++) {
    const [r, g, b] = dbToRgb(DB_MIN + ((DB_MAX - DB_MIN) * k) / 10);
    parts.push(`rgb(${r | 0},${g | 0},${b | 0}) ${k * 10}%`);
  }
  return `linear-gradient(to right, ${parts.join(",")})`;
}
