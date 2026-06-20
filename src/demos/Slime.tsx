import { useEffect, useRef, useState } from "react";
import type { HandLandmarker } from "@mediapipe/tasks-vision";
import type { DemoProps } from "./types";
import { useAnimationFrame } from "../core/useAnimationFrame";
import { coverProjector, syncCanvas } from "../core/overlay";
import { getVisionFileset, MODELS } from "../core/vision";
import "./demos.css";

type LoadState = "loading" | "ready" | "error";

const AGENTS = 4200;
const TW = 320; // trail-map width

interface Sim {
  tw: number;
  th: number;
  trail: Float32Array;
  temp: Float32Array;
  ax: Float32Array;
  ay: Float32Array;
  ah: Float32Array;
  octx: CanvasRenderingContext2D;
  img: ImageData;
}

/**
 * A Physarum (slime-mold) simulation: thousands of agents deposit and follow a
 * pheromone trail, self-organising into emergent vein networks that grow toward
 * your hands (which drop "food"). After Sage Jenson's mould.
 */
export default function Slime({ video, width, height, mirrored }: DemoProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const landmarkerRef = useRef<HandLandmarker | null>(null);
  const lastVideoTime = useRef(-1);
  const sim = useRef<Sim | null>(null);
  const wells = useRef<[number, number][]>([]);
  const [state, setState] = useState<LoadState>("loading");

  useEffect(() => {
    let cancelled = false;
    let lm: HandLandmarker | null = null;
    (async () => {
      try {
        const { HandLandmarker } = await import("@mediapipe/tasks-vision");
        const fileset = await getVisionFileset();
        lm = await HandLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: MODELS.handLandmarker, delegate: "GPU" },
          runningMode: "VIDEO",
          numHands: 2,
        });
        if (cancelled) return lm.close();
        landmarkerRef.current = lm;
        setState("ready");
      } catch (err) {
        console.error("HandLandmarker failed to load", err);
        if (!cancelled) setState("error");
      }
    })();
    return () => {
      cancelled = true;
      landmarkerRef.current?.close();
      landmarkerRef.current = null;
      lm?.close();
    };
  }, []);

  const ensureSim = (cw: number, ch: number): Sim => {
    const th = Math.max(1, Math.round((TW * ch) / cw));
    if (sim.current && sim.current.tw === TW && sim.current.th === th) return sim.current;
    const trail = new Float32Array(TW * th);
    const temp = new Float32Array(TW * th);
    const ax = new Float32Array(AGENTS);
    const ay = new Float32Array(AGENTS);
    const ah = new Float32Array(AGENTS);
    for (let i = 0; i < AGENTS; i++) {
      // start in a disc in the centre, random heading
      const r = Math.random() * Math.min(TW, th) * 0.25;
      const a = Math.random() * Math.PI * 2;
      ax[i] = TW / 2 + Math.cos(a) * r;
      ay[i] = th / 2 + Math.sin(a) * r;
      ah[i] = Math.random() * Math.PI * 2;
    }
    const oc = document.createElement("canvas");
    oc.width = TW;
    oc.height = th;
    const octx = oc.getContext("2d")!;
    sim.current = { tw: TW, th, trail, temp, ax, ay, ah, octx, img: octx.createImageData(TW, th) };
    return sim.current;
  };

  useAnimationFrame((_dt, nowMs) => {
    const canvas = canvasRef.current;
    const lm = landmarkerRef.current;
    if (!canvas || !lm) return;
    const frame = syncCanvas(canvas);
    if (!frame) return;
    const { ctx, width: cw, height: ch } = frame;
    const S = ensureSim(cw, ch);
    const { tw, th, trail, temp, ax, ay, ah } = S;

    const project = coverProjector(cw, ch, width, height, mirrored);
    if (video.currentTime !== lastVideoTime.current && video.readyState >= 2) {
      lastVideoTime.current = video.currentTime;
      try {
        wells.current = (lm.detectForVideo(video, nowMs).landmarks ?? []).map((h) => {
          const [px, py] = project(h[9].x, h[9].y);
          return [(px / cw) * tw, (py / ch) * th];
        });
      } catch {
        /* skip */
      }
    }

    // Food: hands deposit a bright blob the network grows toward.
    for (const w of wells.current) {
      const cx = w[0] | 0;
      const cy = w[1] | 0;
      for (let dy = -6; dy <= 6; dy++) {
        for (let dx = -6; dx <= 6; dx++) {
          const x = cx + dx;
          const y = cy + dy;
          if (x < 0 || x >= tw || y < 0 || y >= th) continue;
          if (dx * dx + dy * dy <= 36) trail[y * tw + x] += 1.6;
        }
      }
    }

    // --- Agent step (sense → steer → move → deposit) ---
    const SENSE_D = 9;
    const SENSE_A = 0.5;
    const TURN = 0.45;
    const SPEED = 1.0;
    for (let i = 0; i < AGENTS; i++) {
      const h = ah[i];
      const x = ax[i];
      const y = ay[i];
      const c = sample(trail, tw, th, x + Math.cos(h) * SENSE_D, y + Math.sin(h) * SENSE_D);
      const l = sample(trail, tw, th, x + Math.cos(h - SENSE_A) * SENSE_D, y + Math.sin(h - SENSE_A) * SENSE_D);
      const r = sample(trail, tw, th, x + Math.cos(h + SENSE_A) * SENSE_D, y + Math.sin(h + SENSE_A) * SENSE_D);
      let nh = h;
      if (c >= l && c >= r) {
        /* keep */
      } else if (l > r) nh = h - TURN;
      else if (r > l) nh = h + TURN;
      else nh = h + (Math.random() - 0.5) * TURN * 2;

      let nx = x + Math.cos(nh) * SPEED;
      let ny = y + Math.sin(nh) * SPEED;
      // wrap
      if (nx < 0) nx += tw;
      else if (nx >= tw) nx -= tw;
      if (ny < 0) ny += th;
      else if (ny >= th) ny -= th;
      ax[i] = nx;
      ay[i] = ny;
      ah[i] = nh;
      trail[(ny | 0) * tw + (nx | 0)] += 0.9;
    }

    // --- Diffuse + decay ---
    diffuseDecay(trail, temp, tw, th, 0.86);

    // --- Render the trail map and blit ---
    colorize(trail, S.img.data, tw * th, nowMs);
    S.octx.putImageData(S.img, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(S.octx.canvas, 0, 0, tw, th, 0, 0, cw, ch);
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
        {state === "loading" && "Loading hand tracker…"}
        {state === "error" && "Hand tracker failed to load"}
        {state === "ready" && "Move your hands — feed the living network"}
      </div>
    </>
  );
}

function sample(t: Float32Array, w: number, h: number, x: number, y: number): number {
  let xi = x | 0;
  let yi = y | 0;
  if (xi < 0) xi += w;
  else if (xi >= w) xi -= w;
  if (yi < 0) yi += h;
  else if (yi >= h) yi -= h;
  return t[yi * w + xi];
}

function diffuseDecay(t: Float32Array, tmp: Float32Array, w: number, h: number, decay: number) {
  for (let y = 0; y < h; y++) {
    const y0 = ((y - 1 + h) % h) * w;
    const y1 = y * w;
    const y2 = ((y + 1) % h) * w;
    for (let x = 0; x < w; x++) {
      const xl = (x - 1 + w) % w;
      const xr = (x + 1) % w;
      const s =
        t[y0 + xl] + t[y0 + x] + t[y0 + xr] +
        t[y1 + xl] + t[y1 + x] + t[y1 + xr] +
        t[y2 + xl] + t[y2 + x] + t[y2 + xr];
      tmp[y1 + x] = (s / 9) * decay;
    }
  }
  t.set(tmp);
}

function colorize(t: Float32Array, out: Uint8ClampedArray, n: number, nowMs: number) {
  const hueBase = (nowMs * 0.005) % 360;
  for (let i = 0; i < n; i++) {
    const v = Math.min(1, t[i] * 0.5);
    const o = i * 4;
    // teal → green → white ramp with a slow global hue drift
    const hue = hueBase + 150 + v * 60;
    const [r, g, b] = hsl(hue, 0.85, Math.min(0.92, v * 0.95));
    out[o] = r;
    out[o + 1] = g;
    out[o + 2] = b;
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
