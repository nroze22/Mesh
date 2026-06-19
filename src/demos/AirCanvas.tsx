import { useEffect, useRef, useState } from "react";
import type { HandLandmarker, NormalizedLandmark } from "@mediapipe/tasks-vision";
import type { DemoProps } from "./types";
import { useAnimationFrame } from "../core/useAnimationFrame";
import { coverProjector, syncCanvas } from "../core/overlay";
import { getVisionFileset, MODELS } from "../core/vision";
import "./demos.css";

type LoadState = "loading" | "ready" | "error";

interface Stroke {
  hue: number;
  pts: [number, number][]; // normalized video coords
}

const MAX_POINTS = 2600; // cap total points to bound memory/draw cost
const PINCH_RATIO = 0.45; // thumb–index distance / hand span to count as a pinch

export default function AirCanvas({ video, width, height, mirrored }: DemoProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const landmarkerRef = useRef<HandLandmarker | null>(null);
  const lastVideoTime = useRef(-1);
  const strokesRef = useRef<Stroke[]>([]);
  const drawingRef = useRef(false);
  const cursorRef = useRef<{ x: number; y: number; on: boolean } | null>(null);
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
          numHands: 1,
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

  const clear = () => {
    strokesRef.current = [];
    drawingRef.current = false;
  };

  useAnimationFrame((_dt, nowMs) => {
    const canvas = canvasRef.current;
    const lm = landmarkerRef.current;
    if (!canvas || !lm) return;

    if (video.currentTime !== lastVideoTime.current && video.readyState >= 2) {
      lastVideoTime.current = video.currentTime;
      try {
        const res = lm.detectForVideo(video, nowMs);
        const hand = res.landmarks?.[0];
        updateDrawing(hand, strokesRef, drawingRef, cursorRef);
      } catch {
        /* skip transient frame errors */
      }
    }

    const frame = syncCanvas(canvas);
    if (!frame) return;
    const project = coverProjector(frame.width, frame.height, width, height, mirrored);
    drawStrokes(frame.ctx, strokesRef.current, cursorRef.current, project, nowMs);
  }, state === "ready");

  return (
    <>
      <canvas ref={canvasRef} className="demo-canvas" />
      <button
        className="demo-fab"
        style={{ pointerEvents: "auto" }}
        onClick={clear}
        aria-label="Clear drawing"
      >
        🗑 Clear
      </button>
      <div className="demo-status">
        <span
          className={
            "demo-status__dot" + (state !== "ready" ? " demo-status__dot--warn" : "")
          }
        />
        {state === "loading" && "Loading hand tracker…"}
        {state === "error" && "Hand tracker failed to load"}
        {state === "ready" && "Pinch 👌 to draw · open palm 🖐 to clear"}
      </div>
    </>
  );
}

function dist(a: NormalizedLandmark, b: NormalizedLandmark) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function isOpenPalm(h: NormalizedLandmark[]): boolean {
  // Fingertip farther from wrist than its PIP joint => extended.
  const wrist = h[0];
  const extended = ([8, 12, 16, 20] as const).filter((tip) => {
    const pip = tip - 2;
    return dist(h[tip], wrist) > dist(h[pip], wrist) * 1.15;
  }).length;
  return extended >= 4;
}

function updateDrawing(
  hand: NormalizedLandmark[] | undefined,
  strokesRef: React.MutableRefObject<Stroke[]>,
  drawingRef: React.MutableRefObject<boolean>,
  cursorRef: React.MutableRefObject<{ x: number; y: number; on: boolean } | null>,
) {
  if (!hand) {
    drawingRef.current = false;
    cursorRef.current = null;
    return;
  }

  if (isOpenPalm(hand)) {
    strokesRef.current = [];
    drawingRef.current = false;
    const tip = hand[8];
    cursorRef.current = { x: tip.x, y: tip.y, on: false };
    return;
  }

  const span = dist(hand[0], hand[9]) || 0.0001; // wrist → middle MCP
  const pinch = dist(hand[4], hand[8]) / span < PINCH_RATIO;
  const tip = hand[8];
  const thumb = hand[4];
  const px = (tip.x + thumb.x) / 2;
  const py = (tip.y + thumb.y) / 2;
  cursorRef.current = { x: px, y: py, on: pinch };

  if (pinch) {
    let total = 0;
    for (const s of strokesRef.current) total += s.pts.length;
    if (!drawingRef.current) {
      strokesRef.current.push({ hue: (performance.now() / 18) % 360, pts: [[px, py]] });
      drawingRef.current = true;
    } else {
      const stroke = strokesRef.current[strokesRef.current.length - 1];
      const last = stroke.pts[stroke.pts.length - 1];
      if (!last || Math.hypot(px - last[0], py - last[1]) > 0.004) {
        stroke.pts.push([px, py]);
      }
    }
    // Bound memory: drop oldest stroke(s) once we exceed the cap.
    while (total > MAX_POINTS && strokesRef.current.length > 1) {
      total -= strokesRef.current[0].pts.length;
      strokesRef.current.shift();
    }
  } else {
    drawingRef.current = false;
  }
}

function drawStrokes(
  ctx: CanvasRenderingContext2D,
  strokes: Stroke[],
  cursor: { x: number; y: number; on: boolean } | null,
  project: (nx: number, ny: number) => [number, number],
  nowMs: number,
) {
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.globalCompositeOperation = "lighter";

  for (const stroke of strokes) {
    if (stroke.pts.length < 1) continue;
    const color = `hsl(${stroke.hue}, 95%, 62%)`;
    ctx.strokeStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 16;
    ctx.lineWidth = 6;
    ctx.beginPath();
    stroke.pts.forEach((p, i) => {
      const [x, y] = project(p[0], p[1]);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    if (stroke.pts.length === 1) {
      const [x, y] = project(stroke.pts[0][0], stroke.pts[0][1]);
      ctx.arc(x, y, 3, 0, Math.PI * 2);
    }
    ctx.stroke();
  }
  ctx.shadowBlur = 0;
  ctx.globalCompositeOperation = "source-over";

  // Fingertip cursor.
  if (cursor) {
    const [x, y] = project(cursor.x, cursor.y);
    const pulse = 1 + Math.sin(nowMs * 0.008) * 0.15;
    ctx.beginPath();
    ctx.arc(x, y, (cursor.on ? 11 : 8) * pulse, 0, Math.PI * 2);
    ctx.strokeStyle = cursor.on ? "#fff" : "rgba(255,255,255,0.65)";
    ctx.lineWidth = cursor.on ? 3 : 2;
    ctx.stroke();
    if (cursor.on) {
      ctx.fillStyle = "rgba(255,255,255,0.9)";
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}
