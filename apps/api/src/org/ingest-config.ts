/**
 * Параметры подключения энкодера (vMix/OBS), которые дашборд показывает
 * стримеру: куда пушить SRT/RTMP.
 *
 * Раньше это были три build-time переменные `NEXT_PUBLIC_SERVER_IP`,
 * `NEXT_PUBLIC_SRT_PORT`, `NEXT_PUBLIC_RTMP_PORT`: Next.js зашивает `NEXT_PUBLIC_*`
 * в клиентский бандл на СБОРКЕ, поэтому переезд на другой сервер требовал не
 * правки конфига, а пересборки образа web. Теперь значения приезжают в рантайме
 * через `GET /v1/org/ingest-config`, и образ web стал независимым от адреса.
 */
export interface IngestConfigDto {
  /**
   * null — сознательный и основной режим работы: фронт подставит хост, на
   * котором открыт дашборд (`window.location.hostname`). Для типового
   * развёртывания «всё на одной машине за одним доменом» это верно всегда и
   * не требует ни одной настройки.
   *
   * Непустым host становится только когда ингест физически не там, где
   * веб-морда: отдельный медиа-сервер, обращение по IP в обход CDN и т.п.
   */
  host: string | null;
  srtPort: number;
  rtmpPort: number;
}

/** Совпадают с дефолтами публикации портов в docker-compose.yml. */
export const DEFAULT_SRT_PORT = 8890;
export const DEFAULT_RTMP_PORT = 1935;

/**
 * INGEST_HOST задаётся как голое имя хоста, но в конфиг легко скопировать
 * готовый URL целиком. Схему и всё после хоста отбрасываем: строку
 * `srt://cdn.example.com:8890/` пользователь имел в виду как `cdn.example.com`,
 * а не как повод показать стримеру нерабочий адрес.
 */
function normalizeHost(raw: string | undefined): string | null {
  const trimmed = raw?.trim();
  if (!trimmed) return null;
  const withoutScheme = trimmed.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '');
  const host = withoutScheme.split('/')[0].trim();
  return host || null;
}

function readPort(
  raw: string | undefined,
  fallback: number,
  name: string,
  onWarn?: (message: string) => void,
): number {
  const trimmed = raw?.trim();
  if (!trimmed) return fallback;
  const port = Number(trimmed);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    // Не бросаем: опечатка в номере порта не стоит упавшего на старте API.
    // Но и молчать нельзя — стример получил бы неверную строку подключения и
    // искал бы проблему в энкодере.
    onWarn?.(`${name}="${trimmed}" не похоже на номер порта, беру ${fallback}`);
    return fallback;
  }
  return port;
}

export function readIngestConfig(
  env: NodeJS.ProcessEnv = process.env,
  onWarn?: (message: string) => void,
): IngestConfigDto {
  return {
    host: normalizeHost(env.INGEST_HOST),
    srtPort: readPort(env.MEDIAMTX_SRT_PORT, DEFAULT_SRT_PORT, 'MEDIAMTX_SRT_PORT', onWarn),
    rtmpPort: readPort(env.MEDIAMTX_RTMP_PORT, DEFAULT_RTMP_PORT, 'MEDIAMTX_RTMP_PORT', onWarn),
  };
}
