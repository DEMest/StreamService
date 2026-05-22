import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { StudioGateway } from './studio.gateway';
import { PrismaService } from '../prisma/prisma.service';
import { SlotStateService } from '../stream/slot-state.service';

type EmittedEvent = { event: string; payload: any };

/**
 * Lightweight Socket-like stub. Записывает все emit'ы и .to(room).emit'ы
 * в массив, чтобы тесты могли проверить что отправили клиенту.
 */
function makeSocket(id: string, opts: { cookie?: string } = {}) {
  const emitted: EmittedEvent[] = [];
  const joinedRooms: string[] = [];
  let disconnected = false;
  return {
    id,
    handshake: { headers: { cookie: opts.cookie ?? '' } },
    data: {} as { user?: any },
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
    disconnect: jest.fn(() => {
      disconnected = true;
    }),
    // helpers для тестов
    _emitted: emitted,
    _joinedRooms: joinedRooms,
    _isDisconnected: () => disconnected,
  };
}

function makeServer() {
  const roomEmits: { room: string; event: string; payload: any }[] = [];
  // Capture namespace middleware (afterInit ставит его прямо через `server.use`)
  const middlewares: Array<(socket: any, next: (err?: Error) => void) => void> = [];
  const server: any = {
    to: jest.fn((room: string) => ({
      emit: jest.fn((event: string, payload: any) => {
        roomEmits.push({ room, event, payload });
      }),
    })),
    use: jest.fn((mw: any) => {
      middlewares.push(mw);
    }),
    _roomEmits: roomEmits,
    _middlewares: middlewares,
  };
  return server;
}

