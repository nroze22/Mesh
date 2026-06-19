import * as ort from "onnxruntime-web/webgpu";

// Load the ORT WASM runtime from a CDN matched to the installed version so we
// don't have to bundle/serve the binaries ourselves. WebGPU is tried first
// (fast, iOS 17+/modern browsers), falling back to single-threaded WASM —
// GitHub Pages can't set the COOP/COEP headers multi-threaded WASM needs.
const ORT_VERSION = "1.26.0";
ort.env.wasm.wasmPaths = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/`;
ort.env.wasm.numThreads = 1;
ort.env.logLevel = "error";

const INPUT = 640; // YOLOv8 square input
const CONF_THRESHOLD = 0.3;
const IOU_THRESHOLD = 0.45;

// Reused across inference calls (planar RGB, CHW). detectObjects awaits each
// run fully before the next, so sharing buffers/tensors is safe — and crucial:
// allocating a fresh ~2.8 MB output every run is what crashed the tab.
const inputBuffer = new Float32Array(3 * INPUT * INPUT);
const inputTensor = new ort.Tensor("float32", inputBuffer, [1, 3, INPUT, INPUT]);
// Preallocated output, created after the first run once we know its shape, then
// passed back to session.run as an IO-binding fetch so ORT reuses it.
let outputTensor: ort.Tensor | null = null;

/** COCO-80 class names, in model output order. */
export const COCO_CLASSES = [
  "person", "bicycle", "car", "motorcycle", "airplane", "bus", "train", "truck",
  "boat", "traffic light", "fire hydrant", "stop sign", "parking meter", "bench",
  "bird", "cat", "dog", "horse", "sheep", "cow", "elephant", "bear", "zebra",
  "giraffe", "backpack", "umbrella", "handbag", "tie", "suitcase", "frisbee",
  "skis", "snowboard", "sports ball", "kite", "baseball bat", "baseball glove",
  "skateboard", "surfboard", "tennis racket", "bottle", "wine glass", "cup",
  "fork", "knife", "spoon", "bowl", "banana", "apple", "sandwich", "orange",
  "broccoli", "carrot", "hot dog", "pizza", "donut", "cake", "chair", "couch",
  "potted plant", "bed", "dining table", "toilet", "tv", "laptop", "mouse",
  "remote", "keyboard", "cell phone", "microwave", "oven", "toaster", "sink",
  "refrigerator", "book", "clock", "vase", "scissors", "teddy bear", "hair drier",
  "toothbrush",
] as const;

export interface Detection {
  /** Corner coords normalized (0..1) to the source video frame. */
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  score: number;
  classId: number;
}

let sessionPromise: Promise<ort.InferenceSession> | null = null;

/** Loads (and memoizes) the YOLOv8 ONNX session. */
export function loadYolo(modelUrl: string): Promise<ort.InferenceSession> {
  sessionPromise ??= ort.InferenceSession.create(modelUrl, {
    executionProviders: ["webgpu", "wasm"],
    graphOptimizationLevel: "all",
  });
  return sessionPromise;
}

// Reused offscreen canvas for letterbox pre-processing.
let prep: { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } | null = null;
function prepCanvas() {
  if (!prep) {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = INPUT;
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    prep = { canvas, ctx };
  }
  return prep;
}

/**
 * Runs YOLOv8 on the current video frame and returns detections with
 * normalized coordinates, ready to be cover-projected onto the display.
 */
export async function detectObjects(
  session: ort.InferenceSession,
  video: HTMLVideoElement,
): Promise<Detection[]> {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh) return [];

  // Letterbox into a 640x640 square (preserve aspect, pad with grey).
  const scale = Math.min(INPUT / vw, INPUT / vh);
  const nw = Math.round(vw * scale);
  const nh = Math.round(vh * scale);
  const padX = (INPUT - nw) / 2;
  const padY = (INPUT - nh) / 2;

  const { ctx } = prepCanvas();
  ctx.fillStyle = "rgb(114,114,114)";
  ctx.fillRect(0, 0, INPUT, INPUT);
  ctx.drawImage(video, padX, padY, nw, nh);
  const { data } = ctx.getImageData(0, 0, INPUT, INPUT);

  // RGBA8 -> planar RGB float32 (CHW), normalized 0..1. Reuse one buffer
  // across calls to avoid allocating ~5 MB of garbage every frame.
  const area = INPUT * INPUT;
  const input = inputBuffer;
  for (let i = 0; i < area; i++) {
    input[i] = data[i * 4] / 255;
    input[area + i] = data[i * 4 + 1] / 255;
    input[2 * area + i] = data[i * 4 + 2] / 255;
  }

  const inName = session.inputNames[0];
  const outName = session.outputNames[0];
  const feeds = { [inName]: inputTensor };

  // Reuse one output buffer via IO binding once we know its shape. This keeps
  // memory flat across thousands of runs instead of leaking ~2.8 MB each time.
  const results = outputTensor
    ? await session.run(feeds, { [outName]: outputTensor })
    : await session.run(feeds);
  const output = results[outName];
  if (!outputTensor) {
    outputTensor = new ort.Tensor(
      "float32",
      new Float32Array((output.data as Float32Array).length),
      output.dims as number[],
    );
  }
  const dims = output.dims; // [1, 84, 8400] (channel-major) or [1, 8400, 84]
  const arr = output.data as Float32Array;

  const channelMajor = dims[1] < dims[2];
  const numAnchors = channelMajor ? dims[2] : dims[1];
  const numAttrs = channelMajor ? dims[1] : dims[2];
  const numClasses = numAttrs - 4;
  const at = (attr: number, anchor: number) =>
    channelMajor ? arr[attr * numAnchors + anchor] : arr[anchor * numAttrs + attr];

  const raw: Detection[] = [];
  for (let a = 0; a < numAnchors; a++) {
    let bestClass = 0;
    let bestScore = 0;
    for (let c = 0; c < numClasses; c++) {
      const s = at(4 + c, a);
      if (s > bestScore) {
        bestScore = s;
        bestClass = c;
      }
    }
    if (bestScore < CONF_THRESHOLD) continue;

    const cx = at(0, a);
    const cy = at(1, a);
    const w = at(2, a);
    const h = at(3, a);
    // Undo letterbox back to source-frame pixels, then normalize to 0..1.
    const x1 = (cx - w / 2 - padX) / scale / vw;
    const y1 = (cy - h / 2 - padY) / scale / vh;
    const x2 = (cx + w / 2 - padX) / scale / vw;
    const y2 = (cy + h / 2 - padY) / scale / vh;
    raw.push({ x1, y1, x2, y2, score: bestScore, classId: bestClass });
  }

  return nms(raw, IOU_THRESHOLD);
}

/** Class-aware non-maximum suppression. */
function nms(dets: Detection[], iouThreshold: number): Detection[] {
  dets.sort((a, b) => b.score - a.score);
  const keep: Detection[] = [];
  const removed = new Array<boolean>(dets.length).fill(false);

  for (let i = 0; i < dets.length; i++) {
    if (removed[i]) continue;
    keep.push(dets[i]);
    for (let j = i + 1; j < dets.length; j++) {
      if (removed[j] || dets[j].classId !== dets[i].classId) continue;
      if (iou(dets[i], dets[j]) > iouThreshold) removed[j] = true;
    }
  }
  return keep;
}

function iou(a: Detection, b: Detection): number {
  const ix1 = Math.max(a.x1, b.x1);
  const iy1 = Math.max(a.y1, b.y1);
  const ix2 = Math.min(a.x2, b.x2);
  const iy2 = Math.min(a.y2, b.y2);
  const iw = Math.max(0, ix2 - ix1);
  const ih = Math.max(0, iy2 - iy1);
  const inter = iw * ih;
  const areaA = (a.x2 - a.x1) * (a.y2 - a.y1);
  const areaB = (b.x2 - b.x1) * (b.y2 - b.y1);
  return inter / (areaA + areaB - inter || 1);
}
