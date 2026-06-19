import { useEffect, useRef, useState } from "react";
import type { HandLandmarker } from "@mediapipe/tasks-vision";
import type { DemoProps } from "./types";
import { useAnimationFrame } from "../core/useAnimationFrame";
import { coverProjector, syncCanvas } from "../core/overlay";
import { getVisionFileset, MODELS } from "../core/vision";
import "./demos.css";

type LoadState = "loading" | "ready" | "error";

// Positions use "height units": y in [0,1] top→bottom, x in [0, aspect].
interface Fruit {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  emoji: string;
  color: string;
}
interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  color: string;
}

const FRUITS = [
  { emoji: "🍉", color: "#ff5a7a" },
  { emoji: "🍊", color: "#ffb35b" },
  { emoji: "🍏", color: "#7CFC9A" },
  { emoji: "🍇", color: "#b86bff" },
  { emoji: "🍋", color: "#ffe14d" },
  { emoji: "🫐", color: "#5b8cff" },
];
const GRAV = 1.5;
const SPAWN_EVERY = 0.85;
const BLADE = 0.03;
const SLICE_SPEED = 0.7;

export default function SaberSlice({ video, width, height, mirrored }: DemoProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const landmarkerRef = useRef<HandLandmarker | null>(null);
  const lastVideoTime = useRef(-1);
  const fruits = useRef<Fruit[]>([]);
  const particles = useRef<Particle[]>([]);
  const trail = useRef<[number, number][]>([]); // recent fingertip px
  const prevTip = useRef<{ x: number; y: number } | null>(null); // height-units
  const spawnT = useRef(0);
  const scoreRef = useRef(0);
  const [state, setState] = useState<LoadState>("loading");
  const [score, setScore] = useState(0);

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
          numHands: 1,
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

  useAnimationFrame((dt) => {
    const canvas = canvasRef.current;
    const lm = landmarkerRef.current;
    if (!canvas || !lm) return;
    const step = Math.min(dt, 0.05); // clamp big frame gaps

    const frame = syncCanvas(canvas);
    if (!frame) return;
    const { ctx, width: cw, height: ch } = frame;
    const aspect = cw / ch;
    const project = coverProjector(cw, ch, width, height, mirrored);

    // Fingertip (index tip = 8) → px → height-units.
    let tip: { x: number; y: number } | null = null;
    let tipPx: [number, number] | null = null;
    if (video.currentTime !== lastVideoTime.current && video.readyState >= 2) {
      lastVideoTime.current = video.currentTime;
      try {
        const res = lm.detectForVideo(video, performance.now());
        const hand = res.landmarks?.[0];
        if (hand) {
          const [px, py] = project(hand[8].x, hand[8].y);
          tipPx = [px, py];
          tip = { x: px / ch, y: py / ch };
        }
      } catch {
        /* skip */
      }
    } else if (prevTip.current) {
      tip = prevTip.current;
      tipPx = [tip.x * ch, tip.y * ch];
    }
    if (tipPx) {
      trail.current.push(tipPx);
      if (trail.current.length > 12) trail.current.shift();
    } else {
      trail.current = [];
    }

    // Spawn fruit.
    spawnT.current += step;
    if (spawnT.current > SPAWN_EVERY) {
      spawnT.current = 0;
      const pick = FRUITS[(Math.random() * FRUITS.length) | 0];
      fruits.current.push({
        x: 0.15 * aspect + Math.random() * 0.7 * aspect,
        y: 1.12,
        vx: (Math.random() - 0.5) * 0.5,
        vy: -(1.05 + Math.random() * 0.35),
        r: 0.05 + Math.random() * 0.015,
        emoji: pick.emoji,
        color: pick.color,
      });
    }

    // Blade speed (height-units/sec).
    let bladeSpeed = 0;
    if (tip && prevTip.current) {
      bladeSpeed = Math.hypot(tip.x - prevTip.current.x, tip.y - prevTip.current.y) / step;
    }

    // Update fruits + slicing.
    const surviving: Fruit[] = [];
    for (const f of fruits.current) {
      f.vy += GRAV * step;
      f.x += f.vx * step;
      f.y += f.vy * step;
      if (f.y > 1.35) continue; // fell off

      let sliced = false;
      if (tip && prevTip.current && bladeSpeed > SLICE_SPEED) {
        const d = segDist(f.x, f.y, prevTip.current.x, prevTip.current.y, tip.x, tip.y);
        if (d < f.r + BLADE) sliced = true;
      }
      if (sliced) {
        scoreRef.current += 1;
        for (let k = 0; k < 12; k++) {
          const ang = (k / 12) * Math.PI * 2;
          particles.current.push({
            x: f.x,
            y: f.y,
            vx: Math.cos(ang) * (0.3 + Math.random() * 0.4),
            vy: Math.sin(ang) * (0.3 + Math.random() * 0.4),
            life: 1,
            color: f.color,
          });
        }
      } else {
        surviving.push(f);
      }
    }
    fruits.current = surviving;
    if (scoreRef.current !== score) setScore(scoreRef.current);

    // Update particles.
    const ps: Particle[] = [];
    for (const p of particles.current) {
      p.vy += GRAV * 0.7 * step;
      p.x += p.vx * step;
      p.y += p.vy * step;
      p.life -= step * 1.6;
      if (p.life > 0) ps.push(p);
    }
    particles.current = ps;
    prevTip.current = tip;

    draw(ctx, ch, fruits.current, particles.current, trail.current, !!tip);
  }, state === "ready");

  return (
    <>
      <canvas ref={canvasRef} className="demo-canvas" />
      <div className="game-score">⚔️ {score}</div>
      <div className="demo-status">
        <span
          className={
            "demo-status__dot" + (state !== "ready" ? " demo-status__dot--warn" : "")
          }
        />
        {state === "loading" && "Loading hand tracker…"}
        {state === "error" && "Hand tracker failed to load"}
        {state === "ready" && "Slice the fruit with your fingertip ⚔️"}
      </div>
    </>
  );
}

