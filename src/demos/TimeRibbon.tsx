import { useRef } from "react";
import type { DemoProps } from "./types";
import { useAnimationFrame } from "../core/useAnimationFrame";
import { coverRect, syncCanvas } from "../core/overlay";
import "./demos.css";

const RW = 480; // ribbon working width
const SPEED = 2; // columns advanced per frame

/**
 * A slit-scan: every column of the image is sampled from a different moment in
 * time. Hold still for clean horizontal streaks; move for liquid time-warps.
 */
export default function TimeRibbon({ video, width, height, mirrored }: DemoProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ribbon = useRef<{ ctx: CanvasRenderingContext2D; w: number; h: number } | null>(null);

  useAnimationFrame(() => {
    const canvas = canvasRef.current;
    if (!canvas || video.readyState < 2) return;

    const rh = Math.max(1, Math.round((RW * height) / width));
    if (!ribbon.current || ribbon.current.w !== RW || ribbon.current.h !== rh) {
      const c = document.createElement("canvas");
      c.width = RW;
      c.height = rh;
      const rctx = c.getContext("2d")!;
      rctx.fillStyle = "#05060c";
      rctx.fillRect(0, 0, RW, rh);
      ribbon.current = { ctx: rctx, w: RW, h: rh };
    }
    const R = ribbon.current;

    // Scroll the ribbon left, then paint the live centre column into the gap.
    R.ctx.globalCompositeOperation = "copy";
    R.ctx.drawImage(R.ctx.canvas, -SPEED, 0);
    R.ctx.globalCompositeOperation = "source-over";
    const sw = Math.max(1, Math.round((video.videoWidth * SPEED) / RW));
    const sx = Math.floor((video.videoWidth - sw) / 2);
    R.ctx.drawImage(video, sx, 0, sw, video.videoHeight, RW - SPEED, 0, SPEED, R.h);

    // Blit the ribbon to the screen, cover-fitted (and mirrored).
    const frame = syncCanvas(canvas);
    if (!frame) return;
    const { ctx, width: cw, height: ch } = frame;
    const rect = coverRect(cw, ch, width, height);
    ctx.save();
    if (mirrored) {
      ctx.translate(cw, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(R.ctx.canvas, rect.dx, rect.dy, rect.dw, rect.dh);
    ctx.restore();
  }, true);

  return (
    <>
      <canvas ref={canvasRef} className="demo-canvas demo-canvas--opaque" />
      <div className="demo-status">
        <span className="demo-status__dot" />
        Each column is a different moment — try waving
      </div>
    </>
  );
}
