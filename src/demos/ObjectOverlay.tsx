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

export default function ObjectOverlay({ video, width, height, mirrored }: DemoProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sessionRef = useRef<InferenceSession | null>(null);
  const detectionsRef = useRef<Detection[]>([]);
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

  // Inference loop, decoupled from rendering so a slow frame never blocks the
  // draw loop. Schedules the next run as soon as the previous one resolves.
  useEffect(() => {
    if (state !== "ready") return;
    let cancelled = false;

    const tick = async () => {
      const session = sessionRef.current;
      if (cancelled || !session) return;
      if (video.readyState >= 2) {
        try {
          detectionsRef.current = await detectObjects(session, video);
          if (!cancelled) setCount(detectionsRef.current.length);
        } catch (err) {
          console.error("YOLOv8 inference error", err);
        }
      }
      if (!cancelled) requestAnimationFrame(tick);
    };
    void tick();

    return () => {
      cancelled = true;
    };
  }, [state, video]);

  // Render the latest detections every frame (smooth, persists between runs).
  useAnimationFrame(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const frame = syncCanvas(canvas);
    if (!frame) return;
    const project = coverProjector(frame.width, frame.height, width, height, mirrored);
    drawDetections(frame.ctx, detectionsRef.current, project);
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

function drawDetections(
  ctx: CanvasRenderingContext2D,
  detections: Detection[],
  project: (nx: number, ny: number) => [number, number],
) {
  ctx.font = "700 14px system-ui, sans-serif";
  ctx.textBaseline = "middle";

  detections.forEach((det, i) => {
    const color = PALETTE[det.classId % PALETTE.length] ?? PALETTE[i % PALETTE.length];
    const [px1, py1] = project(det.x1, det.y1);
    const [px2, py2] = project(det.x2, det.y2);
    const left = Math.min(px1, px2);
    const top = Math.min(py1, py2);
    const w = Math.abs(px2 - px1);
    const h = Math.abs(py2 - py1);

    // Animated corner brackets.
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
    const label = `${COCO_CLASSES[det.classId] ?? "object"}  ${Math.round(det.score * 100)}%`;
    const padX = 8;
    const tw = ctx.measureText(label).width + padX * 2;
    const chipH = 22;
    const chipY = Math.max(0, top - chipH - 4);
    ctx.fillStyle = color;
    ctx.fillRect(left, chipY, tw, chipH);
    ctx.fillStyle = "#06070d";
    ctx.fillText(label, left + padX, chipY + chipH / 2 + 1);
  });
}
