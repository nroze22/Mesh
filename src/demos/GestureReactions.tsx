import { useEffect, useRef, useState } from "react";
import type { GestureRecognizer } from "@mediapipe/tasks-vision";
import type { DemoProps } from "./types";
import { useAnimationFrame } from "../core/useAnimationFrame";
import { coverProjector, syncCanvas } from "../core/overlay";
import { getVisionFileset, MODELS } from "../core/vision";
import "./demos.css";

type LoadState = "loading" | "ready" | "error";

const GESTURES: Record<string, { emoji: string; label: string; color: string }> = {
  Thumb_Up: { emoji: "👍", label: "Nice!", color: "#38e8c8" },
  Thumb_Down: { emoji: "👎", label: "Nope", color: "#ff6b6b" },
  Victory: { emoji: "✌️", label: "Peace", color: "#5b8cff" },
  Open_Palm: { emoji: "🖐️", label: "Hello", color: "#ffb35b" },
  Closed_Fist: { emoji: "✊", label: "Power", color: "#b86bff" },
  Pointing_Up: { emoji: "☝️", label: "This!", color: "#7CFC9A" },
  ILoveYou: { emoji: "🤟", label: "Love", color: "#ff8fc8" },
};

interface Pop {
  emoji: string;
  label: string;
  color: string;
  x: number;
  y: number;
  born: number;
}

const LIFE = 1.7; // seconds
const COOLDOWN = 650; // ms between spawns of the same gesture

export default function GestureReactions({ video, width, height, mirrored }: DemoProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const recognizerRef = useRef<GestureRecognizer | null>(null);
  const popsRef = useRef<Pop[]>([]);
  const lastVideoTime = useRef(-1);
  const lastSpawn = useRef<{ name: string; t: number }>({ name: "", t: 0 });
  const [state, setState] = useState<LoadState>("loading");
  const [current, setCurrent] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    let rec: GestureRecognizer | null = null;
    (async () => {
      try {
        const { GestureRecognizer } = await import("@mediapipe/tasks-vision");
        const fileset = await getVisionFileset();
        rec = await GestureRecognizer.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: MODELS.gestureRecognizer, delegate: "GPU" },
          runningMode: "VIDEO",
          numHands: 2,
        });
        if (cancelled) return rec.close();
        recognizerRef.current = rec;
        setState("ready");
      } catch (err) {
        console.error("GestureRecognizer failed to load", err);
        if (!cancelled) setState("error");
      }
    })();
    return () => {
      cancelled = true;
      recognizerRef.current?.close();
      recognizerRef.current = null;
      rec?.close();
    };
  }, []);

  useAnimationFrame((_dt, nowMs) => {
    const canvas = canvasRef.current;
    const rec = recognizerRef.current;
    if (!canvas || !rec) return;

    if (video.currentTime !== lastVideoTime.current && video.readyState >= 2) {
      lastVideoTime.current = video.currentTime;
      try {
        const res = rec.recognizeForVideo(video, nowMs);
        const gestures = res.gestures?.[0];
        const name = gestures?.[0]?.categoryName ?? "None";
        const score = gestures?.[0]?.score ?? 0;
        setCurrent(name !== "None" ? name : "");

        if (name !== "None" && score > 0.5 && GESTURES[name]) {
          const fresh = name !== lastSpawn.current.name;
          const cooled = nowMs - lastSpawn.current.t > COOLDOWN;
          if (fresh || cooled) {
            const wrist = res.landmarks?.[0]?.[0];
            const proj = coverProjector(
              canvas.getBoundingClientRect().width,
              canvas.getBoundingClientRect().height,
              width,
              height,
              mirrored,
            );
            const [px, py] = wrist
              ? proj(wrist.x, wrist.y)
              : [canvas.clientWidth / 2, canvas.clientHeight / 2];
            const g = GESTURES[name];
            popsRef.current.push({
              emoji: g.emoji,
              label: g.label,
              color: g.color,
              x: px,
              y: py - 40,
              born: nowMs,
            });
            lastSpawn.current = { name, t: nowMs };
          }
        } else if (name === "None") {
          lastSpawn.current = { name: "", t: lastSpawn.current.t };
        }
      } catch {
        /* skip transient frame errors */
      }
    }

    const frame = syncCanvas(canvas);
    if (!frame) return;
    drawPops(frame.ctx, popsRef, nowMs);
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
        {state === "loading" && "Loading gestures…"}
        {state === "error" && "Recognizer failed to load"}
        {state === "ready" &&
          (current && GESTURES[current]
            ? `${GESTURES[current].emoji} ${GESTURES[current].label}`
            : "Try 👍 ✌️ ✊ 🖐️ ☝️ 🤟")}
      </div>
    </>
  );
}

function drawPops(
  ctx: CanvasRenderingContext2D,
  popsRef: React.MutableRefObject<Pop[]>,
  nowMs: number,
) {
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  const alive: Pop[] = [];
  for (const p of popsRef.current) {
    const age = (nowMs - p.born) / 1000;
    if (age > LIFE) continue;
    alive.push(p);

    const t = age / LIFE;
    // pop-in with slight overshoot, then settle
    const grow = age < 0.28 ? easeOutBack(age / 0.28) : 1;
    const scale = grow;
    const rise = -70 * easeOut(t);
    const alpha = t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3;
    const y = p.y + rise;

    ctx.globalAlpha = Math.max(0, alpha);

    const size = 72 * scale;
    // glow halo
    ctx.shadowColor = p.color;
    ctx.shadowBlur = 24;
    ctx.font = `${size}px "Apple Color Emoji", "Segoe UI Emoji", serif`;
    ctx.fillText(p.emoji, p.x, y);
    ctx.shadowBlur = 0;

    // label chip
    ctx.font = "700 18px system-ui, sans-serif";
    const label = p.label;
    const tw = ctx.measureText(label).width + 22;
    const ly = y + size / 2 + 6;
    ctx.fillStyle = p.color;
    roundRect(ctx, p.x - tw / 2, ly, tw, 28, 14);
    ctx.fill();
    ctx.fillStyle = "#06070d";
    ctx.fillText(label, p.x, ly + 15);
  }
  ctx.globalAlpha = 1;
  popsRef.current = alive;
}

function easeOut(t: number) {
  return 1 - Math.pow(1 - t, 3);
}
function easeOutBack(t: number) {
  const c = 1.70158 + 1;
  return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2);
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
