import { useEffect, useRef, useState } from "react";
import type { HandLandmarker, NormalizedLandmark } from "@mediapipe/tasks-vision";
import type { DemoProps } from "./types";
import { useAnimationFrame } from "../core/useAnimationFrame";
import { coverProjector, syncCanvas } from "../core/overlay";
import { getVisionFileset, MODELS } from "../core/vision";
import "./demos.css";

type LoadState = "loading" | "ready" | "error";

// C major pentatonic across two octaves (low → high).
const SCALE = (() => {
  const names = ["C", "D", "E", "G", "A"];
  const semis = [0, 2, 4, 7, 9];
  const base = 261.63; // C4
  const notes: { freq: number; name: string }[] = [];
  for (let oct = 0; oct < 2; oct++) {
    for (let i = 0; i < semis.length; i++) {
      const s = oct * 12 + semis[i];
      notes.push({ freq: base * Math.pow(2, s / 12), name: names[i] + (4 + oct) });
    }
  }
  return notes;
})();

interface Audio {
  ctx: AudioContext;
  osc: OscillatorNode;
  gain: GainNode;
  filter: BiquadFilterNode;
}

export default function HandTheremin({ video, width, height, mirrored }: DemoProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const landmarkerRef = useRef<HandLandmarker | null>(null);
  const handsRef = useRef<NormalizedLandmark[][]>([]);
  const lastVideoTime = useRef(-1);
  const audio = useRef<Audio | null>(null);
  const noteRef = useRef<string>("");
  const [state, setState] = useState<LoadState>("loading");
  const [soundOn, setSoundOn] = useState(false);

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

  // Tear down audio on unmount.
  useEffect(() => {
    return () => {
      const a = audio.current;
      if (a) {
        try {
          a.osc.stop();
          void a.ctx.close();
        } catch {
          /* already closed */
        }
        audio.current = null;
      }
    };
  }, []);

  const enableSound = () => {
    if (audio.current) return;
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctor();
    const osc = ctx.createOscillator();
    osc.type = "triangle";
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 1200;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    osc.connect(filter).connect(gain).connect(ctx.destination);
    osc.start();
    void ctx.resume();
    audio.current = { ctx, osc, gain, filter };
    setSoundOn(true);
  };

  useAnimationFrame(() => {
    const canvas = canvasRef.current;
    const lm = landmarkerRef.current;
    if (!canvas || !lm) return;

    if (video.currentTime !== lastVideoTime.current && video.readyState >= 2) {
      lastVideoTime.current = video.currentTime;
      try {
        const res = lm.detectForVideo(video, performance.now());
        handsRef.current = res.landmarks ?? [];
      } catch {
        /* skip transient frame errors */
      }
    }

    const hands = handsRef.current;
    const a = audio.current;
    if (a) {
      const now = a.ctx.currentTime;
      if (hands.length > 0) {
        const pitchHand = hands[0][9]; // palm
        const idx = Math.max(0, Math.min(SCALE.length - 1, Math.floor((1 - pitchHand.y) * SCALE.length)));
        const note = SCALE[idx];
        noteRef.current = note.name;
        a.osc.frequency.setTargetAtTime(note.freq, now, 0.04);
        a.filter.frequency.setTargetAtTime(600 + pitchHand.x * 4200, now, 0.05);
        const vol = hands[1] ? 0.0001 + (1 - hands[1][9].y) * 0.32 : 0.18;
        a.gain.gain.setTargetAtTime(vol, now, 0.05);
      } else {
        noteRef.current = "";
        a.gain.gain.setTargetAtTime(0, now, 0.08);
      }
    }

    const frame = syncCanvas(canvas);
    if (!frame) return;
    const project = coverProjector(frame.width, frame.height, width, height, mirrored);
    drawTheremin(frame.ctx, frame.width, frame.height, hands, soundOn, noteRef.current, project);
  }, state === "ready");

  return (
    <>
      <canvas ref={canvasRef} className="demo-canvas" />
      {!soundOn && (
        <button className="demo-fab" style={{ pointerEvents: "auto" }} onClick={enableSound}>
          🔊 Enable sound
        </button>
      )}
      <div className="demo-status">
        <span
          className={
            "demo-status__dot" + (state !== "ready" ? " demo-status__dot--warn" : "")
          }
        />
        {state === "loading" && "Loading hand tracker…"}
        {state === "error" && "Hand tracker failed to load"}
        {state === "ready" &&
          (soundOn
            ? noteRef.current
              ? `♪ ${noteRef.current} · 2nd hand = volume`
              : "Raise a hand to play"
            : "Tap 🔊 then move your hands")}
      </div>
    </>
  );
}

function drawTheremin(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  hands: NormalizedLandmark[][],
  soundOn: boolean,
  note: string,
  project: (nx: number, ny: number) => [number, number],
) {
  // Scale bands.
  ctx.textAlign = "left";
  ctx.font = "600 11px ui-monospace, monospace";
  for (let i = 0; i < SCALE.length; i++) {
    const y = (1 - (i + 0.5) / SCALE.length) * h;
    ctx.strokeStyle = "rgba(91,140,255,0.18)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
    ctx.fillStyle = "rgba(255,255,255,0.35)";
    ctx.fillText(SCALE[i].name, 8, y - 3);
  }

  if (!soundOn) return;

  hands.forEach((hand, i) => {
    const palm = hand[9];
    const [x, y] = project(palm.x, palm.y);
    const color = i === 0 ? "#5b8cff" : "#38e8c8";
    ctx.fillStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 24;
    ctx.beginPath();
    ctx.arc(x, y, i === 0 ? 18 : 13, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = "#06070d";
    ctx.font = "700 11px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(i === 0 ? "PITCH" : "VOL", x, y + 4);
  });

  if (note) {
    ctx.fillStyle = "#fff";
    ctx.font = "800 40px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.shadowColor = "#5b8cff";
    ctx.shadowBlur = 20;
    ctx.fillText(note, w / 2, 70);
    ctx.shadowBlur = 0;
  }
}
