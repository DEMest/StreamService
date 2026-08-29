'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowLeft, Users, Gauge, WarningCircle, CheckCircle, Lightning, Flask, Clock,
  Cpu, Memory, HardDrives, ArrowsDownUp,
} from '@phosphor-icons/react';
import { api } from '@/lib/api';
import { PublicLayout } from '@/components/PublicLayout';
import { CapacityChart } from './CapacityChart';

interface RenditionShare {
  key: string;
  label: string;
  bitrateMbps: number;
  viewers: number;
  share: number;
}

interface Incident {
  id: string;
  kind: 'uplink' | 'encode' | 'errors' | 'stalls' | 'offline';
  severity: 'warn' | 'crit';
  title: string;
  startedAt: number;
  endedAt: number | null;
  peak: string;
}

interface HostDisk {
  path: string;
  label: string;
  totalBytes: number;
  freeBytes: number;
  usage: number;
}

interface HostMetrics {
  cpu: { cores: number; usage: number | null; loadAvg1: number | null };
  memory: { totalBytes: number; usedBytes: number; usage: number };
  disks: HostDisk[];
  net: { rxMbps: number; txMbps: number; errors: number; dropped: number } | null;
  uptimeSeconds: number;
}

interface Snapshot {
  uplinkMbps: number;
  headroomRatio: number;
  viewers: number;
  egressMbps: number;
  utilization: number;
  avgPerViewerMbps: number | null;
  ceilingViewers: number | null;
  ceilingBasis: 'measured' | 'assumed';
  renditions: RenditionShare[];
  health: {
    cacheHitRatio: number;
    errorRate: number;
    encodeSpeed: number | null;
    stallRatio: number;
  };
  host: HostMetrics;
  history: Array<{ t: number; viewers: number; egressMbps: number }>;
  incidents: Incident[];
  demo: boolean;
}

const nf = new Intl.NumberFormat('ru-RU');
const pct = (v: number, digits = 0) => `${(v * 100).toFixed(digits)}%`;

/** Цвет заполнения канала. Порог тревоги совпадает с границей резерва. */
function loadTone(utilization: number, headroom: number) {
  if (utilization >= 1 - headroom) return { bar: 'bg-brand', text: 'text-brand' };
  if (utilization >= (1 - headroom) * 0.75) return { bar: 'bg-amber-500', text: 'text-amber-400' };
  return { bar: 'bg-emerald-500', text: 'text-emerald-400' };
}

function since(ts: number) {
  const min = Math.max(1, Math.round((Date.now() - ts) / 60_000));
  return min < 60 ? `${min} мин назад` : `${Math.round(min / 60)} ч назад`;
}

export default function CapacityPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['admin-capacity'],
    queryFn: () => api.get<Snapshot>('/v1/admin/capacity'),
    refetchInterval: 10_000,
  });

  return (
    <PublicLayout>
      <div className="max-w-[1100px] mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-8 flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <Link
              href="/admin"
              className="flex items-center justify-center w-9 h-9 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg transition-colors no-underline"
              aria-label="Назад в админку"
            >
              <ArrowLeft size={16} weight="bold" />
            </Link>
            <div>
              <h1 className="text-xl font-semibold text-zinc-50 tracking-tight">Ёмкость сервера</h1>
              <p className="text-xs text-zinc-500 mt-0.5">
                Сколько зрителей выдержит канал при том качестве, которое они выбирают сами
              </p>
            </div>
          </div>
          {data?.demo && (
            <span className="flex items-center gap-2 px-3 py-1.5 bg-amber-500/10 border border-amber-500/30 text-amber-400 text-xs font-medium rounded-lg">
              <Flask size={14} weight="bold" />
              Данные стенда, не реальные
            </span>
          )}
        </div>

        {isLoading || !data ? (
          <div className="h-64 bg-surface-elevated border border-zinc-800 rounded-xl animate-pulse" />
        ) : (
          <div className="flex flex-col gap-4">
            <HeadlineCard data={data} />

            <section className="bg-surface-elevated border border-zinc-800 rounded-xl p-5">
              <h2 className="text-sm font-medium text-zinc-300 mb-4">Последний час</h2>
              <CapacityChart
                points={data.history}
                uplinkMbps={data.uplinkMbps}
                headroomRatio={data.headroomRatio}
              />
            </section>

            <div className="grid md:grid-cols-2 gap-4">
              <RenditionCard renditions={data.renditions} total={data.viewers} />
              <HealthCard health={data.health} />
            </div>

            <HostCard host={data.host} demo={data.demo} />

            <IncidentsCard incidents={data.incidents} />
          </div>
        )}
      </div>
    </PublicLayout>
  );
}

/**
 * Главный блок. Ради этой цифры всё и делалось, поэтому она набрана крупнее
 * всего остального, а рядом сразу стоит оговорка, из чего она получена —
 * потолок, снятый с трёх зрителей, и потолок, снятый с трёхсот, стоят разного.
 */
