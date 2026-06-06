import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { ChatScope, ChatService, scopeRoomKey } from './chat.service';

/**
 * Step 5 B2 — chat scope refactor.
 *
 * Room ключи теперь scope-based:
 *   - event scope → `event:<eventId>`
 *   - stream scope → `stream:<streamId>`
 *
 * Все Stream'ы одного активного Event'а делят room (event scope), их зрители
 * видят одни и те же сообщения. Standalone Stream (не в Event'е) или Stream
 * в endedEvent'е получает stream-room — изолирован от других стримов орги.
 *
 * Резолв scope делает ChatService.resolveScope. Если orgа/stream не найдены —
 * gateway отправляет `error` клиенту и не подписывает на room.
 */
@WebSocketGateway({ cors: { origin: '*' }, namespace: '/chat' })
export class ChatGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server: Server;
  private readonly logger = new Logger(ChatGateway.name);
  // socketId → room key (для disconnect-cleanup и валидации message)
  private readonly socketRoom = new Map<string, string>();
  // socketId → scope (для writeMessage; восстанавливается на handleJoin)
  private readonly socketScope = new Map<string, ChatScope>();
  // socketId → orgSlug (для broadcastChatEnabled/Cleared по orgSlug)
  private readonly socketOrg = new Map<string, string>();
  // socketId → streamSlug (для re-resolve scope в handleMessage; см. Karen C2)
  private readonly socketStreamSlug = new Map<string, string>();
  private readonly roomViewers = new Map<string, number>(); // room → count

  constructor(private chat: ChatService) {}

  afterInit() {
    this.logger.log('Chat WebSocket gateway initialized');
  }

  handleConnection(client: Socket) {
    this.logger.log(`Socket connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Socket disconnected: ${client.id}`);
    const room = this.socketRoom.get(client.id);
    this.socketScope.delete(client.id);
    this.socketOrg.delete(client.id);
    this.socketStreamSlug.delete(client.id);
    if (!room) return;
    this.socketRoom.delete(client.id);
    const prev = this.roomViewers.get(room) ?? 0;
    const count = Math.max(0, prev - 1);
    if (count > 0) this.roomViewers.set(room, count);
    else this.roomViewers.delete(room);
    client.to(room).emit('viewers', count);
  }

  @SubscribeMessage('join')
  async handleJoin(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { orgSlug: string; streamSlug?: string },
  ) {
    if (!data?.orgSlug) return;

    const scope = await this.chat.resolveScope(data.orgSlug, data.streamSlug);
    if (!scope) {
      client.emit('error', { message: 'Stream not found' });
      return;
    }
    const room = scopeRoomKey(scope);

    // Если socket уже был в другой комнате (переключение между Stream'ами
    // одной орги в SPA, или переход Stream'а в активный Event и обратно),
    // сначала покидаем её и декрементим viewer-count там.
    const prevRoom = this.socketRoom.get(client.id);
    if (prevRoom && prevRoom !== room) {
      client.leave(prevRoom);
      const prevCount = this.roomViewers.get(prevRoom) ?? 0;
      const nextPrevCount = Math.max(0, prevCount - 1);
      if (nextPrevCount > 0) this.roomViewers.set(prevRoom, nextPrevCount);
      else this.roomViewers.delete(prevRoom);
      client.to(prevRoom).emit('viewers', nextPrevCount);
    }

    client.join(room);
    const alreadyJoined = prevRoom === room;
    this.socketRoom.set(client.id, room);
    this.socketScope.set(client.id, scope);
    this.socketOrg.set(client.id, data.orgSlug);
    this.socketStreamSlug.set(client.id, data.streamSlug ?? '');

    let count = this.roomViewers.get(room) ?? 0;
    if (!alreadyJoined) {
      count += 1;
      this.roomViewers.set(room, count);
    }
    client.emit('viewers', count);
    client.to(room).emit('viewers', count);

    try {
      const { messages, ttlMinutes, chatEnabled } = await this.chat.listMessages(scope);
      client.emit('history', messages);
      client.emit('chat_ttl', ttlMinutes);
      client.emit('chat_enabled', chatEnabled);
    } catch (err) {
      this.logger.error(`Failed to load history for ${data.orgSlug}/${data.streamSlug ?? ''}: ${err}`);
      client.emit('history', []);
    }
  }

  @SubscribeMessage('message')
  async handleMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { nickname: string; content: string },
  ) {
    const cachedScope = this.socketScope.get(client.id);
    const cachedRoom = this.socketRoom.get(client.id);
    const orgSlug = this.socketOrg.get(client.id);
    if (!cachedScope || !cachedRoom || !orgSlug) return;
    if (!data?.nickname?.trim() || !data?.content?.trim()) return;

    // Karen C2 (Step 5): scope резолвился один раз при join, но если за время
    // сессии случился Event.start/end — cached scope застывает на старом значении
    // и сообщения уходят не туда. Перерезолвим actual scope при каждом message
    // (одна простая Prisma-выборка — допустимая нагрузка, чат не hot path).
    // Если scope изменился — мигрируем socket в новую room ДО writeMessage,
    // чтобы локальный echo и broadcast попали в актуальный room.
    const streamSlug = this.socketStreamSlug.get(client.id) ?? '';
    const actualScope = await this.chat.resolveScope(orgSlug, streamSlug);
    if (!actualScope) return; // org/stream исчезли посреди сессии

    let scope = cachedScope;
    let room = cachedRoom;
    if (scopeRoomKey(actualScope) !== scopeRoomKey(cachedScope)) {
      const newRoom = scopeRoomKey(actualScope);
      client.leave(cachedRoom);
      const prevCount = this.roomViewers.get(cachedRoom) ?? 0;
      const nextPrevCount = Math.max(0, prevCount - 1);
      if (nextPrevCount > 0) this.roomViewers.set(cachedRoom, nextPrevCount);
      else this.roomViewers.delete(cachedRoom);
      client.to(cachedRoom).emit('viewers', nextPrevCount);

      client.join(newRoom);
      const newCount = (this.roomViewers.get(newRoom) ?? 0) + 1;
      this.roomViewers.set(newRoom, newCount);
      client.to(newRoom).emit('viewers', newCount);
      client.emit('viewers', newCount);

      this.socketRoom.set(client.id, newRoom);
      this.socketScope.set(client.id, actualScope);
      scope = actualScope;
      room = newRoom;
    }

    try {
      const message = await this.chat.writeMessage(
        scope,
        data.nickname.trim(),
        data.content.trim(),
      );
      if (message) {
        client.to(room).emit('message', message);
        client.emit('message', message);
      } else {
        const enabled = await this.chat.isChatEnabled(orgSlug);
        if (!enabled) client.emit('chat_enabled', false);
      }
    } catch (err) {
      this.logger.error(`Failed to save message for socket ${client.id}: ${err}`);
    }
  }

  /**
   * Широковещание chatEnabled на все scope-rooms орги. chatEnabled — пока
   * org-level настройка (Step 5 пока не вводит per-Stream chatEnabled), поэтому
   * матчим все актуальные rooms где есть зрители этой орги.
   */
  broadcastChatEnabled(orgSlug: string, enabled: boolean) {
    for (const room of this.roomsForOrg(orgSlug)) {
      this.server.to(room).emit('chat_enabled', enabled);
    }
  }

  /**
   * Step 5: org-level clear → транслирует chat_cleared во все rooms, где есть
   * зрители этой орги (включая stream- и event-scope комнаты). Это сохраняет
   * семантику legacy endpoint'а POST /v1/org/chat/clear, который чистит чат
   * default Stream'а орги.
   */
  broadcastChatCleared(orgSlug: string, scope?: ChatScope) {
    if (scope) {
      this.server.to(scopeRoomKey(scope)).emit('chat_cleared');
      return;
    }
    for (const room of this.roomsForOrg(orgSlug)) {
      this.server.to(room).emit('chat_cleared');
    }
  }

  /**
   * Все актуальные rooms, где есть хотя бы один зритель этой орги.
   * Опирается на socketOrg-map, чтобы корректно покрыть и event-rooms
   * (event scope уже не содержит orgSlug в ключе).
   */
  private roomsForOrg(orgSlug: string): string[] {
    const rooms = new Set<string>();
    for (const [socketId, sOrg] of this.socketOrg.entries()) {
      if (sOrg !== orgSlug) continue;
      const room = this.socketRoom.get(socketId);
      if (room) rooms.add(room);
    }
    return Array.from(rooms);
  }
}
