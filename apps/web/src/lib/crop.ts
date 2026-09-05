/**
 * Математика кропа превью — чистые функции, без React и DOM.
 *
 * Модель как в твичовом кроппере: рамка фиксированного соотношения 16:9 стоит
 * на месте, под ней двигается и масштабируется картинка. `zoom = 1` — это
 * «cover»: картинка ровно закрывает рамку по узкой стороне, поэтому пустых
 * полей внутри рамки не бывает ни при каком допустимом смещении.
 *
 * Все размеры и смещения — в CSS-пикселях рамки; в пиксели выходного холста
 * переводит только `toDestRect` на самом последнем шаге.
 */

export const CROP_ASPECT = 16 / 9;
export const CROP_OUTPUT_WIDTH = 1280;
export const CROP_OUTPUT_HEIGHT = 720;
export const CROP_JPEG_QUALITY = 0.92;
export const MIN_ZOOM = 1;
export const MAX_ZOOM = 4;

/**
 * Порог на исходный файл — защита браузера, а не бизнес-правило: на сервер
 * уходит уже пожатый кроп (~150–250 КБ). 25 МБ с запасом покрывают снимок с
 * любого телефона и отсекают случайно выбранный RAW/скан на сотню мегабайт.
 */
export const MAX_SOURCE_BYTES = 25 * 1024 * 1024;

export interface Size {
  width: number;
  height: number;
}

export interface Offset {
  x: number;
  y: number;
}

export interface CropState {
  zoom: number;
  offset: Offset;
}

/** Прямоугольник на выходном холсте — аргументы для drawImage. */
export interface DestRect {
  dx: number;
  dy: number;
  dw: number;
  dh: number;
}

export function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return MIN_ZOOM;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

/** Масштаб, при котором картинка впервые полностью закрывает рамку. */
export function coverScale(image: Size, frame: Size): number {
  if (image.width <= 0 || image.height <= 0) return 1;
  return Math.max(frame.width / image.width, frame.height / image.height);
}

export function scaleFor(image: Size, frame: Size, zoom: number): number {
  return coverScale(image, frame) * clampZoom(zoom);
}

/**
 * Порог «считаем нулём». `coverScale` подгоняет картинку под рамку ровно, и по
 * узкой стороне `shown` отличается от `frame` на единицы 1e-14 — то есть знак
 * разницы случаен. Без порога такая картинка попадала бы в ветку «уже рамки» и
 * получала микроскопическое положительное смещение, которое дальше вылезало
 * прозрачной полоской по краю холста.
 */
const EPSILON = 1e-6;

/**
 * Не даём утащить картинку так, чтобы в рамке образовалась дыра: смещение живёт
 * в [-(shown - frame), 0]. Картинку, которая честно уже рамки (такое возможно
 * только при вырожденной рамке), центрируем — иначе диапазон схлопнулся бы в
 * пустоту.
 */
export function clampOffset(offset: Offset, image: Size, frame: Size, scale: number): Offset {
  const shown = { width: image.width * scale, height: image.height * scale };
  const axis = (value: number, shownSize: number, frameSize: number) => {
    const slack = shownSize - frameSize;
    if (slack < -EPSILON) return -slack / 2;
    return Math.min(0, Math.max(-Math.max(slack, 0), value));
  };
  return {
    x: axis(offset.x, shown.width, frame.width),
    y: axis(offset.y, shown.height, frame.height),
  };
}

/** Стартовое состояние: zoom 1, картинка по центру рамки. */
export function initialState(image: Size, frame: Size): CropState {
  const scale = scaleFor(image, frame, MIN_ZOOM);
  const offset = {
    x: (frame.width - image.width * scale) / 2,
    y: (frame.height - image.height * scale) / 2,
  };
  return { zoom: MIN_ZOOM, offset: clampOffset(offset, image, frame, scale) };
}

export function panBy(state: CropState, delta: Offset, image: Size, frame: Size): CropState {
  const scale = scaleFor(image, frame, state.zoom);
  const offset = clampOffset(
    { x: state.offset.x + delta.x, y: state.offset.y + delta.y },
    image,
    frame,
    scale,
  );
  return { zoom: state.zoom, offset };
}

