import { Test } from '@nestjs/testing';
import { ChatGateway } from './chat.gateway';
import { ChatService, ChatScope } from './chat.service';

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

describe('ChatGateway — scope-based rooms (Step 5 B2)', () => {
  let gateway: ChatGateway;
  let chat: {
    resolveScope: jest.Mock;
    writeMessage: jest.Mock;
    listMessages: jest.Mock;
    isChatEnabled: jest.Mock;
  };

  beforeEach(async () => {
    chat = {
      resolveScope: jest.fn(),
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

  describe('handleJoin — room key derived from resolved scope', () => {
    it('stream scope (no active Event) → room "stream:<streamId>"', async () => {
      chat.resolveScope.mockResolvedValue({ type: 'stream', streamId: 'sA' });
      const sock = makeSocket('s1');
      await gateway.handleJoin(sock as any, { orgSlug: 'club', streamSlug: 'mat-a' });
      expect(sock._joinedRooms).toEqual(['stream:sA']);
    });

    it('event scope (Stream in active Event) → room "event:<eventId>"', async () => {
      chat.resolveScope.mockResolvedValue({ type: 'event', eventId: 'evt1' });
      const sock = makeSocket('s2');
      await gateway.handleJoin(sock as any, { orgSlug: 'club', streamSlug: 'mat-a' });
      expect(sock._joinedRooms).toEqual(['event:evt1']);
    });

    it('omitted streamSlug → resolveScope receives undefined and joins default Stream', async () => {
      chat.resolveScope.mockResolvedValue({ type: 'stream', streamId: 'sDefault' });
      const sock = makeSocket('s3');
      await gateway.handleJoin(sock as any, { orgSlug: 'club' });
      expect(chat.resolveScope).toHaveBeenCalledWith('club', undefined);
      expect(sock._joinedRooms).toEqual(['stream:sDefault']);
    });

    it('scope=null (org/stream not found) → emits error and does NOT join', async () => {
      chat.resolveScope.mockResolvedValue(null);
      const sock = makeSocket('s4');
      await gateway.handleJoin(sock as any, { orgSlug: 'nope', streamSlug: 'x' });
      expect(sock._joinedRooms).toEqual([]);
      expect(sock._emitted.find((e) => e.event === 'error')).toBeTruthy();
    });

    it('two clients on different Streams of SAME active Event SHARE event-room', async () => {
      // Stream A и Stream B оба резолвятся в одинаковый event scope.
      chat.resolveScope.mockResolvedValue({ type: 'event', eventId: 'evt1' });
      const a = makeSocket('a1');
      const b = makeSocket('b1');
      await gateway.handleJoin(a as any, { orgSlug: 'club', streamSlug: 'mat-a' });
      await gateway.handleJoin(b as any, { orgSlug: 'club', streamSlug: 'mat-b' });

      // Оба в комнате event:evt1.
      expect(a._joinedRooms).toEqual(['event:evt1']);
      expect(b._joinedRooms).toEqual(['event:evt1']);

      // Viewer count в event-room растёт совместно: a видит 1, b видит 2.
      const aViewers = a._emitted.filter((e) => e.event === 'viewers');
      const bViewers = b._emitted.filter((e) => e.event === 'viewers');
      expect(aViewers[aViewers.length - 1].payload).toBe(1);
      expect(bViewers[bViewers.length - 1].payload).toBe(2);
    });

    it('switching from stream-room to event-room: leaves prev and decrements its viewers', async () => {
      // c1 заходит в stream-scope (Event ещё не начался).
      chat.resolveScope.mockResolvedValueOnce({ type: 'stream', streamId: 'sA' });
      const c1 = makeSocket('c1');
      await gateway.handleJoin(c1 as any, { orgSlug: 'club', streamSlug: 'mat-a' });
      // ...затем Event стартует и тот же сокет (по reconnect/SPA-навигации)
      // получает event scope.
      chat.resolveScope.mockResolvedValueOnce({ type: 'event', eventId: 'evt1' });
      await gateway.handleJoin(c1 as any, { orgSlug: 'club', streamSlug: 'mat-a' });

      // c1 покинул stream:sA → последний broadcast "viewers=0" в stream:sA
      // (после join первый broadcast был "viewers=1" — берём именно последний).
      const sAViewerBroadcasts = c1._toEmits.filter(
        (e) => e.room === 'stream:sA' && e.event === 'viewers',
      );
      expect(sAViewerBroadcasts[sAViewerBroadcasts.length - 1]?.payload).toBe(0);
      // И теперь только в event:evt1.
      expect(c1._joinedRooms).toEqual(['event:evt1']);
    });
  });

  describe('handleMessage — посылает в room текущего scope', () => {
    it('event scope: two clients on different Streams of same Event see each others messages', async () => {
      chat.resolveScope.mockResolvedValue({ type: 'event', eventId: 'evt1' });
      const a = makeSocket('alice');
      const b = makeSocket('bob');
      await gateway.handleJoin(a as any, { orgSlug: 'club', streamSlug: 'mat-a' });
      await gateway.handleJoin(b as any, { orgSlug: 'club', streamSlug: 'mat-b' });

      chat.writeMessage.mockResolvedValueOnce({
        id: 'm1', nickname: 'Alice', content: 'hi event', createdAt: new Date(),
      });

      await gateway.handleMessage(a as any, { nickname: 'Alice', content: 'hi event' });

      // a получил свой message локально.
      expect(a._emitted.find((e) => e.event === 'message')?.payload.content).toBe('hi event');
      // Broadcast пошёл в event-room → b его получит (через socket.io to(room).emit).
      const broadcast = a._toEmits.find((e) => e.event === 'message');
      expect(broadcast?.room).toBe('event:evt1');
      // writeMessage был вызван со scope=event.
      expect(chat.writeMessage).toHaveBeenCalledWith(
        { type: 'event', eventId: 'evt1' },
        'Alice',
        'hi event',
      );
    });

    it('stream scope: different Streams (Event ended) are isolated', async () => {
      const a = makeSocket('a');
      const b = makeSocket('b');
      chat.resolveScope.mockResolvedValueOnce({ type: 'stream', streamId: 'sA' });
      await gateway.handleJoin(a as any, { orgSlug: 'club', streamSlug: 'mat-a' });
      chat.resolveScope.mockResolvedValueOnce({ type: 'stream', streamId: 'sB' });
      await gateway.handleJoin(b as any, { orgSlug: 'club', streamSlug: 'mat-b' });

      // Step 5 Karen C2: handleMessage делает re-resolve scope каждый раз.
      // Для сообщения от `a` (streamSlug=mat-a) re-resolve должен вернуть
      // тот же stream:sA scope, чтобы actual==cached → миграции не будет.
      chat.resolveScope.mockResolvedValueOnce({ type: 'stream', streamId: 'sA' });
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

    it('socket без предварительного join не сохраняет и не броадкастит', async () => {
      const orphan = makeSocket('orphan');
      await gateway.handleMessage(orphan as any, { nickname: 'X', content: 'hi' });
      expect(chat.writeMessage).not.toHaveBeenCalled();
      expect(orphan._toEmits).toHaveLength(0);
    });

    // Karen C2 (Step 5): scope re-resolve в handleMessage. Если за время сессии
    // Event.start/end изменил резолв scope'а (stream → event или наоборот),
    // следующий message должен уйти в актуальный room, а socket — мигрировать.
    it('re-resolves scope on each message (Event.start mid-session) — message goes to event-room', async () => {
      // Изначально join'имся в stream-scope.
      chat.resolveScope.mockResolvedValueOnce({ type: 'stream', streamId: 'sA' });
      const sock = makeSocket('migrant');
      await gateway.handleJoin(sock as any, { orgSlug: 'club', streamSlug: 'mat-a' });
      expect(sock._joinedRooms).toEqual(['stream:sA']);

      // Event стартанул — следующий resolveScope (вызванный из handleMessage)
      // вернёт event-scope.
      chat.resolveScope.mockResolvedValueOnce({ type: 'event', eventId: 'evt1' });
      chat.writeMessage.mockResolvedValueOnce({
        id: 'm1', nickname: 'A', content: 'hello', createdAt: new Date(),
      });

      await gateway.handleMessage(sock as any, { nickname: 'A', content: 'hello' });

      // writeMessage был вызван с НОВЫМ event-scope, не cached stream-scope.
      expect(chat.writeMessage).toHaveBeenCalledWith(
        { type: 'event', eventId: 'evt1' },
        'A',
        'hello',
      );
      // Broadcast пошёл в event-room.
      const messageBroadcasts = sock._toEmits.filter((e) => e.event === 'message');
      expect(messageBroadcasts[messageBroadcasts.length - 1].room).toBe('event:evt1');
      // Socket мигрировал: leave stream:sA, join event:evt1.
      expect(sock._joinedRooms).toEqual(['event:evt1']);
    });

    it('re-resolved scope returns null mid-session → message dropped silently', async () => {
      chat.resolveScope.mockResolvedValueOnce({ type: 'stream', streamId: 'sA' });
      const sock = makeSocket('dropped');
      await gateway.handleJoin(sock as any, { orgSlug: 'club', streamSlug: 'mat-a' });

      // Орга/стрим исчезли (org deleted?). resolveScope returns null.
      chat.resolveScope.mockResolvedValueOnce(null);
      await gateway.handleMessage(sock as any, { nickname: 'X', content: 'hi' });

      expect(chat.writeMessage).not.toHaveBeenCalled();
    });

    it('chat выключен (writeMessage вернул null) → клиенту emit chat_enabled=false', async () => {
      chat.resolveScope.mockResolvedValue({ type: 'stream', streamId: 'sA' });
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

  describe('broadcastChatEnabled / broadcastChatCleared — мульти-room по orgSlug', () => {
    it('broadcastChatEnabled рассылается во все rooms, где есть зрители орги', async () => {
      // Подписываем 2 клиентов в разные scope'ы одной орги (event+stream).
      chat.resolveScope.mockResolvedValueOnce({ type: 'event', eventId: 'evt1' });
      const a = makeSocket('a');
      await gateway.handleJoin(a as any, { orgSlug: 'club', streamSlug: 'mat-a' });
      chat.resolveScope.mockResolvedValueOnce({ type: 'stream', streamId: 'sB' });
      const b = makeSocket('b');
      await gateway.handleJoin(b as any, { orgSlug: 'club', streamSlug: 'mat-b' });

      const toMock = gateway.server.to as jest.Mock;
      toMock.mockClear();
      gateway.broadcastChatEnabled('club', false);
      const calledRooms = toMock.mock.calls.map((c) => c[0]).sort();
      expect(calledRooms).toEqual(['event:evt1', 'stream:sB']);
    });

    it('broadcastChatCleared со scope шлёт только в этот scope-room', async () => {
      const scope: ChatScope = { type: 'event', eventId: 'evt1' };
      const toMock = gateway.server.to as jest.Mock;
      toMock.mockClear();
      gateway.broadcastChatCleared('club', scope);
      expect(toMock).toHaveBeenCalledWith('event:evt1');
      expect(toMock).toHaveBeenCalledTimes(1);
    });
  });
});
