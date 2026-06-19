import { useEffect, useRef, useState } from "react";
import type { ImageSegmenter, ImageSegmenterResult } from "@mediapipe/tasks-vision";
import type { DemoProps } from "./types";
import { useAnimationFrame } from "../core/useAnimationFrame";
import { coverProjector, syncCanvas } from "../core/overlay";
import { getVisionFileset, MODELS } from "../core/vision";
import "./demos.css";

type LoadState = "loading" | "ready" | "error";

const COUNT = 2200;

interface P {
  x: number;
  y: number;
  vx: number;
  vy: number;
  tx: number; // target (normalized video coords)
  ty: number;
  has: boolean;
  hue: number;
}

/**
 * Selfie segmentation dissolves your silhouette into a flowing field of light
 * particles that stream to fill your form and disperse when you leave.
 */
export default function Stardust({ video, width, height, mirrored }: DemoProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const segmenterRef = useRef<ImageSegmenter | null>(null);
  const lastVideoTime = useRef(-1);
  const points = useRef<Float32Array>(new Float32Array(0)); // person pts [x,y,...]
  const nPoints = useRef(0);
  const particles = useRef<P[]>([]);
  const [state, setState] = useState<LoadState>("loading");

  if (particles.current.length === 0) {
    particles.current = Array.from({ length: COUNT }, () => ({
      x: Math.random(),
      y: Math.random(),
      vx: 0,
      vy: 0,
      tx: 0,
      ty: 0,
      has: false,
      hue: 180 + Math.random() * 120,
    }));
  }

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
    const probs = m.getAsFloat32Array();
    // Sample person pixels on a stride into a flat [x,y,...] list.
    const stride = 5;
    const cap = (Math.ceil(w / stride) * Math.ceil(h / stride) * 2) | 0;
    if (points.current.length < cap) points.current = new Float32Array(cap);
    const buf = points.current;
    let n = 0;
    for (let y = 0; y < h; y += stride) {
      for (let x = 0; x < w; x += stride) {
        if (probs[y * w + x] > 0.55) {
          buf[n++] = x / w;
          buf[n++] = y / h;
        }
      }
    }
    points.current = buf;
    nPoints.current = n / 2;
    result.close();
  };

  useAnimationFrame((dt, nowMs) => {
    const canvas = canvasRef.current;
    const seg = segmenterRef.current;
    if (!canvas || !seg) return;
    const step = Math.min(dt, 0.05);

    if (video.currentTime !== lastVideoTime.current && video.readyState >= 2) {
      lastVideoTime.current = video.currentTime;
      try {
        seg.segmentForVideo(video, nowMs, onMask);
      } catch {
        /* skip */
      }
    }

    const frame = syncCanvas(canvas, false);
    if (!frame) return;
    const { ctx, width: cw, height: ch } = frame;
    const project = coverProjector(cw, ch, width, height, mirrored);

    // Fade previous frame for luminous trails.
    ctx.fillStyle = "rgba(5,6,12,0.30)";
    ctx.fillRect(0, 0, cw, ch);

    const pts = points.current;
    const np = nPoints.current;
    ctx.globalCompositeOperation = "lighter";

    for (const p of particles.current) {
      // Occasionally (re)assign a target person pixel for flowing motion.
      if (np > 0 && (!p.has || Math.random() < 0.025)) {
        const i = (Math.random() * np) | 0;
        p.tx = pts[i * 2];
        p.ty = pts[i * 2 + 1];
        p.has = true;
      } else if (np === 0) {
        p.has = false;
      }

      let px: number, py: number;
      if (p.has) {
        const [sx, sy] = project(p.tx, p.ty);
        const k = 9;
        p.vx += (sx / cw - p.x) * k * step;
        p.vy += (sy / ch - p.y) * k * step;
      } else {
        // Drift outward and dissipate.
        p.vx += (Math.random() - 0.5) * 0.4 * step;
        p.vy += (0.15 - p.y) * 0.2 * step;
      }
      // curl noise for life
      p.vx += Math.sin(p.y * 12 + nowMs * 0.001) * 0.05 * step;
      p.vy += Math.cos(p.x * 12 + nowMs * 0.001) * 0.05 * step;
      p.vx *= 0.9;
      p.vy *= 0.9;
      p.x += p.vx * step;
      p.y += p.vy * step;
      px = p.x * cw;
      py = p.y * ch;

      const speed = Math.hypot(p.vx, p.vy);
      const light = p.has ? 65 : 45;
      const a = p.has ? 0.85 : 0.3;
      ctx.fillStyle = `hsla(${p.hue + speed * 40}, 95%, ${light}%, ${a})`;
      const r = p.has ? 1.6 : 1.1;
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalCompositeOperation = "source-over";
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
        {state === "ready" && "Step in — become light ✨"}
      </div>
    </>
  );
}
