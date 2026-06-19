/**
 * Helpers for drawing overlays on top of a camera <video> that is displayed
 * with `object-fit: cover`. The video is letter-/pillar-cropped to fill the
 * screen, so normalized model coordinates (0..1 over the source frame) must be
 * mapped through the same cover transform to line up on screen.
 */

export interface CanvasFrame {
  ctx: CanvasRenderingContext2D;
  /** Logical (CSS pixel) dimensions to draw in. */
  width: number;
  height: number;
  dpr: number;
}

/**
 * Resizes a canvas's backing store to match its CSS box at the current device
 * pixel ratio and returns a 2D context pre-scaled so you can draw in CSS px.
 * Returns null if the canvas has no layout box yet or lacks a 2D context.
 */
export function syncCanvas(canvas: HTMLCanvasElement): CanvasFrame | null {
  const rect = canvas.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return null;

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const bw = Math.round(rect.width * dpr);
  const bh = Math.round(rect.height * dpr);
  if (canvas.width !== bw || canvas.height !== bh) {
    canvas.width = bw;
    canvas.height = bh;
  }

  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, rect.width, rect.height);
  return { ctx, width: rect.width, height: rect.height, dpr };
}

export type Projector = (nx: number, ny: number) => [number, number];

/**
 * Builds a projector mapping normalized source-frame coordinates to CSS pixels
 * within a cover-fitted display box. Mirrors horizontally when `mirrored` is
 * set (matching a CSS `scaleX(-1)` selfie view).
 */
export function coverProjector(
  displayW: number,
  displayH: number,
  videoW: number,
  videoH: number,
  mirrored: boolean,
): Projector {
  const scale = Math.max(displayW / videoW, displayH / videoH);
  const drawW = videoW * scale;
  const drawH = videoH * scale;
  const offsetX = (displayW - drawW) / 2;
  const offsetY = (displayH - drawH) / 2;

  return (nx, ny) => {
    const x = offsetX + nx * drawW;
    const y = offsetY + ny * drawH;
    return [mirrored ? displayW - x : x, y];
  };
}

export interface CoverRect {
  dx: number;
  dy: number;
  dw: number;
  dh: number;
}

/**
 * Computes the destination rect for drawing a source-frame image (e.g. a
 * segmentation mask) onto a cover-fitted display box. For mirrored feeds, flip
 * the context horizontally (translate(displayW,0); scale(-1,1)) before drawing.
 */
export function coverRect(
  displayW: number,
  displayH: number,
  videoW: number,
  videoH: number,
): CoverRect {
  const scale = Math.max(displayW / videoW, displayH / videoH);
  const dw = videoW * scale;
  const dh = videoH * scale;
  return { dx: (displayW - dw) / 2, dy: (displayH - dh) / 2, dw, dh };
}
