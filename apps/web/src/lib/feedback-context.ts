export interface StreamContext {
  orgSlug?: string;
  streamSlug?: string;
}

/**
 * Вытаскивает орга/стрим из адреса страницы, чтобы обращение из шапки сайта
 * всё равно знало, о каком эфире речь. Кнопка у плеера передаёт слаги явными
 * пропсами — они точнее и имеют приоритет.
 *
 * Дефолтный Stream орги (slug='') живёт на `/watch/<org>` без второго сегмента,
 * поэтому streamSlug там честно остаётся пустым.
 */
export function deriveStreamContext(pathname: string): StreamContext {
  const parts = pathname.split('/').filter(Boolean);
  if (parts.length < 2) return {};

  const [section, orgSlug, third] = parts;
  if (section !== 'watch' && section !== 'event') return {};
  if (!orgSlug) return {};

  // `/watch/<org>/archive` — архив дефолтного стрима, а не стрим с таким слагом.
  const streamSlug = section === 'watch' && third && third !== 'archive' ? third : undefined;
  return { orgSlug, streamSlug };
}
