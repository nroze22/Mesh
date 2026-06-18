import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { getDemo } from "../demos/registry";
import { useCamera } from "../core/useCamera";
import { useFps } from "../core/useFps";
import { captureStage, shareOrDownload } from "../core/capture";
import NotFound from "./NotFound";
import "./DemoPage.css";

export default function DemoPage() {
  const { id } = useParams();
  const demo = getDemo(id);
  const navigate = useNavigate();
  const camera = useCamera(demo?.facing ?? "environment");
  const { videoRef, status, error, start, stop, flip, facingMode } = camera;

  const stageRef = useRef<HTMLDivElement>(null);
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  const [flash, setFlash] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const fps = useFps(status === "ready");

  // Release the camera whenever we leave this demo.
  useEffect(() => () => stop(), [stop]);

  // Capture the stream's intrinsic resolution once it is known.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const onMeta = () => {
      if (video.videoWidth && video.videoHeight) {
        setDims({ w: video.videoWidth, h: video.videoHeight });
      }
    };
    video.addEventListener("loadedmetadata", onMeta);
    onMeta();
    return () => video.removeEventListener("loadedmetadata", onMeta);
  }, [videoRef, status]);

  const mirrored = facingMode === "user";

  const onCapture = useCallback(async () => {
    const stage = stageRef.current;
    const video = videoRef.current;
    if (!stage || !video || capturing) return;
    setCapturing(true);
    setFlash(true);
    window.setTimeout(() => setFlash(false), 320);
    try {
      const blob = await captureStage(stage, video, mirrored);
      if (blob) {
        await shareOrDownload(blob, `reality-sandbox-${demo?.id ?? "shot"}-${Date.now()}.png`);
      }
    } catch (err) {
      console.error("Capture failed", err);
    } finally {
      setCapturing(false);
    }
  }, [capturing, mirrored, demo, videoRef]);

  const ready = status === "ready" && dims !== null;
  const demoNode = useMemo(() => {
    if (!demo || !ready || !videoRef.current || !dims) return null;
    const Demo = demo.component;
    return (
      <Demo
        video={videoRef.current}
        width={dims.w}
        height={dims.h}
        mirrored={mirrored}
      />
    );
  }, [demo, ready, dims, mirrored, videoRef]);

  if (!demo) return <NotFound />;

  return (
    <div className="stage" ref={stageRef}>
      <video
        ref={videoRef}
        className="stage__video"
        style={{ transform: mirrored ? "scaleX(-1)" : undefined }}
        playsInline
        muted
      />

      {/* Active demo overlay (lazy-loaded). */}
      {ready && (
        <Suspense fallback={<Overlay title="Loading demo…" spinner />}>
          <div className="stage__overlay stage__overlay--in">{demoNode}</div>
        </Suspense>
      )}

      {/* Top chrome */}
      <div className="stage__topbar">
        <button
          className="iconbtn"
          onClick={() => navigate("/")}
          aria-label="Back to hub"
        >
          ←
        </button>
        <div className="stage__heading">
          <span className="stage__glyph">{demo.glyph}</span>
          <span className="stage__name">{demo.title}</span>
          {status === "ready" && fps > 0 && (
            <span className="stage__fps">{fps} fps</span>
          )}
        </div>
        {status === "ready" && (
          <button className="iconbtn" onClick={flip} aria-label="Flip camera">
            ⟳
          </button>
        )}
      </div>

      {/* HUD frame + shutter */}
      {status === "ready" && (
        <>
          <div className="stage__frame" aria-hidden />
          <button
            className={"shutter" + (capturing ? " shutter--busy" : "")}
            onClick={() => void onCapture()}
            disabled={capturing}
            aria-label="Capture photo"
          >
            <span className="shutter__ring" />
            <span className="shutter__dot" />
          </button>
        </>
      )}

      {flash && <div className="stage__flash" aria-hidden />}

      {/* Permission / loading / error gates */}
      {status === "idle" && (
        <Overlay
          title={demo.title}
          body={demo.description}
          action={
            <>
              <button className="btn btn--primary" onClick={() => void start()}>
                ▶ Start camera
              </button>
              <p className="overlay__fine">
                The camera feed is processed entirely on your device and never
                leaves it.
              </p>
            </>
          }
          uses={demo.uses}
        />
      )}

      {status === "requesting" && (
        <Overlay title="Requesting camera…" body="Allow access when prompted." spinner />
      )}

      {(status === "denied" || status === "error" || status === "unsupported") && (
        <Overlay
          title={status === "denied" ? "Camera blocked" : "Couldn't start camera"}
          body={error ?? "Something went wrong accessing the camera."}
          action={
            <div className="overlay__actions">
              {status !== "unsupported" && (
                <button className="btn btn--primary" onClick={() => void start()}>
                  Try again
                </button>
              )}
              <Link className="btn btn--ghost" to="/">
                Back to hub
              </Link>
            </div>
          }
        />
      )}
    </div>
  );
}

function Overlay({
  title,
  body,
  action,
  spinner,
  uses,
}: {
  title: string;
  body?: string;
  action?: React.ReactNode;
  spinner?: boolean;
  uses?: string[];
}) {
  return (
    <div className="overlay">
      <div className="overlay__panel">
        {spinner && <div className="spinner" />}
        <h2 className="overlay__title">{title}</h2>
        {body && <p className="overlay__body">{body}</p>}
        {uses && (
          <div className="overlay__uses">
            {uses.map((u) => (
              <span key={u} className="tag">
                {u}
              </span>
            ))}
          </div>
        )}
        {action}
      </div>
    </div>
  );
}
