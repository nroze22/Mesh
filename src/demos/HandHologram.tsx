import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import type {
  HandLandmarker,
  HandLandmarkerResult,
  NormalizedLandmark,
} from "@mediapipe/tasks-vision";
import type { DemoProps } from "./types";
import { useAnimationFrame } from "../core/useAnimationFrame";
import { coverProjector } from "../core/overlay";
import { getVisionFileset, MODELS } from "../core/vision";
import "./demos.css";

type LoadState = "loading" | "ready" | "error";

const MAX_HANDS = 2;
const NUM_POINTS = 21;

interface ThreeCtx {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.OrthographicCamera;
  points: THREE.Points;
  lines: THREE.LineSegments;
  cores: THREE.LineSegments[];
  connections: { start: number; end: number }[];
}

// Hue ramp from wrist (cyan) to fingertips (violet) for a holographic look.
function jointColor(i: number): THREE.Color {
  const t = i / (NUM_POINTS - 1);
  return new THREE.Color().setHSL(0.5 - t * 0.25, 1, 0.6);
}

export default function HandHologram({ video, width, height, mirrored }: DemoProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const landmarkerRef = useRef<HandLandmarker | null>(null);
  const resultRef = useRef<HandLandmarkerResult | null>(null);
  const lastVideoTime = useRef(-1);
  const [state, setState] = useState<LoadState>("loading");
  const [hands, setHands] = useState(0);

  // --- Three.js scene (built once) ---
  const gl = useRef<ThreeCtx | null>(null);

  // Load the MediaPipe hand landmarker.
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
          numHands: MAX_HANDS,
        });
        if (cancelled) {
          lm.close();
          return;
        }
        landmarkerRef.current = lm;
        // Stash the connection topology for skeleton lines.
        const conns = (HandLandmarker as unknown as {
          HAND_CONNECTIONS: { start: number; end: number }[];
        }).HAND_CONNECTIONS;
        if (gl.current) gl.current.connections = conns;
        connectionsRef.current = conns;
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

  const connectionsRef = useRef<{ start: number; end: number }[]>([]);

  // Build the Three.js scene once the canvas is mounted.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: true,
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(0, 1, 0, 1, -1000, 1000);
    camera.position.z = 10;

    // Joints — glowing additive sprites.
    const sprite = makeGlowSprite();
    const pointGeo = new THREE.BufferGeometry();
    pointGeo.setAttribute(
      "position",
      new THREE.BufferAttribute(new Float32Array(MAX_HANDS * NUM_POINTS * 3), 3),
    );
    const colors = new Float32Array(MAX_HANDS * NUM_POINTS * 3);
    for (let h = 0; h < MAX_HANDS; h++) {
      for (let i = 0; i < NUM_POINTS; i++) {
        const c = jointColor(i);
        const o = (h * NUM_POINTS + i) * 3;
        colors[o] = c.r;
        colors[o + 1] = c.g;
        colors[o + 2] = c.b;
      }
    }
    pointGeo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    const points = new THREE.Points(
      pointGeo,
      new THREE.PointsMaterial({
        size: 22,
        map: sprite,
        vertexColors: true,
        transparent: true,
        depthTest: false,
        sizeAttenuation: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    points.frustumCulled = false;
    scene.add(points);

    // Bones — additive line segments.
    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute(
      "position",
      new THREE.BufferAttribute(new Float32Array(MAX_HANDS * 21 * 2 * 3), 3),
    );
    const lines = new THREE.LineSegments(
      lineGeo,
      new THREE.LineBasicMaterial({
        color: 0x7fd9ff,
        transparent: true,
        opacity: 0.85,
        depthTest: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    lines.frustumCulled = false;
    scene.add(lines);

    // Floating energy cores (one wireframe icosahedron per hand).
    const cores: THREE.LineSegments[] = [];
    for (let h = 0; h < MAX_HANDS; h++) {
      const core = new THREE.LineSegments(
        new THREE.WireframeGeometry(new THREE.IcosahedronGeometry(1, 1)),
        new THREE.LineBasicMaterial({
          color: 0xb86bff,
          transparent: true,
          opacity: 0.9,
          depthTest: false,
          blending: THREE.AdditiveBlending,
        }),
      );
      core.visible = false;
      core.frustumCulled = false;
      scene.add(core);
      cores.push(core);
    }

    gl.current = {
      renderer,
      scene,
      camera,
      points,
      lines,
      cores,
      connections: connectionsRef.current,
    };

    return () => {
      renderer.dispose();
      pointGeo.dispose();
      lineGeo.dispose();
      sprite.dispose();
      cores.forEach((c) => {
        c.geometry.dispose();
        (c.material as THREE.Material).dispose();
      });
      (points.material as THREE.Material).dispose();
      (lines.material as THREE.Material).dispose();
      gl.current = null;
    };
  }, []);

  useAnimationFrame((_dt, t) => {
    const ctx = gl.current;
    const canvas = canvasRef.current;
    const lm = landmarkerRef.current;
    if (!ctx || !canvas || !lm) return;

    // Detect on fresh frames.
    if (video.currentTime !== lastVideoTime.current && video.readyState >= 2) {
      lastVideoTime.current = video.currentTime;
      try {
        resultRef.current = lm.detectForVideo(video, performance.now());
        setHands(resultRef.current.landmarks.length);
      } catch {
        /* skip transient frame errors */
      }
    }

    renderScene(ctx, canvas, resultRef.current, width, height, mirrored, t);
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
        {state === "ready" &&
          (hands > 0 ? `${hands} hand${hands > 1 ? "s" : ""} locked` : "Show your hand ✋")}
      </div>
    </>
  );
}

function renderScene(
  ctx: ThreeCtx,
  canvas: HTMLCanvasElement,
  result: HandLandmarkerResult | null,
  videoW: number,
  videoH: number,
  mirrored: boolean,
  time: number,
) {
  const { renderer, scene, camera, points, lines, cores } = ctx;

  // Keep the renderer + camera matched to the displayed canvas box.
  const rect = canvas.getBoundingClientRect();
  const w = Math.max(1, Math.round(rect.width));
  const h = Math.max(1, Math.round(rect.height));
  const size = renderer.getSize(new THREE.Vector2());
  if (size.x !== w || size.y !== h) {
    renderer.setSize(w, h, false);
    camera.left = 0;
    camera.right = w;
    camera.top = 0;
    camera.bottom = h;
    camera.updateProjectionMatrix();
  }

  const project = coverProjector(w, h, videoW, videoH, mirrored);
  const hands = result?.landmarks ?? [];

  const posAttr = points.geometry.getAttribute("position") as THREE.BufferAttribute;
  const lineAttr = lines.geometry.getAttribute("position") as THREE.BufferAttribute;
  const conns = ctx.connections;

  let pIdx = 0;
  let lIdx = 0;

  for (let h2 = 0; h2 < cores.length; h2++) cores[h2].visible = false;

  hands.slice(0, MAX_HANDS).forEach((hand: NormalizedLandmark[], handIdx: number) => {
    const screen: [number, number][] = hand.map((lm) => project(lm.x, lm.y));

    // Joints.
    for (let i = 0; i < NUM_POINTS && i < screen.length; i++) {
      posAttr.setXYZ(pIdx++, screen[i][0], screen[i][1], 0);
    }

    // Bones.
    for (const c of conns) {
      const a = screen[c.start];
      const b = screen[c.end];
      if (!a || !b) continue;
      lineAttr.setXYZ(lIdx++, a[0], a[1], 0);
      lineAttr.setXYZ(lIdx++, b[0], b[1], 0);
    }

    // Energy core at the palm, sized by hand span.
    const wrist = screen[0];
    const midMcp = screen[9];
    if (wrist && midMcp) {
      const core = cores[handIdx];
      const span = Math.hypot(midMcp[0] - wrist[0], midMcp[1] - wrist[1]);
      const r = Math.max(14, span * 0.45);
      core.visible = true;
      core.position.set(midMcp[0], midMcp[1], 0);
      core.scale.setScalar(r);
      core.rotation.x = time * 0.0011;
      core.rotation.y = time * 0.0017;
      const pulse = 0.75 + Math.sin(time * 0.004) * 0.2;
      (core.material as THREE.LineBasicMaterial).opacity = pulse;
    }
  });

  posAttr.needsUpdate = true;
  lineAttr.needsUpdate = true;
  points.geometry.setDrawRange(0, pIdx);
  lines.geometry.setDrawRange(0, lIdx);

  renderer.render(scene, camera);
}

/** Generates a soft radial sprite used to make each joint glow. */
function makeGlowSprite(): THREE.CanvasTexture {
  const s = 64;
  const cv = document.createElement("canvas");
  cv.width = cv.height = s;
  const c = cv.getContext("2d")!;
  const g = c.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.3, "rgba(255,255,255,0.85)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  c.fillStyle = g;
  c.fillRect(0, 0, s, s);
  const tex = new THREE.CanvasTexture(cv);
  tex.needsUpdate = true;
  return tex;
}
