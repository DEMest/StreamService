import { Test } from '@nestjs/testing';
import { AdminService } from './admin.service';
import { PrismaService } from '../prisma/prisma.service';
import { MediamtxService } from '../mediamtx/mediamtx.service';
import { NotFoundException } from '@nestjs/common';

const mockPrisma = {
  organization: {
    create: jest.fn(),
    findMany: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
};
const mockMediamtx = { addPath: jest.fn(), deletePath: jest.fn() };

describe('AdminService', () => {
  let service: AdminService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [
        AdminService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: MediamtxService, useValue: mockMediamtx },
      ],
    }).compile();
    service = module.get(AdminService);
  });

  it('creates org with generated ingestKey and calls mediamtx.addPath', async () => {
    mockPrisma.organization.create.mockResolvedValue({
      id: '1', slug: 'club', name: 'Club', ingestKey: 'key123', isActive: true, createdAt: new Date(),
    });
    const result = await service.createOrg({ slug: 'club', name: 'Club', password: 'pass' });
    expect(result.slug).toBe('club');
    expect(mockMediamtx.addPath).toHaveBeenCalledWith('club', expect.any(String));
  });

  it('throws NotFoundException when deleting non-existent org', async () => {
    mockPrisma.organization.findUnique.mockResolvedValue(null);
    await expect(service.deleteOrg('ghost')).rejects.toBeInstanceOf(NotFoundException);
  });
});
