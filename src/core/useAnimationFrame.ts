import { useEffect, useRef } from "react";

/**
 * Runs `callback` on every animation frame while `active` is true. The callback
 * receives the delta time (seconds) and absolute timestamp (ms). The latest
 * callback is always used without restarting the loop.
 */
export function useAnimationFrame(
  callback: (deltaSeconds: number, timestampMs: number) => void,
  active = true,
) {
  const cbRef = useRef(callback);
  cbRef.current = callback;

  useEffect(() => {
    if (!active) return;
    let raf = 0;
    let prev = performance.now();

    const loop = (now: number) => {
      const delta = (now - prev) / 1000;
      prev = now;
      cbRef.current(delta, now);
      raf = requestAnimationFrame(loop);
    };

    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [active]);
}
