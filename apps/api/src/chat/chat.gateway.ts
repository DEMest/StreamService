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
  private readonly socketRoom = new Map<string, string>(); // socketId → eventId

  constructor(private chat: ChatService) {}

  afterInit() {
    this.logger.log('Chat WebSocket gateway initialized');
  }

  handleConnection() {}

  handleDisconnect(client: Socket) {
    const eventId = this.socketRoom.get(client.id);
    if (!eventId) return;
    this.socketRoom.delete(client.id);
    const room = `event:${eventId}`;
    const count = this.server.sockets.adapter.rooms.get(room)?.size ?? 0;
    this.server.to(room).emit('viewers', count);
  }

  @SubscribeMessage('join')
  async handleJoin(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { eventId: string },
  ) {
    if (!data?.eventId) return;
    client.join(`event:${data.eventId}`);
    this.socketRoom.set(client.id, data.eventId);
    const messages = await this.chat.getRecentMessages(data.eventId);
    client.emit('history', messages);
    const room = `event:${data.eventId}`;
    const count = this.server.sockets.adapter.rooms.get(room)?.size ?? 0;
    this.server.to(room).emit('viewers', count);
  }

  @SubscribeMessage('message')
  async handleMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { eventId: string; nickname: string; content: string },
  ) {
    if (!data.eventId || !data.nickname?.trim() || !data.content?.trim()) return;
    const message = await this.chat.saveMessage(
      data.eventId,
      data.nickname.trim(),
      data.content.trim(),
    );
    this.server.to(`event:${data.eventId}`).emit('message', message);
  }
}
