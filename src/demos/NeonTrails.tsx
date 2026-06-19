import { useEffect, useRef, useState } from "react";
import type { PoseLandmarker, NormalizedLandmark } from "@mediapipe/tasks-vision";
import type { DemoProps } from "./types";
import { useAnimationFrame } from "../core/useAnimationFrame";
import { coverProjector, syncCanvas } from "../core/overlay";
import { getVisionFileset, MODELS } from "../core/vision";
import "./demos.css";

type LoadState = "loading" | "ready" | "error";

const TRAIL_MS = 850;

// Joints to trail, with their signature colors.
const TRACKED: { idx: number; color: string }[] = [
  { idx: 15, color: "#38e8c8" }, // left wrist
  { idx: 16, color: "#ff5ad2" }, // right wrist
  { idx: 19, color: "#5b8cff" }, // left index
  { idx: 20, color: "#ffb35b" }, // right index
  { idx: 27, color: "#7CFC9A" }, // left ankle
  { idx: 28, color: "#b86bff" }, // right ankle
  { idx: 0, color: "#ffffff" }, // nose
];

interface Pt {
  x: number;
  y: number;
  t: number;
}

export default function NeonTrails({ video, width, height, mirrored }: DemoProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const landmarkerRef = useRef<PoseLandmarker | null>(null);
  const trailsRef = useRef<Map<number, Pt[]>>(new Map());
  const lastVideoTime = useRef(-1);
  const [state, setState] = useState<LoadState>("loading");
  const [tracked, setTracked] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let lm: PoseLandmarker | null = null;
    (async () => {
      try {
        const { PoseLandmarker } = await import("@mediapipe/tasks-vision");
        const fileset = await getVisionFileset();
        lm = await PoseLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: MODELS.poseLandmarker, delegate: "GPU" },
          runningMode: "VIDEO",
          numPoses: 1,
        });
        if (cancelled) return lm.close();
        landmarkerRef.current = lm;
        setState("ready");
      } catch (err) {
        console.error("PoseLandmarker failed to load", err);
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

  useAnimationFrame((_dt, nowMs) => {
    const canvas = canvasRef.current;
    const lm = landmarkerRef.current;
    if (!canvas || !lm) return;

    if (video.currentTime !== lastVideoTime.current && video.readyState >= 2) {
      lastVideoTime.current = video.currentTime;
      try {
        const res = lm.detectForVideo(video, nowMs);
        const pose: NormalizedLandmark[] | undefined = res.landmarks?.[0];
        setTracked(!!pose);
        if (pose) {
          for (const { idx } of TRACKED) {
            const p = pose[idx];
            if (!p || (p.visibility ?? 1) < 0.5) continue;
            const arr = trailsRef.current.get(idx) ?? [];
            arr.push({ x: p.x, y: p.y, t: nowMs });
            trailsRef.current.set(idx, arr);
          }
        }
      } catch {
        /* skip transient frame errors */
      }
    }

    const frame = syncCanvas(canvas);
    if (!frame) return;
    const project = coverProjector(frame.width, frame.height, width, height, mirrored);
    drawTrails(frame.ctx, trailsRef.current, project, nowMs);
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
        {state === "loading" && "Loading pose tracker…"}
        {state === "error" && "Pose tracker failed to load"}
        {state === "ready" && (tracked ? "Wave your arms ✨" : "Step back into frame")}
      </div>
    </>
  );
}

function drawTrails(
  ctx: CanvasRenderingContext2D,
  trails: Map<number, Pt[]>,
  project: (nx: number, ny: number) => [number, number],
  nowMs: number,
) {
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.globalCompositeOperation = "lighter";

  for (const { idx, color } of TRACKED) {
    const pts = trails.get(idx);
    if (!pts || pts.length === 0) continue;

    // Drop expired points.
    while (pts.length && nowMs - pts[0].t > TRAIL_MS) pts.shift();
    if (pts.length === 0) {
      trails.delete(idx);
      continue;
    }

    ctx.strokeStyle = color;
    ctx.shadowColor = color;
    for (let i = 1; i < pts.length; i++) {
      const age = (nowMs - pts[i].t) / TRAIL_MS; // 0 = fresh, 1 = old
      const a = 1 - age;
      const [x0, y0] = project(pts[i - 1].x, pts[i - 1].y);
      const [x1, y1] = project(pts[i].x, pts[i].y);
      ctx.globalAlpha = a * 0.9;
      ctx.lineWidth = 2 + a * 9;
      ctx.shadowBlur = 16 * a;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
    }

    // Bright head of the trail.
    const head = pts[pts.length - 1];
    const [hx, hy] = project(head.x, head.y);
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 22;
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(hx, hy, 5, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.globalAlpha = 1;
  ctx.shadowBlur = 0;
  ctx.globalCompositeOperation = "source-over";
}
