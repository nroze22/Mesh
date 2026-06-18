import { useEffect, useRef, useState } from "react";
import type { ObjectDetector, ObjectDetectorResult } from "@mediapipe/tasks-vision";
import type { DemoProps } from "./types";
import { useAnimationFrame } from "../core/useAnimationFrame";
import { coverProjector, syncCanvas } from "../core/overlay";
import { getVisionFileset, MODELS } from "../core/vision";
import "./demos.css";

type LoadState = "loading" | "ready" | "error";

const PALETTE = ["#5b8cff", "#38e8c8", "#ffb35b", "#b86bff", "#ff6b6b", "#7CFC9A"];

export default function ObjectOverlay({ video, width, height, mirrored }: DemoProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const detectorRef = useRef<ObjectDetector | null>(null);
  const resultRef = useRef<ObjectDetectorResult | null>(null);
  const lastVideoTime = useRef(-1);
  const [state, setState] = useState<LoadState>("loading");
  const [count, setCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let detector: ObjectDetector | null = null;
    (async () => {
      try {
        const { ObjectDetector } = await import("@mediapipe/tasks-vision");
        const fileset = await getVisionFileset();
        detector = await ObjectDetector.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: MODELS.objectDetector, delegate: "GPU" },
          runningMode: "VIDEO",
          scoreThreshold: 0.45,
          maxResults: 8,
        });
        if (cancelled) {
          detector.close();
          return;
        }
        detectorRef.current = detector;
        setState("ready");
      } catch (err) {
        console.error("ObjectDetector failed to load", err);
        if (!cancelled) setState("error");
      }
    })();
    return () => {
      cancelled = true;
      detectorRef.current?.close();
      detectorRef.current = null;
      detector?.close();
    };
  }, []);

  useAnimationFrame(() => {
    const canvas = canvasRef.current;
    const detector = detectorRef.current;
    if (!canvas || !detector) return;

    if (video.currentTime !== lastVideoTime.current && video.readyState >= 2) {
      lastVideoTime.current = video.currentTime;
      try {
        resultRef.current = detector.detectForVideo(video, performance.now());
        setCount(resultRef.current.detections.length);
      } catch {
        /* transient frame errors are safe to skip */
      }
    }

    const frame = syncCanvas(canvas);
    if (!frame) return;
    const project = coverProjector(frame.width, frame.height, width, height, mirrored);
    drawDetections(frame.ctx, resultRef.current, width, height, project);
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
        {state === "loading" && "Loading detector…"}
        {state === "error" && "Detector failed to load"}
        {state === "ready" &&
          (count > 0 ? `${count} object${count > 1 ? "s" : ""} detected` : "Scanning…")}
      </div>
    </>
  );
}

function drawDetections(
  ctx: CanvasRenderingContext2D,
  result: ObjectDetectorResult | null,
  videoW: number,
  videoH: number,
  project: (nx: number, ny: number) => [number, number],
) {
  if (!result) return;
  ctx.font = "700 14px var(--font, system-ui)";
  ctx.textBaseline = "middle";

  result.detections.forEach((det, i) => {
    const box = det.boundingBox;
    if (!box) return;
    const color = PALETTE[i % PALETTE.length];

    // Box corners → normalized → cover-projected screen px.
    const [x1, y1] = project(box.originX / videoW, box.originY / videoH);
    const [x2, y2] = project(
      (box.originX + box.width) / videoW,
      (box.originY + box.height) / videoH,
    );
    const left = Math.min(x1, x2);
    const top = Math.min(y1, y2);
    const w = Math.abs(x2 - x1);
    const h = Math.abs(y2 - y1);

    // Animated corner brackets.
    const corner = Math.min(26, w * 0.3, h * 0.3);
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.shadowColor = color;
    ctx.shadowBlur = 12;
    ctx.beginPath();
    // TL
    ctx.moveTo(left, top + corner);
    ctx.lineTo(left, top);
    ctx.lineTo(left + corner, top);
    // TR
    ctx.moveTo(left + w - corner, top);
    ctx.lineTo(left + w, top);
    ctx.lineTo(left + w, top + corner);
    // BR
    ctx.moveTo(left + w, top + h - corner);
    ctx.lineTo(left + w, top + h);
    ctx.lineTo(left + w - corner, top + h);
    // BL
    ctx.moveTo(left + corner, top + h);
    ctx.lineTo(left, top + h);
    ctx.lineTo(left, top + h - corner);
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Label chip.
    const cat = det.categories[0];
    const label = `${cat?.categoryName ?? "object"}  ${Math.round((cat?.score ?? 0) * 100)}%`;
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
