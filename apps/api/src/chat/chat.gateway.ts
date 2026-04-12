import {
  ConnectedSocket,
  MessageBody,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { ChatService } from './chat.service';

@WebSocketGateway({ cors: { origin: '*' }, namespace: '/chat' })
export class ChatGateway implements OnGatewayInit {
  @WebSocketServer() server: Server;
  private readonly logger = new Logger(ChatGateway.name);

  constructor(private chat: ChatService) {}

  afterInit() {
    this.logger.log('Chat WebSocket gateway initialized');
  }

  @SubscribeMessage('join')
  async handleJoin(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { eventId: string },
  ) {
    if (!data?.eventId) return;
    client.join(`event:${data.eventId}`);
    const messages = await this.chat.getRecentMessages(data.eventId);
    client.emit('history', messages);
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
