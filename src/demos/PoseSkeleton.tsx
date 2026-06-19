import { useEffect, useRef, useState } from "react";
import type { PoseLandmarker, NormalizedLandmark } from "@mediapipe/tasks-vision";
import type { DemoProps } from "./types";
import { useAnimationFrame } from "../core/useAnimationFrame";
import { coverProjector, syncCanvas } from "../core/overlay";
import { getVisionFileset, MODELS } from "../core/vision";
import "./demos.css";

type LoadState = "loading" | "ready" | "error";

// Landmarks that read as "major" joints (drawn as larger orbs).
const MAJOR = new Set([0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28]);

export default function PoseSkeleton({ video, width, height, mirrored }: DemoProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const landmarkerRef = useRef<PoseLandmarker | null>(null);
  const connectionsRef = useRef<{ start: number; end: number }[]>([]);
  const poseRef = useRef<NormalizedLandmark[] | null>(null);
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
        connectionsRef.current = PoseLandmarker.POSE_CONNECTIONS;
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
        poseRef.current = res.landmarks?.[0] ?? null;
        setTracked(!!poseRef.current);
      } catch {
        /* skip transient frame errors */
      }
    }

    const frame = syncCanvas(canvas);
    if (!frame) return;
    const project = coverProjector(frame.width, frame.height, width, height, mirrored);
    drawPose(frame.ctx, poseRef.current, connectionsRef.current, project, nowMs);
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
        {state === "ready" && (tracked ? "Body locked" : "Step back so you're in frame")}
      </div>
    </>
  );
}

function drawPose(
  ctx: CanvasRenderingContext2D,
  pose: NormalizedLandmark[] | null,
  connections: { start: number; end: number }[],
  project: (nx: number, ny: number) => [number, number],
  nowMs: number,
) {
  if (!pose) return;
  const VIS = 0.5;

  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.globalCompositeOperation = "lighter";

  // Bones.
  for (const c of connections) {
    const a = pose[c.start];
    const b = pose[c.end];
    if (!a || !b) continue;
    if ((a.visibility ?? 1) < VIS || (b.visibility ?? 1) < VIS) continue;
    const [ax, ay] = project(a.x, a.y);
    const [bx, by] = project(b.x, b.y);
    const hue = (200 + ((a.y + b.y) * 90) + nowMs * 0.02) % 360;
    const color = `hsl(${hue}, 95%, 62%)`;
    ctx.strokeStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 14;
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.stroke();
  }

  // Joints.
  for (let i = 0; i < pose.length; i++) {
    const p = pose[i];
    if ((p.visibility ?? 1) < VIS) continue;
    const [x, y] = project(p.x, p.y);
    const major = MAJOR.has(i);
    const r = major ? 8 : 4;
    const hue = (200 + p.y * 90 + nowMs * 0.02) % 360;
    ctx.fillStyle = `hsl(${hue}, 95%, ${major ? 70 : 80}%)`;
    ctx.shadowColor = ctx.fillStyle;
    ctx.shadowBlur = major ? 18 : 8;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.shadowBlur = 0;
  ctx.globalCompositeOperation = "source-over";
}
