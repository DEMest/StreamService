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
import { Logger, OnModuleDestroy } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Server, Socket } from 'socket.io';
import { PrismaService } from '../prisma/prisma.service';
import { SlotStateService, SlotState } from '../stream/slot-state.service';
import { verifyWsToken, WsAuthUser } from '../auth/ws-jwt.guard';

const CORS_ORIGINS = (process.env.CORS_ORIGIN ?? '*')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

/**
 * WebSocket gateway для Studio UI стримера. Namespace `/studio`.
 *
 * Авторизация: JWT cookie `access_token`, как в REST. Только org_admin.
 *
 * Поток событий:
 *  - client → `join { streamId }` — проверяем что Stream принадлежит юзеру (orgId match),
 *    джоиним в комнату `studio:<streamId>`, шлём snapshot всех текущих slotState'ов.
 *  - SlotStateService event → forward в комнату `studio:<streamId>` как `slotState`.
 */
@WebSocketGateway({
  cors: {
    origin: CORS_ORIGINS.length === 1 && CORS_ORIGINS[0] === '*' ? '*' : CORS_ORIGINS,
    credentials: true,
  },
  namespace: '/studio',
})
export class StudioGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect, OnModuleDestroy
{
  @WebSocketServer() server: Server;
  private readonly logger = new Logger(StudioGateway.name);

  // socketId → streamId (для disconnect-cleanup и валидации сообщений)
  private readonly socketStream = new Map<string, string>();
  private unsubscribeSlotState: (() => void) | null = null;

  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
    private readonly slotState: SlotStateService,
  ) {}

  afterInit(server: Server) {
    this.unsubscribeSlotState = this.slotState.on((state) => {
      // Forward event только в комнату нужного Stream'а
      server.to(this.roomFor(state.streamId)).emit('slotState', state);
    });

    // @WebSocketServer() инжектит namespace для gateway с namespace-конфигом.
    // Namespace middleware гарантирует что аутентификация выполняется ДО
    // того как socket.io примет `connect` и начнёт диспатчить client events.
    // handleConnection асинхронен — без middleware клиент мог успеть
    // emit'нуть `join` пока handleConnection ещё разбирает cookie, и
    // handleJoin читал бы пустого `client.data.user`.
    server.use(async (client: Socket, next: (err?: Error) => void) => {
      try {
        const user = await verifyWsToken(client, this.jwt);
        if (!user) {
          return next(new Error('unauthorized'));
        }
        if (user.role !== 'org_admin' && user.role !== 'superadmin') {
          this.logger.warn(
            `Studio: forbidden role '${user.role}' for socket ${client.id}`,
          );
          return next(new Error('forbidden'));
        }
        client.data.user = user;
        next();
      } catch (e) {
        next(e instanceof Error ? e : new Error('auth_failed'));
      }
    });

    this.logger.log('Studio WebSocket gateway initialized');
  }

  onModuleDestroy() {
    this.unsubscribeSlotState?.();
    this.unsubscribeSlotState = null;
  }

  /**
   * handleConnection остаётся для совместимости со старым тестовым стилем —
   * в production-runtime middleware уже проставил `client.data.user`. Если
   * по какой-то причине middleware не отработал (тестовый вызов handleConnection
   * напрямую), повторяем верификацию здесь. См. afterInit.
   */
  async handleConnection(client: Socket) {
    if (client.data?.user) return; // middleware уже сделал свою работу
    const user = await verifyWsToken(client, this.jwt);
    if (!user) {
      this.logger.warn(`Studio: unauthenticated socket ${client.id} — disconnect`);
      client.emit('error', { code: 'unauthorized', message: 'Not authenticated' });
      client.disconnect(true);
      return;
    }
    if (user.role !== 'org_admin' && user.role !== 'superadmin') {
      this.logger.warn(`Studio: forbidden role '${user.role}' for socket ${client.id}`);
      client.emit('error', { code: 'forbidden', message: 'Not an org admin' });
      client.disconnect(true);
      return;
    }
    client.data.user = user;
  }

  handleDisconnect(client: Socket) {
    this.socketStream.delete(client.id);
  }

  @SubscribeMessage('join')
  async handleJoin(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { streamId?: string },
  ) {
    const user = client.data?.user as WsAuthUser | undefined;
    if (!user) {
      client.emit('error', { code: 'unauthorized', message: 'Not authenticated' });
      return;
    }
    const streamId = data?.streamId;
    if (!streamId) {
      client.emit('error', { code: 'bad_request', message: 'streamId is required' });
      return;
    }

    const stream = await this.prisma.stream.findUnique({
      where: { id: streamId },
      select: { id: true, orgId: true },
    });
    if (!stream) {
      client.emit('error', { code: 'not_found', message: 'Stream not found' });
      return;
    }

    const allowed =
      user.role === 'superadmin' || (user.role === 'org_admin' && user.orgId === stream.orgId);
    if (!allowed) {
      this.logger.warn(
        `Studio: user ${user.sub} attempted to join stream ${streamId} of other org`,
      );
      client.emit('error', { code: 'forbidden', message: 'Stream belongs to another organization' });
      return;
    }

    // Owner может переключаться между Stream'ами своей орги в одной SPA
    // (например, dropdown Stream-picker). Если socket уже подписан на другой
    // Stream — обязательно покидаем старую room, иначе будем продолжать
    // получать `slotState`-события от предыдущего Stream'а (Karen H3).
    const previousStreamId = this.socketStream.get(client.id);
    if (previousStreamId && previousStreamId !== streamId) {
      client.leave(this.roomFor(previousStreamId));
    }

    const room = this.roomFor(streamId);
    client.join(room);
    this.socketStream.set(client.id, streamId);

    // Snapshot текущих slotState'ов — клиент может сразу нарисовать UI
    const snapshot = this.slotState.getStreamState(streamId);
    for (const state of snapshot) {
      client.emit('slotState', state);
    }
    client.emit('joined', { streamId, snapshotCount: snapshot.length });
  }

  private roomFor(streamId: string): string {
    return `studio:${streamId}`;
  }
}

// Re-export для удобства потребителей gateway'а
export type { SlotState };
