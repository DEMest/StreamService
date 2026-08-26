import type { Request } from 'express';

/**
 * Адрес зрителя за двумя прокси: браузер → nginx → web (rewrite `/api/*`) →
 * api. Прямой `req.socket.remoteAddress` здесь — это всегда контейнер web,
 * один на всех, поэтому лимит по нему заблокировал бы сайт целиком.
 *
 * Порядок источников:
 *   1. `X-Real-IP` — nginx перезаписывает его безусловно
 *      (`proxy_set_header X-Real-IP $remote_addr`), подделать снаружи нельзя.
 *   2. `X-Forwarded-For` — nginx добавляет свой адрес в конец, так что первый
 *      элемент клиент может подделать. Берём как запасной вариант: лучше
 *      обходимый лимит, чем никакого.
 *   3. `req.ip` — на локальной разработке без прокси он и есть настоящий.
 *
 * null означает «адрес определить не удалось». Вызывающий код обязан на этом
 * НЕ схлопывать всех в один счётчик: обращение о сломанном эфире важнее спама.
 */
export function clientIp(req: Pick<Request, 'headers' | 'ip'>): string | null {
  const real = normalize(firstHeader(req.headers['x-real-ip']));
  if (real) return real;

  const forwarded = firstHeader(req.headers['x-forwarded-for']);
  if (forwarded) {
    const first = normalize(forwarded.split(',')[0]);
    if (first) return first;
  }

  return normalize(req.ip);
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function normalize(value: string | undefined): string | null {
  // IPv4-mapped IPv6 (`::ffff:1.2.3.4`) и голый IPv4 — один и тот же клиент.
  const trimmed = value?.trim().replace(/^::ffff:/i, '') ?? '';
  return trimmed || null;
}
