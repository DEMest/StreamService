import { NextRequest, NextResponse } from 'next/server';

/**
 * Кому принадлежит раздел. Дублирует `@Roles(...)` на бэкенде намеренно:
 * гвард вернёт 403 на запросы к API, но страницу это не остановит — админ
 * организации до сих пор мог открыть /admin и смотреть на пустой каркас,
 * который сыплет 403 в консоль. Роль решается здесь, до рендера.
 */
const SECTION_ROLE: Record<string, string> = {
  '/admin': 'superadmin',
  '/dashboard': 'org_admin',
};

function sectionFor(pathname: string): string | null {
  return Object.keys(SECTION_ROLE).find((p) => pathname.startsWith(p)) ?? null;
}

/**
 * Куда уводить того, кто попал в чужой раздел. Суперадмин отправляется на
 * главную, а не в /admin: на основном домене админки нет (её отдаёт только
 * admin.liga-live.ru), и редирект туда упёрся бы в 404 от nginx.
 */
function homeForRole(role: string): string {
  return role === 'org_admin' ? '/dashboard' : '/';
}

/**
 * Ответ с учётом роли: чужой раздел — редирект, свой — проход дальше.
 * Роль неизвестна (payload не разобрался) — пускаем: решение остаётся за API,
 * который в любом случае проверит её сам.
 */
function responseForRole(
  payload: Record<string, unknown> | null,
  section: string,
  req: NextRequest,
): NextResponse {
  const role = typeof payload?.role === 'string' ? payload.role : null;
  if (role && role !== SECTION_ROLE[section]) {
    return NextResponse.redirect(new URL(homeForRole(role), req.url));
  }
  return NextResponse.next();
}

/** Достаёт свежий access-токен из заголовков Set-Cookie ответа /auth/refresh. */
function accessFromSetCookie(cookies: string[]): string | undefined {
  for (const cookie of cookies) {
    const match = /(?:^|;\s*)access_token=([^;]+)/.exec(cookie);
    if (match) return match[1];
  }
  return undefined;
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
  const section = sectionFor(req.nextUrl.pathname);
  if (!section) return NextResponse.next();

  const access = req.cookies.get('access_token')?.value;
  const refresh = req.cookies.get('refresh_token')?.value;

  // 1) Действующий access — пускаем сразу, без обращения к API.
  const payload = await verifyAccessToken(access);
  if (payload) {
    return responseForRole(payload, section, req);
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
        const headers = apiRes.headers as Headers & { getSetCookie?: () => string[] };
        const setCookies = typeof headers.getSetCookie === 'function' ? headers.getSetCookie() : [];
        // Роль берём из свежего токена: иначе истёкший access давал бы обход
        // проверки — раздел открывался бы любому, у кого жив refresh.
        const fresh = await verifyAccessToken(accessFromSetCookie(setCookies));
        // Продлённую сессию отдаём и вместе с редиректом: иначе следующая
        // навигация снова пошла бы за refresh.
        const res = responseForRole(fresh, section, req);
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
