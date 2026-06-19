import { useEffect, useRef, useState } from "react";
import type { ImageSegmenter, ImageSegmenterResult } from "@mediapipe/tasks-vision";
import type { DemoProps } from "./types";
import { useAnimationFrame } from "../core/useAnimationFrame";
import { coverRect, syncCanvas } from "../core/overlay";
import { getVisionFileset, MODELS } from "../core/vision";
import "./demos.css";

type LoadState = "loading" | "ready" | "error";

/**
 * Capture a still of the empty scene, then composite that background over your
 * segmented silhouette so you disappear — a Harry-Potter invisibility cloak.
 */
export default function InvisibilityCloak({ video, width, height, mirrored }: DemoProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const segmenterRef = useRef<ImageSegmenter | null>(null);
  const lastVideoTime = useRef(-1);
  const [state, setState] = useState<LoadState>("loading");
  const [captured, setCaptured] = useState(false);
  const captureReq = useRef(false);

  const bg = useRef<HTMLCanvasElement | null>(null);
  const layers = useRef<{
    w: number;
    h: number;
    temp: CanvasRenderingContext2D;
    mask: CanvasRenderingContext2D;
    maskData: ImageData;
    ready: boolean;
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

  const captureBackground = () => {
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh) return;
    let c = bg.current;
    if (!c || c.width !== vw || c.height !== vh) {
      c = document.createElement("canvas");
      c.width = vw;
      c.height = vh;
      bg.current = c;
    }
    c.getContext("2d")!.drawImage(video, 0, 0, vw, vh);
    captureReq.current = false;
    setCaptured(true);
  };

  const ensureLayers = (w: number, h: number) => {
    if (layers.current && layers.current.w === w && layers.current.h === h) return layers.current;
    const mk = () => {
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      return c.getContext("2d")!;
    };
    const temp = mk();
    const mask = mk();
    layers.current = { w, h, temp, mask, maskData: mask.createImageData(w, h), ready: false };
    return layers.current;
  };

  const processMask = (result: ImageSegmenterResult) => {
    const m = result.confidenceMasks?.[0];
    const bgCanvas = bg.current;
    if (!m || !bgCanvas) return result.close();
    const w = m.width;
    const h = m.height;
    const probs = m.getAsFloat32Array();
    const L = ensureLayers(w, h);
    const md = L.maskData.data;
    for (let i = 0; i < probs.length; i++) {
      const o = i * 4;
      md[o] = 255;
      md[o + 1] = 255;
      md[o + 2] = 255;
      md[o + 3] = probs[i] * 255; // person alpha
    }
    L.mask.putImageData(L.maskData, 0, 0);
    // background, kept only where the person is.
    L.temp.globalCompositeOperation = "source-over";
    L.temp.clearRect(0, 0, w, h);
    L.temp.drawImage(bgCanvas, 0, 0, w, h);
    L.temp.globalCompositeOperation = "destination-in";
    L.temp.drawImage(L.mask.canvas, 0, 0);
    L.temp.globalCompositeOperation = "source-over";
    L.ready = true;
    result.close();
  };

  useAnimationFrame((_dt, nowMs) => {
    const canvas = canvasRef.current;
    const seg = segmenterRef.current;
    if (!canvas || !seg) return;

    if (captureReq.current) captureBackground();

    if (captured && video.currentTime !== lastVideoTime.current && video.readyState >= 2) {
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
    if (!captured || !L || !L.ready) return;
    const r = coverRect(frame.width, frame.height, width, height);
    frame.ctx.save();
    if (mirrored) {
      frame.ctx.translate(frame.width, 0);
      frame.ctx.scale(-1, 1);
    }
    frame.ctx.drawImage(L.temp.canvas, r.dx, r.dy, r.dw, r.dh);
    frame.ctx.restore();
  }, state === "ready");

  return (
    <>
      <canvas ref={canvasRef} className="demo-canvas" />
      <button
        className="demo-fab"
        style={{ pointerEvents: "auto" }}
        onClick={() => (captureReq.current = true)}
      >
        📸 {captured ? "Recapture scene" : "Capture empty scene"}
      </button>
      <div className="demo-status">
        <span
          className={
            "demo-status__dot" +
            (state !== "ready" ? " demo-status__dot--warn" : captured ? "" : " demo-status__dot--idle")
          }
        />
        {state === "loading" && "Loading segmentation…"}
        {state === "error" && "Segmenter failed to load"}
        {state === "ready" &&
          (captured
            ? "Now step into frame and vanish 🫥"
            : "Step out of frame, then tap 📸")}
      </div>
    </>
  );
}
