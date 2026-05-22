/**
 * Registry of layout presets for composing N camera streams onto a single canvas.
 *
 * Each preset describes how to map slotCount video sources to rectangular
 * positions on a canvas of arbitrary dimensions. Positions are returned in
 * canvas pixels with top-left origin.
 *
 * For PiP-style presets, slot positions overlap intentionally — the caller
 * is expected to draw slots in array order (later slots paint on top).
 *
 * See docs/superpowers/specs/2026-05-18-multi-stream-studio-design.md §10.
 */

export type LayoutPosition = { x: number; y: number; w: number; h: number };

export type LayoutPreset = {
  id: string;
  slotCount: number;
  name: string;
  resolve: (canvasW: number, canvasH: number) => LayoutPosition[];
};

const PIP_FRACTION = 0.25;
const PIP_MARGIN = 16;
const MAIN_PIP_STRIP_FRACTION = 0.22;
const MAIN_PIP_STRIP_GAP = 12;
const MAIN_PIP_STRIP_MARGIN = 16;
const MAIN_RIGHT_3_MAIN_FRACTION = 0.7;

export const LAYOUT_PRESETS: Record<string, LayoutPreset> = {
  solo: {
    id: 'solo',
    slotCount: 1,
    name: 'Solo',
    resolve: (canvasW, canvasH) => [{ x: 0, y: 0, w: canvasW, h: canvasH }],
  },

  'side-by-side': {
    id: 'side-by-side',
    slotCount: 2,
    name: 'Side by side',
    resolve: (canvasW, canvasH) => {
      const half = canvasW / 2;
      return [
        { x: 0, y: 0, w: half, h: canvasH },
        { x: half, y: 0, w: half, h: canvasH },
      ];
    },
  },

  stacked: {
    id: 'stacked',
    slotCount: 2,
    name: 'Stacked',
    resolve: (canvasW, canvasH) => {
      const half = canvasH / 2;
      return [
        { x: 0, y: 0, w: canvasW, h: half },
        { x: 0, y: half, w: canvasW, h: half },
      ];
    },
  },

  'pip-main': {
    id: 'pip-main',
    slotCount: 2,
    name: 'Picture-in-picture',
    resolve: (canvasW, canvasH) => {
      const pipW = canvasW * PIP_FRACTION;
      const pipH = canvasH * PIP_FRACTION;
      return [
        { x: 0, y: 0, w: canvasW, h: canvasH },
        {
          x: canvasW - pipW - PIP_MARGIN,
          y: canvasH - pipH - PIP_MARGIN,
          w: pipW,
          h: pipH,
        },
      ];
    },
  },

  pyramid: {
    id: 'pyramid',
    slotCount: 3,
    name: 'Pyramid',
    resolve: (canvasW, canvasH) => {
      const halfH = canvasH / 2;
      const halfW = canvasW / 2;
      return [
        { x: 0, y: 0, w: canvasW, h: halfH },
        { x: 0, y: halfH, w: halfW, h: halfH },
        { x: halfW, y: halfH, w: halfW, h: halfH },
      ];
    },
  },

  'left-main': {
    id: 'left-main',
    slotCount: 3,
    name: 'Left main',
    resolve: (canvasW, canvasH) => {
      const mainW = canvasW * 0.6;
      const sideW = canvasW * 0.4;
      const halfH = canvasH / 2;
      return [
        { x: 0, y: 0, w: mainW, h: canvasH },
        { x: mainW, y: 0, w: sideW, h: halfH },
        { x: mainW, y: halfH, w: sideW, h: halfH },
      ];
    },
  },

  row: {
    id: 'row',
    slotCount: 3,
    name: 'Row',
    resolve: (canvasW, canvasH) => {
      const colW = canvasW / 3;
      return [
        { x: 0, y: 0, w: colW, h: canvasH },
        { x: colW, y: 0, w: colW, h: canvasH },
        { x: colW * 2, y: 0, w: colW, h: canvasH },
      ];
    },
  },

  'grid-2x2': {
    id: 'grid-2x2',
    slotCount: 4,
    name: '2 x 2 grid',
    resolve: (canvasW, canvasH) => {
      const halfW = canvasW / 2;
      const halfH = canvasH / 2;
      return [
        { x: 0, y: 0, w: halfW, h: halfH },
        { x: halfW, y: 0, w: halfW, h: halfH },
        { x: 0, y: halfH, w: halfW, h: halfH },
        { x: halfW, y: halfH, w: halfW, h: halfH },
      ];
    },
  },

  'main-right-3': {
    id: 'main-right-3',
    slotCount: 4,
    name: 'Main + right column',
    resolve: (canvasW, canvasH) => {
      const mainW = canvasW * MAIN_RIGHT_3_MAIN_FRACTION;
      const sideW = canvasW * (1 - MAIN_RIGHT_3_MAIN_FRACTION);
      const thirdH = canvasH / 3;
      return [
        { x: 0, y: 0, w: mainW, h: canvasH },
        { x: mainW, y: 0, w: sideW, h: thirdH },
        { x: mainW, y: thirdH, w: sideW, h: thirdH },
        { x: mainW, y: thirdH * 2, w: sideW, h: thirdH },
      ];
    },
  },

  'main-pip-3': {
    id: 'main-pip-3',
    slotCount: 4,
    name: 'Main + PiP strip',
    resolve: (canvasW, canvasH) => {
      const stripW = canvasW * MAIN_PIP_STRIP_FRACTION;
      const stripH = canvasH * MAIN_PIP_STRIP_FRACTION;
      const x = canvasW - stripW - MAIN_PIP_STRIP_MARGIN;
      return [
        { x: 0, y: 0, w: canvasW, h: canvasH },
        { x, y: MAIN_PIP_STRIP_MARGIN, w: stripW, h: stripH },
        { x, y: MAIN_PIP_STRIP_MARGIN + stripH + MAIN_PIP_STRIP_GAP, w: stripW, h: stripH },
        {
          x,
          y: MAIN_PIP_STRIP_MARGIN + (stripH + MAIN_PIP_STRIP_GAP) * 2,
          w: stripW,
          h: stripH,
        },
      ];
    },
  },
};

