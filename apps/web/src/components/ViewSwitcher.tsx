'use client';

export type ViewMode = 'multicam' | 'cam1' | 'cam2' | 'cam3' | 'cam4';

const MODES: { key: ViewMode; label: string }[] = [
  { key: 'multicam', label: 'Multicam' },
  { key: 'cam1', label: 'Camera 1' },
  { key: 'cam2', label: 'Camera 2' },
  { key: 'cam3', label: 'Camera 3' },
  { key: 'cam4', label: 'Camera 4' },
];

interface Props {
  mode: ViewMode;
  onChange: (mode: ViewMode) => void;
}

export default function ViewSwitcher({ mode, onChange }: Props) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
      {MODES.map((m) => (
        <button key={m.key} onClick={() => onChange(m.key)}
          style={{ padding: '0.5rem 1rem', background: mode === m.key ? '#e53' : '#2d2d2d', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', textAlign: 'left' }}>
          {m.label}
        </button>
      ))}
    </div>
  );
}
