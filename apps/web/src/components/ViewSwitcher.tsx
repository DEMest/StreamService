"use client";

export type ViewMode = "quad" | "focus";
export type MatId = 1 | 2 | 3 | 4;

interface ViewSwitcherProps {
  mode: ViewMode;
  activeMat: MatId;
  onModeChange: (mode: ViewMode) => void;
  onMatSelect: (mat: MatId) => void;
}

const MATS: MatId[] = [1, 2, 3, 4];

export default function ViewSwitcher({
  mode,
  activeMat,
  onModeChange,
  onMatSelect,
}: ViewSwitcherProps) {
  return (
    <div style={{ display: "flex", gap: "8px", padding: "12px", flexWrap: "wrap" }}>
      <button
        onClick={() => onModeChange("quad")}
        aria-pressed={mode === "quad"}
        style={{
          padding: "6px 14px",
          background: mode === "quad" ? "#e53e3e" : "#2d2d2d",
          color: "#fff",
          border: "none",
          borderRadius: "4px",
          cursor: "pointer",
        }}
      >
        Quad
      </button>
      <button
        onClick={() => onModeChange("focus")}
        aria-pressed={mode === "focus"}
        style={{
          padding: "6px 14px",
          background: mode === "focus" ? "#e53e3e" : "#2d2d2d",
          color: "#fff",
          border: "none",
          borderRadius: "4px",
          cursor: "pointer",
        }}
      >
        Focus
      </button>
      <span style={{ borderLeft: "1px solid #444", margin: "0 4px" }} />
      {MATS.map((mat) => (
        <button
          key={mat}
          onClick={() => onMatSelect(mat)}
          aria-pressed={activeMat === mat}
          style={{
            padding: "6px 14px",
            background: activeMat === mat ? "#2b6cb0" : "#2d2d2d",
            color: "#fff",
            border: "none",
            borderRadius: "4px",
            cursor: "pointer",
          }}
        >
          Mat {mat}
        </button>
      ))}
    </div>
  );
}
