# Reality Sandbox

A browser-native **augmented-reality / computer-vision playground**. Point your
phone's camera at the world and watch on-device ML models, motion sensors and
3D graphics fuse into live AR — **no app, no backend, nothing uploaded**. Every
frame is processed locally in the browser.

> Built as a static **Vite + React + TypeScript** app and deployed to GitHub
> Pages. Heavy CV/ML libraries are lazy-loaded per demo so the hub stays light.

## Demos

| Demo | What it does | Tech |
| --- | --- | --- |
| **Hand Hologram** | 21-point hand tracking with a glowing skeletal rig + energy core | MediaPipe · Three.js |
| **Sensor HUD** | Flight-instrument heads-up display driven by gyro/accelerometer/compass | DeviceMotion · Canvas |
| **Object Overlay** | Real-time object detection with labelled bounding boxes | MediaPipe (EfficientDet) |
| **Reality Mesh** | A live 468-point wireframe mesh wrapped onto your face | MediaPipe · Three.js |

## Run locally

```bash
npm install
npm run dev      # http://localhost:5173
```

> 📷 **Camera + motion sensors require a secure context (HTTPS).** `localhost`
> counts as secure, so `npm run dev` works on your machine. To test on a phone
> over your LAN you'll need HTTPS (e.g. a tunnel, or the deployed Pages URL).

### Build & preview

```bash
npm run build    # type-checks then emits ./dist
npm run preview
```

## Deployment (GitHub Pages)

Pushing to `main` triggers `.github/workflows/deploy.yml`, which builds the app
and publishes `./dist` via GitHub Pages.

One-time repo setup: **Settings → Pages → Build and deployment → Source =
GitHub Actions**.

The published URL is:

```
https://nroze22.github.io/Mesh/
```

The Vite `base` is set to `/Mesh/` to match the project-pages path. For a custom
domain (served from the root), build with `VITE_BASE=/`:

```bash
VITE_BASE=/ npm run build
```

## How it works

```
iPhone Safari
  → getUserMedia camera stream
  → MediaPipe Tasks-Vision (WASM/WebGL inference, lazy-loaded from CDN)
  → Three.js / Canvas overlay
  → no server, nothing leaves the device
```

- **Routing** uses `HashRouter`, so deep links work on GitHub Pages without a
  server-side rewrite.
- **Overlays** map the models' normalized coordinates through the same
  `object-fit: cover` transform as the video (`src/core/overlay.ts`) so they
  line up regardless of screen aspect ratio, including the mirrored selfie view.
- **MediaPipe WASM + `.task` weights** are fetched from public CDNs on first use
  and cached, keeping the deployed bundle small. Drop self-hosted weights in
  `public/models/` if you'd rather avoid third-party requests.

## Project layout

```
public/            static assets + (optional) self-hosted models
src/
  core/            camera, sensors, animation loop, overlay projection helpers
  components/      hub, demo shell + camera-permission flow, 404
  demos/           one lazy-loaded module per demo (+ shared registry)
.github/workflows/ GitHub Pages deploy
```

## License

MIT
