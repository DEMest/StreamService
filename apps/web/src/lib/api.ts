const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? '/api';

/**
 * Shared promise — пока идёт /refresh, все остальные 401-обработчики ждут
 * именно его, а не плодят параллельные refresh-запросы. После завершения
 * сбрасывается в null.
 */
let refreshInFlight: Promise<boolean> | null = null;

async function callRefresh(): Promise<boolean> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    try {
      const r = await fetch(`${API_BASE}/v1/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
      });
      // Сервер только что высказался о сессии — самый достоверный момент,
      // чтобы поправить метку. 401 = refresh-токена нет или он мёртв; всё
      // остальное (500, 502 при выкатке) про сессию не говорит ничего, и
      // метку такие ответы не трогают.
      if (r.ok) setSessionHint(true);
      else if (r.status === 401) setSessionHint(false);
      return r.ok;
    } catch {
      // Сеть отвалилась — про сессию мы ничего не узнали, метку не трогаем.
      return false;
    } finally {
      // следующий 401 после завершения этого refresh будет начинать новый
      setTimeout(() => {
        refreshInFlight = null;
      }, 0);
    }
  })();
  return refreshInFlight;
}

/**
 * Принудительный уход на /login уместен только в приватных разделах.
 * Публичные страницы (лендинг/каталог/watch/архив) обязаны работать для
 * анонима: Header дёргает /v1/auth/me, получает 401 — это штатная ситуация
 * «не залогинен», а не повод выкидывать зрителя на форму логина.
 *
 * Тот же список — единственный признак «приватного раздела» и для авто-refresh
 * ниже; второго перечня путей заводить нельзя, разъехавшись, они дали бы
 * редирект без попытки продлить сессию.
 */
const AUTH_REDIRECT_PREFIXES = ['/dashboard', '/admin'];

/** Открыт приватный раздел — там сессия обязана быть по определению. */
function inAuthSection(): boolean {
  if (typeof window === 'undefined') return false;
  const { pathname } = window.location;
  return AUTH_REDIRECT_PREFIXES.some((p) => pathname.startsWith(p));
}

function redirectToLogin() {
  if (!inAuthSection()) return;
  const next = encodeURIComponent(window.location.pathname + window.location.search);
  window.location.href = `/login?next=${next}`;
}

/**
 * Метка «в этом браузере была сессия». Ставится, когда сессию подтвердил
 * сервер (успешный login / me / refresh), снимается на выходе и на refresh,
 * ответившем 401. Сами cookie HttpOnly, прочитать их из JS нельзя, а знать
 * про сессию нужно ровно для одного — не тратить refresh на анонима.
 *
 * Зачем: на публичной странице шапка дёргает `/v1/auth/me`, аноним получает
 * штатный 401 «не залогинен», и следом уходила заведомо безнадёжная попытка
 * продлить несуществующую сессию — лишний запрос на каждую загрузку у каждого
 * зрителя.
 *
 * Почему одного `AUTH_REDIRECT_PREFIXES` мало: access живёт час, refresh — 90
 * дней, и всё это время залогиненный ходит в том числе по публичным
 * страницам. Рефрешь мы только в `/dashboard` и `/admin` — на watch-странице
 * ему показывали бы «Войти» при живой сессии.
 *
 * Отсюда три состояния, а не два. `'0'` — сервер сказал, что сессии нет, и
 * только это состояние отменяет refresh. Отсутствие ключа значит «не знаем» и
 * ведёт себя как раньше: сюда попадают и первый визит в этом браузере, и
 * сессия, открытая до появления этого кода, — второй случай иначе выглядел бы
 * разлогином на публичной странице. Цена — одна лишняя попытка refresh на
 * браузер, а не на каждую загрузку страницы.
 *
 * Метка — подсказка, а не право доступа: подделав её, аноним добьётся ровно
 * того же 401 на refresh, что и раньше. Решает всё сервер по HttpOnly cookie.
 */
const SESSION_HINT_KEY = 'auth_session';

/** false — только когда точно знаем, что сессии нет. */
function maybeHasSession(): boolean {
  try {
    return localStorage.getItem(SESSION_HINT_KEY) !== '0';
  } catch {
    // localStorage недоступен (SSR, приватный режим) — живём без подсказки,
    // то есть ровно так, как жили до неё.
    return true;
  }
}

function setSessionHint(exists: boolean) {
  try {
    localStorage.setItem(SESSION_HINT_KEY, exists ? '1' : '0');
  } catch {
    /* см. maybeHasSession */
  }
}

async function request<T>(
  path: string,
  options?: RequestInit,
  retried = false,
): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...options?.headers },
    ...options,
  });

  // Метку сессии ведём по ответам самого /v1/auth/* — только он знает,
  // появилась она или пропала (refresh отмечается внутри callRefresh).
  if (path.startsWith('/v1/auth/login')) setSessionHint(res.ok);
  else if (path.startsWith('/v1/auth/logout')) setSessionHint(false);
  else if (path.startsWith('/v1/auth/me') && res.ok) setSessionHint(true);

  // Auto-refresh: одна попытка на запрос. Не пытаемся рефрешить сам /auth/*
  // и не тратим запрос на анонима, которому продлевать нечего.
  if (
    res.status === 401 &&
    !retried &&
    !path.startsWith('/v1/auth/refresh') &&
    !path.startsWith('/v1/auth/login') &&
    (inAuthSection() || maybeHasSession())
  ) {
    const ok = await callRefresh();
    if (ok) {
      return request<T>(path, options, true);
    }
    // refresh не получилось — кидаем юзера на /login
    redirectToLogin();
  }

  if (!res.ok) {
    const error = await res
      .json()
      .catch(() => ({ message: res.statusText }));
    throw new Error(error.message ?? 'Request failed');
  }
  return res.json();
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: body ? JSON.stringify(body) : undefined }),
  patch: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};
