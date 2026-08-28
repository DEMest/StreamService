import { Test } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  InternalServerErrorException,
  NotFoundException,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { StreamController } from './stream.controller';
import { StreamService } from './stream.service';
import { PrismaService } from '../prisma/prisma.service';
import { MediamtxService } from '../mediamtx/mediamtx.service';
import { RecordingService } from '../recording/recording.service';
import { ChatService } from '../chat/chat.service';
import { ImageService } from '../storage/image.service';
import { StatsService } from '../stats/stats.service';
import { ChatGateway } from '../chat/chat.gateway';
import { SeoPingService } from '../seo/seo-ping.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { JwtPayload } from '../auth/auth.service';

/**
 * Тесты идут «снаружи» через контроллер, но сам JwtAuthGuard / RolesGuard не
 * проверяются здесь (это уже покрыто их собственными unit-тестами и e2e).
 * Сценарий cross-tenant эмулируем через user.orgId != stream.orgId — поведение
 * 404 обеспечивает сервис.
 */

const mockPrisma = {
  stream: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
    create: jest.fn(),
    delete: jest.fn(),
  },
  broadcast: {
    create: jest.fn(),
    update: jest.fn(),
    findMany: jest.fn(),
  },
  organization: {
    findUnique: jest.fn(),
  },
};

const mockMediamtx = {
  addStreamPaths: jest.fn(),
  replaceStreamPaths: jest.fn(),
  deleteStreamPaths: jest.fn(),
  addPath: jest.fn(),
  patchPath: jest.fn(),
  deletePath: jest.fn(),
};

const mockRecording = { onStreamEnded: jest.fn().mockResolvedValue(undefined) };
const mockChatService = { clearMessagesByStream: jest.fn() };
const mockImages = { upload: jest.fn(), delete: jest.fn(), serve: jest.fn() };
const mockStats = { getSnapshot: jest.fn() };
const mockChatGateway = { getViewers: jest.fn().mockReturnValue(0) };
const mockSeoPing = { streamStateChanged: jest.fn() };

const orgAdmin: JwtPayload = {
  sub: 'u1',
  role: 'org_admin',
  orgId: 'org-1',
  orgSlug: 'club',
};

