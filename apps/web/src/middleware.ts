import { NextRequest, NextResponse } from 'next/server';

const PROTECTED_PATHS = ['/dashboard', '/admin'];

function isProtected(pathname: string): boolean {
  return PROTECTED_PATHS.some((p) => pathname.startsWith(p));
}

function base64UrlToBytes(input: string): Uint8Array<ArrayBuffer> {
  const b64 = input.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
  const bin = atob(padded);
  // Явный ArrayBuffer (не SharedArrayBuffer), чтобы тип подходил под BufferSource
  // в crypto.subtle.verify (строгие типы Uint8Array<ArrayBuffer> в TS 5.7+).
  const bytes = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/**
 * Проверяет HS256-подпись access-токена нативным Web Crypto (доступен в
 * Edge-runtime) и срок действия (`exp`). Возвращает payload при успехе, иначе null.
 *
 * Это тот же секрет и алгоритм, что использует backend (@nestjs/jwt → HS256).
 * Если `JWT_SECRET` в web не задан или не совпадает — вернём null, и middleware
 * мягко уйдёт в ветку refresh (см. middleware): сессия не сломается, просто
 * токен будет продлеваться на каждой защищённой навигации.
 */
async function verifyAccessToken(token: string | undefined): Promise<Record<string, unknown> | null> {
  if (!token) return null;
  const secret = process.env.JWT_SECRET;
  if (!secret) return null;

  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, signatureB64] = parts;

  try {
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify'],
    );
    const valid = await crypto.subtle.verify(
      'HMAC',
      key,
      base64UrlToBytes(signatureB64),
      new TextEncoder().encode(`${headerB64}.${payloadB64}`),
    );
    if (!valid) return null;

    const payload = JSON.parse(new TextDecoder().decode(base64UrlToBytes(payloadB64)));
    // exp в секундах (jsonwebtoken). Истёкший — невалиден.
    if (typeof payload.exp === 'number' && payload.exp * 1000 <= Date.now()) return null;
    // refresh-токен не должен пускать как access (паритет с JwtAuthGuard).
    if (payload.type === 'refresh') return null;
    return payload;
  } catch {
    return null;
  }
}

export async function middleware(req: NextRequest) {
  if (!isProtected(req.nextUrl.pathname)) return NextResponse.next();

  const access = req.cookies.get('access_token')?.value;
  const refresh = req.cookies.get('refresh_token')?.value;

  // 1) Действующий access — пускаем сразу, без обращения к API.
  if (await verifyAccessToken(access)) {
    return NextResponse.next();
  }

  // 2) Access истёк/отсутствует, но есть refresh — продлеваем сессию серверным
  //    запросом и прокидываем свежие Set-Cookie в ответ браузеру. Без этого
  //    navigation-редирект на /login случался бы каждый час, хотя refresh
  //    (90 дней) ещё валиден — клиентский авто-refresh из lib/api.ts на
  //    server-side навигации не успевает отработать.
  if (refresh) {
    try {
      // Same-origin вызов: и в docker (/api → прокси на сервис api), и в локалке
      // (/api → rewrite на localhost:3001) ведёт к одному и тому же бэкенду —
      // не нужно знать внутренний адрес API в middleware.
      const apiRes = await fetch(new URL('/api/v1/auth/refresh', req.url), {
        method: 'POST',
        headers: { cookie: `refresh_token=${refresh}` },
      });
      if (apiRes.ok) {
        const res = NextResponse.next();
        const headers = apiRes.headers as Headers & { getSetCookie?: () => string[] };
        const setCookies = typeof headers.getSetCookie === 'function' ? headers.getSetCookie() : [];
        for (const cookie of setCookies) res.headers.append('set-cookie', cookie);
        return res;
      }
    } catch {
      // сеть/таймаут до API — падаем в редирект ниже.
    }
  }

  // 3) Ни валидного access, ни рабочего refresh — на логин.
  return NextResponse.redirect(new URL('/login', req.url));
}

export const config = { matcher: ['/dashboard/:path*', '/admin/:path*'] };
