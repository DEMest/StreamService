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

  constructor(private chat: ChatService) {}

  afterInit() {
    this.logger.log('Chat WebSocket gateway initialized');
  }

  handleConnection() {}

  handleDisconnect(client: Socket) {
    const orgSlug = this.socketRoom.get(client.id);
    if (!orgSlug) return;
    this.socketRoom.delete(client.id);
    const room = `org:${orgSlug}`;
    const count = this.server.sockets.adapter.rooms.get(room)?.size ?? 0;
    this.server.to(room).emit('viewers', count);
  }

  @SubscribeMessage('join')
  async handleJoin(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { orgSlug: string },
  ) {
    if (!data?.orgSlug) return;
    client.join(`org:${data.orgSlug}`);
    this.socketRoom.set(client.id, data.orgSlug);
    const messages = await this.chat.getRecentMessages(data.orgSlug);
    client.emit('history', messages);
    const room = `org:${data.orgSlug}`;
    const count = this.server.sockets.adapter.rooms.get(room)?.size ?? 0;
    this.server.to(room).emit('viewers', count);
  }

  @SubscribeMessage('message')
  async handleMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { orgSlug: string; nickname: string; content: string },
  ) {
    if (!data.orgSlug || !data.nickname?.trim() || !data.content?.trim()) return;
    const message = await this.chat.saveMessage(
      data.orgSlug,
      data.nickname.trim(),
      data.content.trim(),
    );
    if (message) {
      this.server.to(`org:${data.orgSlug}`).emit('message', message);
    }
  }
}
