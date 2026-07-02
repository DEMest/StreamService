import { io, Socket } from 'socket.io-client';

let chatSocket: Socket | null = null;

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
