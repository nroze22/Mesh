import { useEffect, useRef, useState } from "react";
import type { FaceLandmarker, NormalizedLandmark } from "@mediapipe/tasks-vision";
import type { DemoProps } from "./types";
import { useAnimationFrame } from "../core/useAnimationFrame";
import { coverProjector, syncCanvas } from "../core/overlay";
import { getVisionFileset, MODELS } from "../core/vision";
import "./demos.css";

type LoadState = "loading" | "ready" | "error";

const SETS = ["Shades", "Royal", "Disguise", "Doggo"] as const;
type SetName = (typeof SETS)[number];

export default function FaceFilters({ video, width, height, mirrored }: DemoProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const landmarkerRef = useRef<FaceLandmarker | null>(null);
  const faceRef = useRef<NormalizedLandmark[] | null>(null);
  const lastVideoTime = useRef(-1);
  const [state, setState] = useState<LoadState>("loading");
  const [setIdx, setSetIdx] = useState(0);
  const setRef = useRef(0);
  setRef.current = setIdx;

  useEffect(() => {
    let cancelled = false;
    let lm: FaceLandmarker | null = null;
    (async () => {
      try {
        const { FaceLandmarker } = await import("@mediapipe/tasks-vision");
        const fileset = await getVisionFileset();
        lm = await FaceLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: MODELS.faceLandmarker, delegate: "GPU" },
          runningMode: "VIDEO",
          numFaces: 1,
          outputFaceBlendshapes: false,
        });
        if (cancelled) return lm.close();
        landmarkerRef.current = lm;
        setState("ready");
      } catch (err) {
        console.error("FaceLandmarker failed to load", err);
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
        const res = lm.detectForVideo(video, performance.now());
        faceRef.current = res.faceLandmarks?.[0] ?? null;
      } catch {
        /* skip transient frame errors */
      }
    }

    const frame = syncCanvas(canvas);
    if (!frame) return;
    const project = coverProjector(frame.width, frame.height, width, height, mirrored);
    drawAccessories(frame.ctx, faceRef.current, SETS[setRef.current], project);
  }, state === "ready");

  return (
    <>
      <canvas ref={canvasRef} className="demo-canvas" />
      <button
        className="demo-fab"
        style={{ pointerEvents: "auto" }}
        onClick={() => setSetIdx((s) => (s + 1) % SETS.length)}
      >
        🎭 {SETS[setIdx]}
      </button>
      <div className="demo-status">
        <span
          className={
            "demo-status__dot" + (state !== "ready" ? " demo-status__dot--warn" : "")
          }
        />
        {state === "loading" && "Loading face tracker…"}
        {state === "error" && "Face tracker failed to load"}
        {state === "ready" && "Tap 🎭 to switch your look"}
      </div>
    </>
  );
}

function drawEmoji(
  ctx: CanvasRenderingContext2D,
  emoji: string,
  x: number,
  y: number,
  size: number,
  angle: number,
) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.font = `${size}px "Apple Color Emoji", "Segoe UI Emoji", serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(emoji, 0, 0);
  ctx.restore();
}

function drawAccessories(
  ctx: CanvasRenderingContext2D,
  face: NormalizedLandmark[] | null,
  set: SetName,
  project: (nx: number, ny: number) => [number, number],
) {
  if (!face) return;
  // Key points (MediaPipe canonical face mesh indices).
  const [e1x, e1y] = project(face[33].x, face[33].y); // right-eye outer
  const [e2x, e2y] = project(face[263].x, face[263].y); // left-eye outer
  const [nx, ny] = project(face[1].x, face[1].y); // nose tip
  const [fx, fy] = project(face[10].x, face[10].y); // forehead top
  const [clx, cly] = project(face[234].x, face[234].y); // left cheek
  const [crx, cry] = project(face[454].x, face[454].y); // right cheek

  const eyeMid: [number, number] = [(e1x + e2x) / 2, (e1y + e2y) / 2];
  const eyeDist = Math.hypot(e2x - e1x, e2y - e1y) || 1;
  const faceW = Math.hypot(crx - clx, cry - cly) || eyeDist * 2;
  const roll = Math.atan2(e2y - e1y, e2x - e1x);
  const ux = Math.cos(roll - Math.PI / 2);
  const uy = Math.sin(roll - Math.PI / 2); // "up" along the face

  if (set === "Shades") {
    drawEmoji(ctx, "🕶️", eyeMid[0] + ux * eyeDist * 0.12, eyeMid[1] + uy * eyeDist * 0.12, eyeDist * 2.3, roll);
  } else if (set === "Royal") {
    drawEmoji(ctx, "👑", fx + ux * eyeDist * 0.95, fy + uy * eyeDist * 0.95, eyeDist * 2.1, roll);
  } else if (set === "Disguise") {
    drawEmoji(ctx, "🥸", nx, ny - uy * 0 + (eyeMid[1] - ny) * 0.2, faceW * 1.15, roll);
  } else if (set === "Doggo") {
    // Snout on the nose, ears out to the sides above the eyes.
    drawEmoji(ctx, "🐽", nx, ny, eyeDist * 1.0, roll);
    drawEmoji(ctx, "🐶", e1x - ux * eyeDist * 0.2 + (e1x - e2x) * 0.25, e1y + uy * eyeDist * 1.3, eyeDist * 1.1, roll);
    drawEmoji(ctx, "🐶", e2x - ux * eyeDist * 0.2 - (e1x - e2x) * 0.25, e2y + uy * eyeDist * 1.3, eyeDist * 1.1, roll);
  }
}
