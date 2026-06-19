import { useEffect, useRef, useState } from "react";
import type { ImageSegmenter, ImageSegmenterResult } from "@mediapipe/tasks-vision";
import type { DemoProps } from "./types";
import { useAnimationFrame } from "../core/useAnimationFrame";
import { coverRect, syncCanvas } from "../core/overlay";
import { getVisionFileset, MODELS } from "../core/vision";
import "./demos.css";

type LoadState = "loading" | "ready" | "error";

interface Star {
  x: number;
  y: number;
  r: number;
  ph: number;
  sp: number;
}

const STARS: Star[] = Array.from({ length: 260 }, () => ({
  x: Math.random(),
  y: Math.random(),
  r: 0.4 + Math.random() * 1.4,
  ph: Math.random() * Math.PI * 2,
  sp: 1 + Math.random() * 3,
}));

/**
 * Selfie segmentation turns your silhouette into a window onto deep space —
 * drifting nebulae and twinkling stars contained within your shape.
 */
export default function Portal({ video, width, height, mirrored }: DemoProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const segmenterRef = useRef<ImageSegmenter | null>(null);
  const lastVideoTime = useRef(-1);
  const [state, setState] = useState<LoadState>("loading");

  const mask = useRef<{ w: number; h: number; ctx: CanvasRenderingContext2D; data: ImageData; ready: boolean } | null>(null);
  const buf = useRef<{ w: number; h: number; cos: CanvasRenderingContext2D; pm: CanvasRenderingContext2D } | null>(null);

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
    if (!mask.current || mask.current.w !== w || mask.current.h !== h) {
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      const cx = c.getContext("2d")!;
      mask.current = { w, h, ctx: cx, data: cx.createImageData(w, h), ready: false };
    }
    const M = mask.current;
    const md = M.data.data;
    for (let i = 0; i < probs.length; i++) {
      const o = i * 4;
      md[o] = md[o + 1] = md[o + 2] = 255;
      md[o + 3] = probs[i] > 0.5 ? 255 : probs[i] * probs[i] * 255;
    }
    M.ctx.putImageData(M.data, 0, 0);
    M.ready = true;
    result.close();
  };

  useAnimationFrame((_dt, nowMs) => {
    const canvas = canvasRef.current;
    const seg = segmenterRef.current;
    if (!canvas || !seg) return;

    if (video.currentTime !== lastVideoTime.current && video.readyState >= 2) {
      lastVideoTime.current = video.currentTime;
      try {
        seg.segmentForVideo(video, nowMs, onMask);
      } catch {
        /* skip */
      }
    }

    const frame = syncCanvas(canvas);
    if (!frame) return;
    const { ctx, width: cw, height: ch } = frame;
    const W = Math.round(cw);
    const H = Math.round(ch);

    if (!buf.current || buf.current.w !== W || buf.current.h !== H) {
      const mk = () => {
        const c = document.createElement("canvas");
        c.width = W;
        c.height = H;
        return c.getContext("2d")!;
      };
      buf.current = { w: W, h: H, cos: mk(), pm: mk() };
    }
    const B = buf.current;

    // 1. Paint the cosmos.
    const cos = B.cos;
    cos.globalCompositeOperation = "source-over";
    cos.fillStyle = "#060617";
    cos.fillRect(0, 0, W, H);
    cos.globalCompositeOperation = "lighter";
    for (let k = 0; k < 3; k++) {
      const t = nowMs * 0.00006 + k * 2;
      const gx = (0.5 + 0.4 * Math.cos(t)) * W;
      const gy = (0.5 + 0.4 * Math.sin(t * 1.3)) * H;
      const rad = Math.max(W, H) * 0.5;
      const hue = (k * 90 + nowMs * 0.01) % 360;
      const g = cos.createRadialGradient(gx, gy, 0, gx, gy, rad);
      g.addColorStop(0, `hsla(${hue}, 80%, 55%, 0.55)`);
      g.addColorStop(1, "hsla(0,0%,0%,0)");
      cos.fillStyle = g;
      cos.fillRect(0, 0, W, H);
    }
    for (const s of STARS) {
      const a = 0.4 + 0.6 * Math.abs(Math.sin(nowMs * 0.001 * s.sp + s.ph));
      cos.fillStyle = `rgba(255,255,255,${a})`;
      cos.beginPath();
      cos.arc(s.x * W, s.y * H, s.r, 0, Math.PI * 2);
      cos.fill();
    }
    cos.globalCompositeOperation = "source-over";

    // 2. Person alpha in canvas space.
    const pm = B.pm;
    pm.clearRect(0, 0, W, H);
    const M = mask.current;
    ctx.fillStyle = "#05060c";
    ctx.fillRect(0, 0, cw, ch);
    if (!M || !M.ready) return;
    const r = coverRect(W, H, width, height);
    pm.save();
    if (mirrored) {
      pm.translate(W, 0);
      pm.scale(-1, 1);
    }
    pm.drawImage(M.ctx.canvas, r.dx, r.dy, r.dw, r.dh);
    pm.restore();

    // 3. Cosmos ∩ person.
    cos.globalCompositeOperation = "destination-in";
    cos.drawImage(pm.canvas, 0, 0);
    cos.globalCompositeOperation = "source-over";

    // 4. Composite: rim glow + masked cosmos.
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = 0.5;
    ctx.shadowColor = "#7aa2ff";
    ctx.shadowBlur = 26;
    ctx.drawImage(pm.canvas, 0, 0, W, H, 0, 0, cw, ch);
    ctx.restore();
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
    ctx.drawImage(cos.canvas, 0, 0, W, H, 0, 0, cw, ch);
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
        {state === "ready" && "Step in — you are a doorway to space 🌌"}
      </div>
    </>
  );
}
