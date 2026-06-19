import { useRef, useState } from "react";
import type { DemoProps } from "./types";
import { useAnimationFrame } from "../core/useAnimationFrame";
import { coverRect, syncCanvas } from "../core/overlay";
import "./demos.css";

type Filter = "Thermal" | "Edges" | "ASCII" | "Pixelate";
const FILTERS: Filter[] = ["Thermal", "Edges", "ASCII", "Pixelate"];

const PROC_W = 480; // working resolution for pixel processing

/**
 * A pure image-processing camera — no ML model. Renders the live frame through
 * retro CV filters (thermal palette, Sobel edges, ASCII art, pixelation).
 */
export default function FxCam({ video, width, height, mirrored }: DemoProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const proc = useRef<{ ctx: CanvasRenderingContext2D; w: number; h: number } | null>(null);
  const ascii = useRef<CanvasRenderingContext2D | null>(null);
  const [filterIdx, setFilterIdx] = useState(0);
  const filterRef = useRef(0);
  filterRef.current = filterIdx;

  const ensureProc = (w: number, h: number) => {
    if (!proc.current || proc.current.w !== w || proc.current.h !== h) {
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      proc.current = { ctx: c.getContext("2d", { willReadFrequently: true })!, w, h };
      const a = document.createElement("canvas");
      a.width = w;
      a.height = h;
      ascii.current = a.getContext("2d")!;
    }
    return proc.current;
  };

  useAnimationFrame(() => {
    const canvas = canvasRef.current;
    if (!canvas || video.readyState < 2) return;
    const frame = syncCanvas(canvas);
    if (!frame) return;

    const pw = PROC_W;
    const ph = Math.max(1, Math.round((PROC_W * height) / width));
    const p = ensureProc(pw, ph);
    const filter = FILTERS[filterRef.current];

    // Source canvas we ultimately blit to screen.
    let src: HTMLCanvasElement = p.ctx.canvas;

    if (filter === "Pixelate") {
      const bw = 64;
      const bh = Math.max(1, Math.round((bw * ph) / pw));
      p.ctx.imageSmoothingEnabled = false;
      p.ctx.clearRect(0, 0, pw, ph);
      // draw tiny then upscale within the same canvas
      p.ctx.drawImage(video, 0, 0, bw, bh);
      p.ctx.drawImage(p.ctx.canvas, 0, 0, bw, bh, 0, 0, pw, ph);
    } else {
      p.ctx.imageSmoothingEnabled = true;
      p.ctx.drawImage(video, 0, 0, pw, ph);
      const img = p.ctx.getImageData(0, 0, pw, ph);
      if (filter === "Thermal") thermal(img.data);
      if (filter === "Edges") edges(img, pw, ph);
      if (filter === "ASCII") {
        src = asciiArt(ascii.current!, img.data, pw, ph);
      }
      if (filter !== "ASCII") p.ctx.putImageData(img, 0, 0);
    }

    // Blit cover-fitted (and mirrored) over the screen.
    const r = coverRect(frame.width, frame.height, width, height);
    frame.ctx.save();
    frame.ctx.imageSmoothingEnabled = filter !== "Pixelate";
    if (mirrored) {
      frame.ctx.translate(frame.width, 0);
      frame.ctx.scale(-1, 1);
    }
    frame.ctx.drawImage(src, r.dx, r.dy, r.dw, r.dh);
    frame.ctx.restore();
  }, true);

  return (
    <>
      <canvas ref={canvasRef} className="demo-canvas" />
      <button
        className="demo-fab"
        style={{ pointerEvents: "auto" }}
        onClick={() => setFilterIdx((f) => (f + 1) % FILTERS.length)}
      >
        🎞 {FILTERS[filterIdx]}
      </button>
      <div className="demo-status">
        <span className="demo-status__dot" />
        Tap to cycle filters · no AI, just pixels
      </div>
    </>
  );
}

function lum(r: number, g: number, b: number) {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

// Map brightness to a black→blue→magenta→red→yellow→white thermal ramp.
function thermal(d: Uint8ClampedArray) {
  for (let i = 0; i < d.length; i += 4) {
    const t = lum(d[i], d[i + 1], d[i + 2]) / 255;
    const [r, g, b] = thermalColor(t);
    d[i] = r;
    d[i + 1] = g;
    d[i + 2] = b;
  }
}

function thermalColor(t: number): [number, number, number] {
  const stops: [number, [number, number, number]][] = [
    [0.0, [0, 0, 20]],
    [0.25, [40, 0, 120]],
    [0.5, [200, 30, 120]],
    [0.7, [255, 80, 0]],
    [0.85, [255, 200, 0]],
    [1.0, [255, 255, 230]],
  ];
  for (let i = 1; i < stops.length; i++) {
    if (t <= stops[i][0]) {
      const [t0, c0] = stops[i - 1];
      const [t1, c1] = stops[i];
      const f = (t - t0) / (t1 - t0 || 1);
      return [
        c0[0] + (c1[0] - c0[0]) * f,
        c0[1] + (c1[1] - c0[1]) * f,
        c0[2] + (c1[2] - c0[2]) * f,
      ];
    }
  }
  return stops[stops.length - 1][1];
}

// Sobel edge detection → neon edges on near-black.
function edges(img: ImageData, w: number, h: number) {
  const d = img.data;
  const gray = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) gray[i] = lum(d[i * 4], d[i * 4 + 1], d[i * 4 + 2]);
  const out = new Uint8ClampedArray(d.length);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx =
        -gray[i - w - 1] - 2 * gray[i - 1] - gray[i + w - 1] +
        gray[i - w + 1] + 2 * gray[i + 1] + gray[i + w + 1];
      const gy =
        -gray[i - w - 1] - 2 * gray[i - w] - gray[i - w + 1] +
        gray[i + w - 1] + 2 * gray[i + w] + gray[i + w + 1];
      const mag = Math.min(255, Math.hypot(gx, gy));
      const o = i * 4;
      const e = mag / 255;
      out[o] = 40 * e;
      out[o + 1] = 230 * e;
      out[o + 2] = 200 * e + 30 * e;
      out[o + 3] = 255;
    }
  }
  d.set(out);
}

const RAMP = " .:-=+*#%@";

function asciiArt(
  ctx: CanvasRenderingContext2D,
  d: Uint8ClampedArray,
  w: number,
  h: number,
): HTMLCanvasElement {
  const cell = 6;
  ctx.fillStyle = "#04060a";
  ctx.fillRect(0, 0, w, h);
  ctx.font = `${cell + 1}px ui-monospace, monospace`;
  ctx.textBaseline = "top";
  for (let y = 0; y < h; y += cell) {
    for (let x = 0; x < w; x += cell) {
      const i = (y * w + x) * 4;
      const t = lum(d[i], d[i + 1], d[i + 2]) / 255;
      const ch = RAMP[Math.min(RAMP.length - 1, Math.floor(t * RAMP.length))];
      if (ch === " ") continue;
      ctx.fillStyle = `hsl(${150 - t * 40}, 90%, ${30 + t * 45}%)`;
      ctx.fillText(ch, x, y);
    }
  }
  return ctx.canvas;
}
