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
  stream: {
    create: jest.fn(),
    findMany: jest.fn(),
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
      id: '1', slug: 'club', name: 'Club', isActive: true, createdAt: new Date(),
    });
    mockPrisma.stream.create.mockResolvedValue({ id: 's1' });
    const result = await service.createOrg({ slug: 'club', name: 'Club', password: 'pass' });
    expect(result.slug).toBe('club');
    expect(mockMediamtx.addPath).toHaveBeenCalledWith('club', expect.any(String));
  });

  it('creates Org with a default Stream (slug=\'\', mode=composite)', async () => {
    mockPrisma.organization.create.mockResolvedValue({
      id: 'o1', slug: 'club', name: 'Club', isActive: true, createdAt: new Date(),
    });
    mockPrisma.stream.create.mockResolvedValue({ id: 's1' });

    await service.createOrg({ slug: 'club', name: 'Club', password: 'p' });

    expect(mockPrisma.stream.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        orgId: 'o1',
        slug: '',
        mode: 'composite',
        slotCount: 1,
        layoutPreset: 'solo',
        ingestKey: expect.any(String),
      }),
    }));
    expect(mockMediamtx.addPath).toHaveBeenCalledWith('club', expect.any(String));
  });

  it('throws NotFoundException when deleting non-existent org', async () => {
    const p2025 = Object.assign(new Error('Not found'), { code: 'P2025' });
    mockPrisma.organization.delete.mockRejectedValue(p2025);
    await expect(service.deleteOrg('ghost')).rejects.toBeInstanceOf(NotFoundException);
  });
});
