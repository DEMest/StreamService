import {
  DEFAULT_LAYOUT_BY_COUNT,
  LAYOUT_PRESETS,
  LayoutPosition,
  pickLayout,
  isLayoutValidForSlotCount,
} from './layout-presets';

const CANVAS_W = 1920;
const CANVAS_H = 1080;
const CANVAS_AREA = CANVAS_W * CANVAS_H;

const PIP_PRESET_IDS = new Set(['pip-main', 'main-pip-3']);

function isFinitePosition(p: LayoutPosition): boolean {
  return (
    Number.isFinite(p.x) &&
    Number.isFinite(p.y) &&
    Number.isFinite(p.w) &&
    Number.isFinite(p.h)
  );
}

function isInsideCanvas(p: LayoutPosition, w: number, h: number): boolean {
  return (
    p.x >= 0 &&
    p.y >= 0 &&
    p.w > 0 &&
    p.h > 0 &&
    p.x + p.w <= w + 0.001 &&
    p.y + p.h <= h + 0.001
  );
}

function rectanglesOverlap(a: LayoutPosition, b: LayoutPosition): boolean {
  return !(
    a.x + a.w <= b.x ||
    b.x + b.w <= a.x ||
    a.y + a.h <= b.y ||
    b.y + b.h <= a.y
  );
}

describe('LAYOUT_PRESETS — registry shape', () => {
  it('has exactly 10 presets', () => {
    expect(Object.keys(LAYOUT_PRESETS).sort()).toEqual(
      [
        'solo',
        'side-by-side',
        'stacked',
        'pip-main',
        'pyramid',
        'left-main',
        'row',
        'grid-2x2',
        'main-right-3',
        'main-pip-3',
      ].sort(),
    );
  });

  it('each preset id matches its registry key', () => {
    for (const [key, preset] of Object.entries(LAYOUT_PRESETS)) {
      expect(preset.id).toBe(key);
    }
  });

  it('each preset has slotCount in [1,4]', () => {
    for (const preset of Object.values(LAYOUT_PRESETS)) {
      expect(preset.slotCount).toBeGreaterThanOrEqual(1);
      expect(preset.slotCount).toBeLessThanOrEqual(4);
    }
  });
});

describe('LAYOUT_PRESETS — resolver math at 1920x1080', () => {
  for (const [id, preset] of Object.entries(LAYOUT_PRESETS)) {
    describe(id, () => {
      const positions = preset.resolve(CANVAS_W, CANVAS_H);

      it(`returns ${preset.slotCount} positions`, () => {
        expect(positions).toHaveLength(preset.slotCount);
      });

      it('returns finite positive rectangles inside canvas', () => {
        for (const p of positions) {
          expect(isFinitePosition(p)).toBe(true);
          expect(isInsideCanvas(p, CANVAS_W, CANVAS_H)).toBe(true);
        }
      });

      it('sum of slot areas does not exceed canvas area', () => {
        const sum = positions.reduce((acc, p) => acc + p.w * p.h, 0);
        if (PIP_PRESET_IDS.has(id)) {
          // PiP presets overlap intentionally — slot 0 fills the canvas,
          // overlay slots add extra area. Sum exceeds canvas area but each
          // individual rectangle remains within canvas bounds.
          expect(sum).toBeGreaterThan(CANVAS_AREA);
        } else {
          expect(sum).toBeLessThanOrEqual(CANVAS_AREA + 1);
        }
      });

      if (!PIP_PRESET_IDS.has(id)) {
        it('non-PiP presets have no overlapping slots', () => {
          for (let i = 0; i < positions.length; i++) {
            for (let j = i + 1; j < positions.length; j++) {
              expect(rectanglesOverlap(positions[i], positions[j])).toBe(false);
            }
          }
        });
      }
    });
  }
});

describe('pip-main — overlay is strictly inside main slot', () => {
  it('slot[1] lies entirely within slot[0]', () => {
    const [main, pip] = LAYOUT_PRESETS['pip-main'].resolve(CANVAS_W, CANVAS_H);
    expect(pip.x).toBeGreaterThanOrEqual(main.x);
    expect(pip.y).toBeGreaterThanOrEqual(main.y);
    expect(pip.x + pip.w).toBeLessThanOrEqual(main.x + main.w);
    expect(pip.y + pip.h).toBeLessThanOrEqual(main.y + main.h);
    expect(pip.w).toBeLessThan(main.w);
    expect(pip.h).toBeLessThan(main.h);
  });
});

