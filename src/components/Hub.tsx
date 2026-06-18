import { Link } from "react-router-dom";
import { DEMOS } from "../demos/registry";
import "./Hub.css";

const SECURE = typeof window !== "undefined" && window.isSecureContext;

function spotlight(e: React.MouseEvent<HTMLElement>) {
  const el = e.currentTarget;
  const r = el.getBoundingClientRect();
  el.style.setProperty("--mx", `${e.clientX - r.left}px`);
  el.style.setProperty("--my", `${e.clientY - r.top}px`);
}

export default function Hub() {
  return (
    <div className="hub">
      <nav className="hub__nav">
        <span className="hub__logo">
          <span className="hub__logo-mark" aria-hidden />
          Reality Sandbox
        </span>
        <a
          className="hub__nav-link"
          href="https://github.com/nroze22/Mesh"
          target="_blank"
          rel="noreferrer"
        >
          GitHub ↗
        </a>
      </nav>

      <header className="hub__hero">
        <span className="hub__badge">
          <span className="hub__badge-dot" />
          Runs 100% in your browser
        </span>
        <h1 className="hub__title">
          Reality <span className="hub__title-accent">Sandbox</span>
        </h1>
        <p className="hub__lede">
          A playground where the web sees the world. Point your camera and watch
          machine-vision models, sensors and 3D graphics fuse into live
          augmented reality — no app, no backend, no upload. Every pixel is
          processed on-device.
        </p>

        <div className="hub__meta">
          <span className="tag">📷 Camera</span>
          <span className="tag">🧠 On-device ML</span>
          <span className="tag">🔒 Nothing leaves your phone</span>
        </div>

        {!SECURE && (
          <p className="hub__warn">
            ⚠️ Camera access needs a secure (HTTPS) connection. Open this page
            over HTTPS or via the deployed GitHub Pages URL.
          </p>
        )}
      </header>

      <main className="hub__grid">
        {DEMOS.map((demo, i) => (
          <Link
            key={demo.id}
            to={`/demo/${demo.id}`}
            className="card"
            onMouseMove={spotlight}
            style={
              {
                "--c1": demo.accent[0],
                "--c2": demo.accent[1],
                animationDelay: `${i * 70}ms`,
              } as React.CSSProperties
            }
          >
            <span className="card__spot" aria-hidden />
            <div className="card__art" aria-hidden>
              <span className="card__glyph">{demo.glyph}</span>
            </div>
            <div className="card__body">
              <div className="card__heading">
                <h2 className="card__title">{demo.title}</h2>
                {demo.maturity === "experimental" && (
                  <span className="tag card__exp">Experimental</span>
                )}
              </div>
              <p className="card__tagline">{demo.tagline}</p>
              <div className="card__uses">
                {demo.uses.map((u) => (
                  <span key={u} className="card__use">
                    {u}
                  </span>
                ))}
              </div>
            </div>
            <span className="card__cta" aria-hidden>
              Launch →
            </span>
          </Link>
        ))}
      </main>

      <footer className="hub__footer">
        <p>
          Built with Vite · React · Three.js · MediaPipe — deployed to GitHub
          Pages.
        </p>
        <a
          className="hub__source"
          href="https://github.com/nroze22/Mesh"
          target="_blank"
          rel="noreferrer"
        >
          View source ↗
        </a>
      </footer>
    </div>
  );
}
