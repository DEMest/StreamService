import { randomBytes, timingSafeEqual } from 'crypto';

/**
 * Правила доступа к приватному Stream'у — одни на все ручки (watch, live HLS,
 * архив, превью, чат), чтобы ни одна из них не оказалась обходным путём.
 *
 * Приватный режим нужен организации, чтобы проверить качество эфира без
 * зрителей. Поэтому для медиа (live HLS и архив) ключ — часть АДРЕСА, а не
 * query-параметр: приватный Stream отдаётся только по `…/private/<key>/…`,
 * публичный — только по обычному адресу. Переключение режима в любую сторону
 * гасит прежний адрес целиком, а не «пока кто-нибудь не допишет ?key=».
 *
 * Ключ в пути заодно чинит воспроизведение: hls.js и нативный HLS на iOS
 * резолвят относительные адреса вложенных плейлистов и сегментов против
 * адреса master.m3u8 и query при этом теряют — с `?key=` приватный эфир
 * отдавал master, а на первом же `hd/index.m3u8` получал 404 (чёрный экран).
 */
export interface StreamVisibility {
  isPublic: boolean;
  previewKey: string | null;
}

/** Новый ключ приватной ссылки: 256 бит, перебором не подобрать. */
export function newPreviewKey(): string {
  return randomBytes(32).toString('hex');
}

/** Сравнение ключа за постоянное время: по таймингу ответа ключ не угадать. */
export function previewKeyMatches(expected: string | null | undefined, given: string | null | undefined): boolean {
  if (!expected || !given) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Метаданные (watch-страница, список записей, превью, чат): публичный Stream
 * виден всем, приватный — только с верным ключом. Лишний ключ у публичного
 * не мешает: ссылка из приватной сессии продолжает открывать страницу, когда
 * стрим стал публичным.
 */
export function canView(stream: StreamVisibility, key?: string | null): boolean {
  return stream.isPublic || previewKeyMatches(stream.previewKey, key);
}

/**
 * Медиа (live HLS, архив): адрес обязан совпадать с режимом Stream'а.
 * `pathKey === undefined` — обычный адрес; он открыт только у публичного.
 * Адрес с ключом открыт только у приватного и только с текущим ключом.
 */
export function canServeMedia(stream: StreamVisibility, pathKey: string | undefined): boolean {
  if (pathKey === undefined) return stream.isPublic;
  return !stream.isPublic && previewKeyMatches(stream.previewKey, pathKey);
}

/**
 * Префикс медиа-адресов Stream'а, который получает плеер. Адрес собирает
 * сервер, а не клиент: только он знает текущий режим, и зритель со старой
 * приватной ссылкой на уже публичный стрим получит рабочий публичный адрес.
 *
 * `streamSlug=''` — дефолтный Stream орги, у него адреса без `/streams/<slug>`.
 */
export function mediaUrlPrefix(orgSlug: string, streamSlug: string, stream: StreamVisibility): string {
  const base = streamSlug
    ? `/api/v1/public/orgs/${orgSlug}/streams/${streamSlug}`
    : `/api/v1/public/orgs/${orgSlug}`;
  return stream.isPublic ? base : `${base}/private/${stream.previewKey}`;
}
