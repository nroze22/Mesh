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
    id: "pose-skeleton",
    title: "Body Pose Skeleton",
    tagline: "Full-body 33-point tracking with a glowing skeletal rig",
    description:
      "MediaPipe's pose landmarker tracks 33 points across your whole body while a luminous neon skeleton and joint orbs mirror every move in real time.",
    glyph: "🕺",
    maturity: "stable",
    uses: ["MediaPipe Pose", "Canvas"],
    facing: "environment",
    accent: ["#38e8c8", "#5b8cff"],
    component: lazy(() => import("./PoseSkeleton")),
  },
  {
    id: "gesture-reactions",
    title: "Gesture Reactions",
    tagline: "Flash a hand sign, get an emoji burst",
    description:
      "A MediaPipe gesture recognizer reads thumbs-up, peace, fist, open palm, point and more — popping animated emoji and labels that float off your hand.",
    glyph: "👍",
    maturity: "stable",
    uses: ["MediaPipe Gestures", "Canvas"],
    facing: "user",
    accent: ["#ffb35b", "#ff8fc8"],
    component: lazy(() => import("./GestureReactions")),
  },
  {
    id: "air-canvas",
    title: "Air Canvas",
    tagline: "Pinch your fingers and paint glowing trails in the air",
    description:
      "Hand tracking turns a pinch into a paintbrush — draw luminous strokes in mid-air that cycle through color, and wave an open palm to wipe the canvas clean.",
    glyph: "🎨",
    maturity: "stable",
    uses: ["MediaPipe Hands", "Canvas"],
    facing: "user",
    accent: ["#b86bff", "#5b8cff"],
    component: lazy(() => import("./AirCanvas")),
  },
  {
    id: "background-fx",
    title: "Background FX",
    tagline: "Selfie segmentation that spotlights you and restyles the world",
    description:
      "Real-time person segmentation dims and tints everything behind you and wraps your silhouette in a neon glow. Tap to switch between spotlight, neon and matrix vibes.",
    glyph: "🟢",
    maturity: "experimental",
    uses: ["MediaPipe Segmenter", "Canvas"],
    facing: "user",
    accent: ["#46ff96", "#38e8c8"],
    component: lazy(() => import("./BackgroundFx")),
  },
  {
    id: "fx-cam",
    title: "FX Cam",
    tagline: "Retro image-processing filters — thermal, edges, ASCII, pixel",
    description:
      "No neural network here — just classic computer-vision pixel math. Run the live feed through a thermal palette, Sobel edge detection, live ASCII art or chunky pixelation. Tap to cycle.",
    glyph: "🎞️",
    maturity: "stable",
    uses: ["Canvas", "Image processing"],
    facing: "environment",
    accent: ["#ff6b6b", "#ffb35b"],
    component: lazy(() => import("./FxCam")),
  },
  {
    id: "face-filters",
    title: "Face Filters",
    tagline: "AR accessories that stick to your face",
    description:
      "Face landmark tracking pins sunglasses, crowns, disguises and puppy ears to your face — scaling and rotating with your head in real time. Tap to switch your look.",
    glyph: "🎭",
    maturity: "stable",
    uses: ["MediaPipe Face", "Canvas"],
    facing: "user",
    accent: ["#5b8cff", "#ff8fc8"],
    component: lazy(() => import("./FaceFilters")),
  },
  {
    id: "neon-trails",
    title: "Neon Trails",
    tagline: "Paint the air with light as you move",
    description:
      "Full-body pose tracking leaves glowing motion trails streaming off your hands, feet and head — a real-time light-painting performance. Wave your arms and dance.",
    glyph: "✨",
    maturity: "stable",
    uses: ["MediaPipe Pose", "Canvas"],
    facing: "environment",
    accent: ["#38e8c8", "#b86bff"],
    component: lazy(() => import("./NeonTrails")),
  },
  {
    id: "saber-slice",
    title: "Saber Slice",
    tagline: "Fruit-Ninja with your fingertip",
    description:
      "Hand tracking turns your index finger into a glowing blade. Fruit arcs across the screen — swipe fast to slice it into a shower of juice and rack up combos.",
    glyph: "⚔️",
    maturity: "stable",
    uses: ["MediaPipe Hands", "Game"],
    facing: "user",
    accent: ["#5b8cff", "#9fe6ff"],
    component: lazy(() => import("./SaberSlice")),
  },
  {
    id: "hand-theremin",
    title: "Hand Theremin",
    tagline: "Conduct music in the air with your hands",
    description:
      "Wave your hands to play a synth: one hand picks the note up a pentatonic ladder and bends the timbre, the other rides the volume. Pure Web Audio, no notes leave the browser.",
    glyph: "🎚️",
    maturity: "stable",
    uses: ["MediaPipe Hands", "Web Audio"],
    facing: "user",
    accent: ["#5b8cff", "#38e8c8"],
    component: lazy(() => import("./HandTheremin")),
  },
  {
    id: "invisibility-cloak",
    title: "Invisibility Cloak",
    tagline: "Capture the empty scene, then disappear",
    description:
      "Step out and snapshot the background, then step back in — selfie segmentation paints the stored backdrop over your silhouette so you vanish like a magic cloak.",
    glyph: "🫥",
    maturity: "experimental",
    uses: ["MediaPipe Segmenter", "Canvas"],
    facing: "environment",
    accent: ["#38e8c8", "#5b8cff"],
    component: lazy(() => import("./InvisibilityCloak")),
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
