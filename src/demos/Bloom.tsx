import { useEffect, useRef, useState } from "react";
import type { HandLandmarker } from "@mediapipe/tasks-vision";
import type { DemoProps } from "./types";
import { useAnimationFrame } from "../core/useAnimationFrame";
import { coverProjector, syncCanvas } from "../core/overlay";
import { getVisionFileset, MODELS } from "../core/vision";
import "./demos.css";

type LoadState = "loading" | "ready" | "error";

interface Flower {
  x: number; // canvas-normalized
  y: number;
  born: number;
  hue: number;
  petals: number;
  rot: number;
  shed: boolean;
}
interface Petal {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  vr: number;
  hue: number;
  life: number;
}

const SPAWN_MS = 130;
const GROW = 0.45;
const LIFE = 2.4;
const MAX_FLOWERS = 44;
const TIPS = [8, 12, 16, 20] as const;

export default function Bloom({ video, width, height, mirrored }: DemoProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const landmarkerRef = useRef<HandLandmarker | null>(null);
  const lastVideoTime = useRef(-1);
  const flowers = useRef<Flower[]>([]);
  const petals = useRef<Petal[]>([]);
  const lastSpawn = useRef(0);
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

    const frame = syncCanvas(canvas);
    if (!frame) return;
    const { ctx, width: cw, height: ch } = frame;
    const project = coverProjector(cw, ch, width, height, mirrored);

    if (video.currentTime !== lastVideoTime.current && video.readyState >= 2) {
      lastVideoTime.current = video.currentTime;
      try {
        const res = lm.detectForVideo(video, nowMs);
        const hands = res.landmarks ?? [];
        if (hands.length && nowMs - lastSpawn.current > SPAWN_MS) {
          lastSpawn.current = nowMs;
          const hand = hands[(Math.random() * hands.length) | 0];
          const tip = hand[TIPS[(Math.random() * TIPS.length) | 0]];
          const [px, py] = project(tip.x, tip.y);
          flowers.current.push({
            x: px / cw,
            y: py / ch,
            born: nowMs,
            hue: (nowMs * 0.08) % 360,
            petals: 5 + ((Math.random() * 3) | 0),
            rot: Math.random() * Math.PI,
            shed: false,
          });
          if (flowers.current.length > MAX_FLOWERS) flowers.current.shift();
        }
      } catch {
        /* skip */
      }
    }

    // Flowers.
    const liveFlowers: Flower[] = [];
    for (const f of flowers.current) {
      const age = (nowMs - f.born) / 1000;
      if (age > LIFE) {
        if (!f.shed) shed(f, petals.current, cw, ch);
        continue;
      }
      liveFlowers.push(f);
      const grow = Math.min(1, age / GROW);
      const fade = age > LIFE - 0.5 ? (LIFE - age) / 0.5 : 1;
      drawFlower(ctx, f, grow, fade, cw, ch, nowMs);
    }
    flowers.current = liveFlowers;

    // Petals.
    const livePetals: Petal[] = [];
    for (const p of petals.current) {
      p.vy += 0.18 * step;
      p.vx += Math.sin(nowMs * 0.002 + p.y * 10) * 0.05 * step;
      p.x += p.vx * step;
      p.y += p.vy * step;
      p.rot += p.vr * step;
      p.life -= step / 3.2;
      if (p.life <= 0 || p.y > 1.2) continue;
      livePetals.push(p);
      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1, p.life));
      ctx.translate(p.x * cw, p.y * ch);
      ctx.rotate(p.rot);
      ctx.fillStyle = `hsl(${p.hue}, 85%, 68%)`;
      petalShape(ctx, 0.03 * ch);
      ctx.restore();
    }
    petals.current = livePetals;
    ctx.globalAlpha = 1;
  }, state === "ready");

  return (
    <>
      <canvas ref={canvasRef} className="demo-canvas" />
      <div className="demo-status">
        <span
          className={
            "demo-status__dot" + (state !== "ready" ? " demo-status__dot--warn" : "")
          }
        />
        {state === "loading" && "Loading hand tracker…"}
        {state === "error" && "Hand tracker failed to load"}
        {state === "ready" && "Move your hands to grow a garden 🌸"}
      </div>
    </>
  );
}

function petalShape(ctx: CanvasRenderingContext2D, r: number) {
  ctx.beginPath();
  ctx.ellipse(r * 0.7, 0, r * 0.7, r * 0.34, 0, 0, Math.PI * 2);
  ctx.fill();
}

function drawFlower(
  ctx: CanvasRenderingContext2D,
  f: Flower,
  grow: number,
  fade: number,
  cw: number,
  ch: number,
  nowMs: number,
) {
  const x = f.x * cw;
  const y = f.y * ch;
  const r = grow * 0.05 * ch;
  ctx.save();
  ctx.globalAlpha = fade;
  ctx.translate(x, y);
  ctx.rotate(f.rot + nowMs * 0.0003);
  for (let i = 0; i < f.petals; i++) {
    ctx.rotate((Math.PI * 2) / f.petals);
    ctx.fillStyle = `hsl(${f.hue}, 85%, 66%)`;
    ctx.shadowColor = `hsl(${f.hue}, 90%, 60%)`;
    ctx.shadowBlur = 10 * grow;
    petalShape(ctx, r);
  }
  ctx.shadowBlur = 0;
  ctx.fillStyle = "#ffe89a";
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.42, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function shed(f: Flower, petals: Petal[], _cw: number, _ch: number) {
  f.shed = true;
  for (let i = 0; i < f.petals; i++) {
    const ang = (i / f.petals) * Math.PI * 2;
    petals.push({
      x: f.x,
      y: f.y,
      vx: Math.cos(ang) * 0.05,
      vy: 0.05 + Math.random() * 0.05,
      rot: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 3,
      hue: f.hue,
      life: 1,
    });
  }
}