function HeadlineCard({ data }: { data: Snapshot }) {
  const tone = loadTone(data.utilization, data.headroomRatio);
  const reserveAt = 1 - data.headroomRatio;

  return (
    <section className="bg-surface-elevated border border-zinc-800 rounded-xl p-6">
      <div className="grid md:grid-cols-[minmax(0,340px)_1fr] gap-8 items-center">
        <div>
          <div className="text-xs text-zinc-500 mb-1.5">Потолок при текущем миксе качеств</div>
          <div className="flex items-baseline gap-2">
            <span className="text-5xl font-semibold text-zinc-50 tabular-nums tracking-tight">
              {data.ceilingViewers != null ? nf.format(data.ceilingViewers) : '—'}
            </span>
            <span className="text-lg text-zinc-500">зрителей</span>
          </div>
          <p className="text-xs text-zinc-500 mt-2 leading-relaxed">
            {data.avgPerViewerMbps != null ? (
              <>
                Средний зритель весит{' '}
                <span className="text-zinc-300 tabular-nums">{data.avgPerViewerMbps} Мбит/с</span>
                {data.ceilingBasis === 'measured'
                  ? ' — посчитано по фактической отдаче.'
                  : ' — оценка по лесенке качеств: зрителей пока мало для замера.'}
              </>
            ) : (
              'Зрителей нет — считать вес зрителя не из чего.'
            )}
          </p>
        </div>

        <div>
          <div className="flex items-baseline justify-between mb-2">
            <span className="text-xs text-zinc-500">Занято канала</span>
            <span className={`text-2xl font-semibold tabular-nums ${tone.text}`}>
              {pct(data.utilization)}
            </span>
          </div>

          <div className="relative h-3 bg-zinc-800 rounded-full overflow-hidden">
            <div
              className={`absolute inset-y-0 left-0 ${tone.bar} rounded-full transition-[width] duration-500`}
              style={{ width: `${Math.min(100, data.utilization * 100)}%` }}
            />
            {/* Отметка резерва: за ней канал ещё есть, но запаса на всплеск уже нет. */}
            <div
              className="absolute -inset-y-1 w-0.5 bg-zinc-200 rounded-full"
              style={{ left: `${reserveAt * 100}%` }}
            />
          </div>

          <div className="flex justify-between text-[11px] text-zinc-600 mt-1.5 tabular-nums">
            <span>0</span>
            <span>резерв с {pct(reserveAt)}</span>
            <span>{data.uplinkMbps} Мбит/с</span>
          </div>

          <div className="flex gap-6 mt-5">
            <Metric icon={<Users size={14} weight="bold" />} label="Зрителей сейчас" value={nf.format(data.viewers)} />
            <Metric icon={<Gauge size={14} weight="bold" />} label="Отдача" value={`${nf.format(data.egressMbps)} Мбит/с`} />
          </div>
        </div>
      </div>
    </section>
  );
}

function Metric({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div>
      <div className="flex items-center gap-1.5 text-zinc-500 text-[11px] mb-1">
        {icon}
        {label}
      </div>
      <div className="text-lg font-medium text-zinc-200 tabular-nums">{value}</div>
    </div>
  );
}

/**
 * Микс качеств. Это не справка, а множитель в формуле потолка: сдвиг зрителей
 * на ступень вниз меняет вместимость сервера в разы.
 */
function RenditionCard({ renditions, total }: { renditions: RenditionShare[]; total: number }) {
  return (
    <section className="bg-surface-elevated border border-zinc-800 rounded-xl p-5">
      <h2 className="text-sm font-medium text-zinc-300">Кто на каком качестве</h2>
      <p className="text-xs text-zinc-500 mt-1 mb-4">Определяет потолок сильнее, чем что-либо ещё</p>

      <div className="flex flex-col gap-3">
        {renditions.map((r, i) => (
          <div key={r.key}>
            <div className="flex items-baseline justify-between text-xs mb-1.5">
              <span className="text-zinc-300">
                {r.label}
                <span className="text-zinc-600 ml-2 tabular-nums">{r.bitrateMbps} Мбит/с</span>
              </span>
              <span className="text-zinc-400 tabular-nums">
                {nf.format(r.viewers)}
                <span className="text-zinc-600 ml-2">{pct(r.share)}</span>
              </span>
            </div>
            <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
              {/*
                Яркость полосы падает вместе с весом ступени: тяжёлые качества
                должны бросаться в глаза, потому что именно они съедают канал.
              */}
              <div
                className={`h-full rounded-full transition-[width] duration-500 ${
                  ['bg-zinc-100', 'bg-zinc-400', 'bg-zinc-600', 'bg-zinc-700'][i] ?? 'bg-zinc-600'
                }`}
                style={{ width: `${r.share * 100}%` }}
              />
            </div>
          </div>
        ))}
      </div>

      {total > 0 && (
        <p className="text-[11px] text-zinc-600 mt-4 leading-relaxed">
          Если сдвинуть всех на 480p, тот же канал вместит примерно в{' '}
          {(renditions.reduce((a, r) => a + r.bitrateMbps * r.share, 0) / 1.4).toFixed(1)} раза больше зрителей.
        </p>
      )}
    </section>
  );
}