describe('main-pip-3 — three overlays sit inside main slot in a column', () => {
  it('slots [1..3] lie inside slot[0] without overlapping each other', () => {
    const [main, ...pips] = LAYOUT_PRESETS['main-pip-3'].resolve(CANVAS_W, CANVAS_H);
    for (const pip of pips) {
      expect(pip.x).toBeGreaterThanOrEqual(main.x);
      expect(pip.y).toBeGreaterThanOrEqual(main.y);
      expect(pip.x + pip.w).toBeLessThanOrEqual(main.x + main.w);
      expect(pip.y + pip.h).toBeLessThanOrEqual(main.y + main.h);
    }
    for (let i = 0; i < pips.length; i++) {
      for (let j = i + 1; j < pips.length; j++) {
        expect(rectanglesOverlap(pips[i], pips[j])).toBe(false);
      }
    }
  });
});

describe('pickLayout', () => {
  it('returns the explicitly chosen preset when valid for activeCount', () => {
    const result = pickLayout({ layoutPreset: 'stacked', activeCount: 2 });
    expect(result.id).toBe('stacked');
  });

  it('ignores the chosen preset when slotCount does not match activeCount', () => {
    const result = pickLayout({ layoutPreset: 'grid-2x2', activeCount: 2 });
    expect(result.id).toBe('side-by-side');
  });

  it('ignores an unknown preset id and falls back to default', () => {
    const result = pickLayout({ layoutPreset: 'no-such-preset', activeCount: 3 });
    expect(result.id).toBe('pyramid');
  });

  it('uses fallbackLayouts[activeCount] when main preset does not fit', () => {
    const result = pickLayout({
      layoutPreset: 'grid-2x2',
      fallbackLayouts: { 1: 'solo', 2: 'pip-main', 3: 'row' },
      activeCount: 2,
    });
    expect(result.id).toBe('pip-main');
  });

  it('uses fallbackLayouts[activeCount] when no main preset is provided', () => {
    const result = pickLayout({
      fallbackLayouts: { 3: 'left-main' },
      activeCount: 3,
    });
    expect(result.id).toBe('left-main');
  });

  it('ignores invalid fallback id and falls back to default', () => {
    const result = pickLayout({
      fallbackLayouts: { 2: 'no-such-preset' },
      activeCount: 2,
    });
    expect(result.id).toBe('side-by-side');
  });

  it('ignores fallback whose slotCount does not match activeCount', () => {
    const result = pickLayout({
      fallbackLayouts: { 2: 'grid-2x2' },
      activeCount: 2,
    });
    expect(result.id).toBe('side-by-side');
  });

  it('returns the system default when no preset and no fallback are provided', () => {
    for (const count of [1, 2, 3, 4]) {
      const result = pickLayout({ activeCount: count });
      expect(result.id).toBe(DEFAULT_LAYOUT_BY_COUNT[count]);
    }
  });

  it('handles null fallbackLayouts gracefully', () => {
    const result = pickLayout({ fallbackLayouts: null, activeCount: 4 });
    expect(result.id).toBe('grid-2x2');
  });

  it('throws for activeCount outside the supported range', () => {
    expect(() => pickLayout({ activeCount: 5 })).toThrow();
    expect(() => pickLayout({ activeCount: 0 })).toThrow();
  });
});

describe('isLayoutValidForSlotCount', () => {
  it('returns true when preset matches slot count', () => {
    expect(isLayoutValidForSlotCount('grid-2x2', 4)).toBe(true);
    expect(isLayoutValidForSlotCount('solo', 1)).toBe(true);
  });

  it('returns false when preset does not match slot count', () => {
    expect(isLayoutValidForSlotCount('grid-2x2', 3)).toBe(false);
    expect(isLayoutValidForSlotCount('solo', 2)).toBe(false);
  });

  it('returns false for unknown preset id', () => {
    expect(isLayoutValidForSlotCount('no-such-preset', 2)).toBe(false);
  });
});
