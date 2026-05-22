import { Test } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { EventService, validateEventSlug } from './event.service';
import { PrismaService } from '../prisma/prisma.service';

const mockPrisma = {
  event: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    findUniqueOrThrow: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
  organization: {
    findUnique: jest.fn(),
  },
  stream: {
    findFirst: jest.fn(),
  },
  eventStream: {
    create: jest.fn(),
    delete: jest.fn(),
    findMany: jest.fn(),
  },
  broadcast: {
    updateMany: jest.fn(),
  },
};

describe('EventService', () => {
  let service: EventService;

  beforeEach(async () => {
    jest.resetAllMocks();
    const module = await Test.createTestingModule({
      providers: [
        EventService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get(EventService);
  });

  // ───────────────────── validateEventSlug ─────────────────────

  describe('validateEventSlug', () => {
    it.each(['spring-cup', 'open-2026', 'a', 'a1b2', 'cup-1-2'])(
      'accepts %p',
      (s) => {
        expect(validateEventSlug(s)).toBe(s);
      },
    );

    it.each([
      '', '   ', '-foo', 'foo-', 'foo--bar',
      'Foo', 'foo_bar', 'foo bar', 'foo!', 'foo/bar',
    ])('rejects %p', (s) => {
      expect(() => validateEventSlug(s)).toThrow(BadRequestException);
    });

    it('rejects non-string', () => {
      expect(() => validateEventSlug(123 as any)).toThrow(BadRequestException);
      expect(() => validateEventSlug(undefined as any)).toThrow(BadRequestException);
    });

    it('rejects slug longer than 32 chars', () => {
      expect(() => validateEventSlug('a'.repeat(33))).toThrow(BadRequestException);
      // ровно 32 — ok
      expect(validateEventSlug('a'.repeat(32))).toBe('a'.repeat(32));
    });
  });

  // ───────────────────── list ─────────────────────

  describe('list', () => {
    it('returns events of caller org sorted by createdAt desc', async () => {
      const rows = [{ id: 'e1' }, { id: 'e2' }];
      mockPrisma.event.findMany.mockResolvedValue(rows);
      const r = await service.list('org-1');
      expect(r).toEqual(rows);
      expect(mockPrisma.event.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { orgId: 'org-1' },
          orderBy: { createdAt: 'desc' },
        }),
      );
    });
  });

  // ───────────────────── get ─────────────────────

  describe('get', () => {
    it('returns event with streams[] flattened from eventStreams', async () => {
      mockPrisma.event.findFirst.mockResolvedValue({
        id: 'e1', slug: 'spring', title: 'Spring Cup',
        description: 'desc', scheduledAt: null,
        startedAt: null, endedAt: null, createdAt: new Date(),
        eventStreams: [
          {
            addedAt: new Date(),
            stream: {
              id: 's1', slug: 'mat-a', name: 'Mat A',
              isLive: true, isPublic: true, previewMode: 'multicam',
            },
          },
        ],
      });
      const r = await service.get('org-1', 'e1');
      expect(r.id).toBe('e1');
      expect(r.streams).toHaveLength(1);
      expect(r.streams[0]).toEqual(expect.objectContaining({
        id: 's1', slug: 'mat-a', name: 'Mat A', isLive: true, isPublic: true,
      }));
      expect(mockPrisma.event.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'e1', orgId: 'org-1' },
        }),
      );
    });

    it('throws 404 when event belongs to another org (cross-tenant)', async () => {
      mockPrisma.event.findFirst.mockResolvedValue(null);
      await expect(service.get('org-1', 'e-foreign')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  // ───────────────────── create ─────────────────────

  describe('create', () => {
    beforeEach(() => {
      mockPrisma.organization.findUnique.mockResolvedValue({ id: 'org-1' });
    });

    it('creates event with required fields', async () => {
      const now = new Date();
      mockPrisma.event.create.mockResolvedValue({
        id: 'e1', slug: 'spring', title: 'Spring Cup',
        description: null, scheduledAt: null,
        startedAt: null, endedAt: null, createdAt: now,
      });
      const r = await service.create('org-1', { slug: 'spring', title: 'Spring Cup' });
      expect(r.id).toBe('e1');
      expect(mockPrisma.event.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            orgId: 'org-1',
            slug: 'spring',
            title: 'Spring Cup',
            description: null,
            scheduledAt: null,
          }),
        }),
      );
    });

    it('parses scheduledAt ISO string', async () => {
      mockPrisma.event.create.mockResolvedValue({ id: 'e1' });
      await service.create('org-1', {
        slug: 'spring',
        title: 'Spring',
        scheduledAt: '2026-06-01T10:00:00Z',
      });
      const call = mockPrisma.event.create.mock.calls[0][0];
      expect(call.data.scheduledAt).toBeInstanceOf(Date);
      expect((call.data.scheduledAt as Date).toISOString()).toBe(
        '2026-06-01T10:00:00.000Z',
      );
    });

    it('throws BadRequest on invalid slug', async () => {
      await expect(
        service.create('org-1', { slug: 'Bad Slug', title: 'x' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(mockPrisma.event.create).not.toHaveBeenCalled();
    });

    it('throws BadRequest on empty title', async () => {
      await expect(
        service.create('org-1', { slug: 'spring', title: '' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        service.create('org-1', { slug: 'spring', title: '   ' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('throws BadRequest on invalid scheduledAt string', async () => {
      await expect(
        service.create('org-1', {
          slug: 'spring',
          title: 'x',
          scheduledAt: 'not-a-date',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('throws 404 when org does not exist', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue(null);
      await expect(
        service.create('org-ghost', { slug: 'spring', title: 'x' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('translates P2002 to 409 (duplicate slug per org)', async () => {
      const err: any = new Error('Unique');
      err.code = 'P2002';
      mockPrisma.event.create.mockRejectedValue(err);
      await expect(
        service.create('org-1', { slug: 'spring', title: 'x' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  // ───────────────────── update ─────────────────────

  describe('update', () => {
    it('updates only allowed fields, ignores undefined', async () => {
      mockPrisma.event.findFirst.mockResolvedValue({
        id: 'e1', orgId: 'org-1', slug: 'spring', startedAt: null, endedAt: null,
      });
      mockPrisma.event.update.mockResolvedValue({ id: 'e1', title: 'New' });
      await service.update('org-1', 'e1', { title: 'New' });
      expect(mockPrisma.event.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'e1' },
          data: { title: 'New' },
        }),
      );
    });

    it('cross-tenant returns 404', async () => {
      mockPrisma.event.findFirst.mockResolvedValue(null);
      await expect(
        service.update('org-1', 'e-foreign', { title: 'x' }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(mockPrisma.event.update).not.toHaveBeenCalled();
    });

    it('rejects empty title', async () => {
      mockPrisma.event.findFirst.mockResolvedValue({ id: 'e1', orgId: 'org-1' });
      await expect(
        service.update('org-1', 'e1', { title: '   ' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('allows description=null to clear', async () => {
      mockPrisma.event.findFirst.mockResolvedValue({ id: 'e1', orgId: 'org-1' });
      mockPrisma.event.update.mockResolvedValue({ id: 'e1' });
      await service.update('org-1', 'e1', { description: null });
      expect(mockPrisma.event.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { description: null } }),
      );
    });
  });

  // ───────────────────── delete ─────────────────────

  describe('delete', () => {
    it('nulls broadcast.eventId and deletes event', async () => {
      mockPrisma.event.findFirst.mockResolvedValue({ id: 'e1', orgId: 'org-1' });
      mockPrisma.broadcast.updateMany.mockResolvedValue({ count: 2 });
      mockPrisma.event.delete.mockResolvedValue({});

      await service.delete('org-1', 'e1');
      expect(mockPrisma.broadcast.updateMany).toHaveBeenCalledWith({
        where: { eventId: 'e1' },
        data: { eventId: null },
      });
      expect(mockPrisma.event.delete).toHaveBeenCalledWith({ where: { id: 'e1' } });
    });

    it('cross-tenant returns 404', async () => {
      mockPrisma.event.findFirst.mockResolvedValue(null);
      await expect(service.delete('org-1', 'e-foreign')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(mockPrisma.event.delete).not.toHaveBeenCalled();
    });
  });

  // ───────────────────── start / end ─────────────────────

  describe('start', () => {
    it('sets startedAt for fresh event', async () => {
      mockPrisma.event.findFirst.mockResolvedValue({
        id: 'e1', orgId: 'org-1', startedAt: null, endedAt: null,
      });
      mockPrisma.event.update.mockResolvedValue({ id: 'e1', startedAt: new Date() });
      mockPrisma.eventStream.findMany.mockResolvedValue([]);

      await service.start('org-1', 'e1');
      expect(mockPrisma.event.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'e1' },
          data: expect.objectContaining({ startedAt: expect.any(Date) }),
        }),
      );
    });

    // Karen C1 (Step 5): broadcasts начатые ДО Event.start ретроактивно
    // линкуются (eventId=null → eventId), при условии endedAt=null
    // (только активные) и eventId=null (никто другой их уже не подцепил).
    it('relinks active null-eventId broadcasts of event streams (Karen C1)', async () => {
      mockPrisma.event.findFirst.mockResolvedValue({
        id: 'e1', orgId: 'org-1', startedAt: null, endedAt: null,
      });
      mockPrisma.event.update.mockResolvedValue({ id: 'e1', startedAt: new Date() });
      mockPrisma.eventStream.findMany.mockResolvedValue([
        { streamId: 's1' },
        { streamId: 's2' },
      ]);
      mockPrisma.broadcast.updateMany.mockResolvedValue({ count: 1 });

      await service.start('org-1', 'e1');

      expect(mockPrisma.broadcast.updateMany).toHaveBeenCalledWith({
        where: {
          streamId: { in: ['s1', 's2'] },
          endedAt: null,
          eventId: null,
        },
        data: { eventId: 'e1' },
      });
    });

    it('skips relink when event has no streams attached', async () => {
      mockPrisma.event.findFirst.mockResolvedValue({
        id: 'e1', orgId: 'org-1', startedAt: null, endedAt: null,
      });
      mockPrisma.event.update.mockResolvedValue({ id: 'e1', startedAt: new Date() });
      mockPrisma.eventStream.findMany.mockResolvedValue([]);

      await service.start('org-1', 'e1');
      expect(mockPrisma.broadcast.updateMany).not.toHaveBeenCalled();
    });

    it('idempotent: already started → returns existing event without update', async () => {
      mockPrisma.event.findFirst.mockResolvedValue({
        id: 'e1', orgId: 'org-1', startedAt: new Date(), endedAt: null,
      });
      mockPrisma.event.findUniqueOrThrow.mockResolvedValue({ id: 'e1' });
      await service.start('org-1', 'e1');
      expect(mockPrisma.event.update).not.toHaveBeenCalled();
    });

    it('rejects start of already-ended event', async () => {
      mockPrisma.event.findFirst.mockResolvedValue({
        id: 'e1', orgId: 'org-1', startedAt: new Date(), endedAt: new Date(),
      });
      await expect(service.start('org-1', 'e1')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('cross-tenant returns 404', async () => {
      mockPrisma.event.findFirst.mockResolvedValue(null);
      await expect(service.start('org-1', 'e-foreign')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('end', () => {
    it('sets endedAt for started event', async () => {
      mockPrisma.event.findFirst.mockResolvedValue({
        id: 'e1', orgId: 'org-1', startedAt: new Date(), endedAt: null,
      });
      mockPrisma.event.update.mockResolvedValue({ id: 'e1', endedAt: new Date() });

      await service.end('org-1', 'e1');
      expect(mockPrisma.event.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ endedAt: expect.any(Date) }),
        }),
      );
    });

    it('rejects end before start', async () => {
      mockPrisma.event.findFirst.mockResolvedValue({
        id: 'e1', orgId: 'org-1', startedAt: null, endedAt: null,
      });
      await expect(service.end('org-1', 'e1')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('idempotent: already ended → no update', async () => {
      mockPrisma.event.findFirst.mockResolvedValue({
        id: 'e1', orgId: 'org-1', startedAt: new Date(), endedAt: new Date(),
      });
      mockPrisma.event.findUniqueOrThrow.mockResolvedValue({ id: 'e1' });
      await service.end('org-1', 'e1');
      expect(mockPrisma.event.update).not.toHaveBeenCalled();
    });
  });

  // ───────────────────── addStream / removeStream ─────────────────────

  describe('addStream', () => {
    it('adds stream of same org and returns updated event', async () => {
      // 1st findFirst — loadForOrg.
      mockPrisma.event.findFirst.mockResolvedValueOnce({ id: 'e1', orgId: 'org-1' });
      // stream.findFirst — cross-tenant check (Stream from org-1).
      mockPrisma.stream.findFirst.mockResolvedValueOnce({ id: 's1' });
      mockPrisma.eventStream.create.mockResolvedValue({});
      // 2nd findFirst — get() at the end.
      mockPrisma.event.findFirst.mockResolvedValueOnce({
        id: 'e1',
        orgId: 'org-1',
        slug: 'spring',
        title: 't',
        description: null,
        scheduledAt: null,
        startedAt: null,
        endedAt: null,
        createdAt: new Date(),
        eventStreams: [],
      });

      await service.addStream('org-1', 'e1', 's1');
      expect(mockPrisma.stream.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 's1', orgId: 'org-1' } }),
      );
      expect(mockPrisma.eventStream.create).toHaveBeenCalledWith({
        data: { eventId: 'e1', streamId: 's1' },
      });
    });

    it('rejects stream from another org (404)', async () => {
      // loadForOrg passes
      mockPrisma.event.findFirst.mockResolvedValueOnce({ id: 'e1', orgId: 'org-1' });
      // stream not found in org-1 (it belongs to org-2)
      mockPrisma.stream.findFirst.mockResolvedValueOnce(null);
      await expect(service.addStream('org-1', 'e1', 's-foreign')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(mockPrisma.eventStream.create).not.toHaveBeenCalled();
    });

    it('cross-tenant event returns 404 without touching streams', async () => {
      mockPrisma.event.findFirst.mockResolvedValueOnce(null);
      await expect(service.addStream('org-1', 'e-foreign', 's1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(mockPrisma.stream.findFirst).not.toHaveBeenCalled();
    });

    it('idempotent on duplicate (P2002 swallowed)', async () => {
      mockPrisma.event.findFirst.mockResolvedValueOnce({ id: 'e1', orgId: 'org-1' });
      mockPrisma.stream.findFirst.mockResolvedValueOnce({ id: 's1' });
      const dup: any = new Error('dup');
      dup.code = 'P2002';
      mockPrisma.eventStream.create.mockRejectedValue(dup);
      mockPrisma.event.findFirst.mockResolvedValueOnce({
        id: 'e1', orgId: 'org-1', slug: 'x', title: 't',
        description: null, scheduledAt: null, startedAt: null,
        endedAt: null, createdAt: new Date(), eventStreams: [],
      });

      await expect(service.addStream('org-1', 'e1', 's1')).resolves.toBeDefined();
    });

    it('rejects empty streamId', async () => {
      await expect(service.addStream('org-1', 'e1', '')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });

  describe('removeStream', () => {
    it('removes stream from event', async () => {
      mockPrisma.event.findFirst.mockResolvedValueOnce({ id: 'e1', orgId: 'org-1' });
      mockPrisma.eventStream.delete.mockResolvedValue({});
      mockPrisma.event.findFirst.mockResolvedValueOnce({
        id: 'e1', orgId: 'org-1', slug: 'x', title: 't',
        description: null, scheduledAt: null, startedAt: null,
        endedAt: null, createdAt: new Date(), eventStreams: [],
      });
      await service.removeStream('org-1', 'e1', 's1');
      expect(mockPrisma.eventStream.delete).toHaveBeenCalledWith({
        where: { eventId_streamId: { eventId: 'e1', streamId: 's1' } },
      });
    });

    it('idempotent on missing link (P2025 swallowed)', async () => {
      mockPrisma.event.findFirst.mockResolvedValueOnce({ id: 'e1', orgId: 'org-1' });
      const err: any = new Error('not found');
      err.code = 'P2025';
      mockPrisma.eventStream.delete.mockRejectedValue(err);
      mockPrisma.event.findFirst.mockResolvedValueOnce({
        id: 'e1', orgId: 'org-1', slug: 'x', title: 't',
        description: null, scheduledAt: null, startedAt: null,
        endedAt: null, createdAt: new Date(), eventStreams: [],
      });
      await expect(service.removeStream('org-1', 'e1', 's-missing')).resolves.toBeDefined();
    });

    it('cross-tenant event returns 404', async () => {
      mockPrisma.event.findFirst.mockResolvedValueOnce(null);
      await expect(service.removeStream('org-1', 'e-foreign', 's1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  // ───────────────────── findActiveEventForStream ─────────────────────

  describe('findActiveEventForStream', () => {
    it('returns active event when stream is in EventStream of started+not-ended event', async () => {
      mockPrisma.event.findFirst.mockResolvedValue({ id: 'e1', orgId: 'org-1', slug: 'x', title: 't' });
      const r = await service.findActiveEventForStream('s1');
      expect(r?.id).toBe('e1');
      expect(mockPrisma.event.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            startedAt: { not: null },
            endedAt: null,
            eventStreams: { some: { streamId: 's1' } },
          }),
          // Karen H4: единый orderBy startedAt DESC во всех точках резолва.
          orderBy: { startedAt: 'desc' },
        }),
      );
    });

    it('returns null when no active event exists for stream', async () => {
      mockPrisma.event.findFirst.mockResolvedValue(null);
      const r = await service.findActiveEventForStream('s-orphan');
      expect(r).toBeNull();
    });
  });
});
