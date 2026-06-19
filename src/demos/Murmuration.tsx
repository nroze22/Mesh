import { useEffect, useRef, useState } from "react";
import type { HandLandmarker } from "@mediapipe/tasks-vision";
import type { DemoProps } from "./types";
import { useAnimationFrame } from "../core/useAnimationFrame";
import { coverProjector, syncCanvas } from "../core/overlay";
import { getVisionFileset, MODELS } from "../core/vision";
import "./demos.css";

type LoadState = "loading" | "ready" | "error";

const N = 220;

interface Boid {
  x: number;
  y: number;
  vx: number;
  vy: number;
}
interface Attractor {
  x: number;
  y: number;
  speed: number;
}

/**
 * A living swarm of boids (separation / alignment / cohesion) that is drawn
 * toward your hands and scatters when you move fast — a murmuration you conduct.
 */
export default function Murmuration({ video, width, height, mirrored }: DemoProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const landmarkerRef = useRef<HandLandmarker | null>(null);
  const lastVideoTime = useRef(-1);
  const boids = useRef<Boid[]>([]);
  const attractors = useRef<Attractor[]>([]);
  const prevHands = useRef<[number, number][]>([]);
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

    if (boids.current.length === 0) {
      boids.current = Array.from({ length: N }, () => ({
        x: Math.random() * cw,
        y: Math.random() * ch,
        vx: (Math.random() - 0.5) * 60,
        vy: (Math.random() - 0.5) * 60,
      }));
    }

    // Update attractors from hands.
    if (video.currentTime !== lastVideoTime.current && video.readyState >= 2) {
      lastVideoTime.current = video.currentTime;
      try {
        const res = lm.detectForVideo(video, nowMs);
        const hands = res.landmarks ?? [];
        const next: Attractor[] = [];
        const prev = prevHands.current;
        const cur: [number, number][] = [];
        hands.forEach((hand, i) => {
          const [hx, hy] = project(hand[9].x, hand[9].y);
          cur.push([hx, hy]);
          const p = prev[i];
          const speed = p ? Math.hypot(hx - p[0], hy - p[1]) : 0;
          next.push({ x: hx, y: hy, speed });
        });
        attractors.current = next;
        prevHands.current = cur;
      } catch {
        /* skip */
      }
    }

    // Fade for trails.
    ctx.fillStyle = "rgba(5,6,12,0.22)";
    ctx.fillRect(0, 0, cw, ch);

    const R = 38; // neighbour radius
    const R2 = R * R;
    const arr = boids.current;
    const atts = attractors.current;
    const maxSpeed = 240;

    ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < arr.length; i++) {
      const b = arr[i];
      let sepx = 0, sepy = 0, alx = 0, aly = 0, cohx = 0, cohy = 0, count = 0;
      for (let j = 0; j < arr.length; j++) {
        if (i === j) continue;
        const o = arr[j];
        const dx = b.x - o.x;
        const dy = b.y - o.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < R2 && d2 > 0.0001) {
          count++;
          sepx += dx / d2;
          sepy += dy / d2;
          alx += o.vx;
          aly += o.vy;
          cohx += o.x;
          cohy += o.y;
        }
      }
      if (count > 0) {
        b.vx += sepx * 900 * step;
        b.vy += sepy * 900 * step;
        b.vx += (alx / count - b.vx) * 0.6 * step;
        b.vy += (aly / count - b.vy) * 0.6 * step;
        b.vx += (cohx / count - b.x) * 0.9 * step;
        b.vy += (cohy / count - b.y) * 0.9 * step;
      }

      // Attraction to / repulsion from hands.
      for (const a of atts) {
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const dist = Math.hypot(dx, dy) || 1;
        if (a.speed > 14 && dist < 180) {
          b.vx -= (dx / dist) * 700 * step; // scatter from fast hands
          b.vy -= (dy / dist) * 700 * step;
        } else {
          b.vx += (dx / dist) * 220 * step; // gather to calm hands
          b.vy += (dy / dist) * 220 * step;
        }
      }

      // wander
      b.vx += Math.cos(nowMs * 0.001 + i) * 20 * step;
      b.vy += Math.sin(nowMs * 0.0013 + i) * 20 * step;

      const sp = Math.hypot(b.vx, b.vy);
      if (sp > maxSpeed) {
        b.vx = (b.vx / sp) * maxSpeed;
        b.vy = (b.vy / sp) * maxSpeed;
      }
      b.x += b.vx * step;
      b.y += b.vy * step;
      // wrap
      if (b.x < -10) b.x = cw + 10;
      if (b.x > cw + 10) b.x = -10;
      if (b.y < -10) b.y = ch + 10;
      if (b.y > ch + 10) b.y = -10;

      // draw as an oriented streak
      const hue = (200 + i * 0.6 + nowMs * 0.02) % 360;
      ctx.strokeStyle = `hsl(${hue}, 90%, 65%)`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(b.x, b.y);
      ctx.lineTo(b.x - (b.vx / (sp || 1)) * 7, b.y - (b.vy / (sp || 1)) * 7);
      ctx.stroke();
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
        {state === "ready" && "Raise your hands · move slow to gather, fast to scatter"}
      </div>
    </>
  );
}