/**
 * Зум вокруг точки `anchor` (координаты внутри рамки): точка картинки под
 * курсором/пальцем остаётся на месте. Без этого зум колесом «уплывает» от
 * того места, куда пользователь смотрит.
 */
export function zoomAt(
  state: CropState,
  nextZoom: number,
  anchor: Offset,
  image: Size,
  frame: Size,
): CropState {
  const zoom = clampZoom(nextZoom);
  const prevScale = scaleFor(image, frame, state.zoom);
  const scale = scaleFor(image, frame, zoom);
  if (prevScale <= 0) return { zoom, offset: state.offset };

  // Точка исходника, оказавшаяся под anchor до зума.
  const imagePoint = {
    x: (anchor.x - state.offset.x) / prevScale,
    y: (anchor.y - state.offset.y) / prevScale,
  };
  const offset = clampOffset(
    { x: anchor.x - imagePoint.x * scale, y: anchor.y - imagePoint.y * scale },
    image,
    frame,
    scale,
  );
  return { zoom, offset };
}

/**
 * Рамка внутри «сцены»: максимальный прямоугольник заданного соотношения
 * сторон (по умолчанию 16:9), который влезает в сцену с заданными полями.
 * Поля нужны, чтобы вокруг рамки осталась видна затемнённая часть картинки —
 * пользователь видит, что именно он отрезает.
 */
export function fitFrame(stage: Size, padding: number, aspect: number = CROP_ASPECT): Size {
  const maxWidth = Math.max(0, stage.width - padding * 2);
  const maxHeight = Math.max(0, stage.height - padding * 2);
  const width = Math.min(maxWidth, maxHeight * aspect);
  return { width, height: width / aspect };
}

/** Левый верхний угол рамки в координатах сцены (рамка всегда по центру). */
export function frameOrigin(stage: Size, frame: Size): Offset {
  return { x: (stage.width - frame.width) / 2, y: (stage.height - frame.height) / 2 };
}

/** Центр рамки — якорь для зума слайдером и кнопками. */
export function frameCenter(frame: Size): Offset {
  return { x: frame.width / 2, y: frame.height / 2 };
}

/**
 * Куда положить картинку на выходном холсте.
 *
 * Считаем не «какую область исходника взять», а «как перерисовать картинку
 * целиком тем же преобразованием, что и на экране» — лишнее холст обрежет сам,
 * ведь холст и есть рамка. Это важнее, чем кажется: так кадр совпадает с тем,
 * что видел пользователь, даже если браузер по-своему трактует EXIF-ориентацию
 * снимка с телефона. Экран и холст используют одни и те же числа, поэтому
 * «сплющило» их одинаково или не сплющило вовсе.
 *
 * Коэффициенты по осям считаем раздельно: рамка меряется в дробных CSS-пикселях
 * и её пропорция отличается от 16:9 в четвёртом знаке. Общий коэффициент оставил
 * бы по краю холста полоску в сотые доли пикселя (в JPEG она стала бы тёмной),
 * а раздельные дают точное покрытие — кламп смещения гарантирует его в
 * координатах рамки, а умножение по осям переносит гарантию на холст.
 */
export function toDestRect(
  state: CropState,
  image: Size,
  frame: Size,
  outputWidth: number = CROP_OUTPUT_WIDTH,
  outputHeight: number = CROP_OUTPUT_HEIGHT,
): DestRect {
  if (frame.width <= 0 || frame.height <= 0) {
    return { dx: 0, dy: 0, dw: outputWidth, dh: outputHeight };
  }
  const kx = outputWidth / frame.width;
  const ky = outputHeight / frame.height;
  const scale = scaleFor(image, frame, state.zoom);
  return {
    dx: state.offset.x * kx,
    dy: state.offset.y * ky,
    dw: image.width * scale * kx,
    dh: image.height * scale * ky,
  };
}

/** Имя результата: кроп всегда JPEG, расширение исходника уже врёт. */
export function toJpegName(name: string): string {
  const base = name.replace(/\.[^.]+$/, '').trim();
  return `${base || 'preview'}.jpg`;
}