describe('StudioGateway', () => {
  let gateway: StudioGateway;
  let slotState: SlotStateService;
  let prisma: { stream: { findUnique: jest.Mock } };
  let jwt: { verifyAsync: jest.Mock };

  beforeEach(async () => {
    prisma = { stream: { findUnique: jest.fn() } };
    jwt = { verifyAsync: jest.fn() };

    const module = await Test.createTestingModule({
      providers: [
        StudioGateway,
        SlotStateService,
        { provide: PrismaService, useValue: prisma },
        { provide: JwtService, useValue: jwt },
      ],
    }).compile();

    gateway = module.get(StudioGateway);
    slotState = module.get(SlotStateService);

    // Имитируем afterInit — подписываемся на slotState events
    const server = makeServer();
    gateway.server = server as any;
    gateway.afterInit(server as any);
  });

  afterEach(() => {
    gateway.onModuleDestroy();
  });

  describe('handleConnection', () => {
    it('disconnects sockets without valid JWT', async () => {
      const sock = makeSocket('s1', { cookie: '' });
      await gateway.handleConnection(sock as any);
      expect(sock._isDisconnected()).toBe(true);
      expect(sock._emitted.find((e) => e.event === 'error')).toBeTruthy();
    });

    it('disconnects sockets with role other than org_admin/superadmin', async () => {
      jwt.verifyAsync.mockResolvedValue({ sub: 'u1', role: 'guest' });
      const sock = makeSocket('s2', { cookie: 'access_token=tok' });
      await gateway.handleConnection(sock as any);
      expect(sock._isDisconnected()).toBe(true);
    });

    it('attaches user to client.data on valid JWT', async () => {
      jwt.verifyAsync.mockResolvedValue({ sub: 'u1', role: 'org_admin', orgId: 'org-1' });
      const sock = makeSocket('s3', { cookie: 'access_token=tok' });
      await gateway.handleConnection(sock as any);
      expect(sock._isDisconnected()).toBe(false);
      expect(sock.data.user).toEqual({ sub: 'u1', role: 'org_admin', orgId: 'org-1' });
    });
  });

  describe('handleJoin', () => {
    it('emits forbidden error when stream belongs to a different org', async () => {
      const sock = makeSocket('s4');
      sock.data.user = { sub: 'u1', role: 'org_admin', orgId: 'org-A' };
      prisma.stream.findUnique.mockResolvedValue({ id: 'stream-1', orgId: 'org-B' });

      await gateway.handleJoin(sock as any, { streamId: 'stream-1' });

      const err = sock._emitted.find((e) => e.event === 'error');
      expect(err).toBeTruthy();
      expect(err?.payload.code).toBe('forbidden');
      expect(sock._joinedRooms).toEqual([]);
    });

    it('emits not_found when streamId does not exist', async () => {
      const sock = makeSocket('s5');
      sock.data.user = { sub: 'u1', role: 'org_admin', orgId: 'org-A' };
      prisma.stream.findUnique.mockResolvedValue(null);

      await gateway.handleJoin(sock as any, { streamId: 'missing' });

      const err = sock._emitted.find((e) => e.event === 'error');
      expect(err?.payload.code).toBe('not_found');
    });

    it('joins room and emits snapshot when org matches', async () => {
      const sock = makeSocket('s6');
      sock.data.user = { sub: 'u1', role: 'org_admin', orgId: 'org-A' };
      prisma.stream.findUnique.mockResolvedValue({ id: 'stream-1', orgId: 'org-A' });

      // Pre-populate slotState
      slotState.setPublishing('stream-1', 1, true);
      slotState.setBitrate('stream-1', 1, 4_000_000);
      slotState.setPublishing('stream-1', 2, false);

      await gateway.handleJoin(sock as any, { streamId: 'stream-1' });

      expect(sock._joinedRooms).toContain('studio:stream-1');
      const slotEvents = sock._emitted.filter((e) => e.event === 'slotState');
      expect(slotEvents).toHaveLength(2);
      expect(slotEvents.map((e) => e.payload.slotIndex).sort()).toEqual([1, 2]);
      expect(sock._emitted.find((e) => e.event === 'joined')).toBeTruthy();
    });

    it('allows superadmin to join any stream', async () => {
      const sock = makeSocket('s7');
      sock.data.user = { sub: 'admin', role: 'superadmin' };
      prisma.stream.findUnique.mockResolvedValue({ id: 'stream-X', orgId: 'org-other' });

      await gateway.handleJoin(sock as any, { streamId: 'stream-X' });

      expect(sock._joinedRooms).toContain('studio:stream-X');
    });

    // ─── Karen H3: socket switching between Streams must leave old room ────
    // Без leave старой комнаты socket продолжал бы получать `slotState`-события
    // от предыдущего Stream'а: например, owner открыл Stream A → переключился
    // на Stream B → в Studio UI прилетают обновления слотов Stream A
    // (вводит в заблуждение).
    it('leaves previous studio room when switching to another stream', async () => {
      const sock = makeSocket('switcher');
      sock.data.user = { sub: 'u1', role: 'org_admin', orgId: 'org-A' };

      // Join Stream A
      prisma.stream.findUnique.mockResolvedValueOnce({ id: 'stream-A', orgId: 'org-A' });
      await gateway.handleJoin(sock as any, { streamId: 'stream-A' });
      expect(sock._joinedRooms).toEqual(['studio:stream-A']);
      expect((sock.leave as jest.Mock)).not.toHaveBeenCalled();

      // Add leave() spy now that join already happened — switch to Stream B.
      (sock.leave as jest.Mock) = jest.fn();
      prisma.stream.findUnique.mockResolvedValueOnce({ id: 'stream-B', orgId: 'org-A' });
      await gateway.handleJoin(sock as any, { streamId: 'stream-B' });

      // Должен явно выйти из старой комнаты ДО join'а новой.
      expect((sock.leave as jest.Mock)).toHaveBeenCalledWith('studio:stream-A');
      expect(sock._joinedRooms).toContain('studio:stream-B');
    });

    it('does not call leave when joining the same room twice (idempotent re-join)', async () => {
      const sock = makeSocket('rejoin');
      sock.data.user = { sub: 'u1', role: 'org_admin', orgId: 'org-A' };
      prisma.stream.findUnique.mockResolvedValue({ id: 'stream-A', orgId: 'org-A' });

      await gateway.handleJoin(sock as any, { streamId: 'stream-A' });
      (sock.leave as jest.Mock) = jest.fn();
      await gateway.handleJoin(sock as any, { streamId: 'stream-A' });

      expect((sock.leave as jest.Mock)).not.toHaveBeenCalled();
    });
  });

  describe('namespace middleware (auth)', () => {
    it('отвергает (next с error) соединение без валидного JWT', async () => {
      const server = gateway.server as any;
      const mw = server._middlewares[0];
      expect(mw).toBeDefined();
      const sock = makeSocket('mw-1', { cookie: '' });
      const next = jest.fn();
      await mw(sock, next);
      expect(next).toHaveBeenCalledWith(expect.any(Error));
      expect(next.mock.calls[0][0].message).toBe('unauthorized');
      // client.data.user не проставлен → handleJoin не пройдёт
      expect(sock.data.user).toBeUndefined();
    });

    it('отвергает (next с error) соединение с неподходящей ролью', async () => {
      jwt.verifyAsync.mockResolvedValue({ sub: 'u1', role: 'guest' });
      const mw = (gateway.server as any)._middlewares[0];
      const sock = makeSocket('mw-2', { cookie: 'access_token=tok' });
      const next = jest.fn();
      await mw(sock, next);
      expect(next).toHaveBeenCalledWith(expect.any(Error));
      expect(next.mock.calls[0][0].message).toBe('forbidden');
    });

    it('пропускает org_admin и кладёт user в client.data.user', async () => {
      jwt.verifyAsync.mockResolvedValue({ sub: 'u1', role: 'org_admin', orgId: 'org-1' });
      const mw = (gateway.server as any)._middlewares[0];
      const sock = makeSocket('mw-3', { cookie: 'access_token=tok' });
      const next = jest.fn();
      await mw(sock, next);
      expect(next).toHaveBeenCalledWith(); // без аргумента = успех
      expect(sock.data.user).toEqual({ sub: 'u1', role: 'org_admin', orgId: 'org-1' });
    });

    it('unauthorized middleware блокирует доступ к handleJoin (нет user → bad_request)', async () => {
      // Имитируем: middleware отверг → client.data.user НЕ проставлен.
      // Если клиент всё же успел emit-нуть join (например handle-connection legacy),
      // handleJoin без user не присоединяет к комнате и эмитит unauthorized error.
      const sock = makeSocket('mw-4');
      // user отсутствует
      await gateway.handleJoin(sock as any, { streamId: 'any' });
      expect(sock._joinedRooms).toEqual([]);
      const err = sock._emitted.find((e) => e.event === 'error');
      expect(err?.payload.code).toBe('unauthorized');
    });
  });

  describe('slotState forwarding', () => {
    it('forwards SlotStateService events to studio:<streamId> room', () => {
      const server = gateway.server as any;

      slotState.setPublishing('stream-7', 3, true);

      // Один room-emit для setPublishing
      const forwarded = server._roomEmits.filter((e: any) => e.event === 'slotState');
      expect(forwarded).toHaveLength(1);
      expect(forwarded[0].room).toBe('studio:stream-7');
      expect(forwarded[0].payload.streamId).toBe('stream-7');
      expect(forwarded[0].payload.slotIndex).toBe(3);
      expect(forwarded[0].payload.isPublishing).toBe(true);
    });

    it('forwards bitrate updates to the correct room', () => {
      const server = gateway.server as any;

      slotState.setPublishing('stream-9', 1, true);
      server._roomEmits.length = 0; // reset
      slotState.setBitrate('stream-9', 1, 6_500_000);

      expect(server._roomEmits).toHaveLength(1);
      expect(server._roomEmits[0].room).toBe('studio:stream-9');
      expect(server._roomEmits[0].payload.bitrate).toBe(6_500_000);
    });
  });
});
