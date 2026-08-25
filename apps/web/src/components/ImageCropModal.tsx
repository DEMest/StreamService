'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowCounterClockwise, Crop, MagnifyingGlassMinus, MagnifyingGlassPlus, WarningCircle, X } from '@phosphor-icons/react';
import {
  CROP_JPEG_QUALITY,
  CROP_OUTPUT_HEIGHT,
  CROP_OUTPUT_WIDTH,
  MAX_SOURCE_BYTES,
  MAX_ZOOM,
  MIN_ZOOM,
  fitFrame,
  frameCenter,
  frameOrigin,
  initialState,
  panBy,
  scaleFor,
  toJpegName,
  toSourceRect,
  zoomAt,
  type CropState,
  type Offset,
  type Size,
} from '@/lib/crop';

/** Поля вокруг рамки: в них видно затемнённый «хвост» картинки. */
const STAGE_PADDING = 28;
const ZOOM_STEP = 1.25;

interface Props {
  file: File;
  /** Заголовок окна — куда именно уедет картинка («Картинка организации» и т.п.). */
  title: string;
  onCancel: () => void;
  onApply: (file: File) => void;
}

/**
 * Выбор области 16:9 перед загрузкой превью.
 *
 * Рамка стоит на месте, картинка под ней двигается и масштабируется; минимальный
 * зум равен «cover», поэтому пустых полей внутри рамки не бывает. По «Применить»
 * видимая область перерисовывается на canvas в JPEG 1280×720 — на сервер уходит
 * уже готовый кадр, а не оригинал.
 */
