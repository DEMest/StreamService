import {
  ConnectedSocket,
  MessageBody,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { ChatService } from './chat.service';

@WebSocketGateway({ cors: { origin: '*' }, namespace: '/chat' })
export class ChatGateway implements OnGatewayInit {
  @WebSocketServer() server: Server;

  constructor(private chat: ChatService) {}

  afterInit() {
    console.log('Chat WebSocket gateway initialized');
  }

  @SubscribeMessage('join')
  async handleJoin(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { eventId: string },
  ) {
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
