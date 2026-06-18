import { useEffect, useRef, useState } from "react";

/**
 * Tracks a smoothed frames-per-second readout while `active`. Samples every
 * animation frame but only re-renders a few times a second to stay cheap.
 */
export function useFps(active = true): number {
  const [fps, setFps] = useState(0);
  const frames = useRef(0);
  const last = useRef(performance.now());

  useEffect(() => {
    if (!active) return;
    let raf = 0;
    const tick = () => {
      frames.current += 1;
      const now = performance.now();
      const elapsed = now - last.current;
      if (elapsed >= 500) {
        setFps(Math.round((frames.current * 1000) / elapsed));
        frames.current = 0;
        last.current = now;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active]);

  return fps;
}
