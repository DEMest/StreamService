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
import { ChatService } from './chat.service';

@WebSocketGateway({ cors: { origin: '*' }, namespace: '/chat' })
export class ChatGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server: Server;
  private readonly logger = new Logger(ChatGateway.name);
  private readonly socketRoom = new Map<string, string>(); // socketId → orgSlug
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
    const orgSlug = this.socketRoom.get(client.id);
    if (!orgSlug) return;
    this.socketRoom.delete(client.id);
    const room = `org:${orgSlug}`;
    const prev = this.roomViewers.get(room) ?? 0;
    const count = Math.max(0, prev - 1);
    if (count > 0) this.roomViewers.set(room, count);
    else this.roomViewers.delete(room);
    client.to(room).emit('viewers', count);
  }

  @SubscribeMessage('join')
  async handleJoin(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { orgSlug: string },
  ) {
    if (!data?.orgSlug) return;
    const room = `org:${data.orgSlug}`;
    client.join(room);

    // Only increment if this socket wasn't already tracked
    const alreadyJoined = this.socketRoom.has(client.id);
    this.socketRoom.set(client.id, data.orgSlug);

    let count = this.roomViewers.get(room) ?? 0;
    if (!alreadyJoined) {
      count += 1;
      this.roomViewers.set(room, count);
    }
    client.emit('viewers', count);
    client.to(room).emit('viewers', count);

    try {
      const messages = await this.chat.getRecentMessages(data.orgSlug);
      client.emit('history', messages);
    } catch (err) {
      this.logger.error(`Failed to load history for ${data.orgSlug}: ${err}`);
      client.emit('history', []);
    }
  }

  @SubscribeMessage('message')
  async handleMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { orgSlug: string; nickname: string; content: string },
  ) {
    if (!data.orgSlug || !data.nickname?.trim() || !data.content?.trim()) return;
    try {
      const message = await this.chat.saveMessage(
        data.orgSlug,
        data.nickname.trim(),
        data.content.trim(),
      );
      if (message) {
        const room = `org:${data.orgSlug}`;
        client.to(room).emit('message', message);
        client.emit('message', message);
      }
    } catch (err) {
      this.logger.error(`Failed to save message for ${data.orgSlug}: ${err}`);
    }
  }
}
