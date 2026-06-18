import { useCallback, useEffect, useRef, useState } from "react";

export type CameraStatus =
  | "idle"
  | "requesting"
  | "ready"
  | "denied"
  | "unsupported"
  | "error";

export type FacingMode = "environment" | "user";

export interface CameraController {
  /** Attach this to a <video> element. */
  videoRef: React.RefObject<HTMLVideoElement>;
  status: CameraStatus;
  error: string | null;
  facingMode: FacingMode;
  /** Request the camera (must be called from a user gesture on iOS). */
  start: () => Promise<void>;
  stop: () => void;
  /** Flip between the front and rear cameras. */
  flip: () => void;
}

const NICE_ERRORS: Record<string, string> = {
  NotAllowedError:
    "Camera permission was denied. Enable it in your browser settings, then reload.",
  NotFoundError: "No camera was found on this device.",
  NotReadableError:
    "The camera is already in use by another app. Close it and try again.",
  OverconstrainedError: "The requested camera could not be satisfied.",
  SecurityError: "Camera access requires a secure (HTTPS) connection.",
};

/**
 * Manages a getUserMedia camera stream bound to a <video> element.
 *
 * iOS Safari requires the stream to be started from a user gesture and the
 * <video> to be muted + playsInline, both of which the consuming component
 * handles. Cleans the stream up on unmount and on facing-mode changes.
 */
export function useCamera(initialFacing: FacingMode = "environment"): CameraController {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [status, setStatus] = useState<CameraStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [facingMode, setFacingMode] = useState<FacingMode>(initialFacing);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const start = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus("unsupported");
      setError("This browser does not support camera access (getUserMedia).");
      return;
    }

    setStatus("requesting");
    setError(null);
    stop();

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: facingMode },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      });

      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) {
        // Component unmounted mid-request.
        stream.getTracks().forEach((t) => t.stop());
        return;
      }

      video.srcObject = stream;
      video.setAttribute("playsinline", "true");
      video.muted = true;
      await video.play();
      setStatus("ready");
    } catch (err) {
      const name = err instanceof DOMException ? err.name : "error";
      setError(NICE_ERRORS[name] ?? (err instanceof Error ? err.message : "Unknown camera error."));
      setStatus(name === "NotAllowedError" ? "denied" : "error");
    }
  }, [facingMode, stop]);

  const flip = useCallback(() => {
    setFacingMode((m) => (m === "environment" ? "user" : "environment"));
  }, []);

  // Re-acquire the stream when the facing mode changes after the first start.
  useEffect(() => {
    if (status === "ready" || status === "requesting") {
      void start();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [facingMode]);

  // Always release the camera on unmount.
  useEffect(() => stop, [stop]);

  return { videoRef, status, error, facingMode, start, stop, flip };
}
