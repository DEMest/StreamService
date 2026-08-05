'use client';

import { useQuery } from '@tanstack/react-query';
import { HardDrives, Info } from '@phosphor-icons/react';
import { api } from '@/lib/api';

/** Ответ `GET /v1/org/storage` (см. OrgStorageDto в apps/api/src/org/org.service.ts). */
interface OrgStorage {
  disk: { totalBytes: number; freeBytes: number } | null;
  /** Почему disk может быть null: 'external' — архив во внешнем S3, 'unavailable' — замер не удался. */
  diskStatus: 'ok' | 'external' | 'unavailable';
  archive: { usedBytes: number; recordingsCount: number; durationSeconds: number };
  estimate: {
    bytesPerHour: number;
    bitrateMbps: number;
    fromHistory: boolean;
    hoursLeft: number | null;
  };
  retentionDays: number;
}

/**
 * Десятичные степени (ГБ = 10^9), а не двоичные: сервер меряет место так же
 * (`df`), и орге проще сверять число с тем, что показывает её собственный
 * файловый менеджер при выгрузке записи.
 */
function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 ГБ';
  const units = ['Б', 'КБ', 'МБ', 'ГБ', 'ТБ'];
  let i = Math.min(units.length - 1, Math.floor(Math.log10(bytes) / 3));
  let value = bytes / 1000 ** i;
  let digits = i >= 3 && value < 100 ? 1 : 0;
  // Округление способно перекатить значение через 1000: без этой поправки
  // 999 999 999 байт показались бы как «1000 МБ» вместо «1,0 ГБ».
  if (Number(value.toFixed(digits)) >= 1000 && i < units.length - 1) {
    i += 1;
    value = bytes / 1000 ** i;
    digits = value < 100 ? 1 : 0;
  }
  return `${value.toFixed(digits).replace('.', ',')} ${units[i]}`;
}

/** Часы → «13,5 ч» либо «6 сут 13 ч», когда счёт пошёл на сутки. */
function formatHours(hours: number): string {
  if (!Number.isFinite(hours) || hours <= 0) return '0 мин';
  if (hours < 1) {
    // 0.999 ч округляется до 60 минут — показываем как час, а не «60 мин».
    const minutes = Math.round(hours * 60);
    return minutes >= 60 ? '1,0 ч' : `${minutes} мин`;
  }
  if (hours < 48) return `${hours.toFixed(1).replace('.', ',')} ч`;
  // Округляем ДО разбора на сутки: иначе остаток 23.6 ч даёт «N сут 24 ч».
  const total = Math.round(hours);
  const days = Math.floor(total / 24);
  const rest = total % 24;
  return rest > 0 ? `${days} сут ${rest} ч` : `${days} сут`;
}

function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

/**
 * Тон полосы: пока свободно больше четверти тома — спокойный, дальше тревожный.
 * Штатный цвет — НЕ brand: brand у нас #E54433, то есть почти неотличим от
 * red-500, и критическое состояние переставало читаться. Светофор emerald →
 * amber → red однозначен.
 */
function barTone(freeRatio: number): { bar: string; text: string } {
  if (freeRatio < 0.1) return { bar: 'bg-red-500', text: 'text-red-300' };
  if (freeRatio < 0.25) return { bar: 'bg-amber-500', text: 'text-amber-300' };
  return { bar: 'bg-emerald-500', text: 'text-zinc-100' };
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex flex-col gap-0.5 p-3 rounded-lg bg-surface-primary border border-zinc-800/60">
      <span className="text-[11px] text-zinc-500">{label}</span>
      <span className="text-sm font-medium text-zinc-100 tabular-nums">{value}</span>
      {hint && <span className="text-[11px] text-zinc-600">{hint}</span>}
    </div>
  );
}

/**
 * Карточка «Хранилище» на дашборде орги: сколько места на диске сервера,
 * сколько занимает архив этой орги и на сколько ещё часов записи хватит
 * при её битрейте. Нужна, чтобы до начала трансляции понимать, поместится ли она.
 */
