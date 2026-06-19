import { useEffect, useRef, useState } from "react";
import type { ImageSegmenter, ImageSegmenterResult } from "@mediapipe/tasks-vision";
import type { DemoProps } from "./types";
import { useAnimationFrame } from "../core/useAnimationFrame";
import { coverRect, syncCanvas } from "../core/overlay";
import { getVisionFileset, MODELS } from "../core/vision";
import "./demos.css";

type LoadState = "loading" | "ready" | "error";

interface Mode {
  name: string;
  bg: [number, number, number];
  bgAlpha: number;
  glow: [number, number, number];
  glowCss: string;
}

const MODES: Mode[] = [
  { name: "Spotlight", bg: [2, 4, 12], bgAlpha: 0.74, glow: [120, 180, 255], glowCss: "#5b8cff" },
  { name: "Neon", bg: [18, 0, 30], bgAlpha: 0.72, glow: [255, 90, 210], glowCss: "#ff5ad2" },
  { name: "Matrix", bg: [0, 22, 9], bgAlpha: 0.74, glow: [70, 255, 150], glowCss: "#46ff96" },
];

export default function BackgroundFx({ video, width, height, mirrored }: DemoProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const segmenterRef = useRef<ImageSegmenter | null>(null);
  const lastVideoTime = useRef(-1);
  const [state, setState] = useState<LoadState>("loading");
  const [modeIdx, setModeIdx] = useState(0);
  const modeRef = useRef(0);
  modeRef.current = modeIdx;

  // Offscreen layers sized to the mask, lazily (re)allocated.
  const layers = useRef<{
    w: number;
    h: number;
    tint: CanvasRenderingContext2D;
    glow: CanvasRenderingContext2D;
    tintData: ImageData;
    glowData: ImageData;
  } | null>(null);

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

  const ensureLayers = (w: number, h: number) => {
    if (layers.current && layers.current.w === w && layers.current.h === h) {
      return layers.current;
    }
    const mk = () => {
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      return c.getContext("2d")!;
    };
    const tint = mk();
    const glow = mk();
    layers.current = {
      w,
      h,
      tint,
      glow,
      tintData: tint.createImageData(w, h),
      glowData: glow.createImageData(w, h),
    };
    return layers.current;
  };

  const processMask = (result: ImageSegmenterResult) => {
    const mask = result.confidenceMasks?.[0];
    if (!mask) return result.close();
    const w = mask.width;
    const h = mask.height;
    const probs = mask.getAsFloat32Array();
    const mode = MODES[modeRef.current];
    const L = ensureLayers(w, h);
    const td = L.tintData.data;
    const gd = L.glowData.data;
    const [br, bg, bb] = mode.bg;
    const [gr, gg, gb] = mode.glow;
    const maxBg = mode.bgAlpha * 255;

    for (let i = 0; i < probs.length; i++) {
      const p = probs[i]; // person probability 0..1
      const o = i * 4;
      td[o] = br;
      td[o + 1] = bg;
      td[o + 2] = bb;
      td[o + 3] = (1 - p) * maxBg; // dim the background, reveal the person
      gd[o] = gr;
      gd[o + 1] = gg;
      gd[o + 2] = gb;
      gd[o + 3] = p * 255; // person silhouette for the glow pass
    }
    L.tint.putImageData(L.tintData, 0, 0);
    L.glow.putImageData(L.glowData, 0, 0);
    result.close(); // free the mask's WASM memory every frame
  };

  useAnimationFrame((_dt, nowMs) => {
    const canvas = canvasRef.current;
    const seg = segmenterRef.current;
    if (!canvas || !seg) return;

    if (video.currentTime !== lastVideoTime.current && video.readyState >= 2) {
      lastVideoTime.current = video.currentTime;
      try {
        seg.segmentForVideo(video, nowMs, processMask);
      } catch {
        /* skip transient frame errors */
      }
    }

    const frame = syncCanvas(canvas);
    if (!frame) return;
    const L = layers.current;
    if (!L) return;
    const { ctx, width: cw, height: ch } = frame;
    const r = coverRect(cw, ch, width, height);
    const mode = MODES[modeRef.current];

    ctx.save();
    if (mirrored) {
      ctx.translate(cw, 0);
      ctx.scale(-1, 1);
    }
    // Dim / tint the background (person stays clear).
    ctx.drawImage(L.tint.canvas, r.dx, r.dy, r.dw, r.dh);
    // Neon glow halo around the silhouette.
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = 0.55;
    ctx.shadowColor = mode.glowCss;
    ctx.shadowBlur = 22;
    ctx.drawImage(L.glow.canvas, r.dx, r.dy, r.dw, r.dh);
    ctx.restore();
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    ctx.shadowBlur = 0;
  }, state === "ready");

  return (
    <>
      <canvas ref={canvasRef} className="demo-canvas" />
      <button
        className="demo-fab"
        style={{ pointerEvents: "auto" }}
        onClick={() => setModeIdx((m) => (m + 1) % MODES.length)}
      >
        🎨 {MODES[modeIdx].name}
      </button>
      <div className="demo-status">
        <span
          className={
            "demo-status__dot" + (state !== "ready" ? " demo-status__dot--warn" : "")
          }
        />
        {state === "loading" && "Loading segmentation…"}
        {state === "error" && "Segmenter failed to load"}
        {state === "ready" && "Tap 🎨 to change the vibe"}
      </div>
    </>
  );
}
