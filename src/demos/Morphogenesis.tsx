import { useEffect, useRef, useState } from "react";
import type { ImageSegmenter, ImageSegmenterResult } from "@mediapipe/tasks-vision";
import type { DemoProps } from "./types";
import { useAnimationFrame } from "../core/useAnimationFrame";
import { coverRect, syncCanvas } from "../core/overlay";
import { getVisionFileset, MODELS } from "../core/vision";
import "./demos.css";

type LoadState = "loading" | "ready" | "error";

const GW = 168; // simulation grid width
const ITERS = 7; // reaction-diffusion steps per frame
// Gray-Scott "coral" parameters.
const DA = 1.0;
const DB = 0.5;
const FEED = 0.0545;
const KILL = 0.062;

interface Grid {
  w: number;
  h: number;
  a: Float32Array;
  b: Float32Array;
  a2: Float32Array;
  b2: Float32Array;
  octx: CanvasRenderingContext2D;
  img: ImageData;
}

/**
 * Gray-Scott reaction-diffusion: your segmented body continually seeds a
 * chemical that grows into living Turing patterns — coral, cells, fingerprints
 * — blooming outward from your silhouette. Morphogenesis, live.
 */
export default function Morphogenesis({ video, width, height, mirrored }: DemoProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const segmenterRef = useRef<ImageSegmenter | null>(null);
  const lastVideoTime = useRef(-1);
  const grid = useRef<Grid | null>(null);
  const mask = useRef<{ w: number; h: number; p: Float32Array } | null>(null);
  const [state, setState] = useState<LoadState>("loading");

  useEffect(() => {
    let cancelled = false;
    let seg: ImageSegmenter | null = null;
    (async () => {
      try {
        const { ImageSegmenter } = await import("@mediapipe/tasks-vision");
        const fileset = await getVisionFileset();
        seg = await ImageSegmenter.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: MODELS.selfieSegmenter, delegate: "GPU" },
          runningMode: "VIDEO",
          outputConfidenceMasks: true,
          outputCategoryMask: false,
        });
        if (cancelled) return seg.close();
        segmenterRef.current = seg;
        setState("ready");
      } catch (err) {
        console.error("ImageSegmenter failed to load", err);
        if (!cancelled) setState("error");
      }
    })();
    return () => {
      cancelled = true;
      segmenterRef.current?.close();
      segmenterRef.current = null;
      seg?.close();
    };
  }, []);

  const onMask = (result: ImageSegmenterResult) => {
    const m = result.confidenceMasks?.[0];
    if (!m) return result.close();
    const w = m.width;
    const h = m.height;
    const src = m.getAsFloat32Array();
    if (!mask.current || mask.current.w !== w || mask.current.h !== h) {
      mask.current = { w, h, p: new Float32Array(w * h) };
    }
    mask.current.p.set(src);
    result.close();
  };

  const ensureGrid = (): Grid => {
    const h = Math.max(1, Math.round((GW * height) / width));
    if (grid.current && grid.current.w === GW && grid.current.h === h) return grid.current;
    const n = GW * h;
    const a = new Float32Array(n).fill(1);
    const b = new Float32Array(n);
    const oc = document.createElement("canvas");
    oc.width = GW;
    oc.height = h;
    const octx = oc.getContext("2d")!;
    grid.current = { w: GW, h, a, b, a2: new Float32Array(n), b2: new Float32Array(n), octx, img: octx.createImageData(GW, h) };
    return grid.current;
  };

  useAnimationFrame((_dt, nowMs) => {
    const canvas = canvasRef.current;
    const seg = segmenterRef.current;
    if (!canvas || !seg) return;
    const frame = syncCanvas(canvas);
    if (!frame) return;
    const { ctx, width: cw, height: ch } = frame;
    const G = ensureGrid();

    if (video.currentTime !== lastVideoTime.current && video.readyState >= 2) {
      lastVideoTime.current = video.currentTime;
      try {
        seg.segmentForVideo(video, nowMs, onMask);
      } catch {
        /* skip */
      }
    }

    // Seed chemical B wherever the body is.
    const M = mask.current;
    if (M) {
      for (let gy = 0; gy < G.h; gy++) {
        const my = ((gy / G.h) * M.h) | 0;
        for (let gx = 0; gx < G.w; gx++) {
          const mx = ((gx / G.w) * M.w) | 0;
          if (M.p[my * M.w + mx] > 0.5) {
            const i = gy * G.w + gx;
            G.b[i] = Math.min(1, G.b[i] + 0.5);
          }
        }
      }
    }

    react(G);
    colorize(G.b, G.img.data, G.w * G.h, nowMs);
    G.octx.putImageData(G.img, 0, 0);

    ctx.fillStyle = "#05060c";
    ctx.fillRect(0, 0, cw, ch);
    const r = coverRect(cw, ch, width, height);
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    if (mirrored) {
      ctx.translate(cw, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(G.octx.canvas, r.dx, r.dy, r.dw, r.dh);
    ctx.restore();
  }, state === "ready");

  return (
    <>
      <canvas ref={canvasRef} className="demo-canvas demo-canvas--opaque" />
      <div className="demo-status">
        <span
          className={
            "demo-status__dot" + (state !== "ready" ? " demo-status__dot--warn" : "")
          }
        />
        {state === "loading" && "Loading segmentation…"}
        {state === "error" && "Segmenter failed to load"}
        {state === "ready" && "Move slowly — let the patterns grow from you"}
      </div>
    </>
  );
}

function react(G: Grid) {
  const { w, h, a, b, a2, b2 } = G;
  for (let it = 0; it < ITERS; it++) {
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        const il = i - 1, ir = i + 1, iu = i - w, id = i + w;
        const lapA =
          -a[i] + 0.2 * (a[il] + a[ir] + a[iu] + a[id]) +
          0.05 * (a[il - w] + a[ir - w] + a[il + w] + a[ir + w]);
        const lapB =
          -b[i] + 0.2 * (b[il] + b[ir] + b[iu] + b[id]) +
          0.05 * (b[il - w] + b[ir - w] + b[il + w] + b[ir + w]);
        const ab2 = a[i] * b[i] * b[i];
        a2[i] = a[i] + (DA * lapA - ab2 + FEED * (1 - a[i]));
        b2[i] = b[i] + (DB * lapB + ab2 - (KILL + FEED) * b[i]);
      }
    }
    a.set(a2);
    b.set(b2);
  }
}

function colorize(b: Float32Array, out: Uint8ClampedArray, n: number, nowMs: number) {
  const drift = (nowMs * 0.006) % 60;
  for (let i = 0; i < n; i++) {
    const v = Math.max(0, Math.min(1, b[i] * 2.4));
    const o = i * 4;
    const hue = 250 - v * 210 + drift; // indigo → magenta → gold
    const [r, g, bl] = hsl(hue, 0.85, 0.08 + v * 0.62);
    out[o] = r;
    out[o + 1] = g;
    out[o + 2] = bl;
    out[o + 3] = 255;
  }
}

function hsl(h: number, s: number, l: number): [number, number, number] {
  h = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return [((r + m) * 255) | 0, ((g + m) * 255) | 0, ((b + m) * 255) | 0];
}
