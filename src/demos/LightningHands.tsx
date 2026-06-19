import { useEffect, useRef, useState } from "react";
import type { HandLandmarker, NormalizedLandmark } from "@mediapipe/tasks-vision";
import type { DemoProps } from "./types";
import { useAnimationFrame } from "../core/useAnimationFrame";
import { coverProjector, syncCanvas } from "../core/overlay";
import { getVisionFileset, MODELS } from "../core/vision";
import "./demos.css";

type LoadState = "loading" | "ready" | "error";

const TIPS = [4, 8, 12, 16, 20] as const;

/**
 * Crackling electricity arcs between your fingertips and palms, jumping hand to
 * hand when they're close. Jagged, glowing, regenerated each frame.
 */
export default function LightningHands({ video, width, height, mirrored }: DemoProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const landmarkerRef = useRef<HandLandmarker | null>(null);
  const handsRef = useRef<NormalizedLandmark[][]>([]);
  const lastVideoTime = useRef(-1);
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

  useAnimationFrame(() => {
    const canvas = canvasRef.current;
    const lm = landmarkerRef.current;
    if (!canvas || !lm) return;

    if (video.currentTime !== lastVideoTime.current && video.readyState >= 2) {
      lastVideoTime.current = video.currentTime;
      try {
        handsRef.current = lm.detectForVideo(video, performance.now()).landmarks ?? [];
      } catch {
        /* skip */
      }
    }

    const frame = syncCanvas(canvas);
    if (!frame) return;
    const { ctx, width: cw, height: ch } = frame;
    const project = coverProjector(cw, ch, width, height, mirrored);
    const hands = handsRef.current;

    ctx.globalCompositeOperation = "lighter";
    ctx.lineCap = "round";

    const palms: [number, number][] = [];
    for (const hand of hands) {
      const tips = TIPS.map((t) => project(hand[t].x, hand[t].y));
      const palm = project(hand[9].x, hand[9].y);
      palms.push(palm);

      // Arcs between consecutive fingertips.
      for (let i = 0; i < tips.length - 1; i++) {
        bolt(ctx, tips[i][0], tips[i][1], tips[i + 1][0], tips[i + 1][1], "#9fd8ff", 1);
      }
      // Thumb tip ↔ index tip (pinch sparks brighter when close).
      const pinch = Math.hypot(tips[0][0] - tips[1][0], tips[0][1] - tips[1][1]);
      if (pinch < 0.18 * Math.min(cw, ch)) {
        bolt(ctx, tips[0][0], tips[0][1], tips[1][0], tips[1][1], "#ffffff", 2);
      }
      // Palm glow.
      glow(ctx, palm[0], palm[1], 26, "rgba(120,180,255,0.5)");
    }

    // Big arc between the two hands.
    if (palms.length === 2) {
      bolt(ctx, palms[0][0], palms[0][1], palms[1][0], palms[1][1], "#bfe4ff", 2.4);
    }

    ctx.globalCompositeOperation = "source-over";
  }, state === "ready");

  return (
    <>
      <canvas ref={canvasRef} className="demo-canvas" />
      <div className="demo-status">
        <span
          className={
            "demo-status__dot" + (state !== "ready" ? " demo-status__dot--warn" : "")
          }
        />
        {state === "loading" && "Loading hand tracker…"}
        {state === "error" && "Hand tracker failed to load"}
        {state === "ready" && "Spread your fingers · bring both hands close ⚡"}
      </div>
    </>
  );
}

function bolt(
  ctx: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  color: string,
  power: number,
) {
  const pts = jagged(x1, y1, x2, y2, Math.hypot(x2 - x1, y2 - y1) * 0.22, 5);
  ctx.strokeStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = 14 * power;
  ctx.lineWidth = power;
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.stroke();

  // occasional branch
  if (Math.random() < 0.5 && pts.length > 3) {
    const k = (pts.length / 2) | 0;
    const bx = pts[k][0] + (Math.random() - 0.5) * 60;
    const by = pts[k][1] + (Math.random() - 0.5) * 60;
    const bp = jagged(pts[k][0], pts[k][1], bx, by, 18, 3);
    ctx.lineWidth = power * 0.6;
    ctx.beginPath();
    ctx.moveTo(bp[0][0], bp[0][1]);
    for (let i = 1; i < bp.length; i++) ctx.lineTo(bp[i][0], bp[i][1]);
    ctx.stroke();
  }
  ctx.shadowBlur = 0;
}

// Midpoint-displacement jagged line.
function jagged(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  amp: number,
  depth: number,
): [number, number][] {
  let pts: [number, number][] = [
    [x1, y1],
    [x2, y2],
  ];
  for (let d = 0; d < depth; d++) {
    const next: [number, number][] = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      const mx = (a[0] + b[0]) / 2;
      const my = (a[1] + b[1]) / 2;
      const nx = -(b[1] - a[1]);
      const ny = b[0] - a[0];
      const len = Math.hypot(nx, ny) || 1;
      const off = (Math.random() - 0.5) * amp;
      next.push(a, [mx + (nx / len) * off, my + (ny / len) * off]);
    }
    next.push(pts[pts.length - 1]);
    pts = next;
    amp *= 0.5;
  }
  return pts;
}

function glow(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, color);
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}
