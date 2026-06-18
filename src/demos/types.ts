import type { ComponentType, LazyExoticComponent } from "react";
import type { FacingMode } from "../core/useCamera";

/** Props every demo receives once the camera feed is live. */
export interface DemoProps {
  /** The live, playing camera <video> element. */
  video: HTMLVideoElement;
  /** Intrinsic resolution of the video stream. */
  width: number;
  height: number;
  /** Whether the feed is mirrored (true for the front/selfie camera). */
  mirrored: boolean;
}

export interface DemoMeta {
  id: string;
  title: string;
  tagline: string;
  description: string;
  /** Short emoji/symbol used on the hub card. */
  glyph: string;
  /** "stable" demos are reliable; "experimental" ones are heavier/flakier. */
  maturity: "stable" | "experimental";
  /** Capabilities the demo leans on, surfaced on the hub card. */
  uses: string[];
  /** Preferred camera for this demo. */
  facing: FacingMode;
  /** Accent gradient stops for the card art. */
  accent: [string, string];
  /** Lazily-loaded demo implementation. */
  component: LazyExoticComponent<ComponentType<DemoProps>>;
}
