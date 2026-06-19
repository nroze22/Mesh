import { useEffect, useRef, useState } from "react";
import type { ImageSegmenter, ImageSegmenterResult } from "@mediapipe/tasks-vision";
import type { DemoProps } from "./types";
import { useAnimationFrame } from "../core/useAnimationFrame";
import { coverRect, syncCanvas } from "../core/overlay";
import { getVisionFileset, MODELS } from "../core/vision";
import "./demos.css";

type LoadState = "loading" | "ready" | "error";

/**
 * Chronophotography: your segmented body is stamped each frame onto a slowly
 * fading canvas, so motion leaves a wake of ghost-selves (Marey / Muybridge).
 */
export default function Echoes({ video, width, height, mirrored }: DemoProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const segmenterRef = useRef<ImageSegmenter | null>(null);
  const lastVideoTime = useRef(-1);
  const [state, setState] = useState<LoadState>("loading");

  const cut = useRef<{ w: number; h: number; temp: CanvasRenderingContext2D; mask: CanvasRenderingContext2D; maskData: ImageData; ready: boolean } | null>(null);

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

  const ensure = (w: number, h: number) => {
    if (cut.current && cut.current.w === w && cut.current.h === h) return cut.current;
    const mk = () => {
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      return c.getContext("2d")!;
    };
    const temp = mk();
    const mask = mk();
    cut.current = { w, h, temp, mask, maskData: mask.createImageData(w, h), ready: false };
    return cut.current;
  };

  const onMask = (result: ImageSegmenterResult) => {
    const m = result.confidenceMasks?.[0];
    if (!m) return result.close();
    const w = m.width;
    const h = m.height;
    const probs = m.getAsFloat32Array();
    const C = ensure(w, h);
    const md = C.maskData.data;
    for (let i = 0; i < probs.length; i++) {
      const o = i * 4;
      md[o] = md[o + 1] = md[o + 2] = 255;
      md[o + 3] = probs[i] > 0.5 ? 255 : probs[i] * 255;
    }
    C.mask.putImageData(C.maskData, 0, 0);
    // person cutout = video ∩ mask
    C.temp.globalCompositeOperation = "source-over";
    C.temp.clearRect(0, 0, w, h);
    C.temp.drawImage(video, 0, 0, w, h);
    C.temp.globalCompositeOperation = "destination-in";
    C.temp.drawImage(C.mask.canvas, 0, 0);
    C.temp.globalCompositeOperation = "source-over";
    C.ready = true;
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

    const frame = syncCanvas(canvas, false);
    if (!frame) return;
    const { ctx, width: cw, height: ch } = frame;

    // Fade the previous frame to leave a decaying wake of ghosts.
    ctx.fillStyle = "rgba(5,6,12,0.12)";
    ctx.fillRect(0, 0, cw, ch);

    const C = cut.current;
    if (!C || !C.ready) return;
    const r = coverRect(cw, ch, width, height);
    ctx.save();
    ctx.globalAlpha = 0.5;
    if (mirrored) {
      ctx.translate(cw, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(C.temp.canvas, r.dx, r.dy, r.dw, r.dh);
    ctx.restore();
    ctx.globalAlpha = 1;
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
        {state === "ready" && "Move and leave a wake of yourselves"}
      </div>
    </>
  );
}
