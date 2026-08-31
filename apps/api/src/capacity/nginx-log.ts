import { LADDER } from './ladder';

/**
 * Разбор строки access-лога nginx.
 *
 * Формат задан нами (см. {@link CAPACITY_LOG_FORMAT}) с разделителем `|`:
 * combined пришлось бы разбирать регуляркой с кавычками и экранированием, а
 * нам нужны ровно шесть полей и ни одного лишнего.
 *
 * Здесь только разбор — чтение файла живёт в `log-tailer.ts`. Так парсер
 * проверяется тестами без файловой системы и без ротации.
 *
 * Почему лог, а не счётчики в API: кэш nginx закрывает большинство запросов
 * сегментов и до API они просто не доходят. Байты, отданные зрителям, видны
 * только здесь.
 */

export interface AccessLogEntry {
  /** unix ms */
  at: number;
  status: number;
  /** Тело ответа, байт. Именно оно уходит в канал. */
  bytes: number;
  requestMs: number;
  /** Промах отличаем от «кэш вообще не применялся»: это разные болезни. */
  cache: 'hit' | 'miss' | 'other';
  orgSlug: string;
  /** Пустая строка — дефолтный стрим организации. */
  streamSlug: string;
  /** Каталог качества (`hd`, `p720`…) либо null для плейлистов и незнакомых. */
  rendition: string | null;
  kind: 'segment' | 'playlist' | 'other';
}

/**
 * Строка `log_format` для nginx. Живёт рядом с парсером намеренно: разъехавшись,
 * они молча перестанут понимать друг друга — метрики обнулятся, а ошибки не
 * будет нигде.
 */
export const CAPACITY_LOG_FORMAT =
  "log_format capacity '$time_iso8601|$status|$body_bytes_sent|$request_time|$upstream_cache_status|$request_uri';";

const KNOWN_RENDITIONS = new Set(LADDER.map((r) => r.key));

/**
 * Адрес живого HLS. `streamSlug` допускает пустоту (`[^/?]*`, а не `+`): у
 * дефолтного стрима организации slug именно пустой, и адрес получается с
 * двойным слэшем. Требование непустого сегмента выкинуло бы весь трафик таких
 * стримов из статистики.
 */
const HLS_URI = /^\/api\/v1\/public\/orgs\/([^/?]+)\/streams\/([^/?]*)\/live\/hls\/(.+)$/;

export function parseAccessLogLine(line: string): AccessLogEntry | null {
  const parts = line.trim().split('|');
  if (parts.length < 6) return null;

  const [ts, statusRaw, bytesRaw, timeRaw, cacheRaw, ...uriParts] = parts;
  // URI мог содержать разделитель — собираем хвост обратно, а не теряем его.
  const uri = uriParts.join('|');

  const m = HLS_URI.exec(uri);
  if (!m) return null;

  const at = Date.parse(ts);
  if (Number.isNaN(at)) return null;

  const [, orgSlug, streamSlug, tail] = m;
  const path = tail.split('?')[0];
  const segments = path.split('/');
  const file = segments[segments.length - 1];
  const dir = segments.length > 1 ? segments[segments.length - 2] : null;

  const kind: AccessLogEntry['kind'] = file.endsWith('.ts')
    ? 'segment'
    : file.endsWith('.m3u8')
      ? 'playlist'
      : 'other';

  const cacheUpper = cacheRaw.toUpperCase();
  // EXPIRED — это тоже поход в апстрим, то есть промах по сути.
  // Прочерк означает, что кэш к локации вообще не применялся: считать это
  // промахом нельзя, иначе доля попаданий занизится на ровном месте.
  const cache: AccessLogEntry['cache'] =
    cacheUpper === 'HIT' ? 'hit' : cacheUpper === 'MISS' || cacheUpper === 'EXPIRED' ? 'miss' : 'other';

  return {
    at,
    status: Number(statusRaw) || 0,
    bytes: Number(bytesRaw) || 0,
    requestMs: Math.round((Number(timeRaw) || 0) * 1000),
    cache,
    orgSlug,
    streamSlug,
    rendition: dir && KNOWN_RENDITIONS.has(dir) ? dir : null,
    kind,
  };
}