export function StorageCard() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['org-storage'],
    queryFn: () => api.get<OrgStorage>('/v1/org/storage'),
    // Диск делится со всеми оргами и с live-эфиром — за время сессии число
    // заметно уезжает, поэтому обновляем чаще, чем профиль.
    refetchInterval: 60_000,
  });

  const usedRatio = data?.disk && data.disk.totalBytes > 0
    ? Math.min(1, Math.max(0, (data.disk.totalBytes - data.disk.freeBytes) / data.disk.totalBytes))
    : 0;
  const usedPercent = Math.round(usedRatio * 100);
  const tone = barTone(1 - usedRatio);
  const bitrateLabel = String(data?.estimate.bitrateMbps ?? '').replace('.', ',');

  return (
    <section className="bg-surface-elevated border border-zinc-800/50 rounded-xl p-5">
      <h2 className="flex items-center gap-2 text-base font-medium text-zinc-300 mb-4">
        <HardDrives size={18} className="text-zinc-400" />
        Хранилище
      </h2>

      {isLoading && <p className="text-sm text-zinc-600">Загрузка…</p>}
      {/* Только когда показывать нечего: при сбое фонового refetch React Query
          отдаёт прошлые данные, и красная плашка над ними выглядела бы так,
          будто устаревшие цифры актуальны. */}
      {isError && !data && (
        <p className="text-sm text-red-400">Не удалось получить метрику хранилища</p>
      )}

      {data && (
        <div className="flex flex-col gap-4">
          {/* hoursLeft приходит null ровно тогда же, когда disk — проверяем оба,
              чтобы не рисовать шапку без главного числа. */}
          {data.disk && data.estimate.hoursLeft !== null && (
            <div className="flex flex-col gap-2">
              <div className="flex items-baseline gap-2 flex-wrap">
                <span className={`text-2xl font-semibold tabular-nums tracking-tight ${tone.text}`}>
                  {formatHours(data.estimate.hoursLeft)}
                </span>
                <span className="text-sm text-zinc-500">записи ещё поместится</span>
              </div>

              <div
                className="h-2 w-full rounded-full bg-zinc-800 overflow-hidden"
                role="progressbar"
                aria-label="Занято места на диске сервера"
                aria-valuenow={usedPercent}
                aria-valuemin={0}
                aria-valuemax={100}
              >
                <div
                  className={`h-full rounded-full ${tone.bar} transition-[width] duration-700 ease-out`}
                  style={{ width: `${(usedRatio * 100).toFixed(1)}%` }}
                />
              </div>

              <p className="text-xs text-zinc-500 tabular-nums">
                Свободно {formatBytes(data.disk.freeBytes)} из {formatBytes(data.disk.totalBytes)}
                <span className="text-zinc-600"> · занято {usedPercent}%</span>
              </p>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <Stat
              label="Ваш архив"
              value={formatBytes(data.archive.usedBytes)}
              hint={`${data.archive.recordingsCount} ${plural(
                data.archive.recordingsCount, 'запись', 'записи', 'записей',
              )} · ${formatHours(data.archive.durationSeconds / 3600)}`}
            />
            <Stat
              label="Расход"
              value={`${formatBytes(data.estimate.bytesPerHour)} / час`}
              hint={`поток ~${bitrateLabel} Мбит/с`}
            />
            <Stat
              label="Срок хранения"
              value={`${data.retentionDays} ${plural(data.retentionDays, 'день', 'дня', 'дней')}`}
              hint="дальше удаляется автоматически"
            />
          </div>

          <div className="flex items-start gap-2 text-[11px] text-zinc-600 leading-relaxed">
            <Info size={14} className="shrink-0 mt-px text-zinc-700" />
            <p>
              {/* Пояснение про удвоение нужно в ОБЕИХ ветках: иначе «3,6 ГБ/час»
                  рядом с «~4 Мбит/с» не сходится арифметически, а новая орга
                  видит именно ветку без истории. */}
              Час записи занимает вдвое больше самого видео: хранятся и поток для
              просмотра в браузере, и склеенный файл для скачивания.{' '}
              {data.estimate.fromHistory
                ? 'Расход посчитан по вашим прошлым записям.'
                : `Пока записей нет — прогноз по ~${bitrateLabel} Мбит/с, рекомендованному битрейту для 720p; после первой трансляции пересчитается по вашему реальному потоку.`}
              {data.disk &&
                ' Прогноз намеренно осторожный: во время выгрузки в архив запись какое-то время занимает место дважды, и в расчёте учтён технический резерв тома — поэтому часов выходит меньше, чем прямое деление свободного места. Диск общий для всех организаций сервиса и для эфира, идущего прямо сейчас.'}
              {data.diskStatus === 'external' &&
                ' Архив хранится во внешнем хранилище — свободное место сервером не измеряется.'}
              {data.diskStatus === 'unavailable' &&
                ' Свободное место сейчас измерить не удалось — показан только объём вашего архива. Если это не пройдёт само, сообщите администратору.'}
            </p>
          </div>
        </div>
      )}
    </section>
  );
}
