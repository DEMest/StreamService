/**
 * Достаёт access JWT из HTTP-запроса: сначала Authorization Bearer
 * (мобильный клиент, NFR-34/NFR-60), иначе cookie access_token (сайт).
 * Query не читаем — токен не должен попадать в логи прокси.
 */
export function extractHttpAccessToken(req: {
  headers?: { authorization?: string };
  cookies?: Record<string, string | undefined>;
}): string | undefined {
  const fromHeader = bearerFromAuthorization(req.headers?.authorization);
  if (fromHeader) return fromHeader;
  const fromCookie = req.cookies?.['access_token'];
  return fromCookie || undefined;
}

/**
 * Access JWT для Socket.io handshake: `auth.token` (предпочтительно) или
 * заголовок Authorization. Query игнорируем по той же причине, что и HTTP.
 */
export function extractSocketAccessToken(handshake: {
  auth?: Record<string, unknown>;
  headers?: { authorization?: string | string[] };
}): string | undefined {
  const authToken = handshake.auth?.token;
  if (typeof authToken === 'string' && authToken.trim()) return authToken.trim();
  const raw = handshake.headers?.authorization;
  const header = Array.isArray(raw) ? raw[0] : raw;
  return bearerFromAuthorization(header);
}

export function bearerFromAuthorization(header: string | undefined): string | undefined {
  if (!header) return undefined;
  const m = /^Bearer\s+(\S+)/i.exec(header.trim());
  return m?.[1];
}
