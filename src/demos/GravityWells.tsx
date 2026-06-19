import { useEffect, useRef, useState } from "react";
import type { HandLandmarker } from "@mediapipe/tasks-vision";
import type { DemoProps } from "./types";
import { useAnimationFrame } from "../core/useAnimationFrame";
import { coverProjector, syncCanvas } from "../core/overlay";
import { getVisionFileset, MODELS } from "../core/vision";
import "./demos.css";

type LoadState = "loading" | "ready" | "error";

const N = 1300;

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

/**
 * Your hands are gravity wells. A field of particles is pulled into orbit,
 * swirling and slingshotting around them like a galaxy you sculpt by hand.
 */
export default function GravityWells({ video, width, height, mirrored }: DemoProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const landmarkerRef = useRef<HandLandmarker | null>(null);
  const lastVideoTime = useRef(-1);
  const parts = useRef<Particle[]>([]);
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
    const step = Math.min(dt, 0.045);

    const frame = syncCanvas(canvas, false);
    if (!frame) return;
    const { ctx, width: cw, height: ch } = frame;
    const project = coverProjector(cw, ch, width, height, mirrored);

    if (parts.current.length === 0) {
      parts.current = Array.from({ length: N }, () => ({
        x: Math.random() * cw,
        y: Math.random() * ch,
        vx: (Math.random() - 0.5) * 40,
        vy: (Math.random() - 0.5) * 40,
      }));
    }

    if (video.currentTime !== lastVideoTime.current && video.readyState >= 2) {
      lastVideoTime.current = video.currentTime;
      try {
        const res = lm.detectForVideo(video, nowMs);
        wells.current = (res.landmarks ?? []).map((h) => project(h[9].x, h[9].y));
      } catch {
        /* skip */
      }
    }

    ctx.fillStyle = "rgba(4,5,11,0.20)";
    ctx.fillRect(0, 0, cw, ch);

    const ws = wells.current;
    const G = 26000;
    ctx.globalCompositeOperation = "lighter";
    for (const p of parts.current) {
      if (ws.length) {
        for (const w of ws) {
          const dx = w[0] - p.x;
          const dy = w[1] - p.y;
          const d2 = dx * dx + dy * dy + 600;
          const f = (G / d2) * step;
          p.vx += dx * f;
          p.vy += dy * f;
        }
      } else {
        // gentle pull to centre when no hands
        p.vx += (cw / 2 - p.x) * 0.4 * step;
        p.vy += (ch / 2 - p.y) * 0.4 * step;
      }
      p.vx *= 0.992;
      p.vy *= 0.992;
      p.x += p.vx * step;
      p.y += p.vy * step;
      if (p.x < -20) p.x = cw + 20;
      else if (p.x > cw + 20) p.x = -20;
      if (p.y < -20) p.y = ch + 20;
      else if (p.y > ch + 20) p.y = -20;

      const sp = Math.hypot(p.vx, p.vy);
      const hue = 210 + Math.min(140, sp * 0.6);
      ctx.fillStyle = `hsla(${hue}, 95%, ${55 + Math.min(35, sp * 0.1)}%, 0.9)`;
      ctx.fillRect(p.x, p.y, 1.7, 1.7);
    }

    // Glow at each well.
    for (const w of ws) {
      const g = ctx.createRadialGradient(w[0], w[1], 0, w[0], w[1], 46);
      g.addColorStop(0, "rgba(180,210,255,0.7)");
      g.addColorStop(1, "rgba(180,210,255,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(w[0], w[1], 46, 0, Math.PI * 2);
      ctx.fill();
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
        {state === "ready" && "Raise your hands and bend the orbits 🪐"}
      </div>
    </>
  );
}
