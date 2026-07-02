import { Test } from '@nestjs/testing';
import { ChatService, chatRoomKey } from './chat.service';
import { PrismaService } from '../prisma/prisma.service';

const mockPrisma = {
  stream: { findFirst: jest.fn(), findUnique: jest.fn() },
  organization: { findUnique: jest.fn(), findMany: jest.fn() },
  chatMessage: {
    create: jest.fn(),
    findMany: jest.fn(),
    deleteMany: jest.fn(),
  },
};

describe('ChatService — per-Stream chat', () => {
  let service: ChatService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [ChatService, { provide: PrismaService, useValue: mockPrisma }],
    }).compile();
    service = module.get(ChatService);
  });

  describe('chatRoomKey', () => {
    it('builds stream room key', () => {
      expect(chatRoomKey('s1')).toBe('stream:s1');
    });
  });

  describe('resolveStreamId', () => {
    it('returns streamId when Stream found', async () => {
      mockPrisma.stream.findFirst.mockResolvedValue({ id: 'sA' });
      const streamId = await service.resolveStreamId('club', 'mat-a');
      expect(streamId).toBe('sA');
    });

    it('returns null when org/stream not found', async () => {
      mockPrisma.stream.findFirst.mockResolvedValue(null);
      const streamId = await service.resolveStreamId('nope', 'x');
      expect(streamId).toBeNull();
    });

    it('empty streamSlug → ищет default Stream (slug="")', async () => {
      mockPrisma.stream.findFirst.mockResolvedValue({ id: 'sDefault' });
      await service.resolveStreamId('club');
      const call = mockPrisma.stream.findFirst.mock.calls[0][0];
      expect(call.where.slug).toBe('');
    });

    it('omitted streamSlug also resolves to default Stream', async () => {
      mockPrisma.stream.findFirst.mockResolvedValue({ id: 'sDefault' });
      await service.resolveStreamId('club', '');
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
    });

    it('saves with streamId FK only', async () => {
      mockPrisma.chatMessage.create.mockResolvedValue({
        id: 'm1', nickname: 'A', content: 'hi', createdAt: new Date(),
      });
      await service.writeMessage('sA', 'A', 'hi');
      const call = mockPrisma.chatMessage.create.mock.calls[0][0];
      expect(call.data.streamId).toBe('sA');
      expect(call.data.orgId).toBeUndefined();
    });

    it('content is truncated to 500 chars', async () => {
      mockPrisma.chatMessage.create.mockResolvedValue({
        id: 'm', nickname: 'A', content: 'x', createdAt: new Date(),
      });
      const long = 'a'.repeat(700);
      await service.writeMessage('sA', 'A', long);
      const call = mockPrisma.chatMessage.create.mock.calls[0][0];
      expect(call.data.content).toHaveLength(500);
    });

    it('returns null when chat disabled on org', async () => {
      mockPrisma.stream.findUnique.mockResolvedValue({
        orgId: 'o1',
        org: { chatTtlMinutes: 180, chatEnabled: false },
      });
      const r = await service.writeMessage('sA', 'A', 'hi');
      expect(r).toBeNull();
      expect(mockPrisma.chatMessage.create).not.toHaveBeenCalled();
    });
  });

  describe('listMessages', () => {
    beforeEach(() => {
      mockPrisma.chatMessage.findMany.mockResolvedValue([]);
    });

    it('non-default Stream: filters by streamId only', async () => {
      mockPrisma.stream.findUnique.mockResolvedValue({
        orgId: 'o1',
        slug: 'mat-a',
        org: { chatTtlMinutes: 180, chatEnabled: true },
      });
      await service.listMessages('sA');
      const call = mockPrisma.chatMessage.findMany.mock.calls[0][0];
      expect(call.where.streamId).toBe('sA');
      expect(call.where.OR).toBeUndefined();
    });

    it('default Stream: OR-фильтр включает legacy orgId-сообщения', async () => {
      // getOrgMetaForStream использует первый findUnique-вызов (returns stream).
      // Затем listMessages второй раз вызывает findUnique для streamMeta (slug check).
      // Замокаем оба вызова одинаково.
      mockPrisma.stream.findUnique.mockResolvedValue({
        orgId: 'o1',
        slug: '',
        org: { chatTtlMinutes: 180, chatEnabled: true },
      });
      await service.listMessages('sDefault');
      const call = mockPrisma.chatMessage.findMany.mock.calls[0][0];
      // where.AND[1].OR содержит и {streamId} и {orgId, streamId:null}.
      const andClause = call.where.AND;
      expect(Array.isArray(andClause)).toBe(true);
      const orClause = andClause[1].OR;
      expect(orClause).toEqual(
        expect.arrayContaining([
          { streamId: 'sDefault' },
          { orgId: 'o1', streamId: null },
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
      const r = await service.listMessages('sA');
      expect(r.messages.map((m) => m.id)).toEqual(['m1', 'm2', 'm3']);
    });

    it('returns ttlMinutes from org', async () => {
      mockPrisma.stream.findUnique.mockResolvedValue({
        orgId: 'o1',
        slug: 'mat-a',
        org: { chatTtlMinutes: 60, chatEnabled: true },
      });
      const r = await service.listMessages('sA');
      expect(r.ttlMinutes).toBe(60);
    });
  });

  describe('clearMessagesByStream', () => {
    it('default Stream: deletes by streamId OR legacy orgId', async () => {
      mockPrisma.stream.findUnique.mockResolvedValue({ orgId: 'o1', slug: '' });
      mockPrisma.chatMessage.deleteMany.mockResolvedValue({ count: 7 });
      await service.clearMessagesByStream('sDefault');
      const call = mockPrisma.chatMessage.deleteMany.mock.calls[0][0];
      expect(call.where.OR).toEqual(
        expect.arrayContaining([
          { streamId: 'sDefault' },
          { orgId: 'o1', streamId: null },
        ]),
      );
    });

    it('named Stream: deletes by streamId only', async () => {
      mockPrisma.stream.findUnique.mockResolvedValue({ orgId: 'o1', slug: 'mat-a' });
      mockPrisma.chatMessage.deleteMany.mockResolvedValue({ count: 2 });
      await service.clearMessagesByStream('sA');
      const call = mockPrisma.chatMessage.deleteMany.mock.calls[0][0];
      expect(call.where.streamId).toBe('sA');
      expect(call.where.OR).toBeUndefined();
    });
  });

  describe('clearMessages (legacy orgId-based)', () => {
    it('routes to default Stream when one exists', async () => {
      mockPrisma.stream.findFirst.mockResolvedValue({ id: 'sDefault' });
      // Затем clearMessagesByStream сделает second findUnique для slug.
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
    it('iterates orgs and deletes stale messages via stream association', async () => {
      mockPrisma.organization.findMany.mockResolvedValue([
        { id: 'o1', chatTtlMinutes: 60 },
        { id: 'o2', chatTtlMinutes: 5 },
      ]);
      mockPrisma.chatMessage.deleteMany.mockResolvedValue({ count: 1 });
      await service.cleanupOldMessages();
      // 2 org-итерации + 1 orphan-чистка.
      expect(mockPrisma.chatMessage.deleteMany).toHaveBeenCalledTimes(3);
      const firstCall = mockPrisma.chatMessage.deleteMany.mock.calls[0][0];
      // OR-фильтр включает orgId, stream.orgId.
      expect(firstCall.where.OR).toEqual(
        expect.arrayContaining([
          { orgId: 'o1' },
          { stream: { orgId: 'o1' } },
        ]),
      );
    });

    // Orphan-сообщения с обнулёнными FK (orgId/streamId оба null) не
    // подбираются ни одной org-итерацией. Отдельный deleteMany со всеми FK=null
    // также подхватывает legacy-сообщения, оставшиеся от удалённой Event-фичи.
    it('also deletes orphan messages with orgId/streamId null', async () => {
      mockPrisma.organization.findMany.mockResolvedValue([]);
      mockPrisma.chatMessage.deleteMany.mockResolvedValue({ count: 0 });
      await service.cleanupOldMessages();
      // Даже без орг хотя бы один вызов — orphan cleanup.
      expect(mockPrisma.chatMessage.deleteMany).toHaveBeenCalledTimes(1);
      const orphanCall = mockPrisma.chatMessage.deleteMany.mock.calls[0][0];
      expect(orphanCall.where).toEqual(
        expect.objectContaining({
          orgId: null,
          streamId: null,
          createdAt: { lt: expect.any(Date) },
        }),
      );
    });
  });
});
