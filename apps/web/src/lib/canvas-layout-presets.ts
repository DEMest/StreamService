/**
 * Раскладка N независимых Stream'ов орги на холсте (org overview →
 * «Смотреть все вместе»). Backend НЕ хранит и не валидирует эту раскладку —
 * чисто viewer-side UI state.
 *
 * Модель: каждый тайл считается 16:9 (обычное соотношение камеры) — раскладки
 * НИКОГДА не растягивают/не сжимают видео под чужие пропорции, контейнер сам
 * подстраивается по высоте под фактическую раскладку. Все величины нормализованы
 * так, что ширина контейнера = 1 (единая база и для x, и для y — это важно:
 * высота тоже считается в долях ШИРИНЫ, чтобы 16:9-тайлы оставались 16:9
 * независимо от итоговой высоты контейнера).
 */

export interface TileRect { x: number; y: number; w: number; h: number }

export interface CanvasLayout {
  tiles: TileRect[];
  /** width / height контейнера в тех же нормализованных единицах, что и tiles. */
  aspect: number;
}

const TILE_ASPECT = 16 / 9;
const GAP = 0.006;

/**
 * 1 — во всю ширину; 2 — в ряд; 3 — 2 сверху + 1 по центру снизу; 4 — 2×2.
 * Каждый тайл честные 16:9.
 */
function gridLayout(tileCount: number): CanvasLayout {
  if (tileCount <= 0) return { tiles: [], aspect: TILE_ASPECT };

  if (tileCount === 1) {
    const h = 1 / TILE_ASPECT;
    return { tiles: [{ x: 0, y: 0, w: 1, h }], aspect: 1 / h };
  }

  if (tileCount === 2) {
    const w = (1 - GAP) / 2;
    const h = w / TILE_ASPECT;
    return {
      tiles: [
        { x: 0, y: 0, w, h },
        { x: w + GAP, y: 0, w, h },
      ],
      aspect: 1 / h,
    };
  }

  if (tileCount === 3) {
    const w = (1 - GAP) / 2;
    const h = w / TILE_ASPECT;
    return {
      tiles: [
        { x: 0, y: 0, w, h },
        { x: w + GAP, y: 0, w, h },
        { x: (1 - w) / 2, y: h + GAP, w, h },
      ],
      aspect: 1 / (2 * h + GAP),
    };
  }

  // 4: 2x2
  const w = (1 - GAP) / 2;
  const h = w / TILE_ASPECT;
  return {
    tiles: [
      { x: 0, y: 0, w, h },
      { x: w + GAP, y: 0, w, h },
      { x: 0, y: h + GAP, w, h },
      { x: w + GAP, y: h + GAP, w, h },
    ],
    aspect: 1 / (2 * h + GAP),
  };
}

/** Вертикальный стек (мобильные) — один столбец, каждый тайл во всю ширину. */
function stackLayout(tileCount: number): CanvasLayout {
  const w = 1;
  const h = w / TILE_ASPECT;
  const tiles: TileRect[] = [];
  for (let i = 0; i < tileCount; i++) tiles.push({ x: 0, y: i * (h + GAP), w, h });
  return { tiles, aspect: 1 / (tileCount * h + GAP * (tileCount - 1)) };
}

export function computeCanvasLayout(tileCount: number, opts: { isMobile: boolean }): CanvasLayout {
  return opts.isMobile ? stackLayout(tileCount) : gridLayout(tileCount);
}