function HealthCard({ health }: { health: Snapshot['health'] }) {
  const items = [
    {
      label: 'Попадания в кэш',
      value: pct(health.cacheHitRatio),
      ok: health.cacheHitRatio >= 0.85,
      hint: 'Промахи бьют по API напрямую',
    },
    {
      label: 'Ошибки ответов',
      value: pct(health.errorRate, 1),
      ok: health.errorRate < 0.01,
      hint: '429 и 5xx — отказы зрителям',
    },
    {
      label: 'Скорость кодирования',
      value: health.encodeSpeed != null ? health.encodeSpeed.toFixed(2) : '—',
      ok: health.encodeSpeed == null || health.encodeSpeed >= 0.95,
      hint: 'Ниже 1.0 — процессор не успевает',
    },
    {
      label: 'Зрители с подвисаниями',
      value: pct(health.stallRatio),
      ok: health.stallRatio < 0.05,
      hint: 'Единственный честный признак «плохо»',
    },
  ];

  return (
    <section className="bg-surface-elevated border border-zinc-800 rounded-xl p-5">
      <h2 className="text-sm font-medium text-zinc-300">Самочувствие</h2>
      <p className="text-xs text-zinc-500 mt-1 mb-4">Что упрётся первым, если давить дальше</p>

      <div className="grid grid-cols-2 gap-3">
        {items.map((it) => (
          <div key={it.label} className="bg-surface-card border border-zinc-800 rounded-lg p-3">
            <div className="flex items-center gap-1.5 mb-1">
              {it.ok ? (
                <CheckCircle size={13} weight="fill" className="text-emerald-500 shrink-0" />
              ) : (
                <WarningCircle size={13} weight="fill" className="text-amber-500 shrink-0" />
              )}
              <span className="text-[11px] text-zinc-500 leading-tight">{it.label}</span>
            </div>
            <div className="text-lg font-medium text-zinc-200 tabular-nums">{it.value}</div>
            <div className="text-[10px] text-zinc-600 mt-0.5 leading-tight">{it.hint}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

const gb = (bytes: number) => `${(bytes / 1024 ** 3).toFixed(bytes > 100 * 1024 ** 3 ? 0 : 1)} ГБ`;

/** Тон полосы заполнения: одинаковые пороги для процессора, памяти и диска. */
function useTone(usage: number) {
  if (usage >= 0.9) return 'bg-brand';
  if (usage >= 0.75) return 'bg-amber-500';
  return 'bg-emerald-500';
}

function Bar({ usage }: { usage: number }) {
  return (
    <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden mt-2">
      <div
        className={`h-full rounded-full transition-[width] duration-500 ${useTone(usage)}`}
        style={{ width: `${Math.min(100, usage * 100)}%` }}
      />
    </div>
  );
}

/**
 * Железо сервера.
 *
 * Эти цифры настоящие всегда — их отдаёт сама машина, а не источник трафика.
 * Поэтому на стенде блок специально не помечен как выдуманный: рядом с
 * синтетической нагрузкой это единственное, чему можно верить.
 */
function HostCard({ host, demo }: { host: HostMetrics; demo: boolean }) {
  const days = Math.floor(host.uptimeSeconds / 86_400);
  const hours = Math.floor((host.uptimeSeconds % 86_400) / 3600);

  return (
    <section className="bg-surface-elevated border border-zinc-800 rounded-xl p-5">
      <div className="flex items-baseline justify-between flex-wrap gap-2 mb-1">
        <h2 className="text-sm font-medium text-zinc-300">Железо сервера</h2>
        <span className="text-[11px] text-zinc-600 tabular-nums">
          без перезагрузки {days > 0 ? `${days} д ` : ''}
          {hours} ч
        </span>
      </div>
      <p className="text-xs text-zinc-500 mb-4">
        {demo ? 'Единственные настоящие цифры на этом экране — их отдаёт сама машина' : 'Счётчики хоста, снятые напрямую'}
      </p>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-surface-card border border-zinc-800 rounded-lg p-3">
          <div className="flex items-center gap-1.5 text-[11px] text-zinc-500 mb-1">
            <Cpu size={13} weight="bold" />
            Процессор
          </div>
          <div className="text-lg font-medium text-zinc-200 tabular-nums">
            {host.cpu.usage != null ? pct(host.cpu.usage) : '—'}
          </div>
          <div className="text-[10px] text-zinc-600 mt-0.5">
            {host.cpu.cores} ядер
            {host.cpu.loadAvg1 != null && ` · нагрузка ${host.cpu.loadAvg1}`}
          </div>
          <Bar usage={host.cpu.usage ?? 0} />
        </div>

        <div className="bg-surface-card border border-zinc-800 rounded-lg p-3">
          <div className="flex items-center gap-1.5 text-[11px] text-zinc-500 mb-1">
            <Memory size={13} weight="bold" />
            Память
          </div>
          <div className="text-lg font-medium text-zinc-200 tabular-nums">{pct(host.memory.usage)}</div>
          <div className="text-[10px] text-zinc-600 mt-0.5 tabular-nums">
            {gb(host.memory.usedBytes)} из {gb(host.memory.totalBytes)}
          </div>
          <Bar usage={host.memory.usage} />
        </div>

        {host.disks.map((d) => (
          <div key={d.path} className="bg-surface-card border border-zinc-800 rounded-lg p-3">
            <div className="flex items-center gap-1.5 text-[11px] text-zinc-500 mb-1">
              <HardDrives size={13} weight="bold" />
              {d.label}
            </div>
            <div className="text-lg font-medium text-zinc-200 tabular-nums">{pct(d.usage)}</div>
            <div className="text-[10px] text-zinc-600 mt-0.5 tabular-nums">
              свободно {gb(d.freeBytes)}
            </div>
            <Bar usage={d.usage} />
          </div>
        ))}

        <div className="bg-surface-card border border-zinc-800 rounded-lg p-3">
          <div className="flex items-center gap-1.5 text-[11px] text-zinc-500 mb-1">
            <ArrowsDownUp size={13} weight="bold" />
            Сетевая карта
          </div>
          {host.net ? (
            <>
              <div className="text-lg font-medium text-zinc-200 tabular-nums">
                {nf.format(host.net.txMbps)}
                <span className="text-xs text-zinc-500 ml-1">Мбит/с</span>
              </div>
              <div className="text-[10px] text-zinc-600 mt-0.5 tabular-nums">
                входящий {nf.format(host.net.rxMbps)} Мбит/с
              </div>
              {/*
                Потери и ошибки показываем, только когда они есть: нули в этой
                строке приучили бы не читать её вовсе, а появление ненулевого
                значения должно бросаться в глаза.
              */}
              {(host.net.dropped > 0 || host.net.errors > 0) && (
                <div className="text-[10px] text-amber-400 mt-1 tabular-nums leading-tight">
                  потери {nf.format(host.net.dropped)} · ошибки {nf.format(host.net.errors)}
                </div>
              )}
            </>
          ) : (
            <>
              <div className="text-lg font-medium text-zinc-600">—</div>
              <div className="text-[10px] text-zinc-600 mt-0.5">счётчики только на Linux</div>
            </>
          )}
        </div>
      </div>

      {host.disks.length === 0 && (
        <p className="text-[11px] text-zinc-600 mt-3">
          Разделы для записей и живого HLS не смонтированы — на сервере они появятся.
        </p>
      )}
    </section>
  );
}

function IncidentsCard({ incidents }: { incidents: Incident[] }) {
  return (
    <section className="bg-surface-elevated border border-zinc-800 rounded-xl p-5">
      <h2 className="text-sm font-medium text-zinc-300">Моменты падения</h2>
      <p className="text-xs text-zinc-500 mt-1 mb-4">
        Открываются и закрываются автоматически, дублируются письмом
      </p>

      {incidents.length === 0 ? (
        <div className="flex items-center gap-2 text-sm text-zinc-500 py-6 justify-center">
          <CheckCircle size={16} weight="fill" className="text-emerald-600" />
          Инцидентов не было
        </div>
      ) : (
        <div className="flex flex-col divide-y divide-zinc-800/70">
          {incidents.map((it) => (
            <div key={it.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
              <div
                className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                  it.severity === 'crit' ? 'bg-brand/15 text-brand' : 'bg-amber-500/10 text-amber-400'
                }`}
              >
                <Lightning size={15} weight="fill" />
              </div>

              <div className="min-w-0 flex-1">
                <div className="text-sm text-zinc-200 truncate">{it.title}</div>
                <div className="flex items-center gap-2 text-[11px] text-zinc-500 mt-0.5">
                  <Clock size={11} />
                  {since(it.startedAt)}
                  <span className="text-zinc-700">·</span>
                  {it.endedAt
                    ? `длился ${Math.max(1, Math.round((it.endedAt - it.startedAt) / 60_000))} мин`
                    : 'идёт сейчас'}
                </div>
              </div>

              <div className="text-xs text-zinc-400 tabular-nums shrink-0">{it.peak}</div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