export const DEFAULT_LAYOUT_BY_COUNT: Record<number, string> = {
  1: 'solo',
  2: 'side-by-side',
  3: 'pyramid',
  4: 'grid-2x2',
};

/**
 * Selects the layout preset for the given active slot count.
 *
 * Priority:
 *   1. The streamer-selected `layoutPreset`, if defined and valid for `activeCount`.
 *   2. The streamer-configured fallback for this `activeCount`, if defined and valid.
 *   3. The system default for this `activeCount`.
 *
 * Always returns a preset — never `null`. `activeCount` must be in [1, 4].
 */
export function pickLayout(opts: {
  layoutPreset?: string;
  fallbackLayouts?: Record<number, string> | null;
  activeCount: number;
}): LayoutPreset {
  const { layoutPreset, fallbackLayouts, activeCount } = opts;

  if (layoutPreset) {
    const preset = LAYOUT_PRESETS[layoutPreset];
    if (preset && preset.slotCount === activeCount) {
      return preset;
    }
  }

  if (fallbackLayouts) {
    const fallbackId = fallbackLayouts[activeCount];
    if (fallbackId) {
      const preset = LAYOUT_PRESETS[fallbackId];
      if (preset && preset.slotCount === activeCount) {
        return preset;
      }
    }
  }

  const defaultId = DEFAULT_LAYOUT_BY_COUNT[activeCount];
  const defaultPreset = defaultId ? LAYOUT_PRESETS[defaultId] : undefined;
  if (!defaultPreset) {
    throw new Error(`No layout preset available for activeCount=${activeCount}`);
  }
  return defaultPreset;
}

/**
 * Returns `true` if the given preset id is valid for the given slot count.
 * Used by API DTO validation to reject mismatched layoutPreset/slotCount combinations.
 */
export function isLayoutValidForSlotCount(presetId: string, slotCount: number): boolean {
  const preset = LAYOUT_PRESETS[presetId];
  return !!preset && preset.slotCount === slotCount;
}
