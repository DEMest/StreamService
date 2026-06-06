import { Test } from '@nestjs/testing';
import { OrgService } from './org.service';
import { PrismaService } from '../prisma/prisma.service';
import { StreamService } from '../stream/stream.service';
import { RecordingService } from '../recording/recording.service';
import { ChatGateway } from '../chat/chat.gateway';
import { ChatService } from '../chat/chat.service';
import { NotFoundException } from '@nestjs/common';

const mockPrisma = {
  organization: { findUnique: jest.fn(), update: jest.fn() },
  stream: { update: jest.fn() },
  broadcast: { findFirst: jest.fn(), findMany: jest.fn(), update: jest.fn(), delete: jest.fn() },
};
const mockStream = {
  getDefaultStream: jest.fn(),
  rotateKey: jest.fn(),
  updateSettings: jest.fn(),
};
const mockRecording = { deleteRecordingByBroadcastId: jest.fn() };
const mockChatGateway = {
  broadcastChatEnabled: jest.fn(),
  broadcastChatCleared: jest.fn(),
};
const mockChatService = {
  clearMessages: jest.fn(),
};

describe('OrgService', () => {
  let service: OrgService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [
        OrgService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: StreamService, useValue: mockStream },
        { provide: RecordingService, useValue: mockRecording },
        { provide: ChatGateway, useValue: mockChatGateway },
        { provide: ChatService, useValue: mockChatService },
      ],
    }).compile();
    service = module.get(OrgService);
  });

  it('getProfile returns org + default stream merged into legacy DTO', async () => {
    mockStream.getDefaultStream.mockResolvedValue({
      id: 's1', slug: '', name: 'My', description: null,
      ingestKey: 'k', ingestKeyCreatedAt: new Date(),
      isPublic: true, previewKey: null, previewMode: 'multicam',
      previewImagePath: null, isLive: false, autoStartMode: 'public',
    });
    mockPrisma.organization.findUnique.mockResolvedValue({
      id: 'o1', slug: 'org', name: 'Org', isActive: true, createdAt: new Date(),
      chatTtlMinutes: 180, chatEnabled: true,
    });
    const r = await service.getProfile('o1', true);
    expect(r.slug).toBe('org');
    expect(r.streamTitle).toBe('My');
    expect(r.ingestKey).toBe('k');
    expect(r.autoStream).toBe(true);
    expect(r.chatTtlMinutes).toBe(180);
    expect(r.chatEnabled).toBe(true);
  });

  it('rotateKey delegates to StreamService.rotateKey for default stream', async () => {
    mockStream.getDefaultStream.mockResolvedValue({ id: 's1' });
    mockStream.rotateKey.mockResolvedValue({ ingestKey: 'newkey', ingestKeyCreatedAt: new Date() });
    const r = await service.rotateKey('o1', 'orgslug');
    expect(mockStream.rotateKey).toHaveBeenCalledWith('s1');
    expect(r.ingestKey).toBe('newkey');
  });

  it('updateStreamSettings delegates to StreamService.updateSettings for stream-fields', async () => {
    mockStream.getDefaultStream.mockResolvedValue({ id: 's1' });
    mockStream.updateSettings.mockResolvedValue({
      id: 's1', name: 'NewTitle', description: null,
      isPublic: true, previewKey: null, autoStartMode: 'public', isLive: false, previewMode: 'cam1',
    });
    mockPrisma.organization.findUnique.mockResolvedValue({ chatTtlMinutes: 180, chatEnabled: true });
    const r = await service.updateStreamSettings('o1', {
      streamTitle: 'NewTitle', previewMode: 'cam1', autoStream: true,
    });
    expect(mockStream.updateSettings).toHaveBeenCalledWith('s1', expect.objectContaining({
      name: 'NewTitle',
      previewMode: 'cam1',
      autoStartMode: 'public',
    }));
    expect(r.streamTitle).toBe('NewTitle');
    expect(r.autoStream).toBe(true);
  });

  it('updateStreamSettings updates chatEnabled on Organization and broadcasts event', async () => {
    mockStream.getDefaultStream.mockResolvedValue({ id: 's1' });
    mockStream.updateSettings.mockResolvedValue({
      id: 's1', name: 'X', description: null, isPublic: true,
      previewKey: null, autoStartMode: 'public', isLive: false, previewMode: 'multicam',
    });
    mockPrisma.organization.update.mockResolvedValue({
      slug: 'org', chatTtlMinutes: 60, chatEnabled: false,
    });
    await service.updateStreamSettings('o1', { chatTtlMinutes: 60, chatEnabled: false });
    expect(mockPrisma.organization.update).toHaveBeenCalledWith(expect.objectContaining({
      data: { chatTtlMinutes: 60, chatEnabled: false },
    }));
    expect(mockChatGateway.broadcastChatEnabled).toHaveBeenCalledWith('org', false);
  });

  it('clearChat delegates to ChatService and broadcasts', async () => {
    mockPrisma.organization.findUnique.mockResolvedValue({ slug: 'org' });
    mockChatService.clearMessages.mockResolvedValue({ deleted: 5 });
    const r = await service.clearChat('o1');
    expect(mockChatService.clearMessages).toHaveBeenCalledWith('o1');
    expect(mockChatGateway.broadcastChatCleared).toHaveBeenCalledWith('org');
    expect(r).toEqual({ ok: true, deleted: 5 });
  });

  it('listBroadcasts returns broadcasts of default stream with legacy recording field', async () => {
    mockStream.getDefaultStream.mockResolvedValue({ id: 's1' });
    mockPrisma.broadcast.findMany.mockResolvedValue([{ id: 'b1', title: 'T', recordings: [] }]);
    const r = await service.listBroadcasts('o1');
    expect(mockPrisma.broadcast.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { streamId: 's1', endedAt: { not: null } },
    }));
    expect(r[0].id).toBe('b1');
    expect(r[0].recording).toBeNull();
  });

  it('deleteBroadcast throws NotFoundException when broadcast not in org streams', async () => {
    mockStream.getDefaultStream.mockResolvedValue({ id: 's1' });
    mockPrisma.broadcast.findFirst.mockResolvedValue(null);
    await expect(service.deleteBroadcast('o1', 'bcast1')).rejects.toBeInstanceOf(NotFoundException);
  });
});
