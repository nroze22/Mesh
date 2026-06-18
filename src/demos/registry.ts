import { lazy } from "react";
import type { DemoMeta } from "./types";

// Each demo dynamic-imports only the libraries (Three.js, MediaPipe, …) it
// needs, so the hub page never downloads the heavy CV/ML bundles up front.
export const DEMOS: DemoMeta[] = [
  {
    id: "hand-hologram",
    title: "Hand Hologram",
    tagline: "21-point hand tracking with a floating wireframe rig",
    description:
      "MediaPipe locates the joints of your hand in real time while Three.js renders a glowing skeletal rig and energy core that follows every finger.",
    glyph: "✋",
    maturity: "stable",
    uses: ["MediaPipe", "Three.js", "WebGL"],
    facing: "environment",
    accent: ["#5b8cff", "#b86bff"],
    component: lazy(() => import("./HandHologram")),
  },
  {
    id: "sensor-hud",
    title: "Sensor HUD",
    tagline: "A heads-up display driven by your device's motion sensors",
    description:
      "Reads the gyroscope, accelerometer and compass to paint an artificial horizon, heading tape and live telemetry over the camera feed.",
    glyph: "🧭",
    maturity: "stable",
    uses: ["DeviceMotion", "Canvas"],
    facing: "environment",
    accent: ["#38e8c8", "#5b8cff"],
    component: lazy(() => import("./SensorHud")),
  },
  {
    id: "object-overlay",
    title: "Object Overlay",
    tagline: "Real-time YOLOv8 detection across 80 object classes",
    description:
      "A YOLOv8 neural network runs locally via ONNX Runtime Web (WebGPU-accelerated) to spot everyday objects — people, phones, cups, chairs and dozens more — and overlays animated, labelled boxes with live confidence readouts.",
    glyph: "🎯",
    maturity: "stable",
    uses: ["YOLOv8", "ONNX Runtime", "WebGPU"],
    facing: "environment",
    accent: ["#ffb35b", "#ff6b6b"],
    component: lazy(() => import("./ObjectOverlay")),
  },
  {
    id: "reality-mesh",
    title: "Reality Mesh",
    tagline: "A live 468-point mesh wrapped onto your face",
    description:
      "MediaPipe's face landmarker reconstructs a dense triangulated mesh and projects a shimmering wireframe that deforms with every expression.",
    glyph: "🕸️",
    maturity: "experimental",
    uses: ["MediaPipe", "Three.js", "WebGL"],
    facing: "user",
    accent: ["#b86bff", "#38e8c8"],
    component: lazy(() => import("./RealityMesh")),
  },
];

export function getDemo(id: string | undefined): DemoMeta | undefined {
  return DEMOS.find((d) => d.id === id);
}
