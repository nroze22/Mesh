import { useEffect, useRef, useState } from "react";
import type { InferenceSession } from "onnxruntime-web/webgpu";
import type { DemoProps } from "./types";
import { useAnimationFrame } from "../core/useAnimationFrame";
import { coverProjector, syncCanvas } from "../core/overlay";
import { COCO_CLASSES, detectObjects, loadYolo, type Detection } from "../core/yolo";
import "./demos.css";

type LoadState = "loading" | "ready" | "error";

const PALETTE = ["#5b8cff", "#38e8c8", "#ffb35b", "#b86bff", "#ff6b6b", "#7CFC9A"];
const MODEL_URL = `${import.meta.env.BASE_URL}models/yolov8n.onnx`;

// Temporal smoothing tuning.
const MATCH_IOU = 0.2; // associate a detection to an existing track
const GRACE_MS = 350; // keep a track visible this long after it goes missing
const MOVE_SPEED = 11; // box glide rate (higher = snappier)
const FADE_SPEED = 7; // alpha fade rate
const MIN_ALPHA = 0.02; // drop a faded-out track below this

interface Box {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

interface Track {
  id: number;
  classId: number;
  box: Box; // smoothed, animated
  target: Box; // last detected position
  score: number;
  smoothedScore: number;
  alpha: number;
  lastSeen: number;
}

export default function ObjectOverlay({ video, width, height, mirrored }: DemoProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sessionRef = useRef<InferenceSession | null>(null);
  const tracksRef = useRef<Track[]>([]);
  const nextId = useRef(1);
  const [state, setState] = useState<LoadState>("loading");
  const [count, setCount] = useState(0);

  // Load the YOLOv8 session once.
  useEffect(() => {
    let cancelled = false;
    loadYolo(MODEL_URL)
      .then((session) => {
        if (cancelled) return;
        sessionRef.current = session;
        setState("ready");
      })
      .catch((err) => {
        console.error("YOLOv8 failed to load", err);
        if (!cancelled) setState("error");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Inference loop, decoupled from rendering and throttled to ~15 fps. The
  // tracker interpolates between runs, so a lower inference rate stays smooth
  // while capping GPU/memory churn (which otherwise crashes the tab).
  useEffect(() => {
    if (state !== "ready") return;
    let cancelled = false;
    let timer = 0;
    const INTERVAL = 66; // ms between inferences (~15 fps)

    const tick = async () => {
      const session = sessionRef.current;
      if (cancelled || !session) return;
      const start = performance.now();
      if (video.readyState >= 2) {
        try {
          const dets = await detectObjects(session, video);
          if (!cancelled) {
            updateTracks(tracksRef.current, dets, performance.now(), nextId);
            setCount((c) => (c === dets.length ? c : dets.length));
          }
        } catch (err) {
          console.error("YOLOv8 inference error", err);
        }
      }
      if (!cancelled) {
        const wait = Math.max(0, INTERVAL - (performance.now() - start));
        timer = window.setTimeout(tick, wait);
      }
    };
    void tick();

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [state, video]);

  // Render loop: animate every track toward its target + fade, then draw.
  useAnimationFrame((dt, now) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const frame = syncCanvas(canvas);
    if (!frame) return;
    const project = coverProjector(frame.width, frame.height, width, height, mirrored);

    const moveK = 1 - Math.exp(-dt * MOVE_SPEED);
    const fadeK = 1 - Math.exp(-dt * FADE_SPEED);

    const alive: Track[] = [];
    for (const t of tracksRef.current) {
      const missing = now - t.lastSeen > GRACE_MS;
      const targetAlpha = missing ? 0 : 1;
      t.alpha += (targetAlpha - t.alpha) * fadeK;

      t.box.x1 += (t.target.x1 - t.box.x1) * moveK;
      t.box.y1 += (t.target.y1 - t.box.y1) * moveK;
      t.box.x2 += (t.target.x2 - t.box.x2) * moveK;
      t.box.y2 += (t.target.y2 - t.box.y2) * moveK;
      t.smoothedScore += (t.score - t.smoothedScore) * moveK;

      if (missing && t.alpha < MIN_ALPHA) continue; // fully faded → drop
      alive.push(t);
      drawTrack(frame.ctx, t, project);
    }
    tracksRef.current = alive;
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
        {state === "loading" && "Loading YOLOv8…"}
        {state === "error" && "Model failed to load"}
        {state === "ready" &&
          (count > 0 ? `${count} object${count > 1 ? "s" : ""} detected` : "Scanning…")}
      </div>
    </>
  );
}

/** Greedy IoU association of detections to existing tracks (class-aware). */
function updateTracks(
  tracks: Track[],
  dets: Detection[],
  now: number,
  nextId: React.MutableRefObject<number>,
) {
  const pairs: { di: number; ti: number; iou: number }[] = [];
  dets.forEach((d, di) => {
    tracks.forEach((t, ti) => {
      if (t.classId !== d.classId) return;
      const i = iou(d, t.target);
      if (i > MATCH_IOU) pairs.push({ di, ti, iou: i });
    });
  });
  pairs.sort((a, b) => b.iou - a.iou);

  const usedDet = new Set<number>();
  const usedTrack = new Set<number>();
  for (const p of pairs) {
    if (usedDet.has(p.di) || usedTrack.has(p.ti)) continue;
    usedDet.add(p.di);
    usedTrack.add(p.ti);
    const t = tracks[p.ti];
    const d = dets[p.di];
    t.target = { x1: d.x1, y1: d.y1, x2: d.x2, y2: d.y2 };
    t.score = d.score;
    t.lastSeen = now;
  }

  // Spawn tracks for unmatched detections — they fade in at their position.
  dets.forEach((d, di) => {
    if (usedDet.has(di)) return;
    const box: Box = { x1: d.x1, y1: d.y1, x2: d.x2, y2: d.y2 };
    tracks.push({
      id: nextId.current++,
      classId: d.classId,
      box: { ...box },
      target: { ...box },
      score: d.score,
      smoothedScore: d.score,
      alpha: 0,
      lastSeen: now,
    });
  });
}

function drawTrack(
  ctx: CanvasRenderingContext2D,
  t: Track,
  project: (nx: number, ny: number) => [number, number],
) {
  const a = Math.max(0, Math.min(1, t.alpha));
  if (a <= 0) return;
  const color = PALETTE[t.classId % PALETTE.length];

  const [px1, py1] = project(t.box.x1, t.box.y1);
  const [px2, py2] = project(t.box.x2, t.box.y2);
  const left = Math.min(px1, px2);
  const top = Math.min(py1, py2);
  const w = Math.abs(px2 - px1);
  const h = Math.abs(py2 - py1);

  ctx.save();
  ctx.globalAlpha = a;

  // Corner brackets.
  const corner = Math.min(26, w * 0.3, h * 0.3);
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.shadowColor = color;
  ctx.shadowBlur = 12;
  ctx.beginPath();
  ctx.moveTo(left, top + corner);
  ctx.lineTo(left, top);
  ctx.lineTo(left + corner, top);
  ctx.moveTo(left + w - corner, top);
  ctx.lineTo(left + w, top);
  ctx.lineTo(left + w, top + corner);
  ctx.moveTo(left + w, top + h - corner);
  ctx.lineTo(left + w, top + h);
  ctx.lineTo(left + w - corner, top + h);
  ctx.moveTo(left + corner, top + h);
  ctx.lineTo(left, top + h);
  ctx.lineTo(left, top + h - corner);
  ctx.stroke();
  ctx.shadowBlur = 0;

  // Label chip.
  ctx.font = "700 14px system-ui, sans-serif";
  ctx.textBaseline = "middle";
  const label = `${COCO_CLASSES[t.classId] ?? "object"}  ${Math.round(t.smoothedScore * 100)}%`;
  const padX = 8;
  const tw = ctx.measureText(label).width + padX * 2;
  const chipH = 22;
  const chipY = Math.max(0, top - chipH - 4);
  ctx.fillStyle = color;
  ctx.fillRect(left, chipY, tw, chipH);
  ctx.fillStyle = "#06070d";
  ctx.fillText(label, left + padX, chipY + chipH / 2 + 1);

  ctx.restore();
}

function iou(a: Box, b: Box): number {
  const ix1 = Math.max(a.x1, b.x1);
  const iy1 = Math.max(a.y1, b.y1);
  const ix2 = Math.min(a.x2, b.x2);
  const iy2 = Math.min(a.y2, b.y2);
  const iw = Math.max(0, ix2 - ix1);
  const ih = Math.max(0, iy2 - iy1);
  const inter = iw * ih;
  const areaA = (a.x2 - a.x1) * (a.y2 - a.y1);
  const areaB = (b.x2 - b.x1) * (b.y2 - b.y1);
  return inter / (areaA + areaB - inter || 1);
}