export function ImageCropModal({ file, title, onCancel, onApply }: Props) {
  const tooLarge = file.size > MAX_SOURCE_BYTES;

  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [image, setImage] = useState<Size | null>(null);
  const [stage, setStage] = useState<Size | null>(null);
  const [crop, setCrop] = useState<CropState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(
    tooLarge
      ? `Файл слишком большой — ${(file.size / 1024 / 1024).toFixed(1)} МБ. Максимум ${MAX_SOURCE_BYTES / 1024 / 1024} МБ.`
      : null,
  );

  const stageRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  /** Активные указатели: один — перетаскивание, два — щипок. */
  const pointers = useRef(new Map<number, Offset>());
  const pinch = useRef<{ distance: number; zoom: number } | null>(null);

  // Создаём и отзываем ссылку в одном эффекте. Если создать её в useState, а
  // отзывать в эффекте, то двойной прогон эффектов в StrictMode отзовёт
  // единственную ссылку — и картинка перестанет грузиться в dev-сборке.
  useEffect(() => {
    if (tooLarge) return;
    const url = URL.createObjectURL(file);
    setObjectUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file, tooLarge]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onCancel(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const measure = () => {
      const rect = el.getBoundingClientRect();
      setStage((prev) =>
        prev && prev.width === rect.width && prev.height === rect.height
          ? prev
          : { width: rect.width, height: rect.height },
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [error]);

  const frame = stage ? fitFrame(stage, STAGE_PADDING) : null;
  const origin = stage && frame ? frameOrigin(stage, frame) : null;
  const ready = Boolean(image && frame && frame.width > 0 && crop);

  // Размеры сцены известны только после вёрстки, картинки — после декодирования;
  // пересчитываем на изменение любого из них, заодно переклампивая после ресайза.
  useEffect(() => {
    if (!image || !frame || frame.width <= 0) return;
    setCrop((prev) => (prev ? panBy(prev, { x: 0, y: 0 }, image, frame) : initialState(image, frame)));
  }, [image, frame?.width, frame?.height]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Точка внутри рамки по экранным координатам курсора или пальца. */
  const anchorFrom = useCallback((clientX: number, clientY: number): Offset | null => {
    const el = stageRef.current;
    if (!el || !origin) return null;
    const rect = el.getBoundingClientRect();
    return { x: clientX - rect.left - origin.x, y: clientY - rect.top - origin.y };
  }, [origin]);

  // Колесо вешаем вручную: React-обработчик пассивный, preventDefault в нём не
  // сработает и страница уедет скроллом вместе с зумом.
  useEffect(() => {
    const el = stageRef.current;
    if (!el || !image || !frame || frame.width <= 0) return;
    const currentImage = image;
    const currentFrame = frame;
    function onWheel(e: WheelEvent) {
      e.preventDefault();
      const anchor = anchorFrom(e.clientX, e.clientY);
      if (!anchor) return;
      const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      const factor = Math.exp(-delta * 0.0015);
      setCrop((prev) => (prev ? zoomAt(prev, prev.zoom * factor, anchor, currentImage, currentFrame) : prev));
    }
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [image, frame?.width, frame?.height, anchorFrom]); // eslint-disable-line react-hooks/exhaustive-deps

  function pointerDistance(): number {
    const [a, b] = Array.from(pointers.current.values());
    if (!a || !b) return 0;
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (!ready) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2 && crop) {
      pinch.current = { distance: pointerDistance(), zoom: crop.zoom };
    }
  }

  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const previous = pointers.current.get(e.pointerId);
    if (!previous || !image || !frame) return;
    const current = { x: e.clientX, y: e.clientY };
    pointers.current.set(e.pointerId, current);

    const gesture = pinch.current;
    if (pointers.current.size >= 2 && gesture && gesture.distance > 0) {
      const [a, b] = Array.from(pointers.current.values());
      const anchor = anchorFrom((a.x + b.x) / 2, (a.y + b.y) / 2);
      if (!anchor) return;
      const ratio = pointerDistance() / gesture.distance;
      setCrop((prev) => (prev ? zoomAt(prev, gesture.zoom * ratio, anchor, image, frame) : prev));
      return;
    }

    const delta = { x: current.x - previous.x, y: current.y - previous.y };
    setCrop((prev) => (prev ? panBy(prev, delta, image, frame) : prev));
  }

  function handlePointerUp(e: React.PointerEvent<HTMLDivElement>) {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
  }

  function applyZoom(next: number) {
    if (!image || !frame) return;
    setCrop((prev) => (prev ? zoomAt(prev, next, frameCenter(frame), image, frame) : prev));
  }

  async function handleApply() {
    const img = imgRef.current;
    if (!img || !crop || !image || !frame) return;
    setBusy(true);
    try {
      const rect = toSourceRect(crop, image, frame);
      const canvas = document.createElement('canvas');
      canvas.width = CROP_OUTPUT_WIDTH;
      canvas.height = CROP_OUTPUT_HEIGHT;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('canvas context unavailable');
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, rect.sx, rect.sy, rect.sw, rect.sh, 0, 0, CROP_OUTPUT_WIDTH, CROP_OUTPUT_HEIGHT);
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, 'image/jpeg', CROP_JPEG_QUALITY),
      );
      if (!blob) throw new Error('toBlob returned null');
      onApply(new File([blob], toJpegName(file.name), { type: 'image/jpeg' }));
    } catch {
      setError('Не удалось обработать изображение. Попробуйте другой файл.');
      setBusy(false);
    }
  }

  const scale = image && frame && crop ? scaleFor(image, frame, crop.zoom) : 1;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="relative w-[min(92vw,720px)] bg-surface-elevated border border-zinc-800 rounded-xl shadow-2xl shadow-black/50 flex flex-col gap-4 p-5">
        <button
          type="button"
          onClick={onCancel}
          aria-label="Закрыть"
          className="absolute top-2.5 right-2.5 w-8 h-8 flex items-center justify-center text-zinc-500 hover:text-zinc-200 rounded-md cursor-pointer transition-colors"
        >
          <X size={16} />
        </button>

        <div className="flex flex-col gap-0.5 pr-8">
          <h2 className="flex items-center gap-2 text-base font-semibold text-zinc-100">
            <Crop size={18} className="text-brand" />
            {title}
          </h2>
          <p className="text-xs text-zinc-500">Выберите область 16:9 — она и станет превью.</p>
        </div>

        {error ? (
          <div className="flex items-start gap-2.5 px-3.5 py-3 bg-red-950/30 border border-red-900/50 rounded-lg">
            <WarningCircle size={18} className="text-red-400 shrink-0 mt-px" />
            <p className="text-xs text-red-300 leading-relaxed">{error}</p>
          </div>
        ) : (
          <>
            <div
              ref={stageRef}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerUp}
              className="relative h-[clamp(220px,44vh,400px)] overflow-hidden rounded-lg bg-surface-primary border border-zinc-800 touch-none select-none cursor-grab active:cursor-grabbing"
            >
              {objectUrl && (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  ref={imgRef}
                  src={objectUrl}
                  alt=""
                  draggable={false}
                  onLoad={(e) => setImage({
                    width: e.currentTarget.naturalWidth,
                    height: e.currentTarget.naturalHeight,
                  })}
                  onError={() => setError('Не удалось прочитать изображение. Попробуйте другой файл.')}
                  className="absolute max-w-none pointer-events-none"
                  style={{
                    left: origin && crop ? origin.x + crop.offset.x : 0,
                    top: origin && crop ? origin.y + crop.offset.y : 0,
                    width: image ? image.width * scale : undefined,
                    height: image ? image.height * scale : undefined,
                    opacity: ready ? 1 : 0,
                  }}
                />
              )}

              {ready && frame && origin && (
                <div
                  aria-hidden
                  className="absolute rounded-sm ring-1 ring-zinc-200/70 pointer-events-none"
                  style={{
                    left: origin.x,
                    top: origin.y,
                    width: frame.width,
                    height: frame.height,
                    boxShadow: '0 0 0 9999px rgba(12,12,14,0.72)',
                  }}
                />
              )}

              {!ready && (
                <p className="absolute inset-0 flex items-center justify-center text-xs text-zinc-600">
                  Загрузка изображения...
                </p>
              )}
            </div>

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => applyZoom((crop?.zoom ?? MIN_ZOOM) / ZOOM_STEP)}
                disabled={!ready}
                aria-label="Отдалить"
                className="w-8 h-8 shrink-0 flex items-center justify-center text-zinc-400 hover:text-zinc-100 bg-zinc-800/60 hover:bg-zinc-800 rounded-md transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-default"
              >
                <MagnifyingGlassMinus size={14} />
              </button>
              <input
                type="range"
                min={MIN_ZOOM}
                max={MAX_ZOOM}
                step={0.01}
                value={crop?.zoom ?? MIN_ZOOM}
                disabled={!ready}
                aria-label="Масштаб"
                onChange={(e) => applyZoom(Number(e.target.value))}
                className="flex-1 h-1 accent-brand cursor-pointer disabled:opacity-40 disabled:cursor-default"
              />
              <button
                type="button"
                onClick={() => applyZoom((crop?.zoom ?? MIN_ZOOM) * ZOOM_STEP)}
                disabled={!ready}
                aria-label="Приблизить"
                className="w-8 h-8 shrink-0 flex items-center justify-center text-zinc-400 hover:text-zinc-100 bg-zinc-800/60 hover:bg-zinc-800 rounded-md transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-default"
              >
                <MagnifyingGlassPlus size={14} />
              </button>
              <button
                type="button"
                onClick={() => { if (image && frame) setCrop(initialState(image, frame)); }}
                disabled={!ready}
                aria-label="Сбросить"
                title="Сбросить"
                className="w-8 h-8 shrink-0 flex items-center justify-center text-zinc-400 hover:text-zinc-100 bg-zinc-800/60 hover:bg-zinc-800 rounded-md transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-default"
              >
                <ArrowCounterClockwise size={14} />
              </button>
            </div>

            <p className="text-xs text-zinc-600">
              Тяните картинку мышью или пальцем, масштаб — колесом, ползунком или щипком.
            </p>
          </>
        )}

        <div className="flex items-center justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onCancel}
            className="px-3.5 py-2 text-xs text-zinc-400 hover:text-zinc-200 bg-zinc-800/60 hover:bg-zinc-800 rounded-lg transition-all active:scale-[0.98] cursor-pointer"
          >
            Отмена
          </button>
          <button
            type="button"
            onClick={handleApply}
            disabled={!ready || busy || Boolean(error)}
            className="px-3.5 py-2 text-xs font-medium text-white bg-brand hover:bg-brand-hover rounded-lg transition-all active:scale-[0.98] cursor-pointer disabled:opacity-40 disabled:cursor-default"
          >
            {busy ? 'Обработка...' : 'Применить'}
          </button>
        </div>
      </div>
    </div>
  );
}
