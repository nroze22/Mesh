import { useEffect, useRef, useState } from "react";
import type { HandLandmarker } from "@mediapipe/tasks-vision";
import type { DemoProps } from "./types";
import { useAnimationFrame } from "../core/useAnimationFrame";
import { coverProjector, syncCanvas } from "../core/overlay";
import { getVisionFileset, MODELS } from "../core/vision";
import { perlin3 } from "../core/noise";
import "./demos.css";

type LoadState = "loading" | "ready" | "error";

const N = 2400;
const NOISE_SCALE = 0.0016;
const SPEED = 80;

interface Agent {
  x: number;
  y: number;
  life: number;
  hue: number;
}

/**
 * A Perlin flow field made visible: thousands of agents drift along an unseen
 * vector field, painting silken ribbons of light. Your hands twist the field
 * into vortices you can stir the currents with.
 */
export default function Currents({ video, width, height, mirrored }: DemoProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const landmarkerRef = useRef<HandLandmarker | null>(null);
  const lastVideoTime = useRef(-1);
  const agents = useRef<Agent[]>([]);
  const wells = useRef<[number, number][]>([]);
  const [state, setState] = useState<LoadState>("loading");

  useEffect(() => {
    let cancelled = false;
    let lm: HandLandmarker | null = null;
    (async () => {
      try {
        const { HandLandmarker } = await import("@mediapipe/tasks-vision");
        const fileset = await getVisionFileset();
        lm = await HandLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: MODELS.handLandmarker, delegate: "GPU" },
          runningMode: "VIDEO",
          numHands: 2,
        });
        if (cancelled) return lm.close();
        landmarkerRef.current = lm;
        setState("ready");
      } catch (err) {
        console.error("HandLandmarker failed to load", err);
        if (!cancelled) setState("error");
      }
    })();
    return () => {
      cancelled = true;
      landmarkerRef.current?.close();
      landmarkerRef.current = null;
      lm?.close();
    };
  }, []);

  useAnimationFrame((dt, nowMs) => {
    const canvas = canvasRef.current;
    const lm = landmarkerRef.current;
    if (!canvas || !lm) return;
    const step = Math.min(dt, 0.05);

    const frame = syncCanvas(canvas, false);
    if (!frame) return;
    const { ctx, width: cw, height: ch } = frame;
    const project = coverProjector(cw, ch, width, height, mirrored);

    if (agents.current.length === 0) {
      agents.current = Array.from({ length: N }, () => spawn(cw, ch));
    }

    if (video.currentTime !== lastVideoTime.current && video.readyState >= 2) {
      lastVideoTime.current = video.currentTime;
      try {
        wells.current = (lm.detectForVideo(video, nowMs).landmarks ?? []).map((h) =>
          project(h[9].x, h[9].y),
        );
      } catch {
        /* skip */
      }
    }

    // Fade for silk trails.
    ctx.fillStyle = "rgba(5,6,12,0.06)";
    ctx.fillRect(0, 0, cw, ch);
    ctx.globalCompositeOperation = "lighter";
    ctx.lineWidth = 1.1;

    const t = nowMs * 0.00007;
    const ws = wells.current;
    for (const a of agents.current) {
      const ang0 = perlin3(a.x * NOISE_SCALE, a.y * NOISE_SCALE, t) * Math.PI * 3;
      let vx = Math.cos(ang0);
      let vy = Math.sin(ang0);

      // Hand vortices warp the field — add a tangential swirl around each hand.
      for (const w of ws) {
        const dx = a.x - w[0];
        const dy = a.y - w[1];
        const d = Math.hypot(dx, dy);
        if (d < 260 && d > 1) {
          const weight = (1 - d / 260) * 2.2;
          // tangential (perpendicular to the radius) → circulation
          vx += (-dy / d) * weight;
          vy += (dx / d) * weight;
        }
      }
      const ang = Math.atan2(vy, vx);

      const nx = a.x + Math.cos(ang) * SPEED * step;
      const ny = a.y + Math.sin(ang) * SPEED * step;

      ctx.strokeStyle = `hsla(${a.hue}, 90%, 65%, 0.5)`;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(nx, ny);
      ctx.stroke();

      a.x = nx;
      a.y = ny;
      a.life -= step;
      if (a.life <= 0 || a.x < -10 || a.x > cw + 10 || a.y < -10 || a.y > ch + 10) {
        Object.assign(a, spawn(cw, ch));
      }
    }
    ctx.globalCompositeOperation = "source-over";
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
        {state === "loading" && "Loading hand tracker…"}
        {state === "error" && "Hand tracker failed to load"}
        {state === "ready" && "Move your hands to stir the currents 🌊"}
      </div>
    </>
  );
}

function spawn(cw: number, ch: number): Agent {
  return {
    x: Math.random() * cw,
    y: Math.random() * ch,
    life: 2 + Math.random() * 4,
    hue: 180 + Math.random() * 140,
  };
}
