'use client';

import { useMemo, useState } from 'react';

const nf = new Intl.NumberFormat('ru-RU');

export interface ChartPoint {
  t: number;
  viewers: number;
  egressMbps: number;
}

/**
 * График за час: отдача и зрители на одном полотне.
 *
 * Отдача отложена не в мегабитах, а в долях канала — иначе цифра «412»
 * ничего не говорит, пока не вспомнишь ширину канала. По той же причине на
 * полотне нарисованы два порога: граница резерва и сам предел. Вопрос
 * «сколько ещё влезет» должен читаться глазом, без арифметики.
 *
 * Зрители идут второй линией по собственной шкале — их роль здесь
 * сопоставительная: видно, растёт ли отдача быстрее аудитории (значит,
 * зрители переключаются вверх по качеству).
 */
export function CapacityChart({
  points,
  uplinkMbps,
  headroomRatio,
}: {
  points: ChartPoint[];
  uplinkMbps: number;
  headroomRatio: number;
}) {
  const [hover, setHover] = useState<number | null>(null);

  const W = 1000;
  const H = 230;
  const PAD_B = 22;

  const { areaPath, linePath, maxViewers } = useMemo(() => {
    if (points.length < 2) return { areaPath: '', linePath: '', maxViewers: 1 };

    const maxV = Math.max(1, ...points.map((p) => p.viewers));
    const x = (i: number) => (i / (points.length - 1)) * W;
    // Шкала отдачи фиксирована каналом, а не максимумом данных: график,
    // который сам себя масштабирует, скрывает именно то, что мы измеряем.
    const yEgress = (mbps: number) => (H - PAD_B) * (1 - Math.min(1, mbps / uplinkMbps));
    const yViewers = (v: number) => (H - PAD_B) * (1 - v / maxV);

    const area =
      `M 0 ${H - PAD_B} ` +
      points.map((p, i) => `L ${x(i).toFixed(1)} ${yEgress(p.egressMbps).toFixed(1)}`).join(' ') +
      ` L ${W} ${H - PAD_B} Z`;

    const line = points
      .map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${yViewers(p.viewers).toFixed(1)}`)
      .join(' ');

    return { areaPath: area, linePath: line, maxViewers: maxV };
  }, [points, uplinkMbps]);

  const yFor = (ratio: number) => (H - PAD_B) * (1 - ratio);
  const active = hover != null ? points[hover] : points[points.length - 1];

  return (
    <div className="relative">
      <div className="flex items-center gap-4 mb-3 text-xs">
        <span className="flex items-center gap-1.5 text-zinc-400">
          <span className="w-2.5 h-2.5 rounded-sm bg-brand/60" />
          Отдача
        </span>
        <span className="flex items-center gap-1.5 text-zinc-400">
          <span className="w-2.5 h-[2px] bg-zinc-400" />
          Зрители
        </span>
        <span className="ml-auto text-zinc-500 tabular-nums">
          {active
            ? `${new Date(active.t).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })} · ${nf.format(active.viewers)} зрителей · ${nf.format(active.egressMbps)} Мбит/с`
            : null}
        </span>
      </div>

      <div className="relative">
        {/*
          Подписи порогов — обычным текстом поверх полотна, а не <text> внутри
          SVG: полотно растянуто по ширине (preserveAspectRatio="none"), и
          любые буквы внутри него растянулись бы вместе с ним.
        */}
        <div
          className="absolute left-0 right-0 flex justify-start pl-1 text-[10px] text-zinc-500 tabular-nums pointer-events-none"
          style={{ top: 1 }}
        >
          предел {nf.format(uplinkMbps)} Мбит/с
        </div>
        <div
          className="absolute left-0 right-0 flex justify-start pl-1 text-[10px] text-zinc-600 tabular-nums pointer-events-none"
          style={{ top: `${(H - PAD_B) * headroomRatio + 1}px` }}
        >
          резерв
        </div>

        <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="w-full h-[230px]"
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const box = e.currentTarget.getBoundingClientRect();
          const ratio = (e.clientX - box.left) / box.width;
          setHover(Math.max(0, Math.min(points.length - 1, Math.round(ratio * (points.length - 1)))));
        }}
      >
        <defs>
          <linearGradient id="egressFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#E54433" stopOpacity="0.45" />
            <stop offset="100%" stopColor="#E54433" stopOpacity="0.04" />
          </linearGradient>
        </defs>

        {/* Предел канала и граница резерва — читаются как «докуда можно». */}
        <line x1="0" y1={yFor(1)} x2={W} y2={yFor(1)} stroke="#52525b" strokeWidth="1" strokeDasharray="4 4" />
        <line
          x1="0"
          y1={yFor(1 - headroomRatio)}
          x2={W}
          y2={yFor(1 - headroomRatio)}
          stroke="#a1a1aa"
          strokeWidth="1"
          strokeDasharray="2 5"
          opacity="0.5"
        />

        <path d={areaPath} fill="url(#egressFill)" />
        <path
          d={areaPath}
          fill="none"
          stroke="#E54433"
          strokeWidth="1.5"
          vectorEffect="non-scaling-stroke"
        />
        <path
          d={linePath}
          fill="none"
          stroke="#a1a1aa"
          strokeWidth="1.5"
          strokeDasharray="3 3"
          vectorEffect="non-scaling-stroke"
        />

        {hover != null && (
          <line
            x1={(hover / (points.length - 1)) * W}
            y1="0"
            x2={(hover / (points.length - 1)) * W}
            y2={H - PAD_B}
            stroke="#e4e4e7"
            strokeWidth="1"
            opacity="0.35"
            vectorEffect="non-scaling-stroke"
          />
        )}
        </svg>
      </div>

      <div className="flex justify-between text-[11px] text-zinc-600 -mt-4 tabular-nums">
        <span>час назад</span>
        <span>пик зрителей за час: {nf.format(maxViewers)}</span>
        <span>сейчас</span>
      </div>
    </div>
  );
}
