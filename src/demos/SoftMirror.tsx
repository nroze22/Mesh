import { useRef, useState } from "react";
import type { DemoProps } from "./types";
import { useAnimationFrame } from "../core/useAnimationFrame";
import { syncCanvas } from "../core/overlay";
import "./demos.css";

type Material = "Dots" | "Tiles" | "Bars" | "Petals";
const MATERIALS: Material[] = ["Dots", "Tiles", "Bars", "Petals"];

const COLS = 54;

/**
 * A "soft mirror": your reflection rebuilt from a grid of reactive elements
 * that ease toward the live image with a mechanical lag (a nod to Daniel
 * Rozin's mirrors). No ML — just sampled brightness + colour per cell.
 */
export default function SoftMirror({ video, mirrored }: DemoProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const proc = useRef<{ ctx: CanvasRenderingContext2D; cols: number; rows: number } | null>(null);
  const grid = useRef<Float32Array>(new Float32Array(0)); // eased brightness per cell
  const [matIdx, setMatIdx] = useState(0);
  const matRef = useRef(0);
  matRef.current = matIdx;

  useAnimationFrame((dt) => {
    const canvas = canvasRef.current;
    if (!canvas || video.readyState < 2) return;
    const frame = syncCanvas(canvas);
    if (!frame) return;
    const { ctx, width: cw, height: ch } = frame;

    const cols = COLS;
    const rows = Math.max(1, Math.round((COLS * ch) / cw));
    if (!proc.current || proc.current.cols !== cols || proc.current.rows !== rows) {
      const c = document.createElement("canvas");
      c.width = cols;
      c.height = rows;
      proc.current = { ctx: c.getContext("2d", { willReadFrequently: true })!, cols, rows };
      grid.current = new Float32Array(cols * rows);
    }
    const P = proc.current;
    P.ctx.drawImage(video, 0, 0, cols, rows);
    const data = P.ctx.getImageData(0, 0, cols, rows).data;

    const cw0 = cw / cols;
    const ch0 = ch / rows;
    const cell = Math.min(cw0, ch0);
    const ease = 1 - Math.exp(-dt * 9);
    const mat = MATERIALS[matRef.current];

    ctx.fillStyle = "#05060c";
    ctx.fillRect(0, 0, cw, ch);

    for (let gy = 0; gy < rows; gy++) {
      for (let gx = 0; gx < cols; gx++) {
        const di = (gy * cols + gx) * 4;
        const r = data[di];
        const g = data[di + 1];
        const b = data[di + 2];
        const target = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
        const idx = gy * cols + gx;
        grid.current[idx] += (target - grid.current[idx]) * ease;
        const v = grid.current[idx];

        // Mirror horizontally for a true selfie reflection.
        const colX = mirrored ? cols - 1 - gx : gx;
        const cx = colX * cw0 + cw0 / 2;
        const cy = gy * ch0 + ch0 / 2;
        const color = `rgb(${r},${g},${b})`;

        ctx.save();
        ctx.translate(cx, cy);
        if (mat === "Dots") {
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.arc(0, 0, (0.12 + v * 0.46) * cell, 0, Math.PI * 2);
          ctx.fill();
        } else if (mat === "Tiles") {
          ctx.rotate(v * (Math.PI / 2));
          ctx.fillStyle = color;
          const s = cell * 0.82;
          ctx.fillRect(-s / 2, -s / 2, s, s);
        } else if (mat === "Bars") {
          ctx.rotate(v * Math.PI);
          ctx.strokeStyle = color;
          ctx.lineCap = "round";
          ctx.lineWidth = cell * (0.18 + v * 0.25);
          ctx.beginPath();
          ctx.moveTo(-cell * 0.45, 0);
          ctx.lineTo(cell * 0.45, 0);
          ctx.stroke();
        } else {
          // Petals: a soft 4-lobe shape that opens with brightness.
          ctx.rotate(v * Math.PI);
          ctx.fillStyle = color;
          const rr = (0.2 + v * 0.5) * cell;
          for (let k = 0; k < 4; k++) {
            ctx.rotate(Math.PI / 2);
            ctx.beginPath();
            ctx.ellipse(rr * 0.5, 0, rr * 0.55, rr * 0.28, 0, 0, Math.PI * 2);
            ctx.fill();
          }
        }
        ctx.restore();
      }
    }
  }, true);

  return (
    <>
      <canvas ref={canvasRef} className="demo-canvas demo-canvas--opaque" />
      <button
        className="demo-fab"
        style={{ pointerEvents: "auto" }}
        onClick={() => setMatIdx((m) => (m + 1) % MATERIALS.length)}
      >
        🪞 {MATERIALS[matIdx]}
      </button>
      <div className="demo-status">
        <span className="demo-status__dot" />
        Tap to change the mirror's material
      </div>
    </>
  );
}
