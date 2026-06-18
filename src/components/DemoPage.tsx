import { Suspense, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { getDemo } from "../demos/registry";
import { useCamera } from "../core/useCamera";
import NotFound from "./NotFound";
import "./DemoPage.css";

export default function DemoPage() {
  const { id } = useParams();
  const demo = getDemo(id);
  const navigate = useNavigate();
  const camera = useCamera(demo?.facing ?? "environment");
  const { videoRef, status, error, start, stop, flip, facingMode } = camera;

  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);

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
    <div className="stage">
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
          <div className="stage__overlay">{demoNode}</div>
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
        </div>
        {status === "ready" && (
          <button className="iconbtn" onClick={flip} aria-label="Flip camera">
            ⟳
          </button>
        )}
      </div>

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