function draw(
  ctx: CanvasRenderingContext2D,
  ch: number,
  fruits: Fruit[],
  particles: Particle[],
  trail: [number, number][],
  hasTip: boolean,
) {
  // Particles.
  ctx.globalCompositeOperation = "lighter";
  for (const p of particles) {
    ctx.globalAlpha = Math.max(0, p.life);
    ctx.fillStyle = p.color;
    ctx.shadowColor = p.color;
    ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.arc(p.x * ch, p.y * ch, 4 + (1 - p.life) * 6, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.shadowBlur = 0;
  ctx.globalCompositeOperation = "source-over";

  // Fruit.
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const f of fruits) {
    const size = f.r * 2 * ch;
    ctx.font = `${size}px "Apple Color Emoji", "Segoe UI Emoji", serif`;
    ctx.fillText(f.emoji, f.x * ch, f.y * ch);
  }

  // Saber trail.
  if (trail.length > 1) {
    ctx.globalCompositeOperation = "lighter";
    ctx.lineCap = "round";
    ctx.strokeStyle = "#9fe6ff";
    ctx.shadowColor = "#5b8cff";
    for (let i = 1; i < trail.length; i++) {
      const a = i / trail.length;
      ctx.globalAlpha = a;
      ctx.lineWidth = 2 + a * 12;
      ctx.shadowBlur = 18 * a;
      ctx.beginPath();
      ctx.moveTo(trail[i - 1][0], trail[i - 1][1]);
      ctx.lineTo(trail[i][0], trail[i][1]);
      ctx.stroke();
    }
    if (hasTip) {
      const t = trail[trail.length - 1];
      ctx.globalAlpha = 1;
      ctx.fillStyle = "#fff";
      ctx.shadowBlur = 24;
      ctx.beginPath();
      ctx.arc(t[0], t[1], 7, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
    ctx.globalCompositeOperation = "source-over";
  }
}

function segDist(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}
