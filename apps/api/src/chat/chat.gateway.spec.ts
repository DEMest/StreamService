import { Test } from '@nestjs/testing';
import { ChatGateway } from './chat.gateway';
import { ChatService } from './chat.service';

/**
 * Lightweight Socket-like stub. Записывает все emit'ы, join'ы и to(room).emit'ы
 * в массивы, чтобы тесты могли проверить что отправили клиенту и в какую комнату.
 */
function makeSocket(id: string) {
  const emitted: { event: string; payload: any }[] = [];
  const joinedRooms: string[] = [];
  const toEmits: { room: string; event: string; payload: any }[] = [];
  return {
    id,
    join: jest.fn((room: string) => {
      joinedRooms.push(room);
    }),
    leave: jest.fn((room: string) => {
      const idx = joinedRooms.indexOf(room);
      if (idx !== -1) joinedRooms.splice(idx, 1);
    }),
    emit: jest.fn((event: string, payload: any) => {
      emitted.push({ event, payload });
    }),
    to: jest.fn((room: string) => ({
      emit: jest.fn((event: string, payload: any) => {
        toEmits.push({ room, event, payload });
      }),
    })),
    _emitted: emitted,
    _joinedRooms: joinedRooms,
    _toEmits: toEmits,
  };
}

describe('ChatGateway — per-Stream rooms', () => {
  let gateway: ChatGateway;
  let chat: {
    resolveStreamId: jest.Mock;
    writeMessage: jest.Mock;
    listMessages: jest.Mock;
    isChatEnabled: jest.Mock;
  };

  beforeEach(async () => {
    chat = {
      resolveStreamId: jest.fn(),
      writeMessage: jest.fn(),
      listMessages: jest
        .fn()
        .mockResolvedValue({ messages: [], ttlMinutes: 180, chatEnabled: true }),
      isChatEnabled: jest.fn().mockResolvedValue(true),
    };
    const module = await Test.createTestingModule({
      providers: [ChatGateway, { provide: ChatService, useValue: chat }],
    }).compile();
    gateway = module.get(ChatGateway);
    gateway.server = {
      to: jest.fn((_room: string) => ({ emit: jest.fn() })),
    } as any;
  });

  describe('handleJoin — room key derived from resolved streamId', () => {
    it('resolves stream → room "stream:<streamId>"', async () => {
      chat.resolveStreamId.mockResolvedValue('sA');
      const sock = makeSocket('s1');
      await gateway.handleJoin(sock as any, { orgSlug: 'club', streamSlug: 'mat-a' });
      expect(sock._joinedRooms).toEqual(['stream:sA']);
    });

    it('omitted streamSlug → resolveStreamId receives undefined and joins default Stream', async () => {
      chat.resolveStreamId.mockResolvedValue('sDefault');
      const sock = makeSocket('s3');
      await gateway.handleJoin(sock as any, { orgSlug: 'club' });
      expect(chat.resolveStreamId).toHaveBeenCalledWith('club', undefined);
      expect(sock._joinedRooms).toEqual(['stream:sDefault']);
    });

    it('streamId=null (org/stream not found) → emits error and does NOT join', async () => {
      chat.resolveStreamId.mockResolvedValue(null);
      const sock = makeSocket('s4');
      await gateway.handleJoin(sock as any, { orgSlug: 'nope', streamSlug: 'x' });
      expect(sock._joinedRooms).toEqual([]);
      expect(sock._emitted.find((e) => e.event === 'error')).toBeTruthy();
    });

    it('two clients on same Stream SHARE its room', async () => {
      chat.resolveStreamId.mockResolvedValue('sA');
      const a = makeSocket('a1');
      const b = makeSocket('b1');
      await gateway.handleJoin(a as any, { orgSlug: 'club', streamSlug: 'mat-a' });
      await gateway.handleJoin(b as any, { orgSlug: 'club', streamSlug: 'mat-a' });

      expect(a._joinedRooms).toEqual(['stream:sA']);
      expect(b._joinedRooms).toEqual(['stream:sA']);

      // Viewer count в room растёт совместно: a видит 1, b видит 2.
      const aViewers = a._emitted.filter((e) => e.event === 'viewers');
      const bViewers = b._emitted.filter((e) => e.event === 'viewers');
      expect(aViewers[aViewers.length - 1].payload).toBe(1);
      expect(bViewers[bViewers.length - 1].payload).toBe(2);
    });

    it('switching Streams in same SPA session: leaves prev room and decrements its viewers', async () => {
      // c1 заходит на Stream A.
      chat.resolveStreamId.mockResolvedValueOnce('sA');
      const c1 = makeSocket('c1');
      await gateway.handleJoin(c1 as any, { orgSlug: 'club', streamSlug: 'mat-a' });
      // ...затем тот же сокет (SPA-навигация) переключается на Stream B.
      chat.resolveStreamId.mockResolvedValueOnce('sB');
      await gateway.handleJoin(c1 as any, { orgSlug: 'club', streamSlug: 'mat-b' });

      // c1 покинул stream:sA → последний broadcast "viewers=0" в stream:sA
      // (после join первый broadcast был "viewers=1" — берём именно последний).
      const sAViewerBroadcasts = c1._toEmits.filter(
        (e) => e.room === 'stream:sA' && e.event === 'viewers',
      );
      expect(sAViewerBroadcasts[sAViewerBroadcasts.length - 1]?.payload).toBe(0);
      // И теперь только в stream:sB.
      expect(c1._joinedRooms).toEqual(['stream:sB']);
    });
  });

  describe('handleMessage — посылает в room текущего стрима', () => {
    it('two clients on same Stream see each others messages', async () => {
      chat.resolveStreamId.mockResolvedValue('sA');
      const a = makeSocket('alice');
      const b = makeSocket('bob');
      await gateway.handleJoin(a as any, { orgSlug: 'club', streamSlug: 'mat-a' });
      await gateway.handleJoin(b as any, { orgSlug: 'club', streamSlug: 'mat-a' });

      chat.writeMessage.mockResolvedValueOnce({
        id: 'm1', nickname: 'Alice', content: 'hi stream', createdAt: new Date(),
      });

      await gateway.handleMessage(a as any, { nickname: 'Alice', content: 'hi stream' });

      // a получил свой message локально.
      expect(a._emitted.find((e) => e.event === 'message')?.payload.content).toBe('hi stream');
      // Broadcast пошёл в room стрима → b его получит (через socket.io to(room).emit).
      const broadcast = a._toEmits.find((e) => e.event === 'message');
      expect(broadcast?.room).toBe('stream:sA');
      expect(chat.writeMessage).toHaveBeenCalledWith('sA', 'Alice', 'hi stream');
    });

    it('different Streams are isolated', async () => {
      const a = makeSocket('a');
      const b = makeSocket('b');
      chat.resolveStreamId.mockResolvedValueOnce('sA');
      await gateway.handleJoin(a as any, { orgSlug: 'club', streamSlug: 'mat-a' });
      chat.resolveStreamId.mockResolvedValueOnce('sB');
      await gateway.handleJoin(b as any, { orgSlug: 'club', streamSlug: 'mat-b' });

      chat.writeMessage.mockResolvedValueOnce({
        id: 'm2', nickname: 'A', content: 'only A', createdAt: new Date(),
      });
      await gateway.handleMessage(a as any, { nickname: 'A', content: 'only A' });

      const broadcasts = a._toEmits.filter((e) => e.event === 'message');
      expect(broadcasts).toHaveLength(1);
      expect(broadcasts[0].room).toBe('stream:sA');
      expect(broadcasts[0].room).not.toBe('stream:sB');
      expect(b._emitted.find((e) => e.event === 'message')).toBeUndefined();
    });

    it('room стабильна на весь сеанс — handleMessage не резолвит streamId заново', async () => {
      chat.resolveStreamId.mockResolvedValueOnce('sA');
      const sock = makeSocket('stable');
      await gateway.handleJoin(sock as any, { orgSlug: 'club', streamSlug: 'mat-a' });
      chat.resolveStreamId.mockClear();

      chat.writeMessage.mockResolvedValueOnce({
        id: 'm1', nickname: 'A', content: 'hello', createdAt: new Date(),
      });
      await gateway.handleMessage(sock as any, { nickname: 'A', content: 'hello' });

      // handleMessage использует кэшированный streamId из join, без повторного resolve.
      expect(chat.resolveStreamId).not.toHaveBeenCalled();
      expect(chat.writeMessage).toHaveBeenCalledWith('sA', 'A', 'hello');
      expect(sock._joinedRooms).toEqual(['stream:sA']);
    });

    it('socket без предварительного join не сохраняет и не броадкастит', async () => {
      const orphan = makeSocket('orphan');
      await gateway.handleMessage(orphan as any, { nickname: 'X', content: 'hi' });
      expect(chat.writeMessage).not.toHaveBeenCalled();
      expect(orphan._toEmits).toHaveLength(0);
    });

    it('chat выключен (writeMessage вернул null) → клиенту emit chat_enabled=false', async () => {
      chat.resolveStreamId.mockResolvedValue('sA');
      const sock = makeSocket('s');
      await gateway.handleJoin(sock as any, { orgSlug: 'club', streamSlug: 'mat-a' });

      chat.writeMessage.mockResolvedValueOnce(null);
      chat.isChatEnabled.mockResolvedValueOnce(false);
      await gateway.handleMessage(sock as any, { nickname: 'X', content: 'hi' });

      const chatEnabledEvents = sock._emitted.filter((e) => e.event === 'chat_enabled');
      // Хотя бы один из них — false (последний после message).
      expect(chatEnabledEvents[chatEnabledEvents.length - 1].payload).toBe(false);
    });
  });

  describe('handleDisconnect — очищает internal maps', () => {
    it('удаляет socketStreamId и socketOrg записи', async () => {
      chat.resolveStreamId.mockResolvedValue('sA');
      const sock = makeSocket('disc');
      await gateway.handleJoin(sock as any, { orgSlug: 'club', streamSlug: 'mat-a' });

      gateway.handleDisconnect(sock as any);

      // После disconnect повторный message от того же socketId ничего не делает.
      await gateway.handleMessage(sock as any, { nickname: 'X', content: 'hi' });
      expect(chat.writeMessage).not.toHaveBeenCalled();
    });
  });

  describe('broadcastChatEnabled / broadcastChatCleared — мульти-room по orgSlug', () => {
    it('broadcastChatEnabled рассылается во все rooms, где есть зрители орги', async () => {
      // Подписываем 2 клиентов на разные Stream'ы одной орги.
      chat.resolveStreamId.mockResolvedValueOnce('sA');
      const a = makeSocket('a');
      await gateway.handleJoin(a as any, { orgSlug: 'club', streamSlug: 'mat-a' });
      chat.resolveStreamId.mockResolvedValueOnce('sB');
      const b = makeSocket('b');
      await gateway.handleJoin(b as any, { orgSlug: 'club', streamSlug: 'mat-b' });

      const toMock = gateway.server.to as jest.Mock;
      toMock.mockClear();
      gateway.broadcastChatEnabled('club', false);
      const calledRooms = toMock.mock.calls.map((c) => c[0]).sort();
      expect(calledRooms).toEqual(['stream:sA', 'stream:sB']);
    });

    it('broadcastChatCleared со streamId шлёт только в room этого стрима', async () => {
      const toMock = gateway.server.to as jest.Mock;
      toMock.mockClear();
      gateway.broadcastChatCleared('club', 'sA');
      expect(toMock).toHaveBeenCalledWith('stream:sA');
      expect(toMock).toHaveBeenCalledTimes(1);
    });
  });
});
