'use client';

import { useQuery } from '@tanstack/react-query';
import { Pulse, Warning, Users, Timer, FilmStrip, Broadcast } from '@phosphor-icons/react';
import { api } from '@/lib/api';

/** Точка графика (см. StatsSample в apps/api/src/stats/stats.types.ts). */
interface StatsSample {
  t: number;
  inKbps: number;
  outKbps: number;
  fps: number | null;
  speed: number | null;
  dropped: number | null;
}

interface StreamStats {
  path: string;
  /** false — состояние медиасервера неизвестно (это НЕ «офлайн»). */
  connected: boolean;
  live: boolean;
  uptimeSeconds: number | null;
  source: { protocol: string; remoteAddr: string | null; connectedAt: string | null } | null;
  video: { codec: string; width: number | null; height: number | null; profile: string | null; level: string | null } | null;
  audio: { codec: string; sampleRate: number | null; channels: number | null } | null;
  ingest: { kbps: number; bytesReceived: number; framesInError: number };
  transcode: {
    fps: number | null;
    speed: number | null;
    outKbps: number | null;
    droppedFramesTotal: number | null;
    dupFramesTotal: number | null;
    healthy: boolean;
  } | null;
  srt: { packetsReceived: number | null; packetsLost: number | null; packetsDropped: number | null; rttMs: number | null } | null;
  readers: number;
  viewers: number;
  history: StatsSample[];
}

/** Битрейт в кбит/с → «6,4 Мбит/с» либо «850 кбит/с». */
function formatKbps(kbps: number | null): string {
  if (kbps == null) return '—';
  if (kbps >= 1000) return `${(kbps / 1000).toFixed(1).replace('.', ',')} Мбит/с`;
  return `${Math.round(kbps)} кбит/с`;
}

function formatUptime(seconds: number | null): string {
  if (seconds == null) return '—';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 Б';
  const units = ['Б', 'КБ', 'МБ', 'ГБ', 'ТБ'];
  let i = Math.min(units.length - 1, Math.floor(Math.log10(bytes) / 3));
  let value = bytes / 1000 ** i;
  let digits = i >= 3 && value < 100 ? 1 : 0;
  if (Number(value.toFixed(digits)) >= 1000 && i < units.length - 1) {
    i += 1;
    value = bytes / 1000 ** i;
    digits = value < 100 ? 1 : 0;
  }
  return `${value.toFixed(digits).replace('.', ',')} ${units[i]}`;
}

/**
 * Мини-график без внешних библиотек: нормируем значения в высоту viewBox и
 * рисуем polyline + заливку под ней. `preserveAspectRatio="none"` растягивает
 * фиксированный viewBox на любую ширину контейнера — благодаря этому SVG
 * резиновый, а считать пиксели в React не нужно.
 */
