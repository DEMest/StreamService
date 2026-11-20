/**
 * Статус схватки. В базе его нет намеренно: он выводится из `Bout.startedAt` и
 * `Bout.endedAt` здесь — и только здесь. По тем же двум полям режется запись
 * схватки из эфира ковра, и отдельная колонка статуса однажды сказала бы
 * «завершена» про схватку без времени конца.
 *
 * `endedAt` без `startedAt` — тоже «завершена»: организатор вправе ввести один
 * итог, не отмечая начало.
 */
export type BoutStatus = 'waiting' | 'live' | 'finished';

export function boutStatus(bout: { startedAt: Date | null; endedAt: Date | null }): BoutStatus {
  if (bout.endedAt) return 'finished';
  if (bout.startedAt) return 'live';
  return 'waiting';
}
