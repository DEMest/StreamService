import { io, Socket } from 'socket.io-client';

let chatSocket: Socket | null = null;
let studioSocket: Socket | null = null;

// На проде origin страницы и api совпадают (nginx-edge проксирует /socket.io/
// в api-контейнер) — base пустой ⇒ io() возьмёт window.location.origin.
// На тестовом стенде api торчит на отдельном порту (нет nginx) —
// NEXT_PUBLIC_SOCKET_URL задаёт прямой URL до api.
const SOCKET_BASE = process.env.NEXT_PUBLIC_SOCKET_URL ?? '';

/**
 * Returns a singleton `/chat` namespace socket. Used by the viewer-side chat UI.
 */
export function getSocket(): Socket {
  if (!chatSocket) {
    chatSocket = io(`${SOCKET_BASE}/chat`, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
    });
  }
  return chatSocket;
}

/**
 * Возвращает singleton WebSocket для `/studio` namespace. Используется Studio
 * UI для получения live-обновлений slotState'ов выбранного Stream'а.
 *
 * Auth: HttpOnly cookie `access_token`. `withCredentials: true` заставляет
 * браузер слать cookie при handshake'е.
 *
 * onAuthError вызывается при ошибке аутентификации/авторизации от сервера
 * (просроченный JWT, чужой role и т.п.). Чтобы не зациклиться на бесконечном
 * reconnect с тем же протухшим cookie, при таких ошибках мы вырубаем
 * автореконнект и сообщаем наверх — UI должен редиректнуть на /login.
 */
export function getStudioSocket(onAuthError?: (reason: string) => void): Socket {
  if (!studioSocket) {
    const socket: Socket = io(`${SOCKET_BASE}/studio`, {
      transports: ['websocket', 'polling'],
      withCredentials: true,
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
    });

    const isAuthErrorMessage = (msg: unknown): boolean => {
      if (typeof msg !== 'string') return false;
      const lower = msg.toLowerCase();
      return (
        lower.includes('unauthorized') ||
        lower.includes('forbidden') ||
        lower.includes('jwt expired') ||
        lower.includes('jwt malformed') ||
        lower.includes('auth_failed')
      );
    };

    // socket.io middleware-ошибка приходит как `connect_error` с message
    // строкой, переданной в `next(new Error(...))` на сервере.
    socket.on('connect_error', (err: Error) => {
      if (isAuthErrorMessage(err?.message)) {
        // Жёстко останавливаем reconnect-loop — cookie не починится сам.
        socket.io.opts.reconnection = false;
        socket.disconnect();
        studioSocket = null;
        onAuthError?.(err.message);
      }
    });

    // Серверный handleConnection может эмитить `error` event перед disconnect
    // (legacy-путь, до middleware). Тот же триггер.
    socket.on('error', (payload: { code?: string; message?: string }) => {
      const code = payload?.code;
      if (code === 'unauthorized' || code === 'forbidden') {
        socket.io.opts.reconnection = false;
        socket.disconnect();
        studioSocket = null;
        onAuthError?.(payload?.message ?? code);
      }
    });

    studioSocket = socket;
  }
  return studioSocket;
}
