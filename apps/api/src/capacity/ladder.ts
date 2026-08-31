import { RenditionShare } from './capacity.types';

/**
 * Ступени лесенки качеств — зеркало того, что создаёт
 * `infra/mediamtx/on-ready.sh`.
 *
 * `key` — это ИМЯ КАТАЛОГА, а не произвольная метка: по нему разбирается путь
 * сегмента в логе nginx, и разъехавшись с каталогами, разбор молча перестанет
 * узнавать качества — микс схлопнется в «неизвестно» без единой ошибки.
 *
 * Живёт отдельным файлом, а не внутри `demo-source.ts`: это данные прод-пути,
 * и прод не должен зависеть от модуля со стендовой синтетикой.
 *
 * `bitrateMbps` — заявленный BANDWIDTH из master.m3u8, то есть вес одного
 * зрителя на этой ступени.
 */
export const LADDER: Array<Omit<RenditionShare, 'viewers' | 'share'>> = [
  { key: 'hd', label: 'Оригинал', bitrateMbps: 6.5 },
  { key: 'p720', label: '720p', bitrateMbps: 3.0 },
  { key: 'p480', label: '480p', bitrateMbps: 1.4 },
  { key: 'p240', label: '240p', bitrateMbps: 0.5 },
];

/** Ступень, к которой относим зрителя по высоте кадра. */
export const LADDER_BY_HEIGHT: Array<{ minHeight: number; key: string }> = [
  { minHeight: 900, key: 'hd' },
  { minHeight: 620, key: 'p720' },
  { minHeight: 380, key: 'p480' },
  { minHeight: 1, key: 'p240' },
];