function Sparkline({
  values,
  height = 140,
  stroke = '#10b981',
  label,
}: {
  values: (number | null)[];
  height?: number;
  stroke?: string;
  label?: string;
}) {
  const points = values.filter((v): v is number => v != null && Number.isFinite(v));
  if (points.length < 2) {
    return (
      <div
        className="flex items-center justify-center rounded-lg bg-surface-primary border border-zinc-800/60 text-[11px] text-zinc-600"
        style={{ height }}
      >
        накопление данных…
      </div>
    );
  }

  const max = Math.max(...points);
  const min = Math.min(...points);
  // Нулевой размах (ровная линия) иначе делил бы на ноль — рисуем по центру.
  const span = max - min || 1;
  const W = 300;
  const H = 100;

  const coords = values.map((v, i) => {
    const x = (i / Math.max(1, values.length - 1)) * W;
    const y = v == null || !Number.isFinite(v) ? null : H - ((v - min) / span) * H;
    return { x, y };
  });

  // Разрывы (null) рвут линию на сегменты, а не соединяют её через пропуск.
  const segments: string[] = [];
  let current: string[] = [];
  for (const c of coords) {
    if (c.y == null) {
      if (current.length > 1) segments.push(current.join(' '));
      current = [];
    } else {
      current.push(`${c.x.toFixed(1)},${c.y.toFixed(1)}`);
    }
  }
  if (current.length > 1) segments.push(current.join(' '));

  const lastDrawn = [...coords].reverse().find((c) => c.y != null);
  // Заливка под последним непрерывным сегментом — она задаёт объём и делает
  // форму читаемой боковым зрением, без вглядывания в тонкую линию.
  const lastSeg = segments[segments.length - 1];
  const areaPath = lastSeg
    ? `M ${lastSeg.split(' ')[0].split(',')[0]},${H} L ${lastSeg.split(' ').join(' L ')} L ${
        lastSeg.split(' ')[lastSeg.split(' ').length - 1].split(',')[0]
      },${H} Z`
    : null;
  const gradientId = `grad-${(label ?? 'chart').replace(/[^a-zA-Z0-9]/g, '')}`;

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="w-full block rounded-lg bg-surface-primary border border-zinc-800/60"
        style={{ height }}
        role="img"
        aria-label={label ?? 'график'}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={stroke} stopOpacity="0.28" />
            <stop offset="100%" stopColor={stroke} stopOpacity="0" />
          </linearGradient>
        </defs>
        {/* Направляющие на 1/4, 1/2, 3/4 — глазу есть за что зацепиться. */}
        {[0.25, 0.5, 0.75].map((f) => (
          <line
            key={f}
            x1={0}
            x2={W}
            y1={H * f}
            y2={H * f}
            stroke="currentColor"
            className="text-zinc-800"
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {areaPath && <path d={areaPath} fill={`url(#${gradientId})`} />}
        {segments.map((pts, i) => (
          <polyline
            key={i}
            points={pts}
            fill="none"
            stroke={stroke}
            strokeWidth={2}
            vectorEffect="non-scaling-stroke"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ))}
        {lastDrawn?.y != null && (
          <circle cx={lastDrawn.x} cy={lastDrawn.y} r={3.5} fill={stroke} vectorEffect="non-scaling-stroke" />
        )}
      </svg>
      {max !== min && (
        <>
          <span className="absolute top-1 left-2 text-[10px] text-zinc-600 tabular-nums pointer-events-none">
            {Math.round(max)}
          </span>
          <span className="absolute bottom-1 left-2 text-[10px] text-zinc-600 tabular-nums pointer-events-none">
            {Math.round(min)}
          </span>
        </>
      )}
      <span className="absolute bottom-1 right-2 text-[10px] text-zinc-700 pointer-events-none">10 мин</span>
    </div>
  );
}

function Tile({
  icon, label, value, hint, tone = 'normal',
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint?: string;
  tone?: 'normal' | 'warn' | 'bad';
}) {
  const valueTone =
    tone === 'bad' ? 'text-red-300' : tone === 'warn' ? 'text-amber-300' : 'text-zinc-100';
  return (
    <div className="flex flex-col gap-1 p-3 rounded-lg bg-surface-primary border border-zinc-800/60">
      <span className="flex items-center gap-1.5 text-[11px] text-zinc-500">
        {icon}
        {label}
      </span>
      <span className={`text-lg font-semibold tabular-nums tracking-tight ${valueTone}`}>{value}</span>
      {hint && <span className="text-[11px] text-zinc-600">{hint}</span>}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5 border-b border-zinc-800/40 last:border-0">
      <span className="text-[11px] text-zinc-500 shrink-0">{label}</span>
      <span className="text-xs text-zinc-300 tabular-nums text-right break-all">{value}</span>
    </div>
  );
}

/**
 * Живая статистика эфира на странице стрима: битрейт, состояние транскодера
 * (fps / speed / пропуск кадров), параметры источника и графики за последние
 * ~10 минут. Обновляется раз в 2 секунды — с тем же шагом, с каким бэкенд
 * опрашивает MediaMTX, чаще смысла нет.
 */
export function StreamStats({ streamId }: { streamId: string }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['stream-stats', streamId],
    queryFn: () => api.get<StreamStats>(`/v1/org/streams/${streamId}/stats`),
    refetchInterval: 2000,
  });

  const history = data?.history ?? [];
  const tc = data?.transcode ?? null;
  const droppedRecent = history.slice(-30).reduce((a, s) => a + (s.dropped ?? 0), 0);

  return (
    <section className="bg-surface-elevated border border-zinc-800/50 rounded-xl p-5">
      <div className="flex items-center justify-between gap-3 mb-4">
        <h2 className="flex items-center gap-2 text-base font-medium text-zinc-300">
          <Pulse size={18} className="text-zinc-400" />
          Статистика эфира
        </h2>
        {data && (
          <span
            className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[10px] font-medium border ${
              !data.connected
                ? 'bg-amber-500/15 border-amber-500/30 text-amber-300'
                : data.live
                  ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300'
                  : 'bg-zinc-800/60 border-zinc-700/40 text-zinc-500'
            }`}
          >
            <span
              className={`w-1 h-1 rounded-full ${
                !data.connected ? 'bg-amber-400' : data.live ? 'bg-emerald-400 animate-pulse' : 'bg-zinc-600'
              }`}
            />
            {!data.connected ? 'НЕТ СВЯЗИ' : data.live ? 'В ЭФИРЕ' : 'ОФЛАЙН'}
          </span>
        )}
      </div>

      {isLoading && <p className="text-sm text-zinc-600">Загрузка…</p>}
      {isError && !data && <p className="text-sm text-red-400">Не удалось получить статистику</p>}

      {data && !data.connected && (
        <p className="text-sm text-amber-300/80">
          Не удалось получить состояние от медиасервера. Эфир при этом может идти —
          показания появятся, как только связь восстановится.
        </p>
      )}

      {data && data.connected && !data.live && (
        <p className="text-sm text-zinc-600">
          Эфира сейчас нет. Метрики появятся, как только начнётся публикация.
        </p>
      )}

      {data && data.connected && data.live && (
        <div className="flex flex-col gap-4">
          {/* Ключевые цифры */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
            <Tile
              icon={<Broadcast size={12} />}
              label="Входящий битрейт"
              value={formatKbps(data.ingest.kbps)}
              hint={`принято ${formatBytes(data.ingest.bytesReceived)}`}
            />
            <Tile
              icon={<Users size={12} />}
              label="Зрители"
              value={String(data.viewers)}
              hint={`${data.readers} внутр. читателей`}
            />
            <Tile
              icon={<Timer size={12} />}
              label="В эфире"
              value={formatUptime(data.uptimeSeconds)}
              hint={data.source ? data.source.protocol.replace('Conn', '').replace('Session', '').toUpperCase() : undefined}
            />
            <Tile
              icon={<FilmStrip size={12} />}
              label="Транскодер"
              value={tc?.speed != null ? `${tc.speed.toFixed(2).replace('.', ',')}×` : '—'}
              hint={tc?.fps != null ? `${Math.round(tc.fps)} fps` : 'нет данных'}
              tone={tc == null ? 'normal' : tc.healthy ? 'normal' : 'bad'}
            />
          </div>

          {/* Предупреждение о пропуске кадров — то, ради чего всё затевалось */}
          {tc && !tc.healthy && (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/25">
              <Warning size={16} className="shrink-0 mt-px text-red-400" />
              <p className="text-xs text-red-200 leading-relaxed">
                Сервер не успевает обрабатывать поток в реальном времени
                {tc.speed != null && ` (скорость ${tc.speed.toFixed(2).replace('.', ',')}× вместо 1,00×)`}
                {droppedRecent > 0 && `, за последнюю минуту выброшено ${droppedRecent} кадров`}.
                Зрители увидят рывки. Обычно помогает снизить битрейт или частоту
                кадров на стороне энкодера.
              </p>
            </div>
          )}

          {/* Графики. Битрейт — на всю ширину: по нему смотрят чаще всего, и
              провалы канала видно только на длинной оси времени. */}
          <div className="flex flex-col gap-1.5">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-xs text-zinc-400">Входящий битрейт, кбит/с</span>
              <span className="text-sm font-semibold text-emerald-300 tabular-nums">
                {data.ingest.kbps}
              </span>
            </div>
            <Sparkline
              values={history.map((s) => s.inKbps)}
              height={170}
              stroke="#10b981"
              label="Входящий битрейт"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-xs text-zinc-400">FPS транскода</span>
                <span className="text-sm font-semibold text-sky-300 tabular-nums">
                  {tc?.fps != null ? Math.round(tc.fps) : '—'}
                </span>
              </div>
              <Sparkline values={history.map((s) => s.fps)} stroke="#38bdf8" label="FPS транскода" />
            </div>
            <div className="flex flex-col gap-1.5">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-xs text-zinc-400">Пропуск кадров</span>
                <span
                  className={`text-sm font-semibold tabular-nums ${
                    droppedRecent > 0 ? 'text-red-300' : 'text-zinc-400'
                  }`}
                >
                  {droppedRecent > 0 ? `${droppedRecent} за минуту` : '0'}
                </span>
              </div>
              <Sparkline values={history.map((s) => s.dropped)} stroke="#f87171" label="Пропуск кадров" />
            </div>
          </div>

          {/* Подробности */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6">
            <div>
              {data.video && (
                <Row
                  label="Видео"
                  value={[
                    data.video.codec,
                    data.video.width && data.video.height ? `${data.video.width}×${data.video.height}` : null,
                    data.video.profile,
                    data.video.level ? `level ${data.video.level}` : null,
                  ].filter(Boolean).join(' · ')}
                />
              )}
              {data.audio && (
                <Row
                  label="Аудио"
                  value={[
                    data.audio.codec,
                    data.audio.sampleRate ? `${data.audio.sampleRate / 1000} кГц` : null,
                    data.audio.channels === 1 ? 'моно' : data.audio.channels === 2 ? 'стерео' : null,
                  ].filter(Boolean).join(' · ')}
                />
              )}
              {data.source?.remoteAddr && <Row label="Источник" value={data.source.remoteAddr} />}
              <Row label="Битые кадры на входе" value={String(data.ingest.framesInError)} />
            </div>
            <div>
              {tc?.outKbps != null && <Row label="Исходящий битрейт (все качества)" value={formatKbps(tc.outKbps)} />}
              {tc?.droppedFramesTotal != null && (
                <Row label="Выброшено кадров за эфир" value={String(tc.droppedFramesTotal)} />
              )}
              {tc?.dupFramesTotal != null && (
                <Row label="Продублировано кадров" value={String(tc.dupFramesTotal)} />
              )}
              {data.srt && (
                <>
                  <Row label="SRT: потеряно пакетов" value={String(data.srt.packetsLost ?? '—')} />
                  <Row label="SRT: отброшено пакетов" value={String(data.srt.packetsDropped ?? '—')} />
                  <Row label="SRT: RTT" value={data.srt.rttMs != null ? `${data.srt.rttMs.toFixed(0)} мс` : '—'} />
                </>
              )}
            </div>
          </div>

          {tc == null && (
            <p className="text-[11px] text-zinc-600 leading-relaxed">
              Данных транскодера пока нет. Они появляются с начала следующей
              публикации — метрики снимаются с процесса, который поднимается
              вместе с эфиром.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
