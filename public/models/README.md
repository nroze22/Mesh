# Static model files

Drop self-hosted model weights here (e.g. `*.task`, `*.onnx`, `*.tflite`) when
you want them served from the same origin instead of a CDN.

By default the demos lazy-load their MediaPipe `.task` models and WASM runtime
from the public Google Cloud Storage / jsDelivr CDNs, so this folder can stay
empty. Self-host only if you need offline support or want to avoid third-party
requests — keep weights compressed and remember GitHub Pages caps published
sites at 1 GB.
