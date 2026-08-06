/**
 * Арифметика метрики хранилища для дашборда орги. Вынесена отдельным модулем
 * (чистые функции, без Prisma/fs) — коэффициенты лежат в одном месте и
 * покрываются юнит-тестами без поднятия Nest-контекста.
 */

/**
 * Реальный след записи в S3 = сегменты `slot-1/` + склеенный `download.mp4`,
 * который RecordingService собирает из тех же сегментов через `-c copy`
 * (buildDownloadMp4) — то есть байт в нём столько же. При этом
 * `Recording.fileSize` считается ТОЛЬКО по `slot-1/` (см. комментарий в
 * convertRecording), поэтому для метрики занятого места его удваиваем.
 *
 * ВНИМАНИЕ на будущее: множитель верен, пока на broadcast приходится один
 * Recording — `onStreamEnded` жёстко создаёт `slotIndex: 1`. Если появится
 * multistream с несколькими слотами, в S3 будет лежать `ΣS_i + S_1` (склейка
 * download.mp4 одна на broadcast), а не `2·ΣS_i`, и метрика начнёт завышать.
 */
export const ARCHIVE_OVERHEAD = 2;

/**
 * Резерв на всё, что делит том с архивом: live-HLS (`/hls`), scratch записи до
 * заливки в S3 (`/recordings`), postgres и образы docker. Показывать орге
 * «свободно» вплоть до нуля нельзя — забитый под ноль том роняет весь стек,
 * а не только запись.
 */
export const DISK_RESERVE_BYTES = 50 * 1024 ** 3;

/**
 * Пик расхода в момент финализации записи, в единицах ARCHIVE_OVERHEAD.
 *
 * `uploadAndFinalize` (recording.service.ts) сначала копирует готовый
 * broadcastDir в S3 — а MinIO хранит объекты в томе `minio_data` на ТОМ ЖЕ
 * разделе — и только ПОСЛЕ успешной заливки делает `rmSync` локального
 * scratch. То есть какое-то время запись занимает место дважды: 2×
 * установившегося следа. Прогноз обязан считать по пику, иначе орга упрётся
 * в ENOSPC внутри uploadDirectory ровно в том же сценарии «после эфира, когда
 * уже поздно», ради которого fileSize переводили в BigInt.
 */
export const FINALIZE_PEAK_FACTOR = 2;

/**
 * Битрейт для прогноза, пока у орги нет ни одной готовой записи: 4 Мбит/с —
 * верх рекомендованного орге коридора для 720p30. Запись идёт copy-копией
 * входящего потока, так что битрейт пуша = битрейт архива.
 */
export const DEFAULT_BITRATE_MBPS = 4;

/**
 * Ниже этого суммарного хронометража средний битрейт по истории орги слишком
 * шумный (пара тестовых включений на минуту), — берём DEFAULT_BITRATE_MBPS.
 */
export const MIN_HISTORY_SECONDS = 600;

const SECONDS_PER_HOUR = 3600;

/** Байт архива на час эфира при заданном битрейте потока (Мбит/с). */
export function bytesPerHourAt(bitrateMbps: number): number {
  return Math.round(((bitrateMbps * 1e6) / 8) * SECONDS_PER_HOUR * ARCHIVE_OVERHEAD);
}

/** Обратное преобразование: из «байт на час архива» в битрейт потока, Мбит/с. */
export function bitrateFromBytesPerHour(bytesPerHour: number): number {
  return (bytesPerHour * 8) / ARCHIVE_OVERHEAD / SECONDS_PER_HOUR / 1e6;
}

export interface HourlyRate {
  bytesPerHour: number;
  bitrateMbps: number;
  /** true — посчитано по записям самой орги, false — взят DEFAULT_BITRATE_MBPS. */
  fromHistory: boolean;
}

/**
 * Расход на час записи: по собственной истории орги, если её достаточно,
 * иначе по дефолтному битрейту. `usedBytes` — уже с учётом ARCHIVE_OVERHEAD.
 */
export function hourlyRate(usedBytes: number, durationSeconds: number): HourlyRate {
  if (durationSeconds >= MIN_HISTORY_SECONDS && usedBytes > 0) {
    const bytesPerHour = Math.round((usedBytes / durationSeconds) * SECONDS_PER_HOUR);
    return { bytesPerHour, bitrateMbps: bitrateFromBytesPerHour(bytesPerHour), fromHistory: true };
  }
  return {
    bytesPerHour: bytesPerHourAt(DEFAULT_BITRATE_MBPS),
    bitrateMbps: DEFAULT_BITRATE_MBPS,
    fromHistory: false,
  };
}

/**
 * Сколько часов записи ещё влезет: свободное место за вычетом резерва,
 * делённое на пиковый часовой расход. Отрицательный остаток → 0 (диск уже
 * в резерве).
 *
 * Считаем по пику (FINALIZE_PEAK_FACTOR), а не по установившемуся следу:
 * число должно отвечать на вопрос орги «моя трансляция доедет до архива?»,
 * а самый узкий момент — это заливка, когда запись лежит на томе дважды.
 * Занижать здесь безопасно, завышать — нет.
 */
export function hoursLeft(freeBytes: number, bytesPerHour: number): number {
  if (bytesPerHour <= 0) return 0;
  const usable = Math.max(0, freeBytes - DISK_RESERVE_BYTES);
  // floor, а не round: округление вверх обещало бы орге на десятые доли часа
  // больше, чем физически влезает. Для числа, по которому решают «начинать ли
  // трансляцию», единственное безопасное направление — вниз.
  return Math.floor((usable / (bytesPerHour * FINALIZE_PEAK_FACTOR)) * 10) / 10;
}
