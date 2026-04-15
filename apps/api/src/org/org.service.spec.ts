import { Test } from '@nestjs/testing';
import { OrgService } from './org.service';
import { PrismaService } from '../prisma/prisma.service';
import { MediamtxService } from '../mediamtx/mediamtx.service';
import { RecordingService } from '../recording/recording.service';
import { NotFoundException } from '@nestjs/common';

const mockPrisma = {
  organization: { findUnique: jest.fn(), update: jest.fn() },
  broadcast: { findFirst: jest.fn(), create: jest.fn(), update: jest.fn(), findMany: jest.fn(), delete: jest.fn() },
};
const mockMediamtx = { patchPath: jest.fn() };
const mockRecording = { onStreamEnded: jest.fn(), deleteRecordingByBroadcastId: jest.fn() };

describe('OrgService', () => {
  let service: OrgService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [
        OrgService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: MediamtxService, useValue: mockMediamtx },
        { provide: RecordingService, useValue: mockRecording },
      ],
    }).compile();
    service = module.get(OrgService);
  });

  it('rotates ingestKey and calls mediamtx.patchPath', async () => {
    mockPrisma.organization.update.mockResolvedValue({
      id: '1', slug: 'club', ingestKey: 'newkey', ingestKeyCreatedAt: new Date(),
    });
    const result = await service.rotateKey('1', 'club');
    expect(mockMediamtx.patchPath).toHaveBeenCalledWith('club', expect.any(String));
    expect(result.ingestKey).toBeDefined();
  });

  it('startStream creates a Broadcast and sets isLive=true', async () => {
    mockPrisma.organization.findUnique.mockResolvedValue({
      id: 'org1', streamTitle: 'My Stream', streamDescription: null, isLive: false,
    });
    mockPrisma.broadcast.create.mockResolvedValue({ id: 'bcast1' });
    mockPrisma.organization.update.mockResolvedValue({});

    const result = await service.startStream('org1');

    expect(mockPrisma.broadcast.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ orgId: 'org1', title: 'My Stream' }),
    }));
    expect(mockPrisma.organization.update).toHaveBeenCalledWith(expect.objectContaining({
      data: { isLive: true, currentBroadcastId: 'bcast1' },
    }));
    expect(result).toEqual({ ok: true, broadcastId: 'bcast1' });
  });

  it('startStream returns alreadyLive if org is already live', async () => {
    mockPrisma.organization.findUnique.mockResolvedValue({ id: 'org1', isLive: true });
    const result = await service.startStream('org1');
    expect(result).toEqual({ alreadyLive: true });
    expect(mockPrisma.broadcast.create).not.toHaveBeenCalled();
  });

  it('endStream closes broadcast and triggers recording', async () => {
    mockPrisma.organization.findUnique.mockResolvedValue({
      id: 'org1', slug: 'myorg', isLive: true, currentBroadcastId: 'bcast1',
    });
    mockPrisma.broadcast.update.mockResolvedValue({});
    mockPrisma.organization.update.mockResolvedValue({});
    mockRecording.onStreamEnded.mockResolvedValue(undefined);

    const result = await service.endStream('org1');

    expect(mockPrisma.broadcast.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'bcast1' },
      data: expect.objectContaining({ endedAt: expect.any(Date) }),
    }));
    expect(mockPrisma.organization.update).toHaveBeenCalledWith(expect.objectContaining({
      data: { isLive: false, currentBroadcastId: null },
    }));
    expect(result).toEqual({ ok: true });
  });

  it('endStream returns alreadyOff if org is not live', async () => {
    mockPrisma.organization.findUnique.mockResolvedValue({
      id: 'org1', slug: 'myorg', isLive: false, currentBroadcastId: null,
    });
    const result = await service.endStream('org1');
    expect(result).toEqual({ alreadyOff: true });
  });

  it('handleWebhook calls startStream when action=publish and autoStream=true', async () => {
    mockPrisma.organization.findUnique.mockResolvedValueOnce({ id: 'org1', autoStream: true });
    mockPrisma.organization.findUnique.mockResolvedValueOnce({
      id: 'org1', streamTitle: 'Test', streamDescription: null, isLive: false,
    });
    mockPrisma.broadcast.create.mockResolvedValue({ id: 'bcast1' });
    mockPrisma.organization.update.mockResolvedValue({});

    await service.handleWebhook('myorg', 'publish');

    expect(mockPrisma.broadcast.create).toHaveBeenCalled();
  });

  it('handleWebhook does nothing when autoStream=false', async () => {
    mockPrisma.organization.findUnique.mockResolvedValue({ id: 'org1', autoStream: false });
    await service.handleWebhook('myorg', 'publish');
    expect(mockPrisma.broadcast.create).not.toHaveBeenCalled();
  });

  it('deleteBroadcast throws NotFoundException when broadcast not in org', async () => {
    mockPrisma.broadcast.findFirst.mockResolvedValue(null);
    await expect(service.deleteBroadcast('org1', 'bcast1')).rejects.toBeInstanceOf(NotFoundException);
  });
});
