import { Link } from "react-router-dom";

export default function NotFound() {
  return (
    <div
      style={{
        minHeight: "100dvh",
        display: "grid",
        placeItems: "center",
        textAlign: "center",
        padding: "2rem",
      }}
    >
      <div>
        <h1 style={{ fontSize: "clamp(2rem, 8vw, 3.5rem)", margin: 0 }}>404</h1>
        <p style={{ color: "var(--text-dim)", margin: "0.6rem 0 1.4rem" }}>
          That reality doesn't exist (yet).
        </p>
        <Link className="btn btn--primary" to="/">
          ← Back to hub
        </Link>
      </div>
    </div>
  );
}