describe('StreamController', () => {
  let controller: StreamController;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      controllers: [StreamController],
      providers: [
        StreamService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: MediamtxService, useValue: mockMediamtx },
        { provide: RecordingService, useValue: mockRecording },
        { provide: ChatService, useValue: mockChatService },
        { provide: ImageService, useValue: mockImages },
        { provide: StatsService, useValue: mockStats },
        { provide: ChatGateway, useValue: mockChatGateway },
        { provide: SeoPingService, useValue: mockSeoPing },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();
    controller = module.get(StreamController);
  });

  // ────────────────────────────────────────────────────────────────────────
  // GET /:id  (reveal flag)
  // ────────────────────────────────────────────────────────────────────────

  describe('GET /:id', () => {
    it('returns DTO without ingestKey by default, with recordingEnabled/recordingMode', async () => {
      mockPrisma.stream.findFirst.mockResolvedValue({
        id: 'st-1', orgId: 'org-1', slug: '', name: 'Main',
        description: null,
        ingestKey: 'secret-key', ingestKeyCreatedAt: new Date(),
        isPublic: true, previewKey: null, previewMode: 'multicam',
        previewImagePath: null, isLive: false, autoStartMode: 'public',
        currentBroadcastId: null, createdAt: new Date(),
        recordingEnabled: false, recordingMode: 'manual',
      });
      const r = await controller.getById(orgAdmin, 'st-1', undefined);
      expect(r.id).toBe('st-1');
      expect((r as any).ingestKey).toBeUndefined();
      expect((r as any).recordingEnabled).toBe(false);
      expect((r as any).recordingMode).toBe('manual');
      expect(mockPrisma.stream.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'st-1', orgId: 'org-1' } }),
      );
    });

    it('returns ingestKey when reveal=true', async () => {
      mockPrisma.stream.findFirst.mockResolvedValue({
        id: 'st-1', orgId: 'org-1', slug: '', name: 'Main',
        description: null,
        ingestKey: 'secret-key', ingestKeyCreatedAt: new Date(),
        isPublic: true, previewKey: null, previewMode: 'multicam',
        previewImagePath: null, isLive: false, autoStartMode: 'public',
        currentBroadcastId: null, createdAt: new Date(),
        recordingEnabled: false, recordingMode: 'manual',
      });
      const r = await controller.getById(orgAdmin, 'st-1', 'true');
      expect((r as any).ingestKey).toBe('secret-key');
    });

    it('returns 404 (NotFoundException) when stream belongs to another org', async () => {
      // Сервис фильтрует по orgId — findFirst вернёт null для stream чужой орги.
      mockPrisma.stream.findFirst.mockResolvedValue(null);
      await expect(controller.getById(orgAdmin, 'st-foreign', undefined))
        .rejects.toBeInstanceOf(NotFoundException);
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // GET /  (list)
  // ────────────────────────────────────────────────────────────────────────

  describe('GET /', () => {
    it('lists streams of caller org without ingestKey', async () => {
      mockPrisma.stream.findMany.mockResolvedValue([
        {
          id: 'st-1', slug: '', name: 'Main', description: null,
          isPublic: true, previewKey: null, previewMode: 'multicam',
          previewImagePath: null, isLive: false, autoStartMode: 'public',
          ingestKeyCreatedAt: new Date(), currentBroadcastId: null, createdAt: new Date(),
        },
      ]);
      const list = await controller.list(orgAdmin);
      expect(list).toHaveLength(1);
      expect((list[0] as any).ingestKey).toBeUndefined();
      expect(mockPrisma.stream.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { orgId: 'org-1' } }),
      );
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // PATCH /:id — валидация + side-effects
  // ────────────────────────────────────────────────────────────────────────

  describe('PATCH /:id — validation', () => {
    const compositeRow = {
      id: 'st-1', orgId: 'org-1', slug: '', name: 'Main',
      ingestKey: 'key', ingestKeyCreatedAt: new Date(),
      isPublic: true, previewKey: null, previewMode: 'multicam',
      previewImagePath: null, isLive: false, autoStartMode: 'public',
      currentBroadcastId: null, createdAt: new Date(),
      org: { slug: 'club' },
    };

    it('rejects invalid previewMode', async () => {
      mockPrisma.stream.findFirst.mockResolvedValue(compositeRow);
      await expect(
        controller.update(orgAdmin, 'st-1', { previewMode: 'rotated' } as any),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('PATCH /:id — cross-tenant', () => {
    it('returns 404 when stream belongs to another org', async () => {
      // user.orgId = 'org-1', но Stream принадлежит 'org-2' →
      // findFirst({ id, orgId: 'org-1' }) вернёт null → NotFoundException.
      mockPrisma.stream.findFirst.mockResolvedValue(null);
      await expect(
        controller.update(orgAdmin, 'st-foreign', { name: 'new' }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(mockMediamtx.replaceStreamPaths).not.toHaveBeenCalled();
      expect(mockPrisma.stream.update).not.toHaveBeenCalled();
    });
  });

  describe('PATCH /:id — side-effects', () => {
    it('does NOT touch MediaMTX paths on cosmetic PATCH', async () => {
      mockPrisma.stream.findFirst.mockResolvedValue({
        id: 'st-1', orgId: 'org-1', slug: '',
        ingestKey: 'key-x', previewKey: null,
        org: { slug: 'club' },
      });
      mockPrisma.stream.update.mockResolvedValue({
        id: 'st-1', slug: '', name: 'Renamed', description: null,
        ingestKey: 'key-x', ingestKeyCreatedAt: new Date(),
        isPublic: true, previewKey: null, previewMode: 'multicam',
        previewImagePath: null, isLive: false, autoStartMode: 'public',
        currentBroadcastId: null, createdAt: new Date(),
      });
      await controller.update(orgAdmin, 'st-1', { name: 'Renamed' });
      expect(mockMediamtx.replaceStreamPaths).not.toHaveBeenCalled();
    });

    it('generates previewKey when isPublic switches to false', async () => {
      mockPrisma.stream.findFirst.mockResolvedValue({
        id: 'st-1', orgId: 'org-1', slug: '',
        ingestKey: 'key-x', previewKey: null,
        org: { slug: 'club' },
      });
      mockPrisma.stream.update.mockImplementation(({ data }) => Promise.resolve({
        id: 'st-1', slug: '', name: 'Main', description: null,
        ingestKey: 'key-x', ingestKeyCreatedAt: new Date(),
        isPublic: false, previewKey: data.previewKey,
        previewMode: 'multicam', previewImagePath: null,
        isLive: false, autoStartMode: 'public',
        currentBroadcastId: null, createdAt: new Date(),
      }));
      const r = await controller.update(orgAdmin, 'st-1', { isPublic: false });
      expect(r.previewKey).toBeTruthy();
      expect(mockPrisma.stream.update).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ isPublic: false, previewKey: expect.any(String) }),
      }));
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // POST /:id/rotate-key
  // ────────────────────────────────────────────────────────────────────────

  describe('POST /:id/rotate-key', () => {
    it('generates new ingestKey and calls mediamtx.replaceStreamPaths', async () => {
      // findFirst (loadForOrg) — для tenant-check.
      mockPrisma.stream.findFirst.mockResolvedValue({
        id: 'st-1', orgId: 'org-1', slug: '',
        ingestKey: 'old', previewKey: null,
        org: { slug: 'club' },
      });
      // findUnique (rotateKey → getStreamWithOrg) — основная загрузка.
      mockPrisma.stream.findUnique.mockResolvedValue({
        id: 'st-1', orgId: 'org-1', slug: '', recordingEnabled: true,
        org: { slug: 'club' },
      });
      mockPrisma.stream.update.mockResolvedValue({
        id: 'st-1', slug: '', ingestKey: 'new-key', ingestKeyCreatedAt: new Date(),
      });

      const r = await controller.rotateKey(orgAdmin, 'st-1');
      expect(r.ingestKey).toBe('new-key');
      expect(mockMediamtx.replaceStreamPaths).toHaveBeenCalledWith(
        'club', '', expect.any(String), true,
      );
    });

    it('returns 404 for cross-tenant stream', async () => {
      mockPrisma.stream.findFirst.mockResolvedValue(null);
      await expect(controller.rotateKey(orgAdmin, 'st-foreign'))
        .rejects.toBeInstanceOf(NotFoundException);
      expect(mockMediamtx.replaceStreamPaths).not.toHaveBeenCalled();
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // POST /:id/stop
  // ────────────────────────────────────────────────────────────────────────

  describe('POST /:id/stop', () => {
    it('returns alreadyOff:true when no active broadcast', async () => {
      // loadForOrg (tenant check)
      mockPrisma.stream.findFirst.mockResolvedValue({
        id: 'st-1', orgId: 'org-1', slug: '',
        org: { slug: 'club' }, ingestKey: 'k',
      });
      // endBroadcast → findUnique returns isLive=false
      mockPrisma.stream.findUnique.mockResolvedValue({
        id: 'st-1', orgId: 'org-1', slug: '', isLive: false, currentBroadcastId: null,
        org: { slug: 'club' },
      });
      const r = await controller.stop(orgAdmin, 'st-1');
      expect(r).toEqual({ alreadyOff: true });
      expect(mockPrisma.broadcast.update).not.toHaveBeenCalled();
    });

    it('closes active broadcast when stream is live', async () => {
      mockPrisma.stream.findFirst.mockResolvedValue({
        id: 'st-1', orgId: 'org-1', slug: '',
        org: { slug: 'club' }, ingestKey: 'k',
      });
      mockPrisma.stream.findUnique.mockResolvedValue({
        id: 'st-1', orgId: 'org-1', slug: '', isLive: true, currentBroadcastId: 'b-1',
        org: { slug: 'club' },
      });
      mockPrisma.broadcast.update.mockResolvedValue({});
      mockPrisma.stream.update.mockResolvedValue({});

      const r = await controller.stop(orgAdmin, 'st-1');
      expect(r).toEqual({ ok: true });
      expect(mockPrisma.broadcast.update).toHaveBeenCalledWith(expect.objectContaining({
        where: { id: 'b-1' },
        data: expect.objectContaining({ endedAt: expect.any(Date) }),
      }));
    });

    it('returns 404 for cross-tenant stream', async () => {
      mockPrisma.stream.findFirst.mockResolvedValue(null);
      await expect(controller.stop(orgAdmin, 'st-foreign'))
        .rejects.toBeInstanceOf(NotFoundException);
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // GET /:id/broadcasts
  // ────────────────────────────────────────────────────────────────────────

  describe('GET /:id/stats', () => {
    it('строит MediaMTX-путь из орги и слага и подмешивает зрителей из чата', async () => {
      mockPrisma.stream.findFirst.mockResolvedValue({
        id: 'st-1', orgId: 'org-1', slug: 'court-a', org: { slug: 'club' },
      });
      mockChatGateway.getViewers.mockReturnValue(42);
      mockStats.getSnapshot.mockResolvedValue({ path: 'live/club/court-a', live: true });

      await controller.getStats(orgAdmin, 'st-1');

      expect(mockStats.getSnapshot).toHaveBeenCalledWith('live/club/court-a', 42);
      expect(mockChatGateway.getViewers).toHaveBeenCalledWith('st-1');
    });

    it('для default Stream (slug="") путь без второго сегмента', async () => {
      mockPrisma.stream.findFirst.mockResolvedValue({
        id: 'st-0', orgId: 'org-1', slug: '', org: { slug: 'club' },
      });
      mockChatGateway.getViewers.mockReturnValue(0);
      mockStats.getSnapshot.mockResolvedValue({ path: 'live/club', live: false });

      await controller.getStats(orgAdmin, 'st-0');

      expect(mockStats.getSnapshot).toHaveBeenCalledWith('live/club', 0);
    });

    it('чужой Stream → 404, статистика не запрашивается', async () => {
      mockPrisma.stream.findFirst.mockResolvedValue(null);
      await expect(controller.getStats(orgAdmin, 'st-foreign'))
        .rejects.toBeInstanceOf(NotFoundException);
      expect(mockStats.getSnapshot).not.toHaveBeenCalled();
    });
  });

  describe('GET /:id/broadcasts', () => {
    it('delegates to listBroadcastsForOrg(user.orgId, id)', async () => {
      // loadForOrg (tenant check)
      mockPrisma.stream.findFirst.mockResolvedValue({
        id: 'st-1', orgId: 'org-1', slug: '',
        org: { slug: 'club' }, ingestKey: 'k',
      });
      const now = new Date();
      mockPrisma.broadcast.findMany.mockResolvedValue([
        {
          id: 'b1', title: 'B1', description: null,
          startedAt: now, endedAt: now,
          recordings: [{ id: 'r1', status: 'ready', fileSize: 512n, duration: 1800 }],
        },
      ]);

      const result = await controller.listBroadcasts(orgAdmin, 'st-1');

      expect(mockPrisma.broadcast.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { streamId: 'st-1', endedAt: { not: null } },
        }),
      );
      expect(result).toHaveLength(1);
      expect(result[0].recording).toEqual({ id: 'r1', status: 'ready', fileSize: 512, duration: 1800 });
      expect((result[0] as any).recordings).toBeUndefined();
    });

    it('returns 404 for cross-tenant stream', async () => {
      mockPrisma.stream.findFirst.mockResolvedValue(null);
      await expect(controller.listBroadcasts(orgAdmin, 'st-foreign'))
        .rejects.toBeInstanceOf(NotFoundException);
      expect(mockPrisma.broadcast.findMany).not.toHaveBeenCalled();
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // POST /  (create)
  // ────────────────────────────────────────────────────────────────────────

  describe('POST /', () => {
    /** Полный row для toDto после prisma.stream.create — без сюрпризов в полях. */
    const createdRow = (overrides: any = {}) => ({
      id: 'st-new', slug: 'cam-a', name: 'cam-a', description: null,
      ingestKey: 'gen-key', ingestKeyCreatedAt: new Date(),
      isPublic: true, previewKey: null, previewMode: 'multicam',
      previewImagePath: null, isLive: false, autoStartMode: 'public',
      currentBroadcastId: null, createdAt: new Date(),
      recordingEnabled: true, recordingMode: 'auto',
      ...overrides,
    });

    it('creates a new Stream with defaults', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue({ slug: 'club' });
      mockPrisma.stream.create.mockResolvedValue(createdRow());

      const r = await controller.create(orgAdmin, { slug: 'cam-a' } as any);

      // DTO без ingestKey.
      expect(r.id).toBe('st-new');
      expect(r.slug).toBe('cam-a');
      expect((r as any).ingestKey).toBeUndefined();

      // Prisma create вызван с правильным набором полей.
      expect(mockPrisma.stream.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          orgId: 'org-1', slug: 'cam-a', name: 'cam-a',
          isPublic: true,
          previewMode: 'multicam', autoStartMode: 'public',
          ingestKey: expect.any(String),
        }),
      }));

      // MediaMTX путь зарегистрирован с тем же ingestKey и recordingEnabled что в БД.
      expect(mockMediamtx.addStreamPaths).toHaveBeenCalledWith(
        'club', 'cam-a', expect.any(String), true,
      );
    });

    it('uses provided name when given', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue({ slug: 'club' });
      mockPrisma.stream.create.mockResolvedValue(createdRow({ name: 'Main Camera' }));

      await controller.create(orgAdmin, { slug: 'cam-a', name: 'Main Camera' } as any);

      expect(mockPrisma.stream.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ name: 'Main Camera' }),
      }));
    });

    it('rejects empty slug with BadRequestException', async () => {
      await expect(controller.create(orgAdmin, { slug: '' } as any))
        .rejects.toBeInstanceOf(BadRequestException);
      expect(mockPrisma.stream.create).not.toHaveBeenCalled();
      expect(mockMediamtx.addStreamPaths).not.toHaveBeenCalled();
    });

    it('rejects slug with uppercase letters', async () => {
      await expect(controller.create(orgAdmin, { slug: 'CamA' } as any))
        .rejects.toBeInstanceOf(BadRequestException);
      expect(mockPrisma.stream.create).not.toHaveBeenCalled();
    });

    it('rejects slug with spaces', async () => {
      await expect(controller.create(orgAdmin, { slug: 'cam a' } as any))
        .rejects.toBeInstanceOf(BadRequestException);
      expect(mockPrisma.stream.create).not.toHaveBeenCalled();
    });

    it('rejects slug with leading/trailing dash', async () => {
      await expect(controller.create(orgAdmin, { slug: '-cam' } as any))
        .rejects.toBeInstanceOf(BadRequestException);
      await expect(controller.create(orgAdmin, { slug: 'cam-' } as any))
        .rejects.toBeInstanceOf(BadRequestException);
    });

    // ─── Reserved slug blacklist (Karen C1) ─────────────────────────────────
    // Без этой проверки Next.js не сможет резолвить
    // `/watch/<orgSlug>/<streamSlug>` против static-роутов вроде
    // `/watch/<orgSlug>/archive` — а backend получит `/api`, `/hls`, и т.д.
    it.each([
      'archive', 'streams', 'admin', 'api', 'hls', 'live',
      'login', 'dashboard', 'organizations', 'event', 'events',
      '_next', 'public', 'static',
    ])('rejects reserved slug %p with 400', async (reserved) => {
      await expect(controller.create(orgAdmin, { slug: reserved } as any))
        .rejects.toBeInstanceOf(BadRequestException);
      expect(mockPrisma.stream.create).not.toHaveBeenCalled();
      expect(mockMediamtx.addStreamPaths).not.toHaveBeenCalled();
    });

    // ─── Numeric slug guard (Karen H1) ──────────────────────────────────────
    // Чисто-числовой slug перехватывается resolvePathToStream'ом как slot-путь
    // (live/<org>/<n>), поэтому такой Stream становится недоступен по своему пути.
    it.each(['1', '2', '42', '007'])(
      'rejects purely numeric slug %p with 400',
      async (numericSlug) => {
        await expect(controller.create(orgAdmin, { slug: numericSlug } as any))
          .rejects.toBeInstanceOf(BadRequestException);
        expect(mockPrisma.stream.create).not.toHaveBeenCalled();
      },
    );

    it('accepts slug with digits mixed with letters/dashes (cam-1, 4k-1)', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue({ slug: 'club' });
      mockPrisma.stream.create.mockResolvedValue(createdRow({ slug: 'cam-1' }));
      await controller.create(orgAdmin, { slug: 'cam-1' } as any);
      expect(mockPrisma.stream.create).toHaveBeenCalled();
    });

    it('returns 409 (ConflictException) when slug duplicates within org (P2002)', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue({ slug: 'club' });
      const dupErr: any = new Error('Unique constraint failed');
      dupErr.code = 'P2002';
      mockPrisma.stream.create.mockRejectedValue(dupErr);

      await expect(controller.create(orgAdmin, { slug: 'cam-a' } as any))
        .rejects.toBeInstanceOf(ConflictException);
      expect(mockMediamtx.addStreamPaths).not.toHaveBeenCalled();
    });

    it('rolls back Prisma row when mediamtx.addStreamPaths fails (500)', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue({ slug: 'club' });
      mockPrisma.stream.create.mockResolvedValue(createdRow());
      mockMediamtx.addStreamPaths.mockRejectedValue(new Error('MediaMTX is down'));
      mockPrisma.stream.delete.mockResolvedValue({});

      await expect(controller.create(orgAdmin, { slug: 'cam-a' } as any))
        .rejects.toBeInstanceOf(InternalServerErrorException);

      // Rollback: row удалён по id.
      expect(mockPrisma.stream.delete).toHaveBeenCalledWith({ where: { id: 'st-new' } });
    });

    it('throws 404 when org does not exist', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue(null);
      await expect(controller.create(orgAdmin, { slug: 'cam-a' } as any))
        .rejects.toBeInstanceOf(NotFoundException);
      expect(mockPrisma.stream.create).not.toHaveBeenCalled();
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // DELETE /:id
  // ────────────────────────────────────────────────────────────────────────

  describe('DELETE /:id', () => {
    it('deletes Stream and calls mediamtx.deleteStreamPaths', async () => {
      mockPrisma.stream.findFirst.mockResolvedValue({
        id: 'st-1', orgId: 'org-1', slug: 'cam-a',
        ingestKey: 'k', previewKey: null,
        org: { slug: 'club' },
      });
      mockPrisma.stream.delete.mockResolvedValue({});

      const r = await controller.remove(orgAdmin, 'st-1');
      expect(r).toEqual({ ok: true });
      expect(mockMediamtx.deleteStreamPaths).toHaveBeenCalledWith(
        'club', 'cam-a',
      );
      expect(mockPrisma.stream.delete).toHaveBeenCalledWith({ where: { id: 'st-1' } });
    });

    it('returns 404 when stream belongs to another org', async () => {
      mockPrisma.stream.findFirst.mockResolvedValue(null);
      await expect(controller.remove(orgAdmin, 'st-foreign'))
        .rejects.toBeInstanceOf(NotFoundException);
      expect(mockMediamtx.deleteStreamPaths).not.toHaveBeenCalled();
      expect(mockPrisma.stream.delete).not.toHaveBeenCalled();
    });

    // ─── Live-state guard (Karen C4) ────────────────────────────────────────
    // Удаление live-Stream'а на ходу сорвало бы MediaMTX-пути под активным
    // publish'ем (vMix получит broken pipe, зрители — чёрный экран).
    // Owner должен сначала остановить Broadcast через POST :id/stop.
    it('rejects deletion when stream is currently live (409)', async () => {
      mockPrisma.stream.findFirst.mockResolvedValue({
        id: 'st-live', orgId: 'org-1', slug: 'cam-a',
        ingestKey: 'k', previewKey: null,
        isLive: true, currentBroadcastId: 'b-active',
        org: { slug: 'club' },
      });

      const promise = controller.remove(orgAdmin, 'st-live');
      await expect(promise).rejects.toBeInstanceOf(ConflictException);

      // 409 контракт для HTTP-слоя.
      try {
        await controller.remove(orgAdmin, 'st-live');
      } catch (err) {
        expect(err).toBeInstanceOf(HttpException);
        expect((err as HttpException).getStatus()).toBe(HttpStatus.CONFLICT);
      }

      expect(mockMediamtx.deleteStreamPaths).not.toHaveBeenCalled();
      expect(mockPrisma.stream.delete).not.toHaveBeenCalled();
    });

    it('rejects deletion when broadcast id is still attached (409 even if isLive flag stale)', async () => {
      mockPrisma.stream.findFirst.mockResolvedValue({
        id: 'st-stuck', orgId: 'org-1', slug: 'cam-a',
        ingestKey: 'k', previewKey: null,
        isLive: false, currentBroadcastId: 'b-still-here',
        org: { slug: 'club' },
      });
      await expect(controller.remove(orgAdmin, 'st-stuck'))
        .rejects.toBeInstanceOf(ConflictException);
      expect(mockPrisma.stream.delete).not.toHaveBeenCalled();
    });

    it('continues Prisma delete even when mediamtx.deleteStreamPaths fails (log warn)', async () => {
      mockPrisma.stream.findFirst.mockResolvedValue({
        id: 'st-1', orgId: 'org-1', slug: 'cam-a',
        ingestKey: 'k', previewKey: null,
        org: { slug: 'club' },
      });
      mockMediamtx.deleteStreamPaths.mockRejectedValue(new Error('MediaMTX down'));
      mockPrisma.stream.delete.mockResolvedValue({});

      const r = await controller.remove(orgAdmin, 'st-1');

      expect(r).toEqual({ ok: true });
      expect(mockMediamtx.deleteStreamPaths).toHaveBeenCalled();
      // Prisma delete всё равно выполнен.
      expect(mockPrisma.stream.delete).toHaveBeenCalledWith({ where: { id: 'st-1' } });
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // POST /:id/preview
  // ────────────────────────────────────────────────────────────────────────

  describe('POST /:id/preview', () => {
    const fakeFile = (overrides: any = {}) => ({
      fieldname: 'file', originalname: 'preview.jpg', encoding: '7bit',
      mimetype: 'image/jpeg', buffer: Buffer.from('fake-image-bytes'), size: 17,
      ...overrides,
    }) as Express.Multer.File;

    it('uploads preview and returns previewImagePath', async () => {
      mockPrisma.stream.findFirst.mockResolvedValue({
        id: 'st-1', orgId: 'org-1', slug: '',
        org: { slug: 'club' },
      });
      mockPrisma.stream.update.mockResolvedValue({});

      const r = await controller.uploadPreview(orgAdmin, 'st-1', fakeFile());

      expect(r).toEqual({ ok: true, previewImagePath: 'images/stream/st-1.jpg' });
      expect(mockPrisma.stream.update).toHaveBeenCalledWith({
        where: { id: 'st-1' },
        data: { previewImagePath: 'images/stream/st-1.jpg' },
      });
    });

    it('rejects when no file uploaded (400)', () => {
      // uploadPreview validates synchronously (throws directly, not a rejected Promise).
      expect(() => controller.uploadPreview(orgAdmin, 'st-1', undefined as any))
        .toThrow(BadRequestException);
      expect(mockPrisma.stream.update).not.toHaveBeenCalled();
    });

    it('rejects unsupported mimetype (400)', () => {
      expect(() =>
        controller.uploadPreview(orgAdmin, 'st-1', fakeFile({ mimetype: 'application/pdf' })),
      ).toThrow(BadRequestException);
      expect(mockPrisma.stream.update).not.toHaveBeenCalled();
    });

    it('returns 404 for cross-tenant stream', async () => {
      mockPrisma.stream.findFirst.mockResolvedValue(null);
      await expect(controller.uploadPreview(orgAdmin, 'st-foreign', fakeFile()))
        .rejects.toBeInstanceOf(NotFoundException);
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // DELETE /:id/preview
  // ────────────────────────────────────────────────────────────────────────

  describe('DELETE /:id/preview', () => {
    it('deletes preview and clears previewImagePath', async () => {
      mockPrisma.stream.findFirst.mockResolvedValue({
        id: 'st-1', orgId: 'org-1', slug: '',
        org: { slug: 'club' },
      });
      mockPrisma.stream.update.mockResolvedValue({});

      const r = await controller.deletePreview(orgAdmin, 'st-1');

      expect(r).toEqual({ ok: true });
      expect(mockPrisma.stream.update).toHaveBeenCalledWith({
        where: { id: 'st-1' },
        data: { previewImagePath: null },
      });
    });

    it('returns 404 for cross-tenant stream', async () => {
      mockPrisma.stream.findFirst.mockResolvedValue(null);
      await expect(controller.deletePreview(orgAdmin, 'st-foreign'))
        .rejects.toBeInstanceOf(NotFoundException);
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // POST /:id/chat/clear
  // ────────────────────────────────────────────────────────────────────────

  describe('POST /:id/chat/clear', () => {
    it('delegates to chatService.clearMessagesByStream(id)', async () => {
      mockPrisma.stream.findFirst.mockResolvedValue({
        id: 'st-1', orgId: 'org-1', slug: '',
        org: { slug: 'club' },
      });
      mockChatService.clearMessagesByStream.mockResolvedValue({ deleted: 5 });

      const r = await controller.clearChat(orgAdmin, 'st-1');

      expect(mockChatService.clearMessagesByStream).toHaveBeenCalledWith('st-1');
      expect(r).toEqual({ deleted: 5 });
    });

    it('returns 404 for cross-tenant stream', async () => {
      mockPrisma.stream.findFirst.mockResolvedValue(null);
      await expect(controller.clearChat(orgAdmin, 'st-foreign'))
        .rejects.toBeInstanceOf(NotFoundException);
      expect(mockChatService.clearMessagesByStream).not.toHaveBeenCalled();
    });
  });
});
