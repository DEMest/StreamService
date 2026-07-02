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
import { ChatService, chatRoomKey } from './chat.service';

/**
 * Room ключ = `stream:<streamId>`, резолвится один раз в handleJoin и
 * стабилен на весь сеанс сокета (переключение стрима — только при повторном
 * `join` от клиента, не автоматически).
 */
@WebSocketGateway({ cors: { origin: '*' }, namespace: '/chat' })
export class ChatGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server: Server;
  private readonly logger = new Logger(ChatGateway.name);
  // socketId → room key ("stream:<streamId>")
  private readonly socketRoom = new Map<string, string>();
  // socketId → streamId (для writeMessage)
  private readonly socketStreamId = new Map<string, string>();
  // socketId → orgSlug (для broadcastChatEnabled/Cleared по orgSlug)
  private readonly socketOrg = new Map<string, string>();
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
    this.socketStreamId.delete(client.id);
    this.socketOrg.delete(client.id);
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

    const streamId = await this.chat.resolveStreamId(data.orgSlug, data.streamSlug);
    if (!streamId) {
      client.emit('error', { message: 'Stream not found' });
      return;
    }
    const room = chatRoomKey(streamId);

    // Если socket уже был в другой комнате (переключение между Stream'ами
    // одной орги в SPA), сначала покидаем её и декрементим viewer-count там.
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
    this.socketStreamId.set(client.id, streamId);
    this.socketOrg.set(client.id, data.orgSlug);

    let count = this.roomViewers.get(room) ?? 0;
    if (!alreadyJoined) {
      count += 1;
      this.roomViewers.set(room, count);
    }
    client.emit('viewers', count);
    client.to(room).emit('viewers', count);

    try {
      const { messages, ttlMinutes, chatEnabled } = await this.chat.listMessages(streamId);
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
    const streamId = this.socketStreamId.get(client.id);
    const room = this.socketRoom.get(client.id);
    const orgSlug = this.socketOrg.get(client.id);
    if (!streamId || !room || !orgSlug) return;
    if (!data?.nickname?.trim() || !data?.content?.trim()) return;

    try {
      const message = await this.chat.writeMessage(
        streamId,
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
   * Широковещание chatEnabled на все rooms орги. chatEnabled — пока
   * org-level настройка, поэтому матчим все актуальные rooms где есть
   * зрители этой орги.
   */
  broadcastChatEnabled(orgSlug: string, enabled: boolean) {
    for (const room of this.roomsForOrg(orgSlug)) {
      this.server.to(room).emit('chat_enabled', enabled);
    }
  }

  /**
   * org-level clear → транслирует chat_cleared во все rooms, где есть
   * зрители этой орги. Это сохраняет семантику legacy endpoint'а
   * POST /v1/org/chat/clear, который чистит чат default Stream'а орги.
   */
  broadcastChatCleared(orgSlug: string, streamId?: string) {
    if (streamId) {
      this.server.to(chatRoomKey(streamId)).emit('chat_cleared');
      return;
    }
    for (const room of this.roomsForOrg(orgSlug)) {
      this.server.to(room).emit('chat_cleared');
    }
  }

  /**
   * Все актуальные rooms, где есть хотя бы один зритель этой орги.
   * Опирается на socketOrg-map. Room-ключ всегда `stream:<streamId>`.
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
