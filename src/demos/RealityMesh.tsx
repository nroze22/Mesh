import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import type {
  FaceLandmarker,
  FaceLandmarkerResult,
  NormalizedLandmark,
} from "@mediapipe/tasks-vision";
import type { DemoProps } from "./types";
import { useAnimationFrame } from "../core/useAnimationFrame";
import { coverProjector } from "../core/overlay";
import { getVisionFileset, MODELS } from "../core/vision";
import "./demos.css";

type LoadState = "loading" | "ready" | "error";

interface MeshCtx {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.OrthographicCamera;
  lines: THREE.LineSegments;
  points: THREE.Points;
  connections: { start: number; end: number }[];
}

export default function RealityMesh({ video, width, height, mirrored }: DemoProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const landmarkerRef = useRef<FaceLandmarker | null>(null);
  const resultRef = useRef<FaceLandmarkerResult | null>(null);
  const lastVideoTime = useRef(-1);
  const ctxRef = useRef<MeshCtx | null>(null);
  const connectionsRef = useRef<{ start: number; end: number }[]>([]);
  const [state, setState] = useState<LoadState>("loading");
  const [tracked, setTracked] = useState(false);

  // Load the face landmarker + tessellation topology.
  useEffect(() => {
    let cancelled = false;
    let lm: FaceLandmarker | null = null;
    (async () => {
      try {
        const { FaceLandmarker } = await import("@mediapipe/tasks-vision");
        const fileset = await getVisionFileset();
        lm = await FaceLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: MODELS.faceLandmarker, delegate: "GPU" },
          runningMode: "VIDEO",
          numFaces: 1,
          outputFaceBlendshapes: false,
        });
        if (cancelled) {
          lm.close();
          return;
        }
        landmarkerRef.current = lm;
        connectionsRef.current = FaceLandmarker.FACE_LANDMARKS_TESSELATION;
        if (ctxRef.current) ctxRef.current.connections = connectionsRef.current;
        setState("ready");
      } catch (err) {
        console.error("FaceLandmarker failed to load", err);
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

  // Build the Three.js scene.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(0, 1, 0, 1, -1000, 1000);
    camera.position.z = 10;

    // Tessellation lines. The face mesh has up to ~2600 connections; allocate a
    // generous fixed buffer and drive the visible span with setDrawRange.
    const MAX_SEG = 3000;
    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute(
      "position",
      new THREE.BufferAttribute(new Float32Array(MAX_SEG * 2 * 3), 3),
    );
    const lines = new THREE.LineSegments(
      lineGeo,
      new THREE.LineBasicMaterial({
        color: 0x8be8ff,
        transparent: true,
        opacity: 0.45,
        depthTest: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    lines.frustumCulled = false;
    scene.add(lines);

    // Vertex glints.
    const pointGeo = new THREE.BufferGeometry();
    pointGeo.setAttribute(
      "position",
      new THREE.BufferAttribute(new Float32Array(478 * 3), 3),
    );
    const points = new THREE.Points(
      pointGeo,
      new THREE.PointsMaterial({
        color: 0xb86bff,
        size: 2.4,
        sizeAttenuation: false,
        transparent: true,
        opacity: 0.9,
        depthTest: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    points.frustumCulled = false;
    scene.add(points);

    ctxRef.current = {
      renderer,
      scene,
      camera,
      lines,
      points,
      connections: connectionsRef.current,
    };

    return () => {
      renderer.dispose();
      lineGeo.dispose();
      pointGeo.dispose();
      (lines.material as THREE.Material).dispose();
      (points.material as THREE.Material).dispose();
      ctxRef.current = null;
    };
  }, []);

  useAnimationFrame((_dt, t) => {
    const ctx = ctxRef.current;
    const canvas = canvasRef.current;
    const lm = landmarkerRef.current;
    if (!ctx || !canvas || !lm) return;

    if (video.currentTime !== lastVideoTime.current && video.readyState >= 2) {
      lastVideoTime.current = video.currentTime;
      try {
        resultRef.current = lm.detectForVideo(video, performance.now());
        setTracked((resultRef.current.faceLandmarks?.length ?? 0) > 0);
      } catch {
        /* skip transient frame errors */
      }
    }

    renderMesh(ctx, canvas, resultRef.current, width, height, mirrored, t);
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
        {state === "loading" && "Loading face mesh…"}
        {state === "error" && "Face mesh failed to load"}
        {state === "ready" && (tracked ? "Mesh locked · 468 points" : "Look at the camera 🙂")}
      </div>
    </>
  );
}

function renderMesh(
  ctx: MeshCtx,
  canvas: HTMLCanvasElement,
  result: FaceLandmarkerResult | null,
  videoW: number,
  videoH: number,
  mirrored: boolean,
  time: number,
) {
  const { renderer, scene, camera, lines, points } = ctx;

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
  const face: NormalizedLandmark[] | undefined = result?.faceLandmarks?.[0];

  const lineAttr = lines.geometry.getAttribute("position") as THREE.BufferAttribute;
  const pointAttr = points.geometry.getAttribute("position") as THREE.BufferAttribute;
  const conns = ctx.connections;

  if (!face || conns.length === 0) {
    lines.geometry.setDrawRange(0, 0);
    points.geometry.setDrawRange(0, 0);
    renderer.render(scene, camera);
    return;
  }

  const screen = face.map((lm) => project(lm.x, lm.y));

  let v = 0;
  for (const c of conns) {
    const a = screen[c.start];
    const b = screen[c.end];
    if (!a || !b) continue;
    lineAttr.setXYZ(v++, a[0], a[1], 0);
    lineAttr.setXYZ(v++, b[0], b[1], 0);
  }
  for (let i = 0; i < screen.length; i++) {
    pointAttr.setXYZ(i, screen[i][0], screen[i][1], 0);
  }

  lineAttr.needsUpdate = true;
  pointAttr.needsUpdate = true;
  lines.geometry.setDrawRange(0, v);
  points.geometry.setDrawRange(0, screen.length);

  // Shimmer the mesh hue over time.
  const hue = (0.5 + Math.sin(time * 0.0006) * 0.08) % 1;
  (lines.material as THREE.LineBasicMaterial).color.setHSL(hue, 0.9, 0.7);
  (lines.material as THREE.LineBasicMaterial).opacity = 0.4 + Math.sin(time * 0.003) * 0.12;

  renderer.render(scene, camera);
}
