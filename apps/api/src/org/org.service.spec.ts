import { Test } from '@nestjs/testing';
import { OrgService } from './org.service';
import { PrismaService } from '../prisma/prisma.service';
import { RecordingService } from '../recording/recording.service';
import { ChatGateway } from '../chat/chat.gateway';
import { ImageService } from '../storage/image.service';
import { ConflictException, NotFoundException } from '@nestjs/common';

const mockPrisma = {
  organization: { findUnique: jest.fn(), update: jest.fn() },
  broadcast: { findFirst: jest.fn(), update: jest.fn(), delete: jest.fn() },
  recording: { aggregate: jest.fn() },
};
const mockRecording = { deleteRecordingByBroadcastId: jest.fn() };
const mockChatGateway = {
  broadcastChatEnabled: jest.fn(),
};
const mockImages = { upload: jest.fn(), delete: jest.fn(), serve: jest.fn() };

describe('OrgService', () => {
  let service: OrgService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [
        OrgService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: RecordingService, useValue: mockRecording },
        { provide: ChatGateway, useValue: mockChatGateway },
        { provide: ImageService, useValue: mockImages },
      ],
    }).compile();
    service = module.get(OrgService);
  });

  describe('getProfile', () => {
    it('returns org profile without stream-fields', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue({
        id: 'o1', slug: 'org', name: 'Org', isActive: true, createdAt: new Date(),
        chatTtlMinutes: 180, chatEnabled: true, imagePath: null,
      });
      const r = await service.getProfile('o1');
      expect(r).toEqual({
        id: 'o1', slug: 'org', name: 'Org', isActive: true, createdAt: expect.any(Date),
        chatTtlMinutes: 180, chatEnabled: true, imagePath: null,
      });
      expect((r as any).streamTitle).toBeUndefined();
      expect((r as any).ingestKey).toBeUndefined();
    });

    it('throws NotFoundException when org does not exist', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue(null);
      await expect(service.getProfile('missing')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('getStorage', () => {
    const OLD_ENDPOINT = process.env.S3_ENDPOINT;
    afterAll(() => {
      if (OLD_ENDPOINT === undefined) delete process.env.S3_ENDPOINT;
      else process.env.S3_ENDPOINT = OLD_ENDPOINT;
    });

    it('удваивает fileSize (сегменты + download.mp4) и считает только ready', async () => {
      process.env.S3_ENDPOINT = 'http://minio:9000';
      mockPrisma.recording.aggregate.mockResolvedValue({
        // _sum по bigint-колонке Prisma возвращает BigInt — арифметика ниже
        // обязана его нормализовать, иначе TypeError на смешивании типов.
        _sum: { fileSize: 1_000_000_000n, duration: 3600 },
        _count: { _all: 3 },
      });

      const r = await service.getStorage('o1');

      expect(mockPrisma.recording.aggregate).toHaveBeenCalledWith({
        where: { status: 'ready', broadcast: { stream: { orgId: 'o1' } } },
        _sum: { fileSize: true, duration: true },
        _count: { _all: true },
      });
      expect(r.archive.usedBytes).toBe(2_000_000_000);
      expect(r.archive.recordingsCount).toBe(3);
      expect(r.archive.durationSeconds).toBe(3600);
      expect(r.retentionDays).toBe(7);
      // час эфира на 2 ГБ архива → расход считается по истории орги
      expect(r.estimate.fromHistory).toBe(true);
      expect(r.estimate.bytesPerHour).toBe(2_000_000_000);
    });

    it('переживает пустой архив (aggregate вернул NULL-суммы)', async () => {
      process.env.S3_ENDPOINT = 'http://minio:9000';
      mockPrisma.recording.aggregate.mockResolvedValue({
        _sum: { fileSize: null, duration: null },
        _count: { _all: 0 },
      });

      const r = await service.getStorage('o1');

      expect(r.archive).toEqual({ usedBytes: 0, recordingsCount: 0, durationSeconds: 0 });
      expect(r.estimate.fromHistory).toBe(false);
      expect(r.estimate.bitrateMbps).toBe(4);
    });

    it('не показывает диск, когда архив во внешнем S3', async () => {
      process.env.S3_ENDPOINT = 'https://s3.eu-central-1.amazonaws.com';
      mockPrisma.recording.aggregate.mockResolvedValue({
        _sum: { fileSize: 500n, duration: 10 },
        _count: { _all: 1 },
      });

      const r = await service.getStorage('o1');

      expect(r.disk).toBeNull();
      expect(r.diskStatus).toBe('external');
      expect(r.estimate.hoursLeft).toBeNull();
    });

    it.each([
      ['http://minio:9000', 'ok'],
      ['http://streamservice-minio:9000', 'ok'],
      ['http://minio-1:9000', 'ok'],
      ['http://127.0.0.1:9000', 'ok'],
      ['http://localhost:9000', 'ok'],
      ['https://s3.eu-central-1.amazonaws.com', 'external'],
      ['https://minio.s3-provider.com', 'external'],
      ['not-a-url', 'external'],
    ])('распознаёт локальное хранилище: %s → %s', async (endpoint, expected) => {
      process.env.S3_ENDPOINT = endpoint;
      mockPrisma.recording.aggregate.mockResolvedValue({
        _sum: { fileSize: null, duration: null },
        _count: { _all: 0 },
      });

      const r = await service.getStorage('o1');

      // 'ok' достижим только если statfs('/recordings') отработал; вне docker
      // он кинет ENOENT → 'unavailable'. Проверяем, что это НЕ 'external'.
      if (expected === 'ok') expect(r.diskStatus).not.toBe('external');
      else expect(r.diskStatus).toBe('external');
    });
  });

  describe('updateSettings', () => {
    it('patches chatTtlMinutes and chatEnabled on Organization', async () => {
      mockPrisma.organization.update.mockResolvedValue({
        slug: 'org', name: 'Org', chatTtlMinutes: 60, chatEnabled: false,
      });
      const r = await service.updateSettings('o1', { chatTtlMinutes: 60, chatEnabled: false });
      expect(mockPrisma.organization.update).toHaveBeenCalledWith({
        where: { id: 'o1' },
        data: { chatTtlMinutes: 60, chatEnabled: false },
        select: { slug: true, name: true, chatTtlMinutes: true, chatEnabled: true },
      });
      expect(r).toEqual({ slug: 'org', name: 'Org', chatTtlMinutes: 60, chatEnabled: false });
    });

    it('broadcasts chatEnabled change via ChatGateway', async () => {
      mockPrisma.organization.update.mockResolvedValue({
        slug: 'org', name: 'Org', chatTtlMinutes: 180, chatEnabled: false,
      });
      await service.updateSettings('o1', { chatEnabled: false });
      expect(mockChatGateway.broadcastChatEnabled).toHaveBeenCalledWith('org', false);
    });

    it('does not broadcast when only chatTtlMinutes changes', async () => {
      mockPrisma.organization.update.mockResolvedValue({
        slug: 'org', name: 'Org', chatTtlMinutes: 60, chatEnabled: true,
      });
      await service.updateSettings('o1', { chatTtlMinutes: 60 });
      expect(mockChatGateway.broadcastChatEnabled).not.toHaveBeenCalled();
    });

    it('trims and patches name', async () => {
      mockPrisma.organization.update.mockResolvedValue({
        slug: 'org', name: 'New Name', chatTtlMinutes: 180, chatEnabled: true,
      });
      await service.updateSettings('o1', { name: '  New Name  ' });
      expect(mockPrisma.organization.update).toHaveBeenCalledWith(expect.objectContaining({
        data: { name: 'New Name' },
      }));
    });

    it('throws ConflictException when name already taken', async () => {
      const p2002 = Object.assign(new Error('Unique constraint'), { code: 'P2002' });
      mockPrisma.organization.update.mockRejectedValue(p2002);
      await expect(service.updateSettings('o1', { name: 'taken' })).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('updateBroadcast', () => {
    it('updates broadcast belonging to a NAMED (non-default) stream', async () => {
      // Regression: old implementation looked up broadcasts only via
      // streamId: defaultStream.id, so a broadcast belonging to a named
      // stream (slug !== '') was never found and update 404'd.
      mockPrisma.broadcast.findFirst.mockResolvedValue({
        id: 'b1', streamId: 's-named', stream: { orgId: 'o1', slug: 'court-a' },
      });
      mockPrisma.broadcast.update.mockResolvedValue({
        id: 'b1', title: 'New title', description: 'New desc',
      });

      const r = await service.updateBroadcast('o1', 'b1', { title: 'New title', description: 'New desc' });

      expect(mockPrisma.broadcast.findFirst).toHaveBeenCalledWith({
        where: { id: 'b1', stream: { orgId: 'o1' } },
      });
      expect(mockPrisma.broadcast.update).toHaveBeenCalledWith({
        where: { id: 'b1' },
        data: { title: 'New title', description: 'New desc' },
        select: { id: true, title: true, description: true },
      });
      expect(r).toEqual({ id: 'b1', title: 'New title', description: 'New desc' });
    });

    it('throws NotFoundException when broadcast not found / belongs to another org', async () => {
      mockPrisma.broadcast.findFirst.mockResolvedValue(null);
      await expect(
        service.updateBroadcast('o1', 'bcast1', { title: 'X' }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(mockPrisma.broadcast.update).not.toHaveBeenCalled();
    });
  });

  describe('deleteBroadcast', () => {
    it('deletes broadcast belonging to a NAMED (non-default) stream', async () => {
      mockPrisma.broadcast.findFirst.mockResolvedValue({
        id: 'b1', streamId: 's-named', stream: { orgId: 'o1', slug: 'court-a' },
      });
      mockRecording.deleteRecordingByBroadcastId.mockResolvedValue(undefined);
      mockPrisma.broadcast.delete.mockResolvedValue({ id: 'b1' });

      const r = await service.deleteBroadcast('o1', 'b1');

      expect(mockPrisma.broadcast.findFirst).toHaveBeenCalledWith({
        where: { id: 'b1', stream: { orgId: 'o1' } },
      });
      expect(mockRecording.deleteRecordingByBroadcastId).toHaveBeenCalledWith('b1');
      expect(mockPrisma.broadcast.delete).toHaveBeenCalledWith({ where: { id: 'b1' } });
      expect(r).toEqual({ ok: true });
    });

    it('throws NotFoundException when broadcast not in org streams', async () => {
      mockPrisma.broadcast.findFirst.mockResolvedValue(null);
      await expect(service.deleteBroadcast('o1', 'bcast1')).rejects.toBeInstanceOf(NotFoundException);
      expect(mockRecording.deleteRecordingByBroadcastId).not.toHaveBeenCalled();
      expect(mockPrisma.broadcast.delete).not.toHaveBeenCalled();
    });
  });

  describe('uploadBroadcastPreview', () => {
    it('404 для чужого broadcast, upload не вызывается', async () => {
      mockPrisma.broadcast.findFirst.mockResolvedValue(null);
      await expect(service.uploadBroadcastPreview('o1', 'b-alien', Buffer.from('x')))
        .rejects.toBeInstanceOf(NotFoundException);
      expect(mockImages.upload).not.toHaveBeenCalled();
    });

    it('заливает по ключу archive/<org>/<stream>/<broadcastId>/preview.jpg и ставит previewImagePath', async () => {
      mockPrisma.broadcast.findFirst.mockResolvedValue({
        id: 'b1',
        stream: { slug: 'main', org: { slug: 'club1' } },
      });
      mockPrisma.broadcast.update.mockResolvedValue({});
      const r = await service.uploadBroadcastPreview('o1', 'b1', Buffer.from('img'));
      expect(mockImages.upload).toHaveBeenCalledWith('archive/club1/main/b1/preview.jpg', Buffer.from('img'));
      expect(mockPrisma.broadcast.update).toHaveBeenCalledWith({
        where: { id: 'b1' },
        data: { previewImagePath: 'archive/club1/main/b1/preview.jpg' },
      });
      expect(r).toEqual({ ok: true });
    });

    it('легаси-запись со slug="" — ключ без сегмента стрима', async () => {
      mockPrisma.broadcast.findFirst.mockResolvedValue({
        id: 'b1',
        stream: { slug: '', org: { slug: 'club1' } },
      });
      mockPrisma.broadcast.update.mockResolvedValue({});
      await service.uploadBroadcastPreview('o1', 'b1', Buffer.from('img'));
      expect(mockImages.upload).toHaveBeenCalledWith('archive/club1/b1/preview.jpg', Buffer.from('img'));
    });
  });

  describe('uploadImage / deleteImage', () => {
    it('uploads to images/org/<orgId>.jpg and stores imagePath', async () => {
      mockPrisma.organization.update.mockResolvedValue({});
      const r = await service.uploadImage('o1', Buffer.from('img'));
      expect(mockImages.upload).toHaveBeenCalledWith('images/org/o1.jpg', Buffer.from('img'));
      expect(mockPrisma.organization.update).toHaveBeenCalledWith({
        where: { id: 'o1' },
        data: { imagePath: 'images/org/o1.jpg' },
      });
      expect(r).toEqual({ ok: true });
    });

    it('deleteImage removes object and clears imagePath', async () => {
      mockPrisma.organization.update.mockResolvedValue({});
      const r = await service.deleteImage('o1');
      expect(mockImages.delete).toHaveBeenCalledWith('images/org/o1.jpg');
      expect(mockPrisma.organization.update).toHaveBeenCalledWith({
        where: { id: 'o1' },
        data: { imagePath: null },
      });
      expect(r).toEqual({ ok: true });
    });
  });
});
