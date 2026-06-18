/**
 * Composites the live camera frame and every overlay <canvas> inside `stage`
 * into a single PNG, matching exactly what's on screen (cover crop + mirror).
 * Returns the resulting Blob, or null if there's nothing to capture.
 */
export async function captureStage(
  stage: HTMLElement,
  video: HTMLVideoElement,
  mirrored: boolean,
): Promise<Blob | null> {
  const rect = stage.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.round(rect.width);
  const h = Math.round(rect.height);
  if (w === 0 || h === 0) return null;

  const out = document.createElement("canvas");
  out.width = w * dpr;
  out.height = h * dpr;
  const ctx = out.getContext("2d");
  if (!ctx) return null;
  ctx.scale(dpr, dpr);

  // Camera frame, cover-fitted (and mirrored for the selfie view).
  const vw = video.videoWidth || w;
  const vh = video.videoHeight || h;
  const scale = Math.max(w / vw, h / vh);
  const dw = vw * scale;
  const dh = vh * scale;
  const ox = (w - dw) / 2;
  const oy = (h - dh) / 2;

  ctx.save();
  if (mirrored) {
    ctx.translate(w, 0);
    ctx.scale(-1, 1);
  }
  try {
    ctx.drawImage(video, ox, oy, dw, dh);
  } catch {
    /* video may not be ready to paint; carry on with overlays */
  }
  ctx.restore();

  // Overlay canvases already live in display-pixel space — paint them on top.
  stage.querySelectorAll("canvas").forEach((c) => {
    if (c.width === 0 || c.height === 0) return;
    ctx.drawImage(c, 0, 0, w, h);
  });

  // Subtle watermark.
  ctx.font = "600 13px system-ui, sans-serif";
  ctx.fillStyle = "rgba(255,255,255,0.75)";
  ctx.textAlign = "right";
  ctx.textBaseline = "bottom";
  ctx.fillText("reality sandbox", w - 14, h - 12);

  return new Promise((resolve) => out.toBlob((b) => resolve(b), "image/png"));
}

/**
 * Shares an image via the Web Share API when available (with a file), otherwise
 * falls back to a download. Returns how the image was delivered.
 */
export async function shareOrDownload(
  blob: Blob,
  filename: string,
): Promise<"shared" | "downloaded"> {
  const file = new File([blob], filename, { type: blob.type });

  const nav = navigator as Navigator & {
    canShare?: (data: { files: File[] }) => boolean;
  };
  if (nav.canShare?.({ files: [file] }) && navigator.share) {
    try {
      await navigator.share({ files: [file], title: "Reality Sandbox" });
      return "shared";
    } catch {
      /* user cancelled or share failed — fall through to download */
    }
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
  return "downloaded";
}
