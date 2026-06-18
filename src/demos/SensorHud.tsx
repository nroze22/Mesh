import { useRef } from "react";
import type { DemoProps } from "./types";
import { useDeviceSensors } from "../core/useDeviceOrientation";
import { useAnimationFrame } from "../core/useAnimationFrame";
import { syncCanvas } from "../core/overlay";
import "./demos.css";

const ACCENT = "#38e8c8";

/**
 * A flight-instrument style HUD painted from the device's orientation and
 * motion sensors: artificial horizon, compass tape and live telemetry.
 */
export default function SensorHud(_props: DemoProps) {
  void _props;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { permission, orientation, motion, requestPermission } = useDeviceSensors();

  useAnimationFrame(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const frame = syncCanvas(canvas);
    if (!frame) return;
    drawHud(frame.ctx, frame.width, frame.height, orientation, motion);
  }, permission === "granted");

  const gForce =
    Math.hypot(motion.accel.x, motion.accel.y, motion.accel.z) / 9.81;

  return (
    <>
      <canvas ref={canvasRef} className="demo-canvas" />

      {permission !== "granted" && (
        <div className="demo-prompt">
          <div className="demo-prompt__panel">
            <h3>🧭 Sensor HUD</h3>
            <p>
              {permission === "unsupported"
                ? "This device doesn't expose motion sensors to the browser. Try it on a phone."
                : permission === "denied"
                  ? "Motion access was denied. Reload and allow it to see the HUD."
                  : "Tilt and turn your phone to drive a live heads-up display. We need permission to read the motion sensors."}
            </p>
            {permission !== "unsupported" && permission !== "denied" && (
              <button
                className="btn btn--primary"
                style={{ pointerEvents: "auto" }}
                onClick={() => void requestPermission()}
              >
                Enable motion sensors
              </button>
            )}
          </div>
        </div>
      )}

      {permission === "granted" && (
        <div className="demo-status">
          <span className="demo-status__dot" />
          {gForce.toFixed(2)} g · hdg {Math.round(orientation.alpha ?? 0)}°
        </div>
      )}
    </>
  );
}

function drawHud(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  orient: { alpha: number | null; beta: number | null; gamma: number | null },
  motion: { rotationRate: { alpha: number; beta: number; gamma: number } },
) {
  const cx = w / 2;
  const cy = h / 2;
  const pitch = orient.beta ?? 0; // degrees
  const roll = orient.gamma ?? 0; // degrees
  const heading = orient.alpha ?? 0;

  ctx.lineWidth = 1.5;
  ctx.strokeStyle = ACCENT;
  ctx.fillStyle = ACCENT;
  ctx.font = "600 13px ui-monospace, monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  // ---- Artificial horizon ----
  const pxPerDeg = h / 90;
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, Math.min(w, h) * 0.42, 0, Math.PI * 2);
  ctx.clip();
  ctx.translate(cx, cy);
  ctx.rotate((-roll * Math.PI) / 180);
  ctx.translate(0, (pitch - 90) * pxPerDeg * -1 + 0); // center on level

  ctx.globalAlpha = 0.9;
  for (let deg = -60; deg <= 60; deg += 10) {
    const y = -deg * pxPerDeg;
    const len = deg % 30 === 0 ? 90 : 50;
    ctx.beginPath();
    ctx.moveTo(-len, y);
    ctx.lineTo(len, y);
    ctx.globalAlpha = deg === 0 ? 1 : 0.5;
    ctx.lineWidth = deg === 0 ? 2.5 : 1.2;
    ctx.stroke();
    if (deg !== 0) {
      ctx.globalAlpha = 0.7;
      ctx.fillText(String(Math.abs(deg)), len + 18, y);
      ctx.fillText(String(Math.abs(deg)), -len - 18, y);
    }
  }
  ctx.restore();

  // ---- Fixed aircraft reference ----
  ctx.globalAlpha = 1;
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(cx - 60, cy);
  ctx.lineTo(cx - 20, cy);
  ctx.moveTo(cx - 20, cy);
  ctx.lineTo(cx - 20, cy + 12);
  ctx.moveTo(cx + 60, cy);
  ctx.lineTo(cx + 20, cy);
  ctx.moveTo(cx + 20, cy);
  ctx.lineTo(cx + 20, cy + 12);
  ctx.stroke();
  ctx.fillStyle = "#fff";
  ctx.beginPath();
  ctx.arc(cx, cy, 3, 0, Math.PI * 2);
  ctx.fill();

  // ---- Heading tape (top) ----
  const tapeY = Math.max(64, h * 0.1);
  ctx.strokeStyle = ACCENT;
  ctx.fillStyle = ACCENT;
  ctx.globalAlpha = 0.9;
  ctx.lineWidth = 1.5;
  const spanDeg = 60;
  const tapeW = Math.min(w * 0.8, 360);
  ctx.save();
  ctx.beginPath();
  ctx.rect(cx - tapeW / 2, tapeY - 24, tapeW, 48);
  ctx.clip();
  const pxPerDegH = tapeW / spanDeg;
  for (let d = -spanDeg; d <= spanDeg; d += 5) {
    const deg = Math.round(heading + d);
    const x = cx + d * pxPerDegH;
    const major = ((deg % 30) + 360) % 30 === 0;
    ctx.beginPath();
    ctx.moveTo(x, tapeY - (major ? 14 : 8));
    ctx.lineTo(x, tapeY);
    ctx.globalAlpha = major ? 0.95 : 0.4;
    ctx.stroke();
    if (major) {
      ctx.globalAlpha = 0.9;
      ctx.fillText(cardinal(deg), x, tapeY - 22);
    }
  }
  ctx.restore();

  // heading readout box
  ctx.globalAlpha = 1;
  ctx.fillStyle = "rgba(0,0,0,0.6)";
  roundRect(ctx, cx - 30, tapeY + 6, 60, 26, 6);
  ctx.fill();
  ctx.strokeStyle = ACCENT;
  ctx.lineWidth = 1.5;
  roundRect(ctx, cx - 30, tapeY + 6, 60, 26, 6);
  ctx.stroke();
  ctx.fillStyle = "#fff";
  ctx.fillText(`${Math.round(((heading % 360) + 360) % 360)}°`, cx, tapeY + 19);

  // ---- Telemetry block (bottom-left) ----
  const lines = [
    `PITCH  ${pad(pitch)}°`,
    `ROLL   ${pad(roll)}°`,
    `YAW-R  ${pad(motion.rotationRate.alpha)}/s`,
  ];
  ctx.textAlign = "left";
  ctx.font = "600 13px ui-monospace, monospace";
  const bx = 18;
  const by = h - 38 - lines.length * 20;
  ctx.fillStyle = "rgba(0,0,0,0.45)";
  roundRect(ctx, bx - 8, by - 8, 160, lines.length * 20 + 14, 8);
  ctx.fill();
  ctx.fillStyle = ACCENT;
  lines.forEach((line, i) => {
    ctx.fillText(line, bx, by + 8 + i * 20);
  });
}

function cardinal(deg: number): string {
  const d = ((deg % 360) + 360) % 360;
  const map: Record<number, string> = { 0: "N", 90: "E", 180: "S", 270: "W" };
  return map[d] ?? String(d);
}

function pad(n: number): string {
  const v = Math.round(n);
  return (v >= 0 ? "+" : "") + v;
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
