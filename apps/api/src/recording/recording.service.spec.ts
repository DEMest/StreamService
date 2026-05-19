import { Test } from '@nestjs/testing';
import { RecordingService } from './recording.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotFoundException } from '@nestjs/common';

const mockPrisma = {
  recording: {
    create: jest.fn(),
    update: jest.fn(),
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    delete: jest.fn(),
  },
};

describe('RecordingService', () => {
  let service: RecordingService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [
        RecordingService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get(RecordingService);
  });

  describe('getRecordingDir', () => {
    it('throws NotFoundException when recording does not exist', async () => {
      mockPrisma.recording.findUnique.mockResolvedValue(null);
      await expect(service.getRecordingDir('missing-id')).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException when recording is not ready', async () => {
      mockPrisma.recording.findUnique.mockResolvedValue({
        id: '1', broadcastId: 'b1', status: 'processing', filePath: null,
      });
      await expect(service.getRecordingDir('b1')).rejects.toThrow(NotFoundException);
    });
  });

  describe('deleteRecordingByBroadcastId', () => {
    it('does nothing when recording does not exist', async () => {
      mockPrisma.recording.findUnique.mockResolvedValue(null);
      await expect(service.deleteRecordingByBroadcastId('none')).resolves.not.toThrow();
    });
  });

  describe('retryFailed', () => {
    it('skips recordings where broadcast.stream is null', async () => {
      mockPrisma.recording.findMany.mockResolvedValue([
        {
          id: 'rec1',
          broadcastId: 'b1',
          status: 'failed',
          broadcast: { stream: null },
        },
      ]);
      await expect(service.retryFailed()).resolves.not.toThrow();
      expect(mockPrisma.recording.update).not.toHaveBeenCalled();
    });
  });
});
