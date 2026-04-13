import { io, Socket } from 'socket.io-client';

let socket: Socket | null = null;

export function getSocket(): Socket {
  if (!socket) {
    const socketUrl = process.env.NEXT_PUBLIC_SOCKET_URL ?? 'http://localhost:3001';
    socket = io(`${socketUrl}/chat`, {
      transports: ['websocket'],
      withCredentials: true,
    });
  }
  return socket;
}
