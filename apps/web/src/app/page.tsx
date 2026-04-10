"use client";

import { useState } from "react";
import MatPlayer from "@/components/MatPlayer";
import ViewSwitcher, { MatId, ViewMode } from "@/components/ViewSwitcher";

const STREAM_URL =
  process.env.NEXT_PUBLIC_STREAM_URL ??
  "http://localhost:8888/live/stream/index.m3u8";

/**
 * Quad view: show the full composite 2x2 stream.
 * Focus view: zoom into one quadrant via CSS scale + transform origin.
 *
 * Mat layout in the composite frame:
 *   +----+----+
 *   | 1  | 2  |
 *   +----+----+
 *   | 3  | 4  |
 *   +----+----+
 */
const QUAD_ORIGIN: Record<MatId, { x: number; y: number }> = {
  1: { x: 0, y: 0 },
  2: { x: 50, y: 0 },
  3: { x: 0, y: 50 },
  4: { x: 50, y: 50 },
};

function getFocusStyle(mat: MatId): React.CSSProperties {
  const { x, y } = QUAD_ORIGIN[mat];
  return {
    transform: `scale(2) translate(-${x}%, -${y}%)`,
    transformOrigin: `${x}% ${y}%`,
    transition: "transform 0.3s ease",
  };
}

export default function Home() {
  const [mode, setMode] = useState<ViewMode>("quad");
  const [activeMat, setActiveMat] = useState<MatId>(1);

  const videoStyle: React.CSSProperties =
    mode === "focus"
      ? getFocusStyle(activeMat)
      : { transform: "none", transition: "transform 0.3s ease" };

  return (
    <main
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100vh",
        background: "#0a0a0a",
      }}
    >
      <header style={{ padding: "10px 16px", borderBottom: "1px solid #222" }}>
        <h1 style={{ fontSize: "1rem", fontWeight: 600, letterSpacing: "0.05em" }}>
          StreamService
        </h1>
      </header>

      <div style={{ flex: 1, overflow: "hidden", position: "relative" }}>
        <div style={{ width: "100%", height: "100%", ...videoStyle }}>
          <MatPlayer streamUrl={STREAM_URL} />
        </div>
      </div>

      <ViewSwitcher
        mode={mode}
        activeMat={activeMat}
        onModeChange={setMode}
        onMatSelect={setActiveMat}
      />
    </main>
  );
}
