import { FilesetResolver } from "@mediapipe/tasks-vision";

// Pin the WASM runtime + model CDN to the installed package version so the
// loaded binaries always match the JS API. Bump alongside the dependency.
const TASKS_VISION_VERSION = "0.10.18";

const WASM_CDN = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${TASKS_VISION_VERSION}/wasm`;

/** Hosted `.task` model bundles (Google Cloud Storage). */
export const MODELS = {
  handLandmarker:
    "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
  faceLandmarker:
    "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
} as const;

let filesetPromise: Promise<Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>>> | null =
  null;

/**
 * Resolves (and memoizes) the MediaPipe Tasks-Vision WASM fileset. Shared by
 * every vision demo so the ~3 MB runtime is fetched at most once per session.
 */
export function getVisionFileset() {
  filesetPromise ??= FilesetResolver.forVisionTasks(WASM_CDN);
  return filesetPromise;
}
