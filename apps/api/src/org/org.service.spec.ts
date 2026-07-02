import { Test } from '@nestjs/testing';
import { OrgService } from './org.service';
import { PrismaService } from '../prisma/prisma.service';
import { RecordingService } from '../recording/recording.service';
import { ChatGateway } from '../chat/chat.gateway';
import { ConflictException, NotFoundException } from '@nestjs/common';

const mockPrisma = {
  organization: { findUnique: jest.fn(), update: jest.fn() },
  broadcast: { findFirst: jest.fn(), update: jest.fn(), delete: jest.fn() },
};
const mockRecording = { deleteRecordingByBroadcastId: jest.fn() };
const mockChatGateway = {
  broadcastChatEnabled: jest.fn(),
};

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
      ],
    }).compile();
    service = module.get(OrgService);
  });

  describe('getProfile', () => {
    it('returns org profile without stream-fields', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue({
        id: 'o1', slug: 'org', name: 'Org', isActive: true, createdAt: new Date(),
        chatTtlMinutes: 180, chatEnabled: true,
      });
      const r = await service.getProfile('o1');
      expect(r).toEqual({
        id: 'o1', slug: 'org', name: 'Org', isActive: true, createdAt: expect.any(Date),
        chatTtlMinutes: 180, chatEnabled: true,
      });
      expect((r as any).streamTitle).toBeUndefined();
      expect((r as any).ingestKey).toBeUndefined();
    });

    it('throws NotFoundException when org does not exist', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue(null);
      await expect(service.getProfile('missing')).rejects.toBeInstanceOf(NotFoundException);
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
});
