import { useCallback, useEffect, useRef, useState } from "react";

export interface OrientationState {
  alpha: number | null; // compass heading (0-360)
  beta: number | null; // front-to-back tilt (-180..180)
  gamma: number | null; // left-to-right tilt (-90..90)
}

export interface MotionState {
  accel: { x: number; y: number; z: number };
  rotationRate: { alpha: number; beta: number; gamma: number };
}

export type SensorPermission = "unknown" | "granted" | "denied" | "unsupported";

interface DeviceOrientationEventStatic {
  requestPermission?: () => Promise<PermissionState>;
}

/**
 * Reads DeviceOrientation + DeviceMotion sensors. On iOS 13+ these require an
 * explicit permission prompt triggered from a user gesture, exposed here as
 * `requestPermission`.
 */
export function useDeviceSensors() {
  const [permission, setPermission] = useState<SensorPermission>("unknown");
  const [orientation, setOrientation] = useState<OrientationState>({
    alpha: null,
    beta: null,
    gamma: null,
  });
  const motionRef = useRef<MotionState>({
    accel: { x: 0, y: 0, z: 0 },
    rotationRate: { alpha: 0, beta: 0, gamma: 0 },
  });
  const [motion, setMotion] = useState<MotionState>(motionRef.current);

  const attach = useCallback(() => {
    const onOrient = (e: DeviceOrientationEvent) => {
      setOrientation({ alpha: e.alpha, beta: e.beta, gamma: e.gamma });
    };
    const onMotion = (e: DeviceMotionEvent) => {
      const next: MotionState = {
        accel: {
          x: e.accelerationIncludingGravity?.x ?? 0,
          y: e.accelerationIncludingGravity?.y ?? 0,
          z: e.accelerationIncludingGravity?.z ?? 0,
        },
        rotationRate: {
          alpha: e.rotationRate?.alpha ?? 0,
          beta: e.rotationRate?.beta ?? 0,
          gamma: e.rotationRate?.gamma ?? 0,
        },
      };
      motionRef.current = next;
      setMotion(next);
    };
    window.addEventListener("deviceorientation", onOrient);
    window.addEventListener("devicemotion", onMotion);
    return () => {
      window.removeEventListener("deviceorientation", onOrient);
      window.removeEventListener("devicemotion", onMotion);
    };
  }, []);

  const requestPermission = useCallback(async () => {
    const DOE = window.DeviceOrientationEvent as unknown as
      | DeviceOrientationEventStatic
      | undefined;

    if (typeof window.DeviceOrientationEvent === "undefined") {
      setPermission("unsupported");
      return;
    }

    // iOS gated sensors.
    if (typeof DOE?.requestPermission === "function") {
      try {
        const result = await DOE.requestPermission();
        setPermission(result === "granted" ? "granted" : "denied");
      } catch {
        setPermission("denied");
      }
      return;
    }

    // Other browsers expose the events without an explicit prompt.
    setPermission("granted");
  }, []);

  useEffect(() => {
    if (permission !== "granted") return;
    return attach();
  }, [permission, attach]);

  return { permission, orientation, motion, requestPermission };
}
