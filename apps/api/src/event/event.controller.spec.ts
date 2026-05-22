import { Test } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { EventController } from './event.controller';
import { EventService } from './event.service';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { JwtPayload } from '../auth/auth.service';

/**
 * Тесты «снаружи» через контроллер: guards переопределены на pass-through;
 * cross-tenant сценарии эмулируются через user.orgId не совпадающий с event.orgId
 * (сервис делает findFirst({orgId}) → null → NotFoundException).
 */

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
  organization: { findUnique: jest.fn() },
  stream: { findFirst: jest.fn() },
  eventStream: { create: jest.fn(), delete: jest.fn(), findMany: jest.fn() },
  broadcast: { updateMany: jest.fn() },
};

const orgAdmin: JwtPayload = {
  sub: 'u1',
  role: 'org_admin',
  orgId: 'org-1',
  orgSlug: 'club',
};

describe('EventController', () => {
  let controller: EventController;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      controllers: [EventController],
      providers: [
        EventService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();
    controller = module.get(EventController);
  });

  // ──────────────────── GET / ────────────────────

  describe('GET /', () => {
    it('lists events of caller org', async () => {
      mockPrisma.event.findMany.mockResolvedValue([{ id: 'e1' }, { id: 'e2' }]);
      const r = await controller.list(orgAdmin);
      expect(r).toHaveLength(2);
      expect(mockPrisma.event.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { orgId: 'org-1' } }),
      );
    });
  });

  // ──────────────────── GET /:id ────────────────────

  describe('GET /:id', () => {
    it('returns event with streams[]', async () => {
      mockPrisma.event.findFirst.mockResolvedValue({
        id: 'e1', slug: 'spring', title: 'Spring',
        description: null, scheduledAt: null,
        startedAt: null, endedAt: null, createdAt: new Date(),
        eventStreams: [
          {
            addedAt: new Date(),
            stream: { id: 's1', slug: 'mat', name: 'Mat', isLive: false, isPublic: true, previewMode: 'multicam' },
          },
        ],
      });
      const r = await controller.getById(orgAdmin, 'e1');
      expect(r.id).toBe('e1');
      expect(r.streams).toHaveLength(1);
    });

    it('cross-tenant returns 404', async () => {
      mockPrisma.event.findFirst.mockResolvedValue(null);
      await expect(controller.getById(orgAdmin, 'e-foreign')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  // ──────────────────── POST / ────────────────────

  describe('POST /', () => {
    beforeEach(() => {
      mockPrisma.organization.findUnique.mockResolvedValue({ id: 'org-1' });
    });

    it('creates event with valid input', async () => {
      mockPrisma.event.create.mockResolvedValue({
        id: 'e1', slug: 'spring', title: 'Spring',
        description: null, scheduledAt: null,
        startedAt: null, endedAt: null, createdAt: new Date(),
      });
      const r = await controller.create(orgAdmin, {
        slug: 'spring', title: 'Spring Cup',
      });
      expect(r.id).toBe('e1');
      expect(mockPrisma.event.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ orgId: 'org-1', slug: 'spring' }),
        }),
      );
    });

    it('rejects empty slug', async () => {
      await expect(
        controller.create(orgAdmin, { slug: '', title: 'x' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('translates P2002 to 409', async () => {
      const err: any = new Error('dup');
      err.code = 'P2002';
      mockPrisma.event.create.mockRejectedValue(err);
      await expect(
        controller.create(orgAdmin, { slug: 'spring', title: 'x' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  // ──────────────────── PATCH /:id ────────────────────

  describe('PATCH /:id', () => {
    it('updates title', async () => {
      mockPrisma.event.findFirst.mockResolvedValue({
        id: 'e1', orgId: 'org-1', startedAt: null, endedAt: null,
      });
      mockPrisma.event.update.mockResolvedValue({ id: 'e1', title: 'Renamed' });
      const r = await controller.update(orgAdmin, 'e1', { title: 'Renamed' });
      expect(r.title).toBe('Renamed');
    });

    it('cross-tenant returns 404', async () => {
      mockPrisma.event.findFirst.mockResolvedValue(null);
      await expect(
        controller.update(orgAdmin, 'e-foreign', { title: 'x' }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(mockPrisma.event.update).not.toHaveBeenCalled();
    });
  });

  // ──────────────────── DELETE /:id ────────────────────

  describe('DELETE /:id', () => {
    it('deletes event and nulls broadcast.eventId', async () => {
      mockPrisma.event.findFirst.mockResolvedValue({ id: 'e1', orgId: 'org-1' });
      mockPrisma.broadcast.updateMany.mockResolvedValue({ count: 0 });
      mockPrisma.event.delete.mockResolvedValue({});

      const r = await controller.remove(orgAdmin, 'e1');
      expect(r).toEqual({ ok: true });
      expect(mockPrisma.broadcast.updateMany).toHaveBeenCalledWith({
        where: { eventId: 'e1' }, data: { eventId: null },
      });
    });

    it('cross-tenant returns 404', async () => {
      mockPrisma.event.findFirst.mockResolvedValue(null);
      await expect(controller.remove(orgAdmin, 'e-foreign')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(mockPrisma.event.delete).not.toHaveBeenCalled();
    });
  });

  // ──────────────────── POST /:id/start, /:id/end ────────────────────

  describe('POST /:id/start, /:id/end', () => {
    it('start sets startedAt', async () => {
      mockPrisma.event.findFirst.mockResolvedValue({
        id: 'e1', orgId: 'org-1', startedAt: null, endedAt: null,
      });
      mockPrisma.event.update.mockResolvedValue({ id: 'e1', startedAt: new Date() });
      // Karen C1: start теперь делает eventStream.findMany + broadcast.updateMany —
      // мокаем пустой ответ, чтобы тест не падал из-за undefined.
      mockPrisma.eventStream.findMany.mockResolvedValue([]);
      const r = await controller.start(orgAdmin, 'e1');
      expect(r.startedAt).toBeDefined();
    });

    it('end sets endedAt', async () => {
      mockPrisma.event.findFirst.mockResolvedValue({
        id: 'e1', orgId: 'org-1', startedAt: new Date(), endedAt: null,
      });
      mockPrisma.event.update.mockResolvedValue({ id: 'e1', endedAt: new Date() });
      const r = await controller.end(orgAdmin, 'e1');
      expect(r.endedAt).toBeDefined();
    });

    it('start cross-tenant returns 404', async () => {
      mockPrisma.event.findFirst.mockResolvedValue(null);
      await expect(controller.start(orgAdmin, 'e-foreign')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('end cross-tenant returns 404', async () => {
      mockPrisma.event.findFirst.mockResolvedValue(null);
      await expect(controller.end(orgAdmin, 'e-foreign')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  // ──────────────────── POST/DELETE /:id/streams ────────────────────

  describe('POST /:id/streams + DELETE /:id/streams/:streamId', () => {
    it('addStream — happy path', async () => {
      mockPrisma.event.findFirst.mockResolvedValueOnce({ id: 'e1', orgId: 'org-1' });
      mockPrisma.stream.findFirst.mockResolvedValueOnce({ id: 's1' });
      mockPrisma.eventStream.create.mockResolvedValue({});
      mockPrisma.event.findFirst.mockResolvedValueOnce({
        id: 'e1', orgId: 'org-1', slug: 'x', title: 't',
        description: null, scheduledAt: null, startedAt: null,
        endedAt: null, createdAt: new Date(), eventStreams: [],
      });

      const r = await controller.addStream(orgAdmin, 'e1', { streamId: 's1' });
      expect(r.id).toBe('e1');
      expect(mockPrisma.eventStream.create).toHaveBeenCalled();
    });

    it('addStream — cross-tenant stream returns 404', async () => {
      mockPrisma.event.findFirst.mockResolvedValueOnce({ id: 'e1', orgId: 'org-1' });
      mockPrisma.stream.findFirst.mockResolvedValueOnce(null);
      await expect(
        controller.addStream(orgAdmin, 'e1', { streamId: 's-foreign' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('addStream — cross-tenant event returns 404', async () => {
      mockPrisma.event.findFirst.mockResolvedValueOnce(null);
      await expect(
        controller.addStream(orgAdmin, 'e-foreign', { streamId: 's1' }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(mockPrisma.stream.findFirst).not.toHaveBeenCalled();
    });

    it('removeStream — happy path', async () => {
      mockPrisma.event.findFirst.mockResolvedValueOnce({ id: 'e1', orgId: 'org-1' });
      mockPrisma.eventStream.delete.mockResolvedValue({});
      mockPrisma.event.findFirst.mockResolvedValueOnce({
        id: 'e1', orgId: 'org-1', slug: 'x', title: 't',
        description: null, scheduledAt: null, startedAt: null,
        endedAt: null, createdAt: new Date(), eventStreams: [],
      });

      const r = await controller.removeStream(orgAdmin, 'e1', 's1');
      expect(r.id).toBe('e1');
    });

    it('removeStream — cross-tenant event returns 404', async () => {
      mockPrisma.event.findFirst.mockResolvedValueOnce(null);
      await expect(
        controller.removeStream(orgAdmin, 'e-foreign', 's1'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
