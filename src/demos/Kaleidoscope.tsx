import { useRef, useState } from "react";
import type { DemoProps } from "./types";
import { useAnimationFrame } from "../core/useAnimationFrame";
import { syncCanvas } from "../core/overlay";
import "./demos.css";

const SEGMENTS = [6, 8, 10, 14, 18];

/**
 * A live kaleidoscope — the camera reflected into radial symmetry, slowly
 * rotating and panning. No model, pure geometry.
 */
export default function Kaleidoscope({ video }: DemoProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [segIdx, setSegIdx] = useState(2);
  const segRef = useRef(2);
  segRef.current = segIdx;

  useAnimationFrame((_dt, now) => {
    const canvas = canvasRef.current;
    if (!canvas || video.readyState < 2) return;
    const frame = syncCanvas(canvas);
    if (!frame) return;
    const { ctx, width: cw, height: ch } = frame;
    const cx = cw / 2;
    const cy = ch / 2;
    const R = Math.hypot(cw, ch) / 2 + 10;
    const seg = SEGMENTS[segRef.current];
    const ang = (Math.PI * 2) / seg;

    const vw = video.videoWidth;
    const vh = video.videoHeight;
    const zoom = 0.42;
    const sw = vw * zoom;
    const sh = vh * zoom;
    const px = (Math.sin(now * 0.00031) * 0.5 + 0.5) * (vw - sw);
    const py = (Math.cos(now * 0.00041) * 0.5 + 0.5) * (vh - sh);
    const spin = now * 0.00018;

    ctx.fillStyle = "#05060c";
    ctx.fillRect(0, 0, cw, ch);

    for (let k = 0; k < seg; k++) {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(k * ang + spin);
      if (k % 2 === 1) ctx.scale(1, -1);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, R, -ang / 2 - 0.01, ang / 2 + 0.01);
      ctx.closePath();
      ctx.clip();
      // Sampled region fans out from the centre.
      ctx.drawImage(video, px, py, sw, sh, 0, -R, R, 2 * R);
      ctx.restore();
    }

    // Soft vignette to focus the centre.
    const g = ctx.createRadialGradient(cx, cy, R * 0.25, cx, cy, R);
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(1, "rgba(5,6,12,0.55)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, cw, ch);
  }, true);

  return (
    <>
      <canvas ref={canvasRef} className="demo-canvas demo-canvas--opaque" />
      <button
        className="demo-fab"
        style={{ pointerEvents: "auto" }}
        onClick={() => setSegIdx((s) => (s + 1) % SEGMENTS.length)}
      >
        🔮 {SEGMENTS[segIdx]}-fold
      </button>
      <div className="demo-status">
        <span className="demo-status__dot" />
        Move things near the camera · tap to change symmetry
      </div>
    </>
  );
}
