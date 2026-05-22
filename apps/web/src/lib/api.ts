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
      return r.ok;
    } catch {
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

function redirectToLogin() {
  if (typeof window === 'undefined') return;
  const current = window.location.pathname + window.location.search;
  // Не редиректим если мы УЖЕ на /login — иначе цикл
  if (window.location.pathname.startsWith('/login')) return;
  const next = encodeURIComponent(current);
  window.location.href = `/login?next=${next}`;
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

  // Auto-refresh: одна попытка на запрос. Не пытаемся рефрешить сам /auth/*.
  if (
    res.status === 401 &&
    !retried &&
    !path.startsWith('/v1/auth/refresh') &&
    !path.startsWith('/v1/auth/login')
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
