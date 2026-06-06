import { Test } from '@nestjs/testing';
import { ChatService, scopeRoomKey } from './chat.service';
import { PrismaService } from '../prisma/prisma.service';

const mockPrisma = {
  stream: { findFirst: jest.fn(), findUnique: jest.fn() },
  event: { findUnique: jest.fn() },
  organization: { findUnique: jest.fn(), findMany: jest.fn() },
  chatMessage: {
    create: jest.fn(),
    findMany: jest.fn(),
    deleteMany: jest.fn(),
  },
};

describe('ChatService — scope-based persistence (Step 5 B2)', () => {
  let service: ChatService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [ChatService, { provide: PrismaService, useValue: mockPrisma }],
    }).compile();
    service = module.get(ChatService);
  });

  describe('scopeRoomKey', () => {
    it('event scope', () => {
      expect(scopeRoomKey({ type: 'event', eventId: 'e1' })).toBe('event:e1');
    });
    it('stream scope', () => {
      expect(scopeRoomKey({ type: 'stream', streamId: 's1' })).toBe('stream:s1');
    });
  });

  describe('resolveScope', () => {
    it('returns event scope when Stream is in active Event', async () => {
      mockPrisma.stream.findFirst.mockResolvedValue({
        id: 'sA',
        eventStreams: [{ eventId: 'evt1' }],
      });
      const scope = await service.resolveScope('club', 'mat-a');
      expect(scope).toEqual({ type: 'event', eventId: 'evt1' });
      // Karen H4: eventStreams сабселект должен использовать orderBy startedAt DESC
      // — синхронизировано со всеми остальными точками резолва активного Event'а.
      const callArgs = mockPrisma.stream.findFirst.mock.calls[0][0];
      expect(callArgs.select.eventStreams.orderBy).toEqual({
        event: { startedAt: 'desc' },
      });
    });

    it('returns stream scope when Stream has NO active Event', async () => {
      mockPrisma.stream.findFirst.mockResolvedValue({
        id: 'sA',
        eventStreams: [],
      });
      const scope = await service.resolveScope('club', 'mat-a');
      expect(scope).toEqual({ type: 'stream', streamId: 'sA' });
    });

    it('returns null when org/stream not found', async () => {
      mockPrisma.stream.findFirst.mockResolvedValue(null);
      const scope = await service.resolveScope('nope', 'x');
      expect(scope).toBeNull();
    });

    it('empty streamSlug → ищет default Stream (slug="")', async () => {
      mockPrisma.stream.findFirst.mockResolvedValue({
        id: 'sDefault',
        eventStreams: [],
      });
      await service.resolveScope('club');
      const call = mockPrisma.stream.findFirst.mock.calls[0][0];
      expect(call.where.slug).toBe('');
    });

    it('omitted streamSlug also resolves to default Stream', async () => {
      mockPrisma.stream.findFirst.mockResolvedValue({
        id: 'sDefault',
        eventStreams: [],
      });
      await service.resolveScope('club', '');
      const call = mockPrisma.stream.findFirst.mock.calls[0][0];
      expect(call.where.slug).toBe('');
    });
  });

  describe('writeMessage', () => {
    beforeEach(() => {
      // По умолчанию chat включён.
      mockPrisma.stream.findUnique.mockResolvedValue({
        orgId: 'o1',
        org: { chatTtlMinutes: 180, chatEnabled: true },
      });
      mockPrisma.event.findUnique.mockResolvedValue({
        orgId: 'o1',
        org: { chatTtlMinutes: 180, chatEnabled: true },
      });
    });

    it('event scope: saves with eventId FK only (NO orgId, NO streamId)', async () => {
      mockPrisma.chatMessage.create.mockResolvedValue({
        id: 'm1', nickname: 'A', content: 'hi', createdAt: new Date(),
      });
      await service.writeMessage({ type: 'event', eventId: 'evt1' }, 'A', 'hi');
      const call = mockPrisma.chatMessage.create.mock.calls[0][0];
      expect(call.data.eventId).toBe('evt1');
      expect(call.data.streamId).toBeUndefined();
      expect(call.data.orgId).toBeUndefined();
    });

    it('stream scope: saves with streamId FK only', async () => {
      mockPrisma.chatMessage.create.mockResolvedValue({
        id: 'm1', nickname: 'A', content: 'hi', createdAt: new Date(),
      });
      await service.writeMessage({ type: 'stream', streamId: 'sA' }, 'A', 'hi');
      const call = mockPrisma.chatMessage.create.mock.calls[0][0];
      expect(call.data.streamId).toBe('sA');
      expect(call.data.eventId).toBeUndefined();
      expect(call.data.orgId).toBeUndefined();
    });

    it('content is truncated to 500 chars', async () => {
      mockPrisma.chatMessage.create.mockResolvedValue({
        id: 'm', nickname: 'A', content: 'x', createdAt: new Date(),
      });
      const long = 'a'.repeat(700);
      await service.writeMessage({ type: 'stream', streamId: 'sA' }, 'A', long);
      const call = mockPrisma.chatMessage.create.mock.calls[0][0];
      expect(call.data.content).toHaveLength(500);
    });

    it('returns null when chat disabled on org', async () => {
      mockPrisma.stream.findUnique.mockResolvedValue({
        orgId: 'o1',
        org: { chatTtlMinutes: 180, chatEnabled: false },
      });
      const r = await service.writeMessage({ type: 'stream', streamId: 'sA' }, 'A', 'hi');
      expect(r).toBeNull();
      expect(mockPrisma.chatMessage.create).not.toHaveBeenCalled();
    });
  });

  describe('listMessages', () => {
    beforeEach(() => {
      mockPrisma.chatMessage.findMany.mockResolvedValue([]);
    });

    it('event scope: filters by eventId only', async () => {
      mockPrisma.event.findUnique.mockResolvedValue({
        orgId: 'o1',
        org: { chatTtlMinutes: 180, chatEnabled: true },
      });
      await service.listMessages({ type: 'event', eventId: 'evt1' });
      const call = mockPrisma.chatMessage.findMany.mock.calls[0][0];
      expect(call.where.eventId).toBe('evt1');
    });

    it('stream scope (non-default Stream): filters by streamId only', async () => {
      mockPrisma.stream.findUnique.mockResolvedValue({
        orgId: 'o1',
        slug: 'mat-a',
        org: { chatTtlMinutes: 180, chatEnabled: true },
      });
      await service.listMessages({ type: 'stream', streamId: 'sA' });
      const call = mockPrisma.chatMessage.findMany.mock.calls[0][0];
      expect(call.where.streamId).toBe('sA');
      expect(call.where.OR).toBeUndefined();
    });

    it('stream scope (default Stream): OR-фильтр включает legacy orgId-сообщения', async () => {
      // getOrgMetaForScope использует первый findUnique-вызов (returns stream).
      // Затем listMessages второй раз вызывает findUnique для streamMeta (slug check).
      // Замокаем оба вызова одинаково.
      mockPrisma.stream.findUnique.mockResolvedValue({
        orgId: 'o1',
        slug: '',
        org: { chatTtlMinutes: 180, chatEnabled: true },
      });
      await service.listMessages({ type: 'stream', streamId: 'sDefault' });
      const call = mockPrisma.chatMessage.findMany.mock.calls[0][0];
      // where.AND[1].OR содержит и {streamId} и {orgId, streamId:null}.
      const andClause = call.where.AND;
      expect(Array.isArray(andClause)).toBe(true);
      const orClause = andClause[1].OR;
      expect(orClause).toEqual(
        expect.arrayContaining([
          { streamId: 'sDefault' },
          { orgId: 'o1', streamId: null, eventId: null },
        ]),
      );
    });

    it('reverses messages (DB returns DESC, client gets ASC)', async () => {
      mockPrisma.stream.findUnique.mockResolvedValue({
        orgId: 'o1',
        slug: 'mat-a',
        org: { chatTtlMinutes: 180, chatEnabled: true },
      });
      mockPrisma.chatMessage.findMany.mockResolvedValue([
        { id: 'm3', nickname: 'C', content: '3', createdAt: new Date(3000) },
        { id: 'm2', nickname: 'B', content: '2', createdAt: new Date(2000) },
        { id: 'm1', nickname: 'A', content: '1', createdAt: new Date(1000) },
      ]);
      const r = await service.listMessages({ type: 'stream', streamId: 'sA' });
      expect(r.messages.map((m) => m.id)).toEqual(['m1', 'm2', 'm3']);
    });

    it('returns ttlMinutes from org', async () => {
      mockPrisma.stream.findUnique.mockResolvedValue({
        orgId: 'o1',
        slug: 'mat-a',
        org: { chatTtlMinutes: 60, chatEnabled: true },
      });
      const r = await service.listMessages({ type: 'stream', streamId: 'sA' });
      expect(r.ttlMinutes).toBe(60);
    });
  });

  describe('clearMessagesByScope', () => {
    it('event scope: deletes by eventId', async () => {
      mockPrisma.chatMessage.deleteMany.mockResolvedValue({ count: 3 });
      const r = await service.clearMessagesByScope({ type: 'event', eventId: 'evt1' });
      const call = mockPrisma.chatMessage.deleteMany.mock.calls[0][0];
      expect(call.where.eventId).toBe('evt1');
      expect(r.deleted).toBe(3);
    });

    it('stream scope (default Stream): deletes by streamId OR legacy orgId', async () => {
      mockPrisma.stream.findUnique.mockResolvedValue({ orgId: 'o1', slug: '' });
      mockPrisma.chatMessage.deleteMany.mockResolvedValue({ count: 7 });
      await service.clearMessagesByScope({ type: 'stream', streamId: 'sDefault' });
      const call = mockPrisma.chatMessage.deleteMany.mock.calls[0][0];
      expect(call.where.OR).toEqual(
        expect.arrayContaining([
          { streamId: 'sDefault' },
          { orgId: 'o1', streamId: null, eventId: null },
        ]),
      );
    });

    it('stream scope (named Stream): deletes by streamId only', async () => {
      mockPrisma.stream.findUnique.mockResolvedValue({ orgId: 'o1', slug: 'mat-a' });
      mockPrisma.chatMessage.deleteMany.mockResolvedValue({ count: 2 });
      await service.clearMessagesByScope({ type: 'stream', streamId: 'sA' });
      const call = mockPrisma.chatMessage.deleteMany.mock.calls[0][0];
      expect(call.where.streamId).toBe('sA');
      expect(call.where.OR).toBeUndefined();
    });
  });

  describe('clearMessages (legacy orgId-based)', () => {
    it('routes to default Stream scope when one exists', async () => {
      mockPrisma.stream.findFirst.mockResolvedValue({ id: 'sDefault' });
      // Затем clearMessagesByScope сделает second findUnique для slug.
      mockPrisma.stream.findUnique.mockResolvedValue({ orgId: 'o1', slug: '' });
      mockPrisma.chatMessage.deleteMany.mockResolvedValue({ count: 4 });
      const r = await service.clearMessages('o1');
      expect(r.deleted).toBe(4);
    });

    it('falls back to orgId-deletion when default Stream missing', async () => {
      mockPrisma.stream.findFirst.mockResolvedValue(null);
      mockPrisma.chatMessage.deleteMany.mockResolvedValue({ count: 9 });
      const r = await service.clearMessages('o1');
      const call = mockPrisma.chatMessage.deleteMany.mock.calls[0][0];
      expect(call.where.orgId).toBe('o1');
      expect(r.deleted).toBe(9);
    });
  });

  describe('isChatEnabled (legacy)', () => {
    it('returns true when org.chatEnabled !== false', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue({ chatEnabled: true });
      expect(await service.isChatEnabled('club')).toBe(true);
    });

    it('returns false when org.chatEnabled === false', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue({ chatEnabled: false });
      expect(await service.isChatEnabled('club')).toBe(false);
    });

    it('returns true when org not found (default)', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue(null);
      expect(await service.isChatEnabled('nope')).toBe(true);
    });
  });

  describe('cleanupOldMessages', () => {
    it('iterates orgs and deletes stale messages via stream/event association', async () => {
      mockPrisma.organization.findMany.mockResolvedValue([
        { id: 'o1', chatTtlMinutes: 60 },
        { id: 'o2', chatTtlMinutes: 5 },
      ]);
      mockPrisma.chatMessage.deleteMany.mockResolvedValue({ count: 1 });
      await service.cleanupOldMessages();
      // 2 org-итерации + 1 orphan-чистка (Karen C3).
      expect(mockPrisma.chatMessage.deleteMany).toHaveBeenCalledTimes(3);
      const firstCall = mockPrisma.chatMessage.deleteMany.mock.calls[0][0];
      // OR-фильтр включает orgId, stream.orgId, event.orgId.
      expect(firstCall.where.OR).toEqual(
        expect.arrayContaining([
          { orgId: 'o1' },
          { stream: { orgId: 'o1' } },
          { event: { orgId: 'o1' } },
        ]),
      );
    });

    // Karen C3 (Step 5): orphan-сообщения с обнулёнными FK
    // (orgId/streamId/eventId все null) не подбираются ни одной org-итерацией.
    // Добавлен отдельный deleteMany со всеми FK=null.
    it('also deletes orphan messages with all FKs null (Karen C3)', async () => {
      mockPrisma.organization.findMany.mockResolvedValue([]);
      mockPrisma.chatMessage.deleteMany.mockResolvedValue({ count: 0 });
      await service.cleanupOldMessages();
      // Даже без орг хотя бы одна вызов — orphan cleanup.
      expect(mockPrisma.chatMessage.deleteMany).toHaveBeenCalledTimes(1);
      const orphanCall = mockPrisma.chatMessage.deleteMany.mock.calls[0][0];
      expect(orphanCall.where).toEqual(
        expect.objectContaining({
          orgId: null,
          streamId: null,
          eventId: null,
          createdAt: { lt: expect.any(Date) },
        }),
      );
    });
  });
});
