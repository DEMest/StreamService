import { Test } from '@nestjs/testing';
import { OrgService } from './org.service';
import { PrismaService } from '../prisma/prisma.service';
import { MediamtxService } from '../mediamtx/mediamtx.service';
import { ConflictException, NotFoundException } from '@nestjs/common';

const mockPrisma = {
  organization: { findUnique: jest.fn(), update: jest.fn() },
  event: { findFirst: jest.fn(), create: jest.fn(), update: jest.fn(), findMany: jest.fn() },
};
const mockMediamtx = { patchPath: jest.fn() };

describe('OrgService', () => {
  let service: OrgService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [
        OrgService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: MediamtxService, useValue: mockMediamtx },
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

  it('throws ConflictException when setting event live while another is live', async () => {
    mockPrisma.event.findFirst.mockResolvedValue({ id: 'other', status: 'live' });
    await expect(service.updateEvent('1', 'evt1', { status: 'live' }))
      .rejects.toBeInstanceOf(ConflictException);
  });

  it('throws NotFoundException for event not belonging to org', async () => {
    mockPrisma.event.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    await expect(service.updateEvent('1', 'nonexistent', { title: 'x' }))
      .rejects.toBeInstanceOf(NotFoundException);
  });
});
